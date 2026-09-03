import type { SourceType } from "./types";

export const SOURCE_CLASSIFICATIONS = [
  "official_event_site", "organizer_site", "society_site", "university_host_site",
  "venue_site", "directory", "news/article", "aggregator", "unknown",
] as const;
export type SourceClassification = (typeof SOURCE_CLASSIFICATIONS)[number];

const DIRECTORY_HOST = /(?:conferencealert|conferenceindex|allconferencealert|internationalconferencealerts|conferencealerts|10times|eventbrite|waset)\./i;
const NEWS_PATH = /\/(?:news|article|blog|press|media)(?:\/|$)/i;
const EVENT_NAV = /\b(?:registration|register|programme|program|agenda|call for papers|submit|venue|speakers?)\b/gi;

export function classifySource(input: {
  pageUrl: string; officialUrl?: string | null; organizerUrl?: string | null;
  title?: string | null; organizer?: string | null; pageText?: string | null; registryType?: SourceType;
}): { classification: SourceClassification; confidence: number; evidence: string[] } {
  const host = safeHost(input.pageUrl);
  const evidence: string[] = [];
  if (DIRECTORY_HOST.test(host) || input.registryType === "conference_directory") {
    return { classification: "directory", confidence: 0.98, evidence: ["known conference-directory domain/type"] };
  }
  if (NEWS_PATH.test(new URL(input.pageUrl).pathname)) {
    return { classification: "news/article", confidence: 0.92, evidence: ["news/article URL path"] };
  }
  const officialHost = safeHost(input.officialUrl || "");
  const organizerHost = safeHost(input.organizerUrl || "");
  const navSignals = new Set((input.pageText || "").match(EVENT_NAV) || []).size;
  const titleTokens = (input.title || "").toLowerCase().match(/[a-z0-9]{4,}/g) || [];
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
