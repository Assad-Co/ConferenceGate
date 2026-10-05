import { Router, Response } from "express";
import crypto from "crypto";
import { AuthedRequest, requireAuth } from "./auth";
import { asyncHandler } from "./asyncHandler";
import { dbAll, dbGet, dbRun, UserRow } from "./db";
import { resolvePaidAccountContext, canOperateWorkspace } from "./workspaceAccess";
import { createNotification } from "./activity";

export const professionalTrustRouter = Router();
professionalTrustRouter.use(requireAuth);

const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const ALLOWED_DOCUMENT_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

let schemaReady: Promise<void> | null = null;
export async function initProfessionalTrustSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await dbRun(`CREATE TABLE IF NOT EXISTS professional_evaluations (
        id TEXT PRIMARY KEY,
        professional_id TEXT NOT NULL REFERENCES users(id),
        organizer_id TEXT NOT NULL REFERENCES users(id),
        conference_id TEXT NOT NULL,
        conference_title TEXT NOT NULL,
        invitation_id TEXT,
        ratings TEXT NOT NULL,
        overall_score REAL NOT NULL,
        comment TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(professional_id, organizer_id, conference_id)
      )`);
      await dbRun(`CREATE INDEX IF NOT EXISTS idx_professional_evaluations_professional
        ON professional_evaluations(professional_id, created_at)`);

      await dbRun(`CREATE TABLE IF NOT EXISTS conference_professional_evaluations (
        id TEXT PRIMARY KEY,
        professional_id TEXT NOT NULL REFERENCES users(id),
        conference_id TEXT NOT NULL,
        conference_title TEXT NOT NULL,
        role TEXT NOT NULL,
        ratings TEXT NOT NULL,
        overall_score REAL NOT NULL,
        comment TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(professional_id, conference_id)
      )`);
      await dbRun(`CREATE INDEX IF NOT EXISTS idx_conference_professional_evaluations_conference
        ON conference_professional_evaluations(conference_id, created_at)`);

      await dbRun(`CREATE TABLE IF NOT EXISTS conference_recruitment_drafts (
        id TEXT PRIMARY KEY,
        organizer_id TEXT NOT NULL REFERENCES users(id),
        title TEXT NOT NULL,
        description TEXT,
        start_date TEXT,
        end_date TEXT,
        city TEXT,
        country TEXT,
        topics TEXT NOT NULL DEFAULT '[]',
        official_url TEXT,
        status TEXT NOT NULL DEFAULT 'recruiting' CHECK(status IN ('recruiting','ready','converted','archived')),
        final_conference_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
      await dbRun(`CREATE INDEX IF NOT EXISTS idx_conference_recruitment_drafts_owner
        ON conference_recruitment_drafts(organizer_id, status, created_at)`);

      await dbRun(`CREATE TABLE IF NOT EXISTS submission_documents (
        id TEXT PRIMARY KEY,
        submission_id TEXT NOT NULL REFERENCES submissions(id),
        uploader_id TEXT NOT NULL REFERENCES users(id),
        kind TEXT NOT NULL CHECK(kind IN ('author_original','reviewer_return','organizer_to_author')),
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        data_base64 TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
      await dbRun(`CREATE INDEX IF NOT EXISTS idx_submission_documents_submission
        ON submission_documents(submission_id, created_at)`);
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

function parseArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function itemText(value: any): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  return [
    value.title, value.position, value.role, value.name, value.companyName, value.company,
    value.organization, value.issuer, value.authority, value.description,
  ].filter(Boolean).join(" ");
}

function yearFrom(value: unknown): number | null {
  if (typeof value === "number" && value >= 1900 && value <= 2100) return Math.round(value);
  if (typeof value !== "string") return null;
  const match = value.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function experienceYears(experience: any[]): number {
  const currentYear = new Date().getUTCFullYear();
  let earliest = currentYear;
  let found = false;
  for (const item of experience) {
    if (!item || typeof item !== "object") continue;
    const start = yearFrom(item.startDate || item.start_date || item.startedAt || item.from || item.dateRange || item.duration);
    if (start && start <= currentYear) {
      earliest = Math.min(earliest, start);
      found = true;
    }
  }
  return found ? Math.max(0, Math.min(50, currentYear - earliest)) : 0;
}

function isStudentProfile(user: UserRow, experience: any[]): boolean {
  const evidence = [user.title, user.bio, ...experience.slice(0, 10).map(itemText)].filter(Boolean).join(" ").toLowerCase();
  return /\b(undergraduate|bachelor(?:'s)? student|master(?:'s)? student|msc student|phd student|doctoral student|doctoral candidate|graduate student|student researcher|student intern)\b/i.test(evidence);
}

function isSeniorIndustryOrProfessor(user: UserRow, experience: any[]): boolean {
  const evidence = [user.title, ...experience.slice(0, 15).map(itemText)].filter(Boolean).join(" ").toLowerCase();
  return /\b(professor|associate professor|assistant professor|adjunct professor|lecturer|principal|chief|director|manager|lead|senior|staff (?:scientist|engineer)|research scientist|geoscientist|geologist|engineer|consultant|specialist|advisor|fellow)\b/i.test(evidence);
}

async function loadLinkedInEvidence(userId: string) {
  const row = await dbGet<any>(
    `SELECT verified,experience,publications,certifications,patents,skills
       FROM linkedin_profile_enrichment WHERE user_id=?`,
    [userId]
  ).catch(() => undefined);
  return {
    verified: Boolean(row?.verified),
    experience: parseArray(row?.experience),
    publications: parseArray(row?.publications),
    certifications: parseArray(row?.certifications),
    patents: parseArray(row?.patents),
    skills: parseArray(row?.skills),
  };
}

async function buildProfessionalTrust(userId: string) {
  await initProfessionalTrustSchema();
  const user = await dbGet<UserRow>("SELECT * FROM users WHERE id=?", [userId]);
  if (!user || user.role !== "professional") return null;

  const linkedIn = await loadLinkedInEvidence(userId);
  const years = experienceYears(linkedIn.experience);
  const student = isStudentProfile(user, linkedIn.experience);
  const seniorPath = isSeniorIndustryOrProfessor(user, linkedIn.experience);
  const publicationCount = linkedIn.publications.length;
  const researchQualified = publicationCount >= 5;
  const experienceQualified = years >= 7 || seniorPath;
  const reviewerEligible = !student && (researchQualified || experienceQualified);

  const [reviewRow, roleRow, evalRows] = await Promise.all([
    dbGet<{ count: number }>("SELECT COUNT(*) AS count FROM submission_reviews WHERE reviewer_id=?", [userId]),
    dbGet<{ count: number }>("SELECT COUNT(*) AS count FROM professional_invitations WHERE professional_id=? AND status='completed'", [userId]),
    dbAll<any>("SELECT overall_score,ratings,conference_title,comment,created_at FROM professional_evaluations WHERE professional_id=? ORDER BY created_at DESC", [userId]),
  ]);
  const verifiedReviews = Number(reviewRow?.count || 0);
  const completedRoles = Number(roleRow?.count || 0);
  const evaluationAverage = evalRows.length
    ? evalRows.reduce((sum, row) => sum + Number(row.overall_score || 0), 0) / evalRows.length
    : 0;

  const indexScore = Math.round(Math.min(100,
    (evaluationAverage ? (evaluationAverage / 5) * 40 : 0) +
    Math.min(20, verifiedReviews * 2) +
    Math.min(20, completedRoles * 4) +
    Math.min(10, publicationCount * 1.5) +
    Math.min(10, linkedIn.certifications.length * 2)
  ));

  let eligibilityReason = "Reviewer eligibility requires verified professional evidence.";
  if (student) eligibilityReason = "Student profiles are not eligible for the ConferenceGate reviewer pool.";
  else if (researchQualified) eligibilityReason = `${publicationCount} LinkedIn/imported publications satisfy the research-evidence path.`;
  else if (experienceQualified) eligibilityReason = years >= 7
    ? `${years}+ years of professional experience satisfy the industry/academic experience path without a publication minimum.`
    : "Senior industry or professor-level experience satisfies the professional-experience path without a publication minimum.";
  else eligibilityReason = `Current evidence: ${publicationCount} publications and ${years} years of dated experience. Eligibility needs 5+ publications or established industry/professor experience.`;

  const credentialLevel = evaluationAverage >= 4.5 && evalRows.length >= 3
    ? "distinguished"
    : evaluationAverage >= 4 && evalRows.length >= 2
      ? "trusted"
      : evaluationAverage >= 3.5 && evalRows.length >= 1
        ? "verified"
        : reviewerEligible
          ? "eligible"
          : "developing";

  return {
    professionalId: userId,
    reviewerEligible,
    eligibilityReason,
    studentProfile: student,
    qualificationPath: researchQualified ? "research" : experienceQualified ? "experience" : "none",
    evidence: {
      linkedinVerified: linkedIn.verified,
      publicationCount,
      experienceYears: years,
      certificationCount: linkedIn.certifications.length,
      patentCount: linkedIn.patents.length,
      verifiedReviews,
      completedRoles,
      organizerEvaluations: evalRows.length,
      evaluationAverage: Math.round(evaluationAverage * 100) / 100,
    },
    conferenceGateIndex: indexScore,
    credentialLevel,
    recentEvaluations: evalRows.slice(0, 10).map((row) => ({
      conferenceTitle: row.conference_title,
      overallScore: Number(row.overall_score),
      ratings: (() => { try { return JSON.parse(row.ratings); } catch { return {}; } })(),
      comment: row.comment || "",
      createdAt: row.created_at,
    })),
  };
}

async function organizerContext(req: AuthedRequest, res: Response, write = false) {
  const context = await resolvePaidAccountContext(req.userId!, "organizer");
  if (!context) {
    res.status(403).json({ error: "Organizer account required." });
    return null;
  }
  if (!context.paid) {
    res.status(402).json({ error: "Organizer Pro subscription required." });
    return null;
  }
  if (write && !canOperateWorkspace(context.workspaceRole)) {
    res.status(403).json({ error: "This workspace seat is read-only." });
    return null;
  }
  return context;
}

professionalTrustRouter.get("/me", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const trust = await buildProfessionalTrust(req.userId!);
  if (!trust) return res.status(403).json({ error: "Professional account required." });
  res.json({ trust });
}));

