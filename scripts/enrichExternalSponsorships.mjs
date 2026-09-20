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

// The sponsorship catalogue uses exactly the original customer-facing ConferenceGate taxonomy.
// Internal discovery labels may be richer, but they are normalized before anything is stored.
const ORIGINAL_CATEGORIES = [
  'Artificial Intelligence','Data Science','Cybersecurity','Software & Cloud','Telecommunications',
  'Semiconductors & Electronics','Robotics & Automation','Engineering','Civil & Construction',
  'Mechanical Engineering','Electrical Engineering','Chemical Engineering','Materials Science','Energy',
  'Petroleum & Geoscience','Renewable Energy','Hydrogen & CCUS','Mining & Minerals','Environment',
  'Climate & Sustainability','Healthcare','Public Health','Pharmaceuticals & Biotechnology','Nursing',
  'Dentistry','Cardiology','Oncology','Neuroscience','Life Sciences','Chemistry','Physics',
  'Mathematics & Statistics','Science','Education','Business','Finance','Economics','Marketing',
  'Supply Chain & Logistics','Manufacturing','Aviation & Aerospace','Maritime','Automotive & Mobility',
  'Architecture & Urbanism','Agriculture & Food','Law & Regulation','Government & Policy','Social Sciences',
  'Arts & Culture','Tourism & Hospitality','Blockchain & Web3','Real Estate','Virtual conferences',
  'Open call for papers'
];
const ORIGINAL_CATEGORY_SET = new Set(ORIGINAL_CATEGORIES);
const CATEGORY_ALIASES = {
  'Materials':'Materials Science',
  'Health':'Healthcare',
  'Geoscience':'Petroleum & Geoscience',
  'Geology':'Petroleum & Geoscience',
  'Organic Geochemistry':'Petroleum & Geoscience',
  'Automotive':'Automotive & Mobility',
  'Architecture':'Architecture & Urbanism',
  'Politics':'Government & Policy',
  'AI & Machine Learning':'Artificial Intelligence',
  'Data Science & Analytics':'Data Science',
  'Cybersecurity & Privacy':'Cybersecurity',
  'Computer Science & Software':'Software & Cloud',
  'Telecommunications & Networking':'Telecommunications',
  'Manufacturing & Industry':'Manufacturing',
  'Aerospace & Aviation':'Aviation & Aerospace',
  'Petroleum & Energy':'Petroleum & Geoscience',
  'Geosciences & Earth Systems':'Petroleum & Geoscience',
  'Mining & Metallurgy':'Mining & Minerals',
  'Marine & Ocean Sciences':'Maritime',
  'Environment & Sustainability':'Climate & Sustainability',
  'Healthcare & Health IT':'Healthcare',
  'Medicine & Oncology':'Healthcare',
  'Pharmaceutical & Biotechnology':'Pharmaceuticals & Biotechnology',
  'Chemistry & Materials':'Chemistry',
  'Business & Finance':'Business',
  'Blockchain & Fintech':'Blockchain & Web3',
  'Logistics & Transportation':'Supply Chain & Logistics',
  'Architecture & Construction':'Architecture & Urbanism',
  'Education & EdTech':'Education',
  'Law & Policy':'Law & Regulation',
  'Arts & Humanities':'Arts & Culture'
};

