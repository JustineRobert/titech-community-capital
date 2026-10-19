# TITech Capital LTD — Inclusive Onboarding Change Discovery

**Date:** 18 October 2026  
**Product:** TITech Community Capital  
**Source of truth:** Uploaded `titech-community-capital-main(2).zip` compared file-by-file with this updated checkout  
**Principle:** BUILD LESS. PROVE MORE. FINANCIAL CORRECTNESS BEFORE CONVENIENCE.

## 1. Delivery statement

This update adds a compatible implementation foundation for inclusive participant identity onboarding, refugee-serving organisation registration, insurance-institution/licence onboarding, private evidence storage, insurer-specific consent and minimum viable insurance workflow records, including role-gated reviewer forms for identity, partner and licence decisions. It extends the existing TITech KYC, consent, audit, tenant and RBAC boundaries rather than introducing another authentication system, tenant registry, KYC database, payment gateway or ledger.

This is **not** a claim that the repository is production-approved. The extracted source archive has no Git history, no installed dependencies, and no proof of live regulator, identity, insurer or payment-provider integrations. New capabilities default to disabled. Automated policy/source-contract tests are not substitutes for MongoDB/Redis integration tests, browser E2E tests, external security assessment or legal/regulatory approval.

The file comparison found **35 new implementation/documentation/test files** and **31 modified existing files** before this discovery report was added; this report itself is an additional new file, for **36 new files and 31 modified existing files** in the distributable change set. Generated `reports/` outputs from local static audits are excluded from the distributable source archive.

## 2. Step-by-step implementation discovery

### Step 1 — Preserve the canonical platform boundaries

- `backend/routes/index.js` mounts the new domain routers under the existing versioned API and canonical authentication/tenant-authorization middleware.
- `backend/middleware/platformPermissions.js` extends the existing role-to-permission map for participants, KYC reviewers, refugee-serving partner administrators and insurance operations. No parallel RBAC checker was introduced.
- `backend/middleware/capabilityFeatureFlag.js` is a shared fail-closed capability gate. New flags default off, and client-side state cannot activate them.
- `backend/.env.example` documents the feature flags, document encryption/storage configuration and identifier HMAC key without supplying secrets.
- Existing login/session, refresh-token and payment/ledger/reconciliation services are not replaced.

### Step 2 — Extend the existing KYC route for approved alternative credentials

- `backend/models/KYC.js` retains the national-ID route while allowing explicitly supported alternative credential records and more complete review states.
- `backend/modules/identity-onboarding/identity.policy.js` centralizes credential types, state transitions and the distinction between verification and service capability.
- `backend/modules/identity-onboarding/identityOnboarding.service.js` integrates with the existing KYC, Tenant, SecureDocument, ConsentRecord and audit services. It supports submission, protected identifier fingerprinting when configured, review, additional-information requests, correction/resubmission boundaries and appeals.
- `backend/modules/identity-onboarding/identityOnboarding.controller.js` and `identityOnboarding.routes.js` expose the guarded API. A reviewer cannot approve their own record or the submission they made. A provider error or pending review is not treated as verified.
- National ID remains available; refugee ID and asylum-seeker certificate routes do not require treating their document numbers as NINs.

### Step 3 — Add private evidence storage

- `backend/modules/secure-documents/secureDocument.model.js` stores opaque metadata and protected storage references.
- `backend/modules/secure-documents/secureDocument.service.js` provides a private encrypted file boundary using AES-256-GCM, integrity checks and private filesystem permissions. Supported file types are PDF/JPEG/PNG, with an enforced 10 MiB upload limit and file-signature checks.
- `backend/modules/secure-documents/secureDocument.controller.js` and `secureDocument.routes.js` enforce purpose, role, capability and tenant checks; downloads use non-cache headers and `nosniff`.
- Uploading a licence or claim file does not, by itself, grant the uploader broad read access. NGO compliance and insurance product activation uploads have explicit action-specific permissions.
- Malware scanning/content disarm, production storage infrastructure and backup/restore evidence remain outstanding gates; encrypted local storage alone is not sufficient proof of production readiness.

### Step 4 — Add refugee-serving organisation registration

- `backend/modules/refugee-partners/models/RefugeeServingOrganisationProfile.js` adds typed, tenant-scoped organisation details, review status and audit history.
- `backend/modules/refugee-partners/refugeePartner.service.js` and the associated controller/routes submit and review profiles with evidence references and separation-of-duties checks.
- Registration does not automatically grant access to participants or insurance information. A real data-sharing agreement and scoped permissions remain necessary.

