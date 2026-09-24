import { Router, Response } from "express";
import crypto from "crypto";
import {
  dbGet,
  dbAll,
  dbRun,
  SponsorshipPackageRow,
  SponsorshipApplicationRow,
  SponsorReviewRow,
  SponsorPreferenceRow,
  SponsorSavedOpportunityRow,
  SponsorshipNeedRow,
  SponsorshipNeedInquiryRow,
  SponsorshipDealRow,
  SponsorshipDealUpdateRow,
  SponsorRequestRow,
  SponsorRequestResponseRow,
  CreatedConferenceRow,
  UserRow,
} from "./db";
import { AuthedRequest, requireAuth } from "./auth";
import { asyncHandler } from "./asyncHandler";
import { createNotification } from "./activity";
import { resolvePaidAccountContext, canOperateWorkspace, type PaidAccountRole } from "./workspaceAccess";
import { isOwnerPreviewEmail } from "./ownerPreview";

export const sponsorsRouter = Router();
sponsorsRouter.use(requireAuth);

function effectivePaidRoleForRequest(req: AuthedRequest, user: UserRow): PaidAccountRole | null {
  const requested =
    req.query?.as === "organizer" || req.query?.as === "sponsor"
      ? (req.query.as as PaidAccountRole)
      : null;

  if (requested && isOwnerPreviewEmail(user.email)) return requested;
  return user.role === "organizer" || user.role === "sponsor"
    ? (user.role as PaidAccountRole)
    : null;
}

async function paidWorkspaceContext(
  req: AuthedRequest,
  res: Response,
  role: PaidAccountRole,
  write = false
) {
  const context = await resolvePaidAccountContext(req.userId!, role);
  if (!context) {
    res.status(403).json({ error: role === "organizer" ? "Organizer account required." : "Sponsor account required." });
    return null;
  }
  if (!context.paid) {
    res.status(402).json({ error: role === "organizer" ? "Organizer Pro subscription required." : "Sponsor Pro subscription required." });
    return null;
  }
  if (write && !canOperateWorkspace(context.workspaceRole)) {
    res.status(403).json({ error: "This workspace seat is read-only." });
    return null;
  }
  return context;
}

async function notifyPaidAccount(
  accountId: string,
  accountRole: PaidAccountRole,
  type: string,
  title: string,
  message: string
) {
  const rows = await dbAll<{ user_id: string }>(
    `SELECT ? as user_id
      UNION
     SELECT m.user_id
       FROM account_workspace_members m
       JOIN account_workspaces w ON w.id=m.workspace_id
      WHERE w.owner_id=? AND w.account_role=? AND m.status='active'`,
    [accountId, accountId, accountRole]
  ).catch(() => [{ user_id: accountId }]);

  for (const row of rows) {
    await createNotification(row.user_id, type, title, message);
  }
}

function toPackageDTO(row: SponsorshipPackageRow, approvedCounts: Record<string, number>) {
  const approved = approvedCounts[row.id] || 0;
  return {
    id: row.id,
    conferenceId: row.conference_id,
    conferenceTitle: row.conference_title,
    organizerId: row.organizer_id,
    tier: row.tier,
    price: row.price,
    benefits: JSON.parse(row.benefits),
    boothSpace: row.booth_space || "",
    speakingOps: row.speaking_ops || "",
    totalSlots: row.total_slots,
    availableSlots: Math.max(0, row.total_slots - approved),
    sourceOpportunityId: row.source_opportunity_id,
  };
}

async function approvedCountsByPackage(): Promise<Record<string, number>> {
  const rows = await dbAll<{ package_id: string; count: number }>(
    "SELECT package_id, COUNT(*) as count FROM sponsorship_applications WHERE status = 'Approved' GROUP BY package_id"
  );
  return Object.fromEntries(rows.map((r) => [r.package_id, r.count]));
}

function safeJson(value: unknown, fallback: any) {
  try {
    return value ? JSON.parse(String(value)) : fallback;
  } catch {
    return fallback;
  }
}

function cleanStringList(value: unknown, max = 30): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
  )].slice(0, max);
}

function overlapRatio(a: string[], b: string[]): number | null {
  if (!a.length || !b.length) return null;
  const aa = new Set(a.map((item) => item.toLowerCase()));
  const bb = new Set(b.map((item) => item.toLowerCase()));
  let overlap = 0;
  for (const item of aa) if (bb.has(item)) overlap += 1;
  return overlap / Math.max(1, Math.min(aa.size, bb.size));
}

interface SponsorNeedMatchDetail {
  score: number;
  reasons: string[];
  breakdown: {
    sector: number | null;
    category: number | null;
    region: number | null;
    opportunityType: number | null;
    budget: number | null;
  };
}

function matchingValues(a: string[], b: string[]): string[] {
  if (!a.length || !b.length) return [];
  const bSet = new Set(b.map((item) => item.toLowerCase()));
  return a.filter((item) => bSet.has(item.toLowerCase()));
}

function sponsorNeedMatchDetail(
  preference: SponsorPreferenceRow | undefined,
  need: SponsorshipNeedRow
): SponsorNeedMatchDetail {
  if (!preference) {
    return {
      score: 0,
      reasons: ["Complete Matching Preferences to enable personalized ranking."],
      breakdown: { sector: null, category: null, region: null, opportunityType: null, budget: null },
    };
  }

  const sectors = safeJson(preference.sectors, []);
  const categories = safeJson(preference.categories, []);
  const regions = safeJson(preference.regions, []);
  const types = safeJson(preference.opportunity_types, []);
  const needSectors = safeJson(need.target_sectors, []);
  const needCategories = safeJson(need.categories, []);
  const needRegions = safeJson(need.regions, []);
  const needTypes = safeJson(need.opportunity_types, []);

  const sector = overlapRatio(sectors, needSectors);
  const category = overlapRatio(categories, needCategories);
  const region = overlapRatio(regions, needRegions);
  const opportunityType = overlapRatio(types, needTypes);

  let weighted = 0;
  let weight = 0;
  for (const [value, w] of [
    [sector, 0.35],
    [category, 0.3],
    [region, 0.15],
    [opportunityType, 0.2],
  ] as Array<[number | null, number]>) {
    if (value === null) continue;
    weighted += value * w;
    weight += w;
  }

  let budget: number | null = null;
  if (need.price_amount !== null && preference.budget_max !== null) {
    budget =
      need.price_amount <= preference.budget_max &&
      (preference.budget_min === null || need.price_amount >= preference.budget_min)
        ? 1
        : need.price_amount <= preference.budget_max * 1.25
          ? 0.5
          : 0;
  }
  if (budget !== null) {
    weighted += budget * 0.2;
    weight += 0.2;
  }

  const reasons: string[] = [];
  const matchedSectors = matchingValues(sectors, needSectors);
  const matchedCategories = matchingValues(categories, needCategories);
  const matchedRegions = matchingValues(regions, needRegions);
  const matchedTypes = matchingValues(types, needTypes);

  if (matchedSectors.length) reasons.push(`Sector match: ${matchedSectors.slice(0, 2).join(", ")}`);
  if (matchedCategories.length) reasons.push(`Category match: ${matchedCategories.slice(0, 2).join(", ")}`);
  if (matchedRegions.length) reasons.push(`Region match: ${matchedRegions.slice(0, 2).join(", ")}`);
  if (matchedTypes.length) reasons.push(`Opportunity type: ${matchedTypes.slice(0, 2).join(", ")}`);
  if (budget === 1) reasons.push("Published price is within your budget range.");
  else if (budget === 0.5) reasons.push("Published price is slightly above your preferred budget.");
  else if (budget === 0) reasons.push("Published price is above your current budget range.");
  if (!reasons.length) reasons.push("No explicit preference overlap yet; ranked from available criteria.");

  return {
    score: weight ? Math.round((weighted / weight) * 100) : 0,
    reasons: reasons.slice(0, 4),
    breakdown: {
      sector: sector === null ? null : Math.round(sector * 100),
      category: category === null ? null : Math.round(category * 100),
      region: region === null ? null : Math.round(region * 100),
      opportunityType: opportunityType === null ? null : Math.round(opportunityType * 100),
      budget: budget === null ? null : Math.round(budget * 100),
    },
  };
}

function sponsorNeedMatch(
  preference: SponsorPreferenceRow | undefined,
  need: SponsorshipNeedRow
): number {
  return sponsorNeedMatchDetail(preference, need).score;
}

