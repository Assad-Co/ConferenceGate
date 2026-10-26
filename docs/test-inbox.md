# Isolated QA email capture

ConferenceGate optionally captures password-reset mail for an exact list of `qa-...@example.invalid` accounts in [Ethereal](https://ethereal.email/). Ethereal is free, does not deliver messages to real recipients, and requires no DNS or payment setup. Its free accounts cannot receive external Resend mail, so the server uses a separate TLS-required SMTP transport for these synthetic addresses.

Real customer addresses always retain the existing Resend flow. Synthetic `example.invalid` mail never falls back to Resend when capture is unavailable. Neither credentials, preview URLs nor reset tokens should be logged. The production capability flag still describes the real customer recovery configuration.

## Configure

1. Provision a free account with Nodemailer's `createTestAccount()` or `scripts/provisionTestInbox.ps1` on Windows. The PowerShell script saves credentials using Windows DPAPI to a gitignored `.env.ethereal.secure.json` file and prints only status. The file is usable only by the same Windows account. Do not commit, share or include it in artifacts.
2. Merge these three service-level Render environment variables, preserving all unrelated variables:
   - `ETHEREAL_TEST_RECIPIENTS`: comma-separated exact synthetic QA addresses, for example `qa-launch-20261025-01@example.invalid`.
   - `ETHEREAL_TEST_USER`: provider-generated SMTP username.
   - `ETHEREAL_TEST_PASSWORD`: provider-generated SMTP password.
3. Deploy and inspect health. The fixed destination is `smtp.ethereal.email:587` with STARTTLS required; certificate validation stays enabled. SMTP logging is disabled.
4. Trigger Forgot password through the UI for the allowlisted synthetic account. Read the captured message in the authenticated Ethereal mailbox or through IMAP over TLS. Preview URLs and reset links are bearer secrets; exclude them from reports/screenshots.
5. Verify the reset page and complete the password change with the account's authorized operator. Check the old session is invalidated, the new credential signs in, and the token cannot be reused. Never use a customer's account.

For Windows DPAPI files, decode credentials only into process memory using `ConvertTo-SecureString` and `System.Net.NetworkCredential`. Supply them directly to the secret configuration or mail client; do not print them or put them on command lines.

`scripts/checkTestInbox.ps1` validates SMTP capture and authenticated IMAP retrieval without printing credentials or message content. Add `-Mode recovery` to exercise an isolated temporary SQLite application through signup, capture, reset, session revocation, new-password login and token-reuse rejection. This mode cannot target production. `scripts/configureTestInboxRender.ps1` optionally prompts for a Render API key without echo and updates the three individual test variables without replacing unrelated settings. Direct entry through the Render dashboard is also supported.

## Limits

This capture path tests application/template generation and SMTP handoff to the sandbox. It does not establish Resend delivery to real inboxes, spam placement, DNS authentication or Google OAuth success. Current professional signup has no verification email, so there is no verification message to capture; this integration does not add a new ownership-verification requirement.

Ethereal accounts are for temporary QA and are not a durable business mailbox. Re-provision and replace only the three test variables if credentials expire. Use a dedicated approved real inbox separately for external delivery/OAuth acceptance. Do not enable paid subscriptions, publish pricing or open organizer/sponsor registration as part of this setup.
