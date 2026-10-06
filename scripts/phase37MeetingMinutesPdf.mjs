import fs from 'fs';

function replaceOrFail(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`Missing patch anchor: ${label}`);
  return text.replace(from, to);
}

// Mount the dedicated PDF/email router.
{
  const file = 'server.ts';
  let text = fs.readFileSync(file, 'utf8');
  text = replaceOrFail(
    text,
    'import { activityRouter } from "./server/activity";\n',
    'import { activityRouter } from "./server/activity";\nimport { meetingMinutesPdfRouter } from "./server/meetingMinutesPdf";\n',
    'server import'
  );
  text = replaceOrFail(
    text,
    '  app.use("/api/activity", activityRouter);\n',
    '  app.use("/api/activity", activityRouter);\n\n  // Branded PDF meeting minutes, all-member email delivery, and Gmail handoff.\n  app.use("/api/meeting-minutes", meetingMinutesPdfRouter);\n',
    'server router mount'
  );
  fs.writeFileSync(file, text);
}

// Upgrade the Meeting Minutes UI from Word-first to PDF-first and add all-member email/Gmail actions.
{
  const file = 'src/components/MeetingMinutesPanel.tsx';
  let text = fs.readFileSync(file, 'utf8');

  text = replaceOrFail(
    text,
    "import { Download, FileText, Mail, Plus, Send, Trash2, Users } from 'lucide-react';",
    "import { Download, FileDown, FileText, Mail, Plus, Send, Trash2, Users } from 'lucide-react';",
    'icons'
  );
  text = replaceOrFail(
    text,
    "import { useToast } from './Toast';",
    "import { useToast } from './Toast';\nimport { downloadMeetingMinutesPdf, fetchMeetingMinutesGmailDraft, sendMeetingMinutesPdfToMembers } from '../api/meetingMinutesPdf';",
    'pdf client imports'
  );
  text = replaceOrFail(
    text,
    "  distributionGroups: ['committee'] as string[],",
    "  distributionGroups: ['members', 'reviewers'] as string[],",
    'default groups'
  );
  text = replaceOrFail(
    text,
    "  sendEmail: false,",
    "  sendEmail: true,",
    'default email'
  );
  text = replaceOrFail(
    text,
    "  const [distributingId, setDistributingId] = useState<string | null>(null);\n",
    "  const [distributingId, setDistributingId] = useState<string | null>(null);\n  const [sendingPdfId, setSendingPdfId] = useState<string | null>(null);\n",
    'pdf send state'
  );
  text = replaceOrFail(
    text,
    "      return;\n    }\n    setSaving(true);",
    "      return null;\n    }\n    setSaving(true);",
    'save validation return'
  );
  text = replaceOrFail(
    text,
    "        showToast({ type: 'success', title: 'Meeting minutes saved', message: 'The minutes are now an organizer workspace record and can be downloaded as Word.' });",
    "        showToast({ type: 'success', title: 'Meeting minutes saved', message: 'The minutes are now an organizer workspace record and can be downloaded as a branded PDF.' });",
    'save toast'
  );
  text = replaceOrFail(
    text,
    "      setDraft((prev) => ({ ...initialDraft(), conferenceId: prev.conferenceId, conferenceTitle: prev.conferenceTitle, organizerTimezone: prev.organizerTimezone }));\n    } catch (error) {",
    "      setDraft((prev) => ({ ...initialDraft(), conferenceId: prev.conferenceId, conferenceTitle: prev.conferenceTitle, organizerTimezone: prev.organizerTimezone }));\n      return saved;\n    } catch (error) {",
    'save return saved'
  );
  text = replaceOrFail(
    text,
    "      showToast({ type: 'info', title: 'Could not save meeting minutes', message: error instanceof Error ? error.message : 'Please try again.' });\n    } finally {",
    "      showToast({ type: 'info', title: 'Could not save meeting minutes', message: error instanceof Error ? error.message : 'Please try again.' });\n      return null;\n    } finally {",
    'save return error'
  );

  const oldDownloadBlock = `  const downloadMinutes = async (item: OrganizerMeetingMinutes) => {\n    try {\n      const blob = await downloadOrganizerMeetingMinutesDocument(item.id);\n      const url = URL.createObjectURL(blob);\n      const link = document.createElement('a');\n      link.href = url;\n      link.download = \`${'${item.title.replace(/[^a-z0-9]+/gi, \'-\').replace(/^-|-$/g, \'\') || \'meeting-minutes\'}'}-${'${item.date}'}.docx\`;\n      document.body.appendChild(link);\n      link.click();\n      link.remove();\n      URL.revokeObjectURL(url);\n    } catch (error) {\n      showToast({ type: 'info', title: 'Could not generate Word document', message: error instanceof Error ? error.message : 'Please try again.' });\n    }\n  };`;

  const newDownloadBlock = `  const downloadPdf = async (item: OrganizerMeetingMinutes) => {\n    try {\n      const blob = await downloadMeetingMinutesPdf(item.id);\n      const url = URL.createObjectURL(blob);\n      const link = document.createElement('a');\n      link.href = url;\n      link.download = \`${'${item.title.replace(/[^a-z0-9]+/gi, \'-\').replace(/^-|-$/g, \'\') || \'meeting-minutes\'}'}-${'${item.date}'}.pdf\`;\n      document.body.appendChild(link);\n      link.click();\n      link.remove();\n      URL.revokeObjectURL(url);\n    } catch (error) {\n      showToast({ type: 'info', title: 'Could not generate PDF', message: error instanceof Error ? error.message : 'Please try again.' });\n    }\n  };\n\n  const sendPdfToAllMembers = async (item: OrganizerMeetingMinutes, extraEmails: string[] = item.externalEmails) => {\n    setSendingPdfId(item.id);\n    try {\n      const result = await sendMeetingMinutesPdfToMembers(item.id, extraEmails);\n      if (!result.emailConfigured) {\n        showToast({\n          type: 'info',\n          title: 'Email sender needs configuration',\n          message: \`${'${result.recipientCount}'} member email${'${result.recipientCount === 1 ? \'\' : \'s\'}'} found. Use Open Gmail now, or configure the ConferenceGate email sender for one-click delivery.\`,\n        });\n        return;\n      }\n      setMinutes((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, distributedAt: result.distributedAt || entry.distributedAt, sendEmail: true } : entry));\n      showToast({\n        type: 'success',\n        title: 'PDF meeting minutes sent',\n        message: \`${'${result.emailSentCount}'} of ${'${result.recipientCount}'} member email${'${result.recipientCount === 1 ? \'\' : \'s\'}'} sent with the branded PDF attached${'${result.emailFailedCount ? `; ${result.emailFailedCount} failed` : \'\'}'}.\`,\n      });\n    } catch (error) {\n      showToast({ type: 'info', title: 'Could not send PDF', message: error instanceof Error ? error.message : 'Please try again.' });\n    } finally {\n      setSendingPdfId(null);\n    }\n  };\n\n  const openInGmail = async (item: OrganizerMeetingMinutes) => {\n    try {\n      await downloadPdf(item);\n      const draft = await fetchMeetingMinutesGmailDraft(item.id);\n      if (!draft.recipients.length) {\n        showToast({ type: 'info', title: 'No member emails found', message: 'Add conference members or additional recipient emails first.' });\n        return;\n      }\n      const params = new URLSearchParams({\n        view: 'cm',\n        fs: '1',\n        bcc: draft.recipients.join(','),\n        su: draft.subject,\n        body: draft.body,\n      });\n      window.open(\`https://mail.google.com/mail/?${'${params.toString()}'}\`, '_blank', 'noopener,noreferrer');\n      showToast({\n        type: 'success',\n        title: 'Gmail prepared',\n        message: \`Gmail opened with ${'${draft.recipientCount}'} member email${'${draft.recipientCount === 1 ? \'\' : \'s\'}'} in BCC and the PDF downloaded. Gmail browser security requires you to attach that downloaded PDF before pressing Send.\`,\n      });\n    } catch (error) {\n      showToast({ type: 'info', title: 'Could not prepare Gmail', message: error instanceof Error ? error.message : 'Please try again.' });\n    }\n  };`;
  text = replaceOrFail(text, oldDownloadBlock, newDownloadBlock, 'download/send/gmail handlers');

  text = replaceOrFail(
    text,
    '            Record the official summary, decisions and actions after a committee meeting. ConferenceGate generates a branded Word document and can distribute it to conference members by in-app notification and email.',
    '            Record the official summary, decisions and actions after a committee meeting. ConferenceGate generates a branded PDF and can send it to all conference-member emails or prepare a Gmail message with the recipients already added.',
    'header description'
  );
  text = replaceOrFail(
    text,
    'Each action appears as a structured table in the Word minutes.',
    'Each action appears as a structured section in the branded PDF minutes.',
    'action text'
  );
  text = replaceOrFail(
    text,
    '<Mail className="w-3.5 h-3.5" /> Email branded Word attachment',
    '<Mail className="w-3.5 h-3.5" /> Email branded PDF attachment',
    'email label'
  );
  text = replaceOrFail(
    text,
    '      <div className="flex flex-col sm:flex-row gap-3">\n        <button type="button" disabled={saving} onClick={() => saveMinutes(false)} className="px-5 py-3 rounded-xl border border-blue-200 text-blue-800 font-bold text-xs cursor-pointer disabled:opacity-50">{saving ? \'Saving…\' : \'Save Minutes\'}</button>\n        <button type="button" disabled={saving} onClick={() => saveMinutes(true)} className="px-5 py-3 rounded-xl bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"><Send className="w-4 h-4" /> Save & Distribute</button>\n      </div>',
    '      <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4 space-y-3">\n        <div>\n          <div className="text-xs font-bold text-slate-900">PDF & member delivery</div>\n          <p className="text-[10px] text-slate-500 mt-1">Save the exact content above as an official ConferenceGate-branded PDF. One-click email delivery automatically resolves all stored conference members, accepted committee/chair/speaker roles, assigned reviewers and abstract submitters, then sends each recipient the PDF privately.</p>\n        </div>\n        <div className="flex flex-col sm:flex-row flex-wrap gap-3">\n          <button type="button" disabled={saving} onClick={() => saveMinutes(false)} className="px-5 py-3 rounded-xl border border-blue-200 text-blue-800 font-bold text-xs cursor-pointer disabled:opacity-50">{saving ? \'Saving…\' : \'Save Minutes\'}</button>\n          <button type="button" disabled={saving} onClick={async () => { const saved = await saveMinutes(false); if (saved) await downloadPdf(saved); }} className="px-5 py-3 rounded-xl border border-blue-300 bg-white text-blue-800 font-bold text-xs cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"><FileDown className="w-4 h-4" /> Save as PDF</button>\n          <button type="button" disabled={saving} onClick={async () => { const saved = await saveMinutes(false); if (saved) await sendPdfToAllMembers(saved, saved.externalEmails); }} className="px-5 py-3 rounded-xl bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"><Send className="w-4 h-4" /> Save & Send PDF to All Members</button>\n        </div>\n      </div>',
    'primary actions'
  );

  text = replaceOrFail(
    text,
    '            <div className="flex gap-2 shrink-0">\n              <button type="button" onClick={() => downloadMinutes(item)} className="px-3 py-2 rounded-lg border border-slate-200 text-blue-700 text-[10px] font-bold flex items-center gap-1 cursor-pointer"><Download className="w-3.5 h-3.5" /> Word</button>\n              <button type="button" disabled={distributingId === item.id} onClick={() => redistribute(item)} className="px-3 py-2 rounded-lg bg-blue-900 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"><Send className="w-3.5 h-3.5" /> {distributingId === item.id ? \'Sending…\' : \'Distribute\'}</button>\n            </div>',
    '            <div className="flex flex-wrap gap-2 shrink-0">\n              <button type="button" onClick={() => downloadPdf(item)} className="px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-800 text-[10px] font-bold flex items-center gap-1 cursor-pointer"><Download className="w-3.5 h-3.5" /> PDF</button>\n              <button type="button" onClick={() => openInGmail(item)} className="px-3 py-2 rounded-lg border border-slate-200 text-slate-700 text-[10px] font-bold flex items-center gap-1 cursor-pointer"><Mail className="w-3.5 h-3.5" /> Open Gmail</button>\n              <button type="button" disabled={sendingPdfId === item.id} onClick={() => sendPdfToAllMembers(item)} className="px-3 py-2 rounded-lg bg-blue-900 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"><Send className="w-3.5 h-3.5" /> {sendingPdfId === item.id ? \'Sending PDF…\' : \'Send PDF to Members\'}</button>\n              <button type="button" disabled={distributingId === item.id} onClick={() => redistribute(item)} className="px-3 py-2 rounded-lg border border-slate-200 text-blue-700 text-[10px] font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"><Users className="w-3.5 h-3.5" /> {distributingId === item.id ? \'Notifying…\' : \'Notify In-App\'}</button>\n            </div>',
    'saved actions'
  );

  // The Word API remains available for backward compatibility, but is no longer imported by this UI.
  text = text.replace('  downloadOrganizerMeetingMinutesDocument,\n', '');
  fs.writeFileSync(file, text);
}
