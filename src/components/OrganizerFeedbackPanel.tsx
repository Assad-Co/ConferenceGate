import React, { useEffect, useState } from 'react';
import { Building2, Loader2, MessageSquareQuote, RefreshCw, ShieldCheck, User } from 'lucide-react';
import { fetchOrganizerFeedback, type OrganizerFeedbackRecord } from '../api/activity';
import { fetchReviewableSponsors, submitSponsorReview, type ReviewableSponsor } from '../api/sponsors';
import { SponsorEvaluationPanel } from './SponsorEvaluationPanel';
import { useToast } from './Toast';

const SCALE = ['Very Poor', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];

export const OrganizerFeedbackPanel: React.FC = () => {
  const { showToast } = useToast();
  const [records, setRecords] = useState<OrganizerFeedbackRecord[]>([]);
  const [reviewableSponsors, setReviewableSponsors] = useState<ReviewableSponsor[]>([]);
  const [loading, setLoading] = useState(true);
  const [sponsorsLoading, setSponsorsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setSponsorsLoading(true);
    try {
      const [feedback, sponsors] = await Promise.all([
        fetchOrganizerFeedback(),
        fetchReviewableSponsors().catch(() => [] as ReviewableSponsor[]),
      ]);
      setRecords(feedback);
      setReviewableSponsors(sponsors);
    } finally {
      setLoading(false);
      setSponsorsLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  const conferenceLinked = records.filter((item) => item.matchReason === 'conference');
  const organizationMatched = records.filter((item) => item.matchReason === 'organization');
  const verifiedAverage = conferenceLinked.length
    ? conferenceLinked.reduce((sum, item) => sum + item.overallScore, 0) / conferenceLinked.length
    : 0;

  const submitSponsorEvaluation = async (
    sponsorId: string,
    review: { conferenceTitle: string; rating: number; comment: string; ratings: Record<string, number>; overallScore: number }
  ) => {
    try {
      await submitSponsorReview({ sponsorId, ...review });
      showToast({
        type: 'success',
        title: 'Sponsor evaluation published',
        message: 'Your verified organizer evaluation is now part of the sponsor’s ConferenceGate Profile and reputation history.',
      });
    } catch (error: any) {
      showToast({
        type: 'info',
        title: 'Sponsor evaluation not submitted',
        message: error?.message || 'Please try again.',
      });
      throw error;
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <MessageSquareQuote className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-bold text-slate-900">Organizer Feedback & Reputation</h2>
          </div>
          <p className="text-xs text-slate-500 mt-1 max-w-3xl">
            This area handles both directions of verified feedback: professionals and conference participants evaluate your events here, while you can evaluate sponsors below after an approved sponsorship relationship.
          </p>
        </div>
        <button type="button" onClick={() => load(true)} disabled={refreshing} className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <section className="space-y-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Feedback received</div>
          <h3 className="text-base font-bold text-slate-900">Professional & Participant → Organizer</h3>
          <p className="text-xs text-slate-500 mt-1">Conference/workshop surveys submitted by professionals and participants appear here automatically when linked to your conference or matched to your organization name.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-5 rounded-2xl bg-emerald-50 border border-emerald-100">
            <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-emerald-600"><ShieldCheck className="w-3.5 h-3.5" />Verified Reputation</div>
            <div className="text-2xl font-extrabold text-emerald-900 mt-1">{conferenceLinked.length ? `${verifiedAverage.toFixed(1)} / 6` : '—'}</div>
          </div>
          <div className="p-5 rounded-2xl bg-white border border-slate-200">
            <div className="text-[10px] uppercase font-bold text-slate-400">Verified Event Responses</div>
            <div className="text-2xl font-extrabold text-slate-900 mt-1">{conferenceLinked.length}</div>
          </div>
          <div className="p-5 rounded-2xl bg-violet-50 border border-violet-100">
            <div className="text-[10px] uppercase font-bold text-violet-500">Organization Name Matches</div>
            <div className="text-2xl font-extrabold text-violet-900 mt-1">{organizationMatched.length}</div>
          </div>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-slate-400"><Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />Loading professional and participant feedback…</div>
        ) : records.length === 0 ? (
          <div className="p-10 bg-white rounded-3xl border border-slate-200 text-center text-sm text-slate-400">No professional or participant feedback has been routed to this organizer yet.</div>
        ) : (
          <div className="space-y-3">
            {records.map((record) => {
              const values = Object.values(record.ratings || {}).filter((value) => Number.isFinite(value));
              const excellent = values.filter((value) => value >= 5).length;
              const verified = record.matchReason === 'conference';
              return (
                <div key={record.id} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div>
                      <div className="font-bold text-sm text-slate-900">{record.conferenceTitle}</div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 mt-1">
                        <span className="inline-flex items-center gap-1"><User className="w-3 h-3" />{record.participantName}{record.participantOrganization ? ` · ${record.participantOrganization}` : ''}</span>
                        <span>{record.role}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2.5 py-1 rounded-full bg-blue-100 text-blue-800 text-[10px] font-bold">{record.overallScore.toFixed(1)} / 6 · {SCALE[Math.max(0, Math.min(5, Math.round(record.overallScore) - 1))]}</span>
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold ${verified ? 'bg-emerald-100 text-emerald-800' : 'bg-violet-100 text-violet-800'}`}>
                        {verified && <ShieldCheck className="w-3 h-3" />}
                        {verified ? 'Verified conference relationship' : 'Organization name match · not in verified score'}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[10px] text-slate-500">
                    {record.organizerName && <span className="inline-flex items-center gap-1"><Building2 className="w-3 h-3" />Routed to {record.organizerName}</span>}
                    <span>{values.length} criteria rated</span>
                    <span>{excellent} rated Very Good/Excellent</span>
                    <span>{String(record.date || '').replace('T', ' ').slice(0, 16)}</span>
                  </div>
                  {record.comment && <p className="text-xs text-slate-700 bg-slate-50 border border-slate-100 rounded-xl p-3">{record.comment}</p>}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-3 pt-2 border-t border-slate-200">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Feedback given</div>
          <h3 className="text-base font-bold text-slate-900">Organizer → Sponsor</h3>
          <p className="text-xs text-slate-500 mt-1">Your sponsor evaluation is kept separate from feedback about your own organization and is published on the evaluated sponsor's profile.</p>
        </div>
        <SponsorEvaluationPanel
          sponsors={reviewableSponsors}
          conferences={[]}
          sponsorsLoading={sponsorsLoading}
          onSubmit={submitSponsorEvaluation}
        />
      </section>
    </div>
  );
};

export default OrganizerFeedbackPanel;
