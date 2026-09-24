import { Router, Response } from "express";
import { dbAll, dbGet } from "./db";
import { requireAuth, type AuthedRequest } from "./auth";
import { asyncHandler } from "./asyncHandler";
import {
  resolvePaidAccountContext,
  type PaidAccountRole,
} from "./workspaceAccess";

export type MarketplaceActionPriority = "critical" | "high" | "medium" | "low";

export interface MarketplaceAction {
  key: string;
  priority: MarketplaceActionPriority;
  score: number;
  title: string;
  reason: string;
  target: string;
  entityId?: string | null;
  entityTitle?: string | null;
  metric?: { label: string; value: number | string } | null;
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(num: number, den: number): number | null {
  if (!den) return null;
  return Math.round((num / den) * 1000) / 10;
}

function priorityFor(score: number): MarketplaceActionPriority {
  if (score >= 90) return "critical";
  if (score >= 75) return "high";
  if (score >= 55) return "medium";
  return "low";
}

function action(input: Omit<MarketplaceAction, "priority">): MarketplaceAction {
  return { ...input, priority: priorityFor(input.score) };
}

export async function buildOrganizerMarketplaceActions(accountId: string): Promise<MarketplaceAction[]> {
  const [
    conferences,
    activeNeeds,
    newInquiries,
    staleDeals,
    quietNeeds,
    highIntentNeeds,
  ] = await Promise.all([
    dbGet<{ count: number }>(
      "SELECT COUNT(*) AS count FROM created_conferences WHERE organizer_id=?",
      [accountId]
    ),
    dbGet<{ count: number }>(
      "SELECT COUNT(*) AS count FROM sponsorship_needs WHERE organizer_id=? AND status='active' AND (deadline IS NULL OR deadline='' OR date(deadline)>=date('now'))",
      [accountId]
    ),
    dbAll<any>(
      `SELECT i.id,i.need_id,n.title,n.conference_title,
              CAST(julianday('now')-julianday(i.created_at) AS INTEGER) AS age_days
         FROM sponsorship_need_inquiries i
         JOIN sponsorship_needs n ON n.id=i.need_id
        WHERE n.organizer_id=? AND i.status IN ('new','contacted')
        ORDER BY i.created_at ASC
        LIMIT 10`,
      [accountId]
    ),
    dbAll<any>(
      `SELECT id,opportunity_title,conference_title,status,
              CAST(julianday('now')-julianday(updated_at) AS INTEGER) AS age_days
         FROM sponsorship_deals
        WHERE organizer_id=?
          AND status NOT IN ('completed','canceled')
          AND updated_at <= datetime('now','-5 days')
        ORDER BY updated_at ASC
        LIMIT 10`,
      [accountId]
    ),
    dbAll<any>(
      `SELECT n.id,n.title,n.conference_title,
              CAST(julianday('now')-julianday(n.created_at) AS INTEGER) AS age_days,
              COUNT(DISTINCT CASE WHEN e.event_type='listing_view' THEN e.sponsor_id END) AS viewers
         FROM sponsorship_needs n
         LEFT JOIN sponsorship_engagement_events e ON e.need_id=n.id
        WHERE n.organizer_id=? AND n.status='active'
          AND (n.deadline IS NULL OR n.deadline='' OR date(n.deadline)>=date('now'))
        GROUP BY n.id
       HAVING age_days>=7 AND viewers=0
        ORDER BY n.created_at ASC
        LIMIT 10`,
      [accountId]
    ),
    dbAll<any>(
      `SELECT n.id,n.title,n.conference_title,
              COUNT(DISTINCT CASE WHEN e.event_type='listing_view' THEN e.sponsor_id END) AS viewers,
              COUNT(DISTINCT i.sponsor_id) AS inquiries
         FROM sponsorship_needs n
         LEFT JOIN sponsorship_engagement_events e ON e.need_id=n.id
         LEFT JOIN sponsorship_need_inquiries i ON i.need_id=n.id
        WHERE n.organizer_id=? AND n.status='active'
          AND n.created_at <= datetime('now','-7 days')
          AND (n.deadline IS NULL OR n.deadline='' OR date(n.deadline)>=date('now'))
        GROUP BY n.id
       HAVING viewers>=3 AND inquiries=0
        ORDER BY viewers DESC
        LIMIT 10`,
      [accountId]
    ),
  ]);

  const actions: MarketplaceAction[] = [];
  const conferenceCount = numberValue(conferences?.count);
  const needCount = numberValue(activeNeeds?.count);

  if (conferenceCount === 0) {
    actions.push(action({
      key: "create_first_conference",
      score: 98,
      title: "Create your first conference",
      reason: "Marketplace activity cannot start until an Organizer has a conference to connect sponsorship inventory to.",
      target: "conference_wizard",
      metric: { label: "Conferences", value: 0 },
    }));
  } else if (needCount === 0) {
    actions.push(action({
      key: "publish_sponsorship_inventory",
      score: 94,
      title: "Publish sponsorship inventory",
      reason: "Your conference exists, but Sponsors have no Organizer-published opportunity to discover or inquire about.",
      target: "sponsorship",
      metric: { label: "Active opportunities", value: 0 },
    }));
  }

  if (newInquiries.length) {
    actions.push(action({
      key: "respond_to_sponsor_inquiries",
      score: 96,
      title: "Respond to Sponsor inquiries",
      reason: `${newInquiries.length} inquiry${newInquiries.length === 1 ? "" : "ies"} still need Organizer follow-up.`,
      target: "sponsorship",
      entityId: String(newInquiries[0].id),
      entityTitle: String(newInquiries[0].title || newInquiries[0].conference_title || ""),
      metric: { label: "Awaiting response", value: newInquiries.length },
    }));
  }

  if (staleDeals.length) {
    const oldest = Math.max(...staleDeals.map((row) => numberValue(row.age_days)));
    actions.push(action({
      key: "advance_stalled_deal_rooms",
      score: 91,
      title: "Advance stalled Deal Rooms",
      reason: `${staleDeals.length} active Deal Room${staleDeals.length === 1 ? " has" : "s have"} not changed for at least 5 days.`,
      target: "sponsorship",
      entityId: String(staleDeals[0].id),
      entityTitle: String(staleDeals[0].opportunity_title || staleDeals[0].conference_title || ""),
      metric: { label: "Oldest inactivity", value: `${oldest}d` },
    }));
  }

  if (highIntentNeeds.length) {
    const row = highIntentNeeds[0];
    actions.push(action({
      key: "improve_high_intent_offer",
      score: 82,
      title: "Improve an opportunity with Sponsor interest",
      reason: `${numberValue(row.viewers)} Sponsors viewed “${String(row.title)}” but no inquiry has been sent yet. Review price, benefits, deadline and clarity.`,
      target: "sponsorship",
      entityId: String(row.id),
      entityTitle: String(row.title),
      metric: { label: "Sponsor viewers", value: numberValue(row.viewers) },
    }));
  }

  if (quietNeeds.length) {
    const row = quietNeeds[0];
    actions.push(action({
      key: "improve_low_visibility_inventory",
      score: 72,
      title: "Improve low-visibility sponsorship inventory",
      reason: `“${String(row.title)}” has been active for ${numberValue(row.age_days)} days without a recorded Sponsor view.`,
      target: "sponsorship",
      entityId: String(row.id),
      entityTitle: String(row.title),
      metric: { label: "Days active", value: numberValue(row.age_days) },
    }));
  }

  return actions.sort((a, b) => b.score - a.score).slice(0, 8);
}

export async function buildSponsorMarketplaceActions(accountId: string): Promise<MarketplaceAction[]> {
  const [
    preference,
    savedCount,
    watchedCount,
    pendingSaved,
    followUps,
    staleDeals,
    activeNeeds,
    activeRequests,
  ] = await Promise.all([
    dbGet<any>("SELECT * FROM sponsor_preferences WHERE sponsor_id=?", [accountId]),
    dbGet<{ count: number }>(
      "SELECT COUNT(*) AS count FROM sponsor_saved_opportunities WHERE sponsor_id=?",
      [accountId]
    ),
    dbGet<{ count: number }>(
      "SELECT COUNT(*) AS count FROM sponsor_saved_opportunities WHERE sponsor_id=? AND alert_enabled=1",
      [accountId]
    ),
    dbAll<any>(
      `SELECT s.id,s.source_id,s.title,s.conference_title,
              CAST(julianday('now')-julianday(s.created_at) AS INTEGER) AS age_days
         FROM sponsor_saved_opportunities s
        WHERE s.sponsor_id=?
          AND s.source_type='internal_need'
          AND s.created_at <= datetime('now','-3 days')
          AND NOT EXISTS(
            SELECT 1 FROM sponsorship_need_inquiries i
             WHERE i.need_id=s.source_id AND i.sponsor_id=s.sponsor_id
          )
        ORDER BY s.created_at ASC
        LIMIT 10`,
      [accountId]
    ),
    dbAll<any>(
      `SELECT i.id,i.need_id,n.title,n.conference_title,i.status,
              CAST(julianday('now')-julianday(i.updated_at) AS INTEGER) AS age_days
         FROM sponsorship_need_inquiries i
         JOIN sponsorship_needs n ON n.id=i.need_id
        WHERE i.sponsor_id=?
          AND i.status IN ('new','contacted')
          AND i.updated_at <= datetime('now','-3 days')
          AND NOT EXISTS(SELECT 1 FROM sponsorship_deals d WHERE d.inquiry_id=i.id)
        ORDER BY i.updated_at ASC
        LIMIT 10`,
      [accountId]
    ),
    dbAll<any>(
      `SELECT id,opportunity_title,conference_title,status,
              CAST(julianday('now')-julianday(updated_at) AS INTEGER) AS age_days
         FROM sponsorship_deals
        WHERE sponsor_id=?
          AND status NOT IN ('completed','canceled')
          AND updated_at <= datetime('now','-5 days')
        ORDER BY updated_at ASC
        LIMIT 10`,
      [accountId]
    ),
    dbGet<{ count: number }>(
      "SELECT COUNT(*) AS count FROM sponsorship_needs WHERE status='active' AND (deadline IS NULL OR deadline='' OR date(deadline)>=date('now'))"
    ),
    dbGet<{ count: number }>(
      "SELECT COUNT(*) AS count FROM sponsor_requests WHERE sponsor_id=? AND status='active'",
      [accountId]
    ),
  ]);

  const actions: MarketplaceAction[] = [];
  const hasPreferences = Boolean(preference);
  const preferenceDimensions = preference
    ? [
        JSON.parse(String(preference.sectors || "[]")),
        JSON.parse(String(preference.categories || "[]")),
        JSON.parse(String(preference.regions || "[]")),
        JSON.parse(String(preference.opportunity_types || "[]")),
      ].filter((items) => Array.isArray(items) && items.length).length
    : 0;

  if (!hasPreferences || preferenceDimensions < 2) {
    actions.push(action({
      key: "complete_matching_preferences",
      score: 97,
      title: "Complete matching preferences",
      reason: "Choose at least two business criteria so ConferenceGate can prioritize relevant Organizer opportunities.",
      target: "preferences",
      metric: { label: "Preference groups", value: preferenceDimensions },
    }));
  }

  if (staleDeals.length) {
    const oldest = Math.max(...staleDeals.map((row) => numberValue(row.age_days)));
    actions.push(action({
      key: "advance_sponsor_deal_rooms",
      score: 92,
      title: "Advance active Deal Rooms",
      reason: `${staleDeals.length} Deal Room${staleDeals.length === 1 ? " has" : "s have"} had no update for at least 5 days.`,
      target: "deals",
      entityId: String(staleDeals[0].id),
      entityTitle: String(staleDeals[0].opportunity_title || staleDeals[0].conference_title || ""),
      metric: { label: "Oldest inactivity", value: `${oldest}d` },
    }));
  }

  if (followUps.length) {
    const oldest = Math.max(...followUps.map((row) => numberValue(row.age_days)));
    actions.push(action({
      key: "follow_up_inquiries",
      score: 86,
      title: "Follow up on open inquiries",
      reason: `${followUps.length} inquiry${followUps.length === 1 ? " has" : "ies have"} not advanced to a Deal Room.`,
      target: "matches",
      entityId: String(followUps[0].need_id),
      entityTitle: String(followUps[0].title || followUps[0].conference_title || ""),
      metric: { label: "Oldest inactivity", value: `${oldest}d` },
    }));
  }

  if (pendingSaved.length) {
    actions.push(action({
      key: "act_on_saved_opportunities",
      score: 78,
      title: "Act on saved opportunities",
      reason: `${pendingSaved.length} saved opportunit${pendingSaved.length === 1 ? "y has" : "ies have"} been waiting at least 3 days without an inquiry.`,
      target: "saved",
      entityId: String(pendingSaved[0].source_id),
      entityTitle: String(pendingSaved[0].title || pendingSaved[0].conference_title || ""),
      metric: { label: "Saved without inquiry", value: pendingSaved.length },
    }));
  }

  const saved = numberValue(savedCount?.count);
  const watched = numberValue(watchedCount?.count);
  if (saved > 0 && watched === 0) {
    actions.push(action({
      key: "enable_watch_alerts",
      score: 62,
      title: "Enable watch alerts",
      reason: "You have saved opportunities but none are currently watched for material changes.",
      target: "saved",
      metric: { label: "Saved opportunities", value: saved },
    }));
  }

  if (numberValue(activeNeeds?.count) > 0 && saved === 0 && followUps.length === 0 && staleDeals.length === 0) {
    actions.push(action({
      key: "review_marketplace",
      score: 58,
      title: "Review current sponsorship opportunities",
      reason: `${numberValue(activeNeeds?.count)} active Organizer opportunit${numberValue(activeNeeds?.count) === 1 ? "y is" : "ies are"} available in the internal marketplace.`,
      target: "matches",
      metric: { label: "Active opportunities", value: numberValue(activeNeeds?.count) },
    }));
  }

  if (numberValue(activeRequests?.count) === 0 && hasPreferences) {
    actions.push(action({
      key: "publish_sponsor_request",
      score: 48,
      title: "Publish a Sponsor Request",
      reason: "Tell Organizers what kind of conference opportunity your company wants so they can approach you.",
      target: "requests",
      metric: null,
    }));
  }

  return actions.sort((a, b) => b.score - a.score).slice(0, 8);
}

export async function buildMarketplaceHealth() {
  const [
    activeInventory,
    inventoryWithViews,
    inventoryWithInquiries,
    quietInventory,
    highIntentNoInquiry,
    openInquiries,
    activeDeals,
    stalledDeals,
    settled30d,
    paidOrganizers,
    paidSponsors,
  ] = await Promise.all([
    dbGet<{ count: number }>(
      "SELECT COUNT(*) AS count FROM sponsorship_needs WHERE status='active' AND (deadline IS NULL OR deadline='' OR date(deadline)>=date('now'))"
    ),
    dbGet<{ count: number }>(
      `SELECT COUNT(DISTINCT n.id) AS count
         FROM sponsorship_needs n
         JOIN sponsorship_engagement_events e ON e.need_id=n.id AND e.event_type='listing_view'
        WHERE n.status='active' AND (n.deadline IS NULL OR n.deadline='' OR date(n.deadline)>=date('now'))`
    ),
    dbGet<{ count: number }>(
      `SELECT COUNT(DISTINCT n.id) AS count
         FROM sponsorship_needs n
         JOIN sponsorship_need_inquiries i ON i.need_id=n.id
        WHERE n.status='active' AND (n.deadline IS NULL OR n.deadline='' OR date(n.deadline)>=date('now'))`
    ),
    dbGet<{ count: number }>(
      `SELECT COUNT(*) AS count FROM (
         SELECT n.id
           FROM sponsorship_needs n
           LEFT JOIN sponsorship_engagement_events e
             ON e.need_id=n.id AND e.event_type='listing_view'
          WHERE n.status='active' AND n.created_at<=datetime('now','-7 days')
            AND (n.deadline IS NULL OR n.deadline='' OR date(n.deadline)>=date('now'))
          GROUP BY n.id
         HAVING COUNT(DISTINCT e.sponsor_id)=0
       ) q`
    ),
    dbGet<{ count: number }>(
      `SELECT COUNT(*) AS count FROM (
         SELECT n.id,
                COUNT(DISTINCT e.sponsor_id) AS viewers,
                COUNT(DISTINCT i.sponsor_id) AS inquiries
           FROM sponsorship_needs n
           LEFT JOIN sponsorship_engagement_events e
             ON e.need_id=n.id AND e.event_type='listing_view'
           LEFT JOIN sponsorship_need_inquiries i ON i.need_id=n.id
          WHERE n.status='active' AND n.created_at<=datetime('now','-7 days')
            AND (n.deadline IS NULL OR n.deadline='' OR date(n.deadline)>=date('now'))
          GROUP BY n.id
         HAVING viewers>=3 AND inquiries=0
       ) q`
    ),
    dbGet<{ count: number }>(
      "SELECT COUNT(*) AS count FROM sponsorship_need_inquiries WHERE status IN ('new','contacted','negotiating')"
    ),
    dbGet<{ count: number }>(
      "SELECT COUNT(*) AS count FROM sponsorship_deals WHERE status NOT IN ('completed','canceled')"
    ),
    dbGet<{ count: number }>(
      "SELECT COUNT(*) AS count FROM sponsorship_deals WHERE status NOT IN ('completed','canceled') AND updated_at<=datetime('now','-7 days')"
    ),
    dbGet<{ count: number }>(
      "SELECT COUNT(*) AS count FROM sponsorship_payments WHERE status='settled' AND settled_at>=datetime('now','-30 days')"
    ),
    dbGet<{ count: number }>(
      "SELECT COUNT(*) AS count FROM users WHERE role='organizer' AND subscription_status IN ('active','trialing')"
    ),
    dbGet<{ count: number }>(
      "SELECT COUNT(*) AS count FROM users WHERE role='sponsor' AND subscription_status IN ('active','trialing')"
    ),
  ]);

  const inventory = numberValue(activeInventory?.count);
  const viewed = numberValue(inventoryWithViews?.count);
  const inquired = numberValue(inventoryWithInquiries?.count);
  const activeDealCount = numberValue(activeDeals?.count);
  const stalledDealCount = numberValue(stalledDeals?.count);

  const bottlenecks: Array<{ key: string; severity: "high" | "medium" | "low"; count: number; message: string }> = [];
  const quiet = numberValue(quietInventory?.count);
  const highIntent = numberValue(highIntentNoInquiry?.count);

  if (stalledDealCount > 0) {
    bottlenecks.push({
      key: "stalled_deals",
      severity: "high",
      count: stalledDealCount,
      message: "Active Deal Rooms have had no update for at least 7 days.",
    });
  }
  if (highIntent > 0) {
    bottlenecks.push({
      key: "view_without_inquiry",
      severity: "medium",
      count: highIntent,
      message: "Opportunities have repeated Sponsor views but no inquiry.",
    });
  }
  if (quiet > 0) {
    bottlenecks.push({
      key: "no_visibility",
      severity: "medium",
      count: quiet,
      message: "Active sponsorship inventory has had no Sponsor view after 7 days.",
    });
  }

  return {
    activeInventory: inventory,
    inventoryWithViews: viewed,
    inventoryWithInquiries: inquired,
    inventoryViewCoveragePct: pct(viewed, inventory),
    inventoryInquiryCoveragePct: pct(inquired, inventory),
    quietInventory7d: quiet,
    highIntentNoInquiry: highIntent,
    openInquiries: numberValue(openInquiries?.count),
    activeDeals: activeDealCount,
    stalledDeals7d: stalledDealCount,
    stalledDealPct: pct(stalledDealCount, activeDealCount),
    settledPayments30d: numberValue(settled30d?.count),
    paidOrganizers: numberValue(paidOrganizers?.count),
    paidSponsors: numberValue(paidSponsors?.count),
    bottlenecks,
    definitions: {
      quietInventory: "active for at least 7 days with zero distinct Sponsor listing views",
      highIntentNoInquiry: "active for at least 7 days with 3+ distinct Sponsor viewers and zero inquiries",
      stalledDeal: "active Deal Room with no update for at least 7 days",
    },
  };
}

export const marketplaceIntelligenceRouter = Router();
marketplaceIntelligenceRouter.use(requireAuth);

marketplaceIntelligenceRouter.get(
  "/actions",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const requested =
      req.query.role === "organizer" || req.query.role === "sponsor"
        ? (req.query.role as PaidAccountRole)
        : undefined;
    const context = await resolvePaidAccountContext(req.userId!, requested);
    if (!context) return res.status(403).json({ error: "Organizer or Sponsor account required." });
    if (!context.paid) return res.status(402).json({ error: "Active paid workspace required." });

    const role = requested || context.effectiveRole;
    const actions =
      role === "organizer"
        ? await buildOrganizerMarketplaceActions(context.accountId)
        : await buildSponsorMarketplaceActions(context.accountId);

    res.json({
      role,
      accountId: context.accountId,
      workspaceRole: context.workspaceRole,
      actions,
      generatedAt: new Date().toISOString(),
    });
  })
);
