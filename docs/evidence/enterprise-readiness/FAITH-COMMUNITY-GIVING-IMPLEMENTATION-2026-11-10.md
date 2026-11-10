# Faith & Community Giving — implementation and evidence report

**Evidence date:** 10 November 2026 (Africa/Kampala)  
**Organization:** TITech Capital SMC LTD  
**Product:** TITech Community Capital  
**Scope:** Archive-local engineering changes to the supplied `titech-community-capital-main.zip`  
**Release status:** `NOT_READY` — `productionApproved=false`

## 1. Source and execution boundary

The supplied ZIP was extracted and inspected as the local source of truth for this work. The archive does not contain `.git` metadata, so it cannot establish the source branch, HEAD commit, local user's pre-existing Git modifications, or equivalence with current GitHub `main`. This report therefore describes an updated archive, not an asserted remote checkout, commit, push or deployment.

The container runtime observed for this execution is Node.js `22.16.0` and npm `10.9.2`; the repository requires Node.js `>=24.15.0` and npm `>=11.0.0`. Root/backend/frontend `node_modules` are absent. MongoDB, Redis, Docker Desktop and a browser-backed E2E environment are not available. Consequently, dependency-backed application builds, backend startup, Vite build, Mongoose transaction integration, real DB index creation, browser E2E and payment-provider flows were not performed.

## 2. Work completed in this archive

- Added the Faith & Community Giving domain under `backend/modules/faith-community-giving` and reused Express/Mongoose, tenant authorization, action permissions, the existing audit service and the existing verified refugee partner profile.
- Implemented pure campaign, pledge, expense, currency, public-content, partner and budget-reservation rules.
- Added campaign, pledge and expense-request models with strict schemas and relevant tenant/idempotency/public-reference indexes.
- Implemented transactional campaign/pledge/expense-request mutations and same-session audit writes. Concurrent expense requests contend on the campaign document so the approved budget headroom is not simply re-read and over-committed in independent documents.
- Required a currently verified, scope-matched refugee/community-serving partner profile for refugee/host-community campaign submission and public reads. Public display is filtered again if the partner's verification is no longer active.
- Implemented explicit independent-review attestations, self-review/self-approval prevention and required partner safeguarding/authorization evidence for refugee/host-community campaigns.
- Implemented tenant-scoped, idempotency-key-protected pledge commitments. Duplicate-key races are re-read and returned only when the new request matches the original pledge intent.
- Implemented expense requests that reserve budget-line headroom. Rejection releases the reservation. Approval retains the reservation but does not pay a vendor or create a ledger posting.
- Registered feature-gated public and authenticated API routers in the canonical route registry.
- Added server-side action permissions and a role-aware frontend route/navigation entry.
- Added public directory and tenant campaign management pages using the existing API client, authentication context, public routes, central navigation registry and central brand theme tokens.
- Set `TITECH_FAITH_GIVING_ENABLED=false` in the backend environment example and added explicit test/index commands and a static contract gate.
- Preserved official circular-logo usage, light/dark theme system, all nine official colours, existing authentication, JWT/HttpOnly refresh-cookie model, tenancy, audit, canonical ledger/payment architecture and production gate.

## 3. Explicit implementation boundary

This is a campaign-governance and record-management foundation, not the full contribution/payment product described in the master prompt. No live or simulated payment integration has been connected. No payment initiation, authenticated provider callback, settlement, canonical financial transaction, double-entry ledger posting, balance change, official payment receipt, refund, disbursement or reconciliation is implemented in this slice. The module deliberately has no parallel ledger or payment model.

Pledges are commitments only and cannot be counted as collections. Expense approvals are internal authorization records and budget reservations only; they do not prove that an expense was paid. There is no campaign closure statement. UGX is the only enabled currency. There is no automated recurring collection, QR/USSD payment, bank/MTN/Airtel integration, guest checkout, public donor contribution journey, complete institution/committee onboarding, notification delivery, export/reporting, complaint workflow or subscription billing in this slice.

The insurance module was not extended. Insurance remains a separate capability that requires authorised insurers/intermediaries, product and distribution approvals, appropriate contracts and legal review. Infrastructure work alone does not establish any permission. Refugee and host-community functionality similarly remains restricted to verified, authorised institutional partners and safeguarding review; a software flag is not legal, protection or statutory approval.

## 4. Verification performed

