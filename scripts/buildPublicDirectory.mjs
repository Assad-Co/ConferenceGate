import fs from 'node:fs';
import path from 'node:path';

const origin = 'https://www.conferencegate.com';
const read = name => JSON.parse(fs.readFileSync(path.join('data', name + '.json'), 'utf8'));
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
const web = value => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; }
  catch { return ''; }
};
const slug = value => String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const today = new Date().toISOString().slice(0,10);
const curated = read('official-calendar-expansion-20261030').map(x => ({
  ...x, id: slug(x.title) + '-' + x.start, source: x.sourceUrls?.[0], category: x.categories?.join(', '),
}));
const indexed = read('conferencegate-search-index').entries.filter(x => x.sourceType === 'official_site').map(x => ({
  ...x, url:x.sourceUrl, source:x.sourceUrl, start:x.startDate, end:x.endDate, organizer:x.organization,
}));
const seen = new Set();
const events = [...curated,...indexed].filter(x => {
  const key = slug(x.title) + '|' + x.start;
  if (!key || !x.id || seen.has(key) || !date(x.start) || (date(x.end) || x.start) < today || !web(x.url) || !web(x.source)) return false;
  seen.add(key); return true;
}).sort((a,b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
if (!events.length) throw new Error('No upcoming source-backed events for public directory');
const target = path.join('dist','conferences');
fs.mkdirSync(target,{recursive:true});
const eventPath = x => '/conferences/' + slug(x.id) + '.html';
if (new Set(events.map(eventPath)).size !== events.length) throw new Error('Duplicate public event URL');
const page = (title, description, route, body) => `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | ConferenceGate</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="${origin}${route}">
<link rel="stylesheet" href="/conferencegate-public.css">
<style>main{max-width:76rem;margin:auto;padding:2rem 1rem} .listing{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,19rem),1fr));gap:1rem}.listing li{border:1px solid #c9d8e8;border-radius:1rem;padding:1rem}.listing li[hidden]{display:none}main a{text-decoration:underline;color:#075bc0}main input{width:min(100%,35rem);padding:.75rem;border:1px solid #627991;border-radius:.5rem;font:inherit}dt{font-weight:700;margin-top:.6rem}dd{margin-left:0}.site-header{flex-wrap:wrap}.site-header nav{display:flex;flex-wrap:wrap}</style>
<body><header class="site-header"><a href="/" class="brand-link"><img src="/conference-gate-logo.png" alt="ConferenceGate"></a><nav aria-label="Main navigation"><a href="/conferences/">Conference directory</a><a href="/about.html">About</a></nav></header>
<main>${body}</main><footer><div class="wrap"><a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a> · <a href="mailto:support@conferencegate.com">Contact</a></div></footer></body></html>`;
const place = x => [x.city,x.country].filter(Boolean).join(', ');
const dates = x => [x.start,date(x.end) !== x.start ? date(x.end) : ''].filter(Boolean).join(' to ');
const submissions = new Map([
  ['imog-2027', { date: '2027-02-14', time: '23:59 CET', source: 'https://imogconference.org/submission-instruction/', checked: '2026-11-06' }],
]);
const submission = x => x.start === '2027-09-12' && /\bIMOG 2027\b/.test(x.title) ? submissions.get('imog-2027') : undefined;
const deadline = x => submission(x)?.date;
const field = (name,value) => `<dt>${esc(name)}</dt><dd>${esc(value)}</dd>`;
for (const x of events) {
  const route = eventPath(x);
  const checked = date(x.verifiedAt?.slice(0,10));
  fs.writeFileSync(path.join('dist',route.slice(1)),page(x.title,`Conference dates, location and organizer source for ${x.title}.`,route,`
<p><a href="/conferences/">← All conferences</a></p><h1>${esc(x.title)}</h1>
<dl>${field('Dates',dates(x))}${field('Location',place(x) || 'Not listed')}${field('Field',x.category || 'Not listed')}
${x.organizer ? field('Organizer',x.organizer) : ''}${field('Abstract deadline',submission(x) ? deadline(x) + ' at ' + submission(x).time : 'No deadline recorded; check the official source.')}
${submission(x) ? `<dt>Deadline source</dt><dd><a href="${esc(submission(x).source)}">Official submission instructions</a> (checked ${esc(submission(x).checked)})</dd>` : ''}
${field('Source last checked',checked || 'Not recorded in this catalogue')}</dl>
<p>${esc(x.description || '')}</p><p><a href="${esc(web(x.url))}">Visit official event website</a></p>
${web(x.source)!==web(x.url) ? `<p><a href="${esc(web(x.source))}">View official calendar source</a></p>` : ''}
<p>Confirm dates and submission details with the organizer before making plans.</p>`));
}
fs.writeFileSync(path.join(target,'index.html'),page('Upcoming conferences','Browse upcoming conferences by topic, location and event name.','/conferences/',`
<h1>Upcoming conferences</h1><p>Browse upcoming conferences with organizer or society sources. No account required. Listings reflect the catalogue as of ${today}.</p>
<label for="conference-search">Search by event, field or location</label><br><input type="search" id="conference-search" placeholder="e.g. IMOG or geoscience" autocomplete="off">
<p id="conference-count" role="status">${events.length} upcoming conferences</p>
<ul class="listing">${events.map(x => `<li><h2><a href="${eventPath(x)}">${esc(x.title)}</a></h2><p>${esc([dates(x),place(x),x.category].filter(Boolean).join(' · '))}</p>${deadline(x) ? `<p>Submission deadline: ${esc(deadline(x))}</p>` : ''}</li>`).join('')}</ul>
<script src="/conferences/filter.js" defer></script>`));
fs.writeFileSync(path.join(target,'filter.js'),`const box=document.querySelector('#conference-search'),rows=[...document.querySelectorAll('.listing li')],status=document.querySelector('#conference-count');box.addEventListener('input',()=>{const terms=box.value.toLowerCase().trim().split(/\\s+/);let count=0;for(const row of rows){row.hidden=!terms.every(term=>row.textContent.toLowerCase().includes(term));if(!row.hidden)count++;}status.textContent=count===1?'1 matching conference':count+' matching conferences';});`);
const sitemap = ['/', '/about.html','/faq.html','/privacy.html','/terms.html','/pricing.html','/refunds.html','/verify.html','/conferences/',...events.map(eventPath)];
fs.writeFileSync('dist/sitemap.xml',`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap.map(route=>`  <url><loc>${origin}${route}</loc></url>`).join('\n')}\n</urlset>\n`);
const robots = fs.readFileSync('dist/robots.txt','utf8');
fs.writeFileSync('dist/robots.txt',robots.replace(/Sitemap: .*$/m,`Sitemap: ${origin}/sitemap.xml`));
const home = fs.readFileSync('dist/about.html','utf8');
const linked = home.replace(/<nav\b[^>]*>/,match=>match+'<a href="/conferences/">Browse conferences</a>');
if (linked === home) throw new Error('Homepage navigation not found');
fs.writeFileSync('dist/about.html',linked);
console.log(`Published ${events.length} public conference pages.`);

