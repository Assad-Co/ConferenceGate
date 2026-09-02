// Is this page a professional or academic conference Conference Gate should carry?
//
// Most of what a crawl reaches is not: a news post about a conference, a listing of twelve of
// them, a concert at the same venue, last year's event still sitting at its old URL. This decides,
// deterministically and with its reasoning attached, so a rejection can always be explained.
//
// Deliberately scored rather than boolean. The evidence a page gives varies enormously — a
// schema.org ConferenceEvent with dates and a venue is not the same kind of certainty as a page
// whose title merely contains the word "summit" — and the confidence that comes out of here is
// what decides whether the record is published, held for review, or dropped (section 44).

import type { EventFormat, EventType, RelevanceVerdict } from "./types";

/** Things Conference Gate carries. */
const PROFESSIONAL_SIGNALS: Array<{ re: RegExp; weight: number; label: string }> = [
  { re: /\b(?:call\s+for\s+(?:papers?|abstracts?|proposals?)|cfp)\b/i, weight: 0.3, label: "calls for papers" },
  { re: /\b(?:keynote|plenary|invited)\s+(?:speakers?|lectures?|sessions?)\b/i, weight: 0.22, label: "names keynote or plenary sessions" },
  { re: /\b(?:abstract|paper|manuscript)\s+submissions?\b/i, weight: 0.22, label: "invites submissions" },
  { re: /\b(?:scientific|technical|organi[sz]ing|programme?|steering)\s+committee\b/i, weight: 0.22, label: "has a scientific or organising committee" },
  { re: /\b(?:peer[\s-]?review(?:ed)?|proceedings|conference\s+proceedings)\b/i, weight: 0.2, label: "mentions peer review or proceedings" },
  { re: /\b(?:registration\s+(?:fees?|opens?|is\s+open)|early[\s-]?bird)\b/i, weight: 0.15, label: "publishes registration details" },
  { re: /\b(?:delegates?|attendees?|participants?|exhibitors?|sponsors?)\b/i, weight: 0.1, label: "addresses delegates or exhibitors" },
  { re: /\b(?:workshops?|tutorials?|tracks?|sessions?|poster\s+sessions?)\b/i, weight: 0.1, label: "describes sessions or tracks" },
  { re: /\b(?:cpd|cme|continuing\s+(?:professional\s+development|medical\s+education)|accredited)\b/i, weight: 0.15, label: "offers professional development credit" },
  { re: /\b(?:researchers?|academics?|professionals?|practitioners?|clinicians?|engineers?|scientists?)\b/i, weight: 0.1, label: "addresses a professional audience" },
];

/** Things Conference Gate does not carry (section 9). */
const EXCLUSION_SIGNALS: Array<{ re: RegExp; weight: number; label: string }> = [
  { re: /\b(?:concert|gig|live\s+music|tour\s+dates?|album\s+launch|music\s+festival|dj\s+set|lineup\s+announced)\b/i, weight: 0.55, label: "reads as a concert or music event" },
  { re: /\b(?:match|fixture|kick[\s-]?off|tournament\s+(?:draw|bracket)|league\s+table|grand\s+prix|championship\s+final)\b/i, weight: 0.5, label: "reads as a sports fixture" },
  { re: /\b(?:box\s+office|screening|film\s+festival|cinema|movie\s+times|showtimes)\b/i, weight: 0.5, label: "reads as a cinema or screening listing" },
  { re: /\b(?:wedding|birthday\s+party|bar\s+mitzvah|private\s+(?:party|function)|hen\s+(?:do|party))\b/i, weight: 0.6, label: "reads as a private celebration" },
  { re: /\b(?:nightclub|club\s+night|happy\s+hour|bar\s+crawl|tasting\s+menu|restaurant\s+week|brunch)\b/i, weight: 0.5, label: "reads as nightlife or hospitality" },
  { re: /\b(?:garage\s+sale|car\s+boot|craft\s+fair|farmers?\s+market|open\s+day\s+for\s+families)\b/i, weight: 0.4, label: "reads as a consumer-only local event" },
];

/** Pages that are about many conferences rather than being one. */
const LISTING_SIGNALS: Array<{ re: RegExp; weight: number; label: string }> = [
  { re: /\b(?:top|best|every|all|upcoming|leading|must[\s-]?attend)\b[^.]{0,50}\b(?:conferences|events|summits|congresses|symposia)\b/i, weight: 0.45, label: "reads as a roundup of many events" },
  { re: /\b(?:conference|event)\s+(?:calendar|directory|listings?|database|index)\b/i, weight: 0.45, label: "reads as a directory or calendar" },
  { re: /\b(?:browse|search|filter)\s+(?:hundreds|thousands|all|upcoming)\b/i, weight: 0.35, label: "offers a search over many events" },
  { re: /\b\d{2,}\s+(?:conferences|events|results)\s+found\b/i, weight: 0.5, label: "reports a result count" },
];

