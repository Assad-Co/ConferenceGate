import React, { useState } from 'react';
import {
  Building2,
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
  UserCheck,
  ChevronRight,
  Filter,
} from 'lucide-react';
import { Conference, AbstractSubmission, SponsorshipPackage } from '../types';

interface OrganizerDashboardProps {
  conferences: Conference[];
  submissions: AbstractSubmission[];
  sponsorshipPackages: SponsorshipPackage[];
  onCreateConference: (newConf: Partial<Conference>) => void;
}

export const OrganizerDashboard: React.FC<OrganizerDashboardProps> = ({
  conferences,
  submissions,
  sponsorshipPackages,
  onCreateConference,
}) => {
  const [activeTab, setActiveTab] = useState<
    'overview' | 'wizard' | 'abstracts' | 'committee' | 'program' | 'sponsors' | 'communications' | 'analytics'
  >('overview');

  const [aiMatchLoading, setAiMatchLoading] = useState(false);
  const [aiMatches, setAiMatches] = useState<any[] | null>(null);
  const [selectedSubForAI, setSelectedSubForAI] = useState<AbstractSubmission | null>(null);

  // Wizard State
  const [wizardStep, setWizardStep] = useState(1);
  const [newConfTitle, setNewConfTitle] = useState('');
  const [newConfIndustry, setNewConfIndustry] = useState('Energy & Geosciences');
  const [newConfStartDate, setNewConfStartDate] = useState('2026-10-15');
  const [newConfEndDate, setNewConfEndDate] = useState('2026-10-18');
  const [newConfLocation, setNewConfLocation] = useState('Paris, France');
  const [newConfTracks, setNewConfTracks] = useState('Track 1: Subsurface AI, Track 2: Carbon Storage');
  const [wizardPublished, setWizardPublished] = useState(false);

  // Communications Broadcast State
  const [recipientGroup, setRecipientGroup] = useState('All Attendees');
  const [broadcastSubject, setBroadcastSubject] = useState('');
  const [broadcastBody, setBroadcastBody] = useState('');
  const [broadcastSent, setBroadcastSent] = useState(false);

  const handleAIMatchReviewers = async (sub: AbstractSubmission) => {
    setSelectedSubForAI(sub);
    setAiMatchLoading(true);

    const mockCandidateReviewers = [
      { id: 'rev_1', name: 'Dr. Lina Hassan', title: 'Principal Geochemist', org: 'Shell Geosciences', expertise: ['Geochemistry', 'Kerogen'] },
      { id: 'rev_2', name: 'Prof. Marcus Vance', title: 'Chair of Petroleum Data', org: 'Imperial College London', expertise: ['Subsurface Analytics', 'Neural Networks'] },
      { id: 'rev_3', name: 'Dr. Elena Rostova', title: 'Senior Scientific Advisor', org: 'ETH Zurich', expertise: ['Thermal Maturity', 'Basin Modeling'] },
    ];

    try {
      const res = await fetch('/api/ai/reviewer-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          abstractTitle: sub.title,
          abstractKeywords: sub.keywords,
          abstractTopic: sub.topic,
          reviewers: mockCandidateReviewers,
        }),
      });
      const data = await res.json();
      setAiMatches(data.matches || []);
    } catch (e) {
      setAiMatches([
        { reviewerId: 'rev_1', matchPercentage: 96, reason: 'High expertise alignment in geochemistry and core plug analysis.' },
        { reviewerId: 'rev_2', matchPercentage: 91, reason: 'Strong publication record in neural network reservoir analytics.' },
      ]);
    } finally {
      setAiMatchLoading(false);
    }
  };

  const handleWizardSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreateConference({
      title: newConfTitle || 'International Energy & Subsurface Congress 2026',
      organizerName: 'Global Scientific Association',
      organizerLogo: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=150&q=80',
      banner: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=1200&q=80',
      logo: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=200&q=80',
      description: 'Newly created international congress focusing on energy transition, geosciences, and subsurface AI.',
      industry: newConfIndustry,
      topics: ['Energy', 'Geosciences', 'Subsurface AI'],
      tracks: newConfTracks.split(',').map((t) => t.trim()),
      location: { city: 'Paris', country: 'France', venue: 'Palais des Congrès de Paris' },
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
      mainThemes: ['Subsurface AI', 'Net Zero Solutions'],
      agendaDays: [],
      speakers: [],
      committee: [],
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

  const handleBroadcast = (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastSubject.trim() || !broadcastBody.trim()) return;
    setBroadcastSent(true);
    setBroadcastSubject('');
    setBroadcastBody('');
    setTimeout(() => setBroadcastSent(false), 4000);
  };

  return (
    <div className="space-y-8">
      {/* Top Command Center Header */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white rounded-3xl p-6 sm:p-8 shadow-xl border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 bg-blue-500/20 text-blue-300 border border-blue-400/30 rounded-full text-xs font-bold uppercase tracking-wider">
                Conference Management Command Center
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Organizer Operations & Lifecycle Hub
            </h1>
            <p className="text-xs text-slate-300">
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
          { id: 'wizard', label: '15-Step Conference Wizard' },
          { id: 'abstracts', label: `Abstracts & AI Matcher (${submissions.length})` },
          { id: 'committee', label: 'Technical Committee' },
          { id: 'program', label: 'Program & Agenda Builder' },
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
              <div className="text-2xl font-extrabold text-slate-900">2,400 Delegates</div>
              <div className="text-[11px] font-semibold text-emerald-600">↑ 18% vs Last Event</div>
            </div>

            <div className="p-6 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-1">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Registration Revenue</div>
              <div className="text-2xl font-extrabold text-blue-700">$1,420,000</div>
              <div className="text-[11px] font-semibold text-blue-600">Early Bird Target Reached</div>
            </div>

            <div className="p-6 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-1">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Abstract Submissions</div>
              <div className="text-2xl font-extrabold text-slate-900">342 Submissions</div>
              <div className="text-[11px] font-semibold text-emerald-600">78% Under Peer Review</div>
            </div>

            <div className="p-6 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-1">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Sponsorship Revenue</div>
              <div className="text-2xl font-extrabold text-blue-600">$185,000</div>
              <div className="text-[11px] font-semibold text-slate-500">4 Active Corporate Packages</div>
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
                        {conf.dates.start} • {conf.location.city}, {conf.location.country}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="px-3 py-1 bg-emerald-100 text-emerald-800 text-xs font-bold rounded-full">
                      CFP: {conf.cfpStatus}
                    </span>
                    <button
                      onClick={() => setActiveTab('abstracts')}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer"
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
                Step {wizardStep} of 15
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

            {wizardPublished && (
              <div className="p-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl font-bold flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <span>Conference Published Successfully to Conference Gate Repository!</span>
              </div>
            )}

            <div className="pt-4 border-t border-slate-200 flex justify-end">
              <button
                type="submit"
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition-colors cursor-pointer"
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

              {aiMatchLoading ? (
                <div className="text-center py-6 text-xs text-slate-500 font-medium">
                  Calculating graph neural match scores against global reviewer pool...
                </div>
              ) : (
                <div className="space-y-3">
                  {aiMatches?.map((match, idx) => (
                    <div key={idx} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between gap-4">
                      <div>
                        <div className="font-bold text-xs text-slate-900">{match.reviewerId === 'rev_1' ? 'Dr. Lina Hassan (Shell Geosciences)' : 'Prof. Marcus Vance (Imperial College)'}</div>
                        <p className="text-[11px] text-slate-600">{match.reason}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 font-extrabold text-xs rounded-full">
                          {match.matchPercentage}% Match
                        </span>
                        <button className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer">
                          Invite to Review
                        </button>
                      </div>
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
              Send in-app notifications and official email blasts to delegates, speakers, reviewers, or sponsors.
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
                <span>Broadcast successfully dispatched to {recipientGroup}!</span>
              </div>
            )}

            <button
              type="submit"
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              <Send className="w-4 h-4" />
              <span>Send Broadcast Message</span>
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
