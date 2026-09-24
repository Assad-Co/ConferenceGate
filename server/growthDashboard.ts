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
    return {
      coveragePct: null,
      attributedSignups: 0,
      paidRoleSignups: 0,
      topSources: [],
      organizerSources: [],
      organizerCampaigns: [],
    };
  }

  const [paidRoleSignups, attributedSignups, topSources, organizerSources, organizerCampaigns] = await Promise.all([
    scalar("SELECT COUNT(*) AS value FROM users WHERE role IN ('organizer','sponsor')"),
    scalar("SELECT COUNT(*) AS value FROM account_acquisition"),
    dbAll<any>(
      `SELECT source,role,COUNT(*) AS signups
         FROM account_acquisition
        GROUP BY source,role
        ORDER BY signups DESC,source ASC
        LIMIT 12`
    ),
    dbAll<any>(
      `SELECT a.source AS source,
              COALESCE(a.medium,'') AS medium,
              COUNT(*) AS signups,
              SUM(CASE WHEN u.subscription_status IN ('active','trialing') THEN 1 ELSE 0 END) AS paid,
              SUM(CASE WHEN EXISTS (
                    SELECT 1 FROM created_conferences c WHERE c.organizer_id=u.id
                  ) THEN 1 ELSE 0 END) AS activated,
              SUM(CASE WHEN EXISTS (
                    SELECT 1 FROM sponsorship_needs n WHERE n.organizer_id=u.id
                  ) THEN 1 ELSE 0 END) AS sponsorship_inventory
         FROM account_acquisition a
         JOIN users u ON u.id=a.user_id
        WHERE a.role='organizer'
        GROUP BY a.source,COALESCE(a.medium,'')
        ORDER BY signups DESC,paid DESC,activated DESC,a.source ASC
        LIMIT 20`
    ),
    dbAll<any>(
      `SELECT COALESCE(NULLIF(a.campaign,''),'(no campaign)') AS campaign,
              a.source AS source,
              COUNT(*) AS signups,
              SUM(CASE WHEN u.subscription_status IN ('active','trialing') THEN 1 ELSE 0 END) AS paid,
              SUM(CASE WHEN EXISTS (
                    SELECT 1 FROM created_conferences c WHERE c.organizer_id=u.id
                  ) THEN 1 ELSE 0 END) AS activated
         FROM account_acquisition a
         JOIN users u ON u.id=a.user_id
        WHERE a.role='organizer'
        GROUP BY COALESCE(NULLIF(a.campaign,''),'(no campaign)'),a.source
        ORDER BY signups DESC,paid DESC,activated DESC,campaign ASC
        LIMIT 20`
    ),
  ]);

  return {
    paidRoleSignups,
    attributedSignups,
    coveragePct: pct(attributedSignups, paidRoleSignups),
    topSources: topSources.map((row) => ({
      source: String(row.source),
      role: String(row.role),
      signups: n(row.signups),
    })),
    organizerSources: organizerSources.map((row) => {
      const signups = n(row.signups);
      const paid = n(row.paid);
      const activated = n(row.activated);
      const sponsorshipInventory = n(row.sponsorship_inventory);
      return {
        source: String(row.source),
        medium: String(row.medium || "") || null,
        signups,
        paid,
        activated,
        sponsorshipInventory,
        signupToPaidPct: pct(paid, signups),
        signupToActivatedPct: pct(activated, signups),
        activatedToInventoryPct: pct(sponsorshipInventory, activated),
      };
    }),
    organizerCampaigns: organizerCampaigns.map((row) => {
      const signups = n(row.signups);
      const paid = n(row.paid);
      const activated = n(row.activated);
      return {
        campaign: String(row.campaign),
        source: String(row.source),
        signups,
        paid,
        activated,
        signupToPaidPct: pct(paid, signups),
        signupToActivatedPct: pct(activated, signups),
      };
    }),
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

async function revenueOptimization() {
  const [
    paidOrganizers,
    paidSponsors,
    workspacesWithAddedSeats,
    addedTeamSeats,
    settledDeals,
    checkoutStarts30d,
  ] = await Promise.all([
    scalar("SELECT COUNT(*) AS value FROM users WHERE role='organizer' AND subscription_status IN ('active','trialing')"),
    scalar("SELECT COUNT(*) AS value FROM users WHERE role='sponsor' AND subscription_status IN ('active','trialing')"),
    scalar(
      `SELECT COUNT(DISTINCT w.id) AS value
         FROM account_workspaces w
         JOIN account_workspace_members m ON m.workspace_id=w.id
        WHERE m.status='active' AND m.member_role<>'owner'`
    ),
    scalar(
      `SELECT COUNT(*) AS value
         FROM account_workspace_members
        WHERE status='active' AND member_role<>'owner'`
    ),
    scalar("SELECT COUNT(*) AS value FROM sponsorship_payments WHERE status='settled'"),
    scalar(
      `SELECT COUNT(*) AS value
         FROM billing_provider_events
        WHERE event_type='subscription.checkout.started'
          AND created_at >= datetime('now','-30 days')`
    ),
  ]);

  const checkoutProvider = (process.env.BILLING_CHECKOUT_PROVIDER || "hosted").trim().toLowerCase();
  const organizerCheckoutConfigured =
    checkoutProvider === "paddle"
      ? Boolean(process.env.PADDLE_API_KEY?.trim() && process.env.PADDLE_ORGANIZER_PRICE_ID?.trim())
      : Boolean(process.env.ORGANIZER_CHECKOUT_URL?.trim());
  const sponsorCheckoutConfigured =
    checkoutProvider === "paddle"
      ? Boolean(process.env.PADDLE_API_KEY?.trim() && process.env.PADDLE_SPONSOR_PRICE_ID?.trim())
      : Boolean(process.env.SPONSOR_CHECKOUT_URL?.trim());
  const platformFeeBps = Math.max(0, Math.min(10000, n(process.env.SPONSORSHIP_PLATFORM_FEE_BPS || 0)));
  const seatLimit = Math.max(1, n(process.env.WORKSPACE_SEAT_LIMIT || 10));

  return {
    organizerPro: {
      checkoutConfigured: organizerCheckoutConfigured,
      paidAccounts: paidOrganizers,
    },
    sponsorPro: {
      checkoutConfigured: sponsorCheckoutConfigured,
      paidAccounts: paidSponsors,
    },
    checkoutStarts30d,
    platformFeeBps,
    platformFeePct: Math.round((platformFeeBps / 100) * 100) / 100,
    teamSeats: {
      workspaceSeatLimit: seatLimit,
      workspacesWithAddedSeats,
      addedTeamSeats,
    },
    settledSponsorshipDeals: settledDeals,
    experimentalAddOns: [
      { key: "featured_conference", enabled: false, label: "Featured conference placement" },
      { key: "featured_sponsorship", enabled: false, label: "Featured sponsorship opportunity" },
      { key: "premium_matching", enabled: false, label: "Premium sponsor matching" },
    ],
  };
}

export async function buildLaunchCohort(cohort = "first_customer_launch") {
  if (!(await tableExists("launch_cohort_members"))) {
    return {
      cohort,
      targets: { organizers: 10, sponsorsMin: 20, sponsorsMax: 50 },
      totalMembers: 0,
      organizer: {
        members: 0, paid: 0, activated: 0, marketplaceExposure: 0, inquiries: 0, deals: 0, payments: 0,
      },
      sponsor: {
        members: 0, paid: 0, activated: 0, marketplaceExposure: 0, inquiries: 0, deals: 0, payments: 0,
      },
      members: [],
    };
  }

  const rows = await dbAll<any>(
    `SELECT l.id,l.cohort,l.user_id,l.role,l.segment,l.note,l.created_at,
            u.email,u.name,u.organization,u.subscription_status
       FROM launch_cohort_members l
       JOIN users u ON u.id=l.user_id
      WHERE l.cohort=?
      ORDER BY l.role,l.created_at`,
    [cohort]
  );

  const summaries: Record<"organizer" | "sponsor", any> = {
    organizer: { members: 0, paid: 0, activated: 0, marketplaceExposure: 0, inquiries: 0, deals: 0, payments: 0 },
    sponsor: { members: 0, paid: 0, activated: 0, marketplaceExposure: 0, inquiries: 0, deals: 0, payments: 0 },
  };

  const members = [];
  for (const row of rows) {
    const role = row.role === "sponsor" ? "sponsor" : "organizer";
    const userId = String(row.user_id);
    const paid = ["active", "trialing"].includes(String(row.subscription_status || ""));

    let activated = false;
    let marketplaceExposure = false;
    let inquiries = false;
    let deals = false;
    let payments = false;

    if (role === "organizer") {
      [activated, marketplaceExposure, inquiries, deals, payments] = await Promise.all([
        dbGet<{ ok: number }>("SELECT 1 AS ok FROM created_conferences WHERE organizer_id=? LIMIT 1", [userId]).then(Boolean),
        dbGet<{ ok: number }>(
          `SELECT 1 AS ok
             FROM sponsorship_engagement_events e
             JOIN sponsorship_needs n ON n.id=e.need_id
            WHERE n.organizer_id=? AND e.event_type='listing_view'
            LIMIT 1`,
          [userId]
        ).then(Boolean),
        dbGet<{ ok: number }>(
          `SELECT 1 AS ok
             FROM sponsorship_need_inquiries i
             JOIN sponsorship_needs n ON n.id=i.need_id
            WHERE n.organizer_id=? LIMIT 1`,
          [userId]
        ).then(Boolean),
        dbGet<{ ok: number }>("SELECT 1 AS ok FROM sponsorship_deals WHERE organizer_id=? LIMIT 1", [userId]).then(Boolean),
        dbGet<{ ok: number }>(
          `SELECT 1 AS ok
             FROM sponsorship_payments p
             JOIN sponsorship_deals d ON d.id=p.deal_id
            WHERE d.organizer_id=? AND p.status='settled' LIMIT 1`,
          [userId]
        ).then(Boolean),
      ]);
    } else {
      [activated, marketplaceExposure, inquiries, deals, payments] = await Promise.all([
        dbGet<{ ok: number }>(
          `SELECT 1 AS ok
             WHERE EXISTS(SELECT 1 FROM sponsor_preferences WHERE sponsor_id=?)
                OR EXISTS(SELECT 1 FROM sponsor_saved_opportunities WHERE sponsor_id=?)
                OR EXISTS(SELECT 1 FROM sponsorship_need_inquiries WHERE sponsor_id=?)
             LIMIT 1`,
          [userId, userId, userId]
        ).then(Boolean),
        dbGet<{ ok: number }>(
          "SELECT 1 AS ok FROM sponsorship_engagement_events WHERE sponsor_id=? AND event_type='listing_view' LIMIT 1",
          [userId]
        ).then(Boolean),
        dbGet<{ ok: number }>("SELECT 1 AS ok FROM sponsorship_need_inquiries WHERE sponsor_id=? LIMIT 1", [userId]).then(Boolean),
        dbGet<{ ok: number }>("SELECT 1 AS ok FROM sponsorship_deals WHERE sponsor_id=? LIMIT 1", [userId]).then(Boolean),
        dbGet<{ ok: number }>(
          `SELECT 1 AS ok
             FROM sponsorship_payments p
             JOIN sponsorship_deals d ON d.id=p.deal_id
            WHERE d.sponsor_id=? AND p.status='settled' LIMIT 1`,
          [userId]
        ).then(Boolean),
      ]);
    }

    const summary = summaries[role];
    summary.members += 1;
    if (paid) summary.paid += 1;
    if (activated) summary.activated += 1;
    if (marketplaceExposure) summary.marketplaceExposure += 1;
    if (inquiries) summary.inquiries += 1;
    if (deals) summary.deals += 1;
    if (payments) summary.payments += 1;

    members.push({
      id: String(row.id),
      userId,
      role,
      email: String(row.email || ""),
      name: String(row.name || ""),
      organization: row.organization ? String(row.organization) : null,
      segment: row.segment ? String(row.segment) : null,
      note: row.note ? String(row.note) : null,
      createdAt: String(row.created_at),
      paid,
      activated,
      marketplaceExposure,
      inquiries,
      deals,
      payments,
    });
  }

  for (const role of ["organizer", "sponsor"] as const) {
    const summary = summaries[role];
    summary.paidPct = pct(summary.paid, summary.members);
    summary.activationPct = pct(summary.activated, summary.members);
    summary.exposurePct = pct(summary.marketplaceExposure, summary.members);
    summary.inquiryPct = pct(summary.inquiries, summary.members);
    summary.dealPct = pct(summary.deals, summary.members);
    summary.paymentPct = pct(summary.payments, summary.members);
  }

  return {
    cohort,
    targets: { organizers: 10, sponsorsMin: 20, sponsorsMax: 50 },
    totalMembers: rows.length,
    organizer: summaries.organizer,
    sponsor: summaries.sponsor,
    members,
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
  const [
    organizer,
    sponsor,
    retentionState,
    acquisitionState,
    marketplaceState,
    movementState,
    revenueOptimizationState,
    launchCohortState,
  ] = await Promise.all([
    roleSummary("organizer"),
    roleSummary("sponsor"),
    retention(),
    acquisition(),
    marketplace(),
    movement(),
    revenueOptimization(),
    buildLaunchCohort(),
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
      persistentDatabase: Boolean(process.env.DATABASE_PATH?.trim()),
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
    revenueOptimization: revenueOptimizationState,
    launchCohort: launchCohortState,
  };
}
