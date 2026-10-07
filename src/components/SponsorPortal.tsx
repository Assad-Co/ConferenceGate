import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Briefcase,
  Users,
  CheckCircle2,
  Sparkles,
  Star,
  ShieldCheck,
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
  ChevronRight,
} from 'lucide-react';
import { SponsorshipPackage, SponsorshipOpportunity, SponsorProfile, NotificationItem } from '../types';
import { sponsorOpportunityMatch } from '../utils/sponsorVerification';
import {
  SponsorApplicationSummary,
  fetchMySponsorPreferences,
  updateMySponsorPreferences,
  fetchMatchedSponsorshipNeeds,
  inquireAboutSponsorshipNeed,
  fetchMySponsorshipDeals,
  updateSponsorshipDeal,
  addSponsorshipDealUpdate,
  fetchMySponsorRequestResponses,
  decideSponsorRequestResponse,
  fetchSponsorPortfolioAnalytics,
  fetchSponsorLaunchpad,
  fetchSponsorWatchlist,
  saveSponsorOpportunity,
  setSponsorWatchAlert,
  removeSponsorSavedOpportunity,
  type SponsorSavedOpportunity,
  type SponsorPortfolioAnalytics,
  type SponsorLaunchpad,
  type SponsorPreferences,
  type SponsorshipNeed,
  type SponsorshipDeal,
  type SponsorRequestResponse,
} from '../api/sponsors';
import { useToast } from './Toast';
import { WorkspaceTeamPanel } from './WorkspaceTeamPanel';
import { MarketplaceActionQueue } from './MarketplaceActionQueue';
import { SponsorWizardPanel } from './SponsorWizardPanel';
import { SponsorHistoryEditor } from './SponsorHistoryEditor';

