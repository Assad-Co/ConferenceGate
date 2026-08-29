import { AbstractSubmission, Conference, NotificationItem } from '../types';

async function parseResponse(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Something went wrong. Please try again.');
  }
  return data;
}

export interface CreateSubmissionPayload {
  conferenceId: string;
  conferenceTitle: string;
  title: string;
  track: string;
  topic: string;
  keywords: string[];
  abstractText: string;
  preferredType: 'Oral' | 'Poster';
  primaryAuthor: { name: string; email: string; affiliation: string; bio: string };
  coAuthors: Array<{ name: string; affiliation: string; email: string }>;
  conflictOfInterest: string;
}

export interface SubmitReviewPayload {
  scores: Record<string, number>;
  commentsToAuthor: string;
  confidentialComments: string;
  recommendation: string;
}

export interface ConferenceRegistration {
  conferenceId: string;
  conferenceTitle: string;
  packageId: string | null;
  packageName: string | null;
  registeredAt: string;
}

export async function fetchSubmissions(): Promise<AbstractSubmission[]> {
  const res = await fetch('/api/activity/submissions', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.submissions;
}

export async function createSubmission(payload: CreateSubmissionPayload): Promise<AbstractSubmission> {
  const res = await fetch('/api/activity/submissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await parseResponse(res);
  return data.submission;
}

export interface CreateExternalSubmissionPayload {
  conferenceTitle: string;
  externalUrl: string;
  title: string;
  abstractText?: string;
  authorName?: string;
  authorEmail?: string;
}

/** Records that the author submitted this abstract directly on an external conference's own
 * site — a self-reported bookmark for their own My Abstracts records, not a tracked review
 * workflow, since ConferenceGate has no visibility into that conference's real pipeline. */
export async function createExternalSubmission(
  payload: CreateExternalSubmissionPayload
): Promise<AbstractSubmission> {
  const res = await fetch('/api/activity/submissions/external', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await parseResponse(res);
  return data.submission;
}

export async function submitRevision(submissionId: string, note: string): Promise<AbstractSubmission> {
  const res = await fetch(`/api/activity/submissions/${submissionId}/revisions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ note }),
  });
  const data = await parseResponse(res);
  return data.submission;
}

export async function submitReview(submissionId: string, payload: SubmitReviewPayload): Promise<AbstractSubmission> {
  const res = await fetch(`/api/activity/submissions/${submissionId}/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await parseResponse(res);
  return data.submission;
}

export async function volunteerForReview(opportunityId: string, conferenceTitle: string, topic: string): Promise<void> {
  const res = await fetch('/api/activity/reviews/volunteer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ opportunityId, conferenceTitle, topic }),
  });
  await parseResponse(res);
}

export async function fetchMyVolunteeredOpportunityIds(): Promise<string[]> {
  const res = await fetch('/api/activity/reviews/volunteers/mine', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.opportunityIds;
}

export async function registerForConference(
  conferenceId: string,
  conferenceTitle: string,
  packageId: string,
  packageName: string
): Promise<void> {
  const res = await fetch('/api/activity/registrations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ conferenceId, conferenceTitle, packageId, packageName }),
  });
  await parseResponse(res);
}

export async function fetchMyRegistrations(): Promise<ConferenceRegistration[]> {
  const res = await fetch('/api/activity/registrations/mine', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.registrations;
}

export async function fetchRegistrationCountsByConference(): Promise<Record<string, number>> {
  const res = await fetch('/api/activity/registrations/counts-by-conference', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.counts;
}

export interface ConferenceInteractions {
  saved: string[];
  followed: string[];
}

export async function fetchMyConferenceInteractions(): Promise<ConferenceInteractions> {
  const res = await fetch('/api/activity/conference-interactions/mine', { credentials: 'include' });
  return parseResponse(res);
}

export async function toggleConferenceInteraction(
  conferenceId: string,
  type: 'saved' | 'followed'
): Promise<boolean> {
  const res = await fetch('/api/activity/conference-interactions/toggle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ conferenceId, type }),
  });
  const data = await parseResponse(res);
  return data.active;
}

export interface SubmitFeedbackPayload {
  conferenceId?: string;
  conferenceTitle: string;
  role: string;
  ratings: Record<string, number>;
  comment?: string;
  recipientEmail?: string;
}

export async function submitConferenceFeedback(payload: SubmitFeedbackPayload): Promise<{ overallScore: number }> {
  const res = await fetch('/api/activity/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  return parseResponse(res);
}

export async function fetchFeedbackSummary(): Promise<{ averageScore: number; responseCount: number }> {
  const res = await fetch('/api/activity/feedback/summary', { credentials: 'include' });
  return parseResponse(res);
}

export interface OrganizerBroadcast {
  id: string;
  recipientGroup: string;
  subject: string;
  body: string;
  createdAt: string;
}

export async function sendBroadcast(recipientGroup: string, subject: string, body: string): Promise<OrganizerBroadcast> {
  const res = await fetch('/api/activity/broadcasts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ recipientGroup, subject, body }),
  });
  const data = await parseResponse(res);
  return data.broadcast;
}

export async function fetchMyBroadcasts(): Promise<OrganizerBroadcast[]> {
  const res = await fetch('/api/activity/broadcasts/mine', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.broadcasts;
}

export async function createConferenceRemote(conference: Conference): Promise<Conference> {
  const res = await fetch('/api/activity/conferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(conference),
  });
  const data = await parseResponse(res);
  return data.conference;
}

export async function fetchCreatedConferences(): Promise<Conference[]> {
  const res = await fetch('/api/activity/conferences', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.conferences;
}

/** Only the conferences the current organizer created — scopes their dashboard to their own data. */
export async function fetchMyCreatedConferences(): Promise<Conference[]> {
  const res = await fetch('/api/activity/conferences/mine', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.conferences;
}

export async function recordConferenceAction(
  conferenceId: string,
  conferenceTitle: string,
  kind: 'committee_interest' | 'sponsorship_inquiry'
): Promise<boolean> {
  const res = await fetch('/api/activity/conference-actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ conferenceId, conferenceTitle, kind }),
  });
  const data = await parseResponse(res);
  return !data.alreadyRecorded;
}

export interface OrganizerActivityItem {
  id: string;
  kind: 'committee_interest' | 'sponsorship_inquiry' | 'abstract_submission';
  conferenceTitle: string;
  actorName: string;
  abstractTitle?: string;
  createdAt: string;
}

export async function fetchOrganizerActivityFeed(): Promise<OrganizerActivityItem[]> {
  const res = await fetch('/api/activity/organizer/activity-feed', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.items;
}

export interface ExternalPaper {
  doi: string;
  title: string;
  venue: string | null;
  year: string | null;
  url: string | null;
  source?: string | null;
  recordType?: 'Paper' | 'Abstract' | 'Research' | string;
}

/** Real conference papers matched by name against CrossRef's public index — `confirmed` are
 * ones the account has already said are theirs, `candidates` are unconfirmed matches still
 * awaiting a yes/no. Names collide, so nothing in `candidates` is ever shown as confirmed fact. */
export async function fetchMyExternalPapers(
  force = false,
  searchName?: string
): Promise<{ confirmed: ExternalPaper[]; candidates: ExternalPaper[] }> {
  const params = new URLSearchParams();
  if (force) params.set('force', 'true');
  if (searchName?.trim()) params.set('name', searchName.trim());
  const query = params.toString();
  const url = `/api/activity/external-papers/mine${query ? `?${query}` : ''}`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) return { confirmed: [], candidates: [] };
  return res.json().catch(() => ({ confirmed: [], candidates: [] }));
}

export async function decideExternalPaper(paper: ExternalPaper, decision: 'confirmed' | 'dismissed'): Promise<void> {
  const res = await fetch('/api/activity/external-papers/decide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ ...paper, decision }),
  });
  await parseResponse(res);
}

export interface SelfReportedAttendance {
  id: string;
  conferenceName: string;
  location: string | null;
  year: string | null;
  role: string | null;
  proofImage: string | null;
  createdAt: string;
}

export interface AddSelfReportedAttendancePayload {
  conferenceName: string;
  location?: string;
  year?: string;
  role?: string;
  proofImage?: string | null;
}

/** Plain attendance (no presentation) has no real public source anywhere — this is the account
 * typing it in themselves. Always returned/shown labeled self-reported, never mixed with
 * Conference Gate's own verified registrations. */
export async function fetchMySelfReportedAttendance(): Promise<SelfReportedAttendance[]> {
  const res = await fetch('/api/activity/self-reported-attendance/mine', { credentials: 'include' });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({ entries: [] }));
  return data.entries || [];
}

export async function addSelfReportedAttendance(
  payload: AddSelfReportedAttendancePayload
): Promise<SelfReportedAttendance> {
  const res = await fetch('/api/activity/self-reported-attendance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await parseResponse(res);
  return data.entry;
}

export async function removeSelfReportedAttendance(id: string): Promise<void> {
  const res = await fetch(`/api/activity/self-reported-attendance/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  await parseResponse(res);
}

export interface SelfReportedCommitteePosition {
  id: string;
  conferenceName: string;
  position: string;
  year: string | null;
  proofImage: string | null;
  createdAt: string;
}

export interface AddCommitteePositionPayload {
  conferenceName: string;
  position: string;
  year?: string;
  proofImage?: string | null;
}

/** Committee/chair service has no public, name-searchable source either — this is the account
 * typing it in themselves. Always returned/shown labeled self-reported. */
export async function fetchMyCommitteePositions(): Promise<SelfReportedCommitteePosition[]> {
  const res = await fetch('/api/activity/committee-positions/mine', { credentials: 'include' });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({ entries: [] }));
  return data.entries || [];
}

export async function addCommitteePosition(payload: AddCommitteePositionPayload): Promise<SelfReportedCommitteePosition> {
  const res = await fetch('/api/activity/committee-positions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await parseResponse(res);
  return data.entry;
}

export async function removeCommitteePosition(id: string): Promise<void> {
  const res = await fetch(`/api/activity/committee-positions/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  await parseResponse(res);
}

/** Persists a real reviewer invitation against a submission (the organizer's AI Reviewer Match
 * "Invite to Review" action) and notifies the invited reviewer for real — previously that action
 * only sent a DM with no lasting record on the submission itself. */
export async function assignReviewerToSubmission(
  submissionId: string,
  reviewerId: string
): Promise<AbstractSubmission> {
  const res = await fetch(`/api/activity/submissions/${submissionId}/assign-reviewer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ reviewerId }),
  });
  const data = await parseResponse(res);
  return data.submission;
}

export async function fetchMyNotifications(): Promise<NotificationItem[]> {
  const res = await fetch('/api/activity/notifications/mine', { credentials: 'include' });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({ notifications: [] }));
  return data.notifications || [];
}

export async function markNotificationRead(id: string): Promise<void> {
  const res = await fetch(`/api/activity/notifications/${id}/read`, { method: 'POST', credentials: 'include' });
  await parseResponse(res);
}

export async function markAllNotificationsRead(): Promise<void> {
  const res = await fetch('/api/activity/notifications/read-all', { method: 'POST', credentials: 'include' });
  await parseResponse(res);
}
