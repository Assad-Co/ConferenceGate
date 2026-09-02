// International date parsing.
//
// Conference sites write dates every way there is: "12–14 May 2027", "May 12-14, 2027", "12th to
// 14th May 2027", "2027-05-12", "30 May – 2 June 2027", "28 December 2027 – 3 January 2028".
// All of those are the same fact and all of them are handled here.
//
// Two deliberate refusals:
//   * An ambiguous numeric date (05/06/2027 — is that 5 June or 6 May?) is NOT resolved by
//     picking a convention. Unless the day is above 12 and settles it, the date is not parsed.
//     A wrong date is worse than no date.
//   * "May 2027" names no day, so `startDate` stays null and only the year and month are filled,
//     with precision recorded. Nothing invents the 1st of the month.
//
// The original text is always carried through for auditing (section 12).

import type { DatePrecision, ParsedDateRange } from "./types";

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, janv: 1, januar: 1, enero: 1, janeiro: 1, gennaio: 1, janvier: 1,
  feb: 2, february: 2, februar: 2, febrero: 2, fevereiro: 2, febbraio: 2, "février": 2, fevrier: 2,
  mar: 3, march: 3, marz: 3, "märz": 3, marzo: 3, "março": 3, marco: 3, mars: 3,
  apr: 4, april: 4, abril: 4, aprile: 4, avril: 4,
  may: 5, mai: 5, mayo: 5, maio: 5, maggio: 5,
  jun: 6, june: 6, juni: 6, junio: 6, junho: 6, giugno: 6, juin: 6,
  jul: 7, july: 7, juli: 7, julio: 7, julho: 7, luglio: 7, juillet: 7,
  aug: 8, august: 8, agosto: 8, "août": 8, aout: 8,
  sep: 9, sept: 9, september: 9, septiembre: 9, setembro: 9, settembre: 9, septembre: 9,
  oct: 10, october: 10, oktober: 10, octubre: 10, outubro: 10, ottobre: 10, octobre: 10,
  nov: 11, november: 11, noviembre: 11, novembro: 11, novembre: 11,
  dec: 12, december: 12, dezember: 12, diciembre: 12, dezembro: 12, dicembre: 12, "décembre": 12, decembre: 12,
};

const MONTH_PATTERN = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join("|");

/** Any of the dash characters sites use for a range, plus the word forms. */
const RANGE_SEP = "\\s*(?:[-–—‒−]|to|until|till|through|thru|au|bis|a|até|ate|\\.\\.)\\s*";

/** Connector words some languages put between the day, the month and the year: "3 de outubro de
 *  2027", "12th of May 2027". Optional everywhere it appears. */
