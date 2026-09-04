import type { SourceType } from "./types";

export const SOURCE_CLASSIFICATIONS = [
  "official_event_site", "organizer_site", "society_site", "university_host_site",
  "venue_site", "directory", "news/article", "aggregator", "unknown",
] as const;
export type SourceClassification = (typeof SOURCE_CLASSIFICATIONS)[number];

const DIRECTORY_HOST = /(?:conferencealert|conferenceindex|allconferencealert|internationalconferencealerts|conferencealerts|10times|eventbrite|waset|mainevent)\./i;
const NEWS_PATH = /\/(?:news|article|blog|press|media)(?:\/|$)/i;
const EVENT_NAV = /\b(?:registration|register|programme|program|agenda|call for papers|submit|venue|speakers?)\b/gi;
const GENERIC_PATH = /\/(?:search|browse|listing|listings|categor(?:y|ies)|topics?|countries?|all-events?|all-conferences?|conference-list|event-list)(?:\/|$)/i;
const GENERIC_END_PATH = /\/(?:conferences|events|calendar|event-calendar|conference-calendar)\/?$/i;
const CALENDAR_PATH = /\/(?:[^/?#]*[-_])?(?:events?|conferences?)[-_]?calendar(?:\/|$)|\/(?:calendar)(?:\/|$)/i;
const GENERIC_TITLE = /\b(?:top|best|upcoming|must[- ]attend)\b.{0,60}\bconferences?\b|\bconferences?\b.{0,60}\b(?:radar|list|roundup|calendar)\b|\blist of\b.{0,40}\bconferences?\b/i;
const TRUSTED_OWNER_TYPES = new Set<SourceType>([
  "conference_organizer", "official_conference_site", "professional_society",
  "scientific_organization", "medical_society", "engineering_society",
  "professional_association", "university",
]);

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
  if (GENERIC_PATH.test(url.pathname) || GENERIC_END_PATH.test(url.pathname)) reasons.push("generic_collection_page");
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
