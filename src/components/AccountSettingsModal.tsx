import React, { useEffect, useState } from 'react';
import { KeyRound, Loader2, Mail, ShieldCheck, X } from 'lucide-react';
import {
  fetchAccountSettings,
  updateAccountEmail,
  updateAccountPassword,
  type AccountSettingsInfo,
} from '../api/auth';

interface AccountSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentEmail: string;
  ownerPreview?: boolean;
}

export const AccountSettingsModal: React.FC<AccountSettingsModalProps> = ({
  isOpen,
  onClose,
  currentEmail,
  ownerPreview = false,
}) => {
  const [info, setInfo] = useState<AccountSettingsInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEmailMessage(null);
    setPasswordMessage(null);
    fetchAccountSettings()
      .then((result) => {
        if (!cancelled) setInfo(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load account settings.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [isOpen]);

  if (!isOpen) return null;

  const hasPassword = Boolean(info?.hasPassword);
  const googleConnected = Boolean(info?.googleConnected);
  const effectiveEmail = info?.email || currentEmail;

  const handleEmailSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setEmailMessage(null);
    if (ownerPreview) {
      setError('Owner account email changes are disabled here to protect owner access.');
      return;
    }
    if (!newEmail.trim() || newEmail.trim().toLowerCase() !== confirmEmail.trim().toLowerCase()) {
      setError('New email and confirmation must match.');
      return;
    }
    setSavingEmail(true);
    try {
      const result = await updateAccountEmail({
        newEmail: newEmail.trim(),
        currentPassword: hasPassword ? emailPassword : undefined,
      });
      setInfo((prev) => prev ? { ...prev, email: result.email } : prev);
      setNewEmail('');
      setConfirmEmail('');
      setEmailPassword('');
      setEmailMessage('Email updated. Email verification can be enabled once outbound mail is fully configured.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update email.');
    } finally {
      setSavingEmail(false);
    }
  };

  const handlePasswordSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setPasswordMessage(null);
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation must match.');
      return;
    }
    setSavingPassword(true);
    try {
      await updateAccountPassword({
        currentPassword: hasPassword ? currentPassword : undefined,
        newPassword,
      });
      setInfo((prev) => prev ? { ...prev, hasPassword: true } : prev);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage(hasPassword ? 'Password changed successfully.' : 'Password set successfully. You can now also sign in with email and password.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update password.');
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-label="Account Settings">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <div>
            <h2 className="text-xl font-extrabold text-slate-900">Account Settings</h2>
            <p className="mt-1 text-xs text-slate-500">Manage your login email, password, and connected sign-in method.</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close account settings">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 p-6">
          {loading && (
            <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading account settings…
            </div>
          )}
          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div>}

          <section className="rounded-2xl border border-slate-200 p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-xl bg-blue-50 p-2.5"><Mail className="h-5 w-5 text-blue-700" /></div>
              <div>
                <h3 className="font-extrabold text-slate-900">Change Email</h3>
                <p className="text-xs text-slate-500">Current email: <span className="font-semibold text-slate-700">{effectiveEmail}</span></p>
              </div>
            </div>
            {ownerPreview ? (
              <div className="rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-800">
                Owner account email changes are protected to prevent accidental loss of owner access. We can enable a verified owner-email migration workflow later.
              </div>
            ) : (
              <form className="space-y-3" onSubmit={handleEmailSave}>
                <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="New email" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500" required />
                <input type="email" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} placeholder="Confirm new email" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500" required />
                {hasPassword && <input type="password" value={emailPassword} onChange={(e) => setEmailPassword(e.target.value)} placeholder="Current password" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500" required />}
                {!hasPassword && googleConnected && <p className="text-xs text-slate-500">Your active Google-authenticated session authorizes this change. Email verification will be added when system email is enabled.</p>}
                <button disabled={savingEmail} className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-60">
                  {savingEmail ? 'Saving…' : 'Save Email'}
                </button>
                {emailMessage && <p className="text-xs font-semibold text-emerald-700">{emailMessage}</p>}
              </form>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-xl bg-indigo-50 p-2.5"><KeyRound className="h-5 w-5 text-indigo-700" /></div>
              <div>
                <h3 className="font-extrabold text-slate-900">{hasPassword ? 'Change Password' : 'Set Password'}</h3>
                <p className="text-xs text-slate-500">{hasPassword ? 'Update your direct ConferenceGate login password.' : 'Add a password so you can sign in directly as well as with Google.'}</p>
              </div>
            </div>
            <form className="space-y-3" onSubmit={handlePasswordSave}>
              {hasPassword && <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Current password" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500" required />}
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password" minLength={8} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500" required />
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm new password" minLength={8} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500" required />
              <button disabled={savingPassword} className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-60">
                {savingPassword ? 'Saving…' : hasPassword ? 'Change Password' : 'Set Password'}
              </button>
              {passwordMessage && <p className="text-xs font-semibold text-emerald-700">{passwordMessage}</p>}
            </form>
          </section>

          <section className="rounded-2xl border border-slate-200 p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-emerald-50 p-2.5"><ShieldCheck className="h-5 w-5 text-emerald-700" /></div>
              <div>
                <h3 className="font-extrabold text-slate-900">Login Method</h3>
                <p className="mt-1 text-sm text-slate-700">Google: <span className={`font-bold ${googleConnected ? 'text-emerald-700' : 'text-slate-500'}`}>{googleConnected ? 'Connected' : 'Not connected'}</span></p>
                <p className="mt-1 text-sm text-slate-700">Email & password: <span className={`font-bold ${hasPassword ? 'text-emerald-700' : 'text-slate-500'}`}>{hasPassword ? 'Enabled' : 'Not set'}</span></p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
