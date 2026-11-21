# TITech Chat — canonical remediation specification

## Status

**Current module state: BLOCKED / partially implemented in source.** This specification is the target integration contract. It does not claim the API, realtime workflow, or reviewer/security acceptance is complete.

## Architecture decision

Reuse the current React/Router application, Express ESM route registry, MongoDB/Mongoose models, Redis service, JWT/HttpOnly refresh-cookie authentication, trusted tenant resolution, canonical RBAC, audit, notification and the single bootstrap-owned Socket.IO server. Do not create a parallel server, application, identity system, database, or permission registry.

Reconcile duplicate Chat source files into one canonical module. Only the canonical module should be imported by the route registry and socket bootstrap. Before mounting, every required import must resolve and execute under ESM.

## Message send path

Authenticated session → trusted tenant context → action permission → tenant-scoped conversation lookup → current participant check → message schema validation → idempotency key → durable tenant-scoped Message persistence → transactional audit/outbox event where deployment supports it → server acknowledgement → socket delivery → recipient delivery/read event → in-app notification.

A message must be durably persisted before the sender receives `SERVER_ACCEPTED`. Network delivery is at-least-once with idempotent persistence and duplicate suppression; do not claim exactly-once network delivery.

## Required REST contract (not currently mounted)

The future canonical route should live below the authenticated/tenant-scoped API prefix. Suggested resources, subject to the canonical router convention:

- `GET /api/v1/chat/conversations` — current user's conversations in the trusted tenant.
- `POST /api/v1/chat/conversations/direct` — find-or-create tenant-scoped direct conversation with validated same-tenant participants.
- `GET /api/v1/chat/conversations/:conversationId` — membership-authorized conversation detail.
- `GET /api/v1/chat/conversations/:conversationId/messages` — tenant/member-scoped cursor pagination.
- `POST /api/v1/chat/conversations/:conversationId/messages` — idempotent durable send.
- `POST /api/v1/chat/messages/:messageId/read` — mark a message/read cursor only for the authenticated recipient.
- `PATCH /api/v1/chat/messages/:messageId` — edit only within policy and authorization.
- `DELETE /api/v1/chat/messages/:messageId` — policy-governed soft delete/redaction.
- `POST /api/v1/chat/conversations/:conversationId/attachments` — protected upload metadata boundary after malware scanning integration exists.
- `GET /api/v1/chat/attachments/:attachmentId` — permission-checked download or short-lived signed URL.

None of these paths is asserted to be available now. The legacy `routes/chat.js` route declarations are not an API contract until corrected, mounted, authenticated, and integration-tested.

## Realtime contract (not currently attached)

Only the existing bootstrap-owned Socket.IO server may be used. Chat handlers are event mirrors, not an alternative write API. Every event must derive user/tenant from the authenticated socket context and revalidate conversation membership. Conversation room joins must be tenant-scoped. Client-provided tenant/user IDs are never authoritative.

Candidate versioned events:

- Client: `chat:v1:conversation:join`, `chat:v1:conversation:leave`, `chat:v1:typing:start`, `chat:v1:typing:stop`, `chat:v1:message:read`.
- Server: `chat:v1:message:accepted`, `chat:v1:message:new`, `chat:v1:message:delivered`, `chat:v1:message:read`, `chat:v1:typing:update`, `chat:v1:unread:update`, `chat:v1:error`.

Message creation should remain REST/service authoritative until an authenticated, idempotent socket command contract is separately approved. Typing/presence state is ephemeral and expires.

## Data integrity

Use the existing canonical tenant-scoped Conversation and Message models only after reconciling Message.tenantId (String) against Conversation.tenantId (ObjectId). Do not cast or migrate tenant identifiers silently. Add/verify a compound tenant/conversation/time index, idempotency uniqueness, and participant lookup index through a reviewed migration. Durable message persistence must survive Redis outages; reconnect retrieves history from MongoDB.

## Financial and institutional boundaries

Chat is not a payment, ledger, loan, savings, payroll, reconciliation, or settlement engine. A message linked to a financial record is only a protected reference. It does not approve a loan, initiate a payment, confirm settlement, change a balance or authorize a financial operation. Refugee/host-community and insurer participants may be admitted only through partner-authorized tenant/role/consent controls; no partner access or insurer permission is implied by implementation.
