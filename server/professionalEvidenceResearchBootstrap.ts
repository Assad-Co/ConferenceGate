import express, { Router, type NextFunction, type Request, type Response } from "express";
import { searchCrossRefConferencePapers } from "./crossref";
import { searchOpenAlexConferencePapers } from "./openalex";
import { searchSemanticScholarConferencePapers } from "./semanticscholar";
import { searchDblpConferencePapers } from "./dblp";
import { braveSearch, isBraveConfigured, type LiveSearchResult } from "./braveSearch";
import { isSerperConfigured, serperSearch } from "./serperSearch";

/**
 * Phase 40 — Professional Deep Research & Evidence Graph.
 *
 * LinkedIn OpenID authenticates identity only. After a member signs in or links LinkedIn,
 * ConferenceGate can use that identity as an anchor to search public professional sources.
 * This module never stores the transient LinkedIn OAuth access token and never claims access to
 * private LinkedIn messages, connections or private posts.
 *
 * Name-only matches remain POSSIBLE. Evidence is promoted only when independent sources agree,
 * or when an authoritative public source also matches the member's stored organization/profile.
 */

type Confidence = "verified" | "strong" | "possible" | "member_claimed";
type EvidenceKind =
  | "publication"
  | "conference_paper"
  | "conference_role"
  | "conference_attendance"
  | "position"
  | "patent"
  | "public_bio";

type ResearchTrigger = "linkedin_oauth" | "manual_refresh";

type AuthedRequest = Request & { professionalEvidenceUserId?: string };

type EvidenceDraft = {
  kind: EvidenceKind;
  title: string;
  organization?: string | null;
  conferenceTitle?: string | null;
  role?: string | null;
  year?: number | null;
  sourceUrl?: string | null;
  sourceType: string;
  confidence: Confidence;
  confidenceScore: number;
  evidenceReason: string;
  fingerprint?: string;
  payload?: any;
};

const router = Router();
const RESEARCH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const runningUsers = new Set<string>();
let schemaReady: Promise<void> | null = null;

function safe(handler: (req: AuthedRequest, res: Response) => Promise<unknown>) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res)).catch(next);
  };
}

