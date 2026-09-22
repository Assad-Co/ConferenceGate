import { createClient } from '@libsql/client';
import path from 'node:path';

const isTest = process.env.NODE_ENV === 'test';
const testDatabasePath = process.env.TEST_DATABASE_PATH?.trim();
const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN?.trim();

if (isTest && !testDatabasePath) {
  throw new Error('NODE_ENV=test requires TEST_DATABASE_PATH for the growth report.');
}
if (isTest && (tursoUrl || tursoAuthToken)) {
  throw new Error('Refusing to run growth report tests with production Turso credentials.');
}

const db = isTest
  ? createClient({ url: `file:${path.resolve(testDatabasePath)}` })
  : tursoUrl
    ? createClient({ url: tursoUrl, authToken: tursoAuthToken })
    : createClient({ url: `file:${path.resolve('data/app.db')}` });

function numberValue(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function rate(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

async function scalar(sql, args = []) {
  const result = await db.execute({ sql, args });
  return numberValue(result.rows[0]?.value);
}

async function grouped(sql, args = []) {
  const result = await db.execute({ sql, args });
  return result.rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value])));
}

async function roleFunnel(role) {
  const signups = await scalar('SELECT COUNT(*) AS value FROM users WHERE role=?', [role]);
  const signups7d = await scalar(
    "SELECT COUNT(*) AS value FROM users WHERE role=? AND created_at >= datetime('now','-7 days')",
    [role]
  );
  const signups30d = await scalar(
    "SELECT COUNT(*) AS value FROM users WHERE role=? AND created_at >= datetime('now','-30 days')",
    [role]
  );
  const paid = await scalar(
    "SELECT COUNT(*) AS value FROM users WHERE role=? AND subscription_status IN ('active','trialing')",
    [role]
  );

  if (role === 'organizer') {
    const activated = await scalar(
      `SELECT COUNT(*) AS value FROM users u
       WHERE u.role='organizer'
         AND EXISTS (SELECT 1 FROM created_conferences c WHERE c.organizer_id=u.id)`
    );
    const activatedPaid = await scalar(
      `SELECT COUNT(*) AS value FROM users u
       WHERE u.role='organizer' AND u.subscription_status IN ('active','trialing')
         AND EXISTS (SELECT 1 FROM created_conferences c WHERE c.organizer_id=u.id)`
    );
    const commercialInventory = await scalar(
      `SELECT COUNT(*) AS value FROM users u
       WHERE u.role='organizer'
         AND EXISTS (SELECT 1 FROM sponsorship_needs n WHERE n.organizer_id=u.id)`
    );
    const sponsorInterest = await scalar(
      `SELECT COUNT(DISTINCT n.organizer_id) AS value
         FROM sponsorship_needs n
         JOIN sponsorship_need_inquiries i ON i.need_id=n.id`
    );
    const deals = await scalar(
      `SELECT COUNT(DISTINCT organizer_id) AS value FROM sponsorship_deals`
    );
    const paidDeals = await scalar(
      `SELECT COUNT(DISTINCT d.organizer_id) AS value
         FROM sponsorship_deals d
         JOIN sponsorship_payments p ON p.deal_id=d.id AND p.status='settled'`
    );

    return {
      signups,
      signups7d,
      signups30d,
      paidSubscriptions: paid,
      firstValueActivated: activated,
      paidAndActivated: activatedPaid,
      publishedSponsorshipInventory: commercialInventory,
      receivedSponsorInterest: sponsorInterest,
      reachedDealRoom: deals,
      realizedSponsorPayment: paidDeals,
      conversionPct: {
        signupToPaid: rate(paid, signups),
        paidToFirstValue: rate(activatedPaid, paid),
        firstValueToInventory: rate(commercialInventory, activated),
        inventoryToSponsorInterest: rate(sponsorInterest, commercialInventory),
        sponsorInterestToDeal: rate(deals, sponsorInterest),
        dealToPayment: rate(paidDeals, deals),
      },
    };
  }

  const activated = await scalar(
    `SELECT COUNT(*) AS value FROM users u
     WHERE u.role='sponsor'
       AND (
         EXISTS (SELECT 1 FROM sponsor_preferences p WHERE p.sponsor_id=u.id)
         OR EXISTS (SELECT 1 FROM sponsor_saved_opportunities s WHERE s.sponsor_id=u.id)
         OR EXISTS (SELECT 1 FROM sponsorship_need_inquiries i WHERE i.sponsor_id=u.id)
       )`
  );
  const activatedPaid = await scalar(
    `SELECT COUNT(*) AS value FROM users u
     WHERE u.role='sponsor' AND u.subscription_status IN ('active','trialing')
       AND (
         EXISTS (SELECT 1 FROM sponsor_preferences p WHERE p.sponsor_id=u.id)
         OR EXISTS (SELECT 1 FROM sponsor_saved_opportunities s WHERE s.sponsor_id=u.id)
         OR EXISTS (SELECT 1 FROM sponsorship_need_inquiries i WHERE i.sponsor_id=u.id)
       )`
  );
  const preferenceProfiles = await scalar(
    `SELECT COUNT(DISTINCT sponsor_id) AS value FROM sponsor_preferences`
  );
  const watchlists = await scalar(
    `SELECT COUNT(DISTINCT sponsor_id) AS value FROM sponsor_saved_opportunities`
  );
  const inquiries = await scalar(
    `SELECT COUNT(DISTINCT sponsor_id) AS value FROM sponsorship_need_inquiries`
  );
  const deals = await scalar(
    `SELECT COUNT(DISTINCT sponsor_id) AS value FROM sponsorship_deals`
  );
  const paidDeals = await scalar(
    `SELECT COUNT(DISTINCT d.sponsor_id) AS value
       FROM sponsorship_deals d
       JOIN sponsorship_payments p ON p.deal_id=d.id AND p.status='settled'`
  );

  return {
    signups,
    signups7d,
    signups30d,
    paidSubscriptions: paid,
    firstValueActivated: activated,
    paidAndActivated: activatedPaid,
    preferenceProfiles,
    watchlistAdoption: watchlists,
    sentSponsorInquiry: inquiries,
    reachedDealRoom: deals,
    realizedSponsorPayment: paidDeals,
    conversionPct: {
      signupToPaid: rate(paid, signups),
      paidToFirstValue: rate(activatedPaid, paid),
      firstValueToInquiry: rate(inquiries, activated),
      inquiryToDeal: rate(deals, inquiries),
      dealToPayment: rate(paidDeals, deals),
    },
  };
}

