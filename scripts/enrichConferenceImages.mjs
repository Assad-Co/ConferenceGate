import { createClient } from "@libsql/client";

const DEFAULT_LIMIT = 160;
const DEFAULT_CONCURRENCY = 6;
const FETCH_TIMEOUT_MS = 8_000;
const IMAGE_TIMEOUT_MS = 5_000;

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}

function isPrivateHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const a = Number(ipv4[1]);
  const b = Number(ipv4[2]);
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function publicHttpUrl(raw, base) {
  if (!raw) return null;
  try {
    const url = new URL(decodeHtml(raw), base);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (isPrivateHost(url.hostname)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function attr(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`${escaped}\\s*=\\s*"([^"]+)"`, "i"),
    new RegExp(`${escaped}\\s*=\\s*'([^']+)'`, "i"),
    new RegExp(`${escaped}\\s*=\\s*([^\\s>]+)`, "i"),
  ];
  for (const pattern of patterns) {
    const match = tag.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return null;
}

function metaContent(html, key, value) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const marker = attr(tag, key);
    if (marker && marker.toLowerCase() === value.toLowerCase()) {
      return attr(tag, "content");
    }
  }
  return null;
}

function extractJsonLdCandidates(html, base) {
  const out = [];
  const scripts = html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];

  function pushImage(value, kind, score) {
    if (typeof value === "string") {
      const url = publicHttpUrl(value, base);
      if (url) out.push({ url, kind, score });
    } else if (Array.isArray(value)) {
      for (const item of value) pushImage(item, kind, score);
    } else if (value && typeof value === "object") {
      pushImage(value.url || value.contentUrl, kind, score);
    }
  }

  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const type = clean(node["@type"]).toLowerCase();
    if (/(event|conference|congress|symposium|summit|workshop|meeting)/.test(type)) {
      pushImage(node.logo, "logo", 100);
      pushImage(node.image, "banner", 80);
    } else if (/(organization|collegeoruniversity|corporation|educationalorganization)/.test(type)) {
      pushImage(node.logo, "logo", 70);
      pushImage(node.image, "banner", 45);
    }
    for (const value of Object.values(node)) walk(value);
  }

  for (const script of scripts) {
    const body = script.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, "").trim();
    try {
      walk(JSON.parse(body));
    } catch {
      // Invalid JSON-LD is common; other metadata sources still work.
    }
  }
  return out;
}

function extractLogoImgCandidates(html, base) {
  const out = [];
  const tags = html.match(/<img\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const hint = `${attr(tag, "class") || ""} ${attr(tag, "id") || ""} ${attr(tag, "alt") || ""}`.toLowerCase();
    if (!/\b(logo|brand|conference-mark|event-logo)\b/.test(hint)) continue;
    const src = attr(tag, "src") || attr(tag, "data-src") || attr(tag, "data-lazy-src");
    const url = publicHttpUrl(src, base);
    if (url) out.push({ url, kind: "logo", score: /conference|event/.test(hint) ? 95 : 75 });
  }
  return out;
}

function extractLinkCandidates(html, base) {
  const out = [];
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const rel = (attr(tag, "rel") || "").toLowerCase();
    const href = publicHttpUrl(attr(tag, "href"), base);
    if (!href) continue;
    if (rel.includes("apple-touch-icon")) out.push({ url: href, kind: "logo", score: 55 });
  }
  return out;
}

function extractCandidates(html, finalUrl) {
  const candidates = [
    ...extractJsonLdCandidates(html, finalUrl),
    ...extractLogoImgCandidates(html, finalUrl),
    ...extractLinkCandidates(html, finalUrl),
  ];

  const ogImage = publicHttpUrl(metaContent(html, "property", "og:image") || metaContent(html, "property", "og:image:secure_url"), finalUrl);
  if (ogImage) candidates.push({ url: ogImage, kind: "banner", score: 65 });

  const twitterImage = publicHttpUrl(metaContent(html, "name", "twitter:image"), finalUrl);
  if (twitterImage) candidates.push({ url: twitterImage, kind: "banner", score: 55 });

  const seen = new Set();
  return candidates
    .filter((item) => {
      if (!item.url || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    })
    .sort((a, b) => b.score - a.score);
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ConferenceGateImageEnricher/1.0)",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
      },
    });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html") && !type.includes("application/xhtml")) return null;
    const html = (await response.text()).slice(0, 1_500_000);
    return { html, finalUrl: response.url || url };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function imageLooksUsable(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ConferenceGateImageEnricher/1.0)",
        Range: "bytes=0-4095",
        Accept: "image/*,*/*;q=0.2",
      },
    });
    const type = (response.headers.get("content-type") || "").toLowerCase();
    try { await response.body?.cancel(); } catch {}
    if (!response.ok && response.status !== 206) return false;
    return type.startsWith("image/") || /\.(?:png|jpe?g|webp|gif|svg)(?:[?#]|$)/i.test(url);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function parseOverview(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function bestImageFor(row) {
  const overview = parseOverview(row.overview);
  const existingLogo = publicHttpUrl(overview.logo_url, row.official_url || row.canonical_url || row.source_url);
  const existingImage = publicHttpUrl(overview.image_url, row.official_url || row.canonical_url || row.source_url);
  if (existingLogo && await imageLooksUsable(existingLogo)) {
    return { imageUrl: existingImage || existingLogo, logoUrl: existingLogo, source: "stored_official_logo" };
  }
  if (existingImage && await imageLooksUsable(existingImage)) {
    return { imageUrl: existingImage, logoUrl: null, source: "stored_official_image" };
  }

  const pageUrl = publicHttpUrl(row.official_url || row.canonical_url || row.source_url);
  if (!pageUrl) return null;

  const page = await fetchHtml(pageUrl);
  if (!page) return null;

  const candidates = extractCandidates(page.html, page.finalUrl);
  let bestBanner = null;

  for (const candidate of candidates.slice(0, 8)) {
    if (!await imageLooksUsable(candidate.url)) continue;
    if (candidate.kind === "logo") {
      return {
        imageUrl: candidate.url,
        logoUrl: candidate.url,
        source: "official_site_logo",
      };
    }
    if (!bestBanner) bestBanner = candidate.url;
  }

  return bestBanner
    ? { imageUrl: bestBanner, logoUrl: null, source: "official_site_banner" }
    : null;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, run));
  return results;
}

