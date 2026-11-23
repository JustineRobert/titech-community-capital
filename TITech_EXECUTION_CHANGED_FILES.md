# TITech Community Capital — execution changed-file discovery

**Execution date:** 23 November 2026  
**Product:** TITech Community Capital  
**Organization:** TITECH CAPITAL - SMC LTD  
**Official tagline:** Community Finance. Stronger Together.

The complete file-by-file comparison is in [`docs/evidence/2026-11-23-enterprise-e2e-remediation/CHANGED_FILES.md`](docs/evidence/2026-11-23-enterprise-e2e-remediation/CHANGED_FILES.md), with machine-readable hashes in [`changed-files.json`](docs/evidence/2026-11-23-enterprise-e2e-remediation/changed-files.json). The source ZIP did not contain `.git`; this is a baseline archive comparison, not a Git diff.

## Step-by-step discovery

1. Extract the updated repository ZIP while preserving filenames.
2. Open `TITECH_PLATFORM_TRUTH.md` for the dated progress and readiness status.
3. Open the evidence `CHANGED_FILES.md` for the added/modified/deleted file groups.
4. Open `changed-files.json` for each exact path and SHA-256 evidence.
5. Read `IMPLEMENTATION_REPORT.md` for the implementation rationale and `EXECUTION_REPORT.md` for commands, exit codes and actual test results.
6. Read `ENVIRONMENT_BLOCKERS.md` and `RELEASE_READINESS_ASSESSMENT.md` before any release or production deployment decision.

## Primary implementation areas

- `frontend/src/components/ui/` — shared profile avatar component/style.
- `frontend/src/utils/userAvatar.mjs` — safe avatar URL, display-name and initials resolution.
- `frontend/src/components/Navbar.jsx` and `Navbar.css` — authenticated desktop/mobile account avatar.
- `frontend/src/pages/dashboard/` — dashboard-header stylesheet, avatar integration and identity styling.
- `frontend/src/pages/Settings.jsx` and `Settings.css` — profile avatar in account summary.
- `frontend/src/pages/AdminRiskDashboard.jsx`, `frontend/src/pages/dashboard/ExecutiveDashboard.jsx`, `SystemHealth.jsx` and `AdminDashboard.jsx` — canonical brand identity lockups.
- `frontend/src/branding/dashboard-theme.css` — official semantic theme mapping for dashboard components.
- `scripts/tests/`, `package.json` — regression contracts and CI wiring.
- `README.md`, `TITECH_PLATFORM_TRUTH.md` — dated progress and evidence index.

**Release status: BLOCKED. `productionApproved=false`.** Full backend/frontend, MongoDB/Redis, browser E2E, provider and external approval gates were not available in the execution environment.
