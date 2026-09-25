import { createClient } from '@libsql/client';
import path from 'node:path';

const sourceUrl = process.env.TURSO_DATABASE_URL?.trim();
const sourceToken = process.env.TURSO_AUTH_TOKEN?.trim();
const destinationPath = path.resolve(
  process.env.DATABASE_PATH?.trim() || path.join(process.cwd(), 'data', 'app.db')
);
const accountEmail = process.env.LEGACY_PROFILE_EMAIL?.trim().toLowerCase();
const apply = process.env.LEGACY_PROFILE_APPLY === '1';

if (!sourceUrl) throw new Error('TURSO_DATABASE_URL is required.');
if (!accountEmail) throw new Error('LEGACY_PROFILE_EMAIL is required.');

const source = createClient({ url: sourceUrl, authToken: sourceToken || undefined });
const destination = createClient({ url: 'file:' + destinationPath });

function quoteIdent(name) {
  return '"' + String(name).replaceAll('"', '""') + '"';
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

async function rowByEmail(client, email) {
  const result = await client.execute({
    sql: 'SELECT * FROM users WHERE lower(email)=? LIMIT 1',
    args: [email],
  });
  return result.rows[0] || null;
}

function nonEmpty(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '' && value.trim() !== '[]' && value.trim() !== '{}';
  return true;
}

const PROFILE_FIELDS = [
  'name',
  'organization',
  'title',
  'avatar',
  'department',
  'city',
  'country',
  'bio',
  'linkedin_url',
  'linkedin_id',
  'professional_expertise',
  'technical_specialization',
  'research_interests',
  'preferred_regions',
  'reviewer_available',
  'committee_available',
  'session_chair_available',
  'speaker_available',
  'reviewer_max_load',
];

const COPY_TABLES = [
  { table: 'linkedin_profile_enrichment', key: 'user_id', unique: ['user_id'] },
  { table: 'external_paper_matches', key: 'user_id', unique: ['user_id', 'doi'] },
  { table: 'self_reported_attendance', key: 'user_id', unique: ['id'] },
  { table: 'self_reported_committee_positions', key: 'user_id', unique: ['id'] },
  { table: 'conference_registrations', key: 'user_id', unique: ['user_id', 'conference_id'] },
  { table: 'professional_opportunity_interests', key: 'professional_id', unique: ['opportunity_id', 'professional_id'] },
  { table: 'professional_invitations', key: 'professional_id', unique: ['id'] },
  { table: 'review_volunteers', key: 'reviewer_id', unique: ['id'] },
  { table: 'submission_reviews', key: 'reviewer_id', unique: ['id'] },
  { table: 'submission_reviewer_assignments', key: 'reviewer_id', unique: ['id'] },
];

async function matchingDestinationRow(table, uniqueCols, row, oldUserId, newUserId, keyColumn) {
  if (!uniqueCols.length) return null;
  const values = uniqueCols.map((column) => {
    if (column === keyColumn) return newUserId;
    return row[column] ?? null;
  });
  const where = uniqueCols.map((column) => `${quoteIdent(column)} IS ?`).join(' AND ');
  const result = await destination.execute({
    sql: `SELECT 1 AS present FROM ${quoteIdent(table)} WHERE ${where} LIMIT 1`,
    args: values,
  });
  return result.rows[0] || null;
}

async function copyRows(tableSpec, oldUserId, newUserId) {
  const { table, key, unique } = tableSpec;
  if (!(await tableExists(source, table)) || !(await tableExists(destination, table))) {
    return { table, available: false, found: 0, copied: 0, skipped: 0 };
  }

  const sourceColumns = await columns(source, table);
  const destinationColumns = new Set(await columns(destination, table));
  const common = sourceColumns.filter((column) => destinationColumns.has(column));
  if (!common.includes(key)) {
    return { table, available: true, found: 0, copied: 0, skipped: 0, warning: `missing key column ${key}` };
  }

  const result = await source.execute({
    sql: `SELECT * FROM ${quoteIdent(table)} WHERE ${quoteIdent(key)}=?`,
    args: [oldUserId],
  });

  let copied = 0;
  let skipped = 0;

  for (const sourceRow of result.rows) {
    if (await matchingDestinationRow(table, unique, sourceRow, oldUserId, newUserId, key)) {
      skipped += 1;
      continue;
    }
    if (!apply) {
      copied += 1;
      continue;
    }

    const values = common.map((column) => (column === key ? newUserId : sourceRow[column] ?? null));
    const sql = `INSERT OR IGNORE INTO ${quoteIdent(table)} (${common.map(quoteIdent).join(',')})
                 VALUES (${common.map(() => '?').join(',')})`;
    const inserted = await destination.execute({ sql, args: values });
    if (Number(inserted.rowsAffected || 0) > 0) copied += 1;
    else skipped += 1;
  }

  return { table, available: true, found: result.rows.length, copied, skipped };
}

try {
  const legacy = await rowByEmail(source, accountEmail);
  const current = await rowByEmail(destination, accountEmail);

  if (!legacy) throw new Error('No legacy Turso user found for the requested email.');
  if (!current) throw new Error('No current SQLite user found for the requested email.');

  const sourceUserColumns = new Set(await columns(source, 'users'));
  const destUserColumns = new Set(await columns(destination, 'users'));

  const changes = [];
  for (const field of PROFILE_FIELDS) {
    if (!sourceUserColumns.has(field) || !destUserColumns.has(field)) continue;
    const legacyValue = legacy[field] ?? null;
    const currentValue = current[field] ?? null;

    // Old Professional presentation/profile values are authoritative when present. Authentication,
    // billing, workspace ownership and the current primary role are deliberately excluded.
    if (nonEmpty(legacyValue) && String(legacyValue) !== String(currentValue ?? '')) {
      changes.push({
        field,
        current: field === 'avatar' && currentValue ? '[present]' : currentValue,
        legacy: field === 'avatar' && legacyValue ? '[present]' : legacyValue,
      });
    }
  }

  if (apply && changes.length) {
    const set = changes.map(({ field }) => `${quoteIdent(field)}=?`).join(',');
    const args = changes.map(({ field }) => legacy[field] ?? null);
    args.push(String(current.id));
    await destination.execute({
      sql: `UPDATE users SET ${set} WHERE id=?`,
      args,
    });
  }

  const tableResults = [];
  for (const tableSpec of COPY_TABLES) {
    tableResults.push(await copyRows(tableSpec, String(legacy.id), String(current.id)));
  }

  console.log(JSON.stringify({
    legacyProfessionalRecovery: apply ? 'applied' : 'dry_run',
    email: accountEmail,
    legacyUserId: String(legacy.id),
    currentUserId: String(current.id),
    legacyRole: legacy.role,
    currentPrimaryRolePreserved: current.role,
    userProfileFieldsToRestore: changes,
    relatedProfileActivity: tableResults,
    preservedByDesign: [
      'password_hash',
      'google_id',
      'role',
      'subscription_status',
      'subscription_plan',
      'subscription_provider',
      'subscription_period_end',
      'current SQLite workspace and billing records',
    ],
    nextStep: apply
      ? 'Restart/redeploy the app and verify the Professional profile.'
      : 'Review this output, then rerun with LEGACY_PROFILE_APPLY=1 to apply the recovery.',
  }, null, 2));
} finally {
  source.close();
  destination.close();
}
