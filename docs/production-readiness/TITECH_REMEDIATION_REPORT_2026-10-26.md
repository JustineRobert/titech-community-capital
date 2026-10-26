# TITech Community Capital — Remediation and Verification Report

**Assessment date:** 26 October 2026  
**Baseline archive:** `titech-community-capital-main(3).zip`, uploaded to the Library on 26 October 2026  
**Archive comment / source identifier:** `0e780d8d9090b62b33342fe8595e0863b63d840e`  
**Product identity:** TITech Community Capital  
**Organization identity:** TITech Capital LTD  
**Release status:** **PARTIAL IMPLEMENTATION — NOT PRODUCTION APPROVED**

## A. Executive result

This remediation makes a targeted lifecycle-identity correction, unifies the three public legal pages around a shared draft document source, adds login/create-account legal links and separate Terms/Privacy UI consent fields, and retains the supplied nine-color TITech theme. A targeted four-test regression suite passed twice in the available environment.

The exact startup incident has **not been reproduced against a live backend process** in this run. The source-level defect is consistent with the supplied `APPLICATION_LOCKED` trace: `ApplicationBootstrap.executePhase()` passes the bootstrap owner as the second argument to `implementation.start(this.context, this, signal)`, but the old middleware initializer accepted only `context` and selected `context.application` before `context.bootstrap?.application`, otherwise creating another Express app. The middleware now uses the provided bootstrap owner first and does not weaken the lifecycle lock. This remains a source-level remediation awaiting execution under the repository's declared runtime with real infrastructure.

The public legal pages and registration consent UI are implemented, but legal publication and production registration remain deliberately blocked. A final architecture review found the older `backend/services/termsAndPrivacy.js` and related files are a legacy, unmounted legal path; this change does **not** wire that legacy service into canonical auth. The existing canonical legal subsystem still needs verified registration-time document/version acceptance and audit persistence before production registration can be enabled.

## B. Root-cause assessment — `APPLICATION_LOCKED`

### Evidence in the source

1. `backend/bootstrap/ApplicationBootstrap.js` invokes a phase initializer as `implementation.start(this.context, this, signal)`.
2. Before this patch, `backend/bootstrap/middleware.js` accepted only `context` and resolved the app using `context.application || context.bootstrap?.application || express()`.
3. That ordering did not use the second, authoritative bootstrap-owner argument and allowed an old context alias or a newly constructed app to win over the lifecycle owner.
4. The lifecycle's `APPLICATION_LOCKED` guard is preserved. The patch fixes the app-resolution path instead of catching/suppressing the exception or disabling the guard.

### Implemented correction

- Added `backend/bootstrap/resolveCanonicalApplication.js` to select `bootstrap.getApplication()` / `bootstrap.application` before context aliases and to create a new app only when the canonical owner has none.
- Updated the canonical middleware phase initializer to accept the passed bootstrap argument and use the resolver before registering middleware.
- Added/updated deterministic tests for canonical-owner precedence, single construction, successful synthetic lifecycle initialization and continued rejection of replacing an application after lifecycle lock.

**Qualification:** the targeted suite is a deterministic lifecycle test, not evidence of a full Express process, HTTP listener, MongoDB/Redis startup or proof that the original exception is absent under the required runtime. The final disposition is therefore **likely source-level cause corrected; runtime confirmation BLOCKED**.

## C. Legal pages, account-creation controls and theme

### Shared legal content and routes

- Added `shared/legal/legalDocuments.json` as the shared source for `/legal`, `/terms` and `/privacy`. It preserves the identities `TITech Community Capital` and `TITech Capital LTD`, tracks the document version as a draft, and explicitly records `acceptanceIntegrationStatus: not-integrated` and `productionRegistrationEnabled: false`.
- Updated `frontend/src/legal/legalContent.js` to consume the shared source.
- Updated `frontend/src/routes/AppRoutes.jsx` to direct the three public routes to the shared legal-page components already present in `frontend/src/legal/LegalDocuments.jsx`.
- Updated `frontend/src/pages/Login.jsx` and `Register.jsx` to show shared legal links. Registration presents separate Terms acceptance and Privacy acknowledgement fields, includes the legal version in its client payload, and exposes the draft state.
- Updated the corresponding Login/Register CSS and legal-page CSS to consume the official semantic theme tokens.

