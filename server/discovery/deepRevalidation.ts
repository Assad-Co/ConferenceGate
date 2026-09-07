// Offline review plans; only SELECTs occur while a plan is built. No schema initializer,
// enrichment writer, publication function, or model is called from this module.
import crypto from "node:crypto";
import fs from "node:fs";
import { dbAll } from "../db";
import { DEEP_SECTIONS, extractDeepSections, findSectionPages, looksLikeUiText, type DeepSection } from "./deepSections";
import { DEEP_SECTION_STORAGE, serializeDeepSection } from "./deepEnrichment";
import { candidateUrlBelongsToEvent, eventIdentityFrom, pageBelongsToEvent, pageIdentityFrom, textIdentifiesEvent, type EventIdentity } from "./eventIdentity";

export const ACCEPTED = "status IN ('validated','published','needs_review')";
export const digest = (value: unknown) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function rulesDigest(): string {
  return digest(["deepRevalidation.ts", "deepCleanupScan.ts", "deepSections.ts", "eventIdentity.ts", "deepEnrichment.ts"].map(
    name => fs.readFileSync(new URL(name, import.meta.url), "utf8").replace(/\r\n/g, "\n")));
}
export type Row = Record<string, any>;
export type Reader = (url: string, signal?: AbortSignal) => Promise<{ url: string; html: string } | null>;
export interface StoredSnapshot { event: Row; fields: Row[]; published: Row[] }
export interface Item {
  path: string; kind: string; value: any; sourceUrl: string | null;
}
export interface Decision extends Item {
  verdict: "KEEP" | "REMOVE" | "REVIEW"; reason: string;
}
export interface Change {
  table: "discovery_events" | "extracted_conferences";
  key: string; section: DeepSection; before: string | null; after: string | null;
  decisions: Decision[]; fieldBefore: Row | null; sources: Record<string, string>;
  metadataBefore?: string;
  provenanceDecisions?: Decision[];
}
export interface EventPlan {
  id: string; title: string; identityHash: string; changes: Change[];
}
export interface Plan {
  version: 1; rules: string; createdAt: string; inventoryHash: string;
  events: EventPlan[]; summary: Row;
  inventoryIds?: string[];
}
export function identityHash(event: Row): string {
  return digest([event.id, event.title, event.acronym, event.start_year, event.start_date, event.official_url]);
}
export function parse(raw: any): any {
  if (typeof raw !== "string") return raw;
  try { return JSON.parse(raw); } catch { return raw; }
}
const meaningful = (v: any): boolean => v !== null && v !== undefined && v !== "" &&
  (!Array.isArray(v) || v.length > 0);
export const manual = (v: any): boolean => !!v && typeof v === "object" &&
  (/manual|app.crawl|user|organizer/i.test(String(v.origin || v.extraction_method || "")) || v.manually_edited === true);

