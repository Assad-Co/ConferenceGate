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
const world = JSON.parse(fs.readFileSync('src/intelligence/world.json','utf8'));
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
<link rel="stylesheet" href="/conferencegate-public.css"><link rel="stylesheet" href="/conferencegate-atlas.css">
<style>main{max-width:76rem;margin:auto;padding:2rem 1rem} .listing{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,19rem),1fr));gap:1rem}.listing li{border:1px solid #c9d8e8;border-radius:1rem;padding:1rem}.listing li[hidden]{display:none}main a{text-decoration:underline;color:#075bc0}main input{width:min(100%,35rem);padding:.75rem;border:1px solid #627991;border-radius:.5rem;font:inherit}dt{font-weight:700;margin-top:.6rem}dd{margin-left:0}.site-header{flex-wrap:wrap}.site-header nav{display:flex;flex-wrap:wrap}</style>
<body><header class="site-header"><a href="/" class="brand-link"><img src="/conference-gate-logo.png" alt="ConferenceGate"></a><nav aria-label="Main navigation"><a href="/conferences/">Conference directory</a><a href="/about/">About</a><a class="cg-nav-join" href="/?auth=choose&amp;discover=1">Sign in</a></nav></header>
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
const aliases = new Map([['usa','united-states-of-america'],['us','united-states-of-america'],['united-states','united-states-of-america'],['uk','united-kingdom'],['uae','united-arab-emirates'],['czechia','czech-republic'],['turkiye','turkey'],['republic-of-korea','south-korea']]);
const lookup = new Map(world.flatMap(c => [c.name,...c.aliases].map(name=>[slug(name),slug(c.name)])));
const countryKey = label => lookup.get(aliases.get(slug(label)) || slug(label)) || aliases.get(slug(label)) || slug(label);
const countries = new Map();
const groups = x => [...new Set(String(x.country || '').split(/\s*\/\s*/).map(c=>c.trim()).filter(Boolean).map(label=>{
  const key=countryKey(label);
  countries.set(key, countries.get(key)||label);
  return key;
}))];
const keys = new Map(upcoming.map(x=>[x,groups(x)]));
const counts = new Map();
for (const group of keys.values()) for (const country of group) counts.set(country,(counts.get(country)||0)+1);
const fields = [...new Set(upcoming.flatMap(x=>String(x.category||'').split(', ').filter(Boolean)))].sort();
const options = [...countries].sort((a,b)=>a[1].localeCompare(b[1])).map(([key,label])=>`<option value="${esc(key)}">${esc(label)}</option>`).join('');
const geometry = world.map(c=>{
  const key=slug(c.name), count=counts.get(key)||0;
  return `<g data-map-country="${esc(key)}" class="${count?'has-events':''}" ${count?`role="button" tabindex="0" aria-pressed="false" aria-label="${esc(countries.get(key))}: ${count} conferences"`:''}><title>${esc(countries.get(key)||c.name)} · ${count} conferences</title>${c.paths.map(d=>`<path d="${esc(d)}"/>`).join('')}</g>`;
}).join('');
files.set('/conferences/',page('Find your next conference','Explore upcoming conferences on the world map, search by topic, or filter by country.','/conferences/',`
<section class="cg-hero">
  <span class="cg-kicker">CONFERENCEGATE DISCOVER</span><h1>Find your next conference.</h1>
  <p>Explore events around the world, find where your research fits, and see what’s coming up.</p>
  <div class="cg-stats"><span><strong>${upcoming.length}</strong> upcoming events</span><span><strong>${countries.size}</strong> countries &amp; territories</span><span>Organizer and society sources</span></div>
</section>
<section class="cg-workspace" aria-label="Conference search and filters">
  <div class="cg-filters">
    <label>Search conferences<input type="search" id="conference-search" placeholder="Event, topic, city or acronym" autocomplete="off"></label>
    <label>Country<select id="cg-country"><option value="">All countries</option>${options}</select></label>
    <label>Discipline<select id="cg-field"><option value="">All disciplines</option>${fields.map(x=>`<option>${esc(x)}</option>`).join('')}</select></label>
    <label>Abstract deadline<select id="cg-deadline"><option value="">Any status</option><option value="upcoming">Upcoming dates</option></select></label>
    <button type="button" id="cg-clear" class="cg-secondary">Clear</button>
  </div>
  <div class="cg-map-grid">
    <div class="cg-map"><div class="cg-map-head"><div><span class="cg-kicker">WORLDWIDE COVERAGE</span><h2>Explore the world map</h2></div><span class="cg-legend">● Countries with events</span></div>
      <svg viewBox="0 0 360 180" role="group" aria-label="World conference map. Select a highlighted country or use the Country filter.">${geometry}</svg>
      <p class="cg-map-note">Select a highlighted country to see its events. Country coverage, not venue locations. Map: <a href="https://www.naturalearthdata.com/about/terms-of-use/">Natural Earth</a>.</p>
    </div>
    <aside class="cg-map-results" aria-label="Events on the map"><span class="cg-kicker">CONFERENCES ON THE MAP</span><h2 id="cg-map-title">Worldwide</h2><p id="cg-map-count">Select a country to explore its upcoming events.</p><ul id="cg-map-events"></ul><a class="cg-secondary" href="#cg-results">View results ↓</a></aside>
  </div>
</section>
<section id="cg-results" class="cg-results"><div class="cg-results-head"><div><span class="cg-kicker">CONFERENCE DIRECTORY</span><h2>Upcoming conferences</h2></div><p id="conference-count" role="status">${upcoming.length} upcoming conferences</p></div>
<p class="cg-muted">Updated ${today}. Select an event to sign in and continue in ConferenceGate.</p>
<ul class="listing">${upcoming.map(x=>`<li data-title="${esc(x.title)}" data-search="${esc([x.acronym,x.organizer,x.category,x.city,x.country,x.description].filter(Boolean).join(' '))}" data-country="${esc(keys.get(x).join(' '))}" data-field="${esc(x.category || '')}" data-deadline="${deadline(x)>=today?'upcoming':''}"><span class="cg-card-date">${esc(dates(x))}</span><h3><a href="${signIn(x)}">${esc(x.title)}</a></h3><p>${esc([place(x),x.category].filter(Boolean).join(' · '))}</p>${deadline(x) ? `<p class="cg-card-deadline">Abstract deadline: ${esc(deadline(x))}</p>` : ''}</li>`).join('')}</ul>
<button type="button" class="cg-secondary" id="cg-more" hidden>Show more conferences</button></section>
<script src="/conferences/filter.js" defer></script>`));
files.set('/conferences/filter.js', '(' + directoryFilter.toString() + ')();');
const sitemap = ['/', '/about/','/faq.html','/privacy.html','/terms.html','/pricing.html','/refunds.html','/verify.html','/conferences/',...upcoming.map(eventPath)];
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
  const country = document.querySelector('#cg-country');
  const field = document.querySelector('#cg-field');
  const deadline = document.querySelector('#cg-deadline');
  const more = document.querySelector('#cg-more');
  const pins = [...document.querySelectorAll('[data-map-country]')];
  const mapTitle = document.querySelector('#cg-map-title');
  const mapCount = document.querySelector('#cg-map-count');
  const mapEvents = document.querySelector('#cg-map-events');
  let limit = 12;
  function update() {
    const query = normalize(box.value.slice(0,180));
    const words = query.split(' ').filter(x=>x&&!['the','in','near','for','and'].includes(x));
    const ranked = rows.map(r => {
      if ((country.value&&!r.row.dataset.country.split(' ').includes(country.value)) ||
          (field.value&&!r.row.dataset.field.split(', ').includes(field.value)) ||
          (deadline.value&&r.row.dataset.deadline!==deadline.value)) return {...r,score:0};
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
    const matches=ranked.filter(r=>r.score);
    let shown=0;
    for(const r of ranked){r.row.hidden=!r.score||shown>=limit;if(r.score)shown++;list.append(r.row);}
    const count=matches.length;
    status.textContent=count===1?'1 matching conference':count+' matching conferences';
    more.hidden=count<=limit;
    mapTitle.textContent=country.value ? country.selectedOptions[0].textContent : 'Worldwide';
    mapCount.textContent=country.value ? status.textContent : 'Choose a highlighted country or use the filters.';
    mapEvents.replaceChildren(...matches.slice(0,4).map(r=>{
      const item=document.createElement('li');
      const link=r.row.querySelector('h3 a').cloneNode(true);
      item.append(link,r.row.querySelector('.cg-card-date').cloneNode(true));
      return item;
    }));
    const counts=new Map();
    for(const r of matches) for(const key of r.row.dataset.country.split(' ')) if(key) counts.set(key,(counts.get(key)||0)+1);
    for(const pin of pins) {
      const key=pin.dataset.mapCountry;
      const active=country.value===key;
      pin.classList.toggle('selected',active);
      pin.classList.toggle('dimmed',!counts.get(key)&&!active);
      if(pin.hasAttribute('aria-pressed'))pin.setAttribute('aria-pressed',String(active));
    }
  }
  const change=()=>{limit=12;update();};
  box.addEventListener('input',change);
  for(const select of [country,field,deadline])select.addEventListener('change',change);
  more.addEventListener('click',()=>{limit+=12;update();});
  document.querySelector('#cg-clear').addEventListener('click',()=>{
    box.value=country.value=field.value=deadline.value='';change();box.focus();
  });
  for(const pin of pins.filter(p=>p.hasAttribute('role'))) {
    const select=()=>{country.value=country.value===pin.dataset.mapCountry?'':pin.dataset.mapCountry;change();};
    pin.addEventListener('click',select);
    pin.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}});
  }
  update();
}
