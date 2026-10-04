from pathlib import Path


def patch_file(path_str, replacements):
    path = Path(path_str)
    text = path.read_text()
    for old, new, label in replacements:
        if old not in text:
            raise RuntimeError(f'{path_str}: missing patch marker: {label}')
        text = text.replace(old, new, 1)
    path.write_text(text)
    print(f'patched {path_str}')

patch_file('server/db.ts', [(
"""    CREATE TABLE IF NOT EXISTS organizer_broadcasts (
      id TEXT PRIMARY KEY,
      organizer_id TEXT NOT NULL REFERENCES users(id),
      recipient_group TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS created_conferences (""",
"""    CREATE TABLE IF NOT EXISTS organizer_broadcasts (
      id TEXT PRIMARY KEY,
      organizer_id TEXT NOT NULL REFERENCES users(id),
      recipient_group TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS organizer_committee_tasks (
      id TEXT PRIMARY KEY,
      organizer_id TEXT NOT NULL REFERENCES users(id),
      assignee_name TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      due_date TEXT,
      priority TEXT NOT NULL DEFAULT 'Medium' CHECK(priority IN ('Low','Medium','High')),
      status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','In Progress','Completed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_organizer_committee_tasks_owner
      ON organizer_committee_tasks(organizer_id, created_at);

    CREATE TABLE IF NOT EXISTS organizer_meeting_plans (
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

    CREATE TABLE IF NOT EXISTS created_conferences (""",
'organizer planning tables')])

planning_routes = r'''
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

'''

patch_file('server/activity.ts', [(
'activityRouter.get("/broadcasts/mine", asyncHandler(async (req: AuthedRequest, res: Response) => {',
planning_routes + 'activityRouter.get("/broadcasts/mine", asyncHandler(async (req: AuthedRequest, res: Response) => {',
'organizer planning routes')])

client_api = r'''
export interface OrganizerCommitteeTask {
  id: string;
  assignee: string;
  title: string;
  description: string;
  dueDate: string;
  priority: 'Low' | 'Medium' | 'High';
  status: 'Pending' | 'In Progress' | 'Completed';
  createdAt: string;
  updatedAt: string;
}

export async function fetchOrganizerCommitteeTasks(): Promise<OrganizerCommitteeTask[]> {
  const res = await fetch('/api/activity/organizer/committee-tasks', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.tasks;
}

export async function createOrganizerCommitteeTask(payload: {
  assignee: string;
  title: string;
  description?: string;
  dueDate?: string;
  priority: 'Low' | 'Medium' | 'High';
}): Promise<OrganizerCommitteeTask> {
  const res = await fetch('/api/activity/organizer/committee-tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await parseResponse(res);
  return data.task;
}

export async function updateOrganizerCommitteeTaskStatus(
  id: string,
  status: OrganizerCommitteeTask['status']
): Promise<OrganizerCommitteeTask> {
  const res = await fetch(`/api/activity/organizer/committee-tasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ status }),
  });
  const data = await parseResponse(res);
  return data.task;
}

export interface OrganizerMeetingPlan {
  id: string;
  title: string;
  attendees: string[];
  date: string;
  time: string;
  organizerTimezone: string;
  meetingLink: string;
  createdAt: string;
}

export async function fetchOrganizerMeetingPlans(): Promise<OrganizerMeetingPlan[]> {
  const res = await fetch('/api/activity/organizer/meeting-plans', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.meetings;
}

export async function createOrganizerMeetingPlan(payload: Omit<OrganizerMeetingPlan, 'id' | 'createdAt'>): Promise<OrganizerMeetingPlan> {
  const res = await fetch('/api/activity/organizer/meeting-plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await parseResponse(res);
  return data.meeting;
}

'''
patch_file('src/api/activity.ts', [(
'export interface OrganizerBroadcast {',
client_api + 'export interface OrganizerBroadcast {',
'organizer planning client APIs')])

