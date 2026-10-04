# TITech Financial Invariants — 2026-10-04

## Purpose

This document defines the non-negotiable financial invariants for TITech Community Capital and maps them to the canonical implementation boundary.

## Canonical boundary

`backend/services/financial/financialTransaction.service.js` owns the MongoDB transaction boundary.

`backend/services/financial/financialOperation.service.js` orchestrates the financial mutation inside the supplied transaction session.

`backend/repositories/financial/ledger.repository.js` is the batch ledger persistence boundary.

`backend/services/financial/money.js` is the exact-money utility and uses integer fixed-point arithmetic with `BigInt`.

## Required invariants

| Invariant | Source-level evidence | Runtime status |
|---|---|---|
| Debits equal credits for a balanced journal | Canonical ledger repository + financial static gate | UNPROVEN_RUNTIME |
| Financial mutation is atomic inside one MongoDB transaction | Financial transaction service | UNPROVEN_RUNTIME |
| Duplicate financial effects are blocked by idempotency | Idempotency service + financial boundary | UNPROVEN_RUNTIME |
| Reversal is compensating history, not mutation of history | Financial/payment reversal surfaces | UNPROVEN_RUNTIME |
| Balance cannot be directly mutated by controllers | Canonical service/repository boundary | UNPROVEN_RUNTIME |
| Exact-money arithmetic avoids floating point | `money.js` + executable money tests | STATIC_VERIFIED |
| External provider calls are outside the MongoDB transaction | Financial transaction service contract | STATIC_VERIFIED |

## Static gate

`npm run check:financial` passed against the archive source snapshot.

This is a source-level gate. It is not a substitute for a live MongoDB replica-set test, concurrency test, rollback test, or provider lifecycle test.

## Required runtime proof before production approval

1. MongoDB replica-set commit and rollback evidence.
2. Concurrent posting evidence.
3. Duplicate idempotency-key evidence for same and conflicting payloads.
4. Reversal and reconstruction evidence.
5. Balance rebuild versus ledger replay evidence.
6. Provider settlement and reconciliation evidence.