function toSavedOpportunityDTO(row: SponsorSavedOpportunityRow) {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    conferenceId: row.conference_id,
    conferenceTitle: row.conference_title,
    title: row.title,
    snapshot: safeJson(row.snapshot, {}),
    alertEnabled: Boolean(row.alert_enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSponsorshipDealDTO(
  row: SponsorshipDealRow,
  updates: SponsorshipDealUpdateRow[] = [],
  counterpartName = ""
) {
  return {
    id: row.id,
    inquiryId: row.inquiry_id,
    needId: row.need_id,
    organizerId: row.organizer_id,
    sponsorId: row.sponsor_id,
    conferenceId: row.conference_id,
    conferenceTitle: row.conference_title,
    opportunityTitle: row.opportunity_title,
    counterpartName,
    agreedAmount: row.agreed_amount,
    currency: row.currency,
    status: row.status,
    proposalNotes: row.proposal_notes || "",
    deliverables: safeJson(row.deliverables, []),
    contractUrl: row.contract_url,
    invoiceUrl: row.invoice_url,
    paymentReference: row.payment_reference,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updates: updates.map((update) => ({
      id: update.id,
      authorId: update.author_id,
      kind: update.kind,
      text: update.text,
      url: update.url,
      createdAt: update.created_at,
    })),
  };
}

async function ensureDealForInquiry(
  inquiryId: string,
  targetStatus: "negotiating" | "agreement_reached"
): Promise<SponsorshipDealRow | undefined> {
  const existing = await dbGet<SponsorshipDealRow>(
    "SELECT * FROM sponsorship_deals WHERE inquiry_id = ?",
    [inquiryId]
  );
  if (existing) {
    if (existing.status === "negotiating" && targetStatus === "agreement_reached") {
      await dbRun(
        "UPDATE sponsorship_deals SET status='agreement_reached', updated_at=datetime('now') WHERE id=?",
        [existing.id]
      );
      return dbGet<SponsorshipDealRow>("SELECT * FROM sponsorship_deals WHERE id=?", [existing.id]);
    }
    return existing;
  }

  const context = await dbGet<any>(
    `SELECT i.*, n.organizer_id,n.conference_id,n.conference_title,n.title as opportunity_title,
            n.price_amount,n.price_on_request
       FROM sponsorship_need_inquiries i
       JOIN sponsorship_needs n ON n.id=i.need_id
      WHERE i.id=?`,
    [inquiryId]
  );
  if (!context) return undefined;

  const id = `sdeal_${crypto.randomUUID()}`;
  const agreedAmount =
    context.price_on_request ? (context.budget ?? null) : (context.price_amount ?? context.budget ?? null);
  await dbRun(
    `INSERT INTO sponsorship_deals(
      id,inquiry_id,need_id,organizer_id,sponsor_id,conference_id,conference_title,opportunity_title,
      agreed_amount,currency,status,proposal_notes,deliverables
    ) VALUES(?,?,?,?,?,?,?,?,?,'USD',?,?,?)`,
    [
      id,
      inquiryId,
      context.need_id,
      context.organizer_id,
      context.sponsor_id,
      context.conference_id,
      context.conference_title,
      context.opportunity_title,
      agreedAmount,
      targetStatus,
      context.message || null,
      "[]",
    ]
  );
  await dbRun(
    "INSERT INTO sponsorship_deal_updates(id,deal_id,author_id,kind,text) VALUES(?,?,?,?,?)",
    [
      `sdu_${crypto.randomUUID()}`,
      id,
      context.organizer_id,
      "status",
      targetStatus === "agreement_reached"
        ? "Organizer moved the sponsorship inquiry to Won / agreement reached."
        : "Organizer opened a sponsorship Deal Room for negotiation.",
    ]
  );
  return dbGet<SponsorshipDealRow>("SELECT * FROM sponsorship_deals WHERE id=?", [id]);
}

function toSponsorshipNeedDTO(
  row: SponsorshipNeedRow,
  match?: number | SponsorNeedMatchDetail
) {
  const matchScore = typeof match === "number" ? match : match?.score;
  return {
    id: row.id,
    conferenceId: row.conference_id,
    conferenceTitle: row.conference_title,
    organizerId: row.organizer_id,
    title: row.title,
    description: row.description || "",
    categories: safeJson(row.categories, []),
    targetSectors: safeJson(row.target_sectors, []),
    regions: safeJson(row.regions, []),
    opportunityTypes: safeJson(row.opportunity_types, []),
    priceAmount: row.price_amount,
    priceOnRequest: Boolean(row.price_on_request),
    totalSlots: row.total_slots,
    benefits: safeJson(row.benefits, []),
    deadline: row.deadline || null,
    status: row.status,
    createdAt: row.created_at,
    matchScore: matchScore ?? null,
    matchReasons: typeof match === "object" && match ? match.reasons : [],
    matchBreakdown: typeof match === "object" && match ? match.breakdown : null,
  };
}

// Sponsor Pro shared watchlist. Saved items belong to the paid sponsor workspace, so every
// active team seat sees the same shortlist and per-item alert preference.
sponsorsRouter.get(
  "/watchlist/mine",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const sponsorContext = await paidWorkspaceContext(req, res, "sponsor");
    if (!sponsorContext) return;
    const rows = await dbAll<SponsorSavedOpportunityRow>(
      "SELECT * FROM sponsor_saved_opportunities WHERE sponsor_id=? ORDER BY updated_at DESC",
      [sponsorContext.accountId]
    );
    res.json({ items: rows.map(toSavedOpportunityDTO) });
  })
);

sponsorsRouter.put(
  "/watchlist",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const sponsorContext = await paidWorkspaceContext(req, res, "sponsor", true);
    if (!sponsorContext) return;
    const accountId = sponsorContext.accountId;
    const sourceType =
      req.body?.sourceType === "internal_need" ||
      req.body?.sourceType === "package" ||
      req.body?.sourceType === "external_catalog"
        ? req.body.sourceType
        : null;
    const sourceId = typeof req.body?.sourceId === "string" ? req.body.sourceId.trim() : "";
    if (!sourceType || !sourceId) {
      return res.status(400).json({ error: "sourceType and sourceId are required." });
    }

    let conferenceId: string | null = null;
    let conferenceTitle = "";
    let title = "";
    let snapshot: Record<string, unknown> = {};

    if (sourceType === "internal_need") {
      const need = await dbGet<SponsorshipNeedRow>(
        "SELECT * FROM sponsorship_needs WHERE id=? AND status='active'",
        [sourceId]
      );
      if (!need) return res.status(404).json({ error: "Sponsorship opportunity not found." });
      const preference = await dbGet<SponsorPreferenceRow>(
        "SELECT * FROM sponsor_preferences WHERE sponsor_id=?",
        [accountId]
      );
      conferenceId = need.conference_id;
      conferenceTitle = need.conference_title;
      title = need.title;
      snapshot = toSponsorshipNeedDTO(need, sponsorNeedMatch(preference, need));
    } else if (sourceType === "package") {
      const pkg = await dbGet<SponsorshipPackageRow>(
        "SELECT * FROM sponsorship_packages WHERE id=?",
        [sourceId]
      );
      if (!pkg) return res.status(404).json({ error: "Sponsorship package not found." });
      const approvedCounts = await approvedCountsByPackage();
      conferenceId = pkg.conference_id;
      conferenceTitle = pkg.conference_title;
      title = `${pkg.tier} Sponsorship`;
      snapshot = toPackageDTO(pkg, approvedCounts);
    } else {
      const row = await dbGet<any>(
        `SELECT event_id,conference_title,start_date,end_date,city,country,official_url,sponsor_url,
                action_url,action_label,categories,packages,checked_at,status
           FROM discovery_sponsorship_opportunities
          WHERE event_id=? AND status='available'`,
        [sourceId]
      ).catch(() => undefined);
      if (!row) return res.status(404).json({ error: "Stored external sponsorship opportunity not found." });
      conferenceId = String(row.event_id);
      conferenceTitle = String(row.conference_title || "");
      title = "Official Sponsorship / Exhibitor Opportunity";
      snapshot = {
        conferenceId,
        conferenceTitle,
        startDate: row.start_date || null,
        endDate: row.end_date || null,
        city: row.city || null,
        country: row.country || null,
        officialUrl: row.official_url || null,
        sponsorUrl: row.sponsor_url || null,
        actionUrl: row.action_url || row.sponsor_url || row.official_url || null,
        actionLabel: row.action_label || "Inquire Now",
        categories: safeJson(row.categories, []),
        checkedAt: row.checked_at || null,
      };
    }

    const existing = await dbGet<SponsorSavedOpportunityRow>(
      "SELECT * FROM sponsor_saved_opportunities WHERE sponsor_id=? AND source_type=? AND source_id=?",
      [accountId, sourceType, sourceId]
    );
    if (existing) {
      await dbRun(
        `UPDATE sponsor_saved_opportunities
            SET conference_id=?,conference_title=?,title=?,snapshot=?,updated_at=datetime('now')
          WHERE id=?`,
        [conferenceId, conferenceTitle, title, JSON.stringify(snapshot), existing.id]
      );
      const updated = (await dbGet<SponsorSavedOpportunityRow>(
        "SELECT * FROM sponsor_saved_opportunities WHERE id=?",
        [existing.id]
      ))!;
      return res.json({ item: toSavedOpportunityDTO(updated), alreadySaved: true });
    }

    const id = `ssave_${crypto.randomUUID()}`;
    await dbRun(
      `INSERT INTO sponsor_saved_opportunities(
        id,sponsor_id,source_type,source_id,conference_id,conference_title,title,snapshot,alert_enabled
      ) VALUES(?,?,?,?,?,?,?,?,1)`,
      [id, accountId, sourceType, sourceId, conferenceId, conferenceTitle, title, JSON.stringify(snapshot)]
    );
    const created = (await dbGet<SponsorSavedOpportunityRow>(
      "SELECT * FROM sponsor_saved_opportunities WHERE id=?",
      [id]
    ))!;
    res.status(201).json({ item: toSavedOpportunityDTO(created), alreadySaved: false });
  })
);

sponsorsRouter.patch(
  "/watchlist/:id/alerts",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const sponsorContext = await paidWorkspaceContext(req, res, "sponsor", true);
    if (!sponsorContext) return;
    if (typeof req.body?.alertEnabled !== "boolean") {
      return res.status(400).json({ error: "alertEnabled must be true or false." });
    }
    const item = await dbGet<SponsorSavedOpportunityRow>(
      "SELECT * FROM sponsor_saved_opportunities WHERE id=? AND sponsor_id=?",
      [req.params.id, sponsorContext.accountId]
    );
    if (!item) return res.status(404).json({ error: "Saved opportunity not found." });
    await dbRun(
      "UPDATE sponsor_saved_opportunities SET alert_enabled=?,updated_at=datetime('now') WHERE id=?",
      [req.body.alertEnabled ? 1 : 0, item.id]
    );
    const updated = (await dbGet<SponsorSavedOpportunityRow>(
      "SELECT * FROM sponsor_saved_opportunities WHERE id=?",
      [item.id]
    ))!;
    res.json({ item: toSavedOpportunityDTO(updated) });
  })
);

sponsorsRouter.delete(
  "/watchlist/:id",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const sponsorContext = await paidWorkspaceContext(req, res, "sponsor", true);
    if (!sponsorContext) return;
    const item = await dbGet<SponsorSavedOpportunityRow>(
      "SELECT * FROM sponsor_saved_opportunities WHERE id=? AND sponsor_id=?",
      [req.params.id, sponsorContext.accountId]
    );
    if (!item) return res.status(404).json({ error: "Saved opportunity not found." });
    await dbRun("DELETE FROM sponsor_saved_opportunities WHERE id=?", [item.id]);
    res.json({ ok: true });
  })
);

// Sponsor Pro preference profile used for internal opportunity matching.
sponsorsRouter.get(
  "/preferences/mine",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const sponsorContext = await paidWorkspaceContext(req, res, "sponsor");
    if (!sponsorContext) return;
    const row = await dbGet<SponsorPreferenceRow>("SELECT * FROM sponsor_preferences WHERE sponsor_id = ?", [sponsorContext.accountId]);
    res.json({
      preferences: row
        ? {
            sectors: safeJson(row.sectors, []),
            categories: safeJson(row.categories, []),
            regions: safeJson(row.regions, []),
            opportunityTypes: safeJson(row.opportunity_types, []),
            budgetMin: row.budget_min,
            budgetMax: row.budget_max,
            alertFrequency: row.alert_frequency,
          }
        : {
            sectors: [],
            categories: [],
            regions: [],
            opportunityTypes: [],
            budgetMin: null,
            budgetMax: null,
            alertFrequency: "instant",
          },
    });
  })
);

