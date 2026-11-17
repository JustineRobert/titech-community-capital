# Step-by-step folder and file change discovery

Compared byte-for-byte with the supplied archive `titech-community-capital-main(4).zip` (SHA-256 `1c96687d7ffe831e7b2a9ff50acb0cb788fa89cefab8d8637337c8634bb56ba6`). The archive contains no `.git` metadata; counts below are archive-to-worktree changes, not a Git diff.

- Added: **107** files
- Modified: **13** files
- Deleted: **0** files
- Archive regular files: **3797**
- Current regular files: **3904** (dependencies, build outputs and caches excluded)

## Step 1 — Backend read APIs and permission boundaries

- `backend/routes/member-read.routes.js` — tenant-scoped Member directory and member profile read endpoints using the canonical Member model, trusted Tenant ObjectId extraction (`req.tenant._id` before the string `req.tenantId`), ObjectId validation, filtered pagination totals, projection and differentiated errors.
- `backend/routes/loan-read.routes.js` — tenant-scoped loan list/detail APIs using the Loan model string tenant key, bounded filters/pagination, and related Member and Group population constrained by the trusted Tenant ObjectId.
- `backend/routes/savings-read.routes.js` — tenant-scoped account and transaction read endpoints using the trusted Tenant ObjectId and bounded pagination; verifies the savings-account relationship is still within the tenant before exposing transaction/member context.
- `backend/routes/index.js` — mounts the new read routers only after existing authentication and tenant authorization middleware.
- `backend/security/rbacPolicy.js` — adds `MEMBER_VIEW`, `LOAN_VIEW`, `SAVINGS_VIEW`; existing role resolution remains authoritative.

## Step 2 — Protected frontend routes and module interfaces

- `frontend/src/routes/AppRoutes.jsx` — direct protected member, loan and savings detail routes.
- `frontend/src/pages/Members.jsx` / `Members.css` — member directory with canonical API, server pagination/search/status and token styling; pagination totals respect active filters.
- `frontend/src/pages/MemberProfile.jsx` — profile deep link with explicit invalid-ID, unauthorized, missing-record and service-failure states.
- `frontend/src/pages/Loans.jsx` / `Loans.css` / `LoanDetails.jsx` — tenant-read loan directory and loan detail; no unapproved approval/disbursement mutation is exposed.
- `frontend/src/pages/Savings.jsx` / `Savings.css` — activity view; `SUCCESS` or `SETTLED` labels are not treated as proof of settlement or ledger posting.
- `frontend/src/pages/SavingsAccounts.jsx` / `SavingsAccounts.css` / `SavingsAccountDetails.jsx` — account directory, details and member/account navigation; aggregate snapshots are marked non-authoritative.
- `frontend/src/pages/SavingsTransactionDetails.jsx` — transaction detail clearly distinguishes raw transaction state from settlement and ledger confirmation.
- `frontend/src/pages/enterprise-detail.css` — shared responsive token-based detail styles.
- `frontend/src/utils/moneyDisplay.js` — exact integer/BigInt currency display helper, not a financial calculation engine.

## Step 3 — Brand and company identity

- `frontend/src/branding/brand.js`, `frontend/src/components/Footer.jsx`, `branding/TITECH_ORGANIZATION_PROFILE.json` — retain TITech Community Capital / TITECH CAPITAL - SMC LTD, the current tagline, and owner-supplied contact details. ERN/contact/postal records are not represented as independently authenticated legal or licensing proof.
- Existing `branding/TITECH_OFFICIAL_THEME.json` and `frontend/src/branding/official-theme.css` remain the source of truth for the nine-colour palette and light/dark themes; dashboards consume centralized theme tokens.

## Step 4 — Regression tests and technical documentation

- `tests/enterprise-remediation/module-read-contract.test.mjs` — focused route/API/permission/theme and exact-money contracts.
- `docs/architecture/MEMBERS_LOANS_SAVINGS_READ_APIS.md` — API routes, response contracts, permission expectations and deliberate read-only financial boundary.
- `README.md`, `TITECH_PLATFORM_TRUTH.md`, `docs/DOCUMENTATION_INDEX.md` — dated progress, current limitations and links to evidence.
- `reports/` — machine-readable results produced by existing static verification scripts; these are not substitutes for live integrations.

## Step 5 — Evidence package

- `docs/evidence/enterprise-production-remediation/` — baseline, execution report, blocker register, file inventory, import review, zero-byte review, theme audit, localization matrix, test records, financial/security/provider/reconciliation/legal/pilot evidence and final fail-closed decision.
- `docs/evidence/enterprise-production-remediation/logs/` — captured console outputs and exit codes, including attempted build/test/dev commands that were blocked by missing dependencies.

## Exact archive delta — every changed path

All rows are enumerated in `FILE_CHANGE_INVENTORY.csv`, including SHA-256 values for source and current files. The following lists are the complete exact path appendix for this archive comparison.

### Modified (13)

