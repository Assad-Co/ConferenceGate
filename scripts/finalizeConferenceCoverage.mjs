import { createClient } from '@libsql/client';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SECTION_KEYS = ['cfp','fees','agenda','speakers','committee','sponsors','venue','community'];
const CATEGORY_RULES = [
  ['Artificial Intelligence', /artificial intelligence|machine learning|deep learning|generative ai|large language model|\bllm\b|\bai\b/i],
  ['Data Science', /data science|data analytics|big data|data engineering|business intelligence/i],
  ['Cybersecurity', /cybersecurity|cyber security|information security|network security|zero trust|ethical hacking/i],
  ['Software & Cloud', /software|cloud computing|devops|platform engineering|saas|kubernetes|developer/i],
  ['Telecommunications', /telecommunications?|\btelecom\b|5g|6g|wireless|mobile network/i],
  ['Semiconductors & Electronics', /semiconductor|microelectronics|electronics|integrated circuits?|\bchips?\b|photonics/i],
  ['Robotics & Automation', /robotics?|automation|autonomous systems?|mechatronics/i],
  ['Civil & Construction', /civil engineering|construction|infrastructure|structural engineering|geotechnical/i],
  ['Mechanical Engineering', /mechanical engineering|thermodynamics|fluid mechanics|manufacturing systems/i],
  ['Electrical Engineering', /electrical engineering|power systems?|electrical grid/i],
  ['Chemical Engineering', /chemical engineering|process engineering|petrochemical|catalysis/i],
  ['Materials Science', /materials science|advanced materials|metallurgy|ceramics|polymers?|composites?/i],
  ['Engineering', /engineering|engineer\b/i],
  ['Petroleum & Geoscience', /petroleum|oil and gas|geoscience|geology|geological|geophysics|reservoir|hydrocarbon|sedimentology|stratigraph|seismic/i],
  ['Renewable Energy', /renewable|solar|wind power|geothermal|bioenergy|clean energy/i],
  ['Hydrogen & CCUS', /hydrogen|carbon capture|ccus|\bccs\b|carbon storage|decarbonization|decarbonisation/i],
  ['Mining & Minerals', /mining|minerals?|ore deposit|mineral exploration|critical minerals|lithium/i],
  ['Energy', /energy|petroleum|oil and gas|electricity|lng|natural gas/i],
  ['Climate & Sustainability', /climate|sustainab|net zero|circular economy|decarbon/i],
  ['Environment', /environment|ecolog|conservation|pollution|biodiversity/i],
  ['Public Health', /public health|epidemiology|global health|population health/i],
  ['Pharmaceuticals & Biotechnology', /pharma|pharmaceutical|biotechnology|biotech|drug discovery|therapeutics/i],
  ['Nursing', /nursing|\bnurse\b/i],
  ['Dentistry', /dentistry|dental|oral health/i],
  ['Cardiology', /cardiology|cardiovascular|heart disease/i],
  ['Oncology', /oncology|cancer|tumou?r/i],
  ['Neuroscience', /neuroscience|neurology|brain|neurodegenerative/i],
  ['Life Sciences', /life sciences?|biology|genomics|genetics|microbiology|immunology|cell biology/i],
  ['Healthcare', /healthcare|health care|medical|medicine|clinical|hospital|patient/i],
  ['Chemistry', /chemistry|chemical sciences?|analytical chemistry|organic chemistry/i],
  ['Physics', /physics|quantum|astrophysics|particle physics|optics/i],
  ['Mathematics & Statistics', /mathematics|statistics|statistical|applied math|operations research/i],
  ['Science', /science|scientific|research/i],
  ['Education', /education|teaching|learning|pedagog|academic|edtech|higher education/i],
  ['Finance', /finance|banking|fintech|investment|treasury|accounting/i],
  ['Economics', /economics|economic policy|econometrics/i],
  ['Marketing', /marketing|advertising|brand strategy|customer experience/i],
  ['Supply Chain & Logistics', /supply chain|logistics|procurement|transportation|freight|warehousing/i],
  ['Manufacturing', /manufacturing|industrial production|factory|industry 4\.0/i],
  ['Aviation & Aerospace', /aviation|aerospace|aircraft|air transport|space technology/i],
  ['Maritime', /maritime|shipping|marine engineering|offshore vessel/i],
  ['Automotive & Mobility', /automotive|mobility|electric vehicle|\bev\b|transport technology/i],
  ['Architecture & Urbanism', /architecture|urban design|urban planning|smart cities|built environment/i],
  ['Agriculture & Food', /agricultur|farming|agronom|crop|food science|food technology|agritech/i],
  ['Law & Regulation', /\blaw\b|legal|regulation|regulatory|jurisprudence|compliance/i],
  ['Government & Policy', /public policy|government|policy forum|public administration/i],
  ['Social Sciences', /social science|sociology|psychology|anthropology|political science/i],
  ['Arts & Culture', /arts?\b|culture|humanities|museum|creative industries/i],
  ['Tourism & Hospitality', /tourism|hospitality|travel industry|hotel industry/i],
  ['Blockchain & Web3', /blockchain|web3|cryptocurrency|digital assets|distributed ledger/i],
  ['Real Estate', /real estate|property|proptech|facilities management/i],
  ['Business', /business|management|entrepreneur|commerce|strategy|leadership/i],
];

