# TITech Community Capital — Golden Money Path

**Status:** IMPLEMENTED + REFERENCE-TESTED; environment/provider verification remains pending
**Date:** 2026-09-23
**Repository:** https://github.com/JustineRobert/titech-community-capital

## Purpose

The Golden Money Path is the minimum coherent financial lifecycle TITech must be able to explain from authenticated request through provider interaction, authoritative financial posting, settlement, reconciliation, receipt and audit.

The repository already contains the canonical orchestration layers. This document binds them together without replacing them.

```text
Member
  -> Authentication / Authorization
  -> Trusted Tenant Context
  -> Financial Validation
  -> Idempotency
  -> Payment Aggregate / Intent Envelope
  -> Provider Adapter
  -> Provider Response / Callback / Status Query
  -> Payment State Machine
  -> Financial Posting / Double-Entry Ledger
  -> Balance Projection
  -> Settlement
  -> Reconciliation
  -> Receipt
  -> Audit / Observability
```

## Canonical ownership

| Concern | Canonical repository authority |
|---|---|
| External payment lifecycle | `backend/models/Payment.js` + `backend/modules/payment/paymentStateMachine.js` |
| Intent persistence envelope | `backend/models/PaymentIntent.js` |
| Money-path orchestration | `backend/modules/payment/goldenMoneyPathService.js` |
| Provider contract | `backend/modules/payment/providerInterface.js` |
| Provider processing | `backend/modules/payment/paymentProcessingService.js` |
| Payment idempotency | `backend/modules/payment/paymentIdempotencyService.js` and existing idempotency services |
| Financial posting | `backend/modules/payment/settlement/ledgerPostingService.js` + canonical finance/ledger services |
| Ledger | `backend/modules/finance/ledger/*` |
| Balance projection | `backend/modules/finance/balance/*` |
| Settlement lifecycle | `backend/modules/payment/settlement/settlementStateMachine.js` |
| Reconciliation | `backend/src/modules/payments/reconciliation/*` and provider-specific reconciliation services |
| Outbox/reliability | `backend/modules/transactions/*` |
| Audit | existing audit modules and financial audit infrastructure |

## Architectural preservation decision

The repository's existing `Payment` aggregate is explicitly designed as the external payment lifecycle authority and is used by the Golden Money Path. The separate `PaymentIntent` model is retained and strengthened as an immutable intent envelope rather than creating a second competing lifecycle authority.

This is deliberate: forcing a wholesale `Payment` -> `PaymentIntent` replacement would create a second financial implementation and increase migration risk. See `docs/architecture/ADR-2026-09-23-CANONICAL-PAYMENT-AUTHORITY.md`.

## State separation

TITech intentionally keeps separate state machines for different financial concerns:

- **Payment state:** provider/payment-operation lifecycle and ambiguity.
- **Settlement state:** accounting/settlement lifecycle.
- **Reconciliation state:** provider-versus-TITech truth comparison.
- **Ledger state:** posting lifecycle.
- **Idempotency state:** request/event replay lifecycle.

These must not be collapsed into a single provider status field.

## Failure rules

### Provider timeout

```text
REQUEST_SENT
  -> TIMEOUT / UNKNOWN
  -> STATUS_QUERY
  -> CONFIRMED_SUCCESS / CONFIRMED_FAILURE / UNKNOWN
```

A timeout never authorizes a blind second financial initiation.

### Duplicate callback

A callback is accepted only once for its provider/event identity. Replays must not create another financial posting.

### Out-of-order callback

A stale external callback must not downgrade an already authoritative successful/settled/reversed payment.

### Reversal

A reversal is a compensating financial operation. The original journal is never edited or deleted.

### Reconciliation mismatch

Mismatch becomes an explicit exception/review condition. The system does not silently alter financial history to make the mismatch disappear.

## Reference proof

`node scripts/golden-money-path-proof.mjs` executes a deterministic provider simulator and verifies:

- UGX 50,000 reference payment
- provider timeout
- process restart and state restoration
- status-query truth recovery
- duplicate callback handling
- out-of-order/stale callback protection
- double-entry balance invariant
- idempotency replay and payload conflict
- tenant isolation
- currency mismatch rejection
- reconciliation mismatch exception
- offline replay idempotency
- compensating reversal
- receipt gating on settlement + reconciliation
- audit event completeness

The proof is **TESTED**, not equivalent to live provider or production-environment certification.
