from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'Missing target: {label}')
    return text.replace(old, new, 1)


# --- MessagesPanel: await message send, keep failed drafts, block duplicate sends ---
p = Path('src/components/MessagesPanel.tsx')
s = p.read_text()
s = replace_once(
    s,
    "  UserPlus,\n  X,\n} from 'lucide-react';",
    "  UserPlus,\n  X,\n  Loader2,\n} from 'lucide-react';",
    'messages loader import',
)
s = replace_once(
    s,
    "  onSendMessage: (partnerId: string, text: string) => void;",
    "  onSendMessage: (partnerId: string, text: string) => Promise<boolean>;",
    'messages send prop promise',
)
s = replace_once(
    s,
    "  const [conversationFilter, setConversationFilter] = useState<ConversationFilter>('all');\n  const [mobileThreadOpen, setMobileThreadOpen] = useState(Boolean(activePartnerId || pendingPartner));",
    "  const [conversationFilter, setConversationFilter] = useState<ConversationFilter>('all');\n  const [mobileThreadOpen, setMobileThreadOpen] = useState(Boolean(activePartnerId || pendingPartner));\n  const [sending, setSending] = useState(false);\n  const [sendError, setSendError] = useState<string | null>(null);\n  const [memberSearchError, setMemberSearchError] = useState<string | null>(null);",
    'messages action state',
)
s = replace_once(
    s,
    "  const handleSend = (event: React.FormEvent) => {\n    event.preventDefault();\n    if (!draft.trim() || !activePartnerId) return;\n    onSendMessage(activePartnerId, draft.trim());\n    setDraft('');\n  };",
    "  const handleSend = async (event: React.FormEvent) => {\n    event.preventDefault();\n    const text = draft.trim();\n    if (!text || !activePartnerId || sending) return;\n    setSending(true);\n    setSendError(null);\n    try {\n      const sent = await onSendMessage(activePartnerId, text);\n      if (sent) {\n        setDraft('');\n      } else {\n        setSendError('Message was not sent. Your draft has been kept so you can try again.');\n      }\n    } catch (error: any) {\n      setSendError(error?.message || 'Message was not sent. Your draft has been kept so you can try again.');\n    } finally {\n      setSending(false);\n    }\n  };",
    'messages await send',
)
s = replace_once(
    s,
    "    if (!value.trim()) {\n      setResults([]);\n      setSearching(false);\n      return;\n    }\n\n    setSearching(true);",
    "    setMemberSearchError(null);\n    if (!value.trim()) {\n      setResults([]);\n      setSearching(false);\n      return;\n    }\n\n    setSearching(true);",
    'messages reset search error',
)
s = replace_once(
    s,
    "      .catch(() => {\n        if (sequence === searchSequence.current) setResults([]);\n      })",
    "      .catch((error: any) => {\n        if (sequence === searchSequence.current) {\n          setResults([]);\n          setMemberSearchError(error?.message || 'Member search is temporarily unavailable.');\n        }\n      })",
    'messages search error',
)
s = replace_once(
    s,
    "                ) : results.length === 0 ? (\n                  <p className=\"text-[11px] text-slate-400 p-3\">No registered members match “{query}”.</p>",
    "                ) : memberSearchError ? (\n                  <p className=\"text-[11px] text-rose-600 p-3\">{memberSearchError}</p>\n                ) : results.length === 0 ? (\n                  <p className=\"text-[11px] text-slate-400 p-3\">No registered members match “{query}”.</p>",
    'messages search error UI',
)
s = replace_once(
    s,
    "          {activePartner && activePartnerId && (\n            <form onSubmit={handleSend} className=\"p-3 border-t border-slate-100 flex items-center gap-2 bg-white\">",
    "          {activePartner && activePartnerId && (\n            <form onSubmit={handleSend} className=\"p-3 border-t border-slate-100 bg-white\">\n              {sendError && (\n                <div className=\"mb-2 px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-[10px] text-rose-700\">\n                  {sendError}\n                </div>\n              )}\n              <div className=\"flex items-center gap-2\">",
    'messages composer wrapper',
)
s = replace_once(
    s,
    "                onChange={(event) => setDraft(event.target.value)}\n                placeholder={`Message ${activePartner.name}...`}",
    "                onChange={(event) => { setDraft(event.target.value); if (sendError) setSendError(null); }}\n                disabled={sending}\n                placeholder={`Message ${activePartner.name}...`}",
    'messages input sending state',
)
s = replace_once(
    s,
    "                disabled={!draft.trim()}\n                className=\"p-2.5 bg-blue-900 hover:bg-blue-950 disabled:opacity-40 text-white rounded-full transition-colors cursor-pointer shrink-0\"\n                aria-label=\"Send message\"\n              >\n                <Send className=\"w-4 h-4\" />\n              </button>\n            </form>",
    "                disabled={!draft.trim() || sending}\n                className=\"p-2.5 bg-blue-900 hover:bg-blue-950 disabled:opacity-40 text-white rounded-full transition-colors cursor-pointer shrink-0\"\n                aria-label={sending ? 'Sending message' : 'Send message'}\n              >\n                {sending ? <Loader2 className=\"w-4 h-4 animate-spin\" /> : <Send className=\"w-4 h-4\" />}\n              </button>\n              </div>\n            </form>",
    'messages send button state',
)
p.write_text(s)