async function main() {
  const databaseUrl = process.env.TURSO_DATABASE_URL?.trim();
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();

  if (!databaseUrl) {
    console.log("[conference-images] TURSO_DATABASE_URL missing; skipping");
    return;
  }

  const requestedLimit = Number(process.env.IMAGE_ENRICH_LIMIT || DEFAULT_LIMIT);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(1000, requestedLimit)) : DEFAULT_LIMIT;
  const concurrency = Math.max(1, Math.min(12, Number(process.env.IMAGE_ENRICH_CONCURRENCY || DEFAULT_CONCURRENCY) || DEFAULT_CONCURRENCY));

  const db = createClient({ url: databaseUrl, authToken: authToken || undefined });

  try {
    const check = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='discovery_events' LIMIT 1"
    );
    if (!check.rows?.length) {
      console.log("[conference-images] discovery schema missing; skipping");
      return;
    }

    const rows = await db.execute({
      sql: `SELECT de.id, de.official_url, de.canonical_url, de.source_url, de.image_url,
                   ec.overview
              FROM discovery_events de
              LEFT JOIN extracted_conferences ec
                ON json_extract(ec.extraction_metadata, '$.discovery_event_id') = de.id
             WHERE de.status = 'published'
               AND de.publish_readiness = 'publish_ready'
               AND COALESCE(TRIM(de.image_url), '') = ''
               AND COALESCE(de.official_url, de.canonical_url, de.source_url) IS NOT NULL
             ORDER BY de.last_verified DESC, de.last_seen DESC
             LIMIT ?`,
      args: [limit],
    });

    const events = rows.rows || [];
    if (!events.length) {
      console.log("[conference-images] no published records need image enrichment");
      return;
    }

    let enriched = 0;
    let logoCount = 0;
    let bannerCount = 0;
    let missed = 0;

    await mapLimit(events, concurrency, async (row) => {
      const found = await bestImageFor(row);
      if (!found) {
        missed += 1;
        return;
      }

      await db.execute({
        sql: `UPDATE discovery_events
                 SET image_url = ?
               WHERE id = ? AND COALESCE(TRIM(image_url), '') = ''`,
        args: [found.imageUrl, row.id],
      });

      if (row.overview) {
        if (found.logoUrl) {
          await db.execute({
            sql: `UPDATE extracted_conferences
                     SET overview = json_set(
                       COALESCE(NULLIF(overview, ''), '{}'),
                       '$.image_url', ?,
                       '$.logo_url', ?,
                       '$.logo_source', 'stated'
                     ),
                         updated_at = datetime('now')
                   WHERE json_extract(extraction_metadata, '$.discovery_event_id') = ?`,
            args: [found.imageUrl, found.logoUrl, row.id],
          });
        } else {
          await db.execute({
            sql: `UPDATE extracted_conferences
                     SET overview = json_set(
                       COALESCE(NULLIF(overview, ''), '{}'),
                       '$.image_url', ?
                     ),
                         updated_at = datetime('now')
                   WHERE json_extract(extraction_metadata, '$.discovery_event_id') = ?`,
            args: [found.imageUrl, row.id],
          });
        }
      }

      enriched += 1;
      if (found.logoUrl) logoCount += 1;
      else bannerCount += 1;
    });

    console.log(
      `[conference-images] scanned=${events.length} enriched=${enriched} logos=${logoCount} banners=${bannerCount} missed=${missed}`
    );
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error("[conference-images] failed:", error?.stack || error);
  process.exitCode = 1;
});
