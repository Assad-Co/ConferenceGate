import { createClient } from '@libsql/client';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

// Phase 32 — source performance learning and automatic reweighting.
//
// Phase 31 chooses healthy proven official domains for the live coverage gaps. Phase 32 adds memory:
// every authoritative automation run records which domains were selected, what those domains
// actually produced, and a smoothed quality/yield score. Repeated no-gain selections cool a source
// down, while sources that produce publish-ready or rich published conferences are promoted.
// A small exploration allowance prevents the system from permanently locking onto old winners.

const YEARS = String(process.env.PHASE32_YEARS || process.env.PHASE31_YEARS || '2026,2027')
  .split(',').map((value) => Number(value.trim())).filter(Number.isInteger);
const GAP_CELLS = Math.max(1, Number(process.env.PHASE32_GAP_CELLS || '16'));
const MAX_DOMAINS = Math.max(2, Number(process.env.PHASE32_MAX_DOMAINS || '14'));
const MAX_PAGES = Math.max(10, Number(process.env.PHASE32_MAX_PAGES || '72'));
const PAGES_PER_DOMAIN = Math.max(2, Number(process.env.PHASE32_PAGES_PER_DOMAIN || '4'));
const EXPLORATION_SHARE = Math.max(0, Math.min(0.5, Number(process.env.PHASE32_EXPLORATION_SHARE || '0.2')));
const EWMA_ALPHA = Math.max(0.05, Math.min(0.8, Number(process.env.PHASE32_EWMA_ALPHA || '0.32')));
const COOLDOWN_NO_GAIN = Math.max(2, Number(process.env.PHASE32_COOLDOWN_NO_GAIN || '3'));

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

