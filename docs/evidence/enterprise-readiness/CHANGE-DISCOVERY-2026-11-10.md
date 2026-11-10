# TITech Community Capital — Change Discovery, 10 November 2026

**Input:** `titech-community-capital-main.zip`  
**Input SHA-256:** `b5a71bf9d2e74d55dac5e61d0c93be1a265e75cb6abaae09335e40acbe782aad`  
**Product:** TITech Community Capital  
**Current organization:** TITech Capital SMC LTD  
**Method:** compare each extracted file path/content SHA-256 with the supplied ZIP; no Git repository was present.  
**Note:** file-level modifications include official-identity propagation through active runtime/configuration and the focused remediations described in the execution report. Dated historical evidence files were preserved where they represented a prior point-in-time record.

## 1. Change summary

| Change type | Files |
|---|---:|
| Modified | 137 |
| Added | 22 |
| Removed | 0 |
| Current regular files | 3622 |

No source files were removed by this remediation. No destructive database migration was introduced.

## 2. Step-by-step folder discovery

1. Start at the repository root and review `README.md`, `TITECH_PLATFORM_TRUTH.md`, `PRODUCT_POSITIONING.md` and the root/package runtime manifests. The README has a new 10 November status notice; the old dated reports remain visible as historical entries.
2. Review `branding/` for the canonical organization profile and theme contracts. The product name and nine-colour palette remain unchanged; the organization is now configured as **TITech Capital SMC LTD**.
3. Review `backend/security/`, `backend/models/` and `backend/utils/admin/` for canonical role/permission updates, then `backend/modules/payroll/` and `backend/routes/` for route permission enforcement and the payroll service integration.
4. Review `backend/modules/insurance/` and `backend/modules/consent/` for MongoDB session propagation and transactional insurer audit writes.
5. Review `frontend/src/pages/Payroll.jsx` and `frontend/src/__tests__/payroll/` for user-facing report error-state handling and role-specific presentation.
6. Review `.github/`, backend/frontend environment examples, deployment and backup scripts for active organization metadata alignment. Historical archive folders and prior dated evidence retain their original identity values.
7. Review `scripts/` and `reports/` for current gate/audit outputs. Raw selected test and static gate command output is in `docs/evidence/enterprise-readiness/raw/`.
8. Review `docs/evidence/enterprise-readiness/` for the current execution report, implementation inventory, test evidence and this path-by-path manifest.

## 3. Folder-level totals

| Top-level folder | Modified | Added | Removed |
|---|---:|---:|---:|
| `(root)` | 5 | 0 | 0 |
| `.github` | 1 | 0 | 0 |
| `backend` | 63 | 3 | 0 |
| `branding` | 3 | 0 | 0 |
| `docs` | 16 | 9 | 0 |
| `frontend` | 38 | 0 | 0 |
| `patches` | 1 | 0 | 0 |
| `reports` | 0 | 10 | 0 |
| `scripts` | 8 | 0 | 0 |
| `shared` | 1 | 0 | 0 |
| `tests` | 1 | 0 | 0 |

## 4. Complete file-by-file inventory

### Modified files

