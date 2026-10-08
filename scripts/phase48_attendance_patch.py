from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one exact match, found {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


# Persistent catalog-linked attendance. This records a member confirmation tied to one exact
# conference/organizer; it is not automatically treated as third-party verified attendance.
replace_once(
    "server/db.ts",
    "    CREATE TABLE IF NOT EXISTS conversations (\n",
    """    CREATE TABLE IF NOT EXISTS conference_attendance (\n      id TEXT PRIMARY KEY,\n      user_id TEXT NOT NULL REFERENCES users(id),\n      conference_id TEXT NOT NULL,\n      conference_title TEXT NOT NULL,\n      organizer_name TEXT NOT NULL,\n      start_date TEXT NOT NULL,\n      end_date TEXT NOT NULL,\n      location TEXT,\n      source_type TEXT NOT NULL DEFAULT 'catalog' CHECK(source_type IN ('conferencegate','catalog')),\n      source_url TEXT,\n      attended_at TEXT NOT NULL DEFAULT (datetime('now')),\n      UNIQUE(user_id, conference_id)\n    );\n\n    CREATE INDEX IF NOT EXISTS idx_conference_attendance_user_date\n      ON conference_attendance(user_id, start_date, attended_at);\n\n    CREATE TABLE IF NOT EXISTS conversations (\n""",
)

# API contract used by both internal ConferenceDetail and stored/external conference detail pages.
replace_once(
    "src/api/activity.ts",
    """export async function fetchMyRegistrations(): Promise<ConferenceRegistration[]> {\n  const res = await fetch('/api/activity/registrations/mine', { credentials: 'include' });\n  const data = await parseResponse(res);\n  return data.registrations;\n}\n\n""",
    """export async function fetchMyRegistrations(): Promise<ConferenceRegistration[]> {\n  const res = await fetch('/api/activity/registrations/mine', { credentials: 'include' });\n  const data = await parseResponse(res);\n  return data.registrations;\n}\n\nexport interface ConferenceAttendance {\n  id: string;\n  conferenceId: string;\n  conferenceTitle: string;\n  organizerName: string;\n  startDate: string;\n  endDate: string;\n  location: string;\n  sourceType: 'conferencegate' | 'catalog';\n  sourceUrl: string | null;\n  attendedAt: string;\n}\n\nexport interface MarkConferenceAttendancePayload {\n  conferenceId: string;\n  conferenceTitle: string;\n  organizerName: string;\n  startDate: string;\n  endDate: string;\n  location?: string;\n  sourceType: 'conferencegate' | 'catalog';\n  sourceUrl?: string | null;\n  localDate: string;\n}\n\nexport async function fetchMyConferenceAttendance(): Promise<ConferenceAttendance[]> {\n  const res = await fetch('/api/activity/attendance/mine', { credentials: 'include' });\n  const data = await parseResponse(res);\n  return Array.isArray(data.attendance) ? data.attendance : [];\n}\n\nexport async function markConferenceAttended(\n  payload: MarkConferenceAttendancePayload\n): Promise<ConferenceAttendance> {\n  const res = await fetch('/api/activity/attendance', {\n    method: 'POST',\n    headers: { 'Content-Type': 'application/json' },\n    credentials: 'include',\n    body: JSON.stringify(payload),\n  });\n  const data = await parseResponse(res);\n  return data.attendance;\n}\n\n""",
)

# Server endpoints: only events whose start date has arrived can be marked attended. The client
# sends its local calendar date; it is accepted only within one day of UTC to avoid timezone-edge
# false negatives without making the rule arbitrary.
marker = "// Organizer-facing aggregate counts — every registered account is visible to organizers so they\n"
attendance_routes = r'''function toConferenceAttendanceDTO(row: any) {
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

'''
replace_once("server/activity.ts", marker, attendance_routes + marker)

# For catalog-linked attendance, feedback is locked server-side to the stored conference title and
# organizer. Re-submitting updates the member's review instead of inflating the organizer score.
replace_once(
    "server/activity.ts",
    """  let organizerName = typeof body.organizerName === \"string\" ? body.organizerName.trim() : \"\";\n  if (!organizerName && typeof body.conferenceId === \"string\" && body.conferenceId) {\n    const owned = await dbGet<CreatedConferenceRow>(\"SELECT * FROM created_conferences WHERE id = ?\", [body.conferenceId]);\n    if (owned) {\n      const owner = await dbGet<UserRow>(\"SELECT * FROM users WHERE id = ?\", [owned.organizer_id]);\n      organizerName = owner?.organization || owner?.name || \"\";\n    }\n  }\n\n  const id = `fb_${crypto.randomUUID()}`;\n  await dbRun(\n    `INSERT INTO conference_feedback (\n      id, user_id, conference_id, conference_title, role, ratings, overall_score, comment, recipient_email\n    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,\n    [\n      id,\n      req.userId!,\n      body.conferenceId || null,\n      body.conferenceTitle.trim(),\n      body.role || \"Attendee\",\n      JSON.stringify(ratings),\n      overallScore,\n      body.comment || null,\n      body.recipientEmail || null,\n    ]\n  );\n  if (organizerName) {\n    await dbRun(\n      \"INSERT INTO conference_feedback_routing(feedback_id, organizer_name, organizer_key) VALUES(?,?,?)\",\n      [id, organizerName, normalizedOrganizationKey(organizerName)]\n    );\n  }\n\n  res.status(201).json({ ok: true, overallScore });\n""",
    """  let conferenceTitle = body.conferenceTitle.trim();\n  let organizerName = typeof body.organizerName === \"string\" ? body.organizerName.trim() : \"\";\n  if (typeof body.conferenceId === \"string\" && body.conferenceId) {\n    const attendance = await dbGet<any>(\n      \"SELECT * FROM conference_attendance WHERE user_id = ? AND conference_id = ?\",\n      [req.userId!, body.conferenceId]\n    );\n    if (attendance) {\n      conferenceTitle = attendance.conference_title;\n      organizerName = attendance.organizer_name;\n    } else if (!organizerName) {\n      const owned = await dbGet<CreatedConferenceRow>(\"SELECT * FROM created_conferences WHERE id = ?\", [body.conferenceId]);\n      if (owned) {\n        const owner = await dbGet<UserRow>(\"SELECT * FROM users WHERE id = ?\", [owned.organizer_id]);\n        organizerName = owner?.organization || owner?.name || \"\";\n      }\n    }\n  }\n\n  const existingFeedback = typeof body.conferenceId === \"string\" && body.conferenceId\n    ? await dbGet<ConferenceFeedbackRow>(\n        \"SELECT * FROM conference_feedback WHERE user_id = ? AND conference_id = ? ORDER BY created_at DESC LIMIT 1\",\n        [req.userId!, body.conferenceId]\n      )\n    : undefined;\n  const id = existingFeedback?.id || `fb_${crypto.randomUUID()}`;\n  if (existingFeedback) {\n    await dbRun(\n      `UPDATE conference_feedback\n          SET conference_title=?, role=?, ratings=?, overall_score=?, comment=?, recipient_email=?, created_at=datetime('now')\n        WHERE id=?`,\n      [conferenceTitle, body.role || \"Attendee\", JSON.stringify(ratings), overallScore, body.comment || null, body.recipientEmail || null, id]\n    );\n    await dbRun(\"DELETE FROM conference_feedback_routing WHERE feedback_id = ?\", [id]);\n  } else {\n    await dbRun(\n      `INSERT INTO conference_feedback (\n        id, user_id, conference_id, conference_title, role, ratings, overall_score, comment, recipient_email\n      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,\n      [\n        id, req.userId!, body.conferenceId || null, conferenceTitle, body.role || \"Attendee\",\n        JSON.stringify(ratings), overallScore, body.comment || null, body.recipientEmail || null,\n      ]\n    );\n  }\n  if (organizerName) {\n    await dbRun(\n      \"INSERT INTO conference_feedback_routing(feedback_id, organizer_name, organizer_key) VALUES(?,?,?)\",\n      [id, organizerName, normalizedOrganizationKey(organizerName)]\n    );\n  }\n\n  res.status(existingFeedback ? 200 : 201).json({ ok: true, overallScore, updated: Boolean(existingFeedback) });\n""",
)

print("Phase 48 attendance backend/API patch applied")
