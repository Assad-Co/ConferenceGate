import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import { db, UserRow } from "./db";

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(48).toString("hex");
if (!process.env.JWT_SECRET) {
  console.warn(
    "[auth] JWT_SECRET is not set — using a random secret generated at startup. " +
      "Sessions will be invalidated on every restart. Set JWT_SECRET in your environment for production."
  );
}

export const COOKIE_NAME = "cg_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const ALLOWED_ROLES = ["professional", "organizer", "sponsor"] as const;
type AuthRole = (typeof ALLOWED_ROLES)[number];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toPublicUser(row: UserRow) {
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
    avatar: row.avatar,
    reviewerAvailable: !!row.reviewer_available,
  };
}

function signToken(userId: string) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "7d" });
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
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string };
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

authRouter.post("/signup", (req, res) => {
  const { role, name, email, password, organization, title } = req.body || {};

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
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  const id = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync(password, 10);
  const normalizedRole = role.toLowerCase() as AuthRole;

  db.prepare(
    `INSERT INTO users (id, email, password_hash, role, name, organization, title)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    normalizedEmail,
    passwordHash,
    normalizedRole,
    name.trim(),
    typeof organization === "string" && organization.trim() ? organization.trim() : null,
    typeof title === "string" && title.trim() ? title.trim() : null
  );

  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
  const token = signToken(row.id);
  setSessionCookie(res, token);
  res.status(201).json({ user: toPublicUser(row) });
});

authRouter.post("/login", (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(normalizedEmail) as UserRow | undefined;
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
  res.json({ user: toPublicUser(row) });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, (req: AuthedRequest, res) => {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId) as UserRow | undefined;
  if (!row) {
    res.clearCookie(COOKIE_NAME, { path: "/" });
    return res.status(401).json({ error: "Not authenticated" });
  }
  res.json({ user: toPublicUser(row) });
});

const EDITABLE_PROFILE_FIELDS = ["name", "title", "organization", "department", "city", "country", "bio"] as const;
const MAX_BIO_LENGTH = 600;

authRouter.patch("/me", requireAuth, (req: AuthedRequest, res) => {
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

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "No valid fields to update" });
  }

  const setClause = Object.keys(updates)
    .map((field) => `${field} = ?`)
    .join(", ");
  db.prepare(`UPDATE users SET ${setClause} WHERE id = ?`).run(...Object.values(updates), req.userId);

  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId) as UserRow;
  res.json({ user: toPublicUser(row) });
});

authRouter.patch("/me/reviewer-availability", requireAuth, (req: AuthedRequest, res) => {
  const body = req.body || {};
  if (typeof body.available !== "boolean") {
    return res.status(400).json({ error: "available must be a boolean" });
  }
  db.prepare("UPDATE users SET reviewer_available = ? WHERE id = ?").run(body.available ? 1 : 0, req.userId);
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId) as UserRow;
  res.json({ user: toPublicUser(row) });
});

const MAX_AVATAR_LENGTH = 2_000_000; // ~1.5MB decoded, comfortably under the request body limit

authRouter.post("/avatar", requireAuth, (req: AuthedRequest, res) => {
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

  db.prepare("UPDATE users SET avatar = ? WHERE id = ?").run(avatar, req.userId);
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId) as UserRow;
  res.json({ user: toPublicUser(row) });
});

const googleClient = process.env.GOOGLE_OAUTH_CLIENT_ID ? new OAuth2Client(process.env.GOOGLE_OAUTH_CLIENT_ID) : null;

authRouter.post("/google", async (req, res) => {
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

  let row = db.prepare("SELECT * FROM users WHERE google_id = ?").get(googleId) as UserRow | undefined;

  if (!row) {
    const byEmail = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
    if (byEmail) {
      db.prepare("UPDATE users SET google_id = ? WHERE id = ?").run(googleId, byEmail.id);
      row = db.prepare("SELECT * FROM users WHERE id = ?").get(byEmail.id) as UserRow;
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
    db.prepare(
      `INSERT INTO users (id, email, password_hash, google_id, role, name, avatar)
       VALUES (?, ?, NULL, ?, ?, ?, ?)`
    ).run(id, email, googleId, normalizedRole, name, picture);
    row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
  }

  const token = signToken(row.id);
  setSessionCookie(res, token);
  res.json({ user: toPublicUser(row) });
});
