import test from 'node:test';
import assert from 'node:assert/strict';
import { organizerMatchesFilter } from '../../../src/utils/discoveryResultFilter';

test('major organizer acronyms and full names are interchangeable', () => {
  assert.equal(organizerMatchesFilter('SPE', 'Society of Petroleum Engineers (SPE)'), true);
  assert.equal(organizerMatchesFilter('Society of Petroleum Engineers', 'SPE'), true);
  assert.equal(organizerMatchesFilter('AAPG', 'American Association of Petroleum Geologists (AAPG)'), true);
  assert.equal(organizerMatchesFilter('European Association of Geoscientists & Engineers', 'EAGE'), true);
  assert.equal(organizerMatchesFilter('American Geophysical Union', 'AGU'), true);
  assert.equal(organizerMatchesFilter('IEEE Computer Society', 'Institute of Electrical and Electronics Engineers (IEEE)'), true);
});

test('organizer aliases do not collapse unrelated organizations', () => {
  assert.equal(organizerMatchesFilter('Society of Petroleum Engineers', 'IEEE'), false);
  assert.equal(organizerMatchesFilter('American Chemical Society', 'AAPG'), false);
  assert.equal(organizerMatchesFilter('Informa Markets', 'SPE'), false);
});
