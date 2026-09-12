// What a person or an organisation is not.
//
// Every rule here is a string a real sweep stored in a real record's roster. The extractors are
// careful about structure — where on the page an entry sat, what heading introduced it — and that
// is most of the work. What survives them is a handful of strings that are structurally perfect
// and semantically empty: a browser name in a committee, a casino in a keynote slot, a job title
// with nobody holding it.
//
// The bar is the one the rest of the pipeline uses. A wrong speaker is worse than no speaker, so
// an entry is kept only when it is positively a name, and refused whenever it is any of the shapes
// below. Coverage lost here is a tab that says nothing; precision lost is a tab that lies.

/** An entry that is a job title and no person. "Chief Executive Officer" chairs nothing. */
const TITLE_ONLY =
  /^(?:the\s+)?(?:chief\s+\w+\s+officer|c[efiot]o|chief\s+\w+|director(?:\s+general)?|prime\s+minister|federal\s+president|president|vice\s+president|secretary\s+general|managing\s+director|general\s+chair(?:person)?|honorary\s+chair(?:person)?|regional\s+chairs?|publicity\s+(?:co-)?chairs?|publication\s+chairs?|programme?\s+chairs?|local\s+chairs?|organi[sz]ing\s+committee|advisory\s+committee|young\s+researchers?|students?|attendees?|speakers?|keynote\s+speakers?|moderators?|panellists?|panelists?|committees?|members?|organi[sz]ers?|sponsors?|partners?|exhibitors?)$/i;

/** Browser chrome, social buttons and mail links that sit in a page's furniture. */
const FURNITURE =
  /^(?:mozilla\s+firefox|google\s+chrome|safari|microsoft\s+edge|internet\s+explorer|youtube|linkedin|facebook|twitter|instagram|tiktok|whatsapp|e-?mail\b.*|contact\s+us|read\s+more|learn\s+more|click\s+here|view\s+all|see\s+all|sign\s+up|log\s?in|register(?:\s+now)?|floor\s+plan|exhibitor\s+resource\s+cent(?:er|re)|guide\s+for\s+authors|reviewer\s+hub|home|menu|search|cookie\s+policy|privacy\s+policy|terms.*)$/i;

/** A file a page shipped rather than a party it named: "AICon Cultural fun.png", "baby200.gif". */
const FILENAME = /\.(?:png|jpe?g|gif|svg|webp|pdf|mp4|ico)\b|^screenshot\b|_edited\b|^img[-_]|^logo[-_]?\d|^\d+-\w+image/i;

/** A string with more digits and separators than letters: "20250911 090451 MAGO5735", "1GM04163". */
function looksMachineGenerated(text: string): boolean {
  const letters = (text.match(/[a-z]/gi) || []).length;
  const digits = (text.match(/\d/g) || []).length;
  return digits >= 4 && digits >= letters / 2;
}

/** A date heading swept up with a roster: "October 4 Monday - Day #3". */
const DATE_LINE =
  /^(?:mon|tues|wednes|thurs|fri|satur|sun)day\b|^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\b|\bday\s*#?\d+$/i;

/**
 * A sentence, not a name.
 *
 * The verbs are matched in lower case and never as the first word, because that is what separates
 * prose from a person: "Can Balcioglu" opens with a name that is also a verb, while "brings
 * together ministers" has its verb in the middle and in lower case. A full stop after a single
 * capital is an initial rather than an ending, which is what keeps "Jeffrey S. Klein".
 */
const IS_SENTENCE =
  /(?<![A-Z])[.!?]\s+\S|\S\s+(?:is|are|was|were|has|have|had|will|can|may|offers?|provides?|brings?|features?|helps?|serves?|aligns?|accelerates?|drives?|includes?|supports?|dedicated|invitation-only|currently|together)\b/;

/** A lowercase fragment out of a stylesheet or a sprite: "title shape", "trans", "qm", "o3". */
function looksLikeMarkup(text: string): boolean {
  if (/[A-Z]/.test(text)) return false;
  return text.split(/\s+/).every((word) => word.length <= 5) || /^[a-z0-9-]{1,4}$/.test(text);
}

/** Words a name may carry in lower case: "van der Berg", "Ali bin Rashid". */
const JOINING = new Set(["of", "on", "in", "at", "the", "and", "for", "de", "del", "da", "der",
  "van", "von", "bin", "binti", "al", "el", "la", "le", "du", "dos", "das", "ter", "ten"]);

