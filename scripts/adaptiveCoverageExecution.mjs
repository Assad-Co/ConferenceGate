import { createClient } from '@libsql/client';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const YEARS = String(process.env.PHASE31_YEARS || '2026,2027')
  .split(',').map((value) => Number(value.trim())).filter(Number.isInteger);
const GAP_CELLS = Math.max(1, Number(process.env.PHASE31_GAP_CELLS || 10));
const MAX_PROVEN_DOMAINS = Math.max(2, Number(process.env.PHASE31_MAX_PROVEN_DOMAINS || 16));
const HARVEST_MAX_PAGES = Math.max(20, Number(process.env.PHASE31_HARVEST_MAX_PAGES || 96));
const HARVEST_PAGES_PER_DOMAIN = Math.max(2, Number(process.env.PHASE31_HARVEST_PAGES_PER_DOMAIN || 5));
const CLOSURE_RUNTIME_MS = Math.max(5 * 60_000, Number(process.env.PHASE31_CLOSURE_RUNTIME_MS || 25 * 60_000));
const CLOSURE_DISCOVERY_MS = Math.max(2 * 60_000, Number(process.env.PHASE31_DISCOVERY_MS || 8 * 60_000));
const CLOSURE_ENRICHMENT_MS = Math.max(2 * 60_000, Number(process.env.PHASE31_ENRICHMENT_MS || 12 * 60_000));
const PROMOTION_LIMIT = Math.max(25, Number(process.env.PHASE31_PROMOTION_LIMIT || 180));
const PUBLISH = process.env.PHASE31_PUBLISH !== '0'
  && process.env.DISCOVERY_PUBLISH_TO_CONFERENCES === '1'
  && process.env.CONFERENCEGATE_AUTOMATION_PUBLICATION === '1';

const OFFICIAL_CLASSES = new Set([
  'official_event_site', 'organizer_site', 'society_site', 'university_host_site',
]);
const BLOCKED_HOSTS = /(?:^|\.)(?:facebook\.com|instagram\.com|linkedin\.com|youtube\.com|x\.com|twitter\.com|eventbrite\.|10times\.|conferencealerts\.|allconferencealert\.|internationalconferencealerts\.)/i;

function safe(value, fallback) {
  if (value && typeof value === 'object') return value;
  try { return value ? JSON.parse(String(value)) : fallback; } catch { return fallback; }
}

function meaningful(value) {
  if (Array.isArray(value)) return value.some(meaningful);
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, nested]) =>
      !['source_url', 'source_urls', 'quality_flags', 'provenance', 'status'].includes(key) && meaningful(nested));
  }
  if (typeof value === 'string') {
    const text = value.replace(/\s+/g, ' ').trim();
    return text.length > 2 && !/^(?:not found|not retrieved|not announced|unknown|n\/?a|tbd|tba|none|unavailable|coming soon)$/i.test(text);
  }
  return typeof value === 'number' || value === true;
}

function visibleTabs(row) {
  const overview = safe(row.overview, {});
  const cfp = safe(row.call_for_papers, {});
  const agenda = safe(row.program_agenda, {});
  const speakers = safe(row.keynote_speakers, []);
  const committee = safe(row.technical_committee, []);
  const sponsors = safe(row.sponsors_exhibitors, []);
  const venue = safe(row.venue_accommodation, {});
  const fees = safe(row.fees_pricing, {});
  const community = safe(row.community, {});
  let tabs = meaningful(overview) ? 1 : 0;
  if (meaningful(cfp)) tabs += 1;
  if (meaningful(agenda)) tabs += 1;
  if (meaningful(speakers)) tabs += 1;
  if (meaningful(committee)) tabs += 1;
  if (meaningful(sponsors)) tabs += 1;
  if (meaningful(venue)) tabs += 1;
  if (meaningful(fees)) tabs += 1;
  if (meaningful(community)) tabs += 1;
  return tabs;
}

function visualReady(row) {
  const overview = safe(row.overview, {});
  return meaningful(overview.logo_url) || meaningful(overview.image_url) || meaningful(row.image_url);
}

