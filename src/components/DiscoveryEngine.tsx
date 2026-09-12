import React, { useEffect, useMemo, useRef, useState } from 'react';
import { conferenceInitials, markSizeClass } from '../utils/conferenceMark';
import {
  CalendarDays,
  Search,
  Bookmark,
  Users,
  Globe,
  Hotel,
  BookOpen,
  Map as MapIcon,
  Loader2,
  AlertCircle,
  FileText,
  UserCheck,
  Briefcase,
  MapPin,
  CalendarRange,
  DollarSign,
  X,
  RefreshCw,
  Leaf,
  ArrowRight,
} from 'lucide-react';
import { Conference } from '../types';
import { formatDateRange, formatDay, formatMonthShort, conferenceDurationDays } from '../utils/date';
import { generateInitialsAvatar, getInitials } from '../utils/avatar';
import { countryOptionsFor, matchesCountry, withinDateWindow } from '../utils/conferenceFilter';
import {
  searchConferencesOnTheWeb,
  LiveSearchResult,
} from '../api/search';
import { ExternalDetailTab } from './ExternalConferenceDetail';

interface DiscoveryEngineProps {
  conferences: Conference[];
  onSelectConference: (conf: Conference) => void;
  onOpenSubmitAbstract: (confId?: string) => void;
  onOpenExternalResult: (result: LiveSearchResult, tab?: ExternalDetailTab) => void;
  initialSearchQuery?: string;
  savedConferenceIds?: string[];
  followedConferenceIds?: string[];
  onToggleSave?: (conferenceId: string) => void;
  onToggleFollow?: (conferenceId: string) => void;
}

// Merging results from several parallel queries needs a way to tell "the same conference turned
// up twice" apart from "two different conferences happen to share a host" — a university, a
// professional society (IEEE, ASME...), or a shared conference-hosting platform can easily run
// dozens of distinct, genuinely different conferences under one domain. Deduping by hostname alone
// (the previous approach) collapsed all of those down to a single card, which is exactly why a
// broad topic search came back with far fewer results than actually exist. Stripping dates,
// edition ordinals, and page-section labels from the title instead identifies the conference
// itself, the same normalization the server already applies when deciding two Brave results are
// the same event.
function liveResultIdentity(title: string): string {
  const parts = title
    .split(/\s+[|–—-]\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const meaningful =
    parts
      .filter((part) => !/^(home|program|programme|agenda|speakers?|registration|about|official site)$/i.test(part))
      .sort((a, b) => b.length - a.length)[0] || title;

  return meaningful
    .toLowerCase()
    .replace(/\b20\d{2}\b/g, ' ')
    .replace(/\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/g, ' ')
    .replace(/\b\d{1,2}(?:st|nd|rd|th)?\b/g, ' ')
    .replace(/\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|annual|edition|official|website|home)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const DISCOVERY_MINIMUM_MONTH = '2026-09';

function liveResultFitsDateWindow(
  result: LiveSearchResult,
  startMonth: string,
  endMonth: string
): boolean {
  // Title only. A stored record's snippet is its own description, and "building on our March 2026
  // meeting" is not evidence that a 2027 conference is out of range — reading it as such is what
  // hid genuine results. An archived edition still announces its year in its title.
  const text = `${result.title || ''}`.toLowerCase();
  const yearMatches = [...text.matchAll(/\b(20\d{2})\b/g)];
  if (yearMatches.length === 0) return true;

  const startYear = Number(startMonth.slice(0, 4));
  const endYear = endMonth ? Number(endMonth.slice(0, 4)) : null;
  const years = yearMatches.map((match) => Number(match[1]));

  // Search snippets often omit the month, but an explicit old year is enough to reject an
  // archived edition. Unknown-year results remain eligible and are verified on their detail page.
  if (years.every((year) => year < startYear)) return false;
  if (endYear !== null && years.every((year) => year > endYear)) return false;

  const monthNumbers: Record<string, number> = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
    apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
    aug: 8, august: 8, sep: 9, sept: 9, september: 9,
    oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  };
  const explicitMonths: string[] = [];
  for (const match of yearMatches) {
    const year = Number(match[1]);
    const index = match.index || 0;
    const nearby = text.slice(Math.max(0, index - 22), index + match[0].length + 22);
    const monthMatch = nearby.match(/\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\b/);
    if (!monthMatch) continue;
    explicitMonths.push(`${year}-${String(monthNumbers[monthMatch[1]]).padStart(2, '0')}`);
  }

  // When a result gives an exact month, enforce the selected range precisely. When it gives only
  // a current/future year, keep it so a real upcoming conference is not discarded for a sparse
  // search snippet.
  if (explicitMonths.length > 0) {
    return explicitMonths.some(
      (month) => month >= startMonth && (!endMonth || month <= endMonth)
    );
  }
  return years.some((year) => year >= startYear && (endYear === null || year <= endYear));
}

function liveSearchResultRelevance(result: LiveSearchResult, query: string): number {
  const normalize = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return 0;

  const title = normalize(result.title || '');
  const host = normalize(result.displayLink || '');
  const snippet = normalize(result.snippet || '');
  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  let score = 0;

  if (title === normalizedQuery) score += 10000;
  else if (title.startsWith(`${normalizedQuery} `)) score += 7000;
  else if (new RegExp(`(^| )${normalizedQuery}( |$)`).test(title)) score += 5500;
  else if (title.includes(normalizedQuery)) score += 4000;

  if (host.includes(normalizedQuery.replace(/\s+/g, ''))) score += 1800;
  score += queryTokens.filter((token) => title.split(' ').includes(token)).length * 500;
  score += queryTokens.filter((token) => snippet.includes(token)).length * 80;
  return score;
}

function rankLiveSearchResults(results: LiveSearchResult[], query: string): LiveSearchResult[] {
  return results
    .map((result, index) => ({ result, index, score: liveSearchResultRelevance(result, query) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ result }) => result);
}

/**
 * A conference's mark: its own logo where a source stated one, its name where the icon is not its.
 *
 * Every icon here is derived — /favicon.ico on the host of the conference's official URL — and that
 * file is the *host's* mark. For a conference on its own domain the two are the same thing. For the
 * fourteen Elsevier congresses, the ten Cell Press symposia and the six AAPG workshops in the
 * catalogue they are not: showing Elsevier's icon as each congress's logo says something false, and
 * lands fourteen cards that a reader cannot tell apart.
 *
 * That distinction used to be drawn in shape: a `stated` logo filled the panel, an `organiser` one
 * shrank to a badge in the corner beside the conference's initials. It read as a blemish on the
 * mark rather than as a statement about it — "FINANCE" clipped in the tile with a small black F
 * stuck to its edge — so the distinction now lives in the tooltip and the alt text, which is where
 * a claim about whose mark this is belongs, and both fill the tile.
 *
 * What keeps that honest is that the mark is usually the conference's own now: 241 of 292 records
 * carry a logo their own site published, against 108 when the badge was introduced. The 51 that do
 * not show their organiser's, named as the organiser's on hover.
 *
 * The icon may also simply not exist — a site declaring it in markup alone answers this path with a
 * 404 — so a failed load falls back to the conference's initials, which is the same mark a
 * conference with no site of its own gets.
 */
const ConferenceLogo: React.FC<{ result: LiveSearchResult; className?: string }> = ({ result, className }) => {
  const [failed, setFailed] = React.useState(false);
  const abbreviation = fallbackConferenceAbbreviation(result);
  const icon = failed ? null : result.favicon;
  const isOwnLogo = result.logoSource === 'stated';

  if (icon) {
    // `object-contain` is what makes it the whole logo: a wordmark is far wider than it is tall, and
    // cropping it to a square would cut the conference's name off its own mark.
    return (
      <img
        src={icon}
        alt={isOwnLogo ? `${abbreviation} logo` : `${organiserHost(result)} logo`}
        // An organiser's mark is still not the edition's, and the tooltip is where that is said now
        // that both fill the tile. See the note on the component.
        title={isOwnLogo ? undefined : `Organiser: ${organiserHost(result)}`}
        onError={() => setFailed(true)}
        // A conference's logo is served by the conference's own host, and a good number of them
        // refuse a request whose Referer is somebody else's site — which arrives here as a load
        // error and silently demotes a real logo to initials. Sending no referrer at all is what
        // stops a hotlink rule turning a fact the source stated into a fallback.
        referrerPolicy="no-referrer"
        loading="lazy"
        decoding="async"
        className={className ?? 'max-w-full max-h-full object-contain'}
      />
    );
  }

  // No image at all, or one that would not load. "GASTECH" does not fit where "G2" did, so the mark
  // is sized to its length rather than overflowing the tile it sits in.
  return (
    <span className={`${markSizeClass(abbreviation)} max-w-full break-words font-black tracking-wide text-black text-center leading-tight`}>
      {abbreviation}
    </span>
  );
};

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The card's one date line: "24–27 May 2026".
 *
 * Day-first, because the card leads with the thing that differs between two editions of the same
 * conference. Deliberately not `utils/date`'s `formatDateRange`, which is the house style
 * everywhere else ("Jun 25 – 28, 2026") and is used on pages this card does not own; changing it
 * to suit one card would restyle every date in the app.
 *
 * Returns null rather than a guess when there is no usable start date — a card with no date says
 * nothing about when, which is the same rule the rest of the catalogue follows.
 */
function discoverDateLine(startIso?: string | null, endIso?: string | null): string | null {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!startIso || !iso.test(startIso)) return startIso || null;
  const [sy, sm, sd] = startIso.split('-').map(Number);
  const day = (n: number) => String(n);
  if (!endIso || !iso.test(endIso) || endIso === startIso) {
    return `${day(sd)} ${MONTH_SHORT[sm - 1]} ${sy}`;
  }
  const [ey, em, ed] = endIso.split('-').map(Number);
  if (sy === ey && sm === em) return `${day(sd)}–${day(ed)} ${MONTH_SHORT[sm - 1]} ${sy}`;
  if (sy === ey) return `${day(sd)} ${MONTH_SHORT[sm - 1]} – ${day(ed)} ${MONTH_SHORT[em - 1]} ${sy}`;
  return `${day(sd)} ${MONTH_SHORT[sm - 1]} ${sy} – ${day(ed)} ${MONTH_SHORT[em - 1]} ${ey}`;
}

