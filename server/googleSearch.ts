import { Router } from "express";

export interface LiveSearchResult {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
  thumbnail: string | null;
}

interface CacheEntry {
  data: LiveSearchResult[];
  expiresAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — keeps us well within the free 100 queries/day quota
const cache = new Map<string, CacheEntry>();

function isConfigured() {
  return !!process.env.GOOGLE_SEARCH_API_KEY && !!process.env.GOOGLE_SEARCH_ENGINE_ID;
}

async function searchConferences(query: string): Promise<LiveSearchResult[]> {
  const cacheKey = query.trim().toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", process.env.GOOGLE_SEARCH_API_KEY!);
  url.searchParams.set("cx", process.env.GOOGLE_SEARCH_ENGINE_ID!);
  url.searchParams.set("q", query);
  url.searchParams.set("num", "10");

  const res = await fetch(url.toString());
  const body = await res.json();

  if (!res.ok) {
    const message = body?.error?.message || `Google Search API error (${res.status})`;
    throw new Error(message);
  }

  const items: any[] = body.items || [];
  const results: LiveSearchResult[] = items.map((item) => ({
    title: item.title || "",
    link: item.link || "",
    snippet: item.snippet || "",
    displayLink: item.displayLink || "",
    thumbnail: item.pagemap?.cse_thumbnail?.[0]?.src || item.pagemap?.cse_image?.[0]?.src || null,
  }));

  cache.set(cacheKey, { data: results, expiresAt: Date.now() + CACHE_TTL_MS });
  return results;
}

export const googleSearchRouter = Router();

googleSearchRouter.get("/conferences", async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

  if (!query || query.length < 2) {
    return res.status(400).json({ error: "Provide a search query of at least 2 characters." });
  }

  if (!isConfigured()) {
    return res.status(503).json({
      error: "Live search is not configured on the server. Set GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID.",
    });
  }

  try {
    const results = await searchConferences(query);
    res.json({ results });
  } catch (error: any) {
    console.error("Google Search error:", error);
    res.status(502).json({ error: error.message || "Live search failed. Please try again." });
  }
});
