# Test and Release Evidence Matrix

**Assessment date:** 15 November 2026  
**Execution environment:** Node.js 22.16.0 / npm 10.9.2  
**Repository requirement:** Node.js >=24.15.0 / npm >=11.0.0

## Executed checks

| Test / gate | Command | Actual result | Evidence file |
|---|---|---|---|
| Group Details style/identity | `node --test scripts/tests/group-details-style-contract.test.mjs` | PASS — 3/3 | `group-details-style-final.log` |
| Group and navigation contracts | `npm run test:navigation-groups` | PASS — 20/20 | `test-navigation-groups-final.log` |
| Company profile and financial metric tests | `npm run test:organization` | PASS — 4/4 | `test-organization-final.log` |
| Official theme | `node scripts/official-theme-audit.mjs` | PASS — 73 non-brand frontend CSS files consume centralized palette tokens | `theme-final.log` |
| Organization profile | `node scripts/organization-profile-gate.mjs` | PASS | `organization-final.log` |
| Enterprise JS/TS syntax | `node scripts/enterprise-gate.mjs --syntax` | PASS — 2,548 files parsed | `syntax-final.log` |
| Canonical financial static checks | `node scripts/financial-static-gate.mjs` | PASS — 12 canonical files | `financial-final.log` |
| USSD contract | `node scripts/ussd-contract-gate.mjs` | PASS — contract gate | `ussd-final.log` |
| Runtime import audit | `node scripts/runtime-import-audit.mjs` | PASS for canonical financial surface; 0 missing financial imports; 208 non-critical missing local references elsewhere | `runtime-imports-final.log` |
| Group CSS parser and JSX selector coverage | Python `tinycss2` parse + class-selector coverage | PASS — 89/89 classes; 0 CSS parse errors | `group-css-parse-final.log` |

## Blocked or unavailable checks

| Check | Attempted command | Actual result | Evidence file |
|---|---|---|---|
| Supported runtime gate | `npm run check:runtime` | BLOCKED — Node 22.16.0/npm 10.9.2 do not meet Node 24.15+/npm 11+ | `runtime-blocked.log` |
| Frontend build | `npm run build` | BLOCKED — `vite: not found`; dependencies are not installed | `build-blocked.log` |
| Theme Vitest suite | `node --test frontend/src/branding/__tests__/theme.test.js frontend/src/branding/__tests__/themeTokens.test.js` | BLOCKED — `vitest` is not installed | `theme-unit-tests-blocked.log` |
| MongoDB-backed group journey | `node --test backend/tests/integration/groups.journey.test.js` | BLOCKED before test execution — `@jest/globals` is not installed; MongoDB replica set is also unavailable | `group-integration-blocked.log` |
| Production approval | `npm run production:approval-gate` | BLOCKED — required protected approval evidence variables are absent | `production-approval-blocked.log` |

No MongoDB server, Redis server, Docker runtime or Vite executable was available in the execution environment. The codebase was not deployed to Vercel, and no live or sandbox provider transaction was executed.

## Critical release gates

The current repository critical-gate contract reports **Release status: BLOCKED** and `productionApproved: false`. Outstanding gates:

- `P0_RUNTIME_INSTALL`
- `P0_BOOTSTRAP_HEALTH`
- `P0_LEDGER_REPLAY`
- `P0_PROVIDER_FAILURES`
- `P0_TENANT_PERMISSIONS`
- `P1_SECURITY_RECOVERY`
- `P1_REGULATORY_PARTNER`
- `P1_COMMERCIAL_PILOT`

The protected evidence keys missing from the production approval gate are:

- `TITECH_PRODUCTION_APPROVAL`
- `TITECH_APPROVAL_REFERENCE`
- `TITECH_APPROVAL_EXPIRES_AT`

## Evidence-level status

| Area | Evidence state |
|---|---|
| Group Details presentation update | IMPLEMENTED |
| Group Details source-contract regression | UNIT TESTED |
| Navigation/group contract tests | UNIT TESTED |
| Company profile and official theme source gates | IMPLEMENTED / STATIC GATES PASS |
| JavaScript/TypeScript syntax gate | IMPLEMENTED / STATIC GATE PASS |
| Canonical financial static gate | STATIC GATE PASS; not a financial integration test |
| MongoDB group create/join/moderation journey | BLOCKED |
| Browser end-to-end group journey | NOT STARTED / BLOCKED |
| Payment-provider verification and settlement | BLOCKED / NOT PROVEN |
| Ledger replay and financial reconciliation journey | BLOCKED / NOT PROVEN |
| Independent security assessment | NOT STARTED |
| Operational verification / disaster recovery | NOT STARTED |
| Partner and regulatory approval | NOT STARTED / EXTERNAL |
| Production approval | BLOCKED (`productionApproved=false`) |

A static gate or passing component contract test does not establish runtime, financial, regulatory or production readiness.
