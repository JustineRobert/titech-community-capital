# TITech Community Capital — End-to-End Enterprise Change Manifest

Baseline: user-supplied `titech-community-capital-main(4).zip` → final enterprise release candidate on 2026-09-23.

**Added:** 29  
**Modified:** 27  
**Removed:** 2  
**Total changed paths:** 58

**Manifest note:** the three generated manifest/guide files are excluded from their own content-hash comparison to avoid recursive metadata changes; they are listed separately as generated artifacts.

## Folder summary

- `(root)/` — 2 changed paths (2 modified)
- `.github/workflows/` — 1 changed paths (1 modified)
- `backend/audit/` — 1 changed paths (1 modified)
- `backend/backend/` — 1 changed paths (1 removed)
- `backend/commercial/` — 3 changed paths (1 added, 1 modified, 1 removed)
- `backend/middleware/` — 3 changed paths (3 modified)
- `backend/models/` — 2 changed paths (2 modified)
- `backend/modules/` — 2 changed paths (2 modified)
- `backend/package.json/` — 1 changed paths (1 modified)
- `backend/repositories/` — 1 changed paths (1 modified)
- `backend/scripts/` — 1 changed paths (1 added)
- `backend/testing/` — 2 changed paths (2 added)
- `backend/tests/` — 1 changed paths (1 added)
- `docs/END_TO_END_ENTERPRISE_UPDATE_2026-09-23.md/` — 1 changed paths (1 added)
- `docs/architecture/` — 1 changed paths (1 added)
- `docs/payments/` — 1 changed paths (1 added)
- `docs/production-readiness/` — 5 changed paths (5 added)
- `docs/runbooks/` — 6 changed paths (6 added)
- `docs/testing/` — 1 changed paths (1 added)
- `frontend/src/` — 11 changed paths (11 modified)
- `frontend/vite.config.js/` — 1 changed paths (1 modified)
- `reports/architecture-debt-audit.json/` — 1 changed paths (1 added)
- `reports/evidence/` — 2 changed paths (2 added)
- `reports/release-readiness.json/` — 1 changed paths (1 added)
- `reports/runtime-import-audit.json/` — 1 changed paths (1 added)
- `scripts/` — 5 changed paths (4 added, 1 modified)

## Step-by-step file index

