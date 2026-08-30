import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  Pencil,
  Linkedin,
  Search,
  Plus,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { AbstractSubmission, Conference, ConferenceRole, NotificationItem, Post, UserProfile } from '../types';
import { ConferenceFeedbackModal } from './ConferenceFeedbackModal';
import { ConferenceLink } from './ConferenceLink';
import { ProfileAnalytics } from './ProfileAnalytics';
import { ProfileNotifications } from './ProfileNotifications';
import { EditProfileModal } from './EditProfileModal';
import { AddAttendanceModal } from './AddAttendanceModal';
import { AddCommitteePositionModal } from './AddCommitteePositionModal';
import { resizeImageFile } from '../utils/image';
import { generateInitialsAvatar } from '../utils/avatar';
import type { KeynoteSpeakerMatch } from '../api/auth';
import {
  ConferenceRegistration,
  fetchMyExternalPapers,
  decideExternalPaper,
  ExternalPaper,
  fetchMySelfReportedAttendance,
  addSelfReportedAttendance,
  removeSelfReportedAttendance,
  SelfReportedAttendance,
  AddSelfReportedAttendancePayload,
  fetchMyCommitteePositions,
  addCommitteePosition,
  removeCommitteePosition,
  SelfReportedCommitteePosition,
  AddCommitteePositionPayload,
} from '../api/activity';

type ProfileTab = 'conferences' | 'papers' | 'reviews' | 'committee' | 'badges' | 'analytics' | 'notifications';

