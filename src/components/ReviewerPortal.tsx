import React, { useState } from 'react';
import {
  Award,
  CheckCircle2,
  Clock,
  Sparkles,
  FileText,
  Star,
  Plus,
  Send,
  ShieldCheck,
  Zap,
  Filter,
  Users,
} from 'lucide-react';
import { UserProfile, ReviewOpportunity, AbstractSubmission } from '../types';

interface ReviewerPortalProps {
  userProfile: UserProfile;
  opportunities: ReviewOpportunity[];
  submissions: AbstractSubmission[];
  onCompleteReview: (abstractId: string, reviewData: any) => void;
}

export const ReviewerPortal: React.FC<ReviewerPortalProps> = ({
  userProfile,
  opportunities,
  submissions,
  onCompleteReview,
}) => {
  const [activeTab, setActiveTab] = useState<'opportunities' | 'my-reviews' | 'evaluate' | 'history'>('opportunities');
  const [availableToReview, setAvailableToReview] = useState(userProfile.reviewerInfo.available);
  const [selectedAbstractId, setSelectedAbstractId] = useState<string>(submissions[0]?.id || '');
  const [volunteerSuccess, setVolunteerSuccess] = useState<string | null>(null);

  // Form State for Evaluation
  const [scores, setScores] = useState({
    technicalQuality: 8,
    originality: 9,
    relevance: 9,
    innovation: 8,
    methodology: 8,
    clarity: 9,
    scientificValue: 9,
    presentationPotential: 8,
  });
  const [commentsToAuthor, setCommentsToAuthor] = useState('');
  const [confidentialComments, setConfidentialComments] = useState('');
  const [recommendation, setRecommendation] = useState<
    'Accept' | 'Accept with Revision' | 'Oral Presentation' | 'Poster Presentation' | 'Major Revision' | 'Reject'
  >('Oral Presentation');
  const [reviewSubmitted, setReviewSubmitted] = useState(false);

  const selectedSub = submissions.find((s) => s.id === selectedAbstractId) || submissions[0];

  const handleVolunteer = (oppId: string) => {
    setVolunteerSuccess(oppId);
    setTimeout(() => setVolunteerSuccess(null), 4000);
  };

  const handleEvaluateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentsToAuthor.trim()) return;

    const scoreValues = Object.values(scores) as number[];
    const overall = Number(
      (
        scoreValues.reduce((a: number, b: number) => a + b, 0) /
        scoreValues.length
      ).toFixed(1)
    );

    onCompleteReview(selectedAbstractId, {
      id: `rev_${Date.now()}`,
      abstractId: selectedAbstractId,
      reviewerId: userProfile.id,
      reviewerName: userProfile.name,
      reviewerOrg: userProfile.organization,
      scores,
      overallScore: overall,
      commentsToAuthor,
      confidentialComments,
      recommendation,
      date: new Date().toISOString().split('T')[0],
    });

    setReviewSubmitted(true);
    setTimeout(() => {
      setReviewSubmitted(false);
      setActiveTab('history');
    }, 2000);
  };

  return (
    <div className="space-y-8">
      {/* Top Banner & Reviewer Availability Toggle */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-xl border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 bg-amber-500/20 text-amber-300 border border-amber-400/30 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Award className="w-3.5 h-3.5 text-amber-400" />
                Accredited Peer Reviewer Workspace
              </span>
              <span className="px-2.5 py-1 bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 rounded-full text-xs font-bold flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                Verified Reviewer
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Reviewer Portal & Recognition Engine
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 max-w-2xl leading-relaxed">
              Every verified review increases your Reviewer Kudos (+20 Kudos per completed review) and unlocks official Reviewer Badges on your profile.
            </p>
          </div>

          {/* Kudos & Availability Card */}
          <div className="bg-white/10 backdrop-blur-md border border-white/20 p-5 rounded-2xl shrink-0 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[10px] uppercase font-bold text-slate-300">Total Reviewer Kudos</div>
                <div className="text-2xl font-extrabold text-amber-300 flex items-center gap-1">
                  <Zap className="w-5 h-5 fill-amber-300" />
                  <span>+{userProfile.contributions.reviewerKudos} Kudos</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase font-bold text-slate-300">Reviews Done</div>
                <div className="text-xl font-bold text-white">
                  {userProfile.contributions.abstractsReviewed} Papers
                </div>
              </div>
            </div>

            {/* Availability Toggle */}
            <div className="pt-2 border-t border-white/10 flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-200">Available to Review Abstracts:</span>
              <button
                onClick={() => setAvailableToReview(!availableToReview)}
                className={`px-3 py-1 rounded-full font-bold text-xs transition-colors cursor-pointer ${
                  availableToReview
                    ? 'bg-emerald-500 text-slate-950'
                    : 'bg-slate-700 text-slate-300'
                }`}
              >
                {availableToReview ? '● Active' : 'Off'}
              </button>
            </div>
          </div>
        </div>

        {/* Reviewer Badges Showcase Row */}
        <div className="mt-6 pt-6 border-t border-slate-800/80 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400 font-bold uppercase text-[10px] mr-2">
            Your Badges:
          </span>
          {(userProfile?.reviewerInfo?.badges || []).map((badge, idx) => (
            <span
              key={idx}
              className="px-3 py-1 bg-white/10 border border-white/15 text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1.5"
            >
              <Award className="w-3.5 h-3.5 text-amber-400" />
              <span>{badge}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Tabs Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-2 flex gap-2 overflow-x-auto text-xs font-semibold text-slate-600">
        <button
          onClick={() => setActiveTab('opportunities')}
          className={`px-4 py-2 rounded-xl transition-colors cursor-pointer ${
            activeTab === 'opportunities'
              ? 'bg-blue-600 text-white font-bold shadow-xs'
              : 'hover:bg-slate-100 text-slate-700'
          }`}
        >
          Review Opportunities Marketplace ({opportunities.length})
        </button>
        <button
          onClick={() => setActiveTab('evaluate')}
          className={`px-4 py-2 rounded-xl transition-colors cursor-pointer ${
            activeTab === 'evaluate'
              ? 'bg-blue-600 text-white font-bold shadow-xs'
              : 'hover:bg-slate-100 text-slate-700'
          }`}
        >
          Evaluate Assigned Abstract
        </button>
        <button
          onClick={() => setActiveTab('my-reviews')}
          className={`px-4 py-2 rounded-xl transition-colors cursor-pointer ${
            activeTab === 'my-reviews'
              ? 'bg-blue-600 text-white font-bold shadow-xs'
              : 'hover:bg-slate-100 text-slate-700'
          }`}
        >
          In-Progress Reviews ({submissions.length})
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-4 py-2 rounded-xl transition-colors cursor-pointer ${
            activeTab === 'history'
              ? 'bg-blue-600 text-white font-bold shadow-xs'
              : 'hover:bg-slate-100 text-slate-700'
          }`}
        >
          Completed Reviews History
        </button>
      </div>

      {/* Tab 1: Opportunities Marketplace */}
      {activeTab === 'opportunities' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-2">
            <h2 className="text-lg font-bold text-slate-900">Review Opportunity Marketplace</h2>
            <p className="text-xs text-slate-500">
              Browse published call for reviewers from international conference organizers. Volunteer to review abstracts in your domain of expertise.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {(opportunities || []).map((opp) => (
              <div
                key={opp.id}
                className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-xs hover:border-blue-300 transition-all"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <span className="text-[10px] font-bold uppercase text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-md">
                      {opp.track}
                    </span>
                    <h3 className="font-bold text-base text-slate-900 mt-1">{opp.topic}</h3>
                    <p className="text-xs text-slate-500 font-medium">{opp.conferenceTitle}</p>
                  </div>
                  <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                    {opp.abstractsCount} Papers
                  </span>
                </div>

                <div className="space-y-1.5 text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <div>Review Period: <strong className="text-slate-800">{opp.reviewPeriod}</strong></div>
                  <div>Organizer: <strong className="text-slate-800">{opp.organizerName}</strong></div>
                  <div>Expected Workload: <strong className="text-slate-800">{opp.expectedWorkload}</strong></div>
                </div>

                <div className="flex flex-wrap gap-1 text-[10px] font-semibold text-slate-600">
                  {(opp.expertiseRequired || []).map((exp, idx) => (
                    <span key={idx} className="px-2 py-0.5 bg-slate-100 rounded-md">
                      #{exp}
                    </span>
                  ))}
                </div>

                {volunteerSuccess === opp.id ? (
                  <div className="p-2.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-bold flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Volunteered! Added to Reviewer Pool for EAGE Committee.</span>
                  </div>
                ) : (
                  <button
                    onClick={() => handleVolunteer(opp.id)}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Volunteer as Reviewer</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 2: Evaluate Assigned Abstract Form */}
      {activeTab === 'evaluate' && selectedSub && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-6">
          <div className="pb-4 border-b border-slate-100 space-y-2">
            <span className="text-[10px] font-bold uppercase text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-md">
              Evaluating Paper #{selectedSub.id}
            </span>
            <h2 className="text-xl font-bold text-slate-900">{selectedSub.title}</h2>
            <div className="text-xs text-slate-500">
              Track: {selectedSub.track} • Target: {selectedSub.conferenceTitle}
            </div>
          </div>

          {/* Abstract Text Box */}
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2 text-xs">
            <h4 className="font-bold text-slate-900 uppercase text-[11px] tracking-wider">
              Abstract Text for Review
            </h4>
            <p className="text-slate-700 leading-relaxed whitespace-pre-wrap">{selectedSub.abstractText}</p>
          </div>

          {/* Configurable 8-Criteria Scoring Matrix */}
          <form onSubmit={handleEvaluateSubmit} className="space-y-6">
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Multi-Criteria Evaluation Scoring (Score 1 - 10)
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { key: 'technicalQuality', label: 'Technical Quality' },
                  { key: 'originality', label: 'Originality' },
                  { key: 'relevance', label: 'Relevance to Theme' },
                  { key: 'innovation', label: 'Innovation' },
                  { key: 'methodology', label: 'Methodology & Rigor' },
                  { key: 'clarity', label: 'Clarity & Structure' },
                  { key: 'scientificValue', label: 'Scientific Value' },
                  { key: 'presentationPotential', label: 'Presentation Potential' },
                ].map((item) => (
                  <div key={item.key} className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                      <span>{item.label}</span>
                      <span className="text-blue-700 font-extrabold">{(scores as any)[item.key]}/10</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      value={(scores as any)[item.key]}
                      onChange={(e) =>
                        setScores({
                          ...scores,
                          [item.key]: Number(e.target.value),
                        })
                      }
                      className="w-full accent-blue-600 cursor-pointer"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Comments to Author */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Comments to Author (Constructive Review Feedback) *
              </label>
              <textarea
                required
                rows={4}
                value={commentsToAuthor}
                onChange={(e) => setCommentsToAuthor(e.target.value)}
                placeholder="Write constructive suggestions on methodology, results, and presentation structure..."
                className="w-full p-3 bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl text-xs focus:outline-hidden"
              ></textarea>
            </div>

            {/* Confidential Comments to Organizer */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Confidential Comments to Organizer (Private)
              </label>
              <textarea
                rows={2}
                value={confidentialComments}
                onChange={(e) => setConfidentialComments(e.target.value)}
                placeholder="Private remarks regarding track placement or award nominations..."
                className="w-full p-3 bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl text-xs focus:outline-hidden"
              ></textarea>
            </div>

            {/* Final Recommendation */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Final Recommendation
              </label>
              <select
                value={recommendation}
                onChange={(e) => setRecommendation(e.target.value as any)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl text-xs font-bold text-slate-900"
              >
                <option value="Oral Presentation">Accept for Oral Presentation</option>
                <option value="Poster Presentation">Accept for Poster Presentation</option>
                <option value="Accept with Revision">Accept with Minor Revision</option>
                <option value="Major Revision">Request Major Revision</option>
                <option value="Reject">Reject Abstract</option>
              </select>
            </div>

            {reviewSubmitted && (
              <div className="p-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-bold flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <span>Review successfully submitted! +20 Reviewer Kudos awarded to your verified profile.</span>
              </div>
            )}

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition-colors cursor-pointer flex items-center gap-2"
              >
                <Send className="w-4 h-4" />
                <span>Submit Official Review (+20 Kudos)</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tab 3 & 4: In Progress & History Lists */}
      {(activeTab === 'my-reviews' || activeTab === 'history') && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-2">
            <h3 className="text-base font-bold text-slate-900">
              {activeTab === 'my-reviews' ? 'Assigned Papers Pending Review' : 'Verified Review History'}
            </h3>
            <p className="text-xs text-slate-500">
              All completed reviews are recorded in your permanent, verified Conference Gate record.
            </p>
          </div>

          <div className="space-y-4">
            {(submissions || []).map((sub) => (
              <div
                key={sub.id}
                className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-start justify-between gap-4"
              >
                <div className="space-y-1">
                  <span className="text-[10px] font-bold uppercase text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md">
                    {sub.track}
                  </span>
                  <h4 className="font-bold text-sm text-slate-900">{sub.title}</h4>
                  <p className="text-xs text-slate-500">{sub.conferenceTitle}</p>
                </div>

                <button
                  onClick={() => {
                    setSelectedAbstractId(sub.id);
                    setActiveTab('evaluate');
                  }}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs shrink-0 cursor-pointer"
                >
                  Start Evaluation
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
