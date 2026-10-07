from pathlib import Path
import re


def replace_once(path, old, new):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f'needle not found in {path}: {old[:120]!r}')
    p.write_text(s.replace(old, new, 1))


def regex_once(path, pattern, repl, flags=re.S):
    p = Path(path)
    s = p.read_text()
    out, n = re.subn(pattern, repl, s, count=1, flags=flags)
    if n != 1:
        raise SystemExit(f'pattern count {n} in {path}: {pattern[:120]!r}')
    p.write_text(out)

# -----------------------------------------------------------------------------
# Database companions preserve the existing production tables while adding
# routing metadata and structured sponsor-review details.
# -----------------------------------------------------------------------------
replace_once(
    'server/db.ts',
    '''      recipient_email TEXT,\n      created_at TEXT NOT NULL DEFAULT (datetime('now'))\n    );\n\n    CREATE TABLE IF NOT EXISTS sponsorship_packages (''',
    '''      recipient_email TEXT,\n      created_at TEXT NOT NULL DEFAULT (datetime('now'))\n    );\n\n    CREATE TABLE IF NOT EXISTS conference_feedback_routing (\n      feedback_id TEXT PRIMARY KEY REFERENCES conference_feedback(id),\n      organizer_name TEXT,\n      organizer_key TEXT,\n      created_at TEXT NOT NULL DEFAULT (datetime('now'))\n    );\n\n    CREATE INDEX IF NOT EXISTS idx_conference_feedback_routing_organizer\n      ON conference_feedback_routing(organizer_key, created_at);\n\n    CREATE TABLE IF NOT EXISTS sponsorship_packages ('''
)
replace_once(
    'server/db.ts',
    '''    CREATE TABLE IF NOT EXISTS sponsor_reviews (\n      id TEXT PRIMARY KEY,\n      sponsor_id TEXT NOT NULL REFERENCES users(id),\n      organizer_id TEXT NOT NULL REFERENCES users(id),\n      conference_title TEXT NOT NULL,\n      rating INTEGER NOT NULL,\n      comment TEXT,\n      created_at TEXT NOT NULL DEFAULT (datetime('now'))\n    );\n\n    CREATE TABLE IF NOT EXISTS sponsor_preferences (''',
    '''    CREATE TABLE IF NOT EXISTS sponsor_reviews (\n      id TEXT PRIMARY KEY,\n      sponsor_id TEXT NOT NULL REFERENCES users(id),\n      organizer_id TEXT NOT NULL REFERENCES users(id),\n      conference_title TEXT NOT NULL,\n      rating INTEGER NOT NULL,\n      comment TEXT,\n      created_at TEXT NOT NULL DEFAULT (datetime('now'))\n    );\n\n    CREATE TABLE IF NOT EXISTS sponsor_review_details (\n      review_id TEXT PRIMARY KEY REFERENCES sponsor_reviews(id),\n      ratings TEXT NOT NULL DEFAULT '{}',\n      overall_score REAL,\n      updated_at TEXT NOT NULL DEFAULT (datetime('now'))\n    );\n\n    CREATE TABLE IF NOT EXISTS sponsor_preferences ('''
)