| Command / check | Result | Interpretation |
|---|---:|---|
| `node --test backend/modules/faith-community-giving/faithGiving.policy.test.js` | PASS — 16/16 | Pure domain policy, validation, partner safeguard, budget reservation and public DTO rules; no database |
| `node scripts/faith-giving-contract-gate.mjs` | PASS — 22 contracts | Static contract checks for backend route/permission/flag, tenant scope, transactional audit, partner checks, idempotency, safe DTO and frontend integration; not a live API test |
| `node --check` on the 12 changed/new backend ESM and gate files | PASS — 12/12 | Node syntax only; no dependency resolution/startup |
| `node scripts/enterprise-gate.mjs --syntax` | PASS — 2,530 files | Repository-wide JavaScript/TypeScript-family parse; warning that runtime is below target |
| `node scripts/official-theme-audit.mjs` | PASS | All nine official colours match the theme contract; 71 non-brand frontend CSS files scanned; zero hard-coded official palette literals |
| `node scripts/organization-profile-gate.mjs` | PASS — 12 checks | Current configured organization/product identity, separate portal association, external-verification boundary and production flag |
| `node scripts/rbac-security-gate.mjs` | PASS | Static RBAC contract; not a penetration test |
| `node scripts/financial-static-gate.mjs` | PASS — 12 canonical files | Financial static contract; not ledger replay or live-money proof |
| `node --test scripts/tests/navigation-registry-contract.test.js scripts/tests/navigation-routes-contract.test.js scripts/tests/group-management-ui-contract.test.js backend/tests/unit/groups/group-membership-requests-contract.test.mjs` | PASS — 4/4 | Selected existing navigation and group regression tests |
| `node --test scripts/titech-critical-gates.test.mjs` | PASS — 4/4 | Release evidence ladder and runtime contract remain fail-closed |
| `node --test scripts/organization-profile-gate.test.mjs scripts/financial-metric-display.test.mjs` | PASS — 4/4 | Organization/profile and financial metric display contracts |
| `node scripts/titech-critical-gates.mjs` | Contract PASS; release BLOCKED | Eight P0/P1 gates remain open; production approval remains false |
| `node scripts/titech-supported-runtime-gate.mjs` | BLOCKED | Node 22.16.0/npm 10.9.2 observed; Node >=24.15.0/npm >=11.0.0 required |
| Root `npm run check`, `npm run test:ci`, backend Jest/Vitest, frontend test suite and Vite build | NOT EXECUTED / BLOCKED | The runtime is below the declared baseline and project dependencies are not installed in this environment |
| Backend startup, MongoDB/replica-set transactions, Redis integration/index creation, API E2E and browser E2E | NOT EXECUTED | Services/dependencies unavailable |
| Payment sandbox/provider callbacks, settlement, ledger, refund, receipt and reconciliation E2E | NOT IMPLEMENTED / NOT EXECUTED | This feature slice deliberately has no payment or financial posting path |
| Independent security penetration assessment, safeguarding, privacy/legal/regulatory review and partner authorization | NOT EXECUTED | Requires qualified independent reviewers and documentary evidence |

An earlier ad-hoc check invocation used an incorrect `.js` extension for the existing `.mjs` critical-gate test filename; it was not treated as a project failure. The correctly named `.mjs` test command above passed. No result is inferred for a command that was not executed.

## 5. Release assessment

**Status: NOT READY.** The backend feature flag remains off by default. Campaign pages must not be enabled for public users until the applicable partner, privacy, safeguarding and operational reviews pass. Live-money capability must remain disabled until the existing canonical provider/payment/financial transaction/ledger/receipt/outbox/reconciliation pipeline is deliberately connected and proven with provider evidence in a replica-set-backed environment.

The archive has not been pushed to GitHub and no production deployment was made. The user must apply this archive to the actual working clone only after reviewing/merging their legitimate local changes, then test on the repository's supported Node/npm versions and approved staging infrastructure.

## 6. File change summary

A recursive file comparison against the untouched uploaded archive found **28 changed paths (18 added, 10 modified, 0 removed)**. The exact path/status list is recorded in [`FAITH-COMMUNITY-GIVING-CHANGE-MANIFEST-2026-11-10.csv`](FAITH-COMMUNITY-GIVING-CHANGE-MANIFEST-2026-11-10.csv). The step-by-step rationale and local PowerShell verification sequence are in [`FAITH-COMMUNITY-GIVING-CHANGE-DISCOVERY-2026-11-10.md`](FAITH-COMMUNITY-GIVING-CHANGE-DISCOVERY-2026-11-10.md).

No existing source file was deleted. The original uploaded ZIP remains untouched. The `reports/` directory produced by local static gates was excluded from the release archive because those generated, ignored artefacts are redundant with this checked-in evidence report.
