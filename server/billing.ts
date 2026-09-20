import { Router, Response } from "express";
import { AuthedRequest, requireAuth } from "./auth";
import { asyncHandler } from "./asyncHandler";
import { dbGet, dbRun, UserRow } from "./db";

export const billingRouter = Router();
billingRouter.use(requireAuth);

function hasPaidAccess(row: UserRow): boolean {
  return (
    row.role === "professional" ||
    row.subscription_status === "active" ||
    row.subscription_status === "trialing"
  );
}

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

// Provider-neutral subscription sync endpoint. A FastSpring/Paddle/other webhook adapter can
// call this after verifying that provider's webhook signature. It is intentionally protected by
// a separate server secret and is not callable from the browser.
billingRouter.post(
  "/provider-sync",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
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
