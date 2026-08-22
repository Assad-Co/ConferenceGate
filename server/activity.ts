import { Router, Response } from "express";
import crypto from "crypto";
import {
  dbGet,
  dbAll,
  dbRun,
  SubmissionRow,
  SubmissionReviewRow,
  ReviewVolunteerRow,
  ConferenceRegistrationRow,
  ConferenceInteractionRow,
  ConferenceFeedbackRow,
  SubmissionRevisionRow,
  OrganizerBroadcastRow,
  ConferenceInterestActionRow,
  CreatedConferenceRow,
} from "./db";
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
    revisionsCount: row.revisions_count,
    visualTimeline: deriveVisualTimeline(row.status, rowReviews.length > 0),
    reviews: rowReviews,
  };
}

activityRouter.get("/submissions", async (_req: AuthedRequest, res: Response) => {
  const rows = await dbAll<SubmissionRow>("SELECT * FROM submissions ORDER BY submission_date DESC");
  const reviewRows = await dbAll<SubmissionReviewRow>("SELECT * FROM submission_reviews");
  res.json({ submissions: rows.map((row) => toSubmissionDTO(row, reviewRows)) });
});

activityRouter.post("/submissions", async (req: AuthedRequest, res: Response) => {
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
  await dbRun(
    `INSERT INTO submissions (
      id, submitter_id, conference_id, conference_title, title, track, topic, keywords,
      abstract_text, preferred_type, primary_author_name, primary_author_email,
      primary_author_affiliation, primary_author_bio, co_authors, conflict_of_interest, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Submitted')`,
    [
      id,
      req.userId!,
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
      body.conflictOfInterest || null,
    ]
  );

  const row = (await dbGet<SubmissionRow>("SELECT * FROM submissions WHERE id = ?", [id]))!;
  res.status(201).json({ submission: toSubmissionDTO(row, []) });
});

activityRouter.post("/submissions/:id/reviews", async (req: AuthedRequest, res: Response) => {
  const submission = await dbGet<SubmissionRow>("SELECT * FROM submissions WHERE id = ?", [req.params.id]);
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

  const reviewerRow = await dbGet<{ name: string; organization: string | null }>(
    "SELECT name, organization FROM users WHERE id = ?",
    [req.userId!]
  );

  const reviewId = `rev_${crypto.randomUUID()}`;
  const scoreValues = Object.values(body.scores || {}) as number[];
  const overall = scoreValues.length
    ? Number((scoreValues.reduce((a, b) => a + Number(b), 0) / scoreValues.length).toFixed(1))
    : 0;

  await dbRun(
    `INSERT INTO submission_reviews (
      id, submission_id, reviewer_id, reviewer_name, reviewer_org, scores, overall_score,
      comments_to_author, confidential_comments, recommendation
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      reviewId,
      submission.id,
      req.userId!,
      reviewerRow?.name || "Reviewer",
      reviewerRow?.organization || null,
      JSON.stringify(body.scores || {}),
      overall,
      body.commentsToAuthor.trim(),
      body.confidentialComments || null,
      body.recommendation,
    ]
  );

  const newStatus = RECOMMENDATION_TO_STATUS[body.recommendation] || submission.status;
  await dbRun("UPDATE submissions SET status = ? WHERE id = ?", [newStatus, submission.id]);

  const updatedRow = (await dbGet<SubmissionRow>("SELECT * FROM submissions WHERE id = ?", [submission.id]))!;
  const reviewRows = await dbAll<SubmissionReviewRow>("SELECT * FROM submission_reviews WHERE submission_id = ?", [
    submission.id,
  ]);
  res.status(201).json({ submission: toSubmissionDTO(updatedRow, reviewRows) });
});

activityRouter.post("/submissions/:id/revisions", async (req: AuthedRequest, res: Response) => {
  const submission = await dbGet<SubmissionRow>("SELECT * FROM submissions WHERE id = ?", [req.params.id]);
  if (!submission) {
    return res.status(404).json({ error: "Submission not found" });
  }
  if (submission.submitter_id !== req.userId) {
    return res.status(403).json({ error: "Only the submitting author can respond to a revision request." });
  }

  const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
  if (!note) {
    return res.status(400).json({ error: "A revision response is required" });
  }

  const revisionId = `subrev_${crypto.randomUUID()}`;
  await dbRun("INSERT INTO submission_revisions (id, submission_id, author_id, note) VALUES (?, ?, ?, ?)", [
    revisionId,
    submission.id,
    req.userId!,
    note,
  ]);
  await dbRun(
    "UPDATE submissions SET revisions_count = revisions_count + 1, status = 'Revised Abstract Submitted' WHERE id = ?",
    [submission.id]
  );

  const updatedRow = (await dbGet<SubmissionRow>("SELECT * FROM submissions WHERE id = ?", [submission.id]))!;
  const reviewRows = await dbAll<SubmissionReviewRow>("SELECT * FROM submission_reviews WHERE submission_id = ?", [
    submission.id,
  ]);
  res.status(201).json({ submission: toSubmissionDTO(updatedRow, reviewRows) });
});

activityRouter.post("/reviews/volunteer", async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  if (typeof body.opportunityId !== "string" || !body.opportunityId) {
    return res.status(400).json({ error: "opportunityId is required" });
  }

  const id = `vol_${crypto.randomUUID()}`;
  try {
    await dbRun(
      `INSERT INTO review_volunteers (id, reviewer_id, opportunity_id, conference_title, topic) VALUES (?, ?, ?, ?, ?)`,
      [id, req.userId!, body.opportunityId, body.conferenceTitle || "", body.topic || null]
    );
  } catch {
    // Already volunteered for this opportunity — idempotent no-op.
  }

  res.status(201).json({ ok: true });
});

activityRouter.get("/reviews/volunteers/mine", async (req: AuthedRequest, res: Response) => {
  const rows = await dbAll<ReviewVolunteerRow>("SELECT * FROM review_volunteers WHERE reviewer_id = ?", [
    req.userId!,
  ]);
  res.json({ opportunityIds: rows.map((r) => r.opportunity_id) });
});

activityRouter.post("/registrations", async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  if (typeof body.conferenceId !== "string" || !body.conferenceId) {
    return res.status(400).json({ error: "conferenceId is required" });
  }

  const existing = await dbGet<{ id: string }>(
    "SELECT id FROM conference_registrations WHERE user_id = ? AND conference_id = ?",
    [req.userId!, body.conferenceId]
  );

  if (existing) {
    await dbRun("UPDATE conference_registrations SET package_id = ?, package_name = ? WHERE id = ?", [
      body.packageId || null,
      body.packageName || null,
      existing.id,
    ]);
  } else {
    const id = `reg_${crypto.randomUUID()}`;
    await dbRun(
      `INSERT INTO conference_registrations (id, user_id, conference_id, conference_title, package_id, package_name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, req.userId!, body.conferenceId, body.conferenceTitle || "", body.packageId || null, body.packageName || null]
    );
  }

  res.status(201).json({ ok: true });
});

