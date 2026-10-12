import fs from 'node:fs';

const discoveryPath = new URL('../src/components/DiscoveryEngineAdvanced.tsx', import.meta.url);
const datasetPath = new URL('../server/dataset/staticDataset.ts', import.meta.url);
const countriesPath = new URL('../server/discovery/countries.ts', import.meta.url);

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return { source, changed: false };
  if (!source.includes(before)) throw new Error(`Global discovery expansion patch could not find: ${label}`);
  return { source: source.replace(before, after), changed: true };
}

let dataset = fs.readFileSync(datasetPath, 'utf8');
let datasetChanged = false;
{
  const before = `  const files = [\n    'phase52-major-conference-expansion.json',\n    'phase56-global-major-conferences.json',\n  ];`;
  const after = `  const files = [\n    // Every file below is an evidence-backed ConferenceGate manifest that already ships with\n    // production. Keeping all of them in the static fallback makes Discover resilient when Turso\n    // bootstrap is delayed, and prevents valid regional/famous conferences from disappearing.\n    'phase12-regional-expansion.json',\n    'phase12-verified-expansion.json',\n    'phase13-global-depth-expansion.json',\n    'phase52-major-conference-expansion.json',\n    'phase56-global-major-conferences.json',\n  ];`;
  const result = replaceOnce(dataset, before, after, 'verified manifest list');
  dataset = result.source;
  datasetChanged ||= result.changed;
}
if (datasetChanged) {
  fs.writeFileSync(datasetPath, dataset, 'utf8');
  console.log('Expanded static conference fallback to every verified regional/global manifest.');
}

