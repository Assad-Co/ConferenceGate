import fs from 'node:fs';

function patch(path, replacements) {
  let text = fs.readFileSync(path, 'utf8');
  for (const [from, to, label] of replacements) {
    if (!text.includes(from)) throw new Error(`${path}: missing patch marker: ${label}`);
    text = text.replace(from, to);
  }
  fs.writeFileSync(path, text);
  console.log(`patched ${path}`);
}

patch('src/components/AbstractTrackerView.tsx', [
  [
    "      <div className=\"grid grid-cols-1 lg:grid-cols-3 gap-8\">\n        {/* Left Submissions Sidebar */}",
    "      {submissions.length === 0 ? (\n        <div className=\"bg-white rounded-3xl border border-slate-200 p-8 sm:p-12 shadow-xs text-center space-y-5\">\n          <div className=\"w-14 h-14 rounded-2xl bg-blue-50 text-blue-700 flex items-center justify-center mx-auto\">\n            <FileText className=\"w-7 h-7\" />\n          </div>\n          <div className=\"space-y-2\">\n            <h2 className=\"text-lg font-bold text-slate-900\">Start your first abstract submission</h2>\n            <p className=\"text-xs sm:text-sm text-slate-500 max-w-xl mx-auto leading-relaxed\">\n              Choose a ConferenceGate conference with an open call for papers, prepare the required author and abstract details, and submit it here. Once submitted, real status, reviewer assignments, decisions and revision requests will appear in this tracker.\n            </p>\n          </div>\n          <button\n            type=\"button\"\n            onClick={onOpenNewSubmission}\n            className=\"inline-flex items-center gap-2 px-5 py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer\"\n          >\n            <Plus className=\"w-4 h-4\" />\n            Submit Your First Abstract\n          </button>\n          <p className=\"text-[10px] text-slate-400\">ConferenceGate will not invent review progress for submissions made outside the platform.</p>\n        </div>\n      ) : (\n      <div className=\"grid grid-cols-1 lg:grid-cols-3 gap-8\">\n        {/* Left Submissions Sidebar */}",
    'abstract empty onboarding'
  ],
  [
    "      </div>\n    </div>\n  );\n};",
    "      </div>\n      )}\n    </div>\n  );\n};",
    'abstract empty onboarding close'
  ],
]);

patch('src/components/CertificatesView.tsx', [
  [
    "            title: 'Certificate of Paper Presentation',",
    "            title: 'Certificate of Accepted Abstract',",
    'accepted paper title'
  ],
  [
    "            issuer: `Technical Committee, ${s.conferenceTitle}`,",
    "            issuer: `ConferenceGate submission record — ${s.conferenceTitle}`,",
    'accepted paper issuer'
  ],
  [
    "          paperTitle: `Verified Peer Review of ${info.count} Technical Paper${info.count === 1 ? '' : 's'} (+${info.count * 20} Kudos)`,",
    "          paperTitle: `Completed peer review of ${info.count} submission${info.count === 1 ? '' : 's'}`,",
    'review certificate claim'
  ],
  [
    "          issuer: 'Conference Gate Global Reviewer Board',",
    "          issuer: 'ConferenceGate reviewer activity record',",
    'review issuer'
  ],
  [
    "        title: 'Certificate of Technical Conference Registration',",
    "        title: 'Conference Registration Record',",
    'registration title'
  ],
  [
    "        issuer: 'Conference Gate',",
    "        issuer: 'ConferenceGate registration record',",
    'registration issuer'
  ],
  [
    "          title: `Certificate of ${roleLabel}`,",
    "          title: `Verified ${roleLabel} Record`,",
    'professional role title'
  ],
  [
    "          issuer: `Verified by ConferenceGate organizer workflow — ${invitation.conferenceTitle}`,",
    "          issuer: `ConferenceGate organizer workflow — ${invitation.conferenceTitle}`,",
    'professional role issuer'
  ],
  [
    "          <span>All Certificates Authenticated by Conference Gate</span>",
    "          <span>Generated from ConferenceGate activity records</span>",
    'certificate auth banner'
  ],
  [
    "            Official Certificates & Accredited Record",
    "            Certificates & Verified Activity Records",
    'certificate heading'
  ],
  [
    "            Download PDF certificates generated from your real activity on Conference Gate — accepted papers,\n            completed peer reviews, and conference registrations.",
    "            Download PDF records generated from activity ConferenceGate can verify directly — accepted abstracts,\n            completed peer reviews, completed organizer roles, and conference registrations. A registration record does not claim attendance unless attendance is separately verified.",
    'certificate intro'
  ],
  [
    "              Certificates are generated automatically once you have an accepted paper, a completed peer review, or\n              a conference registration.",
    "              Records appear automatically once ConferenceGate can verify an accepted abstract, completed peer review,\n              completed organizer-assigned role, or conference registration.",
    'certificate empty copy'
  ],
  [
    "                      Official Credential",
    "                      Verified Activity Record",
    'credential badge'
  ],
  [
    "                  <span>{downloadingId === cert.id ? 'Generating Verified PDF...' : 'Download Official Certificate (PDF)'}</span>",
    "                  <span>{downloadingId === cert.id ? 'Generating PDF...' : 'Download Record (PDF)'}</span>",
    'download copy'
  ],
]);