professionalTrustRouter.get("/professionals/:id", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const requester = await dbGet<UserRow>("SELECT * FROM users WHERE id=?", [req.userId!]);
  if (!requester) return res.status(401).json({ error: "Not authenticated" });
  if (requester.role === "organizer") {
    const context = await organizerContext(req, res);
    if (!context) return;
  } else if (requester.id !== req.params.id) {
    return res.status(403).json({ error: "Only the Professional or a paid Organizer workspace can view this trust summary." });
  }
  const trust = await buildProfessionalTrust(req.params.id);
  if (!trust) return res.status(404).json({ error: "Professional not found." });
  res.json({ trust });
}));

professionalTrustRouter.post("/professionals/:id/evaluations", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const context = await organizerContext(req, res, true);
  if (!context) return;
  await initProfessionalTrustSchema();
  const professional = await dbGet<UserRow>("SELECT * FROM users WHERE id=? AND role='professional'", [req.params.id]);
  if (!professional) return res.status(404).json({ error: "Professional not found." });
  const body = req.body || {};
  const conferenceId = String(body.conferenceId || "").trim();
  const conferenceTitle = String(body.conferenceTitle || "").trim();
  if (!conferenceId || !conferenceTitle) return res.status(400).json({ error: "conferenceId and conferenceTitle are required." });
  const ratings = body.ratings && typeof body.ratings === "object" ? body.ratings : {};
  const values = ["expertise","reliability","communication","contribution"].map((key) => Number(ratings[key]));
  if (values.some((value) => !Number.isFinite(value) || value < 1 || value > 5)) {
    return res.status(400).json({ error: "expertise, reliability, communication and contribution ratings must each be 1–5." });
  }
  const overall = Math.round((values.reduce((a,b) => a+b, 0) / values.length) * 100) / 100;
  await dbRun(
    `INSERT INTO professional_evaluations(id,professional_id,organizer_id,conference_id,conference_title,invitation_id,ratings,overall_score,comment)
     VALUES(?,?,?,?,?,?,?,?,?)
     ON CONFLICT(professional_id,organizer_id,conference_id) DO UPDATE SET ratings=excluded.ratings,overall_score=excluded.overall_score,comment=excluded.comment,invitation_id=excluded.invitation_id,created_at=datetime('now')`,
    [`pe_${crypto.randomUUID()}`, professional.id, context.accountId, conferenceId, conferenceTitle, body.invitationId || null, JSON.stringify(ratings), overall, String(body.comment || "").trim() || null]
  );
  await createNotification(professional.id, "followup", "Professional evaluation recorded", `${conferenceTitle} added a verified professional-service evaluation to your ConferenceGate Index.`);
  res.status(201).json({ trust: await buildProfessionalTrust(professional.id) });
}));

