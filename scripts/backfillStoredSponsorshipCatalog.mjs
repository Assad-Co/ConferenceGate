import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

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
const CATEGORY_SET = new Set(ORIGINAL_CATEGORIES);
const ALIASES = {
  Materials:'Materials Science', Health:'Healthcare', Geoscience:'Petroleum & Geoscience',
  Geology:'Petroleum & Geoscience', 'Organic Geochemistry':'Petroleum & Geoscience',
  Automotive:'Automotive & Mobility', Architecture:'Architecture & Urbanism',
  Politics:'Government & Policy', 'AI & Machine Learning':'Artificial Intelligence',
  'Data Science & Analytics':'Data Science', 'Cybersecurity & Privacy':'Cybersecurity',
  'Computer Science & Software':'Software & Cloud', 'Telecommunications & Networking':'Telecommunications',
  'Manufacturing & Industry':'Manufacturing', 'Aerospace & Aviation':'Aviation & Aerospace',
  'Petroleum & Energy':'Petroleum & Geoscience', 'Geosciences & Earth Systems':'Petroleum & Geoscience',
  'Mining & Metallurgy':'Mining & Minerals', 'Marine & Ocean Sciences':'Maritime',
  'Environment & Sustainability':'Climate & Sustainability', 'Healthcare & Health IT':'Healthcare',
  'Medicine & Oncology':'Healthcare', 'Pharmaceutical & Biotechnology':'Pharmaceuticals & Biotechnology',
  'Chemistry & Materials':'Chemistry', 'Business & Finance':'Business',
  'Blockchain & Fintech':'Blockchain & Web3', 'Logistics & Transportation':'Supply Chain & Logistics',
  'Architecture & Construction':'Architecture & Urbanism', 'Education & EdTech':'Education',
  'Law & Policy':'Law & Regulation', 'Arts & Humanities':'Arts & Culture'
};

function safe(value, fallback) {
  try { return value ? JSON.parse(String(value)) : fallback; } catch { return fallback; }
}

function normalizeCategories(row) {
  const raw = [
    ...String(row.categories || '').split('|'),
    ...safe(row.topics, []),
    row.primary_category,
  ].filter(Boolean).map((v) => String(v).trim());

  const out = [];
  const add = (v) => {
    if (v && CATEGORY_SET.has(v) && !out.includes(v)) out.push(v);
  };

  for (const value of raw) {
    if (CATEGORY_SET.has(value)) add(value);
    else if (ALIASES[value]) add(ALIASES[value]);
  }

  const hay = [row.title, ...raw].filter(Boolean).join(' ').toLowerCase();
  const rules = [
    ['Artificial Intelligence',/artificial intelligence|machine learning|\bai\b/],
    ['Data Science',/data science|analytics|big data/],
    ['Cybersecurity',/cybersecurity|cyber security|information security/],
    ['Software & Cloud',/software|cloud|kubernetes|devops/],
    ['Telecommunications',/telecom|\b5g\b|\b6g\b|wireless/],
    ['Semiconductors & Electronics',/semiconductor|electronics|microelectron|chip/],
    ['Robotics & Automation',/robot|automation|autonomous systems/],
    ['Civil & Construction',/civil engineering|construction|concrete|infrastructure/],
    ['Mechanical Engineering',/mechanical engineering|turbomachinery|applied mechanics/],
    ['Electrical Engineering',/electrical engineering|power electronics|power system/],
    ['Chemical Engineering',/chemical engineering|process engineering|process safety/],
    ['Materials Science',/materials science|advanced materials|composite|metallurgy/],
    ['Petroleum & Geoscience',/petroleum|oil and gas|oil & gas|geoscience|geology|geophys|geochem|upstream|reservoir|drilling/],
    ['Renewable Energy',/renewable|solar|wind energy|photovoltaic/],
    ['Hydrogen & CCUS',/hydrogen|carbon capture|ccus|\bccs\b/],
    ['Mining & Minerals',/mining|mineral|ore processing/],
    ['Environment',/environment|pollution|waste|ecology/],
    ['Climate & Sustainability',/climate|sustainab|net zero|decarbon/],
    ['Healthcare',/healthcare|health care|medical|medicine|clinical/],
    ['Public Health',/public health|epidemiology/],
    ['Pharmaceuticals & Biotechnology',/pharma|biotech|drug discovery|biopharma/],
    ['Nursing',/nursing|nurses/], ['Dentistry',/dental|dentistry/],
    ['Cardiology',/cardiology|cardiovascular|heart/], ['Oncology',/oncology|cancer/],
    ['Neuroscience',/neuroscience|neurology|alzheimer/],
    ['Life Sciences',/life sciences|genomics|molecular biology|biology/],
    ['Chemistry',/chemistry|chemical sciences|catalysis/],
    ['Physics',/physics|photonics|quantum|astronomy/],
    ['Mathematics & Statistics',/mathematics|statistics|statistical/],
    ['Education',/education|edtech|teaching|learning/],
    ['Finance',/finance|banking|investment|fintech/],
    ['Economics',/economics|econometric/], ['Marketing',/marketing|advertising|brand/],
    ['Supply Chain & Logistics',/supply chain|logistics|freight|warehouse/],
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
  for (const [category, re] of rules) if (re.test(hay)) add(category);
  return out.slice(0, 8);
}

function collectUrls(value, out = []) {
  if (!value) return out;
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value.trim())) out.push(value.trim());
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const nested of Object.values(value)) collectUrls(nested, out);
  }
  return out;
}

