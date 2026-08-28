import { Router, Response } from "express";
import crypto from "crypto";
import {
  dbGet,
  dbAll,
  dbRun,
  SubmissionRow,
  SubmissionReviewRow,
  SubmissionReviewerAssignmentRow,
  NotificationRow,
  ReviewVolunteerRow,
  ConferenceRegistrationRow,
  ConferenceInteractionRow,
  ConferenceFeedbackRow,
  SubmissionRevisionRow,
  OrganizerBroadcastRow,
  ConferenceInterestActionRow,
  CreatedConferenceRow,
  ExternalPaperMatchRow,
  SelfReportedAttendanceRow,
  SelfReportedCommitteePositionRow,
} from "./db";
import { AuthedRequest, requireAuth } from "./auth";
import { asyncHandler } from "./asyncHandler";
import { searchCrossRefConferencePapers } from "./crossref";
import { searchSemanticScholarConferencePapers } from "./semanticscholar";
import { searchDblpConferencePapers } from "./dblp";

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

// "Reviewer Assignment" only becomes reachable once a real assignment row exists — never assumed
// just because a submission is sitting unreviewed, since organizers may not have invited anyone yet.
function deriveVisualTimeline(status: string, hasReviews: boolean, hasAssignment: boolean) {
  const currentIndex = FINAL_STATUSES.includes(status) ? 4 : hasReviews ? 3 : hasAssignment ? 2 : 1;
  return TIMELINE_LABELS.map((label, idx) => ({
    label,
    status: idx < currentIndex || (idx === currentIndex && currentIndex === 4) ? "completed" : idx === currentIndex ? "current" : "upcoming",
  }));
}

async function createNotification(userId: string, type: string, title: string, message: string) {
  await dbRun(
    "INSERT INTO notifications (id, user_id, type, title, message) VALUES (?, ?, ?, ?, ?)",
    [`ntf_${crypto.randomUUID()}`, userId, type, title, message]
  );
}

function toSubmissionDTO(
  row: SubmissionRow,
  reviews: SubmissionReviewRow[],
  assignments: SubmissionReviewerAssignmentRow[]
) {
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

  const rowAssignments = assignments
    .filter((a) => a.submission_id === row.id)
    .map((a) => ({ reviewerId: a.reviewer_id, reviewerName: a.reviewer_name }));

  const isExternal = !!row.is_external;

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
    // A self-reported record of submitting directly on an external conference's own site — there's
    // no real ConferenceGate reviewer pipeline behind it, so the timeline is honestly just the one
    // real fact we know (the author says they submitted it), never a fabricated multi-stage flow.
    isExternal,
    externalUrl: row.external_url || null,
    visualTimeline: isExternal
      ? [{ label: "Submitted Externally", status: "completed" as const, date: row.submission_date.split(" ")[0] }]
      : deriveVisualTimeline(row.status, rowReviews.length > 0, rowAssignments.length > 0),
    reviewerAssignments: rowAssignments,
    reviews: rowReviews,
  };
}

activityRouter.get("/submissions", asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const rows = await dbAll<SubmissionRow>("SELECT * FROM submissions ORDER BY submission_date DESC");
  const reviewRows = await dbAll<SubmissionReviewRow>("SELECT * FROM submission_reviews");
  const assignmentRows = await dbAll<SubmissionReviewerAssignmentRow>("SELECT * FROM submission_reviewer_assignments");
  res.json({ submissions: rows.map((row) => toSubmissionDTO(row, reviewRows, assignmentRows)) });
}));

