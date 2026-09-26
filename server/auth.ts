import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import { dbAll, dbGet, dbRun, UserRow } from "./db";
import { asyncHandler } from "./asyncHandler";
import { copyLinkedInAvatarToDataUrl } from "./linkedinAvatar";
import { resolvePaidAccountContext } from "./workspaceAccess";
import { isOwnerPreviewEmail } from "./ownerPreview";

// If JWT_SECRET isn't set in the environment, generate one on first boot and persist it in
// the database — otherwise every server restart (a redeploy, a host spinning down an idle
// instance, etc.) would mint a new secret and silently log out every signed-in user.
// Resolved once during server startup via initAuthSecret() (see server.ts) rather than at
// module-load time, since resolving it now requires an async database round-trip.
let JWT_SECRET: string | null = null;

export async function initAuthSecret(): Promise<void> {
  if (process.env.JWT_SECRET) {
    JWT_SECRET = process.env.JWT_SECRET;
    return;
  }

  const existing = await dbGet<{ value: string }>("SELECT value FROM app_secrets WHERE key = 'jwt_secret'");
  if (existing) {
    JWT_SECRET = existing.value;
    return;
  }

  const generated = crypto.randomBytes(48).toString("hex");
  await dbRun("INSERT INTO app_secrets (key, value) VALUES ('jwt_secret', ?)", [generated]);
  console.warn(
    "[auth] JWT_SECRET is not set — generated a secret and persisted it in the database so " +
      "sessions survive restarts. Set JWT_SECRET in your environment for full control over rotation."
  );
  JWT_SECRET = generated;
}

function getJwtSecret(): string {
  if (!JWT_SECRET) {
    throw new Error("JWT secret has not been initialized yet — initAuthSecret() must be awaited at startup.");
  }
  return JWT_SECRET;
}

export const COOKIE_NAME = "cg_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const ALLOWED_ROLES = ["professional", "organizer", "sponsor"] as const;
type AuthRole = (typeof ALLOWED_ROLES)[number];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_ATTEMPTS = 30;
const authAttempts = new Map<string, { count: number; resetAt: number }>();

function authRateLimit(req: Request, res: Response, next: NextFunction) {
  const now = Date.now();
  const key = String(req.ip || req.socket.remoteAddress || "unknown");
  const current = authAttempts.get(key);
  const bucket =
    !current || current.resetAt <= now
      ? { count: 0, resetAt: now + AUTH_WINDOW_MS }
      : current;
  bucket.count += 1;
  authAttempts.set(key, bucket);

  // Opportunistic cleanup keeps this lightweight map bounded on a single-instance deployment.
  if (authAttempts.size > 5000) {
    for (const [ip, value] of authAttempts) {
      if (value.resetAt <= now) authAttempts.delete(ip);
    }
  }

  if (bucket.count > AUTH_MAX_ATTEMPTS) {
    const retrySeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retrySeconds));
    return res.status(429).json({ error: "Too many authentication attempts. Please try again later." });
  }
  next();
}


interface KeynoteSpeakerIdentityMatch {
  conferenceTitle: string;
  conferenceUrl: string;
  speakerName: string;
  role: string;
  organization: string | null;
  photoUrl: string | null;
  sourceUrl: string;
  matchMethod: "email" | "exact_name";
  verified: boolean;
}

function normalizeIdentityName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(?:dr|prof|professor|mr|mrs|ms|miss|sir|phd|md|dds|dvm|jr|sr)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

