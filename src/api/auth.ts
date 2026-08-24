export type AuthRole = 'professional' | 'organizer' | 'sponsor';

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
  reviewerAvailable: boolean;
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

async function parseResponse(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Something went wrong. Please try again.');
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
  return data.user;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });
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

/** Reads back the verified LinkedIn identity stashed server-side after the OAuth redirect, for a
 * brand-new account that still needs to pick a role. Returns null if there's no pending sign-in
 * (nothing in progress, or it expired). */
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
  return data.user;
}
