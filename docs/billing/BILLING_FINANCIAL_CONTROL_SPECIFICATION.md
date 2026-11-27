# Billing financial-control specification

## Non-negotiable segregation

SaaS subscription charges belong to the commercial relationship between an institution and TITECH CAPITAL - SMC LTD. Community savings, member contributions, group balances, loans and member transactions belong to institutional/community financial operations. Billing code must never write to those community financial domains.

## Current implementation

- The new routes are read-only.
- Aggregated invoice amounts are grouped by ISO-style currency code and never summed across currencies.
- MongoDB Decimal128 values are rendered as exact strings; frontend does not calculate financial totals.
- Payment records are labelled as records/statuses, not as settled cash.
- MRR, ARR, recognized revenue and settled cash are returned as `NOT_AVAILABLE`.
- No invoice issuance, allocation, receipt, refund or ledger posting is present in this increment.
- `productionApproved=false` is preserved.

## Required controls before financial writes

1. Distinct platform-owned billing account and chart-of-account mapping approved by finance.
2. Existing canonical financial-core transaction and journal APIs injected through the established adapter; no new ledger.
3. Session-bound atomic write for billing record, journal and outbox/receipt side effects.
4. Exact integer minor units or canonical Decimal128 arithmetic, explicit currency and approved rounding policy.
5. Idempotency keys for invoice issuance, payment initiation, callback processing, allocation, posting, reversal and refund.
6. Double-entry balance and ownership invariants verified before commit.
7. Maker/checker separation for sensitive pricing, refunds and adjustments.
8. Reversal/correction workflows preserve original invoice, payment and journal history.
9. SaaS billing postings must never create SACCO savings, member deposits, loan repayments or community-wallet mutations.
10. Reconciliation must compare independent provider/settlement evidence to canonical internal records.

## Accounting and tax caveat

No accounting treatment, revenue recognition, tax rate, IFRS compliance, licensing or statutory correctness is asserted. Qualified accounting/legal review and relevant authority approvals are required before use.
