# TITech Community Capital — archive-local engineering execution report

**Execution date:** 23 November 2026  
**Product:** TITech Community Capital  
**Registered organization:** TITECH CAPITAL - SMC LTD.  
**ERN:** 80049233029029 (owner-supplied document; authenticity/current registry status not independently verified)  
**Official tagline:** Community Finance. Stronger Together.  
**Financial operating principle:** FINANCIAL CORRECTNESS BEFORE CONVENIENCE.  
**Production approval:** `productionApproved=false`

## 1. Executive summary

A first BankConnect local statement-evidence slice was added to the uploaded repository archive. It is integrated into the existing application route/navigation, RBAC, tenant middleware, MongoDB/Mongoose models, and audit service. It supports account metadata registration, institution-scoped consent requests and maker-checker approval/revocation, secure local statement parsing, encrypted source evidence, transaction normalization, idempotency and potential-duplicate triage. The user-facing BankConnect screen reuses the existing TITech theme-token layer.

The Dashboard group-card member-count presentation was improved to use canonical active/reinstated membership data when explicit counts are absent; missing values remain unavailable rather than being shown as zero. The official theme audit initially identified three colour literals in the new BankConnect stylesheet; those were removed and the theme audit now passes with zero hard-coded official palette hex occurrences across 81 CSS files.

The repository's existing admin stats/activity endpoints and safe DTO formatting, Faith-Giving feature gate, group-wallet authorization/missing-ledger-account boundary, organization identity and shared `ProfileAvatar` implementation were inspected. The archive does not supply a running environment or runtime logs, so the originally reported 503/404/403/401 conditions were not reproduced live. No unsafe bypass or fake response was introduced.

**This is not an enterprise-complete BankConnect integration or a production-ready platform release.** The new BankConnect path stages external bank evidence only. It is not connected to the canonical StatementProcessingService, reconciliation matcher, FinancialTransaction or double-entry ledger. Bank APIs and payment execution remain disabled. Database transactions, runtime API behavior and browser E2E were not tested in this container.

## 2. Repository baseline

| Item | Observed result |
|---|---|
| Input | `/mnt/data/titech-community-capital-main.zip` |
| Archive SHA-256 | `c028dfc6d2044c3c097778368aacf2ca6f741974fde56dfeabd62718c25ef779` |
| ZIP integrity | `unzip -t` passed; no archive errors |
| Working directory | `titech-work/titech-community-capital-main` |
| Git metadata | No `.git` directory; branch, commit, local change history and upstream status cannot be established |
| Node | `v22.16.0` |
| npm | `10.9.2` |
| Declared engine | Node `>=24.15.0`, npm `>=11.0.0` |
| Dependencies | No root/backend/frontend `node_modules` available |
| MongoDB/Redis/Docker | `mongod`, `redis-server` and `docker` executables not available |
| Browser automation | No live browser run performed |

The previously supplied Jest failure counts (151 suites / 127 failed / 484 tests failed) are not assumed to represent this uploaded archive's current run. The actual full Jest run could not start because Jest dependencies are absent.

## 3. Implementation summary

### BankConnect foundation

- Added five bank institution metadata profiles for Centenary Bank, Stanbic Bank Uganda, dfcu Bank, Absa Bank Uganda and Equity Bank Uganda.
- All profiles explicitly remain `DESIGNED`, `NOT_CONNECTED`, sandbox `NOT_VERIFIED`, partnership `NOT_APPROVED`, production credentials `NOT_APPROVED`, `productionApproved=false`.
- Added `BankAccount`, `BankConsent`, `BankStatementImport` and `BankTransaction` tenant-scoped Mongoose models and compound unique indexes.
- Added route mounting at `/api/v1/bankconnect` through the existing authentication and tenant-authorization middleware.
- Added explicit BankConnect RBAC permissions and BankConnect navigation/React Router registration.
- Added account reference/masked account registration, consent requests, separate-actor approval and revocation. Account/consent/audit writes use MongoDB transactions.
- Added CSV, XLSX, MT940 and constrained CAMT.052/.053/.054 parser paths. Legacy XLS is intentionally rejected.
- Added integer minor-unit conversion, strict amount precision and currency handling, CSV formula checks, XML DTD/entity rejection, XLSX ZIP safety limits, and source-format checks.
- Added fail-closed ClamAV scanning and AES-256-GCM encrypted source statement persistence.
- Added tenant-scoped statement/transaction/evidence listing, duplicate import prevention, stable bank transaction ID idempotency and potential duplicate flags for review.
- Added an initial BankConnect page showing institution/account/consent/import/transaction/reconciliation-evidence/integration-health states.
- The import response explicitly states `NOT_PERFORMED_STATEMENT_EVIDENCE_ONLY` and never posts to the ledger.

