export type ProfessionalEvidenceConfidence = 'verified' | 'strong' | 'possible' | 'member_claimed';

export interface ProfessionalEvidenceItem {
  id: string;
  kind: 'publication' | 'conference_paper' | 'conference_role' | 'conference_attendance' | 'position' | 'patent' | 'public_bio';
  title: string;
  organization: string | null;
  conferenceTitle: string | null;
  role: string | null;
  year: number | null;
  sourceUrl: string | null;
  sourceType: string;
  confidence: ProfessionalEvidenceConfidence;
  confidenceScore: number;
  evidenceReason: string;
  updatedAt: string;
}

export interface ProfessionalEvidenceSnapshot {
  status: 'not_started' | 'queued' | 'running' | 'completed' | 'failed' | string;
  lastRun: null | {
    id: string;
    trigger: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    error: string | null;
    counts: Record<string, number>;
  };
  summary: {
    total: number;
    verified: number;
    strong: number;
    possible: number;
    memberClaimed: number;
    publications: number;
    conferenceRoles: number;
    conferenceAttendance: number;
    positions: number;
    patents: number;
    publicBios: number;
  };
  items: ProfessionalEvidenceItem[];
  policy: {
    publicSourcesOnly: boolean;
    privateLinkedInDataAccessed: boolean;
    oauthAccessTokenStored: boolean;
    possibleMatchesAffectTrustIndex: boolean;
  };
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

export async function fetchProfessionalEvidence(): Promise<ProfessionalEvidenceSnapshot> {
  const response = await fetch('/api/professional-evidence/me', { credentials: 'include' });
  const body = await readJson(response);
  if (!response.ok) throw new Error(body.error || 'Could not load Professional Deep Research.');
  return body;
}

export async function refreshProfessionalEvidence(): Promise<void> {
  const response = await fetch('/api/professional-evidence/refresh', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const body = await readJson(response);
  if (!response.ok) throw new Error(body.error || 'Could not start Professional Deep Research.');
}
