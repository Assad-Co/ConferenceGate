import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadLaunchDataset, resetLaunchDatasetCache } from '../staticDataset';

test('global expansion loads with official provenance and keeps unknown details empty', () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cg-expansion-'));
  const previous=process.env.LAUNCH_DATASET_DIR;
  try {
    fs.copyFileSync(new URL('../../../data/global-expansion-20261028.json',import.meta.url),path.join(directory,'global-expansion-20261028.json'));
    process.env.LAUNCH_DATASET_DIR=directory;
    resetLaunchDatasetCache();
    const records=loadLaunchDataset().records;
    assert.equal(records.length,8);
    assert.equal(new Set(records.map(row=>row.worldRegion)).size,7);
    assert.equal(new Set(records.map(row=>row.officialUrl+'|'+row.startDate)).size,8);
    for(const row of records) {
      assert.ok(row.officialUrl?.startsWith('https://'));
      assert.ok(row.startDate && row.endDate && row.startDate<=row.endDate);
      assert.equal(row.sourceType,'official_site');
      assert.ok(row.evidence.retrievedAt.startsWith('2026-10-28'));
      assert.equal(row.details?.keynotes.items.length,0);
      assert.equal(row.details?.committee.items.length,0);
      assert.equal(row.details?.fees.items.length,0);
    }
    const wind=records.find(row=>row.title.includes('LATAM'));
    assert.equal(wind?.details?.callForPapers,null);
    const ai=records.find(row=>row.title==='IJCAI 2027');
    assert.equal(ai?.details?.callForPapers?.abstractDeadline,'2027-01-04');
    assert.match(ai?.details?.callForPapers?.text || '',/Anywhere on Earth/);
    // A valid but stale rich JSON must not suppress records added to canonical CSV.
    fs.writeFileSync(path.join(directory,'conferencegate-worldwide-2026-2028.json'),JSON.stringify({records:[{...records[0],description:'Retain rich evidence'},
      {...records[0],id:'workshop-a',title:'Distinct Workshop A',sourceUrl:'https://society.example.invalid/',officialUrl:'https://society.example.invalid/'},
      {...records[0],id:'workshop-b',title:'Distinct Workshop B',sourceUrl:'https://society.example.invalid/',officialUrl:'https://society.example.invalid/'}]}));
    fs.writeFileSync(path.join(directory,'conferencegate-worldwide-2026-2028.csv'),
      'id,title,year,startDate,endDate,format,sourceUrl,officialUrl,sourceType,country\n'+
      'csv-recovery,CSV-only conference,2027,2027-09-01,2027-09-02,in-person,https://society.example.invalid/2027,https://society.example.invalid/2027,official_site,Japan\n'+
      `${records[0].id},Duplicate summary,2027,${records[0].startDate},${records[0].endDate},in-person,${records[0].sourceUrl},${records[0].officialUrl},official_site,United States\n`);
    resetLaunchDatasetCache();
    const recovered=loadLaunchDataset().records;
    assert.equal(recovered.length,11);
    assert.ok(recovered.some(row=>row.id==='workshop-a'));
    assert.ok(recovered.some(row=>row.id==='workshop-b'));
    assert.ok(recovered.some(row=>row.id==='csv-recovery'));
    assert.equal(recovered.filter(row=>row.id===records[0].id).length,1);
  } finally {
    if(previous === undefined) delete process.env.LAUNCH_DATASET_DIR; else process.env.LAUNCH_DATASET_DIR=previous;
    resetLaunchDatasetCache();
    for(const file of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory,file)); fs.rmdirSync(directory);
  }
});
