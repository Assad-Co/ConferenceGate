import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { dbGet, dbRun, UserRow } from "./db";
import { asyncHandler } from "./asyncHandler";

const RESET_TTL_MS = 30 * 60 * 1000;
const RESET_WINDOW_MS = 15 * 60 * 1000;
const RESET_MAX_ATTEMPTS = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const resetAttempts = new Map<string, { count: number; resetAt: number }>();

function isRealValue(value: string | undefined | null): value is string {
  const normalized = value?.trim() || "";
  if (!normalized) return false;
  if (/^(?:MY_|YOUR_|CHANGE_ME|EXAMPLE)/i.test(normalized)) return false;
  return true;
}

function googleClientId(): string | null {
  const value = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() || "";
  return isRealValue(value) && /\.apps\.googleusercontent\.com$/i.test(value) ? value : null;
}

function linkedInConfigured(): boolean {
  return isRealValue(process.env.LINKEDIN_CLIENT_ID) && isRealValue(process.env.LINKEDIN_CLIENT_SECRET);
}

function passwordResetConfigured(): boolean {
  const from = process.env.PASSWORD_RESET_FROM_EMAIL?.trim() || "";
  const base = process.env.PUBLIC_BASE_URL?.trim() || process.env.APP_BASE_URL?.trim() || "";
  return isRealValue(process.env.RESEND_API_KEY) && EMAIL_RE.test(from.replace(/^.*<([^>]+)>.*$/, "$1")) && /^https:\/\//i.test(base);
}

function resetRateLimit(req: Request, res: Response, next: NextFunction) {
  const now = Date.now();
  const key = String(req.ip || req.socket.remoteAddress || "unknown");
  const current = resetAttempts.get(key);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + RESET_WINDOW_MS }
    : current;
  bucket.count += 1;
  resetAttempts.set(key, bucket);

  if (resetAttempts.size > 5000) {
    for (const [ip, value] of resetAttempts) {
      if (value.resetAt <= now) resetAttempts.delete(ip);
    }
  }

  if (bucket.count > RESET_MAX_ATTEMPTS) {
    const retrySeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retrySeconds));
    return res.status(429).json({ error: "Too many password reset requests. Please try again later." });
  }
  next();
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function resetRecordKey(tokenHash: string): string {
  return `password_reset:${tokenHash}`;
}

function latestResetKey(userId: string): string {
  return `password_reset_latest:${userId}`;
}

function canonicalBaseUrl(): string {
  const raw = process.env.PUBLIC_BASE_URL?.trim() || process.env.APP_BASE_URL?.trim() || "";
  const url = new URL(raw);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char] || char));
}

async function sendResetEmail(email: string, token: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY!.trim();
  const from = process.env.PASSWORD_RESET_FROM_EMAIL!.trim();
  const resetUrl = `${canonicalBaseUrl()}/#password-reset=${encodeURIComponent(token)}`;
  const safeUrl = escapeHtml(resetUrl);

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Reset your ConferenceGate password",
      text: [
        "A password reset was requested for your ConferenceGate account.",
        "",
        `Reset your password: ${resetUrl}`,
        "",
        "This link expires in 30 minutes and can be used only once. If you did not request this, you can ignore this email.",
      ].join("\n"),
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a;line-height:1.6">
          <h2 style="color:#172554">Reset your ConferenceGate password</h2>
          <p>A password reset was requested for your ConferenceGate account.</p>
          <p style="margin:28px 0">
            <a href="${safeUrl}" style="background:#1e40af;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:700">Reset password</a>
          </p>
          <p>This link expires in 30 minutes and can be used only once.</p>
          <p style="color:#64748b;font-size:13px">If you did not request this reset, you can safely ignore this email.</p>
        </div>`,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Resend returned HTTP ${response.status}${body ? `: ${body.slice(0, 180)}` : ""}`);
  }
}

async function removeResetRecord(userId: string, tokenHash: string): Promise<void> {
  await dbRun("DELETE FROM app_secrets WHERE key = ?", [resetRecordKey(tokenHash)]);
  const latest = await dbGet<{ value: string }>("SELECT value FROM app_secrets WHERE key = ?", [latestResetKey(userId)]);
  if (latest?.value === tokenHash) {
    await dbRun("DELETE FROM app_secrets WHERE key = ?", [latestResetKey(userId)]);
  }
}

