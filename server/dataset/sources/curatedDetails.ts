// The deep sections of a conference, supplied as a curated list rather than read off its website.
//
// A row here does not create a conference. It attaches programme, speakers, committee, fees and
// sponsors to a record the catalogue already holds, which is why matching is by title and why a
// row that matches nothing is reported rather than quietly turned into a new event.
//
// Everything in `curated.ts` about tidy spreadsheets applies here and then some, because these
// cells are paragraphs. A cell can state a fact, state that a fact does not exist yet, state that
// nobody could read it, and — the case that matters most — state a fact and then withdraw it. One
// row of the supplied AAPG list names Chevron, ExxonMobil, Core Laboratories and Devon and then
// says in the same breath that they are NOT confirmed sponsors of that event. A parser that reads
// "Emerald: Chevron, ExxonMobil" and stops has just published four false sponsorships.
//
// So: a cell carrying a withdrawal is never structured, only quoted. And every cell is kept
// verbatim whether or not anything parsed out of it, because the sentence is the evidence.

import { parseCuratedDates } from "./curated";
import type {
  LaunchConferenceDetails, LaunchDetailAgendaEntry, LaunchDetailCallForPapers, LaunchDetailFee,
  LaunchDetailPerson,
  LaunchDetailProse,
  LaunchDetailSection, LaunchDetailSponsor, LaunchSectionAvailability, LaunchUnstructuredReason,
} from "../types";

export type SectionAvailability = LaunchSectionAvailability;
export type DetailPerson = LaunchDetailPerson;
export type DetailSponsor = LaunchDetailSponsor;
export type DetailFee = LaunchDetailFee;
export type UnstructuredReason = LaunchUnstructuredReason;
export type DetailSection<T> = LaunchDetailSection<T>;
export type DetailProse = LaunchDetailProse;

export interface CuratedDetailRow {
  name: string;
  dates: string;
  venue: string;
  program: string;
  keynoteSpeakers: string;
  committee: string;
  pricing: string;
  sponsors: string;
  website: string;
  safetyNote: string;
}

export interface CuratedDetail extends Omit<LaunchConferenceDetails, "source"> {
  /** The conference this belongs to, as the list wrote it. */
  title: string;
  /** For checking the row was attached to the right event, never for overwriting the record. */
  datesText: string | null;
  website: string | null;
}

/**
 * A cell that withdraws what it just said.
 *
 * This is the one pattern that must beat every other rule. "Emerald: Chevron, ExxonMobil … but
 * these are NOT confirmed as sponsors of the Latin America Summit specifically" is perfectly
 * parseable and completely wrong to parse. Likewise a price range carried over from a previous
 * edition and marked "not confirmed for this specific edition".
 */
const WITHDRAWN = /\bnot\s+confirmed\b|\bnot\s+verified\b|\bunconfirmed\b/i;

/** The cell says this does not exist yet. */
const NOT_ANNOUNCED =
  /\bnot\s+(?:yet\s+)?(?:been\s+)?(?:announced|published|released|available|confirmed|finalized|finalised|captured)\b|\bto\s+be\s+(?:announced|confirmed|determined)\b|\b(?:pricing|programme?|schedule|details?)\s+pending\b|\b(?:tbd|tba)\b/i;

/** The cell says nobody could read it. A different fact with a different remedy, and the reason
 *  the two can never share a message on screen. */
const UNREADABLE =
  /\bnot\s+extracted\b|\bblocks?\s+automated\s+access\b|\bcould\s+not\s+be\s+(?:pulled|extracted|read|retrieved)\b|\bnot\s+fully\s+(?:accessible|itemized|itemised)\b|\bnot\s+individually\s+named\b|\bnot\s+itemized\b|\bnot\s+itemised\b/i;

function clean(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/** Splits on separators that are not inside brackets, so "(Aramco, KOC)" survives a comma split.
 *
 *  `skip` vetoes a boundary the caller knows is not one. */
export function splitOutsideBrackets(
  text: string,
  separators: string[],
  skip?: (text: string, index: number, separator: string) => boolean
): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth = Math.max(0, depth - 1);

    if (depth === 0) {
      const hit = separators.find((separator) => text.startsWith(separator, index));
      if (hit && !skip?.(text, index, hit)) {
        parts.push(current);
        current = "";
        index += hit.length - 1;
        continue;
      }
    }
    current += char;
  }
  parts.push(current);
  return parts.map(clean).filter(Boolean);
}

