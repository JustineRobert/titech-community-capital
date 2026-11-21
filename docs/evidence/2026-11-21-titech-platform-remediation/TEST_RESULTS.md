# Test and gate results — 21 November 2026

**Environment:** Node `v22.16.0`, npm `10.9.2`; repo requires Node `24.15.0` / npm `>=11.0.0`. Dependency installation is absent. MongoDB, Redis, Docker and browser automation are unavailable.

## Executed Node test suites

| Command | Passed | Failed | Status |
|---|---:|---:|---|
| `node --test scripts/admin-dashboard-contract.test.mjs` | 9 | 0 | PASS |
| `node --test backend/tests/unit/groups/group-wallet-policy.test.mjs` | 10 | 0 | PASS |
| `node --test backend/modules/faith-community-giving/faithGiving.policy.test.js` | 18 | 0 | PASS |
| `node --test backend/tests/unit/inclusive-onboarding/*.test.mjs` | 27 | 0 | PASS |
| `node --test scripts/organization-profile-gate.test.mjs scripts/financial-metric-display.test.mjs` | 4 | 0 | PASS |
| `node --test scripts/chat-production-gate.test.mjs` | 2 | 0 | PASS (readiness regression tests only) |
| `node --test backend/tests/chat/chat.permissions.test.js backend/tests/chat/chat.validation.test.js` | 2 | 0 | PASS (selected Chat permission/validation tests only) |
| **Total unique selected tests** | **72** | **0** | **PASS** |

The separate focused insurance command ran 8 tests from the inclusive-onboarding suite; those are a subset of the 27 and are not counted again.

The final combined run used the following command (72 tests, 0 failures, 0 skipped):

```bash
node --test scripts/admin-dashboard-contract.test.mjs \
  backend/tests/unit/groups/group-wallet-policy.test.mjs \
  backend/modules/faith-community-giving/faithGiving.policy.test.js \
  backend/tests/unit/inclusive-onboarding/*.test.mjs \
  scripts/organization-profile-gate.test.mjs \
  scripts/financial-metric-display.test.mjs \
  scripts/chat-production-gate.test.mjs \
  backend/tests/chat/chat.permissions.test.js \
  backend/tests/chat/chat.validation.test.js
```

## Syntax and static gates

| Command | Observed result | Status |
|---|---|---|
| `node scripts/enterprise-gate.mjs --syntax` | 2,589 JS/TS-family files parsed; toolchain warning notes local Node 22 versus required Node 24.15. | PASS (syntax only) |
| `node scripts/official-theme-audit.mjs` | Nine palette tokens match; light/dark theme contract passes; 78 non-brand CSS files scanned; zero hard-coded official palette occurrences. | PASS |
| `node scripts/organization-profile-gate.mjs` | 14 identity/profile checks pass; production approval remains disabled. | PASS |
| `node scripts/faith-giving-contract-gate.mjs` | 22 contracts and 8 required backend files present. | PASS |
| `node scripts/rbac-security-gate.mjs` | RBAC static contract checks pass. | PASS |
| `node scripts/financial-static-gate.mjs` | 12 canonical financial files checked. | PASS |
| `node scripts/runtime-import-audit.mjs` | 2,097 backend source files; 208 repo-wide missing local imports; zero on canonical financial surface; no mixed-module violations on that surface. | PASS for canonical financial surface; 208 legacy warnings remain. |
| `node scripts/titech-critical-gates.mjs` | Contract check passes; release status remains BLOCKED with eight open P0/P1 gates. | PASS as gate evaluation; release BLOCKED. |
| `node scripts/titech-supported-runtime-gate.mjs` | Node 22.16.0 / npm 10.9.2 below required baseline. | BLOCKED |
| `node scripts/production-approval-gate.mjs` | Missing protected production approval flag, reference and expiry. | BLOCKED (expected fail-closed behavior) |
| `node scripts/chat-production-gate.mjs` | Eight Chat integration/E2E blockers. | BLOCKED |

## Syntax checks on directly changed executable modules

`node --check` passed for:

- `backend/routes/platformDashboard.js`
- `backend/utils/adminDashboardPresentation.js`
- `frontend/src/services/api.js`
- `frontend/src/pages/admin/adminDashboardData.mjs`
- `scripts/admin-dashboard-contract.test.mjs`

## Not run / blocked (not passing)

- `npm ci` / clean install: not run because the active runtime violates the repo engine contract and dependencies are not installed.
- Full `npm run ci`, backend Jest suites, frontend test suite and production build: not run.
- Actual server startup and live health/readiness/API requests: not run.
- MongoDB replica-set and Redis integration: blocked by missing services.
- Database-backed two-tenant authorization and account isolation tests: not run.
- Browser Playwright E2E, visual screenshots, multi-tab refresh race and accessibility audits: blocked by unavailable browser/dependencies.
- Live mobile-money/insurance provider sandbox, verified settlement and ledger/reconciliation: not run.
- Chat multi-user browser E2E: not run; the Chat readiness gate is BLOCKED.

These source/unit/static successes must not be interpreted as full integration, application E2E or production evidence.
