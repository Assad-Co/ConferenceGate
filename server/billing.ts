import { Router, Response } from "express";
import crypto from "crypto";
import { AuthedRequest, requireAuth } from "./auth";
import { asyncHandler } from "./asyncHandler";
import { dbAll, dbGet, dbRun, UserRow } from "./db";
import { resolvePaidAccountContext } from "./workspaceAccess";
import { ensurePayoutObligation } from "./payouts";

export const billingRouter = Router();

function paddleApiBase(): string {
  return process.env.PADDLE_ENV?.trim().toLowerCase() === "sandbox"
    ? "https://sandbox-api.paddle.com"
    : "https://api.paddle.com";
}

async function createPaddleSubscriptionCheckout(row: UserRow): Promise<string | null> {
  const apiKey = process.env.PADDLE_API_KEY?.trim();
  const priceId =
    row.role === "organizer"
      ? process.env.PADDLE_ORGANIZER_PRICE_ID?.trim()
      : row.role === "sponsor"
        ? process.env.PADDLE_SPONSOR_PRICE_ID?.trim()
        : "";
  if (!apiKey || !priceId) return null;

  const response = await fetch(`${paddleApiBase()}/transactions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Paddle-Version": "1",
    },
    body: JSON.stringify({
      items: [{ price_id: priceId, quantity: 1 }],
      collection_mode: "automatic",
      custom_data: {
        conferencegate_user_id: row.id,
        conferencegate_role: row.role,
      },
    }),
  });

  const textBody = await response.text();
  let payload: any = {};
  try {
    payload = textBody ? JSON.parse(textBody) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const detail =
      payload?.error?.detail ||
      payload?.error?.code ||
      `Paddle checkout request failed with status ${response.status}.`;
    throw new Error(String(detail));
  }

  const checkoutUrl = payload?.data?.checkout?.url;
  return typeof checkoutUrl === "string" && /^https:\/\//i.test(checkoutUrl)
    ? checkoutUrl
    : null;
}

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

    await ensurePayoutObligation(deal, provider, paymentReference, amount, currency);

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

// Provider-confirmed refund sync for a sponsorship Deal Room. A refund reverses the collected
// payment. If the organizer payout already occurred, the payout obligation is held for manual
// reconciliation instead of falsely representing it as automatically recovered.
billingRouter.post(
  "/deal-refund-sync",
  asyncHandler(async (req, res: Response) => {
    const expected = process.env.BILLING_SYNC_SECRET?.trim();
    const supplied = String(req.header("x-billing-sync-secret") || "");
    if (!expected || supplied !== expected) return res.status(403).json({ error: "Forbidden" });

    const body = req.body || {};
    const provider = typeof body.provider === "string" ? body.provider.trim().toLowerCase() : "";
    const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
    const dealId = typeof body.dealId === "string" ? body.dealId.trim() : "";
    const refundReference =
      typeof body.refundReference === "string" ? body.refundReference.trim() : "";
    if (!provider || !eventId || !dealId || !refundReference || body.refunded !== true) {
      return res.status(400).json({
        error: "provider, eventId, dealId, refundReference and refunded=true are required",
      });
    }

    const duplicate = await dbGet<{ id: string }>(
      "SELECT id FROM billing_provider_events WHERE provider=? AND event_id=?",
      [provider, eventId]
    );
    if (duplicate) return res.json({ ok: true, duplicate: true });

    const payment = await dbGet<any>(
      "SELECT * FROM sponsorship_payments WHERE deal_id=? ORDER BY settled_at DESC LIMIT 1",
      [dealId]
    );
    if (!payment) return res.status(404).json({ error: "Settled sponsorship payment not found." });

    const obligation = await dbGet<any>(
      "SELECT * FROM sponsorship_payout_obligations WHERE deal_id=?",
      [dealId]
    );

    await dbRun("UPDATE sponsorship_payments SET status='refunded' WHERE id=?", [payment.id]);

    let payoutState: string | null = null;
    if (obligation) {
      payoutState = obligation.status === "paid" ? "held" : "refunded";
      await dbRun(
        "UPDATE sponsorship_payout_obligations SET status=?,updated_at=datetime('now') WHERE id=?",
        [payoutState, obligation.id]
      );
    }

    const deal = await dbGet<any>("SELECT * FROM sponsorship_deals WHERE id=?", [dealId]);
    if (deal) {
      await dbRun(
        "INSERT INTO sponsorship_deal_updates(id,deal_id,author_id,kind,text) VALUES(?,?,?,?,?)",
        [
          `sdu_${crypto.randomUUID()}`,
          dealId,
          deal.organizer_id,
          "payment",
          payoutState === "held"
            ? `Sponsor payment refunded by ${provider}. Organizer payout was already paid and now requires reconciliation. Refund reference: ${refundReference}`
            : `Sponsor payment refunded by ${provider}. Refund reference: ${refundReference}`,
        ]
      ).catch(() => {});
    }

    const payloadHash = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");
    await dbRun(
      "INSERT INTO billing_provider_events(id,provider,event_id,event_type,subject_id,payload_hash,status) VALUES(?,?,?,?,?,?,'processed')",
      [`bpe_${crypto.randomUUID()}`, provider, eventId, "deal.payment.refunded", dealId, payloadHash]
    );

    res.json({ ok: true, duplicate: false, payoutStatus: payoutState });
  })
);

// Provider-confirmed organizer payout sync. Sponsor payment and organizer payout are deliberately
// separate states: a collected sponsorship payment never implies that the organizer has been paid.
billingRouter.post(
  "/payout-sync",
  asyncHandler(async (req, res: Response) => {
    const expected = process.env.BILLING_SYNC_SECRET?.trim();
    const supplied = String(req.header("x-billing-sync-secret") || "");
    if (!expected || supplied !== expected) return res.status(403).json({ error: "Forbidden" });

    const body = req.body || {};
    const provider = typeof body.provider === "string" ? body.provider.trim().toLowerCase() : "";
    const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
    const dealId = typeof body.dealId === "string" ? body.dealId.trim() : "";
    const payoutReference =
      typeof body.payoutReference === "string" ? body.payoutReference.trim() : "";
    if (!provider || !eventId || !dealId || !payoutReference || body.paid !== true) {
      return res.status(400).json({
        error: "provider, eventId, dealId, payoutReference and paid=true are required",
      });
    }

    const duplicate = await dbGet<{ id: string }>(
      "SELECT id FROM billing_provider_events WHERE provider=? AND event_id=?",
      [provider, eventId]
    );
    if (duplicate) return res.json({ ok: true, duplicate: true });

    const obligation = await dbGet<any>(
      "SELECT * FROM sponsorship_payout_obligations WHERE deal_id=?",
      [dealId]
    );
    if (!obligation) {
      return res.status(404).json({ error: "Payout obligation not found for this deal." });
    }
    if (obligation.status === "paid") {
      return res.json({ ok: true, duplicate: true });
    }

    await dbRun(
      `UPDATE sponsorship_payout_obligations
          SET status='paid',payout_reference=?,paid_at=datetime('now'),updated_at=datetime('now')
        WHERE id=?`,
      [payoutReference, obligation.id]
    );

    const payloadHash = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");
    await dbRun(
      "INSERT INTO billing_provider_events(id,provider,event_id,event_type,subject_id,payload_hash,status) VALUES(?,?,?,?,?,?,'processed')",
      [`bpe_${crypto.randomUUID()}`, provider, eventId, "deal.payout.paid", dealId, payloadHash]
    );

    await dbRun(
      "INSERT INTO sponsorship_deal_updates(id,deal_id,author_id,kind,text) VALUES(?,?,?,?,?)",
      [
        `sdu_${crypto.randomUUID()}`,
        dealId,
        obligation.organizer_id,
        "payment",
        `Organizer payout confirmed by ${provider}. Reference: ${payoutReference}`,
      ]
    ).catch(() => {});

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
    const row = await dbGet<UserRow>("SELECT * FROM users WHERE id=?", [req.userId!]);
    if (!row || (row.role !== "organizer" && row.role !== "sponsor")) {
      return res.status(403).json({ error: "Organizer or Sponsor account required." });
    }
    const context = await resolvePaidAccountContext(req.userId!, row.role);
    if (!context?.paid) {
      return res.status(402).json({ error: "Paid workspace subscription required." });
    }
    const accountId = context.accountId;

    const payments = await dbGet<{ count: number }>(
      row.role === "organizer"
        ? `SELECT COUNT(*) as count
             FROM sponsorship_payments p
             JOIN sponsorship_deals d ON d.id=p.deal_id
            WHERE d.organizer_id=? AND p.status='settled'`
        : `SELECT COUNT(*) as count
             FROM sponsorship_payments p
             JOIN sponsorship_deals d ON d.id=p.deal_id
            WHERE d.sponsor_id=? AND p.status='settled'`,
      [accountId]
    );
    const paymentCurrencyTotals = await dbAll<{ currency: string; amount: number | null }>(
      row.role === "organizer"
        ? `SELECT p.currency as currency, COALESCE(SUM(p.amount),0) as amount
             FROM sponsorship_payments p
             JOIN sponsorship_deals d ON d.id=p.deal_id
            WHERE d.organizer_id=? AND p.status='settled'
            GROUP BY p.currency ORDER BY p.currency`
        : `SELECT p.currency as currency, COALESCE(SUM(p.amount),0) as amount
             FROM sponsorship_payments p
             JOIN sponsorship_deals d ON d.id=p.deal_id
            WHERE d.sponsor_id=? AND p.status='settled'
            GROUP BY p.currency ORDER BY p.currency`,
      [accountId]
    );
    const recent = await dbAll<any>(
      row.role === "organizer"
        ? `SELECT p.*,d.conference_title,d.opportunity_title,
                  o.status as payout_status,o.payout_amount,o.platform_fee_amount,o.payout_reference,o.paid_at
             FROM sponsorship_payments p
             JOIN sponsorship_deals d ON d.id=p.deal_id
             LEFT JOIN sponsorship_payout_obligations o ON o.deal_id=d.id
            WHERE d.organizer_id=? ORDER BY p.settled_at DESC LIMIT 50`
        : `SELECT p.*,d.conference_title,d.opportunity_title
             FROM sponsorship_payments p JOIN sponsorship_deals d ON d.id=p.deal_id
            WHERE d.sponsor_id=? ORDER BY p.settled_at DESC LIMIT 50`,
      [accountId]
    );

    const payoutSummary =
      row.role === "organizer"
        ? await dbGet<{ pending_count: number }>(
            `SELECT SUM(CASE WHEN status IN ('pending','held') THEN 1 ELSE 0 END) AS pending_count
               FROM sponsorship_payout_obligations
              WHERE organizer_id=?`,
            [accountId]
          )
        : undefined;
    const payoutPaidCurrencyTotals =
      row.role === "organizer"
        ? await dbAll<{ currency: string; amount: number | null }>(
            `SELECT currency, COALESCE(SUM(payout_amount),0) as amount
               FROM sponsorship_payout_obligations
              WHERE organizer_id=? AND status='paid'
              GROUP BY currency ORDER BY currency`,
            [accountId]
          )
        : [];
    const payoutPendingCurrencyTotals =
      row.role === "organizer"
        ? await dbAll<{ currency: string; amount: number | null }>(
            `SELECT currency, COALESCE(SUM(payout_amount),0) as amount
               FROM sponsorship_payout_obligations
              WHERE organizer_id=? AND status IN ('pending','held')
              GROUP BY currency ORDER BY currency`,
            [accountId]
          )
        : [];

    res.json({
      summary: {
        settledPayments: Number(payments?.count || 0),
        currencyTotals: paymentCurrencyTotals.map((item) => ({
          currency: String(item.currency || "USD").toUpperCase(),
          amount: Number(item.amount || 0),
        })),
        payoutPaidCurrencyTotals: payoutPaidCurrencyTotals.map((item) => ({
          currency: String(item.currency || "USD").toUpperCase(),
          amount: Number(item.amount || 0),
        })),
        payoutPendingCurrencyTotals: payoutPendingCurrencyTotals.map((item) => ({
          currency: String(item.currency || "USD").toUpperCase(),
          amount: Number(item.amount || 0),
        })),
        payoutPendingCount: Number(payoutSummary?.pending_count || 0),
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
        payoutStatus: payment.payout_status || null,
        payoutAmount: payment.payout_amount === null || payment.payout_amount === undefined ? null : Number(payment.payout_amount),
        platformFeeAmount: payment.platform_fee_amount === null || payment.platform_fee_amount === undefined ? null : Number(payment.platform_fee_amount),
        payoutReference: payment.payout_reference || null,
        payoutPaidAt: payment.paid_at || null,
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

    const checkoutProvider = process.env.BILLING_CHECKOUT_PROVIDER?.trim().toLowerCase();
    if (checkoutProvider === "paddle") {
      try {
        const paddleCheckout = await createPaddleSubscriptionCheckout(row);
        if (!paddleCheckout) {
          return res.status(503).json({
            error:
              row.role === "organizer"
                ? "Paddle Organizer Pro checkout is not configured yet."
                : "Paddle Sponsor Pro checkout is not configured yet.",
          });
        }
        return res.json({ checkoutUrl: paddleCheckout, alreadyActive: false, provider: "paddle" });
      } catch (error: any) {
        return res.status(502).json({
          error: error?.message || "Could not create Paddle checkout.",
        });
      }
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
    res.json({ checkoutUrl, alreadyActive: false, provider: checkoutProvider || "hosted" });
  })
);

