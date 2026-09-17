const MAX_LINKEDIN_AVATAR_BYTES = 1_450_000;
const LINKEDIN_AVATAR_TIMEOUT_MS = 8_000;

function isLinkedInImageHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return (
    host === "linkedin.com" ||
    host.endsWith(".linkedin.com") ||
    host === "licdn.com" ||
    host.endsWith(".licdn.com")
  );
}

/**
 * Copies the authenticated member's LinkedIn OpenID `picture` into a data URL that
 * ConferenceGate owns in its users.avatar database field.
 *
 * We intentionally never persist the LinkedIn CDN URL itself. Those URLs can expire,
 * reject hot-linking, or change independently of ConferenceGate. The copied data URL
 * is self-contained and continues to render after the OAuth request has finished.
 *
 * Failure is non-fatal: sign-in/linking still succeeds and the existing avatar remains.
 */
export async function copyLinkedInAvatarToDataUrl(rawUrl: string | null): Promise<string | null> {
  if (!rawUrl) return null;

  try {
    const sourceUrl = new URL(rawUrl);
    if (sourceUrl.protocol !== "https:" || !isLinkedInImageHost(sourceUrl.hostname)) {
      console.warn("[linkedin-avatar] Refusing unexpected profile image host", sourceUrl.hostname);
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LINKEDIN_AVATAR_TIMEOUT_MS);

    try {
      const response = await fetch(sourceUrl.toString(), {
        method: "GET",
        headers: {
          Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
          "User-Agent": "ConferenceGate/1.0",
        },
        redirect: "follow",
        signal: controller.signal,
      });

      if (!response.ok) {
        console.warn("[linkedin-avatar] LinkedIn image download failed", response.status);
        return null;
      }

      // Validate the final destination too, so a CDN redirect cannot turn this helper into
      // a general-purpose server-side URL fetcher.
      const finalUrl = new URL(response.url || sourceUrl.toString());
      if (finalUrl.protocol !== "https:" || !isLinkedInImageHost(finalUrl.hostname)) {
        console.warn("[linkedin-avatar] Refusing unexpected redirected image host", finalUrl.hostname);
        return null;
      }

      const contentType = (response.headers.get("content-type") || "")
        .split(";", 1)[0]
        .trim()
        .toLowerCase();
      if (!contentType.startsWith("image/")) {
        console.warn("[linkedin-avatar] LinkedIn picture response was not an image", contentType || "unknown");
        return null;
      }

      const declaredLength = Number(response.headers.get("content-length") || "0");
      if (Number.isFinite(declaredLength) && declaredLength > MAX_LINKEDIN_AVATAR_BYTES) {
        console.warn("[linkedin-avatar] LinkedIn picture is too large", declaredLength);
        return null;
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_LINKEDIN_AVATAR_BYTES) {
        console.warn("[linkedin-avatar] LinkedIn picture exceeded size limit", bytes.length);
        return null;
      }

      const dataUrl = `data:${contentType};base64,${bytes.toString("base64")}`;
      // Keep this aligned with the existing /api/auth/avatar limit (~2 MB as text).
      if (dataUrl.length > 2_000_000) {
        console.warn("[linkedin-avatar] Encoded LinkedIn picture exceeded avatar storage limit", dataUrl.length);
        return null;
      }
      return dataUrl;
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[linkedin-avatar] Could not copy LinkedIn profile photo", message);
    return null;
  }
}
