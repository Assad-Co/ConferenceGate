import { createClient } from '@libsql/client';
import path from 'node:path';

const isTest = process.env.NODE_ENV === 'test';
const testDatabasePath = process.env.TEST_DATABASE_PATH?.trim();
const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN?.trim();

if (isTest && !testDatabasePath) throw new Error('NODE_ENV=test requires TEST_DATABASE_PATH for the cohort report.');
if (isTest && (tursoUrl || tursoAuthToken)) throw new Error('Refusing cohort tests with production Turso credentials.');

const db = isTest
  ? createClient({ url: `file:${path.resolve(testDatabasePath)}` })
  : tursoUrl
    ? createClient({ url: tursoUrl, authToken: tursoAuthToken })
    : createClient({ url: `file:${path.resolve('data/app.db')}` });

function n(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(num, den) {
  if (!den) return null;
  return Math.round((num / den) * 1000) / 10;
}

async function tableExists(name) {
  const result = await db.execute({
    sql: "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
    args: [name],
  });
  return Boolean(result.rows[0]);
}

async function rows(sql, args = []) {
  const result = await db.execute({ sql, args });
  return result.rows.map((row) => Object.fromEntries(Object.entries(row)));
}

try {
  const cohortRows = await rows(`
    SELECT substr(u.created_at,1,7) AS cohort_month,
           u.role AS role,
           COUNT(*) AS signups,
           SUM(CASE WHEN u.subscription_status IN ('active','trialing') THEN 1 ELSE 0 END) AS currently_paid,
           SUM(CASE
             WHEN u.role='organizer' AND EXISTS (
               SELECT 1 FROM created_conferences c WHERE c.organizer_id=u.id
             ) THEN 1
             WHEN u.role='sponsor' AND (
               EXISTS (SELECT 1 FROM sponsor_preferences p WHERE p.sponsor_id=u.id)
               OR EXISTS (SELECT 1 FROM sponsor_saved_opportunities s WHERE s.sponsor_id=u.id)
               OR EXISTS (SELECT 1 FROM sponsorship_need_inquiries i WHERE i.sponsor_id=u.id)
             ) THEN 1
             ELSE 0
           END) AS first_value_activated,
           SUM(CASE
             WHEN u.subscription_status IN ('active','trialing') AND u.role='organizer' AND EXISTS (
               SELECT 1 FROM created_conferences c WHERE c.organizer_id=u.id
             ) THEN 1
             WHEN u.subscription_status IN ('active','trialing') AND u.role='sponsor' AND (
               EXISTS (SELECT 1 FROM sponsor_preferences p WHERE p.sponsor_id=u.id)
               OR EXISTS (SELECT 1 FROM sponsor_saved_opportunities s WHERE s.sponsor_id=u.id)
               OR EXISTS (SELECT 1 FROM sponsorship_need_inquiries i WHERE i.sponsor_id=u.id)
             ) THEN 1
             ELSE 0
           END) AS paid_and_activated
      FROM users u
     WHERE u.role IN ('organizer','sponsor')
     GROUP BY substr(u.created_at,1,7),u.role
     ORDER BY cohort_month DESC,u.role ASC
  `);

  const cohorts = cohortRows.map((row) => {
    const signups = n(row.signups);
    const currentlyPaid = n(row.currently_paid);
    const firstValueActivated = n(row.first_value_activated);
    const paidAndActivated = n(row.paid_and_activated);
    return {
      cohortMonth: String(row.cohort_month),
      role: String(row.role),
      signups,
      currentlyPaid,
      firstValueActivated,
      paidAndActivated,
      currentPaidConversionPct: pct(currentlyPaid, signups),
      firstValueActivationPct: pct(firstValueActivated, signups),
      paidActivationPct: pct(paidAndActivated, currentlyPaid),
    };
  });

  const acquisitionAvailable = await tableExists('account_acquisition');
  let acquisition = [];
  let acquisitionCoverage = { paidRoleSignups: 0, attributedSignups: 0, coveragePct: null };

  const paidRoleSignupsResult = await rows(
    "SELECT COUNT(*) AS count FROM users WHERE role IN ('organizer','sponsor')"
  );
  const paidRoleSignups = n(paidRoleSignupsResult[0]?.count);

  if (acquisitionAvailable) {
    const sourceRows = await rows(`
      SELECT a.role AS role,
             a.source AS source,
             COALESCE(a.medium,'') AS medium,
             COALESCE(a.campaign,'') AS campaign,
             COUNT(*) AS signups,
             SUM(CASE WHEN u.subscription_status IN ('active','trialing') THEN 1 ELSE 0 END) AS currently_paid
        FROM account_acquisition a
        JOIN users u ON u.id=a.user_id
       GROUP BY a.role,a.source,COALESCE(a.medium,''),COALESCE(a.campaign,'')
       ORDER BY signups DESC,a.role,a.source
    `);
    acquisition = sourceRows.map((row) => {
      const signups = n(row.signups);
      const currentlyPaid = n(row.currently_paid);
      return {
        role: String(row.role),
        source: String(row.source),
        medium: String(row.medium || '') || null,
        campaign: String(row.campaign || '') || null,
        signups,
        currentlyPaid,
        currentPaidConversionPct: pct(currentlyPaid, signups),
      };
    });
    const attributedRows = await rows('SELECT COUNT(*) AS count FROM account_acquisition');
    const attributedSignups = n(attributedRows[0]?.count);
    acquisitionCoverage = {
      paidRoleSignups,
      attributedSignups,
      coveragePct: pct(attributedSignups, paidRoleSignups),
    };
  } else {
    acquisitionCoverage = { paidRoleSignups, attributedSignups: 0, coveragePct: pct(0, paidRoleSignups) };
  }

  const report = {
    report: 'conferencegate_growth_cohorts',
    generatedAt: new Date().toISOString(),
    definitions: {
      cohort: 'calendar month in which the Organizer or Sponsor account was created',
      currentPaidConversion: 'share of that signup cohort whose current subscription_status is active or trialing; this is not historical renewal retention',
      firstValueActivation: 'role-specific first operational value using the same definitions as the main growth report',
      acquisition: 'first explicit UTM/referral touch recorded by ConferenceGate; unattributed accounts remain unattributed rather than being guessed',
    },
    cohorts,
    acquisitionCoverage,
    acquisition,
  };

  console.log(JSON.stringify(report, null, process.argv.includes('--compact') ? 0 : 2));
} finally {
  db.close();
}
