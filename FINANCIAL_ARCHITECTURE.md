# Financial Architecture

## Golden Money Path

Member contribution → payment initiation → provider adapter → provider response → idempotency → payment state → callback/webhook → transaction state → double-entry ledger → balance projection → reconciliation → receipt → reporting → audit.

## Money invariants

- Authoritative amounts use minor units or deterministic decimal semantics.
- Debit totals must equal credit totals for every balanced journal.
- Historical financial records are never destructively deleted; reversals use compensating entries.
- One idempotency key/operation must produce one financial effect.
- Currency cannot change silently inside a financial lifecycle.

## Evidence limitation

The current remediation establishes source-level structure and syntax but has not executed the complete Golden Money Path or invariant suite.
