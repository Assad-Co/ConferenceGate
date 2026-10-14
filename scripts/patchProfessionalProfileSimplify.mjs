import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src/components/UserProfileView.tsx');
let source = fs.readFileSync(file, 'utf8');

const marker = '/* Professional profile simplified structure */';
if (source.includes(marker)) {
  console.log('Professional profile simplification already applied.');
} else {
  function replaceRequired(before, after, label) {
    if (!source.includes(before)) throw new Error(`Professional profile simplification target missing: ${label}`);
    source = source.replace(before, after);
  }

  replaceRequired(
`            {variant === 'professional' && (\n              <>\n                <button\n                  onClick={onOpenBadgeModal}\n                  className="px-4 py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-2"\n                >\n                  <Award className="w-4 h-4" />\n                  <span>Digital Badge</span>\n                </button>\n                <button\n                  onClick={onOpenCertificates}\n                  className="px-4 py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-2"\n                >\n                  <Download className="w-4 h-4" />\n                  <span>Certificates</span>\n                </button>\n              </>\n            )}`,
`${marker}`,
'duplicate badge/certificate actions'
  );

  replaceRequired(
`        {/* Evidence-first professional record — direct counts, no arbitrary headline score. */}`,
`        {variant === 'professional' && (\n          <div className="px-6 sm:px-8 py-5 border-t border-slate-200 bg-white">\n            <div className="flex items-center justify-between gap-3 mb-3">\n              <div>\n                <h3 className="text-sm font-extrabold text-slate-900">Professional Summary</h3>\n                <p className="text-[11px] text-slate-500 mt-0.5">A quick view of your expertise, organization, role, preferred regions, and availability.</p>\n              </div>\n            </div>\n            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">\n              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">\n                <div className="text-[10px] font-bold uppercase text-slate-400">Expertise</div>\n                <div className="text-xs font-bold text-slate-900 mt-1">{(userProfile.expertise || []).slice(0, 3).join(' • ') || 'Not added yet'}</div>\n              </div>\n              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">\n                <div className="text-[10px] font-bold uppercase text-slate-400">Organization</div>\n                <div className="text-xs font-bold text-slate-900 mt-1">{userProfile.organization || 'Not added yet'}</div>\n              </div>\n              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">\n                <div className="text-[10px] font-bold uppercase text-slate-400">Experience / Role</div>\n                <div className="text-xs font-bold text-slate-900 mt-1">{userProfile.title || 'Not added yet'}</div>\n              </div>\n              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">\n                <div className="text-[10px] font-bold uppercase text-slate-400">Preferred Regions</div>\n                <div className="text-xs font-bold text-slate-900 mt-1">{(userProfile.preferredRegions || []).slice(0, 3).join(' • ') || 'Not set yet'}</div>\n              </div>\n              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">\n                <div className="text-[10px] font-bold uppercase text-slate-400">Available Roles</div>\n                <div className="text-xs font-bold text-slate-900 mt-1">{[\n                  userProfile.reviewerInfo.available ? 'Reviewer' : null,\n                  userProfile.committeeAvailable ? 'Committee' : null,\n                  userProfile.sessionChairAvailable ? 'Session Chair' : null,\n                  userProfile.speakerAvailable ? 'Speaker / Keynote' : null,\n                ].filter(Boolean).join(' • ') || 'Not available'}</div>\n              </div>\n            </div>\n          </div>\n        )}\n\n        {/* Evidence-first professional record — direct counts, no arbitrary headline score. */}`,
'professional summary insertion'
  );

  replaceRequired(
`                { id: 'notifications', label: 'Notifications' },\n                { id: 'conferences', label: 'Conferences History' },\n                { id: 'papers', label: 'Papers & Abstracts' },\n                { id: 'linkedin', label: 'LinkedIn Profile' },\n                { id: 'reviews', label: 'Peer Reviews & Kudos' },\n                { id: 'committee', label: 'Committee Positions' },\n                { id: 'badges', label: 'Verified Badges' },\n                { id: 'trust', label: 'Trust & Verification' },\n                { id: 'analytics', label: 'Engagement Analytics' },`,
`                { id: 'notifications', label: 'Notifications' },\n                { id: 'conferences', label: 'Conference History' },\n                { id: 'papers', label: 'Papers & Abstracts' },\n                { id: 'linkedin', label: 'LinkedIn Profile' },\n                { id: 'reviews', label: 'Professional Roles' },\n                { id: 'badges', label: 'Credentials & Verification' },`,
'professional tab list'
  );

  replaceRequired(
`            <h3 className="text-base font-bold text-slate-900">Peer Review Profile</h3>`,
`            <div>\n              <h3 className="text-base font-bold text-slate-900">Professional Roles</h3>\n              <p className="text-[11px] text-slate-500 mt-1">Reviewer, Technical Committee, Session Chair, Speaker / Keynote, and completed conference roles in one place.</p>\n              <div className="flex flex-wrap gap-2 mt-3 text-[10px] font-bold">\n                <span className={\`px-2.5 py-1 rounded-full \${userProfile.reviewerInfo.available ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}\`}>Reviewer: {userProfile.reviewerInfo.available ? 'Available' : 'Not available'}</span>\n                <span className={\`px-2.5 py-1 rounded-full \${userProfile.committeeAvailable ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}\`}>Technical Committee: {userProfile.committeeAvailable ? 'Available' : 'Not available'}</span>\n                <span className={\`px-2.5 py-1 rounded-full \${userProfile.sessionChairAvailable ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}\`}>Session Chair: {userProfile.sessionChairAvailable ? 'Available' : 'Not available'}</span>\n                <span className={\`px-2.5 py-1 rounded-full \${userProfile.speakerAvailable ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}\`}>Speaker / Keynote: {userProfile.speakerAvailable ? 'Available' : 'Not available'}</span>\n              </div>\n            </div>`,
'professional roles heading'
  );

  const currentLoadCard = /\n\s*<div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">\n\s*<div className="text-\[10px\] font-bold text-slate-400 uppercase">Current Load<\/div>[\s\S]*?<\/div>\n\s*<\/div>/;
  if (!currentLoadCard.test(source)) throw new Error('Professional profile simplification target missing: Current Load card');
  source = source.replace(currentLoadCard, '');
  source = source.replace(/(Professional Roles[\s\S]{0,2500}?<div className=")grid grid-cols-2 sm:grid-cols-4 gap-4(")/, '$1grid grid-cols-1 sm:grid-cols-3 gap-4$2');

  replaceRequired(`{activeTab === 'committee' && (`, `{activeTab === 'reviews' && (`, 'committee into Professional Roles');

  replaceRequired(
`            <h3 className="text-base font-bold text-slate-900">Verified Conference Badges</h3>`,
`            <div>\n              <h3 className="text-base font-bold text-slate-900">Credentials & Verification</h3>\n              <p className="text-[11px] text-slate-500 mt-1">Verified badges, identity status, completed roles, and source-labeled evidence.</p>\n            </div>`,
'credentials heading'
  );
  replaceRequired(`{activeTab === 'trust' && (`, `{activeTab === 'badges' && (`, 'trust into Credentials & Verification');
  replaceRequired(
`              <h3 className="text-base font-bold text-slate-900">Trust & Verification</h3>`,
`              <h3 className="text-sm font-bold text-slate-900">Verification Status</h3>`,
'verification heading'
  );

  fs.writeFileSync(file, source);
  console.log('Professional profile simplification patch applied.');
}
