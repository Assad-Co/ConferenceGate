// Deep conference sections — program, speakers, committee, sponsors, community — read from the
// organiser's own pages and nothing else.
//
// The four fields above are the ones a conference site almost never puts on its homepage. They
// live on /program, /speakers, /committee, /sponsors, and the enrichment pass only ever saw the
// landing page, which is why production coverage for all five sat at zero while description,
// organizer, CFP, fees and venue filled in normally.
//
// Everything here is deterministic. There is no model call anywhere in this file and there must
// not be one: schema.org first because it is the organiser's own machine-readable statement, then
// labelled HTML, and nothing after that. A page that says nothing yields nothing.
//
// The rules that keep this honest, in the order they matter:
//
//   * A person needs a name that reads like a person's. "Gold Sponsors" is not a speaker.
//   * An affiliation is recorded only when the page itself separated it out — a labelled element,
//     a table column under an "Affiliation" header, or text carrying an unmistakable organisation
//     marker. A trailing phrase after a comma is not evidence of anything.
//   * A role is copied from a label, never deduced from where someone appears. "Keynote Speakers"
//     above a list makes every entry in it a keynote; a bare list of names has no role at all.
//   * Sponsors and organisers are different things and are never read from the same block: a
//     heading naming organisers, hosts or committees disqualifies everything under it from being
//     a sponsor, and vice versa.
//   * Attendees, registration lists and programme-committee members are not speakers. Only a
//     block a speaker heading introduces can produce one.
//
// Anything that fails those tests is dropped, not guessed at. A conference with an unreadable
// speakers page keeps four empty sections and stays exactly as publishable as it was.

import {
  absoluteUrl, attr, byTag, findAll, parseHtml, textOf, walk, type HtmlNode,
} from "./html";
import { canonicalizeUrl } from "./normalize";
import { collectJsonLdObjects } from "./structuredData";

export const DEEP_SECTIONS = ["program", "speakers", "committee", "sponsors", "community"] as const;
export type DeepSection = (typeof DEEP_SECTIONS)[number];

// ---------------------------------------------------------------------------------------------
// Shapes. These mirror what `extracted_conferences` already stores and the existing detail tabs
// already render, so a populated section reaches the UI with no frontend change at all.
// ---------------------------------------------------------------------------------------------

export interface ProgramSession {
  date: string | null;
  time: string | null;
  title: string;
  speakerName: string | null;
  speakerImageUrl: string | null;
  track: string | null;
  /** workshop / panel / tutorial / keynote / special_session / session — only when stated. */
  session_type: string | null;
  location: string | null;
  source_url: string;
}

export interface ProgramAgenda {
  sessions: ProgramSession[];
  tracks: string[];
  important_dates: Array<{ label: string; date: string; isDeadline: boolean }>;
  source_url: string | null;
}

export interface SpeakerEntry {
  name: string;
  /** The person's own job title, when the page states one. Never their talk. */
  title: string | null;
  org: string | null;
  /** Keynote / Invited / Plenary / Featured / Speaker — from the heading that introduced them. */
  role: string | null;
  /** The talk, when the page names one. Stored separately so it is never shown as a job title. */
  presentation_title: string | null;
  email: string | null;
  imageUrl: string | null;
  source_url: string;
}

export interface CommitteeMember {
  name: string;
  title: string | null;
  org: string | null;
  /** "General Chair", "Scientific Committee", … — copied from a label, never inferred. */
  role: string | null;
  email: string | null;
  imageUrl: string | null;
  source_url: string;
}

export interface SponsorEntry {
  name: string;
  /** Gold / Platinum / Bronze / … only when the page names a tier. */
  tier: string | null;
  /** sponsor | exhibitor | partner — which of the three the page called them. */
  classification: string;
  logoUrl: string | null;
  source_url: string;
}

export interface CommunityInfo {
  social_media: Array<{ platform: string; url: string }>;
  hashtag: string | null;
  contact_email: string | null;
  source_url: string | null;
}

export interface DeepSectionExtraction {
  program: ProgramAgenda | null;
  speakers: SpeakerEntry[];
  committee: CommitteeMember[];
  sponsors: SponsorEntry[];
  community: CommunityInfo | null;
}

export function emptyDeepExtraction(): DeepSectionExtraction {
  return { program: null, speakers: [], committee: [], sponsors: [], community: null };
}

// ---------------------------------------------------------------------------------------------
// Which page serves which section
// ---------------------------------------------------------------------------------------------

/** Matched against a same-domain link's path AND its visible text. */
const SECTION_LINK_PATTERNS: Record<DeepSection, RegExp> = {
  program: /\b(program|programme|agenda|schedule|timetable|sessions?|tracks?|workshops?|tutorials?|panels?|proceedings-program)\b/i,
  speakers: /\b(speakers?|keynotes?|keynote-speakers?|plenary|plenaries|invited-?(?:speakers?|talks?)|presenters?|faculty)\b/i,
  committee: /\b(committees?|organi[sz]ing-?committee|scientific-?committee|technical-?(?:program-?)?committee|program-?committee|editorial-?board|chairs?|organi[sz]ers?|boards?)\b/i,
  sponsors: /\b(sponsors?|sponsorship|exhibitors?|exhibition|partners?|supporters?|patrons?)\b/i,
  community: /\b(contact|contact-us|community|social|follow-?us|newsletter|networking)\b/i,
};

/** Extensions a section page never has. A PDF programme is real, but this pass reads HTML only. */
const NON_HTML_EXTENSION = /\.(pdf|docx?|pptx?|xlsx?|zip|ics|jpe?g|png|gif|svg|webp|mp4|mp3)$/i;

/**
 * Every distinct same-domain page this one links to.
 *
 * Exported for the diagnostic: "no deep pages were read" has two very different causes — the page
 * linked nowhere useful, or it linked nowhere at all — and only a count separates them. A
 * JavaScript-rendered site whose direct fetch returns an empty shell reports zero here, which is
 * the answer, not a mystery.
 */
export function sameDomainLinks(html: string, pageUrl: string): string[] {
  let origin: URL;
  try { origin = new URL(pageUrl); } catch { return []; }
  const root = parseHtml(html);
  const found = new Set<string>();
  for (const anchor of byTag(root, "a")) {
    const href = attr(anchor, "href");
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href.trim())) continue;
    const absolute = absoluteUrl(href, pageUrl);
    if (!absolute) continue;
    try {
      const target = new URL(absolute);
      if (target.hostname.replace(/^www\./, "") !== origin.hostname.replace(/^www\./, "")) continue;
      if (NON_HTML_EXTENSION.test(target.pathname)) continue;
      found.add(canonicalizeUrl(target.href) || target.href);
    } catch { continue; }
  }
  return [...found];
}

export interface SectionPageCandidate {
  url: string;
  section: DeepSection;
  /** Why this link was chosen — carried into the run log so a bad pick is explainable. */
  evidence: string;
}

/**
 * Same-domain links that look like they serve one of the deep sections.
 *
 * Only same-domain: a conference that links its speakers page on a third-party ticketing host is
 * not offering us first-party evidence, and following it would quietly turn an official-source
 * read into an anybody-source read.
 */
