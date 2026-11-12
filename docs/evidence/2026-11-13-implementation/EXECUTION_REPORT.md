# TITech Community Capital — Archive-Local Implementation and Readiness Report

**Execution date:** 13 November 2026  
**Organization:** TITech Capital SMC LTD  
**Product:** TITech Community Capital  
**Tagline:** BUILD LESS. PROVE MORE.  
**Engineering principle:** FINANCIAL CORRECTNESS BEFORE CONVENIENCE.  
**Source:** user-supplied `titech-community-capital-main.zip`  
**Release decision:** **NO-GO — NOT PRODUCTION READY**  
**`productionApproved`:** `false`

## 1. Executive result

The bytewise change inventory against the input ZIP contains **19 modified files, 7 added files and 0 deleted files**. The updated project contains 3,678 source/evidence files; the commercial directory still contains 22 zero-byte files.

This delivery is a bounded archive-local source update. It extends the existing Faith & Community Giving domain into a Donations directory and same-tenant pledge-submission slice, expands supported education/school campaign and budget classifications, corrects remaining hard-coded official theme colour references in two CSS files, updates route/navigation contracts, and adds focused tests. It preserves the existing React/Vite and Express/Mongoose application, existing JWT/session and tenant/RBAC boundaries, current canonical audit path and the existing financial-core boundary.

The donation journey now supports published campaign discovery, authenticated same-tenant cash pledges (UGX) and in-kind offers for scholastic materials, computers, textbooks, school/classroom equipment, furniture and construction/rehabilitation needs. Pledges remain commitments/offers only: this is **not** a live donations checkout, payment, funds-custody or goods-receipt system. The feature flag remains `TITECH_FAITH_GIVING_ENABLED=false` in the supplied environment template.

Group creation and membership code already existed in the 10 November archive remediation. The current update did not rebuild the group subsystem; it reran the focused group/navigation contract suite and adjusted one stale assertion to reflect the actual active Group List callback (`onJoin(normalizedId)`). Group business-flow coverage passes at source/contract level only. No live MongoDB or browser E2E journey was executed.

Commercial billing remains partial. The 22 zero-byte commercial files identified by the 12 November report remain empty. The existing `billingPayment.service.js` exists but the archive does not establish its runtime composition-root registration or end-to-end repository/controller/provider/ledger wiring. The new archive must not be described as a complete billing engine.

## 2. Source and environment boundary

| Check | Result | Interpretation |
|---|---|---|
| Input ZIP | Read and extracted successfully | Original uploaded ZIP left unchanged |
| `.git` metadata | Absent | Cannot determine branch, commit, remotes, clean-tree or GitHub `main` parity |
| GitHub push/deployment | Not performed | No commit, push, Vercel deployment or production change claimed |
| Node | `v22.16.0` | Below declared `>=24.15.0` |
| npm | `10.9.2` | Below declared `>=11.0.0` |
| Dependencies | Not installed; `node_modules` absent | `npm ci`, builds/lint and dependency-backed test suites not run |
| MongoDB replica set | `mongod` unavailable | Transactional database integration not run |
| Redis | `redis-server` unavailable | Queue/outbox/worker integration not run |
| Docker | Unavailable | No disposable services provisioned |
| Chromium | Present | Browser binary alone is not browser E2E; test framework dependencies absent |
| Runtime gate | BLOCKED | Fails on unsupported Node/npm versions |

The supported runtime gate command was run and failed as expected: Node `22.16.0` is below `24.15.0`; npm `10.9.2` is below `11.0.0`. Do not interpret syntax/static tests as proof of a supported-runtime application build.

## 3. Implementation delivered

### 3.1 Donations page and education donation scope

- Added a canonical `/donations` route which loads the existing campaign directory component; `/faith-community-giving` remains a compatibility redirect.
- Updated public navigation label/link to **Donations**.
- Updated the public page heading, copy and institutional identity to **TITech Capital SMC LTD · TITech Community Capital**.
- Added campaign classifications for scholastic resources/materials, school computers/digital access, school furniture/facilities, construction/rehabilitation and scholarships/learning support.
- Added budget categories for scholastic materials, computers/digital equipment, school furniture, textbooks/library, classroom equipment, teaching materials, accessibility equipment, construction materials and rehabilitation.
- Extended the existing pledge domain without creating a parallel giving subsystem: legacy cash pledges remain `CASH` by default; new `IN_KIND` pledges contain validated item description, category, quantity, unit, condition and optional notes. In-kind items have no monetary value in this record.
- Added a public-reference pledge endpoint to the existing authenticated/tenant-scoped Giving router. Campaign resolution uses the authenticated tenant context, requires the pledge-create permission, validates an `Idempotency-Key`, uses the existing campaign lifecycle and audit transaction, and enforces verified partner checks on refugee/host-community campaigns.
- Enabled the limited `faith-giving:pledge:create` action for member/participant/group-member roles. This does not grant campaign review, pledge-read or expense permissions.
- Added the frontend cash/in-kind pledge form using the established authenticated API client. Idempotency keys are reused for the same payload/campaign on retry, changed payloads receive a new key, and success clears the key for a later new pledge.
- User-facing copy distinguishes `pledged` from `collected`, and `offered` from `received/accepted`. No fabricated receipt, donation collection, custody, settlement or financial posting is created.