### Step 5 — Add the insurance institutional and operating-domain foundation

New module: `backend/modules/insurance/`.

- `insurance.policy.js` defines licence and enrolment transitions, operational licence checks, claim review states, integer minor-unit validation and a hard-stop for live premium processing without an adapter.
- `models/InsuranceInstitutionProfile.js` stores typed organisation/licence information and review evidence.
- `models/InsuranceProduct.js` stores product/coverage references and terms versions; it is not an independent policy-authoring or actuarial-pricing system.
- `models/InsuranceEnrolment.js` separates an application from the insurer's eligibility decision, issued policy and active coverage state.
- `models/InsurancePremium.js` represents a premium obligation with tenant-scoped references, idempotency, integer money and evidence fields. It does not initiate payment or write balances.
- `models/InsuranceClaim.js` tracks a claim case and authoritative insurer decision/payout references. It does not perform automated claim adjudication.
- `insurance.service.js`, `insurance.controller.js` and `insurance.routes.js` add server-side licensed-operation checks, product activation controls, source-tenant KYC validation, purpose-specific active consent checks, explicit state transitions and audit events.
- Enrolment requires the canonical KYC record in the participant's source tenant to be currently verified, with a current verified credential. A client-entered status or arbitrary reference cannot replace the KYC lookup.
- Premium callbacks, ledger postings, settlement, reversals, refunds, and payout settlement remain blocked until a specific reviewed adapter uses the existing canonical financial path.

### Step 6 — Implement participant-specific consent

- The identity-onboarding service adds insurer resolution and a versioned notice in English, Swahili, French and Arabic.
- `GET /api/v1/participant-onboarding/insurance-recipients/:recipientTenantId?language={en,sw,fr,ar}` resolves the recipient from the tenant registry and requires a currently verified, non-expired insurer licence before displaying the consent notice.
- `GET /api/v1/participant-onboarding/insurance-consent?recipientTenantId=...` reads the authenticated participant's consent in their source tenant.
- `POST /api/v1/participant-onboarding/insurance-consent` records explicit self-service affirmation through the established consent service, including the exact notice text/version/language snapshot and audit evidence.
- `POST /api/v1/participant-onboarding/insurance-consent/:consentId/withdraw` permits the authenticated participant to withdraw their own relevant consent.
- Enrolment independently validates the active consent's purpose, recipient, required data categories and subject identity. An arbitrary consent reference cannot authorize cross-tenant data sharing.
- The new translations are drafts; qualified legal/linguistic approval is required before real participant use.

### Step 7 — Add frontend access inside the existing React application

- `frontend/src/App.jsx` adds the `/inclusive-onboarding` page using the existing protected routing pattern.
- `frontend/src/components/Navbar.jsx` adds a navigation entry inside the existing authenticated shell.
- `frontend/src/pages/inclusive-onboarding/InclusiveOnboardingPage.jsx` provides participant credential submission, insurer-specific consent, partner registration, identity-review and appeal forms, partner/licence decision forms, insurance-institution onboarding and basic product/enrolment/premium-obligation/claim reference screens. Forms call the API client rather than shipping hardcoded production data.
- `InclusiveOnboardingPage.css` styles the new page through existing TITech semantic theme tokens.
- `frontend/src/i18n/resources.js`, four `inclusive.json` catalogs and four `common.json` resources register language labels for English, Swahili, French and Arabic. Arabic inherits the current RTL direction handling.
- Full professional translation review and live browser/screen-reader/visual RTL verification remain outstanding.

### Step 8 — Apply the official organization name while retaining the product name

- `frontend/src/branding/brand.js`, `backend/shared/branding/brandConfig.cjs`, and the official theme/manifest assets already define **TITech Capital LTD** as the organization. The official nine-color palette and light/dark theme contract were retained; the new screen uses the token layer.
- `README.md`, root and backend `package.json`, environment documentation, and new module headings/documentation identify **TITech Capital LTD** as the organization and **TITech Community Capital** as the product.
- Existing runtime/application metadata defaults in `backend/app.js`, `backend/routes/authRoutes.js`, `backend/runtime/ServerRuntime.js`, admin controllers/services/utilities, `backend/commercial/index.js` and `backend/services/investorReportService.js` were updated where they represented the old legal/vendor name. Historical test-tenant names and product references are not globally rewritten.

### Step 9 — Add operational, privacy and migration-support documentation

