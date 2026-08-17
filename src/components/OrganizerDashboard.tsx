import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Calendar,
  Users,
  FileText,
  DollarSign,
  TrendingUp,
  Award,
  Sparkles,
  Plus,
  Send,
  Edit3,
  CheckCircle2,
  Clock,
  Layers,
  BarChart3,
  Mail,
  ChevronRight,
  ChevronDown,
  Filter,
  Image as ImageIcon,
  UserPlus,
  Mic,
  Trash2,
  Bell,
  ClipboardList,
  MessageCircle,
  Video,
  Star,
  Wine,
  Presentation,
  GraduationCap,
  Snowflake,
  Bus,
  Landmark,
  UtensilsCrossed,
  Utensils,
  Gift,
  Globe,
  Smile,
  Briefcase,
  LayoutGrid,
  PieChart,
  ShieldCheck,
  ShieldAlert,
  MessageSquareQuote,
} from 'lucide-react';
import { Conference, AbstractSubmission, SponsorshipPackage, SponsorshipOpportunity, SponsorProfile } from '../types';
import { formatDate } from '../utils/date';
import { isSponsorVerified, sponsorVerificationReason, SPONSOR_RATING_THRESHOLD } from '../utils/sponsorVerification';
import { useToast } from './Toast';
import { sendBroadcast, fetchMyBroadcasts, OrganizerBroadcast } from '../api/activity';
import { sendMessage } from '../api/messages';

interface OrganizerDashboardProps {
  conferences: Conference[];
  submissions: AbstractSubmission[];
  organizerName?: string;
  organizerLogo?: string;
  registrationCountsByConference?: Record<string, number>;
  feedbackSummary?: { averageScore: number; responseCount: number };
  sponsorshipPackages: SponsorshipPackage[];
  sponsorshipOpportunities: SponsorshipOpportunity[];
  activatedOpportunityKeys: Record<string, boolean>;
  onToggleOpportunityPackage: (key: string) => void;
  sponsorApplicants?: SponsorProfile[];
  reviewableSponsors?: SponsorProfile[];
  onReviewSponsor?: (sponsorId: string, review: { conferenceTitle: string; rating: number; comment: string }) => void;
  onCreateConference: (newConf: Partial<Conference>) => void;
  onInviteToCommittee?: (reviewerName: string, conferenceTitle: string) => void;
  onAddNotification?: (notif: { title: string; message: string; type: 'followup'; actionUrl?: string }) => void;
  onNotifySponsors?: (title: string, message: string) => void;
}

const CHART_HEX = {
  blue: '#2563eb',
  indigo: '#4f46e5',
  violet: '#7c3aed',
  emerald: '#10b981',
  amber: '#f59e0b',
  rose: '#f43f5e',
  slate: '#cbd5e1',
};

function buildConicGradient(segments: Array<{ color: string; value: number }>) {
  const total = segments.reduce((sum, seg) => sum + seg.value, 0) || 1;
  let cursor = 0;
  const stops = segments.map((seg) => {
    const start = (cursor / total) * 360;
    cursor += seg.value;
    const end = (cursor / total) * 360;
    return `${seg.color} ${start}deg ${end}deg`;
  });
  return `conic-gradient(${stops.join(', ')})`;
}

const AnalyticsStatTile: React.FC<{
  icon: React.ElementType;
  label: string;
  value: string;
  sub: string;
  tone: 'good' | 'neutral' | 'warning';
  accent: string;
}> = ({ icon: Icon, label, value, sub, tone, accent }) => (
  <div className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-2">
    <div className="flex items-center justify-between">
      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</span>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0`} style={{ backgroundColor: `${accent}1a` }}>
        <Icon className="w-4 h-4" style={{ color: accent }} />
      </div>
    </div>
    <div className="text-2xl font-extrabold text-slate-900">{value}</div>
    <div
      className={`text-[11px] font-semibold ${
        tone === 'good' ? 'text-emerald-600' : tone === 'warning' ? 'text-amber-600' : 'text-slate-500'
      }`}
    >
      {sub}
    </div>
  </div>
);

const AnalyticsBarRow: React.FC<{ label: string; value: number; max: number; color: string; valueLabel: string }> = ({
  label,
  value,
  max,
  color,
  valueLabel,
}) => (
  <div className="space-y-1" title={`${label}: ${valueLabel}`}>
    <div className="flex items-center justify-between text-[11px]">
      <span className="font-semibold text-slate-700">{label}</span>
      <span className="font-bold text-slate-900">{valueLabel}</span>
    </div>
    <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%`, backgroundColor: color }}
      />
    </div>
  </div>
);

const AnalyticsGaugeCard: React.FC<{
  icon: React.ElementType;
  title: string;
  subtitle: string;
  score: number;
  maxScore: number;
  color: string;
  responseCount: number;
  breakdown: Array<{ label: string; pct: number }>;
}> = ({ icon: Icon, title, subtitle, score, maxScore, color, responseCount, breakdown }) => (
  <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-xs space-y-4">
    <div className="flex items-center gap-2">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${color}1a` }}>
        <Icon className="w-4 h-4" style={{ color }} />
      </div>
      <div>
        <div className="font-bold text-xs text-slate-900">{title}</div>
        <div className="text-[10px] text-slate-500">{subtitle}</div>
      </div>
    </div>

    <div className="flex items-center gap-4">
      <div
        className="w-20 h-20 rounded-full flex items-center justify-center shrink-0"
        style={{
          background: buildConicGradient([
            { color, value: score },
            { color: CHART_HEX.slate, value: maxScore - score },
          ]),
        }}
      >
        <div className="w-14 h-14 rounded-full bg-white flex flex-col items-center justify-center">
          <span className="text-sm font-extrabold text-slate-900">{score.toFixed(1)}</span>
          <span className="text-[8px] text-slate-400 font-bold">/ {maxScore}</span>
        </div>
      </div>
      <div className="flex-1 space-y-1.5">
        {breakdown.map((b) => (
          <div key={b.label} className="flex items-center gap-2" title={`${b.label}: ${b.pct}%`}>
            <span className="text-[9px] font-bold text-slate-500 w-14 shrink-0">{b.label}</span>
            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${b.pct}%`, backgroundColor: color }} />
            </div>
          </div>
        ))}
      </div>
    </div>
    <div className="text-[10px] text-slate-400 font-semibold pt-1 border-t border-slate-100">
      Based on {responseCount} responses
    </div>
  </div>
);

