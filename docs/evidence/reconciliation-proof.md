# Reconciliation Proof Register — 2026-10-04

## Purpose

Reconciliation is a first-class control plane, not a reporting afterthought.

## Canonical comparison

`TITech transaction ↔ provider transaction ↔ settlement record ↔ ledger posting ↔ balance`

## Discrepancy classes

- MATCHED
- MISSING_PROVIDER
- MISSING_INTERNAL
- AMOUNT_MISMATCH
- CURRENCY_MISMATCH
- STATUS_MISMATCH
- DUPLICATE
- LATE_SETTLEMENT
- UNKNOWN_REFERENCE
- REVERSAL_MISMATCH

## Source evidence

The archive contains provider reconciliation engines, MTN reconciliation code, payment callback deduplication, settlement state machines, and finance reconciliation services.

## Runtime proof status

`UNPROVEN_RUNTIME`

The archive does not include a live provider statement/settlement run demonstrating exact-match and exception-handling results. Required proof includes recorded inputs, outputs, reconciliation case IDs, owner/severity/status, evidence, resolution and audit history.
