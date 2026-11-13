# End-to-end test results — 13 November 2026

## Important distinction

The successful tests below are dependency-free Node unit/contract or static repository gates executed against the archive-local working tree. They are **not** a completed end-to-end test across browser, backend, MongoDB, Redis, payment provider and Vercel.

## Passed checks

| Test / gate | Recorded result | Meaning |
|---|---:|---|
| Organization profile gate | 13/13 PASS | Product/company identity, ERN source/status, postal address, footer/profile wiring, pending verification and `productionApproved=false`. |
| Official theme audit | 22/22 PASS | Nine palette values, reference image contract, central token bridge, light/dark rules, responsive/shared UI checks; 73 non-brand frontend CSS files scanned and 0 hardcoded official palette occurrences found. |
| Identity + critical-gate Node tests | 5/5 PASS | Identity and critical-release contract assertions. |
| Inclusive onboarding tests | 27/27 PASS | Consent/partner-mediated/refugee-inclusive onboarding focused test suite. |
| UbuntuFloat tests | 13/13 PASS | UbuntuFloat focused unit test suite. |
| USSD tests | 10/10 PASS | USSD module focused test suite. |
| Faith & Community Giving donation contract tests | 4/4 PASS | Focused donation contract tests. |
| Financial product rules tests | 5/5 PASS | Pure financial product policy/rules tests. |
| **Focused Node tests total** | **64 PASS** | Sum of the six named Node test suites; does not include every gate or imply E2E. |
| Critical gate contract | PASS (release BLOCKED) | Required P0/P1 blockers are exposed; production approval remains false. |
| USSD contract gate | 10/10 PASS | USSD architecture and route/static assertions. |
| Financial static gate | PASS | 12 named static financial boundary checks (see `financial-static-gate.txt`). |
| RBAC security gate | PASS | Static RBAC contract only; not a full tenant penetration test. |
| Hosting contract gate | 7/7 PASS | Static hosting/theme/compose/edge contract only; not Vercel. |
| Implementation contract gate | PASS | Existing implementation contract. |
| Enterprise contract gate | 11/11 PASS | Eleven static contract controls. |
| JavaScript/TypeScript syntax gate | PASS | 2,544 JS/TS-family files parsed under Node 22; warning runtime baseline is not met. |
| Merge conflict marker scan | PASS | No conflict markers found in scanned 3,696 files. |

Raw test output files are stored in this directory: `identity-and-release-tests.tap`, `inclusive-onboarding-tests.tap`, `ubuntu-float-tests.tap`, `ussd-tests.tap`, `faith-giving-donations-tests.tap`, and `financial-product-rules-tests.tap`. Static gate output is also retained here.

## Failed / blocked commands

| Command | Result | Actual failure |
|---|---|---|
| `node scripts/titech-supported-runtime-gate.mjs` | BLOCKED | Runtime observed Node 22.16.0/npm 10.9.2, below Node 24.15.0/npm 11.0.0. |
| `npm run build` | FAIL / BLOCKED | Exit 127: `vite: not found`; dependencies are not installed. |
| `npm run test:ci` | FAIL / BLOCKED | Backend Jest entrypoint missing (`backend/node_modules/jest/bin/jest.js`); complete test workflow did not run. |

## Not run / blocked integration and E2E tests

- `npm ci` / full dependency installation on supported runtime.
- Complete root/backend/frontend lint and format checks.
- Full backend Jest and frontend Vitest suites.
- React browser E2E / accessibility / responsive visual testing.
- Express startup and readiness check.
- MongoDB transaction/replica-set and unique-index verification.
- Redis persistence, namespace, refresh-token store and outage tests.
- Authentication, session, cookie, CSRF and cross-tenant integration tests.
- Provider sandbox signatures, callbacks, timeout-to-UNKNOWN and settlement tests.
- Canonical ledger posting, reversal, duplicate replay, reconciliation and period-close integration.
- Live Vercel deployment, production API and smoke tests.

Do not treat a gate that was not executable as PASS.