**Donor boundary:** the campaign list is publicly readable, but pledge submission in this slice requires an authenticated user from the same tenant as the campaign. Generic outside/public donor accounts and guest checkout are not yet implemented. This is a deliberate limitation, not an accidental claim of open donor checkout.

### 3.2 Official theme tokens

The official theme audit initially identified seven hard-coded official electric-blue literals in `frontend/src/components/ui/Spinner.css` and `frontend/src/pages/GroupList.css`. Replaced them with the central TITech official theme variables and token-derived opacity. The final theme audit passed: 73 non-brand CSS files scanned, zero hard-coded official palette occurrences, all nine official colours and light/dark theme contracts retained. No theme palette values were changed.

### 3.3 Group and navigation contract maintenance

The existing group workflow remediation from 10 November contains creator-only group creation, trusted tenant scoping, stable join IDs, pending/requested state, pending-request moderation, admin approval/rejection and audit handling in the existing aggregate, duplicate/capacity conflict handling and UI refetch after mutation. The current patch did not replace these services or add another Group model. It updated the contract assertion to match the active local list implementation's `onJoin(normalizedId)` call and added `/donations` to route/navigation contract expectations.

Group endpoints recorded by the prior remediation:

- `GET /api/groups`
- `POST /api/groups`
- `GET /api/groups/:id`
- `POST /api/groups/join/:id`
- `GET /api/groups/:groupId/membership-requests`
- `PATCH /api/groups/:groupId/members/:memberUserId`

The group workflow is **source/contract-tested only** in this execution. It is not browser E2E verified, nor proven against MongoDB replica-set persistence, concurrent live requests or restart recovery.

### 3.4 Commercial billing status

The 12 November commercial report remains the authoritative prior-work inventory. It describes the 16-file pricing/fee foundation as implemented and unit tested, but its financial adapter is only a strict boundary, not proof of live ledger wiring. The report identifies 22 empty commercial files (exact list in `CHANGE_DISCOVERY.md`). This update intentionally does not invent invoice, subscription, billing runtime, revenue-entry, reversal, settlement or canonical repository implementations without the real canonical dependencies and transaction contract.

The `billingPayment.service.js` file is substantial but does not establish operational integration. The current archive search did not establish a live service consumer/composition-root binding. Treat it as **implemented in isolation / runtime wiring unverified**, not end-to-end payment collection.

## 4. Test and gate results

The following commands were executed against this extracted source snapshot using the locally available Node 22.16.0/npm 10.9.2. Native Node suites do not require the absent package dependencies.

| Command | Result | Evidence level |
|---|---:|---|
| `npm run test:faith-giving` | 18 passed, 0 failed | Policy unit tests |
| `npm run test:faith-giving-donations` | 4 passed, 0 failed | New source/contract tests |
| `npm run test:navigation-groups` | 15 passed, 0 failed | Group/navigation source and route contracts |
| `npm run test:commercial:core` | 29 passed, 0 failed | Isolated commercial-core unit tests |
| `npm run check:financial` | PASS, 12 canonical files | Static financial gate |
| `npm run check:enterprise-contracts` | PASS, 11 contracts | Static contract gate |
| `npm run check:commercial-core` | PASS | Static commercial-core gate |
| `npm run check:runtime-imports` | PASS for canonical finance; 208 warnings outside | Import/static audit |
| `npm run audit:theme` | PASS | 73 CSS files; zero hard-coded official palette references |
| `npm run audit:organization` | PASS | Configured identity and organization profile checks; legal evidence still external |
| `npm run rbac:gate` | PASS | Static RBAC gate |
| `npm run test:critical-gates` | 4 passed, 0 failed | Evidence-ladder/release-gate tests |
| `npm run test:organization` | 4 passed, 0 failed | Organization profile / zero-value metrics tests |
| `npm run test:ussd` | 10 passed, 0 failed | USSD callback/session/menu contract tests |
| `npm run test:edufinance` | 16 passed, 0 failed | EduFinance intake and controls unit/contract tests |
| `npm run test:inclusive-onboarding` | 27 passed, 0 failed | Inclusive onboarding and private evidence contracts |
| `npm run test:education-campaigns` | 12 passed, 0 failed | Education campaign policy, privacy and route contracts |
| `npm run test:i18n:native` | 24 passed, 0 failed | Locale/preferences contract tests |
| `node scripts/enterprise-gate.mjs --syntax` | PASS, 2,542 files parsed | Syntax gate; warns on unsupported runtime |
| `npm run check:runtime` | BLOCKED | Unsupported local runtime |