professionalTrustRouter.post("/conferences/:id/evaluations", asyncHandler(async (req: AuthedRequest, res: Response) => {
  await initProfessionalTrustSchema();
  const professional = await dbGet<UserRow>("SELECT * FROM users WHERE id=?", [req.userId!]);
  if (!professional || professional.role !== "professional") return res.status(403).json({ error: "Professional account required." });
  const body = req.body || {};
  const conferenceTitle = String(body.conferenceTitle || "").trim();
  const role = String(body.role || "Professional").trim();
  if (!conferenceTitle) return res.status(400).json({ error: "conferenceTitle is required." });
  const ratings = body.ratings && typeof body.ratings === "object" ? body.ratings : {};
  const values = ["scientificQuality","organization","networking","professionalValue"].map((key) => Number(ratings[key]));
  if (values.some((value) => !Number.isFinite(value) || value < 1 || value > 5)) {
    return res.status(400).json({ error: "All conference evaluation ratings must be 1–5." });
  }
  const overall = Math.round((values.reduce((a,b) => a+b, 0) / values.length) * 100) / 100;
  await dbRun(
    `INSERT INTO conference_professional_evaluations(id,professional_id,conference_id,conference_title,role,ratings,overall_score,comment)
     VALUES(?,?,?,?,?,?,?,?)
     ON CONFLICT(professional_id,conference_id) DO UPDATE SET role=excluded.role,ratings=excluded.ratings,overall_score=excluded.overall_score,comment=excluded.comment,created_at=datetime('now')`,
    [`ce_${crypto.randomUUID()}`, professional.id, req.params.id, conferenceTitle, role, JSON.stringify(ratings), overall, String(body.comment || "").trim() || null]
  );
  res.status(201).json({ ok: true, overallScore: overall });
}));

