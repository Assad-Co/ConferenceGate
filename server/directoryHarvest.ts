// Mines conference directories for the individual conferences they list.
//
// This is deliberately NOT a relaxation of the directory blocklist in braveSearch.ts. That guard
// stops a directory page being shown *as if it were a conference*, and Discover's own subheading
// promises exactly that ("directories, calendars and multi-conference lists are excluded"). It
// stays.
//
// What happens here is the opposite direction: a directory is read as a *source*, the individual
// conferences it names are pulled out, and those are what reach the screen. A search engine only
// surfaces conferences whose own sites rank well, which is why smaller regional events are so
// thin in the results; directories list them exhaustively precisely because that is their job.
//
// Everything returned is attributed to the directory it came from, because that is genuinely
// weaker evidence than a conference's own website — the reader is told which listing said it.

import type { GoogleGenAI } from "@google/genai";
import { jinaReadPage } from "./jinaReader";

export interface HarvestedConference {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
  thumbnail: null;
  favicon: null;
  /** The directory that listed this conference — never presented as the conference's own word. */
  listedBy: string;
}

interface DirectorySource {
  name: string;
  host: string;
  /** Built from the reader's topic. `{q}` is replaced with the URL-encoded search term. */
  searchUrl: (topic: string) => string;
}

// Kept small and explicit rather than open-ended: each of these is a general, worldwide,
// multi-discipline conference index with a stable public search page.
const DIRECTORY_SOURCES: DirectorySource[] = [
  {
    name: "ConferenceLists",
    host: "conferencelists.org",
    searchUrl: (topic) => `https://www.conferencelists.org/search-events?query=${encodeURIComponent(topic)}`,
  },
  {
    name: "iConf",
    host: "iconf.org",
    searchUrl: (topic) => `https://www.iconf.org/conferences?search=${encodeURIComponent(topic)}`,
  },
  {
    name: "Resurchify",
    host: "resurchify.com",
    searchUrl: (topic) => `https://www.resurchify.com/search.php?query=${encodeURIComponent(topic)}`,
  },
];

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // Listings change slowly; six hours keeps this cheap.
const cache = new Map<string, { data: HarvestedConference[]; expiresAt: number }>();

const FETCH_TIMEOUT_MS = 10000;
const MAX_PAGE_CHARS = 18000;
const MAX_PER_DIRECTORY = 15;

/** Plain text from a listing page. Plain fetch first (these are mostly server-rendered), then the
 *  hosted reader for the ones that aren't. Returns null rather than throwing. */
async function readListingText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        // Some indexes serve an interstitial to obvious bots; a normal browser UA gets the listing.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.ok) {
      const html = await res.text();
      const text = htmlToText(html);
      if (text.length >= 500) return text.slice(0, MAX_PAGE_CHARS);
    }
  } catch {
    // Fall through to the hosted reader below.
  }

  const viaJina = await jinaReadPage(url);
  return viaJina ? viaJina.slice(0, MAX_PAGE_CHARS) : null;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function buildHarvestPrompt(listingText: string, topic: string, directoryName: string): string {
  return [
    `The text below is a conference listing page from ${directoryName}.`,
    `Extract the individual conferences it lists that relate to: "${topic}".`,
    "",
    "Rules:",
    `- Return at most ${MAX_PER_DIRECTORY} conferences.`,
    "- Only include a conference the text actually names. Never invent one.",
    "- Only include conferences that are upcoming or whose date is not stated. Skip clearly past ones.",
    "- 'name' must be the conference's own name, not the directory's name and not a category heading.",
    "- 'dates', 'location' and 'url' are optional: use null when the page does not state them.",
    "- 'url' must be the conference's own website if the page gives one. Do not guess a URL.",
    "",
    'Reply with JSON only: {"conferences":[{"name":"...","dates":null,"location":null,"url":null}]}',
    "",
    "PAGE TEXT:",
    listingText,
  ].join("\n");
}

/** Reads the configured directories for conferences matching a topic.
 *
 *  Never throws: a directory that can't be read, or answers with something unparseable, simply
 *  contributes nothing. Discover's own results are unaffected either way. */
export async function harvestDirectoryConferences(
  ai: GoogleGenAI,
  model: string,
  topic: string,
  force = false
): Promise<HarvestedConference[]> {
  const term = topic.trim();
  if (!term) return [];

  const cacheKey = term.toLowerCase();
  const cached = cache.get(cacheKey);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.data;

  const perSource = await Promise.all(
    DIRECTORY_SOURCES.map(async (source) => {
      try {
        const listingUrl = source.searchUrl(term);
        const text = await readListingText(listingUrl);
        if (!text) return [];

        const response = await ai.models.generateContent({
          model,
          contents: buildHarvestPrompt(text, term, source.name),
          config: { responseMimeType: "application/json" },
        });

        const raw = response.text;
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed?.conferences) ? parsed.conferences : [];

        return list
          .filter((entry: any) => typeof entry?.name === "string" && entry.name.trim().length > 2)
          .slice(0, MAX_PER_DIRECTORY)
          .map((entry: any): HarvestedConference => {
            const name = entry.name.trim();
            const detail = [entry.dates, entry.location].filter((v: unknown) => typeof v === "string" && v).join(" · ");
            return {
              title: name,
              // Falls back to the listing itself when no conference site was given, so the link
              // always goes somewhere that genuinely mentions this conference.
              link: typeof entry.url === "string" && /^https?:\/\//i.test(entry.url) ? entry.url : listingUrl,
              snippet: detail ? `${detail} — listed by ${source.name}.` : `Listed by ${source.name}.`,
              displayLink: (() => {
                try {
                  return new URL(
                    typeof entry.url === "string" && /^https?:\/\//i.test(entry.url) ? entry.url : listingUrl
                  ).hostname.replace(/^www\./, "");
                } catch {
                  return source.host;
                }
              })(),
              thumbnail: null,
              favicon: null,
              listedBy: source.name,
            };
          });
      } catch {
        // One unreadable or unparseable directory must never affect the others, or the search.
        return [];
      }
    })
  );

  // Same conference listed by two directories is one conference.
  const seen = new Set<string>();
  const merged: HarvestedConference[] = [];
  for (const entry of perSource.flat()) {
    const key = entry.title.toLowerCase().replace(/\b20\d{2}\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }

  cache.set(cacheKey, { data: merged, expiresAt: Date.now() + CACHE_TTL_MS });
  return merged;
}
