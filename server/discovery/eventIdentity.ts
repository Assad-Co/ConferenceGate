// Does this page belong to THIS conference?
//
// The deep pass follows same-domain links, and on a conference's own site that is nearly always
// enough. On a platform that hosts thousands of events it is not remotely enough: emedevents.com
// serves one conference's page and another's from the same host, plus site-wide pages like
// /medical-organizers and /medical-conference-speaker-opportunities that belong to no event at
// all. A production sample read a 2026 CME workshop's programme and stored it on a 2027 SNMMI
// conference, which is the worst thing this pipeline can do: state something the source never
// said about the event it says it about.
//
// The asymmetry here is deliberate, and it is the whole design:
//
//   * On a conference's OWN domain (the official URL sits at the site root), a subpage does not
//     have to prove anything. /speakers on inted2027.org is INTED 2027's speakers page, and
//     demanding it repeat the acronym would throw away most real pages.
//   * On any host where the event lives under a path — a platform, a society site with a hundred
//     other things on it — a page must EARN its association: it shares the event's own path, or it
//     names the event. Silence is a rejection there, not a pass.
//   * A page that states a different year than the event's is rejected everywhere. That single
//     rule is what stops a 2026 workshop's programme reaching a 2027 conference.
//
// Everything is decided from what the page says in its title, heading, breadcrumb and URL. There
// is no model call and no guessing.

import { byTag, findFirst, parseHtml, textOf, attr, type HtmlNode } from "./html";

export interface EventIdentity {
  /** Uppercase acronym, when the record has one worth matching on. */
  acronym: string | null;
  /** Distinctive lowercase title words — the ones that actually pick this event out. */
  titleTokens: string[];
  year: number | null;
  /** The event's own page, and therefore the root of everything that belongs to it. */
  officialUrl: string;
  /** Path prefix the event owns. "/" when it owns the whole site. */
  pathPrefix: string;
  /** True when other events (or unrelated site sections) share this host. */
  sharedHost: boolean;
}

/** Words that appear in every second conference title and identify nothing. */
const TITLE_STOPWORD = new Set([
  "conference", "conferences", "congress", "symposium", "symposia", "summit", "meeting", "meetings",
  "forum", "workshop", "workshops", "convention", "expo", "exhibition", "session", "sessions",
  "annual", "international", "world", "global", "national", "european", "asian", "african",
  "american", "the", "and", "for", "of", "on", "in", "at", "de", "des", "der", "und",
  "edition", "event", "events", "series", "programme", "program", "virtual", "online", "hybrid",
]);