export const authRecoveryRouter = Router();

authRecoveryRouter.get("/capabilities", (_req, res) => {
  const clientId = googleClientId();
  res.setHeader("Cache-Control", "no-store");
  res.json({
    googleClientId: clientId,
    linkedin: linkedInConfigured(),
    passwordReset: passwordResetConfigured(),
    passwordResetTtlMinutes: RESET_TTL_MS / 60_000,
  });
});

authRecoveryRouter.post("/password-reset/request", resetRateLimit, asyncHandler(async (req, res) => {
  if (!passwordResetConfigured()) {
    return res.status(503).json({ error: "Password reset email is not configured yet." });
  }

  const generic = {
    message: "If an account exists for that email, a password reset link will be sent shortly.",
  };
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) return res.status(202).json(generic);

  const user = await dbGet<Pick<UserRow, "id" | "email">>("SELECT id, email FROM users WHERE email = ?", [email]);
  if (!user) return res.status(202).json(generic);

  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = sha256(token);
  const latestKey = latestResetKey(user.id);
  const previous = await dbGet<{ value: string }>("SELECT value FROM app_secrets WHERE key = ?", [latestKey]);
  if (previous?.value) {
    await dbRun("DELETE FROM app_secrets WHERE key = ?", [resetRecordKey(previous.value)]);
  }

  const record = JSON.stringify({ userId: user.id, expiresAt: Date.now() + RESET_TTL_MS });
  await dbRun("INSERT OR REPLACE INTO app_secrets (key, value) VALUES (?, ?)", [resetRecordKey(tokenHash), record]);
  await dbRun("INSERT OR REPLACE INTO app_secrets (key, value) VALUES (?, ?)", [latestKey, tokenHash]);

  try {
    await sendResetEmail(user.email, token);
  } catch (error) {
    await removeResetRecord(user.id, tokenHash).catch(() => {});
    console.warn("[auth-recovery] Password reset email delivery failed", error instanceof Error ? error.message : error);
  }

  return res.status(202).json(generic);
}));

authRecoveryRouter.post("/password-reset/confirm", resetRateLimit, asyncHandler(async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
  if (!token || token.length < 32) {
    return res.status(400).json({ error: "This password reset link is invalid or expired." });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const tokenHash = sha256(token);
  const stored = await dbGet<{ value: string }>("SELECT value FROM app_secrets WHERE key = ?", [resetRecordKey(tokenHash)]);
  if (!stored?.value) {
    return res.status(400).json({ error: "This password reset link is invalid or expired." });
  }

  let record: { userId?: string; expiresAt?: number } = {};
  try {
    record = JSON.parse(stored.value);
  } catch {
    await dbRun("DELETE FROM app_secrets WHERE key = ?", [resetRecordKey(tokenHash)]);
    return res.status(400).json({ error: "This password reset link is invalid or expired." });
  }

  if (!record.userId || typeof record.expiresAt !== "number" || record.expiresAt <= Date.now()) {
    if (record.userId) await removeResetRecord(record.userId, tokenHash).catch(() => {});
    else await dbRun("DELETE FROM app_secrets WHERE key = ?", [resetRecordKey(tokenHash)]);
    return res.status(400).json({ error: "This password reset link is invalid or expired." });
  }

  const latest = await dbGet<{ value: string }>("SELECT value FROM app_secrets WHERE key = ?", [latestResetKey(record.userId)]);
  if (latest?.value !== tokenHash) {
    await dbRun("DELETE FROM app_secrets WHERE key = ?", [resetRecordKey(tokenHash)]);
    return res.status(400).json({ error: "This password reset link is invalid or expired." });
  }

  const user = await dbGet<Pick<UserRow, "id" | "email">>("SELECT id, email FROM users WHERE id = ?", [record.userId]);
  if (!user) {
    await removeResetRecord(record.userId, tokenHash).catch(() => {});
    return res.status(400).json({ error: "This password reset link is invalid or expired." });
  }

  const passwordHash = bcrypt.hashSync(newPassword, 10);
  await dbRun("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, user.id]);
  await removeResetRecord(user.id, tokenHash);

  res.setHeader("Cache-Control", "no-store");
  return res.json({ ok: true, email: user.email });
}));