function hostOf(url) {
  try { return new URL(String(url)).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

function yearOf(row) {
  const direct = Number(row.start_year);
  if (Number.isInteger(direct) && direct > 2000) return direct;
  const parsed = Number(String(row.start_date || '').slice(0, 4));
  return Number.isInteger(parsed) && parsed > 2000 ? parsed : null;
}

function runCli(args, { capture = false, allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/discovery/cli.ts', ...args], {
      env: process.env,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let stdout = '';
    let stderr = '';
    if (capture) {
      child.stdout.on('data', (chunk) => { stdout += String(chunk); });
      child.stderr.on('data', (chunk) => { stderr += String(chunk); process.stderr.write(chunk); });
    }
    child.on('error', (error) => allowFailure ? resolve({ code: 1, stdout, stderr, error }) : reject(error));
    child.on('exit', (code, signal) => {
      const result = { code: code ?? 1, stdout, stderr, signal };
      if (code === 0 || allowFailure) return resolve(result);
      reject(new Error(`discovery CLI failed code=${code ?? 'null'}${signal ? ` signal=${signal}` : ''}`));
    });
  });
}

function parseJsonOutput(text) {
  // Database/bootstrap diagnostics can precede the CLI's pretty-printed JSON and may
  // themselves contain braces. Only a top-level JSON object starts at column zero;
  // walk those candidates from the end and parse the first complete one that succeeds.
  const clean = String(text || '').replace(/\u001b\[[0-9;]*m/g, '').trim();
  const lines = clean.split(/\r?\n/);
  let lastError = null;
  for (let line = lines.length - 1; line >= 0; line -= 1) {
    if (!lines[line].startsWith('{')) continue;
    const candidate = lines.slice(line).join('\n').trim();
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (error) {
      lastError = error;
    }
  }
  const detail = lastError instanceof Error ? `: ${lastError.message}` : '';
  throw new Error(`coverage-plan did not emit a parseable JSON object${detail}`);
}

function newStats() {
  return { accepted: new Set(), ready: new Set(), published: new Set(), rich: new Set() };
}

function addStat(map, key, domain, row, rich) {
  if (!map.has(key)) map.set(key, new Map());
  const domains = map.get(key);
  if (!domains.has(domain)) domains.set(domain, newStats());
  const stat = domains.get(domain);
  const id = String(row.id);
  stat.accepted.add(id);
  if (row.publish_readiness === 'publish_ready') stat.ready.add(id);
  if (row.published_source_url) stat.published.add(id);
  if (rich) stat.rich.add(id);
}

function domainScore(stat, health) {
  const failurePenalty = Math.min(60, Number(health?.failure_count || 0) * 8);
  const successBonus = health?.last_successful_crawl ? 8 : 0;
  return stat.rich.size * 100 + stat.published.size * 28 + stat.ready.size * 14 + stat.accepted.size * 4 + successBonus - failurePenalty;
}

async function sourceStrategy(db, plan) {
  const gaps = (plan.topGaps || []).slice(0, Math.max(GAP_CELLS * 3, GAP_CELLS));
  if (!gaps.length) return { targets: [], domains: [], stalled: [], sourceRows: 0 };

  const yearPlaceholders = YEARS.map(() => '?').join(',');
  const sourceRows = await db.execute({
    sql: `
      SELECT de.id,de.region,de.country,de.start_year,de.start_date,de.publish_readiness,de.status,de.image_url,
             dec.category,s.source_url,s.is_official,s.source_classification,s.classification_confidence,
             ec.source_url AS published_source_url,ec.overview,ec.call_for_papers,ec.program_agenda,
             ec.keynote_speakers,ec.technical_committee,ec.sponsors_exhibitors,ec.venue_accommodation,
             ec.fees_pricing,ec.community,ec.extraction_metadata
        FROM discovery_events de
        JOIN discovery_event_categories dec ON dec.event_id=de.id
        JOIN discovery_event_sources s ON s.event_id=de.id
        LEFT JOIN extracted_conferences ec ON ec.source_url=de.official_url
       WHERE de.status IN ('validated','published','needs_review')
         AND (de.start_year IN (${yearPlaceholders})
              OR CAST(substr(coalesce(de.start_date,''),1,4) AS INTEGER) IN (${yearPlaceholders}))
         AND s.is_official=1 AND s.classification_confidence>=0.8
    `,
    args: [...YEARS, ...YEARS],
  });

  const healthRows = await db.execute(
    "SELECT domain,failure_count,robots_allowed,last_successful_crawl FROM discovery_source_domains"
  ).catch(() => ({ rows: [] }));
  const health = new Map((healthRows.rows || []).map((row) => [String(row.domain || '').toLowerCase(), row]));

  const exact = new Map();
  const categoryWide = new Map();
  for (const row of sourceRows.rows || []) {
    if (!OFFICIAL_CLASSES.has(String(row.source_classification || ''))) continue;
    const domain = hostOf(row.source_url);
    if (!domain || BLOCKED_HOSTS.test(domain)) continue;
    const domainHealth = health.get(domain);
    if (Number(domainHealth?.robots_allowed) === 0 || Number(domainHealth?.failure_count || 0) >= 8) continue;
    const year = yearOf(row);
    const region = String(row.region || '').trim();
    const category = String(row.category || '').trim();
    if (!year || !region || !category) continue;
    const metadata = safe(row.extraction_metadata, {});
    const auditedTabs = Number(metadata.catalogue_filled_tabs);
    const tabs = Number.isFinite(auditedTabs) && auditedTabs >= 1 ? auditedTabs : visibleTabs(row);
    const rich = Boolean(row.published_source_url) && tabs >= 6 && visualReady(row);
    addStat(exact, `${category}|${region}|${year}`, domain, row, rich);
    addStat(categoryWide, category, domain, row, rich);
  }

  const chosen = [];
  const chosenSet = new Set();
  const targets = [];
  const stalled = [];
  for (const gap of gaps.slice(0, GAP_CELLS)) {
    const target = {
      category: gap.category,
      region: gap.region,
      year: gap.year,
      accepted: Number(gap.accepted || 0),
      publishReady: Number(gap.publishReady || 0),
      published: Number(gap.published || 0),
      richPublished: Number(gap.richPublished || 0),
      gap: Number(gap.gap || 0),
    };
    const enoughInventory = target.accepted >= Math.max(4, Number(gap.targetRich || 2) * 3);
    const mode = target.publishReady > 0
      ? 'publish_and_deepen'
      : enoughInventory
        ? 'promote_existing'
        : target.accepted === 0
          ? 'discover_new'
          : 'discover_and_promote';
    const pool = exact.get(`${gap.category}|${gap.region}|${gap.year}`) || categoryWide.get(gap.category) || new Map();
    const ranked = [...pool.entries()]
      .map(([domain, stat]) => ({ domain, stat, score: domainScore(stat, health.get(domain)) }))
      .sort((a, b) => b.score - a.score || b.stat.rich.size - a.stat.rich.size || a.domain.localeCompare(b.domain));
    target.mode = mode;
    target.provenDomains = ranked.slice(0, 3).map((item) => ({
      domain: item.domain,
      score: item.score,
      accepted: item.stat.accepted.size,
      publishReady: item.stat.ready.size,
      published: item.stat.published.size,
      rich: item.stat.rich.size,
    }));
    targets.push(target);

    if (enoughInventory && target.richPublished === 0) {
      stalled.push({ ...target, reason: 'inventory_without_rich_conversion' });
    }
    if (mode === 'promote_existing' || mode === 'publish_and_deepen') continue;
    for (const item of ranked.slice(0, 2)) {
      if (chosenSet.has(item.domain)) continue;
      chosenSet.add(item.domain);
      chosen.push(item.domain);
      if (chosen.length >= MAX_PROVEN_DOMAINS) break;
    }
    if (chosen.length >= MAX_PROVEN_DOMAINS) break;
  }
  return { targets, domains: chosen, stalled, sourceRows: (sourceRows.rows || []).length };
}

async function fallbackStaticHarvest() {
  console.warn('[phase31] adaptive strategy unavailable; falling back to the existing coverage harvester.');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/coverageDrivenCategoryHarvest.mjs'], { stdio: 'inherit', env: process.env });
    child.on('error', () => resolve(1));
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function main() {
  if (!process.env.TURSO_DATABASE_URL?.trim()) {
    console.warn('[phase31] TURSO_DATABASE_URL is unavailable; production coverage execution skipped.');
    await fallbackStaticHarvest();
    return;
  }

  const localPath = path.join(process.cwd(), 'data', 'app.db');
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL.trim(),
    authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined,
  });

  try {
    const beforeResult = await runCli(['coverage-plan', '--years', YEARS.join(','), '--top', '120'], { capture: true });
    const before = parseJsonOutput(beforeResult.stdout);
    const strategy = await sourceStrategy(db, before);
    console.log('[phase31] before ' + JSON.stringify({
      coveredCells: before.coveredCells,
      cells: before.cells,
      accepted: before.accepted,
      publishReady: before.publishReady,
      richPublished: before.richPublished,
      topGaps: (before.topGaps || []).slice(0, GAP_CELLS).map((gap) => `${gap.category}|${gap.region}|${gap.year}:${gap.richPublished}/${gap.targetRich}`),
    }));
    console.log('[phase31] adaptive-source-strategy ' + JSON.stringify(strategy));

    if (strategy.domains.length) {
      const harvest = await runCli([
        'harvest', '--orgs', strategy.domains.join(','), '--max-org-domains', String(strategy.domains.length),
        '--max-pages', String(HARVEST_MAX_PAGES), '--org-pages', String(HARVEST_PAGES_PER_DOMAIN),
        '--years', YEARS.join(','), '--quiet',
      ], { allowFailure: true });
      if (harvest.code !== 0) console.warn(`[phase31] proven-domain harvest exited ${harvest.code}; continuing with search-based closure.`);
    } else {
      console.log('[phase31] no proven-domain harvest needed; promotion/search closure will work the selected gaps directly.');
    }

    const closureArgs = [
      'coverage-close', '--years', YEARS.join(','), '--gap-cells', String(GAP_CELLS), '--max-cycles', '1',
      '--promotion-limit', String(PROMOTION_LIMIT), '--max-search-queries', '24', '--max-pages', '120',
      '--max-candidates', '1200', '--max-jina-pages', '50', '--max-alternate-urls', '70',
      '--enrichment-limit', '180', '--enrichment-search-queries', '30', '--enrichment-jina-pages', '70',
      '--max-deep-pages', '6', '--discovery-time-budget-ms', String(CLOSURE_DISCOVERY_MS),
      '--enrichment-time-budget-ms', String(CLOSURE_ENRICHMENT_MS), '--run-time-budget-ms', String(CLOSURE_RUNTIME_MS),
      '--quiet',
    ];
    if (PUBLISH) closureArgs.push('--publish');
    const closure = await runCli(closureArgs, { allowFailure: true });
    if (closure.code !== 0) console.warn(`[phase31] coverage-close exited ${closure.code}; report will still capture the live post-run state.`);

    const afterResult = await runCli(['coverage-plan', '--years', YEARS.join(','), '--top', '120'], { capture: true });
    const after = parseJsonOutput(afterResult.stdout);
    const report = {
      status: closure.code === 0 ? 'completed' : 'completed_with_closure_error',
      publishRequested: PUBLISH,
      provenDomainsUsed: strategy.domains,
      stalledTargets: strategy.stalled,
      before: {
        coveredCells: before.coveredCells, accepted: before.accepted,
        publishReady: before.publishReady, richPublished: before.richPublished,
      },
      after: {
        coveredCells: after.coveredCells, accepted: after.accepted,
        publishReady: after.publishReady, richPublished: after.richPublished,
      },
      delta: {
        coveredCells: Number(after.coveredCells || 0) - Number(before.coveredCells || 0),
        accepted: Number(after.accepted || 0) - Number(before.accepted || 0),
        publishReady: Number(after.publishReady || 0) - Number(before.publishReady || 0),
        richPublished: Number(after.richPublished || 0) - Number(before.richPublished || 0),
      },
      nextWeakest: (after.topGaps || []).slice(0, 12).map((gap) => ({
        category: gap.category, region: gap.region, year: gap.year,
        accepted: gap.accepted, publishReady: gap.publishReady,
        richPublished: gap.richPublished, gap: gap.gap,
      })),
    };
    console.log('[phase31] production-coverage-report ' + JSON.stringify(report));
  } catch (error) {
    console.warn('[phase31] adaptive execution failed:', error?.message || error);
    await fallbackStaticHarvest();
  } finally {
    try { db.close(); } catch {}
  }
}

await main();