/** Enumerate every stored value, including unknown legacy keys. Unknown shapes cannot hide. */
export function items(section: DeepSection, raw: any, fallback: string | null = null): Item[] {
  const value = parse(raw);
  if (!meaningful(value)) return [];
  const source = value?.source_url || fallback;
  if (["speakers", "committee", "sponsors"].includes(section) && Array.isArray(value)) {
    return value.map((v, i) => ({ path: String(i), kind: "entry", value: v, sourceUrl: v?.source_url || fallback }));
  }
  const arrays = section === "program" ? ["sessions", "tracks", "important_dates"] : ["social_media"];
  const scalars = section === "community" ? ["hashtag", "contact_email"] : [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [{ path: "$", kind: "unknown", value, sourceUrl: fallback }];
  }
  const out: Item[] = [];
  for (const [key, nested] of Object.entries(value)) {
    if (["source_url", "item_sources"].includes(key) || !meaningful(nested)) continue;
    if (arrays.includes(key) && Array.isArray(nested)) {
      nested.forEach((v, i) => out.push({ path: `${key}.${i}`, kind: key, value: v,
        sourceUrl: v?.source_url || value.item_sources?.[`${key}.${i}`] || source }));
    } else {
      out.push({ path: key, kind: scalars.includes(key) ? key : "unknown", value: nested,
        sourceUrl: value.item_sources?.[key] || source });
    }
  }
  return out;
}
const norm = (v: any): string => typeof v === "string" ? v.replace(/\s+/g, " ").trim().toLowerCase() : JSON.stringify(v);
function supported(old: any, fresh: any): boolean {
  if (old && typeof old === "object") {
    if (!fresh || typeof fresh !== "object") return false;
    return Object.entries(old).every(([key, v]) => key === "source_url" || !meaningful(v) ||
      (Object.hasOwn(fresh, key) && supported(v, fresh[key])));
  }
  return norm(old) === norm(fresh);
}
function itemKey(item: Item): string {
  return `${item.kind}:${norm(item.value?.name || item.value?.title || item.value?.url || item.value)}`;
}
/** Extra boundaries needed when revalidating arbitrary historical URLs rather than same-domain links. */
export function strictUrl(identity: EventIdentity, url: string): string | null {
  try {
    const target = new URL(url), official = new URL(identity.officialUrl);
    if (!/^https?:$/.test(target.protocol) || target.username || target.password ||
        target.hostname.replace(/^www\./, "") !== official.hostname.replace(/^www\./, "") || target.port !== official.port) return "not_official_event_host";
    const years = decodeURIComponent(target.pathname).match(/\b20\d\d\b/g)?.map(Number) || [];
    if (identity.year && years.some(y => y !== identity.year)) return "wrong_year_in_source_url";
    const verdict = candidateUrlBelongsToEvent(identity, url);
    return verdict.ok ? null : verdict.reason;
  } catch { return "invalid_source_url"; }
}
function strictPage(identity: EventIdentity, url: string, html: string): boolean {
  const page = pageIdentityFrom(html);
  if (identity.year && page.years.some(y => y !== identity.year)) return false;
  if (page.heading && /\b(conference|congress|symposium|summit|annual meeting)\b/i.test(page.heading) &&
      !textIdentifiesEvent(identity, page.heading) && page.heading.split(/\s+/).length >= 4) return false;
  return pageBelongsToEvent(identity, url, html).ok;
}
export const needsChange = (c: Change): boolean => c.before !== c.after ||
  (c.table === "discovery_events" && !!c.fieldBefore && c.fieldBefore.value !== c.after);
export function rebuild(section: DeepSection, kept: Item[]): string | null {
  if (!kept.length) return null;
  if (["speakers", "committee", "sponsors"].includes(section)) {
    return JSON.stringify(kept.map(item => ({ ...item.value, source_url: item.sourceUrl })));
  }
  const out: Row = section === "program" ? { sessions: [], tracks: [], important_dates: [] } :
    { social_media: [], hashtag: null, contact_email: null };
  out.source_url = kept[0].sourceUrl;
  out.item_sources = {};
  for (const item of kept) {
    if (item.kind === "unknown") continue;
    let path = item.kind;
    if (Array.isArray(out[item.kind])) {
      path += `.${out[item.kind].length}`;
      out[item.kind].push(item.value && typeof item.value === "object" ?
        { ...item.value, source_url: item.sourceUrl } : item.value);
    } else out[item.kind] = item.value;
    out.item_sources[path] = item.sourceUrl;
  }
  return JSON.stringify(out);
}

