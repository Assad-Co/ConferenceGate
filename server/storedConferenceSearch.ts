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

function tokenMatches(text: string, token: string): boolean {
  if (token === "ai") return /\bai\b|artificial intelligence|machine learning/.test(text);
  if (token === "medical") return /\bmedical\b|\bmedicine\b|\bhealth(?:care)?\b|\bclinical\b/.test(text);
  return text.includes(token);
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
  if (tokens.length > 0 && !tokens.every((token) => tokenMatches(allText, token))) return null;

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