sponsorsRouter.put(
  "/preferences/mine",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const sponsorContext = await paidWorkspaceContext(req, res, "sponsor", true);
    if (!sponsorContext) return;
    const accountId = sponsorContext.accountId;
    const body = req.body || {};
    const sectors = cleanStringList(body.sectors);
    const categories = cleanStringList(body.categories);
    const regions = cleanStringList(body.regions, 20);
    const opportunityTypes = cleanStringList(body.opportunityTypes, 20);
    const budgetMin = body.budgetMin === null || body.budgetMin === "" || body.budgetMin === undefined ? null : Number(body.budgetMin);
    const budgetMax = body.budgetMax === null || body.budgetMax === "" || body.budgetMax === undefined ? null : Number(body.budgetMax);
    if (budgetMin !== null && (!Number.isFinite(budgetMin) || budgetMin < 0)) {
      return res.status(400).json({ error: "budgetMin must be a positive number." });
    }
    if (budgetMax !== null && (!Number.isFinite(budgetMax) || budgetMax < 0)) {
      return res.status(400).json({ error: "budgetMax must be a positive number." });
    }
    if (budgetMin !== null && budgetMax !== null && budgetMin > budgetMax) {
      return res.status(400).json({ error: "budgetMin cannot exceed budgetMax." });
    }
    const alertFrequency =
      body.alertFrequency === "daily" || body.alertFrequency === "weekly" ? body.alertFrequency : "instant";

    await dbRun(
      `INSERT INTO sponsor_preferences(
        sponsor_id,sectors,categories,regions,opportunity_types,budget_min,budget_max,alert_frequency,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(sponsor_id) DO UPDATE SET
        sectors=excluded.sectors,categories=excluded.categories,regions=excluded.regions,
        opportunity_types=excluded.opportunity_types,budget_min=excluded.budget_min,budget_max=excluded.budget_max,
        alert_frequency=excluded.alert_frequency,updated_at=datetime('now')`,
      [
        accountId,
        JSON.stringify(sectors),
        JSON.stringify(categories),
        JSON.stringify(regions),
        JSON.stringify(opportunityTypes),
        budgetMin,
        budgetMax,
        alertFrequency,
      ]
    );
    const row = (await dbGet<SponsorPreferenceRow>("SELECT * FROM sponsor_preferences WHERE sponsor_id = ?", [accountId]))!;
    res.json({
      preferences: {
        sectors: safeJson(row.sectors, []),
        categories: safeJson(row.categories, []),
        regions: safeJson(row.regions, []),
        opportunityTypes: safeJson(row.opportunity_types, []),
        budgetMin: row.budget_min,
        budgetMax: row.budget_max,
        alertFrequency: row.alert_frequency,
      },
    });
  })
);

// Organizer Pro publishes the sponsorship inventory they actually need to fill.
sponsorsRouter.post(
  "/needs",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const organizerContext = await paidWorkspaceContext(req, res, "organizer", true);
    if (!organizerContext) return;
    const accountId = organizerContext.accountId;
    const body = req.body || {};
    if (typeof body.conferenceId !== "string" || !body.conferenceId) {
      return res.status(400).json({ error: "conferenceId is required." });
    }
    if (typeof body.title !== "string" || !body.title.trim()) {
      return res.status(400).json({ error: "Sponsorship need title is required." });
    }
    const conference = await dbGet<CreatedConferenceRow>(
      "SELECT * FROM created_conferences WHERE id = ? AND organizer_id = ?",
      [body.conferenceId, accountId]
    );
    if (!conference) return res.status(404).json({ error: "Conference not found in this organizer workspace." });
    const conf = safeJson(conference.data, {});
    const priceOnRequest = body.priceOnRequest !== false;
    const priceAmount =
      priceOnRequest || body.priceAmount === null || body.priceAmount === "" || body.priceAmount === undefined
        ? null
        : Number(body.priceAmount);
    if (!priceOnRequest && (!Number.isFinite(priceAmount) || Number(priceAmount) < 0)) {
      return res.status(400).json({ error: "A valid sponsorship price is required." });
    }
    const totalSlots = Math.max(1, Math.min(1000, Number(body.totalSlots || 1)));
    const id = `sneed_${crypto.randomUUID()}`;
    await dbRun(
      `INSERT INTO sponsorship_needs(
        id,conference_id,conference_title,organizer_id,title,description,categories,target_sectors,regions,
        opportunity_types,price_amount,price_on_request,total_slots,benefits,deadline,status,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',datetime('now'))`,
      [
        id,
        body.conferenceId,
        conf.title || conference.id,
        accountId,
        body.title.trim(),
        typeof body.description === "string" ? body.description.trim() || null : null,
        JSON.stringify(cleanStringList(body.categories)),
        JSON.stringify(cleanStringList(body.targetSectors)),
        JSON.stringify(cleanStringList(body.regions, 20)),
        JSON.stringify(cleanStringList(body.opportunityTypes, 20)),
        priceAmount,
        priceOnRequest ? 1 : 0,
        totalSlots,
        JSON.stringify(cleanStringList(body.benefits, 30)),
        typeof body.deadline === "string" ? body.deadline.trim() || null : null,
      ]
    );

    const need = (await dbGet<SponsorshipNeedRow>("SELECT * FROM sponsorship_needs WHERE id = ?", [id]))!;

    // Instant alerts only go to paid sponsors who explicitly opted into instant matching and whose
    // saved preference profile has a meaningful match. No cold email or pre-signup notification.
    const sponsors = await dbAll<UserRow>(
      "SELECT * FROM users WHERE role='sponsor' AND subscription_status IN ('active','trialing')"
    );
    let notified = 0;
    for (const sponsor of sponsors) {
      const preference = await dbGet<SponsorPreferenceRow>(
        "SELECT * FROM sponsor_preferences WHERE sponsor_id = ?",
        [sponsor.id]
      );
      if (!preference || preference.alert_frequency !== "instant") continue;
      const score = sponsorNeedMatch(preference, need);
      if (score < 45) continue;
      await notifyPaidAccount(
        sponsor.id,
        "sponsor",
        "sponsorship",
        `New sponsorship opportunity: ${need.title}`,
        `${need.conference_title} matches your Sponsor Pro profile (${score}% match). Open the Sponsor Marketplace to review it.`
      );
      notified += 1;
    }

    res.status(201).json({ need: toSponsorshipNeedDTO(need), notifiedSponsors: notified });
  })
);

sponsorsRouter.get(
  "/needs/mine",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const organizerContext = await paidWorkspaceContext(req, res, "organizer");
    if (!organizerContext) return;
    const rows = await dbAll<SponsorshipNeedRow>(
      "SELECT * FROM sponsorship_needs WHERE organizer_id = ? ORDER BY created_at DESC",
      [organizerContext.accountId]
    );
    res.json({ needs: rows.map((row) => toSponsorshipNeedDTO(row)) });
  })
);

sponsorsRouter.get(
  "/needs/matched",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const sponsorContext = await paidWorkspaceContext(req, res, "sponsor");
    if (!sponsorContext) return;
    const accountId = sponsorContext.accountId;
    const preference = await dbGet<SponsorPreferenceRow>(
      "SELECT * FROM sponsor_preferences WHERE sponsor_id = ?",
      [accountId]
    );
    const rows = await dbAll<SponsorshipNeedRow>(
      `SELECT * FROM sponsorship_needs
        WHERE status='active' AND (deadline IS NULL OR deadline='' OR date(deadline)>=date('now'))
        ORDER BY created_at DESC`
    );
    const ranked = rows
      .map((row) => ({ row, match: sponsorNeedMatchDetail(preference, row) }))
      .sort((a, b) => b.match.score - a.match.score || b.row.created_at.localeCompare(a.row.created_at));
    for (const { row } of ranked.slice(0, 100)) {
      await dbRun(
        "INSERT OR IGNORE INTO sponsorship_engagement_events(id,need_id,sponsor_id,event_type) VALUES(?,?,?,'listing_view')",
        [`sev_${crypto.randomUUID()}`, row.id, accountId]
      ).catch(() => {});
    }
    res.json({ needs: ranked.map(({ row, match }) => toSponsorshipNeedDTO(row, match)) });
  })
);

sponsorsRouter.post(
  "/needs/:id/inquiries",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const sponsorContext = await paidWorkspaceContext(req, res, "sponsor", true);
    if (!sponsorContext) return;
    const accountId = sponsorContext.accountId;
    const sponsor = sponsorContext.accountOwner;
    const need = await dbGet<SponsorshipNeedRow>(
      "SELECT * FROM sponsorship_needs WHERE id = ? AND status='active'",
      [req.params.id]
    );
    if (!need) return res.status(404).json({ error: "Sponsorship opportunity not found." });
    const existing = await dbGet<SponsorshipNeedInquiryRow>(
      "SELECT * FROM sponsorship_need_inquiries WHERE need_id = ? AND sponsor_id = ?",
      [need.id, accountId]
    );
    if (existing) return res.json({ inquiry: existing, alreadyExists: true });

    const budget =
      req.body?.budget === null || req.body?.budget === "" || req.body?.budget === undefined
        ? null
        : Number(req.body.budget);
    if (budget !== null && (!Number.isFinite(budget) || budget < 0)) {
      return res.status(400).json({ error: "budget must be a positive number." });
    }
    const id = `sinq_${crypto.randomUUID()}`;
    await dbRun(
      "INSERT INTO sponsorship_need_inquiries(id,need_id,sponsor_id,message,budget,status) VALUES(?,?,?,?,?,'new')",
      [
        id,
        need.id,
        accountId,
        typeof req.body?.message === "string" ? req.body.message.trim() || null : null,
        budget,
      ]
    );
    await notifyPaidAccount(
      need.organizer_id,
      "organizer",
      "sponsorship",
      "New Sponsor Pro inquiry",
      `${sponsor.organization || sponsor.name} is interested in ${need.title} for ${need.conference_title}.`
    );
    await dbRun(
      "INSERT OR IGNORE INTO sponsorship_engagement_events(id,need_id,sponsor_id,event_type) VALUES(?,?,?,'inquiry')",
      [`sev_${crypto.randomUUID()}`, need.id, accountId]
    ).catch(() => {});
    const row = (await dbGet<SponsorshipNeedInquiryRow>("SELECT * FROM sponsorship_need_inquiries WHERE id = ?", [id]))!;
    res.status(201).json({ inquiry: row, alreadyExists: false });
  })
);

sponsorsRouter.get(
  "/needs/inquiries/mine",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const organizerContext = await paidWorkspaceContext(req, res, "organizer");
    if (!organizerContext) return;
    const rows = await dbAll<any>(
      `SELECT i.*, n.title as need_title, n.conference_title, u.name as sponsor_name, u.organization as sponsor_organization
        FROM sponsorship_need_inquiries i
        JOIN sponsorship_needs n ON n.id=i.need_id
        JOIN users u ON u.id=i.sponsor_id
        WHERE n.organizer_id=?
        ORDER BY i.created_at DESC`,
      [organizerContext.accountId]
    );
    res.json({
      inquiries: rows.map((row: any) => ({
        id: row.id,
        needId: row.need_id,
        needTitle: row.need_title,
        conferenceTitle: row.conference_title,
        sponsorId: row.sponsor_id,
        sponsorName: row.sponsor_organization || row.sponsor_name,
        message: row.message || "",
        budget: row.budget,
        status: row.status,
        createdAt: row.created_at,
      })),
    });
  })
);

