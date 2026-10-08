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
  ReviewOpportunityRow,
  ProfessionalOpportunityRow,
  ProfessionalOpportunityInterestRow,
  ProfessionalInvitationRow,
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
  UserRow,
} from "./db";
import { AuthedRequest, requireAuth } from "./auth";
import { asyncHandler } from "./asyncHandler";
import { searchCrossRefConferencePapers } from "./crossref";
import { searchSemanticScholarConferencePapers } from "./semanticscholar";
import { searchDblpConferencePapers } from "./dblp";
import { searchOpenAlexConferencePapers } from "./openalex";
import { searchWebForConferenceFacts } from "./braveSearch";
import { resolvePaidAccountContext, canOperateWorkspace } from "./workspaceAccess";
import { buildProfessionalTrust } from "./professionalTrust";
import { buildMeetingMinutesDocxBuffer, meetingMinutesEmailConfigured, meetingMinutesFilename, sendMeetingMinutesEmail } from "./meetingMinutesDocument";

export const activityRouter = Router();
activityRouter.use(requireAuth);

async function organizerWorkspaceContext(req: AuthedRequest, res: Response, write = false) {
  const context = await resolvePaidAccountContext(req.userId!, "organizer");
  if (!context) {
    res.status(403).json({ error: "Organizer account required." });
    return null;
  }
  if (!context.paid) {
    res.status(402).json({ error: "Organizer Pro subscription required." });
    return null;
  }
  if (write && !canOperateWorkspace(context.workspaceRole)) {
    res.status(403).json({ error: "This workspace seat is read-only." });
    return null;
  }
  return context;
}

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

