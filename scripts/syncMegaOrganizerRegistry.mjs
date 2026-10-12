import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

const manifestPath = path.join(process.cwd(), 'data', 'phase57-mega-organizer-registry.json');
if (!fs.existsSync(manifestPath)) {
  console.log('[phase57-organizers] manifest absent; skipping');
  process.exit(0);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const sources = Array.isArray(manifest.sources) ? manifest.sources : [];
const localPath = path.join(process.cwd(), 'data', 'app.db');
fs.mkdirSync(path.dirname(localPath), { recursive: true });
const db = process.env.TURSO_DATABASE_URL?.trim()
  ? createClient({ url: process.env.TURSO_DATABASE_URL.trim(), authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined })
  : createClient({ url: 'file:' + localPath });

const trustByType = {
  official_conference_site: 0.95,
  professional_society: 0.90,
  scientific_organization: 0.90,
  medical_society: 0.90,
  engineering_society: 0.90,
  university: 0.88,
  research_institute: 0.85,
  government: 0.85,
  professional_association: 0.82,
  publisher: 0.80,
  conference_organizer: 0.75,
  convention_organization: 0.70,
};

function normalizeDomain(value) {
  let host = String(value || '').trim().toLowerCase();
  if (!host) return '';
  if (host.includes('//')) {
    try { host = new URL(host).hostname; } catch {}
  }
  return host.replace(/^www\./, '').replace(/\/.*$/, '');
}

try {
  const tables = await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='discovery_domains'");
  if (!(tables.rows || []).length) {
    console.log('[phase57-organizers] discovery_domains unavailable; skipping');
    process.exit(0);
  }

  const unique = new Map();
  for (const source of sources) {
    const domain = normalizeDomain(source.domain);
    if (!domain || !source.sourceName || !source.sourceType) continue;
    unique.set(domain, { ...source, domain });
  }

  let insertedOrUpdated = 0;
  const byTier = {};
  const byRegion = {};
  const categorySet = new Set();

  for (const source of unique.values()) {
    const trust = trustByType[source.sourceType] ?? 0.70;
    const tier = Number(source.tier || 3);
    const frequency = tier === 1 ? 72 : tier === 2 ? 120 : 168;
    const categories = Array.isArray(source.categories) ? source.categories.filter(Boolean) : [];
    for (const category of categories) categorySet.add(String(category));
    byTier[tier] = (byTier[tier] || 0) + 1;
    byRegion[source.region || 'Unknown'] = (byRegion[source.region || 'Unknown'] || 0) + 1;

    await db.execute({
      sql: `INSERT INTO discovery_domains (
        domain, source_name, source_type, country, region, enabled, trust_score,
        crawl_frequency_hours, notes
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(domain) DO UPDATE SET
        source_name=excluded.source_name,
        source_type=excluded.source_type,
        country=excluded.country,
        region=excluded.region,
        enabled=1,
        trust_score=MAX(discovery_domains.trust_score, excluded.trust_score),
        crawl_frequency_hours=MIN(discovery_domains.crawl_frequency_hours, excluded.crawl_frequency_hours),
        notes=excluded.notes`,
      args: [
        source.domain,
        source.sourceName,
        source.sourceType,
        source.country || null,
        source.region || null,
        trust,
        frequency,
        `Phase 57 mega registry · tier ${tier} · ${categories.join(', ') || 'general'} · authoritative first-party source`,
      ],
    });
    insertedOrUpdated += 1;
  }

  console.log(JSON.stringify({
    phase: manifest.phase,
    sources: insertedOrUpdated,
    tiers: byTier,
    regions: byRegion,
    categories: categorySet.size,
    targetAccepted: Number(manifest.targetAccepted || 1500),
    targetPublished: Number(manifest.targetPublished || 1000),
    years: manifest.years || [2026, 2027, 2028],
  }));
} finally {
  try { db.close(); } catch {}
}