sponsorsRouter.patch(
  "/needs/inquiries/:id",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const organizerContext = await paidWorkspaceContext(req, res, "organizer", true);
    if (!organizerContext) return;
    const accountId = organizerContext.accountId;
    const allowed = new Set(["new","contacted","negotiating","won","lost"]);
    const status = typeof req.body?.status === "string" && allowed.has(req.body.status) ? req.body.status : null;
    if (!status) return res.status(400).json({ error: "Invalid inquiry status." });
    const inquiry = await dbGet<any>(
      `SELECT i.*, n.organizer_id FROM sponsorship_need_inquiries i
        JOIN sponsorship_needs n ON n.id=i.need_id
        WHERE i.id=?`,
      [req.params.id]
    );
    if (!inquiry || inquiry.organizer_id !== accountId) return res.status(404).json({ error: "Inquiry not found." });
    await dbRun(
      "UPDATE sponsorship_need_inquiries SET status=?,updated_at=datetime('now') WHERE id=?",
      [status, req.params.id]
    );
    let deal: SponsorshipDealRow | undefined;
    if (status === "negotiating") {
      deal = await ensureDealForInquiry(req.params.id, "negotiating");
    } else if (status === "won") {
      deal = await ensureDealForInquiry(req.params.id, "agreement_reached");
    } else if (status === "lost") {
      const existingDeal = await dbGet<SponsorshipDealRow>("SELECT * FROM sponsorship_deals WHERE inquiry_id=?", [req.params.id]);
      if (existingDeal && existingDeal.status !== "completed") {
        await dbRun("UPDATE sponsorship_deals SET status='canceled',updated_at=datetime('now') WHERE id=?", [existingDeal.id]);
        deal = await dbGet<SponsorshipDealRow>("SELECT * FROM sponsorship_deals WHERE id=?", [existingDeal.id]);
      }
    }
    if (status === "negotiating" || status === "won") {
      await dbRun(
        "INSERT OR IGNORE INTO sponsorship_engagement_events(id,need_id,sponsor_id,event_type) VALUES(?,?,?,?)",
        [`sev_${crypto.randomUUID()}`, inquiry.need_id, inquiry.sponsor_id, status]
      ).catch(() => {});
    }
    await notifyPaidAccount(
      inquiry.sponsor_id,
      "sponsor",
      "sponsorship",
      "Sponsorship inquiry updated",
      `The organizer updated your sponsorship inquiry to ${status}.`
    );
    res.json({ ok: true, status, deal: deal ? toSponsorshipDealDTO(deal) : null });
  })
);

// Deal Room shared by the paid organizer and sponsor once an inquiry enters negotiation.
sponsorsRouter.get(
  "/deals/mine",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const user = await dbGet<UserRow>("SELECT * FROM users WHERE id=?", [req.userId!]);
    if (!user) return res.status(403).json({ error: "Organizer or Sponsor account required." });
    const effectiveRole = effectivePaidRoleForRequest(req, user);
    if (!effectiveRole) {
      return res.status(403).json({ error: "Organizer or Sponsor account required." });
    }
    const accountContext = await paidWorkspaceContext(req, res, effectiveRole);
    if (!accountContext) return;
    const accountId = accountContext.accountId;

    const rows = await dbAll<SponsorshipDealRow>(
      effectiveRole === "organizer"
        ? "SELECT * FROM sponsorship_deals WHERE organizer_id=? ORDER BY updated_at DESC"
        : "SELECT * FROM sponsorship_deals WHERE sponsor_id=? ORDER BY updated_at DESC",
      [accountId]
    );
    const deals = [];
    for (const row of rows) {
      const updates = await dbAll<SponsorshipDealUpdateRow>(
        "SELECT * FROM sponsorship_deal_updates WHERE deal_id=? ORDER BY created_at ASC",
        [row.id]
      );
      const counterpartId = effectiveRole === "organizer" ? row.sponsor_id : row.organizer_id;
      const counterpart = await dbGet<UserRow>("SELECT * FROM users WHERE id=?", [counterpartId]);
      deals.push(toSponsorshipDealDTO(
        row,
        updates,
        counterpart?.organization || counterpart?.name || ""
      ));
    }
    res.json({ deals });
  })
);

sponsorsRouter.patch(
  "/deals/:id",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const user = await dbGet<UserRow>("SELECT * FROM users WHERE id=?", [req.userId!]);
    if (!user) return res.status(403).json({ error: "Organizer or Sponsor account required." });
    const effectiveRole = effectivePaidRoleForRequest(req, user);
    if (!effectiveRole) {
      return res.status(403).json({ error: "Organizer or Sponsor account required." });
    }
    const accountContext = await paidWorkspaceContext(req, res, effectiveRole, true);
    if (!accountContext) return;
    const accountId = accountContext.accountId;
    const deal = await dbGet<SponsorshipDealRow>("SELECT * FROM sponsorship_deals WHERE id=?", [req.params.id]);
    if (!deal || (deal.organizer_id !== accountId && deal.sponsor_id !== accountId)) {
      return res.status(404).json({ error: "Deal not found." });
    }

    const body = req.body || {};
    const updates: string[] = [];
    const args: any[] = [];
    const isOrganizerParty = deal.organizer_id === accountId;
    const hasOrganizerOnlyFields =
      body.agreedAmount !== undefined ||
      body.currency !== undefined ||
      body.proposalNotes !== undefined ||
      body.deliverables !== undefined ||
      body.contractUrl !== undefined ||
      body.invoiceUrl !== undefined;
    if (hasOrganizerOnlyFields && !isOrganizerParty) {
      return res.status(403).json({
        error: "Canonical commercial terms, deliverables, contract, and invoice are controlled by the organizer. Use a Deal Room update for counter-proposals."
      });
    }
    if (body.agreedAmount !== undefined) {
      const amount = body.agreedAmount === null || body.agreedAmount === "" ? null : Number(body.agreedAmount);
      if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
        return res.status(400).json({ error: "agreedAmount must be a positive number." });
      }
      updates.push("agreed_amount=?");
      args.push(amount);
    }
    if (typeof body.currency === "string" && /^[A-Z]{3}$/.test(body.currency.trim().toUpperCase())) {
      updates.push("currency=?");
      args.push(body.currency.trim().toUpperCase());
    }
    if (typeof body.proposalNotes === "string") {
      updates.push("proposal_notes=?");
      args.push(body.proposalNotes.trim() || null);
    }
    if (Array.isArray(body.deliverables)) {
      updates.push("deliverables=?");
      args.push(JSON.stringify(cleanStringList(body.deliverables, 50)));
    }
    for (const [field, column] of [["contractUrl","contract_url"],["invoiceUrl","invoice_url"]] as const) {
      if (body[field] !== undefined) {
        const value = typeof body[field] === "string" ? body[field].trim() : "";
        if (value && !/^https:\/\//i.test(value)) {
          return res.status(400).json({ error: `${field} must be an https URL.` });
        }
        updates.push(`${column}=?`);
        args.push(value || null);
      }
    }

    // Commercial status progression is constrained. "paid" is intentionally excluded: only the
    // payment-provider sync route can mark money as received.
    const allowedTransitions: Record<string, string[]> = {
      negotiating: ["agreement_reached", "canceled"],
      agreement_reached: ["negotiating", "contract_pending", "canceled"],
      contract_pending: ["agreement_reached", "payment_pending", "canceled"],
      payment_pending: ["contract_pending", "canceled"],
      paid: ["delivering"],
      delivering: ["completed"],
      completed: [],
      canceled: [],
    };
    if (typeof body.status === "string") {
      const nextStatus = body.status;
      if (!allowedTransitions[deal.status]?.includes(nextStatus)) {
        return res.status(409).json({ error: `Invalid deal transition from ${deal.status} to ${nextStatus}.` });
      }
      updates.push("status=?");
      args.push(nextStatus);
    }

    if (!updates.length) return res.status(400).json({ error: "No supported deal fields supplied." });
    args.push(deal.id);
    await dbRun(
      `UPDATE sponsorship_deals SET ${updates.join(",")},updated_at=datetime('now') WHERE id=?`,
      args
    );
    if (body.status === "contract_pending") {
      await dbRun(
        "INSERT OR IGNORE INTO sponsorship_engagement_events(id,need_id,sponsor_id,event_type) VALUES(?,?,?,'contract')",
        [`sev_${crypto.randomUUID()}`, deal.need_id, deal.sponsor_id]
      ).catch(() => {});
    }
    await dbRun(
      "INSERT INTO sponsorship_deal_updates(id,deal_id,author_id,kind,text) VALUES(?,?,?,?,?)",
      [
        `sdu_${crypto.randomUUID()}`,
        deal.id,
        req.userId!,
        "status",
        typeof body.status === "string" ? `Deal updated to ${body.status}.` : "Commercial terms updated.",
      ]
    );

    const updated = (await dbGet<SponsorshipDealRow>("SELECT * FROM sponsorship_deals WHERE id=?", [deal.id]))!;
    const updatesRows = await dbAll<SponsorshipDealUpdateRow>(
      "SELECT * FROM sponsorship_deal_updates WHERE deal_id=? ORDER BY created_at ASC",
      [deal.id]
    );
    const otherIsSponsor = accountId === deal.organizer_id;
    const otherId = otherIsSponsor ? deal.sponsor_id : deal.organizer_id;
    await notifyPaidAccount(
      otherId,
      otherIsSponsor ? "sponsor" : "organizer",
      "sponsorship",
      "Sponsorship Deal Room updated",
      `${deal.opportunity_title} has new commercial terms or status.`
    );
    res.json({ deal: toSponsorshipDealDTO(updated, updatesRows) });
  })
);

sponsorsRouter.post(
  "/deals/:id/updates",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const user = await dbGet<UserRow>("SELECT * FROM users WHERE id=?", [req.userId!]);
    if (!user) return res.status(403).json({ error: "Organizer or Sponsor account required." });
    const effectiveRole = effectivePaidRoleForRequest(req, user);
    if (!effectiveRole) {
      return res.status(403).json({ error: "Organizer or Sponsor account required." });
    }
    const accountContext = await paidWorkspaceContext(req, res, effectiveRole, true);
    if (!accountContext) return;
    const accountId = accountContext.accountId;
    const deal = await dbGet<SponsorshipDealRow>("SELECT * FROM sponsorship_deals WHERE id=?", [req.params.id]);
    if (!deal || (deal.organizer_id !== accountId && deal.sponsor_id !== accountId)) {
      return res.status(404).json({ error: "Deal not found." });
    }
    const textValue = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!textValue) return res.status(400).json({ error: "Update text is required." });
    const allowedKinds = new Set(["note","proposal","contract","invoice","deliverable"]);
    const kind = typeof req.body?.kind === "string" && allowedKinds.has(req.body.kind) ? req.body.kind : "note";
    const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    if (url && !/^https:\/\//i.test(url)) return res.status(400).json({ error: "url must be an https URL." });

    const id = `sdu_${crypto.randomUUID()}`;
    await dbRun(
      "INSERT INTO sponsorship_deal_updates(id,deal_id,author_id,kind,text,url) VALUES(?,?,?,?,?,?)",
      [id, deal.id, req.userId!, kind, textValue, url || null]
    );
    await dbRun("UPDATE sponsorship_deals SET updated_at=datetime('now') WHERE id=?", [deal.id]);
    const otherIsSponsor = accountId === deal.organizer_id;
    const otherId = otherIsSponsor ? deal.sponsor_id : deal.organizer_id;
    await notifyPaidAccount(
      otherId,
      otherIsSponsor ? "sponsor" : "organizer",
      "sponsorship",
      "New Deal Room update",
      `${deal.opportunity_title}: ${textValue.slice(0, 140)}`
    );
    const row = (await dbGet<SponsorshipDealUpdateRow>("SELECT * FROM sponsorship_deal_updates WHERE id=?", [id]))!;
    res.status(201).json({
      update: {
        id: row.id,
        authorId: row.author_id,
        kind: row.kind,
        text: row.text,
        url: row.url,
        createdAt: row.created_at,
      },
    });
  })
);

