// Best-effort extraction of a conference's date/location straight from the search result's own
// snippet text, used only as a fallback when full-page AI extraction hasn't run yet or came back
// empty — so the hero banner isn't blank while waiting, and still shows something honest if
// extraction never finds anything. Never guesses free text as a location; only trusts an explicit
// "Location:"/"Venue:" label or the segment right after a confidently-matched date in a
// "<date> | <location>" pattern, which is how Brave commonly formats event snippets.
const MONTH_RE =
  "(?:January|February|March|April|May|June|July|August|September|October|November|December)";
const DATE_CORE_RE = new RegExp(
  `\\b${MONTH_RE}\\.?\\s+\\d{1,2}(?:\\s*[-–—]\\s*(?:${MONTH_RE}\\.?\\s+)?\\d{1,2})?,?\\s+20\\d{2}\\b`,
  "i"
);
const LABELED_DATE_RE = /\b(?:dates?|when)\s*:\s*([^|·]+?)(?=\s*(?:location|venue|cost|price|where)\s*:|\s*[|·]|$)/i;
const LABELED_LOCATION_RE = /\b(?:location|venue|where)\s*:\s*([^|·]+?)(?=\s*(?:dates?|when|cost|price)\s*:|\s*[|·]|$)/i;

export function parseDateFromSnippet(snippet: string): string | null {
  const labeled = snippet.match(LABELED_DATE_RE);
  if (labeled && labeled[1].trim()) return labeled[1].trim();
  const bare = snippet.match(DATE_CORE_RE);
  return bare ? bare[0].trim() : null;
}

export function parseLocationFromSnippet(snippet: string): string | null {
  const labeled = snippet.match(LABELED_LOCATION_RE);
  if (labeled && labeled[1].trim()) return labeled[1].trim();

  const pipeIdx = snippet.indexOf("|");
  if (pipeIdx !== -1) {
    const before = snippet.slice(0, pipeIdx);
    if (DATE_CORE_RE.test(before)) {
      const after = snippet.slice(pipeIdx + 1).split(/[·.]/)[0].trim();
      if (after) return after;
    }
  }
  return null;
}
