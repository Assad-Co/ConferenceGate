import "./server/env";
import express from "express";
import path from "path";
import cookieParser from "cookie-parser";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { WebSocketServer } from "ws";
import { authRouter, verifySessionToken, COOKIE_NAME, initAuthSecret } from "./server/auth";
import { braveSearchRouter } from "./server/braveSearch";
import { activityRouter } from "./server/activity";
import { messagesRouter, registerSocket } from "./server/messages";
import { sponsorsRouter } from "./server/sponsors";
import { postsRouter } from "./server/posts";
import { initDb, dbGet, dbAll, UserRow, SubmissionRow, CreatedConferenceRow, SponsorshipApplicationRow } from "./server/db";
import { isSafeExternalUrl } from "./server/urlSafety";
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
  const SKIP_NAV_TEXT_RE = /\b(privacy|terms|cookie|login|log in|sign in|sign up|home|contact|sitemap|accessibility)\b/i;
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

For submissionEmail, only fill this in if the page explicitly names an email address as where to SEND a submission/abstract/paper to (e.g. "email your abstract to chair@conference.org"). Never use a generic contact/info email for this — leave it null unless the text specifically ties that address to submitting a paper.

For speakers, include anyone credited with giving a talk, keynote, presentation, or featured appearance at the event — this covers people labeled "Speakers", "Keynotes", "Presenters", "Panelists", "Featured Guests", "Invited Guests", or any similar wording the page uses, not only people under a heading that literally says "Speakers". Use the page's own wording for role (e.g. "Keynote Speaker", "Panelist", "Presenter") when it says one, or null if it doesn't.

For agendaSessions, include every scheduled session, talk, panel, workshop, or keynote slot stated on the page no matter what the page itself calls this section — "Program", "Schedule", "Agenda", "Timetable", "Itinerary", "Day 1 / Day 2" listings, and a plain day-by-day list of time blocks are all the same thing and all count. Use the actual session/talk name as the title when one is given; when the page only labels a slot generically (e.g. "Panel Session 1", "Morning Keynote", "Breakfast & Business Meeting") use that generic label as the title rather than leaving the whole entry out — never invent a more specific title than what's actually written. Fill date/time/track/speakerName only when the page states them for that slot; otherwise leave them null.

For committee, include anyone credited with organizing, chairing, or running the conference — this covers people labeled "Organizers", "Chairs", "Program Committee", "Organizing Committee", "Scientific Committee", or "Advisory Board", not only people appearing under a heading that literally says "Committee". A plain list like "Organizers: Jane Doe, John Smith" counts — include each name with role set to "Organizer" (or whatever the page actually calls them) and org/title only if separately stated.

For sponsors, include every organization named as sponsoring, funding, or supporting the conference — this includes a plain sentence like "Sponsored by the XYZ Department" or "with support from ABC Foundation", not only entries with a logo image. Use null for tier and logoUrl when the page doesn't state them; never invent a tier ("Gold", "Platinum", etc.) that isn't explicitly written.

For accommodationText and travelText, summarize whatever the page actually says about lodging (hotel names, room blocks, rates) or getting to the venue (transit directions, airport info, parking) in a sentence or two each — these are commonly written as plain paragraphs rather than under a clearly-labeled section, so don't require an explicit "Accommodation" or "Travel" heading to use them.

Finally, look at every [LINK: url] marker in the page text above and, based on genuinely reading and understanding what each link is about (its visible text and the surrounding sentence) rather than matching a fixed keyword, decide whether it likely leads to a page with MORE detail than what's summarized here about: (a) the Call for Papers or submission process, (b) the organizing/technical/program committee or chairs, (c) speakers, keynotes, presenters, or panelist bios (whatever the page itself calls them), (d) sponsors or exhibitors, (e) the program, agenda, schedule, or timetable (whatever the page itself calls it), (f) venue, accommodation, or travel information, (g) a general "About"/"Overview"/"About the Conference" page describing what the conference itself is about, if this page doesn't already describe that well. Put the single most likely such URL for each category into relevantLinks below, or null if none of the links on this page look relevant to that category — every URL you provide there MUST be copied character-for-character from one of the [LINK: ...] markers in the text above; never invent or guess one.

