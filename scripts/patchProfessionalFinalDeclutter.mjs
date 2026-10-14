import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src/components/UserProfileView.tsx');
let source = fs.readFileSync(file, 'utf8');

const marker = 'const hasReviewerHistory =';
if (!source.includes(marker)) {
  const completedAnchor = `  const completedProfessionalRoles = professionalInvitations.filter((item) => item.status === 'completed');\n`;
  if (!source.includes(completedAnchor)) throw new Error('Professional final declutter: completed-role anchor missing');
  source = source.replace(
    completedAnchor,
    `${completedAnchor}  const hasReviewerHistory = Boolean(\n    userProfile.reviewerInfo.totalReviewed > 0 ||\n    userProfile.reviewerInfo.kudos > 0 ||\n    userProfile.contributions.conferencesReviewedFor > 0 ||\n    userProfile.reviewerInfo.badges.length > 0 ||\n    userProfile.reviewerInfo.expertiseKeywords.length > 0\n  );\n`
  );
}

source = source.replace('>Experience / Role</div>', '>Current Role</div>');

const availabilityBlock = `              <div className="flex flex-wrap gap-2 mt-3 text-[10px] font-bold">\n                <span className={\`px-2.5 py-1 rounded-full \${userProfile.reviewerInfo.available ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}\`}>Reviewer: {userProfile.reviewerInfo.available ? 'Available' : 'Not available'}</span>\n                <span className={\`px-2.5 py-1 rounded-full \${userProfile.committeeAvailable ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}\`}>Technical Committee: {userProfile.committeeAvailable ? 'Available' : 'Not available'}</span>\n                <span className={\`px-2.5 py-1 rounded-full \${userProfile.sessionChairAvailable ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}\`}>Session Chair: {userProfile.sessionChairAvailable ? 'Available' : 'Not available'}</span>\n                <span className={\`px-2.5 py-1 rounded-full \${userProfile.speakerAvailable ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}\`}>Speaker / Keynote: {userProfile.speakerAvailable ? 'Available' : 'Not available'}</span>\n              </div>`;
const cleanerAvailability = `              {(userProfile.reviewerInfo.available || userProfile.committeeAvailable || userProfile.sessionChairAvailable || userProfile.speakerAvailable) && (\n                <div className="flex flex-wrap gap-2 mt-3 text-[10px] font-bold">\n                  {userProfile.reviewerInfo.available && <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800">Reviewer</span>}\n                  {userProfile.committeeAvailable && <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800">Technical Committee</span>}\n                  {userProfile.sessionChairAvailable && <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800">Session Chair</span>}\n                  {userProfile.speakerAvailable && <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800">Speaker / Keynote</span>}\n                </div>\n              )}`;
if (source.includes(availabilityBlock)) source = source.replace(availabilityBlock, cleanerAvailability);

// Reviewer metrics are useful only when there is real reviewer history. Do not fill the page with zero-only cards.
const reviewerGridOpen = `            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">\n              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">\n                <div className="text-[10px] font-bold text-slate-400 uppercase">Abstracts Reviewed</div>`;
if (source.includes(reviewerGridOpen) && !source.includes('{hasReviewerHistory && (\n            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">')) {
  source = source.replace(reviewerGridOpen, `{hasReviewerHistory && (\n            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">\n              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">\n                <div className="text-[10px] font-bold text-slate-400 uppercase">Abstracts Reviewed</div>`);
  const reviewerGridClose = `                <div className="text-lg font-extrabold text-indigo-700">{userProfile.contributions.conferencesReviewedFor}</div>\n              </div>\n            </div>\n\n            <div className="space-y-2">\n              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Reviewer Badges Earned</h4>`;
  if (!source.includes(reviewerGridClose)) throw new Error('Professional final declutter: reviewer grid close missing');
  source = source.replace(reviewerGridClose, `                <div className="text-lg font-extrabold text-indigo-700">{userProfile.contributions.conferencesReviewedFor}</div>\n              </div>\n            </div>\n            )}\n\n            {userProfile.reviewerInfo.badges.length > 0 && (\n            <div className="space-y-2">\n              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Reviewer Badges Earned</h4>`);
}

