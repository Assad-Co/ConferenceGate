import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), 'data', 'conferencegate-worldwide-2026-2028.json');
if (!fs.existsSync(file)) {
  throw new Error('Rich launch catalogue JSON is missing.');
}

const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
let parsed;
try {
  parsed = JSON.parse(text);
} catch (error) {
  throw new Error(`Rich launch catalogue JSON is invalid: ${error?.message || error}`);
}

const records = Array.isArray(parsed)
  ? parsed
  : Array.isArray(parsed?.records)
    ? parsed.records
    : Array.isArray(parsed?.conferences)
      ? parsed.conferences
      : [];

if (records.length < 253) {
  throw new Error(`Rich launch catalogue unexpectedly contains only ${records.length} records; expected at least 253.`);
}

const identified = records.filter((record) => record && typeof record === 'object' && (record.id || record.conference_name || record.title));
if (identified.length < 253) {
  throw new Error(`Only ${identified.length} rich catalogue records have usable conference identity.`);
}

console.log(`[launch-dataset-integrity] valid=true records=${records.length} identified=${identified.length}`);
