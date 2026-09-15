import { createClient } from "@libsql/client";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const FILE = path.join(process.cwd(), "data", "apify-stage7-validated-2026-09-14.json");

function stableId(prefix, value) {
  return `${prefix}_${createHash("sha1").update(String(value || "")).digest("hex").slice(0, 24)}`;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function formatValue(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "in-person" || normalized === "in person") return "in-person";
  if (normalized === "hybrid") return "hybrid";
  if (normalized === "online") return "online";
  return normalized || null;
}

async function tableExists(db, table) {
  const result = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1`,
    args: [table],
  });
  return Boolean(result.rows?.length);
}

async function upsertField(db, { eventId, field, value, sourceUrl, sourceDomain, confidence, now }) {
  if (value == null || String(value).trim() === "") return;
  const fieldId = stableId("apify_fld", `${eventId}|${field}`);
  await db.execute({
    sql: `INSERT INTO discovery_event_fields
      (id,event_id,field,value,source_url,source_domain,extraction_method,confidence,last_verified)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(event_id,field) DO UPDATE SET
        value=excluded.value,
        source_url=excluded.source_url,
        source_domain=excluded.source_domain,
        extraction_method=excluded.extraction_method,
        confidence=MAX(discovery_event_fields.confidence,excluded.confidence),
        last_verified=excluded.last_verified`,
    args: [fieldId, eventId, field, String(value), sourceUrl, sourceDomain, "apify_stage7", confidence, now],
  });
}

async function main() {
  if (!fs.existsSync(FILE)) {
    console.log("[apify-evidence] no Stage 7 seed file; skipping");
    return;
  }

  const payload = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const records = Array.isArray(payload?.records) ? payload.records : [];
  const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
  const tursoToken = process.env.TURSO_AUTH_TOKEN?.trim();
  const localPath = path.join(process.cwd(), "data", "app.db");
  fs.mkdirSync(path.dirname(localPath), { recursive: true });

  const db = tursoUrl
    ? createClient({ url: tursoUrl, authToken: tursoToken || undefined })
    : createClient({ url: `file:${localPath}` });

  try {
    if (!(await tableExists(db, "discovery_events")) ||
        !(await tableExists(db, "discovery_event_sources")) ||
        !(await tableExists(db, "discovery_event_fields"))) {
      console.log("[apify-evidence] discovery schema not initialized; skipping");
      return;
    }

    let repaired = 0;
    let missingEvents = 0;

    for (const record of records) {
      if (record.validation_status !== "VALIDATED") continue;
      const sourceUrl = record.official_url || record.source_page_url;
      if (!sourceUrl || !record.conference_name || !record.start_date) continue;

      const eventId = stableId(
        "apify",
        `${sourceUrl}|${record.conference_name}|${record.start_date}`
      );
      const eventCheck = await db.execute({
        sql: `SELECT id FROM discovery_events WHERE id=? LIMIT 1`,
        args: [eventId],
      });
      if (!eventCheck.rows?.length) {
        missingEvents += 1;
        continue;
      }

      const sourceDomain = hostOf(sourceUrl);
      const confidence = Math.max(0.8, Math.min(0.99, Number(record.validation_score || 0) / 100));
      const now = new Date().toISOString();
      const sourceId = stableId("apify_src", `${eventId}|${sourceUrl}`);

      await db.execute({
        sql: `INSERT INTO discovery_event_sources
          (id,event_id,source_url,source_domain,source_type,source_classification,
           classification_confidence,classification_evidence,provider,trust_score,
           extraction_method,confidence,is_official,raw_extraction,first_seen,last_verified)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(event_id,source_url) DO UPDATE SET
            source_domain=excluded.source_domain,
            source_type=excluded.source_type,
            source_classification=excluded.source_classification,
            classification_confidence=MAX(discovery_event_sources.classification_confidence,excluded.classification_confidence),
            classification_evidence=excluded.classification_evidence,
            provider=excluded.provider,
            trust_score=MAX(discovery_event_sources.trust_score,excluded.trust_score),
            extraction_method=excluded.extraction_method,
            confidence=MAX(discovery_event_sources.confidence,excluded.confidence),
            is_official=1,
            raw_extraction=excluded.raw_extraction,
            last_verified=excluded.last_verified`,
        args: [
          sourceId,
          eventId,
          sourceUrl,
          sourceDomain,
          "official_website",
          "official_event_site",
          confidence,
          JSON.stringify(["Apify Stage 7 validated official conference source"]),
          "apify",
          confidence,
          "apify_stage7",
          confidence,
          1,
          JSON.stringify({
            title: record.conference_name,
            startDate: record.start_date,
            endDate: record.end_date || null,
            city: record.city || null,
            country: record.country || null,
            venue: record.venue || null,
            format: formatValue(record.format),
            officialUrl: sourceUrl,
            validationScore: record.validation_score,
          }),
          now,
          now,
        ],
      });

      const common = { eventId, sourceUrl, sourceDomain, confidence, now };
      await upsertField(db, { ...common, field: "title", value: record.conference_name });
      await upsertField(db, { ...common, field: "startDate", value: record.start_date });
      await upsertField(db, { ...common, field: "endDate", value: record.end_date });
      await upsertField(db, { ...common, field: "country", value: record.country });
      await upsertField(db, { ...common, field: "city", value: record.city });
      await upsertField(db, { ...common, field: "venue", value: record.venue });
      await upsertField(db, { ...common, field: "format", value: formatValue(record.format) });
      await upsertField(db, { ...common, field: "officialUrl", value: sourceUrl });

      await db.execute({
        sql: `UPDATE discovery_events
              SET status='published',
                  publish_readiness='publish_ready',
                  readiness_reasons='[]',
                  official_source_verified_at=?,
                  title_verified_at=?,
                  last_verified=?,
                  last_checked=?
              WHERE id=?`,
        args: [now, now, now, now, eventId],
      });

      repaired += 1;
    }

    console.log(
      `[apify-evidence] target=${tursoUrl ? "Turso" : "local SQLite"} repaired=${repaired} missing_events=${missingEvents}`
    );
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error("[apify-evidence] failed; ConferenceGate will still start:", error?.stack || error?.message || error);
  process.exitCode = 0;
});
