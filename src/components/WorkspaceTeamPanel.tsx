import React, { useEffect, useMemo, useState } from 'react';
import {
  Users,
  UserPlus,
  ShieldCheck,
  Trash2,
  Loader2,
  Save,
  History,
  CheckCircle2,
  Circle,
  Target,
  RefreshCw,
  ArrowRight,
  Trophy,
  Download,
  LockKeyhole,
} from 'lucide-react';
import {
  addWorkspaceMember,
  fetchMyWorkspace,
  fetchWorkspaceActivation,
  removeWorkspaceMember,
  renameMyWorkspace,
  updateWorkspaceMemberRole,
  fetchWorkspaceEnterpriseSettings,
  updateWorkspaceEnterpriseSettings,
  downloadWorkspaceAuditCsv,
  downloadWorkspaceDataJson,
  downloadWorkspaceEnterpriseReportCsv,
  fetchWorkspaceEnterpriseReport,
  updateWorkspaceDataControls,
  startWorkspaceDomainVerification,
  checkWorkspaceDomainVerification,
  type WorkspaceEnterpriseSettings,
  type WorkspaceDataControls,
  type WorkspaceEnterpriseReport,
  type AccountWorkspace,
  type WorkspaceActivation,
  type WorkspaceMemberRole,
} from '../api/workspaces';
import { useToast } from './Toast';

interface WorkspaceTeamPanelProps {
  accountLabel: 'Organizer Pro' | 'Sponsor Pro';
}

const roleDescription: Record<WorkspaceMemberRole, string> = {
  owner: 'Billing owner and workspace authority',
  admin: 'Can manage the workspace team',
  member: 'Operational team member',
  viewer: 'Read-only team seat',
};

