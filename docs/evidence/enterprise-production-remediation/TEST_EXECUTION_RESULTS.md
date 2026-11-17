# Test execution results — 17 November 2026

## Executed commands

| Command | Exit | Actual result |
|---|---:|---|
| `node --test tests/enterprise-remediation/module-read-contract.test.mjs` | 0 | 10 passed, 0 failed, 0 skipped; includes exact BigInt money display assertions, route/API source contracts and permission policy. |
| `node --test scripts/tests/navigation-registry-contract.test.mjs scripts/tests/navigation-routes-contract.test.mjs` | 0 | 7 passed, 0 failed, 0 skipped. |
| `node --test scripts/titech-critical-gates.test.mjs` | 0 | 4 passed, 0 failed, 0 skipped; verifies fail-closed critical gate contract, not release approval. |
| `node --test scripts/i18n-core.test.mjs scripts/locale-preferences.test.mjs` | 0 | 24 passed, 0 failed, 0 skipped. |
| `node scripts/enterprise-gate.mjs --syntax` | 0 | 2,561 executable JS/TS-family files parsed. |
| TypeScript `transpileModule` with React JSX on 10 changed frontend JSX files | 0 | 10 files parsed with 0 TypeScript syntax diagnostics. |
| Focused `node --check` on the three new backend read routers, route registry, RBAC policy, exact-money helper and focused test | 0 | All passed after final source edits. Member read contract includes a regression assertion that filtered pagination count is separate from tenant-wide summary totals, account/loan pagination offsets are bounded, and loan group/member population is tenant-matched. |
| `node scripts/official-theme-audit.mjs` | 0 | PASS; 77 non-brand CSS files, zero direct official palette hex occurrences. |
| `node scripts/organization-profile-gate.mjs` | 0 | PASS; product/legal identity, ERN source caveat, postal metadata, nine-colour theme checks. |
| `node scripts/financial-static-gate.mjs` | 0 | PASS; 12 canonical financial files checked. |
| `node scripts/rbac-security-gate.mjs` | 0 | PASS; 33 static checks, zero failures. |
| `node scripts/i18n-validation.mjs` | 0 | PASS structural translation-key coverage: 602 keys in en/sw/fr/ar. Human review still pending. |
| `node scripts/runtime-import-audit.mjs` | 0 | PASS on canonical financial surface; 208 legacy/non-critical missing local imports remain. |
| `node scripts/titech-critical-gates.mjs` | 0 | Critical gate contract script exits 0, while release status reports BLOCKED with eight gates OPEN. |

## Executed but blocked

| Command | Exit | Actual result |
|---|---:|---|
| `node scripts/titech-supported-runtime-gate.mjs` | 1 | Observed Node 22.16.0 / npm 10.9.2; repository requires Node >=24.15.0 / npm >=11.0.0. |
| `npm run build` | 127 | Reached `vite build`; failed because `vite` is not installed (`vite: not found`). |
| `npm test` | 1 | Backend test command could not find `backend/node_modules/jest/bin/jest.js`; dependencies are absent. |
| `npm run dev:backend` | 127 | Backend dev command could not find `nodemon`. |
| `npm run dev:frontend` | 127 | Frontend dev command could not find `vite`. |

## Not executed (not represented as passed)

- `npm ci`, `npm run install:all`, or nested backend/frontend clean installs. Required Node/npm versions were unavailable and package registry DNS lookup was unsuccessful, so installation was not completed.
- `npm run lint`, full backend/frontend suites after dependency installation, coverage or `npm run quality`.
- Backend/frontend application startup and `/api/v1/health` / `/api/v1/ready` (the attempted dev commands stopped before startup).
- MongoDB replica-set and Redis integration. No service binaries/containers were available.
- Browser screenshots, browser direct-link refresh, mobile responsive tests or Playwright E2E. Chromium existed but no application server/dependencies could be started.
- Database-backed tenant adversarial tests, financial posting/replay, provider tests, settlement/reconciliation, performance, disaster-recovery restore, independent security tests, regulatory/partner and pilot verification.

The syntax and static contracts are not substitutes for runtime integration or production certification.