function safeJson(value, fallback) {
  try { return value ? JSON.parse(String(value)) : fallback; } catch { return fallback; }
}
function stableId(value) {
  return 'cat_' + createHash('sha1').update(String(value || '')).digest('hex').slice(0, 24);
}
function faviconFor(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    return new URL('/favicon.ico', u.origin).href;
  } catch { return null; }
}
function inferCategories(event, overview, cfp) {
  const topics = safeJson(event.topics, []);
  const existing = [
    event.primary_category,
    overview?.category,
    ...(Array.isArray(overview?.categories) ? overview.categories : []),
  ].filter(Boolean);

  const format = String(overview?.format || event.format || '').toLowerCase();
  if (/online|virtual|webinar/.test(format)) existing.push('Virtual conferences');

  const cfpStatus = String(cfp?.status || '').toLowerCase();
  const deadlineText = String(cfp?.abstract_submission_deadline || '').trim();
  const deadlineMs = deadlineText ? Date.parse(deadlineText) : NaN;
  const today = new Date(); today.setHours(0,0,0,0);
  const explicitlyClosed = /\b(?:closed|expired|deadline passed|submissions? closed|not accepting)\b/i.test(cfpStatus);
  const explicitlyOpen = /\b(?:open|extended|accepting submissions?|call for (?:papers|abstracts).*(?:open|extended))\b/i.test(cfpStatus);
  if (!explicitlyClosed && (explicitlyOpen || (Number.isFinite(deadlineMs) && deadlineMs >= today.getTime()))) {
    existing.push('Open call for papers');
  }
  const subject = [
    event.title, event.description, event.organizer, event.primary_category,
    ...(Array.isArray(topics) ? topics : []),
    overview?.description, overview?.overview, overview?.category,
    ...(Array.isArray(overview?.topics) ? overview.topics : []),
    ...(Array.isArray(overview?.keywords) ? overview.keywords : []),
  ].filter(Boolean).join(' ');
  const matched = CATEGORY_RULES.filter(([, re]) => re.test(subject)).map(([name]) => name);
  return [...new Set([...existing, ...matched])].slice(0, 8);
}
function hasContent(value) {
  if (Array.isArray(value)) return value.some(hasContent);
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([k,v]) => !['source_url','source_urls','status'].includes(k) && hasContent(v));
  }
  if (typeof value === 'string') return value.trim().length > 2 && !/^(not found|not retrieved|unknown|n\/a|tbd|tba)$/i.test(value.trim());
  return typeof value === 'number' || value === true;
}

