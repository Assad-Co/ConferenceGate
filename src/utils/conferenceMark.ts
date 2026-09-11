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
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z0-9&-]/g, ""))
    .filter((word) => word && !COUNTING.test(word) && !GENERIC.test(word));
}

export function conferenceInitials(title: string): string {
  // An acronym the title already states is the conference's own mark: "ADIPEC", "ICCFI 2026".
  //
  // The longest wins rather than the first. "UN Climate Change Conference COP31" opens with a two
  // letter acronym that names the organiser and closes with the one that names the conference, and
  // a card headed UN could be any of a hundred events.
  const candidates = (title.match(/\b[A-Z][A-Z0-9&-]{1,8}\b/g) ?? [])
    .filter((value) => !/^\d+$/.test(value))
    .map((value) => value.replace(/[^A-Z0-9]/g, ""))
    .filter(Boolean);
  const longest = candidates.slice().sort((left, right) => right.length - left.length)[0];
  if (longest && longest.length >= 3) return longest.slice(0, 9);

  // A two-letter acronym is not worth a word. "Gartner IT Symposium" headed IT says nothing; the
  // name the reader knows it by is Gartner, so the title's own word comes first and a short
  // acronym only stands in when the title has no word to offer.
  const distinctive = distinctiveWords(title);
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
