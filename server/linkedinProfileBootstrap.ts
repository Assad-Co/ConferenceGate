import express, { Router, type NextFunction, type Request, type Response } from "express";

/**
 * Consent-based LinkedIn public-profile enrichment.
 *
 * This module is loaded from server/env.ts before server.ts creates the Express app. ConferenceGate's
 * server is intentionally kept as one large application file, so this module mounts itself at the
 * moment the app registers /api/health. At that point express.json() and cookieParser() have already
 * been installed, while all application routes are still to come.
 *
 * The scraper is never called automatically. A signed-in member must explicitly press the import
 * button, which sends consent=true and that member's own public LinkedIn profile URL.
 */

const ACTOR_ID = "harvestapi~linkedin-profile-scraper";
const ACTOR_MODE = "Profile details no email ($4 per 1k)";
const SOURCE_ACTOR = "harvestapi/linkedin-profile-scraper";

type AuthedRequest = Request & { linkedinProfileUserId?: string };

type StoredRow = {
  user_id: string;
  linkedin_url: string;
  linkedin_id: string | null;
  public_identifier: string | null;
  full_name: string | null;
  headline: string | null;
  about: string | null;
  location_text: string | null;
  city: string | null;
  country: string | null;
  photo_url: string | null;
  verified: number;
  experience: string;
  education: string;
  publications: string;
  patents: string;
  certifications: string;
  projects: string;
  skills: string;
  honors_awards: string;
  languages: string;
  raw_profile: string;
  source_actor: string;
  consented_at: string;
  fetched_at: string;
};

const router = Router();
let schemaReady: Promise<void> | null = null;

function safe(handler: (req: AuthedRequest, res: Response) => Promise<unknown>) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res)).catch(next);
  };
}

async function requireMember(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const { COOKIE_NAME, verifySessionToken } = await import("./auth");
    const userId = verifySessionToken(req.cookies?.[COOKIE_NAME]);
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    req.linkedinProfileUserId = userId;
    next();
  } catch (error) {
    next(error);
  }
}

async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const { dbRun } = await import("./db");
      await dbRun(`CREATE TABLE IF NOT EXISTS linkedin_profile_enrichment (
        user_id TEXT PRIMARY KEY REFERENCES users(id),
        linkedin_url TEXT NOT NULL,
        linkedin_id TEXT,
        public_identifier TEXT,
        full_name TEXT,
        headline TEXT,
        about TEXT,
        location_text TEXT,
        city TEXT,
        country TEXT,
        photo_url TEXT,
        verified INTEGER NOT NULL DEFAULT 0,
        experience TEXT NOT NULL DEFAULT '[]',
        education TEXT NOT NULL DEFAULT '[]',
        publications TEXT NOT NULL DEFAULT '[]',
        patents TEXT NOT NULL DEFAULT '[]',
        certifications TEXT NOT NULL DEFAULT '[]',
        projects TEXT NOT NULL DEFAULT '[]',
        skills TEXT NOT NULL DEFAULT '[]',
        honors_awards TEXT NOT NULL DEFAULT '[]',
        languages TEXT NOT NULL DEFAULT '[]',
        raw_profile TEXT NOT NULL DEFAULT '{}',
        source_actor TEXT NOT NULL,
        consented_at TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      )`);
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

function normalizeLinkedInProfileUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim().replace(/^@/, "");
  if (!value) return null;

  if (!/^https?:\/\//i.test(value)) {
    value = value
      .replace(/^(www\.)?linkedin\.com\//i, "")
      .replace(/^in\//i, "")
      .replace(/^\/+|\/+$/g, "");
    if (!value) return null;
    value = `https://www.linkedin.com/in/${value}`;
  }

  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
    const match = url.pathname.match(/^\/in\/([^/?#]+)/i);
    if (!match?.[1]) return null;
    return `https://www.linkedin.com/in/${match[1]}`;
  } catch {
    return null;
  }
}

function profileSlug(value: unknown): string | null {
  const normalized = normalizeLinkedInProfileUrl(value);
  if (!normalized) return null;
  try {
    return new URL(normalized).pathname.split("/").filter(Boolean)[1]?.toLowerCase() || null;
  } catch {
    return null;
  }
}

function arrayValue(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function jsonArray(value: unknown): string {
  return JSON.stringify(arrayValue(value));
}

function parseArray(value: string | null | undefined): any[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function currentCareer(profile: Record<string, any>) {
  const experience = arrayValue(profile.experience);
  const current = experience.find((item) => {
    const endText = text(item?.endDate?.text);
    return !endText || /present|current/i.test(endText);
  }) || experience[0] || null;

  const firstCurrentPosition = arrayValue(profile.currentPosition)[0] || null;

  return {
    title: text(current?.position) || text(profile.headline),
    organization: text(current?.companyName) || text(firstCurrentPosition?.companyName),
  };
}

function locationFields(profile: Record<string, any>) {
  const location = objectValue(profile.location);
  const parsed = objectValue(location.parsed);
  return {
    locationText: text(location.linkedinText) || text(parsed.text),
    city: text(parsed.city),
    country: text(parsed.country) || text(parsed.countryFull),
  };
}

function toClient(row: StoredRow | undefined) {
  if (!row) return null;
  const experience = parseArray(row.experience);
  const career = currentCareer({ experience, headline: row.headline });
  return {
    linkedinUrl: row.linkedin_url,
    linkedinId: row.linkedin_id,
    publicIdentifier: row.public_identifier,
    fullName: row.full_name,
    headline: row.headline,
    about: row.about,
    locationText: row.location_text,
    city: row.city,
    country: row.country,
    photoUrl: row.photo_url,
    verified: !!row.verified,
    currentTitle: career.title,
    currentOrganization: career.organization,
    experience,
    education: parseArray(row.education),
    publications: parseArray(row.publications),
    patents: parseArray(row.patents),
    certifications: parseArray(row.certifications),
    projects: parseArray(row.projects),
    skills: parseArray(row.skills),
    honorsAndAwards: parseArray(row.honors_awards),
    languages: parseArray(row.languages),
    sourceActor: row.source_actor,
    consentedAt: row.consented_at,
    fetchedAt: row.fetched_at,
  };
}

async function readStoredProfile(userId: string) {
  await ensureSchema();
  const { dbGet } = await import("./db");
  const row = await dbGet<StoredRow>(
    "SELECT * FROM linkedin_profile_enrichment WHERE user_id = ?",
    [userId],
  );
  return toClient(row);
}

router.get("/me", requireMember, safe(async (req, res) => {
  const profile = await readStoredProfile(req.linkedinProfileUserId!);
  res.json({
    profile,
    apifyConfigured: Boolean(process.env.APIFY_TOKEN?.trim()),
  });
}));

router.post("/refresh", requireMember, safe(async (req, res) => {
  if (req.body?.consent !== true) {
    return res.status(400).json({
      error: "Explicit consent is required before importing a LinkedIn public profile.",
    });
  }

  const { dbGet, dbRun } = await import("./db");
  const userId = req.linkedinProfileUserId!;
  const user = await dbGet<any>("SELECT * FROM users WHERE id = ?", [userId]);
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const requestedUrl = normalizeLinkedInProfileUrl(req.body?.linkedinUrl || user.linkedin_url);
  if (!requestedUrl) {
    return res.status(400).json({
      error: "Add your public LinkedIn profile URL first (linkedin.com/in/...).",
    });
  }

  const apifyToken = process.env.APIFY_TOKEN?.trim();
  if (!apifyToken) {
    return res.status(503).json({
      error: "LinkedIn profile import is not configured on this server yet.",
      code: "APIFY_NOT_CONFIGURED",
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  let response: globalThis.Response;
  try {
    const endpoint = new URL(
      `https://api.apify.com/v2/actors/${ACTOR_ID}/run-sync-get-dataset-items`,
    );
    endpoint.searchParams.set("format", "json");
    endpoint.searchParams.set("clean", "true");
    endpoint.searchParams.set("maxItems", "1");
    endpoint.searchParams.set("maxTotalChargeUsd", "0.05");

    response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${apifyToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        profileScraperMode: ACTOR_MODE,
        queries: [requestedUrl],
      }),
    });
  } catch (error: any) {
    clearTimeout(timeout);
    if (error?.name === "AbortError") {
      return res.status(504).json({ error: "LinkedIn profile import timed out. Please try again." });
    }
    throw error;
  }
  clearTimeout(timeout);

  if (!response.ok) {
    return res.status(502).json({
      error: `LinkedIn profile provider returned HTTP ${response.status}. Please try again.`,
    });
  }

  const result = await response.json().catch(() => null);
  const items = Array.isArray(result) ? result : [];
  const profile = objectValue(items.find((item) => item && typeof item === "object"));
  if (!Object.keys(profile).length || Number(profile.status || 200) >= 400) {
    return res.status(404).json({ error: "No public LinkedIn profile data was returned for this URL." });
  }

  const requestedSlug = profileSlug(requestedUrl);
  const returnedUrl = normalizeLinkedInProfileUrl(profile.linkedinUrl) || requestedUrl;
  const returnedSlug = profileSlug(returnedUrl);
  if (requestedSlug && returnedSlug && requestedSlug !== returnedSlug) {
    return res.status(409).json({
      error: "The returned LinkedIn profile did not match the profile URL you requested.",
    });
  }

  const location = locationFields(profile);
  const career = currentCareer(profile);
  const fullName = [text(profile.firstName), text(profile.lastName)].filter(Boolean).join(" ") || null;
  const now = new Date().toISOString();
  const about = text(profile.about);

  await ensureSchema();
  await dbRun(
    `INSERT INTO linkedin_profile_enrichment (
      user_id, linkedin_url, linkedin_id, public_identifier, full_name,
      headline, about, location_text, city, country, photo_url, verified,
      experience, education, publications, patents, certifications, projects,
      skills, honors_awards, languages, raw_profile, source_actor, consented_at, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      linkedin_url = excluded.linkedin_url,
      linkedin_id = excluded.linkedin_id,
      public_identifier = excluded.public_identifier,
      full_name = excluded.full_name,
      headline = excluded.headline,
      about = excluded.about,
      location_text = excluded.location_text,
      city = excluded.city,
      country = excluded.country,
      photo_url = excluded.photo_url,
      verified = excluded.verified,
      experience = excluded.experience,
      education = excluded.education,
      publications = excluded.publications,
      patents = excluded.patents,
      certifications = excluded.certifications,
      projects = excluded.projects,
      skills = excluded.skills,
      honors_awards = excluded.honors_awards,
      languages = excluded.languages,
      raw_profile = excluded.raw_profile,
      source_actor = excluded.source_actor,
      consented_at = excluded.consented_at,
      fetched_at = excluded.fetched_at`,
    [
      userId,
      returnedUrl,
      text(profile.id),
      text(profile.publicIdentifier),
      fullName,
      text(profile.headline),
      about,
      location.locationText,
      location.city,
      location.country,
      text(profile.photo),
      profile.verified === true ? 1 : 0,
      jsonArray(profile.experience),
      jsonArray(profile.education),
      jsonArray(profile.publications),
      jsonArray(profile.patents),
      jsonArray(profile.certifications),
      jsonArray(profile.projects),
      jsonArray(profile.skills),
      jsonArray(profile.honorsAndAwards),
      jsonArray(profile.languages),
      JSON.stringify(profile),
      SOURCE_ACTOR,
      now,
      now,
    ],
  );

  // Import is additive. Existing member-written profile fields always win; LinkedIn only fills blanks.
  await dbRun(
    `UPDATE users SET
       linkedin_url = ?,
       title = CASE WHEN COALESCE(TRIM(title), '') = '' THEN ? ELSE title END,
       organization = CASE WHEN COALESCE(TRIM(organization), '') = '' THEN ? ELSE organization END,
       city = CASE WHEN COALESCE(TRIM(city), '') = '' THEN ? ELSE city END,
       country = CASE WHEN COALESCE(TRIM(country), '') = '' THEN ? ELSE country END,
       bio = CASE WHEN COALESCE(TRIM(bio), '') = '' THEN ? ELSE bio END
     WHERE id = ?`,
    [
      returnedUrl,
      career.title,
      career.organization,
      location.city,
      location.country,
      about ? about.slice(0, 600) : null,
      userId,
    ],
  );

  const stored = await readStoredProfile(userId);
  res.json({
    profile: stored,
    imported: true,
    counts: {
      experience: stored?.experience.length || 0,
      education: stored?.education.length || 0,
      publications: stored?.publications.length || 0,
      patents: stored?.patents.length || 0,
      certifications: stored?.certifications.length || 0,
    },
  });
}));

router.delete("/me", requireMember, safe(async (req, res) => {
  await ensureSchema();
  const { dbRun } = await import("./db");
  await dbRun("DELETE FROM linkedin_profile_enrichment WHERE user_id = ?", [req.linkedinProfileUserId!]);
  res.json({ ok: true });
}));

// Mount after express.json() + cookieParser(), immediately before the normal application routes.
const application: any = express.application as any;
if (!application.__conferenceGateLinkedInProfilePatch) {
  application.__conferenceGateLinkedInProfilePatch = true;
  const originalGet = application.get;
  const originalUse = application.use;

  application.get = function patchedGet(path: unknown, ...handlers: any[]) {
    if (
      path === "/api/health" &&
      !this.locals?.__linkedinProfileRouterMounted
    ) {
      this.locals = this.locals || {};
      this.locals.__linkedinProfileRouterMounted = true;
      originalUse.call(this, "/api/linkedin-profile", router);
    }
    return originalGet.call(this, path, ...handlers);
  };
}

export { router as linkedinProfileRouter };
