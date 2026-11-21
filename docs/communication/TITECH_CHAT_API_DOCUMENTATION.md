# TITech Chat API — current availability and contract notes

## Current availability

No authenticated member-to-member Chat API is mounted in the canonical `backend/routes/index.js` route registry in the supplied archive. Therefore there are no verified operational Chat API endpoints to document as available. The legacy `backend/routes/chat.js` and `backend/routes/chatRoutes.js` files are not mounted and contain incompatible/legacy dependencies. Do not integrate a client against them as though they were live.

## Target contract

The API resources and event names described in `TITECH_CHAT_IMPLEMENTATION_SPEC.md` are proposed integration contracts only. They require implementation in the canonical ESM module, use of canonical auth/tenant/RBAC middleware, request validation, service/repository boundaries, audit/outbox integration, and route tests before publication.

## Error and state requirements

- `401` for missing/expired session; socket session must be revoked on expiration/revocation.
- `403` for authenticated but disallowed operation (or indistinguishable `404` where resource enumeration is a concern).
- `404` for absent or cross-tenant conversation/message/attachment.
- `409` for an idempotency conflict with a different request body.
- `422` for invalid message/attachment payload.
- `429` for bounded rate-limit enforcement.
- `503` when required persistence/queue dependency is unavailable; do not claim delivery.

Message delivery states should distinguish local pending, server accepted, delivered, read and failed. No status should be inferred from the browser's optimistic state.
