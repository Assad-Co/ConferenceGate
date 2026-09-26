import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  Copy,
  KeyRound,
  Loader2,
  LockKeyhole,
  Palette,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';
import {
  createEnterpriseApiKey,
  fetchEnterpriseOverview,
  revokeEnterpriseApiKey,
  updateEnterpriseSettings,
  type EnterpriseOverview,
  type EnterpriseRole,
  type EnterpriseScope,
} from '../api/enterprise';

interface EnterpriseWorkspacePanelProps {
  role: EnterpriseRole;
}

const SCOPE_OPTIONS: Array<{ id: EnterpriseScope; label: string }> = [
  { id: 'portfolio:read', label: 'Portfolio analytics' },
  { id: 'conferences:read', label: 'Conference portfolio' },
  { id: 'sponsorship:read', label: 'Sponsorship portfolio' },
];

export const EnterpriseWorkspacePanel: React.FC<EnterpriseWorkspacePanelProps> = ({ role }) => {
  const [overview, setOverview] = useState<EnterpriseOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [apiKeyName, setApiKeyName] = useState('');
  const [apiScopes, setApiScopes] = useState<EnterpriseScope[]>(['portfolio:read']);
  const [draft, setDraft] = useState({
    brandName: '',
    logoUrl: '',
    primaryColor: '#1D4ED8',
    supportEmail: '',
    customDomain: '',
    ssoMode: 'off' as 'off' | 'oidc',
    ssoIssuer: '',
    ssoClientId: '',
    ssoEmailDomain: '',
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const value = await fetchEnterpriseOverview(role);
      setOverview(value);
      const s = value.settings;
      setDraft({
        brandName: s.brandName || '',
        logoUrl: s.logoUrl || '',
        primaryColor: s.primaryColor || '#1D4ED8',
        supportEmail: s.supportEmail || '',
        customDomain: s.customDomain || '',
        ssoMode: s.sso.mode,
        ssoIssuer: s.sso.issuer || '',
        ssoClientId: s.sso.clientId || '',
        ssoEmailDomain: s.sso.emailDomain || '',
      });
    } catch (err: any) {
      setError(err?.message || 'Could not load Enterprise controls.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [role]);

  const cards = useMemo(() => {
    if (!overview) return [];
    const p = overview.portfolio || {};
    if (role === 'organizer') {
      return [
        ['Managed Conferences', p.conferences?.total || 0, `${p.conferences?.upcoming || 0} upcoming`],
        ['Registrations', p.conferences?.registrations || 0, 'Across managed conferences'],
        ['Abstracts', p.conferences?.submissions || 0, `${p.conferences?.accepted || 0} accepted`],
        ['Sponsor Deal Rooms', p.sponsorship?.dealRooms || 0, `${p.sponsorship?.inquiries || 0} inquiries`],
      ];
    }
    return [
      ['Saved Opportunities', p.sponsorship?.savedOpportunities || 0, 'Sponsor portfolio'],
      ['Inquiries', p.sponsorship?.inquiries || 0, 'Organizer opportunities contacted'],
      ['Deal Rooms', p.sponsorship?.dealRooms || 0, `${p.sponsorship?.completedDeals || 0} completed`],
      ['Sponsor Requests', p.sponsorship?.requests || 0, `${p.sponsorship?.acceptedOrganizerResponses || 0} accepted responses`],
    ];
  }, [overview, role]);

  const saveSettings = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!overview?.canAdmin) return;
    setSavingSettings(true);
    setError(null);
    try {
      const settings = await updateEnterpriseSettings(role, {
        brandName: draft.brandName || null,
        logoUrl: draft.logoUrl || null,
        primaryColor: draft.primaryColor || null,
        supportEmail: draft.supportEmail || null,
        customDomain: draft.customDomain || null,
        sso: {
          mode: draft.ssoMode,
          issuer: draft.ssoIssuer || null,
          clientId: draft.ssoClientId || null,
          emailDomain: draft.ssoEmailDomain || null,
        },
      });
      setOverview((prev) => prev ? { ...prev, settings } : prev);
    } catch (err: any) {
      setError(err?.message || 'Could not save Enterprise settings.');
    } finally {
      setSavingSettings(false);
    }
  };

  const toggleScope = (scope: EnterpriseScope) => {
    setApiScopes((prev) =>
      prev.includes(scope) ? prev.filter((item) => item !== scope) : [...prev, scope]
    );
  };

  const createKey = async () => {
    if (!overview?.canAdmin || !apiKeyName.trim() || !apiScopes.length) return;
    setBusyKey('create');
    setError(null);
    try {
      const created = await createEnterpriseApiKey(role, apiKeyName.trim(), apiScopes);
      setRevealedKey(created.key);
      setApiKeyName('');
      await load();
      setRevealedKey(created.key);
    } catch (err: any) {
      setError(err?.message || 'Could not create Enterprise API key.');
    } finally {
      setBusyKey(null);
    }
  };

  const revokeKey = async (id: string) => {
    if (!overview?.canAdmin) return;
    setBusyKey(id);
    setError(null);
    try {
      await revokeEnterpriseApiKey(role, id);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Could not revoke Enterprise API key.');
    } finally {
      setBusyKey(null);
    }
  };

  if (loading && !overview) {
    return (
      <div className="bg-white rounded-3xl border border-slate-200 p-10 flex items-center justify-center gap-2 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading Enterprise workspace…
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="bg-white rounded-3xl border border-rose-200 p-8 text-sm text-rose-700">
        {error || 'Enterprise workspace is unavailable.'}
      </div>
    );
  }

  const team = overview.portfolio?.team || {};

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Enterprise ConferenceGate</div>
            <h2 className="text-xl font-extrabold text-slate-900 mt-1">Workspace Portfolio & Controls</h2>
            <p className="text-xs text-slate-500 mt-1">
              One workspace for teams, multiple conferences, sponsorship portfolios, branding, API access and Enterprise identity configuration.
            </p>
          </div>
          <button onClick={() => void load()} className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
            <RefreshCw className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        {error && <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700">{error}</div>}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          {cards.map(([label, value, note]) => (
            <div key={String(label)} className="p-4 rounded-2xl border border-slate-200 bg-slate-50">
              <div className="text-[10px] uppercase font-bold text-slate-400">{label}</div>
              <div className="text-2xl font-extrabold text-slate-900 mt-1">{String(value)}</div>
              <div className="text-[10px] text-slate-500 mt-1">{note}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <div className="p-4 border border-slate-200 rounded-2xl">
            <Users className="w-4 h-4 text-blue-600 mb-2" />
            <div className="text-xs font-bold text-slate-900">{team.members || 1} active team members</div>
            <div className="text-[10px] text-slate-500">{team.admins || 1} owner/admin · seat cap {team.seatLimit || 1}</div>
          </div>
          <div className="p-4 border border-slate-200 rounded-2xl">
            <Building2 className="w-4 h-4 text-violet-600 mb-2" />
            <div className="text-xs font-bold text-slate-900">Multi-conference portfolio</div>
            <div className="text-[10px] text-slate-500">Workspace analytics aggregate real ConferenceGate records.</div>
          </div>
          <div className="p-4 border border-slate-200 rounded-2xl">
            <ShieldCheck className="w-4 h-4 text-emerald-600 mb-2" />
            <div className="text-xs font-bold text-slate-900">Role-based access</div>
            <div className="text-[10px] text-slate-500">You are {overview.workspaceRole}; admin controls {overview.canAdmin ? 'enabled' : 'read-only'}.</div>
          </div>
        </div>
      </div>

      <form onSubmit={saveSettings} className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-5">
        <div className="flex items-center gap-2">
          <Palette className="w-5 h-5 text-blue-600" />
          <div>
            <h3 className="text-base font-extrabold text-slate-900">Enterprise Branding</h3>
            <p className="text-xs text-slate-500">Save workspace branding and a future custom-domain mapping without changing ConferenceGate's global design.</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4 text-xs">
          <label className="space-y-1.5"><span className="font-bold text-slate-700">Brand name</span><input disabled={!overview.canAdmin} value={draft.brandName} onChange={(e) => setDraft({ ...draft, brandName: e.target.value })} className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50" /></label>
          <label className="space-y-1.5"><span className="font-bold text-slate-700">Logo URL (HTTPS)</span><input disabled={!overview.canAdmin} value={draft.logoUrl} onChange={(e) => setDraft({ ...draft, logoUrl: e.target.value })} className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50" /></label>
          <label className="space-y-1.5"><span className="font-bold text-slate-700">Primary color</span><input disabled={!overview.canAdmin} type="color" value={draft.primaryColor} onChange={(e) => setDraft({ ...draft, primaryColor: e.target.value })} className="h-11 w-full p-1 rounded-xl border border-slate-200 bg-white" /></label>
          <label className="space-y-1.5"><span className="font-bold text-slate-700">Support email</span><input disabled={!overview.canAdmin} type="email" value={draft.supportEmail} onChange={(e) => setDraft({ ...draft, supportEmail: e.target.value })} className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50" /></label>
          <label className="space-y-1.5 md:col-span-2"><span className="font-bold text-slate-700">Custom domain</span><input disabled={!overview.canAdmin} placeholder="events.example.com" value={draft.customDomain} onChange={(e) => setDraft({ ...draft, customDomain: e.target.value })} className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50" /><span className="text-[10px] text-slate-400">Mapping is stored now; DNS/TLS activation is a separate deployment step.</span></label>
        </div>

        <div className="rounded-2xl border border-slate-200 p-4" style={{ borderTopColor: draft.primaryColor, borderTopWidth: 4 }}>
          <div className="flex items-center gap-3">
            {draft.logoUrl ? <img src={draft.logoUrl} alt="" className="w-10 h-10 rounded-lg object-contain border border-slate-100" /> : <Building2 className="w-8 h-8 text-slate-300" />}
            <div><div className="font-extrabold text-sm text-slate-900">{draft.brandName || 'Enterprise brand preview'}</div><div className="text-[10px] text-slate-500">{draft.customDomain || 'ConferenceGate-hosted workspace'}</div></div>
          </div>
        </div>

        <div className="border-t border-slate-100 pt-5">
          <div className="flex items-center gap-2 mb-3"><LockKeyhole className="w-4 h-4 text-violet-600" /><h3 className="text-sm font-extrabold text-slate-900">Enterprise SSO Configuration</h3></div>
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-800 mb-4">
            Configuration can be stored now. SSO login remains disabled until an Enterprise OIDC provider is activated and its secret is configured securely.
          </div>
          <div className="grid md:grid-cols-2 gap-4 text-xs">
            <label className="space-y-1.5"><span className="font-bold text-slate-700">Mode</span><select disabled={!overview.canAdmin} value={draft.ssoMode} onChange={(e) => setDraft({ ...draft, ssoMode: e.target.value as 'off' | 'oidc' })} className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50"><option value="off">Off</option><option value="oidc">OIDC</option></select></label>
            <label className="space-y-1.5"><span className="font-bold text-slate-700">Allowed email domain</span><input disabled={!overview.canAdmin} placeholder="example.com" value={draft.ssoEmailDomain} onChange={(e) => setDraft({ ...draft, ssoEmailDomain: e.target.value })} className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50" /></label>
            <label className="space-y-1.5"><span className="font-bold text-slate-700">OIDC issuer (HTTPS)</span><input disabled={!overview.canAdmin} value={draft.ssoIssuer} onChange={(e) => setDraft({ ...draft, ssoIssuer: e.target.value })} className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50" /></label>
            <label className="space-y-1.5"><span className="font-bold text-slate-700">Client ID</span><input disabled={!overview.canAdmin} value={draft.ssoClientId} onChange={(e) => setDraft({ ...draft, ssoClientId: e.target.value })} className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50" /></label>
          </div>
        </div>

        {overview.canAdmin && <button disabled={savingSettings} className="px-5 py-2.5 rounded-xl bg-blue-900 text-white text-xs font-bold cursor-pointer disabled:opacity-60 flex items-center gap-2">{savingSettings && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Save Enterprise Settings</button>}
      </form>

      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-5">
        <div className="flex items-center gap-2"><KeyRound className="w-5 h-5 text-indigo-600" /><div><h3 className="text-base font-extrabold text-slate-900">Enterprise API</h3><p className="text-xs text-slate-500">Read-only API keys for portfolio, conference and sponsorship integrations.</p></div></div>

        {revealedKey && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-800"><CheckCircle2 className="w-4 h-4" />New key — copy it now; it will not be shown again.</div>
            <div className="flex gap-2 mt-2"><code className="flex-1 overflow-x-auto p-2 bg-white border border-emerald-200 rounded-lg text-[11px]">{revealedKey}</code><button onClick={() => navigator.clipboard?.writeText(revealedKey)} className="p-2 bg-white border border-emerald-200 rounded-lg cursor-pointer"><Copy className="w-4 h-4" /></button></div>
          </div>
        )}

        {overview.canAdmin && (
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
            <input value={apiKeyName} onChange={(e) => setApiKeyName(e.target.value)} placeholder="Integration name" className="w-full p-3 rounded-xl border border-slate-200 bg-white text-xs" />
            <div className="flex flex-wrap gap-2">{SCOPE_OPTIONS.filter((scope) => role === 'organizer' || scope.id !== 'conferences:read').map((scope) => <button key={scope.id} type="button" onClick={() => toggleScope(scope.id)} className={`px-3 py-1.5 rounded-full border text-[10px] font-bold cursor-pointer ${apiScopes.includes(scope.id) ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-slate-200 text-slate-500'}`}>{scope.label}</button>)}</div>
            <button onClick={createKey} disabled={!apiKeyName.trim() || !apiScopes.length || busyKey === 'create'} className="px-4 py-2 rounded-xl bg-indigo-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50">Create API Key</button>
          </div>
        )}

        <div className="space-y-2">
          {overview.apiKeys.length === 0 ? <div className="text-xs text-slate-400 p-4 text-center">No Enterprise API keys yet.</div> : overview.apiKeys.map((key) => (
            <div key={key.id} className="flex items-center justify-between gap-4 p-3 border border-slate-200 rounded-xl">
              <div className="min-w-0"><div className="font-bold text-xs text-slate-900">{key.name}</div><div className="text-[10px] text-slate-500">{key.prefix}… · {key.scopes.join(', ')} · {key.revokedAt ? 'revoked' : key.lastUsedAt ? `last used ${new Date(key.lastUsedAt).toLocaleString()}` : 'never used'}</div></div>
              {!key.revokedAt && overview.canAdmin && <button onClick={() => revokeKey(key.id)} disabled={busyKey === key.id} className="p-2 rounded-lg text-rose-600 hover:bg-rose-50 cursor-pointer"><Trash2 className="w-4 h-4" /></button>}
            </div>
          ))}
        </div>

        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[10px] text-slate-500">
          API base: <code>/api/enterprise/v1</code>. Supported read endpoints: <code>/portfolio</code>, <code>/conferences</code> (Organizer), and <code>/sponsorship</code>. Keys are hashed in the database and the plaintext is returned only once.
        </div>
      </div>
    </div>
  );
};
