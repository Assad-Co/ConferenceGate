import React, { useMemo } from 'react';
import {
  Award,
  CalendarCheck2,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  Mic2,
  Trophy,
  Users,
} from 'lucide-react';
import type { AbstractSubmission, ProfessionalInvitation } from '../types';
import type { ConferenceAttendance } from '../api/activity';

interface KudosProfileSectionProps {
  currentUserId?: string;
  currentUserEmail?: string;
  submissions: AbstractSubmission[];
  attendanceRecords: ConferenceAttendance[];
  professionalInvitations: ProfessionalInvitation[];
  onOpenCertificates: () => void;
}

type KudosItem = {
  id: string;
  title: string;
  conference: string;
  earnedAt?: string;
  rule: string;
  icon: React.ElementType;
};

const acceptedStatuses = new Set(['Accepted', 'Accepted for Oral', 'Accepted for Poster']);

const formatDate = (value?: string) => {
  if (!value) return 'Verified';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

export const KudosProfileSection: React.FC<KudosProfileSectionProps> = ({
  currentUserId,
  currentUserEmail,
  submissions,
  attendanceRecords,
  professionalInvitations,
  onOpenCertificates,
}) => {
  const earned = useMemo<KudosItem[]>(() => {
    const items: KudosItem[] = [];
    const email = currentUserEmail?.trim().toLowerCase();

    for (const attendance of attendanceRecords) {
      items.push({
        id: `attendance-${attendance.id || attendance.conferenceId}`,
        title: 'Welcome to the Conference!',
        conference: attendance.conferenceTitle,
        earnedAt: attendance.attendedAt,
        rule: 'Earned for a verified ConferenceGate attendance record.',
        icon: CalendarCheck2,
      });
    }

    for (const submission of submissions) {
      for (const review of submission.reviews || []) {
        if (!currentUserId || review.reviewerId !== currentUserId) continue;
        items.push({
          id: `review-${submission.id}-${review.id || review.date}`,
          title: 'Review Completed',
          conference: submission.conferenceTitle,
          earnedAt: review.date,
          rule: 'Earned after completing an assigned peer review.',
          icon: ClipboardCheck,
        });
      }

      const isMine =
        (!!currentUserId && (submission as any).submitterId === currentUserId) ||
        (!!email && (submission.coAuthors || []).some((author) => author.email?.trim().toLowerCase() === email));
      if (isMine && acceptedStatuses.has(submission.status)) {
        items.push({
          id: `accepted-${submission.id}`,
          title: 'Accepted Abstract',
          conference: submission.conferenceTitle,
          earnedAt: (submission as any).updatedAt || (submission as any).submittedAt,
          rule: 'Earned when your ConferenceGate abstract is accepted.',
          icon: FileCheck2,
        });
      }
    }

    for (const invitation of professionalInvitations) {
      if (invitation.status !== 'completed') continue;
      const base = {
        conference: invitation.conferenceTitle,
        earnedAt: (invitation as any).completedAt || (invitation as any).updatedAt || (invitation as any).createdAt,
      };
      if (invitation.roleType === 'committee') {
        items.push({
          id: `committee-${invitation.id}`,
          title: 'Technical Committee',
          ...base,
          rule: 'Earned after completing an organizer-assigned committee role.',
          icon: Users,
        });
      } else if (invitation.roleType === 'speaker') {
        items.push({
          id: `speaker-${invitation.id}`,
          title: 'Speaker / Presenter',
          ...base,
          rule: 'Earned after completing an organizer-assigned speaker role.',
          icon: Mic2,
        });
      } else if (invitation.roleType === 'chair') {
        items.push({
          id: `chair-${invitation.id}`,
          title: 'Session Chair',
          ...base,
          rule: 'Earned after completing an organizer-assigned chair role.',
          icon: Award,
        });
      }
    }

    const seen = new Set<string>();
    return items.filter((item) => {
      const key = `${item.title}|${item.conference}|${item.earnedAt || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [attendanceRecords, currentUserEmail, currentUserId, professionalInvitations, submissions]);

  const earningRules = [
    ['Conference Welcome', 'Attend a conference and have attendance recorded in ConferenceGate.'],
    ['Review Completed', 'Complete an abstract/paper review assigned through ConferenceGate.'],
    ['Technical Committee', 'Complete an organizer-assigned technical committee role.'],
    ['Speaker / Presenter', 'Complete an organizer-assigned speaker/presenter role.'],
    ['Session Chair', 'Complete an organizer-assigned chair role.'],
    ['Accepted Abstract', 'Have your ConferenceGate abstract accepted for the program.'],
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 to-amber-50 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Trophy className="h-6 w-6 text-amber-500" />
              <h2 className="text-xl font-extrabold text-slate-900">Kudos & Recognition</h2>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              Kudos are earned automatically from verified ConferenceGate activity and displayed on your profile.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenCertificates}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            View formal certificates
          </button>
        </div>
      </div>

      {earned.length > 0 ? (
        <div>
          <h3 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-slate-500">Your earned Kudos</h3>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {earned.map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.id} className="overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-sm">
                  <div className="bg-gradient-to-br from-blue-950 via-blue-800 to-blue-600 px-5 py-5 text-white">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-2xl font-black italic tracking-tight text-amber-300">Kudos!</span>
                      <div className="rounded-full bg-amber-300/20 p-2 ring-1 ring-amber-200/40">
                        <Icon className="h-6 w-6 text-amber-300" />
                      </div>
                    </div>
                    <h4 className="mt-6 text-lg font-extrabold">{item.title}</h4>
                    <p className="mt-1 text-xs text-blue-100">{item.conference}</p>
                  </div>
                  <div className="p-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-emerald-700">
                      <CheckCircle2 className="h-4 w-4" />
                      Verified by ConferenceGate
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-600">{item.rule}</p>
                    <p className="mt-3 text-xs font-semibold text-slate-400">Earned {formatDate(item.earnedAt)}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
          <Trophy className="mx-auto h-9 w-9 text-slate-300" />
          <h3 className="mt-3 font-bold text-slate-700">No Kudos earned yet</h3>
          <p className="mt-1 text-sm text-slate-500">Complete verified ConferenceGate activities below to unlock them.</p>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="font-extrabold text-slate-900">How to earn Kudos</h3>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {earningRules.map(([name, rule]) => (
            <div key={name} className="flex gap-3 rounded-xl bg-slate-50 p-3">
              <Trophy className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div>
                <div className="text-sm font-bold text-slate-800">{name}</div>
                <div className="text-xs leading-relaxed text-slate-500">{rule}</div>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-slate-500">
          Kudos are profile recognition. Certificates remain separate formal downloadable records for qualifying verified activity.
        </p>
      </div>
    </div>
  );
};