function sectionHasContent(key, value) {
  if (key === 'fees') {
    if (!value || typeof value !== 'object') return false;
    const rows = Array.isArray(value.registration_fees) ? value.registration_fees : [];
    return rows.some(hasContent)
      || hasContent(value.pricing_text)
      || hasContent(value.early_bird_deadline);
  }
  if (key === 'cfp') {
    if (!value || typeof value !== 'object') return false;
    return [
      value.status,
      value.abstract_submission_deadline,
      value.notification_date,
      value.submission_guidelines,
      value.submission_format,
      value.length_limit,
      value.review_process,
      value.publication_information,
      ...(Array.isArray(value.topics_tracks) ? value.topics_tracks : []),
    ].some(hasContent);
  }
  if (key === 'agenda') {
    if (!value || typeof value !== 'object') return false;
    return (Array.isArray(value.sessions) && value.sessions.some(hasContent))
      || (Array.isArray(value.themes) && value.themes.some(hasContent))
      || hasContent(value.overview);
  }
  if (key === 'venue') {
    if (!value || typeof value !== 'object') return false;
    return [
      value.venue_name, value.address, value.accommodation, value.travel_information,
      ...(Array.isArray(value.hotels) ? value.hotels : []),
    ].some(hasContent);
  }
  if (key === 'community') {
    if (!value || typeof value !== 'object') return false;
    return hasContent(value.overview)
      || (Array.isArray(value.social_media) && value.social_media.some(hasContent));
  }
  return hasContent(value);
}

