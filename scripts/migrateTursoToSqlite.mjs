import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

const sourceUrl = process.env.TURSO_DATABASE_URL?.trim();
const sourceToken = process.env.TURSO_AUTH_TOKEN?.trim();
const destinationPath = path.resolve(
  process.env.DATABASE_PATH?.trim() || path.join(process.cwd(), 'data', 'app.db')
);
const allowMerge = process.env.MIGRATION_MERGE === '1';

if (!sourceUrl) {
  throw new Error('TURSO_DATABASE_URL is required only for this one-time recovery command.');
}

fs.mkdirSync(path.dirname(destinationPath), { recursive: true });

const source = createClient({ url: sourceUrl, authToken: sourceToken || undefined });
const destination = createClient({ url: 'file:' + destinationPath });

function quoteIdent(name) {
  return '"' + String(name).replaceAll('"', '""') + '"';
}

try {
  const existingUsers = await destination.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users' LIMIT 1"
  );
  if (existingUsers.rows.length && !allowMerge) {
    const count = await destination.execute('SELECT COUNT(*) AS n FROM users');
    if (Number(count.rows[0]?.n || 0) > 0) {
      throw new Error(
        'Destination already contains users. Refusing to merge by default. ' +
        'Run recovery before creating new accounts, or set MIGRATION_MERGE=1 after reviewing ID conflicts.'
      );
    }
  }

  const tablesResult = await source.execute(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  const tables = tablesResult.rows
    .map((row) => ({ name: String(row.name), sql: row.sql ? String(row.sql) : '' }))
    .filter((row) => row.name && row.sql);

  await destination.execute('PRAGMA foreign_keys=OFF');

  let totalRows = 0;
  const tableResults = [];

  for (const table of tables) {
    const createSql = table.sql.replace(/^CREATE TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ');
    await destination.execute(createSql);

    const columnsResult = await source.execute(`PRAGMA table_info(${quoteIdent(table.name)})`);
    const columns = columnsResult.rows.map((row) => String(row.name));
    if (!columns.length) continue;

    let offset = 0;
    let copied = 0;
    const pageSize = 250;

    while (true) {
      const rows = await source.execute(
        `SELECT * FROM ${quoteIdent(table.name)} LIMIT ${pageSize} OFFSET ${offset}`
      );
      if (!rows.rows.length) break;

      const columnSql = columns.map(quoteIdent).join(',');
      const placeholders = columns.map(() => '?').join(',');
      const insertVerb = allowMerge ? 'INSERT OR IGNORE' : 'INSERT';
      const sql = `${insertVerb} INTO ${quoteIdent(table.name)} (${columnSql}) VALUES (${placeholders})`;

      for (const row of rows.rows) {
        const args = columns.map((column) => row[column] ?? null);
        await destination.execute({ sql, args });
      }

      copied += rows.rows.length;
      offset += rows.rows.length;
      if (rows.rows.length < pageSize) break;
    }

    totalRows += copied;
    tableResults.push({ table: table.name, rows: copied });
    console.log(`[turso-recovery] ${table.name}: ${copied} rows`);
  }

  await destination.execute('PRAGMA foreign_keys=ON');

  console.log(JSON.stringify({
    tursoRecovery: 'complete',
    destination: destinationPath,
    tables: tableResults.length,
    rows: totalRows,
    tableResults,
  }, null, 2));
} finally {
  source.close();
  destination.close();
}