export const WorkspaceTeamPanel: React.FC<WorkspaceTeamPanelProps> = ({ accountLabel }) => {
  const { showToast } = useToast();
  const [workspace, setWorkspace] = useState<AccountWorkspace | null>(null);
  const [activation, setActivation] = useState<WorkspaceActivation | null>(null);
  const [loading, setLoading] = useState(true);
  const [activationLoading, setActivationLoading] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [adding, setAdding] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const [email, setEmail] = useState('');
  const [memberRole, setMemberRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const [error, setError] = useState<string | null>(null);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [enterpriseSettings, setEnterpriseSettings] = useState<WorkspaceEnterpriseSettings | null>(null);
  const [enterpriseDomains, setEnterpriseDomains] = useState('');
  const [savingEnterprise, setSavingEnterprise] = useState(false);
  const [enterpriseDomain, setEnterpriseDomain] = useState('');
  const [domainVerificationBusy, setDomainVerificationBusy] = useState(false);
  const [dataControls, setDataControls] = useState<WorkspaceDataControls | null>(null);
  const [savingDataControls, setSavingDataControls] = useState(false);
  const [enterpriseReport, setEnterpriseReport] = useState<WorkspaceEnterpriseReport | null>(null);
  const [enterpriseReportLoading, setEnterpriseReportLoading] = useState(false);
  const [exportingKey, setExportingKey] = useState<'audit' | 'data' | 'report' | null>(null);

  const canAdmin = workspace ? workspace.myRole === 'owner' || workspace.myRole === 'admin' : false;
  const canManageMembers = workspace
    ? workspace.myRole === 'owner' || (workspace.myRole === 'admin' && (dataControls?.adminsCanManageMembers ?? true))
    : false;
  const canExport = workspace
    ? workspace.myRole === 'owner' || (workspace.myRole === 'admin' && (dataControls?.allowAdminExports ?? true))
    : false;
  const seatsUsed = workspace?.members.length || 0;
  const seatPercent = workspace ? Math.min(100, Math.round((seatsUsed / Math.max(1, workspace.seatLimit)) * 100)) : 0;

  const sortedAudit = useMemo(() => (workspace?.audit || []).slice(0, 20), [workspace]);
  const nextActivationStep = activation?.steps.find((step) => !step.complete) || null;

  const refreshActivation = async () => {
    setActivationLoading(true);
    setActivationError(null);
    try {
      setActivation(await fetchWorkspaceActivation());
    } catch (err: any) {
      setActivationError(err?.message || 'Could not load activation progress.');
    } finally {
      setActivationLoading(false);
    }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMyWorkspace();
      setWorkspace(data);
      setWorkspaceName(data.name);
      setDataControls(data.dataControls || null);
      await refreshActivation();
      if (data.myRole === 'owner' || data.myRole === 'admin') {
        try {
          const [settings, report] = await Promise.all([
            fetchWorkspaceEnterpriseSettings(),
            fetchWorkspaceEnterpriseReport(),
          ]);
          setEnterpriseSettings(settings);
          setEnterpriseDomains(settings.allowedEmailDomains.join(', '));
          setEnterpriseDomain(settings.domainVerification?.domain || settings.allowedEmailDomains[0] || '');
          setEnterpriseReport(report);
        } catch {
          setEnterpriseSettings(null);
          setEnterpriseReport(null);
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Could not load team workspace.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const saveName = async () => {
    if (!workspaceName.trim() || workspaceName.trim() === workspace?.name) return;
    setSavingName(true);
    setError(null);
    try {
      const updated = await renameMyWorkspace(workspaceName.trim());
      setWorkspace(updated);
      setWorkspaceName(updated.name);
      showToast({ type: 'success', title: 'Workspace renamed', message: 'The new workspace name is saved.' });
    } catch (err: any) {
      setError(err?.message || 'Could not rename workspace.');
    } finally {
      setSavingName(false);
    }
  };

  const saveEnterpriseSettings = async () => {
    if (!enterpriseSettings) return;
    setSavingEnterprise(true);
    setError(null);
    try {
      const domains = [...new Set(
        enterpriseDomains
          .split(',')
          .map((item) => item.trim().toLowerCase().replace(/^@+/, ''))
          .filter(Boolean)
      )];
      const updated = await updateWorkspaceEnterpriseSettings({
        requireAllowedDomain: enterpriseSettings.requireAllowedDomain,
        allowedEmailDomains: domains,
      });
      setEnterpriseSettings(updated);
      setEnterpriseDomains(updated.allowedEmailDomains.join(', '));
      showToast({
        type: 'success',
        title: 'Enterprise controls saved',
        message: updated.requireAllowedDomain
          ? 'New workspace members must use an approved company email domain.'
          : 'Email-domain enforcement is disabled.',
      });
      await load();
    } catch (err: any) {
      setError(err?.message || 'Could not save enterprise controls.');
    } finally {
      setSavingEnterprise(false);
    }
  };

  const startDomainVerification = async () => {
    if (!enterpriseDomain.trim()) return;
    setDomainVerificationBusy(true);
    setError(null);
    try {
      const verification = await startWorkspaceDomainVerification(enterpriseDomain.trim());
      setEnterpriseSettings((prev) => prev ? { ...prev, domainVerification: verification } : prev);
      showToast({
        type: 'success',
        title: 'Domain verification started',
        message: 'Add the TXT record shown below to your company DNS, then check verification.',
      });
    } catch (err: any) {
      setError(err?.message || 'Could not start domain verification.');
    } finally {
      setDomainVerificationBusy(false);
    }
  };

  const checkDomainVerification = async () => {
    setDomainVerificationBusy(true);
    setError(null);
    try {
      const verification = await checkWorkspaceDomainVerification();
      setEnterpriseSettings((prev) => prev ? { ...prev, domainVerification: verification } : prev);
      showToast({
        type: 'success',
        title: 'Company domain verified',
        message: `${verification.domain} is now verified for this workspace.`,
      });
    } catch (err: any) {
      setError(err?.message || 'Domain verification is not complete yet.');
    } finally {
      setDomainVerificationBusy(false);
    }
  };

  const refreshEnterpriseReport = async () => {
    setEnterpriseReportLoading(true);
    setError(null);
    try {
      setEnterpriseReport(await fetchWorkspaceEnterpriseReport());
    } catch (err: any) {
      setError(err?.message || 'Could not refresh enterprise report.');
    } finally {
      setEnterpriseReportLoading(false);
    }
  };

  const saveDataControls = async () => {
    if (!dataControls) return;
    setSavingDataControls(true);
    setError(null);
    try {
      const updated = await updateWorkspaceDataControls({
        adminsCanManageMembers: dataControls.adminsCanManageMembers,
        allowAdminExports: dataControls.allowAdminExports,
        auditVisibilityDays: dataControls.auditVisibilityDays,
      });
      setDataControls(updated);
      setWorkspace((prev) => prev ? { ...prev, dataControls: updated } : prev);
      showToast({
        type: 'success',
        title: 'Governance controls saved',
        message: 'Workspace permissions, export policy, and audit visibility are updated.',
      });
    } catch (err: any) {
      setError(err?.message || 'Could not save workspace data controls.');
    } finally {
      setSavingDataControls(false);
    }
  };

  const addMember = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const updated = await addWorkspaceMember(email.trim(), memberRole);
      setWorkspace(updated);
      setEmail('');
      await refreshActivation();
      showToast({
        type: 'success',
        title: 'Team member added',
        message: 'The existing ConferenceGate account is now on this paid workspace roster.',
      });
    } catch (err: any) {
      setError(err?.message || 'Could not add team member.');
    } finally {
      setAdding(false);
    }
  };

  const changeRole = async (userId: string, role: 'admin' | 'member' | 'viewer') => {
    setBusyUserId(userId);
    setError(null);
    try {
      const updated = await updateWorkspaceMemberRole(userId, role);
      setWorkspace(updated);
      const member = updated.members.find((item) => item.id === userId);
      showToast({
        type: 'success',
        title: 'Workspace role updated',
        message: `${member?.name || 'Team member'} is now ${role}.`,
      });
    } catch (err: any) {
      setError(err?.message || 'Could not update team role.');
    } finally {
      setBusyUserId(null);
    }
  };

  const removeMember = async (userId: string) => {
    const member = workspace?.members.find((item) => item.id === userId);
    const confirmed = window.confirm(`Remove ${member?.name || 'this team member'} from the paid workspace? Their ConferenceGate account will remain active.`);
    if (!confirmed) return;
    setBusyUserId(userId);
    setError(null);
    try {
      setWorkspace(await removeWorkspaceMember(userId));
      await refreshActivation();
      showToast({
        type: 'success',
        title: 'Team member removed',
        message: `${member?.name || 'The team member'} no longer has access to this paid workspace.`,
      });
    } catch (err: any) {
      setError(err?.message || 'Could not remove team member.');
    } finally {
      setBusyUserId(null);
    }
  };

  const runExport = async (key: 'audit' | 'data' | 'report', action: () => Promise<void>) => {
    if (exportingKey) return;
    setExportingKey(key);
    setError(null);
    try {
      await action();
      showToast({ type: 'success', title: 'Export ready', message: 'The workspace export was generated successfully.' });
    } catch (err: any) {
      const message = err?.message || 'Could not generate the workspace export.';
      setError(message);
      showToast({ type: 'info', title: 'Export failed', message });
    } finally {
      setExportingKey(null);
    }
  };

  if (loading) {
    return (
      <div className="p-10 bg-white rounded-3xl border border-slate-200 text-center">
        <Loader2 className="w-6 h-6 animate-spin text-blue-700 mx-auto" />
        <p className="text-xs text-slate-500 mt-2">Loading team workspace…</p>
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="p-8 bg-white rounded-3xl border border-slate-200 text-center">
        <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <h3 className="text-sm font-bold text-slate-900">Team workspace unavailable</h3>
        <p className="text-xs text-slate-500 mt-1">{error || 'Please refresh the page.'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
              <Target className="w-5 h-5 text-blue-700" />
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">{accountLabel} · Activation</span>
              <h2 className="text-lg font-bold text-slate-900 mt-0.5">Get to first commercial value</h2>
              <p className="text-xs text-slate-500 mt-1 max-w-2xl">
                These milestones update from real ConferenceGate activity in this shared workspace. Team setup is optional and does not reduce activation progress.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={refreshActivation}
            disabled={activationLoading}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-[10px] font-bold text-slate-600 flex items-center gap-1.5 cursor-pointer disabled:opacity-50 self-start"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${activationLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {activationError && (
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-700">{activationError}</div>
        )}

        {activation && (
          <>
            <div className="flex items-center gap-4">
              <div className="flex-1 h-3 rounded-full bg-slate-100 overflow-hidden border border-slate-200">
                <div
                  className="h-full rounded-full bg-blue-700 transition-all"
                  style={{ width: `${activation.progressPct}%` }}
                />
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-extrabold text-slate-900">{activation.progressPct}%</div>
                <div className="text-[9px] text-slate-400 font-bold uppercase">
                  {activation.completedCount}/{activation.totalCount} core steps
                </div>
              </div>
            </div>

            {nextActivationStep ? (
              <div className="p-4 rounded-2xl bg-blue-50 border border-blue-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <ArrowRight className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[9px] uppercase font-extrabold tracking-wider text-blue-500">Next best action</div>
                    <div className="text-sm font-bold text-blue-950 mt-0.5">{nextActivationStep.label}</div>
                    <p className="text-[10px] text-blue-700 mt-1 max-w-2xl">{nextActivationStep.description}</p>
                  </div>
                </div>
                <span className="px-3 py-1.5 rounded-full bg-white border border-blue-200 text-[10px] font-bold text-blue-700 shrink-0">
                  Step {activation.completedCount + 1} of {activation.totalCount}
                </span>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-start gap-3">
                <Trophy className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-bold text-emerald-950">Core activation complete</div>
                  <p className="text-[10px] text-emerald-700 mt-1">This workspace has completed every core commercial activation milestone.</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {activation.steps.map((step) => (
                <div
                  key={step.key}
                  className={`p-4 rounded-2xl border ${step.complete ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}
                >
                  <div className="flex items-start gap-3">
                    {step.complete ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <Circle className="w-5 h-5 text-slate-300 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <div className={`text-xs font-bold ${step.complete ? 'text-emerald-900' : 'text-slate-900'}`}>
                        {step.label}
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">{step.description}</p>
                      {step.count > 0 && (
                        <div className="text-[9px] font-bold text-slate-400 uppercase mt-2">Recorded: {step.count}</div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className={`p-4 rounded-2xl border ${activation.optional.complete ? 'bg-blue-50 border-blue-200' : 'bg-white border-dashed border-slate-300'}`}>
              <div className="flex items-start gap-3">
                {activation.optional.complete ? (
                  <CheckCircle2 className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" />
                ) : (
                  <UserPlus className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="text-xs font-bold text-slate-900">{activation.optional.label} <span className="text-[9px] text-slate-400 uppercase">Optional</span></div>
                  <p className="text-[10px] text-slate-500 mt-1">{activation.optional.description}</p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
          <div>
            <span className="text-[10px] font-bold uppercase text-blue-600">{accountLabel} · Team & Access</span>
            <h2 className="text-xl font-bold text-slate-900 mt-1">Paid Account Workspace</h2>
            <p className="text-xs text-slate-500 mt-1 max-w-2xl">
              Maintain the organization roster, workspace roles, seat usage, and an auditable history of access changes.
              Team members must already have the matching ConferenceGate account type before they can be added.
            </p>
          </div>
          <div className="min-w-48 p-4 rounded-2xl bg-blue-50 border border-blue-100">
            <div className="text-[10px] font-bold uppercase text-blue-500">Seats</div>
            <div className="text-xl font-extrabold text-blue-900">{seatsUsed} / {workspace.seatLimit}</div>
            <div className="h-2 rounded-full bg-white overflow-hidden mt-2 border border-blue-100">
              <div className="h-full bg-blue-700 rounded-full" style={{ width: `${seatPercent}%` }} />
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={workspaceName}
            disabled={!canAdmin}
            onChange={(e) => setWorkspaceName(e.target.value)}
            className="flex-1 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold disabled:opacity-60"
          />
          {canAdmin && (
            <button
              type="button"
              onClick={saveName}
              disabled={savingName || !workspaceName.trim() || workspaceName.trim() === workspace.name}
              className="px-4 py-3 rounded-xl bg-slate-900 text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {savingName ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Name
            </button>
          )}
        </div>

        {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">{error}</div>}
      </div>

      {canAdmin && enterpriseSettings && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
                <LockKeyhole className="w-5 h-5 text-indigo-700" />
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">Enterprise Governance</span>
                <h3 className="text-base font-bold text-slate-900 mt-0.5">Workspace access controls</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-2xl">
                  Restrict new team members to approved company email domains and export the full workspace access audit when needed.
                </p>
              </div>
            </div>
            {canExport && (
              <div className="flex flex-wrap gap-2 self-start">
                <button
                  type="button"
                  onClick={() => runExport('audit', downloadWorkspaceAuditCsv)}
                  disabled={exportingKey !== null}
                  className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-[10px] font-bold text-slate-700 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  Audit CSV
                </button>
                <button
                  type="button"
                  onClick={() => runExport('data', downloadWorkspaceDataJson)}
                  disabled={exportingKey !== null}
                  className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-[10px] font-bold text-slate-700 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  Workspace Data
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 items-end">
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1.5">
                Approved email domains
              </label>
              <input
                value={enterpriseDomains}
                disabled={workspace.myRole !== 'owner'}
                onChange={(e) => setEnterpriseDomains(e.target.value)}
                placeholder="company.com, subsidiary.com"
                className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs disabled:opacity-60"
              />
            </div>
            <label className="flex items-center gap-2 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={enterpriseSettings.requireAllowedDomain}
                disabled={workspace.myRole !== 'owner'}
                onChange={(e) =>
                  setEnterpriseSettings({ ...enterpriseSettings, requireAllowedDomain: e.target.checked })
                }
              />
              Enforce approved domains
            </label>
          </div>

          {workspace.myRole === 'owner' && (
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 space-y-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider font-bold text-indigo-600">Verified organization domain</div>
                <p className="text-[10px] text-slate-600 mt-1">
                  Verify control of your company domain with one DNS TXT record. This does not change sign-in or enable SSO.
                </p>
              </div>

              <div className="flex flex-col md:flex-row gap-2">
                <input
                  value={enterpriseDomain}
                  onChange={(e) => setEnterpriseDomain(e.target.value)}
                  placeholder="company.com"
                  className="flex-1 p-2.5 rounded-xl bg-white border border-slate-200 text-xs"
                />
                <button
                  type="button"
                  onClick={startDomainVerification}
                  disabled={domainVerificationBusy || !enterpriseDomain.trim()}
                  className="px-4 py-2.5 rounded-xl bg-white border border-indigo-200 text-indigo-700 text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  Start Verification
                </button>
              </div>

              {enterpriseSettings.domainVerification && (
                <div className="rounded-xl bg-white border border-slate-200 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-bold text-slate-900">{enterpriseSettings.domainVerification.domain}</div>
                      <div className="text-[10px] text-slate-500">
                        Status:{' '}
                        <span className={enterpriseSettings.domainVerification.status === 'verified' ? 'text-emerald-700 font-bold' : 'text-amber-700 font-bold'}>
                          {enterpriseSettings.domainVerification.status}
                        </span>
                      </div>
                    </div>
                    {enterpriseSettings.domainVerification.status !== 'verified' && (
                      <button
                        type="button"
                        onClick={checkDomainVerification}
                        disabled={domainVerificationBusy}
                        className="px-3 py-2 rounded-lg bg-indigo-700 text-white text-[10px] font-bold cursor-pointer disabled:opacity-50"
                      >
                        Check DNS
                      </button>
                    )}
                  </div>
                  {enterpriseSettings.domainVerification.status !== 'verified' && (
                    <div className="text-[10px] text-slate-600 space-y-1">
                      <div><span className="font-bold">TXT name:</span> {enterpriseSettings.domainVerification.txtName}</div>
                      <div className="break-all"><span className="font-bold">TXT value:</span> {enterpriseSettings.domainVerification.txtValue}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {dataControls && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Data & admin controls</div>
                <p className="text-[10px] text-slate-500 mt-1">
                  Control delegated admin actions, data exports, and how much workspace audit history is shown in the dashboard.
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <label className="flex items-start gap-2 p-3 rounded-xl bg-white border border-slate-200 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={dataControls.adminsCanManageMembers}
                    disabled={workspace.myRole !== 'owner'}
                    onChange={(e) => setDataControls({ ...dataControls, adminsCanManageMembers: e.target.checked })}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-bold block">Admins manage members</span>
                    <span className="text-[10px] text-slate-500">Allow admin seats to add, remove, and change team roles.</span>
                  </span>
                </label>

                <label className="flex items-start gap-2 p-3 rounded-xl bg-white border border-slate-200 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={dataControls.allowAdminExports}
                    disabled={workspace.myRole !== 'owner'}
                    onChange={(e) => setDataControls({ ...dataControls, allowAdminExports: e.target.checked })}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-bold block">Admins can export</span>
                    <span className="text-[10px] text-slate-500">Allow admin seats to download audit and workspace-data exports.</span>
                  </span>
                </label>

                <label className="p-3 rounded-xl bg-white border border-slate-200 text-xs text-slate-700">
                  <span className="font-bold block mb-1">Audit dashboard window</span>
                  <select
                    value={dataControls.auditVisibilityDays}
                    disabled={workspace.myRole !== 'owner'}
                    onChange={(e) => setDataControls({ ...dataControls, auditVisibilityDays: Number(e.target.value) })}
                    className="w-full p-2 rounded-lg border border-slate-200 bg-white text-xs"
                  >
                    <option value={30}>30 days</option>
                    <option value={90}>90 days</option>
                    <option value={365}>1 year</option>
                    <option value={1095}>3 years</option>
                    <option value={3650}>10 years</option>
                  </select>
                  <span className="text-[10px] text-slate-500 block mt-1">This limits dashboard history; it does not delete stored audit records.</span>
                </label>
              </div>

              {workspace.myRole === 'owner' && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={saveDataControls}
                    disabled={savingDataControls}
                    className="px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {savingDataControls ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save Data Controls
                  </button>
                </div>
              )}
            </div>
          )}

          {workspace.myRole === 'owner' && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={saveEnterpriseSettings}
                disabled={savingEnterprise}
                className="px-4 py-2.5 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white text-xs font-bold flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {savingEnterprise ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Enterprise Controls
              </button>
            </div>
          )}
        </div>
      )}

      {canAdmin && enterpriseReport && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Enterprise Reporting</span>
              <h3 className="text-base font-bold text-slate-900 mt-0.5">Workspace usage & activity</h3>
              <p className="text-xs text-slate-500 mt-1">
                Live workspace metrics from ConferenceGate records. No estimated customer activity is added.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={refreshEnterpriseReport}
                disabled={enterpriseReportLoading}
                className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-[10px] font-bold text-slate-700 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${enterpriseReportLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              {canExport && (
                <button
                  type="button"
                  onClick={() => runExport('report', downloadWorkspaceEnterpriseReportCsv)}
                  disabled={exportingKey !== null}
                  className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-[10px] font-bold text-slate-700 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  Report CSV
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-4 rounded-2xl bg-blue-50 border border-blue-100">
              <div className="text-[9px] uppercase font-bold text-blue-500">Seat utilization</div>
              <div className="text-xl font-extrabold text-blue-950 mt-1">{enterpriseReport.workspace.seatUtilizationPct}%</div>
              <div className="text-[10px] text-blue-700 mt-1">{enterpriseReport.workspace.seatsUsed} / {enterpriseReport.workspace.seatLimit} seats</div>
            </div>
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
              <div className="text-[9px] uppercase font-bold text-slate-500">Workspace changes</div>
              <div className="text-xl font-extrabold text-slate-900 mt-1">{enterpriseReport.activity.auditEvents30d}</div>
              <div className="text-[10px] text-slate-500 mt-1">audit events in 30 days</div>
            </div>
            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-100">
              <div className="text-[9px] uppercase font-bold text-emerald-600">Domain identity</div>
              <div className="text-sm font-extrabold text-emerald-950 mt-2">
                {enterpriseReport.governance.domainVerification?.status === 'verified' ? 'Verified' : enterpriseReport.governance.domainVerification ? 'Pending' : 'Not configured'}
              </div>
              <div className="text-[10px] text-emerald-700 mt-1 truncate">
                {enterpriseReport.governance.domainVerification?.domain || '—'}
              </div>
            </div>
            <div className="p-4 rounded-2xl bg-indigo-50 border border-indigo-100">
              <div className="text-[9px] uppercase font-bold text-indigo-500">Team roles</div>
              <div className="text-[10px] text-indigo-900 mt-2 space-y-0.5">
                <div>{enterpriseReport.workspace.roleCounts.admin} admin</div>
                <div>{enterpriseReport.workspace.roleCounts.member} member</div>
                <div>{enterpriseReport.workspace.roleCounts.viewer} viewer</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-900">Product activity</div>
              <div className="divide-y divide-slate-100">
                {Object.entries(enterpriseReport.productMetrics).map(([key, value]) => (
                  <div key={key} className="px-4 py-2.5 flex items-center justify-between text-[11px]">
                    <span className="text-slate-600">{key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}</span>
                    <span className="font-extrabold text-slate-900">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-900">Top workspace actions · 30 days</div>
              {enterpriseReport.activity.topActions30d.length ? (
                <div className="divide-y divide-slate-100">
                  {enterpriseReport.activity.topActions30d.slice(0, 6).map((item) => (
                    <div key={item.action} className="px-4 py-2.5 flex items-center justify-between text-[11px]">
                      <span className="text-slate-600">{item.action.replace(/_/g, ' ')}</span>
                      <span className="font-extrabold text-slate-900">{item.count}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 text-[11px] text-slate-400">No workspace changes in the last 30 days.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {canManageMembers && (
        <form onSubmit={addMember} className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-blue-700" />
            <h3 className="font-bold text-sm text-slate-900">Add Existing Account</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_180px_auto] gap-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.com"
              className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs"
            />
            <select
              value={memberRole}
              onChange={(e) => setMemberRole(e.target.value as 'admin' | 'member' | 'viewer')}
              className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold"
            >
              <option value="admin">Admin</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </select>
            <button
              disabled={adding || seatsUsed >= workspace.seatLimit}
              className="px-5 py-3 rounded-xl bg-blue-900 hover:bg-blue-950 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              {adding ? 'Adding…' : 'Add Member'}
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-sm text-slate-900">Workspace Members</h3>
            <p className="text-[11px] text-slate-500">Owner, admin, member, and viewer roles are stored and audited.</p>
          </div>
          <ShieldCheck className="w-5 h-5 text-emerald-600" />
        </div>
        <div className="divide-y divide-slate-100">
          {workspace.members.map((member) => (
            <div key={member.id} className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                  {member.avatar ? (
                    <img src={member.avatar} alt={member.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="font-extrabold text-slate-500 text-xs">
                      {member.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-xs text-slate-900 truncate">{member.name}</div>
                  <div className="text-[10px] text-slate-500 truncate">
                    {member.email}{member.organization ? ` · ${member.organization}` : ''}
                  </div>
                  <div className="text-[9px] text-slate-400 mt-0.5">{roleDescription[member.workspaceRole]}</div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {member.workspaceRole === 'owner' || !canManageMembers ? (
                  <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-[10px] font-bold uppercase">
                    {member.workspaceRole}
                  </span>
                ) : (
                  <>
                    <select
                      disabled={busyUserId === member.id}
                      value={member.workspaceRole}
                      onChange={(e) => changeRole(member.id, e.target.value as 'admin' | 'member' | 'viewer')}
                      className="p-2 rounded-lg border border-slate-200 bg-white text-[10px] font-bold"
                    >
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <button
                      type="button"
                      disabled={busyUserId === member.id}
                      onClick={() => removeMember(member.id)}
                      className="p-2 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 cursor-pointer disabled:opacity-50"
                      aria-label="Remove member"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs">
        <div className="flex items-center gap-2 mb-4">
          <History className="w-4 h-4 text-blue-700" />
          <h3 className="font-bold text-sm text-slate-900">Access Audit</h3>
        </div>
        {sortedAudit.length === 0 ? (
          <p className="text-xs text-slate-400">No access changes recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {sortedAudit.map((item) => (
              <div key={item.id} className="p-3 rounded-xl bg-slate-50 border border-slate-100 text-[11px] text-slate-600">
                <span className="font-bold text-slate-900">{item.actorName}</span>
                {' · '}
                <span>{item.action.replace(/_/g, ' ')}</span>
                {item.targetName ? <span> · {item.targetName}</span> : null}
                <div className="text-[9px] text-slate-400 mt-0.5">{item.createdAt}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