export async function validateSection(section: DeepSection, raw: any, fallback: string | null,
  identity: EventIdentity | null, read: Reader): Promise<Decision[]> {
  const cache = new Map<string, Promise<{ error: string | null; fresh: Item[] }>>();
  const evidence = (url: string) => {
    if (!cache.has(url)) cache.set(url, (async () => {
      const page = await read(url);
      if (!page) return { error: "source_unreadable", fresh: [] };
      const error = strictUrl(identity!, page.url);
      if (error) return { error, fresh: [] };
      const verdict = pageBelongsToEvent(identity!, page.url, page.html);
      if (!verdict.ok) return { error: verdict.reason, fresh: [] };
      if (!strictPage(identity!, page.url, page.html)) return { error: "conflicting_page_identity_or_year", fresh: [] };
      return { error: null, fresh: items(section,
        serializeDeepSection(section, extractDeepSections(page.html, page.url)), page.url) };
    })());
    return cache.get(url)!;
  };
  const decisions: Decision[] = [];
  for (const item of items(section, raw, fallback)) {
    let reason: string | null = null;
    let verdict: Decision["verdict"] = "REMOVE";
    if (manual(item.value)) { reason = "manual_item_protected"; verdict = "REVIEW"; }
    else if (item.kind === "unknown") { reason = "unknown_legacy_shape"; verdict = "REVIEW"; }
    else if (!identity || !identity.year) { reason = "missing_event_identity_or_year"; verdict = "REVIEW"; }
    else if (!item.sourceUrl) { reason = "missing_exact_provenance"; verdict = "REVIEW"; }
    else if (looksLikeUiText(item.value?.name || item.value?.title || "" ) ||
      /^(coffee break|lunch break|live webinars|premium profile|contact us today)$/i.test(String(item.value?.title || item.value?.name || ""))) reason = "generic_navigation_or_marketing";
    else if ((reason = strictUrl(identity, item.sourceUrl))) { /* reject before fetch */ }
    else {
      const result = await evidence(item.sourceUrl);
      reason = result.error;
      if (reason === "source_unreadable") verdict = "REVIEW";
      if (!reason) {
        const match = result.fresh.some(f => f.kind === item.kind && supported(item.value, f.value));
        verdict = match ? "KEEP" : "REMOVE";
        reason = match ? "current_identity_and_item_rules_pass" : "not_supported_by_current_precision_extraction";
      }
    }
    decisions.push({ ...item, verdict, reason: reason! });
  }
  return decisions;
}

/** Reuse settled decisions verbatim; only pending REVIEW items reach the unchanged validator. */
async function verifyReviews(section: DeepSection, previous: Decision[], identity: EventIdentity | null, read: Reader): Promise<Decision[]> {
  const results: Decision[] = [];
  for (const item of previous) {
    if (item.verdict !== "REVIEW") { results.push({ ...item }); continue; }
    const payload = item.kind === "entry" ? [item.value] : item.kind === "unknown" ?
      (item.path === "$" ? item.value : { [item.path]: item.value }) :
      { [item.kind]: ["hashtag", "contact_email"].includes(item.kind) ? item.value : [item.value], source_url: item.sourceUrl };
    const verified = await validateSection(section, payload, item.sourceUrl, identity, read);
    const decision = verified[0];
    results.push(decision ? { ...decision, path: item.path, kind: item.kind, value: item.value, sourceUrl: item.sourceUrl } : item);
  }
  return results;
}

/** Includes all accepted IDs, even those with no deep data, with keyset pagination. */
export async function acceptedIds(): Promise<string[]> {
  const ids: string[] = [];
  let cursor = "";
  for (;;) {
    const rows = await dbAll<Row>(`SELECT id FROM discovery_events WHERE ${ACCEPTED} AND id>? ORDER BY id LIMIT 100`, [cursor]);
    if (!rows.length) return ids;
    ids.push(...rows.map(r => String(r.id))); cursor = ids.at(-1)!;
  }
}