### Dashboard and existing platform checks

- Added unit-tested group presentation helpers for membership count, type/category label and date-like next-contribution fields.
- Updated the active `Dashboard.jsx` group card to use those helpers.
- Corrected the new BankConnect CSS to consume the existing semantic TITech theme variables.
- Preserved current organization identity, tagline, nine-colour palette, circular seal asset, light/dark themes and shared avatar component.
- Existing admin stats/activity implementation, Faith-Giving feature flag, group-wallet access policy and refresh-token protections were inspected, not replaced. Actual runtime symptoms remain unverified without the application and its dependencies running.

## 4. Focused tests and validation

### Tests executed successfully

| Command | Result |
|---|---:|
| `npm run test:bankconnect` | 9 passed, 0 failed |
| `npm run test:group-presentation` | 7 passed, 0 failed |
| `npm run test:organization` | 4 passed, 0 failed |
| `npm run test:profile-avatar` | 6 passed, 0 failed |
| `npm run test:admin-dashboard-contract` | 9 passed, 0 failed |
| **Total focused Node tests** | **35 passed, 0 failed, 0 skipped** |

The BankConnect parser tests cover UGX integer minor units, explicit currency fallback, CSV malformed dates/quoting/formula injection, debit/credit validity, MT940 currency declarations, CAMT currency/DTD/entity protections, XLS rejection and upload size, authenticated encryption/tamper detection, and the non-approved bank registry.

The root `npm run test:ci` preflight executed **308 Node-native tests across 26 test groups: 308 passed, 0 failed, 0 skipped**. It then stopped at the backend Jest phase because the local Jest executable was not installed. This is a successful native preflight, not a successful full CI run. The final `npm run test:navigation-groups` contract suite passed **29/29** after adding BankConnect to its existing route/service discovery assertions.

Group presentation tests cover explicit canonical counts, active/reinstated member roles, unavailable membership data, type/category mapping and schedule date handling.

### Static and contract checks

| Command | Result |
|---|---|
| `npm run audit:theme` | PASS — 81 CSS files scanned; 0 hard-coded official palette hex occurrences |
| `npm run audit:organization` | PASS |
| `npm run check:rbac` | PASS |
| `npm run audit:test-discovery` | Exit 0 — 198 test files, 26 empty files recorded, 0 duplicate-name groups, 0 mixed CJS/ESM test files |
| `node --check` on new/modified backend `.mjs`/`.js` modules | PASS for BankConnect registry, parser, evidence crypto, route, model, RBAC policy and API route registry |
| `npm run build:backend` | Exit 0 — repository's backend script is a Node message only; it is not a full bundling or runtime test |

### Failed or blocked validation

| Command | Actual result | Reason |
|---|---|---|
| `npm run audit:modules` | Exit 2 | Existing repository scan: 2,102 files; 207 unresolved relative `require()` references; 351 CJS-to-ESM relative boundaries; 45 mixed-module files |
| `npm run build:frontend` | Exit 127 | `vite: not found`; frontend dependencies are not installed |
| `npm run build` | Exit 127 | Delegates to frontend build; `vite` unavailable |
| `npm run test:backend:ci` | Exit 1 | Required `backend/node_modules/jest/bin/jest.js` is absent |
| `npm run test:frontend:ci` | Exit 127 | `vitest` is not installed |
| `npm run test:integration` | Exit 1 | Backend Jest executable is absent |
| `npm run check:runtime` | Exit 1 / BLOCKED | Node 22.16.0 and npm 10.9.2 are below declared minimums |
| `npm run test:e2e` | Exit 1 | Frontend package has no `test:e2e` script |

No tests were reported as passed unless they actually executed. No runtime API tests, MongoDB/Redis integration, Playwright/browser E2E, screenshot, security penetration test, load test, external bank connection or deployment test was performed.

## 5. Reported symptoms — source-level findings, not live reproduction

