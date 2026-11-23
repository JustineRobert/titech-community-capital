# Financial E2E evidence — 22 November 2026

## Scope

No database-backed financial E2E was executed in this environment. This document records the narrow pricing/assessment unit evidence and the missing stages explicitly.

## Source/unit results

`npm run check:commercial-core` passed. The static gate checks the implemented fee-rule, fee-assessment, usage-record, pricing calculator and canonical financial-core port files; it also checks BigInt arithmetic, fail-closed pricing, immutable pricing snapshots, idempotency and the injected adapter/session contract.

`npm run test:commercial:core` passed **37/37**. Covered behaviors include:

- Fixed, percentage, fixed-plus-percentage and tiered fee arithmetic.
- Integer minor-unit / BigInt calculations and explicit rounding.
- Minimum/maximum fee caps and tier modes.
- Rejection of unapproved, future, expired and cross-currency rules.
- Ambiguous rule rejection and tenant-scoped pricing resolution.
- Distinct maker/checker and RBAC-required approval.
- Immutable pricing snapshots, tenant idempotency and fingerprint conflict detection.
- Rejection of incomplete/untrusted billable events.
- Financial adapter rejection when canonical posting is not injected or an active MongoDB transaction session is absent.

These tests use controlled repositories/injected functions. They are not evidence of a real MongoDB transaction or posted ledger entry.

## Financial lifecycle status

| Stage | Evidence | Result |
|---|---|---|
| Approved price resolution | FeeRule service and tests | UNIT-TESTED |
| Verified service event ingestion | Usage/assessment unit tests | PARTIAL; producers not adopted across products |
| Fee assessment | Immutable snapshot and idempotency tests | UNIT-TESTED |
| Invoice/receivable | Invoice and repository files are zero-byte/incomplete | BLOCKED |
| Collection instruction | Billing payment service source exists; no complete invoice-collection E2E | BLOCKED |
| Provider outcome | No sandbox credentials/callback evidence supplied | NOT VERIFIED |
| Settlement evidence | Revenue settlement files are zero-byte | BLOCKED |
| Canonical financial transaction | Adapter contract requires actual injected function/session | NOT VERIFIED |
| Double-entry journal | No DB transaction/journal E2E | NOT VERIFIED |
| Reversal | Revenue reversal source is zero-byte | BLOCKED |
| Reconciliation | No billing reconciliation lifecycle E2E | NOT VERIFIED |

## Database and provider constraints

`mongod`, `mongosh`, `redis-server`, `redis-cli`, Docker and Podman are unavailable. No MongoDB URI, replica set, isolated test database, Redis service or provider credentials were available. No real MTN MoMo, Airtel Money or bank request was made. No settlement, receipt, invoice payment or revenue record was fabricated.

## 22 zero-byte commercial files

The following files were empty in the supplied archive and are lifecycle gaps, not safe extension points to fill with guessed method contracts during a source-only run:

- `backend/commercial/bridges/canonicalBillingRepository.bridge.js`
- `backend/commercial/config/billingCutover.config.js`
- `backend/commercial/config/billingRuntime.js`
- `backend/commercial/models/RevenueEntry.js`
- `backend/commercial/models/RevenueSettlement.js`
- `backend/commercial/models/billingPlan.model.js`
- `backend/commercial/models/entitlement.model.js`
- `backend/commercial/models/invoice.model.js`
- `backend/commercial/models/invoiceItem.model.js`
- `backend/commercial/models/subscription.model.js`
- `backend/commercial/models/subscriptionItem.model.js`
- `backend/commercial/repositories/billingRepository.js`
- `backend/commercial/repositories/revenueEntry.repository.js`
- `backend/commercial/repositories/revenueSettlement.repository.js`
- `backend/commercial/services/billing/billingInvoice.service.js`
- `backend/commercial/services/billing/saasBilling.service.js`
- `backend/commercial/services/saas/billingPlan.service.js`
- `backend/commercial/services/saas/index.js`
- `backend/commercial/services/saas/subscription.service.js`
- `backend/commercial/services/transactionRevenue/revenueEntry.service.js`
- `backend/commercial/services/transactionRevenue/revenueReversal.service.js`
- `backend/commercial/services/transactionRevenue/settlement.service.js`

## Required next proof

Use a supported Node/npm runtime and isolated MongoDB replica set; register real models/indexes through the repository registry; inject only inspected canonical financial function contracts; test assessment→invoice→collection→provider verification→canonical transaction→balanced journal→settlement→reconciliation, including duplicates, UNKNOWN outcomes, rollback, reversals and concurrent billing runs. Keep live collection disabled until finance/legal policy and provider/partner evidence are approved.
