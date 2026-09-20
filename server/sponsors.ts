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
  SponsorshipNeedRow,
  SponsorshipNeedInquiryRow,
  CreatedConferenceRow,
  UserRow,
} from "./db";
import { AuthedRequest, requireAuth } from "./auth";
import { asyncHandler } from "./asyncHandler";
import { createNotification } from "./activity";

export const sponsorsRouter = Router();
sponsorsRouter.use(requireAuth);

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

function sponsorNeedMatch(
  preference: SponsorPreferenceRow | undefined,
  need: SponsorshipNeedRow
): number {
  if (!preference) return 0;
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
  const type = overlapRatio(types, needTypes);

  let weighted = 0;
  let weight = 0;
  for (const [value, w] of [[sector, 0.35], [category, 0.3], [region, 0.15], [type, 0.2]] as Array<[number | null, number]>) {
    if (value === null) continue;
    weighted += value * w;
    weight += w;
  }

  let budgetScore: number | null = null;
  if (need.price_amount !== null && preference.budget_max !== null) {
    budgetScore =
      need.price_amount <= preference.budget_max &&
      (preference.budget_min === null || need.price_amount >= preference.budget_min)
        ? 1
        : need.price_amount <= preference.budget_max * 1.25
          ? 0.5
          : 0;
  }
  if (budgetScore !== null) {
    weighted += budgetScore * 0.2;
    weight += 0.2;
  }
  return weight ? Math.round((weighted / weight) * 100) : 0;
}

function toSponsorshipNeedDTO(row: SponsorshipNeedRow, matchScore?: number) {
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
  };
}

// Sponsor Pro preference profile used for internal opportunity matching.
sponsorsRouter.get(
  "/preferences/mine",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const user = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [req.userId!]);
    if (!user || user.role !== "sponsor") return res.status(403).json({ error: "Sponsor account required." });
    const row = await dbGet<SponsorPreferenceRow>("SELECT * FROM sponsor_preferences WHERE sponsor_id = ?", [req.userId!]);
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
    const user = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [req.userId!]);
    if (!user || user.role !== "sponsor") return res.status(403).json({ error: "Sponsor account required." });
    if (!["active", "trialing"].includes(user.subscription_status || "")) {
      return res.status(402).json({ error: "Sponsor Pro subscription required." });
    }
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
        req.userId!,
        JSON.stringify(sectors),
        JSON.stringify(categories),
        JSON.stringify(regions),
        JSON.stringify(opportunityTypes),
        budgetMin,
        budgetMax,
        alertFrequency,
      ]
    );
    const row = (await dbGet<SponsorPreferenceRow>("SELECT * FROM sponsor_preferences WHERE sponsor_id = ?", [req.userId!]))!;
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
    const user = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [req.userId!]);
    if (!user || user.role !== "organizer") return res.status(403).json({ error: "Organizer account required." });
    if (!["active", "trialing"].includes(user.subscription_status || "")) {
      return res.status(402).json({ error: "Organizer Pro subscription required." });
    }
    const body = req.body || {};
    if (typeof body.conferenceId !== "string" || !body.conferenceId) {
      return res.status(400).json({ error: "conferenceId is required." });
    }
    if (typeof body.title !== "string" || !body.title.trim()) {
      return res.status(400).json({ error: "Sponsorship need title is required." });
    }
    const conference = await dbGet<CreatedConferenceRow>(
      "SELECT * FROM created_conferences WHERE id = ? AND organizer_id = ?",
      [body.conferenceId, req.userId!]
    );
    if (!conference) return res.status(404).json({ error: "Conference not found." });
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
        req.userId!,
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
      await createNotification(
        sponsor.id,
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
    const user = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [req.userId!]);
    if (!user || user.role !== "organizer") return res.status(403).json({ error: "Organizer account required." });
    const rows = await dbAll<SponsorshipNeedRow>(
      "SELECT * FROM sponsorship_needs WHERE organizer_id = ? ORDER BY created_at DESC",
      [req.userId!]
    );
    res.json({ needs: rows.map((row) => toSponsorshipNeedDTO(row)) });
  })
);

