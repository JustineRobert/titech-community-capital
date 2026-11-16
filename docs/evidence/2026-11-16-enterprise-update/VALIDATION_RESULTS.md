# Validation results — 16 November 2026

All results below were produced in the extracted archive-local working directory. They are not results from GitHub, a deployed environment, or an institution's live environment.

## Passing checks

### Extended navigation/group/privacy contract set

Command:

```bash
node --test scripts/tests/public-brand-discovery.test.mjs scripts/tests/navigation-registry-contract.test.mjs scripts/tests/navigation-routes-contract.test.mjs scripts/tests/group-management-ui-contract.test.mjs scripts/tests/group-details-style-contract.test.mjs backend/tests/unit/groups/group-membership-requests-contract.test.mjs scripts/tests/error-boundary-privacy-contract.test.mjs
```

Result: **26 tests passed, 0 failed.** This combines the 20-test public/navigation/group suite with backend group membership and persisted-error privacy contracts.

### Public catalogue, routing, group input and UI contracts

Command:

```bash
node --test scripts/tests/public-brand-discovery.test.mjs scripts/tests/navigation-registry-contract.test.mjs scripts/tests/navigation-routes-contract.test.mjs scripts/tests/group-management-ui-contract.test.mjs scripts/tests/group-details-style-contract.test.mjs
```

Result: **20 tests passed, 0 failed.** Includes stable React key for the email row, controlled-input handler contract, Create Group theme tokens, existing Group Details access/style contracts, route completeness, public catalogue derivation, protected sign-in return path and footer branding.

### Selected service tests

Command:

```bash
node --test backend/tests/unit/edufinance/*.test.mjs backend/tests/unit/ubuntu-float/*.test.mjs backend/tests/unit/inclusive-onboarding/*.test.mjs backend/tests/unit/retirement/*.test.mjs backend/tests/unit/education/*.test.mjs backend/modules/ussd/tests/*.test.mjs scripts/tests/faith-giving-donations-contract.test.mjs
```

Result: **98 tests passed, 0 failed.** Includes school-fee application validation, participant consent and identity workflow contracts, refugee/asylum credential handling, insurer licence/consent gating, insurer role and private evidence restrictions, retirement contribution semantics, UbuntuFloat capability gating, education campaign restrictions, USSD provider-neutral callback contracts and donation pledge semantics.

### Official theme audit

Command: `node scripts/official-theme-audit.mjs`  
Result: **PASS.** Nine official palette values matched the existing reference contract; reference image checksum verified; explicit light/dark theme contract and startup wiring verified; 73 frontend CSS files scanned; no official palette hex literals found in non-brand stylesheets.

### Organization profile

Command: `node scripts/organization-profile-gate.mjs`  
Result: **13/13 checks passed.** Product/organization identity, ERN/certificate provenance, postal-address provenance, frontend/backend identity wiring and `productionApproved:false` validated.

### Financial and access-control static checks

- `node scripts/financial-static-gate.mjs` — **PASS**, 12 canonical financial files checked.
- `node scripts/rbac-security-gate.mjs` — **PASS**.
- `node scripts/ussd-contract-gate.mjs` — **PASS**, with `capabilityStatus=IMPLEMENTED_CONTRACT_ONLY`, `providerVerified=false`, `networkVerified=false`, `productionApproved=false`.
- `node scripts/enterprise-contract-contracts.mjs` — **PASS**, 11 contracts checked.
- `node scripts/enterprise-gate.mjs --syntax` — **PASS**, 2,551 executable JS/TS-family files parsed; warning states the runtime is below the repository baseline.


## Incremental group email row-identity hardening — current execution

The following checks were executed after the immutable row-ID update to `frontend/src/pages/CreateGroupV2.jsx` and the revised group UI contract test.