function bestCommercialUrl(row, meta, sponsors) {
  const external = meta?.external_sponsorship;
  const direct = [
    external?.action_url,
    external?.sponsor_url,
    ...collectUrls(sponsors),
    ...collectUrls(meta?.deep_page_urls),
    ...collectUrls(meta?.source_urls),
  ].filter(Boolean);

  const commercial = direct.find((u) =>
    /sponsor|exhibit|booth|stand|commercial|partner|prospectus|industry|media-kit/i.test(String(u))
  );
  return commercial || row.registration_url || row.official_url || row.canonical_url || row.source_url || null;
}

async function ensureTable(db) {
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

async function main() {
  const localPath = path.join(process.cwd(), 'data', 'app.db');
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  const db = process.env.TURSO_DATABASE_URL?.trim()
    ? createClient({ url: process.env.TURSO_DATABASE_URL.trim(), authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined })
    : createClient({ url: 'file:' + localPath });

  try {
    await ensureTable(db);
    const rows = await db.execute(`
      SELECT
        de.id,de.title,de.start_date,de.end_date,de.start_year,de.city,de.country,
        de.official_url,de.canonical_url,de.registration_url,de.source_url,de.primary_category,de.topics,
        (SELECT GROUP_CONCAT(category,'|') FROM discovery_event_categories dec WHERE dec.event_id=de.id) AS categories,
        (SELECT ec.extraction_metadata FROM extracted_conferences ec
           WHERE ec.source_url=de.official_url OR ec.source_url=de.canonical_url OR CASE WHEN json_valid(ec.extraction_metadata) THEN json_extract(ec.extraction_metadata,'$.discovery_event_id')=de.id ELSE 0 END
           ORDER BY ec.updated_at DESC LIMIT 1) AS extraction_metadata,
        (SELECT ec.sponsors_exhibitors FROM extracted_conferences ec
           WHERE ec.source_url=de.official_url OR ec.source_url=de.canonical_url OR CASE WHEN json_valid(ec.extraction_metadata) THEN json_extract(ec.extraction_metadata,'$.discovery_event_id')=de.id ELSE 0 END
           ORDER BY ec.updated_at DESC LIMIT 1) AS sponsors_exhibitors
      FROM discovery_events de
      WHERE de.status='published'
        AND COALESCE(de.official_url,de.canonical_url,de.source_url) IS NOT NULL
        AND (
          (de.start_date IS NOT NULL AND date(de.start_date)>=date('now'))
          OR (de.start_date IS NULL AND de.start_year>=CAST(strftime('%Y','now') AS INTEGER))
        )
      ORDER BY CASE WHEN de.start_date IS NULL THEN 1 ELSE 0 END,de.start_date,de.title
    `);

    let inserted = 0;
    let skipped = 0;
    for (const row of rows.rows || []) {
      const meta = safe(row.extraction_metadata, {});
      const sponsors = safe(row.sponsors_exhibitors, []);
      const categories = normalizeCategories(row);
      if (!categories.length) { skipped++; continue; }

      const official = String(row.official_url || row.canonical_url || row.source_url || '').trim();
      const actionUrl = bestCommercialUrl(row, meta, sponsors) || official;
      if (!official || !actionUrl) { skipped++; continue; }

      const external = meta?.external_sponsorship || {};
      const extPackages = Array.isArray(external.packages) ? external.packages : [];
      const packages = extPackages.length ? extPackages : [{
        name: 'Sponsorship / Exhibitor Enquiry',
        price_text: null,
        price_amount: null,
        currency: null,
        benefits: [],
        source_url: actionUrl,
      }];
      const hasPrice = Boolean(external.has_published_pricing) || packages.some((p) => Number.isFinite(Number(p?.price_amount)));
      const sourceUrls = [...new Set([
        ...collectUrls(external?.source_urls),
        actionUrl,
        official,
      ].filter(Boolean))];

      const result = await db.execute({
        sql: `INSERT OR IGNORE INTO discovery_sponsorship_opportunities(
          event_id,conference_title,start_date,end_date,city,country,official_url,sponsor_url,action_url,
          action_label,has_published_pricing,categories,packages,source_urls,status,checked_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
        args: [
          String(row.id),String(row.title || ''),row.start_date || null,row.end_date || null,row.city || null,row.country || null,
          official,String(external?.sponsor_url || actionUrl),String(actionUrl),hasPrice ? 'View Sponsorship' : 'Inquire Now',
          hasPrice ? 1 : 0,JSON.stringify(categories),JSON.stringify(packages),JSON.stringify(sourceUrls),
          'available',String(external?.checked_at || new Date().toISOString())
        ]
      });
      if ((result.rowsAffected || 0) > 0) inserted++; else skipped++;
    }

    console.log(`[sponsorship-backfill] inserted=${inserted} skipped_or_existing=${skipped} total_events=${rows.rows?.length || 0}`);
  } finally {
    try { db.close(); } catch {}
  }
}

await main();