professionalTrustRouter.get("/conferences/:id/evaluations", asyncHandler(async (req: AuthedRequest, res: Response) => {
  await initProfessionalTrustSchema();
  const rows = await dbAll<any>("SELECT overall_score,ratings,role,comment,created_at FROM conference_professional_evaluations WHERE conference_id=? ORDER BY created_at DESC", [req.params.id]);
  const average = rows.length ? rows.reduce((sum,row) => sum + Number(row.overall_score || 0), 0) / rows.length : 0;
  res.json({
    responseCount: rows.length,
    averageScore: Math.round(average * 100) / 100,
    evaluations: rows.slice(0, 50).map((row) => ({ overallScore: Number(row.overall_score), role: row.role, comment: row.comment || "", createdAt: row.created_at }))
  });
}));

function draftDTO(row: any) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    startDate: row.start_date || "",
    endDate: row.end_date || "",
    city: row.city || "",
    country: row.country || "",
    topics: parseArray(row.topics).map(String),
    officialUrl: row.official_url || "",
    status: row.status,
    finalConferenceId: row.final_conference_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

professionalTrustRouter.get("/recruitment-drafts", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const context = await organizerContext(req, res);
  if (!context) return;
  await initProfessionalTrustSchema();
  const rows = await dbAll<any>("SELECT * FROM conference_recruitment_drafts WHERE organizer_id=? AND status!='archived' ORDER BY created_at DESC", [context.accountId]);
  res.json({ drafts: rows.map(draftDTO) });
}));

