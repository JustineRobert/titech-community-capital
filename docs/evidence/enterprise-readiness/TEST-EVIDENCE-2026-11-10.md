# TITech Community Capital — Test Evidence, 10 November 2026

**Environment:** Node.js 22.16.0 / npm 10.9.2; dependencies absent; MongoDB, Redis and Docker unavailable.  
**Required project environment:** Node.js >=24.15.0 / npm >=11.0.0.  
**Scope:** Selected dependency-free Node tests plus source/static/contract gates. Not a full repository suite.

## 1. Executed tests

| Command group | Tests | Passed | Failed | Skipped |
|---|---:|---:|---:|---:|
| `node --test backend/tests/unit/inclusive-onboarding/*.test.mjs` | 27 | 27 | 0 | 0 |
| `node --test backend/tests/unit/education/*.test.mjs` | 12 | 12 | 0 | 0 |
| `node --test backend/tests/unit/edufinance/*.test.mjs` | 16 | 16 | 0 | 0 |
| `node --test scripts/titech-critical-gates.test.mjs scripts/organization-profile-gate.test.mjs scripts/financial-metric-display.test.mjs scripts/frontend-runtime-audit.test.mjs` | 10 | 10 | 0 | 0 |
| `node --test tests/performance/performance-contract.test.mjs` | 8 | 8 | 0 | 0 |
| `node --test scripts/financial-product-rules.test.mjs scripts/document-malware-scan.test.mjs` | 9 | 9 | 0 | 0 |
| `node --test backend/tests/unit/payroll/payroll.read-authorization.test.mjs` | 8 | 8 | 0 | 0 |
| **Total** | **90** | **90** | **0** | **0** |

These are selected tests only. The historical 86 passed tests cited by the previous baseline came from nine selected, non-overlapping runs and are not counted in the 90-test total. The repository-wide complete backend/frontend test suite was not run.

## 2. Source/static/contract gates

| Command | Result | Scope/qualification |
|---|---|---|
| `node scripts/enterprise-gate.mjs --syntax` | PASS | 2,512 JS/TS-family files parsed; runtime warning remains Node 22 vs Node 24.15 target |
| `node scripts/check-conflicts.js` | PASS | No conflict markers; 3,614 files scanned |
| `node scripts/titech-implementation-gate.mjs` | PASS | Bootstrap/compatibility/brand contract only |
| `node scripts/titech-hosting-gate.mjs` | PASS | Hosting artifacts, environment templates, edge, PWA and compose contracts |
| `node scripts/financial-static-gate.mjs` | PASS | 12 canonical financial files; static analysis, not transactional execution |
| `node scripts/ussd-contract-gate.mjs` | PASS | Contract only; providerVerified=false, networkVerified=false, productionApproved=false |
| `node scripts/enterprise-contract-contracts.mjs` | PASS | 11 control-plane contracts |
| `node scripts/runtime-import-audit.mjs` | PASS with warning | 2,059 backend sources scanned; zero missing imports in canonical financial surface; 208 legacy/non-critical unresolved candidates |
| `node scripts/official-theme-audit.mjs` | PASS | Nine colours, theme/bootstrap/logo contracts, 69 non-brand CSS files, zero hard-coded official palette occurrences |
| `node scripts/organization-profile-gate.mjs` | PASS | Configured identity/current profile integration; external documentary verification remains pending |
| `node scripts/performance-contract-gate.mjs` | PASS | Safe read-only capacity test contract; no actual load test result |
| `node scripts/i18n-validation.mjs` | PASS | 33 checks; EN/SW/FR/AR each 602/602 keys; SW/FR/AR human review pending |
| `node scripts/frontend-runtime-audit.mjs` | PASS WITH WARNING | 11/12 pass; no `frontend/dist`, so no built-bundle runtime proof |
| `node scripts/rbac-security-gate.mjs` | PASS | Static role/permission guardrail; not complete cross-tenant HTTP integration |
| `node scripts/security-static-gate.mjs` | PASS | Static security guardrail only; not an independent penetration test |
| `node scripts/test-discovery-audit.mjs` | PASS | 179 test files; 26 empty; 33 planned/non-executable specs |
| `node scripts/titech-critical-gates.mjs` | PASS contract / release BLOCKED | Eight P0/P1 gates remain open; productionApproved=false |
| `node scripts/release-readiness-gate.mjs --audit` | PASS with warnings | Runtime mismatch and 208 legacy import candidates remain |

## 3. Commands attempted but blocked/failed due environment

| Command | Result | Actual reason |
|---|---|---|
| `node scripts/titech-supported-runtime-gate.mjs` | BLOCKED | Observed Node 22.16.0/npm 10.9.2; required >=24.15.0/npm >=11.0.0 |
| `npm run build` | Not run to completion | `vite: not found` because frontend dependencies are not installed |
| `npm run lint` | Not run to completion | `eslint: not found` because backend dependencies are not installed |
| `npm run test:frontend:ci` | Not run to completion | `vitest: not found` because frontend dependencies are not installed |
| `npm run test:backend:ci` | Not run to completion | Required `backend/node_modules/jest/bin/jest.js` is absent |
| `node scripts/verify-legal-release-gate.mjs` | BLOCKED | Legal publication sign-off and production acceptance persistence/audit are not integrated/approved |
| `node scripts/production-approval-gate.mjs` | BLOCKED | Missing protected approval evidence: `TITECH_PRODUCTION_APPROVAL`, `TITECH_APPROVAL_REFERENCE`, `TITECH_APPROVAL_EXPIRES_AT` |

`mongod`, `redis-server`, `docker` and all three project `node_modules` directories were absent. No MongoDB/Redis-backed integration suite, replica-set transaction test, full bootstrap, backend API/E2E, browser Vitest, provider sandbox/live call, load test or backup/restore drill was run.

## 4. Current test debt

- 179 test files are detected by the repository test-discovery script.
- 26 empty test files remain tracked as test debt, not passed tests.
- 33 planned/non-executable specification documents remain planned, not executed tests.
- Frontend payroll contract tests were updated, but could not execute until the Vite/Vitest dependencies are cleanly installed under the supported runtime.
- Current selected 90-test run has zero skipped tests. This does not imply no tests are blocked or planned across the repository.

## 5. Interpretation

Static/contract checks and the selected native tests provide useful evidence for source-level correctness. They do not prove that the complete platform starts, connects to MongoDB/Redis, builds, passes the full suite, correctly performs concurrent financial posting, contacts payment providers, survives outages, restores backups, isolates all tenant records under runtime conditions, or has legal/partner authorization. Keep production approval false.