export async function buildPlan(read: Reader, options: { batchSize?: number; maxRefillPages?: number;
  snapshots?: StoredSnapshot[];
  reviewEvent?: EventPlan;
  progress?: (scanned: number, total: number) => void } = {}): Promise<Plan> {
  const ids = options.snapshots ? options.snapshots.map(s => String(s.event.id)) : await acceptedIds();
  const summary: Row = { acceptedScanned: 0, conferencesWithDeepData: 0, itemsScanned: 0,
    KEEP: 0, REMOVE: 0, REVIEW: 0, affectedConferences: 0, protected: [], representativeRemovals: [], refillItems: 0, aiCalls: 0,
    sections: Object.fromEntries(DEEP_SECTIONS.map(s => [s, { scanned: 0, KEEP: 0, REMOVE: 0, REVIEW: 0 }])) };
  const plan: Plan = { version: 1, rules: rulesDigest(), createdAt: new Date().toISOString(),
    inventoryHash: digest(ids), events: [], summary };
  const batchSize = Math.max(1, Math.min(options.batchSize || 50, 100));
  const hasPublished = options.snapshots ? false : (await dbAll("SELECT name FROM sqlite_master WHERE type='table' AND name='extracted_conferences'")).length > 0;
  for (let offset = 0; offset < ids.length; offset += batchSize) {
    const batch = ids.slice(offset, offset + batchSize);
    const rows = options.snapshots ? options.snapshots.slice(offset, offset + batchSize).map(s => s.event) :
      await dbAll<Row>(`SELECT * FROM discovery_events WHERE ${ACCEPTED} AND id IN (${batch.map(() => "?")}) ORDER BY id`, batch);
    if (rows.length !== batch.length) throw new Error("Accepted inventory changed during dry-run; retry.");
    for (const event of rows) {
      const snapshot = options.snapshots?.find(s => s.event.id === event.id);
      const fields = snapshot ? snapshot.fields : await dbAll<Row>("SELECT * FROM discovery_event_fields WHERE event_id=?", [event.id]);
      const published = snapshot ? snapshot.published : hasPublished ? await dbAll<Row>(`SELECT * FROM extracted_conferences
        WHERE json_valid(extraction_metadata) AND json_extract(extraction_metadata,'$.origin')='discovery_engine'
        AND json_extract(extraction_metadata,'$.discovery_event_id')=?`, [event.id]) : [];
      const record: EventPlan = { id: event.id, title: event.title, identityHash: identityHash(event), changes: [] };
      const identity = eventIdentityFrom(event);
      if (identity && /(^|\.)(emedevents\.com|eventbrite\.[a-z.]+|10times\.com|conferencealerts\.com)$/i.test(new URL(identity.officialUrl).hostname) && !identity.sharedHost) {
        // A platform root never identifies an individual event.
        identity.sharedHost = true; identity.pathPrefix = "/__individual_event_required__/";
      }
      const pageCache = new Map<string, Promise<Awaited<ReturnType<Reader>>>>();
      const cached: Reader = url => {
        if (!pageCache.has(url)) pageCache.set(url, read(url));
        return pageCache.get(url)!;
      };
      let hasData = false;
      for (const section of DEEP_SECTIONS) {
        const { column, field } = DEEP_SECTION_STORAGE[section];
        const provenance = fields.find(f => f.field === field) || null;
        const targets: Array<{ table: Change["table"]; row: Row; key: string }> = [
          { table: "discovery_events", row: event, key: event.id },
          ...published.map(row => ({ table: "extracted_conferences" as const, row, key: row.source_url })),
        ];
        for (const target of targets) {
          const before = target.row[column] ?? null;
          if (items(section, before).length) hasData = true;
          // Manual provenance takes precedence over the row-level discovery origin.
          if (manual(provenance) || manual(parse(before)) || manual(parse(target.row.extraction_metadata))) {
            summary.protected.push({ eventId: event.id, title: event.title, section, table: target.table, reason: "manual_provenance" }); continue;
          }
          // Divergent published data has no reliable field-level ownership. Never infer that a
          // manual edit belongs to discovery merely from metadata on the containing record.
          if (target.table === "extracted_conferences" && items(section, before).length &&
              digest(parse(before)) !== digest(parse(event[column])) && digest(parse(before)) !== digest(parse(provenance?.value ?? null))) {
            const unresolved = items(section, before, provenance?.source_url || null).map(item => ({ ...item, verdict: "REVIEW", reason: "published_field_ownership_unresolved" }));
            for (const d of unresolved) { summary.itemsScanned++; summary.REVIEW++; summary.sections[section].scanned++; summary.sections[section].REVIEW++; }
            summary.protected.push({ eventId: event.id, title: event.title, section, table: target.table,
              sourceUrl: target.key, reason: "published_field_ownership_unresolved", decisions: unresolved }); continue;
          }
          const previous = options.reviewEvent?.changes.find(c => c.table === target.table && c.key === target.key && c.section === section);
          if (options.reviewEvent && !previous) throw new Error(`Target absent from REVIEW plan: ${event.id}/${section}; create a fresh stored-only plan.`);
          const decisions = previous ? await verifyReviews(section, previous.decisions, identity, cached) :
            await validateSection(section, before, provenance?.source_url || null, identity, cached);
          const provenanceDecisions = previous ? await verifyReviews(section, previous.provenanceDecisions || [], identity, cached) :
            target.table === "discovery_events" && provenance && provenance.value !== before ?
              await validateSection(section, provenance.value, provenance.source_url, identity, cached) : [];
          for (const d of [...decisions, ...provenanceDecisions]) {
            summary.itemsScanned++; summary[d.verdict]++; summary.sections[section].scanned++; summary.sections[section][d.verdict]++;
            if (d.verdict !== "KEEP" && summary.representativeRemovals.length < 30) summary.representativeRemovals.push({
              eventId: event.id, title: event.title, section, table: target.table, ...d });
          }
          // A mixed manual/engine section is protected as a unit; a later manual resolver may
          // split it safely. It must be visible as an exception to any cleanliness claim.
          if ([...decisions, ...provenanceDecisions].some(d => d.reason === "manual_item_protected")) {
            summary.protected.push({ eventId: event.id, title: event.title, section, reason: "mixed_manual_items", decisions }); continue;
          }
          let kept: Item[] = decisions.filter(d => d.verdict === "KEEP");
          const rejected = new Set(decisions.filter(d => d.verdict !== "KEEP").map(itemKey));
          if (!kept.length && identity?.year && (options.maxRefillPages ?? 0) > 0) {
            const official = await cached(identity.officialUrl);
            if (official && !strictUrl(identity, official.url) && strictPage(identity, official.url, official.html)) {
              const pages = [official.url, ...findSectionPages(official.html, official.url, { sections: [section], perSection: 2 }).map(p => p.url)]
                .slice(0, Math.min(options.maxRefillPages ?? 4, 10));
              for (const url of [...new Set(pages)]) {
                if (strictUrl(identity, url)) continue;
                const page = await cached(url);
                if (!page || strictUrl(identity, page.url) || !strictPage(identity, page.url, page.html)) continue;
                const fresh = serializeDeepSection(section, extractDeepSections(page.html, page.url));
                const validated = await validateSection(section, fresh, page.url, identity, cached);
                for (const item of validated.filter(d => d.verdict === "KEEP" && !rejected.has(itemKey(d)))) {
                  if (!kept.some(k => itemKey(k) === itemKey(item))) { kept.push(item); summary.refillItems++; }
                }
              }
            }
          }
          let after = rebuild(section, kept);
          if (after === null && target.table === "extracted_conferences") {
            after = section === "program" ? '{"sessions":[]}' : section === "community" ? '{"social_media":[]}' : "[]";
          }
          // No change is needed for a genuinely empty representation or already exact payload.
          if (!decisions.length && !kept.length) after = before;
          const sources = Object.fromEntries(items(section, after).filter(i => i.sourceUrl).map(i => [i.path, i.sourceUrl!]));
          record.changes.push({ table: target.table, key: target.key, section, before, after, decisions,
            provenanceDecisions,
            fieldBefore: target.table === "discovery_events" ? provenance : null, sources,
            ...(target.table === "extracted_conferences" ? { metadataBefore: target.row.extraction_metadata } : {}) });
        }
      }
      summary.acceptedScanned++; if (hasData) summary.conferencesWithDeepData++;
      if (record.changes.some(needsChange)) summary.affectedConferences++;
      plan.events.push(record);
      options.progress?.(summary.acceptedScanned, ids.length);
    }
  }
  if (!options.snapshots && digest(await acceptedIds()) !== plan.inventoryHash) throw new Error("Accepted inventory changed during dry-run; retry.");
  summary.cleanlinessCanBeCertified = summary.protected.length === 0;
  summary.protectedConferenceCount = new Set(summary.protected.map((p: Row) => p.eventId)).size;
  return plan;
}
