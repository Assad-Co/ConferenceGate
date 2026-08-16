import React, { useState } from 'react';
import { Award, Download, CheckCircle2, ShieldCheck, FileText, ArrowLeft } from 'lucide-react';
import { UserProfile } from '../types';

interface CertificatesViewProps {
  userProfile: UserProfile;
  onBack: () => void;
}

export const CertificatesView: React.FC<CertificatesViewProps> = ({
  userProfile,
  onBack,
}) => {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const mockCertificates = [
    {
      id: 'cert_1',
      title: 'Certificate of Paper Presentation',
      event: 'EAGE Annual Conference & Exhibition 2026',
      paperTitle: 'Deep Neural Network Architectures in Subsurface Source Rock Analytics',
      date: 'June 25, 2026',
      issuer: 'Technical Committee & EAGE Scientific Board',
      verificationHash: '0x8f9a2b4c1d6e3f8a',
    },
    {
      id: 'cert_2',
      title: 'Certificate of Outstanding Peer Reviewer',
      event: 'ADIPEC 2026',
      paperTitle: 'Verified Peer Review of 3 Technical Papers (+60 Kudos)',
      date: 'November 2, 2026',
      issuer: 'Conference Gate Global Reviewer Board',
      verificationHash: '0x3e7f1a9b2c4d6e8f',
    },
    {
      id: 'cert_3',
      title: 'Certificate of Technical Conference Attendance',
      event: 'AAPG Annual Convention and Exhibition (ACE) 2025',
      paperTitle: '32 Continuing Professional Development (CPD) Hours Completed',
      date: 'November 12, 2025',
      issuer: 'American Association of Petroleum Geologists (AAPG)',
      verificationHash: '0x7c8d9e0f1a2b3c4d',
    },
  ];

  const handleDownload = (certId: string) => {
    setDownloadingId(certId);
    setTimeout(() => {
      setDownloadingId(null);
    }, 2000);
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
            Download high-resolution PDF certificates verified with cryptographic hashes and QR codes for professional credentials and institutional filing.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {mockCertificates.map((cert) => (
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
      </div>
    </div>
  );
};