- **MODIFIED** `.github/workflows/ci.yml` — CI quality job now executes enterprise release, Golden Money Path proof and architecture-debt checks and uploads their evidence.
- **MODIFIED** `TITECH_PLATFORM_TRUTH.md` — Updated dated platform truth with Golden Money Path proof, canonical financial-surface status, debt counts and explicit production-approval limitations.
- **MODIFIED** `backend/audit/audit.service.js` — Restored audit service compatibility using the existing audit infrastructure instead of introducing a second audit implementation.
- **REMOVED** `backend/backend/package-lock.json` — Removed duplicate nested backend lockfile so the root backend package has one dependency-lock authority.
- **MODIFIED** `backend/commercial/services/billing/billingPayment.service.js` — Repointed the CommonJS billing service to the explicit .cjs exact-money helper.
- **ADDED** `backend/commercial/services/billing/decimalMoney.cjs` — Added exact decimal-money compatibility implementation for the existing CommonJS billing boundary.
- **REMOVED** `backend/commercial/services/billing/decimalMoney.js` — Removed the empty/incorrect module after replacing it with explicit .cjs compatibility boundary.
- **MODIFIED** `backend/middleware/pipeline/PipelineBuilder.js` — Repaired middleware pipeline compatibility without replacing the pipeline design.
- **MODIFIED** `backend/middleware/pipeline/StageValidator.js` — Repaired stage validation compatibility without introducing a second pipeline.
- **MODIFIED** `backend/middleware/pipeline/index.js` — Restored pipeline exports/compatibility for existing consumers.
- **MODIFIED** `backend/models/Payment.js` — Extended the canonical operational payment aggregate with correlation/client references, member/purpose context, settlement status and risk/compliance/review fields.
- **MODIFIED** `backend/models/PaymentIntent.js` — Added intent traceability/context and settlement/risk/compliance fields while preserving its existing state transitions.
- **MODIFIED** `backend/modules/finance/services/interestAccrualService.js` — Implemented a fail-closed/injectable financial boundary so interest cannot silently mutate balances outside the canonical accounting engine.
- **MODIFIED** `backend/modules/payment/paymentProcessingService.js` — Persisted canonical payment traceability fields and kept idempotency identity limited to business request data, excluding correlation IDs.
- **MODIFIED** `backend/package.json` — Added enterprise health/test/evidence scripts and quality-gate integration.
- **MODIFIED** `backend/repositories/financial/ledger.repository.js` — Removed CommonJS require/createRequire boundary from canonical ESM financial repository.
- **ADDED** `backend/scripts/healthcheck.js` — Added lightweight health/readiness probe for CI and deployment orchestration.
- **ADDED** `backend/testing/goldenMoneyPath/goldenMoneyPathHarness.cjs` — Added dependency-free reference financial lifecycle harness for timeout/restart/callback/ledger/reconciliation/reversal/idempotency/security invariants.
- **ADDED** `backend/testing/goldenMoneyPath/referenceProviderSimulator.cjs` — Added deterministic test-only provider simulator supporting success, timeout, duplicate, delayed/out-of-order and failure scenarios.
- **ADDED** `backend/tests/unit/commercial/decimalMoney.test.js` — Added exact-money regression tests for commercial billing.
- **ADDED** `docs/END_TO_END_ENTERPRISE_UPDATE_2026-09-23.md` — Added enterprise update documentation carried forward from the earlier hardening pass.
- **ADDED** `docs/architecture/ADR-2026-09-23-CANONICAL-PAYMENT-AUTHORITY.md` — Documents why the existing Payment aggregate remains the operational payment authority and PaymentIntent is not promoted into a parallel state machine.
- **ADDED** `docs/payments/GOLDEN_MONEY_PATH.md` — Documents the canonical money path, state separation, failure semantics and authority boundaries.
- **ADDED** `docs/production-readiness/ARCHITECTURAL_DEBT_REGISTER_2026-09-23.md` — Records dated architectural debt results and prioritizes later consolidation without hiding unresolved repository debt.
- **ADDED** `docs/production-readiness/GOLDEN_MONEY_PATH_EVIDENCE_2026-09-23.md` — Provides human-readable evidence for the dependency-free Golden Money Path proof and its limitations.
- **ADDED** `docs/production-readiness/LIVE_REPOSITORY_SNAPSHOT_2026-09-23.md` — Records the public GitHub architectural reference and explicitly states that the live repository was not pushed/modified by this task.
- **ADDED** `docs/production-readiness/MASTER_PROMPT_EXECUTION_MAP_2026-09-23.md` — Maps major sections of the supplied master prompt to concrete repository evidence and distinguishes tested/reference proof from external verification.
- **ADDED** `docs/production-readiness/PRODUCTION_READINESS_MATRIX_2026-09-23.md` — Provides capability-level readiness status and evidence/limitation mapping.
- **ADDED** `docs/runbooks/duplicate-callback.md` — Runbook for duplicate provider callbacks.
- **ADDED** `docs/runbooks/ledger-mismatch.md` — Runbook for ledger/balance integrity mismatch handling.
- **ADDED** `docs/runbooks/provider-outage.md` — Runbook for provider outage and timeout scenarios.
- **ADDED** `docs/runbooks/reconciliation-mismatch.md` — Runbook for reconciliation exceptions.
- **ADDED** `docs/runbooks/stuck-transaction.md` — Runbook for transactions that remain pending/unknown.
- **ADDED** `docs/runbooks/unknown-transaction.md` — Runbook for provider-ambiguous/UNKNOWN transactions.
- **ADDED** `docs/testing/GOLDEN_MONEY_PATH_TEST_MATRIX_2026-09-23.md` — Lists the normal, negative, failure-injection and invariant scenarios covered by the reference proof.
- **MODIFIED** `frontend/src/app/store.js` — Protects Redux persistence from retaining access/refresh tokens while retaining safe session metadata.
- **MODIFIED** `frontend/src/features/auth/authSlice.js` — Keeps access/refresh credentials in the intended in-memory auth path rather than browser storage.
- **MODIFIED** `frontend/src/index.js` — Aligned frontend bootstrap/runtime behavior with the current Vite architecture.
- **MODIFIED** `frontend/src/legal/legalAcceptance.js` — Removed stale API-origin assumptions and uses the shared production-safe API configuration.
- **MODIFIED** `frontend/src/legal/legalApi.js` — Uses production-safe/same-origin API resolution instead of hard-coded localhost.
- **MODIFIED** `frontend/src/mocks/handlers/index.js` — Reconnects mock exports to canonical handlers implementation.
- **MODIFIED** `frontend/src/pages/SupportChat.js` — Migrated stale CRA environment lookup to Vite-compatible, production-safe configuration.
- **MODIFIED** `frontend/src/pages/onboarding/OnboardingAPI.js` — Uses Vite-compatible environment and production-safe API resolution.
- **MODIFIED** `frontend/src/services/api.js` — Production-safe API origin and auth transport handling; no access-token persistence shortcut.
- **MODIFIED** `frontend/src/services/socket.js` — Removed browser-storage token access and uses canonical in-memory auth context.
- **MODIFIED** `frontend/src/sockets/chatSocket.js` — Removed stale auth/config coupling and aligned socket transport with canonical runtime configuration.
- **MODIFIED** `frontend/vite.config.js` — Keeps local development behavior while avoiding forced localhost API defaults in production.
- **MODIFIED** `package.json` — Fixed/extended root cleanup and evidence/release quality pipeline to include enterprise debt and Golden Money Path proof.
- **ADDED** `reports/architecture-debt-audit.json` — Machine-readable counts for zero-byte files, CommonJS candidates and runtime-import debt.
- **ADDED** `reports/evidence/golden-money-path-proof.json` — Machine-readable reference-proof results and scenario assertions.
- **ADDED** `reports/evidence/production-readiness-matrix.json` — Machine-readable capability readiness evidence and explicit limitations.
- **ADDED** `reports/release-readiness.json` — Latest audit-mode release readiness result; strict mode remains blocked by repository-wide missing imports.
- **ADDED** `reports/runtime-import-audit.json` — Latest runtime import scan with canonical financial surface clean and repository-wide debt visible.
- **ADDED** `scripts/architecture-debt-audit.mjs` — Non-destructive audit of zero-byte source files, CommonJS candidates and runtime-import debt with critical financial-surface classification.
- **ADDED** `scripts/clean.mjs` — Safe repository cleanup script used by the root quality workflow.
- **ADDED** `scripts/enterprise-product-gate.mjs` — Dependency-light enterprise static product gate for architecture/runtime security invariants.
- **ADDED** `scripts/golden-money-path-proof.mjs` — CI/evidence entrypoint for the deterministic Golden Money Path reference harness.
- **MODIFIED** `scripts/release-readiness-gate.mjs` — Release gate now consumes architecture-debt and Golden Money Path evidence and exposes strict blockers.

## Generated meta-artifacts

- `docs/production-readiness/CHANGE_MANIFEST_2026-09-23.csv` — generated by this release process; excluded from the manifest hash comparison to keep the manifest stable.
- `docs/production-readiness/CHANGE_MANIFEST_2026-09-23.md` — generated by this release process; excluded from the manifest hash comparison to keep the manifest stable.
- `docs/production-readiness/THIS_PASS_FILE_CHANGE_GUIDE_2026-09-23.md` — generated by this release process; excluded from the manifest hash comparison to keep the manifest stable.
