import { Router, Response } from "express";
import crypto from "crypto";
import { asyncHandler } from "./asyncHandler";
import { AuthedRequest, requireAuth } from "./auth";
import {
  dbAll,
  dbGet,
  dbRun,
  UserRow,
  AccountWorkspaceRow,
  AccountWorkspaceMemberRow,
  AccountWorkspaceAuditRow,
} from "./db";

export const workspacesRouter = Router();
workspacesRouter.use(requireAuth);

function parseDetails(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function ensurePaidWorkspace(userId: string): Promise<{
  user: UserRow;
  workspace: AccountWorkspaceRow;
  membership: AccountWorkspaceMemberRow;
}> {
  const user = await dbGet<UserRow>("SELECT * FROM users WHERE id=?", [userId]);
  if (!user || !["organizer", "sponsor"].includes(user.role)) {
    throw Object.assign(new Error("Organizer or Sponsor account required."), { status: 403 });
  }
  if (!["active", "trialing"].includes(user.subscription_status || "")) {
    throw Object.assign(new Error("Paid workspace subscription required."), { status: 402 });
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

  if (!membership) {
    let workspace = await dbGet<AccountWorkspaceRow>(
      "SELECT * FROM account_workspaces WHERE owner_id=? AND account_role=?",
      [userId, user.role]
    );
    if (!workspace) {
      const workspaceId = `ws_${crypto.randomUUID()}`;
      const defaultName =
        user.organization?.trim() ||
        `${user.name}'s ${user.role === "organizer" ? "Organizer" : "Sponsor"} Workspace`;
      const seatLimit = Math.max(2, Math.min(1000, Number(process.env.WORKSPACE_SEAT_LIMIT || 10)));
      await dbRun(
        "INSERT INTO account_workspaces(id,owner_id,account_role,name,seat_limit) VALUES(?,?,?,?,?)",
        [workspaceId, userId, user.role, defaultName, seatLimit]
      );
      workspace = (await dbGet<AccountWorkspaceRow>("SELECT * FROM account_workspaces WHERE id=?", [workspaceId]))!;
    }
    const memberId = `wsm_${crypto.randomUUID()}`;
    await dbRun(
      "INSERT OR IGNORE INTO account_workspace_members(id,workspace_id,user_id,member_role,status) VALUES(?,?,?,'owner','active')",
      [memberId, workspace.id, userId]
    );
    membership = (await dbGet<AccountWorkspaceMemberRow>(
      "SELECT * FROM account_workspace_members WHERE workspace_id=? AND user_id=?",
      [workspace.id, userId]
    ))!;
  }

  const workspace = (await dbGet<AccountWorkspaceRow>(
    "SELECT * FROM account_workspaces WHERE id=?",
    [membership.workspace_id]
  ))!;
  return { user, workspace, membership };
}

async function audit(
  workspaceId: string,
  actorId: string,
  action: string,
  targetUserId: string | null = null,
  details: Record<string, unknown> | null = null
) {
  await dbRun(
    "INSERT INTO account_workspace_audit(id,workspace_id,actor_id,action,target_user_id,details) VALUES(?,?,?,?,?,?)",
    [
      `wsa_${crypto.randomUUID()}`,
      workspaceId,
      actorId,
      action,
      targetUserId,
      details ? JSON.stringify(details) : null,
    ]
  );
}

async function workspaceDTO(context: {
  workspace: AccountWorkspaceRow;
  membership: AccountWorkspaceMemberRow;
}) {
  const rows = await dbAll<any>(
    `SELECT m.*,u.name,u.email,u.title,u.organization,u.avatar,u.role as account_role
       FROM account_workspace_members m
       JOIN users u ON u.id=m.user_id
      WHERE m.workspace_id=? AND m.status='active'
      ORDER BY CASE m.member_role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, u.name ASC`,
    [context.workspace.id]
  );
  const auditRows = await dbAll<any>(
    `SELECT a.*,u.name as actor_name,t.name as target_name
       FROM account_workspace_audit a
       JOIN users u ON u.id=a.actor_id
       LEFT JOIN users t ON t.id=a.target_user_id
      WHERE a.workspace_id=?
      ORDER BY a.created_at DESC
      LIMIT 100`,
    [context.workspace.id]
  );
  return {
    id: context.workspace.id,
    name: context.workspace.name,
    accountRole: context.workspace.account_role,
    ownerId: context.workspace.owner_id,
    seatLimit: context.workspace.seat_limit,
    myRole: context.membership.member_role,
    members: rows.map((row: any) => ({
      id: row.user_id,
      name: row.name,
      email: row.email,
      title: row.title || "",
      organization: row.organization || "",
      avatar: row.avatar || null,
      accountRole: row.account_role,
      workspaceRole: row.member_role,
      joinedAt: row.created_at,
    })),
    audit: auditRows.map((row: any) => ({
      id: row.id,
      actorId: row.actor_id,
      actorName: row.actor_name,
      action: row.action,
      targetUserId: row.target_user_id,
      targetName: row.target_name || null,
      details: parseDetails(row.details),
      createdAt: row.created_at,
    })),
  };
}

workspacesRouter.get(
  "/mine",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    try {
      const context = await ensurePaidWorkspace(req.userId!);
      res.json({ workspace: await workspaceDTO(context) });
    } catch (error: any) {
      res.status(error?.status || 500).json({ error: error?.message || "Could not load workspace." });
    }
  })
);