activityRouter.get("/registrations/mine", async (req: AuthedRequest, res: Response) => {
  const rows = await dbAll<ConferenceRegistrationRow>(
    "SELECT * FROM conference_registrations WHERE user_id = ? ORDER BY registered_at DESC",
    [req.userId!]
  );
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

// Organizer-facing aggregate counts — every registered account is visible to organizers so they
// can see real registration totals per conference, mirroring the platform-wide submissions view.
activityRouter.get("/registrations/counts-by-conference", async (_req: AuthedRequest, res: Response) => {
  const rows = await dbAll<{ conference_id: string; count: number }>(
    "SELECT conference_id, COUNT(*) as count FROM conference_registrations GROUP BY conference_id"
  );
  res.json({
    counts: Object.fromEntries(rows.map((r) => [r.conference_id, r.count])),
  });
});

activityRouter.get("/conference-interactions/mine", async (req: AuthedRequest, res: Response) => {
  const rows = await dbAll<ConferenceInteractionRow>("SELECT * FROM conference_interactions WHERE user_id = ?", [
    req.userId!,
  ]);
  res.json({
    saved: rows.filter((r) => r.type === "saved").map((r) => r.conference_id),
    followed: rows.filter((r) => r.type === "followed").map((r) => r.conference_id),
  });
});

activityRouter.post("/conference-interactions/toggle", async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const conferenceId = typeof body.conferenceId === "string" ? body.conferenceId : "";
  const type = body.type === "saved" || body.type === "followed" ? body.type : null;
  if (!conferenceId || !type) {
    return res.status(400).json({ error: "conferenceId and a valid type ('saved' or 'followed') are required" });
  }

  const existing = await dbGet<{ id: string }>(
    "SELECT id FROM conference_interactions WHERE user_id = ? AND conference_id = ? AND type = ?",
    [req.userId!, conferenceId, type]
  );

  if (existing) {
    await dbRun("DELETE FROM conference_interactions WHERE id = ?", [existing.id]);
    return res.json({ active: false });
  }

  const id = `ci_${crypto.randomUUID()}`;
  await dbRun("INSERT INTO conference_interactions (id, user_id, conference_id, type) VALUES (?, ?, ?, ?)", [
    id,
    req.userId!,
    conferenceId,
    type,
  ]);
  res.status(201).json({ active: true });
});

activityRouter.post("/feedback", async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  if (typeof body.conferenceTitle !== "string" || !body.conferenceTitle.trim()) {
    return res.status(400).json({ error: "conferenceTitle is required" });
  }
  const ratings = body.ratings && typeof body.ratings === "object" ? body.ratings : {};
  const scoreValues = Object.values(ratings) as number[];
  if (scoreValues.length === 0) {
    return res.status(400).json({ error: "At least one rating is required" });
  }
  const overallScore = Number((scoreValues.reduce((a, b) => a + Number(b), 0) / scoreValues.length).toFixed(2));

  const id = `fb_${crypto.randomUUID()}`;
  await dbRun(
    `INSERT INTO conference_feedback (
      id, user_id, conference_id, conference_title, role, ratings, overall_score, comment, recipient_email
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      req.userId!,
      body.conferenceId || null,
      body.conferenceTitle.trim(),
      body.role || "Attendee",
      JSON.stringify(ratings),
      overallScore,
      body.comment || null,
      body.recipientEmail || null,
    ]
  );

  res.status(201).json({ ok: true, overallScore });
});

activityRouter.get("/feedback/summary", async (_req: AuthedRequest, res: Response) => {
  const row = (await dbGet<{ avgScore: number | null; count: number }>(
    "SELECT AVG(overall_score) as avgScore, COUNT(*) as count FROM conference_feedback"
  ))!;
  res.json({ averageScore: row.avgScore || 0, responseCount: row.count });
});

activityRouter.post("/broadcasts", async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  if (typeof body.subject !== "string" || !body.subject.trim()) {
    return res.status(400).json({ error: "Subject is required" });
  }
  if (typeof body.body !== "string" || !body.body.trim()) {
    return res.status(400).json({ error: "Message body is required" });
  }

  const id = `bc_${crypto.randomUUID()}`;
  await dbRun(
    "INSERT INTO organizer_broadcasts (id, organizer_id, recipient_group, subject, body) VALUES (?, ?, ?, ?, ?)",
    [id, req.userId!, body.recipientGroup || "All Attendees", body.subject.trim(), body.body.trim()]
  );

  const row = (await dbGet<OrganizerBroadcastRow>("SELECT * FROM organizer_broadcasts WHERE id = ?", [id]))!;
  res.status(201).json({
    broadcast: {
      id: row.id,
      recipientGroup: row.recipient_group,
      subject: row.subject,
      body: row.body,
      createdAt: row.created_at,
    },
  });
});

activityRouter.get("/broadcasts/mine", async (req: AuthedRequest, res: Response) => {
  const rows = await dbAll<OrganizerBroadcastRow>(
    "SELECT * FROM organizer_broadcasts WHERE organizer_id = ? ORDER BY created_at DESC",
    [req.userId!]
  );
  res.json({
    broadcasts: rows.map((row) => ({
      id: row.id,
      recipientGroup: row.recipient_group,
      subject: row.subject,
      body: row.body,
      createdAt: row.created_at,
    })),
  });
});

activityRouter.post("/conference-actions", async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const conferenceId = typeof body.conferenceId === "string" ? body.conferenceId : "";
  const conferenceTitle = typeof body.conferenceTitle === "string" ? body.conferenceTitle : "";
  const kind = body.kind === "committee_interest" || body.kind === "sponsorship_inquiry" ? body.kind : null;
  if (!conferenceId || !conferenceTitle || !kind) {
    return res.status(400).json({ error: "conferenceId, conferenceTitle, and a valid kind are required" });
  }

  const existing = await dbGet<{ id: string }>(
    "SELECT id FROM conference_interest_actions WHERE user_id = ? AND conference_id = ? AND kind = ?",
    [req.userId!, conferenceId, kind]
  );

  if (existing) {
    return res.json({ alreadyRecorded: true });
  }

  const id = `cia_${crypto.randomUUID()}`;
  await dbRun(
    "INSERT INTO conference_interest_actions (id, user_id, conference_id, conference_title, kind) VALUES (?, ?, ?, ?, ?)",
    [id, req.userId!, conferenceId, conferenceTitle, kind]
  );
  res.status(201).json({ alreadyRecorded: false });
});

activityRouter.get("/conference-actions/mine", async (req: AuthedRequest, res: Response) => {
  const rows = await dbAll<ConferenceInterestActionRow>(
    "SELECT * FROM conference_interest_actions WHERE user_id = ? ORDER BY created_at DESC",
    [req.userId!]
  );
  res.json({
    actions: rows.map((row) => ({
      conferenceId: row.conference_id,
      conferenceTitle: row.conference_title,
      kind: row.kind,
      createdAt: row.created_at,
    })),
  });
});

// Conferences created via the organizer wizard — stored as an opaque JSON blob since the
// client-side Conference shape is large and nested; every account can see every created
// conference, mirroring the platform-wide submissions/registrations views elsewhere.
activityRouter.post("/conferences", async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  if (typeof body.id !== "string" || !body.id || typeof body.title !== "string" || !body.title.trim()) {
    return res.status(400).json({ error: "A conference object with id and title is required" });
  }
  await dbRun("INSERT INTO created_conferences (id, organizer_id, data) VALUES (?, ?, ?)", [
    body.id,
    req.userId!,
    JSON.stringify(body),
  ]);
  res.status(201).json({ conference: body });
});

activityRouter.get("/conferences", async (_req: AuthedRequest, res: Response) => {
  const rows = await dbAll<CreatedConferenceRow>("SELECT * FROM created_conferences ORDER BY created_at DESC");
  res.json({ conferences: rows.map((row) => JSON.parse(row.data)) });
});