# -----------------------------------------------------------------------------
# Conference feedback: store organizer routing, match by owned conference OR
# exact normalized organization/organizer name, and expose detailed organizer
# feedback records. Never fuzzy-route feedback to avoid false attribution.
# -----------------------------------------------------------------------------
replace_once(
    'server/activity.ts',
    '''const FINAL_STATUSES = ["Accepted", "Accepted for Oral", "Accepted for Poster", "Rejected", "Withdrawn"];\n''',
    '''const FINAL_STATUSES = ["Accepted", "Accepted for Oral", "Accepted for Poster", "Rejected", "Withdrawn"];\n\nfunction normalizedOrganizationKey(value: unknown): string {\n  return String(value || "")\n    .normalize("NFKD")\n    .replace(/[\\u0300-\\u036f]/g, "")\n    .toLowerCase()\n    .replace(/&/g, " and ")\n    .replace(/[^a-z0-9]+/g, " ")\n    .trim()\n    .replace(/\\s+/g, " ");\n}\n'''
)
regex_once(
    'server/activity.ts',
    r'''activityRouter\.post\("/feedback", asyncHandler\(async \(req: AuthedRequest, res: Response\) => \{.*?activityRouter\.post\("/broadcasts"''',
    '''async function organizerFeedbackRows(accountId: string, accountOwner: UserRow) {\n  const [feedbackRows, ownedConferences] = await Promise.all([\n    dbAll<any>(\n      `SELECT cf.*, cfr.organizer_name as routed_organizer_name, cfr.organizer_key,\n              u.name as participant_name, u.organization as participant_organization\n         FROM conference_feedback cf\n         LEFT JOIN conference_feedback_routing cfr ON cfr.feedback_id = cf.id\n         LEFT JOIN users u ON u.id = cf.user_id\n        ORDER BY cf.created_at DESC`\n    ),\n    dbAll<CreatedConferenceRow>(\n      "SELECT * FROM created_conferences WHERE organizer_id = ?",\n      [accountId]\n    ),\n  ]);\n\n  const conferenceIds = new Set(ownedConferences.map((row) => row.id));\n  const conferenceTitleKeys = new Set(\n    ownedConferences.map((row) => {\n      try { return normalizedOrganizationKey(JSON.parse(row.data || "{}").title); } catch { return ""; }\n    }).filter(Boolean)\n  );\n  const organizationKeys = new Set(\n    [accountOwner.organization, accountOwner.name].map(normalizedOrganizationKey).filter(Boolean)\n  );\n\n  return feedbackRows.flatMap((row) => {\n    let matchReason: "conference" | "organization" | null = null;\n    if (row.conference_id && conferenceIds.has(row.conference_id)) matchReason = "conference";\n    else if (row.organizer_key && organizationKeys.has(row.organizer_key)) matchReason = "organization";\n    else if (conferenceTitleKeys.has(normalizedOrganizationKey(row.conference_title))) matchReason = "conference";\n    if (!matchReason) return [];\n\n    let ratings: Record<string, number> = {};\n    try { ratings = JSON.parse(row.ratings || "{}"); } catch {}\n    return [{\n      id: row.id,\n      conferenceId: row.conference_id || null,\n      conferenceTitle: row.conference_title,\n      organizerName: row.routed_organizer_name || accountOwner.organization || accountOwner.name || "",\n      participantName: row.participant_name || "ConferenceGate member",\n      participantOrganization: row.participant_organization || "",\n      role: row.role,\n      ratings,\n      overallScore: Number(row.overall_score || 0),\n      comment: row.comment || "",\n      date: row.created_at,\n      matchReason,\n    }];\n  });\n}\n\nactivityRouter.post("/feedback", asyncHandler(async (req: AuthedRequest, res: Response) => {\n  const body = req.body || {};\n  if (typeof body.conferenceTitle !== "string" || !body.conferenceTitle.trim()) {\n    return res.status(400).json({ error: "conferenceTitle is required" });\n  }\n  const ratings = body.ratings && typeof body.ratings === "object" ? body.ratings : {};\n  const scoreValues = Object.values(ratings).map(Number).filter((value) => Number.isFinite(value) && value >= 1 && value <= 6);\n  if (scoreValues.length === 0) {\n    return res.status(400).json({ error: "At least one valid rating is required" });\n  }\n  if (scoreValues.length !== Object.keys(ratings).length) {\n    return res.status(400).json({ error: "Feedback ratings must use the 1 to 6 scale" });\n  }\n  const overallScore = Number((scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length).toFixed(2));\n\n  let organizerName = typeof body.organizerName === "string" ? body.organizerName.trim() : "";\n  if (!organizerName && typeof body.conferenceId === "string" && body.conferenceId) {\n    const owned = await dbGet<CreatedConferenceRow>("SELECT * FROM created_conferences WHERE id = ?", [body.conferenceId]);\n    if (owned) {\n      const owner = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [owned.organizer_id]);\n      organizerName = owner?.organization || owner?.name || "";\n    }\n  }\n\n  const id = `fb_${crypto.randomUUID()}`;\n  await dbRun(\n    `INSERT INTO conference_feedback (\n      id, user_id, conference_id, conference_title, role, ratings, overall_score, comment, recipient_email\n    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,\n    [\n      id,\n      req.userId!,\n      body.conferenceId || null,\n      body.conferenceTitle.trim(),\n      body.role || "Attendee",\n      JSON.stringify(ratings),\n      overallScore,\n      body.comment || null,\n      body.recipientEmail || null,\n    ]\n  );\n  if (organizerName) {\n    await dbRun(\n      "INSERT INTO conference_feedback_routing(feedback_id, organizer_name, organizer_key) VALUES(?,?,?)",\n      [id, organizerName, normalizedOrganizationKey(organizerName)]\n    );\n  }\n\n  res.status(201).json({ ok: true, overallScore });\n}));\n\nactivityRouter.get("/feedback/organizer", asyncHandler(async (req: AuthedRequest, res: Response) => {\n  const organizerContext = await organizerWorkspaceContext(req, res);\n  if (!organizerContext) return;\n  const feedback = await organizerFeedbackRows(organizerContext.accountId, organizerContext.accountOwner);\n  res.json({ feedback });\n}));\n\nactivityRouter.get("/feedback/summary", asyncHandler(async (req: AuthedRequest, res: Response) => {\n  const organizerContext = await organizerWorkspaceContext(req, res);\n  if (!organizerContext) return;\n  const rows = await organizerFeedbackRows(organizerContext.accountId, organizerContext.accountOwner);\n  const averageScore = rows.length\n    ? Number((rows.reduce((sum, row) => sum + row.overallScore, 0) / rows.length).toFixed(2))\n    : 0;\n  res.json({ averageScore, responseCount: rows.length });\n}));\n\nactivityRouter.post("/broadcasts"'''
)