| Command | Result | Scope |
|---|---:|---|
| `node --test scripts/tests/group-management-ui-contract.test.mjs` | **7/7 passed** | Active CreateGroupV2 route contract, immutable row IDs, controlled email/role handlers, row removal, styling, route and authorization expectations |
| `node --test` over the five public/navigation/group UI suites listed above | **20/20 passed** | Public catalogue, route registry, group management and Group Details style contracts |
| Extended 7-file navigation/group/privacy command (see below) | **26/26 passed** | Adds backend membership-request and persisted error privacy contracts |
| Selected EduFinance, UbuntuFloat, inclusive onboarding, retirement, education, USSD and donations command (see below) | **98/98 passed** | Native policy, route, transaction-contract and provider-independent USSD tests |
| `node scripts/enterprise-gate.mjs --syntax` | **PASS** | 2,551 executable JS/TS-family files parsed; runtime warning remains |
| `node scripts/enterprise-completeness-gate.mjs` | **PASS** | 22 authoritative financial files checked |
| `node scripts/titech-implementation-gate.mjs` | **PASS** | Canonical bootstrap, compatibility boundaries and official theme contract |

Exact extended commands:

```bash
node --test scripts/tests/public-brand-discovery.test.mjs scripts/tests/navigation-registry-contract.test.mjs scripts/tests/navigation-routes-contract.test.mjs scripts/tests/group-management-ui-contract.test.mjs scripts/tests/group-details-style-contract.test.mjs backend/tests/unit/groups/group-membership-requests-contract.test.mjs scripts/tests/error-boundary-privacy-contract.test.mjs

node --test backend/tests/unit/edufinance/*.test.mjs backend/tests/unit/ubuntu-float/*.test.mjs backend/tests/unit/inclusive-onboarding/*.test.mjs backend/tests/unit/retirement/*.test.mjs backend/tests/unit/education/*.test.mjs backend/modules/ussd/tests/*.test.mjs scripts/tests/faith-giving-donations-contract.test.mjs
```

**Browser interaction test status:** `frontend/src/pages/__tests__/CreateGroupV2.interaction.test.jsx` is newly added. It uses the repository's Vitest, jsdom, React Testing Library and user-event stack to check full email input, `document.activeElement`, and input DOM identity after row deletion. It was **not run**: the frontend `node_modules` directory is absent, and the available Node/npm versions fail the repository engine gate. The static source contracts are not a substitute for this browser-DOM execution.

**Important root-cause correction:** the uploaded source did not contain an email-derived React key. It used `member-${index}`, which stays constant while a row remains at the same position during typing. Therefore the earlier report's statement that the email value changed the key and caused a remount was not substantiated by this snapshot. The new immutable row ID is additional list-identity hardening and gives a testable invariant across row insertion/removal; only the unexecuted browser interaction test can verify the expected DOM/focus behaviour in the frontend test runtime.

## Additional architecture, theme and release gates

| Command | Result | Interpretation |
|---|---|---|
| `node scripts/security-static-gate.mjs` | **PASS** | Static controls only; no independent penetration test performed |
| `node scripts/titech-brand-gate.mjs` | **PASS WITH WARNING** | Core logo/palette/chart contracts pass; 1,613 non-official frontend colour literals remain |
| `node scripts/titech-hosting-gate.mjs` | **PASS** | Required hosting/deployment artefacts and hardened template contracts are present |
| `node scripts/performance-contract-gate.mjs` | **PASS** | Read-only capacity-test contract and safety guards are present; no live load test performed |
| `node scripts/runtime-import-audit.mjs` | **PASS FOR CANONICAL FINANCIAL SURFACE** | 2,079 backend files scanned; 208 legacy/non-critical missing imports; none on the canonical financial surface |
| `node scripts/repository-completeness-audit.mjs` | **PASS WITH FINDINGS** | 3,803 files; 232 zero-byte files; 290 unresolved import edges; 1,331 CommonJS markers in backend `.js` |
| `node scripts/authority-map-audit.mjs` | **PASS WITH LEGACY BOUNDARIES** | Authority map refreshed; legacy boundaries remain |
| `node scripts/external-proof-gate.mjs` | **BLOCKED** | Required external evidence files are missing/not verified |
| `node scripts/production-approval-gate.mjs` | **BLOCKED** | Formal protected approval inputs are absent |
| `node scripts/i18n-production-gate.mjs` | **BLOCKED** | `sw`, `fr` and `ar` remain draft pending human linguistic/domain review |
| `node scripts/titech-phase-gate.mjs` | **BLOCKED** | Provider certification, operational drill and pilot acceptance have no PASS/SIGNED marker |
| `node scripts/release-readiness-gate.mjs --audit` | **PASS WITH WARNINGS** | Structural checks pass; runtime mismatch and import debt warnings remain |

