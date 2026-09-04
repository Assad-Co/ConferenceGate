import type { SourceType } from "./types";
import { normalizeTitle } from "./normalize";

export const SOURCE_CLASSIFICATIONS = [
  "official_event_site", "organizer_site", "society_site", "university_host_site",
  "venue_site", "directory", "news/article", "aggregator", "unknown",
] as const;
export type SourceClassification = (typeof SOURCE_CLASSIFICATIONS)[number];

const DIRECTORY_HOST = /(?:conferencealert|conferenceindex|allconferencealert|internationalconferencealerts|conferencealerts|conferencesked|10times|eventbrite|waset|mainevent)\./i;
const NEWS_PATH = /\/(?:news|article|blog|press|media)(?:\/|$)/i;
const EVENT_NAV = /\b(?:registration|register|programme|program|agenda|call for papers|submit|venue|speakers?)\b/gi;
const GENERIC_PATH = /\/(?:search|browse|listing|listings|categor(?:y|ies)|topics?|countries?|all-events?|all-conferences?|conference-list|event-list)(?:\/|$)/i;
const GENERIC_END_PATH = /\/(?:conferences|events|calendar|event-calendar|conference-calendar)\/?$/i;
const GENERIC_NESTED_PATH = /\/(?:conferences?|events?)\/[^/?#]*(?:conferences|events)(?:[-_/]|$)|\/(?:calendar[-_]?of[-_]?)?(?:conferences|events)(?:[-_](?:in|by|for|20\d\d)\b)/i;
const CALENDAR_PATH = /\/(?:[^/?#]*[-_])?(?:events?|conferences?)[-_]?calendar(?:\/|$)|\/(?:calendar)(?:\/|$)/i;
const GENERIC_TITLE = /\b(?:top|best|upcoming|must[- ]attend)\b.{0,60}\bconferences?\b|\bconferences?\b.{0,60}\b(?:radar|list|roundup|calendar)\b|\blist of\b.{0,40}\bconferences?\b/i;
const TRUSTED_OWNER_TYPES = new Set<SourceType>([
  "conference_organizer", "official_conference_site", "professional_society",
  "scientific_organization", "medical_society", "engineering_society",
  "professional_association", "university",
]);

/** A title that is itself a URL/path is extraction debris, never verified event identity. */
export function isPlausibleEventTitle(value: string | null | undefined): boolean {
  const title = String(value || "").trim();
  if (title.length < 4 || title.length > 300) return false;
  if (/^(?:https?:\/\/|www\.)\S+$/i.test(title)) return false;
  if (/^[a-z0-9.-]+\.(?:com|org|net|info|io|edu|gov)(?:\/\S*)?$/i.test(title)) return false;
  const tokens = normalizeTitle(title).split(/\s+/).filter(Boolean);
  return tokens.length >= 2 || (tokens.length === 1 && /^[a-z][a-z0-9-]{3,}$/i.test(tokens[0]));
}

/**
 * Symmetric Jaccard alone unfairly rejects an authoritative short title when the stored title
 * merely has a publisher/organisation suffix. This score also accepts strong containment, but
 * only after both sides have at least two meaningful title tokens.
 */
export function titleEvidenceScore(stored: string | null | undefined, evidence: string | null | undefined): number {
  if (!isPlausibleEventTitle(stored) || !isPlausibleEventTitle(evidence)) return 0;
  const a = new Set(normalizeTitle(String(stored)).split(/\s+/).filter(Boolean));
  const b = new Set(normalizeTitle(String(evidence)).split(/\s+/).filter(Boolean));
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  if (shared === 1 && a.size === 1 && b.size === 1) return 1;
  if (shared < 2) return 0;
  const jaccard = shared / (a.size + b.size - shared);
  const containment = shared / Math.min(a.size, b.size);
  return Math.max(jaccard, containment);
}

export function isAbsoluteHttpUrl(value: string | null | undefined): boolean {
  try { const url = new URL(value || ""); return url.protocol === "https:" || url.protocol === "http:"; }
  catch { return false; }
}

export function sourceAuthorityBlockReasons(input: {
  pageUrl: string; title?: string | null; organizerUrl?: string | null; registryType?: SourceType;
}): string[] {
  if (!isAbsoluteHttpUrl(input.pageUrl)) return ["official_url_not_absolute"];
  const url = new URL(input.pageUrl);
  const host = safeHost(input.pageUrl);
  const organizerOwned = safeHost(input.organizerUrl || "") === host || TRUSTED_OWNER_TYPES.has(input.registryType || "unknown");
  const reasons: string[] = [];
  if (DIRECTORY_HOST.test(host) || input.registryType === "conference_directory") reasons.push("directory_source");
  if (NEWS_PATH.test(url.pathname)) reasons.push("article_or_news_page");
  if (GENERIC_PATH.test(url.pathname) || GENERIC_END_PATH.test(url.pathname) || GENERIC_NESTED_PATH.test(url.pathname)) reasons.push("generic_collection_page");
  if (!isPlausibleEventTitle(input.title)) reasons.push("malformed_event_title");
  if (GENERIC_TITLE.test(input.title || "")) reasons.push("roundup_or_list_title");
  if (CALENDAR_PATH.test(url.pathname) && !organizerOwned) reasons.push("third_party_calendar");
  return [...new Set(reasons)];
}

export function classifySource(input: {
  pageUrl: string; officialUrl?: string | null; organizerUrl?: string | null;
  title?: string | null; organizer?: string | null; pageText?: string | null; registryType?: SourceType;
}): { classification: SourceClassification; confidence: number; evidence: string[] } {
  const host = safeHost(input.pageUrl);
  const evidence: string[] = [];
  const blockers = sourceAuthorityBlockReasons(input);
  if (blockers.includes("directory_source")) return { classification: "directory", confidence: 0.98, evidence: blockers };
  if (blockers.length) return { classification: blockers.includes("article_or_news_page") ? "news/article" : "aggregator", confidence: 0.92, evidence: blockers };
  const officialHost = safeHost(input.officialUrl || "");
  const organizerHost = safeHost(input.organizerUrl || "");
  const navSignals = new Set((input.pageText || "").match(EVENT_NAV) || []).size;
  const titleTokens = ((input.title || "").toLowerCase().match(/[a-z0-9]{4,}/g) || [])
    .filter((token) => !/^(?:conference|conferences|international|global|world|annual|event|events|summit|congress|forum|symposium|official|home|20\d\d)$/.test(token));
  const brandedHost = titleTokens.some((token) => host.includes(token));
  if (officialHost && officialHost === host && (brandedHost || navSignals >= 3)) {
    if (brandedHost) evidence.push("event branding matches domain");
    if (navSignals >= 3) evidence.push("event navigation includes registration/program/CFP signals");
    return { classification: "official_event_site", confidence: brandedHost && navSignals >= 3 ? 0.96 : 0.86, evidence };
  }
  if (organizerHost && organizerHost === host) return { classification: "organizer_site", confidence: 0.92, evidence: ["structured organizer URL matches source domain"] };
  if (["professional_society", "scientific_organization", "medical_society", "engineering_society", "professional_association"].includes(input.registryType || "")) {
    return { classification: "society_site", confidence: 0.9, evidence: ["trusted registry identifies a society"] };
  }
  if (input.registryType === "university") return { classification: "university_host_site", confidence: 0.9, evidence: ["trusted registry identifies a university"] };
  if (input.registryType === "conference_organizer" || input.registryType === "official_conference_site") {
    return { classification: input.registryType === "conference_organizer" ? "organizer_site" : "official_event_site", confidence: 0.9, evidence: ["trusted registry classification"] };
  }
  return { classification: "unknown", confidence: 0.35, evidence: ["insufficient ownership evidence"] };
}

function safeHost(value: string): string {
  // `host` rather than `hostname`: two origins that differ only by port are different sites, and
  // treating them as one made a listing's link to an event look like a self-reference.
  try { return new URL(value).host.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

export function isHighConfidenceOfficial(classification: SourceClassification, confidence: number): boolean {
  return confidence >= 0.8 && ["official_event_site", "organizer_site", "society_site", "university_host_site"].includes(classification);
}

export function isEligibleOfficialSource(input: {
  pageUrl: string; title?: string | null; organizerUrl?: string | null; registryType?: SourceType;
  classification: SourceClassification; confidence: number;
}): boolean {
  return isHighConfidenceOfficial(input.classification, input.confidence) && sourceAuthorityBlockReasons(input).length === 0;
}

