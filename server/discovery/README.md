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
# The whole Phase 1 benchmark in one command: preflight, seed, run, report, CSV, field audit.
# Refuses to crawl if outbound HTTPS is blocked, or if it would write to a database nothing else
# can read. Publishing stays off regardless of any flag.
npm run discovery -- phase1 --out ./phase1 --max-pages 400
```

Or the same steps one at a time:

```bash
npm run discovery -- preflight               # can this machine reach the open web at all?
npm run discovery -- seed                    # load the seed domain registry
npm run discovery -- domains                 # what is registered, and when each is next due
npm run discovery -- run --years 2026,2027,2028 --max-pages 400
npm run discovery -- report                  # quality report
npm run discovery -- export --out discovery_test.csv
npm run discovery -- audit --sample 20       # field accuracy against the real sources
npm run discovery -- publish --dry-run       # what would reach the app's own table
npm run test:discovery                       # 102 fixture-backed tests, no network
```

An end-to-end rehearsal against a local eleven-site fixture web, with no network access at all:

```bash
npx tsx server/discovery/tests/phase1Rehearsal.ts --out /tmp/discovery-rehearsal
```

## Before the first run in a new environment: preflight

```bash
npm run discovery -- preflight                  # the ten seed domains, plus every provider
npm run discovery -- preflight --registry       # whatever is actually in your registry
npm run discovery -- preflight --skip-providers # domains only, spending no provider quota
GET /api/admin/discovery/preflight              # from the deployed server itself
GET /api/admin/discovery/preflight?providers=true
```

It also checks Brave, Serper, Jina, Turso and Gemini with one request each, reporting
`reachable` / `blocked` / `authentication_failed` / `rate_limited` / `timeout` /
`not_configured` — a wrong key, an exhausted plan and a blocked network being three different
problems that look identical in a log which only says "search failed". No credential is ever
printed, returned or logged; provider error text goes through a redactor first.

It asks each domain for its `robots.txt` — one cheap request each, the file a crawler is supposed
to read first anyway — and classifies the answer:

| Verdict | Meaning |
| --- | --- |
| `reachable` | The request left this machine and the site answered. |
| `egress_blocked` | **This machine's own network refused.** The site was never contacted. |
| `dns_failure` | The hostname does not resolve from here. |
| `origin_refused` | The site itself said no (anti-bot, geoblock, 403/429). |
| `robots_disallowed` | The site answered and asked crawlers to stay out; it will be skipped. |
| `timeout` | No answer in time. |

That first distinction is the reason this command exists. A firewall, VPC allowlist or sandbox
answers a forbidden host with a 403 that is indistinguishable, at a glance, from a conference site
refusing a crawler — so a run inside one produces a page of plausible site errors that are really
one infrastructure problem, and the registry backs off ten innocent domains for a week. The engine
now recognises that shape (`looksLikeLocalEgressBlock`), reports it as an infrastructure fault,
does not retry it, and leaves the domain's crawl schedule and failure count untouched.

Preflight exits non-zero when outbound HTTPS is blocked, so it works as a deploy or CI gate.

**A note on proxies:** Node's built-in `fetch` ignores `HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1`
is set (Node ≥ 22.21). If your environment requires a proxy for outbound HTTPS, set that variable
for the worker — preflight says so in its output when it detects the mismatch.

## The provider chain, and what it costs

```
  registry sitemaps (free)  ─┐
  Brave search              ─┤  candidates ─▶ URL de-duplication ─▶ robots check ─▶ direct fetch
  Serper (only if needed)   ─┘                                                          │
                                                    ┌─────────────────────────────────────┘
                                                    ▼
                              schema.org structured data (free, first-hand)
                                                    │ nothing usable?
                                                    ▼
                              deterministic labelled-HTML extraction (free)
                                                    │ page came back thin, or failed?
                                                    ▼
                              Jina hosted reader (capped per run, high-priority pages only)
                                                    │ still missing something important?
                                                    ▼
                              AI fallback (capped, off by default, every value grounded)
