export interface LinkedInProfileEnrichment {
  linkedinUrl: string;
  linkedinId: string | null;
  publicIdentifier: string | null;
  fullName: string | null;
  headline: string | null;
  about: string | null;
  locationText: string | null;
  city: string | null;
  country: string | null;
  photoUrl: string | null;
  verified: boolean;
  currentTitle: string | null;
  currentOrganization: string | null;
  experience: any[];
  education: any[];
  publications: any[];
  patents: any[];
  certifications: any[];
  projects: any[];
  skills: any[];
  honorsAndAwards: any[];
  languages: any[];
  sourceActor: string;
  consentedAt: string;
  fetchedAt: string;
}

export interface LinkedInProfileImportResult {
  profile: LinkedInProfileEnrichment;
  imported: boolean;
  counts: {
    experience: number;
    education: number;
    publications: number;
    patents: number;
    certifications: number;
  };
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export async function fetchLinkedInProfileEnrichment(): Promise<{
  profile: LinkedInProfileEnrichment | null;
  apifyConfigured: boolean;
}> {
  const response = await fetch('/api/linkedin-profile/me', {
    credentials: 'include',
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(body.error || 'Could not load LinkedIn profile data.');
  }
  return body;
}

export async function refreshLinkedInProfileEnrichment(
  linkedinUrl: string,
): Promise<LinkedInProfileImportResult> {
  const response = await fetch('/api/linkedin-profile/refresh', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      consent: true,
      linkedinUrl,
    }),
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(body.error || 'Could not import your LinkedIn profile.');
  }
  return body;
}

export async function removeLinkedInProfileEnrichment(): Promise<void> {
  const response = await fetch('/api/linkedin-profile/me', {
    method: 'DELETE',
    credentials: 'include',
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(body.error || 'Could not remove imported LinkedIn profile data.');
  }
}


export interface ProfessionalRecoveryStatus {
  ownerRecovery: boolean;
  avatarRepaired?: boolean;
  legacyLinkedInActivityRestored?: boolean;
  current: {
    profilePresent: boolean;
    avatarPresent: boolean;
    linkedinUrl: string | null;
    counts: {
      experience: number;
      education: number;
      publications: number;
      patents: number;
    };
  };
  localLegacy: {
    candidateCount: number;
    recoverable: boolean;
    candidate: null | {
      userId: string;
      fullName: string | null;
      linkedinUrl: string | null;
      fetchedAt: string | null;
      originalCredentialsRecoverable: boolean;
      counts: {
        experience: number;
        education: number;
        publications: number;
        patents: number;
      };
    };
  };
  tursoRecoveryConfigured: boolean;
  linkedInRefreshConfigured: boolean;
}

export async function fetchProfessionalRecoveryStatus(): Promise<ProfessionalRecoveryStatus | null> {
  const response = await fetch('/api/linkedin-profile/recovery-status', {
    credentials: 'include',
  });
  if (response.status === 403) return null;
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(body.error || 'Could not check Professional profile recovery status.');
  }
  return body;
}

export async function recoverLocalProfessionalProfile(
  restoreCredentials = false,
): Promise<LinkedInProfileImportResult['profile']> {
  const response = await fetch('/api/linkedin-profile/recover-local', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: true, restoreCredentials }),
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(body.error || 'Could not restore the local legacy Professional profile.');
  }
  return body.profile;
}
