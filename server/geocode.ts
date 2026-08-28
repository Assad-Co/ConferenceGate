// Turns a place description into coordinates using OpenStreetMap's Nominatim service — free, no
// account, no API key. Used only to work out roughly how far a hotel is from a conference venue
// when the conference's own site lists the hotel but never says how far away it is.
//
// A distance produced this way is a straight-line estimate between two geocoded points. It is NOT
// the same claim as a distance the conference itself published, and callers are expected to keep
// the two apart and label them differently — an estimate presented as a published figure would be
// exactly the kind of invented detail the extraction is careful never to produce.

// Overridable so tests can point at a local stub instead of the live service.
const NOMINATIM_BASE_URL = process.env.NOMINATIM_BASE_URL || "https://nominatim.openstreetmap.org";
// Nominatim's usage policy requires a User-Agent that identifies the application, and asks for a
// contact address where one can be given.
const GEOCODE_CONTACT_EMAIL = process.env.GEOCODE_CONTACT_EMAIL || null;
const GEOCODE_USER_AGENT = `ConferenceGate/1.0 (conference venue and hotel distances${
  GEOCODE_CONTACT_EMAIL ? `; ${GEOCODE_CONTACT_EMAIL}` : ""
})`;

const GEOCODE_TIMEOUT_MS = 8000;
// Nominatim's usage policy caps clients at one request per second. This is a hard limit rather
// than a suggestion — exceeding it gets an IP blocked — so every lookup goes through one shared
// queue, process-wide, regardless of how many crawls are running.
const MIN_REQUEST_INTERVAL_MS = 1100;
// Coordinates for a named place effectively never move, so a hit can be kept for a long time.
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface GeoPoint {
  lat: number;
  lon: number;
}

const cache = new Map<string, { point: GeoPoint | null; expiresAt: number }>();

// Serialises every outbound lookup behind the rate limit: each call chains onto the previous one
// and waits out whatever is left of the interval since the last request actually went out.
let requestChain: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

function scheduleRateLimited<T>(work: () => Promise<T>): Promise<T> {
  const result = requestChain.then(async () => {
    const waitMs = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    lastRequestAt = Date.now();
    return work();
  });
  // The chain itself must never reject, or one failed lookup would poison every later one.
  requestChain = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

/** Resolves a free-text place ("The Barbican Centre, Silk Street, London") to coordinates.
 *  Returns null — never throws — when the place can't be found or the service is unreachable,
 *  so a caller can simply carry on without a distance rather than failing the whole crawl. */
export async function geocodePlace(query: string): Promise<GeoPoint | null> {
  const q = query.trim().replace(/\s+/g, " ");
  if (q.length < 3) return null;

  const cacheKey = q.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.point;

  let point: GeoPoint | null = null;
  try {
    point = await scheduleRateLimited(async () => {
      const params = new URLSearchParams({ q, format: "json", limit: "1" });
      if (GEOCODE_CONTACT_EMAIL) params.set("email", GEOCODE_CONTACT_EMAIL);
      const res = await fetch(`${NOMINATIM_BASE_URL}/search?${params.toString()}`, {
        headers: { "User-Agent": GEOCODE_USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const body = await res.json().catch(() => null);
      if (!Array.isArray(body) || body.length === 0) return null;
      const lat = Number(body[0]?.lat);
      const lon = Number(body[0]?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { lat, lon };
    });
  } catch {
    point = null;
  }

  // A miss is cached too, so a hotel whose name simply isn't findable doesn't get looked up again
  // on every later crawl of the same conference.
  cache.set(cacheKey, { point, expiresAt: Date.now() + CACHE_TTL_MS });
  return point;
}

/** Great-circle distance in metres between two points. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const EARTH_RADIUS_M = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h)));
}

/** Renders an estimated distance for display. Deliberately coarse — a straight-line estimate
 *  between two geocoded points does not deserve more precision than this implies. */
export function formatEstimatedDistance(meters: number): string {
  if (meters < 100) return "next to the venue (estimated)";
  if (meters < 1000) return `about ${Math.round(meters / 50) * 50} m from the venue (estimated)`;
  return `about ${(meters / 1000).toFixed(1)} km from the venue (estimated)`;
}