`check:runtime-imports` reports **208 legacy/non-critical missing local imports** outside the canonical financial surface. It reports zero missing imports and zero mixed-module violations on that canonical financial surface. The warning remains open for separate consolidation.

Not executed: clean dependency installs, frontend/backend dependency-backed build, full lint/typecheck, full backend/frontend Jest/Vitest suites, actual Express startup/health checks, MongoDB replica-set tests, Redis/outbox/job tests, browser E2E, full API tenant attack testing, concurrency against real MongoDB, MTN/Airtel/bank sandbox transactions, provider settlement reconciliation, independent penetration/security assessment, backup restore drill.

## 5. Financial and donation integrity

- The cash pledge is stored as an integer amount in the configured campaign currency; initial Giving currency remains UGX.
- In-kind offers contain a whole-number quantity and allow-listed unit/category/condition; they do not have an invented UGX value.
- Pledge writes use the existing audit transaction and tenant-scoped idempotency model.
- The campaign public DTO remains allow-listed and does not expose tenant IDs, private receiving destination or partner evidence references.
- Refugee/host-community campaign display and pledge acceptance still require an eligible verified serving partner; this does not establish regulator or donor authorisation.
- No donation cash collection, payment instruction, payment-provider attempt, independent payment verification, payment allocation, financial transaction, ledger posting, revenue recognition, provider settlement, goods acceptance, inventory receipt or donation receipt was implemented or claimed.
- No existing group-join operation creates financial entries.

## 6. External and operational blockers

| Blocker | Why it matters | Evidence needed to close | Production impact |
|---|---|---|---|
| Supported Node/npm | Current runtime gate fails | Node >=24.15.0 and npm >=11, clean lockfile installs | Blocks supported-runtime certification |
| MongoDB replica set | Transaction and durable persistence proof absent | Replica-set integration, indexes, concurrency/rollback/restart tests | Blocks billing, donations and full group operational verification |
| Redis | Outbox/worker restart/retry proof absent | Redis-backed worker/outbox/recovery suite | Blocks operational verification |
| Browser E2E | End-user workflows not exercised | Playwright/browser runs with authenticated users and screenshots/reports | Blocks group/donations E2E claim |
| Commercial billing files | 22 critical commercial files still empty | Complete canonical repo/runtime/services/models and integration tests | Blocks complete billing lifecycle |
| Payment provider | No live authorised provider sandbox/callback/settlement evidence | Approved credentials, actual provider contract, sandbox evidence, settlement reports | Blocks real donations collection and billing collection |
| Donation handling | No funds or in-kind custody/receipt workflow | Authorised recipient, donor terms, payment/custody integrations, dual control, accounting and receipt policy | Blocks calling a pledge a donation received |
| External donors | Pledge write is same-tenant authenticated only | Approved public donor identity/privacy flow, token/email proof and anti-abuse controls | Limits public donor participation |
| Accounting and tax | Policy not independently signed off | Qualified professional review and approved chart/tax/revenue treatment | Blocks revenue posting and tax representations |
| Partner/regulatory | No documentary evidence supplied here | Institution/provider contracts, legal/regulatory assessment and approvals | Blocks unrestricted production use |
| Legal identity | Configuration passes; external corporate verification not performed here | Current corporate registry evidence and authorised approval | Does not certify incorporation/permissions |
| Disaster recovery | No actual restore exercise | Tested backup/restore, RPO/RTO evidence, ledger/audit integrity proof | Blocks operational production approval |
| Commercial validation | No buyer interviews/contracts/pilot evidence produced | Dated evidence register and signed authorised documents | Blocks commercial launch claims |

## 7. Final release decision

**NO-GO — NOT PRODUCTION READY.** Keep `productionApproved=false`; keep `TITECH_FAITH_GIVING_ENABLED=false`; do not enable real-money, donation collection, custody or insurer capabilities from this source-only update. This delivery has limited **Implemented → Unit Tested / Contract Tested** evidence for the donations pledge slice, selected group workflows and commercial pricing foundation. It has not reached complete Integration Tested, Browser E2E Tested, Operationally Verified, Security-Assessed, Externally Approved or Production Approved status.

## 8. Reproduction

From the repository root, after provisioning the declared runtime:

```bash
node --version
npm --version
npm run check:runtime
npm run test:faith-giving
npm run test:faith-giving-donations
npm run test:navigation-groups
npm run test:commercial:core
npm run check:financial
npm run check:enterprise-contracts
npm run check:commercial-core
npm run check:runtime-imports
npm run audit:theme
npm run audit:organization
npm run rbac:gate
npm run test:critical-gates
```

Then install the existing lockfiles (`npm ci`, `npm --prefix backend ci`, `npm --prefix frontend ci`) under the supported runtime; run the full CI, builds, lint and browser E2E; provision a disposable MongoDB replica set and Redis; exercise actual tenant, idempotency, audit, payment, ledger, settlement, recovery and restore scenarios. Do not enable production feature flags without independent approvals.