interface UserProfileViewProps {
  userProfile: UserProfile;
  currentUserId?: string;
  submissions?: AbstractSubmission[];
  posts?: Post[];
  registrations?: ConferenceRegistration[];
  conferences?: Conference[];
  onSelectConference?: (conf: Conference) => void;
  onOpenBadgeModal: () => void;
  onOpenCertificates: () => void;
  initialTab?: ProfileTab;
  /** Organizers and sponsors already have their own full dashboards (conference management,
   * sponsorship packages, etc.) — this page shows only what's still relevant to them
   * personally, not the professional-reviewer tabs (papers, peer reviews, committee, badges). */
  variant?: 'professional' | 'organizer' | 'sponsor';
  notifications: NotificationItem[];
  onMarkNotificationRead: (id: string) => void;
  onMarkAllNotificationsRead: () => void;
  onAvatarChange?: (dataUrl: string | null) => void | Promise<void>;
  hasCustomAvatar?: boolean;
  onEditProfile?: (payload: {
    name: string;
    title: string;
    organization: string;
    department: string;
    city: string;
    country: string;
    bio: string;
    linkedinUrl: string;
  }) => Promise<void>;
  currentUserEmail?: string;
  keynoteSpeakerMatches?: KeynoteSpeakerMatch[];
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

export const UserProfileView: React.FC<UserProfileViewProps> = ({
  userProfile,
  currentUserId,
  submissions = [],
  posts = [],
  registrations = [],
  conferences = [],
  onSelectConference = () => {},
  onOpenBadgeModal,
  onOpenCertificates,
  initialTab = 'conferences',
  variant = 'professional',
  notifications,
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
  onAvatarChange,
  hasCustomAvatar = false,
  onEditProfile,
  currentUserEmail,
  keynoteSpeakerMatches = [],
}) => {
  const [activeTab, setActiveTab] = useState<ProfileTab>(initialTab);
  const [feedbackConference, setFeedbackConference] = useState<AttendedConference | null>(null);

  // Verified attendance is derived from real, persisted conference registrations —
  // never fabricated, so it starts empty until the account actually registers for one.
  const ATTENDED_CONFERENCES: AttendedConference[] = useMemo(
    () =>
      registrations.map((reg) => {
        const conf = conferences.find((c) => c.id === reg.conferenceId);
        return {
          id: reg.conferenceId,
          title: reg.conferenceTitle || conf?.title || 'Conference',
          location: conf ? `${conf.location.city}, ${conf.location.country}` : '',
          roleLabel: reg.packageName ? `${reg.packageName} Registration` : 'Attendee',
          organizerName: conf?.organizerName || '',
          eventDate: conf ? `${conf.dates.start} – ${conf.dates.end}` : reg.registeredAt.split('T')[0],
          defaultRole: 'Attendee' as ConferenceRole,
        };
      }),
    [registrations, conferences]
  );
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
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

  // Includes abstracts where this account is only a co-author (matched by email) — real prior
  // engagement recorded by someone else's submission, surfaced automatically.
  const myEmail = currentUserEmail?.trim().toLowerCase();
  const mySubmissions = submissions.filter(
    (s) =>
      s.primaryAuthor.name === userProfile.name ||
      (myEmail && (s.coAuthors || []).some((ca) => ca.email?.trim().toLowerCase() === myEmail))
  );

  // Conference papers matched by name against free public indexes (CrossRef, Semantic Scholar,
  // DBLP) — needs no field from the account beyond the name it already has. Candidates are
  // never treated as confirmed until the person explicitly says so, since names aren't unique.
  const [externalConfirmed, setExternalConfirmed] = useState<ExternalPaper[]>([]);
  const [externalCandidates, setExternalCandidates] = useState<ExternalPaper[]>([]);
  const [externalLoading, setExternalLoading] = useState(false);
  const [externalRefreshing, setExternalRefreshing] = useState(false);
  const [decidingDoi, setDecidingDoi] = useState<string | null>(null);
  const [researchSearchName, setResearchSearchName] = useState(userProfile.name);

  useEffect(() => {
    setResearchSearchName(userProfile.name);
  }, [userProfile.name]);

  useEffect(() => {
    let cancelled = false;
    setExternalLoading(true);
    fetchMyExternalPapers()
      .then((res) => {
        if (!cancelled) {
          setExternalConfirmed(res.confirmed);
          setExternalCandidates(res.candidates);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setExternalConfirmed([]);
          setExternalCandidates([]);
        }
      })
      .finally(() => {
        if (!cancelled) setExternalLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  // A person can land here right after fixing a name that was too short to match well, or just
  // want to check whether something new has been indexed since the last visit — but each source
  // caches its own results for 24 hours, so simply revisiting this tab would silently keep
  // serving that cached answer. This bypasses it and searches CrossRef, Semantic Scholar, and
  // DBLP fresh, right now, for whatever name is on the account currently.
  const handleSearchAgain = async () => {
    setExternalRefreshing(true);
    try {
      const res = await fetchMyExternalPapers(true, researchSearchName);
      setExternalConfirmed(res.confirmed);
      setExternalCandidates(res.candidates);
    } catch {
      // Non-critical — whatever was already showing just stays as-is.
    } finally {
      setExternalRefreshing(false);
    }
  };

  const handleDecideExternalPaper = async (paper: ExternalPaper, decision: 'confirmed' | 'dismissed') => {
    setDecidingDoi(paper.doi);
    try {
      await decideExternalPaper(paper, decision);
      setExternalCandidates((prev) => prev.filter((p) => p.doi !== paper.doi));
      setExternalConfirmed((prev) =>
        decision === 'confirmed'
          ? [...prev.filter((p) => p.doi !== paper.doi), paper]
          : prev.filter((p) => p.doi !== paper.doi)
      );
    } catch {
      // Non-critical — the candidate just stays in the list to try again.
    } finally {
      setDecidingDoi(null);
    }
  };

  // Plain attendance (no presentation) has no real, name-searchable public source anywhere —
  // attendee lists are private to organizers. This is the account typing it in themselves,
  // always shown labeled self-reported and never mixed with verified registrations.
  const [selfReported, setSelfReported] = useState<SelfReportedAttendance[]>([]);
  const [selfReportedLoading, setSelfReportedLoading] = useState(false);
  const [isAddAttendanceOpen, setIsAddAttendanceOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSelfReportedLoading(true);
    fetchMySelfReportedAttendance()
      .then((entries) => {
        if (!cancelled) setSelfReported(entries);
      })
      .catch(() => {
        if (!cancelled) setSelfReported([]);
      })
      .finally(() => {
        if (!cancelled) setSelfReportedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  const handleAddSelfReportedAttendance = async (payload: AddSelfReportedAttendancePayload) => {
    const entry = await addSelfReportedAttendance(payload);
    setSelfReported((prev) => [entry, ...prev]);
  };

  const handleRemoveSelfReportedAttendance = async (id: string) => {
    const previous = selfReported;
    setSelfReported((prev) => prev.filter((e) => e.id !== id));
    try {
      await removeSelfReportedAttendance(id);
    } catch {
      setSelfReported(previous);
    }
  };

  // Same honesty pattern as self-reported attendance — committee/chair service has no public,
  // name-searchable source either, so this is the account typing it in themselves.
  const [selfReportedCommittee, setSelfReportedCommittee] = useState<SelfReportedCommitteePosition[]>([]);
  const [committeeLoading, setCommitteeLoading] = useState(false);
  const [isAddCommitteeOpen, setIsAddCommitteeOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCommitteeLoading(true);
    fetchMyCommitteePositions()
      .then((entries) => {
        if (!cancelled) setSelfReportedCommittee(entries);
      })
      .catch(() => {
        if (!cancelled) setSelfReportedCommittee([]);
      })
      .finally(() => {
        if (!cancelled) setCommitteeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  const handleAddCommitteePosition = async (payload: AddCommitteePositionPayload) => {
    const entry = await addCommitteePosition(payload);
    setSelfReportedCommittee((prev) => [entry, ...prev]);
  };

  const handleRemoveCommitteePosition = async (id: string) => {
    const previous = selfReportedCommittee;
    setSelfReportedCommittee((prev) => prev.filter((e) => e.id !== id));
    try {
      await removeCommitteePosition(id);
    } catch {
      setSelfReportedCommittee(previous);
    }
  };

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

  const conferenceGateIndex = Math.min(
    1000,
    userProfile.contributions.reviewerKudos +
      userProfile.contributions.abstractsAccepted * 15 +
      userProfile.contributions.technicalCommittees * 25 +
      userProfile.contributions.sessionsChaired * 20 +
      userProfile.contributions.speakerRoles * 20
  );

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
                {(userProfile.city || userProfile.country) && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-rose-500" />
                    {[userProfile.city, userProfile.country].filter(Boolean).join(', ')}
                  </span>
                )}
                {userProfile.linkedinUrl && (
                  <a
                    href={userProfile.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-blue-700 hover:underline font-semibold"
                  >
                    <Linkedin className="w-3.5 h-3.5" />
                    LinkedIn
                  </a>
                )}
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
            {onEditProfile && (
              <button
                onClick={() => setIsEditProfileOpen(true)}
                className="px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-xl shadow-xs border border-slate-200 transition-colors cursor-pointer flex items-center gap-2"
              >
                <Pencil className="w-4 h-4" />
                <span>Edit Profile</span>
              </button>
            )}
            {variant === 'professional' && (
              <>
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
              </>
            )}
          </div>
        </div>

        {/* Verified Conference Reputation Stats Grid — professional/reviewer achievements only */}
        {variant === 'professional' && (
        <div className="px-6 sm:px-8 py-6 bg-slate-50 border-t border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="p-3 bg-white rounded-xl border border-slate-200 text-center">
            <div className="text-[10px] font-bold text-slate-400 uppercase">Conference Gate Index</div>
            <div className="text-xl font-extrabold text-blue-700">{conferenceGateIndex} / 1000</div>
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
        )}

        {/* Profile Tabs — organizers and sponsors already have a full dashboard elsewhere for
            everything else, so their profile page only needs Notifications and their own
            conference attendance history. */}
        <div className="px-6 sm:px-8 border-t border-slate-200 flex gap-6 overflow-x-auto text-xs font-semibold text-slate-600">
          {(variant === 'professional'
            ? [
                { id: 'notifications', label: 'Notifications' },
                { id: 'conferences', label: 'Conferences History' },
                { id: 'papers', label: 'Papers & Abstracts' },
                { id: 'reviews', label: 'Peer Reviews & Kudos' },
                { id: 'committee', label: 'Committee Positions' },
                { id: 'badges', label: 'Verified Badges' },
                { id: 'analytics', label: 'Engagement Analytics' },
              ]
            : [
                { id: 'notifications', label: 'Notifications' },
                { id: 'conferences', label: 'Conferences History' },
              ]
          ).map((tab) => (
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

        {activeTab === 'conferences' && keynoteSpeakerMatches.length > 0 && (
          <div className="space-y-4 pb-5 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2">
                <Award className="w-5 h-5 text-violet-600" />
                <h3 className="text-base font-bold text-slate-900">Keynote Speaker Recognition</h3>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Matched automatically against named keynote, plenary, invited, and featured speakers
                published on official conference websites.
              </p>
            </div>
            <div className="space-y-3">
              {keynoteSpeakerMatches.map((match) => (
                <div
                  key={`${match.conferenceUrl}-${match.speakerName}`}
                  className="p-4 bg-violet-50/60 rounded-2xl border border-violet-200 flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={match.photoUrl || generateInitialsAvatar(match.speakerName)}
                      alt=""
                      className="w-12 h-12 rounded-xl object-cover ring-1 ring-violet-200 shrink-0 bg-white"
                      onError={(event) => {
                        event.currentTarget.onerror = null;
                        event.currentTarget.src = generateInitialsAvatar(match.speakerName);
                      }}
                    />
                    <div className="min-w-0">
                      <h4 className="font-bold text-sm text-slate-900">{match.speakerName}</h4>
                      <p className="text-[11px] font-semibold text-violet-700">
                        {match.role} • {match.conferenceTitle}
                      </p>
                      {match.organization && (
                        <p className="text-[11px] text-slate-500">{match.organization}</p>
                      )}
                      <a
                        href={match.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 mt-1 text-[10px] font-bold text-blue-700 hover:underline"
                      >
                        Official source
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                  <span
                    className={`px-2.5 py-1 font-bold text-[10px] rounded-full whitespace-nowrap ${
                      match.verified
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {match.verified ? 'Verified by email' : 'Official name match'}
                  </span>
                </div>
              ))}
            </div>
            {keynoteSpeakerMatches.some((match) => !match.verified) && (
              <p className="text-[10px] text-amber-700">
                A name-only match is not treated as identity proof. It remains clearly labeled until
                an official speaker email matches the account.
              </p>
            )}
          </div>
        )}

        {activeTab === 'conferences' && (
          <div className="space-y-4">
            <h3 className="text-base font-bold text-slate-900">Verified Conferences Attended</h3>
            {ATTENDED_CONFERENCES.length > 0 ? (
              <div className="space-y-3">
                {ATTENDED_CONFERENCES.map((conf) => (
                  <div key={conf.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between gap-3">
                    <div>
                      <ConferenceLink
                        conferences={conferences}
                        conferenceId={conf.id}
                        conferenceTitle={conf.title}
                        onSelectConference={onSelectConference}
                        className="font-bold text-xs text-slate-900"
                      />
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
            ) : (
              <p className="text-xs text-slate-400">
                No verified conference attendance on record yet. Once you register for a conference through Conference
                Gate, it'll appear here.
              </p>
            )}
          </div>
        )}

        {activeTab === 'conferences' && (
          <div className="space-y-4 pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Self-Reported Attendance</h3>
              <button
                onClick={() => setIsAddAttendanceOpen(true)}
                className="px-3 py-1.5 text-[11px] font-bold text-blue-700 hover:bg-blue-50 rounded-lg cursor-pointer flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                Add a Past Conference
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              Plain attendance isn't in any public database anywhere, so this is self-reported by you —
              not verified by Conference Gate.
            </p>
            {selfReportedLoading ? (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Loading...
              </div>
            ) : selfReported.length > 0 ? (
              <div className="space-y-3">
                {selfReported.map((entry) => (
                  <div
                    key={entry.id}
                    className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-start justify-between gap-3"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      {entry.proofImage && (
                        <img
                          src={entry.proofImage}
                          alt=""
                          className="w-12 h-12 rounded-lg object-cover ring-1 ring-slate-300 shrink-0"
                        />
                      )}
                      <div className="min-w-0">
                        <h4 className="font-bold text-xs text-slate-900">{entry.conferenceName}</h4>
                        <p className="text-[11px] text-slate-500">
                          {[entry.location, entry.year, entry.role].filter(Boolean).join(' • ')}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="px-2.5 py-0.5 bg-amber-100 text-amber-800 font-bold text-[10px] rounded-full whitespace-nowrap">
                        Self-Reported
                      </span>
                      <button
                        onClick={() => handleRemoveSelfReportedAttendance(entry.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"
                        title="Remove"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400">No self-reported conferences yet.</p>
            )}
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
              <div className="space-y-3">
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Search className="w-4 h-4 text-indigo-600" />
                  Possible Papers & Abstracts (matched by name)
                </h3>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    value={researchSearchName}
                    onChange={(event) => setResearchSearchName(event.target.value)}
                    placeholder="Full three-part name, e.g. Assad Hadi Ghazwani"
                    aria-label="Research author name"
                    className="flex-1 min-w-0 px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-hidden focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={handleSearchAgain}
                    disabled={externalLoading || externalRefreshing || researchSearchName.trim().split(/\s+/).length < 2}
                    className="shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${externalRefreshing ? 'animate-spin' : ''}`} />
                    {externalRefreshing ? 'Searching...' : 'Search papers & abstracts'}
                  </button>
                </div>
              </div>
              {onEditProfile && userProfile.name.trim().split(/\s+/).filter(Boolean).length < 3 && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Your profile has only {userProfile.name.trim().split(/\s+/).filter(Boolean).length || 0} name
                  {userProfile.name.trim().split(/\s+/).filter(Boolean).length === 1 ? '' : 's'} on file. Adding your
                  middle name (or initial) in{' '}
                  <button
                    type="button"
                    onClick={() => setIsEditProfileOpen(true)}
                    className="font-bold underline hover:text-amber-900 cursor-pointer"
                  >
                    Edit Profile
                  </button>{' '}
                  helps match the right papers when your first and last name are common.
                </p>
              )}
              {externalLoading ? (
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Searching CrossRef, Semantic Scholar, DBLP, and the live web...
                </div>
              ) : (
                <>
                  {externalCandidates.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[11px] text-slate-400">
                        Found by searching the full name above across CrossRef, Semantic Scholar, DBLP, and live
                        web results for papers, abstracts, publications, and proceedings. Names aren't unique —
                        confirm only records that are actually yours.
                      </p>
                      {externalCandidates.map((paper) => (
                        <div
                          key={paper.doi}
                          className="p-4 bg-amber-50 rounded-2xl border border-amber-200 flex items-start justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <h4 className="font-bold text-xs text-slate-900">{paper.title}</h4>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              {[paper.recordType, paper.source, paper.venue, paper.year].filter(Boolean).join(' • ')}
                            </p>
                            {paper.url && (
                              <a
                                href={paper.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(event) => event.stopPropagation()}
                                className="inline-flex items-center gap-1 text-[10px] text-indigo-700 mt-1 font-semibold hover:underline"
                              >
                                <ExternalLink className="w-3 h-3" />
                                View record
                              </a>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => handleDecideExternalPaper(paper, 'dismissed')}
                              disabled={decidingDoi === paper.doi}
                              className="px-2.5 py-1.5 text-[11px] font-bold text-slate-500 hover:bg-slate-100 rounded-lg cursor-pointer disabled:opacity-50"
                            >
                              Not me
                            </button>
                            <button
                              onClick={() => handleDecideExternalPaper(paper, 'confirmed')}
                              disabled={decidingDoi === paper.doi}
                              className="px-2.5 py-1.5 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer disabled:opacity-50"
                            >
                              Yes, that's me
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {externalCandidates.length === 0 && (
                    <p className="text-xs text-slate-400">No new unconfirmed papers or abstracts were found for this name.</p>
                  )}
                </>
              )}
            </div>

            <div className="space-y-4 pt-4 border-t border-slate-100">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-blue-600" />
                Published Research
              </h3>
              {userProfile.publications.length > 0 || externalConfirmed.length > 0 ? (
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
                  {externalConfirmed.map((paper) => (
                    <div
                      key={paper.doi}
                      className="p-4 bg-emerald-50 rounded-2xl border border-emerald-200 flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <h4 className="font-bold text-xs text-slate-900">{paper.title}</h4>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {[paper.recordType, paper.source, paper.venue, paper.year].filter(Boolean).join(' • ')}
                        </p>
                        {paper.url && (
                          <a
                            href={paper.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] text-indigo-700 mt-1 font-semibold hover:underline"
                          >
                            <ExternalLink className="w-3 h-3" />
                            View record
                          </a>
                        )}
                      </div>
                      <button
                        onClick={() => handleDecideExternalPaper(paper, 'dismissed')}
                        disabled={decidingDoi === paper.doi}
                        className="px-2.5 py-1.5 text-[11px] font-bold text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer disabled:opacity-50 shrink-0"
                      >
                        Remove confirmation
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">No confirmed published research yet.</p>
              )}
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
                  {/* No per-reviewer capacity is configured anywhere in the app, so showing a
                      "/maxLoad" ceiling would be inventing a number with nothing real behind it —
                      just the real, live count of assignments still awaiting a submitted review. */}
                  {userProfile.reviewerInfo.currentLoad}
                </div>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                <div className="text-[10px] font-bold text-slate-400 uppercase">Conferences Reviewed For</div>
                <div className="text-lg font-extrabold text-indigo-700">{userProfile.contributions.conferencesReviewedFor}</div>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Reviewer Badges Earned</h4>
              {userProfile.reviewerInfo.badges.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {userProfile.reviewerInfo.badges.map((b, idx) => (
                    <span key={idx} className="px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-full text-[11px] font-bold flex items-center gap-1.5">
                      <Award className="w-3.5 h-3.5" />
                      {b}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">No reviewer badges earned yet — volunteer to review abstracts to start earning them.</p>
              )}
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
              {userProfile.reviewerInfo.expertiseKeywords.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {userProfile.reviewerInfo.expertiseKeywords.map((k, idx) => (
                    <span key={idx} className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-full text-[11px] font-semibold">
                      {k}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">No review expertise keywords set yet.</p>
              )}
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

            <div className="space-y-4 pt-4 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-slate-900">Self-Reported Committee Positions</h4>
                <button
                  onClick={() => setIsAddCommitteeOpen(true)}
                  className="px-3 py-1.5 text-[11px] font-bold text-blue-700 hover:bg-blue-50 rounded-lg cursor-pointer flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add a Committee Position
                </button>
              </div>
              <p className="text-[11px] text-slate-400">
                Committee or chair service has no public database to pull from either, so this is
                self-reported by you — not verified by Conference Gate.
              </p>
              {committeeLoading ? (
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Loading...
                </div>
              ) : selfReportedCommittee.length > 0 ? (
                <div className="space-y-3">
                  {selfReportedCommittee.map((entry) => (
                    <div
                      key={entry.id}
                      className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-start justify-between gap-3"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        {entry.proofImage && (
                          <img
                            src={entry.proofImage}
                            alt=""
                            className="w-12 h-12 rounded-lg object-cover ring-1 ring-slate-300 shrink-0"
                          />
                        )}
                        <div className="min-w-0">
                          <h4 className="font-bold text-xs text-slate-900">{entry.conferenceName}</h4>
                          <p className="text-[11px] text-slate-500">
                            {[entry.position, entry.year].filter(Boolean).join(' • ')}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="px-2.5 py-0.5 bg-amber-100 text-amber-800 font-bold text-[10px] rounded-full whitespace-nowrap">
                          Self-Reported
                        </span>
                        <button
                          onClick={() => handleRemoveCommitteePosition(entry.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"
                          title="Remove"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">No self-reported committee positions yet.</p>
              )}
            </div>
          </div>
        )}

        {activeTab === 'badges' && (
          <div className="space-y-6">
            <h3 className="text-base font-bold text-slate-900">Verified Conference Identity Badges</h3>
            {userProfile.verifiedAchievements.length > 0 ? (
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
            ) : (
              <p className="text-xs text-slate-400">
                No verified badges yet. Badges are earned automatically for verified conference activity like keynotes,
                reviews, and committee roles.
              </p>
            )}
          </div>
        )}

        {activeTab === 'analytics' && <ProfileAnalytics userProfile={userProfile} currentUserId={currentUserId} posts={posts} />}
      </div>

      <ConferenceFeedbackModal
        isOpen={feedbackConference !== null}
        onClose={() => setFeedbackConference(null)}
        conferenceId={feedbackConference?.id}
        conferenceTitle={feedbackConference?.title || ''}
        organizerName={feedbackConference?.organizerName || ''}
        eventDate={feedbackConference?.eventDate || ''}
        participantName={userProfile.name}
        participantCompany={userProfile.organization}
        defaultRole={feedbackConference?.defaultRole}
      />

      {onEditProfile && (
        <EditProfileModal
          isOpen={isEditProfileOpen}
          onClose={() => setIsEditProfileOpen(false)}
          initialValues={{
            name: userProfile.name,
            title: userProfile.title,
            organization: userProfile.organization,
            department: userProfile.department,
            city: userProfile.city,
            country: userProfile.country,
            bio: userProfile.bio,
            linkedinUrl: userProfile.linkedinUrl,
          }}
          onSave={onEditProfile}
        />
      )}

      <AddAttendanceModal
        isOpen={isAddAttendanceOpen}
        onClose={() => setIsAddAttendanceOpen(false)}
        onAdd={handleAddSelfReportedAttendance}
        conferences={conferences}
        registeredConferenceIds={registrations.map((r) => r.conferenceId)}
      />

      <AddCommitteePositionModal
        isOpen={isAddCommitteeOpen}
        onClose={() => setIsAddCommitteeOpen(false)}
        onAdd={handleAddCommitteePosition}
      />
    </div>
  );
};
