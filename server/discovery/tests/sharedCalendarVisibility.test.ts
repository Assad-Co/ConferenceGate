import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { db, initDb } from '../../db';
import { initDiscoverySchema } from '../schema';
import { browseStoredConferences } from '../../braveSearch';
import { resetLaunchDatasetCache } from '../../dataset/staticDataset';

test('public stored browse retains Black Hat editions sharing the official calendar URL', async () => {
  assert.equal(process.env.NODE_ENV,'test');
  assert.ok(process.env.TEST_DATABASE_PATH,'Use an isolated test database.');
  const previous=process.env.LAUNCH_DATASET_DIR;
  process.env.LAUNCH_DATASET_DIR=path.join(process.cwd(),'data');
  resetLaunchDatasetCache();
  try {
    await initDb(); await initDiscoverySchema();
    const rows=await browseStoredConferences(1000);
    for(const title of ['Black Hat Middle East & Africa 2026','Black Hat Asia 2027','Black Hat USA 2027']) {
      const matches=rows.filter(r=>r.title===title);
      assert.equal(matches.length,1,title+' must survive browse exactly once');
      assert.equal(matches[0].linkIsConferencePage,false);
    }
  } finally {
    if(previous===undefined) delete process.env.LAUNCH_DATASET_DIR;
    else process.env.LAUNCH_DATASET_DIR=previous;
    resetLaunchDatasetCache(); db.close();
  }
});