professionalTrustRouter.post("/recruitment-drafts", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const context = await organizerContext(req, res, true);
  if (!context) return;
  await initProfessionalTrustSchema();
  const body = req.body || {};
  const title = String(body.title || "").trim();
  if (!title) return res.status(400).json({ error: "A basic conference title is required before committee recruitment." });
  const id = `draft_${crypto.randomUUID()}`;
  await dbRun(
    `INSERT INTO conference_recruitment_drafts(id,organizer_id,title,description,start_date,end_date,city,country,topics,official_url)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
    [id, context.accountId, title, String(body.description || "").trim() || null, body.startDate || null, body.endDate || null, String(body.city || "").trim() || null, String(body.country || "").trim() || null, JSON.stringify(Array.isArray(body.topics) ? body.topics : []), String(body.officialUrl || "").trim() || null]
  );
  const row = await dbGet<any>("SELECT * FROM conference_recruitment_drafts WHERE id=?", [id]);
  res.status(201).json({ draft: draftDTO(row) });
}));

professionalTrustRouter.patch("/recruitment-drafts/:id", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const context = await organizerContext(req, res, true);
  if (!context) return;
  await initProfessionalTrustSchema();
  const current = await dbGet<any>("SELECT * FROM conference_recruitment_drafts WHERE id=? AND organizer_id=?", [req.params.id, context.accountId]);
  if (!current) return res.status(404).json({ error: "Recruitment draft not found." });
  const body = req.body || {};
  const next = {
    title: String(body.title ?? current.title).trim(),
    description: String(body.description ?? current.description ?? "").trim() || null,
    startDate: body.startDate ?? current.start_date,
    endDate: body.endDate ?? current.end_date,
    city: String(body.city ?? current.city ?? "").trim() || null,
    country: String(body.country ?? current.country ?? "").trim() || null,
    topics: Array.isArray(body.topics) ? body.topics : parseArray(current.topics),
    officialUrl: String(body.officialUrl ?? current.official_url ?? "").trim() || null,
    status: ["recruiting","ready","converted","archived"].includes(body.status) ? body.status : current.status,
    finalConferenceId: body.finalConferenceId ?? current.final_conference_id,
  };
  if (!next.title) return res.status(400).json({ error: "Conference title cannot be blank." });
  await dbRun(`UPDATE conference_recruitment_drafts SET title=?,description=?,start_date=?,end_date=?,city=?,country=?,topics=?,official_url=?,status=?,final_conference_id=?,updated_at=datetime('now') WHERE id=?`, [next.title,next.description,next.startDate,next.endDate,next.city,next.country,JSON.stringify(next.topics),next.officialUrl,next.status,next.finalConferenceId,req.params.id]);
  const row = await dbGet<any>("SELECT * FROM conference_recruitment_drafts WHERE id=?", [req.params.id]);
  res.json({ draft: draftDTO(row) });
}));

async function submissionAccess(submissionId: string, userId: string) {
  const submission = await dbGet<any>("SELECT * FROM submissions WHERE id=?", [submissionId]);
  if (!submission) return { submission: null, allowed: false, role: "none" };
  if (submission.submitter_id === userId) return { submission, allowed: true, role: "author" };
  const assignment = await dbGet<any>("SELECT id FROM submission_reviewer_assignments WHERE submission_id=? AND reviewer_id=?", [submissionId, userId]);
  if (assignment) return { submission, allowed: true, role: "reviewer" };
  const owned = await dbGet<any>("SELECT organizer_id FROM created_conferences WHERE id=?", [submission.conference_id]);
  if (owned?.organizer_id === userId) return { submission, allowed: true, role: "organizer" };
  const context = await resolvePaidAccountContext(userId, "organizer").catch(() => null);
  if (context && owned?.organizer_id === context.accountId) return { submission, allowed: true, role: "organizer" };
  return { submission, allowed: false, role: "none" };
}

professionalTrustRouter.get("/submissions/:id/documents", asyncHandler(async (req: AuthedRequest, res: Response) => {
  await initProfessionalTrustSchema();
  const access = await submissionAccess(req.params.id, req.userId!);
  if (!access.submission) return res.status(404).json({ error: "Submission not found." });
  if (!access.allowed) return res.status(403).json({ error: "You do not have access to this submission's files." });
  const rows = await dbAll<any>("SELECT id,submission_id,uploader_id,kind,file_name,mime_type,byte_size,created_at FROM submission_documents WHERE submission_id=? ORDER BY created_at ASC", [req.params.id]);
  res.json({ documents: rows.map((row) => ({ id: row.id, submissionId: row.submission_id, uploaderId: row.uploader_id, kind: row.kind, fileName: row.file_name, mimeType: row.mime_type, byteSize: Number(row.byte_size), createdAt: row.created_at })) });
}));

professionalTrustRouter.get("/submissions/:id/documents/:documentId", asyncHandler(async (req: AuthedRequest, res: Response) => {
  await initProfessionalTrustSchema();
  const access = await submissionAccess(req.params.id, req.userId!);
  if (!access.allowed) return res.status(access.submission ? 403 : 404).json({ error: access.submission ? "Forbidden" : "Submission not found." });
  const row = await dbGet<any>("SELECT * FROM submission_documents WHERE id=? AND submission_id=?", [req.params.documentId, req.params.id]);
  if (!row) return res.status(404).json({ error: "Document not found." });
  res.json({ document: { id: row.id, kind: row.kind, fileName: row.file_name, mimeType: row.mime_type, byteSize: Number(row.byte_size), dataBase64: row.data_base64, createdAt: row.created_at } });
}));

professionalTrustRouter.post("/submissions/:id/documents", asyncHandler(async (req: AuthedRequest, res: Response) => {
  await initProfessionalTrustSchema();
  const access = await submissionAccess(req.params.id, req.userId!);
  if (!access.submission) return res.status(404).json({ error: "Submission not found." });
  if (!access.allowed) return res.status(403).json({ error: "You do not have access to this submission." });
  const body = req.body || {};
  const requestedKind = String(body.kind || "");
  const allowedKind = access.role === "author" ? "author_original" : access.role === "reviewer" ? "reviewer_return" : "organizer_to_author";
  if (requestedKind && requestedKind !== allowedKind) return res.status(403).json({ error: `Your role can only upload ${allowedKind} documents.` });
  const fileName = String(body.fileName || "").trim().slice(0, 240);
  const mimeType = String(body.mimeType || "").trim().toLowerCase();
  const dataBase64 = String(body.dataBase64 || "").replace(/^data:[^;]+;base64,/, "").trim();
  if (!fileName || !ALLOWED_DOCUMENT_MIME.has(mimeType) || !dataBase64) return res.status(400).json({ error: "Upload a PDF, DOC, or DOCX file." });
  const estimatedBytes = Math.floor((dataBase64.length * 3) / 4);
  if (estimatedBytes <= 0 || estimatedBytes > MAX_DOCUMENT_BYTES) return res.status(413).json({ error: "Abstract/review files must be 5 MB or smaller." });
  const id = `doc_${crypto.randomUUID()}`;
  await dbRun("INSERT INTO submission_documents(id,submission_id,uploader_id,kind,file_name,mime_type,byte_size,data_base64) VALUES(?,?,?,?,?,?,?,?)", [id, req.params.id, req.userId!, allowedKind, fileName, mimeType, estimatedBytes, dataBase64]);

  if (access.role === "reviewer") {
    const owned = await dbGet<any>("SELECT organizer_id FROM created_conferences WHERE id=?", [access.submission.conference_id]);
    if (owned?.organizer_id) await createNotification(owned.organizer_id, "followup", "Reviewed abstract file returned", `A reviewer returned ${fileName} for “${access.submission.title}”. Open the abstract workflow to review and forward it to the author.`);
  } else if (access.role === "organizer") {
    await createNotification(access.submission.submitter_id, "followup", "Reviewed abstract file from organizer", `${access.submission.conference_title} sent ${fileName} for “${access.submission.title}”.`);
  }
  res.status(201).json({ document: { id, submissionId: req.params.id, uploaderId: req.userId!, kind: allowedKind, fileName, mimeType, byteSize: estimatedBytes, createdAt: new Date().toISOString() } });
}));
