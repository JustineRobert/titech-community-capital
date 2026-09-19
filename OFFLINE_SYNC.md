# Offline Synchronization

Offline state is never financial finality. The supported lifecycle is LOCAL_ONLY → PENDING_SYNC → SYNCING → SERVER_ACCEPTED/SERVER_REJECTED → CONFIRMATION/CONFLICT/REQUIRES_REVIEW.

Operations use durable local queues, deterministic IDs, idempotency keys, retries, conflict detection and user-visible synchronization state. A local queue entry is not a final settlement.
