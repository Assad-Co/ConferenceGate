import { createClient } from '@libsql/client';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const sourceUrl = process.env.TURSO_DATABASE_URL?.trim();
const sourceToken = process.env.TURSO_AUTH_TOKEN?.trim();
const destinationPath = path.resolve(
  process.env.DATABASE_PATH?.trim() || path.join(process.cwd(), 'data', 'app.db')
);

const DEFAULT_OWNER_PREVIEW_EMAIL_SHA256 =
  '316878b65df874d3ddf107b17a1af0849e4362c8383c02c10c814efd45fe591e';
const ownerHash =
  process.env.OWNER_PREVIEW_EMAIL_SHA256?.trim().toLowerCase() ||
  DEFAULT_OWNER_PREVIEW_EMAIL_SHA256;

if (!sourceUrl) {
  console.log(JSON.stringify({
    legacyProductionReconcile: 'skipped',
    reason: 'TURSO_DATABASE_URL is not configured',
  }));
  process.exit(0);
}

fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
const source = createClient({ url: sourceUrl, authToken: sourceToken || undefined });
const destination = createClient({ url: 'file:' + destinationPath });

const quoteIdent = (name) => '"' + String(name).replaceAll('"', '""') + '"';
const normalize = (value) => String(value ?? '').trim().toLowerCase();
const emailHash = (value) =>
  crypto.createHash('sha256').update(normalize(value)).digest('hex');

function jsonSafeObject(row) {
  const out = {};
  for (const [key, value] of Object.entries(row || {})) {
    out[key] = typeof value === 'bigint' ? Number(value) : value;
  }
  return out;
}

async function tableExists(client, table) {
  const result = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
    args: [table],
  });
  return result.rows.length > 0;
}

async function columns(client, table) {
  if (!(await tableExists(client, table))) return [];
  const result = await client.execute(`PRAGMA table_info(${quoteIdent(table)})`);
  return result.rows.map((row) => String(row.name));
}

async function ensureStaging() {
  await destination.executeMultiple(`
    CREATE TABLE IF NOT EXISTS legacy_professional_recovery (
      source_user_id TEXT PRIMARY KEY,
      match_score INTEGER NOT NULL,
      user_json TEXT NOT NULL,
      linkedin_json TEXT,
      captured_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS legacy_professional_activity (
      source_user_id TEXT NOT NULL,
      table_name TEXT NOT NULL,
      row_key TEXT NOT NULL,
      row_json TEXT NOT NULL,
      captured_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(source_user_id, table_name, row_key)
    );
  `);
}

async function currentOwner() {
  if (!(await tableExists(destination, 'users'))) return null;
  const result = await destination.execute(
    "SELECT * FROM users ORDER BY created_at ASC"
  );
  return result.rows.find((row) => emailHash(row.email) === ownerHash) || null;
}

function matchScore(current, candidate) {
  let score = 0;
  if (normalize(current.email) && normalize(current.email) === normalize(candidate.email)) score += 120;
  if (
    normalize(current.linkedin_id) &&
    normalize(current.linkedin_id) === normalize(candidate.linkedin_id)
  ) score += 100;
  if (
    normalize(current.linkedin_url) &&
    normalize(current.linkedin_url) === normalize(candidate.linkedin_url)
  ) score += 90;
  if (normalize(current.name) && normalize(current.name) === normalize(candidate.name)) score += 60;
  return score;
}

