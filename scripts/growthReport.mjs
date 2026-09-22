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

async function checkoutOperations() {
  const providerRows = await grouped(
    `SELECT u.role AS role,
            e.provider AS provider,
            COUNT(*) AS starts,
            COUNT(DISTINCT e.subject_id) AS accounts
       FROM billing_provider_events e
       JOIN users u ON u.id=e.subject_id
      WHERE e.event_type='subscription.checkout.started'
        AND e.created_at >= datetime('now','-30 days')
        AND u.role IN ('organizer','sponsor')
      GROUP BY u.role,e.provider
      ORDER BY u.role,e.provider`
  );

  const byRole = {};
  for (const role of ['organizer', 'sponsor']) {
    const starts30d = await scalar(
      `SELECT COUNT(*) AS value
         FROM billing_provider_events e
         JOIN users u ON u.id=e.subject_id
        WHERE e.event_type='subscription.checkout.started'
          AND e.created_at >= datetime('now','-30 days')
          AND u.role=?`,
      [role]
    );
    const uniqueAccounts30d = await scalar(
      `SELECT COUNT(DISTINCT e.subject_id) AS value
         FROM billing_provider_events e
         JOIN users u ON u.id=e.subject_id
        WHERE e.event_type='subscription.checkout.started'
          AND e.created_at >= datetime('now','-30 days')
          AND u.role=?`,
      [role]
    );
    const currentlyPaidAccounts = await scalar(
      `SELECT COUNT(DISTINCT e.subject_id) AS value
         FROM billing_provider_events e
         JOIN users u ON u.id=e.subject_id
        WHERE e.event_type='subscription.checkout.started'
          AND e.created_at >= datetime('now','-30 days')
          AND u.role=?
          AND u.subscription_status IN ('active','trialing')`,
      [role]
    );
    const unconvertedAfter24h = await scalar(
      `SELECT COUNT(DISTINCT e.subject_id) AS value
         FROM billing_provider_events e
         JOIN users u ON u.id=e.subject_id
        WHERE e.event_type='subscription.checkout.started'
          AND e.created_at >= datetime('now','-30 days')
          AND e.created_at <= datetime('now','-24 hours')
          AND u.role=?
          AND u.subscription_status NOT IN ('active','trialing')`,
      [role]
    );
    byRole[role] = {
      starts30d,
      uniqueAccounts30d,
      currentlyPaidAccounts,
      unconvertedAfter24h,
      checkoutToCurrentPaidPct: rate(currentlyPaidAccounts, uniqueAccounts30d),
    };
  }

  return {
    byRole,
    byProvider30d: providerRows.map((row) => ({
      role: String(row.role),
      provider: String(row.provider),
      starts: numberValue(row.starts),
      accounts: numberValue(row.accounts),
    })),
  };
}

