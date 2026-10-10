from pathlib import Path

path = Path('server/workspaces.ts')
text = path.read_text()

replacements = [
('''async function ensurePaidWorkspace(userId: string): Promise<{
  user: UserRow;
  workspace: AccountWorkspaceRow;
  membership: AccountWorkspaceMemberRow;
}> {
  const user = await dbGet<UserRow>("SELECT * FROM users WHERE id=?", [userId]);
  if (!user || (user.role !== "organizer" && user.role !== "sponsor")) {
    throw Object.assign(new Error("Organizer or Sponsor account required."), { status: 403 });
  }

  let membership = await dbGet<AccountWorkspaceMemberRow>(
    `SELECT m.*
       FROM account_workspace_members m
       JOIN account_workspaces w ON w.id=m.workspace_id
      WHERE m.user_id=? AND m.status='active' AND w.account_role=?
      ORDER BY CASE WHEN m.member_role='owner' THEN 0 ELSE 1 END, m.created_at ASC
      LIMIT 1`,
    [userId, user.role]
  );
''', '''async function ensurePaidWorkspace(
  userId: string,
  expectedRole?: "organizer" | "sponsor"
): Promise<{
  user: UserRow;
  workspace: AccountWorkspaceRow;
  membership: AccountWorkspaceMemberRow;
}> {
  const user = await dbGet<UserRow>("SELECT * FROM users WHERE id=?", [userId]);
  if (!user) {
    throw Object.assign(new Error("Organizer or Sponsor account required."), { status: 403 });
  }

  const ownerPreview = isOwnerPreviewEmail(user.email);
  const accountRole =
    user.role === "organizer" || user.role === "sponsor"
      ? (user.role as "organizer" | "sponsor")
      : null;
  if (!accountRole && !ownerPreview) {
    throw Object.assign(new Error("Organizer or Sponsor account required."), { status: 403 });
  }
  if (expectedRole && accountRole && accountRole !== expectedRole && !ownerPreview) {
    throw Object.assign(new Error(`${expectedRole === "organizer" ? "Organizer" : "Sponsor"} account required.`), { status: 403 });
  }
  const effectiveRole = expectedRole || accountRole;
  if (!effectiveRole) {
    throw Object.assign(new Error("Select an Organizer or Sponsor workspace."), { status: 403 });
  }

  let membership = await dbGet<AccountWorkspaceMemberRow>(
    `SELECT m.*
       FROM account_workspace_members m
       JOIN account_workspaces w ON w.id=m.workspace_id
      WHERE m.user_id=? AND m.status='active' AND w.account_role=?
      ORDER BY CASE WHEN m.member_role='owner' THEN 0 ELSE 1 END, m.created_at ASC
      LIMIT 1`,
    [userId, effectiveRole]
  );
'''),
('''    if (!owner || !["active", "trialing"].includes(owner.subscription_status || "")) {
      throw Object.assign(new Error("The workspace owner's paid subscription is not active."), { status: 402 });
    }
''', '''    if (!owner || (!ownerPreview && !["active", "trialing"].includes(owner.subscription_status || ""))) {
      throw Object.assign(new Error("The workspace owner's paid subscription is not active."), { status: 402 });
    }
'''),
('''    [userId, user.role]
  );
  if (!workspace) {
''', '''    [userId, effectiveRole]
  );
  if (!workspace) {
'''),
('''      `${user.name}'s ${user.role === "organizer" ? "Organizer" : "Sponsor"} Workspace`;
''', '''      `${user.name}'s ${effectiveRole === "organizer" ? "Organizer" : "Sponsor"} Workspace`;
'''),
('''      [workspaceId, userId, user.role, defaultName, seatLimit]
''', '''      [workspaceId, userId, effectiveRole, defaultName, seatLimit]
'''),
('''    const context = await ensurePaidWorkspace(req.userId!);
    if (context.workspace.account_role !== "organizer") {
      return res.status(403).json({ error: "Organizer Pro workspace required." });
    }

    const submitted = typeof req.body?.url === "string" ? req.body.url.trim() : "";
''', '''    const context = await ensurePaidWorkspace(req.userId!, "organizer");
    if (context.workspace.account_role !== "organizer") {
      return res.status(403).json({ error: "Organizer Pro workspace required." });
    }

    const submitted = typeof req.body?.url === "string" ? req.body.url.trim() : "";
'''),
]

for index, (old, new) in enumerate(replacements, 1):
    if old not in text:
        raise SystemExit(f'Phase 58 replacement {index} not found; refusing partial patch')
    text = text.replace(old, new, 1)

path.write_text(text)
print('Phase 58 patch applied successfully')
