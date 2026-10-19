# TITech Community Capital — Offline Synchronization Contract

**Organization:** TITech Capital LTD  
**Product:** TITech Community Capital  
**Contract version:** 1  
**Implementation status:** Implemented boundary; **NOT READY** for event processing

## Canonical route contract

The frontend's canonical synchronization endpoint is `POST /api/v1/offline/sync`. The corresponding status endpoint is `GET /api/v1/offline/sync/status`. The existing `POST /api/v1/offline/events/sync` route is a compatibility alias and must not be used for new clients. The existing reconciliation endpoint is `POST /api/v1/offline/sync/reconcile`.

These routes are mounted through the canonical API registry behind the existing authenticated and tenant-authorized middleware. The `X-Tenant-ID` header is never an authority for tenant selection. If supplied, it is checked only for consistency with server-established tenant context.

## Required controls

- Authenticated platform user/session, canonical tenant context, and the `offline:sync:submit` action permission.
- `TITECH_OFFLINE_SYNC_ENABLED=true` for sync submission and `TITECH_OFFLINE_RECONCILIATION_ENABLED=true` for reconciliation. Both flags are **false** in the example environment.
- Registered device credentials: `X-Device-ID`, `X-Device-Fingerprint`, and `X-Device-Secret`; optional registered key identity is sent as `X-Device-Key-ID`.
- A valid `Idempotency-Key`, request/correlation IDs where available, bounded event batches, a supported event version, and a matching SHA-256 event hash.
- A green service readiness contract: `ready === true`, `readiness.ready === true`, `readiness.status === 'READY'`, and an empty blocker array.
- Durable idempotency reservation, device registration and signature verification, receipt/persistence wiring, reconciliation, transaction boundary, and an atomic financial processor for financial events.

The device secret is consumed in the server process for authentication. It must not be logged, included in the audit payload, stored in IndexedDB event records, or forwarded to domain event handlers. Device-secret authentication alone is **not** proof of a per-event public-key signature or a person's intent.

## Event integrity

The event uses `eventVersion: 1`. The SHA-256 hash is calculated over recursively key-sorted JSON after removing `eventHash` and the defined mutable outbox delivery fields (`status`, `attempts`, `createdAt`, `updatedAt`, `lastError`). No arbitrary unknown fields are silently discarded; a protected-field edit or unexpected field changes the hash contract and is rejected. See `docs/architecture/offline-event-integrity.md`.

The golden-vector test proves that the current browser builder and backend validator produce the same hash for the exercised cases, including reordered nested object keys, a non-ASCII name, delivery-metadata changes, tampering, unknown fields and unsupported event versions. This is not a substitute for a formal cross-language canonical-JSON specification, per-event signature proof, or key-registration lifecycle.

## Request and response meaning

The request body is a bounded object with a non-empty `events` array and optional `cursor`. Each event must have the supported event version and required ID/type/tenant/device and idempotency metadata. Authoritative tenant and user IDs come from authenticated server context. A client event cannot set an authoritative balance, ledger state, transaction settlement state, or trusted tenant context.

An HTTP acceptance response would mean only that the service durably accepted the event according to the final implemented contract. It must never be interpreted as payment settlement or ledger commitment unless the authoritative transaction result confirms that state. Partial batches must return explicit per-event outcomes.

## Current fail-closed state

The routes intentionally return `503 OFFLINE_SYNC_NOT_READY` until the service and its collaborators satisfy the readiness contract. At this snapshot, the durable cursor/idempotency adapter, registered-key per-event signature verifier, fully wired receipt/reconciliation adapters, and atomic financial sync processor are not proven configured. Live USSD/payment-provider sandbox evidence, production database transaction tests, and browser offline/reconnect E2E are also unavailable. Do not enable the flags in a production environment to work around these blockers.

## Retry and conflict policy

Use the same event ID and logical idempotency key for retries. Never generate a fresh financial command merely because an acknowledgement was lost. Reuse of an event ID with altered immutable content must be rejected. Financial conflicts must not use last-write-wins; retain evidence and route authorized resolution through the appropriate domain workflow. Uncertain provider outcomes remain pending/indeterminate until reconciled.
