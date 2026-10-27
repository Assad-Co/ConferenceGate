import React, { useEffect, useState } from "react";
import type { Conference, AbstractSubmission } from "../types";
import {
  fetchMatchedSponsorshipNeeds,
  fetchMySponsorPreferences,
  type SponsorPreferences,
  type SponsorshipNeed,
} from "../api/sponsors";
import { evidenceAssessment, isoDate, today } from "../intelligence/engine";
import "./conferenceIntelligence.css";

/** Mount only inside App's existing paid-role guard; APIs independently enforce that guard. */
export function OrganizerIntelligencePanel({
  conferences,
  submissions,
  registrations,
}: {
  conferences: Conference[];
  submissions: AbstractSubmission[];
  registrations: Record<string, number>;
}) {
  const ownIds = new Set(conferences.map((c) => c.id));
  const ownSubmissions = submissions.filter((s) => ownIds.has(s.conferenceId));
  const accepted = ownSubmissions.filter((s) =>
    /^Accepted/.test(s.status),
  ).length;
  const open = conferences.filter((c) =>
    ["Open", "Extended"].includes(c.cfpStatus),
  ).length;
  return (
    <details className="cg-intelligence bg-white border rounded-2xl p-5 mb-5">
      <summary className="font-extrabold cursor-pointer min-h-11">
        Organizer intelligence portal
      </summary>
      <p className="text-sm text-slate-600 my-3">
        Readiness and activity for your own conferences. These are recorded
        counts, not forecasts or independent quality ratings.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ["Conferences", conferences.length],
          ["Reported open CFPs", open],
          ["Submissions", ownSubmissions.length],
          ["Accepted", accepted],
        ].map(([label, value]) => (
          <div key={label} className="border rounded-xl p-3">
            <p className="text-xs">{label}</p>
            <strong className="text-xl">{value}</strong>
          </div>
        ))}
      </div>
      {!conferences.length && (
        <p className="mt-3 text-sm">
          No owned conferences yet. Insights become available when a conference
          exists in your workspace.
        </p>
      )}
      <div className="grid md:grid-cols-2 gap-3 mt-3">
        {conferences.map((c) => {
          const assessment = evidenceAssessment({
            title: c.title,
            link: c.officialWebsite || "",
            organization: c.organizerName,
            startDate: c.dates.start,
            endDate: c.dates.end,
            location: c.location,
            description: c.description,
          });
          const total = ownSubmissions.filter(
            (s) => s.conferenceId === c.id,
          ).length;
          const needsReview = ownSubmissions.filter(
            (s) =>
              s.conferenceId === c.id &&
              !["Draft", "Withdrawn", "Rejected"].includes(s.status) &&
              !/^Accepted/.test(s.status),
          ).length;
          return (
            <article key={c.id} className="border rounded-xl p-4 space-y-2">
              <h3 className="font-bold">{c.title}</h3>
              <p className="text-sm">
                {total} submissions · {needsReview} in the review workflow ·{" "}
                {registrations[c.id] || 0} registrations
              </p>
              <p className="text-sm">
                {assessment.score}/100 information readiness · CFP deadline:{" "}
                {c.abstractDeadline || "not recorded"}
              </p>
              {!c.submissionGuidelines && (
                <p className="text-sm text-amber-900">
                  Action: publish clear submission requirements.
                </p>
              )}
              {isoDate(c.abstractDeadline) &&
                c.abstractDeadline < today() &&
                ["Open", "Extended"].includes(c.cfpStatus) && (
                  <p className="text-sm text-amber-900">
                    Action: review CFP status; its recorded deadline has passed.
                  </p>
                )}
              {assessment.flags.map((f) => (
                <p className="text-xs text-amber-900" key={f}>
                  {f}
                </p>
              ))}
            </article>
          );
        })}
      </div>
    </details>
  );
}
export function SponsorIntelligencePanel() {
  const [open, setOpen] = useState(false),
    [needs, setNeeds] = useState<SponsorshipNeed[]>([]),
    [preferences, setPreferences] = useState<SponsorPreferences | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([fetchMatchedSponsorshipNeeds(), fetchMySponsorPreferences()])
      .then(([n, p]) => {
        if (active) {
          setNeeds(n);
          setPreferences(p);
        }
      })
      .catch(() => {
        if (active)
          setError(
            "Sponsor opportunities could not be loaded. Access remains restricted to authorized paid workspaces.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, retry]);
  const active = needs
    .filter(
      (n) =>
        n.status === "active" &&
        (!n.deadline || Boolean(isoDate(n.deadline) && n.deadline >= today())),
    )
    .sort((a, b) => (b.matchScore ?? -1) - (a.matchScore ?? -1));
  return (
    <section className="cg-intelligence bg-white border rounded-2xl p-5 mb-5">
      <button
        type="button"
        className="cg-intel-button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Sponsor opportunity intelligence
      </button>
      {open && (
        <div className="space-y-3 mt-3">
          <p className="text-sm">
            Explainable matches from organizer-published inventory using your
            existing sector, category, region, type and budget preferences. No
            inferred audience sizes, guaranteed returns or automatic inquiries.
          </p>
          {preferences && (
            <p className="text-xs text-slate-600">
              Preferences:{" "}
              {[
                ...preferences.sectors,
                ...preferences.categories,
                ...preferences.regions,
                ...preferences.opportunityTypes,
              ].join(" · ") ||
                "Not specified; configure preferences in your sponsor workspace."}
            </p>
          )}
          {loading && <p>Loading authorized opportunities…</p>}
          {error && (
            <div role="alert">
              <p className="text-red-700">{error}</p>
              <button
                type="button"
                className="cg-intel-button"
                onClick={() => setRetry((n) => n + 1)}
              >
                Retry
              </button>
            </div>
          )}
          {!loading && !error && !active.length && (
            <p>
              No active organizer-published inventory is available for these
              preferences.
            </p>
          )}
          {!loading &&
            !error &&
            active.map((n) => (
              <article key={n.id} className="border rounded-xl p-4 space-y-2">
                <h3 className="font-bold">{n.title}</h3>
                <p className="text-sm">
                  {n.conferenceTitle} ·{" "}
                  {n.organizerName || "Organizer name not recorded"}
                </p>
                <p className="text-sm">{n.description}</p>
                <p className="text-sm">
                  Match:{" "}
                  {n.matchScore === null ? "not scored" : `${n.matchScore}/100`}{" "}
                  ·{" "}
                  {n.matchReasons.join(" · ") ||
                    "Matching explanation not recorded"}
                </p>
                <p className="text-xs">
                  {n.totalSlots} published slots · Deadline:{" "}
                  {n.deadline || "not stated"}
                </p>
                <p className="text-xs">
                  Match dimensions:{" "}
                  {Object.entries(n.matchBreakdown || {})
                    .map(([k, v]) => `${k}: ${v === null ? "unknown" : v}`)
                    .join(" · ") || "not available"}
                </p>
                <p className="text-xs text-slate-600">
                  Use the existing Opportunities workspace to review inventory
                  and decide whether to inquire.
                </p>
              </article>
            ))}
        </div>
      )}
    </section>
  );
}
