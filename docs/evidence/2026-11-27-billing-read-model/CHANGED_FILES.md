# TITech billing remediation — exact file-change discovery

Source baseline: uploaded `titech-community-capital-main(1).zip` (SHA-256 `10cc5de08c6b868acdcaf255676966e71821bfed0a15908cd04017798ac1e7c8`). The archive contained 4,147 files and no `.git` directory, so the inventory is a content-hash comparison between the supplied ZIP and the completed working tree, not a Git diff.

**Exact comparison result: 9 existing files modified, 32 files added, 0 files removed.** All 4,147 baseline file paths were retained; unrelated historical/user work was not deleted. The unrelated Unicode filename in `frontend/public/images/` was restored to its exact source-archive name; it is not a change.

## 1. Modified existing files (9)

| File | Change |
|---|---|
| `README.md` | Added current billing increment summary, active official tagline, release status and links to evidence. Historical entries retained. |
| `backend/models/User.js` | Added `finance_officer` and `finance_auditor` as recognized role enum values. No user was assigned either role. |
| `backend/routes/index.js` | Imported and mounted the read-only billing router on existing `${API_PREFIX}/billing` within the canonical router. |
| `backend/security/rbacPolicy.js` | Added read-only billing permission vocabulary, role aliases and platform/tenant/finance-reader permission mappings. No billing mutation permission added. |
| `frontend/src/layouts/AdminLayout.jsx` | Added existing icon components to the canonical navigation icon map so the new menu entries render. |
| `frontend/src/navigation/navigationRegistry.js` | Added protected entries for Billing Control Centre, My Billing and Finance & Collections with role filters. |
| `frontend/src/routes/AppRoutes.jsx` | Added three protected billing paths, lazy-loaded dashboard page and role-aware route guard. |
| `frontend/src/security/rbacPolicy.js` | Mirrored finance reader roles and route destination handling in frontend role vocabulary. Backend remains authoritative. |
| `package.json` | Added `check:billing-read` and `test:billing-read`; included them in aggregate `check` and `test:ci` workflows. |

## 2. New backend files (3)

| File | Purpose |
|---|---|
| `backend/commercial/api/billingRead.routes.js` | Nine authenticated GET-only platform/tenant billing routes with route-level RBAC and safe response handling. |
| `backend/commercial/services/billing/billingReadModel.service.js` | Existing-connection MongoDB read model, tenant scope, bounded pagination/search, allowlisted projections, currency-grouped totals and receivables ageing. |
| `backend/tests/unit/commercial/billing/billingReadModel.service.test.mjs` | Six service unit tests for scope, pagination, exact decimal helper, projection safety, search escaping and fail-closed database state. |

## 3. New frontend files (2)

| File | Purpose |
|---|---|
| `frontend/src/pages/billing/BillingDashboardPage.jsx` | Shared protected page implementation for platform, institution and finance workspaces; live API reads, loading/error/empty states, data status bars, tables, search and pagination. |
| `frontend/src/pages/billing/BillingDashboardPage.css` | Responsive dashboard styling using official TITech theme variables and light/dark-compatible surface tokens. |

## 4. New automated gate/test files (2)

| File | Purpose |
|---|---|
| `scripts/billing-read-contract-gate.mjs` | Static route, read-only, tenant, RBAC, brand/theme and production-false contract gate. |
| `scripts/billing-dashboard-contract.test.mjs` | Four source-contract tests covering API paths, route/nav registration, honest financial-state UI and official theme tokens. |

## 5. New documentation files (15)

Under `docs/billing/`:

1. `BILLING_IMPLEMENTATION_INVENTORY.md`
2. `BILLING_GAP_ANALYSIS.md`
3. `BILLING_EXISTING_ARCHITECTURE_MAP.md`
4. `BILLING_TARGET_ARCHITECTURE.md`
5. `BILLING_DATA_MODEL.md`
6. `BILLING_API_REFERENCE.md`
7. `BILLING_RBAC_MATRIX.md`
8. `BILLING_FINANCIAL_CONTROL_SPECIFICATION.md`
9. `BILLING_USAGE_AND_PRICING_SPECIFICATION.md`
10. `BILLING_PAYMENT_AND_RECONCILIATION_SPECIFICATION.md`
11. `BILLING_TEST_STRATEGY.md`
12. `BILLING_SECURITY_ASSESSMENT.md`
13. `BILLING_DEPLOYMENT_RUNBOOK.md`
14. `BILLING_OPERATIONS_RUNBOOK.md`
15. `BILLING_RELEASE_READINESS.md`

## 6. Reference screenshots retained (3)

Under `docs/billing/reference/`:

- `platform-owner-billing-control-centre-reference.jfif`
- `institution-my-billing-reference.jfif`
- `finance-collections-reference.jfif`

They are source design references only; their sample figures are not copied into production UI.

## 7. Gate-generated JSON evidence (4)

- `reports/official-theme-audit.json`
- `reports/rbac-security-gate.json`
- `reports/release-readiness.json`
- `reports/runtime-import-audit.json`

## 8. Execution evidence created (3)

- `docs/evidence/2026-11-27-billing-read-model/EXECUTION_REPORT.md`
- `docs/evidence/2026-11-27-billing-read-model/TEST_RESULTS.md`
- `docs/evidence/2026-11-27-billing-read-model/CHANGED_FILES.md` (this file)

## 9. Step-by-step discovery path

1. Start at `README.md` for the latest archive-local status and official identity.
2. Read `docs/billing/BILLING_IMPLEMENTATION_INVENTORY.md` to see which components existed and which of the 22 commercial files were empty.
3. Read `docs/billing/BILLING_EXISTING_ARCHITECTURE_MAP.md` to locate the canonical authentication, tenant, route, DB, RBAC and financial modules reused.
4. Read `backend/routes/index.js` to find the billing route mount, then `backend/commercial/api/billingRead.routes.js` for endpoint permissions and scope.
5. Read `backend/commercial/services/billing/billingReadModel.service.js` for actual query rules and output projections.
6. Read `frontend/src/routes/AppRoutes.jsx`, `frontend/src/navigation/navigationRegistry.js` and `frontend/src/pages/billing/BillingDashboardPage.jsx` for route, navigation and UI wiring.
7. Read `BILLING_API_REFERENCE.md` and `BILLING_RBAC_MATRIX.md` for the nine GET endpoints and role policy.
8. Read `BILLING_FINANCIAL_CONTROL_SPECIFICATION.md` and `BILLING_PAYMENT_AND_RECONCILIATION_SPECIFICATION.md` for explicit money-movement boundaries.
9. Run `npm run check:billing-read` and `npm run test:billing-read` to reproduce the focused validation.
10. Read `TEST_RESULTS.md` and `BILLING_RELEASE_READINESS.md` before considering any deployment.
