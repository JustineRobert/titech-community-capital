# TITech Community Capital — Payroll + Branding File Change Discovery

**Date:** 2026-09-30

This discovery is based on a baseline-vs-updated comparison against the supplied `titech-community-capital-main(7).zip` archive. It is a file-level implementation map, not a claim that every repository subsystem is production approved.

## Step 1 — Backend payroll domain boundary

```text
backend/modules/payroll/
├── payroll.constants.cjs
├── payroll.errors.cjs
├── payroll.crypto.cjs
├── payroll.csv.cjs
├── payroll.providerGateway.cjs
├── payroll.financialGateway.cjs
├── payroll.service.cjs
├── payroll.routes.js
└── models/
    ├── PayrollBatch.cjs
    ├── PayrollTransaction.cjs
    └── WebhookSubscription.cjs
```

Purpose: establish one canonical payroll orchestration boundary. No second ledger, wallet, payment-provider HTTP stack, tenant engine or audit store was introduced.

## Step 2 — Backend platform integration

```text
backend/routes/index.js
backend/config/swagger.js
backend/.env.example
```

Changes:

1. The route registry statically imports the authoritative ESM tenant middleware at the known CommonJS/ESM loading boundary.
2. Payroll API routes are mounted under both `/api/v1/payroll` and `/api/v1` so the requested endpoint names remain directly reachable without breaking the explicit payroll namespace.
3. `/webhooks` is mounted as the public provider callback boundary.
4. Swagger route discovery includes the payroll module.
5. Environment documentation includes webhook secret encryption and provider callback verification controls.

## Step 3 — Payroll tests and API contract

```text
backend/tests/unit/payroll/payroll.crypto.test.js
backend/tests/unit/payroll/payroll.csv.test.js
docs/payroll/OPENAPI.yaml
docs/payroll/IMPLEMENTATION.md
docs/payroll/REMEDIATION_REPORT_2026-09-30.md
docs/payroll/CHANGE_MANIFEST_2026-09-30.csv
docs/payroll/FILE_CHANGE_DISCOVERY_2026-09-30.md
```

Purpose: keep security/input tests, the portable API contract, implementation rules, evidence boundaries and change traceability beside the feature.

## Step 4 — Frontend payroll experience

```text
frontend/src/features/payroll/payrollApi.js
frontend/src/pages/Payroll.jsx
frontend/src/pages/Payroll.css
frontend/src/routes/AppRoutes.jsx
frontend/src/layouts/AdminLayout.jsx
frontend/src/__tests__/payroll/payrollPage.contract.test.jsx
```

Purpose: give employer/admin/auditor roles a protected UI for upload/report/process/reconcile/retry/subscriptions/simulator/audit workflows while preserving the existing route tree and API client architecture.

## Step 5 — Official TITech brand enforcement

```text
frontend/src/branding/official-theme.css
frontend/src/main.jsx
frontend/src/index.js
frontend/src/components/BrandLogo.jsx
frontend/src/components/ui/NotificationProvider.jsx
frontend/src/__tests__/branding/BrandLogo.test.jsx
```

Changes:

1. The official theme imports the exact palette defined by the repository's brand manifest: deep blue `#0030A0`, electric blue `#0058D8`, bright blue `#0066E8`, cyan `#00B8F8`, Africa green `#008000`, lime `#A8F000`, gold `#F8D800`, navy ink `#082B67` and white `#FFFFFF`.
2. Common platform UI tokens are mapped to those official roles.
3. Both frontend entry points activate `data-titech-brand="official"`, which makes the official theme selectors active.
4. `BrandLogo` no longer forwards the invalid camel-case DOM property that caused the reported React warning.
5. `NotificationProvider.defaultProps` is removed because equivalent function parameter defaults already exist.

## Step 6 — Public repository documentation

```text
README.md
```

The README now documents the enterprise employer payroll capability, endpoints, security controls and the remaining evidence boundary so the repository does not present unverified production status as fact.

## Step 7 — End-to-end workflow introduced

```text
Employer CSV
   ↓
Upload + tenant/RBAC + validation + idempotency
   ↓
PayrollBatch + PayrollTransaction
   ↓
ADMIN processBatch
   ↓
Existing provider service boundary
   ↓
SUCCESS / FAILED / UNKNOWN
   ↓
Canonical financial gateway
   ↓
POSTED / REQUIRES_REVIEW
   ↓
Reconcile / provider webhook
   ↓
Batch state + signed employer webhook
   ↓
Canonical audit evidence
```

## File counts from the supplied baseline comparison

- Added: 22 files, including this discovery document.
- Modified: 12 files.
- Deleted: 0 files.

The machine-readable manifest contains the authoritative path-by-path list and evidence notes.
