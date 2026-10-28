# ConferenceGate alert email operations

The administrator diagnostics panel is in Discover, beneath the test-email control.
It requires a signed-in owner account on the server; ordinary accounts cannot read it.
Configuration health contains only booleans. SMTP passwords, usernames, unsubscribe secrets,
recipient addresses and message contents are excluded from diagnostics and queue logs.
The test response names the signed-in recipient only to that user.

## Evidence and status

- `queued`: persisted in Turso/SQLite before any SMTP connection.
- `sending`: an atomic claim belongs to one worker for at most two minutes.
- `accepted`: the provider explicitly accepted the recipient. This is **not** proof of inbox delivery.
- `retry`: a confirmed temporary rejection or failure before message submission. Backoff is
  1, 2, 4, 8 minutes, then failure after the fifth attempt.
- `failed`: permanent rejection or exhausted retries.
- `uncertain`: interrupted worker or ambiguous failure after SMTP DATA. No automatic resend,
  because SMTP cannot guarantee exactly-once delivery. Reconcile using the request/message ID.
- `cancelled`: account no longer exists or the user disabled alert email before submission.

No provider webhook integration is claimed. `bounced` and `delivered` must only be introduced
when authenticated provider events are available. Keep operator/user-confirmed inbox receipt
as separate evidence. Never derive delivered from accepted or a successful HTTP response.

## Runtime

The web service starts an independent queue worker after additive schema initialization.
It runs every minute even with no browser open. The existing matching scheduler remains
controlled by `INTELLIGENCE_BACKGROUND_ALERTS=enabled`. SMTP sending is controlled by
`INTELLIGENCE_EMAIL_NOTIFICATIONS=enabled`; disabling it preserves queued records.
All SMTP settings and the unsubscribe secret must be configured. TLS/certificate verification
remain enabled, with bounded connection, greeting and socket timeouts.

The worker claims at most 20 messages per tick. Alert identity is unique per user/alert,
including across deployments and concurrent instances. The worker respects legacy `sent`
and `sending` rows, avoiding replay during migration. Legacy ambiguous rows need manual
provider reconciliation. This implementation is for conference-matching alerts; account
recovery and organizer PDF mail retain their separate Resend integrations.

Test emails are synchronous and persist an opaque request ID, sanitized error code and outcome.
An explicit failure permits another test after 30 seconds; accepted, in-flight and uncertain
attempts retain the ten-minute abuse limit. Concurrent requests cannot bypass the claim.

## Operational response

Queue diagnostics flag failures, uncertain sends and work waiting more than 15 minutes.
The worker emits a structured warning for those conditions. Route these warnings through
the existing operations log monitoring; external paging is not configured by this release.
Do not use this failing SMTP channel as the sole failure-alert channel.

Before resending an uncertain request, check the provider's logs and the intended mailbox
using its stable Message-ID. Do not reset statuses blindly. After a configuration/DNS change,
send to an authorized inbox and inspect the receiving provider's authentication headers.

On 28 October 2026, an authorized Gmail test reached INBOX. Gmail reported SPF pass but
DKIM permerror (missing `default` selector key for conferencegate.com). DNS lookup also found
no DMARC record. The mail host must supply the correct DKIM public key; never invent it.
Publish a reviewed DMARC policy with an actual monitored reporting destination, after checking
all legitimate senders. Do not publish strict enforcement before alignment is verified.

## Acceptance

`node --import tsx --test server/tests/intelligenceOutbox.test.ts` requires `NODE_ENV=test`
and an explicit isolated `TEST_DATABASE_PATH`. It covers concurrency, backoff, ambiguous
failures, interrupted workers, unsubscribe, legacy deduplication, redaction, cooldown and origins.
After building, `node scripts/smokeEmailDiagnostics.mjs` exercises authenticated HTTP routes,
administrator restrictions, cross-account history isolation and a local refused SMTP connection.
It cannot connect to a real SMTP provider and never uses production data.
