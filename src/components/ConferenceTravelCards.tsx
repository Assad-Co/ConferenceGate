import React from 'react';
import { CalendarDays, ExternalLink, Plane, Route, ShieldCheck } from 'lucide-react';

type Props = {
  destination?: string | null;
  venue?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  travelText?: string | null;
  officialUrl?: string | null;
};

const validDate = (value?: string | null): string | null => {
  if (!value || !/^20\\d{2}-\\d{2}-\\d{2}$/.test(value)) return null;
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
  // Only show a named airport when the supplied conference guidance explicitly identifies it.
  // Never infer an airport or a travel time from a city name.
  if (!text || text.length > 5000) return null;
  const match = text.match(/\\b([A-Z][\\p{L}.'’ -]{2,65}\\s(?:International\\s)?Airport)\\s*(?:\\(([A-Z]{3})\\))?/iu);
  return match ? (match[2] ? match[1].trim() + ' (' + match[2] + ')' : match[1].trim()) : null;
};
const safeOfficialUrl = (url?: string | null): string | null => {
  try {
    const parsed = new URL(url || '');
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : null;
  } catch { return null; }
};

/** Practical, date-aware planning prompts; never invent flights, routes, fares or visa requirements. */
export const ConferenceTravelCards: React.FC<Props> = ({ destination, venue, startDate, endDate, travelText, officialUrl }) => {
  const start = validDate(startDate);
  const end = validDate(endDate) || start;
  const arrival = shiftDate(start, -1);
  const departure = shiftDate(end, 1);
  const airport = findNamedAirport(travelText);
  const place = [venue, destination].filter(Boolean).join(', ').trim();
  const flightsQuery = ['flights', destination || '', arrival || '', departure || ''].filter(Boolean).join(' ');
  const flightsUrl = 'https://www.google.com/search?q=' + encodeURIComponent(flightsQuery);
  const airportUrl = place ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('airports near ' + place) : null;
  const directionsUrl = place ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('airport transfer to ' + place) : null;
  const official = safeOfficialUrl(officialUrl);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-4" aria-label="Conference travel planning">
      <section className="rounded-xl border border-blue-100 bg-white p-4 space-y-2">
        <h4 className="flex items-center gap-2 font-bold text-slate-900 text-sm"><Plane className="w-4 h-4 text-blue-600" />Flights</h4>
        <p><strong>Nearest airport:</strong> {airport || 'Not confirmed from conference sources'}</p>
        {!airport && airportUrl && <a href={airportUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">Find nearby airports <ExternalLink className="inline w-3 h-3" /></a>}
        <p><strong>Suggested arrival:</strong> {readableDate(arrival) || 'Check conference dates'} {arrival && '(one day early)'}</p>
        <p><strong>Suggested departure:</strong> {readableDate(departure) || 'Check conference dates'} {departure && '(day after the event)'}</p>
        <a href={flightsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-blue-800 font-semibold">Search flights for event dates <ExternalLink className="w-3.5 h-3.5" /></a>
        <p className="text-[10px] text-slate-500">Search results are external; schedules, fares and availability are not verified here.</p>
      </section>
      <section className="rounded-xl border border-blue-100 bg-white p-4 space-y-2">
        <h4 className="flex items-center gap-2 font-bold text-slate-900 text-sm"><Route className="w-4 h-4 text-blue-600" />Airport transfer</h4>
        <p><strong>Taxi / ride-hailing:</strong> Check local options and live estimates.</p>
        <p><strong>Public transport:</strong> Confirm available routes for the arrival time.</p>
        <p><strong>Travel time:</strong> Check current directions; no verified estimate is available.</p>
        {directionsUrl ? <a href={directionsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-blue-700 font-semibold underline">View airport transfers <ExternalLink className="w-3.5 h-3.5" /></a> : <p className="text-slate-500">Venue location not yet confirmed.</p>}
      </section>
      <section className="rounded-xl border border-blue-100 bg-white p-4 space-y-2">
        <h4 className="flex items-center gap-2 font-bold text-slate-900 text-sm"><ShieldCheck className="w-4 h-4 text-blue-600" />Entry requirements</h4>
        <p><strong>Visa:</strong> Check current requirements with the relevant government or embassy.</p>
        <p><strong>Passport:</strong> Verify validity and entry rules for your nationality.</p>
        {official ? <a href={official} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-blue-700 font-semibold underline">Organizer's official travel information <ExternalLink className="w-3.5 h-3.5" /></a> : <p className="text-slate-500">No official organizer link available.</p>}
        <p className="text-[10px] text-slate-500">Organizer links may not contain visa advice; use official government guidance before booking.</p>
      </section>
    </div>
  );
};

/** Suppress obvious scraped navigation/Markdown dumps; keep valid short accommodation details unchanged. */
export function cleanAccommodationText(value?: string | null): string | null {
  const raw = (value || '').trim();
  if (!raw) return null;
  const navigation = /newsletter|subscribe to|explorer magazine|news-and-media|\\!\\[[^\\]]*\\]\\(/i;
  const markdown = /\\[[^\\]]+\\]\\(https?:\\/\\/|\\\\\\[|\\\\\\!\\[|\\\\\\\\/i;
  const urls = raw.match(/https?:\\/\\//g) || [];
  if (navigation.test(raw) || markdown.test(raw) || urls.length > 2 || raw.length > 900) return null;
  return raw;
}
