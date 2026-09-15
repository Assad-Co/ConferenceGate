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
const MAX_POSTS = 100;

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

function postText(post: Record<string, any>): string {
  return clean(post.content || post.text || post.commentary || post.description || post.title || "");
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

function detectRole(value: string): string | null {
  const roles: Array<[RegExp, string]> = [
    [/\bkeynote(?: speaker)?\b/i, "Keynote Speaker"],
    [/\bplenary(?: speaker)?\b/i, "Plenary Speaker"],
    [/\binvited speaker\b/i, "Invited Speaker"],
    [/\b(?:session|track|program|programme|scientific) chair\b/i, "Chair"],
    [/\bmoderator\b/i, "Moderator"],
    [/\bpanelist\b|\bpanellist\b/i, "Panelist"],
    [/\bcommittee member\b|\btechnical committee\b|\bscientific committee\b|\bprogram committee\b/i, "Committee Member"],
    [/\b(?:oral )?presenter\b|\bpresenting\b|\bpresentation\b/i, "Presenter"],
    [/\bspeaker\b|\bspeaking\b/i, "Speaker"],
    [/\bposter\b/i, "Poster Presenter"],
  ];
  for (const [re, label] of roles) if (re.test(value)) return label;
  return null;
}

function explicitSelfClaim(value: string): boolean {
  return /\b(i\s+(?:am|was|will|shall|have|had|presented|spoke|attended|participated|chaired|moderated|served|joined)|i['’]m|i['’]ll|my\s+(?:talk|presentation|poster|paper|abstract|session)|honou?red to|pleased to|delighted to|excited to)\b/i.test(
    value,
  );
}

function classifyPosts(posts: any[], requestedUrl: string) {
  const conferenceActivity: LinkedInConferenceSignal[] = [];
  const callsForPapers: LinkedInCallSignal[] = [];
  const nowYear = new Date().getUTCFullYear();

  posts.forEach((raw, index) => {
    const post = raw && typeof raw === "object" ? raw as Record<string, any> : {};
    const content = postText(post);
    if (!content) return;

    const hasEvent = /\b(conference|congress|symposium|summit|workshop|annual meeting|scientific meeting|forum|convention)\b/i.test(content);
    const hasPaper = /\b(abstract|paper|poster|oral presentation|presentation)\b/i.test(content);
    const callForPapers = /\b(call for papers?|cfp|paper submissions?|submit (?:your )?paper)\b/i.test(content);
    const callForAbstracts = /\b(call for abstracts?|abstract submissions?|submit (?:your )?abstract)\b/i.test(content);
    const registration = /\b(registration (?:is )?open|register now|early[- ]bird registration|conference registration)\b/i.test(content);
    const role = detectRole(content);
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

    conferenceActivity.push({
      id,
      kind,
      label,
      role: memberClaimed ? role : null,
      year,
      sourceUrl,
      evidenceText: label,
      confidence,
      memberClaimed,
      repostOrQuote,
      verified: false,
    });
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
    conferenceActivity: dedupe(conferenceActivity).slice(0, 100),
    callsForPapers: dedupe(callsForPapers).slice(0, 100),
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
  const activity = await readStored(req.linkedinConferenceUserId!);
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
  const timeout = setTimeout(() => controller.abort(), 180_000);
  let response: globalThis.Response;

  try {
    const endpoint = new URL(`https://api.apify.com/v2/actors/${POSTS_ACTOR_ID}/run-sync-get-dataset-items`);
    endpoint.searchParams.set("format", "json");
    endpoint.searchParams.set("clean", "true");
    endpoint.searchParams.set("maxItems", String(MAX_POSTS));
    endpoint.searchParams.set("maxTotalChargeUsd", "0.30");

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
  const posts = Array.isArray(result) ? result.filter((item) => item && typeof item === "object") : [];
  const { conferenceActivity, callsForPapers } = classifyPosts(posts, requestedUrl);
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
