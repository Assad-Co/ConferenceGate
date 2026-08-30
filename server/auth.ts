import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import { dbAll, dbGet, dbRun, UserRow } from "./db";
import { asyncHandler } from "./asyncHandler";

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
    reviewerAvailable: !!row.reviewer_available,
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

authRouter.post("/signup", asyncHandler(async (req, res) => {
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

authRouter.post("/login", asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const row = await dbGet<UserRow>("SELECT * FROM users WHERE email = ?", [normalizedEmail]);
  if (!row) {
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
  const row = (await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [req.userId]))!;
  res.json({ user: await toPublicUser(row) });
}));

const googleClient = process.env.GOOGLE_OAUTH_CLIENT_ID ? new OAuth2Client(process.env.GOOGLE_OAUTH_CLIENT_ID) : null;

authRouter.post("/google", asyncHandler(async (req, res) => {
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
const LINKEDIN_OAUTH_TTL_MS = 10 * 60 * 1000; // 10 minutes — just long enough to complete the redirect round trip

function linkedinRedirectUri(req: Request): string {
  const base = (process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  return `${base}/api/auth/linkedin/callback`;
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
  res.clearCookie(LINKEDIN_STATE_COOKIE, { path: "/" });

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

    let row = await dbGet<UserRow>("SELECT * FROM users WHERE linkedin_id = ?", [linkedinId]);

    if (!row && email) {
      const byEmail = await dbGet<UserRow>("SELECT * FROM users WHERE email = ?", [email]);
      if (byEmail) {
        await dbRun("UPDATE users SET linkedin_id = ? WHERE id = ?", [linkedinId, byEmail.id]);
        row = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [byEmail.id]);
      }
    }

    if (row) {
      const token = signToken(row.id);
      setSessionCookie(res, token);
      return res.redirect("/");
    }

    // Brand-new account — stash the verified LinkedIn identity in a short-lived signed cookie
    // and send the browser to the role picker, mirroring the Google Sign-In new-account flow.
    // (LinkedIn's authorization code is single-use, so unlike Google's ID token it can't just
    // be replayed once the person picks a role — the verified profile has to be held server-side.)
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
    row = (await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [existingByEmail.id]))!;
  } else {
    const id = crypto.randomUUID();
    await dbRun(
      `INSERT INTO users (id, email, password_hash, linkedin_id, role, name, avatar)
       VALUES (?, ?, NULL, ?, ?, ?, ?)`,
      [id, normalizedEmail, pending.linkedinId, normalizedRole, pending.name, pending.avatar]
    );
    row = (await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [id]))!;
  }

  res.clearCookie(LINKEDIN_PENDING_COOKIE, { path: "/" });
  const token = signToken(row.id);
  setSessionCookie(res, token);
  res.status(201).json({ user: await toPublicUser(row) });
}));