async function retentionOperations() {
  const rows = await grouped(
    `WITH activity(account_id,role,activity_at) AS (
       SELECT organizer_id,'organizer',created_at FROM created_conferences
       UNION ALL SELECT organizer_id,'organizer',updated_at FROM sponsorship_needs
       UNION ALL SELECT organizer_id,'organizer',updated_at FROM sponsorship_deals
       UNION ALL SELECT organizer_id,'organizer',created_at FROM organizer_broadcasts
       UNION ALL SELECT organizer_id,'organizer',created_at FROM professional_invitations
       UNION ALL SELECT sponsor_id,'sponsor',updated_at FROM sponsor_preferences
       UNION ALL SELECT sponsor_id,'sponsor',updated_at FROM sponsor_saved_opportunities
       UNION ALL SELECT sponsor_id,'sponsor',updated_at FROM sponsorship_need_inquiries
       UNION ALL SELECT sponsor_id,'sponsor',updated_at FROM sponsorship_deals
       UNION ALL SELECT sponsor_id,'sponsor',updated_at FROM sponsor_requests
       UNION ALL
       SELECT w.owner_id,w.account_role,a.created_at
         FROM account_workspace_audit a
         JOIN account_workspaces w ON w.id=a.workspace_id
     ), last_activity AS (
       SELECT account_id,role,MAX(activity_at) AS last_active_at
         FROM activity
        WHERE activity_at IS NOT NULL
        GROUP BY account_id,role
     )
     SELECT w.account_role AS role,
            COUNT(*) AS paid_workspaces,
            SUM(CASE WHEN la.last_active_at >= datetime('now','-7 days') THEN 1 ELSE 0 END) AS active_7d,
            SUM(CASE WHEN la.last_active_at >= datetime('now','-30 days') THEN 1 ELSE 0 END) AS active_30d,
            SUM(CASE WHEN la.last_active_at >= datetime('now','-90 days') THEN 1 ELSE 0 END) AS active_90d,
            SUM(CASE WHEN la.last_active_at IS NULL THEN 1 ELSE 0 END) AS never_operationally_active
       FROM account_workspaces w
       JOIN users u ON u.id=w.owner_id
       LEFT JOIN last_activity la ON la.account_id=w.owner_id AND la.role=w.account_role
      WHERE u.subscription_status IN ('active','trialing')
      GROUP BY w.account_role
      ORDER BY w.account_role`
  );

  const result = {
    organizer: {
      paidWorkspaces: 0,
      active7d: 0,
      active30d: 0,
      active90d: 0,
      neverOperationallyActive: 0,
      active7dPct: null,
      active30dPct: null,
      active90dPct: null,
    },
    sponsor: {
      paidWorkspaces: 0,
      active7d: 0,
      active30d: 0,
      active90d: 0,
      neverOperationallyActive: 0,
      active7dPct: null,
      active30dPct: null,
      active90dPct: null,
    },
  };

  for (const row of rows) {
    const role = String(row.role);
    if (role !== 'organizer' && role !== 'sponsor') continue;
    const paidWorkspaces = numberValue(row.paid_workspaces);
    const active7d = numberValue(row.active_7d);
    const active30d = numberValue(row.active_30d);
    const active90d = numberValue(row.active_90d);
    result[role] = {
      paidWorkspaces,
      active7d,
      active30d,
      active90d,
      neverOperationallyActive: numberValue(row.never_operationally_active),
      active7dPct: rate(active7d, paidWorkspaces),
      active30dPct: rate(active30d, paidWorkspaces),
      active90dPct: rate(active90d, paidWorkspaces),
    };
  }
  return result;
}

async function workspaceAdoption() {
  const rows = await grouped(
    `SELECT w.account_role AS role,
            COUNT(*) AS workspaces,
            COALESCE(SUM(w.seat_limit),0) AS seat_capacity,
            COALESCE(SUM((
              SELECT COUNT(*) FROM account_workspace_members m
               WHERE m.workspace_id=w.id AND m.status='active'
            )),0) AS active_seats,
            COALESCE(SUM((
              SELECT COUNT(*) FROM account_workspace_members m
               WHERE m.workspace_id=w.id AND m.status='active' AND m.member_role <> 'owner'
            )),0) AS team_seats
       FROM account_workspaces w
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
  const [organizer, sponsor, checkout, retention, workspaces, marketplace] = await Promise.all([
    roleFunnel('organizer'),
    roleFunnel('sponsor'),
    checkoutOperations(),
    retentionOperations(),
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
      checkoutStart: 'ConferenceGate received a usable checkout URL and recorded the event immediately before provider navigation',
      checkoutAbandonmentProxy: 'a checkout-start account whose checkout is at least 24 hours old and whose current subscription is not active or trialing',
      activePaidWorkspace: 'a currently paid workspace whose owner account has recorded role-specific operational activity in the selected lookback window',
      realizedRevenue: 'provider-confirmed sponsorship payments that remain settled; refunds are excluded',
    },
    organizer,
    sponsor,
    checkout,
    retention,
    workspaces,
    marketplace,
  };

  console.log(JSON.stringify(report, null, process.argv.includes('--compact') ? 0 : 2));
} finally {
  db.close();
}
