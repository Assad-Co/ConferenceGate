# ConferenceGate

## Git workflow

**Merge to `main` every time.** Finishing a piece of work means it ends up on `main`, not
parked on a branch waiting to be asked about. After committing and pushing the feature branch:

```
git checkout main
git merge --ff-only <branch>
git push origin main
```

Check for divergence first (`git log --oneline HEAD..origin/main` should be empty for a
fast-forward). If `main` has moved on, rebase the branch onto it rather than force-pushing over
anyone's work. Do this without being asked each time — it is a standing instruction.

Don't open a pull request unless it's explicitly requested.

## What this project is careful about

The conference extraction pipeline reads real conference websites and shows what it finds.
The consistent rule across all of it: **never present something the source didn't say.**

- A field the site didn't state is `null`, not a plausible guess.
- An empty section must be distinguishable from a section that couldn't be read. When a fetch
  fails the UI says so, rather than rendering "(0) speakers" as though the conference has none.
- Anything the server derives rather than reads carries its provenance to the screen. Hotel
  distances are the worked example: `distanceSource` is `'published'` (the organiser's own
  figure) or `'estimated'` (a straight-line calculation between geocoded points), and the two
  are labelled differently in the UI.
- A wrong value is worse than no value. Geocoding results implausibly far from the venue are
  discarded rather than displayed.

When adding to the extraction, keep this property — it's the reason the feature is trustworthy.

## How a page gets read

Four routes, tried in order, stopping at the first that yields enough text:

1. **Plain HTTP fetch** — free, handles most conference sites.
2. **Local headless Chromium** (`server/browserFetch.ts`) — free, handles JavaScript-rendered
   pages. Often unavailable on hosts without Chromium's system libraries; disables itself.
3. **Firecrawl** (`server/firecrawl.ts`) — a paid API that renders behind rotating proxies.
   Reads sites that refuse this server outright. Needs `FIRECRAWL_API_KEY`.
4. **The open web** (`gatherFromOpenWeb` in `server.ts`) — when the conference's own site can't
   be read at all, or reads but says almost nothing, its details are gathered from directories,
   listings and trade press instead, and flagged as such.

The ordering is a cost decision: Firecrawl bills per page, so it is only reached once both free
routes have failed on that specific URL. Don't promote it up the chain.

Relevant environment variables, all optional — each one missing degrades a capability rather than
breaking the app:

- `FIRECRAWL_API_KEY` — enables routes 3 and site mapping.
- `PLAYWRIGHT_CHROMIUM_PATH` / `PLAYWRIGHT_BROWSERS_PATH` — point at an existing browser.
- `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` — skip the postinstall browser download.
- `GEOCODE_CONTACT_EMAIL` — identifies this app to OpenStreetMap for hotel distances.

## Testing the extraction

The crawl and merge logic lives inside a closure in `server.ts`, so tests extract the shipped
functions verbatim (brace-matching, then esbuild to strip types) rather than re-implementing
them — a hand-copied paraphrase silently drifts from what ships. See the pattern in the
scratchpad test harnesses: they pull `mergeExtractionResults`, `normalizeHotels`,
`ancestorUrls`, `buildExtractionPrompt` and friends straight out of the source, serve fixture
pages over a real local HTTP server, and make real model calls.

Note that the SSRF guard in `server/urlSafety.ts` blocks loopback addresses, so the full route
can't be pointed at a local test server. Don't weaken it — extract the pieces instead.

## The conference discovery engine

`server/discovery/` finds conferences on its own, rather than waiting for someone to paste a URL
into Discover. It is backend-only: it added no frontend file and changed none.

Same rule as the extraction pipeline above, applied at every stage: a field the source did not
state is `null`, and everything stored carries its provenance — which page supplied it, whether
it was read from structured data, from labelled HTML, or from a model, how confident that was,
and when it was last confirmed (`discovery_event_fields`).

The order of the extraction routes is a cost decision, exactly like the four page readers:
schema.org structured data (free, and the organiser's own machine-readable statement), then
deterministic labelled-HTML parsing (free), then an AI fallback that is capped per run and off by
default. Don't reorder them, and don't reach for the model for something a label already states.

Two things are guarded rather than merely configured:

- **robots.txt has no override.** A blanket disallow skips the domain and records why; a
  disallowed path is never requested. `Crawl-delay` can raise this engine's per-domain interval
  and never lower it.
- **Publication is opt-in.** Discovered conferences live in the `discovery_*` tables. Writing one
  into `extracted_conferences` — which is what makes it visible in Discover — needs
  `DISCOVERY_PUBLISH_TO_CONFERENCES=1`, never overwrites an existing row, and only takes records
  that have a title, a date, a country, a real official URL and nothing open in the review queue.

Deduplication merges on strong agreement, queues the middle ground for review, and leaves weak
matches alone. It never deletes a record because two titles looked alike.

A fetch failure is classified rather than counted (`failureClass.ts`), because a 403, a 404 and a
429 call for three different responses: don't retry and look elsewhere, don't retry but try the
site root, and retry more slowly. The reading cascade follows from that — direct fetch, then the
hosted reader, then an alternate URL on the same site — and a host that refuses three times in a
row is dropped for the rest of the run rather than asked two hundred more times.

Directories are leads. One that yields a conference is read again for its link to the event's own
site, and that site is read too; the directory stays recorded as the directory, the resolved site
becomes a separate source, and a listing is never promoted to official (it sets its canonical link
to itself, so a declared URL is only trusted from a page already believed authoritative or when it
points off-host).

`region` on a discovered event is the state or province a page stated. The world region is
`world_region`, derived from the validated country by table lookup — never asked of a page, never
inferred by a model, and null when the country did not resolve.

Provider spend is gated on measured yield, not on configuration. Brave runs first; Serper runs
only when Brave's strong-candidate count falls short of the run's target, and then only re-asks
the queries Brave answered poorly. Jina is opt-in (`DISCOVERY_JINA_ENABLED=1`) and even then is
reached only for a page the direct fetch could not read (failed, or under 500 characters of text),
only for high-priority candidates, and capped per run. `--max-ai-calls` defaults to 0, so a run is free unless asked otherwise. Every one of those
decisions is reported in the run summary in words, so a cheap run explains itself.

A crawl belongs on a worker, not in the web service — see `render-discovery-worker.yaml`. Both
share one Turso database; `phase1` refuses to start without `TURSO_DATABASE_URL` rather than write
results to a container-local file nothing can read.

Tests are fixture-backed and need no network: `npm run test:discovery`. Fixtures pass
`maxJinaPages: 0` so no test can reach a third-party service or spend anyone's quota. There is also a full
end-to-end rehearsal against a local eleven-site fixture web
(`npx tsx server/discovery/tests/phase1Rehearsal.ts --out <dir>`), which exercises robots
compliance, all four markup styles, cross-domain deduplication and the unchanged-page skip in one
run. The conferences it finds are invented fixtures — its CSV goes to a scratch directory and
never into the repository.
