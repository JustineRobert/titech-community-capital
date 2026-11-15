# Test Evidence — 15 November 2026

## Execution environment

| Item | Observed value | Requirement / note |
|---|---|---|
| Node | `v22.16.0` | Repository `.nvmrc` / engines require `24.15.0` or later |
| npm | `10.9.2` | Root package requires `11.0.0` or later |
| Dependencies | No root/backend/frontend `node_modules` in supplied archive workspace | Package-dependent tests and build could not be executed |
| MongoDB | No available test Mongo service/replica set verified | DB integration not executed |
| Redis | No available Redis service verified | Cache/session/queue dependency tests not executed |
| Browser automation | No runnable browser stack/installed frontend runtime verified | Browser E2E and screenshots not executed |
| Git metadata | No `.git` directory in supplied ZIP | No Git diff/branch/remote/commit evidence |

## Tests actually run

| Command | Result | Evidence interpretation |
|---|---|---|
| `node --test scripts/tests/sacco-vsla-onboarding-contract.test.mjs` | PASS — 6 tests, 0 failures | Dependency-free source contract checks only |
| `node scripts/official-theme-audit.mjs` | PASS | Theme contract/static CSS audit: 73 CSS files, 0 hard-coded official palette occurrences in non-brand CSS |
| `node scripts/commercial-billing-core-gate.mjs` | PASS — 23 checks | Existing commercial-core source gate; not a group contribution E2E test |
| `node --check backend/controllers/groupWalletController.js` | PASS | Server JavaScript syntax check for modified controller |
| `node --check backend/controllers/groupController.js` | PASS | Server JavaScript syntax check for modified controller |
| `node --check backend/tests/integration/groups.journey.test.js` | PASS | Syntax only; this does not mean the integration test ran |
| `node --check scripts/platform-truth.mjs` | PASS | Script syntax check |
| `node --check scripts/tests/sacco-vsla-onboarding-contract.test.mjs` | PASS | Test-file syntax check |
| `npm run check:runtime` | BLOCKED — exit 1 | Observed Node 22.16.0/npm 10.9.2; repository requires Node >=24.15.0/npm >=11.0.0 |
| `npm --prefix frontend run build` | FAILED — exit 127 | Vite is not installed (`vite: not found`); no frontend bundle was produced |

## Test added but not executed

`backend/tests/integration/groups.journey.test.js` was extended to verify:

- the active API persists a `vsla` group classification and the default `lending:false` capability;
- a pending member cannot read group financial data;
- after approved membership, a group financial read passes authorization but returns controlled 503 because there is no canonical group account mapping;
- rejected members cannot read financial information;
- cross-tenant group reads return not found.

The test requires the real backend test dependencies and MongoDB test replica-set configuration. Those were not available here; it is not marked integration-tested.

## Not executed / not proven

- Full root/backend/frontend install (`npm ci`); dependency audit.
- Frontend JSX compilation/bundle (the Vite build command was attempted and failed because Vite is not installed), frontend unit/CI suite.
- Backend bootstrap, readiness or actual HTTP API run.
- Full backend Jest suite and MongoDB transaction tests.
- Redis failure/restart/queue tests.
- Browser E2E, responsive screenshot comparison, visual regression, accessibility audit.
- Tenant A/B adversarial isolation against a running DB.
- Concurrent group create/join idempotency tests and lost-response recovery.
- Institution document workflow integration, tenant provisioning or pilot persistence.
- Contribution intents, MTN/Airtel sandbox, callbacks, settlement, ledger, statements, receipt or reconciliation journey.
- Restore drill, incident drill, SLO/alert verification, penetration/security assessment.

## Reproduction commands for a supported environment

Run from repository root with Node 24.15.x, npm 11+, an isolated replica-set test MongoDB configured as the backend test config expects, and Redis if the selected suite requires it:

```bash
node --test scripts/tests/sacco-vsla-onboarding-contract.test.mjs
node scripts/official-theme-audit.mjs
node scripts/commercial-billing-core-gate.mjs
npm ci
npm --prefix backend ci
npm --prefix frontend ci
npm run test:navigation-groups
npm run test:backend
npm run test:frontend:ci
npm --prefix frontend run build
npm run test:e2e
```

The exact npm scripts in the manifests should be checked before running any potentially destructive or environment-sensitive script. Use only disposable test tenants/databases and sandbox provider credentials. Do not use production money flows.

## Evidence conclusion

Six new source-contract tests, two existing source-level gates and five JavaScript syntax checks passed. The integration test additions and all runtime/E2E/financial/security claims remain unverified. The runtime gate is **BLOCKED**, and the frontend build attempt is **FAILED before compilation** because Vite is missing. The status is **source checks PASS; application runtime NOT VERIFIED**.
