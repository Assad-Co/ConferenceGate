// Deterministic extraction from visible HTML, for the many conference sites that publish no
// structured data at all.
//
// The method is labels, not positions. Conference sites vary wildly in markup but are remarkably
// consistent in vocabulary: they write "Venue:", "Important Dates", "Abstract submission
// deadline", "Organised by". So this looks for a label and takes the value attached to it — the
// <dd> after a <dt>, the second cell of a table row, the text after a colon, the paragraph under
// a heading. Nothing here counts children or uses nth-of-type: a site that reorders its markup
// keeps working, which a positional selector would not.
//
// Anything not found stays null. There is no "reasonable default" for a conference's country.

import {
  absoluteUrl,
  attr,
  byTag,
  documentTitle,
  findAll,
  mainText,
  metaContent,
  parseHtml,
  textOf,
  walk,
  type HtmlNode,
} from "./html";
import { findCountryInText } from "./countries";
import { emptyRawExtraction, type RawEventExtraction } from "./types";

/** Label vocabularies. Each maps a field to the words a site might introduce it with. */
const LABELS = {
  date: /^\s*(?:conference\s+)?(?:dates?|event\s+dates?|when|date\s+and\s+time|datum|fecha|dates?\s+of\s+(?:the\s+)?(?:event|conference))\s*[:\-–]?\s*$/i,
  location: /^\s*(?:location|where|place|city|country|held\s+in|lieu|ubicación|standort)\s*[:\-–]?\s*$/i,
  venue: /^\s*(?:venue|conference\s+venue|location\s+&?\s*venue|facility|hall|centre|center)\s*[:\-–]?\s*$/i,
  address: /^\s*(?:address|venue\s+address|event\s+address|host\s+city)\s*[:\-–]?\s*$/i,
  organizer: /^\s*(?:organi[sz]ers?|organi[sz]ed\s+by|organi[sz]ing\s+(?:body|committee|institution)|hosted\s+by|host|presented\s+by|convened\s+by)\s*[:\-–]?\s*$/i,
  contact: /^\s*(?:contact|contact\s+(?:person|us|details|information)|enquiries|inquiries|secretariat)\s*[:\-–]?\s*$/i,
  email: /^\s*(?:e-?mail|email\s+address)\s*[:\-–]?\s*$/i,
  phone: /^\s*(?:phone|telephone|tel\.?|mobile|fax)\s*[:\-–]?\s*$/i,
  format: /^\s*(?:format|mode|event\s+(?:format|type|mode)|delivery|attendance)\s*[:\-–]?\s*$/i,
  eventType: /^\s*(?:event\s+type|type\s+of\s+event|category)\s*[:\-–]?\s*$/i,
  topics: /^\s*(?:topics?|tracks?|themes?|subject\s+areas?|conference\s+topics?|scope)\s*[:\-–]?\s*$/i,
  language: /^\s*(?:language|conference\s+language|languages)\s*[:\-–]?\s*$/i,
} as const;

/** Deadline vocabularies, kept apart from each other so one date never fills all four fields. */
export const DEADLINE_LABELS: Array<{ key: keyof typeof DEADLINE_FIELD_NAMES; re: RegExp }> = [
  {
    key: "abstract",
    re: /\b(?:abstract\s+(?:submission\s+)?deadline|abstract\s+submission|call\s+for\s+abstracts?|abstracts?\s+due|submit\s+(?:your\s+)?abstracts?\s+by|proposal\s+deadline|deadline\s+for\s+abstracts?)\b/i,
  },
  {
    key: "paper",
    re: /\b(?:(?:full\s+)?paper\s+submission(?:\s+deadline)?|paper\s+deadline|papers?\s+due|call\s+for\s+papers?\s+(?:deadline|closes)|manuscript\s+deadline|submission\s+deadline)\b/i,
  },
  {
    key: "earlyBird",
    re: /\b(?:early[\s-]?bird(?:\s+(?:registration|deadline|rate|pricing))?|earlybird)\b/i,
  },
  {
    key: "registration",
    re: /\b(?:registration\s+(?:deadline|closes|closing\s+date)|register\s+by|last\s+day\s+to\s+register)\b/i,
  },
  {
    key: "notification",
    re: /\b(?:notification(?:\s+of\s+acceptance)?|acceptance\s+notification|authors?\s+notified|decision\s+notification)\b/i,
  },
  {
    key: "cameraReady",
    re: /\b(?:camera[\s-]?ready|final\s+(?:paper|manuscript|version)\s+(?:deadline|due))\b/i,
  },
];

