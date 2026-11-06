import React from 'react';
import { ExternalLink, Plane } from 'lucide-react';

type Props = {
  destination?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  travelText?: string | null;
};

const validDate = (value?: string | null): string | null => {
  if (!value || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
};
const shiftDate = (date: string | null, days: number): string | null => {
  if (!date) return null;
  const next = new Date(date + 'T12:00:00Z');
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
};
const readableDate = (value: string | null) =>
  value ? new Date(value + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : null;

const findNamedAirport = (text?: string | null): string | null => {
  if (!text || text.length > 5000) return null;
  const match = text.match(/\b([A-Z][\p{L}.'’ -]{2,65}\s(?:International\s)?Airport)\s*(?:\(([A-Z]{3})\))?/iu);
  return match ? (match[2] ? match[1].trim() + ' (' + match[2] + ')' : match[1].trim()) : null;
};

/** Flight search guidance inside the existing Travel & Airport Transit panel, not standalone cards. */
export const ConferenceTravelCards: React.FC<Props> = ({ destination, startDate, endDate, travelText }) => {
  const start = validDate(startDate);
  const end = validDate(endDate) || start;
  const arrival = shiftDate(start, -1);
  const departure = shiftDate(end, 1);
  const airport = findNamedAirport(travelText);
  const flightsQuery = ['flights', destination || '', arrival || '', departure || ''].filter(Boolean).join(' ');
  return (
    <div className="mt-3 pt-3 border-t border-slate-200 space-y-2" aria-label="Flight planning">
      <h4 className="flex items-center gap-2 text-sm font-bold text-slate-900"><Plane className="h-4 w-4 text-blue-600" /> Flights</h4>
      <p><strong>Airport:</strong> {airport || 'Check airports serving the conference city'}</p>
      <p><strong>Suggested arrival:</strong> {readableDate(arrival) || 'Confirm conference dates'}{arrival ? ' (one day before)' : ''}</p>
      <p><strong>Suggested departure:</strong> {readableDate(departure) || 'Confirm conference dates'}{departure ? ' (day after)' : ''}</p>
      {destination ? (
        <a href={'https://www.google.com/search?q=' + encodeURIComponent(flightsQuery)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-2 font-semibold text-blue-700">
          Search flights for event dates <ExternalLink className="w-3.5 h-3.5" />
        </a>
      ) : <p className="text-slate-500">Destination unavailable; see the official conference location first.</p>}
      <p className="text-[10px] text-slate-500">External flight search; times, routes, and availability are not verified by ConferenceGate.</p>
    </div>
  );
};

/** Suppress obvious scraped navigation/Markdown dumps; keep valid short accommodation details unchanged. */
export function cleanAccommodationText(value?: string | null): string | null {
  const raw = (value || '').trim();
  if (!raw) return null;
  const navigation = /newsletter|subscribe to|explorer magazine|news-and-media|\!\[[^\]]*\]\(/i;
  const markdown = /\[[^\]]+\]\(https?:\/\/|\\\[|\\\!\[|\\\\/i;
  const urls = raw.match(/https?:\/\//g) || [];
  if (navigation.test(raw) || markdown.test(raw) || urls.length > 2 || raw.length > 900) return null;
  return raw;
}