// Persists the real reviewer invitation an organizer sends via the AI Reviewer Match panel —
// previously that flow only sent a DM with no lasting record, so the abstract's own timeline
// and "assigned reviewers" list never reflected it. Also notifies the invited reviewer for real.
activityRouter.post(
  "/submissions/:id/assign-reviewer",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const submission = await dbGet<SubmissionRow>("SELECT * FROM submissions WHERE id = ?", [req.params.id]);
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }
    const { reviewerId } = req.body || {};
    if (typeof reviewerId !== "string" || !reviewerId) {
      return res.status(400).json({ error: "reviewerId is required" });
    }
    const reviewer = await dbGet<{ name: string }>("SELECT name FROM users WHERE id = ?", [reviewerId]);
    if (!reviewer) {
      return res.status(404).json({ error: "Reviewer account not found" });
    }

    try {
      await dbRun(
        `INSERT INTO submission_reviewer_assignments (id, submission_id, reviewer_id, reviewer_name, invited_by_id)
         VALUES (?, ?, ?, ?, ?)`,
        [`asn_${crypto.randomUUID()}`, submission.id, reviewerId, reviewer.name, req.userId!]
      );
      await createNotification(
        reviewerId,
        "invitation",
        "New Reviewer Invitation",
        `You've been invited to review "${submission.title}" for ${submission.conference_title}.`
      );
    } catch {
      // Already assigned to this reviewer — idempotent, not an error.
    }

    const updatedRow = (await dbGet<SubmissionRow>("SELECT * FROM submissions WHERE id = ?", [submission.id]))!;
    const reviewRows = await dbAll<SubmissionReviewRow>("SELECT * FROM submission_reviews WHERE submission_id = ?", [
      submission.id,
    ]);
    const assignmentRows = await dbAll<SubmissionReviewerAssignmentRow>(
      "SELECT * FROM submission_reviewer_assignments WHERE submission_id = ?",
      [submission.id]
    );
    res.status(201).json({ submission: toSubmissionDTO(updatedRow, reviewRows, assignmentRows) });
  })
);

activityRouter.get("/notifications/mine", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const rows = await dbAll<NotificationRow>(
    "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC",
    [req.userId!]
  );
  res.json({
    notifications: rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      message: r.message,
      read: !!r.read,
      timestamp: r.created_at,
    })),
  });
}));

activityRouter.post(
  "/notifications/:id/read",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    await dbRun("UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?", [req.params.id, req.userId!]);
    res.json({ ok: true });
  })
);

activityRouter.post(
  "/notifications/read-all",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    await dbRun("UPDATE notifications SET read = 1 WHERE user_id = ?", [req.userId!]);
    res.json({ ok: true });
  })
);

activityRouter.post("/submissions", asyncHandler(async (req: AuthedRequest, res: Response) => {
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
  res.status(201).json({ submission: toSubmissionDTO(row, [], []) });
}));

// Records that the author submitted this abstract directly on an external conference's own site
// (EasyChair, a form, an email address, etc.) — ConferenceGate has no way to see into that
// system's real review pipeline, so this is honestly a self-reported bookmark of what and where
// they submitted, kept in My Abstracts for their own records, never a tracked review workflow.
activityRouter.post(
  "/submissions/external",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const body = req.body || {};
    if (typeof body.title !== "string" || !body.title.trim()) {
      return res.status(400).json({ error: "Abstract title is required" });
    }
    if (typeof body.conferenceTitle !== "string" || !body.conferenceTitle.trim()) {
      return res.status(400).json({ error: "conferenceTitle is required" });
    }
    if (typeof body.externalUrl !== "string" || !body.externalUrl.trim()) {
      return res.status(400).json({ error: "externalUrl is required" });
    }

    const id = `sub_${crypto.randomUUID()}`;
    await dbRun(
      `INSERT INTO submissions (
        id, submitter_id, conference_id, conference_title, title, track, topic, keywords,
        abstract_text, preferred_type, primary_author_name, primary_author_email,
        primary_author_affiliation, primary_author_bio, co_authors, conflict_of_interest, status,
        is_external, external_url
      ) VALUES (?, ?, ?, ?, ?, NULL, NULL, '[]', ?, 'Oral', ?, ?, NULL, NULL, '[]', NULL, 'Submitted', 1, ?)`,
      [
        id,
        req.userId!,
        `external_${id}`,
        body.conferenceTitle.trim(),
        body.title.trim(),
        typeof body.abstractText === "string" ? body.abstractText.trim() : "",
        typeof body.authorName === "string" ? body.authorName : "",
        typeof body.authorEmail === "string" ? body.authorEmail : "",
        body.externalUrl.trim(),
      ]
    );

    const row = (await dbGet<SubmissionRow>("SELECT * FROM submissions WHERE id = ?", [id]))!;
    res.status(201).json({ submission: toSubmissionDTO(row, [], []) });
  })
);

