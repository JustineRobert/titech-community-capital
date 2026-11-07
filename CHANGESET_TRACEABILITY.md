# Change traceability — 2026-11-07

**Organization:** TITech Capital SMC LTD  |  **Product:** TITech Community Capital  |  **Tagline:** BUILD LESS. PROVE MORE.
**Input ZIP SHA-256:** `eee19b22910a4d35f9c1472c5a93c6d50636471fd6ff2bb0ccc4eb564c5e06ee`

## Snapshot comparison

- Baseline files: **3516**
- Updated files: **3544**
- Added files: **28**
- Modified files: **115**
- Removed files: **0**
- Baseline is the extracted user ZIP; the ZIP has no Git metadata, so this is not a commit-based diff.

## Added paths

- `CHANGESET_TRACEABILITY.md` — Full file-level comparison against the uploaded ZIP baseline.
- `PRODUCT_POSITIONING.md` — Product positioning and required non-wallet/non-lender/provider-neutral/offline-first/multi-tenant boundaries.
- `TITECH_IMPLEMENTATION_INVENTORY.md` — Reusable existing capabilities, actual EduFinance scope and technical debt inventory.
- `TITECH_PLATFORM_TRUTH.md` — Root-level index to detailed platform history and machine-generated source evidence.
- `backend/modules/edufinance/eduFinance.controller.js` — New guarded EduFinance intake policy, Mongoose record, service and route/controller boundary; no credit or money movement.
- `backend/modules/edufinance/eduFinance.policy.js` — New guarded EduFinance intake policy, Mongoose record, service and route/controller boundary; no credit or money movement.
- `backend/modules/edufinance/eduFinance.routes.js` — New guarded EduFinance intake policy, Mongoose record, service and route/controller boundary; no credit or money movement.
- `backend/modules/edufinance/eduFinance.service.js` — New guarded EduFinance intake policy, Mongoose record, service and route/controller boundary; no credit or money movement.
- `backend/modules/edufinance/models/EduFinanceApplication.js` — New guarded EduFinance intake policy, Mongoose record, service and route/controller boundary; no credit or money movement.
- `backend/scripts/createEduFinanceIndexes.js` — Explicit index creation script; not run against live database.
- `backend/tests/unit/edufinance/eduFinance.policy.test.mjs` — EduFinance policy and route-contract regression tests.
- `backend/tests/unit/edufinance/eduFinance.route-contract.test.mjs` — EduFinance policy and route-contract regression tests.
- `docs/edufinance/EDUFINANCE_IMPLEMENTATION_AND_GATES_2026-11-07.md` — EduFinance scope, controls and future evidence gates.
- `docs/evidence/FINAL-IMPLEMENTATION-REPORT-2026-11-07.md` — Final report with actual implementation scope, tests and release blockers.
- `docs/evidence/TITech_Implementation_Change_Discovery_2026-11-07.md` — Step-by-step folder/file change discovery and progress analysis.
- `docs/evidence/change-summary-2026-11-07.json` — Machine-readable snapshot diff and readiness summary.
- `docs/evidence/changeset-checksums-2026-11-07.csv` — Before/after SHA-256 manifest for changed source and documents.
- `docs/evidence/critical-gates-2026-11-07.json` — Current eight-gate critical release contract; blockers retained.
- `docs/evidence/zero-byte-resolution-report-2026-11-07.md` — Zero-byte and legacy-empty-test disposition.
- `docs/evidence/zero-byte-source-inventory-2026-11-07.csv` — All zero-byte files classified for ownership/import review, without blind edits.
- `frontend/src/pages/edufinance/EduFinancePage.jsx` — EduFinance informational page using official theme tokens.
- `frontend/src/pages/edufinance/edufinance.css` — EduFinance informational page using official theme tokens.
- `reports/i18n-coverage-2026-11-07.json` — Generated audit outputs and command log from this execution.
- `reports/official-theme-audit.json` — Generated audit outputs and command log from this execution.
- `reports/release-readiness.json` — Generated audit outputs and command log from this execution.
- `reports/runtime-import-audit.json` — Generated audit outputs and command log from this execution.
- `reports/test-discovery-audit.json` — Generated audit outputs and command log from this execution.
- `reports/verification-run-2026-11-07.txt` — Generated audit outputs and command log from this execution.

## Modified paths

