// A second way to read a page, for the two cases a plain HTTP fetch cannot handle:
//
//   1. Bot protection. Many conference sites sit behind a WAF (Cloudflare and friends) that
//      rejects server-side requests no matter what User-Agent they claim, because it fingerprints
//      the TLS handshake and expects a browser to run a JavaScript challenge. A real browser
//      passes; `fetch` cannot.
//   2. Client-rendered pages. Event platforms commonly ship an empty shell and build the page in
//      JavaScript, so the HTML that arrives over `fetch` contains no speakers, no agenda, and no
//      venue — nothing to extract, however well the crawl is working.
//
// This is deliberately the fallback rather than the default: launching a browser costs a second
// and tens of megabytes, and most conference sites are plain server-rendered HTML that `fetch`
// reads perfectly well. It is also entirely optional — if a browser can't be launched (not
// installed on the host, no sandbox permissions) it disables itself after one attempt and the
// extraction carries on exactly as it did before.

import type { Browser } from "playwright-core";
import { isSafeExternalUrl } from "./urlSafety";

// Rendering is heavier than fetching in both memory and CPU, and the crawl fetches a whole round
// of pages at once. This caps how many pages can be rendering at the same time.
const MAX_CONCURRENT_RENDERS = 3;
// How long to let a page load and settle before giving up on it.
const RENDER_TIMEOUT_MS = 20000;
// After the document loads, a client-rendered page still needs a moment to build itself. Waited
// for once, then the HTML is taken as-is rather than waiting for a network that may never idle
// (analytics beacons and chat widgets poll indefinitely on plenty of real sites).
const SETTLE_AFTER_LOAD_MS = 1200;

let browserPromise: Promise<Browser | null> | null = null;
let unavailableReason: string | null = null;

async function launchBrowser(): Promise<Browser | null> {
  try {
    const { chromium } = await import("playwright-core");
    // PLAYWRIGHT_BROWSERS_PATH (or an explicit override) tells playwright-core where the binary
    // lives; without either it throws, which is caught below and disables rendering for good.
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
    return await chromium.launch({
      executablePath,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
  } catch (error: any) {
    unavailableReason = error?.message || String(error);
    console.error(
      "Browser rendering unavailable — falling back to plain HTTP fetch only. " +
        "Install it with `npx playwright install chromium` to read JavaScript-rendered or " +
        `bot-protected conference sites. Reason: ${unavailableReason}`
    );
    return null;
  }
}

function getBrowser(): Promise<Browser | null> {
  if (unavailableReason) return Promise.resolve(null);
  if (!browserPromise) {
    browserPromise = launchBrowser();
  }
  return browserPromise;
}

// A plain counting semaphore over MAX_CONCURRENT_RENDERS.
let activeRenders = 0;
const renderQueue: Array<() => void> = [];

async function acquireRenderSlot(): Promise<void> {
  if (activeRenders < MAX_CONCURRENT_RENDERS) {
    activeRenders++;
    return;
  }
  await new Promise<void>((resolve) => renderQueue.push(resolve));
  activeRenders++;
}

function releaseRenderSlot(): void {
  activeRenders--;
  const next = renderQueue.shift();
  if (next) next();
}

/** True when rendering has been tried and found unavailable on this host — lets a caller skip
 *  the attempt entirely and explain the limitation rather than silently returning nothing. */
export function isBrowserRenderingUnavailable(): boolean {
  return unavailableReason !== null;
}

/** Loads a URL in a real browser and returns the rendered HTML, or null if it can't be read.
 *  Never throws: a failure here always means falling back to whatever the plain fetch produced. */
export async function fetchRenderedHtml(url: string): Promise<string | null> {
  const browser = await getBrowser();
  if (!browser) return null;

  await acquireRenderSlot();
  let context;
  try {
    context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "en-US",
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    // Images, fonts and media are never extracted from, so loading them only costs time and
    // memory. Image URLs still reach the model — those come from the HTML's own <img> tags,
    // which are present whether or not the bytes were downloaded.
    await page.route("**/*", async (route) => {
      const request = route.request();
      const type = request.resourceType();
      if (type === "image" || type === "font" || type === "media") return route.abort();
      // The document itself is the only thing that can redirect somewhere dangerous, so the SSRF
      // check that guarded the original URL is re-applied to wherever a navigation actually goes.
      if (type === "document" && !(await isSafeExternalUrl(request.url()))) return route.abort();
      return route.continue();
    });

    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: RENDER_TIMEOUT_MS });
    // A bot-protection interstitial answers 403 and then swaps in the real page once its challenge
    // passes, so a non-OK status is not by itself a reason to discard what's on screen. The
    // caller's minimum-text check is what decides whether the result is worth extracting from.
    if (!response) return null;

    await page.waitForTimeout(SETTLE_AFTER_LOAD_MS);
    return await page.content();
  } catch (error: any) {
    console.error(`Browser rendering failed for ${url}: ${error?.message || error}`);
    return null;
  } finally {
    if (context) await context.close().catch(() => {});
    releaseRenderSlot();
  }
}

/** Shuts the shared browser down. Called on server shutdown so a rendering Chromium doesn't
 *  outlive the process that started it. */
export async function closeBrowser(): Promise<void> {
  const pending = browserPromise;
  browserPromise = null;
  if (!pending) return;
  const browser = await pending.catch(() => null);
  if (browser) await browser.close().catch(() => {});
}
