import React, { useEffect, useMemo, useState } from 'react';
import {
  Briefcase,
  Building2,
  CalendarDays,
  Loader2,
  MapPin,
  MessageSquareQuote,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  fetchOrganizationDirectory,
  type OrganizationEventFeedback,
  type OrganizationProfile,
  type OrganizationSponsorFeedback,
} from '../api/organizations';

const scoreLabel = (score: number) => {
  if (score >= 5.5) return 'Excellent';
  if (score >= 4.5) return 'Very Good';
  if (score >= 3.5) return 'Good';
  if (score >= 2.5) return 'Fair';
  if (score >= 1.5) return 'Poor';
  return score > 0 ? 'Very Poor' : 'New';
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'OR';

const displayDate = (value: string) => String(value || '').replace('T', ' ').slice(0, 10);

const ReputationTile: React.FC<{
  label: string;
  score: number;
  count: number;
  note: string;
}> = ({ label, score, count, note }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-4">
    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
    <div className="mt-1 flex items-end gap-2">
      <div className="text-2xl font-extrabold text-slate-900">{count ? `${score.toFixed(1)} / 6` : '—'}</div>
      {count > 0 && <span className="pb-1 text-[10px] font-bold text-emerald-700">{scoreLabel(score)}</span>}
    </div>
    <div className="mt-1 text-[10px] text-slate-500">{count} verified review{count === 1 ? '' : 's'} · {note}</div>
  </div>
);

const EventFeedbackCard: React.FC<{ item: OrganizationEventFeedback; verified: boolean }> = ({ item, verified }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div className="text-sm font-bold text-slate-900">{item.conferenceTitle}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
          <span>{item.role || 'Participant'}</span>
          <span>·</span>
          <span>{displayDate(item.date)}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-bold text-blue-800">{Number(item.overallScore || 0).toFixed(1)} / 6</span>
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold ${verified ? 'bg-emerald-100 text-emerald-800' : 'bg-violet-100 text-violet-800'}`}>
          {verified && <ShieldCheck className="h-3 w-3" />}
          {verified ? 'Verified conference relationship' : 'Organization name match'}
        </span>
      </div>
    </div>
    {item.comment && <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-700">{item.comment}</p>}
  </div>
);

const SponsorFeedbackCard: React.FC<{ item: OrganizationSponsorFeedback }> = ({ item }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div className="text-sm font-bold text-slate-900">{item.reviewerOrganization}</div>
        <div className="mt-0.5 text-[10px] text-slate-500">Organizer review · {item.conferenceTitle} · {displayDate(item.date)}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-bold text-blue-800">{Number(item.overallScore || 0).toFixed(1)} / 6</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold text-emerald-800">
          <ShieldCheck className="h-3 w-3" />Verified sponsorship
        </span>
      </div>
    </div>
    {Object.keys(item.ratings || {}).length > 0 && (
      <div className="text-[10px] font-semibold text-blue-700">Structured organizer evaluation · {Object.keys(item.ratings).length} criteria</div>
    )}
    {item.comment && <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-700">{item.comment}</p>}
  </div>
);

export const OrganizationDirectoryModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<'all' | 'organizer' | 'sponsor'>('all');
  const [profiles, setProfiles] = useState<OrganizationProfile[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'overview' | 'events' | 'sponsors'>('overview');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      fetchOrganizationDirectory({
        q: query.trim() || undefined,
        role: role === 'all' ? undefined : role,
        limit: 150,
      })
        .then((items) => setProfiles(items))
        .catch((err) => {
          setProfiles([]);
          setError(err instanceof Error ? err.message : 'Could not load organization directory.');
        })
        .finally(() => setLoading(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, role]);

  useEffect(() => {
    if (!profiles.length) {
      setSelectedKey('');
      return;
    }
    if (!profiles.some((profile) => profile.key === selectedKey)) {
      setSelectedKey(profiles[0].key);
      setTab('overview');
    }
  }, [profiles, selectedKey]);

  const selected = useMemo(
    () => profiles.find((profile) => profile.key === selectedKey) || null,
    [profiles, selectedKey]
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-3 sm:p-5" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="flex h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
          <div>
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-blue-700" />
              <h2 className="text-lg font-extrabold text-slate-900">Organization Directory & Reputation</h2>
            </div>
            <p className="mt-1 max-w-3xl text-xs text-slate-500">Organizer and Sponsor accounts are grouped by normalized organization identity. Only verified conference and sponsorship relationships contribute to the primary reputation scores.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer" aria-label="Close organization directory">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-b border-slate-200 bg-white lg:border-b-0 lg:border-r">
            <div className="space-y-3 border-b border-slate-100 p-4">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search organizations..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-xs outline-none focus:border-blue-400 focus:bg-white"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(['all', 'organizer', 'sponsor'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setRole(value)}
                    className={`rounded-xl border px-2 py-2 text-[10px] font-bold capitalize cursor-pointer ${role === value ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}
                  >
                    {value === 'all' ? 'All' : `${value}s`}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {loading ? (
                <div className="py-12 text-center text-xs text-slate-400"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />Loading organizations…</div>
              ) : error ? (
                <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-xs text-rose-700">{error}</div>
              ) : profiles.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400">No organizations match this search.</div>
              ) : (
                <div className="space-y-2">
                  {profiles.map((profile) => {
                    const active = profile.key === selectedKey;
                    return (
                      <button
                        key={profile.key}
                        type="button"
                        onClick={() => { setSelectedKey(profile.key); setTab('overview'); }}
                        className={`w-full rounded-2xl border p-3 text-left cursor-pointer transition ${active ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                      >
                        <div className="flex items-start gap-3">
                          {profile.logo ? (
                            <img src={profile.logo} alt="" className="h-10 w-10 shrink-0 rounded-xl border border-slate-200 object-cover" />
                          ) : (
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xs font-extrabold text-slate-600">{initials(profile.name)}</div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-bold text-slate-900">{profile.name}</div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {profile.roles.map((profileRole) => (
                                <span key={profileRole} className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold capitalize text-slate-600">{profileRole}</span>
                              ))}
                            </div>
                            <div className="mt-1.5 text-[10px] font-semibold text-emerald-700">
                              {profile.combinedReputation.verifiedCount ? `${profile.combinedReputation.score.toFixed(1)} / 6 · ${profile.combinedReputation.verifiedCount} verified` : 'New · no verified reviews yet'}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>

          <main className="min-h-0 overflow-y-auto p-4 sm:p-6">
            {!selected ? (
              <div className="flex h-full min-h-[300px] items-center justify-center text-center text-sm text-slate-400">Select an organization to view its reputation profile.</div>
            ) : (
              <div className="mx-auto max-w-5xl space-y-5">
                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                    {selected.logo ? (
                      <img src={selected.logo} alt="" className="h-20 w-20 shrink-0 rounded-2xl border border-slate-200 object-cover" />
                    ) : (
                      <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-xl font-extrabold text-blue-800">{initials(selected.name)}</div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-xl font-extrabold text-slate-900">{selected.name}</h3>
                        {selected.combinedReputation.verifiedCount > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold text-emerald-800"><ShieldCheck className="h-3 w-3" />Verified reputation</span>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {selected.roles.map((profileRole) => (
                          <span key={profileRole} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold capitalize text-blue-700">
                            {profileRole === 'sponsor' ? <Briefcase className="h-3 w-3" /> : <CalendarDays className="h-3 w-3" />}{profileRole}
                          </span>
                        ))}
                        {(selected.city || selected.country) && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600"><MapPin className="h-3 w-3" />{[selected.city, selected.country].filter(Boolean).join(', ')}</span>
                        )}
                      </div>
                      {selected.industry && <div className="mt-2 text-xs font-semibold text-slate-600">{selected.industry}</div>}
                      {selected.description && <p className="mt-2 max-w-3xl text-xs leading-5 text-slate-600">{selected.description}</p>}
                    </div>
                  </div>
                </section>

                <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <ReputationTile label="Combined Verified Reputation" score={selected.combinedReputation.score} count={selected.combinedReputation.verifiedCount} note="event + sponsor" />
                  <ReputationTile label="Event Reputation" score={selected.eventReputation.score} count={selected.eventReputation.verifiedCount} note={`${selected.eventReputation.nameMatchCount} name-only matches`} />
                  <ReputationTile label="Sponsor Reputation" score={selected.sponsorReputation.score} count={selected.sponsorReputation.verifiedCount} note="organizer evaluations" />
                </section>

                <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2">
                  {([
                    ['overview', 'Overview'],
                    ['events', `Event Feedback (${selected.verifiedEventFeedback.length + selected.nameMatchedEventFeedback.length})`],
                    ['sponsors', `Sponsor Feedback (${selected.sponsorFeedback.length})`],
                  ] as const).map(([value, label]) => (
                    <button key={value} type="button" onClick={() => setTab(value)} className={`rounded-xl px-3 py-2 text-[11px] font-bold cursor-pointer ${tab === value ? 'bg-blue-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{label}</button>
                  ))}
                </div>

                {tab === 'overview' && (
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <section className="rounded-3xl border border-slate-200 bg-white p-5">
                      <div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-blue-600" /><h4 className="text-sm font-bold text-slate-900">Event Reputation</h4></div>
                      <p className="mt-2 text-xs text-slate-500">Verified conference-linked evaluations contribute to this score. Normalized organization-name matches stay visible for transparency but do not affect the verified score.</p>
                      <div className="mt-4 text-3xl font-extrabold text-slate-900">{selected.eventReputation.verifiedCount ? selected.eventReputation.score.toFixed(1) : '—'}<span className="text-sm font-bold text-slate-400"> / 6</span></div>
                      <div className="mt-1 text-[10px] text-slate-500">{selected.eventReputation.verifiedCount} verified event reviews · {selected.eventReputation.nameMatchCount} name-only matches</div>
                    </section>
                    <section className="rounded-3xl border border-slate-200 bg-white p-5">
                      <div className="flex items-center gap-2"><Briefcase className="h-4 w-4 text-blue-600" /><h4 className="text-sm font-bold text-slate-900">Sponsor Reputation</h4></div>
                      <p className="mt-2 text-xs text-slate-500">Organizer evaluations shown here are tied to approved ConferenceGate sponsorship relationships and their specific conferences.</p>
                      <div className="mt-4 text-3xl font-extrabold text-slate-900">{selected.sponsorReputation.verifiedCount ? selected.sponsorReputation.score.toFixed(1) : '—'}<span className="text-sm font-bold text-slate-400"> / 6</span></div>
                      <div className="mt-1 text-[10px] text-slate-500">{selected.sponsorReputation.verifiedCount} verified sponsor reviews</div>
                    </section>
                  </div>
                )}

                {tab === 'events' && (
                  <div className="space-y-5">
                    <section className="space-y-3">
                      <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-600" /><h4 className="text-sm font-bold text-slate-900">Verified Event Feedback</h4></div>
                      {selected.verifiedEventFeedback.length ? selected.verifiedEventFeedback.map((item) => <EventFeedbackCard key={item.id} item={item} verified />) : <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-400">No verified event feedback yet.</div>}
                    </section>
                    {selected.nameMatchedEventFeedback.length > 0 && (
                      <section className="space-y-3">
                        <div>
                          <h4 className="text-sm font-bold text-violet-900">Organization Name Matches</h4>
                          <p className="mt-1 text-[11px] text-violet-700">Visible for transparency. These records are not included in the verified reputation score until a ConferenceGate event relationship is confirmed.</p>
                        </div>
                        {selected.nameMatchedEventFeedback.map((item) => <EventFeedbackCard key={item.id} item={item} verified={false} />)}
                      </section>
                    )}
                  </div>
                )}

                {tab === 'sponsors' && (
                  <section className="space-y-3">
                    <div className="flex items-center gap-2"><MessageSquareQuote className="h-4 w-4 text-blue-600" /><h4 className="text-sm font-bold text-slate-900">Feedback from Organizers</h4></div>
                    {selected.sponsorFeedback.length ? selected.sponsorFeedback.map((item) => <SponsorFeedbackCard key={item.id} item={item} />) : <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-400">No verified sponsor feedback yet.</div>}
                  </section>
                )}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
};

export default OrganizationDirectoryModal;