# --- App: report message send outcome to composer instead of swallowing failures ---
p = Path('src/App.tsx')
s = p.read_text()
s = replace_once(
    s,
    "      setConversations((prev) => {\n        const idx = prev.findIndex((c) => c.partnerId === partnerId);\n        const partner = idx !== -1 ? prev[idx].partner : pendingPartner;\n        if (!partner) return prev;\n        const updated: ConversationSummary = {\n          partnerId,\n          partner,\n          lastMessage: message.text,\n          lastMessageAt: message.createdAt,\n          unreadCount: 0,\n        };\n        if (idx === -1) return [updated, ...prev];\n        const next = [...prev];\n        next[idx] = updated;\n        return next;\n      });\n    } catch (err: any) {\n      showToast({ type: 'info', title: 'Message not sent', message: err.message || 'Please try again.' });\n    }\n  };",
    "      setConversations((prev) => {\n        const idx = prev.findIndex((c) => c.partnerId === partnerId);\n        const partner = idx !== -1 ? prev[idx].partner : pendingPartner;\n        if (!partner) return prev;\n        const updated: ConversationSummary = {\n          partnerId,\n          partner,\n          lastMessage: message.text,\n          lastMessageAt: message.createdAt,\n          unreadCount: 0,\n        };\n        if (idx === -1) return [updated, ...prev];\n        const next = [...prev];\n        next[idx] = updated;\n        return next;\n      });\n      return true;\n    } catch (err: any) {\n      showToast({ type: 'info', title: 'Message not sent', message: err.message || 'Please try again.' });\n      return false;\n    }\n  };",
    'app message outcome',
)
p.write_text(s)


# --- Workspace API: export without navigating away, surface HTTP failures ---
p = Path('src/api/workspaces.ts')
s = p.read_text()
s = replace_once(
    s,
    "export function downloadWorkspaceAuditCsv(): void {\n  window.location.assign('/api/workspaces/audit.csv');\n}\n",
    "async function downloadWorkspaceFile(url: string, fallbackName: string): Promise<void> {\n  const res = await fetch(url, { credentials: 'include' });\n  if (!res.ok) {\n    let message = `Workspace export failed (HTTP ${res.status})`;\n    try {\n      const data = await res.json();\n      if (data?.error) message = String(data.error);\n    } catch {}\n    throw new Error(message);\n  }\n  const blob = await res.blob();\n  const objectUrl = URL.createObjectURL(blob);\n  const link = document.createElement('a');\n  const disposition = res.headers.get('content-disposition') || '';\n  const match = disposition.match(/filename\\*?=(?:UTF-8''|\")?([^\";]+)/i);\n  link.href = objectUrl;\n  link.download = match ? decodeURIComponent(match[1].replace(/\"/g, '').trim()) : fallbackName;\n  document.body.appendChild(link);\n  link.click();\n  link.remove();\n  URL.revokeObjectURL(objectUrl);\n}\n\nexport function downloadWorkspaceAuditCsv(): Promise<void> {\n  return downloadWorkspaceFile('/api/workspaces/audit.csv', 'conferencegate-workspace-audit.csv');\n}\n",
    'workspace audit export',
)
s = replace_once(
    s,
    "export function downloadWorkspaceDataJson(): void {\n  window.location.assign('/api/workspaces/data-export.json');\n}\n",
    "export function downloadWorkspaceDataJson(): Promise<void> {\n  return downloadWorkspaceFile('/api/workspaces/data-export.json', 'conferencegate-workspace-data.json');\n}\n",
    'workspace data export',
)
s = replace_once(
    s,
    "export function downloadWorkspaceEnterpriseReportCsv(): void {\n  window.location.assign('/api/workspaces/enterprise-report.csv');\n}",
    "export function downloadWorkspaceEnterpriseReportCsv(): Promise<void> {\n  return downloadWorkspaceFile('/api/workspaces/enterprise-report.csv', 'conferencegate-enterprise-report.csv');\n}",
    'workspace report export',
)
p.write_text(s)