function normalizeStoredCategories(event) {
  const raw = [
    ...String(event?.categories || '').split('|'),
    ...safeJson(event?.topics, []),
    event?.primary_category,
  ].filter(Boolean).map((x)=>String(x).trim());

  const out=[];
  const add=(value)=>{ if(value && ORIGINAL_CATEGORY_SET.has(value) && !out.includes(value)) out.push(value); };
  for(const value of raw){
    if(ORIGINAL_CATEGORY_SET.has(value)) add(value);
    else if(CATEGORY_ALIASES[value]) add(CATEGORY_ALIASES[value]);
  }

  const hay=[event?.title,...raw].filter(Boolean).join(' ').toLowerCase();
  const keywordRules=[
    ['Artificial Intelligence',/\bartificial intelligence\b|\bmachine learning\b|\bai\b/],
    ['Data Science',/data science|data analytics|big data/],
    ['Cybersecurity',/cybersecurity|cyber security|information security/],
    ['Software & Cloud',/software|cloud|kubernetes|devops/],
    ['Telecommunications',/telecom|\b5g\b|\b6g\b|wireless/],
    ['Semiconductors & Electronics',/semiconductor|microelectron|electronics|chip design/],
    ['Robotics & Automation',/robot|automation|autonomous systems/],
    ['Civil & Construction',/civil engineering|construction|concrete|infrastructure/],
    ['Mechanical Engineering',/mechanical engineering|turbomachinery|applied mechanics/],
    ['Electrical Engineering',/electrical engineering|power electronics|power system/],
    ['Chemical Engineering',/chemical engineering|process engineering|process safety/],
    ['Materials Science',/materials science|advanced materials|composite|metallurgy/],
    ['Petroleum & Geoscience',/petroleum|oil and gas|geoscience|geology|geophys|geochem|upstream|reservoir|drilling/],
    ['Renewable Energy',/renewable|solar|wind energy|photovoltaic/],
    ['Hydrogen & CCUS',/hydrogen|carbon capture|ccus|ccs\b/],
    ['Mining & Minerals',/mining|mineral|ore processing/],
    ['Climate & Sustainability',/climate|sustainab|net zero|decarbon/],
    ['Environment',/environment|pollution|waste|ecology/],
    ['Healthcare',/healthcare|health care|medical|medicine|clinical/],
    ['Public Health',/public health|epidemiology/],
    ['Pharmaceuticals & Biotechnology',/pharma|biotech|drug discovery|biopharma/],
    ['Nursing',/nursing|nurses/],
    ['Dentistry',/dental|dentistry/],
    ['Cardiology',/cardiology|cardiovascular|heart/],
    ['Oncology',/oncology|cancer/],
    ['Neuroscience',/neuroscience|neurology|alzheimer/],
    ['Life Sciences',/life sciences|genomics|molecular biology|biology/],
    ['Chemistry',/chemistry|chemical sciences|catalysis/],
    ['Physics',/physics|photonics|quantum|astronomy/],
    ['Mathematics & Statistics',/mathematics|statistics|statistical/],
    ['Education',/education|edtech|teaching|learning/],
    ['Finance',/finance|banking|investment|fintech/],
    ['Economics',/economics|econometric/],
    ['Marketing',/marketing|advertising|brand/],
    ['Supply Chain & Logistics',/supply chain|logistics|freight|warehous/],
    ['Manufacturing',/manufactur|industry 4\.0|production engineering/],
    ['Aviation & Aerospace',/aviation|aerospace|aeronaut|air show|airshow/],
    ['Maritime',/maritime|shipping|marine|port|naval/],
    ['Automotive & Mobility',/automotive|mobility|vehicle|autonomous driving/],
    ['Architecture & Urbanism',/architecture|urban planning|built environment|smart city|real estate/],
    ['Agriculture & Food',/agriculture|agri-|food|crop|farming/],
    ['Law & Regulation',/legal|\blaw\b|regulation|compliance/],
    ['Government & Policy',/government|public policy|governance/],
    ['Social Sciences',/social science|sociology|psychology|political science|anthropology/],
    ['Arts & Culture',/arts|culture|humanities|music|museum/],
    ['Tourism & Hospitality',/tourism|hospitality|hotel|travel industry/],
    ['Blockchain & Web3',/blockchain|web3|crypto|digital asset/],
    ['Real Estate',/real estate|property|proptech/],
    ['Energy',/energy|power|oil|gas|renewable|hydrogen/],
    ['Engineering',/engineering|technology|industrial/],
    ['Science',/science|scientific|research/],
    ['Business',/business|commerce|management|industry|trade/],
  ];
  for(const [category,re] of keywordRules) if(re.test(hay)) add(category);
  return out.slice(0,8);
}

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

// Many large event sites hide commercial pages in menus, JS navigation, or PDFs. Probe a bounded
// set of conventional organiser paths as a backstop so global coverage does not depend on homepage
// anchor text alone. Failed probes are cheap and never become visible data.
function commonSponsorUrls(base) {
  let origin;
  try { origin=new URL(base).origin; } catch { return []; }
  const paths=[
    '/sponsor','/sponsors','/sponsorship','/sponsorship-opportunities','/sponsorship-options',
    '/become-a-sponsor','/sponsor-us','/exhibit','/exhibitors','/exhibitor','/exhibition',
    '/exhibit-with-us','/become-an-exhibitor','/book-a-stand','/reserve-a-booth',
    '/commercial-opportunities','/commercial-partners','/partners','/partnership',
    '/industry','/industry-opportunities','/industry-support','/industry-partners',
    '/prospectus','/sponsorship-prospectus','/exhibitor-prospectus','/media-kit',
    '/sponsorship-and-exhibition','/sponsorship-exhibition','/sponsor-exhibit',
  ];
  return paths.map((p)=>origin+p);
}

