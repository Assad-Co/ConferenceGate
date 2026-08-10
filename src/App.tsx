import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useToast } from './components/Toast';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { HomeLanding } from './components/HomeLanding';
import { DiscoveryEngine } from './components/DiscoveryEngine';
import { ConferenceDetail } from './components/ConferenceDetail';
import { AbstractSubmissionModal } from './components/AbstractSubmissionModal';
import { AbstractTrackerView } from './components/AbstractTrackerView';
import { ReviewerPortal } from './components/ReviewerPortal';
import { OrganizerDashboard } from './components/OrganizerDashboard';
import { SponsorPortal } from './components/SponsorPortal';
import { UserProfileView } from './components/UserProfileView';
import { CommunityFeed } from './components/CommunityFeed';
import { AIAssistantModal } from './components/AIAssistantModal';
import { NetworkingModal } from './components/NetworkingModal';
import { DigitalBadgeModal } from './components/DigitalBadgeModal';
import { CertificatesView } from './components/CertificatesView';

import {
  sampleConferences,
  currentUserProfile,
  sampleAbstractSubmissions,
  sampleFeedPosts,
  sampleReviewOpportunities,
  sampleSponsorshipPackages,
  sampleSponsorProfile,
  sampleNotifications,
} from './data/mockData';
import { Conference, AbstractSubmission, CelebrationKind, NotificationItem, Post, SponsorshipPackage, UserRole } from './types';

const RECOMMENDATION_TO_STATUS: Record<string, AbstractSubmission['status']> = {
  Accept: 'Accepted',
  'Oral Presentation': 'Accepted for Oral',
  'Poster Presentation': 'Accepted for Poster',
};

