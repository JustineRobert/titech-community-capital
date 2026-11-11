# TITech Community Capital — Test and E2E Evidence Report

**Organization:** TITech Capital SMC LTD  
**Product:** TITech Community Capital  
**Review date:** 11 November 2026

## Summary

- **159 native contract/domain tests passed** across the listed suites after remediation.
- Syntax parsing passed for **2,531 executable JS/TS-family files**.
- Static checks passed for the official theme, organization metadata, RBAC contract and canonical financial surface.
- The route registry now tests every navigation destination, including Faith & Community Giving and its management route.
- **No real browser E2E, build, backend runtime, MongoDB, Redis, provider sandbox, or two-account database workflow was executed.**

The native tests include source-contract tests and domain/unit tests. They are not equivalent to browser end-to-end or production integration tests.

## Executed commands and results

| Command | Tests/checks | Result |
|---|---:|---|
| `npm run test:critical-gates` | 4 | PASS |
| `npm run test:faith-giving` | 16 | PASS |
| `npm run test:ussd` | 10 | PASS |
| `npm run test:ubuntu-float` | 13 | PASS |
| `npm run test:inclusive-onboarding` | 27 | PASS |
| `npm run test:education-campaigns` | 12 | PASS |
| `npm run test:edufinance` | 16 | PASS |
| `npm run test:retirement-support` | 16 | PASS |
| `npm run test:performance-contract` | 8 | PASS |
| `npm run test:navigation-groups` | 15 | PASS after route contract and privacy guard |
| `npm run test:document-malware-scan` | 4 | PASS |
| `npm run test:organization` | 4 | PASS |
| `npm run test:institutional-leads` | 9 | PASS |
| `npm run test:financial:product-rules` | 5 | PASS |
| `npm run validate:syntax` | 2,531 source files | PASS with runtime warning |
| `npm run audit:theme` | 21 theme checks | PASS |
| `npm run audit:organization` | 12 checks | PASS |
| `npm run rbac:gate` | Static gate | PASS |
| `npm run check:financial` | 12 canonical files | PASS |
| `npm run audit:frontend-runtime` | 11 PASS, 1 WARN | PASS WITH WARNINGS |
| `npm run check:runtime-imports` | 2,070 backend files | PASS WITH WARNINGS; 208 non-critical unresolved imports |
| `npm run check:runtime` | Supported runtime | BLOCKED: Node 22.16.0/npm 10.9.2 |

The 159 native tests are counted as 4 + 16 + 10 + 13 + 27 + 12 + 16 + 16 + 8 + 15 + 4 + 4 + 9 + 5. The error-boundary privacy contract is now included in `test:navigation-groups`; do not add it again.

## Route/module checks

- 38 dynamic import statements in the active route tree were statically inspected.
- 38/38 direct targets exist; no missing direct route import target was found.
- Static default/named export shape checks passed for the route targets.
- No Vite production build was possible, so this is not a proof that every transitive import bundles.

## Important tests not executed

| Test | Status | Why |
|---|---|---|
| Frontend `npm ci` / Vite production build | BLOCKED | Supported Node/npm not installed; no dependency cache/network |
| Backend `npm ci` / startup | BLOCKED | Same runtime/dependency constraint |
| `npm run lint`, frontend/backend formatter | NOT RUN | Local dependency tree absent |
| `npm audit` / lockfile advisory review | NOT RUN | Requires dependency/network environment |
| Auth login/logout/refresh E2E | NOT RUN | API runtime, DB, Redis and test identity unavailable |
| Direct navigation/refresh/back/forward in browser | NOT RUN | No built application/runtime |
| Group creation + second-user join + approval persistence | NOT RUN | Requires MongoDB and two test accounts/tenants |
| Cross-tenant read/write/export negative E2E | NOT RUN | Requires isolated test DB and authorised test accounts |
| Payment/provider callback/settlement/ledger replay integration | NOT RUN | Requires MongoDB replica set, Redis and provider sandbox evidence |
| Browser console/network capture for historical error ID | NOT RUN | No historical logs or running app |
| Responsive and accessibility browser tests | NOT RUN | No running app/test build |

## Acceptance criteria status

| ID | Criterion | Status | Evidence/limitation |
|---|---|---|---|
| AC01 | Application home loads | NOT RUN | Public route/import statically present; browser not run |
| AC02 | Dashboard loads | NOT RUN | Route/import present; API/browser not run |
| AC03 | Groups load | NOT RUN | Contract tests pass; live API/browser not run |
| AC04 | Group creation persists | NOT RUN | UI/route contracts pass; DB persistence not run |
| AC05 | Group joining works across two accounts | NOT RUN | No DB/two accounts |
| AC06 | Meetings load | NOT RUN | Route present; API/browser not run |
| AC07 | Inclusive onboarding loads | NOT RUN | Domain tests pass; browser/API not run |
| AC08 | Retirement support loads | NOT RUN | Domain tests pass; browser/API not run |
| AC09 | Agriculture loads | NOT RUN | Route present; API/browser not run |
| AC10 | UbuntuFloat loads and capabilities contract works | PARTIAL | 13 domain/source tests pass; live API/browser not run |
| AC11 | Partner Support loads | NOT RUN | Route present; API/browser not run |
| AC12 | Faith Community Giving loads | NOT RUN | Policy tests and route static tests pass; browser not run |
| AC13 | Giving management is protected | PARTIAL | Role gate/source tests pass; browser negative tests not run |
| AC14 | No broken route imports remain | PARTIAL | 38 direct lazy target paths resolve; 208 backend legacy missing imports remain and transitive build not run |
| AC15 | Authentication works | NOT RUN | Auth provider present; no session E2E |
| AC16 | Tenant isolation works | PARTIAL | Multiple domain contract tests; no comprehensive cross-tenant runtime suite |
| AC17 | Error boundaries work | PARTIAL | Route boundary is now mounted; injected browser failure not run |
| AC18 | Error correlation works | PARTIAL | Source emits route IDs; telemetry/log correlation not operationally verified |
| AC19 | Frontend production build passes | BLOCKED | Dependencies/runtime unavailable |
| AC20 | Backend startup/readiness passes | BLOCKED | Runtime and required services unavailable |
| AC21 | Database persistence passes | BLOCKED | MongoDB unavailable |
| AC22 | Redis behaviour verified | BLOCKED | Redis unavailable |
| AC23 | Financial invariants remain intact | PARTIAL | Static financial gate and domain tests pass; Mongo replay/ledger integration not run |
| AC24 | No critical security regression | PARTIAL | RBAC/domain tests pass; security scans/independent review not run |
| AC25 | Deep-link refresh works | NOT RUN | Browser unavailable |
| AC26 | Desktop/mobile navigation works | NOT RUN | Browser unavailable |
| AC27 | No new unresolved P0/P1 defects | BLOCKED | Eight release blockers remain open |
| AC28 | Operational recovery documented | PASS | Runbooks added; live recovery drill pending |
| AC29 | Changes are reproducible | PARTIAL | Exact file inventory/test commands documented; Git diff unavailable because source archive has no `.git` |
| AC30 | Production approval is evidence-based | BLOCKED | External/security/operational gates pending; production flag remains false |

## Reproduction prerequisites

Use Node `>=24.15.0` and npm `>=11.0.0`, the original lockfiles, an isolated MongoDB replica-set test deployment, Redis, controlled test tenants/accounts, and approved provider sandbox credentials where needed. Follow the commands in `FRONTEND_APPLICATION_RECOVERY.md` and `BACKEND_API_RECOVERY.md`. Do not use real customer funds or production KYC data for these tests.