function parseJsonArray(value: unknown): any[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: unknown): Record<string, any> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function findKeynoteSpeakerMatches(row: UserRow): Promise<KeynoteSpeakerIdentityMatch[]> {
  const normalizedUserName = normalizeIdentityName(row.name);
  const normalizedUserEmail = row.email.trim().toLowerCase();
  if (!normalizedUserName && !normalizedUserEmail) return [];

  const records = await dbAll<{
    source_url: string;
    overview: string;
    keynote_speakers: string;
    updated_at: string;
  }>(
    `SELECT source_url, overview, keynote_speakers, updated_at
       FROM extracted_conferences
      WHERE keynote_speakers IS NOT NULL
        AND keynote_speakers <> '[]'
      ORDER BY updated_at DESC
      LIMIT 500`
  );

  const matches = new Map<string, KeynoteSpeakerIdentityMatch>();
  for (const record of records) {
    const overview = parseJsonObject(record.overview);
    const conferenceTitle =
      typeof overview.conference_name === "string" && overview.conference_name.trim()
        ? overview.conference_name.trim()
        : record.source_url;

    for (const speaker of parseJsonArray(record.keynote_speakers)) {
      const speakerName =
        typeof speaker?.full_name === "string"
          ? speaker.full_name.trim()
          : typeof speaker?.name === "string"
            ? speaker.name.trim()
            : "";
      const role =
        typeof speaker?.speaker_type === "string"
          ? speaker.speaker_type.trim()
          : typeof speaker?.role === "string"
            ? speaker.role.trim()
            : "";
      // The Keynote Speakers tab also contains invited/plenary/featured speakers. Panelists and
      // ordinary presenters must never be upgraded into keynote recognition.
      if (!speakerName || !/\b(keynote|plenary|invited|featured)\b/i.test(role)) continue;

      const speakerEmail =
        typeof speaker?.email === "string" ? speaker.email.trim().toLowerCase() : "";
      const emailMatch = Boolean(speakerEmail && speakerEmail === normalizedUserEmail);
      const nameMatch =
        normalizedUserName.split(" ").length >= 2 &&
        normalizeIdentityName(speakerName) === normalizedUserName;
      if (!emailMatch && !nameMatch) continue;

      const sourceUrl =
        (typeof speaker?.profile_source_url === "string" && speaker.profile_source_url) ||
        (typeof speaker?.source_url === "string" && speaker.source_url) ||
        record.source_url;
      const match: KeynoteSpeakerIdentityMatch = {
        conferenceTitle,
        conferenceUrl: record.source_url,
        speakerName,
        role: role || "Keynote Speaker",
        organization:
          typeof speaker?.organization === "string" && speaker.organization.trim()
            ? speaker.organization.trim()
            : null,
        photoUrl:
          typeof speaker?.photo_url === "string" && speaker.photo_url.trim()
            ? speaker.photo_url.trim()
            : null,
        sourceUrl,
        matchMethod: emailMatch ? "email" : "exact_name",
        verified: emailMatch,
      };
      const key = `${record.source_url}::${normalizeIdentityName(speakerName)}`;
      const existing = matches.get(key);
      if (!existing || (!existing.verified && match.verified)) matches.set(key, match);
    }
  }

  return [...matches.values()];
}

async function toPublicUser(row: UserRow) {
  const keynoteSpeakerMatches = await findKeynoteSpeakerMatches(row);
  const ownerPreview = isOwnerPreviewEmail(row.email);
  const paidContext =
    row.role === "organizer" || row.role === "sponsor"
      ? await resolvePaidAccountContext(row.id, row.role)
      : ownerPreview
        ? await resolvePaidAccountContext(row.id)
        : null;
  const billingOwner = paidContext?.accountOwner || row;
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    name: row.name,
    organization: row.organization,
    title: row.title,
    department: row.department,
    city: row.city,
    country: row.country,
    bio: row.bio,
    linkedinUrl: row.linkedin_url,
    avatar: row.avatar,
    identityVerified: Boolean(row.linkedin_id || row.google_id),
    identityVerificationMethod: row.linkedin_id ? "LinkedIn" : row.google_id ? "Google" : null,
    ownerPreview,
    subscriptionStatus: ownerPreview
      ? "owner_preview"
      : row.role === "professional"
        ? "free"
        : (billingOwner.subscription_status || "required"),
    subscriptionPlan: ownerPreview
      ? "owner_preview"
      : billingOwner.subscription_plan || (row.role === "professional" ? "professional_free" : null),
    subscriptionProvider: ownerPreview ? "owner_preview" : (billingOwner.subscription_provider || null),
    subscriptionPeriodEnd: billingOwner.subscription_period_end || null,
    hasPaidAccess: ownerPreview || row.role === "professional" || Boolean(paidContext?.paid),
    workspaceId: paidContext?.workspaceId || null,
    workspaceRole: paidContext?.workspaceRole || null,
    workspaceOwnerId: paidContext?.accountId || null,
    reviewerAvailable: !!row.reviewer_available,
    professionalExpertise: parseJsonArray(row.professional_expertise).filter((v) => typeof v === "string"),
    technicalSpecialization: parseJsonArray(row.technical_specialization).filter((v) => typeof v === "string"),
    researchInterests: parseJsonArray(row.research_interests).filter((v) => typeof v === "string"),
    preferredRegions: parseJsonArray(row.preferred_regions).filter((v) => typeof v === "string"),
    committeeAvailable: !!row.committee_available,
    sessionChairAvailable: !!row.session_chair_available,
    speakerAvailable: !!row.speaker_available,
    reviewerMaxLoad: Number(row.reviewer_max_load || 5),
    keynoteSpeakerMatches,
  };
}

