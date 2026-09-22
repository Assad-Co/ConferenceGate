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

  const subscriptionHistoryAvailable = await tableExists('subscription_status_history');
  let subscriptionHistory = {
    available: false,
    instrumentedSince: null,
    baselineObservedAccounts: 0,
    transitions30d: [],
    transitionCohorts: [],
  };

  if (subscriptionHistoryAvailable) {
    const metaAvailable = await tableExists('growth_schema_meta');
    const metaRows = metaAvailable
      ? await rows("SELECT value FROM growth_schema_meta WHERE key='subscription_history_started_at'")
      : [];
    const baselineRows = await rows(
      "SELECT COUNT(DISTINCT user_id) AS count FROM subscription_status_history WHERE reason='baseline_observed_state'"
    );
    const transitionRows = await rows(`
      SELECT role,
             SUM(CASE WHEN reason='status_change' AND to_status IN ('active','trialing') AND COALESCE(from_status,'required') NOT IN ('active','trialing') THEN 1 ELSE 0 END) AS activations,
             SUM(CASE WHEN reason='status_change' AND from_status IN ('canceled','past_due') AND to_status IN ('active','trialing') THEN 1 ELSE 0 END) AS reactivations,
             SUM(CASE WHEN reason='status_change' AND to_status='canceled' THEN 1 ELSE 0 END) AS cancellations,
             SUM(CASE WHEN reason='status_change' AND to_status='past_due' THEN 1 ELSE 0 END) AS past_due,
             SUM(CASE WHEN reason='period_end_changed' THEN 1 ELSE 0 END) AS period_end_changes
        FROM subscription_status_history
       WHERE changed_at >= datetime('now','-30 days')
         AND reason <> 'baseline_observed_state'
       GROUP BY role
       ORDER BY role
    `);
    const historyCohorts = await rows(`
      WITH history_by_user AS (
        SELECT user_id,
               MIN(CASE WHEN to_status IN ('active','trialing') THEN changed_at END) AS first_observed_paid_at,
               MIN(CASE WHEN reason <> 'baseline_observed_state' AND to_status IN ('active','trialing') THEN changed_at END) AS first_instrumented_paid_at,
               SUM(CASE WHEN reason='status_change' AND to_status='canceled' THEN 1 ELSE 0 END) AS cancellations,
               SUM(CASE WHEN reason='status_change' AND from_status IN ('canceled','past_due') AND to_status IN ('active','trialing') THEN 1 ELSE 0 END) AS reactivations,
               SUM(CASE WHEN reason='period_end_changed' THEN 1 ELSE 0 END) AS period_end_changes
          FROM subscription_status_history
         GROUP BY user_id
      )
      SELECT substr(u.created_at,1,7) AS cohort_month,
             u.role AS role,
             COUNT(*) AS signups,
             SUM(CASE WHEN h.first_observed_paid_at IS NOT NULL THEN 1 ELSE 0 END) AS ever_observed_paid,
             SUM(CASE WHEN h.first_instrumented_paid_at IS NOT NULL THEN 1 ELSE 0 END) AS instrumented_paid_transitions,
             COALESCE(SUM(h.cancellations),0) AS cancellations,
             COALESCE(SUM(h.reactivations),0) AS reactivations,
             COALESCE(SUM(h.period_end_changes),0) AS period_end_changes
        FROM users u
        LEFT JOIN history_by_user h ON h.user_id=u.id
       WHERE u.role IN ('organizer','sponsor')
       GROUP BY substr(u.created_at,1,7),u.role
       ORDER BY cohort_month DESC,u.role
    `);

    subscriptionHistory = {
      available: true,
      instrumentedSince: metaRows[0]?.value ? String(metaRows[0].value) : null,
      baselineObservedAccounts: n(baselineRows[0]?.count),
      transitions30d: transitionRows.map((row) => ({
        role: String(row.role),
        activations: n(row.activations),
        reactivations: n(row.reactivations),
        cancellations: n(row.cancellations),
        pastDue: n(row.past_due),
        periodEndChanges: n(row.period_end_changes),
      })),
      transitionCohorts: historyCohorts.map((row) => ({
        cohortMonth: String(row.cohort_month),
        role: String(row.role),
        signups: n(row.signups),
        everObservedPaid: n(row.ever_observed_paid),
        instrumentedPaidTransitions: n(row.instrumented_paid_transitions),
        cancellations: n(row.cancellations),
        reactivations: n(row.reactivations),
        periodEndChanges: n(row.period_end_changes),
      })),
    };
  }

  const report = {
    report: 'conferencegate_growth_cohorts',
    generatedAt: new Date().toISOString(),
    definitions: {
      cohort: 'calendar month in which the Organizer or Sponsor account was created',
      currentPaidConversion: 'share of that signup cohort whose current subscription_status is active or trialing',
      firstValueActivation: 'role-specific first operational value using the same definitions as the main growth report',
      acquisition: 'first explicit UTM/referral touch recorded by ConferenceGate; unattributed accounts remain unattributed rather than being guessed',
      subscriptionHistory: 'status transitions are clean only from instrumentedSince forward; baseline_observed_state records pre-existing state without pretending to know when it originally changed',
      periodEndChange: 'a paid subscription period-end change is a renewal/period-extension signal, not independent proof of a renewal charge',
    },
    cohorts,
    acquisitionCoverage,
    acquisition,
    subscriptionHistory,
  };

  console.log(JSON.stringify(report, null, process.argv.includes('--compact') ? 0 : 2));
} finally {
  db.close();
}
