import { dbAll, dbGet } from "./db";

function n(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(num: number, den: number): number | null {
  if (!den) return null;
  return Math.round((num / den) * 1000) / 10;
}

async function scalar(sql: string, args: any[] = []): Promise<number> {
  const row = await dbGet<{ value: number }>(sql, args);
  return n(row?.value);
}

async function tableExists(name: string): Promise<boolean> {
  const row = await dbGet<{ ok: number }>(
    "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
    [name]
  );
  return Boolean(row?.ok);
}

async function roleSummary(role: "organizer" | "sponsor") {
  const [signups, signups7d, signups30d, paid, checkoutStarts30d, checkoutAccounts30d] = await Promise.all([
    scalar("SELECT COUNT(*) AS value FROM users WHERE role=?", [role]),
    scalar("SELECT COUNT(*) AS value FROM users WHERE role=? AND created_at >= datetime('now','-7 days')", [role]),
    scalar("SELECT COUNT(*) AS value FROM users WHERE role=? AND created_at >= datetime('now','-30 days')", [role]),
    scalar("SELECT COUNT(*) AS value FROM users WHERE role=? AND subscription_status IN ('active','trialing')", [role]),
    scalar(
      `SELECT COUNT(*) AS value
         FROM billing_provider_events e
         JOIN users u ON u.id=e.subject_id
        WHERE e.event_type='subscription.checkout.started'
          AND e.created_at >= datetime('now','-30 days')
          AND u.role=?`,
      [role]
    ),
    scalar(
      `SELECT COUNT(DISTINCT e.subject_id) AS value
         FROM billing_provider_events e
         JOIN users u ON u.id=e.subject_id
        WHERE e.event_type='subscription.checkout.started'
          AND e.created_at >= datetime('now','-30 days')
          AND u.role=?`,
      [role]
    ),
  ]);

  const activated = role === "organizer"
    ? await scalar(
        `SELECT COUNT(*) AS value FROM users u
          WHERE u.role='organizer'
            AND EXISTS (SELECT 1 FROM created_conferences c WHERE c.organizer_id=u.id)`
      )
    : await scalar(
        `SELECT COUNT(*) AS value FROM users u
          WHERE u.role='sponsor'
            AND (
              EXISTS (SELECT 1 FROM sponsor_preferences p WHERE p.sponsor_id=u.id)
              OR EXISTS (SELECT 1 FROM sponsor_saved_opportunities s WHERE s.sponsor_id=u.id)
              OR EXISTS (SELECT 1 FROM sponsorship_need_inquiries i WHERE i.sponsor_id=u.id)
            )`
      );

  return {
    signups,
    signups7d,
    signups30d,
    paid,
    currentPaidConversionPct: pct(paid, signups),
    activated,
    activationPct: pct(activated, signups),
    checkoutStarts30d,
    checkoutAccounts30d,
  };
}

async function retention() {
  const rows = await dbAll<any>(
    `WITH activity(account_id,role,activity_at) AS (
       SELECT organizer_id,'organizer',created_at FROM created_conferences
       UNION ALL SELECT organizer_id,'organizer',updated_at FROM sponsorship_needs
       UNION ALL SELECT organizer_id,'organizer',updated_at FROM sponsorship_deals
       UNION ALL SELECT organizer_id,'organizer',created_at FROM organizer_broadcasts
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
            SUM(CASE WHEN la.last_active_at >= datetime('now','-90 days') THEN 1 ELSE 0 END) AS active_90d
       FROM account_workspaces w
       JOIN users u ON u.id=w.owner_id
       LEFT JOIN last_activity la ON la.account_id=w.owner_id AND la.role=w.account_role
      WHERE u.subscription_status IN ('active','trialing')
      GROUP BY w.account_role`
  );

  const result: Record<string, any> = {
    organizer: { paidWorkspaces: 0, active7d: 0, active30d: 0, active90d: 0 },
    sponsor: { paidWorkspaces: 0, active7d: 0, active30d: 0, active90d: 0 },
  };
  for (const row of rows) {
    const role = String(row.role);
    if (!(role in result)) continue;
    const paidWorkspaces = n(row.paid_workspaces);
    const active7d = n(row.active_7d);
    const active30d = n(row.active_30d);
    const active90d = n(row.active_90d);
    result[role] = {
      paidWorkspaces,
      active7d,
      active30d,
      active90d,
      active7dPct: pct(active7d, paidWorkspaces),
      active30dPct: pct(active30d, paidWorkspaces),
      active90dPct: pct(active90d, paidWorkspaces),
    };
  }
  return result;
}

async function acquisition() {
  if (!(await tableExists("account_acquisition"))) {
    return { coveragePct: null, attributedSignups: 0, paidRoleSignups: 0, topSources: [] };
  }
  const [paidRoleSignups, attributedSignups, topSources] = await Promise.all([
    scalar("SELECT COUNT(*) AS value FROM users WHERE role IN ('organizer','sponsor')"),
    scalar("SELECT COUNT(*) AS value FROM account_acquisition"),
    dbAll<any>(
      `SELECT source,role,COUNT(*) AS signups
         FROM account_acquisition
        GROUP BY source,role
        ORDER BY signups DESC,source ASC
        LIMIT 12`
    ),
  ]);
  return {
    paidRoleSignups,
    attributedSignups,
    coveragePct: pct(attributedSignups, paidRoleSignups),
    topSources: topSources.map((row) => ({ source: String(row.source), role: String(row.role), signups: n(row.signups) })),
  };
}

async function marketplace() {
  const [dealStates, settled, refunded, platformFees, payouts] = await Promise.all([
    dbAll<any>("SELECT status,COUNT(*) AS count FROM sponsorship_deals GROUP BY status ORDER BY status"),
    dbAll<any>(
      `SELECT UPPER(currency) AS currency,COUNT(*) AS payments,COALESCE(SUM(amount),0) AS amount
         FROM sponsorship_payments WHERE status='settled' GROUP BY UPPER(currency) ORDER BY UPPER(currency)`
    ),
    dbAll<any>(
      `SELECT UPPER(currency) AS currency,COUNT(*) AS payments,COALESCE(SUM(amount),0) AS amount
         FROM sponsorship_payments WHERE status='refunded' GROUP BY UPPER(currency) ORDER BY UPPER(currency)`
    ),
    dbAll<any>(
      `SELECT UPPER(o.currency) AS currency,COALESCE(SUM(o.platform_fee_amount),0) AS amount
         FROM sponsorship_payout_obligations o
         JOIN sponsorship_payments p ON p.deal_id=o.deal_id AND p.status='settled'
        GROUP BY UPPER(o.currency) ORDER BY UPPER(o.currency)`
    ),
    dbAll<any>(
      `SELECT status,UPPER(currency) AS currency,COUNT(*) AS count,COALESCE(SUM(payout_amount),0) AS amount
         FROM sponsorship_payout_obligations GROUP BY status,UPPER(currency) ORDER BY status,UPPER(currency)`
    ),
  ]);
  return {
    dealStates: dealStates.map((row) => ({ status: String(row.status), count: n(row.count) })),
    settledRevenue: settled.map((row) => ({ currency: String(row.currency || "USD"), payments: n(row.payments), amount: n(row.amount) })),
    refundedRevenue: refunded.map((row) => ({ currency: String(row.currency || "USD"), payments: n(row.payments), amount: n(row.amount) })),
    platformFeeRevenue: platformFees.map((row) => ({ currency: String(row.currency || "USD"), amount: n(row.amount) })),
    payouts: payouts.map((row) => ({ status: String(row.status), currency: String(row.currency || "USD"), count: n(row.count), amount: n(row.amount) })),
  };
}

async function movement() {
  const labels = ["organizer", "sponsor"] as const;
  const result: Record<string, any> = {};
  for (const role of labels) {
    const [current7d, prior7d, current30d, prior30d] = await Promise.all([
      scalar("SELECT COUNT(*) AS value FROM users WHERE role=? AND created_at >= datetime('now','-7 days')", [role]),
      scalar("SELECT COUNT(*) AS value FROM users WHERE role=? AND created_at >= datetime('now','-14 days') AND created_at < datetime('now','-7 days')", [role]),
      scalar("SELECT COUNT(*) AS value FROM users WHERE role=? AND created_at >= datetime('now','-30 days')", [role]),
      scalar("SELECT COUNT(*) AS value FROM users WHERE role=? AND created_at >= datetime('now','-60 days') AND created_at < datetime('now','-30 days')", [role]),
    ]);
    result[role] = { current7d, prior7d, current30d, prior30d };
  }
  return result;
}

export async function buildGrowthDashboard() {
  const [organizer, sponsor, retentionState, acquisitionState, marketplaceState, movementState] = await Promise.all([
    roleSummary("organizer"),
    roleSummary("sponsor"),
    retention(),
    acquisition(),
    marketplace(),
    movement(),
  ]);

  const release = process.env.RENDER_GIT_COMMIT?.trim() || process.env.GIT_COMMIT_SHA?.trim() || "local";
  const growthSchemaReady = await tableExists("subscription_status_history");
  const subscriptionHistoryStartedAt = growthSchemaReady
    ? (await dbGet<{ value: string }>("SELECT value FROM growth_schema_meta WHERE key='subscription_history_started_at'"))?.value || null
    : null;

  return {
    generatedAt: new Date().toISOString(),
    deployment: {
      release: release === "local" ? release : release.slice(0, 12),
      database: "ready",
      persistentDatabase: Boolean(process.env.TURSO_DATABASE_URL?.trim()),
      publicBaseUrlConfigured: Boolean(process.env.PUBLIC_BASE_URL?.trim()),
      checkoutProvider: (process.env.BILLING_CHECKOUT_PROVIDER || "hosted").toLowerCase(),
      paddleConfigured: Boolean(process.env.PADDLE_API_KEY && process.env.PADDLE_WEBHOOK_SECRET),
      fastSpringWebhookConfigured: Boolean(process.env.FASTSPRING_WEBHOOK_SECRET),
      growthSchemaReady,
      subscriptionHistoryStartedAt,
    },
    organizer,
    sponsor,
    movement: movementState,
    retention: retentionState,
    acquisition: acquisitionState,
    marketplace: marketplaceState,
  };
}
