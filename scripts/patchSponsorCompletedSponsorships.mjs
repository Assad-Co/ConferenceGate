import fs from 'node:fs';

const file = 'src/components/SponsorPortal.tsx';
let source = fs.readFileSync(file, 'utf8');

const from = `<div className="text-[10px] font-bold text-slate-400 uppercase">Leads Captured</div>\n                <div className="text-lg font-extrabold text-blue-700">{sponsorProfile.leadsCaptured}</div>`;
const to = `<div className="text-[10px] font-bold text-slate-400 uppercase">Completed Sponsorships</div>\n                <div className="text-lg font-extrabold text-blue-700">{sponsorAnalytics.completedDeals}</div>`;

if (!source.includes(to)) {
  if (!source.includes(from)) throw new Error('Sponsor completed sponsorships patch anchor missing');
  source = source.replace(from, to);
  fs.writeFileSync(file, source);
}
