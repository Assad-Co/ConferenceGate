import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36 ConferenceGate/1.0';
const MAX_EVENTS = Math.max(0, Number(process.env.SPONSOR_ENRICH_MAX_EVENTS || 0)); // 0 = all
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.SPONSOR_ENRICH_CONCURRENCY || 4)));
const REFRESH_DAYS = Math.max(1, Number(process.env.SPONSOR_ENRICH_REFRESH_DAYS || 7));
const TIMEOUT_MS = Math.max(4000, Number(process.env.SPONSOR_ENRICH_TIMEOUT_MS || 10000));
const MAX_LINKS = Math.max(2, Math.min(12, Number(process.env.SPONSOR_ENRICH_MAX_LINKS || 8)));

const SPONSOR_LINK_RE = /\b(sponsors?|sponsorship|exhibitors?|exhibit(?:ing|ion)?|commercial opportunities|advertis(?:e|ing)|partners?|book a stand|reserve a booth|prospectus)\b/i;
const ACTION_LINK_RE = /\b(sponsor(?:ship)? enquiry|sponsor enquiries|exhibitor enquiry|exhibitor enquiries|become a sponsor|sponsor now|book a stand|reserve a booth|contact sales|request (?:a )?(?:brochure|prospectus)|enquire|inquire|register(?: to)? sponsor|sponsor registration|exhibit with us|apply to exhibit|exhibitor registration|sponsorship form)\b/i;
const BAD_LINK_RE = /\b(privacy|terms|cookie|login|sign in|news|press|media|speaker|call for papers|abstract|agenda|programme|program|venue|hotel|travel|visitor registration)\b/i;
const PRICE_RE = /(?:(USD|EUR|GBP|BHD|SAR|AED|QAR|KWD|OMR|CAD|AUD|SGD|CHF|JPY|CNY)\s*)?([$€£]|BD\s*)?\s*([0-9]{1,3}(?:[,\s][0-9]{3})+(?:\.\d{1,2})?|[0-9]{3,7}(?:\.\d{1,2})?)\s*(USD|EUR|GBP|BHD|SAR|AED|QAR|KWD|OMR|CAD|AUD|SGD|CHF|JPY|CNY)?/gi;

