import { COUNTRIES } from "./discovery/countries";

export interface StoredConferenceSearchFields {
  title: unknown;
  acronym?: unknown;
  topics?: unknown;
  categories?: unknown;
  keywords?: unknown;
  description?: unknown;
  organizer?: unknown;
  location?: unknown;
  dates?: unknown;
  officialUrl?: unknown;
  callForPapers?: unknown;
  programAgenda?: unknown;
  keynoteSpeakers?: unknown;
  technicalCommittee?: unknown;
  sponsorsExhibitors?: unknown;
  venueAccommodation?: unknown;
  feesPricing?: unknown;
  community?: unknown;
}

const CATEGORY_PATTERNS: Record<string, string> = {
  "artificial intelligence": "artificial intelligence|machine learning|deep learning|\\bai\\b|generative ai|computer vision|natural language processing",
  "ai": "artificial intelligence|machine learning|deep learning|\\bai\\b|generative ai|computer vision|natural language processing",
  "cybersecurity": "cybersecurity|cyber security|information security|network security|infosec",
  "computer science": "computer science|computing|software|information technology|informatics",
  "technology": "technology|digital|software|computing|artificial intelligence|cyber|semiconductor|telecom",
  "engineering": "engineering|engineer",
  "petroleum": "petroleum|oil and gas|upstream|downstream|reservoir|drilling|geoscience|geology|geophysics",
  "oil and gas": "petroleum|oil and gas|upstream|downstream|reservoir|drilling|hydrocarbon",
  "geoscience": "geoscience|geology|geophysics|earth science|petroleum|stratigraphy|sedimentology|geochemistry",
  "healthcare": "healthcare|health care|medical|medicine|clinical|nursing|pharma|public health",
  "energy": "energy|renewable|solar|wind power|hydrogen|petroleum|oil and gas|electricity|power",
  "sustainability": "sustainab|circular economy|decarbon|net zero|esg",
  "business": "business|management|entrepreneur|commerce|marketing|finance|trade",
  "education": "educat|teaching|learning|pedagog|academic|edtech",
  "finance": "financ|banking|fintech|investment|capital market|insurance",
  "fintech": "fintech|financial technology|digital banking|payments|blockchain",
  "law": "\\blaw\\b|legal|jurisprud",
  "science": "science|scientific|physics|chemistry|biology",
  "environment": "environment|ecolog|climate|conservation|biodiversity",
  "medicine": "medicin|medical|clinical|health|pharma",
  "pharmaceutical": "pharma|pharmaceutical|drug discovery|clinical trial",
  "biotechnology": "biotech|biotechnology|bioengineering|genomics|life science",
  "agriculture": "agricultur|farming|agronom|crop|food security",
  "architecture": "architectur|urban design|built environment",
  "construction": "construction|civil engineering|infrastructure|built environment",
  "real estate": "real estate|property|proptech|housing|urban development",
  "arts culture": "\\barts\\b|cultur|humanities",
  "blockchain": "blockchain|web3|cryptocurrency|distributed ledger",
  "climate": "climate|global warming|decarbon|net zero",
  "data science": "data science|data analytics|big data|data engineering",
  "economics": "economic|econometr",
  "manufacturing": "manufactur|industrial production|industry 4|smart factory",
  "marketing": "marketing|advertising|brand|customer experience",
  "mathematics": "mathematic|statistics|applied math",
  "physics": "physics|quantum|photonics",
  "robotics": "robot|automation|autonomous systems|mechatronics",
  "aerospace": "aerospace|aviation|aeronautic|space technology|satellite",
  "mining": "mining|mineral|metallurgy|ore deposit",
  "materials": "materials science|advanced material|nanomaterial|metallurgy",
  "semiconductor": "semiconductor|microelectronics|chip design|integrated circuit",
  "telecommunications": "telecom|telecommunication|5g|6g|wireless|networking",
  "logistics": "logistics|supply chain|transportation|freight|maritime",
  "water": "water|desalination|wastewater|hydrology",
  "social sciences": "social science|sociolog|psycholog|anthropolog|political science",
  "tourism": "tourism|hospitality|travel"
};

const QUERY_STOP_WORDS = new Set([
  "conference", "conferences", "event", "events", "official", "website", "upcoming", "current",
  "find", "show", "search", "discover", "please", "best", "top", "all", "any", "about", "related",
  "from", "until", "through", "between", "and", "the", "in", "of", "for", "on", "at", "near",
  "worldwide", "world", "global", "international"
]);

