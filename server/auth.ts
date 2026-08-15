import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { db, UserRow } from "./db";

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(48).toString("hex");
if (!process.env.JWT_SECRET) {
  console.warn(
    "[auth] JWT_SECRET is not set — using a random secret generated at startup. " +
      "Sessions will be invalidated on every restart. Set JWT_SECRET in your environment for production."
  );
}

const COOKIE_NAME = "cg_session";
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

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string };
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: "Session expired or invalid" });
  }
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
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
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
