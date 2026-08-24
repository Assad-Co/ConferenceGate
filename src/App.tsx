import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { useToast } from './components/Toast';
import { Navbar } from './components/Navbar';
import { AuthScreen } from './components/auth/AuthScreen';
import { AuthUser, fetchCurrentUser, logout as apiLogout, updateAvatar, updateProfile, updateReviewerAvailability } from './api/auth';
import { resolveAvatar } from './utils/avatar';
import { isSponsorVerified } from './utils/sponsorVerification';
import { Footer } from './components/Footer';
import { HomeLanding } from './components/HomeLanding';
import { DiscoveryEngine } from './components/DiscoveryEngine';
import { ConferenceDetail } from './components/ConferenceDetail';
import { ExternalConferenceDetail } from './components/ExternalConferenceDetail';
import { AbstractSubmissionModal } from './components/AbstractSubmissionModal';
import { AbstractTrackerView } from './components/AbstractTrackerView';
import { ReviewerPortal } from './components/ReviewerPortal';
import { OrganizerDashboard } from './components/OrganizerDashboard';
import { SponsorPortal } from './components/SponsorPortal';
import { UserProfileView } from './components/UserProfileView';
import { CommunityFeed } from './components/CommunityFeed';
import { ReactionType } from './components/reactionMeta';
import { AIAssistantModal } from './components/AIAssistantModal';
import { DigitalBadgeModal } from './components/DigitalBadgeModal';
import { EditProfileModal } from './components/EditProfileModal';
import { CertificatesView } from './components/CertificatesView';
import { PersonProfileModal } from './components/PersonProfileModal';
import { MessagesPanel } from './components/MessagesPanel';
import {
  fetchSubmissions,
  createSubmission,
  submitReview,
  volunteerForReview,
  fetchMyVolunteeredOpportunityIds,
  registerForConference,
  fetchMyRegistrations,
  ConferenceRegistration,
  fetchMyConferenceInteractions,
  toggleConferenceInteraction,
  recordConferenceAction,
  fetchRegistrationCountsByConference,
  fetchFeedbackSummary,
  createConferenceRemote,
  fetchCreatedConferences,
  fetchMyCreatedConferences,
  fetchOrganizerActivityFeed,
  OrganizerActivityItem,
} from './api/activity';
import {
  fetchConversations,
  fetchConversation,
  sendMessage as sendMessageApi,
  markConversationRead,
  connectMessageSocket,
  ConversationSummary,
  MessageItem,
  MessageSocketEvent,
  PublicUser,
} from './api/messages';
import {
  fetchSponsorshipPackages,
  createSponsorshipPackage,
  applyForSponsorship,
  fetchMySponsorApplications,
  fetchApplicantsForMyPackages,
  decideSponsorApplication,
  fetchReviewableSponsors,
  submitSponsorReview,
  fetchMySponsorProfile,
  SponsorApplicationSummary,
  SponsorApplicant,
  ReviewableSponsor,
} from './api/sponsors';
import {
  fetchFeed,
  createPost as createPostApi,
  reactToPost,
  fetchComments as fetchCommentsApi,
  addComment as addCommentApi,
  toggleRepost as toggleRepostApi,
  toggleSave as toggleSaveApi,
} from './api/posts';
import { LiveSearchResult } from './api/search';

import {
  sampleConferences,
  currentUserProfile,
  sampleReviewOpportunities,
  sampleSponsorshipOpportunities,
  sampleNotifications,
} from './data/mockData';
import {
  Conference,
  AbstractSubmission,
  CelebrationKind,
  NotificationItem,
  Post,
  SponsorProfile,
  SponsorshipPackage,
  UserRole,
  UserProfile,
  PostAuthor,
} from './types';

const AUTH_ROLE_TO_USER_ROLE: Record<AuthUser['role'], UserRole> = {
  professional: 'Professional',
  organizer: 'Organizer',
  sponsor: 'Sponsor',
};

// A brand-new account has no real conference activity yet — these reset a freshly
// authenticated profile away from the seeded demo persona's career history rather
// than silently displaying a stranger's papers, kudos, and committee roles as fact.
const EMPTY_ACCOUNT_ACHIEVEMENTS = {
  education: [] as string[],
  certifications: [] as string[],
  expertise: [] as string[],
  technicalSpecialization: [] as string[],
  researchInterests: [] as string[],
  keywords: [] as string[],
  publications: [] as UserProfile['publications'],
  societies: [] as string[],
  languages: [] as string[],
  contributions: {
    conferencesAttended: 0,
    abstractsSubmitted: 0,
    abstractsAccepted: 0,
    oralPresentations: 0,
    posterPresentations: 0,
    speakerRoles: 0,
    keynoteRoles: 0,
    workshopsDelivered: 0,
    panelsParticipated: 0,
    sessionsChaired: 0,
    technicalCommittees: 0,
    abstractsReviewed: 0,
    conferencesReviewedFor: 0,
    reviewerKudos: 0,
    awards: 0,
    certificatesCount: 0,
  },
  verifiedAchievements: [] as UserProfile['verifiedAchievements'],
  timeline: [] as UserProfile['timeline'],
  reviewerInfo: {
    available: false,
    expertiseKeywords: [] as string[],
    maxLoad: 0,
    currentLoad: 0,
    totalReviewed: 0,
    kudos: 0,
    badges: [] as string[],
    outstandingAwards: [] as string[],
  },
};

