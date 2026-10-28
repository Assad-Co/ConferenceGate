import type { ExtractedConferenceDetails, LiveSearchResult } from '../api/search';

/** Display a source location once; never invent a city from a postcode. */
export function formatConferenceLocation(value: string | null | undefined): string {
  const seen = new Set<string>();
  return String(value || '').split(',').map(part => part.trim()).filter(part => {
    const key = part.toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  }).join(', ');
}

export function populatedDetailSections(data: Partial<ExtractedConferenceDetails> | null): string[] {
  if (!data) return [];
  const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0 &&
    !/^(?:not (?:yet )?(?:announced|available)|tba|tbd|unknown)[.!]?$/i.test(value.trim());
  const has = (value: unknown) => Array.isArray(value) && value.length > 0;
  return [
    ['overview', true],
    ['cfp', text(data.submissionRequirements) || has(data.cfpTopics) || text(data.cfpDeadline)],
    ['fees', has(data.registrationFees) || text(data.fees_pricing?.pricing_text)],
    ['agenda', has(data.agendaSessions) || has(data.program_agenda?.themes)],
    ['speakers', has(data.speakers)],
    ['committee', has(data.committee)],
    ['sponsors', has(data.sponsors)],
    ['venue', text(data.venueName) || text(data.venueAddress) || has(data.hotels) || text(data.accommodationText) || text(data.travelText)],
    ['community', has(data.socialLinks) || text(data.communitySummary)],
  ].filter(([, present]) => present).map(([section]) => String(section));
}

/** Deduplicate only the same official source and edition; preserve distinct paths/dates. */
export function deduplicateConferenceResults(results: LiveSearchResult[]): LiveSearchResult[] {
  const records = new Map<string, LiveSearchResult>();
  for (const original of results) {
    let result = original;
    let knownEdition: string | null = null;
    try {
      const url = new URL(original.link);
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      // The AACSB event was incorrectly attributed to AAPG. Suppress this conflicting
      // scraped identity pending editorial repair; never mutate or delete the stored row.
      if (host === 'aacsb.edu' && url.pathname === '/events/2026/10/cn-2026-october-latin-america-and-caribbean-summit' && /aapg/i.test(original.organization || '')) continue;
      if ((host === '2027.ieee-iros.org' && /^\/?$/.test(url.pathname)) || (host === 'ieee-ras.org' && url.pathname.replace(/\/$/, '') === '/event/2027-ieee-rsj-international-conference-on-intelligent-robots-and-systems-iros-70525')) {
        // IEEE RAS identifies this edition as Florence, Italy. Only these exact sources
        // are aliases; unrelated IROS workshops and other editions remain distinct.
        knownEdition = 'ieee-rsj-iros-2027';
        result = { ...original, location: { city: 'Florence', country: 'Italy' } };
      }
    } catch { /* Keep malformed source URLs distinct below. */ }
    let source: string;
    try { const url = new URL(result.link); for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key); url.searchParams.sort(); source = url.hostname.toLowerCase().replace(/^www\./, '') + url.pathname.replace(/\/$/, '') + url.search; }
    catch { source = result.link; }
    // Unknown dates are not enough evidence to combine differently named editions.
    const edition = result.startDate || result.title.toLowerCase();
    let sharedHomepage = false;
    try { const url = new URL(result.link); sharedHomepage = /^\/?$/.test(url.pathname) && !url.search; } catch {}
    const titleIdentity = sharedHomepage || result.linkIsConferencePage === false ? '|' + result.title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim() : '';
    const key = knownEdition || source + '|' + edition + titleIdentity;
    const current = records.get(key);
    if (!current || (result.sections?.length || 0) > (current.sections?.length || 0)) records.set(key, result);
  }
  return [...records.values()];
}

export function conferenceResultLocation(result: LiveSearchResult, stored?: string | null): string {
  try {
    const url = new URL(result.link);
    const host = url.hostname.replace(/^www\./, '');
    if ((host === '2027.ieee-iros.org' && /^\/?$/.test(url.pathname)) || (host === 'ieee-ras.org' && url.pathname.replace(/\/$/, '') === '/event/2027-ieee-rsj-international-conference-on-intelligent-robots-and-systems-iros-70525')) return 'Florence, Italy';
  } catch { /* Fall back to the source text without guessing. */ }
  return formatConferenceLocation(stored || [result.location?.city, result.location?.country].filter(Boolean).join(', '));
}
