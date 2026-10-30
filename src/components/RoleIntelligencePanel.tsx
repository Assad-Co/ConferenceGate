import React from "react";
import type { Conference, AbstractSubmission } from "../types";
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
// Retain the export for legacy App generators; sponsor tools live in SponsorPortal.
export function SponsorIntelligencePanel() {
  return null;
}