# --- WorkspaceTeamPanel: visible result feedback, guarded destructive action, export state ---
p = Path('src/components/WorkspaceTeamPanel.tsx')
s = p.read_text()
s = replace_once(
    s,
    "  const [enterpriseReportLoading, setEnterpriseReportLoading] = useState(false);",
    "  const [enterpriseReportLoading, setEnterpriseReportLoading] = useState(false);\n  const [exportingKey, setExportingKey] = useState<'audit' | 'data' | 'report' | null>(null);",
    'workspace export state',
)
s = replace_once(
    s,
    "  const changeRole = async (userId: string, role: 'admin' | 'member' | 'viewer') => {\n    setBusyUserId(userId);\n    setError(null);\n    try {\n      setWorkspace(await updateWorkspaceMemberRole(userId, role));\n    } catch (err: any) {",
    "  const changeRole = async (userId: string, role: 'admin' | 'member' | 'viewer') => {\n    setBusyUserId(userId);\n    setError(null);\n    try {\n      const updated = await updateWorkspaceMemberRole(userId, role);\n      setWorkspace(updated);\n      const member = updated.members.find((item) => item.id === userId);\n      showToast({\n        type: 'success',\n        title: 'Workspace role updated',\n        message: `${member?.name || 'Team member'} is now ${role}.`,\n      });\n    } catch (err: any) {",
    'workspace role feedback',
)
s = replace_once(
    s,
    "  const removeMember = async (userId: string) => {\n    setBusyUserId(userId);\n    setError(null);\n    try {\n      setWorkspace(await removeWorkspaceMember(userId));\n      await refreshActivation();\n    } catch (err: any) {",
    "  const removeMember = async (userId: string) => {\n    const member = workspace?.members.find((item) => item.id === userId);\n    const confirmed = window.confirm(`Remove ${member?.name || 'this team member'} from the paid workspace? Their ConferenceGate account will remain active.`);\n    if (!confirmed) return;\n    setBusyUserId(userId);\n    setError(null);\n    try {\n      setWorkspace(await removeWorkspaceMember(userId));\n      await refreshActivation();\n      showToast({\n        type: 'success',\n        title: 'Team member removed',\n        message: `${member?.name || 'The team member'} no longer has access to this paid workspace.`,\n      });\n    } catch (err: any) {",
    'workspace removal guard',
)
marker = "  if (loading) {"
export_helper = """  const runExport = async (key: 'audit' | 'data' | 'report', action: () => Promise<void>) => {\n    if (exportingKey) return;\n    setExportingKey(key);\n    setError(null);\n    try {\n      await action();\n      showToast({ type: 'success', title: 'Export ready', message: 'The workspace export was generated successfully.' });\n    } catch (err: any) {\n      const message = err?.message || 'Could not generate the workspace export.';\n      setError(message);\n      showToast({ type: 'info', title: 'Export failed', message });\n    } finally {\n      setExportingKey(null);\n    }\n  };\n\n"""
s = replace_once(s, marker, export_helper + marker, 'workspace export helper')
s = replace_once(
    s,
    "                  onClick={downloadWorkspaceAuditCsv}\n                  className=\"px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-[10px] font-bold text-slate-700 flex items-center gap-1.5 cursor-pointer\"",
    "                  onClick={() => runExport('audit', downloadWorkspaceAuditCsv)}\n                  disabled={exportingKey !== null}\n                  className=\"px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-[10px] font-bold text-slate-700 flex items-center gap-1.5 cursor-pointer disabled:opacity-50\"",
    'workspace audit button',
)
s = replace_once(
    s,
    "                  onClick={downloadWorkspaceDataJson}\n                  className=\"px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-[10px] font-bold text-slate-700 flex items-center gap-1.5 cursor-pointer\"",
    "                  onClick={() => runExport('data', downloadWorkspaceDataJson)}\n                  disabled={exportingKey !== null}\n                  className=\"px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-[10px] font-bold text-slate-700 flex items-center gap-1.5 cursor-pointer disabled:opacity-50\"",
    'workspace data button',
)
s = replace_once(
    s,
    "                  onClick={downloadWorkspaceEnterpriseReportCsv}\n                  className=\"px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-[10px] font-bold text-slate-700 flex items-center gap-1.5 cursor-pointer\"",
    "                  onClick={() => runExport('report', downloadWorkspaceEnterpriseReportCsv)}\n                  disabled={exportingKey !== null}\n                  className=\"px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-[10px] font-bold text-slate-700 flex items-center gap-1.5 cursor-pointer disabled:opacity-50\"",
    'workspace report button',
)
p.write_text(s)
