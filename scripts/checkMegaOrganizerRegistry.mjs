import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), 'data', 'phase57-mega-organizer-registry.json');
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
const sources = Array.isArray(manifest.sources) ? manifest.sources : [];
const allowedTypes = new Set([
  'official_conference_site','professional_society','scientific_organization','medical_society',
  'engineering_society','university','research_institute','government','professional_association',
  'publisher','conference_organizer','convention_organization'
]);
const seen = new Set();
const duplicates = [];
const invalid = [];
const tierCounts = {};
const regions = new Set();
const categories = new Set();

for (const source of sources) {
  const domain = String(source?.domain || '').trim().toLowerCase().replace(/^www\./, '');
  if (!domain || !domain.includes('.') || domain.includes('://') || domain.includes('/')) invalid.push({ domain, reason: 'invalid_domain' });
  if (!source?.sourceName) invalid.push({ domain, reason: 'missing_source_name' });
  if (!allowedTypes.has(source?.sourceType)) invalid.push({ domain, reason: 'invalid_source_type' });
  const tier = Number(source?.tier || 0);
  if (![1,2,3].includes(tier)) invalid.push({ domain, reason: 'invalid_tier' });
  if (seen.has(domain)) duplicates.push(domain);
  seen.add(domain);
  tierCounts[tier] = (tierCounts[tier] || 0) + 1;
  if (source?.region) regions.add(String(source.region));
  for (const category of Array.isArray(source?.categories) ? source.categories : []) categories.add(String(category));
}

if (sources.length < 100) throw new Error(`Phase 57 registry is too small: ${sources.length}; expected at least 100 authoritative sources.`);
if ((tierCounts[1] || 0) < 40) throw new Error(`Phase 57 tier-1 coverage too small: ${tierCounts[1] || 0}; expected at least 40 priority sources.`);
if (regions.size < 5) throw new Error(`Phase 57 geography too narrow: ${regions.size} regions.`);
if (categories.size < 25) throw new Error(`Phase 57 subject coverage too narrow: ${categories.size} categories.`);
if (duplicates.length) throw new Error(`Duplicate Phase 57 domains: ${duplicates.join(', ')}`);
if (invalid.length) throw new Error(`Invalid Phase 57 source rows: ${JSON.stringify(invalid.slice(0, 10))}`);
if (Number(manifest.targetPublished || 0) < 1000) throw new Error('Phase 57 publish-ready target must be at least 1000.');
if (Number(manifest.targetAccepted || 0) < Number(manifest.targetPublished || 0)) throw new Error('Accepted target must be >= publish-ready target.');

console.log(JSON.stringify({
  sources: sources.length,
  tiers: tierCounts,
  regions: [...regions].sort(),
  categories: categories.size,
  targetAccepted: manifest.targetAccepted,
  targetPublished: manifest.targetPublished,
  years: manifest.years,
}));
