import React, { useEffect, useMemo, useState } from "react";
import {
  searchConferencesOnTheWeb,
  extractConferenceDetails,
  type LiveSearchResult,
  type ExtractedConferenceDetails,
} from "../api/search";
import { fetchProfessionalOpportunities, fetchReviewOpportunities } from "../api/activity";
import type { UserProfile, ProfessionalOpportunity, ReviewOpportunity } from "../types";
import {
  cfpIntelligence,
  conferenceKey,
  emptyState,
  evaluateAlerts,
  evidenceAssessment,
  isoDate,
  matchConference,
  matchOpportunity,
  planCalendar,
  safeLink,
  today,
  topicMatches,
  type IntelligenceState,
  type Plan,
} from "../intelligence/engine";
import { smartSearch } from "../intelligence/search";
import {
  exportFile,
  readIntelligence,
  saveIntelligence,
} from "../intelligence/storage";
const ConferenceIntelligenceMap = React.lazy(() =>
  import("./ConferenceIntelligenceMap").then((m) => ({
    default: m.ConferenceIntelligenceMap,
  })),
);
import "./conferenceIntelligence.css";

type View =
  | "matches"
  | "search"
  | "map"
  | "cfp"
  | "safety"
  | "opportunities"
  | "alerts"
  | "planner";
const views: Array<[View, string]> = [
  ["matches", "My matches"],
  ["search", "Smart search"],
  ["map", "Global map"],
  ["cfp", "Abstract & CFP"],
  ["safety", "Source & risk checks"],
  ["opportunities", "Professional opportunities"],
  ["alerts", "Smart alerts"],
  ["planner", "Planning dashboard"],
];
export function ConferenceDiscoveryWorkspace({
  accountId,
  profile,
  onOpen,
  onOpportunities,
  children,
}: {
  accountId: string;
  profile: UserProfile;
  onOpen: (r: LiveSearchResult) => void;
  onOpportunities?: () => void;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <ConferenceIntelligenceHub
        accountId={accountId}
        profile={profile}
        onOpen={onOpen}
        onOpportunities={onOpportunities}
        onExpandedChange={setExpanded}
      />
      {!expanded && children}
    </>
  );
}
export function ConferenceIntelligenceHub({
  accountId,
  profile,
  onOpen,
  defaultView = "matches",
  onExpandedChange,
  onOpportunities,
}: {
  accountId: string;
  profile: UserProfile;
  onOpen: (r: LiveSearchResult) => void;
  defaultView?: View;
  onExpandedChange?: (open: boolean) => void;
  onOpportunities?: () => void;
}) {
  const [expanded, setExpanded] = useState(defaultView === "planner");
  return (
    <section className="cg-intelligence bg-white border border-slate-200 rounded-2xl mb-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900">
            Conference Intelligence
          </h2>
          <p className="text-sm text-slate-600">
            Find relevant events, inspect the evidence, and organize your next
            steps.
          </p>
        </div>
        <button
          type="button"
          className="cg-intel-button"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded(!expanded);
            onExpandedChange?.(!expanded);
          }}
        >
          {expanded
            ? "Close intelligence workspace"
            : "Open intelligence workspace"}
        </button>
      </div>
      {expanded && (
        <IntelligenceWorkspace
          key={accountId}
          accountId={accountId}
          profile={profile}
          onOpen={onOpen}
          defaultView={defaultView}
          onOpportunities={onOpportunities}
        />
      )}
    </section>
  );
}