// Accepts a bare username ("jsmith"), a profile path ("in/jsmith"), or a full URL, and always
// stores a real, clickable linkedin.com URL — never guesses or invents one.
function normalizeLinkedInUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim().replace(/^@/, "");
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  value = value.replace(/^(www\.)?linkedin\.com\//i, "").replace(/^in\//i, "");
  if (!value) return null;
  return `https://www.linkedin.com/in/${value}`;
}

function signToken(userId: string) {
  return jwt.sign({ sub: userId }, getJwtSecret(), { expiresIn: "7d" });
}

function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

export interface AuthedRequest extends Request {
  userId?: string;
}

/** Verifies a raw session JWT (used for both the HTTP cookie and the WebSocket handshake) and returns the user id, or null if invalid/expired. */
export function verifySessionToken(token: string | undefined | null): string | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, getJwtSecret()) as { sub: string };
    return payload.sub;
  } catch {
    return null;
  }
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const userId = verifySessionToken(req.cookies?.[COOKIE_NAME]);
  if (!userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  req.userId = userId;
  next();
}

export function publicUserSummary(row: UserRow) {
  return {
    id: row.id,
    name: row.name,
    avatar: row.avatar,
    title: row.title,
    organization: row.organization,
  };
}

export const authRouter = Router();

authRouter.post("/signup", authRateLimit, asyncHandler(async (req, res) => {
  const { role, name, email, password, organization, title, linkedinUrl } = req.body || {};

  if (typeof role !== "string" || !ALLOWED_ROLES.includes(role.toLowerCase() as AuthRole)) {
    return res.status(400).json({ error: "role must be one of: professional, organizer, sponsor" });
  }
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Full name is required" });
  }
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: "A valid email is required" });
  }
  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await dbGet("SELECT id FROM users WHERE email = ?", [normalizedEmail]);
  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  const id = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync(password, 10);
  const normalizedRole = role.toLowerCase() as AuthRole;

  await dbRun(
    `INSERT INTO users (id, email, password_hash, role, name, organization, title, linkedin_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      normalizedEmail,
      passwordHash,
      normalizedRole,
      name.trim(),
      typeof organization === "string" && organization.trim() ? organization.trim() : null,
      typeof title === "string" && title.trim() ? title.trim() : null,
      normalizeLinkedInUrl(linkedinUrl),
    ]
  );

  const row = (await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [id]))!;
  const token = signToken(row.id);
  setSessionCookie(res, token);
  res.status(201).json({ user: await toPublicUser(row) });
}));

authRouter.post("/login", authRateLimit, asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const row = await dbGet<UserRow>("SELECT * FROM users WHERE email = ?", [normalizedEmail]);
  if (!row) {
    if (isOwnerPreviewEmail(normalizedEmail)) {
      return res.status(409).json({
        code: "OWNER_ACCOUNT_NOT_INITIALIZED",
        error: "Your ConferenceGate owner account needs to be created once on the new database.",
      });
    }
    return res.status(401).json({ error: "Invalid email or password" });
  }
  if (!row.password_hash) {
    return res.status(401).json({ error: "This account uses Google Sign-In. Please continue with Google." });
  }
  if (!bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = signToken(row.id);
  setSessionCookie(res, token);
  res.json({ user: await toPublicUser(row) });
}));


function configuredOwnerPasswordResetTokenMatches(candidate: unknown): boolean {
  const configured = process.env.OWNER_PASSWORD_RESET_TOKEN?.trim();
  if (!configured || configured.length < 32 || typeof candidate !== "string" || !candidate) return false;
  const expected = crypto.createHash("sha256").update(configured).digest();
  const actual = crypto.createHash("sha256").update(candidate).digest();
  return crypto.timingSafeEqual(expected, actual);
}

function ownerPasswordResetUseKey(token: string): string {
  const digest = crypto.createHash("sha256").update(token).digest("hex");
  return `owner_password_reset_used_\${digest.slice(0, 40)}`;
}

// Emergency one-time owner recovery. The secret token is supplied only through Render's
// environment and is placed in the browser URL fragment, so it is not sent in GET request logs.
// A successful reset marks that token as used in the database and signs the owner in immediately.
authRouter.get("/owner-password-reset", (_req, res) => {
  if (!process.env.OWNER_PASSWORD_RESET_TOKEN?.trim()) {
    return res.status(404).send("Password recovery is not enabled.");
  }
  res.setHeader("Cache-Control", "no-store");
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>ConferenceGate Owner Password Recovery</title>
<style>
body{font-family:Arial,sans-serif;background:#f5f7fb;margin:0;padding:40px;color:#172554}
.card{max-width:460px;margin:6vh auto;background:#fff;padding:32px;border-radius:18px;box-shadow:0 12px 40px rgba(15,23,42,.12)}
h1{font-size:24px;margin:0 0 10px}.note{color:#64748b;line-height:1.5;margin-bottom:24px}
label{display:block;font-weight:700;margin:14px 0 7px}input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #cbd5e1;border-radius:10px;font-size:16px}
button{width:100%;margin-top:22px;padding:13px;border:0;border-radius:999px;background:#1e40af;color:white;font-size:16px;font-weight:700;cursor:pointer}
#status{margin-top:16px;line-height:1.4}.error{color:#b91c1c}.ok{color:#166534}
</style>
</head>
<body><div class="card">
<h1>Reset ConferenceGate password</h1>
<p class="note">This one-time recovery keeps the existing owner account and all profile data. Enter a new password below.</p>
<form id="resetForm">
<label for="password">New password</label><input id="password" type="password" minlength="8" autocomplete="new-password" required />
<label for="confirm">Confirm password</label><input id="confirm" type="password" minlength="8" autocomplete="new-password" required />
<button type="submit">Reset password and sign in</button>
</form>
<div id="status"></div>
</div>
<script>
const params = new URLSearchParams(location.hash.replace(/^#/, ""));
const token = params.get("token") || "";
history.replaceState(null, "", location.pathname);
const form = document.getElementById("resetForm");
const status = document.getElementById("status");
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  status.className = "";
  status.textContent = "";
  const password = document.getElementById("password").value;
  const confirm = document.getElementById("confirm").value;
  if (!token) { status.className = "error"; status.textContent = "Recovery token is missing."; return; }
  if (password.length < 8) { status.className = "error"; status.textContent = "Password must be at least 8 characters."; return; }
  if (password !== confirm) { status.className = "error"; status.textContent = "Passwords do not match."; return; }
  const button = form.querySelector("button");
  button.disabled = true;
  button.textContent = "Resetting…";
  try {
    const response = await fetch("/api/auth/owner-password-reset", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      credentials: "include",
      body: JSON.stringify({token, newPassword: password})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Password reset failed.");
    status.className = "ok";
    status.textContent = "Password reset complete. Signing you in…";
    setTimeout(() => location.href = "/", 800);
  } catch (error) {
    status.className = "error";
    status.textContent = error instanceof Error ? error.message : "Password reset failed.";
    button.disabled = false;
    button.textContent = "Reset password and sign in";
  }
});
</script>
</body></html>`);
});