### Server-side registration gate

`backend/controllers/authController.js` now has two explicit production gates: publication must be approved and the canonical legal acceptance integration must be verified. The code-level integration-ready switch remains `false`; the shared metadata also leaves registration disabled. Thus production registration fails closed even if someone changes the document status alone. This change **does not claim** that acceptance records or audit events are being persisted during signup. Enabling registration requires a follow-on implementation using the existing canonical legal subsystem and tests against its actual published document/version records, storage and audit events.

### Legal readiness

The legal content intentionally does not invent a registered address, registration number, effective date, monitored legal/privacy contact or complaints channel. A qualified legal/compliance review must confirm the organization’s corporate status, contractual authority, actual data flows, controller/processor roles, retention, transfer safeguards, data-subject request workflow, partner responsibilities and applicable-law terms before publication. The static release gate correctly remains **BLOCKED**.

### Official color themes

The official theme audit passed for all nine supplied values:

`#0030A0`, `#0058D8`, `#0066E8`, `#00B8F8`, `#008000`, `#A8F000`, `#F8D800`, `#082B67`, `#FFFFFF`.

It scanned 65 non-brand frontend CSS files and reported zero hard-coded official-palette color occurrences outside the centralized theme layer. This is static token-coverage evidence; it is not a screenshot-based visual QA or compiled-build check.

## D. Verification results

| Check | Result | Evidence / limit |
|---|---|---|
| `node --test backend/tests/bootstrap/application-lock-regression.test.mjs` | **PASS** | 4 tests passed, 0 failed, in each of two consecutive runs. `reports/evidence/2026-10-26/bootstrap-lock-regression-run-1.tap` and `...run-2.tap`. |
| `node --check` for changed backend/script JavaScript files | **PASS** | Individual syntax checks recorded in `syntax-and-jsx-parse.txt`; no full semantic/module-load claim. |
| TypeScript parser for changed JSX | **PASS — syntax only** | Login, Register, AppRoutes, LegalDocuments and LegalConsentFields had zero parse diagnostics; import resolution/Vite bundling was not checked. |
| `node scripts/official-theme-audit.mjs` | **PASS** | All nine official colors; zero hard-coded official palette occurrences across 65 scanned CSS files. |
| `node scripts/verify-titech-legal-branding.mjs` | **PASS** | Shared JSON parses; identities, draft status, required pages and palette references checked. |
| `node scripts/validate-patch-bundle.mjs` | **PASS** | Required overlay and legal files exist; draft state and design-token references validated. |
| `node scripts/enterprise-gate.mjs --structure` | **PASS — structure only** | This does not mean the platform's complete enterprise gate passed. |
| `node scripts/runtime-import-audit.mjs` | **PASS for canonical financial surface; warnings remain** | 2,028 backend files scanned; 209 missing local imports elsewhere; 0 missing local imports and 0 mixed-module violations on the canonical financial surface. See `reports/runtime-import-audit.json`. |
| `node scripts/verify-legal-release-gate.mjs` | **BLOCKED — expected** | Explicit legal approval/draft and API acceptance-persistence findings remain blocked. A static gate cannot establish legal correctness or live behavior. |
| Clean install / full Vite build / full backend build and test suite | **NOT RUN / BLOCKED** | Runtime mismatch: host Node `v22.16.0`, npm `10.9.2`; root/backend/frontend require Node `>=24.15.0`, npm `>=11.0.0`. No `node_modules` directories were present. |
| Actual backend startup, MongoDB/Redis integration, `/api/v1/health`, `/api/v1/ready`, real listener and repeated start/stop | **NOT RUN / BLOCKED** | Requires the supported runtime and isolated infrastructure; no live process result is claimed. |
| Vercel deployment / live route verification | **NOT RUN** | No deployment was attempted; the source archive does not update the currently deployed website by itself. |

