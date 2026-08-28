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

## Testing the extraction

The crawl and merge logic lives inside a closure in `server.ts`, so tests extract the shipped
functions verbatim (brace-matching, then esbuild to strip types) rather than re-implementing
them — a hand-copied paraphrase silently drifts from what ships. See the pattern in the
scratchpad test harnesses: they pull `mergeExtractionResults`, `normalizeHotels`,
`ancestorUrls`, `buildExtractionPrompt` and friends straight out of the source, serve fixture
pages over a real local HTTP server, and make real model calls.

Note that the SSRF guard in `server/urlSafety.ts` blocks loopback addresses, so the full route
can't be pointed at a local test server. Don't weaken it — extract the pieces instead.