sponsorsRouter.get(
  "/needs/matched",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const user = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [req.userId!]);
    if (!user || user.role !== "sponsor") return res.status(403).json({ error: "Sponsor account required." });
    if (!["active", "trialing"].includes(user.subscription_status || "")) {
      return res.status(402).json({ error: "Sponsor Pro subscription required." });
    }
    const preference = await dbGet<SponsorPreferenceRow>(
      "SELECT * FROM sponsor_preferences WHERE sponsor_id = ?",
      [req.userId!]
    );
    const rows = await dbAll<SponsorshipNeedRow>(
      `SELECT * FROM sponsorship_needs
        WHERE status='active' AND (deadline IS NULL OR deadline='' OR date(deadline)>=date('now'))
        ORDER BY created_at DESC`
    );
    const matched = rows
      .map((row) => ({ row, score: sponsorNeedMatch(preference, row) }))
      .sort((a, b) => b.score - a.score || b.row.created_at.localeCompare(a.row.created_at))
      .map(({ row, score }) => toSponsorshipNeedDTO(row, score));
    res.json({ needs: matched });
  })
);

sponsorsRouter.post(
  "/needs/:id/inquiries",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const sponsor = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [req.userId!]);
    if (!sponsor || sponsor.role !== "sponsor") return res.status(403).json({ error: "Sponsor account required." });
    if (!["active", "trialing"].includes(sponsor.subscription_status || "")) {
      return res.status(402).json({ error: "Sponsor Pro subscription required." });
    }
    const need = await dbGet<SponsorshipNeedRow>(
      "SELECT * FROM sponsorship_needs WHERE id = ? AND status='active'",
      [req.params.id]
    );
    if (!need) return res.status(404).json({ error: "Sponsorship opportunity not found." });
    const existing = await dbGet<SponsorshipNeedInquiryRow>(
      "SELECT * FROM sponsorship_need_inquiries WHERE need_id = ? AND sponsor_id = ?",
      [need.id, req.userId!]
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
        req.userId!,
        typeof req.body?.message === "string" ? req.body.message.trim() || null : null,
        budget,
      ]
    );
    await createNotification(
      need.organizer_id,
      "sponsorship",
      "New Sponsor Pro inquiry",
      `${sponsor.organization || sponsor.name} is interested in ${need.title} for ${need.conference_title}.`
    );
    const row = (await dbGet<SponsorshipNeedInquiryRow>("SELECT * FROM sponsorship_need_inquiries WHERE id = ?", [id]))!;
    res.status(201).json({ inquiry: row, alreadyExists: false });
  })
);

