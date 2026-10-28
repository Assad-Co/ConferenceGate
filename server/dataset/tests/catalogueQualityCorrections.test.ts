import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadLaunchDataset, resetLaunchDatasetCache } from '../staticDataset';

test('reviewed official links and dates preserve canonical IDs and remove URL-alias duplicates', () => {
  const previous = process.env.LAUNCH_DATASET_DIR;
  process.env.LAUNCH_DATASET_DIR = path.join(process.cwd(),'data');
  resetLaunchDatasetCache();
  try {
    const records = loadLaunchDataset().records;
    const byId = new Map(records.map(r=>[r.id,r]));
    for (const [id,start,end] of [
      ['un-climate-change-conference-cop31-2026-antalya','2026-11-09','2026-11-20'],
      ['prince-mahidol-award-conference-2027-bangkok','2027-01-26','2027-01-30'],
      ['un-climate-change-conference-cop32-2027-addis-ababa','2027-11-08','2027-11-19'],
    ]) {
      assert.equal(byId.get(id)?.startDate,start);
      assert.equal(byId.get(id)?.endDate,end);
      assert.equal(byId.get(id)?.datePrecision,'day');
    }
    assert.equal(records.filter(r=>!r.officialUrl).length,0);
    for (const [id,title] of [
      ['black-hat-asia-2027-singapore','Black Hat Asia 2027'],
      ['black-hat-usa-2027-las-vegas','Black Hat USA 2027'],
      ['rsa-2027-san-francisco','RSA Conference 2027'],
    ]) {
      assert.ok(byId.has(id),'original canonical ID must survive');
      assert.equal(records.filter(r=>r.title===title).length,1);
    }
    assert.equal(byId.get('melbourne-international-conference-on-teaching-education-learning-2027')?.organization,'The Teacher Forum');
    assert.equal(records.filter(r=>r.country?.includes(' / ')).length,74,'shared international event records must remain available');
  } finally {
    if (previous===undefined) delete process.env.LAUNCH_DATASET_DIR;
    else process.env.LAUNCH_DATASET_DIR=previous;
    resetLaunchDatasetCache();
  }
});
