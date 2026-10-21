import type { LiveSearchResult } from '../api/search';

export type DiscoveryResultSort = 'recommended' | 'soonest' | 'complete' | 'cfp';

export interface DiscoveryResultFilters {
  startMonth: string;
  endMonth: string;
  country: string;
  city: string;
  format: string;
  timing: string;
  category: string;
  organizer: string;
  cfpOnly: boolean;
  requiredSection: string;
  minimumDetailSections: number;
  richDetailsOnly: boolean;
}

export function resultDetailCoverage(result: LiveSearchResult): number {
  return Math.min(9, 1 + new Set(result.sections || []).size);
}

function exactMonth(result: LiveSearchResult): string | null {
  const stated = String(result.startDate || '').trim();
  return /^\d{4}-\d{2}/.test(stated) ? stated.slice(0, 7) : null;
}

export function fitsStoredDateWindow(
  result: LiveSearchResult,
  startMonth: string,
  endMonth: string
): boolean {
  const month = exactMonth(result);
  if (month) {
    if (startMonth && month < startMonth) return false;
    if (endMonth && month > endMonth) return false;
    return true;
  }

  // A sparse stored record may state the year only in its title. Use that as a conservative
  // fallback, but never reject a record merely because the date is unknown.
  const years = [...String(result.title || '').matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1]));
  if (!years.length) return !endMonth;
  const startYear = startMonth ? Number(startMonth.slice(0, 4)) : 0;
  const endYear = endMonth ? Number(endMonth.slice(0, 4)) : Number.POSITIVE_INFINITY;
  return years.some((year) => year >= startYear && year <= endYear);
}

export function fitsStoredTiming(result: LiveSearchResult, timing: string): boolean {
  if (!timing) return true;
  const startText = String(result.startDate || '');
  const endText = String(result.endDate || result.startDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startText) || !/^\d{4}-\d{2}-\d{2}$/.test(endText)) {
    return false;
  }
  const start = new Date(`${startText}T12:00:00Z`);
  const end = new Date(`${endText}T12:00:00Z`);
  const duration = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  const touchesWeekend = (() => {
    const cursor = new Date(start);
    while (cursor <= end) {
      const day = cursor.getUTCDay();
      if (day === 0 || day === 6) return true;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return false;
  })();

  if (timing === 'one-day') return duration === 1;
  if (timing === 'multi-day') return duration >= 2;
  if (timing === 'weekend') return touchesWeekend;
  if (timing === 'weekday') return !touchesWeekend;
  return true;
}

function normalizedFormat(format: string | null | undefined): string {
  const normalized = String(format || '').toLowerCase().replace(/[-\s]+/g, '');
  if (normalized === 'online') return 'virtual';
  return normalized;
}

function normalizedOrganizerText(value: string | null | undefined): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ORGANIZER_ALIAS_GROUPS = [
  ['ieee', 'institute of electrical and electronics engineers'],
  ['acm', 'association for computing machinery'],
  ['spe', 'society of petroleum engineers'],
  ['aapg', 'american association of petroleum geologists'],
  ['eage', 'european association of geoscientists and engineers', 'european association of geoscientists engineers'],
  ['seg', 'society of exploration geophysicists'],
  ['agu', 'american geophysical union'],
  ['egu', 'european geosciences union'],
  ['acs', 'american chemical society'],
  ['aps', 'american physical society'],
  ['asme', 'american society of mechanical engineers'],
  ['aiche', 'american institute of chemical engineers'],
  ['rsna', 'radiological society of north america'],
  ['himss', 'healthcare information and management systems society'],
  ['wpc', 'world petroleum council'],
] as const;

function organizerAliases(value: string | null | undefined): Set<string> {
  const normalized = normalizedOrganizerText(value);
  const aliases = new Set<string>();
  if (!normalized) return aliases;
  aliases.add(normalized);

  const original = String(value || '');
  for (const match of original.matchAll(/\(([A-Za-z][A-Za-z0-9-]{1,12})\)/g)) {
    aliases.add(normalizedOrganizerText(match[1]));
  }

  for (const group of ORGANIZER_ALIAS_GROUPS) {
    if (group.some((alias) => normalized.includes(alias))) {
      group.forEach((alias) => aliases.add(alias));
    }
  }
  return aliases;
}

export function organizerMatchesFilter(
  organization: string | null | undefined,
  filter: string | null | undefined
): boolean {
  const wanted = organizerAliases(filter);
  if (!wanted.size) return true;
  const actual = organizerAliases(organization);
  for (const wantedAlias of wanted) {
    for (const actualAlias of actual) {
      if (actualAlias === wantedAlias || actualAlias.includes(wantedAlias) || wantedAlias.includes(actualAlias)) {
        return true;
      }
    }
  }
  return false;
}

