# CI execution report

## Commands and results

| Command | Exit | Result |
|---|---:|---|
| `npm run test:remediation:unit` | 0 | PASS — 29 tests, 0 failures |
| `node scripts/enterprise-gate.mjs --syntax` | 0 | PASS — 2,613 source files parsed |
| `node scripts/official-theme-audit.mjs` | 0 | PASS — official palette/theme contract; 81 CSS files |
| `node scripts/organization-profile-gate.mjs` | 0 | PASS — identity/contact/ERN/postal profile and production flag |
| `node scripts/financial-static-gate.mjs` | 0 | PASS — 12 canonical financial files |
| `node scripts/rbac-security-gate.mjs` | 0 | PASS — static RBAC gate |
| `node scripts/check-conflicts.js` | 0 | PASS — 4,098 files scanned |
| `node scripts/titech-supported-runtime-gate.mjs` | 1 | BLOCKED — Node/npm below declared minimum |
| `npm run install:all` | 1 | BLOCKED — safe installer stops before `npm ci` due runtime |
| `make install` | 2 | BLOCKED — Make propagates safe installer failure |
| `npm run check` | 1 | BLOCKED at first runtime gate; downstream chain not invoked |
| `npm run ci` | 1 | BLOCKED at first runtime gate; test/build chain not invoked |
| `npm --prefix frontend run build` | 127 | BLOCKED — `vite: not found` |
| `npm --prefix backend run check:esm` | 1 | BLOCKED — missing backend package `pino` |
| `node backend/scripts/migrate.js help` | 0 | PASS — CLI help |
| `node backend/scripts/migrate.js status` | 1 | BLOCKED — backend `dotenv` not installed |
| `node backend/scripts/createIndexes.js` | 1 | BLOCKED — backend `dotenv` not installed |
| `node scripts/verify-production-contract.mjs` | 1 | BLOCKED — API origin not configured |
| `node scripts/production-approval-gate.mjs` | 1 | BLOCKED — protected approval evidence absent |

The clean installation did not run: safe installer validated the runtime first and exited without executing `npm ci`. The full root CI pipeline did not pass. Do not interpret independent passing static checks as a green full CI run.
