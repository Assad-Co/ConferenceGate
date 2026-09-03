// A fast, hosted page reader, used when a plain fetch comes back empty or refused.
//
// This exists because of a specific gap on hosts like Render: a JavaScript-rendered conference
// site returns an empty shell to a plain fetch, and the next two routes are both commonly
// unavailable there — local Chromium needs system libraries the default Node image doesn't carry
// (browserFetch disables itself), and Firecrawl needs a paid key. So the reader would spend its
// whole per-page budget failing, then fall through to the much slower open-web gathering.
//
// Jina's reader renders the page on its own infrastructure and returns clean markdown, which is
// what the extraction prompt wants anyway — no HTML parsing, no browser launch. It is typically a
// couple of seconds against the ~1s+ a Chromium launch costs before it has even navigated, and it
// works on hosts where no browser can run at all.
//
// Deliberately keyless-capable: it works with no configuration, and JINA_API_KEY only raises the
// rate limit. That matches how every other optional integration here degrades rather than breaks.

const JINA_TIMEOUT_MS = 12000;

export function isJinaConfigured(): boolean {
  // Always available — the public endpoint serves unauthenticated requests at a lower rate limit.
  // A key raises that ceiling but is not required for the route to function.
  return process.env.JINA_READER_DISABLED !== "1";
}

export function hasJinaKey(): boolean {
  return !!process.env.JINA_API_KEY;
}

export interface JinaReadResult {
  markdown: string | null;
  httpStatus: number | null;
  error: string | null;
}

/** Diagnostic form used by discovery, where "nothing" must have an actionable reason. */
export async function jinaReadPageDetailed(pageUrl: string): Promise<JinaReadResult> {
  if (!isJinaConfigured()) return { markdown: null, httpStatus: null, error: "reader_disabled" };

  try {
    const headers: Record<string, string> = {
      Accept: "text/plain",
      "X-Return-Format": "markdown",
    };
    if (process.env.JINA_API_KEY) headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`;

    const res = await fetch(`https://r.jina.ai/${pageUrl}`, {
      headers,
      signal: AbortSignal.timeout(JINA_TIMEOUT_MS),
    });
    if (!res.ok) return { markdown: null, httpStatus: res.status, error: `reader_http_${res.status}` };

    const markdown = (await res.text()).trim();
    return markdown
      ? { markdown, httpStatus: res.status, error: null }
      : { markdown: null, httpStatus: res.status, error: "reader_returned_nothing" };
  } catch (error: any) {
    const message = String(error?.name || error?.message || error);
    return {
      markdown: null,
      httpStatus: null,
      error: /timeout|abort/i.test(message) ? "reader_timeout" : `reader_transport_error:${message.slice(0, 80)}`,
    };
  }
}

/** Reads a page as markdown via Jina's hosted reader. Returns null (never throws) on any failure,
 *  so a caller can simply fall through to the next route in the chain, exactly as it does for the
 *  browser and Firecrawl steps. */
export async function jinaReadPage(pageUrl: string): Promise<string | null> {
  return (await jinaReadPageDetailed(pageUrl)).markdown;
}
