import express, { Router, type NextFunction, type Request, type Response } from "express";

/**
 * Consent-based LinkedIn conference-activity enrichment.
 *
 * Reads public posts from the member's own LinkedIn profile with HarvestAPI/Apify,
 * then stores only conference-related signals. Reposts/quotes can surface opportunities,
 * but never count as proof that the member attended, authored, chaired, or spoke.
 */

const POSTS_ACTOR_ID = "harvestapi~linkedin-profile-posts";
const SOURCE_ACTOR = "harvestapi/linkedin-profile-posts";
const MAX_POSTS = 1000;

type AuthedRequest = Request & { linkedinConferenceUserId?: string };

type StoredActivityRow = {
  user_id: string;
  linkedin_url: string;
  conference_activity: string;
  calls_for_papers: string;
  raw_posts: string;
  source_actor: string;
  consented_at: string;
  fetched_at: string;
};

export type LinkedInConferenceSignal = {
  id: string;
  kind:
    | "PAST_CONFERENCE"
    | "UPCOMING_CONFERENCE"
    | "CONFERENCE_ROLE"
    | "PAPER_ABSTRACT"
    | "CONFERENCE_MENTION";
  label: string;
  conferenceName?: string | null;
  role: string | null;
  year: number | null;
  sourceUrl: string | null;
  evidenceText: string;
  confidence: number;
  memberClaimed: boolean;
  repostOrQuote: boolean;
  verified: false;
};

export type LinkedInCallSignal = {
  id: string;
  kind: "CALL_FOR_PAPERS" | "CALL_FOR_ABSTRACTS" | "REGISTRATION";
  label: string;
  year: number | null;
  sourceUrl: string | null;
  evidenceText: string;
  confidence: number;
  repostOrQuote: boolean;
  verified: false;
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
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    req.linkedinConferenceUserId = userId;
    next();
  } catch (error) {
    next(error);
  }
}