const DEADLINE_FIELD_NAMES = {
  abstract: "abstractDeadline",
  paper: "paperSubmissionDeadline",
  earlyBird: "earlyBirdDeadline",
  registration: "registrationDeadline",
  notification: "notificationDate",
  cameraReady: "cameraReadyDeadline",
} as const;

const FORMAT_WORDS =
  /\b(?:in[\s-]?person|on[\s-]?site|onsite|face[\s-]?to[\s-]?face|physical|virtual|online|remote|hybrid|blended)\b/i;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
// Conservative on purpose (section 45): an international-looking number of plausible length, and
// nothing that is really a date, a year range or a postcode.
const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d[\d\s.-]{6,15}\d/;

const REGISTRATION_LINK_RE = /\b(?:register|registration|sign\s?up|book\s+(?:now|your)|tickets?|enroll)\b/i;
const SUBMISSION_LINK_RE = /\b(?:submit|submission|call\s+for\s+(?:papers?|abstracts?)|cfp|abstract)\b/i;
const OFFICIAL_LINK_RE = /\b(?:official\s+(?:conference|event|congress)?\s*(?:site|website|page)|conference\s+website|event\s+website|visit\s+(?:the\s+)?website)\b/i;

/** A date-shaped string, in the formats conference sites actually write. */
const DATE_TEXT_RE =
  /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?\s*(?:[–—-]|to|until)?\s*\d{0,2}(?:st|nd|rd|th)?\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s*\d{4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\s*(?:[–—-]|to|until)?\s*\d{0,2}(?:st|nd|rd|th)?,?\s*\d{4}|\d{1,2}[/.]\d{1,2}[/.]\d{2,4})\b/i;

function cleanValue(value: string | null | undefined, limit = 400): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/\s+/g, " ")
    .replace(/^[\s:：\-–—]+/, "")
    .trim();
  if (!cleaned || cleaned.length < 2) return null;
  // A "value" that is really the label repeated, or a bare placeholder, is not a value.
  if (/^(?:tbd|tba|n\/?a|coming soon|to be (?:announced|confirmed)|-|—)$/i.test(cleaned)) return null;
  return cleaned.slice(0, limit);
}

/** The value attached to a label element: its <dd>, its sibling table cell, or its own text
 *  after the colon. */
function valueForLabelNode(node: HtmlNode): string | null {
  const own = textOf(node);

  // <dt>Venue</dt><dd>The Barbican</dd>
  if (node.tag === "dt") {
    let sibling = nextElementSibling(node);
    while (sibling && sibling.tag !== "dd") sibling = nextElementSibling(sibling);
    if (sibling) return cleanValue(textOf(sibling));
  }

  // <th>Venue</th><td>The Barbican</td>  |  <td>Venue</td><td>The Barbican</td>
  if (node.tag === "th" || node.tag === "td") {
    const sibling = nextElementSibling(node);
    if (sibling && (sibling.tag === "td" || sibling.tag === "th")) return cleanValue(textOf(sibling));
  }

  // <strong>Venue:</strong> The Barbican  — the value is the rest of the parent's text.
  const parent = node.parent;
  if (parent && parent.type === "element") {
    const parentText = textOf(parent);
    if (parentText.length > own.length) {
      const index = parentText.indexOf(own);
      if (index !== -1) {
        const after = parentText.slice(index + own.length);
        const value = cleanValue(after);
        if (value) return value;
      }
    }
  }

  // <h3>Venue</h3><p>The Barbican</p>
  if (/^h[1-6]$/.test(node.tag)) {
    const sibling = nextElementSibling(node);
    if (sibling) return cleanValue(textOf(sibling));
  }

  return null;
}