sponsorsRouter.get(
  "/needs/inquiries/mine",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const user = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [req.userId!]);
    if (!user || user.role !== "organizer") return res.status(403).json({ error: "Organizer account required." });
    const rows = await dbAll<any>(
      `SELECT i.*, n.title as need_title, n.conference_title, u.name as sponsor_name, u.organization as sponsor_organization
        FROM sponsorship_need_inquiries i
        JOIN sponsorship_needs n ON n.id=i.need_id
        JOIN users u ON u.id=i.sponsor_id
        WHERE n.organizer_id=?
        ORDER BY i.created_at DESC`,
      [req.userId!]
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
    const user = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [req.userId!]);
    if (!user || user.role !== "organizer") return res.status(403).json({ error: "Organizer account required." });
    const allowed = new Set(["new","contacted","negotiating","won","lost"]);
    const status = typeof req.body?.status === "string" && allowed.has(req.body.status) ? req.body.status : null;
    if (!status) return res.status(400).json({ error: "Invalid inquiry status." });
    const inquiry = await dbGet<any>(
      `SELECT i.*, n.organizer_id FROM sponsorship_need_inquiries i
        JOIN sponsorship_needs n ON n.id=i.need_id
        WHERE i.id=?`,
      [req.params.id]
    );
    if (!inquiry || inquiry.organizer_id !== req.userId) return res.status(404).json({ error: "Inquiry not found." });
    await dbRun(
      "UPDATE sponsorship_need_inquiries SET status=?,updated_at=datetime('now') WHERE id=?",
      [status, req.params.id]
    );
    await createNotification(
      inquiry.sponsor_id,
      "sponsorship",
      "Sponsorship inquiry updated",
      `The organizer updated your sponsorship inquiry to ${status}.`
    );
    res.json({ ok: true, status });
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
      [body.conferenceId, req.userId!]
    );
    if (!conference) {
      return res.status(404).json({ error: "You can only publish packages for conferences you created." });
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
        req.userId!,
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
    const pkg = await dbGet<SponsorshipPackageRow>("SELECT * FROM sponsorship_packages WHERE id = ?", [
      req.params.id,
    ]);
    if (!pkg || pkg.organizer_id !== req.userId) {
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
       WHERE sp.organizer_id = ? AND sa.status = 'Approved'`,
      [req.userId!]
    );

    let notifiedCount = 0;
    for (const row of sponsorRows) {
      const stats = await sponsorDerivedStats(row.sponsor_id);
      // Mirrors src/utils/sponsorVerification.ts's isSponsorVerified.
      const verified = stats.reviewsCount === 0 || stats.rating >= 3.0;
      if (!verified) continue;
      await createNotification(
        row.sponsor_id,
        "sponsorship",
        `New Sponsorship Opportunity: ${opportunityName}`,
        `${pkg.tier} package now available for $${pkg.price.toLocaleString()}. Apply in the Sponsor Marketplace before slots fill up.`
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

    const existing = await dbGet<SponsorshipApplicationRow>(
      "SELECT * FROM sponsorship_applications WHERE package_id = ? AND sponsor_id = ?",
      [body.packageId, req.userId!]
    );
    if (existing) {
      return res.status(200).json({ application: existing, alreadyApplied: true });
    }

    const id = `sapp_${crypto.randomUUID()}`;
    await dbRun("INSERT INTO sponsorship_applications (id, package_id, sponsor_id) VALUES (?, ?, ?)", [
      id,
      body.packageId,
      req.userId!,
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
    const rows = await dbAll<SponsorshipApplicationRow & { tier: string; conference_title: string }>(
      `SELECT sa.*, sp.tier as tier, sp.conference_title as conference_title
       FROM sponsorship_applications sa
       JOIN sponsorship_packages sp ON sp.id = sa.package_id
       WHERE sa.sponsor_id = ?
       ORDER BY sa.created_at DESC`,
      [req.userId!]
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
      [req.userId!]
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
    if (!pkg || pkg.organizer_id !== req.userId) {
      return res.status(403).json({ error: "You can only review applicants for your own conferences." });
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
    const rows = await dbAll<{ sponsor_id: string }>(
      `SELECT DISTINCT sa.sponsor_id as sponsor_id
       FROM sponsorship_applications sa
       JOIN sponsorship_packages sp ON sp.id = sa.package_id
       WHERE sp.organizer_id = ? AND sa.status = 'Approved'`,
      [req.userId!]
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
      [req.userId!, body.sponsorId]
    );
    if (!eligible) {
      return res.status(403).json({ error: "You can only review sponsors you've approved for one of your conferences." });
    }

    const id = `srev_${crypto.randomUUID()}`;
    await dbRun(
      "INSERT INTO sponsor_reviews (id, sponsor_id, organizer_id, conference_title, rating, comment) VALUES (?, ?, ?, ?, ?, ?)",
      [id, body.sponsorId, req.userId!, body.conferenceTitle.trim(), rating, body.comment || null]
    );
    const stats = await sponsorDerivedStats(body.sponsorId);
    res.status(201).json({ ok: true, ...stats });
  })
);

// The logged-in sponsor's own real profile stats — rating, reviews, sponsorship history, and
// leads captured (real DM conversations initiated by professionals viewing their profile).
sponsorsRouter.get(
  "/profile/mine",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const stats = await sponsorDerivedStats(req.userId!);

    const reviewRows = await dbAll<SponsorReviewRow & { organizer_name: string }>(
      `SELECT sr.*, u.name as organizer_name
       FROM sponsor_reviews sr
       JOIN users u ON u.id = sr.organizer_id
       WHERE sr.sponsor_id = ?
       ORDER BY sr.created_at DESC`,
      [req.userId!]
    );

    const leadsRow = (await dbGet<{ count: number }>(
      "SELECT COUNT(*) as count FROM conversations WHERE user_a = ? OR user_b = ?",
      [req.userId!, req.userId!]
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
