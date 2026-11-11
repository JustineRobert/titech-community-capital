# TITech Community Capital — Platform Runtime Root-Cause Report

**Organization:** TITech Capital SMC LTD  
**Product:** TITech Community Capital  
**Review date:** 11 November 2026  
**Source:** User-supplied `titech-community-capital-main.zip`  
**Archive SHA-256:** `84f517eb74233db232377eeb44f401b087f32d8fba21350f1c9e60d924c8081e`  
**Archive comment:** `d45650d3bdef9200911af18767f8b0a6237a7329` (metadata only; not a verified local Git HEAD)

## 1. Executive finding

The supplied source snapshot is substantial and contains a defined React/Vite frontend, Express/Mongoose backend, Redis integration, authentication, tenant/RBAC controls, payment/ledger modules, route registries, theme enforcement and extensive static/domain test contracts. It is **not yet demonstrated to be a runnable, production-ready release** in this execution environment.

Three defects were directly verified and remediated in this source copy:

1. `frontend/src/routes/AppRoutes.jsx` declared a route-level error boundary implementation elsewhere in the repository, but did not mount it around the active route tree. Lazy page-load failures therefore had only the application-level boundary.
2. The old `lazyWithRecovery` treated every dynamic import failure as a stale deployment chunk, accessed browser session storage without guarding that access, initiated a reload and returned a never-settling Promise. A genuine missing module/export or transient import error could be concealed behind a permanent Suspense loader.
3. `scripts/tests/navigation-routes-contract.test.mjs` omitted the registered Faith & Community Giving and Giving Administration paths from its expected navigation map, causing a false test failure even though both paths were registered in the mounted router.

A further privacy improvement was applied to the active shared error boundary: the persisted diagnostic page location now excludes URL query strings and fragments, which can contain one-time reset codes or invitation tokens.

The historical browser reference `3434f3ef-5a2c-4cb5-bb6c-fb9034620a0c` was not found in the supplied source snapshot. No browser/server log bundle accompanied the archive, so the historical exception cannot be reconstructed. The exact historical root cause remains **unverified**. The above are verified source defects, not proof that any one of them caused that specific historical reference.

## 2. Repository and runtime baseline

| Item | Observed | Result |
|---|---|---|
| Source format | ZIP archive; no `.git` directory | Git history/status unavailable |
| Archive comment | `d45650d3bdef9200911af18767f8b0a6237a7329` | Not independently verified as HEAD |
| Archive SHA-256 | `84f517eb74233db232377eeb44f401b087f32d8fba21350f1c9e60d924c8081e` | Captured |
| Node.js | `v22.16.0` | Below declared baseline |
| npm | `10.9.2` | Below declared baseline |
| Required Node.js | `>=24.15.0` | Blocked in this runner |
| Required npm | `>=11.0.0` | Blocked in this runner |
| Lockfile | npm lockfile version 3 | Present |
| Dependency directories | No `node_modules` directories in source snapshot | Build/tests requiring packages unavailable |
| MongoDB executable | Not available | Runtime/database tests blocked |
| Redis server | Not available | Runtime/cache/session tests blocked |
| Docker | Not available | Compose integration environment unavailable |
| Chromium | Available | Browser present; application bundle/dependencies unavailable |

The ZIP is not a Git checkout. Do not infer a clean tree, branch, local commit, remote, or equality with `origin/main` from this archive. No Git operations were performed.

## 3. Active application architecture discovered

The active browser entry point is `frontend/index.html` loading `frontend/src/main.jsx`. The mounted chain is:

`main.jsx` → `Providers` → Redux/PersistGate → `BrowserRouter` → `AuthProvider` → `NotificationProvider` → `Bootstrap` → `I18nProvider` → `AppRoutes` → `ApplicationRouteTree`.

`frontend/src/App.jsx` contains a second/legacy routing implementation but is not the component imported by the actual `main.jsx` entry point. It was not deleted because its wider compatibility and test usage were not established. `frontend/src/routes/routeConfig.js` is metadata/configuration; the route tree actually mounted by the entry point is `frontend/src/routes/AppRoutes.jsx`.

The active providers import the application-wide error boundary from `frontend/src/components/ui/ErrorBoundary.jsx`. The repository also contains other boundary implementations. `frontend/src/routes/RouteErrorBoundary.jsx` existed but was unmounted before this remediation. It is now mounted inside the existing `BrowserRouter` context around the active route tree and its Suspense boundary.

