# Change discovery — 12 November 2026

**Source artifact:** supplied `titech-community-capital-main.zip` (ZIP comment/source snapshot SHA: `33efc14731788c800b23d0e12ab8393a706ce613`; archive SHA-256: `f387d5b6acf45b02eb1237e627cb9866cef24ef5c9bbc4fe016ec07bc3ab57c7`). The archive has no `.git` metadata. This is an archive-to-working-copy change record, not a Git diff against a live branch.

## Existing files completed (16 formerly zero-byte files)

| Path | Change | Intended role |
|---|---|---|
| `backend/commercial/constants/transactionRevenue.constants.js` | Implemented | Currency exponents, rule/assessment/usage classifications and statuses |
| `backend/commercial/errors/transactionRevenue.errors.js` | Implemented | ESM domain error classes |
| `backend/commercial/events/transactionRevenue.events.js` | Implemented | Commercial usage/assessment event names |
| `backend/commercial/models/FeeRule.js` | Implemented | Tenant-scoped, versioned, maker-checker fee-rule schema |
| `backend/commercial/models/FeeAssessment.js` | Implemented | Immutable fee assessment schema and unique idempotency index |
| `backend/commercial/models/usageRecord.model.js` | Implemented | Durable usage-event provenance and processing schema |
| `backend/commercial/repositories/feeRule.repository.js` | Implemented | Tenant-scoped fee-rule persistence and atomic approval |
| `backend/commercial/repositories/feeAssessment.repository.js` | Implemented | Idempotent fee-assessment persistence |
| `backend/commercial/repositories/usageRecord.repository.js` | Added | Tenant-scoped usage-record persistence |
| `backend/commercial/repositories/index.js` | Implemented | Commercial repository exports |
| `backend/commercial/financial/billingFinancialCore.port.js` | Implemented | Required interface for established financial-core delegation |
| `backend/commercial/financial/titechFinancialCore.adapter.js` | Implemented | Injected canonical posting/reversal adapter; no direct ledger write |
| `backend/commercial/services/billing/decimalMoney.js` | Implemented | ESM bridge to existing decimal-money CJS utility |
| `backend/commercial/services/transactionRevenue/feeCalculation.service.js` | Implemented | Exact minor-unit pricing calculations |
| `backend/commercial/services/transactionRevenue/feeRule.service.js` | Implemented | Approved tariff resolution and maker-checker approval |
| `backend/commercial/services/transactionRevenue/feeAssessment.service.js` | Implemented | Immutable, idempotent assessment creation |
| `backend/commercial/services/transactionRevenue/transactionRevenue.service.js` | Implemented | Usage event intake, classification and assessment orchestration |
| `backend/commercial/services/transactionRevenue/index.js` | Added | Service façade |

## New files added (not previously present in the archive)

- `backend/commercial/repositories/usageRecord.repository.js` — tenant-scoped usage-event persistence.
- `backend/commercial/services/transactionRevenue/index.js` — façade exports for the implemented core.

## New automated verification files

- `backend/tests/unit/commercial/transactionRevenue/feeCalculation.service.test.mjs` (includes progressive-tier fixed-charge regression coverage)
- `backend/tests/unit/commercial/transactionRevenue/feeRule.service.test.mjs`
- `backend/tests/unit/commercial/transactionRevenue/feeAssessment.service.test.mjs`
- `backend/tests/unit/commercial/transactionRevenue/transactionRevenue.service.test.mjs`
- `backend/tests/unit/commercial/transactionRevenue/financialCore.adapter.test.mjs`
- `scripts/commercial-billing-core-gate.mjs`
- `scripts/run-commercial-core-tests.mjs`

## Root orchestration and documentation

- `package.json`: added `check:commercial-core` and `test:commercial:core`, and inserted them into the existing `check` / `test:ci` sequences. No lockfile change is required for script-only changes.
- `TITECH_PLATFORM_TRUTH.md`: advanced the current truth index date to 12 November and recorded the scope, evidence and blockers of this archive-local billing remediation.
- `docs/commercial/AUTHORITATIVE_COMMERCIAL_BILLING_CORE.md`: implementation boundaries and integration requirements.
- `docs/evidence/2026-11-12-commercial-billing-remediation/CHANGESET.md`: this discovery record.
- `docs/evidence/2026-11-12-commercial-billing-remediation/EXECUTION_REPORT.md`: evidence and limitations.
- `docs/evidence/2026-11-12-commercial-billing-remediation/SERVICE_INTEGRATION_MATRIX.md`: commercial service coverage and status.
- `docs/evidence/2026-11-12-commercial-billing-remediation/THEME_AND_IDENTITY.md`: official branding/identity verification.

## Intentionally left unchanged

- `branding/TITECH_OFFICIAL_THEME.json`, `branding/BRAND_MANIFEST.json`, `branding/TITECH_ORGANIZATION_PROFILE.json`, circular logo/reference assets and existing web/mobile theme tokens. The existing brand audit passed; copying or overriding palette values in feature CSS would violate the central-theme architecture.
- Existing JWT/refresh-cookie authentication, tenant/RBAC middleware, canonical ledger implementations and payment-provider adapters. The adapter added here delegates to the canonical core rather than replacing these controls.
- `backend/commercial/services/billing/billingPayment.service.js` and `backend/commercial/models/billingPayment.model.js`: substantial existing code was found, but their surrounding billing repository, financial-core wiring, routes and real provider verification were not established by this archive; no unsafe speculative rewrite was made.
- All external provider credentials, live callback settings, contracts, customer data and production configuration.