Page title: "${title}"
Page URL: "${pageUrl}"

Page text:
"""
${pageText}
"""

Return JSON with exactly this shape:
{
  "overviewSummary": string | null,
  "datesText": string | null,
  "locationText": string | null,
  "format": string | null,
  "cfpStatus": string | null,
  "cfpDeadline": string | null,
  "submissionUrl": string | null,
  "submissionRequirements": string | null,
  "submissionTemplateUrl": string | null,
  "submissionEmail": string | null,
  "agendaSessions": [{ "date": string | null, "time": string | null, "title": string, "speakerName": string | null, "speakerImageUrl": string | null, "track": string | null }],
  "speakers": [{ "name": string, "title": string | null, "org": string | null, "role": string | null, "imageUrl": string | null }],
  "committee": [{ "name": string, "title": string | null, "org": string | null, "role": string | null, "imageUrl": string | null }],
  "sponsors": [{ "name": string, "tier": string | null, "logoUrl": string | null }],
  "accommodationText": string | null,
  "travelText": string | null,
  "relevantLinks": {
    "overview": string | null,
    "cfp": string | null,
    "committee": string | null,
    "speakers": string | null,
    "sponsors": string | null,
    "agenda": string | null,
    "venue": string | null
  }
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
  const MODEL_CALL_TIMEOUT_MS = 12000;
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

  // Fetches one page and runs the Gemini extraction prompt against it. Returns null (rather than
  // throwing) on any fetch/safety failure so callers can treat a failed secondary-page fetch as
  // "just skip it" without losing the primary page's already-good result.
  async function extractPage(
    ai: NonNullable<ReturnType<typeof getAIClient>>,
    pageUrl: string,
    title: string
  ): Promise<{ parsed: any; html: string } | null> {
    if (!(await isSafeExternalUrl(pageUrl))) return null;
    let html = "";
    try {
      const pageRes = await fetch(pageUrl, {
        headers: EXTRACTION_FETCH_HEADERS,
        redirect: "follow",
        // A slow or unresponsive conference site would otherwise hang this request (and the
        // client's loading spinner) indefinitely — cap it and treat a timeout as a fetch failure.
        signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
      });
      // An error response still has a body, and without this check that body (a WAF block page,
      // a 404, a proxy's "denied" text) was handed to the model as if it were the conference's
      // own page. The model would dutifully report nulls for everything, and the endpoint would
      // return extracted:true — so a page we never actually read was indistinguishable from a
      // real page that genuinely had no speakers, committee, or agenda on it.
      if (!pageRes.ok) {
        console.error(`Page fetch for extraction returned HTTP ${pageRes.status} for ${pageUrl}`);
        return null;
      }
      // Guards the same confusion for a non-HTML body (a PDF, an image, a JSON API response):
      // tag-stripping binary or JSON produces text-shaped noise the model can only extract nulls
      // from, which would again be reported as a successful read of an empty page.
      const contentType = pageRes.headers.get("content-type") || "";
      if (contentType && !/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
        console.error(`Page fetch for extraction returned non-HTML content-type "${contentType}" for ${pageUrl}`);
        return null;
      }
      html = await pageRes.text();
    } catch (fetchErr) {
      console.error("Failed to fetch page for extraction:", fetchErr);
      return null;
    }
    // 40,000 characters of actual visible text (not raw HTML) comfortably covers even a long
    // single page with CFP details near the bottom — a tighter cutoff risked truncating the
    // requirements section clean off before the model ever saw it.
    const pageText = prepareHtmlForExtraction(html, pageUrl).slice(0, 40000);
    if (pageText.length < MIN_EXTRACTABLE_TEXT_CHARS) {
      console.error(
        `Page for extraction had only ${pageText.length} chars of visible text (likely client-rendered) for ${pageUrl}`
      );
      return null;
    }

    let parsed: any = {};
    try {
      const response = await withTimeout(
        ai.models.generateContent({
          model: "gemini-3.6-flash",
          contents: buildExtractionPrompt(pageText, title, pageUrl),
          config: { responseMimeType: "application/json" },
        }),
        MODEL_CALL_TIMEOUT_MS,
        "Extraction model call"
      );
      parsed = JSON.parse(response.text || "{}");
    } catch (e) {
      console.error("Extraction model call failed:", e);
      return null;
    }
    return { parsed, html };
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

  // Fills in only the fields the primary page's extraction came up empty for — real data already
  // found on the primary page always wins, so a secondary page can only ever add, never overwrite.
  function mergeExtractionResults(primary: any, secondary: any, secondaryUrl: string): any {
    const merged = { ...primary };
    for (const field of [
      "cfpStatus",
      "cfpDeadline",
      "submissionRequirements",
      "submissionEmail",
      "accommodationText",
      "travelText",
      "locationText",
      "datesText",
      "overviewSummary",
    ]) {
      if (!merged[field] && secondary[field]) merged[field] = secondary[field];
    }
    if (!merged.submissionUrl && secondary.submissionUrl) {
      merged.submissionUrl = resolveAbsoluteUrl(secondary.submissionUrl, secondaryUrl);
    }
    if (!merged.submissionTemplateUrl && secondary.submissionTemplateUrl) {
      merged.submissionTemplateUrl = resolveAbsoluteUrl(secondary.submissionTemplateUrl, secondaryUrl);
    }
    // List sections accumulate across pages instead of being all-or-nothing. A homepage almost
    // always carries a teaser — three "featured speakers", a couple of headline sponsors, one
    // day's highlights — and the real roster lives on the dedicated page. Treating a non-empty
    // primary list as "already have it" meant the full page's 40 speakers were fetched, parsed,
    // and then thrown away in favour of the homepage's 3. Union + de-duplicate instead, so each
    // page can only ever add rows, and an entry already known keeps its richer version.
    for (const field of ["committee", "speakers", "sponsors", "agendaSessions"] as const) {
      const current = Array.isArray(merged[field]) ? merged[field] : [];
      const incoming = Array.isArray(secondary[field]) ? secondary[field] : [];
      if (incoming.length === 0) continue;
      merged[field] = unionEntries(field, current, incoming);
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

  // Counts how many fields of an entry actually carry a value — used to keep the richer of two
  // duplicates (the speakers page usually has the org, title, and photo the homepage teaser omits).
  function entryDetailScore(entry: any): number {
    if (!entry || typeof entry !== "object") return 0;
    return Object.values(entry).filter((v) => v !== null && v !== undefined && v !== "").length;
  }

  function unionEntries(field: string, current: any[], incoming: any[]): any[] {
    const byKey = new Map<string, any>();
    const unkeyed: any[] = [];
    for (const entry of [...current, ...incoming]) {
      const key = entryKey(field, entry);
      if (!key) {
        // No usable identity to compare on — kept as-is rather than silently dropped, since a
        // real session or sponsor with an odd shape is still real content.
        unkeyed.push(entry);
        continue;
      }
      const existing = byKey.get(key);
      if (!existing || entryDetailScore(entry) > entryDetailScore(existing)) byKey.set(key, entry);
    }
    return [...byKey.values(), ...unkeyed];
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

      const ai = getAIClient();
      if (!ai) {
        return res.json({ extracted: false, isFallback: true });
      }

      if (!(await isSafeExternalUrl(cacheKey))) {
        return res.status(400).json({ error: "That URL cannot be fetched." });
      }

      const primary = await extractPage(ai, cacheKey, titleHint);
      if (!primary) {
        // Cached only briefly, never for the full 6 hours: a fetch failure is usually transient
        // (a timeout, a rate limit, a momentary block), and pinning that failure in place for a
        // whole afternoon meant one bad moment kept showing an empty page to every later visitor.
        const fallback = { extracted: false, isFallback: false, fetchFailed: true };
        extractionCache.set(cacheKey, { data: fallback, expiresAt: Date.now() + FAILED_FETCH_CACHE_TTL_MS });
        return res.json(fallback);
      }

      let parsed = primary.parsed;

      // A real conference site commonly splits its content across more than one page — and
      // sometimes the page with the actual Committee roster or Program schedule isn't linked
      // directly from the page we started on, but from a page THAT page links to (e.g. the
      // homepage links to "About", and "About" links to "Committee"). So this isn't a single
      // one-hop lookup: it's a bounded breadth-first crawl of the same site, expanding outward
      // one more layer of links each round for as long as something is still missing and the
      // page budget allows, rather than only ever checking the primary page's own links.
      //
      // At each round, every newly-fetched page's own [LINK: ...] markers get the same treatment
      // the primary page got: the model reports which ones it genuinely believes lead to more
      // detail on each still-missing topic (relevantLinks — real language understanding, not
      // keyword matching), and the CFP/Committee keyword regexes run alongside as a free
      // deterministic backstop. Every candidate is validated against that page's own real anchors
      // and kept only if it's on the same site, so the crawl can't wander onto an unrelated domain
      // or trust a hallucinated URL.
      const MAX_CRAWL_DEPTH = 3; // rounds of expansion beyond the primary page
      // A real conference site puts each section behind its own nav entry — Event Information,
      // Sessions, Speakers, Registration, Hotel and Travel, Sponsorship is already six pages
      // before any dropdown children. A six-page ceiling (primary + five) could not physically
      // cover seven categories, so whole sections were guaranteed to come back empty no matter
      // how well the links were found.
      const MAX_TOTAL_PAGES = 16;
      const MAX_PAGES_PER_ROUND = 6; // fetched concurrently, so this bounds one round's wall clock
      // A wall-clock ceiling on the expansion rounds only (the primary page always finishes) —
      // bounds how long a slow or unresponsive site can keep the user's loading spinner up,
      // regardless of how many rounds/pages are still nominally left in the budget above. Checked
      // between rounds rather than pre-empting an in-flight one, so a round already underway still
      // completes and its real results are kept and returned.
      const CRAWL_TIME_BUDGET_MS = 25000;
      const crawlStartedAt = Date.now();

      const visited = new Set<string>([cacheKey]);
      let frontier: Array<{ url: string; html: string; parsed: any }> = [{ url: cacheKey, ...primary }];
      let pagesFetched = 1;

      for (
        let depth = 0;
        depth < MAX_CRAWL_DEPTH && pagesFetched < MAX_TOTAL_PAGES && Date.now() - crawlStartedAt < CRAWL_TIME_BUDGET_MS;
        depth++
      ) {
        // Whether a section is *empty* now only sets crawl priority — it no longer decides
        // whether that section's page gets opened at all. A homepage teaser ("featured
        // speakers", one headline sponsor, day-one highlights) satisfied the old
        // is-it-missing test on the very first page, which is precisely why a site's real
        // Speakers / Agenda / Sponsors pages were never visited and every section stayed as
        // thin as whatever the front page happened to show.
        const emptyByCategory: Record<RelevantLinkCategory, boolean> = {
          overview: isOverviewMissing(parsed),
          cfp: isCfpMissing(parsed),
          committee: isCommitteeMissing(parsed),
          speakers: isSpeakersMissing(parsed),
          sponsors: isSponsorsMissing(parsed),
          agenda: isAgendaMissing(parsed),
          venue: isVenueMissing(parsed),
        };

        // Two tiers, fetched in this order, so a tight page budget always spends itself first on
        // the sections the reader currently has nothing at all for — a dedicated page for an
        // already-partially-filled section is still worth reading, just not ahead of an empty one.
        const urgent: string[] = [];
        const supplementary: string[] = [];
        const proposed = new Set<string>();
        const consider = (url: string, tier: string[]) => {
          if (!url || visited.has(url) || proposed.has(url)) return;
          proposed.add(url);
          tier.push(url);
        };

        for (const page of frontier) {
          const realLinks = extractAllLinks(page.html, page.url);
          const modelLinks = sanitizeRelevantLinks(page.parsed, realLinks, page.url);
          for (const category of RELEVANT_LINK_CATEGORIES) {
            const tier = emptyByCategory[category] ? urgent : supplementary;
            const modelLink = modelLinks[category];
            if (modelLink) consider(modelLink, tier);
            // The model names at most one link per category, but a real nav bar routinely spreads
            // a single topic across several entries — "Sessions" beside "Agenda", "Sponsors"
            // beside "Exhibitors", "Hotel" beside "Travel". Take up to two per category per page
            // so the siblings the model's single pick leaves behind still get read.
            for (const url of findLinksByText(page.html, page.url, CATEGORY_LINK_TEXT_RE[category], 2)) {
              consider(url, tier);
            }
          }
        }

        const candidateUrls = [...urgent, ...supplementary];
        if (candidateUrls.length === 0) {
          // Nothing on this round's pages named any category — try a couple of blind exploratory
          // hops per page in case the real content sits behind a neutral hub page like "About"
          // that these pages didn't themselves flag for anything.
          for (const page of frontier) {
            for (const url of findExploratoryLinks(page.html, page.url, 2)) consider(url, candidateUrls);
          }
        }
        if (candidateUrls.length === 0) break;

        // Fetched in parallel rather than one after another — each is an independent page-plus-
        // model-call round trip, and running them concurrently keeps a multi-page round roughly
        // as fast as a single fetch instead of multiplying the wait. Capped per round as well as
        // in total, so a link-dense nav can't fire a dozen simultaneous requests at one site.
        const remainingBudget = Math.min(MAX_TOTAL_PAGES - pagesFetched, MAX_PAGES_PER_ROUND);
        const urlsToFetch = candidateUrls.slice(0, remainingBudget);
        urlsToFetch.forEach((url) => visited.add(url));
        pagesFetched += urlsToFetch.length;

        const roundResults = await Promise.allSettled(urlsToFetch.map((url) => extractPage(ai, url, titleHint)));
        const nextFrontier: typeof frontier = [];
        roundResults.forEach((outcome, i) => {
          if (outcome.status === "fulfilled" && outcome.value) {
            parsed = mergeExtractionResults(parsed, outcome.value.parsed, urlsToFetch[i]);
            nextFrontier.push({ url: urlsToFetch[i], ...outcome.value });
          } else if (outcome.status === "rejected") {
            console.error("Crawl page extraction failed:", outcome.reason);
          }
        });

        if (nextFrontier.length === 0) break;
        frontier = nextFrontier;
      }

      const result = {
        extracted: true,
        isFallback: false,
        sourceUrl: cacheKey,
        overviewSummary: parsed.overviewSummary || null,
        datesText: parsed.datesText || null,
        locationText: parsed.locationText || null,
        format: parsed.format || null,
        cfpStatus: parsed.cfpStatus || null,
        cfpDeadline: parsed.cfpDeadline || null,
        submissionUrl: resolveAbsoluteUrl(parsed.submissionUrl, cacheKey),
        submissionRequirements: parsed.submissionRequirements || null,
        submissionTemplateUrl: resolveAbsoluteUrl(parsed.submissionTemplateUrl, cacheKey),
        submissionEmail: sanitizeEmail(parsed.submissionEmail),
        agendaSessions: Array.isArray(parsed.agendaSessions) ? parsed.agendaSessions : [],
        speakers: Array.isArray(parsed.speakers) ? parsed.speakers : [],
        committee: Array.isArray(parsed.committee) ? parsed.committee : [],
        sponsors: Array.isArray(parsed.sponsors) ? parsed.sponsors : [],
        accommodationText: parsed.accommodationText || null,
        travelText: parsed.travelText || null,
      };

      // A result with no CFP/committee/speaker/sponsor content found anywhere (primary or
      // secondary pages) gets a much shorter cache lifetime than a genuinely populated one — a
      // transient fetch/parse miss shouldn't stick around for a full 6 hours and keep showing an
      // empty state to every visitor in the meantime.
      const looksEmpty =
        !result.cfpStatus &&
        !result.cfpDeadline &&
        !result.submissionRequirements &&
        !result.submissionUrl &&
        !result.submissionEmail &&
        result.committee.length === 0 &&
        result.speakers.length === 0 &&
        result.sponsors.length === 0;
      const ttl = looksEmpty ? 15 * 60 * 1000 : EXTRACTION_CACHE_TTL_MS;

      extractionCache.set(cacheKey, { data: result, expiresAt: Date.now() + ttl });
      res.json(result);
    } catch (error: any) {
      console.error("Conference extraction error:", error);
      res.status(500).json({ error: error.message || "Extraction failed. Please try again." });
    }
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
  });

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