function nextElementSibling(node: HtmlNode): HtmlNode | null {
  const parent = node.parent;
  if (!parent) return null;
  const index = parent.children.indexOf(node);
  for (let i = index + 1; i < parent.children.length; i += 1) {
    const candidate = parent.children[i];
    if (candidate.type === "element") return candidate;
  }
  return null;
}

/** Finds the value for a labelled field anywhere on the page. */
function findLabelled(root: HtmlNode, labelRe: RegExp): string | null {
  const candidates = findAll(root, (node) =>
    ["dt", "th", "td", "strong", "b", "span", "label", "h1", "h2", "h3", "h4", "h5", "h6", "p", "div"].includes(node.tag)
  );

  for (const node of candidates) {
    const text = textOf(node);
    if (!text || text.length > 80) continue;
    if (!labelRe.test(text)) continue;
    const value = valueForLabelNode(node);
    if (value) return value;
  }

  // "Venue: The Barbican Centre" written as one run of text, with no element boundary at all.
  const inlineRe = new RegExp(
    `${labelRe.source.replace(/^\^?\\s\*/, "").replace(/\\s\*\[:\\-–\]\?\\s\*\$$/, "").replace(/\$$/, "")}\\s*[:：]\\s*([^\\n|•]{2,200})`,
    "i"
  );
  const match = inlineRe.exec(mainText(root, 40000));
  return match ? cleanValue(match[1]) : null;
}