const badgeElse = `              {userProfile.reviewerInfo.badges.length > 0 ? (\n                <div className="flex flex-wrap gap-2">\n                  {userProfile.reviewerInfo.badges.map((b, idx) => (\n                    <span key={idx} className="px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-full text-[11px] font-bold flex items-center gap-1.5">\n                      <Award className="w-3.5 h-3.5" />\n                      {b}\n                    </span>\n                  ))}\n                </div>\n              ) : (\n                <p className="text-xs text-slate-400">No reviewer badges earned yet — volunteer to review abstracts to start earning them.</p>\n              )}\n            </div>`;
const badgeClean = `              <div className="flex flex-wrap gap-2">\n                {userProfile.reviewerInfo.badges.map((b, idx) => (\n                  <span key={idx} className="px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-full text-[11px] font-bold flex items-center gap-1.5">\n                    <Award className="w-3.5 h-3.5" />\n                    {b}\n                  </span>\n                ))}\n              </div>\n            </div>\n            )}`;
if (source.includes(badgeElse)) source = source.replace(badgeElse, badgeClean);

const expertiseBlock = `            <div className="space-y-2">\n              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Review Expertise</h4>\n              {userProfile.reviewerInfo.expertiseKeywords.length > 0 ? (\n                <div className="flex flex-wrap gap-2">\n                  {userProfile.reviewerInfo.expertiseKeywords.map((k, idx) => (\n                    <span key={idx} className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-full text-[11px] font-semibold">\n                      {k}\n                    </span>\n                  ))}\n                </div>\n              ) : (\n                <p className="text-xs text-slate-400">No review expertise keywords set yet.</p>\n              )}\n            </div>`;
const expertiseClean = `            {userProfile.reviewerInfo.expertiseKeywords.length > 0 && (\n              <div className="space-y-2">\n                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Review Expertise</h4>\n                <div className="flex flex-wrap gap-2">\n                  {userProfile.reviewerInfo.expertiseKeywords.map((k, idx) => (\n                    <span key={idx} className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-full text-[11px] font-semibold">{k}</span>\n                  ))}\n                </div>\n              </div>\n            )}`;
if (source.includes(expertiseBlock)) source = source.replace(expertiseBlock, expertiseClean);

function wrapMetric(label, countExpr) {
  const re = new RegExp(`(\\n\\s*)(<div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">\\n\\s*<div className="text-\\[10px\\] font-bold text-slate-400 uppercase">${label.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}<\\/div>[\\s\\S]*?<div className="text-lg[^>]*">\\{${countExpr.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\}<\\/div>\\n\\s*<\\/div>)`);
  if (re.test(source)) source = source.replace(re, `$1{${countExpr} > 0 && ($1$2$1)}`);
}
wrapMetric('Committee Positions', 'committeePositionCount');
wrapMetric('Chair / Co-Chair Roles', 'sessionChairCount');
wrapMetric('Speaker / Presenter Roles', 'speakerPresenterRoleCount');
wrapMetric('Workshops Delivered', 'workshopDeliveredCount');

source = source.replace(
  `              <p className="text-[11px] text-slate-400">\n                Committee or chair service has no public database to pull from either, so this is\n                self-reported by you — not verified by Conference Gate.\n              </p>`,
  `              <p className="text-[11px] text-slate-400">Use this only for a role that ConferenceGate could not verify from a public source.</p>`
);
source = source.replace(
  `<p className="text-xs text-slate-400">No self-reported committee positions yet.</p>`,
  `<></>`
);
source = source.replace(
  `              Plain attendance isn't in any public database anywhere, so this is self-reported by you —\n              not verified by Conference Gate.`,
  `              Add attendance manually only when ConferenceGate cannot find reliable public evidence. Self-reported attendance remains clearly labeled.`
);
source = source.replace(
  `              <p className="text-xs text-slate-400">\n                No verified badges yet. Badges are earned automatically for verified conference activity like keynotes,\n                reviews, and committee roles.\n              </p>`,
  `              null`
);

if (!source.includes(marker)) throw new Error('Professional final declutter failed to add reviewer-history guard');
fs.writeFileSync(file, source);
console.log('Professional final declutter applied.');