function IntelligenceWorkspace({
  accountId,
  profile,
  onOpen,
  defaultView,
  onOpportunities,
}: {
  accountId: string;
  profile: UserProfile;
  onOpen: (r: LiveSearchResult) => void;
  defaultView: View;
  onOpportunities?: () => void;
}) {
  const [view, setView] = useState<View>(defaultView);
  const [results, setResults] = useState<LiveSearchResult[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0),
    [loadedAt, setLoadedAt] = useState("");
  const [storage] = useState(() => {
    try {
      return { data: readIntelligence(accountId), error: "" };
    } catch {
      return {
        data: emptyState(),
        error:
          "Your saved planning data could not be read. It has been preserved. Browser storage must be available to save changes.",
      };
    }
  });
  const [state, setState] = useState<IntelligenceState>(storage.data),
    [storageError, setStorageError] = useState(storage.error),
    [notice, setNotice] = useState("");
  const [query, setQuery] = useState(""),
    [country, setCountry] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [cfpOnly, setCfpOnly] = useState(false),
    [limit, setLimit] = useState(12);
  const [selected, setSelected] = useState<LiveSearchResult | null>(null),
    [detail, setDetail] = useState<ExtractedConferenceDetails | null>(null),
    [detailLoading, setDetailLoading] = useState(false);
  const [opportunities, setOpportunities] = useState<ProfessionalOpportunity[]>(
      [],
    ),
    [opError, setOpError] = useState(""),
    [opLoading, setOpLoading] = useState(false);
  const [abstract, setAbstract] = useState("");
  const [reviewOpenings,setReviewOpenings]=useState<ReviewOpportunity[]>([]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    searchConferencesOnTheWeb("", "low", false)
      .then((data) => {
        if (active) {
          setResults(data);
          setLoadedAt(new Date().toLocaleString());
        }
      })
      .catch(() => {
        if (active)
          setError(
            "Catalogue could not be loaded. Retry to refresh; previously loaded results are retained.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") setRefresh((n) => n + 1);
    }, 300000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    let active = true;
    setDetail(null);
    if (!selected) return;
    setDetailLoading(true);
    extractConferenceDetails(selected.link, selected.title)
      .then((d) => {
        if (active) setDetail(d);
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selected]);
  useEffect(() => {
    if (view !== "opportunities") return;
    let active = true;
    setOpLoading(true);
    setOpError("");
    Promise.all([fetchProfessionalOpportunities(),fetchReviewOpportunities()])
      .then(([data,reviews]) => {
        if (active) {setOpportunities(data);setReviewOpenings(reviews);}
      })
      .catch(() => {
        if (active)
          setOpError(
            "Professional opportunities could not be loaded. Switch away and back to retry.",
          );
      })
      .finally(() => {
        if (active) setOpLoading(false);
      });
    return () => {
      active = false;
    };
  }, [view]);
  const persist = (next: IntelligenceState) => {
    if (storage.error) {
      setStorageError(storage.error);
      return false;
    }
    try {
      saveIntelligence(accountId, next);
      setState(next);
      setStorageError("");
      return true;
    } catch {
      setStorageError(
        "Changes could not be saved. Browser storage may be full or disabled. Your earlier saved data is preserved.",
      );
      return false;
    }
  };
  useEffect(() => {
    if (!results.length || storage.error) return;
    setState((previous) => {
      const next = evaluateAlerts(previous, results);
      if (JSON.stringify(previous) === JSON.stringify(next)) return previous;
      try {
        saveIntelligence(accountId, next);
        return next;
      } catch {
        setStorageError("Alerts could not be saved in this browser.");
        return previous;
      }
    });
  }, [results]);
  const available = useMemo(
    () =>
      results.filter(
        (r) =>
          !isoDate(r.endDate || r.startDate) ||
          (r.endDate || r.startDate)! >= today(),
      ),
    [results],
  );
  const countries = useMemo(
    () =>
      [
        ...new Set(
          available.map((r) => r.location?.country).filter(Boolean) as string[],
        ),
      ].sort(),
    [available],
  );
  const filtered = useMemo(
    () => smartSearch(available, query, country, from, to, cfpOnly),
    [available, query, country, from, to, cfpOnly],
  );
  const ranked = useMemo(
    () =>
      filtered
        .map((result) => ({ result, match: matchConference(result, profile) }))
        .sort(
          (a, b) =>
            b.match.score - a.match.score ||
            String(a.result.startDate || "9999").localeCompare(
              String(b.result.startDate || "9999"),
            ),
        ),
    [filtered, profile],
  );
  const shown =
    view === "matches" ? ranked.filter((r) => r.match.score > 0) : ranked;
  const assessment = selected ? evidenceAssessment(selected, detail) : null;
  const cfp = selected ? cfpIntelligence(selected, detail) : null;
  const addPlan = (r: LiveSearchResult) => {
    const id = conferenceKey(r);
    if (state.plans.some((p) => p.id === id)) {
      setNotice("Already in your planning dashboard.");
      return;
    }
    if (state.plans.length >= 100) {
      setNotice(
        "Your dashboard supports up to 100 plans. Remove an old plan before adding another.",
      );
      return;
    }
    const confirmed =
      selected && conferenceKey(selected) === id ? cfp?.deadline : null;
    const saved = persist({
      ...state,
      plans: [
        ...state.plans,
        {
          id,
          result: r,
          status: "considering",
          deadline: confirmed || null,
          deadlineConfirmed: !!confirmed,
          notes: "",
          tasks: [
            {
              id: "source",
              text: "Confirm event details with the organizer",
              done: false,
            },
            {
              id: "prepare",
              text: "Prepare submission or registration materials",
              done: false,
            },
          ],
        },
      ],
    });
    if (saved) setNotice("Added to your personal planning dashboard.");
  };
  const patchPlan = (id: string, patch: Partial<Plan>) =>
    persist({
      ...state,
      plans: state.plans.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    });
  const saveRule = () => {
    if (state.rules.length >= 20) {
      setNotice(
        "Up to 20 alert rules are supported. Remove an existing rule first.",
      );
      return;
    }
    const rule = {
      id: crypto.randomUUID(),
      name: query.trim() || country || "Conference updates",
      query,
      country,
      from,
      to,
      cfpOnly,
      enabled: true,
      seen: {},
    };
    persist(
      evaluateAlerts({ ...state, rules: [...state.rules, rule] }, available),
    );
    setView("alerts");
    setNotice(
      "Alert saved. Current matches appear now; future checks run while this workspace is open.",
    );
  };
  const openEvidence = (r: LiveSearchResult) => {
    setSelected(r);
    setView("safety");
    setAbstract("");
  };
  return (
    <div className="mt-5 space-y-4">
      <div className="flex flex-wrap gap-2" aria-label="Intelligence sections">
        {views.map(([id, label]) => (
          <button
            type="button"
            key={id}
            aria-pressed={view === id}
            className="cg-intel-button"
            onClick={() => setView(id)}
          >
            {label}
            {id === "alerts" && state.alerts.some((a) => !a.read)
              ? ` (${state.alerts.filter((a) => !a.read).length})`
              : ""}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        Free professional tools. Matches use explainable topic synonyms and your
        profile; scores are not endorsements. Plans and alert rules are saved
        per account in this browser only. They do not sync across devices.
        Alerts run here every five minutes while open; no email or background
        delivery.
      </p>
      {storageError && (
        <p role="alert" className="text-sm text-red-700">
          {storageError}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-blue-800">
          {notice}
        </p>
      )}
      <div className="flex flex-wrap gap-3 text-xs text-slate-600">
        <span>
          {loading
            ? "Loading catalogue…"
            : `${available.length} upcoming or undated records in this snapshot`}
          {loadedAt && ` · Read ${loadedAt}`}
        </span>
        <button
          type="button"
          className="underline"
          disabled={loading}
          onClick={() => setRefresh((n) => n + 1)}
        >
          Refresh catalogue
        </button>
      </div>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {!["planner", "opportunities", "alerts"].includes(view) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <label className="lg:col-span-2">
            Topics or search terms
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(12);
              }}
              maxLength={200}
              placeholder={'AI "health care" -finance'}
            />
          </label>
          <label>
            Country
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            >
              <option value="">All countries</option>
              {countries.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Starts on or after
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              onBlur={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            Starts on or before
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              onBlur={(e) => setTo(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={cfpOnly}
              onChange={(e) => setCfpOnly(e.target.checked)}
            />
            Reported open CFP only
          </label>
          <button
            type="button"
            className="cg-intel-button"
            onClick={saveRule}
            disabled={loading || !results.length}
          >
            Save these filters as an alert
          </button>
        </div>
      )}
      {from && to && from > to && (
        <p role="alert" className="text-red-700">
          End of date range must be on or after its start.
        </p>
      )}
      {view === "map" && (
        <React.Suspense fallback={<p>Loading global map…</p>}>
          <ConferenceIntelligenceMap
            results={smartSearch(available, query, "", from, to, cfpOnly)}
            country={country}
            onCountry={setCountry}
          />
        </React.Suspense>
      )}
      {["matches", "search", "map"].includes(view) && (
        <>
          <p className="text-sm text-slate-600">
            {shown.length} results
            {view === "matches"
              ? " with profile overlap. Add expertise or research interests in your profile to improve relevance."
              : ". Search supports quoted phrases, exclusions with -, and topic synonyms. Date filters exclude unknown dates."}
          </p>
          {!loading && !shown.length && (
            <p className="p-5 bg-slate-50 rounded-xl">
              No matches. Try fewer filters or update your professional
              interests.
            </p>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            {shown.slice(0, limit).map(({ result: r, match }) => (
              <article
                className="border rounded-xl p-4 space-y-2"
                key={conferenceKey(r)}
              >
                <h3 className="font-bold">{r.title}</h3>
                <p className="text-xs text-slate-600">
                  {r.startDate || "Date not stated"} ·{" "}
                  {r.location?.country || "Country not stated"}
                </p>
                {match.reasons.length > 0 && (
                  <p className="text-xs text-blue-800">
                    Profile fit {match.score}/100 ·{" "}
                    {match.reasons.slice(0, 4).join(" · ")}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="cg-intel-button"
                    onClick={() => onOpen(r)}
                  >
                    Conference details
                  </button>
                  <button
                    type="button"
                    className="cg-intel-button"
                    onClick={() => openEvidence(r)}
                  >
                    Inspect evidence & CFP
                  </button>
                  <button
                    type="button"
                    className="cg-intel-button"
                    onClick={() => addPlan(r)}
                  >
                    Add to plan
                  </button>
                </div>
              </article>
            ))}
          </div>
          {shown.length > limit && (
            <button
              type="button"
              className="cg-intel-button"
              onClick={() => setLimit((n) => n + 12)}
            >
              Show more matches
            </button>
          )}
        </>
      )}
      {["cfp", "safety"].includes(view) && (
        <div className="space-y-4">
          <label>
            Conference to inspect
            <select
              value={selected ? conferenceKey(selected) : ""}
              onChange={(e) => {
                setSelected(
                  available.find((r) => conferenceKey(r) === e.target.value) ||
                    null,
                );
                setAbstract("");
              }}
            >
              <option value="">Choose a conference</option>
              {(selected &&
              !filtered.some(
                (r) => conferenceKey(r) === conferenceKey(selected),
              )
                ? [selected, ...filtered]
                : filtered
              ).map((r) => (
                <option key={conferenceKey(r)} value={conferenceKey(r)}>
                  {r.title} — {r.startDate || "undated"}
                </option>
              ))}
            </select>
          </label>
          {detailLoading && (
            <p role="status">Reading stored source evidence…</p>
          )}
          {selected && assessment && cfp && !detailLoading && (
            <>
              <div className="grid md:grid-cols-2 gap-4">
                <section className="border rounded-xl p-4 space-y-2">
                  <h3 className="font-bold">
                    {assessment.label}: {assessment.score}/100
                  </h3>
                  <p className="text-sm">
                    Measures the recorded information below. No independent
                    quality certification or fraud clearance is implied. Missing
                    evidence is not proof of misconduct.
                  </p>
                  <ul className="text-sm space-y-1">
                    {assessment.fields.map(([name, present]) => (
                      <li key={name}>
                        {present ? "Recorded" : "Not recorded"}: {name}
                      </li>
                    ))}
                  </ul>
                </section>
                <section className="border rounded-xl p-4 space-y-2">
                  <h3 className="font-bold">Risk screening</h3>
                  <p className="text-sm">
                    Heuristic checks of stored fields, link security, dates and
                    source conflicts. No live fraud registry or organizer
                    identity check is performed.
                  </p>
                  {assessment.flags.length ? (
                    <ul className="list-disc pl-5 text-sm text-amber-900">
                      {assessment.flags.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm">
                      No configured red flags found. This is not a guarantee of
                      legitimacy.
                    </p>
                  )}
                  <p className="text-xs">
                    Before paying or submitting, independently confirm the
                    organizer, venue, review process and contact information.
                  </p>
                </section>
              </div>
              <section className="border rounded-xl p-4 space-y-2">
                <h3 className="font-bold">Source trail</h3>
                {safeLink(selected.link) && (
                  <a
                    className="underline text-blue-700"
                    href={safeLink(selected.link)!}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open listed event website
                  </a>
                )}
                <p className="text-xs">
                  {detail?.extracted
                    ? "Stored extraction available"
                    : "No stored extraction available; source-level checks remain incomplete"}
                  .{" "}
                  {detail?.sourcedFromOpenWeb
                    ? "Includes third-party sources."
                    : ""}{" "}
                  Source publication or verification time:{" "}
                  {String(
                    detail?.extraction_metadata?.last_verified_at ||
                      detail?.extraction_metadata?.extracted_at ||
                      "not recorded",
                  )}
                  . Catalogue read time above is not a verification date.
                </p>
                {Object.entries(detail?.provenance || {})
                  .slice(0, 20)
                  .map(([field, p]) => (
                    <p key={field} className="text-xs">
                      {field} · source confidence {p.confidence} ·{" "}
                      {safeLink(p.sourceUrl) ? (
                        <a
                          className="underline"
                          href={safeLink(p.sourceUrl)!}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {p.sourcePageTitle || p.sourceUrl}
                        </a>
                      ) : (
                        "Source link unavailable"
                      )}
                    </p>
                  ))}
                {(detail?.conflicts || []).map((c, i) => (
                  <div key={i} className="text-sm text-amber-900">
                    <strong>Conflict: {c.field}</strong>
                    {c.values.map((v, j) => (
                      <p key={j}>
                        {v.value}{" "}
                        {safeLink(v.sourceUrl) && (
                          <a
                            className="underline"
                            href={safeLink(v.sourceUrl)!}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            source
                          </a>
                        )}
                      </p>
                    ))}
                  </div>
                ))}
              </section>
              <section className="border rounded-xl p-4 space-y-3">
                <h3 className="font-bold">Abstract & CFP intelligence</h3>
                <p>
                  {cfp.state}
                  {cfp.deadline ? ` · ${cfp.deadline} (${cfp.days} days)` : ""}
                </p>
                {cfp.issues.map((s) => (
                  <p key={s} className="text-amber-900">
                    {s}
                  </p>
                ))}
                {cfp.raw && !cfp.deadline && (
                  <p className="text-sm">Source deadline wording: {cfp.raw}</p>
                )}
                <p className="text-sm whitespace-pre-wrap">
                  {cfp.requirements || "Submission requirements not recorded."}
                </p>
                <p className="text-sm">
                  Length: {cfp.length || "not recorded"} · Review:{" "}
                  {cfp.review || "not recorded"}
                </p>
                <p className="text-sm">
                  Topics: {cfp.topics.join(", ") || "not recorded"}
                </p>
                <div className="flex flex-wrap gap-3">
                  {cfp.submissionUrl && (
                    <a
                      className="underline text-blue-700"
                      href={cfp.submissionUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Source submission page
                    </a>
                  )}
                  {cfp.templateUrl && (
                    <a
                      className="underline text-blue-700"
                      href={cfp.templateUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Source template
                    </a>
                  )}
                  <button
                    type="button"
                    className="cg-intel-button"
                    onClick={() => addPlan(selected)}
                  >
                    Add conference to plan
                  </button>
                </div>
                <label>
                  Check abstract topic overlap (optional)
                  <textarea
                    value={abstract}
                    maxLength={12000}
                    onChange={(e) => setAbstract(e.target.value)}
                    placeholder="Text stays in this page and is discarded when you leave; it is not sent to a model or saved."
                    rows={4}
                  />
                </label>
                {abstract.trim() && (
                  <p role="status" className="text-sm">
                    {abstract.trim().split(/\s+/).length} words · Source topic
                    overlap:{" "}
                    {topicMatches(abstract, cfp.topics).join(", ") ||
                      "none found or source topics unavailable"}
                    . This checks topic wording, not scientific quality,
                    acceptance probability or compliance with unpublished
                    requirements.
                  </p>
                )}
              </section>
            </>
          )}
        </div>
      )}
      {view === "opportunities" && (
        <section className="space-y-3">
          <h3 className="font-bold">
            Organizer-published professional opportunities
          </h3>
          <p className="text-sm">
            Ranked against expertise, interests and role availability. No
            opportunities are inferred from conference listings. Express
            interest through the existing Reviewer & Opportunities workspace.
          </p>
          {onOpportunities&&<button type="button" className="cg-intel-button" onClick={onOpportunities}>Open opportunities and respond</button>}
          {opLoading && <p>Loading opportunities…</p>}
          {opError && (
            <p role="alert" className="text-red-700">
              {opError}
            </p>
          )}
          {!opLoading &&
            !opError &&
            !opportunities.some(
              (o) => matchOpportunity(o, profile).eligible,
            ) && !reviewOpenings.some(o=>!o.deadline||Boolean(isoDate(o.deadline)&&o.deadline>=today())) && <p>No active published opportunities are available.</p>}
          {opportunities
            .map((o) => ({ o, m: matchOpportunity(o, profile) }))
            .filter((x) => x.m.eligible)
            .sort((a, b) => b.m.score - a.m.score)
            .map(({ o, m }) => (
              <article className="border rounded-xl p-4" key={o.id}>
                <h4 className="font-bold">{o.title}</h4>
                <p>
                  {o.conferenceTitle} · {o.organizerName} · {o.roleType}
                </p>
                <p className="text-sm">{o.description}</p>
                <p className="text-xs">
                  Fit {m.score}/100 ·{" "}
                  {m.reasons.join(" · ") || "No profile overlap found"} ·
                  Deadline: {o.deadline || "not stated"}
                </p>
              </article>
            ))}
          {reviewOpenings.filter(o=>!o.deadline||Boolean(isoDate(o.deadline)&&o.deadline>=today())).map(o=>({o,reasons:topicMatches([o.topic,o.track,...o.expertiseRequired].join(' '),[...profile.expertise,...profile.researchInterests,...(profile.reviewerInfo?.expertiseKeywords||[])])})).sort((a,b)=>b.reasons.length-a.reasons.length).map(({o,reasons})=><article className="border rounded-xl p-4 space-y-2" key={`review:${o.id}`}><h4 className="font-bold">Reviewer: {o.topic}</h4><p>{o.conferenceTitle} · {o.organizerName}</p><p className="text-sm">Expertise overlap: {reasons.join(', ')||'No recorded overlap'} · Expected workload: {o.expectedWorkload||'not stated'} · Deadline: {o.deadline||'not stated'}</p><p className="text-xs">Your reviewer availability: {profile.reviewerInfo?.available?'available':'not enabled'} · Current load: {profile.reviewerInfo?.currentLoad??0}/{profile.reviewerInfo?.maxLoad??0}. Verify eligibility in the opportunity workspace before volunteering.</p></article>)}
        </section>
      )}
      {view === "alerts" && (
        <section className="space-y-3">
          <h3 className="font-bold">Saved alerts</h3>
          <p className="text-sm">
            New matching events and changes to dates, location, CFP status or
            available sections appear here. A first rule includes current
            matches. Paused rules resume checking when enabled. Checks require
            this workspace to be open.
          </p>
          {!state.rules.length && (
            <p>
              No alert rules yet. Set filters in Smart search, then choose Save
              these filters as an alert.
            </p>
          )}
          {state.rules.map((r) => (
            <div
              className="border rounded-xl p-3 flex flex-wrap gap-3 items-center"
              key={r.id}
            >
              <strong>{r.name}</strong>
              <span className="text-xs">
                {r.country || "All countries"} ·{" "}
                {r.cfpOnly ? "Reported open CFP" : "All CFP states"}
              </span>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={() =>
                    persist(
                      evaluateAlerts(
                        {
                          ...state,
                          rules: state.rules.map((x) =>
                            x.id === r.id ? { ...x, enabled: !x.enabled } : x,
                          ),
                        },
                        available,
                      ),
                    )
                  }
                />
                Enabled
              </label>
              <button
                type="button"
                className="cg-intel-button"
                onClick={() =>
                  persist({
                    ...state,
                    rules: state.rules.filter((x) => x.id !== r.id),
                    alerts: state.alerts.filter((a) => a.ruleId !== r.id),
                  })
                }
              >
                Remove rule
              </button>
            </div>
          ))}
          {state.alerts.length > 0 && (
            <button
              type="button"
              className="cg-intel-button"
              onClick={() =>
                persist({
                  ...state,
                  alerts: state.alerts.map((a) => ({ ...a, read: true })),
                })
              }
            >
              Mark all read
            </button>
          )}
          {state.alerts.map((a) => (
            <article key={a.id} className="border rounded-xl p-3">
              <p className="font-bold">
                {a.read ? "" : "Unread · "}
                {a.title}
              </p>
              <button
                type="button"
                className="text-blue-700 underline"
                onClick={() => {
                  persist({
                    ...state,
                    alerts: state.alerts.map((x) =>
                      x.id === a.id ? { ...x, read: true } : x,
                    ),
                  });
                  openEvidence(a.result);
                }}
              >
                {a.result.title}
              </button>
              <p className="text-xs">
                {new Date(a.createdAt).toLocaleString()}
              </p>
            </article>
          ))}
        </section>
      )}
      {view === "planner" && (
        <section className="space-y-4">
          <div className="flex flex-wrap justify-between gap-3">
            <h3 className="font-bold">
              Personal conference planning dashboard
            </h3>
            <button
              type="button"
              className="cg-intel-button"
              onClick={() =>
                exportFile(
                  "conferencegate-plans.json",
                  JSON.stringify({ version: 1, plans: state.plans }, null, 2),
                  "application/json",
                )
              }
            >
              Export plans
            </button>
          </div>
          <p className="text-sm">
            Personal progress only; these statuses do not submit an abstract,
            register you, or change official attendance. Notes remain on this
            browser; avoid confidential information on shared devices.
          </p>
          {!state.plans.length && (
            <p>No plans yet. Add an event from My matches or Smart search.</p>
          )}
          {state.plans.map((p) => (
            <article key={p.id} className="border rounded-xl p-4 space-y-3">
              <h4 className="font-bold">{p.result.title}</h4>
              <p className="text-xs">
                {p.result.startDate || "Date not stated"} ·{" "}
                {p.result.location?.country || "Country not stated"}
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                <label>
                  Personal progress
                  <select
                    value={p.status}
                    onChange={(e) =>
                      patchPlan(p.id, {
                        status: e.target.value as Plan["status"],
                      })
                    }
                  >
                    {[
                      "considering",
                      "preparing",
                      "submitted",
                      "registered",
                      "attended",
                    ].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Personal target date
                  <input
                    type="date"
                    value={p.deadline || ""}
                    onChange={(e) =>
                      patchPlan(p.id, {
                        deadline: isoDate(e.target.value),
                        deadlineConfirmed: false,
                      })
                    }
                    onBlur={(e) =>
                      patchPlan(p.id, {
                        deadline: isoDate(e.target.value),
                        deadlineConfirmed: false,
                      })
                    }
                  />
                </label>
              </div>
              {p.deadline && (
                <p className="text-xs">
                  {p.deadline < today()
                    ? "Past target"
                    : p.deadline <=
                        new Date(Date.now() + 7 * 86400000)
                          .toISOString()
                          .slice(0, 10)
                      ? "Due within seven days"
                      : "Upcoming"}{" "}
                  ·{" "}
                  {p.deadlineConfirmed
                    ? "Initially copied from stored CFP; reconfirm at source"
                    : "Your personal target, not an official deadline"}
                </p>
              )}
              <label>
                Planning notes
                <textarea
                  value={p.notes}
                  maxLength={4000}
                  rows={2}
                  onChange={(e) => patchPlan(p.id, { notes: e.target.value })}
                />
              </label>
              <div>
                {p.tasks.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 my-2">
                    <input
                      type="checkbox"
                      checked={t.done}
                      onChange={() =>
                        patchPlan(p.id, {
                          tasks: p.tasks.map((x) =>
                            x.id === t.id ? { ...x, done: !x.done } : x,
                          ),
                        })
                      }
                    />
                    {t.text}
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="cg-intel-button"
                  onClick={() => onOpen(p.result)}
                >
                  Conference details
                </button>
                <button
                  type="button"
                  className="cg-intel-button"
                  disabled={!isoDate(p.result.startDate)}
                  onClick={() => {
                    const text = planCalendar(p);
                    if (text)
                      exportFile(
                        "conferencegate-event.ics",
                        text,
                        "text/calendar",
                      );
                  }}
                >
                  Export calendar
                </button>
                <button
                  type="button"
                  className="cg-intel-button"
                  onClick={() =>
                    persist({
                      ...state,
                      plans: state.plans.filter((x) => x.id !== p.id),
                    })
                  }
                >
                  Remove personal plan
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