## E. Security and financial-integrity assessment

**Preserved:** the canonical lifecycle lock, existing middleware chain, auth/session flow, tenant/RBAC model, existing ledger/payment/reconciliation source, and official theme contract. No provider activation, ledger rewrite, simulated payment proof, or regulatory assertion was introduced.

**Implemented in this scope:** canonical-app-first middleware resolution; a server-side fail-closed production legal registration gate; distinct consent fields and common legal links in the UI; draft status and explicit publication controls; semantic official-color token usage; static regression/audit evidence.

**Not proven:** actual production cookie/CSRF/CORS behavior, JWT/session revocation, tenant isolation, financial ledger invariants, idempotency/reversals, reconciliation, provider callbacks and settlement, MongoDB transaction/rollback correctness, backup/restore, load behavior, penetration test, deployed legal pages, or published legal acceptance/audit persistence.

## F. Remaining blockers and ordered next steps

### Immediate — runtime and lifecycle

1. Use Node `>=24.15.0` and npm `>=11.0.0`; install from the intended committed lockfile in a clean environment.
2. Re-run the regression test and import/bootstrap checks there. Reproduce startup against isolated MongoDB and Redis, capture logs with secrets redacted, probe the real health/readiness endpoints, and exercise dependency failure, rollback and repeated start/stop.
3. Run applicable backend/frontend builds, lint, unit, integration, authentication, tenant isolation, financial invariant and E2E suites; record actual exit codes.

### Required before production legal publication or registration

4. Implement and test the canonical auth → legal-document/version acceptance flow using the existing legal subsystem's actual persistence/repository/controller/service contracts. Acceptance must be server-validated, idempotent and auditable; failed persistence must not leave an account successfully registered without required evidence. Do not use the old unmounted legacy legal service.
5. Seed/publish the approved document and version records only via the established authorization/publication controls; prove the audit events, duplicate retries and failure behavior with MongoDB integration tests.
6. Complete verified company and support contact details, registered address/number where applicable, effective date, complaint channel, data-controller/processor roles, retention and cross-border/vendor details; obtain qualified review and document sign-off.
7. Once integration and review are proven, change the source-level registration gate in the same change that adds tests and evidence—not by editing the shared status flag alone.
8. Deploy only after the legal gate passes and verify all three live public URLs plus login/register links on the deployed instance.

### Later enterprise validation

Risk-rank the 209 non-critical import-audit warnings and resolve them as proof-led changes. Run security assessment, operational recovery drills, performance/load modelling, resilience/fault injection, accessibility and inclusive-onboarding checks. Do not claim multi-million or billion-user capability without measured workload evidence.

## G. Readiness and release decision

| Evidence stage | Status |
|---|---|
| Designed | **PASS** for this limited remediation |
| Implemented | **PASS** for the source changes listed in the change index |
| Unit-tested | **PARTIAL PASS** — four targeted tests pass twice |
| Integration-tested | **NOT PROVEN** |
| E2E-tested | **NOT PROVEN** |
| Operationally-tested | **NOT PROVEN** |
| Security-assessed | **NOT PROVEN** |
| Externally-approved | **NOT APPROVED / no evidence** |
| Production-approved | **NO — `productionApproved=false`** |

**Release decision:** the repository contains a targeted source-level fix and legal/branding improvements; the exact startup incident still requires real-runtime reproduction. A production pilot is **not justified by this evidence alone**. Keep legal publication and production registration blocked until the canonical acceptance service integration, legal review and runtime/operational proof are complete.
