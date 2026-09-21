import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Briefcase,
  Users,
  CheckCircle2,
  Sparkles,
  Star,
  ShieldCheck,
  ShieldAlert,
  History,
  MessageSquareQuote,
  Bell,
  BellRing,
  CheckCheck,
  Clock,
  Target,
  SlidersHorizontal,
  Send,
  DollarSign,
  Bookmark,
  BookmarkCheck,
  BellOff,
  Trash2,
} from 'lucide-react';
import { SponsorshipPackage, SponsorshipOpportunity, SponsorProfile, NotificationItem } from '../types';
import { isSponsorVerified, sponsorVerificationReason, sponsorOpportunityMatch, SPONSOR_RATING_THRESHOLD } from '../utils/sponsorVerification';
import {
  SponsorApplicationSummary,
  fetchMySponsorPreferences,
  updateMySponsorPreferences,
  fetchMatchedSponsorshipNeeds,
  inquireAboutSponsorshipNeed,
  fetchMySponsorshipDeals,
  updateSponsorshipDeal,
  addSponsorshipDealUpdate,
  createSponsorRequest,
  fetchMySponsorRequests,
  fetchMySponsorRequestResponses,
  decideSponsorRequestResponse,
  fetchSponsorPortfolioAnalytics,
  fetchSponsorWatchlist,
  saveSponsorOpportunity,
  setSponsorWatchAlert,
  removeSponsorSavedOpportunity,
  type SponsorSavedOpportunity,
  type SponsorPortfolioAnalytics,
  type SponsorPreferences,
  type SponsorshipNeed,
  type SponsorshipDeal,
  type SponsorRequest,
  type SponsorRequestResponse,
} from '../api/sponsors';
import { useToast } from './Toast';
import { WorkspaceTeamPanel } from './WorkspaceTeamPanel';
import { BillingLedgerPanel } from './BillingLedgerPanel';

interface SponsorPortalProps {
  sponsorshipPackages: SponsorshipPackage[];
  sponsorshipOpportunities?: SponsorshipOpportunity[];
  myApplications: SponsorApplicationSummary[];
  sponsorProfile: SponsorProfile;
  /** This sponsor's real notifications — application decisions, organizer reviews, and new
   * opportunity alerts an organizer actually published, all backed by real data. */
  sponsorAlerts?: NotificationItem[];
  onMarkAlertRead?: (id: string) => void;
  onMarkAllAlertsRead?: () => void;
  onApplyForSponsorship?: (packageId: string) => void;
}

const StarRating: React.FC<{ rating: number; size?: string }> = ({ rating, size = 'w-3.5 h-3.5' }) => (
  <div className="flex items-center gap-0.5">
    {[1, 2, 3, 4, 5].map((n) => (
      <Star
        key={n}
        className={`${size} ${n <= Math.round(rating) ? 'fill-amber-400 text-amber-400' : 'text-slate-200'}`}
      />
    ))}
  </div>
);

