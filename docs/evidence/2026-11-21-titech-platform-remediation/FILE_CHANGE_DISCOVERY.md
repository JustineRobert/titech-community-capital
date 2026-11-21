# Archive-to-working-copy file change discovery — 21 November 2026

This inventory compares the supplied ZIP contents with the extracted/updated working tree. It is not a Git diff: `.git` metadata was absent. **No repository source file was deleted.**

## Modified files

| Repository-relative path | Change and reason | Evidence / status |
|---|---|---|
| `backend/routes/platformDashboard.js` | Added platform-admin-protected, paginated `/activity` backed by the append-only `AuditLog`; normalized activity DTO; repaired the statistics data envelope and retained a legacy `stats` alias; returns unavailable rather than fabricated values for approval and savings metrics. | Admin dashboard contract tests 9/9 PASS; live Express/Mongo test BLOCKED. |
| `frontend/src/pages/admin/AdminDashboard.jsx` | Aligns with backend response contract, safely renders nested audit activity, distinguishes activity error/empty states, updates success timestamp only after both dashboard calls succeed, and restricts the global centre to `platform_admin`. | Syntax gate PASS; pure contract tests 9/9 PASS; browser E2E BLOCKED. |
| `frontend/src/pages/admin/AdminDashboard.css` | Uses official semantic theme tokens for local dashboard presentation and adds activity-context/empty-state styling. | Official theme audit PASS across 78 non-brand CSS files; visual/browser check BLOCKED. |
| `frontend/src/pages/Dashboard.jsx` | Active community-dashboard group cards no longer fabricate member/contribution zeroes or treat generic savings/contribution values as actual contribution totals; only explicit schedule fields are displayed. | Enterprise syntax gate PASS; no browser test. |
| `frontend/src/pages/GroupList.jsx` | Active Groups directory cards show explicit group type and use verified card values; missing member/contribution data stays unavailable; next contribution is not inferred from meeting dates. | Enterprise syntax gate PASS; no browser test. |
| `frontend/src/pages/GroupList.css` | Adds group-type presentation using the official semantic theme token layer. | Official theme audit PASS; no screenshot evidence. |
| `frontend/src/pages/GroupDetails.jsx` | Separates 403 restricted wallet access, missing canonical group account mapping (503), and generic unavailable state. Does not weaken wallet authorization or fabricate balances. | Existing group-wallet policy tests 10/10 PASS; live account lookup BLOCKED. |
| `frontend/src/services/api.js` | Adds same-origin Web Locks coordination for refresh rotation where supported, retaining in-tab single-flight and existing in-memory/HttpOnly token model. | Source syntax PASS; real multi-tab browser test BLOCKED. |
| `package.json` | Adds `test:admin-dashboard-contract` and wires it into root `test:ci`. | JSON parse and targeted test PASS. |
| `TITECH_PLATFORM_TRUTH.md` | Adds current execution provenance, measured archive digest and updated scope/release status, explicitly superseding mismatching older archive hash/count metadata for this run. | Manual/documentation review; `productionApproved=false` retained. |
| `docs/DOCUMENTATION_INDEX.md` | Links the current remediation report, changed-file inventory, test results and blocker register. | Link/path check in final packaging. |

## Added files

| Repository-relative path | Purpose | Evidence / status |
|---|---|---|
| `backend/utils/adminDashboardPresentation.js` | New safe audit presentation helper: humanized actions, scalar identifiers/descriptions, bounded actor/resource display values, ISO event timestamps; no raw metadata exposure. | Admin dashboard contract tests 9/9 PASS. |
| `frontend/src/pages/admin/adminDashboardData.mjs` | New pure response, count, activity and error normalizers; preserves zero and maps missing/invalid values to unavailable. | Admin dashboard contract tests 9/9 PASS. |
| `scripts/admin-dashboard-contract.test.mjs` | Nine Node built-in regression/source-contract tests for stats, activity, safety and access guard expectations. | 9/9 PASS; integrated into root `test:ci`. |
| `reports/official-theme-audit.json` | Generated official palette/theme-audit output. | PASS. |
| `reports/rbac-security-gate.json` | Generated RBAC static gate output. | PASS. |
| `reports/runtime-import-audit.json` | Generated runtime import audit output. | Canonical financial surface PASS; 208 non-critical legacy warnings remain. |
| `reports/i18n-human-review/2026-11-21-1146Z/chat-production-gate.json` | Generated Chat readiness result. | BLOCKED; no E2E claim. |
| `docs/evidence/2026-11-21-titech-platform-remediation/EXECUTION_REPORT.md` | Engineering summary, root causes, deliverables and release decision. | This report. |
| `docs/evidence/2026-11-21-titech-platform-remediation/FILE_CHANGE_DISCOVERY.md` | This exhaustive path and change description. | Archive comparison. |
| `docs/evidence/2026-11-21-titech-platform-remediation/TEST_RESULTS.md` | Executed tests and gate results. | Command evidence. |
| `docs/evidence/2026-11-21-titech-platform-remediation/BLOCKER_REGISTER.json` | Machine-readable blockers and dependency owners. | Current-source assessment. |

## Restored archive path (not a change)

The ZIP extraction utility had represented the narrow no-break space in `frontend/public/images/independent Circular Seal.png` as the literal text `#U202f`. The original Unicode filename has been restored exactly. The file content is unchanged; it is **not** a source addition or deletion.

## No files removed

The archive-to-working-copy comparison found **zero removed files** after filename normalization. Historical and legacy files were preserved; no bulk cleanup or placeholder-file generation was performed.