function normalizedOrganizationKey(value: unknown): string {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// "Reviewer Assignment" only becomes reachable once a real assignment row exists — never assumed
// just because a submission is sitting unreviewed, since organizers may not have invited anyone yet.
function deriveVisualTimeline(status: string, hasReviews: boolean, hasAssignment: boolean) {
  const currentIndex = FINAL_STATUSES.includes(status) ? 4 : hasReviews ? 3 : hasAssignment ? 2 : 1;
  return TIMELINE_LABELS.map((label, idx) => ({
    label,
    status: idx < currentIndex || (idx === currentIndex && currentIndex === 4) ? "completed" : idx === currentIndex ? "current" : "upcoming",
  }));
}

export async function createNotification(userId: string, type: string, title: string, message: string) {
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
    const organizerContext = await organizerWorkspaceContext(req, res, true);
    if (!organizerContext) return;
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
    const reviewerTrust = await buildProfessionalTrust(reviewerId);
    if (!reviewerTrust?.reviewerEligible) {
      return res.status(409).json({
        error: reviewerTrust?.eligibilityReason || "This Professional is not eligible for the reviewer pool."
      });
    }

    // Only the conference's own organizer may invite reviewers to its submissions. Conferences
    // outside the organizer-wizard catalog (created_conferences) have no owner account to check
    // against, so those stay open — same as their existing platform-wide visibility.
    const ownedConference = await dbGet<{ organizer_id: string }>(
      "SELECT organizer_id FROM created_conferences WHERE id = ?",
      [submission.conference_id]
    );
    if (ownedConference && ownedConference.organizer_id !== organizerContext.accountId) {
      return res.status(403).json({ error: "Only this conference's organizer workspace can invite reviewers to it" });
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

  if (body.attachment && typeof body.attachment === "object") {
    const fileName = String(body.attachment.fileName || "").trim().slice(0, 240);
    const mimeType = String(body.attachment.mimeType || "").trim().toLowerCase();
    const dataBase64 = String(body.attachment.dataBase64 || "").replace(/^data:[^;]+;base64,/, "").trim();
    const allowedMime = new Set(["application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
    const byteSize = Math.floor((dataBase64.length * 3) / 4);
    if (fileName && dataBase64 && allowedMime.has(mimeType) && byteSize > 0 && byteSize <= 5 * 1024 * 1024) {
      await dbRun("INSERT INTO submission_documents(id,submission_id,uploader_id,kind,file_name,mime_type,byte_size,data_base64) VALUES(?,?,?,?,?,?,?,?)", [`doc_${crypto.randomUUID()}`,id,req.userId!,"author_original",fileName,mimeType,byteSize,dataBase64]);
    }
  }

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

  // A review only counts as a "verified" peer review if this account was actually invited to
  // review this specific submission — otherwise anyone could score and decide on any paper on
  // the platform just by knowing its id.
  const assignment = await dbGet<{ id: string }>(
    "SELECT id FROM submission_reviewer_assignments WHERE submission_id = ? AND reviewer_id = ?",
    [submission.id, req.userId!]
  );
  if (!assignment) {
    return res.status(403).json({ error: "You haven't been invited to review this abstract" });
  }
  const alreadyReviewed = await dbGet<{ id: string }>(
    "SELECT id FROM submission_reviews WHERE submission_id = ? AND reviewer_id = ?",
    [submission.id, req.userId!]
  );
  if (alreadyReviewed) {
    return res.status(409).json({ error: "You've already submitted a review for this abstract" });
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

function toReviewOpportunityDTO(row: ReviewOpportunityRow, abstractsCount: number) {
  return {
    id: row.id,
    conferenceId: row.conference_id,
    conferenceTitle: row.conference_title,
    organizerName: row.organizer_name,
    topic: row.topic,
    track: row.track || "",
    expertiseRequired: JSON.parse(row.expertise_required),
    reviewPeriod: row.review_period || "",
    deadline: row.deadline || "",
    expectedWorkload: row.expected_workload || "",
    abstractsCount,
  };
}

// How many real submissions this opportunity's abstracts figure actually covers — computed live
// from the submissions table rather than a number the organizer typed in, so it can't drift or
// be inflated.
async function countAbstractsForOpportunity(conferenceId: string, track: string | null): Promise<number> {
  const row = track
    ? await dbGet<{ count: number }>("SELECT COUNT(*) as count FROM submissions WHERE conference_id = ? AND track = ?", [
        conferenceId,
        track,
      ])
    : await dbGet<{ count: number }>("SELECT COUNT(*) as count FROM submissions WHERE conference_id = ?", [
        conferenceId,
      ]);
  return row?.count || 0;
}

// The real Review Opportunity Marketplace — every organizer's own published call for reviewers,
// visible to every reviewer on the platform (same visibility model as created_conferences and
// sponsorship packages).
activityRouter.get(
  "/review-opportunities",
  asyncHandler(async (_req: AuthedRequest, res: Response) => {
    const rows = await dbAll<ReviewOpportunityRow>("SELECT * FROM review_opportunities ORDER BY created_at DESC");
    const dtos = await Promise.all(
      rows.map(async (row) => toReviewOpportunityDTO(row, await countAbstractsForOpportunity(row.conference_id, row.track)))
    );
    res.json({ opportunities: dtos });
  })
);

// An organizer publishes a real call for reviewers on one of their own conferences.
activityRouter.post(
  "/review-opportunities",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const organizerContext = await organizerWorkspaceContext(req, res, true);
    if (!organizerContext) return;
    const accountId = organizerContext.accountId;
    const body = req.body || {};
    if (typeof body.conferenceId !== "string" || !body.conferenceId) {
      return res.status(400).json({ error: "conferenceId is required" });
    }
    if (typeof body.topic !== "string" || !body.topic.trim()) {
      return res.status(400).json({ error: "A review topic is required" });
    }

    const conference = await dbGet<CreatedConferenceRow>(
      "SELECT * FROM created_conferences WHERE id = ? AND organizer_id = ?",
      [body.conferenceId, accountId]
    );
    if (!conference) {
      return res.status(404).json({ error: "You can only publish a call for reviewers for conferences in this workspace." });
    }
    const conferenceData = JSON.parse(conference.data);
    const organizer = organizerContext.accountOwner;

    const id = `ro_${crypto.randomUUID()}`;
    const track = typeof body.track === "string" && body.track.trim() ? body.track.trim() : null;
    await dbRun(
      `INSERT INTO review_opportunities (
        id, conference_id, conference_title, organizer_id, organizer_name, topic, track,
        expertise_required, review_period, deadline, expected_workload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        body.conferenceId,
        conferenceData.title || conference.id,
        accountId,
        organizer?.name || "Organizer",
        body.topic.trim(),
        track,
        JSON.stringify(Array.isArray(body.expertiseRequired) ? body.expertiseRequired : []),
        typeof body.reviewPeriod === "string" ? body.reviewPeriod : null,
        typeof body.deadline === "string" ? body.deadline : null,
        typeof body.expectedWorkload === "string" ? body.expectedWorkload : null,
      ]
    );

    const row = (await dbGet<ReviewOpportunityRow>("SELECT * FROM review_opportunities WHERE id = ?", [id]))!;
    res.status(201).json({ opportunity: toReviewOpportunityDTO(row, await countAbstractsForOpportunity(row.conference_id, row.track)) });
  })
);

// Lets an organizer close a call for reviewers once it's no longer needed.
activityRouter.delete(
  "/review-opportunities/:id",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const organizerContext = await organizerWorkspaceContext(req, res, true);
    if (!organizerContext) return;
    const opportunity = await dbGet<ReviewOpportunityRow>("SELECT * FROM review_opportunities WHERE id = ?", [
      req.params.id,
    ]);
    if (!opportunity) {
      return res.status(404).json({ error: "Opportunity not found" });
    }
    if (opportunity.organizer_id !== organizerContext.accountId) {
      return res.status(403).json({ error: "This opportunity belongs to another organizer workspace." });
    }
    await dbRun("DELETE FROM review_opportunities WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  })
);

function tokenSet(values: Array<string | null | undefined>): Set<string> {
  const stop = new Set(["and","the","for","with","from","into","using","conference","general","science","engineering"]);
  return new Set(
    values
      .flatMap((value) => String(value || "").toLowerCase().split(/[^a-z0-9+#.-]+/g))
      .map((value) => value.trim())
      .filter((value) => value.length >= 3 && !stop.has(value))
  );
}

function parseStringArray(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

// Paid Organizer Pro professional directory. Only professional-facing profile fields and verified
// platform activity counts are returned; email/private account data never leaves the server.
activityRouter.get(
  "/professionals/search",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const organizerContext = await organizerWorkspaceContext(req, res);
    if (!organizerContext) return;
    const organizer = organizerContext.actor;
    const accountId = organizerContext.accountId;

    const roleType =
      req.query.roleType === "committee" || req.query.roleType === "chair" || req.query.roleType === "speaker"
        ? req.query.roleType
        : "committee";
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 160) : "";
    const conferenceId = typeof req.query.conferenceId === "string" ? req.query.conferenceId : "";
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 40)));

    let conferenceTerms: string[] = [];
    if (conferenceId) {
      const conf = await dbGet<CreatedConferenceRow>(
        "SELECT * FROM created_conferences WHERE id = ? AND organizer_id = ?",
        [conferenceId, accountId]
      );
      if (conf) {
        try {
          const data = JSON.parse(conf.data);
          conferenceTerms = [
            data.title,
            data.industry,
            ...(Array.isArray(data.topics) ? data.topics : []),
            ...(Array.isArray(data.tracks) ? data.tracks.map((track: any) => typeof track === "string" ? track : track?.name) : []),
          ].filter(Boolean);
        } catch {}
      }
    }

    const professionals = await dbAll<UserRow>(
      `SELECT * FROM users
        WHERE role = 'professional'
          AND lower(email) NOT LIKE '%@conferencegate.invalid'
        ORDER BY created_at DESC
        LIMIT 500`
    );
    const queryTokens = tokenSet([q, ...conferenceTerms]);

    const results = [];
    for (const professional of professionals) {
      const available =
        roleType === "committee"
          ? !!professional.committee_available
          : roleType === "chair"
            ? !!professional.session_chair_available
            : !!professional.speaker_available;
      if (!available) continue;

      const expertise = parseStringArray(professional.professional_expertise);
      const specialization = parseStringArray(professional.technical_specialization);
      const interests = parseStringArray(professional.research_interests);
      const regions = parseStringArray(professional.preferred_regions);
      const linkedin = await dbGet<any>(
        "SELECT experience,publications,certifications FROM linkedin_profile_enrichment WHERE user_id=?",
        [professional.id]
      ).catch(() => undefined);
      const parseEvidence = (value: unknown): any[] => {
        if (Array.isArray(value)) return value;
        if (typeof value !== "string") return [];
        try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
      };
      const positionRows = parseEvidence(linkedin?.experience);
      const publicationRows = parseEvidence(linkedin?.publications);
      const certificationRows = parseEvidence(linkedin?.certifications);
      const cutoffYear = new Date().getUTCFullYear() - 7;
      const evidenceText = (item: any) => typeof item === "string" ? item : [item?.title,item?.position,item?.role,item?.companyName,item?.company,item?.organization,item?.name,item?.issuer,item?.authority,item?.dateRange,item?.startDate,item?.endDate].filter(Boolean).join(" · ");
      const evidenceYear = (item: any) => {
        const text = evidenceText(item);
        const years = text.match(/\b(?:19|20)\d{2}\b/g) || [];
        return years.length ? Math.max(...years.map(Number)) : new Date().getUTCFullYear();
      };
      const recentPositions = positionRows.filter((item: any) => evidenceYear(item) >= cutoffYear).map(evidenceText).filter(Boolean).slice(0, 12);
      const certifications = certificationRows.map(evidenceText).filter(Boolean).slice(0, 20);
      const profileTokens = tokenSet([
        professional.name, professional.title, professional.organization, professional.bio,
        ...expertise, ...specialization, ...interests, ...regions, ...recentPositions, ...certifications,
      ]);

      if (q && !String([
        professional.name,professional.title,professional.organization,professional.country,
        ...expertise,...specialization,...interests,...recentPositions,...certifications,
      ].filter(Boolean).join(" ")).toLowerCase().includes(q.toLowerCase()) && queryTokens.size > 0) {
        const hasOverlap = [...queryTokens].some((token) => profileTokens.has(token));
        if (!hasOverlap) continue;
      }

      let overlap = 0;
      for (const token of queryTokens) if (profileTokens.has(token)) overlap += 1;
      const relevance = queryTokens.size ? overlap / queryTokens.size : 0.5;

      const [reviewCountRow, roleCountRow, trust] = await Promise.all([
        dbGet<{ count: number }>("SELECT COUNT(*) as count FROM submission_reviews WHERE reviewer_id = ?", [professional.id]),
        dbGet<{ count: number }>("SELECT COUNT(*) as count FROM professional_invitations WHERE professional_id = ? AND status = 'completed'", [professional.id]),
        buildProfessionalTrust(professional.id),
      ]);
      const reviewCount = reviewCountRow?.count || 0;
      const completedRoleCount = roleCountRow?.count || 0;
      const evidenceScore = Math.min(1, (reviewCount / 10) * 0.5 + (completedRoleCount / 5) * 0.3 + Math.min(0.2, (trust?.conferenceGateIndex || 0) / 500));
      const profileCompleteness = [professional.title, professional.organization, professional.bio, professional.country, expertise.length, specialization.length, interests.length, regions.length, recentPositions.length, certifications.length].filter(Boolean).length / 10;
      const score = Math.round(Math.max(0, Math.min(1, relevance * 0.6 + evidenceScore * 0.25 + profileCompleteness * 0.15)) * 100);

      results.push({
        id: professional.id, name: professional.name, title: professional.title || "",
        organization: professional.organization || "", country: professional.country || "", avatar: professional.avatar || null,
        expertise, technicalSpecialization: specialization, researchInterests: interests, preferredRegions: regions,
        identityVerified: Boolean(professional.linkedin_id || professional.google_id),
        reviewerAvailable: Boolean(professional.reviewer_available), committeeAvailable: Boolean(professional.committee_available),
        sessionChairAvailable: Boolean(professional.session_chair_available), speakerAvailable: Boolean(professional.speaker_available),
        verifiedReviews: reviewCount, verifiedCompletedRoles: completedRoleCount, matchScore: score,
        reviewerEligible: Boolean(trust?.reviewerEligible), reviewerEligibilityReason: trust?.eligibilityReason || "",
        conferenceGateIndex: trust?.conferenceGateIndex || 0, experienceYears: trust?.evidence.experienceYears || 0,
        publicationCount: publicationRows.length, recentPositions, certifications,
      });
    }

    results.sort((a, b) => b.matchScore - a.matchScore || b.verifiedCompletedRoles - a.verifiedCompletedRoles || b.verifiedReviews - a.verifiedReviews);
    res.json({ professionals: results.slice(0, limit) });
  })
);

function toProfessionalOpportunityDTO(row: ProfessionalOpportunityRow) {
  let expertiseRequired: string[] = [];
  let preferredRegions: string[] = [];
  try { expertiseRequired = JSON.parse(row.expertise_required || "[]"); } catch {}
  try { preferredRegions = JSON.parse(row.preferred_regions || "[]"); } catch {}
  return {
    id: row.id,
    conferenceId: row.conference_id,
    conferenceTitle: row.conference_title,
    organizerId: row.organizer_id,
    organizerName: row.organizer_name,
    roleType: row.role_type,
    title: row.title,
    description: row.description || "",
    expertiseRequired: Array.isArray(expertiseRequired) ? expertiseRequired : [],
    preferredRegions: Array.isArray(preferredRegions) ? preferredRegions : [],
    deadline: row.deadline || "",
    status: row.status,
    createdAt: row.created_at,
  };
}

// Unified non-review opportunity feed for free Professional accounts. These records are explicit
// organizer-published openings only; ConferenceGate never infers a vacancy from a conference page.
activityRouter.get(
  "/professional-opportunities",
  asyncHandler(async (_req: AuthedRequest, res: Response) => {
    const rows = await dbAll<ProfessionalOpportunityRow>(
      `SELECT * FROM professional_opportunities
        WHERE status = 'active'
          AND (deadline IS NULL OR deadline = '' OR date(deadline) >= date('now'))
        ORDER BY created_at DESC`
    );
    res.json({ opportunities: rows.map(toProfessionalOpportunityDTO) });
  })
);

// Backend publishing foundation for Phase 2. The organizer UI is intentionally not added in
// Phase 1, but the contract is ready and ownership is enforced against created_conferences.
activityRouter.post(
  "/professional-opportunities",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const organizerContext = await organizerWorkspaceContext(req, res, true);
    if (!organizerContext) return;
    const accountId = organizerContext.accountId;
    const body = req.body || {};
    const roleType =
      body.roleType === "committee" || body.roleType === "chair" || body.roleType === "speaker"
        ? body.roleType
        : null;
    if (!roleType) {
      return res.status(400).json({ error: "roleType must be committee, chair, or speaker" });
    }
    if (typeof body.conferenceId !== "string" || !body.conferenceId) {
      return res.status(400).json({ error: "conferenceId is required" });
    }
    if (typeof body.title !== "string" || !body.title.trim()) {
      return res.status(400).json({ error: "Opportunity title is required" });
    }

    const conference = await dbGet<CreatedConferenceRow>(
      "SELECT * FROM created_conferences WHERE id = ? AND organizer_id = ?",
      [body.conferenceId, accountId]
    );
    if (!conference) {
      return res.status(404).json({ error: "You can only publish opportunities for conferences in this workspace." });
    }

    const conferenceData = JSON.parse(conference.data);
    const organizer = organizerContext.accountOwner;
    const id = `po_${crypto.randomUUID()}`;
    const expertise = Array.isArray(body.expertiseRequired)
      ? [...new Set(body.expertiseRequired.filter((v: unknown) => typeof v === "string").map((v: string) => v.trim()).filter(Boolean))].slice(0, 30)
      : [];
    const regions = Array.isArray(body.preferredRegions)
      ? [...new Set(body.preferredRegions.filter((v: unknown) => typeof v === "string").map((v: string) => v.trim()).filter(Boolean))].slice(0, 20)
      : [];

    await dbRun(
      `INSERT INTO professional_opportunities(
        id,conference_id,conference_title,organizer_id,organizer_name,role_type,title,description,
        expertise_required,preferred_regions,deadline,status
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,'active')`,
      [
        id,
        body.conferenceId,
        conferenceData.title || conference.id,
        accountId,
        organizer?.name || "Organizer",
        roleType,
        body.title.trim(),
        typeof body.description === "string" ? body.description.trim() || null : null,
        JSON.stringify(expertise),
        JSON.stringify(regions),
        typeof body.deadline === "string" ? body.deadline.trim() || null : null,
      ]
    );

    const row = (await dbGet<ProfessionalOpportunityRow>("SELECT * FROM professional_opportunities WHERE id = ?", [id]))!;
    res.status(201).json({ opportunity: toProfessionalOpportunityDTO(row) });
  })
);

activityRouter.delete(
  "/professional-opportunities/:id",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const organizerContext = await organizerWorkspaceContext(req, res, true);
    if (!organizerContext) return;
    const opportunity = await dbGet<ProfessionalOpportunityRow>(
      "SELECT * FROM professional_opportunities WHERE id = ?",
      [req.params.id]
    );
    if (!opportunity) return res.status(404).json({ error: "Opportunity not found" });
    if (opportunity.organizer_id !== organizerContext.accountId) {
      return res.status(403).json({ error: "This opportunity belongs to another organizer workspace." });
    }
    await dbRun("UPDATE professional_opportunities SET status = 'closed' WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  })
);

activityRouter.get(
  "/professional-opportunities/interests/mine",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const rows = await dbAll<ProfessionalOpportunityInterestRow>(
      "SELECT * FROM professional_opportunity_interests WHERE professional_id = ? ORDER BY created_at DESC",
      [req.userId!]
    );
    res.json({ opportunityIds: rows.map((row) => row.opportunity_id) });
  })
);

activityRouter.post(
  "/professional-opportunities/:id/interest",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const user = await dbGet<{ role: string; name: string }>("SELECT role,name FROM users WHERE id = ?", [req.userId!]);
    if (!user || user.role !== "professional") {
      return res.status(403).json({ error: "Only Professional accounts can express interest in professional roles." });
    }
    const opportunity = await dbGet<ProfessionalOpportunityRow>(
      "SELECT * FROM professional_opportunities WHERE id = ? AND status = 'active'",
      [req.params.id]
    );
    if (!opportunity) return res.status(404).json({ error: "Opportunity not found or no longer active" });

    const existing = await dbGet<ProfessionalOpportunityInterestRow>(
      "SELECT * FROM professional_opportunity_interests WHERE opportunity_id = ? AND professional_id = ?",
      [opportunity.id, req.userId!]
    );
    if (!existing) {
      await dbRun(
        "INSERT INTO professional_opportunity_interests(id,opportunity_id,professional_id) VALUES(?,?,?)",
        [`poi_${crypto.randomUUID()}`, opportunity.id, req.userId!]
      );
      await createNotification(
        opportunity.organizer_id,
        "invitation",
        "New professional interest",
        `${user.name} is interested in ${opportunity.title} for ${opportunity.conference_title}.`
      );
    }
    res.status(existing ? 200 : 201).json({ interested: true });
  })
);

activityRouter.delete(
  "/professional-opportunities/:id/interest",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    await dbRun(
      "DELETE FROM professional_opportunity_interests WHERE opportunity_id = ? AND professional_id = ?",
      [req.params.id, req.userId!]
    );
    res.json({ interested: false });
  })
);

function toProfessionalInvitationDTO(row: ProfessionalInvitationRow) {
  return {
    id: row.id,
    organizerId: row.organizer_id,
    professionalId: row.professional_id,
    conferenceId: row.conference_id,
    conferenceTitle: row.conference_title,
    opportunityId: row.opportunity_id,
    roleType: row.role_type,
    title: row.title,
    message: row.message || "",
    status: row.status,
    createdAt: row.created_at,
    respondedAt: row.responded_at,
    completedAt: row.completed_at,
  };
}

activityRouter.get(
  "/professional-invitations/mine",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const rows = await dbAll<ProfessionalInvitationRow>(
      "SELECT * FROM professional_invitations WHERE professional_id = ? ORDER BY created_at DESC",
      [req.userId!]
    );
    res.json({ invitations: rows.map(toProfessionalInvitationDTO) });
  })
);

activityRouter.post(
  "/professional-invitations/:id/respond",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const decision = req.body?.decision === "accepted" || req.body?.decision === "declined" ? req.body.decision : null;
    if (!decision) return res.status(400).json({ error: "decision must be accepted or declined" });

    const invitation = await dbGet<ProfessionalInvitationRow>(
      "SELECT * FROM professional_invitations WHERE id = ? AND professional_id = ?",
      [req.params.id, req.userId!]
    );
    if (!invitation) return res.status(404).json({ error: "Invitation not found" });
    if (invitation.status !== "pending") {
      return res.status(409).json({ error: "This invitation has already been answered." });
    }

    await dbRun(
      "UPDATE professional_invitations SET status = ?, responded_at = datetime('now') WHERE id = ?",
      [decision, invitation.id]
    );
    const professional = await dbGet<{ name: string }>("SELECT name FROM users WHERE id = ?", [req.userId!]);
    await createNotification(
      invitation.organizer_id,
      "invitation",
      decision === "accepted" ? "Professional invitation accepted" : "Professional invitation declined",
      `${professional?.name || "A professional"} ${decision} your ${invitation.title} invitation for ${invitation.conference_title}.`
    );

    const updated = (await dbGet<ProfessionalInvitationRow>("SELECT * FROM professional_invitations WHERE id = ?", [invitation.id]))!;
    res.json({ invitation: toProfessionalInvitationDTO(updated) });
  })
);

// Phase 2 organizer foundation: create a direct invitation to a specific professional.
activityRouter.post(
  "/professional-invitations",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const organizerContext = await organizerWorkspaceContext(req, res, true);
    if (!organizerContext) return;
    const accountId = organizerContext.accountId;
    const body = req.body || {};
    const roleType =
      body.roleType === "committee" || body.roleType === "chair" || body.roleType === "speaker"
        ? body.roleType
        : null;
    if (!roleType) return res.status(400).json({ error: "roleType must be committee, chair, or speaker" });
    if (typeof body.professionalId !== "string" || !body.professionalId) {
      return res.status(400).json({ error: "professionalId is required" });
    }
    if (typeof body.conferenceId !== "string" || !body.conferenceId) {
      return res.status(400).json({ error: "conferenceId is required" });
    }
    if (typeof body.title !== "string" || !body.title.trim()) {
      return res.status(400).json({ error: "Invitation title is required" });
    }

    const organizer = organizerContext.actor;
    const conference = await dbGet<CreatedConferenceRow>(
      "SELECT * FROM created_conferences WHERE id = ? AND organizer_id = ?",
      [body.conferenceId, accountId]
    );
    const recruitmentDraft = conference ? undefined : await dbGet<any>(
      "SELECT * FROM conference_recruitment_drafts WHERE id=? AND organizer_id=? AND status IN ('recruiting','ready')",
      [body.conferenceId, accountId]
    ).catch(() => undefined);
    if (!conference && !recruitmentDraft) {
      return res.status(404).json({ error: "You can only invite Professionals to a published conference or pre-wizard recruitment draft in this workspace." });
    }
    const professional = await dbGet<{ role: string; name: string }>(
      "SELECT role,name FROM users WHERE id = ?",
      [body.professionalId]
    );
    if (!professional || professional.role !== "professional") {
      return res.status(404).json({ error: "Professional account not found." });
    }

    const conferenceData = conference ? JSON.parse(conference.data) : { title: recruitmentDraft.title };
    const existing = await dbGet<ProfessionalInvitationRow>(
      `SELECT * FROM professional_invitations
        WHERE organizer_id = ? AND professional_id = ? AND conference_id = ? AND role_type = ?
          AND status IN ('pending','accepted')`,
      [accountId, body.professionalId, body.conferenceId, roleType]
    );
    if (existing) return res.status(409).json({ error: "An active invitation for this role already exists." });

    const id = `pinv_${crypto.randomUUID()}`;
    await dbRun(
      `INSERT INTO professional_invitations(
        id,organizer_id,professional_id,conference_id,conference_title,opportunity_id,role_type,title,message,status
      ) VALUES(?,?,?,?,?,?,?,?,?,'pending')`,
      [
        id,
        accountId,
        body.professionalId,
        body.conferenceId,
        conferenceData.title || conference.id,
        typeof body.opportunityId === "string" ? body.opportunityId : null,
        roleType,
        body.title.trim(),
        typeof body.message === "string" ? body.message.trim() || null : null,
      ]
    );
    await createNotification(
      body.professionalId,
      "invitation",
      "New conference role invitation",
      `${organizer.name} invited you as ${body.title.trim()} for ${conferenceData.title || conference.id}.`
    );
    const row = (await dbGet<ProfessionalInvitationRow>("SELECT * FROM professional_invitations WHERE id = ?", [id]))!;
    res.status(201).json({ invitation: toProfessionalInvitationDTO(row) });
  })
);

// Organizer marks an accepted role completed only after the service is actually delivered.
// Completion is the event that makes the role eligible for verified history/certificates.
activityRouter.post(
  "/professional-invitations/:id/complete",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const organizerContext = await organizerWorkspaceContext(req, res, true);
    if (!organizerContext) return;
    const invitation = await dbGet<ProfessionalInvitationRow>(
      "SELECT * FROM professional_invitations WHERE id = ? AND organizer_id = ?",
      [req.params.id, organizerContext.accountId]
    );
    if (!invitation) return res.status(404).json({ error: "Invitation not found" });
    if (invitation.status !== "accepted") {
      return res.status(409).json({ error: "Only an accepted invitation can be completed." });
    }
    await dbRun(
      "UPDATE professional_invitations SET status = 'completed', completed_at = datetime('now') WHERE id = ?",
      [invitation.id]
    );
    await createNotification(
      invitation.professional_id,
      "achievement",
      "Verified conference role completed",
      `Your ${invitation.title} role for ${invitation.conference_title} is now verified as completed.`
    );
    const updated = (await dbGet<ProfessionalInvitationRow>("SELECT * FROM professional_invitations WHERE id = ?", [invitation.id]))!;
    res.json({ invitation: toProfessionalInvitationDTO(updated) });
  })
);

activityRouter.post("/reviews/volunteer", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const trust = await buildProfessionalTrust(req.userId!);
  if (!trust?.reviewerEligible) {
    return res.status(403).json({ error: trust?.eligibilityReason || "Reviewer eligibility requirements are not met." });
  }
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

function toConferenceAttendanceDTO(row: any) {
  return {
    id: row.id,
    conferenceId: row.conference_id,
    conferenceTitle: row.conference_title,
    organizerName: row.organizer_name,
    startDate: row.start_date,
    endDate: row.end_date,
    location: row.location || "",
    sourceType: row.source_type === "conferencegate" ? "conferencegate" : "catalog",
    sourceUrl: row.source_url || null,
    attendedAt: row.attended_at,
  };
}

activityRouter.get("/attendance/mine", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const rows = await dbAll<any>(
    "SELECT * FROM conference_attendance WHERE user_id = ? ORDER BY start_date DESC, attended_at DESC",
    [req.userId!]
  );
  res.json({ attendance: rows.map(toConferenceAttendanceDTO) });
}));

activityRouter.post("/attendance", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const conferenceId = typeof body.conferenceId === "string" ? body.conferenceId.trim() : "";
  const conferenceTitle = typeof body.conferenceTitle === "string" ? body.conferenceTitle.trim() : "";
  const organizerName = typeof body.organizerName === "string" ? body.organizerName.trim() : "";
  const startDate = typeof body.startDate === "string" ? body.startDate.trim() : "";
  const endDate = typeof body.endDate === "string" ? body.endDate.trim() : "";
  const location = typeof body.location === "string" ? body.location.trim() : "";
  const sourceType = body.sourceType === "conferencegate" ? "conferencegate" : "catalog";
  const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.trim() || null : null;
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  if (!conferenceId || !conferenceTitle || !organizerName) {
    return res.status(400).json({ error: "Conference and organizer details are required." });
  }
  if (!isoDate.test(startDate) || !isoDate.test(endDate) || endDate < startDate) {
    return res.status(400).json({ error: "Valid conference start and end dates are required." });
  }

  const serverToday = new Date().toISOString().slice(0, 10);
  const localDate = typeof body.localDate === "string" && isoDate.test(body.localDate) ? body.localDate : serverToday;
  const dayMs = 24 * 60 * 60 * 1000;
  const skew = Math.abs(Date.parse(`${localDate}T00:00:00Z`) - Date.parse(`${serverToday}T00:00:00Z`));
  const effectiveToday = skew <= dayMs ? localDate : serverToday;
  if (startDate > effectiveToday) {
    return res.status(409).json({ error: "Attendance can be recorded when the conference starts, not before." });
  }

  const existing = await dbGet<any>(
    "SELECT * FROM conference_attendance WHERE user_id = ? AND conference_id = ?",
    [req.userId!, conferenceId]
  );
  if (existing) {
    return res.json({ attendance: toConferenceAttendanceDTO(existing), alreadyRecorded: true });
  }

  const id = `att_${crypto.randomUUID()}`;
  await dbRun(
    `INSERT INTO conference_attendance(
      id,user_id,conference_id,conference_title,organizer_name,start_date,end_date,location,source_type,source_url
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
    [id, req.userId!, conferenceId, conferenceTitle, organizerName, startDate, endDate, location || null, sourceType, sourceUrl]
  );
  const row = await dbGet<any>("SELECT * FROM conference_attendance WHERE id = ?", [id]);
  res.status(201).json({ attendance: toConferenceAttendanceDTO(row), alreadyRecorded: false });
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

async function organizerFeedbackRows(accountId: string, accountOwner: UserRow) {
  const [feedbackRows, ownedConferences] = await Promise.all([
    dbAll<any>(
      `SELECT cf.*, cfr.organizer_name as routed_organizer_name, cfr.organizer_key,
              u.name as participant_name, u.organization as participant_organization
         FROM conference_feedback cf
         LEFT JOIN conference_feedback_routing cfr ON cfr.feedback_id = cf.id
         LEFT JOIN users u ON u.id = cf.user_id
        ORDER BY cf.created_at DESC`
    ),
    dbAll<CreatedConferenceRow>(
      "SELECT * FROM created_conferences WHERE organizer_id = ?",
      [accountId]
    ),
  ]);

  const conferenceIds = new Set(ownedConferences.map((row) => row.id));
  const conferenceTitleKeys = new Set(
    ownedConferences.map((row) => {
      try { return normalizedOrganizationKey(JSON.parse(row.data || "{}").title); } catch { return ""; }
    }).filter(Boolean)
  );
  const organizationKeys = new Set(
    [accountOwner.organization, accountOwner.name].map(normalizedOrganizationKey).filter(Boolean)
  );

  return feedbackRows.flatMap((row) => {
    let matchReason: "conference" | "organization" | null = null;
    if (row.conference_id && conferenceIds.has(row.conference_id)) matchReason = "conference";
    else if (row.organizer_key && organizationKeys.has(row.organizer_key)) matchReason = "organization";
    else if (conferenceTitleKeys.has(normalizedOrganizationKey(row.conference_title))) matchReason = "conference";
    if (!matchReason) return [];

    let ratings: Record<string, number> = {};
    try { ratings = JSON.parse(row.ratings || "{}"); } catch {}
    return [{
      id: row.id,
      conferenceId: row.conference_id || null,
      conferenceTitle: row.conference_title,
      organizerName: row.routed_organizer_name || accountOwner.organization || accountOwner.name || "",
      participantName: row.participant_name || "ConferenceGate member",
      participantOrganization: row.participant_organization || "",
      role: row.role,
      ratings,
      overallScore: Number(row.overall_score || 0),
      comment: row.comment || "",
      date: row.created_at,
      matchReason,
    }];
  });
}

activityRouter.post("/feedback", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  if (typeof body.conferenceTitle !== "string" || !body.conferenceTitle.trim()) {
    return res.status(400).json({ error: "conferenceTitle is required" });
  }
  const ratings = body.ratings && typeof body.ratings === "object" ? body.ratings : {};
  const scoreValues = Object.values(ratings).map(Number).filter((value) => Number.isFinite(value) && value >= 1 && value <= 6);
  if (scoreValues.length === 0) {
    return res.status(400).json({ error: "At least one valid rating is required" });
  }
  if (scoreValues.length !== Object.keys(ratings).length) {
    return res.status(400).json({ error: "Feedback ratings must use the 1 to 6 scale" });
  }
  const overallScore = Number((scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length).toFixed(2));

  let conferenceTitle = body.conferenceTitle.trim();
  let organizerName = typeof body.organizerName === "string" ? body.organizerName.trim() : "";
  if (typeof body.conferenceId === "string" && body.conferenceId) {
    const attendance = await dbGet<any>(
      "SELECT * FROM conference_attendance WHERE user_id = ? AND conference_id = ?",
      [req.userId!, body.conferenceId]
    );
    if (attendance) {
      conferenceTitle = attendance.conference_title;
      organizerName = attendance.organizer_name;
    } else {
      return res.status(403).json({ error: "Mark this conference Attended before submitting a conference or organizer rating." });
    }
    if (!organizerName) {
      const owned = await dbGet<CreatedConferenceRow>("SELECT * FROM created_conferences WHERE id = ?", [body.conferenceId]);
      if (owned) {
        const owner = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [owned.organizer_id]);
        organizerName = owner?.organization || owner?.name || "";
      }
    }
  }

  const existingFeedback = typeof body.conferenceId === "string" && body.conferenceId
    ? await dbGet<ConferenceFeedbackRow>(
        "SELECT * FROM conference_feedback WHERE user_id = ? AND conference_id = ? ORDER BY created_at DESC LIMIT 1",
        [req.userId!, body.conferenceId]
      )
    : undefined;
  const id = existingFeedback?.id || `fb_${crypto.randomUUID()}`;
  if (existingFeedback) {
    await dbRun(
      `UPDATE conference_feedback
          SET conference_title=?, role=?, ratings=?, overall_score=?, comment=?, recipient_email=?, created_at=datetime('now')
        WHERE id=?`,
      [conferenceTitle, body.role || "Attendee", JSON.stringify(ratings), overallScore, body.comment || null, body.recipientEmail || null, id]
    );
    await dbRun("DELETE FROM conference_feedback_routing WHERE feedback_id = ?", [id]);
  } else {
    await dbRun(
      `INSERT INTO conference_feedback (
        id, user_id, conference_id, conference_title, role, ratings, overall_score, comment, recipient_email
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, req.userId!, body.conferenceId || null, conferenceTitle, body.role || "Attendee",
        JSON.stringify(ratings), overallScore, body.comment || null, body.recipientEmail || null,
      ]
    );
  }
  if (organizerName) {
    await dbRun(
      "INSERT INTO conference_feedback_routing(feedback_id, organizer_name, organizer_key) VALUES(?,?,?)",
      [id, organizerName, normalizedOrganizationKey(organizerName)]
    );
  }

  res.status(existingFeedback ? 200 : 201).json({ ok: true, overallScore, updated: Boolean(existingFeedback) });
}));

activityRouter.get("/feedback/organizer", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const organizerContext = await organizerWorkspaceContext(req, res);
  if (!organizerContext) return;
  const feedback = await organizerFeedbackRows(organizerContext.accountId, organizerContext.accountOwner);
  res.json({ feedback });
}));

activityRouter.get("/feedback/summary", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const organizerContext = await organizerWorkspaceContext(req, res);
  if (!organizerContext) return;
  const rows = await organizerFeedbackRows(organizerContext.accountId, organizerContext.accountOwner);
  const averageScore = rows.length
    ? Number((rows.reduce((sum, row) => sum + row.overallScore, 0) / rows.length).toFixed(2))
    : 0;
  res.json({ averageScore, responseCount: rows.length });
}));

activityRouter.post("/broadcasts", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const organizerContext = await organizerWorkspaceContext(req, res, true);
  if (!organizerContext) return;
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
    [id, organizerContext.accountId, body.recipientGroup || "All Attendees", body.subject.trim(), body.body.trim()]
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


// Persisted Organizer workspace planning. These records are shared across seats through the paid
// account context but do not claim that an assignee was notified or that an external meeting was
// booked. Delivery/invitation remains a separate explicit action.
activityRouter.get("/organizer/committee-tasks", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const organizerContext = await organizerWorkspaceContext(req, res);
  if (!organizerContext) return;
  const rows = await dbAll<any>(
    "SELECT * FROM organizer_committee_tasks WHERE organizer_id = ? ORDER BY created_at DESC",
    [organizerContext.accountId]
  );
  res.json({
    tasks: rows.map((row) => ({
      id: row.id,
      assignee: row.assignee_name,
      title: row.title,
      description: row.description || "",
      dueDate: row.due_date || "",
      priority: row.priority,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  });
}));

activityRouter.post("/organizer/committee-tasks", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const organizerContext = await organizerWorkspaceContext(req, res, true);
  if (!organizerContext) return;
  const body = req.body || {};
  const assignee = typeof body.assignee === "string" ? body.assignee.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const priority = ["Low", "Medium", "High"].includes(body.priority) ? body.priority : "Medium";
  if (!assignee || !title) return res.status(400).json({ error: "Assignee and task title are required." });
  const id = `oct_${crypto.randomUUID()}`;
  await dbRun(
    `INSERT INTO organizer_committee_tasks
      (id, organizer_id, assignee_name, title, description, due_date, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, organizerContext.accountId, assignee, title, body.description || null, body.dueDate || null, priority]
  );
  const row = await dbGet<any>("SELECT * FROM organizer_committee_tasks WHERE id = ?", [id]);
  res.status(201).json({
    task: {
      id: row!.id,
      assignee: row!.assignee_name,
      title: row!.title,
      description: row!.description || "",
      dueDate: row!.due_date || "",
      priority: row!.priority,
      status: row!.status,
      createdAt: row!.created_at,
      updatedAt: row!.updated_at,
    },
  });
}));

activityRouter.patch("/organizer/committee-tasks/:id", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const organizerContext = await organizerWorkspaceContext(req, res, true);
  if (!organizerContext) return;
  const status = req.body?.status;
  if (!["Pending", "In Progress", "Completed"].includes(status)) {
    return res.status(400).json({ error: "A valid task status is required." });
  }
  const existing = await dbGet<any>(
    "SELECT * FROM organizer_committee_tasks WHERE id = ? AND organizer_id = ?",
    [req.params.id, organizerContext.accountId]
  );
  if (!existing) return res.status(404).json({ error: "Task not found." });
  await dbRun(
    "UPDATE organizer_committee_tasks SET status = ?, updated_at = datetime('now') WHERE id = ? AND organizer_id = ?",
    [status, req.params.id, organizerContext.accountId]
  );
  const row = await dbGet<any>("SELECT * FROM organizer_committee_tasks WHERE id = ?", [req.params.id]);
  res.json({
    task: {
      id: row!.id,
      assignee: row!.assignee_name,
      title: row!.title,
      description: row!.description || "",
      dueDate: row!.due_date || "",
      priority: row!.priority,
      status: row!.status,
      createdAt: row!.created_at,
      updatedAt: row!.updated_at,
    },
  });
}));


activityRouter.get("/organizer/coordination-notes", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const organizerContext = await organizerWorkspaceContext(req, res);
  if (!organizerContext) return;
  const rows = await dbAll<any>(
    "SELECT * FROM organizer_coordination_notes WHERE organizer_id = ? ORDER BY created_at DESC",
    [organizerContext.accountId]
  );
  res.json({ notes: rows.map((row) => ({ id: row.id, from: row.author_label, to: row.recipient_label, message: row.message, date: row.created_at })) });
}));

activityRouter.post("/organizer/coordination-notes", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const organizerContext = await organizerWorkspaceContext(req, res, true);
  if (!organizerContext) return;
  const body = req.body || {};
  const from = typeof body.from === "string" ? body.from.trim() : "";
  const to = typeof body.to === "string" ? body.to.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!from || !to || !message) return res.status(400).json({ error: "From, recipient, and message are required." });
  const id = `ocn_${crypto.randomUUID()}`;
  await dbRun(
    "INSERT INTO organizer_coordination_notes (id, organizer_id, author_label, recipient_label, message) VALUES (?, ?, ?, ?, ?)",
    [id, organizerContext.accountId, from, to, message]
  );
  const row = await dbGet<any>("SELECT * FROM organizer_coordination_notes WHERE id = ?", [id]);
  res.status(201).json({ note: { id: row!.id, from: row!.author_label, to: row!.recipient_label, message: row!.message, date: row!.created_at } });
}));

