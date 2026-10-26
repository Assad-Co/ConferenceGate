import React, { useMemo, useState } from 'react';
import { Award, Download, ShieldCheck, ArrowLeft } from 'lucide-react';
import { AbstractSubmission, UserProfile, Conference, ProfessionalInvitation } from '../types';
import { ConferenceRegistration } from '../api/activity';
import { ConferenceLink } from './ConferenceLink';

interface CertificatesViewProps {
  userProfile: UserProfile;
  submissions: AbstractSubmission[];
  registrations: ConferenceRegistration[];
  conferences: Conference[];
  onSelectConference: (conf: Conference) => void;
  currentUserId?: string;
  currentUserEmail?: string;
  professionalInvitations?: ProfessionalInvitation[];
  onBack: () => void;
}

interface Certificate {
  id: string;
  title: string;
  event: string;
  conferenceId: string;
  paperTitle: string;
  date: string;
  issuer: string;
  verificationHash: string;
}

const ACCEPTED_STATUSES = ['Accepted', 'Accepted for Oral', 'Accepted for Poster'];

/** A stable, reproducible token derived from the certificate's real record id — not a random/fabricated value. */
function certHash(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return `0x${hash.toString(16).padStart(16, '0')}`;
}

export const CertificatesView: React.FC<CertificatesViewProps> = ({
  userProfile,
  submissions,
  registrations,
  conferences,
  onSelectConference,
  currentUserId,
  currentUserEmail,
  professionalInvitations = [],
  onBack,
}) => {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  void registrations;

  const certificates = useMemo<Certificate[]>(() => {
    const certs: Certificate[] = [];
    // Co-author issuance requires a separately verified identity workflow.
    void currentUserEmail;

    if (currentUserId) {
      // 1) Abstract Acceptance Certificate — only after a real ConferenceGate submission is accepted.
      submissions
        .filter(
          (s) =>
            !s.isExternal &&
            ACCEPTED_STATUSES.includes(s.status) &&
            s.submitterId === currentUserId
        )
        .forEach((s) => {
          const acceptedTimelineEntry = [...(s.visualTimeline || [])]
            .reverse()
            .find((entry) => /accept/i.test(entry.label) && entry.status === 'completed' && entry.date);
          certs.push({
            id: `paper_${s.id}`,
            title: 'Certificate of Abstract Acceptance',
            event: s.conferenceTitle,
            conferenceId: s.conferenceId,
            paperTitle: s.title,
            date: acceptedTimelineEntry?.date || '',
            issuer: `ConferenceGate verified abstract workflow — ${s.conferenceTitle}`,
            verificationHash: certHash(`abstract_${s.id}_${currentUserId}`),
          });
        });

      // 2) Reviewer Certificate — only after a submitted review exists in ConferenceGate.
      submissions.filter((s) => !s.isExternal).forEach((s) => {
        s.reviews
          .filter((r) => r.reviewerId === currentUserId && !!r.id && !!r.date &&
            (s.reviewerAssignments || []).some((a) => a.reviewerId === currentUserId))
          .forEach((r) => {
            certs.push({
              id: `review_${r.id}`,
              title: 'Certificate of Reviewer Recognition',
              event: s.conferenceTitle,
              conferenceId: s.conferenceId,
              paperTitle: `Completed peer review: ${s.title}`,
              date: r.date,
              issuer: 'ConferenceGate recorded peer-review activity',
              verificationHash: certHash(`review_${r.id}_${currentUserId}`),
            });
          });
      });
    }

    // 3) Technical Committee Certificate — only after the organizer marks the assignment completed.
    professionalInvitations
      .filter((invitation) => !!currentUserId && invitation.professionalId === currentUserId && invitation.status === 'completed' && invitation.roleType === 'committee' && !!invitation.completedAt)
      .forEach((invitation) => {
        certs.push({
          id: `committee_${invitation.id}`,
          title: 'Certificate of Technical Committee Service',
          event: invitation.conferenceTitle,
          conferenceId: invitation.conferenceId,
          paperTitle: invitation.title || 'Technical Committee Member',
          date: invitation.completedAt!.split(' ')[0].split('T')[0],
          issuer: `ConferenceGate organizer-confirmed committee workflow — ${invitation.conferenceTitle}`,
          verificationHash: certHash(`committee_${invitation.id}_${currentUserId || 'anon'}`),
        });
      });

    return certs;
  }, [submissions, professionalInvitations, currentUserId, currentUserEmail]);

  const handleDownload = async (certId: string) => {
    const cert = certificates.find((c) => c.id === certId);
    if (!cert || downloadingId) return;
    setDownloadingId(certId);
    setDownloadError(null);
    try {
      let issuedCertificateId: string | undefined;
      let recipientName = userProfile.name;
      let date = cert.date || 'Date not recorded';
      const issueRoute = cert.id.startsWith('paper_')
        ? `abstract/${encodeURIComponent(cert.id.slice('paper_'.length))}`
        : cert.id.startsWith('review_')
          ? `reviewer/${encodeURIComponent(cert.id.slice('review_'.length))}`
          : cert.id.startsWith('committee_')
            ? `committee/${encodeURIComponent(cert.id.slice('committee_'.length))}`
            : null;
      if (!issueRoute) throw new Error('Unsupported certificate type');
      const response = await fetch(`/api/certificates/issue/${issueRoute}`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      const payload = await response.json();
      if (!response.ok || !payload.certificate?.id) {
        throw new Error(payload.error || 'Could not issue an authenticated certificate');
      }
      issuedCertificateId = payload.certificate.id;
      recipientName = payload.certificate.recipient_name;
      date = payload.certificate.issued_at;
      const { downloadCertificatePDF } = await import('../utils/certificatePdf');
      await downloadCertificatePDF({
        title: cert.title,
        recipientName,
        event: cert.event,
        paperTitle: cert.paperTitle,
        issuer: cert.issuer,
        date,
        verificationHash: cert.verificationHash,
        issuedCertificateId,
      });
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'Certificate download failed');
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 font-semibold text-xs rounded-xl border border-slate-200 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Profile</span>
        </button>

        <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-200 flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4" />
          <span>ConferenceGate activity-based certificates</span>
        </span>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 space-y-6 shadow-xs">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
            My Certificates
          </h1>
          <p className="text-xs text-slate-500 mt-1 max-w-3xl">
            Formal certificates are issued only for three recorded milestones: abstract acceptance, completed peer review,
            and organizer-confirmed Technical Committee service. Every PDF is personalized with your profile name,
            certificate issue date, ConferenceGate branding, stamp, signature, and reference ID. Certificates are issued against recorded activities and can be independently checked by their server-issued ID.
          </p>
        </div>

        {downloadError && <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{downloadError}</p>}
        {certificates.length === 0 ? (
          <div className="text-center py-12 space-y-2">
            <Award className="w-10 h-10 text-slate-300 mx-auto" />
            <p className="text-sm font-bold text-slate-500">No formal certificates yet</p>
            <p className="text-xs text-slate-400 max-w-lg mx-auto">
              A certificate will appear automatically when your abstract is accepted, an assigned review is completed,
              or an organizer marks your Technical Committee assignment as completed.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {certificates.map((cert) => (
              <div key={cert.id} className="p-6 bg-white rounded-2xl border border-slate-200 space-y-4 flex flex-col justify-between shadow-xs">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="px-2.5 py-0.5 bg-blue-100 text-blue-800 font-bold text-[10px] rounded-md">
                      ConferenceGate Activity Certificate
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">{cert.verificationHash}</span>
                  </div>
                  <h3 className="font-bold text-base text-slate-900">{cert.title}</h3>
                  <ConferenceLink
                    conferences={conferences}
                    conferenceId={cert.conferenceId}
                    conferenceTitle={cert.event}
                    onSelectConference={onSelectConference}
                    className="text-xs font-semibold text-blue-700"
                  />
                  <p className="text-xs text-slate-600 bg-white p-3 rounded-xl border border-slate-200">
                    {cert.paperTitle}
                  </p>
                  <div className="text-[11px] text-slate-500 pt-1">
                    Activity date: <strong className="text-slate-800">{cert.date}</strong>
                  </div>
                </div>

                <button
                  onClick={() => handleDownload(cert.id)}
                  className="w-full py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  <span>{downloadingId === cert.id ? 'Generating personalized PDF...' : 'Download Certificate (PDF)'}</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
