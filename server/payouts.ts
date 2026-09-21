import crypto from "crypto";
import { dbGet, dbRun, SponsorshipDealRow, SponsorshipPayoutObligationRow } from "./db";

function configuredFeeBps(): number {
  const raw = Number(process.env.SPONSORSHIP_PLATFORM_FEE_BPS || 0);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(10000, Math.round(raw)));
}

export async function ensurePayoutObligation(
  deal: SponsorshipDealRow,
  provider: string,
  paymentReference: string,
  amount: number | null,
  currency: string
): Promise<SponsorshipPayoutObligationRow> {
  const existing = await dbGet<SponsorshipPayoutObligationRow>(
    "SELECT * FROM sponsorship_payout_obligations WHERE deal_id=?",
    [deal.id]
  );
  if (existing) return existing;

  const feeBps = configuredFeeBps();
  const gross = amount === null ? null : Number(amount);
  const platformFee =
    gross === null ? 0 : Number(((gross * feeBps) / 10000).toFixed(2));
  const payout =
    gross === null ? null : Number(Math.max(0, gross - platformFee).toFixed(2));

  const id = `spo_${crypto.randomUUID()}`;
  await dbRun(
    `INSERT INTO sponsorship_payout_obligations(
      id,deal_id,organizer_id,provider,payment_reference,gross_amount,
      platform_fee_amount,payout_amount,currency,status
    ) VALUES(?,?,?,?,?,?,?,?,?,'pending')`,
    [
      id,
      deal.id,
      deal.organizer_id,
      provider,
      paymentReference,
      gross,
      platformFee,
      payout,
      currency,
    ]
  );

  return (await dbGet<SponsorshipPayoutObligationRow>(
    "SELECT * FROM sponsorship_payout_obligations WHERE id=?",
    [id]
  ))!;
}
