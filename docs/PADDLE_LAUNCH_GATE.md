# Paddle commercial launch gate

Paid billing remains pending. This checklist does not approve legal terms, create provider
products, charge cards or establish that Paddle business/domain verification passed.

## Subscription webhook protection

The Paddle endpoint handles software subscription state only. A signed one-off transaction,
including one containing `conferencegate_deal_id`, cannot mark a sponsorship deal paid,
create a marketplace payment or produce an organizer payout. Marketplace settlement requires
a separate approved integration with verified amount, currency and parties.

Subscriptions retain exact role/price binding and authenticated signatures. State, subscription
identity, ordering watermark and provider-event record commit in one database transaction.
Older events cannot restore access after cancellation or a past-due transition. Equal timestamp
conflicts prefer the more restrictive state. Delayed events from a different subscription cannot
replace the currently bound subscription; a newer `subscription.created` establishes a replacement.
Subscribe to at least `subscription.created` and `subscription.updated` on the Paddle destination.

The state watermark is additive. Reconcile any pre-existing Paddle subscription against the
provider before activation, because historical events did not retain a source ordering watermark.
Do not assume the first newly observed webhook proves historic state is current.

`scripts/smokeBillingWebhooks.mjs` exercises signature/replay-time rejection, role/product
mismatch, event idempotency, past-due access removal, cancellation, out-of-order events,
concurrent conflicting events, replacement identity and marketplace isolation in a disposable
local database. It does not call Paddle, use a real card or certify sandbox checkout.

## Required before enabling checkout

- [ ] Complete Paddle business identity review and approve every checkout domain/subdomain.
- [ ] Obtain owner/legal approval for Pricing, FAQ, Privacy, Terms and Refund/Cancellation text.
- [ ] Create software products and recurring monthly USD prices: Organizer 39.00; Sponsor 55.00.
- [ ] Confirm taxes, recurrence, included service limits and cancellation timing at checkout.
- [ ] Configure a sandbox-only API key, exact role price IDs and signed webhook secret using
      secret storage. Verify `PADDLE_ENV=sandbox`; no live credential belongs in these tests.
- [ ] Configure the notification destination for created/updated events and test provider retries.
- [ ] Run actual sandbox checkout for both roles, then verify subscription and price/customer
      identities, trial/active access, renewal, payment failure, past due, pause and cancellation.
- [ ] Complete a sandbox refund and verify the resulting subscription/access policy explicitly.
- [ ] Provide authenticated customer billing management and cancellation access, preferably
      Paddle's customer portal. This application currently lacks a completed portal integration.
- [ ] Implement and exercise reconciliation for missed webhooks against Paddle's source of truth.
- [ ] Test access for workspace owner/member/viewer and unrelated accounts on both desktop/mobile.
- [ ] Confirm database backup and a restore drill, monitoring, support ownership and release rollback.
- [ ] Obtain explicit authorization to activate real charges only after the above evidence is recorded.

Official references reviewed 28 October 2026:
- https://developer.paddle.com/webhooks/about/how-webhooks-work/
- https://developer.paddle.com/build/subscriptions/provision-access-webhooks/
- https://www.paddle.com/help/start/account-verification/what-is-domain-verification

Provider event acknowledgement does not establish checkout, money movement or legal approval.
