# TITech Capital LTD — Repository Change Discovery and Implementation Handoff

**Date:** 18 October 2026  
**Product:** TITech Community Capital  
**Configured organization/legal-entity display name:** TITech Capital LTD  
**Source baseline:** user-supplied `titech-community-capital-main(1).zip`  
**Engineering principle:** BUILD LESS. PROVE MORE. FINANCIAL CORRECTNESS BEFORE CONVENIENCE.

## 1. Delivery and release decision

This package is an incremental change to the supplied repository snapshot. It has not been pushed to GitHub: the ZIP does not contain a verified `.git` worktree, and live access to `github.com` failed DNS resolution in this environment. The download is therefore the updated extracted repository package—not a claim that the remote repository branch has been changed. The final repository package contains **3,288 files**, compared with **3,268 files** in the supplied ZIP: **20 added, 19 modified, 0 deleted**. The delta is incremental and no existing file was removed.

**Current overall status: NOT READY. `PRODUCTION_APPROVED = NO`.** New retirement-support source is implemented and native/source-contract tested, but it has not completed database-backed integration, full dependency-backed testing, browser E2E, live provider verification, external institutional authorization, independent security assessment or operational recovery drills.

## 2. What was implemented

### Pensioners, retirement and NSSF/employer support

A new retirement-support vertical slice is implemented under `backend/modules/retirement/`. It supports tenant-scoped cases for Uganda government pension workflows, NSSF Uganda, employer-sponsored schemes and an explicitly named “other approved scheme” category; controlled review/verification states; evidence references; expected and reported employer/employee contribution records; remittance matching; separate authoritative scheme-credit status; support/finance referral cases; and attributable external decision references.

The API is mounted under `/api/v1/retirement-support` behind the existing authentication and tenant-authorization layers. Write routes use the existing capability-flag mechanism and the platform's current action-permission registry. The feature is disabled by default. It reuses the canonical user, tenant, KYC, secure-document and audit services. It does **not** create an alternate authentication system, tenant registry, KYC store, balance store or ledger.

Financial and source-of-truth boundaries are enforced in the new workflow:

- A submitted document is not automatically authentic or officially verified.
- The canonical TITech KYC record is checked before a case enters identity-verified state.
- Scheme verification requires a dedicated, permissioned action with an attributable source type/name/reference; generic state transitions cannot mark the scheme verified.
- Raw pension/scheme references are not persisted by this flow. Optional duplicate matching uses a dedicated 32-byte HMAC secret; its fingerprint and active duplicate key are removed from API JSON.
- Expected contribution records are unique per case and period. Duplicate writes map to a controlled conflict.
- Employer remittance matching remains separate from official pension-scheme member-account credit.
- Financial-support applications are referral/application records. They do not approve loans, create ledger entries, initiate payments or claim a payout has settled.
- Retirement evidence uses private document storage and requires a retirement case permission to download it; contribution-read permission alone is insufficient.

### Refugee-inclusive KYC and insurance onboarding

The supplied baseline already contains alternative identity credentials, refugee/asylum-seeker workflows, refugee-serving-partner onboarding, insurance institution/licence lifecycle, insurance enrolment/premium/claim workflow foundations, versioned consent, RTL/localization resources and purpose-scoped private documents. Those areas were **preserved**, not replaced with parallel modules. Their inclusive-onboarding regression suite was rerun. This implementation pass only modified the existing inclusive-onboarding route-contract test to account for the new `RETIREMENT_SUPPORT_EVIDENCE` purpose.

This does not establish live NIRA, regulator, NSSF or insurer connectivity or prove that a partner’s regulatory authority exists.

### Frontend, localization and official theme

The new page is added to the existing React application at `/retirement-support`, behind the existing protected route and linked through the canonical navbar. It uses TITech’s shared CSS custom properties rather than a new colour palette. Existing language infrastructure is extended for English, Swahili, French and Arabic.

The repository already had the TITech official brand configuration. `TITech Capital LTD` was already the configured legal-entity display name in the supplied snapshot and is preserved; `TITech Community Capital` remains the product name. No logo or official palette values were replaced.

### Operational and documentation changes

An explicit index-creation script and package commands were added. The platform truth and the new retirement architecture/change-discovery documents now describe the implemented scope, actual tests, settings needed, and external blockers. Static gate outputs from this run are included under `reports/` for traceability.

## 3. Folder-by-folder discovery and exact paths

The companion file-change index is `docs/evidence/implementation-file-delta-2026-10-18.csv`. It compares the final package against the supplied ZIP and lists every added or modified path with baseline/updated SHA-256 hashes and byte sizes. The index leaves its own updated SHA-256 blank to avoid an impossible self-referential checksum; the delivered ZIP SHA-256 is separately provided.

### Backend — retirement domain