async function sponsorUrlsFromSitemap(base) {
  let origin;
  try { origin=new URL(base).origin; } catch { return []; }
  const sitemapCandidates=[origin+'/sitemap.xml',origin+'/sitemap_index.xml',origin+'/sitemap-index.xml'];
  const out=[];
  const seen=new Set();
  for(const sitemapUrl of sitemapCandidates){
    try{
      const res=await fetch(sitemapUrl,{
        headers:{'User-Agent':USER_AGENT,'Accept':'application/xml,text/xml,text/plain,*/*'},
        redirect:'follow',
        signal:AbortSignal.timeout(TIMEOUT_MS),
      });
      if(!res.ok) continue;
      const xml=await res.text();
      const locs=[...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map((m)=>decodeEntities(m[1].trim()));
      for(const loc of locs){
        const url=absoluteUrl(loc,origin);
        if(!url || hostOf(url)!==hostOf(origin)) continue;
        const key=url.replace(/#.*$/,'').replace(/\/$/,'');
        if(seen.has(key)) continue;
        if(SPONSOR_LINK_RE.test(url) || /industry|prospectus|media-kit|commercial|booth|stand/i.test(url)){
          seen.add(key); out.push(url);
        }
        if(out.length>=MAX_LINKS*2) break;
      }
      if(out.length>=MAX_LINKS*2) break;
    }catch{}
  }
  return out;
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
  if (/privacy|cookie|terms|newsletter|copyright|follow us|abstract|paper|research|results|patient|study|conference we track|scored/i.test(s)) return false;
  // Strong commercial-package vocabulary only. Generic words such as "conference", "session",
  // "network" or "workshop" by themselves are not evidence of a sponsorship package.
  return /sponsor|sponsorship|partner package|exhibit|exhibitor|booth|stand package|table sponsor|dinner sponsor|lunch sponsor|reception sponsor|lanyard|badge sponsor|app sponsor|digital sponsor|gala|golf sponsor|branding|advertis|package|platinum|gold sponsor|silver sponsor|bronze sponsor|diamond|premium sponsor|title sponsor|exclusive sponsor|networking sponsor|hospitality sponsor|workshop sponsor|session sponsor|delegate gift/i.test(s);
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
      // Sponsorship pages contain many unrelated numbers: years, attendee counts, scores,
      // abstract IDs and dimensions. A public price is accepted only when the source prints
      // an actual currency marker/code. If currency is absent, the UI correctly shows Inquire.
      if (!amount || amount < 100 || !hasCurrency) continue;
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
  // Only structural headings can create unpriced package names. Reading arbitrary body lines caused
  // abstracts, research results and attendee statistics to appear as sponsorship products.
  const candidates=extractHeadings(page.html);
  const seen=new Set();
  const out=[];
  for (const candidate of candidates) {
    const name=cleanPackageName(candidate);
    if (!looksLikePackageName(name)) continue;
    const key=name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, price_text:null, price_amount:null, currency:null, benefits:[], source_url:page.finalUrl });
  }
  return out.slice(0,24);
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

async function ensureStoredCatalog(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS discovery_sponsorship_opportunities (
    event_id TEXT PRIMARY KEY,
    conference_title TEXT NOT NULL,
    start_date TEXT,
    end_date TEXT,
    city TEXT,
    country TEXT,
    official_url TEXT NOT NULL,
    sponsor_url TEXT NOT NULL,
    action_url TEXT NOT NULL,
    action_label TEXT NOT NULL DEFAULT 'Inquire Now',
    has_published_pricing INTEGER NOT NULL DEFAULT 0,
    categories TEXT NOT NULL DEFAULT '[]',
    packages TEXT NOT NULL DEFAULT '[]',
    source_urls TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'available',
    checked_at TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

async function storeOpportunity(db,event,external) {
  const official=String(event.official_url || event.canonical_url || '').trim();
  const categories=normalizeStoredCategories(event);
  await db.execute({
    sql:`INSERT INTO discovery_sponsorship_opportunities(
      event_id,conference_title,start_date,end_date,city,country,official_url,sponsor_url,action_url,
      action_label,has_published_pricing,categories,packages,source_urls,status,checked_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(event_id) DO UPDATE SET
      conference_title=excluded.conference_title,start_date=excluded.start_date,end_date=excluded.end_date,
      city=excluded.city,country=excluded.country,official_url=excluded.official_url,
      sponsor_url=excluded.sponsor_url,action_url=excluded.action_url,action_label=excluded.action_label,
      has_published_pricing=excluded.has_published_pricing,categories=excluded.categories,
      packages=excluded.packages,source_urls=excluded.source_urls,status=excluded.status,
      checked_at=excluded.checked_at,updated_at=datetime('now')`,
    args:[
      String(event.id),String(event.title||''),event.start_date||null,event.end_date||null,event.city||null,event.country||null,
      official,String(external?.sponsor_url || official),String(external?.action_url || external?.sponsor_url || official),
      String(external?.action_label || 'Inquire Now'),external?.has_published_pricing ? 1 : 0,
      JSON.stringify(categories),JSON.stringify(Array.isArray(external?.packages)?external.packages:[]),
      JSON.stringify(Array.isArray(external?.source_urls)?external.source_urls:[]),
      String(external?.status || 'unread'),String(external?.checked_at || new Date().toISOString())
    ]
  });
}

async function enrichOne(db,event) {
  const official=String(event.official_url || event.canonical_url || '').trim();
  if (!official) return {status:'no-url'};
  const existingRows=await db.execute({sql:'SELECT source_url,extraction_metadata FROM extracted_conferences WHERE source_url IN (?,?) LIMIT 1',args:[official,String(event.canonical_url || official)]});
  const existing=existingRows.rows?.[0] || null;
  const oldMeta=safeJson(existing?.extraction_metadata,{});
  if (recentEnough(oldMeta)) {
    if (oldMeta?.external_sponsorship) await storeOpportunity(db,event,oldMeta.external_sponsorship);
    return {status:'fresh'};
  }

  const main=await fetchHtml(official);
  if (!main.ok || !pageMatchesEdition(main.html,event)) {
    const external={status:'unread',checked_at:new Date().toISOString(),sponsor_url:official,source_urls:[official],action_url:official,action_label:'Inquire Now',has_published_pricing:false,packages:[]};
    const meta={...oldMeta,external_sponsorship:external};
    if (existing) await db.execute({sql:"UPDATE extracted_conferences SET extraction_metadata=?,updated_at=datetime('now') WHERE source_url=?",args:[JSON.stringify(meta),existing.source_url]});
    await storeOpportunity(db,event,external);
    return {status:'unread'};
  }

  const candidateLinks=pickSponsorLinks(main.html,main.finalUrl);
  const known=(Array.isArray(oldMeta?.deep_page_urls)?oldMeta.deep_page_urls:[])
    .filter((u)=>typeof u==='string' && (SPONSOR_LINK_RE.test(u) || /industry|prospectus|media-kit|commercial|booth|stand/i.test(u)))
    .map((href)=>({href,label:'known sponsor/exhibitor page',score:9}));
  const sitemapLinks=(await sponsorUrlsFromSitemap(main.finalUrl))
    .map((href)=>({href,label:'sitemap sponsor/exhibitor page',score:8}));
  const conventional=commonSponsorUrls(main.finalUrl)
    .map((href)=>({href,label:'conventional sponsor/exhibitor path',score:7}));
  const merged=[...candidateLinks,...known,...sitemapLinks,...conventional];
  const seen=new Set();
  const links=merged.filter((x)=>{
    const k=x.href.replace(/#.*$/,'').replace(/\/$/,'');
    if(seen.has(k)) return false; seen.add(k); return true;
  }).slice(0,Math.max(MAX_LINKS,12));

  const sponsorPages=[];
  for (const link of links) {
    const page=await fetchHtml(link.href);
    if (page.ok && pageMatchesEdition(page.html,event)) sponsorPages.push(page);
  }

  const homeSponsorSignal=SPONSOR_LINK_RE.test(stripTags(main.html)) || candidateLinks.length>0;
  if (!sponsorPages.length && homeSponsorSignal) sponsorPages.push(main);
  if (!sponsorPages.length) {
    const external={status:'not_found',checked_at:new Date().toISOString(),sponsor_url:main.finalUrl,source_urls:[main.finalUrl],action_url:main.finalUrl,action_label:'Inquire Now',has_published_pricing:false,packages:[]};
    const meta={...oldMeta,external_sponsorship:external};
    const key=existing?.source_url || official;
    if(existing) await db.execute({sql:"UPDATE extracted_conferences SET extraction_metadata=?,updated_at=datetime('now') WHERE source_url=?",args:[JSON.stringify(meta),key]});
    await storeOpportunity(db,event,external);
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
  await storeOpportunity(db,event,external);
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
    await ensureStoredCatalog(db);
    const rows=await db.execute(`SELECT id,title,start_date,end_date,start_year,city,country,official_url,canonical_url,primary_category,topics,
      (SELECT GROUP_CONCAT(category,'|') FROM discovery_event_categories dec WHERE dec.event_id=discovery_events.id) AS categories
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