/** How the conference is held, in the words the chip shows. Null where the source did not say. */
function formatChipLabel(format?: string | null): string | null {
  if (format === 'in-person') return 'In-Person';
  if (format === 'hybrid') return 'Hybrid';
  if (format === 'online') return 'Online';
  return null;
}

/** The host the organiser's mark came from, for the badge's tooltip. */
function organiserHost(result: LiveSearchResult): string {
  try {
    return new URL(result.favicon ?? result.link).hostname.replace(/^www\./, '');
  } catch {
    return result.displayLink || 'the organiser';
  }
}

/** A stated short name, once the edition year it carries is taken off: "Black Hat India 2026" is
 *  Black Hat India, and the card already shows the year as data. */
function statedShortName(acronym: string | null | undefined): string | null {
  const name = (acronym ?? '').replace(/\b(?:19|20)\d{2}\b/g, '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 20) return null;
  // "Cell Press Symposium" is the series, not this symposium, and three records share it. A name
  // that only repeats what the title's own prefix says cannot tell one card from another.
  if (/^(?:cell press symposium|conference|symposium|symposia|congress|summit|meeting)$/i.test(name)) return null;
  return name.toUpperCase();
}

function fallbackConferenceAbbreviation(result: LiveSearchResult): string {
  // What the source calls it beats anything read off the title: five Black Hats are Black Hat
  // India, MEA, Europe, Asia and USA, and no rule applied to their titles recovers that.
  const stated = statedShortName(result.acronym);
  if (stated) return stated;

  let host = result.displayLink || '';
  try {
    host = new URL(result.link).hostname.replace(/^www\./, '');
  } catch {
    // Keep the search provider's display host when the URL is malformed.
  }

  // The requested ASEE annual-conference card uses this public-facing abbreviation.
  if (/(^|\.)asee\.org$/i.test(host)) return 'AAESE';

  const fromTitle = conferenceInitials(result.title, result.organization);
  // A host brand beats bare initials, but never a word the title itself supplied.
  if (fromTitle.length >= 3) return fromTitle;
  const hostBrand = host.split('.')[0]?.replace(/[^a-z0-9]/gi, '') || '';
  if (hostBrand.length >= 2 && hostBrand.length <= 9 && !/^www$/i.test(hostBrand)) {
    return hostBrand.toUpperCase();
  }
  return fromTitle;
}

const DISCOVERY_SUGGESTIONS = [
  'Artificial Intelligence',
  'Cybersecurity',
  'Engineering',
  'Healthcare',
  'Energy',
  'Sustainability',
  'Business',
  'Virtual conferences',
  'Open call for papers',
];

// Common global conference destinations. Organizer-created Conference Gate locations are merged
// into this at runtime, so a newly added country/city automatically appears without a code change.
const CONFERENCE_CITIES_BY_COUNTRY: Record<string, string[]> = {
  'Argentina': ['Buenos Aires', 'Córdoba', 'Mendoza'],
  'Australia': ['Brisbane', 'Melbourne', 'Perth', 'Sydney'],
  'Austria': ['Graz', 'Salzburg', 'Vienna'],
  'Bahrain': ['Manama'],
  'Belgium': ['Antwerp', 'Brussels', 'Ghent'],
  'Brazil': ['Brasília', 'Rio de Janeiro', 'São Paulo'],
  'Canada': ['Calgary', 'Montréal', 'Ottawa', 'Toronto', 'Vancouver'],
  'Chile': ['Santiago'],
  'China': ['Beijing', 'Guangzhou', 'Hangzhou', 'Shanghai', 'Shenzhen'],
  'Colombia': ['Bogotá', 'Cartagena', 'Medellín'],
  'Czechia': ['Brno', 'Prague'],
  'Denmark': ['Aarhus', 'Copenhagen'],
  'Egypt': ['Alexandria', 'Cairo', 'Sharm El Sheikh'],
  'Finland': ['Espoo', 'Helsinki', 'Tampere'],
  'France': ['Lyon', 'Marseille', 'Nice', 'Paris'],
  'Germany': ['Berlin', 'Cologne', 'Frankfurt', 'Hamburg', 'Munich'],
  'Ghana': ['Accra'],
  'Greece': ['Athens', 'Thessaloniki'],
  'Hong Kong': ['Hong Kong'],
  'Hungary': ['Budapest'],
  'India': ['Bengaluru', 'Chennai', 'Delhi', 'Hyderabad', 'Mumbai', 'Pune'],
  'Indonesia': ['Bali', 'Jakarta', 'Surabaya'],
  'Ireland': ['Cork', 'Dublin', 'Galway'],
  'Italy': ['Florence', 'Milan', 'Rome', 'Turin', 'Venice'],
  'Japan': ['Kyoto', 'Osaka', 'Tokyo', 'Yokohama'],
  'Jordan': ['Amman', 'Aqaba'],
  'Kenya': ['Mombasa', 'Nairobi'],
  'Kuwait': ['Kuwait City'],
  'Malaysia': ['Kuala Lumpur', 'Penang'],
  'Mexico': ['Cancún', 'Guadalajara', 'Mexico City', 'Monterrey'],
  'Morocco': ['Casablanca', 'Marrakesh', 'Rabat'],
  'Netherlands': ['Amsterdam', 'Eindhoven', 'Rotterdam', 'The Hague'],
  'New Zealand': ['Auckland', 'Christchurch', 'Wellington'],
  'Nigeria': ['Abuja', 'Lagos'],
  'Norway': ['Bergen', 'Oslo', 'Trondheim'],
  'Oman': ['Muscat'],
  'Pakistan': ['Islamabad', 'Karachi', 'Lahore'],
  'Philippines': ['Cebu', 'Manila'],
  'Poland': ['Kraków', 'Warsaw', 'Wrocław'],
  'Portugal': ['Lisbon', 'Porto'],
  'Qatar': ['Doha'],
  'Romania': ['Bucharest', 'Cluj-Napoca'],
  'Saudi Arabia': ['Al Khobar', 'AlUla', 'Dammam', 'Dhahran', 'Jeddah', 'Riyadh'],
  'Singapore': ['Singapore'],
  'South Africa': ['Cape Town', 'Durban', 'Johannesburg', 'Pretoria'],
  'South Korea': ['Busan', 'Seoul'],
  'Spain': ['Barcelona', 'Madrid', 'Málaga', 'Valencia'],
  'Sweden': ['Gothenburg', 'Malmö', 'Stockholm'],
  'Switzerland': ['Basel', 'Geneva', 'Lausanne', 'Zurich'],
  'Taiwan': ['Kaohsiung', 'Taipei'],
  'Thailand': ['Bangkok', 'Chiang Mai', 'Phuket'],
  'Tunisia': ['Hammamet', 'Tunis'],
  'Turkey': ['Ankara', 'Antalya', 'Istanbul', 'Izmir'],
  'United Arab Emirates': ['Abu Dhabi', 'Dubai', 'Sharjah'],
  'United Kingdom': ['Birmingham', 'Edinburgh', 'Glasgow', 'London', 'Manchester'],
  'United States': ['Atlanta', 'Austin', 'Boston', 'Chicago', 'Dallas', 'Denver', 'Houston', 'Las Vegas', 'Los Angeles', 'Miami', 'New York', 'Orlando', 'Philadelphia', 'San Diego', 'San Francisco', 'Seattle', 'Washington, DC'],
  'Vietnam': ['Da Nang', 'Hanoi', 'Ho Chi Minh City'],
};

// "YYYY-MM" for next calendar month from today, e.g. "2026-09" when today is any day in
// August 2026 — computed at load time (never hardcoded) so the default start-date filter
// always means "next month onward" and never goes stale.
const nextMonthValue = (): string => {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return nextMonth < DISCOVERY_MINIMUM_MONTH ? DISCOVERY_MINIMUM_MONTH : nextMonth;
};

const DISCOVERY_MONTH_OPTIONS = [
  { value: '01', label: 'Jan' },
  { value: '02', label: 'Feb' },
  { value: '03', label: 'Mar' },
  { value: '04', label: 'Apr' },
  { value: '05', label: 'May' },
  { value: '06', label: 'Jun' },
  { value: '07', label: 'Jul' },
  { value: '08', label: 'Aug' },
  { value: '09', label: 'Sep' },
  { value: '10', label: 'Oct' },
  { value: '11', label: 'Nov' },
  { value: '12', label: 'Dec' },
];

const discoveryCurrentYear = new Date().getFullYear();
const DISCOVERY_YEAR_OPTIONS = Array.from(
  { length: 15 },
  (_, index) => String(discoveryCurrentYear + index)
);

export const DiscoveryEngine: React.FC<DiscoveryEngineProps> = ({
  conferences,
  onSelectConference,
  onOpenSubmitAbstract,
  onOpenExternalResult,
  initialSearchQuery = '',
  savedConferenceIds = [],
  followedConferenceIds = [],
  onToggleSave,
  onToggleFollow,
}) => {
  const [searchTerm, setSearchInput] = useState(initialSearchQuery);
  // Editing the box only filters the local catalog. A live web request is made once, when the
  // visitor presses Enter or clicks Search, so one search never consumes a batch of provider calls.
  const [submittedSearchTerm, setSubmittedSearchTerm] = useState(initialSearchQuery);
  const [searchSubmitCount, setSearchSubmitCount] = useState(0);
  // "YYYY-MM" — only conferences whose real start date falls in this month or later are shown.
  // Defaults to next month onward (see nextMonthValue above); cleared to '' shows every date.
  const [startFromMonth, setStartFromMonth] = useState(nextMonthValue());
  const [endAtMonth, setEndAtMonth] = useState('');
  const effectiveStartMonth =
    startFromMonth && startFromMonth > DISCOVERY_MINIMUM_MONTH
      ? startFromMonth
      : DISCOVERY_MINIMUM_MONTH;

  const updateStartBoundary = (nextValue: string) => {
    setStartFromMonth(nextValue);
    if (nextValue && endAtMonth && endAtMonth < nextValue) {
      setEndAtMonth(nextValue);
    }
  };

  const updateEndBoundary = (nextValue: string) => {
    if (nextValue && startFromMonth && nextValue < startFromMonth) {
      setEndAtMonth(startFromMonth);
      return;
    }
    setEndAtMonth(nextValue);
  };

  const [locationFilter, setLocationFilter] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const [formatFilter, setFormatFilter] = useState('');
  const [timingFilter, setTimingFilter] = useState('');

  // The real lowest published registration price for a conference — the figure a reader actually
  // compares against when deciding whether an event is in their budget. Only conferences with at
  // least one priced package have a number here; an empty packages list means pricing was never
  // entered, not that the event is free, so it stays null rather than being guessed as $0.
  const startingPriceOf = (conf: Conference): number | null => {
    const prices = (conf.registrationPackages || [])
      .map((pkg) => pkg.price)
      .filter((price): price is number => typeof price === 'number' && Number.isFinite(price) && price >= 0);
    return prices.length > 0 ? Math.min(...prices) : null;
  };

  // Preferred when it exists: the slider's ends derived from real prices in the current catalog,
  // the same way locationOptions below is derived from real conference locations. Falls back to a
  // conventional registration-fee range when the catalog has no priced conferences yet — that
  // default isn't a claim about this catalog's actual prices (it never filters anything out on
  // its own), it's a starting point the reader can drag from, and it still biases the live web
  // search below the moment they touch it, which doesn't depend on catalog data existing at all.
  const DEFAULT_PRICE_BOUNDS = { min: 0, max: 2000 };
  const catalogPriceBounds = useMemo(() => {
    const prices = (conferences || [])
      .map((conf) => startingPriceOf(conf))
      .filter((price): price is number => price !== null);
    if (prices.length === 0) return null;
    return { min: Math.floor(Math.min(...prices)), max: Math.ceil(Math.max(...prices)) };
  }, [conferences]);
  // A catalog with only one priced conference gives min === max — not a draggable range either,
  // so that's treated the same as "no real bounds yet" rather than rendering a slider with both
  // handles locked to the same spot. The default's own ceiling still widens to cover a real price
  // above it, so that one conference's actual price is always reachable on the slider.
  const priceBounds =
    catalogPriceBounds && catalogPriceBounds.max > catalogPriceBounds.min
      ? catalogPriceBounds
      : { min: DEFAULT_PRICE_BOUNDS.min, max: Math.max(DEFAULT_PRICE_BOUNDS.max, catalogPriceBounds?.max ?? 0) };

  // null = "still tracking the live catalog bounds automatically" (the default, unfiltered
  // state); becomes a fixed pair the moment the reader drags a handle, so their chosen range
  // survives even if the catalog's own min/max shifts afterward.
  const [priceRange, setPriceRange] = useState<[number, number] | null>(null);
  const priceFilterActive = priceRange !== null;
  const [priceMin, priceMax] = priceRange ?? [priceBounds.min, priceBounds.max];
  const formatPrice = (value: number) => `$${Math.round(value).toLocaleString('en-US')}`;


  const savedIds = savedConferenceIds;
  const followedIds = followedConferenceIds;

  const toggleSave = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleSave?.(id);
  };

  const toggleFollow = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleFollow?.(id);
  };

  // Real conferences created by organizers through Conference Gate itself — the only ones that
  // support the app's own Submit Abstract / Registration workflows. Only applies to this catalog
  // (not the live web results below), since only these have a real, structured start date to
  // filter on — a web search snippet's date, if any, is free text we'd have to guess-parse.
  const filtered = (conferences || []).filter((conf) => {
    const term = searchTerm.trim().toLowerCase();
    const locationTerm = locationFilter.trim().toLowerCase();
    const countryTerm = countryFilter.trim().toLowerCase();
    const formatTerm = formatFilter.trim().toLowerCase().replace(/[-\s]+/g, '');

    const confLocation = [
      conf.location?.city,
      conf.location?.venue,
      conf.location?.country,
    ].filter(Boolean).join(' ').toLowerCase();
    const confCountry = (conf.location?.country || '').toLowerCase();
    const confFormat = (conf.format || '').toLowerCase().replace(/[-\s]+/g, '');
    const duration = conferenceDurationDays(conf.dates.start, conf.dates.end);
    const startDay = new Date(`${conf.dates.start}T12:00:00`).getDay();
    const endDay = new Date(`${conf.dates.end}T12:00:00`).getDay();
    const touchesWeekend = [startDay, endDay].some((day) => day === 0 || day === 6);

    if (
      term &&
      !(conf.title || '').toLowerCase().includes(term) &&
      !(conf.description || '').toLowerCase().includes(term) &&
      !(conf.topics || []).some((topic) => topic.toLowerCase().includes(term))
    ) return false;
    // An undated conference is not a past one: see withinDateWindow.
    if (!withinDateWindow({ start: conf.dates.start }, { effectiveStartMonth, endAtMonth })) return false;
    if (locationTerm && !confLocation.includes(locationTerm)) return false;
    if (countryTerm && !confCountry.includes(countryTerm)) return false;
    if (formatTerm && confFormat !== formatTerm) return false;
    if (timingFilter === 'one-day' && duration !== 1) return false;
    if (timingFilter === 'multi-day' && duration < 2) return false;
    if (timingFilter === 'weekend' && !touchesWeekend) return false;
    if (timingFilter === 'weekday' && touchesWeekend) return false;
    if (priceFilterActive) {
      const startingPrice = startingPriceOf(conf);
      // Excluded rather than assumed free or assumed in-range — the reader has deliberately
      // narrowed the range, and an event Conference Gate has no price for cannot be honestly
      // confirmed to fit it.
      if (startingPrice === null) return false;
      if (startingPrice < priceMin || startingPrice > priceMax) return false;
    }
    return true;
  });

  // Live web results always populate the page — the typed search term if there is one,
  // otherwise a fixed default query so Discover is never empty.
  const [webResults, setWebResults] = useState<LiveSearchResult[] | null>(null);

  const locationOptions = useMemo(() => {
    // Built from the conferences actually loaded, never from the static table.
    //
    // Seeding this from CONFERENCE_CITIES_BY_COUNTRY offered all fifty-seven countries whether or
    // not a single loaded conference was held in one. Selecting Germany then filtered a set
    // containing no German conference and showed nothing, with no way for a reader to tell an
    // empty catalogue from a broken filter.
    // Both sets, because the reader sees both: the app's own conferences and the catalogue
    // results beside them. Building it from `conferences` alone emptied the dropdown, since that
    // array never held the catalogue; building it from a static table offered countries nothing
    // could match. It has to come from what is actually on screen.
    return countryOptionsFor(
      [...(conferences || []), ...(webResults || [])],
      CONFERENCE_CITIES_BY_COUNTRY
    );
  }, [conferences, webResults]);

  const countryOptions = locationOptions.map((option) => option.country);
  const cityOptions = countryFilter
    ? locationOptions.find((option) => option.country === countryFilter)?.cities || []
    : [];

  const [webSearchLoading, setWebSearchLoading] = useState(false);
  const [webSearchError, setWebSearchError] = useState<string | null>(null);
  const lastWebQueryRef = useRef<string | null>(null);
  // Bumped by the "Refresh Results" button to force a genuine retry even when every filter is
  // unchanged — a failed (or successful) search already marks its own cache key as already
  // handled via lastWebQueryRef, so without tracking this separately a retry click with identical
  // filters would be silently skipped by that same-key guard below.
  const [manualRetryCount, setManualRetryCount] = useState(0);
  const lastHandledRetryCountRef = useRef(0);

  useEffect(() => {
    const trimmed = submittedSearchTerm.trim();
    // The search term is sent exactly as typed, and nothing is appended to it.
    //
    // The selected filters used to be rendered into the query as prose — " from October 2026",
    // " in Lisbon", " weekend", a price range — because a search engine has no filter fields and
    // will happily take the hint. The stored search is not a search engine: it requires every
    // meaningful word of the query to appear somewhere in the record, so " from October 2026"
    // asked for conferences whose text contains "october" and "2026" and a page of real matches
    // came back empty. The filters below still narrow the Conference Gate catalog, where the dates
    // and places are structured fields rather than words to be guessed at.
    // Empty means browse. The placeholder phrase this used to send was matched token-by-token
    // against every stored record, so the landing page asked for conferences containing the words
    // "academic" and "technical" and the current year, and showed nothing.
    const effectiveQueries = [trimmed];
    const cacheKey = effectiveQueries[0];

    const handle = setTimeout(
      () => {
        const sameQueryAsLastTime = lastWebQueryRef.current === cacheKey;
        // A click on "Refresh Results" bumps manualRetryCount without changing any filter, so the
        // cache key comes out identical to last time — this is what tells a genuine retry apart
        // from an incidental extra effect run, and what asks the server for a truly fresh search
        // instead of replaying its own hourly-cached answer for that same query text.
        const isManualRetry = manualRetryCount !== lastHandledRetryCountRef.current;
        if (sameQueryAsLastTime && !isManualRetry) return;
        lastWebQueryRef.current = cacheKey;
        lastHandledRetryCountRef.current = manualRetryCount;
        setWebSearchLoading(true);
        setWebSearchError(null);
        const byIdentity = new Map<string, LiveSearchResult>();
        const merged: LiveSearchResult[] = [];
        // Shared by every source that contributes results, so a conference found by two of them
        // is one card regardless of which found it first.
        const absorb = (results: LiveSearchResult[]) => {
          for (const result of results) {
            if (!liveResultFitsDateWindow(result, effectiveStartMonth, endAtMonth)) continue;
            // The catalogue is where nearly every conference lives, and it was exempt from the
            // country filter entirely — so choosing a country filtered the app's own handful of
            // records and silently left all 359 catalogue results in place, or dropped them.
            if (!matchesCountry(result, countryFilter)) continue;
            const identity = liveResultIdentity(result.title) || result.link;
            const existing = byIdentity.get(identity);
            if (!existing) {
              byIdentity.set(identity, result);
              merged.push(result);
            } else if (
              liveSearchResultRelevance(result, trimmed) >
              liveSearchResultRelevance(existing, trimmed)
            ) {
              const existingIndex = merged.indexOf(existing);
              if (existingIndex >= 0) merged[existingIndex] = result;
              byIdentity.set(identity, result);
            }
          }
          setWebResults(rankLiveSearchResults(merged, trimmed));
        };

        const searches = effectiveQueries.map((q) =>
          searchConferencesOnTheWeb(q, trimmed ? 'high' : 'low', isManualRetry).then((results) => {
            if (lastWebQueryRef.current !== cacheKey) return results;
            absorb(results);
            return results;
          })
        );

        Promise.allSettled(searches)
          .then((outcomes) => {
            if (lastWebQueryRef.current !== cacheKey) return;
            const succeeded = outcomes.some((outcome) => outcome.status === 'fulfilled');
            if (!succeeded) {
              const firstError = outcomes.find(
                (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected'
              );
              throw new Error(firstError?.reason?.message || 'Live search failed. Please try again.');
            }
            setWebResults(rankLiveSearchResults(merged, trimmed));
          })
          .catch((e) => {
            if (lastWebQueryRef.current !== cacheKey) return;
            if (merged.length === 0) setWebResults(null);
            setWebSearchError(e.message || 'Live search failed. Please try again.');
          })
          .finally(() => {
            if (lastWebQueryRef.current === cacheKey) setWebSearchLoading(false);
          });
      },
      // The request is explicit, so only a tiny delay is needed to let the submitted state settle.
      25
    );

    return () => clearTimeout(handle);
  }, [searchSubmitCount, manualRetryCount]);

  const submitDiscoverySearch = (term = searchTerm) => {
    const normalized = term.trim();
    setSearchInput(term);
    setSubmittedSearchTerm(normalized);
    lastWebQueryRef.current = null;
    setSearchSubmitCount((count) => count + 1);
  };

  return (
    <div className="space-y-8">
      {/* Header Banner */}
      <div className="bg-blue-50 rounded-2xl border border-blue-100 p-6 sm:p-8 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-blue-600">
              Global Discovery Engine
            </span>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight mt-1">
              Explore Academic & Technical Conferences
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Discover current and upcoming academic and technical conferences worldwide.
            </p>
          </div>
        </div>

        {/* Search and filters shared by Conference Gate records and stored conference results. */}
        <div className="mt-6 pt-6 border-t border-slate-100 space-y-3">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitDiscoverySearch();
            }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search title, keywords, topics — press Enter"
                aria-label="Search conferences"
                className="w-full pl-9 pr-3 py-2.5 bg-slate-50 focus:bg-white text-xs text-slate-800 rounded-xl border border-slate-200 focus:border-blue-500 focus:outline-hidden transition-all"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            </div>
            <button
              type="submit"
              disabled={webSearchLoading}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {webSearchLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {webSearchLoading ? 'Searching' : 'Search'}
            </button>
          </form>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-8 gap-2.5">
            <div className="xl:col-span-2 flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-xl border border-slate-200 focus-within:border-blue-500">
              <CalendarRange className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="text-[10px] font-semibold text-slate-500">From</span>
              <select
                aria-label="From month"
                value={startFromMonth.split('-')[1] || ''}
                onChange={(e) => {
                  const month = e.target.value;
                  updateStartBoundary(
                    month
                      ? `${startFromMonth.split('-')[0] || discoveryCurrentYear}-${month}`
                      : ''
                  );
                }}
                className="min-w-0 flex-1 text-xs text-slate-800 bg-transparent focus:outline-hidden"
              >
                <option value="">Month</option>
                {DISCOVERY_MONTH_OPTIONS.map((month) => (
                  <option key={month.value} value={month.value}>{month.label}</option>
                ))}
              </select>
              <select
                aria-label="From year"
                value={startFromMonth.split('-')[0] || ''}
                onChange={(e) => {
                  const year = e.target.value;
                  updateStartBoundary(
                    year
                      ? `${year}-${startFromMonth.split('-')[1] || '01'}`
                      : ''
                  );
                }}
                className="w-[4.6rem] text-xs text-slate-800 bg-transparent focus:outline-hidden"
              >
                <option value="">Year</option>
                {DISCOVERY_YEAR_OPTIONS.map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>

            <div className="xl:col-span-2 flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-xl border border-slate-200 focus-within:border-blue-500">
              <CalendarRange className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="text-[10px] font-semibold text-slate-500">To</span>
              <select
                aria-label="To month"
                value={endAtMonth.split('-')[1] || ''}
                onChange={(e) => {
                  const month = e.target.value;
                  updateEndBoundary(
                    month
                      ? `${endAtMonth.split('-')[0] || startFromMonth.split('-')[0] || discoveryCurrentYear}-${month}`
                      : ''
                  );
                }}
                className="min-w-0 flex-1 text-xs text-slate-800 bg-transparent focus:outline-hidden"
              >
                <option value="">Month</option>
                {DISCOVERY_MONTH_OPTIONS.map((month) => (
                  <option key={month.value} value={month.value}>{month.label}</option>
                ))}
              </select>
              <select
                aria-label="To year"
                value={endAtMonth.split('-')[0] || ''}
                onChange={(e) => {
                  const year = e.target.value;
                  updateEndBoundary(
                    year
                      ? `${year}-${endAtMonth.split('-')[1] || '12'}`
                      : ''
                  );
                }}
                className="w-[4.6rem] text-xs text-slate-800 bg-transparent focus:outline-hidden"
              >
                <option value="">Year</option>
                {DISCOVERY_YEAR_OPTIONS.map((year) => (
                  <option
                    key={year}
                    value={year}
                    disabled={Boolean(startFromMonth) && year < startFromMonth.split('-')[0]}
                  >
                    {year}
                  </option>
                ))}
              </select>
            </div>

            <label className="relative">
              <Globe className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
              <select
                value={countryFilter}
                onChange={(e) => {
                  setCountryFilter(e.target.value);
                  setLocationFilter('');
                }}
                aria-label="Country"
                className="w-full pl-9 pr-8 py-2 bg-slate-50 text-xs text-slate-700 rounded-xl border border-slate-200 focus:border-blue-500 focus:bg-white focus:outline-hidden"
              >
                <option value="">Any country</option>
                {countryOptions.map((country) => (
                  <option key={country} value={country}>{country}</option>
                ))}
              </select>
            </label>

            <label className="relative">
              <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
              <select
                value={locationFilter}
                onChange={(e) => setLocationFilter(e.target.value)}
                disabled={!countryFilter}
                aria-label="City"
                className="w-full pl-9 pr-8 py-2 bg-slate-50 text-xs text-slate-700 rounded-xl border border-slate-200 focus:border-blue-500 focus:bg-white focus:outline-hidden disabled:text-slate-400 disabled:cursor-not-allowed"
              >
                <option value="">{countryFilter ? 'Any city' : 'Select country first'}</option>
                {cityOptions.map((city) => (
                  <option key={city} value={city}>{city}</option>
                ))}
              </select>
            </label>

            <select
              value={formatFilter}
              onChange={(e) => setFormatFilter(e.target.value)}
              aria-label="Conference format"
              className="px-3 py-2 bg-slate-50 text-xs text-slate-700 rounded-xl border border-slate-200 focus:border-blue-500 focus:bg-white focus:outline-hidden"
            >
              <option value="">Any format</option>
              <option value="In-person">In-person</option>
              <option value="Virtual">Virtual</option>
              <option value="Hybrid">Hybrid</option>
            </select>

            <select
              value={timingFilter}
              onChange={(e) => setTimingFilter(e.target.value)}
              aria-label="Conference timing"
              className="px-3 py-2 bg-slate-50 text-xs text-slate-700 rounded-xl border border-slate-200 focus:border-blue-500 focus:bg-white focus:outline-hidden"
            >
              <option value="">Any timing</option>
              <option value="one-day">One-day event</option>
              <option value="multi-day">Multi-day event</option>
              <option value="weekend">Weekend</option>
              <option value="weekday">Weekday</option>
            </select>
          </div>

          {/* Price range — bounds prefer the real lowest registration price across the current
              catalog when there's enough of it to span a real range; otherwise a conventional
              default range so the control (and the live-search bias it applies) is available
              from the start rather than waiting on catalog data that may not exist yet. */}
          {priceBounds.max > priceBounds.min && (
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <div className="flex items-center justify-between mb-2.5">
                <span className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500">
                  <DollarSign className="w-3.5 h-3.5 text-slate-400" />
                  Price range
                </span>
                <span className="text-xs font-bold text-slate-800">
                  {formatPrice(priceMin)} – {formatPrice(priceMax)}
                </span>
              </div>
              <div className="relative h-4 flex items-center">
                <div className="absolute inset-x-0 h-1.5 bg-slate-200 rounded-full" />
                <div
                  className="absolute h-1.5 bg-blue-500 rounded-full"
                  style={{
                    left: `${((priceMin - priceBounds.min) / (priceBounds.max - priceBounds.min)) * 100}%`,
                    right: `${100 - ((priceMax - priceBounds.min) / (priceBounds.max - priceBounds.min)) * 100}%`,
                  }}
                />
                {/* Two overlapping native range inputs — the standard dependency-free way to get
                    a dual-handle slider. Each input's own track is pointer-events-none so only
                    its thumb (re-enabled via the pseudo-element selectors) can be grabbed,
                    letting both handles coexist on the same track without fighting for clicks. */}
                <input
                  type="range"
                  min={priceBounds.min}
                  max={priceBounds.max}
                  value={priceMin}
                  aria-label="Minimum price"
                  onChange={(e) => setPriceRange([Math.min(Number(e.target.value), priceMax), priceMax])}
                  className="absolute w-full h-4 appearance-none bg-transparent pointer-events-none cursor-pointer [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-600 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-sm [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-blue-600 [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-sm [&::-moz-range-track]:bg-transparent"
                />
                <input
                  type="range"
                  min={priceBounds.min}
                  max={priceBounds.max}
                  value={priceMax}
                  aria-label="Maximum price"
                  onChange={(e) => setPriceRange([priceMin, Math.max(Number(e.target.value), priceMin)])}
                  className="absolute w-full h-4 appearance-none bg-transparent pointer-events-none cursor-pointer [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-600 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-sm [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-blue-600 [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-sm [&::-moz-range-track]:bg-transparent"
                />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[9px] text-slate-400 font-medium">{formatPrice(priceBounds.min)}</span>
                <span className="text-[9px] text-slate-400 font-medium">{formatPrice(priceBounds.max)}</span>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Popular searches</span>
            {DISCOVERY_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => submitDiscoverySearch(suggestion)}
                className={`px-2.5 py-1 rounded-full border text-[10px] font-semibold transition-colors cursor-pointer ${
                  searchTerm === suggestion
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-blue-300 hover:text-blue-700'
                }`}
              >
                {suggestion}
              </button>
            ))}
            {(searchTerm || startFromMonth || endAtMonth || locationFilter || countryFilter || formatFilter || timingFilter || priceFilterActive) && (
              <button
                type="button"
                onClick={() => {
                  setSearchInput('');
                  setSubmittedSearchTerm('');
                  lastWebQueryRef.current = null;
                  setSearchSubmitCount((count) => count + 1);
                  setStartFromMonth(nextMonthValue());
                  setEndAtMonth('');
                  setLocationFilter('');
                  setCountryFilter('');
                  setFormatFilter('');
                  setTimingFilter('');
                  setPriceRange(null);
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                <X className="w-3 h-3" />
                Clear filters
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Honest empty state when the selected filters hide the Conference Gate catalog. */}
      {filtered.length === 0 &&
        (conferences || []).length > 0 &&
        (searchTerm || startFromMonth || endAtMonth || locationFilter || countryFilter || formatFilter || timingFilter || priceFilterActive) && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center">
            <p className="text-xs text-slate-500">
              No Conference Gate conferences match the selected filters. Conference Results below
              show the matching stored ConferenceGate conferences.
            </p>
          </div>
        )}

      {/* Real Conference Gate conferences */}
      {filtered.length > 0 && (
        <div className="space-y-6">
          {filtered.map((conf) => {
            const isSaved = savedIds.includes(conf.id);
            const isFollowed = followedIds.includes(conf.id);

            return (
              <div
                key={conf.id}
                onClick={() => onSelectConference(conf)}
                className="bg-white rounded-2xl border border-slate-200 hover:border-blue-300 shadow-xs hover:shadow-md transition-all p-6 cursor-pointer flex flex-col lg:flex-row gap-6 group"
              >
                {/* Conference Logo & Banner */}
                <div className="w-full lg:w-72 h-48 lg:h-auto rounded-xl overflow-hidden relative shrink-0 bg-slate-900">
                  {/* A conference created without a banner gets its initials, not an <img src="">.
                      An empty src makes the browser re-request the whole page, and no stock photo
                      is substituted for one the organiser never supplied. */}
                  {conf.banner ? (
                    <img
                      src={conf.banner}
                      alt={conf.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 opacity-90"
                    />
                  ) : (
                    <div className="w-full h-full min-h-48 flex items-center justify-center">
                      <span className="text-3xl font-black tracking-wider text-white/70">
                        {getInitials(conf.title)}
                      </span>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/20 to-transparent"></div>

                  <div className="absolute top-3 left-3 bg-white/90 text-slate-800 font-bold text-[10px] uppercase px-2.5 py-1 rounded-full backdrop-blur-md">
                    {conf.format}
                  </div>

                  <div className="absolute bottom-3 left-3 right-3 flex items-center gap-2">
                    <img
                      src={conf.logo || generateInitialsAvatar(conf.organizerName)}
                      alt={conf.organizerName}
                      className="w-8 h-8 rounded-lg object-cover ring-2 ring-white/50"
                    />
                    <span className="text-xs text-white/90 font-medium line-clamp-1 drop-shadow-xs">
                      {conf.organizerName}
                    </span>
                  </div>
                </div>

                {/* Info Block */}
                <div className="flex-1 flex flex-col justify-between space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className="text-lg font-bold text-slate-900 group-hover:text-blue-600 transition-colors leading-snug">
                          {conf.title}
                        </h2>
                        <div className="flex items-center gap-4 text-xs font-semibold text-slate-500 mt-1.5">
                          <span className="flex items-center gap-2">
                            <span className="flex flex-col items-center justify-center w-7 h-7 rounded-md bg-blue-600 text-white leading-none shrink-0 shadow-xs">
                              <span className="text-[6.5px] font-bold uppercase tracking-wide">
                                {formatMonthShort(conf.dates.start)}
                              </span>
                              <span className="text-[11px] font-extrabold">{formatDay(conf.dates.start)}</span>
                            </span>
                            <span className="flex flex-col leading-tight">
                              <span className="text-blue-700 font-bold text-[11.5px]">
                                {formatDateRange(conf.dates.start, conf.dates.end)}
                              </span>
                              <span className="text-slate-400 font-medium text-[10px]">
                                {conferenceDurationDays(conf.dates.start, conf.dates.end)}-day event
                              </span>
                            </span>
                          </span>
                          <span className="flex items-center gap-1.5 text-slate-600">
                            <MapIcon className="w-3.5 h-3.5 text-rose-500" />
                            {conf.location.city}, {conf.location.country} ({conf.location.venue})
                          </span>
                        </div>
                        {(conf.hasBrochure || conf.hasCityMap || conf.accommodation) && (
                          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-500 font-semibold">
                            {conf.accommodation && (
                              <span className="flex items-center gap-1">
                                <Hotel className="w-3 h-3 text-blue-500" />
                                Hotel Partnerships
                              </span>
                            )}
                            {conf.hasBrochure && (
                              <span className="flex items-center gap-1">
                                <BookOpen className="w-3 h-3 text-blue-500" />
                                Brochure
                              </span>
                            )}
                            {conf.hasCityMap && (
                              <span className="flex items-center gap-1">
                                <MapIcon className="w-3 h-3 text-blue-500" />
                                City Map
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Quick Save / Follow Actions */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={(e) => toggleSave(conf.id, e)}
                          className={`p-2 rounded-xl border transition-colors cursor-pointer ${
                            isSaved
                              ? 'bg-blue-50 border-blue-200 text-blue-600'
                              : 'bg-slate-50 border-slate-200 text-slate-400 hover:text-slate-600'
                          }`}
                          title="Save Conference"
                        >
                          <Bookmark className="w-4 h-4 fill-current" />
                        </button>
                        <button
                          onClick={(e) => toggleFollow(conf.id, e)}
                          className={`px-3 py-1.5 text-xs font-bold rounded-xl border transition-colors cursor-pointer ${
                            isFollowed
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                              : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          {isFollowed ? 'Following' : '+ Follow'}
                        </button>
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 leading-relaxed line-clamp-2">
                      {conf.description}
                    </p>

                    {/* Key Attributes */}
                    <div className="grid grid-cols-1 gap-2 text-xs pt-1">
                      <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex items-center justify-between">
                        <span className="text-slate-500 font-medium">Call for Papers:</span>
                        <span className="font-bold text-emerald-700 bg-emerald-100/60 px-2 py-0.5 rounded-md text-[11px]">
                          {conf.cfpStatus}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Card Action Row */}
                  <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 font-medium">Price:</span>
                      <span className="text-xs font-bold text-slate-900">{conf.priceRange}</span>
                      <span className="text-slate-300">•</span>
                      <span className="text-[11px] text-slate-500">
                        {conf.attendeeCount} Registered Attendee{conf.attendeeCount === 1 ? '' : 's'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenSubmitAbstract(conf.id);
                        }}
                        className="px-3.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                      >
                        Submit Abstract
                      </button>
                      <button
                        onClick={() => onSelectConference(conf)}
                        className="px-4 py-1.5 bg-blue-900 hover:bg-blue-950 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
                      >
                        View Conference Page
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Conference Results — stored, published ConferenceGate records only. */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
              <Globe className="w-4.5 h-4.5 text-indigo-600" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Conference Results
              </h3>
              <p className="text-[11px] text-slate-500">
                Current and upcoming conferences available in ConferenceGate.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setManualRetryCount((n) => n + 1)}
            disabled={webSearchLoading}
            className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold text-indigo-700 hover:bg-indigo-50 rounded-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${webSearchLoading ? 'animate-spin' : ''}`} />
            {webSearchLoading ? 'Searching...' : 'Refresh Results'}
          </button>
        </div>

        {webSearchLoading && (!webResults || webResults.length === 0) && (
          <div className="bg-white rounded-2xl border border-slate-200 flex items-center justify-center gap-2 py-12 text-xs text-slate-400 font-semibold">
            <Loader2 className="w-4 h-4 animate-spin" />
            Searching the web...
          </div>
        )}

        {!webSearchLoading && webSearchError && (
          <div className="p-3 bg-amber-50 text-amber-800 border border-amber-200 rounded-xl text-xs font-semibold flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{webSearchError}</span>
          </div>
        )}

        {!webSearchLoading && !webSearchError && webResults && webResults.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
            <p className="text-xs text-slate-400">No current or upcoming conference websites found. Try different keywords or broader filters.</p>
          </div>
        )}

        {!webSearchError && webResults && webResults.length > 0 && (
          <div className="space-y-6">
            {webResults.map((result, idx) => (
              <div
                key={idx}
                onClick={() => onOpenExternalResult(result)}
                className="bg-white rounded-2xl border border-slate-200 hover:border-indigo-300 shadow-xs hover:shadow-md transition-all p-5 sm:p-6 cursor-pointer flex flex-col sm:flex-row sm:items-center gap-5 group"
              >
                {/* The conference's own logo, shown whole in a tile of its own.
                    This used to be a 288px panel with the search thumbnail washed in behind it,
                    which gave a speaker still or a video frame the space the conference's mark
                    should have had. The tile is square and fixed so a hundred cards line up, and
                    the logo inside it is contained rather than cropped — a wordmark keeps its
                    words. */}
                <div className="w-28 h-28 shrink-0 rounded-2xl bg-white border border-slate-200 flex items-center justify-center p-3 overflow-hidden">
                  <ConferenceLogo result={result} />
                </div>

                {/* Info Block */}
                <div className="flex-1 min-w-0 flex flex-col gap-2.5">
                  <h2 className="text-xl font-bold text-slate-900 group-hover:text-indigo-700 transition-colors leading-snug">
                    {result.title}
                  </h2>

                  {/* When and where, as data rather than prose.
                      The card's one line was `snippet`, which for a catalogue record is exactly
                      this date and place — so it repeated what the card already knew and left no
                      room for anything about the conference itself. Both facts are structured
                      fields, so the card reads them directly. */}
                  {(() => {
                    const dateLine = discoverDateLine(result.startDate, result.endDate);
                    const place = [result.location?.city, result.location?.country]
                      .filter(Boolean).join(', ');
                    if (!dateLine && !place) return null;
                    return (
                      <div className="flex flex-col gap-1.5 text-sm font-medium text-slate-600">
                        {dateLine && (
                          <span className="inline-flex items-center gap-2">
                            <CalendarDays className="w-4 h-4 text-slate-400 shrink-0" />
                            {dateLine}
                          </span>
                        )}
                        {place && (
                          <span className="inline-flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                            {place}
                          </span>
                        )}
                      </div>
                    );
                  })()}

                  {/* What it is: subject, kind, and how it is held. Only the ones the record
                      actually states — a chip is a claim like any other field. */}
                  {(result.category || formatChipLabel(result.format)) && (
                    <div className="flex flex-wrap items-center gap-2">
                      {result.category && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full bg-emerald-50 text-emerald-700">
                          <Leaf className="w-3.5 h-3.5 shrink-0" />
                          {result.category}
                        </span>
                      )}
                      <span className="inline-flex items-center px-3 py-1 text-xs font-semibold rounded-full bg-slate-100 text-slate-600">
                        Conference
                      </span>
                      {formatChipLabel(result.format) && (
                        <span className="inline-flex items-center px-3 py-1 text-xs font-semibold rounded-full bg-slate-100 text-slate-600">
                          {formatChipLabel(result.format)}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Quick-Tab Shortcuts — jump straight into a specific section of the
                      detail page instead of always landing on the overview.
                      Only the tabs that have something behind them. Every card used to claim
                      "Stored details available" and offer all five chips, whether or not a single
                      one of those tabs had anything in it — so a reader clicked Speakers on a
                      conference whose speakers nobody has published and found an empty page. A
                      chip is a promise the detail page has to keep. */}
                  <div className="flex flex-wrap items-center gap-2">
                      {(result.sections?.length ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-lg border bg-emerald-50 border-emerald-200 text-emerald-700">
                          Stored conference details
                        </span>
                      )}
                      {(
                        [
                          { tab: 'cfp', label: 'Call for Papers', icon: FileText },
                          { tab: 'agenda', label: 'Program', icon: CalendarDays },
                          { tab: 'speakers', label: 'Speakers', icon: Users },
                          { tab: 'committee', label: 'Committee', icon: UserCheck },
                          { tab: 'sponsors', label: 'Sponsors', icon: Briefcase },
                          { tab: 'fees', label: 'Fees', icon: MapPin },
                        ] as { tab: ExternalDetailTab; label: string; icon: typeof FileText }[]
                      ).filter(({ tab }) => result.sections?.includes(tab)).map(({ tab, label, icon: Icon }) => (
                        <button
                          key={tab}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenExternalResult(result, tab);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-50 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 text-[11px] font-semibold rounded-lg border border-slate-200 transition-colors cursor-pointer"
                        >
                          <Icon className="w-3 h-3" />
                          {label}
                        </button>
                      ))}
                  </div>
                </div>

                {/* The action sits beside the conference and vertically centred, rather than under
                    a rule at the bottom of a tall card. */}
                <div className="shrink-0 flex sm:justify-end">
                  <span className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-50 group-hover:bg-indigo-100 text-indigo-700 text-sm font-bold rounded-xl transition-colors">
                    View Details
                    <ArrowRight className="w-4 h-4 shrink-0" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
