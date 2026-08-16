export type AuthRole = 'professional' | 'organizer' | 'sponsor';

export interface AuthUser {
  id: string;
  email: string;
  role: AuthRole;
  name: string;
  organization: string | null;
  title: string | null;
  avatar: string | null;
}

export interface SignupPayload {
  role: AuthRole;
  name: string;
  email: string;
  password: string;
  organization?: string;
  title?: string;
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

export async function fetchCurrentUser(): Promise<AuthUser | null> {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  if (res.status === 401) return null;
  const data = await parseResponse(res);
  return data.user;
}
