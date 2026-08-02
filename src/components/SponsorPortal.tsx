import React, { useState } from 'react';
import {
  Briefcase,
  DollarSign,
  TrendingUp,
  Award,
  Eye,
  Users,
  Building2,
  CheckCircle2,
  Plus,
  BarChart3,
  Globe,
  FileText,
  Sparkles,
} from 'lucide-react';
import { SponsorshipPackage } from '../types';

interface SponsorPortalProps {
  sponsorshipPackages: SponsorshipPackage[];
}

export const SponsorPortal: React.FC<SponsorPortalProps> = ({
  sponsorshipPackages,
}) => {
  const [activeTab, setActiveTab] = useState<'marketplace' | 'roi' | 'booth'>('marketplace');
  const [selectedPackage, setSelectedPackage] = useState<SponsorshipPackage | null>(null);
  const [appliedSuccess, setAppliedSuccess] = useState(false);

  const handleApplySponsorship = (pkg: SponsorshipPackage) => {
    setSelectedPackage(pkg);
    setAppliedSuccess(true);
    setTimeout(() => {
      setAppliedSuccess(false);
      setSelectedPackage(null);
    }, 4000);
  };

  return (
    <div className="space-y-8">
      {/* Top Banner */}
      <div className="bg-blue-950 text-white rounded-3xl p-6 sm:p-8 shadow-xl border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 bg-blue-500/20 text-blue-300 border border-blue-400/30 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Briefcase className="w-3.5 h-3.5 text-blue-400" />
                Corporate Sponsorship Marketplace
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Sponsor Marketplace & Real-Time ROI Analytics
            </h1>
            <p className="text-xs text-slate-300">
              Connect corporate brands with world-class technical and scientific conferences. Track logo impressions, digital booth traffic, and B2B leads.
            </p>
          </div>

          <div className="bg-white/10 backdrop-blur-md border border-white/20 p-4 rounded-2xl flex items-center gap-6 shrink-0">
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-300">Active Impressions</div>
              <div className="text-2xl font-extrabold text-blue-300">142,800</div>
            </div>
            <div className="border-l border-white/20 pl-6">
              <div className="text-[10px] uppercase font-bold text-slate-300">B2B Leads Captured</div>
              <div className="text-2xl font-extrabold text-emerald-400">384 Leads</div>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="bg-white rounded-2xl border border-slate-200 p-2 flex gap-2 overflow-x-auto text-xs font-semibold text-slate-600">
        <button
          onClick={() => setActiveTab('marketplace')}
          className={`px-4 py-2.5 rounded-xl transition-colors cursor-pointer ${
            activeTab === 'marketplace'
              ? 'bg-blue-600 text-white font-bold shadow-xs'
              : 'hover:bg-slate-100 text-slate-700'
          }`}
        >
          Sponsorship Marketplace ({sponsorshipPackages.length})
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
      </div>

      {/* Tab 1: Marketplace */}
      {activeTab === 'marketplace' && (
        <div className="space-y-6">
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
                  onClick={() => handleApplySponsorship(pkg)}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition-colors cursor-pointer"
                >
                  Apply for Sponsorship
                </button>
              </div>
            ))}
          </div>

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

            <button type="button" className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer">
              Save Booth Configuration
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
