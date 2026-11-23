# Test and verification results — 22 November 2026

The commands were run from the extracted archive with Node 22.16.0/npm 10.9.2. This runtime is below the declared strict minimum; only dependency-free native Node scripts/tests were run. Root/backend/frontend npm dependencies are absent.

| Command | Outcome | Result |
|---|---|---|
| `node scripts/titech-supported-runtime-gate.mjs` | BLOCKED (exit 1) | Required Node >=24.15.0/npm >=11; observed 22.16.0/10.9.2. |
| `node scripts/official-theme-audit.mjs` | PASS | 78 CSS files, zero hard-coded palette literals in non-brand CSS. |
| `node scripts/organization-profile-gate.mjs` | PASS | Current product/entity/contact/profile provenance and theme contracts. |
| `node scripts/financial-static-gate.mjs` | PASS | 12 canonical financial files. |
| `node scripts/rbac-security-gate.mjs` | PASS | Static RBAC gate. |
| `node scripts/commercial-billing-core-gate.mjs` | PASS | Commercial foundation/pricing safety contracts. |
| `node scripts/run-commercial-core-tests.mjs` | PASS | 37/37. |
| `node scripts/chat-production-gate.mjs` | BLOCKED (exit 1) | 8 Chat integration/E2E blockers. |
| `node --test scripts/chat-production-gate.test.mjs` | PASS | 2/2. |
| `node --test backend/tests/unit/inclusive-onboarding/*.test.mjs` | PASS | 27/27. |
| `node --test scripts/tests/core-dashboard-brand-contract.test.mjs` | PASS | 4/4. |
| `node --test scripts/organization-profile-gate.test.mjs scripts/financial-metric-display.test.mjs` | PASS | 4/4. |
| `node --test backend/tests/unit/groups/group-wallet-policy.test.mjs backend/tests/unit/groups/group-invitation-policy.test.mjs backend/tests/unit/groups/group-contribution-capability.test.mjs` | PASS | 17/17. |
| `node --test backend/modules/faith-community-giving/faithGiving.policy.test.js` | PASS | 18/18. |
| `node --test backend/tests/unit/inclusive-onboarding/route-contract.test.mjs backend/tests/unit/inclusive-onboarding/offline-contract.test.mjs` | PASS | 13/13 (subset re-run; overlaps 27). |
| `node scripts/enterprise-gate.mjs --syntax` | PASS | 2,589 JS/TS-family files parsed. |
| `node scripts/i18n-validation.mjs` | PASS (structure only) | 602 keys per locale; sw/fr/ar pending human review. |
| `node scripts/performance-contract-gate.mjs` | PASS | Read-only capacity-test contract. |
| `node scripts/runtime-import-audit.mjs` | PASS with warning | 2,097 backend files; 208 missing local imports, 0 on canonical financial surface. |
| `node scripts/titech-critical-gates.mjs` | BLOCKED release result | Contract checker runs, but eight P0/P1 release gates remain open and `productionApproved=false`. |
| `npm run build:frontend` | BLOCKED | `vite: not found`; frontend dependencies are absent. |
| `npm run test:backend` | BLOCKED | Jest package missing from `backend/node_modules`. |
| `npm run test:frontend` | BLOCKED | `vitest: not found`; frontend dependencies are absent. |

The inclusive route/offline selection intentionally overlaps the larger 27-test suite. Results are listed individually rather than summed into a potentially double-counted total. Full dependency-backed Jest/Vitest and backend/frontend builds were attempted but blocked by missing Jest/Vite/Vitest packages; `npm ci` was not attempted because the strict supported-runtime gate already fails. MongoDB/Redis integration, authenticated API E2E, Playwright, provider sandbox, security penetration, backup/restore and production deployment tests were not run.

Full output is preserved in `logs/`; generated machine-readable gate reports are in the repository `reports/` directory.
