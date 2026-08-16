import { Router, Response } from "express";
import crypto from "crypto";
import { db, SubmissionRow, SubmissionReviewRow, ReviewVolunteerRow, ConferenceRegistrationRow } from "./db";
import { AuthedRequest, requireAuth } from "./auth";

export const activityRouter = Router();
activityRouter.use(requireAuth);

const RECOMMENDATION_TO_STATUS: Record<string, string> = {
  Accept: "Accepted",
  "Oral Presentation": "Accepted for Oral",
  "Poster Presentation": "Accepted for Poster",
  "Accept with Revision": "Revision Requested",
  "Major Revision": "Revision Requested",
  Reject: "Rejected",
};

const TIMELINE_LABELS = ["Submitted", "Initial Screening", "Reviewer Assignment", "Under Review", "Final Decision"];
const FINAL_STATUSES = ["Accepted", "Accepted for Oral", "Accepted for Poster", "Rejected", "Withdrawn"];

function deriveVisualTimeline(status: string, hasReviews: boolean) {
  const currentIndex = FINAL_STATUSES.includes(status) ? 4 : hasReviews ? 3 : 1;
  return TIMELINE_LABELS.map((label, idx) => ({
    label,
    status: idx < currentIndex || (idx === currentIndex && currentIndex === 4) ? "completed" : idx === currentIndex ? "current" : "upcoming",
  }));
}

function toSubmissionDTO(row: SubmissionRow, reviews: SubmissionReviewRow[]) {
  const rowReviews = reviews
    .filter((r) => r.submission_id === row.id)
    .map((r) => ({
      id: r.id,
      abstractId: r.submission_id,
      reviewerId: r.reviewer_id,
      reviewerName: r.reviewer_name,
      reviewerOrg: r.reviewer_org || "",
      scores: JSON.parse(r.scores),
      overallScore: r.overall_score,
      commentsToAuthor: r.comments_to_author,
      confidentialComments: r.confidential_comments || "",
      recommendation: r.recommendation,
      date: r.created_at.split(" ")[0],
    }));

  return {
    id: row.id,
    submitterId: row.submitter_id,
    conferenceId: row.conference_id,
    conferenceTitle: row.conference_title,
    title: row.title,
    primaryAuthor: {
      name: row.primary_author_name,
      email: row.primary_author_email,
      affiliation: row.primary_author_affiliation || "",
      bio: row.primary_author_bio || "",
    },
    coAuthors: JSON.parse(row.co_authors),
    topic: row.topic || "",
    track: row.track || "",
    keywords: JSON.parse(row.keywords),
    abstractText: row.abstract_text,
    preferredType: row.preferred_type,
    conflictOfInterest: row.conflict_of_interest || "",
    status: row.status,
    submissionDate: row.submission_date.split(" ")[0],
    revisionsCount: 0,
    visualTimeline: deriveVisualTimeline(row.status, rowReviews.length > 0),
    reviews: rowReviews,
  };
}

activityRouter.get("/submissions", (_req: AuthedRequest, res: Response) => {
  const rows = db.prepare("SELECT * FROM submissions ORDER BY submission_date DESC").all() as SubmissionRow[];
  const reviewRows = db.prepare("SELECT * FROM submission_reviews").all() as SubmissionReviewRow[];
  res.json({ submissions: rows.map((row) => toSubmissionDTO(row, reviewRows)) });
});

activityRouter.post("/submissions", (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  if (typeof body.title !== "string" || !body.title.trim()) {
    return res.status(400).json({ error: "Abstract title is required" });
  }
  if (typeof body.abstractText !== "string" || !body.abstractText.trim()) {
    return res.status(400).json({ error: "Abstract text is required" });
  }
  if (typeof body.conferenceId !== "string" || !body.conferenceId) {
    return res.status(400).json({ error: "conferenceId is required" });
  }

  const id = `sub_${crypto.randomUUID()}`;
  db.prepare(
    `INSERT INTO submissions (
      id, submitter_id, conference_id, conference_title, title, track, topic, keywords,
      abstract_text, preferred_type, primary_author_name, primary_author_email,
      primary_author_affiliation, primary_author_bio, co_authors, conflict_of_interest, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Submitted')`
  ).run(
    id,
    req.userId,
    body.conferenceId,
    body.conferenceTitle || "",
    body.title.trim(),
    body.track || null,
    body.topic || null,
    JSON.stringify(Array.isArray(body.keywords) ? body.keywords : []),
    body.abstractText.trim(),
    body.preferredType === "Poster" ? "Poster" : "Oral",
    body.primaryAuthor?.name || "",
    body.primaryAuthor?.email || "",
    body.primaryAuthor?.affiliation || null,
    body.primaryAuthor?.bio || null,
    JSON.stringify(Array.isArray(body.coAuthors) ? body.coAuthors : []),
    body.conflictOfInterest || null
  );

  const row = db.prepare("SELECT * FROM submissions WHERE id = ?").get(id) as SubmissionRow;
  res.status(201).json({ submission: toSubmissionDTO(row, []) });
});

