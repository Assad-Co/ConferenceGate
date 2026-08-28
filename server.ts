import "./server/env";
import express from "express";
import path from "path";
import cookieParser from "cookie-parser";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { WebSocketServer } from "ws";
import { authRouter, verifySessionToken, COOKIE_NAME, initAuthSecret } from "./server/auth";
import { braveSearchRouter, searchWebForConferenceFacts } from "./server/braveSearch";
import { activityRouter } from "./server/activity";
import { messagesRouter, registerSocket } from "./server/messages";
import { sponsorsRouter } from "./server/sponsors";
import { postsRouter } from "./server/posts";
import { initDb, dbGet, dbAll, UserRow, SubmissionRow, CreatedConferenceRow, SponsorshipApplicationRow } from "./server/db";
import { isSafeExternalUrl } from "./server/urlSafety";
import { geocodePlace, haversineMeters, formatEstimatedDistance } from "./server/geocode";
import { fetchRenderedHtml, isBrowserRenderingUnavailable, closeBrowser } from "./server/browserFetch";
import { extractPdfText } from "./server/pdfText";
import { firecrawlScrape, firecrawlMapSite, isFirecrawlConfigured } from "./server/firecrawl";
import { checkWordCompliance } from "./server/wordLimit";

async function startServer() {
  // The database schema and the JWT signing secret both require an async round-trip to
  // resolve (a remote Turso database, or falling back to a local SQLite file) — both must
  // be ready before any request can be handled.
  await initDb();
  await initAuthSecret();

  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "3mb" }));
  app.use(cookieParser());

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", app: "Conference Gate" });
  });

  // Auth routes
  app.use("/api/auth", authRouter);

  // Live conference search (Brave Search API)
  app.use("/api/search", braveSearchRouter);

  // Real tracked activity: submissions, reviews, reviewer volunteering, conference registrations
  app.use("/api/activity", activityRouter);

  // Persistent, real-time direct messaging
  app.use("/api/messages", messagesRouter);

  // Real sponsorship packages, applications, and reviews
  app.use("/api/sponsors", sponsorsRouter);

  // Real community feed: posts, reactions, comments, reposts, saves
  app.use("/api/posts", postsRouter);

  // AI Routes using Gemini SDK
  const getAIClient = () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return null;
    }
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
        // Without a cap, a slow model response can hang a request indefinitely — worst felt on
        // conference extraction, which can make up to three of these calls in one request.
        timeout: 15000,
      },
    });
  };

  // Looks up the authenticated user's own real activity so the assistant's answers about
  // "your abstracts", "your conferences", or "your sponsorships" are grounded in fact rather
  // than hallucinated. Returns null when the request has no valid session — the assistant
  // then falls back to answering generically, without ever inventing account-specific data.
  async function buildRealUserContext(req: express.Request): Promise<Record<string, unknown> | null> {
    const userId = verifySessionToken(req.cookies?.[COOKIE_NAME]);
    if (!userId) return null;

    const user = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [userId]);
    if (!user) return null;

    if (user.role === "organizer") {
      const created = await dbAll<CreatedConferenceRow>(
        "SELECT * FROM created_conferences WHERE organizer_id = ? ORDER BY created_at DESC",
        [userId]
      );
      const conferences = created.map((c) => JSON.parse(c.data)?.title).filter(Boolean);
      const pendingApplicants = (await dbGet<{ count: number }>(
        `SELECT COUNT(*) as count FROM sponsorship_applications sa
         JOIN sponsorship_packages sp ON sp.id = sa.package_id
         WHERE sp.organizer_id = ? AND sa.status = 'Pending'`,
        [userId]
      ))!.count;
      return { role: "organizer", name: user.name, conferencesCreated: conferences, pendingSponsorApplicants: pendingApplicants };
    }

    if (user.role === "sponsor") {
      const applications = await dbAll<SponsorshipApplicationRow & { tier: string; conference_title: string }>(
        `SELECT sa.*, sp.tier as tier, sp.conference_title as conference_title
         FROM sponsorship_applications sa
         JOIN sponsorship_packages sp ON sp.id = sa.package_id
         WHERE sa.sponsor_id = ? ORDER BY sa.created_at DESC`,
        [userId]
      );
      return {
        role: "sponsor",
        name: user.name,
        companyName: user.organization,
        sponsorshipApplications: applications.map((a) => ({ conference: a.conference_title, tier: a.tier, status: a.status })),
      };
    }

    const submissions = await dbAll<SubmissionRow>(
      "SELECT * FROM submissions WHERE submitter_id = ? ORDER BY submission_date DESC",
      [userId]
    );
    return {
      role: "professional",
      name: user.name,
      abstractSubmissions: submissions.map((s) => ({ title: s.title, conference: s.conference_title, status: s.status })),
    };
  }

  // AI Assistant Route
  app.post("/api/ai/assistant", async (req, res) => {
    try {
      const { prompt, userRole, context } = req.body;
      const ai = getAIClient();

      if (!ai) {
        // GEMINI_API_KEY is not configured — flagged so the client shows this as a
        // fallback rather than presenting it as a live AI response.
        return res.json({
          reply: `[Conference Gate AI Assistant - Standby Mode]\n\nI can help you discover conferences, match abstract reviewers, recommend technical committee candidates, and optimize sponsorship ROI. Key recommendation for ${userRole || 'professional'}: Explore our featured Call for Papers in Energy and AI Innovation!`,
          isFallback: true,
        });
      }

      const realUserContext = await buildRealUserContext(req);

      const systemInstruction = `You are the Conference Gate AI Assistant — an intelligent, authoritative advisor embedded in the Conference Gate SaaS platform.
Conference Gate is the global platform for conference discovery, event management, abstract review, technical committees, sponsorship, and verified conference identity.
Your goal is to answer queries for Professionals, Reviewers, Organizers, and Sponsors with concise, highly professional insights.
Current user role context: ${userRole || 'Professional'}.
Additional Context: ${JSON.stringify(context || {})}
${realUserContext
  ? `The user is authenticated. Here is their real, verified activity on the platform — use it when they ask about "my abstracts", "my conferences", "my sponsorships", or similar, and never invent activity beyond what is listed here:\n${JSON.stringify(realUserContext)}`
  : "The user is not authenticated, or has no activity on file yet — do not claim to know their personal abstracts, conferences, or sponsorships; answer generally instead."}`;

      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
        config: {
          systemInstruction,
          temperature: 0.7,
        },
      });

      res.json({ reply: response.text || "No response generated." });
    } catch (error: any) {
      console.error("AI Assistant error:", error);
      res.status(500).json({
        error: "Failed to query AI Assistant",
        details: error.message,
      });
    }
  });

  // AI Reviewer Matching
  app.post("/api/ai/reviewer-match", async (req, res) => {
    try {
      const { abstractTitle, abstractKeywords, abstractTopic, reviewers } = req.body;
      const ai = getAIClient();

      if (!ai) {
        // GEMINI_API_KEY is not configured — flagged so the client falls back to its
        // own honest, review-count-derived ranking instead of presenting this as live AI.
        return res.json({ matches: [], isFallback: true });
      }

      const prompt = `Analyze this abstract submission and rank the candidate reviewers based on subject matter alignment, previous review activity, and topic relevance.
Abstract Title: "${abstractTitle}"
Topic: "${abstractTopic}"
Keywords: ${JSON.stringify(abstractKeywords)}

Reviewers Pool:
${JSON.stringify(reviewers)}

Return a JSON array of objects with fields: reviewerId (string), matchPercentage (number between 60 and 99), reason (short professional 1-sentence justification).`;

      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
        },
      });

      let jsonMatches = [];
      try {
        jsonMatches = JSON.parse(response.text || "[]");
      } catch (e) {
        console.error("Failed to parse JSON match response", e);
      }

      res.json({ matches: jsonMatches });
    } catch (error: any) {
      console.error("AI Reviewer Match error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // AI Abstract Quality Check — grounded against the conference's real stated requirements
  // (when known) rather than a generic pass. Word-count compliance is computed in code, not
  // guessed by the model, since LLMs are unreliable at exact arithmetic over long text; that real
  // fact is handed to the model so its score and feedback reflect actual compliance.
  app.post("/api/ai/abstract-check", async (req, res) => {
    try {
      const { title, abstractText, topic, requirements } = req.body;
      const ai = getAIClient();

      const wordCompliance = checkWordCompliance(
        typeof abstractText === "string" ? abstractText : "",
        typeof requirements === "string" ? requirements : null
      );

      if (!ai) {
        // GEMINI_API_KEY is not configured — flagged so the client shows generic
        // guidance rather than presenting a fabricated per-abstract score as real.
        return res.json({ isFallback: true, wordCount: wordCompliance.wordCount, wordLimitNote: wordCompliance.note });
      }

      const requirementsBlock =
        typeof requirements === "string" && requirements.trim()
          ? `\n\nThis conference's real, stated submission requirements are:\n"""\n${requirements}\n"""\n\nA code-computed fact you must treat as ground truth (do not recount words yourself): the abstract is ${wordCompliance.wordCount} words long.${
              wordCompliance.note ? ` ${wordCompliance.note}` : ""
            } Score and feedback must reflect this fact — if it violates a stated limit, say so explicitly in improvements and reduce the score accordingly; never claim compliance that contradicts this word count.`
          : "";

      const rewriteInstruction = wordCompliance.note && /exceeds|below/i.test(wordCompliance.note)
        ? `\n\nBecause the abstract violates the stated word requirement, also provide "suggestedRewrite": a revised version of the abstract text that fits the requirement while preserving the author's actual research content and meaning — never invent findings or methodology that weren't in the original. If you cannot fix it without fabricating content, set suggestedRewrite to null.`
        : `\n\n"suggestedRewrite" should be null — the word count doesn't need fixing.`;

      const prompt = `Perform a scientific/technical quality pre-screening check for this abstract submission:
Title: ${title}
Topic: ${topic}
Text: ${abstractText}${requirementsBlock}${rewriteInstruction}

Provide constructive feedback in JSON format with fields:
- score (number 0-100)
- clarity (string assessment)
- suggestedTracks (array of string track names)
- improvements (array of 2-3 short actionable suggestions)
- suggestedRewrite (string or null, as instructed above)`;

      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
        },
      });

      let result: any = {};
      try {
        result = JSON.parse(response.text || "{}");
      } catch (e) {
        console.error("Failed to parse abstract check JSON", e);
      }

      res.json({ ...result, wordCount: wordCompliance.wordCount, wordLimitNote: wordCompliance.note });
    } catch (error: any) {
      console.error("AI Abstract Check error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // AI-powered extraction of conference details from a live web search result's own page —
  // for results not in our verified catalog. Only ever reports what's explicitly present on
  // the page (never invented), cached per-URL since fetch + LLM extraction is expensive.
  interface ExtractionCacheEntry {
    data: Record<string, unknown>;
    expiresAt: number;
  }
  const extractionCache = new Map<string, ExtractionCacheEntry>();
  const EXTRACTION_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
  const FAILED_FETCH_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — failures are usually transient

  // Strips a page down to readable text for the LLM, but first swaps every <img> tag for an
  // inline [IMAGE: absolute-url] marker (resolving relative src/data-src against the page's own
  // URL) so the model can associate a real photo URL with the name it appears next to — instead
  // of us ever having to guess or fabricate one. Every <a href> is similarly preserved as
  // "link text [LINK: absolute-url]" — without this, raw hrefs get discarded along with every
  // other tag, so the model would have no way to ever report a real submission/template URL, and
  // no way to locate a separate Call-for-Papers or Committee page linked from this one.
  function prepareHtmlForExtraction(html: string, baseUrl: string): string {
    let cleaned = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

    cleaned = cleaned.replace(/<img\b[^>]*\b(?:src|data-src)=["']([^"']+)["'][^>]*>/gi, (_match, src) => {
      try {
        const abs = new URL(src, baseUrl).href;
        return ` [IMAGE: ${abs}] `;
      } catch {
        return " ";
      }
    });

    cleaned = cleaned.replace(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, href, inner) => {
      const text = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      try {
        const abs = new URL(href, baseUrl).href;
        return ` ${text} [LINK: ${abs}] `;
      } catch {
        return ` ${text} `;
      }
    });

    return cleaned
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&#x27;|&apos;/gi, "'")
      .replace(/&quot;/gi, '"')
      .replace(/\s+/g, " ")
      .trim();
  }

  // Scans the page's raw HTML (before tag-stripping) for every <a> whose visible text matches a
  // topic pattern, returning up to `limit` distinct resolved absolute URLs — a deterministic,
  // cheap way to find same-site "Call for Papers"/"Submission Guidelines"/"Committee" pages
  // linked from this one, since a real conference site commonly splits these across more than
  // one page (sometimes even two distinct CFP-ish pages, e.g. "Call for Papers" AND a separate
  // "Submission Guidelines") that the model would otherwise have no way to discover from a
  // single-page fetch.
  function findLinksByText(html: string, baseUrl: string, pattern: RegExp, limit: number): string[] {
    const anchorRe = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const found: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = anchorRe.exec(html)) && found.length < limit) {
      const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (!pattern.test(text)) continue;
      try {
        const abs = new URL(m[1], baseUrl).href;
        if (abs !== baseUrl && !found.includes(abs)) found.push(abs);
      } catch {
        continue;
      }
    }
    return found;
  }
  // Broad on purpose: a false-positive match just costs one wasted (parallel, cheap) fetch, while
  // a false negative means the author's real submission requirements never get found at all. Kept
  // as a fast, free backstop alongside the model's own link understanding below — a fixed keyword
  // list can never cover every real site's wording, but it costs nothing to also check.
  const CFP_LINK_TEXT_RE =
    /\b(call for (papers|abstracts)|cfp|submission|submit|abstract|author guidelines|author information|guidelines|instructions for authors|presenters)\b/i;
  const COMMITTEE_LINK_TEXT_RE =
    /\b(committee|organi[sz]ing|scientific (board|committee)|program committee|chairs|advisory board|editorial board|review(ers)?\s*panel)\b/i;

  // Real conference sites often route through a neutral hub page — "About", "Info", "Event
  // Details" — that doesn't itself name any one category but links onward to the pages that do
  // (About -> Committee, About -> Program). Neither the model's per-page relevantLinks nor the
  // CFP/Committee regexes can flag a hub page for a category it doesn't actually mention, so a
  // round that finds zero category-specific candidates falls back to a few of that page's other
  // same-site nav links as blind exploratory hops — skipping the obvious non-content ones — so the
  // crawl can still push one layer deeper instead of stopping cold in front of a hub page.
  // "home" is deliberately NOT skipped. A search result often points at a deep page — a
  // registration or submission page — and the conference's dates, venue and description live on
  // the page that page calls "Home". Skipping it made the single most valuable page on the site
  // unreachable from exactly the starting points where it mattered most.
  const SKIP_NAV_TEXT_RE = /\b(privacy|terms|cookie|login|log in|sign in|sign up|contact|sitemap|accessibility)\b/i;

  // The start URL's own parent paths, deepest first: from ".../annual-meeting/register" that's
  // ".../annual-meeting/" and then the site root.
  //
  // A live search result frequently lands on a deep page, and the overview, dates and venue are
  // almost never repeated there — they sit on the section or site home. Those pages are reachable
  // by URL alone, without needing a link or a sitemap to point at them, so the crawl always tries
  // them. Deepest first, so a conference's own section home is read before the parent
  // organisation's, and describes the conference rather than the body that runs it.
  function ancestorUrls(startUrl: string): string[] {
    let parsed: URL;
    try {
      parsed = new URL(startUrl);
    } catch {
      return [];
    }
    const segments = parsed.pathname.split("/").filter(Boolean);
    const out: string[] = [];
    for (let depth = segments.length - 1; depth >= 0; depth--) {
      const path = depth === 0 ? "/" : `/${segments.slice(0, depth).join("/")}/`;
      const candidate = `${parsed.origin}${path}`;
      if (candidate !== startUrl && !out.includes(candidate)) out.push(candidate);
    }
    const root = `${parsed.origin}/`;
    if (root !== startUrl && !out.includes(root)) out.push(root);
    return out;
  }
  function findExploratoryLinks(html: string, baseUrl: string, limit: number): string[] {
    const anchorRe = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const found: string[] = [];
    let m: RegExpExecArray | null;
    let baseHost: string;
    try {
      baseHost = new URL(baseUrl).hostname;
    } catch {
      return found;
    }
    while ((m = anchorRe.exec(html)) && found.length < limit) {
      const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (!text || SKIP_NAV_TEXT_RE.test(text)) continue;
      try {
        const abs = new URL(m[1], baseUrl).href;
        if (abs !== baseUrl && new URL(abs).hostname === baseHost && !found.includes(abs)) found.push(abs);
      } catch {
        continue;
      }
    }
    return found;
  }

  // Extensions with nothing extractable in them. PDFs are deliberately absent: a conference's
  // call for papers, programme and fee table are very often published only as documents, and
  // those are now read rather than skipped.
  const NON_PAGE_EXT_RE = /\.(jpe?g|png|gif|svg|webp|ico|css|js|zip|pptx?|xlsx?|mp4|mp3|xml)(\?|#|$)/i;

  // Asks the site for its own index of itself before falling back to guessing from nav links. A
  // sitemap is the only way to reach pages a conference never linked from its front page — a
  // separate committee page, an archived programme, a hotels list behind a JS-only dropdown —
  // which is exactly the content a link-following crawl alone can never discover.
  async function fetchSitemapUrls(startUrl: string, limit: number): Promise<string[]> {
    let origin: string;
    let host: string;
    try {
      const u = new URL(startUrl);
      origin = u.origin;
      host = u.hostname;
    } catch {
      return [];
    }
    const queue = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/sitemap-index.xml`];
    const requested = new Set<string>();
    const out: string[] = [];
    // Bounded independently of the page budget: a sitemap index can chain into dozens of child
    // sitemaps, and this is only meant to seed the crawl, not to become a crawl of its own.
    const MAX_SITEMAP_FETCHES = 6;

    while (queue.length > 0 && out.length < limit && requested.size < MAX_SITEMAP_FETCHES) {
      const sitemapUrl = queue.shift()!;
      if (requested.has(sitemapUrl)) continue;
      requested.add(sitemapUrl);
      try {
        const r = await fetch(sitemapUrl, {
          headers: EXTRACTION_FETCH_HEADERS,
          redirect: "follow",
          signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
        });
        if (!r.ok) continue;
        const xml = await r.text();
        if (!/<(urlset|sitemapindex)/i.test(xml)) continue; // a 200 HTML "not found" page, not a sitemap
        const isIndex = /<sitemapindex/i.test(xml);
        const locRe = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
        let m: RegExpExecArray | null;
        while ((m = locRe.exec(xml))) {
          let abs: string;
          try {
            abs = new URL(m[1].replace(/&amp;/gi, "&")).href;
            if (new URL(abs).hostname !== host) continue; // never wander off this conference's site
          } catch {
            continue;
          }
          if (isIndex) {
            if (!requested.has(abs) && queue.length < MAX_SITEMAP_FETCHES) queue.push(abs);
          } else if (!NON_PAGE_EXT_RE.test(abs) && !out.includes(abs) && out.length < limit) {
            out.push(abs);
          }
        }
      } catch {
        continue; // no sitemap, or it timed out — the link-following crawl still runs
      }
    }
    return out;
  }

  // Every real <a href> target on the page, resolved to absolute URLs — used to verify a URL the
  // model claims to have found in a [LINK: ...] marker actually exists on the page, rather than
  // trusting model output that could otherwise hallucinate a plausible-looking but fake URL.
  function extractAllLinks(html: string, baseUrl: string): Set<string> {
    const anchorRe = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi;
    const links = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = anchorRe.exec(html))) {
      try {
        links.add(new URL(m[1], baseUrl).href);
      } catch {
        continue;
      }
    }
    return links;
  }

  const RELEVANT_LINK_CATEGORIES = ["overview", "cfp", "committee", "speakers", "sponsors", "agenda", "venue"] as const;
  type RelevantLinkCategory = (typeof RELEVANT_LINK_CATEGORIES)[number];

  // A deterministic link-text backstop for every category, not just CFP and committee. The model's
  // own relevantLinks only ever names ONE link per category, but a real conference site routinely
  // splits one topic across several nav entries — "Sessions" alongside "Agenda" and "Workshops",
  // "Sponsors" alongside "Exhibitors", "Hotel" alongside "Travel". Matching each category's own
  // wording finds the siblings the single model-picked link leaves behind.
  const CATEGORY_LINK_TEXT_RE: Record<RelevantLinkCategory, RegExp> = {
    overview: /\b(about|overview|event (information|details|info)|the event|why attend|general info(rmation)?)\b/i,
    cfp: CFP_LINK_TEXT_RE,
    committee: COMMITTEE_LINK_TEXT_RE,
    speakers: /\b(speakers?|keynotes?|faculty|presenters?|panelists?|lineup|who's speaking)\b/i,
    sponsors: /\b(sponsors?|sponsorship|exhibitors?|exhibit|partners?|supporters?|our partners)\b/i,
    agenda: /\b(agenda|programs?|programme|schedule|sessions?|tracks?|workshops?|at a glance|itinerary)\b/i,
    venue: /\b(venue|hotels?|accommodations?|lodging|travel|getting (there|here)|location|directions|visit)\b/i,
  };

  // Reads the model's own relevantLinks guesses (real language understanding of what a link is
  // about, not keyword matching) and keeps only ones that are real URLs found on this exact page,
  // different from the page itself, and on the same site — never trusting model output blindly,
  // and never following it off onto an unrelated external domain (a sponsor's own homepage, a
  // speaker's personal page) that isn't actually this conference's own content.
  function sanitizeRelevantLinks(
    parsed: any,
    realLinks: Set<string>,
    baseUrl: string
  ): Partial<Record<RelevantLinkCategory, string>> {
    const out: Partial<Record<RelevantLinkCategory, string>> = {};
    const raw = parsed?.relevantLinks;
    if (!raw || typeof raw !== "object") return out;
    let baseHost: string;
    try {
      baseHost = new URL(baseUrl).hostname;
    } catch {
      return out;
    }
    for (const category of RELEVANT_LINK_CATEGORIES) {
      const resolved = resolveAbsoluteUrl(raw[category], baseUrl);
      if (!resolved || resolved === baseUrl || !realLinks.has(resolved)) continue;
      try {
        if (new URL(resolved).hostname !== baseHost) continue;
      } catch {
        continue;
      }
      out[category] = resolved;
    }
    return out;
  }

  // The model sometimes copies a relative href straight out of the page's HTML (e.g. "/submit")
  // instead of resolving it — a bare relative path is meaningless once served from Conference
  // Gate's own origin, so every extracted URL is resolved against the source page's real URL
  // before being sent to the client, exactly like the inline image markers above.
  function resolveAbsoluteUrl(url: unknown, baseUrl: string): string | null {
    if (typeof url !== "string" || !url.trim()) return null;
    try {
      return new URL(url.trim(), baseUrl).href;
    } catch {
      return null;
    }
  }

  // The model is instructed to only report a submission email when the page explicitly ties one
  // to sending in a paper, but its output is still untrusted text — reject anything that isn't
  // shaped like a real email address rather than passing arbitrary model output through as if it
  // were a verified fact.
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function sanitizeEmail(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return EMAIL_RE.test(trimmed) ? trimmed : null;
  }

  function buildExtractionPrompt(pageText: string, title: string, pageUrl: string): string {
    return `You are extracting factual details about a conference/event from the raw text of its own webpage. Only include information EXPLICITLY stated in the text below. Never guess, infer, or invent a value — if something isn't mentioned, use null (or an empty array for list fields).

The text below has every <img> tag replaced with an inline marker like "[IMAGE: https://example.com/photo.jpg]" positioned where that image appeared in the page. When a marker appears right next to a person's name or a sponsor's name, that is very likely their real photo or logo — copy that exact URL into the matching imageUrl/logoUrl field. If no marker appears near a name, use null. Never invent or guess an image URL, and never reuse an unrelated image for a different person.

Every <a> link has similarly been replaced with "link text [LINK: https://example.com/page]" positioned right after that link's visible text. Use these markers to find real URLs: if you see link text like "Submit Now", "Submission Portal", or "Author Guidelines", copy the [LINK: ...] URL that follows it into submissionUrl or submissionTemplateUrl as appropriate. Never invent a URL that isn't backed by an actual [LINK: ...] marker in the text.

For overviewSummary, write a factual 2-3 sentence summary using ONLY what THIS page itself says about the conference — what it's about, who it's for, its theme or focus. Never draw on general/background knowledge about a similarly-named or similarly-themed event, and never write a generic description a page didn't actually give; if the page doesn't really describe itself beyond a title and dates, use null rather than inventing filler.

For cfpStatus, report the Call for Papers state using only what the page itself says — normalize to "Open", "Closed", or "Extended" when the page's own wording clearly means one of those (e.g. "the deadline has passed" means Closed, "deadline extended to..." means Extended), otherwise copy the page's own short phrase. Never infer "Open" just because a submission link or portal exists on the page — a submission link commonly stays live long after its deadline has passed. Use null if the page never actually states whether it's accepting submissions.

For cfpDeadline, use only the actual abstract/paper SUBMISSION deadline explicitly stated. Do not confuse this with the conference's own event dates, the registration deadline, or an early-bird pricing deadline — those are different things and must not be substituted in. Use null if no submission-specific deadline is stated.

For submissionRequirements, look specifically for what authors are told about how to prepare their submission — format (PDF, Word), page or word limits, citation style, blind-review requirements, or template to use — and summarize only what's explicitly stated in a sentence or two. For submissionTemplateUrl, only use a URL that literally appears via a [LINK: ...] marker in the page text; never guess a URL from context.

Alongside that prose summary, break the SAME stated requirements out into the individual cfp* fields so they can be shown as a checklist. Fill each one only from an explicit statement on the page, and leave it null otherwise — never carry a value over from a different field, and never normalize a page's own wording into a requirement it didn't state. cfpSubmissionFormat is the required file format or preparation format ("PDF only", "LaTeX or Word using the IEEE template"). cfpLengthLimit is the stated size limit for a submission ("6 pages excluding references", "300-word abstract", "maximum 4,000 words"). cfpReviewProcess is how submissions are reviewed when the page says ("double-blind peer review", "single-blind, three reviewers per paper"). cfpNotificationDate is the date authors are told they'll hear back — an acceptance/notification date, which is NOT the submission deadline and NOT the conference date. cfpTopics is the list of topics, tracks, or themes the call explicitly invites submissions on, one array entry per topic exactly as written; use an empty array if the page doesn't enumerate any.

For submissionEmail, only fill this in if the page explicitly names an email address as where to SEND a submission/abstract/paper to (e.g. "email your abstract to chair@conference.org"). Never use a generic contact/info email for this — leave it null unless the text specifically ties that address to submitting a paper.

For speakers, include anyone credited with giving a talk, keynote, presentation, or featured appearance at the event — this covers people labeled "Speakers", "Keynotes", "Presenters", "Panelists", "Featured Guests", "Invited Guests", or any similar wording the page uses, not only people under a heading that literally says "Speakers". Use the page's own wording for role (e.g. "Keynote Speaker", "Panelist", "Presenter") when it says one, or null if it doesn't.

For agendaSessions, include every scheduled session, talk, panel, workshop, or keynote slot stated on the page no matter what the page itself calls this section — "Program", "Schedule", "Agenda", "Timetable", "Itinerary", "Day 1 / Day 2" listings, and a plain day-by-day list of time blocks are all the same thing and all count. Use the actual session/talk name as the title when one is given; when the page only labels a slot generically (e.g. "Panel Session 1", "Morning Keynote", "Breakfast & Business Meeting") use that generic label as the title rather than leaving the whole entry out — never invent a more specific title than what's actually written. Fill date/time/track/speakerName only when the page states them for that slot; otherwise leave them null.

For committee, include anyone credited with organizing, chairing, or running the conference — this covers people labeled "Organizers", "Chairs", "Program Committee", "Organizing Committee", "Scientific Committee", or "Advisory Board", not only people appearing under a heading that literally says "Committee". A plain list like "Organizers: Jane Doe, John Smith" counts — include each name with role set to "Organizer" (or whatever the page actually calls them) and org/title only if separately stated.

For sponsors, include every organization named as sponsoring, funding, or supporting the conference — this includes a plain sentence like "Sponsored by the XYZ Department" or "with support from ABC Foundation", not only entries with a logo image. Use null for tier and logoUrl when the page doesn't state them; never invent a tier ("Gold", "Platinum", etc.) that isn't explicitly written.

For accommodationText and travelText, summarize whatever the page actually says about lodging (hotel names, room blocks, rates) or getting to the venue (transit directions, airport info, parking) in a sentence or two each — these are commonly written as plain paragraphs rather than under a clearly-labeled section, so don't require an explicit "Accommodation" or "Travel" heading to use them.

For venueName and venueAddress, give the actual place the conference is held — the venue's own name ("Marriott Marquis San Diego Marina", "Walter E. Washington Convention Center") and its street address as written. These are separate from locationText, which is the city/country line; use null for either if the page doesn't state it.

For hotels, list every individual place to stay the page actually names — conference room blocks, partner hotels, recommended or nearby hotels. One entry per hotel, and only hotels this page genuinely names; never fill this array with a general sentence about lodging (that belongs in accommodationText) and never add a hotel from your own knowledge of the area. For each entry: name is the hotel's name as written; address is its street address only if stated; rateText is the stated nightly rate or room-block rate exactly as written ("$289/night", "from £150"); bookingUrl must come from a real [LINK: ...] marker tied to that hotel, else null; isOfficialBlock is true only when the page presents it as the conference's own room block / official or headquarters hotel, and false when it's merely listed as nearby or recommended.

distanceText is how far that hotel is from the VENUE, copied as the page states it and only when the page states it for that hotel — "0.2 miles from the convention center", "adjacent to the venue", "a 5-minute walk", "across the street". Leave it null when the page gives no distance; do not compute, estimate, or infer a distance from an address, and do not describe a hotel as close just because it is listed as a conference hotel. Additionally set distanceMeters to that same stated distance converted to a whole number of metres when — and only when — the page states an actual measurable distance or walking time (1 mile = 1609 metres; treat a stated walking time as 80 metres per minute; treat "adjacent"/"attached"/"on-site"/"across the street" as 0). If the page gives no distance for that hotel, or gives something too vague to measure ("close by", "in the downtown area"), set distanceMeters to null rather than guessing a number.

For the identity fields: acronym is the conference's own short name when it uses one ("APHA", "NeurIPS", "ICSE 2026" -> "ICSE"); edition is its own ordinal for this instance ("17th Annual", "2026 edition") exactly as written; year is the calendar year of the event itself, not of a past edition mentioned in passing; organizingInstitution is the society, university or company that runs it, when the page names one.

For importantDates, list every dated milestone the page states as its own entry — abstract deadline, full paper deadline, notification, camera-ready, early-bird registration close, registration deadline, the event dates themselves. Use the page's own label and its own date wording; set isDeadline true only for dates that are something an author or attendee must act by. This is the place for dates, not a free-text summary — one entry per milestone, and nothing that isn't explicitly dated on the page.

For registrationUrl, give the page where someone actually registers or pays — the target of a "Register Now" / "Register here" / "Sign up" call to action, which is very often on a different host (a ticketing or event-management provider). Prefer that over a link to the conference's own general registration *information* page, and use null rather than falling back to a nav entry that merely describes fees.

For registrationFees, one entry per price the page states, with the category exactly as written ("IEEE Member", "Student", "Non-member early bird"), the amount as a number, and the currency as its three-letter code when determinable from the symbol or text. Attach the deadline only when the page ties that specific price to a date. Never convert between currencies and never compute a price the page didn't print. earlyBirdDeadline is the date the reduced rate ends, when stated.

For publicationInfo, capture only what the page actually claims about where the work will appear: the proceedings publisher, the journals a special issue or extended version is offered in, the indexing services named (Scopus, Web of Science, EI Compendex, DBLP), and any DOI, ISBN or ISSN literally printed. These are frequently promised in vague terms — record only concrete named claims, never "will be indexed in major databases".

For contact, use the address the page gives for reaching the organisers. socialLinks must come from real [LINK: ...] markers pointing at a social platform, with platform set to the platform's name.

For committee entries, set committeeType to which body the page places that person in — "Organizing", "Scientific", "Technical", "Advisory", "Steering", "Chair", or "Reviewer" — using the page's own grouping. When a page lists people under a single unlabelled "Committee" heading, use "Organizing". Never sort people into a body the page didn't put them in.

For agendaSessions, set sessionType to "Keynote", "Workshop", "Tutorial", "Special Session", "Panel" or "Session" according to how the page itself labels that slot, and null when it doesn't say.

For sponsors, set partnerType to "Sponsor", "Exhibitor", "Partner" or "Supporter" following the page's own heading for that organisation, and null if it simply names them without a category.

fieldConfidence records how firmly the page supports each value you filled in. Include an entry ONLY for fields you actually populated, keyed by the field name, and use exactly one of:
  "High"   — the page states this directly and unambiguously; a careful reader would extract the same value.
  "Medium" — the page states it, but the wording is partial, or spread across sentences, or one of several plausible readings.
  "Low"    — the page strongly implies it without saying it outright.
If something is only a guess, do not fill the field at all — null is always better than a low-confidence invention. Judge each field on this page's own wording, not on how plausible the value seems in general.

Finally, look at every [LINK: url] marker in the page text above and, based on genuinely reading and understanding what each link is about (its visible text and the surrounding sentence) rather than matching a fixed keyword, decide whether it likely leads to a page with MORE detail than what's summarized here about: (a) the Call for Papers or submission process, (b) the organizing/technical/program committee or chairs, (c) speakers, keynotes, presenters, or panelist bios (whatever the page itself calls them), (d) sponsors or exhibitors, (e) the program, agenda, schedule, or timetable (whatever the page itself calls it), (f) venue, accommodation, or travel information, (g) a general "About"/"Overview"/"About the Conference" page describing what the conference itself is about, if this page doesn't already describe that well. Put the single most likely such URL for each category into relevantLinks below, or null if none of the links on this page look relevant to that category — every URL you provide there MUST be copied character-for-character from one of the [LINK: ...] markers in the text above; never invent or guess one.

Page title: "${title}"
Page URL: "${pageUrl}"

Page text:
"""
${pageText}
"""

Return JSON with exactly this shape:
{
  "conferenceTitle": string | null,
  "acronym": string | null,
  "edition": string | null,
  "year": string | null,
  "organizingInstitution": string | null,
  "overviewSummary": string | null,
  "topics": string[],
  "datesText": string | null,
  "locationText": string | null,
  "city": string | null,
  "country": string | null,
  "format": string | null,
  "importantDates": [{ "label": string, "date": string, "isDeadline": boolean }],
  "registrationUrl": string | null,
  "registrationFees": [{ "category": string, "amount": number | null, "currency": string | null, "deadline": string | null, "notes": string | null }],
  "earlyBirdDeadline": string | null,
  "publicationInfo": {
    "proceedingsPublisher": string | null,
    "journals": string[],
    "indexing": string[],
    "doi": string | null,
    "isbn": string | null,
    "issn": string | null
  },
  "contactEmail": string | null,
  "contactPhone": string | null,
  "socialLinks": [{ "platform": string, "url": string }],
  "awards": [{ "name": string, "description": string | null }],
  "cfpStatus": string | null,
  "cfpDeadline": string | null,
  "submissionUrl": string | null,
  "submissionRequirements": string | null,
  "submissionTemplateUrl": string | null,
  "submissionEmail": string | null,
  "cfpSubmissionFormat": string | null,
  "cfpLengthLimit": string | null,
  "cfpReviewProcess": string | null,
  "cfpNotificationDate": string | null,
  "cfpTopics": string[],
  "agendaSessions": [{ "date": string | null, "time": string | null, "title": string, "speakerName": string | null, "speakerImageUrl": string | null, "track": string | null, "sessionType": string | null }],
  "speakers": [{ "name": string, "title": string | null, "org": string | null, "role": string | null, "imageUrl": string | null }],
  "committee": [{ "name": string, "title": string | null, "org": string | null, "role": string | null, "committeeType": string | null, "imageUrl": string | null }],
  "sponsors": [{ "name": string, "tier": string | null, "partnerType": string | null, "logoUrl": string | null }],
  "accommodationText": string | null,
  "travelText": string | null,
  "venueName": string | null,
  "venueAddress": string | null,
  "hotels": [{ "name": string, "address": string | null, "distanceText": string | null, "distanceMeters": number | null, "rateText": string | null, "bookingUrl": string | null, "isOfficialBlock": boolean }],
  "relevantLinks": {
    "overview": string | null,
    "cfp": string | null,
    "committee": string | null,
    "speakers": string | null,
    "sponsors": string | null,
    "agenda": string | null,
    "venue": string | null
  },
  "fieldConfidence": { "<fieldName>": "High" | "Medium" | "Low" }
}`;
  }

  // Rejects with a timeout error after `ms` if `promise` hasn't settled yet — used below because
  // the Gemini SDK call itself has no built-in timeout, so a slow model response could otherwise
  // hang a page's extraction (and therefore the whole crawl round it's part of) indefinitely.
  function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  // Conference sites are very often slow, CMS-driven, and hosted on shared event platforms; six
  // seconds was timing real sites out and surfacing them as unreadable when they would have
  // answered a moment later. Secondary pages ride the same ceiling but are fetched in parallel,
  // so raising it costs one round's tail latency rather than multiplying across the crawl.
  const PAGE_FETCH_TIMEOUT_MS = 12000;
  // The extraction asks for the whole conference record now — identity, important dates, fee
  // table, publication details, committees, per-field confidence — so a content-rich page takes
  // far longer to generate than the handful of fields this was originally sized for. At 12s real
  // pages were timing out in production and being discarded as unreadable. The crawl runs in the
  // background, so waiting longer costs nothing the reader sees.
  const MODEL_CALL_TIMEOUT_MS = 40000;
  // Below this much visible text a "successful" fetch is not something worth extracting from: it
  // is a client-rendered shell, an interstitial, or a cookie wall whose real content never arrived
  // in the HTML. Extracting from it yields nulls for every section, which is indistinguishable
  // from a page that genuinely lists no speakers — so it is reported as a failed read instead.
  const MIN_EXTRACTABLE_TEXT_CHARS = 400;

  // A user-initiated read of a public conference page, so these are the headers an ordinary
  // browser visiting that same page would send. The previous "ConferenceGateBot/1.0" user agent
  // self-identified as a bot, which Cloudflare and the WAFs/security plugins in front of a great
  // many real conference sites reject outright with a 403 — the page then extracted as empty and
  // every tab showed "(0)" for a site that plainly had speakers and an agenda on it. Accept and
  // Accept-Language are sent for the same reason: their absence is a common bot signal.
  const EXTRACTION_FETCH_HEADERS: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };

  // How many times to re-ask the model after a transient failure, and how long to wait between.
  // Input size feeds directly into how long generation takes. 40,000 characters alongside the
  // full-record schema was enough to push the model past Google's own deadline on real pages;
  // 25,000 still comfortably covers a long conference page including a CFP near the bottom.
  const MAX_PAGE_TEXT_CHARS = 25000;
  const MODEL_RETRY_ATTEMPTS = 3;
  const MODEL_RETRY_BASE_DELAY_MS = 1500;
  // Google's own server-side deadline, rate limiting, and transient unavailability. These say
  // "ask again", not "this page is unreadable" — and treating them as the latter meant a page
  // that had already been fetched (sometimes at Firecrawl's expense) was thrown away over a
  // momentary hiccup.
  const TRANSIENT_MODEL_STATUSES = new Set([429, 500, 502, 503, 504]);

  function isTransientModelError(error: any): boolean {
    const status = error?.status ?? error?.code ?? error?.error?.code;
    if (typeof status === "number" && TRANSIENT_MODEL_STATUSES.has(status)) return true;
    const message = String(error?.message || error || "");
    return /DEADLINE_EXCEEDED|UNAVAILABLE|RESOURCE_EXHAUSTED|timed out|ECONNRESET|socket hang up/i.test(message);
  }

  // Runs the extraction prompt, retrying the failures that are worth retrying.
  async function callExtractionModel(
    ai: NonNullable<ReturnType<typeof getAIClient>>,
    pageText: string,
    title: string,
    pageUrl: string
  ): Promise<string> {
    let lastError: any = null;
    for (let attempt = 1; attempt <= MODEL_RETRY_ATTEMPTS; attempt++) {
      try {
        const response = await withTimeout(
          ai.models.generateContent({
            model: "gemini-3.6-flash",
            contents: buildExtractionPrompt(pageText, title, pageUrl),
            config: {
              responseMimeType: "application/json",
              // Reading facts off a page and copying them into fields is not a reasoning task.
              // Left to think at length the model spent long enough that Google's own deadline
              // expired before it answered — a 504 on a page that had already been fetched.
              thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
            },
          }),
          MODEL_CALL_TIMEOUT_MS,
          "Extraction model call"
        );
        return response.text || "{}";
      } catch (error) {
        lastError = error;
        if (!isTransientModelError(error) || attempt === MODEL_RETRY_ATTEMPTS) break;
        const waitMs = MODEL_RETRY_BASE_DELAY_MS * attempt;
        console.warn(
          `Extraction model call for ${pageUrl} failed transiently (attempt ${attempt}/${MODEL_RETRY_ATTEMPTS}), ` +
            `retrying in ${waitMs}ms`
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
    throw lastError;
  }

  // Fetches one page and runs the Gemini extraction prompt against it. Returns null (rather than
  // throwing) on any fetch/safety failure so callers can treat a failed secondary-page fetch as
  // "just skip it" without losing the primary page's already-good result.
  async function extractPage(
    ai: NonNullable<ReturnType<typeof getAIClient>>,
    pageUrl: string,
    title: string
  ): Promise<{ parsed: any; html: string; pageTitle: string | null; isPdf: boolean } | null> {
    if (!(await isSafeExternalUrl(pageUrl))) return null;

    // Reads the URL by whichever means works. A plain fetch is tried first because it's fast and
    // handles most conference sites; a real browser is tried only when that produces nothing
    // usable, which is the case for bot-protected sites and ones that build themselves in
    // JavaScript. A PDF takes a third path entirely — conference sites routinely publish the call
    // for papers, the programme and the fee table as documents rather than pages.
    async function readPageContent(): Promise<{ html: string; text: string; kind: "html" | "pdf" } | null> {
      let plain: string | null = null;
      try {
        const pageRes = await fetch(pageUrl, {
          headers: EXTRACTION_FETCH_HEADERS,
          redirect: "follow",
          // A slow or unresponsive conference site would otherwise hang this request (and the
          // client's loading spinner) indefinitely — cap it and treat a timeout as a failure.
          signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
        });
        const contentType = pageRes.headers.get("content-type") || "";

        if (pageRes.ok && /application\/pdf/i.test(contentType)) {
          const text = await extractPdfText(await pageRes.arrayBuffer());
          // No `html` for a PDF: it has no anchors for the crawl to follow, and the extraction
          // prompt's [LINK:]/[IMAGE:] markers have no meaning here.
          return text ? { html: "", text, kind: "pdf" } : null;
        }

        // Any other non-HTML body (an image, a JSON API response, a zip) is worth abandoning:
        // tag-stripping it produces text-shaped noise the model can only extract nulls from, and
        // rendering it in a browser wouldn't help either.
        if (contentType && !/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
          console.error(`Page fetch for extraction returned unusable content-type "${contentType}" for ${pageUrl}`);
          return null;
        }
        // An error response still has a body, and without this check that body (a WAF block page,
        // a 404, a proxy's "denied" text) was handed to the model as if it were the conference's
        // own page. The model would dutifully report nulls for everything, and the endpoint would
        // return extracted:true — so a page we never actually read was indistinguishable from a
        // real page that genuinely had no speakers, committee, or agenda on it.
        if (pageRes.ok) {
          plain = await pageRes.text();
        } else {
          console.error(`Page fetch for extraction returned HTTP ${pageRes.status} for ${pageUrl}`);
        }
      } catch (fetchErr) {
        console.error("Failed to fetch page for extraction:", fetchErr);
      }

      // Good enough as it stands — no need to spend a browser launch on it.
      if (plain) {
        const text = prepareHtmlForExtraction(plain, pageUrl);
        if (text.length >= MIN_EXTRACTABLE_TEXT_CHARS) return { html: plain, text, kind: "html" };
      }

      // Either the request was refused, or it succeeded and returned a shell with nothing in it.
      // Both are exactly what a real browser exists to get past, so try one.
      const rendered = await fetchRenderedHtml(pageUrl);
      if (rendered) {
        const text = prepareHtmlForExtraction(rendered, pageUrl);
        if (text.length >= MIN_EXTRACTABLE_TEXT_CHARS) {
          console.log(`Read ${pageUrl} by rendering it in a browser (plain fetch returned nothing usable)`);
          return { html: rendered, text, kind: "html" };
        }
      }

      // Last resort, and the only step that costs money: Firecrawl renders behind rotating
      // proxies on its own infrastructure, which reads sites that refuse this server outright and
      // ones whose content never appears in a browser we can run here. Reached only once both
      // free routes have failed on this specific URL.
      const scraped = await firecrawlScrape(pageUrl);
      if (scraped) {
        // Prefer the HTML, because the crawl follows its anchors and the prompt reads its image
        // tags. Markdown is the fallback for pages Firecrawl only returns as text — it still
        // extracts perfectly well, it just contributes no onward links.
        const fromHtml = scraped.html ? prepareHtmlForExtraction(scraped.html, pageUrl) : "";
        if (fromHtml.length >= MIN_EXTRACTABLE_TEXT_CHARS) {
          console.log(`Read ${pageUrl} via Firecrawl (plain fetch and local browser both failed)`);
          return { html: scraped.html, text: fromHtml, kind: "html" };
        }
        if (scraped.markdown.trim().length >= MIN_EXTRACTABLE_TEXT_CHARS) {
          console.log(`Read ${pageUrl} via Firecrawl as markdown (no usable HTML returned)`);
          // Markdown, not a PDF: no anchors to follow, but it is still a web page.
          return { html: "", text: scraped.markdown.trim(), kind: "html" };
        }
      }

      // Nothing worked. Report what the plain body amounted to, so the caller logs the same
      // "too little text" reason it always has.
      return plain ? { html: plain, text: prepareHtmlForExtraction(plain, pageUrl), kind: "html" } : null;
    }

    const content = await readPageContent();
    if (content === null) return null;
    const isPdf = content.kind === "pdf";

    // 40,000 characters of actual visible text (not raw HTML) comfortably covers even a long
    // single page with CFP details near the bottom — a tighter cutoff risked truncating the
    // requirements section clean off before the model ever saw it.
    const pageText = content.text.slice(0, MAX_PAGE_TEXT_CHARS);
    if (pageText.length < MIN_EXTRACTABLE_TEXT_CHARS) {
      console.error(
        `Page for extraction had only ${pageText.length} chars of visible text (likely client-rendered) for ${pageUrl}`
      );
      return null;
    }
    const html = content.html;

    let parsed: any = {};
    try {
      const response = await callExtractionModel(ai, pageText, title, pageUrl);
      parsed = JSON.parse(response || "{}");
    } catch (e) {
      console.error("Extraction model call failed:", e);
      return null;
    }
    return { parsed, html, pageTitle: pageTitleOf(html, pageUrl), isPdf };
  }

  // The page's own <title>, which is what a person would call this page when asked where a value
  // came from. A PDF has no title tag, so its filename stands in.
  function pageTitleOf(html: string, pageUrl: string): string | null {
    const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    if (match) {
      const text = decodeEntitiesAndTags(match[1]);
      if (text) return text.slice(0, 200);
    }
    try {
      const name = decodeURIComponent(new URL(pageUrl).pathname.split("/").filter(Boolean).pop() || "");
      return name || null;
    } catch {
      return null;
    }
  }

  function decodeEntitiesAndTags(raw: string): string {
    return raw
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Triggers a secondary-page lookup whenever submissionRequirements specifically wasn't found —
  // not only when every CFP field came up empty. A conference's overview page commonly links to
  // (and even names the deadline for) a separate submission page without repeating the actual
  // formatting/length requirements there, so requiring every field to be missing was letting a
  // partial primary-page result (e.g. just a submissionUrl) block the deeper fetch that would
  // have found the requirements text the user actually needs.
  function isCfpMissing(parsed: any): boolean {
    return !parsed.submissionRequirements;
  }
  function isOverviewMissing(parsed: any): boolean {
    return !parsed.overviewSummary;
  }
  function isCommitteeMissing(parsed: any): boolean {
    return !Array.isArray(parsed.committee) || parsed.committee.length === 0;
  }
  function isSpeakersMissing(parsed: any): boolean {
    return !Array.isArray(parsed.speakers) || parsed.speakers.length === 0;
  }
  function isSponsorsMissing(parsed: any): boolean {
    return !Array.isArray(parsed.sponsors) || parsed.sponsors.length === 0;
  }
  function isAgendaMissing(parsed: any): boolean {
    return !Array.isArray(parsed.agendaSessions) || parsed.agendaSessions.length === 0;
  }
  // Either half missing keeps the venue category "in progress" — a page that states where to
  // stay but never mentions how to get there (or vice versa) shouldn't stop the crawl from still
  // looking for the other half elsewhere on the site, same as CFP keeps looking specifically for
  // submissionRequirements even once a deadline or URL was already found.
  function isVenueMissing(parsed: any): boolean {
    return !parsed.accommodationText || !parsed.travelText || !parsed.locationText;
  }

  // Orders the extracted hotels closest-to-venue first, which is the order someone booking a room
  // actually wants to read them in. Only a distance the page itself stated is ever used to rank:
  // a hotel the site gave no distance for sorts after every hotel that has one rather than being
  // guessed at, so the ordering can never imply a proximity nobody published.
  function normalizeHotels(raw: unknown, baseUrl: string): any[] {
    if (!Array.isArray(raw)) return [];
    const hotels = raw
      .filter((h) => h && typeof h === "object" && typeof h.name === "string" && h.name.trim())
      .slice(0, 40)
      .map((h: any) => {
        const meters =
          typeof h.distanceMeters === "number" && Number.isFinite(h.distanceMeters) && h.distanceMeters >= 0
            ? Math.round(h.distanceMeters)
            : null;
        return {
          name: h.name.trim(),
          address: typeof h.address === "string" && h.address.trim() ? h.address.trim() : null,
          distanceText: typeof h.distanceText === "string" && h.distanceText.trim() ? h.distanceText.trim() : null,
          distanceMeters: meters,
          // Where the distance came from, so the two are never conflated: "published" is the
          // conference's own stated figure, "estimated" is a straight-line calculation from
          // geocoded coordinates that this site never actually claimed.
          distanceSource: h.distanceSource === "estimated" ? "estimated" : meters !== null ? "published" : null,
          rateText: typeof h.rateText === "string" && h.rateText.trim() ? h.rateText.trim() : null,
          bookingUrl: resolveAbsoluteUrl(h.bookingUrl, baseUrl),
          isOfficialBlock: h.isOfficialBlock === true,
        };
      });

    // Three tiers: a measured distance, then a stated-but-unmeasurable one ("close to downtown"),
    // then no distance at all. The conference's own room block wins ties, since that's the booking
    // most attendees are looking for when two hotels are equally far away.
    const tier = (h: any) => (h.distanceMeters !== null ? 0 : h.distanceText ? 1 : 2);
    return hotels.sort((a, b) => {
      const ta = tier(a);
      const tb = tier(b);
      if (ta !== tb) return ta - tb;
      if (ta === 0 && a.distanceMeters !== b.distanceMeters) return a.distanceMeters - b.distanceMeters;
      if (a.isOfficialBlock !== b.isOfficialBlock) return a.isOfficialBlock ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  // How many hotels are worth a geocode. Each one costs a rate-limited second, and a conference
  // listing more than this many is listing a city's hotel market rather than its own room blocks.
  const MAX_HOTELS_TO_GEOCODE = 12;
  // Past this, the geocoder almost certainly matched the wrong place — a bare hotel name like
  // "The Ned" or "Hilton Garden Inn" exists in dozens of cities. A wrong number is worse than no
  // number, so an implausible result is discarded rather than shown.
  const MAX_PLAUSIBLE_HOTEL_DISTANCE_M = 50000;

  // Works out roughly how far each hotel is from the venue for the hotels the conference listed
  // but never gave a distance for. Runs once, after the crawl, because each lookup is rate-limited
  // to one per second by the geocoding service's usage policy.
  //
  // Anything produced here is explicitly marked `estimated` and never overwrites a distance the
  // conference itself published — a straight-line calculation between two geocoded points is a
  // weaker claim than the organiser saying "a 5-minute walk", and the two stay distinguishable all
  // the way to the screen.
  async function enrichHotelDistances(parsed: any): Promise<void> {
    const hotels = Array.isArray(parsed.hotels) ? parsed.hotels : [];
    const needsDistance = hotels.filter(
      (h: any) =>
        h &&
        typeof h.name === "string" &&
        h.name.trim() &&
        (typeof h.distanceMeters !== "number" || !Number.isFinite(h.distanceMeters))
    );
    if (needsDistance.length === 0) return;

    // The venue is what everything is measured from, so without one there is nothing to compute —
    // and a city on its own won't do, since a distance from a city's centroid isn't a distance
    // from the conference. A named venue together with its address is the most precise query
    // available; the city is only appended when there's no address to make it unambiguous.
    const cityContext = typeof parsed.locationText === "string" ? parsed.locationText.trim() : "";
    const venueQuery = (
      parsed.venueAddress ? [parsed.venueName, parsed.venueAddress] : [parsed.venueName, cityContext]
    )
      .filter((part: unknown) => typeof part === "string" && part.trim())
      .join(", ");
    if (!venueQuery) return;

    const venuePoint = await geocodePlace(venueQuery);
    if (!venuePoint) return;

    for (const hotel of needsDistance.slice(0, MAX_HOTELS_TO_GEOCODE)) {
      // A bare hotel name is ambiguous across cities, so the conference's own city is appended
      // when the site didn't give the hotel a full address of its own.
      const hotelQuery = hotel.address ? `${hotel.name}, ${hotel.address}` : [hotel.name, cityContext].filter(Boolean).join(", ");
      const point = await geocodePlace(hotelQuery);
      if (!point) continue;
      const meters = haversineMeters(venuePoint, point);
      if (meters > MAX_PLAUSIBLE_HOTEL_DISTANCE_M) continue;
      hotel.distanceMeters = meters;
      hotel.distanceSource = "estimated";
      // Only filled when the site gave no wording of its own, so a real published phrase is never
      // replaced by a generated one.
      if (!hotel.distanceText) hotel.distanceText = formatEstimatedDistance(meters);
    }
  }

  // Fills in only the fields the primary page's extraction came up empty for — real data already
  // found on the primary page always wins, so a secondary page can only ever add, never overwrite.
  // Plain values, each held by whichever page stated it first.
  const SCALAR_FIELDS = [
    "conferenceTitle", "acronym", "edition", "year", "organizingInstitution",
    "overviewSummary", "datesText", "locationText", "city", "country", "format",
    "cfpStatus", "cfpDeadline", "submissionRequirements", "submissionEmail",
    "cfpSubmissionFormat", "cfpLengthLimit", "cfpReviewProcess", "cfpNotificationDate",
    "earlyBirdDeadline", "contactEmail", "contactPhone",
    "accommodationText", "travelText", "venueName", "venueAddress",
  ] as const;
  // Same, but resolved against the page they were found on before being kept.
  const URL_FIELDS = ["submissionUrl", "submissionTemplateUrl", "registrationUrl"] as const;
  // Arrays of objects, unioned across pages and de-duplicated on their identity field.
  const LIST_FIELDS = [
    "committee", "speakers", "sponsors", "agendaSessions", "hotels",
    "importantDates", "registrationFees", "awards", "socialLinks",
  ] as const;
  // Arrays of plain strings, unioned on their own normalized text.
  const STRING_LIST_FIELDS = ["cfpTopics", "topics"] as const;

  // Fields where two different values mean the site genuinely contradicts itself, and a reader
  // needs to know which to trust. Free-prose fields are deliberately excluded: two pages
  // describing the same conference in different words, or naming its city with and without the
  // country, is normal writing rather than a disagreement, and reporting those as conflicts
  // buries the one that matters — a venue that actually changed — in noise.
  const CONFLICT_FIELDS = new Set([
    "datesText", "cfpDeadline", "cfpNotificationDate", "earlyBirdDeadline",
    "venueName", "venueAddress", "city", "country", "format", "year", "edition",
    "contactEmail", "acronym",
  ]);

  // Two values count as a real disagreement only if they aren't each other in different words.
  // Connector words are dropped so "14-17 October 2026" and "14 to 17 October 2026" match, and
  // one value containing the other counts as agreement so "London" doesn't fight
  // "London, United Kingdom".
  function sameValue(a: unknown, b: unknown): boolean {
    const norm = (v: unknown) =>
      String(v)
        .toLowerCase()
        .replace(/\b(to|through|until|till|and|the|at|on|in|of)\b/g, " ")
        .replace(/[^a-z0-9]/g, "");
    const na = norm(a);
    const nb = norm(b);
    if (!na || !nb) return na === nb;
    if (na === nb) return true;
    const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
    return shorter.length >= 4 && longer.includes(shorter);
  }

  function noteProvenance(merged: any, field: string, url: string, pageTitle: string | null, secondary: any): void {
    if (!merged._provenance) merged._provenance = {};
    const stated = secondary?.fieldConfidence?.[field];
    merged._provenance[field] = {
      sourceUrl: url,
      sourcePageTitle: pageTitle,
      confidence: stated === "High" || stated === "Medium" || stated === "Low" ? stated : "Medium",
    };
  }

  // Records that two pages of the same site stated different things, rather than quietly keeping
  // whichever was read first. Conference sites contradict themselves more often than one would
  // hope — a date changed on the CFP page but not the homepage, a venue updated in one place
  // only — and silently picking one produces a confidently wrong answer.
  function noteConflict(merged: any, field: string, incoming: unknown, url: string, pageTitle: string | null): void {
    if (!merged._conflicts) merged._conflicts = [];
    const held = merged._provenance?.[field];
    let entry = merged._conflicts.find((c: any) => c.field === field);
    if (!entry) {
      entry = {
        field,
        values: [
          {
            value: String(merged[field]),
            sourceUrl: held?.sourceUrl || null,
            sourcePageTitle: held?.sourcePageTitle || null,
          },
        ],
      };
      merged._conflicts.push(entry);
    }
    if (entry.values.some((v: any) => sameValue(v.value, incoming))) return;
    entry.values.push({ value: String(incoming), sourceUrl: url, sourcePageTitle: pageTitle });
  }

  function mergeExtractionResults(
    primary: any,
    secondary: any,
    secondaryUrl: string,
    secondaryTitle: string | null = null
  ): any {
    const merged = { ...primary };

    for (const field of SCALAR_FIELDS) {
      const incoming = secondary[field];
      if (incoming === null || incoming === undefined || incoming === "") continue;
      if (!merged[field]) {
        merged[field] = incoming;
        noteProvenance(merged, field, secondaryUrl, secondaryTitle, secondary);
      } else if (CONFLICT_FIELDS.has(field) && !sameValue(merged[field], incoming)) {
        noteConflict(merged, field, incoming, secondaryUrl, secondaryTitle);
      }
    }

    for (const field of URL_FIELDS) {
      if (merged[field] || !secondary[field]) continue;
      const resolved = resolveAbsoluteUrl(secondary[field], secondaryUrl);
      if (!resolved) continue;
      merged[field] = resolved;
      noteProvenance(merged, field, secondaryUrl, secondaryTitle, secondary);
    }

    for (const field of STRING_LIST_FIELDS) {
      const incoming = Array.isArray(secondary[field]) ? secondary[field] : [];
      if (incoming.length === 0) continue;
      const seen = new Set<string>();
      const before = Array.isArray(merged[field]) ? merged[field].length : 0;
      merged[field] = [...(Array.isArray(merged[field]) ? merged[field] : []), ...incoming]
        .filter((t: any) => typeof t === "string" && t.trim())
        .filter((t: string) => {
          const key = t.toLowerCase().replace(/[^a-z0-9]/g, "");
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      if (before === 0 && merged[field].length > 0) {
        noteProvenance(merged, field, secondaryUrl, secondaryTitle, secondary);
      }
    }

    // List sections accumulate across pages instead of being all-or-nothing. A homepage almost
    // always carries a teaser — three "featured speakers", a couple of headline sponsors, one
    // day's highlights — and the real roster lives on the dedicated page. Treating a non-empty
    // primary list as "already have it" meant the full page's 40 speakers were fetched, parsed,
    // and then thrown away in favour of the homepage's 3. Union + de-duplicate instead, so each
    // page can only ever add rows, and an entry already known keeps its richer version.
    for (const field of LIST_FIELDS) {
      const current = Array.isArray(merged[field]) ? merged[field] : [];
      const incoming = Array.isArray(secondary[field]) ? secondary[field] : [];
      if (incoming.length === 0) continue;
      merged[field] = unionEntries(field, current, incoming);
      if (current.length === 0) noteProvenance(merged, field, secondaryUrl, secondaryTitle, secondary);
    }

    // publicationInfo is a nested object whose own fields fill independently — a page may name the
    // proceedings publisher while another names the indexing services.
    const incomingPub = secondary.publicationInfo;
    if (incomingPub && typeof incomingPub === "object") {
      const current = merged.publicationInfo && typeof merged.publicationInfo === "object" ? { ...merged.publicationInfo } : {};
      let filledSomething = false;
      for (const key of ["proceedingsPublisher", "doi", "isbn", "issn"]) {
        if (!current[key] && incomingPub[key]) {
          current[key] = incomingPub[key];
          filledSomething = true;
        }
      }
      for (const key of ["journals", "indexing"]) {
        const add = Array.isArray(incomingPub[key]) ? incomingPub[key].filter((v: any) => typeof v === "string" && v.trim()) : [];
        if (add.length === 0) continue;
        const seen = new Set<string>();
        current[key] = [...(Array.isArray(current[key]) ? current[key] : []), ...add].filter((v: string) => {
          const k = v.toLowerCase().replace(/[^a-z0-9]/g, "");
          if (!k || seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        filledSomething = true;
      }
      merged.publicationInfo = current;
      if (filledSomething && !merged._provenance?.publicationInfo) {
        noteProvenance(merged, "publicationInfo", secondaryUrl, secondaryTitle, secondary);
      }
    }

    return merged;
  }

  // Identity for de-duplication differs by section: people are the same person if their name
  // matches, a session is the same session if its title matches. Compared on a normalized form so
  // "Dr. Jane Smith" and "Jane Smith " don't both survive as separate rows.
  function entryKey(field: string, entry: any): string | null {
    if (!entry || typeof entry !== "object") return null;
    const raw =
      field === "agendaSessions"
        ? entry.title
        : field === "importantDates"
          ? entry.label
          : field === "registrationFees"
            ? // Two fee rows are the same row only if they are the same category at the same
              // price — an early-bird and a regular rate share a category name but are distinct.
              `${entry.category} ${entry.amount ?? ""} ${entry.deadline ?? ""}`
            : field === "socialLinks"
              ? entry.url
              : entry.name;
    if (typeof raw !== "string" || !raw.trim()) return null;
    let key = raw.toLowerCase();
    if (field !== "agendaSessions") {
      // Titles and honorifics are written inconsistently across a site's own pages.
      key = key.replace(/\b(dr|prof|professor|mr|mrs|ms|miss|sir|dame|the hon|hon|phd|md)\b\.?/g, "");
    }
    key = key.replace(/[^a-z0-9]/g, "");
    return key || null;
  }

  function unionEntries(field: string, current: any[], incoming: any[]): any[] {
    const byKey = new Map<string, any>();
    const unkeyed: any[] = [];
    for (const entry of [...current, ...incoming]) {
      if (!entry || typeof entry !== "object") continue;
      const key = entryKey(field, entry);
      if (!key) {
        // No usable identity to compare on — kept as-is rather than silently dropped, since a
        // real session or sponsor with an odd shape is still real content.
        unkeyed.push(entry);
        continue;
      }
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { ...entry });
        continue;
      }
      // The same person / session / hotel described on two different pages: combine their fields
      // rather than picking one copy wholesale. A speaker photographed on the homepage and given
      // an affiliation on the speakers page should end up with both, and a hotel flagged as the
      // official room block on one page keeps that flag when another page only lists its rate.
      for (const [k, v] of Object.entries(entry)) {
        if (v === null || v === undefined || v === "") continue;
        const held = existing[k];
        if (held === null || held === undefined || held === "") existing[k] = v;
        else if (held === false && v === true) existing[k] = true;
      }
    }
    return [...byKey.values(), ...unkeyed];
  }

  // Shapes the accumulated crawl state into the response the client renders. Called after every
  // round, not only at the end, so the tabs can fill in progressively while the rest of the site
  // is still being read.
  // The categories the crawl is trying to fill, and how to tell whether each one actually got
  // anything. Reported at the end so a reader knows which empty sections were genuinely absent
  // from everything that was read, rather than merely unreached.
  const COVERAGE_CATEGORIES: Array<{ name: string; filled: (r: any) => boolean }> = [
    { name: "Identity (title/acronym/edition)", filled: (r) => Boolean(r.conferenceTitle || r.acronym || r.edition) },
    { name: "Dates", filled: (r) => Boolean(r.datesText) },
    { name: "Important dates & deadlines", filled: (r) => r.importantDates.length > 0 },
    { name: "Location & venue", filled: (r) => Boolean(r.locationText || r.venueName || r.venueAddress) },
    { name: "Format", filled: (r) => Boolean(r.format) },
    { name: "Description", filled: (r) => Boolean(r.overviewSummary) },
    { name: "Topics & tracks", filled: (r) => r.topics.length > 0 || r.cfpTopics.length > 0 },
    { name: "Call for papers", filled: (r) => Boolean(r.cfpStatus || r.cfpDeadline || r.submissionRequirements) },
    { name: "Submission guidelines", filled: (r) => Boolean(r.submissionRequirements || r.cfpSubmissionFormat) },
    { name: "Registration & fees", filled: (r) => Boolean(r.registrationUrl || r.earlyBirdDeadline) || r.registrationFees.length > 0 },
    { name: "Speakers", filled: (r) => r.speakers.length > 0 },
    { name: "Committees", filled: (r) => r.committee.length > 0 },
    { name: "Program & agenda", filled: (r) => r.agendaSessions.length > 0 },
    { name: "Sponsors, exhibitors & partners", filled: (r) => r.sponsors.length > 0 },
    { name: "Organizing institution", filled: (r) => Boolean(r.organizingInstitution) },
    { name: "Contact & social", filled: (r) => Boolean(r.contactEmail || r.contactPhone) || r.socialLinks.length > 0 },
    { name: "Accommodation", filled: (r) => Boolean(r.accommodationText) || r.hotels.length > 0 },
    { name: "Travel", filled: (r) => Boolean(r.travelText) },
    { name: "Awards", filled: (r) => r.awards.length > 0 },
    { name: "Publication & proceedings", filled: (r) => Boolean(r.publicationInfo.proceedingsPublisher || r.publicationInfo.doi || r.publicationInfo.isbn || r.publicationInfo.issn) || r.publicationInfo.journals.length > 0 || r.publicationInfo.indexing.length > 0 },
  ];

  const asStringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : [];
  const asArray = (value: unknown): any[] => (Array.isArray(value) ? value : []);

  function buildExtractionResult(
    parsed: any,
    sourceUrl: string,
    pagesRead: number,
    crawlComplete: boolean,
    coverage?: { pagesRead: string[]; pagesFailed: string[]; pdfsRead: string[]; urlsDiscovered: Set<string> }
  ) {
    const pub = parsed.publicationInfo && typeof parsed.publicationInfo === "object" ? parsed.publicationInfo : {};
    const result: any = {
      extracted: true,
      isFallback: false,
      sourceUrl,
      pagesRead,
      crawlComplete,
      conferenceTitle: parsed.conferenceTitle || null,
      acronym: parsed.acronym || null,
      edition: parsed.edition || null,
      year: parsed.year || null,
      organizingInstitution: parsed.organizingInstitution || null,
      topics: asStringArray(parsed.topics),
      city: parsed.city || null,
      country: parsed.country || null,
      importantDates: asArray(parsed.importantDates).filter((d) => d && typeof d.label === "string" && typeof d.date === "string"),
      registrationUrl: resolveAbsoluteUrl(parsed.registrationUrl, sourceUrl),
      registrationFees: asArray(parsed.registrationFees).filter((f) => f && typeof f.category === "string"),
      earlyBirdDeadline: parsed.earlyBirdDeadline || null,
      publicationInfo: {
        proceedingsPublisher: pub.proceedingsPublisher || null,
        journals: asStringArray(pub.journals),
        indexing: asStringArray(pub.indexing),
        doi: pub.doi || null,
        isbn: pub.isbn || null,
        issn: pub.issn || null,
      },
      contactEmail: sanitizeEmail(parsed.contactEmail),
      contactPhone: parsed.contactPhone || null,
      socialLinks: asArray(parsed.socialLinks)
        .filter((s) => s && typeof s.platform === "string" && typeof s.url === "string")
        .map((s) => ({ platform: s.platform, url: resolveAbsoluteUrl(s.url, sourceUrl) }))
        .filter((s) => s.url),
      awards: asArray(parsed.awards).filter((a) => a && typeof a.name === "string"),
      overviewSummary: parsed.overviewSummary || null,
      datesText: parsed.datesText || null,
      locationText: parsed.locationText || null,
      format: parsed.format || null,
      cfpStatus: parsed.cfpStatus || null,
      cfpDeadline: parsed.cfpDeadline || null,
      submissionUrl: resolveAbsoluteUrl(parsed.submissionUrl, sourceUrl),
      submissionRequirements: parsed.submissionRequirements || null,
      submissionTemplateUrl: resolveAbsoluteUrl(parsed.submissionTemplateUrl, sourceUrl),
      submissionEmail: sanitizeEmail(parsed.submissionEmail),
      cfpSubmissionFormat: parsed.cfpSubmissionFormat || null,
      cfpLengthLimit: parsed.cfpLengthLimit || null,
      cfpReviewProcess: parsed.cfpReviewProcess || null,
      cfpNotificationDate: parsed.cfpNotificationDate || null,
      cfpTopics: Array.isArray(parsed.cfpTopics) ? parsed.cfpTopics.filter((t: any) => typeof t === "string") : [],
      agendaSessions: Array.isArray(parsed.agendaSessions) ? parsed.agendaSessions : [],
      speakers: Array.isArray(parsed.speakers) ? parsed.speakers : [],
      committee: Array.isArray(parsed.committee) ? parsed.committee : [],
      sponsors: Array.isArray(parsed.sponsors) ? parsed.sponsors : [],
      accommodationText: parsed.accommodationText || null,
      travelText: parsed.travelText || null,
      venueName: parsed.venueName || null,
      venueAddress: parsed.venueAddress || null,
      hotels: normalizeHotels(parsed.hotels, sourceUrl),
      // Where each value came from and how firmly its page supported it, so nothing here is an
      // unattributable assertion.
      provenance: parsed._provenance || {},
      // Pages of the same site that disagreed. Reported rather than resolved: picking one would
      // turn a visible contradiction into a confident, possibly wrong, answer.
      conflicts: parsed._conflicts || [],
    };

    // The completeness check: what was read, what failed, and which categories are still empty
    // after all of it.
    result.crawlCoverage = {
      pagesRead: coverage ? coverage.pagesRead : [],
      pagesFailed: coverage ? coverage.pagesFailed : [],
      pdfsRead: coverage ? coverage.pdfsRead : [],
      urlsDiscovered: coverage ? coverage.urlsDiscovered.size : 0,
      categoriesFound: COVERAGE_CATEGORIES.filter((c) => c.filled(result)).map((c) => c.name),
      categoriesMissing: COVERAGE_CATEGORIES.filter((c) => !c.filled(result)).map((c) => c.name),
    };
    return result;
  }

  // The crawl walks the whole conference site, so it routinely outlives the request that started
  // it. A job holds the latest snapshot; the POST answers from the first snapshot and the client
  // polls the status route for the rest as more pages are read.
  interface CrawlJob {
    result: any;
    complete: boolean;
    startedAt: number;
    firstSnapshot: Promise<void>;
    signalFirstSnapshot: () => void;
  }
  const crawlJobs = new Map<string, CrawlJob>();

  // Rounds of breadth-first expansion beyond the primary page.
  const MAX_CRAWL_DEPTH = 5;
  // The ceiling on how much of one site gets read. Generous because this now runs in the
  // background rather than under the user's spinner — the request returns as soon as the first
  // round lands, and everything after that is a progressive improvement to an already-usable page.
  const MAX_TOTAL_PAGES = 60;
  const MAX_PAGES_PER_ROUND = 8; // fetched concurrently, so this bounds one round's wall clock
  // Raised alongside the per-call model timeout: a round is only as fast as its slowest page, so
  // a budget shorter than a few model calls would cut the crawl off after one or two rounds.
  const CRAWL_TIME_BUDGET_MS = 180000;
  // How many sitemap entries to consider. A conference site is rarely bigger than this, and
  // anything past it is almost always blog/news archive rather than event content.
  const MAX_SITEMAP_URLS = 120;
  // How long the POST waits for something worth rendering before answering with what it has.
  const FIRST_RESPONSE_DEADLINE_MS = 15000;

  // Scores a URL's own path against the category patterns — the only signal available for a
  // sitemap entry, which arrives with no anchor text attached to it. "/hotel-and-travel" and
  // "/program/speakers" are read as the words they contain.
  function categoriesInUrlPath(url: string): RelevantLinkCategory[] {
    let pathWords: string;
    try {
      pathWords = decodeURIComponent(new URL(url).pathname).replace(/[^a-zA-Z0-9]+/g, " ");
    } catch {
      return [];
    }
    return RELEVANT_LINK_CATEGORIES.filter((c) => CATEGORY_LINK_TEXT_RE[c].test(pathWords));
  }

  // How many outside pages to read when gathering a conference's details from sources other than
  // its own site. Enough to cover the main topics, bounded so a blocked site doesn't cost more
  // than reading a readable one would have.
  const MAX_OFFSITE_PAGES = 10;
  // Below this many of the twenty tracked categories, a crawl has technically succeeded but has
  // not told the reader much — the point at which looking elsewhere is worth the extra requests.
  const THIN_RESULT_CATEGORY_THRESHOLD = 8;

  // When a conference's own website can't be read — it blocks automated requests, or builds its
  // pages in JavaScript we can't render — the details are still published elsewhere: industry
  // directories, event listings, association news, sponsor announcements, programme mirrors.
  // Those are almost always readable, so rather than showing empty sections, the conference is
  // looked up across the open web and assembled from whatever does answer.
  //
  // This is a weaker source than the organiser's own page, and it is never disguised as one:
  // every field records the third-party URL it came from through the same provenance mechanism,
  // and the result is flagged so the UI can say where it came from.
  async function gatherFromOpenWeb(
    ai: NonNullable<ReturnType<typeof getAIClient>>,
    conferenceName: string,
    officialUrl: string
  ): Promise<{ parsed: any; sources: string[] } | null> {
    const name = conferenceName.trim();
    if (!name) return null;

    let officialHost = "";
    try {
      officialHost = new URL(officialUrl).hostname.replace(/^www\./, "");
    } catch {
      /* an unparseable URL just means nothing to exclude */
    }

    // Separate searches per topic: one generic query returns one page's worth of facts, whereas
    // asking specifically for the programme or the fees surfaces the pages that actually carry
    // them. Quoted so results are about this conference rather than the words in its name.
    const queries = [
      `"${name}" conference dates venue location`,
      `"${name}" speakers keynote program agenda`,
      `"${name}" call for papers abstract submission deadline`,
      `"${name}" registration fees exhibitors sponsors`,
    ];

    const found = await Promise.allSettled(queries.map((q) => searchWebForConferenceFacts(q, 6)));
    const candidates: string[] = [];
    const seenHosts = new Map<string, number>();
    for (const outcome of found) {
      if (outcome.status !== "fulfilled") continue;
      for (const result of outcome.value) {
        const link = result.link;
        if (!link || candidates.includes(link)) continue;
        let host: string;
        try {
          host = new URL(link).hostname.replace(/^www\./, "");
        } catch {
          continue;
        }
        // The official site is what we already failed to read; re-reading it here would just
        // reproduce the same failure and spend the budget doing it.
        if (officialHost && (host === officialHost || host.endsWith(`.${officialHost}`))) continue;
        // At most two pages from any one source, so a single directory can't fill the budget and
        // become the sole voice on this conference.
        const usedFromHost = seenHosts.get(host) || 0;
        if (usedFromHost >= 2) continue;
        seenHosts.set(host, usedFromHost + 1);
        candidates.push(link);
      }
    }
    if (candidates.length === 0) return null;

    const toRead = candidates.slice(0, MAX_OFFSITE_PAGES);
    const results = await Promise.allSettled(toRead.map((url) => extractPage(ai, url, name)));

    let parsed: any = {};
    const sources: string[] = [];
    results.forEach((outcome, i) => {
      if (outcome.status !== "fulfilled" || !outcome.value) return;
      parsed = mergeExtractionResults(parsed, outcome.value.parsed, toRead[i], outcome.value.pageTitle);
      sources.push(toRead[i]);
    });
    return sources.length > 0 ? { parsed, sources } : null;
  }

  // Establishes why a page couldn't be read, by re-probing it rather than inferring. Only runs on
  // the failure path, where the crawl has already given up, so the extra requests cost nothing in
  // the normal case. The distinctions matter because they have different remedies: a site that
  // refuses a real browser needs a different answer from one whose content is simply absent from
  // the HTML, and both differ from a server that has no browser installed to try with.
  async function diagnoseReadFailure(pageUrl: string): Promise<{ reason: string }> {
    if (!(await isSafeExternalUrl(pageUrl))) {
      return { reason: "This address couldn't be resolved, or points somewhere we're not allowed to fetch." };
    }

    let plainStatus: number | null = null;
    let plainTextLength: number | null = null;
    let networkError: string | null = null;
    try {
      const res = await fetch(pageUrl, {
        headers: EXTRACTION_FETCH_HEADERS,
        redirect: "follow",
        signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
      });
      plainStatus = res.status;
      if (res.ok) plainTextLength = prepareHtmlForExtraction(await res.text(), pageUrl).length;
    } catch (e: any) {
      networkError = e?.name === "TimeoutError" ? "timed out" : "couldn't be reached";
    }

    if (isBrowserRenderingUnavailable() && !isFirecrawlConfigured()) {
      return {
        reason:
          `A plain request ${networkError ? networkError : `returned HTTP ${plainStatus}`}, and this server has ` +
          "neither a browser nor a Firecrawl key to retry with — either one reads sites that block plain requests " +
          "or build their pages in JavaScript. Set FIRECRAWL_API_KEY to enable it.",
      };
    }

    // Find out what the stronger readers actually get, rather than assuming.
    const rendered = await fetchRenderedHtml(pageUrl);
    let renderedLength = rendered ? prepareHtmlForExtraction(rendered, pageUrl).length : 0;
    if (renderedLength < MIN_EXTRACTABLE_TEXT_CHARS && isFirecrawlConfigured()) {
      const scraped = await firecrawlScrape(pageUrl);
      if (scraped) {
        renderedLength = Math.max(
          scraped.html ? prepareHtmlForExtraction(scraped.html, pageUrl).length : 0,
          scraped.markdown.trim().length
        );
      }
    }

    if (renderedLength >= MIN_EXTRACTABLE_TEXT_CHARS) {
      return { reason: "The site was readable on retry — this was a temporary failure, so reloading should work." };
    }
    // An error status is the headline fact and must be reported before anything about how much
    // text rendered: a refusal serves a short error page, so judging by rendered length first
    // described a blocked site as one whose content merely loads awkwardly — a different problem
    // with a different remedy.
    if (plainStatus !== null && plainStatus >= 400) {
      return {
        reason: `The site answered HTTP ${plainStatus} to both a plain request and a real browser — it is refusing automated access.`,
      };
    }
    if (networkError) {
      return { reason: `The site ${networkError}, both directly and from a real browser.` };
    }
    if (rendered && renderedLength > 0) {
      return {
        reason:
          `Even in a real browser this page renders only ${renderedLength} characters of text, so its content is ` +
          "loaded in a way we can't read (a login wall, or data fetched after the page settles).",
      };
    }
    if (plainTextLength !== null) {
      return {
        reason:
          `The site returned a page with only ${plainTextLength} characters of text and a real browser couldn't ` +
          "render more, so there was nothing to extract from it.",
      };
    }
    return { reason: "The site couldn't be read either directly or from a real browser." };
  }

  // Reads a conference site end to end: the page the search result pointed at, everything its own
  // sitemap lists, and everything reachable by following its links — merging each page's real
  // extracted content into one accumulated result. Publishes a snapshot after every round so the
  // client can render partial results immediately.
  async function runSiteCrawl(
    ai: NonNullable<ReturnType<typeof getAIClient>>,
    startUrl: string,
    titleHint: string,
    job: CrawlJob
  ): Promise<void> {
    const primary = await extractPage(ai, startUrl, titleHint);
    if (!primary) {
      // Cached only briefly, never for the full 6 hours: a fetch failure is usually transient
      // (a timeout, a rate limit, a momentary block), and pinning that failure in place for a
      // whole afternoon meant one bad moment kept showing an empty page to every later visitor.
      // The conference's own site is unreadable, but the conference is not a secret: its dates,
      // venue, programme and deadlines are published in directories, listings and industry press.
      // Reading those is far more use than an empty page with an explanation on it.
      const offsite = await gatherFromOpenWeb(ai, titleHint, startUrl);
      if (offsite) {
        const result = buildExtractionResult(offsite.parsed, startUrl, offsite.sources.length, true, {
          pagesRead: offsite.sources,
          pagesFailed: [],
          pdfsRead: [],
          urlsDiscovered: new Set(offsite.sources),
        });
        // Flagged, never disguised: this is what other sites say about the conference, which is
        // weaker than the organiser's own word, and the reader is told so.
        result.sourcedFromOpenWeb = true;
        result.officialSiteUnreadable = true;
        job.result = result;
        job.complete = true;
        extractionCache.set(startUrl, { data: result, expiresAt: Date.now() + FAILED_FETCH_CACHE_TTL_MS });
        job.signalFirstSnapshot();
        return;
      }

      const diagnosis = await diagnoseReadFailure(startUrl);
      job.result = {
        extracted: false,
        isFallback: false,
        fetchFailed: true,
        crawlComplete: true,
        browserRenderingUnavailable: isBrowserRenderingUnavailable(),
        // What actually went wrong, established by re-probing rather than inferred. "Blocked us
        // even in a real browser", "returned a page with no content in it" and "no browser is
        // installed to retry with" are three different problems with three different fixes, and
        // a reader who is told the wrong one has no way to act on it.
        readFailureReason: diagnosis.reason,
      };
      job.complete = true;
      extractionCache.set(startUrl, { data: job.result, expiresAt: Date.now() + FAILED_FETCH_CACHE_TTL_MS });
      job.signalFirstSnapshot();
      return;
    }

    // Merged through the same path as every other page rather than used directly, so the page
    // that supplied each value is recorded for the starting page too.
    let parsed = mergeExtractionResults({}, primary.parsed, startUrl, primary.pageTitle);
    const visited = new Set<string>([startUrl]);
    let frontier: Array<{ url: string; html: string; parsed: any }> = [{ url: startUrl, ...primary }];
    let pagesFetched = 1;
    const crawlStartedAt = Date.now();

    // What the crawl actually managed to look at, reported alongside the data so a reader can
    // tell an empty section apart from one that was never reached.
    const coverage = {
      pagesRead: [startUrl] as string[],
      pagesFailed: [] as string[],
      pdfsRead: [] as string[],
      urlsDiscovered: new Set<string>([startUrl]),
    };
    if (primary.isPdf) coverage.pdfsRead.push(startUrl);

    // The site's own index of itself, fetched once up front. These seed the queue alongside the
    // links found by crawling, which is what lets the crawl reach pages the front page never
    // linked to at all.
    let sitemapUrls = (await fetchSitemapUrls(startUrl, MAX_SITEMAP_URLS)).filter((u) => !visited.has(u));
    // Plenty of conference sites publish no sitemap at all, which leaves whole sections reachable
    // only if something happens to link to them. Firecrawl can enumerate a site's URLs directly,
    // so it stands in when there's no sitemap to read — one call, and only when actually needed.
    if (sitemapUrls.length === 0 && isFirecrawlConfigured()) {
      const mapped = await firecrawlMapSite(startUrl, MAX_SITEMAP_URLS);
      sitemapUrls = mapped.filter((u) => !visited.has(u) && !NON_PAGE_EXT_RE.test(u));
      if (sitemapUrls.length > 0) {
        console.log(`Firecrawl mapped ${sitemapUrls.length} URLs for ${startUrl} (site publishes no sitemap)`);
      }
    }

    for (
      let depth = 0;
      depth < MAX_CRAWL_DEPTH && pagesFetched < MAX_TOTAL_PAGES && Date.now() - crawlStartedAt < CRAWL_TIME_BUDGET_MS;
      depth++
    ) {
      // Whether a section is *empty* only sets crawl priority — it does not decide whether that
      // section's page gets opened at all. A homepage teaser ("featured speakers", one headline
      // sponsor, day-one highlights) would otherwise mark every section found on page one, which
      // is precisely how a site's real Speakers / Agenda / Sponsors pages went unread.
      const emptyByCategory: Record<RelevantLinkCategory, boolean> = {
        overview: isOverviewMissing(parsed),
        cfp: isCfpMissing(parsed),
        committee: isCommitteeMissing(parsed),
        speakers: isSpeakersMissing(parsed),
        sponsors: isSponsorsMissing(parsed),
        agenda: isAgendaMissing(parsed),
        venue: isVenueMissing(parsed),
      };

      // Three tiers, read in this order, so a site too large to finish still spends its budget on
      // the sections a reader currently has nothing for, before pages that merely add to a section
      // that already has something, before the rest of the site.
      const urgent: string[] = [];
      const supplementary: string[] = [];
      const remainder: string[] = [];
      const proposed = new Set<string>();
      const consider = (url: string, tier: string[]) => {
        if (!url || visited.has(url) || proposed.has(url)) return;
        proposed.add(url);
        tier.push(url);
      };

      // Ahead of everything else: the pages above the one we started on. When a search result
      // points at a deep page, this is what reaches the conference's actual front page, where the
      // dates, venue and description almost always are.
      for (const url of ancestorUrls(startUrl)) consider(url, urgent);

      for (const page of frontier) {
        const realLinks = extractAllLinks(page.html, page.url);
        const modelLinks = sanitizeRelevantLinks(page.parsed, realLinks, page.url);
        for (const category of RELEVANT_LINK_CATEGORIES) {
          const tier = emptyByCategory[category] ? urgent : supplementary;
          const modelLink = modelLinks[category];
          if (modelLink) consider(modelLink, tier);
          // The model names at most one link per category, but a real nav bar routinely spreads a
          // single topic across several entries — "Sessions" beside "Agenda", "Sponsors" beside
          // "Exhibitors", "Hotel" beside "Travel". Take a few per category per page so the
          // siblings the model's single pick leaves behind still get read.
          for (const url of findLinksByText(page.html, page.url, CATEGORY_LINK_TEXT_RE[category], 3)) {
            consider(url, tier);
          }
        }
      }

      // Sitemap entries join the same tiers, ranked by what their own path says they are. Ones
      // that name no category at all still queue up behind everything else rather than being
      // dropped — that is what makes this a crawl of the whole site rather than of its nav bar.
      for (const url of sitemapUrls) {
        const categories = categoriesInUrlPath(url);
        if (categories.length === 0) consider(url, remainder);
        else if (categories.some((c) => emptyByCategory[c])) consider(url, urgent);
        else consider(url, supplementary);
      }

      // Any remaining same-site link from this round's pages, so link-following also reaches pages
      // that named no category — the neutral "About"/"Event Details" hubs that lead onward.
      for (const page of frontier) {
        for (const url of findExploratoryLinks(page.html, page.url, 8)) consider(url, remainder);
      }

      const candidateUrls = [...urgent, ...supplementary, ...remainder];
      candidateUrls.forEach((url) => coverage.urlsDiscovered.add(url));
      if (candidateUrls.length === 0) break;

      // Fetched in parallel rather than one after another — each is an independent page-plus-
      // model-call round trip, and running them concurrently keeps a multi-page round roughly as
      // fast as a single fetch instead of multiplying the wait. Capped per round as well as in
      // total, so a link-dense nav can't fire dozens of simultaneous requests at one site.
      const remainingBudget = Math.min(MAX_TOTAL_PAGES - pagesFetched, MAX_PAGES_PER_ROUND);
      const urlsToFetch = candidateUrls.slice(0, remainingBudget);
      urlsToFetch.forEach((url) => visited.add(url));
      pagesFetched += urlsToFetch.length;

      const roundResults = await Promise.allSettled(urlsToFetch.map((url) => extractPage(ai, url, titleHint)));
      const nextFrontier: typeof frontier = [];
      roundResults.forEach((outcome, i) => {
        if (outcome.status === "fulfilled" && outcome.value) {
          parsed = mergeExtractionResults(parsed, outcome.value.parsed, urlsToFetch[i], outcome.value.pageTitle);
          coverage.pagesRead.push(urlsToFetch[i]);
          if (outcome.value.isPdf) coverage.pdfsRead.push(urlsToFetch[i]);
          // A PDF contributes its content but has no links, so it can't extend the frontier.
          if (outcome.value.html) nextFrontier.push({ url: urlsToFetch[i], ...outcome.value });
        } else {
          coverage.pagesFailed.push(urlsToFetch[i]);
          if (outcome.status === "rejected") console.error("Crawl page extraction failed:", outcome.reason);
        }
      });

      job.result = buildExtractionResult(parsed, startUrl, pagesFetched, false, coverage);
      job.signalFirstSnapshot();

      if (nextFrontier.length === 0) break;
      frontier = nextFrontier;
    }

    // A site can be readable and still say almost nothing — a JavaScript programme app that
    // renders a shell, a one-page holding site, a registration portal with no event details on
    // it. The crawl succeeded, so the failure path above never runs, yet the reader still gets
    // empty sections. Where the site itself came up thin, top it up from the open web the same
    // way, and let the merge keep the official site's own values ahead of anyone else's.
    let sourcedFromOpenWeb = false;
    const provisional = buildExtractionResult(parsed, startUrl, pagesFetched, false, coverage);
    if (provisional.crawlCoverage.categoriesFound.length < THIN_RESULT_CATEGORY_THRESHOLD) {
      const offsite = await gatherFromOpenWeb(ai, titleHint || provisional.conferenceTitle || "", startUrl);
      if (offsite) {
        // `parsed` is the primary argument, so anything the conference itself stated wins and the
        // outside sources only fill what it left empty.
        parsed = mergeExtractionResults(parsed, offsite.parsed, startUrl, null);
        for (const [field, entry] of Object.entries(offsite.parsed._provenance || {})) {
          if (!parsed._provenance) parsed._provenance = {};
          if (!parsed._provenance[field]) parsed._provenance[field] = entry;
        }
        offsite.sources.forEach((url) => {
          coverage.pagesRead.push(url);
          coverage.urlsDiscovered.add(url);
        });
        sourcedFromOpenWeb = true;
      }
    }

    // Done last, once every page that might mention a hotel has been read, and deliberately after
    // the final crawl snapshot has already been published — a rate-limited geocode per hotel is
    // slow, and none of it should hold up content that's already available to show.
    try {
      await enrichHotelDistances(parsed);
    } catch (error) {
      // Estimated distances are an enhancement; losing them must never lose the crawl's real work.
      console.error("Hotel distance estimation failed:", error);
    }

    const result = buildExtractionResult(parsed, startUrl, coverage.pagesRead.length, true, coverage);
    result.sourcedFromOpenWeb = sourcedFromOpenWeb;
    job.result = result;
    job.complete = true;
    job.signalFirstSnapshot();

    // A result with no CFP/committee/speaker/sponsor content found anywhere (primary or secondary
    // pages) gets a much shorter cache lifetime than a genuinely populated one — a transient
    // fetch/parse miss shouldn't stick around for a full 6 hours and keep showing an empty state
    // to every visitor in the meantime.
    const looksEmpty =
      !result.cfpStatus &&
      !result.cfpDeadline &&
      !result.submissionRequirements &&
      !result.submissionUrl &&
      !result.submissionEmail &&
      result.committee.length === 0 &&
      result.speakers.length === 0 &&
      result.sponsors.length === 0;
    extractionCache.set(startUrl, {
      data: result,
      expiresAt: Date.now() + (looksEmpty ? 15 * 60 * 1000 : EXTRACTION_CACHE_TTL_MS),
    });
  }

  // Starts the crawl if it isn't already running, and hands back the job so a caller can wait for
  // its first usable snapshot. One job per URL, so two people opening the same conference at once
  // share a single crawl rather than each firing their own at the site.
  async function getOrStartCrawlJob(cacheKey: string, titleHint: string): Promise<CrawlJob | null> {
    const running = crawlJobs.get(cacheKey);
    if (running) return running;

    const ai = getAIClient();
    if (!ai) return null;

    let signalFirstSnapshot = () => {};
    const firstSnapshot = new Promise<void>((resolve) => {
      signalFirstSnapshot = resolve;
    });
    const job: CrawlJob = {
      result: null,
      complete: false,
      startedAt: Date.now(),
      firstSnapshot,
      signalFirstSnapshot,
    };
    crawlJobs.set(cacheKey, job);

    runSiteCrawl(ai, cacheKey, titleHint, job)
      .catch((error) => {
        console.error("Conference crawl failed:", error);
        // Whatever was gathered before the failure is still real and still worth showing; only a
        // crawl that failed before its first page has nothing to report.
        job.complete = true;
        if (!job.result) job.result = { extracted: false, isFallback: false, fetchFailed: true, crawlComplete: true };
        else job.result = { ...job.result, crawlComplete: true };
        job.signalFirstSnapshot();
      })
      .finally(() => {
        // Held briefly after completion so a status poll arriving right at the end still finds the
        // finished result, then dropped so the next visitor re-reads from the extraction cache.
        setTimeout(() => crawlJobs.delete(cacheKey), 60000);
      });

    return job;
  }

  app.post("/api/ai/extract-conference", async (req, res) => {
    try {
      const { url, title } = req.body;
      if (typeof url !== "string" || !url.trim()) {
        return res.status(400).json({ error: "url is required" });
      }

      const cacheKey = url.trim();
      const titleHint = typeof title === "string" ? title : "";
      const cached = extractionCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return res.json(cached.data);
      }

      if (!(await isSafeExternalUrl(cacheKey))) {
        return res.status(400).json({ error: "That URL cannot be fetched." });
      }

      const job = await getOrStartCrawlJob(cacheKey, titleHint);
      if (!job) return res.json({ extracted: false, isFallback: true });

      // Answer as soon as there's something worth rendering rather than holding the request open
      // for the whole site. If the first round is slow, the client still gets a response and picks
      // the rest up by polling.
      await Promise.race([job.firstSnapshot, new Promise((r) => setTimeout(r, FIRST_RESPONSE_DEADLINE_MS))]);
      res.json(job.result ?? { extracted: false, isFallback: false, crawlComplete: false, crawlPending: true });
    } catch (error: any) {
      console.error("Conference extraction error:", error);
      res.status(500).json({ error: error.message || "Extraction failed. Please try again." });
    }
  });

  // Polled by the client while a crawl is still reading the rest of the site, so the tabs fill in
  // as more pages are read instead of the reader being stuck with whatever the first round found.
  app.get("/api/ai/extract-conference/status", async (req, res) => {
    const url = typeof req.query.url === "string" ? req.query.url.trim() : "";
    if (!url) return res.status(400).json({ error: "url is required" });

    const cached = extractionCache.get(url);
    if (cached && cached.expiresAt > Date.now()) return res.json(cached.data);

    const job = crawlJobs.get(url);
    if (!job) return res.json({ crawlComplete: true, crawlUnknown: true });
    if (!job.result) return res.json({ crawlComplete: false, crawlPending: true });
    res.json(job.result);
  });

  // Vite middleware for dev or static server for production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Catches errors forwarded by asyncHandler-wrapped routes (e.g. an unexpected database
  // error) so the one failing request gets a 500 response instead of crashing the whole
  // process for every connected user via an unhandled promise rejection.
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("Unhandled request error:", err);
    if (res.headersSent) return;
    res.status(500).json({ error: "Something went wrong. Please try again." });
  });

  const httpServer = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Conference Gate server running at http://localhost:${PORT}`);
    // Which optional capabilities are actually active on this host. Every one of these degrades
    // silently when its key or binary is missing, which is the right behaviour but leaves an
    // operator with no way to tell a deliberate omission from a setting that didn't take. One
    // line at boot answers that without having to reproduce a failure first.
    const capability = (name: string, on: boolean, hint: string) =>
      `  ${on ? "on " : "OFF"}  ${name}${on ? "" : ` — ${hint}`}`;
    console.log(
      [
        "Extraction capabilities:",
        capability("AI extraction", Boolean(process.env.GEMINI_API_KEY), "set GEMINI_API_KEY"),
        capability("Live web search", Boolean(process.env.BRAVE_SEARCH_API_KEY), "set BRAVE_SEARCH_API_KEY"),
        capability(
          "Firecrawl (reads blocked / JavaScript-rendered sites)",
          isFirecrawlConfigured(),
          "set FIRECRAWL_API_KEY"
        ),
      ].join("\n")
    );
  });

  // The extraction fallback keeps one Chromium alive between requests. Without this it would
  // outlive the process that started it and leak on every restart.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      closeBrowser().finally(() => process.exit(0));
    });
  }

  // Real-time message delivery: authenticate the WebSocket handshake using the
  // same session cookie as the HTTP API, then register the socket for pushes.
  const wss = new WebSocketServer({ server: httpServer, path: "/ws/messages" });
  wss.on("connection", (socket, request) => {
    const cookieHeader = request.headers.cookie || "";
    const cookies = Object.fromEntries(
      cookieHeader.split(";").map((part) => {
        const idx = part.indexOf("=");
        return idx === -1 ? [part.trim(), ""] : [part.slice(0, idx).trim(), decodeURIComponent(part.slice(idx + 1).trim())];
      })
    );
    const userId = verifySessionToken(cookies[COOKIE_NAME]);
    if (!userId) {
      socket.close(4401, "Not authenticated");
      return;
    }
    registerSocket(userId, socket);
  });
}

startServer();
