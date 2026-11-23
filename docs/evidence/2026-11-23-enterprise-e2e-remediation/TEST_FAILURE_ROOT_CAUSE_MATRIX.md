# Test failure and root-cause matrix

| Finding | Confirmed evidence | Classification | Remediation / disposition | Verification |
|---|---|---|---|---|
| Runtime below repository contract | Observed Node 22.16.0 and npm 10.9.2; declared minima Node 24.15.0 and npm 11.0.0 | `ENVIRONMENT_BLOCKER` | No runtime downgrade or engine weakening. Use required runtime before full validation. | `check:runtime` exit 1; strict gate blocked |
| Backend Jest cannot start | `backend/node_modules/jest/bin/jest.js` does not exist; backend dependencies absent | `ENVIRONMENT_BLOCKER` | Dependencies must be installed under supported Node/npm using lockfile. | root `test:ci` stops at this exact launch error |
| Legacy ESM/CJS module debt | module audit: 207 unresolved relative `require()` and 351 CJS→ESM boundaries | `MODULE_SYSTEM_FAILURE` debt | No broad format rewrite without Jest reproduction/consumer contract. Needs prioritized file-level remediation under supported Node. | `audit:modules` exit 2 |
| Runtime-import debt | strict release gate reports 208 missing local imports | `APPLICATION_IMPORT_FAILURE` debt | Needs source-by-source trace with actual import resolution/runtime. | `release:gate:strict` exit 1; warning output |
| Empty test suites | 26 zero-byte `.test.*` files; each paired with `.planned.md` | `EMPTY_TEST_SUITE` / missing coverage | Kept visible and documented; no empty file was marked passed, hidden, or filled with placeholder assertions. The actual planned behavior remains unimplemented. | `audit:test-discovery` JSON |
| Browser E2E unavailable | No Playwright install/frontend dependencies; Chromium alone is insufficient | `ENVIRONMENT_BLOCKER` | Install dependencies and provision isolated app/services; run browser workflow. | No browser E2E command claimed passed |
| Mongo/Redis integration unavailable | No mongod/mongosh, redis-server or Docker binary | `ENVIRONMENT_BLOCKER` | Provision isolated test MongoDB replica set and Redis. | No DB/Redis test claimed passed |
| Production approval evidence absent | required protected values absent: `TITECH_PRODUCTION_APPROVAL`, `TITECH_APPROVAL_REFERENCE`, `TITECH_APPROVAL_EXPIRES_AT` | `EXTERNAL_APPROVAL_BLOCKER` | Internal implementation is not a substitute for external approvals. | production approval gate exit 1 |
| Profile avatar absent/unsafe fallback | new pure helper contract covers URL validation, source fields, display name and initials | `APPLICATION_LOGIC_FAILURE` regression prevention | Shared presentation component consumes authenticated profile; invalid image falls back to initials. | 6/6 Node-native tests pass |
| Dashboard lockup/style contract | previously imported `DashboardHeader.css` was missing; executive eyebrow styling missing | `APPLICATION_LOGIC_FAILURE` UI defect | Added CSS and centralized lockup styles; extended dashboard contract. | 4/4 test cases pass; ten components checked |

## Historical failures are not conflated with this run

The master prompt's older 127-suite / 484-test failure report was not replayed because the supplied archive and execution environment do not provide its original runner environment or log bundle. The only confirmed full-chain failure in this run is the backend Jest executable missing at invocation after 292 native tests passed.
