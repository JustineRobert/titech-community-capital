# Agriculture Offline Synchronization Contract

Agriculture follows the existing TITech offline-first safety model.

## State model

`LOCAL_ONLY → PENDING_SYNC → SYNCING → SERVER_ACCEPTED → CONFIRMED`

Conflict/recovery states are `SERVER_REJECTED`, `CONFLICT`, and `REQUIRES_REVIEW`.

## Required operation metadata

Agriculture operational entities may persist:

- tenant identity
- actor/device identity
- client operation ID
- idempotency key
- payload hash
- schema/version metadata
- synchronization state

## Financial rule

Offline creation is evidence/intention capture. It does not directly mutate balances, finalize settlement, or create ledger truth. Financial finality requires server-side validation, idempotency, the canonical financial transaction boundary, and reconciliation.

## Current implementation status

The backend entity models and frontend dashboard are offline-aware, but live provider-backed synchronization and end-to-end device event replay were not run in this environment because project dependencies/Node 24 were unavailable. This is an evidence boundary, not a claim of production-approved offline settlement.
