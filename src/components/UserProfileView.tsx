import React, { useRef, useState } from 'react';
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
  BookOpen,
  Users,
  Gauge,
  Sparkles,
  ExternalLink,
  Camera,
  Loader2,
} from 'lucide-react';
import { AbstractSubmission, ConferenceRole, NotificationItem, UserProfile } from '../types';
import { ConferenceFeedbackModal } from './ConferenceFeedbackModal';
import { ProfileAnalytics } from './ProfileAnalytics';
import { ProfileNotifications } from './ProfileNotifications';
import { resizeImageFile } from '../utils/image';

type ProfileTab = 'conferences' | 'papers' | 'reviews' | 'committee' | 'badges' | 'analytics' | 'notifications';

interface UserProfileViewProps {
  userProfile: UserProfile;
  submissions?: AbstractSubmission[];
  onOpenBadgeModal: () => void;
  onOpenCertificates: () => void;
  initialTab?: ProfileTab;
  notifications: NotificationItem[];
  onMarkNotificationRead: (id: string) => void;
  onMarkAllNotificationsRead: () => void;
  onAvatarChange?: (dataUrl: string | null) => void | Promise<void>;
  hasCustomAvatar?: boolean;
}

const ABSTRACT_STATUS_STYLE: Record<string, string> = {
  Accepted: 'bg-emerald-100 text-emerald-800',
  'Accepted for Oral': 'bg-emerald-100 text-emerald-800',
  'Accepted for Poster': 'bg-emerald-100 text-emerald-800',
  Rejected: 'bg-rose-100 text-rose-700',
  Withdrawn: 'bg-slate-200 text-slate-600',
  'Revision Requested': 'bg-amber-100 text-amber-800',
};
const abstractStatusClass = (status: string) => ABSTRACT_STATUS_STYLE[status] || 'bg-blue-100 text-blue-700';

interface AttendedConference {
  id: string;
  title: string;
  location: string;
  roleLabel: string;
  organizerName: string;
  eventDate: string;
  defaultRole: ConferenceRole;
}

const ATTENDED_CONFERENCES: AttendedConference[] = [
  {
    id: 'conf_1',
    title: 'EAGE Annual Conference & Exhibition 2026',
    location: 'Amsterdam, Netherlands',
    roleLabel: 'Attended as Presenter & Keynote Delegate',
    organizerName: 'European Association of Geoscientists & Engineers (EAGE)',
    eventDate: 'June 25–28, 2026',
    defaultRole: 'Keynote',
  },
];

