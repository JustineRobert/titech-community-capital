# TITech Chat operations runbook — current blocked state

## Availability status

TITech Chat is not currently enabled as a verified authenticated member-to-member communication module. Do not enable a feature flag or mount the legacy route files as a workaround. The route and service modules have not passed the canonical ESM/auth/tenant integration gate.

## Environment requirements for the next execution

- Node.js `>=24.15.0` and npm `>=11.0.0`.
- Clean dependency install using checked-in lockfiles.
- Test MongoDB deployment configured for the transaction semantics used by the final service.
- Redis service with the approved Socket.IO adapter, bounded event/queue behavior, and multi-instance test if horizontal scaling is intended.
- Authenticated test users in at least two test tenants and several test roles.
- Playwright browser/runtime and screenshot artifact storage.
- Malware scanner and private object storage before production attachment enablement.

## Next safe remediation sequence

1. Consolidate duplicate Chat CJS files and convert the selected canonical module to ESM using the existing project pattern.
2. Reconcile Conversation tenant ObjectId and Message tenant String representation through an explicit schema/migration decision; do not silently coerce IDs.
3. Implement tenant-scoped participant/member repository methods and same-tenant direct-conversation creation.
4. Add canonical Chat routes behind authentication and trusted tenant middleware; add action permissions to the existing RBAC registry.
5. Attach Chat handlers to the existing `createSocketServer()` instance and enforce tenant/member authorization on every room join/event.
6. Add Redis adapter and idempotent outbox/retry behavior only with real service configuration and integration evidence.
7. Register the protected React workspace; retain `/chat-with-titech` as the separate public guided contact page.
8. Run actual MongoDB/Redis integration tests, multi-context Playwright E2E, security tests, accessibility checks and mobile responsiveness checks.
9. Keep Chat production status blocked until all critical checks have execution evidence.

## Monitoring targets (to instrument after the service is enabled)

Active authenticated sockets, socket auth failures, room authorization denials, persisted message latency, server acknowledgement latency, delivery/read latency, idempotency duplicate count, outbox backlog/dead letters, Redis adapter health, reconnect/replay counts, notification failures, attachment scanning failures and tenant-scoped API error rates. Never log message bodies, tokens, or attachment content.