- `.github/workflows/deploy.yml` — Workflow organization metadata alignment; CI/deployment was not executed.
- `.gitignore` — Supporting identity/configuration alignment in an existing module; compare against the baseline file hash in the manifest.
- `README.md` — Current archive-local status and organization/product identity; older dated status entries preserved.
- `backend/.env.example` — Current organization metadata and default-off EduFinance controls.
- `backend/.env.production.example` — Current organization metadata and default-off EduFinance controls.
- `backend/app.cjs` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/app.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/backup/scripts/backup-db.sh` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/backup/scripts/restore-db.sh` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/backup/scripts/verify-backup.sh` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/bootstrap/environment.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/commercial/index.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/config/index.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/config/swagger.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/config/swaggerConfig.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/controllers/adminAnalytics.controller.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/controllers/adminAudit.controller.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/controllers/adminDashboard.controller.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/controllers/adminManagement.controller.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/controllers/adminReports.controller.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/controllers/adminRisk.controller.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/controllers/adminSystem.controller.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/legal/controllers/legalController.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/middleware/Performance/compression.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/middleware/platformPermissions.js` — Applicant-own read/create permissions and applicant role integrated into existing RBAC.
- `backend/middleware/resilience/gracefulDegradation.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/modules/identity-onboarding/identity.policy.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/modules/identity-onboarding/identityOnboarding.service.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/modules/meetings/meeting.service.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/modules/meetings/models/Meeting.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/modules/offline/controllers/offlineSyncController.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/modules/offline/models/OfflineDevice.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/modules/offline/models/OfflineEvent.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/modules/offline/routes/offline-sync.routes.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/modules/offline/services/offlineDeviceService.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/modules/offline/services/offlineReceiptService.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/modules/offline/services/offlineSyncService.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/modules/payment/index.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/modules/ubuntu-float/domain/capabilities.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/modules/ubuntu-float/tests/ubuntuFloatRules.test.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/package.json` — EduFinance test and database-index scripts connected to existing npm workflow.
- `backend/routes/authRoutes.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/routes/index.js` — EduFinance API mounted inside the canonical authenticated and tenant-authorized route registry.
- `backend/routes/index.test.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/routes/institutionalLead.routes.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/runtime/ServerRuntime.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/runtime/context.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/services/admin/adminDashboard.service.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/services/admin/adminManagement.service.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/services/admin/adminRisk.service.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/services/financial/money.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/services/investorReportService.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/shared/branding/brandConfig.cjs` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/tests/unit/inclusive-onboarding/offline-contract.test.mjs` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/tests/unit/utils/validateInput.test.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/utils/admin/adminDates.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `backend/utils/admin/adminPagination.js` — Current organization metadata updated in existing backend workflow; canonical security/financial architecture preserved.
- `branding/BRAND_MANIFEST.json` — Current canonical company/profile display name and brand manifest; official nine-color palette retained.
- `branding/TITECH_OFFICIAL_THEME.json` — Current canonical company/profile display name and brand manifest; official nine-color palette retained.
- `branding/TITECH_ORGANIZATION_PROFILE.json` — Current canonical company/profile display name and brand manifest; official nine-color palette retained.
- `docs/evidence/platform-truth.json` — Supporting identity/configuration alignment in an existing module; compare against the baseline file hash in the manifest.
- `docs/evidence/production-readiness.md` — Supporting identity/configuration alignment in an existing module; compare against the baseline file hash in the manifest.
- `docs/legal/PRIVACY_POLICY_DRAFT_2026-10-25.md` — Current draft operator name updated to SMC LTD; draft status and legal/documentary-verification warning retained.
- `docs/legal/TERMS_OF_SERVICE_DRAFT_2026-10-25.md` — Current draft operator name updated to SMC LTD; draft status and legal/documentary-verification warning retained.
- `frontend/.env.production.example` — Current organization display identity and theme-token integration; existing UI architecture preserved.
- `frontend/src/App.jsx` — EduFinance route registered in existing React Router configuration.
- `frontend/src/branding/brand.js` — Current organization display identity and theme-token integration; existing UI architecture preserved.
- `frontend/src/components/Navbar.jsx` — EduFinance navigation link added to existing navigation component.
- `frontend/src/components/ui/index.js` — Current organization display identity and theme-token integration; existing UI architecture preserved.
- `frontend/src/i18n/locales/ar/education.json` — EduFinance locale resources added in existing namespace; human translation and RTL review remain pending.
- `frontend/src/i18n/locales/ar/inclusive.json` — EduFinance locale resources added in existing namespace; human translation and RTL review remain pending.
- `frontend/src/i18n/locales/en/education.json` — EduFinance locale resources added in existing namespace; human translation and RTL review remain pending.
- `frontend/src/i18n/locales/en/inclusive.json` — EduFinance locale resources added in existing namespace; human translation and RTL review remain pending.
- `frontend/src/i18n/locales/fr/education.json` — EduFinance locale resources added in existing namespace; human translation and RTL review remain pending.
- `frontend/src/i18n/locales/fr/inclusive.json` — EduFinance locale resources added in existing namespace; human translation and RTL review remain pending.
- `frontend/src/i18n/locales/sw/education.json` — EduFinance locale resources added in existing namespace; human translation and RTL review remain pending.
- `frontend/src/i18n/locales/sw/inclusive.json` — EduFinance locale resources added in existing namespace; human translation and RTL review remain pending.
- `frontend/src/legal/Disclaimer.jsx` — Configured organization name aligned; legal copy remains draft and pending external review.
- `frontend/src/legal/LegalDocuments.jsx` — Configured organization name aligned; legal copy remains draft and pending external review.
- `frontend/src/legal/PrivacyPolicy.jsx` — Configured organization name aligned; legal copy remains draft and pending external review.
- `frontend/src/legal/TermsOfService.jsx` — Configured organization name aligned; legal copy remains draft and pending external review.
- `frontend/src/legal/documents/FinancialDisclaimer.jsx` — Configured organization name aligned; legal copy remains draft and pending external review.
- `frontend/src/legal/documents/GeneralDisclaimer.jsx` — Configured organization name aligned; legal copy remains draft and pending external review.
- `frontend/src/legal/documents/PrivacyPolicy.jsx` — Configured organization name aligned; legal copy remains draft and pending external review.
- `frontend/src/legal/documents/TermsOfService.jsx` — Configured organization name aligned; legal copy remains draft and pending external review.
- `frontend/src/legal/index.js` — Configured organization name aligned; legal copy remains draft and pending external review.
- `frontend/src/legal/legalAcceptance.js` — Configured organization name aligned; legal copy remains draft and pending external review.
- `frontend/src/legal/legalApi.js` — Configured organization name aligned; legal copy remains draft and pending external review.
- `frontend/src/legal/legalConfig.js` — Configured organization name aligned; legal copy remains draft and pending external review.
- `frontend/src/legal/legalConstants.js` — Configured organization name aligned; legal copy remains draft and pending external review.
- `frontend/src/legal/legalRoutes.js` — Configured organization name aligned; legal copy remains draft and pending external review.
- `frontend/src/legal/legalTypes.js` — Configured organization name aligned; legal copy remains draft and pending external review.
- `frontend/src/main.jsx` — Current organization display identity and theme-token integration; existing UI architecture preserved.
- `frontend/src/pages/Legal.jsx` — Current organization display identity and theme-token integration; existing UI architecture preserved.
- `frontend/src/pages/Login.jsx` — Current organization display identity and theme-token integration; existing UI architecture preserved.
- `frontend/src/pages/PrivacyPolicy.jsx` — Current organization display identity and theme-token integration; existing UI architecture preserved.
- `frontend/src/pages/Register.jsx` — Current organization display identity and theme-token integration; existing UI architecture preserved.
- `frontend/src/pages/admin/AdminDashboard.css` — Current organization display identity and theme-token integration; existing UI architecture preserved.
- `frontend/src/pages/education-support/EducationCampaignManagerPage.jsx` — Current organization display identity and theme-token integration; existing UI architecture preserved.
- `frontend/src/pages/education-support/EducationSupportPage.jsx` — Current organization display identity and theme-token integration; existing UI architecture preserved.
- `frontend/src/pages/inclusive-onboarding/InclusiveOnboardingPage.jsx` — Current organization display identity and theme-token integration; existing UI architecture preserved.
- `frontend/src/pages/meetings/Meetings.jsx` — Current organization display identity and theme-token integration; existing UI architecture preserved.
- `frontend/src/pages/public/InstitutionalPublicPages.jsx` — Current organization display identity and theme-token integration; existing UI architecture preserved.
- `frontend/src/pages/retirement-support/RetirementSupportPage.jsx` — Current organization display identity and theme-token integration; existing UI architecture preserved.
- `frontend/src/pages/ubuntu-float/UbuntuFloatPage.jsx` — Current organization display identity and theme-token integration; existing UI architecture preserved.
- `package.json` — EduFinance test and database-index scripts connected to existing npm workflow.
- `scripts/apply-titech-legal-brand-patches.mjs` — Machine truth or identity/release gate aligned to canonical organization/profile and evidence semantics.
- `scripts/official-theme-audit.mjs` — Machine truth or identity/release gate aligned to canonical organization/profile and evidence semantics.
- `scripts/organization-profile-gate.mjs` — Machine truth or identity/release gate aligned to canonical organization/profile and evidence semantics.
- `scripts/platform-truth.mjs` — Machine truth or identity/release gate aligned to canonical organization/profile and evidence semantics.
- `scripts/titech-critical-gates.mjs` — Machine truth or identity/release gate aligned to canonical organization/profile and evidence semantics.
- `scripts/validate-patch-bundle.mjs` — Machine truth or identity/release gate aligned to canonical organization/profile and evidence semantics.
- `scripts/verify-titech-legal-branding.mjs` — Machine truth or identity/release gate aligned to canonical organization/profile and evidence semantics.
- `shared/legal/legalDocuments.json` — Configured organization name aligned; legal copy remains draft and pending external review.
- `tests/integration/goldenMoneyPath/goldenMoneyPath.fixtures.js` — Current organization name aligned in test fixture; established assertions retained.

## Deleted paths

- None. No baseline path was deleted.

## Traceability and preservation

- No Git commit was created and no remote repository was pushed or overwritten.
- The uploaded original ZIP remains unchanged outside the updated worktree.
- Current public-facing organization/configuration is aligned to TITech Capital SMC LTD. Dated historical reports/prompts are retained as historical records; current draft legal notices were updated but remain unapproved.
- `docs/evidence/changeset-checksums-2026-11-07.csv` lists baseline and updated SHA-256 for changed source and stable documents. Generated `reports/*`, `docs/evidence/platform-truth.json` and the checksum CSV itself are omitted because they are regenerated/self-referential.
- The updated project ZIP hash should be used to verify the delivered archive as a whole.
