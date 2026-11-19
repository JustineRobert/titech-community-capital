# Test evidence register

**Execution date:** 19 November 2026  
**Local runtime observed:** Node.js v22.16.0, npm 10.9.2  
**Required repository runtime:** Node.js >=24.15.0, npm >=11.0.0

## Passed native tests

| Command / test file | Result | Scope |
|---|---:|---|
| `node --test backend/tests/unit/platform/mongoose-version-key-contract.test.mjs` | 2 passed | Direct source scan for boolean `versionKey` and retention of `__v` declarations. |
| `node --test backend/tests/unit/logging/logArgumentNormalizer.test.mjs` | 5 passed | Structured logger argument normalization, error handling, redaction and circular values. |
| `node --test backend/tests/unit/platform/titech90dayContracts.node.test.js` | 5 passed | MTN fail-closed configuration and pilot evidence / external approval / activation / hold-state contracts. |
| `node --test scripts/tests/sacco-vsla-onboarding-contract.test.mjs` | 6 passed | Existing brand, group-type, tenant-safe financial-read and theme contracts. |
| `node --test scripts/tests/navigation-menu-placement.test.mjs` | 4 passed | Viewport placement helper geometry. |
| **Total** | **22 passed, 0 failed** | Native Node tests only; not a full app E2E suite. |

## Passed static gates

| Command | Result | Evidence |
|---|---|---|
| `node scripts/enterprise-gate.mjs --syntax` | PASS | 2,568 executable JS/TS-family files parsed. Gate warned local runtime is below repository target. |
| `node scripts/financial-static-gate.mjs` | PASS | 12 canonical financial files checked. |
| `node scripts/rbac-security-gate.mjs` | PASS | Static RBAC/security gate. |
| `node scripts/enterprise-contract-contracts.mjs` | PASS | 11 control-plane contracts checked. |
| `node scripts/official-theme-audit.mjs` | PASS | Nine official palette values; light/dark contract; 77 CSS files scanned; zero hard-coded official palette occurrences outside brand CSS. |
| `node scripts/organization-profile-gate.mjs` | PASS | 14 organization identity/contact/theme/approval checks. |

Generated reports: `reports/official-theme-audit.json` and `reports/rbac-security-gate.json`.

## Blocked or not executed

| Check | Result | Reason |
|---|---|---|
| Runtime support gate `node scripts/titech-supported-runtime-gate.mjs` | BLOCKED | Node 22.16.0/npm 10.9.2; repository requires Node >=24.15.0/npm >=11.0.0. |
| Frontend `npm --prefix frontend run build` | BLOCKED | `vite: not found`; frontend dependencies are not installed. |
| Backend `npm --prefix backend run diagnose:routes` | BLOCKED | `express` package is absent; backend dependencies are not installed, so route import cannot reach application/model import validation. |
| Backend dev server | NOT RUN | `node_modules` absent (including `nodemon` and runtime dependencies); no service startup was claimed. |
| MongoDB / Redis integration | NOT RUN | No dependency installation or live service-backed environment was available. |
| Browser E2E / viewport matrix | NOT RUN | No Playwright/Cypress project dependencies are installed. Chromium binary availability alone is not an E2E harness. |
| Screenshots / visual regression / WCAG audit | NOT RUN | No browser test harness; geometry helper tests are not visual evidence. |
| Full frontend/backend lint and Jest/Vitest suites | NOT RUN | Project dependencies and package executables are absent. |
| Provider sandbox/live tests | NOT RUN | No external provider call, provider credentials or approval evidence used. |

The package manager cache had zero entries. No claim is made that dependencies were installed. No full build or end-to-end test is marked as passed.

## Evidence interpretation

The 22 passed tests are focused native Node tests and static contract tests. The static gates are source-level inspections. They do not prove live route registration, database transactions, UI rendering, browser interaction, external provider settlement, legal verification or regulatory authorization.