## Remaining zero-byte files

The original archive contained 248 zero-byte files overall and 38 under `backend/commercial`. After this change slice, the working copy contains 232 zero-byte files overall and 22 under `backend/commercial`. Remaining commercial zero-byte files are listed in the execution report. They were not mass-filled with placeholders.


## Exact comparison against the supplied ZIP

A byte-level SHA-256 comparison was performed for every file in the original archive against the protected working copy after preserving the archive's original Unicode circular-seal filename. The working copy has **32 added files, 20 modified files, and 0 removed files** relative to the supplied ZIP. There are no intentional deletions or renames. The complete manifest is below.

### All 32 added files

```text
backend/commercial/repositories/usageRecord.repository.js
backend/commercial/services/transactionRevenue/index.js
backend/tests/unit/commercial/transactionRevenue/feeAssessment.service.test.mjs
backend/tests/unit/commercial/transactionRevenue/feeCalculation.service.test.mjs
backend/tests/unit/commercial/transactionRevenue/feeRule.service.test.mjs
backend/tests/unit/commercial/transactionRevenue/financialCore.adapter.test.mjs
backend/tests/unit/commercial/transactionRevenue/transactionRevenue.service.test.mjs
docs/commercial/AUTHORITATIVE_COMMERCIAL_BILLING_CORE.md
docs/evidence/2026-11-12-commercial-billing-remediation/CHANGESET.md
docs/evidence/2026-11-12-commercial-billing-remediation/EXECUTION_REPORT.md
docs/evidence/2026-11-12-commercial-billing-remediation/SERVICE_INTEGRATION_MATRIX.md
docs/evidence/2026-11-12-commercial-billing-remediation/THEME_AND_IDENTITY.md
docs/evidence/2026-11-12-commercial-billing-remediation/commercial-core-gate.json
docs/evidence/2026-11-12-commercial-billing-remediation/commercial-core-gate.log
docs/evidence/2026-11-12-commercial-billing-remediation/commercial-core-unit-tests.log
docs/evidence/2026-11-12-commercial-billing-remediation/commercial-core-unit-tests.tap
docs/evidence/2026-11-12-commercial-billing-remediation/enterprise-contract-gate.log
docs/evidence/2026-11-12-commercial-billing-remediation/existing-exact-money-unit-tests.tap
docs/evidence/2026-11-12-commercial-billing-remediation/financial-static-gate.log
docs/evidence/2026-11-12-commercial-billing-remediation/official-theme-audit.log
docs/evidence/2026-11-12-commercial-billing-remediation/organization-profile-gate.log
docs/evidence/2026-11-12-commercial-billing-remediation/platform-truth-generation.log
docs/evidence/2026-11-12-commercial-billing-remediation/runtime-import-audit.log
docs/evidence/2026-11-12-commercial-billing-remediation/supported-runtime-gate.log
docs/evidence/2026-11-12-commercial-billing-remediation/syntax-check.log
docs/evidence/2026-11-12-commercial-billing-remediation/ussd-contract-gate.log
reports/official-theme-audit.json
reports/release-readiness.json
reports/runtime-import-audit.json
reports/test-discovery-audit.json
scripts/commercial-billing-core-gate.mjs
scripts/run-commercial-core-tests.mjs
```

### All 20 modified files

```text
TITECH_PLATFORM_TRUTH.md
backend/commercial/constants/transactionRevenue.constants.js
backend/commercial/errors/transactionRevenue.errors.js
backend/commercial/events/transactionRevenue.events.js
backend/commercial/financial/billingFinancialCore.port.js
backend/commercial/financial/titechFinancialCore.adapter.js
backend/commercial/models/FeeAssessment.js
backend/commercial/models/FeeRule.js
backend/commercial/models/usageRecord.model.js
backend/commercial/repositories/feeAssessment.repository.js
backend/commercial/repositories/feeRule.repository.js
backend/commercial/repositories/index.js
backend/commercial/services/billing/decimalMoney.js
backend/commercial/services/transactionRevenue/feeAssessment.service.js
backend/commercial/services/transactionRevenue/feeCalculation.service.js
backend/commercial/services/transactionRevenue/feeRule.service.js
backend/commercial/services/transactionRevenue/transactionRevenue.service.js
docs/evidence/platform-truth.json
package.json
scripts/platform-truth.mjs
```

### Repeatable change-discovery steps

1. Preserve the supplied ZIP and extract it into a separate working directory.
2. Read the ZIP comment and SHA-256; treat the comment as the supplied source snapshot identifier, not as a verified current Git `HEAD`.
3. Compare each relative path and file SHA-256 in the original ZIP with the working copy. The exact added/modified/removed manifest above is the result.
4. Inspect `backend/commercial/` for the central pricing, usage, fee assessment, repository and financial adapter files.
5. Inspect `backend/tests/unit/commercial/transactionRevenue/` and run `npm run test:commercial:core`.
6. Inspect `docs/commercial/` and `docs/evidence/2026-11-12-commercial-billing-remediation/` for design boundary, integration matrix, theme verification and execution evidence.
7. Inspect `reports/` and `docs/evidence/platform-truth.json` for generated machine-readable audits; rerun the documented commands to reproduce them.
8. Run `npm run check:runtime` first on a fully provisioned environment, followed by install/build/integration/E2E checks. The current container fails the supported runtime prerequisite and therefore cannot validate those later stages.