```

Three gates stop this becoming an expensive habit:

**Serper is not called just because it is configured.** Brave goes first — the cheaper plan — and
Serper runs only when Brave's *measured* yield of strong candidates falls short of what the run
asked for, or when Brave failed outright. Even then it re-asks only the queries Brave answered
poorly, and stops as soon as the combined yield is enough. The run reports the decision in words
(`serperDecision`), so a run that spent nothing on Serper says why.

**Not every page goes through the reader.** Jina is opt-in (`DISCOVERY_JINA_ENABLED=1`) and even
then is reached only when the direct fetch failed or returned under 500 characters of text — the
signature of a JavaScript shell — and only for candidates that scored highly enough to be worth a
paid read. `--max-jina-pages` caps the run, and pages skipped for the cap are counted rather than
silently dropped. Structured data does not survive markdown, which is another reason this route is
second and not first: a thin page is still handed to the extractors first, because a page with
barely any visible text can still carry a complete JSON-LD block.

**The AI fallback is off unless asked for.** `--max-ai-calls` defaults to 0, so a run is free.

Search-discovered hosts are not in the registry, so their `robots.txt` is fetched on demand, once
per domain, before any page on them is requested. `robotsCheckedOnDemand` counts those, because
"we obey robots.txt" has to hold for every route into the engine, not just the one that starts
from a sitemap.

Search queries are a matrix over the platform's own category taxonomy × a country spread covering
all seven world regions × the target years, with roughly half naming the priority year. The
countries are an explicit input rather than whatever the index happens to rank, which is what
stops search discovery quietly becoming a North-America-and-Europe engine.

## Auditing what was found

```bash
npm run discovery -- audit --sample 20 --out audit.txt
```

Re-fetches a random sample of stored records from the pages they came from and checks all eleven
audited fields against what that page says now:

| Verdict | Meaning |
| --- | --- |
| `confirmed` | Re-extracting the page today produces exactly the stored value. |
| `supported` | The stored value appears verbatim in the page, though re-extraction read it differently. |
| `not_supported` | The page does not contain the stored value — a real error, or a page that changed. |
| `absent` | The record stores null. Nothing was claimed, so nothing can be wrong. |
| `unverifiable` | The page could not be re-read. |

`absent` is never counted as an error — a null is the engine working correctly — and is reported
as *coverage* instead, because a record with eleven nulls is honest and useless. The sample uses
`RANDOM()` rather than confidence order: auditing the twenty most confident records would flatter
the engine, which is the opposite of the point. Every row carries its source URL, because this
produces the evidence for a human audit rather than replacing one.

The audit also flags records that look like test data or bad listings — placeholder titles,
template markup, non-public URLs, implausible date spans — as neutral indicators worth a look,
never as accusations about an organiser.

## Running it on Render

The web service should not crawl: a run is minutes of outbound HTTP competing with real users for
the same event loop. Use a Cron Job (or Background Worker) on the **same repository** and the
**same Turso database** — `render-discovery-worker.yaml` at the repo root carries both a
dashboard recipe and an opt-in blueprint.

```
  ConferenceGate Web Service ──┐
                               ├── Turso (one database)
  Discovery Worker (cron) ─────┘
           │
           ▼
     Public internet
```

`phase1` refuses to start when `TURSO_DATABASE_URL` is unset, because a worker writing to a
container-local SQLite file produces results the web service cannot see and a deploy then deletes
— a run that looks like a success and leaves nothing behind. Pass `--allow-local-db` if a
throwaway run really is what you want.

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
| `preflight.ts` | Connectivity check: is the network, the site, or nothing in the way? |
| `providerHealth.ts` | Brave, Serper, Jina, Turso, Gemini: reachable, or exactly why not. Never a key. |
| `readPage.ts` | The read chain: direct fetch, then the capped hosted-reader fallback. |
| `jinaFetch.ts` | The hosted-reader route itself, and the markdown-to-HTML conversion. |
| `audit.ts` | Field-level audit of real records against their real sources. |
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
| `DISCOVERY_JINA_ENABLED` | `1` allows the hosted reader as a fallback for pages a direct fetch cannot read. |
| `DISCOVERY_MIN_REQUEST_INTERVAL_MS` | Politeness floor per domain (default 1200). |
| `DISCOVERY_MAX_CONCURRENT_PER_DOMAIN` | Default 1. |
| `DISCOVERY_FETCH_TIMEOUT_MS`, `DISCOVERY_FETCH_ATTEMPTS`, `DISCOVERY_RETRY_BASE_MS` | Fetch behaviour. |
| `DISCOVERY_MAX_PAGE_BYTES` | Response size cap (default 3 MB). |
| `DISCOVERY_COMMON_CRAWL`, `DISCOVERY_OPENALEX` | Phase 2 provider flags; both are stubs today. |

## API

Read routes need a signed-in account. Mutating routes also need the
`x-discovery-admin-token` header matching `DISCOVERY_ADMIN_TOKEN`.

```
GET  /api/admin/discovery/preflight            — can this deployment reach the open web?
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