/** The full stop in "K.L. Chong" ends an initial, not a sentence. Splitting there filed a real
 *  committee member under the name "Chong". */
function endsAnInitial(text: string, index: number, separator: string): boolean {
  if (!separator.startsWith(".")) return false;
  const letter = text[index - 1];
  const before = text[index - 2];
  return /[A-Z]/.test(letter || "") && (index - 1 === 0 || /[^A-Za-z]/.test(before || ""));
}

/** Sentence and clause boundaries, for cells written as prose. */
function segments(cell: string): string[] {
  return splitOutsideBrackets(cell, ["; ", ". ", ";"], endsAnInitial)
    .map((part) => part.replace(/\.$/, "").trim())
    .filter(Boolean);
}

// Words that do not appear in a person's name. Vocabulary, not shape: "Managed by the RMS
// Executive Committee" and "Sau Hooi Yee" are structurally identical, and only the words tell them
// apart. Each entry below is here because this file contains a cell that would otherwise have
// stored a sentence as a committee member.
const NOT_IN_A_NAME =
  /\b(?:managed|by|the|a|an|of|for|committee|officers?|representatives?|individual|names?|published|announced|list|listed|site|plus|additional|members?|includes?|including|also|full|not|yet|specific|available|sources?|beyond|general|description|served|as|session|chairs?|talks?|from|and|with|via|see|check|program|meeting|annual|section|executive|opportunities|sponsorship|tiers?)\b/i;

const NAME_PARTICLES = new Set(["van", "von", "de", "del", "della", "der", "den", "di", "da", "bin", "al", "el", "ter", "ten"]);

