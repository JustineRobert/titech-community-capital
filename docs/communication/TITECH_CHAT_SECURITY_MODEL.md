# TITech Chat security model and current assessment

## Current assessment

**Status: BLOCKED — static discovery only; no live security assessment or penetration test performed.** The executable gate output is `reports/i18n-human-review/2026-11-21-1146Z/chat-production-gate.json`.

## Required security boundary

- Existing JWT authentication/session handling; no localStorage/sessionStorage bearer-token design.
- User and tenant identity derived from validated server session, never accepted from message/socket payloads.
- Canonical trusted tenant resolution on every REST request.
- RBAC action authorization on every protected operation.
- Conversation membership and linked-entity access revalidated on every read/send/edit/delete/search/attachment access and room join.
- Same tenant filter applied to both Conversation and Message queries.
- Socket event authorization is equivalent to REST authorization.
- Only the existing Socket.IO server; Redis adapter only after configuration, reconnect, and multi-instance tests.
- Payload size and event rate limits, schema validation, output escaping, attachment signature/MIME verification, protected downloads, malware scanning integration, and safe error messages.
- Audit metadata contains actor, tenant, action, identifiers, timestamp, and correlation data, not full message bodies, tokens, or file contents.

## Confirmed source-level risks

1. A legacy room manager joins a client-selected room without an authorization callback.
2. Legacy Chat message service omits the `tenantId` required by the canonical Message schema and reads by conversation ID without explicit tenant scoping.
3. Legacy Chat services use CommonJS `require()` inside the backend ESM package.
4. A second legacy realtime file constructs a new Socket.IO server rather than attaching to the canonical server.
5. The current Chat route/workspace is not integrated; there is no live authenticated Chat path whose access policy could be independently tested.

## Security regression suite required before release

BOLA/BFLA, cross-tenant reads/search/room joins, removed-member revocation, session expiry on existing sockets, socket room hijacking, XSS/HTML injection, CSRF where applicable, attachment path traversal/MIME spoofing/unauthorized download, rate-limit bypass, notification leakage, logs containing private content, and concurrent idempotency/retry cases.

No source-level or mocked check substitutes for authenticated API tests against a real test MongoDB service, real Redis/Socket.IO tests, or independent penetration testing.
