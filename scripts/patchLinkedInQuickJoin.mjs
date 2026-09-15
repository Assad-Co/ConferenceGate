import fs from 'node:fs';

const path = 'src/components/auth/AuthScreen.tsx';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  const index = source.indexOf(before);
  if (index === -1) throw new Error(`[linkedin-quick-join] anchor not found (${label})`);
  source = source.slice(0, index) + after + source.slice(index + before.length);
}

replaceOnce(
  "import { UserCheck, Building2, Briefcase, Loader2, AlertCircle, ArrowLeft } from 'lucide-react';",
  "import { UserCheck, Building2, Briefcase, Loader2, AlertCircle, ArrowLeft, Linkedin } from 'lucide-react';",
  'LinkedIn icon import',
);

replaceOnce(
  "  const [linkedinUrl, setLinkedinUrl] = useState('');\n  const [error, setError] = useState<string | null>(null);",
  "  const [linkedinUrl, setLinkedinUrl] = useState('');\n  const [linkedinQuickJoin, setLinkedinQuickJoin] = useState(false);\n  const [error, setError] = useState<string | null>(null);",
  'quick join state',
);

replaceOnce(
  "  const switchMode = (next: 'signin' | 'signup') => {\n    setMode(next);\n    resetFormFields();\n  };",
  "  const switchMode = (next: 'signin' | 'signup') => {\n    setMode(next);\n    setLinkedinQuickJoin(false);\n    resetFormFields();\n  };",
  'reset quick join on mode change',
);

replaceOnce(
  "\n  return (\n    <div className=\"min-h-screen",
  `\n  const handleLinkedInQuickSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const rawLinkedIn = linkedinUrl.trim();
    const candidate = /^https?:\\/\\//i.test(rawLinkedIn) ? rawLinkedIn : \`https://\${rawLinkedIn}\`;
    let normalizedLinkedIn = '';
    try {
      const parsed = new URL(candidate);
      const host = parsed.hostname.toLowerCase().replace(/^www\\./, '');
      if (host === 'linkedin.com' && /^\\/in\\/[^/]+/i.test(parsed.pathname)) {
        parsed.hash = '';
        normalizedLinkedIn = parsed.toString();
      }
    } catch {
      normalizedLinkedIn = '';
    }

    if (!normalizedLinkedIn) {
      setError('Please enter your public LinkedIn profile URL, for example linkedin.com/in/your-name.');
      return;
    }
    if (!name.trim() || !email.trim() || !password) {
      setError('Please enter your name, email, LinkedIn URL, and password.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    try {
      const user = await signup({
        role: 'professional',
        name: name.trim(),
        email: email.trim(),
        password,
        linkedinUrl: normalizedLinkedIn,
      });

      // The account exists first, so the server-side enrichment runs under the member's own
      // authenticated session. The URL they entered is explicit consent to build their profile.
      await syncLinkedInOnboarding(normalizedLinkedIn).catch(() => null);
      onAuthenticated(user);
    } catch (err: any) {
      const message = err?.message || 'Unable to create your account.';
      setError(
        /already exists/i.test(message)
          ? 'An account with this email already exists. Sign in, then import your LinkedIn profile from your profile page.'
          : message
      );
    } finally {
      setLoading(false);
    }
  };\n\n  return (\n    <div className=\"min-h-screen`,
  'quick signup handler',
);

replaceOnce(
  `              <h1 className="text-xl font-extrabold text-slate-900 mb-1">Join Conference Gate</h1>
              <p className="text-sm text-slate-500 mb-5">Choose the account type that fits you best.</p>

              <div className="grid grid-cols-3 gap-2 mb-5">`,
  `              <h1 className="text-xl font-extrabold text-slate-900 mb-1">Join Conference Gate</h1>
              <p className="text-sm text-slate-500 mb-5">
                {linkedinQuickJoin ? 'Create your profile from LinkedIn.' : 'Choose the fastest way to join.'}
              </p>

              {linkedinQuickJoin ? (
                <>
                  <button
                    type="button"
                    onClick={() => { setLinkedinQuickJoin(false); setError(null); }}
                    className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-700 mb-4 cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Back to signup options
                  </button>

                  <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
                    <div className="flex items-center gap-2 text-blue-900 font-extrabold text-sm">
                      <Linkedin className="w-5 h-5 text-[#0A66C2]" />
                      Join with your public LinkedIn profile
                    </div>
                    <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                      Enter four things only. ConferenceGate will build the rest from your public profile and
                      conference-related public posts — experience, publications, patents, conference roles,
                      papers or abstracts, past conference claims, and calls for papers. No LinkedIn password is required.
                    </p>
                  </div>

                  <form onSubmit={handleLinkedInQuickSignUp} className="space-y-3.5">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1.5">Public LinkedIn profile URL</label>
                      <input
                        type="text"
                        value={linkedinUrl}
                        onChange={(e) => setLinkedinUrl(e.target.value)}
                        placeholder="linkedin.com/in/your-name"
                        autoComplete="url"
                        autoFocus
                        className="w-full px-3.5 py-2.5 rounded-lg border border-blue-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1.5">Full Name</label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Your full name"
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
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1.5">Create Password</label>
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="At least 8 characters"
                        autoComplete="new-password"
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
                      className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#0A66C2] hover:bg-[#084f97] disabled:opacity-60 text-white text-sm font-bold rounded-full transition-colors cursor-pointer"
                    >
                      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                      <Linkedin className="w-4 h-4" />
                      Create my ConferenceGate profile
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => { setLinkedinQuickJoin(true); setError(null); }}
                    className="w-full mb-4 flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl border-2 border-[#0A66C2] bg-blue-50 hover:bg-blue-100 text-[#0A66C2] text-sm font-extrabold transition-colors cursor-pointer"
                  >
                    <Linkedin className="w-5 h-5" />
                    Join with LinkedIn profile
                    <span className="text-[10px] font-bold bg-[#0A66C2] text-white rounded-full px-2 py-0.5">FAST</span>
                  </button>
                  <p className="text-[11px] text-center text-slate-500 -mt-2 mb-4">
                    We build your professional and conference profile automatically from your public LinkedIn URL.
                  </p>

                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-px flex-1 bg-slate-200" />
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">or fill manually</span>
                    <div className="h-px flex-1 bg-slate-200" />
                  </div>

              <div className="grid grid-cols-3 gap-2 mb-5">`,
  'quick join entry and conditional',
);

replaceOnce(
  `                  Create Account
                </button>
              </form>

              <div className="flex items-center gap-3 my-5">`,
  `                  Create Account
                </button>
              </form>
                </>
              )}

              <div className="flex items-center gap-3 my-5">`,
  'close quick join conditional',
);

fs.writeFileSync(path, source);
console.log('[linkedin-quick-join] added separate public-LinkedIn signup path');