authRouter.post("/owner-password-reset", authRateLimit, asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!configuredOwnerPasswordResetTokenMatches(token)) {
    return res.status(403).json({ error: "This password recovery link is invalid." });
  }
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const useKey = ownerPasswordResetUseKey(token);
  const alreadyUsed = await dbGet<{ value: string }>("SELECT value FROM app_secrets WHERE key = ?", [useKey]);
  if (alreadyUsed) {
    return res.status(410).json({ error: "This password recovery link has already been used." });
  }

  const users = await dbAll<UserRow>("SELECT * FROM users");
  const ownerRows = users.filter((candidate) => isOwnerPreviewEmail(candidate.email));
  if (ownerRows.length !== 1) {
    return res.status(409).json({ error: "The owner account could not be uniquely identified. Recovery stopped without changing any account." });
  }

  const owner = ownerRows[0];
  const passwordHash = bcrypt.hashSync(newPassword, 10);
  await dbRun("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, owner.id]);
  await dbRun("INSERT INTO app_secrets (key, value) VALUES (?, ?)", [useKey, new Date().toISOString()]);

  const refreshed = (await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [owner.id]))!;
  const sessionToken = signToken(refreshed.id);
  setSessionCookie(res, sessionToken);
  console.warn("[auth] One-time owner password recovery completed successfully.");
  res.json({ ok: true, user: await toPublicUser(refreshed) });
}));

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const row = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [req.userId]);
  if (!row) {
    res.clearCookie(COOKIE_NAME, { path: "/" });
    return res.status(401).json({ error: "Not authenticated" });
  }
  res.json({ user: await toPublicUser(row) });
}));

const EDITABLE_PROFILE_FIELDS = ["name", "title", "organization", "department", "city", "country", "bio"] as const;
const MAX_BIO_LENGTH = 600;

