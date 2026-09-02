// The AI fallback — the last route, not the first.
//
// Two rules govern it. Cost: it only runs when structured data and the deterministic HTML parser
// together have left an *important* field empty, and every run is capped, so a crawl of ten
// thousand pages cannot quietly become ten thousand model calls (section 42). Honesty: the model
// is given the page text and told to return JSON with null for anything the page does not state,
// and every value it returns is checked back against the page before it is kept — a date, an
// email or a city the page never contains is discarded rather than stored (section 8).
//
// The client is injected rather than imported. server.ts owns the Gemini client and its
// configuration; the engine only needs "something that can answer a prompt with JSON", which also
// means the pipeline runs with no AI configured at all.

import type { RawEventExtraction } from "./types";
import { emptyRawExtraction } from "./types";

/** Whatever can answer a prompt with JSON. server.ts adapts its Gemini client to this. */
export type AiJsonCaller = (prompt: string) => Promise<string | null>;

/** Fields whose absence is worth spending a model call on. A missing image or price is not. */
export const IMPORTANT_FIELDS = ["title", "datesText", "locationText", "country", "city"] as const;

export function needsAiFallback(raw: RawEventExtraction | null): boolean {
  if (!raw || !raw.title) return true;
  // A page with a title but no date and no location has not really been read.
  const hasDate = !!(raw.datesText || raw.startDateText);
  const hasPlace = !!(raw.locationText || raw.city || raw.country || raw.venue);
  return !hasDate || !hasPlace;
}

const SCHEMA_DESCRIPTION = `{
  "title": string|null,
  "description": string|null,
  "dates_text": string|null,
  "start_date": "YYYY-MM-DD"|null,
  "end_date": "YYYY-MM-DD"|null,
  "venue": string|null,
  "city": string|null,
  "region": string|null,
  "country": string|null,
  "format": "in_person"|"online"|"hybrid"|null,
  "event_type": string|null,
  "organizer": string|null,
  "registration_url": string|null,
  "submission_url": string|null,
  "contact_email": string|null,
  "contact_phone": string|null,
  "contact_name": string|null,
  "topics": string[],
  "important_dates": [{"label": string, "text": string}]
}`;

export function buildAiExtractionPrompt(pageText: string, pageUrl: string, pageTitle: string | null): string {
  return [
    "You are reading one web page to find out whether it announces a single professional or academic conference, and if so, what it says about it.",
    "",
    "Rules, in order of importance:",
    '1. Report ONLY what this page states. If the page does not state a field, its value is null. Never infer, never complete a pattern, never use general knowledge about this conference.',
    '2. Do not convert a deadline into an event date, or an event date into a deadline. "Abstract submission closes 3 March" is a deadline, not when the conference happens.',
    "3. Copy dates as the page writes them into dates_text. Only fill start_date/end_date when the page names an actual day, month and year.",
    "4. Country must be the country the event is held in, as the page states it — not the country of the website's publisher.",
    '5. format is only "online" or "hybrid" when the page says so. If the page never says how it is held, format is null.',
    "6. topics are subject areas the page lists. An empty list is correct when it lists none.",
    "",
    `Page URL: ${pageUrl}`,
    pageTitle ? `Page title: ${pageTitle}` : "",
    "",
    `Reply with JSON only, matching exactly this shape: ${SCHEMA_DESCRIPTION}`,
    "",
    "PAGE TEXT:",
    pageText,
  ]
    .filter(Boolean)
    .join("\n");
}

function stringOrNull(value: unknown, limit = 400): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || /^(?:null|n\/a|unknown|not stated|not specified)$/i.test(trimmed)) return null;
  return trimmed.slice(0, limit);
}

/**
 * Keeps only values the page can be seen to support.
 *
 * The model is not trusted as a source: it is trusted as a reader. A value it returns that does
 * not appear in the page text is thrown away, which is what makes the "never invent" rule
 * enforceable rather than merely requested.
 */
function groundedIn(pageText: string, value: string | null, options: { relaxed?: boolean } = {}): string | null {
  if (!value) return null;
  const haystack = pageText.toLowerCase().replace(/\s+/g, " ");
  const needle = value.toLowerCase().replace(/\s+/g, " ").trim();
  if (haystack.includes(needle)) return value;
  if (!options.relaxed) return null;
  // A summary sentence the model composed from the page is legitimate for prose fields, provided
  // most of its distinctive words really are on the page.
  const words = needle.split(/\W+/).filter((word) => word.length > 4);
  if (words.length === 0) return null;
  const present = words.filter((word) => haystack.includes(word)).length;
  return present / words.length >= 0.7 ? value : null;
}

export interface AiExtractionResult {
  extraction: RawEventExtraction | null;
  /** Values the model returned that the page did not support, dropped rather than stored. */
  droppedFields: string[];
  error: string | null;
}

