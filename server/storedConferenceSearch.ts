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
  "artificial intelligence": "artificial intelligence|machine learning|deep learning|\\bai\\b",
  "cybersecurity": "cybersecurity|cyber security|information security|network security",
  "engineering": "engineering",
  "healthcare": "healthcare|health care|medical|medicine|clinical|nursing|pharma",
  "energy": "energy|renewable|solar|wind power|hydrogen|petroleum|oil and gas|electricity",
  "sustainability": "sustainab|circular economy|decarbon",
  "business": "business|management|entrepreneur|commerce|marketing|finance|trade",
  "education": "educat|teaching|learning|pedagog|academic|edtech",
  "finance": "financ|banking|fintech|investment",
  "law": "\\blaw\\b|legal|jurisprud",
  "science": "science|scientific|physics|chemistry|biology",
  "environment": "environment|ecolog|climate|conservation",
  "medicine": "medicin|medical|clinical|health|pharma",
  "agriculture": "agricultur|farming|agronom|crop",
  "architecture": "architectur|urban design",
  "arts culture": "\\barts\\b|cultur|humanities",
  "blockchain": "blockchain|web3|cryptocurrency",
  "climate": "climate|global warming|decarbon",
  "data science": "data science|data analytics|big data",
  "economics": "economic|econometr",
  "manufacturing": "manufactur|industrial production",
  "marketing": "marketing|advertising",
  "mathematics": "mathematic|statistics",
  "physics": "physics|quantum|photonics",
  "robotics": "robot|automation",
  "social sciences": "social science|sociolog|psycholog|anthropolog|political science",
  "tourism": "tourism|hospitality|travel"
};

const QUERY_STOP_WORDS = new Set([
  "conference", "conferences", "official", "website", "upcoming", "current",
  "from", "until", "and", "the", "in", "of", "for", "worldwide",
]);

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

function queryTokens(query: string): string[] {
  return [...new Set(normalize(query).split(/\s+/).filter(
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

/**
 * A token matches where a word starts with it.
 *
 * Not a plain substring test: "EAGE" was matching a record whose only "eage" was the middle of
 * spac-eage-nda.com, and a reader searching for a society does not expect somebody else's hostname.
 * Not a whole-word test either, because matching the start of a word is what lets "geochem" find
 * geochemistry and "robot" find robotics without a stemmer.
 */
function tokenMatches(text: string, token: string): boolean {
  if (token === "ai") return /\bai\b|artificial intelligence|machine learning/.test(text);
  if (token === "medical") return /\bmedical\b|\bmedicine\b|\bhealth(?:care)?\b|\bclinical\b/.test(text);
  return wordStartMatcher(token).test(text);
}

/** Returns null when the stored record does not satisfy every meaningful query token. Higher
 * scores represent direct identity/topic matches; incidental matches in long tab text rank last. */
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
  return score;
}