export function App() {
  const { showToast } = useToast();
  const [activeRole, setActiveRole] = useState<UserRole>('Professional');
  const [activeTab, setActiveTab] = useState<string>('home');
  const [selectedConference, setSelectedConference] = useState<Conference | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [profileInitialTab, setProfileInitialTab] = useState<'conferences' | 'notifications'>('conferences');
  const [notifications, setNotifications] = useState<NotificationItem[]>(sampleNotifications);

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
  const [submissions, setSubmissions] = useState<AbstractSubmission[]>(sampleAbstractSubmissions);
  const [posts, setPosts] = useState<Post[]>(sampleFeedPosts);
  const [userProfile, setUserProfile] = useState(currentUserProfile);

  const postCelebration = (
    kind: CelebrationKind,
    headline: string,
    content: string,
    opts?: { authorName?: string; authorTitle?: string; authorOrg?: string; authorAvatar?: string; conferenceBadge?: string }
  ) => {
    const celebration: Post = {
      id: `post_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      authorName: opts?.authorName || userProfile.name,
      authorTitle: opts?.authorTitle || userProfile.title,
      authorOrg: opts?.authorOrg || userProfile.organization,
      authorAvatar: opts?.authorAvatar || userProfile.avatar,
      content,
      timestamp: 'Just now',
      postType: 'celebration',
      celebrationKind: kind,
      celebrationHeadline: headline,
      conferenceBadge: opts?.conferenceBadge,
      reactions: { likes: 0, celebrates: 0, insightful: 0, kudos: 0 },
      commentsCount: 0,
    };
    setPosts((prev) => [celebration, ...prev]);
  };

  // Modals State
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const [isSubmitAbstractOpen, setIsSubmitAbstractOpen] = useState(false);
  const [submitAbstractConfId, setSubmitAbstractConfId] = useState<string | undefined>();
  const [isNetworkingOpen, setIsNetworkingOpen] = useState(false);
  const [isBadgeOpen, setIsBadgeOpen] = useState(false);

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

  const handleOpenSubmitAbstract = (confId?: string) => {
    setSubmitAbstractConfId(confId);
    setIsSubmitAbstractOpen(true);
  };

  const handleAddSubmission = (newSubData: Partial<AbstractSubmission>) => {
    const newSubmission: AbstractSubmission = {
      id: `sub_${Date.now()}`,
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
        bio: userProfile.headline,
      },
      coAuthors: newSubData.coAuthors || [],
      conflictOfInterest: newSubData.conflictOfInterest || 'None declared.',
      status: 'Submitted',
      submissionDate: new Date().toISOString().split('T')[0],
      revisionsCount: 0,
      visualTimeline: [
        { label: 'Submitted', status: 'completed', date: 'Today' },
        { label: 'Initial Screening', status: 'current', date: 'In Progress' },
        { label: 'Reviewer Assignment', status: 'upcoming' },
        { label: 'Under Review', status: 'upcoming' },
        { label: 'Final Decision', status: 'upcoming' },
      ],
      reviews: [],
    };

    setSubmissions([newSubmission, ...submissions]);
    setActiveTab('abstracts');
    showToast({
      type: 'success',
      title: 'Abstract submitted',
      message: `"${newSubmission.title}" is now in initial screening.`,
    });
  };

  const handleCompleteReview = (abstractId: string, reviewData: any) => {
    const newStatus = RECOMMENDATION_TO_STATUS[reviewData.recommendation];
    let acceptedSubmission: AbstractSubmission | undefined;

    setSubmissions((prev) =>
      prev.map((sub) => {
        if (sub.id === abstractId) {
          if (newStatus) acceptedSubmission = sub;
          return {
            ...sub,
            status: newStatus || 'Under Review',
            reviews: [...sub.reviews, reviewData],
          };
        }
        return sub;
      })
    );

    const nextReviewed = userProfile.contributions.abstractsReviewed + 1;
    setUserProfile((prev) => ({
      ...prev,
      contributions: {
        ...prev.contributions,
        reviewerKudos: prev.contributions.reviewerKudos + 20,
        abstractsReviewed: nextReviewed,
      },
    }));

    if (acceptedSubmission) {
      postCelebration(
        'abstract-accepted',
        '🎉 Abstract Accepted!',
        `"${acceptedSubmission.title}" has been accepted for presentation at ${acceptedSubmission.conferenceTitle}. Congratulations to ${acceptedSubmission.primaryAuthor.name}!`,
        {
          authorName: acceptedSubmission.primaryAuthor.name,
          authorTitle: 'Author',
          authorOrg: acceptedSubmission.primaryAuthor.affiliation,
          conferenceBadge: acceptedSubmission.conferenceTitle,
        }
      );
    }

    if (nextReviewed % 10 === 0) {
      postCelebration(
        'reviewer-milestone',
        `🏅 ${nextReviewed} Reviews Milestone!`,
        `${userProfile.name} just completed their ${nextReviewed}th verified peer review on Conference Gate — a serious commitment to the research community.`
      );
    }

    showToast({
      type: 'achievement',
      title: 'Review submitted · +20 Kudos',
      message: 'Your feedback has been recorded and the author notified.',
    });
  };

  const handleCreateConference = (newConfData: Partial<Conference>) => {
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
      agendaDays: [],
      speakers: [],
      committee: [],
      sponsors: [],
      exhibitors: [],
      accommodation: 'Partner Hotels',
      travelInfo: 'City Airport Transit',
      communityPosts: 0,
    };

    setConferences([newConf, ...conferences]);
    showToast({
      type: 'success',
      title: 'Conference created',
      message: `"${newConf.title}" is now live in the discovery feed.`,
    });
  };

  const handleAddPost = (content: string) => {
    const newPost: Post = {
      id: `post_${Date.now()}`,
      authorName: userProfile.name,
      authorAvatar: userProfile.avatar,
      authorTitle: userProfile.title,
      authorOrg: userProfile.organization,
      conferenceBadge: 'Annual Subsurface Energy & AI Summit 2026',
      content,
      timestamp: 'Just now',
      postType: 'announcement',
      reactions: { likes: 1, celebrates: 0, insightful: 0, kudos: 0 },
      commentsCount: 0,
    };
    setPosts([newPost, ...posts]);
    showToast({ type: 'success', title: 'Update posted', message: 'Your update is now live on the conference feed.' });
  };

  const handleSponsorshipAccepted = (pkg: SponsorshipPackage) => {
    postCelebration(
      'sponsorship-accepted',
      '🤝 Sponsorship Confirmed!',
      `${sampleSponsorProfile.companyName} is proud to confirm ${pkg.tier} Tier sponsorship for ${pkg.conferenceTitle}! We look forward to connecting with the community.`,
      {
        authorName: sampleSponsorProfile.companyName,
        authorTitle: 'Corporate Sponsor',
        authorOrg: pkg.conferenceTitle,
        authorAvatar: sampleSponsorProfile.logo,
        conferenceBadge: pkg.conferenceTitle,
      }
    );
    showToast({
      type: 'achievement',
      title: 'Sponsorship confirmed',
      message: `${pkg.tier} tier package reserved for ${pkg.conferenceTitle}.`,
    });
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
        notifications={notifications}
        onOpenDigitalBadge={() => setIsBadgeOpen(true)}
        onSearch={(q) => setSearchQuery(q)}
        onOpenNotifications={() => {
          setProfileInitialTab('notifications');
          setActiveTab('profile');
        }}
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
        {activeTab === 'home' && (
          <HomeLanding
            conferences={conferences}
            onSelectConference={handleSelectConference}
            onNavigateTab={setActiveTab}
            onOpenSubmitAbstract={handleOpenSubmitAbstract}
            onSearchQuery={(q) => setSearchQuery(q)}
            userProfile={userProfile}
            posts={posts}
            onAddPost={handleAddPost}
          />
        )}

        {activeTab === 'discover' && (
          <DiscoveryEngine
            conferences={conferences}
            onSelectConference={handleSelectConference}
            onOpenSubmitAbstract={handleOpenSubmitAbstract}
            initialSearchQuery={searchQuery}
          />
        )}

        {activeTab === 'detail' && selectedConference && (
          <ConferenceDetail
            conference={selectedConference}
            onBack={() => setActiveTab('discover')}
            onOpenSubmitAbstract={handleOpenSubmitAbstract}
            onVolunteerReviewer={() => setActiveTab('reviewer')}
            onExpressCommitteeInterest={() => setActiveTab('organizer')}
            onApplySponsorship={() => setActiveTab('sponsor')}
          />
        )}

        {activeTab === 'abstracts' && (
          <AbstractTrackerView
            submissions={submissions}
            onOpenNewSubmission={() => setIsSubmitAbstractOpen(true)}
          />
        )}

        {activeTab === 'reviewer' && (
          <ReviewerPortal
            userProfile={userProfile}
            opportunities={sampleReviewOpportunities}
            submissions={submissions}
            onCompleteReview={handleCompleteReview}
          />
        )}

        {activeTab === 'organizer' && (
          <OrganizerDashboard
            conferences={conferences}
            submissions={submissions}
            sponsorshipPackages={sampleSponsorshipPackages}
            onCreateConference={handleCreateConference}
            onInviteToCommittee={handleInviteToCommittee}
            onAddNotification={handleAddNotification}
          />
        )}

        {activeTab === 'sponsor' && (
          <SponsorPortal
            sponsorshipPackages={sampleSponsorshipPackages}
            onSponsorshipAccepted={handleSponsorshipAccepted}
          />
        )}

        {activeTab === 'community' && (
          <CommunityFeed posts={posts} onAddPost={handleAddPost} userProfile={userProfile} />
        )}

        {activeTab === 'profile' && (
          <UserProfileView
            userProfile={userProfile}
            onOpenBadgeModal={() => setIsBadgeOpen(true)}
            onOpenCertificates={() => setActiveTab('certificates')}
            initialTab={profileInitialTab}
            notifications={notifications}
            onMarkNotificationRead={handleMarkNotificationRead}
            onMarkAllNotificationsRead={handleMarkAllNotificationsRead}
          />
        )}

        {activeTab === 'certificates' && (
          <CertificatesView
            userProfile={userProfile}
            onBack={() => setActiveTab('profile')}
          />
        )}
      </motion.div>
      </AnimatePresence>
      </main>

      {/* Global SaaS Footer */}
      <Footer onNavigateTab={setActiveTab} />

      {/* Modals */}
      <AIAssistantModal
        isOpen={isAIModalOpen}
        onClose={() => setIsAIModalOpen(false)}
        activeRole={activeRole}
      />

      <AbstractSubmissionModal
        isOpen={isSubmitAbstractOpen}
        onClose={() => setIsSubmitAbstractOpen(false)}
        conferences={conferences}
        defaultConferenceId={submitAbstractConfId}
        onSubmit={handleAddSubmission}
      />

      <NetworkingModal
        isOpen={isNetworkingOpen}
        onClose={() => setIsNetworkingOpen(false)}
      />

      <DigitalBadgeModal
        isOpen={isBadgeOpen}
        onClose={() => setIsBadgeOpen(false)}
        userProfile={userProfile}
      />
    </div>
  );
}

export default App;
