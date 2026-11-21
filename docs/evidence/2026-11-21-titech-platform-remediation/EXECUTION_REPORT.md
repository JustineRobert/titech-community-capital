# TITech Community Capital — remediation execution report

**Execution date:** 21 November 2026  
**Result:** **PARTIALLY COMPLETE — PLATFORM NOT READY FOR PRODUCTION**  
**Product:** TITech Community Capital  
**Registered organization:** TITECH CAPITAL - SMC LTD.  
**Official tagline:** Community Finance. Stronger Together.  
**Financial principle:** FINANCIAL CORRECTNESS BEFORE CONVENIENCE.

## 1. Executive decision

This archive-local execution implemented and regression-tested a focused remediation for the active Platform Administration dashboard, the active community Dashboard and Groups directory presentation, group-wallet availability messaging, and cross-tab refresh-token coordination. It also generated source-level theme, organization, RBAC, import-audit and Chat readiness evidence.

It is **not** an end-to-end production completion. The supplied archive has no `.git` metadata, the current execution environment is below TITech's declared Node/npm baseline, dependencies and live infrastructure are absent, and the application could not be started against MongoDB/Redis or exercised in a real browser. No GitHub synchronization, commit, push, deployment, payment, insurance operation or production approval is claimed.

`productionApproved=false` is preserved. The current critical-gate checker reports these eight open gates: `P0_RUNTIME_INSTALL`, `P0_BOOTSTRAP_HEALTH`, `P0_LEDGER_REPLAY`, `P0_PROVIDER_FAILURES`, `P0_TENANT_PERMISSIONS`, `P1_SECURITY_RECOVERY`, `P1_REGULATORY_PARTNER`, and `P1_COMMERCIAL_PILOT`.

## 2. Source provenance and baseline

- Supplied archive: `titech-community-capital-main.zip`.
- Measured SHA-256 for the file used in this execution: `c223ce37deb9f4e5a3439db1a5614b833d2bc246797290fb8d44a50b93d5abe3`.
- ZIP entries: 4621; ZIP integrity: PASS (no damaged member).
- Extracted working root: `titech-community-capital-main/`.
- `.git` directory: absent.
- ZIP comment: `55a61e5e88a0485d3327174c17033233a7b6f8df` (not proof of a Git commit).
- Observed runtime: Node `v22.16.0`, npm `10.9.2`.
- Required runtime from `.nvmrc`/package engine policy: Node `24.15.0`, npm `>=11.0.0`.

The archived `TITECH_PLATFORM_TRUTH.md` and prior baseline note record a different archive digest (`4e11865e29dce1379105a5eba5208ae56395da77974e6382b281c7c1a2575222`) and a different entry count. Those earlier values do not match the actual ZIP bytes supplied for this run. This report and the new top section of `TITECH_PLATFORM_TRUTH.md` supersede the archive identity for this execution. The older historical evidence is retained rather than silently rewritten.

A remote GitHub lookup was attempted from the execution environment but DNS/network access did not permit verification. No current remote branch, current GitHub HEAD, commit, push or deployment is asserted.

## 3. Work actually implemented

### 3.1 Administration Centre activity route

**Root cause:** the active platform dashboard router was mounted at `/api/admin` but did not register `/activity`; the UI therefore received a 404. The canonical append-only `AuditLog` model was already present and is reused.

**Change:** `backend/routes/platformDashboard.js` now exposes a paginated `GET /activity` under the existing platform-admin authentication and role guard. It queries real audit rows, safely hydrates actor/group display names, returns a stable `{ success, data: { items, total, page, limit, pages } }` envelope, and excludes unrestricted audit metadata from the public response.

**Boundary:** source and route-contract tests pass; a live request against the real Express server and database was not possible here.

### 3.2 Administration Centre statistics and activity rendering

**Root cause:** the backend response exposed a `stats` object while the frontend's normalizer expected the response data envelope. Additionally, activity records were not normalized into display-safe scalar fields.

**Change:** the backend returns a stable `data` shape and retains `stats` as a backward-compatible alias. The frontend normalizer supports both forms, preserves a genuine numeric zero, rejects malformed/negative numbers, handles nested actor/resource fields safely, and avoids rendering raw objects as `[object Object]`. Activity unavailable and genuinely empty states are distinct. Platform-wide dashboard access is limited in the component to `platform_admin`, matching the server route's existing platform-admin guard rather than treating tenant admins as global administrators.

**Honesty rule:** user and group counts and the defined active-loan count are query-backed. `pendingApprovals` and `totalSavings` deliberately remain `null` with explicit `dataAvailability` reasons because there is no single authoritative platform-wide approval queue contract and no verified platform-wide ledger-account aggregation configured for this view. Those values are displayed as unavailable, not as fabricated zeroes.

