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
// Starter plans enforce a requests-per-minute ceiling. All scrape/map calls share this queue so
// one eight-page crawl round cannot burst through the account limit at once.
const FIRECRAWL_MIN_START_INTERVAL_MS = 7000;
const FIRECRAWL_MAX_ATTEMPTS = 3;
let firecrawlQueue: Promise<void> = Promise.resolve();
let nextFirecrawlStartAt = 0;

async function scheduleFirecrawlRequest<T>(request: () => Promise<T>): Promise<T> {
  const previous = firecrawlQueue;
  let release!: () => void;
  firecrawlQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  const waitMs = Math.max(0, nextFirecrawlStartAt - Date.now());
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  try {
    return await request();
  } finally {
    nextFirecrawlStartAt = Date.now() + FIRECRAWL_MIN_START_INTERVAL_MS;
    release();
  }
}

function retryDelayMs(res: Response, body: any, attempt: number): number {
  const headerSeconds = Number(res.headers.get("retry-after"));
  if (Number.isFinite(headerSeconds) && headerSeconds > 0) return Math.min(headerSeconds * 1000, 60000);
  const message = String(body?.error || body?.message || "");
  const match = /retry after\s+(\d+)s/i.exec(message);
  if (match) return Math.min(Number(match[1]) * 1000, 60000);
  return Math.min(5000 * attempt, 30000);
}

export function isFirecrawlConfigured(): boolean {
  return Boolean(process.env.FIRECRAWL_API_KEY);
}

/** Reads a page through Firecrawl. Returns HTML (so the existing link-following and image
 *  extraction keep working unchanged) plus markdown as a fallback body for pages it only renders
 *  as text. Returns null — never throws — on any failure, so a caller treats it like any other
 *  read that didn't work. */
export async function firecrawlScrape(url: string): Promise<{ html: string; markdown: string } | null> {
  if (!isFirecrawlConfigured()) return null;

  for (let attempt = 1; attempt <= FIRECRAWL_MAX_ATTEMPTS; attempt++) {
    try {
      const outcome = await scheduleFirecrawlRequest(async () => {
        const res = await fetch(`${FIRECRAWL_API_BASE}/v1/scrape`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url,
            formats: ["html", "markdown"],
            onlyMainContent: false,
            timeout: FIRECRAWL_PAGE_TIMEOUT_MS,
          }),
          signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
        });
        const body = await res.json().catch(() => null);
        return { res, body };
      });

      if (outcome.res.status === 429) {
        if (attempt < FIRECRAWL_MAX_ATTEMPTS) {
          const delay = retryDelayMs(outcome.res, outcome.body, attempt);
          console.warn(`Firecrawl rate limit reached; queued ${url} for retry in ${Math.ceil(delay / 1000)}s`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }

      if (!outcome.res.ok) {
        const detail = outcome.body?.error || outcome.body?.message || `HTTP ${outcome.res.status}`;
        console.error(`Firecrawl could not read ${url} after ${attempt} attempt(s): ${detail}`);
        return null;
      }

      const data = outcome.body?.data ?? outcome.body ?? {};
      const html = typeof data.html === "string" ? data.html : typeof data.rawHtml === "string" ? data.rawHtml : "";
      const markdown = typeof data.markdown === "string" ? data.markdown : typeof data.content === "string" ? data.content : "";
      if (!html && !markdown) {
        console.warn(`Firecrawl returned no usable content for ${url}`);
        return null;
      }
      return { html, markdown };
    } catch (error: any) {
      if (attempt < FIRECRAWL_MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
        continue;
      }
      console.error(`Firecrawl request failed for ${url}: ${error?.message || error}`);
    }
  }
  return null;
}

const FIRECRAWL_BATCH_JOB_TIMEOUT_MS = 90000;
const FIRECRAWL_BATCH_POLL_INTERVAL_MS = 1000;

export interface FirecrawlBatchPage {
  url: string;
  html: string;
  markdown: string;
}

/**
 * Reads several blocked pages as one Firecrawl batch job. One coordinated batch avoids making
 * eight separately rate-limited scrape requests in a crawl round, while maxConcurrency keeps the
 * provider-side work within a small plan's concurrency allowance.
 */