activityRouter.post("/submissions/:id/reviews", asyncHandler(async (req: AuthedRequest, res: Response) => {
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

  // The reviewer-facing UI claims "the author notified" the moment a review is submitted — make
  // that literally true instead of an empty promise.
  await createNotification(
    submission.submitter_id,
    "review",
    FINAL_STATUSES.includes(newStatus) ? "Abstract Decision" : "New Peer Review Received",
    `Your abstract "${submission.title}" for ${submission.conference_title} ${
      FINAL_STATUSES.includes(newStatus) ? `has a decision: ${newStatus}.` : "has received a new peer review."
    }`
  );

  const updatedRow = (await dbGet<SubmissionRow>("SELECT * FROM submissions WHERE id = ?", [submission.id]))!;
  const reviewRows = await dbAll<SubmissionReviewRow>("SELECT * FROM submission_reviews WHERE submission_id = ?", [
    submission.id,
  ]);
  const assignmentRows = await dbAll<SubmissionReviewerAssignmentRow>(
    "SELECT * FROM submission_reviewer_assignments WHERE submission_id = ?",
    [submission.id]
  );
  res.status(201).json({ submission: toSubmissionDTO(updatedRow, reviewRows, assignmentRows) });
}));

activityRouter.post("/submissions/:id/revisions", asyncHandler(async (req: AuthedRequest, res: Response) => {
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
  const assignmentRows = await dbAll<SubmissionReviewerAssignmentRow>(
    "SELECT * FROM submission_reviewer_assignments WHERE submission_id = ?",
    [submission.id]
  );
  res.status(201).json({ submission: toSubmissionDTO(updatedRow, reviewRows, assignmentRows) });
}));

activityRouter.post("/reviews/volunteer", asyncHandler(async (req: AuthedRequest, res: Response) => {
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
}));

activityRouter.get("/reviews/volunteers/mine", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const rows = await dbAll<ReviewVolunteerRow>("SELECT * FROM review_volunteers WHERE reviewer_id = ?", [
    req.userId!,
  ]);
  res.json({ opportunityIds: rows.map((r) => r.opportunity_id) });
}));

activityRouter.post("/registrations", asyncHandler(async (req: AuthedRequest, res: Response) => {
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
}));

activityRouter.get("/registrations/mine", asyncHandler(async (req: AuthedRequest, res: Response) => {
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
}));

// Organizer-facing aggregate counts — every registered account is visible to organizers so they
// can see real registration totals per conference, mirroring the platform-wide submissions view.
activityRouter.get("/registrations/counts-by-conference", asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const rows = await dbAll<{ conference_id: string; count: number }>(
    "SELECT conference_id, COUNT(*) as count FROM conference_registrations GROUP BY conference_id"
  );
  res.json({
    counts: Object.fromEntries(rows.map((r) => [r.conference_id, r.count])),
  });
}));

activityRouter.get("/conference-interactions/mine", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const rows = await dbAll<ConferenceInteractionRow>("SELECT * FROM conference_interactions WHERE user_id = ?", [
    req.userId!,
  ]);
  res.json({
    saved: rows.filter((r) => r.type === "saved").map((r) => r.conference_id),
    followed: rows.filter((r) => r.type === "followed").map((r) => r.conference_id),
  });
}));

activityRouter.post("/conference-interactions/toggle", asyncHandler(async (req: AuthedRequest, res: Response) => {
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
}));

activityRouter.post("/feedback", asyncHandler(async (req: AuthedRequest, res: Response) => {
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
}));

// Scoped to feedback left on conferences this organizer created — not a platform-wide average,
// which would mix in every other organizer's events.
activityRouter.get("/feedback/summary", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const row = (await dbGet<{ avgScore: number | null; count: number }>(
    `SELECT AVG(cf.overall_score) as avgScore, COUNT(*) as count
     FROM conference_feedback cf
     JOIN created_conferences cc ON cc.id = cf.conference_id
     WHERE cc.organizer_id = ?`,
    [req.userId!]
  ))!;
  res.json({ averageScore: row.avgScore || 0, responseCount: row.count });
}));

activityRouter.post("/broadcasts", asyncHandler(async (req: AuthedRequest, res: Response) => {
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
}));

activityRouter.get("/broadcasts/mine", asyncHandler(async (req: AuthedRequest, res: Response) => {
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
}));

activityRouter.post("/conference-actions", asyncHandler(async (req: AuthedRequest, res: Response) => {
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
}));

activityRouter.get("/conference-actions/mine", asyncHandler(async (req: AuthedRequest, res: Response) => {
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
}));