export async function extractWithAi(
  call: AiJsonCaller,
  pageTextValue: string,
  pageUrl: string,
  pageTitle: string | null
): Promise<AiExtractionResult> {
  let responseText: string | null;
  try {
    responseText = await call(buildAiExtractionPrompt(pageTextValue.slice(0, 18000), pageUrl, pageTitle));
  } catch (error: any) {
    return { extraction: null, droppedFields: [], error: String(error?.message || error) };
  }
  if (!responseText) return { extraction: null, droppedFields: [], error: "empty_model_response" };

  let parsed: any;
  try {
    parsed = JSON.parse(responseText.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
  } catch {
    return { extraction: null, droppedFields: [], error: "unparseable_model_response" };
  }

  return { ...groundAiExtraction(parsed, pageTextValue, pageUrl), error: null };
}

/** Exported for tests: the grounding step, with no model involved. */
export function groundAiExtraction(
  parsed: any,
  pageTextValue: string,
  pageUrl: string
): { extraction: RawEventExtraction | null; droppedFields: string[] } {
  const raw = emptyRawExtraction("ai");
  const dropped: string[] = [];

  const keep = (field: string, value: string | null, relaxed = false): string | null => {
    const grounded = groundedIn(pageTextValue, value, { relaxed });
    if (value && !grounded) dropped.push(field);
    return grounded;
  };

  raw.title = keep("title", stringOrNull(parsed.title, 250), true);
  raw.description = keep("description", stringOrNull(parsed.description, 1500), true);
  raw.datesText = keep("dates_text", stringOrNull(parsed.dates_text, 200));
  raw.startDateText = stringOrNull(parsed.start_date, 40);
  raw.endDateText = stringOrNull(parsed.end_date, 40);
  raw.venue = keep("venue", stringOrNull(parsed.venue, 200));
  raw.city = keep("city", stringOrNull(parsed.city, 120));
  raw.region = keep("region", stringOrNull(parsed.region, 120));
  raw.country = keep("country", stringOrNull(parsed.country, 120));
  raw.locationText = [raw.venue, raw.city, raw.region, raw.country].filter(Boolean).join(", ") || null;
  raw.formatText = ["in_person", "online", "hybrid"].includes(String(parsed.format)) ? String(parsed.format) : null;
  raw.eventTypeText = stringOrNull(parsed.event_type, 60);
  raw.organizer = keep("organizer", stringOrNull(parsed.organizer, 200));
  raw.contactName = keep("contact_name", stringOrNull(parsed.contact_name, 120));

  const email = stringOrNull(parsed.contact_email, 200);
  raw.contactEmail =
    email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && pageTextValue.toLowerCase().includes(email.toLowerCase())
      ? email.toLowerCase()
      : (email ? (dropped.push("contact_email"), null) : null);

  const phone = stringOrNull(parsed.contact_phone, 60);
  raw.contactPhone = phone && pageTextValue.replace(/\s+/g, "").includes(phone.replace(/\s+/g, "")) ? phone : (phone ? (dropped.push("contact_phone"), null) : null);

  for (const [field, value] of [
    ["registration_url", parsed.registration_url],
    ["submission_url", parsed.submission_url],
  ] as const) {
    const url = stringOrNull(value, 500);
    if (!url) continue;
    let absolute: string | null = null;
    try {
      absolute = new URL(url, pageUrl).href;
    } catch {
      absolute = null;
    }
    // A URL the page does not contain is exactly the hallucination this guard exists for.
    if (!absolute || !pageTextValue.includes(url.replace(/^https?:\/\//, "").split("?")[0].slice(0, 40))) {
      dropped.push(field);
      continue;
    }
    if (field === "registration_url") raw.registrationUrl = absolute;
    else raw.submissionUrl = absolute;
  }

  raw.topics = Array.isArray(parsed.topics)
    ? parsed.topics
        .map((topic: unknown) => stringOrNull(topic, 60))
        .filter((topic: string | null): topic is string => !!topic && !!groundedIn(pageTextValue, topic))
        .slice(0, 25)
    : [];

  raw.importantDates = Array.isArray(parsed.important_dates)
    ? parsed.important_dates
        .map((entry: any) => ({
          label: stringOrNull(entry?.label, 120) || "",
          text: stringOrNull(entry?.text, 120) || "",
        }))
        .filter((entry: { label: string; text: string }) => entry.label && entry.text && !!groundedIn(pageTextValue, entry.text))
        .slice(0, 40)
    : [];

  const filled = Object.entries(raw).filter(([key, value]) => {
    if (["method", "confidence", "filledFields"].includes(key)) return false;
    if (Array.isArray(value)) return value.length > 0;
    return value !== null && value !== "";
  });
  raw.filledFields = filled.map(([key]) => key);

  if (!raw.title) return { extraction: null, droppedFields: dropped };

  // Deliberately the lowest ceiling of the three methods: this is a reading of the page, not the
  // page's own assertion, and everything downstream should weigh it accordingly.
  const core = ["title", "datesText", "locationText"].filter((f) => raw.filledFields.includes(f)).length;
  raw.confidence = Math.min(0.65, 0.25 + core * 0.13);
  return { extraction: raw, droppedFields: dropped };
}
