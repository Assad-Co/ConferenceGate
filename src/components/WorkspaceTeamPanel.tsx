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
} from 'lucide-react';
import {
  addWorkspaceMember,
  fetchMyWorkspace,
  fetchWorkspaceActivation,
  removeWorkspaceMember,
  renameMyWorkspace,
  updateWorkspaceMemberRole,
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

  const canAdmin = workspace ? workspace.myRole === 'owner' || workspace.myRole === 'admin' : false;
  const seatsUsed = workspace?.members.length || 0;
  const seatPercent = workspace ? Math.min(100, Math.round((seatsUsed / Math.max(1, workspace.seatLimit)) * 100)) : 0;

  const sortedAudit = useMemo(() => (workspace?.audit || []).slice(0, 20), [workspace]);

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
      await refreshActivation();
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
      setWorkspace(await updateWorkspaceMemberRole(userId, role));
    } catch (err: any) {
      setError(err?.message || 'Could not update team role.');
    } finally {
      setBusyUserId(null);
    }
  };

  const removeMember = async (userId: string) => {
    setBusyUserId(userId);
    setError(null);
    try {
      setWorkspace(await removeWorkspaceMember(userId));
      await refreshActivation();
    } catch (err: any) {
      setError(err?.message || 'Could not remove team member.');
    } finally {
      setBusyUserId(null);
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

      {canAdmin && (
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
                {member.workspaceRole === 'owner' || !canAdmin ? (
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