- `docs/REFUGEE_INCLUSIVE_INSURANCE_IMPLEMENTATION.md` documents architecture, routes, flags, domain limits and readiness boundaries.
- `docs/REFUGEE_INCLUSIVE_INSURANCE_SECURITY_AND_PRIVACY.md` records assets, trust boundaries, threat scenarios, data minimization and unresolved security/privacy prerequisites.
- `docs/REFUGEE_INCLUSIVE_INSURANCE_RUNBOOK.md` documents safe setup, operator workflows, diagnostics, financial boundaries and rollback/disablement.
- `backend/scripts/createInclusiveInsuranceIndexes.js` provisions indexes on the new models against an explicitly configured database; it must be run only on a reviewed non-production database first.

## 3. File-by-file discovery

### New files — 36 including this report

| Folder | Files | Purpose |
|---|---|---|
| `backend/middleware/` | `capabilityFeatureFlag.js` | Fail-closed feature/capability gate |
| `backend/modules/identity-onboarding/` | `identity.policy.js`, `identityOnboarding.controller.js`, `identityOnboarding.routes.js`, `identityOnboarding.service.js` | Credential policy, KYC review, state-based capability and consent endpoints |
| `backend/modules/secure-documents/` | `secureDocument.model.js`, `secureDocument.service.js`, `secureDocument.controller.js`, `secureDocument.routes.js` | Encrypted private document metadata/storage/API |
| `backend/modules/refugee-partners/` | `models/RefugeeServingOrganisationProfile.js`, `refugeePartner.service.js`, `refugeePartner.controller.js`, `refugeePartner.routes.js` | Refugee-serving organisation registration and review |
| `backend/modules/insurance/` | `insurance.policy.js`, `insurance.service.js`, `insurance.controller.js`, `insurance.routes.js`, `models/InsuranceInstitutionProfile.js`, `models/InsuranceProduct.js`, `models/InsuranceEnrolment.js`, `models/InsurancePremium.js`, `models/InsuranceClaim.js` | Licensing, institutional onboarding, product, enrolment, premium-obligation and claim domain |
| `backend/scripts/` | `createInclusiveInsuranceIndexes.js` | Controlled index provisioning |
| `backend/tests/unit/inclusive-onboarding/` | `identity.policy.test.mjs`, `insurance.policy.test.mjs`, `route-contract.test.mjs` | Executable pure-policy and route/source-contract tests |
| `frontend/src/pages/inclusive-onboarding/` | `InclusiveOnboardingPage.jsx`, `InclusiveOnboardingPage.css` | Integrated user interface and styles |
| `frontend/src/i18n/locales/{en,sw,fr,ar}/` | `inclusive.json` in each locale | New workflow labels / draft translations |
| `docs/` | `REFUGEE_INCLUSIVE_INSURANCE_IMPLEMENTATION.md`, `REFUGEE_INCLUSIVE_INSURANCE_SECURITY_AND_PRIVACY.md`, `REFUGEE_INCLUSIVE_INSURANCE_RUNBOOK.md`, `REFUGEE_INCLUSIVE_INSURANCE_CHANGE_DISCOVERY_2026-10-18.md` | Implementation, threat/privacy, operational and file discovery documentation |

### Modified existing files — 31

