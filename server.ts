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
  // a false negative means the author's real submission requirements never get found at all.
  const CFP_LINK_TEXT_RE =
    /\b(call for (papers|abstracts)|cfp|submission|submit|abstract|author guidelines|author information|guidelines|instructions for authors|presenters)\b/i;
  const COMMITTEE_LINK_TEXT_RE =
    /\b(committee|organi[sz]ing|scientific (board|committee)|program committee|chairs|advisory board|editorial board|review(ers)?\s*panel)\b/i;

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

For submissionRequirements, look specifically for what authors are told about how to prepare their submission — format (PDF, Word), page or word limits, citation style, blind-review requirements, or template to use — and summarize only what's explicitly stated in a sentence or two. For submissionTemplateUrl, only use a URL that literally appears via a [LINK: ...] marker in the page text; never guess a URL from context.

For submissionEmail, only fill this in if the page explicitly names an email address as where to SEND a submission/abstract/paper to (e.g. "email your abstract to chair@conference.org"). Never use a generic contact/info email for this — leave it null unless the text specifically ties that address to submitting a paper.

For committee, include anyone credited with organizing, chairing, or running the conference — this covers people labeled "Organizers", "Chairs", "Program Committee", "Organizing Committee", "Scientific Committee", or "Advisory Board", not only people appearing under a heading that literally says "Committee". A plain list like "Organizers: Jane Doe, John Smith" counts — include each name with role set to "Organizer" (or whatever the page actually calls them) and org/title only if separately stated.

For sponsors, include every organization named as sponsoring, funding, or supporting the conference — this includes a plain sentence like "Sponsored by the XYZ Department" or "with support from ABC Foundation", not only entries with a logo image. Use null for tier and logoUrl when the page doesn't state them; never invent a tier ("Gold", "Platinum", etc.) that isn't explicitly written.

For accommodationText and travelText, summarize whatever the page actually says about lodging (hotel names, room blocks, rates) or getting to the venue (transit directions, airport info, parking) in a sentence or two each — these are commonly written as plain paragraphs rather than under a clearly-labeled section, so don't require an explicit "Accommodation" or "Travel" heading to use them.

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
  "travelText": string | null
}`;
  }

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
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ConferenceGateBot/1.0)" },
        redirect: "follow",
        // A slow or unresponsive conference site would otherwise hang this request (and the
        // client's loading spinner) indefinitely — cap it and treat a timeout as a fetch failure.
        signal: AbortSignal.timeout(10000),
      });
      html = await pageRes.text();
    } catch (fetchErr) {
      console.error("Failed to fetch page for extraction:", fetchErr);
      return null;
    }
    // 40,000 characters of actual visible text (not raw HTML) comfortably covers even a long
    // single page with CFP details near the bottom — a tighter cutoff risked truncating the
    // requirements section clean off before the model ever saw it.
    const pageText = prepareHtmlForExtraction(html, pageUrl).slice(0, 40000);
    if (!pageText) return null;

    let parsed: any = {};
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: buildExtractionPrompt(pageText, title, pageUrl),
        config: { responseMimeType: "application/json" },
      });
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
  function isCommitteeMissing(parsed: any): boolean {
    return !Array.isArray(parsed.committee) || parsed.committee.length === 0;
  }

  // Fills in only the fields the primary page's extraction came up empty for — real data already
  // found on the primary page always wins, so a secondary page can only ever add, never overwrite.
  function mergeExtractionResults(primary: any, secondary: any, secondaryUrl: string): any {
    const merged = { ...primary };
    for (const field of ["cfpStatus", "cfpDeadline", "submissionRequirements", "submissionEmail"]) {
      if (!merged[field] && secondary[field]) merged[field] = secondary[field];
    }
    if (!merged.submissionUrl && secondary.submissionUrl) {
      merged.submissionUrl = resolveAbsoluteUrl(secondary.submissionUrl, secondaryUrl);
    }
    if (!merged.submissionTemplateUrl && secondary.submissionTemplateUrl) {
      merged.submissionTemplateUrl = resolveAbsoluteUrl(secondary.submissionTemplateUrl, secondaryUrl);
    }
    for (const field of ["committee", "speakers", "sponsors", "agendaSessions"]) {
      const current = merged[field];
      const incoming = secondary[field];
      if ((!Array.isArray(current) || current.length === 0) && Array.isArray(incoming) && incoming.length > 0) {
        merged[field] = incoming;
      }
    }
    return merged;
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
        const fallback = { extracted: false, isFallback: false, fetchFailed: true };
        extractionCache.set(cacheKey, { data: fallback, expiresAt: Date.now() + EXTRACTION_CACHE_TTL_MS });
        return res.json(fallback);
      }

      let parsed = primary.parsed;

      // A real conference site commonly splits its Call-for-Papers and Committee info onto their
      // own subpages linked from the main page. When the primary page's extraction came up empty
      // for either, look for a same-site link whose visible text names that topic and, if found,
      // fetch and extract that page too — merging in only what the primary page was missing.
      const needsCfp = isCfpMissing(parsed);
      const needsCommittee = isCommitteeMissing(parsed);
      if (needsCfp || needsCommittee) {
        const secondaryUrls = new Set<string>();
        if (needsCfp) {
          // Up to 2 distinct CFP-ish links — a real nav bar sometimes has BOTH a "Call for
          // Papers" link and a separate "Submission Guidelines" link pointing to different pages,
          // and only fetching the first would still miss whichever one actually has the details.
          for (const url of findLinksByText(primary.html, cacheKey, CFP_LINK_TEXT_RE, 2)) {
            secondaryUrls.add(url);
          }
        }
        if (needsCommittee) {
          for (const url of findLinksByText(primary.html, cacheKey, COMMITTEE_LINK_TEXT_RE, 1)) {
            secondaryUrls.add(url);
          }
        }
        // Fetched in parallel rather than one after another — each is an independent page-plus-
        // model-call round trip, and running them concurrently keeps a multi-secondary-page
        // lookup roughly as fast as a single one instead of multiplying the wait.
        const urlsToFetch = Array.from(secondaryUrls).slice(0, 3);
        const secondaryResults = await Promise.allSettled(urlsToFetch.map((url) => extractPage(ai, url, titleHint)));
        secondaryResults.forEach((outcome, i) => {
          if (outcome.status === "fulfilled" && outcome.value) {
            parsed = mergeExtractionResults(parsed, outcome.value.parsed, urlsToFetch[i]);
          } else if (outcome.status === "rejected") {
            console.error("Secondary page extraction failed:", outcome.reason);
          }
        });
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
