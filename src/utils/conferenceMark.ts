/**
 * A conference's mark when there is no logo to show.
 *
 * Two thirds of the catalogue has no logo: the organiser's page lives on somebody else's site, or
 * there is no page at all, and taking an icon from that host would put a publisher's brand on a
 * conference's card. What goes there instead has to name the conference, and the first attempt did
 * not — a letter from every word turned "Gastech 2026" into "G2" and "20th Vaccine Congress" into
 * "2V", which names nothing and reads as a record with nothing behind it.
 *
 * What distinguishes these names is one word, and it is never the ordinal, the year, or the part
 * that every other conference in the catalogue also has.
 */

/** Words that appear in so many conference names that they cannot distinguish one. */
const GENERIC =
  /^(?:conference|congress|symposium|symposia|summit|workshop|meeting|convention|exhibition|expo|forum|session|week|days?|annual|international|global|world|national|european|asian|american|african|biennial|edition|the|and|of|for|in|on|at|a|an|with|to|from|by|its|their)$/i;

/** An ordinal or a bare number: "20th", "5", "2026". */
const COUNTING = /^\d+(?:st|nd|rd|th)?$/i;

export function distinctiveWords(title: string): string[] {
  return title
    // A slash separates two names — "AAPG/EAGE" is two societies. Stripping it rather than
    // splitting on it produced the word AAPGEAGE, which is neither of them.
    .split(/[\s/]+/)
    .map((word) => word.replace(/[^A-Za-z0-9&-]/g, ""))
    .filter((word) => word && !COUNTING.test(word) && !GENERIC.test(word));
}

/**
 * The half of a titled name that says which event this is.
 *
 * Ten Cell Press symposia all begin "Cell Press Symposia:" and five Black Hats all begin "Black
 * Hat", so a mark read from the front of the name comes out the same for every one of them — ten
 * cards headed CELL, which is exactly the indistinguishable grid the mark exists to prevent. What
 * separates them is the subject after the colon, or the region after the series name.
 *
 * It only fires where the prefix is a series label and nothing else: the words that name a kind of
 * event, with no number of its own. "EPIDEMICS 11: 11th International Conference on Infectious
 * Disease Dynamics" keeps EPIDEMICS, because a prefix carrying its own edition number is the name
 * rather than a label.
 */
const SERIES_LABEL = /^[A-Za-z' ]*\b(?:symposia|symposium|conference|congress|series|meetings?|press)\b[A-Za-z' ]*$/i;

export function distinguishingPart(title: string): string {
  const colon = title.indexOf(":");
  if (colon > 0) {
    const before = title.slice(0, colon).trim();
    const after = title.slice(colon + 1).trim();
    if (after && SERIES_LABEL.test(before)) return after;
  }
  return title;
}

export function conferenceInitials(title: string, organisation?: string | null): string {
  return markFor(distinguishingPart(title), organisation) || markFor(title, organisation);
}

/** Whether an acronym in the title is just the society that runs the event.
 *
 *  Five AAPG events open with AAPG, and it is the longest acronym in every one of them, so all five
 *  cards read AAPG — the society, not the conference, and the reader cannot tell the Eastern Section
 *  meeting from the Rocky Mountain one. Where the record names its organiser, an acronym that only
 *  repeats it is dropped and the title's own words take over: EASTERN, ROCKY, SEALS. */
function namesTheOrganiser(acronym: string, organisation: string | null | undefined): boolean {
  if (!organisation) return false;
  const words = organisation.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (words.includes(acronym)) return true;
  // "American Association of Petroleum Geologists" is AAPG spelled out. Only the connectives are
  // dropped here, not GENERIC — that list exists to find what distinguishes one conference from
  // another, and applied to a society's name it throws away the very words its initials are made
  // of ("American" is the first A in AAPG).
  const initials = words.filter((word) => !/^(?:OF|THE|AND|FOR|IN|ON|AT)$/.test(word)).map((word) => word[0]).join("");
  return initials.length >= 3 && initials === acronym;
}

/** Acronyms that name a kind of event rather than an event. AAPG runs many Geosciences Technology
 *  Workshops, so GTW distinguishes one of them from another no better than the word "Workshop" it
 *  stands for. */
