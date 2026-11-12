# Execution report — 12 November 2026

**Organization:** TITech Capital SMC LTD  
**Product:** TITech Community Capital  
**Workstream:** Authoritative commercial billing and revenue assurance foundation  
**Result:** Partial remediation delivered; enterprise end-to-end billing is not complete  
**productionApproved:** `false`

## 1. Executive status

A protected working copy was created from the supplied ZIP. The archive's ZIP comment identifies source snapshot `33efc14731788c800b23d0e12ab8393a706ce613`; the archive has no `.git` metadata. Consequently, branch, remotes, working-tree state and parity with live GitHub `main` cannot be proven from the supplied artifact.

The commercial subsystem had 38 zero-byte files out of 50 files under `backend/commercial`. Sixteen of those empty files were populated with a first implementation of exact-money pricing, rule resolution, usage metering, fee assessments, tenant-scoped repositories and a strict adapter boundary to the existing canonical financial core. New focused tests and root-level repeatable commands were added. The focused unit test suite passes **29/29 tests**.

This is not an enterprise complete billing engine. The invoice, subscription, collection, provider verification, revenue-entry, reversal, settlement, reconciliation, entitlement and platform-wide service adoption paths are not proven complete. The existing billing-payment service/model contain code, but this archive does not establish their end-to-end repository, controller, provider and ledger wiring. Those items remain incomplete or not verified.

## 2. Repository identity and protection

- Source: supplied `titech-community-capital-main.zip`.
- ZIP comment/source SHA: `33efc14731788c800b23d0e12ab8393a706ce613`.
- Extracted protected work directory: `titech-community-capital-main/`.
- Git metadata: absent from archive; no claim about branch, `HEAD`, remote or `origin/main` parity.
- Original uploaded ZIP was not modified.
- No commit, push, production deployment or production configuration change was performed.
- A separate output archive was created from the working copy. The original archive SHA-256 is `f387d5b6acf45b02eb1237e627cb9866cef24ef5c9bbc4fe016ec07bc3ab57c7`.

## 3. Baseline and environment

| Check | Result | Meaning |
|---|---|---|
| Node runtime | `v22.16.0` | Below root `.nvmrc` `24.15.0` and declared `>=24.15.0`; official binary provisioning was attempted but the container could not resolve `nodejs.org` |
| npm | `10.9.2` | Below declared `>=11` |
| Dependency installation | Not run | Current runtime is below supported project baseline; no node_modules were present |
| Git branch / remote | Not verifiable | Source ZIP has no `.git` directory |
| Initial zero-byte files | 248 total | Recounted in extracted source |
| Initial commercial zero-byte files | 38 / 50 | Included core pricing/assessment/repository/service gaps |
| Post-change zero-byte files | 232 total | Net decrease of 16 |
| Post-change commercial zero-byte files | 22 | 16 of 38 formerly empty files now contain implementations |
| Runtime import audit | PASS with warning | 2,077 backend source files scanned; 208 legacy/non-critical missing imports; 0 missing imports on canonical financial surface; 0 mixed-module violations on that surface |
| Financial static gate | PASS | Existing 12-file canonical financial surface check |
| Enterprise contract gate | PASS | Existing 11 control-plane contracts |
| USSD contract gate | PASS, contract-only | It explicitly reports provider/network verification false and production approval false |
| Official theme audit | PASS | Existing nine-color theme and brand contracts |
| Organization profile audit | PASS | Configured company/product identity; external documentary verification still pending |

A further 14 existing exact-money utility tests passed (separate from the 29 new commercial-core tests). Twenty changed/new JavaScript files passed `node --check`. Full install, backend/frontend build, lint, typecheck, application startup, MongoDB replica-set integration, Redis-backed jobs, provider sandbox tests and E2E tests were not run. A full CI result must not be inferred from the static gates above.

## 4. Implemented changes

The 16 previously empty files completed and the new support files are listed in `CHANGESET.md`. The implementation covers:

- approved/effective, versioned, tenant-scoped tariff lookup;
- deterministic fixed, percentage, fixed-plus-percentage and tiered fee calculation using `BigInt` minor units;
- explicit currency metadata/exponents for the configured initial set;
- fail-closed handling for unpriced, unapproved, ambiguous and cross-currency cases;
- maker-checker approval boundary;
- durable usage-event schema and idempotent processing interface;
- immutable fee-assessment snapshots, source fingerprints and unique tenant idempotency index;
- injected financial-core port that rejects missing canonical posting wiring and requires an active transaction session;
- repeatable root commands and focused unit tests.

The financial adapter is a boundary, not proof of a live ledger integration. It intentionally refuses to invent a canonical posting function.

## 5. Financial proof

`node scripts/run-commercial-core-tests.mjs` completed with **29 passed, 0 failed**. These are isolated unit tests using injected/in-memory dependencies. They cover exact arithmetic, rounding, pricing tiers, rule selection/ambiguity, approval separation, missing tariffs, cross-tenant candidate rejection, idempotency, usage replay, failed-event charging policy and fail-closed adapter behaviour.

Not proven: MongoDB replica-set transactions, unique-index race behaviour against a real database, real Redis/outbox execution, actual canonical ledger postings, balanced revenue journals, rollback, provider callbacks, collection, settlement, reversals, invoice allocation, or end-to-end transaction reconstruction.

## 6. Tenant/security proof

The new repositories scope reads/writes by tenant and new tests verify that the domain services reject mismatched tenant records/candidates. This is limited service-level unit evidence. It does not prove the existing HTTP routes, auth middleware, exports, cache, job workers, logs or every product module are tenant-safe. No independent penetration test or full security scan was performed.

## 7. Reconciliation / operational status

No complete commercial reconciliation UI or workflow was implemented in this slice. No running MongoDB/Redis runtime, data import, provider settlement or backup/restore drill was evidenced. Existing theme/organization/static contractual audits are not operational readiness evidence.

## 8. Commercial, partner and regulatory status

No buyer interview, design-partner agreement, live institutional data permission, signed pilot, provider credential, production API permission, legal opinion, regulatory approval, tax/accounting sign-off, PDPO registration or independent security assessment was produced by this code task. All such external items remain pending evidence. The code does not represent TITech as a bank, payment service provider, lender, insurer or custodian.

## 9. Production decision

`productionApproved=false` remains in force. The current work is **Implemented → Unit Tested** for the isolated commercial core only. It has not reached Integration Tested, E2E Tested, Operationally Verified, Security-Assessed, Externally Approved or Production Approved.

## 10. Reproduction commands

From the repository root:

```bash
node --version
npm --version
npm run check:commercial-core
npm run test:commercial:core
npm run check:financial
npm run check:enterprise-contracts
npm run check:runtime-imports
npm run audit:theme
npm run audit:organization
```

The project-wide runtime gate is `npm run check:runtime`; on the supplied container it is expected to reject Node 22.16.0/npm 10.9.2. After provisioning Node >=24.15.0 and npm >=11, install from the existing lockfiles with `npm ci`, `npm --prefix backend ci`, and `npm --prefix frontend ci`, then run the repository's established full checks/tests/builds. MongoDB replica-set and Redis services are required for the relevant integration tests.


## 11. Remaining zero-byte commercial files (22)

These files remain empty in the supplied archive-derived working copy and are still open defects/implementation work; no placeholder code was added:

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
