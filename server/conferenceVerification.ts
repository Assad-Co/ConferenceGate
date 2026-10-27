import { Router } from 'express';
import { dbAll, dbRun } from './db';
import crypto from 'node:crypto';
import { verifySessionToken, COOKIE_NAME } from './auth';
import { dbGet } from './db';

export const conferenceVerificationRouter = Router();
async function authorizedCurator(req: import('express').Request): Promise<boolean> {
 const userId = verifySessionToken(req.cookies?.[COOKIE_NAME]);
 if (!userId) return false;
 const user = await dbGet<{email:string}>('SELECT email FROM users WHERE id=?',[userId]);
 const allowed = (process.env.CONFERENCE_VERIFICATION_REVIEWERS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
 return !!user && allowed.includes(user.email.toLowerCase());
}
export async function initConferenceVerificationSchema() {
 await dbRun("CREATE TABLE IF NOT EXISTS conference_verification_evidence (id TEXT PRIMARY KEY, conference_url TEXT NOT NULL, official_source_url TEXT NOT NULL, claimed_title TEXT NOT NULL, observed_title TEXT NOT NULL, source_excerpt TEXT NOT NULL, checked_at TEXT NOT NULL, expires_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('corroborated','needs_review','approved')), evidence_hash TEXT NOT NULL, submitted_by TEXT, approved_by TEXT)");
 await dbRun('CREATE INDEX IF NOT EXISTS idx_conf_verification_url ON conference_verification_evidence(conference_url,checked_at)');
}
const publicUrl = (raw: string): URL | null => {
 try {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hostname.length > 253) return null;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') ||
      /^\d+(\.\d+){3}$/.test(host) || host.includes(':')) return null;
  return url;
 } catch { return null; }
};
export function titleCorroborated(claimed: string, observed: string): boolean {
 const words = (value: string) => [...new Set(value.toLowerCase().match(/[a-z0-9]{4,}/g) || [])]
  .filter(word => !['conference','international','annual','meeting','2026','2027','2028','2029'].includes(word));
 const claimedWords = words(claimed);
 const found = new Set(words(observed));
 return claimedWords.length >= 2 && claimedWords.filter(word => found.has(word)).length / claimedWords.length >= 0.75;
}
conferenceVerificationRouter.get('/evidence', async (req, res) => {
 await initConferenceVerificationSchema();
 const conferenceUrl = String(req.query.url || '').slice(0, 800);
 if (!publicUrl(conferenceUrl)) { res.status(400).json({ error: 'Valid HTTPS conference URL required' }); return; }
 try {
  const rows = await dbAll<{official_source_url:string;claimed_title:string;observed_title:string;source_excerpt:string;checked_at:string;expires_at:string;status:string}>(
   'SELECT official_source_url,claimed_title,observed_title,source_excerpt,checked_at,expires_at,status FROM conference_verification_evidence WHERE conference_url=? ORDER BY checked_at DESC LIMIT 5',
   [conferenceUrl]
  );
  const fresh = rows.filter(row => row.status === 'approved' && Date.parse(row.expires_at) > Date.now());
  res.setHeader('Cache-Control', 'no-store');
  res.json({ verified: fresh.length > 0, evidence: rows, meaning: 'Source corroboration only; not an endorsement of event quality or organizer legitimacy.' });
 } catch { res.status(503).json({ error: 'Verification evidence temporarily unavailable' }); }
});
export async function recordConferenceVerification(input: {
 conferenceUrl:string; officialSourceUrl:string; claimedTitle:string; observedTitle:string; sourceExcerpt:string; submittedBy?:string;
}) {
 await initConferenceVerificationSchema();
 const event = publicUrl(input.conferenceUrl), source = publicUrl(input.officialSourceUrl);
 if (!event || !source || input.claimedTitle.length > 300 || input.observedTitle.length > 300 ||
     !input.sourceExcerpt.trim() || input.sourceExcerpt.length > 2000) throw new Error('Invalid verification evidence');
 const status = titleCorroborated(input.claimedTitle, input.observedTitle) ? 'corroborated' : 'needs_review';
 const checked = new Date();
 const expires = new Date(checked.getTime() + 30 * 86400000);
 const evidenceId = crypto.randomUUID();
 const hash = crypto.createHash('sha256').update([input.conferenceUrl,input.officialSourceUrl,input.observedTitle,input.sourceExcerpt].join('|')).digest('hex');
 await dbRun('INSERT INTO conference_verification_evidence (id,conference_url,official_source_url,claimed_title,observed_title,source_excerpt,checked_at,expires_at,status,evidence_hash,submitted_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  [evidenceId,input.conferenceUrl,input.officialSourceUrl,input.claimedTitle,input.observedTitle,input.sourceExcerpt,checked.toISOString(),expires.toISOString(),status,hash,input.submittedBy || null]);
 return { id: evidenceId, status, expiresAt: expires.toISOString() };
}

conferenceVerificationRouter.post('/submit-evidence', async (req, res) => {
 if (!(await authorizedCurator(req))) { res.status(403).json({ error: 'Reviewer authorization required' }); return; }
 const input = req.body || {};
 if (['conferenceUrl','officialSourceUrl','claimedTitle','observedTitle','sourceExcerpt'].some(key => typeof input[key] !== 'string')) {
  res.status(400).json({error:'Evidence fields required'}); return;
 }
 try {
  const userId = verifySessionToken(req.cookies?.[COOKIE_NAME]);
  const result = await recordConferenceVerification({ ...input, submittedBy: userId || undefined });
  res.status(201).json({ ...result, approval: 'pending_review' });
 } catch { res.status(400).json({error:'Invalid evidence submission'}); }
});
conferenceVerificationRouter.post('/approve', async (req, res) => {
 if (!(await authorizedCurator(req))) { res.status(403).json({error:'Reviewer authorization required'}); return; }
 await initConferenceVerificationSchema();
 const id = req.body?.id;
 if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) { res.status(400).json({error:'Valid evidence ID required'}); return; }
 const evidence = await dbGet<{status:string;expires_at:string;submitted_by:string|null}>('SELECT status,expires_at,submitted_by FROM conference_verification_evidence WHERE id=?',[id]);
 if (!evidence || evidence.status !== 'corroborated' || evidence.submitted_by === verifySessionToken(req.cookies?.[COOKIE_NAME]) || Date.parse(evidence.expires_at) <= Date.now()) {
  res.status(409).json({error:'Evidence cannot be approved'}); return;
 }
 await dbRun("UPDATE conference_verification_evidence SET status='approved' WHERE id=?",[id]);
 res.json({approved:true,id});
});
