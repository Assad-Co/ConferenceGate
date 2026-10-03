export interface AuthCapabilities {
  googleClientId: string | null;
  linkedin: boolean;
  passwordReset: boolean;
  passwordResetTtlMinutes: number;
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
    throw new Error(data?.error || `Conference Gate request failed (HTTP ${res.status}).`);
  }
  return data;
}

export async function fetchAuthCapabilities(): Promise<AuthCapabilities> {
  const res = await fetch('/api/auth/capabilities', {
    credentials: 'include',
    cache: 'no-store',
  });
  return parseResponse(res);
}

export async function requestPasswordReset(email: string): Promise<string> {
  const res = await fetch('/api/auth/password-reset/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email }),
  });
  const data = await parseResponse(res);
  return data.message || 'If an account exists for that email, a password reset link will be sent shortly.';
}

export async function confirmPasswordReset(token: string, newPassword: string): Promise<{ email: string }> {
  const res = await fetch('/api/auth/password-reset/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ token, newPassword }),
  });
  const data = await parseResponse(res);
  return { email: String(data.email || '') };
}
