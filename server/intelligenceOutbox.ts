import crypto from "node:crypto";
import { dbAll, dbGet, dbRun } from "./db";
import { brandedEmail, createEmailTransport, emailConfiguration, emailFailure, retryDelay, emailLogoAttachment } from "./emailTransport";

export async function initEmailOutbox() {
  await dbRun(`CREATE TABLE IF NOT EXISTS intelligence_email_outbox (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, alert_id TEXT NOT NULL,
    title TEXT NOT NULL, body TEXT NOT NULL, unsubscribe_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL, lease_until INTEGER, claim_token TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    provider_message_id TEXT, error_code TEXT, UNIQUE(user_id, alert_id))`);
  await dbRun("CREATE INDEX IF NOT EXISTS intelligence_outbox_due ON intelligence_email_outbox(status,next_attempt_at)");
}

export async function enqueueAlert(userId: string, alertId: string, title: string, body: string, unsubscribeUrl: string) {
  const now = Date.now();
  // The legacy table is authoritative for alerts already submitted by the previous version.
  await dbRun(`INSERT OR IGNORE INTO intelligence_email_outbox
    (id,user_id,alert_id,title,body,unsubscribe_url,next_attempt_at,created_at,updated_at)
    SELECT ?,?,?,?,?,?,?,?,? WHERE NOT EXISTS
    (SELECT 1 FROM intelligence_email_deliveries WHERE user_id=? AND alert_id=? AND status IN ('sent','sending'))`,
    [crypto.randomUUID(), userId, alertId, title, body, unsubscribeUrl, now, now, now, userId, alertId]);
}

type Job = { id: string; user_id: string; alert_id: string; title: string; body: string; unsubscribe_url: string; attempts: number };
export async function drainEmailOutbox(createTransport = createEmailTransport, now = Date.now()) {
  if (!emailConfiguration().ready) return;
  // A crash during SMTP is ambiguous: quarantine instead of risking a duplicate send.
  await dbRun("UPDATE intelligence_email_outbox SET status='uncertain',error_code='WORKER_INTERRUPTED',updated_at=? WHERE status='sending' AND lease_until<?", [now, now]);
  for (let count = 0; count < 20; count++) {
    const claim = crypto.randomUUID();
    const job = await dbGet<Job>(`UPDATE intelligence_email_outbox SET status='sending',attempts=attempts+1,claim_token=?,lease_until=?,updated_at=?
      WHERE id=(SELECT id FROM intelligence_email_outbox WHERE status IN ('queued','retry') AND next_attempt_at<=? AND attempts<5 ORDER BY created_at LIMIT 1)
      AND status IN ('queued','retry') RETURNING *`, [claim, now + 120000, now, now]);
    if (!job) break;
    const user = await dbGet<{ email: string; enabled: number }>("SELECT u.email,p.enabled FROM users u LEFT JOIN intelligence_email_preferences p ON p.user_id=u.id WHERE u.id=?", [job.user_id]);
    if (!user || user.enabled !== 1) {
      await dbRun("UPDATE intelligence_email_outbox SET status='cancelled',updated_at=? WHERE id=? AND claim_token=?", [now, job.id, claim]);
      continue;
    }
    let transport: ReturnType<typeof createEmailTransport> | undefined;
    try {
      transport = createTransport();
      const info = await transport.sendMail({ from: process.env.INTELLIGENCE_EMAIL_FROM!, to: user.email,
        subject: "ConferenceGate: new conference alert", text: job.body + "\n\nUnsubscribe: " + job.unsubscribe_url,
        html: brandedEmail(job.title, job.body, { actionUrl: job.body.split(/\r?\n/).find(line => /^https?:\/\/\S+$/.test(line.trim()))?.trim(), actionLabel: "View conference source", unsubscribeUrl: job.unsubscribe_url }),
        attachments: emailLogoAttachment(),
        messageId: `<${job.id}@conferencegate.com>`, headers: { "List-Unsubscribe": "<" + job.unsubscribe_url + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
      if (!info.accepted?.some((address: string) => address.toLowerCase() === user.email.toLowerCase())) {
        throw Object.assign(new Error("Recipient rejected"), { code: "EENVELOPE", responseCode: 550 });
      }
      await dbRun("UPDATE intelligence_email_outbox SET status='accepted',provider_message_id=?,error_code=NULL,updated_at=? WHERE id=? AND claim_token=?", [info.messageId || null, Date.now(), job.id, claim]);
    } catch (error) {
      const failure = emailFailure(error);
      const status = failure.uncertain ? "uncertain" : failure.retryable && job.attempts < 5 ? "retry" : "failed";
      await dbRun("UPDATE intelligence_email_outbox SET status=?,error_code=?,next_attempt_at=?,updated_at=? WHERE id=? AND claim_token=?", [status, failure.code, now + retryDelay(job.attempts), Date.now(), job.id, claim]);
      console.warn("[intelligence-email]", JSON.stringify({ requestId: job.id, status, code: failure.code }));
    } finally { transport?.close(); }
  }
}

export async function emailQueueDiagnostics() {
  const counts = await dbAll<{status: string; count: number}>("SELECT status,count(*) AS count FROM intelligence_email_outbox GROUP BY status");
  const oldest = await dbGet<{created_at: number}>("SELECT min(created_at) AS created_at FROM intelligence_email_outbox WHERE status IN ('queued','retry')");
  const recent = await dbAll("SELECT id,status,attempts,error_code,created_at,updated_at,provider_message_id FROM intelligence_email_outbox ORDER BY created_at DESC LIMIT 30");
  const waiting = counts.filter(row => ['queued','retry'].includes(row.status)).reduce((sum,row) => sum + Number(row.count), 0);
  const stalled = waiting > 0 && Date.now() - Number(oldest?.created_at || Date.now()) > 900000;
  return { counts, recent, oldestQueuedAt: oldest?.created_at || null, alert: stalled || counts.some(row => ['failed','uncertain'].includes(row.status) && row.count > 0) };
}

export function startEmailOutboxWorker() {
  if (process.env.NODE_ENV === "test") return;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await drainEmailOutbox();
      const queue = await emailQueueDiagnostics();
      if (queue.alert) console.warn("[intelligence-email] queue requires attention", JSON.stringify({ counts: queue.counts, oldestQueuedAt: queue.oldestQueuedAt }));
    } catch (error) {
      // Emit only stable error metadata, never message text or SMTP credentials.
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code.slice(0, 80) : "UNCLASSIFIED";
      const kind = error instanceof Error ? error.name.slice(0, 80) : "UnknownError";
      console.warn("[intelligence-email] queue worker failed", JSON.stringify({ code, kind }));
    }
    finally { busy = false; }
  };
  setInterval(() => void tick(), 60000).unref();
  setTimeout(() => void tick(), 5000).unref();
}
