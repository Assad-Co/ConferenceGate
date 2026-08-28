// Firecrawl (firecrawl.dev) as the last-resort way to read a page. It runs a real browser behind
// rotating proxies on someone else's infrastructure, which is what gets past the two things that
// defeat everything before it in the chain: sites that refuse automated traffic outright, and
// sites whose content only exists after JavaScript runs.
//
// It is deliberately last. A plain fetch is free and reads most conference sites; a local browser
// is free and reads most of the rest; Firecrawl bills per page, so it is only reached once both
// have failed on that specific URL. Without an API key it disables itself and the chain simply
// ends one step earlier.

const FIRECRAWL_API_BASE = process.env.FIRECRAWL_API_BASE || "https://api.firecrawl.dev";
const SCRAPE_TIMEOUT_MS = 45000;
// A page it has to render behind a proxy is slow; this is the ceiling it's given to do it in.
const FIRECRAWL_PAGE_TIMEOUT_MS = 30000;

export function isFirecrawlConfigured(): boolean {
  return Boolean(process.env.FIRECRAWL_API_KEY);
}

/** Reads a page through Firecrawl. Returns HTML (so the existing link-following and image
 *  extraction keep working unchanged) plus markdown as a fallback body for pages it only renders
 *  as text. Returns null — never throws — on any failure, so a caller treats it like any other
 *  read that didn't work. */
export async function firecrawlScrape(url: string): Promise<{ html: string; markdown: string } | null> {
  if (!isFirecrawlConfigured()) return null;

  try {
    const res = await fetch(`${FIRECRAWL_API_BASE}/v1/scrape`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        // html keeps the anchors and img tags the crawl needs; markdown is the readable fallback
        // for pages Firecrawl only returns as text.
        formats: ["html", "markdown"],
        onlyMainContent: false,
        timeout: FIRECRAWL_PAGE_TIMEOUT_MS,
      }),
      signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
    });

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      // Surfaced rather than swallowed: a bad key, an exhausted quota and a page Firecrawl itself
      // could not fetch are three different problems, and the message distinguishes them.
      const detail = body?.error || body?.message || `HTTP ${res.status}`;
      console.error(`Firecrawl could not read ${url}: ${detail}`);
      return null;
    }

    // Tolerant of where the payload sits: Firecrawl has moved it between the top level and a
    // `data` envelope across API versions, and guessing one shape would fail silently on the other.
    const data = body?.data ?? body ?? {};
    const html = typeof data.html === "string" ? data.html : typeof data.rawHtml === "string" ? data.rawHtml : "";
    const markdown = typeof data.markdown === "string" ? data.markdown : typeof data.content === "string" ? data.content : "";
    if (!html && !markdown) {
      console.error(`Firecrawl returned no usable content for ${url}`);
      return null;
    }
    return { html, markdown };
  } catch (error: any) {
    console.error(`Firecrawl request failed for ${url}: ${error?.message || error}`);
    return null;
  }
}

/** Asks Firecrawl for the URLs it can see on a site. Used to seed the crawl when a conference
 *  publishes no sitemap.xml of its own, which is the case that otherwise leaves whole sections
 *  reachable only by luck. Returns [] when unavailable. */
export async function firecrawlMapSite(url: string, limit: number): Promise<string[]> {
  if (!isFirecrawlConfigured()) return [];
  try {
    const res = await fetch(`${FIRECRAWL_API_BASE}/v1/map`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, limit }),
      signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const body = await res.json().catch(() => null);
    // Entries have been plain strings in some versions and { url } objects in others.
    const raw: unknown[] = body?.links ?? body?.data?.links ?? body?.data ?? [];
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    for (const entry of raw) {
      const link = typeof entry === "string" ? entry : (entry as any)?.url;
      if (typeof link === "string" && link && !out.includes(link)) out.push(link);
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}
