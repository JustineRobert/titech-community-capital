# TITech Community Capital — Change Discovery and Implementation Report

**Evidence date:** 11 October 2026  
**Release decision:** NOT READY  
**Production approval:** NO

## 1. Source comparison and change counts

The original `titech-community-capital-main(1).zip` remains unchanged. The working tree is compared against that extracted ZIP. The October 8 authentication-remediation ZIP was inspected and used selectively; it was not copied wholesale over the newer baseline.

**Content delta: 88 paths — 57 added, 28 modified, 3 deleted.**
The complete path inventory includes before/after sizes and SHA-256 hashes in `reports/change-manifest-2026-10-11.csv`; machine-readable counts and full records are in `reports/change-manifest-2026-10-11.json`.

Three self-indexing artifacts are present in this ZIP but excluded from their own hash-delta calculations to avoid circular checksums: `reports/change-manifest-2026-10-11.csv`, `reports/change-manifest-2026-10-11.json`, and `docs/evidence/change-discovery-2026-10-11.md`.

The extracted source ZIP does not contain `.git` metadata. A public GitHub `main` page and selected source files were compared, but a complete clone/diff against the entire remote `main` was not possible because GitHub DNS resolution failed in this execution container. This local package does not claim to contain every remote-only file. No commit, push, merge or PR was made.

## 2. Step-by-step what was changed and why

### Step 1 — Preserve baseline and establish repository truth

- Kept the supplied baseline ZIP intact and extracted a separate working tree.
- Inspected the October 8 remediation archive for prior targeted readiness, bootstrap, module-boundary and authentication fixes; carried those forward selectively.
- Recorded the actual available runtime (Node 22.16.0/npm 10.9.2), the repository target (Node >=24.15.0/npm >=11.0.0), missing dependency directories and the absence of local Git history.

### Step 2 — Backend bootstrap and readiness

- Kept `/api/v1/ready` fail-closed: readiness begins false, and readiness must be explicitly established by the actual callback; absent/false/error results cannot return a fabricated `ready` response.
- Tightened the bootstrap-provided readiness callback so a database adapter object without an explicit readiness/connection contract is not treated as healthy.
- Preserved the established `/api/auth/*`, `/api/v1/ready`, `/api/v1/health`, and JWT/HttpOnly refresh-cookie architecture.
- Carried forward the prior `.js` → `.cjs` corrections for explicit CommonJS adapters and ESM bootstrap boundary corrections; the callers were updated in the same change set.

### Step 3 — Frontend runtime connectivity and login gate

- Maintained one shared readiness probe with request single-flight, AbortController signal support, generation invalidation and stale-result protection.
- Added distinct `REQUEST_TIMEOUT`, `REQUEST_CANCELLED` and `HTTP_SERVER_ERROR` outcomes rather than collapsing all failures into generic API-unavailable state.
- Wired the canonical readiness request to cancellation, classifies 503/not-ready separately from other 5xx, and keeps readiness/health responses out of generic API interceptor state updates.
- Login submission performs a fresh readiness preflight and does not submit the password unless the API is confirmed `READY` at that point.
- Added a dependency-free Node harness with five scenarios and expanded the existing frontend connectivity test file with offline-abort and timeout/server-error regression cases. The Vitest suite itself could not be launched because dependencies are absent.

### Step 4 — Preserve theme contract

- Preserved the existing official nine-color theme, light/dark mode runtime, circular TITech logo references, web/PWA theme entrypoints and mobile palette.
- Re-ran the existing theme audit: 19 checks passed; 57 non-brand CSS files consume the centralized theme layer, with no duplicated official hex literals in those CSS files. No palette or brand redesign was necessary.

### Step 5 — Inventory financial product truth and freeze unsafe expansion

- Added current evidence artifacts to distinguish existing one-off savings/contribution and canonical finance service foundations from a proven real money path.
- Marked the recurring-plan/occurrence workflow missing because no complete persisted schedule → occurrence → authorized provider instruction → settled funding → canonical transaction/journal → receipt/outbox/audit → reconciliation path was found/proven.
- Kept fixed-deposit live activation gated until approved terms, cleared funds, deterministic accrual/maturity, authorized payout/reinvestment and reconciliation are all proven.
- Kept investment execution disabled/contract-gated; internal portfolio/strategy utilities and `INVESTMENT` labels are not a customer order/holding/redemption lifecycle.