authRouter.patch("/me", requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const body = req.body || {};
  const updates: Record<string, string | null> = {};

  for (const field of EDITABLE_PROFILE_FIELDS) {
    if (!(field in body)) continue;
    const value = body[field];
    if (value !== null && typeof value !== "string") {
      return res.status(400).json({ error: `${field} must be a string or null` });
    }
    const trimmed = typeof value === "string" ? value.trim() : null;
    if (field === "name" && !trimmed) {
      return res.status(400).json({ error: "Full name cannot be empty" });
    }
    if (field === "bio" && trimmed && trimmed.length > MAX_BIO_LENGTH) {
      return res.status(400).json({ error: `Bio must be ${MAX_BIO_LENGTH} characters or fewer` });
    }
    updates[field] = trimmed || null;
  }

  if ("linkedinUrl" in body) {
    if (body.linkedinUrl !== null && typeof body.linkedinUrl !== "string") {
      return res.status(400).json({ error: "linkedinUrl must be a string or null" });
    }
    updates.linkedin_url = normalizeLinkedInUrl(body.linkedinUrl);
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "No valid fields to update" });
  }

  const setClause = Object.keys(updates)
    .map((field) => `${field} = ?`)
    .join(", ");
  await dbRun(`UPDATE users SET ${setClause} WHERE id = ?`, [...Object.values(updates), req.userId!]);

  const row = (await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [req.userId]))!;
  res.json({ user: await toPublicUser(row) });
}));

authRouter.patch("/me/reviewer-availability", requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const body = req.body || {};
  if (typeof body.available !== "boolean") {
    return res.status(400).json({ error: "available must be a boolean" });
  }
  await dbRun("UPDATE users SET reviewer_available = ? WHERE id = ?", [body.available ? 1 : 0, req.userId!]);
  const row = (await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [req.userId]))!;
  res.json({ user: await toPublicUser(row) });
}));

authRouter.patch("/me/professional-preferences", requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const current = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [req.userId]);
  if (!current) return res.status(401).json({ error: "Not authenticated" });
  if (current.role !== "professional") {
    return res.status(403).json({ error: "Professional preferences are available to professional accounts." });
  }

  const body = req.body || {};
  const normalizeList = (value: unknown, field: string, max = 20) => {
    if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
    return [...new Set(
      value
        .filter((item) => typeof item === "string")
        .map((item) => String(item).trim())
        .filter(Boolean)
    )].slice(0, max);
  };

  let expertise: string[];
  let specialization: string[];
  let interests: string[];
  let regions: string[];
  try {
    expertise = normalizeList(body.professionalExpertise ?? [], "professionalExpertise");
    specialization = normalizeList(body.technicalSpecialization ?? [], "technicalSpecialization");
    interests = normalizeList(body.researchInterests ?? [], "researchInterests");
    regions = normalizeList(body.preferredRegions ?? [], "preferredRegions", 12);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid professional preferences" });
  }

  for (const field of ["committeeAvailable", "sessionChairAvailable", "speakerAvailable"] as const) {
    if (typeof body[field] !== "boolean") {
      return res.status(400).json({ error: `${field} must be a boolean` });
    }
  }

  const maxLoad = Number(body.reviewerMaxLoad);
  if (!Number.isInteger(maxLoad) || maxLoad < 1 || maxLoad > 50) {
    return res.status(400).json({ error: "reviewerMaxLoad must be an integer between 1 and 50" });
  }

  await dbRun(
    `UPDATE users
        SET professional_expertise = ?,
            technical_specialization = ?,
            research_interests = ?,
            preferred_regions = ?,
            committee_available = ?,
            session_chair_available = ?,
            speaker_available = ?,
            reviewer_max_load = ?
      WHERE id = ?`,
    [
      JSON.stringify(expertise),
      JSON.stringify(specialization),
      JSON.stringify(interests),
      JSON.stringify(regions),
      body.committeeAvailable ? 1 : 0,
      body.sessionChairAvailable ? 1 : 0,
      body.speakerAvailable ? 1 : 0,
      maxLoad,
      req.userId!,
    ]
  );

  const row = (await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [req.userId]))!;
  res.json({ user: await toPublicUser(row) });
}));

const MAX_AVATAR_LENGTH = 2_000_000; // ~1.5MB decoded, comfortably under the request body limit

authRouter.post("/avatar", requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const { avatar } = req.body || {};

  if (avatar !== null && typeof avatar !== "string") {
    return res.status(400).json({ error: "avatar must be a data URL string or null" });
  }
  if (typeof avatar === "string") {
    if (!avatar.startsWith("data:image/")) {
      return res.status(400).json({ error: "avatar must be an image data URL" });
    }
    if (avatar.length > MAX_AVATAR_LENGTH) {
      return res.status(400).json({ error: "Image is too large" });
    }
  }

  await dbRun("UPDATE users SET avatar = ? WHERE id = ?", [avatar, req.userId!]);

  // Remember an explicit member choice so future LinkedIn auto-sync never overwrites a
  // photo the member intentionally uploaded or intentionally removed.
  await dbRun(
    "INSERT OR REPLACE INTO app_secrets (key, value) VALUES (?, ?)",
    [
      `manual_avatar_override:${req.userId!}`,
      avatar ? "custom" : "removed",
    ],
  );

  const row = (await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [req.userId]))!;
  res.json({ user: await toPublicUser(row) });
}));