function toExternalPaperDTO(row: ExternalPaperMatchRow) {
  return {
    doi: row.doi,
    title: row.title,
    venue: row.venue,
    year: row.year,
    url: row.url,
  };
}

// Real conference papers matched by name against three free, public, zero-signup indexes —
// CrossRef, Semantic Scholar, and DBLP — the one option that needs nothing extra from the
// account beyond the name it already has. Names collide, so a candidate is never shown as
// "theirs" until they explicitly confirm it via the /decide route below; already-decided
// entries (confirmed or dismissed) are excluded from future candidate lists, and the same paper
// indexed by more than one source is de-duplicated by normalized title.
// A middle name helps a person distinguish themselves from others sharing their first and last
// name, but it's not something every index actually stores — DBLP in particular resolves
// `author:X:` against one specific normalized name string per person, not a fuzzy ranking, so a
// query for "Assad Hadi Ghazwani" finds nothing there if DBLP's own record for that person is
// just "Assad Ghazwani". Searching only the full name would then silently lose real matches on
// exactly the source most likely to have them, for anyone whose middle name isn't in every
// index's own record. Both forms are searched and merged, so a real match surfaces regardless of
// which name form the index that has it happens to use.
function buildNameVariants(fullName: string): string[] {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 2) return [fullName.trim()];
  const firstLastOnly = `${parts[0]} ${parts[parts.length - 1]}`;
  return [fullName.trim(), firstLastOnly];
}

activityRouter.get("/external-papers/mine", asyncHandler(async (req: AuthedRequest, res: Response) => {
  // Each source caches its own results per name for 24 hours to avoid hammering a free public
  // API on every profile visit. That means an unconditional re-search (after correcting a name,
  // or just wanting to check for something newly published) would otherwise silently hand back
  // yesterday's cached answer under the same name. `force` is how "search again" means it.
  const force = req.query.force === "true";
  const user = await dbGet<{ name: string }>("SELECT name FROM users WHERE id = ?", [req.userId!]);
  const decided = await dbAll<ExternalPaperMatchRow>("SELECT * FROM external_paper_matches WHERE user_id = ?", [
    req.userId!,
  ]);
  const decidedDois = new Set(decided.map((r) => r.doi));

  const nameVariants = user?.name ? buildNameVariants(user.name) : [];
  const perVariantResults = await Promise.all(
    nameVariants.map((name) =>
      Promise.all([
        searchCrossRefConferencePapers(name, force),
        searchSemanticScholarConferencePapers(name, force),
        searchDblpConferencePapers(name, force),
      ])
    )
  );

  const merged = perVariantResults.flatMap(([crossRef, semanticScholar, dblp]) => [
    ...crossRef.map((c) => ({ doi: c.doi, title: c.title, venue: c.venue, year: c.year, url: c.url })),
    ...semanticScholar.map((c) => ({ doi: c.id, title: c.title, venue: c.venue, year: c.year, url: c.url })),
    ...dblp.map((c) => ({ doi: c.id, title: c.title, venue: c.venue, year: c.year, url: c.url })),
  ]);

  const seenTitles = new Set<string>();
  const candidates = merged.filter((c) => {
    if (decidedDois.has(c.doi)) return false;
    const normalizedTitle = c.title.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seenTitles.has(normalizedTitle)) return false;
    seenTitles.add(normalizedTitle);
    return true;
  });

  res.json({
    confirmed: decided.filter((r) => r.status === "confirmed").map(toExternalPaperDTO),
    candidates,
  });
}));

