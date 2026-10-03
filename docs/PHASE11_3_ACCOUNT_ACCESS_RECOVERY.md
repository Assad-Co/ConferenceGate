# Phase 11.3 — Account Access & Recovery

Phase 11.3 makes ConferenceGate authentication usable without operator intervention.

## User experience

- Sign In keeps the entered email when switching to Join Now or password recovery.
- Password fields include show/hide controls.
- Join Now displays live password requirements and detects an existing account with direct Sign In / Reset Password actions.
- OAuth buttons are shown only when the corresponding provider is actually configured.
- Google Sign-In now uses the server-verified OAuth client ID instead of a separately compiled frontend value, avoiding client-ID drift.
- Forgot Password uses a generic response so it does not reveal whether an email address has a ConferenceGate account.
- Password-reset links are one-time, expire after 30 minutes, and the raw token is placed in the URL fragment so it is not sent in normal HTTP request logs.
- Request and confirmation endpoints are rate-limited.

## Production email configuration

Customer password recovery is enabled only when all of these are configured on the production web service:

```text
RESEND_API_KEY=<server-only Resend API key>
PASSWORD_RESET_FROM_EMAIL=ConferenceGate <no-reply@your-verified-domain>
PUBLIC_BASE_URL=https://conferencegate.onrender.com
```

`APP_BASE_URL` is accepted as the base-URL fallback. The From address/domain must be verified with the email provider.

Until email delivery is configured, the Forgot Password control remains hidden rather than presenting a non-functional workflow.

## Security model

- Reset tokens are generated from 32 random bytes.
- Only SHA-256 hashes are persisted.
- Only the newest token for a user remains valid.
- Expired, superseded, or consumed tokens are rejected.
- Successful reset updates only the password hash and preserves profile, role, LinkedIn data, conference activity, billing state, and workspace membership.
- Account-existence responses remain generic on the reset-request endpoint.

## Provider capability endpoint

`GET /api/auth/capabilities` exposes only safe public capability data:

- validated Google Web OAuth client ID, or null;
- whether LinkedIn identity is configured;
- whether password-reset email delivery is configured;
- reset-link TTL.

No OAuth secrets, email API keys, or other credentials are exposed.
