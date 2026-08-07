import React, { useState } from 'react';
import {
  User,
  Award,
  ShieldCheck,
  FileText,
  Calendar,
  Building2,
  CheckCircle2,
  Zap,
  Download,
  Share2,
  MapPin,
  Globe,
  Briefcase,
} from 'lucide-react';
import { UserProfile } from '../types';
import { ConferenceFeedbackModal } from './ConferenceFeedbackModal';
import { ProfileAnalytics } from './ProfileAnalytics';

interface UserProfileViewProps {
  userProfile: UserProfile;
  onOpenBadgeModal: () => void;
  onOpenCertificates: () => void;
}

export const UserProfileView: React.FC<UserProfileViewProps> = ({
  userProfile,
  onOpenBadgeModal,
  onOpenCertificates,
}) => {
  const [activeTab, setActiveTab] = useState<'conferences' | 'papers' | 'reviews' | 'committee' | 'badges' | 'analytics'>('conferences');
  const [feedbackConference, setFeedbackConference] = useState<string | null>(null);

  return (
    <div className="space-y-8">
      {/* Top Banner & Profile Header */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
        {/* Cover Header */}
        <div className="h-36 bg-slate-100 relative" />

        {/* Profile Info Row */}
        <div className="px-6 sm:px-8 pb-8 relative flex flex-col sm:flex-row items-start sm:items-end justify-between gap-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-6">
            <div className="relative -mt-12 shrink-0">
              <img
                src={userProfile.avatar}
                alt={userProfile.name}
                className="w-28 h-28 rounded-3xl object-cover ring-4 ring-white shadow-xl bg-slate-900"
              />
              <span className="absolute -bottom-1 -right-1 group/badge">
                <span className="w-7 h-7 rounded-full bg-blue-600 ring-[3px] ring-white shadow-md flex items-center justify-center cursor-default">
                  <ShieldCheck className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
                </span>
                <span className="pointer-events-none absolute bottom-full right-0 mb-2 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-[10px] font-semibold text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/badge:opacity-100">
                  Verified Conference Identity
                  <span className="absolute top-full right-2.5 -mt-px border-4 border-transparent border-t-slate-900" />
                </span>
              </span>
            </div>
            <div className="space-y-1 pt-2 sm:pt-0">
              <h1 className="text-2xl font-extrabold text-slate-900">{userProfile.name}</h1>
              <p className="text-xs font-semibold text-slate-600">{userProfile.title}</p>
              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 pt-1">
                <span className="flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5 text-slate-400" />
                  {userProfile.organization}
                </span>
                <span className="flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-rose-500" />
                  {userProfile.location}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2 sm:pt-0">
            <button
              onClick={onOpenBadgeModal}
              className="px-4 py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-2"
            >
              <Award className="w-4 h-4" />
              <span>Digital Badge</span>
            </button>
            <button
              onClick={onOpenCertificates}
              className="px-4 py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              <span>Certificates</span>
            </button>
          </div>
        </div>

        {/* Verified Conference Reputation Stats Grid */}
        <div className="px-6 sm:px-8 py-6 bg-slate-50 border-t border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="p-3 bg-white rounded-xl border border-slate-200 text-center">
            <div className="text-[10px] font-bold text-slate-400 uppercase">Conference Gate Index</div>
            <div className="text-xl font-extrabold text-blue-700">890 / 1000</div>
          </div>

          <div className="p-3 bg-white rounded-xl border border-slate-200 text-center">
            <div className="text-[10px] font-bold text-slate-400 uppercase">Reviewer Kudos</div>
            <div className="text-xl font-extrabold text-blue-600 flex items-center justify-center gap-1">
              <Zap className="w-4 h-4 fill-blue-500" />
              <span>+{userProfile.contributions.reviewerKudos}</span>
            </div>
          </div>

          <div className="p-3 bg-white rounded-xl border border-slate-200 text-center">
            <div className="text-[10px] font-bold text-slate-400 uppercase">Presented Papers</div>
            <div className="text-xl font-extrabold text-slate-900">{userProfile.contributions.papersPresented} Papers</div>
          </div>

          <div className="p-3 bg-white rounded-xl border border-slate-200 text-center">
            <div className="text-[10px] font-bold text-slate-400 uppercase">Committee Roles</div>
            <div className="text-xl font-extrabold text-indigo-700">{userProfile.contributions.committeesServed} Positions</div>
          </div>
        </div>

        {/* Profile Tabs */}
        <div className="px-6 sm:px-8 border-t border-slate-200 flex gap-6 overflow-x-auto text-xs font-semibold text-slate-600">
          {[
            { id: 'conferences', label: 'Conferences History' },
            { id: 'papers', label: 'Papers & Abstracts' },
            { id: 'reviews', label: 'Peer Reviews & Kudos' },
            { id: 'committee', label: 'Committee Positions' },
            { id: 'badges', label: 'Verified Badges' },
            { id: 'analytics', label: 'Engagement Analytics' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`py-4 border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600 font-bold'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-xs">
        {activeTab === 'conferences' && (
          <div className="space-y-4">
            <h3 className="text-base font-bold text-slate-900">Verified Conferences Attended</h3>
            <div className="space-y-3">
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between gap-3">
                <div>
                  <h4 className="font-bold text-xs text-slate-900">Annual Subsurface Energy & AI Summit 2026</h4>
                  <p className="text-[11px] text-slate-500">Abu Dhabi, UAE • Attended as Presenter & Keynote Delegate</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setFeedbackConference('Annual Subsurface Energy & AI Summit 2026')}
                    className="px-2.5 py-1 border border-blue-200 text-blue-700 hover:bg-blue-50 font-bold text-[10px] rounded-full cursor-pointer transition-colors"
                  >
                    Leave Feedback
                  </button>
                  <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 font-bold text-[10px] rounded-full whitespace-nowrap">
                    Verified Attendance
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'badges' && (
          <div className="space-y-6">
            <h3 className="text-base font-bold text-slate-900">Verified Conference Identity Badges</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {userProfile.verifiedAchievements.map((b) => (
                <div key={b.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-center space-y-2">
                  <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-700 mx-auto flex items-center justify-center font-bold">
                    <Award className="w-6 h-6" />
                  </div>
                  <div className="font-bold text-xs text-slate-900">{b.title}</div>
                  <div className="text-[10px] text-slate-500">{b.conferenceName} ({b.year})</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'analytics' && <ProfileAnalytics />}
      </div>

      <ConferenceFeedbackModal
        isOpen={feedbackConference !== null}
        onClose={() => setFeedbackConference(null)}
        conferenceTitle={feedbackConference || ''}
      />
    </div>
  );
};