const googleClient = process.env.GOOGLE_OAUTH_CLIENT_ID ? new OAuth2Client(process.env.GOOGLE_OAUTH_CLIENT_ID) : null;

authRouter.post("/google", authRateLimit, asyncHandler(async (req, res) => {
  const { credential, role } = req.body || {};

  if (!googleClient) {
    return res.status(503).json({ error: "Google Sign-In is not configured on the server." });
  }
  if (typeof credential !== "string" || !credential) {
    return res.status(400).json({ error: "Missing Google credential." });
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_OAUTH_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: "Could not verify Google sign-in. Please try again." });
  }

  if (!payload?.sub || !payload.email) {
    return res.status(401).json({ error: "Google did not return the expected account details." });
  }

  const googleId = payload.sub;
  const email = payload.email.toLowerCase();
  const name = payload.name || email;
  const picture = payload.picture || null;

  let row = await dbGet<UserRow>("SELECT * FROM users WHERE google_id = ?", [googleId]);

  if (!row) {
    const byEmail = await dbGet<UserRow>("SELECT * FROM users WHERE email = ?", [email]);
    if (byEmail) {
      await dbRun("UPDATE users SET google_id = ? WHERE id = ?", [googleId, byEmail.id]);
      row = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [byEmail.id]);
    }
  }

  if (!row) {
    if (typeof role !== "string" || !ALLOWED_ROLES.includes(role.toLowerCase() as AuthRole)) {
      return res.json({
        needsRole: true,
        google: { name, email, avatar: picture },
      });
    }

    const id = crypto.randomUUID();
    const normalizedRole = role.toLowerCase() as AuthRole;
    await dbRun(
      `INSERT INTO users (id, email, password_hash, google_id, role, name, avatar)
       VALUES (?, ?, NULL, ?, ?, ?, ?)`,
      [id, email, googleId, normalizedRole, name, picture]
    );
    row = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [id]);
  }

  const token = signToken(row!.id);
  setSessionCookie(res, token);
  res.json({ user: await toPublicUser(row!) });
}));

// --- LinkedIn Sign-In (OAuth 2.0 authorization code + OpenID Connect) ---
//
// Unlike Google Identity Services, LinkedIn has no client-side-only flow that yields a
// verifiable token in the browser — it's a standard redirect: we send the browser to
// LinkedIn's consent screen, LinkedIn redirects back here with a one-time code, and the
// server exchanges that code for an access token and then the person's real name/email/photo
// via LinkedIn's own OpenID Connect userinfo endpoint. LinkedIn's API has no scope that
// returns publications, certifications, or conference history for any third-party app, so
// this can only ever supply identity fields — never abstracts/conferences/certificates,
// which continue to come from Conference Gate's own real records.
const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID || null;
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET || null;
const LINKEDIN_STATE_COOKIE = "cg_li_state";
const LINKEDIN_PENDING_COOKIE = "cg_li_pending";
const LINKEDIN_LINK_COOKIE = "cg_li_link_user";
const LINKEDIN_OAUTH_TTL_MS = 10 * 60 * 1000; // 10 minutes — just long enough to complete the redirect round trip

function linkedinRedirectUri(req: Request): string {
  const base = (process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  return `${base}/api/auth/linkedin/callback`;
}

function readLinkedInLinkUser(req: Request): string | null {
  const token = req.cookies?.[LINKEDIN_LINK_COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, getJwtSecret()) as { userId?: string };
    return typeof payload.userId === "string" && payload.userId ? payload.userId : null;
  } catch {
    return null;
  }
}

