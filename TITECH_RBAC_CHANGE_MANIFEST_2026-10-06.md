# TITech Community Capital — RBAC + Official Theme Change Manifest

Date: 2026-10-06
Input archive: `titech-community-capital-main(4).zip`

## Exact repository delta

The source archive contained **3070** files. The updated tree contains **3085** files: **15 added**, **50 modified**, **0 removed**.

Machine-readable inventory: `reports/rbac-file-change-inventory-2026-10-06.json`.

## Step-by-step discovery and implementation

1. **Baseline / repository truth** — unpacked the supplied ZIP and treated it as the authoritative source snapshot; it contains no `.git` metadata.
2. **Authentication trace** — followed registration/login → JWT/session middleware → User/RefreshToken and found stale role/tenant claims could remain security-relevant.
3. **Authorization trace** — followed protected routes → controllers → services/repositories, legacy RBAC modules and frontend route/layout checks.
4. **Canonicalization** — established `backend/security/rbacPolicy.js` as the policy source and `backend/services/rbacService.js` as the orchestration point while preserving compatibility shims for legacy callers.
5. **Tenant/group enforcement** — enforced tenant/object scope and explicit membership state transitions; join requests remain `pending` until authorized moderation.
6. **Session security** — privileged role changes/account disablement increment security/session versions and revoke refresh sessions.
7. **Frontend security contract** — aligned verification-first registration, canonical role-aware routing, admin navigation and Access Governance.
8. **Official TITech theme** — retained the supplied nine-color contract, added semantic aliases, and replaced remaining official palette hex literals in JS/JSX chart/dashboard/runtime code with canonical brand tokens or theme CSS variables.
9. **Evidence gates** — added a repeatable RBAC gate, implementation evidence, machine-readable file inventory and release-readiness classification.

## Changed folders

- `backend/security/` — canonical authorization policy.
- `backend/services/` — RBAC/session orchestration.
- `backend/middleware/` — authoritative authenticated identity resolution.
- `backend/models/` — role compatibility and membership lifecycle.
- `backend/controllers/` — auth/group/RBAC orchestration.
- `backend/routes/` — permission-gated RBAC/group/email routes.
- `frontend/src/routes/` — canonical role-aware routing.
- `frontend/src/context/` — verification-first auth lifecycle.
- `frontend/src/pages/` — verification/access-governance UX.
- `frontend/src/layouts/` — canonical admin navigation.
- `frontend/src/charts/` — official palette token consumption.
- `frontend/src/branding/` — official palette semantic aliases.
- `scripts/` — repeatable security gate.
- `docs/evidence/` — evidence record.
- `reports/` — generated verification artifacts and change inventory.

## Added files

- `TITECH_RBAC_CHANGE_MANIFEST_2026-10-06.md`
- `backend/controllers/rbacController.js`
- `backend/security/rbacPolicy.js`
- `backend/tests/security/rbacPolicy.test.js`
- `docs/evidence/2026-10-06-rbac-implementation.md`
- `frontend/src/pages/VerifyEmail.css`
- `frontend/src/pages/VerifyEmail.jsx`
- `frontend/src/pages/admin/AccessGovernance.jsx`
- `reports/official-theme-audit.json`
- `reports/rbac-file-change-inventory-2026-10-06.json`
- `reports/rbac-release-readiness-2026-10-06.json`
- `reports/rbac-security-gate.json`
- `reports/runtime-import-audit.json`
- `reports/titech-implementation-gate-2026-10-02.json`
- `scripts/rbac-security-gate.mjs`

## Modified files

