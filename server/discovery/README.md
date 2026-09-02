# Conference Gate — Global Conference Discovery Engine

Backend only. Nothing in this directory renders anything, and no frontend file was changed to
add it. The engine finds conferences, reads them, checks them, and stores them beside the app's
existing data; whether any of that ever reaches the website is a separate, explicitly opt-in step
(see **Publishing** below).

```
  registry domains ─┐
  search provider  ─┼─▶ candidate URLs ─▶ fetch (robots-checked, conditional)
  future providers ─┘                              │
                                                   ▼
                            schema.org structured data (free, first-hand)
                                                   │  still incomplete?
                                                   ▼
                            deterministic labelled-HTML extraction (free)
                                                   │  still incomplete?
                                                   ▼
                            AI fallback (capped, off by default, grounded)
                                                   │
        normalize ─▶ classify ─▶ categorize ─▶ validate ─▶ deduplicate ─▶ store
```

## The rule everything here obeys

A field the source did not state is `null`. Not a plausible guess, not a default, not "probably
in person". Every value that is stored records where it came from, how it was read, how confident
that reading was, and when it was last confirmed — so "which source supplied this date?" has an
answer for every conference in the database.

## Quick start

```bash
npm run discovery -- seed                    # load the seed domain registry
npm run discovery -- domains                 # what is registered, and when each is next due
npm run discovery -- run --domains egu.eu --max-pages 40
npm run discovery -- report                  # quality report
npm run discovery -- export --out discovery_test.csv
npm run discovery -- publish --dry-run       # what would reach the app's own table
npm run test:discovery                       # 86 fixture-backed tests, no network
```

An end-to-end rehearsal against a local eleven-site fixture web, with no network access at all:

```bash
npx tsx server/discovery/tests/phase1Rehearsal.ts --out /tmp/discovery-rehearsal
```

## Files

| File | What it does |
| --- | --- |
| `types.ts` | Shared vocabulary: taxonomies, the `DiscoveryProvider` interface, `NormalizedEvent`. |
| `schema.ts` | The additive `discovery_*` tables. Creates nothing else and alters nothing. |
| `sourceRegistry.ts` | Domain registry: trust, crawl frequency, robots state, failure backoff. |
| `sources.seed.ts` | The Phase 1 seed list — data, not structure. |
| `httpClient.ts` | Per-domain rate limiting, retries with backoff, conditional GET, manual redirects with the SSRF guard re-applied at every hop. |
| `robots.ts` | robots.txt fetching and matching. No override exists. |
| `sitemaps.ts` | Sitemap and nested sitemap-index discovery; candidate URL scoring. |
| `html.ts` | A small forgiving HTML parser (no new dependency). |
| `structuredData.ts` | JSON-LD, microdata and RDFa schema.org Event extraction. |
| `htmlExtract.ts` | Deterministic extraction by label, never by DOM position. |
| `aiExtract.ts` | The capped, opt-in AI fallback, with every returned value checked back against the page. |
| `dates.ts` | International date parsing; refuses ambiguous numeric dates. |
| `countries.ts` | Country normalization onto the app's own spellings. |
| `normalize.ts` | Dates, deadlines, location, format, event type, description, acronym, canonical URL. |
| `classify.ts` | Conference relevance, scored, with its reasoning attached. |
| `categories.ts` | Categories mapped onto the app's existing `industry` taxonomy. |
| `validate.ts` | Coherence checks and neutral quality flags; decides publication status. |
| `dedupe.ts` | Duplicate scoring and series identity. Nothing is ever deleted for looking similar. |
| `store.ts` | Persistence, per-field provenance, change detection, review queue. |
| `pipeline.ts` | The sequencing and the budgets. |
| `metrics.ts` / `exportCsv.ts` | Metrics, CSV export, quality report. |
| `publish.ts` | The opt-in bridge into the app's existing `extracted_conferences` table. |
| `router.ts` / `cli.ts` | The Phase 1 interface: an API and a command line. No dashboard. |
| `providers/` | The sitemap provider, the search adapter, and Phase 2 stubs. |