# -----------------------------------------------------------------------------
# Client conference feedback payload + organizer detail API.
# -----------------------------------------------------------------------------
replace_once(
    'src/api/activity.ts',
    '''export interface SubmitFeedbackPayload {\n  conferenceId?: string;\n  conferenceTitle: string;\n  role: string;\n  ratings: Record<string, number>;\n  comment?: string;\n  recipientEmail?: string;\n}\n''',
    '''export interface SubmitFeedbackPayload {\n  conferenceId?: string;\n  conferenceTitle: string;\n  organizerName?: string;\n  role: string;\n  ratings: Record<string, number>;\n  comment?: string;\n  recipientEmail?: string;\n}\n'''
)
replace_once(
    'src/api/activity.ts',
    '''export async function fetchFeedbackSummary(): Promise<{ averageScore: number; responseCount: number }> {\n  const res = await fetch('/api/activity/feedback/summary', { credentials: 'include' });\n  return parseResponse(res);\n}\n''',
    '''export async function fetchFeedbackSummary(): Promise<{ averageScore: number; responseCount: number }> {\n  const res = await fetch('/api/activity/feedback/summary', { credentials: 'include' });\n  return parseResponse(res);\n}\n\nexport interface OrganizerFeedbackRecord {\n  id: string;\n  conferenceId: string | null;\n  conferenceTitle: string;\n  organizerName: string;\n  participantName: string;\n  participantOrganization: string;\n  role: string;\n  ratings: Record<string, number>;\n  overallScore: number;\n  comment: string;\n  date: string;\n  matchReason: 'conference' | 'organization';\n}\n\nexport async function fetchOrganizerFeedback(): Promise<OrganizerFeedbackRecord[]> {\n  const res = await fetch('/api/activity/feedback/organizer', { credentials: 'include' });\n  const data = await parseResponse(res);\n  return Array.isArray(data.feedback) ? data.feedback : [];\n}\n'''
)

# Conference modal: allow exact organizer/society entry when not auto-filled and send it.
replace_once(
    'src/components/ConferenceFeedbackModal.tsx',
    '''  const [recipientEmail, setRecipientEmail] = useState('');\n  const [role, setRole] = useState<ConferenceRole>(defaultRole || 'Attendee');\n  const [submitting, setSubmitting] = useState(false);\n\n  useEffect(() => {\n    if (isOpen) setRole(defaultRole || 'Attendee');\n  }, [isOpen, defaultRole]);\n''',
    '''  const [recipientEmail, setRecipientEmail] = useState('');\n  const [organizerInput, setOrganizerInput] = useState(organizerName);\n  const [role, setRole] = useState<ConferenceRole>(defaultRole || 'Attendee');\n  const [submitting, setSubmitting] = useState(false);\n\n  useEffect(() => {\n    if (isOpen) {\n      setRole(defaultRole || 'Attendee');\n      setOrganizerInput(organizerName);\n    }\n  }, [isOpen, defaultRole, organizerName]);\n'''
)
replace_once(
    'src/components/ConferenceFeedbackModal.tsx',
    '''        conferenceId,\n        conferenceTitle,\n        role,\n''',
    '''        conferenceId,\n        conferenceTitle,\n        organizerName: (organizerName || organizerInput).trim() || undefined,\n        role,\n'''
)
replace_once(
    'src/components/ConferenceFeedbackModal.tsx',
    '''            <AutoFilledField icon={Building2} label="Name of Organizer" value={organizerName} />\n''',
    '''            {organizerName ? (\n              <AutoFilledField icon={Building2} label="Name of Organizer" value={organizerName} />\n            ) : (\n              <div className="space-y-1.5">\n                <label className="text-xs font-bold text-slate-900 flex items-center gap-1.5">\n                  <Building2 className="w-3.5 h-3.5 text-blue-600" />\n                  Name of Organizer / Society\n                </label>\n                <input\n                  value={organizerInput}\n                  onChange={(event) => setOrganizerInput(event.target.value)}\n                  placeholder="e.g. EAGE, AAPG, SPE, IEEE"\n                  className="w-full px-3 py-2.5 bg-white border border-slate-200 focus:border-blue-500 rounded-xl text-xs font-semibold text-slate-700 focus:outline-hidden"\n                />\n                <p className="text-[9px] text-slate-400">Use the organizer's official name so ConferenceGate can route this feedback to a matching Organizer account.</p>\n              </div>\n            )}\n'''
)