activityRouter.get("/organizer/meeting-plans", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const organizerContext = await organizerWorkspaceContext(req, res);
  if (!organizerContext) return;
  const rows = await dbAll<any>(
    "SELECT * FROM organizer_meeting_plans WHERE organizer_id = ? ORDER BY meeting_date DESC, meeting_time DESC",
    [organizerContext.accountId]
  );
  res.json({
    meetings: rows.map((row) => ({
      id: row.id,
      title: row.title,
      attendees: JSON.parse(row.attendees || "[]"),
      date: row.meeting_date,
      time: row.meeting_time,
      organizerTimezone: row.organizer_timezone,
      meetingLink: row.meeting_link,
      createdAt: row.created_at,
    })),
  });
}));

activityRouter.post("/organizer/meeting-plans", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const organizerContext = await organizerWorkspaceContext(req, res, true);
  if (!organizerContext) return;
  const body = req.body || {};
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const date = typeof body.date === "string" ? body.date.trim() : "";
  const time = typeof body.time === "string" ? body.time.trim() : "";
  const timezone = typeof body.organizerTimezone === "string" ? body.organizerTimezone.trim() : "";
  const link = typeof body.meetingLink === "string" ? body.meetingLink.trim() : "";
  const attendees = Array.isArray(body.attendees) ? body.attendees.filter((item: unknown) => typeof item === "string") : [];
  if (!title || !date || !time || !timezone || !link || attendees.length === 0) {
    return res.status(400).json({ error: "Title, attendees, date, time, timezone, and meeting link are required." });
  }
  let parsed: URL;
  try { parsed = new URL(link); } catch { return res.status(400).json({ error: "Meeting link must be a valid URL." }); }
  if (!['https:', 'http:'].includes(parsed.protocol)) return res.status(400).json({ error: "Meeting link must use http or https." });
  const id = `omp_${crypto.randomUUID()}`;
  await dbRun(
    `INSERT INTO organizer_meeting_plans
      (id, organizer_id, title, attendees, meeting_date, meeting_time, organizer_timezone, meeting_link)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, organizerContext.accountId, title, JSON.stringify(attendees), date, time, timezone, link]
  );
  const row = await dbGet<any>("SELECT * FROM organizer_meeting_plans WHERE id = ?", [id]);
  res.status(201).json({
    meeting: {
      id: row!.id,
      title: row!.title,
      attendees: JSON.parse(row!.attendees || "[]"),
      date: row!.meeting_date,
      time: row!.meeting_time,
      organizerTimezone: row!.organizer_timezone,
      meetingLink: row!.meeting_link,
      createdAt: row!.created_at,
    },
  });
}));

function meetingMinutesDTO(row: any) {
  return {
    id: row.id,
    meetingPlanId: row.meeting_plan_id || null,
    conferenceId: row.conference_id,
    conferenceTitle: row.conference_title,
    title: row.title,
    date: row.meeting_date,
    time: row.meeting_time || "",
    organizerTimezone: row.organizer_timezone || "",
    chairName: row.chair_name || "",
    preparedBy: row.prepared_by || "",
    attendees: JSON.parse(row.attendees || "[]"),
    objectives: row.objectives || "",
    agenda: row.agenda || "",
    discussionSummary: row.discussion_summary || "",
    keyDecisions: row.key_decisions || "",
    actionItems: JSON.parse(row.action_items || "[]"),
    risksIssues: row.risks_issues || "",
    nextSteps: row.next_steps || "",
    nextMeetingDate: row.next_meeting_date || "",
    notes: row.notes || "",
    distributionGroups: JSON.parse(row.distribution_groups || "[]"),
    externalEmails: JSON.parse(row.external_emails || "[]"),
    notifyInApp: Boolean(row.notify_in_app),
    sendEmail: Boolean(row.send_email),
    distributedAt: row.distributed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function meetingMinutesDocumentData(row: any) {
  const dto = meetingMinutesDTO(row);
  return {
    title: dto.title, conferenceTitle: dto.conferenceTitle, date: dto.date, time: dto.time,
    organizerTimezone: dto.organizerTimezone, chairName: dto.chairName, preparedBy: dto.preparedBy,
    attendees: dto.attendees, objectives: dto.objectives, agenda: dto.agenda,
    discussionSummary: dto.discussionSummary, keyDecisions: dto.keyDecisions, actionItems: dto.actionItems,
    risksIssues: dto.risksIssues, nextSteps: dto.nextSteps, nextMeetingDate: dto.nextMeetingDate, notes: dto.notes,
  };
}

activityRouter.get("/organizer/meeting-minutes", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const organizerContext = await organizerWorkspaceContext(req, res);
  if (!organizerContext) return;
  const rows = await dbAll<any>(
    "SELECT * FROM organizer_meeting_minutes WHERE organizer_id = ? ORDER BY meeting_date DESC, created_at DESC",
    [organizerContext.accountId]
  );
  res.json({ minutes: rows.map(meetingMinutesDTO) });
}));

activityRouter.post("/organizer/meeting-minutes", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const organizerContext = await organizerWorkspaceContext(req, res, true);
  if (!organizerContext) return;
  const body = req.body || {};
  const conferenceId = typeof body.conferenceId === "string" ? body.conferenceId.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const date = typeof body.date === "string" ? body.date.trim() : "";
  if (!conferenceId || !title || !date) return res.status(400).json({ error: "Conference, meeting title, and date are required." });
  const owned = await dbGet<CreatedConferenceRow>("SELECT * FROM created_conferences WHERE id = ? AND organizer_id = ?", [conferenceId, organizerContext.accountId]);
  if (!owned) return res.status(404).json({ error: "You can only record minutes for a conference in this Organizer workspace." });
  const conferenceData = JSON.parse(owned.data || "{}");
  const attendees = Array.isArray(body.attendees) ? body.attendees.filter((value: unknown) => typeof value === "string").slice(0, 200) : [];
  const actions = Array.isArray(body.actionItems) ? body.actionItems.filter((item: any) => item && typeof item.action === "string" && item.action.trim()).slice(0, 100).map((item: any) => ({
    action: String(item.action).trim().slice(0, 1000), owner: String(item.owner || "").trim().slice(0, 200),
    dueDate: String(item.dueDate || "").trim().slice(0, 30), status: ["Open","In Progress","Done"].includes(item.status) ? item.status : "Open",
  })) : [];
  const groups = Array.isArray(body.distributionGroups) ? body.distributionGroups.filter((value: unknown) => ["committee","members","reviewers","speakers"].includes(String(value))) : [];
  const emails = Array.isArray(body.externalEmails) ? body.externalEmails.filter((value: unknown) => typeof value === "string").map((value: string) => value.trim().toLowerCase()).filter(Boolean).slice(0, 100) : [];
  const id = `omm_${crypto.randomUUID()}`;
  await dbRun(
    `INSERT INTO organizer_meeting_minutes(
      id,organizer_id,meeting_plan_id,conference_id,conference_title,title,meeting_date,meeting_time,organizer_timezone,chair_name,prepared_by,attendees,objectives,agenda,discussion_summary,key_decisions,action_items,risks_issues,next_steps,next_meeting_date,notes,distribution_groups,external_emails,notify_in_app,send_email
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,organizerContext.accountId,typeof body.meetingPlanId === "string" && body.meetingPlanId ? body.meetingPlanId : null,conferenceId,conferenceData.title || body.conferenceTitle || conferenceId,title,date,String(body.time || ""),String(body.organizerTimezone || ""),String(body.chairName || "").trim(),String(body.preparedBy || "").trim(),JSON.stringify(attendees),String(body.objectives || "").trim(),String(body.agenda || "").trim(),String(body.discussionSummary || "").trim(),String(body.keyDecisions || "").trim(),JSON.stringify(actions),String(body.risksIssues || "").trim(),String(body.nextSteps || "").trim(),String(body.nextMeetingDate || "").trim(),String(body.notes || "").trim(),JSON.stringify(groups),JSON.stringify(emails),body.notifyInApp === false ? 0 : 1,body.sendEmail ? 1 : 0]
  );
  const row = await dbGet<any>("SELECT * FROM organizer_meeting_minutes WHERE id = ?", [id]);
  res.status(201).json({ minutes: meetingMinutesDTO(row) });
}));