- `backend/modules/retirement/retirement.policy.js` — canonical supported scheme/case/state values, allowed transitions, integer monetary validation and provider-outcome attribution.
- `backend/modules/retirement/retirement.service.js` — tenant/user assertions, server-configured privacy policy, case lifecycles, HMAC fingerprinting, private evidence validation, duplicate protection, contribution comparison, scheme-credit evidence, financial-support referral and readiness disclosure.
- `backend/modules/retirement/retirement.controller.js` — API adapters and permission-derived UI capabilities.
- `backend/modules/retirement/retirement.routes.js` — capability-gated routes and action-level permissions.
- `backend/modules/retirement/models/RetirementSupportCase.js` — case, privacy acknowledgement, provenance and bounded history records.
- `backend/modules/retirement/models/RetirementContributionRecord.js` — expected/reported contribution records and a unique case-period index.
- `backend/modules/retirement/models/RetirementFinancialSupportApplication.js` — non-payment financial support referral records and attributed provider outcomes.

### Backend — platform integration and data protection

- `backend/routes/index.js` — mount the retirement routes under the canonical API prefix, authentication and tenant authorization.
- `backend/middleware/platformPermissions.js` — add retirement action permissions and scoped role mappings to existing RBAC.
- `backend/modules/secure-documents/secureDocument.controller.js` — allow retirement evidence upload only under its capability/permission rules; restrict downloads to case-read/review permissions or the document subject.
- `backend/modules/secure-documents/secureDocument.model.js` — add the retirement-support evidence purpose to the existing private-document purpose schema.
- `backend/.env.example` — disabled-by-default retirement flag and blank privacy notice version, processing basis and dedicated reference-HMAC key.
- `backend/scripts/createRetirementSupportIndexes.js` — controlled index setup for the three retirement collections.
- `backend/package.json` and root `package.json` — index command and native retirement test command/CI inclusion.

### Frontend — canonical app, UI and locale resources

- `frontend/src/App.jsx` — protected route integration.
- `frontend/src/components/Navbar.jsx` — retirement-support navigation entry.
- `frontend/src/pages/retirement-support/RetirementSupportPage.jsx` — case intake/status, private evidence submission, current privacy-notice acknowledgement, support referrals, case review, scheme verification, contribution setup/reconciliation and official credit evidence forms.
- `frontend/src/pages/retirement-support/RetirementSupportPage.css` — responsive page styles using the official semantic theme token layer.
- `frontend/src/i18n/locales/{en,sw,fr,ar}/common.json` — translated navbar key.
- `frontend/src/i18n/locales/{en,sw,fr,ar}/inclusive.json` — retirement page labels, messages and status names. English is canonical; other translations are not marked as legal/linguistic approvals.

### Tests, evidence and documentation

- `backend/tests/unit/retirement/retirement.policy.test.mjs` — state/amount/provider policy tests.
- `backend/tests/unit/retirement/retirement.integration-contract.test.mjs` — API mounting, privacy config, authorization, document scope, HMAC disclosure, contribution uniqueness and financial-boundary source-contract tests.
- `backend/tests/unit/inclusive-onboarding/route-contract.test.mjs` — adjust the private-document purpose allowlist assertion for the new retirement evidence purpose.
- `docs/retirement/RETIREMENT_SUPPORT_ARCHITECTURE.md` — API, policy, state and readiness boundary documentation.
- `TITECH_PLATFORM_TRUTH.md` — focused 18 October evidence and release-blocker addendum.
- `reports/frontend-runtime-audit.json`, `reports/i18n-coverage-2026-10-17.json`, `reports/official-theme-audit.json`, `reports/rbac-security-gate.json`, `reports/runtime-import-audit.json` — results captured from the executed static/native gates.

## 4. Verification results from this run

| Command / gate | Observed result | Interpretation |
|---|---|---|
| `node --test backend/tests/unit/retirement/retirement.policy.test.mjs backend/tests/unit/retirement/retirement.integration-contract.test.mjs backend/tests/unit/inclusive-onboarding/*.test.mjs` | PASS — 31/31 | Native policy and source-contract coverage, not database or browser E2E. |
| `node --test scripts/i18n-core.test.mjs` | PASS — 9/9 | Native localization-core tests. |
| `node scripts/official-theme-audit.mjs` | PASS — 21 checks | Nine-color palette and theme contract; 61 CSS files; zero hardcoded official palette values in scanned non-brand CSS. |
| `node scripts/i18n-validation.mjs` | PASS — 24 checks | 420/420 keys per locale; English canonical; Swahili/French/Arabic pending human review; production eligibility false. |
| `node scripts/enterprise-gate.mjs --syntax` | PASS — 2,399 JS/TS-family files parsed | Runtime warning: available Node 22.16.0 is below target Node 24.15.x. |
| `node scripts/check-conflicts.js` | PASS — 3,288 files scanned | No merge-conflict markers. |
| `node scripts/financial-static-gate.mjs` | PASS — 12 canonical financial files | Static checks only; no financial golden path executed. |
| `node scripts/enterprise-contract-contracts.mjs` | PASS — 11 contracts | Static contract gate. |
| `node scripts/rbac-security-gate.mjs` | PASS | Static gate; no live cross-tenant HTTP validation. |
| `node scripts/frontend-runtime-audit.mjs` | PASS with warning | No `frontend/dist` bundle in source snapshot. |
| `node scripts/runtime-import-audit.mjs` | PASS for canonical financial surface; WARN overall | 0 missing imports/0 mixed-module violations on canonical financial surface; 209 legacy/non-critical missing imports elsewhere. |
| `npm run build:frontend` | BLOCKED, exit 127 (`vite: not found`) | Dependencies absent. |
| `npm run test:backend:ci` | BLOCKED, exit 1 (Jest module missing) | Dependencies absent; executed on Node 22.16.0. |
| `npm run test:frontend:ci` | BLOCKED, exit 127 (`vitest: not found`) | Dependencies absent. |
| `npm run lint` | BLOCKED, exit 127 (`eslint: not found`) | Dependencies absent. |
| `node scripts/production-approval-gate.mjs` | BLOCKED, exit 1 | Required protected evidence variables `TITECH_PRODUCTION_APPROVAL`, `TITECH_APPROVAL_REFERENCE`, `TITECH_APPROVAL_EXPIRES_AT` were not supplied. |