## Database

Ten new tables, all named `discovery_*`, all created with `CREATE TABLE IF NOT EXISTS`. No
existing Conference Gate table is altered, renamed or dropped, and no existing row is modified by
the migration.

`discovery_domains`, `discovery_runs`, `discovery_urls`, `discovery_events`,
`discovery_event_sources`, `discovery_event_fields`, `discovery_event_categories`,
`discovery_series`, `discovery_event_changes`, `discovery_review_queue`.

## Publishing into the app

`extracted_conferences` is the table the app already treats as its canonical imported conference
record, and Discover already surfaces its rows — so a discovered conference written there appears
in the existing UI with no frontend change. Because that is a real change to what visitors see,
it is guarded three ways:

1. **Off by default.** `DISCOVERY_PUBLISH_TO_CONFERENCES=1` is required for a non-dry run.
2. **Never overwrites.** The insert is `ON CONFLICT DO NOTHING`: a conference the app has already
   crawled for itself keeps its own, richer record.
3. **High confidence only.** A title, a date, a country, a real official URL, a confidence score
   at or above the threshold, and nothing open in the review queue.

## Environment

Every variable is optional; each one missing degrades a capability rather than breaking anything.

| Variable | Effect |
| --- | --- |
| `DISCOVERY_ADMIN_TOKEN` | Required for the mutating admin routes. Unset means they refuse. |
| `DISCOVERY_CONTACT_EMAIL` | Goes into the crawler's User-Agent so sites can reach a human. |
| `DISCOVERY_USER_AGENT` | Overrides the whole User-Agent string. |
| `DISCOVERY_PUBLISH_TO_CONFERENCES` | `1` allows publication into `extracted_conferences`. |
| `DISCOVERY_SEARCH_PROVIDER` | `1` lets discovery use the existing Brave/Serper search integration. |
| `DISCOVERY_MIN_REQUEST_INTERVAL_MS` | Politeness floor per domain (default 1200). |
| `DISCOVERY_MAX_CONCURRENT_PER_DOMAIN` | Default 1. |
| `DISCOVERY_FETCH_TIMEOUT_MS`, `DISCOVERY_FETCH_ATTEMPTS`, `DISCOVERY_RETRY_BASE_MS` | Fetch behaviour. |
| `DISCOVERY_MAX_PAGE_BYTES` | Response size cap (default 3 MB). |
| `DISCOVERY_COMMON_CRAWL`, `DISCOVERY_OPENALEX` | Phase 2 provider flags; both are stubs today. |

## API

Read routes need a signed-in account. Mutating routes also need the
`x-discovery-admin-token` header matching `DISCOVERY_ADMIN_TOKEN`.

```
GET  /api/admin/discovery/status
GET  /api/admin/discovery/metrics
GET  /api/admin/discovery/report
GET  /api/admin/discovery/export.csv?years=2027
GET  /api/admin/discovery/events?year=2027&country=Germany&category=Artificial%20Intelligence...
GET  /api/admin/discovery/events/:id          — with sources, per-field provenance and changes
GET  /api/admin/discovery/review-queue
POST /api/admin/discovery/run                 — admin token
POST /api/admin/discovery/domain              — admin token
PATCH /api/admin/discovery/domain/:domain     — admin token
POST /api/admin/discovery/review-queue/:id/resolve  — admin token
POST /api/admin/discovery/publish             — admin token; dry run unless explicitly enabled
```

## Responsible crawling

robots.txt is fetched before anything else on a domain and there is no override flag. A blanket
disallow skips the domain and records the reason; a disallowed path is never requested. Crawl-delay
raises this engine's own per-domain interval but can never lower it. Requests carry an honest
User-Agent that says what this is; nothing here rotates identities, impersonates another crawler,
or works around an access control. A site that refuses is skipped, with the refusal written down.

## Adding a discovery source

Implement `DiscoveryProvider` and register it in `providers/index.ts`. The pipeline does not
change. A provider that cannot run (no key, not built yet) reports `isEnabled(): false` with a
reason, which appears in `/status` rather than failing a run.