async function requireMember(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const { COOKIE_NAME, verifySessionToken } = await import("./auth");
    const userId = verifySessionToken(req.cookies?.[COOKIE_NAME]);
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    req.professionalEvidenceUserId = userId;
    next();
  } catch (error) {
    next(error);
  }
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const { dbRun } = await import("./db");
      await dbRun(`CREATE TABLE IF NOT EXISTS professional_evidence_research_runs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        trigger TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        error TEXT,
        counts_json TEXT NOT NULL DEFAULT '{}'
      )`);
      await dbRun(`CREATE INDEX IF NOT EXISTS idx_professional_evidence_runs_user
        ON professional_evidence_research_runs(user_id, started_at DESC)`);
      await dbRun(`CREATE TABLE IF NOT EXISTS professional_evidence_items (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        organization TEXT,
        conference_title TEXT,
        role TEXT,
        year INTEGER,
        source_url TEXT,
        source_type TEXT NOT NULL,
        confidence TEXT NOT NULL,
        confidence_score INTEGER NOT NULL DEFAULT 0,
        evidence_reason TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, fingerprint, source_type)
      )`);
      await dbRun(`CREATE INDEX IF NOT EXISTS idx_professional_evidence_items_user
        ON professional_evidence_items(user_id, confidence, kind)`);
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalize(value: unknown): string {
  return clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slug(value: unknown): string {
  return normalize(value).replace(/\s+/g, "-").slice(0, 120) || "evidence";
}

function yearNumber(value: unknown): number | null {
  const match = clean(value).match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function uniqueId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function safeJson(value: unknown, fallback: any = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function host(url: unknown): string {
  try { return new URL(clean(url)).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

function isLowTrustHost(value: string) {
  return /(^|\.)(linkedin\.com|facebook\.com|instagram\.com|x\.com|twitter\.com|researchgate\.net|academia\.edu|peoplefinders\.|zoominfo\.)$/i.test(value);
}

function looksAuthoritativeHost(value: string) {
  if (!value || isLowTrustHost(value)) return false;
  return /\.(edu|ac\.[a-z]{2}|gov|gov\.[a-z]{2})$/i.test(value)
    || /(aapg|eage|spe\.org|seg\.org|ieee|acm\.org|sciencedirect|springer|wiley|elsevier|doi\.org|crossref|openalex|semanticscholar|dblp)/i.test(value);
}

function exactNameInText(fullName: string, body: string) {
  const n = normalize(fullName);
  const b = normalize(body);
  if (!n || !b) return false;
  if (b.includes(n)) return true;
  const parts = n.split(" ").filter((p) => p.length > 1);
  if (parts.length < 2) return false;
  return b.includes(`${parts[0]} ${parts.at(-1)}`);
}

function organizationMatches(organization: string | null, body: string) {
  const org = normalize(organization);
  if (!org || org.length < 3) return false;
  const text = normalize(body);
  if (text.includes(org)) return true;
  const tokens = org.split(" ").filter((p) => p.length >= 4);
  return tokens.length > 0 && tokens.filter((p) => text.includes(p)).length >= Math.min(2, tokens.length);
}

function canonicalTitle(value: string) {
  return normalize(value)
    .replace(/\b(the|a|an|of|and|for|in|on|to|with|using)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function draftFingerprint(item: EvidenceDraft) {
  return [item.kind, canonicalTitle(item.title), item.year || "", normalize(item.role || "")].join("|").slice(0, 500);
}

async function readIdentity(userId: string) {
  const { dbGet } = await import("./db");
  const user = await dbGet<any>(
    `SELECT id,name,email,linkedin_id,linkedin_url FROM users WHERE id = ?`,
    [userId],
  );
  if (!user) return null;

  let linkedInProfile: any = null;
  try {
    linkedInProfile = await dbGet<any>(
      `SELECT full_name,headline,current_title,current_organization,linkedin_url,verified,
              experience,publications,patents,certifications,fetched_at
         FROM linkedin_profile_enrichment WHERE user_id = ?`,
      [userId],
    );
  } catch {
    // The member may have authenticated with LinkedIn before public-profile enrichment has run.
  }

  return {
    userId,
    fullName: clean(linkedInProfile?.full_name) || clean(user.name),
    email: clean(user.email),
    linkedinId: clean(user.linkedin_id) || null,
    linkedinUrl: clean(linkedInProfile?.linkedin_url) || clean(user.linkedin_url) || null,
    headline: clean(linkedInProfile?.headline) || null,
    title: clean(linkedInProfile?.current_title) || null,
    organization: clean(linkedInProfile?.current_organization) || null,
    linkedInVerified: Boolean(linkedInProfile?.verified),
    experience: safeJson(linkedInProfile?.experience, []),
    publications: safeJson(linkedInProfile?.publications, []),
    patents: safeJson(linkedInProfile?.patents, []),
  };
}

function titleFromProfileItem(item: any) {
  return clean(item?.title) || clean(item?.name) || clean(item?.publicationTitle) || clean(item?.patentTitle);
}

function existingProfileSupport(identity: any, title: string, kind: EvidenceKind) {
  const list = kind === "patent" ? identity.patents : identity.publications;
  const target = canonicalTitle(title);
  if (!target) return false;
  return Array.isArray(list) && list.some((item) => {
    const candidate = canonicalTitle(titleFromProfileItem(item));
    return candidate && (candidate === target || candidate.includes(target) || target.includes(candidate));
  });
}

async function scholarlyEvidence(identity: any): Promise<EvidenceDraft[]> {
  const name = identity.fullName;
  if (!name) return [];
  const [crossref, openalex, semantic, dblp] = await Promise.all([
    searchCrossRefConferencePapers(name).catch(() => []),
    searchOpenAlexConferencePapers(name).catch(() => []),
    searchSemanticScholarConferencePapers(name).catch(() => []),
    searchDblpConferencePapers(name).catch(() => []),
  ]);

  const rows = [
    ...crossref.map((x: any) => ({ ...x, sourceType: "crossref" })),
    ...openalex.map((x: any) => ({ ...x, sourceType: "openalex" })),
    ...semantic.map((x: any) => ({ ...x, sourceType: "semantic_scholar" })),
    ...dblp.map((x: any) => ({ ...x, sourceType: "dblp" })),
  ];
  const groups = new Map<string, any[]>();
  for (const row of rows) {
    const key = `${canonicalTitle(clean(row.title))}|${yearNumber(row.year) || ""}`;
    if (!clean(row.title) || key.length < 8) continue;
    groups.set(key, [...(groups.get(key) || []), row]);
  }

  const out: EvidenceDraft[] = [];
  for (const group of groups.values()) {
    const sourceTypes = [...new Set(group.map((row) => row.sourceType))];
    const exemplar = group[0];
    const profileSupport = existingProfileSupport(identity, exemplar.title, "publication");
    const confidence: Confidence = sourceTypes.length >= 2 || profileSupport ? "strong" : "possible";
    const score = sourceTypes.length >= 3 ? 88 : sourceTypes.length >= 2 ? 82 : profileSupport ? 80 : 62;
    for (const row of group) {
      out.push({
        kind: "conference_paper",
        title: clean(row.title),
        conferenceTitle: clean(row.venue) || null,
        year: yearNumber(row.year),
        sourceUrl: clean(row.url) || null,
        sourceType: row.sourceType,
        confidence,
        confidenceScore: score,
        evidenceReason: sourceTypes.length >= 2
          ? `Independent scholarly indexes agree on this title (${sourceTypes.join(", ")}).`
          : profileSupport
            ? "The scholarly record matches a publication already present in the member's public professional profile."
            : "Name-matched scholarly candidate; retained as possible until independently corroborated.",
        payload: { independentSources: sourceTypes },
      });
    }
  }
  return out;
}

async function publicSearch(query: string): Promise<LiveSearchResult[]> {
  if (isBraveConfigured()) {
    try { return await braveSearch(query, 10, "low"); } catch { /* use fallback */ }
  }
  if (isSerperConfigured()) {
    try { return await serperSearch(query, 10); } catch { /* bounded public research is best effort */ }
  }
  return [];
}

function inferWebKind(text: string): { kind: EvidenceKind; role?: string | null } | null {
  const body = text.toLowerCase();
  if (/\b(patent|inventor|invention)\b/.test(body)) return { kind: "patent" };
  if (/\b(keynote|plenary|speaker|session chair|co-chair|cochair|moderator|technical committee|program committee|organizing committee|panelist|presenter)\b/.test(body)) {
    const roleMatch = body.match(/\b(keynote speaker|plenary speaker|invited speaker|session chair|co-chair|cochair|moderator|technical committee(?: member)?|program committee(?: member)?|organizing committee(?: member)?|panelist|presenter|speaker)\b/i);
    return { kind: "conference_role", role: roleMatch?.[0] || null };
  }
  if (/\b(attended|attendee|participated|participation|delegate)\b/.test(body) && /\b(conference|congress|symposium|workshop|meeting|summit|forum)\b/.test(body)) {
    return { kind: "conference_attendance" };
  }
  if (/\b(publication|paper|journal|proceedings|doi|article|abstract)\b/.test(body)) return { kind: "publication" };
  if (/\b(professor|director|manager|scientist|engineer|researcher|consultant|specialist|officer|lead|head|president|vice president|chair)\b/.test(body)) return { kind: "position" };
  if (/\b(biography|bio|profile|faculty|staff)\b/.test(body)) return { kind: "public_bio" };
  return null;
}

async function webEvidence(identity: any): Promise<EvidenceDraft[]> {
  if (!identity.fullName || (!isBraveConfigured() && !isSerperConfigured())) return [];
  const exact = `"${identity.fullName.replace(/"/g, "")}"`;
  const org = identity.organization ? ` "${identity.organization.replace(/"/g, "")}"` : "";
  const queries = [
    `${exact}${org} conference speaker committee chair`,
    `${exact}${org} conference program abstract proceedings`,
    `${exact}${org} publication paper DOI`,
    `${exact}${org} patent inventor`,
    `${exact}${org} professional biography profile position`,
  ];
  const resultGroups = await Promise.all(queries.map((query) => publicSearch(query)));
  const seen = new Set<string>();
  const out: EvidenceDraft[] = [];

  for (const result of resultGroups.flat()) {
    const sourceUrl = clean(result.link);
    const sourceHost = host(sourceUrl);
    if (!sourceUrl || !sourceHost || isLowTrustHost(sourceHost)) continue;
    const combined = `${clean(result.title)} ${clean(result.snippet)}`;
    if (!exactNameInText(identity.fullName, combined)) continue;
    const inferred = inferWebKind(combined);
    if (!inferred) continue;

    const orgMatch = organizationMatches(identity.organization, combined);
    const authoritative = looksAuthoritativeHost(sourceHost);
    const key = `${inferred.kind}|${sourceUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let confidence: Confidence = "possible";
    let score = 64;
    let reason = "Exact-name public web result retained as possible until corroborated.";
    if (authoritative && orgMatch) {
      confidence = "verified";
      score = 93;
      reason = "Authoritative public source matches the member's exact name and stored organization.";
    } else if (authoritative || orgMatch) {
      confidence = "strong";
      score = authoritative ? 85 : 80;
      reason = authoritative
        ? "Authoritative public source matches the member's exact name."
        : "Public source matches the member's exact name and stored organization.";
    }

    out.push({
      kind: inferred.kind,
      title: clean(result.title) || `${identity.fullName} — public professional evidence`,
      organization: orgMatch ? identity.organization : null,
      conferenceTitle: /conference|congress|symposium|workshop|meeting|summit|forum/i.test(combined) ? clean(result.title) : null,
      role: inferred.role || null,
      year: yearNumber(combined),
      sourceUrl,
      sourceType: authoritative ? "official_web" : result.discoveryProvider || "public_web",
      confidence,
      confidenceScore: score,
      evidenceReason: reason,
      payload: { snippet: clean(result.snippet), host: sourceHost },
    });
  }
  return out;
}

async function linkedInClaimEvidence(identity: any): Promise<EvidenceDraft[]> {
  const { dbGet } = await import("./db");
  let row: any = null;
  try {
    row = await dbGet<any>(
      `SELECT conference_activity FROM linkedin_conference_activity WHERE user_id = ?`,
      [identity.userId],
    );
  } catch {
    return [];
  }
  const signals = safeJson(row?.conference_activity, []);
  if (!Array.isArray(signals)) return [];
  return signals
    .filter((item: any) => item && clean(item.label))
    .slice(0, 400)
    .map((item: any): EvidenceDraft => ({
      kind: item.kind === "CONFERENCE_ROLE" ? "conference_role"
        : item.kind === "PAPER_ABSTRACT" ? "publication"
          : item.kind === "PAST_CONFERENCE" ? "conference_attendance"
            : "public_bio",
      title: clean(item.label),
      conferenceTitle: clean(item.conferenceName) || null,
      role: clean(item.role) || null,
      year: Number(item.year) || null,
      sourceUrl: clean(item.sourceUrl) || identity.linkedinUrl,
      sourceType: "linkedin_public",
      confidence: item.memberClaimed ? "member_claimed" : "possible",
      confidenceScore: Number(item.confidence) || (item.memberClaimed ? 72 : 55),
      evidenceReason: item.memberClaimed
        ? "Member's own public LinkedIn post; retained as a member claim until independently corroborated."
        : "Public LinkedIn signal; not treated as proof of participation without corroboration.",
      payload: item,
    }));
}

function promoteCorroborated(items: EvidenceDraft[]) {
  const groups = new Map<string, EvidenceDraft[]>();
  for (const item of items) {
    const key = [item.kind, canonicalTitle(item.title), item.year || ""].join("|");
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  for (const group of groups.values()) {
    const independent = new Set(group.map((item) => item.sourceType).filter((type) => type !== "linkedin_public"));
    const hasMemberClaim = group.some((item) => item.confidence === "member_claimed");
    if (independent.size >= 2 || (hasMemberClaim && independent.size >= 1)) {
      for (const item of group) {
        if (item.confidence === "possible" || item.confidence === "member_claimed") {
          item.confidence = "strong";
          item.confidenceScore = Math.max(item.confidenceScore, hasMemberClaim ? 84 : 82);
          item.evidenceReason = hasMemberClaim
            ? "Member's public claim is independently corroborated by a separate public source."
            : "Independent public sources corroborate the same professional evidence.";
        }
      }
    }
  }
  return items;
}

async function storeEvidence(userId: string, items: EvidenceDraft[]) {
  const { dbRun } = await import("./db");
  const now = new Date().toISOString();
  for (const item of items.slice(0, 600)) {
    const fingerprint = item.fingerprint || draftFingerprint(item);
    if (!fingerprint || !item.title) continue;
    await dbRun(
      `INSERT INTO professional_evidence_items (
        id,user_id,kind,title,organization,conference_title,role,year,source_url,source_type,
        confidence,confidence_score,evidence_reason,fingerprint,payload_json,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(user_id,fingerprint,source_type) DO UPDATE SET
        title=excluded.title,
        organization=excluded.organization,
        conference_title=excluded.conference_title,
        role=excluded.role,
        year=excluded.year,
        source_url=excluded.source_url,
        confidence=excluded.confidence,
        confidence_score=excluded.confidence_score,
        evidence_reason=excluded.evidence_reason,
        payload_json=excluded.payload_json,
        updated_at=excluded.updated_at`,
      [
        uniqueId("pe"), userId, item.kind, item.title, item.organization || null,
        item.conferenceTitle || null, item.role || null, item.year || null, item.sourceUrl || null,
        item.sourceType, item.confidence, Math.round(item.confidenceScore), item.evidenceReason,
        fingerprint, JSON.stringify(item.payload || {}), now, now,
      ],
    );
  }
}

async function executeResearch(userId: string, trigger: ResearchTrigger) {
  if (runningUsers.has(userId)) return;
  runningUsers.add(userId);
  await ensureSchema();
  const { dbRun } = await import("./db");
  const runId = uniqueId("perun");
  const startedAt = new Date().toISOString();
  await dbRun(
    `INSERT INTO professional_evidence_research_runs (id,user_id,trigger,status,started_at,counts_json)
     VALUES (?,?,?,?,?,?)`,
    [runId, userId, trigger, "running", startedAt, "{}"],
  );

  try {
    const identity = await readIdentity(userId);
    if (!identity?.fullName) throw new Error("Professional identity has no usable name yet.");
    const [scholarly, web, linkedIn] = await Promise.all([
      scholarlyEvidence(identity),
      webEvidence(identity),
      linkedInClaimEvidence(identity),
    ]);
    const evidence = promoteCorroborated([...scholarly, ...web, ...linkedIn]);
    await storeEvidence(userId, evidence);
    const counts = evidence.reduce((acc: Record<string, number>, item) => {
      acc[item.confidence] = (acc[item.confidence] || 0) + 1;
      acc[item.kind] = (acc[item.kind] || 0) + 1;
      return acc;
    }, {});
    await dbRun(
      `UPDATE professional_evidence_research_runs
          SET status=?,finished_at=?,counts_json=? WHERE id=?`,
      ["completed", new Date().toISOString(), JSON.stringify(counts), runId],
    );
  } catch (error: any) {
    await dbRun(
      `UPDATE professional_evidence_research_runs
          SET status=?,finished_at=?,error=? WHERE id=?`,
      ["failed", new Date().toISOString(), clean(error?.message || error).slice(0, 700), runId],
    ).catch(() => undefined);
  } finally {
    runningUsers.delete(userId);
  }
}

export async function queueProfessionalEvidenceResearch(
  userId: string,
  options: { trigger?: ResearchTrigger; force?: boolean } = {},
) {
  const trigger = options.trigger || "linkedin_oauth";
  await ensureSchema();
  if (!options.force) {
    const { dbGet } = await import("./db");
    const latest = await dbGet<any>(
      `SELECT status,started_at FROM professional_evidence_research_runs
        WHERE user_id=? AND status IN ('running','completed')
        ORDER BY started_at DESC LIMIT 1`,
      [userId],
    );
    if (latest?.status === "running") return { queued: false, reason: "already_running" };
    const age = latest?.started_at ? Date.now() - new Date(latest.started_at).getTime() : Infinity;
    if (Number.isFinite(age) && age < RESEARCH_TTL_MS) return { queued: false, reason: "fresh" };
  }
  setImmediate(() => {
    executeResearch(userId, trigger).catch((error) => console.error("[professional-evidence] research failed", error));
  });
  return { queued: true };
}

async function snapshot(userId: string) {
  await ensureSchema();
  const { dbAll, dbGet } = await import("./db");
  const [latestRun, items] = await Promise.all([
    dbGet<any>(
      `SELECT id,trigger,status,started_at,finished_at,error,counts_json
         FROM professional_evidence_research_runs WHERE user_id=? ORDER BY started_at DESC LIMIT 1`,
      [userId],
    ),
    dbAll<any>(
      `SELECT id,kind,title,organization,conference_title,role,year,source_url,source_type,
              confidence,confidence_score,evidence_reason,updated_at
         FROM professional_evidence_items WHERE user_id=?
        ORDER BY CASE confidence WHEN 'verified' THEN 1 WHEN 'strong' THEN 2 WHEN 'member_claimed' THEN 3 ELSE 4 END,
                 confidence_score DESC, year DESC, updated_at DESC
        LIMIT 400`,
      [userId],
    ),
  ]);
  const summary = {
    total: items.length,
    verified: 0,
    strong: 0,
    possible: 0,
    memberClaimed: 0,
    publications: 0,
    conferenceRoles: 0,
    conferenceAttendance: 0,
    positions: 0,
    patents: 0,
    publicBios: 0,
  };
  for (const item of items) {
    if (item.confidence === "verified") summary.verified += 1;
    else if (item.confidence === "strong") summary.strong += 1;
    else if (item.confidence === "member_claimed") summary.memberClaimed += 1;
    else summary.possible += 1;
    if (item.kind === "publication" || item.kind === "conference_paper") summary.publications += 1;
    else if (item.kind === "conference_role") summary.conferenceRoles += 1;
    else if (item.kind === "conference_attendance") summary.conferenceAttendance += 1;
    else if (item.kind === "position") summary.positions += 1;
    else if (item.kind === "patent") summary.patents += 1;
    else if (item.kind === "public_bio") summary.publicBios += 1;
  }
  return {
    status: latestRun?.status || "not_started",
    lastRun: latestRun ? {
      id: latestRun.id,
      trigger: latestRun.trigger,
      status: latestRun.status,
      startedAt: latestRun.started_at,
      finishedAt: latestRun.finished_at,
      error: latestRun.error,
      counts: safeJson(latestRun.counts_json, {}),
    } : null,
    summary,
    items: items.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      organization: item.organization,
      conferenceTitle: item.conference_title,
      role: item.role,
      year: item.year,
      sourceUrl: item.source_url,
      sourceType: item.source_type,
      confidence: item.confidence,
      confidenceScore: item.confidence_score,
      evidenceReason: item.evidence_reason,
      updatedAt: item.updated_at,
    })),
    policy: {
      publicSourcesOnly: true,
      privateLinkedInDataAccessed: false,
      oauthAccessTokenStored: false,
      possibleMatchesAffectTrustIndex: false,
    },
  };
}

router.get("/me", requireMember, safe(async (req, res) => {
  res.json(await snapshot(req.professionalEvidenceUserId!));
}));

router.post("/refresh", requireMember, safe(async (req, res) => {
  const userId = req.professionalEvidenceUserId!;
  await queueProfessionalEvidenceResearch(userId, { trigger: "manual_refresh", force: true });
  res.status(202).json({ queued: true, status: "queued" });
}));

const application: any = express.application as any;
if (!application.__conferenceGateProfessionalEvidencePatch) {
  application.__conferenceGateProfessionalEvidencePatch = true;
  const originalGet = application.get;
  const originalUse = application.use;
  application.get = function patchedGet(path: unknown, ...handlers: any[]) {
    if (path === "/api/health" && !this.locals?.__professionalEvidenceRouterMounted) {
      this.locals = this.locals || {};
      this.locals.__professionalEvidenceRouterMounted = true;
      originalUse.call(this, "/api/professional-evidence", router);
    }
    return originalGet.call(this, path, ...handlers);
  };
}

export { router as professionalEvidenceResearchRouter };
