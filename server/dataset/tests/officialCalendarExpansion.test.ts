import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadLaunchDataset, resetLaunchDatasetCache, searchLaunchDataset } from '../staticDataset';

test('official calendar additions survive database-free search with exact IMOG edition facts', () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cg-official-calendar-'));
  const previous=process.env.LAUNCH_DATASET_DIR;
  try {
    fs.copyFileSync(new URL('../../../data/official-calendar-expansion-20261030.json',import.meta.url),path.join(directory,'official-calendar-expansion-20261030.json'));
    process.env.LAUNCH_DATASET_DIR=directory;
    resetLaunchDatasetCache();
    const rows=loadLaunchDataset().records;
    assert.equal(rows.length,36);
    assert.equal(new Set(rows.map(r=>r.officialUrl+'|'+r.startDate+'|'+r.title)).size,36);
    assert.equal(rows.filter(r=>r.officialUrl?.replace(/\/$/,'')==='https://eageget.org' && r.startDate==='2026-11-02').length,5);
    for (const query of ['IMOG', 'IMOG 2027', 'organic geochemistry', 'organic geochemstry', 'Rotterdam 2027']) {
      const result=searchLaunchDataset(query).find(r=>r.link==='https://imogconference.org/');
      assert.ok(result,query);
      assert.equal(result.startDate,'2027-09-12');
      assert.equal(result.endDate,'2027-09-16');
      assert.equal(result.location?.country,'Netherlands');
    }
    assert.equal(searchLaunchDataset('IMOG 2028').length,0);
    const imog=rows.find(r=>r.officialUrl==='https://imogconference.org/')!;
    assert.equal(imog.details?.keynotes.items.length,0);
    assert.equal(imog.details?.fees.items.length,0);
  } finally {
    if(previous===undefined)delete process.env.LAUNCH_DATASET_DIR;else process.env.LAUNCH_DATASET_DIR=previous;
    resetLaunchDatasetCache();
    fs.rmSync(directory,{recursive:true,force:true});
  }
});