/** Multi-word concepts become one semantic token before tokenisation. */
const QUERY_PHRASES: Array<[RegExp, string]> = [
  [/\bmiddle\s+east\b/g, "middleeast"],
  [/\bnorth\s+america\b/g, "northamerica"],
  [/\bsouth\s+america\b/g, "southamerica"],
  [/\blatin\s+america\b/g, "latinamerica"],
  [/\bcentral\s+america\b/g, "centralamerica"],
  [/\basia\s+pacific\b/g, "asiapacific"],
  [/\bsub[-\s]?saharan\s+africa\b/g, "subsaharanafrica"],
  [/\boil\s+(?:and|&)\s+gas\b/g, "petroleum"],
  [/\bearth\s+science(?:s)?\b/g, "geoscience"],
  [/\bhealth\s+care\b/g, "healthcare"],
  [/\breal\s+estate\b/g, "realestate"],
  [/\bcomputer\s+science\b/g, "computerscience"],
  [/\bdata\s+science\b/g, "datascience"]
];

const SEMANTIC_PATTERNS: Record<string, RegExp> = {
  ai: /\bai\b|artificial intelligence|machine learning|deep learning|generative ai|computer vision|natural language processing/,
  healthcare: /\bmedical\b|\bmedicine\b|\bhealth(?:care)?\b|\bclinical\b|nursing|pharma/,
  medical: /\bmedical\b|\bmedicine\b|\bhealth(?:care)?\b|\bclinical\b|nursing|pharma/,
  petroleum: /petroleum|oil and gas|upstream|downstream|reservoir|drilling|hydrocarbon/,
  geoscience: /geoscience|geology|geophysics|earth science|stratigraphy|sedimentology|geochemistry/,
  computerscience: /computer science|computing|software|informatics|information technology/,
  datascience: /data science|data analytics|big data|machine learning|data engineering/,
  realestate: /real estate|property|proptech|housing|urban development/,
  fintech: /fintech|financial technology|digital banking|payments/,
  sustainability: /sustainab|decarbon|net zero|circular economy|esg/
};

function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build regional matching from the canonical worldwide country table instead of maintaining a
 * second hand-written list. Adding a country to discovery geography therefore automatically makes
 * it searchable through its broad region as well.
 */
function countryPattern(predicate: (country: (typeof COUNTRIES)[number]) => boolean): RegExp {
  const names = COUNTRIES
    .filter(predicate)
    .flatMap((country) => [country.name, country.iso2.length > 2 ? country.iso2 : "", country.iso3, ...country.aliases])
    .map(normalize)
    .filter((value) => value.length > 2)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex);
  return new RegExp(`(?:^|[^a-z0-9])(?:${names.join("|")})(?:[^a-z0-9]|$)`);
}

const GCC_COUNTRIES = new Set(["Saudi Arabia", "United Arab Emirates", "Bahrain", "Qatar", "Kuwait", "Oman"]);
const MIDDLE_EAST_EXTENDED = new Set(["Egypt", "Turkey", "Cyprus"]);
const CENTRAL_AMERICA = new Set(["Belize", "Costa Rica", "El Salvador", "Guatemala", "Honduras", "Nicaragua", "Panama"]);
const CARIBBEAN = new Set([
  "Antigua and Barbuda", "Bahamas", "Barbados", "Cuba", "Dominica", "Dominican Republic", "Grenada",
  "Haiti", "Jamaica", "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines",
  "Trinidad and Tobago", "Puerto Rico", "Aruba", "Curaçao", "Sint Maarten", "Cayman Islands",
  "British Virgin Islands", "U.S. Virgin Islands", "Bermuda",
]);

const GEO_PATTERNS: Record<string, RegExp> = {
  gcc: countryPattern((country) => GCC_COUNTRIES.has(country.name)),
  gulf: countryPattern((country) => GCC_COUNTRIES.has(country.name)),
  middleeast: countryPattern((country) => country.region === "Middle East" || MIDDLE_EAST_EXTENDED.has(country.name)),
  europe: countryPattern((country) => country.region === "Europe"),
  asia: countryPattern((country) => country.region === "Asia"),
  asiapacific: countryPattern((country) => country.region === "Asia" || country.region === "Oceania"),
  africa: countryPattern((country) => country.region === "Africa"),
  subsaharanafrica: countryPattern((country) => country.region === "Africa" && !["Algeria", "Egypt", "Libya", "Morocco", "Tunisia"].includes(country.name)),
  northamerica: countryPattern((country) => country.region === "North America"),
  southamerica: countryPattern((country) => country.region === "South America"),
  latinamerica: countryPattern((country) => country.region === "South America" || country.name === "Mexico" || CENTRAL_AMERICA.has(country.name) || CARIBBEAN.has(country.name)),
  centralamerica: countryPattern((country) => CENTRAL_AMERICA.has(country.name)),
  caribbean: countryPattern((country) => CARIBBEAN.has(country.name)),
  oceania: countryPattern((country) => country.region === "Oceania"),
};

/** Flattens only explicitly supplied stored conference sections. Object keys are included so a
 * query such as "abstract deadline September" can match a stored
 * `abstract_submission_deadline` value without inventing any data. */
