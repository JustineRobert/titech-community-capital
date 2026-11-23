# Commercial Billing E2E evidence — 22 November 2026

## Decision

**The pricing/usage-assessment foundation is implemented and unit-tested; a complete commercial billing administration centre and financial lifecycle are not implemented or verified.**

## Confirmed foundation

- Versioned tenant-scoped `FeeRule` model with approval/effective-date controls.
- BigInt minor-unit fixed, percentage, fixed-plus-percentage and tiered pricing.
- Tenant-scoped pricing resolver that rejects missing, expired, pending, cross-currency and ambiguous rules.
- Distinct maker/checker approval with an RBAC requirement.
- Usage event validation and durable usage record abstraction.
- Fee assessment persistence contract with immutable pricing snapshot, tenant idempotency and input fingerprint.
- Explicit adapter port to the existing canonical financial core, requiring injected canonical posting functions and a live MongoDB session.
- Legacy billing calculator does not use assumed tariffs, default VAT or a zero-fee fallback.

Evidence: `npm run check:commercial-core` PASS; `npm run test:commercial:core` PASS 37/37.

## Missing integrated capability

- No commercial billing admin API route discovered or mounted.
- No Billing Administration page, institution billing portal or billing route discovered in the React frontend.
- Billing plan, subscription, subscription item and entitlement source files are zero-byte.
- Invoice, invoice line item, billing repository and invoice service source files are zero-byte.
- Revenue entry/reversal/settlement models, repositories and services are zero-byte.
- No evidence of approved plan assignment, subscription lifecycle, entitlement enforcement, invoice issue, credit note, verified collection, canonical journal posting, settlement or billing close.
- Service-wide usage producer adoption is not proven.
- No real administrator/institution browser journey has been executed.

The 22 exact zero-byte files are listed in `FINANCIAL_E2E_EVIDENCE.md`.

## Billing user journeys

| Journey | Status |
|---|---|
| Create/approve price plan | Fee-rule primitive exists; full admin workflow absent |
| Assign/activate subscription | BLOCKED |
| Enforce subscription entitlements | BLOCKED |
| Record usage from approved business producers | PARTIAL; global producer adoption unproven |
| Assess fee | UNIT-TESTED |
| Generate immutable invoice | BLOCKED |
| Create credit note | BLOCKED |
| Collect via verified provider | BLOCKED / NOT VERIFIED |
| Resolve UNKNOWN provider outcome | NOT VERIFIED |
| Post canonical receivable/revenue journal | BLOCKED / NOT VERIFIED |
| Settlement and reconciliation | BLOCKED |
| Institution billing portal | BLOCKED |
| Billing admin dashboards/reports/audit | BLOCKED |

## UI integrity and flags

No billing screen was fabricated and no synthetic revenue, invoice, collections or subscription metrics were introduced. No pricing tariff, tax rate, revenue-recognition rule or accounting map was invented. Commercial cutover remains disabled. Customer funds, savings, deposits, lending capital and insurance premiums remain outside the commercial billing ledger.

## Required next step

First reconcile zero-byte files with actual canonical financial/repository contracts and existing billing migration/legacy cutover. Implement and test one lifecycle at a time with replica-set transactions and audited RBAC, then wire the UI to the real API. Do not charge customers or enable entitlements merely because a UI exists.
