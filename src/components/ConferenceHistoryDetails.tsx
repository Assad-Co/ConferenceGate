import React, { useEffect, useState } from 'react';
import { Building2, CalendarDays, ExternalLink, MapPin, Tags } from 'lucide-react';
import {
  ConferenceHistoryMatch,
  resolveConferenceHistoryRecord,
} from '../api/conferenceHistory';

interface ConferenceHistoryDetailsProps {
  title: string;
  year?: string | number | null;
  evidenceContext?: 'confirmed-attendance' | 'registration' | 'self-reported' | 'linkedin';
}

function formatDateRange(start?: string | null, end?: string | null) {
  if (!start) return null;
  const toText = (value: string) => {
    const parsed = new Date(`${value}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  };
  if (!end || end === start) return toText(start);
  return `${toText(start)} – ${toText(end)}`;
}

export const ConferenceHistoryDetails: React.FC<ConferenceHistoryDetailsProps> = ({
  title,
  year,
  evidenceContext,
}) => {
  const [match, setMatch] = useState<ConferenceHistoryMatch | null>(null);

  useEffect(() => {
    let active = true;
    resolveConferenceHistoryRecord(title, year).then((result) => {
      if (active) setMatch(result);
    });
    return () => {
      active = false;
    };
  }, [title, year]);

  if (!match) return null;

  const dateText = formatDateRange(match.startDate, match.endDate);
  const locationText = [match.venue, match.city, match.country]
    .filter((value, index, list) => value && list.indexOf(value) === index)
    .join(' · ');
  const tags = [...new Set([...(match.categories || []), ...(match.topics || [])])].slice(0, 4);
  const sections = (match.sections || []).slice(0, 5);
  const evidenceNote =
    evidenceContext === 'self-reported'
      ? 'Conference identity matched in ConferenceGate; your attendance remains self-reported.'
      : evidenceContext === 'linkedin'
      ? 'Conference identity matched in ConferenceGate; the profile role/attendance claim keeps its LinkedIn evidence label.'
      : null;

  return (
    <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/50 p-3 space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-blue-700">ConferenceGate conference record</span>
        {match.prepared && (
          <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[9px] font-bold text-emerald-700">
            Rich record
          </span>
        )}
        {match.cfpOpen && (
          <span className="rounded-full bg-violet-50 border border-violet-200 px-2 py-0.5 text-[9px] font-bold text-violet-700">
            Open call for papers
          </span>
        )}
      </div>

      {match.description && (
        <p className="text-[11px] leading-relaxed text-slate-600 line-clamp-2">{match.description}</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-[10px] text-slate-600">
        {dateText && (
          <div className="flex items-start gap-1.5">
            <CalendarDays className="w-3.5 h-3.5 text-blue-600 mt-0.5 shrink-0" />
            <span>{dateText}</span>
          </div>
        )}
        {locationText && (
          <div className="flex items-start gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-blue-600 mt-0.5 shrink-0" />
            <span>{locationText}</span>
          </div>
        )}
        {match.organizer && (
          <div className="flex items-start gap-1.5">
            <Building2 className="w-3.5 h-3.5 text-blue-600 mt-0.5 shrink-0" />
            <span>{match.organizer}</span>
          </div>
        )}
        {match.format && (
          <div className="flex items-start gap-1.5">
            <Tags className="w-3.5 h-3.5 text-blue-600 mt-0.5 shrink-0" />
            <span className="capitalize">{match.format.replace('-', ' ')}</span>
          </div>
        )}
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span key={tag} className="rounded-full bg-white border border-slate-200 px-2 py-0.5 text-[9px] font-medium text-slate-600">
              {tag}
            </span>
          ))}
        </div>
      )}

      {sections.length > 0 && (
        <p className="text-[10px] text-slate-500">
          Available details: {sections.map((section) => section.replace('_', ' ')).join(' · ')}
        </p>
      )}

      {evidenceNote && <p className="text-[10px] text-amber-700">{evidenceNote}</p>}

      {match.officialUrl && (
        <a
          href={match.officialUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-700 hover:text-blue-900"
        >
          Official conference website <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
};
