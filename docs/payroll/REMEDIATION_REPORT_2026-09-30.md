# TITech Community Capital — Payroll + Production Hardening Implementation Report

**Date:** 2026-09-30  
**Repository:** `https://github.com/JustineRobert/titech-community-capital`  
**Source baseline:** supplied `titech-community-capital-main(7).zip` and the attached remediation master prompt  
**Scope:** employer payroll disbursement API, provider callbacks, employer webhook subscriptions, simulator/audit trail, RBAC, idempotency, financial posting boundary, frontend payroll UI, official TITech theme enforcement, and selected P0 runtime hardening.

## 1. Executive Summary

The repository has been enhanced with an end-to-end payroll module that sits on the existing TITech architecture rather than creating a parallel payment/ledger/audit stack.

The implementation adds:

- tenant-scoped employer payroll batch upload and validation;
- administrator-controlled batch processing, reconciliation and retry flows;
- tenant-scoped reporting for administrators, auditors and employer users;
- provider callback handling for MTN MoMo and Airtel Money status outcomes;
- explicit `UNKNOWN` provider state so ambiguous outcomes are not converted into financial success;
- separate `financialPostingStatus` so provider success is not treated as ledger posting;
- employer webhook subscriptions with encrypted secrets, HMAC-SHA256 signatures and timestamp replay protection;
- callback SSRF/private-network protection and redirect blocking;
- simulator callbacks and canonical audit evidence;
- server-side RBAC and authoritative tenant resolution;
- idempotency for payroll mutations;
- OpenAPI documentation with role examples, timeout/insufficient-funds examples and HMAC verification guidance;
- a protected frontend Payroll page and centralized payroll API client;
- official TITech palette activation across the frontend entry points and common UI tokens;
- remediation of the reported `fetchPriority` and function-component `defaultProps` warnings;
- a concrete ESM/CommonJS tenant middleware startup-boundary fix in `backend/routes/index.js`.

The repository is **not marked Production Approved** because full runtime/E2E/provider/deployment evidence could not be executed in this supplied environment.

## 2. Root Causes / Confirmed Repository Findings

### 2.1 Tenant middleware route-loading mismatch

The backend route registry is ESM and previously resolved the tenant middleware through CommonJS `require()` candidates. The authoritative `backend/middleware/tenantMiddleware.js` is ESM. That boundary can raise an ESM/CJS module-loading failure during startup. The route registry now statically imports the authoritative tenant middleware and only retains optional legacy fallbacks.

### 2.2 React DOM warning source

`BrandLogo.jsx` accepted the React component property `fetchPriority` but forwarded the camel-case property to the DOM. The component now consumes `fetchPriority` at its public API boundary and emits the lowercase HTML attribute `fetchpriority`, with a regression test.

### 2.3 `defaultProps` warning source

`NotificationProvider` already supplied equivalent defaults through function parameters but also assigned `NotificationProvider.defaultProps`. The obsolete function-component declaration was removed without changing the public defaults.

### 2.4 Theme selector activation mismatch

The official theme CSS was keyed to `data-titech-brand="official"`, while the runtime could publish the full brand name into that selector. Both supported frontend entry points now explicitly apply the `official` marker and expose the full name separately.

### 2.5 Verification environment limitation

The supplied repository snapshot contains source and lockfile material but not installed npm dependencies. A dependency installation attempt timed out. The execution environment reports Node 22.16.0, while the repository targets Node 24.15.x. Therefore the final report does not convert unexecuted Jest/Vitest/Vite/E2E work into “passed” evidence.

## 3. Critical Changes

### Payroll backend

`backend/modules/payroll/` is the canonical payroll module. It contains constants/errors, CSV validation, encrypted-secret/HMAC utilities, batch/transaction/subscription models, provider and financial gateways, service orchestration and HTTP routes.

The service lifecycle is:

```text
Upload CSV
  ↓
Tenant + RBAC + validation + idempotency
  ↓
Durable payroll batch + transaction evidence
  ↓
ADMIN processBatch
  ↓
Existing provider disbursement boundary
  ↓
SUCCESS / FAILED / UNKNOWN
  ↓
Canonical financial posting boundary
  ↓
POSTED / REQUIRES_REVIEW
  ↓
Reconciliation
  ↓
Employer signed callback + audit
```

### Security model