| File | Change |
|---|---|
| `README.md` | Updated legal organization name, scope/status notice and documentation links; clearly marks external/production blockers |
| `package.json` | Added `test:inclusive-onboarding` and `db:indexes:inclusive-insurance`; author metadata uses TITech Capital LTD |
| `backend/package.json` | Author metadata and controlled index-provisioning script |
| `backend/.env.example` | Added disabled-by-default capability flags and secret/storage placeholders |
| `backend/middleware/platformPermissions.js` | Extended the existing canonical role-to-permission map |
| `backend/models/KYC.js` | Alternative credential support and explicit review states while retaining legacy NIN support |
| `backend/routes/index.js` | Mounted the new routes into the existing API registry under canonical auth and tenant middleware |
| `backend/app.js` | Updated legal organization fallback metadata |
| `backend/routes/authRoutes.js` | Updated application metadata default to the official organization name |
| `backend/runtime/ServerRuntime.js` | Updated runtime company fallback metadata |
| `backend/commercial/index.js` | Updated commercial company metadata |
| `backend/controllers/adminAnalytics.controller.js` | Updated application metadata default |
| `backend/controllers/adminAudit.controller.js` | Updated application metadata default |
| `backend/controllers/adminDashboard.controller.js` | Updated dashboard application label |
| `backend/controllers/adminManagement.controller.js` | Updated application metadata default |
| `backend/controllers/adminReports.controller.js` | Updated application metadata default |
| `backend/controllers/adminRisk.controller.js` | Updated application metadata default |
| `backend/controllers/adminSystem.controller.js` | Updated application metadata default |
| `backend/services/admin/adminDashboard.service.js` | Updated application metadata default |
| `backend/services/admin/adminManagement.service.js` | Updated application metadata default |
| `backend/services/admin/adminRisk.service.js` | Updated application/legal metadata wording |
| `backend/services/investorReportService.js` | Updated report author/footer legal name |
| `backend/utils/admin/adminDates.js` | Updated application metadata default |
| `backend/utils/admin/adminPagination.js` | Updated application metadata default |
| `frontend/src/App.jsx` | Added protected `/inclusive-onboarding` route |
| `frontend/src/components/Navbar.jsx` | Added protected-workflow navigation link |
| `frontend/src/i18n/resources.js` | Registered the inclusive workflow resource namespace across all supported languages |
| `frontend/src/i18n/locales/{en,sw,fr,ar}/common.json` | Added the navigation label in each language |

## 4. Tests and checks executed

All commands below ran against the updated source tree in this environment. These are source/policy/static checks unless the test specifically states otherwise.

| Command/check | Observed result | Interpretation |
|---|---|---|
| `npm run test:inclusive-onboarding` | **PASS — 15/15 tests** | Pure identity/licence/money/state policy and route/security source-contract tests; no database runtime is exercised |
| `npm run validate:syntax` | **PASS — 2,388 JS/TS-family source files parsed** | Syntax gate passes; warning remains because local Node is `22.16.0` while repository requires `>=24.15.0` |
| `npm run audit:theme` | **PASS** | Nine-color official theme contract passes; 60 frontend CSS files scanned; 0 hard-coded official palette occurrences outside the centralized token layer |
| `npm run i18n:check` | **PASS; production eligibility false** | 279 keys present in each of en/sw/fr/ar after the reviewer UI label additions; sw/fr/ar correctly marked pending human review |
| `npm run test:i18n:native` | **PASS — 9/9 tests** | English default, locale fallback/formatting and Arabic RTL direction contract pass |
| `npm run rbac:gate` | **PASS** | Existing repository RBAC security gate passes; does not replace route-level integration tests |
| `npm run check:financial` | **PASS — 12 canonical files** | Canonical financial static surface passed |
| `npm run test:financial:product-rules` | **PASS — 5/5 tests** | Existing financial product rule tests passed |
| `npm run check:conflicts` | **PASS — 3,271 files scanned** | No merge conflict markers |
| `npm run check:enterprise-contracts` | **PASS — 11 contracts** | Existing control-plane contract gate passed |
| `npm run check:runtime-imports` | **PASS for canonical financial surface** | Report still identifies 209 missing local imports in the broader backend inventory; not all legacy modules are proven import-clean |
| `npm run test:frontend-runtime` | **PASS — 2/2 tests** | Existing frontend runtime contract tests passed |
| `npm run audit:frontend-runtime` | **PASS WITH WARNING — 11 pass, 1 warning** | No `frontend/dist` artifact was present, so production bundle/browser runtime cannot be claimed |

### Not executed / not established

- `npm run build:frontend` was attempted and stopped with exit code 127 (`vite: not found`) because `node_modules`, `backend/node_modules` and `frontend/node_modules` are absent. No clean `npm ci` was run; the environment Node/npm (`22.16.0` / `10.9.2`) is also below repository engine requirements (`Node >=24.15.0`, `npm >=11.0.0`).
- No full backend/frontend Jest/Vitest suites or browser E2E suite because dependencies and a configured isolated test stack were not available in the source snapshot.
- No MongoDB integration, Redis integration, migration rehearsal or live startup/readiness test was executed.
- No real government identity provider, regulator verification API, insurer system or payment provider was configured or certified.
- No malware scanning, independent penetration test, data-protection impact review, legal opinion, pilot acceptance or formal production approval was evidenced.
- No Git commit/push was made; the supplied ZIP is not a Git checkout and GitHub was not modified.

## 5. Capability readiness matrix

