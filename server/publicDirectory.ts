import type { Express } from "express";
import { dbAll } from "./db";
import { renderPublicDirectory } from "./publicDirectoryPages.mjs";

export function mountPublicDirectory(app: Express) {
  // The home route still serves its landing template; legacy About URLs have one destination.
  app.get(["/about.html", "/about/index.html"], (_req, res) => res.redirect(301, "/about/"));
  let snapshot: ReturnType<typeof renderPublicDirectory> | undefined;
  let expires = 0;
  let refresh: Promise<void> | undefined;
  async function load() {
    try {
      const rows = await dbAll(`
        SELECT e.id,e.title,e.start_date,e.end_date,e.official_url,e.description,e.organizer,
          e.city,e.country,e.primary_category,e.last_verified,
          f.value AS deadline_value,f.source_url AS deadline_source,f.last_verified AS deadline_checked
        FROM discovery_events e
        LEFT JOIN discovery_event_fields f ON f.event_id=e.id AND f.field='abstract_deadline'
          AND f.confidence >= 0.8 AND EXISTS (
            SELECT 1 FROM discovery_event_sources s WHERE s.event_id=e.id
              AND s.source_url=f.source_url AND s.is_official=1 AND s.classification_confidence>=0.8
          )
        WHERE e.status='published' AND e.published_at IS NOT NULL
          AND e.publish_readiness='publish_ready' AND e.start_date IS NOT NULL
          AND EXISTS (SELECT 1 FROM discovery_event_sources s WHERE s.event_id=e.id
            AND s.is_official=1 AND s.classification_confidence>=0.8
            AND lower(rtrim(s.source_url,'/'))=lower(rtrim(e.official_url,'/')))
          AND NOT EXISTS (SELECT 1 FROM discovery_review_queue q WHERE q.status='open'
            AND (q.event_id=e.id OR q.candidate_event_id=e.id))
        ORDER BY CASE WHEN coalesce(nullif(e.end_date,''),e.start_date)>=date('now') THEN 0 ELSE 1 END,
          e.start_date,e.id
        LIMIT 1500
      `);
      snapshot = renderPublicDirectory(rows);
      expires = Date.now() + 5 * 60_000;
    } catch {
      snapshot ||= renderPublicDirectory();
      expires = Date.now() + 30_000;
      console.warn("[public-directory] Live catalogue refresh failed; serving fallback");
    }
  }
  app.get("/conferences", (req, res, next) => {
    if (req.path === "/conferences/") return next();
    res.redirect(301, "/conferences/");
  });
  app.get(["/conferences/", "/conferences/:page.html", "/sitemap.xml"], async (req, res, next) => {
    try {
      if (!snapshot || Date.now() >= expires) {
        refresh ||= load().finally(() => { refresh = undefined; });
        if (!snapshot) await refresh;
      }
      const body = snapshot?.files.get(req.path);
      if (!body) return res.status(404).type("text").send("Conference listing not found.");
      res.set("Cache-Control", "public, max-age=60");
      res.type(req.path.endsWith(".xml") ? "application/xml" : "html").send(body);
    } catch (error) { next(error); }
  });
}
