import { execFileSync } from 'node:child_process';
import { createClient } from '@libsql/client';
import path from 'node:path';

const isTest = process.env.NODE_ENV === 'test';
const testDatabasePath = process.env.TEST_DATABASE_PATH?.trim();
const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN?.trim();

if (isTest && !testDatabasePath) throw new Error('NODE_ENV=test requires TEST_DATABASE_PATH for the executive snapshot.');
if (isTest && (tursoUrl || tursoAuthToken)) throw new Error('Refusing executive snapshot tests with production Turso credentials.');

function runJsonScript(script) {
  const output = execFileSync(process.execPath, [script, '--compact'], {
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(output);
}

const growth = runJsonScript('scripts/growthReport.mjs');
const cohorts = runJsonScript('scripts/growthCohortReport.mjs');

const db = isTest
  ? createClient({ url: `file:${path.resolve(testDatabasePath)}` })
  : tursoUrl
    ? createClient({ url: tursoUrl, authToken: tursoAuthToken })
    : createClient({ url: `file:${path.resolve('data/app.db')}` });

function n(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function changePct(current, previous) {
  if (!previous) return current ? null : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

async function scalar(sql, args = []) {
  const result = await db.execute({ sql, args });
  return n(result.rows[0]?.value);
}

async function grouped(sql, args = []) {
  const result = await db.execute({ sql, args });
  return result.rows.map((row) => Object.fromEntries(Object.entries(row)));
}

async function windowCount(table, timestampColumn, whereSql = '1=1', args = []) {
  const windows = {};
  for (const [label, start, end] of [
    ['current7d', '-7 days', null],
    ['previous7d', '-14 days', '-7 days'],
    ['current30d', '-30 days', null],
    ['previous30d', '-60 days', '-30 days'],
  ]) {
    const endClause = end ? ` AND ${timestampColumn} < datetime('now','${end}')` : '';
    windows[label] = await scalar(
      `SELECT COUNT(*) AS value FROM ${table}
        WHERE ${whereSql}
          AND ${timestampColumn} >= datetime('now','${start}')${endClause}`,
      args
    );
  }
  return {
    ...windows,
    change7dPct: changePct(windows.current7d, windows.previous7d),
    change30dPct: changePct(windows.current30d, windows.previous30d),
  };
}

async function roleSignupMovement(role) {
  return windowCount('users', 'created_at', 'role=?', [role]);
}

async function checkoutMovement(role) {
  const values = {};
  for (const [label, start, end] of [
    ['current7d', '-7 days', null],
    ['previous7d', '-14 days', '-7 days'],
    ['current30d', '-30 days', null],
    ['previous30d', '-60 days', '-30 days'],
  ]) {
    const endClause = end ? ` AND e.created_at < datetime('now','${end}')` : '';
    values[label] = await scalar(
      `SELECT COUNT(DISTINCT e.subject_id) AS value
         FROM billing_provider_events e
         JOIN users u ON u.id=e.subject_id
        WHERE e.event_type='subscription.checkout.started'
          AND u.role=?
          AND e.created_at >= datetime('now','${start}')${endClause}`,
      [role]
    );
  }
  return {
    ...values,
    change7dPct: changePct(values.current7d, values.previous7d),
    change30dPct: changePct(values.current30d, values.previous30d),
  };
}

async function revenueMovement() {
  const rows = await grouped(`
    SELECT UPPER(currency) AS currency,
           SUM(CASE WHEN settled_at >= datetime('now','-7 days') THEN COALESCE(amount,0) ELSE 0 END) AS current_7d,
           SUM(CASE WHEN settled_at >= datetime('now','-14 days') AND settled_at < datetime('now','-7 days') THEN COALESCE(amount,0) ELSE 0 END) AS previous_7d,
           SUM(CASE WHEN settled_at >= datetime('now','-30 days') THEN COALESCE(amount,0) ELSE 0 END) AS current_30d,
           SUM(CASE WHEN settled_at >= datetime('now','-60 days') AND settled_at < datetime('now','-30 days') THEN COALESCE(amount,0) ELSE 0 END) AS previous_30d
      FROM sponsorship_payments
     WHERE status='settled'
     GROUP BY UPPER(currency)
     ORDER BY UPPER(currency)
  `);
  return rows.map((row) => {
    const current7d = n(row.current_7d);
    const previous7d = n(row.previous_7d);
    const current30d = n(row.current_30d);
    const previous30d = n(row.previous_30d);
    return {
      currency: String(row.currency || 'USD'),
      current7d,
      previous7d,
      change7dPct: changePct(current7d, previous7d),
      current30d,
      previous30d,
      change30dPct: changePct(current30d, previous30d),
    };
  });
}

try {
  const [organizerSignups, sponsorSignups, organizerCheckout, sponsorCheckout, inquiries, deals, payments, revenue] = await Promise.all([
    roleSignupMovement('organizer'),
    roleSignupMovement('sponsor'),
    checkoutMovement('organizer'),
    checkoutMovement('sponsor'),
    windowCount('sponsorship_need_inquiries', 'created_at'),
    windowCount('sponsorship_deals', 'created_at'),
    windowCount('sponsorship_payments', 'settled_at', "status='settled'"),
    revenueMovement(),
  ]);

  const topAcquisition = cohorts.acquisition
    .slice()
    .sort((a, b) => b.signups - a.signups || b.currentlyPaid - a.currentlyPaid)
    .slice(0, 10);

  const snapshot = {
    report: 'conferencegate_executive_growth_snapshot',
    generatedAt: new Date().toISOString(),
    definitions: {
      movement: 'current 7/30-day event counts compared with the immediately preceding non-overlapping 7/30-day windows',
      revenue: 'provider-confirmed sponsorship payments that remain settled, kept separate by currency',
      acquisition: 'explicit first-touch UTM/referral attribution only; missing attribution is never guessed',
      cohortConversion: 'current paid status by signup cohort, not historical renewal retention',
    },
    currentState: {
      organizer: {
        signups: growth.organizer.signups,
        paidSubscriptions: growth.organizer.paidSubscriptions,
        paidAndActivated: growth.organizer.paidAndActivated,
        activePaidWorkspace30dPct: growth.retention.organizer.active30dPct,
      },
      sponsor: {
        signups: growth.sponsor.signups,
        paidSubscriptions: growth.sponsor.paidSubscriptions,
        paidAndActivated: growth.sponsor.paidAndActivated,
        activePaidWorkspace30dPct: growth.retention.sponsor.active30dPct,
      },
      acquisitionCoverage: cohorts.acquisitionCoverage,
    },
    movement: {
      organizerSignups,
      sponsorSignups,
      organizerCheckout,
      sponsorCheckout,
      sponsorshipInquiries: inquiries,
      dealRoomsCreated: deals,
      settledPayments: payments,
      settledRevenueByCurrency: revenue,
    },
    topAcquisition,
    recentCohorts: cohorts.cohorts.slice(0, 12),
    decisions: {
      checkoutFollowUpAccounts24h: {
        organizer: growth.checkout.byRole.organizer.unconvertedAfter24h,
        sponsor: growth.checkout.byRole.sponsor.unconvertedAfter24h,
      },
      neverOperationallyActivePaidWorkspaces: {
        organizer: growth.retention.organizer.neverOperationallyActive,
        sponsor: growth.retention.sponsor.neverOperationallyActive,
      },
      pendingOrganizerPayouts: growth.marketplace.payoutStates.filter((item) => item.status === 'pending' || item.status === 'held'),
    },
  };

  if (process.argv.includes('--markdown')) {
    const line = (label, value) => `- ${label}: ${value ?? 'n/a'}`;
    const markdown = [
      '# ConferenceGate Executive Growth Snapshot',
      '',
      `Generated: ${snapshot.generatedAt}`,
      '',
      '## Current paid funnel',
      line('Organizer paid subscriptions', snapshot.currentState.organizer.paidSubscriptions),
      line('Organizer paid + activated', snapshot.currentState.organizer.paidAndActivated),
      line('Sponsor paid subscriptions', snapshot.currentState.sponsor.paidSubscriptions),
      line('Sponsor paid + activated', snapshot.currentState.sponsor.paidAndActivated),
      line('Explicit acquisition coverage', `${snapshot.currentState.acquisitionCoverage.coveragePct ?? 'n/a'}%`),
      '',
      '## 7-day movement vs prior 7 days',
      line('Organizer signups', `${organizerSignups.current7d} (${organizerSignups.change7dPct ?? 'n/a'}%)`),
      line('Sponsor signups', `${sponsorSignups.current7d} (${sponsorSignups.change7dPct ?? 'n/a'}%)`),
      line('Sponsorship inquiries', `${inquiries.current7d} (${inquiries.change7dPct ?? 'n/a'}%)`),
      line('Deal Rooms created', `${deals.current7d} (${deals.change7dPct ?? 'n/a'}%)`),
      line('Settled payments', `${payments.current7d} (${payments.change7dPct ?? 'n/a'}%)`),
      '',
      '## Immediate follow-up',
      line('Organizer checkout starts >24h unconverted', snapshot.decisions.checkoutFollowUpAccounts24h.organizer),
      line('Sponsor checkout starts >24h unconverted', snapshot.decisions.checkoutFollowUpAccounts24h.sponsor),
      line('Organizer paid workspaces never operationally active', snapshot.decisions.neverOperationallyActivePaidWorkspaces.organizer),
      line('Sponsor paid workspaces never operationally active', snapshot.decisions.neverOperationallyActivePaidWorkspaces.sponsor),
    ].join('\n');
    console.log(markdown);
  } else {
    console.log(JSON.stringify(snapshot, null, process.argv.includes('--compact') ? 0 : 2));
  }
} finally {
  db.close();
}
