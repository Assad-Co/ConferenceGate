import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { Router } from "express";
import { dbGet, dbRun } from "./db";
import { COOKIE_NAME, verifySessionToken } from "./auth";

export const intelligenceEmailRouter = Router();
export async function initIntelligenceEmailSchema() {
  await dbRun("CREATE TABLE IF NOT EXISTS intelligence_email_preferences (user_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)");
  await dbRun("CREATE TABLE IF NOT EXISTS intelligence_email_deliveries (user_id TEXT NOT NULL, alert_id TEXT NOT NULL, delivered_at TEXT, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id,alert_id))");
  await dbRun("CREATE TABLE IF NOT EXISTS intelligence_email_tests (user_id TEXT PRIMARY KEY, last_attempt_at INTEGER NOT NULL, status TEXT NOT NULL)");
}
function tokenFor(userId: string) {
  const key = process.env.INTELLIGENCE_UNSUBSCRIBE_SECRET;
  if (!key || key.length < 32) throw new Error("Unsubscribe secret not configured");
  return crypto.createHmac("sha256", key).update(userId).digest("hex");
}
function safeToken(userId: string, supplied: string) {
  if (!/^[a-f0-9]{64}$/.test(supplied)) return false;
  const expected = tokenFor(userId);
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(supplied, "hex"));
}
async function authUser(req: import("express").Request) {
  const id = verifySessionToken(req.cookies?.[COOKIE_NAME]);
  if (!id) return null;
  return dbGet<{id: string; email: string}>("SELECT id,email FROM users WHERE id=?", [id]);
}
intelligenceEmailRouter.get("/email-preferences", async (req,res) => {
  try {
    const user = await authUser(req);
    if (!user) return res.status(401).json({error:"Authentication required"});
    const row = await dbGet<{enabled: number}>("SELECT enabled FROM intelligence_email_preferences WHERE user_id=?", [user.id]);
    return res.json({enabled:row?.enabled===1, deliveryConfigured: deliveryConfigured()});
  } catch { return res.status(500).json({error:"Unable to load preferences"}); }
});
intelligenceEmailRouter.put("/email-preferences", async (req,res) => {
  try {
    const user = await authUser(req);
    if (!user) return res.status(401).json({error:"Authentication required"});
    if (typeof req.body?.enabled !== "boolean") return res.status(400).json({error:"enabled must be boolean"});
    const enabled = req.body.enabled ? 1 : 0;
    await dbRun("INSERT INTO intelligence_email_preferences (user_id,enabled,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at", [user.id,enabled,new Date().toISOString()]);
    return res.json({enabled:enabled===1});
  } catch { return res.status(500).json({error:"Unable to update preferences"}); }
});
// Authenticated same-origin SMTP smoke test. Sends only to the signed-in account email.
intelligenceEmailRouter.post("/test-email", async (req,res) => {
  try {
    const user = await authUser(req);
    if (!user) return res.status(401).json({error:"Authentication required"});
    const origin = req.get("origin");
    const expected = (process.env.PUBLIC_BASE_URL || "https://conferencegate.com").replace(/[/]$/, "");
    if (!origin || origin !== expected) return res.status(403).json({error:"Invalid request origin"});
    if (!deliveryConfigured()) return res.status(503).json({error:"Email delivery is not configured"});
    const now = Date.now();
    // Atomic per-account ten-minute cooldown across processes and devices, including failures.
    const claim = await dbGet<{last_attempt_at:number}>("INSERT INTO intelligence_email_tests (user_id,last_attempt_at,status) VALUES (?,?,'sending') ON CONFLICT(user_id) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,status='sending' WHERE intelligence_email_tests.last_attempt_at < ? RETURNING last_attempt_at", [user.id,now,now-600000]);
    if (!claim) return res.status(429).json({error:"A test email was requested recently. Try again in ten minutes."});
    const port = Number(process.env.SMTP_PORT || 587);
    const transport = nodemailer.createTransport({host:process.env.SMTP_HOST!,port,secure:port===465,requireTLS:port!==465,auth:{user:process.env.SMTP_USER!,pass:process.env.SMTP_PASSWORD!}});
    try {
      await transport.sendMail({from:process.env.INTELLIGENCE_EMAIL_FROM!,to:user.email,subject:"ConferenceGate: test email",text:"This is a test of ConferenceGate Smart Alerts email delivery. No conference alert rule was changed."});
      await dbRun("UPDATE intelligence_email_tests SET status='sent' WHERE user_id=? AND last_attempt_at=?", [user.id,now]);
      return res.json({sent:true,message:"Test email accepted by SMTP. Check your inbox and Spam folder."});
    } catch (error) {
      await dbRun("UPDATE intelligence_email_tests SET status='failed' WHERE user_id=? AND last_attempt_at=?", [user.id,now]);
      console.warn("[intelligence-email] test delivery failed", error instanceof Error ? error.message : "unknown");
      return res.status(502).json({error:"Test email could not be sent"});
    } finally { transport.close(); }
  } catch (error) {
    console.warn("[intelligence-email] test request failed",error instanceof Error ? error.message : "unknown");
    return res.status(500).json({error:"Unable to process test email"});
  }
});
// GET shows a confirmation page; POST performs the unsubscribe (including RFC 8058 one-click).
intelligenceEmailRouter.get("/unsubscribe/:userId/:token", async (req,res) => {
  try {
    if (!safeToken(req.params.userId,req.params.token)) return res.status(403).send("Invalid unsubscribe link");
    res.type("html").send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title></head><body><main><h1>ConferenceGate alerts</h1><p>Stop conference alert emails?</p><form method="POST"><button type="submit">Unsubscribe</button></form></main></body></html>');
  } catch { res.status(503).send("Unsubscribe unavailable"); }
});
// One-click unsubscribe; the signed token cannot be guessed or used to subscribe.
intelligenceEmailRouter.post("/unsubscribe/:userId/:token", async (req,res) => {
  try {
    if (!safeToken(req.params.userId, req.params.token)) return res.status(403).json({error:"Invalid unsubscribe token"});
    await dbRun("UPDATE intelligence_email_preferences SET enabled=0,updated_at=? WHERE user_id=?", [new Date().toISOString(),req.params.userId]);
    return res.json({unsubscribed:true});
  } catch { return res.status(503).json({error:"Unsubscribe unavailable"}); }
});
export function deliveryConfigured() {
  return process.env.INTELLIGENCE_EMAIL_NOTIFICATIONS === "enabled" &&
    Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD &&
      process.env.INTELLIGENCE_EMAIL_FROM && process.env.INTELLIGENCE_UNSUBSCRIBE_SECRET &&
      process.env.INTELLIGENCE_UNSUBSCRIBE_SECRET.length >= 32);
}
export async function deliverIntelligenceEmail(userId: string, alert: {id:string;title:string;result:{title:string;link:string}}) {
  if (!deliveryConfigured()) return false;
  const user = await dbGet<{email:string;enabled:number}>("SELECT u.email,p.enabled FROM users u JOIN intelligence_email_preferences p ON p.user_id=u.id WHERE u.id=?", [userId]);
  if (!user || user.enabled!==1) return false;
  const claimed = await dbRun("INSERT OR IGNORE INTO intelligence_email_deliveries (user_id,alert_id,status,attempts) VALUES (?,?,'pending',0)", [userId,alert.id]);
  const row = await dbGet<{status:string;attempts:number}>("SELECT status,attempts FROM intelligence_email_deliveries WHERE user_id=? AND alert_id=?", [userId,alert.id]);
  if (!row || row.status==="sent" || row.attempts>=3) return false;
  const claimedAttempt = await dbRun("UPDATE intelligence_email_deliveries SET status='sending',attempts=attempts+1 WHERE user_id=? AND alert_id=? AND status IN ('pending','failed')", [userId,alert.id]);
  const sending = await dbGet<{status:string}>("SELECT status FROM intelligence_email_deliveries WHERE user_id=? AND alert_id=?", [userId,alert.id]);
  if (sending?.status!=="sending") return false;
  const host=process.env.SMTP_HOST!, port=Number(process.env.SMTP_PORT||587);
  const transport=nodemailer.createTransport({host,port,secure:port===465,requireTLS:port!==465,auth:{user:process.env.SMTP_USER!,pass:process.env.SMTP_PASSWORD!}});
  const base=(process.env.PUBLIC_BASE_URL||"https://conferencegate.com").replace(/\/$/,"");
  const unsub=base+"/api/intelligence/unsubscribe/"+encodeURIComponent(userId)+"/"+tokenFor(userId);
  try {
    await transport.sendMail({from:process.env.INTELLIGENCE_EMAIL_FROM!,to:user.email,subject:"ConferenceGate: new conference alert",text:alert.title+"\n"+alert.result.title+"\n"+alert.result.link+"\n\nUnsubscribe (POST): "+unsub,headers:{"List-Unsubscribe":"<"+unsub+">","List-Unsubscribe-Post":"List-Unsubscribe=One-Click"}});
    await dbRun("UPDATE intelligence_email_deliveries SET status='sent',delivered_at=? WHERE user_id=? AND alert_id=?", [new Date().toISOString(),userId,alert.id]);
    return true;
  } catch (error) {
    await dbRun("UPDATE intelligence_email_deliveries SET status='failed' WHERE user_id=? AND alert_id=?", [userId,alert.id]);
    console.warn("[intelligence-email] delivery failed",error instanceof Error?error.message:"unknown");
    return false;
  } finally { transport.close(); }
}