activityRouter.post("/submissions/:id/reviews", (req: AuthedRequest, res: Response) => {
  const submission = db.prepare("SELECT * FROM submissions WHERE id = ?").get(req.params.id) as SubmissionRow | undefined;
  if (!submission) {
    return res.status(404).json({ error: "Submission not found" });
  }

  const body = req.body || {};
  if (typeof body.commentsToAuthor !== "string" || !body.commentsToAuthor.trim()) {
    return res.status(400).json({ error: "Comments to author are required" });
  }
  if (typeof body.recommendation !== "string" || !(body.recommendation in RECOMMENDATION_TO_STATUS)) {
    return res.status(400).json({ error: "A valid recommendation is required" });
  }

  const reviewerRow = db.prepare("SELECT name, organization FROM users WHERE id = ?").get(req.userId) as
    | { name: string; organization: string | null }
    | undefined;

  const reviewId = `rev_${crypto.randomUUID()}`;
  const scoreValues = Object.values(body.scores || {}) as number[];
  const overall = scoreValues.length
    ? Number((scoreValues.reduce((a, b) => a + Number(b), 0) / scoreValues.length).toFixed(1))
    : 0;

  db.prepare(
    `INSERT INTO submission_reviews (
      id, submission_id, reviewer_id, reviewer_name, reviewer_org, scores, overall_score,
      comments_to_author, confidential_comments, recommendation
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    reviewId,
    submission.id,
    req.userId,
    reviewerRow?.name || "Reviewer",
    reviewerRow?.organization || null,
    JSON.stringify(body.scores || {}),
    overall,
    body.commentsToAuthor.trim(),
    body.confidentialComments || null,
    body.recommendation
  );

  const newStatus = RECOMMENDATION_TO_STATUS[body.recommendation] || submission.status;
  db.prepare("UPDATE submissions SET status = ? WHERE id = ?").run(newStatus, submission.id);

  const updatedRow = db.prepare("SELECT * FROM submissions WHERE id = ?").get(submission.id) as SubmissionRow;
  const reviewRows = db.prepare("SELECT * FROM submission_reviews WHERE submission_id = ?").all(submission.id) as SubmissionReviewRow[];
  res.status(201).json({ submission: toSubmissionDTO(updatedRow, reviewRows) });
});

activityRouter.post("/reviews/volunteer", (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  if (typeof body.opportunityId !== "string" || !body.opportunityId) {
    return res.status(400).json({ error: "opportunityId is required" });
  }

  const id = `vol_${crypto.randomUUID()}`;
  try {
    db.prepare(
      `INSERT INTO review_volunteers (id, reviewer_id, opportunity_id, conference_title, topic) VALUES (?, ?, ?, ?, ?)`
    ).run(id, req.userId, body.opportunityId, body.conferenceTitle || "", body.topic || null);
  } catch {
    // Already volunteered for this opportunity — idempotent no-op.
  }

  res.status(201).json({ ok: true });
});

activityRouter.get("/reviews/volunteers/mine", (req: AuthedRequest, res: Response) => {
  const rows = db
    .prepare("SELECT * FROM review_volunteers WHERE reviewer_id = ?")
    .all(req.userId) as ReviewVolunteerRow[];
  res.json({ opportunityIds: rows.map((r) => r.opportunity_id) });
});

activityRouter.post("/registrations", (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  if (typeof body.conferenceId !== "string" || !body.conferenceId) {
    return res.status(400).json({ error: "conferenceId is required" });
  }

  const existing = db
    .prepare("SELECT id FROM conference_registrations WHERE user_id = ? AND conference_id = ?")
    .get(req.userId, body.conferenceId) as { id: string } | undefined;

  if (existing) {
    db.prepare("UPDATE conference_registrations SET package_id = ?, package_name = ? WHERE id = ?").run(
      body.packageId || null,
      body.packageName || null,
      existing.id
    );
  } else {
    const id = `reg_${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO conference_registrations (id, user_id, conference_id, conference_title, package_id, package_name)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, req.userId, body.conferenceId, body.conferenceTitle || "", body.packageId || null, body.packageName || null);
  }

  res.status(201).json({ ok: true });
});

activityRouter.get("/registrations/mine", (req: AuthedRequest, res: Response) => {
  const rows = db
    .prepare("SELECT * FROM conference_registrations WHERE user_id = ? ORDER BY registered_at DESC")
    .all(req.userId) as ConferenceRegistrationRow[];
  res.json({
    registrations: rows.map((r) => ({
      conferenceId: r.conference_id,
      conferenceTitle: r.conference_title,
      packageId: r.package_id,
      packageName: r.package_name,
      registeredAt: r.registered_at,
    })),
  });
});
