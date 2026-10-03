import express, { Router, Request, Response } from "express";
import crypto from "crypto";
import { dbGet, dbRun, UserRow } from "./db";
import { ensurePayoutObligation } from "./payouts";

export const paddleWebhookRouter = Router();

function parsePaddleSignature(header: string): { timestamp: string; signatures: string[] } | null {
  const parts = header.split(";").map((part) => part.trim()).filter(Boolean);
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of parts) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index);
    const value = part.slice(index + 1);
    if (key === "ts") timestamp = value;
    if (key === "h1" && value) signatures.push(value);
  }
  return timestamp && signatures.length ? { timestamp, signatures } : null;
}

function timingSafeHexEqual(left: string, right: string): boolean {
  try {
    const a = Buffer.from(left, "hex");
    const b = Buffer.from(right, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function verifyPaddleSignature(rawBody: Buffer, signatureHeader: string, secret: string): boolean {
  const parsed = parsePaddleSignature(signatureHeader);
  if (!parsed) return false;

  const timestampSeconds = Number(parsed.timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  const tolerance = Math.max(5, Math.min(300, Number(process.env.PADDLE_WEBHOOK_TOLERANCE_SECONDS || 5)));
  if (Math.abs(Date.now() / 1000 - timestampSeconds) > tolerance) return false;

  const signedPayload = parsed.timestamp + ":" + rawBody.toString("utf8");
  const expected = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
  return parsed.signatures.some((signature) => timingSafeHexEqual(signature, expected));
}

function paddleSubscriptionStatus(value: unknown): string | null {
  const status = String(value || "").toLowerCase();
  if (["active", "trialing", "past_due", "canceled", "paused"].includes(status)) return status;
  return null;
}

function paddlePriceId(data: any): string {
  return Array.isArray(data?.items) && typeof data.items?.[0]?.price?.id === "string"
    ? data.items[0].price.id.trim()
    : "";
}

function expectedPaddlePriceId(role: string): string {
  if (role === "organizer") return process.env.PADDLE_ORGANIZER_PRICE_ID?.trim() || "";
  if (role === "sponsor") return process.env.PADDLE_SPONSOR_PRICE_ID?.trim() || "";
  return "";
}

type PaddleUserMatch = {
  user: UserRow;
  source: "explicit_user_id" | "customer_ref";
};

async function findPaddleUser(data: any): Promise<PaddleUserMatch | undefined> {
  const explicitUserId =
    typeof data?.custom_data?.conferencegate_user_id === "string"
      ? data.custom_data.conferencegate_user_id
      : "";
  if (explicitUserId) {
    const byId = await dbGet<UserRow>(
      "SELECT * FROM users WHERE id=? AND role IN ('organizer','sponsor') LIMIT 1",
      [explicitUserId]
    );
    if (byId) return { user: byId, source: "explicit_user_id" };
  }

  const customerId = typeof data?.customer_id === "string" ? data.customer_id : "";
  if (customerId) {
    const byCustomer = await dbGet<UserRow>(
      "SELECT * FROM users WHERE billing_customer_ref=? AND role IN ('organizer','sponsor') LIMIT 1",
      [customerId]
    );
    if (byCustomer) return { user: byCustomer, source: "customer_ref" };
  }
  return undefined;
}

function paddleSubscriptionMatchesAccount(data: any, match: PaddleUserMatch): boolean {
  const declaredRole =
    typeof data?.custom_data?.conferencegate_role === "string"
      ? data.custom_data.conferencegate_role.trim().toLowerCase()
      : "";
  const priceId = paddlePriceId(data);
  const expectedPriceId = expectedPaddlePriceId(match.user.role);

  // A first-time link is accepted only when it carries all three pieces of evidence created by
  // ConferenceGate's server-side checkout: the user id, the matching role, and that role's exact
  // configured Paddle price. This prevents a valid Paddle event for one product/role from being
  // replayed as paid access for the other ConferenceGate role.
  if (match.source === "explicit_user_id") {
    return Boolean(
      declaredRole &&
      declaredRole === match.user.role &&
      priceId &&
      expectedPriceId &&
      priceId === expectedPriceId
    );
  }

  // After the customer id has been durably linked by a validated first purchase, lifecycle events
  // can resolve the account by that provider id. If Paddle includes a role or price again, it must
  // still agree with the linked ConferenceGate account.
  if (declaredRole && declaredRole !== match.user.role) return false;
  if (priceId && expectedPriceId && priceId !== expectedPriceId) return false;
  return true;
}

async function recordProviderEvent(
  eventId: string,
  eventType: string,
  subjectId: string | null,
  payloadHash: string,
  status: "processed" | "ignored" | "failed"
) {
  await dbRun(
    "INSERT INTO billing_provider_events(id,provider,event_id,event_type,subject_id,payload_hash,status) VALUES(?,'paddle',?,?,?,?,?)",
    [`bpe_${crypto.randomUUID()}`, eventId, eventType, subjectId, payloadHash, status]
  );
}

paddleWebhookRouter.post(
  "/",
  express.raw({ type: "application/json", limit: "2mb" }),
  async (req: Request, res: Response) => {
    const secret = process.env.PADDLE_WEBHOOK_SECRET?.trim();
    if (!secret) return res.status(503).send("Paddle webhook is not configured");

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
    const signature = String(req.header("paddle-signature") || "");
    if (!signature || !verifyPaddleSignature(rawBody, signature, secret)) {
      return res.status(400).send("Invalid Paddle signature");
    }

    let event: any;
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return res.status(400).send("Invalid JSON");
    }

    const eventId = typeof event?.event_id === "string" ? event.event_id : "";
    const eventType = typeof event?.event_type === "string" ? event.event_type : "";
    if (!eventId || !eventType) return res.status(400).send("Missing Paddle event identity");

    const existing = await dbGet<{ id: string }>(
      "SELECT id FROM billing_provider_events WHERE provider='paddle' AND event_id=?",
      [eventId]
    );
    if (existing) return res.status(200).send("ok");

    const payloadHash = crypto.createHash("sha256").update(rawBody).digest("hex");
    const data = event?.data || {};

    if (eventType.startsWith("subscription.")) {
      const status = paddleSubscriptionStatus(data?.status);
      const match = await findPaddleUser(data);
      const user = match?.user;
      if (!status || !match || !paddleSubscriptionMatchesAccount(data, match)) {
        await recordProviderEvent(eventId, eventType, user?.id || null, payloadHash, "ignored");
        return res.status(200).send("ok");
      }

      const customerId = typeof data?.customer_id === "string" ? data.customer_id : "";
      const priceId = paddlePriceId(data);
      const periodEnd =
        typeof data?.current_billing_period?.ends_at === "string"
          ? data.current_billing_period.ends_at
          : typeof data?.next_billed_at === "string"
            ? data.next_billed_at
            : null;

      await dbRun(
        `UPDATE users
            SET subscription_status=?,
                subscription_plan=COALESCE(NULLIF(?,''),subscription_plan),
                subscription_provider='paddle',
                billing_customer_ref=COALESCE(NULLIF(?,''),billing_customer_ref),
                subscription_period_end=?
          WHERE id=?`,
        [status, priceId, customerId, periodEnd, user.id]
      );

      await recordProviderEvent(eventId, eventType, user.id, payloadHash, "processed");
      return res.status(200).send("ok");
    }

    if (eventType === "transaction.completed") {
      const dealId =
        typeof data?.custom_data?.conferencegate_deal_id === "string"
          ? data.custom_data.conferencegate_deal_id
          : "";
      if (!dealId) {
        await recordProviderEvent(eventId, eventType, null, payloadHash, "ignored");
        return res.status(200).send("ok");
      }

      const deal = await dbGet<any>("SELECT * FROM sponsorship_deals WHERE id=?", [dealId]);
      if (!deal) {
        await recordProviderEvent(eventId, eventType, dealId, payloadHash, "ignored");
        return res.status(200).send("ok");
      }

      const paymentReference = typeof data?.id === "string" ? data.id : eventId;
      const existingPayment = await dbGet<any>(
        "SELECT * FROM sponsorship_payments WHERE payment_reference=?",
        [paymentReference]
      );
      if (!existingPayment) {
        await dbRun(
          "INSERT INTO sponsorship_payments(id,deal_id,provider,payment_reference,amount,currency,status) VALUES(?,?,?,?,?,?,'settled')",
          [
            `spay_${crypto.randomUUID()}`,
            dealId,
            "paddle",
            paymentReference,
            deal.agreed_amount ?? null,
            String(deal.currency || "USD").toUpperCase(),
          ]
        );
      }

      await dbRun(
        "UPDATE sponsorship_deals SET status='paid',payment_reference=?,updated_at=datetime('now') WHERE id=?",
        [paymentReference, dealId]
      );
      await ensurePayoutObligation(
        deal,
        "paddle",
        paymentReference,
        deal.agreed_amount ?? null,
        String(deal.currency || "USD").toUpperCase()
      );
      await dbRun(
        "INSERT OR IGNORE INTO sponsorship_engagement_events(id,need_id,sponsor_id,event_type) VALUES(?,?,?,'payment')",
        [`sev_${crypto.randomUUID()}`, deal.need_id, deal.sponsor_id]
      ).catch(() => {});
      await dbRun(
        "INSERT INTO sponsorship_deal_updates(id,deal_id,author_id,kind,text) VALUES(?,?,?,?,?)",
        [
          `sdu_${crypto.randomUUID()}`,
          dealId,
          deal.organizer_id,
          "payment",
          `Payment confirmed by Paddle. Reference: ${paymentReference}`,
        ]
      ).catch(() => {});

      await recordProviderEvent(eventId, eventType, dealId, payloadHash, "processed");
      return res.status(200).send("ok");
    }

    await recordProviderEvent(eventId, eventType, null, payloadHash, "ignored");
    return res.status(200).send("ok");
  }
);