export const SponsorPortal: React.FC<SponsorPortalProps> = ({
  sponsorshipPackages,
  sponsorshipOpportunities = [],
  myApplications,
  sponsorProfile,
  sponsorAlerts = [],
  onMarkAlertRead = (_id: string) => {},
  onMarkAllAlertsRead = () => {},
  onApplyForSponsorship = (_packageId: string) => {},
}) => {
  const [activeTab, setActiveTab] = useState<'matches' | 'marketplace' | 'saved' | 'requests' | 'deals' | 'preferences' | 'workspace' | 'payments' | 'roi' | 'profile'>('matches');
  const alertsPanelRef = useRef<HTMLDivElement>(null);
  const [preferences, setPreferences] = useState<SponsorPreferences>({
    sectors: [],
    categories: [],
    regions: [],
    opportunityTypes: [],
    budgetMin: null,
    budgetMax: null,
    alertFrequency: 'instant',
  });
  const [preferenceDraft, setPreferenceDraft] = useState({
    sectors: '',
    categories: '',
    regions: '',
    opportunityTypes: '',
    budgetMin: '',
    budgetMax: '',
    alertFrequency: 'instant' as SponsorPreferences['alertFrequency'],
  });
  const [matchedNeeds, setMatchedNeeds] = useState<SponsorshipNeed[]>([]);
  const [sponsorDataLoading, setSponsorDataLoading] = useState(true);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [inquiredNeedIds, setInquiredNeedIds] = useState<Record<string, boolean>>({});
  const [inquiringNeedId, setInquiringNeedId] = useState<string | null>(null);
  const [savedOpportunities, setSavedOpportunities] = useState<SponsorSavedOpportunity[]>([]);
  const [watchlistBusyKey, setWatchlistBusyKey] = useState<string | null>(null);
  const [sponsorshipDeals, setSponsorshipDeals] = useState<SponsorshipDeal[]>([]);
  const [dealNotes, setDealNotes] = useState<Record<string, string>>({});
  const [dealUpdatingId, setDealUpdatingId] = useState<string | null>(null);
  const [sponsorRequests, setSponsorRequests] = useState<SponsorRequest[]>([]);
  const [sponsorRequestResponses, setSponsorRequestResponses] = useState<SponsorRequestResponse[]>([]);
  const [requestSaving, setRequestSaving] = useState(false);
  const [sponsorAnalytics, setSponsorAnalytics] = useState<SponsorPortfolioAnalytics>({
    meaningfulMatches: 0,
    highMatches: 0,
    inquiriesSent: 0,
    activeDeals: 0,
    negotiations: 0,
    contracts: 0,
    paidDeals: 0,
    completedDeals: 0,
    committedSpend: 0,
    paidSpend: 0,
    sponsorRequests: 0,
    organizerResponses: 0,
    acceptedRequestResponses: 0,
  });
  const [requestDraft, setRequestDraft] = useState({
    title: '',
    description: '',
    categories: '',
    regions: '',
    opportunityTypes: '',
    budgetMin: '',
    budgetMax: '',
    targetAudience: '',
    startDate: '',
    endDate: '',
  });
  const { showToast } = useToast();

  const listFromText = (value: string) =>
    [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];

  const loadSponsorMatching = async () => {
    setSponsorDataLoading(true);
    try {
      const [pref, needs, deals, requests, responses, analytics, watchlist] = await Promise.all([
        fetchMySponsorPreferences(),
        fetchMatchedSponsorshipNeeds(),
        fetchMySponsorshipDeals(),
        fetchMySponsorRequests(),
        fetchMySponsorRequestResponses(),
        fetchSponsorPortfolioAnalytics(),
        fetchSponsorWatchlist(),
      ]);
      setPreferences(pref);
      setPreferenceDraft({
        sectors: pref.sectors.join(', '),
        categories: pref.categories.join(', '),
        regions: pref.regions.join(', '),
        opportunityTypes: pref.opportunityTypes.join(', '),
        budgetMin: pref.budgetMin === null ? '' : String(pref.budgetMin),
        budgetMax: pref.budgetMax === null ? '' : String(pref.budgetMax),
        alertFrequency: pref.alertFrequency,
      });
      setMatchedNeeds(needs);
      setSponsorshipDeals(deals);
      setSponsorRequests(requests);
      setSponsorRequestResponses(responses);
      setSponsorAnalytics(analytics);
      setSavedOpportunities(watchlist);
    } catch {
      setMatchedNeeds([]);
    } finally {
      setSponsorDataLoading(false);
    }
  };

  useEffect(() => {
    loadSponsorMatching();
  }, []);

  const saveSponsorPreferences = async (event: React.FormEvent) => {
    event.preventDefault();
    setSavingPreferences(true);
    try {
      const payload: SponsorPreferences = {
        sectors: listFromText(preferenceDraft.sectors),
        categories: listFromText(preferenceDraft.categories),
        regions: listFromText(preferenceDraft.regions),
        opportunityTypes: listFromText(preferenceDraft.opportunityTypes),
        budgetMin: preferenceDraft.budgetMin ? Number(preferenceDraft.budgetMin) : null,
        budgetMax: preferenceDraft.budgetMax ? Number(preferenceDraft.budgetMax) : null,
        alertFrequency: preferenceDraft.alertFrequency,
      };
      const saved = await updateMySponsorPreferences(payload);
      setPreferences(saved);
      setMatchedNeeds(await fetchMatchedSponsorshipNeeds());
      showToast({
        type: 'success',
        title: 'Sponsor matching updated',
        message: 'Your Sponsor Pro preferences are now being used to rank sponsorship opportunities.',
      });
    } catch (error: any) {
      showToast({ type: 'info', title: 'Could not save preferences', message: error?.message || 'Please try again.' });
    } finally {
      setSavingPreferences(false);
    }
  };

  const handleNeedInquiry = async (need: SponsorshipNeed) => {
    if (inquiredNeedIds[need.id]) return;
    setInquiringNeedId(need.id);
    try {
      await inquireAboutSponsorshipNeed(need.id, {
        message: 'We are interested in discussing ' + need.title + ' for ' + need.conferenceTitle + '.',
        budget: need.priceAmount,
      });
      setInquiredNeedIds((prev) => ({ ...prev, [need.id]: true }));
      showToast({
        type: 'success',
        title: 'Inquiry sent',
        message: 'The organizer has been notified inside ConferenceGate.',
      });
    } catch (error: any) {
      showToast({ type: 'info', title: 'Could not send inquiry', message: error?.message || 'Please try again.' });
    } finally {
      setInquiringNeedId(null);
    }
  };

  const handleSponsorDealStatus = async (
    deal: SponsorshipDeal,
    status: 'negotiating' | 'agreement_reached' | 'contract_pending' | 'payment_pending' | 'delivering' | 'completed' | 'canceled'
  ) => {
    setDealUpdatingId(deal.id);
    try {
      const updated = await updateSponsorshipDeal(deal.id, { status });
      setSponsorshipDeals((prev) => prev.map((item) => item.id === updated.id ? updated : item));
    } catch (error: any) {
      showToast({ type: 'info', title: 'Could not update Deal Room', message: error?.message || 'Please try again.' });
    } finally {
      setDealUpdatingId(null);
    }
  };

  const handleSponsorDealNote = async (deal: SponsorshipDeal) => {
    const text = (dealNotes[deal.id] || '').trim();
    if (!text) return;
    setDealUpdatingId(deal.id);
    try {
      const update = await addSponsorshipDealUpdate(deal.id, { text });
      setSponsorshipDeals((prev) =>
        prev.map((item) => item.id === deal.id ? { ...item, updates: [...item.updates, update] } : item)
      );
      setDealNotes((prev) => ({ ...prev, [deal.id]: '' }));
    } catch (error: any) {
      showToast({ type: 'info', title: 'Could not post Deal Room update', message: error?.message || 'Please try again.' });
    } finally {
      setDealUpdatingId(null);
    }
  };

  const handleCreateSponsorRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!requestDraft.title.trim()) return;
    setRequestSaving(true);
    try {
      const request = await createSponsorRequest({
        title: requestDraft.title.trim(),
        description: requestDraft.description.trim() || undefined,
        categories: listFromText(requestDraft.categories),
        regions: listFromText(requestDraft.regions),
        opportunityTypes: listFromText(requestDraft.opportunityTypes),
        budgetMin: requestDraft.budgetMin ? Number(requestDraft.budgetMin) : null,
        budgetMax: requestDraft.budgetMax ? Number(requestDraft.budgetMax) : null,
        targetAudience: requestDraft.targetAudience.trim() || undefined,
        startDate: requestDraft.startDate || undefined,
        endDate: requestDraft.endDate || undefined,
      });
      setSponsorRequests((prev) => [request, ...prev]);
      setRequestDraft({
        title: '', description: '', categories: '', regions: '', opportunityTypes: '',
        budgetMin: '', budgetMax: '', targetAudience: '', startDate: '', endDate: '',
      });
      showToast({ type: 'success', title: 'Sponsor Request published', message: 'Paid organizers can now propose relevant conferences.' });
    } catch (error: any) {
      showToast({ type: 'info', title: 'Could not publish Sponsor Request', message: error?.message || 'Please try again.' });
    } finally {
      setRequestSaving(false);
    }
  };

  const handleSponsorRequestResponseDecision = async (responseId: string, status: 'accepted' | 'declined') => {
    try {
      await decideSponsorRequestResponse(responseId, status);
      setSponsorRequestResponses((prev) =>
        prev.map((item) => item.id === responseId ? { ...item, status } : item)
      );
    } catch (error: any) {
      showToast({ type: 'info', title: 'Could not update response', message: error?.message || 'Please try again.' });
    }
  };

  const watchlistKey = (sourceType: SponsorSavedOpportunity['sourceType'], sourceId: string) =>
    sourceType + ':' + sourceId;

  const savedByKey = useMemo(() => {
    const map = new Map<string, SponsorSavedOpportunity>();
    savedOpportunities.forEach((item) => map.set(watchlistKey(item.sourceType, item.sourceId), item));
    return map;
  }, [savedOpportunities]);

  const handleSaveOpportunity = async (
    sourceType: SponsorSavedOpportunity['sourceType'],
    sourceId: string
  ) => {
    const key = watchlistKey(sourceType, sourceId);
    if (savedByKey.has(key)) {
      setActiveTab('saved');
      return;
    }
    setWatchlistBusyKey(key);
    try {
      const item = await saveSponsorOpportunity(sourceType, sourceId);
      setSavedOpportunities((prev) => [item, ...prev.filter((saved) => saved.id !== item.id)]);
      showToast({
        type: 'success',
        title: 'Opportunity saved',
        message: 'This opportunity is now in your shared Sponsor Pro watchlist.',
      });
    } catch (error: any) {
      showToast({ type: 'info', title: 'Could not save opportunity', message: error?.message || 'Please try again.' });
    } finally {
      setWatchlistBusyKey(null);
    }
  };

  const handleSavedAlertToggle = async (item: SponsorSavedOpportunity) => {
    setWatchlistBusyKey('alert:' + item.id);
    try {
      const updated = await setSponsorWatchAlert(item.id, !item.alertEnabled);
      setSavedOpportunities((prev) => prev.map((saved) => saved.id === updated.id ? updated : saved));
    } catch (error: any) {
      showToast({ type: 'info', title: 'Could not update watch alert', message: error?.message || 'Please try again.' });
    } finally {
      setWatchlistBusyKey(null);
    }
  };

  const handleRemoveSavedOpportunity = async (item: SponsorSavedOpportunity) => {
    setWatchlistBusyKey('remove:' + item.id);
    try {
      await removeSponsorSavedOpportunity(item.id);
      setSavedOpportunities((prev) => prev.filter((saved) => saved.id !== item.id));
    } catch (error: any) {
      showToast({ type: 'info', title: 'Could not remove saved opportunity', message: error?.message || 'Please try again.' });
    } finally {
      setWatchlistBusyKey(null);
    }
  };

  const renderSaveButton = (
    sourceType: SponsorSavedOpportunity['sourceType'],
    sourceId: string,
    compact = false
  ) => {
    const saved = savedByKey.has(watchlistKey(sourceType, sourceId));
    const busy = watchlistBusyKey === watchlistKey(sourceType, sourceId);
    return (
      <button
        type="button"
        onClick={() => handleSaveOpportunity(sourceType, sourceId)}
        disabled={busy}
        className={
          (compact ? 'px-3 py-2.5' : 'w-full py-2.5') +
          ' rounded-xl border text-xs font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 ' +
          (saved
            ? 'bg-blue-50 border-blue-200 text-blue-700'
            : 'bg-white border-slate-200 text-slate-700 hover:border-blue-300')
        }
      >
        {saved ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
        {saved ? 'Saved' : 'Save'}
      </button>
    );
  };

  const unreadAlertCount = sponsorAlerts.filter((a) => !a.read).length;

  const handleJumpToAlerts = () => {
    setActiveTab('marketplace');
    setTimeout(() => alertsPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const verified = isSponsorVerified(sponsorProfile);

  const applicationByPackageId = useMemo(() => {
    const map = new Map<string, SponsorApplicationSummary>();
    myApplications.forEach((a) => map.set(a.packageId, a));
    return map;
  }, [myApplications]);

  const handleApplySponsorship = (packageId: string) => {
    if (!verified || applicationByPackageId.has(packageId)) return;
    onApplyForSponsorship(packageId);
  };

  const opportunityById = useMemo(
    () => new Map(sponsorshipOpportunities.map((o) => [o.id, o])),
    [sponsorshipOpportunities]
  );

  // Packages an organizer created directly vs. ones activated from the opportunity catalog —
  // the latter get a match % against this sponsor's real profile.
  const standardPackages = sponsorshipPackages.filter((p) => !p.sourceOpportunityId);
  const suggestedPackages = useMemo(() => {
    return sponsorshipPackages
      .filter((p) => !!p.sourceOpportunityId)
      .map((pkg) => {
        const opportunityId = pkg.sourceOpportunityId!.split('__')[0];
        const opp = opportunityById.get(opportunityId);
        return {
          pkg,
          opportunityName: opp?.name || pkg.tier,
          opportunityDescription: opp?.description || '',
          matchScore: sponsorOpportunityMatch(sponsorProfile, opp?.idealSectors || []),
        };
      })
      .sort((a, b) => b.matchScore - a.matchScore);
  }, [sponsorshipPackages, opportunityById, sponsorProfile]);

  const sortedHistory = [...(sponsorProfile.sponsorshipHistory || [])].sort((a, b) => b.year - a.year);
  const historyYearsSpan = sortedHistory.length > 0 ? sortedHistory[0].year - sortedHistory[sortedHistory.length - 1].year + 1 : 0;

  const renderApplyButton = (packageId: string) => {
    const application = applicationByPackageId.get(packageId);
    if (application) {
      if (application.status === 'Approved') {
        return (
          <div className="w-full py-3 bg-emerald-50 text-emerald-700 font-bold text-xs rounded-xl text-center flex items-center justify-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" />
            Approved
          </div>
        );
      }
      if (application.status === 'Rejected') {
        return (
          <div className="w-full py-3 bg-slate-100 text-slate-500 font-bold text-xs rounded-xl text-center">
            Not approved this time
          </div>
        );
      }
      return (
        <div className="w-full py-3 bg-blue-50 text-blue-700 font-bold text-xs rounded-xl text-center flex items-center justify-center gap-1.5">
          <Clock className="w-4 h-4" />
          Applied — Pending Review
        </div>
      );
    }
    return (
      <button
        onClick={() => handleApplySponsorship(packageId)}
        disabled={!verified}
        className="w-full py-3 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-md transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-blue-900"
      >
        {verified ? 'Apply for Sponsorship' : 'Applications Restricted'}
      </button>
    );
  };

  return (
    <div className="space-y-8">
      {/* Top Banner */}
      <div className="bg-blue-50 text-slate-900 rounded-3xl p-6 sm:p-8 shadow-xs border border-blue-100">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 bg-white text-blue-700 border border-blue-200 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Briefcase className="w-3.5 h-3.5 text-blue-600" />
                Corporate Sponsorship Marketplace
              </span>
              {verified ? (
                <span className="px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Verified Sponsor
                </span>
              ) : (
                <span className="px-3 py-1 bg-rose-50 text-rose-700 border border-rose-200 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  Registration Restricted
                </span>
              )}
              {sponsorAlerts.length > 0 && (
                <button
                  onClick={handleJumpToAlerts}
                  className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 cursor-pointer transition-colors ${
                    unreadAlertCount > 0
                      ? 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100'
                      : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {unreadAlertCount > 0 ? <BellRing className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
                  {unreadAlertCount > 0
                    ? `${unreadAlertCount} New Opportunity Alert${unreadAlertCount === 1 ? '' : 's'} From Organizer`
                    : 'Opportunity Alerts'}
                </button>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
              Sponsor Marketplace & ROI Dashboard
            </h1>
            <p className="text-xs text-slate-600">
              Connect corporate brands with world-class technical and scientific conferences, and track your
              sponsorship packages, applications, and organizer ratings in one place.
            </p>
          </div>

          <div className="bg-white border border-slate-200 p-4 rounded-2xl flex items-center gap-6 shrink-0 shadow-xs">
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-400">Sponsor Rating</div>
              <div className="text-2xl font-extrabold text-blue-700">{sponsorProfile.rating.toFixed(1)}/5</div>
            </div>
            <div className="border-l border-slate-200 pl-6">
              <div className="text-[10px] uppercase font-bold text-slate-400">Organizer Reviews</div>
              <div className="text-2xl font-extrabold text-emerald-600">{sponsorProfile.reviewsCount}</div>
            </div>
          </div>
        </div>
      </div>

      {!verified && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="text-xs text-rose-800">
            <span className="font-bold">Your account cannot apply for new sponsorships right now.</span>{' '}
            {sponsorVerificationReason(sponsorProfile)} Conference Gate requires a minimum {SPONSOR_RATING_THRESHOLD.toFixed(1)}/5
            rating from past organizers before a sponsor can register for opportunities. See your Sponsor
            Profile tab for details and past feedback.
          </div>
        </div>
      )}

      {/* Navigation Sub-Tabs */}
      <div className="bg-white rounded-2xl border border-slate-200 p-2 flex gap-2 overflow-x-auto text-xs font-semibold text-slate-600">
        <button
          onClick={() => setActiveTab('matches')}
          className={`px-4 py-2.5 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'matches'
              ? 'bg-blue-600 text-white font-bold shadow-xs'
              : 'hover:bg-slate-100 text-slate-700'
          }`}
        >
          <Target className="w-3.5 h-3.5" />
          Matched Opportunities ({matchedNeeds.length})
        </button>
        <button
          onClick={() => setActiveTab('marketplace')}
          className={`px-4 py-2.5 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'marketplace'
              ? 'bg-blue-600 text-white font-bold shadow-xs'
              : 'hover:bg-slate-100 text-slate-700'
          }`}
        >
          Sponsorship Marketplace ({sponsorshipPackages.length})
          {unreadAlertCount > 0 && (
            <span className="min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
              {unreadAlertCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('saved')}
          className={
            'px-4 py-2.5 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 ' +
            (activeTab === 'saved'
              ? 'bg-blue-600 text-white font-bold shadow-xs'
              : 'hover:bg-slate-100 text-slate-700')
          }
        >
          <Bookmark className="w-3.5 h-3.5" />
          Saved ({savedOpportunities.length})
        </button>
        <button
          onClick={() => setActiveTab('requests')}
          className={`px-4 py-2.5 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'requests'
              ? 'bg-blue-600 text-white font-bold shadow-xs'
              : 'hover:bg-slate-100 text-slate-700'
          }`}
        >
          <Target className="w-3.5 h-3.5" />
          My Sponsor Requests ({sponsorRequests.length})
        </button>
        <button
          onClick={() => setActiveTab('deals')}
          className={`px-4 py-2.5 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'deals'
              ? 'bg-blue-600 text-white font-bold shadow-xs'
              : 'hover:bg-slate-100 text-slate-700'
          }`}
        >
          <Briefcase className="w-3.5 h-3.5" />
          Deal Rooms ({sponsorshipDeals.length})
        </button>
        <button
          onClick={() => setActiveTab('preferences')}
          className={`px-4 py-2.5 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'preferences'
              ? 'bg-blue-600 text-white font-bold shadow-xs'
              : 'hover:bg-slate-100 text-slate-700'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Matching Preferences
        </button>
        <button
          onClick={() => setActiveTab('workspace')}
          className={`px-4 py-2.5 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'workspace'
              ? 'bg-blue-600 text-white font-bold shadow-xs'
              : 'hover:bg-slate-100 text-slate-700'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          Team & Access
        </button>
        <button
          onClick={() => setActiveTab('payments')}
          className={`px-4 py-2.5 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'payments'
              ? 'bg-blue-600 text-white font-bold shadow-xs'
              : 'hover:bg-slate-100 text-slate-700'
          }`}
        >
          <DollarSign className="w-3.5 h-3.5" />
          Payment Ledger
        </button>
        <button
          onClick={() => setActiveTab('roi')}
          className={`px-4 py-2.5 rounded-xl transition-colors cursor-pointer ${
            activeTab === 'roi'
              ? 'bg-blue-600 text-white font-bold shadow-xs'
              : 'hover:bg-slate-100 text-slate-700'
          }`}
        >
          Sponsor ROI Dashboard & Leads
        </button>
        <button
          onClick={() => setActiveTab('profile')}
          className={`px-4 py-2.5 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'profile'
              ? 'bg-blue-600 text-white font-bold shadow-xs'
              : 'hover:bg-slate-100 text-slate-700'
          }`}
        >
          Sponsor Profile & Verification
          <StarRating rating={sponsorProfile.rating} size="w-3 h-3" />
        </button>
      </div>

      {/* Sponsor Pro: internally matched organizer sponsorship needs */}
      {activeTab === 'matches' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <h2 className="text-lg font-bold text-slate-900">Matched Sponsorship Opportunities</h2>
            <p className="text-xs text-slate-500 mt-1">
              Ranked against your saved sectors, categories, regions, opportunity types, and budget. These are organizer-published needs inside ConferenceGate.
            </p>
          </div>

          {sponsorDataLoading ? (
            <div className="p-8 bg-white rounded-2xl border border-slate-200 text-center text-xs text-slate-500">
              Loading Sponsor Pro matches…
            </div>
          ) : matchedNeeds.length === 0 ? (
            <div className="p-8 bg-white rounded-2xl border border-slate-200 text-center">
              <Target className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <h3 className="text-sm font-bold text-slate-800">No internal sponsorship needs yet</h3>
              <p className="text-xs text-slate-500 mt-1">
                Complete Matching Preferences and ConferenceGate will rank new organizer opportunities here.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {matchedNeeds.map((need) => {
                const inquired = Boolean(inquiredNeedIds[need.id]);
                return (
                  <div key={need.id} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-extrabold">
                            {need.matchScore ?? 0}% Match
                          </span>
                          {need.deadline && (
                            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold">
                              Deadline {need.deadline}
                            </span>
                          )}
                        </div>
                        <h3 className="font-bold text-base text-slate-900 mt-2">{need.title}</h3>
                        <p className="text-xs text-slate-500">{need.conferenceTitle}</p>
                      </div>
                      <div className="text-right shrink-0">
                        {need.priceOnRequest ? (
                          <>
                            <div className="text-sm font-extrabold text-blue-700">Inquire</div>
                            <div className="text-[9px] uppercase text-slate-400 font-bold">Price on request</div>
                          </>
                        ) : (
                          <>
                            <div className="text-sm font-extrabold text-blue-700">${Number(need.priceAmount || 0).toLocaleString()}</div>
                            <div className="text-[9px] uppercase text-slate-400 font-bold">Published price</div>
                          </>
                        )}
                      </div>
                    </div>

                    {need.description && <p className="text-xs text-slate-600 leading-relaxed">{need.description}</p>}

                    <div className="flex flex-wrap gap-1.5">
                      {[...need.categories, ...need.targetSectors, ...need.opportunityTypes].slice(0, 10).map((item) => (
                        <span key={item} className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[10px] font-semibold">
                          {item}
                        </span>
                      ))}
                    </div>

                    {need.benefits.length > 0 && (
                      <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-100 rounded-xl p-3">
                        {need.benefits.slice(0, 4).join(' · ')}
                      </div>
                    )}

                    <div className="grid grid-cols-[auto_1fr] gap-2">
                      {renderSaveButton('internal_need', need.id, true)}
                      <button
                        onClick={() => handleNeedInquiry(need)}
                        disabled={inquired || inquiringNeedId === need.id}
                        className={
                          'w-full py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer disabled:cursor-default ' +
                          (inquired
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-blue-900 hover:bg-blue-950 text-white disabled:opacity-60')
                        }
                      >
                        {inquired ? <CheckCircle2 className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                        {inquired ? 'Inquiry Sent' : 'Inquire with Organizer'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 1: Marketplace */}
      {activeTab === 'marketplace' && (
        <div className="space-y-8">
          {sponsorAlerts.length > 0 && (
            <div ref={alertsPanelRef} className="space-y-2 scroll-mt-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  {unreadAlertCount > 0 ? (
                    <BellRing className="w-4 h-4 text-blue-600" />
                  ) : (
                    <Bell className="w-4 h-4 text-slate-400" />
                  )}
                  Opportunity Alerts
                  {unreadAlertCount > 0 && (
                    <span className="text-[11px] font-normal text-slate-500">({unreadAlertCount} unread)</span>
                  )}
                </h2>
                {unreadAlertCount > 0 && (
                  <button
                    onClick={onMarkAllAlertsRead}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-600 font-bold text-[11px] rounded-full cursor-pointer transition-colors"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    Mark all as read
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {sponsorAlerts.map((alert) => (
                  <button
                    key={alert.id}
                    onClick={() => onMarkAlertRead(alert.id)}
                    className={`w-full text-left p-4 rounded-2xl border flex items-start justify-between gap-3 transition-colors cursor-pointer ${
                      alert.read ? 'bg-white border-slate-200' : 'bg-blue-50/60 border-blue-200 hover:bg-blue-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-slate-900">{alert.title}</span>
                        {!alert.read && <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0" />}
                      </div>
                      <p className="text-[11px] text-slate-600 mt-0.5">{alert.message}</p>
                      <div className="text-[10px] text-slate-400 mt-1">{alert.timestamp}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {standardPackages.length === 0 && suggestedPackages.length === 0 ? (
            <div className="p-8 bg-white rounded-3xl border border-slate-200 text-center text-xs text-slate-400 font-medium">
              No sponsorship packages have been published by organizers yet. Check back soon.
            </div>
          ) : (
            <>
              {standardPackages.length > 0 && (
                <div className="space-y-3">
                  <h2 className="text-sm font-bold text-slate-900">Published Sponsorship Packages</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {standardPackages.map((pkg) => (
                      <div
                        key={pkg.id}
                        className="bg-white rounded-3xl border border-slate-200 p-6 flex flex-col justify-between space-y-6 shadow-xs hover:border-blue-400 transition-all"
                      >
                        <div className="space-y-4">
                          <div className="flex items-center justify-between gap-2">
                            <span className="px-3 py-1 bg-blue-100 text-blue-900 font-extrabold text-xs rounded-full uppercase tracking-wider">
                              {pkg.tier} Tier
                            </span>
                            <span className="text-2xl font-extrabold text-slate-900">
                              ${pkg.price.toLocaleString()}
                            </span>
                          </div>

                          <div>
                            <h3 className="font-bold text-base text-slate-900">{pkg.tier} Sponsorship Package</h3>
                            <p className="text-xs text-slate-500">{pkg.conferenceTitle}</p>
                          </div>

                          {(pkg.boothSpace || pkg.speakingOps) && (
                            <p className="text-xs text-slate-600 leading-relaxed">
                              {[pkg.boothSpace, pkg.speakingOps].filter(Boolean).join(' • ')}
                            </p>
                          )}

                          <div className="text-[11px] text-slate-500">
                            {pkg.availableSlots} of {pkg.totalSlots} slots available
                          </div>

                          {pkg.benefits.length > 0 && (
                            <div className="space-y-2 pt-2 border-t border-slate-100">
                              <div className="text-[10px] font-bold uppercase text-slate-400">Included Benefits</div>
                              <ul className="space-y-1.5 text-xs text-slate-700">
                                {pkg.benefits.map((ben, idx) => (
                                  <li key={idx} className="flex items-center gap-2">
                                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                    <span>{ben}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>

                        <div className="space-y-2">
                          {renderApplyButton(pkg.id)}
                          {renderSaveButton('package', pkg.id)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {suggestedPackages.length > 0 && (
                <div className="space-y-3">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">Organizer-Suggested Sponsorship Opportunities</h2>
                    <p className="text-xs text-slate-500">
                      Curated add-on opportunities organizers have activated, ranked by how well they match your
                      sponsor profile.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {suggestedPackages.map(({ pkg, opportunityName, opportunityDescription, matchScore }) => (
                      <div
                        key={pkg.id}
                        className="bg-white rounded-3xl border border-slate-200 p-6 flex flex-col justify-between space-y-6 shadow-xs hover:border-blue-400 transition-all"
                      >
                        <div className="space-y-4">
                          <div className="flex items-center justify-between gap-2">
                            <span className="px-3 py-1 bg-emerald-100 text-emerald-800 font-extrabold text-xs rounded-full flex items-center gap-1">
                              <Sparkles className="w-3 h-3" />
                              {matchScore}% Match
                            </span>
                            <span className="text-2xl font-extrabold text-slate-900">
                              ${pkg.price.toLocaleString()}
                            </span>
                          </div>

                          <div>
                            <h3 className="font-bold text-base text-slate-900">{opportunityName}</h3>
                            <p className="text-xs text-slate-500">
                              {pkg.tier} · {pkg.conferenceTitle}
                            </p>
                          </div>

                          {opportunityDescription && (
                            <p className="text-xs text-slate-600 leading-relaxed">{opportunityDescription}</p>
                          )}

                          <div className="text-[11px] text-slate-500">
                            {pkg.availableSlots} of {pkg.totalSlots} slots available
                          </div>

                          {pkg.benefits.length > 0 && (
                            <div className="space-y-2 pt-2 border-t border-slate-100">
                              <div className="text-[10px] font-bold uppercase text-slate-400">Included Benefits</div>
                              <ul className="space-y-1.5 text-xs text-slate-700">
                                {pkg.benefits.map((ben, idx) => (
                                  <li key={idx} className="flex items-center gap-2">
                                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                    <span>{ben}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>

                        <div className="space-y-2">
                          {renderApplyButton(pkg.id)}
                          {renderSaveButton('package', pkg.id)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Sponsor Pro shared saved-opportunity watchlist */}
      {activeTab === 'saved' && (
        <div className="space-y-6">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
              <div>
                <span className="text-[10px] font-bold uppercase text-blue-600">Sponsor Pro Watchlist</span>
                <h2 className="text-xl font-bold text-slate-900 mt-1">Saved Sponsorship Opportunities</h2>
                <p className="text-xs text-slate-500 mt-1 max-w-2xl">
                  Shared across your Sponsor Pro workspace. The bell controls alerts for each item; the delivery
                  cadence comes from Matching Preferences.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('preferences')}
                className="px-4 py-3 rounded-xl bg-blue-50 border border-blue-100 text-blue-700 text-xs font-bold cursor-pointer"
              >
                Alerts: {preferences.alertFrequency}
              </button>
            </div>
          </div>

          {savedOpportunities.length === 0 ? (
            <div className="p-10 bg-white rounded-3xl border border-slate-200 text-center">
              <Bookmark className="w-9 h-9 text-slate-300 mx-auto mb-2" />
              <h3 className="text-sm font-bold text-slate-800">Your watchlist is empty</h3>
              <p className="text-xs text-slate-500 mt-1">
                Save matched opportunities or organizer-published packages to compare them here.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {savedOpportunities.map((item) => {
                const snapshot = item.snapshot || {};
                const isNeed = item.sourceType === 'internal_need';
                const isPackage = item.sourceType === 'package';
                const price = isNeed ? snapshot.priceAmount : isPackage ? snapshot.price : null;
                const priceOnRequest = isNeed && Boolean(snapshot.priceOnRequest);
                const benefits = Array.isArray(snapshot.benefits) ? snapshot.benefits : [];
                return (
                  <div key={item.id} className="bg-white rounded-3xl border border-slate-200 p-5 shadow-xs space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[9px] font-bold uppercase">
                          {isNeed ? 'Matched Need' : isPackage ? 'Published Package' : 'Official External'}
                        </span>
                        <h3 className="font-bold text-sm text-slate-900 mt-2">{item.title}</h3>
                        <p className="text-[11px] text-slate-500">{item.conferenceTitle}</p>
                      </div>
                      <div className="text-right shrink-0">
                        {priceOnRequest ? (
                          <div className="text-sm font-extrabold text-blue-700">Price on request</div>
                        ) : Number.isFinite(Number(price)) ? (
                          <div className="text-sm font-extrabold text-blue-700">
                            {'
      {activeTab === 'requests' && (
        <div className="space-y-6">
          <form onSubmit={handleCreateSponsorRequest} className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Publish What You Want to Sponsor</h2>
              <p className="text-xs text-slate-500 mt-1">
                Create a Sponsor Request and let paid organizers respond with relevant conferences. ConferenceGate does not expose your private email.
              </p>
            </div>
            <input
              required
              value={requestDraft.title}
              onChange={(e) => setRequestDraft({ ...requestDraft, title: e.target.value })}
              placeholder="e.g. Seeking GCC energy conferences for 2027"
              className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs"
            />
            <textarea
              rows={3}
              value={requestDraft.description}
              onChange={(e) => setRequestDraft({ ...requestDraft, description: e.target.value })}
              placeholder="Describe the audience, strategic objective, or sponsorship type you want."
              className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input value={requestDraft.categories} onChange={(e) => setRequestDraft({ ...requestDraft, categories: e.target.value })} placeholder="Categories, comma separated" className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs" />
              <input value={requestDraft.regions} onChange={(e) => setRequestDraft({ ...requestDraft, regions: e.target.value })} placeholder="Regions, comma separated" className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs" />
              <input value={requestDraft.opportunityTypes} onChange={(e) => setRequestDraft({ ...requestDraft, opportunityTypes: e.target.value })} placeholder="Booth, dinner, session, title..." className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs" />
              <input value={requestDraft.targetAudience} onChange={(e) => setRequestDraft({ ...requestDraft, targetAudience: e.target.value })} placeholder="Target audience: CIOs, geoscientists..." className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs" />
              <input type="number" min="0" value={requestDraft.budgetMin} onChange={(e) => setRequestDraft({ ...requestDraft, budgetMin: e.target.value })} placeholder="Minimum budget" className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs" />
              <input type="number" min="0" value={requestDraft.budgetMax} onChange={(e) => setRequestDraft({ ...requestDraft, budgetMax: e.target.value })} placeholder="Maximum budget" className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs" />
              <input type="date" value={requestDraft.startDate} onChange={(e) => setRequestDraft({ ...requestDraft, startDate: e.target.value })} className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs" />
              <input type="date" value={requestDraft.endDate} onChange={(e) => setRequestDraft({ ...requestDraft, endDate: e.target.value })} className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs" />
            </div>
            <button disabled={requestSaving} className="w-full py-3 rounded-xl bg-blue-900 hover:bg-blue-950 text-white text-xs font-bold cursor-pointer disabled:opacity-60">
              {requestSaving ? 'Publishing…' : 'Publish Sponsor Request'}
            </button>
          </form>

          {sponsorRequests.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {sponsorRequests.map((request) => (
                <div key={request.id} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-bold text-sm text-slate-900">{request.title}</h3>
                      <p className="text-[11px] text-slate-500">{request.responseCount} organizer response{request.responseCount === 1 ? '' : 's'}</p>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase">{request.status}</span>
                  </div>
                  {request.description && <p className="text-xs text-slate-600">{request.description}</p>}
                  <div className="flex flex-wrap gap-1">
                    {[...request.categories, ...request.regions, ...request.opportunityTypes].slice(0, 10).map((item) => (
                      <span key={item} className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[9px] font-semibold">{item}</span>
                    ))}
                  </div>
                  {(request.budgetMin !== null || request.budgetMax !== null) && (
                    <div className="text-xs font-bold text-blue-700">
                      Budget: {request.budgetMin !== null ? `${request.budgetMin.toLocaleString()}` : 'Any'} – {request.budgetMax !== null ? `${request.budgetMax.toLocaleString()}` : 'Open'}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100">
              <h3 className="font-bold text-sm text-slate-900">Organizer Responses</h3>
              <p className="text-xs text-slate-500 mt-1">Accept a relevant conference proposal or decline it.</p>
            </div>
            {sponsorRequestResponses.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">No organizer responses yet.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {sponsorRequestResponses.map((response) => (
                  <div key={response.id} className="p-5 flex flex-col md:flex-row md:items-center gap-4 justify-between">
                    <div>
                      <div className="font-bold text-xs text-slate-900">{response.conferenceTitle}</div>
                      <div className="text-[11px] text-slate-500">{response.organizerName} · Responded to: {response.requestTitle}</div>
                      {response.message && <p className="text-[11px] text-slate-600 mt-1">{response.message}</p>}
                    </div>
                    {response.status === 'new' ? (
                      <div className="flex gap-2 shrink-0">
                        <button onClick={() => handleSponsorRequestResponseDecision(response.id, 'declined')} className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 cursor-pointer">Decline</button>
                        <button onClick={() => handleSponsorRequestResponseDecision(response.id, 'accepted')} className="px-3 py-2 rounded-lg bg-blue-900 text-white text-xs font-bold cursor-pointer">Accept</button>
                      </div>
                    ) : (
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${
                        response.status === 'accepted' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                      }`}>{response.status}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sponsor Pro shared commercial Deal Rooms */}
      {activeTab === 'deals' && (
        <div className="space-y-5">
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <h2 className="text-lg font-bold text-slate-900">Sponsorship Deal Rooms</h2>
            <p className="text-xs text-slate-500 mt-1">
              Private deal workspaces with organizers. Commercial terms, deliverables, contracts, invoices, status history, and provider-confirmed payment are kept together.
            </p>
          </div>

          {sponsorshipDeals.length === 0 ? (
            <div className="p-8 bg-white rounded-2xl border border-slate-200 text-center">
              <Briefcase className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <h3 className="text-sm font-bold text-slate-800">No active Deal Rooms yet</h3>
              <p className="text-xs text-slate-500 mt-1">
                A Deal Room opens when an organizer moves your sponsorship inquiry into negotiation.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {sponsorshipDeals.map((deal) => (
                <div key={deal.id} className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-5">
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap gap-2">
                        <span className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 text-[10px] font-extrabold uppercase">
                          {deal.status.replace(/_/g, ' ')}
                        </span>
                        {deal.status === 'paid' && (
                          <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold">
                            Payment provider confirmed
                          </span>
                        )}
                      </div>
                      <h3 className="font-extrabold text-base text-slate-900 mt-2">{deal.opportunityTitle}</h3>
                      <p className="text-xs text-slate-500">{deal.conferenceTitle} · Organizer: {deal.counterpartName}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-slate-400 uppercase font-bold">Agreed amount</div>
                      <div className="text-lg font-extrabold text-blue-700">
                        {deal.agreedAmount === null ? 'Not set' : `${deal.currency} ${Number(deal.agreedAmount).toLocaleString()}`}
                      </div>
                    </div>
                  </div>

                  {deal.proposalNotes && (
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                      <div className="text-[10px] uppercase font-bold text-slate-400">Commercial terms</div>
                      <p className="text-xs text-slate-700 mt-1 whitespace-pre-wrap">{deal.proposalNotes}</p>
                    </div>
                  )}

                  {deal.deliverables.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase font-bold text-slate-400 mb-2">Deliverables</div>
                      <div className="flex flex-wrap gap-1.5">
                        {deal.deliverables.map((item) => (
                          <span key={item} className="px-2 py-1 rounded-md bg-blue-50 text-blue-700 text-[10px] font-semibold">{item}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {deal.contractUrl && (
                      <a href={deal.contractUrl} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-lg bg-slate-100 text-blue-700 text-[10px] font-bold">
                        View Contract
                      </a>
                    )}
                    {deal.invoiceUrl && (
                      <a href={deal.invoiceUrl} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-lg bg-slate-100 text-blue-700 text-[10px] font-bold">
                        View Invoice
                      </a>
                    )}
                    {deal.status === 'agreement_reached' && (
                      <button
                        onClick={() => handleSponsorDealStatus(deal, 'contract_pending')}
                        disabled={dealUpdatingId === deal.id}
                        className="px-3 py-2 rounded-lg bg-blue-900 text-white text-[10px] font-bold cursor-pointer disabled:opacity-50"
                      >
                        Proceed to Contract
                      </button>
                    )}
                    {deal.status === 'contract_pending' && (
                      <button
                        onClick={() => handleSponsorDealStatus(deal, 'payment_pending')}
                        disabled={dealUpdatingId === deal.id}
                        className="px-3 py-2 rounded-lg bg-blue-900 text-white text-[10px] font-bold cursor-pointer disabled:opacity-50"
                      >
                        Contract Accepted · Await Payment
                      </button>
                    )}
                  </div>

                  {deal.status === 'payment_pending' && (
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
                      Payment is pending. ConferenceGate will show <strong>Paid</strong> only after the configured payment provider confirms settlement.
                    </div>
                  )}

                  <div className="max-h-48 overflow-y-auto space-y-2">
                    {deal.updates.map((update) => (
                      <div key={update.id} className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-[10px] text-slate-600">
                        <div className="font-bold text-slate-800 uppercase">{update.kind}</div>
                        <div>{update.text}</div>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <input
                      value={dealNotes[deal.id] || ''}
                      onChange={(e) => setDealNotes((prev) => ({ ...prev, [deal.id]: e.target.value }))}
                      placeholder="Add a note or question to the Deal Room..."
                      className="flex-1 p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs"
                    />
                    <button
                      onClick={() => handleSponsorDealNote(deal)}
                      disabled={!String(dealNotes[deal.id] || '').trim() || dealUpdatingId === deal.id}
                      className="px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      Send
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sponsor Pro matching preferences */}
      {activeTab === 'preferences' && (
        <div className="max-w-3xl mx-auto">
          <form onSubmit={saveSponsorPreferences} className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-5">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Sponsor Matching Preferences</h2>
              <p className="text-xs text-slate-500 mt-1">
                ConferenceGate uses these saved preferences for in-app matching and alerts. It does not send pre-signup notifications.
              </p>
            </div>

            {[
              ['Sectors / Industries', 'sectors', 'Energy, Oil & Gas, Artificial Intelligence'],
              ['Conference Categories', 'categories', 'Petroleum & Geoscience, Energy, Engineering'],
              ['Regions', 'regions', 'Middle East, Europe, North America'],
              ['Opportunity Types', 'opportunityTypes', 'Exhibition Booth, Gala Dinner, Technical Session'],
            ].map(([label, key, placeholder]) => (
              <div key={key}>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5">{label}</label>
                <input
                  value={(preferenceDraft as any)[key]}
                  onChange={(e) => setPreferenceDraft({ ...preferenceDraft, [key]: e.target.value })}
                  placeholder={placeholder}
                  className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs"
                />
                <p className="text-[9px] text-slate-400 mt-1">Separate values with commas.</p>
              </div>
            ))}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5">Minimum Budget</label>
                <div className="relative">
                  <DollarSign className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="number"
                    min="0"
                    value={preferenceDraft.budgetMin}
                    onChange={(e) => setPreferenceDraft({ ...preferenceDraft, budgetMin: e.target.value })}
                    className="w-full pl-9 pr-3 py-3 rounded-xl bg-slate-50 border border-slate-200 text-xs"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5">Maximum Budget</label>
                <div className="relative">
                  <DollarSign className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="number"
                    min="0"
                    value={preferenceDraft.budgetMax}
                    onChange={(e) => setPreferenceDraft({ ...preferenceDraft, budgetMax: e.target.value })}
                    className="w-full pl-9 pr-3 py-3 rounded-xl bg-slate-50 border border-slate-200 text-xs"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5">Alert Frequency</label>
              <select
                value={preferenceDraft.alertFrequency}
                onChange={(e) =>
                  setPreferenceDraft({
                    ...preferenceDraft,
                    alertFrequency: e.target.value as SponsorPreferences['alertFrequency'],
                  })
                }
                className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold"
              >
                <option value="instant">Instant for strong matches</option>
                <option value="daily">Daily summary</option>
                <option value="weekly">Weekly summary</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={savingPreferences}
              className="w-full py-3 rounded-xl bg-blue-900 hover:bg-blue-950 text-white text-xs font-bold cursor-pointer disabled:opacity-60"
            >
              {savingPreferences ? 'Saving…' : 'Save Matching Preferences'}
            </button>
          </form>
        </div>
      )}

      {/* Paid Sponsor Pro: Team & Access */}
      {activeTab === 'workspace' && (
        <WorkspaceTeamPanel accountLabel="Sponsor Pro" />
      )}

      {activeTab === 'payments' && (
        <BillingLedgerPanel perspective="sponsor" />
      )}

      {/* Sponsor Pro: real portfolio analytics */}
      {activeTab === 'roi' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <h2 className="text-lg font-bold text-slate-900">Sponsor Pro Portfolio Analytics</h2>
            <p className="text-xs text-slate-500 mt-1">
              These metrics come from your real ConferenceGate matching, inquiries, Deal Rooms, Sponsor Requests, and provider-confirmed payments. No impression or lead numbers are invented.
            </p>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              ['Strong Matches', sponsorAnalytics.meaningfulMatches, '45%+ profile match'],
              ['High Matches', sponsorAnalytics.highMatches, '70%+ profile match'],
              ['Inquiries Sent', sponsorAnalytics.inquiriesSent, 'Internal organizer inquiries'],
              ['Active Deal Rooms', sponsorAnalytics.activeDeals, 'Open commercial workflows'],
              ['Negotiating', sponsorAnalytics.negotiations, 'Negotiation through payment pending'],
              ['Contracts', sponsorAnalytics.contracts, 'Contract stage or later'],
              ['Paid Deals', sponsorAnalytics.paidDeals, 'Provider-confirmed'],
              ['Completed Deals', sponsorAnalytics.completedDeals, 'Delivered and completed'],
            ].map(([label, value, note]) => (
              <div key={String(label)} className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs">
                <div className="text-[10px] font-bold uppercase text-slate-400">{label}</div>
                <div className="text-2xl font-extrabold text-slate-900 mt-1">{value}</div>
                <div className="text-[10px] text-slate-500 mt-1">{note}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-6 rounded-3xl bg-blue-50 border border-blue-100">
              <div className="text-[10px] font-bold uppercase text-blue-500">Committed Sponsorship Spend</div>
              <div className="text-3xl font-extrabold text-blue-900 mt-2">
                {'$'}{sponsorAnalytics.committedSpend.toLocaleString()}
              </div>
              <p className="text-[11px] text-blue-700 mt-1">
                Agreed deals from agreement reached onward. This is not the same as money settled.
              </p>
            </div>
            <div className="p-6 rounded-3xl bg-emerald-50 border border-emerald-100">
              <div className="text-[10px] font-bold uppercase text-emerald-600">Provider-Confirmed Paid Spend</div>
              <div className="text-3xl font-extrabold text-emerald-900 mt-2">
                {'$'}{sponsorAnalytics.paidSpend.toLocaleString()}
              </div>
              <p className="text-[11px] text-emerald-700 mt-1">
                Only deals confirmed paid by the configured payment-provider settlement sync.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-5 bg-white rounded-2xl border border-slate-200">
              <div className="text-[10px] uppercase font-bold text-slate-400">Sponsor Requests</div>
              <div className="text-xl font-extrabold text-slate-900 mt-1">{sponsorAnalytics.sponsorRequests}</div>
              <div className="text-[10px] text-slate-500">Requests you published</div>
            </div>
            <div className="p-5 bg-white rounded-2xl border border-slate-200">
              <div className="text-[10px] uppercase font-bold text-slate-400">Organizer Responses</div>
              <div className="text-xl font-extrabold text-slate-900 mt-1">{sponsorAnalytics.organizerResponses}</div>
              <div className="text-[10px] text-slate-500">Conference proposals received</div>
            </div>
            <div className="p-5 bg-white rounded-2xl border border-slate-200">
              <div className="text-[10px] uppercase font-bold text-slate-400">Accepted Proposals</div>
              <div className="text-xl font-extrabold text-slate-900 mt-1">{sponsorAnalytics.acceptedRequestResponses}</div>
              <div className="text-[10px] text-slate-500">Reverse-marketplace proposals accepted</div>
            </div>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-[11px] text-slate-500">
            Audience impressions, booth visitors, lead scans, QR interactions, and sponsored-session engagement remain unavailable until ConferenceGate has a real event-tracking source for them. They are intentionally not estimated.
          </div>
        </div>
      )}

      {/* Tab 3: Sponsor Profile & Verification */}
      {activeTab === 'profile' && (
        <div className="space-y-6">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <img
                  src={sponsorProfile.logo || undefined}
                  alt={sponsorProfile.companyName}
                  className="w-16 h-16 rounded-2xl object-cover ring-2 ring-slate-100"
                />
                <div>
                  <h2 className="text-lg font-bold text-slate-900">{sponsorProfile.companyName}</h2>
                  <p className="text-xs text-slate-500">{sponsorProfile.industry}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <StarRating rating={sponsorProfile.rating} />
                    <span className="text-xs font-bold text-slate-700">{sponsorProfile.rating.toFixed(1)} / 5</span>
                    <span className="text-[11px] text-slate-400">({sponsorProfile.reviewsCount} reviews)</span>
                  </div>
                </div>
              </div>
              {verified ? (
                <span className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-xs font-bold flex items-center gap-1.5 self-start sm:self-center">
                  <ShieldCheck className="w-4 h-4" />
                  Verified Sponsor
                </span>
              ) : (
                <span className="px-3 py-1.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-full text-xs font-bold flex items-center gap-1.5 self-start sm:self-center">
                  <ShieldAlert className="w-4 h-4" />
                  Restricted
                </span>
              )}
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">{sponsorProfile.description}</p>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                <div className="text-[10px] font-bold text-slate-400 uppercase">Active Sponsorships</div>
                <div className="text-lg font-extrabold text-slate-900">{sponsorProfile.activeSponsorshipsCount}</div>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                <div className="text-[10px] font-bold text-slate-400 uppercase">Leads Captured</div>
                <div className="text-lg font-extrabold text-blue-700">{sponsorProfile.leadsCaptured}</div>
              </div>
            </div>

            {!verified && (
              <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <p className="text-xs text-rose-800">{sponsorVerificationReason(sponsorProfile)}</p>
              </div>
            )}
          </div>

          {/* Sponsorship History */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-4">
            <div className="flex items-center gap-2">
              <History className="w-5 h-5 text-blue-600" />
              <h3 className="font-bold text-sm text-slate-900">
                Sponsorship History
                {historyYearsSpan > 0 && (
                  <span className="font-normal text-slate-500"> — {sortedHistory.length} sponsorships across the last {historyYearsSpan} years</span>
                )}
              </h3>
            </div>
            <div className="space-y-2">
              {sortedHistory.map((h, idx) => (
                <div key={idx} className="flex items-center justify-between gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-extrabold text-xs shrink-0">
                      {h.year}
                    </span>
                    <span className="text-xs font-bold text-slate-900 truncate">{h.conferenceTitle}</span>
                  </div>
                  <span className="px-2.5 py-0.5 bg-blue-900 text-white text-[10px] font-bold rounded-full shrink-0">
                    {h.tier} Tier
                  </span>
                </div>
              ))}
              {sortedHistory.length === 0 && (
                <p className="text-xs text-slate-400">No prior sponsorships on record yet.</p>
              )}
            </div>
          </div>

          {/* Feedback / Reviews */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-4">
            <div className="flex items-center gap-2">
              <MessageSquareQuote className="w-5 h-5 text-blue-600" />
              <h3 className="font-bold text-sm text-slate-900">Feedback from Organizers</h3>
            </div>
            <div className="space-y-3">
              {sponsorProfile.reviews.map((r) => (
                <div key={r.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs text-slate-900">{r.reviewerName}</span>
                      <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] font-bold rounded-full">
                        {r.reviewerRole}
                      </span>
                    </div>
                    <StarRating rating={r.rating} />
                  </div>
                  <p className="text-[11px] text-slate-600">{r.comment}</p>
                  <div className="text-[10px] text-slate-400">{r.conferenceTitle} · {r.date}</div>
                </div>
              ))}
              {sponsorProfile.reviews.length === 0 && (
                <p className="text-xs text-slate-400">No feedback recorded yet.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
}{Number(price).toLocaleString()}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {benefits.length > 0 && (
                      <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-100 rounded-xl p-3">
                        {benefits.slice(0, 4).join(' · ')}
                      </div>
                    )}

                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <button
                        type="button"
                        onClick={() => setActiveTab(isNeed ? 'matches' : 'marketplace')}
                        className="py-2.5 rounded-xl bg-blue-900 hover:bg-blue-950 text-white text-xs font-bold cursor-pointer"
                      >
                        Open Opportunity
                      </button>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={watchlistBusyKey === 'alert:' + item.id}
                          onClick={() => handleSavedAlertToggle(item)}
                          className={
                            'p-2.5 rounded-xl border cursor-pointer disabled:opacity-50 ' +
                            (item.alertEnabled
                              ? 'bg-amber-50 border-amber-200 text-amber-700'
                              : 'bg-white border-slate-200 text-slate-500')
                          }
                          title={item.alertEnabled ? 'Watch alerts enabled' : 'Watch alerts disabled'}
                        >
                          {item.alertEnabled ? <BellRing className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
                        </button>
                        <button
                          type="button"
                          disabled={watchlistBusyKey === 'remove:' + item.id}
                          onClick={() => handleRemoveSavedOpportunity(item)}
                          className="p-2.5 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 cursor-pointer disabled:opacity-50"
                          title="Remove from watchlist"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Sponsor Pro reverse marketplace */}
      {activeTab === 'requests' && (
        <div className="space-y-6">
          <form onSubmit={handleCreateSponsorRequest} className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Publish What You Want to Sponsor</h2>
              <p className="text-xs text-slate-500 mt-1">
                Create a Sponsor Request and let paid organizers respond with relevant conferences. ConferenceGate does not expose your private email.
              </p>
            </div>
            <input
              required
              value={requestDraft.title}
              onChange={(e) => setRequestDraft({ ...requestDraft, title: e.target.value })}
              placeholder="e.g. Seeking GCC energy conferences for 2027"
              className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs"
            />
            <textarea
              rows={3}
              value={requestDraft.description}
              onChange={(e) => setRequestDraft({ ...requestDraft, description: e.target.value })}
              placeholder="Describe the audience, strategic objective, or sponsorship type you want."
              className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input value={requestDraft.categories} onChange={(e) => setRequestDraft({ ...requestDraft, categories: e.target.value })} placeholder="Categories, comma separated" className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs" />
              <input value={requestDraft.regions} onChange={(e) => setRequestDraft({ ...requestDraft, regions: e.target.value })} placeholder="Regions, comma separated" className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs" />
              <input value={requestDraft.opportunityTypes} onChange={(e) => setRequestDraft({ ...requestDraft, opportunityTypes: e.target.value })} placeholder="Booth, dinner, session, title..." className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs" />
              <input value={requestDraft.targetAudience} onChange={(e) => setRequestDraft({ ...requestDraft, targetAudience: e.target.value })} placeholder="Target audience: CIOs, geoscientists..." className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs" />
              <input type="number" min="0" value={requestDraft.budgetMin} onChange={(e) => setRequestDraft({ ...requestDraft, budgetMin: e.target.value })} placeholder="Minimum budget" className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs" />
              <input type="number" min="0" value={requestDraft.budgetMax} onChange={(e) => setRequestDraft({ ...requestDraft, budgetMax: e.target.value })} placeholder="Maximum budget" className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs" />
              <input type="date" value={requestDraft.startDate} onChange={(e) => setRequestDraft({ ...requestDraft, startDate: e.target.value })} className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs" />
              <input type="date" value={requestDraft.endDate} onChange={(e) => setRequestDraft({ ...requestDraft, endDate: e.target.value })} className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs" />
            </div>
            <button disabled={requestSaving} className="w-full py-3 rounded-xl bg-blue-900 hover:bg-blue-950 text-white text-xs font-bold cursor-pointer disabled:opacity-60">
              {requestSaving ? 'Publishing…' : 'Publish Sponsor Request'}
            </button>
          </form>

          {sponsorRequests.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {sponsorRequests.map((request) => (
                <div key={request.id} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-bold text-sm text-slate-900">{request.title}</h3>
                      <p className="text-[11px] text-slate-500">{request.responseCount} organizer response{request.responseCount === 1 ? '' : 's'}</p>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase">{request.status}</span>
                  </div>
                  {request.description && <p className="text-xs text-slate-600">{request.description}</p>}
                  <div className="flex flex-wrap gap-1">
                    {[...request.categories, ...request.regions, ...request.opportunityTypes].slice(0, 10).map((item) => (
                      <span key={item} className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[9px] font-semibold">{item}</span>
                    ))}
                  </div>
                  {(request.budgetMin !== null || request.budgetMax !== null) && (
                    <div className="text-xs font-bold text-blue-700">
                      Budget: {request.budgetMin !== null ? `${request.budgetMin.toLocaleString()}` : 'Any'} – {request.budgetMax !== null ? `${request.budgetMax.toLocaleString()}` : 'Open'}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100">
              <h3 className="font-bold text-sm text-slate-900">Organizer Responses</h3>
              <p className="text-xs text-slate-500 mt-1">Accept a relevant conference proposal or decline it.</p>
            </div>
            {sponsorRequestResponses.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">No organizer responses yet.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {sponsorRequestResponses.map((response) => (
                  <div key={response.id} className="p-5 flex flex-col md:flex-row md:items-center gap-4 justify-between">
                    <div>
                      <div className="font-bold text-xs text-slate-900">{response.conferenceTitle}</div>
                      <div className="text-[11px] text-slate-500">{response.organizerName} · Responded to: {response.requestTitle}</div>
                      {response.message && <p className="text-[11px] text-slate-600 mt-1">{response.message}</p>}
                    </div>
                    {response.status === 'new' ? (
                      <div className="flex gap-2 shrink-0">
                        <button onClick={() => handleSponsorRequestResponseDecision(response.id, 'declined')} className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 cursor-pointer">Decline</button>
                        <button onClick={() => handleSponsorRequestResponseDecision(response.id, 'accepted')} className="px-3 py-2 rounded-lg bg-blue-900 text-white text-xs font-bold cursor-pointer">Accept</button>
                      </div>
                    ) : (
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${
                        response.status === 'accepted' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                      }`}>{response.status}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sponsor Pro shared commercial Deal Rooms */}
      {activeTab === 'deals' && (
        <div className="space-y-5">
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <h2 className="text-lg font-bold text-slate-900">Sponsorship Deal Rooms</h2>
            <p className="text-xs text-slate-500 mt-1">
              Private deal workspaces with organizers. Commercial terms, deliverables, contracts, invoices, status history, and provider-confirmed payment are kept together.
            </p>
          </div>

          {sponsorshipDeals.length === 0 ? (
            <div className="p-8 bg-white rounded-2xl border border-slate-200 text-center">
              <Briefcase className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <h3 className="text-sm font-bold text-slate-800">No active Deal Rooms yet</h3>
              <p className="text-xs text-slate-500 mt-1">
                A Deal Room opens when an organizer moves your sponsorship inquiry into negotiation.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {sponsorshipDeals.map((deal) => (
                <div key={deal.id} className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-5">
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap gap-2">
                        <span className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 text-[10px] font-extrabold uppercase">
                          {deal.status.replace(/_/g, ' ')}
                        </span>
                        {deal.status === 'paid' && (
                          <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold">
                            Payment provider confirmed
                          </span>
                        )}
                      </div>
                      <h3 className="font-extrabold text-base text-slate-900 mt-2">{deal.opportunityTitle}</h3>
                      <p className="text-xs text-slate-500">{deal.conferenceTitle} · Organizer: {deal.counterpartName}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-slate-400 uppercase font-bold">Agreed amount</div>
                      <div className="text-lg font-extrabold text-blue-700">
                        {deal.agreedAmount === null ? 'Not set' : `${deal.currency} ${Number(deal.agreedAmount).toLocaleString()}`}
                      </div>
                    </div>
                  </div>

                  {deal.proposalNotes && (
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                      <div className="text-[10px] uppercase font-bold text-slate-400">Commercial terms</div>
                      <p className="text-xs text-slate-700 mt-1 whitespace-pre-wrap">{deal.proposalNotes}</p>
                    </div>
                  )}

                  {deal.deliverables.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase font-bold text-slate-400 mb-2">Deliverables</div>
                      <div className="flex flex-wrap gap-1.5">
                        {deal.deliverables.map((item) => (
                          <span key={item} className="px-2 py-1 rounded-md bg-blue-50 text-blue-700 text-[10px] font-semibold">{item}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {deal.contractUrl && (
                      <a href={deal.contractUrl} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-lg bg-slate-100 text-blue-700 text-[10px] font-bold">
                        View Contract
                      </a>
                    )}
                    {deal.invoiceUrl && (
                      <a href={deal.invoiceUrl} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-lg bg-slate-100 text-blue-700 text-[10px] font-bold">
                        View Invoice
                      </a>
                    )}
                    {deal.status === 'agreement_reached' && (
                      <button
                        onClick={() => handleSponsorDealStatus(deal, 'contract_pending')}
                        disabled={dealUpdatingId === deal.id}
                        className="px-3 py-2 rounded-lg bg-blue-900 text-white text-[10px] font-bold cursor-pointer disabled:opacity-50"
                      >
                        Proceed to Contract
                      </button>
                    )}
                    {deal.status === 'contract_pending' && (
                      <button
                        onClick={() => handleSponsorDealStatus(deal, 'payment_pending')}
                        disabled={dealUpdatingId === deal.id}
                        className="px-3 py-2 rounded-lg bg-blue-900 text-white text-[10px] font-bold cursor-pointer disabled:opacity-50"
                      >
                        Contract Accepted · Await Payment
                      </button>
                    )}
                  </div>

                  {deal.status === 'payment_pending' && (
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
                      Payment is pending. ConferenceGate will show <strong>Paid</strong> only after the configured payment provider confirms settlement.
                    </div>
                  )}

                  <div className="max-h-48 overflow-y-auto space-y-2">
                    {deal.updates.map((update) => (
                      <div key={update.id} className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-[10px] text-slate-600">
                        <div className="font-bold text-slate-800 uppercase">{update.kind}</div>
                        <div>{update.text}</div>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <input
                      value={dealNotes[deal.id] || ''}
                      onChange={(e) => setDealNotes((prev) => ({ ...prev, [deal.id]: e.target.value }))}
                      placeholder="Add a note or question to the Deal Room..."
                      className="flex-1 p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs"
                    />
                    <button
                      onClick={() => handleSponsorDealNote(deal)}
                      disabled={!String(dealNotes[deal.id] || '').trim() || dealUpdatingId === deal.id}
                      className="px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      Send
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sponsor Pro matching preferences */}
      {activeTab === 'preferences' && (
        <div className="max-w-3xl mx-auto">
          <form onSubmit={saveSponsorPreferences} className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-5">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Sponsor Matching Preferences</h2>
              <p className="text-xs text-slate-500 mt-1">
                ConferenceGate uses these saved preferences for in-app matching and alerts. It does not send pre-signup notifications.
              </p>
            </div>

            {[
              ['Sectors / Industries', 'sectors', 'Energy, Oil & Gas, Artificial Intelligence'],
              ['Conference Categories', 'categories', 'Petroleum & Geoscience, Energy, Engineering'],
              ['Regions', 'regions', 'Middle East, Europe, North America'],
              ['Opportunity Types', 'opportunityTypes', 'Exhibition Booth, Gala Dinner, Technical Session'],
            ].map(([label, key, placeholder]) => (
              <div key={key}>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5">{label}</label>
                <input
                  value={(preferenceDraft as any)[key]}
                  onChange={(e) => setPreferenceDraft({ ...preferenceDraft, [key]: e.target.value })}
                  placeholder={placeholder}
                  className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs"
                />
                <p className="text-[9px] text-slate-400 mt-1">Separate values with commas.</p>
              </div>
            ))}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5">Minimum Budget</label>
                <div className="relative">
                  <DollarSign className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="number"
                    min="0"
                    value={preferenceDraft.budgetMin}
                    onChange={(e) => setPreferenceDraft({ ...preferenceDraft, budgetMin: e.target.value })}
                    className="w-full pl-9 pr-3 py-3 rounded-xl bg-slate-50 border border-slate-200 text-xs"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5">Maximum Budget</label>
                <div className="relative">
                  <DollarSign className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="number"
                    min="0"
                    value={preferenceDraft.budgetMax}
                    onChange={(e) => setPreferenceDraft({ ...preferenceDraft, budgetMax: e.target.value })}
                    className="w-full pl-9 pr-3 py-3 rounded-xl bg-slate-50 border border-slate-200 text-xs"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1.5">Alert Frequency</label>
              <select
                value={preferenceDraft.alertFrequency}
                onChange={(e) =>
                  setPreferenceDraft({
                    ...preferenceDraft,
                    alertFrequency: e.target.value as SponsorPreferences['alertFrequency'],
                  })
                }
                className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold"
              >
                <option value="instant">Instant for strong matches</option>
                <option value="daily">Daily summary</option>
                <option value="weekly">Weekly summary</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={savingPreferences}
              className="w-full py-3 rounded-xl bg-blue-900 hover:bg-blue-950 text-white text-xs font-bold cursor-pointer disabled:opacity-60"
            >
              {savingPreferences ? 'Saving…' : 'Save Matching Preferences'}
            </button>
          </form>
        </div>
      )}

      {/* Paid Sponsor Pro: Team & Access */}
      {activeTab === 'workspace' && (
        <WorkspaceTeamPanel accountLabel="Sponsor Pro" />
      )}

      {activeTab === 'payments' && (
        <BillingLedgerPanel perspective="sponsor" />
      )}

      {/* Sponsor Pro: real portfolio analytics */}
      {activeTab === 'roi' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <h2 className="text-lg font-bold text-slate-900">Sponsor Pro Portfolio Analytics</h2>
            <p className="text-xs text-slate-500 mt-1">
              These metrics come from your real ConferenceGate matching, inquiries, Deal Rooms, Sponsor Requests, and provider-confirmed payments. No impression or lead numbers are invented.
            </p>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              ['Strong Matches', sponsorAnalytics.meaningfulMatches, '45%+ profile match'],
              ['High Matches', sponsorAnalytics.highMatches, '70%+ profile match'],
              ['Inquiries Sent', sponsorAnalytics.inquiriesSent, 'Internal organizer inquiries'],
              ['Active Deal Rooms', sponsorAnalytics.activeDeals, 'Open commercial workflows'],
              ['Negotiating', sponsorAnalytics.negotiations, 'Negotiation through payment pending'],
              ['Contracts', sponsorAnalytics.contracts, 'Contract stage or later'],
              ['Paid Deals', sponsorAnalytics.paidDeals, 'Provider-confirmed'],
              ['Completed Deals', sponsorAnalytics.completedDeals, 'Delivered and completed'],
            ].map(([label, value, note]) => (
              <div key={String(label)} className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs">
                <div className="text-[10px] font-bold uppercase text-slate-400">{label}</div>
                <div className="text-2xl font-extrabold text-slate-900 mt-1">{value}</div>
                <div className="text-[10px] text-slate-500 mt-1">{note}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-6 rounded-3xl bg-blue-50 border border-blue-100">
              <div className="text-[10px] font-bold uppercase text-blue-500">Committed Sponsorship Spend</div>
              <div className="text-3xl font-extrabold text-blue-900 mt-2">
                {'$'}{sponsorAnalytics.committedSpend.toLocaleString()}
              </div>
              <p className="text-[11px] text-blue-700 mt-1">
                Agreed deals from agreement reached onward. This is not the same as money settled.
              </p>
            </div>
            <div className="p-6 rounded-3xl bg-emerald-50 border border-emerald-100">
              <div className="text-[10px] font-bold uppercase text-emerald-600">Provider-Confirmed Paid Spend</div>
              <div className="text-3xl font-extrabold text-emerald-900 mt-2">
                {'$'}{sponsorAnalytics.paidSpend.toLocaleString()}
              </div>
              <p className="text-[11px] text-emerald-700 mt-1">
                Only deals confirmed paid by the configured payment-provider settlement sync.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-5 bg-white rounded-2xl border border-slate-200">
              <div className="text-[10px] uppercase font-bold text-slate-400">Sponsor Requests</div>
              <div className="text-xl font-extrabold text-slate-900 mt-1">{sponsorAnalytics.sponsorRequests}</div>
              <div className="text-[10px] text-slate-500">Requests you published</div>
            </div>
            <div className="p-5 bg-white rounded-2xl border border-slate-200">
              <div className="text-[10px] uppercase font-bold text-slate-400">Organizer Responses</div>
              <div className="text-xl font-extrabold text-slate-900 mt-1">{sponsorAnalytics.organizerResponses}</div>
              <div className="text-[10px] text-slate-500">Conference proposals received</div>
            </div>
            <div className="p-5 bg-white rounded-2xl border border-slate-200">
              <div className="text-[10px] uppercase font-bold text-slate-400">Accepted Proposals</div>
              <div className="text-xl font-extrabold text-slate-900 mt-1">{sponsorAnalytics.acceptedRequestResponses}</div>
              <div className="text-[10px] text-slate-500">Reverse-marketplace proposals accepted</div>
            </div>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-[11px] text-slate-500">
            Audience impressions, booth visitors, lead scans, QR interactions, and sponsored-session engagement remain unavailable until ConferenceGate has a real event-tracking source for them. They are intentionally not estimated.
          </div>
        </div>
      )}

      {/* Tab 3: Sponsor Profile & Verification */}
      {activeTab === 'profile' && (
        <div className="space-y-6">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <img
                  src={sponsorProfile.logo || undefined}
                  alt={sponsorProfile.companyName}
                  className="w-16 h-16 rounded-2xl object-cover ring-2 ring-slate-100"
                />
                <div>
                  <h2 className="text-lg font-bold text-slate-900">{sponsorProfile.companyName}</h2>
                  <p className="text-xs text-slate-500">{sponsorProfile.industry}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <StarRating rating={sponsorProfile.rating} />
                    <span className="text-xs font-bold text-slate-700">{sponsorProfile.rating.toFixed(1)} / 5</span>
                    <span className="text-[11px] text-slate-400">({sponsorProfile.reviewsCount} reviews)</span>
                  </div>
                </div>
              </div>
              {verified ? (
                <span className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-xs font-bold flex items-center gap-1.5 self-start sm:self-center">
                  <ShieldCheck className="w-4 h-4" />
                  Verified Sponsor
                </span>
              ) : (
                <span className="px-3 py-1.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-full text-xs font-bold flex items-center gap-1.5 self-start sm:self-center">
                  <ShieldAlert className="w-4 h-4" />
                  Restricted
                </span>
              )}
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">{sponsorProfile.description}</p>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                <div className="text-[10px] font-bold text-slate-400 uppercase">Active Sponsorships</div>
                <div className="text-lg font-extrabold text-slate-900">{sponsorProfile.activeSponsorshipsCount}</div>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                <div className="text-[10px] font-bold text-slate-400 uppercase">Leads Captured</div>
                <div className="text-lg font-extrabold text-blue-700">{sponsorProfile.leadsCaptured}</div>
              </div>
            </div>

            {!verified && (
              <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <p className="text-xs text-rose-800">{sponsorVerificationReason(sponsorProfile)}</p>
              </div>
            )}
          </div>

          {/* Sponsorship History */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-4">
            <div className="flex items-center gap-2">
              <History className="w-5 h-5 text-blue-600" />
              <h3 className="font-bold text-sm text-slate-900">
                Sponsorship History
                {historyYearsSpan > 0 && (
                  <span className="font-normal text-slate-500"> — {sortedHistory.length} sponsorships across the last {historyYearsSpan} years</span>
                )}
              </h3>
            </div>
            <div className="space-y-2">
              {sortedHistory.map((h, idx) => (
                <div key={idx} className="flex items-center justify-between gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-extrabold text-xs shrink-0">
                      {h.year}
                    </span>
                    <span className="text-xs font-bold text-slate-900 truncate">{h.conferenceTitle}</span>
                  </div>
                  <span className="px-2.5 py-0.5 bg-blue-900 text-white text-[10px] font-bold rounded-full shrink-0">
                    {h.tier} Tier
                  </span>
                </div>
              ))}
              {sortedHistory.length === 0 && (
                <p className="text-xs text-slate-400">No prior sponsorships on record yet.</p>
              )}
            </div>
          </div>

          {/* Feedback / Reviews */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-4">
            <div className="flex items-center gap-2">
              <MessageSquareQuote className="w-5 h-5 text-blue-600" />
              <h3 className="font-bold text-sm text-slate-900">Feedback from Organizers</h3>
            </div>
            <div className="space-y-3">
              {sponsorProfile.reviews.map((r) => (
                <div key={r.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs text-slate-900">{r.reviewerName}</span>
                      <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] font-bold rounded-full">
                        {r.reviewerRole}
                      </span>
                    </div>
                    <StarRating rating={r.rating} />
                  </div>
                  <p className="text-[11px] text-slate-600">{r.comment}</p>
                  <div className="text-[10px] text-slate-400">{r.conferenceTitle} · {r.date}</div>
                </div>
              ))}
              {sponsorProfile.reviews.length === 0 && (
                <p className="text-xs text-slate-400">No feedback recorded yet.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