activityRouter.post("/external-papers/decide", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const doi = typeof body.doi === "string" ? body.doi.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const decision = body.decision === "confirmed" || body.decision === "dismissed" ? body.decision : null;
  if (!doi || !title || !decision) {
    return res.status(400).json({ error: "doi, title, and a valid decision are required" });
  }

  const id = `epm_${crypto.randomUUID()}`;
  try {
    await dbRun(
      `INSERT INTO external_paper_matches (id, user_id, doi, title, venue, year, url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        req.userId!,
        doi,
        title,
        typeof body.venue === "string" ? body.venue : null,
        typeof body.year === "string" ? body.year : null,
        typeof body.url === "string" ? body.url : null,
        decision,
      ]
    );
  } catch {
    // Already decided this DOI — update the decision instead of erroring.
    await dbRun("UPDATE external_paper_matches SET status = ? WHERE user_id = ? AND doi = ?", [
      decision,
      req.userId!,
      doi,
    ]);
  }

  res.status(201).json({ ok: true });
}));

// Conferences created via the organizer wizard — stored as an opaque JSON blob since the
// client-side Conference shape is large and nested; every account can see every created
// conference, mirroring the platform-wide submissions/registrations views elsewhere.
activityRouter.post("/conferences", asyncHandler(async (req: AuthedRequest, res: Response) => {
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
}));

activityRouter.get("/conferences", asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const rows = await dbAll<CreatedConferenceRow>("SELECT * FROM created_conferences ORDER BY created_at DESC");
  res.json({ conferences: rows.map((row) => JSON.parse(row.data)) });
}));

// Only the conferences this specific organizer created — used to scope the Organizer Dashboard
// (stats, analytics, committee roster, etc.) to their own data instead of every conference on
// the platform.
activityRouter.get("/conferences/mine", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const rows = await dbAll<CreatedConferenceRow>(
    "SELECT * FROM created_conferences WHERE organizer_id = ? ORDER BY created_at DESC",
    [req.userId!]
  );
  res.json({ conferences: rows.map((row) => JSON.parse(row.data)) });
}));

// Real activity on conferences this organizer created — sponsorship/committee interest and new
// abstract submissions — so the organizer's notification bell can surface genuine events instead
// of demo content.
activityRouter.get("/organizer/activity-feed", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const myConferences = await dbAll<{ id: string }>("SELECT id FROM created_conferences WHERE organizer_id = ?", [
    req.userId!,
  ]);
  if (myConferences.length === 0) {
    return res.json({ items: [] });
  }

  const ids = myConferences.map((c) => c.id);
  const placeholders = ids.map(() => "?").join(", ");

  const interestRows = await dbAll<{
    id: string;
    conference_title: string;
    kind: "committee_interest" | "sponsorship_inquiry";
    created_at: string;
    actor_name: string;
  }>(
    `SELECT cia.id, cia.conference_title, cia.kind, cia.created_at, u.name as actor_name
     FROM conference_interest_actions cia
     JOIN users u ON u.id = cia.user_id
     WHERE cia.conference_id IN (${placeholders})
     ORDER BY cia.created_at DESC`,
    ids
  );

  const submissionRows = await dbAll<{
    id: string;
    conference_title: string;
    title: string;
    submission_date: string;
    submitter_name: string;
  }>(
    `SELECT s.id, s.conference_title, s.title, s.submission_date, u.name as submitter_name
     FROM submissions s
     JOIN users u ON u.id = s.submitter_id
     WHERE s.conference_id IN (${placeholders})
     ORDER BY s.submission_date DESC`,
    ids
  );

  const items = [
    ...interestRows.map((row) => ({
      id: `cia_${row.id}`,
      kind: row.kind,
      conferenceTitle: row.conference_title,
      actorName: row.actor_name,
      createdAt: row.created_at,
    })),
    ...submissionRows.map((row) => ({
      id: `sub_${row.id}`,
      kind: "abstract_submission" as const,
      conferenceTitle: row.conference_title,
      abstractTitle: row.title,
      actorName: row.submitter_name,
      createdAt: row.submission_date,
    })),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  res.json({ items });
}));

function toSelfReportedAttendanceDTO(row: SelfReportedAttendanceRow) {
  return {
    id: row.id,
    conferenceName: row.conference_name,
    location: row.location,
    year: row.year,
    role: row.role,
    proofImage: row.proof_image,
    createdAt: row.created_at,
  };
}

const MAX_PROOF_IMAGE_LENGTH = 2_000_000; // ~1.5MB decoded, comfortably under the request body limit

// Plain attendance (no presentation) has no real, public, name-searchable source anywhere —
// attendee lists are private to organizers. This is the one honest way to capture it: the
// account types it in themselves, and it's always returned/labeled as self-reported, never
// mixed with Conference Gate's own verified registrations.
activityRouter.get("/self-reported-attendance/mine", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const rows = await dbAll<SelfReportedAttendanceRow>(
    "SELECT * FROM self_reported_attendance WHERE user_id = ? ORDER BY created_at DESC",
    [req.userId!]
  );
  res.json({ entries: rows.map(toSelfReportedAttendanceDTO) });
}));

activityRouter.post("/self-reported-attendance", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const conferenceName = typeof body.conferenceName === "string" ? body.conferenceName.trim() : "";
  if (!conferenceName) {
    return res.status(400).json({ error: "Conference name is required" });
  }

  if (body.proofImage !== undefined && body.proofImage !== null) {
    if (typeof body.proofImage !== "string" || !body.proofImage.startsWith("data:image/")) {
      return res.status(400).json({ error: "proofImage must be an image data URL" });
    }
    if (body.proofImage.length > MAX_PROOF_IMAGE_LENGTH) {
      return res.status(400).json({ error: "Image is too large" });
    }
  }

  const id = `sra_${crypto.randomUUID()}`;
  await dbRun(
    `INSERT INTO self_reported_attendance (id, user_id, conference_name, location, year, role, proof_image)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      req.userId!,
      conferenceName,
      typeof body.location === "string" && body.location.trim() ? body.location.trim() : null,
      typeof body.year === "string" && body.year.trim() ? body.year.trim() : null,
      typeof body.role === "string" && body.role.trim() ? body.role.trim() : null,
      typeof body.proofImage === "string" ? body.proofImage : null,
    ]
  );

  const row = (await dbGet<SelfReportedAttendanceRow>("SELECT * FROM self_reported_attendance WHERE id = ?", [id]))!;
  res.status(201).json({ entry: toSelfReportedAttendanceDTO(row) });
}));