patch_file('src/components/OrganizerDashboard.tsx', [(
"""  type ProfessionalDirectoryProfile,
} from '../api/activity';""",
"""  type ProfessionalDirectoryProfile,
  fetchOrganizerCommitteeTasks,
  createOrganizerCommitteeTask,
  updateOrganizerCommitteeTaskStatus,
  fetchOrganizerMeetingPlans,
  createOrganizerMeetingPlan,
  type OrganizerCommitteeTask,
  type OrganizerMeetingPlan,
} from '../api/activity';""",
'planning API imports'),
(
"""  const [committeeTasks, setCommitteeTasks] = useState<
    Array<{
      id: string;
      assignee: string;
      title: string;
      description: string;
      dueDate: string;
      priority: string;
      status: 'Pending' | 'In Progress' | 'Completed';
    }>
  >([]);

  const handleAssignTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskDraft.assignee || !taskDraft.title.trim()) return;
    setCommitteeTasks((prev) => [
      { id: `task_${Date.now()}`, ...taskDraft, status: 'Pending' },
      ...prev,
    ]);
    setTaskDraft({ assignee: taskDraft.assignee, title: '', description: '', dueDate: '', priority: 'Medium' });
  };

  const handleCycleTaskStatus = (id: string) => {
    const order: Array<'Pending' | 'In Progress' | 'Completed'> = ['Pending', 'In Progress', 'Completed'];
    setCommitteeTasks((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, status: order[(order.indexOf(t.status) + 1) % order.length] } : t
      )
    );
  };""",
"""  const [committeeTasks, setCommitteeTasks] = useState<OrganizerCommitteeTask[]>([]);

  useEffect(() => {
    fetchOrganizerCommitteeTasks().then(setCommitteeTasks).catch(() => {});
  }, []);

  const handleAssignTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskDraft.assignee || !taskDraft.title.trim()) return;
    try {
      const task = await createOrganizerCommitteeTask({
        assignee: taskDraft.assignee,
        title: taskDraft.title.trim(),
        description: taskDraft.description.trim(),
        dueDate: taskDraft.dueDate,
        priority: taskDraft.priority as 'Low' | 'Medium' | 'High',
      });
      setCommitteeTasks((prev) => [task, ...prev]);
      setTaskDraft({ assignee: taskDraft.assignee, title: '', description: '', dueDate: '', priority: 'Medium' });
    } catch (error) {
      showToast({ type: 'info', title: 'Could not save task', message: error instanceof Error ? error.message : 'Please try again.' });
    }
  };

  const handleCycleTaskStatus = async (id: string) => {
    const order: Array<OrganizerCommitteeTask['status']> = ['Pending', 'In Progress', 'Completed'];
    const current = committeeTasks.find((task) => task.id === id);
    if (!current) return;
    const status = order[(order.indexOf(current.status) + 1) % order.length];
    try {
      const updated = await updateOrganizerCommitteeTaskStatus(id, status);
      setCommitteeTasks((prev) => prev.map((task) => task.id === id ? updated : task));
    } catch (error) {
      showToast({ type: 'info', title: 'Could not update task', message: error instanceof Error ? error.message : 'Please try again.' });
    }
  };""",
'task persistence handlers'),
(
"""  const [scheduledMeetings, setScheduledMeetings] = useState<
    Array<{
      id: string;
      title: string;
      attendees: string[];
      date: string;
      time: string;
      organizerTimezone: string;
      meetingLink: string;
    }>
  >([]);""",
"""  const [scheduledMeetings, setScheduledMeetings] = useState<OrganizerMeetingPlan[]>([]);

  useEffect(() => {
    fetchOrganizerMeetingPlans().then(setScheduledMeetings).catch(() => {});
  }, []);""",
'meeting persistence load'),
(
"""  const handleScheduleMeeting = (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !meetingDraft.title.trim() ||
      !meetingDraft.date ||
      !meetingDraft.time ||
      !meetingDraft.meetingLink.trim() ||
      meetingDraft.attendees.length === 0
    )
      return;
    setScheduledMeetings((prev) => [
      {
        id: `mtg_${Date.now()}`,
        ...meetingDraft,
      },
      ...prev,
    ]);
    setMeetingDraft({
      title: '',
      attendees: [],
      date: '',
      time: '',
      organizerTimezone: meetingDraft.organizerTimezone,
      meetingLink: '',
    });
  };""",
"""  const handleScheduleMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !meetingDraft.title.trim() ||
      !meetingDraft.date ||
      !meetingDraft.time ||
      !meetingDraft.meetingLink.trim() ||
      meetingDraft.attendees.length === 0
    ) return;
    try {
      const meeting = await createOrganizerMeetingPlan({ ...meetingDraft, title: meetingDraft.title.trim(), meetingLink: meetingDraft.meetingLink.trim() });
      setScheduledMeetings((prev) => [meeting, ...prev]);
      setMeetingDraft({
        title: '',
        attendees: [],
        date: '',
        time: '',
        organizerTimezone: meetingDraft.organizerTimezone,
        meetingLink: '',
      });
    } catch (error) {
      showToast({ type: 'info', title: 'Could not save meeting plan', message: error instanceof Error ? error.message : 'Please try again.' });
    }
  };""",
'meeting persistence handler'),
(
'Session-only planning board. Tasks are not yet persisted or delivered to members.',
'Saved to this Organizer workspace. Task records persist across sessions; assigning a task here does not send it to the member yet.',
'task persistence UI'),
(
'Planning only: ConferenceGate does not create the room, send invitations, or persist this plan yet. Paste a real link from your conferencing account.',
'Saved to this Organizer workspace. ConferenceGate does not create the external room or send invitations; paste a real link from your conferencing account.',
'meeting persistence UI')])