/** Whether this text, taken from before an affiliation, reads as somebody's name. */
export function looksLikePersonName(text: string): boolean {
  const value = clean(text).replace(/^[-–—•*]\s*/, "");
  if (!value || value.length < 2 || value.length > 60) return false;
  if (/\d/.test(value)) return false;
  if (NOT_IN_A_NAME.test(value)) return false;
  const words = value.split(" ").filter(Boolean);
  if (words.length < 1 || words.length > 5) return false;
  return words.every(
    (word) => NAME_PARTICLES.has(word.toLowerCase()) || /^[A-Z][A-Za-z'’.\-]*$/.test(word)
  );
}

/** "Exploration Manager - Offshore Directorate, Staatsolie" → title and organisation. */
function splitAffiliation(raw: string): { title: string | null; org: string | null } {
  const value = clean(raw);
  if (!value) return { title: null, org: null };
  const parts = splitOutsideBrackets(value, [", "]);
  if (parts.length < 2) return { title: null, org: value };
  return { title: parts.slice(0, -1).join(", "), org: parts[parts.length - 1] };
}

/** A leading heading that names the role of everyone after it.
 *
 *  A colon before the first affiliation is always a heading here: "Inaugural Keynote:",
 *  "Technical Keynotes:", "Welcome/Opening Remarks:". Nobody's name contains one, which is what
 *  makes this safe — an earlier version tested whether the text looked like a name instead, decided
 *  "Inaugural Keynote" did, and threw away the two keynote speakers behind it. */
function leadingRole(segment: string): { role: string | null; rest: string } {
  const colon = segment.match(/^([^:()]{2,60}?)\s*:\s*(.+)$/);
  if (colon) return { role: clean(colon[1]), rest: clean(colon[2]) };
  const includes = segment.match(/^(.{2,60}?)\s+(?:also\s+)?includes?\s+(.+)$/i);
  if (includes) return { role: clean(includes[1]), rest: clean(includes[2]) };
  return { role: null, rest: segment };
}

/**
 * People named in a cell, and nothing else in it.
 *
 * An entry must carry a parenthesised affiliation. Every real person in the supplied list has one,
 * and requiring it is what stops "Keynote talks from Staatsolie and Ministry representatives" and
 * "plus additional members (full list on site)" from becoming people. A list that gives bare names
 * therefore stores none — the cell is still shown in full, so nothing is hidden, and inventing a
 * speaker costs more than showing the sentence that names them.
 */
export function parsePeople(cell: string, defaultRole: string): DetailPerson[] {
  const text = clean(cell);
  if (!text || WITHDRAWN.test(text)) return [];

  const people: DetailPerson[] = [];
  const seen = new Set<string>();

  const add = (name: string, role: string | null, org: string | null, title: string | null, topic: string | null) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    people.push({ name, role: role || defaultRole, org, title, topic });
  };

  for (const sentence of splitOutsideBrackets(text, [". "], endsAnInitial)) {
    // A heading introduces everyone after it until the sentence ends: "Advisory: Osamu Tabata;
    // Arcady Zhukov" names two advisors, and splitting on the semicolon first would have left the
    // second one with no heading and thrown him away.
    let currentRole: string | null = null;
    for (const group of splitOutsideBrackets(sentence.replace(/\.$/, ""), ["; ", ";"])) {
      const { role, rest } = leadingRole(group);
      if (role) currentRole = role;

      for (const entry of splitOutsideBrackets(rest, [", "])) {
        const withAffiliation = entry.match(/^([^()]+?)\s*\(([^)]*)\)\s*(.*)$/);
        if (withAffiliation) {
          const [, namePart, affiliation, tail] = withAffiliation;
          // "Steve Chappell/Robert Clarke/Joshua Dixon (Wood Mackenzie)" — one affiliation, three
          // people. The "&" in "(CO2CRC & Adelaide University)" is inside the brackets, untouched.
          const names = namePart.split(/\s*(?:\/|&| and )\s*/).map(clean).filter(Boolean);
          if (names.length === 0 || !names.every(looksLikePersonName)) continue;
          const { title, org } = splitAffiliation(affiliation);
          const topicMatch = tail.match(/^[-–—]\s*(.+)$/);
          const topic = topicMatch ? clean(topicMatch[1]).replace(/^['"“](.*)['"”]$/, "$1") : null;
          for (const name of names) add(name, currentRole, org, title, topic || null);
          continue;
        }

        // A bare name, accepted only because a heading said what these people are. Without one it
        // stays refused: an unheaded line of prose is not a roster, and this is the rule that keeps
        // "individual meeting-specific committee names not yet published" out of the committee.
        if (currentRole && looksLikePersonName(entry)) add(clean(entry), currentRole, null, null, null);
      }
    }
  }
  return people;
}

const CURRENCY_PREFIX = /^(USD|EUR|GBP|CHF|CAD|AUD|SAR|AED|KWD)\b\s*(?:\([^)]*\))?\s*[-–—,:]?\s*/i;

/**
 * Registration prices, and only the ones stated as prices.
 *
 * The amount must end the clause. That single rule is what separates "Academia $500" from
 * "Refund: full minus $100 fee if cancelled 30+ days prior", which is a refund policy and would
 * otherwise have been published as a registration category called "Refund: full minus".
 */
export function parseFees(cell: string): { fees: DetailFee[]; currency: string | null } {
  const text = clean(cell);
  if (!text || WITHDRAWN.test(text)) return { fees: [], currency: null };

  const currencyMatch = text.match(CURRENCY_PREFIX);
  const currency = currencyMatch ? currencyMatch[1].toUpperCase() : null;

  let schemeLabels: string[] | null = null;
  const fees: DetailFee[] = [];
  for (const raw of segments(text)) {
    let segment = raw.replace(CURRENCY_PREFIX, "");

    // "Early Bird (pay by 18 Oct) / Standard: Professional Nonmembers $895/$995" names the two
    // columns its prices sit in, once, in front of the first priced clause. Without reading that
    // heading the pair of amounts says nothing about which is which, so it is read rather than
    // assumed — and the heading is only believed where a priced clause actually follows it.
    const declared = segment.match(/^([^:$]{3,45}?)\s*\/\s*([^:$/]{3,45}?)\s*:\s*(.+)$/);
    if (declared && declared[3].includes("$")) {
      schemeLabels = [declared[1], declared[2]].map((label) => clean(label.replace(/\([^)]*\)/g, "")));
      segment = clean(declared[3]);
    }

    const match = segment.match(/^(.{2,60}?)\s*\$\s*([\d,]+)(?:\s*\/\s*\$\s*([\d,]+))?$/);
    if (!match) continue;
    const category = clean(match[1]).replace(/[-–—,:]$/, "").trim();
    if (!category || category.split(" ").length > 8) continue;

    const amounts = [match[2], match[3]].filter(Boolean) as string[];
    const value = (amount: string) => Number(amount.replace(/,/g, ""));
    if (amounts.length === 2) {
      // Two prices and no heading saying what each is for. Picking one would be a guess.
      if (!schemeLabels) continue;
      amounts.forEach((amount, index) => {
        fees.push({ category: `${category} (${schemeLabels![index]})`, amount: value(amount), currency });
      });
      continue;
    }
    fees.push({ category, amount: value(amounts[0]), currency });
  }
  return { fees, currency };
}

