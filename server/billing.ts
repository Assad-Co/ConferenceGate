import { Router, Response } from "express";
import crypto from "crypto";
import { AuthedRequest, requireAuth } from "./auth";
import { asyncHandler } from "./asyncHandler";
import { dbAll, dbGet, dbRun, UserRow } from "./db";
import { resolvePaidAccountContext } from "./workspaceAccess";

export const billingRouter = Router();

function hasPaidAccess(row: UserRow): boolean {
  return (
    row.role === "professional" ||
    row.subscription_status === "active" ||
    row.subscription_status === "trialing"
  );
}


// Provider-neutral subscription sync endpoint for a verified payment-provider adapter.
// This route intentionally does not require a browser session; it is protected by a separate
// server-side secret and should only be called after the provider webhook signature is verified.
// Provider-neutral subscription sync endpoint. A FastSpring/Paddle/other webhook adapter can
// call this after verifying that provider's webhook signature. It is intentionally protected by
// a separate server secret and is not callable from the browser.
billingRouter.post(
  "/provider-sync",
  asyncHandler(async (req, res: Response) => {
    const expected = process.env.BILLING_SYNC_SECRET?.trim();
    const supplied = String(req.header("x-billing-sync-secret") || "");
    if (!expected || supplied !== expected) return res.status(403).json({ error: "Forbidden" });

    const body = req.body || {};
    const provider = typeof body.provider === "string" ? body.provider.trim().toLowerCase() : "";
    const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
    const eventType = typeof body.eventType === "string" ? body.eventType.trim() : "subscription.sync";
    const allowed = new Set(["required", "trialing", "active", "past_due", "canceled"]);
    const status = typeof body.status === "string" && allowed.has(body.status) ? body.status : null;
    const userId = typeof body.userId === "string" ? body.userId : "";
    if (!provider || !eventId || !userId || !status) {
      return res.status(400).json({ error: "provider, eventId, userId and valid status are required" });
    }

    const existing = await dbGet<{ id: string }>(
      "SELECT id FROM billing_provider_events WHERE provider=? AND event_id=?",
      [provider, eventId]
    );
    if (existing) return res.json({ ok: true, duplicate: true });

    const payloadHash = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");

    await dbRun(
      `UPDATE users
          SET subscription_status = ?,
              subscription_plan = ?,
              subscription_provider = ?,
              subscription_period_end = ?,
              billing_customer_ref = ?
        WHERE id = ? AND role IN ('organizer','sponsor')`,
      [
        status,
        typeof body.plan === "string" ? body.plan : null,
        provider,
        typeof body.periodEnd === "string" ? body.periodEnd : null,
        typeof body.customerRef === "string" ? body.customerRef : null,
        userId,
      ]
    );

    await dbRun(
      "INSERT INTO billing_provider_events(id,provider,event_id,event_type,subject_id,payload_hash,status) VALUES(?,?,?,?,?,?,'processed')",
      [`bpe_${crypto.randomUUID()}`, provider, eventId, eventType, userId, payloadHash]
    );

    res.json({ ok: true, duplicate: false });
  })
);

// Payment-provider settlement sync for a sponsorship Deal Room. Only a verified provider
// adapter with BILLING_SYNC_SECRET can mark a deal as paid; users cannot self-assert payment.
billingRouter.post(
  "/deal-payment-sync",
  asyncHandler(async (req, res: Response) => {
    const expected = process.env.BILLING_SYNC_SECRET?.trim();
    const supplied = String(req.header("x-billing-sync-secret") || "");
    if (!expected || supplied !== expected) return res.status(403).json({ error: "Forbidden" });

    const body = req.body || {};
    const provider = typeof body.provider === "string" ? body.provider.trim().toLowerCase() : "";
    const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
    const dealId = typeof body.dealId === "string" ? body.dealId : "";
    const paymentReference =
      typeof body.paymentReference === "string" ? body.paymentReference.trim() : "";
    const paid = body.paid === true;
    if (!provider || !eventId || !dealId || !paid || !paymentReference) {
      return res.status(400).json({
        error: "provider, eventId, dealId, paid=true, and paymentReference are required",
      });
    }

    const duplicateEvent = await dbGet<{ id: string }>(
      "SELECT id FROM billing_provider_events WHERE provider=? AND event_id=?",
      [provider, eventId]
    );
    if (duplicateEvent) return res.json({ ok: true, duplicate: true });

    const deal = await dbGet<any>("SELECT * FROM sponsorship_deals WHERE id=?", [dealId]);
    if (!deal) return res.status(404).json({ error: "Deal not found" });

    const existingPayment = await dbGet<any>(
      "SELECT * FROM sponsorship_payments WHERE payment_reference=?",
      [paymentReference]
    );
    if (existingPayment && existingPayment.deal_id !== dealId) {
      return res.status(409).json({ error: "Payment reference is already linked to another deal." });
    }

    const amount =
      body.amount === undefined || body.amount === null || body.amount === ""
        ? (deal.agreed_amount ?? null)
        : Number(body.amount);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      return res.status(400).json({ error: "amount must be a positive number." });
    }
    const currency =
      typeof body.currency === "string" && /^[A-Z]{3}$/.test(body.currency.trim().toUpperCase())
        ? body.currency.trim().toUpperCase()
        : String(deal.currency || "USD").toUpperCase();

    await dbRun(
      "UPDATE sponsorship_deals SET status='paid',payment_reference=?,updated_at=datetime('now') WHERE id=?",
      [paymentReference, dealId]
    );

    if (!existingPayment) {
      await dbRun(
        "INSERT INTO sponsorship_payments(id,deal_id,provider,payment_reference,amount,currency,status) VALUES(?,?,?,?,?,?,'settled')",
        [`spay_${crypto.randomUUID()}`, dealId, provider, paymentReference, amount, currency]
      );
    }

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
        `Payment confirmed by ${provider}. Reference: ${paymentReference}`,
      ]
    ).catch(() => {});

    const payloadHash = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");
    await dbRun(
      "INSERT INTO billing_provider_events(id,provider,event_id,event_type,subject_id,payload_hash,status) VALUES(?,?,?,?,?,?,'processed')",
      [`bpe_${crypto.randomUUID()}`, provider, eventId, "deal.payment.settled", dealId, payloadHash]
    );

    res.json({ ok: true, duplicate: false });
  })
);

