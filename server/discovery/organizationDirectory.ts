import { Router, type Response } from "express";
import { asyncHandler } from "../asyncHandler";
import { dbAll } from "../db";
import type { AuthedRequest } from "../auth";

export const organizationDirectoryRouter = Router();

const RANKING_PRIOR_SCORE = 4;
const RANKING_PRIOR_WEIGHT = 5;
const SUCCESSFUL_DEAL_STATUSES = new Set([
  "agreement_reached",
  "contract_pending",
  "payment_pending",
  "paid",
  "delivering",
  "completed",
]);

function normalizeOrganizationKey(value: unknown): string {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function cleanScore(value: unknown, min: number, max: number): number | null {
  const score = Number(value);
  return Number.isFinite(score) && score >= min && score <= max ? score : null;
}

function average(values: number[]): number {
  return values.length
    ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2))
    : 0;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function round1(value: number): number {
  return Number(value.toFixed(1));
}

function parseConferenceTitle(data: unknown): string {
  try {
    const parsed = JSON.parse(String(data || "{}"));
    return typeof parsed?.title === "string" ? parsed.title.trim() : "";
  } catch {
    return "";
  }
}

function latestDate(values: string[]): string | null {
  let latest: { value: string; time: number } | null = null;
  for (const value of values) {
    const time = Date.parse(value);
    if (!Number.isFinite(time)) continue;
    if (!latest || time > latest.time) latest = { value, time };
  }
  return latest?.value || null;
}

function recencyScore(lastVerifiedActivity: string | null): number {
  if (!lastVerifiedActivity) return 0;
  const time = Date.parse(lastVerifiedActivity);
  if (!Number.isFinite(time)) return 0;
  const ageDays = Math.max(0, (Date.now() - time) / 86_400_000);
  if (ageDays <= 90) return 100;
  if (ageDays <= 365) return round1(100 - ((ageDays - 90) / 275) * 30);
  if (ageDays <= 730) return round1(70 - ((ageDays - 365) / 365) * 30);
  return 20;
}

function logarithmicScore(count: number, fullScoreAt: number): number {
  if (count <= 0) return 0;
  return round1(clamp((Math.log1p(count) / Math.log1p(fullScoreAt)) * 100));
}

function reputationIntelligence(
  verifiedScores: number[],
  eventHistoryCount: number,
  sponsorshipHistoryCount: number,
  verifiedActivityDates: string[]
) {
  const verifiedCount = verifiedScores.length;
  const rawAverage = average(verifiedScores);
  const lastVerifiedActivity = latestDate(verifiedActivityDates);
  const eventHistoryScore = logarithmicScore(eventHistoryCount, 10);
  const sponsorshipHistoryScore = logarithmicScore(sponsorshipHistoryCount, 10);
  const historyInputs = [
    eventHistoryCount > 0 ? eventHistoryScore : null,
    sponsorshipHistoryCount > 0 ? sponsorshipHistoryScore : null,
  ].filter((value): value is number => value !== null);
  const historyScore = historyInputs.length ? average(historyInputs) : 0;
  const recentActivityScore = recencyScore(lastVerifiedActivity);

  if (verifiedCount === 0) {
    return {
      rank: null as number | null,
      score: 0,
      status: "unranked" as const,
      confidenceLabel: "Not ranked" as const,
      bayesianReputation: 0,
      rawReputation: rawAverage,
      qualityScore: 0,
      confidenceScore: 0,
      recencyScore: recentActivityScore,
      historyScore,
      eventHistoryScore,
      sponsorshipHistoryScore,
      eventHistoryCount,
      sponsorshipHistoryCount,
      verifiedCount,
      lastVerifiedActivity,
    };
  }

  const scoreSum = verifiedScores.reduce((sum, value) => sum + value, 0);
  const bayesianReputation = (scoreSum + RANKING_PRIOR_SCORE * RANKING_PRIOR_WEIGHT) /
    (verifiedCount + RANKING_PRIOR_WEIGHT);
  const qualityScore = round1(clamp(((bayesianReputation - 1) / 5) * 100));
  const confidenceScore = logarithmicScore(verifiedCount, 20);
  const score = round1(
    qualityScore * 0.55 +
    confidenceScore * 0.20 +
    recentActivityScore * 0.10 +
    historyScore * 0.15
  );
  const status = verifiedCount >= 8 ? "established" : verifiedCount >= 3 ? "ranked" : "provisional";
  const confidenceLabel = verifiedCount >= 8 ? "High" : verifiedCount >= 3 ? "Moderate" : "Emerging";

  return {
    rank: null as number | null,
    score,
    status,
    confidenceLabel,
    bayesianReputation: Number(bayesianReputation.toFixed(2)),
    rawReputation: rawAverage,
    qualityScore,
    confidenceScore,
    recencyScore: recentActivityScore,
    historyScore,
    eventHistoryScore,
    sponsorshipHistoryScore,
    eventHistoryCount,
    sponsorshipHistoryCount,
    verifiedCount,
    lastVerifiedActivity,
  };
}