/** Pages about a conference rather than being the conference's own page. */
const ABOUT_NOT_THE_EVENT: Array<{ re: RegExp; weight: number; label: string }> = [
  { re: /\b(?:published|posted)\s+(?:on|at)\b/i, weight: 0.15, label: "reads as a dated article" },
  { re: /\b(?:read\s+more|share\s+this\s+(?:article|post)|related\s+articles?)\b/i, weight: 0.15, label: "reads as a news article" },
  { re: /\b(?:took\s+place|was\s+held|concluded|thank\s+you\s+(?:to\s+)?(?:all\s+)?(?:for\s+)?(?:attending|everyone))\b/i, weight: 0.3, label: "describes an event in the past tense" },
];

export interface RelevanceInput {
  title: string | null;
  description: string | null;
  /** Readable page text; the strongest evidence there is. */
  pageText: string;
  url: string;
  schemaType: string | null;
  eventType: EventType;
  format: EventFormat;
  hasDate: boolean;
  hasLocation: boolean;
  /** schema.org types on the page that are events but not professional ones. */
  nonProfessionalSchemaTypes?: string[];
}

export function classifyRelevance(input: RelevanceInput): RelevanceVerdict {
  const haystack = `${input.title || ""} ${input.description || ""} ${input.pageText}`.slice(0, 30000);
  const titleAndUrl = `${input.title || ""} ${input.url}`;

  let score = 0;
  const positives: string[] = [];
  const negatives: string[] = [];

  // The event's own type is the base signal. A webinar is genuinely relevant but weaker evidence
  // of a professional conference than a congress is.
  const TYPE_WEIGHT: Partial<Record<EventType, number>> = {
    conference: 0.4, congress: 0.4, symposium: 0.4, summit: 0.35, convention: 0.3,
    exhibition: 0.25, expo: 0.25, workshop: 0.25, forum: 0.25, professional_meeting: 0.25,
    continuing_professional_development: 0.3, seminar: 0.2, webinar: 0.15, other: 0,
  };
  const typeWeight = TYPE_WEIGHT[input.eventType] ?? 0;
  if (typeWeight > 0) {
    score += typeWeight;
    positives.push(`identified as a ${input.eventType.replace(/_/g, " ")}`);
  }

  // schema.org ConferenceEvent/BusinessEvent is the organiser saying so in machine-readable form.
  if (input.schemaType && /conference|business|education|exhibition/i.test(input.schemaType)) {
    score += 0.25;
    positives.push(`published as schema.org ${input.schemaType}`);
  }

  for (const signal of PROFESSIONAL_SIGNALS) {
    if (signal.re.test(haystack)) {
      score += signal.weight;
      positives.push(signal.label);
    }
  }

  for (const signal of EXCLUSION_SIGNALS) {
    if (signal.re.test(haystack)) {
      score -= signal.weight;
      negatives.push(signal.label);
    }
  }
  for (const signal of LISTING_SIGNALS) {
    // Listing wording in a title or URL is far stronger evidence than the same words buried in a
    // page's footer links.
    if (signal.re.test(titleAndUrl)) {
      score -= signal.weight;
      negatives.push(`${signal.label} (in title or URL)`);
    } else if (signal.re.test(haystack)) {
      score -= signal.weight * 0.4;
      negatives.push(signal.label);
    }
  }
  for (const signal of ABOUT_NOT_THE_EVENT) {
    if (signal.re.test(haystack)) {
      score -= signal.weight;
      negatives.push(signal.label);
    }
  }

  for (const type of input.nonProfessionalSchemaTypes || []) {
    score -= 0.35;
    negatives.push(`page publishes a schema.org ${type}`);
  }

  // Having a date and a place is what separates an event page from an "about our conferences"
  // page. It is evidence, not a requirement.
  if (input.hasDate) {
    score += 0.15;
    positives.push("states dates");
  }
  if (input.hasLocation) {
    score += 0.1;
    positives.push("states a location");
  }
  if (!input.hasDate && !input.hasLocation) {
    score -= 0.2;
    negatives.push("states neither dates nor a location");
  }

  // A title that names several conferences is a listing however good the rest looks.
  if (/\bconferences\b/i.test(input.title || "")) {
    score -= 0.3;
    negatives.push("title names conferences in the plural");
  }

  const confidence = Math.max(0, Math.min(1, score));
  const isRelevant = confidence >= 0.5;

  const classification = isRelevant
    ? input.eventType === "other"
      ? "professional_event"
      : input.eventType
    : negatives.length > 0
      ? "not_a_conference"
      : "insufficient_evidence";

  const reason = [
    isRelevant ? "Accepted" : "Rejected",
    positives.length > 0 ? ` for: ${positives.slice(0, 6).join(", ")}` : "",
    negatives.length > 0 ? `${positives.length > 0 ? ";" : ""} against: ${negatives.slice(0, 6).join(", ")}` : "",
  ].join("");

  return {
    isRelevantEvent: isRelevant,
    classification,
    confidenceScore: Number(confidence.toFixed(3)),
    classificationReason: reason.slice(0, 600),
  };
}