export function findSectionPages(
  html: string,
  pageUrl: string,
  options: { perSection?: number; sections?: readonly DeepSection[] } = {}
): SectionPageCandidate[] {
  const perSection = Math.max(1, options.perSection ?? 2);
  const wanted = new Set<DeepSection>(options.sections ?? DEEP_SECTIONS);
  let origin: URL;
  try { origin = new URL(pageUrl); } catch { return []; }

  const root = parseHtml(html);
  const seen = new Set<string>();
  const bySection = new Map<DeepSection, SectionPageCandidate[]>();

  for (const anchor of byTag(root, "a")) {
    const href = attr(anchor, "href");
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href.trim())) continue;
    const absolute = absoluteUrl(href, pageUrl);
    if (!absolute) continue;
    let target: URL;
    try { target = new URL(absolute); } catch { continue; }
    if (target.hostname.replace(/^www\./, "") !== origin.hostname.replace(/^www\./, "")) continue;
    if (NON_HTML_EXTENSION.test(target.pathname)) continue;
    const canonical = canonicalizeUrl(target.href) || target.href;
    if (canonical === (canonicalizeUrl(pageUrl) || pageUrl)) continue;
    if (seen.has(canonical)) continue;

    const linkText = textOf(anchor).replace(/\s+/g, " ").trim().slice(0, 120);
    const pathHint = decodeURIComponent(target.pathname + target.hash).replace(/[_+]/g, "-");
    for (const section of DEEP_SECTIONS) {
      if (!wanted.has(section)) continue;
      const pattern = SECTION_LINK_PATTERNS[section];
      const inPath = pattern.test(pathHint);
      const inText = pattern.test(linkText);
      if (!inPath && !inText) continue;
      const bucket = bySection.get(section) || [];
      if (bucket.length >= perSection) break;
      seen.add(canonical);
      bucket.push({
        url: target.href,
        section,
        evidence: inPath ? `path matches ${section}` : `link text "${linkText}" matches ${section}`,
      });
      bySection.set(section, bucket);
      break;
    }
  }

  // A path match is stronger evidence than a nav label, so those go first and get read first when
  // the per-conference page budget cannot cover everything.
  return [...bySection.values()].flat()
    .sort((left, right) => Number(right.evidence.startsWith("path")) - Number(left.evidence.startsWith("path")));
}

// ---------------------------------------------------------------------------------------------
// Person-name and affiliation evidence
// ---------------------------------------------------------------------------------------------

const HONORIFIC = /^(?:dr|prof|professor|assoc|assist|mr|mrs|ms|miss|sir|dame|rev|hon|eng|ing|dipl)\.?$/i;
const NAME_SUFFIX = /^(?:phd|ph\.d\.?|md|m\.d\.?|msc|bsc|dsc|jr|sr|ii|iii|iv|frs|facs|feee|ieee)[.,]?$/i;
const NAME_PARTICLE = /^(?:van|von|de|del|della|der|den|di|da|dos|das|du|la|le|el|al|bin|ibn|ben|mac|mc|st)\.?$/i;

/** Words that make a string an organisation rather than a person, wherever they appear. */
const ORG_MARKER = new RegExp(
  "\\b(?:univ(?:ersit|ersid)\\w*|institut[eo]?|instituto|inst\\.|college|school|faculty|" +
  "department|dept\\.?|laborator(?:y|ies)|labs?|centre|center|academy|academia|society|association|assoc\\.|" +
  "federation|foundation|council|ministry|agency|authority|hospital|clinic|museum|observatory|consortium|" +
  "network|alliance|company|corporation|corp\\.?|incorporated|inc\\.?|ltd\\.?|limited|llc|l\\.l\\.c\\.|plc|gmbh|" +
  "ag|s\\.?a\\.?s?|b\\.?v\\.?|pty|group|holdings?|technologies|technology|solutions|systems|research|sciences?|" +
  "cnrs|cern|nasa|inria|max planck|fraunhofer|csic|csiro|kaust|mit|eth|epfl)\\b",
  "i"
);

/**
 * Words that make a phrase interface copy rather than a name, matched whole-token.
 *
 * A production sample stored "Premium Profile" and "Live Webinars" as speakers and "Contact Us
 * Today" as a sponsor. Every one of them is two or three capitalised words with no digits and no
 * organisation marker — structurally identical to "Amara Okafor". Structure cannot separate them;
 * only vocabulary can. Deliberately absent from this list: words that are also real surnames
 * (Free, Book, Page, Price, Best, Young, Moore, Green, Long, Rich, May, March, Hall, Bell), which
 * is why matching is on whole tokens and never on substrings.
 */
const UI_MARKETING_TOKEN = new Set([
  "premium", "profile", "profiles", "webinar", "webinars", "login", "logout", "signin", "signup",
  "register", "registration", "subscribe", "subscription", "newsletter", "download", "downloads",
  "upload", "click", "learn", "more", "view", "browse", "search", "filter", "menu", "home",
  "contact", "faq", "faqs", "help", "support", "pricing", "plans", "membership", "member",
  "members", "join", "apply", "submit", "submission", "abstract", "abstracts", "deadline",
  "deadlines", "opportunity", "opportunities", "sponsorship", "sponsor", "sponsors", "sponsored",
  "exhibit", "exhibitor", "exhibitors", "partner", "partners", "brochure", "ticket", "tickets",
  "agenda", "schedule", "programme", "program", "session", "sessions", "workshop", "workshops",
  "course", "courses", "credits", "cme", "ceu", "live", "online", "virtual", "hybrid", "today",
  "now", "here", "us", "our", "your", "read", "show", "watch", "listen", "explore", "discover",
  "get", "start", "request", "enquire", "inquire", "demo", "trial", "upgrade", "buy", "shop",
  "cart", "checkout", "terms", "privacy", "policy", "cookie", "cookies", "disclaimer", "sitemap",
  "copyright", "reserved", "advertisement", "advertise", "featured", "popular", "trending",
  "latest", "upcoming", "archive", "gallery", "photos", "videos", "blog", "news", "press",
  "careers", "jobs", "account", "dashboard", "settings", "notifications", "email", "directions",
  "accommodation", "venue", "booth", "coffee", "break", "lunch", "dinner", "reception",
  "networking", "welcome", "opening", "closing", "gala", "excursion", "keynote", "plenary",
  "poster", "panel", "tutorial", "symposium", "congress", "conference", "meeting", "summit",
  "forum", "expo", "exhibition", "speaker", "speakers", "committee", "committees", "organizer",
  "organizers", "organiser", "organisers",
]);