async function workspaceAdoption() {
  const rows = await grouped(
    `SELECT w.account_role AS role,
            COUNT(DISTINCT w.id) AS workspaces,
            SUM(w.seat_limit) AS seat_capacity,
            COUNT(m.id) AS active_seats,
            SUM(CASE WHEN m.member_role <> 'owner' THEN 1 ELSE 0 END) AS team_seats
       FROM account_workspaces w
       LEFT JOIN account_workspace_members m
         ON m.workspace_id=w.id AND m.status='active'
      GROUP BY w.account_role`
  );

  return Object.fromEntries(rows.map((row) => {
    const capacity = numberValue(row.seat_capacity);
    const active = numberValue(row.active_seats);
    return [String(row.role), {
      workspaces: numberValue(row.workspaces),
      activeSeats: active,
      addedTeamSeats: numberValue(row.team_seats),
      seatCapacity: capacity,
      seatUtilizationPct: rate(active, capacity),
    }];
  }));
}

async function marketplaceRevenue() {
  const dealStates = await grouped(
    `SELECT status, COUNT(*) AS count
       FROM sponsorship_deals
      GROUP BY status
      ORDER BY status`
  );
  const settledRevenue = await grouped(
    `SELECT UPPER(currency) AS currency, COUNT(*) AS payments, COALESCE(SUM(amount),0) AS amount
       FROM sponsorship_payments
      WHERE status='settled'
      GROUP BY UPPER(currency)
      ORDER BY UPPER(currency)`
  );
  const refundedRevenue = await grouped(
    `SELECT UPPER(currency) AS currency, COUNT(*) AS payments, COALESCE(SUM(amount),0) AS amount
       FROM sponsorship_payments
      WHERE status='refunded'
      GROUP BY UPPER(currency)
      ORDER BY UPPER(currency)`
  );
  const feeRevenue = await grouped(
    `SELECT UPPER(o.currency) AS currency, COALESCE(SUM(o.platform_fee_amount),0) AS amount
       FROM sponsorship_payout_obligations o
       JOIN sponsorship_payments p ON p.deal_id=o.deal_id AND p.status='settled'
      GROUP BY UPPER(o.currency)
      ORDER BY UPPER(o.currency)`
  );
  const payoutStates = await grouped(
    `SELECT status, UPPER(currency) AS currency, COUNT(*) AS count, COALESCE(SUM(payout_amount),0) AS amount
       FROM sponsorship_payout_obligations
      GROUP BY status, UPPER(currency)
      ORDER BY status, UPPER(currency)`
  );
  const engagement30d = await grouped(
    `SELECT event_type, COUNT(*) AS count
       FROM sponsorship_engagement_events
      WHERE created_at >= datetime('now','-30 days')
      GROUP BY event_type
      ORDER BY event_type`
  );

  return {
    dealStates: Object.fromEntries(dealStates.map((row) => [String(row.status), numberValue(row.count)])),
    settledRevenue: settledRevenue.map((row) => ({
      currency: String(row.currency || 'USD'),
      payments: numberValue(row.payments),
      amount: numberValue(row.amount),
    })),
    refundedRevenue: refundedRevenue.map((row) => ({
      currency: String(row.currency || 'USD'),
      payments: numberValue(row.payments),
      amount: numberValue(row.amount),
    })),
    platformFeeRevenue: feeRevenue.map((row) => ({
      currency: String(row.currency || 'USD'),
      amount: numberValue(row.amount),
    })),
    payoutStates: payoutStates.map((row) => ({
      status: String(row.status),
      currency: String(row.currency || 'USD'),
      count: numberValue(row.count),
      amount: numberValue(row.amount),
    })),
    engagement30d: Object.fromEntries(engagement30d.map((row) => [String(row.event_type), numberValue(row.count)])),
  };
}

try {
  const [organizer, sponsor, workspaces, marketplace] = await Promise.all([
    roleFunnel('organizer'),
    roleFunnel('sponsor'),
    workspaceAdoption(),
    marketplaceRevenue(),
  ]);

  const report = {
    report: 'conferencegate_growth_operations',
    generatedAt: new Date().toISOString(),
    definitions: {
      paidSubscription: "subscription_status is active or trialing on the paid account owner",
      organizerFirstValue: 'organizer account has created at least one conference',
      sponsorFirstValue: 'sponsor account has preferences, a saved opportunity, or a sponsorship inquiry',
      realizedRevenue: 'provider-confirmed sponsorship payments that remain settled; refunds are excluded',
    },
    organizer,
    sponsor,
    workspaces,
    marketplace,
  };

  console.log(JSON.stringify(report, null, process.argv.includes('--compact') ? 0 : 2));
} finally {
  db.close();
}