const SPONSOR_LABEL = /^((?:[A-Za-z&/ ]{0,40}?)(?:sponsors?|partners?|exhibitors?|organizations?|organisations?|society|host|supporters?|patrons?|gold|silver|bronze|platinum)(?:[A-Za-z& ]{0,20})?)\s*:\s*(.+)$/i;

/**
 * Organisations the list filed under a sponsorship label.
 *
 * A sentence without a label is prose, not a sponsor: "Full exhibitor list/floor plan on Expocad"
 * and "Sponsorship tiers range Patron ($2,500+) to Principal ($30,000+)" both sit in sponsor cells
 * of this list and neither names a sponsor.
 */
export function parseSponsors(cell: string): DetailSponsor[] {
  const text = clean(cell);
  if (!text || WITHDRAWN.test(text)) return [];

  const sponsors: DetailSponsor[] = [];
  const seen = new Set<string>();
  for (const sentence of splitOutsideBrackets(text, [". "])) {
    const match = sentence.replace(/\.$/, "").match(SPONSOR_LABEL);
    if (!match) continue;
    const tier = clean(match[1]);
    for (const value of splitOutsideBrackets(match[2], [", "])) {
      const name = clean(value).replace(/\.$/, "");
      if (!name || name.length > 90 || /\$/.test(name)) continue;
      // A sponsor is an organisation. A clause about the sponsorship programme is not one.
      if (/\b(?:tiers?|range|opportunities|available|open|contact|see|check|list|plan|section)\b/i.test(name)) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      sponsors.push({ name, tier: tier || null });
    }
  }
  return sponsors;
}

/**
 * The venue, when the cell names one.
 *
 * Half the rows of this list put a place in the venue column — "Kuwait City, Al Ahmadi, Kuwait",
 * "Houston, Texas" — because no venue has been chosen yet. Storing the first comma-separated piece
 * as the venue name would put the city in the venue field of every one of them, so the record's
 * own city is what decides: where the cell opens with it, the cell is an address and nothing else.
 */
export function splitVenue(cell: string, recordCity: string | null): { name: string | null; address: string | null } {
  const text = clean(cell);
  const parts = splitOutsideBrackets(text, [", "]);
  // "TBD" on its own is not an address either.
  if (!text || parts.length === 0 || (parts.length === 1 && NOT_ANNOUNCED.test(text))) {
    return { name: null, address: null };
  }

  const head = parts[0];
  const city = clean(recordCity || "").toLowerCase();
  const headIsThePlace = city !== "" && head.toLowerCase().replace(/\s*\(.*\)$/, "") === city;
  if (headIsThePlace || parts.length === 1) return { name: null, address: text };
  return { name: head, address: parts.slice(1).join(", ") || null };
}

/** Classifies a cell once its structured entries (if any) are known. */
function availabilityOf(cell: string, itemCount: number): SectionAvailability {
  const text = clean(cell);
  if (!text) return "unread";
  if (itemCount > 0) return "stated";
  if (UNREADABLE.test(text)) return "unread";
  if (NOT_ANNOUNCED.test(text)) return "not_announced";
  return "stated";
}

function sectionOf<T>(cell: string, items: T[]): DetailSection<T> {
  const text = clean(cell) || null;
  const availability = availabilityOf(cell, items.length);
  let unstructuredReason: UnstructuredReason = null;
  if (items.length === 0 && text) {
    unstructuredReason = WITHDRAWN.test(text) ? "withdrawn_in_source" : "no_recognisable_entries";
  }
  return { availability, items, text, unstructuredReason };
}

