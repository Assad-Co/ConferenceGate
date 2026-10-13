import React, { useMemo, useState } from 'react';
import { Bookmark, Bell, CalendarCheck, CheckCircle2, Award } from 'lucide-react';
import type { AbstractSubmission, Conference, ProfessionalInvitation, UserProfile } from '../types';
import type { ConferenceAttendance, ConferenceRegistration } from '../api/activity';
import { CertificatesView } from './CertificatesView';

interface MyConferencesHubProps {
  conferences: Conference[];
  savedConferenceIds: string[];
  followedConferenceIds: string[];
  registrations: ConferenceRegistration[];
  attendance: ConferenceAttendance[];
  submissions: AbstractSubmission[];
  userProfile: UserProfile;
  professionalInvitations: ProfessionalInvitation[];
  currentUserId?: string;
  currentUserEmail?: string;
  onSelectConference: (conference: Conference) => void;
}

type HubTab = 'saved' | 'following' | 'registered' | 'attended' | 'certificates';

const tabs: Array<{ id: HubTab; label: string; icon: React.ElementType }> = [
  { id: 'saved', label: 'Saved', icon: Bookmark },
  { id: 'following', label: 'Following', icon: Bell },
  { id: 'registered', label: 'Registered', icon: CalendarCheck },
  { id: 'attended', label: 'Attended', icon: CheckCircle2 },
  { id: 'certificates', label: 'Certificates', icon: Award },
];

export const MyConferencesHub: React.FC<MyConferencesHubProps> = ({
  conferences,
  savedConferenceIds,
  followedConferenceIds,
  registrations,
  attendance,
  submissions,
  userProfile,
  professionalInvitations,
  currentUserId,
  currentUserEmail,
  onSelectConference,
}) => {
  const [activeTab, setActiveTab] = useState<HubTab>('saved');
  const conferenceById = useMemo(() => new Map(conferences.map((conference) => [conference.id, conference])), [conferences]);

  const saved = savedConferenceIds.map((id) => conferenceById.get(id)).filter(Boolean) as Conference[];
  const following = followedConferenceIds.map((id) => conferenceById.get(id)).filter(Boolean) as Conference[];

  const renderConferenceCards = (items: Conference[], empty: string) =>
    items.length ? (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {items.map((conference) => (
          <button
            key={conference.id}
            onClick={() => onSelectConference(conference)}
            className="text-left bg-white rounded-xl border border-slate-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer"
          >
            <div className="font-extrabold text-sm text-slate-900 line-clamp-2">{conference.title}</div>
            <div className="mt-2 text-xs text-slate-500">{conference.location?.city}, {conference.location?.country}</div>
            <div className="mt-3 text-xs font-bold text-blue-700">Open conference</div>
          </button>
        ))}
      </div>
    ) : (
      <div className="bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center text-sm text-slate-500">{empty}</div>
    );

  return (
    <div className="max-w-6xl mx-auto w-full space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">My Conferences</h1>
        <p className="text-sm text-slate-500 mt-1">Everything you save, follow, register for, attend, or earn from conferences in one place.</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-1 flex flex-wrap gap-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer ${activeTab === tab.id ? 'bg-blue-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              <Icon className="w-4 h-4" /> {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'saved' && renderConferenceCards(saved, 'No saved conferences yet. Save conferences from Discover to keep them here.')}
      {activeTab === 'following' && renderConferenceCards(following, 'You are not following any conferences yet.')}

      {activeTab === 'registered' && (
        registrations.length ? (
          <div className="space-y-3">
            {registrations.map((registration) => {
              const conference = conferenceById.get(registration.conferenceId);
              return (
                <button
                  key={`${registration.conferenceId}-${registration.registeredAt}`}
                  onClick={() => conference && onSelectConference(conference)}
                  disabled={!conference}
                  className="w-full text-left bg-white border border-slate-200 rounded-xl p-4 disabled:cursor-default enabled:hover:border-blue-300 cursor-pointer"
                >
                  <div className="font-extrabold text-sm text-slate-900">{registration.conferenceTitle}</div>
                  <div className="mt-1 text-xs text-slate-500">{registration.packageName || 'Registered attendee'} · Registered {new Date(registration.registeredAt).toLocaleDateString()}</div>
                </button>
              );
            })}
          </div>
        ) : <div className="bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center text-sm text-slate-500">No conference registrations yet.</div>
      )}

      {activeTab === 'attended' && (
        attendance.length ? (
          <div className="space-y-3">
            {attendance.map((item) => {
              const conference = conferenceById.get(item.conferenceId);
              return (
                <button
                  key={item.id}
                  onClick={() => conference && onSelectConference(conference)}
                  disabled={!conference}
                  className="w-full text-left bg-white border border-slate-200 rounded-xl p-4 disabled:cursor-default enabled:hover:border-blue-300 cursor-pointer"
                >
                  <div className="font-extrabold text-sm text-slate-900">{item.conferenceTitle}</div>
                  <div className="mt-1 text-xs text-slate-500">{item.organizerName} · {item.location || 'Location not recorded'}</div>
                </button>
              );
            })}
          </div>
        ) : <div className="bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center text-sm text-slate-500">No attended conferences recorded yet.</div>
      )}

      {activeTab === 'certificates' && (
        <CertificatesView
          userProfile={userProfile}
          submissions={submissions}
          registrations={registrations}
          conferences={conferences}
          onSelectConference={onSelectConference}
          currentUserId={currentUserId}
          currentUserEmail={currentUserEmail}
          professionalInvitations={professionalInvitations}
          onBack={() => setActiveTab('attended')}
        />
      )}
    </div>
  );
};
