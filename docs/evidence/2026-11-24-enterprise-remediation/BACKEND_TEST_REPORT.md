# Backend test report — 24 November 2026

## Passed Node-native focused suites

| Suite | Tests |
|---|---:|
| Education public route contract | 3/3 PASS |
| Education campaign policy | 6/6 PASS |
| Education campaign transaction contract | 2/2 PASS |
| Group-wallet RBAC/tenant policy | 10/10 PASS |
| Daily video provider adapter | 5/5 PASS (mocked provider calls) |
| Meeting lifecycle/access policy | 4/4 PASS |
| **Total selected native tests** | **30/30 PASS** |

The additional runtime contract suite passed 2/2 and is included in the top-level total of 32/32 focused Node-native tests.

## Blocked backend validation

- Executed `npm --prefix backend test`: **FAILED TO START (exit 1)** with `Cannot find module .../backend/node_modules/jest/bin/jest.js`. Jest is declared in the backend manifest and lockfile, but backend dependencies were not installed. The complete Jest suite and `test:ci` therefore remain BLOCKED; they were not counted as test failures in the selected 30 native tests.
- Executed root `npm run build`: backend syntax check passed, then `npm run diagnose:routes` failed with `ERR_MODULE_NOT_FOUND: express` because backend dependencies are absent. Frontend build was not reached by the root build.
- No Express server started. `/api/v1/health` and `/api/v1/ready` were not queried.
- No MongoDB or Redis integration, tenant API E2E, migration, ledger replay or external webhook was executed.

Tests are selected contract/policy tests, not full backend regression-suite completion.
