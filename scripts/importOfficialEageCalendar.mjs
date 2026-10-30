// Offline, reviewable import of an official calendar snapshot. Never starts a customer crawl.
import fs from 'node:fs';
const [input, output, checkedOn] = process.argv.slice(2);
if (!input || !output || !/^\d{4}-\d{2}-\d{2}$/.test(checkedOn || '')) throw Error('Usage: node scripts/importOfficialEageCalendar.mjs snapshot.html manifest.json YYYY-MM-DD');
const clean = text => text.replace(/<span[^>]*display\s*:\s*none[^>]*>[\s\S]*?<\/span>/gi,'').replace(/<[^>]+>/g,' ').replace(/&ndash;|&mdash;/g,'–').replace(/&amp;/g,'&').replace(/&#0*39;|&rsquo;/g,"'").replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const iso = (year, month, day) => `${year}-${String(months.indexOf(month)+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
const records=[];
for (const match of fs.readFileSync(input,'utf8').matchAll(/<tr\b[^>]*data-row_id[^>]*>([\s\S]*?)<\/tr>/gi)) {
  const cells=[...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>m[1]);
  const c=cells.map(clean);
  if (c.length<12 || !/conference|congress|symposium|forum|workshop|meeting/i.test(c[0])) continue;
  const url=cells[4].match(/href="(https?:[^"\s]+)"/i)?.[1];
  if (!url || /linkedin\.com/i.test(url) || !c[10] || !c[5]) continue;
  // Refuse date shapes we cannot parse unambiguously; never fill in a guessed day.
  const d=c[3].match(/^(\d{1,2})(?:\s*[–-]\s*(\d{1,2}))?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(20\d{2})$/);
  if (!d) continue;
  const start=iso(d[4],d[3],d[1]), end=iso(d[4],d[3],d[2]||d[1]);
  if (end<checkedOn || start>end) continue;
  const title=c[4];
  const categories=['Geoscience'];
  if (/organic geochem/i.test(title)) categories.push('Organic Geochemistry');
  if (/geotherm|energy|wind|co2|hydrogen/i.test(title)) categories.push('Energy');
  if (/ai\/ml|machine learning|data science/i.test(title)) categories.push('Artificial Intelligence');
  records.push({title,url,start,end,city:c[5].split(',')[0].trim(),country:c[10],worldRegion:c[11],categories,
    organizer:c[6]==='EAGE'?'European Association of Geoscientists and Engineers':null,
    description:`${c[0]} listed in the EAGE official calendar: ${title}. ${c[3]}; ${c[5]}.`,
    sourceUrls:['https://eage.org/events/calendar-of-events/'],verifiedAt:`${checkedOn}T00:00:00.000Z`,
    verificationScope:'Official society calendar confirms identity, dates, place and event link. No speaker, fee or deadline inferred.'});
}
if (!records.some(r=>r.url==='https://imogconference.org/')) throw Error('Snapshot missing IMOG; review before importing');
fs.writeFileSync(output,JSON.stringify(records,null,2)+'\n');
console.log(JSON.stringify({accepted:records.length,countries:new Set(records.map(r=>r.country)).size}));