interface SponsorPortalProps {
  sponsorshipPackages: SponsorshipPackage[];
  sponsorshipOpportunities?: SponsorshipOpportunity[];
  myApplications: SponsorApplicationSummary[];
  sponsorProfile: SponsorProfile;
  /** This sponsor's real notifications — application decisions, organizer reviews, and new
   * opportunity alerts an organizer actually published, all backed by real data. */
  sponsorAlerts?: NotificationItem[];
  onMarkAlertRead: (id: string) => void;
  onMarkAllAlertsRead: () => void;
  onApplyForSponsorship: (packageId: string) => void | Promise<void>;
  ownerPreview?: boolean;
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
  onMarkAlertRead,
  onMarkAllAlertsRead,
  onApplyForSponsorship,
  ownerPreview = false,
}) => {
  const [activeTab, setActiveTab] = useState<'matches' | 'marketplace' | 'saved' | 'requests' | 'deals' | 'preferences' | 'workspace' | 'roi' | 'profile'>('preferences');
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
  const [applyingPackageId, setApplyingPackageId] = useState<string | null>(null);
  const [savedOpportunities, setSavedOpportunities] = useState<SponsorSavedOpportunity[]>([]);
  const [watchlistBusyKey, setWatchlistBusyKey] = useState<string | null>(null);
  const [sponsorshipDeals, setSponsorshipDeals] = useState<SponsorshipDeal[]>([]);
  const [dealNotes, setDealNotes] = useState<Record<string, string>>({});
  const [dealUpdatingId, setDealUpdatingId] = useState<string | null>(null);
  const [sponsorRequestResponses, setSponsorRequestResponses] = useState<SponsorRequestResponse[]>([]);
  const [sponsorLaunchpad, setSponsorLaunchpad] = useState<SponsorLaunchpad | null>(null);
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
  const { showToast } = useToast();

  const listFromText = (value: string) =>
    [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];

  const loadSponsorMatching = async () => {
    setSponsorDataLoading(true);
    try {
      const [pref, needs, deals, responses, analytics, watchlist, launchpad] = await Promise.all([
        fetchMySponsorPreferences(),
        fetchMatchedSponsorshipNeeds(),
        fetchMySponsorshipDeals('sponsor'),
        fetchMySponsorRequestResponses(),
        fetchSponsorPortfolioAnalytics(),
        fetchSponsorWatchlist(),
        fetchSponsorLaunchpad(),
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
      setSponsorRequestResponses(responses);
      setSponsorAnalytics(analytics);
      setSavedOpportunities(watchlist);
      setSponsorLaunchpad(launchpad);
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
      setSponsorLaunchpad(await fetchSponsorLaunchpad());
      showToast({
        type: 'success',
        title: 'Sponsor wizard saved',
        message: 'Your Sponsor Wizard profile is now being used to rank sponsorship opportunities and alerts.',
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
      setSponsorLaunchpad(await fetchSponsorLaunchpad());
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
      const updated = await updateSponsorshipDeal(deal.id, { status }, 'sponsor');
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
      const update = await addSponsorshipDealUpdate(deal.id, { text }, 'sponsor');
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

  const visibleSavedOpportunities = useMemo(
    () => savedOpportunities.filter((item) => item.sourceType !== 'external_catalog'),
    [savedOpportunities]
  );

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


  const handleSponsorAlertOpen = (alert: NotificationItem) => {
    onMarkAlertRead(alert.id);
    const signal = `${alert.actionUrl || ''} ${alert.title || ''} ${alert.message || ''}`.toLowerCase();

    if (/deal|contract|payment|invoice/.test(signal)) {
      setActiveTab('deals');
    } else if (/request|proposal/.test(signal)) {
      setActiveTab('requests');
    } else if (/review|rating|reputation/.test(signal)) {
      setActiveTab('profile');
    } else if (/saved|watchlist/.test(signal)) {
      setActiveTab('saved');
    } else if (/match|new sponsorship opportunity|opportunit/.test(signal)) {
      setActiveTab('matches');
    } else {
      setActiveTab('marketplace');
    }
  };

  const hasOrganizerReviews = sponsorProfile.reviewsCount > 0;

  const applicationByPackageId = useMemo(() => {
    const map = new Map<string, SponsorApplicationSummary>();
    myApplications.forEach((a) => map.set(a.packageId, a));
    return map;
  }, [myApplications]);

  const handleApplySponsorship = async (packageId: string) => {
    if (applicationByPackageId.has(packageId) || applyingPackageId === packageId) return;
    setApplyingPackageId(packageId);
    try {
      await onApplyForSponsorship(packageId);
    } finally {
      setApplyingPackageId(null);
    }
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
    const applying = applyingPackageId === packageId;
    return (
      <button
        type="button"
        onClick={() => handleApplySponsorship(packageId)}
        disabled={applying}
        className="w-full py-3 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-md transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait"
      >
        {applying ? 'Submitting…' : 'Apply for Sponsorship'}
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
              <span className="px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                Sponsor Pro Active
              </span>
              {hasOrganizerReviews && (
                <span className="px-3 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                  Organizer Reviewed
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
              <div className="text-2xl font-extrabold text-blue-700">
                {hasOrganizerReviews ? `${sponsorProfile.rating.toFixed(1)}/5` : 'New'}
              </div>
            </div>
            <div className="border-l border-slate-200 pl-6">
              <div className="text-[10px] uppercase font-bold text-slate-400">Organizer Reviews</div>
              <div className="text-2xl font-extrabold text-emerald-600">{sponsorProfile.reviewsCount}</div>
            </div>
          </div>
        </div>
      </div>

      {ownerPreview && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <span className="font-extrabold">Owner Preview:</span>{' '}
          Sponsor Pro is open for product review on this owner account. Your stored account role and payment records are unchanged.
        </div>
      )}

      {sponsorLaunchpad && (
        <div className="rounded-3xl border border-blue-100 bg-white shadow-xs p-5 sm:p-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
            <div className="max-w-2xl">
              <div className="text-[10px] uppercase tracking-wider font-extrabold text-blue-600">Sponsor Launchpad</div>
              <h2 className="text-lg font-extrabold text-slate-900 mt-1">{sponsorLaunchpad.nextAction.label}</h2>
              <p className="text-xs text-slate-500 mt-1">{sponsorLaunchpad.nextAction.description}</p>
              <button
                type="button"
                onClick={() => setActiveTab(sponsorLaunchpad.nextAction.targetTab)}
                className="mt-3 px-4 py-2.5 rounded-xl bg-blue-900 hover:bg-blue-950 text-white text-xs font-bold cursor-pointer"
              >
                Continue Next Action
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 min-w-0 lg:min-w-[460px]">
              {[
                ['Matches', sponsorLaunchpad.meaningfulMatches],
                ['Saved', sponsorLaunchpad.savedOpportunities],
                ['Inquiries', sponsorLaunchpad.inquiriesSent],
                ['Deal Rooms', sponsorLaunchpad.dealRooms],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-2xl bg-slate-50 border border-slate-100 px-3 py-3">
                  <div className="text-[9px] uppercase font-bold text-slate-400">{label}</div>
                  <div className="text-xl font-extrabold text-slate-900">{value}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-3 mt-4 text-[10px] font-bold">
            <span className={sponsorLaunchpad.companyProfileReady ? 'text-emerald-700' : 'text-amber-700'}>
              {sponsorLaunchpad.companyProfileReady ? '✓' : '○'} Company profile
            </span>
            <span className={sponsorLaunchpad.preferencesReady ? 'text-emerald-700' : 'text-amber-700'}>
              {sponsorLaunchpad.preferencesReady ? '✓' : '○'} Matching preferences
            </span>
            <span className={sponsorLaunchpad.watchAlertsEnabled > 0 ? 'text-emerald-700' : 'text-slate-500'}>
              {sponsorLaunchpad.watchAlertsEnabled > 0 ? '✓' : '○'} Watch alerts
            </span>
            <span className="text-slate-500">Alert cadence: {sponsorLaunchpad.alertFrequency}</span>
          </div>
        </div>
      )}

      <MarketplaceActionQueue
        role="sponsor"
        onNavigate={(target) => {
          const allowed = new Set(['matches','marketplace','saved','requests','deals','preferences','roi','profile']);
          setActiveTab((allowed.has(target) ? target : 'matches') as any);
        }}
      />

      {/* Navigation Sub-Tabs — one simple sponsor journey */}
      <div className="bg-white rounded-2xl border border-slate-200 p-2 flex gap-2 overflow-x-auto text-xs font-semibold text-slate-600">
        {[
          { id: 'preferences', label: 'Sponsor Wizard', icon: SlidersHorizontal, count: null },
          { id: 'marketplace', label: 'Sponsorship Marketplace', icon: Briefcase, count: sponsorshipPackages.length },
          { id: 'matches', label: 'Matched Opportunities', icon: Target, count: matchedNeeds.length },
          { id: 'requests', label: 'Organizer Requests', icon: Send, count: sponsorRequestResponses.length },
          { id: 'saved', label: 'Saved', icon: Bookmark, count: savedOpportunities.length },
          { id: 'deals', label: 'Deal Rooms', icon: Briefcase, count: sponsorshipDeals.length },
          { id: 'roi', label: 'Sponsor ROI', icon: DollarSign, count: null },
          { id: 'profile', label: 'Sponsor Profile', icon: Star, count: null },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2.5 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap border ${
                active
                  ? 'bg-blue-50 text-blue-800 border-blue-200 font-bold shadow-xs'
                  : 'bg-white border-transparent hover:bg-blue-50/70 hover:text-blue-800 text-slate-700'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}{tab.count === null ? '' : ` (${tab.count})`}</span>
              {tab.id === 'marketplace' && unreadAlertCount > 0 && (
                <span className="min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
                  {unreadAlertCount}
                </span>
              )}
            </button>
          );
        })}
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
                Complete Sponsor Wizard and ConferenceGate will rank new organizer opportunities here.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('preferences')}
                className="mt-4 px-4 py-2 rounded-full bg-blue-900 hover:bg-blue-950 text-white text-xs font-bold transition-colors"
              >
                Set sponsor wizard profile
              </button>
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

                    {need.matchReasons?.length > 0 && (
                      <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
                        <div className="text-[9px] uppercase font-extrabold tracking-wider text-emerald-700 mb-1.5">
                          Why this matches
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {need.matchReasons.map((reason) => (
                            <span key={reason} className="text-[10px] text-emerald-800 bg-white/80 border border-emerald-100 rounded-lg px-2 py-1">
                              {reason}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

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
                    onClick={() => handleSponsorAlertOpen(alert)}
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
                    <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 mt-1" aria-hidden="true" />
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
                  cadence comes from Sponsor Wizard.
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

          {visibleSavedOpportunities.length === 0 ? (
            <div className="p-10 bg-white rounded-3xl border border-slate-200 text-center">
              <Bookmark className="w-9 h-9 text-slate-300 mx-auto mb-2" />
              <h3 className="text-sm font-bold text-slate-800">Your watchlist is empty</h3>
              <p className="text-xs text-slate-500 mt-1">
                Save matched opportunities or organizer-published packages to compare them here.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {visibleSavedOpportunities.map((item) => {
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
                            USD {Number(price).toLocaleString()}
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
                      {item.sourceType === 'external_catalog' && typeof snapshot.actionUrl === 'string' ? (
                        <a
                          href={snapshot.actionUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="py-2.5 rounded-xl bg-blue-900 hover:bg-blue-950 text-white text-xs font-bold text-center"
                        >
                          Open Official Opportunity
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setActiveTab(isNeed ? 'matches' : 'marketplace')}
                          className="py-2.5 rounded-xl bg-blue-900 hover:bg-blue-950 text-white text-xs font-bold cursor-pointer"
                        >
                          Open Opportunity
                        </button>
                      )}
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

      {/* Organizer-originated sponsor requests / proposals only. Sponsors no longer publish reverse-marketplace requests. */}
      {activeTab === 'requests' && (
        <div className="space-y-6">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs">
            <div className="text-[10px] uppercase tracking-wider font-extrabold text-blue-600">Organizer → Sponsor</div>
            <h2 className="text-xl font-bold text-slate-900 mt-1">Organizer Requests</h2>
            <p className="text-xs text-slate-500 mt-1 max-w-3xl">
              Direct conference proposals and sponsorship invitations sent by organizers appear here. Sponsors do not publish requests from this portal.
            </p>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden">
            {sponsorRequestResponses.length === 0 ? (
              <div className="p-10 text-center">
                <Send className="w-9 h-9 text-slate-300 mx-auto mb-2" />
                <h3 className="text-sm font-bold text-slate-800">No direct organizer requests yet</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Organizer-published opportunities are still ranked under Matched Opportunities. Direct proposals will appear here when an organizer sends one to your sponsor workspace.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {sponsorRequestResponses.map((response) => (
                  <div key={response.id} className="p-5 flex flex-col md:flex-row md:items-center gap-4 justify-between">
                    <div>
                      <div className="font-bold text-sm text-slate-900">{response.conferenceTitle}</div>
                      <div className="text-[11px] text-slate-500">Organizer: {response.organizerName}</div>
                      {response.message && <p className="text-[11px] text-slate-600 mt-1">{response.message}</p>}
                    </div>
                    {response.status === 'new' ? (
                      <div className="flex gap-2 shrink-0">
                        <button onClick={() => handleSponsorRequestResponseDecision(response.id, 'declined')} className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 cursor-pointer">Decline</button>
                        <button onClick={() => handleSponsorRequestResponseDecision(response.id, 'accepted')} className="px-3 py-2 rounded-lg bg-blue-700 text-white text-xs font-bold cursor-pointer">Accept</button>
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

      {/* Sponsor Wizard */}
      {activeTab === 'preferences' && (
        <SponsorWizardPanel
          preferenceDraft={preferenceDraft}
          setPreferenceDraft={setPreferenceDraft}
          saving={savingPreferences}
          onSubmit={saveSponsorPreferences}
        />
      )}

      {/* Paid Sponsor Pro: Team & Access */}
      {!ownerPreview && activeTab === 'workspace' && (
        <WorkspaceTeamPanel accountLabel="Sponsor Pro" />
      )}

      {/* Sponsor Pro: real portfolio analytics */}
      {activeTab === 'roi' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <h2 className="text-lg font-bold text-slate-900">Sponsor Pro Portfolio Analytics</h2>
            <p className="text-xs text-slate-500 mt-1">
              These metrics come from your real ConferenceGate matching, inquiries, Deal Rooms, organizer proposals, and provider-confirmed payments. No impression or lead numbers are invented.
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-5 bg-white rounded-2xl border border-slate-200">
              <div className="text-[10px] uppercase font-bold text-slate-400">Organizer Requests</div>
              <div className="text-xl font-extrabold text-slate-900 mt-1">{sponsorAnalytics.organizerResponses}</div>
              <div className="text-[10px] text-slate-500">Direct conference proposals received</div>
            </div>
            <div className="p-5 bg-white rounded-2xl border border-slate-200">
              <div className="text-[10px] uppercase font-bold text-slate-400">Accepted Organizer Requests</div>
              <div className="text-xl font-extrabold text-slate-900 mt-1">{sponsorAnalytics.acceptedRequestResponses}</div>
              <div className="text-[10px] text-slate-500">Organizer proposals accepted</div>
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
              <span className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-xs font-bold flex items-center gap-1.5 self-start sm:self-center">
                <ShieldCheck className="w-4 h-4" />
                Sponsor Pro Active
              </span>
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

          </div>

          <SponsorHistoryEditor />

          {/* ConferenceGate-Verified Sponsorship History */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-4">
            <div className="flex items-center gap-2">
              <History className="w-5 h-5 text-blue-600" />
              <h3 className="font-bold text-sm text-slate-900">
                ConferenceGate-Verified Sponsorship History
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
                <p className="text-xs text-slate-400">No ConferenceGate-verified sponsorships on record yet.</p>
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
                    <div className="flex items-center gap-2">
                      {typeof r.overallScore === 'number' && (
                        <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-bold">{r.overallScore.toFixed(1)} / 6</span>
                      )}
                      <StarRating rating={r.rating} />
                    </div>
                  </div>
                  {r.ratings && Object.keys(r.ratings).length > 0 && (
                    <div className="text-[10px] font-semibold text-blue-700">Structured organizer evaluation · {Object.keys(r.ratings).length} criteria</div>
                  )}
                  {r.comment && <p className="text-[11px] text-slate-600">{r.comment}</p>}
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