/** True when any whole word of a phrase is interface or marketing vocabulary. */
export function looksLikeUiText(value: string | null | undefined): boolean {
  const tokens = String(value ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.some((token) => UI_MARKETING_TOKEN.has(token));
}

const NON_PERSON_PHRASE = new RegExp(
  "\\b(?:sponsors?|exhibitors?|partners?|committees?|programme?|program|agenda|schedule|speakers?|keynotes?|" +
  "register|registration|submit|submission|home|about|contact|news|venue|accommodation|travel|gallery|" +
  "read more|view all|show more|click here|download|login|sign in|menu|search|deadline|call for papers|" +
  "important dates|organi[sz]ed by|hosted by|supported by|in cooperation with|all rights reserved|copyright)\\b",
  "i"
);

/**
 * Whether a string reads as a person's name.
 *
 * Deliberately strict. The cost of rejecting a real speaker is one missing card; the cost of
 * accepting "Platinum Sponsors" is a conference page that states something nobody published.
 */
export function looksLikePersonName(value: string | null | undefined): boolean {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim().replace(/[,;:]+$/, "");
  if (raw.length < 4 || raw.length > 80) return false;
  if (/\d/.test(raw)) return false;
  if (/[@/|©®™]|https?:/i.test(raw)) return false;
  if (NON_PERSON_PHRASE.test(raw)) return false;
  if (looksLikeUiText(raw)) return false;
  if (ORG_MARKER.test(raw)) return false;

  const tokens = raw.split(/\s+/).filter((token) => !HONORIFIC.test(token) && !NAME_SUFFIX.test(token));
  if (tokens.length < 2 || tokens.length > 5) return false;
  let capitalised = 0;
  for (const token of tokens) {
    if (NAME_PARTICLE.test(token)) continue;
    const cleaned = token.replace(/^[("']+|[)"'.]+$/g, "");
    if (cleaned.length === 0) return false;
    // Accept "Smith", "SMITH", "O'Neill", "Ben-Gurion", "Á…" — reject "smith" and "x".
    if (!/^[\p{Lu}]/u.test(cleaned)) return false;
    if (!/^[\p{L}'’.-]+$/u.test(cleaned)) return false;
    capitalised += 1;
  }
  return capitalised >= 2;
}

/** Labels a site uses when it separates an affiliation out as its own field. */
const AFFILIATION_LABEL = /\b(affiliation|institution|organi[sz]ation|organisation|university|company|employer|works?\s*for|based\s*at)\b/i;

/**
 * Whether a string can be recorded as an affiliation.
 *
 * `labelled` is the page's own structural claim — an `itemprop="affiliation"`, a `<dd>` under an
 * "Affiliation" `<dt>`, a table column under that header. When the page went to the trouble of
 * separating the field, we take its word for it. Otherwise the text has to identify itself as an
 * organisation, because a trailing phrase after a comma could be anything.
 */
export function looksLikeAffiliation(value: string | null | undefined, labelled = false): boolean {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  if (raw.length < 2 || raw.length > 200) return false;
  if (/^https?:/i.test(raw) || raw.includes("@")) return false;
  if (NON_PERSON_PHRASE.test(raw)) return false;
  if (labelled) return true;
  return ORG_MARKER.test(raw);
}

const JOB_TITLE = new RegExp(
  "^(?:full |associate |assistant |emeritus |visiting |adjunct |senior |principal |lead |chief |head )*" +
  "(?:professor|prof\\.?|lecturer|reader|researcher|scientist|engineer|director|dean|president|" +
  "vice[- ]president|chair(?:person)?|manager|founder|co[- ]?founder|ceo|cto|cfo|cio|postdoc|" +
  "post[- ]doctoral fellow|fellow|consultant|analyst|physician|surgeon|attending)\\b",
  "i"
);

/** A person's own job title, only when the text plainly is one. */
export function looksLikeJobTitle(value: string | null | undefined): boolean {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  if (raw.length < 3 || raw.length > 120) return false;
  if (ORG_MARKER.test(raw)) return false;
  // "Prof. Amara Okafor" opens with a job word but is a person, not a post.
  if (looksLikePersonName(raw)) return false;
  return JOB_TITLE.test(raw);
}

function clean(value: string | null | undefined, limit = 200): string | null {
  const text = String(value ?? "").replace(/\s+/g, " ").trim().replace(/^[–—\-·•|,;:]+|[–—\-·•|,;:]+$/g, "").trim();
  if (!text) return null;
  return text.slice(0, limit);
}

function stripHonorifics(name: string): string {
  const tokens = name.replace(/\s+/g, " ").trim().replace(/[,;]+$/, "").split(" ");
  while (tokens.length > 2 && HONORIFIC.test(tokens[0])) tokens.shift();
  while (tokens.length > 2 && NAME_SUFFIX.test(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(" ").replace(/[,;]+$/, "").trim();
}

/** Case- and punctuation-insensitive identity, for de-duplicating people across pages. */
function personKey(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]+/g, " ").trim();
}

// ---------------------------------------------------------------------------------------------
// Walking a page by its headings
// ---------------------------------------------------------------------------------------------

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

function headingLevel(node: HtmlNode): number {
  return HEADING_TAGS.has(node.tag) ? Number(node.tag[1]) : 7;
}

/** Whether any ancestor of `node` has already been collected into the block being built. */
function isInside(node: HtmlNode, collected: Set<HtmlNode>): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (collected.has(parent)) return true;
  }
  return false;
}

interface HeadingBlock {
  heading: string;
  level: number;
  nodes: HtmlNode[];
}

/**
 * Splits a document into "heading, then everything under it until the next heading of the same or
 * higher rank". This is how conference pages are actually shaped — a `<h2>Keynote Speakers</h2>`
 * followed by cards — and it is what makes a role attributable to a label rather than guessed.
 */
export function headingBlocks(root: HtmlNode): HeadingBlock[] {
  const ordered = [...walk(root)].filter((node) => node.type === "element");
  const blocks: HeadingBlock[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const node = ordered[index];
    if (!HEADING_TAGS.has(node.tag)) continue;
    const heading = clean(textOf(node), 160);
    if (!heading) continue;
    const level = headingLevel(node);
    const nodes: HtmlNode[] = [];
    const collected = new Set<HtmlNode>();
    for (let cursor = index + 1; cursor < ordered.length; cursor += 1) {
      const candidate = ordered[cursor];
      // A heading ends this block when it starts a section of its own, and a heading starts a
      // section of its own when it is not already inside this block's content. That distinction is
      // the whole trick: `<h2>Sponsors</h2>` must not swallow the `<h2>Organised by</h2>` list that
      // follows it, and `<h2>Speakers</h2>` must not re-claim its own `<h3>Keynote Speakers</h3>`
      // subsection and overwrite the specific label with a vaguer one — yet the `<h3>` a speaker
      // card uses for the person's name is content, not a new section, and must stay.
      if (HEADING_TAGS.has(candidate.tag) && !isInside(candidate, collected)) break;
      nodes.push(candidate);
      collected.add(candidate);
    }
    blocks.push({ heading, level, nodes });
  }
  return blocks;
}

/** Immediate children carrying text, used to read a card without descending into its whole tree. */
function directTextParts(node: HtmlNode): Array<{ node: HtmlNode; text: string }> {
  const parts: Array<{ node: HtmlNode; text: string }> = [];
  for (const child of node.children) {
    if (child.type === "text") {
      const text = clean(child.text);
      if (text) parts.push({ node, text });
      continue;
    }
    if (child.tag === "script" || child.tag === "style") continue;
    const text = clean(textOf(child));
    if (text) parts.push({ node: child, text });
  }
  return parts;
}

/** Page furniture: navigation, buttons, promos, cookie bars. Nothing in here is conference data. */
const CHROME_TAG = new Set(["nav", "header", "footer", "aside", "button", "form", "select", "option"]);
const CHROME_CLASS = /\b(?:nav|navbar|navigation|menu|breadcrumb|btn|button|cta|banner|promo|advert|ads?|sidebar|widget|cookie|consent|modal|popup|overlay|toolbar|pagination|social|share|subscribe|newsletter|search|filter|login|signup|header|footer)\b/;

/**
 * Whether a node sits inside page furniture rather than content.
 *
 * The second half of the "Premium Profile" fix: that text was a badge on a card, and a badge lives
 * in a button or a promo block. Vocabulary catches the words we can predict; this catches the ones
 * we cannot, by refusing to read anything the page itself marked as interface.
 */
export function insideChrome(node: HtmlNode): boolean {
  for (let current: HtmlNode | null = node; current; current = current.parent) {
    if (current.type !== "element") continue;
    if (CHROME_TAG.has(current.tag)) return true;
    if (CHROME_CLASS.test(`${attr(current, "class") || ""} ${attr(current, "id") || ""}`.toLowerCase())) return true;
    if ((attr(current, "role") || "").toLowerCase() === "navigation") return true;
  }
  return false;
}

function classOf(node: HtmlNode): string {
  return `${attr(node, "class") || ""} ${attr(node, "id") || ""} ${attr(node, "itemprop") || ""}`.toLowerCase();
}

function imageIn(node: HtmlNode, pageUrl: string): string | null {
  for (const img of byTag(node, "img")) {
    const src = absoluteUrl(attr(img, "src") || attr(img, "data-src"), pageUrl);
    if (src) return src;
  }
  return null;
}

function emailIn(node: HtmlNode): string | null {
  for (const anchor of byTag(node, "a")) {
    const href = attr(anchor, "href") || "";
    if (/^mailto:/i.test(href)) return clean(href.replace(/^mailto:/i, "").split("?")[0], 120);
  }
  const match = textOf(node).match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return match ? match[0] : null;
}

// ---------------------------------------------------------------------------------------------
// People — speakers and committee members share one reader, and differ only in the label above
// them and in what a role is allowed to say.
// ---------------------------------------------------------------------------------------------

interface RawPerson {
  name: string;
  title: string | null;
  org: string | null;
  role: string | null;
  presentationTitle: string | null;
  email: string | null;
  imageUrl: string | null;
}

const PERSON_CONTAINER = /\b(speaker|keynote|plenary|presenter|person|profile|bio|member|committee|team|staff|card|panelist)\b/;
const NAME_HINT = /\b(name|speaker-?name|person-?name|fullname|full-?name)\b/;
const AFFILIATION_HINT = /\b(affiliation|institution|organi[sz]ation|organisation|univ|company|employer|workplace)\b/;
const TALK_HINT = /\b(talk|presentation|topic|paper|lecture|abstract-?title|session-?title)\b/;
const ROLE_HINT = /\b(role|position|committee-?role|designation|jobtitle|job-?title)\b/;

const HEADER_ROLES = {
  name: /\b(name|speaker|member|person|participant|chair)\b/i,
  affiliation: /\b(affiliation|institution|organi[sz]ation|organisation|university|company|employer|country)\b/i,
  role: /\b(role|position|committee|designation|function)\b/i,
  jobTitle: /^\s*(title|job\s*title|rank)\s*$/i,
  talk: /\b(talk|presentation|topic|paper|lecture|title\s*of\s*(?:talk|presentation|paper))\b/i,
} as const;

function quotedPhrase(text: string): string | null {
  const match = text.match(/[“"']([^“”"']{6,160})[”"']/);
  return match ? clean(match[1], 160) : null;
}

/** People stated by an HTML table, using the table's own header row to say which column is what. */
function peopleFromTable(table: HtmlNode, pageUrl: string): RawPerson[] {
  const rows = byTag(table, "tr");
  if (rows.length < 2) return [];
  const headerCells = byTag(rows[0], "th", "td").map((cell) => clean(textOf(cell), 60) || "");
  const columns: Partial<Record<keyof typeof HEADER_ROLES, number>> = {};
  headerCells.forEach((header, index) => {
    // Most specific first: "Job Title" must not be claimed by the loose name pattern.
    if (HEADER_ROLES.talk.test(header) && columns.talk === undefined) columns.talk = index;
    else if (HEADER_ROLES.jobTitle.test(header) && columns.jobTitle === undefined) columns.jobTitle = index;
    else if (HEADER_ROLES.affiliation.test(header) && columns.affiliation === undefined) columns.affiliation = index;
    else if (HEADER_ROLES.role.test(header) && columns.role === undefined) columns.role = index;
    else if (HEADER_ROLES.name.test(header) && columns.name === undefined) columns.name = index;
  });
  const people: RawPerson[] = [];
  const startRow = columns.name === undefined && Object.keys(columns).length === 0 ? 0 : 1;
  for (const row of rows.slice(startRow)) {
    const cells = byTag(row, "td", "th");
    if (cells.length === 0) continue;
    const texts = cells.map((cell) => clean(textOf(cell), 200));
    const nameIndex = columns.name ?? texts.findIndex((text) => looksLikePersonName(text));
    if (nameIndex < 0) continue;
    const name = stripHonorifics(texts[nameIndex] || "");
    if (!looksLikePersonName(name)) continue;
    // A column the header named is labelled evidence; anything else has to identify itself.
    const orgText = columns.affiliation !== undefined ? texts[columns.affiliation] : null;
    const fallbackOrg = orgText ? null : texts.find((text, index) => index !== nameIndex && looksLikeAffiliation(text));
    people.push({
      name,
      title: columns.jobTitle !== undefined && looksLikeJobTitle(texts[columns.jobTitle]) ? texts[columns.jobTitle] : null,
      org: orgText && looksLikeAffiliation(orgText, true) ? orgText : (fallbackOrg || null),
      role: columns.role !== undefined ? clean(texts[columns.role], 80) : null,
      presentationTitle: columns.talk !== undefined ? clean(texts[columns.talk], 160) : null,
      email: emailIn(row),
      imageUrl: imageIn(row, pageUrl),
    });
  }
  return people;
}

/** People stated by a definition list: `<dt>` the person, `<dd>` what the site says about them. */
function peopleFromDefinitionList(list: HtmlNode, pageUrl: string): RawPerson[] {
  const people: RawPerson[] = [];
  let pending: RawPerson | null = null;
  for (const child of list.children) {
    if (child.type !== "element") continue;
    const text = clean(textOf(child), 200);
    if (child.tag === "dt") {
      if (pending) people.push(pending);
      pending = null;
      const name = stripHonorifics(text || "");
      if (looksLikePersonName(name)) {
        pending = { name, title: null, org: null, role: null, presentationTitle: null, email: emailIn(child), imageUrl: imageIn(child, pageUrl) };
      }
      continue;
    }
    if (child.tag === "dd" && pending && text) {
      // The site put this in its own field beside the name, which is the structural claim we
      // accept an affiliation on.
      if (!pending.org && looksLikeAffiliation(text, true)) pending.org = text;
      if (!pending.email) pending.email = emailIn(child);
    }
  }
  if (pending) people.push(pending);
  return people;
}

const PERSON_LINE_SEPARATOR = /\s*[,–—|·•]\s*|\s+[-–—]\s+|\s*\(\s*/;

/** One person stated on one line: "Jane Okafor, University of Lagos" and its variants. */
function personFromLine(text: string, node: HtmlNode, pageUrl: string): RawPerson | null {
  const line = clean(text, 300);
  if (!line) return null;
  const talk = quotedPhrase(line);
  const withoutTalk = talk ? line.replace(/[“"'][^“”"']{6,160}[”"']/, " ") : line;
  const parts = withoutTalk.split(PERSON_LINE_SEPARATOR).map((part) => clean(part.replace(/\)$/, ""))).filter(Boolean) as string[];
  if (parts.length === 0) return null;
  const name = stripHonorifics(parts[0]);
  if (!looksLikePersonName(name)) return null;
  const rest = parts.slice(1);
  return {
    name,
    title: rest.find((part) => looksLikeJobTitle(part)) || null,
    org: rest.find((part) => looksLikeAffiliation(part)) || null,
    role: null,
    presentationTitle: talk,
    email: emailIn(node),
    imageUrl: imageIn(node, pageUrl),
  };
}

/** One person stated as a card: a name element, and whatever the site labelled beside it. */
function personFromCard(card: HtmlNode, pageUrl: string): RawPerson | null {
  const labelled = (hint: RegExp): string | null => {
    for (const node of walk(card)) {
      if (node.type !== "element" || node === card) continue;
      if (!hint.test(classOf(node))) continue;
      const text = clean(textOf(node), 200);
      if (text) return text;
    }
    return null;
  };

  let name = labelled(NAME_HINT);
  if (!looksLikePersonName(name)) {
    name = null;
    for (const node of walk(card)) {
      if (node.type !== "element") continue;
      if (!HEADING_TAGS.has(node.tag) && !["strong", "b", "figcaption"].includes(node.tag)) continue;
      const candidate = stripHonorifics(clean(textOf(node), 100) || "");
      if (looksLikePersonName(candidate)) { name = candidate; break; }
    }
  }
  if (!name) {
    for (const part of directTextParts(card)) {
      const candidate = stripHonorifics(part.text);
      if (looksLikePersonName(candidate)) { name = candidate; break; }
    }
  }
  if (!name || !looksLikePersonName(name)) return null;
  name = stripHonorifics(name);

  const labelledOrg = labelled(AFFILIATION_HINT);
  const parts = [...walk(card)]
    .filter((node) => node.type === "element" && node.children.every((child) => child.type === "text"))
    .map((node) => clean(textOf(node), 200))
    .filter((text): text is string => !!text && personKey(text) !== personKey(name!));
  const labelledTalk = labelled(TALK_HINT);

  return {
    name,
    title: parts.find((part) => looksLikeJobTitle(part)) || null,
    org: labelledOrg && looksLikeAffiliation(labelledOrg, true)
      ? labelledOrg
      : parts.find((part) => looksLikeAffiliation(part)) || null,
    role: labelled(ROLE_HINT),
    presentationTitle: labelledTalk || parts.map((part) => quotedPhrase(part)).find(Boolean) || null,
    email: emailIn(card),
    imageUrl: imageIn(card, pageUrl),
  };
}

/** Every person a block of nodes states, by whichever shape the site used. */
export function peopleFromNodes(nodes: HtmlNode[], pageUrl: string): RawPerson[] {
  const found: RawPerson[] = [];
  const consumed = new Set<HtmlNode>();
  const claim = (node: HtmlNode) => { for (const inner of walk(node)) consumed.add(inner); };

  for (const node of nodes) {
    if (consumed.has(node) || node.type !== "element" || insideChrome(node)) continue;
    if (node.tag === "table") { found.push(...peopleFromTable(node, pageUrl)); claim(node); continue; }
    if (node.tag === "dl") { found.push(...peopleFromDefinitionList(node, pageUrl)); claim(node); continue; }
  }
  for (const node of nodes) {
    if (consumed.has(node) || node.type !== "element" || insideChrome(node)) continue;
    if (!PERSON_CONTAINER.test(classOf(node))) continue;
    const person = personFromCard(node, pageUrl);
    if (person) { found.push(person); claim(node); }
  }
  for (const node of nodes) {
    if (consumed.has(node) || node.type !== "element" || insideChrome(node)) continue;
    if (!["li", "p", "figcaption", "td"].includes(node.tag)) continue;
    const person = personFromLine(textOf(node), node, pageUrl) || personFromCard(node, pageUrl);
    if (person) { found.push(person); claim(node); }
  }

  const unique = new Map<string, RawPerson>();
  for (const person of found) {
    const key = personKey(person.name);
    if (!key) continue;
    const existing = unique.get(key);
    if (!existing) { unique.set(key, person); continue; }
    // Two mentions of one person: keep every field either of them actually stated.
    existing.title ??= person.title;
    existing.org ??= person.org;
    existing.role ??= person.role;
    existing.presentationTitle ??= person.presentationTitle;
    existing.email ??= person.email;
    existing.imageUrl ??= person.imageUrl;
  }
  return [...unique.values()];
}

// ---------------------------------------------------------------------------------------------
// Which heading introduces which section
//
// Checked in this order, and the order is the point: "Technical Program Committee" is a committee,
// not an agenda, and "Organising Committee" must never be read as a list of sponsors.
// ---------------------------------------------------------------------------------------------

const HEADING_PATTERNS = {
  committee: /\b(committees?|organi[sz]ing\s+(?:team|body)|editorial\s+board|advisory\s+board|scientific\s+board|programme?\s+board|chairs?|organi[sz]ers?|hosts?)\b/i,
  speakers: /\b(speakers?|keynotes?|plenar(?:y|ies)|invited\s+talks?|panell?ists?|presenters?)\b/i,
  sponsors: /\b(sponsors?|sponsorship|exhibitors?|exhibition|partners?|supporters?|patrons?)\b/i,
  importantDates: /\b(important\s+dates?|key\s+dates?|deadlines?|timeline|dates\s+to\s+remember)\b/i,
  program: /\b(programme?|agenda|schedule|timetable|sessions?|tracks?|workshops?|tutorials?|panels?)\b/i,
  community: /\b(follow\s+us|social\s+media|social|connect|community|networking|contact)\b/i,
} as const;

type HeadingSection = keyof typeof HEADING_PATTERNS;

export function sectionForHeading(heading: string): HeadingSection | null {
  for (const section of ["committee", "speakers", "sponsors", "importantDates", "program", "community"] as HeadingSection[]) {
    if (HEADING_PATTERNS[section].test(heading)) return section;
  }
  return null;
}

/** The role every person under this heading holds, taken from the heading's own words. */
export function speakerRoleFromHeading(heading: string): string {
  if (/\bkeynotes?\b/i.test(heading)) return "Keynote";
  if (/\bplenar/i.test(heading)) return "Plenary";
  if (/\binvited\b/i.test(heading)) return "Invited";
  if (/\b(featured|distinguished|guest|highlight)\b/i.test(heading)) return "Featured";
  if (/\bpanell?ists?\b/i.test(heading)) return "Panelist";
  return "Speaker";
}

/** The committee a person sits on, as the page named it. */
export function committeeRoleFromHeading(heading: string): string | null {
  const text = clean(heading, 80);
  if (!text) return null;
  return text.replace(/\s*[:–—-]\s*$/, "");
}

const TIER_WORDS = /\b(platinum|diamond|titanium|gold|golden|silver|bronze|emerald|ruby|sapphire|pearl|crystal|elite|premier|principal|lead|major|main|headline|supporting|contributing|associate|media|academic|technical|institutional|strategic|official)\b/i;

/** The tier a sponsor heading names, or null when it names none. */
export function tierFromHeading(heading: string): string | null {
  const match = heading.match(TIER_WORDS);
  if (!match) return null;
  const word = match[1];
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

export function sponsorClassificationFromHeading(heading: string): "sponsor" | "exhibitor" | "partner" {
  if (/\bexhibit/i.test(heading)) return "exhibitor";
  if (/\bpartner/i.test(heading)) return "partner";
  return "sponsor";
}

const NON_SPONSOR_NAME = /^(?:home|about|contact|contact\s+us|register|registration|sponsors?|exhibitors?|partners?|sponsorship|become\s+an?\s+\w+|read\s+more|view\s+all|learn\s+more|more\s+info|download|logo|image|back|next|previous|click\s+here)$/i;

/** A call to action, not a company: "Contact Us Today", "Become a Sponsor", "Download the pack". */
const SPONSOR_CTA = /^(?:contact|learn|become|download|join|register|sponsor|view|get|request|see|find|explore|discover|apply|submit|enquire|inquire|buy|start|read|click|subscribe|watch|reserve|order|call|email|visit|check|browse|show|add|try|support)\b/i;

/**
 * Whether a string can be stored as a sponsoring organisation's name.
 *
 * Three real false positives motivate every clause: "Contact Us Today" (a button), "INTED Coffee
 * Break" (a programme item sitting in the sponsors block), and assorted navigation labels. An
 * organisation marker overrides the vocabulary veto, because "Expo Systems Ltd" is a real company
 * whose name happens to contain a word this file otherwise treats as interface copy.
 */
export function looksLikeSponsorName(value: string | null | undefined): boolean {
  const name = String(value ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 120) return false;
  if (/^\d+$/.test(name)) return false;
  if (NON_SPONSOR_NAME.test(name)) return false;
  if (SPONSOR_CTA.test(name)) return false;
  if (name.split(/\s+/).length > 8) return false;
  // No trailing-period rule: "Iberia Robotics S.L." and "Acme Inc." end in one, and a sentence is
  // already excluded by the word cap and the vocabulary below.
  if (/[!?]$/.test(name)) return false;
  return ORG_MARKER.test(name) || !looksLikeUiText(name);
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}

/**
 * Organisations named under a sponsor/exhibitor/partner heading.
 *
 * A name needs evidence that it IS an organisation, not merely that it sat in the right block: a
 * logo, a link to its own site, an organisation marker in the name, or — for sites that simply
 * list sponsors as text — a list or table item that survives every negative filter above.
 */
function sponsorsFromNodes(
  nodes: HtmlNode[], pageUrl: string, classification: "sponsor" | "exhibitor" | "partner", tier: string | null
): SponsorEntry[] {
  const found: SponsorEntry[] = [];
  const pageHost = hostOf(pageUrl);
  const push = (name: string | null, logoUrl: string | null) => {
    const cleaned = clean(name, 120);
    if (!cleaned || !looksLikeSponsorName(cleaned)) return;
    found.push({ name: cleaned, tier, classification, logoUrl, source_url: pageUrl });
  };

  const seenNodes = new Set<HtmlNode>();
  for (const node of nodes) {
    if (node.type !== "element" || seenNodes.has(node) || insideChrome(node)) continue;
    if (node.tag === "img") {
      const alt = clean(attr(node, "alt"), 120);
      // "Acme Corp logo" names a sponsor; a bare "logo" names nothing.
      const name = alt ? alt.replace(/\s*\b(logo|logotype|banner|image)\b\s*$/i, "").trim() : null;
      if (name) push(name, absoluteUrl(attr(node, "src") || attr(node, "data-src"), pageUrl));
      seenNodes.add(node);
      continue;
    }
    if (node.tag === "a") {
      const img = byTag(node, "img")[0];
      const alt = img ? clean(attr(img, "alt"), 120) : null;
      const fromAlt = alt ? alt.replace(/\s*\b(logo|logotype|banner|image)\b\s*$/i, "").trim() : null;
      const name = fromAlt || clean(attr(node, "title"), 120) || clean(textOf(node), 120);
      const href = absoluteUrl(attr(node, "href"), pageUrl);
      const outbound = !!href && !!pageHost && hostOf(href) !== pageHost;
      // A logo, or a link to the organisation's own site. A link back into this same site is a
      // navigation item until something else says otherwise.
      if (img || outbound || (name && ORG_MARKER.test(name))) {
        push(name, img ? absoluteUrl(attr(img, "src") || attr(img, "data-src"), pageUrl) : null);
      }
      for (const inner of walk(node)) seenNodes.add(inner);
      continue;
    }
  }
  // Sites that list sponsors as plain text. Kept, because plenty do — but only from a genuine list
  // or table item, and only when nothing above recognised it as furniture or a programme entry.
  for (const node of nodes) {
    if (node.type !== "element" || seenNodes.has(node) || insideChrome(node)) continue;
    if (!["li", "td", "figcaption"].includes(node.tag)) continue;
    if (byTag(node, "a", "img").length > 0) continue;
    const text = clean(textOf(node), 120);
    if (!text || text.split(/\s+/).length > 8) continue;
    push(text, null);
    for (const inner of walk(node)) seenNodes.add(inner);
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// Programme
// ---------------------------------------------------------------------------------------------

const TIME_RE = /\b(?:[01]?\d|2[0-3]):[0-5]\d(?:\s*[–—-]\s*(?:[01]?\d|2[0-3]):[0-5]\d)?(?:\s*(?:am|pm))?\b|\b(?:1[0-2]|[1-9])\s*(?:am|pm)\b/i;
const DATE_RE = /\b(?:\d{1,2}\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s*\d{0,4}(?:,\s*\d{4})?\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b|\b(?:mon|tues?|wed(?:nes)?|thur?s?|fri|sat(?:ur)?|sun)(?:day)?\b/i;
const SESSION_TYPE = /\b(workshops?|tutorials?|panels?|keynotes?|plenar(?:y|ies)|posters?|special\s+sessions?|symposi(?:um|a)|round\s?tables?|demos?|short\s+courses?|masterclass(?:es)?)\b/i;

function sessionTypeOf(...texts: Array<string | null>): string | null {
  for (const text of texts) {
    const match = String(text || "").match(SESSION_TYPE);
    if (match) return match[1].toLowerCase().replace(/s$/, "").replace(/\s+/g, "_");
  }
  return null;
}

const PROGRAM_HEADERS = {
  time: /\b(time|start|hour|slot|when)\b/i,
  date: /\b(date|day)\b/i,
  title: /\b(session|title|topic|activity|presentation|event|item|programme?)\b/i,
  track: /\b(track|stream|theme|strand)\b/i,
  location: /\b(room|hall|venue|location|place|building)\b/i,
  speaker: /\b(speakers?|presenters?|chair|author)\b/i,
} as const;

function sessionsFromTable(table: HtmlNode, pageUrl: string, fallbackTrack: string | null): ProgramSession[] {
  const rows = byTag(table, "tr");
  if (rows.length === 0) return [];
  const headerCells = byTag(rows[0], "th", "td").map((cell) => clean(textOf(cell), 60) || "");
  const columns: Partial<Record<keyof typeof PROGRAM_HEADERS, number>> = {};
  const hasHeader = byTag(rows[0], "th").length > 0 || headerCells.some((header) => PROGRAM_HEADERS.time.test(header) || PROGRAM_HEADERS.title.test(header));
  if (hasHeader) {
    headerCells.forEach((header, index) => {
      for (const key of ["time", "date", "track", "location", "speaker", "title"] as Array<keyof typeof PROGRAM_HEADERS>) {
        if (columns[key] === undefined && PROGRAM_HEADERS[key].test(header)) { columns[key] = index; return; }
      }
    });
  }
  const sessions: ProgramSession[] = [];
  for (const row of rows.slice(hasHeader ? 1 : 0)) {
    const cells = byTag(row, "td", "th");
    if (cells.length === 0) continue;
    const texts = cells.map((cell) => clean(textOf(cell), 300));
    const timeText = columns.time !== undefined ? texts[columns.time] : texts.find((text) => text && TIME_RE.test(text)) || null;
    const dateText = columns.date !== undefined ? texts[columns.date] : null;
    const trackText = columns.track !== undefined ? texts[columns.track] : null;
    const locationText = columns.location !== undefined ? texts[columns.location] : null;
    const speakerText = columns.speaker !== undefined ? texts[columns.speaker] : null;
    let titleText = columns.title !== undefined ? texts[columns.title] : null;
    if (!titleText) {
      // Whatever is left once the labelled columns are accounted for, longest first: a session
      // title is the only free-text column a programme table has.
      const used = new Set([columns.time, columns.date, columns.track, columns.location, columns.speaker].filter((index) => index !== undefined));
      titleText = texts
        .filter((text, index) => !used.has(index) && text && text !== timeText && !TIME_RE.test(text))
        .sort((left, right) => (right?.length || 0) - (left?.length || 0))[0] || null;
    }
    if (!titleText || titleText.length < 3) continue;
    sessions.push({
      date: dateText, time: timeText, title: titleText.slice(0, 240),
      speakerName: speakerText && looksLikePersonName(speakerText) ? speakerText : null,
      speakerImageUrl: null,
      track: trackText || fallbackTrack,
      session_type: sessionTypeOf(titleText, trackText, fallbackTrack),
      location: locationText,
      source_url: pageUrl,
    });
  }
  return sessions;
}

/** "09:00 – 09:45  Opening keynote" and its variants, as a list rather than a table. */
function sessionFromLine(text: string, pageUrl: string, fallbackTrack: string | null): ProgramSession | null {
  const line = clean(text, 300);
  if (!line || line.length < 6) return null;
  const time = line.match(TIME_RE)?.[0] || null;
  const date = line.match(DATE_RE)?.[0] || null;
  if (!time && !date) return null;
  let title = line;
  if (time) title = title.replace(time, " ");
  if (date && title.includes(date)) title = title.replace(date, " ");
  const cleaned = clean(title.replace(/^[\s–—\-:,.|]+/, ""), 240);
  if (!cleaned || cleaned.length < 4) return null;
  return {
    date, time, title: cleaned, speakerName: null, speakerImageUrl: null,
    track: fallbackTrack, session_type: sessionTypeOf(cleaned, fallbackTrack),
    location: null, source_url: pageUrl,
  };
}

function sessionsFromNodes(nodes: HtmlNode[], pageUrl: string, fallbackTrack: string | null): ProgramSession[] {
  const sessions: ProgramSession[] = [];
  const consumed = new Set<HtmlNode>();
  for (const node of nodes) {
    if (node.type !== "element" || consumed.has(node)) continue;
    if (node.tag !== "table") continue;
    sessions.push(...sessionsFromTable(node, pageUrl, fallbackTrack));
    for (const inner of walk(node)) consumed.add(inner);
  }
  for (const node of nodes) {
    if (node.type !== "element" || consumed.has(node)) continue;
    if (!["li", "p", "dd"].includes(node.tag)) continue;
    const session = sessionFromLine(textOf(node), pageUrl, fallbackTrack);
    if (session) { sessions.push(session); for (const inner of walk(node)) consumed.add(inner); }
  }
  return sessions;
}

const DEADLINE_WORD = /\b(deadline|due|closes?|submission|notification|camera[-\s]?ready|registration\s+ends?)\b/i;

function importantDatesFromNodes(nodes: HtmlNode[]): Array<{ label: string; date: string; isDeadline: boolean }> {
  const dates: Array<{ label: string; date: string; isDeadline: boolean }> = [];
  const record = (label: string | null, value: string | null) => {
    const cleanLabel = clean(label, 120);
    const cleanValue = clean(value, 80);
    if (!cleanLabel || !cleanValue || !DATE_RE.test(cleanValue)) return;
    if (dates.some((entry) => entry.label.toLowerCase() === cleanLabel.toLowerCase())) return;
    dates.push({ label: cleanLabel, date: cleanValue, isDeadline: DEADLINE_WORD.test(cleanLabel) });
  };
  for (const node of nodes) {
    if (node.type !== "element") continue;
    if (node.tag === "tr") {
      const cells = byTag(node, "td", "th").map((cell) => clean(textOf(cell), 200));
      if (cells.length >= 2) record(cells[0], cells[1]);
      continue;
    }
    if (["li", "p", "dd"].includes(node.tag)) {
      const text = clean(textOf(node), 240);
      if (!text) continue;
      const split = text.split(/\s*[:–—]\s+|\s{2,}/);
      if (split.length >= 2) record(split[0], split.slice(1).join(" "));
    }
  }
  return dates;
}

// ---------------------------------------------------------------------------------------------
// Community
// ---------------------------------------------------------------------------------------------

const SOCIAL_PLATFORMS: Array<{ platform: string; host: RegExp }> = [
  { platform: "X", host: /(^|\.)(twitter\.com|x\.com)$/i },
  { platform: "LinkedIn", host: /(^|\.)linkedin\.com$/i },
  { platform: "Facebook", host: /(^|\.)facebook\.com$/i },
  { platform: "YouTube", host: /(^|\.)(youtube\.com|youtu\.be)$/i },
  { platform: "Instagram", host: /(^|\.)instagram\.com$/i },
  { platform: "Mastodon", host: /(^|\.)(mastodon\.(social|online)|fosstodon\.org)$/i },
  { platform: "Bluesky", host: /(^|\.)bsky\.(app|social)$/i },
  { platform: "GitHub", host: /(^|\.)github\.com$/i },
  { platform: "Slack", host: /(^|\.)slack\.com$/i },
  { platform: "Discord", host: /(^|\.)discord\.(gg|com)$/i },
  { platform: "Telegram", host: /(^|\.)t\.me$/i },
  { platform: "WeChat", host: /(^|\.)weixin\.qq\.com$/i },
  { platform: "Weibo", host: /(^|\.)weibo\.com$/i },
];

function communityFromDocument(root: HtmlNode, pageUrl: string): CommunityInfo | null {
  const social: Array<{ platform: string; url: string }> = [];
  const seen = new Set<string>();
  for (const anchor of byTag(root, "a")) {
    const href = absoluteUrl(attr(anchor, "href"), pageUrl);
    if (!href) continue;
    let host = "";
    try { host = new URL(href).hostname; } catch { continue; }
    const match = SOCIAL_PLATFORMS.find((entry) => entry.host.test(host));
    if (!match) continue;
    const key = `${match.platform}:${href.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    social.push({ platform: match.platform, url: href });
  }
  // A hashtag counts only where the page is talking about following the conference; a stray "#"
  // anchor elsewhere is markup, not a handle.
  let hashtag: string | null = null;
  for (const node of walk(root)) {
    if (node.type !== "element") continue;
    const context = `${classOf(node)} ${node.tag}`;
    if (!/social|hashtag|follow|twitter|community/i.test(context)) continue;
    const match = textOf(node).match(/#([A-Za-z][A-Za-z0-9_]{2,29})\b/);
    if (match) { hashtag = `#${match[1]}`; break; }
  }
  const email = emailIn(root);
  if (social.length === 0 && !hashtag && !email) return null;
  return { social_media: social.slice(0, 12), hashtag, contact_email: email, source_url: pageUrl };
}

// ---------------------------------------------------------------------------------------------
// schema.org — the organiser's own machine-readable statement, and therefore the first thing read
// ---------------------------------------------------------------------------------------------

function nameOf(value: unknown): string | null {
  if (typeof value === "string") return clean(value, 200);
  if (value && typeof value === "object") return clean(String((value as Record<string, unknown>).name ?? ""), 200);
  return null;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function affiliationOf(person: Record<string, unknown>): string | null {
  for (const key of ["affiliation", "worksFor", "memberOf"]) {
    const name = nameOf(person[key]);
    // schema.org named the field, so this is labelled evidence and needs no marker word.
    if (name && looksLikeAffiliation(name, true)) return name;
  }
  return null;
}

function deepFromJsonLd(root: HtmlNode, pageUrl: string): DeepSectionExtraction {
  const result = emptyDeepExtraction();
  const sessions: ProgramSession[] = [];
  for (const object of collectJsonLdObjects(root)) {
    if (!object || typeof object !== "object") continue;

    for (const raw of asArray(object.performer)) {
      const person = (typeof raw === "object" && raw ? raw : {}) as Record<string, unknown>;
      const name = nameOf(raw);
      if (!name || !looksLikePersonName(name)) continue;
      result.speakers.push({
        name: stripHonorifics(name),
        title: looksLikeJobTitle(nameOf(person.jobTitle)) ? nameOf(person.jobTitle) : null,
        org: affiliationOf(person),
        // schema.org states that they perform, not in what capacity. It is not a keynote unless
        // something says keynote.
        role: null,
        presentation_title: null,
        email: clean(String(person.email ?? ""), 120),
        imageUrl: absoluteUrl(typeof person.image === "string" ? person.image : nameOf(person.image), pageUrl),
        source_url: pageUrl,
      });
    }

    for (const raw of asArray(object.sponsor)) {
      const name = nameOf(raw);
      if (!name || NON_SPONSOR_NAME.test(name)) continue;
      result.sponsors.push({ name, tier: null, classification: "sponsor", logoUrl: null, source_url: pageUrl });
    }

    for (const raw of asArray(object.subEvent)) {
      const sub = (typeof raw === "object" && raw ? raw : {}) as Record<string, unknown>;
      const title = nameOf(sub.name ?? raw);
      if (!title) continue;
      const startDate = clean(String(sub.startDate ?? ""), 60);
      sessions.push({
        date: startDate ? startDate.slice(0, 10) : null,
        time: startDate && startDate.includes("T") ? startDate.slice(11, 16) : null,
        title, speakerName: nameOf(asArray(sub.performer)[0]),
        speakerImageUrl: null, track: null,
        session_type: sessionTypeOf(title, String(sub["@type"] ?? "")),
        location: nameOf(sub.location), source_url: pageUrl,
      });
    }
  }
  if (sessions.length) {
    result.program = { sessions, tracks: [], important_dates: [], source_url: pageUrl };
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// One page in, one set of deep sections out
// ---------------------------------------------------------------------------------------------

/** The section a URL's own path advertises, for pages whose heading does not repeat it. */
export function sectionForPath(url: string): DeepSection | null {
  let path = "";
  try { path = decodeURIComponent(new URL(url).pathname).replace(/[_+]/g, "-"); } catch { return null; }
  for (const section of ["committee", "speakers", "sponsors", "program", "community"] as DeepSection[]) {
    if (SECTION_LINK_PATTERNS[section].test(path)) return section;
  }
  return null;
}

const LIMITS = { speakers: 120, committee: 400, sponsors: 250, sessions: 600, tracks: 40 };

export function extractDeepSections(html: string, pageUrl: string): DeepSectionExtraction {
  const root = parseHtml(html);
  const result = deepFromJsonLd(root, pageUrl);
  const bodyNodes = [...walk(root)].filter((node) => node.type === "element");

  const blocks = headingBlocks(root);
  const tracks = new Set<string>();
  const sessions: ProgramSession[] = [];
  const importantDates: Array<{ label: string; date: string; isDeadline: boolean }> = [];
  let programSourceUrl: string | null = result.program?.source_url ?? null;

  for (const block of blocks) {
    const section = sectionForHeading(block.heading);
    if (!section) continue;
    switch (section) {
      case "speakers": {
        const role = speakerRoleFromHeading(block.heading);
        for (const person of peopleFromNodes(block.nodes, pageUrl)) {
          result.speakers.push({
            name: person.name, title: person.title, org: person.org,
            role: person.role || role, presentation_title: person.presentationTitle,
            email: person.email, imageUrl: person.imageUrl, source_url: pageUrl,
          });
        }
        break;
      }
      case "committee": {
        const role = committeeRoleFromHeading(block.heading);
        for (const person of peopleFromNodes(block.nodes, pageUrl)) {
          result.committee.push({
            name: person.name, title: person.title, org: person.org,
            role: person.role || role, email: person.email, imageUrl: person.imageUrl, source_url: pageUrl,
          });
        }
        break;
      }
      case "sponsors": {
        result.sponsors.push(...sponsorsFromNodes(
          block.nodes, pageUrl, sponsorClassificationFromHeading(block.heading), tierFromHeading(block.heading)
        ));
        break;
      }
      case "importantDates": {
        importantDates.push(...importantDatesFromNodes(block.nodes));
        programSourceUrl ??= pageUrl;
        break;
      }
      case "program": {
        const track = /\b(track|stream|strand)\b/i.test(block.heading) ? clean(block.heading, 80) : null;
        if (track) tracks.add(track);
        const found = sessionsFromNodes(block.nodes, pageUrl, track);
        if (found.length) { sessions.push(...found); programSourceUrl ??= pageUrl; }
        break;
      }
      case "community":
        break;
    }
  }

  // A page whose path says /speakers but whose heading says only the conference name still states
  // its speakers; read the document as that section rather than returning nothing. What it must
  // not do is read the whole page indiscriminately: a block another heading has already claimed
  // for a different section is that section's, so an "Attendees" or "Organising Committee" list
  // on a /speakers page never becomes a speaker.
  const claimedElsewhere = new Set<HtmlNode>();
  for (const block of blocks) {
    const section = sectionForHeading(block.heading);
    for (const node of block.nodes) claimedElsewhere.add(node);
    if (section) continue;
    // An unrecognised heading is not evidence of anything either way; leave its nodes claimed so
    // the fallback stays confined to content the page did not file under some other label.
  }
  const unclaimed = bodyNodes.filter((node) => !claimedElsewhere.has(node));
  const fallbackNodes = (keep: HeadingSection) => [
    ...unclaimed,
    ...blocks.filter((block) => sectionForHeading(block.heading) === keep).flatMap((block) => block.nodes),
  ];
  const hint = sectionForPath(pageUrl);
  if (hint === "speakers" && result.speakers.length === 0) {
    for (const person of peopleFromNodes(fallbackNodes("speakers"), pageUrl)) {
      result.speakers.push({
        name: person.name, title: person.title, org: person.org,
        role: person.role || "Speaker", presentation_title: person.presentationTitle,
        email: person.email, imageUrl: person.imageUrl, source_url: pageUrl,
      });
    }
  }
  if (hint === "committee" && result.committee.length === 0) {
    for (const person of peopleFromNodes(fallbackNodes("committee"), pageUrl)) {
      result.committee.push({
        name: person.name, title: person.title, org: person.org,
        role: person.role, email: person.email, imageUrl: person.imageUrl, source_url: pageUrl,
      });
    }
  }
  if (hint === "sponsors" && result.sponsors.length === 0) {
    result.sponsors.push(...sponsorsFromNodes(fallbackNodes("sponsors"), pageUrl, "sponsor", null));
  }
  if (hint === "program" && sessions.length === 0) {
    const found = sessionsFromNodes(fallbackNodes("program"), pageUrl, null);
    if (found.length) { sessions.push(...found); programSourceUrl ??= pageUrl; }
  }

  for (const session of sessions) if (session.track) tracks.add(session.track);
  const mergedSessions = [...(result.program?.sessions || []), ...sessions];
  if (mergedSessions.length || importantDates.length) {
    result.program = {
      sessions: mergedSessions.slice(0, LIMITS.sessions),
      tracks: [...tracks].slice(0, LIMITS.tracks),
      important_dates: importantDates,
      source_url: programSourceUrl || pageUrl,
    };
  }
  result.community = communityFromDocument(root, pageUrl);

  return dedupeDeepExtraction(result);
}

// ---------------------------------------------------------------------------------------------
// Merging across the pages of one conference
// ---------------------------------------------------------------------------------------------

function normalizedName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function dedupeDeepExtraction(input: DeepSectionExtraction): DeepSectionExtraction {
  const speakers = new Map<string, SpeakerEntry>();
  for (const speaker of input.speakers) {
    const key = personKey(speaker.name);
    if (!key) continue;
    const existing = speakers.get(key);
    if (!existing) { speakers.set(key, speaker); continue; }
    existing.title ??= speaker.title;
    existing.org ??= speaker.org;
    // "Keynote" outranks the generic "Speaker" a broader heading supplied.
    if (existing.role === "Speaker" && speaker.role && speaker.role !== "Speaker") existing.role = speaker.role;
    existing.role ??= speaker.role;
    existing.presentation_title ??= speaker.presentation_title;
    existing.email ??= speaker.email;
    existing.imageUrl ??= speaker.imageUrl;
  }

  const committee = new Map<string, CommitteeMember>();
  for (const member of input.committee) {
    const key = personKey(member.name);
    if (!key) continue;
    const existing = committee.get(key);
    if (!existing) { committee.set(key, member); continue; }
    existing.title ??= member.title;
    existing.org ??= member.org;
    existing.role ??= member.role;
    existing.email ??= member.email;
    existing.imageUrl ??= member.imageUrl;
  }

  const sponsors = new Map<string, SponsorEntry>();
  for (const sponsor of input.sponsors) {
    const key = `${sponsor.classification}:${normalizedName(sponsor.name)}`;
    if (!normalizedName(sponsor.name)) continue;
    const existing = sponsors.get(key);
    if (!existing) { sponsors.set(key, sponsor); continue; }
    existing.tier ??= sponsor.tier;
    existing.logoUrl ??= sponsor.logoUrl;
  }

  let program = input.program;
  if (program) {
    const seen = new Set<string>();
    const sessions = program.sessions.filter((session) => {
      const key = `${session.date || ""}|${session.time || ""}|${normalizedName(session.title)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    program = sessions.length || program.important_dates.length
      ? { ...program, sessions }
      : null;
  }

  return {
    program,
    speakers: [...speakers.values()].slice(0, LIMITS.speakers),
    committee: [...committee.values()].slice(0, LIMITS.committee),
    sponsors: [...sponsors.values()].slice(0, LIMITS.sponsors),
    community: input.community,
  };
}

/** Combines what several pages of one conference stated, keeping each field's own source URL. */
export function mergeDeepExtractions(parts: DeepSectionExtraction[]): DeepSectionExtraction {
  const combined = emptyDeepExtraction();
  const sessions: ProgramSession[] = [];
  const tracks = new Set<string>();
  const importantDates: Array<{ label: string; date: string; isDeadline: boolean }> = [];
  let programSource: string | null = null;
  const social = new Map<string, { platform: string; url: string }>();
  let hashtag: string | null = null;
  let contactEmail: string | null = null;
  let communitySource: string | null = null;

  for (const part of parts) {
    combined.speakers.push(...part.speakers);
    combined.committee.push(...part.committee);
    combined.sponsors.push(...part.sponsors);
    if (part.program) {
      sessions.push(...part.program.sessions);
      for (const track of part.program.tracks) tracks.add(track);
      for (const entry of part.program.important_dates) {
        if (!importantDates.some((existing) => existing.label.toLowerCase() === entry.label.toLowerCase())) {
          importantDates.push(entry);
        }
      }
      programSource ??= part.program.source_url;
    }
    if (part.community) {
      for (const link of part.community.social_media) social.set(`${link.platform}:${link.url.toLowerCase()}`, link);
      hashtag ??= part.community.hashtag;
      contactEmail ??= part.community.contact_email;
      communitySource ??= part.community.source_url;
    }
  }

  if (sessions.length || importantDates.length) {
    combined.program = {
      sessions, tracks: [...tracks], important_dates: importantDates,
      source_url: programSource,
    };
  }
  if (social.size || hashtag || contactEmail) {
    combined.community = {
      social_media: [...social.values()], hashtag, contact_email: contactEmail, source_url: communitySource,
    };
  }
  return dedupeDeepExtraction(combined);
}

/** Whether a section holds anything at all — the test for "is this still empty in production". */
export function deepSectionPopulated(extraction: DeepSectionExtraction, section: DeepSection): boolean {
  switch (section) {
    case "program": return !!extraction.program && (extraction.program.sessions.length > 0 || extraction.program.important_dates.length > 0);
    case "speakers": return extraction.speakers.length > 0;
    case "committee": return extraction.committee.length > 0;
    case "sponsors": return extraction.sponsors.length > 0;
    case "community": return !!extraction.community && (
      extraction.community.social_media.length > 0 || !!extraction.community.hashtag || !!extraction.community.contact_email
    );
  }
}
