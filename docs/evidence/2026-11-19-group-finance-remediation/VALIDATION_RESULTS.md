# Validation Results — 19 November 2026

## Environment

```text
Node.js: v22.16.0
npm: 10.9.2
Repository baseline requires: Node >=24.15.0 and npm >=11.0.0
Root/backend/frontend node_modules: not installed in the supplied snapshot
MongoDB: no reachable isolated test database provided
Redis: no reachable isolated test service provided
Frontend production bundle: frontend/dist absent
Git metadata: .git absent from uploaded ZIP
```

The supported-runtime check therefore reports BLOCKED. Dependency installation and runtime tests were not attempted under an incompatible engine-strict runtime.

## Executed test commands

| Command | Total | Passed | Failed | Skipped | Exit |
|---|---:|---:|---:|---:|---:|
| `node --test backend/tests/unit/groups/*.test.mjs` | 22 | 22 | 0 | 0 | 0 |
| `node --test backend/tests/unit/education/*.test.mjs` | 15 | 15 | 0 | 0 | 0 |
| `node --test backend/tests/unit/retirement/*.test.mjs` | 16 | 16 | 0 | 0 | 0 |
| `node --test backend/tests/unit/agriculture/agriculture.domain.test.js` | 9 | 9 | 0 | 0 | 0 |
| `node --test scripts/tests/group-details-style-contract.test.mjs scripts/tests/group-list-style-contract.test.mjs scripts/tests/group-management-ui-contract.test.mjs scripts/tests/navbar-discovery-contract.test.mjs scripts/tests/navigation-registry-contract.test.mjs scripts/tests/navigation-routes-contract.test.mjs scripts/tests/public-brand-discovery.test.mjs` | 26 | 26 | 0 | 0 | 0 |
| `node --test scripts/tests/faith-giving-donations-contract.test.mjs` | 4 | 4 | 0 | 0 | 0 |
| `node --test scripts/tests/error-boundary-privacy-contract.test.mjs` | 1 | 1 | 0 | 0 | 0 |
| `node --test backend/modules/faith-community-giving/faithGiving.policy.test.js` | 18 | 18 | 0 | 0 | 0 |
| **Total** | **111** | **111** | **0** | **0** | **0** |

These are native Node unit, policy and static contract tests. The 111 count does not include a live API test, database integration test, browser test or full Jest suite.

## Executed gates

| Command | Result / evidence |
|---|---|
| `node scripts/official-theme-audit.mjs` | PASS. All nine palette values match. All 77 non-brand frontend CSS files use central brand tokens; no hardcoded official palette hexes found there. Both light and dark theme contracts and app entrypoint wiring pass. |
| `node scripts/organization-profile-gate.mjs` | PASS. Product/entity identity, owner-supplied ERN/address/contact metadata and `productionApproved=false` pass. The gate does not independently certify legal records. |
| `node scripts/financial-static-gate.mjs` | PASS. 12 canonical financial files checked. This is static analysis, not live accounting proof. |
| `node scripts/rbac-security-gate.mjs` | PASS. Static RBAC gate. |
| `node scripts/frontend-runtime-audit.mjs` | PASS_WITH_WARNINGS. 11 checks pass; 1 warning because `frontend/dist` is absent. |
| `node scripts/enterprise-gate.mjs --syntax` | PASS. 2,577 executable JS/TS-family files parsed. Warning records local Node 22.16.0 below target. |
| `node --check` on all changed backend `.js`/`.mjs` and integration test sources | PASS. |
| JSON parse for `package.json` and `backend/package.json` | PASS. |
| `node scripts/titech-supported-runtime-gate.mjs` | BLOCKED / exit 1. Node 22.16.0 below `>=24.15.0`; npm 10.9.2 below `>=11.0.0`. |

## Not executed

| Verification | State | Reason |
|---|---|---|
| Full backend Jest suite | BLOCKED | Dependencies absent and Node/npm engine requirements unmet. |
| Group invitation/wallet integration suite | BLOCKED | Added integration assertions are syntax-checked, but Jest, Express test dependencies and isolated MongoDB are unavailable. |
| Frontend Vite build | BLOCKED | Frontend dependencies are not installed and supported runtime unavailable. |
| Full backend lint/format checks | BLOCKED | Installed lint/format dependencies absent. |
| Frontend lint/type check | BLOCKED | Installed frontend toolchain absent. |
| Browser E2E / desktop-tablet-mobile screenshots | BLOCKED | Browser test dependencies/runtime unavailable. |
| MongoDB/Redis application boot and readiness replay | BLOCKED | No reachable test service or live app instance supplied. |
| Original endpoint response-body replay | BLOCKED | The uploaded material supplied historical access logs, not response body captures or a connected application. |
| MTN sandbox/production collection/callback/settlement | BLOCKED | No verified credentials, provider sandbox session, institutional approval or certification supplied. |
| Deployment verification | BLOCKED | No hosting/deployment environment access supplied. |

## Reproduction commands after runtime/dependencies are available

Use the repository's declared engine baseline first. Then run the canonical clean-install workflow (do not install under an incompatible Node/npm version):

```bash
node --version       # must be >=24.15.0
npm --version        # must be >=11.0.0
npm run install:all
npm run test:groups:policies
npm run test:backend:ci
npm run test:frontend:ci
npm run check
npm run build
npm run enterprise:gate
```

After isolated MongoDB replica-set and Redis test services are available, run:

```bash
npm run test:integration
npm run test:e2e
npm run health
```

Replay sanitized requests using the test environment and test identities only. Do not target production or initiate real payment collection during automated tests.