export async function firecrawlBatchScrape(urls: string[]): Promise<FirecrawlBatchPage[]> {
  if (!isFirecrawlConfigured()) return [];
  const uniqueUrls = [...new Set(urls.filter(Boolean))];
  if (uniqueUrls.length === 0) return [];

  let jobId = "";
  for (let attempt = 1; attempt <= FIRECRAWL_MAX_ATTEMPTS; attempt++) {
    try {
      const outcome = await scheduleFirecrawlRequest(async () => {
        const res = await fetch(`${FIRECRAWL_API_BASE}/v2/batch/scrape`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            urls: uniqueUrls,
            formats: ["html", "markdown"],
            onlyMainContent: false,
            maxConcurrency: 2,
            timeout: FIRECRAWL_PAGE_TIMEOUT_MS,
          }),
          signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
        });
        const body = await res.json().catch(() => null);
        return { res, body };
      });

      if (outcome.res.status === 429 && attempt < FIRECRAWL_MAX_ATTEMPTS) {
        const delay = retryDelayMs(outcome.res, outcome.body, attempt);
        console.warn(`Firecrawl batch rate limit reached; retrying in ${Math.ceil(delay / 1000)}s`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      if (!outcome.res.ok) {
        const detail = outcome.body?.error || outcome.body?.message || `HTTP ${outcome.res.status}`;
        console.error(`Firecrawl batch could not start: ${detail}`);
        return [];
      }
      jobId = String(outcome.body?.id || outcome.body?.data?.id || "");
      if (!jobId) {
        console.error("Firecrawl batch started without a job id");
        return [];
      }
      break;
    } catch (error: any) {
      if (attempt < FIRECRAWL_MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
        continue;
      }
      console.error(`Firecrawl batch request failed: ${error?.message || error}`);
      return [];
    }
  }
  if (!jobId) return [];

  const deadline = Date.now() + FIRECRAWL_BATCH_JOB_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(
        `${FIRECRAWL_API_BASE}/v2/batch/scrape/${encodeURIComponent(jobId)}`,
        {
          headers: { Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}` },
          signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
        }
      );
      const body = await res.json().catch(() => null);
      if (res.status === 429) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs(res, body, 1)));
        continue;
      }
      if (!res.ok) {
        console.error(`Firecrawl batch status failed with HTTP ${res.status}`);
        return [];
      }

      const status = String(body?.status || body?.data?.status || "").toLowerCase();
      if (status === "failed" || status === "cancelled") {
        console.error(`Firecrawl batch ended with status ${status}`);
        return [];
      }
      if (status === "completed") {
        const raw = Array.isArray(body?.data)
          ? body.data
          : Array.isArray(body?.data?.data)
            ? body.data.data
            : [];
        const pages: FirecrawlBatchPage[] = [];
        for (let i = 0; i < raw.length; i++) {
          const item = raw[i] || {};
          const pageUrl =
            item?.metadata?.sourceURL ||
            item?.metadata?.url ||
            item?.url ||
            uniqueUrls[i] ||
            "";
          const html =
            typeof item?.html === "string"
              ? item.html
              : typeof item?.rawHtml === "string"
                ? item.rawHtml
                : "";
          const markdown =
            typeof item?.markdown === "string"
              ? item.markdown
              : typeof item?.content === "string"
                ? item.content
                : "";
          if (pageUrl && (html || markdown)) pages.push({ url: pageUrl, html, markdown });
        }
        console.log(`Firecrawl batch read ${pages.length}/${uniqueUrls.length} blocked pages`);
        return pages;
      }
    } catch (error: any) {
      console.warn(`Firecrawl batch status check failed; retrying: ${error?.message || error}`);
    }
    await new Promise((resolve) => setTimeout(resolve, FIRECRAWL_BATCH_POLL_INTERVAL_MS));
  }

  console.error(`Firecrawl batch did not finish within ${FIRECRAWL_BATCH_JOB_TIMEOUT_MS / 1000}s`);
  return [];
}

/** Asks Firecrawl for the URLs it can see on a site. Used to seed the crawl when a conference
 *  publishes no sitemap.xml of its own, which is the case that otherwise leaves whole sections
 *  reachable only by luck. Returns [] when unavailable. */
export async function firecrawlMapSite(url: string, limit: number): Promise<string[]> {
  if (!isFirecrawlConfigured()) return [];
  try {
    const res = await scheduleFirecrawlRequest(() => fetch(`${FIRECRAWL_API_BASE}/v1/map`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, limit }),
      signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
    }));
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
