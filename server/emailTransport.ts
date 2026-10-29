import nodemailer from "nodemailer";
import path from "node:path";

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

export function emailLogoAttachment() {
  return [{ filename: "conference-gate-logo.png", path: path.join(process.cwd(), "public", "conference-gate-logo.png"),
    cid: "conferencegate-logo@conferencegate.com", contentType: "image/png", contentDisposition: "inline" as const }];
}

export function brandedEmail(title: string, text: string, options: { actionUrl?: string; actionLabel?: string; unsubscribeUrl?: string } = {}) {
  const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  const safeUrl = (raw?: string) => { try { const u = new URL(raw || ""); return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; } };
  const action = safeUrl(options.actionUrl), unsubscribe = safeUrl(options.unsubscribeUrl);
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() === title.trim()) lines.shift();
  const copy = lines.filter(line => !action || line.trim() !== options.actionUrl?.trim()).join("\n").trim();
  const paragraphs = copy.split(/\n\s*\n/).map(p => '<p style="margin:0 0 18px;font-size:16px;line-height:1.65;color:#334155;overflow-wrap:anywhere;word-break:break-word">' + escape(p).replace(/\n/g, "<br>") + '</p>').join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title></head>
<body style="margin:0;padding:0;background-color:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f6fb"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #dce5f0;border-radius:12px">
<tr><td style="padding:28px 28px 24px;border-bottom:1px solid #e5edf5"><a href="https://www.conferencegate.com/" style="text-decoration:none"><img src="cid:conferencegate-logo@conferencegate.com" width="280" alt="ConferenceGate" style="display:block;width:280px;max-width:100%;height:auto;border:0"></a></td></tr>
<tr><td style="padding:28px"><p style="margin:0 0 12px;color:#0b4fab;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">${unsubscribe ? "Your conference alerts" : "ConferenceGate notification"}</p>
<h1 style="margin:0 0 20px;font-size:25px;line-height:1.3;color:#102a43;overflow-wrap:anywhere">${escape(title)}</h1>${paragraphs}
${action ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#0b4fab" style="border-radius:7px"><a href="${escape(action)}" style="display:inline-block;padding:14px 22px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;border-radius:7px">${escape(options.actionLabel || "Open link")}</a></td></tr></table><p style="margin:14px 0 0;font-size:12px;color:#64748b">Opens ${escape(new URL(action).hostname)}. Confirm event details with the organizer.</p>` : ""}
</td></tr><tr><td style="padding:22px 28px;background-color:#f8fafc;border-top:1px solid #e5edf5;font-size:12px;line-height:1.7;color:#64748b">
<p style="margin:0 0 10px">${unsubscribe ? "You received this email because you enabled conference alerts in ConferenceGate." : "A service notification from ConferenceGate."}</p>
<p style="margin:0 0 10px"><a href="https://www.conferencegate.com/" style="color:#0b4fab">Visit ConferenceGate</a> &nbsp;·&nbsp; <a href="mailto:support@conferencegate.com" style="color:#0b4fab">Contact support</a>${unsubscribe ? ` &nbsp;·&nbsp; <a href="${escape(unsubscribe)}" style="color:#0b4fab">Unsubscribe from conference alerts</a>` : ""}</p>
<p style="margin:0">ConferenceGate OÜ · Estonia<br>Your global gateway to conferences</p>
</td></tr></table></td></tr></table></body></html>`;
}