- `README.md`
- `TITECH_PLATFORM_TRUTH.md`
- `backend/routes/index.js`
- `backend/security/rbacPolicy.js`
- `branding/TITECH_ORGANIZATION_PROFILE.json`
- `docs/DOCUMENTATION_INDEX.md`
- `frontend/src/branding/brand.js`
- `frontend/src/components/Footer.jsx`
- `frontend/src/pages/Loans.jsx`
- `frontend/src/pages/Members.jsx`
- `frontend/src/pages/Savings.css`
- `frontend/src/pages/Savings.jsx`
- `frontend/src/routes/AppRoutes.jsx`

### Added (107)

- `backend/routes/loan-read.routes.js`
- `backend/routes/member-read.routes.js`
- `backend/routes/savings-read.routes.js`
- `docs/architecture/MEMBERS_LOANS_SAVINGS_READ_APIS.md`
- `docs/evidence/2026-11-16-master-gate-summary.md`
- `docs/evidence/enterprise-production-remediation/BACKUP_RESTORE_EVIDENCE.md`
- `docs/evidence/enterprise-production-remediation/BASELINE_ASSESSMENT.md`
- `docs/evidence/enterprise-production-remediation/BLOCKER_REGISTER.csv`
- `docs/evidence/enterprise-production-remediation/BLOCKER_REGISTER.json`
- `docs/evidence/enterprise-production-remediation/DEPLOYMENT_VERIFICATION.md`
- `docs/evidence/enterprise-production-remediation/EXECUTION_REPORT.md`
- `docs/evidence/enterprise-production-remediation/EXECUTION_SUMMARY.md`
- `docs/evidence/enterprise-production-remediation/FILE_CHANGE_DISCOVERY.md`
- `docs/evidence/enterprise-production-remediation/FILE_CHANGE_INVENTORY.csv`
- `docs/evidence/enterprise-production-remediation/FINAL_RELEASE_DECISION.md`
- `docs/evidence/enterprise-production-remediation/FRONTEND_THEME_AUDIT.csv`
- `docs/evidence/enterprise-production-remediation/GOLDEN_MONEY_PATH_EVIDENCE.md`
- `docs/evidence/enterprise-production-remediation/IMPORT_REMEDIATION.csv`
- `docs/evidence/enterprise-production-remediation/INSTITUTIONAL_PILOT_EVIDENCE.md`
- `docs/evidence/enterprise-production-remediation/INTEGRATION_EVIDENCE.md`
- `docs/evidence/enterprise-production-remediation/LEDGER_REPLAY_EVIDENCE.md`
- `docs/evidence/enterprise-production-remediation/PRODUCTION_READINESS_SCORECARD.md`
- `docs/evidence/enterprise-production-remediation/PROVIDER_FAILURE_EVIDENCE.md`
- `docs/evidence/enterprise-production-remediation/RECONCILIATION_EVIDENCE.md`
- `docs/evidence/enterprise-production-remediation/REGULATORY_PARTNER_EVIDENCE.md`
- `docs/evidence/enterprise-production-remediation/SECURITY_ASSESSMENT.md`
- `docs/evidence/enterprise-production-remediation/SHA256_MANIFEST.txt`
- `docs/evidence/enterprise-production-remediation/TENANT_SECURITY_EVIDENCE.md`
- `docs/evidence/enterprise-production-remediation/TEST_EXECUTION_RESULTS.md`
- `docs/evidence/enterprise-production-remediation/TRANSLATION_REVIEW_MATRIX.csv`
- `docs/evidence/enterprise-production-remediation/ZERO_BYTE_FILE_REVIEW.csv`
- `docs/evidence/enterprise-production-remediation/logs/changed-source-checks.exit`
- `docs/evidence/enterprise-production-remediation/logs/changed-source-checks.log`
- `docs/evidence/enterprise-production-remediation/logs/critical-gate.exit`
- `docs/evidence/enterprise-production-remediation/logs/critical-gate.log`
- `docs/evidence/enterprise-production-remediation/logs/critical-tests.exit`
- `docs/evidence/enterprise-production-remediation/logs/critical-tests.log`
- `docs/evidence/enterprise-production-remediation/logs/financial-static.exit`
- `docs/evidence/enterprise-production-remediation/logs/financial-static.log`
- `docs/evidence/enterprise-production-remediation/logs/i18n-tests.exit`
- `docs/evidence/enterprise-production-remediation/logs/i18n-tests.log`
- `docs/evidence/enterprise-production-remediation/logs/i18n-validation.exit`
- `docs/evidence/enterprise-production-remediation/logs/i18n-validation.log`
- `docs/evidence/enterprise-production-remediation/logs/import-audit.exit`
- `docs/evidence/enterprise-production-remediation/logs/import-audit.log`
- `docs/evidence/enterprise-production-remediation/logs/jsx-transpile.exit`
- `docs/evidence/enterprise-production-remediation/logs/jsx-transpile.log`
- `docs/evidence/enterprise-production-remediation/logs/module-read-contract.exit`
- `docs/evidence/enterprise-production-remediation/logs/module-read-contract.log`
- `docs/evidence/enterprise-production-remediation/logs/navigation-contracts.exit`
- `docs/evidence/enterprise-production-remediation/logs/navigation-contracts.log`
- `docs/evidence/enterprise-production-remediation/logs/navigation.exit`
- `docs/evidence/enterprise-production-remediation/logs/navigation.log`
- `docs/evidence/enterprise-production-remediation/logs/node-check-contract.exit`
- `docs/evidence/enterprise-production-remediation/logs/node-check-contract.log`
- `docs/evidence/enterprise-production-remediation/logs/node-check-index.exit`
- `docs/evidence/enterprise-production-remediation/logs/node-check-index.log`
- `docs/evidence/enterprise-production-remediation/logs/node-check-loan.exit`
- `docs/evidence/enterprise-production-remediation/logs/node-check-loan.log`
- `docs/evidence/enterprise-production-remediation/logs/node-check-member.exit`
- `docs/evidence/enterprise-production-remediation/logs/node-check-member.log`
- `docs/evidence/enterprise-production-remediation/logs/node-check-money.exit`
- `docs/evidence/enterprise-production-remediation/logs/node-check-money.log`
- `docs/evidence/enterprise-production-remediation/logs/node-check-rbac.exit`
- `docs/evidence/enterprise-production-remediation/logs/node-check-rbac.log`
- `docs/evidence/enterprise-production-remediation/logs/node-check-routes-index.exit`
- `docs/evidence/enterprise-production-remediation/logs/node-check-routes-index.log`
- `docs/evidence/enterprise-production-remediation/logs/node-check-savings.exit`
- `docs/evidence/enterprise-production-remediation/logs/node-check-savings.log`
- `docs/evidence/enterprise-production-remediation/logs/npm-backend-start.exit`
- `docs/evidence/enterprise-production-remediation/logs/npm-backend-start.log`
- `docs/evidence/enterprise-production-remediation/logs/npm-build.exit`
- `docs/evidence/enterprise-production-remediation/logs/npm-build.log`
- `docs/evidence/enterprise-production-remediation/logs/npm-frontend-start.exit`
- `docs/evidence/enterprise-production-remediation/logs/npm-frontend-start.log`
- `docs/evidence/enterprise-production-remediation/logs/npm-test.exit`
- `docs/evidence/enterprise-production-remediation/logs/npm-test.log`
- `docs/evidence/enterprise-production-remediation/logs/organization-gate.exit`
- `docs/evidence/enterprise-production-remediation/logs/organization-gate.log`
- `docs/evidence/enterprise-production-remediation/logs/rbac-gate.exit`
- `docs/evidence/enterprise-production-remediation/logs/rbac-gate.log`
- `docs/evidence/enterprise-production-remediation/logs/repository-syntax.exit`
- `docs/evidence/enterprise-production-remediation/logs/repository-syntax.log`
- `docs/evidence/enterprise-production-remediation/logs/runtime-environment.exit`
- `docs/evidence/enterprise-production-remediation/logs/runtime-environment.log`
- `docs/evidence/enterprise-production-remediation/logs/runtime-gate.exit`
- `docs/evidence/enterprise-production-remediation/logs/runtime-gate.log`
- `docs/evidence/enterprise-production-remediation/logs/theme-audit.exit`
- `docs/evidence/enterprise-production-remediation/logs/theme-audit.log`
- `frontend/src/pages/LoanDetails.jsx`
- `frontend/src/pages/Loans.css`
- `frontend/src/pages/MemberProfile.jsx`
- `frontend/src/pages/Members.css`
- `frontend/src/pages/SavingsAccountDetails.jsx`
- `frontend/src/pages/SavingsAccounts.css`
- `frontend/src/pages/SavingsAccounts.jsx`
- `frontend/src/pages/SavingsTransactionDetails.jsx`
- `frontend/src/pages/enterprise-detail.css`
- `frontend/src/utils/moneyDisplay.js`
- `reports/evidence/golden-money-path-proof.json`
- `reports/i18n-coverage-2026-11-16.json`
- `reports/i18n-coverage-2026-11-17.json`
- `reports/official-theme-audit.json`
- `reports/rbac-security-gate.json`
- `reports/runtime-import-audit.json`
- `reports/titech-enterprise-master-gate.json`
- `tests/enterprise-remediation/module-read-contract.test.mjs`

### Deleted (0)

- None. No source or archive path was deleted.

## Important interpretation

No source file was deleted in this remediation. Empty files were inventoried, not bulk-filled or removed. Read-only views were intentionally added rather than inventing financial writes; loan application mutations, approval, disbursement, repayments, savings contributions/withdrawals, ledger replay and provider settlement still require their canonical workflow and runtime evidence. This package is not a Git commit or a verified GitHub synchronization.