# -----------------------------------------------------------------------------
# Organizer feedback panel (real persisted records, with route reason).
# -----------------------------------------------------------------------------
Path('src/components/OrganizerFeedbackPanel.tsx').write_text(r'''import React, { useEffect, useState } from 'react';
import { Building2, Loader2, MessageSquareQuote, RefreshCw, User } from 'lucide-react';
import { fetchOrganizerFeedback, type OrganizerFeedbackRecord } from '../api/activity';

const SCALE = ['Very Poor', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];

export const OrganizerFeedbackPanel: React.FC = () => {
  const [records, setRecords] = useState<OrganizerFeedbackRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    try { setRecords(await fetchOrganizerFeedback()); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { load(); }, []);

  const average = records.length
    ? records.reduce((sum, item) => sum + item.overallScore, 0) / records.length
    : 0;

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <MessageSquareQuote className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-bold text-slate-900">Conference & Workshop Feedback</h2>
          </div>
          <p className="text-xs text-slate-500 mt-1 max-w-3xl">
            Feedback appears here when it belongs to one of your ConferenceGate conferences or when the submitted organizer/society name exactly matches your Organizer account name or organization.
          </p>
        </div>
        <button type="button" onClick={() => load(true)} disabled={refreshing} className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="p-5 rounded-2xl bg-blue-50 border border-blue-100">
          <div className="text-[10px] uppercase font-bold text-blue-500">Average Evaluation</div>
          <div className="text-2xl font-extrabold text-blue-900 mt-1">{records.length ? `${average.toFixed(1)} / 6` : '—'}</div>
        </div>
        <div className="p-5 rounded-2xl bg-white border border-slate-200">
          <div className="text-[10px] uppercase font-bold text-slate-400">Responses</div>
          <div className="text-2xl font-extrabold text-slate-900 mt-1">{records.length}</div>
        </div>
      </div>

      {loading ? (
        <div className="p-10 text-center text-sm text-slate-400"><Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />Loading feedback…</div>
      ) : records.length === 0 ? (
        <div className="p-10 bg-white rounded-3xl border border-slate-200 text-center text-sm text-slate-400">No matching feedback has been submitted yet.</div>
      ) : (
        <div className="space-y-3">
          {records.map((record) => {
            const values = Object.values(record.ratings || {}).filter((value) => Number.isFinite(value));
            const excellent = values.filter((value) => value >= 5).length;
            return (
              <div key={record.id} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div>
                    <div className="font-bold text-sm text-slate-900">{record.conferenceTitle}</div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 mt-1">
                      <span className="inline-flex items-center gap-1"><User className="w-3 h-3" />{record.participantName}{record.participantOrganization ? ` · ${record.participantOrganization}` : ''}</span>
                      <span>{record.role}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-full bg-blue-100 text-blue-800 text-[10px] font-bold">{record.overallScore.toFixed(1)} / 6 · {SCALE[Math.max(0, Math.min(5, Math.round(record.overallScore) - 1))]}</span>
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${record.matchReason === 'organization' ? 'bg-violet-100 text-violet-800' : 'bg-emerald-100 text-emerald-800'}`}>
                      {record.matchReason === 'organization' ? 'Organization name match' : 'Conference match'}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-[10px] text-slate-500">
                  {record.organizerName && <span className="inline-flex items-center gap-1"><Building2 className="w-3 h-3" />Routed to {record.organizerName}</span>}
                  <span>{values.length} criteria rated</span>
                  <span>{excellent} rated Very Good/Excellent</span>
                  <span>{String(record.date || '').replace('T', ' ').slice(0, 16)}</span>
                </div>
                {record.comment && <p className="text-xs text-slate-700 bg-slate-50 border border-slate-100 rounded-xl p-3">{record.comment}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default OrganizerFeedbackPanel;
''')

