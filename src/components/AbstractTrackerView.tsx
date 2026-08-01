import React, { useState } from 'react';
import {
  FileText,
  Clock,
  CheckCircle2,
  AlertCircle,
  Award,
  ChevronRight,
  MessageSquare,
  Edit3,
  Plus,
  Send,
} from 'lucide-react';
import { AbstractSubmission } from '../types';

interface AbstractTrackerViewProps {
  submissions: AbstractSubmission[];
  onOpenNewSubmission: () => void;
}

export const AbstractTrackerView: React.FC<AbstractTrackerViewProps> = ({
  submissions,
  onOpenNewSubmission,
}) => {
  const [selectedSubId, setSelectedSubId] = useState<string>(
    submissions[0]?.id || ''
  );
  const [revisionText, setRevisionText] = useState('');
  const [revisionSuccess, setRevisionTextSuccess] = useState(false);

  const currentSub = submissions.find((s) => s.id === selectedSubId) || submissions[0];

  const handleSendRevision = (e: React.FormEvent) => {
    e.preventDefault();
    if (!revisionText.trim()) return;
    setRevisionTextSuccess(true);
    setRevisionText('');
    setTimeout(() => setRevisionTextSuccess(false), 4000);
  };

  return (
    <div className="space-y-8">
      {/* Top Title Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-blue-600">
            Author Portal & Peer Review
          </span>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight mt-1">
            My Abstract Submissions & Real-Time Status
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Track reviewer assignments, screening progress, decision letters, and revision responses.
          </p>
        </div>

        <button
          onClick={onOpenNewSubmission}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-2 transition-colors cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Submit New Abstract</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Submissions Sidebar */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 px-1">
            Submitted Abstracts ({submissions.length})
          </h3>
          <div className="space-y-3">
            {(submissions || []).map((sub) => (
              <div
                key={sub.id}
                onClick={() => setSelectedSubId(sub.id)}
                className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                  selectedSubId === sub.id
                    ? 'bg-blue-50/70 border-blue-500 shadow-xs ring-1 ring-blue-500/30'
                    : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
                    {sub.preferredType} Presentation
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                      sub.status.includes('Accepted')
                        ? 'bg-emerald-100 text-emerald-800'
                        : sub.status === 'Under Review'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-blue-100 text-blue-800'
                    }`}
                  >
                    {sub.status}
                  </span>
                </div>
                <h4 className="font-bold text-xs text-slate-900 leading-snug line-clamp-2">
                  {sub.title}
                </h4>
                <div className="text-[11px] text-slate-500 mt-2 line-clamp-1">
                  {sub.conferenceTitle}
                </div>
                <div className="text-[10px] text-slate-400 mt-1">
                  Submitted on {sub.submissionDate}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Submission Detail & Real-Time Status Timeline */}
        {currentSub && (
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-6">
              {/* Header Info */}
              <div className="space-y-2 pb-6 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 bg-blue-100 text-blue-800 font-bold text-[10px] rounded-md uppercase">
                    {currentSub.track}
                  </span>
                  <span className="text-xs text-slate-400">•</span>
                  <span className="text-xs text-slate-600 font-medium">
                    {currentSub.conferenceTitle}
                  </span>
                </div>
                <h2 className="text-xl font-bold text-slate-900 leading-snug">
                  {currentSub.title}
                </h2>
                <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 pt-1">
                  <span>
                    Primary Author: <strong className="text-slate-800">{currentSub.primaryAuthor.name}</strong> ({currentSub.primaryAuthor.affiliation})
                  </span>
                  {currentSub.coAuthors && currentSub.coAuthors.length > 0 && (
                    <span>
                      Co-Authors: <strong className="text-slate-800">{(currentSub.coAuthors || []).map((ca) => ca.name).join(', ')}</strong>
                    </span>
                  )}
                </div>
              </div>

              {/* Real-time Status Visual Timeline */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  Real-time Peer Review Timeline
                </h3>
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between overflow-x-auto gap-2">
                  {(currentSub.visualTimeline || []).map((step, i) => (
                    <div key={i} className="flex items-center gap-2 text-center shrink-0">
                      <div className="flex flex-col items-center gap-1">
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                            step.status === 'completed'
                              ? 'bg-emerald-600 text-white'
                              : step.status === 'current'
                              ? 'bg-blue-600 text-white ring-4 ring-blue-100 animate-pulse'
                              : 'bg-slate-200 text-slate-500'
                          }`}
                        >
                          {step.status === 'completed' ? '✓' : i + 1}
                        </div>
                        <span className="text-[10px] font-bold text-slate-800 max-w-[80px]">
                          {step.label}
                        </span>
                        {step.date && (
                          <span className="text-[9px] text-slate-400">{step.date}</span>
                        )}
                      </div>
                      {i < currentSub.visualTimeline.length - 1 && (
                        <div
                          className={`h-0.5 w-8 sm:w-12 ${
                            step.status === 'completed' ? 'bg-emerald-500' : 'bg-slate-200'
                          }`}
                        ></div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Abstract Text */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  Submitted Abstract Text
                </h4>
                <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-200 whitespace-pre-wrap">
                  {currentSub.abstractText}
                </p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {(currentSub.keywords || []).map((kw, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md text-[10px] font-semibold"
                    >
                      #{kw}
                    </span>
                  ))}
                </div>
              </div>

              {/* Reviewer Comments & Evaluation Feedback */}
              <div className="space-y-3 pt-4 border-t border-slate-100">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  Reviewer Evaluation Feedback ({(currentSub.reviews || []).length})
                </h4>
                {(!currentSub.reviews || currentSub.reviews.length === 0) ? (
                  <div className="p-4 bg-blue-50/60 border border-blue-200/80 rounded-xl text-xs text-blue-800 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-blue-600 shrink-0" />
                    <span>Your abstract is currently assigned to peer reviewers. Feedback will appear here upon review completion.</span>
                  </div>
                ) : (
                  (currentSub.reviews || []).map((rev) => (
                    <div key={rev.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3 text-xs">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-bold text-slate-900">{rev.reviewerName}</div>
                          <div className="text-[10px] text-slate-500">{rev.reviewerOrg}</div>
                        </div>
                        <div className="text-right">
                          <span className="px-2.5 py-0.5 bg-blue-100 text-blue-800 font-bold text-[10px] rounded-full">
                            Overall Score: {rev.overallScore}/10
                          </span>
                          <div className="text-[10px] text-slate-400 mt-0.5">{rev.date}</div>
                        </div>
                      </div>

                      <div className="bg-white p-3 rounded-xl border border-slate-200 text-slate-700 leading-relaxed">
                        <strong className="text-slate-900 block mb-1">Comments to Author:</strong>
                        {rev.commentsToAuthor}
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-600 pt-1">
                        <span>Recommendation: <strong className="text-emerald-700">{rev.recommendation}</strong></span>
                        <span className="text-emerald-600 font-bold flex items-center gap-1">
                          <Award className="w-3.5 h-3.5" /> Verified Reviewer Badge
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Author Revision Responses */}
              <div className="space-y-3 pt-4 border-t border-slate-100">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  Respond to Revision Request
                </h4>
                <form onSubmit={handleSendRevision} className="space-y-2">
                  <textarea
                    rows={3}
                    value={revisionText}
                    onChange={(e) => setRevisionText(e.target.value)}
                    placeholder="Enter author response or revised text summary to committee..."
                    className="w-full p-3 bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl text-xs focus:outline-hidden"
                  ></textarea>

                  {revisionSuccess && (
                    <div className="p-2.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl text-xs flex items-center gap-2 font-medium">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>Revision response uploaded and transmitted to Technical Committee.</span>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={!revisionText.trim()}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Submit Revision Response</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
