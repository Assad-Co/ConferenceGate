import React, { useMemo, useState } from 'react';
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
  Search,
  Presentation,
  Mic2,
} from 'lucide-react';
import { UserProfile, ReviewOpportunity, ProfessionalOpportunity, AbstractSubmission, Conference } from '../types';
import { ConferenceLink } from './ConferenceLink';

interface ReviewerPortalProps {
  userProfile: UserProfile;
  opportunities: ReviewOpportunity[];
  professionalOpportunities?: ProfessionalOpportunity[];
  professionalOpportunityInterestIds?: string[];
  onProfessionalOpportunityInterest?: (opportunityId: string, interested: boolean) => void | Promise<void>;
  submissions: AbstractSubmission[];
  conferences: Conference[];
  onSelectConference: (conf: Conference) => void;
  onCompleteReview: (abstractId: string, reviewData: any) => void;
  volunteeredOpportunityIds?: string[];
  onVolunteer?: (opportunityId: string, conferenceTitle: string, topic: string) => void;
  onToggleAvailability?: () => void;
}

type OpportunityRoleFilter = 'recommended' | 'reviewer' | 'committee' | 'chair' | 'speaker';

function normalizeMatchTokens(values: string[]): Set<string> {
  const stop = new Set(['and','the','for','with','from','into','using','conference','general','track','science','engineering']);
  const tokens = values
    .flatMap((value) => String(value || '').toLowerCase().split(/[^a-z0-9+#.-]+/g))
    .map((value) => value.trim())
    .filter((value) => value.length >= 3 && !stop.has(value));
  return new Set(tokens);
}

function opportunityMatchScore(userProfile: UserProfile, opportunity: ReviewOpportunity): number | null {
  const profileValues = [
    ...(userProfile.expertise || []),
    ...(userProfile.technicalSpecialization || []),
    ...(userProfile.researchInterests || []),
    ...(userProfile.keywords || []),
    ...(userProfile.reviewerInfo?.expertiseKeywords || []),
  ];
  const profileTokens = normalizeMatchTokens(profileValues);
  if (profileTokens.size === 0) return null;

  const required = [
    ...(opportunity.expertiseRequired || []),
    opportunity.topic,
    opportunity.track,
    opportunity.conferenceTitle,
  ].filter(Boolean);
  const opportunityTokens = normalizeMatchTokens(required);
  if (opportunityTokens.size === 0) return null;

  let matches = 0;
  for (const token of opportunityTokens) {
    if (profileTokens.has(token)) matches += 1;
  }
  const requiredTokens = normalizeMatchTokens(opportunity.expertiseRequired || []);
  let requiredMatches = 0;
  for (const token of requiredTokens) {
    if (profileTokens.has(token)) requiredMatches += 1;
  }

  const generalRatio = matches / opportunityTokens.size;
  const requiredRatio = requiredTokens.size ? requiredMatches / requiredTokens.size : generalRatio;
  return Math.max(0, Math.min(100, Math.round((requiredRatio * 0.7 + generalRatio * 0.3) * 100)));
}

function professionalOpportunityMatchScore(userProfile: UserProfile, opportunity: ProfessionalOpportunity): number | null {
  const profileTokens = normalizeMatchTokens([
    ...(userProfile.expertise || []),
    ...(userProfile.technicalSpecialization || []),
    ...(userProfile.researchInterests || []),
    ...(userProfile.keywords || []),
  ]);
  const opportunityTokens = normalizeMatchTokens([
    ...(opportunity.expertiseRequired || []),
    opportunity.title,
    opportunity.description,
    opportunity.conferenceTitle,
  ]);
  if (profileTokens.size === 0 || opportunityTokens.size === 0) return null;

  let matches = 0;
  for (const token of opportunityTokens) if (profileTokens.has(token)) matches += 1;
  const expertiseTokens = normalizeMatchTokens(opportunity.expertiseRequired || []);
  let expertiseMatches = 0;
  for (const token of expertiseTokens) if (profileTokens.has(token)) expertiseMatches += 1;

  const expertiseRatio = expertiseTokens.size ? expertiseMatches / expertiseTokens.size : matches / opportunityTokens.size;
  const generalRatio = matches / opportunityTokens.size;

  const userRegions = new Set((userProfile.preferredRegions || []).map((v) => v.toLowerCase()));
  const requestedRegions = (opportunity.preferredRegions || []).map((v) => v.toLowerCase());
  const regionScore =
    requestedRegions.length === 0 || userRegions.size === 0
      ? null
      : requestedRegions.some((region) => userRegions.has(region))
        ? 1
        : 0;

  const base = expertiseRatio * 0.75 + generalRatio * 0.25;
  const weighted = regionScore === null ? base : base * 0.85 + regionScore * 0.15;
  return Math.max(0, Math.min(100, Math.round(weighted * 100)));
}

export const ReviewerPortal: React.FC<ReviewerPortalProps> = ({
  userProfile,
  opportunities,
  professionalOpportunities = [],
  professionalOpportunityInterestIds = [],
  onProfessionalOpportunityInterest,
  submissions,
  conferences,
  onSelectConference,
  onCompleteReview,
  volunteeredOpportunityIds = [],
  onVolunteer,
  onToggleAvailability,
}) => {
  const [activeTab, setActiveTab] = useState<'opportunities' | 'my-reviews' | 'evaluate' | 'history'>('opportunities');
  const [roleFilter, setRoleFilter] = useState<OpportunityRoleFilter>('recommended');
  const [opportunitySearch, setOpportunitySearch] = useState('');
  const availableToReview = userProfile.reviewerInfo.available;
  const atReviewCapacity =
    (userProfile.reviewerInfo.currentLoad || 0) >= Math.max(1, userProfile.reviewerInfo.maxLoad || 5);

  const rankedReviewerOpportunities = useMemo(() => {
    const query = opportunitySearch.trim().toLowerCase();
    return (opportunities || [])
      .map((opportunity) => ({
        opportunity,
        matchScore: opportunityMatchScore(userProfile, opportunity),
      }))
      .filter(({ opportunity }) => {
        if (!query) return true;
        return [
          opportunity.conferenceTitle,
          opportunity.topic,
          opportunity.track,
          opportunity.organizerName,
          ...(opportunity.expertiseRequired || []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query);
      })
      .sort((a, b) => {
        if (a.matchScore === null && b.matchScore === null) return a.opportunity.conferenceTitle.localeCompare(b.opportunity.conferenceTitle);
        if (a.matchScore === null) return 1;
        if (b.matchScore === null) return -1;
        return b.matchScore - a.matchScore;
      });
  }, [opportunities, opportunitySearch, userProfile]);

  const visibleReviewerOpportunities =
    roleFilter === 'recommended'
      ? rankedReviewerOpportunities.filter((item) => item.matchScore === null || item.matchScore >= 35)
      : roleFilter === 'reviewer'
        ? rankedReviewerOpportunities
        : [];

  const rankedProfessionalOpportunities = useMemo(() => {
    const query = opportunitySearch.trim().toLowerCase();
    return (professionalOpportunities || [])
      .map((opportunity) => ({
        opportunity,
        matchScore: professionalOpportunityMatchScore(userProfile, opportunity),
      }))
      .filter(({ opportunity }) => {
        if (!query) return true;
        return [
          opportunity.conferenceTitle,
          opportunity.title,
          opportunity.description,
          opportunity.organizerName,
          ...(opportunity.expertiseRequired || []),
          ...(opportunity.preferredRegions || []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query);
      })
      .sort((a, b) => {
        if (a.matchScore === null && b.matchScore === null) return a.opportunity.conferenceTitle.localeCompare(b.opportunity.conferenceTitle);
        if (a.matchScore === null) return 1;
        if (b.matchScore === null) return -1;
        return b.matchScore - a.matchScore;
      });
  }, [professionalOpportunities, opportunitySearch, userProfile]);

  const roleAvailability = (roleType: ProfessionalOpportunity['roleType']) =>
    roleType === 'committee'
      ? Boolean(userProfile.committeeAvailable)
      : roleType === 'chair'
        ? Boolean(userProfile.sessionChairAvailable)
        : Boolean(userProfile.speakerAvailable);

  const visibleProfessionalOpportunities = rankedProfessionalOpportunities.filter(({ opportunity, matchScore }) => {
    if (roleFilter === 'recommended') {
      return roleAvailability(opportunity.roleType) && (matchScore === null || matchScore >= 35);
    }
    return opportunity.roleType === roleFilter;
  });

  // Every submission on the platform is fetched for other views (e.g. a reviewer's own
  // abstracts), but a paper only belongs in this reviewer's queue if an organizer actually
  // invited them to it — otherwise this would hand every reviewer every stranger's abstract.
  const myAssignedSubmissions = submissions.filter((sub) =>
    (sub.reviewerAssignments || []).some((a) => a.reviewerId === userProfile.id)
  );
  const [selectedAbstractId, setSelectedAbstractId] = useState<string>(myAssignedSubmissions[0]?.id || '');

  const pendingSubmissions = myAssignedSubmissions.filter(
    (sub) => !sub.reviews.some((r) => r.reviewerId === userProfile.id)
  );
  const completedSubmissions = myAssignedSubmissions.filter((sub) =>
    sub.reviews.some((r) => r.reviewerId === userProfile.id)
  );
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

  const selectedSub = myAssignedSubmissions.find((s) => s.id === selectedAbstractId) || myAssignedSubmissions[0];

  const handleVolunteer = (opp: ReviewOpportunity) => {
    onVolunteer?.(opp.id, opp.conferenceTitle, opp.topic);
    setVolunteerSuccess(opp.id);
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
      <div className="bg-blue-50 text-slate-900 rounded-3xl p-6 sm:p-8 shadow-xs border border-blue-100">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 bg-white text-blue-700 border border-blue-200 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Award className="w-3.5 h-3.5 text-blue-600" />
                Professional Opportunity Network
              </span>
              <span className="px-2.5 py-1 bg-white text-emerald-700 border border-emerald-200 rounded-full text-xs font-bold flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                Professional Profile
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
              Professional Opportunity Center
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 max-w-2xl leading-relaxed">
              Discover real organizer-published opportunities matched to your expertise. Reviewer opportunities are live now; committee, chair, and speaker openings will appear here when organizers publish them.
            </p>
          </div>

          {/* Kudos & Availability Card */}
          <div className="bg-white border border-blue-100 p-5 rounded-2xl shrink-0 space-y-3 shadow-xs">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[10px] uppercase font-bold text-blue-400">Total Reviewer Kudos</div>
                <div className="text-2xl font-extrabold text-blue-700 flex items-center gap-1">
                  <Zap className="w-5 h-5 fill-blue-600" />
                  <span>+{userProfile.contributions.reviewerKudos} Kudos</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase font-bold text-blue-400">Reviews Done</div>
                <div className="text-xl font-bold text-slate-900">
                  {userProfile.contributions.abstractsReviewed} Papers
                </div>
              </div>
            </div>

            {/* Availability Toggle */}
            <div className="pt-2 border-t border-blue-50 flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-600">Available to Review Abstracts:</span>
              <button
                onClick={onToggleAvailability}
                className={`px-3 py-1 rounded-full font-bold text-xs transition-colors cursor-pointer ${
                  availableToReview
                    ? 'bg-emerald-500 text-white'
                    : 'bg-slate-200 text-slate-600'
                }`}
              >
                {availableToReview ? '● Active' : 'Off'}
              </button>
            </div>
          </div>
        </div>

        {/* Reviewer Badges Showcase Row */}
        <div className="mt-6 pt-6 border-t border-blue-100 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-blue-400 font-bold uppercase text-[10px] mr-2">
            Your Badges:
          </span>
          {(userProfile?.reviewerInfo?.badges || []).map((badge, idx) => (
            <span
              key={idx}
              className="px-3 py-1 bg-white border border-blue-100 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5"
            >
              <Award className="w-3.5 h-3.5 text-blue-600" />
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
          Opportunity Center ({opportunities.length + professionalOpportunities.length})
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
          In-Progress Reviews ({pendingSubmissions.length})
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

      {/* Tab 1: Unified Professional Opportunity Center */}
      {activeTab === 'opportunities' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Professional Opportunity Center</h2>
                <p className="text-xs text-slate-500 mt-1 max-w-3xl">
                  ConferenceGate only shows opportunities that an organizer actually publishes. Your stored expertise
                  is used to rank organizer-published opportunities; no committee, chair, or speaker vacancy is inferred from a conference page.
                </p>
              </div>
              <div className="relative w-full lg:w-80">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  value={opportunitySearch}
                  onChange={(event) => setOpportunitySearch(event.target.value)}
                  placeholder="Search topic, expertise, conference..."
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {[
                { id: 'recommended', label: 'Recommended for You', icon: Sparkles },
                { id: 'reviewer', label: 'Reviewer', icon: Award },
                { id: 'committee', label: 'Technical Committee', icon: Users },
                { id: 'chair', label: 'Session Chair', icon: Presentation },
                { id: 'speaker', label: 'Speaker / Keynote', icon: Mic2 },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => setRoleFilter(item.id as OpportunityRoleFilter)}
                    className={`px-3 py-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors ${
                      roleFilter === item.id
                        ? 'bg-blue-900 text-white border-blue-900'
                        : 'bg-white text-slate-700 border-slate-200 hover:border-blue-300'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="text-[10px] font-bold uppercase text-slate-400">Reviewer Status</div>
                <div className={`text-xs font-extrabold mt-1 ${availableToReview ? 'text-emerald-700' : 'text-slate-600'}`}>
                  {availableToReview ? 'Available' : 'Not available'}
                </div>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="text-[10px] font-bold uppercase text-slate-400">Review Capacity</div>
                <div className={`text-xs font-extrabold mt-1 ${atReviewCapacity ? 'text-amber-700' : 'text-slate-900'}`}>
                  {userProfile.reviewerInfo.currentLoad || 0} / {userProfile.reviewerInfo.maxLoad || 5} active
                </div>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="text-[10px] font-bold uppercase text-slate-400">Committee</div>
                <div className={`text-xs font-extrabold mt-1 ${userProfile.committeeAvailable ? 'text-emerald-700' : 'text-slate-600'}`}>
                  {userProfile.committeeAvailable ? 'Available' : 'Not available'}
                </div>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="text-[10px] font-bold uppercase text-slate-400">Chair / Speaker</div>
                <div className="text-xs font-extrabold mt-1 text-slate-900">
                  {userProfile.sessionChairAvailable ? 'Chair ✓' : 'Chair —'} · {userProfile.speakerAvailable ? 'Speaker ✓' : 'Speaker —'}
                </div>
              </div>
            </div>
          </div>

          {(roleFilter === 'recommended' || roleFilter === 'reviewer') && (
            visibleReviewerOpportunities.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {visibleReviewerOpportunities.map(({ opportunity: opp, matchScore }) => (
                  <div
                    key={opp.id}
                    className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-xs hover:border-blue-300 transition-all"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[10px] font-bold uppercase text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-md">
                            Reviewer
                          </span>
                          {matchScore !== null ? (
                            <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-md ${
                              matchScore >= 70
                                ? 'bg-emerald-50 text-emerald-700'
                                : matchScore >= 35
                                  ? 'bg-amber-50 text-amber-700'
                                  : 'bg-slate-100 text-slate-600'
                            }`}>
                              {matchScore}% profile match
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-md bg-slate-100 text-slate-500">
                              Add expertise to calculate match
                            </span>
                          )}
                        </div>
                        <h3 className="font-bold text-base text-slate-900 mt-2">{opp.topic}</h3>
                        <ConferenceLink
                          conferences={conferences}
                          conferenceId={opp.conferenceId}
                          conferenceTitle={opp.conferenceTitle}
                          onSelectConference={onSelectConference}
                          className="text-xs text-slate-500 font-medium"
                        />
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
                        <span key={idx} className="px-2 py-0.5 bg-slate-100 rounded-md">#{exp}</span>
                      ))}
                    </div>

                    {volunteeredOpportunityIds.includes(opp.id) ? (
                      <div className="p-2.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-bold flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span>
                          {volunteerSuccess === opp.id
                            ? `Volunteered! Added to the Reviewer Pool for ${opp.organizerName}.`
                            : 'You volunteered for this opportunity.'}
                        </span>
                      </div>
                    ) : !availableToReview ? (
                      <div className="p-2.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-xl text-xs font-semibold">
                        Turn on <strong>Available to Review</strong> above before volunteering.
                      </div>
                    ) : atReviewCapacity ? (
                      <div className="p-2.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-xl text-xs font-semibold">
                        You are at your selected maximum active review load.
                      </div>
                    ) : (
                      <button
                        onClick={() => handleVolunteer(opp)}
                        className="w-full py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Volunteer as Reviewer</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : roleFilter === 'reviewer' ? (
              <div className="p-8 bg-white rounded-2xl border border-slate-200 text-center">
                <Filter className="w-7 h-7 text-slate-300 mx-auto mb-2" />
                <h3 className="font-bold text-sm text-slate-800">No reviewer opportunities found</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Try a different search term or check again when organizers publish new calls for reviewers.
                </p>
              </div>
            ) : null
          )}

          {(roleFilter === 'recommended' || roleFilter === 'committee' || roleFilter === 'chair' || roleFilter === 'speaker') && (
            visibleProfessionalOpportunities.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {visibleProfessionalOpportunities.map(({ opportunity: opp, matchScore }) => {
                  const RoleIcon = opp.roleType === 'committee' ? Users : opp.roleType === 'chair' ? Presentation : Mic2;
                  const roleLabel =
                    opp.roleType === 'committee'
                      ? 'Technical Committee'
                      : opp.roleType === 'chair'
                        ? 'Session Chair'
                        : 'Speaker / Keynote';
                  const interested = professionalOpportunityInterestIds.includes(opp.id);
                  return (
                    <div key={opp.id} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-xs hover:border-blue-300 transition-all">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[10px] font-bold uppercase text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-md flex items-center gap-1">
                              <RoleIcon className="w-3 h-3" />
                              {roleLabel}
                            </span>
                            {matchScore !== null ? (
                              <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-md ${
                                matchScore >= 70
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : matchScore >= 35
                                    ? 'bg-amber-50 text-amber-700'
                                    : 'bg-slate-100 text-slate-600'
                              }`}>
                                {matchScore}% profile match
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-md bg-slate-100 text-slate-500">
                                Add expertise to calculate match
                              </span>
                            )}
                          </div>
                          <h3 className="font-bold text-base text-slate-900 mt-2">{opp.title}</h3>
                          <ConferenceLink
                            conferences={conferences}
                            conferenceId={opp.conferenceId}
                            conferenceTitle={opp.conferenceTitle}
                            onSelectConference={onSelectConference}
                            className="text-xs text-slate-500 font-medium"
                          />
                        </div>
                        <span className="text-[10px] font-bold text-slate-600 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-full shrink-0">
                          {opp.deadline ? `Deadline ${opp.deadline}` : 'Open'}
                        </span>
                      </div>

                      {opp.description && (
                        <p className="text-xs text-slate-600 leading-relaxed">{opp.description}</p>
                      )}

                      <div className="space-y-1.5 text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-100">
                        <div>Organizer: <strong className="text-slate-800">{opp.organizerName}</strong></div>
                        {opp.preferredRegions?.length > 0 && (
                          <div>Preferred Regions: <strong className="text-slate-800">{opp.preferredRegions.join(' · ')}</strong></div>
                        )}
                      </div>

                      {opp.expertiseRequired?.length > 0 && (
                        <div className="flex flex-wrap gap-1 text-[10px] font-semibold text-slate-600">
                          {opp.expertiseRequired.map((exp, idx) => (
                            <span key={idx} className="px-2 py-0.5 bg-slate-100 rounded-md">#{exp}</span>
                          ))}
                        </div>
                      )}

                      <button
                        onClick={() => onProfessionalOpportunityInterest?.(opp.id, !interested)}
                        className={`w-full py-2.5 font-bold text-xs rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2 ${
                          interested
                            ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200'
                            : 'bg-blue-900 hover:bg-blue-950 text-white'
                        }`}
                      >
                        {interested ? <CheckCircle2 className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                        <span>{interested ? 'Interested · Withdraw' : 'Express Interest'}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : roleFilter !== 'recommended' ? (
              <div className="p-8 bg-white rounded-2xl border border-slate-200 text-center">
                {roleFilter === 'committee' ? (
                  <Users className="w-8 h-8 text-indigo-300 mx-auto mb-3" />
                ) : roleFilter === 'chair' ? (
                  <Presentation className="w-8 h-8 text-violet-300 mx-auto mb-3" />
                ) : (
                  <Mic2 className="w-8 h-8 text-rose-300 mx-auto mb-3" />
                )}
                <h3 className="font-bold text-sm text-slate-900">
                  No organizer-published {roleFilter === 'committee' ? 'Technical Committee' : roleFilter === 'chair' ? 'Session Chair' : 'Speaker / Keynote'} openings yet
                </h3>
                <p className="text-xs text-slate-500 mt-1 max-w-xl mx-auto">
                  ConferenceGate will show a role here only after an organizer explicitly publishes that opening.
                </p>
              </div>
            ) : null
          )}

          {roleFilter === 'recommended' &&
            visibleReviewerOpportunities.length === 0 &&
            visibleProfessionalOpportunities.length === 0 && (
              <div className="p-8 bg-white rounded-2xl border border-slate-200 text-center">
                <Sparkles className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                <h3 className="font-bold text-sm text-slate-900">No matching opportunities yet</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-xl mx-auto">
                  Complete your expertise and availability profile, or check the individual role tabs to see all organizer-published openings.
                </p>
              </div>
            )}
        </div>
      )}

      {/* Tab 2: Evaluate Assigned Abstract Form */}
      {activeTab === 'evaluate' && !selectedSub && (
        <div className="p-6 bg-white rounded-2xl border border-slate-200 text-center text-xs text-slate-400 font-medium">
          No abstract is currently assigned to you for review. Once an organizer invites you to review a paper, it'll show up here and in Review Opportunities.
        </div>
      )}
      {activeTab === 'evaluate' && selectedSub && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-6">
          <div className="pb-4 border-b border-slate-100 space-y-2">
            <span className="text-[10px] font-bold uppercase text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-md">
              Evaluating Paper #{selectedSub.id}
            </span>
            <h2 className="text-xl font-bold text-slate-900">{selectedSub.title}</h2>
            <div className="text-xs text-slate-500">
              Track: {selectedSub.track} • Target:{' '}
              <ConferenceLink
                conferences={conferences}
                conferenceId={selectedSub.conferenceId}
                conferenceTitle={selectedSub.conferenceTitle}
                onSelectConference={onSelectConference}
              />
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
                className="px-6 py-3 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-md transition-colors cursor-pointer flex items-center gap-2"
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
              {activeTab === 'my-reviews' ? 'Papers Pending Your Review' : 'Verified Review History'}
            </h3>
            <p className="text-xs text-slate-500">
              {activeTab === 'my-reviews'
                ? "Papers you haven't submitted a review for yet."
                : 'All completed reviews are recorded in your permanent, verified Conference Gate record.'}
            </p>
          </div>

          <div className="space-y-4">
            {activeTab === 'my-reviews' &&
              (pendingSubmissions.length === 0 ? (
                <div className="p-6 bg-white rounded-2xl border border-slate-200 text-center text-xs text-slate-400 font-medium">
                  No pending papers — you've reviewed everything currently available.
                </div>
              ) : (
                pendingSubmissions.map((sub) => (
                  <div
                    key={sub.id}
                    className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-start justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold uppercase text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md">
                        {sub.track}
                      </span>
                      <h4 className="font-bold text-sm text-slate-900">{sub.title}</h4>
                      <ConferenceLink
                        conferences={conferences}
                        conferenceId={sub.conferenceId}
                        conferenceTitle={sub.conferenceTitle}
                        onSelectConference={onSelectConference}
                        className="text-xs text-slate-500"
                      />
                    </div>

                    <button
                      onClick={() => {
                        setSelectedAbstractId(sub.id);
                        setActiveTab('evaluate');
                      }}
                      className="px-4 py-2 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-xs shrink-0 cursor-pointer"
                    >
                      Start Evaluation
                    </button>
                  </div>
                ))
              ))}

            {activeTab === 'history' &&
              (completedSubmissions.length === 0 ? (
                <div className="p-6 bg-white rounded-2xl border border-slate-200 text-center text-xs text-slate-400 font-medium">
                  No completed reviews yet.
                </div>
              ) : (
                completedSubmissions.map((sub) => {
                  const myReview = sub.reviews.find((r) => r.reviewerId === userProfile.id);
                  return (
                    <div
                      key={sub.id}
                      className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-start justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold uppercase text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md">
                          {sub.track}
                        </span>
                        <h4 className="font-bold text-sm text-slate-900">{sub.title}</h4>
                        <ConferenceLink
                          conferences={conferences}
                          conferenceId={sub.conferenceId}
                          conferenceTitle={sub.conferenceTitle}
                          onSelectConference={onSelectConference}
                          className="text-xs text-slate-500"
                        />
                      </div>

                      {myReview && (
                        <div className="text-right shrink-0 space-y-1">
                          <span className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-xs rounded-xl inline-flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {myReview.recommendation}
                          </span>
                          <div className="text-[11px] text-slate-500 font-semibold">
                            Score: {myReview.overallScore}/10
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              ))}
          </div>
        </div>
      )}
    </div>
  );
};
