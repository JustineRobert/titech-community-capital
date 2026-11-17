# Validation Results

**Execution timestamp:** `2026-11-17T13:24:28Z`  
**Node:** `v22.16.0`  
**npm:** `10.9.2`  
**Required:** Node `>=24.15.0`, npm `>=11.0.0`  
**Source archive SHA-256:** `536f74fdf60bbf5a6c9425c59e2dd3d16add398d0750875122f117d324cdd831`

## Tests and source gates

| Check | Result | Executed evidence / limitation |
|---|---|---|
| Logger normalizer unit tests | **PASS** | `node --test backend/tests/unit/logging/logArgumentNormalizer.test.mjs` — 5/5. Includes both logger signatures, nested Error causes, redaction of nested credentials, database URL credentials, bearer tokens, serialized config, environment-style `JWT_ACCESS_SECRET`/`ENCRYPTION_KEY` assignments and cycles. |
| Startup failure/readiness/signal source contract | **PASS** | `npm run test:bootstrap:contract` — 4/4. Source-level contract, not live process test. |
| Navigation/group/security contracts | **PASS** | `npm run test:navigation-groups` — 26/26. Includes Products/Services discovery grouping, actual route registry, protected entry redirect, expanded states, Escape/outside-click contract and official token/responsive CSS contract. |
| Bootstrap application-lock regression | **PASS** | `node --test backend/tests/bootstrap/application-lock-regression.test.mjs` — 4/4. Does not prove a full server startup. |
| Root CI test aggregate before backend suite | **PARTIAL PASS / BLOCKED** | `npm run test:ci` completed 17 dependency-free test groups with **236/236 PASS**, then stopped at `test:backend:ci` because `backend/node_modules/jest/bin/jest.js` is absent. Frontend CI group was not reached. |
| Critical-gate schema contract | **PASS** | `node --test scripts/titech-critical-gates.test.mjs` — 4/4. The gate's release status is still BLOCKED. |
| Organization/financial display tests | **PASS** | `npm run test:organization` — 4/4. |
| I18n native tests | **PASS** | `node --test scripts/i18n-core.test.mjs scripts/locale-preferences.test.mjs` — 24/24. Human translation review remains outstanding. |
| Performance contract tests | **PASS** | `node --test tests/performance/performance-contract.test.mjs` — 8/8. These validate safe test workload contracts, not measured production performance. |
| Repository syntax gate | **PASS** | `node scripts/enterprise-gate.mjs --syntax` — 2,564 JS/TS-family source files parsed. Runtime warning remains. |
| Official theme audit | **PASS** | `node scripts/official-theme-audit.mjs` — 77 frontend CSS files; 0 hard-coded official palette occurrences; all nine official colors/light-dark theme contracts retained. |
| Organization profile gate | **PASS** | `node scripts/organization-profile-gate.mjs` — 14 checks including legal identity metadata, provenance and support contacts. |
| Financial static gate | **PASS** | `node scripts/financial-static-gate.mjs` — 12 canonical financial files. This is static evidence, not database-backed ledger replay. |
| RBAC security gate | **PASS** | `node scripts/rbac-security-gate.mjs` — policy/source contract checks; no runtime cross-tenant adversarial testing. |
| i18n validation | **PASS / NOT PRODUCTION ELIGIBLE** | 33 structural checks pass; human review of Swahili, French and Arabic is still pending. Arabic RTL has structural test coverage; human visual approval not established. |
| Runtime import audit | **PASS on canonical financial surface / WARN repository-wide** | 2,084 backend source files scanned; 208 legacy/non-critical unresolved local imports; 0 on the audited canonical financial surface. |
| Release audit (non-strict) | **PASS with WARNINGS** | `npm run release:gate`: Node mismatch and 208 legacy import findings remain warnings. Do not interpret audit-mode PASS as a release approval. |
| Strict release gate | **BLOCKED** | `npm run release:gate:strict`: observed Node `22.16.0` does not satisfy repository Node `24.15.0` pin. |
| Critical-gate status | **BLOCKED** | `npm run titech:critical-gates`: contract PASS; all eight P0/P1 release gates remain open. |
| Enterprise remediation gate | **FAIL** | `npm run enterprise:remediation:gate`: parser/import/lockfile checks mostly pass, but its regex detector flags three existing escaped control-character sanitization regexes in EduFinance, Daily meeting provider, and institutional lead validation. These are intentional sanitization patterns, not raw control characters; not altered merely to satisfy the detector. |

## Aggregate CI command result

`npm run test:ci` completed **17 dependency-free test groups (236/236 pass, 0 fail)**, including the new startup contract, commercial core, faith-giving, navigation/group, USSD, organization, institutional lead, localization, malware scan, UbuntuFloat, inclusive onboarding, education, EduFinance, performance contract and retirement suites. The command then stopped at `test:backend:ci` because the backend Jest package is absent from `backend/node_modules`. The frontend CI group was not reached. This is a partial pass, not a full CI pass.

## Blocked or failed integration/tooling checks

| Check | Result | Actual result |
|---|---|---|
| Node/npm runtime contract | **BLOCKED** | Node `v22.16.0` and npm `10.9.2` are below required versions. Only Node 22 was installed in the execution environment. |
| Root `npm run check` | **BLOCKED** | Stops at `check:runtime` before subsequent checks because of runtime mismatch. |
| Backend lint | **BLOCKED** | `npm --prefix backend run lint`: `eslint: not found`; dependencies are absent. |
| Frontend lint | **BLOCKED** | `npm --prefix frontend run lint`: `eslint: not found`; dependencies are absent. |
| Backend full tests | **BLOCKED** | Jest not installed (`backend/node_modules/jest/bin/jest.js` missing). |
| Frontend full tests | **BLOCKED** | Vitest not installed. |
| Frontend build | **BLOCKED** | Vite not installed. |
| Browser E2E | **BLOCKED** | Root E2E command points to a frontend `test:e2e` script that is not defined; no browser installation/runtime was available. No screenshots were captured. |
| npm dependency audit | **BLOCKED** | Registry request failed with DNS `EAI_AGAIN registry.npmjs.org`; no fresh advisory scan result. |
| Dependency clean install | **NOT RUN** | The runner fails the declared runtime gate; no `node_modules` present. Installation was not attempted under unsupported Node/npm. |
| Live backend startup / HTTP health | **NOT RUN** | Runtime version and backend dependencies unavailable; MongoDB/Redis services not connected. |
| MongoDB/Redis failure/recovery | **NOT RUN** | No isolated live services or transaction-capable test replica set. |
| Browser visual tests / screenshots | **NOT RUN** | Browser runtime and frontend dependencies absent. |
| Provider sandbox / real settlement | **NOT RUN** | No authorized MTN/Airtel provider sandbox credentials or settlement evidence. No real payment was initiated. |
| Independent security testing / backup restore | **NOT RUN** | Requires external/isolated assessment and recovery infrastructure. |

## Gate decision

The test results above prove selected dependency-free source contracts and static controls only. They do not prove a complete application build, runtime, transaction, provider, tenant attack or operational release. Overall status remains **NOT READY** and `productionApproved=false`.