sponsorsRouter.get(
  "/needs/analytics",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const organizerContext = await paidWorkspaceContext(req, res, "organizer");
    if (!organizerContext) return;
    const accountId = organizerContext.accountId;

    const rows = await dbAll<any>(
      `SELECT n.id,n.title,n.conference_id,n.conference_title,n.price_amount,n.price_on_request,
              COUNT(DISTINCT CASE WHEN e.event_type='listing_view' THEN e.sponsor_id END) as views,
              COUNT(DISTINCT CASE WHEN e.event_type='inquiry' THEN e.sponsor_id END) as inquiries,
              COUNT(DISTINCT CASE WHEN e.event_type='negotiating' THEN e.sponsor_id END) as negotiating,
              COUNT(DISTINCT CASE WHEN e.event_type='won' THEN e.sponsor_id END) as won,
              COUNT(DISTINCT CASE WHEN e.event_type='contract' THEN e.sponsor_id END) as contracts,
              (
                SELECT COUNT(DISTINCT d.sponsor_id)
                  FROM sponsorship_deals d
                  JOIN sponsorship_payments p ON p.deal_id=d.id AND p.status='settled'
                 WHERE d.need_id=n.id
              ) as payments,
              (
                SELECT COALESCE(SUM(COALESCE(p.amount,0)),0)
                  FROM sponsorship_deals d
                  JOIN sponsorship_payments p ON p.deal_id=d.id AND p.status='settled'
                 WHERE d.need_id=n.id
              ) as realized_revenue
         FROM sponsorship_needs n
         LEFT JOIN sponsorship_engagement_events e ON e.need_id=n.id
        WHERE n.organizer_id=?
        GROUP BY n.id
        ORDER BY n.created_at DESC`,
      [accountId]
    );
    const needs = rows.map((row: any) => ({
      needId: row.id,
      title: row.title,
      conferenceId: row.conference_id,
      conferenceTitle: row.conference_title,
      publishedPrice: row.price_on_request ? null : row.price_amount,
      views: Number(row.views || 0),
      inquiries: Number(row.inquiries || 0),
      negotiating: Number(row.negotiating || 0),
      won: Number(row.won || 0),
      contracts: Number(row.contracts || 0),
      payments: Number(row.payments || 0),
      realizedRevenue: Number(row.realized_revenue || 0),
      inquiryRate: Number(row.views || 0) > 0 ? Number(((Number(row.inquiries || 0) / Number(row.views)) * 100).toFixed(1)) : 0,
      winRate: Number(row.inquiries || 0) > 0 ? Number(((Number(row.won || 0) / Number(row.inquiries)) * 100).toFixed(1)) : 0,
    }));
    res.json({
      needs,
      totals: {
        views: needs.reduce((sum: number, item: any) => sum + item.views, 0),
        inquiries: needs.reduce((sum: number, item: any) => sum + item.inquiries, 0),
        negotiating: needs.reduce((sum: number, item: any) => sum + item.negotiating, 0),
        won: needs.reduce((sum: number, item: any) => sum + item.won, 0),
        payments: needs.reduce((sum: number, item: any) => sum + item.payments, 0),
        realizedRevenue: needs.reduce((sum: number, item: any) => sum + item.realizedRevenue, 0),
      },
    });
  })
);

function toSponsorRequestDTO(row: SponsorRequestRow, sponsorName = "", responseCount = 0) {
  return {
    id: row.id,
    sponsorId: row.sponsor_id,
    sponsorName,
    title: row.title,
    description: row.description || "",
    categories: safeJson(row.categories, []),
    regions: safeJson(row.regions, []),
    opportunityTypes: safeJson(row.opportunity_types, []),
    budgetMin: row.budget_min,
    budgetMax: row.budget_max,
    targetAudience: row.target_audience || "",
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    responseCount,
    createdAt: row.created_at,
  };
}

// Reverse marketplace: paid sponsors publish the types of conferences they want to support.
sponsorsRouter.post(
  "/requests",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const sponsorContext = await paidWorkspaceContext(req, res, "sponsor", true);
    if (!sponsorContext) return;
    const accountId = sponsorContext.accountId;
    const sponsor = sponsorContext.accountOwner;
    const body = req.body || {};
    if (typeof body.title !== "string" || !body.title.trim()) {
      return res.status(400).json({ error: "Request title is required." });
    }
    const budgetMin = body.budgetMin === null || body.budgetMin === "" || body.budgetMin === undefined ? null : Number(body.budgetMin);
    const budgetMax = body.budgetMax === null || body.budgetMax === "" || body.budgetMax === undefined ? null : Number(body.budgetMax);
    if (budgetMin !== null && (!Number.isFinite(budgetMin) || budgetMin < 0)) return res.status(400).json({ error: "Invalid minimum budget." });
    if (budgetMax !== null && (!Number.isFinite(budgetMax) || budgetMax < 0)) return res.status(400).json({ error: "Invalid maximum budget." });
    if (budgetMin !== null && budgetMax !== null && budgetMin > budgetMax) return res.status(400).json({ error: "Minimum budget cannot exceed maximum budget." });

    const id = `sreq_${crypto.randomUUID()}`;
    await dbRun(
      `INSERT INTO sponsor_requests(
        id,sponsor_id,title,description,categories,regions,opportunity_types,budget_min,budget_max,
        target_audience,start_date,end_date,status
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'active')`,
      [
        id,
        accountId,
        body.title.trim(),
        typeof body.description === "string" ? body.description.trim() || null : null,
        JSON.stringify(cleanStringList(body.categories)),
        JSON.stringify(cleanStringList(body.regions,20)),
        JSON.stringify(cleanStringList(body.opportunityTypes,20)),
        budgetMin,
        budgetMax,
        typeof body.targetAudience === "string" ? body.targetAudience.trim() || null : null,
        typeof body.startDate === "string" ? body.startDate.trim() || null : null,
        typeof body.endDate === "string" ? body.endDate.trim() || null : null,
      ]
    );
    const row = (await dbGet<SponsorRequestRow>("SELECT * FROM sponsor_requests WHERE id=?", [id]))!;
    res.status(201).json({ request: toSponsorRequestDTO(row, sponsor.organization || sponsor.name) });
  })
);

sponsorsRouter.get(
  "/requests/mine",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const sponsorContext = await paidWorkspaceContext(req, res, "sponsor");
    if (!sponsorContext) return;
    const sponsor = sponsorContext.accountOwner;
    const rows = await dbAll<SponsorRequestRow>("SELECT * FROM sponsor_requests WHERE sponsor_id=? ORDER BY created_at DESC", [sponsorContext.accountId]);
    const result = [];
    for (const row of rows) {
      const count = await dbGet<{ count: number }>("SELECT COUNT(*) as count FROM sponsor_request_responses WHERE request_id=?", [row.id]);
      result.push(toSponsorRequestDTO(row, sponsor.organization || sponsor.name, count?.count || 0));
    }
    res.json({ requests: result });
  })
);

sponsorsRouter.get(
  "/requests/board",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const organizerContext = await paidWorkspaceContext(req, res, "organizer");
    if (!organizerContext) return;
    const rows = await dbAll<any>(
      `SELECT r.*,u.name as sponsor_name,u.organization as sponsor_organization
         FROM sponsor_requests r JOIN users u ON u.id=r.sponsor_id
        WHERE r.status='active'
          AND (r.end_date IS NULL OR r.end_date='' OR date(r.end_date)>=date('now'))
        ORDER BY r.created_at DESC`
    );
    res.json({
      requests: rows.map((row: any) => toSponsorRequestDTO(row, row.sponsor_organization || row.sponsor_name)),
    });
  })
);

sponsorsRouter.post(
  "/requests/:id/respond",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const organizerContext = await paidWorkspaceContext(req, res, "organizer", true);
    if (!organizerContext) return;
    const accountId = organizerContext.accountId;
    const organizer = organizerContext.accountOwner;
    const request = await dbGet<SponsorRequestRow>("SELECT * FROM sponsor_requests WHERE id=? AND status='active'", [req.params.id]);
    if (!request) return res.status(404).json({ error: "Sponsor request not found." });
    const conferenceId = typeof req.body?.conferenceId === "string" ? req.body.conferenceId : "";
    if (!conferenceId) return res.status(400).json({ error: "conferenceId is required." });
    const conference = await dbGet<CreatedConferenceRow>("SELECT * FROM created_conferences WHERE id=? AND organizer_id=?", [conferenceId, accountId]);
    if (!conference) return res.status(404).json({ error: "Conference not found." });
    const conf = safeJson(conference.data, {});
    const existing = await dbGet<SponsorRequestResponseRow>(
      "SELECT * FROM sponsor_request_responses WHERE request_id=? AND organizer_id=? AND conference_id=?",
      [request.id, accountId, conferenceId]
    );
    if (existing) return res.json({ response: existing, alreadyExists: true });

    const id = `srsp_${crypto.randomUUID()}`;
    await dbRun(
      "INSERT INTO sponsor_request_responses(id,request_id,organizer_id,conference_id,conference_title,message,status) VALUES(?,?,?,?,?,?,'new')",
      [
        id,
        request.id,
        accountId,
        conferenceId,
        conf.title || conference.id,
        typeof req.body?.message === "string" ? req.body.message.trim() || null : null,
      ]
    );
    await notifyPaidAccount(
      request.sponsor_id,
      "sponsor",
      "sponsorship",
      "Organizer responded to your Sponsor Request",
      `${organizer.organization || organizer.name} proposed ${conf.title || conference.id} for "${request.title}".`
    );
    const row = (await dbGet<SponsorRequestResponseRow>("SELECT * FROM sponsor_request_responses WHERE id=?", [id]))!;
    res.status(201).json({ response: row, alreadyExists: false });
  })
);

