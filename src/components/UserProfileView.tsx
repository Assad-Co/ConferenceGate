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
import { AbstractSubmission, Conference, ConferenceRole, NotificationItem, Post, UserProfile, ProfessionalInvitation } from '../types';
import { ConferenceFeedbackModal } from './ConferenceFeedbackModal';
import { ConferenceLink } from './ConferenceLink';
import { ProfileAnalytics } from './ProfileAnalytics';
import { ProfileNotifications } from './ProfileNotifications';
import { EditProfileModal } from './EditProfileModal';
import { ProfessionalPreferencesModal } from './ProfessionalPreferencesModal';
import { LinkedInProfilePanel } from './LinkedInProfilePanel';
import type { ProfessionalPreferencesPayload } from '../api/auth';
import { AddAttendanceModal } from './AddAttendanceModal';
import { AddCommitteePositionModal } from './AddCommitteePositionModal';
import { resizeImageFile } from '../utils/image';
import { generateInitialsAvatar } from '../utils/avatar';
import type { KeynoteSpeakerMatch } from '../api/auth';
import {
  fetchLinkedInProfileEnrichment,
  fetchProfessionalRecoveryStatus,
  recoverLocalProfessionalProfile,
  type ProfessionalRecoveryStatus,
} from '../api/linkedinProfile';
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

type ProfileTab = 'conferences' | 'papers' | 'linkedin' | 'reviews' | 'committee' | 'badges' | 'trust' | 'analytics' | 'notifications';

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
  onEditProfessionalPreferences?: (payload: ProfessionalPreferencesPayload) => Promise<void>;
  currentUserEmail?: string;
  identityVerified?: boolean;
  identityVerificationMethod?: 'LinkedIn' | 'Google' | null;
  professionalInvitations?: ProfessionalInvitation[];
  keynoteSpeakerMatches?: KeynoteSpeakerMatch[];
  ownerPreview?: boolean;
  primaryAccountRole?: 'professional' | 'organizer' | 'sponsor';
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

const paperIdentityKey = (title: string): string =>
  title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();

