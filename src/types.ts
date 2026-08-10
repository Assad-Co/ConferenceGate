export type UserRole =
  | 'Professional'
  | 'Organizer'
  | 'Reviewer'
  | 'Sponsor'
  | 'professional'
  | 'organizer'
  | 'reviewer'
  | 'sponsor';

export type ConferenceRole =
  | 'Attendee'
  | 'Author'
  | 'Presenter'
  | 'Speaker'
  | 'Keynote'
  | 'Reviewer'
  | 'Session Chair'
  | 'Moderator'
  | 'Technical Committee'
  | 'Organizer Rep';

export interface VerifiedAchievement {
  id: string;
  title: string;
  conferenceName: string;
  year: number;
  date: string;
  verifiedBy: string;
  badgeType: 'reviewer' | 'speaker' | 'committee' | 'chair' | 'author';
}

export interface ActivityTimelineItem {
  year: number;
  items: Array<{
    title: string;
    conference: string;
    role: string;
    badge?: string;
  }>;
}

export interface UserProfile {
  id: string;
  name: string;
  title: string;
  organization: string;
  department: string;
  industry: string;
  country: string;
  city: string;
  avatar: string;
  bio: string;
  education: string[];
  certifications: string[];
  expertise: string[];
  technicalSpecialization: string[];
  researchInterests: string[];
  keywords: string[];
  publications: Array<{ id: string; title: string; journal: string; year: number; doi?: string; url?: string }>;
  societies: string[];
  languages: string[];
  contributions: {
    conferencesAttended: number;
    abstractsSubmitted: number;
    abstractsAccepted: number;
    oralPresentations: number;
    posterPresentations: number;
    speakerRoles: number;
    keynoteRoles: number;
    workshopsDelivered: number;
    panelsParticipated: number;
    sessionsChaired: number;
    technicalCommittees: number;
    abstractsReviewed: number;
    conferencesReviewedFor: number;
    reviewerKudos: number;
    awards: number;
    certificatesCount: number;
  };
  verifiedAchievements: VerifiedAchievement[];
  timeline: ActivityTimelineItem[];
  reviewerInfo: {
    available: boolean;
    expertiseKeywords: string[];
    maxLoad: number;
    currentLoad: number;
    totalReviewed: number;
    kudos: number;
    badges: string[];
    outstandingAwards: string[];
  };
}

export interface RegistrationPackage {
  id: string;
  name: string;
  price: number;
  description: string;
  earlyBirdDeadline?: string;
  features: string[];
}

export interface AgendaSession {
  id: string;
  time: string;
  title: string;
  hall: string;
  speakerName: string;
  speakerTitle: string;
  speakerAvatar: string;
  track: string;
  abstractSummary?: string;
}

export interface AgendaDay {
  date: string;
  dayName: string;
  sessions: AgendaSession[];
}

export interface Speaker {
  id: string;
  name: string;
  title: string;
  org: string;
  avatar: string;
  role: string;
  bio: string;
  interests: string[];
}

export interface CommitteeMember {
  id: string;
  name: string;
  title: string;
  org: string;
  avatar: string;
  committeeRole: string;
  track?: string;
}

export interface Sponsor {
  id: string;
  name: string;
  logo: string;
  tier: 'Diamond' | 'Gold' | 'Silver' | 'Bronze' | 'Technology';
  website?: string;
}

export interface Exhibitor {
  id: string;
  name: string;
  boothNumber: string;
  logo: string;
  category: string;
}

export interface Conference {
  id: string;
  title: string;
  logo: string;
  banner: string;
  organizerName: string;
  organizerLogo: string;
  description: string;
  topics: string[];
  tracks: string[];
  industry: string;
  location: {
    city: string;
    country: string;
    venue: string;
  };
  dates: {
    start: string;
    end: string;
  };
  format: 'Physical' | 'Online' | 'Hybrid';
  priceRange: string;
  registrationPackages: RegistrationPackage[];
  earlyBirdDeadline: string;
  abstractDeadline: string;
  cfpStatus: 'Open' | 'Closed' | 'Extended';
  recommendationScore: number;
  attendeeCount: number;
  networkAttendeesCount: number;
  mainThemes: string[];
  agendaDays: AgendaDay[];
  speakers: Speaker[];
  committee: CommitteeMember[];
  sponsors: Sponsor[];
  exhibitors: Exhibitor[];
  accommodation: string;
  travelInfo: string;
  communityPosts: number;
  isSaved?: boolean;
  isFollowed?: boolean;
  hasBrochure?: boolean;
  hasCityMap?: boolean;
}

export interface AbstractReview {
  id: string;
  abstractId: string;
  reviewerId: string;
  reviewerName: string;
  reviewerOrg: string;
  scores: {
    technicalQuality: number;
    originality: number;
    relevance: number;
    innovation: number;
    methodology: number;
    clarity: number;
    scientificValue: number;
    presentationPotential: number;
  };
  overallScore: number;
  commentsToAuthor: string;
  confidentialComments: string;
  recommendation: 'Accept' | 'Accept with Revision' | 'Oral Presentation' | 'Poster Presentation' | 'Major Revision' | 'Reject';
  date: string;
}