/**
 * The call for papers, where the programme cell states one.
 *
 * These facts arrive buried in a paragraph about the programme — "Call for Papers: abstracts due
 * 26 June 2026 to submissions@wtgs.org, 500-word max" — so a reader opening the Call for Papers tab
 * saw nothing while the deadline and the submission address sat two tabs away inside a wall of
 * prose. Nothing here is inferred: a value is read only from a clause that names a call for papers
 * or abstracts, which is what stops a short course's registration deadline being published as the
 * date abstracts are due.
 */
export function parseCallForPapers(programText: string): LaunchDetailCallForPapers | null {
  const text = clean(programText);
  if (!text) return null;

  const relevant = segments(text).filter((segment) => /\bcall for\b|\babstracts?\b/i.test(segment));
  if (relevant.length === 0) return null;
  const joined = relevant.join(". ");

  // "closed" and "open" are the source's own words about the call, not a comparison against today:
  // a deadline that has passed is a date the reader can see for themselves, and calling it closed
  // when the organiser has not would be this catalogue speaking for them.
  let status: string | null = null;
  if (/\bcall for [^.]{0,40}?\bclosed\b/i.test(joined)) status = "Closed";
  else if (/\bcall for [^.]{0,40}?\bopen\b/i.test(joined)) status = "Open";

  const email = joined.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0] ?? null;

  let abstractDeadline: string | null = null;
  const dateMatch = joined.match(/\b(\d{1,2}\s+[A-Za-z]{3,9}\s+20\d{2})\b/);
  if (dateMatch) abstractDeadline = parseCuratedDates(dateMatch[1]).startDate;

  const lengthLimit = joined.match(/\b\d+[-\s]word\s+(?:max(?:imum)?|limit)\b/i)?.[0] ?? null;

  if (!status && !email && !abstractDeadline && !lengthLimit) return null;
  return { status, abstractDeadline, submissionEmail: email, lengthLimit, text: joined };
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function isoDate(year: number | null, month: number, day: number): string | null {
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** A clock time the source put in brackets: "(6-10pm)". */
const BRACKETED_TIME = /\((\d{1,2}(?::\d{2})?\s*[-–—]\s*\d{1,2}(?::\d{2})?\s*(?:am|pm))\)/i;

/**
 * The day-by-day schedule a programme paragraph is actually hiding.
 *
 * "Sat 9/12: Core Workshop + Teacher Workshop. Sun 9/13: Vendor Setup, short course, Icebreaker."
 * is a schedule written as prose, and rendering it as prose is what made the Program tab a wall of
 * text with the timings buried in it. Each day marker opens a day, the sentence after it lists that
 * day's items, and each item becomes a row a reader can scan.
 *
 * Nothing is invented: a row exists only where the source wrote one, a time only where it printed
 * one in brackets, and a date only where the day marker gave a month and a day. A programme with no
 * such markers yields no rows at all and stays prose, which is the honest outcome for a conference
 * whose schedule really is only a paragraph.
 */
export function parseProgramSchedule(
  programText: string,
  year: number | null
): { sessions: LaunchDetailAgendaEntry[]; themes: string[] } {
  const text = clean(programText);
  if (!text) return { sessions: [], themes: [] };

  const sessions: LaunchDetailAgendaEntry[] = [];

  // Day markers: "Sat 9/12:", "Mon 9/14:".
  const dayMarker = /\b((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*)\s+(\d{1,2})\/(\d{1,2}):\s*/g;
  const days: Array<{ label: string; month: number; day: number; from: number }> = [];
  for (let hit = dayMarker.exec(text); hit; hit = dayMarker.exec(text)) {
    days.push({
      label: `${hit[1]} ${hit[2]}/${hit[3]}`,
      month: Number(hit[2]),
      day: Number(hit[3]),
      from: hit.index + hit[0].length,
    });
  }
  days.forEach((entry, index) => {
    const until = index + 1 < days.length ? text.lastIndexOf(days[index + 1].label, days[index + 1].from) : text.length;
    // Each day is written as one sentence; anything after it belongs to the paragraph, not the day.
    const sentence = splitOutsideBrackets(text.slice(entry.from, until), [". "])[0] ?? "";
    for (const item of splitOutsideBrackets(sentence, [" + ", ", "])) {
      const title = clean(item.replace(BRACKETED_TIME, "")).replace(/[.,;]$/, "");
      if (!title || title.length < 3) continue;
      sessions.push({
        date: isoDate(year, entry.month, entry.day),
        dateText: entry.label,
        time: item.match(BRACKETED_TIME)?.[1] ?? null,
        title,
      });
    }
  });

  // A named item the source dated in brackets: a short course on 11 Oct, a field trip on 15-16 Oct.
  const datedItem = /'([^']{4,90})'\s*\((\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?\s+([A-Za-z]{3,9})[,)]/g;
  for (let hit = datedItem.exec(text); hit; hit = datedItem.exec(text)) {
    const month = MONTHS[hit[4].slice(0, 3).toLowerCase()];
    if (!month) continue;
    const span = hit[3] ? `${hit[2]}-${hit[3]} ${hit[4]}` : `${hit[2]} ${hit[4]}`;
    if (sessions.some((session) => session.title === clean(hit![1]))) continue;
    sessions.push({ date: isoDate(year, month, Number(hit[2])), dateText: span, time: null, title: clean(hit[1]) });
  }

  sessions.sort((left, right) => String(left.date ?? "").localeCompare(String(right.date ?? "")));

  // Themes are what the conference is about, not when anything happens, so they are kept apart from
  // the schedule rather than dressed up as sessions with no times. A numbered list is the source's
  // own enumeration and wins outright; the "themes:" sentence is only read when there is no such
  // list, because otherwise it matches the list itself and stores all seven as one theme.
  const numbered = [...text.matchAll(/\((\d+)\)\s*([^,();.]{4,70})/g)].map((hit) => clean(hit[2]));
  const introduced = text.match(/\bthemes[^:]{0,30}:\s*([^.]+)\./i);
  const themes = (numbered.length > 0
    ? numbered
    : introduced
      ? splitOutsideBrackets(introduced[1], ["; "])
      : []
  ).filter((theme) => theme.length > 3 && !/^\d/.test(theme));

  return { sessions, themes: [...new Set(themes)].slice(0, 20) };
}