const isRealExternalPublication = (paper: ExternalPaper): boolean => {
  const title = paper.title.trim();
  if (!title) return false;
  if (/\b(?:research\s+profile|author\s+profile|researchgate\s+profile|google\s+scholar\s+profile|profile\s+page)\b/i.test(title)) return false;
  if (paper.url && /researchgate\.net\/profile\//i.test(paper.url)) return false;
  return true;
};

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
  onEditProfessionalPreferences,
  currentUserEmail,
  identityVerified = false,
  identityVerificationMethod = null,
  professionalInvitations = [],
  keynoteSpeakerMatches = [],
  ownerPreview = false,
  primaryAccountRole = 'professional',
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
  const [isProfessionalPreferencesOpen, setIsProfessionalPreferencesOpen] = useState(false);
  const unreadNotifCount = notifications.filter((n) => !n.read).length;
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [professionalRecoveryStatus, setProfessionalRecoveryStatus] = useState<ProfessionalRecoveryStatus | null>(null);
  const [professionalRecoveryStatusLoaded, setProfessionalRecoveryStatusLoaded] = useState(false);
  const [professionalRecoveryLoading, setProfessionalRecoveryLoading] = useState(false);
  const [professionalRecoveryError, setProfessionalRecoveryError] = useState<string | null>(null);

  const ownerProfessionalContext = variant === 'professional' && ownerPreview;

  useEffect(() => {
    if (!ownerProfessionalContext) {
      setProfessionalRecoveryStatus(null);
      setProfessionalRecoveryStatusLoaded(false);
      return;
    }
    let cancelled = false;
    setProfessionalRecoveryStatusLoaded(false);
    setProfessionalRecoveryError(null);
    fetchProfessionalRecoveryStatus()
      .then((status) => {
        if (!cancelled) setProfessionalRecoveryStatus(status);
      })
      .catch((error) => {
        if (!cancelled) {
          setProfessionalRecoveryStatus(null);
          setProfessionalRecoveryError(error?.message || 'Could not check the original Professional account.');
        }
      })
      .finally(() => {
        if (!cancelled) setProfessionalRecoveryStatusLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ownerProfessionalContext]);

  const professionalRecoveryRequired =
    ownerProfessionalContext &&
    professionalRecoveryStatusLoaded &&
    Boolean(
      professionalRecoveryStatus?.localLegacy.recoverable ||
      primaryAccountRole !== 'professional' ||
      (
        professionalRecoveryStatus &&
        (
          !professionalRecoveryStatus.current.profilePresent ||
          (
            professionalRecoveryStatus.current.counts.experience === 0 &&
            professionalRecoveryStatus.current.counts.education === 0 &&
            professionalRecoveryStatus.current.counts.publications === 0 &&
            professionalRecoveryStatus.current.counts.patents === 0
          )
        )
      )
    );

  const handleRestoreOriginalProfessional = async () => {
    if (!professionalRecoveryStatus?.localLegacy.recoverable) return;
    const restoreCredentials = professionalRecoveryStatus.localLegacy.candidate?.originalCredentialsRecoverable
      ? window.confirm(
          'ConferenceGate found your original Professional account. Restore its original sign-in password too? ' +
          'Organizer/Sponsor owner access, billing, and workspaces will remain available.'
        )
      : false;

    setProfessionalRecoveryLoading(true);
    setProfessionalRecoveryError(null);
    try {
      await recoverLocalProfessionalProfile(restoreCredentials);
      window.location.reload();
    } catch (error: any) {
      setProfessionalRecoveryError(error?.message || 'Could not restore the original Professional account.');
    } finally {
      setProfessionalRecoveryLoading(false);
    }
  };

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
  const [linkedInPaperTitles, setLinkedInPaperTitles] = useState<string[]>([]);
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

  const uniqueExternalConfirmed = useMemo(
    () => Array.from(
      new Map(
        externalConfirmed
          .filter(isRealExternalPublication)
          .map((paper) => [paperIdentityKey(paper.title), paper] as const)
          .filter(([key]) => Boolean(key)),
      ).values(),
    ),
    [externalConfirmed],
  );

  const paperPublicationCount = useMemo(() => {
    const titles = [
      ...userProfile.publications.map((pub) => pub.title),
      ...uniqueExternalConfirmed.map((paper) => paper.title),
      ...linkedInPaperTitles,
    ];
    return new Set(
      titles
        .map((title) => paperIdentityKey(String(title || '')))
        .filter(Boolean),
    ).size;
  }, [userProfile.publications, uniqueExternalConfirmed, linkedInPaperTitles]);

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

  const completedProfessionalRoles = professionalInvitations.filter((item) => item.status === 'completed');
  const committeeEntries = [
    ...completedProfessionalRoles
      .filter((item) => item.roleType === 'committee' || item.roleType === 'chair')
      .map((item) => ({
        title: item.title,
        conferenceName: item.conferenceTitle,
        year: Number((item.completedAt || item.respondedAt || item.createdAt || '').slice(0, 4)) || new Date().getFullYear(),
        roleLabel: item.roleType === 'chair' ? 'Session Chair' : 'Technical Committee Member',
      })),
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

  const profileCompletenessChecks = [
    Boolean(userProfile.name?.trim()),
    Boolean(userProfile.title?.trim()),
    Boolean(userProfile.organization?.trim()),
    Boolean(userProfile.bio?.trim() && userProfile.bio.trim().length >= 40),
    Boolean(userProfile.city?.trim() || userProfile.country?.trim()),
    Boolean(hasCustomAvatar),
    (userProfile.expertise || []).length > 0,
    (userProfile.technicalSpecialization || []).length > 0,
    (userProfile.researchInterests || []).length > 0,
    (userProfile.preferredRegions || []).length > 0,
    Boolean(
      userProfile.reviewerInfo.available ||
      userProfile.committeeAvailable ||
      userProfile.sessionChairAvailable ||
      userProfile.speakerAvailable
    ),
  ];
  const profileCompleteness = Math.round(
    (profileCompletenessChecks.filter(Boolean).length / profileCompletenessChecks.length) * 100
  );
  const verifiedReviewCount = submissions.reduce(
    (count, submission) => count + submission.reviews.filter((review) => review.reviewerId === currentUserId).length,
    0
  );
  const verifiedRoleCount = completedProfessionalRoles.length;

  const conferenceGateIndex = Math.min(
    1000,
    userProfile.contributions.reviewerKudos +
      userProfile.contributions.abstractsAccepted * 15 +
      userProfile.contributions.technicalCommittees * 25 +
      userProfile.contributions.sessionsChaired * 20 +
      userProfile.contributions.speakerRoles * 20
  );

  if (ownerProfessionalContext && !professionalRecoveryStatusLoaded && !professionalRecoveryError) {
    return (
      <div className="space-y-8">
        <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-8 flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-blue-700" />
          <div>
            <div className="text-sm font-extrabold text-slate-900">Loading your original Professional profile…</div>
            <p className="text-xs text-slate-500 mt-1">ConferenceGate is checking the stored Professional identity before showing profile metrics.</p>
          </div>
        </div>
      </div>
    );
  }

  if (professionalRecoveryRequired) {
    return (
      <div className="space-y-8">
        <div className="bg-white rounded-3xl border border-amber-200 shadow-xs overflow-hidden">
          <div className="h-28 bg-gradient-to-r from-amber-50 to-blue-50" />
          <div className="px-6 sm:px-8 py-7">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-100 flex items-center justify-center shrink-0">
                <RefreshCw className="w-6 h-6 text-amber-700" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] uppercase tracking-wider font-extrabold text-amber-700">
                  Original Professional Account
                </div>
                <h1 className="text-2xl font-extrabold text-slate-900 mt-1">
                  Restore your original Professional profile
                </h1>
                <p className="text-sm text-slate-600 mt-2 max-w-3xl">
                  ConferenceGate is not using the replacement Organizer profile as your Professional identity.
                  Your Professional photo, LinkedIn extraction, papers, conference history, committee roles,
                  expertise and reviewer data will appear only after the original Professional record is restored.
                </p>

                {!professionalRecoveryStatus && !professionalRecoveryError && (
                  <div className="mt-5 flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Checking for your original Professional profile…
                  </div>
                )}

                {professionalRecoveryStatus?.localLegacy.recoverable && (
                  <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                    <div className="text-sm font-extrabold text-emerald-900">
                      Original Professional profile found
                    </div>
                    <div className="text-xs text-emerald-800 mt-1">
                      {professionalRecoveryStatus.localLegacy.candidate?.fullName || userProfile.name} ·{' '}
                      {professionalRecoveryStatus.localLegacy.candidate?.counts.publications || 0} publications ·{' '}
                      {professionalRecoveryStatus.localLegacy.candidate?.counts.patents || 0} patents
                      {professionalRecoveryStatus.localLegacy.candidate?.originalCredentialsRecoverable
                        ? ' · original password available'
                        : ''}
                    </div>
                    <button
                      type="button"
                      onClick={handleRestoreOriginalProfessional}
                      disabled={professionalRecoveryLoading}
                      className="mt-4 px-5 py-3 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white text-sm font-bold disabled:opacity-50 cursor-pointer"
                    >
                      {professionalRecoveryLoading ? 'Restoring…' : 'Restore Original Professional Account'}
                    </button>
                  </div>
                )}

                {professionalRecoveryStatus && !professionalRecoveryStatus.localLegacy.recoverable && (
                  <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <div className="text-sm font-extrabold text-amber-950">
                      Original profile is not in the active SQLite database yet
                    </div>
                    <p className="text-xs text-amber-800 mt-1">
                      {professionalRecoveryStatus.tursoRecoveryConfigured
                        ? 'The legacy Turso recovery source is configured. The original Professional record must be recovered from that source.'
                        : 'The old Turso source is not connected to this deployment, so ConferenceGate cannot honestly recreate the missing history from the replacement account.'}
                    </p>
                    {professionalRecoveryStatus.linkedInRefreshConfigured && (
                      <p className="text-xs text-amber-800 mt-2">
                        LinkedIn refresh is available as a separate fallback for public profile data, but it will not be presented as a substitute for your original ConferenceGate history.
                      </p>
                    )}
                  </div>
                )}

                {professionalRecoveryError && (
                  <p className="mt-4 text-sm font-semibold text-rose-700">{professionalRecoveryError}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
                <span className={`w-7 h-7 rounded-full ring-[3px] ring-white shadow-md flex items-center justify-center cursor-default ${
                  identityVerified ? 'bg-blue-600' : 'bg-slate-400'
                }`}>
                  <ShieldCheck className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
                </span>
                <span className="pointer-events-none absolute bottom-full right-0 mb-2 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-[10px] font-semibold text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/badge:opacity-100">
                  {identityVerified
                    ? `Identity connected via ${identityVerificationMethod || 'trusted provider'}`
                    : 'ConferenceGate account — identity provider not connected'}
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
            {variant === 'professional' && onEditProfessionalPreferences && (
              <button
                onClick={() => setIsProfessionalPreferencesOpen(true)}
                className="px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-xl shadow-xs border border-slate-200 transition-colors cursor-pointer flex items-center gap-2"
              >
                <Users className="w-4 h-4" />
                <span>Availability & Expertise</span>
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
            <div className="text-[10px] font-bold text-slate-400 uppercase">Papers & Publications</div>
            <div className="text-xl font-extrabold text-slate-900">
              {paperPublicationCount} {paperPublicationCount === 1 ? 'Paper' : 'Papers'}
            </div>
          </div>

          <div className="p-3 bg-white rounded-xl border border-slate-200 text-center">
            <div className="text-[10px] font-bold text-slate-400 uppercase">Committee Roles</div>
            <div className="text-xl font-extrabold text-indigo-700">{userProfile.contributions.technicalCommittees} Positions</div>
          </div>
        </div>
        )}

        {variant === 'professional' && (
          <div className="px-6 sm:px-8 py-5 border-t border-slate-200 bg-white">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">Professional Opportunity Profile</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Your expertise and availability for reviewer, committee, chair, and speaker matching.
                </p>
                <div className="mt-3 max-w-sm">
                  <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 mb-1">
                    <span>Profile completeness</span>
                    <span>{profileCompleteness}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: `${profileCompleteness}%` }} />
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-[10px] font-bold">
                <span className={`px-2.5 py-1 rounded-full ${userProfile.reviewerInfo.available ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>
                  Reviewer {userProfile.reviewerInfo.available ? 'Available' : 'Off'}
                </span>
                <span className={`px-2.5 py-1 rounded-full ${userProfile.committeeAvailable ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>
                  Committee {userProfile.committeeAvailable ? 'Available' : 'Off'}
                </span>
                <span className={`px-2.5 py-1 rounded-full ${userProfile.sessionChairAvailable ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>
                  Session Chair {userProfile.sessionChairAvailable ? 'Available' : 'Off'}
                </span>
                <span className={`px-2.5 py-1 rounded-full ${userProfile.speakerAvailable ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>
                  Speaker {userProfile.speakerAvailable ? 'Available' : 'Off'}
                </span>
              </div>
            </div>
            {(userProfile.expertise.length > 0 || userProfile.technicalSpecialization.length > 0 || (userProfile.preferredRegions?.length || 0) > 0) && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {[...userProfile.expertise, ...userProfile.technicalSpecialization, ...(userProfile.preferredRegions || [])]
                  .slice(0, 12)
                  .map((item, index) => (
                    <span key={`${item}-${index}`} className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-[10px] font-semibold">
                      {item}
                    </span>
                  ))}
              </div>
            )}
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
                { id: 'trust', label: 'Trust & Verification' },
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
              {userProfile.publications.length > 0 || uniqueExternalConfirmed.length > 0 ? (
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
                  {uniqueExternalConfirmed.map((paper) => (
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

        {activeTab === 'trust' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-base font-bold text-slate-900">Trust & Verification</h3>
              <p className="text-[11px] text-slate-500 mt-1">
                ConferenceGate separates platform-verified activity, official-source evidence, and self-reported history.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50">
                <div className="text-[10px] font-bold uppercase text-slate-400">Identity</div>
                <div className={`text-sm font-extrabold mt-1 ${identityVerified ? 'text-emerald-700' : 'text-slate-700'}`}>
                  {identityVerified ? 'Connected' : 'Not connected'}
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  {identityVerified ? identityVerificationMethod : 'Connect LinkedIn or Google'}
                </div>
              </div>
              <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50">
                <div className="text-[10px] font-bold uppercase text-slate-400">Platform Reviews</div>
                <div className="text-sm font-extrabold text-blue-700 mt-1">{verifiedReviewCount} verified</div>
                <div className="text-[10px] text-slate-500 mt-1">Completed inside ConferenceGate</div>
              </div>
              <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50">
                <div className="text-[10px] font-bold uppercase text-slate-400">Completed Roles</div>
                <div className="text-sm font-extrabold text-indigo-700 mt-1">{verifiedRoleCount} verified</div>
                <div className="text-[10px] text-slate-500 mt-1">Confirmed completed by organizer</div>
              </div>
              <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50">
                <div className="text-[10px] font-bold uppercase text-slate-400">Official Speaker Evidence</div>
                <div className="text-sm font-extrabold text-violet-700 mt-1">{keynoteSpeakerMatches.length} matched</div>
                <div className="text-[10px] text-slate-500 mt-1">Named on official conference sources</div>
              </div>
            </div>

            <div className="p-5 rounded-2xl border border-amber-200 bg-amber-50">
              <h4 className="text-xs font-bold text-amber-900">Self-reported records stay clearly labeled</h4>
              <p className="text-[11px] text-amber-800 mt-1">
                Committee positions or attendance added manually are useful career history, but they are not counted as
                platform-verified activity unless ConferenceGate receives organizer confirmation or other supported evidence.
              </p>
            </div>

            <div className="p-5 rounded-2xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h4 className="text-xs font-bold text-slate-900">Professional profile completeness</h4>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Higher completeness improves matching quality; it does not guarantee invitations.
                  </p>
                </div>
                <span className="text-xl font-extrabold text-blue-700">{profileCompleteness}%</span>
              </div>
              <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden mt-4">
                <div className="h-full bg-blue-600 rounded-full" style={{ width: `${profileCompleteness}%` }} />
              </div>
            </div>
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
      {variant === 'professional' && onEditProfessionalPreferences && (
        <ProfessionalPreferencesModal
          isOpen={isProfessionalPreferencesOpen}
          onClose={() => setIsProfessionalPreferencesOpen(false)}
          initial={{
            professionalExpertise: userProfile.expertise || [],
            technicalSpecialization: userProfile.technicalSpecialization || [],
            researchInterests: userProfile.researchInterests || [],
            preferredRegions: userProfile.preferredRegions || [],
            committeeAvailable: Boolean(userProfile.committeeAvailable),
            sessionChairAvailable: Boolean(userProfile.sessionChairAvailable),
            speakerAvailable: Boolean(userProfile.speakerAvailable),
            reviewerMaxLoad: userProfile.reviewerInfo.maxLoad || 5,
          }}
          onSave={onEditProfessionalPreferences}
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
