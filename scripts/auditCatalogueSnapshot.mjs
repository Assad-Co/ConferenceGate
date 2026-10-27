#!/usr/bin/env node
// Read-only audit of a local catalogue snapshot. No network or database writes.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function auditCatalogue(records, today = new Date().toISOString().slice(0, 10)) {
  const counters = { total: records.length, past: 0, upcoming: 0, unknownDate: 0,
    missingTitle: 0, missingOfficialUrl: 0, missingOrganizer: 0,
    missingCountry: 0, invalidEventDate: 0, expiredAbstractDeadline: 0, duplicateKeys: 0 };
  const examples = { past: [], missingOfficialUrl: [], duplicateKeys: [] };
  const seen = new Set();
  const validDay = (s) => {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  };
  const missing = (v) => typeof v !== 'string' || !v.trim();
  const note = (key, value) => { if (examples[key]?.length < 10) examples[key].push(value); };
  for (const row of records) {
    const title = row.title;
    const start = row.startDate ?? row.start_date;
    const end = row.endDate ?? row.end_date ?? start;
    const url = row.officialUrl ?? row.official_url;
    const organizer = row.organization ?? row.organizer;
    const country = row.country;
    if (missing(title)) counters.missingTitle++;
    if (missing(url)) { counters.missingOfficialUrl++; note('missingOfficialUrl', title ?? row.id ?? 'untitled'); }
    if (missing(organizer)) counters.missingOrganizer++;
    if (missing(country)) counters.missingCountry++;
    if (start && !validDay(start) || end && !validDay(end)) counters.invalidEventDate++;
    if (!start || !validDay(start) || !end || !validDay(end)) counters.unknownDate++;
    else if (end < today) { counters.past++; note('past', title ?? row.id ?? 'untitled'); }
    else counters.upcoming++;
    const cfp = row.deadlines?.abstractDeadline ?? row.abstractDeadline ?? row.abstract_deadline;
    if (validDay(cfp) && cfp < today) counters.expiredAbstractDeadline++;
    // Duplicate candidates only: same normalized title + start date. Never delete records.
    if (!missing(title) && validDay(start)) {
      const key = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + '|' + start;
      if (seen.has(key)) { counters.duplicateKeys++; note('duplicateKeys', title); }
      seen.add(key);
    }
  }
  return { auditedAt: today, source: 'local snapshot only; not production database', counters, examples };
}

/** Parse RFC4180-style CSV, including quoted commas, quotes and multiline fields. */
export function parseCatalogueCsv(input) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (quoted) throw new Error('Unterminated CSV quoted field');
  if (row.length || cell) { row.push(cell); rows.push(row); }
  const [headers, ...data] = rows;
  if (!headers?.includes('title') || !headers.includes('startDate')) throw new Error('Invalid catalogue CSV headers');
  return data.filter(row => row.some(value => value.trim())).map(row =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const filename = process.argv[2] ?? 'data/conferencegate-worldwide-2026-2028.csv';
  const content = fs.readFileSync(filename, 'utf8');
  const raw = filename.toLowerCase().endsWith('.csv') ? parseCatalogueCsv(content) : JSON.parse(content);
  const records = Array.isArray(raw) ? raw : raw.records;
  if (!Array.isArray(records)) throw new Error('Expected an array or { records: [...] }');
  process.stdout.write(JSON.stringify({ ...auditCatalogue(records), source: 'repository snapshot: ' + filename + '; not production database' }, null, 2) + '\n');
}
