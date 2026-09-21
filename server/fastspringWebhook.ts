import express, { Router, Request, Response } from "express";
import crypto from "crypto";
import { dbGet, dbRun, UserRow } from "./db";

export const fastSpringWebhookRouter = Router();

function secureEqualBase64(left: string, right: string): boolean {
  try {
    const a = Buffer.from(left.trim(), "base64");
    const b = Buffer.from(right.trim(), "base64");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function mapFastSpringSubscriptionStatus(type: string, data: any): string | null {
  const state = String(data?.state || "").toLowerCase();
  const active = data?.active === true;

  if (type === "subscription.deactivated") return "canceled";
  if (type === "subscription.payment.overdue" || type === "subscription.charge.failed") return "past_due";
  if (type === "subscription.paused" || state === "paused") return "paused";
  if (type === "subscription.canceled" || state === "canceled") return active ? "active" : "canceled";
  if (state === "trial") return "trialing";
  if (state === "overdue") return "past_due";
  if (state === "deactivated") return "canceled";
  if (active || state === "active") return "active";
  return null;
}

function accountIdentity(data: any): { accountId: string; email: string } {
  const account = data?.account;
  const accountId =
    typeof account === "string"
      ? account
      : String(account?.id || account?.account || "");
  const email =
    typeof account === "object" && account?.contact?.email
      ? String(account.contact.email).trim().toLowerCase()
      : "";
  return { accountId, email };
}

async function findBillingUser(accountId: string, email: string): Promise<UserRow | undefined> {
  if (accountId) {
    const byCustomer = await dbGet<UserRow>(
      "SELECT * FROM users WHERE billing_customer_ref=? AND role IN ('organizer','sponsor') LIMIT 1",
      [accountId]
    );
    if (byCustomer) return byCustomer;
  }
  if (email) {
    return dbGet<UserRow>(
      "SELECT * FROM users WHERE lower(email)=? AND role IN ('organizer','sponsor') LIMIT 1",
      [email]
    );
  }
  return undefined;
}

fastSpringWebhookRouter.post(
  "/",
  express.raw({ type: "application/json", limit: "2mb" }),
  async (req: Request, res: Response) => {
    const secret = process.env.FASTSPRING_WEBHOOK_SECRET?.trim();
    if (!secret) return res.status(503).send("FastSpring webhook is not configured");

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
    const supplied = String(req.header("x-fs-signature") || "").trim();
    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
    if (!supplied || !secureEqualBase64(supplied, expected)) {
      return res.status(400).send("Invalid FastSpring signature");
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return res.status(400).send("Invalid JSON");
    }

    const events = Array.isArray(payload?.events) ? payload.events : [];
    for (const event of events) {
      const eventId = typeof event?.id === "string" ? event.id : "";
      const eventType = typeof event?.type === "string" ? event.type : "";
      if (!eventId || !eventType) continue;

      const existing = await dbGet<{ id: string }>(
        "SELECT id FROM billing_provider_events WHERE provider='fastspring' AND event_id=?",
        [eventId]
      );
      if (existing) continue;

      const payloadHash = crypto
        .createHash("sha256")
        .update(JSON.stringify(event))
        .digest("hex");

      if (!eventType.startsWith("subscription.")) {
        await dbRun(
          "INSERT INTO billing_provider_events(id,provider,event_id,event_type,subject_id,payload_hash,status) VALUES(?,'fastspring',?,?,?,?, 'ignored')",
          [`bpe_${crypto.randomUUID()}`, eventId, eventType, null, payloadHash]
        );
        continue;
      }

      const data = event?.data || {};
      const status = mapFastSpringSubscriptionStatus(eventType, data);
      const { accountId, email } = accountIdentity(data);
      const user = await findBillingUser(accountId, email);

      if (!status || !user) {
        await dbRun(
          "INSERT INTO billing_provider_events(id,provider,event_id,event_type,subject_id,payload_hash,status) VALUES(?,'fastspring',?,?,?,?, 'ignored')",
          [`bpe_${crypto.randomUUID()}`, eventId, eventType, user?.id || null, payloadHash]
        );
        continue;
      }

      const subscriptionId = String(data?.id || data?.subscription || "");
      const productPath =
        typeof data?.product === "object"
          ? String(data.product?.path || data.product?.display || "")
          : "";

      await dbRun(
        `UPDATE users
            SET subscription_status=?,
                subscription_plan=COALESCE(NULLIF(?,''),subscription_plan),
                subscription_provider='fastspring',
                billing_customer_ref=COALESCE(NULLIF(?,''),billing_customer_ref),
                subscription_period_end=CASE
                  WHEN ?='canceled' THEN COALESCE(subscription_period_end, datetime('now'))
                  ELSE subscription_period_end
                END
          WHERE id=?`,
        [status, productPath, accountId, status, user.id]
      );

      await dbRun(
        "INSERT INTO billing_provider_events(id,provider,event_id,event_type,subject_id,payload_hash,status) VALUES(?,'fastspring',?,?,?,?, 'processed')",
        [`bpe_${crypto.randomUUID()}`, eventId, eventType, user.id || subscriptionId, payloadHash]
      );
    }

    res.status(200).send("ok");
  }
);
