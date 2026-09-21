async function parseResponse(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Workspace request failed');
  return data;
}

export type WorkspaceMemberRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface WorkspaceMember {
  id: string;
  name: string;
  email: string;
  title: string;
  organization: string;
  avatar: string | null;
  accountRole: 'organizer' | 'sponsor';
  workspaceRole: WorkspaceMemberRole;
  joinedAt: string;
}

export interface WorkspaceAuditItem {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  targetUserId: string | null;
  targetName: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface AccountWorkspace {
  id: string;
  name: string;
  accountRole: 'organizer' | 'sponsor';
  ownerId: string;
  seatLimit: number;
  myRole: WorkspaceMemberRole;
  members: WorkspaceMember[];
  audit: WorkspaceAuditItem[];
}

export async function fetchMyWorkspace(): Promise<AccountWorkspace> {
  const res = await fetch('/api/workspaces/mine', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.workspace;
}

export async function renameMyWorkspace(name: string): Promise<AccountWorkspace> {
  const res = await fetch('/api/workspaces/mine', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name }),
  });
  const data = await parseResponse(res);
  return data.workspace;
}

export async function addWorkspaceMember(
  email: string,
  memberRole: Exclude<WorkspaceMemberRole, 'owner'>
): Promise<AccountWorkspace> {
  const res = await fetch('/api/workspaces/members', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, memberRole }),
  });
  const data = await parseResponse(res);
  return data.workspace;
}

export async function updateWorkspaceMemberRole(
  userId: string,
  memberRole: Exclude<WorkspaceMemberRole, 'owner'>
): Promise<AccountWorkspace> {
  const res = await fetch(`/api/workspaces/members/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ memberRole }),
  });
  const data = await parseResponse(res);
  return data.workspace;
}

export async function removeWorkspaceMember(userId: string): Promise<AccountWorkspace> {
  const res = await fetch(`/api/workspaces/members/${userId}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const data = await parseResponse(res);
  return data.workspace;
}