### Step 6 — Validation and honest evidence reporting

- Ran the target-available syntax, readiness/runtime contract, theme, canonical-financial static/import, RBAC, control-plane, money arithmetic and native connectivity checks.
- Recorded missing Node/npm target versions, absent dependencies, blocked Jest/Vitest/Vite/ESLint/Pino checks and missing live DB/Redis/provider/browser E2E as blockers rather than passing results.

## 3. Full changed-path discovery

Every content delta path is listed below and in the CSV/JSON manifest. `ADDED`, `MODIFIED`, and `DELETED` reflect byte/hash comparison against the extracted baseline ZIP; they do not imply production readiness.

### Backend startup/readiness/auth (24 paths)

| State | Path | Before bytes | After bytes |
|---|---|---:|---:|
| MODIFIED | `backend/bootstrap/ApplicationBootstrap.js` | 93871 | 96016 |
| ADDED | `backend/bootstrap/database.cjs` | 0 | 49965 |
| DELETED | `backend/bootstrap/database.js` | 49959 | 0 |
| MODIFIED | `backend/bootstrap/infrastructure.js` | 69598 | 69606 |
| MODIFIED | `backend/bootstrap/infrastructure/index.js` | 40977 | 43995 |
| MODIFIED | `backend/bootstrap/middleware.js` | 34980 | 34974 |
| MODIFIED | `backend/bootstrap/server.js` | 66500 | 64480 |
| MODIFIED | `backend/bootstrap/services.js` | 90351 | 89913 |
| MODIFIED | `backend/config/auth.config.js` | 960 | 1064 |
| ADDED | `backend/config/db.cjs` | 0 | 76029 |
| DELETED | `backend/config/db.js` | 76027 | 0 |
| MODIFIED | `backend/config/environment/validation/databaseValidator.js` | 73437 | 73438 |
| MODIFIED | `backend/config/performanceOptimization.js` | 82636 | 82637 |
| ADDED | `backend/config/redis.cjs` | 0 | 69141 |
| DELETED | `backend/config/redis.js` | 69140 | 0 |
| MODIFIED | `backend/controllers/authController.js` | 30724 | 31915 |
| MODIFIED | `backend/routes/index.js` | 42088 | 43470 |
| MODIFIED | `backend/routes/index.test.js` | 83544 | 85457 |
| MODIFIED | `backend/services/airtel/auth.js` | 12239 | 12243 |
| MODIFIED | `backend/services/airtel/reconciliation.js` | 14849 | 14853 |
| MODIFIED | `backend/services/airtel/webhooks.js` | 12730 | 12734 |
| MODIFIED | `backend/services/redis.cjs` | 13433 | 13904 |
| MODIFIED | `backend/services/ussdSessionService.js` | 10857 | 10861 |
| MODIFIED | `backend/src/infrastructure/monitoring/health.controller.js` | 8333 | 8337 |

### Backend/supporting (3 paths)

| State | Path | Before bytes | After bytes |
|---|---|---:|---:|
| ADDED | `backend/.env.production.example` | 0 | 3389 |
| MODIFIED | `backend/scripts/seed-admin.js` | 2706 | 2710 |
| MODIFIED | `backend/scripts/seed-group.js` | 4235 | 4239 |

### Documentation/evidence (10 paths)

| State | Path | Before bytes | After bytes |
|---|---|---:|---:|
| ADDED | `docs/API_READINESS_CONTRACT.md` | 0 | 2302 |
| ADDED | `docs/AUTHENTICATION_RUNTIME_FLOW.md` | 0 | 3602 |
| ADDED | `docs/AUTH_FAILURE_MATRIX.md` | 0 | 2711 |
| ADDED | `docs/AUTH_PRODUCTION_READINESS.md` | 0 | 1974 |
| ADDED | `docs/LOGIN_AUTH_REMEDIATION.md` | 0 | 6643 |
| ADDED | `docs/REMEDIATION_VERIFICATION_2026-10-11.md` | 0 | 2606 |
| ADDED | `docs/evidence/financial-data-flow-and-enable-gates-2026-10-11.md` | 0 | 3458 |
| ADDED | `docs/evidence/financial-products-baseline-2026-10-11.md` | 0 | 7501 |
| ADDED | `docs/evidence/implementation-inventory-2026-10-11.csv` | 0 | 6118 |
| ADDED | `docs/evidence/implementation-inventory-2026-10-11.json` | 0 | 7712 |