activityRouter.delete("/self-reported-attendance/:id", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const row = await dbGet<SelfReportedAttendanceRow>("SELECT * FROM self_reported_attendance WHERE id = ?", [
    req.params.id,
  ]);
  if (!row || row.user_id !== req.userId) {
    return res.status(404).json({ error: "Not found" });
  }
  await dbRun("DELETE FROM self_reported_attendance WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
}));

function toSelfReportedCommitteePositionDTO(row: SelfReportedCommitteePositionRow) {
  return {
    id: row.id,
    conferenceName: row.conference_name,
    position: row.position,
    year: row.year,
    proofImage: row.proof_image,
    createdAt: row.created_at,
  };
}

// Same honesty pattern as self-reported-attendance above — committee/chair service has no
// public, name-searchable source either, so this is self-reported by the account.
activityRouter.get("/committee-positions/mine", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const rows = await dbAll<SelfReportedCommitteePositionRow>(
    "SELECT * FROM self_reported_committee_positions WHERE user_id = ? ORDER BY created_at DESC",
    [req.userId!]
  );
  res.json({ entries: rows.map(toSelfReportedCommitteePositionDTO) });
}));

activityRouter.post("/committee-positions", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const conferenceName = typeof body.conferenceName === "string" ? body.conferenceName.trim() : "";
  const position = typeof body.position === "string" ? body.position.trim() : "";
  if (!conferenceName || !position) {
    return res.status(400).json({ error: "Conference name and position are required" });
  }

  if (body.proofImage !== undefined && body.proofImage !== null) {
    if (typeof body.proofImage !== "string" || !body.proofImage.startsWith("data:image/")) {
      return res.status(400).json({ error: "proofImage must be an image data URL" });
    }
    if (body.proofImage.length > MAX_PROOF_IMAGE_LENGTH) {
      return res.status(400).json({ error: "Image is too large" });
    }
  }

  const id = `scp_${crypto.randomUUID()}`;
  await dbRun(
    `INSERT INTO self_reported_committee_positions (id, user_id, conference_name, position, year, proof_image)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      req.userId!,
      conferenceName,
      position,
      typeof body.year === "string" && body.year.trim() ? body.year.trim() : null,
      typeof body.proofImage === "string" ? body.proofImage : null,
    ]
  );

  const row = (await dbGet<SelfReportedCommitteePositionRow>(
    "SELECT * FROM self_reported_committee_positions WHERE id = ?",
    [id]
  ))!;
  res.status(201).json({ entry: toSelfReportedCommitteePositionDTO(row) });
}));

activityRouter.delete("/committee-positions/:id", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const row = await dbGet<SelfReportedCommitteePositionRow>(
    "SELECT * FROM self_reported_committee_positions WHERE id = ?",
    [req.params.id]
  );
  if (!row || row.user_id !== req.userId) {
    return res.status(404).json({ error: "Not found" });
  }
  await dbRun("DELETE FROM self_reported_committee_positions WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
}));