**Boundary:** aggregation semantics and real counts still require a database-backed integration run before operational sign-off.

### 3.3 Group directory and community dashboard

The active routes are `frontend/src/pages/GroupList.jsx` (Groups directory) and `frontend/src/pages/Dashboard.jsx` (community dashboard). Their cards now prefer explicit active-member/member counts and actual `members` array lengths; missing data remains unavailable rather than silently becoming zero. Contribution totals are displayed only when the explicit `totalContributions` field is present; savings balances or a generic `contributions` field are not substituted. Next contribution is taken from explicit contribution schedule fields and is shown as `Not scheduled` when absent. Group type/category and group identity are made more prominent. The associated directory CSS uses the existing semantic theme layer.

No fabricated group, membership, contribution or schedule records were added. A restored, non-active legacy dashboard/GroupList path was preserved byte-for-byte from the source archive and is not listed as a changed file.

### 3.4 Group-wallet availability states

`frontend/src/pages/GroupDetails.jsx` distinguishes an authorization denial (`403`, restricted), the existing `503 GROUP_FINANCIAL_ACCOUNT_NOT_CONFIGURED` condition, and other unavailable errors. The group-wallet RBAC policy was not widened. Existing policy tests continue to reject ordinary members, cross-tenant actors and unscoped platform support access. A wallet balance is not fabricated while the group lacks a verified canonical account mapping.

### 3.5 Refresh coordination

`frontend/src/services/api.js` retains its in-tab single-flight refresh and now uses the browser Web Locks API, when available, to serialize same-origin refresh attempts across tabs. Access tokens remain in application memory; refresh credentials remain in the existing HttpOnly-cookie architecture. No token is written to localStorage/sessionStorage or broadcast, and backend token-family replay detection was not weakened.

The cross-tab behavior itself still needs browser-level testing with two tabs and a live backend. This source change does not prove that every observed 401 was a race; true refresh-token reuse and stale-cookie scenarios remain to be distinguished by runtime evidence.

### 3.6 Brand/theme and company identity

No alternate product or company identity was introduced. The existing centralized brand source remains authoritative:

- Product: **TITech Community Capital**.
- Organization: **TITECH CAPITAL - SMC LTD.**.
- Tagline: **Community Finance. Stronger Together.**.
- Financial principle: **FINANCIAL CORRECTNESS BEFORE CONVENIENCE.**.

The official circular logo, nine-color palette and explicit light/dark theme system are preserved. The theme audit scanned 78 non-brand frontend CSS files and passed with zero hard-coded official palette occurrences. This is a token-consumption audit, not a visual/browser test of every dashboard at every breakpoint.

### 3.7 Refugee and host-community participants / authorized insurers

The supplied codebase already contains inclusive-onboarding and insurance policy foundations. The executed 27-test inclusive-onboarding suite and focused insurance contract suite confirmed source-level behaviors for refugee/asylum-seeker credential options, consent and identity separation, KYC lifecycle restrictions, licence gating, transaction-session/audit coupling, tenant-scoped consent and malware-screened private evidence upload. This execution did not activate those capabilities, create partner/insurer authorization, perform real enrolments/claims/premium processing, or establish regulatory approval. External partner and insurer permissions remain separate prerequisites.

### 3.8 Faith & Community Giving

The source inspection found the `TITECH_FAITH_GIVING_ENABLED` capability guard protecting the Faith-Giving operations. In the supplied environment the feature remains disabled. The `503` is therefore a fail-closed capability state, not something to hide by enabling the module or by turning the route into a synthetic success. The policy suite passed 18/18 and the existing contract gate passed 22 contracts. No donation payment, provider callback, settlement, ledger posting or receipt was performed.

### 3.9 TITech Chat (separate supplied E2E Chat mandate)

The separate Chat prompt requires real direct/group/institution messaging, canonical API and Socket.IO integration, Redis distribution, tenant-scoped persistence, read/delivery states, offline recovery, notifications, attachment authorization and two-user Playwright E2E. The existing `chat-production-gate` was run and remains **BLOCKED** on eight source/evidence conditions: API not mounted; protected workspace route absent; canonical socket handlers not attached; unsafe legacy room join; Redis Socket.IO adapter absent; tenant-scoped message create/read contract not established; CommonJS/ESM mismatch; and multi-user browser E2E evidence absent. The two Chat readiness regression tests and two selected Chat permission/validation test files passed, but they are not a live Chat E2E. The legacy code was not mounted and no second Socket.IO server was introduced.

## 4. Exact changed-file discovery