### Environment templates (1 paths)

| State | Path | Before bytes | After bytes |
|---|---|---:|---:|
| ADDED | `frontend/.env.production.example` | 0 | 585 |

### Frontend connectivity/login (4 paths)

| State | Path | Before bytes | After bytes |
|---|---|---:|---:|
| MODIFIED | `frontend/src/pages/Login.jsx` | 36594 | 38815 |
| MODIFIED | `frontend/src/services/api.js` | 58915 | 62140 |
| MODIFIED | `frontend/src/services/runtimeConnectivity.js` | 8011 | 10825 |
| MODIFIED | `frontend/src/services/runtimeConnectivity.test.js` | 4165 | 7187 |

### Platform/root (3 paths)

| State | Path | Before bytes | After bytes |
|---|---|---:|---:|
| MODIFIED | `.gitignore` | 2938 | 2963 |
| ADDED | `TITECH_NOT_YET_PROVEN_2026-10-11.md` | 0 | 3592 |
| MODIFIED | `TITECH_PLATFORM_TRUTH.md` | 5010 | 5503 |

### Test evidence/reports (39 paths)

| State | Path | Before bytes | After bytes |
|---|---|---:|---:|
| ADDED | `reports/additional-validation-results-2026-10-11.json` | 0 | 3218 |
| ADDED | `reports/backend-check-syntax-2026-10-11.log` | 0 | 250 |
| ADDED | `reports/backend-esm-import-check-2026-10-11.log` | 0 | 1377 |
| ADDED | `reports/control-plane-native-tests-2026-10-11.log` | 0 | 1708 |
| ADDED | `reports/enterprise-contract-contracts-2026-10-11.log` | 0 | 69 |
| ADDED | `reports/enterprise-syntax-gate-2026-10-11.log` | 0 | 168 |
| ADDED | `reports/financial-money-native-tests-2026-10-11.log` | 0 | 655 |
| ADDED | `reports/financial-static-gate-2026-10-11.log` | 0 | 58 |
| ADDED | `reports/frontend-production-build-2026-10-11.log` | 0 | 86 |
| ADDED | `reports/frontend-runtime-audit-2026-10-11.log` | 0 | 3267 |
| ADDED | `reports/frontend-runtime-audit.json` | 0 | 3267 |
| ADDED | `reports/frontend-runtime-native-tests-2026-10-11.log` | 0 | 510 |
| ADDED | `reports/frontend-tests-2026-10-11.log` | 0 | 99 |
| ADDED | `reports/full-backend-tests-2026-10-11.log` | 0 | 974 |
| ADDED | `reports/lint-2026-10-11.log` | 0 | 252 |
| ADDED | `reports/login-readiness-contract-2026-10-11.log` | 0 | 52 |
| ADDED | `reports/node-check-bootstrap-2026-10-11.log` | 0 | 12 |
| ADDED | `reports/node-check-cjs-db-2026-10-11.log` | 0 | 12 |
| ADDED | `reports/node-check-cjs-redis-2026-10-11.log` | 0 | 12 |
| ADDED | `reports/node-check-frontend-api-2026-10-11.log` | 0 | 0 |
| ADDED | `reports/node-check-server-bootstrap-2026-10-11.log` | 0 | 12 |
| ADDED | `reports/node-check-touched-auth-2026-10-11.log` | 0 | 12 |
| ADDED | `reports/node-check-touched-esm-2026-10-11.log` | 0 | 12 |
| ADDED | `reports/official-theme-audit-2026-10-11.log` | 0 | 4127 |
| ADDED | `reports/official-theme-audit.json` | 0 | 4127 |
| ADDED | `reports/rbac-security-gate-2026-10-11.log` | 0 | 25 |
| ADDED | `reports/rbac-security-gate.json` | 0 | 2100 |
| ADDED | `reports/runtime-connectivity-state-2026-10-11.log` | 0 | 60 |
| ADDED | `reports/runtime-contract-2026-10-11.log` | 0 | 32 |
| ADDED | `reports/runtime-import-audit-2026-10-11.log` | 0 | 387 |
| ADDED | `reports/runtime-import-audit.json` | 0 | 33240 |
| ADDED | `reports/runtime-validation-results-2026-10-11.json` | 0 | 3959 |
| ADDED | `reports/static-validation-results-2026-10-11.json` | 0 | 6550 |
| ADDED | `reports/test-discovery-audit-2026-10-11.log` | 0 | 229 |
| ADDED | `reports/test-discovery-audit.json` | 0 | 3718 |
| ADDED | `reports/titech-hosting-gate-2026-10-11.log` | 0 | 903 |
| ADDED | `reports/titech-hosting-gate.json` | 0 | 903 |
| ADDED | `reports/titech-implementation-gate-2026-10-02.json` | 0 | 387 |
| ADDED | `reports/titech-implementation-gate-2026-10-11.log` | 0 | 387 |

