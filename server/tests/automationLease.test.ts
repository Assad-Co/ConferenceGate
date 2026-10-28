import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { db, dbGet, initDb } from '../db';
import { acquireCycleLease, renewCycleLease, releaseCycleLease } from '../../scripts/automationLease.mjs';

test('the entire scheduled refresh has one owner, safe renewal, expiry and owner-bound release', async () => {
  assert.equal(process.env.NODE_ENV,'test');
  assert.ok(process.env.TEST_DATABASE_PATH,'Use the isolated test runner.');
  await initDb();
  try {
    const claimed = await Promise.all([acquireCycleLease(db,'worker-a',1000),acquireCycleLease(db,'worker-b',1000)]);
    assert.equal(claimed.filter(Boolean).length,1);
    const owner = claimed[0] ? 'worker-a' : 'worker-b';
    const other = claimed[0] ? 'worker-b' : 'worker-a';
    assert.equal(await renewCycleLease(db,other,2000),false);
    await releaseCycleLease(db,other);
    assert.equal(await acquireCycleLease(db,other,2000),false);
    assert.equal(await renewCycleLease(db,owner,3000),true);
    assert.equal(await acquireCycleLease(db,other,602000),false,'renewal extends exclusivity');
    assert.equal(await acquireCycleLease(db,other,603001),true,'a crashed worker cannot hold the lease forever');
    assert.equal(await renewCycleLease(db,owner,603002),false,'the old worker must stop after takeover');
    await releaseCycleLease(db,owner);
    assert.equal((await dbGet<any>('SELECT owner FROM automation_cycle_leases')).owner,other);
    await releaseCycleLease(db,other);
    assert.equal(await acquireCycleLease(db,'next-cycle',603003),true);
    await releaseCycleLease(db,'next-cycle');
    assert.equal(await acquireCycleLease(db,'entry-blocker'),true);
    const child = spawnSync(process.execPath,['scripts/automationEntry.mjs'],{
      env:{...process.env,AUTOMATION_DISABLED:'0',TURSO_DATABASE_URL:'',TURSO_AUTH_TOKEN:'',
        DATABASE_PATH:process.env.TEST_DATABASE_PATH},encoding:'utf8',timeout:10000,windowsHide:true,
    });
    assert.equal(child.status,0,child.stderr);
    assert.match(child.stdout,/skipping overlap/);
    assert.doesNotMatch(child.stdout,/rolling conference horizon/,'no refresh child should start');
    await releaseCycleLease(db,'entry-blocker');
  } finally { db.close(); }
});