activityRouter.get("/organizer/meeting-minutes/:id/document", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const organizerContext = await organizerWorkspaceContext(req, res);
  if (!organizerContext) return;
  const row = await dbGet<any>("SELECT * FROM organizer_meeting_minutes WHERE id = ? AND organizer_id = ?", [req.params.id, organizerContext.accountId]);
  if (!row) return res.status(404).json({ error: "Meeting minutes not found." });
  const buffer = await buildMeetingMinutesDocxBuffer(meetingMinutesDocumentData(row));
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="${meetingMinutesFilename(row.title, row.meeting_date)}"`);
  res.send(buffer);
}));

activityRouter.post("/organizer/meeting-minutes/:id/distribute", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const organizerContext = await organizerWorkspaceContext(req, res, true);
  if (!organizerContext) return;
  const row = await dbGet<any>("SELECT * FROM organizer_meeting_minutes WHERE id = ? AND organizer_id = ?", [req.params.id, organizerContext.accountId]);
  if (!row) return res.status(404).json({ error: "Meeting minutes not found." });
  const body = req.body || {};
  const stored = meetingMinutesDTO(row);
  const groups = Array.isArray(body.distributionGroups) ? body.distributionGroups.filter((value: unknown) => ["committee","members","reviewers","speakers"].includes(String(value))) : stored.distributionGroups;
  const externalEmails = Array.isArray(body.externalEmails) ? body.externalEmails.filter((value: unknown) => typeof value === "string").map((value: string) => value.trim().toLowerCase()).filter(Boolean).slice(0, 100) : stored.externalEmails;
  const notifyInApp = body.notifyInApp === undefined ? stored.notifyInApp : Boolean(body.notifyInApp);
  const sendEmail = body.sendEmail === undefined ? stored.sendEmail : Boolean(body.sendEmail);
  const userIds = new Set<string>();
  if (groups.includes("committee") || groups.includes("speakers") || groups.includes("members")) {
    const roleClauses: string[] = [];
    if (groups.includes("committee")) roleClauses.push("'committee'");
    if (groups.includes("speakers")) roleClauses.push("'speaker'");
    if (groups.includes("members")) roleClauses.push("'committee'", "'chair'", "'speaker'");
    if (roleClauses.length) {
      const rows = await dbAll<{ professional_id: string }>(
        `SELECT DISTINCT professional_id FROM professional_invitations WHERE organizer_id=? AND conference_id=? AND status IN ('accepted','completed') AND role_type IN (${[...new Set(roleClauses)].join(',')})`,
        [organizerContext.accountId, row.conference_id]
      );
      rows.forEach((item) => userIds.add(item.professional_id));
    }
  }
  if (groups.includes("members")) {
    const registrations = await dbAll<{ user_id: string }>("SELECT DISTINCT user_id FROM conference_registrations WHERE conference_id=?", [row.conference_id]);
    registrations.forEach((item) => userIds.add(item.user_id));
  }
  if (groups.includes("reviewers")) {
    const reviewers = await dbAll<{ reviewer_id: string }>(
      "SELECT DISTINCT a.reviewer_id FROM submission_reviewer_assignments a JOIN submissions s ON s.id=a.submission_id WHERE s.conference_id=?",
      [row.conference_id]
    );
    reviewers.forEach((item) => userIds.add(item.reviewer_id));
  }
  const recipients: Array<{ id?: string; name: string; email: string }> = [];
  for (const userId of userIds) {
    const user = await dbGet<{ id: string; name: string; email: string }>("SELECT id,name,email FROM users WHERE id=?", [userId]);
    if (user) recipients.push({ id: user.id, name: user.name, email: user.email });
  }
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  externalEmails.filter((email: string) => emailRe.test(email)).forEach((email: string) => { if (!recipients.some((item) => item.email.toLowerCase() === email)) recipients.push({ name: "", email }); });
  let notifiedCount = 0;
  if (notifyInApp) {
    for (const recipient of recipients) {
      if (!recipient.id) continue;
      await createNotification(recipient.id, "agenda", `Meeting minutes: ${row.title}`, `${row.conference_title}: meeting minutes are available from the organizer in ConferenceGate.`);
      notifiedCount += 1;
    }
  }
  const emailConfigured = meetingMinutesEmailConfigured();
  let emailSentCount = 0;
  let emailFailedCount = 0;
  if (sendEmail && emailConfigured && recipients.length) {
    const documentBuffer = await buildMeetingMinutesDocxBuffer(meetingMinutesDocumentData(row));
    for (const recipient of recipients) {
      if (!emailRe.test(recipient.email)) continue;
      try {
        await sendMeetingMinutesEmail({ to: recipient.email, recipientName: recipient.name, data: meetingMinutesDocumentData(row), documentBuffer });
        emailSentCount += 1;
      } catch { emailFailedCount += 1; }
    }
  }
  await dbRun("UPDATE organizer_meeting_minutes SET distribution_groups=?,external_emails=?,notify_in_app=?,send_email=?,distributed_at=datetime('now'),updated_at=datetime('now') WHERE id=?", [JSON.stringify(groups),JSON.stringify(externalEmails),notifyInApp ? 1 : 0,sendEmail ? 1 : 0,row.id]);
  const updated = await dbGet<any>("SELECT * FROM organizer_meeting_minutes WHERE id=?", [row.id]);
  res.json({ notifiedCount,emailSentCount,emailFailedCount,emailConfigured,recipientCount: recipients.length,distributedAt: updated?.distributed_at || null });
}));

activityRouter.get("/broadcasts/mine", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const organizerContext = await organizerWorkspaceContext(req, res);
  if (!organizerContext) return;
  const rows = await dbAll<OrganizerBroadcastRow>(
    "SELECT * FROM organizer_broadcasts WHERE organizer_id = ? ORDER BY created_at DESC",
    [organizerContext.accountId]
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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function searchPublicWebResearch(fullName: string) {
  const nameParts = fullName.trim().split(/\s+/).filter(Boolean);
  if (nameParts.length < 2) return [];
  const firstLast = `${nameParts[0]} ${nameParts[nameParts.length - 1]}`;

  // Exact full-name results find theses and institutional records; first/last plus a publication
  // path finds indexes that omit the middle name (especially Academia.edu and proceedings).
  // ResearchGate was dropped as a targeted source — its own bot/rate-limit gating meant even a
  // correctly-matched record routinely came back "Access Denied" when clicked, which is worse
  // than not surfacing it at all. CORE (core.ac.uk) is queried instead: a genuine open-access
  // aggregator with public full-text pages, not a site that bot-walls its record pages.
  const resultGroups = await Promise.all([
    searchWebForConferenceFacts(`"${fullName}" research paper abstract publication thesis proceedings`, 15),
    searchWebForConferenceFacts(`"${firstLast}" paper abstract publication conference`, 15),
    searchWebForConferenceFacts(`"${firstLast}" site:academia.edu`, 10),
    searchWebForConferenceFacts(`"${firstLast}" site:core.ac.uk`, 10),
  ]);
  const results = resultGroups.flat();

  const researchHostRe = /(^|\.)(scholar\.google|semanticscholar|dblp|orcid|doi|crossref|ieee|springer|sciencedirect|onepetro|seg|eage|asce|academia|cambridge|kfupm|rwth-aachen|proceedings|core\.ac\.uk)(\.|$)/i;
  const researchTextRe = /\b(paper|abstract|research|publication|proceedings|journal|conference|doi|study|method|analysis|thesis|dissertation|geology|geochemistry)\b/i;
  // ResearchGate results are dropped outright, not just deprioritized — its own bot/rate-limit
  // gating means even a genuinely correct match routinely dead-ends in "Access Denied".
  const blockedHostRe = /(linkedin|facebook|instagram|inforegister|ariregister|researchgate)/i;
  // A search engine's quoted-phrase match is a ranking hint, not a hard filter — it will happily
  // return someone else's paper that merely scored well on the other query words. Requiring the
  // person's own first AND last name to actually appear in the result (not necessarily adjacent,
  // so "First Middle Last" full-name matches still pass) is what keeps a stranger's geology paper
  // from being presented as theirs just because a web search loosely matched it.
  const firstNameRe = new RegExp(`\\b${escapeRegex(nameParts[0])}\\b`, "i");
  const lastNameRe = new RegExp(`\\b${escapeRegex(nameParts[nameParts.length - 1])}\\b`, "i");
  const seenUrls = new Set<string>();

  return results
    .filter((result) => {
      let host = result.displayLink || "";
      try { host = new URL(result.link).hostname; } catch { /* keep display host */ }
      if (!result.link || blockedHostRe.test(host) || seenUrls.has(result.link)) return false;
      const haystack = `${result.title} ${result.snippet}`;
      if (!firstNameRe.test(haystack) || !lastNameRe.test(haystack)) return false;
      if (!researchTextRe.test(haystack) && !researchHostRe.test(host)) return false;
      seenUrls.add(result.link);
      return true;
    })
    .map((result) => {
      let host = result.displayLink || "Web search";
      try { host = new URL(result.link).hostname.replace(/^www\./, ""); } catch { /* keep display host */ }
      const combined = `${result.title} ${result.snippet}`;
      const year = combined.match(/\b(?:19|20)\d{2}\b/)?.[0] || null;
      const recordType = /\babstract\b/i.test(combined)
        ? "Abstract"
        : /\b(thesis|dissertation)\b/i.test(combined)
          ? "Thesis"
          : /\b(paper|proceedings|doi)\b/i.test(combined)
            ? "Paper"
            : "Research";
      const title = result.title
        .replace(/\s+[|–—-]\s+(ResearchGate|Google Scholar|Semantic Scholar|DBLP).*$/i, "")
        .trim();
      return {
        doi: `web:${crypto.createHash("sha256").update(result.link || title).digest("hex").slice(0, 24)}`,
        title,
        venue: host,
        year,
        url: result.link || null,
        source: "Live web",
        recordType,
      };
    });
}

activityRouter.get("/external-papers/mine", asyncHandler(async (req: AuthedRequest, res: Response) => {
  // Each source caches its own results per name for 24 hours to avoid hammering a free public
  // API on every profile visit. That means an unconditional re-search (after correcting a name,
  // or just wanting to check for something newly published) would otherwise silently hand back
  // yesterday's cached answer under the same name. `force` is how "search again" means it.
  const force = req.query.force === "true";
  const user = await dbGet<{ name: string }>("SELECT name FROM users WHERE id = ?", [req.userId!]);
  const requestedName = typeof req.query.name === "string" ? req.query.name.trim().slice(0, 120) : "";
  const searchName = requestedName || user?.name || "";
  const decided = await dbAll<ExternalPaperMatchRow>("SELECT * FROM external_paper_matches WHERE user_id = ?", [
    req.userId!,
  ]);
  const decidedDois = new Set(decided.map((r) => r.doi));

  const nameVariants = searchName ? buildNameVariants(searchName) : [];
  const [perVariantResults, webResults] = await Promise.all([
    Promise.all(
      nameVariants.map((name) =>
        Promise.all([
          searchCrossRefConferencePapers(name, force),
          searchSemanticScholarConferencePapers(name, force),
          searchDblpConferencePapers(name, force),
          searchOpenAlexConferencePapers(name, force),
        ])
      )
    ),
    searchName ? searchPublicWebResearch(searchName) : Promise.resolve([]),
  ]);

  const merged = [
    ...perVariantResults.flatMap(([crossRef, semanticScholar, dblp, openAlex]) => [
      ...crossRef.map((c) => ({ doi: c.doi, title: c.title, venue: c.venue, year: c.year, url: c.url, source: "CrossRef", recordType: "Paper" })),
      ...semanticScholar.map((c) => ({ doi: c.id, title: c.title, venue: c.venue, year: c.year, url: c.url, source: "Semantic Scholar", recordType: "Research" })),
      ...dblp.map((c) => ({ doi: c.id, title: c.title, venue: c.venue, year: c.year, url: c.url, source: "DBLP", recordType: "Paper" })),
      ...openAlex.map((c) => ({ doi: c.id, title: c.title, venue: c.venue, year: c.year, url: c.url, source: "OpenAlex", recordType: "Paper" })),
    ]),
    ...webResults,
  ];

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
  const organizerContext = await organizerWorkspaceContext(req, res, true);
  if (!organizerContext) return;
  const body = req.body || {};
  if (typeof body.id !== "string" || !body.id || typeof body.title !== "string" || !body.title.trim()) {
    return res.status(400).json({ error: "A conference object with id and title is required" });
  }
  await dbRun("INSERT INTO created_conferences (id, organizer_id, data) VALUES (?, ?, ?)", [
    body.id,
    organizerContext.accountId,
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
  const organizerContext = await organizerWorkspaceContext(req, res);
  if (!organizerContext) return;
  const rows = await dbAll<CreatedConferenceRow>(
    "SELECT * FROM created_conferences WHERE organizer_id = ? ORDER BY created_at DESC",
    [organizerContext.accountId]
  );
  res.json({ conferences: rows.map((row) => JSON.parse(row.data)) });
}));

// Real activity on conferences this organizer created — sponsorship/committee interest and new
// abstract submissions — so the organizer's notification bell can surface genuine events instead
// of demo content.
activityRouter.get("/organizer/activity-feed", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const organizerContext = await organizerWorkspaceContext(req, res);
  if (!organizerContext) return;
  const myConferences = await dbAll<{ id: string }>("SELECT id FROM created_conferences WHERE organizer_id = ?", [
    organizerContext.accountId,
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