### Validation tooling (4 paths)

| State | Path | Before bytes | After bytes |
|---|---|---:|---:|
| MODIFIED | `package.json` | 8020 | 8197 |
| ADDED | `scripts/verify-login-readiness-remediation.mjs` | 0 | 5356 |
| ADDED | `scripts/verify-runtime-connectivity-state.mjs` | 0 | 3190 |
| MODIFIED | `scripts/verify-runtime-contract.mjs` | 2103 | 2605 |

## 4. How to review the implementation in dependency order

1. `backend/routes/index.js` — canonical readiness route, including fail-closed default.
2. `backend/bootstrap/ApplicationBootstrap.js` and `backend/bootstrap/infrastructure/index.js` — application/required dependency readiness integration.
3. `backend/bootstrap/server.js`, `backend/bootstrap/database.cjs`, `backend/config/db.cjs`, `backend/config/redis.cjs` — server/bootstrap and module boundaries.
4. `frontend/src/services/runtimeConnectivity.js` — single-flight/cancellable connectivity state machine and result classification.
5. `frontend/src/services/api.js` — canonical `GET /api/v1/ready` HTTP request, cancellation and response contract.
6. `frontend/src/pages/Login.jsx` — preflight before sending credentials and distinct service error messaging.
7. `backend/routes/index.test.js`, `frontend/src/services/runtimeConnectivity.test.js`, `scripts/verify-runtime-connectivity-state.mjs` — regression tests/harness.
8. `TITECH_PLATFORM_TRUTH.md`, `TITECH_NOT_YET_PROVEN_2026-10-11.md`, `docs/REMEDIATION_VERIFICATION_2026-10-11.md`, `docs/evidence/financial-products-baseline-2026-10-11.md` — release decision and residual evidence gaps.

## 5. Rollback and rollout safety

- The original ZIP has not been modified. For source rollback, restore the relevant modified paths from that archive; for `.js` → `.cjs` boundaries restore the import/callers and target files together.
- There is no database migration or live financial operation introduced by this remediation. Still capture an environment backup before any deployment, install with the declared Node/npm versions, and validate on a feature branch.
- Do not enable a controlled financial pilot until target-runtime install/build/tests, backend listener/readiness HTTP evidence, browser authentication/session/tenant/RBAC E2E, live DB/Redis, security, provider settlement/reconciliation and relevant legal/customer gates pass.

## Addendum — exact supplied-archive delta for this delivery

This archive already contains an older change-discovery narrative with an 88-path count based on a different historical comparison baseline. For the package delivered in this conversation, the file-level comparison was rerun against the exact uploaded `/mnt/data/titech-community-capital-main.zip`. The authoritative delta for this delivery is `docs/evidence/implementation-file-delta-2026-10-11.csv` plus the machine-readable `.json` (54 listed records: 38 added, 16 modified, 0 deleted; physical package delta including the two manifest files is 56 paths: 40 added, 16 modified, 0 deleted). The manifests deliberately exclude themselves from their own records to avoid self-referential hashes. The new handoff and latest validation run-up are in `docs/evidence/implementation-handoff-2026-10-11.md` and `reports/current-run-validation-summary-2026-10-11.json`.

The source archive has no `.git` directory. Selected files from remote GitHub `main` were compared, but that did not establish a full branch-level content diff. No commit, push, merge, pull request or deployment occurred. The older count above is retained as historical context; use the supplied-archive-relative manifest for this package's exact delta.