export const OrganizerDashboard: React.FC<OrganizerDashboardProps> = ({
  conferences,
  submissions,
  organizerName = 'Conference Organizing Board',
  organizerLogo = 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=150&q=80',
  registrationCountsByConference = {},
  feedbackSummary = { averageScore: 0, responseCount: 0 },
  sponsorshipPackages,
  sponsorshipOpportunities,
  activatedOpportunityKeys,
  onToggleOpportunityPackage,
  sponsorApplicants = [],
  reviewableSponsors = [],
  onReviewSponsor = (_sponsorId: string, _review: { conferenceTitle: string; rating: number; comment: string }) => {},
  onCreateConference,
  onInviteToCommittee = (_reviewerName: string, _conferenceTitle: string) => {},
  onAddNotification = (_notif: { title: string; message: string; type: 'followup'; actionUrl?: string }) => {},
  onNotifySponsors = (_title: string, _message: string) => {},
}) => {
  const [activeTab, setActiveTab] = useState<
    'overview' | 'wizard' | 'abstracts' | 'committee' | 'sponsors' | 'communications' | 'analytics'
  >('overview');

  // Real platform activity for the managed conferences — no fabricated totals.
  const overviewStats = useMemo(() => {
    const conferenceIds = new Set(conferences.map((c) => c.id));
    const totalRegistrations = conferences.reduce(
      (sum, c) => sum + (registrationCountsByConference[c.id] || 0),
      0
    );
    const relevantSubmissions = submissions.filter((s) => conferenceIds.has(s.conferenceId));
    const acceptedSubmissions = relevantSubmissions.filter((s) =>
      ['Accepted', 'Accepted for Oral', 'Accepted for Poster'].includes(s.status)
    ).length;
    const totalReviews = relevantSubmissions.reduce((sum, s) => sum + s.reviews.length, 0);
    const activeOpportunityCount = Object.values(activatedOpportunityKeys).filter(Boolean).length;
    return {
      totalRegistrations,
      submissionsCount: relevantSubmissions.length,
      acceptedSubmissions,
      totalReviews,
      activeSponsorshipPackages: sponsorshipPackages.length + activeOpportunityCount,
    };
  }, [conferences, submissions, registrationCountsByConference, activatedOpportunityKeys, sponsorshipPackages]);

  const [aiMatchLoading, setAiMatchLoading] = useState(false);
  const [aiMatches, setAiMatches] = useState<any[] | null>(null);
  const [aiMatchIsFallback, setAiMatchIsFallback] = useState(false);
  const [selectedSubForAI, setSelectedSubForAI] = useState<AbstractSubmission | null>(null);
  const [invitedReviewerIds, setInvitedReviewerIds] = useState<Record<string, boolean>>({});
  const [invitingReviewerId, setInvitingReviewerId] = useState<string | null>(null);

  // Wizard State
  const [newConfTitle, setNewConfTitle] = useState('');
  const [newConfIndustry, setNewConfIndustry] = useState('Energy & Geosciences');
  const [newConfStartDate, setNewConfStartDate] = useState('2026-10-15');
  const [newConfEndDate, setNewConfEndDate] = useState('2026-10-18');
  const [newConfLocation, setNewConfLocation] = useState('Paris, France');
  const [newConfTracks, setNewConfTracks] = useState('Track 1: Subsurface AI, Track 2: Carbon Storage');
  const [newConfBanner, setNewConfBanner] = useState(
    'https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=1600&q=80'
  );
  const [newConfMainThemes, setNewConfMainThemes] = useState('Subsurface AI, Net Zero Solutions');
  const [wizardPublished, setWizardPublished] = useState(false);

  const [committeeDraft, setCommitteeDraft] = useState({
    name: '',
    title: '',
    org: '',
    committeeRole: 'Technical Committee Member',
  });
  const [newConfCommittee, setNewConfCommittee] = useState<
    Array<{ name: string; title: string; org: string; committeeRole: string }>
  >([]);

  const [speakerDraft, setSpeakerDraft] = useState({ name: '', title: '', org: '', avatar: '', bio: '' });
  const [newConfSpeakers, setNewConfSpeakers] = useState<
    Array<{ name: string; title: string; org: string; avatar: string; bio: string }>
  >([]);

  const [programItemDraft, setProgramItemDraft] = useState({
    type: 'Technical Session',
    title: '',
    date: newConfStartDate,
    time: '09:00',
  });
  const [newConfProgramItems, setNewConfProgramItems] = useState<
    Array<{ type: string; title: string; date: string; time: string }>
  >([]);

  const handleAddCommitteeMember = () => {
    if (!committeeDraft.name.trim()) return;
    setNewConfCommittee((prev) => [...prev, committeeDraft]);
    setCommitteeDraft({ name: '', title: '', org: '', committeeRole: 'Technical Committee Member' });
  };

  const handleRemoveCommitteeMember = (idx: number) => {
    setNewConfCommittee((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleAddSpeaker = () => {
    if (!speakerDraft.name.trim()) return;
    setNewConfSpeakers((prev) => [...prev, speakerDraft]);
    setSpeakerDraft({ name: '', title: '', org: '', avatar: '', bio: '' });
  };

  const handleRemoveSpeaker = (idx: number) => {
    setNewConfSpeakers((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleAddProgramItem = () => {
    if (!programItemDraft.title.trim()) return;
    setNewConfProgramItems((prev) => [...prev, programItemDraft]);
    setProgramItemDraft({ type: programItemDraft.type, title: '', date: programItemDraft.date, time: '09:00' });
  };

  const handleRemoveProgramItem = (idx: number) => {
    setNewConfProgramItems((prev) => prev.filter((_, i) => i !== idx));
  };

  // Technical Committee Tab State
  const committeeRoster = useMemo(() => {
    const byName = new Map<
      string,
      {
        name: string;
        title: string;
        org: string;
        avatar: string;
        roles: Set<string>;
        participationCount: number;
        tracks: Set<string>;
      }
    >();

    (conferences || []).forEach((conf) => {
      (conf.committee || []).forEach((member) => {
        const existing = byName.get(member.name);
        if (existing) {
          existing.roles.add(member.committeeRole);
          existing.participationCount += 1;
          if (member.track) existing.tracks.add(member.track);
        } else {
          byName.set(member.name, {
            name: member.name,
            title: member.title,
            org: member.org,
            avatar: member.avatar,
            roles: new Set([member.committeeRole]),
            participationCount: 1,
            tracks: new Set(member.track ? [member.track] : []),
          });
        }
      });
    });

    return Array.from(byName.values()).sort((a, b) => b.participationCount - a.participationCount);
  }, [conferences]);

  const [committeeMatchLoading, setCommitteeMatchLoading] = useState(false);
  const [committeeMatches, setCommitteeMatches] = useState<
    Array<{ reviewerId: string; matchPercentage: number; reason: string }> | null
  >(null);
  const [committeeMatchIsFallback, setCommitteeMatchIsFallback] = useState(false);
  const [invitedCandidateIds, setInvitedCandidateIds] = useState<Record<string, boolean>>({});
  const [invitingCandidateId, setInvitingCandidateId] = useState<string | null>(null);

  // Real candidates, derived from people who have actually completed peer reviews on
  // the platform — not a fixed cast of fictional names.
  const committeeCandidatePool = useMemo(() => {
    const byReviewer = new Map<
      string,
      { id: string; name: string; title: string; org: string; expertise: string[]; reviewCount: number }
    >();
    submissions.forEach((sub) => {
      sub.reviews.forEach((r) => {
        const existing = byReviewer.get(r.reviewerId);
        if (existing) {
          existing.reviewCount += 1;
          if (sub.topic && !existing.expertise.includes(sub.topic)) existing.expertise.push(sub.topic);
        } else {
          byReviewer.set(r.reviewerId, {
            id: r.reviewerId,
            name: r.reviewerName,
            title: 'Peer Reviewer',
            org: r.reviewerOrg || 'Independent',
            expertise: sub.topic ? [sub.topic] : [],
            reviewCount: 1,
          });
        }
      });
    });
    return Array.from(byReviewer.values());
  }, [submissions]);

  const handleAINominateCommittee = async () => {
    if (committeeCandidatePool.length === 0) return;
    setCommitteeMatchLoading(true);
    setCommitteeMatches(null);
    setCommitteeMatchIsFallback(false);
    try {
      const res = await fetch('/api/ai/reviewer-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          abstractTitle: 'Technical Committee Nomination',
          abstractKeywords: conferences[0]?.topics || [],
          abstractTopic: conferences[0]?.industry || 'Multidisciplinary Conference Program',
          reviewers: committeeCandidatePool,
        }),
      });
      if (!res.ok) throw new Error('AI match request failed');
      const data = await res.json();
      if (!Array.isArray(data.matches) || data.matches.length === 0) throw new Error('AI returned no matches');
      setCommitteeMatches(data.matches);
    } catch (e) {
      setCommitteeMatchIsFallback(true);
      setCommitteeMatches(
        committeeCandidatePool.map((c, idx) => ({
          reviewerId: c.id,
          matchPercentage: Math.min(98, 95 - idx * 6),
          reason: `${c.reviewCount} completed peer review${c.reviewCount === 1 ? '' : 's'} on Conference Gate${
            c.expertise[0] ? `, including work in ${c.expertise[0]}` : ''
          }.`,
        }))
      );
    } finally {
      setCommitteeMatchLoading(false);
    }
  };

  const handleInviteCandidateToCommittee = async (candidateId: string, candidateName: string) => {
    const conferenceTitle = conferences[0]?.title || 'the conference';
    setInvitingCandidateId(candidateId);
    try {
      await sendMessage(
        candidateId,
        `You've been nominated to join the Technical Committee for ${conferenceTitle}, based on your peer review contributions on Conference Gate. Reply here if you're interested in serving.`
      );
      setInvitedCandidateIds((prev) => ({ ...prev, [candidateId]: true }));
      onInviteToCommittee?.(candidateName, conferenceTitle);
    } catch (e) {
      showToast({
        type: 'info',
        title: "Couldn't send invitation",
        message: e instanceof Error ? e.message : 'Something went wrong. Please try again.',
      });
    } finally {
      setInvitingCandidateId(null);
    }
  };

  const [taskDraft, setTaskDraft] = useState({
    assignee: '',
    title: '',
    description: '',
    dueDate: '',
    priority: 'Medium',
  });
  const [committeeTasks, setCommitteeTasks] = useState<
    Array<{
      id: string;
      assignee: string;
      title: string;
      description: string;
      dueDate: string;
      priority: string;
      status: 'Pending' | 'In Progress' | 'Completed';
    }>
  >([]);

  const handleAssignTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskDraft.assignee || !taskDraft.title.trim()) return;
    setCommitteeTasks((prev) => [
      { id: `task_${Date.now()}`, ...taskDraft, status: 'Pending' },
      ...prev,
    ]);
    setTaskDraft({ assignee: taskDraft.assignee, title: '', description: '', dueDate: '', priority: 'Medium' });
  };

  const handleCycleTaskStatus = (id: string) => {
    const order: Array<'Pending' | 'In Progress' | 'Completed'> = ['Pending', 'In Progress', 'Completed'];
    setCommitteeTasks((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, status: order[(order.indexOf(t.status) + 1) % order.length] } : t
      )
    );
  };

  const [followUpDraft, setFollowUpDraft] = useState({
    from: 'Conference Organizer',
    to: 'Technical Committee Chair',
    message: '',
    sendEmail: true,
  });
  const [committeeFollowUps, setCommitteeFollowUps] = useState<
    Array<{ id: string; from: string; to: string; message: string; date: string; sendEmail: boolean }>
  >([]);
  const [expandedEmailId, setExpandedEmailId] = useState<string | null>(null);

  const followUpRecipientEmail = (to: string) =>
    `${to.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '')}@conferencegate.app`;

  const handleSendFollowUp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!followUpDraft.message.trim()) return;
    const id = `fu_${Date.now()}`;
    setCommitteeFollowUps((prev) => [
      { id, ...followUpDraft, date: new Date().toLocaleString() },
      ...prev,
    ]);
    // In-app notification is always sent — it's the source of truth for delivery in Conference Gate.
    onAddNotification({
      title: `Follow-Up from ${followUpDraft.from}`,
      message: followUpDraft.message,
      type: 'followup',
    });
    setExpandedEmailId(followUpDraft.sendEmail ? id : null);
    setFollowUpDraft({ ...followUpDraft, message: '' });
  };

  // World Clock timezones offered when scheduling a cross-border committee meeting
  const MEETING_TIMEZONES = [
    { id: 'UTC', label: 'UTC — Coordinated Universal Time', offset: 0 },
    { id: 'America/Los_Angeles', label: 'US Pacific — Los Angeles', offset: -8 },
    { id: 'America/New_York', label: 'US Eastern — New York', offset: -5 },
    { id: 'Europe/London', label: 'UK — London', offset: 0 },
    { id: 'Europe/Berlin', label: 'Central Europe — Berlin / Vienna', offset: 1 },
    { id: 'Asia/Dubai', label: 'Gulf Standard Time — Dubai / Abu Dhabi', offset: 4 },
    { id: 'Asia/Singapore', label: 'Singapore / Kuala Lumpur', offset: 8 },
    { id: 'Asia/Tokyo', label: 'Japan — Tokyo', offset: 9 },
    { id: 'Australia/Sydney', label: 'Australia Eastern — Sydney', offset: 11 },
  ];

  const [meetingDraft, setMeetingDraft] = useState<{
    title: string;
    attendees: string[];
    date: string;
    time: string;
    organizerTimezone: string;
    meetingLink: string;
  }>({
    title: '',
    attendees: [],
    date: '',
    time: '',
    organizerTimezone: 'Europe/London',
    meetingLink: '',
  });
  const [scheduledMeetings, setScheduledMeetings] = useState<
    Array<{
      id: string;
      title: string;
      attendees: string[];
      date: string;
      time: string;
      organizerTimezone: string;
      meetingLink: string;
    }>
  >([]);

  const toggleMeetingAttendee = (name: string) => {
    setMeetingDraft((prev) => ({
      ...prev,
      attendees: prev.attendees.includes(name)
        ? prev.attendees.filter((n) => n !== name)
        : [...prev.attendees, name],
    }));
  };

  const [attendeeDropdownOpen, setAttendeeDropdownOpen] = useState(false);
  const attendeeDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!attendeeDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (attendeeDropdownRef.current && !attendeeDropdownRef.current.contains(e.target as Node)) {
        setAttendeeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [attendeeDropdownOpen]);

  const worldClockPreview = useMemo(() => {
    if (!meetingDraft.date || !meetingDraft.time) return [];
    const organizerTz = MEETING_TIMEZONES.find((z) => z.id === meetingDraft.organizerTimezone);
    if (!organizerTz) return [];
    const [year, month, day] = meetingDraft.date.split('-').map(Number);
    const [hour, minute] = meetingDraft.time.split(':').map(Number);
    const utcMs = Date.UTC(year, month - 1, day, hour - organizerTz.offset, minute);
    return MEETING_TIMEZONES.map((zone) => {
      const localMs = utcMs + zone.offset * 60 * 60 * 1000;
      const local = new Date(localMs);
      return {
        id: zone.id,
        label: zone.label,
        time: local.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }),
        date: local.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }),
      };
    });
  }, [meetingDraft.date, meetingDraft.time, meetingDraft.organizerTimezone]);

  const handleScheduleMeeting = (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !meetingDraft.title.trim() ||
      !meetingDraft.date ||
      !meetingDraft.time ||
      !meetingDraft.meetingLink.trim() ||
      meetingDraft.attendees.length === 0
    )
      return;
    setScheduledMeetings((prev) => [
      {
        id: `mtg_${Date.now()}`,
        ...meetingDraft,
      },
      ...prev,
    ]);
    setMeetingDraft({
      title: '',
      attendees: [],
      date: '',
      time: '',
      organizerTimezone: meetingDraft.organizerTimezone,
      meetingLink: '',
    });
  };

  // Sponsorship Opportunities Catalog State
  const sponsorshipOpportunityColors: Record<
    string,
    { header: string; iconBox: string; icon: string; border: string; price: string; badge: string }
  > = {
    violet: {
      header: 'bg-violet-50',
      iconBox: 'bg-white border border-violet-200',
      icon: 'text-violet-700',
      border: 'border-violet-100',
      price: 'text-violet-700',
      badge: 'bg-violet-100 text-violet-800',
    },
    blue: {
      header: 'bg-blue-50',
      iconBox: 'bg-white border border-blue-200',
      icon: 'text-blue-700',
      border: 'border-blue-100',
      price: 'text-blue-700',
      badge: 'bg-blue-100 text-blue-800',
    },
    indigo: {
      header: 'bg-indigo-50',
      iconBox: 'bg-white border border-indigo-200',
      icon: 'text-indigo-700',
      border: 'border-indigo-100',
      price: 'text-indigo-700',
      badge: 'bg-indigo-100 text-indigo-800',
    },
    sky: {
      header: 'bg-sky-50',
      iconBox: 'bg-white border border-sky-200',
      icon: 'text-sky-700',
      border: 'border-sky-100',
      price: 'text-sky-700',
      badge: 'bg-sky-100 text-sky-800',
    },
    emerald: {
      header: 'bg-emerald-50',
      iconBox: 'bg-white border border-emerald-200',
      icon: 'text-emerald-700',
      border: 'border-emerald-100',
      price: 'text-emerald-700',
      badge: 'bg-emerald-100 text-emerald-800',
    },
    amber: {
      header: 'bg-amber-50',
      iconBox: 'bg-white border border-amber-200',
      icon: 'text-amber-700',
      border: 'border-amber-100',
      price: 'text-amber-700',
      badge: 'bg-amber-100 text-amber-800',
    },
    teal: {
      header: 'bg-teal-50',
      iconBox: 'bg-white border border-teal-200',
      icon: 'text-teal-700',
      border: 'border-teal-100',
      price: 'text-teal-700',
      badge: 'bg-teal-100 text-teal-800',
    },
    rose: {
      header: 'bg-rose-50',
      iconBox: 'bg-white border border-rose-200',
      icon: 'text-rose-700',
      border: 'border-rose-100',
      price: 'text-rose-700',
      badge: 'bg-rose-100 text-rose-800',
    },
    fuchsia: {
      header: 'bg-fuchsia-50',
      iconBox: 'bg-white border border-fuchsia-200',
      icon: 'text-fuchsia-700',
      border: 'border-fuchsia-100',
      price: 'text-fuchsia-700',
      badge: 'bg-fuchsia-100 text-fuchsia-800',
    },
  };

  const sponsorshipOpportunityIcons: Record<string, React.ElementType> = {
    violet: Wine,
    blue: Presentation,
    indigo: GraduationCap,
    sky: Snowflake,
    emerald: Bus,
    amber: Landmark,
    teal: UtensilsCrossed,
    rose: Utensils,
    fuchsia: Gift,
  };

  const verifiedSponsorCount = sponsorApplicants.filter((s) => isSponsorVerified(s)).length;
  const [notifiedOpportunityKeys, setNotifiedOpportunityKeys] = useState<Record<string, string>>({});
  const [approvedApplicantIds, setApprovedApplicantIds] = useState<Record<string, boolean>>({});
  const { showToast } = useToast();

  const handleApproveApplicant = (applicant: SponsorProfile) => {
    setApprovedApplicantIds((prev) => ({ ...prev, [applicant.id]: true }));
    onNotifySponsors(
      'Sponsorship Registration Approved',
      `${applicant.companyName}'s registration has been approved by the organizing committee.`
    );
    showToast({
      type: 'success',
      title: 'Registration approved',
      message: `${applicant.companyName} has been notified and approved for sponsorship.`,
    });
  };

  const handleNotifyVerifiedSponsors = (opportunityName: string, pkgTier: string, price: number, key: string) => {
    onNotifySponsors(
      `New Sponsorship Opportunity: ${opportunityName}`,
      `${pkgTier} package now available for $${price.toLocaleString()}. Apply in the Sponsor Marketplace before slots fill up.`
    );
    setNotifiedOpportunityKeys((prev) => ({ ...prev, [key]: new Date().toLocaleString() }));
  };

  // Sponsor Feedback / Review State
  const [sponsorReviewDraft, setSponsorReviewDraft] = useState({
    sponsorId: reviewableSponsors[0]?.id || '',
    conferenceTitle: conferences[0]?.title || '',
    rating: 0,
    comment: '',
  });
  const [sponsorReviewsSent, setSponsorReviewsSent] = useState<
    Array<{ id: string; sponsorName: string; conferenceTitle: string; rating: number; comment: string; date: string }>
  >([]);

  const handleSubmitSponsorReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sponsorReviewDraft.sponsorId || !sponsorReviewDraft.rating || !sponsorReviewDraft.comment.trim()) return;
    const sponsor = reviewableSponsors.find((s) => s.id === sponsorReviewDraft.sponsorId);
    if (!sponsor) return;
    onReviewSponsor(sponsorReviewDraft.sponsorId, {
      conferenceTitle: sponsorReviewDraft.conferenceTitle,
      rating: sponsorReviewDraft.rating,
      comment: sponsorReviewDraft.comment,
    });
    setSponsorReviewsSent((prev) => [
      {
        id: `sr_${Date.now()}`,
        sponsorName: sponsor.companyName,
        conferenceTitle: sponsorReviewDraft.conferenceTitle,
        rating: sponsorReviewDraft.rating,
        comment: sponsorReviewDraft.comment,
        date: new Date().toLocaleString(),
      },
      ...prev,
    ]);
    setSponsorReviewDraft((prev) => ({ ...prev, rating: 0, comment: '' }));
  };

  // Event Analytics Data — derived entirely from real submissions, registrations, and feedback.
  const relevantSubmissions = useMemo(() => {
    const conferenceIds = new Set(conferences.map((c) => c.id));
    return submissions.filter((s) => conferenceIds.has(s.conferenceId));
  }, [conferences, submissions]);

  const sessionsByTrack = useMemo(() => {
    const byTrack = new Map<string, { oral: number; poster: number }>();
    relevantSubmissions
      .filter((s) => ['Accepted', 'Accepted for Oral', 'Accepted for Poster'].includes(s.status))
      .forEach((s) => {
        const track = s.track || 'Unassigned Track';
        const existing = byTrack.get(track) || { oral: 0, poster: 0 };
        if (s.preferredType === 'Poster') existing.poster += 1;
        else existing.oral += 1;
        byTrack.set(track, existing);
      });
    return Array.from(byTrack.entries()).map(([track, counts]) => ({ track, ...counts }));
  }, [relevantSubmissions]);

  const totalOralSessions = sessionsByTrack.reduce((sum, t) => sum + t.oral, 0);
  const totalPosterSessions = sessionsByTrack.reduce((sum, t) => sum + t.poster, 0);
  const maxSessionsInTrack = Math.max(1, ...sessionsByTrack.map((t) => t.oral + t.poster));

  const submissionStatusBreakdown = useMemo(() => {
    const buckets = {
      Accepted: ['Accepted', 'Accepted for Oral', 'Accepted for Poster'],
      'Under Review': ['Draft', 'Submitted', 'Initial Screening', 'Awaiting Reviewer Assignment', 'Reviewer Invited', 'Reviewer Accepted', 'Under Review'],
      'Revision Requested': ['Revision Requested', 'Revised Abstract Submitted'],
      Rejected: ['Rejected'],
      Withdrawn: ['Withdrawn'],
    };
    const colors: Record<string, string> = {
      Accepted: CHART_HEX.emerald,
      'Under Review': CHART_HEX.blue,
      'Revision Requested': CHART_HEX.amber,
      Rejected: CHART_HEX.rose,
      Withdrawn: CHART_HEX.slate,
    };
    return Object.entries(buckets)
      .map(([label, statuses]) => ({
        label,
        value: relevantSubmissions.filter((s) => (statuses as string[]).includes(s.status)).length,
        color: colors[label],
      }))
      .filter((b) => b.value > 0);
  }, [relevantSubmissions]);
  const totalSubmissions = relevantSubmissions.length;

  const registrationsByConference = conferences
    .map((c) => ({ title: c.title, count: registrationCountsByConference[c.id] || 0 }))
    .filter((c) => c.count > 0);
  const maxRegistrationsByConference = Math.max(1, ...registrationsByConference.map((c) => c.count));

  const sponsorRevenueByTier = sponsorshipPackages.map((pkg) => ({
    tier: pkg.tier,
    revenue: pkg.price * (pkg.totalSlots - pkg.availableSlots),
    sold: pkg.totalSlots - pkg.availableSlots,
    total: pkg.totalSlots,
  }));
  const maxSponsorRevenue = Math.max(1, ...sponsorRevenueByTier.map((s) => s.revenue));
  const totalSponsorRevenueRealized = sponsorRevenueByTier.reduce((sum, s) => sum + s.revenue, 0);

  // Communications Broadcast State
  const [recipientGroup, setRecipientGroup] = useState('All Attendees');
  const [broadcastSubject, setBroadcastSubject] = useState('');
  const [broadcastBody, setBroadcastBody] = useState('');
  const [broadcastSent, setBroadcastSent] = useState(false);
  const [broadcastSending, setBroadcastSending] = useState(false);
  const [broadcastHistory, setBroadcastHistory] = useState<OrganizerBroadcast[]>([]);

  useEffect(() => {
    fetchMyBroadcasts().then(setBroadcastHistory).catch(() => {});
  }, []);

  const handleAIMatchReviewers = async (sub: AbstractSubmission) => {
    setSelectedSubForAI(sub);
    setAiMatchLoading(true);
    setAiMatchIsFallback(false);

    // Real candidates, drawn from people who have already completed peer reviews on the
    // platform — excludes the submission's own author.
    const candidatePool = committeeCandidatePool.filter((c) => c.name !== sub.primaryAuthor.name);

    if (candidatePool.length === 0) {
      setAiMatches([]);
      setAiMatchLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/ai/reviewer-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          abstractTitle: sub.title,
          abstractKeywords: sub.keywords,
          abstractTopic: sub.topic,
          reviewers: candidatePool,
        }),
      });
      if (!res.ok) throw new Error('AI match request failed');
      const data = await res.json();
      if (!Array.isArray(data.matches) || data.matches.length === 0) throw new Error('AI returned no matches');
      setAiMatches(data.matches);
    } catch (e) {
      setAiMatchIsFallback(true);
      setAiMatches(
        candidatePool.map((c, idx) => ({
          reviewerId: c.id,
          matchPercentage: Math.min(97, 94 - idx * 5),
          reason: `${c.reviewCount} completed peer review${c.reviewCount === 1 ? '' : 's'} on Conference Gate${
            c.expertise[0] ? `, including work in ${c.expertise[0]}` : ''
          }.`,
        }))
      );
    } finally {
      setAiMatchLoading(false);
    }
  };

  const handleInviteReviewerToAbstract = async (candidateId: string, candidateName: string, submissionTitle: string) => {
    setInvitingReviewerId(candidateId);
    try {
      await sendMessage(
        candidateId,
        `You've been suggested as a reviewer for the abstract "${submissionTitle}" on Conference Gate. Reply here if you're available to review it.`
      );
      setInvitedReviewerIds((prev) => ({ ...prev, [candidateId]: true }));
      showToast({
        type: 'success',
        title: 'Invitation sent',
        message: `${candidateName} has been messaged about reviewing this abstract.`,
      });
    } catch (e) {
      showToast({
        type: 'info',
        title: "Couldn't send invitation",
        message: e instanceof Error ? e.message : 'Something went wrong. Please try again.',
      });
    } finally {
      setInvitingReviewerId(null);
    }
  };

  const buildAgendaDaysFromProgramItems = () => {
    const byDate = new Map<string, typeof newConfProgramItems>();
    newConfProgramItems.forEach((item) => {
      byDate.set(item.date, [...(byDate.get(item.date) || []), item]);
    });

    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, items]) => ({
        date,
        dayName: date
          ? new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long' })
          : '',
        sessions: [...items]
          .sort((a, b) => a.time.localeCompare(b.time))
          .map((item, idx) => ({
            id: `sess_${date}_${idx}`,
            time: item.time,
            title: item.title,
            hall: item.type === 'Technical Session' ? 'Main Hall' : item.type,
            speakerName: '',
            speakerTitle: '',
            speakerAvatar: '',
            track: item.type,
          })),
      }));
  };

  const handleWizardSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const locationParts = newConfLocation.split(',').map((s) => s.trim());
    const city = locationParts[0] || 'TBD';
    const countryRaw = locationParts[1] || 'TBD';
    const venueMatch = countryRaw.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    const country = venueMatch ? venueMatch[1].trim() : countryRaw;
    const venue = venueMatch ? venueMatch[2].trim() : 'Venue TBD';
    onCreateConference({
      title: newConfTitle || 'International Energy & Subsurface Congress 2026',
      organizerName,
      organizerLogo,
      banner: newConfBanner || 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=1200&q=80',
      logo: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=200&q=80',
      description: 'Newly created international congress focusing on energy transition, geosciences, and subsurface AI.',
      industry: newConfIndustry,
      topics: ['Energy', 'Geosciences', 'Subsurface AI'],
      tracks: newConfTracks.split(',').map((t) => t.trim()),
      location: { city, country, venue },
      dates: { start: newConfStartDate, end: newConfEndDate },
      format: 'Hybrid',
      priceRange: '$300 - $900',
      registrationPackages: [],
      earlyBirdDeadline: '2026-08-30',
      abstractDeadline: '2026-07-31',
      cfpStatus: 'Open',
      recommendationScore: 94,
      attendeeCount: 150,
      networkAttendeesCount: 12,
      mainThemes: newConfMainThemes.split(',').map((t) => t.trim()).filter(Boolean),
      agendaDays: buildAgendaDaysFromProgramItems(),
      speakers: newConfSpeakers.map((sp, idx) => ({
        id: `spk_${Date.now()}_${idx}`,
        name: sp.name,
        title: sp.title,
        org: sp.org,
        avatar: sp.avatar || 'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?auto=format&fit=crop&w=200&q=80',
        role: 'Speaker',
        bio: sp.bio,
        interests: [],
      })),
      committee: newConfCommittee.map((member, idx) => ({
        id: `com_${Date.now()}_${idx}`,
        name: member.name,
        title: member.title,
        org: member.org,
        avatar: 'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?auto=format&fit=crop&w=200&q=80',
        committeeRole: member.committeeRole,
      })),
      sponsors: [],
      exhibitors: [],
      accommodation: 'Partner Hotel Paris ($150/night).',
      travelInfo: 'Charles de Gaulle Airport (CDG).',
      communityPosts: 0,
    });

    setWizardPublished(true);
    setTimeout(() => {
      setWizardPublished(false);
      setActiveTab('overview');
    }, 2000);
  };

  const handleBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastSubject.trim() || !broadcastBody.trim() || broadcastSending) return;
    setBroadcastSending(true);
    try {
      const broadcast = await sendBroadcast(recipientGroup, broadcastSubject.trim(), broadcastBody.trim());
      setBroadcastHistory((prev) => [broadcast, ...prev]);
      setBroadcastSent(true);
      setBroadcastSubject('');
      setBroadcastBody('');
      setTimeout(() => setBroadcastSent(false), 4000);
    } catch (err: any) {
      showToast({ type: 'info', title: 'Broadcast not saved', message: err.message || 'Please try again.' });
    } finally {
      setBroadcastSending(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Top Dashboard Header */}
      <div className="bg-blue-50 text-slate-900 rounded-3xl p-6 sm:p-8 shadow-xs border border-blue-100">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 bg-white text-blue-700 border border-blue-200 rounded-full text-xs font-bold uppercase tracking-wider">
                Organizer Dashboard
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
              Organizer Operations & Lifecycle Hub
            </h1>
            <p className="text-xs text-slate-600">
              Manage event setup, registrations, abstract peer review, committee invitations, program agenda, and sponsor packages.
            </p>
          </div>

          <button
            onClick={() => setActiveTab('wizard')}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-md flex items-center gap-2 transition-colors cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Create New Conference Wizard</span>
          </button>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="bg-white rounded-2xl border border-slate-200 p-2 flex gap-2 overflow-x-auto text-xs font-semibold text-slate-600">
        {[
          { id: 'overview', label: 'Dashboard Overview' },
          { id: 'wizard', label: 'Conference Wizard' },
          { id: 'abstracts', label: `Abstracts & AI Matcher (${submissions.length})` },
          { id: 'committee', label: 'Technical Committee' },
          { id: 'sponsors', label: `Sponsorship Packages (${sponsorshipPackages.length})` },
          { id: 'communications', label: 'Communications Hub' },
          { id: 'analytics', label: 'Event Analytics' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-2.5 rounded-xl transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-blue-600 text-white font-bold shadow-xs'
                : 'hover:bg-slate-100 text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 1: Overview KPIs */}
      {activeTab === 'overview' && (
        <div className="space-y-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="p-6 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-1">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Registrations</div>
              <div className="text-2xl font-extrabold text-slate-900">{overviewStats.totalRegistrations} Delegates</div>
              <div className="text-[11px] font-semibold text-slate-500">Across all managed conferences</div>
            </div>

            <div className="p-6 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-1">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Abstract Submissions</div>
              <div className="text-2xl font-extrabold text-slate-900">{overviewStats.submissionsCount} Submissions</div>
              <div className="text-[11px] font-semibold text-emerald-600">{overviewStats.acceptedSubmissions} Accepted</div>
            </div>

            <div className="p-6 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-1">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Peer Reviews Completed</div>
              <div className="text-2xl font-extrabold text-blue-700">{overviewStats.totalReviews}</div>
              <div className="text-[11px] font-semibold text-blue-600">Across all submissions</div>
            </div>

            <div className="p-6 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-1">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Sponsorship Packages</div>
              <div className="text-2xl font-extrabold text-blue-600">{overviewStats.activeSponsorshipPackages}</div>
              <div className="text-[11px] font-semibold text-slate-500">Standard + activated add-ons</div>
            </div>
          </div>

          {/* Managed Conferences List */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 space-y-4 shadow-xs">
            <h3 className="text-base font-bold text-slate-900">Managed Conferences</h3>
            <div className="space-y-4">
              {(conferences || []).map((conf) => (
                <div key={conf.id} className="p-5 bg-slate-50 rounded-2xl border border-slate-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <img src={conf.logo} alt={conf.title} className="w-12 h-12 rounded-xl object-cover" />
                    <div>
                      <h4 className="font-bold text-sm text-slate-900">{conf.title}</h4>
                      <div className="text-xs text-slate-500 font-medium">
                        {formatDate(conf.dates.start)} • {conf.location.city}, {conf.location.country}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="px-3 py-1 bg-emerald-100 text-emerald-800 text-xs font-bold rounded-full">
                      CFP: {conf.cfpStatus}
                    </span>
                    <button
                      onClick={() => setActiveTab('abstracts')}
                      className="px-4 py-2 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer"
                    >
                      Manage Abstracts
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Create Conference Wizard */}
      {activeTab === 'wizard' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-6 max-w-3xl mx-auto">
          <div className="pb-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-bold uppercase text-blue-600">
                Steps 1–7 · Complete in One Page
              </span>
              <h2 className="text-xl font-bold text-slate-900">Create Conference Wizard</h2>
            </div>
            <span className="text-xs text-slate-400 font-semibold">Fast Setup Engine</span>
          </div>

          <form onSubmit={handleWizardSubmit} className="space-y-6 text-xs text-slate-800">
            {/* Step 1: Basic Information */}
            <div className="space-y-4">
              <h3 className="font-bold text-slate-900 text-sm">Step 1: Conference Title & Industry</h3>
              <div className="space-y-1.5">
                <label className="font-bold uppercase text-[10px] text-slate-500">Conference Name *</label>
                <input
                  type="text"
                  required
                  value={newConfTitle}
                  onChange={(e) => setNewConfTitle(e.target.value)}
                  placeholder="e.g. International Energy & Subsurface AI Congress 2026"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-medium focus:outline-hidden"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-bold uppercase text-[10px] text-slate-500">Industry / Sector</label>
                <select
                  value={newConfIndustry}
                  onChange={(e) => setNewConfIndustry(e.target.value)}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                >
                  <option value="Energy & Geosciences">Energy & Geosciences</option>
                  <option value="Artificial Intelligence">Artificial Intelligence & Tech</option>
                  <option value="Petroleum & Mining">Petroleum & Mining</option>
                  <option value="Healthcare & Physics">Healthcare & Physics</option>
                </select>
              </div>
            </div>

            {/* Step 2: Dates & Location */}
            <div className="space-y-4 pt-4 border-t border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm">Step 2: Dates & Venue Location</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="font-bold uppercase text-[10px] text-slate-500">Start Date</label>
                  <input
                    type="date"
                    value={newConfStartDate}
                    onChange={(e) => setNewConfStartDate(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="font-bold uppercase text-[10px] text-slate-500">End Date</label>
                  <input
                    type="date"
                    value={newConfEndDate}
                    onChange={(e) => setNewConfEndDate(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="font-bold uppercase text-[10px] text-slate-500">Venue & City</label>
                <input
                  type="text"
                  value={newConfLocation}
                  onChange={(e) => setNewConfLocation(e.target.value)}
                  placeholder="Paris, France (Palais des Congrès)"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                />
              </div>
            </div>

            {/* Step 3: Tracks & Themes */}
            <div className="space-y-4 pt-4 border-t border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm">Step 3: Scientific Tracks</h3>
              <div className="space-y-1.5">
                <label className="font-bold uppercase text-[10px] text-slate-500">Scientific Tracks (Comma separated)</label>
                <input
                  type="text"
                  value={newConfTracks}
                  onChange={(e) => setNewConfTracks(e.target.value)}
                  placeholder="Track 1: Subsurface AI, Track 2: Organic Geochemistry"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                />
              </div>
            </div>

            {/* Step 4: Conference Cover Image */}
            <div className="space-y-4 pt-4 border-t border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                <ImageIcon className="w-4 h-4 text-blue-600" />
                Step 4: Conference Cover Image
              </h3>
              <div className="space-y-1.5">
                <label className="font-bold uppercase text-[10px] text-slate-500">High-Resolution Banner Image URL</label>
                <input
                  type="url"
                  value={newConfBanner}
                  onChange={(e) => setNewConfBanner(e.target.value)}
                  placeholder="https://images.unsplash.com/..."
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-medium focus:outline-hidden"
                />
              </div>
              {newConfBanner && (
                <div
                  className="h-40 rounded-2xl border border-slate-200 bg-slate-100 bg-cover bg-center relative overflow-hidden"
                  style={{ backgroundImage: `url(${newConfBanner})` }}
                >
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-transparent" />
                  <span className="absolute bottom-3 left-4 text-white text-sm font-bold drop-shadow-sm">
                    {newConfTitle || 'Conference Cover Preview'}
                  </span>
                </div>
              )}
            </div>

            {/* Step 5: Technical Committee */}
            <div className="space-y-4 pt-4 border-t border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                <Users className="w-4 h-4 text-blue-600" />
                Step 5: Approved Technical Committee
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Full Name"
                  value={committeeDraft.name}
                  onChange={(e) => setCommitteeDraft({ ...committeeDraft, name: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                />
                <input
                  type="text"
                  placeholder="Title (e.g. Professor)"
                  value={committeeDraft.title}
                  onChange={(e) => setCommitteeDraft({ ...committeeDraft, title: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                />
                <input
                  type="text"
                  placeholder="Organization"
                  value={committeeDraft.org}
                  onChange={(e) => setCommitteeDraft({ ...committeeDraft, org: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                />
                <select
                  value={committeeDraft.committeeRole}
                  onChange={(e) => setCommitteeDraft({ ...committeeDraft, committeeRole: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                >
                  <option>Technical Committee Chair</option>
                  <option>Technical Committee Member</option>
                  <option>Session Chair</option>
                  <option>Scientific Advisor</option>
                </select>
              </div>
              <button
                type="button"
                onClick={handleAddCommitteeMember}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Add Committee Member</span>
              </button>

              {newConfCommittee.length > 0 && (
                <div className="space-y-2">
                  {newConfCommittee.map((member, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200"
                    >
                      <div>
                        <div className="font-bold text-slate-900">{member.name}</div>
                        <div className="text-[11px] text-slate-500">
                          {[member.title, member.org].filter(Boolean).join(', ')}
                          {(member.title || member.org) && ' · '}
                          {member.committeeRole}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveCommitteeMember(idx)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg cursor-pointer shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Step 6: Technical Program & Agenda Builder */}
            <div className="space-y-4 pt-4 border-t border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-blue-600" />
                Step 6: Technical Program & Agenda Builder
              </h3>
              <div className="space-y-1.5">
                <label className="font-bold uppercase text-[10px] text-slate-500">Main Topics (Comma separated)</label>
                <input
                  type="text"
                  value={newConfMainThemes}
                  onChange={(e) => setNewConfMainThemes(e.target.value)}
                  placeholder="e.g. Subsurface AI, Net Zero Solutions, Carbon Storage"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                />
              </div>

              <div className="space-y-1.5 pt-2">
                <label className="font-bold uppercase text-[10px] text-slate-500">
                  Program Schedule — Sessions, Field Trips & Social Events
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <select
                    value={programItemDraft.type}
                    onChange={(e) => setProgramItemDraft({ ...programItemDraft, type: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium sm:col-span-1"
                  >
                    <option>Technical Session</option>
                    <option>Field Trip</option>
                    <option>Ice Breaker</option>
                    <option>Lunch</option>
                    <option>Gala Dinner</option>
                  </select>
                  <input
                    type="text"
                    placeholder={
                      programItemDraft.type === 'Field Trip'
                        ? 'e.g. Offshore Rig Field Trip (Subsurface AI Track)'
                        : 'e.g. Keynote: Net Zero Solutions'
                    }
                    value={programItemDraft.title}
                    onChange={(e) => setProgramItemDraft({ ...programItemDraft, title: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium sm:col-span-2"
                  />
                  <input
                    type="date"
                    value={programItemDraft.date}
                    onChange={(e) => setProgramItemDraft({ ...programItemDraft, date: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                  />
                  <input
                    type="time"
                    value={programItemDraft.time}
                    onChange={(e) => setProgramItemDraft({ ...programItemDraft, time: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAddProgramItem}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add to Program</span>
                </button>

                {newConfProgramItems.length > 0 && (
                  <div className="space-y-2">
                    {[...newConfProgramItems]
                      .map((item, originalIdx) => ({ item, originalIdx }))
                      .sort(
                        (a, b) =>
                          a.item.date.localeCompare(b.item.date) || a.item.time.localeCompare(b.item.time)
                      )
                      .map(({ item, originalIdx }) => (
                        <div
                          key={originalIdx}
                          className="flex items-center justify-between gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200"
                        >
                          <div className="flex items-center gap-3">
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-blue-50 text-blue-700 border border-blue-200 shrink-0">
                              {item.type}
                            </span>
                            <div>
                              <div className="font-bold text-slate-900">{item.title}</div>
                              <div className="text-[11px] text-slate-500">
                                {item.date || 'No date'} · {item.time || 'No time'}
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveProgramItem(originalIdx)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg cursor-pointer shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>

            {/* Step 7: Speakers & Biographies */}
            <div className="space-y-4 pt-4 border-t border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                <Mic className="w-4 h-4 text-blue-600" />
                Step 7: Speakers & Biographies
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Full Name"
                  value={speakerDraft.name}
                  onChange={(e) => setSpeakerDraft({ ...speakerDraft, name: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                />
                <input
                  type="text"
                  placeholder="Title (e.g. Keynote Speaker)"
                  value={speakerDraft.title}
                  onChange={(e) => setSpeakerDraft({ ...speakerDraft, title: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                />
                <input
                  type="text"
                  placeholder="Organization"
                  value={speakerDraft.org}
                  onChange={(e) => setSpeakerDraft({ ...speakerDraft, org: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                />
                <input
                  type="url"
                  placeholder="Speaker Photo URL"
                  value={speakerDraft.avatar}
                  onChange={(e) => setSpeakerDraft({ ...speakerDraft, avatar: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                />
              </div>
              <textarea
                rows={2}
                placeholder="Speaker biography..."
                value={speakerDraft.bio}
                onChange={(e) => setSpeakerDraft({ ...speakerDraft, bio: e.target.value })}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-medium"
              ></textarea>
              <button
                type="button"
                onClick={handleAddSpeaker}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Add Speaker</span>
              </button>

              {newConfSpeakers.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {newConfSpeakers.map((sp, idx) => (
                    <div key={idx} className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                      <img
                        src={
                          sp.avatar ||
                          'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?auto=format&fit=crop&w=100&q=80'
                        }
                        alt={sp.name}
                        className="w-12 h-12 rounded-xl object-cover shrink-0 ring-1 ring-slate-200"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-slate-900">{sp.name}</div>
                        <div className="text-[11px] text-slate-500">
                          {[sp.title, sp.org].filter(Boolean).join(', ')}
                        </div>
                        {sp.bio && (
                          <p className="text-[11px] text-slate-600 mt-1 line-clamp-2">{sp.bio}</p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveSpeaker(idx)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg cursor-pointer shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {wizardPublished && (
              <div className="p-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl font-bold flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <span>Conference Published Successfully to Conference Gate Repository!</span>
              </div>
            )}

            <div className="pt-4 border-t border-slate-200 flex justify-end">
              <button
                type="submit"
                className="px-6 py-3 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-md transition-colors cursor-pointer"
              >
                Publish Conference & Open Call for Papers
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tab 3: Abstract Management & AI Reviewer Matcher */}
      {activeTab === 'abstracts' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-2">
            <h2 className="text-lg font-bold text-slate-900">Abstract Submissions & AI Reviewer Allocation</h2>
            <p className="text-xs text-slate-500">
              Manage incoming research submissions, assign accredited peer reviewers using AI subject-matter matching, and issue final decisions.
            </p>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-slate-50 border-b border-slate-200 uppercase font-bold text-[10px] text-slate-500">
                  <tr>
                    <th className="p-4">Abstract Title</th>
                    <th className="p-4">Author</th>
                    <th className="p-4">Track</th>
                    <th className="p-4">Status</th>
                    <th className="p-4">AI Reviewer Match</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {submissions.map((sub) => (
                    <tr key={sub.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-4 font-bold text-slate-900 max-w-xs">{sub.title}</td>
                      <td className="p-4">{sub.primaryAuthor.name} ({sub.primaryAuthor.affiliation})</td>
                      <td className="p-4">{sub.track}</td>
                      <td className="p-4">
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                          {sub.status}
                        </span>
                      </td>
                      <td className="p-4">
                        <button
                          onClick={() => handleAIMatchReviewers(sub)}
                          className="px-3 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold text-[11px] rounded-lg shadow-xs flex items-center gap-1.5 cursor-pointer"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-blue-300" />
                          <span>AI Match Reviewers</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* AI Matcher Result Modal / Box */}
          {selectedSubForAI && (
            <div className="p-6 bg-white rounded-3xl border border-blue-200 shadow-md space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-blue-600" />
                  <h3 className="font-bold text-sm text-slate-900">
                    Recommended Candidate Reviewers for "{selectedSubForAI.title.substring(0, 45)}..."
                  </h3>
                </div>
                <button
                  onClick={() => setSelectedSubForAI(null)}
                  className="text-xs text-slate-400 hover:text-slate-600 font-bold"
                >
                  Close Match
                </button>
              </div>

              {!aiMatchLoading && aiMatchIsFallback && aiMatches && aiMatches.length > 0 && (
                <div className="px-3 py-2 bg-amber-50 text-amber-800 border border-amber-200 rounded-xl text-[11px] font-semibold flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                  AI matching is unavailable right now — showing candidates ranked by review count instead of a live
                  AI score.
                </div>
              )}

              {aiMatchLoading ? (
                <div className="text-center py-6 text-xs text-slate-500 font-medium">
                  Calculating graph neural match scores against global reviewer pool...
                </div>
              ) : aiMatches && aiMatches.length === 0 ? (
                <div className="text-xs text-slate-400 font-medium py-6 text-center">
                  No candidate reviewers yet — matches are drawn from people who have completed at least one peer
                  review on Conference Gate.
                </div>
              ) : (
                <div className="space-y-3">
                  {aiMatches?.map((match, idx) => {
                    const candidate = committeeCandidatePool.find((c) => c.id === match.reviewerId);
                    if (!candidate) return null;
                    return (
                      <div key={idx} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between gap-4">
                        <div>
                          <div className="font-bold text-xs text-slate-900">
                            {candidate.name} ({candidate.org})
                          </div>
                          <p className="text-[11px] text-slate-600">{match.reason}</p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 font-extrabold text-xs rounded-full">
                            {match.matchPercentage}% Match
                          </span>
                          {invitedReviewerIds[candidate.id] ? (
                            <span className="px-3.5 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-xs rounded-xl flex items-center gap-1.5">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Invitation Sent
                            </span>
                          ) : (
                            <button
                              onClick={() =>
                                handleInviteReviewerToAbstract(
                                  candidate.id,
                                  candidate.name,
                                  selectedSubForAI?.title || 'this abstract'
                                )
                              }
                              disabled={invitingReviewerId === candidate.id}
                              className="px-3.5 py-1.5 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer disabled:opacity-50"
                            >
                              {invitingReviewerId === candidate.id ? 'Sending…' : 'Invite to Review'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Technical Committee */}
      {activeTab === 'committee' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-2">
            <h2 className="text-lg font-bold text-slate-900">Technical Committee Management</h2>
            <p className="text-xs text-slate-500">
              Nominate candidates with AI, review your current committee roster, assign tasks, and keep the
              organizer, chair, and co-chair in sync with follow-up notifications.
            </p>
          </div>

          {/* AI Nomination */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-blue-600" />
                <div>
                  <h3 className="font-bold text-sm text-slate-900">AI-Nominated Technical Committee Candidates</h3>
                  <p className="text-[11px] text-slate-500">
                    Ranked by number of completed peer reviews and subject-matter expertise on Conference Gate.
                  </p>
                </div>
              </div>
              <button
                onClick={handleAINominateCommittee}
                disabled={committeeMatchLoading}
                className="px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
              >
                <Sparkles className="w-3.5 h-3.5 text-blue-300" />
                <span>{committeeMatchLoading ? 'Analyzing Candidates…' : 'Run AI Nomination'}</span>
              </button>
            </div>

            {committeeMatchLoading && (
              <div className="text-center py-6 text-xs text-slate-500 font-medium">
                Calculating experience and participation match scores against the global candidate pool…
              </div>
            )}

            {!committeeMatchLoading && committeeMatchIsFallback && committeeMatches && committeeMatches.length > 0 && (
              <div className="px-3 py-2 bg-amber-50 text-amber-800 border border-amber-200 rounded-xl text-[11px] font-semibold flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                AI matching is unavailable right now — showing candidates ranked by review count instead of a live AI
                score.
              </div>
            )}

            {!committeeMatchLoading && committeeCandidatePool.length === 0 && (
              <div className="text-xs text-slate-400 font-medium py-6 text-center">
                No candidates yet — nominations are drawn from people who have completed at least one peer review on
                Conference Gate. Once reviewers submit reviews, they'll appear here.
              </div>
            )}

            {!committeeMatchLoading && committeeMatches && (
              <div className="space-y-3">
                {committeeMatches.map((match) => {
                  const candidate = committeeCandidatePool.find((c) => c.id === match.reviewerId);
                  if (!candidate) return null;
                  return (
                    <div
                      key={candidate.id}
                      className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div>
                        <div className="font-bold text-xs text-slate-900">
                          {candidate.name} ({candidate.org})
                        </div>
                        <div className="text-[11px] text-slate-500">{candidate.title}</div>
                        <p className="text-[11px] text-slate-600 mt-1">{match.reason}</p>
                        <div className="flex items-center gap-3 mt-1.5 text-[10px] font-bold text-slate-500">
                          <span className="flex items-center gap-1">
                            <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
                            {candidate.reviewCount} completed review{candidate.reviewCount === 1 ? '' : 's'}
                          </span>
                          {candidate.expertise.length > 0 && (
                            <span className="flex items-center gap-1">
                              <Award className="w-3 h-3 text-blue-500" />
                              {candidate.expertise.slice(0, 2).join(', ')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 font-extrabold text-xs rounded-full">
                          {match.matchPercentage}% Match
                        </span>
                        {invitedCandidateIds[candidate.id] ? (
                          <span className="px-3.5 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-xs rounded-xl flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Invitation Sent
                          </span>
                        ) : (
                          <button
                            onClick={() => handleInviteCandidateToCommittee(candidate.id, candidate.name)}
                            disabled={invitingCandidateId === candidate.id}
                            className="px-3.5 py-1.5 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                          >
                            <Bell className="w-3.5 h-3.5" />
                            <span>{invitingCandidateId === candidate.id ? 'Sending…' : 'Send Invitation'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Committee Roster */}
          <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="p-6 pb-0">
              <h3 className="font-bold text-sm text-slate-900">Current Technical Committee Roster</h3>
              <p className="text-[11px] text-slate-500 mt-1">
                Aggregated across all your conferences. Participation reflects how many conferences each member
                has served on in a technical committee role.
              </p>
            </div>
            <div className="overflow-x-auto p-6">
              {committeeRoster.length === 0 ? (
                <div className="text-xs text-slate-400 font-medium py-6 text-center">
                  No technical committee members yet. Nominate candidates above or add members via the Conference
                  Wizard.
                </div>
              ) : (
                <table className="w-full text-left text-xs text-slate-700">
                  <thead className="bg-slate-50 border-b border-slate-200 uppercase font-bold text-[10px] text-slate-500">
                    <tr>
                      <th className="p-3">Name</th>
                      <th className="p-3">Role(s)</th>
                      <th className="p-3">Participation</th>
                      <th className="p-3">Track(s)</th>
                      <th className="p-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {committeeRoster.map((member) => (
                      <tr key={member.name} className="hover:bg-slate-50/80 transition-colors">
                        <td className="p-3">
                          <div className="font-bold text-slate-900">{member.name}</div>
                          <div className="text-[11px] text-slate-500">
                            {[member.title, member.org].filter(Boolean).join(', ')}
                          </div>
                        </td>
                        <td className="p-3">{Array.from(member.roles).join(', ')}</td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                            {member.participationCount} conference{member.participationCount === 1 ? '' : 's'}
                          </span>
                        </td>
                        <td className="p-3">{Array.from(member.tracks).join(', ') || '—'}</td>
                        <td className="p-3">
                          <button
                            onClick={() => setTaskDraft({ ...taskDraft, assignee: member.name })}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[10px] rounded-lg cursor-pointer"
                          >
                            Assign Task
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Assign Tasks */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-blue-600" />
              <h3 className="font-bold text-sm text-slate-900">Assign Tasks to Committee Members</h3>
            </div>
            <form onSubmit={handleAssignTask} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <select
                  required
                  value={taskDraft.assignee}
                  onChange={(e) => setTaskDraft({ ...taskDraft, assignee: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                >
                  <option value="">Select Committee Member</option>
                  {committeeRoster.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                  {committeeCandidatePool
                    .filter((c) => invitedCandidateIds[c.id])
                    .map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                </select>
                <select
                  value={taskDraft.priority}
                  onChange={(e) => setTaskDraft({ ...taskDraft, priority: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                >
                  <option>Low</option>
                  <option>Medium</option>
                  <option>High</option>
                </select>
              </div>
              <input
                type="text"
                required
                placeholder="Task title, e.g. Review 12 abstracts in Track 2"
                value={taskDraft.title}
                onChange={(e) => setTaskDraft({ ...taskDraft, title: e.target.value })}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-medium"
              />
              <textarea
                rows={2}
                placeholder="Task description..."
                value={taskDraft.description}
                onChange={(e) => setTaskDraft({ ...taskDraft, description: e.target.value })}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-medium"
              ></textarea>
              <div className="flex items-center gap-3">
                <input
                  type="date"
                  value={taskDraft.dueDate}
                  onChange={(e) => setTaskDraft({ ...taskDraft, dueDate: e.target.value })}
                  className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                />
                <button
                  type="submit"
                  className="px-4 py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Assign Task</span>
                </button>
              </div>
            </form>

            {committeeTasks.length > 0 && (
              <div className="space-y-2 pt-2">
                {committeeTasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center justify-between gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200"
                  >
                    <div>
                      <div className="font-bold text-slate-900 text-xs">{task.title}</div>
                      <div className="text-[11px] text-slate-500">
                        Assigned to <strong>{task.assignee}</strong>
                        {task.dueDate && <> · Due {task.dueDate}</>} · {task.priority} Priority
                      </div>
                      {task.description && (
                        <p className="text-[11px] text-slate-600 mt-1">{task.description}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleCycleTaskStatus(task.id)}
                      className={`px-2.5 py-1 rounded-full text-[10px] font-bold cursor-pointer shrink-0 ${
                        task.status === 'Completed'
                          ? 'bg-emerald-100 text-emerald-800'
                          : task.status === 'In Progress'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {task.status}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Follow-Up Notifications */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
            <div className="flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-blue-600" />
              <h3 className="font-bold text-sm text-slate-900">
                Follow-Up Notifications — Organizer, Chair & Co-Chair
              </h3>
            </div>
            <form onSubmit={handleSendFollowUp} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <select
                  value={followUpDraft.from}
                  onChange={(e) => setFollowUpDraft({ ...followUpDraft, from: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
                >
                  <option>Conference Organizer</option>
                  <option>Technical Committee Chair</option>
                  <option>Technical Committee Co-Chair</option>
                </select>
                <select
                  value={followUpDraft.to}
                  onChange={(e) => setFollowUpDraft({ ...followUpDraft, to: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
                >
                  <option>Conference Organizer</option>
                  <option>Technical Committee Chair</option>
                  <option>Technical Committee Co-Chair</option>
                  <option>All Committee Members</option>
                  {committeeRoster.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                required
                rows={3}
                placeholder="Follow-up message, e.g. Reminder: please submit your reviewer assignments by Friday..."
                value={followUpDraft.message}
                onChange={(e) => setFollowUpDraft({ ...followUpDraft, message: e.target.value })}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-medium"
              ></textarea>

              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold bg-indigo-100 text-indigo-700">
                    <Bell className="w-3 h-3" />
                    In-app notification always sent
                  </span>
                  <label className="flex items-center gap-1.5 cursor-pointer font-semibold text-slate-600">
                    <input
                      type="checkbox"
                      checked={followUpDraft.sendEmail}
                      onChange={(e) => setFollowUpDraft({ ...followUpDraft, sendEmail: e.target.checked })}
                      className="w-3.5 h-3.5 text-blue-600 rounded cursor-pointer"
                    />
                    Also send email copy (optional)
                  </label>
                </div>
              </div>

              <button
                type="submit"
                className="px-4 py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send Follow-Up</span>
              </button>
            </form>

            {committeeFollowUps.length > 0 && (
              <div className="space-y-2 pt-2">
                {committeeFollowUps.map((fu) => (
                  <div key={fu.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-slate-700">
                      <span>
                        {fu.from} <ChevronRight className="w-3 h-3 inline text-slate-400" /> {fu.to}
                      </span>
                      <span className="text-slate-400 font-medium">{fu.date}</span>
                    </div>
                    <p className="text-[11px] text-slate-600 mt-1">{fu.message}</p>

                    <div className="flex items-center gap-2 mt-2">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700">
                        <Bell className="w-3 h-3" />
                        In-app notification sent
                      </span>
                      {fu.sendEmail ? (
                        <button
                          type="button"
                          onClick={() => setExpandedEmailId((cur) => (cur === fu.id ? null : fu.id))}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 hover:bg-blue-200 cursor-pointer transition-colors"
                        >
                          <Mail className="w-3 h-3" />
                          Email sent{expandedEmailId === fu.id ? ' — hide' : ' — view'}
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-400">
                          <Mail className="w-3 h-3" />
                          No email sent
                        </span>
                      )}
                    </div>

                    {fu.sendEmail && expandedEmailId === fu.id && (
                      <div className="mt-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
                        <div className="px-3 py-2 bg-slate-100 border-b border-slate-200 space-y-0.5">
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                            <span className="font-bold text-slate-700 w-12 shrink-0">From:</span>
                            {followUpRecipientEmail(fu.from)}
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                            <span className="font-bold text-slate-700 w-12 shrink-0">To:</span>
                            {followUpRecipientEmail(fu.to)}
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                            <span className="font-bold text-slate-700 w-12 shrink-0">Subject:</span>
                            Follow-Up: {fu.from} → {fu.to}
                          </div>
                        </div>
                        <p className="p-3 text-[11px] text-slate-700 leading-relaxed">{fu.message}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Schedule Committee Meeting */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
            <div className="flex items-center gap-2">
              <Video className="w-5 h-5 text-blue-600" />
              <h3 className="font-bold text-sm text-slate-900">
                Schedule a Follow-Up Meeting — Technical Committee
              </h3>
            </div>
            <form onSubmit={handleScheduleMeeting} className="space-y-3 text-xs">
              <input
                type="text"
                required
                placeholder="Meeting title, e.g. Q2 Track Review Sync"
                value={meetingDraft.title}
                onChange={(e) => setMeetingDraft({ ...meetingDraft, title: e.target.value })}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-medium"
              />

              <div className="space-y-1.5" ref={attendeeDropdownRef}>
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  Attendees — Select Who's Available
                </span>
                {committeeRoster.length === 0 ? (
                  <p className="text-[11px] text-slate-400">No committee members yet — invite members above first.</p>
                ) : (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setAttendeeDropdownOpen((v) => !v)}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium flex items-center justify-between cursor-pointer text-left"
                    >
                      <span className={meetingDraft.attendees.length === 0 ? 'text-slate-400' : 'text-slate-800 font-bold'}>
                        {meetingDraft.attendees.length === 0
                          ? 'Select committee members to invite...'
                          : `${meetingDraft.attendees.length} of ${committeeRoster.length} selected: ${meetingDraft.attendees.join(', ')}`}
                      </span>
                      <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${attendeeDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {attendeeDropdownOpen && (
                      <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-slate-50">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            Who can attend?
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setMeetingDraft({ ...meetingDraft, attendees: committeeRoster.map((m) => m.name) })}
                              className="text-[10px] font-bold text-blue-600 hover:underline cursor-pointer"
                            >
                              Select All
                            </button>
                            <button
                              type="button"
                              onClick={() => setMeetingDraft({ ...meetingDraft, attendees: [] })}
                              className="text-[10px] font-bold text-slate-400 hover:underline cursor-pointer"
                            >
                              Clear
                            </button>
                          </div>
                        </div>
                        <div className="max-h-56 overflow-y-auto">
                          {committeeRoster.map((m) => {
                            const selected = meetingDraft.attendees.includes(m.name);
                            return (
                              <label
                                key={m.name}
                                className="flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-b-0"
                              >
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  onChange={() => toggleMeetingAttendee(m.name)}
                                  className="w-3.5 h-3.5 text-blue-600 rounded cursor-pointer"
                                />
                                <span className="min-w-0">
                                  <span className="block font-bold text-slate-900 text-xs truncate">{m.name}</span>
                                  <span className="block text-[10px] text-slate-500 truncate">
                                    {m.title} · {m.org}
                                  </span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold">Date</span>
                  <input
                    type="date"
                    required
                    value={meetingDraft.date}
                    onChange={(e) => setMeetingDraft({ ...meetingDraft, date: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold">Time</span>
                  <input
                    type="time"
                    required
                    value={meetingDraft.time}
                    onChange={(e) => setMeetingDraft({ ...meetingDraft, time: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold">Your Timezone</span>
                  <select
                    value={meetingDraft.organizerTimezone}
                    onChange={(e) => setMeetingDraft({ ...meetingDraft, organizerTimezone: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                  >
                    {MEETING_TIMEZONES.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* World Clock Preview */}
              {worldClockPreview.length > 0 && (
                <div className="p-3 bg-blue-50/60 border border-blue-100 rounded-xl space-y-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-blue-900">
                    <Globe className="w-3.5 h-3.5" />
                    <span>Meeting Time Around the World</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {worldClockPreview.map((z) => (
                      <div key={z.id} className="p-2 bg-white rounded-lg border border-blue-100">
                        <div className="text-[10px] text-slate-500 font-semibold truncate">{z.label}</div>
                        <div className="text-xs font-extrabold text-slate-900">{z.time}</div>
                        <div className="text-[10px] text-slate-400">{z.date}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <span className="text-[10px] text-slate-500 font-semibold">
                  Meeting Link (Zoom, Google Meet, Teams, etc.)
                </span>
                <input
                  type="url"
                  required
                  placeholder="https://..."
                  value={meetingDraft.meetingLink}
                  onChange={(e) => setMeetingDraft({ ...meetingDraft, meetingLink: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                />
                <p className="text-[10px] text-slate-400">
                  Conference Gate doesn't generate meeting rooms — paste the link from your own video conferencing
                  account.
                </p>
              </div>

              <button
                type="submit"
                className="px-4 py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer flex items-center gap-1.5"
              >
                <Video className="w-3.5 h-3.5" />
                <span>Schedule Meeting</span>
              </button>
            </form>

            {scheduledMeetings.length > 0 && (
              <div className="space-y-2 pt-2">
                {scheduledMeetings.map((mtg) => (
                  <div key={mtg.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-slate-900 text-xs">{mtg.title}</span>
                      <span className="text-[10px] text-slate-400 font-medium">
                        {mtg.date} · {mtg.time} ({MEETING_TIMEZONES.find((z) => z.id === mtg.organizerTimezone)?.label})
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Attendees: <strong>{mtg.attendees.join(', ')}</strong>
                    </div>
                    <a
                      href={mtg.meetingLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-[11px] font-bold text-blue-600 hover:underline"
                    >
                      <Video className="w-3 h-3" />
                      {mtg.meetingLink}
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 5: Sponsorship Packages */}
      {activeTab === 'sponsors' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-2">
            <h2 className="text-lg font-bold text-slate-900">Sponsorship Opportunities & Packages</h2>
            <p className="text-xs text-slate-500">
              Tentative pricing and packages available across every part of your conference program. Activate a
              package to make it available to sponsors in the marketplace.
            </p>
          </div>

          <div className="columns-1 md:columns-2 xl:columns-3 gap-6 [column-fill:_balance]">
            {sponsorshipOpportunities.map((opp) => {
              const Icon = sponsorshipOpportunityIcons[opp.category] || Briefcase;
              const c = sponsorshipOpportunityColors[opp.category] || sponsorshipOpportunityColors.blue;
              const startingPrice = Math.min(...opp.packages.map((p) => p.price));
              return (
                <div
                  key={opp.id}
                  className={`break-inside-avoid mb-6 bg-white rounded-3xl border ${c.border} shadow-xs overflow-hidden`}
                >
                  <div className={`${c.header} p-5 flex items-start gap-3`}>
                    <div className={`w-10 h-10 rounded-xl ${c.iconBox} flex items-center justify-center shrink-0`}>
                      <Icon className={`w-5 h-5 ${c.icon}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-bold text-sm text-slate-900">{opp.name}</h3>
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase shrink-0 ${c.badge}`}>
                          From ${startingPrice.toLocaleString()}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">{opp.description}</p>
                    </div>
                  </div>

                  <div className="p-4 space-y-2">
                    {opp.packages.map((pkg) => {
                      const key = `${opp.id}__${pkg.tier}`;
                      const isActive = !!activatedOpportunityKeys[key];
                      return (
                        <div key={key} className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-bold text-xs text-slate-900">{pkg.tier}</div>
                              <div className="text-[10px] text-slate-500 truncate">
                                Up to {pkg.slots} sponsor{pkg.slots === 1 ? '' : 's'} · {pkg.benefits.join(' · ')}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className={`font-extrabold text-sm ${c.price}`}>
                                ${pkg.price.toLocaleString()}
                              </div>
                              <div className="text-[9px] text-slate-400 uppercase font-bold">Tentative</div>
                            </div>
                          </div>
                          <button
                            onClick={() => onToggleOpportunityPackage(key)}
                            className={`mt-2 w-full py-1.5 rounded-lg font-bold text-[11px] cursor-pointer transition-colors ${
                              isActive
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-blue-900 hover:bg-blue-950 text-white'
                            }`}
                          >
                            {isActive ? '✓ Active in Marketplace' : 'Activate for This Conference'}
                          </button>
                          {isActive && (
                            <button
                              onClick={() => handleNotifyVerifiedSponsors(opp.name, pkg.tier, pkg.price, key)}
                              className="mt-1.5 w-full py-1.5 rounded-lg font-bold text-[11px] cursor-pointer transition-colors bg-white border border-blue-200 text-blue-700 hover:bg-blue-50 flex items-center justify-center gap-1.5"
                            >
                              <Bell className="w-3 h-3" />
                              {notifiedOpportunityKeys[key]
                                ? `Notified ${verifiedSponsorCount} Verified Sponsors ✓`
                                : `Notify ${verifiedSponsorCount} Verified Sponsors`}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Existing Published Packages */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-2">
            <h2 className="text-lg font-bold text-slate-900">Currently Published Packages</h2>
            <p className="text-xs text-slate-500">
              Live packages sponsors can already see and apply for in the Sponsor Marketplace.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sponsorshipPackages.map((pkg) => (
              <div key={pkg.id} className="bg-white rounded-3xl border border-slate-200 p-6 space-y-3 shadow-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="px-3 py-1 bg-blue-100 text-blue-900 font-extrabold text-xs rounded-full uppercase tracking-wider">
                    {pkg.tier} Tier
                  </span>
                  <span className="text-xl font-extrabold text-slate-900">${pkg.price.toLocaleString()}</span>
                </div>
                <p className="text-[11px] text-slate-500">{pkg.conferenceTitle}</p>
                <div className="text-[11px] text-slate-500">
                  {pkg.availableSlots} of {pkg.totalSlots} slots available
                </div>
                <ul className="space-y-1.5 text-xs text-slate-700 pt-2 border-t border-slate-100">
                  {pkg.benefits.slice(0, 3).map((ben, idx) => (
                    <li key={idx} className="flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>{ben}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Sponsor Verification Queue */}
          {sponsorApplicants.length > 0 && (
            <div className="space-y-3">
              <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-2">
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-blue-600" />
                  Sponsor Verification Queue
                </h2>
                <p className="text-xs text-slate-500">
                  Every applicant is screened against past ratings from organizers and attendees. Sponsors averaging
                  below {SPONSOR_RATING_THRESHOLD.toFixed(1)}/5 are automatically restricted from registering — no manual
                  review needed to keep low-quality sponsors out.
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {sponsorApplicants.map((applicant) => {
                  const eligible = isSponsorVerified(applicant);
                  return (
                    <div
                      key={applicant.id}
                      className={`bg-white rounded-2xl border p-5 space-y-3 shadow-xs ${
                        eligible ? 'border-slate-200' : 'border-rose-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <img
                            src={applicant.logo}
                            alt={applicant.companyName}
                            className="w-11 h-11 rounded-xl object-cover shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="font-bold text-xs text-slate-900 truncate">{applicant.companyName}</div>
                            <div className="text-[11px] text-slate-500 truncate">{applicant.industry}</div>
                          </div>
                        </div>
                        {eligible ? (
                          <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-[10px] font-bold flex items-center gap-1 shrink-0">
                            <ShieldCheck className="w-3 h-3" />
                            Verified
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 bg-rose-50 text-rose-700 border border-rose-200 rounded-full text-[10px] font-bold flex items-center gap-1 shrink-0">
                            <ShieldAlert className="w-3 h-3" />
                            Restricted
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-0.5">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <Star
                              key={n}
                              className={`w-3.5 h-3.5 ${
                                n <= Math.round(applicant.rating) ? 'fill-amber-400 text-amber-400' : 'text-slate-200'
                              }`}
                            />
                          ))}
                        </div>
                        <span className="text-xs font-bold text-slate-700">{applicant.rating.toFixed(1)} / 5</span>
                        <span className="text-[10px] text-slate-400">({applicant.reviewsCount} reviews)</span>
                      </div>

                      <div className="text-[11px] text-slate-500">
                        {applicant.sponsorshipHistory.length} sponsorship{applicant.sponsorshipHistory.length === 1 ? '' : 's'} on
                        record{applicant.sponsorshipHistory[0] && (
                          <> · most recent: {applicant.sponsorshipHistory[0].conferenceTitle} ({applicant.sponsorshipHistory[0].year})</>
                        )}
                      </div>

                      {!eligible && (
                        <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-100 rounded-lg p-2">
                          {sponsorVerificationReason(applicant)}
                        </p>
                      )}

                      <button
                        disabled={!eligible || !!approvedApplicantIds[applicant.id]}
                        onClick={() => handleApproveApplicant(applicant)}
                        className={`w-full py-2 rounded-xl font-bold text-[11px] transition-colors ${
                          approvedApplicantIds[applicant.id]
                            ? 'bg-emerald-50 text-emerald-700 cursor-default'
                            : eligible
                            ? 'bg-blue-900 hover:bg-blue-950 text-white cursor-pointer'
                            : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        }`}
                      >
                        {approvedApplicantIds[applicant.id]
                          ? 'Approved ✓'
                          : eligible
                          ? 'Approve Registration'
                          : 'Blocked — Rating Below Threshold'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Rate & Review Sponsor */}
          {reviewableSponsors.length > 0 && (
            <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-2">
                <MessageSquareQuote className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-sm text-slate-900">Rate & Review Sponsor</h3>
              </div>
              <p className="text-xs text-slate-500 -mt-2">
                Evaluate the services or package a sponsor delivered. Your review updates their rating and is pushed
                straight to their Sponsor Marketplace as feedback.
              </p>
              <form onSubmit={handleSubmitSponsorReview} className="space-y-3 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <select
                    value={sponsorReviewDraft.sponsorId}
                    onChange={(e) => setSponsorReviewDraft({ ...sponsorReviewDraft, sponsorId: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                  >
                    {reviewableSponsors.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.companyName}
                      </option>
                    ))}
                  </select>
                  <select
                    value={sponsorReviewDraft.conferenceTitle}
                    onChange={(e) => setSponsorReviewDraft({ ...sponsorReviewDraft, conferenceTitle: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                  >
                    {conferences.map((c) => (
                      <option key={c.id} value={c.title}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Rating</span>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        type="button"
                        key={n}
                        onClick={() => setSponsorReviewDraft({ ...sponsorReviewDraft, rating: n })}
                        className="cursor-pointer"
                        title={`${n} star${n === 1 ? '' : 's'}`}
                      >
                        <Star
                          className={`w-5 h-5 ${
                            n <= sponsorReviewDraft.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-200'
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                  {sponsorReviewDraft.rating > 0 && (
                    <span className="text-[11px] font-bold text-slate-700">{sponsorReviewDraft.rating}/5</span>
                  )}
                </div>

                <textarea
                  required
                  rows={3}
                  placeholder="Evaluate the services or package provided, e.g. Delivered branding assets on time and their booth staff were highly engaged with delegates..."
                  value={sponsorReviewDraft.comment}
                  onChange={(e) => setSponsorReviewDraft({ ...sponsorReviewDraft, comment: e.target.value })}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-medium"
                ></textarea>

                <button
                  type="submit"
                  disabled={!sponsorReviewDraft.rating || !sponsorReviewDraft.comment.trim()}
                  className="px-4 py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Push Feedback to Sponsor</span>
                </button>
              </form>

              {sponsorReviewsSent.length > 0 && (
                <div className="space-y-2 pt-2">
                  {sponsorReviewsSent.map((r) => (
                    <div key={r.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-900 text-xs">{r.sponsorName}</span>
                        <div className="flex items-center gap-1">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <Star
                              key={n}
                              className={`w-3 h-3 ${n <= r.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-200'}`}
                            />
                          ))}
                        </div>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {r.conferenceTitle} · <span className="text-emerald-600 font-semibold">Sent to sponsor {r.date}</span>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-1">{r.comment}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tab 7: Communications Hub */}
      {activeTab === 'communications' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 space-y-6 max-w-2xl mx-auto shadow-xs">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-900">Broadcast Communication Center</h2>
            <p className="text-xs text-slate-500">
              Draft and record announcements for delegates, speakers, reviewers, or sponsors. Saved to your
              communications history below.
            </p>
          </div>

          <form onSubmit={handleBroadcast} className="space-y-4 text-xs">
            <div className="space-y-1.5">
              <label className="font-bold text-slate-900 uppercase tracking-wider text-[10px]">Recipient Group</label>
              <select
                value={recipientGroup}
                onChange={(e) => setRecipientGroup(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
              >
                <option value="All Attendees">All Attendees & Registered Delegates</option>
                <option value="Accepted Authors">Accepted Authors & Presenters</option>
                <option value="Reviewers">Technical Committee Reviewers</option>
                <option value="Sponsors">Corporate Sponsors</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="font-bold text-slate-900 uppercase tracking-wider text-[10px]">Broadcast Subject *</label>
              <input
                type="text"
                required
                value={broadcastSubject}
                onChange={(e) => setBroadcastSubject(e.target.value)}
                placeholder="e.g. Important Announcement: Keynote Schedule & Badge Check-In Information"
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-medium"
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-bold text-slate-900 uppercase tracking-wider text-[10px]">Message Body *</label>
              <textarea
                required
                rows={5}
                value={broadcastBody}
                onChange={(e) => setBroadcastBody(e.target.value)}
                placeholder="Write message content..."
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-medium"
              ></textarea>
            </div>

            {broadcastSent && (
              <div className="p-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl font-bold flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <span>Broadcast recorded for {recipientGroup}.</span>
              </div>
            )}

            <button
              disabled={broadcastSending}
              type="submit"
              className="w-full py-3 bg-blue-900 hover:bg-blue-950 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-md transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              <Send className="w-4 h-4" />
              <span>{broadcastSending ? 'Sending…' : 'Send Broadcast Message'}</span>
            </button>
          </form>

          {broadcastHistory.length > 0 && (
            <div className="space-y-3 pt-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">Broadcast History</h3>
              <div className="space-y-2">
                {broadcastHistory.map((b) => (
                  <div key={b.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-xs text-slate-900">{b.subject}</span>
                      <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full shrink-0">
                        {b.recipientGroup}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 line-clamp-2">{b.body}</p>
                    <p className="text-[10px] text-slate-400">{new Date(b.createdAt).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 8: Event Analytics */}
      {activeTab === 'analytics' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-2">
            <h2 className="text-lg font-bold text-slate-900">Event Analytics</h2>
            <p className="text-xs text-slate-500">
              A full picture of your conference: participation, technical & poster sessions, submission
              outcomes, sponsor performance, and satisfaction feedback across organizers, professionals, and
              sponsors.
            </p>
          </div>

          {/* Hero KPI Row */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <AnalyticsStatTile
              icon={Users}
              label="Total Participants"
              value={`${overviewStats.totalRegistrations}`}
              sub={`Across ${conferences.length} managed conference${conferences.length === 1 ? '' : 's'}`}
              tone="good"
              accent={CHART_HEX.blue}
            />
            <AnalyticsStatTile
              icon={Presentation}
              label="Technical Sessions"
              value={`${totalOralSessions}`}
              sub={`${sessionsByTrack.length} track${sessionsByTrack.length === 1 ? '' : 's'}`}
              tone="neutral"
              accent={CHART_HEX.indigo}
            />
            <AnalyticsStatTile
              icon={LayoutGrid}
              label="Poster Presentations"
              value={`${totalPosterSessions}`}
              sub="Accepted poster submissions"
              tone="neutral"
              accent={CHART_HEX.violet}
            />
            <AnalyticsStatTile
              icon={FileText}
              label="Abstracts Submitted"
              value={`${totalSubmissions}`}
              sub={`${overviewStats.acceptedSubmissions} accepted`}
              tone="good"
              accent={CHART_HEX.emerald}
            />
            <AnalyticsStatTile
              icon={ClipboardList}
              label="Technical Committee"
              value={`${committeeRoster.length}`}
              sub="Members across all conferences"
              tone="neutral"
              accent={CHART_HEX.amber}
            />
            <AnalyticsStatTile
              icon={Smile}
              label="Overall Satisfaction"
              value={feedbackSummary.responseCount > 0 ? `${feedbackSummary.averageScore.toFixed(1)} / 5` : 'No data yet'}
              sub={`${feedbackSummary.responseCount} feedback response${feedbackSummary.responseCount === 1 ? '' : 's'}`}
              tone="good"
              accent={CHART_HEX.rose}
            />
          </div>

          {/* Program Composition */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-blue-600" />
                  <h3 className="font-bold text-sm text-slate-900">Technical Sessions vs Posters by Track</h3>
                </div>
              </div>
              <div className="flex items-center gap-4 text-[10px] font-bold text-slate-500">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CHART_HEX.blue }} />
                  Technical Sessions ({totalOralSessions})
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CHART_HEX.violet }} />
                  Poster Presentations ({totalPosterSessions})
                </span>
              </div>
              {sessionsByTrack.length === 0 ? (
                <div className="text-xs text-slate-400 font-medium py-6 text-center">
                  No accepted submissions yet — this chart populates once abstracts are accepted.
                </div>
              ) : (
                <div className="space-y-4">
                  {sessionsByTrack.map((t) => (
                    <div key={t.track} className="space-y-1.5">
                      <div className="text-[11px] font-semibold text-slate-700">{t.track}</div>
                      <div className="flex gap-1.5 h-3">
                        <div
                          className="rounded-l-full"
                          style={{
                            width: `${(t.oral / maxSessionsInTrack) * 100}%`,
                            backgroundColor: CHART_HEX.blue,
                          }}
                          title={`Technical Sessions: ${t.oral}`}
                        />
                        <div
                          className="rounded-r-full"
                          style={{
                            width: `${(t.poster / maxSessionsInTrack) * 100}%`,
                            backgroundColor: CHART_HEX.violet,
                          }}
                          title={`Poster Presentations: ${t.poster}`}
                        />
                      </div>
                      <div className="text-[10px] text-slate-400 font-semibold">
                        {t.oral} sessions · {t.poster} posters
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-2">
                <PieChart className="w-4 h-4 text-blue-600" />
                <h3 className="font-bold text-sm text-slate-900">Abstract Status Breakdown</h3>
              </div>
              {totalSubmissions === 0 ? (
                <div className="text-xs text-slate-400 font-medium py-6 text-center">
                  No abstract submissions yet.
                </div>
              ) : (
                <div className="flex items-center gap-6">
                  <div
                    className="w-32 h-32 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: buildConicGradient(submissionStatusBreakdown) }}
                  >
                    <div className="w-20 h-20 rounded-full bg-white flex flex-col items-center justify-center">
                      <span className="text-lg font-extrabold text-slate-900">{totalSubmissions}</span>
                      <span className="text-[9px] text-slate-400 font-bold uppercase">Total</span>
                    </div>
                  </div>
                  <div className="flex-1 space-y-2">
                    {submissionStatusBreakdown.map((s) => (
                      <div key={s.label} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="flex items-center gap-1.5 font-semibold text-slate-700">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                          {s.label}
                        </span>
                        <span className="font-bold text-slate-900">
                          {s.value} <span className="text-slate-400 font-medium">({Math.round((s.value / totalSubmissions) * 100)}%)</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Attendance */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-600" />
              <h3 className="font-bold text-sm text-slate-900">Registrations by Conference</h3>
            </div>
            {registrationsByConference.length === 0 ? (
              <div className="text-xs text-slate-400 font-medium py-6 text-center">
                No registrations recorded yet.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {registrationsByConference.map((d) => (
                  <AnalyticsBarRow
                    key={d.title}
                    label={d.title}
                    value={d.count}
                    max={maxRegistrationsByConference}
                    color={CHART_HEX.blue}
                    valueLabel={d.count.toLocaleString()}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Feedback & Satisfaction */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 px-1">
              <Smile className="w-4 h-4 text-blue-600" />
              <h3 className="font-bold text-sm text-slate-900">Feedback & Satisfaction</h3>
            </div>
            {feedbackSummary.responseCount === 0 ? (
              <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs text-xs text-slate-400 font-medium text-center">
                No feedback submitted yet across your conferences.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <AnalyticsGaugeCard
                  icon={Smile}
                  title="Overall Feedback"
                  subtitle="All roles — attendees, organizers, sponsors"
                  score={feedbackSummary.averageScore}
                  maxScore={5}
                  color={CHART_HEX.blue}
                  responseCount={feedbackSummary.responseCount}
                  breakdown={[]}
                />
              </div>
            )}
          </div>

          {/* Sponsor Performance */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-blue-600" />
                <h3 className="font-bold text-sm text-slate-900">Sponsor Package Performance</h3>
              </div>
              <span className="text-xs font-extrabold text-emerald-700">
                ${totalSponsorRevenueRealized.toLocaleString()} Realized
              </span>
            </div>
            {sponsorRevenueByTier.length === 0 ? (
              <div className="text-xs text-slate-400 font-medium py-4 text-center">
                No sponsorship packages published yet.
              </div>
            ) : (
              <div className="space-y-3">
                {sponsorRevenueByTier.map((s) => (
                  <AnalyticsBarRow
                    key={s.tier}
                    label={`${s.tier} Tier`}
                    value={s.revenue}
                    max={maxSponsorRevenue}
                    color={CHART_HEX.emerald}
                    valueLabel={`$${s.revenue.toLocaleString()} · ${s.sold}/${s.total} sold`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