# -----------------------------------------------------------------------------
# Structured Sponsor Evaluation panel: same six-point approach, persisted via
# the existing organizer->sponsor reputation channel.
# -----------------------------------------------------------------------------
Path('src/components/SponsorEvaluationPanel.tsx').write_text(r'''import React, { useMemo, useState } from 'react';
import { MessageSquareQuote, Send } from 'lucide-react';
import type { Conference } from '../types';
import type { ReviewableSponsor } from '../api/sponsors';

const SCALE = ['Very Poor', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];
const DELIVERY = [
  'Did the sponsor deliver the agreed benefits, assets, or services?',
  'Did the sponsor meet agreed deadlines and event milestones?',
  'Was sponsor communication responsive and professional?',
  'Did the sponsor comply with branding, venue, and event requirements?',
  'Was the sponsor team adequately prepared for its booth, session, or activation?',
];
const PARTNERSHIP = [
  'Did the sponsor contribute positively to the attendee/event experience?',
  'Was collaboration with the organizer efficient and constructive?',
  'Did sponsor representatives behave professionally during the event?',
  'Did the delivered sponsorship provide appropriate value for the agreed package?',
  'Would you work with or recommend this sponsor for a future conference?',
];

const RatingTable: React.FC<{ title: string; prefix: string; questions: string[]; ratings: Record<string, number>; onRate: (key: string, value: number) => void }> = ({ title, prefix, questions, ratings, onRate }) => (
  <div className="space-y-2 overflow-x-auto">
    <div className="text-xs font-bold text-slate-900">{title}</div>
    <table className="w-full min-w-[660px] text-left">
      <thead><tr><th className="w-[44%]" />{SCALE.map((label) => <th key={label} className="text-center text-[9px] uppercase font-bold text-slate-400 px-1 pb-1">{label}</th>)}</tr></thead>
      <tbody>{questions.map((question, index) => {
        const key = `${prefix}_${index}`;
        return <tr key={key} className="border-t border-slate-100">
          <td className="py-2.5 pr-3 text-[11px] text-slate-700">{question}</td>
          {SCALE.map((_, option) => <td key={option} className="text-center py-2 px-1"><button type="button" onClick={() => onRate(key, option + 1)} className="cursor-pointer" aria-label={`${question}: ${SCALE[option]}`}><span className={`inline-block w-4 h-4 rounded-full border-2 ${ratings[key] === option + 1 ? 'bg-blue-600 border-blue-600' : 'border-slate-300 hover:border-blue-400'}`} /></button></td>)}
        </tr>;
      })}</tbody>
    </table>
  </div>
);

export const SponsorEvaluationPanel: React.FC<{
  sponsors: ReviewableSponsor[];
  conferences: Conference[];
  onSubmit: (sponsorId: string, review: { conferenceTitle: string; rating: number; comment: string; ratings: Record<string, number>; overallScore: number }) => void | Promise<void>;
}> = ({ sponsors, conferences, onSubmit }) => {
  const [sponsorId, setSponsorId] = useState(sponsors[0]?.id || '');
  const [conferenceTitle, setConferenceTitle] = useState(conferences[0]?.title || '');
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const values = Object.values(ratings);
  const overallScore = useMemo(() => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0, [ratings]);
  const complete = values.length === DELIVERY.length + PARTNERSHIP.length;

  if (!sponsors.length) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!sponsorId || !conferenceTitle || !complete || sending) return;
    setSending(true);
    try {
      const legacyRating = Math.max(1, Math.min(5, Math.round((overallScore / 6) * 5)));
      await onSubmit(sponsorId, { conferenceTitle, rating: legacyRating, comment: comment.trim(), ratings, overallScore: Number(overallScore.toFixed(2)) });
      setRatings({});
      setComment('');
    } finally { setSending(false); }
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
      <div className="flex items-center gap-2"><MessageSquareQuote className="w-5 h-5 text-blue-600" /><h3 className="font-bold text-sm text-slate-900">Sponsor Evaluation</h3></div>
      <p className="text-xs text-slate-500 -mt-2">Use the same Very Poor → Excellent evaluation approach used for conference feedback. The completed review becomes part of the sponsor's ConferenceGate profile and can be seen alongside reviews from other organizers.</p>
      <form onSubmit={submit} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <select value={sponsorId} onChange={(e) => setSponsorId(e.target.value)} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium">{sponsors.map((s) => <option key={s.id} value={s.id}>{s.companyName}</option>)}</select>
          <select value={conferenceTitle} onChange={(e) => setConferenceTitle(e.target.value)} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium">{conferences.map((c) => <option key={c.id} value={c.title}>{c.title}</option>)}</select>
        </div>
        <RatingTable title="Delivery & Reliability" prefix="delivery" questions={DELIVERY} ratings={ratings} onRate={(key, value) => setRatings((prev) => ({ ...prev, [key]: value }))} />
        <RatingTable title="Partnership & Event Experience" prefix="partnership" questions={PARTNERSHIP} ratings={ratings} onRate={(key, value) => setRatings((prev) => ({ ...prev, [key]: value }))} />
        <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional organizer comments about the sponsor's delivery, collaboration, staff, or event contribution..." className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium" />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-slate-500">{complete ? <>Overall: <span className="font-bold text-blue-700">{overallScore.toFixed(1)} / 6</span></> : <>Complete all {DELIVERY.length + PARTNERSHIP.length} criteria ({values.length}/{DELIVERY.length + PARTNERSHIP.length})</>}</div>
          <button type="submit" disabled={!complete || sending || !sponsorId || !conferenceTitle} className="px-4 py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer disabled:opacity-40"><Send className="w-3.5 h-3.5" />{sending ? 'Submitting…' : 'Submit Sponsor Evaluation'}</button>
        </div>
      </form>
    </div>
  );
};

export default SponsorEvaluationPanel;
''')

