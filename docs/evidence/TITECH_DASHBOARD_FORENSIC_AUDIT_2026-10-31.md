# TITech Dashboard Forensic Audit — 31 October 2026

**Repository source:** latest Library archive `titech-community-capital-main(3).zip`, snapshot supplied 31 October 2026.  
**Status:** source inventory completed for the paths below; dependency-backed runtime route proof remains blocked.  
**Release decision:** `NOT READY`; `productionApproved=false`.

## Dashboard/route inventory

| File | Observed role | Current disposition |
|---|---|---|
| `frontend/src/pages/Dashboard.jsx` | Community dashboard imported into `frontend/src/routes/AppRoutes.jsx` | Retained as existing community workspace. |
| `frontend/src/pages/admin/AdminDashboard.jsx` | Enterprise administration dashboard imported by `AppRoutes.jsx` | Retained as canonical admin workspace. |
| `frontend/src/pages/AdminDashboard.jsx` | Separate similarly named page | Do not delete until route/import/test proof establishes it is unused. |
| `frontend/src/pages/dashboard/AdminDashboard.jsx` | Separate analytics-heavy dashboard with savings, transactions, loan and fraud charts | Retained; no proof in this archive-only audit justifies deleting it. Missing values and empty fraud data were remediated to render unavailable/empty states rather than fabricated zeros or “100% clean.” |
| `frontend/src/pages/dashboard/Dashboard.jsx` | Integrated dashboard variant importing `useDashboardData` | Retained; financial metrics now preserve missing as unavailable. |
| `frontend/src/pages/dashboard/ExecutiveDashboard.jsx` | Executive/board metric and chart workspace | Retained; missing metrics no longer default to displayed zero. |
| `frontend/src/pages/AdminRiskDashboard.jsx` | Risk intelligence workspace | Retained; requires its own browser/data-source validation. |
| `frontend/src/pages/agriculture/AgricultureDashboard.jsx` | Agriculture operational workspace | Retained, feature/permission gating remains an acceptance requirement. |
| `frontend/src/pages/onboarding/OnboardingDashboard.jsx` | Onboarding workspace | Retained, authorization and tenant boundaries remain an acceptance requirement. |
| `frontend/src/routes/AppRoutes.jsx` | Current router composition; imports `useAuth` from canonical `frontend/src/context/AuthContext.jsx` | Existing router retained; inspect and browser-test all nested and role-gated routes before any dashboard deletions. |
| `frontend/src/routes/routeConfig.js` | Route configuration | Retained; runtime resolution has not been fully E2E-proven here. |
| `frontend/src/layouts/AdminLayout.jsx` | Admin shell | Retained. |
| `frontend/src/security/rbacPolicy.js` | Frontend permission policy | Retained; UI gating does not replace backend authorization. |
| `frontend/src/hooks/useDashboardData.js` | Community dashboard API/realtime orchestration | Changed: missing financial values remain null; primary load errors no longer imply a zero group count. |
| `frontend/src/hooks/useRealtimeDashboard.js` | Realtime dashboard lifecycle | Retained; socket authorization and session invalidation require runtime tests. |
| `frontend/src/services/api.js` | Shared API client | Retained; must be verified under supported runtime and browser E2E. |

## Findings

1. The repository has several differently located files with overlapping names. Their existence alone does not prove duplicate runtime behavior. No dashboard was deleted in this pass.
2. Before this change, `useDashboardData` normalized `null`, absent and invalid financial statistics to numeric zero. Integrated and executive dashboard formatters also defaulted missing numbers to zero. The analytics fraud chart displayed a fictional `Clean: 100` / `Flagged: 0` distribution if no fraud data existed. These display paths are now changed to distinguish missing information from real zero.
3. `frontend/src/pages/admin/AdminDashboard.jsx` already uses nullable defaults in its stats contract and is kept intact.
4. `scripts/official-theme-audit.mjs` previously asserted literal brand assignments. It has been adjusted to accept the now-configured brand-object references while retaining the identity and palette checks.
5. This archive does not contain `.git` metadata. Branch, commit ancestry, staged changes and remote synchronization cannot be established from the archive.
6. Source inspection and dependency-free static tests do not establish production API availability, frontend build correctness, role-route browser behavior, live database behavior or tenant isolation.

## Financial-data display rule

A numeric `0` is shown as zero only when the upstream service supplies a valid zero. `null`, empty, malformed or unavailable metrics must render as `Unavailable` or an explicit empty state. This is a presentation integrity rule; authoritative balances and permissions remain backend responsibilities.

## Release gates still outstanding

Supported runtime, clean installs, Vite/production build, complete backend/frontend suites, browser E2E for dashboard routing, role and tenant negative tests, live MongoDB/Redis integrations, financial ledger replay, provider settlement evidence, independent security review and external institutional/legal approval remain unproven or blocked. See `docs/evidence/TITECH_IMPLEMENTATION_REPORT_2026-10-31.md`.
