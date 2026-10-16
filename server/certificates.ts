import { Router } from 'express';
import crypto from 'node:crypto';
import { dbGet, dbRun } from './db';
import { requireAuth, AuthedRequest } from './auth';

export const certificatesRouter = Router();

type IssuedCertificate = {
  id: string; kind: string; activity_id: string; recipient_id: string;
  recipient_name: string; conference_title: string; paper_title: string;
  issued_at: string; revoked_at: string | null;
};

/** Only server-validated activity can produce a public verification record. */
certificatesRouter.post('/issue/abstract/:submissionId', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const submissionId = String(req.params.submissionId || '');
    if (!submissionId || submissionId.length > 200) return res.status(400).json({ error: 'Invalid submission' });
    const row = await dbGet<{
      id: string; submitter_id: string; status: string; is_external: number;
      conference_title: string; title: string; primary_author_name: string;
      recipient_name: string;
    }>(`SELECT s.*, u.name AS recipient_name FROM submissions s
       JOIN users u ON u.id = s.submitter_id WHERE s.id = ? AND s.submitter_id = ?`,
      [submissionId, req.userId!]);
    if (!row) return res.status(404).json({ error: 'Submission not found' });
    if (row.is_external || !['Accepted', 'Accepted for Oral', 'Accepted for Poster'].includes(row.status)) {
      return res.status(409).json({ error: 'Submission is not eligible for a certificate' });
    }
    const existing = await dbGet<IssuedCertificate>(
      "SELECT * FROM issued_certificates WHERE kind = 'abstract' AND activity_id = ? AND recipient_id = ?",
      [row.id, req.userId!]);
    if (existing) {
      if (existing.revoked_at) return res.status(409).json({ error: 'Certificate revoked; contact support' });
      return res.json({ certificate: existing });
    }
    const id = 'CG-AA-' + crypto.randomBytes(16).toString('hex').toUpperCase();
    await dbRun(`INSERT OR IGNORE INTO issued_certificates
      (id, kind, activity_id, recipient_id, recipient_name, conference_title, paper_title)
      VALUES (?, 'abstract', ?, ?, ?, ?, ?)`,
      [id, row.id, req.userId!, row.recipient_name, row.conference_title, row.title]);
    const issued = await dbGet<IssuedCertificate>(
      "SELECT * FROM issued_certificates WHERE kind = 'abstract' AND activity_id = ? AND recipient_id = ?",
      [row.id, req.userId!]);
    return res.status(201).json({ certificate: issued });
  } catch (err) {
    console.error('Certificate issuance failed:', err);
    return res.status(500).json({ error: 'Unable to issue certificate' });
  }
});

/** Issue one certificate per completed, assigned review. */
certificatesRouter.post('/issue/reviewer/:reviewId', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const reviewId = String(req.params.reviewId || '');
    if (!reviewId || reviewId.length > 200) return res.status(400).json({ error: 'Invalid review' });
    const row = await dbGet<{ id: string; reviewer_id: string; reviewer_name: string; conference_title: string; title: string }>(
      `SELECT r.id, r.reviewer_id, u.name AS reviewer_name, s.conference_title, s.title
       FROM submission_reviews r
       JOIN submissions s ON s.id = r.submission_id
       JOIN submission_reviewer_assignments a ON a.submission_id = r.submission_id AND a.reviewer_id = r.reviewer_id
       JOIN users u ON u.id = r.reviewer_id
       WHERE r.id = ? AND r.reviewer_id = ? AND s.is_external = 0`,
      [reviewId, req.userId!]);
    if (!row) return res.status(404).json({ error: 'Eligible review not found' });
    const existing = await dbGet<IssuedCertificate>(
      "SELECT * FROM issued_certificates WHERE kind = 'reviewer' AND activity_id = ? AND recipient_id = ?",
      [row.id, req.userId!]);
    if (existing?.revoked_at) return res.status(409).json({ error: 'Certificate revoked; contact support' });
    if (existing) return res.json({ certificate: existing });
    await dbRun(`INSERT OR IGNORE INTO issued_certificates
      (id, kind, activity_id, recipient_id, recipient_name, conference_title, paper_title)
      VALUES (?, 'reviewer', ?, ?, ?, ?, ?)`,
      ['CG-RV-' + crypto.randomBytes(16).toString('hex').toUpperCase(), row.id, req.userId!, row.reviewer_name, row.conference_title, row.title]);
    const issued = await dbGet<IssuedCertificate>(
      "SELECT * FROM issued_certificates WHERE kind = 'reviewer' AND activity_id = ? AND recipient_id = ?",
      [row.id, req.userId!]);
    return res.status(201).json({ certificate: issued });
  } catch (err) {
    console.error('Reviewer certificate issuance failed:', err);
    return res.status(500).json({ error: 'Unable to issue certificate' });
  }
});

/** Only organizer-completed committee service is eligible. */
certificatesRouter.post('/issue/committee/:invitationId', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const invitationId = String(req.params.invitationId || '');
    if (!invitationId || invitationId.length > 200) return res.status(400).json({ error: 'Invalid invitation' });
    const row = await dbGet<{ id: string; recipient_name: string; conference_title: string; title: string }>(
      `SELECT i.id, u.name AS recipient_name, i.conference_title, i.title
       FROM professional_invitations i JOIN users u ON u.id = i.professional_id
       WHERE i.id = ? AND i.professional_id = ? AND i.role_type = 'committee'
         AND i.status = 'completed' AND i.completed_at IS NOT NULL`,
      [invitationId, req.userId!]);
    if (!row) return res.status(404).json({ error: 'Completed committee assignment not found' });
    const existing = await dbGet<IssuedCertificate>(
      "SELECT * FROM issued_certificates WHERE kind = 'committee' AND activity_id = ? AND recipient_id = ?",
      [row.id, req.userId!]);
    if (existing?.revoked_at) return res.status(409).json({ error: 'Certificate revoked; contact support' });
    if (existing) return res.json({ certificate: existing });
    await dbRun(`INSERT OR IGNORE INTO issued_certificates
      (id, kind, activity_id, recipient_id, recipient_name, conference_title, paper_title)
      VALUES (?, 'committee', ?, ?, ?, ?, ?)`,
      ['CG-TC-' + crypto.randomBytes(16).toString('hex').toUpperCase(), row.id, req.userId!, row.recipient_name, row.conference_title, row.title]);
    const issued = await dbGet<IssuedCertificate>(
      "SELECT * FROM issued_certificates WHERE kind = 'committee' AND activity_id = ? AND recipient_id = ?",
      [row.id, req.userId!]);
    return res.status(201).json({ certificate: issued });
  } catch (err) {
    console.error('Committee certificate issuance failed:', err);
    return res.status(500).json({ error: 'Unable to issue certificate' });
  }
});

certificatesRouter.get('/verify/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!/^CG-(?:AA|RV|TC)-[A-F0-9]{32}$/.test(id)) return res.status(400).json({ valid: false });
    const cert = await dbGet<IssuedCertificate>(
      'SELECT * FROM issued_certificates WHERE id = ?', [id]);
    if (!cert) return res.status(404).json({ valid: false });
    return res.json({
      valid: !cert.revoked_at, revoked: !!cert.revoked_at,
      certificate: {
        id: cert.id, kind: cert.kind, recipientName: cert.recipient_name,
        conferenceTitle: cert.conference_title, paperTitle: cert.paper_title,
        issuedAt: cert.issued_at
      }
    });
  } catch (err) {
    console.error('Certificate verification failed:', err);
    return res.status(500).json({ error: 'Unable to verify certificate' });
  }
});
