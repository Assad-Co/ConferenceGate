import { createClient } from '@libsql/client';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

const LEASE_NAME = 'scheduled-global-refresh';
const TTL_MS = 10 * 60 * 1000;

export async function acquireCycleLease(db, owner, now = Date.now()) {
  await db.execute(`CREATE TABLE IF NOT EXISTS automation_cycle_leases
    (name TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL)`);
  const result = await db.execute({sql:`INSERT INTO automation_cycle_leases(name,owner,expires_at)
    VALUES (?,?,?) ON CONFLICT(name) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at
    WHERE automation_cycle_leases.expires_at<=? RETURNING owner`,args:[LEASE_NAME,owner,now+TTL_MS,now]});
  return result.rows.length === 1;
}
export async function renewCycleLease(db, owner, now = Date.now()) {
  const result = await db.execute({sql:`UPDATE automation_cycle_leases SET expires_at=?
    WHERE name=? AND owner=? AND expires_at>? RETURNING owner`,args:[now+TTL_MS,LEASE_NAME,owner,now]});
  return result.rows.length === 1;
}
export async function releaseCycleLease(db, owner) {
  await db.execute({sql:'DELETE FROM automation_cycle_leases WHERE name=? AND owner=?',args:[LEASE_NAME,owner]});
}

export async function withAutomationLease(work) {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
  if (url && !authToken) throw Error('Automation database credentials are incomplete.');
  const file = path.resolve(process.env.DATABASE_PATH?.trim() || 'data/app.db');
  if (!url) fs.mkdirSync(path.dirname(file), {recursive:true});
  const db = createClient(url ? {url,authToken} : {url:'file:'+file});
  const owner = crypto.randomUUID();
  const controller = new AbortController();
  let timer, renewing, acquired = false;
  const stop = () => controller.abort();
  try {
    acquired = await acquireCycleLease(db, owner);
    if (!acquired) { console.log('[automation] another scheduled refresh holds the durable lease; skipping overlap.'); return; }
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
    timer = setInterval(() => {
      if (renewing) return;
      renewing = renewCycleLease(db,owner).then(ok => {
        if (!ok) controller.abort();
      }).catch(() => controller.abort()).finally(() => { renewing = undefined; });
    }, 30000);
    await work(controller.signal);
    if (controller.signal.aborted) throw Error('Automation stopped after shutdown or lost database lease.');
  } finally {
    clearInterval(timer);
    process.removeListener('SIGTERM',stop); process.removeListener('SIGINT',stop);
    await renewing;
    try { if (acquired) await releaseCycleLease(db,owner); }
    finally { db.close(); }
  }
}
