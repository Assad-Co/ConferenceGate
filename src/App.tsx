import React, { useState } from 'react';
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
} from './data/mockData';
import { Conference, AbstractSubmission, Post, UserRole } from './types';

export function App() {
  const [activeRole, setActiveRole] = useState<UserRole>('Professional');
  const [activeTab, setActiveTab] = useState<string>('home');
  const [selectedConference, setSelectedConference] = useState<Conference | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // App Data State
  const [conferences, setConferences] = useState<Conference[]>(sampleConferences);
  const [submissions, setSubmissions] = useState<AbstractSubmission[]>(sampleAbstractSubmissions);
  const [posts, setPosts] = useState<any[]>(sampleFeedPosts);
  const [userProfile, setUserProfile] = useState(currentUserProfile);

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
  };

  const handleCompleteReview = (abstractId: string, reviewData: any) => {
    setSubmissions((prev) =>
      prev.map((sub) => {
        if (sub.id === abstractId) {
          return {
            ...sub,
            status: 'Under Review',
            reviews: [...sub.reviews, reviewData],
          };
        }
        return sub;
      })
    );

    setUserProfile((prev) => ({
      ...prev,
      contributions: {
        ...prev.contributions,
        reviewerKudos: prev.contributions.reviewerKudos + 20,
        abstractsReviewed: prev.contributions.abstractsReviewed + 1,
      },
    }));
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
  };

  const handleAddPost = (content: string) => {
    const newPost = {
      id: `post_${Date.now()}`,
      authorName: userProfile.name,
      authorAvatar: userProfile.avatar,
      authorTitle: userProfile.title,
      authorOrg: userProfile.organization,
      conferenceTitle: 'Annual Subsurface Energy & AI Summit 2026',
      content,
      timestamp: 'Just now',
      postType: 'general' as const,
      reactions: { likes: 1, celebrates: 0, insightful: 0, kudos: 0 },
      commentsCount: 0,
    };
    setPosts([newPost, ...posts]);
  };

  return (
    <div className="min-h-screen bg-blue-950 text-slate-100 flex flex-col font-sans selection:bg-blue-600 selection:text-white">
      {/* Top Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        activeRole={activeRole}
        onRoleChange={handleRoleChange}
        onOpenAIModal={() => setIsAIModalOpen(true)}
      />

      {/* Main Container View Router */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'home' && (
          <HomeLanding
            conferences={conferences}
            onSelectConference={handleSelectConference}
            onNavigateTab={setActiveTab}
            onOpenSubmitAbstract={handleOpenSubmitAbstract}
            onSearchQuery={(q) => setSearchQuery(q)}
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
          />
        )}

        {activeTab === 'sponsor' && (
          <SponsorPortal sponsorshipPackages={sampleSponsorshipPackages} />
        )}

        {activeTab === 'community' && (
          <CommunityFeed posts={posts} onAddPost={handleAddPost} />
        )}

        {activeTab === 'profile' && (
          <UserProfileView
            userProfile={userProfile}
            onOpenBadgeModal={() => setIsBadgeOpen(true)}
            onOpenCertificates={() => setActiveTab('certificates')}
          />
        )}

        {activeTab === 'certificates' && (
          <CertificatesView
            userProfile={userProfile}
            onBack={() => setActiveTab('profile')}
          />
        )}
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