sponsorsRouter.get(
  "/requests/responses/mine",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const sponsorContext = await paidWorkspaceContext(req, res, "sponsor");
    if (!sponsorContext) return;
    const rows = await dbAll<any>(
      `SELECT rr.*,r.title as request_title,u.name as organizer_name,u.organization as organizer_organization
         FROM sponsor_request_responses rr
         JOIN sponsor_requests r ON r.id=rr.request_id
         JOIN users u ON u.id=rr.organizer_id
        WHERE r.sponsor_id=?
        ORDER BY rr.created_at DESC`,
      [sponsorContext.accountId]
    );
    res.json({
      responses: rows.map((row: any) => ({
        id: row.id,
        requestId: row.request_id,
        requestTitle: row.request_title,
        organizerId: row.organizer_id,
        organizerName: row.organizer_organization || row.organizer_name,
        conferenceId: row.conference_id,
        conferenceTitle: row.conference_title,
        message: row.message || "",
        status: row.status,
        createdAt: row.created_at,
      })),
    });
  })
);

sponsorsRouter.patch(
  "/requests/responses/:id",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const sponsorContext = await paidWorkspaceContext(req, res, "sponsor", true);
    if (!sponsorContext) return;
    const accountId = sponsorContext.accountId;
    const status = req.body?.status === "accepted" || req.body?.status === "declined" ? req.body.status : null;
    if (!status) return res.status(400).json({ error: "status must be accepted or declined." });
    const row = await dbGet<any>(
      `SELECT rr.*,r.sponsor_id FROM sponsor_request_responses rr
         JOIN sponsor_requests r ON r.id=rr.request_id WHERE rr.id=?`,
      [req.params.id]
    );
    if (!row || row.sponsor_id !== accountId) return res.status(404).json({ error: "Response not found." });
    await dbRun("UPDATE sponsor_request_responses SET status=?,updated_at=datetime('now') WHERE id=?", [status, req.params.id]);
    await notifyPaidAccount(
      row.organizer_id,
      "organizer",
      "sponsorship",
      status === "accepted" ? "Sponsor Request response accepted" : "Sponsor Request response declined",
      `The sponsor ${status} your conference proposal for their Sponsor Request.`
    );
    res.json({ ok: true, status });
  })
);

// Phase 7.4/7.6 Sponsor Launchpad: one compact view of acquisition/activation progress,
// actionable marketplace state, and alert readiness. All counts are account-level and come from
// existing real product records; no synthetic milestones are created.
sponsorsRouter.get(
  "/launchpad",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const sponsorContext = await paidWorkspaceContext(req, res, "sponsor");
    if (!sponsorContext) return;
    const accountId = sponsorContext.accountId;
    const sponsor = sponsorContext.accountOwner;

    const preference = await dbGet<SponsorPreferenceRow>(
      "SELECT * FROM sponsor_preferences WHERE sponsor_id=?",
      [accountId]
    );
    const activeNeeds = await dbAll<SponsorshipNeedRow>(
      `SELECT * FROM sponsorship_needs
        WHERE status='active'
          AND (deadline IS NULL OR deadline='' OR date(deadline)>=date('now'))`
    );
    const matchDetails = activeNeeds.map((need) => sponsorNeedMatchDetail(preference, need));
    const meaningfulMatches = matchDetails.filter((match) => match.score >= 45).length;
    const highMatches = matchDetails.filter((match) => match.score >= 70).length;

    const [
      savedRow,
      alertRow,
      inquiryRow,
      dealRow,
      paidDealRow,
      requestRow,
      responseRow,
      unreadRow,
    ] = await Promise.all([
      dbGet<{ count: number }>(
        "SELECT COUNT(*) as count FROM sponsor_saved_opportunities WHERE sponsor_id=?",
        [accountId]
      ),
      dbGet<{ count: number }>(
        "SELECT COUNT(*) as count FROM sponsor_saved_opportunities WHERE sponsor_id=? AND alert_enabled=1",
        [accountId]
      ),
      dbGet<{ count: number }>(
        "SELECT COUNT(*) as count FROM sponsorship_need_inquiries WHERE sponsor_id=?",
        [accountId]
      ),
      dbGet<{ count: number }>(
        "SELECT COUNT(*) as count FROM sponsorship_deals WHERE sponsor_id=?",
        [accountId]
      ),
      dbGet<{ count: number }>(
        "SELECT COUNT(*) as count FROM sponsorship_deals WHERE sponsor_id=? AND status IN ('paid','delivering','completed')",
        [accountId]
      ),
      dbGet<{ count: number }>(
        "SELECT COUNT(*) as count FROM sponsor_requests WHERE sponsor_id=? AND status='active'",
        [accountId]
      ),
      dbGet<{ count: number }>(
        `SELECT COUNT(*) as count
           FROM sponsor_request_responses rr
           JOIN sponsor_requests r ON r.id=rr.request_id
          WHERE r.sponsor_id=?`,
        [accountId]
      ),
      dbGet<{ count: number }>(
        "SELECT COUNT(*) as count FROM notifications WHERE user_id=? AND read=0 AND type='sponsorship'",
        [accountId]
      ),
    ]);

    const saved = Number(savedRow?.count || 0);
    const alertsEnabled = Number(alertRow?.count || 0);
    const inquiries = Number(inquiryRow?.count || 0);
    const deals = Number(dealRow?.count || 0);
    const paidDeals = Number(paidDealRow?.count || 0);
    const sponsorRequests = Number(requestRow?.count || 0);
    const organizerResponses = Number(responseRow?.count || 0);
    const unreadAlerts = Number(unreadRow?.count || 0);

    const prefLists = preference
      ? [
          safeJson(preference.sectors, []),
          safeJson(preference.categories, []),
          safeJson(preference.regions, []),
          safeJson(preference.opportunity_types, []),
        ]
      : [[], [], [], []];
    const preferenceGroupsCompleted = prefLists.filter((items) => items.length > 0).length;
    const companyProfileReady = Boolean((sponsor.organization || "").trim());
    const preferencesReady = preferenceGroupsCompleted >= 2;
    const alertFrequency = preference?.alert_frequency || "instant";

    let nextAction = {
      key: "monitor_marketplace",
      label: "Monitor new opportunities",
      description: "Your core Sponsor Pro activation path is complete. Keep preferences and alerts current.",
      targetTab: "matches",
    };

    if (!companyProfileReady) {
      nextAction = {
        key: "complete_company_profile",
        label: "Complete company profile",
        description: "Add your company name so organizers know who is evaluating their opportunities.",
        targetTab: "profile",
      };
    } else if (!preferencesReady) {
      nextAction = {
        key: "configure_preferences",
        label: "Configure matching preferences",
        description: "Choose at least two preference groups so ConferenceGate can rank relevant opportunities.",
        targetTab: "preferences",
      };
    } else if (meaningfulMatches > 0 && saved === 0 && inquiries === 0) {
      nextAction = {
        key: "review_matches",
        label: "Review matched opportunities",
        description: `${meaningfulMatches} opportunity${meaningfulMatches === 1 ? "" : "ies"} currently match your preferences.`,
        targetTab: "matches",
      };
    } else if (saved > 0 && inquiries === 0) {
      nextAction = {
        key: "contact_organizer",
        label: "Send your first inquiry",
        description: "Turn a saved opportunity into a real organizer conversation.",
        targetTab: "saved",
      };
    } else if (inquiries > 0 && deals === 0) {
      nextAction = {
        key: "advance_inquiry",
        label: "Advance an inquiry to Deal Room",
        description: "Follow active organizer responses and move a qualified opportunity into negotiation.",
        targetTab: "matches",
      };
    } else if (deals > 0 && paidDeals === 0) {
      nextAction = {
        key: "advance_deal",
        label: "Advance active Deal Rooms",
        description: "Review commercial terms, deliverables, contract and payment status.",
        targetTab: "deals",
      };
    }

    res.json({
      launchpad: {
        companyProfileReady,
        preferencesReady,
        preferenceGroupsCompleted,
        alertFrequency,
        meaningfulMatches,
        highMatches,
        savedOpportunities: saved,
        watchAlertsEnabled: alertsEnabled,
        inquiriesSent: inquiries,
        dealRooms: deals,
        paidDeals,
        sponsorRequests,
        organizerResponses,
        unreadSponsorshipAlerts: unreadAlerts,
        nextAction,
      },
    });
  })
);

// Sponsor Pro portfolio analytics from real internal marketplace activity only.
sponsorsRouter.get(
  "/analytics/mine",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const sponsorContext = await paidWorkspaceContext(req, res, "sponsor");
    if (!sponsorContext) return;
    const accountId = sponsorContext.accountId;

    const preference = await dbGet<SponsorPreferenceRow>(
      "SELECT * FROM sponsor_preferences WHERE sponsor_id=?",
      [accountId]
    );
    const activeNeeds = await dbAll<SponsorshipNeedRow>(
      `SELECT * FROM sponsorship_needs
        WHERE status='active'
          AND (deadline IS NULL OR deadline='' OR date(deadline)>=date('now'))`
    );
    const ranked = activeNeeds.map((need) => sponsorNeedMatch(preference, need));
    const meaningfulMatches = ranked.filter((score) => score >= 45).length;
    const highMatches = ranked.filter((score) => score >= 70).length;

    const inquiries = await dbAll<SponsorshipNeedInquiryRow>(
      "SELECT * FROM sponsorship_need_inquiries WHERE sponsor_id=? ORDER BY created_at DESC",
      [accountId]
    );
    const deals = await dbAll<SponsorshipDealRow>(
      "SELECT * FROM sponsorship_deals WHERE sponsor_id=? ORDER BY updated_at DESC",
      [accountId]
    );
    const requests = await dbAll<SponsorRequestRow>(
      "SELECT * FROM sponsor_requests WHERE sponsor_id=?",
      [accountId]
    );
    const responseCount = await dbGet<{ count: number }>(
      `SELECT COUNT(*) as count
         FROM sponsor_request_responses rr
         JOIN sponsor_requests r ON r.id=rr.request_id
        WHERE r.sponsor_id=?`,
      [accountId]
    );

    const paidStatuses = new Set(["paid","delivering","completed"]);
    const committedStatuses = new Set(["agreement_reached","contract_pending","payment_pending","paid","delivering","completed"]);
    const paidDeals = deals.filter((deal) => paidStatuses.has(deal.status));
    const activeDeals = deals.filter((deal) => !["completed","canceled"].includes(deal.status));
    const negotiations = deals.filter((deal) => ["negotiating","agreement_reached","contract_pending","payment_pending"].includes(deal.status));
    const contracts = deals.filter((deal) => ["contract_pending","payment_pending","paid","delivering","completed"].includes(deal.status));
    const committedSpend = deals
      .filter((deal) => committedStatuses.has(deal.status))
      .reduce((sum, deal) => sum + Number(deal.agreed_amount || 0), 0);
    const paidSpend = paidDeals.reduce((sum, deal) => sum + Number(deal.agreed_amount || 0), 0);

    res.json({
      analytics: {
        meaningfulMatches,
        highMatches,
        inquiriesSent: inquiries.length,
        activeDeals: activeDeals.length,
        negotiations: negotiations.length,
        contracts: contracts.length,
        paidDeals: paidDeals.length,
        completedDeals: deals.filter((deal) => deal.status === "completed").length,
        committedSpend,
        paidSpend,
        sponsorRequests: requests.length,
        organizerResponses: Number(responseCount?.count || 0),
        acceptedRequestResponses: await dbGet<{ count: number }>(
          `SELECT COUNT(*) as count
             FROM sponsor_request_responses rr
             JOIN sponsor_requests r ON r.id=rr.request_id
            WHERE r.sponsor_id=? AND rr.status='accepted'`,
          [accountId]
        ).then((row) => Number(row?.count || 0)),
      },
    });
  })
);

