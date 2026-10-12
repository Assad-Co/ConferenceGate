import assert from 'node:assert/strict';
import test from 'node:test';
import type { LiveSearchResult } from '../../api/search';
import {
  catalogueFacetOptions,
  filterStoredDiscoveryResults,
  fitsStoredTiming,
  resultDetailCoverage,
  sortStoredDiscoveryResults,
} from '../discoveryResultFilter';

const base: LiveSearchResult = {
  title: 'Global Geoscience Congress 2027',
  link: 'https://example.org/geo-2027',
  snippet: 'Petroleum geoscience and subsurface technology.',
  displayLink: 'example.org',
  thumbnail: null,
  favicon: 'https://example.org/logo.png',
  organization: 'Society of Petroleum Geoscientists',
  category: 'Petroleum & Geoscience',
  categories: ['Energy'],
  prepared: true,
  location: { city: 'Manama', country: 'Bahrain' },
  startDate: '2027-03-18',
  endDate: '2027-03-20',
  format: 'in-person',
  sections: ['cfp', 'agenda', 'speakers', 'committee', 'sponsors', 'venue', 'fees'],
  description: 'A deep technical conference.',
  cfpStatus: 'Open',
  cfpHasData: true,
  cfpOpen: true,
};

const filters = {
  startMonth: '2026-09',
  endMonth: '',
  country: '',
  city: '',
  format: '',
  timing: '',
  category: '',
  organizer: '',
  cfpOnly: false,
  requiredSection: '',
  minimumDetailSections: 0,
  richDetailsOnly: false,
};

test('reactive stored filters combine location, organizer, section and depth', () => {
  const result = filterStoredDiscoveryResults([base], {
    ...filters,
    country: 'Bahrain',
    city: 'Manama',
    organizer: 'Petroleum Geoscientists',
    requiredSection: 'speakers',
    minimumDetailSections: 8,
  });
  assert.equal(result.length, 1);

  assert.equal(filterStoredDiscoveryResults([base], { ...filters, country: 'Brazil' }).length, 0);
  assert.equal(filterStoredDiscoveryResults([base], { ...filters, requiredSection: 'community' }).length, 0);
  assert.equal(filterStoredDiscoveryResults([base], { ...filters, minimumDetailSections: 9 }).length, 0);
});

test('virtual includes online and hybrid but not physical events', () => {
  assert.equal(filterStoredDiscoveryResults([{ ...base, format: 'online' }], { ...filters, format: 'Virtual' }).length, 1);
  assert.equal(filterStoredDiscoveryResults([{ ...base, format: 'hybrid' }], { ...filters, format: 'Virtual' }).length, 1);
  assert.equal(filterStoredDiscoveryResults([base], { ...filters, format: 'Virtual' }).length, 0);
});

test('timing filters inspect actual stored start/end dates', () => {
  assert.equal(fitsStoredTiming(base, 'multi-day'), true);
  assert.equal(fitsStoredTiming(base, 'one-day'), false);
  assert.equal(fitsStoredTiming({ ...base, startDate: '2027-03-18', endDate: '2027-03-18' }, 'one-day'), true);
});

test('open CFP and rich-details filters only use structured stored evidence', () => {
  assert.equal(filterStoredDiscoveryResults([base], { ...filters, cfpOnly: true }).length, 1);
  assert.equal(filterStoredDiscoveryResults([{ ...base, cfpOpen: false }], { ...filters, cfpOnly: true }).length, 0);
  assert.equal(resultDetailCoverage(base), 8);
  assert.equal(filterStoredDiscoveryResults([base], { ...filters, richDetailsOnly: true }).length, 1);
});

test('facets are built from the server catalogue snapshot, not a filtered page slice', () => {
  const usa = {
    ...base,
    title: 'AI Summit 2027',
    link: 'https://example.org/ai',
    organization: 'Global AI Society',
    location: { city: 'Boston', country: 'United States' },
    category: 'Artificial Intelligence',
  };
  const facets = catalogueFacetOptions([base, usa]);
  assert.deepEqual(facets.locations.map((item) => item.country), ['Bahrain', 'United States']);
  assert.ok(facets.organizers.includes('Global AI Society'));
  assert.ok(facets.categories.includes('Artificial Intelligence'));
});

test('sorting can prioritize completeness or open CFP without changing result identity', () => {
  const thin = {
    ...base,
    title: 'Thin Event 2027',
    link: 'https://example.org/thin',
    cfpOpen: false,
    sections: ['cfp'],
  };
  assert.equal(sortStoredDiscoveryResults([thin, base], 'complete')[0].title, base.title);
  assert.equal(sortStoredDiscoveryResults([thin, base], 'cfp')[0].title, base.title);
});