const CONNECTOR = "(?:(?:de|of|del|du|d')\\s+)?";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects 31 February and friends rather than letting JavaScript roll them forward.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function monthNumber(name: string): number | null {
  const key = name
    .toLowerCase()
    .replace(/\.$/, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  return MONTHS[key] ?? MONTHS[key.slice(0, 3)] ?? null;
}

function empty(rawText: string): ParsedDateRange {
  return { startDate: null, endDate: null, startYear: null, startMonth: null, precision: null, rawText };
}

function result(
  rawText: string,
  start: { y: number; m: number; d?: number },
  end: { y: number; m: number; d?: number } | null,
  precision: DatePrecision
): ParsedDateRange {
  const startDate = precision === "day" && start.d ? isoDate(start.y, start.m, start.d) : null;
  const endDate = precision === "day" && end?.d ? isoDate(end.y, end.m, end.d) : null;
  return {
    startDate,
    // A single-day event legitimately has start === end; a range whose end failed to parse
    // reports null rather than repeating the start as though the site had said so.
    endDate: endDate ?? (precision === "day" && !end ? startDate : null),
    startYear: start.y,
    startMonth: start.m,
    precision,
    rawText,
  };
}

/**
 * Parses one date or date range out of free text.
 *
 * Returns nulls (never throws, never guesses) when the text names no date this can be sure of.
 */
export function parseDateRange(input: string | null | undefined): ParsedDateRange {
  if (!input || typeof input !== "string") return empty(input || "");
  const raw = input.trim();
  if (!raw) return empty(raw);

  const text = raw
    .replace(/ /g, " ")
    .replace(/(\d)(st|nd|rd|th)\b/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();

  // ---- ISO first: unambiguous by definition. "2027-05-12" or "2027-05-12/2027-05-14".
  const isoRange = new RegExp(`^(\\d{4})-(\\d{2})-(\\d{2})(?:[T ][\\d:+.Z-]*)?(?:${RANGE_SEP}|/)(\\d{4})-(\\d{2})-(\\d{2})`, "i").exec(text);
  if (isoRange) {
    return result(
      raw,
      { y: +isoRange[1], m: +isoRange[2], d: +isoRange[3] },
      { y: +isoRange[4], m: +isoRange[5], d: +isoRange[6] },
      "day"
    );
  }
  const isoSingle = /^(\d{4})-(\d{2})-(\d{2})(?:[T ][\d:+.Z-]*)?$/.exec(text);
  if (isoSingle) {
    return result(raw, { y: +isoSingle[1], m: +isoSingle[2], d: +isoSingle[3] }, null, "day");
  }
  const isoMonth = /^(\d{4})-(\d{2})$/.exec(text);
  if (isoMonth) {
    return { startDate: null, endDate: null, startYear: +isoMonth[1], startMonth: +isoMonth[2], precision: "month", rawText: raw };
  }

  // ---- "12–14 May 2027"  /  "12 May – 14 May 2027"  /  "30 May – 2 June 2027"
  const dayFirstRange = new RegExp(
    `\\b(\\d{1,2})(?:\\s*(${MONTH_PATTERN}))?\\.?(?:\\s*,?\\s*(\\d{4}))?${RANGE_SEP}(\\d{1,2})\\s*(${MONTH_PATTERN})\\.?\\s*,?\\s*(\\d{4})\\b`,
    "i"
  ).exec(text);
  if (dayFirstRange) {
    const endMonth = monthNumber(dayFirstRange[5]);
    const startMonth = dayFirstRange[2] ? monthNumber(dayFirstRange[2]) : endMonth;
    const endYear = +dayFirstRange[6];
    const startYear = dayFirstRange[3] ? +dayFirstRange[3] : endYear;
    if (startMonth && endMonth) {
      return result(
        raw,
        { y: startYear, m: startMonth, d: +dayFirstRange[1] },
        { y: endYear, m: endMonth, d: +dayFirstRange[4] },
        "day"
      );
    }
  }

  // ---- "May 12-14, 2027"  /  "May 30 – June 2, 2027"
  const monthFirstRange = new RegExp(
    `\\b(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:\\s*,?\\s*(\\d{4}))?${RANGE_SEP}(?:(${MONTH_PATTERN})\\.?\\s+)?(\\d{1,2})\\s*,?\\s*(\\d{4})\\b`,
    "i"
  ).exec(text);
  if (monthFirstRange) {
    const startMonth = monthNumber(monthFirstRange[1]);
    const endMonth = monthFirstRange[4] ? monthNumber(monthFirstRange[4]) : startMonth;
    const endYear = +monthFirstRange[6];
    const startYear = monthFirstRange[3] ? +monthFirstRange[3] : endYear;
    if (startMonth && endMonth) {
      return result(
        raw,
        { y: startYear, m: startMonth, d: +monthFirstRange[2] },
        { y: endYear, m: endMonth, d: +monthFirstRange[5] },
        "day"
      );
    }
  }

  // ---- "12 May 2027"  /  "12 May, 2027"  /  "3 de outubro de 2027"  /  "12th of May 2027"
  const dayFirst = new RegExp(
    `\\b(\\d{1,2})\\s+${CONNECTOR}(${MONTH_PATTERN})\\.?\\s*,?\\s*${CONNECTOR}(\\d{4})\\b`,
    "i"
  ).exec(text);
  if (dayFirst) {
    const month = monthNumber(dayFirst[2]);
    if (month) return result(raw, { y: +dayFirst[3], m: month, d: +dayFirst[1] }, null, "day");
  }

  // ---- "May 12, 2027"
  const monthFirst = new RegExp(`\\b(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})\\s*,?\\s*(\\d{4})\\b`, "i").exec(text);
  if (monthFirst) {
    const month = monthNumber(monthFirst[1]);
    if (month) return result(raw, { y: +monthFirst[3], m: month, d: +monthFirst[2] }, null, "day");
  }

  // ---- Numeric: 12/05/2027. Only parsed when one number is above 12 and settles the order.
  const numeric = /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b/.exec(text);
  if (numeric) {
    const first = +numeric[1];
    const second = +numeric[2];
    const year = +numeric[3];
    if (first > 12 && second <= 12) return result(raw, { y: year, m: second, d: first }, null, "day");
    if (second > 12 && first <= 12) return result(raw, { y: year, m: first, d: second }, null, "day");
    // Genuinely ambiguous: fall through to the month/year reading below rather than choosing.
    if (first <= 12 && second <= 12) {
      return { startDate: null, endDate: null, startYear: year, startMonth: null, precision: "year", rawText: raw };
    }
  }

  // ---- "May 2027" / "May–June 2027": a month, no day.
  const monthYear = new RegExp(`\\b(${MONTH_PATTERN})\\.?(?:${RANGE_SEP}(?:${MONTH_PATTERN})\\.?)?\\s*,?\\s*(\\d{4})\\b`, "i").exec(text);
  if (monthYear) {
    const month = monthNumber(monthYear[1]);
    if (month) {
      return { startDate: null, endDate: null, startYear: +monthYear[2], startMonth: month, precision: "month", rawText: raw };
    }
  }

  // ---- A bare year is the coarsest thing worth keeping.
  const year = /\b(20\d{2})\b/.exec(text);
  if (year) {
    return { startDate: null, endDate: null, startYear: +year[1], startMonth: null, precision: "year", rawText: raw };
  }

  return empty(raw);
}

/** A single date, for deadlines. Returns ISO YYYY-MM-DD or null — never a range. */
export function parseSingleDate(input: string | null | undefined): string | null {
  const parsed = parseDateRange(input);
  return parsed.precision === "day" ? parsed.startDate : null;
}

/** True when an ISO date is today or later, in UTC. */
export function isFutureOrToday(isoDateString: string | null, now = new Date()): boolean {
  if (!isoDateString) return false;
  const today = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  return isoDateString >= today;
}

/** True when a year/month pair is in the current month or later. Used for month-precision events,
 *  which have no day to compare. */
export function isFutureMonth(year: number | null, month: number | null, now = new Date()): boolean {
  if (!year) return false;
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  if (year > currentYear) return true;
  if (year < currentYear) return false;
  return month === null ? true : month >= currentMonth;
}
