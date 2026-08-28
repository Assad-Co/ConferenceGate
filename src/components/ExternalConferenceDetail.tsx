import React, { useEffect, useState } from 'react';
import {
  Calendar,
  MapPin,
  FileText,
  CheckCircle2,
  Clock,
  Globe,
  Hotel,
  Plane,
  ArrowLeft,
  ExternalLink,
  Loader2,
  Sparkles,
  Download,
  Copy,
  Mail,
  ClipboardList,
  AlertCircle,
} from 'lucide-react';
import {
  LiveSearchResult,
  ExtractedConferenceDetails,
  extractConferenceDetails,
  fetchConferenceCrawlStatus,
} from '../api/search';
import { generateInitialsAvatar } from '../utils/avatar';
import { parseDateFromSnippet, parseLocationFromSnippet } from '../utils/parseSnippetMeta';
import { downloadAbstractDraftDocx } from '../utils/abstractDraftDocx';
import { createExternalSubmission } from '../api/activity';
import { AbstractSubmission } from '../types';

// Recognized form-building tools whose CFP link means "fill out a form on their site" rather
// than "upload to a portal" — used only to pick the right explanatory copy, since we can't
// reliably generate a real prefilled link without knowing that specific form's own field IDs.
const FORMS_TOOL_DOMAINS = ['docs.google.com/forms', 'forms.gle', 'typeform.com', 'jotform.com', 'forms.office.com'];

type SubmissionChannel = 'email' | 'form' | 'portal';

function detectSubmissionChannel(submissionEmail: string | null, submissionLink: string): SubmissionChannel {
  if (submissionEmail) return 'email';
  const lower = submissionLink.toLowerCase();
  if (FORMS_TOOL_DOMAINS.some((domain) => lower.includes(domain))) return 'form';
  return 'portal';
}

function buildSubmissionPackageText(opts: {
  conferenceTitle: string;
  title: string;
  authors: string;
  abstractText: string;
  requirementsNote?: string | null;
}): string {
  const lines = [
    `Submission for: ${opts.conferenceTitle}`,
    '',
    `Title: ${opts.title || '(untitled)'}`,
  ];
  if (opts.authors.trim()) {
    lines.push(`Authors: ${opts.authors}`);
  }
  lines.push('', 'Abstract:', opts.abstractText || '(no abstract text yet)');
  if (opts.requirementsNote) {
    lines.push('', `Requirements to check before submitting: ${opts.requirementsNote}`);
  }
  return lines.join('\n');
}

export type ExternalDetailTab =
  | 'overview'
  | 'cfp'
  | 'fees'
  | 'agenda'
  | 'speakers'
  | 'committee'
  | 'sponsors'
  | 'venue'
  | 'community';

interface ExternalConferenceDetailProps {
  result: LiveSearchResult;
  onBack: () => void;
  initialTab?: ExternalDetailTab;
  /** The signed-in author's identity, used only to pre-fill the "Mark as Submitted Externally"
   * record — omitted (and that action hidden) when nobody's signed in. */
  author?: { name: string; email: string } | null;
  onExternalSubmissionRecorded?: (submission: AbstractSubmission) => void;
}

