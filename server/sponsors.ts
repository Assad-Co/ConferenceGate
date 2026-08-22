import { Router, Response } from "express";
import crypto from "crypto";
import {
  dbGet,
  dbAll,
  dbRun,
  SponsorshipPackageRow,
  SponsorshipApplicationRow,
  SponsorReviewRow,
  CreatedConferenceRow,
  UserRow,
} from "./db";
import { AuthedRequest, requireAuth } from "./auth";
import { asyncHandler } from "./asyncHandler";

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