export function flattenStoredConferenceText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return normalize(value);
  }
  if (Array.isArray(value)) return value.map(flattenStoredConferenceText).filter(Boolean).join(" ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/^(?:provenance|source_urls?|quality_flags|conflicts?|pages_(?:read|failed))$/i.test(key))
      .flatMap(([key, nested]) => [normalize(key), flattenStoredConferenceText(nested)])
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

function normalizeQuery(query: string): string {
  let normalized = normalize(query);
  for (const [pattern, replacement] of QUERY_PHRASES) normalized = normalized.replace(pattern, replacement);
  return normalized;
}

function queryTokens(query: string): string[] {
  return [...new Set(normalizeQuery(query).split(/\s+/).filter(
    (token) => token.length > 1 && !QUERY_STOP_WORDS.has(token)
  ))];
}

/** Cache of the word-start matchers, since one search runs the same tokens over every record. */
const TOKEN_MATCHERS = new Map<string, RegExp>();

function wordStartMatcher(token: string): RegExp {
  let matcher = TOKEN_MATCHERS.get(token);
  if (!matcher) {
    matcher = new RegExp(`(?:^|[^a-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
    TOKEN_MATCHERS.set(token, matcher);
  }
  return matcher;
}

/** A token can match literally, by a conservative subject synonym, or by a geographic region. */
function tokenMatches(text: string, token: string): boolean {
  const geo = GEO_PATTERNS[token];
  if (geo) return geo.test(text) || wordStartMatcher(token).test(text);
  const semantic = SEMANTIC_PATTERNS[token];
  if (semantic) return semantic.test(text) || wordStartMatcher(token).test(text);
  return wordStartMatcher(token).test(text);
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0 && !/^(?:n\/?a|tbd|unknown|not available)$/i.test(value.trim());
  if (Array.isArray(value)) return value.some(hasMeaningfulValue);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).some(hasMeaningfulValue);
  return true;
}

/** Prefer deeply prepared records when relevance is otherwise similar. */
function deepCoverageBonus(fields: StoredConferenceSearchFields): number {
  const sections = [
    fields.callForPapers,
    fields.programAgenda,
    fields.keynoteSpeakers,
    fields.technicalCommittee,
    fields.sponsorsExhibitors,
    fields.venueAccommodation,
    fields.feesPricing,
    fields.community,
  ];
  return sections.filter(hasMeaningfulValue).length * 6;
}

/** Returns null when the stored record does not satisfy every meaningful query concept. */
export function scoreStoredConferenceRecord(
  query: string,
  fields: StoredConferenceSearchFields
): number | null {
  const tokens = queryTokens(query);
  const normalizedQuery = normalize(queryTokens(query).join(" "));
  const title = flattenStoredConferenceText(fields.title);
  const acronym = flattenStoredConferenceText(fields.acronym);
  const groups = [
    { weight: 120, text: `${title} ${acronym}`.trim() },
    { weight: 85, text: flattenStoredConferenceText([fields.topics, fields.categories, fields.keywords]) },
    { weight: 55, text: flattenStoredConferenceText(fields.description) },
    { weight: 38, text: flattenStoredConferenceText([fields.organizer, fields.location, fields.dates]) },
    { weight: 18, text: flattenStoredConferenceText([
      fields.callForPapers,
      fields.programAgenda,
      fields.keynoteSpeakers,
      fields.technicalCommittee,
      fields.sponsorsExhibitors,
      fields.venueAccommodation,
      fields.feesPricing,
      fields.community,
      fields.officialUrl,
    ]) },
  ];
  const allText = groups.map((group) => group.text).filter(Boolean).join(" ");
  const categoryPattern = CATEGORY_PATTERNS[normalize(query)];
  if (categoryPattern) {
    // Classify from the conference subject, not incidental mentions in sponsor rosters or URLs.
    const subject = groups.slice(0, 3).map((group) => group.text).join(" ");
    if (!new RegExp(categoryPattern, "i").test(subject)) return null;
  } else if (tokens.length > 0 && !tokens.every((token) => tokenMatches(allText, token))) return null;

  let score = 0;
  for (const token of tokens) {
    score += Math.max(0, ...groups.filter((group) => tokenMatches(group.text, token)).map((group) => group.weight));
  }

  if (normalizedQuery) {
    if (title === normalizedQuery || acronym === normalizedQuery) score += 1_200;
    else if (title.includes(normalizedQuery) || acronym.includes(normalizedQuery)) score += 600;
    else if (groups[1].text.includes(normalizedQuery)) score += 350;
    else if (groups[2].text.includes(normalizedQuery)) score += 180;
    else if (groups[3].text.includes(normalizedQuery)) score += 100;
    else if (groups[4].text.includes(normalizedQuery)) score += 30;
  }

  return score + deepCoverageBonus(fields);
}