/** Every "label → date text" pair in an Important Dates block or anywhere else on the page. */
export function findImportantDates(root: HtmlNode): Array<{ label: string; text: string }> {
  const out: Array<{ label: string; text: string }> = [];
  const seen = new Set<string>();

  const add = (label: string, text: string) => {
    const cleanLabel = cleanValue(label, 120);
    const cleanText = cleanValue(text, 120);
    if (!cleanLabel || !cleanText) return;
    if (!DATE_TEXT_RE.test(cleanText)) return;
    const key = `${cleanLabel.toLowerCase()}|${cleanText.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ label: cleanLabel, text: cleanText });
  };

  // Definition lists and tables: the two shapes an "Important dates" block almost always takes.
  for (const dt of byTag(root, "dt")) {
    const value = valueForLabelNode(dt);
    if (value) add(textOf(dt), value);
  }
  for (const row of byTag(root, "tr")) {
    const cells = row.children.filter((child) => child.type === "element" && (child.tag === "td" || child.tag === "th"));
    if (cells.length < 2) continue;
    add(textOf(cells[0]), textOf(cells[1]));
    // Some tables put the date first.
    add(textOf(cells[1]), textOf(cells[0]));
  }
  // List items and paragraphs: "Abstract submission deadline: 15 January 2027".
  for (const node of findAll(root, (n) => ["li", "p", "div", "span"].includes(n.tag))) {
    const text = textOf(node);
    if (!text || text.length > 200) continue;
    const match = /^(.{3,90}?)\s*[:：\-–—]\s*(.{4,90})$/.exec(text);
    if (match) add(match[1], match[2]);
  }

  return out.slice(0, 60);
}

function findLinkByText(root: HtmlNode, pattern: RegExp, pageUrl: string): string | null {
  for (const anchor of byTag(root, "a")) {
    const href = attr(anchor, "href");
    if (!href) continue;
    const label = `${textOf(anchor)} ${attr(anchor, "title") || ""} ${attr(anchor, "aria-label") || ""}`;
    if (!pattern.test(label) && !pattern.test(href)) continue;
    const resolved = absoluteUrl(href, pageUrl);
    if (resolved) return resolved;
  }
  return null;
}

/** The page's own prose summary: its meta description, or the first substantial paragraph. */
function describePage(root: HtmlNode): string | null {
  const meta =
    metaContent(root, "og:description") ||
    metaContent(root, "description") ||
    metaContent(root, "twitter:description");
  if (meta && meta.trim().length > 40) return cleanValue(meta, 1200);

  const body = root;
  for (const paragraph of byTag(body, "p")) {
    const text = textOf(paragraph);
    if (text.length < 80) continue;
    // Skip cookie banners and other chrome, per section 46.
    if (/\b(?:cookie|privacy policy|all rights reserved|subscribe to our newsletter|javascript)\b/i.test(text)) continue;
    return cleanValue(text, 1200);
  }
  return null;
}

/** The conference's own name: og:title, then <h1>, then <title> with the site name trimmed. */
function findTitle(root: HtmlNode): string | null {
  const og = metaContent(root, "og:title");
  if (og && og.trim().length > 4) return cleanValue(og, 250);

  const h1 = byTag(root, "h1")[0];
  const heading = h1 ? textOf(h1) : "";
  if (heading.length > 4 && heading.length < 250) return cleanValue(heading, 250);

  const title = documentTitle(root);
  if (!title) return null;
  // "IMOG 2027 | International Meeting on Organic Geochemistry" — keep the longer, more specific
  // half rather than whichever came first.
  const parts = title.split(/\s+[|–—·]\s+/).map((part) => part.trim()).filter(Boolean);
  const best = parts.sort((a, b) => b.length - a.length)[0] || title;
  return cleanValue(best, 250);
}

export interface HtmlExtractionOptions {
  /** Anything already known from structured data, so this pass only fills the gaps. */
  seed?: RawEventExtraction | null;
}

export function extractFromHtml(
  html: string,
  pageUrl: string,
  options: HtmlExtractionOptions = {}
): RawEventExtraction {
  const root = parseHtml(html);
  const raw = emptyRawExtraction("html");
  const seed = options.seed;

  raw.title = seed?.title || findTitle(root);
  raw.description = seed?.description || describePage(root);

  const pageBody = mainText(root, 40000);
  const dateLabel = findLabelled(root, LABELS.date);
  raw.datesText = seed?.datesText || dateLabel || DATE_TEXT_RE.exec(pageBody)?.[0] || null;

  const locationValue = findLabelled(root, LABELS.location);
  const venueValue = findLabelled(root, LABELS.venue);
  const addressValue = findLabelled(root, LABELS.address);
  const metaLocation = metaContent(root, "event:location") || metaContent(root, "place") || metaContent(root, "location");
  const headerLocation = [documentTitle(root), ...byTag(root, "h1", "h2").slice(0, 4).map((node) => textOf(node))]
    .find((value) => !!value && !!findCountryInText(value)) || null;
  raw.locationText = seed?.locationText || locationValue || addressValue || venueValue || metaLocation || headerLocation || null;
  raw.venue = seed?.venue || venueValue || null;
  raw.venueAddress = seed?.venueAddress || addressValue || null;
  raw.city = seed?.city || null;
  raw.region = seed?.region || null;
  raw.country = seed?.country || findCountryInText(headerLocation)?.name || null;

  raw.organizer = seed?.organizer || findLabelled(root, LABELS.organizer);
  raw.language = seed?.language || findLabelled(root, LABELS.language);

  // Format: a labelled value first, then any explicit in-person/online/hybrid word in the page's
  // own text. Absent both, it stays null and normalization resolves it to "unknown" — never
  // "in person" by default (section 11).
  const formatLabel = findLabelled(root, LABELS.format);
  raw.formatText = seed?.formatText || formatLabel || FORMAT_WORDS.exec(mainText(root, 20000))?.[0] || null;

  raw.eventTypeText = seed?.eventTypeText || findLabelled(root, LABELS.eventType) || null;

  const topicsValue = findLabelled(root, LABELS.topics);
  const seedTopics = seed?.topics?.length ? seed.topics : [];
  raw.topics = seedTopics.length
    ? seedTopics
    : topicsValue
      ? topicsValue.split(/[,;|•·]/).map((t) => t.trim()).filter((t) => t.length > 2 && t.length < 60).slice(0, 25)
      : [];

  // Contact person and contact number are separate fields and are never derived from each other
  // (section 45). Each is only filled when the page labels it or the value is unmistakable.
  const contactValue = findLabelled(root, LABELS.contact);
  const emailValue = findLabelled(root, LABELS.email);
  const phoneValue = findLabelled(root, LABELS.phone);

  const mailto = findLinkByText(root, /^mailto:/i, pageUrl);
  const emailFromPage =
    (emailValue && EMAIL_RE.exec(emailValue)?.[0]) ||
    (contactValue && EMAIL_RE.exec(contactValue)?.[0]) ||
    (mailto ? mailto.replace(/^mailto:/i, "").split("?")[0] : null) ||
    EMAIL_RE.exec(mainText(root, 20000))?.[0] ||
    null;
  raw.contactEmail = emailFromPage && EMAIL_RE.test(emailFromPage) ? emailFromPage.toLowerCase() : null;

  const phoneCandidate = phoneValue || (contactValue && /\d{6,}/.test(contactValue) ? contactValue : null);
  const phoneMatch = phoneCandidate ? PHONE_RE.exec(phoneCandidate)?.[0] : null;
  raw.contactPhone = phoneMatch && plausiblePhone(phoneMatch) ? phoneMatch.replace(/\s+/g, " ").trim() : null;

  // A contact name is only a name when the label said "contact" and the value is not an address,
  // an email or a number. Anything else stays null rather than becoming a fabricated person.
  if (contactValue && !EMAIL_RE.test(contactValue) && !/\d{4,}/.test(contactValue) && contactValue.length < 80) {
    raw.contactName = contactValue;
  }

  raw.registrationUrl = seed?.registrationUrl || findLinkByText(root, REGISTRATION_LINK_RE, pageUrl);
  raw.submissionUrl = seed?.submissionUrl || findLinkByText(root, SUBMISSION_LINK_RE, pageUrl);
  raw.officialUrl = seed?.officialUrl || findLinkByText(root, OFFICIAL_LINK_RE, pageUrl) || null;
  raw.organizerUrl = seed?.organizerUrl || null;
  raw.imageUrl = seed?.imageUrl || absoluteUrl(metaContent(root, "og:image"), pageUrl);
  raw.price = seed?.price || null;
  raw.currency = seed?.currency || null;
  raw.availability = seed?.availability || null;
  raw.latitude = seed?.latitude ?? null;
  raw.longitude = seed?.longitude ?? null;
  raw.startDateText = seed?.startDateText || null;
  raw.endDateText = seed?.endDateText || null;
  raw.schemaType = seed?.schemaType || null;

  raw.importantDates = findImportantDates(root);

  const filled = Object.entries(raw).filter(([key, value]) => {
    if (["method", "confidence", "filledFields"].includes(key)) return false;
    if (Array.isArray(value)) return value.length > 0;
    return value !== null && value !== "";
  });
  raw.filledFields = filled.map(([key]) => key);

  // Deterministic HTML reading is genuinely less certain than the organiser's own structured
  // statement, so it tops out lower — and a page that yielded no title yields no confidence.
  const core = ["title", "datesText", "locationText", "description"].filter((f) => raw.filledFields.includes(f)).length;
  raw.confidence = raw.title ? Math.min(0.8, 0.3 + core * 0.12) : 0;
  return raw;
}

function plausiblePhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return false;
  // Reject things that are really dates or year ranges.
  if (/^(?:19|20)\d{2}(?:19|20)?\d{0,2}$/.test(digits)) return false;
  return true;
}

/** Plain readable text for the AI fallback and for classification evidence. */
export function pageText(html: string, limit = 20000): string {
  return mainText(parseHtml(html), limit);
}

/** Same-site links worth following from a listing page, used when a sitemap is unavailable. */
export function eventLinksOnPage(html: string, pageUrl: string, limit = 60): string[] {
  const root = parseHtml(html);
  const out: string[] = [];
  const seen = new Set<string>();
  let host: string;
  try {
    host = new URL(pageUrl).hostname.toLowerCase();
  } catch {
    return [];
  }
  for (const anchor of byTag(root, "a")) {
    const resolved = absoluteUrl(attr(anchor, "href"), pageUrl);
    if (!resolved || seen.has(resolved)) continue;
    try {
      if (new URL(resolved).hostname.toLowerCase() !== host) continue;
    } catch {
      continue;
    }
    const label = textOf(anchor);
    if (
      !/\b(?:conference|congress|symposium|summit|workshop|meeting|event|expo|exhibition|forum|convention|seminar)\b/i.test(
        `${label} ${resolved}`
      )
    ) {
      continue;
    }
    seen.add(resolved);
    out.push(resolved);
    if (out.length >= limit) break;
  }
  return out;
}

export { walk, parseHtml };