The authoritative file-by-file list is [`FILE_CHANGE_DISCOVERY.md`](./FILE_CHANGE_DISCOVERY.md). It separates source changes from generated evidence, lists each path and its reason, and records that no source files were deleted. This is an archive-to-working-copy comparison, not a Git diff.

## 5. Test and gate results

See [`TEST_RESULTS.md`](./TEST_RESULTS.md) and [`BLOCKER_REGISTER.json`](./BLOCKER_REGISTER.json).

Selected dependency-free tests executed: **72 passed, 0 failed** (the focused insurance tests are a subset of the inclusive-onboarding suite and are not double-counted). Selected test categories do not constitute the complete backend/frontend test suites.

Passing source gates:

- Enterprise syntax gate: 2,589 JS/TS-family files parsed.
- Official theme audit: PASS; 78 non-brand CSS files scanned.
- Organization profile gate: PASS.
- Faith-Giving contract gate: PASS (22 contracts, 8 required backend files).
- RBAC security static gate: PASS.
- Financial static gate: PASS (12 canonical files).
- Runtime import audit: canonical financial surface PASS; 2,097 backend source files scanned, 208 legacy/non-critical missing local imports remain, zero missing imports on the canonical financial surface.
- TITech critical-gate contract: PASS as a contract check; the release status it reports is BLOCKED with eight open release gates.

The supported-runtime gate is BLOCKED (Node/npm version mismatch). The protected production-approval gate is BLOCKED because the protected approval flag, reference and expiry are not configured. The Chat readiness gate remains BLOCKED as detailed above.

## 6. Not demonstrated / release blockers

The following were not executed or cannot be asserted from this archive environment:

1. Clean install under Node 24.15.0/npm 11+; installed Node/npm do not meet the declared baseline.
2. Full backend/frontend dependency install, production build, lint/format chain and complete CI test chain.
3. Actual Express bootstrap, `/api/v1/health`, `/api/v1/ready`, live `/api/admin/stats` and `/api/admin/activity` requests.
4. MongoDB replica-set transaction tests, Redis connectivity, queue/outbox behavior and database-backed two-tenant attacks.
5. Full browser E2E, desktop/tablet/mobile screenshots, light/dark visual regression and manual accessibility testing.
6. Real cross-tab refresh-token coordination and session-recovery browser tests.
7. Verified Group-to-canonical-financial-account mappings; group financial balance remains fail-closed where not configured.
8. Provider sandbox callbacks, settlement evidence, double-entry ledger replay, receipts, reconciliation, reversals and `UNKNOWN` recovery.
9. Full institution registration → documents → reviewer approval → idempotent tenant provisioning → group/member governance → pilot activation journey.
10. Live authorised insurer/partner onboarding, premium or claims processing, and external approvals.
11. Complete Chat API/socket/Redis/tenant persistence and two-user browser E2E.
12. Backup/restore, disaster recovery, measured RTO/RPO, load/performance test, independent penetration test, legal/regulatory review, partner agreements and pilot acceptance.
13. GitHub remote state, commit, push or deployment.

The existing eight P0/P1 gates remain open. The evidence ladder must continue to distinguish source implementation, static validation, unit testing, integration testing, database-backed testing, browser E2E, operational verification, external approval and production approval.

## 7. Reproduction commands

Run these from the repository root using the required supported runtime and provisioned test dependencies where specified:

```bash
node scripts/enterprise-gate.mjs --syntax
node scripts/official-theme-audit.mjs
node scripts/organization-profile-gate.mjs
node scripts/faith-giving-contract-gate.mjs
node scripts/rbac-security-gate.mjs
node scripts/financial-static-gate.mjs
node scripts/runtime-import-audit.mjs
node --test scripts/admin-dashboard-contract.test.mjs
node --test backend/tests/unit/groups/group-wallet-policy.test.mjs
node --test backend/modules/faith-community-giving/faithGiving.policy.test.js
node --test backend/tests/unit/inclusive-onboarding/*.test.mjs
node scripts/titech-supported-runtime-gate.mjs
node scripts/chat-production-gate.mjs
node scripts/titech-critical-gates.mjs
node scripts/production-approval-gate.mjs
```

Runtime-dependent integration and browser commands must be run only after Node/npm, packages, MongoDB replica set, Redis and Playwright browsers are correctly provisioned. Do not mark them passed based on this report.

## 8. Final release decision

**NOT READY.** The changes delivered here are a focused source-level remediation with passing selected native tests and static gates. They do not establish platform-wide enterprise production readiness, authorization to provide regulated financial/insurance services, partner approval, a successful live pilot or a GitHub release. Keep `productionApproved=false` and all external/live-money capability gates closed until independently reviewed evidence and authorized approvals exist.
