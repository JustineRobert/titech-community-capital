# TITech Community Capital — File Change Discovery

**Organization:** TITech Capital SMC LTD  
**Product:** TITech Community Capital  
**Review date:** 11 November 2026

## Source baseline

- Input archive: `titech-community-capital-main.zip`
- Archive SHA-256: `84f517eb74233db232377eeb44f401b087f32d8fba21350f1c9e60d924c8081e`
- Archive comment: `d45650d3bdef9200911af18767f8b0a6237a7329`
- The archive contains no `.git` directory. `git status`, `git diff`, `git branch`, `git remote` and local-vs-remote comparisons are unavailable and were not fabricated.
- No file from the user's source snapshot was deleted. The root `package.json` test script was extended only to make the new privacy contract run as part of the existing navigation/group regression suite; no dependency or lockfile changes were made.

## Source-code changes

| # | Exact path | Change | Why | Verification |
|---:|---|---|---|---|
| 1 | `frontend/src/routes/AppRoutes.jsx` | Imported and mounted the existing `RouteErrorBoundary` around the active `Suspense` + `ApplicationRouteTree`. Simplified the lazy import helper so import failures are rethrown to the boundary; development logs include the lazy route name. Removed the old unconditional reload / never-settling Promise behaviour. | Route-level boundary existed but was not mounted; old helper treated all failures as stale chunks and could strand a route in loading state. | Route contract tests; all 38 lazy target paths statically resolve; syntax gate |
| 2 | `frontend/src/components/ui/ErrorBoundary.jsx` | Added `getSafePageLocation()` and changed persisted `url` context to origin + pathname only. | Avoids copying query strings/fragments that may contain one-time reset/invitation values into sessionStorage or telemetry. | New native source-contract test |
| 3 | `scripts/tests/navigation-routes-contract.test.mjs` | Added `/faith-community-giving` and `/faith-community-giving/manage` to the expected navigation-route map and public route assertions; added route error-boundary and lazy-target existence checks. | Corrects false route coverage failure and protects the active route import contract. | `npm run test:navigation-groups` PASS |
| 4 | `scripts/tests/error-boundary-privacy-contract.test.mjs` | New native contract test checks persisted error context uses the safe origin/path helper and does not persist `window.location.href`. | Regression protection for query/fragment minimisation. | Included in `npm run test:navigation-groups`; PASS |
| 5 | `package.json` | Added the privacy contract test to the existing `test:navigation-groups` script. | Ensures the regression guard is included in the standard `test:ci` path, rather than relying on a separate manual command. | `npm run test:navigation-groups`: 15/15 PASS |

## Documentation added

| # | Exact path | Purpose |
|---:|---|---|
| 6 | `docs/remediation/PLATFORM_RUNTIME_ROOT_CAUSE_REPORT.md` | Source/runtime baseline, active bootstrap/router, verified defects, scan findings and blockers |
| 7 | `docs/remediation/PLATFORM_ROUTE_COVERAGE_MATRIX.md` | Mounted route inventory, access boundaries, lazy import findings and browser verification gaps |
| 8 | `docs/remediation/PLATFORM_API_DEPENDENCY_MATRIX.md` | Static page-to-API client call inventory and missing runtime contract evidence |
| 9 | `docs/remediation/PLATFORM_SECURITY_REGRESSION_REPORT.md` | Security controls inspected, changes, test evidence and external review gaps |
| 10 | `docs/remediation/PLATFORM_E2E_TEST_REPORT.md` | Commands, native test outcomes and AC01–AC30 status |
| 11 | `docs/remediation/PLATFORM_FILE_CHANGE_DISCOVERY.md` | This file; exact source/docs changes and application instructions |
| 12 | `docs/remediation/PLATFORM_PRODUCTION_READINESS_REPORT.md` | Evidence ladder, production blockers and release decision |
| 13 | `docs/runbooks/FRONTEND_APPLICATION_RECOVERY.md` | Frontend setup/build/start/browser diagnosis procedure |
| 14 | `docs/runbooks/BACKEND_API_RECOVERY.md` | Backend/config/MongoDB/Redis/health/readiness recovery procedure |
| 15 | `docs/runbooks/ROUTE_AND_CHUNK_FAILURE_RECOVERY.md` | Route lazy-import and deployment chunk recovery procedure |
| 16 | `docs/evidence/TITECH_EXECUTION_EVIDENCE_2026-11-11.json` | Machine-readable environment, test-suite, static-gate, blocker and file-inventory evidence |

## Step-by-step application/change discovery

1. Open `frontend/src/main.jsx` and confirm it imports `./routes/AppRoutes`; do not edit the unmounted legacy `App.jsx` as a substitute.
2. Open `frontend/src/app/providers.jsx` and confirm the existing `BrowserRouter` is above `AppRoutes`, allowing the router-aware error boundary to use router hooks.
3. Open `frontend/src/routes/AppRoutes.jsx`; confirm the `RouteErrorBoundary` import, the lazy import helper rethrow behaviour and the outer boundary around `Suspense`/`ApplicationRouteTree`.
4. Confirm the route tree still uses its existing `ProtectedRoute`, `AdminRoute` and `FaithGivingManagerRoute`. The remediation did not relax role gates.
5. Open `frontend/src/components/ui/ErrorBoundary.jsx`; confirm `buildErrorContext()` calls `getSafePageLocation()` rather than saving the complete `window.location.href`.
6. Confirm `package.json` includes `scripts/tests/error-boundary-privacy-contract.test.mjs` in `test:navigation-groups`.
7. Run `npm run test:navigation-groups`, `npm run validate:syntax`, `npm run audit:theme`, `npm run audit:organization`, `npm run rbac:gate` and `npm run check:financial`.
8. Inspect this directory for the runtime/API/security gaps before attempting any release or migration.
9. When a full Git checkout is available, compare the patch to the operator's current working tree and do not overwrite uncommitted work. The delivered ZIP is a source copy, not a replacement for a Git diff review.

## User data / architecture preservation

- No MongoDB or Redis data was accessed or modified.
- No migrations or index operations were executed.
- No payment, provider, ledger or reconciliation transaction was executed.
- No authentication, tenant, RBAC, API, financial model, lockfile or deployment contract was replaced.
- No commit, push or deployment occurred.
- Existing theme/brand files were preserved because the supplied official palette audit already passes.

## Required Git commands when reintroduced into the canonical checkout

Run from the operator's existing Git checkout after manually reviewing and applying the four modified files and twelve added files (including the documentation):

```bash
git status --short
git diff --stat
git diff --check
git diff -- frontend/src/routes/AppRoutes.jsx frontend/src/components/ui/ErrorBoundary.jsx scripts/tests/navigation-routes-contract.test.mjs package.json scripts/tests/error-boundary-privacy-contract.test.mjs
```

Do not stage, commit, push or deploy unless separately authorised.
