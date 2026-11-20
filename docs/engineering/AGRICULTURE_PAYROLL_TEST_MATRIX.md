# Agriculture & Payroll Test Matrix

## Executed focused native Node tests

| Suite | Command | Result |
|---|---|---|
| Agriculture domain, Agriculture workflow contract, Faith Giving policy/public route, Meetings policy/Daily provider, Payroll authorization/approval/raw webhook/CSV | `node --test backend/tests/unit/agriculture/agriculture.domain.test.js backend/tests/unit/agriculture/agriculture.workflow-contract.test.mjs backend/modules/faith-community-giving/faithGiving.policy.test.js backend/modules/faith-community-giving/faithGiving.public.routes.test.js backend/modules/meetings/meeting.policy.test.js backend/modules/meetings/providers/dailyProvider.test.js backend/tests/unit/payroll/payroll.read-authorization.test.js backend/tests/unit/payroll/payroll.approval-contract.test.mjs backend/tests/unit/payroll/payroll.raw-webhook-signature.test.mjs backend/tests/unit/payroll/payroll.csv.native.test.mjs` | 52 passed, 0 failed, 0 skipped. |
| Inclusive onboarding, identity, insurance and offline contracts | `node --test backend/tests/unit/inclusive-onboarding/*.test.mjs` | 27 passed, 0 failed, 0 skipped. |
| Donations and community giving contract | `node --test scripts/tests/faith-giving-donations-contract.test.mjs` | 4 passed, 0 failed, 0 skipped. |

**Total focused native tests:** 83 passed, 0 failed, 0 skipped, across the three commands above. These tests are native Node test files and do not substitute for the full Jest/React/browser suites.

## Executed static gates and syntax checks

| Check | Result |
|---|---|
| `node --check` on changed Agriculture services/controllers/routes/domain, Payroll service/routes/crypto, bootstrap middleware and RBAC policy | PASS |
| `node scripts/official-theme-audit.mjs` | PASS; 77 non-brand CSS files scanned, zero hard-coded official palette literals in those CSS files. |
| `node scripts/organization-profile-gate.mjs` | PASS; 14 checks. |
| `node scripts/financial-static-gate.mjs` | PASS; 12 canonical financial files checked. |
| `node scripts/rbac-security-gate.mjs` | PASS. |
| `node scripts/faith-giving-contract-gate.mjs` | PASS — 22 contracts, 8 required backend files. |
| `node scripts/i18n-validation.mjs` | PASS for 33 checks and 602/602 keys in en, sw, fr, ar; human review of sw/fr/ar remains pending and `productionEligible=false`. |
| `node scripts/frontend-runtime-audit.mjs` | PASS_WITH_WARNINGS; 11 pass, 1 warning because `frontend/dist` is absent. |
| `node scripts/titech-supported-runtime-gate.mjs` | BLOCKED: environment Node 22.16.0/npm 10.9.2 below required Node >=24.15.0/npm >=11. |
| `node scripts/production-approval-gate.mjs` | BLOCKED: protected production approval evidence absent. |
| `node scripts/titech-critical-gates.mjs` | Contract PASS, release BLOCKED; 8 blocking gates remain. |

## Build and full-suite attempts

| Command | Exit | Outcome |
|---|---:|---|
| `npm --prefix backend run build` | 0 | PASS; backend build script is a no-compilation validation echo, not a compilation or runtime integration proof. |
| `npm run build:frontend` | 127 | BLOCKED; `vite: not found` because frontend dependencies are not installed. |
| `npm run test:backend -- --runInBand` | 1 | BLOCKED; backend Jest binary is absent at `backend/node_modules/jest/bin/jest.js`. |
| `npm run lint:frontend` | 127 | BLOCKED; `eslint: not found`. |

## Not run / blocked

- Clean `npm ci` for root/backend/frontend on supported Node/npm.
- Complete backend Jest and frontend unit suites.
- Frontend lint/typecheck/format/build against installed dependencies.
- MongoDB replica-set integration (no `mongod`/`mongosh`).
- Redis-dependent integration (no `redis-server`).
- Docker/container startup (Docker is not installed).
- Browser Playwright E2E and accessibility tests.
- Provider sandbox contract tests, live provider callbacks or certification.
- Real two-tenant API isolation suite.
- Performance/load test, backup restore, disaster recovery and monitoring acceptance.

## Required CI follow-up

Run the repository's existing `npm run check`, `npm run test:ci`, `npm run test:e2e`, `npm run build`, provider contract suite and deployment/health checks in the supported, dependency-installed environment. Attach full logs and exit status to the release evidence package. Do not mark any blocked check as passed.
