# TITech Capital LTD — 1 November 2026 folder/file change discovery

**Product:** TITech Community Capital  
**Configured organization:** TITech Capital LTD  
**Postal details:** P.O. BOX 601200, Clock Tower, Uganda  
**Release:** NOT READY; `productionApproved=false`  
**Source:** Supplied repository ZIP and supplied postal-address screenshot  

## 1. How to inspect this update

1. Start with [`TITECH_IMPLEMENTATION_REPORT_2026-11-01.md`](TITECH_IMPLEMENTATION_REPORT_2026-11-01.md) for the verdict and verification limits.
2. Open [`../organization/TITECH_CAPITAL_LTD_IDENTITY.md`](../organization/TITECH_CAPITAL_LTD_IDENTITY.md) for the configured identity and the name discrepancy.
3. Open [`source-records/README.md`](source-records/README.md) and the JPEG beside it to see the exact supplied administrative source record.
4. Open [`execution-2026-11-01/README.md`](execution-2026-11-01/README.md), then `test-results.json` and the `.log` files for command-level evidence.
5. Use [`TITech_Capital_LTD_Change_Discovery_2026-11-01.csv`](TITech_Capital_LTD_Change_Discovery_2026-11-01.csv) for the per-file register, and [`remediation-file-manifest-2026-11-01.json`](remediation-file-manifest-2026-11-01.json) for before/after SHA-256 values.
6. For the preceding implementation baseline (authentication, registration, dashboard data semantics, etc.), open the 31 October report and discovery: `TITECH_IMPLEMENTATION_REPORT_2026-10-31.md` and `TITech_Capital_LTD_Change_Discovery_2026-10-31.csv`.

## 2. Repository walk-through: this 1 November update

### A. `branding/`

- **Modified `branding/TITECH_ORGANIZATION_PROFILE.json`.** Added the screenshot evidence path and SHA-256. The source-record date is set to `null` because the date is not visible in the supplied image. `TITech Capital LTD` remains the configured organization identity; `TITECH CAPITAL - SMC LTD` remains the separate portal-association label.
- `branding/TITECH_OFFICIAL_THEME.json`, `branding/BRAND_MANIFEST.json`, official circular logo source and generated logo variants were preserved; palette values were not changed.

### B. `docs/evidence/source-records/`

- **Added `TITech_Capital_LTD_Postal_Address_Record_2026-11-01.jpeg`.** Original user-supplied screenshot retained as source evidence.
- **Added `README.md`.** Records what the form displays, image SHA-256 and the limits of the evidence.

### C. `docs/organization/`

- **Modified `TITECH_CAPITAL_LTD_IDENTITY.md`.** Updated evidence date/provenance, retained exact portal association wording, clarified the configured organization name and documented the authoritative company/address documents still required.

### D. `frontend/src/branding/` and `frontend/src/legal/`

- **Modified `frontend/src/branding/brand.js`.** Updated source comment only; `TITECH_ORGANIZATION.displayName`, configured legal name, postal address, location, country and association fields retain the existing values.
- **Modified `frontend/src/legal/legalConfig.js`.** Updated source comment only; legal/contact address values remain unchanged.
- The official CSS theme/token contract and brand assets remain as supplied. The theme audit verifies nine palette colors and centralized CSS usage; it does not replace visual QA.

### E. `scripts/`

- **Modified `scripts/organization-profile-gate.mjs`.** Added checks for a repository-contained source screenshot, file existence, SHA-256 consistency, non-invented source-record date and backend configured legal name.
- The existing gate test is exercised by `org_and_metric_tests` in the execution evidence.

### F. Repository root

- **Modified `README.md`.** Replaced the current handoff banner with the 1 November status, selected test results and environment/release limitations.
- **Modified `TITECH_PLATFORM_TRUTH.md`.** Added this evidence refresh and retained the blocked release decision.

### G. `docs/evidence/execution-2026-11-01/`

- **Added command logs and report JSON files.** They are raw captured stdout/stderr from the actual commands executed in this environment. `test-results.json` provides the machine-readable command list, exit codes, test totals, runtime and unrun test categories.

## 3. Important application implementation already present in the supplied 31 October baseline

This 1 November pass did not rewrite the application stack. The source ZIP already included the previous source remediation; the detailed inventory is in the 31 October discovery CSV. The main areas are:

- `backend/controllers/authController.js` and `backend/tests/integration/auth.test.js`: invitation consumption and user creation placed within one Mongoose transaction; requires a real transaction-capable MongoDB topology to prove live behavior.
- `frontend/src/context/AuthContext.jsx`, `frontend/src/services/api.js`, `frontend/src/pages/Register.jsx`, `frontend/src/pages/VerifyEmail.jsx`: registration response no longer establishes an authenticated session; verification-request acceptance is distinguished from confirmed email delivery.
- `frontend/src/hooks/useDashboardData.js`, `frontend/src/pages/dashboard/Dashboard.jsx`, `frontend/src/pages/dashboard/AdminDashboard.jsx`, `frontend/src/pages/dashboard/ExecutiveDashboard.jsx`, `frontend/src/utils/financialMetric.js`: unavailable/non-finite metrics are distinguished from true zero and empty fraud data is not shown as a fictional clean result.
- `backend/shared/branding/brandConfig.cjs`, `frontend/src/branding/brand.js`, `frontend/src/legal/legalConfig.js`, `frontend/src/components/Footer.jsx`: organization identity/address contract was already wired through backend/frontend branding/legal/footer views.
- `.titech-remediation/archive/2026-10-31-legacy-root-recovery/`: two root-level legacy-looking backend files were preserved by relocation rather than deleted.

## 4. What this update intentionally did not change

No change was made to the canonical authentication architecture, refresh-token security, payment provider behavior, double-entry ledger, reconciliation lifecycle, tenant enforcement, RBAC policy, database schemas, production capability flags or deployment workflows. No V2 architecture was introduced. No mock transactions, synthetic live dashboard totals, insurer approvals or external evidence were created.

The source code contains inclusive refugee/host-community onboarding, insurer workflows, education campaigns, retirement-support and agent-float control contracts, but their presence is not proof of operational workflows, legal permission, provider access, pilot validation or production readiness. Keep those capability flags and approval gates closed until their relevant tests and external controls are complete.

## 5. Exact current-run results

- Selected dependency-free native Node tests: **96 passed, 0 failed**.
- Syntax: **PASS**, 2,475 JS/TS-family files parsed.
- Organization profile and nine-colour theme audits: **PASS**.
- Financial static/enterprise contract/RBAC source gates: **PASS**.
- Runtime requirement: **BLOCKED** (Node 22.16.0/npm 10.9.2; required Node >=24.15.0/npm >=11.0.0).
- Repository-wide missing local import candidates: **208** (0 detected on the audited canonical financial surface).
- Critical P0/P1 release gates: **8 open**.
- Production approval: **BLOCKED**.

See the report and JSON result ledger for the evidence boundaries. No remote push or deployment is claimed.
