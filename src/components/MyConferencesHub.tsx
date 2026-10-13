import React, { useEffect, useMemo, useState } from 'react';
import { Bookmark, Bell, CalendarCheck, CheckCircle2, Award, Globe2 } from 'lucide-react';
import type { AbstractSubmission, Conference, ProfessionalInvitation, UserProfile } from '../types';
import type { ConferenceAttendance, ConferenceRegistration } from '../api/activity';
import { searchConferencesOnTheWeb, type LiveSearchResult } from '../api/search';
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
  onOpenExternalResult: (result: LiveSearchResult) => void;
}

type HubTab = 'saved' | 'following' | 'registered' | 'attended' | 'certificates';

type HubConference =
  | { kind: 'native'; id: string; conference: Conference }
  | { kind: 'catalog'; id: string; result: LiveSearchResult };

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
  onOpenExternalResult,
}) => {
  const [activeTab, setActiveTab] = useState<HubTab>('saved');
  const [catalogue, setCatalogue] = useState<LiveSearchResult[]>([]);
  const [catalogueLoading, setCatalogueLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setCatalogueLoading(true);
    searchConferencesOnTheWeb('', 'low', false)
      .then((results) => {
        if (active) setCatalogue(results);
      })
      .catch(() => {
        if (active) setCatalogue([]);
      })
      .finally(() => {
        if (active) setCatalogueLoading(false);
      });
    return () => { active = false; };
  }, []);

  const conferenceById = useMemo(
    () => new Map(conferences.map((conference) => [conference.id, conference])),
    [conferences]
  );
  const catalogueById = useMemo(
    () => new Map(catalogue.map((result) => [result.link, result])),
    [catalogue]
  );

  const resolveInteraction = (id: string): HubConference | null => {
    const native = conferenceById.get(id);
    if (native) return { kind: 'native', id, conference: native };
    const external = catalogueById.get(id);
    if (external) return { kind: 'catalog', id, result: external };
    return null;
  };

  const saved = savedConferenceIds.map(resolveInteraction).filter(Boolean) as HubConference[];
  const following = followedConferenceIds.map(resolveInteraction).filter(Boolean) as HubConference[];
  const unresolvedSavedCount = Math.max(0, savedConferenceIds.length - saved.length);
  const unresolvedFollowingCount = Math.max(0, followedConferenceIds.length - following.length);

  const openHubConference = (item: HubConference) => {
    if (item.kind === 'native') onSelectConference(item.conference);
    else onOpenExternalResult(item.result);
  };

  const renderConferenceCards = (items: HubConference[], empty: string, unresolvedCount = 0) => (
    <div className="space-y-3">
      {items.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map((item) => {
            const title = item.kind === 'native' ? item.conference.title : item.result.title;
            const city = item.kind === 'native' ? item.conference.location?.city : item.result.location?.city;
            const country = item.kind === 'native' ? item.conference.location?.country : item.result.location?.country;
            const organizer = item.kind === 'native' ? item.conference.organizerName : item.result.organization;
            return (
              <button
                key={`${item.kind}-${item.id}`}
                onClick={() => openHubConference(item)}
                className="text-left bg-white rounded-xl border border-slate-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="font-extrabold text-sm text-slate-900 line-clamp-2">{title}</div>
                  {item.kind === 'catalog' && <Globe2 className="w-4 h-4 text-indigo-500 shrink-0" />}
                </div>
                {(city || country) && <div className="mt-2 text-xs text-slate-500">{[city, country].filter(Boolean).join(', ')}</div>}
                {organizer && <div className="mt-1 text-[11px] text-slate-400 line-clamp-1">{organizer}</div>}
                <div className="mt-3 text-xs font-bold text-blue-700">{item.kind === 'catalog' ? 'Open worldwide conference' : 'Open conference'}</div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center text-sm text-slate-500">
          {catalogueLoading ? 'Loading your worldwide conference list…' : empty}
        </div>
      )}
      {!catalogueLoading && unresolvedCount > 0 && (
        <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          {unresolvedCount} saved conference record{unresolvedCount === 1 ? '' : 's'} could not be matched to the current catalogue. The saved reference is still preserved in your account.
        </div>
      )}
    </div>
  );

  const openRecordedConference = (conferenceId: string, sourceUrl?: string | null) => {
    const native = conferenceById.get(conferenceId);
    if (native) {
      onSelectConference(native);
      return;
    }
    const external = catalogueById.get(sourceUrl || conferenceId);
    if (external) onOpenExternalResult(external);
  };

  return (
    <div className="max-w-6xl mx-auto w-full space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">My Conferences</h1>
        <p className="text-sm text-slate-500 mt-1">Everything you save, follow, register for, attend, or earn from Conference Gate and the worldwide catalogue in one place.</p>
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

      {activeTab === 'saved' && renderConferenceCards(saved, 'No saved conferences yet. Save any Conference Gate or worldwide conference from Discover to keep it here.', unresolvedSavedCount)}
      {activeTab === 'following' && renderConferenceCards(following, 'You are not following any conferences yet.', unresolvedFollowingCount)}

      {activeTab === 'registered' && (
        registrations.length ? (
          <div className="space-y-3">
            {registrations.map((registration) => {
              const native = conferenceById.get(registration.conferenceId);
              const external = catalogueById.get(registration.conferenceId);
              const canOpen = Boolean(native || external);
              return (
                <button
                  key={`${registration.conferenceId}-${registration.registeredAt}`}
                  onClick={() => openRecordedConference(registration.conferenceId)}
                  disabled={!canOpen}
                  className="w-full text-left bg-white border border-slate-200 rounded-xl p-4 disabled:cursor-default enabled:hover:border-blue-300 cursor-pointer"
                >
                  <div className="font-extrabold text-sm text-slate-900">{registration.conferenceTitle}</div>
                  <div className="mt-1 text-xs text-slate-500">{registration.packageName || 'Registered attendee'} · Registered {new Date(registration.registeredAt).toLocaleDateString()}</div>
                  {!canOpen && <div className="mt-2 text-[10px] text-slate-400">Registration is preserved even though the conference detail record is no longer in the active catalogue.</div>}
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
              const native = conferenceById.get(item.conferenceId);
              const external = catalogueById.get(item.sourceUrl || item.conferenceId);
              const canOpen = Boolean(native || external);
              return (
                <button
                  key={item.id}
                  onClick={() => openRecordedConference(item.conferenceId, item.sourceUrl)}
                  disabled={!canOpen}
                  className="w-full text-left bg-white border border-slate-200 rounded-xl p-4 disabled:cursor-default enabled:hover:border-blue-300 cursor-pointer"
                >
                  <div className="font-extrabold text-sm text-slate-900">{item.conferenceTitle}</div>
                  <div className="mt-1 text-xs text-slate-500">{item.organizerName} · {item.location || 'Location not recorded'}</div>
                  <div className="mt-1 text-[10px] font-semibold text-slate-400">{item.sourceType === 'catalog' ? 'Worldwide catalogue' : 'Conference Gate hosted'}</div>
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
