import React, { useEffect, useMemo, useState } from 'react';
import { Download, FileText, Mail, Plus, Send, Trash2, Users } from 'lucide-react';
import { Conference } from '../types';
import {
  OrganizerMeetingPlan,
  OrganizerMeetingMinuteActionItem,
  OrganizerMeetingMinutes,
  createOrganizerMeetingMinutes,
  distributeOrganizerMeetingMinutes,
  downloadOrganizerMeetingMinutesDocument,
  fetchOrganizerMeetingMinutes,
} from '../api/activity';
import { useToast } from './Toast';

interface MeetingMinutesPanelProps {
  conferences: Conference[];
  meetings: OrganizerMeetingPlan[];
}

const blankAction = (): OrganizerMeetingMinuteActionItem => ({ action: '', owner: '', dueDate: '', status: 'Open' });

const initialDraft = () => ({
  meetingPlanId: '',
  conferenceId: '',
  conferenceTitle: '',
  title: '',
  date: '',
  time: '',
  organizerTimezone: 'Europe/London',
  chairName: '',
  preparedBy: '',
  attendees: '',
  objectives: '',
  agenda: '',
  discussionSummary: '',
  keyDecisions: '',
  actionItems: [blankAction()],
  risksIssues: '',
  nextSteps: '',
  nextMeetingDate: '',
  notes: '',
  distributionGroups: ['committee'] as string[],
  externalEmails: '',
  notifyInApp: true,
  sendEmail: false,
});

