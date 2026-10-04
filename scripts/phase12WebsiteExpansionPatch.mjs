import fs from 'node:fs';
import path from 'node:path';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`[phase12] ${label}: expected source pattern not found`);
  return source.replace(before, after);
}

function patchRequestedExpansion() {
  const file = path.resolve('scripts/syncRequestedCategoryExpansion.mjs');
  let source = fs.readFileSync(file, 'utf8');

  if (!source.includes('phase12-verified-expansion.json')) {
    source = replaceOnce(
      source,
      'const EVENTS=[',
      `const PHASE12_EVENTS = JSON.parse(\n  fs.readFileSync(path.join(process.cwd(), 'data', 'phase12-verified-expansion.json'), 'utf8')\n);\n\nconst EVENTS=[...PHASE12_EVENTS,`,
      'merge verified expansion data'
    );
  }

  source = source.replace(
    "fees_pricing:'not_announced',",
    "fees_pricing:e.fees?'stated':'not_announced',"
  );

  source = source.replace(
    "venue_accommodation:e.venueInfo?'stated':'not_announced',",
    "venue_accommodation:e.venueInfo?'stated':'not_announced',"
  );

  const emptyFees = "JSON.stringify({}),JSON.stringify(e.community||{}),JSON.stringify(meta)]});";
  const realFees = "JSON.stringify(e.fees||{}),JSON.stringify(e.community||{}),JSON.stringify(meta)]});";
  if (source.includes(emptyFees)) source = source.replaceAll(emptyFees, realFees);
  if (!source.includes(realFees)) throw new Error('[phase12] fees payload was not wired into extracted_conferences');

  fs.writeFileSync(file, source);
}

function patchSponsorDemoLeak() {
  const file = path.resolve('src/App.tsx');
  let source = fs.readFileSync(file, 'utf8');
  const sponsorSection = source.indexOf("{activeTab === 'sponsor'");
  if (sponsorSection < 0) throw new Error('[phase12] SponsorPortal render section not found');
  const before = source.slice(0, sponsorSection);
  let after = source.slice(sponsorSection);
  const demoProp = 'sponsorshipOpportunities={sampleSponsorshipOpportunities}';
  if (after.includes(demoProp)) {
    after = after.replace(demoProp, 'sponsorshipOpportunities={[]}');
  }
  if (!after.includes('sponsorshipOpportunities={[]}')) {
    throw new Error('[phase12] SponsorPortal demo opportunity removal did not apply');
  }
  fs.writeFileSync(file, before + after);
}

function patchHomeExploration() {
  const file = path.resolve('src/components/HomeLanding.tsx');
  let source = fs.readFileSync(file, 'utf8');
  const start = source.indexOf('  const exploreFields = [');
  const end = source.indexOf('  ];', start);
  if (start < 0 || end < 0) throw new Error('[phase12] Home exploreFields block not found');
  const replacement = `  const exploreFields = [\n    'Artificial Intelligence',\n    'Data Science',\n    'Cybersecurity',\n    'Robotics & Automation',\n    'Telecommunications',\n    'Software & Cloud',\n    'Petroleum & Geoscience',\n    'Energy',\n    'Natural Gas & LNG',\n    'Hydrogen & CCUS',\n    'Renewable Energy',\n    'Healthcare',\n    'Public Health',\n    'Pharmaceuticals & Biotechnology',\n    'Engineering',\n    'Materials Science',\n    'Manufacturing',\n    'Automotive & Mobility',\n    'Finance',\n    'Business',\n    'Climate & Sustainability',\n    'Government & Policy',\n    'Education',\n    'Blockchain & Web3',\n    'Real Estate',\n    'Virtual conferences',\n    'Open call for papers',\n  ];`;
  source = source.slice(0, start) + replacement + source.slice(end + 4);

  source = source.replace(
    'Jump directly into the worldwide catalogue',
    'Explore the growing worldwide catalogue across research, technology, energy, health and business'
  );

  source = source.replace(
    'Share a paper acceptance, CFP alert, or milestone above — or explore active conferences to build your network.',
    'Start with a live CFP, conference field, or research milestone. ConferenceGate now spans global technology, energy, geoscience, health, engineering and business events.'
  );

  fs.writeFileSync(file, source);
}

function patchDiscoverySuggestions() {
  const file = path.resolve('src/components/DiscoveryEngine.tsx');
  let source = fs.readFileSync(file, 'utf8');
  if (!source.includes("  'Natural Gas & LNG',")) {
    source = replaceOnce(
      source,
      "  'Petroleum & Geoscience',\n  'Renewable Energy',",
      "  'Petroleum & Geoscience',\n  'Natural Gas & LNG',\n  'Renewable Energy',",
      'Natural Gas & LNG discovery chip'
    );
  }
  fs.writeFileSync(file, source);
}

function verifyExpansionData() {
  const file = path.resolve('data/phase12-verified-expansion.json');
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(rows) || rows.length < 9) throw new Error('[phase12] expansion set is unexpectedly small');
  const urls = new Set();
  const titles = new Set();
  for (const row of rows) {
    for (const field of ['title','url','start','end','city','country','organizer']) {
      if (!String(row[field] || '').trim()) throw new Error(`[phase12] ${row.title || 'row'} missing ${field}`);
    }
    if (!/^https:\/\//.test(row.url)) throw new Error(`[phase12] non-HTTPS official URL: ${row.url}`);
    if (row.start < '2026-10-04') throw new Error(`[phase12] past conference entered into expansion: ${row.title}`);
    if (row.end < row.start) throw new Error(`[phase12] invalid date range: ${row.title}`);
    const titleKey = row.title.toLowerCase();
    if (titles.has(titleKey)) throw new Error(`[phase12] duplicate title: ${row.title}`);
    titles.add(titleKey);
    if (urls.has(row.url) && !/blackhat\.com\/upcoming/.test(row.url)) {
      throw new Error(`[phase12] duplicate official URL: ${row.url}`);
    }
    urls.add(row.url);
    if (!Array.isArray(row.categories) || row.categories.length < 2) throw new Error(`[phase12] weak category coverage: ${row.title}`);
    if (!Array.isArray(row.sourceUrls) || row.sourceUrls.length < 1) throw new Error(`[phase12] no official source evidence: ${row.title}`);
  }
  console.log(JSON.stringify({ phase: '12', verifiedExpansionRows: rows.length, countries: [...new Set(rows.map(r => r.country))].length, categories: [...new Set(rows.flatMap(r => r.categories))].length }, null, 2));
}

patchRequestedExpansion();
patchSponsorDemoLeak();
patchHomeExploration();
patchDiscoverySuggestions();
verifyExpansionData();
console.log('[phase12] website expansion patch complete');
