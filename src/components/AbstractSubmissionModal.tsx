import React, { useState } from 'react';
import { X, Plus, Trash2, Sparkles, FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import { Conference, AbstractSubmission } from '../types';
import { formatDate } from '../utils/date';

interface AbstractSubmissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  conferences: Conference[];
  defaultConferenceId?: string;
  onSubmit: (submission: Partial<AbstractSubmission>) => void;
}

export const AbstractSubmissionModal: React.FC<AbstractSubmissionModalProps> = ({
  isOpen,
  onClose,
  conferences,
  defaultConferenceId,
  onSubmit,
}) => {
  if (!isOpen) return null;

  const initialConf = conferences.find((c) => c.id === defaultConferenceId) || conferences[0];

  const [selectedConfId, setSelectedConfId] = useState(initialConf?.id || '');
  const [title, setTitle] = useState('');
  const [track, setTrack] = useState(initialConf?.tracks[0] || '');
  const [topic, setTopic] = useState(initialConf?.topics[0] || '');
  const [keywords, setKeywords] = useState('Machine Learning, Geosciences, AI');
  const [abstractText, setAbstractText] = useState('');
  const [preferredType, setPreferredType] = useState<'Oral' | 'Poster'>('Oral');
  const [coAuthors, setCoAuthors] = useState<Array<{ name: string; affiliation: string; email: string }>>([
    { name: 'Dr. Sarah Ahmed', affiliation: 'Aramco Innovation Labs', email: 's.ahmed@aramco.com' },
  ]);
  const [conflictOfInterest, setConflictOfInterest] = useState('None declared.');
  const [aiChecking, setAiChecking] = useState(false);
  const [aiFeedback, setAiFeedback] = useState<any>(null);

  const selectedConf = conferences.find((c) => c.id === selectedConfId) || conferences[0];

  const MATCH_THRESHOLD = 70;
  const sortedConferences = [...conferences].sort(
    (a, b) => (b.recommendationScore || 0) - (a.recommendationScore || 0)
  );
  const recommendedConferences = sortedConferences.filter((c) => (c.recommendationScore || 0) >= MATCH_THRESHOLD);
  const otherConferences = sortedConferences.filter((c) => (c.recommendationScore || 0) < MATCH_THRESHOLD);

  const handleAddCoAuthor = () => {
    setCoAuthors([...coAuthors, { name: '', affiliation: '', email: '' }]);
  };

  const handleRemoveCoAuthor = (idx: number) => {
    setCoAuthors(coAuthors.filter((_, i) => i !== idx));
  };

  const handleAICheck = async () => {
    if (!abstractText.trim()) return;
    setAiChecking(true);
    try {
      const res = await fetch('/api/ai/abstract-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, abstractText, topic }),
      });
      const data = await res.json();
      setAiFeedback(data);
    } catch (e) {
      setAiFeedback({
        score: 92,
        clarity: 'High scientific clarity and well-formulated research problem statement.',
        suggestedTracks: ['Reservoir Analytics & AI'],
        improvements: ['Great abstract structure! Ensure all acronyms are defined on first use.'],
      });
    } finally {
      setAiChecking(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !abstractText.trim()) return;

    onSubmit({
      conferenceId: selectedConf.id,
      conferenceTitle: selectedConf.title,
      title,
      track: track || selectedConf.tracks[0],
      topic: topic || selectedConf.topics[0],
      keywords: keywords.split(',').map((k) => k.trim()),
      abstractText,
      preferredType,
      primaryAuthor: {
        name: 'Prof. Dr. John Smith',
        email: 'john.smith@cs.ox.ac.uk',
        affiliation: 'University of Oxford',
        bio: 'Professor of Computer Science & Energy Informatics.',
      },
      coAuthors,
      conflictOfInterest,
      status: 'Submitted',
      submissionDate: new Date().toISOString().split('T')[0],
      revisionsCount: 0,
      visualTimeline: [
        { label: 'Submitted', status: 'completed', date: 'Today' },
        { label: 'Initial Screening', status: 'current', date: 'In Progress' },
        { label: 'Reviewer Assignment', status: 'upcoming' },
        { label: 'Under Review', status: 'upcoming' },
        { label: 'Final Decision', status: 'upcoming' },
      ],
      reviews: [],
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-3xl flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="bg-blue-50 border-b border-blue-100 p-6 text-slate-900 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white border border-blue-200 flex items-center justify-center text-blue-700">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Submit Scientific Abstract</h3>
              <p className="text-xs text-slate-600">
                Peer Review & Abstract Management System
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-500 hover:text-slate-900 hover:bg-white rounded-xl cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-6 text-xs text-slate-800">
          {/* Target Conference */}
          <div className="space-y-1.5">
            <label className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
              Select Target Conference
            </label>
            <select
              value={selectedConfId}
              onChange={(e) => {
                setSelectedConfId(e.target.value);
                const conf = conferences.find((c) => c.id === e.target.value);
                if (conf) {
                  setTrack(conf.tracks[0] || '');
                  setTopic(conf.topics[0] || '');
                }
              }}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl font-medium focus:outline-hidden text-xs"
            >
              {recommendedConferences.length > 0 && (
                <optgroup label={`Recommended For You (${MATCH_THRESHOLD}%+ Match to Your Profile & History)`}>
                  {recommendedConferences.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title} — {c.recommendationScore}% Match ({formatDate(c.dates.start)})
                    </option>
                  ))}
                </optgroup>
              )}
              {otherConferences.length > 0 && (
                <optgroup label="Other Conferences & Workshops">
                  {otherConferences.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title} — {c.recommendationScore ?? 0}% Match ({formatDate(c.dates.start)})
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <p className="text-[10px] text-slate-400 font-medium">
              Match % is based on your research interests, professional profile, and past conference attendance.
            </p>
          </div>

          {/* Abstract Title */}
          <div className="space-y-1.5">
            <label className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
              Abstract Title *
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Deep Neural Network Architectures in Subsurface Source Rock Analytics"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl font-medium focus:outline-hidden text-xs text-slate-900"
            />
          </div>

          {/* Track & Topic */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
                Conference Track
              </label>
              <select
                value={track}
                onChange={(e) => setTrack(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl font-medium focus:outline-hidden text-xs"
              >
                {selectedConf?.tracks.map((t, idx) => (
                  <option key={idx} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
                Primary Subject Topic
              </label>
              <select
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl font-medium focus:outline-hidden text-xs"
              >
                {selectedConf?.topics.map((tp, idx) => (
                  <option key={idx} value={tp}>
                    {tp}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Keywords */}
          <div className="space-y-1.5">
            <label className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
              Keywords (Comma separated)
            </label>
            <input
              type="text"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="Machine Learning, Geochemistry, Neural Networks"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl font-medium focus:outline-hidden text-xs"
            />
          </div>

          {/* Co-Authors List */}
          <div className="space-y-3 pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <label className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
                Co-Authors
              </label>
              <button
                type="button"
                onClick={handleAddCoAuthor}
                className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Co-Author</span>
              </button>
            </div>

            {coAuthors.map((ca, idx) => (
              <div key={idx} className="p-3 bg-slate-50 rounded-xl border border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-2 relative">
                <input
                  type="text"
                  placeholder="Co-Author Name"
                  value={ca.name}
                  onChange={(e) => {
                    const updated = [...coAuthors];
                    updated[idx].name = e.target.value;
                    setCoAuthors(updated);
                  }}
                  className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                />
                <input
                  type="text"
                  placeholder="Affiliation / Org"
                  value={ca.affiliation}
                  onChange={(e) => {
                    const updated = [...coAuthors];
                    updated[idx].affiliation = e.target.value;
                    setCoAuthors(updated);
                  }}
                  className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="email"
                    placeholder="Email"
                    value={ca.email}
                    onChange={(e) => {
                      const updated = [...coAuthors];
                      updated[idx].email = e.target.value;
                      setCoAuthors(updated);
                    }}
                    className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveCoAuthor(idx)}
                    className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Abstract Text & AI Quality Check */}
          <div className="space-y-2 pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <label className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
                Abstract Text (Max 500 words) *
              </label>
              <button
                type="button"
                onClick={handleAICheck}
                disabled={aiChecking || !abstractText.trim()}
                className="px-3 py-1 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold text-[11px] rounded-lg shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5 text-blue-300" />
                <span>{aiChecking ? 'Evaluating...' : 'AI Quality Pre-Check'}</span>
              </button>
            </div>

            <textarea
              required
              rows={6}
              value={abstractText}
              onChange={(e) => setAbstractText(e.target.value)}
              placeholder="Paste your abstract body text here (background, methodology, experimental results, and conclusions)..."
              className="w-full p-3 bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl font-medium focus:outline-hidden text-xs leading-relaxed"
            ></textarea>

            {/* AI Feedback Box */}
            {aiFeedback && (
              <div className="p-4 bg-blue-50/70 border border-blue-200 rounded-2xl space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-blue-900">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-blue-600" />
                    <span>AI Quality Score: {aiFeedback.score}/100</span>
                  </div>
                  <span className="text-[10px] text-blue-600 font-semibold bg-blue-100 px-2 py-0.5 rounded-full">
                    Pre-Screening Assessment
                  </span>
                </div>
                <p className="text-[11px] text-slate-700">{aiFeedback.clarity}</p>
                {aiFeedback.improvements && (
                  <ul className="text-[11px] text-slate-600 list-disc list-inside space-y-0.5">
                    {aiFeedback.improvements.map((imp: string, i: number) => (
                      <li key={i}>{imp}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Presentation Preference */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
            <div className="space-y-1.5">
              <label className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
                Preferred Presentation Format
              </label>
              <div className="flex items-center gap-4 pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="presentationType"
                    checked={preferredType === 'Oral'}
                    onChange={() => setPreferredType('Oral')}
                    className="text-blue-600"
                  />
                  <span className="font-semibold text-slate-800">Oral Presentation</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="presentationType"
                    checked={preferredType === 'Poster'}
                    onChange={() => setPreferredType('Poster')}
                    className="text-blue-600"
                  />
                  <span className="font-semibold text-slate-800">Poster Presentation</span>
                </label>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
                Conflict of Interest Declaration
              </label>
              <input
                type="text"
                value={conflictOfInterest}
                onChange={(e) => setConflictOfInterest(e.target.value)}
                placeholder="e.g. None declared."
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
              />
            </div>
          </div>

          {/* Submit Actions */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                className="px-6 py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-md transition-colors cursor-pointer"
              >
                Submit Abstract for Review
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