async function persistAuthenticatedLinkedInPicture(
  userId: string,
  picture: string | null,
): Promise<string | null> {
  if (!picture || !/^https:\/\//i.test(picture)) return null;

  // Prefer a ConferenceGate-owned copy, but keep the authenticated LinkedIn image URL as a
  // temporary fallback if LinkedIn's CDN refuses the server-side copy. This is still safer than
  // falling back to a conference/company logo.
  const ownedAvatar = await copyLinkedInAvatarToDataUrl(picture);
  const avatar = ownedAvatar || picture;

  // Respect an explicit member choice made through Change Photo / Remove Photo.
  const manualOverride = await dbGet<{ value: string }>(
    "SELECT value FROM app_secrets WHERE key = ?",
    [`manual_avatar_override:${userId}`],
  );

  if (!manualOverride) {
    await dbRun("UPDATE users SET avatar = ? WHERE id = ?", [avatar, userId]);
  }

  // When the member already has a LinkedIn enrichment row, keep the authenticated portrait there
  // as well. This lets the Professional profile render the saved LinkedIn picture immediately from
  // Turso on later logins without another scrape.
  const enrichmentTable = await dbGet<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='linkedin_profile_enrichment' LIMIT 1",
  );
  if (enrichmentTable) {
    await dbRun(
      "UPDATE linkedin_profile_enrichment SET photo_url = ? WHERE user_id = ?",
      [avatar, userId],
    );
  }

  return avatar;
}

authRouter.get("/linkedin/start", (req, res) => {
  if (!LINKEDIN_CLIENT_ID || !LINKEDIN_CLIENT_SECRET) {
    return res.redirect("/?authError=linkedin_not_configured");
  }

  const state = crypto.randomBytes(16).toString("hex");
  res.cookie(LINKEDIN_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: LINKEDIN_OAUTH_TTL_MS,
    path: "/",
  });

  // If this flow starts while the member is already signed in, remember that exact account.
  // The callback can then link/sync LinkedIn to it even when the ConferenceGate and LinkedIn
  // email addresses differ. Logged-out use remains a normal LinkedIn sign-in/signup flow.
  const linkingUserId = verifySessionToken(req.cookies?.[COOKIE_NAME]);
  if (linkingUserId) {
    const linkToken = jwt.sign({ userId: linkingUserId }, getJwtSecret(), { expiresIn: "10m" });
    res.cookie(LINKEDIN_LINK_COOKIE, linkToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: LINKEDIN_OAUTH_TTL_MS,
      path: "/",
    });
  } else {
    res.clearCookie(LINKEDIN_LINK_COOKIE, { path: "/" });
  }

  const params = new URLSearchParams({
    response_type: "code",
    client_id: LINKEDIN_CLIENT_ID,
    redirect_uri: linkedinRedirectUri(req),
    scope: "openid profile email",
    state,
  });
  res.redirect(`https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`);
});

authRouter.get("/linkedin/callback", asyncHandler(async (req, res) => {
  const { code, state, error } = req.query as Record<string, string | undefined>;
  const cookieState = req.cookies?.[LINKEDIN_STATE_COOKIE];
  const linkingUserId = readLinkedInLinkUser(req);
  res.clearCookie(LINKEDIN_STATE_COOKIE, { path: "/" });
  res.clearCookie(LINKEDIN_LINK_COOKIE, { path: "/" });

  if (error || !code || !state || !cookieState || state !== cookieState || !LINKEDIN_CLIENT_ID || !LINKEDIN_CLIENT_SECRET) {
    return res.redirect("/?authError=linkedin_failed");
  }

  try {
    const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: linkedinRedirectUri(req),
        client_id: LINKEDIN_CLIENT_ID,
        client_secret: LINKEDIN_CLIENT_SECRET,
      }),
    });
    const tokenText = await tokenRes.text();
    const tokenBody = tokenText ? JSON.parse(tokenText) : {};
    if (!tokenRes.ok || typeof tokenBody.access_token !== "string") {
      return res.redirect("/?authError=linkedin_failed");
    }

    const profileRes = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    const profileText = await profileRes.text();
    const profile = profileText ? JSON.parse(profileText) : {};
    if (!profileRes.ok || typeof profile.sub !== "string") {
      return res.redirect("/?authError=linkedin_failed");
    }

    const linkedinId: string = profile.sub;
    const email: string | null = typeof profile.email === "string" ? profile.email.toLowerCase() : null;
    const name: string = profile.name || email || "LinkedIn Member";
    const picture: string | null = typeof profile.picture === "string" ? profile.picture : null;

    // LinkedIn OpenID Connect is the most reliable source of the signed-in member's own
    // portrait. Persist it for the matched ConferenceGate account once that account is resolved.

    // A signed-in member explicitly starting LinkedIn OAuth is linking/syncing that exact
    // ConferenceGate account. This avoids relying on the two services sharing the same email.
    if (linkingUserId) {
      const linkingRow = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [linkingUserId]);
      if (!linkingRow) {
        return res.redirect("/?authError=linkedin_failed");
      }

      const alreadyLinked = await dbGet<UserRow>("SELECT * FROM users WHERE linkedin_id = ?", [linkedinId]);
      if (alreadyLinked && alreadyLinked.id !== linkingRow.id) {
        return res.redirect("/?authError=linkedin_already_linked");
      }

      await dbRun("UPDATE users SET linkedin_id = ? WHERE id = ?", [linkedinId, linkingRow.id]);
      await persistAuthenticatedLinkedInPicture(linkingRow.id, picture);

      const refreshed = (await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [linkingRow.id]))!;
      const token = signToken(refreshed.id);
      setSessionCookie(res, token);
      return res.redirect("/?linkedinSynced=1");
    }

    let row = await dbGet<UserRow>("SELECT * FROM users WHERE linkedin_id = ?", [linkedinId]);

    if (!row && email) {
      const byEmail = await dbGet<UserRow>("SELECT * FROM users WHERE email = ?", [email]);
      if (byEmail) {
        await dbRun("UPDATE users SET linkedin_id = ? WHERE id = ?", [linkedinId, byEmail.id]);
        await persistAuthenticatedLinkedInPicture(byEmail.id, picture);
        row = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [byEmail.id]);
      }
    }

    if (row) {
      await persistAuthenticatedLinkedInPicture(row.id, picture);
      row = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [row.id]);
      const token = signToken(row!.id);
      setSessionCookie(res, token);
      return res.redirect("/?linkedinSynced=1");
    }

    // Brand-new account — stash only the short-lived LinkedIn picture URL in the signed cookie.
    // After the person chooses a role, the server downloads/copies it into ConferenceGate before
    // the account is written. We never persist the LinkedIn CDN URL as the account avatar.
    const pendingToken = jwt.sign({ linkedinId, name, email, avatar: picture }, getJwtSecret(), {
      expiresIn: "10m",
    });
    res.cookie(LINKEDIN_PENDING_COOKIE, pendingToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: LINKEDIN_OAUTH_TTL_MS,
      path: "/",
    });
    return res.redirect("/?linkedinNeedsRole=1");
  } catch {
    return res.redirect("/?authError=linkedin_failed");
  }
}));