| Capability | Actual state from this delivery | Evidence | Remaining blocker / permitted scope |
|---|---|---|---|
| Refugee ID / asylum-seeker credentials | **IMPLEMENTED; policy/static TESTED** | KYC service/model changes and unit policy tests | Do not claim end-to-end live identity verification; needs Mongo-backed workflow tests, approved document policy, reviewer SOP and real provider/manual-review acceptance |
| National ID route | **Preserved by source design; regression not run end to end** | Existing model/provider path retained; policy test covers coexistence | Run prior KYC/provider tests on Node 24 + isolated Mongo and provider sandbox |
| Assisted onboarding (online) | **IMPLEMENTED foundation** | Role-based paths, tenant check, private document references and static tests | Requires actual staff provisioning, partner-specific E2E and safeguarding review |
| Offline queue/synchronisation | **NOT IMPLEMENTED by this change** | No new offline command/event queue was added | Assisted onboarding requires a live connection for server submission; do not claim offline enrolment, offline KYC decisions, or sync/conflict/replay safety until the canonical offline engine is extended and tested |
| Consent/data-sharing | **IMPLEMENTED foundation; contract tested** | Versioned notice snapshot, grant/withdraw API and consent-service calls | Human/legal translation review, database-backed race and withdrawal tests, privacy notice/lawful-basis sign-off |
| Private evidence storage | **IMPLEMENTED source** | AES-GCM code, file signature checks, limits and permission gates | Production secret manager, secure filesystem, malware scanning/content disarm, encrypted backup/restore and penetration test |
| Refugee-serving organisation | **IMPLEMENTED foundation** | Profile, evidence and separate reviewer flow | Register/verify legitimate partners, validate agreement/authority and test data-sharing scope |
| Insurance institution / licence lifecycle | **IMPLEMENTED foundation; policy tested** | Typed profile, state transitions and fail-closed operational checks | Official-authority verification/manual-verification evidence, approved activities, agreements, independent reviewer and regulatory/legal review |
| Insurance product/coverage references | **IMPLEMENTED minimal reference domain** | Versioned source-of-truth references and gated activation | Integration with authoritative insurer product/coverage system and tested approval process |
| Insurance enrolment | **IMPLEMENTED service contract** | Current canonical KYC and source-tenant active consent validation | Real partner acceptance, database concurrency tests, external policy issuance feed and E2E tests |
| Premium tracking | **IMPLEMENTED obligation only** | Integer minor units, idempotency and readiness hard-stop | Payment initiation/settlement adapter, canonical `FinancialTransaction` → ledger → receipt/outbox → reconciliation flow and sandbox/prod evidence; live processing disabled |
| Claims administration | **IMPLEMENTED intake/reference workflow** | Case and insurer decision-reference fields; evidence is purpose protected | Authoritative insurer claims integration, clinical-sensitive data controls, claims decision/appeal SOP and operational testing |
| Payout and payout reconciliation | **NOT LIVE / BLOCKED** | No fake settlement or direct ledger effect is introduced | A reviewed canonical financial adapter and actual provider settlement evidence are required before implementation/activation |
| Official colors / themes | **STATIC AUDIT PASS** | Nine-color official contract and 60-file CSS token scan | Visual browser test of every screen and dark/light mode still required |
| English / Swahili / French / Arabic | **Resource parity PASS; translations pending review** | 256 locale keys each; native locale tests pass | Qualified language/legal review and end-to-end screen-reader, low-bandwidth and Arabic bidi/RTL testing |
| Production infrastructure / formal approval | **NOT ESTABLISHED** | No full build, DB/Redis, E2E, external approval or production deployment evidence | Complete all runtime, recovery, security, partner, legal, regulatory and financial gates before making a pilot/production claim |

## 6. Release and activation rules

- Keep all new feature flags set to `false` until the relevant policy, access-control, test, storage, legal and partner prerequisites are complete.
- `TITECH_INSURANCE_LIVE_PREMIUM_PROCESSING_ENABLED` and `TITECH_INSURANCE_LIVE_FINANCIAL_APPROVED` do not enable live processing by themselves. The service still returns a hard-stop until a reviewed canonical adapter is registered.
- Do not accept real refugee documents or claims evidence in development or automated tests.
- Do not describe a submitted KYC credential, uploaded licence, created enrolment, premium obligation, claim decision reference or payment request as verified identity, valid authorisation, active coverage, settled premium, approved claim or completed payout without authoritative evidence.
- Treat the current status as **IMPLEMENTED FOUNDATION — NOT PILOT READY — NOT PRODUCTION INFRASTRUCTURE READY — NOT PRODUCTION APPROVED**.