export interface AbstractSubmission {
  id: string;
  conferenceId: string;
  conferenceTitle: string;
  title: string;
  primaryAuthor: {
    name: string;
    email: string;
    affiliation: string;
    bio: string;
  };
  coAuthors: Array<{ name: string; affiliation: string; email: string }>;
  topic: string;
  track: string;
  keywords: string[];
  abstractText: string;
  supportingDocs?: string;
  preferredType: 'Oral' | 'Poster';
  conflictOfInterest: string;
  status:
    | 'Draft'
    | 'Submitted'
    | 'Initial Screening'
    | 'Awaiting Reviewer Assignment'
    | 'Reviewer Invited'
    | 'Reviewer Accepted'
    | 'Under Review'
    | 'Revision Requested'
    | 'Revised Abstract Submitted'
    | 'Accepted'
    | 'Accepted for Oral'
    | 'Accepted for Poster'
    | 'Rejected'
    | 'Withdrawn';
  submissionDate: string;
  revisionsCount: number;
  visualTimeline: Array<{
    label: string;
    status: 'completed' | 'current' | 'upcoming';
    date?: string;
  }>;
  reviews: AbstractReview[];
}

export interface SponsorshipPackage {
  id: string;
  conferenceId: string;
  conferenceTitle: string;
  tier: 'Diamond' | 'Platinum' | 'Gold' | 'Silver' | 'Bronze' | 'Specialty';
  price: number;
  benefits: string[];
  logoExposure: string;
  websiteExposure: string;
  appExposure: string;
  boothSpace: string;
  speakingOps: string;
  complimentaryRegistrations: number;
  availableSlots: number;
  totalSlots: number;
}

export interface SponsorProfile {
  id: string;
  companyName: string;
  logo: string;
  description: string;
  industry: string;
  products: string[];
  preferredSectors: string[];
  preferredRegions: string[];
  budgetRange: string;
  activeSponsorshipsCount: number;
  leadsCaptured: number;
  roiScore: number;
  profileViews: number;
  logoImpressions: number;
  contactEmail: string;
}

export interface ReviewOpportunity {
  id: string;
  conferenceId: string;
  conferenceTitle: string;
  topic: string;
  track: string;
  expertiseRequired: string[];
  reviewPeriod: string;
  deadline: string;
  expectedWorkload: string;
  abstractsCount: number;
  organizerName: string;
}

export interface TechnicalCommitteeOpportunity {
  id: string;
  conferenceId: string;
  conferenceTitle: string;
  seekingRoles: string[];
  track: string;
  deadline: string;
  organizerName: string;
  description: string;
}

export type CelebrationKind =
  | 'abstract-accepted'
  | 'reviewer-milestone'
  | 'committee-appointment'
  | 'sponsorship-accepted'
  | 'best-organizer'
  | 'achievement';

export interface FeedPost {
  id: string;
  authorName: string;
  authorTitle: string;
  authorOrg: string;
  authorAvatar: string;
  content: string;
  timestamp: string;
  postType: 'announcement' | 'achievement' | 'cfp' | 'speaker' | 'sponsorship' | 'review' | 'celebration';
  conferenceBadge?: string;
  celebrationKind?: CelebrationKind;
  celebrationHeadline?: string;
  reactions: {
    likes: number;
    celebrates: number;
    insightful: number;
    kudos: number;
  };
  userReaction?: 'like' | 'celebrate' | 'insightful' | 'kudos';
  commentsCount: number;
  impressions?: number;
  repostsCount?: number;
}

export interface DirectMessage {
  id: string;
  partnerId: string;
  partnerName: string;
  partnerAvatar: string;
  partnerRole: string;
  messages: Array<{
    id: string;
    senderId: string;
    text: string;
    timestamp: string;
  }>;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  type: 'review' | 'abstract' | 'invitation' | 'sponsorship' | 'agenda' | 'followup';
  actionUrl?: string;
}

export interface DigitalCertificate {
  id: string;
  recipientName: string;
  title: string;
  conferenceName: string;
  issueDate: string;
  certificateType: 'Attendance' | 'Speaker' | 'Reviewer' | 'Technical Committee' | 'Session Chair' | 'Workshop';
  verificationCode: string;
}

export type Post = FeedPost;

export interface EngagementMetric {
  value: number;
  deltaPct: number;
}

export interface EngagementTrendPoint {
  date: string;
  impressions: number;
}

export interface TopPerformingPost {
  id: string;
  excerpt: string;
  conferenceBadge?: string;
  timestamp: string;
  impressions: number;
  reactions: number;
  comments: number;
  reposts: number;
  saves: number;
}

export interface DemographicBreakdownItem {
  label: string;
  pct: number;
}

export interface EngagementAnalytics {
  period: string;
  summary: {
    impressions: EngagementMetric;
    impressionViews: EngagementMetric;
    reactions: EngagementMetric;
    comments: EngagementMetric;
    reposts: EngagementMetric;
    saves: EngagementMetric;
  };
  reactionBreakdown: Array<{ type: 'like' | 'celebrate' | 'insightful' | 'kudos'; count: number }>;
  impressionsTrend: EngagementTrendPoint[];
  topPosts: TopPerformingPost[];
  demographics: {
    industry: DemographicBreakdownItem[];
    company: DemographicBreakdownItem[];
    companySize: DemographicBreakdownItem[];
    location: DemographicBreakdownItem[];
    jobTitle: DemographicBreakdownItem[];
  };
}
