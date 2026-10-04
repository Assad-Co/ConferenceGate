from pathlib import Path


def patch(path_str, replacements):
    p=Path(path_str); text=p.read_text()
    for old,new,label in replacements:
        if old not in text: raise RuntimeError(f'{path_str}: missing marker {label}')
        text=text.replace(old,new,1)
    p.write_text(text); print('patched',path_str)

patch('server/db.ts', [(
"""    CREATE TABLE IF NOT EXISTS organizer_meeting_plans (
      id TEXT PRIMARY KEY,
      organizer_id TEXT NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      attendees TEXT NOT NULL DEFAULT '[]',
      meeting_date TEXT NOT NULL,
      meeting_time TEXT NOT NULL,
      organizer_timezone TEXT NOT NULL,
      meeting_link TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_organizer_meeting_plans_owner
      ON organizer_meeting_plans(organizer_id, meeting_date, meeting_time);
""",
"""    CREATE TABLE IF NOT EXISTS organizer_meeting_plans (
      id TEXT PRIMARY KEY,
      organizer_id TEXT NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      attendees TEXT NOT NULL DEFAULT '[]',
      meeting_date TEXT NOT NULL,
      meeting_time TEXT NOT NULL,
      organizer_timezone TEXT NOT NULL,
      meeting_link TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_organizer_meeting_plans_owner
      ON organizer_meeting_plans(organizer_id, meeting_date, meeting_time);

    CREATE TABLE IF NOT EXISTS organizer_coordination_notes (
      id TEXT PRIMARY KEY,
      organizer_id TEXT NOT NULL REFERENCES users(id),
      author_label TEXT NOT NULL,
      recipient_label TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_organizer_coordination_notes_owner
      ON organizer_coordination_notes(organizer_id, created_at);
""",
'coordination notes table')])

routes=r'''
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

'''
patch('server/activity.ts', [(
'activityRouter.get("/organizer/meeting-plans", asyncHandler(async (req: AuthedRequest, res: Response) => {',
routes+'activityRouter.get("/organizer/meeting-plans", asyncHandler(async (req: AuthedRequest, res: Response) => {',
'coordination note routes')])

client=r'''
export interface OrganizerCoordinationNote {
  id: string;
  from: string;
  to: string;
  message: string;
  date: string;
}

export async function fetchOrganizerCoordinationNotes(): Promise<OrganizerCoordinationNote[]> {
  const res = await fetch('/api/activity/organizer/coordination-notes', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.notes;
}

export async function createOrganizerCoordinationNote(payload: { from: string; to: string; message: string }): Promise<OrganizerCoordinationNote> {
  const res = await fetch('/api/activity/organizer/coordination-notes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload),
  });
  const data = await parseResponse(res);
  return data.note;
}

'''
patch('src/api/activity.ts', [(
'export interface OrganizerCommitteeTask {',
client+'export interface OrganizerCommitteeTask {',
'coordination note client APIs')])

patch('src/components/OrganizerDashboard.tsx', [(
"""  type OrganizerMeetingPlan,
} from '../api/activity';""",
"""  type OrganizerMeetingPlan,
  fetchOrganizerCoordinationNotes,
  createOrganizerCoordinationNote,
  type OrganizerCoordinationNote,
} from '../api/activity';""",
'note API imports'),
(
"""  const [committeeFollowUps, setCommitteeFollowUps] = useState<
    Array<{ id: string; from: string; to: string; message: string; date: string }>
  >([]);

  const handleSendFollowUp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!followUpDraft.message.trim()) return;
    const id = `fu_${Date.now()}`;
    setCommitteeFollowUps((prev) => [
      { id, ...followUpDraft, date: new Date().toLocaleString() },
      ...prev,
    ]);
    // This is a local coordination note only. Do not claim delivery to a committee member unless
    // the recipient is linked to a real ConferenceGate identity and a server delivery route.
    setFollowUpDraft({ ...followUpDraft, message: '' });
  };""",
"""  const [committeeFollowUps, setCommitteeFollowUps] = useState<OrganizerCoordinationNote[]>([]);

  useEffect(() => {
    fetchOrganizerCoordinationNotes().then(setCommitteeFollowUps).catch(() => {});
  }, []);

  const handleSendFollowUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!followUpDraft.message.trim()) return;
    try {
      const note = await createOrganizerCoordinationNote({ ...followUpDraft, message: followUpDraft.message.trim() });
      setCommitteeFollowUps((prev) => [note, ...prev]);
      setFollowUpDraft({ ...followUpDraft, message: '' });
    } catch (error) {
      showToast({ type: 'info', title: 'Could not save coordination note', message: error instanceof Error ? error.message : 'Please try again.' });
    }
  };""",
'persist note UI'),
(
'Coordination note only — no email or member notification is sent',
'Saved to this Organizer workspace — no email or member notification is sent',
'note persistence copy'),
(
'Session-only coordination note',
'Workspace coordination note',
'note history copy')])

patch('scripts/smokeWorkspaceSeats.mjs', [(
"""  const createdMeeting = await request('/api/activity/organizer/meeting-plans', {
    method: 'POST',
    cookie: member.cookie,""",
"""  const createdNote = await request('/api/activity/organizer/coordination-notes', {
    method: 'POST', cookie: member.cookie,
    body: { from: 'Conference Organizer', to: 'Technical Committee Chair', message: 'Please confirm reviewer coverage.' },
  });
  if (!createdNote?.note?.id) throw new Error('Organizer coordination note was not persisted.');
  const ownerNotes = await request('/api/activity/organizer/coordination-notes', { cookie: owner.cookie });
  if (!(ownerNotes.notes || []).some((note) => note.id === createdNote.note.id)) {
    throw new Error('Organizer coordination note was not shared across workspace seats.');
  }

  const createdMeeting = await request('/api/activity/organizer/meeting-plans', {
    method: 'POST',
    cookie: member.cookie,""",
'note persistence smoke'),
(
"""  await request('/api/activity/organizer/meeting-plans', {
    method: 'POST',
    cookie: member.cookie,
    expectedStatus: 403,""",
"""  await request('/api/activity/organizer/coordination-notes', {
    method: 'POST', cookie: member.cookie, expectedStatus: 403,
    body: { from: 'Blocked', to: 'Blocked', message: 'Viewer must not write' },
  });
  await request('/api/activity/organizer/meeting-plans', {
    method: 'POST',
    cookie: member.cookie,
    expectedStatus: 403,""",
'viewer note guard')])