const countrySource = fs.readFileSync(countriesPath, 'utf8');
const worldwideCountries = [...new Set(
  [...countrySource.matchAll(/\bc\(\s*"([^"]+)"/g)].map((match) => match[1].trim()).filter(Boolean)
)].sort((a, b) => a.localeCompare(b));
if (worldwideCountries.length < 190) {
  throw new Error(`Expected a worldwide country registry, found only ${worldwideCountries.length} names.`);
}

const famousOrganizers = [
  'IEEE',
  'ACM',
  'Society of Petroleum Engineers (SPE)',
  'American Association of Petroleum Geologists (AAPG)',
  'European Association of Geoscientists & Engineers (EAGE)',
  'Society of Exploration Geophysicists (SEG)',
  'American Geophysical Union (AGU)',
  'European Geosciences Union (EGU)',
  'American Chemical Society (ACS)',
  'American Physical Society (APS)',
  'American Society of Mechanical Engineers (ASME)',
  'AIChE',
  'American Heart Association',
  'Radiological Society of North America (RSNA)',
  'HIMSS',
  'Society for Neuroscience',
  'Black Hat',
  'RSA Conference',
  'Gartner',
  'World Economic Forum',
  'World Petroleum Council',
  'dmg events',
  'Informa Markets',
  'Terrapinn',
  'RX Global',
  'Messe Frankfurt',
  'Fira Barcelona',
  'ADNOC',
  'Saudi Aramco',
  'Elsevier',
];

let discovery = fs.readFileSync(discoveryPath, 'utf8');
let discoveryChanged = false;

{
  const before = `const POPULAR_SEARCHES = [\n  'Artificial Intelligence',\n  'Data Science',\n  'Cybersecurity',\n  'Engineering',\n  'Petroleum & Geoscience',\n  'Energy',\n  'Hydrogen & CCUS',\n  'Climate & Sustainability',\n  'Healthcare',\n  'Pharmaceuticals & Biotechnology',\n  'Finance',\n  'Aviation & Aerospace',\n  'Mining & Minerals',\n  'Real Estate',\n] as const;`;
  const after = `const POPULAR_SEARCHES = [\n  'Artificial Intelligence',\n  'Data Science',\n  'Cybersecurity',\n  'Computer Science',\n  'Robotics',\n  'Engineering',\n  'Petroleum & Geoscience',\n  'Energy',\n  'Hydrogen & CCUS',\n  'Renewable Energy',\n  'Climate & Sustainability',\n  'Healthcare',\n  'Medicine',\n  'Pharmaceuticals & Biotechnology',\n  'Finance',\n  'Fintech',\n  'Aviation & Aerospace',\n  'Mining & Minerals',\n  'Materials Science',\n  'Semiconductors',\n  'Telecommunications',\n  'Manufacturing',\n  'Logistics',\n  'Water',\n  'Agriculture',\n  'Education',\n  'Architecture & Construction',\n  'Real Estate',\n  'Business',\n  'Law & Policy',\n] as const;\n\n// Country choices are generated from the same canonical worldwide registry the server uses.\n// That keeps the client and server aligned and makes the filter truly global rather than limited\n// to whichever countries happen to appear in the first browse response.\nconst WORLDWIDE_COUNTRIES = ${JSON.stringify(worldwideCountries, null, 2)} as const;\n\n// Major scientific societies and global event organizers appear first as fast shortcuts. The\n// normal catalogue-derived organizer list is still preserved below, so smaller/regional organizers\n// remain fully searchable.\nconst FAMOUS_ORGANIZERS = ${JSON.stringify(famousOrganizers, null, 2)} as const;`;
  const result = replaceOnce(discovery, before, after, 'popular searches/global constants');
  discovery = result.source;
  discoveryChanged ||= result.changed;
}

{
  const before = `  const countryOptions = locationOptions.map((item) => item.country);`;
  const after = `  const countryOptions = useMemo(\n    () => [...new Set([...WORLDWIDE_COUNTRIES, ...locationOptions.map((item) => item.country)])]\n      .sort((a, b) => a.localeCompare(b)),\n    [locationOptions]\n  );`;
  const result = replaceOnce(discovery, before, after, 'worldwide country options');
  discovery = result.source;
  discoveryChanged ||= result.changed;
}

{
  const before = `  const organizerOptions = useMemo(() => {\n    const values = new Set(facets.organizers);\n    for (const conf of conferences || []) if (conf.organizerName?.trim()) values.add(conf.organizerName.trim());\n    return [...values].sort((a, b) => a.localeCompare(b));\n  }, [facets.organizers, conferences]);`;
  const after = `  const organizerOptions = useMemo(() => {\n    const values = new Set<string>(FAMOUS_ORGANIZERS);\n    for (const organizer of facets.organizers) values.add(organizer);\n    for (const conf of conferences || []) if (conf.organizerName?.trim()) values.add(conf.organizerName.trim());\n    return [...values].sort((a, b) => {\n      const aFeatured = FAMOUS_ORGANIZERS.includes(a as (typeof FAMOUS_ORGANIZERS)[number]);\n      const bFeatured = FAMOUS_ORGANIZERS.includes(b as (typeof FAMOUS_ORGANIZERS)[number]);\n      if (aFeatured !== bFeatured) return aFeatured ? -1 : 1;\n      return a.localeCompare(b);\n    });\n  }, [facets.organizers, conferences]);`;
  const result = replaceOnce(discovery, before, after, 'famous organizer options');
  discovery = result.source;
  discoveryChanged ||= result.changed;
}

{
  const before = `            {POPULAR_SEARCHES.map((suggestion) => (\n              <button`;
  const after = `            {FAMOUS_ORGANIZERS.slice(0, 12).map((organizer) => (\n              <button\n                key={organizer}\n                type=\"button\"\n                onClick={() => {\n                  setOrganizerFilter(organizer);\n                  setSearchTerm('');\n                  setSubmittedSearchTerm('');\n                }}\n                className={organizerFilter === organizer\n                  ? 'px-2.5 py-1 rounded-full border border-indigo-600 bg-indigo-600 text-[10px] font-semibold text-white cursor-pointer'\n                  : 'px-2.5 py-1 rounded-full border border-indigo-100 bg-indigo-50 text-[10px] font-semibold text-indigo-700 hover:border-indigo-300 cursor-pointer'}\n              >\n                {organizer}\n              </button>\n            ))}\n            {POPULAR_SEARCHES.map((suggestion) => (\n              <button`;
  const result = replaceOnce(discovery, before, after, 'famous organizer quick filters');
  discovery = result.source;
  discoveryChanged ||= result.changed;
}

{
  const before = `                <option value=\"\">Any country</option>\n                {countryOptions.map((country) => <option key={country} value={country}>{country}</option>)}`;
  const after = `                <option value=\"\">Any country — worldwide</option>\n                {countryOptions.map((country) => {\n                  const catalogueLocation = locationOptions.find((item) => item.country === country);\n                  const suffix = catalogueLocation ? ' • in catalogue' : '';\n                  return <option key={country} value={country}>{country}{suffix}</option>;\n                })}`;
  const result = replaceOnce(discovery, before, after, 'country labels');
  discovery = result.source;
  discoveryChanged ||= result.changed;
}

{
  const before = `                <option value=\"\">Any organizer / society</option>\n                {organizerOptions.map((organizer) => <option key={organizer} value={organizer}>{organizer}</option>)}`;
  const after = `                <option value=\"\">Any organizer / society</option>\n                <optgroup label=\"Major global organizers\">\n                  {FAMOUS_ORGANIZERS.map((organizer) => <option key={'featured-' + organizer} value={organizer}>{organizer}</option>)}\n                </optgroup>\n                <optgroup label=\"All organizers in Conference Gate\">\n                  {organizerOptions.filter((organizer) => !FAMOUS_ORGANIZERS.includes(organizer as (typeof FAMOUS_ORGANIZERS)[number]))\n                    .map((organizer) => <option key={organizer} value={organizer}>{organizer}</option>)}\n                </optgroup>`;
  const result = replaceOnce(discovery, before, after, 'organizer grouped options');
  discovery = result.source;
  discoveryChanged ||= result.changed;
}

{
  const before = `                {displayedStored.length} match{displayedStored.length === 1 ? '' : 'es'} from the stored global catalogue · facets from {facetSource.length} server records.`;
  const after = `                {displayedStored.length} match{displayedStored.length === 1 ? '' : 'es'} from the stored global catalogue · {countryOptions.length}+ countries/territories available · {organizerOptions.length} organizers indexed.`;
  const result = replaceOnce(discovery, before, after, 'catalogue scale summary');
  discovery = result.source;
  discoveryChanged ||= result.changed;
}

if (discoveryChanged) {
  fs.writeFileSync(discoveryPath, discovery, 'utf8');
  console.log(`Expanded Discover to ${worldwideCountries.length} canonical countries/territories and ${famousOrganizers.length} featured organizers.`);
} else {
  console.log('Global Discover expansion already applied.');
}
