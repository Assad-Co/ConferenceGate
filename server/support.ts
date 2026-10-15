import { Router, Response } from "express";
import crypto from "crypto";
import { dbRun } from "./db";
import { AuthedRequest, requireAuth } from "./auth";
import { asyncHandler } from "./asyncHandler";

export const supportRouter = Router();
supportRouter.use(requireAuth);

export async function initSupportSchema() {
  await dbRun(`CREATE TABLE IF NOT EXISTS support_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT,
    email TEXT NOT NULL,
    topic TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_support_requests_user_created
    ON support_requests(user_id, created_at DESC)`);
}

supportRouter.post("/requests", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 160) : "";
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase().slice(0, 320) : "";
  const topic = typeof req.body?.topic === "string" ? req.body.topic.trim().slice(0, 160) : "General question";
  const message = typeof req.body?.message === "string" ? req.body.message.trim().slice(0, 8000) : "";
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "A valid email is required." });
  if (!message) return res.status(400).json({ error: "Please enter your message." });

  const id = `support_${crypto.randomUUID()}`;
  await dbRun(
    `INSERT INTO support_requests(id,user_id,name,email,topic,message) VALUES(?,?,?,?,?,?)`,
    [id, req.userId!, name || null, email, topic || "General question", message]
  );
  res.status(201).json({ id, status: "open" });
}));