# Organizer Dashboard: add panels, feedback tab, structured sponsor evaluator, and fix /6 analytics.
replace_once(
    'src/components/OrganizerDashboard.tsx',
    "import { OrganizerReviewerQuickUpload } from './OrganizerReviewerQuickUpload';\n",
    "import { OrganizerReviewerQuickUpload } from './OrganizerReviewerQuickUpload';\nimport { OrganizerFeedbackPanel } from './OrganizerFeedbackPanel';\nimport { SponsorEvaluationPanel } from './SponsorEvaluationPanel';\n"
)
replace_once(
    'src/components/OrganizerDashboard.tsx',
    '''  onReviewSponsor?: (sponsorId: string, review: { conferenceTitle: string; rating: number; comment: string }) => void;\n''',
    '''  onReviewSponsor?: (sponsorId: string, review: { conferenceTitle: string; rating: number; comment: string; ratings?: Record<string, number>; overallScore?: number }) => void | Promise<void>;\n'''
)
replace_once(
    'src/components/OrganizerDashboard.tsx',
    '''  onReviewSponsor = (_sponsorId: string, _review: { conferenceTitle: string; rating: number; comment: string }) => {},\n''',
    '''  onReviewSponsor = (_sponsorId: string, _review: { conferenceTitle: string; rating: number; comment: string; ratings?: Record<string, number>; overallScore?: number }) => {},\n'''
)
replace_once(
    'src/components/OrganizerDashboard.tsx',
    '''    'overview' | 'wizard' | 'abstracts' | 'professionals' | 'committee' | 'sponsors' | 'communications' | 'workspace' | 'analytics'\n''',
    '''    'overview' | 'wizard' | 'abstracts' | 'professionals' | 'committee' | 'sponsors' | 'feedback' | 'communications' | 'workspace' | 'analytics'\n'''
)
# Remove obsolete local star-review state + submit handler; the new panel owns structured state.
regex_once(
    'src/components/OrganizerDashboard.tsx',
    r'''\n  // Sponsor Feedback / Review State\n  const \[sponsorReviewDraft, setSponsorReviewDraft\] = useState\(\{.*?\n  \};\n\n  // Event Analytics Data''',
    '''\n\n  // Event Analytics Data'''
)
replace_once(
    'src/components/OrganizerDashboard.tsx',
    '''          { id: 'sponsors', label: `Sponsorship Packages (${sponsorshipPackages.length})` },\n          { id: 'communications', label: 'Communications Hub' },\n''',
    '''          { id: 'sponsors', label: `Sponsorship Packages (${sponsorshipPackages.length})` },\n          { id: 'feedback', label: `Feedback (${feedbackSummary.responseCount})` },\n          { id: 'communications', label: 'Communications Hub' },\n'''
)
# Replace old sponsor review card with structured evaluator.
regex_once(
    'src/components/OrganizerDashboard.tsx',
    r'''\n          \{\/\* Rate & Review Sponsor \*\/\}\n          \{reviewableSponsors\.length > 0 && \(\n            <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">.*?\n            </div>\n          \)\}\n''',
    '''\n          {reviewableSponsors.length > 0 && (\n            <SponsorEvaluationPanel\n              sponsors={reviewableSponsors}\n              conferences={conferences}\n              onSubmit={onReviewSponsor}\n            />\n          )}\n'''
)
replace_once(
    'src/components/OrganizerDashboard.tsx',
    '''      {/* Paid Organizer Pro: Team & Access */}\n''',
    '''      {activeTab === 'feedback' && (\n        <OrganizerFeedbackPanel />\n      )}\n\n      {/* Paid Organizer Pro: Team & Access */}\n'''
)
replace_once(
    'src/components/OrganizerDashboard.tsx',
    '''value={feedbackSummary.responseCount > 0 ? `${feedbackSummary.averageScore.toFixed(1)} / 5` : 'No data yet'}''',
    '''value={feedbackSummary.responseCount > 0 ? `${feedbackSummary.averageScore.toFixed(1)} / 6` : 'No data yet'}'''
)
replace_once(
    'src/components/OrganizerDashboard.tsx',
    '''                  maxScore={5}\n                  color={CHART_HEX.blue}\n                  responseCount={feedbackSummary.responseCount}\n''',
    '''                  maxScore={6}\n                  color={CHART_HEX.blue}\n                  responseCount={feedbackSummary.responseCount}\n'''
)