function slug(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** The directory the event's own page lives in, normalised with a trailing slash. */
function pathPrefixOf(url: URL): string {
  const path = url.pathname.replace(/\/+$/, "");
  if (!path) return "/";
  // The event page itself is the root of its own subtree: /c/2027/snmmi and /c/2027/snmmi/speakers.
  return `${path}/`;
}

export function eventIdentityFrom(event: {
  title?: string | null; acronym?: string | null; start_year?: number | null; official_url?: string | null;
}): EventIdentity | null {
  const officialUrl = String(event.official_url || "");
  let url: URL;
  try { url = new URL(officialUrl); } catch { return null; }

  const acronymSource = String(event.acronym || "").trim();
  let acronym = /^[A-Za-z][A-Za-z0-9&.-]{1,15}$/.test(acronymSource) ? acronymSource.toUpperCase() : null;
  if (!acronym) {
    // Many records carry the acronym only inside the title: "INTED 2027", "SNMMI Annual Meeting".
    const fromTitle = String(event.title || "").match(/\b([A-Z]{3,10})\b/);
    if (fromTitle && !TITLE_STOPWORD.has(fromTitle[1].toLowerCase())) acronym = fromTitle[1];
  }

  const titleTokens = [...new Set(
    slug(String(event.title || "")).split(" ")
      .filter((token) => token.length >= 4 && !TITLE_STOPWORD.has(token) && !/^\d+$/.test(token))
  )];

  const prefix = pathPrefixOf(url);
  return {
    acronym,
    titleTokens,
    year: Number.isInteger(event.start_year) ? Number(event.start_year) : null,
    officialUrl,
    pathPrefix: prefix,
    // A conference that owns its domain has its official page at the root. Anything deeper means
    // the host carries other things too, and a link is no longer proof of belonging.
    sharedHost: prefix !== "/",
  };
}

/**
 * Pages that are never any conference's data, wherever they live.
 *
 * A sign-up form is not a speaker list on a platform and it is not one on the organiser's own
 * site either, so this applies unconditionally.
 */
const NEVER_EVENT_DATA_PATH = new RegExp(
  "(?:^|/)(?:" +
  "[a-z-]*opportunit(?:y|ies)|newsletter|subscribe|pricing|plans|membership|members|join|" +
  "login|log-in|signin|sign-in|signup|sign-up|account|profile|dashboard|cart|checkout|" +
  "privacy|terms|cookies?|disclaimer|sitemap|advertise|advertising|media-kit|careers|jobs" +
  ")(?:/|$)",
  "i"
);

/**
 * Pages that belong to the platform rather than to any one event.
 *
 * Applied only where the event does not own the host, because these same paths are legitimate on a
 * conference's own site: `/organisers` there is its committee, and rejecting it would lose real
 * data to fix a problem that only exists on shared hosts.
 */
const PLATFORM_WIDE_PATH = new RegExp(
  "(?:^|/)(?:" +
  "medical-organizers|organizers?|organisers?|directory|browse|search|list(?:ing)?s?|" +
  "all-[a-z-]+|blog|news|press|webinars?|courses?|cme|training|faq|help|support" +
  ")(?:/|$)",
  "i"
);

export type IdentityVerdict = { ok: boolean; reason: string };

function pathSlug(url: string): string {
  try { return slug(decodeURIComponent(new URL(url).pathname)); } catch { return ""; }
}

/** Whether a piece of text names this event: its acronym, or enough of its distinctive words. */
export function textIdentifiesEvent(identity: EventIdentity, text: string): boolean {
  const normalized = slug(text);
  if (!normalized) return false;
  if (identity.acronym && identity.acronym.length >= 3) {
    const acronym = slug(identity.acronym);
    if (acronym && new RegExp(`(?:^| )${acronym}(?: |$)`).test(normalized)) return true;
  }
  const matched = identity.titleTokens.filter((token) => normalized.includes(token));
  // Two distinctive words together are a name; one on its own is a coincidence waiting to happen.
  return matched.length >= 2;
}

/**
 * URL-level screen, applied before a fetch is spent.
 *
 * On the event's own domain everything same-host passes. Everywhere else a candidate has to sit
 * under the event's path or name the event in its own URL.
 */
export function candidateUrlBelongsToEvent(identity: EventIdentity, candidateUrl: string): IdentityVerdict {
  let path = "";
  try { path = decodeURIComponent(new URL(candidateUrl).pathname); } catch { return { ok: false, reason: "unparseable_url" }; }

  if (NEVER_EVENT_DATA_PATH.test(path)) {
    return { ok: false, reason: "page_is_never_event_data" };
  }
  if (!identity.sharedHost) return { ok: true, reason: "event_owns_this_domain" };

  const normalizedPath = `${path.replace(/\/+$/, "")}/`;
  if (normalizedPath.startsWith(identity.pathPrefix)) {
    return { ok: true, reason: "under_the_event_path" };
  }
  if (PLATFORM_WIDE_PATH.test(path)) {
    return { ok: false, reason: "platform_wide_page_not_specific_to_this_event" };
  }
  if (textIdentifiesEvent(identity, pathSlug(candidateUrl))) {
    return { ok: true, reason: "url_names_the_event" };
  }
  return { ok: false, reason: "shared_host_and_url_does_not_identify_the_event" };
}

export interface PageIdentity {
  title: string | null;
  heading: string | null;
  breadcrumb: string | null;
  years: number[];
}

function breadcrumbOf(root: HtmlNode): string | null {
  const node = findFirst(root, (candidate) =>
    candidate.type === "element" &&
    /breadcrumb/i.test(`${attr(candidate, "class") || ""} ${attr(candidate, "id") || ""} ${attr(candidate, "aria-label") || ""}`));
  if (!node) return null;
  const text = textOf(node).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 300) : null;
}

/** What a page says about which event it belongs to — from its own title, heading and breadcrumb. */
export function pageIdentityFrom(html: string): PageIdentity {
  const root = parseHtml(html);
  const titleNode = byTag(root, "title")[0];
  const headingNode = byTag(root, "h1")[0];
  const title = titleNode ? textOf(titleNode).replace(/\s+/g, " ").trim().slice(0, 300) : null;
  const heading = headingNode ? textOf(headingNode).replace(/\s+/g, " ").trim().slice(0, 300) : null;
  const breadcrumb = breadcrumbOf(root);
  const years = [...new Set(
    `${title || ""} ${heading || ""} ${breadcrumb || ""}`.match(/\b(20\d\d)\b/g)?.map(Number) || []
  )];
  return { title, heading, breadcrumb, years };
}

/**
 * Page-level screen, applied to what actually came back.
 *
 * A stated year that is not the event's year rejects the page outright, on any host: that is the
 * rule that stops one edition's programme being filed under another's. On a shared host the page
 * must additionally name the event somewhere a reader would look — title, heading or breadcrumb.
 */
export function pageBelongsToEvent(
  identity: EventIdentity, candidateUrl: string, html: string
): IdentityVerdict {
  const page = pageIdentityFrom(html);
  if (identity.year && page.years.length > 0 && !page.years.includes(identity.year)) {
    return { ok: false, reason: `page_states_year_${page.years.join("_")}_not_${identity.year}` };
  }
  if (!identity.sharedHost) return { ok: true, reason: "event_owns_this_domain" };

  // Sitting under the event's own path IS the identification. A real speakers page usually says
  // only "Speakers", and requiring it to repeat the acronym would reject the very pages this is
  // meant to reach.
  try {
    const path = `${decodeURIComponent(new URL(candidateUrl).pathname).replace(/\/+$/, "")}/`;
    if (path.startsWith(identity.pathPrefix)) return { ok: true, reason: "under_the_event_path" };
  } catch { /* fall through to the naming test */ }

  const evidence = `${page.title || ""} ${page.heading || ""} ${page.breadcrumb || ""} ${pathSlug(candidateUrl)}`;
  if (textIdentifiesEvent(identity, evidence)) return { ok: true, reason: "page_names_the_event" };
  return { ok: false, reason: "shared_host_and_page_does_not_identify_the_event" };
}