- `.github/workflows/deploy.yml`
- `.gitignore`
- `PRODUCT_POSITIONING.md`
- `README.md`
- `TITECH_PLATFORM_TRUTH.md`
- `backend/.env.example`
- `backend/.env.production.example`
- `backend/app.cjs`
- `backend/app.js`
- `backend/backup/scripts/backup-db.sh`
- `backend/backup/scripts/restore-db.sh`
- `backend/backup/scripts/verify-backup.sh`
- `backend/bootstrap/environment.js`
- `backend/commercial/index.js`
- `backend/config/index.js`
- `backend/config/swagger.js`
- `backend/config/swaggerConfig.js`
- `backend/controllers/adminAnalytics.controller.js`
- `backend/controllers/adminAudit.controller.js`
- `backend/controllers/adminDashboard.controller.js`
- `backend/controllers/adminManagement.controller.js`
- `backend/controllers/adminReports.controller.js`
- `backend/controllers/adminRisk.controller.js`
- `backend/controllers/adminSystem.controller.js`
- `backend/legal/controllers/legalController.js`
- `backend/middleware/Performance/compression.js`
- `backend/middleware/resilience/gracefulDegradation.js`
- `backend/models/User.js`
- `backend/modules/consent/repositories/consentRepository.js`
- `backend/modules/consent/services/consentService.js`
- `backend/modules/identity-onboarding/identity.policy.js`
- `backend/modules/identity-onboarding/identityOnboarding.service.js`
- `backend/modules/insurance/insurance.service.js`
- `backend/modules/meetings/meeting.service.js`
- `backend/modules/meetings/models/Meeting.js`
- `backend/modules/offline/controllers/offlineSyncController.js`
- `backend/modules/offline/models/OfflineDevice.js`
- `backend/modules/offline/models/OfflineEvent.js`
- `backend/modules/offline/routes/offline-sync.routes.js`
- `backend/modules/offline/services/offlineDeviceService.js`
- `backend/modules/offline/services/offlineReceiptService.js`
- `backend/modules/offline/services/offlineSyncService.js`
- `backend/modules/payment/index.js`
- `backend/modules/payroll/payroll.constants.cjs`
- `backend/modules/payroll/payroll.routes.js`
- `backend/modules/payroll/payroll.service.cjs`
- `backend/modules/ubuntu-float/domain/capabilities.js`
- `backend/modules/ubuntu-float/tests/ubuntuFloatRules.test.js`
- `backend/package.json`
- `backend/routes/authRoutes.js`
- `backend/routes/index.js`
- `backend/routes/index.test.js`
- `backend/routes/institutionalLead.routes.js`
- `backend/runtime/ServerRuntime.js`
- `backend/runtime/context.js`
- `backend/security/rbacPolicy.js`
- `backend/services/admin/adminDashboard.service.js`
- `backend/services/admin/adminManagement.service.js`
- `backend/services/admin/adminRisk.service.js`
- `backend/services/financial/money.js`
- `backend/services/investorReportService.js`
- `backend/shared/branding/brandConfig.cjs`
- `backend/tests/security/rbacPolicy.test.js`
- `backend/tests/unit/inclusive-onboarding/offline-contract.test.mjs`
- `backend/tests/unit/utils/validateInput.test.js`
- `backend/utils/admin/adminDates.js`
- `backend/utils/admin/adminPagination.js`
- `backend/utils/admin/adminValidation.js`
- `branding/BRAND_MANIFEST.json`
- `branding/TITECH_OFFICIAL_THEME.json`
- `branding/TITECH_ORGANIZATION_PROFILE.json`
- `docs/02-architecture/API_CATALOGUE.md`
- `docs/02-architecture/ARCHITECTURE_MAP.md`
- `docs/02-architecture/DATA_MODEL_CATALOGUE.md`
- `docs/02-architecture/DEPENDENCY_MAP.md`
- `docs/02-architecture/EVENT_CATALOGUE.md`
- `docs/02-architecture/FINANCIAL_LEDGER_SPECIFICATION.md`
- `docs/02-architecture/MULTI_TENANT_ARCHITECTURE.md`
- `docs/02-architecture/SECURITY_MODEL.md`
- `docs/02-architecture/SERVICE_CATALOGUE.md`
- `docs/02-architecture/TRANSACTION_STATE_MACHINE.md`
- `docs/data/DATA_MODEL_CATALOGUE.md`
- `docs/legal/IMPLEMENTATION_INTEGRATION_GUIDE.md`
- `docs/legal/LEGAL_RELEASE_CHECKLIST.md`
- `docs/legal/PRIVACY_POLICY_DRAFT_2026-10-25.md`
- `docs/legal/TERMS_OF_SERVICE_DRAFT_2026-10-25.md`
- `docs/transactions/TRANSACTION_STATE_MACHINE_SPECIFICATION.md`
- `frontend/.env.production.example`
- `frontend/src/__tests__/payroll/payrollPage.contract.test.jsx`
- `frontend/src/branding/brand.js`
- `frontend/src/components/ui/index.js`
- `frontend/src/i18n/locales/ar/inclusive.json`
- `frontend/src/i18n/locales/en/inclusive.json`
- `frontend/src/i18n/locales/fr/inclusive.json`
- `frontend/src/i18n/locales/sw/inclusive.json`
- `frontend/src/legal/Disclaimer.jsx`
- `frontend/src/legal/LegalDocuments.jsx`
- `frontend/src/legal/PrivacyPolicy.jsx`
- `frontend/src/legal/TermsOfService.jsx`
- `frontend/src/legal/documents/FinancialDisclaimer.jsx`
- `frontend/src/legal/documents/GeneralDisclaimer.jsx`
- `frontend/src/legal/documents/PrivacyPolicy.jsx`
- `frontend/src/legal/documents/TermsOfService.jsx`
- `frontend/src/legal/index.js`
- `frontend/src/legal/legalAcceptance.js`
- `frontend/src/legal/legalApi.js`
- `frontend/src/legal/legalConfig.js`
- `frontend/src/legal/legalConstants.js`
- `frontend/src/legal/legalRoutes.js`
- `frontend/src/legal/legalTypes.js`
- `frontend/src/main.jsx`
- `frontend/src/pages/Legal.jsx`
- `frontend/src/pages/Login.jsx`
- `frontend/src/pages/PartnerPortal.jsx`
- `frontend/src/pages/Payroll.jsx`
- `frontend/src/pages/PrivacyPolicy.jsx`
- `frontend/src/pages/Register.jsx`
- `frontend/src/pages/education-support/EducationCampaignManagerPage.jsx`
- `frontend/src/pages/education-support/EducationSupportPage.jsx`
- `frontend/src/pages/edufinance/EduFinancePage.jsx`
- `frontend/src/pages/inclusive-onboarding/InclusiveOnboardingPage.jsx`
- `frontend/src/pages/meetings/Meetings.jsx`
- `frontend/src/pages/public/InstitutionalPublicPages.jsx`
- `frontend/src/pages/retirement-support/RetirementSupportPage.jsx`
- `frontend/src/pages/ubuntu-float/UbuntuFloatPage.jsx`
- `package.json`
- `patches/brand-identity-only.patch`
- `scripts/apply-titech-legal-brand-patches.mjs`
- `scripts/official-theme-audit.mjs`
- `scripts/organization-profile-gate.mjs`
- `scripts/platform-truth.mjs`
- `scripts/titech-critical-gates.mjs`
- `scripts/ussd-contract-gate.mjs`
- `scripts/validate-patch-bundle.mjs`
- `scripts/verify-titech-legal-branding.mjs`
- `shared/legal/legalDocuments.json`
- `tests/integration/goldenMoneyPath/goldenMoneyPath.fixtures.js`

