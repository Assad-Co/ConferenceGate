// Registration prices, read off the page that states them.
//
// `deepSections.ts` has no fees page, so 127 records reached their Fees & Pricing tab with nothing
// but "could not be retrieved". This answers that one question and only that one, in the same
// spirit as its neighbour: the page's own words, no model, and a price is kept only where a label
// and an amount sit together in one row of one table or one line of one list. A number found
// floating in prose is a number, not a fee.
//
// What it writes is the text form `curatedDetails.parseFees` already reads — "EUR Student $499;
// Member $699" — so the structuring, the currency and the two-column early-bird rule stay in the
// one place that already does them, and this file never decides what a fee *is*.

import { attr, byTag, findAll, parseHtml, textOf, absoluteUrl, type HtmlNode } from "./html";

/** Links that lead to the page where prices live. */
const FEE_LINK = /\b(regist(?:er|ration)|fees?|pricing|prices?|rates?|tickets?|attend|book(?:ing)?)\b/i;
const NON_HTML = /\.(pdf|docx?|pptx?|xlsx?|zip|ics|jpe?g|png|gif|svg|webp)$/i;

/** An amount, with the currency the page wrote it in. */
const AMOUNT = /(?:(US\$|USD|EUR|GBP|CHF|CAD|AUD|SAR|AED|KWD)|([$€£]))\s?([\d][\d,]*)(?:\.(\d{2}))?\b/i;
const SYMBOL_CURRENCY: Record<string, string> = { "$": "USD", "€": "EUR", "£": "GBP" };

/**
 * Words that mean this number is not a registration fee.
 *
 * Every one is a line that appeared beside a price on a real conference page: a sponsorship tier, a
 * hotel rate, a prize, a bursary. Charging them to a reader as the cost of attending would be
 * exactly the kind of plausible, wrong value the rest of this codebase refuses.
 */
const NOT_A_FEE =
  /\b(sponsor|sponsorship|exhibit|booth|stand|advertis|hotel|room|night|accommodation|award|prize|grant|bursary|scholarship|donation|funding|budget|revenue|salary|discount\s+code|save\s+up|per\s+night)\b/i;

/** A label has to name who or what is being priced. */
const FEE_LABEL =
  /\b(regist|fee|rate|price|ticket|pass|delegate|attendee|participant|author|presenter|speaker|student|graduate|undergraduate|phd|academic|faculty|professor|researcher|industry|corporate|professional|member|non[-\s]?member|ieee|acm|early|late|standard|regular|advance|onsite|on[-\s]?site|virtual|online|in[-\s]?person|day|full|single|group|senior|retired|listener|accompanying|guest|workshop|tutorial|banquet)\b/i;

export interface FeeLine {
  label: string;
  amount: string;
  currency: string | null;
}

const tidy = (value: string) =>
  value.replace(/\s+/g, " ").replace(/[‐-―]/g, "-").trim();

/** A label worth keeping: short, naming a category, and not page furniture. */
function usableLabel(raw: string): string | null {
  const label = tidy(raw).replace(/^[•\-–—*\s]+/, "").replace(/[:•\-–—\s]+$/, "");
  if (!label || label.length < 3 || label.length > 60) return null;
  if (label.split(" ").length > 8) return null;
  if (NOT_A_FEE.test(label)) return null;
  if (!FEE_LABEL.test(label)) return null;
  // A label that is itself only an amount says nothing about what is priced.
  if (/^[^a-z]*$/i.test(label.replace(AMOUNT, ""))) return null;
  return label;
}

function amountIn(text: string): { amount: string; currency: string | null } | null {
  const hit = text.match(AMOUNT);
  if (!hit) return null;
  const currency = hit[1]
    ? (hit[1].toUpperCase() === "US$" ? "USD" : hit[1].toUpperCase())
    : SYMBOL_CURRENCY[hit[2]] ?? null;
  const whole = hit[3].replace(/,/g, "");
  if (!/^\d{1,6}$/.test(whole)) return null;
  // A price of nothing is a statement about eligibility, not a fee this can price.
  if (Number(whole) === 0) return null;
  // An edition year is not a price. "1 Delegate Pass for Entrepreneur 2026" was read as a €2026
  // fee, which is both wrong and expensive-looking. A real four-figure fee is written with the
  // separator or the cents — "€2,026", "€2026.00" — where a year is always written bare, so a bare
  // number that happens to be a year in this catalogue's range is refused.
  const bare = !hit[4] && !hit[3].includes(",");
  if (bare && Number(whole) >= 2000 && Number(whole) <= 2100) return null;
  return { amount: whole, currency };
}