export function App() {
  const { showToast } = useToast();
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [organizerNameOverride, setOrganizerNameOverride] = useState<string | null>(null);
  const [sponsorNameOverride, setSponsorNameOverride] = useState<string | null>(null);
  const [activeRole, setActiveRole] = useState<UserRole>('Professional');
  const [activeTab, setActiveTab] = useState<string>('home');
  const [selectedConference, setSelectedConference] = useState<Conference | null>(null);
  const [selectedExternalResult, setSelectedExternalResult] = useState<LiveSearchResult | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [profileInitialTab, setProfileInitialTab] = useState<'conferences' | 'notifications'>('conferences');
  const [notifications, setNotifications] = useState<NotificationItem[]>(sampleNotifications);
  const [organizerActivityFeed, setOrganizerActivityFeed] = useState<OrganizerActivityItem[]>([]);
  const [readOrganizerNotificationIds, setReadOrganizerNotificationIds] = useState<Set<string>>(new Set());
  const [readSponsorNotificationIds, setReadSponsorNotificationIds] = useState<Set<string>>(new Set());

  const [organizerLogoOverride, setOrganizerLogoOverride] = useState<string | null>(null);
  const [sponsorLogoOverride, setSponsorLogoOverride] = useState<string | null>(null);

  const [sponsorAlerts, setSponsorAlerts] = useState<
    Array<{ id: string; title: string; message: string; date: string; read: boolean }>
  >([
    {
      id: 'salert_default_1',
      title: 'New Sponsorship Opportunity: Conference Title Sponsorship',
      message: 'Gold Sponsor package now available for $25,000. Apply in the Sponsor Marketplace before slots fill up.',
      date: '8/10/2026, 9:00:00 AM',
      read: false,
    },
  ]);
  const handleNotifySponsors = (title: string, message: string) =>
    setSponsorAlerts((prev) => [
      { id: `salert_${Date.now()}`, title, message, date: new Date().toLocaleString(), read: false },
      ...prev,
    ]);
  const handleMarkSponsorAlertRead = (id: string) =>
    setSponsorAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, read: true } : a)));
  const handleMarkAllSponsorAlertsRead = () =>
    setSponsorAlerts((prev) => prev.map((a) => ({ ...a, read: true })));

  // Real sponsorship marketplace state — packages an organizer actually published, sponsors'
  // real applications to them, and derived-from-real-activity sponsor profile stats. See
  // src/api/sponsors.ts and server/sponsors.ts.
  const [myConferences, setMyConferences] = useState<Conference[]>([]);
  const [sponsorshipPackagesReal, setSponsorshipPackagesReal] = useState<SponsorshipPackage[]>([]);
  const [myApplications, setMyApplications] = useState<SponsorApplicationSummary[]>([]);
  const [packageApplicants, setPackageApplicants] = useState<SponsorApplicant[]>([]);
  const [reviewableSponsorsReal, setReviewableSponsorsReal] = useState<ReviewableSponsor[]>([]);
  const [mySponsorProfileStats, setMySponsorProfileStats] = useState<{
    rating: number;
    reviewsCount: number;
    activeSponsorshipsCount: number;
    leadsCaptured: number;
    sponsorshipHistory: { year: number; conferenceTitle: string; tier: string }[];
    reviews: SponsorProfile['reviews'];
  }>({ rating: 0, reviewsCount: 0, activeSponsorshipsCount: 0, leadsCaptured: 0, sponsorshipHistory: [], reviews: [] });

  // Only this organizer's own published packages, not every organizer's.
  const organizerOwnPackages = sponsorshipPackagesReal.filter((p) =>
    myConferences.some((c) => c.id === p.conferenceId)
  );

  const sponsorProfileForPortal: SponsorProfile = {
    id: authUser?.id || '',
    companyName: sponsorNameOverride || authUser?.organization || authUser?.name || '',
    logo: sponsorLogoOverride || resolveAvatar(authUser?.avatar ?? null, authUser?.name || ''),
    description: authUser?.bio || '',
    industry: authUser?.title || '',
    ...mySponsorProfileStats,
    verificationStatus: isSponsorVerified(mySponsorProfileStats) ? 'Verified' : 'Restricted',
  };

  const refreshOrganizerSponsorData = () => {
    fetchApplicantsForMyPackages().then(setPackageApplicants).catch(() => {});
    fetchReviewableSponsors().then(setReviewableSponsorsReal).catch(() => {});
  };

  const handleActivateOpportunityPackage = async (opp: {
    key: string;
    name: string;
    tier: string;
    price: number;
    slots: number;
    benefits: string[];
  }) => {
    const targetConference = myConferences[0];
    if (!targetConference) {
      showToast({
        type: 'info',
        title: 'Create a conference first',
        message: 'Publish a conference from the Wizard tab before activating sponsorship packages.',
      });
      return;
    }
    try {
      const pkg = await createSponsorshipPackage({
        conferenceId: targetConference.id,
        tier: opp.tier,
        price: opp.price,
        benefits: opp.benefits,
        totalSlots: opp.slots,
        sourceOpportunityId: opp.key,
      });
      setSponsorshipPackagesReal((prev) => [pkg, ...prev]);
      showToast({
        type: 'success',
        title: 'Package activated',
        message: `${opp.tier} is now live in the Sponsor Marketplace for ${targetConference.title}.`,
      });
    } catch (e) {
      showToast({
        type: 'info',
        title: "Couldn't activate package",
        message: e instanceof Error ? e.message : 'Please try again.',
      });
    }
  };

  const handleApplyForSponsorship = async (packageId: string) => {
    try {
      const application = await applyForSponsorship(packageId);
      setMyApplications((prev) => [application, ...prev.filter((a) => a.packageId !== packageId)]);
      showToast({
        type: 'achievement',
        title: 'Sponsorship application submitted',
        message: `${application.tier} for ${application.conferenceTitle} — the organizer will review your application.`,
      });
    } catch (e) {
      showToast({
        type: 'info',
        title: "Couldn't submit application",
        message: e instanceof Error ? e.message : 'Please try again.',
      });
    }
  };

  const handleDecideApplication = async (applicationId: string, status: 'Approved' | 'Rejected') => {
    const applicant = packageApplicants.find((a) => a.applicationId === applicationId);
    try {
      await decideSponsorApplication(applicationId, status);
      refreshOrganizerSponsorData();
      if (status === 'Approved' && applicant) {
        postCelebration(
          'sponsorship-accepted',
          '🤝 Sponsorship Confirmed!',
          `${applicant.sponsor.companyName} is proud to confirm ${applicant.tier} Tier sponsorship for ${applicant.conferenceTitle}! We look forward to connecting with the community.`,
          {
            authorName: applicant.sponsor.companyName,
            authorTitle: 'Corporate Sponsor',
            authorOrg: applicant.conferenceTitle,
            authorAvatar: resolveAvatar(applicant.sponsor.logo, applicant.sponsor.companyName),
            conferenceBadge: applicant.conferenceTitle,
          }
        );
      }
      showToast({
        type: status === 'Approved' ? 'success' : 'info',
        title: status === 'Approved' ? 'Applicant approved' : 'Applicant rejected',
        message: `The sponsor has been ${status.toLowerCase()}.`,
      });
    } catch (e) {
      showToast({
        type: 'info',
        title: "Couldn't update application",
        message: e instanceof Error ? e.message : 'Please try again.',
      });
    }
  };

  const handleSubmitSponsorReview = async (
    sponsorId: string,
    review: { conferenceTitle: string; rating: number; comment: string }
  ) => {
    try {
      await submitSponsorReview({
        sponsorId,
        conferenceTitle: review.conferenceTitle,
        rating: review.rating,
        comment: review.comment,
      });
      refreshOrganizerSponsorData();
      showToast({
        type: 'success',
        title: 'Feedback sent to sponsor',
        message: 'Your review has been recorded and updates their marketplace rating.',
      });
    } catch (e) {
      showToast({
        type: 'info',
        title: "Couldn't send feedback",
        message: e instanceof Error ? e.message : 'Please try again.',
      });
    }
  };

  const handleMarkNotificationRead = (id: string) =>
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  const handleMarkAllNotificationsRead = () =>
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  const handleAddNotification = (notif: Omit<NotificationItem, 'id' | 'timestamp' | 'read'>) =>
    setNotifications((prev) => [
      { id: `notif_${Date.now()}`, timestamp: 'Just now', read: false, ...notif },
      ...prev,
    ]);

  // App Data State
  const [conferences, setConferences] = useState<Conference[]>(sampleConferences);
  const [submissions, setSubmissions] = useState<AbstractSubmission[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [userProfile, setUserProfile] = useState(currentUserProfile);

  // Real tracked activity — persisted server-side, loaded once authenticated.
  const [registrations, setRegistrations] = useState<ConferenceRegistration[]>([]);
  const [volunteeredOpportunityIds, setVolunteeredOpportunityIds] = useState<string[]>([]);
  const [savedConferenceIds, setSavedConferenceIds] = useState<string[]>([]);
  const [followedConferenceIds, setFollowedConferenceIds] = useState<string[]>([]);

  useEffect(() => {
    if (!authUser) return;
    fetchSubmissions().then(setSubmissions).catch(() => {});
    fetchFeed().then(setPosts).catch(() => {});
    fetchMyRegistrations().then(setRegistrations).catch(() => {});
    fetchMyVolunteeredOpportunityIds().then(setVolunteeredOpportunityIds).catch(() => {});
    fetchMyConferenceInteractions()
      .then(({ saved, followed }) => {
        setSavedConferenceIds(saved);
        setFollowedConferenceIds(followed);
      })
      .catch(() => {});
    fetchCreatedConferences()
      .then((created) => {
        if (created.length === 0) return;
        const createdIds = new Set(created.map((c) => c.id));
        setConferences([...created, ...sampleConferences.filter((c) => !createdIds.has(c.id))]);
      })
      .catch(() => {});
    if (authUser.role === 'organizer') {
      fetchOrganizerActivityFeed().then(setOrganizerActivityFeed).catch(() => {});
      fetchMyCreatedConferences().then(setMyConferences).catch(() => {});
      fetchApplicantsForMyPackages().then(setPackageApplicants).catch(() => {});
      fetchReviewableSponsors().then(setReviewableSponsorsReal).catch(() => {});
    }
    if (authUser.role === 'sponsor') {
      fetchMySponsorApplications().then(setMyApplications).catch(() => {});
      fetchMySponsorProfile().then(setMySponsorProfileStats).catch(() => {});
    }
    if (authUser.role === 'organizer' || authUser.role === 'sponsor') {
      fetchSponsorshipPackages().then(setSponsorshipPackagesReal).catch(() => {});
    }
  }, [authUser?.id, authUser?.role]);

  const handleToggleSaveConference = async (conferenceId: string) => {
    try {
      const active = await toggleConferenceInteraction(conferenceId, 'saved');
      setSavedConferenceIds((prev) => (active ? [...prev, conferenceId] : prev.filter((id) => id !== conferenceId)));
    } catch {
      // Non-critical — the UI simply won't reflect the toggle if the request failed.
    }
  };

  const handleToggleFollowConference = async (conferenceId: string) => {
    try {
      const active = await toggleConferenceInteraction(conferenceId, 'followed');
      setFollowedConferenceIds((prev) => (active ? [...prev, conferenceId] : prev.filter((id) => id !== conferenceId)));
    } catch {
      // Non-critical — the UI simply won't reflect the toggle if the request failed.
    }
  };

  // Submissions are shared across accounts (organizers/reviewers see everyone's), so
  // re-fetch on every visit to a submissions-driven tab rather than only once at login.
  useEffect(() => {
    if (!authUser) return;
    if (['abstracts', 'reviewer', 'organizer'].includes(activeTab)) {
      fetchSubmissions().then(setSubmissions).catch(() => {});
    }
    if (['home', 'community'].includes(activeTab)) {
      fetchFeed().then(setPosts).catch(() => {});
    }
  }, [activeTab, authUser?.id]);

  const [registrationCountsByConference, setRegistrationCountsByConference] = useState<Record<string, number>>({});
  const [feedbackSummary, setFeedbackSummary] = useState<{ averageScore: number; responseCount: number }>({
    averageScore: 0,
    responseCount: 0,
  });
  useEffect(() => {
    if (!authUser) return;
    if (activeTab === 'organizer') {
      fetchRegistrationCountsByConference().then(setRegistrationCountsByConference).catch(() => {});
      fetchFeedbackSummary().then(setFeedbackSummary).catch(() => {});
    }
  }, [activeTab, authUser?.id]);

  // A real account's stats are derived from its own persisted activity, never fabricated.
  const myContributions = React.useMemo(() => {
    const myId = authUser?.id;
    const mySubmissions = myId ? submissions.filter((s) => s.submitterId === myId) : [];
    const abstractsAccepted = mySubmissions.filter((s) =>
      ['Accepted', 'Accepted for Oral', 'Accepted for Poster'].includes(s.status)
    ).length;
    const oralPresentations = mySubmissions.filter((s) => s.status === 'Accepted for Oral').length;
    const posterPresentations = mySubmissions.filter((s) => s.status === 'Accepted for Poster').length;
    const myReviews = myId ? submissions.flatMap((s) => s.reviews).filter((r) => r.reviewerId === myId) : [];
    const conferencesReviewedFor = myId
      ? new Set(submissions.filter((s) => s.reviews.some((r) => r.reviewerId === myId)).map((s) => s.conferenceTitle)).size
      : 0;
    const certificatesCount = abstractsAccepted + conferencesReviewedFor + registrations.length;

    return {
      conferencesAttended: registrations.length,
      abstractsSubmitted: mySubmissions.length,
      abstractsAccepted,
      oralPresentations,
      posterPresentations,
      speakerRoles: 0,
      keynoteRoles: 0,
      workshopsDelivered: 0,
      panelsParticipated: 0,
      sessionsChaired: 0,
      technicalCommittees: 0,
      abstractsReviewed: myReviews.length,
      conferencesReviewedFor,
      reviewerKudos: myReviews.length * 20,
      awards: 0,
      certificatesCount,
    };
  }, [submissions, registrations, authUser?.id]);

  useEffect(() => {
    setUserProfile((prev) => ({
      ...prev,
      contributions: myContributions,
      reviewerInfo: {
        ...prev.reviewerInfo,
        totalReviewed: myContributions.abstractsReviewed,
        kudos: myContributions.reviewerKudos,
      },
    }));
  }, [myContributions]);

  // Direct messaging — persisted server-side with real-time delivery over WebSocket.
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activePartnerId, setActivePartnerId] = useState<string | null>(null);
  const [pendingPartner, setPendingPartner] = useState<PublicUser | null>(null);
  const [activeMessages, setActiveMessages] = useState<MessageItem[]>([]);
  const [isMessagesOpen, setIsMessagesOpen] = useState(false);
  const [viewedAuthor, setViewedAuthor] = useState<PostAuthor | null>(null);

  const totalUnreadMessages = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  // Real, organizer-specific notifications: unread messages plus sponsorship/committee
  // interest and new abstract submissions on conferences this organizer created — replacing
  // demo notification content for this role.
  const organizerNotifications: NotificationItem[] = React.useMemo(() => {
    const messageItems: Array<NotificationItem & { sortKey: string }> = conversations
      .filter((c) => c.unreadCount > 0)
      .map((c) => {
        const id = `msg_${c.partnerId}`;
        return {
          id,
          title: `New message from ${c.partner.name}`,
          message: c.lastMessage || 'Sent you a message',
          timestamp: new Date(c.lastMessageAt).toLocaleString(),
          sortKey: c.lastMessageAt,
          read: readOrganizerNotificationIds.has(id),
          type: 'followup' as const,
        };
      });

    const activityItems: Array<NotificationItem & { sortKey: string }> = organizerActivityFeed.map((item) => {
      const read = readOrganizerNotificationIds.has(item.id);
      const timestamp = new Date(item.createdAt).toLocaleString();
      const base = { id: item.id, timestamp, sortKey: item.createdAt, read };
      if (item.kind === 'sponsorship_inquiry') {
        return {
          ...base,
          title: 'Sponsorship inquiry',
          message: `${item.actorName} is interested in sponsoring ${item.conferenceTitle}`,
          type: 'sponsorship' as const,
        };
      }
      if (item.kind === 'committee_interest') {
        return {
          ...base,
          title: 'Technical committee interest',
          message: `${item.actorName} expressed interest in joining the committee for ${item.conferenceTitle}`,
          type: 'invitation' as const,
        };
      }
      return {
        ...base,
        title: 'New abstract submission',
        message: `${item.actorName} submitted "${item.abstractTitle}" to ${item.conferenceTitle}`,
        type: 'abstract' as const,
      };
    });

    return [...messageItems, ...activityItems]
      .sort((a, b) => (a.sortKey < b.sortKey ? 1 : -1))
      .map(({ sortKey, ...rest }) => rest);
  }, [conversations, organizerActivityFeed, readOrganizerNotificationIds]);

  const handleMarkOrganizerNotificationRead = (id: string) =>
    setReadOrganizerNotificationIds((prev) => new Set(prev).add(id));
  const handleMarkAllOrganizerNotificationsRead = () =>
    setReadOrganizerNotificationIds(new Set(organizerNotifications.map((n) => n.id)));

  // Real, sponsor-specific notifications: unread messages plus this sponsor's own real
  // application decisions and reviews received from organizers.
  const sponsorNotifications: NotificationItem[] = React.useMemo(() => {
    const messageItems: Array<NotificationItem & { sortKey: string }> = conversations
      .filter((c) => c.unreadCount > 0)
      .map((c) => {
        const id = `msg_${c.partnerId}`;
        return {
          id,
          title: `New message from ${c.partner.name}`,
          message: c.lastMessage || 'Sent you a message',
          timestamp: new Date(c.lastMessageAt).toLocaleString(),
          sortKey: c.lastMessageAt,
          read: readSponsorNotificationIds.has(id),
          type: 'followup' as const,
        };
      });

    const applicationItems: Array<NotificationItem & { sortKey: string }> = myApplications
      .filter((a) => a.status !== 'Pending')
      .map((a) => {
        const id = `sapp_${a.id}`;
        return {
          id,
          title: a.status === 'Approved' ? 'Sponsorship application approved' : 'Sponsorship application update',
          message:
            a.status === 'Approved'
              ? `Your ${a.tier} tier application for ${a.conferenceTitle} was approved.`
              : `Your ${a.tier} tier application for ${a.conferenceTitle} was not approved this time.`,
          timestamp: new Date(a.createdAt).toLocaleString(),
          sortKey: a.createdAt,
          read: readSponsorNotificationIds.has(id),
          type: 'sponsorship' as const,
        };
      });

    const reviewItems: Array<NotificationItem & { sortKey: string }> = mySponsorProfileStats.reviews.map((r) => {
      const id = `srev_${r.id}`;
      return {
        id,
        title: 'New organizer review',
        message: `${r.reviewerName} rated your sponsorship of ${r.conferenceTitle} ${r.rating}/5: "${r.comment}"`,
        timestamp: new Date(r.date).toLocaleString(),
        sortKey: r.date,
        read: readSponsorNotificationIds.has(id),
        type: 'review' as const,
      };
    });

    return [...messageItems, ...applicationItems, ...reviewItems]
      .sort((a, b) => (a.sortKey < b.sortKey ? 1 : -1))
      .map(({ sortKey, ...rest }) => rest);
  }, [conversations, myApplications, mySponsorProfileStats.reviews, readSponsorNotificationIds]);

  const handleMarkSponsorNotificationRead = (id: string) =>
    setReadSponsorNotificationIds((prev) => new Set(prev).add(id));
  const handleMarkAllSponsorNotificationsRead = () =>
    setReadSponsorNotificationIds(new Set(sponsorNotifications.map((n) => n.id)));

  // Real, role-specific notifications wherever they're displayed (Navbar bell + Profile page).
  const displayedNotifications =
    authUser?.role === 'organizer'
      ? organizerNotifications
      : authUser?.role === 'sponsor'
      ? sponsorNotifications
      : notifications;
  const displayedOnMarkNotificationRead =
    authUser?.role === 'organizer'
      ? handleMarkOrganizerNotificationRead
      : authUser?.role === 'sponsor'
      ? handleMarkSponsorNotificationRead
      : handleMarkNotificationRead;
  const displayedOnMarkAllNotificationsRead =
    authUser?.role === 'organizer'
      ? handleMarkAllOrganizerNotificationsRead
      : authUser?.role === 'sponsor'
      ? handleMarkAllSponsorNotificationsRead
      : handleMarkAllNotificationsRead;

  const refreshConversations = () => {
    fetchConversations().then(setConversations).catch(() => {});
  };

  // Refs so the long-lived WebSocket handler always sees the latest values without reconnecting.
  const activePartnerIdRef = React.useRef<string | null>(null);
  const isMessagesOpenRef = React.useRef(false);
  useEffect(() => {
    activePartnerIdRef.current = activePartnerId;
  }, [activePartnerId]);
  useEffect(() => {
    isMessagesOpenRef.current = isMessagesOpen;
  }, [isMessagesOpen]);

  useEffect(() => {
    if (!authUser) return;
    refreshConversations();

    const handleIncomingMessage = (evt: MessageSocketEvent) => {
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.partnerId === evt.partnerId);
        const isActive = evt.partnerId === activePartnerIdRef.current && isMessagesOpenRef.current;
        const updated: ConversationSummary = {
          partnerId: evt.partnerId,
          partner: evt.partner,
          lastMessage: evt.message.text,
          lastMessageAt: evt.message.createdAt,
          unreadCount: isActive ? 0 : (idx === -1 ? 0 : prev[idx].unreadCount) + 1,
        };
        if (idx === -1) return [updated, ...prev];
        const next = [...prev];
        next[idx] = updated;
        return next.sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1));
      });

      if (evt.partnerId === activePartnerIdRef.current && isMessagesOpenRef.current) {
        setActiveMessages((prev) => [...prev, evt.message]);
        markConversationRead(evt.partnerId).catch(() => {});
      }
    };

    // A dropped connection (idle timeout, network blip) shouldn't silently end live
    // delivery until the next full reload — reconnect automatically while logged in.
    let stopped = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (stopped) return;
      socket = connectMessageSocket(handleIncomingMessage);
      socket.addEventListener('close', () => {
        if (stopped) return;
        refreshConversations();
        reconnectTimer = setTimeout(connect, 3000);
      });
    };
    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [authUser?.id]);

  // Backstop for the WebSocket push: a dropped/missed connection shouldn't mean a
  // message never shows up. Poll the conversation list, and the open thread, at a
  // low frequency so delivery is eventually guaranteed even if the live push fails.
  useEffect(() => {
    if (!authUser) return;
    const interval = setInterval(refreshConversations, 15000);
    return () => clearInterval(interval);
  }, [authUser?.id]);

  useEffect(() => {
    if (!authUser || !isMessagesOpen || !activePartnerId) return;
    const interval = setInterval(() => {
      fetchConversation(activePartnerId)
        .then(({ messages }) => {
          setActiveMessages((prev) => {
            if (prev.length === messages.length) return prev;
            markConversationRead(activePartnerId).catch(() => {});
            return messages;
          });
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [authUser?.id, isMessagesOpen, activePartnerId]);

  const handleOpenProfile = (author: PostAuthor) => setViewedAuthor(author);
  const handleCloseProfile = () => setViewedAuthor(null);

  const openConversationWith = (partnerId: string, fallback?: PublicUser) => {
    setActivePartnerId(partnerId);
    setPendingPartner(fallback || null);
    setIsMessagesOpen(true);
    setActiveMessages([]);
    fetchConversation(partnerId)
      .then(({ messages }) => setActiveMessages(messages))
      .catch(() => {});
    markConversationRead(partnerId).catch(() => {});
    setConversations((prev) => prev.map((c) => (c.partnerId === partnerId ? { ...c, unreadCount: 0 } : c)));
  };

  const handleStartConversation = (author: PostAuthor) => {
    if (!author.userId) return;
    setViewedAuthor(null);
    openConversationWith(author.userId, {
      id: author.userId,
      name: author.name,
      avatar: author.avatar,
      title: author.title,
      organization: author.org,
    });
  };

  const handleSelectConversation = (partnerId: string) => {
    const existing = conversations.find((c) => c.partnerId === partnerId);
    openConversationWith(partnerId, existing?.partner);
  };

  const handleSendMessage = async (partnerId: string, text: string) => {
    try {
      const message = await sendMessageApi(partnerId, text);
      setActiveMessages((prev) => [...prev, message]);
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.partnerId === partnerId);
        const partner = idx !== -1 ? prev[idx].partner : pendingPartner;
        if (!partner) return prev;
        const updated: ConversationSummary = {
          partnerId,
          partner,
          lastMessage: message.text,
          lastMessageAt: message.createdAt,
          unreadCount: 0,
        };
        if (idx === -1) return [updated, ...prev];
        const next = [...prev];
        next[idx] = updated;
        return next;
      });
    } catch (err: any) {
      showToast({ type: 'info', title: 'Message not sent', message: err.message || 'Please try again.' });
    }
  };

  const handleOpenMessages = () => {
    if (!activePartnerId && conversations.length > 0) {
      handleSelectConversation(conversations[0].partnerId);
    }
    setIsMessagesOpen(true);
  };

  const applyAuthUser = (user: AuthUser) => {
    setAuthUser(user);
    const mappedRole = AUTH_ROLE_TO_USER_ROLE[user.role];
    setActiveRole(mappedRole);
    const avatar = resolveAvatar(user.avatar, user.name);
    // Real identity fields sync for every role — the Profile page (Notifications, Conferences
    // History) reads from this for organizers and sponsors too, not just professionals.
    setUserProfile((prev) => ({
      ...prev,
      name: user.name,
      title: user.title || '',
      organization: user.organization || '',
      department: user.department || '',
      city: user.city || '',
      country: user.country || '',
      bio: user.bio || '',
      avatar,
      ...EMPTY_ACCOUNT_ACHIEVEMENTS,
      reviewerInfo: { ...EMPTY_ACCOUNT_ACHIEVEMENTS.reviewerInfo, available: user.reviewerAvailable },
    }));
    if (mappedRole === 'Organizer') {
      setOrganizerNameOverride(user.organization || user.name);
      setOrganizerLogoOverride(avatar);
      setActiveTab('organizer');
    } else if (mappedRole === 'Sponsor') {
      setSponsorNameOverride(user.organization || user.name);
      setSponsorLogoOverride(avatar);
      setActiveTab('sponsor');
    } else {
      setActiveTab('home');
    }
  };

  const handleAvatarChange = async (dataUrl: string | null) => {
    const updatedUser = await updateAvatar(dataUrl);
    setAuthUser(updatedUser);
    const avatar = resolveAvatar(updatedUser.avatar, updatedUser.name);
    // The Profile page's own header always reads userProfile.avatar, regardless of role.
    setUserProfile((prev) => ({ ...prev, avatar }));
    if (updatedUser.role === 'organizer') {
      setOrganizerLogoOverride(avatar);
    } else if (updatedUser.role === 'sponsor') {
      setSponsorLogoOverride(avatar);
    }
  };

  const handleToggleReviewerAvailability = async () => {
    const nextAvailable = !userProfile.reviewerInfo.available;
    setUserProfile((prev) => ({ ...prev, reviewerInfo: { ...prev.reviewerInfo, available: nextAvailable } }));
    try {
      const updatedUser = await updateReviewerAvailability(nextAvailable);
      setAuthUser(updatedUser);
    } catch {
      setUserProfile((prev) => ({ ...prev, reviewerInfo: { ...prev.reviewerInfo, available: !nextAvailable } }));
    }
  };

  const handleEditProfile = async (payload: {
    name: string;
    title: string;
    organization: string;
    department: string;
    city: string;
    country: string;
    bio: string;
  }) => {
    const updatedUser = await updateProfile(payload);
    setAuthUser(updatedUser);
    setUserProfile((prev) => ({
      ...prev,
      name: updatedUser.name,
      title: updatedUser.title || '',
      organization: updatedUser.organization || '',
      department: updatedUser.department || '',
      city: updatedUser.city || '',
      country: updatedUser.country || '',
      bio: updatedUser.bio || '',
    }));
    if (updatedUser.role === 'organizer') {
      setOrganizerNameOverride(updatedUser.organization || updatedUser.name);
    } else if (updatedUser.role === 'sponsor') {
      setSponsorNameOverride(updatedUser.organization || updatedUser.name);
    }
  };

  useEffect(() => {
    fetchCurrentUser()
      .then((user) => {
        if (user) applyAuthUser(user);
      })
      .finally(() => setAuthLoading(false));
  }, []);

  const handleLogout = async () => {
    await apiLogout();
    setAuthUser(null);
    setOrganizerNameOverride(null);
    setSponsorNameOverride(null);
    setActiveRole('Professional');
    setActiveTab('home');
  };

  const postCelebration = (
    kind: CelebrationKind,
    headline: string,
    content: string,
    opts?: {
      authorName?: string;
      authorTitle?: string;
      authorOrg?: string;
      authorAvatar?: string;
      authorUserId?: string;
      conferenceBadge?: string;
    }
  ) => {
    const conferenceId = opts?.conferenceBadge
      ? conferences.find((c) => c.title === opts.conferenceBadge)?.id
      : undefined;
    createPostApi({
      content,
      postType: 'celebration',
      celebrationKind: kind,
      celebrationHeadline: headline,
      conferenceId,
      conferenceTitle: opts?.conferenceBadge,
      authorName: opts?.authorName,
      authorTitle: opts?.authorTitle,
      authorOrg: opts?.authorOrg,
      authorAvatar: opts?.authorAvatar,
      authorUserId: opts?.authorName ? opts?.authorUserId : undefined,
    })
      .then((post) => setPosts((prev) => [post, ...prev]))
      .catch(() => {});
  };

  // Modals State
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const [isSubmitAbstractOpen, setIsSubmitAbstractOpen] = useState(false);
  const [submitAbstractConfId, setSubmitAbstractConfId] = useState<string | undefined>();
  const [isBadgeOpen, setIsBadgeOpen] = useState(false);
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);

  // Handlers
  const handleRoleChange = (role: UserRole) => {
    setActiveRole(role);
    if (role === 'Organizer') setActiveTab('organizer');
    else if (role === 'Reviewer') setActiveTab('reviewer');
    else if (role === 'Sponsor') setActiveTab('sponsor');
    else if (role === 'Professional') setActiveTab('discover');
  };

  const handleSelectConference = (conf: Conference) => {
    setSelectedConference(conf);
    setActiveTab('detail');
  };

  const handleOpenExternalResult = (result: LiveSearchResult) => {
    setSelectedExternalResult(result);
    setActiveTab('external-detail');
  };

  const handleRegisterForConference = async (
    conferenceId: string,
    conferenceTitle: string,
    packageId: string,
    packageName: string
  ) => {
    try {
      await registerForConference(conferenceId, conferenceTitle, packageId, packageName);
      setRegistrations((prev) => {
        const existingIdx = prev.findIndex((r) => r.conferenceId === conferenceId);
        const updated = { conferenceId, conferenceTitle, packageId, packageName, registeredAt: new Date().toISOString() };
        if (existingIdx === -1) return [updated, ...prev];
        const next = [...prev];
        next[existingIdx] = updated;
        return next;
      });
      showToast({
        type: 'success',
        title: 'Registration confirmed',
        message: `You're registered for ${conferenceTitle} (${packageName}). It'll appear in your verified attendance.`,
      });
    } catch (err: any) {
      showToast({ type: 'info', title: 'Registration failed', message: err.message || 'Please try again.' });
    }
  };

  const handleVolunteerForReview = async (opportunityId: string, conferenceTitle: string, topic: string) => {
    try {
      await volunteerForReview(opportunityId, conferenceTitle, topic);
      setVolunteeredOpportunityIds((prev) => (prev.includes(opportunityId) ? prev : [...prev, opportunityId]));
    } catch (err: any) {
      showToast({ type: 'info', title: 'Could not volunteer', message: err.message || 'Please try again.' });
    }
  };

  const handleOpenSubmitAbstract = (confId?: string) => {
    setSubmitAbstractConfId(confId);
    setIsSubmitAbstractOpen(true);
  };

  const handleAddSubmission = async (newSubData: Partial<AbstractSubmission>) => {
    try {
      const newSubmission = await createSubmission({
        conferenceId: newSubData.conferenceId || 'conf_1',
        conferenceTitle: newSubData.conferenceTitle || 'Conference Title',
        title: newSubData.title || 'Untitled Abstract',
        track: newSubData.track || 'General Track',
        topic: newSubData.topic || 'General Topic',
        keywords: newSubData.keywords || [],
        abstractText: newSubData.abstractText || '',
        preferredType: newSubData.preferredType || 'Oral',
        primaryAuthor: newSubData.primaryAuthor || {
          name: userProfile.name,
          email: 'author@conferencegate.com',
          affiliation: userProfile.organization,
          bio: userProfile.bio,
        },
        coAuthors: newSubData.coAuthors || [],
        conflictOfInterest: newSubData.conflictOfInterest || 'None declared.',
      });

      setSubmissions((prev) => [newSubmission, ...prev]);
      setActiveTab('abstracts');
      showToast({
        type: 'success',
        title: 'Abstract submitted',
        message: `"${newSubmission.title}" is now in initial screening.`,
      });
    } catch (err: any) {
      showToast({ type: 'info', title: 'Submission failed', message: err.message || 'Please try again.' });
    }
  };

  const handleCompleteReview = async (abstractId: string, reviewData: any) => {
    try {
      const updatedSubmission = await submitReview(abstractId, {
        scores: reviewData.scores,
        commentsToAuthor: reviewData.commentsToAuthor,
        confidentialComments: reviewData.confidentialComments,
        recommendation: reviewData.recommendation,
      });

      setSubmissions((prev) => prev.map((sub) => (sub.id === abstractId ? updatedSubmission : sub)));

      const isAccepted = ['Accepted', 'Accepted for Oral', 'Accepted for Poster'].includes(updatedSubmission.status);
      if (isAccepted) {
        postCelebration(
          'abstract-accepted',
          '🎉 Abstract Accepted!',
          `"${updatedSubmission.title}" has been accepted for presentation at ${updatedSubmission.conferenceTitle}. Congratulations to ${updatedSubmission.primaryAuthor.name}!`,
          {
            authorName: updatedSubmission.primaryAuthor.name,
            authorTitle: 'Author',
            authorOrg: updatedSubmission.primaryAuthor.affiliation,
            authorUserId: updatedSubmission.submitterId,
            conferenceBadge: updatedSubmission.conferenceTitle,
          }
        );
      }

      const nextReviewed = myContributions.abstractsReviewed + 1;
      if (nextReviewed % 10 === 0) {
        postCelebration(
          'reviewer-milestone',
          `🏅 ${nextReviewed} Reviews Milestone!`,
          `${userProfile.name} just completed their ${nextReviewed}th verified peer review on Conference Gate — a serious commitment to the research community.`
        );
      }
    } catch (err: any) {
      showToast({ type: 'info', title: 'Review not submitted', message: err.message || 'Please try again.' });
      return;
    }

    showToast({
      type: 'achievement',
      title: 'Review submitted · +20 Kudos',
      message: 'Your feedback has been recorded and the author notified.',
    });
  };

  const handleCreateConference = async (newConfData: Partial<Conference>) => {
    const newConf: Conference = {
      id: `conf_${Date.now()}`,
      title: newConfData.title || 'New Conference',
      organizerName: newConfData.organizerName || 'Conference Organizing Board',
      organizerLogo: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=150&q=80',
      banner: newConfData.banner || 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=1200&q=80',
      logo: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=200&q=80',
      description: newConfData.description || '',
      industry: newConfData.industry || 'General Science',
      topics: newConfData.topics || [],
      tracks: newConfData.tracks || ['Track 1'],
      location: newConfData.location || { city: 'Paris', country: 'France', venue: 'Convention Center' },
      dates: newConfData.dates || { start: '2026-10-15', end: '2026-10-18' },
      format: newConfData.format || 'Hybrid',
      priceRange: '$300 - $800',
      registrationPackages: [],
      earlyBirdDeadline: '2026-09-01',
      abstractDeadline: '2026-08-01',
      cfpStatus: 'Open',
      recommendationScore: 92,
      attendeeCount: 100,
      networkAttendeesCount: 10,
      mainThemes: newConfData.mainThemes || ['Innovation'],
      agendaDays: newConfData.agendaDays || [],
      speakers: newConfData.speakers || [],
      committee: newConfData.committee || [],
      sponsors: [],
      exhibitors: [],
      accommodation: 'Partner Hotels',
      travelInfo: 'City Airport Transit',
      communityPosts: 0,
    };

    setConferences((prev) => [newConf, ...prev]);
    setMyConferences((prev) => [newConf, ...prev]);
    try {
      await createConferenceRemote(newConf);
      showToast({
        type: 'success',
        title: 'Conference created',
        message: `"${newConf.title}" is now live in the discovery feed.`,
      });
    } catch (e) {
      showToast({
        type: 'info',
        title: "Couldn't save conference",
        message: e instanceof Error ? e.message : 'It is visible now, but may not persist after a reload.',
      });
    }
  };

  const handleAddPost = (content: string) => {
    createPostApi({ content, postType: 'announcement' })
      .then((post) => {
        setPosts((prev) => [post, ...prev]);
        showToast({ type: 'success', title: 'Update posted', message: 'Your update is now live on the conference feed.' });
      })
      .catch((e) => {
        showToast({ type: 'info', title: "Couldn't post update", message: e instanceof Error ? e.message : 'Please try again.' });
      });
  };

  const handleReactToPost = (postId: string, reaction: ReactionType) => {
    reactToPost(postId, reaction)
      .then((updated) => setPosts((prev) => prev.map((p) => (p.id === postId ? updated : p))))
      .catch(() => {});
  };

  const handleToggleRepost = (postId: string) => {
    toggleRepostApi(postId)
      .then((updated) => setPosts((prev) => prev.map((p) => (p.id === postId ? updated : p))))
      .catch(() => {});
  };

  const handleToggleSavePost = (postId: string) => {
    toggleSaveApi(postId)
      .then((updated) => setPosts((prev) => prev.map((p) => (p.id === postId ? updated : p))))
      .catch(() => {});
  };

  const handleFetchPostComments = (postId: string) => fetchCommentsApi(postId);

  const handleAddPostComment = async (postId: string, text: string) => {
    await addCommentApi(postId, text);
    setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, commentsCount: p.commentsCount + 1 } : p)));
  };

  const handleInviteToCommittee = (reviewerName: string, conferenceTitle: string) => {
    postCelebration(
      'committee-appointment',
      '📋 New Technical Committee Role!',
      `${reviewerName} has joined the Technical Committee for ${conferenceTitle}, helping shape the review process and program quality.`,
      { authorName: reviewerName, authorTitle: 'Technical Committee Member', authorOrg: conferenceTitle, conferenceBadge: conferenceTitle }
    );
    showToast({
      type: 'achievement',
      title: 'Committee invitation sent',
      message: `${reviewerName} has been invited to join the Technical Committee.`,
    });
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-blue-700 animate-spin" />
      </div>
    );
  }

  if (!authUser) {
    return <AuthScreen onAuthenticated={applyAuthUser} />;
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 flex flex-col font-sans selection:bg-blue-600 selection:text-white">
      {/* Top Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={(tab) => {
          if (tab === 'profile') setProfileInitialTab('conferences');
          setActiveTab(tab);
        }}
        activeRole={activeRole}
        onRoleChange={handleRoleChange}
        onOpenAIModal={() => setIsAIModalOpen(true)}
        userProfile={userProfile}
        organizerIdentity={
          conferences[0]
            ? {
                name: organizerNameOverride || conferences[0].organizerName,
                logo: organizerLogoOverride || conferences[0].organizerLogo,
              }
            : undefined
        }
        sponsorIdentity={{
          name: sponsorNameOverride || authUser.organization || authUser.name,
          logo: sponsorLogoOverride || resolveAvatar(authUser.avatar, authUser.name),
        }}
        onOrganizerLogoChange={(dataUrl) => {
          setOrganizerLogoOverride(dataUrl);
          updateAvatar(dataUrl).then(setAuthUser).catch(() => {});
        }}
        onSponsorLogoChange={(dataUrl) => {
          setSponsorLogoOverride(dataUrl);
          updateAvatar(dataUrl).then(setAuthUser).catch(() => {});
        }}
        notifications={displayedNotifications}
        sponsorAlerts={sponsorAlerts}
        onOpenDigitalBadge={() => setIsBadgeOpen(true)}
        onSearch={(q) => setSearchQuery(q)}
        onOpenNotifications={() => {
          if (authUser.role === 'organizer') {
            fetchOrganizerActivityFeed().then(setOrganizerActivityFeed).catch(() => {});
          }
          setProfileInitialTab('notifications');
          setActiveTab('profile');
        }}
        onOpenSponsorAlerts={() => setActiveTab('sponsor')}
        accountEmail={authUser.email}
        accountRole={authUser.role}
        onLogout={handleLogout}
        onOpenMessages={handleOpenMessages}
        unreadMessageCount={totalUnreadMessages}
      />

      {/* Main Container View Router */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <AnimatePresence mode="wait">
      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
      >
        {activeTab === 'home' && authUser.role !== 'organizer' && authUser.role !== 'sponsor' && (
          <HomeLanding
            conferences={conferences}
            onSelectConference={handleSelectConference}
            onNavigateTab={setActiveTab}
            onOpenSubmitAbstract={handleOpenSubmitAbstract}
            onSearchQuery={(q) => setSearchQuery(q)}
            userProfile={userProfile}
            posts={posts}
            onAddPost={handleAddPost}
            onReact={handleReactToPost}
            onToggleRepost={handleToggleRepost}
            onToggleSave={handleToggleSavePost}
            onOpenDigitalBadge={() => setIsBadgeOpen(true)}
            onOpenProfile={handleOpenProfile}
          />
        )}

        {activeTab === 'discover' && (
          <DiscoveryEngine
            conferences={conferences}
            onSelectConference={handleSelectConference}
            onOpenSubmitAbstract={handleOpenSubmitAbstract}
            onOpenExternalResult={handleOpenExternalResult}
            initialSearchQuery={searchQuery}
            savedConferenceIds={savedConferenceIds}
            followedConferenceIds={followedConferenceIds}
            onToggleSave={handleToggleSaveConference}
            onToggleFollow={handleToggleFollowConference}
          />
        )}

        {activeTab === 'external-detail' && selectedExternalResult && (
          <ExternalConferenceDetail
            result={selectedExternalResult}
            onBack={() => setActiveTab('discover')}
          />
        )}

        {activeTab === 'detail' && selectedConference && (
          <ConferenceDetail
            conference={selectedConference}
            onBack={() => setActiveTab('discover')}
            onOpenSubmitAbstract={handleOpenSubmitAbstract}
            onVolunteerReviewer={() => setActiveTab('reviewer')}
            registeredPackageId={registrations.find((r) => r.conferenceId === selectedConference.id)?.packageId || null}
            onRegister={handleRegisterForConference}
            isSaved={savedConferenceIds.includes(selectedConference.id)}
            isFollowed={followedConferenceIds.includes(selectedConference.id)}
            onToggleSave={() => handleToggleSaveConference(selectedConference.id)}
            onToggleFollow={() => handleToggleFollowConference(selectedConference.id)}
            onExpressCommitteeInterest={async (confId) => {
              const conf = conferences.find((c) => c.id === confId);
              await recordConferenceAction(confId, conf?.title || 'this conference', 'committee_interest').catch(() => {});
              showToast({
                type: 'success',
                title: 'Interest recorded',
                message: `Saved to your activity. Explore open Technical Committee roles from the Committee tab.`,
              });
            }}
            onApplySponsorship={async (confId) => {
              const conf = conferences.find((c) => c.id === confId);
              await recordConferenceAction(confId, conf?.title || 'this conference', 'sponsorship_inquiry').catch(() => {});
              showToast({
                type: 'success',
                title: 'Sponsorship inquiry recorded',
                message: `Saved to your activity — explore live packages in the Sponsor Marketplace.`,
              });
            }}
          />
        )}

        {activeTab === 'abstracts' && authUser.role !== 'organizer' && authUser.role !== 'sponsor' && (
          <AbstractTrackerView
            submissions={submissions}
            conferences={conferences}
            onSelectConference={handleSelectConference}
            onOpenNewSubmission={() => setIsSubmitAbstractOpen(true)}
            onSubmissionUpdated={(updated) =>
              setSubmissions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
            }
          />
        )}

        {activeTab === 'reviewer' && (
          <ReviewerPortal
            userProfile={userProfile}
            opportunities={sampleReviewOpportunities}
            submissions={submissions}
            conferences={conferences}
            onSelectConference={handleSelectConference}
            onCompleteReview={handleCompleteReview}
            volunteeredOpportunityIds={volunteeredOpportunityIds}
            onVolunteer={handleVolunteerForReview}
            onToggleAvailability={handleToggleReviewerAvailability}
          />
        )}

        {activeTab === 'organizer' && authUser.role === 'organizer' && (
          <OrganizerDashboard
            conferences={myConferences}
            submissions={submissions}
            organizerName={organizerNameOverride || authUser.organization || authUser.name}
            organizerLogo={organizerLogoOverride || resolveAvatar(authUser.avatar, authUser.name)}
            organizerBio={authUser.bio || ''}
            organizerCity={authUser.city || ''}
            organizerCountry={authUser.country || ''}
            onEditOrganizerProfile={() => setIsEditProfileOpen(true)}
            registrationCountsByConference={registrationCountsByConference}
            feedbackSummary={feedbackSummary}
            sponsorshipPackages={organizerOwnPackages}
            sponsorshipOpportunities={sampleSponsorshipOpportunities}
            onActivateOpportunityPackage={handleActivateOpportunityPackage}
            sponsorApplicants={packageApplicants}
            onDecideApplication={handleDecideApplication}
            reviewableSponsors={reviewableSponsorsReal}
            onReviewSponsor={handleSubmitSponsorReview}
            onCreateConference={handleCreateConference}
            onInviteToCommittee={handleInviteToCommittee}
            onAddNotification={handleAddNotification}
            onNotifySponsors={handleNotifySponsors}
          />
        )}

        {activeTab === 'sponsor' && authUser.role === 'sponsor' && (
          <SponsorPortal
            sponsorshipPackages={sponsorshipPackagesReal}
            sponsorshipOpportunities={sampleSponsorshipOpportunities}
            myApplications={myApplications}
            sponsorProfile={sponsorProfileForPortal}
            sponsorAlerts={sponsorAlerts}
            onMarkAlertRead={handleMarkSponsorAlertRead}
            onMarkAllAlertsRead={handleMarkAllSponsorAlertsRead}
            onApplyForSponsorship={handleApplyForSponsorship}
          />
        )}

        {activeTab === 'community' && (
          <CommunityFeed
            posts={posts}
            onAddPost={handleAddPost}
            onReact={handleReactToPost}
            onToggleRepost={handleToggleRepost}
            onToggleSave={handleToggleSavePost}
            onFetchComments={handleFetchPostComments}
            onAddComment={handleAddPostComment}
            conferences={conferences}
            onSelectConference={handleSelectConference}
            userProfile={userProfile}
            onOpenProfile={handleOpenProfile}
          />
        )}

        {activeTab === 'profile' && (
          <UserProfileView
            userProfile={userProfile}
            currentUserId={authUser.id}
            submissions={submissions}
            posts={posts}
            registrations={registrations}
            conferences={conferences}
            onSelectConference={handleSelectConference}
            onOpenBadgeModal={() => setIsBadgeOpen(true)}
            onOpenCertificates={() => setActiveTab('certificates')}
            initialTab={profileInitialTab}
            variant={authUser.role === 'organizer' ? 'organizer' : authUser.role === 'sponsor' ? 'sponsor' : 'professional'}
            notifications={displayedNotifications}
            onMarkNotificationRead={displayedOnMarkNotificationRead}
            onMarkAllNotificationsRead={displayedOnMarkAllNotificationsRead}
            onAvatarChange={handleAvatarChange}
            hasCustomAvatar={!!authUser.avatar}
            onEditProfile={handleEditProfile}
          />
        )}

        {activeTab === 'certificates' && (
          <CertificatesView
            userProfile={userProfile}
            submissions={submissions}
            registrations={registrations}
            conferences={conferences}
            onSelectConference={handleSelectConference}
            currentUserId={authUser?.id}
            onBack={() => setActiveTab('profile')}
          />
        )}
      </motion.div>
      </AnimatePresence>
      </main>

      {/* Global SaaS Footer */}
      <Footer
        onNavigateTab={(tab) => {
          if (tab === 'profile') setProfileInitialTab('conferences');
          setActiveTab(tab);
        }}
        onOpenAIAssistant={() => setIsAIModalOpen(true)}
        onOpenBadge={() => setIsBadgeOpen(true)}
        role={authUser.role}
      />

      {/* Modals */}
      <AIAssistantModal
        isOpen={isAIModalOpen}
        onClose={() => setIsAIModalOpen(false)}
        userRole={activeRole}
      />

      <AbstractSubmissionModal
        isOpen={isSubmitAbstractOpen}
        onClose={() => setIsSubmitAbstractOpen(false)}
        conferences={conferences}
        defaultConferenceId={submitAbstractConfId}
        onSubmit={handleAddSubmission}
        author={{
          name: userProfile.name,
          email: authUser.email,
          affiliation: userProfile.organization,
          bio: userProfile.bio,
        }}
      />

      <DigitalBadgeModal
        isOpen={isBadgeOpen}
        onClose={() => setIsBadgeOpen(false)}
        userProfile={userProfile}
      />

      {(authUser.role === 'organizer' || authUser.role === 'sponsor') && (
        <EditProfileModal
          isOpen={isEditProfileOpen}
          onClose={() => setIsEditProfileOpen(false)}
          variant={authUser.role}
          initialValues={{
            name: authUser.name,
            title: authUser.title || '',
            organization: authUser.organization || '',
            department: authUser.department || '',
            city: authUser.city || '',
            country: authUser.country || '',
            bio: authUser.bio || '',
          }}
          onSave={handleEditProfile}
        />
      )}

      <PersonProfileModal
        author={viewedAuthor}
        posts={posts}
        onClose={handleCloseProfile}
        onMessage={handleStartConversation}
      />

      <MessagesPanel
        isOpen={isMessagesOpen}
        onClose={() => setIsMessagesOpen(false)}
        conversations={conversations}
        activePartnerId={activePartnerId}
        pendingPartner={pendingPartner}
        activeMessages={activeMessages}
        currentUserId={authUser.id}
        onSelectConversation={handleSelectConversation}
        onSendMessage={handleSendMessage}
        onStartNewConversation={(user) => openConversationWith(user.id, user)}
      />
    </div>
  );
}

export default App;