- `ADMIN`, `AUDITOR`, `EMPLOYER_USER` are normalized server-side.
- Tenant identity is taken from trusted authenticated context.
- CSV size/row/field constraints are enforced.
- Mutation operations use `Idempotency-Key` through the existing idempotency middleware.
- Webhook secrets are encrypted with AES-256-GCM and never returned from list operations.
- Subscription creation returns the plaintext secret only once; idempotency replay storage explicitly redacts it.
- Callback URLs are validated against private/local address ranges and HTTPS is mandatory in production.
- Outbound callback redirects are not followed.
- Provider webhook verification can be enforced with timestamp-bound HMAC-SHA256.
- Audit writes use the existing tamper-evident `PlatformAudit` service.

### Financial integrity

Payroll does not mutate wallet/balance/ledger state directly. A provider-positive result remains a provider outcome until the canonical financial gateway reports a posted accounting result. `UNKNOWN` is not automatically retried because a retry after an ambiguous provider outcome could duplicate a real-world disbursement.

## 4. Files Changed

The detailed machine-readable manifest is `docs/payroll/CHANGE_MANIFEST_2026-09-30.csv`.

### Added

- `backend/modules/payroll/models/PayrollBatch.cjs`
- `backend/modules/payroll/models/PayrollTransaction.cjs`
- `backend/modules/payroll/models/WebhookSubscription.cjs`
- `backend/modules/payroll/payroll.constants.cjs`
- `backend/modules/payroll/payroll.crypto.cjs`
- `backend/modules/payroll/payroll.csv.cjs`
- `backend/modules/payroll/payroll.errors.cjs`
- `backend/modules/payroll/payroll.financialGateway.cjs`
- `backend/modules/payroll/payroll.providerGateway.cjs`
- `backend/modules/payroll/payroll.routes.js`
- `backend/modules/payroll/payroll.service.cjs`
- `backend/tests/unit/payroll/payroll.crypto.test.js`
- `backend/tests/unit/payroll/payroll.csv.test.js`
- `docs/payroll/CHANGE_MANIFEST_2026-09-30.csv`
- `docs/payroll/IMPLEMENTATION.md`
- `docs/payroll/OPENAPI.yaml`
- `docs/payroll/REMEDIATION_REPORT_2026-09-30.md`
- `docs/payroll/FILE_CHANGE_DISCOVERY_2026-09-30.md`
- `frontend/src/__tests__/payroll/payrollPage.contract.test.jsx`
- `frontend/src/features/payroll/payrollApi.js`
- `frontend/src/pages/Payroll.css`
- `frontend/src/pages/Payroll.jsx`

### Modified

- `README.md`
- `backend/.env.example`
- `backend/config/swagger.js`
- `backend/routes/index.js`
- `frontend/src/__tests__/branding/BrandLogo.test.jsx`
- `frontend/src/branding/official-theme.css`
- `frontend/src/components/BrandLogo.jsx`
- `frontend/src/components/ui/NotificationProvider.jsx`
- `frontend/src/index.js`
- `frontend/src/layouts/AdminLayout.jsx`
- `frontend/src/main.jsx`
- `frontend/src/routes/AppRoutes.jsx`

No unrelated logo rename or generated runtime-audit artifact is intentionally included in the updated repository.

## 5. Tests Executed

### Static and syntax verification

```text
node --check backend/modules/payroll/*.cjs and payroll route/index files     PASS
node scripts/enterprise-gate.mjs --syntax                                  PASS
node scripts/financial-static-gate.mjs                                     PASS
node scripts/runtime-import-audit.mjs                                      PASS on canonical financial surface
node payroll crypto/CSV smoke                                                PASS
node OpenAPI contract marker smoke                                           PASS
```

### Not executed / blocked

```text
npm ci / dependency restoration                                               BLOCKED / timed out
Backend Jest suite                                                         NOT RUN
Frontend Vitest suite                                                      NOT RUN
Frontend Vite production build                                             NOT RUN
Real MongoDB integration                                                   NOT RUN
Real Redis integration                                                     NOT RUN
Real provider sandbox/live payroll disbursement                            NOT RUN
Provider callback certification                                             NOT RUN
Full browser E2E                                                           NOT RUN
DAST / penetration testing                                                  NOT RUN
Load / chaos testing                                                        NOT RUN
Deployment / rollback / backup-restore rehearsal                            NOT RUN
```

