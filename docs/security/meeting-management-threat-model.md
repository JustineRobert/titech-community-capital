# Meeting Management, Video and Offline Draft Threat Model

## Assets and trust boundaries

Assets include meeting rosters and invitations, restricted minutes, attendance evidence, decisions, actions, provider room grants, offline drafts, audit history and tenant membership. Trust boundaries are the authenticated browser, canonical API gateway/middleware, tenant-scoped domain service/database, browser IndexedDB, and Daily's external service.

## Controls implemented in this snapshot

- Canonical authenticated and tenant-authorized API route; action-specific RBAC middleware.
- Tenant-scoped model queries and organizer/invitee-aware reads.
- Allowlisted editable properties; meeting participants cannot be injected through create payload; invitees are validated against active canonical user/member identity and tenant.
- Lifecycle transition checks, revision compare-and-set and cancellation-reason requirement.
- Deduplicated identity-based attendance recording with explicit provisional status.
- No inferred quorum, formal election integrity or legal identity proof.
- Server-only provider API key, validated Daily domain, private rooms, short-lived room-specific join grants, sanitized provider errors, bounded provider request timeout, recording/transcription not enabled.
- Offline minutes draft only, local-versus-server status distinction, event operation restricted to `MINUTES_DRAFTED`, actor match from authenticated context, operation/revision idempotency guarded by the canonical meeting model.
- Existing offline synchronization's readiness, device verification, idempotency and financial-boundary checks are not bypassed.
- Theme values use the established official design tokens.

## Residual risks / required validation

1. No authenticated HTTP integration test or independent security review has been performed here; tenant-IDOR, RBAC, CSRF/cookie interaction, rate limits, injection, race behavior and provider abuse must be tested in the full installed environment.
2. Offline IndexedDB is not encrypted; shared/lost devices and logout cleanup need policy/acceptance and real browser validation. Do not cache restricted minutes on unmanaged shared devices.
3. Daily sandbox credentials were unavailable; room creation, client join flow, media, expiry, cross-user denial and provider plan limits are not verified. Provider webhooks are not implemented. Avoid claiming verified attendance from client events.
4. Formal voting, quorum, secret ballot, proxy rules, records retention and sector-specific validity are not implemented as legal conclusions. Obtain governance and qualified legal/privacy advice as applicable.
5. Sync readiness remains blocked unless canonical durable idempotency, device registration/signature verification, database transaction boundaries, receipt/reconciliation and deployment dependencies are active and tested. Offline financial events must remain disabled.
6. No recording/transcription flow is implemented; do not enable recording via provider console without an approved notice/consent, retention and access-control policy.

## Threats to exercise before pilot

- Cross-tenant list/get/update/invite/attendance/minutes/video requests; stale membership and revoked roles.
- Malicious mass-assignment of tenant, organizer, status, provider room or applied-operation fields.
- Concurrent revisions, duplicate and out-of-order state transitions, duplicate attendance, stale offline revisions and replay after commit/lost response.
- Unauthorized room creation/join, token expiry, invalid provider domain, quota/rate-limit/timeout failures and malicious provider response fields.
- Stored XSS in titles/minutes/agenda, CSRF, invitation abuse, unsafe document references, excessive listing, log injection and sensitive error leakage.
- Browser storage denial/quota exhaustion, reload while offline, user/tenant switch, logout, storage corruption, revoked access before sync and sync conflict recovery.

## Risk decision

This implementation is not a security certification. Current evidence supports focused Node policy/adapter and static checks only. Do not deploy broadly or approve a pilot until authenticated API, database, browser, provider and independent security tests pass and residual risks are explicitly accepted by the authorized owner.
