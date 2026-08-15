import React, { useState } from 'react';
import { UserCheck, Building2, Briefcase, Loader2, AlertCircle } from 'lucide-react';
import { Logo } from '../Logo';
import { signup, login, AuthRole, AuthUser, SignupPayload } from '../../api/auth';

interface AuthScreenProps {
  onAuthenticated: (user: AuthUser) => void;
}

const ROLE_OPTIONS: Array<{
  value: AuthRole;
  label: string;
  icon: React.ElementType;
  orgLabel: string;
  orgPlaceholder: string;
  titleLabel: string;
  titlePlaceholder: string;
}> = [
  {
    value: 'professional',
    label: 'Professional',
    icon: UserCheck,
    orgLabel: 'Institution / University',
    orgPlaceholder: 'e.g. University of Oxford',
    titleLabel: 'Title / Position',
    titlePlaceholder: 'e.g. Senior Research Fellow',
  },
  {
    value: 'organizer',
    label: 'Conference Organizer',
    icon: Building2,
    orgLabel: 'Organization Name',
    orgPlaceholder: 'e.g. Global Energy Summit Board',
    titleLabel: 'Your Role',
    titlePlaceholder: 'e.g. Program Director',
  },
  {
    value: 'sponsor',
    label: 'Corporate Sponsor',
    icon: Briefcase,
    orgLabel: 'Company Name',
    orgPlaceholder: 'e.g. Halliburton Energy Solutions',
    titleLabel: 'Your Role',
    titlePlaceholder: 'e.g. Partnerships Manager',
  },
];

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [selectedRole, setSelectedRole] = useState<AuthRole>('professional');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [organization, setOrganization] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const activeRoleConfig = ROLE_OPTIONS.find((r) => r.value === selectedRole)!;

  const resetFormFields = () => {
    setName('');
    setPassword('');
    setConfirmPassword('');
    setOrganization('');
    setTitle('');
    setError(null);
  };

  const switchMode = (next: 'signin' | 'signup') => {
    setMode(next);
    resetFormFields();
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      const user = await login(email.trim(), password);
      onAuthenticated(user);
    } catch (err: any) {
      setError(err.message || 'Unable to sign in.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !email.trim() || !password) {
      setError('Please fill in your name, email, and password.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const payload: SignupPayload = {
        role: selectedRole,
        name: name.trim(),
        email: email.trim(),
        password,
        organization: organization.trim() || undefined,
        title: title.trim() || undefined,
      };
      const user = await signup(payload);
      onAuthenticated(user);
    } catch (err: any) {
      setError(err.message || 'Unable to create your account.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 via-white to-slate-50 flex flex-col items-center justify-center px-4 py-10">
      <Logo className="h-10 w-auto mb-6" />

      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
        <div className="flex border-b border-slate-100">
          <button
            onClick={() => switchMode('signin')}
            className={`flex-1 py-3.5 text-sm font-bold cursor-pointer transition-colors ${
              mode === 'signin' ? 'text-blue-900 border-b-2 border-blue-900' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            Sign In
          </button>
          <button
            onClick={() => switchMode('signup')}
            className={`flex-1 py-3.5 text-sm font-bold cursor-pointer transition-colors ${
              mode === 'signup' ? 'text-blue-900 border-b-2 border-blue-900' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            Join Now
          </button>
        </div>

        <div className="p-6 sm:p-8">
          {mode === 'signin' ? (
            <>
              <h1 className="text-xl font-extrabold text-slate-900 mb-1">Welcome back</h1>
              <p className="text-sm text-slate-500 mb-6">Sign in to your Conference Gate account.</p>

              <form onSubmit={handleSignIn} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                  />
                </div>

                {error && (
                  <div className="flex items-start gap-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-900 hover:bg-blue-950 disabled:opacity-60 text-white text-sm font-bold rounded-full transition-colors cursor-pointer"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Sign In
                </button>
              </form>

              <p className="text-center text-xs text-slate-500 mt-5">
                New to Conference Gate?{' '}
                <button onClick={() => switchMode('signup')} className="text-blue-700 font-bold hover:underline cursor-pointer">
                  Create an account
                </button>
              </p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-extrabold text-slate-900 mb-1">Join Conference Gate</h1>
              <p className="text-sm text-slate-500 mb-5">Choose the account type that fits you best.</p>

              <div className="grid grid-cols-3 gap-2 mb-5">
                {ROLE_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const isActive = selectedRole === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setSelectedRole(opt.value)}
                      className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border text-center transition-colors cursor-pointer ${
                        isActive
                          ? 'border-blue-600 bg-blue-50 text-blue-900'
                          : 'border-slate-200 text-slate-500 hover:border-slate-300'
                      }`}
                    >
                      <Icon className={`w-5 h-5 ${isActive ? 'text-blue-700' : 'text-slate-400'}`} />
                      <span className="text-[11px] font-bold leading-tight">{opt.label}</span>
                    </button>
                  );
                })}
              </div>

              <form onSubmit={handleSignUp} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">Full Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jane Doe"
                    autoComplete="name"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">{activeRoleConfig.orgLabel}</label>
                    <input
                      type="text"
                      value={organization}
                      onChange={(e) => setOrganization(e.target.value)}
                      placeholder={activeRoleConfig.orgPlaceholder}
                      className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">{activeRoleConfig.titleLabel}</label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder={activeRoleConfig.titlePlaceholder}
                      className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">Password</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      autoComplete="new-password"
                      className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">Confirm Password</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter password"
                      autoComplete="new-password"
                      className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                    />
                  </div>
                </div>

                {error && (
                  <div className="flex items-start gap-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-900 hover:bg-blue-950 disabled:opacity-60 text-white text-sm font-bold rounded-full transition-colors cursor-pointer"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Create Account
                </button>
              </form>

              <p className="text-center text-xs text-slate-500 mt-5">
                Already have an account?{' '}
                <button onClick={() => switchMode('signin')} className="text-blue-700 font-bold hover:underline cursor-pointer">
                  Sign in
                </button>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AuthScreen;