async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const { dbRun } = await import("./db");
      await dbRun(`CREATE TABLE IF NOT EXISTS linkedin_conference_activity (
        user_id TEXT PRIMARY KEY REFERENCES users(id),
        linkedin_url TEXT NOT NULL,
        conference_activity TEXT NOT NULL DEFAULT '[]',
        calls_for_papers TEXT NOT NULL DEFAULT '[]',
        raw_posts TEXT NOT NULL DEFAULT '[]',
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

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
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

function parseArray(value: string | null | undefined): any[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function postPrimaryText(post: Record<string, any>): string {
  return clean(post.content || post.text || post.commentary || post.description || post.title || "");
}

function collectLinkedInEvidenceText(value: unknown, depth = 0, out: string[] = []): string[] {
  if (value == null || depth > 5 || out.length >= 80) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectLinkedInEvidenceText(item, depth + 1, out);
    return out;
  }
  if (typeof value !== "object") return out;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (out.length >= 80) break;
    const normalized = key.toLowerCase();
    if (typeof child === "string") {
      if (/alt|caption|description|title|headline|text|name|ocr|transcript|accessibility/.test(normalized) &&
          !/url|uri|id|urn/.test(normalized)) {
        const candidate = clean(child);
        if (candidate && candidate.length <= 1200) out.push(candidate);
      }
    } else if (child && (Array.isArray(child) || typeof child === "object")) {
      collectLinkedInEvidenceText(child, depth + 1, out);
    }
  }
  return out;
}

function postText(post: Record<string, any>): string {
  const primary = postPrimaryText(post);
  const mediaText: string[] = [];
  for (const root of [post.media, post.images, post.image, post.attachments, post.document, post.article, post.carousel, post.contentEntities]) {
    collectLinkedInEvidenceText(root, 0, mediaText);
  }
  return clean([primary, ...new Set(mediaText)].filter(Boolean).join(" | "));
}

function yearFromPostDateValue(value: unknown, depth = 0): number | null {
  if (value == null || depth > 3) return null;
  if (typeof value === "number") {
    const millis = value > 1_000_000_000_000 ? value : value > 1_000_000_000 ? value * 1000 : NaN;
    if (Number.isFinite(millis)) {
      const year = new Date(millis).getUTCFullYear();
      return Number.isFinite(year) ? year : null;
    }
    return null;
  }
  if (typeof value === "string") {
    const explicit = /\b(20\d{2})\b/.exec(value);
    if (explicit) return Number(explicit[1]);
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).getUTCFullYear();
    return null;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["date", "text", "timestamp", "time", "value", "startDate", "publishedAt"]) {
      const year = yearFromPostDateValue(record[key], depth + 1);
      if (year) return year;
    }
  }
  return null;
}

function postWithinAvailableHistory(_post: Record<string, any>): boolean {
  // The provider is already asked for the member's available public post history.
  // Do not discard older professional conference evidence with an arbitrary year cutoff.
  return true;
}

function postUrl(post: Record<string, any>): string | null {
  const value = post.linkedinUrl || post.postUrl || post.url || post.shareUrl;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function postId(post: Record<string, any>, index: number): string {
  return clean(post.id || post.postId || post.urn || "") || `linkedin-post-${index}`;
}

function targetAuthorMatches(post: Record<string, any>, requestedUrl: string): boolean {
  const requestedSlug = profileSlug(requestedUrl);
  if (!requestedSlug) return true;
  const authorUrl = post?.author?.linkedinUrl || post?.author?.url || post?.authorProfileUrl;
  const authorSlug = profileSlug(authorUrl);
  return !authorSlug || authorSlug === requestedSlug;
}

function isRepostOrQuote(post: Record<string, any>, requestedUrl: string): boolean {
  if (
    post.isRepost === true ||
    post.repost === true ||
    post.isQuotePost === true ||
    post.quotePost === true ||
    post.repostedPost ||
    post.quotedPost ||
    post.originalPost
  ) {
    return true;
  }
  const type = clean(post.type || post.postType).toLowerCase();
  if (/repost|quote|reshare|shared/.test(type)) return true;
  return !targetAuthorMatches(post, requestedUrl);
}

function extractYear(value: string): number | null {
  const years = [...value.matchAll(/\b(20(?:1\d|2\d|3\d))\b/g)].map((m) => Number(m[1]));
  if (!years.length) return null;
  const current = new Date().getUTCFullYear();
  return years.find((year) => year >= current - 15 && year <= current + 8) || years[0] || null;
}

function sentenceWithEvent(value: string): string {
  const sentences = value
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const eventSentence = sentences.find((s) =>
    /\b(conference|congress|symposium|summit|workshop|annual meeting|scientific meeting|forum|convention)\b/i.test(s),
  );
  const chosen = eventSentence || sentences[0] || value;
  return chosen.length > 220 ? `${chosen.slice(0, 217)}…` : chosen;
}

function detectRoles(value: string): string[] {
  const patterns: Array<[RegExp, string]> = [
    [/\btechnical program(?:me)? committee co[- ]?chair\b/i, "Technical Program Committee Co-Chair"],
    [/\btechnical program(?:me)? committee chair\b/i, "Technical Program Committee Chair"],
    [/\b(?:program|programme) committee co[- ]?chair\b/i, "Program Committee Co-Chair"],
    [/\b(?:program|programme) committee chair\b/i, "Program Committee Chair"],
    [/\bscientific committee co[- ]?chair\b/i, "Scientific Committee Co-Chair"],
    [/\bscientific committee chair\b/i, "Scientific Committee Chair"],
    [/\borganizing committee co[- ]?chair\b|\borganising committee co[- ]?chair\b/i, "Organizing Committee Co-Chair"],
    [/\borganizing committee chair\b|\borganising committee chair\b/i, "Organizing Committee Chair"],
    [/\bsession co[- ]?chair\b/i, "Session Co-Chair"],
    [/\bsession chair\b/i, "Session Chair"],
    [/\btrack co[- ]?chair\b/i, "Track Co-Chair"],
    [/\btrack chair\b/i, "Track Chair"],
    [/\bconference co[- ]?chair\b/i, "Conference Co-Chair"],
    [/\bkeynote(?: speaker)?\b/i, "Keynote Speaker"],
    [/\bplenary(?: speaker)?\b/i, "Plenary Speaker"],
    [/\binvited speaker\b/i, "Invited Speaker"],
    [/\bcore presenter\b/i, "Core Presenter"],
    [/\boral presenter\b|\boral presentation\b/i, "Oral Presenter"],
    [/\bposter presenter\b|\bposter presentation\b/i, "Poster Presenter"],
    [/\bworkshop (?:instructor|facilitator|leader|chair)\b/i, "Workshop Instructor"],
    [/\b(?:course|short course) instructor\b/i, "Course Instructor"],
    [/\bmoderator\b/i, "Moderator"],
    [/\bpanel chair\b/i, "Panel Chair"],
    [/\bpanelist\b|\bpanellist\b|\bpanel participant\b/i, "Panelist"],
    [/\b(?:abstract|paper|technical)?\s*reviewer\b/i, "Reviewer"],
    [/\badvisory board(?: member)?\b|\badvisory committee(?: member)?\b/i, "Advisory Committee Member"],
    [/\bsteering committee(?: member)?\b/i, "Steering Committee Member"],
    [/\borganizing committee(?: member)?\b|\borganising committee(?: member)?\b/i, "Organizing Committee Member"],
    [/\bscientific committee(?: member)?\b/i, "Scientific Committee Member"],
    [/\btechnical program(?:me)? committee(?: member)?\b/i, "Technical Program Committee Member"],
    [/\bprogram(?:me)? committee(?: member)?\b/i, "Program Committee Member"],
    [/\btechnical committee(?: member)?\b|\bcommittee member\b/i, "Committee Member"],
    [/\b(?:oral )?presenter\b|\bpresenting\b/i, "Presenter"],
    [/\bspeaker\b|\bspeaking\b/i, "Speaker"],
  ];
  const matches: string[] = [];
  for (const [pattern, label] of patterns) {
    if (pattern.test(value) && !matches.includes(label)) matches.push(label);
  }
  return matches;
}

function explicitSelfClaim(value: string): boolean {
  return /\b(i\s+(?:am|was|will|shall|have|had|presented|spoke|attended|participated|chaired|co[- ]?chaired|moderated|served|serve|joined|reviewed|facilitated|led|instructed)|i['’]m|i['’]ll|my\s+(?:talk|presentation|poster|paper|abstract|session|role)|honou?red to|pleased to|delighted to|excited to|proud to|appointed as|selected as|invited as|serving as|serve as|member of)\b/i.test(
    value,
  );
}

function classifyPosts(posts: any[], requestedUrl: string) {
  const conferenceActivity: LinkedInConferenceSignal[] = [];
  const callsForPapers: LinkedInCallSignal[] = [];
  const nowYear = new Date().getUTCFullYear();

  posts.forEach((raw, index) => {
    const post = raw && typeof raw === "object" ? raw as Record<string, any> : {};
    if (!postWithinAvailableHistory(post)) return;
    const content = postText(post);
    if (!content) return;

    const hasEvent = /\b(conference|congress|symposium|summit|workshop|annual meeting|scientific meeting|technical meeting|professional meeting|forum|convention|colloquium|roundtable|expo|exhibition|webinar|geoscience technology workshop|gtw)\b/i.test(content) || /#[A-Za-z][A-Za-z0-9_-]{2,40}20\d{2}\b/.test(content);
    const hasPaper = /\b(abstract|paper|poster|oral presentation|technical presentation|presentation|manuscript|journal article|peer[- ]reviewed article|publication|published)\b/i.test(content);
    const callForPapers = /\b(call for papers?|cfp|paper submissions?|submit (?:your )?paper)\b/i.test(content);
    const callForAbstracts = /\b(call for abstracts?|abstract submissions?|submit (?:your )?abstract)\b/i.test(content);
    const registration = /\b(registration (?:is )?open|register now|early[- ]bird registration|conference registration)\b/i.test(content);
    const roles = detectRoles(content);
    const role = roles[0] || null;
    const selfClaim = explicitSelfClaim(content);
    const repostOrQuote = isRepostOrQuote(post, requestedUrl);
    const year = extractYear(content);
    const sourceUrl = postUrl(post);
    const label = sentenceWithEvent(content);
    const id = postId(post, index);

    if (callForPapers || callForAbstracts || registration) {
      callsForPapers.push({
        id,
        kind: callForAbstracts ? "CALL_FOR_ABSTRACTS" : callForPapers ? "CALL_FOR_PAPERS" : "REGISTRATION",
        label,
        year,
        sourceUrl,
        evidenceText: label,
        confidence: callForPapers || callForAbstracts ? 90 : 80,
        repostOrQuote,
        verified: false,
      });
    }

    if (!hasEvent && !hasPaper) return;

    let kind: LinkedInConferenceSignal["kind"] = "CONFERENCE_MENTION";
    let confidence = 65;
    let memberClaimed = false;

    if (!repostOrQuote && selfClaim && role) {
      kind = "CONFERENCE_ROLE";
      confidence = 95;
      memberClaimed = true;
    } else if (!repostOrQuote && selfClaim && hasPaper) {
      kind = "PAPER_ABSTRACT";
      confidence = 92;
      memberClaimed = true;
    } else if (!repostOrQuote && /\b(i\s+(?:attended|participated|joined|was at)|great to be at|back from)\b/i.test(content)) {
      kind = "PAST_CONFERENCE";
      confidence = 93;
      memberClaimed = true;
    } else if (year && year >= nowYear && hasEvent) {
      kind = "UPCOMING_CONFERENCE";
      confidence = 78;
    } else if (hasEvent) {
      kind = "CONFERENCE_MENTION";
      confidence = repostOrQuote ? 60 : 70;
    } else if (hasPaper) {
      kind = "PAPER_ABSTRACT";
      confidence = repostOrQuote ? 55 : 70;
    }

    const baseSignal = {
      kind,
      label,
      conferenceName: hasEvent ? label : null,
      year,
      sourceUrl,
      evidenceText: label,
      confidence,
      memberClaimed,
      repostOrQuote,
      verified: false as const,
    };

    if (kind === "CONFERENCE_ROLE" && memberClaimed && roles.length > 0) {
      roles.forEach((detectedRole, roleIndex) => {
        conferenceActivity.push({
          id: `${id}:role:${roleIndex}`,
          ...baseSignal,
          role: detectedRole,
        });
      });
    } else {
      conferenceActivity.push({
        id,
        ...baseSignal,
        role: memberClaimed ? role : null,
      });
    }
  });

  const dedupe = <T extends { id: string }>(items: T[]) => {
    const seen = new Set<string>();
    return items.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  };

  return {
    conferenceActivity: dedupe(conferenceActivity).slice(0, 1000),
    callsForPapers: dedupe(callsForPapers).slice(0, 500),
  };
}

async function readStored(userId: string) {
  await ensureSchema();
  const { dbGet } = await import("./db");
  const row = await dbGet<StoredActivityRow>(
    "SELECT * FROM linkedin_conference_activity WHERE user_id = ?",
    [userId],
  );
  if (!row) return null;
  return {
    linkedinUrl: row.linkedin_url,
    conferenceActivity: parseArray(row.conference_activity),
    callsForPapers: parseArray(row.calls_for_papers),
    sourceActor: row.source_actor,
    consentedAt: row.consented_at,
    fetchedAt: row.fetched_at,
  };
}

router.get("/me", requireMember, safe(async (req, res) => {
  const userId = req.linkedinConferenceUserId!;
  const activity = await readStored(userId);
  res.json({
    activity,
    apifyConfigured: Boolean(process.env.APIFY_TOKEN?.trim()),
  });
}));

router.post("/refresh", requireMember, safe(async (req, res) => {
  if (req.body?.consent !== true) {
    return res.status(400).json({ error: "Explicit consent is required before reading public LinkedIn posts." });
  }

  const { dbGet, dbRun } = await import("./db");
  const userId = req.linkedinConferenceUserId!;
  const user = await dbGet<any>("SELECT id, linkedin_url FROM users WHERE id = ?", [userId]);
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const requestedUrl = normalizeLinkedInProfileUrl(req.body?.linkedinUrl || user.linkedin_url);
  if (!requestedUrl) {
    return res.status(400).json({ error: "Add your public LinkedIn profile URL first (linkedin.com/in/...)." });
  }

  const apifyToken = process.env.APIFY_TOKEN?.trim();
  if (!apifyToken) {
    return res.status(503).json({
      error: "LinkedIn conference-history import is not configured on this server yet.",
      code: "APIFY_NOT_CONFIGURED",
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300_000);
  let response: globalThis.Response;

  try {
    const endpoint = new URL(`https://api.apify.com/v2/actors/${POSTS_ACTOR_ID}/run-sync-get-dataset-items`);
    endpoint.searchParams.set("format", "json");
    endpoint.searchParams.set("clean", "true");
    endpoint.searchParams.set("maxItems", String(MAX_POSTS));
    endpoint.searchParams.set("maxTotalChargeUsd", "3.00");

    response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${apifyToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        targetUrls: [requestedUrl],
        maxPosts: MAX_POSTS,
        postedLimit: "any",
        includeReposts: true,
        includeQuotePosts: true,
        scrapeReactions: false,
        scrapeComments: false,
      }),
    });
  } catch (error: any) {
    clearTimeout(timeout);
    if (error?.name === "AbortError") {
      return res.status(504).json({ error: "LinkedIn conference-history import timed out. Please try again." });
    }
    throw error;
  }
  clearTimeout(timeout);

  if (!response.ok) {
    return res.status(502).json({ error: `LinkedIn posts provider returned HTTP ${response.status}. Please try again.` });
  }

  const result = await response.json().catch(() => null);
  const providerRows = Array.isArray(result)
    ? result.filter((item) =>
        item &&
        typeof item === "object" &&
        (item as any).success !== false &&
        Number((item as any).status || 200) < 400 &&
        !(item as any).error
      )
    : [];
  const existing = await readStored(userId);

  // A provider may return HTTP 200 with an empty/error-only dataset. Treat that as a transient
  // import failure, not as evidence that the member suddenly has no conference history.
  if (!providerRows.length) {
    if (existing) {
      return res.json({
        activity: existing,
        imported: false,
        preservedExisting: true,
        warning: "LinkedIn returned no usable public posts on this refresh. Existing imported conference activity was preserved.",
        counts: {
          posts: 0,
          conferenceActivity: existing.conferenceActivity.length,
          callsForPapers: existing.callsForPapers.length,
          explicitMemberClaims: existing.conferenceActivity.filter((item: any) => item.memberClaimed).length,
          conferenceRoles: existing.conferenceActivity.filter((item: any) => item.kind === "CONFERENCE_ROLE" && item.memberClaimed).length,
          committeeLeadershipRoles: existing.conferenceActivity.filter((item: any) =>
            item.kind === "CONFERENCE_ROLE" && item.memberClaimed && /committee|chair|moderator|panel|reviewer|workshop|instructor/i.test(item.role || "")
          ).length,
          pastConferenceClaims: existing.conferenceActivity.filter((item: any) => item.kind === "PAST_CONFERENCE" && item.memberClaimed).length,
        },
      });
    }
    return res.status(502).json({ error: "LinkedIn returned no usable public posts for this profile. Your ConferenceGate data was not changed." });
  }

  const posts = providerRows;
  const classified = classifyPosts(posts, requestedUrl);
  const stableSignalKey = (item: any) => [item.sourceUrl || "", item.kind || "", item.role || "", item.year || "", item.conferenceName || item.label || ""].join("|").toLowerCase();
  const mergeEvidence = <T extends Record<string, any>>(previous: T[], next: T[]): T[] => {
    const map = new Map<string, T>();
    previous.forEach((item) => map.set(stableSignalKey(item), item));
    next.forEach((item) => map.set(stableSignalKey(item), item));
    return [...map.values()];
  };
  const conferenceActivity = mergeEvidence(existing?.conferenceActivity || [], classified.conferenceActivity).slice(0, 1000);
  const callsForPapers = mergeEvidence(existing?.callsForPapers || [], classified.callsForPapers).slice(0, 500);
  const now = new Date().toISOString();

  await ensureSchema();
  await dbRun(
    `INSERT INTO linkedin_conference_activity (
      user_id, linkedin_url, conference_activity, calls_for_papers, raw_posts,
      source_actor, consented_at, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      linkedin_url = excluded.linkedin_url,
      conference_activity = excluded.conference_activity,
      calls_for_papers = excluded.calls_for_papers,
      raw_posts = excluded.raw_posts,
      source_actor = excluded.source_actor,
      consented_at = excluded.consented_at,
      fetched_at = excluded.fetched_at`,
    [
      userId,
      requestedUrl,
      JSON.stringify(conferenceActivity),
      JSON.stringify(callsForPapers),
      JSON.stringify(posts),
      SOURCE_ACTOR,
      now,
      now,
    ],
  );

  const stored = await readStored(userId);
  res.json({
    activity: stored,
    imported: true,
    counts: {
      posts: posts.length,
      conferenceActivity: conferenceActivity.length,
      callsForPapers: callsForPapers.length,
      explicitMemberClaims: conferenceActivity.filter((item) => item.memberClaimed).length,
      conferenceRoles: conferenceActivity.filter((item) => item.kind === "CONFERENCE_ROLE" && item.memberClaimed).length,
      committeeLeadershipRoles: conferenceActivity.filter((item) =>
        item.kind === "CONFERENCE_ROLE" &&
        item.memberClaimed &&
        /committee|chair|moderator|panel|reviewer|workshop|instructor/i.test(item.role || "")
      ).length,
      pastConferenceClaims: conferenceActivity.filter((item) => item.kind === "PAST_CONFERENCE" && item.memberClaimed).length,
    },
  });
}));

router.delete("/me", requireMember, safe(async (req, res) => {
  await ensureSchema();
  const { dbRun } = await import("./db");
  await dbRun("DELETE FROM linkedin_conference_activity WHERE user_id = ?", [req.linkedinConferenceUserId!]);
  res.json({ ok: true });
}));

const application: any = express.application as any;
if (!application.__conferenceGateLinkedInConferencePatch) {
  application.__conferenceGateLinkedInConferencePatch = true;
  const originalGet = application.get;
  const originalUse = application.use;

  application.get = function patchedGet(path: unknown, ...handlers: any[]) {
    if (path === "/api/health" && !this.locals?.__linkedinConferenceRouterMounted) {
      this.locals = this.locals || {};
      this.locals.__linkedinConferenceRouterMounted = true;
      originalUse.call(this, "/api/linkedin-conference", router);
    }
    return originalGet.call(this, path, ...handlers);
  };
}

export { router as linkedinConferenceActivityRouter };
