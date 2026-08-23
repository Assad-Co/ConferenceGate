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

  // AI Abstract Quality Check
  app.post("/api/ai/abstract-check", async (req, res) => {
    try {
      const { title, abstractText, topic } = req.body;
      const ai = getAIClient();

      if (!ai) {
        // GEMINI_API_KEY is not configured — flagged so the client shows generic
        // guidance rather than presenting a fabricated per-abstract score as real.
        return res.json({ isFallback: true });
      }

      const prompt = `Perform a scientific/technical quality pre-screening check for this abstract submission:
Title: ${title}
Topic: ${topic}
Text: ${abstractText}

Provide constructive feedback in JSON format with fields:
- score (number 0-100)
- clarity (string assessment)
- suggestedTracks (array of string track names)
- improvements (array of 2 short actionable suggestions)`;

      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
        },
      });

      let result = {};
      try {
        result = JSON.parse(response.text || "{}");
      } catch (e) {
        console.error("Failed to parse abstract check JSON", e);
      }

      res.json(result);
    } catch (error: any) {
      console.error("AI Abstract Check error:", error);
      res.status(500).json({ error: error.message });
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