The existing authentication, JWT/HttpOnly refresh-cookie, tenant and RBAC implementations were not replaced or weakened. The existing Redis namespace, MongoDB database, payment services, ledger, reconciliation, audit services and backend startup were not rewritten in this narrow route recovery change.

## 4. Route/import investigation

- Active router: `frontend/src/routes/AppRoutes.jsx`.
- Route lazy-import statements statically discovered: 38.
- Lazy-import target paths found in the source tree: 38/38.
- Missing direct lazy-import targets: 0.
- Direct default/named export shape statically checked for those targets: all observed targets had the expected export form.
- The static check does not prove that transitive dependencies resolve at Vite build time or that a page renders in a browser.
- The route registry and route contract tests initially failed on `/faith-community-giving` because the test allow-list omitted this path. The route exists in the active router. The test now covers both `/faith-community-giving` and `/faith-community-giving/manage`.

## 5. Repository-wide source warnings

The supplied source scan found:

- 2,531 executable JS/JSX/MJS/CJS/TS-family source files.
- 248 zero-byte files: 237 under `backend/`, 4 under `frontend/`, 6 under `docs/`, and 1 Postman `.gitkeep`.
- 2,070 backend files scanned by the repository runtime-import audit.
- 208 missing local imports in legacy/non-critical backend paths.
- 0 missing local imports on the canonical financial surface defined by the existing audit.
- 0 mixed-module violations on that canonical financial surface.

The 248 zero-byte paths were inventoried but not deleted or auto-filled. Some may be intentional namespace/placeholder/compatibility files; each must be classified by reference graph and ownership before removal or implementation. The 208 legacy import warnings likewise require path-by-path canonical ownership review. Empty placeholder modules or duplicate services must not be generated to make the count disappear.

## 6. Verification performed

| Check | Result | Meaning |
|---|---|---|
| Supported runtime gate | BLOCKED | Current Node/npm versions do not satisfy project baseline |
| Official theme audit | PASS | Nine-color contract and theme coverage checks passed |
| Organization profile gate | PASS | Product/company configuration is consistent; documentary verification remains pending |
| Runtime import audit | PASS WITH WARNINGS | Canonical financial surface clean; 208 legacy/non-critical missing imports remain |
| Frontend runtime source audit | PASS WITH WARNINGS | 11 pass, 1 warning: no production `frontend/dist` artifact in archive |
| RBAC static gate | PASS | Existing policy contract passed; not a substitute for live cross-tenant E2E |
| Financial static gate | PASS | 12 canonical financial files checked; not a database transaction/replay test |
| Critical-gate contract | PASS / RELEASE BLOCKED | Gate implementation works; eight P0/P1 blockers remain open |
| Implementation gate | PASS | Canonical bootstrap compatibility and official brand metadata detected |
| Hosting contract gate | PASS | Static deployment artifacts/configuration contracts passed |
| Syntax gate | PASS | 2,531 source files parsed; runtime warning retained |
| Focused/native domain tests | PASS | See `PLATFORM_E2E_TEST_REPORT.md`; these are not browser E2E |
| Frontend production build | NOT RUN | No dependencies installed; required Node/npm baseline unavailable; network unavailable |
| Backend startup/readiness | NOT RUN | No dependency installation or MongoDB/Redis runtime available |
| Browser E2E | NOT RUN | No built app/dependencies/API runtime available |
| Security dependency audit | NOT RUN | No npm dependency installation/network access in this environment |

## 7. Remediation applied

See `PLATFORM_FILE_CHANGE_DISCOVERY.md` for the exact paths and step-by-step changes. The changes mount the existing route boundary, ensure lazy-import failures are rethrown to that boundary rather than swallowed, correct route contract coverage, and remove URL query/fragment values from persisted error context.

## 8. Outstanding blockers

The current critical-gate contract reports these open release blockers:

- `P0_RUNTIME_INSTALL`
- `P0_BOOTSTRAP_HEALTH`
- `P0_LEDGER_REPLAY`
- `P0_PROVIDER_FAILURES`
- `P0_TENANT_PERMISSIONS`
- `P1_SECURITY_RECOVERY`
- `P1_REGULATORY_PARTNER`
- `P1_COMMERCIAL_PILOT`

The reported page-loading error must be reproduced in a clean browser profile against a running frontend and backend using the supported runtime, with browser console/network evidence and correlated backend logs. Do not mark the issue closed from static checks alone.

**Decision:** application-source remediation is partial and verified at static/native-test level. Operational readiness and production approval have not been established. `productionApproved=false` must remain in force.
