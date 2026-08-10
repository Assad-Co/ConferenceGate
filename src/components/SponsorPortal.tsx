import React, { useMemo, useRef, useState } from 'react';
import {
  Briefcase,
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
} from 'lucide-react';
import { SponsorshipPackage, SponsorshipOpportunity, SponsorProfile } from '../types';
import { isSponsorVerified, sponsorVerificationReason, sponsorOpportunityMatch, SPONSOR_RATING_THRESHOLD } from '../utils/sponsorVerification';

interface SponsorAlert {
  id: string;
  title: string;
  message: string;
  date: string;
  read: boolean;
}

interface SponsorPortalProps {
  sponsorshipPackages: SponsorshipPackage[];
  sponsorshipOpportunities?: SponsorshipOpportunity[];
  activatedOpportunityKeys?: Record<string, boolean>;
  sponsorProfile: SponsorProfile;
  sponsorAlerts?: SponsorAlert[];
  onMarkAlertRead?: (id: string) => void;
  onMarkAllAlertsRead?: () => void;
  onSponsorshipAccepted?: (pkg: { tier: string; conferenceTitle: string }) => void;
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
  activatedOpportunityKeys = {},
  sponsorProfile,
  sponsorAlerts = [],
  onMarkAlertRead = (_id: string) => {},
  onMarkAllAlertsRead = () => {},
  onSponsorshipAccepted = (_pkg: { tier: string; conferenceTitle: string }) => {},
}) => {
  const [activeTab, setActiveTab] = useState<'marketplace' | 'roi' | 'booth' | 'profile'>('marketplace');
  const [appliedSuccess, setAppliedSuccess] = useState(false);
  const alertsPanelRef = useRef<HTMLDivElement>(null);

  const unreadAlertCount = sponsorAlerts.filter((a) => !a.read).length;

  const handleJumpToAlerts = () => {
    setActiveTab('marketplace');
    setTimeout(() => alertsPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const verified = isSponsorVerified(sponsorProfile);

  const handleApplySponsorship = (pkg: { tier: string; conferenceTitle: string }) => {
    if (!verified) return;
    setAppliedSuccess(true);
    onSponsorshipAccepted(pkg);
    setTimeout(() => setAppliedSuccess(false), 4000);
  };

  // Organizer-activated opportunity packages, flattened and ranked by fit for this sponsor.
  const activatedOpportunities = useMemo(() => {
    const rows: Array<{
      key: string;
      opportunityName: string;
      opportunityDescription: string;
      tier: string;
      price: number;
      slots: number;
      benefits: string[];
      matchScore: number;
    }> = [];
    sponsorshipOpportunities.forEach((opp) => {
      opp.packages.forEach((pkg) => {
        const key = `${opp.id}__${pkg.tier}`;
        if (!activatedOpportunityKeys[key]) return;
        rows.push({
          key,
          opportunityName: opp.name,
          opportunityDescription: opp.description,
          tier: pkg.tier,
          price: pkg.price,
          slots: pkg.slots,
          benefits: pkg.benefits,
          matchScore: sponsorOpportunityMatch(sponsorProfile, opp.idealSectors),
        });
      });
    });
    return rows.sort((a, b) => b.matchScore - a.matchScore);
  }, [sponsorshipOpportunities, activatedOpportunityKeys, sponsorProfile]);

  const sortedHistory = [...(sponsorProfile.sponsorshipHistory || [])].sort((a, b) => b.year - a.year);
  const historyYearsSpan = sortedHistory.length > 0 ? sortedHistory[0].year - sortedHistory[sortedHistory.length - 1].year + 1 : 0;

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
              Sponsor Marketplace & Real-Time ROI Analytics
            </h1>
            <p className="text-xs text-slate-600">
              Connect corporate brands with world-class technical and scientific conferences. Track logo impressions, digital booth traffic, and B2B leads.
            </p>
          </div>

          <div className="bg-white border border-slate-200 p-4 rounded-2xl flex items-center gap-6 shrink-0 shadow-xs">
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-400">Active Impressions</div>
              <div className="text-2xl font-extrabold text-blue-700">142,800</div>
            </div>
            <div className="border-l border-slate-200 pl-6">
              <div className="text-[10px] uppercase font-bold text-slate-400">B2B Leads Captured</div>
              <div className="text-2xl font-extrabold text-emerald-600">384 Leads</div>
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
            rating from past organizers and attendees before a sponsor can register for opportunities. See your Sponsor
            Profile tab for details and past feedback.
          </div>
        </div>
      )}

      {/* Navigation Sub-Tabs */}
      <div className="bg-white rounded-2xl border border-slate-200 p-2 flex gap-2 overflow-x-auto text-xs font-semibold text-slate-600">
        <button
          onClick={() => setActiveTab('marketplace')}
          className={`px-4 py-2.5 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'marketplace'
              ? 'bg-blue-600 text-white font-bold shadow-xs'
              : 'hover:bg-slate-100 text-slate-700'
          }`}
        >
          Sponsorship Marketplace ({sponsorshipPackages.length + activatedOpportunities.length})
          {unreadAlertCount > 0 && (
            <span className="min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
              {unreadAlertCount}
            </span>
          )}
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
          onClick={() => setActiveTab('booth')}
          className={`px-4 py-2.5 rounded-xl transition-colors cursor-pointer ${
            activeTab === 'booth'
              ? 'bg-blue-600 text-white font-bold shadow-xs'
              : 'hover:bg-slate-100 text-slate-700'
          }`}
        >
          Digital Exhibition Booth Setup
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
                      <div className="text-[10px] text-slate-400 mt-1">{alert.date}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <h2 className="text-sm font-bold text-slate-900">Standard Sponsorship Tiers</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {sponsorshipPackages.map((pkg) => (
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
                      <h3 className="font-bold text-base text-slate-900">{pkg.name}</h3>
                      <p className="text-xs text-slate-500">{pkg.conferenceTitle}</p>
                    </div>

                    <p className="text-xs text-slate-600 leading-relaxed">{pkg.description}</p>

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
                  </div>

                  <button
                    onClick={() => handleApplySponsorship({ tier: pkg.tier, conferenceTitle: pkg.conferenceTitle })}
                    disabled={!verified}
                    className="w-full py-3 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-md transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-blue-900"
                  >
                    {verified ? 'Apply for Sponsorship' : 'Applications Restricted'}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {activatedOpportunities.length > 0 && (
            <div className="space-y-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Organizer-Suggested Sponsorship Opportunities</h2>
                <p className="text-xs text-slate-500">
                  Curated add-on opportunities the organizer has activated for this conference, ranked by how well they match your
                  sponsor profile.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {activatedOpportunities.map((row) => (
                  <div
                    key={row.key}
                    className="bg-white rounded-3xl border border-slate-200 p-6 flex flex-col justify-between space-y-6 shadow-xs hover:border-blue-400 transition-all"
                  >
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="px-3 py-1 bg-emerald-100 text-emerald-800 font-extrabold text-xs rounded-full flex items-center gap-1">
                          <Sparkles className="w-3 h-3" />
                          {row.matchScore}% Match
                        </span>
                        <span className="text-2xl font-extrabold text-slate-900">
                          ${row.price.toLocaleString()}
                        </span>
                      </div>

                      <div>
                        <h3 className="font-bold text-base text-slate-900">{row.opportunityName}</h3>
                        <p className="text-xs text-slate-500">{row.tier} · Up to {row.slots} sponsor{row.slots === 1 ? '' : 's'}</p>
                      </div>

                      <p className="text-xs text-slate-600 leading-relaxed">{row.opportunityDescription}</p>

                      <div className="space-y-2 pt-2 border-t border-slate-100">
                        <div className="text-[10px] font-bold uppercase text-slate-400">Included Benefits</div>
                        <ul className="space-y-1.5 text-xs text-slate-700">
                          {row.benefits.map((ben, idx) => (
                            <li key={idx} className="flex items-center gap-2">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                              <span>{ben}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <button
                      onClick={() => handleApplySponsorship({ tier: row.tier, conferenceTitle: row.opportunityName })}
                      disabled={!verified}
                      className="w-full py-3 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-md transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-blue-900"
                    >
                      {verified ? 'Apply for Sponsorship' : 'Applications Restricted'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {appliedSuccess && (
            <div className="p-4 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-2xl text-xs font-bold text-center">
              ✓ Sponsorship application submitted! The conference organizing committee will contact your team for branding assets.
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Real-time ROI Dashboard */}
      {activeTab === 'roi' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="p-6 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-1">
              <div className="text-xs font-bold text-slate-400 uppercase">Logo Impressions</div>
              <div className="text-2xl font-extrabold text-slate-900">142,800 Views</div>
              <div className="text-[11px] font-semibold text-emerald-600">On Platform & Emails</div>
            </div>

            <div className="p-6 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-1">
              <div className="text-xs font-bold text-slate-400 uppercase">Digital Booth Traffic</div>
              <div className="text-2xl font-extrabold text-blue-600">3,420 Visitors</div>
              <div className="text-[11px] font-semibold text-slate-500">Average dwell time: 4m 12s</div>
            </div>

            <div className="p-6 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-1">
              <div className="text-xs font-bold text-slate-400 uppercase">B2B Lead Contacts</div>
              <div className="text-2xl font-extrabold text-blue-700">384 Qualified Leads</div>
              <div className="text-[11px] font-semibold text-blue-600">Verified Professional Profiles</div>
            </div>

            <div className="p-6 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-1">
              <div className="text-xs font-bold text-slate-400 uppercase">Whitepaper Downloads</div>
              <div className="text-2xl font-extrabold text-emerald-700">620 Downloads</div>
              <div className="text-[11px] font-semibold text-emerald-600">Subsurface AI Paper</div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Digital Booth Setup */}
      {activeTab === 'booth' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 space-y-6 max-w-2xl mx-auto shadow-xs">
          <h2 className="text-lg font-bold text-slate-900">Digital Exhibition Booth Customizer</h2>
          <p className="text-xs text-slate-500">
            Configure your corporate logo, promotional video embed, representative booth staff, and downloadable whitepapers.
          </p>

          <form className="space-y-4 text-xs">
            <div className="space-y-1.5">
              <label className="font-bold text-slate-900 uppercase tracking-wider text-[10px]">Company Name</label>
              <input type="text" defaultValue="Aramco Scientific Solutions" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-medium" />
            </div>

            <div className="space-y-1.5">
              <label className="font-bold text-slate-900 uppercase tracking-wider text-[10px]">Booth Headline / Motto</label>
              <input type="text" defaultValue="Pioneering AI-Driven Subsurface Energy Solutions & Sustainable Carbon Storage" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-medium" />
            </div>

            <div className="space-y-1.5">
              <label className="font-bold text-slate-900 uppercase tracking-wider text-[10px]">Whitepaper Download Link</label>
              <input type="text" defaultValue="https://aramco.com/whitepapers/subsurface-ai-2026.pdf" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-medium" />
            </div>

            <button type="button" className="w-full py-3 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer">
              Save Booth Configuration
            </button>
          </form>
        </div>
      )}

      {/* Tab 4: Sponsor Profile & Verification */}
      {activeTab === 'profile' && (
        <div className="space-y-6">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <img
                  src={sponsorProfile.logo}
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

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                <div className="text-[10px] font-bold text-slate-400 uppercase">Active Sponsorships</div>
                <div className="text-lg font-extrabold text-slate-900">{sponsorProfile.activeSponsorshipsCount}</div>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                <div className="text-[10px] font-bold text-slate-400 uppercase">Leads Captured</div>
                <div className="text-lg font-extrabold text-blue-700">{sponsorProfile.leadsCaptured}</div>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                <div className="text-[10px] font-bold text-slate-400 uppercase">ROI Score</div>
                <div className="text-lg font-extrabold text-emerald-700">{sponsorProfile.roiScore}</div>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                <div className="text-[10px] font-bold text-slate-400 uppercase">Profile Views</div>
                <div className="text-lg font-extrabold text-slate-900">{sponsorProfile.profileViews.toLocaleString()}</div>
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
              <h3 className="font-bold text-sm text-slate-900">Feedback from Organizers & Professionals</h3>
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
