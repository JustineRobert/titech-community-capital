# Test Execution Report

**Execution date:** 19 November 2026  
**Environment:** Node v22.16.0 / npm 10.9.2; repository requires Node >=24.15.0 / npm >=11.0.0.  
**Dependencies:** root/backend/frontend `node_modules` absent.

## Executed automated tests

| Command | Result | Notes |
|---|---:|---|
| `npm run test:navigation-groups` | **PASS 29/29** | Includes the new Group List action-spacing contract and existing Group creation, membership, Group Details, navigation and error-privacy contracts. |
| `npm run test:education-campaigns` | **PASS 15/15** | Includes the new feature-flag middleware contract, public DTO/policy, tenant/authenticated route, translations and transaction-boundary source contracts. |
| Focused combined `node --test` command (Group List, Group creation, Group Details, membership and Education tests) | **PASS 33/33** | A targeted overlapping set; do not add this count to the two package-script counts as unique tests. |

The Group List suite adds three regression assertions for: (1) distinct action groups and CSS gaps, (2) mobile wrapping/stacking and keyboard focus, and (3) official semantic tokens without local palette literals. The Education suite adds three checks for: (1) default-off semantics, (2) explicit HTTP 503 with no handler invocation while disabled, and (3) delegation to the canonical route chain only when enabled.

## Repository gates executed

| Command | Result | Evidence boundary |
|---|---|---|
| `node scripts/official-theme-audit.mjs` | **PASS** | 77 non-brand CSS files scanned; zero hard-coded official palette occurrences; nine palette colours and light/dark entrypoints verified. |
| `node scripts/organization-profile-gate.mjs` | **PASS** | Product/legal identity, owner-supplied contact fields and organization wiring source checks; does not authenticate legal status externally. |
| `node scripts/financial-static-gate.mjs` | **PASS** | 12 canonical financial files statically checked; not a live transaction/ledger test. |
| `node scripts/rbac-security-gate.mjs` | **PASS** | Existing RBAC source/static gate; not a live two-tenant HTTP security test. |
| `node scripts/enterprise-gate.mjs --syntax` | **PASS** | 2,570 executable JS/TS-family files parsed under Node 22; gate emitted a runtime-version warning. |
| `node scripts/titech-supported-runtime-gate.mjs` | **BLOCKED (expected)** | Observed Node 22.16.0/npm 10.9.2; required Node >=24.15.0/npm >=11.0.0. |
| `npm run build:frontend` | **BLOCKED** | Vite is not installed (`vite: not found`, exit 127). |
| `npm run build:backend` | **PASS — script only** | Script returned success but only prints a no-compilation validation message; it is not a backend compile or runtime proof. |
| `npm run lint` | **BLOCKED** | ESLint is not installed (`eslint: not found`, exit 127). |
| `npm run test:backend` | **BLOCKED** | Backend Jest dependency is absent (`backend/node_modules/jest/bin/jest.js` not found). |

## Not executed / blocked

- Frontend lint/format commands and backend formatter checks.
- Dependency-backed frontend Vite build; backend build script is not a compilation step.
- Full Jest and Vitest suites; dependencies are not installed.
- Live API smoke requests and real HTTP response capture.
- MongoDB replica-set transaction, rollback, concurrency and persistence tests; no database service is supplied.
- Redis runtime, session and rate-limit tests; no Redis service is supplied.
- Browser-driven Playwright E2E, mobile viewport rendering, accessibility scans and screenshots; browser automation dependencies/browser service are absent.
- External email/SMS dispatch, MTN/Airtel sandbox, callback, settlement, ledger posting, reconciliation and receipt evidence.

No blocked item is represented as a pass. The source archive contains no `.git` metadata; no GitHub diff, commit, push, deployment or live production verification is claimed.
