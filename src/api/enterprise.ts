export type EnterpriseRole = 'organizer' | 'sponsor';
export type EnterpriseScope = 'portfolio:read' | 'conferences:read' | 'sponsorship:read';

export interface EnterpriseSettings {
  accountId: string;
  accountRole: EnterpriseRole;
  brandName: string | null;
  logoUrl: string | null;
  primaryColor: string;
  supportEmail: string | null;
  customDomain: string | null;
  sso: {
    mode: 'off' | 'oidc';
    issuer: string | null;
    clientId: string | null;
    emailDomain: string | null;
    loginEnabled: boolean;
    status: string;
  };
  updatedAt: string | null;
}

export interface EnterpriseApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  scopes: EnterpriseScope[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface EnterpriseOverview {
  role: EnterpriseRole;
  workspaceRole: 'owner' | 'admin' | 'member' | 'viewer';
  canAdmin: boolean;
  settings: EnterpriseSettings;
  portfolio: any;
  apiKeys: EnterpriseApiKeySummary[];
}

async function parse(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Enterprise request failed (HTTP ${res.status}).`);
  return body;
}

function query(role: EnterpriseRole) {
  return `?role=${encodeURIComponent(role)}`;
}

export async function fetchEnterpriseOverview(role: EnterpriseRole): Promise<EnterpriseOverview> {
  const res = await fetch(`/api/enterprise/overview${query(role)}`, { credentials: 'include' });
  const body = await parse(res);
  return body.enterprise;
}

export async function updateEnterpriseSettings(
  role: EnterpriseRole,
  payload: Partial<{
    brandName: string | null;
    logoUrl: string | null;
    primaryColor: string | null;
    supportEmail: string | null;
    customDomain: string | null;
    sso: {
      mode?: 'off' | 'oidc';
      issuer?: string | null;
      clientId?: string | null;
      emailDomain?: string | null;
    };
  }>
): Promise<EnterpriseSettings> {
  const res = await fetch(`/api/enterprise/settings${query(role)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const body = await parse(res);
  return body.settings;
}

export async function createEnterpriseApiKey(
  role: EnterpriseRole,
  name: string,
  scopes: EnterpriseScope[]
): Promise<{ id: string; name: string; key: string; prefix: string; scopes: EnterpriseScope[]; note: string }> {
  const res = await fetch(`/api/enterprise/api-keys${query(role)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name, scopes }),
  });
  const body = await parse(res);
  return body.apiKey;
}

export async function revokeEnterpriseApiKey(role: EnterpriseRole, id: string): Promise<void> {
  const res = await fetch(`/api/enterprise/api-keys/${encodeURIComponent(id)}${query(role)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  await parse(res);
}
