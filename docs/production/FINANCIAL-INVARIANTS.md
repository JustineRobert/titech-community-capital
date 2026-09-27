# TITech Community Capital

# Financial Invariants

The following invariants are release controls:

- Debits equal credits for every posted journal.
- Tenant identity is consistent across a financial operation.
- Currency is consistent across the operation and journal lines.
- Financial persistence writes occur inside an active MongoDB transaction session.
- Idempotency prevents duplicate financial effects.
- Ledger entries are append-only; corrections use explicit reversal/adjustment workflows.
- Balance mutations use the canonical balance repository and atomic update semantics.
- Provider callbacks are authenticated, replay-bounded and state-transition validated.

Source-level evidence exists in `backend/repositories/financial/*`, `backend/services/financial/financialTransaction.service.js`, `backend/services/idempotency/*` and callback/security modules.
