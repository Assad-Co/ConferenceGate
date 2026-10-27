# Conference intelligence suite

## Entry points and scope

Professional accounts: Discover → Open intelligence workspace. My Conferences also opens the personal planning dashboard. Existing discovery remains the default and reappears when the intelligence workspace closes.

Organizer/Sponsor insights mount only inside the existing `hasPaidAccess` branches. Their existing server APIs still enforce workspace access. Public signup, entitlements, pricing, payment providers, recovery logic and database schema are unchanged. Nothing publishes a conference, sends an email, starts a crawl, changes an official submission/attendance record or initiates a purchase.

| Requested feature | Delivered behavior | Practical limit |
| --- | --- | --- |
| 1. Conference matchmaker | Scores profile expertise, research interests, keywords and preferred locations; expands a documented set of topic synonyms and explains each contribution | Explainable deterministic matching, not an LLM or trained embedding model; no AI-provider calls |
| 2. Verified conference intelligence | Stored per-field source links, confidence labels, source conflicts, available extraction timestamps, missing data, and official-site/third-party distinctions | Source evidence is not independent organizer verification; unknown timestamps stay unknown |
| 3. Smart search | All positive concepts required, quoted phrases, negative terms, topic synonyms, country, start-date window and reported-open CFP filter | Operates on the current stored catalogue snapshot; it never crawls from the browser |
| 4. Conference quality score | Transparent ten-field information-readiness score with the recorded/missing contribution of each field | A conference's scientific quality or legitimacy is not certified by metadata completeness |
| 7. Abstract & CFP intelligence | Strict deadline validation, passed/closed/conflicting status, source requirements/topics/length/review/template/submission links, private word count and topic-overlap check | No invented deadlines, scientific peer review, acceptance predictions or automatic submissions; ambiguous deadlines require source confirmation |
| 8. Fraud detection | Non-destructive risk screening of link schemes/credentials/HTTPS/IDN hosts, organizer identity gaps, invalid/reversed dates, conflicting sources and unreachable official-source evidence | Heuristics only; no fraud registry integration or identity investigation. No flags is not clearance |
| 9. Professional opportunity matching | Ranks explicit organizer-published committee, chair, speaker and reviewer calls against expertise/interests; includes availability/workload context and routes to the existing response workspace | Never infers vacancies or volunteers/applies automatically |
| 10. Global intelligence map | Lazy-loaded Natural Earth world map, country counts, click/keyboard filters, equivalent country list and unknown/unmapped disclosure | Country coverage, not venue coordinates; small countries/territories absent from 110m geometry remain in the list |
| 11. Smart alerts | Account-scoped saved queries with exact search exclusions/date/country/CFP filters; new/changed result notifications; pause/remove/read actions; deduplication | Browser-local storage; checks every five minutes while the workspace is open and visible. No email, push, offline worker or cross-device sync |
| 12. Planning dashboard | Personal progress, target dates, notes, checklist, due-soon guidance, JSON plan export and safely escaped all-day ICS event export | Browser-local; personal statuses never update official registration/submission/attendance records |
| 13. Organizer intelligence | Own-conference readiness, submission/review/acceptance/registration counts, missing guidelines and overdue-CFP actions | Existing paid gate retained. Counts are observed, not revenue/attendance forecasts |
| 14. Sponsor opportunity matching | Existing server-ranked organizer-published inventory with configured preferences, reasons and per-dimension breakdown; active/deadline filtering | Paid gate retained. No generated inventory, guaranteed ROI, unpublished platform prices or automatic inquiries |

Features 5, 6 and 15 are excluded from this work. The comparison feature already present on main is preserved, not expanded.

## Persistence and privacy

Plans, rules and alert history use `conferencegate:intelligence:v1:<encoded-account-id>` in localStorage. Data is versioned and bounded (100 plans, 20 rules, 100 visible alerts); malformed envelopes are preserved rather than silently overwritten. Storage errors are shown. Browser storage is not encryption: avoid confidential notes on shared devices. Switching accounts reads a different key. Abstract text is transient React state, never sent to a provider or stored by this feature.

Alert checks use the existing stored-data GET search API. Event details use the existing cached extraction GET API. The existing role-specific APIs remain unchanged. Source and external links reject non-HTTP(S) schemes and embedded credentials. React renders source wording as text. Calendar content escapes CR/LF, backslashes, commas and semicolons, folds long lines, and uses an exclusive all-day end date. Invalid or reversed dates cannot be exported.

Map data is derived from Natural Earth's public-domain `ne_110m_admin_0_countries.geojson`, obtained from the upstream `nvkelso/natural-earth-vector` repository. Geometry is equirectangular and illustrative; boundaries are not policy statements. Source: https://www.naturalearthdata.com/about/terms-of-use/

## Validation

- `npx tsx --test src/intelligence/engine.test.ts`
- Clean `npm run build`, then `npx tsc -p tsconfig.check.json --noEmit`
- `node --test scripts/conferenceIntelligenceIntegration.test.mjs` after the build: validates real generated entry points and AST ancestry inside paid-access true branches.
- Existing private-role isolation and organizer/sponsor label regressions.
- Browser acceptance in fresh local SQLite, with Turso/email/provider credentials cleared: professional profile matching, exact search/alert agreement, persistence across reload, country map filters, stored CFP evidence, opportunity feed, private owner-preview insights and public-role denials.

The build integration runs after existing legacy source generators. Only the authored feature files, integration, workflow test step and this document belong in the change. Do not commit catalogue rewrites or unrelated build-generated source changes.

Independent quality certification, fraud investigations, trained-model recommendations and reliable background/cross-device alert delivery remain separate product capabilities. They require a defined evidence/verification policy, model evaluation and/or approved persistence/delivery design; this release does not claim to have completed those.
