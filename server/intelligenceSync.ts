import { Router } from "express";
import { dbGet, dbRun } from "./db";
import { COOKIE_NAME, verifySessionToken } from "./auth";
import { parseState, type IntelligenceState } from "../src/intelligence/engine";

export const intelligenceSyncRouter = Router();
export async function initIntelligenceSyncSchema() {
  await dbRun("CREATE TABLE IF NOT EXISTS professional_intelligence_state (user_id TEXT PRIMARY KEY, state_json TEXT NOT NULL, updated_at TEXT NOT NULL)");
}
async function userId(req: import("express").Request) {
  const id = verifySessionToken(req.cookies?.[COOKIE_NAME]);
  if (!id) return null;
  const user = await dbGet<{ id: string }>("SELECT id FROM users WHERE id = ?", [id]);
  return user ? id : null;
}
intelligenceSyncRouter.get("/state", async (req, res) => {
  try {
    const id = await userId(req);
    if (!id) return res.status(401).json({ error: "Authentication required" });
    const row = await dbGet<{ state_json: string; updated_at: string }>("SELECT state_json, updated_at FROM professional_intelligence_state WHERE user_id = ?", [id]);
    return res.json({ state: row ? JSON.parse(row.state_json) : null, updatedAt: row?.updated_at || null });
  } catch { return res.status(500).json({ error: "Unable to load intelligence state" }); }
});
intelligenceSyncRouter.put("/state", async (req, res) => {
  try {
    const id = await userId(req);
    if (!id) return res.status(401).json({ error: "Authentication required" });
    const raw = JSON.stringify(req.body?.state ?? null);
    if (raw.length > 500000) return res.status(413).json({ error: "State too large" });
    const state: IntelligenceState = parseState(raw);
    const updatedAt = new Date().toISOString();
    await dbRun("INSERT INTO professional_intelligence_state (user_id, state_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at", [id, JSON.stringify(state), updatedAt]);
    return res.json({ ok: true, updatedAt });
  } catch { return res.status(400).json({ error: "Invalid intelligence state" }); }
});