async function main() {
  const localPath = path.join(process.cwd(), 'data', 'app.db');
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  const db = process.env.TURSO_DATABASE_URL?.trim()
    ? createClient({ url: process.env.TURSO_DATABASE_URL.trim(), authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined })
    : createClient({ url: 'file:' + localPath });

  try {
    const tables = await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('discovery_events','extracted_conferences')");
    if ((tables.rows || []).length < 2) {
      console.log('[conference-finalize] schema unavailable; skipping');
      return;
    }

    const result = await db.execute(`SELECT id,title,description,organizer,official_url,canonical_url,start_date,end_date,dates_text,
      venue,venue_address,city,region,country,format,topics,primary_category,image_url,status
      FROM discovery_events
      WHERE status='published' AND COALESCE(official_url,canonical_url) IS NOT NULL`);

    let updated = 0, created = 0, logos = 0, categorized = 0;
    for (const event of result.rows || []) {
      const url = String(event.official_url || event.canonical_url || '').trim();
      if (!url) continue;
      const found = await db.execute({
        sql: 'SELECT * FROM extracted_conferences WHERE source_url IN (?,?) LIMIT 1',
        args: [url, String(event.canonical_url || url)],
      });
      const existing = found.rows?.[0] || null;
      const overview = safeJson(existing?.overview, {});
      const cfp = safeJson(existing?.call_for_papers, {});
      const program = safeJson(existing?.program_agenda, { sessions: [], themes: [], overview: null });
      const speakers = safeJson(existing?.keynote_speakers, []);
      const committee = safeJson(existing?.technical_committee, []);
      const sponsors = safeJson(existing?.sponsors_exhibitors, []);
      const venue = safeJson(existing?.venue_accommodation, {});
      const fees = safeJson(existing?.fees_pricing, {});
      const community = safeJson(existing?.community, {});
      const meta = safeJson(existing?.extraction_metadata, {});

      const categories = inferCategories(event, overview, cfp);
      if (categories.length) categorized += 1;
      const logo = overview.logo_url || faviconFor(url);
      if (logo) logos += 1;
      const nextOverview = {
        ...overview,
        conference_name: overview.conference_name || event.title,
        description: overview.description || event.description || null,
        dates_text: overview.dates_text || event.dates_text || (event.start_date && event.end_date ? event.start_date + ' – ' + event.end_date : event.start_date || null),
        start_date: overview.start_date || event.start_date || null,
        end_date: overview.end_date || event.end_date || null,
        venue: overview.venue || event.venue || null,
        city: overview.city || event.city || null,
        region: overview.region || event.region || null,
        country: overview.country || event.country || null,
        location_text: overview.location_text || [event.venue,event.city,event.region,event.country].filter(Boolean).join(', ') || null,
        format: overview.format || event.format || null,
        organizer: overview.organizer || event.organizer || null,
        official_url: overview.official_url || url,
        source_url: overview.source_url || url,
        logo_url: logo || null,
        logo_source: overview.logo_source || (logo ? 'organiser' : null),
        image_url: overview.image_url || event.image_url || null,
        category: overview.category || categories[0] || event.primary_category || null,
        categories,
        topics: Array.isArray(overview.topics) && overview.topics.length ? overview.topics : safeJson(event.topics, []),
      };

      const currentAvailability = meta.section_availability && typeof meta.section_availability === 'object'
        ? meta.section_availability : {};
      const values = { cfp, fees, agenda: program, speakers, committee, sponsors, venue, community };
      const availability = { ...currentAvailability, overview: 'stated' };
      for (const key of SECTION_KEYS) {
        if (sectionHasContent(key, values[key])) availability[key] = 'stated';
        else if (availability[key] === 'stated' || !availability[key]) availability[key] = 'unread';
      }
      const nextMeta = {
        ...meta,
        origin: meta.origin || 'discovery_engine',
        status: meta.status || 'success',
        discovery_event_id: meta.discovery_event_id || event.id,
        section_availability: availability,
        completeness_normalized_at: new Date().toISOString(),
        category_count: categories.length,
        logo_fallback: overview.logo_url ? (meta.logo_fallback || null) : (logo ? 'official-site-favicon' : 'generated-mark'),
      };

      const key = existing?.source_url || url;
      await db.execute({
        sql: `INSERT INTO extracted_conferences (
          source_url,overview,call_for_papers,program_agenda,keynote_speakers,technical_committee,
          sponsors_exhibitors,venue_accommodation,fees_pricing,community,extraction_metadata,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
        ON CONFLICT(source_url) DO UPDATE SET
          overview=excluded.overview,
          call_for_papers=excluded.call_for_papers,
          program_agenda=excluded.program_agenda,
          keynote_speakers=excluded.keynote_speakers,
          technical_committee=excluded.technical_committee,
          sponsors_exhibitors=excluded.sponsors_exhibitors,
          venue_accommodation=excluded.venue_accommodation,
          fees_pricing=excluded.fees_pricing,
          community=excluded.community,
          extraction_metadata=excluded.extraction_metadata,
          updated_at=datetime('now')`,
        args: [
          key, JSON.stringify(nextOverview), JSON.stringify(cfp), JSON.stringify(program),
          JSON.stringify(speakers), JSON.stringify(committee), JSON.stringify(sponsors),
          JSON.stringify(venue), JSON.stringify(fees), JSON.stringify(community), JSON.stringify(nextMeta)
        ],
      });
      if (existing) updated += 1; else created += 1;

      if (categories.length) {
        await db.execute({
          sql: 'UPDATE discovery_events SET primary_category=COALESCE(primary_category,?), last_checked=COALESCE(last_checked,?) WHERE id=?',
          args: [categories[0], new Date().toISOString(), event.id],
        });
        for (const category of categories) {
          await db.execute({
            sql: `INSERT OR IGNORE INTO discovery_event_categories (id,event_id,category,confidence,evidence)
                  VALUES (?,?,?,0.9,?)`,
            args: [stableId(event.id + '|' + category), event.id, category, JSON.stringify(['deterministic title/topic classification'])],
          });
        }
      }
    }
    console.log('[conference-finalize] records=' + (result.rows?.length || 0) + ' updated=' + updated + ' created=' + created + ' logos=' + logos + ' categorized=' + categorized);
  } catch (error) {
    console.warn('[conference-finalize] failed:', error?.message || error);
  } finally {
    try { db.close(); } catch {}
  }
}

await main();
