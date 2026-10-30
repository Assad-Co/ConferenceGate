import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { activityRouter } from "../activity";
import { initDb, dbGet, dbRun, closeDb } from "../db";
import { initAuthSecret, initSessionVersions } from "../auth";

test("authenticated draft download and saved feedback survive unavailable email", async () => {
  assert.equal(process.env.NODE_ENV, "test");
  process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
  delete process.env.SMTP_HOST;
  await initDb(); await initAuthSecret(); await initSessionVersions();
  const id = "feedback-" + crypto.randomUUID();
  await dbRun("INSERT INTO users(id,email,role,name,organization) VALUES(?,?,?,?,?)", [id, "fixture@example.invalid", "professional", "Authenticated Participant", "Example Company"]);
  const token = jwt.sign({ sub: id, sv: 0 }, process.env.JWT_SECRET);
  const app = express(); app.use(express.json()); app.use(cookieParser()); app.use("/activity", activityRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/activity`;
  const payload = { conferenceTitle: "Integration Test Conference", role: "Moderator", ratings: { event_1: 6 }, recipientEmail: "third-party@example.invalid", participantName: "Forged Name" };
  const post = (route: string, body: any, authenticated = true) => fetch(base + route, { method: "POST", headers: { "content-type": "application/json", ...(authenticated ? { cookie: `cg_session=${token}` } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await post("/feedback/pdf", payload, false)).status, 401);
    assert.equal((await post("/feedback/pdf", { ...payload, ratings: {} })).status, 400);
    const draft = await post("/feedback/pdf", payload);
    assert.equal(draft.status, 200);
    assert.equal(draft.headers.get("content-type"), "application/pdf");
    assert.equal(draft.headers.get("cache-control"), "no-store");
    const pdf = Buffer.from(await draft.arrayBuffer()).toString("latin1");
    assert.match(pdf, /Authenticated Participant/); assert.doesNotMatch(pdf, /Forged Name/);
    assert.equal(Number((await dbGet<any>("SELECT COUNT(*) AS count FROM conference_feedback WHERE user_id=?", [id])).count), 0);
    const saved = await post("/feedback", { ...payload, emailCopy: true });
    assert.equal(saved.status, 201);
    assert.equal((await saved.json()).emailCopyStatus, "unavailable");
    assert.equal((await dbGet<any>("SELECT conference_title FROM conference_feedback WHERE user_id=?", [id])).conference_title, payload.conferenceTitle);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); closeDb(); }
});