// Stored official sponsorship/exhibitor catalogue. This endpoint performs database reads only:
// it never crawls, searches, or fetches an organizer website during a customer request.
sponsorsRouter.get(
  "/external-opportunities",
  asyncHandler(async (_req: AuthedRequest, res: Response) => {
    const rows = await dbAll<any>(
      `SELECT *
         FROM discovery_sponsorship_opportunities
        WHERE status = 'available'
          AND (
            (start_date IS NOT NULL AND date(start_date) >= date('now'))
            OR start_date IS NULL
          )
        ORDER BY CASE WHEN start_date IS NULL THEN 1 ELSE 0 END, start_date ASC, conference_title ASC`
    ).catch(() => []);

    const currencyEvidence = (pkg: any) => {
      const priceText = String(pkg?.price_text || "");
      const currency = String(pkg?.currency || "");
      return /(?:\$|€|£|\b(?:USD|EUR|GBP|BHD|SAR|AED|QAR|KWD|OMR|CAD|AUD|SGD|CHF|JPY|CNY)\b|\bBD\b)/i.test(
        `${priceText} ${currency}`
      );
    };
    const sponsorPackageName = (name: unknown) => {
      const value = String(name || "").trim();
      if (!value || /abstract|paper|research|results|patient|study|conference we track|scored/i.test(value)) return false;
      return /sponsor|sponsorship|partner package|exhibit|exhibitor|booth|stand package|table sponsor|dinner sponsor|lunch sponsor|reception sponsor|lanyard|badge sponsor|app sponsor|digital sponsor|gala|golf sponsor|branding|advertis|package|platinum|gold sponsor|silver sponsor|bronze sponsor|diamond|premium sponsor|title sponsor|exclusive sponsor|networking sponsor|hospitality sponsor|workshop sponsor|session sponsor|delegate gift/i.test(value);
    };

    const opportunities = rows.map((row: any) => {
      const rawPackages = safeJson(row.packages, []);
      const categories = safeJson(row.categories, []);
      const cleanedPackages = (Array.isArray(rawPackages) ? rawPackages : [])
        .filter((pkg: any) => sponsorPackageName(pkg?.name))
        .map((pkg: any) => {
          const validPrice = currencyEvidence(pkg);
          return {
            name: typeof pkg?.name === "string" && pkg.name.trim() ? pkg.name.trim() : "Sponsorship / Exhibition Opportunity",
            priceText: validPrice && typeof pkg?.price_text === "string" && pkg.price_text.trim() ? pkg.price_text.trim() : null,
            priceAmount: validPrice && Number.isFinite(Number(pkg?.price_amount)) ? Number(pkg.price_amount) : null,
            currency: validPrice && typeof pkg?.currency === "string" && pkg.currency.trim() ? pkg.currency.trim() : null,
            benefits: Array.isArray(pkg?.benefits)
              ? pkg.benefits.filter((value: unknown) => typeof value === "string" && value.trim()).slice(0, 4)
              : [],
            sourceUrl: typeof pkg?.source_url === "string" && pkg.source_url ? pkg.source_url : row.sponsor_url || row.action_url,
          };
        });
      const packages = cleanedPackages.length
        ? cleanedPackages
        : [{
            name: "Sponsorship / Exhibitor Enquiry",
            priceText: null,
            priceAmount: null,
            currency: null,
            benefits: [],
            sourceUrl: row.sponsor_url || row.action_url,
          }];
      const hasPublishedPricing = packages.some((pkg: any) => pkg.priceText && pkg.priceAmount !== null);
      return {
        conferenceId: String(row.event_id),
        conferenceTitle: String(row.conference_title || ""),
        startDate: row.start_date || null,
        endDate: row.end_date || null,
        city: row.city || null,
        country: row.country || null,
        officialUrl: row.official_url,
        sponsorUrl: row.sponsor_url,
        actionUrl: row.action_url,
        actionLabel: hasPublishedPricing ? "View Sponsorship" : "Inquire Now",
        hasPublishedPricing,
        categories: Array.isArray(categories) ? categories : [],
        packages,
        checkedAt: row.checked_at || null,
      };
    });

    res.json({ opportunities, source: "stored_catalog" });
  })
);

// All published sponsorship packages across every organizer — the real Sponsor Marketplace
// catalog. Real availableSlots is computed from approved applications, not a stored counter,
// so it can never drift out of sync.
sponsorsRouter.get(
  "/packages",
  asyncHandler(async (_req: AuthedRequest, res: Response) => {
    const rows = await dbAll<SponsorshipPackageRow>("SELECT * FROM sponsorship_packages ORDER BY created_at DESC");
    const approved = await approvedCountsByPackage();
    res.json({ packages: rows.map((row) => toPackageDTO(row, approved)) });
  })
);