const FORMAT_ACRONYM = /^GTW$/;

/** A society sharing the billing: "AAPG/EAGE Hydrocarbon Seals" is run by both, so neither names
 *  the workshop. Only a name joined to the known organiser by a slash counts — an acronym merely
 *  present elsewhere in the title is the event's own until something says otherwise. */
function coBilledWithOrganiser(acronym: string, title: string, organisation: string | null | undefined): boolean {
  if (!organisation) return false;
  const pairs = title.match(/\b[A-Z][A-Z0-9&-]{1,8}\s*\/\s*[A-Z][A-Z0-9&-]{1,8}\b/g) ?? [];
  return pairs.some((pair) => {
    const sides = pair.split("/").map((side) => side.trim().replace(/[^A-Z0-9]/g, ""));
    return sides.includes(acronym) && sides.some((side) => namesTheOrganiser(side, organisation));
  });
}

function markFor(title: string, organisation?: string | null): string {
  // An acronym the title already states is the conference's own mark: "ADIPEC", "ICCFI 2026".
  //
  // The longest wins rather than the first. "UN Climate Change Conference COP31" opens with a two
  // letter acronym that names the organiser and closes with the one that names the conference, and
  // a card headed UN could be any of a hundred events.
  const candidates = (title.match(/\b[A-Z][A-Z0-9&-]{1,8}\b/g) ?? [])
    .filter((value) => !/^\d+$/.test(value))
    .map((value) => value.replace(/[^A-Z0-9]/g, ""))
    .filter(Boolean)
    .filter((value) => !namesTheOrganiser(value, organisation))
    .filter((value) => !coBilledWithOrganiser(value, title, organisation))
    .filter((value) => !FORMAT_ACRONYM.test(value));
  const longest = candidates.slice().sort((left, right) => right.length - left.length)[0];
  if (longest && longest.length >= 3) return longest.slice(0, 9);

  // A two-letter acronym is not worth a word. "Gartner IT Symposium" headed IT says nothing; the
  // name the reader knows it by is Gartner, so the title's own word comes first and a short
  // acronym only stands in when the title has no word to offer.
  // The organiser's name is dropped from the words too, not only from the acronyms: AAPG survives
  // `distinctiveWords` as an ordinary word, and picking it there put the society back on all five
  // cards by the other route.
  const distinctive = distinctiveWords(title)
    .filter((value) => !namesTheOrganiser(value.toUpperCase(), organisation))
    .filter((value) => !coBilledWithOrganiser(value.toUpperCase(), title, organisation));
  const word = distinctive.find((value) => value.length >= 3 && value.length <= 9);
  if (word) return word.toUpperCase();
  if (longest) return longest;

  // One long word is the whole name. "Goldschmidt 2027 Conference" and "SuperReturn International"
  // each reduced to a single letter, because the only word that distinguishes them is over the
  // length the panel was sized for — so the panel grows instead. Where two words share the work
  // their initials still say more than either word truncated would ("AI" beats "ARTIFICIA").
  if (distinctive.length === 1 && distinctive[0].length <= 12) return distinctive[0].toUpperCase();

  const words = distinctive.length ? distinctive : title.split(/\s+/).filter(Boolean);
  return words.map((value) => value[0]).join("").toUpperCase().slice(0, 5) || "CONF";
}

/** Tailwind sizing for a mark that is now a word rather than two letters. */
export function markSizeClass(mark: string, scale: "card" | "hero" = "card"): string {
  if (scale === "hero") {
    return mark.length <= 3 ? "text-5xl sm:text-6xl"
      : mark.length <= 5 ? "text-4xl sm:text-5xl"
      : mark.length <= 7 ? "text-3xl sm:text-4xl"
      : mark.length <= 9 ? "text-2xl sm:text-3xl"
      : "text-xl sm:text-2xl";
  }
  return mark.length <= 3 ? "text-3xl sm:text-4xl"
    : mark.length <= 5 ? "text-2xl sm:text-3xl"
    : mark.length <= 7 ? "text-xl sm:text-2xl"
    : mark.length <= 9 ? "text-base sm:text-lg"
    : "text-sm sm:text-base";
}
