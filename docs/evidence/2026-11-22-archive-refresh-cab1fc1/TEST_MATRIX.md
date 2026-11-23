# Test matrix — commands actually executed on 22 November 2026

All outcomes below apply to this ZIP extraction and the observed Node `v22.16.0` / npm `10.9.2` environment. Selected Node-native tests are source/unit/contract tests; none are promoted to infrastructure-backed E2E.

| Level | Command / test | Result | Interpretation |
|---|---|---|---|
| L1 syntax | `node scripts/enterprise-gate.mjs --syntax` | PASS — 2,589 JS/TS-family files parsed | Node 22 warning remains; not supported-runtime proof |
| L1 theme | `node scripts/official-theme-audit.mjs` | PASS — 78 non-brand CSS files; 0 hard-coded official colours | Static theme contract |
| L1 org | `node scripts/organization-profile-gate.mjs` | PASS — 14 checks | Source metadata consistency only |
| L1 finance | `node scripts/financial-static-gate.mjs` | PASS — 12 canonical files | Static financial surface |
| L1 RBAC | `node scripts/rbac-security-gate.mjs` | PASS | Static permission contract, not live attack testing |
| L1 commercial | `node scripts/commercial-billing-core-gate.mjs` | PASS — required files/contracts checked | Pricing/assessment foundation only |
| L1 performance | `node scripts/performance-contract-gate.mjs` | PASS | Read-only performance contract only; no load run |
| L1 conflict scan | `node scripts/check-conflicts.js` | PASS — 4,015 files scanned | No merge conflict markers |
| L1 runtime imports | `node scripts/runtime-import-audit.mjs` | PASS for canonical financial surface; 208 missing import candidates elsewhere | 2,097 backend files scanned; canonical critical scope has 0 missing imports and 0 mixed-module violations |
| L2 commercial unit | `npm run test:commercial:core` | PASS — 37/37 | Exact money, pricing, maker-checker, idempotency and adapter-contract tests |
| L2 inclusive unit/policy | `node --test backend/tests/unit/inclusive-onboarding/*.test.mjs` | PASS — 27/27 | Partner/consent/insurer policy tests; not external partner approval |
| L2 Chat source/unit | `node --test backend/tests/chat/chatService.test.js backend/tests/chat/chatRoutes.test.js backend/tests/chat/chatSocket.test.js` | PASS — 3 top-level test files | Not live socket or DB integration |
| L2 Chat readiness contract | `node --test scripts/chat-production-gate.test.mjs` | PASS — 2/2 | Confirms gate behavior; actual Chat readiness remains BLOCKED |
| L2 group/giving/dashboard | `node --test backend/tests/unit/groups/group-wallet-policy.test.mjs backend/tests/unit/groups/group-invitation-policy.test.mjs backend/tests/unit/groups/group-contribution-capability.test.mjs backend/modules/faith-community-giving/faithGiving.policy.test.js backend/modules/faith-community-giving/faithGiving.public.routes.test.js scripts/tests/faith-giving-donations-contract.test.mjs scripts/tests/core-dashboard-brand-contract.test.mjs` | PASS — 47/47 | Group wallet/invitation/contribution, Faith Giving, donations and brand contract tests |
| L2 organization/metrics | `node --test scripts/organization-profile-gate.test.mjs scripts/financial-metric-display.test.mjs` | PASS — 4/4 | Organization and real-zero/unavailable display contract |
| L2 Mongoose version key | `node --test backend/tests/unit/platform/mongoose-version-key-contract.test.mjs` | PASS — 2/2 | Schema version-key contract |
| L4 MongoDB | Replica-set, model/index, transactional rollback, persistence | NOT RUN | MongoDB unavailable |
| L5 Redis | Adapter, distributed events, queue restart/retry | NOT RUN | Redis unavailable |
| L6 API E2E | Authenticated billing/Chat/partner API workflows | NOT RUN | No running app/dependencies/services |
| L7 financial E2E | Collections, canonical ledger, replay, reversals, reconciliation | NOT RUN | No MongoDB replica set/provider/ledger E2E |
| L8 Chat E2E | Multi-user, multi-tenant Socket.IO delivery | BLOCKED | Eight Chat readiness items blocked |
| L9 browser E2E | `npm run test:e2e` | BLOCKED — frontend package has no `test:e2e` script | No Playwright run; Vite/Vitest dependencies absent |
| L10 security | RBAC static gate PASS | PARTIAL | No runtime BOLA/IDOR/session/tenant attack suite executed |
| L11 resilience | Mongo/Redis/provider outage and recovery | NOT RUN | Infrastructure unavailable |
| L12 performance | Performance contract gate PASS | NOT RUN | No bounded load/latency/throughput run |
| L13 backup/restore | Database restore and RTO/RPO | NOT RUN | No backup target or database |
| L14 operational | Health/readiness, alerting, graceful shutdown | NOT RUN | Application not started |

## Commands that failed or were blocked

| Command | Exit | Exact cause |
|---|---:|---|
| `npm run check:runtime` | 1 | Node 22.16.0/npm 10.9.2 below required Node >=24.15.0/npm >=11 |
| `npm run check` | 1 | Stops at the supported-runtime gate before remaining chain |
| `npm run build:frontend` | 127 | `vite: not found` (frontend dependencies absent) |
| `npm run test:backend` | 1 | `backend/node_modules/jest/bin/jest.js` absent |
| `npm run test:frontend` | 127 | `vitest: not found` |
| `npm run test:e2e` | 1 | Root script invokes a missing frontend `test:e2e` script |
| `npm run release:gate:strict` | 1 | Observed Node runtime below pin; 208 import candidates are reported as warning debt |
| `npm run production:approval-gate` | 1 | Protected approval variables/reference/expiry are absent, as intended |
| `npm run i18n:production-gate` | 1 | No qualified reviewer profiles/approvals, Arabic RTL acceptance or cross-locale browser E2E |
| `npm run chat:production-gate` | 1 | All eight Chat integration/E2E checks blocked |

The captured console logs and exit codes are in `logs/`. No skipped test is represented as passing. The 122 selected test cases/assertions are not the repository's full CI suite.
