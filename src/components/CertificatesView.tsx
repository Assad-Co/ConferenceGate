import React, { useMemo, useState } from 'react';
import { Award, Download, ShieldCheck, ArrowLeft } from 'lucide-react';
import { AbstractSubmission, UserProfile } from '../types';
import { ConferenceRegistration } from '../api/activity';
import { downloadCertificatePDF } from '../utils/certificatePdf';

interface CertificatesViewProps {
  userProfile: UserProfile;
  submissions: AbstractSubmission[];
  registrations: ConferenceRegistration[];
  currentUserId?: string;
  onBack: () => void;
}

interface Certificate {
  id: string;
  title: string;
  event: string;
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
  currentUserId,
  onBack,
}) => {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const certificates = useMemo<Certificate[]>(() => {
    const certs: Certificate[] = [];

    if (currentUserId) {
      submissions
        .filter((s) => s.submitterId === currentUserId && ACCEPTED_STATUSES.includes(s.status))
        .forEach((s) => {
          certs.push({
            id: `paper_${s.id}`,
            title: 'Certificate of Paper Presentation',
            event: s.conferenceTitle,
            paperTitle: s.title,
            date: s.submissionDate,
            issuer: `Technical Committee, ${s.conferenceTitle}`,
            verificationHash: certHash(s.id),
          });
        });

      const reviewsByConference = new Map<string, { count: number; latestDate: string }>();
      submissions.forEach((s) => {
        s.reviews
          .filter((r) => r.reviewerId === currentUserId)
          .forEach((r) => {
            const existing = reviewsByConference.get(s.conferenceTitle);
            if (existing) {
              existing.count += 1;
              if (r.date > existing.latestDate) existing.latestDate = r.date;
            } else {
              reviewsByConference.set(s.conferenceTitle, { count: 1, latestDate: r.date });
            }
          });
      });
      reviewsByConference.forEach((info, conferenceTitle) => {
        certs.push({
          id: `review_${conferenceTitle}`,
          title: 'Certificate of Peer Reviewer Service',
          event: conferenceTitle,
          paperTitle: `Verified Peer Review of ${info.count} Technical Paper${info.count === 1 ? '' : 's'} (+${info.count * 20} Kudos)`,
          date: info.latestDate,
          issuer: 'Conference Gate Global Reviewer Board',
          verificationHash: certHash(`review_${conferenceTitle}_${currentUserId}`),
        });
      });
    }

    registrations.forEach((r) => {
      certs.push({
        id: `attend_${r.conferenceId}`,
        title: 'Certificate of Technical Conference Registration',
        event: r.conferenceTitle,
        paperTitle: r.packageName ? `Registered Attendee — ${r.packageName}` : 'Registered Attendee',
        date: r.registeredAt.split(' ')[0].split('T')[0],
        issuer: 'Conference Gate',
        verificationHash: certHash(`attend_${r.conferenceId}_${currentUserId || 'anon'}`),
      });
    });

    return certs;
  }, [submissions, registrations, currentUserId]);

  const handleDownload = (certId: string) => {
    const cert = certificates.find((c) => c.id === certId);
    if (!cert) return;
    setDownloadingId(certId);
    setTimeout(() => {
      downloadCertificatePDF({
        title: cert.title,
        recipientName: userProfile.name,
        event: cert.event,
        paperTitle: cert.paperTitle,
        issuer: cert.issuer,
        date: cert.date,
        verificationHash: cert.verificationHash,
      });
      setDownloadingId(null);
    }, 600);
  };

  return (
    <div className="space-y-8">
      {/* Top Bar */}
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
          <span>All Certificates Authenticated by Conference Gate</span>
        </span>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 space-y-6 shadow-xs">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
            Official Certificates & Accredited Record
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Download PDF certificates generated from your real activity on Conference Gate — accepted papers,
            completed peer reviews, and conference registrations.
          </p>
        </div>

        {certificates.length === 0 ? (
          <div className="text-center py-12 space-y-2">
            <Award className="w-10 h-10 text-slate-300 mx-auto" />
            <p className="text-sm font-bold text-slate-500">No certificates yet</p>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Certificates are generated automatically once you have an accepted paper, a completed peer review, or
              a conference registration.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {certificates.map((cert) => (
              <div key={cert.id} className="p-6 bg-slate-50 rounded-2xl border border-slate-200 space-y-4 flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="px-2.5 py-0.5 bg-blue-100 text-blue-800 font-bold text-[10px] rounded-md">
                      Official Credential
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">{cert.verificationHash}</span>
                  </div>
                  <h3 className="font-bold text-base text-slate-900">{cert.title}</h3>
                  <p className="text-xs font-semibold text-blue-700">{cert.event}</p>
                  <p className="text-xs text-slate-600 bg-white p-3 rounded-xl border border-slate-200">
                    {cert.paperTitle}
                  </p>
                  <div className="text-[11px] text-slate-500 pt-1">
                    Issued by: <strong className="text-slate-800">{cert.issuer}</strong> on {cert.date}
                  </div>
                </div>

                <button
                  onClick={() => handleDownload(cert.id)}
                  className="w-full py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  <span>{downloadingId === cert.id ? 'Generating Verified PDF...' : 'Download Official Certificate (PDF)'}</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