# -----------------------------------------------------------------------------
# Structured sponsor-review backend. Legacy 5-star aggregate remains for
# marketplace compatibility; each structured organizer review retains /6 detail.
# -----------------------------------------------------------------------------
regex_once(
    'server/sponsors.ts',
    r'''    const rating = Number\(body\.rating\);\n    if \(!Number\.isInteger\(rating\) \|\| rating < 1 \|\| rating > 5\) \{\n      return res\.status\(400\)\.json\(\{ error: "rating must be an integer from 1 to 5" \}\);\n    \}\n''',
    '''    const structuredRatings = body.ratings && typeof body.ratings === "object" ? body.ratings : null;\n    const structuredValues = structuredRatings\n      ? Object.values(structuredRatings).map(Number).filter((value) => Number.isFinite(value))\n      : [];\n    let structuredOverall: number | null = null;\n    let rating = Number(body.rating);\n    if (structuredRatings) {\n      if (!structuredValues.length || structuredValues.length !== Object.keys(structuredRatings).length || structuredValues.some((value) => value < 1 || value > 6)) {\n        return res.status(400).json({ error: "Structured sponsor ratings must use the 1 to 6 scale" });\n      }\n      structuredOverall = Number((structuredValues.reduce((sum, value) => sum + value, 0) / structuredValues.length).toFixed(2));\n      rating = Number(((structuredOverall / 6) * 5).toFixed(2));\n    } else if (!Number.isFinite(rating) || rating < 1 || rating > 5) {\n      return res.status(400).json({ error: "rating must be from 1 to 5" });\n    }\n'''
)
regex_once(
    'server/sponsors.ts',
    r'''    const existingReview = await dbGet<SponsorReviewRow>\(.*?\n    const stats = await sponsorDerivedStats\(body\.sponsorId\);\n    res\.status\(201\)\.json\(\{ ok: true, \.\.\.stats \}\);''',
    '''    const existingReview = await dbGet<SponsorReviewRow>(\n      "SELECT * FROM sponsor_reviews WHERE sponsor_id=? AND organizer_id=? AND conference_title=? ORDER BY created_at DESC LIMIT 1",\n      [body.sponsorId, accountId, body.conferenceTitle.trim()]\n    );\n    let reviewId: string;\n    if (existingReview) {\n      reviewId = existingReview.id;\n      await dbRun(\n        "UPDATE sponsor_reviews SET rating=?,comment=?,created_at=datetime('now') WHERE id=?",\n        [rating, body.comment || null, reviewId]\n      );\n    } else {\n      reviewId = `srev_${crypto.randomUUID()}`;\n      await dbRun(\n        "INSERT INTO sponsor_reviews (id, sponsor_id, organizer_id, conference_title, rating, comment) VALUES (?, ?, ?, ?, ?, ?)",\n        [reviewId, body.sponsorId, accountId, body.conferenceTitle.trim(), rating, body.comment || null]\n      );\n    }\n    if (structuredRatings && structuredOverall !== null) {\n      await dbRun(\n        `INSERT INTO sponsor_review_details(review_id,ratings,overall_score,updated_at)\n         VALUES(?,?,?,datetime('now'))\n         ON CONFLICT(review_id) DO UPDATE SET ratings=excluded.ratings,overall_score=excluded.overall_score,updated_at=datetime('now')`,\n        [reviewId, JSON.stringify(structuredRatings), structuredOverall]\n      );\n    }\n    await notifyPaidAccount(\n      body.sponsorId,\n      "sponsor",\n      "sponsorship",\n      "New organizer evaluation",\n      `An organizer submitted a sponsor evaluation for ${body.conferenceTitle.trim()}. Open Sponsor Profile & Reputation to review it.`\n    );\n    const stats = await sponsorDerivedStats(body.sponsorId);\n    res.status(201).json({ ok: true, ...stats, structuredOverall });'''
)
replace_once(
    'server/sponsors.ts',
    '''    const reviewRows = await dbAll<SponsorReviewRow & { organizer_name: string }>(\n      `SELECT sr.*, u.name as organizer_name\n       FROM sponsor_reviews sr\n       JOIN users u ON u.id = sr.organizer_id\n       WHERE sr.sponsor_id = ?\n       ORDER BY sr.created_at DESC`,\n''',
    '''    const reviewRows = await dbAll<SponsorReviewRow & { organizer_name: string; structured_ratings?: string; structured_overall_score?: number | null }>(\n      `SELECT sr.*, u.name as organizer_name, srd.ratings as structured_ratings, srd.overall_score as structured_overall_score\n       FROM sponsor_reviews sr\n       JOIN users u ON u.id = sr.organizer_id\n       LEFT JOIN sponsor_review_details srd ON srd.review_id = sr.id\n       WHERE sr.sponsor_id = ?\n       ORDER BY sr.created_at DESC`,\n'''
)
replace_once(
    'server/sponsors.ts',
    '''        rating: r.rating,\n        comment: r.comment || "",\n        date: r.created_at.split(" ")[0],\n''',
    '''        rating: Number(r.rating),\n        ratings: safeJson(r.structured_ratings, {}),\n        overallScore: r.structured_overall_score === null || r.structured_overall_score === undefined ? null : Number(r.structured_overall_score),\n        comment: r.comment || "",\n        date: r.created_at.split(" ")[0],\n'''
)

