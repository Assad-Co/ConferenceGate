// Read-only production integrity and recovery readiness checks. Never exports user data.
import { createClient } from '@libsql/client';
const url = process.env.TURSO_DATABASE_URL?.trim();
const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
if (!url || !authToken) {
  console.error('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required.');
  process.exit(2);
}
const db = createClient({ url, authToken });
try {
  const integrity = await db.execute('PRAGMA integrity_check');
  const result = String(integrity.rows[0]?.integrity_check ?? '');
  if (result !== 'ok') throw Error('Database integrity check did not return ok');
  const tables = await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
  const names = new Set(tables.rows.map(row => String(row.name)));
  for (const name of ['users', 'billing_provider_events']) {
    if (!names.has(name)) throw Error('Required database table missing: ' + name);
  }
  const foreignKeys = await db.execute('PRAGMA foreign_key_check');
  if (foreignKeys.rows.length) throw Error('Foreign key violations: ' + foreignKeys.rows.length);
  console.log(JSON.stringify({ integrity: 'ok', foreignKeys: 'ok', tables: names.size, backupRestoredAndTested: false }));
} catch (error) {
  console.error('Turso verification failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  db.close();
}