async function materializeRecoveryShadow(sourceUser, sourceLinkedIn) {
  if (!(await tableExists(destination, 'users'))) return null;

  const sourceUserId = String(sourceUser.id);
  const shadowSuffix = crypto.createHash('sha256').update(sourceUserId).digest('hex').slice(0, 16);
  const shadowId = `legacy_recovery_${shadowSuffix}`;
  const shadowEmail = `legacy-recovery-${shadowSuffix}@conferencegate.invalid`;

  const sourceUserCols = await columns(source, 'users');
  const destinationUserCols = new Set(await columns(destination, 'users'));
  const commonUserCols = sourceUserCols.filter((column) => destinationUserCols.has(column));

  const userValues = commonUserCols.map((column) => {
    if (column === 'id') return shadowId;
    if (column === 'email') return shadowEmail;
    if (column === 'role') return 'professional';
    if (column === 'google_id' || column === 'linkedin_id') return null;
    if (column === 'subscription_status') return 'free';
    if (column === 'subscription_plan' || column === 'subscription_provider' || column === 'subscription_period_end') return null;
    return sourceUser[column] ?? null;
  });

  await destination.execute({
    sql: `INSERT OR IGNORE INTO users (${commonUserCols.map(quoteIdent).join(',')})
          VALUES (${commonUserCols.map(() => '?').join(',')})`,
    args: userValues,
  });

  if (sourceLinkedIn && await tableExists(destination, 'linkedin_profile_enrichment')) {
    const sourceCols = await columns(source, 'linkedin_profile_enrichment');
    const destinationCols = new Set(await columns(destination, 'linkedin_profile_enrichment'));
    const common = sourceCols.filter((column) => destinationCols.has(column));
    const values = common.map((column) => column === 'user_id' ? shadowId : sourceLinkedIn[column] ?? null);
    await destination.execute({
      sql: `INSERT OR REPLACE INTO linkedin_profile_enrichment (${common.map(quoteIdent).join(',')})
            VALUES (${common.map(() => '?').join(',')})`,
      args: values,
    });
  }

  const activitySpecs = [
    ['external_paper_matches', 'user_id'],
    ['self_reported_attendance', 'user_id'],
    ['self_reported_committee_positions', 'user_id'],
    ['conference_registrations', 'user_id'],
    ['review_volunteers', 'reviewer_id'],
  ];

  await destination.execute('PRAGMA foreign_keys=OFF');
  try {
    for (const [table, key] of activitySpecs) {
      if (!(await tableExists(source, table)) || !(await tableExists(destination, table))) continue;
      const sourceCols = await columns(source, table);
      const destinationCols = new Set(await columns(destination, table));
      const common = sourceCols.filter((column) => destinationCols.has(column));
      if (!common.includes(key)) continue;

      const rows = await source.execute({
        sql: `SELECT * FROM ${quoteIdent(table)} WHERE ${quoteIdent(key)}=?`,
        args: [sourceUserId],
      });

      for (const row of rows.rows) {
        const payloadHash = crypto.createHash('sha256')
          .update(JSON.stringify(jsonSafeObject(row)))
          .digest('hex')
          .slice(0, 18);
        const values = common.map((column) => {
          if (column === key) return shadowId;
          if (column === 'id') return `legacy_recovery_${payloadHash}`;
          return row[column] ?? null;
        });
        await destination.execute({
          sql: `INSERT OR IGNORE INTO ${quoteIdent(table)} (${common.map(quoteIdent).join(',')})
                VALUES (${common.map(() => '?').join(',')})`,
          args: values,
        });
      }
    }
  } finally {
    await destination.execute('PRAGMA foreign_keys=ON');
  }

  return shadowId;
}

