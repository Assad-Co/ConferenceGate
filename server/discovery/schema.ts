// The discovery engine's own tables.
//
// Every statement here is additive: `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT
// EXISTS`, all on new `discovery_*` names. No existing Conference Gate table is altered, renamed
// or dropped, and no existing row is touched by this migration. The engine keeps its records
// beside the production data rather than inside it, so a bad crawl can never damage a conference
// somebody actually created — publication into the existing `extracted_conferences` table is a
// separate, explicitly opt-in step (see publish.ts).

import { db, dbAll } from "../db";

export const DISCOVERY_TABLES = [
  "discovery_run_providers",
  "discovery_run_failures",
  "discovery_domains",
  "discovery_runs",
  "discovery_run_events",
  "discovery_urls",
  "discovery_events",
  "discovery_event_sources",
  "discovery_event_fields",
  "discovery_event_categories",
  "discovery_series",
  "discovery_event_changes",
  "discovery_event_field_history",
  "discovery_enrichment_runs",
  "discovery_publication_audits",
  "discovery_scale_runs",
  "discovery_scale_batches",
  "discovery_url_remediation_runs",
  "discovery_review_queue",
] as const;

let initialized = false;

export async function initDiscoverySchema(): Promise<void> {
  if (initialized) return;
  await db.executeMultiple(`
    -- The source registry. One row per domain the engine is allowed to look at, with the
    -- scheduling and health state that decides when it is next visited.
    CREATE TABLE IF NOT EXISTS discovery_domains (
      domain TEXT PRIMARY KEY,
      source_name TEXT NOT NULL,
      source_type TEXT NOT NULL,
      country TEXT,
      region TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      trust_score REAL NOT NULL DEFAULT 0.5,
      crawl_frequency_hours INTEGER NOT NULL DEFAULT 168,
      last_checked TEXT,
      last_successful_crawl TEXT,
      next_crawl_at TEXT,
      robots_allowed INTEGER,
      robots_checked_at TEXT,
      robots_crawl_delay_ms INTEGER,
      sitemap_urls TEXT NOT NULL DEFAULT '[]',
      failure_count INTEGER NOT NULL DEFAULT 0,
      last_failure_reason TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- One crawl run: what it was asked to do, and what it actually did.
    CREATE TABLE IF NOT EXISTS discovery_runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      trigger TEXT NOT NULL DEFAULT 'manual',
      target_years TEXT NOT NULL DEFAULT '[]',
      domains TEXT NOT NULL DEFAULT '[]',
      counters TEXT NOT NULL DEFAULT '{}',
      log TEXT NOT NULL DEFAULT '[]',
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS discovery_run_events (
      run_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      outcome TEXT NOT NULL,
      validation_status TEXT NOT NULL,
      provider TEXT NOT NULL,
      source_url TEXT NOT NULL,
      source_classification TEXT NOT NULL DEFAULT 'unknown',
      first_attributed_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (run_id, event_id, source_url)
    );

    -- Candidate URLs and their fetch state. ETag/Last-Modified/content hash live here so an
    -- unchanged page is never downloaded twice, and never re-extracted when it is.
    CREATE TABLE IF NOT EXISTS discovery_urls (
      url TEXT PRIMARY KEY,
      domain TEXT NOT NULL,
      provider TEXT NOT NULL,
      priority REAL NOT NULL DEFAULT 0,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_checked TEXT,
      last_status INTEGER,
      etag TEXT,
      last_modified TEXT,
      content_hash TEXT,
      fetch_failures INTEGER NOT NULL DEFAULT 0,
      last_failure_reason TEXT,
      next_check_at TEXT,
      is_event INTEGER,
      event_id TEXT
    );

    -- The canonical discovered conference. One row per real-world conference edition.
    CREATE TABLE IF NOT EXISTS discovery_events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      normalized_title TEXT NOT NULL,
      acronym TEXT,
      description TEXT,

      start_date TEXT,
      end_date TEXT,
      start_year INTEGER,
      start_month INTEGER,
      date_precision TEXT,
      dates_text TEXT,

      abstract_deadline TEXT,
      paper_submission_deadline TEXT,
      early_bird_deadline TEXT,
      registration_deadline TEXT,
      notification_date TEXT,
      camera_ready_deadline TEXT,

      venue TEXT,
      venue_address TEXT,
      city TEXT,
      region TEXT,
      country TEXT,
      country_code TEXT,
      raw_location TEXT,
      latitude REAL,
      longitude REAL,

      format TEXT NOT NULL DEFAULT 'unknown',
      event_type TEXT NOT NULL DEFAULT 'other',
      original_event_type TEXT,

      organizer TEXT,
      organizer_url TEXT,
      official_url TEXT,
      canonical_url TEXT,
      registration_url TEXT,
      submission_url TEXT,
      image_url TEXT,

      price TEXT,
      currency TEXT,
      language TEXT,

      contact_name TEXT,
      contact_email TEXT,
      contact_phone TEXT,

      topics TEXT NOT NULL DEFAULT '[]',
      primary_category TEXT,

      series_id TEXT,
      edition TEXT,

      status TEXT NOT NULL DEFAULT 'discovered',
      confidence_score REAL NOT NULL DEFAULT 0,
      relevance_classification TEXT,
      relevance_reason TEXT,
      quality_flags TEXT NOT NULL DEFAULT '[]',

      extraction_method TEXT NOT NULL DEFAULT 'html',
      source_url TEXT NOT NULL,
      source_domain TEXT NOT NULL,
      content_hash TEXT,

      date_discovered TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_checked TEXT,
      last_verified TEXT,
      last_modified TEXT,
      published_at TEXT
    );

    -- Every page that told us about this conference, and how much it was trusted. A conference
    -- listed by its organiser, a society and a directory has three rows here and one row above.
    CREATE TABLE IF NOT EXISTS discovery_event_sources (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      source_url TEXT NOT NULL,
      source_domain TEXT NOT NULL,
      source_type TEXT,
      source_classification TEXT NOT NULL DEFAULT 'unknown',
      classification_confidence REAL NOT NULL DEFAULT 0,
      classification_evidence TEXT NOT NULL DEFAULT '[]',
      provider TEXT,
      trust_score REAL NOT NULL DEFAULT 0.5,
      extraction_method TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      is_official INTEGER NOT NULL DEFAULT 0,
      raw_extraction TEXT,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_verified TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(event_id, source_url)
    );

    -- Per-field provenance: value, where it came from, how confident, when last confirmed.
    CREATE TABLE IF NOT EXISTS discovery_event_fields (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      field TEXT NOT NULL,
      value TEXT,
      source_url TEXT NOT NULL,
      source_domain TEXT NOT NULL,
      extraction_method TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      last_verified TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(event_id, field)
    );

    -- Categories are many-per-event and carry the words that justified them.
    CREATE TABLE IF NOT EXISTS discovery_event_categories (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      category TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      evidence TEXT NOT NULL DEFAULT '[]',
      UNIQUE(event_id, category)
    );

    -- Recurring conferences. Editions link here; the series itself never carries a guessed date.
    CREATE TABLE IF NOT EXISTS discovery_series (
      id TEXT PRIMARY KEY,
      series_key TEXT NOT NULL UNIQUE,
      series_name TEXT NOT NULL,
      series_acronym TEXT,
      organizer TEXT,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- What changed about a conference and when — dates moved, venue changed, event cancelled.
    CREATE TABLE IF NOT EXISTS discovery_event_changes (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      change_type TEXT NOT NULL,
      field TEXT,
      old_value TEXT,
      new_value TEXT,
      source_url TEXT,
      detected_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Append-only field history. discovery_event_fields remains the active winning provenance;
    -- this table preserves both sides whenever Phase 1.4 confirms, supersedes or rejects a
    -- conflicting value, so an authoritative date correction never erases how we got there.
    CREATE TABLE IF NOT EXISTS discovery_event_field_history (
      id TEXT PRIMARY KEY,
      enrichment_run_id TEXT,
      event_id TEXT NOT NULL,
      field TEXT NOT NULL,
      old_value TEXT,
      old_source_url TEXT,
      old_source_classification TEXT,
      new_value TEXT,
      new_source_url TEXT NOT NULL,
      new_source_classification TEXT NOT NULL,
      decision TEXT NOT NULL,
      reason TEXT NOT NULL,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS discovery_enrichment_runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'running',
      records_examined INTEGER NOT NULL DEFAULT 0,
      official_urls_before INTEGER NOT NULL DEFAULT 0,
      official_urls_after INTEGER NOT NULL DEFAULT 0,
      verified_countries_before INTEGER NOT NULL DEFAULT 0,
      verified_countries_after INTEGER NOT NULL DEFAULT 0,
      verified_dates_before INTEGER NOT NULL DEFAULT 0,
      verified_dates_after INTEGER NOT NULL DEFAULT 0,
      organizers_before INTEGER NOT NULL DEFAULT 0,
      organizers_after INTEGER NOT NULL DEFAULT 0,
      publish_ready INTEGER NOT NULL DEFAULT 0,
      needs_enrichment INTEGER NOT NULL DEFAULT 0,
      needs_review INTEGER NOT NULL DEFAULT 0,
      conflicts_detected INTEGER NOT NULL DEFAULT 0,
      conflicts_resolved INTEGER NOT NULL DEFAULT 0,
      provider_usage TEXT NOT NULL DEFAULT '{}',
      source_distribution TEXT NOT NULL DEFAULT '{}',
      errors TEXT NOT NULL DEFAULT '[]',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS discovery_publication_audits (
      id TEXT PRIMARY KEY,
      sample_size INTEGER NOT NULL,
      passed INTEGER NOT NULL,
      audited_event_ids TEXT NOT NULL DEFAULT '[]',
      failures TEXT NOT NULL DEFAULT '[]',
      report TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS discovery_scale_runs (
      id TEXT PRIMARY KEY,
      target_accepted INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      next_batch INTEGER NOT NULL DEFAULT 1,
      accepted_at_start INTEGER NOT NULL,
      accepted_at_finish INTEGER,
      stop_reason TEXT,
      checkpoint_report TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS discovery_scale_batches (
      id TEXT PRIMARY KEY,
      scale_run_id TEXT NOT NULL,
      batch_number INTEGER NOT NULL,
      discovery_run_id TEXT,
      enrichment_run_id TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      accepted_before INTEGER NOT NULL,
      accepted_after INTEGER,
      published INTEGER NOT NULL DEFAULT 0,
      metrics TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      UNIQUE(scale_run_id, batch_number)
    );

    CREATE TABLE IF NOT EXISTS discovery_url_remediation_runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'running',
      records_examined INTEGER NOT NULL DEFAULT 0,
      before_metrics TEXT NOT NULL DEFAULT '{}',
      after_metrics TEXT NOT NULL DEFAULT '{}',
      changes TEXT NOT NULL DEFAULT '{}',
      errors TEXT NOT NULL DEFAULT '[]',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );

    -- Anything the engine is not confident enough to act on by itself. Nothing is ever deleted
    -- because two titles looked alike; it lands here for a person to decide.
    CREATE TABLE IF NOT EXISTS discovery_review_queue (
      id TEXT PRIMARY KEY,
      event_id TEXT,
      candidate_event_id TEXT,
      reason TEXT NOT NULL,
      duplicate_score REAL,
      duplicate_reason TEXT,
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT,
      resolution TEXT
    );

    -- Per-run, per-provider search accounting. A row here answers "what did Brave cost and what
    -- did it return, in THIS run" without unpacking a JSON blob — and, crucially, records the
    -- difference between a provider that was not configured, one that was asked and answered
    -- nothing, and one that failed. Phase 1.2 could not tell those three apart.
    CREATE TABLE IF NOT EXISTS discovery_run_providers (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      configured INTEGER NOT NULL DEFAULT 0,
      queries_planned INTEGER NOT NULL DEFAULT 0,
      queries_issued INTEGER NOT NULL DEFAULT 0,
      queries_zero_results INTEGER NOT NULL DEFAULT 0,
      queries_failed INTEGER NOT NULL DEFAULT 0,
      raw_results INTEGER NOT NULL DEFAULT 0,
      candidates INTEGER NOT NULL DEFAULT 0,
      strong_candidates INTEGER NOT NULL DEFAULT 0,
      unique_urls INTEGER NOT NULL DEFAULT 0,
      shared_urls INTEGER NOT NULL DEFAULT 0,
      accepted_events INTEGER NOT NULL DEFAULT 0,
      decision TEXT,
      errors TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(run_id, provider)
    );

    -- Per-run fetch-failure tally, by class and by domain. The Phase 1.2 benchmark could report
    -- "203 terminal failures" and nothing more; this is what turns that number into a plan.
    CREATE TABLE IF NOT EXISTS discovery_run_failures (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      failure_class TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      last_status INTEGER,
      last_detail TEXT,
      UNIQUE(run_id, domain, failure_class)
    );

    CREATE INDEX IF NOT EXISTS idx_discovery_run_providers_run ON discovery_run_providers(run_id);
    CREATE INDEX IF NOT EXISTS idx_discovery_run_failures_run ON discovery_run_failures(run_id);
    CREATE INDEX IF NOT EXISTS idx_discovery_run_failures_class ON discovery_run_failures(failure_class);
    CREATE INDEX IF NOT EXISTS idx_discovery_urls_domain ON discovery_urls(domain);
    CREATE INDEX IF NOT EXISTS idx_discovery_urls_next_check ON discovery_urls(next_check_at);
    CREATE INDEX IF NOT EXISTS idx_discovery_events_year ON discovery_events(start_year);
    CREATE INDEX IF NOT EXISTS idx_discovery_events_country ON discovery_events(country);
    CREATE INDEX IF NOT EXISTS idx_discovery_events_status ON discovery_events(status);
    CREATE INDEX IF NOT EXISTS idx_discovery_events_start ON discovery_events(start_date);
    CREATE INDEX IF NOT EXISTS idx_discovery_events_norm_title ON discovery_events(normalized_title);
    CREATE INDEX IF NOT EXISTS idx_discovery_events_canonical ON discovery_events(canonical_url);
    CREATE INDEX IF NOT EXISTS idx_discovery_events_domain ON discovery_events(source_domain);
    CREATE INDEX IF NOT EXISTS idx_discovery_events_series ON discovery_events(series_id);
    CREATE INDEX IF NOT EXISTS idx_discovery_event_sources_event ON discovery_event_sources(event_id);
    CREATE INDEX IF NOT EXISTS idx_discovery_run_events_run ON discovery_run_events(run_id);
    CREATE INDEX IF NOT EXISTS idx_discovery_event_fields_event ON discovery_event_fields(event_id);
    CREATE INDEX IF NOT EXISTS idx_discovery_event_categories_event ON discovery_event_categories(event_id);
    CREATE INDEX IF NOT EXISTS idx_discovery_event_categories_cat ON discovery_event_categories(category);
    CREATE INDEX IF NOT EXISTS idx_discovery_event_changes_event ON discovery_event_changes(event_id);
    CREATE INDEX IF NOT EXISTS idx_discovery_field_history_event ON discovery_event_field_history(event_id);
    CREATE INDEX IF NOT EXISTS idx_discovery_enrichment_started ON discovery_enrichment_runs(started_at);
    CREATE INDEX IF NOT EXISTS idx_discovery_scale_status ON discovery_scale_runs(status, target_accepted);
    CREATE INDEX IF NOT EXISTS idx_discovery_scale_batches_run ON discovery_scale_batches(scale_run_id, batch_number);
    CREATE INDEX IF NOT EXISTS idx_discovery_url_remediation_started ON discovery_url_remediation_runs(started_at);
    CREATE INDEX IF NOT EXISTS idx_discovery_review_status ON discovery_review_queue(status);
    CREATE INDEX IF NOT EXISTS idx_discovery_domains_next ON discovery_domains(next_crawl_at);
  `);
  for (const statement of [
    "ALTER TABLE discovery_event_sources ADD COLUMN source_classification TEXT NOT NULL DEFAULT 'unknown'",
    "ALTER TABLE discovery_event_sources ADD COLUMN classification_confidence REAL NOT NULL DEFAULT 0",
    "ALTER TABLE discovery_event_sources ADD COLUMN classification_evidence TEXT NOT NULL DEFAULT '[]'",
    // The world region (Europe, Asia, …), derived deterministically from the validated country.
    // A NEW column on purpose: `region` already means the state or province a page stated, and
    // overwriting that would destroy a value a source actually gave us.
    "ALTER TABLE discovery_events ADD COLUMN world_region TEXT",
    // Which retrieval route finally produced this record: direct, jina, alternate_url or
    // directory_resolution. Without it, "Jina recovered 1 event" is an anecdote.
    "ALTER TABLE discovery_events ADD COLUMN recovery_method TEXT",
    // Set when this record began as a directory listing and its own site was then found, so a
    // resolved event is never confused with one discovered on its official site directly.
    "ALTER TABLE discovery_events ADD COLUMN resolved_from_directory INTEGER NOT NULL DEFAULT 0",
    // The precise failure class for a URL that could not be read, so the taxonomy survives a run.
    "ALTER TABLE discovery_urls ADD COLUMN failure_class TEXT",
    // A URL the engine found as a better home for the same conference.
    "ALTER TABLE discovery_urls ADD COLUMN alternate_url TEXT",
    "ALTER TABLE discovery_events ADD COLUMN publish_readiness TEXT NOT NULL DEFAULT 'needs_enrichment'",
    "ALTER TABLE discovery_events ADD COLUMN readiness_reasons TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE discovery_events ADD COLUMN official_source_verified_at TEXT",
    "ALTER TABLE discovery_events ADD COLUMN title_verified_at TEXT",
  ]) {
    try { await db.execute(statement); } catch (error: any) {
      if (!/duplicate column name/i.test(String(error?.message || error))) throw error;
    }
  }
  initialized = true;
}

/** True when every discovery table exists — used by the status endpoint to report readiness
 *  without assuming the migration has run. */
export async function discoverySchemaReady(): Promise<boolean> {
  const rows = await dbAll<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'discovery_%'`
  );
  const present = new Set(rows.map((r) => r.name));
  return DISCOVERY_TABLES.every((table) => present.has(table));
}
