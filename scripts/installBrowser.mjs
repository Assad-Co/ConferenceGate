// Makes sure a Chromium is available for the extraction fallback in server/browserFetch.ts,
// which is what reads conference sites that sit behind bot protection or build their pages in
// JavaScript. Runs from `postinstall`, so a normal `npm install` on a deploy host sets it up.
//
// This must never fail an install. A host without a browser still runs the whole application —
// extraction simply falls back to plain HTTP fetches, and the UI says so rather than pretending
// the site had nothing on it.
import { execFileSync } from "child_process";

const SKIP_ENV = process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD;
if (SKIP_ENV && SKIP_ENV !== "0") {
  console.log("[install-browser] PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD is set — leaving the browser alone.");
  process.exit(0);
}

// An explicit path means the host is providing its own browser (a container image with Chromium
// baked in, for instance); downloading a second copy would just waste a few hundred megabytes.
if (process.env.PLAYWRIGHT_CHROMIUM_PATH) {
  console.log(`[install-browser] Using PLAYWRIGHT_CHROMIUM_PATH=${process.env.PLAYWRIGHT_CHROMIUM_PATH}`);
  process.exit(0);
}

// Mirrors the discovery in server/browserFetch.ts: any usable Chromium counts, not only the one
// build playwright-core pins. A host that already has Chromium from its package manager or base
// image needs no download.
const alreadyInstalled = await (async () => {
  const { existsSync, readdirSync } = await import("fs");
  const { join } = await import("path");

  const candidates = [];
  try {
    const { chromium } = await import("playwright-core");
    candidates.push(chromium.executablePath());
  } catch {
    // playwright-core not resolvable yet during install — the other candidates still apply.
  }
  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (browsersPath) {
    try {
      for (const build of readdirSync(browsersPath).filter((n) => n.startsWith("chromium"))) {
        candidates.push(join(browsersPath, build, "chrome-linux", "chrome"));
      }
    } catch {
      // No such directory.
    }
  }
  candidates.push("/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable");

  return candidates.some((p) => p && existsSync(p));
})();

if (alreadyInstalled) {
  console.log("[install-browser] Chromium is already installed — nothing to do.");
  process.exit(0);
}

console.log("[install-browser] Installing Chromium for conference-site extraction...");
try {
  execFileSync(process.execPath, [
    new URL("../node_modules/playwright-core/cli.js", import.meta.url).pathname,
    "install",
    "chromium",
  ], { stdio: "inherit" });
  console.log("[install-browser] Chromium installed.");
} catch (error) {
  console.warn(
    "[install-browser] Could not install Chromium. The app will still run, but conference sites " +
      "that are bot-protected or JavaScript-rendered won't be readable. Install it later with " +
      "`npm run install:browser`."
  );
  console.warn(`[install-browser] Reason: ${error?.message || error}`);
}
// Always a success: a missing browser degrades extraction, it does not break the application.
process.exit(0);
