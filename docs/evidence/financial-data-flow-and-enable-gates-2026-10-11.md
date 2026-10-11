# Financial Data Flow and Product Enablement Gates — 11 October 2026

## Existing one-off money path (source-observed, not fully E2E proven)

`backend/routes/contributions.js` → `backend/controllers/contributionsController.js` → `processFinancialOperation` in `backend/services/financial/financialTransaction.service.js` and/or `executeFinancialOperation(TRANSACTION_CREATE)` in `backend/services/financial/financialOperation.service.js` → existing `FinancialTransaction` and ledger/accounting implementations → receipt/audit/outbox/reconciliation components where invoked by the selected path. The route registrations and exact transaction/session call graph still require a seeded integration trace; both services and multiple ledger implementations exist, so do not assume every path uses the canonical flow merely from function names.

## Required recurring savings flow before enablement

Persist institution-approved plan and consent/mandate → create unique tenant-scoped due occurrence under a durable uniqueness constraint → claim with bounded lease/worker semantics → validate current consent, account, amount, permissions and provider route → idempotent provider attempt → query after timeout/unknown outcome (never blindly debit again) → prove settled/cleared funds → canonical financial transaction and balanced journal → derived balance → receipt/outbox/audit → reconcile provider/settlement/ledger record and route mismatches to an exception queue.

**Current state:** no dedicated recurring plan/occurrence lifecycle was identified. Do not activate a scheduler or recurring debit.

## Fixed deposits

Current source has `FIXED_DEPOSIT` account classification and maturity/interest fields in `backend/models/Account.js`, but classification is not an opened product. Before activation, require an approved immutable term snapshot, exact arithmetic/day-count/rounding rules, cleared funding evidence, canonical ledger posting, deterministic maturity event, explicit payout/reinvestment instruction, provider payout idempotency, receipt/statement and reconciliation. Early break/tax/fees/renewal remain off unless the institution approves the terms and accounting policy.

## Investment integration

`INVESTMENT` purpose/type and optimizer/roadmap utilities do not establish an authorized issuer/distributor/custodian, actual order, settled holding or redemption. Keep real money movement/actual trading disabled until licensed partner contract, jurisdiction, eligibility/suitability/disclosure/consent, sandbox, valuation/settlement reconciliation, legal review and accountable formal enablement approval are evidenced.

## Non-negotiable invariants

- Server-derived tenant authorization; client-supplied tenant IDs are never authority.
- Financial balance changes only via the existing canonical finance operation/ledger boundary.
- Exact money arithmetic; no binary floating-point for currency.
- Durable unique idempotency at occurrence, provider attempt/event and financial operation boundaries; Redis-only locks are insufficient.
- Posted journals are balanced, append-only and corrected through reversal/adjustment; reconciliation never erases mismatches.
- Provider success callback is not automatically cleared funds/settlement. Unknown provider outcomes must be queried or held for review.
- Product flags are enforced server-side and high-risk paths default off until external and operational gates pass.