function hostOf(url) {
  try { return new URL(String(url)).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
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

async function ensureTables(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS discovery_source_learning (
      domain TEXT PRIMARY KEY,
      observations INTEGER NOT NULL DEFAULT 0,
      accepted_count INTEGER NOT NULL DEFAULT 0,
      ready_count INTEGER NOT NULL DEFAULT 0,
      published_count INTEGER NOT NULL DEFAULT 0,
      rich_count INTEGER NOT NULL DEFAULT 0,
      ewma_score REAL NOT NULL DEFAULT 0,
      consecutive_no_gain INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'learning',
      last_selected_at TEXT,
      last_gain_at TEXT,
      last_observed_at TEXT,
      details_json TEXT NOT NULL DEFAULT '{}'
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS discovery_source_learning_runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      selected_domains TEXT NOT NULL DEFAULT '[]',
      gap_targets TEXT NOT NULL DEFAULT '[]',
      before_json TEXT NOT NULL DEFAULT '{}',
      after_json TEXT NOT NULL DEFAULT '{}',
      gained_domains TEXT NOT NULL DEFAULT '[]',
      no_gain_domains TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'started'
    )
  `);
}

function blankEvidence(domain) {
  return { domain, accepted: new Set(), ready: new Set(), published: new Set(), rich: new Set(), categories: new Set() };
}

async function collectEvidence(db) {
  const yearPlaceholders = YEARS.map(() => '?').join(',');
  const result = await db.execute({
    sql: `
      SELECT de.id,de.publish_readiness,de.status,de.image_url,dec.category,s.source_url,
             s.source_classification,s.classification_confidence,
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

  const domains = new Map();
  for (const row of result.rows || []) {
    if (!OFFICIAL_CLASSES.has(String(row.source_classification || ''))) continue;
    const domain = hostOf(row.source_url);
    if (!domain || BLOCKED_HOSTS.test(domain)) continue;
    if (!domains.has(domain)) domains.set(domain, blankEvidence(domain));
    const evidence = domains.get(domain);
    const id = String(row.id);
    evidence.accepted.add(id);
    evidence.categories.add(String(row.category || '').trim());
    if (row.publish_readiness === 'publish_ready') evidence.ready.add(id);
    if (row.published_source_url) evidence.published.add(id);
    const metadata = safe(row.extraction_metadata, {});
    const auditedTabs = Number(metadata.catalogue_filled_tabs);
    const tabs = Number.isFinite(auditedTabs) && auditedTabs >= 1 ? auditedTabs : visibleTabs(row);
    if (row.published_source_url && tabs >= 6 && visualReady(row)) evidence.rich.add(id);
  }
  return domains;
}

function counts(evidence) {
  return {
    accepted: evidence?.accepted?.size || 0,
    ready: evidence?.ready?.size || 0,
    published: evidence?.published?.size || 0,
    rich: evidence?.rich?.size || 0,
  };
}

function instantScore(current, previous = null) {
  const accepted = Math.max(1, current.accepted);
  const quality = (current.rich / accepted) * 180 + (current.published / accepted) * 55 + (current.ready / accepted) * 25;
  const breadth = Math.log1p(current.accepted) * 16;
  const delta = previous ? {
    accepted: Math.max(0, current.accepted - previous.accepted),
    ready: Math.max(0, current.ready - previous.ready),
    published: Math.max(0, current.published - previous.published),
    rich: Math.max(0, current.rich - previous.rich),
  } : { accepted: 0, ready: 0, published: 0, rich: 0 };
  const recentGain = delta.accepted * 3 + delta.ready * 12 + delta.published * 24 + delta.rich * 70;
  return quality + breadth + recentGain;
}

async function loadLearning(db) {
  const rows = await db.execute('SELECT * FROM discovery_source_learning').catch(() => ({ rows: [] }));
  return new Map((rows.rows || []).map((row) => [String(row.domain), row]));
}

async function refreshLearning(db, evidence, prior) {
  const now = new Date().toISOString();
  const refreshed = new Map();
  for (const [domain, item] of evidence) {
    const current = counts(item);
    const old = prior.get(domain);
    const previous = old ? {
      accepted: Number(old.accepted_count || 0),
      ready: Number(old.ready_count || 0),
      published: Number(old.published_count || 0),
      rich: Number(old.rich_count || 0),
    } : null;
    const score = instantScore(current, previous);
    const oldEwma = Number(old?.ewma_score || 0);
    const observations = Number(old?.observations || 0) + 1;
    const ewma = observations <= 1 ? score : oldEwma * (1 - EWMA_ALPHA) + score * EWMA_ALPHA;
    const details = {
      categories: [...item.categories].filter(Boolean).sort(),
      current,
      previous,
      instantScore: Number(score.toFixed(2)),
    };
    await db.execute({
      sql: `
        INSERT INTO discovery_source_learning
          (domain,observations,accepted_count,ready_count,published_count,rich_count,ewma_score,
           consecutive_no_gain,state,last_selected_at,last_gain_at,last_observed_at,details_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(domain) DO UPDATE SET
          observations=excluded.observations,
          accepted_count=excluded.accepted_count,
          ready_count=excluded.ready_count,
          published_count=excluded.published_count,
          rich_count=excluded.rich_count,
          ewma_score=excluded.ewma_score,
          last_observed_at=excluded.last_observed_at,
          details_json=excluded.details_json
      `,
      args: [domain, observations, current.accepted, current.ready, current.published, current.rich,
        ewma, Number(old?.consecutive_no_gain || 0), String(old?.state || 'learning'),
        old?.last_selected_at || null, old?.last_gain_at || null, now, JSON.stringify(details)],
    });
    refreshed.set(domain, { ...old, ...current, observations, ewma_score: ewma, details });
  }
  return refreshed;
}

async function sourceHealth(db) {
  const rows = await db.execute(
    'SELECT domain,failure_count,robots_allowed,last_successful_crawl FROM discovery_source_domains'
  ).catch(() => ({ rows: [] }));
  return new Map((rows.rows || []).map((row) => [String(row.domain || '').toLowerCase(), row]));
}

function rankDomain(domain, learning, evidence, health) {
  const learned = learning.get(domain) || {};
  const current = counts(evidence.get(domain));
  const domainHealth = health.get(domain) || {};
  const failures = Number(domainHealth.failure_count || 0);
  const noGain = Number(learned.consecutive_no_gain || 0);
  const qualitySignal = current.rich * 48 + current.published * 12 + current.ready * 6 + current.accepted * 1.5;
  const healthBonus = domainHealth.last_successful_crawl ? 10 : 0;
  const explorationBonus = Number(learned.observations || 0) <= 1 ? 35 : 0;
  const penalty = Math.min(100, failures * 9) + noGain * 55;
  return Number(learned.ewma_score || 0) + qualitySignal + healthBonus + explorationBonus - penalty;
}

function selectDomains(plan, evidence, learning, health) {
  const topGaps = (plan.topGaps || []).slice(0, GAP_CELLS);
  const categoryToDomains = new Map();
  for (const [domain, item] of evidence) {
    const h = health.get(domain);
    if (Number(h?.robots_allowed) === 0 || Number(h?.failure_count || 0) >= 8) continue;
    for (const category of item.categories) {
      if (!category) continue;
      if (!categoryToDomains.has(category)) categoryToDomains.set(category, new Set());
      categoryToDomains.get(category).add(domain);
    }
  }

  const candidates = new Map();
  for (let gapRank = 0; gapRank < topGaps.length; gapRank += 1) {
    const gap = topGaps[gapRank];
    const domains = categoryToDomains.get(String(gap.category || '')) || new Set();
    for (const domain of domains) {
      const learned = learning.get(domain) || {};
      if (Number(learned.consecutive_no_gain || 0) >= COOLDOWN_NO_GAIN) continue;
      const score = rankDomain(domain, learning, evidence, health) + Math.max(0, 80 - gapRank * 4) + Number(gap.gap || 0) * 15;
      const previous = candidates.get(domain);
      if (!previous || score > previous.score) {
        candidates.set(domain, { domain, score, category: gap.category, region: gap.region, year: gap.year, gap: gap.gap });
      }
    }
  }

  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score || a.domain.localeCompare(b.domain));
  const exploreCount = Math.min(Math.max(1, Math.round(MAX_DOMAINS * EXPLORATION_SHARE)), Math.floor(MAX_DOMAINS / 2));
  const exploitCount = Math.max(1, MAX_DOMAINS - exploreCount);
  const selected = ranked.slice(0, exploitCount);
  const selectedSet = new Set(selected.map((row) => row.domain));

  const exploration = ranked
    .filter((row) => !selectedSet.has(row.domain))
    .sort((a, b) => Number(learning.get(a.domain)?.observations || 0) - Number(learning.get(b.domain)?.observations || 0)
      || b.score - a.score)
    .slice(0, exploreCount);
  for (const row of exploration) {
    selected.push({ ...row, exploration: true });
    selectedSet.add(row.domain);
  }
  return { selected: selected.slice(0, MAX_DOMAINS), topGaps };
}

async function markSelected(db, selected) {
  const now = new Date().toISOString();
  for (const row of selected) {
    await db.execute({
      sql: 'UPDATE discovery_source_learning SET last_selected_at=? WHERE domain=?',
      args: [now, row.domain],
    });
  }
}

async function settleRunLearning(db, selected, beforeEvidence, afterEvidence, learning) {
  const now = new Date().toISOString();
  const gained = [];
  const noGain = [];
  for (const row of selected) {
    const before = counts(beforeEvidence.get(row.domain));
    const after = counts(afterEvidence.get(row.domain));
    const delta = {
      accepted: Math.max(0, after.accepted - before.accepted),
      ready: Math.max(0, after.ready - before.ready),
      published: Math.max(0, after.published - before.published),
      rich: Math.max(0, after.rich - before.rich),
    };
    const gainValue = delta.accepted + delta.ready * 4 + delta.published * 9 + delta.rich * 25;
    const old = learning.get(row.domain) || {};
    const oldNoGain = Number(old.consecutive_no_gain || 0);
    const nextNoGain = gainValue > 0 ? 0 : oldNoGain + 1;
    const state = gainValue > 0
      ? (after.rich >= 2 ? 'trusted' : 'productive')
      : nextNoGain >= COOLDOWN_NO_GAIN ? 'cooldown' : 'learning';
    const afterInstant = instantScore(after, before);
    const oldEwma = Number(old.ewma_score || 0);
    const nextEwma = oldEwma * (1 - EWMA_ALPHA) + afterInstant * EWMA_ALPHA;
    const details = {
      ...(old.details || {}),
      lastRun: { before, after, delta, gainValue, selectedScore: row.score, exploration: !!row.exploration },
    };
    await db.execute({
      sql: `
        UPDATE discovery_source_learning
           SET accepted_count=?,ready_count=?,published_count=?,rich_count=?,ewma_score=?,
               consecutive_no_gain=?,state=?,last_gain_at=?,last_observed_at=?,details_json=?
         WHERE domain=?
      `,
      args: [after.accepted, after.ready, after.published, after.rich, nextEwma,
        nextNoGain, state, gainValue > 0 ? now : (old.last_gain_at || null), now, JSON.stringify(details), row.domain],
    });
    const summary = { domain: row.domain, delta, gainValue, state, score: Number(nextEwma.toFixed(2)) };
    if (gainValue > 0) gained.push(summary); else noGain.push(summary);
  }
  return { gained, noGain };
}

async function main() {
  if (!process.env.TURSO_DATABASE_URL?.trim()) {
    console.log('[phase32] TURSO_DATABASE_URL unavailable; source learning skipped.');
    return;
  }
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL.trim(),
    authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined,
  });
  const runId = `source-learning-${crypto.randomUUID()}`;
  const startedAt = new Date().toISOString();
  try {
    await ensureTables(db);
    const planResult = await runCli(['coverage-plan', '--years', YEARS.join(','), '--top', '160'], { capture: true });
    const plan = parseJsonOutput(planResult.stdout);
    const beforeEvidence = await collectEvidence(db);
    const prior = await loadLearning(db);
    const learning = await refreshLearning(db, beforeEvidence, prior);
    const health = await sourceHealth(db);
    const strategy = selectDomains(plan, beforeEvidence, learning, health);
    const selected = strategy.selected;

    await db.execute({
      sql: `INSERT INTO discovery_source_learning_runs
        (id,started_at,selected_domains,gap_targets,before_json,status) VALUES (?,?,?,?,?,?)`,
      args: [runId, startedAt, JSON.stringify(selected), JSON.stringify(strategy.topGaps),
        JSON.stringify({ coveredCells: plan.coveredCells, cells: plan.cells, accepted: plan.accepted,
          publishReady: plan.publishReady, richPublished: plan.richPublished }), 'started'],
    });

    console.log('[phase32] strategy ' + JSON.stringify({
      runId,
      gaps: strategy.topGaps.slice(0, 8).map((gap) => `${gap.category}|${gap.region}|${gap.year}:${gap.richPublished}/${gap.targetRich}`),
      selected: selected.map((row) => ({ domain: row.domain, score: Number(row.score.toFixed(2)), exploration: !!row.exploration })),
    }));

    await markSelected(db, selected);
    let harvestCode = 0;
    if (selected.length) {
      const harvest = await runCli([
        'harvest', '--orgs', selected.map((row) => row.domain).join(','),
        '--max-org-domains', String(selected.length), '--max-pages', String(MAX_PAGES),
        '--org-pages', String(PAGES_PER_DOMAIN), '--years', YEARS.join(','), '--quiet',
      ], { allowFailure: true });
      harvestCode = harvest.code;
    }

    const afterEvidence = await collectEvidence(db);
    const settled = await settleRunLearning(db, selected, beforeEvidence, afterEvidence, learning);
    const afterPlanResult = await runCli(['coverage-plan', '--years', YEARS.join(','), '--top', '160'], { capture: true, allowFailure: true });
    const afterPlan = afterPlanResult.code === 0 ? parseJsonOutput(afterPlanResult.stdout) : plan;
    const status = harvestCode === 0 ? 'completed' : 'harvest_partial';
    await db.execute({
      sql: `UPDATE discovery_source_learning_runs
               SET finished_at=?,after_json=?,gained_domains=?,no_gain_domains=?,status=? WHERE id=?`,
      args: [new Date().toISOString(), JSON.stringify({ coveredCells: afterPlan.coveredCells, cells: afterPlan.cells,
        accepted: afterPlan.accepted, publishReady: afterPlan.publishReady, richPublished: afterPlan.richPublished }),
        JSON.stringify(settled.gained), JSON.stringify(settled.noGain), status, runId],
    });

    console.log('[phase32] result ' + JSON.stringify({
      runId, status, selected: selected.length, gained: settled.gained.length, noGain: settled.noGain.length,
      before: { coveredCells: plan.coveredCells, accepted: plan.accepted, publishReady: plan.publishReady, richPublished: plan.richPublished },
      after: { coveredCells: afterPlan.coveredCells, accepted: afterPlan.accepted, publishReady: afterPlan.publishReady, richPublished: afterPlan.richPublished },
      topGains: settled.gained.sort((a, b) => b.gainValue - a.gainValue).slice(0, 8),
      cooldown: settled.noGain.filter((row) => row.state === 'cooldown').map((row) => row.domain),
    }));
  } catch (error) {
    console.warn('[phase32] source learning failed:', error?.stack || error?.message || error);
    try {
      await db.execute({
        sql: `UPDATE discovery_source_learning_runs SET finished_at=?,status=? WHERE id=?`,
        args: [new Date().toISOString(), 'failed', runId],
      });
    } catch {}
  } finally {
    try { db.close(); } catch {}
  }
}

await main();
