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

## Next Phase 10 slices

- **10.2 Enterprise Identity** — verified organization/domain ownership and optional SSO readiness.
- **10.3 Governance & Data Controls** — controlled exports, retention controls, and admin visibility.
- **10.4 Enterprise Reporting** — organization-level usage and activity reporting.
- **10.5 Enterprise Validation** — end-to-end permissions, audit, and policy smoke tests.
