import { dbGet, UserRow } from "./db";

export type PaidAccountRole = "organizer" | "sponsor";
export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

export interface PaidAccountContext {
  actor: UserRow;
  accountOwner: UserRow;
  accountId: string;
  workspaceId: string | null;
  workspaceRole: WorkspaceRole;
  paid: boolean;
}

export async function resolvePaidAccountContext(
  userId: string,
  expectedRole?: PaidAccountRole
): Promise<PaidAccountContext | null> {
  const actor = await dbGet<UserRow>("SELECT * FROM users WHERE id=?", [userId]);
  if (!actor || !["organizer", "sponsor"].includes(actor.role)) return null;
  if (expectedRole && actor.role !== expectedRole) return null;

  const membership = await dbGet<{
    workspace_id: string;
    member_role: WorkspaceRole;
    owner_id: string;
    account_role: PaidAccountRole;
  }>(
    `SELECT m.workspace_id,m.member_role,w.owner_id,w.account_role
       FROM account_workspace_members m
       JOIN account_workspaces w ON w.id=m.workspace_id
      WHERE m.user_id=? AND m.status='active' AND w.account_role=?
      ORDER BY CASE WHEN m.member_role='owner' THEN 0 ELSE 1 END, m.created_at ASC
      LIMIT 1`,
    [userId, actor.role]
  ).catch(() => undefined);

  const accountId = membership?.owner_id || actor.id;
  const accountOwner =
    accountId === actor.id
      ? actor
      : ((await dbGet<UserRow>("SELECT * FROM users WHERE id=?", [accountId])) || actor);

  return {
    actor,
    accountOwner,
    accountId,
    workspaceId: membership?.workspace_id || null,
    workspaceRole: membership?.member_role || "owner",
    paid:
      accountOwner.subscription_status === "active" ||
      accountOwner.subscription_status === "trialing",
  };
}

export function canOperateWorkspace(role: WorkspaceRole): boolean {
  return role === "owner" || role === "admin" || role === "member";
}

export function canAdminWorkspace(role: WorkspaceRole): boolean {
  return role === "owner" || role === "admin";
}
