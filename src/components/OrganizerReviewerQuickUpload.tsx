import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileUp, Upload } from 'lucide-react';
import type { AbstractSubmission } from '../types';
import { uploadSubmissionDocument } from '../api/professionalTrust';

interface OrganizerReviewerQuickUploadProps {
  submissions: AbstractSubmission[];
}

export const OrganizerReviewerQuickUpload: React.FC<OrganizerReviewerQuickUploadProps> = ({ submissions }) => {
  const [submissionId, setSubmissionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lastFile, setLastFile] = useState<string | null>(null);

  useEffect(() => {
    if (!submissionId && submissions[0]) setSubmissionId(submissions[0].id);
    if (submissionId && !submissions.some((submission) => submission.id === submissionId)) {
      setSubmissionId(submissions[0]?.id || '');
    }
  }, [submissionId, submissions]);

  const selectedSubmission = useMemo(
    () => submissions.find((submission) => submission.id === submissionId) || null,
    [submissionId, submissions]
  );

  const upload = async (file?: File) => {
    if (!file || !selectedSubmission || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await uploadSubmissionDocument(selectedSubmission.id, 'author_original', file);
      setLastFile(file.name);
      setMessage('Uploaded securely. Any assigned reviewers are notified and can download it from their Reviewer Portal.');
    } catch (error: any) {
      setMessage(error?.message || 'Could not upload the review file.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-blue-200 bg-white p-3 space-y-3">
      <div className="flex items-start gap-2">
        <FileUp className="w-4 h-4 text-blue-700 mt-0.5 shrink-0" />
        <div>
          <div className="text-xs font-bold text-slate-900">Place a file for reviewers</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Choose the submitted abstract, then upload the PDF, DOC or DOCX that reviewers should work on.</div>
        </div>
      </div>

      {submissions.length > 0 ? (
        <div className="flex flex-col lg:flex-row gap-2 lg:items-center">
          <select
            value={submissionId}
            onChange={(event) => {
              setSubmissionId(event.target.value);
              setMessage(null);
              setLastFile(null);
            }}
            className="flex-1 min-w-0 px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
            aria-label="Select submitted abstract for reviewer file"
          >
            {submissions.map((submission) => (
              <option key={submission.id} value={submission.id}>
                {submission.title} — {submission.primaryAuthor?.name || 'Author'}
              </option>
            ))}
          </select>

          <label className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-900 hover:bg-blue-950 text-white text-[11px] font-bold cursor-pointer shrink-0 ${busy ? 'opacity-60 pointer-events-none' : ''}`}>
            <Upload className="w-4 h-4" />
            {busy ? 'Uploading…' : 'Add Review File'}
            <input
              type="file"
              disabled={busy}
              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(event) => {
                void upload(event.target.files?.[0]);
                event.currentTarget.value = '';
              }}
            />
          </label>
        </div>
      ) : (
        <div className="px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[10px] text-slate-500">
          No submitted abstracts are available yet. Once an author submits, the organizer can place the review file here.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] text-slate-500">
        <span>PDF / DOC / DOCX</span>
        <span>Maximum 5 MB</span>
        {lastFile && <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold"><CheckCircle2 className="w-3 h-3" />{lastFile}</span>}
      </div>
      {message && <div className="text-[10px] font-semibold text-blue-800">{message}</div>}
    </div>
  );
};

export default OrganizerReviewerQuickUpload;