/** A thing rather than a person: AWS re:Invent filed its venues as keynote speakers. */
const NOT_A_PERSON =
  /^the\s|\b(?:cent(?:er|re)|hotel|convention|conference\s+cent|grounds|casino|resort|arena|pavilion|ballroom|auditorium|campus|institute\s+of\s+tech|expo|hall)\b/i;

/**
 * Words that make a string an organisation rather than a person.
 *
 * A sponsor is an organisation and a speaker is a person, so one test cannot serve both: "Gastech
 * Energy Club" is a perfectly good sponsor and was stored as a keynote speaker. These words decide
 * which of the two a string is, and the people test refuses anything carrying one.
 */
const ORGANISATION_WORD =
  /\b(?:inc|llc|ltd|limited|gmbh|plc|corp|corporation|company|co|club|society|association|federation|institute|institution|foundation|council|committee|academy|university|college|school|department|ministry|agency|bureau|centre|center|group|network|alliance|consortium|partners|partnership|holdings|labs?|technologies|systems|solutions|services|press|media|journal|summit|conference|congress|symposium|expo|forum)\b/i;

/** A headline rather than a name: "Introducing NVIDIA RTX Spark". */
const HEADLINE = /^(?:introducing|announcing|presenting|discover|explore|meet|join|register|save|learn|watch|read|download|book|why|how|what|when|where)\b/i;

/** A benefit priced in a sponsor pack: "Complimentary Event registrations", "Pens 1 (exclusive)". */
const BENEFIT_LINE = /\b(?:complimentary|exclusive|included|logo|signage|slides?|banner|booth|stand|pass(?:es)?|registrations?|tickets?|listing|mentions?|placements?)\b/i;

/** Whether a string can be somebody's name. */
export function isCredibleName(raw: string): boolean {
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length < 4 || text.length > 70) return false;
  if (TITLE_ONLY.test(text) || FURNITURE.test(text) || DATE_LINE.test(text)) return false;
  if (FILENAME.test(text) || looksMachineGenerated(text) || looksLikeMarkup(text)) return false;
  if (IS_SENTENCE.test(text) || NOT_A_PERSON.test(text)) return false;
  if (ORGANISATION_WORD.test(text) || HEADLINE.test(text) || BENEFIT_LINE.test(text)) return false;
  // Nobody is called "Future Leaders Gastech 2025". An edition year inside a name means the string
  // names an event, a strand or a session — the one place a roster and a programme get confused.
  if (/\b(?:19|20)\d{2}\b/.test(text)) return false;
  if (/^https?:\/\//i.test(text)) return false;

  const words = text.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 7) return false;
  // A name is written in capitals; a phrase about a name is not. URTeC's sponsor tiers arrived as
  // "Logo on on-site signage" and "Complimentary Event registrations", which open with a capital
  // exactly as any sentence does — so it is the balance that decides, not the presence of one.
  const carries = words.filter((word) => !JOINING.has(word.toLowerCase().replace(/[^a-z]/g, "")));
  const capitalised = carries.filter((word) => /^[A-Z\u00C0-\u024F]/.test(word)).length;
  return capitalised >= 2 && capitalised >= carries.length - capitalised;
}

/**
 * Whether a parenthesised affiliation is an organisation rather than a biography.
 *
 * EuroFinance stored "Can Balcioglu (With over 25 years of leadership experience in Treasury,
 * FP&A, and Business Finance, Can Balcioglu currently serves as the Vice President...)" — the name
 * is right and the affiliation is the whole bio paragraph. The name is worth keeping; the
 * paragraph is not, so this decides the affiliation alone and never discards the person.
 */
export function isCredibleAffiliation(raw: string): boolean {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text || text.length > 80) return false;
  if (IS_SENTENCE.test(text) || FILENAME.test(text) || looksMachineGenerated(text)) return false;
  // ASU+GSV billed Barack Obama as an "Academy + Grammy Award Winning Artist" — a line lifted from
  // somebody else's biography on the same page. A description of a person is not the name of the
  // place that employs them, and printing it beside a name asserts something no source said.
  if (/\b(?:award|winning|winner|artist|author|founder|speaker|expert|leader|veteran|enthusiast)\b/i.test(text)) return false;
  return !TITLE_ONLY.test(text);
}
