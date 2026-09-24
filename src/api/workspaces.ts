async function parseResponse(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `Workspace request failed (HTTP ${res.status})`) as Error & {
      code?: string;
      attempts?: Array<{ route: string; ok: boolean; detail: string }>;
      status?: number;
    };
    error.code = data.code ? String(data.code) : undefined;
    error.attempts = Array.isArray(data.attempts) ? data.attempts : undefined;
    error.status = res.status;
    throw error;
  }
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

export interface ActivationStep {
  key: string;
  label: string;
  description: string;
  complete: boolean;
  count: number;
}

export interface WorkspaceActivation {
  role: 'organizer' | 'sponsor';
  accountId: string;
  workspaceId: string;
  workspaceRole: WorkspaceMemberRole;
  completedCount: number;
  totalCount: number;
  progressPct: number;
  steps: ActivationStep[];
  optional: ActivationStep;
}

export async function fetchMyWorkspace(): Promise<AccountWorkspace> {
  const res = await fetch('/api/workspaces/mine', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.workspace;
}

export async function fetchWorkspaceActivation(): Promise<WorkspaceActivation> {
  const res = await fetch('/api/workspaces/activation', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.activation;
}

export async function recordCheckoutStart(provider?: string | null): Promise<void> {
  const res = await fetch('/api/workspaces/checkout-start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ provider: provider || 'hosted' }),
  });
  await parseResponse(res);
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


export interface OrganizerConferenceImportDraft {
  sourceUrl: string;
  title: string | null;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  location: string | null;
  topics: string[];
  bannerUrl: string | null;
  format: 'Physical' | 'Online' | 'Hybrid' | null;
  priceRange: string | null;
  organizer: string | null;
  confidence: number;
  extractedFields: string[];
}

export interface OrganizerConferenceImportAttempt {
  route: 'direct_http' | 'rendered_browser' | 'readable_page' | string;
  ok: boolean;
  detail: string;
}

export interface OrganizerConferenceImportResult {
  draft: OrganizerConferenceImportDraft;
  method: string;
  attempts: OrganizerConferenceImportAttempt[];
  note: string;
}

export async function importOrganizerConferenceFromOfficialUrl(
  url: string
): Promise<OrganizerConferenceImportResult> {
  let res: Response;
  try {
    res = await fetch('/api/workspaces/organizer/import-conference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ url }),
    });
  } catch {
    throw new Error(
      'ConferenceGate could not reach the import service. Check the current deployment and try again.'
    );
  }
  return parseResponse(res);
}
