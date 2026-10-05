async function parseResponse(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `ConferenceGate request failed (HTTP ${res.status})`);
  return data;
}

export interface ProfessionalTrustSummary {
  professionalId: string;
  reviewerEligible: boolean;
  eligibilityReason: string;
  studentProfile: boolean;
  qualificationPath: 'research' | 'experience' | 'none';
  evidence: {
    linkedinVerified: boolean;
    publicationCount: number;
    experienceYears: number;
    certificationCount: number;
    patentCount: number;
    verifiedReviews: number;
    completedRoles: number;
    organizerEvaluations: number;
    evaluationAverage: number;
  };
  conferenceGateIndex: number;
  credentialLevel: 'distinguished' | 'trusted' | 'verified' | 'eligible' | 'developing';
  recentEvaluations: Array<{
    conferenceTitle: string;
    overallScore: number;
    ratings: Record<string, number>;
    comment: string;
    createdAt: string;
  }>;
}

export interface ConferenceRecruitmentDraft {
  id: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  city: string;
  country: string;
  topics: string[];
  officialUrl: string;
  status: 'recruiting' | 'ready' | 'converted' | 'archived';
  finalConferenceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubmissionDocument {
  id: string;
  submissionId: string;
  uploaderId: string;
  kind: 'author_original' | 'reviewer_return' | 'organizer_to_author';
  fileName: string;
  mimeType: string;
  byteSize: number;
  createdAt: string;
  dataBase64?: string;
}

export async function fetchMyProfessionalTrust(): Promise<ProfessionalTrustSummary> {
  const res = await fetch('/api/professional-trust/me', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.trust;
}

export async function fetchProfessionalTrust(professionalId: string): Promise<ProfessionalTrustSummary> {
  const res = await fetch(`/api/professional-trust/professionals/${encodeURIComponent(professionalId)}`, { credentials: 'include' });
  const data = await parseResponse(res);
  return data.trust;
}

export async function evaluateProfessional(professionalId: string, payload: {
  conferenceId: string;
  conferenceTitle: string;
  invitationId?: string;
  ratings: { expertise: number; reliability: number; communication: number; contribution: number };
  comment?: string;
}): Promise<ProfessionalTrustSummary> {
  const res = await fetch(`/api/professional-trust/professionals/${encodeURIComponent(professionalId)}/evaluations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload),
  });
  const data = await parseResponse(res);
  return data.trust;
}

export async function evaluateConference(conferenceId: string, payload: {
  conferenceTitle: string;
  role: string;
  ratings: { scientificQuality: number; organization: number; networking: number; professionalValue: number };
  comment?: string;
}): Promise<{ overallScore: number }> {
  const res = await fetch(`/api/professional-trust/conferences/${encodeURIComponent(conferenceId)}/evaluations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload),
  });
  return parseResponse(res);
}

export async function fetchConferenceProfessionalEvaluation(conferenceId: string): Promise<{ responseCount: number; averageScore: number; evaluations: any[] }> {
  const res = await fetch(`/api/professional-trust/conferences/${encodeURIComponent(conferenceId)}/evaluations`, { credentials: 'include' });
  return parseResponse(res);
}

export async function fetchRecruitmentDrafts(): Promise<ConferenceRecruitmentDraft[]> {
  const res = await fetch('/api/professional-trust/recruitment-drafts', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.drafts;
}

export async function createRecruitmentDraft(payload: {
  title: string; description?: string; startDate?: string; endDate?: string; city?: string; country?: string; topics?: string[]; officialUrl?: string;
}): Promise<ConferenceRecruitmentDraft> {
  const res = await fetch('/api/professional-trust/recruitment-drafts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload),
  });
  const data = await parseResponse(res);
  return data.draft;
}

export async function updateRecruitmentDraft(id: string, payload: Partial<ConferenceRecruitmentDraft>): Promise<ConferenceRecruitmentDraft> {
  const res = await fetch(`/api/professional-trust/recruitment-drafts/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload),
  });
  const data = await parseResponse(res);
  return data.draft;
}

export async function fetchSubmissionDocuments(submissionId: string): Promise<SubmissionDocument[]> {
  const res = await fetch(`/api/professional-trust/submissions/${encodeURIComponent(submissionId)}/documents`, { credentials: 'include' });
  const data = await parseResponse(res);
  return data.documents;
}

export async function uploadSubmissionDocument(submissionId: string, kind: SubmissionDocument['kind'], file: File): Promise<SubmissionDocument> {
  const dataBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.onload = () => resolve(String(reader.result || '').split(',').pop() || '');
    reader.readAsDataURL(file);
  });
  const res = await fetch(`/api/professional-trust/submissions/${encodeURIComponent(submissionId)}/documents`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({ kind, fileName: file.name, mimeType: file.type || 'application/octet-stream', dataBase64 }),
  });
  const data = await parseResponse(res);
  return data.document;
}

export async function downloadSubmissionDocument(submissionId: string, documentId: string): Promise<void> {
  const res = await fetch(`/api/professional-trust/submissions/${encodeURIComponent(submissionId)}/documents/${encodeURIComponent(documentId)}`, { credentials: 'include' });
  const data = await parseResponse(res);
  const doc = data.document as SubmissionDocument & { dataBase64: string };
  const binary = atob(doc.dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: doc.mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = doc.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