organizationDirectoryRouter.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase().slice(0, 120) : "";
    const roleFilter = req.query.role === "organizer" || req.query.role === "sponsor"
      ? String(req.query.role)
      : "";
    const requestedSort = typeof req.query.sort === "string" ? req.query.sort : "rank";
    const sort = ["rank", "reputation", "reviews", "name"].includes(requestedSort)
      ? requestedSort
      : "rank";
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 200));

    const [
      users,
      createdConferences,
      eventFeedback,
      sponsorReviews,
      approvedApplications,
      sponsorshipDeals,
    ] = await Promise.all([
      dbAll<any>(
        `SELECT id,email,role,name,organization,title,avatar,bio,city,country
           FROM users
          WHERE role IN ('organizer','sponsor')`
      ),
      dbAll<any>("SELECT id,organizer_id,data FROM created_conferences"),
      dbAll<any>(
        `SELECT cf.id,cf.conference_id,cf.conference_title,cf.role,cf.overall_score,cf.comment,cf.created_at,
                cfr.organizer_name,cfr.organizer_key
           FROM conference_feedback cf
           LEFT JOIN conference_feedback_routing cfr ON cfr.feedback_id=cf.id
          ORDER BY cf.created_at DESC`
      ),
      dbAll<any>(
        `SELECT sr.id,sr.sponsor_id,sr.organizer_id,sr.conference_title,sr.rating,sr.comment,sr.created_at,
                srd.ratings as structured_ratings,srd.overall_score as structured_overall_score,
                ou.organization as reviewer_organization,ou.name as reviewer_name
           FROM sponsor_reviews sr
           JOIN users ou ON ou.id=sr.organizer_id
           LEFT JOIN sponsor_review_details srd ON srd.review_id=sr.id
          ORDER BY sr.created_at DESC`
      ),
      dbAll<any>(
        `SELECT sponsor_id,package_id,created_at,decided_at
           FROM sponsorship_applications
          WHERE status='Approved'`
      ),
      dbAll<any>(
        `SELECT sponsor_id,status,updated_at
           FROM sponsorship_deals
          WHERE status <> 'canceled'`
      ),
    ]);

    const groups = new Map<string, any>();
    const accountToKey = new Map<string, string>();

    for (const user of users) {
      const email = String(user.email || "").toLowerCase();
      if (email.endsWith(".invalid") || email.includes("@acceptance.invalid")) continue;
      const displayName = String(user.organization || user.name || "").trim();
      const key = normalizeOrganizationKey(displayName);
      if (!key) continue;
      accountToKey.set(String(user.id), key);
      const current = groups.get(key) || {
        key,
        name: displayName,
        roles: new Set<string>(),
        accountIds: [] as string[],
        logo: "",
        description: "",
        industry: "",
        city: "",
        country: "",
        eventScores: [] as number[],
        sponsorScores: [] as number[],
        eventHistoryCount: 0,
        sponsorshipHistoryCount: 0,
        verifiedActivityDates: [] as string[],
        verifiedEventFeedback: [] as any[],
        nameMatchedEventFeedback: [] as any[],
        sponsorFeedback: [] as any[],
      };
      current.roles.add(String(user.role));
      current.accountIds.push(String(user.id));
      if (!current.logo && user.avatar) current.logo = String(user.avatar);
      if (!current.description && user.bio) current.description = String(user.bio);
      if (!current.industry && user.title) current.industry = String(user.title);
      if (!current.city && user.city) current.city = String(user.city);
      if (!current.country && user.country) current.country = String(user.country);
      if (String(user.organization || "").trim()) current.name = String(user.organization).trim();
      groups.set(key, current);
    }

    const conferenceToKey = new Map<string, string>();
    const titleToKeys = new Map<string, Set<string>>();
    for (const conference of createdConferences) {
      const key = accountToKey.get(String(conference.organizer_id));
      if (!key || !groups.has(key)) continue;
      groups.get(key).eventHistoryCount += 1;
      conferenceToKey.set(String(conference.id), key);
      const titleKey = normalizeOrganizationKey(parseConferenceTitle(conference.data));
      if (!titleKey) continue;
      const keys = titleToKeys.get(titleKey) || new Set<string>();
      keys.add(key);
      titleToKeys.set(titleKey, keys);
    }

    for (const row of eventFeedback) {
      const directKey = row.conference_id ? conferenceToKey.get(String(row.conference_id)) : undefined;
      const titleKeys = titleToKeys.get(normalizeOrganizationKey(row.conference_title));
      const uniqueTitleKey = !directKey && titleKeys?.size === 1 ? [...titleKeys][0] : undefined;
      const verifiedKey = directKey || uniqueTitleKey;
      const score = cleanScore(row.overall_score, 1, 6);
      if (verifiedKey && groups.has(verifiedKey)) {
        const group = groups.get(verifiedKey);
        if (score !== null) group.eventScores.push(score);
        if (row.created_at) group.verifiedActivityDates.push(String(row.created_at));
        group.verifiedEventFeedback.push({
          id: String(row.id),
          conferenceTitle: String(row.conference_title || "Conference / Workshop"),
          role: String(row.role || "Participant"),
          overallScore: score || 0,
          comment: String(row.comment || ""),
          date: String(row.created_at || ""),
          verified: true,
        });
        continue;
      }

      const routedKey = normalizeOrganizationKey(row.organizer_key);
      if (routedKey && groups.has(routedKey)) {
        const group = groups.get(routedKey);
        group.nameMatchedEventFeedback.push({
          id: String(row.id),
          conferenceTitle: String(row.conference_title || "Conference / Workshop"),
          role: String(row.role || "Participant"),
          overallScore: score || 0,
          comment: String(row.comment || ""),
          date: String(row.created_at || ""),
          verified: false,
        });
      }
    }

    for (const row of sponsorReviews) {
      const key = accountToKey.get(String(row.sponsor_id));
      if (!key || !groups.has(key)) continue;
      const structured = cleanScore(row.structured_overall_score, 1, 6);
      const legacy = cleanScore(row.rating, 1, 5);
      const score6 = structured ?? (legacy === null ? null : Number(((legacy / 5) * 6).toFixed(2)));
      const group = groups.get(key);
      if (score6 !== null) group.sponsorScores.push(score6);
      if (row.created_at) group.verifiedActivityDates.push(String(row.created_at));
      let ratings: Record<string, number> = {};
      try { ratings = row.structured_ratings ? JSON.parse(String(row.structured_ratings)) : {}; } catch {}
      group.sponsorFeedback.push({
        id: String(row.id),
        reviewerOrganization: String(row.reviewer_organization || row.reviewer_name || "Conference Organizer"),
        conferenceTitle: String(row.conference_title || "Conference / Workshop"),
        overallScore: score6 || 0,
        legacyRating: legacy || 0,
        ratings,
        comment: String(row.comment || ""),
        date: String(row.created_at || ""),
        verified: true,
      });
    }

    for (const row of approvedApplications) {
      const key = accountToKey.get(String(row.sponsor_id));
      if (!key || !groups.has(key)) continue;
      groups.get(key).sponsorshipHistoryCount += 1;
    }

    for (const row of sponsorshipDeals) {
      if (!SUCCESSFUL_DEAL_STATUSES.has(String(row.status))) continue;
      const key = accountToKey.get(String(row.sponsor_id));
      if (!key || !groups.has(key)) continue;
      const group = groups.get(key);
      group.sponsorshipHistoryCount += 1;
      if (row.updated_at) group.verifiedActivityDates.push(String(row.updated_at));
    }

    const scopedProfiles = [...groups.values()].map((group) => {
      const roles = [...group.roles].sort();
      const eventScore = average(group.eventScores);
      const sponsorScore = average(group.sponsorScores);
      const combinedScores = [...group.eventScores, ...group.sponsorScores];
      return {
        key: group.key,
        name: group.name,
        roles,
        logo: group.logo || null,
        description: group.description,
        industry: group.industry,
        city: group.city,
        country: group.country,
        eventReputation: {
          score: eventScore,
          verifiedCount: group.eventScores.length,
          nameMatchCount: group.nameMatchedEventFeedback.length,
        },
        sponsorReputation: {
          score: sponsorScore,
          verifiedCount: group.sponsorScores.length,
        },
        combinedReputation: {
          score: average(combinedScores),
          verifiedCount: combinedScores.length,
        },
        ranking: reputationIntelligence(
          combinedScores,
          group.eventHistoryCount,
          group.sponsorshipHistoryCount,
          group.verifiedActivityDates
        ),
        verifiedEventFeedback: group.verifiedEventFeedback.slice(0, 50),
        nameMatchedEventFeedback: group.nameMatchedEventFeedback.slice(0, 50),
        sponsorFeedback: group.sponsorFeedback.slice(0, 50),
      };
    })
      .filter((profile) => !roleFilter || profile.roles.includes(roleFilter));

    const rankOrdered = [...scopedProfiles].sort((a, b) =>
      b.ranking.score - a.ranking.score ||
      b.ranking.verifiedCount - a.ranking.verifiedCount ||
      b.combinedReputation.score - a.combinedReputation.score ||
      a.name.localeCompare(b.name)
    );
    let nextRank = 1;
    for (const profile of rankOrdered) {
      if (profile.ranking.status === "unranked") continue;
      profile.ranking.rank = nextRank;
      nextRank += 1;
    }

    const searchedProfiles = scopedProfiles.filter((profile) => {
      if (!q) return true;
      const haystack = [profile.name, profile.industry, profile.city, profile.country, ...profile.roles]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });

    searchedProfiles.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "reviews") {
        return b.combinedReputation.verifiedCount - a.combinedReputation.verifiedCount ||
          b.ranking.score - a.ranking.score ||
          a.name.localeCompare(b.name);
      }
      if (sort === "reputation") {
        return b.combinedReputation.score - a.combinedReputation.score ||
          b.combinedReputation.verifiedCount - a.combinedReputation.verifiedCount ||
          a.name.localeCompare(b.name);
      }
      const aRank = a.ranking.rank ?? Number.MAX_SAFE_INTEGER;
      const bRank = b.ranking.rank ?? Number.MAX_SAFE_INTEGER;
      return aRank - bRank || a.name.localeCompare(b.name);
    });

    const profiles = searchedProfiles.slice(0, limit);
    res.json({
      profiles,
      total: searchedProfiles.length,
      rankingScope: roleFilter || "all",
      rankingMethod: {
        qualityWeight: 55,
        confidenceWeight: 20,
        recencyWeight: 10,
        historyWeight: 15,
        priorScore: RANKING_PRIOR_SCORE,
        priorWeight: RANKING_PRIOR_WEIGHT,
        note: "Only verified reviews influence ranking. Name-only matches are excluded.",
      },
    });
  })
);