The external-proof gate names these outstanding artifacts: `reports/real-infrastructure-smoke.json`, `reports/golden-money-path-e2e.json`, `reports/provider-certification.json`, `reports/security-assessment.json`, `reports/backup-restore-drill.json`, `reports/kubernetes-rollout-evidence.json`, `reports/reconciliation-evidence.json` and `reports/pilot-acceptance.json`. They were not fabricated.

**Colour-theme interpretation:** the theme audit verifies the nine official colours, explicit light/dark bootstrapping, and 73 non-brand CSS files without hard-coded official palette literals. The brand gate still identifies 1,613 non-official six-digit colour literals in frontend JS/JSX/CSS/SCSS source. Some are tests, charts, exports or page-level inline styles; each needs component-level review before it can safely be replaced with an appropriate semantic token. This execution preserved the current official theme files and did not perform a risky blanket colour replacement. Thus dashboard theme infrastructure exists and passes its current CSS contract, but full runtime visual migration is **not certified**.

## Blocked / incomplete checks

### Jest-dependent backend auth/group controller tests

Attempted command:

```bash
node --test backend/tests/unit/auth.controller.test.js backend/tests/unit/group.controller.test.js
```

Result: **not executable with this runtime invocation**. One suite expects Jest globals (`jest`), and the other cannot resolve `@jest/globals`; project dependencies are not installed. This is recorded as unavailable test infrastructure, not as a passing auth verification or confirmed application regression. The proper backend Jest runner must execute these suites after a clean install on the supported Node/npm runtime.

### Stylesheet syntax

A Python `tinycss2` stylesheet parse was run on:

- `frontend/src/pages/CreateGroupV2.css`
- `frontend/src/pages/public/InstitutionalPublicPages.css`
- `frontend/src/components/Footer.css`

Result: **3 stylesheets parsed, 0 parser errors**.

### Supported runtime

Command: `node scripts/titech-supported-runtime-gate.mjs`  
Result: **BLOCKED**. Observed Node `22.16.0`, npm `10.9.2`; required Node `>=24.15.0`, npm `>=11.0.0`.

### Critical production gate

Command: `node scripts/titech-critical-gates.mjs`  
The gate contract executes successfully but reports:

```text
Release status: BLOCKED
productionApproved: false
Open blocking gates:
P0_RUNTIME_INSTALL
P0_BOOTSTRAP_HEALTH
P0_LEDGER_REPLAY
P0_PROVIDER_FAILURES
P0_TENANT_PERMISSIONS
P1_SECURITY_RECOVERY
P1_REGULATORY_PARTNER
P1_COMMERCIAL_PILOT
```

### Not run / not established

- Root/backend/frontend dependency installation (`npm ci`) and supported-runtime full checks.
- Full Vite production build and full frontend test/coverage suite.
- Full backend test/coverage suite.
- Browser-based group email typing and focus test against the running React application.
- Browser visual regression, WCAG/keyboard/screen-reader testing and mobile screenshots.
- Live MongoDB and Redis connectivity, bootstrap/readiness, transactions and group invitation persistence.
- Refresh-token race/replay behaviour across simultaneous tabs and requests.
- Tenant isolation and wallet/ledger posting/replay against real database fixtures.
- Provider sandbox or production callback, settlement, reversal and reconciliation evidence.
- External SMTP/SMS delivery and new-user invitation onboarding.
- Independent security assessment, recovery drill, partner/regulatory approval and commercial pilot.

The project directories did not contain installed dependencies or `.git` metadata. MongoDB, Redis and provider services were not available. The ZIP snapshot therefore cannot prove a live production deployment or release readiness.

**Final technical state:** local source-level changes and selected static/contract tests pass; full enterprise production readiness remains **BLOCKED**, `productionApproved=false`.
