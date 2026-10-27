import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCatalogue } from '../auditCatalogueSnapshot.mjs';

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