- `backend/controllers/authController.js`
- `backend/controllers/groupController.js`
- `backend/controllers/rbac.controller.js`
- `backend/middleware/auth.js`
- `backend/middleware/checkPermission.js`
- `backend/models/Group.js`
- `backend/models/User.js`
- `backend/routes/auth.js`
- `backend/routes/email.js`
- `backend/routes/groups.js`
- `backend/routes/index.js`
- `backend/routes/rbac.js`
- `backend/services/bizchatService.js`
- `backend/services/emailService.js`
- `backend/services/rbacService.js`
- `frontend/src/App.jsx`
- `frontend/src/branding/official-theme.css`
- `frontend/src/charts/CashFlowChart.jsx`
- `frontend/src/charts/ChartContainer.jsx`
- `frontend/src/charts/ChartExportButton.jsx`
- `frontend/src/charts/ChartFilters.jsx`
- `frontend/src/charts/ChartLegend.jsx`
- `frontend/src/charts/ChartLoadingSkeleton.jsx`
- `frontend/src/charts/ChartTooltip.jsx`
- `frontend/src/charts/CollectionPerformanceChart.jsx`
- `frontend/src/charts/DonutChartCard.jsx`
- `frontend/src/charts/ExecutiveKPIChart.jsx`
- `frontend/src/charts/FinancialTrendChart.jsx`
- `frontend/src/charts/FraudAnalyticsChart.jsx`
- `frontend/src/charts/LoanPortfolioChart.jsx`
- `frontend/src/charts/MemberGrowthChart.jsx`
- `frontend/src/charts/MultiSeriesChart.jsx`
- `frontend/src/charts/PortfolioAtRiskChart.jsx`
- `frontend/src/charts/RevenueChart.jsx`
- `frontend/src/charts/SavingsGrowthChart.jsx`
- `frontend/src/charts/StackedBarChart.jsx`
- `frontend/src/context/AuthContext.jsx`
- `frontend/src/layouts/AdminLayout.jsx`
- `frontend/src/main.jsx`
- `frontend/src/pages/AdminRiskDashboard.jsx`
- `frontend/src/pages/Register.jsx`
- `frontend/src/pages/dashboard/AdminDashboard.jsx`
- `frontend/src/pages/dashboard/ExecutiveDashboard.jsx`
- `frontend/src/pages/dashboard/SystemHealth.jsx`
- `frontend/src/pages/onboarding/GoLiveReview.jsx`
- `frontend/src/pages/onboarding/OnboardingDashboard.jsx`
- `frontend/src/routes/AppRoutes.jsx`
- `frontend/src/services/api.js`
- `frontend/src/services/apiPolicy.test.js`
- `package.json`

## Removed files

None.

## Key functional changes

1. Canonical roles: `platform_admin`, `tenant_admin`, `group_admin`, `member`, `guest`; legacy aliases normalize at authorization boundaries.
2. Protected requests resolve current User state server-side when MongoDB is available; client-supplied role/permission/tenant claims are not authoritative.
3. Registration no longer creates an authenticated session before email verification; login rejects unverified accounts.
4. Verification can be requested through a public, rate-limited endpoint.
5. Group creation, invitations, join requests and membership moderation are permission- and tenant-scoped.
6. Invitations and requested memberships use distinct lifecycle origins; pending requests do not grant active access.
7. Role mutations and account disablement revoke refresh sessions and increment security/session versions.
8. Cross-tenant group/object access is denied at policy/service level.
9. Frontend admin navigation recognizes canonical roles and exposes Access Governance to platform/tenant administrators.
10. Member group discovery returns safe group metadata without exposing the full membership roster.
11. The official nine-color palette is applied through centralized brand/theme tokens; final audit reports zero hard-coded official palette hex usages in CSS and JS/JSX.
12. A repeatable RBAC source-security gate and machine-readable file-change inventory are included.

## Verification snapshot

Passed locally:

- `npm run audit:theme` — PASS; 57 non-brand CSS files, 0 hard-coded official palette CSS usages, 0 inline JS/JSX official palette hex usages.
- `npm run check:rbac` — PASS.
- `npm run check:conflicts` — PASS.
- `npm run check:financial` — PASS.
- `npm run check:enterprise-contracts` — PASS.
- `npm run check:runtime-imports` — PASS for canonical financial surface; 0 missing there.
- `npm run validate:syntax` — PASS for 2,326 executable JS/TS-family files.
- `npm run titech:implementation-gate` — PASS.
- `npm run enterprise:gate` — PASS.
- direct ESM RBAC policy self-test — PASS.

Not claimed as passed because the environment could not support them:

- Jest/integration/E2E suite: dependencies were not completely installed; `backend/node_modules` is absent.
- `npm run lint`: `eslint` unavailable.
- `npm run build`: `vite` unavailable.

Environment warnings:

- Local Node: `22.16.0`; repository target: `24.15.x`.
- Local npm: `10.9.2`; repository target: `11.x`.
- Runtime import audit still reports 214 legacy/non-critical missing local imports outside the canonical financial surface; canonical financial surface has zero missing local imports.

## Production-readiness classification

This package is **source-verified and statically/security-gate verified**, but it is **not represented as production-approved**. Full dependency-backed automated suites, target-runtime validation, real infrastructure/provider testing, external security assessment, institution pilot evidence and production release approval remain external evidence requirements.
