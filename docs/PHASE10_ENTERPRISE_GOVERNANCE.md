# Phase 10 — Enterprise Governance & Controls

Phase 10 begins ConferenceGate's enterprise hardening without changing the existing Organizer Pro or Sponsor Pro product structure.

## Phase 10.1 — Workspace Governance

Paid Organizer and Sponsor workspaces now have enterprise access controls:

- approved company email-domain list;
- optional enforcement for newly added team members;
- owner-only policy changes;
- owner/admin visibility;
- full workspace access-audit CSV export;
- every policy change recorded in the existing workspace audit trail.

The domain rule is applied only when adding a new workspace member. Existing members are not silently removed if the policy later changes.

## Security model

- Workspace owners can change enterprise access policy.
- Workspace admins can view policy and export the audit log.
- Members and viewers cannot manage enterprise policy.
- Existing role permissions remain unchanged.
- Manual workspace member changes remain auditable.

## Data model

Phase 10.1 adds one additive table:

```text
account_workspace_enterprise_settings
```

It stores only workspace governance configuration. Existing accounts, team memberships, conferences, sponsorship data, and audit history are preserved.

## Phase 10.2 — Enterprise Identity

Workspace owners can verify control of a company domain without changing the existing ConferenceGate sign-in model.

Verification is DNS-based:

1. the owner enters the company domain;
2. ConferenceGate generates a unique verification token;
3. the owner adds the displayed TXT record under `_conferencegate.<domain>`;
4. ConferenceGate checks public DNS for the exact token;
5. successful verification is stored and audited.

The verification state is shown in Team & Access. A failed DNS check does not change permissions or membership.

This is an identity-readiness layer only. It does not automatically enable SAML/OIDC SSO, change passwords, or take over existing accounts.

## Next Phase 10 slices

- **10.3 Governance & Data Controls** — controlled exports, retention controls, and admin visibility.
- **10.4 Enterprise Reporting** — organization-level usage and activity reporting.
- **10.5 Enterprise Validation** — end-to-end permissions, audit, and policy smoke tests.
