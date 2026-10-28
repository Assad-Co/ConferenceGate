import crypto from "node:crypto";
import { Router } from "express";
import { dbAll, dbGet, dbRun } from "./db";
import { COOKIE_NAME, verifySessionToken } from "./auth";
import { isOwnerPreviewEmail } from "./ownerPreview";
import { brandedEmail, createEmailTransport, emailConfiguration, emailFailure } from "./emailTransport";
import { emailQueueDiagnostics, enqueueAlert, initEmailOutbox } from "./intelligenceOutbox";

export const intelligenceEmailRouter = Router();
export async function initIntelligenceEmailSchema() {
  await dbRun("CREATE TABLE IF NOT EXISTS intelligence_email_preferences (user_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)");
  await dbRun("CREATE TABLE IF NOT EXISTS intelligence_email_deliveries (user_id TEXT NOT NULL, alert_id TEXT NOT NULL, delivered_at TEXT, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id,alert_id))");
  await dbRun("CREATE TABLE IF NOT EXISTS intelligence_email_tests (user_id TEXT PRIMARY KEY, last_attempt_at INTEGER NOT NULL, status TEXT NOT NULL)");
  await dbRun("CREATE TABLE IF NOT EXISTS intelligence_email_test_records (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,provider_message_id TEXT,error_code TEXT)");
  await initEmailOutbox();
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
intelligenceEmailRouter.get("/email-tests", async (req,res) => {
  try {
    const user = await authUser(req);
    if (!user) return res.status(401).json({error:"Authentication required"});
    const records = await dbAll("SELECT id,status,created_at,updated_at,error_code FROM intelligence_email_test_records WHERE user_id=? ORDER BY created_at DESC LIMIT 10",[user.id]);
    return res.json({recipient:user.email,records});
  } catch { return res.status(500).json({error:"Unable to load email tests"}); }
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
export function emailTestOriginAllowed(origin: string | undefined, expected = process.env.PUBLIC_BASE_URL || "https://conferencegate.com") {
  const normalized = expected.replace(/[/]$/, "");
  const allowed = new Set([normalized]);
  if (["https://conferencegate.com", "https://www.conferencegate.com"].includes(normalized)) {
    allowed.add("https://conferencegate.com"); allowed.add("https://www.conferencegate.com");
  }
  return Boolean(origin && allowed.has(origin));
}
export async function claimEmailTest(userId: string, now = Date.now()) {
  return dbGet<{last_attempt_at:number}>("INSERT INTO intelligence_email_tests (user_id,last_attempt_at,status) VALUES (?,?,'sending') ON CONFLICT(user_id) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,status='sending' WHERE intelligence_email_tests.last_attempt_at < ? OR (intelligence_email_tests.status='failed' AND intelligence_email_tests.last_attempt_at < ?) RETURNING last_attempt_at", [userId,now,now-600000,now-30000]);
}
// Authenticated same-origin SMTP smoke test. Sends only to the signed-in account email.
intelligenceEmailRouter.post("/test-email", async (req,res) => {
  try {
    const user = await authUser(req);
    if (!user) return res.status(401).json({error:"Authentication required"});
    if (!emailTestOriginAllowed(req.get("origin"))) return res.status(403).json({error:"Invalid request origin"});
    if (!deliveryConfigured()) return res.status(503).json({error:"Email delivery is not configured"});
    const now = Date.now();
    // Confirmed rejection gets a short anti-abuse delay; accepted/ambiguous attempts keep ten minutes.
    const claim = await claimEmailTest(user.id,now);
    if (!claim) return res.status(429).json({error:"A test email was requested recently. Try again in ten minutes."});
    const requestId = crypto.randomUUID();
    await dbRun("INSERT INTO intelligence_email_test_records (id,user_id,status,created_at,updated_at) VALUES (?,?,'submitted',?,?)", [requestId,user.id,now,now]);
    const transport = createEmailTransport();
    try {
      const text = "This is a test of ConferenceGate Smart Alerts email delivery. No conference alert rule was changed.\n\nRequest ID: " + requestId;
      const info = await transport.sendMail({from:process.env.INTELLIGENCE_EMAIL_FROM!,to:user.email,subject:"ConferenceGate: test email",text,html:brandedEmail("Email delivery test",text),messageId:`<${requestId}@conferencegate.com>`});
      if (!info.accepted?.some((address: string) => address.toLowerCase() === user.email.toLowerCase())) throw Object.assign(new Error("Recipient rejected"), {code:"EENVELOPE",responseCode:550});
      await dbRun("UPDATE intelligence_email_tests SET status='sent' WHERE user_id=? AND last_attempt_at=?", [user.id,now]);
      await dbRun("UPDATE intelligence_email_test_records SET status='accepted',provider_message_id=?,updated_at=? WHERE id=?", [info.messageId || null,Date.now(),requestId]);
      return res.json({sent:true,status:"accepted",requestId,recipient:user.email,message:"SMTP accepted the test for " + user.email + ". Inbox receipt is not confirmed. Check Inbox and Spam. Request: " + requestId});
    } catch (error) {
      const failure = emailFailure(error);
      const status = failure.uncertain ? "uncertain" : "failed";
      await dbRun("UPDATE intelligence_email_tests SET status=? WHERE user_id=? AND last_attempt_at=?", [status,user.id,now]);
      await dbRun("UPDATE intelligence_email_test_records SET status=?,error_code=?,updated_at=? WHERE id=?", [status,failure.code,Date.now(),requestId]);
      console.warn("[intelligence-email] test",JSON.stringify({requestId,status,code:failure.code}));
      return res.status(502).json({status,requestId,error: status === "uncertain" ? "SMTP outcome is uncertain. Check your inbox before retrying. Request: " + requestId : "SMTP rejected the test. Retry after 30 seconds. Request: " + requestId});
    } finally { transport.close(); }
  } catch (error) {
    console.warn("[intelligence-email] test request failed");
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
  return emailConfiguration().ready;
}
export async function deliverIntelligenceEmail(userId: string, alert: {id:string;title:string;result:{title:string;link:string}}) {
  if (!deliveryConfigured()) return false;
  const user = await dbGet<{email:string;enabled:number}>("SELECT u.email,p.enabled FROM users u JOIN intelligence_email_preferences p ON p.user_id=u.id WHERE u.id=?", [userId]);
  if (!user || user.enabled!==1) return false;
  const base=(process.env.PUBLIC_BASE_URL||"https://conferencegate.com").replace(/\/$/,"");
  const unsub=base+"/api/intelligence/unsubscribe/"+encodeURIComponent(userId)+"/"+tokenFor(userId);
  await enqueueAlert(userId, alert.id, alert.title, alert.title+"\n"+alert.result.title+"\n"+alert.result.link, unsub);
  return true;
}

intelligenceEmailRouter.get("/email-diagnostics", async (req,res) => {
  try {
    const user = await authUser(req);
    if (!user) return res.status(401).json({error:"Authentication required"});
    if (!isOwnerPreviewEmail(user.email)) return res.status(403).json({error:"Administrator access required"});
    const tests = await dbAll("SELECT id,status,created_at,updated_at,provider_message_id,error_code FROM intelligence_email_test_records ORDER BY created_at DESC LIMIT 30");
    return res.json({configuration:emailConfiguration(), backgroundDiscoveryEnabled:process.env.INTELLIGENCE_BACKGROUND_ALERTS === "enabled",queue:await emailQueueDiagnostics(), tests,
      evidence:"Accepted means SMTP handoff only. Provider delivery events and inbox receipt are not verified by this dashboard."});
  } catch { return res.status(500).json({error:"Unable to load email diagnostics"}); }
});