const EmptyExtractState: React.FC<{ message: string; sourceUrl: string }> = ({ message, sourceUrl }) => (
  <div className="py-8 text-center space-y-3">
    <p className="text-xs text-slate-500 max-w-md mx-auto">{message}</p>
    <a
      href={sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold rounded-xl transition-colors"
    >
      <Globe className="w-3.5 h-3.5" />
      <span>Check the official website</span>
      <ExternalLink className="w-3 h-3" />
    </a>
  </div>
);

const PersonCard: React.FC<{ name: string; title: string | null; org: string | null; role: string | null; imageUrl?: string | null }> = ({
  name,
  title,
  org,
  role,
  imageUrl,
}) => (
  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-center gap-4">
    <img
      src={imageUrl || generateInitialsAvatar(name)}
      alt=""
      className="w-12 h-12 rounded-xl object-cover ring-1 ring-slate-300 shrink-0"
      onError={(e) => {
        e.currentTarget.onerror = null;
        e.currentTarget.src = generateInitialsAvatar(name);
      }}
    />
    <div className="text-xs">
      {role && (
        <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">{role}</span>
      )}
      <h5 className="font-bold text-slate-900 mt-0.5">{name}</h5>
      {(title || org) && (
        <p className="text-slate-600">
          {title}
          {title && org ? ', ' : ''}
          {org}
        </p>
      )}
    </div>
  </div>
);

export const ExternalConferenceDetail: React.FC<ExternalConferenceDetailProps> = ({
  result,
  onBack,
  initialTab,
  author,
  onExternalSubmissionRecorded,
}) => {
  const [activeTab, setActiveTab] = useState<ExternalDetailTab>(initialTab || 'overview');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ExtractedConferenceDetails | null>(null);

  const [draftTitle, setDraftTitle] = useState('');
  const [draftAuthors, setDraftAuthors] = useState('');
  const [draftAbstractText, setDraftAbstractText] = useState('');
  const [aiChecking, setAiChecking] = useState(false);
  const [aiFeedback, setAiFeedback] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [markingSubmitted, setMarkingSubmitted] = useState(false);
  const [markedSubmitted, setMarkedSubmitted] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const [downloadingDraft, setDownloadingDraft] = useState(false);

  const handleAICheck = async () => {
    if (!draftAbstractText.trim()) return;
    setAiChecking(true);
    let realWordInfo: { wordCount?: number; wordLimitNote?: string | null } = {};
    try {
      const res = await fetch('/api/ai/abstract-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draftTitle,
          abstractText: draftAbstractText,
          topic: '',
          requirements: data?.submissionRequirements || null,
        }),
      });
      if (!res.ok) throw new Error('AI abstract check failed');
      const checkData = await res.json();
      realWordInfo = { wordCount: checkData.wordCount, wordLimitNote: checkData.wordLimitNote };
      if (checkData.isFallback || typeof checkData.score !== 'number') throw new Error('AI abstract check unavailable');
      setAiFeedback({ ...checkData, isFallback: false });
    } catch {
      setAiFeedback({
        score: null,
        clarity:
          'The AI quality check is unavailable right now, so this is generic guidance rather than an assessment of your specific abstract.',
        improvements: [
          'State your research problem, methodology, and key findings clearly in the first two sentences.',
          'Define all acronyms on first use.',
        ],
        isFallback: true,
        ...realWordInfo,
      });
    } finally {
      setAiChecking(false);
    }
  };

  const handleDownloadDraft = async () => {
    setDownloadingDraft(true);
    try {
      await downloadAbstractDraftDocx({
        conferenceTitle: result.title,
        title: draftTitle,
        authors: draftAuthors,
        abstractText: draftAbstractText,
        requirementsNote: data?.submissionRequirements || null,
      });
    } finally {
      setDownloadingDraft(false);
    }
  };

  const handleCopyPackage = async () => {
    const text = buildSubmissionPackageText({
      conferenceTitle: result.title,
      title: draftTitle,
      authors: draftAuthors,
      abstractText: draftAbstractText,
      requirementsNote: data?.submissionRequirements || null,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard permission denied or unavailable — the Download button still works as a fallback.
    }
  };

  const handleMarkSubmitted = async () => {
    if (!author || markingSubmitted) return;
    setMarkingSubmitted(true);
    setMarkError(null);
    try {
      const submission = await createExternalSubmission({
        conferenceTitle: result.title,
        externalUrl: submissionLink,
        title: draftTitle || result.title,
        abstractText: draftAbstractText,
        authorName: author.name,
        authorEmail: author.email,
      });
      onExternalSubmissionRecorded?.(submission);
      setMarkedSubmitted(true);
    } catch (err: any) {
      setMarkError(err.message || 'Could not save this record. Please try again.');
    } finally {
      setMarkingSubmitted(false);
    }
  };

  // The server answers with whatever the first round of pages found and keeps reading the rest of
  // the site in the background, so the first response is a starting point rather than the finished
  // article. Polling here is what lets a section that was empty a moment ago fill in on its own
  // instead of the reader having to reload and hope.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);

    const POLL_INTERVAL_MS = 1500;
    const POLL_CEILING_MS = 80000;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const pollUntilComplete = (startedAt: number) => {
      timer = setTimeout(async () => {
        if (cancelled) return;
        const update = await fetchConferenceCrawlStatus(result.link);
        if (cancelled) return;
        if (update) setData(update);
        // Stop once the crawl says it's finished, or once we've waited longer than any real crawl
        // should take — a poll that never terminates would keep hitting the server forever.
        if (!update?.crawlComplete && Date.now() - startedAt < POLL_CEILING_MS) pollUntilComplete(startedAt);
      }, POLL_INTERVAL_MS);
    };

    extractConferenceDetails(result.link, result.title).then((extracted) => {
      if (cancelled) return;
      setData(extracted);
      setLoading(false);
      if (extracted.extracted && !extracted.crawlComplete) pollUntilComplete(Date.now());
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [result.link, result.title]);

  const submissionLink = data?.submissionUrl || result.link;
  const displayDate = data?.datesText || parseDateFromSnippet(result.snippet);
  const displayLocation = data?.locationText || parseLocationFromSnippet(result.snippet);
  // Anchor "near the venue" to the venue itself when the site named one, falling back to the
  // city line only when it didn't — searching hotels near a named convention centre is a much
  // better answer than searching hotels near a whole city.
  const venueAnchor = data?.venueAddress || data?.venueName || displayLocation;

  // A real, live search for hotels near the real extracted venue — never a list of specific
  // hotel names we can't actually verify. Only ever built from the venue location that was
  // genuinely found; no location means no fabricated "nearby" claim either.
  const nearbyHotelsUrl = venueAnchor
    ? `https://www.google.com/maps/search/hotels+near+${encodeURIComponent(venueAnchor)}`
    : null;

  const submissionChannel = detectSubmissionChannel(data?.submissionEmail || null, submissionLink);
  const mailtoLink =
    submissionChannel === 'email' && data?.submissionEmail
      ? `mailto:${data.submissionEmail}?subject=${encodeURIComponent(`Abstract Submission: ${draftTitle || result.title}`)}&body=${encodeURIComponent(
          buildSubmissionPackageText({
            conferenceTitle: result.title,
            title: draftTitle,
            authors: draftAuthors,
            abstractText: draftAbstractText,
            requirementsNote: data?.submissionRequirements || null,
          })
        )}`
      : null;

  return (
    <div className="space-y-8">
      {/* Top Back Navigation Bar */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 font-semibold text-xs rounded-xl border border-slate-200 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Discovery</span>
        </button>

        <a
          href={result.link}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3.5 py-1.5 text-xs font-bold rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-1.5"
        >
          <Globe className="w-3.5 h-3.5" />
          <span>Visit Website</span>
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Hero Banner Header */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="relative h-64 sm:h-80 bg-slate-900 flex items-center justify-center">
          {result.thumbnail ? (
            <img src={result.thumbnail} alt={result.title} className="w-full h-full object-cover opacity-70" />
          ) : (
            <Globe className="w-16 h-16 text-slate-700" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent"></div>

          <div className="absolute top-6 left-6 flex items-center gap-3 bg-slate-950/70 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/10">
            {result.favicon && <img src={result.favicon} alt="" className="w-5 h-5 rounded shrink-0" />}
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-300">Source</div>
              <div className="text-xs font-bold text-white">{result.displayLink}</div>
            </div>
          </div>

          <div className="absolute bottom-6 left-6 right-6 text-white space-y-2">
            {data?.format && (
              <span className="bg-blue-600 text-white font-bold text-[10px] uppercase px-2.5 py-0.5 rounded-md">
                {data.format}
              </span>
            )}
            <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight drop-shadow-sm">
              {result.title}
            </h1>
            <div className="flex flex-wrap items-center gap-6 text-xs text-slate-200 font-medium">
              {displayDate && (
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-blue-400" />
                  {displayDate}
                </span>
              )}
              {displayLocation && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-rose-400" />
                  {displayLocation}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Primary Action Callouts Bar — only the abstract submission itself needs the official
            site; every other detail (committee, sponsors, speakers, venue) has its own tab below
            so users aren't sent off-site just to see information we already show in-app. */}
        <div className="p-6 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-3">
          {submissionChannel === 'email' && mailtoLink ? (
            <a
              href={mailtoLink}
              className="px-5 py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer"
            >
              <Mail className="w-4 h-4" />
              <span>Email My Submission</span>
            </a>
          ) : (
            <a
              href={submissionLink}
              target="_blank"
              rel="noopener noreferrer"
              className="px-5 py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer"
            >
              <FileText className="w-4 h-4" />
              <span>{submissionChannel === 'form' ? 'Open Submission Form' : 'Submit via Official Site'}</span>
            </a>
          )}
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 border-t border-slate-200 flex gap-6 overflow-x-auto text-xs font-semibold text-slate-600">
          {(
            [
              { id: 'overview', label: 'Overview' },
              { id: 'cfp', label: 'Call for Papers' },
              { id: 'fees', label: loading || !data?.crawlComplete
                ? 'Fees & Pricing (checking…)'
                : data.fetchFailed
                  ? 'Fees & Pricing (not retrieved)'
                  : data.registrationFees.length > 0
                    ? `Fees & Pricing (${data.registrationFees.length})`
                    : 'Fees & Pricing' },
              { id: 'agenda', label: loading || !data?.crawlComplete
                ? 'Program & Agenda (checking…)'
                : `Program & Agenda (${data.agendaSessions.length})` },
              { id: 'speakers', label: loading || !data?.crawlComplete
                ? 'Keynote Speakers (checking…)'
                : data.fetchFailed
                  ? 'Keynote Speakers (not retrieved)'
                  : `Keynote Speakers (${data.speakers.length})` },
              { id: 'committee', label: loading || !data?.crawlComplete
                ? 'Technical Committee (checking…)'
                : `Technical Committee (${data.committee.length})` },
              { id: 'sponsors', label: loading || !data?.crawlComplete
                ? 'Sponsors & Exhibitors (checking…)'
                : data.fetchFailed
                  ? 'Sponsors & Exhibitors (not retrieved)'
                  : `Sponsors & Exhibitors (${data.sponsors.length})` },
              { id: 'venue', label: 'Venue & Accommodation' },
              { id: 'community', label: 'Community' },
            ] as { id: ExternalDetailTab; label: string }[]
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-4 border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600 font-bold'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content Area */}
      <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-xs">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-xs text-slate-400 font-semibold">
            <Loader2 className="w-4 h-4 animate-spin" />
            Reading the source page for real details...
          </div>
        ) : (
          <>
            {/* Without this, a page we were never able to read looks identical to a page we read
                fine that simply had no speakers or agenda on it — every tab would say "none found
                on this page" about a page nobody actually managed to open. */}
            {/* Details gathered from sources other than the conference's own site — because it
                blocked us, or said very little. Deliberately informational rather than an
                error: there IS data below, and what matters is that the reader knows where it
                came from. Each field's own source is in `provenance` and in the JSON export. */}
            {data?.extracted && data.sourcedFromOpenWeb && (
              <div className="mb-6 p-3 bg-sky-50 border border-sky-200 rounded-xl flex items-start gap-2.5">
                <Globe className="w-3.5 h-3.5 text-sky-600 shrink-0 mt-px" />
                <p className="text-[11px] text-sky-900 leading-relaxed">
                  {data.officialSiteUnreadable
                    ? "This conference's own website couldn't be read, so the details below were gathered from other sites covering it"
                    : "The official site gave limited detail, so some fields below were filled from other sites covering this conference"}
                  {(data.crawlCoverage?.pagesRead || []).length > 0 &&
                    ` (${new Set(
                      (data.crawlCoverage.pagesRead || [])
                        .map((u) => {
                          try {
                            return new URL(u).hostname.replace(/^www\./, '');
                          } catch {
                            return null;
                          }
                        })
                        .filter(Boolean)
                    ).size} sources)`}
                  . Confirm anything important against{' '}
                  <a
                    href={result.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold underline underline-offset-2 hover:text-sky-950"
                  >
                    the official website
                  </a>
                  .
                </p>
              </div>
            )}

            {data && !data.extracted && data.crawlComplete !== false && (
              <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-xs font-bold text-amber-900">
                    {data.isFallback
                      ? 'AI extraction is unavailable right now'
                      : "We couldn't read this conference's website"}
                  </p>
                  <p className="text-[11px] text-amber-800 leading-relaxed">
                    {data.isFallback
                      ? 'Details below are limited to the search result snippet. Try again shortly.'
                      : // What the server established by actually re-probing the site, rather than a
                        // guess from which code path failed. Falls back to the general wording only
                        // when an older response carries no diagnosis.
                        data.readFailureReason ||
                        'The site blocked our request or was unreachable.'}{' '}
                    The empty sections below mean "not retrieved" — not "not offered by this conference."
                  </p>
                  <a
                    href={result.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-900 hover:text-amber-950 underline underline-offset-2"
                  >
                    Open the official website
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            )}

            {/* The first response covers only the pages read so far; the rest of the site is still
                being crawled and these tabs refill as it lands. Saying so is what stops a section
                that simply hasn't been reached yet from reading as a section that doesn't exist. */}
            {data?.extracted && data.crawlComplete === false && (
              <div className="mb-6 p-3 bg-blue-50 border border-blue-100 rounded-xl flex items-center gap-2.5">
                <Loader2 className="w-3.5 h-3.5 text-blue-600 shrink-0 animate-spin" />
                <p className="text-[11px] text-blue-900">
                  Still reading the rest of this conference's website
                  {typeof data.pagesRead === 'number' ? ` (${data.pagesRead} pages so far)` : ''} — these tabs will
                  fill in as more is found.
                </p>
              </div>
            )}

            {activeTab === 'overview' && (
              <div className="space-y-8">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <h3 className="text-lg font-bold text-slate-900">About</h3>
                    <a
                      href={result.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 px-3.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5"
                    >
                      <Globe className="w-3.5 h-3.5" />
                      <span>Official Website</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                    {data?.overviewSummary || result.snippet}
                  </p>
                  {!data?.extracted && (
                    <p className="text-[11px] text-slate-400 italic">
                      {data?.isFallback
                        ? 'AI extraction is not available right now — the summary above comes from the search result snippet only.'
                        : "Couldn't read this page's full content — the summary above comes from the search result snippet only."}
                    </p>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'cfp' && (
              <div className="space-y-6">
                {data?.cfpStatus || data?.cfpDeadline ? (
                  <div className="bg-gradient-to-r from-blue-900 to-indigo-900 text-white p-6 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-6">
                    <div className="space-y-1">
                      {data?.cfpStatus && (
                        <span className="text-xs font-bold uppercase tracking-wider text-blue-300">
                          Call for Papers Status: {data.cfpStatus}
                        </span>
                      )}
                      <h3 className="text-lg font-bold">Submit Your Research Abstract</h3>
                      {data?.cfpDeadline && (
                        <p className="text-xs text-blue-200">
                          Abstract Submission Deadline: <strong className="text-white">{data.cfpDeadline}</strong>
                        </p>
                      )}
                    </div>
                    {submissionChannel === 'email' && mailtoLink ? (
                      <a
                        href={mailtoLink}
                        className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs shadow-md shrink-0 cursor-pointer"
                      >
                        Email My Submission
                      </a>
                    ) : (
                      <a
                        href={submissionLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs shadow-md shrink-0 cursor-pointer"
                      >
                        {submissionChannel === 'form' ? 'Open Submission Form' : 'Submit via Official Site'}
                      </a>
                    )}
                  </div>
                ) : (
                  <EmptyExtractState
                    message="No call-for-papers status or deadline was found on this page."
                    sourceUrl={result.link}
                  />
                )}

                {submissionChannel === 'email' && data?.submissionEmail && (
                  <div className="p-3.5 bg-indigo-50 border border-indigo-200 rounded-xl text-xs text-indigo-900 flex items-center gap-2">
                    <Mail className="w-4 h-4 text-indigo-600 shrink-0" />
                    <span>
                      This conference takes submissions by email, to <strong>{data.submissionEmail}</strong> — the
                      button above opens your email client with your draft already filled in.
                    </span>
                  </div>
                )}
                {submissionChannel === 'form' && (
                  <div className="p-3.5 bg-indigo-50 border border-indigo-200 rounded-xl text-xs text-indigo-900 flex items-center gap-2">
                    <ClipboardList className="w-4 h-4 text-indigo-600 shrink-0" />
                    <span>
                      This conference collects submissions through a form, not a portal — use the{' '}
                      <strong>submission package preview</strong> below to copy your info in, field by field.
                    </span>
                  </div>
                )}

                {/* Every dated milestone the site stated, not just the submission deadline —
                    notification, camera-ready and early-bird close all matter to an author
                    deciding whether to submit. */}
                {(data?.importantDates || []).length > 0 && (
                  <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                    <h4 className="text-sm font-bold text-slate-900">
                      Important Dates ({data!.importantDates.length})
                    </h4>
                    <ul className="space-y-1.5">
                      {data!.importantDates.map((entry, i) => (
                        <li key={`${entry.label}-${i}`} className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                          <span className="text-slate-700 flex items-center gap-1.5">
                            {entry.isDeadline && (
                              <span className="text-[9px] font-bold uppercase tracking-wide text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">
                                Deadline
                              </span>
                            )}
                            {entry.label}
                          </span>
                          <span className="font-semibold text-slate-900">{entry.date}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {(data?.publicationInfo?.proceedingsPublisher ||
                  (data?.publicationInfo?.journals || []).length > 0 ||
                  (data?.publicationInfo?.indexing || []).length > 0 ||
                  data?.publicationInfo?.doi ||
                  data?.publicationInfo?.isbn ||
                  data?.publicationInfo?.issn) && (
                  <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                    <h4 className="text-sm font-bold text-slate-900">Publication & Proceedings</h4>
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
                      {[
                        ['Proceedings', data?.publicationInfo?.proceedingsPublisher],
                        ['Journals', (data?.publicationInfo?.journals || []).join(', ') || null],
                        ['Indexing', (data?.publicationInfo?.indexing || []).join(', ') || null],
                        ['DOI', data?.publicationInfo?.doi],
                        ['ISBN', data?.publicationInfo?.isbn],
                        ['ISSN', data?.publicationInfo?.issn],
                      ]
                        .filter(([, value]) => value)
                        .map(([label, value]) => (
                          <div key={label as string}>
                            <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</dt>
                            <dd className="text-slate-800 mt-0.5">{value}</dd>
                          </div>
                        ))}
                    </dl>
                  </div>
                )}

                <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                  <h4 className="text-sm font-bold text-slate-900">Format & Requirements</h4>
                  {data?.submissionRequirements ||
                  data?.submissionTemplateUrl ||
                  data?.cfpSubmissionFormat ||
                  data?.cfpLengthLimit ||
                  data?.cfpReviewProcess ||
                  data?.cfpNotificationDate ||
                  (data?.cfpTopics || []).length > 0 ? (
                    <>
                      {data?.submissionRequirements && (
                        <p className="text-xs text-slate-600 leading-relaxed">{data.submissionRequirements}</p>
                      )}
                      {/* The same stated requirements broken out as a checklist, so an author can
                          see at a glance what they have to meet. Only rows the site actually
                          stated are rendered — a missing row means unstated, not unrestricted. */}
                      {(data?.cfpSubmissionFormat ||
                        data?.cfpLengthLimit ||
                        data?.cfpReviewProcess ||
                        data?.cfpNotificationDate) && (
                        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 pt-1">
                          {[
                            ['Submission format', data?.cfpSubmissionFormat],
                            ['Length limit', data?.cfpLengthLimit],
                            ['Review process', data?.cfpReviewProcess],
                            ['Author notification', data?.cfpNotificationDate],
                          ]
                            .filter(([, value]) => value)
                            .map(([label, value]) => (
                              <div key={label as string}>
                                <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                  {label}
                                </dt>
                                <dd className="text-xs text-slate-800 font-semibold mt-0.5">{value}</dd>
                              </div>
                            ))}
                        </dl>
                      )}
                      {(data?.cfpTopics || []).length > 0 && (
                        <div className="pt-1 space-y-1.5">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            Topics this call invites
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {(data?.cfpTopics || []).map((topic, i) => (
                              <span
                                key={`${topic}-${i}`}
                                className="text-[11px] text-slate-700 bg-white border border-slate-200 px-2 py-0.5 rounded-md"
                              >
                                {topic}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {data?.submissionTemplateUrl && (
                        <a
                          href={data.submissionTemplateUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold rounded-xl transition-colors"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>Download Submission Template</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </>
                  ) : (
                    <EmptyExtractState
                      message="No specific font, size, or formatting requirements were found stated on this page."
                      sourceUrl={result.link}
                    />
                  )}
                </div>

                {/* Draft Your Submission — prepares a properly-formatted document on Conference
                    Gate using the real extracted requirements above; the final upload still has
                    to happen on the official site, since that's the only way it actually reaches
                    this conference's real reviewers. */}
                <div className="p-5 bg-white rounded-2xl border border-slate-200 space-y-4">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">Draft Your Submission</h4>
                    <p className="text-[11px] text-slate-500">
                      Write and format your abstract here, then download it ready to upload on the official site.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
                      Abstract Title
                    </label>
                    <input
                      type="text"
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      placeholder="e.g. Deep Neural Network Architectures in Subsurface Source Rock Analytics"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl font-medium focus:outline-hidden text-xs"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
                      Authors & Affiliations
                    </label>
                    <input
                      type="text"
                      value={draftAuthors}
                      onChange={(e) => setDraftAuthors(e.target.value)}
                      placeholder="Jane Doe (MIT), John Smith (Stanford University)"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl font-medium focus:outline-hidden text-xs"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
                        Abstract Text
                      </label>
                      <button
                        type="button"
                        onClick={handleAICheck}
                        disabled={aiChecking || !draftAbstractText.trim()}
                        className="px-3 py-1 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold text-[11px] rounded-lg shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-blue-300" />
                        <span>{aiChecking ? 'Evaluating...' : 'AI Quality Pre-Check'}</span>
                      </button>
                    </div>
                    <textarea
                      rows={6}
                      value={draftAbstractText}
                      onChange={(e) => setDraftAbstractText(e.target.value)}
                      placeholder="Paste your abstract body text here (background, methodology, experimental results, and conclusions)..."
                      className="w-full p-3 bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl font-medium focus:outline-hidden text-xs leading-relaxed"
                    ></textarea>

                    {aiFeedback && (
                      <div
                        className={`p-4 rounded-2xl space-y-2 border ${
                          aiFeedback.isFallback ? 'bg-amber-50 border-amber-200' : 'bg-blue-50/70 border-blue-200'
                        }`}
                      >
                        <div
                          className={`flex items-center justify-between text-xs font-bold ${
                            aiFeedback.isFallback ? 'text-amber-900' : 'text-blue-900'
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <Sparkles className={`w-4 h-4 ${aiFeedback.isFallback ? 'text-amber-600' : 'text-blue-600'}`} />
                            <span>
                              {aiFeedback.isFallback ? 'AI Quality Check Unavailable' : `AI Quality Score: ${aiFeedback.score}/100`}
                            </span>
                          </div>
                        </div>
                        <p className="text-[11px] text-slate-700">{aiFeedback.clarity}</p>
                        {typeof aiFeedback.wordCount === 'number' && (
                          <p
                            className={`text-[11px] font-semibold ${
                              aiFeedback.wordLimitNote?.startsWith('Exceeds') || aiFeedback.wordLimitNote?.startsWith('Below')
                                ? 'text-rose-700'
                                : 'text-slate-600'
                            }`}
                          >
                            {aiFeedback.wordLimitNote || `${aiFeedback.wordCount} words.`}
                          </p>
                        )}
                        {aiFeedback.improvements && (
                          <ul className="text-[11px] text-slate-600 list-disc list-inside space-y-0.5">
                            {aiFeedback.improvements.map((imp: string, i: number) => (
                              <li key={i}>{imp}</li>
                            ))}
                          </ul>
                        )}
                        {aiFeedback.suggestedRewrite && (
                          <div className="pt-2 border-t border-blue-200/60 space-y-1.5">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-blue-800">
                              AI-Suggested Rewrite (fits the requirement)
                            </p>
                            <p className="text-[11px] text-slate-700 leading-relaxed bg-white/70 p-2.5 rounded-lg border border-blue-100">
                              {aiFeedback.suggestedRewrite}
                            </p>
                            <button
                              type="button"
                              onClick={() => setDraftAbstractText(aiFeedback.suggestedRewrite)}
                              className="text-[11px] font-bold text-blue-700 hover:text-blue-900 cursor-pointer"
                            >
                              Use This Version
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Live Submission Package Preview — shows exactly what the Copy/Download
                      actions below will produce, instead of asking the user to click a button
                      whose output they can't see first. Updates as the fields above change. */}
                  <div className="space-y-2 pt-2 border-t border-slate-100">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
                          Submission Package Preview
                        </p>
                        <p className="text-[11px] text-slate-500">
                          This is exactly what "Copy" and "Download" below produce — formatted for {result.title}.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleCopyPackage}
                        disabled={!draftTitle.trim() || !draftAbstractText.trim()}
                        className="shrink-0 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-semibold text-[11px] rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copied ? 'Copied!' : 'Copy'}</span>
                      </button>
                    </div>
                    <pre className="whitespace-pre-wrap font-sans text-[11px] text-slate-700 leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-200 max-h-56 overflow-y-auto">
                      {buildSubmissionPackageText({
                        conferenceTitle: result.title,
                        title: draftTitle,
                        authors: draftAuthors,
                        abstractText: draftAbstractText,
                        requirementsNote: data?.submissionRequirements || null,
                      })}
                    </pre>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={handleDownloadDraft}
                      disabled={!draftTitle.trim() || !draftAbstractText.trim() || downloadingDraft}
                      className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      <Download className="w-4 h-4" />
                      <span>{downloadingDraft ? 'Preparing...' : 'Download Formatted Draft (Word)'}</span>
                    </button>
                    {submissionChannel === 'email' && mailtoLink ? (
                      <a
                        href={mailtoLink}
                        className="px-5 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 font-bold text-xs rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
                      >
                        <Mail className="w-4 h-4" />
                        <span>Then Email It In</span>
                      </a>
                    ) : (
                      <a
                        href={submissionLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-5 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 font-bold text-xs rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
                      >
                        <ExternalLink className="w-4 h-4" />
                        <span>{submissionChannel === 'form' ? 'Then Paste It Into the Form' : 'Then Upload on Official Site'}</span>
                      </a>
                    )}
                  </div>

                  {/* Mark as Submitted Externally — a self-reported bookmark for My Abstracts,
                      since ConferenceGate has no way to know a submission on another site actually
                      went through; it only knows what the author tells it. */}
                  {author && (
                    <div className="pt-3 border-t border-slate-100">
                      {markedSubmitted ? (
                        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2 font-medium">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span>Saved to My Abstracts as submitted externally.</span>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={handleMarkSubmitted}
                            disabled={markingSubmitted || !draftTitle.trim()}
                            className="text-xs font-bold text-slate-600 hover:text-slate-900 underline decoration-dotted underline-offset-4 cursor-pointer disabled:opacity-50"
                          >
                            {markingSubmitted ? 'Saving…' : "I've submitted this — save it to My Abstracts"}
                          </button>
                          {markError && <p className="text-[11px] text-rose-600 mt-1">{markError}</p>}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'fees' && (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Official registration information</p>
                    <h3 className="text-lg font-bold text-slate-900">Fees & Pricing</h3>
                  </div>
                  {data?.earlyBirdDeadline && (
                    <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-xl">
                      Early bird ends ${data.earlyBirdDeadline}
                    </span>
                  )}
                </div>

                {(data?.registrationFees || []).length > 0 || data?.registrationUrl ? (
                  <div className="space-y-5">
                    {(data?.registrationFees || []).length > 0 && (
                      <div className="overflow-x-auto rounded-2xl border border-slate-200">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                            <tr>
                              <th className="text-left px-4 py-3">Category</th>
                              <th className="text-left px-4 py-3">Deadline</th>
                              <th className="text-right px-4 py-3">Price</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data!.registrationFees.map((fee, i) => (
                              <tr key={`${fee.category}-${i}`} className="border-t border-slate-200">
                                <td className="px-4 py-3 text-slate-800 font-semibold">
                                  ${fee.category}
                                  {fee.notes && <div className="font-normal text-slate-500 mt-0.5">${fee.notes}</div>}
                                </td>
                                <td className="px-4 py-3 text-slate-600 whitespace-nowrap">${fee.deadline || '—'}</td>
                                <td className="px-4 py-3 text-right font-bold text-blue-800 whitespace-nowrap">
                                  {fee.amount !== null ? `${fee.currency ? `${fee.currency} ` : ''}${fee.amount}` : 'See official site'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {data?.registrationUrl && (
                      <a
                        href={data.registrationUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-900 hover:bg-blue-950 text-white text-xs font-bold rounded-xl transition-colors"
                      >
                        <span>Register on the official site</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                ) : (
                  <EmptyExtractState
                    message={
                      data?.crawlComplete
                        ? 'No registration prices were published on the pages we could read.'
                        : 'Still checking the conference website for registration fees and ticket prices.'
                    }
                    sourceUrl={result.link}
                  />
                )}
              </div>
            )}

            {activeTab === 'agenda' && (
              <div className="space-y-6">
                <h3 className="text-lg font-bold text-slate-900">Program & Agenda</h3>
                {!data?.agendaSessions.length ? (
                  data?.crawlComplete === true ? (
                    <EmptyExtractState
                      message={data.fetchFailed
                        ? "Program information was not retrieved; this does not mean the conference has no program."
                        : "The completed crawl found no session-by-session program."}
                      sourceUrl={result.link}
                    />
                  ) : (
                    <div className="py-12 flex items-center justify-center gap-2 text-xs text-blue-700">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Reading the main program and schedule pages…
                    </div>
                  )
                ) : (
                  <div className="space-y-3">
                    {data.agendaSessions.map((ses, idx) => (
                      <div
                        key={idx}
                        className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex flex-col sm:flex-row items-start justify-between gap-4"
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
                            {(ses.date || ses.time) && (
                              <>
                                <Clock className="w-3.5 h-3.5 text-blue-600" />
                                <span>{[ses.date, ses.time].filter(Boolean).join(' • ')}</span>
                              </>
                            )}
                            {ses.track && <span className="text-blue-600 font-semibold">{ses.track}</span>}
                          </div>
                          <h5 className="text-sm font-bold text-slate-900">{ses.title}</h5>
                        </div>
                        {ses.speakerName && (
                          <div className="flex items-center gap-3 shrink-0">
                            <img
                              src={ses.speakerImageUrl || generateInitialsAvatar(ses.speakerName)}
                              alt=""
                              className="w-9 h-9 rounded-full object-cover ring-2 ring-blue-500/20"
                              onError={(e) => {
                                e.currentTarget.onerror = null;
                                e.currentTarget.src = generateInitialsAvatar(ses.speakerName!);
                              }}
                            />
                            <div className="text-xs font-bold text-slate-900">{ses.speakerName}</div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'speakers' && (
              <div className="space-y-6">
                <h3 className="text-lg font-bold text-slate-900">Keynote & Invited Speakers</h3>
                {!data?.speakers.length ? (
                  data?.crawlComplete === true ? (
                    <EmptyExtractState
                      message={data.fetchFailed
                        ? "Speaker information was not retrieved; this does not mean the conference has no speakers."
                        : "The completed crawl found no named keynote or invited speakers."}
                      sourceUrl={result.link}
                    />
                  ) : (
                    <div className="py-12 flex items-center justify-center gap-2 text-xs text-blue-700">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Checking speaker, keynote, program, committee, and PDF pages…
                    </div>
                  )
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {data.speakers.map((spk, idx) => (
                      <PersonCard key={idx} name={spk.name} title={spk.title} org={spk.org} role={spk.role || 'Speaker'} imageUrl={spk.imageUrl} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'committee' && (
              <div className="space-y-6">
                <h3 className="text-lg font-bold text-slate-900">Technical Committee & Advisory Board</h3>
                {!data?.committee.length ? (
                  data?.crawlComplete === true ? (
                    <EmptyExtractState
                      message={data.fetchFailed
                        ? "Committee information was not retrieved."
                        : "The completed crawl found no named technical committee roster."}
                      sourceUrl={result.link}
                    />
                  ) : (
                    <div className="py-12 flex items-center justify-center gap-2 text-xs text-blue-700">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Reading committee, chair, organizer, and advisory pages…
                    </div>
                  )
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {data.committee.map((cm, idx) => (
                      <PersonCard key={idx} name={cm.name} title={cm.title} org={cm.org} role={cm.role} imageUrl={cm.imageUrl} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'sponsors' && (
              <div className="space-y-6">
                <h3 className="text-lg font-bold text-slate-900">Sponsors & Exhibitors</h3>
                {!data?.sponsors.length ? (
                  data?.crawlComplete === true ? (
                    <EmptyExtractState
                      message={data.fetchFailed
                        ? "Sponsor and exhibitor information was not retrieved."
                        : "The completed crawl found no named sponsors or exhibitors."}
                      sourceUrl={result.link}
                    />
                  ) : (
                    <div className="py-12 flex items-center justify-center gap-2 text-xs text-blue-700">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Checking sponsor, exhibitor, partner, and program pages…
                    </div>
                  )
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {data.sponsors.map((sp, idx) => (
                      <div key={idx} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-center space-y-2">
                        {sp.logoUrl && (
                          <img
                            src={sp.logoUrl}
                            alt=""
                            className="w-12 h-12 rounded-xl object-cover mx-auto"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                        )}
                        <div className="font-bold text-xs text-slate-900">{sp.name}</div>
                        {sp.tier && (
                          <span className="inline-block px-2 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-bold rounded-md">
                            {sp.tier}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'venue' && (
              <div className="space-y-6 text-xs text-slate-600">
                <h3 className="text-lg font-bold text-slate-900">Venue, Accommodation & Travel</h3>
                {(data?.venueName || data?.venueAddress) && (
                  <div className="p-5 bg-blue-50 rounded-2xl border border-blue-100 space-y-1">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-blue-600">
                      <MapPin className="w-3.5 h-3.5" />
                      <span>Conference Venue</span>
                    </div>
                    {data?.venueName && <p className="text-sm font-bold text-slate-900">{data.venueName}</p>}
                    {data?.venueAddress && <p className="text-slate-600">{data.venueAddress}</p>}
                  </div>
                )}
                {venueAnchor ? (
                  <div className="rounded-2xl overflow-hidden border border-slate-200">
                    <iframe
                      title="Venue location map"
                      src={`https://www.google.com/maps?q=${encodeURIComponent(venueAnchor)}&output=embed`}
                      className="w-full h-64 border-0"
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                    />
                  </div>
                ) : (
                  <EmptyExtractState
                    message="No venue location was found on this page, so a map can't be shown."
                    sourceUrl={result.link}
                  />
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                    <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
                      <Hotel className="w-4 h-4 text-blue-600" />
                      <span>Accommodation Details</span>
                    </div>
                    {data?.accommodationText ? (
                      <p>{data.accommodationText}</p>
                    ) : (
                      <p className="text-slate-400">
                        No accommodation details were found on this page —{' '}
                        <a href={result.link} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-semibold">
                          check the official website
                        </a>
                        .
                      </p>
                    )}
                    {nearbyHotelsUrl && (
                      <a
                        href={nearbyHotelsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-semibold rounded-lg transition-colors"
                      >
                        <Hotel className="w-3.5 h-3.5" />
                        <span>Find Hotels Near This Venue</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                  <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                    <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
                      <Plane className="w-4 h-4 text-rose-500" />
                      <span>Travel & Airport Transit</span>
                    </div>
                    {data?.travelText ? (
                      <p>{data.travelText}</p>
                    ) : (
                      <p className="text-slate-400">
                        No travel guidance was found on this page —{' '}
                        <a href={result.link} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-semibold">
                          check the official website
                        </a>
                        .
                      </p>
                    )}
                  </div>
                </div>

                {/* Hotels the conference itself named, nearest first. Ordering uses only distances
                    the site actually published, so a hotel listed without one sorts last rather
                    than being presented as if its position were known. */}
                {(data?.hotels || []).length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <h4 className="text-sm font-bold text-slate-900">
                        Where to Stay ({(data?.hotels || []).length})
                      </h4>
                      <span className="text-[10px] text-slate-400 font-semibold">
                        Nearest to the venue first
                        {(data?.hotels || []).some((h) => h.distanceSource === 'estimated')
                          ? ' — greyed distances are map estimates, not published by this conference'
                          : ''}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {(data?.hotels || []).map((hotel, i) => (
                        <div
                          key={`${hotel.name}-${i}`}
                          className="p-4 bg-white rounded-2xl border border-slate-200 flex flex-col sm:flex-row sm:items-center gap-3"
                        >
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-bold text-slate-900 text-[13px]">{hotel.name}</span>
                              {hotel.isOfficialBlock && (
                                <span className="text-[9px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                                  Conference Rate
                                </span>
                              )}
                            </div>
                            {hotel.address && <p className="text-slate-500 text-[11px]">{hotel.address}</p>}
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                              {hotel.distanceText && (
                                <span
                                  className={`flex items-center gap-1 font-semibold ${
                                    hotel.distanceSource === 'estimated' ? 'text-slate-500' : 'text-blue-700'
                                  }`}
                                  title={
                                    hotel.distanceSource === 'estimated'
                                      ? 'Straight-line estimate from map coordinates — this conference did not publish a distance for this hotel.'
                                      : 'Distance as published by the conference.'
                                  }
                                >
                                  <MapPin className="w-3 h-3" />
                                  {hotel.distanceText}
                                </span>
                              )}
                              {hotel.rateText && (
                                <span className="text-slate-700 font-semibold">{hotel.rateText}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {hotel.bookingUrl && (
                              <a
                                href={hotel.bookingUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold rounded-lg transition-colors"
                              >
                                <span>Book</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                            {venueAnchor && (
                              <a
                                href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(
                                  hotel.address || hotel.name
                                )}&destination=${encodeURIComponent(venueAnchor)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-semibold rounded-lg transition-colors"
                              >
                                <span>Route to venue</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'community' && (
              <div className="space-y-4 text-xs text-slate-600">
                <h3 className="text-lg font-bold text-slate-900">Conference Community & Discussions</h3>
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="font-bold text-slate-900">Not Available</span>
                  <p className="pt-1 text-slate-500">
                    This conference isn't in our verified catalog, so there's no Conference Gate community discussion
                    tied to it. Head to the <CheckCircle2 className="w-3 h-3 inline text-blue-600" /> Feed tab to
                    connect with attendees, authors, and reviewers on the platform generally.
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