export function rowsFromDetailCsv(rows: string[][]): CuratedDetailRow[] {
  const [header, ...rest] = rows;
  if (!header) return [];
  return rest.map((cells) => ({
    name: cells[0] ?? "", dates: cells[1] ?? "", venue: cells[2] ?? "", program: cells[3] ?? "",
    keynoteSpeakers: cells[4] ?? "", committee: cells[5] ?? "", pricing: cells[6] ?? "",
    sponsors: cells[7] ?? "", website: cells[8] ?? "", safetyNote: cells[9] ?? "",
  }));
}

export function mapCuratedDetailRow(
  row: CuratedDetailRow,
  recordCity: string | null,
  recordYear: number | null = null
): CuratedDetail {
  const venue = splitVenue(row.venue, recordCity);
  const keynotes = parsePeople(row.keynoteSpeakers, "Keynote Speaker");
  const committee = parsePeople(row.committee, "Committee Member");
  const { fees } = parseFees(row.pricing);
  const sponsors = parseSponsors(row.sponsors);

  return {
    title: clean(row.name),
    datesText: clean(row.dates) || null,
    website: clean(row.website) || null,
    venueName: venue.name,
    venueAddress: venue.address,
    program: { availability: availabilityOf(row.program, 0), text: clean(row.program) || null },
    callForPapers: parseCallForPapers(row.program),
    schedule: parseProgramSchedule(row.program, recordYear),
    keynotes: sectionOf(row.keynoteSpeakers, keynotes),
    committee: sectionOf(row.committee, committee),
    fees: sectionOf(row.pricing, fees),
    sponsors: sectionOf(row.sponsors, sponsors),
    safetyNote: clean(row.safetyNote) || null,
  };
}

/** Title, reduced to what two spellings of the same conference share. */
export function detailMatchKey(title: string): string {
  return clean(title).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
