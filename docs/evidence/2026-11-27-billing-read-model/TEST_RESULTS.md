# TITech billing remediation — test results

Date: 27 November 2026  
Runtime: Node 22.16.0 / npm 10.9.2  
Repository requirement: Node >=24.15.0 / npm >=11.0.0

## Passed

| Command | Result | Evidence |
|---|---|---|
| `npm run check:billing-read` | PASS | Read-only route registration, GET-only surface, tenant binding, RBAC, branding and production-false contract |
| `npm run test:billing-read` | PASS — 10/10 | Six billing read-model service tests + four dashboard source-contract tests |
| `npm run check:rbac` | PASS | Existing RBAC security gate including new read-only billing roles/permissions |
| `npm run validate:syntax` | PASS | 2,628 executable JavaScript/TypeScript-family files parsed |
| `npm run check:commercial-core` | PASS | Existing canonical commercial core static gate |
| `npm run test:commercial:core` | PASS — 37/37 | Existing commercial core unit tests |
| `npm run check:financial` | PASS | 12 canonical financial files checked |
| `npm run check:enterprise-contracts` | PASS | 11 control-plane contracts checked |
| `npm run audit:theme` | PASS | All nine palette values; 83 non-brand frontend CSS files; zero hardcoded official palette occurrences |
| `npm run audit:organization` | PASS | Product, configured organization, ERN/contact/postal profile and production-false contracts |
| `npm run release:gate` | PASS with warnings | Structural release audit; warnings recorded below; not production approval |

## Blocked / not run

| Gate / activity | Result | Reason |
|---|---|---|
| `npm run check:runtime` | BLOCKED | Observed Node 22.16.0/npm 10.9.2 are below declared Node >=24.15.0/npm >=11.0.0 |
| Full backend Jest tests | NOT RUN | Dependencies absent; no package installation from network |
| Full frontend Vitest tests | NOT RUN | Dependencies absent; no package installation from network |
| Vite production build | NOT RUN | Dependencies absent and runtime below supported minimum |
| Live Express application startup | NOT RUN | Dependencies and connected services unavailable |
| MongoDB integration/migrations/indexes/transactions | NOT RUN | No MongoDB service/connection in execution environment |
| Redis/queue/background workers | NOT RUN | No Redis service/connection in execution environment |
| Real browser E2E journeys | NOT RUN | No browser automation environment and live backend available |
| Provider webhooks/settlement/reconciliation | NOT RUN | No provider credentials, callbacks, settlement evidence or live integration |
| Production deploy / restore test | NOT RUN | No production access or deployment authorization |

## Release audit warnings

`npm run release:gate` returned structural PASS but reported:

- Observed runtime 22.16.0 does not match pinned Node 24.15.0.
- Repository-wide legacy/runtime import audit reported 208 missing local imports.

Those warnings are not treated as cleared by the focused billing work. `productionApproved=false` remains unchanged.