The repository declares Node `>=24.15.0` and npm `>=11.0.0`; the available environment is Node `v22.16.0`, npm `10.9.2`, and root/backend `node_modules` are absent. No backend server, MongoDB/Redis persistence, index creation, live document upload, browser E2E, identity/provider integration or live payment operation was exercised.

## 5. Current capability/readiness matrix

| Capability | Source state | What has been proven here | Not established |
|---|---|---|---|
| Retirement case intake/review | Implemented | State/policy/source-contract tests, protected API mount | Runtime API, database, documents, queue UX under live app |
| Canonical identity check | Implemented | Service checks existing KYC status | NIRA/government identity provider access |
| Scheme verification | Implemented as attributed manual/provider-result boundary | Invalid generic verification transition denied by tests | Official government/NSSF confirmation or valid API contract |
| Employer contribution evidence | Implemented | Safe-integer amounts, unique case-period index contract, remittance vs scheme-credit separation | Database index creation, real payroll feeds, NSSF credit statement integration |
| Financial support | Referral/application only | Attributed provider outcomes and no shadow-ledger import checked | Licensed product decisions, legally authorized repayment/deduction, provider/live-money integration |
| Refugee-inclusive KYC | Baseline foundation preserved | Existing KYC/inclusive regression contracts | Real identity provider, live pilot/legal acceptance |
| Insurance institution onboarding | Baseline foundation preserved | License lifecycle and enrolment/premium/claim contract checks in existing suite | Regulator/licence source integration, live premium/payment/claim/payout proof |
| English/Swahili/French/Arabic | Resource integration present | 420 keys per locale; Arabic locale registered; validator passes | Qualified language/legal review and browser accessibility/RTL E2E |
| Official TITech theme | Existing official theme preserved and audited | 21/21 audit checks; 61 CSS files; color reference asset verified | Visual human review on all browsers and production bundle |
| Overall platform | **NOT READY** | Source/static/native evidence only | Target runtime, dependencies, full CI, production runtime, external/operational approvals |

## 6. Required next actions, in order

1. **Use the supported toolchain:** Node 24.15.x and npm 11.x; install locked dependencies with `npm run install:all` in an environment with registry access.
2. **Run full validation:** `npm run check`, `npm run test:ci`, `npm run build:frontend`, `npm run test:e2e`, then repair genuine failures without weakening gates. Also run backend-specific Jest tests and provider/database integration tests.
3. **Set up an isolated staging database:** review the proposed indexes, back up staging, configure `MONGODB_URI` securely, then run `npm run db:indexes:retirement-support`; verify index existence, uniqueness under concurrency and rollback/recovery.
4. **Keep the retirement feature disabled** until legal/privacy owners approve the notice and processing basis. Configure a dedicated 32-byte base64 HMAC key only through the deployment secret manager, never by reusing JWT or document-encryption keys.
5. **Obtain written external authorization** for each live government pension, NSSF, identity, payroll, insurer and payment connection. Implement only the documented live adapter, then pass sandbox, settlement, reconciliation and security tests. Until then, use properly authorized assisted/manual workflows and clearly attribute each source.
6. **Complete privacy and security gates:** DPIA where required/appropriate, controller/processor and sharing agreements, retention policy, non-English legal/privacy translation review, independent security testing, document-access testing, data-subject-right workflows, incident and support runbooks.
7. **Verify operational recovery:** backups/restore drills, deployment rollback/feature disablement, monitoring/alerts, MongoDB/Redis failure tests and browser E2E with least-privilege actors and cross-tenant denial.
8. **Obtain partner/pilot and formal release approval.** Do not set `PRODUCTION_APPROVED=true` solely because source or local tests pass.

## 7. Explicit scope limits

This change does not add a live government pension/HCM/IPPS adapter, NSSF member API, NIRA connection, employer payroll feed, live payment/deduction interface, pension balance source or statutory benefit adjudicator. It does not provide dynamic administrator-managed arbitrary-scheme policy registration yet; supported scheme categories are currently an explicit allowlist. Benefit and survivor tasks are handled as case types, not as an official claims adjudication engine. The existing insurer and refugee modules are preserved/regression-tested, not certified for production by this change.

**Central promise:** improve access to organized retirement and employee-finance support through traceable evidence and controlled workflows, without claiming authority TITech has not established.
