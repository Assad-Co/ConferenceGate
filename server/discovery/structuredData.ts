// Schema.org extraction: the cheapest and most reliable route there is.
//
// When an organiser publishes JSON-LD, they have already told us the title, the dates, the venue
// and the country in machine-readable form. Reading that costs one parse and produces values the
// site itself asserted — no heuristics, no model, nothing inferred. This runs before any HTML
// heuristic and long before any AI call, which is also what keeps the engine cheap (section 42).
//
// All three syntaxes are covered because sites genuinely use all three: JSON-LD (most common),
// microdata (older CMS templates), and RDFa (publishers and government sites).

import { absoluteUrl, attr, findAll, parseHtml, textOf, walk, type HtmlNode } from "./html";
import { emptyRawExtraction, type RawEventExtraction } from "./types";

/** schema.org Event and every subclass worth reading. */
export const EVENT_SCHEMA_TYPES = new Set([
  "event",
  "conferenceevent",
  "businessevent",
  "educationevent",
  "exhibitionevent",
  "publicationevent",
  "eventseries",
  "socialevent",
  "festival",
  "screeningevent",
  "coursesession",
]);

/** Types that are events but are almost never what Conference Gate is looking for. Kept out of
 *  the "this page is an event" signal rather than silently extracted as a conference. */
export const NON_PROFESSIONAL_EVENT_TYPES = new Set([
  "musicevent", "sportsevent", "theaterevent", "comedyevent", "danceevent",
  "foodevent", "childrensevent", "saleevent", "literaryevent", "visualartsevent",
]);

function typeTokens(value: unknown): string[] {
  // Handles every way a type is written: a bare "Event", a full "https://schema.org/Event" URL,
  // and RDFa's prefixed "schema:Event".
  if (typeof value === "string") return [value.split(/[/:#]/).pop()!.toLowerCase()];
  if (Array.isArray(value)) return value.flatMap(typeTokens);
  return [];
}

export function isEventType(value: unknown): boolean {
  return typeTokens(value).some((token) => EVENT_SCHEMA_TYPES.has(token));
}

export function isNonProfessionalEventType(value: unknown): boolean {
  return typeTokens(value).some((token) => NON_PROFESSIONAL_EVENT_TYPES.has(token));
}

// ---------------------------------------------------------------------------------------------
// JSON-LD
// ---------------------------------------------------------------------------------------------

/** Every JSON-LD object on the page, with @graph expanded and nested objects flattened. */
export function collectJsonLdObjects(root: HtmlNode): any[] {
  const objects: any[] = [];
  const scripts = findAll(root, (node) => {
    if (node.tag !== "script") return false;
    const type = (attr(node, "type") || "").toLowerCase();
    return type.includes("ld+json");
  });

  for (const script of scripts) {
    const raw = script.children.map((child) => child.text).join("").trim();
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Sites sometimes emit JSON-LD with a trailing comma or an unescaped newline. One repair
      // attempt, then give up rather than guess at the author's intent.
      try {
        parsed = JSON.parse(raw.replace(/,\s*([}\]])/g, "$1"));
      } catch {
        continue;
      }
    }
    pushJsonLd(parsed, objects, 0);
  }
  return objects;
}

function pushJsonLd(value: unknown, out: any[], depth: number): void {
  if (depth > 6 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) pushJsonLd(item, out, depth + 1);
    return;
  }
  const object = value as Record<string, unknown>;
  if (Array.isArray(object["@graph"])) {
    for (const item of object["@graph"]) pushJsonLd(item, out, depth + 1);
  }
  out.push(object);
  // Nested events (subEvent, a Course's hasCourseInstance) are real events in their own right.
  for (const key of ["subEvent", "subEvents", "hasPart", "workFeatured", "event"]) {
    if (object[key]) pushJsonLd(object[key], out, depth + 1);
  }
}