# Extend the existing workspace smoke test: member writes shared planning data, owner reads it,
# and viewer write access is blocked by the same workspace governance rules.
patch_file('scripts/smokeWorkspaceSeats.mjs', [(
"""  const ownerConferences = await request('/api/activity/conferences/mine', { cookie: owner.cookie });
  if (!(ownerConferences.conferences || []).some((conference) => conference.id === memberConferenceId)) {
    throw new Error('Member-created conference was not stored in the shared owner workspace.');
  }

  const adminEnterpriseReport = await request('/api/workspaces/enterprise-report', {""",
"""  const ownerConferences = await request('/api/activity/conferences/mine', { cookie: owner.cookie });
  if (!(ownerConferences.conferences || []).some((conference) => conference.id === memberConferenceId)) {
    throw new Error('Member-created conference was not stored in the shared owner workspace.');
  }

  const createdTask = await request('/api/activity/organizer/committee-tasks', {
    method: 'POST',
    cookie: member.cookie,
    body: {
      assignee: 'Technical Committee Chair',
      title: 'Review Track 1 assignments',
      description: 'Confirm reviewer coverage.',
      dueDate: '2027-04-20',
      priority: 'High',
    },
  });
  if (!createdTask?.task?.id || createdTask.task.status !== 'Pending') {
    throw new Error('Organizer committee task was not persisted.');
  }
  const ownerTasks = await request('/api/activity/organizer/committee-tasks', { cookie: owner.cookie });
  if (!(ownerTasks.tasks || []).some((task) => task.id === createdTask.task.id)) {
    throw new Error('Organizer task was not shared across workspace seats.');
  }
  const progressedTask = await request(`/api/activity/organizer/committee-tasks/${createdTask.task.id}`, {
    method: 'PATCH',
    cookie: owner.cookie,
    body: { status: 'In Progress' },
  });
  if (progressedTask?.task?.status !== 'In Progress') {
    throw new Error('Organizer task status was not persisted.');
  }

  const createdMeeting = await request('/api/activity/organizer/meeting-plans', {
    method: 'POST',
    cookie: member.cookie,
    body: {
      title: 'Committee Planning Sync',
      attendees: ['Technical Committee Chair'],
      date: '2027-04-21',
      time: '10:00',
      organizerTimezone: 'Asia/Dubai',
      meetingLink: 'https://meet.example.com/conferencegate-smoke',
    },
  });
  if (!createdMeeting?.meeting?.id) throw new Error('Organizer meeting plan was not persisted.');
  const ownerMeetings = await request('/api/activity/organizer/meeting-plans', { cookie: owner.cookie });
  if (!(ownerMeetings.meetings || []).some((meeting) => meeting.id === createdMeeting.meeting.id)) {
    throw new Error('Organizer meeting plan was not shared across workspace seats.');
  }

  const adminEnterpriseReport = await request('/api/workspaces/enterprise-report', {""",
'workspace planning persistence smoke'),
(
"""  await request('/api/activity/conferences', {
    method: 'POST',
    cookie: member.cookie,
    expectedStatus: 403,
    body: {
      id: 'conf_viewer_must_fail',
      title: 'Viewer Must Not Create',
    },
  });""",
"""  await request('/api/activity/conferences', {
    method: 'POST',
    cookie: member.cookie,
    expectedStatus: 403,
    body: {
      id: 'conf_viewer_must_fail',
      title: 'Viewer Must Not Create',
    },
  });
  await request('/api/activity/organizer/committee-tasks', {
    method: 'POST',
    cookie: member.cookie,
    expectedStatus: 403,
    body: { assignee: 'Blocked', title: 'Viewer must not write', priority: 'Low' },
  });
  await request('/api/activity/organizer/meeting-plans', {
    method: 'POST',
    cookie: member.cookie,
    expectedStatus: 403,
    body: {
      title: 'Viewer must not schedule', attendees: ['Blocked'], date: '2027-04-22', time: '11:00',
      organizerTimezone: 'UTC', meetingLink: 'https://meet.example.com/blocked'
    },
  });""",
'viewer planning write guard')])