interface PendingLinkedInProfile {
  linkedinId: string;
  name: string;
  email: string | null;
  avatar: string | null;
}

function readPendingLinkedInProfile(req: Request): PendingLinkedInProfile | null {
  const token = req.cookies?.[LINKEDIN_PENDING_COOKIE];
  if (!token) return null;
  try {
    return jwt.verify(token, getJwtSecret()) as PendingLinkedInProfile;
  } catch {
    return null;
  }
}

authRouter.get("/linkedin/pending", (req, res) => {
  const pending = readPendingLinkedInProfile(req);
  if (!pending) {
    return res.status(404).json({ error: "No pending LinkedIn sign-in" });
  }
  res.json({ name: pending.name, email: pending.email, avatar: pending.avatar });
});

authRouter.post("/linkedin/complete-signup", asyncHandler(async (req, res) => {
  const pending = readPendingLinkedInProfile(req);
  if (!pending) {
    return res.status(400).json({ error: "Your LinkedIn sign-in expired. Please try again." });
  }
  if (!pending.email) {
    return res.status(400).json({ error: "LinkedIn did not share an email address for this account." });
  }

  const { role } = req.body || {};
  if (typeof role !== "string" || !ALLOWED_ROLES.includes(role.toLowerCase() as AuthRole)) {
    return res.status(400).json({ error: "role must be one of: professional, organizer, sponsor" });
  }

  const normalizedRole = role.toLowerCase() as AuthRole;
  const normalizedEmail = pending.email.toLowerCase();

  // Someone may already have an account under this email (e.g. signed up with a password) —
  // link the LinkedIn identity to it instead of creating a duplicate account.
  const existingByEmail = await dbGet<UserRow>("SELECT * FROM users WHERE email = ?", [normalizedEmail]);
  let row: UserRow;
  if (existingByEmail) {
    await dbRun("UPDATE users SET linkedin_id = ? WHERE id = ?", [pending.linkedinId, existingByEmail.id]);
    await persistAuthenticatedLinkedInPicture(existingByEmail.id, pending.avatar);
    row = (await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [existingByEmail.id]))!;
  } else {
    const id = crypto.randomUUID();
    await dbRun(
      `INSERT INTO users (id, email, password_hash, linkedin_id, role, name)
       VALUES (?, ?, NULL, ?, ?, ?)`,
      [id, normalizedEmail, pending.linkedinId, normalizedRole, pending.name]
    );
    await persistAuthenticatedLinkedInPicture(id, pending.avatar);
    row = (await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [id]))!;
  }

  res.clearCookie(LINKEDIN_PENDING_COOKIE, { path: "/" });
  const token = signToken(row.id);
  setSessionCookie(res, token);
  res.status(201).json({ user: await toPublicUser(row) });
}));