## 6. Runtime Evidence

### Demonstrated

- Payroll source files pass Node syntax checks.
- Payroll crypto/CSV smoke verification passes.
- The official theme and payroll routes are statically wired into the repository.
- The route registry now uses a direct ESM tenant middleware import at the known failure boundary.

### Not demonstrated in this environment

- clean process startup;
- `/health/live` and `/health/ready` responses from a running backend;
- real login/refresh/logout;
- authenticated notification retrieval;
- real tenant-isolation requests;
- actual MTN/Airtel disbursement execution;
- real provider callback to financial posting/reconciliation;
- production employer callback delivery.

## 7. Security Evidence

### Implemented in source

Authentication/RBAC, tenant enforcement, input validation, idempotency, HMAC signatures, replay tolerance, encrypted webhook secrets, callback SSRF protection, audit records, bounded page size and sensitive-data filtering are wired into the payroll implementation.

### External verification still required

Real credentials/secrets, dependency audit, SAST/DAST, penetration testing, callback certification, production TLS, rate-limit/load testing, infrastructure hardening, backup/restore and regulatory review.

## 8. Remaining Issues

1. Provider composition is intentionally delegated to the existing service registry. The supplied archive does not provide executable dependency/runtime evidence proving that the production MTN/Airtel provider services are published under the payroll gateway's resolved service names in the live bootstrap context.
2. The canonical financial posting service must expose a payroll-compatible posting contract for automatic `financialPostingStatus=POSTED`; otherwise successful provider outcomes remain `REQUIRES_REVIEW` rather than being incorrectly treated as accounted.
3. Full application tests/builds require the repository's supported Node/npm/dependency environment.
4. The inbound `/webhooks` contract is a TITech boundary. Real provider signature format, callback fields and certification must be aligned with each provider's contracted API before production activation.
5. Payroll processing currently executes provider operations within the request workflow. High-volume enterprise deployments should place large batches behind an existing durable queue/worker path once that queue contract is proven, without adding a second transaction engine.

## 9. Production Blockers

The following prevent a “Production Approved” status in this snapshot:

- full automated test suite not executed;
- live backend/database/Redis startup not executed;
- provider credentials/certification not verified;
- financial gateway service binding not live-verified;
- production webhook secret management not exercised;
- production deployment/TLS/reverse-proxy/rollback/restore not exercised;
- independent security testing not executed.

## 10. Final Status

Using the evidence-based lifecycle from the supplied remediation requirements, the payroll implementation is **IMPLEMENTED**, with targeted **UNIT VERIFIED** evidence for the pure crypto/CSV boundary and **BLOCKED** for runtime/E2E/production approval gates that require the real dependency, infrastructure and provider environment.

| Area | Status | Evidence |
|---|---|---|
| Payroll module | IMPLEMENTED | Source + static syntax checks |
| CSV validation | UNIT VERIFIED | Crypto/CSV smoke + unit test files added |
| Webhook signing | UNIT VERIFIED | Crypto smoke; formal test execution blocked |
| RBAC | IMPLEMENTED | Route-level role guards + tenant enforcement |
| Tenant isolation | IMPLEMENTED | Trusted tenant resolution in payroll service/routes |
| Financial posting boundary | IMPLEMENTED | Separate posting state + canonical gateway adapter |
| Employer subscriptions | IMPLEMENTED | Encrypted-secret model + CRUD endpoints |
| Simulator/audit | IMPLEMENTED | Signed simulator + PlatformAudit integration |
| Official branding | IMPLEMENTED | Official theme import/runtime selector/token mapping |
| React warnings | IMPLEMENTED | Source fixes + regression test file |
| Backend startup | BLOCKED | Dependency/runtime execution not available |
| API connectivity | BLOCKED | Live service not exercised |
| Login / refresh | BLOCKED | Live service not exercised |
| Notifications | BLOCKED | Live service not exercised |
| MongoDB | BLOCKED | Live dependency not exercised |
| Redis | BLOCKED | Live dependency not exercised |
| Provider execution | BLOCKED | Real provider composition not verified |
| E2E | BLOCKED | Browser/dependency runtime not executed |
| Security verification | BLOCKED | Automated security suite / DAST not executed |
| Deployment | BLOCKED | Production topology not exercised |
| Production approval | BLOCKED | Evidence gates outstanding |
