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

/** Multi-word geographic concepts become one semantic token before tokenisation. This lets a query
 * such as "Middle East energy 2027" match a Bahrain record even when the record never literally
 * says "Middle East". */
const QUERY_PHRASES: Array<[RegExp, string]> = [
  [/\bmiddle\s+east\b/g, "middleeast"],
  [/\bnorth\s+america\b/g, "northamerica"],
  [/\bsouth\s+america\b/g, "southamerica"],
  [/\blatin\s+america\b/g, "southamerica"],
  [/\basia\s+pacific\b/g, "asiapacific"],
  [/\boil\s+(?:and|&)\s+gas\b/g, "petroleum"],
  [/\bearth\s+science(?:s)?\b/g, "geoscience"],
  [/\bhealth\s+care\b/g, "healthcare"],
  [/\breal\s+estate\b/g, "realestate"],
  [/\bcomputer\s+science\b/g, "computerscience"],
  [/\bdata\s+science\b/g, "datascience"]
];

const GEO_PATTERNS: Record<string, RegExp> = {
  gcc: /\b(saudi arabia|united arab emirates|uae|bahrain|qatar|kuwait|oman)\b/,
  gulf: /\b(saudi arabia|united arab emirates|uae|bahrain|qatar|kuwait|oman)\b/,
  middleeast: /\b(saudi arabia|united arab emirates|uae|bahrain|qatar|kuwait|oman|jordan|lebanon|iraq|iran|israel|palestine|yemen|syria|egypt|turkey|türkiye)\b/,
  europe: /\b(united kingdom|uk|ireland|france|germany|spain|portugal|italy|netherlands|belgium|luxembourg|switzerland|austria|poland|czechia|czech republic|slovakia|hungary|romania|bulgaria|greece|croatia|slovenia|serbia|bosnia|montenegro|albania|north macedonia|norway|sweden|finland|denmark|iceland|estonia|latvia|lithuania|ukraine|moldova|malta|cyprus)\b/,
  asia: /\b(china|japan|south korea|korea|india|pakistan|bangladesh|sri lanka|nepal|bhutan|singapore|malaysia|indonesia|thailand|vietnam|philippines|cambodia|laos|myanmar|mongolia|kazakhstan|uzbekistan|kyrgyzstan|tajikistan|turkmenistan|taiwan|hong kong|macau|brunei)\b/,
  asiapacific: /\b(china|japan|south korea|korea|india|singapore|malaysia|indonesia|thailand|vietnam|philippines|taiwan|hong kong|australia|new zealand|papua new guinea|fiji)\b/,
  africa: /\b(egypt|morocco|algeria|tunisia|libya|south africa|nigeria|ghana|kenya|ethiopia|tanzania|uganda|rwanda|senegal|ivory coast|cote d ivoire|angola|mozambique|namibia|botswana|zambia|zimbabwe|mauritius)\b/,
  northamerica: /\b(united states|usa|u s a|canada|mexico)\b/,
  southamerica: /\b(brazil|argentina|chile|colombia|peru|ecuador|uruguay|paraguay|bolivia|venezuela|guyana|suriname|costa rica|panama|guatemala|dominican republic|puerto rico)\b/,
  oceania: /\b(australia|new zealand|papua new guinea|fiji|samoa|tonga|vanuatu)\b/
};

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

/** A token can match literally, by a conservative subject synonym, or by a geographic region.
 * Geographic expansion operates on stored text only; it never fabricates a location. */
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

/** Prefer deeply prepared records when relevance is otherwise similar. The bonus is deliberately
 * capped well below a direct title/topic hit, so completeness can break ties but cannot overpower
 * what the visitor actually searched for. */
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

/** Returns null when the stored record does not satisfy every meaningful query concept. Higher
 * scores represent direct identity/topic matches; incidental matches in long tab text rank last.
 * Natural-language filler, "worldwide", and common discovery verbs do not accidentally narrow the
 * catalogue. Regional concepts such as GCC, Europe and Middle East resolve against country data. */
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
