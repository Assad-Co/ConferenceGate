import crypto from "crypto";

const DEFAULT_OWNER_PREVIEW_EMAIL_SHA256 =
  "316878b65df874d3ddf107b17a1af0849e4362c8383c02c10c814efd45fe591e";

function normalizedEmailHash(email: string): string {
  return crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

/**
 * ConferenceGate owner preview access.
 *
 * The default compares a SHA-256 digest instead of storing the owner's email address in this
 * public repository. Deployments can replace it with OWNER_PREVIEW_EMAIL_SHA256.
 *
 * This does not bypass authentication: a valid signed-in ConferenceGate account is still required.
 * It only bypasses paid-role gating and enables Organizer/Sponsor preview navigation for that exact
 * authenticated account.
 */
export function isOwnerPreviewEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const expected =
    process.env.OWNER_PREVIEW_EMAIL_SHA256?.trim().toLowerCase() ||
    DEFAULT_OWNER_PREVIEW_EMAIL_SHA256;
  if (!/^[a-f0-9]{64}$/.test(expected)) return false;
  const actual = normalizedEmailHash(email);
  try {
    return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
