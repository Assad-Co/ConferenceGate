import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCatalogue, parseCatalogueCsv } from '../auditCatalogueSnapshot.mjs';

test('audit counts expired events, invalid dates, and missing sources without modifying data', () => {
 const records = [
  { title: 'Event A', startDate: '2026-01-01', endDate: '2026-01-03', officialUrl: 'https://example.org', organization: 'Society', country: 'UK' },
  { title: 'Event B', startDate: '2027-02-30', officialUrl: null },
  { title: 'Event A', startDate: '2026-01-01', endDate: '2026-01-03', officialUrl: 'https://example.org' },
 ];
 const original = JSON.stringify(records);
 const report = auditCatalogue(records, '2026-10-27');
 assert.equal(report.counters.total, 3);
 assert.equal(report.counters.past, 2);
 assert.equal(report.counters.invalidEventDate, 1);
 assert.equal(report.counters.duplicateKeys, 1);
 assert.equal(report.counters.missingOfficialUrl, 1);
 assert.equal(JSON.stringify(records), original);
});

test('valid calendar dates are classified as upcoming rather than unknown', () => {
 const report = auditCatalogue([{ title: 'Future Conference', startDate: '2027-06-01', endDate: '2027-06-03', officialUrl: 'https://example.org', organization: 'Society', country: 'UK' }], '2026-10-27');
 assert.equal(report.counters.upcoming, 1);
 assert.equal(report.counters.unknownDate, 0);
 assert.equal(report.counters.invalidEventDate, 0);
});

test('CSV parser handles quoted commas, embedded newlines and escaped quotes', () => {
 const csv = 'title,startDate,organization\n"Event, A",2027-06-01,"Society ""A"""\n"Event\nB",2027-07-01,Institute\n';
 const rows = parseCatalogueCsv(csv);
 assert.equal(rows.length, 2);
 assert.equal(rows[0].title, 'Event, A');
 assert.equal(rows[0].organization, 'Society "A"');
 assert.equal(rows[1].title, 'Event\nB');
});