workspacesRouter.patch(
  "/mine",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    let context;
    try {
      context = await ensurePaidWorkspace(req.userId!);
    } catch (error: any) {
      return res.status(error?.status || 500).json({ error: error?.message || "Could not load workspace." });
    }
    if (!["owner", "admin"].includes(context.membership.member_role)) {
      return res.status(403).json({ error: "Workspace admin permission required." });
    }
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name || name.length > 120) {
      return res.status(400).json({ error: "Workspace name must be between 1 and 120 characters." });
    }
    await dbRun("UPDATE account_workspaces SET name=?,updated_at=datetime('now') WHERE id=?", [
      name,
      context.workspace.id,
    ]);
    await audit(context.workspace.id, req.userId!, "workspace_renamed", null, { name });
    const updatedContext = await ensurePaidWorkspace(req.userId!);
    res.json({ workspace: await workspaceDTO(updatedContext) });
  })
);

workspacesRouter.post(
  "/members",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    let context;
    try {
      context = await ensurePaidWorkspace(req.userId!);
    } catch (error: any) {
      return res.status(error?.status || 500).json({ error: error?.message || "Could not load workspace." });
    }
    if (!["owner", "admin"].includes(context.membership.member_role)) {
      return res.status(403).json({ error: "Workspace admin permission required." });
    }

    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const memberRole = ["admin", "member", "viewer"].includes(req.body?.memberRole)
      ? req.body.memberRole
      : "member";
    if (!email) return res.status(400).json({ error: "Member email is required." });

    const target = await dbGet<UserRow>("SELECT * FROM users WHERE lower(email)=?", [email]);
    if (!target) {
      return res.status(404).json({
        error: "No ConferenceGate account exists for this email yet. Ask the person to create an account first.",
      });
    }
    if (target.role !== context.workspace.account_role) {
      return res.status(409).json({
        error: `This workspace accepts ${context.workspace.account_role} accounts only.`,
      });
    }
    if (target.id === context.workspace.owner_id) {
      return res.status(409).json({ error: "The workspace owner is already a member." });
    }

    const activeCount = await dbGet<{ count: number }>(
      "SELECT COUNT(*) as count FROM account_workspace_members WHERE workspace_id=? AND status='active'",
      [context.workspace.id]
    );
    if (Number(activeCount?.count || 0) >= context.workspace.seat_limit) {
      return res.status(409).json({ error: "Workspace seat limit reached." });
    }

    const existing = await dbGet<AccountWorkspaceMemberRow>(
      "SELECT * FROM account_workspace_members WHERE workspace_id=? AND user_id=?",
      [context.workspace.id, target.id]
    );
    if (existing) {
      await dbRun(
        "UPDATE account_workspace_members SET member_role=?,status='active',updated_at=datetime('now') WHERE id=?",
        [memberRole, existing.id]
      );
    } else {
      await dbRun(
        "INSERT INTO account_workspace_members(id,workspace_id,user_id,member_role,status) VALUES(?,?,?,?, 'active')",
        [`wsm_${crypto.randomUUID()}`, context.workspace.id, target.id, memberRole]
      );
    }
    await audit(context.workspace.id, req.userId!, "member_added", target.id, { memberRole });
    const updatedContext = await ensurePaidWorkspace(req.userId!);
    res.status(201).json({ workspace: await workspaceDTO(updatedContext) });
  })
);

workspacesRouter.patch(
  "/members/:userId",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    let context;
    try {
      context = await ensurePaidWorkspace(req.userId!);
    } catch (error: any) {
      return res.status(error?.status || 500).json({ error: error?.message || "Could not load workspace." });
    }
    if (!["owner", "admin"].includes(context.membership.member_role)) {
      return res.status(403).json({ error: "Workspace admin permission required." });
    }
    if (req.params.userId === context.workspace.owner_id) {
      return res.status(409).json({ error: "The owner role cannot be changed." });
    }
    const memberRole = ["admin", "member", "viewer"].includes(req.body?.memberRole)
      ? req.body.memberRole
      : null;
    if (!memberRole) return res.status(400).json({ error: "Invalid memberRole." });

    const member = await dbGet<AccountWorkspaceMemberRow>(
      "SELECT * FROM account_workspace_members WHERE workspace_id=? AND user_id=? AND status='active'",
      [context.workspace.id, req.params.userId]
    );
    if (!member) return res.status(404).json({ error: "Workspace member not found." });

    await dbRun(
      "UPDATE account_workspace_members SET member_role=?,updated_at=datetime('now') WHERE id=?",
      [memberRole, member.id]
    );
    await audit(context.workspace.id, req.userId!, "member_role_changed", req.params.userId, { memberRole });
    const updatedContext = await ensurePaidWorkspace(req.userId!);
    res.json({ workspace: await workspaceDTO(updatedContext) });
  })
);

workspacesRouter.delete(
  "/members/:userId",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    let context;
    try {
      context = await ensurePaidWorkspace(req.userId!);
    } catch (error: any) {
      return res.status(error?.status || 500).json({ error: error?.message || "Could not load workspace." });
    }
    if (!["owner", "admin"].includes(context.membership.member_role)) {
      return res.status(403).json({ error: "Workspace admin permission required." });
    }
    if (req.params.userId === context.workspace.owner_id) {
      return res.status(409).json({ error: "The workspace owner cannot be removed." });
    }
    const member = await dbGet<AccountWorkspaceMemberRow>(
      "SELECT * FROM account_workspace_members WHERE workspace_id=? AND user_id=? AND status='active'",
      [context.workspace.id, req.params.userId]
    );
    if (!member) return res.status(404).json({ error: "Workspace member not found." });

    await dbRun(
      "UPDATE account_workspace_members SET status='removed',updated_at=datetime('now') WHERE id=?",
      [member.id]
    );
    await audit(context.workspace.id, req.userId!, "member_removed", req.params.userId);
    const updatedContext = await ensurePaidWorkspace(req.userId!);
    res.json({ workspace: await workspaceDTO(updatedContext) });
  })
);