### Added files

- `backend/modules/payroll/payroll.authorization.cjs`
- `backend/tests/unit/inclusive-onboarding/insurance.transaction-contract.test.mjs`
- `backend/tests/unit/payroll/payroll.read-authorization.test.mjs`
- `docs/evidence/critical-gates-2026-11-10.json`
- `docs/evidence/enterprise-readiness/CHANGE-DISCOVERY-2026-11-10.md`
- `docs/evidence/enterprise-readiness/EXECUTION-2026-11-10.md`
- `docs/evidence/enterprise-readiness/IMPLEMENTATION-INVENTORY-2026-11-10.md`
- `docs/evidence/enterprise-readiness/TEST-EVIDENCE-2026-11-10.md`
- `docs/evidence/enterprise-readiness/change-manifest-2026-11-10.csv`
- `docs/evidence/enterprise-readiness/raw/build-and-runtime-blockers-2026-11-10.txt`
- `docs/evidence/enterprise-readiness/raw/selected-tests-2026-11-10.txt`
- `docs/evidence/enterprise-readiness/raw/static-gates-2026-11-10.txt`
- `reports/frontend-runtime-audit.json`
- `reports/i18n-coverage-2026-11-10.json`
- `reports/official-theme-audit.json`
- `reports/rbac-security-gate.json`
- `reports/release-readiness.json`
- `reports/runtime-import-audit.json`
- `reports/security-static-gate.json`
- `reports/test-discovery-audit.json`
- `reports/titech-hosting-gate.json`
- `reports/titech-implementation-gate-2026-10-02.json`