# Sponsor types/API + App wiring.
replace_once(
    'src/types.ts',
    '''  rating: number;\n  comment: string;\n  date: string;\n}\n\nexport interface SponsorHistoryEntry''',
    '''  rating: number;\n  ratings?: Record<string, number>;\n  overallScore?: number | null;\n  comment: string;\n  date: string;\n}\n\nexport interface SponsorHistoryEntry'''
)
replace_once(
    'src/api/sponsors.ts',
    '''  rating: number;\n  comment?: string;\n}): Promise<void> {''',
    '''  rating: number;\n  ratings?: Record<string, number>;\n  overallScore?: number;\n  comment?: string;\n}): Promise<void> {'''
)
replace_once(
    'src/App.tsx',
    '''    review: { conferenceTitle: string; rating: number; comment: string }\n''',
    '''    review: { conferenceTitle: string; rating: number; comment: string; ratings?: Record<string, number>; overallScore?: number }\n'''
)
replace_once(
    'src/App.tsx',
    '''        rating: review.rating,\n        comment: review.comment,\n''',
    '''        rating: review.rating,\n        ratings: review.ratings,\n        overallScore: review.overallScore,\n        comment: review.comment,\n'''
)

# Sponsor profile: show structured /6 evaluation alongside legacy aggregate stars.
replace_once(
    'src/components/SponsorPortal.tsx',
    '''                    <StarRating rating={r.rating} />\n''',
    '''                    <div className="flex items-center gap-2">\n                      {typeof r.overallScore === 'number' && (\n                        <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-bold">{r.overallScore.toFixed(1)} / 6</span>\n                      )}\n                      <StarRating rating={r.rating} />\n                    </div>\n'''
)
replace_once(
    'src/components/SponsorPortal.tsx',
    '''                  <p className="text-[11px] text-slate-600">{r.comment}</p>\n                  <div className="text-[10px] text-slate-400">{r.conferenceTitle} · {r.date}</div>\n''',
    '''                  {r.ratings && Object.keys(r.ratings).length > 0 && (\n                    <div className="text-[10px] font-semibold text-blue-700">Structured organizer evaluation · {Object.keys(r.ratings).length} criteria</div>\n                  )}\n                  {r.comment && <p className="text-[11px] text-slate-600">{r.comment}</p>}\n                  <div className="text-[10px] text-slate-400">{r.conferenceTitle} · {r.date}</div>\n'''
)

print('Phase 42 patch applied')