export const MeetingMinutesPanel: React.FC<MeetingMinutesPanelProps> = ({ conferences, meetings }) => {
  const [minutes, setMinutes] = useState<OrganizerMeetingMinutes[]>([]);
  const [draft, setDraft] = useState(initialDraft);
  const [saving, setSaving] = useState(false);
  const [distributingId, setDistributingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();

  useEffect(() => {
    fetchOrganizerMeetingMinutes()
      .then(setMinutes)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!draft.conferenceId && conferences[0]) {
      setDraft((prev) => ({ ...prev, conferenceId: conferences[0].id, conferenceTitle: conferences[0].title }));
    }
  }, [conferences, draft.conferenceId]);

  const selectedMeeting = useMemo(
    () => meetings.find((meeting) => meeting.id === draft.meetingPlanId),
    [meetings, draft.meetingPlanId]
  );

  const chooseMeeting = (meetingPlanId: string) => {
    const meeting = meetings.find((item) => item.id === meetingPlanId);
    if (!meeting) {
      setDraft((prev) => ({ ...prev, meetingPlanId: '' }));
      return;
    }
    setDraft((prev) => ({
      ...prev,
      meetingPlanId,
      title: meeting.title,
      date: meeting.date,
      time: meeting.time,
      organizerTimezone: meeting.organizerTimezone,
      attendees: meeting.attendees.join(', '),
    }));
  };

  const chooseConference = (conferenceId: string) => {
    const conference = conferences.find((item) => item.id === conferenceId);
    setDraft((prev) => ({
      ...prev,
      conferenceId,
      conferenceTitle: conference?.title || '',
    }));
  };

  const toggleGroup = (group: string) => {
    setDraft((prev) => ({
      ...prev,
      distributionGroups: prev.distributionGroups.includes(group)
        ? prev.distributionGroups.filter((item) => item !== group)
        : [...prev.distributionGroups, group],
    }));
  };

  const updateAction = (index: number, patch: Partial<OrganizerMeetingMinuteActionItem>) => {
    setDraft((prev) => ({
      ...prev,
      actionItems: prev.actionItems.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    }));
  };

  const removeAction = (index: number) => {
    setDraft((prev) => ({ ...prev, actionItems: prev.actionItems.filter((_, itemIndex) => itemIndex !== index) }));
  };

  const payloadFromDraft = () => ({
    meetingPlanId: draft.meetingPlanId || null,
    conferenceId: draft.conferenceId,
    conferenceTitle: draft.conferenceTitle,
    title: draft.title.trim(),
    date: draft.date,
    time: draft.time,
    organizerTimezone: draft.organizerTimezone,
    chairName: draft.chairName.trim(),
    preparedBy: draft.preparedBy.trim(),
    attendees: draft.attendees.split(',').map((item) => item.trim()).filter(Boolean),
    objectives: draft.objectives.trim(),
    agenda: draft.agenda.trim(),
    discussionSummary: draft.discussionSummary.trim(),
    keyDecisions: draft.keyDecisions.trim(),
    actionItems: draft.actionItems.filter((item) => item.action.trim()).map((item) => ({ ...item, action: item.action.trim(), owner: item.owner.trim() })),
    risksIssues: draft.risksIssues.trim(),
    nextSteps: draft.nextSteps.trim(),
    nextMeetingDate: draft.nextMeetingDate,
    notes: draft.notes.trim(),
    distributionGroups: draft.distributionGroups,
    externalEmails: draft.externalEmails.split(',').map((item) => item.trim()).filter(Boolean),
    notifyInApp: draft.notifyInApp,
    sendEmail: draft.sendEmail,
  });

  const saveMinutes = async (distributeAfterSave: boolean) => {
    if (!draft.conferenceId || !draft.title.trim() || !draft.date) {
      showToast({ type: 'info', title: 'Complete meeting details', message: 'Conference, meeting title, and date are required.' });
      return;
    }
    setSaving(true);
    try {
      const saved = await createOrganizerMeetingMinutes(payloadFromDraft());
      setMinutes((prev) => [saved, ...prev]);
      if (distributeAfterSave) {
        const result = await distributeOrganizerMeetingMinutes(saved.id, {
          distributionGroups: draft.distributionGroups,
          externalEmails: draft.externalEmails.split(',').map((item) => item.trim()).filter(Boolean),
          notifyInApp: draft.notifyInApp,
          sendEmail: draft.sendEmail,
        });
        setMinutes((prev) => prev.map((item) => item.id === saved.id ? { ...item, distributedAt: result.distributedAt } : item));
        const emailText = draft.sendEmail
          ? result.emailConfigured
            ? ` ${result.emailSentCount} email${result.emailSentCount === 1 ? '' : 's'} sent.`
            : ' Email delivery is not configured, so only ConferenceGate notifications were sent.'
          : '';
        showToast({
          type: 'success',
          title: 'Minutes saved and distributed',
          message: `${result.notifiedCount} ConferenceGate member notification${result.notifiedCount === 1 ? '' : 's'} sent.${emailText}`,
        });
      } else {
        showToast({ type: 'success', title: 'Meeting minutes saved', message: 'The minutes are now an organizer workspace record and can be downloaded as Word.' });
      }
      setDraft((prev) => ({ ...initialDraft(), conferenceId: prev.conferenceId, conferenceTitle: prev.conferenceTitle, organizerTimezone: prev.organizerTimezone }));
    } catch (error) {
      showToast({ type: 'info', title: 'Could not save meeting minutes', message: error instanceof Error ? error.message : 'Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  const downloadMinutes = async (item: OrganizerMeetingMinutes) => {
    try {
      const blob = await downloadOrganizerMeetingMinutesDocument(item.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${item.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'meeting-minutes'}-${item.date}.docx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      showToast({ type: 'info', title: 'Could not generate Word document', message: error instanceof Error ? error.message : 'Please try again.' });
    }
  };

  const redistribute = async (item: OrganizerMeetingMinutes) => {
    setDistributingId(item.id);
    try {
      const result = await distributeOrganizerMeetingMinutes(item.id, {
        distributionGroups: item.distributionGroups,
        externalEmails: item.externalEmails,
        notifyInApp: item.notifyInApp,
        sendEmail: item.sendEmail,
      });
      setMinutes((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, distributedAt: result.distributedAt } : entry));
      showToast({
        type: 'success',
        title: 'Meeting minutes distributed',
        message: `${result.notifiedCount} in-app notification${result.notifiedCount === 1 ? '' : 's'} and ${result.emailSentCount} email${result.emailSentCount === 1 ? '' : 's'} sent.`,
      });
    } catch (error) {
      showToast({ type: 'info', title: 'Could not distribute minutes', message: error instanceof Error ? error.message : 'Please try again.' });
    } finally {
      setDistributingId(null);
    }
  };

  const textareaClass = 'w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs min-h-[92px] focus:outline-none focus:ring-2 focus:ring-blue-200';
  const inputClass = 'w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-200';

  return (
    <div className="lg:col-span-2 bg-white rounded-3xl border border-blue-100 p-6 sm:p-8 shadow-xs space-y-6">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider font-extrabold text-blue-600">Organizer Pro · Meeting Governance</div>
          <h2 className="text-xl font-extrabold text-slate-900 mt-1 flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-700" /> Meeting Minutes
          </h2>
          <p className="text-xs text-slate-500 mt-1 max-w-3xl">
            Record the official summary, decisions and actions after a committee meeting. ConferenceGate generates a branded Word document and can distribute it to conference members by in-app notification and email.
          </p>
        </div>
        <img src="/conference-gate-logo.png" alt="ConferenceGate" className="h-12 w-auto object-contain" />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] uppercase font-bold text-slate-500">Use a scheduled meeting</label>
          <select value={draft.meetingPlanId} onChange={(e) => chooseMeeting(e.target.value)} className={inputClass}>
            <option value="">Standalone minutes / select later</option>
            {meetings.map((meeting) => <option key={meeting.id} value={meeting.id}>{meeting.date} · {meeting.title}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] uppercase font-bold text-slate-500">Conference</label>
          <select required value={draft.conferenceId} onChange={(e) => chooseConference(e.target.value)} className={inputClass}>
            <option value="">Select conference...</option>
            {conferences.map((conference) => <option key={conference.id} value={conference.id}>{conference.title}</option>)}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="text-[10px] uppercase font-bold text-slate-500">Meeting title</label>
          <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Technical Committee Meeting — Program Review" className={inputClass} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="text-[10px] uppercase font-bold text-slate-500">Date</label><input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className={inputClass} /></div>
          <div><label className="text-[10px] uppercase font-bold text-slate-500">Time</label><input type="time" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} className={inputClass} /></div>
        </div>
        <div>
          <label className="text-[10px] uppercase font-bold text-slate-500">Timezone</label>
          <input value={draft.organizerTimezone} onChange={(e) => setDraft({ ...draft, organizerTimezone: e.target.value })} placeholder="Europe/London" className={inputClass} />
        </div>
        <input value={draft.chairName} onChange={(e) => setDraft({ ...draft, chairName: e.target.value })} placeholder="Meeting chair" className={inputClass} />
        <input value={draft.preparedBy} onChange={(e) => setDraft({ ...draft, preparedBy: e.target.value })} placeholder="Minutes prepared by" className={inputClass} />
        <input value={draft.attendees} onChange={(e) => setDraft({ ...draft, attendees: e.target.value })} placeholder="Attendees, comma separated" className="md:col-span-2 w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div><label className="text-[10px] uppercase font-bold text-slate-500">Purpose & objectives</label><textarea value={draft.objectives} onChange={(e) => setDraft({ ...draft, objectives: e.target.value })} placeholder="Why the meeting was held and expected outcomes..." className={textareaClass} /></div>
        <div><label className="text-[10px] uppercase font-bold text-slate-500">Agenda / main points</label><textarea value={draft.agenda} onChange={(e) => setDraft({ ...draft, agenda: e.target.value })} placeholder="1. Program status\n2. Abstract review\n3. Sponsorship..." className={textareaClass} /></div>
        <div><label className="text-[10px] uppercase font-bold text-slate-500">Discussion summary</label><textarea value={draft.discussionSummary} onChange={(e) => setDraft({ ...draft, discussionSummary: e.target.value })} placeholder="Concise summary of the discussion..." className={textareaClass} /></div>
        <div><label className="text-[10px] uppercase font-bold text-slate-500">Key decisions</label><textarea value={draft.keyDecisions} onChange={(e) => setDraft({ ...draft, keyDecisions: e.target.value })} placeholder="Decision 1...\nDecision 2..." className={textareaClass} /></div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div><h3 className="text-sm font-bold text-slate-900">Action Items</h3><p className="text-[10px] text-slate-500">Each action appears as a structured table in the Word minutes.</p></div>
          <button type="button" onClick={() => setDraft((prev) => ({ ...prev, actionItems: [...prev.actionItems, blankAction()] }))} className="px-3 py-2 rounded-lg border border-blue-200 text-blue-700 text-xs font-bold flex items-center gap-1 cursor-pointer"><Plus className="w-3.5 h-3.5" /> Add Action</button>
        </div>
        {draft.actionItems.map((item, index) => (
          <div key={index} className="grid grid-cols-1 md:grid-cols-12 gap-2 p-3 rounded-xl border border-slate-200 bg-slate-50/60">
            <input value={item.action} onChange={(e) => updateAction(index, { action: e.target.value })} placeholder="Action / deliverable" className="md:col-span-5 p-2.5 rounded-lg bg-white border border-slate-200 text-xs" />
            <input value={item.owner} onChange={(e) => updateAction(index, { owner: e.target.value })} placeholder="Owner" className="md:col-span-2 p-2.5 rounded-lg bg-white border border-slate-200 text-xs" />
            <input type="date" value={item.dueDate} onChange={(e) => updateAction(index, { dueDate: e.target.value })} className="md:col-span-2 p-2.5 rounded-lg bg-white border border-slate-200 text-xs" />
            <select value={item.status} onChange={(e) => updateAction(index, { status: e.target.value as OrganizerMeetingMinuteActionItem['status'] })} className="md:col-span-2 p-2.5 rounded-lg bg-white border border-slate-200 text-xs"><option>Open</option><option>In Progress</option><option>Done</option></select>
            <button type="button" onClick={() => removeAction(index)} className="md:col-span-1 flex items-center justify-center text-slate-400 hover:text-rose-600 cursor-pointer"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div><label className="text-[10px] uppercase font-bold text-slate-500">Risks / issues</label><textarea value={draft.risksIssues} onChange={(e) => setDraft({ ...draft, risksIssues: e.target.value })} className={textareaClass} /></div>
        <div><label className="text-[10px] uppercase font-bold text-slate-500">Next steps</label><textarea value={draft.nextSteps} onChange={(e) => setDraft({ ...draft, nextSteps: e.target.value })} className={textareaClass} /></div>
        <div className="space-y-2"><label className="text-[10px] uppercase font-bold text-slate-500">Next meeting date</label><input type="date" value={draft.nextMeetingDate} onChange={(e) => setDraft({ ...draft, nextMeetingDate: e.target.value })} className={inputClass} /><textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Additional notes" className={textareaClass} /></div>
      </div>

      <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4 space-y-4">
        <div className="flex items-center gap-2"><Users className="w-4 h-4 text-blue-700" /><h3 className="text-sm font-bold text-slate-900">Distribution</h3></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            ['committee', 'Technical Committee'],
            ['members', 'Conference Members'],
            ['reviewers', 'Reviewers'],
            ['speakers', 'Speakers'],
          ].map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 p-2.5 rounded-xl bg-white border border-blue-100 text-xs font-semibold text-slate-700 cursor-pointer">
              <input type="checkbox" checked={draft.distributionGroups.includes(key)} onChange={() => toggleGroup(key)} className="accent-blue-700" /> {label}
            </label>
          ))}
        </div>
        <input value={draft.externalEmails} onChange={(e) => setDraft({ ...draft, externalEmails: e.target.value })} placeholder="Additional recipient emails, comma separated" className={inputClass} />
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={draft.notifyInApp} onChange={(e) => setDraft({ ...draft, notifyInApp: e.target.checked })} className="accent-blue-700" /> ConferenceGate notifications</label>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={draft.sendEmail} onChange={(e) => setDraft({ ...draft, sendEmail: e.target.checked })} className="accent-blue-700" /> <Mail className="w-3.5 h-3.5" /> Email branded Word attachment</label>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <button type="button" disabled={saving} onClick={() => saveMinutes(false)} className="px-5 py-3 rounded-xl border border-blue-200 text-blue-800 font-bold text-xs cursor-pointer disabled:opacity-50">{saving ? 'Saving…' : 'Save Minutes'}</button>
        <button type="button" disabled={saving} onClick={() => saveMinutes(true)} className="px-5 py-3 rounded-xl bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"><Send className="w-4 h-4" /> Save & Distribute</button>
      </div>

      <div className="border-t border-slate-100 pt-5 space-y-3">
        <div><h3 className="text-sm font-bold text-slate-900">Saved Meeting Minutes</h3><p className="text-[10px] text-slate-500">Official records saved to this Organizer workspace.</p></div>
        {loading ? (
          <div className="text-xs text-slate-400">Loading meeting minutes…</div>
        ) : minutes.length === 0 ? (
          <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-400">No meeting minutes have been recorded yet.</div>
        ) : minutes.map((item) => (
          <div key={item.id} className="p-4 rounded-2xl border border-slate-200 bg-white flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="min-w-0"><div className="font-bold text-xs text-slate-900">{item.title}</div><div className="text-[10px] text-slate-500 mt-1">{item.conferenceTitle} · {item.date}{item.distributedAt ? ` · Distributed ${item.distributedAt}` : ' · Not distributed yet'}</div></div>
            <div className="flex gap-2 shrink-0">
              <button type="button" onClick={() => downloadMinutes(item)} className="px-3 py-2 rounded-lg border border-slate-200 text-blue-700 text-[10px] font-bold flex items-center gap-1 cursor-pointer"><Download className="w-3.5 h-3.5" /> Word</button>
              <button type="button" disabled={distributingId === item.id} onClick={() => redistribute(item)} className="px-3 py-2 rounded-lg bg-blue-900 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"><Send className="w-3.5 h-3.5" /> {distributingId === item.id ? 'Sending…' : 'Distribute'}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MeetingMinutesPanel;