/**
 * The prices a page states, each beside the thing it prices.
 *
 * Only two shapes count, because they are the two where a page has itself joined the label to the
 * amount: a table row, and a list item or short paragraph. Walking the document for amounts and
 * reaching backwards for "the nearest preceding words" finds a number in a sentence about last
 * year's attendance and files it as a fee.
 */
export function feesFromPage(html: string, pageUrl: string): FeeLine[] {
  const root = parseHtml(html);
  const fees: FeeLine[] = [];
  const seen = new Set<string>();

  const add = (labelRaw: string, priced: string) => {
    const label = usableLabel(labelRaw);
    const money = label && amountIn(priced);
    if (!label || !money) return;
    const key = `${label.toLowerCase()}|${money.amount}`;
    if (seen.has(key)) return;
    seen.add(key);
    fees.push({ label, amount: money.amount, currency: money.currency });
  };

  // A table row: one cell names the category, another carries the price.
  for (const row of byTag(root, "tr")) {
    const cells = byTag(row, "td", "th").map((cell) => tidy(textOf(cell)));
    if (cells.length < 2) continue;
    const priceAt = cells.findIndex((cell) => AMOUNT.test(cell) && cell.length < 40);
    if (priceAt < 0) continue;
    const labelAt = cells.findIndex((cell, index) => index !== priceAt && !AMOUNT.test(cell) && cell.length > 2);
    if (labelAt < 0) continue;
    add(cells[labelAt], cells[priceAt]);
  }

  // A list item or short paragraph that says both at once: "Student registration — $499".
  for (const node of byTag(root, "li", "p", "dd", "dt")) {
    const text = tidy(textOf(node));
    if (!text || text.length > 140 || !AMOUNT.test(text)) continue;
    const at = text.search(AMOUNT);
    add(text.slice(0, at), text.slice(at));
  }

  return fees.slice(0, 14);
}

/** Same-domain pages that look like they carry the prices. */
export function findFeePages(html: string, pageUrl: string, limit = 3): string[] {
  let origin: URL;
  try { origin = new URL(pageUrl); } catch { return []; }
  const root = parseHtml(html);
  const found: string[] = [];
  const seen = new Set<string>();
  for (const anchor of byTag(root, "a")) {
    const href = attr(anchor, "href");
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href.trim())) continue;
    const absolute = absoluteUrl(href, pageUrl);
    if (!absolute) continue;
    let target: URL;
    try { target = new URL(absolute); } catch { continue; }
    if (target.hostname.replace(/^www\./, "") !== origin.hostname.replace(/^www\./, "")) continue;
    if (NON_HTML.test(target.pathname)) continue;
    if (!FEE_LINK.test(target.pathname) && !FEE_LINK.test(tidy(textOf(anchor)))) continue;
    const key = target.href.replace(/#.*$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(key);
    if (found.length >= limit) break;
  }
  return found;
}

/** The cell `curatedDetails.parseFees` reads: one currency in front, then "Label $amount" apiece. */
export function feesCell(fees: FeeLine[]): string {
  if (!fees.length) return "";
  // Two currencies on one page are two price lists, and joining them would attach the wrong one to
  // half the categories. The commoner one is kept and the rest dropped rather than mislabelled.
  const counts = new Map<string, number>();
  for (const fee of fees) if (fee.currency) counts.set(fee.currency, (counts.get(fee.currency) ?? 0) + 1);
  const currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const kept = currency ? fees.filter((fee) => !fee.currency || fee.currency === currency) : fees;
  if (!kept.length) return "";
  // A home page and a registration page usually state the same table, and reading both listed every
  // price twice. Deduplication belongs here rather than in the page reader, because it is only
  // across pages that the repeat appears.
  const seen = new Set<string>();
  const once = kept.filter((fee) => {
    const key = `${fee.label.toLowerCase()}|${fee.amount}`;
    return seen.has(key) ? false : seen.add(key);
  });
  const body = once.map((fee) => `${fee.label} $${fee.amount}`).join("; ");
  return currency ? `${currency} ${body}` : body;
}

export type { HtmlNode };
export { findAll };
