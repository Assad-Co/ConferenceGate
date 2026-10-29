import nodemailer from "nodemailer";

export function emailConfiguration(env = process.env) {
  const port = Number(env.SMTP_PORT || 587);
  const checks = {
    enabled: env.INTELLIGENCE_EMAIL_NOTIFICATIONS === "enabled",
    host: Boolean(env.SMTP_HOST?.trim()),
    port: Number.isInteger(port) && port > 0 && port <= 65535,
    username: Boolean(env.SMTP_USER?.trim()),
    password: Boolean(env.SMTP_PASSWORD?.trim()),
    sender: Boolean(env.INTELLIGENCE_EMAIL_FROM?.trim()),
    unsubscribeSecret: (env.INTELLIGENCE_UNSUBSCRIBE_SECRET?.length || 0) >= 32,
  };
  return { ready: Object.values(checks).every(Boolean), checks };
}

export function createEmailTransport() {
  const port = Number(process.env.SMTP_PORT || 587);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST!, port, secure: port === 465, requireTLS: port !== 465,
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASSWORD! },
    connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 15000,
    logger: false, debug: false,
  });
}

// Owner-only operational details. Never return auth usernames, passwords, keys or raw env.
export function emailRouting(env = process.env) {
  const host = env.SMTP_HOST?.trim() || "";
  const port = Number(env.SMTP_PORT || 587);
  const sender = env.INTELLIGENCE_EMAIL_FROM?.match(/@([a-z0-9.-]+)>?\s*$/i)?.[1]?.toLowerCase() || null;
  return {
    host: /^[a-z0-9.-]+$/i.test(host) ? host : null,
    port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : null,
    encryption: port === 465 ? "Implicit TLS" : "Required STARTTLS",
    senderDomain: sender,
    passwordRecoveryProvider: env.RESEND_API_KEY?.trim() ? "Resend configured" : "Not configured",
  };
}

// Store only an allowlisted code, never SMTP response text, credentials or message contents.
export function emailFailure(error: unknown) {
  const e = error as { code?: string; command?: string; responseCode?: number; syscall?: string; errno?: string };
  const code = ["EAUTH", "ECONNECTION", "ETIMEDOUT", "ESOCKET", "EENVELOPE", "EMESSAGE", "EDNS"].includes(e?.code || "") ? e.code! : "SMTP_ERROR";
  const explicitRejection = Number.isInteger(e?.responseCode) && e.responseCode! >= 400;
  // Nodemailer also reports command=CONN when the socket closes after DATA.
  // Only a proven connection-establishment failure makes CONN safe to retry.
  const failedToConnect = e?.syscall === "connect" || e?.code === "EDNS" ||
    ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH"].includes(e?.errno || "");
  const beforeMessage = failedToConnect || ["EHLO", "HELO", "STARTTLS", "AUTH", "AUTH PLAIN", "AUTH LOGIN", "MAIL FROM", "RCPT TO"].includes(e?.command || "");
  const retryable = explicitRejection ? e.responseCode! < 500 : beforeMessage;
  // A connection lost after DATA may already have delivered. Do not blindly retry it.
  return { code, retryable, uncertain: !explicitRejection && !beforeMessage };
}

export function retryDelay(attempts: number) { return Math.min(3600000, 60000 * 2 ** Math.max(0, attempts - 1)); }

export function brandedEmail(title: string, text: string) {
  const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  return '<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a;background:#f1f5f9;padding:24px"><main style="max-width:600px;margin:auto;background:white;padding:28px;border-top:5px solid #2563eb"><p style="color:#2563eb;font-weight:bold">ConferenceGate</p><h1 style="font-size:22px">' + escape(title) + '</h1><p style="white-space:pre-line;line-height:1.6">' + escape(text) + '</p><hr><p style="font-size:12px;color:#64748b">Your global gateway to conferences</p></main></body></html>';
}