async function stageProfessional(current) {
  if (!(await tableExists(source, 'users'))) {
    return { candidates: 0, staged: 0, reason: 'legacy users table missing' };
  }

  const legacyUsers = await source.execute(
    "SELECT * FROM users WHERE role='professional' ORDER BY created_at ASC"
  );
  const scored = legacyUsers.rows
    .map((row) => ({ row, score: matchScore(current, row) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return { candidates: 0, staged: 0 };

  const bestScore = scored[0].score;
  const best = scored.filter((item) => item.score === bestScore);

  let staged = 0;
  for (const item of best) {
    const legacy = jsonSafeObject(item.row);
    let linkedin = null;
    if (await tableExists(source, 'linkedin_profile_enrichment')) {
      const result = await source.execute({
        sql: "SELECT * FROM linkedin_profile_enrichment WHERE user_id=? LIMIT 1",
        args: [String(item.row.id)],
      });
      if (result.rows[0]) linkedin = jsonSafeObject(result.rows[0]);
    }

    const shadowId = await materializeRecoveryShadow(item.row, linkedin);

    await destination.execute({
      sql: `INSERT INTO legacy_professional_recovery(
              source_user_id,match_score,user_json,linkedin_json,captured_at
            ) VALUES(?,?,?,?,datetime('now'))
            ON CONFLICT(source_user_id) DO UPDATE SET
              match_score=excluded.match_score,
              user_json=excluded.user_json,
              linkedin_json=excluded.linkedin_json,
              captured_at=datetime('now')`,
      args: [
        String(item.row.id),
        item.score,
        JSON.stringify(legacy),
        linkedin ? JSON.stringify(linkedin) : null,
      ],
    });

    const activitySpecs = [
      ['external_paper_matches', 'user_id'],
      ['self_reported_attendance', 'user_id'],
      ['self_reported_committee_positions', 'user_id'],
      ['conference_registrations', 'user_id'],
      ['professional_opportunity_interests', 'professional_id'],
      ['professional_invitations', 'professional_id'],
      ['review_volunteers', 'reviewer_id'],
      ['submission_reviews', 'reviewer_id'],
      ['submission_reviewer_assignments', 'reviewer_id'],
    ];

    for (const [table, key] of activitySpecs) {
      if (!(await tableExists(source, table))) continue;
      const rows = await source.execute({
        sql: `SELECT * FROM ${quoteIdent(table)} WHERE ${quoteIdent(key)}=?`,
        args: [String(item.row.id)],
      });
      for (const rawRow of rows.rows) {
        const row = jsonSafeObject(rawRow);
        const payload = JSON.stringify(row);
        const rowKey = String(
          row.id ||
          row.doi ||
          row.conference_id ||
          crypto.createHash('sha256').update(payload).digest('hex')
        );
        await destination.execute({
          sql: `INSERT INTO legacy_professional_activity(
                  source_user_id,table_name,row_key,row_json,captured_at
                ) VALUES(?,?,?,?,datetime('now'))
                ON CONFLICT(source_user_id,table_name,row_key) DO UPDATE SET
                  row_json=excluded.row_json,
                  captured_at=datetime('now')`,
          args: [String(item.row.id), table, rowKey, payload],
        });
      }
    }
    staged += 1;
    if (shadowId) {
      console.log(`[legacy-reconcile] Professional recovery shadow ready: ${shadowId}`);
    }
  }

  return { candidates: scored.length, bestScore, staged };
}

async function mergeConferenceTable(table) {
  if (!(await tableExists(source, table))) return { table, available: false, copied: 0 };
  const sourceSchema = await source.execute({
    sql: "SELECT sql FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
    args: [table],
  });
  const createSql = sourceSchema.rows[0]?.sql ? String(sourceSchema.rows[0].sql) : '';
  if (createSql && !(await tableExists(destination, table))) {
    await destination.execute(createSql.replace(/^CREATE TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS '));
  }
  if (!(await tableExists(destination, table))) return { table, available: true, copied: 0 };

  const sourceCols = await columns(source, table);
  const destinationCols = new Set(await columns(destination, table));
  const common = sourceCols.filter((column) => destinationCols.has(column));
  if (!common.length) return { table, available: true, copied: 0 };

  let offset = 0;
  let copied = 0;
  const pageSize = 250;
  while (true) {
    const result = await source.execute(
      `SELECT * FROM ${quoteIdent(table)} LIMIT ${pageSize} OFFSET ${offset}`
    );
    if (!result.rows.length) break;

    const columnSql = common.map(quoteIdent).join(',');
    const placeholders = common.map(() => '?').join(',');
    const sql = `INSERT OR IGNORE INTO ${quoteIdent(table)} (${columnSql}) VALUES (${placeholders})`;

    for (const row of result.rows) {
      const args = common.map((column) => row[column] ?? null);
      const inserted = await destination.execute({ sql, args });
      copied += Number(inserted.rowsAffected || 0);
    }
    offset += result.rows.length;
    if (result.rows.length < pageSize) break;
  }

  return { table, available: true, copied };
}

async function mergeConferenceCatalog() {
  const tables = await source.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'discovery_%' OR name='extracted_conferences') ORDER BY name"
  );
  const results = [];
  await destination.execute('PRAGMA foreign_keys=OFF');
  try {
    for (const row of tables.rows) {
      results.push(await mergeConferenceTable(String(row.name)));
    }
  } finally {
    await destination.execute('PRAGMA foreign_keys=ON');
  }
  return results;
}

try {
  await ensureStaging();
  const owner = await currentOwner();
  const professional = owner
    ? await stageProfessional(owner)
    : { candidates: 0, staged: 0, reason: 'owner preview account not found in SQLite' };
  const conferenceTables = await mergeConferenceCatalog();

  console.log(JSON.stringify({
    legacyProductionReconcile: 'complete',
    destination: destinationPath,
    professional,
    conferenceTables,
    conferenceRowsCopied: conferenceTables.reduce((sum, row) => sum + Number(row.copied || 0), 0),
  }));
} catch (error) {
  console.warn(JSON.stringify({
    legacyProductionReconcile: 'failed',
    error: String(error?.message || error),
  }));
  process.exitCode = 0;
} finally {
  source.close();
  destination.close();
}