function safeJson(value, fallback) {
  try { return value ? JSON.parse(String(value)) : fallback; } catch { return fallback; }
}
function absoluteUrl(value, base) {
  try {
    const u = new URL(String(value || '').trim(), base);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch { return null; }
}
function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}
function decodeEntities(value='') {
  return String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—')
    .replace(/&pound;/gi, '£')
    .replace(/&euro;/gi, '€');
}
function stripTags(value='') {
  return decodeEntities(String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(?:br|\/p|\/div|\/li|\/section|\/article|\/h[1-6]|hr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function textLines(html='') {
  return stripTags(html).split(/\n+/).map((x) => x.replace(/\s+/g, ' ').trim()).filter((x) => x.length >= 2);
}
function extractAnchors(html, base) {
  const out = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const hrefRaw = /href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(m[1])?.slice(1).find(Boolean);
    const href = absoluteUrl(hrefRaw, base);
    if (!href) continue;
    const label = stripTags(m[2]).replace(/\s+/g, ' ').trim();
    out.push({ href, label });
  }
  return out;
}
function extractHeadings(html='') {
  const out = [];
  const re = /<h([2-5])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = re.exec(html))) {
    const text = stripTags(m[2]).replace(/\s+/g, ' ').trim();
    if (text && text.length <= 120) out.push(text);
  }
  return out;
}
function eventYear(event) {
  const y = Number(String(event?.start_date || '').slice(0,4));
  if (Number.isFinite(y) && y >= 2000) return y;
  const hit = /\b(20\d{2})\b/.exec(String(event?.title || ''));
  return hit ? Number(hit[1]) : null;
}
function pageMatchesEdition(html, event) {
  const year = eventYear(event);
  if (!year) return true;
  const body = stripTags(html);
  const counts = new Map();
  for (const m of body.matchAll(/\b(20\d{2})\b/g)) {
    const y = Number(m[1]);
    counts.set(y, (counts.get(y) || 0) + 1);
  }
  if (!counts.size) return true;
  const current = counts.get(year) || 0;
  const other = [...counts.entries()].filter(([y]) => y !== year).sort((a,b)=>b[1]-a[1])[0];
  if (!other) return true;
  if (current === 0 && other[1] >= 2) return false;
  if (other[0] < year && other[1] >= 3 && other[1] > current * 2) return false;
  return true;
}
async function fetchHtml(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const type = String(res.headers.get('content-type') || '').toLowerCase();
    if (!res.ok || (!type.includes('text/html') && !type.includes('application/xhtml'))) {
      return { ok:false, url, finalUrl:res.url || url, status:res.status, html:'' };
    }
    return { ok:true, url, finalUrl:res.url || url, status:res.status, html:await res.text() };
  } catch {
    return { ok:false, url, finalUrl:url, status:null, html:'' };
  }
}
function sponsorLinkScore(a, base) {
  const hay = `${a.label} ${a.href}`.toLowerCase();
  let score = 0;
  if (SPONSOR_LINK_RE.test(hay)) score += 8;
  if (ACTION_LINK_RE.test(hay)) score += 5;
  if (/brochure|prospectus|opportunit|package|stand|booth/i.test(hay)) score += 3;
  if (hostOf(a.href) === hostOf(base)) score += 2;
  if (BAD_LINK_RE.test(hay)) score -= 4;
  if (/facebook|instagram|linkedin|youtube|twitter|x\.com|mailto:/i.test(a.href)) score -= 20;
  return score;
}
function pickSponsorLinks(html, base) {
  const seen = new Set();
  return extractAnchors(html, base)
    .map((a)=>({...a, score:sponsorLinkScore(a, base)}))
    .filter((a)=>a.score >= 8)
    .sort((a,b)=>b.score-a.score)
    .filter((a)=>{
      const key=a.href.replace(/#.*$/,'').replace(/\/$/,'');
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_LINKS);
}
function currencyFromParts(code1, symbol, code2) {
  const code = (code1 || code2 || '').toUpperCase();
  if (code) return code;
  if (symbol === '$') return 'USD';
  if (symbol === '€') return 'EUR';
  if (symbol === '£') return 'GBP';
  if (/^BD/i.test(symbol || '')) return 'BHD';
  return null;
}
function parseAmount(raw) {
  const n = Number(String(raw || '').replace(/[\s,]/g,''));
  return Number.isFinite(n) ? n : null;
}
function cleanPackageName(value='') {
  return String(value)
    .replace(PRICE_RE, ' ')
    .replace(/\b(from|starting at|price|cost|rate|investment|fee)\b\s*[:\-–—]?\s*$/i,'')
    .replace(/[|•·]+/g,' ')
    .replace(/\s+/g,' ')
    .replace(/^[-–—:]+|[-–—:]+$/g,'')
    .trim()
    .slice(0,120);
}
function looksLikePackageName(value='') {
  const s=String(value).trim();
  if (s.length < 3 || s.length > 120) return false;
  if (/^(home|about|contact|sponsors?|sponsorship|exhibitors?|exhibition|partners?|why sponsor|opportunities|packages|pricing|register|enquire|inquire|download|learn more|read more)$/i.test(s)) return false;
  if (/privacy|cookie|terms|newsletter|copyright|follow us/i.test(s)) return false;
  return /sponsor|partner|exhibit|booth|stand|table|dinner|lunch|reception|lanyard|badge|app|digital|conference|workshop|session|network|gala|golf|branding|advertis|package|platinum|gold|silver|bronze|diamond|premium|title|exclusive/i.test(s);
}
function extractPricedPackages(page) {
  const lines = textLines(page.html);
  const out=[];
  for (let i=0;i<lines.length;i++) {
    const line=lines[i];
    PRICE_RE.lastIndex=0;
    const matches=[...line.matchAll(PRICE_RE)];
    if (!matches.length) continue;
    for (const m of matches) {
      const amount=parseAmount(m[3]);
      const hasCurrency=Boolean(m[1] || m[2] || m[4]);
      const hasPriceCue=/\b(price|pricing|rate|cost|investment|fee|from|starting at)\b/i.test(line);
      if (!amount || amount < 100 || (!hasCurrency && !hasPriceCue)) continue;
      // A bare conference year or attendance statistic is not a sponsorship price.
      if (!hasCurrency && amount >= 1900 && amount <= 2100) continue;
      let name=cleanPackageName(line.slice(0,m.index));
      if (!looksLikePackageName(name)) {
        for (let back=1;back<=3;back++) {
          const candidate=cleanPackageName(lines[i-back] || '');
          if (looksLikePackageName(candidate)) { name=candidate; break; }
        }
      }
      if (!looksLikePackageName(name)) continue;
      const currency=currencyFromParts(m[1],m[2],m[4]);
      const priceText=m[0].trim();
      const benefits=[lines[i+1],lines[i+2]].filter(Boolean).filter((x)=>x.length<220 && !PRICE_RE.test(x)).slice(0,2);
      out.push({ name, price_text:priceText, price_amount:amount, currency, benefits, source_url:page.finalUrl });
    }
  }
  const seen=new Set();
  return out.filter((p)=>{
    const key=`${p.name.toLowerCase()}|${p.price_amount}|${p.currency || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0,20);
}
function extractNamedPackages(page) {
  const headings=extractHeadings(page.html);
  const seen=new Set();
  const out=[];
  for (const heading of headings) {
    const name=cleanPackageName(heading);
    if (!looksLikePackageName(name)) continue;
    const key=name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, price_text:null, price_amount:null, currency:null, benefits:[], source_url:page.finalUrl });
  }
  return out.slice(0,16);
}
function chooseActionUrl(pages, fallback) {
  const candidates=[];
  for (const page of pages) {
    for (const a of extractAnchors(page.html, page.finalUrl)) {
      const hay=`${a.label} ${a.href}`;
      let score=0;
      if (ACTION_LINK_RE.test(hay)) score += 12;
      if (/sponsor|exhibit|stand|booth|sales|enquir|inquir/i.test(hay)) score += 5;
      if (/register/i.test(hay) && /sponsor|exhibit/i.test(hay)) score += 4;
      if (hostOf(a.href) === hostOf(page.finalUrl)) score += 2;
      if (BAD_LINK_RE.test(hay)) score -= 3;
      candidates.push({...a,score});
    }
  }
  candidates.sort((a,b)=>b.score-a.score);
  return candidates.find((a)=>a.score>=10)?.href || fallback;
}
function recentEnough(meta) {
  const stamp=meta?.external_sponsorship?.checked_at;
  if (!stamp) return false;
  const age=Date.now()-Date.parse(stamp);
  return Number.isFinite(age) && age < REFRESH_DAYS*86400000;
}

async function enrichOne(db,event) {
  const official=String(event.official_url || event.canonical_url || '').trim();
  if (!official) return {status:'no-url'};
  const existingRows=await db.execute({sql:'SELECT source_url,extraction_metadata FROM extracted_conferences WHERE source_url IN (?,?) LIMIT 1',args:[official,String(event.canonical_url || official)]});
  const existing=existingRows.rows?.[0] || null;
  const oldMeta=safeJson(existing?.extraction_metadata,{});
  if (recentEnough(oldMeta)) return {status:'fresh'};

  const main=await fetchHtml(official);
  if (!main.ok || !pageMatchesEdition(main.html,event)) {
    const meta={...oldMeta,external_sponsorship:{status:'unread',checked_at:new Date().toISOString(),source_urls:[official],action_url:null,packages:[]}};
    if (existing) await db.execute({sql:"UPDATE extracted_conferences SET extraction_metadata=?,updated_at=datetime('now') WHERE source_url=?",args:[JSON.stringify(meta),existing.source_url]});
    return {status:'unread'};
  }

  const candidateLinks=pickSponsorLinks(main.html,main.finalUrl);
  const known=(Array.isArray(oldMeta?.deep_page_urls)?oldMeta.deep_page_urls:[])
    .filter((u)=>typeof u==='string' && SPONSOR_LINK_RE.test(u))
    .map((href)=>({href,label:'known sponsor/exhibitor page',score:9}));
  const merged=[...candidateLinks,...known];
  const seen=new Set();
  const links=merged.filter((x)=>{
    const k=x.href.replace(/#.*$/,'').replace(/\/$/,'');
    if(seen.has(k)) return false; seen.add(k); return true;
  }).slice(0,MAX_LINKS);

  const sponsorPages=[];
  for (const link of links) {
    const page=await fetchHtml(link.href);
    if (page.ok && pageMatchesEdition(page.html,event)) sponsorPages.push(page);
  }

  const homeSponsorSignal=SPONSOR_LINK_RE.test(stripTags(main.html)) || candidateLinks.length>0;
  if (!sponsorPages.length && homeSponsorSignal) sponsorPages.push(main);
  if (!sponsorPages.length) {
    const meta={...oldMeta,external_sponsorship:{status:'not_found',checked_at:new Date().toISOString(),source_urls:[main.finalUrl],action_url:null,packages:[]}};
    const key=existing?.source_url || official;
    if(existing) await db.execute({sql:"UPDATE extracted_conferences SET extraction_metadata=?,updated_at=datetime('now') WHERE source_url=?",args:[JSON.stringify(meta),key]});
    return {status:'not-found'};
  }

  let packages=sponsorPages.flatMap(extractPricedPackages);
  if (!packages.length) packages=sponsorPages.flatMap(extractNamedPackages);
  const dedup=new Map();
  for(const p of packages){
    const key=p.name.toLowerCase();
    if(!dedup.has(key) || (p.price_amount && !dedup.get(key)?.price_amount)) dedup.set(key,p);
  }
  packages=[...dedup.values()].slice(0,24);

  const sponsorUrl=sponsorPages[0]?.finalUrl || main.finalUrl;
  const actionUrl=chooseActionUrl([main,...sponsorPages],sponsorUrl);
  const sourceUrls=[...new Set([main.finalUrl,...sponsorPages.map((p)=>p.finalUrl),actionUrl].filter(Boolean))];
  const priced=packages.some((p)=>Number.isFinite(p.price_amount));
  if (!packages.length) {
    packages=[{name:'Sponsorship / Exhibition Opportunities',price_text:null,price_amount:null,currency:null,benefits:[],source_url:sponsorUrl}];
  }

  const external={
    status:'available',
    checked_at:new Date().toISOString(),
    sponsor_url:sponsorUrl,
    action_url:actionUrl,
    action_label:priced?'View Sponsorship':'Inquire Now',
    has_published_pricing:priced,
    source_urls:sourceUrls,
    packages,
  };
  const meta={...oldMeta,external_sponsorship:external};
  const key=existing?.source_url || official;
  if(existing){
    await db.execute({sql:"UPDATE extracted_conferences SET extraction_metadata=?,updated_at=datetime('now') WHERE source_url=?",args:[JSON.stringify(meta),key]});
  } else {
    await db.execute({sql:"INSERT INTO extracted_conferences(source_url,overview,call_for_papers,program_agenda,keynote_speakers,technical_committee,sponsors_exhibitors,venue_accommodation,fees_pricing,community,extraction_metadata,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,datetime('now'))",args:[official,'{}','{}','{}','[]','[]','[]','{}','{}','{}',JSON.stringify(meta)]});
  }
  return {status:'available',priced,packages:packages.length};
}

async function main(){
  const localPath=path.join(process.cwd(),'data','app.db');
  fs.mkdirSync(path.dirname(localPath),{recursive:true});
  const db=process.env.TURSO_DATABASE_URL?.trim()
    ? createClient({url:process.env.TURSO_DATABASE_URL.trim(),authToken:process.env.TURSO_AUTH_TOKEN?.trim()||undefined})
    : createClient({url:'file:'+localPath});
  try{
    const tables=await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('discovery_events','extracted_conferences')");
    if((tables.rows||[]).length<2){console.log('[sponsor-enrich] schema unavailable; skipping');return;}
    const rows=await db.execute(`SELECT id,title,start_date,start_year,official_url,canonical_url
      FROM discovery_events
      WHERE status='published'
        AND COALESCE(official_url,canonical_url) IS NOT NULL
        AND ((start_date IS NOT NULL AND date(start_date)>=date('now')) OR (start_date IS NULL AND start_year>=CAST(strftime('%Y','now') AS INTEGER)))
      ORDER BY CASE WHEN start_date IS NULL THEN 1 ELSE 0 END,start_date ASC,title ASC`);
    let events=rows.rows||[];
    if(MAX_EVENTS>0) events=events.slice(0,MAX_EVENTS);
    console.log(`[sponsor-enrich] scanning ${events.length} upcoming conferences concurrency=${CONCURRENCY}`);
    let cursor=0,available=0,priced=0,fresh=0,unread=0,notFound=0;
    async function worker(){
      for(;;){
        const i=cursor++;
        if(i>=events.length) return;
        const event=events[i];
        const result=await enrichOne(db,event).catch(()=>({status:'unread'}));
        if(result.status==='available'){available++; if(result.priced) priced++;}
        else if(result.status==='fresh') fresh++;
        else if(result.status==='not-found') notFound++;
        else unread++;
      }
    }
    await Promise.all(Array.from({length:CONCURRENCY},()=>worker()));
    console.log(`[sponsor-enrich] complete available=${available} priced=${priced} fresh=${fresh} not_found=${notFound} unread=${unread}`);
  }finally{try{db.close();}catch{}}
}
await main();
