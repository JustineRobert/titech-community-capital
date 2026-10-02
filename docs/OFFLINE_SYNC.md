# Offline Synchronization

Offline state is never financial finality. The supported lifecycle is LOCAL_ONLY → PENDING_SYNC → SYNCING → SERVER_ACCEPTED/SERVER_REJECTED → CONFIRMATION/CONFLICT/REQUIRES_REVIEW.

Operations use durable local queues, deterministic IDs, idempotency keys, retries, conflict detection and user-visible synchronization state. A local queue entry is not a final settlement.

## 2026-09-22 financial-state rule

Offline workflow states are explicit:

`LOCAL_ONLY`, `PENDING_SYNC`, `SYNCING`, `SERVER_ACCEPTED`, `SERVER_REJECTED`, `CONFLICT`, `REQUIRES_REVIEW`, `CONFIRMED`.

`LOCAL_ONLY` and `PENDING_SYNC` are never financial settlement states. A device may record intent offline, but server acceptance and provider/ledger finality must be confirmed before the UI presents money as settled.
