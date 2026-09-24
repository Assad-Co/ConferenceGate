export type AuthRole = 'professional' | 'organizer' | 'sponsor';

export interface KeynoteSpeakerMatch {
  conferenceTitle: string;
  conferenceUrl: string;
  speakerName: string;
  role: string;
  organization: string | null;
  photoUrl: string | null;
  sourceUrl: string;
  matchMethod: 'email' | 'exact_name';
  verified: boolean;
}

export interface AuthUser {
  id: string;
  email: string;
  role: AuthRole;
  name: string;
  organization: string | null;
  title: string | null;
  department: string | null;
  city: string | null;
  country: string | null;
  bio: string | null;
  linkedinUrl: string | null;
  avatar: string | null;
  identityVerified: boolean;
  identityVerificationMethod: 'LinkedIn' | 'Google' | null;
  ownerPreview: boolean;
  subscriptionStatus: 'free' | 'required' | 'trialing' | 'active' | 'past_due' | 'canceled' | string;
  subscriptionPlan: string | null;
  subscriptionProvider: string | null;
  subscriptionPeriodEnd: string | null;
  hasPaidAccess: boolean;
  workspaceId: string | null;
  workspaceRole: 'owner' | 'admin' | 'member' | 'viewer' | null;
  workspaceOwnerId: string | null;
  reviewerAvailable: boolean;
  professionalExpertise: string[];
  technicalSpecialization: string[];
  researchInterests: string[];
  preferredRegions: string[];
  committeeAvailable: boolean;
  sessionChairAvailable: boolean;
  speakerAvailable: boolean;
  reviewerMaxLoad: number;
  keynoteSpeakerMatches: KeynoteSpeakerMatch[];
}

export interface ProfileUpdatePayload {
  name?: string;
  title?: string;
  organization?: string;
  department?: string;
  city?: string;
  country?: string;
  bio?: string;
  linkedinUrl?: string;
}

export interface SignupPayload {
  role: AuthRole;
  name: string;
  email: string;
  password: string;
  organization?: string;
  title?: string;
  linkedinUrl?: string;
}

interface ExplicitAcquisition {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
  referralCode?: string;
  landingPath?: string;
}

const ACQUISITION_SESSION_KEY = 'cg_explicit_acquisition';

function readExplicitAcquisition(): ExplicitAcquisition | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const current: ExplicitAcquisition = {
      source: params.get('utm_source') || undefined,
      medium: params.get('utm_medium') || undefined,
      campaign: params.get('utm_campaign') || undefined,
      content: params.get('utm_content') || undefined,
      term: params.get('utm_term') || undefined,
      referralCode: params.get('ref') || params.get('referral') || undefined,
      landingPath: window.location.pathname || '/',
    };
    const hasExplicit = Boolean(current.source || current.campaign || current.referralCode);
    if (hasExplicit) {
      window.sessionStorage.setItem(ACQUISITION_SESSION_KEY, JSON.stringify(current));
      return current;
    }
    const stored = window.sessionStorage.getItem(ACQUISITION_SESSION_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function recordPaidAcquisition(user: AuthUser): Promise<void> {
  if (user.role !== 'organizer' && user.role !== 'sponsor') return;
  const acquisition = readExplicitAcquisition();
  if (!acquisition) return;
  try {
    await fetch('/api/workspaces/acquisition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(acquisition),
    });
  } catch {
    // Attribution is deliberately best-effort and must never block account creation.
  }
}

async function parseResponse(res: Response) {
  const raw = await res.text().catch(() => '');
  let data: any = {};
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = {};
    }
  }
  if (!res.ok) {
    if (data?.error) throw new Error(String(data.error));
    if (res.status >= 500) {
      throw new Error(`Conference Gate service is temporarily unavailable (HTTP ${res.status}). Please try again shortly.`);
    }
    if (res.status === 404) {
      throw new Error('This Conference Gate API route is not available on the current deployment.');
    }
    throw new Error(`Conference Gate request failed (HTTP ${res.status}). Please try again.`);
  }
  return data;
}

export async function signup(payload: SignupPayload): Promise<AuthUser> {
  const res = await fetch('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await parseResponse(res);
  await recordPaidAcquisition(data.user);
  return data.user;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  let res: Response;
  try {
    res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new Error('Cannot reach the Conference Gate login service. Check the deployment and try again.');
  }
  const data = await parseResponse(res);
  return data.user;
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
}

export async function updateAvatar(avatar: string | null): Promise<AuthUser> {
  const res = await fetch('/api/auth/avatar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ avatar }),
  });
  const data = await parseResponse(res);
  return data.user;
}

export interface GoogleAuthNeedsRole {
  needsRole: true;
  google: { name: string; email: string; avatar: string | null };
}

export async function googleAuth(credential: string, role?: AuthRole): Promise<AuthUser | GoogleAuthNeedsRole> {
  const res = await fetch('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ credential, role }),
  });
  const data = await parseResponse(res);
  if (data.needsRole) {
    return { needsRole: true, google: data.google };
  }
  if (role) await recordPaidAcquisition(data.user);
  return data.user;
}

export async function updateProfile(payload: ProfileUpdatePayload): Promise<AuthUser> {
  const res = await fetch('/api/auth/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await parseResponse(res);
  return data.user;
}

export async function updateReviewerAvailability(available: boolean): Promise<AuthUser> {
  const res = await fetch('/api/auth/me/reviewer-availability', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ available }),
  });
  const data = await parseResponse(res);
  return data.user;
}

export interface ProfessionalPreferencesPayload {
  professionalExpertise: string[];
  technicalSpecialization: string[];
  researchInterests: string[];
  preferredRegions: string[];
  committeeAvailable: boolean;
  sessionChairAvailable: boolean;
  speakerAvailable: boolean;
  reviewerMaxLoad: number;
}

export async function updateProfessionalPreferences(payload: ProfessionalPreferencesPayload): Promise<AuthUser> {
  const res = await fetch('/api/auth/me/professional-preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await parseResponse(res);
  return data.user;
}

export async function fetchCurrentUser(): Promise<AuthUser | null> {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  if (res.status === 401) return null;
  const data = await parseResponse(res);
  return data.user;
}

export interface PendingLinkedInProfile {
  name: string;
  email: string | null;
  avatar: string | null;
}

export async function fetchPendingLinkedInProfile(): Promise<PendingLinkedInProfile | null> {
  const res = await fetch('/api/auth/linkedin/pending', { credentials: 'include' });
  if (res.status === 404) return null;
  return parseResponse(res);
}

export async function completeLinkedInSignup(role: AuthRole): Promise<AuthUser> {
  const res = await fetch('/api/auth/linkedin/complete-signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ role }),
  });
  const data = await parseResponse(res);
  await recordPaidAcquisition(data.user);
  return data.user;
}