### Removed files

- None.

## 5. Key change locations

| Folder/file | Change purpose |
|---|---|
| `branding/` | Current organization metadata aligned; official nine-colour theme and logo preserved. |
| `backend/security/`, `backend/models/`, `backend/utils/admin/` | Dedicated payroll officer/auditor roles, canonical permission mappings and tenant-safe assignment validation. |
| `backend/modules/payroll/` | Payroll read endpoints use canonical read permissions; source helper normalizes legacy aliases; process/reconcile/retry remain restricted. |
| `backend/modules/insurance/` | Insurer state mutations, relevant reads and audit writes share one MongoDB session transaction. |
| `backend/modules/consent/` | Consent reads carry the insurer transaction session. |
| `frontend/src/pages/Payroll.jsx` | Report, audit and subscription fetch states separated; failures no longer display empty/zero financial data. |
| `frontend/src/__tests__/payroll/`, `backend/tests/unit/payroll/` | Payroll RBAC and page contracts added; backend eight-test suite executed, frontend Vitest pending dependency install. |
| `backend/tests/unit/inclusive-onboarding/` | Three insurance transaction/session contract tests added and executed. |
| `docs/evidence/` and `reports/` | Current critical gate snapshot and generated verification evidence. |

## 6. Important changed-file details

- **Identity propagation:** active app/package/deployment/brand/legal UI metadata files in the full manifest now use `TITech Capital SMC LTD`. Historical dated reports remain historical and are superseded by the current truth index.
- **Payroll:** `backend/modules/payroll/payroll.routes.js`, `backend/security/rbacPolicy.js`, `backend/models/User.js`, `backend/utils/admin/adminValidation.js`, `backend/modules/payroll/payroll.authorization.cjs`, `backend/modules/payroll/payroll.constants.cjs`, `backend/modules/payroll/payroll.service.cjs`, `frontend/src/pages/Payroll.jsx`, `frontend/src/__tests__/payroll/payrollPage.contract.test.jsx`, and `backend/tests/unit/payroll/payroll.read-authorization.test.mjs`.
- **Insurance atomicity:** `backend/modules/insurance/insurance.service.js`, `backend/modules/consent/repositories/consentRepository.js`, `backend/modules/consent/services/consentService.js`, and `backend/tests/unit/inclusive-onboarding/insurance.transaction-contract.test.mjs`.
- **Theme:** official source contracts are retained and audited; no new palette or replacement branding was introduced.

## 7. Review and handoff

- CSV manifest: `change-manifest-2026-11-10.csv` (SHA-256 per source/current file for each modified path and each added path other than the manifest itself; its own hash is omitted to avoid recursive self-hashing).
- Detailed execution: `EXECUTION-2026-11-10.md`.
- Test evidence: `TEST-EVIDENCE-2026-11-10.md`.
- Implementation truth: `IMPLEMENTATION-INVENTORY-2026-11-10.md`.
- **No GitHub update or commit is claimed.** The source archive has no `.git` directory. Open the delivered archive in the local working tree, review the manifest, run the full supported-runtime install/test/build procedure, and then perform normal Git review/commit/push from an authenticated local clone.
