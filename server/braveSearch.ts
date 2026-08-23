import { Router } from "express";
import { asyncHandler } from "./asyncHandler";

export interface LiveSearchResult {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
  thumbnail: string | null;
  favicon: string | null;
}

interface CacheEntry {
  data: LiveSearchResult[];
  expiresAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — keeps us well within Brave's free 2,000 queries/month quota
const cache = new Map<string, CacheEntry>();

function isConfigured() {
  return !!process.env.BRAVE_SEARCH_API_KEY;
}

// Brave highlights matched keywords with <strong> tags and HTML-escapes entities in the
// title/description fields — strip that markup so plain text reaches the client.
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}
function stripHtml(text: string): string {
  return decodeHtmlEntities(text.replace(/<[^>]*>/g, ""));
}

// Nudges the underlying web search toward actual conference/event listings rather than
// generic informational pages about the topic — this panel is "search the web for a
// conference we haven't added yet", not a general-purpose search box.
const CONFERENCE_KEYWORDS = /\b(conference|summit|symposium|convention|congress|workshop|expo)\b/i;
function toConferenceQuery(query: string): string {
  return CONFERENCE_KEYWORDS.test(query) ? query : `${query} conference`;
}

async function searchConferences(query: string): Promise<LiveSearchResult[]> {
  const cacheKey = query.trim().toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", toConferenceQuery(query));
  url.searchParams.set("count", "10");

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY!,
    },
  });
  const rawText = await res.text();
  let body: any = {};
  try {
    body = rawText ? JSON.parse(rawText) : {};
  } catch {
    throw new Error(`Live search failed (unexpected response, HTTP ${res.status}). Please try again.`);
  }

  if (!res.ok) {
    const message = body?.error?.detail || body?.error?.message || `Brave Search API error (${res.status})`;
    throw new Error(message);
  }

  const items: any[] = body.web?.results || [];
  const results: LiveSearchResult[] = items.map((item) => ({
    title: stripHtml(item.title || ""),
    link: item.url || "",
    snippet: stripHtml(item.description || ""),
    displayLink: item.meta_url?.hostname || item.profile?.name || "",
    thumbnail: item.thumbnail?.src || null,
    favicon: item.meta_url?.favicon || item.profile?.img || null,
  }));

  cache.set(cacheKey, { data: results, expiresAt: Date.now() + CACHE_TTL_MS });
  return results;
}

export const braveSearchRouter = Router();

braveSearchRouter.get(
  "/conferences",
  asyncHandler(async (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

    if (!query || query.length < 2) {
      return res.status(400).json({ error: "Provide a search query of at least 2 characters." });
    }

    if (!isConfigured()) {
      return res.status(503).json({
        error: "Live search is not configured on the server. Set BRAVE_SEARCH_API_KEY.",
      });
    }

    try {
      const results = await searchConferences(query);
      res.json({ results });
    } catch (error: any) {
      console.error("Brave Search error:", error);
      res.status(502).json({ error: error.message || "Live search failed. Please try again." });
    }
  })
);