export const UserProfileView: React.FC<UserProfileViewProps> = ({
  userProfile,
  submissions = [],
  onOpenBadgeModal,
  onOpenCertificates,
  initialTab = 'conferences',
  notifications,
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
  onAvatarChange,
  hasCustomAvatar = false,
}) => {
  const [activeTab, setActiveTab] = useState<ProfileTab>(initialTab);
  const [feedbackConference, setFeedbackConference] = useState<AttendedConference | null>(null);
  const unreadNotifCount = notifications.filter((n) => !n.read).length;
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const handleAvatarFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !onAvatarChange) return;
    setAvatarError(null);
    setAvatarUploading(true);
    try {
      const dataUrl = await resizeImageFile(file);
      await onAvatarChange(dataUrl);
    } catch {
      setAvatarError('Could not update your photo. Please try another image.');
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleRemovePhoto = async () => {
    if (!onAvatarChange) return;
    setAvatarError(null);
    setAvatarUploading(true);
    try {
      await onAvatarChange(null);
    } catch {
      setAvatarError('Could not remove your photo. Please try again.');
    } finally {
      setAvatarUploading(false);
    }
  };

  const mySubmissions = submissions.filter((s) => s.primaryAuthor.name === userProfile.name);

  const committeeEntries = [
    ...userProfile.verifiedAchievements
      .filter((a) => a.badgeType === 'committee' || a.badgeType === 'chair')
      .map((a) => ({
        title: a.title,
        conferenceName: a.conferenceName,
        year: a.year,
        roleLabel: a.badgeType === 'chair' ? 'Session Chair' : 'Committee Member',
      })),
    ...userProfile.timeline.flatMap((yr) =>
      yr.items
        .filter((item) => /committee|chair/i.test(item.role))
        .map((item) => ({
          title: item.title,
          conferenceName: item.conference,
          year: yr.year,
          roleLabel: item.role,
        }))
    ),
  ]
    .filter((entry, idx, arr) => arr.findIndex((e) => e.title === entry.title && e.year === entry.year) === idx)
    .sort((a, b) => b.year - a.year);

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
              {avatarUploading && (
                <span className="absolute inset-0 rounded-3xl bg-slate-900/50 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-white animate-spin" />
                </span>
              )}
              <span className="absolute -bottom-1 -right-1 group/badge">
                <span className="w-7 h-7 rounded-full bg-blue-600 ring-[3px] ring-white shadow-md flex items-center justify-center cursor-default">
                  <ShieldCheck className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
                </span>
                <span className="pointer-events-none absolute bottom-full right-0 mb-2 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-[10px] font-semibold text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/badge:opacity-100">
                  Verified Conference Identity
                  <span className="absolute top-full right-2.5 -mt-px border-4 border-transparent border-t-slate-900" />
                </span>
              </span>
              {onAvatarChange && (
                <button
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={avatarUploading}
                  title="Change photo"
                  className="absolute -bottom-1 -left-1 w-7 h-7 rounded-full bg-white ring-[3px] ring-white shadow-md flex items-center justify-center cursor-pointer hover:bg-slate-50 disabled:opacity-60"
                >
                  <Camera className="w-3.5 h-3.5 text-slate-600" />
                </button>
              )}
              {onAvatarChange && (
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarFileSelected}
                />
              )}
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
              {onAvatarChange && (
                <div className="flex items-center gap-3 pt-1.5">
                  <button
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={avatarUploading}
                    className="text-[11px] font-bold text-blue-700 hover:underline cursor-pointer disabled:opacity-60"
                  >
                    Change Photo
                  </button>
                  {hasCustomAvatar && (
                    <button
                      onClick={handleRemovePhoto}
                      disabled={avatarUploading}
                      className="text-[11px] font-bold text-slate-400 hover:text-rose-600 hover:underline cursor-pointer disabled:opacity-60"
                    >
                      Remove Photo
                    </button>
                  )}
                </div>
              )}
              {avatarError && <p className="text-[11px] font-semibold text-rose-600">{avatarError}</p>}
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
            <div className="text-xl font-extrabold text-slate-900">
              {userProfile.contributions.oralPresentations + userProfile.contributions.posterPresentations} Papers
            </div>
          </div>

          <div className="p-3 bg-white rounded-xl border border-slate-200 text-center">
            <div className="text-[10px] font-bold text-slate-400 uppercase">Committee Roles</div>
            <div className="text-xl font-extrabold text-indigo-700">{userProfile.contributions.technicalCommittees} Positions</div>
          </div>
        </div>

        {/* Profile Tabs */}
        <div className="px-6 sm:px-8 border-t border-slate-200 flex gap-6 overflow-x-auto text-xs font-semibold text-slate-600">
          {[
            { id: 'notifications', label: 'Notifications' },
            { id: 'conferences', label: 'Conferences History' },
            { id: 'papers', label: 'Papers & Abstracts' },
            { id: 'reviews', label: 'Peer Reviews & Kudos' },
            { id: 'committee', label: 'Committee Positions' },
            { id: 'badges', label: 'Verified Badges' },
            { id: 'analytics', label: 'Engagement Analytics' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as ProfileTab)}
              className={`py-4 border-b-2 transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600 font-bold'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              {tab.label}
              {tab.id === 'notifications' && unreadNotifCount > 0 && (
                <span className="min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
                  {unreadNotifCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-xs">
        {activeTab === 'notifications' && (
          <ProfileNotifications
            notifications={notifications}
            onMarkRead={onMarkNotificationRead}
            onMarkAllRead={onMarkAllNotificationsRead}
          />
        )}

        {activeTab === 'conferences' && (
          <div className="space-y-4">
            <h3 className="text-base font-bold text-slate-900">Verified Conferences Attended</h3>
            <div className="space-y-3">
              {ATTENDED_CONFERENCES.map((conf) => (
                <div key={conf.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="font-bold text-xs text-slate-900">{conf.title}</h4>
                    <p className="text-[11px] text-slate-500">{conf.location} • {conf.roleLabel}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setFeedbackConference(conf)}
                      className="px-2.5 py-1 border border-blue-200 text-blue-700 hover:bg-blue-50 font-bold text-[10px] rounded-full cursor-pointer transition-colors"
                    >
                      Leave Feedback
                    </button>
                    <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 font-bold text-[10px] rounded-full whitespace-nowrap">
                      Verified Attendance
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'papers' && (
          <div className="space-y-8">
            <div className="space-y-4">
              <h3 className="text-base font-bold text-slate-900">Abstract Submissions</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Submitted</div>
                  <div className="text-lg font-extrabold text-slate-900">{userProfile.contributions.abstractsSubmitted}</div>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Accepted</div>
                  <div className="text-lg font-extrabold text-emerald-700">{userProfile.contributions.abstractsAccepted}</div>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Oral Presentations</div>
                  <div className="text-lg font-extrabold text-blue-700">{userProfile.contributions.oralPresentations}</div>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Poster Presentations</div>
                  <div className="text-lg font-extrabold text-indigo-700">{userProfile.contributions.posterPresentations}</div>
                </div>
              </div>

              {mySubmissions.length > 0 ? (
                <div className="space-y-3">
                  {mySubmissions.map((sub) => (
                    <div key={sub.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="font-bold text-xs text-slate-900 truncate">{sub.title}</h4>
                        <p className="text-[11px] text-slate-500">{sub.conferenceTitle} • {sub.topic} • {sub.preferredType}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">Submitted {sub.submissionDate}</p>
                      </div>
                      <span className={`px-2.5 py-0.5 font-bold text-[10px] rounded-full whitespace-nowrap shrink-0 ${abstractStatusClass(sub.status)}`}>
                        {sub.status}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">No abstract submissions on record yet.</p>
              )}
            </div>

            <div className="space-y-4 pt-4 border-t border-slate-100">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-blue-600" />
                Published Research
              </h3>
              <div className="space-y-2">
                {userProfile.publications.map((pub) => (
                  <div key={pub.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                    <h4 className="font-bold text-xs text-slate-900">{pub.title}</h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">{pub.journal} ({pub.year})</p>
                    {pub.doi && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-blue-600 mt-1 font-mono">
                        <ExternalLink className="w-3 h-3" />
                        DOI: {pub.doi}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'reviews' && (
          <div className="space-y-6">
            <h3 className="text-base font-bold text-slate-900">Peer Review Profile</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                <div className="text-[10px] font-bold text-slate-400 uppercase">Abstracts Reviewed</div>
                <div className="text-lg font-extrabold text-slate-900">{userProfile.reviewerInfo.totalReviewed}</div>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                <div className="text-[10px] font-bold text-slate-400 uppercase">Reviewer Kudos</div>
                <div className="text-lg font-extrabold text-blue-600 flex items-center justify-center gap-1">
                  <Zap className="w-3.5 h-3.5 fill-blue-500" />+{userProfile.reviewerInfo.kudos}
                </div>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                <div className="text-[10px] font-bold text-slate-400 uppercase">Current Load</div>
                <div className="text-lg font-extrabold text-amber-600 flex items-center justify-center gap-1">
                  <Gauge className="w-3.5 h-3.5" />
                  {userProfile.reviewerInfo.currentLoad}/{userProfile.reviewerInfo.maxLoad}
                </div>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                <div className="text-[10px] font-bold text-slate-400 uppercase">Conferences Reviewed For</div>
                <div className="text-lg font-extrabold text-indigo-700">{userProfile.contributions.conferencesReviewedFor}</div>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Reviewer Badges Earned</h4>
              <div className="flex flex-wrap gap-2">
                {userProfile.reviewerInfo.badges.map((b, idx) => (
                  <span key={idx} className="px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-full text-[11px] font-bold flex items-center gap-1.5">
                    <Award className="w-3.5 h-3.5" />
                    {b}
                  </span>
                ))}
              </div>
            </div>

            {userProfile.reviewerInfo.outstandingAwards.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Outstanding Awards</h4>
                <div className="space-y-2">
                  {userProfile.reviewerInfo.outstandingAwards.map((a, idx) => (
                    <div key={idx} className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 font-semibold flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
                      {a}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Review Expertise</h4>
              <div className="flex flex-wrap gap-2">
                {userProfile.reviewerInfo.expertiseKeywords.map((k, idx) => (
                  <span key={idx} className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-full text-[11px] font-semibold">
                    {k}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'committee' && (
          <div className="space-y-6">
            <h3 className="text-base font-bold text-slate-900">Committee & Leadership Roles</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                <div className="text-[10px] font-bold text-slate-400 uppercase">Committee Positions</div>
                <div className="text-lg font-extrabold text-indigo-700">{userProfile.contributions.technicalCommittees}</div>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                <div className="text-[10px] font-bold text-slate-400 uppercase">Sessions Chaired</div>
                <div className="text-lg font-extrabold text-slate-900">{userProfile.contributions.sessionsChaired}</div>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                <div className="text-[10px] font-bold text-slate-400 uppercase">Panels Participated</div>
                <div className="text-lg font-extrabold text-blue-700">{userProfile.contributions.panelsParticipated}</div>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                <div className="text-[10px] font-bold text-slate-400 uppercase">Workshops Delivered</div>
                <div className="text-lg font-extrabold text-emerald-700">{userProfile.contributions.workshopsDelivered}</div>
              </div>
            </div>

            {committeeEntries.length > 0 ? (
              <div className="space-y-3">
                {committeeEntries.map((entry, idx) => (
                  <div key={idx} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                        <Users className="w-4 h-4" />
                      </span>
                      <div className="min-w-0">
                        <h4 className="font-bold text-xs text-slate-900 truncate">{entry.title}</h4>
                        <p className="text-[11px] text-slate-500">{entry.conferenceName} • {entry.year}</p>
                      </div>
                    </div>
                    <span className="px-2.5 py-0.5 bg-indigo-100 text-indigo-800 font-bold text-[10px] rounded-full whitespace-nowrap shrink-0">
                      {entry.roleLabel}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400">No committee positions on record yet.</p>
            )}
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
        conferenceTitle={feedbackConference?.title || ''}
        organizerName={feedbackConference?.organizerName || ''}
        eventDate={feedbackConference?.eventDate || ''}
        participantName={userProfile.name}
        participantCompany={userProfile.organization}
        defaultRole={feedbackConference?.defaultRole}
      />
    </div>
  );
};