billingRouter.use(requireAuth);

billingRouter.get(
  "/status",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const row = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [req.userId!]);
    if (!row) return res.status(404).json({ error: "Account not found" });
    if (row.role === "professional") {
      return res.json({
        role: row.role,
        status: "free",
        plan: "professional_free",
        provider: null,
        periodEnd: null,
        hasPaidAccess: true,
        workspaceId: null,
        workspaceRole: null,
      });
    }
    const context = await resolvePaidAccountContext(req.userId!, row.role);
    const billingOwner = context?.accountOwner || row;
    res.json({
      role: row.role,
      status: billingOwner.subscription_status || "required",
      plan: billingOwner.subscription_plan || null,
      provider: billingOwner.subscription_provider || null,
      periodEnd: billingOwner.subscription_period_end || null,
      hasPaidAccess: Boolean(context?.paid),
      workspaceId: context?.workspaceId || null,
      workspaceRole: context?.workspaceRole || null,
    });
  })
);

billingRouter.get(
  "/ledger/mine",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const row = await dbGet<UserRow>("SELECT * FROM users WHERE id=?", [accountId]);
    if (!row || !["organizer","sponsor"].includes(row.role)) {
      return res.status(403).json({ error: "Organizer or Sponsor account required." });
    }
    const context = await resolvePaidAccountContext(req.userId!, row.role);
    if (!context?.paid) {
      return res.status(402).json({ error: "Paid workspace subscription required." });
    }
    const accountId = context.accountId;

    const payments = await dbGet<{ count: number; total: number | null }>(
      row.role === "organizer"
        ? `SELECT COUNT(*) as count, COALESCE(SUM(p.amount),0) as total
             FROM sponsorship_payments p
             JOIN sponsorship_deals d ON d.id=p.deal_id
            WHERE d.organizer_id=? AND p.status='settled'`
        : `SELECT COUNT(*) as count, COALESCE(SUM(p.amount),0) as total
             FROM sponsorship_payments p
             JOIN sponsorship_deals d ON d.id=p.deal_id
            WHERE d.sponsor_id=? AND p.status='settled'`,
      [accountId]
    );
    const recent = await dbAll<any>(
      row.role === "organizer"
        ? `SELECT p.*,d.conference_title,d.opportunity_title
             FROM sponsorship_payments p JOIN sponsorship_deals d ON d.id=p.deal_id
            WHERE d.organizer_id=? ORDER BY p.settled_at DESC LIMIT 50`
        : `SELECT p.*,d.conference_title,d.opportunity_title
             FROM sponsorship_payments p JOIN sponsorship_deals d ON d.id=p.deal_id
            WHERE d.sponsor_id=? ORDER BY p.settled_at DESC LIMIT 50`,
      [accountId]
    );

    res.json({
      summary: {
        settledPayments: Number(payments?.count || 0),
        settledAmount: Number(payments?.total || 0),
      },
      payments: recent.map((payment: any) => ({
        id: payment.id,
        dealId: payment.deal_id,
        conferenceTitle: payment.conference_title,
        opportunityTitle: payment.opportunity_title,
        provider: payment.provider,
        paymentReference: payment.payment_reference,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        settledAt: payment.settled_at,
      })),
    });
  })
);

billingRouter.get(
  "/checkout",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const row = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [req.userId!]);
    if (!row) return res.status(404).json({ error: "Account not found" });
    if (row.role === "professional") {
      return res.status(400).json({ error: "Professional accounts are free and do not require checkout." });
    }
    const context = await resolvePaidAccountContext(req.userId!, row.role);
    if (context?.paid) {
      return res.json({ checkoutUrl: null, alreadyActive: true });
    }
    if (context?.workspaceId && context.accountId !== row.id) {
      return res.status(409).json({
        error: "This seat belongs to a team workspace. The workspace owner must reactivate the paid subscription.",
      });
    }

    const checkoutUrl =
      row.role === "organizer"
        ? process.env.ORGANIZER_CHECKOUT_URL?.trim()
        : process.env.SPONSOR_CHECKOUT_URL?.trim();

    if (!checkoutUrl || !/^https:\/\//i.test(checkoutUrl)) {
      return res.status(503).json({
        error:
          row.role === "organizer"
            ? "Organizer checkout is not configured yet."
            : "Sponsor checkout is not configured yet.",
      });
    }
    res.json({ checkoutUrl, alreadyActive: false });
  })
);