| Reported item | Source inspection finding | Execution status |
|---|---|---|
| Faith-Giving `GET /api/v1/faith-giving` 503 | Route is deliberately guarded by `TITECH_FAITH_GIVING_ENABLED`; example configuration sets it to `false`. No bypass or fabricated empty response was made. | Not reproduced in a running API; check deployment flag and dependency logs. |
| Admin activity `/api/admin/activity` 404 | Active platform dashboard route and audit-backed activity handler already exist in the archive and are protected for platform administrators. | Source contract tests pass; no live HTTP test. Check actual mount/proxy URL in deployment. |
| Admin stats return 200 but show unavailable | Active backend and frontend contract normalizers exist. Some stats intentionally remain unavailable until canonical approval/savings aggregation exists; the contract test checks these are not fabricated as zero. | Contract tests pass; no runtime payload compared. |
| Activity `[object Object]` | Existing UI helper humanizes activity/action values and activity DTOs are normalized. | Admin dashboard contract test passes; no browser visual verification. |
| Group card details | Active Dashboard group card now uses canonical helper to derive membership count from active/reinstated memberRoles when explicit counts are missing; type/category is normalized; null counts remain unavailable. | Five focused unit tests pass; browser/data integration not run. |
| Group-wallet 403 | Controller enforces financial-view permission. For authorised users without canonical group-to-ledger-account mapping, it returns a controlled unavailable response rather than inventing a balance. | Policy/source inspection only; runtime RBAC scenarios not run. |
| Refresh-token reuse 401 | Existing authentication architecture and `titech-auth` coordination were retained. The source archive's earlier documented Web Locks serialization and profile avatar contract are preserved. | No concurrent browser/token-family test run in this environment. Do not disable replay detection. |

## 6. Known BankConnect limitations

1. The five institutions are metadata profiles, not verified integrations. No bank connection is active.
2. `statementFormats` means local parsers accept the format; `bankPublishedStatementFormats` is empty until bank documentation confirms support.
3. XLSX parser uses the existing `exceljs` dependency but could not be tested because backend dependencies were not installed.
4. Legacy `.xls` is rejected pending hardened BIFF support.
5. CAMT/MT940 parser support is a constrained local subset, not a certification against every bank export.
6. Raw statement import requires a valid AES-256-GCM key and clean ClamAV verdict; neither production environment was available/configured here.
7. Account ownership evidence is a reference plus human maker-checker review; no bank attestation or document authenticity verification is implemented.
8. BankConnect currently does not connect to the existing finance `StatementProcessingService`/canonical reconciliation engine because the latter requires a separately verified ESM/CommonJS boundary fix.
9. No automated matching, confidence score, approval queue action, balance extraction, ledger posting, beneficiary management, or payment execution is delivered.
10. The UI currently implements seven BankConnect sections, not the full requested 15-section enterprise navigation.
11. No operational database migration/index creation run was made. Mongoose indexes are defined in source only.

## 7. Changed file discovery

The exact file list is in [`TITech_EXECUTION_CHANGED_FILES.md`](TITech_EXECUTION_CHANGED_FILES.md). In summary: BankConnect backend models/parser/crypto/routes/tests and documentation were added; route registry/RBAC/navigation/page route/Navbar/Dashboard/group presentation and package scripts were updated; environment examples were extended; and official-theme/RBAC/test-discovery audit snapshots were generated. No intentional application source file deletion was made. The original circular seal filename was restored exactly after the archive extraction path normalization was detected.

## 8. Production-readiness assessment

<badge>BLOCKED — NOT PRODUCTION APPROVED</badge>

The implementation has local unit-test evidence and static theme/organization/RBAC evidence only. It does not meet full acceptance because the supported Node/npm version is unavailable; dependencies are not installed; the full Jest/Vitest/E2E suite and frontend build could not run; MongoDB/Redis transactions and tenant isolation were not tested; the module audit has unresolved legacy boundaries; BankConnect is not wired to canonical reconciliation or ledger posting; and all external bank, provider, insurance, partner, regulatory and independent security approvals remain outstanding.

**`productionApproved=false` remains unchanged.** Do not use real customer statements or live bank credentials until the operational and external gates are cleared.

## 9. Reproduction commands

After preparing a supported environment (Node >=24.15.0, npm >=11), installing from lockfiles and providing isolated test infrastructure:

```bash
npm run test:bankconnect
npm run test:group-presentation
npm run audit:theme
npm run audit:organization
npm run check:rbac
npm run audit:modules
npm run audit:test-discovery
npm run build:frontend
npm run test:backend:ci
```

Before exercising statement upload, configure a private ClamAV scanner and a 32-byte AES key in a secret manager. Use a dedicated MongoDB replica-set test database and a dedicated Redis namespace. Do not direct test cleanup at production.
