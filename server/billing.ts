import { Router, Response } from "express";
import crypto from "crypto";
import { AuthedRequest, requireAuth } from "./auth";
import { asyncHandler } from "./asyncHandler";
import { dbGet, dbRun, UserRow } from "./db";

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
    const allowed = new Set(["required", "trialing", "active", "past_due", "canceled"]);
    const status = typeof body.status === "string" && allowed.has(body.status) ? body.status : null;
    const userId = typeof body.userId === "string" ? body.userId : "";
    if (!userId || !status) return res.status(400).json({ error: "userId and valid status are required" });

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
        typeof body.provider === "string" ? body.provider : null,
        typeof body.periodEnd === "string" ? body.periodEnd : null,
        typeof body.customerRef === "string" ? body.customerRef : null,
        userId,
      ]
    );
    res.json({ ok: true });
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

    const dealId = typeof req.body?.dealId === "string" ? req.body.dealId : "";
    const paymentReference =
      typeof req.body?.paymentReference === "string" ? req.body.paymentReference.trim() : "";
    const paid = req.body?.paid === true;
    if (!dealId || !paid || !paymentReference) {
      return res.status(400).json({ error: "dealId, paid=true, and paymentReference are required" });
    }

    const deal = await dbGet<any>("SELECT * FROM sponsorship_deals WHERE id=?", [dealId]);
    if (!deal) return res.status(404).json({ error: "Deal not found" });

    await dbRun(
      "UPDATE sponsorship_deals SET status='paid',payment_reference=?,updated_at=datetime('now') WHERE id=?",
      [paymentReference, dealId]
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
        `Payment confirmed by provider. Reference: ${paymentReference}`,
      ]
    ).catch(() => {});
    res.json({ ok: true });
  })
);

billingRouter.use(requireAuth);

billingRouter.get(
  "/status",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const row = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [req.userId!]);
    if (!row) return res.status(404).json({ error: "Account not found" });
    res.json({
      role: row.role,
      status: row.role === "professional" ? "free" : row.subscription_status || "required",
      plan: row.subscription_plan || (row.role === "professional" ? "professional_free" : null),
      provider: row.subscription_provider || null,
      periodEnd: row.subscription_period_end || null,
      hasPaidAccess: hasPaidAccess(row),
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
    if (hasPaidAccess(row)) {
      return res.json({ checkoutUrl: null, alreadyActive: true });
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