function firstString(value: unknown, depth = 0): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object" && depth < 4) {
    const object = value as Record<string, unknown>;
    for (const key of ["name", "@value", "value", "text", "url", "@id"]) {
      const found = firstString(object[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function firstNumber(value: unknown): number | null {
  const text = firstString(value);
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** schema.org eventAttendanceMode → the site's own words about how it is held. */
function attendanceModeText(value: unknown): string | null {
  const text = firstString(value);
  if (!text) return null;
  const token = text.split("/").pop()!.toLowerCase();
  if (token.includes("mixed")) return "hybrid";
  if (token.includes("online")) return "online";
  if (token.includes("offline")) return "in_person";
  return text;
}

function locationParts(location: unknown): {
  venue: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  text: string | null;
} {
  const empty = {
    venue: null, address: null, city: null, region: null,
    country: null, latitude: null, longitude: null, text: null,
  };
  if (!location) return empty;
  if (typeof location === "string") return { ...empty, text: location.trim() || null };
  if (Array.isArray(location)) {
    // A hybrid event lists both a place and a virtual location; the physical one is what carries
    // a city and a country, so prefer whichever entry actually has an address.
    const withAddress = location.find((item) => item && typeof item === "object" && (item as any).address);
    return locationParts(withAddress ?? location[0]);
  }

  const object = location as Record<string, unknown>;
  const address = object.address;
  const geo = object.geo as Record<string, unknown> | undefined;
  let addressText: string | null = null;
  let city: string | null = null;
  let region: string | null = null;
  let country: string | null = null;

  if (typeof address === "string") {
    addressText = address.trim() || null;
  } else if (address && typeof address === "object") {
    const a = address as Record<string, unknown>;
    city = firstString(a.addressLocality);
    region = firstString(a.addressRegion);
    country = firstString(a.addressCountry);
    addressText =
      [firstString(a.streetAddress), city, region, firstString(a.postalCode), country]
        .filter(Boolean)
        .join(", ") || null;
  }

  return {
    venue: firstString(object.name),
    address: addressText,
    city,
    region,
    country,
    latitude: geo ? firstNumber(geo.latitude) : null,
    longitude: geo ? firstNumber(geo.longitude) : null,
    text: firstString(object.name) || addressText,
  };
}

function offerParts(offers: unknown): { url: string | null; price: string | null; currency: string | null; availability: string | null } {
  const empty = { url: null, price: null, currency: null, availability: null };
  if (!offers) return empty;
  const first = Array.isArray(offers) ? offers[0] : offers;
  if (!first || typeof first !== "object") return empty;
  const object = first as Record<string, unknown>;
  const availability = firstString(object.availability);
  return {
    url: firstString(object.url),
    price: firstString(object.price),
    currency: firstString(object.priceCurrency),
    availability: availability ? availability.split("/").pop()! : null,
  };
}

/** Turns one schema.org Event object into a raw extraction. Absent properties stay null. */
export function eventFromJsonLd(object: Record<string, unknown>, pageUrl: string): RawEventExtraction {
  const raw = emptyRawExtraction("structured_data");
  raw.schemaType = typeTokens(object["@type"])[0] || null;
  raw.title = firstString(object.name);
  raw.description = firstString(object.description);
  raw.startDateText = firstString(object.startDate);
  raw.endDateText = firstString(object.endDate);
  raw.datesText =
    raw.startDateText && raw.endDateText
      ? `${raw.startDateText} – ${raw.endDateText}`
      : raw.startDateText || null;

  const place = locationParts(object.location);
  raw.venue = place.venue;
  raw.venueAddress = place.address;
  raw.city = place.city;
  raw.region = place.region;
  raw.country = place.country;
  raw.latitude = place.latitude;
  raw.longitude = place.longitude;
  raw.locationText = place.text;

  raw.formatText = attendanceModeText(object.eventAttendanceMode);
  raw.eventTypeText = raw.schemaType;

  const organizer = object.organizer ?? object.performer ?? object.sponsor;
  raw.organizer = firstString(
    organizer && typeof organizer === "object" && !Array.isArray(organizer)
      ? (organizer as Record<string, unknown>).name ?? organizer
      : organizer
  );
  if (organizer && typeof organizer === "object") {
    const org = (Array.isArray(organizer) ? organizer[0] : organizer) as Record<string, unknown>;
    raw.organizerUrl = absoluteUrl(firstString(org?.url), pageUrl);
  }

  raw.officialUrl = absoluteUrl(firstString(object.url), pageUrl);
  const offers = offerParts(object.offers);
  raw.registrationUrl = absoluteUrl(offers.url, pageUrl);
  raw.price = offers.price;
  raw.currency = offers.currency;
  raw.availability = offers.availability;

  raw.imageUrl = absoluteUrl(firstString(object.image), pageUrl);
  raw.language = firstString(object.inLanguage);

  const keywords = object.keywords ?? object.about;
  if (typeof keywords === "string") {
    raw.topics = keywords.split(/[,;|]/).map((t) => t.trim()).filter(Boolean).slice(0, 25);
  } else if (Array.isArray(keywords)) {
    raw.topics = keywords.map((k) => firstString(k)).filter((k): k is string => !!k).slice(0, 25);
  }

  // eventStatus carries cancellations and postponements — a real change worth detecting.
  const status = firstString(object.eventStatus);
  if (status) raw.availability = raw.availability || status.split("/").pop()!;

  return finalize(raw);
}

// ---------------------------------------------------------------------------------------------
// Microdata and RDFa
// ---------------------------------------------------------------------------------------------

function propertyValue(node: HtmlNode, pageUrl: string): string | null {
  // The spec's order: an element's own value attribute wins over its text.
  if (node.tag === "meta") return attr(node, "content");
  if (node.tag === "time") return attr(node, "datetime") || textOf(node) || null;
  if (node.tag === "a" || node.tag === "link" || node.tag === "area") {
    return absoluteUrl(attr(node, "href"), pageUrl) || textOf(node) || null;
  }
  if (node.tag === "img") return absoluteUrl(attr(node, "src"), pageUrl);
  if (node.tag === "data") return attr(node, "value") || textOf(node) || null;
  const content = attr(node, "content");
  if (content) return content;
  const text = textOf(node);
  return text || null;
}

/** Collects `prop → value` for one itemscope/typeof subtree, stopping at nested scopes. */
function collectScope(
  scope: HtmlNode,
  propAttr: "itemprop" | "property",
  scopeAttr: "itemscope" | "typeof",
  pageUrl: string
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const visit = (node: HtmlNode, depth: number) => {
    for (const child of node.children) {
      if (child.type !== "element") continue;
      const propNames = (attr(child, propAttr) || "").trim();
      const opensScope =
        scopeAttr === "itemscope" ? attr(child, "itemscope") !== null : !!attr(child, "typeof");

      if (propNames) {
        for (const name of propNames.split(/\s+/)) {
          const key = name.split(/[:/]/).pop()!.toLowerCase();
          if (!key) continue;
          // A nested scope's own name is the value the parent sees (e.g. location → Place.name).
          const value = opensScope
            ? textOf(findFirstProp(child, propAttr, "name")) || propertyValue(child, pageUrl)
            : propertyValue(child, pageUrl);
          if (value) (out[key] ||= []).push(value.trim());
        }
      }
      // Nested scopes are still descended into for their address/geo children, which the parent
      // event needs, but only one level deep so unrelated widgets don't leak in.
      if (!opensScope || depth < 2) visit(child, depth + 1);
    }
  };
  visit(scope, 0);
  return out;
}

function findFirstProp(root: HtmlNode, propAttr: "itemprop" | "property", name: string): HtmlNode {
  for (const node of walk(root)) {
    if (node.type !== "element") continue;
    const value = (attr(node, propAttr) || "").toLowerCase();
    if (value.split(/\s+/).some((token) => token.split(/[:/]/).pop() === name)) return node;
  }
  return { type: "text", tag: "#text", attrs: {}, children: [], parent: null, text: "" };
}

function rawFromProps(props: Record<string, string[]>, schemaType: string, method: "structured_data", pageUrl: string): RawEventExtraction {
  const first = (key: string): string | null => props[key]?.[0]?.trim() || null;
  const raw = emptyRawExtraction(method);
  raw.schemaType = schemaType;
  raw.title = first("name") || first("headline");
  raw.description = first("description");
  raw.startDateText = first("startdate");
  raw.endDateText = first("enddate");
  raw.datesText = raw.startDateText && raw.endDateText ? `${raw.startDateText} – ${raw.endDateText}` : raw.startDateText;
  raw.venue = first("location");
  raw.venueAddress = first("streetaddress") || first("address");
  raw.city = first("addresslocality");
  raw.region = first("addressregion");
  raw.country = first("addresscountry");
  raw.locationText = raw.venue || raw.venueAddress;
  raw.latitude = props.latitude ? Number(props.latitude[0]) || null : null;
  raw.longitude = props.longitude ? Number(props.longitude[0]) || null : null;
  raw.formatText = first("eventattendancemode");
  raw.eventTypeText = schemaType;
  raw.organizer = first("organizer") || first("performer");
  raw.officialUrl = absoluteUrl(first("url"), pageUrl);
  raw.registrationUrl = absoluteUrl(first("offers") || first("ticketurl"), pageUrl);
  raw.imageUrl = absoluteUrl(first("image"), pageUrl);
  raw.price = first("price");
  raw.currency = first("pricecurrency");
  raw.language = first("inlanguage");
  raw.topics = (props.keywords || []).flatMap((value) => value.split(/[,;|]/)).map((t) => t.trim()).filter(Boolean).slice(0, 25);
  return finalize(raw);
}

export function eventsFromMicrodata(root: HtmlNode, pageUrl: string): RawEventExtraction[] {
  const out: RawEventExtraction[] = [];
  const scopes = findAll(root, (node) => attr(node, "itemscope") !== null && !!attr(node, "itemtype"));
  for (const scope of scopes) {
    const itemType = attr(scope, "itemtype") || "";
    if (!isEventType(itemType)) continue;
    const props = collectScope(scope, "itemprop", "itemscope", pageUrl);
    const extraction = rawFromProps(props, itemType.split("/").pop()!.toLowerCase(), "structured_data", pageUrl);
    if (extraction.title) out.push(extraction);
  }
  return out;
}

export function eventsFromRdfa(root: HtmlNode, pageUrl: string): RawEventExtraction[] {
  const out: RawEventExtraction[] = [];
  const scopes = findAll(root, (node) => !!attr(node, "typeof"));
  for (const scope of scopes) {
    const typeValue = attr(scope, "typeof") || "";
    if (!isEventType(typeValue)) continue;
    const props = collectScope(scope, "property", "typeof", pageUrl);
    const extraction = rawFromProps(props, typeValue.split(/[:/]/).pop()!.toLowerCase(), "structured_data", pageUrl);
    if (extraction.title) out.push(extraction);
  }
  return out;
}

function finalize(raw: RawEventExtraction): RawEventExtraction {
  const filled = Object.entries(raw).filter(([key, value]) => {
    if (["method", "confidence", "filledFields"].includes(key)) return false;
    if (Array.isArray(value)) return value.length > 0;
    return value !== null && value !== "";
  });
  raw.filledFields = filled.map(([key]) => key);
  // Structured data is the organiser's own machine-readable statement, so it starts high; the
  // score still rises with how much of it there actually is.
  const core = ["title", "startDateText", "locationText", "description"].filter((field) =>
    raw.filledFields.includes(field)
  ).length;
  raw.confidence = raw.title ? Math.min(0.95, 0.6 + core * 0.09) : 0;
  return raw;
}

export interface StructuredDataResult {
  events: RawEventExtraction[];
  /** Non-professional schema.org event types seen on the page (a concert, a match). Used by the
   *  relevance classifier as evidence, not as an automatic rejection. */
  nonProfessionalTypes: string[];
  sawAnyStructuredData: boolean;
}

/** Reads every syntax and returns the events, best first. */
export function extractStructuredEvents(html: string, pageUrl: string): StructuredDataResult {
  const root = parseHtml(html);
  const jsonLd = collectJsonLdObjects(root);
  const events: RawEventExtraction[] = [];
  const nonProfessionalTypes: string[] = [];

  for (const object of jsonLd) {
    if (isNonProfessionalEventType(object["@type"])) {
      nonProfessionalTypes.push(typeTokens(object["@type"])[0]);
      continue;
    }
    if (!isEventType(object["@type"])) continue;
    const extraction = eventFromJsonLd(object, pageUrl);
    if (extraction.title) events.push(extraction);
  }

  events.push(...eventsFromMicrodata(root, pageUrl));
  events.push(...eventsFromRdfa(root, pageUrl));

  // The same event can appear in two syntaxes on one page; keep the richest copy of each title.
  const byTitle = new Map<string, RawEventExtraction>();
  for (const event of events) {
    const key = (event.title || "").toLowerCase().replace(/\s+/g, " ").trim();
    const existing = byTitle.get(key);
    if (!existing || event.filledFields.length > existing.filledFields.length) byTitle.set(key, event);
  }

  return {
    events: [...byTitle.values()].sort((a, b) => b.confidence - a.confidence),
    nonProfessionalTypes,
    sawAnyStructuredData: jsonLd.length > 0 || events.length > 0,
  };
}
