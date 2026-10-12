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

export function filterStoredDiscoveryResults(
  results: LiveSearchResult[],
  filters: DiscoveryResultFilters
): LiveSearchResult[] {
  const country = filters.country.trim().toLowerCase();
  const city = filters.city.trim().toLowerCase();
  const category = filters.category.trim().toLowerCase();
  const organizer = filters.organizer.trim().toLowerCase();
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
      if (!categoryText.includes(category)) return false;
    }

    if (organizer && !String(result.organization || '').toLowerCase().includes(organizer)) return false;
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