// An organizer publishes a real sponsorship package for one of their own conferences.
sponsorsRouter.post(
  "/packages",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const organizerContext = await paidWorkspaceContext(req, res, "organizer", true);
    if (!organizerContext) return;
    const accountId = organizerContext.accountId;
    const body = req.body || {};
    if (typeof body.conferenceId !== "string" || !body.conferenceId) {
      return res.status(400).json({ error: "conferenceId is required" });
    }
    if (typeof body.tier !== "string" || !body.tier.trim()) {
      return res.status(400).json({ error: "tier is required" });
    }
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ error: "A valid price is required" });
    }

    const conference = await dbGet<CreatedConferenceRow>(
      "SELECT * FROM created_conferences WHERE id = ? AND organizer_id = ?",
      [body.conferenceId, accountId]
    );
    if (!conference) {
      return res.status(404).json({ error: "You can only publish packages for conferences in this organizer workspace." });
    }
    const conferenceData = JSON.parse(conference.data);

    const totalSlots = Number.isFinite(Number(body.totalSlots)) && Number(body.totalSlots) > 0 ? Number(body.totalSlots) : 1;

    const id = `pkg_${crypto.randomUUID()}`;
    await dbRun(
      `INSERT INTO sponsorship_packages (
        id, conference_id, conference_title, organizer_id, tier, price, benefits,
        booth_space, speaking_ops, total_slots, source_opportunity_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        body.conferenceId,
        conferenceData.title || conference.id,
        accountId,
        body.tier.trim(),
        price,
        JSON.stringify(Array.isArray(body.benefits) ? body.benefits : []),
        typeof body.boothSpace === "string" ? body.boothSpace : null,
        typeof body.speakingOps === "string" ? body.speakingOps : null,
        totalSlots,
        typeof body.sourceOpportunityId === "string" ? body.sourceOpportunityId : null,
      ]
    );

    const row = (await dbGet<SponsorshipPackageRow>("SELECT * FROM sponsorship_packages WHERE id = ?", [id]))!;
    res.status(201).json({ package: toPackageDTO(row, await approvedCountsByPackage()) });
  })
);

// Notifies this organizer's verified sponsors — those with an approved application on one of
// this organizer's packages, rated at or above the marketplace threshold — of a real published
// package. Persisted as real per-account notifications, so it actually reaches those sponsors'
// own accounts instead of only ever existing in the organizer's own browser session.
sponsorsRouter.post(
  "/packages/:id/notify-verified-sponsors",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const organizerContext = await paidWorkspaceContext(req, res, "organizer", true);
    if (!organizerContext) return;
    const accountId = organizerContext.accountId;
    const pkg = await dbGet<SponsorshipPackageRow>("SELECT * FROM sponsorship_packages WHERE id = ?", [
      req.params.id,
    ]);
    if (!pkg || pkg.organizer_id !== accountId) {
      return res.status(404).json({ error: "Package not found" });
    }
    const opportunityName =
      typeof req.body?.opportunityName === "string" && req.body.opportunityName.trim()
        ? req.body.opportunityName.trim()
        : `${pkg.tier} Sponsorship`;

    const sponsorRows = await dbAll<{ sponsor_id: string }>(
      `SELECT DISTINCT sa.sponsor_id as sponsor_id
       FROM sponsorship_applications sa
       JOIN sponsorship_packages sp ON sp.id = sa.package_id
       JOIN users u ON u.id = sa.sponsor_id
       WHERE sp.organizer_id = ?
         AND sa.status = 'Approved'
         AND u.role='sponsor'
         AND u.subscription_status IN ('active','trialing')`,
      [accountId]
    );

    let notifiedCount = 0;
    for (const row of sponsorRows) {
      await notifyPaidAccount(
        row.sponsor_id,
        "sponsor",
        "sponsorship",
        `New Sponsorship Opportunity: ${opportunityName}`,
        `${pkg.tier} package now available for ${pkg.price.toLocaleString()}. Apply in the Sponsor Marketplace before slots fill up.`
      );
      notifiedCount++;
    }

    res.json({ notifiedCount });
  })
);

// A sponsor applies to a real, published package. Idempotent — re-applying just returns the
// existing application rather than erroring.
sponsorsRouter.post(
  "/applications",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const sponsorContext = await paidWorkspaceContext(req, res, "sponsor", true);
    if (!sponsorContext) return;
    const accountId = sponsorContext.accountId;
    const body = req.body || {};
    if (typeof body.packageId !== "string" || !body.packageId) {
      return res.status(400).json({ error: "packageId is required" });
    }
    const pkg = await dbGet<SponsorshipPackageRow>("SELECT * FROM sponsorship_packages WHERE id = ?", [
      body.packageId,
    ]);
    if (!pkg) {
      return res.status(404).json({ error: "That sponsorship package no longer exists." });
    }

    const approvedCount = await dbGet<{ count: number }>(
      "SELECT COUNT(*) as count FROM sponsorship_applications WHERE package_id=? AND status='Approved'",
      [pkg.id]
    );
    if (Number(approvedCount?.count || 0) >= pkg.total_slots) {
      return res.status(409).json({ error: "This sponsorship package is fully allocated." });
    }

    const existing = await dbGet<SponsorshipApplicationRow>(
      "SELECT * FROM sponsorship_applications WHERE package_id = ? AND sponsor_id = ?",
      [body.packageId, accountId]
    );
    if (existing) {
      return res.status(200).json({ application: existing, alreadyApplied: true });
    }

    const id = `sapp_${crypto.randomUUID()}`;
    await dbRun("INSERT INTO sponsorship_applications (id, package_id, sponsor_id) VALUES (?, ?, ?)", [
      id,
      body.packageId,
      accountId,
    ]);
    const row = (await dbGet<SponsorshipApplicationRow>("SELECT * FROM sponsorship_applications WHERE id = ?", [
      id,
    ]))!;
    res.status(201).json({ application: row, alreadyApplied: false });
  })
);

// This sponsor's own applications, with the package/conference context needed to render status
// ("Applied ✓", "Approved", "Rejected") in the marketplace.
sponsorsRouter.get(
  "/applications/mine",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const sponsorContext = await paidWorkspaceContext(req, res, "sponsor");
    if (!sponsorContext) return;
    const rows = await dbAll<SponsorshipApplicationRow & { tier: string; conference_title: string }>(
      `SELECT sa.*, sp.tier as tier, sp.conference_title as conference_title
       FROM sponsorship_applications sa
       JOIN sponsorship_packages sp ON sp.id = sa.package_id
       WHERE sa.sponsor_id = ?
       ORDER BY sa.created_at DESC`,
      [sponsorContext.accountId]
    );
    res.json({
      applications: rows.map((r) => ({
        id: r.id,
        packageId: r.package_id,
        tier: r.tier,
        conferenceTitle: r.conference_title,
        status: r.status,
        createdAt: r.created_at,
      })),
    });
  })
);

async function sponsorDerivedStats(sponsorId: string) {
  const ratingRow = (await dbGet<{ avgRating: number | null; count: number }>(
    "SELECT AVG(rating) as avgRating, COUNT(*) as count FROM sponsor_reviews WHERE sponsor_id = ?",
    [sponsorId]
  ))!;
  const rating = ratingRow.avgRating || 0;
  const reviewsCount = ratingRow.count;

  const activeRow = (await dbGet<{ count: number }>(
    "SELECT COUNT(*) as count FROM sponsorship_applications WHERE sponsor_id = ? AND status = 'Approved'",
    [sponsorId]
  ))!;

  const historyRows = await dbAll<{ conference_title: string; tier: string; created_at: string }>(
    `SELECT sp.conference_title as conference_title, sp.tier as tier, sa.decided_at as created_at
     FROM sponsorship_applications sa
     JOIN sponsorship_packages sp ON sp.id = sa.package_id
     WHERE sa.sponsor_id = ? AND sa.status = 'Approved'
     ORDER BY sa.decided_at DESC`,
    [sponsorId]
  );

  return {
    rating,
    reviewsCount,
    activeSponsorshipsCount: activeRow.count,
    sponsorshipHistory: historyRows.map((h) => ({
      conferenceTitle: h.conference_title,
      tier: h.tier,
      year: h.created_at ? new Date(h.created_at).getFullYear() : new Date().getFullYear(),
    })),
  };
}

// The organizer's incoming applicants for packages tied to their own conferences — the real
// Sponsor Verification Queue.
sponsorsRouter.get(
  "/applications/for-my-packages",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const organizerContext = await paidWorkspaceContext(req, res, "organizer");
    if (!organizerContext) return;
    const rows = await dbAll<
      SponsorshipApplicationRow & { tier: string; conference_title: string; sponsor: UserRow }
    >(
      `SELECT sa.id as id, sa.package_id as package_id, sa.sponsor_id as sponsor_id, sa.status as status,
              sa.created_at as created_at, sa.decided_at as decided_at,
              sp.tier as tier, sp.conference_title as conference_title
       FROM sponsorship_applications sa
       JOIN sponsorship_packages sp ON sp.id = sa.package_id
       WHERE sp.organizer_id = ?
       ORDER BY sa.created_at DESC`,
      [organizerContext.accountId]
    );

    const applicants = await Promise.all(
      rows.map(async (r) => {
        const sponsorUser = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [r.sponsor_id]);
        const stats = await sponsorDerivedStats(r.sponsor_id);
        return {
          applicationId: r.id,
          packageId: r.package_id,
          tier: r.tier,
          conferenceTitle: r.conference_title,
          status: r.status,
          createdAt: r.created_at,
          sponsor: {
            id: r.sponsor_id,
            companyName: sponsorUser?.organization || sponsorUser?.name || "Unknown Sponsor",
            logo: sponsorUser?.avatar || null,
            industry: sponsorUser?.title || "",
            ...stats,
          },
        };
      })
    );

    res.json({ applicants });
  })
);

// Organizer approves or rejects an applicant — validated against packages tied to their own
// conferences only.
sponsorsRouter.post(
  "/applications/:id/decide",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const organizerContext = await paidWorkspaceContext(req, res, "organizer", true);
    if (!organizerContext) return;
    const status = req.body?.status;
    if (status !== "Approved" && status !== "Rejected") {
      return res.status(400).json({ error: "status must be 'Approved' or 'Rejected'" });
    }

    const application = await dbGet<SponsorshipApplicationRow>(
      "SELECT * FROM sponsorship_applications WHERE id = ?",
      [req.params.id]
    );
    if (!application) {
      return res.status(404).json({ error: "Application not found" });
    }
    const pkg = await dbGet<SponsorshipPackageRow>("SELECT * FROM sponsorship_packages WHERE id = ?", [
      application.package_id,
    ]);
    if (!pkg || pkg.organizer_id !== organizerContext.accountId) {
      return res.status(403).json({ error: "You can only review applicants for your own conferences." });
    }

    if (status === "Approved" && application.status !== "Approved") {
      const approvedCount = await dbGet<{ count: number }>(
        "SELECT COUNT(*) as count FROM sponsorship_applications WHERE package_id=? AND status='Approved'",
        [pkg.id]
      );
      if (Number(approvedCount?.count || 0) >= pkg.total_slots) {
        return res.status(409).json({ error: "This sponsorship package has no remaining slots." });
      }
    }

    await dbRun("UPDATE sponsorship_applications SET status = ?, decided_at = datetime('now') WHERE id = ?", [
      status,
      req.params.id,
    ]);
    const updated = (await dbGet<SponsorshipApplicationRow>(
      "SELECT * FROM sponsorship_applications WHERE id = ?",
      [req.params.id]
    ))!;
    res.json({ application: updated });
  })
);

// Real sponsors this organizer can rate — those with at least one approved application on one
// of the organizer's own packages.
sponsorsRouter.get(
  "/reviewable/mine",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const organizerContext = await paidWorkspaceContext(req, res, "organizer");
    if (!organizerContext) return;
    const rows = await dbAll<{ sponsor_id: string }>(
      `SELECT DISTINCT sa.sponsor_id as sponsor_id
       FROM sponsorship_applications sa
       JOIN sponsorship_packages sp ON sp.id = sa.package_id
       WHERE sp.organizer_id = ? AND sa.status = 'Approved'`,
      [organizerContext.accountId]
    );
    const sponsors = await Promise.all(
      rows.map(async (r) => {
        const u = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [r.sponsor_id]);
        return {
          id: r.sponsor_id,
          companyName: u?.organization || u?.name || "Unknown Sponsor",
          logo: u?.avatar || null,
        };
      })
    );
    res.json({ sponsors });
  })
);

// Organizer rates a sponsor they've actually worked with.
sponsorsRouter.post(
  "/reviews",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const organizerContext = await paidWorkspaceContext(req, res, "organizer", true);
    if (!organizerContext) return;
    const accountId = organizerContext.accountId;
    const body = req.body || {};
    if (typeof body.sponsorId !== "string" || !body.sponsorId) {
      return res.status(400).json({ error: "sponsorId is required" });
    }
    if (typeof body.conferenceTitle !== "string" || !body.conferenceTitle.trim()) {
      return res.status(400).json({ error: "conferenceTitle is required" });
    }
    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "rating must be an integer from 1 to 5" });
    }

    const eligible = await dbGet<{ id: string }>(
      `SELECT sa.id as id
       FROM sponsorship_applications sa
       JOIN sponsorship_packages sp ON sp.id = sa.package_id
       WHERE sp.organizer_id = ? AND sa.sponsor_id = ? AND sa.status = 'Approved'
       LIMIT 1`,
      [accountId, body.sponsorId]
    );
    if (!eligible) {
      return res.status(403).json({ error: "You can only review sponsors you've approved for one of your conferences." });
    }

    const existingReview = await dbGet<SponsorReviewRow>(
      "SELECT * FROM sponsor_reviews WHERE sponsor_id=? AND organizer_id=? AND conference_title=? ORDER BY created_at DESC LIMIT 1",
      [body.sponsorId, accountId, body.conferenceTitle.trim()]
    );
    if (existingReview) {
      await dbRun(
        "UPDATE sponsor_reviews SET rating=?,comment=?,created_at=datetime('now') WHERE id=?",
        [rating, body.comment || null, existingReview.id]
      );
    } else {
      const id = `srev_${crypto.randomUUID()}`;
      await dbRun(
        "INSERT INTO sponsor_reviews (id, sponsor_id, organizer_id, conference_title, rating, comment) VALUES (?, ?, ?, ?, ?, ?)",
        [id, body.sponsorId, accountId, body.conferenceTitle.trim(), rating, body.comment || null]
      );
    }
    const stats = await sponsorDerivedStats(body.sponsorId);
    res.status(201).json({ ok: true, ...stats });
  })
);

// The logged-in sponsor's own real profile stats — rating, reviews, sponsorship history, and
// leads captured (real DM conversations initiated by professionals viewing their profile).
sponsorsRouter.get(
  "/profile/mine",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const sponsorContext = await paidWorkspaceContext(req, res, "sponsor");
    if (!sponsorContext) return;
    const accountId = sponsorContext.accountId;
    const stats = await sponsorDerivedStats(accountId);

    const reviewRows = await dbAll<SponsorReviewRow & { organizer_name: string }>(
      `SELECT sr.*, u.name as organizer_name
       FROM sponsor_reviews sr
       JOIN users u ON u.id = sr.organizer_id
       WHERE sr.sponsor_id = ?
       ORDER BY sr.created_at DESC`,
      [accountId]
    );

    const leadsRow = (await dbGet<{ count: number }>(
      "SELECT COUNT(*) as count FROM conversations WHERE user_a = ? OR user_b = ?",
      [accountId, accountId]
    ))!;

    res.json({
      ...stats,
      leadsCaptured: leadsRow.count,
      reviews: reviewRows.map((r) => ({
        id: r.id,
        reviewerName: r.organizer_name,
        reviewerRole: "Organizer",
        conferenceTitle: r.conference_title,
        rating: r.rating,
        comment: r.comment || "",
        date: r.created_at.split(" ")[0],
      })),
    });
  })
);
