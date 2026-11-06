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
export function renderPublicDirectory(rows = [], today = new Date().toISOString().slice(0,10)) {
const files = new Map();
const curated = read('official-calendar-expansion-20261030').map(x => ({
  ...x, id: slug(x.title) + '-' + x.start, source: x.sourceUrls?.[0], category: x.categories?.join(', '),
}));
const indexed = read('conferencegate-search-index').entries.filter(x => x.sourceType === 'official_site').map(x => ({
  ...x, url:x.sourceUrl, source:x.sourceUrl, start:x.startDate, end:x.endDate, organizer:x.organization,
}));
const extra = [
  { id:'egu-general-assembly-2027', title:'EGU General Assembly 2027', start:'2027-04-04', end:'2027-04-09', city:'Vienna', country:'Austria', organizer:'European Geosciences Union', url:'https://www.egu27.eu/', deadline:'2027-01-12', time:'13:00 CET', deadlineSource:'https://www.egu27.eu/' },
  { id:'eage-geotech-2027', title:'EAGE Geoscience Technologies and Applications Conference (GeoTech 2027)', start:'2027-04-19', end:'2027-04-21', city:'Amsterdam', country:'Netherlands', organizer:'EAGE', url:'https://eage.eventsair.com/geotech-2027/', deadline:'2026-12-31', time:'23:59 CET', deadlineSource:'https://eage.eventsair.com/geotech-2027/abstract-submission-and-instructions' },
  { id:'eage-annual-2027', title:'88th EAGE Annual Conference & Exhibition', start:'2027-05-31', end:'2027-06-03', city:'Amsterdam', country:'Netherlands', organizer:'EAGE', url:'https://eageannual.org/', deadline:'2027-01-15', time:'23:59 CET', deadlineSource:'https://eageannual.org/technical-programme/' },
].map(x => ({...x,source:x.url,category:'Geoscience',verifiedAt:'2026-11-06',deadlineChecked:'2026-11-06'}));
const live = rows.map(x => ({
  id:'listing-'+x.id,title:x.title,start:x.start_date,end:x.end_date,url:x.official_url,source:x.official_url,
  description:x.description,organizer:x.organizer,city:x.city,country:x.country,category:x.primary_category,
  verifiedAt:x.last_verified,deadline:x.deadline_value,deadlineSource:x.deadline_source,deadlineChecked:x.deadline_checked,
}));
const liveByEdition = new Map(live.map(x => [slug(x.title)+'|'+x.start,x]));
const seen = new Set();
const events = [...curated,...extra,...indexed,...live].filter(x => {
  const key = slug(x.title) + '|' + x.start;
  if (!key || !x.id || seen.has(key) || !date(x.start) || !web(x.url) || !web(x.source)) return false;
  seen.add(key); return true;
}).sort((a,b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
for (const x of events) {
  const fresh = liveByEdition.get(slug(x.title)+'|'+x.start);
  if (fresh && !x.deadline && date(fresh.deadline) && web(fresh.deadlineSource)) {
    Object.assign(x, {deadline:fresh.deadline,deadlineSource:fresh.deadlineSource,deadlineChecked:fresh.deadlineChecked});
  }
}
const upcoming = events.filter(x => (date(x.end) || x.start) >= today);
const signIn = x => '/?auth=choose&amp;q=' + encodeURIComponent(x.title);
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
const submission = x => date(x.deadline) && web(x.deadlineSource) ? {date:x.deadline,time:x.time,source:x.deadlineSource,checked:x.deadlineChecked?.slice(0,10)} : x.start === '2027-09-12' && /\bIMOG 2027\b/.test(x.title) ? submissions.get('imog-2027') : undefined;
const deadline = x => submission(x)?.date;
const field = (name,value) => `<dt>${esc(name)}</dt><dd>${esc(value)}</dd>`;
for (const x of events) {
  const route = eventPath(x);
  const checked = date(x.verifiedAt?.slice(0,10));
  files.set(route,page(x.title,`Conference dates, location and organizer source for ${x.title}.`,route,`
<p><a href="/conferences/">← All conferences</a></p><h1>${esc(x.title)}</h1>
<dl>${field('Dates',dates(x))}${field('Location',place(x) || 'Not listed')}${field('Field',x.category || 'Not listed')}
${x.organizer ? field('Organizer',x.organizer) : ''}${field('Abstract deadline',submission(x) ? deadline(x) + (submission(x).time ? ' at ' + submission(x).time : '') : 'No deadline recorded; check the official source.')}
${submission(x) ? `<dt>Deadline source</dt><dd><a href="${esc(submission(x).source)}">Official submission instructions</a> ${submission(x).checked ? '(checked '+esc(submission(x).checked)+')' : ''}</dd>` : ''}
${field('Source last checked',checked || 'Not recorded in this catalogue')}</dl>
<p>${esc(x.description || '')}</p><p><a href="${esc(web(x.url))}">Visit official event website</a></p>
${web(x.source)!==web(x.url) ? `<p><a href="${esc(web(x.source))}">View official calendar source</a></p>` : ''}
<p>Confirm dates and submission details with the organizer before making plans.</p>`));
}
files.set('/conferences/',page('Upcoming conferences','Browse upcoming conferences by topic, location and event name.','/conferences/',`
<h1>Upcoming conferences</h1><p>Browse upcoming conferences with organizer or society sources. Search without an account. Select an event to sign in and continue in ConferenceGate. Listings reflect the catalogue as of ${today}.</p>
<h2>Upcoming abstract deadlines</h2>
${upcoming.some(x=>deadline(x)>=today) ? '<ul>'+upcoming.filter(x=>deadline(x)>=today).sort((a,b)=>deadline(a).localeCompare(deadline(b))).slice(0,20).map(x=>`<li><a href="${signIn(x)}">${esc(x.title)}</a> — ${esc(deadline(x))}</li>`).join('')+'</ul>' : '<p>No upcoming deadlines recorded yet.</p>'}
<label for="conference-search">Search by event, field or location</label><br><input type="search" id="conference-search" placeholder="e.g. IMOG or geoscience" autocomplete="off">
<p id="conference-count" role="status">${upcoming.length} upcoming conferences</p>
<ul class="listing">${upcoming.map(x => `<li data-title="${esc(x.title)}" data-search="${esc([x.acronym,x.organizer,x.category,x.city,x.country,x.description].filter(Boolean).join(' '))}"><h2><a href="${signIn(x)}">${esc(x.title)}</a></h2><p>${esc([dates(x),place(x),x.category].filter(Boolean).join(' · '))}</p>${deadline(x) ? `<p>Submission deadline: ${esc(deadline(x))}</p>` : ''}</li>`).join('')}</ul>
<script src="/conferences/filter.js" defer></script>`));
files.set('/conferences/filter.js', '(' + directoryFilter.toString() + ')();');
const sitemap = ['/', '/about.html','/faq.html','/privacy.html','/terms.html','/pricing.html','/refunds.html','/verify.html','/conferences/',...upcoming.map(eventPath)];
files.set('/sitemap.xml',`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap.map(route=>`  <url><loc>${origin}${route}</loc></url>`).join('\n')}\n</urlset>\n`);
return {files, count:upcoming.length};
}

function directoryFilter() {
  const box = document.querySelector('#conference-search');
  const list = document.querySelector('.listing');
  const status = document.querySelector('#conference-count');
  const normalize = value => value.toLowerCase().normalize('NFKD').replace(/\p{M}/gu,'').replace(/[^a-z0-9]+/g,' ').trim();
  const rows = [...list.children].map((row,index) => {
    const title = normalize(row.dataset.title || '');
    return {row,index,title,words:normalize(title+' '+row.dataset.search+' '+row.textContent).split(' '),acronym:title.split(' ').filter(x=>x.length>2&&!['the','and','for','with'].includes(x)).map(x=>x[0]).join('')};
  });
  const close = (a,b) => {
    if (Math.abs(a.length-b.length)>1) return false;
    if (a.length>b.length) [a,b]=[b,a];
    let i=0,j=0,edits=0;
    while(i<a.length&&j<b.length) {
      if(a[i]===b[j]){i++;j++;continue;}
      if(++edits>1)return false;
      if(a.length===b.length&&a[i]===b[j+1]&&a[i+1]===b[j]){i+=2;j+=2;continue;}
      if(a.length===b.length)i++;
      j++;
    }
    return edits+(b.length-j)<=1;
  };
  box.addEventListener('input', () => {
    const query = normalize(box.value.slice(0,180));
    const words = query.split(' ').filter(x=>x&&!['the','in','near','for','and'].includes(x));
    const ranked = rows.map(r => {
      if(!query)return {...r,score:1};
      let score = r.title===query ? 100 : r.title.includes(query) ? 35 : r.acronym===query ? 45 : 0;
      for(const term of words) {
        if(r.words.includes(term))score+=10;
        else if(term.length>=3&&r.words.some(w=>w.startsWith(term)))score+=5;
        else if(term.length>=5&&r.words.some(w=>close(term,w)))score+=2;
        else if(r.acronym!==term)return {...r,score:0};
      }
      return {...r,score};
    }).sort((a,b)=>b.score-a.score||a.index-b.index);
    let count=0;
    for(const r of ranked){r.row.hidden=!r.score;if(r.score)count++;list.append(r.row);}
    status.textContent=count===1?'1 matching conference':count+' matching conferences';
  });
}