// Match closely related disciplines without inventing conference records.
// A selected category still needs evidence in the actual stored conference text.
const RELATED_CATEGORY_TERMS: Record<string, string[]> = {
  'architecture & construction': ['architecture', 'construction', 'built environment', 'building technology', 'civil engineering', 'urban planning', 'building information modeling', 'bim'],
  'petroleum & geoscience': ['petroleum', 'geoscience', 'geology', 'geophysics', 'geochemistry', 'upstream', 'reservoir engineering'],
  'artificial intelligence': ['artificial intelligence', 'machine learning', 'deep learning', 'generative ai', 'neural network'],
  'renewable energy': ['renewable energy', 'solar energy', 'wind energy', 'clean energy', 'photovoltaic'],
  'healthcare': ['healthcare', 'medical', 'clinical', 'public health', 'health informatics'],
};

function categoryMatchesConference(text: string, selected: string): boolean {
  const terms = RELATED_CATEGORY_TERMS[selected] || [selected];
  return terms.some((term) => text.includes(term));
}

export function filterStoredDiscoveryResults(
  results: LiveSearchResult[],
  filters: DiscoveryResultFilters
): LiveSearchResult[] {
  const country = filters.country.trim().toLowerCase();
  const city = filters.city.trim().toLowerCase();
  const category = filters.category.trim().toLowerCase();
  const organizer = filters.organizer.trim();
  const wantedFormat = normalizedFormat(filters.format);
  const requiredSection = filters.requiredSection.trim().toLowerCase();
  const minimumDetails = Math.max(filters.minimumDetailSections, filters.richDetailsOnly ? 6 : 0);

  return results.filter((result) => {
    if (!fitsStoredDateWindow(result, filters.startMonth, filters.endMonth)) return false;
    if (country && !String(result.location?.country || '').toLowerCase().includes(country)) return false;
    if (city && !String(result.location?.city || '').toLowerCase().includes(city)) return false;

    if (wantedFormat) {
      const actual = normalizedFormat(result.format);
      if (wantedFormat === 'virtual') {
        if (actual !== 'virtual' && actual !== 'hybrid') return false;
      } else if (actual !== wantedFormat) return false;
    }

    if (filters.timing && !fitsStoredTiming(result, filters.timing)) return false;

    if (category) {
      const categoryText = [
        result.category,
        ...(result.categories || []),
        result.title,
        result.description,
        result.snippet,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!categoryMatchesConference(categoryText, category)) return false;
    }

    if (organizer && !organizerMatchesFilter(result.organization, organizer)) return false;
    if (filters.cfpOnly && result.cfpOpen !== true) return false;
    if (requiredSection && !result.sections?.includes(requiredSection)) return false;
    if (minimumDetails > 0 && resultDetailCoverage(result) < minimumDetails) return false;
    return true;
  });
}

export function sortStoredDiscoveryResults(
  results: LiveSearchResult[],
  sort: DiscoveryResultSort
): LiveSearchResult[] {
  return [...results].sort((left, right) => {
    if (sort === 'soonest') {
      const leftDate = left.startDate ? Date.parse(left.startDate) : Number.POSITIVE_INFINITY;
      const rightDate = right.startDate ? Date.parse(right.startDate) : Number.POSITIVE_INFINITY;
      return leftDate - rightDate || resultDetailCoverage(right) - resultDetailCoverage(left);
    }
    if (sort === 'complete') return resultDetailCoverage(right) - resultDetailCoverage(left);
    if (sort === 'cfp') {
      const cfpDifference = Number(right.cfpOpen === true) - Number(left.cfpOpen === true);
      return cfpDifference || resultDetailCoverage(right) - resultDetailCoverage(left);
    }
    return 0;
  });
}

export function catalogueFacetOptions(results: LiveSearchResult[]) {
  const countries = new Map<string, Set<string>>();
  const organizers = new Set<string>();
  const categories = new Set<string>();

  for (const result of results) {
    const country = result.location?.country?.trim();
    const city = result.location?.city?.trim();
    if (country) {
      if (!countries.has(country)) countries.set(country, new Set());
      if (city) countries.get(country)!.add(city);
    }
    if (result.organization?.trim()) organizers.add(result.organization.trim());
    for (const category of [result.category, ...(result.categories || [])]) {
      if (category?.trim()) categories.add(category.trim());
    }
  }

  return {
    locations: [...countries.entries()]
      .map(([country, cities]) => ({
        country,
        cities: [...cities].sort((left, right) => left.localeCompare(right)),
      }))
      .sort((left, right) => left.country.localeCompare(right.country)),
    organizers: [...organizers].sort((left, right) => left.localeCompare(right)),
    categories: [...categories].sort((left, right) => left.localeCompare(right)),
  };
}
