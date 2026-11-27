# Test and verification results — 27 November 2026

## Runtime and installation

| Command | Result | Evidence / interpretation |
|---|---|---|
| `node --version && npm --version` | BLOCKED | Observed `v22.16.0` / `10.9.2`; repo requires Node `>=24.15.0` / npm `>=11.0.0`. |
| `npm run check:runtime` | BLOCKED | Runtime gate rejected both versions. |
| `npm run install:all -- --dry-run` | BLOCKED | Safe installer refused before package installation. |
| `npm ci` | NOT RUN | Not attempted under unsupported runtime; no destructive/lockfile operation. |

## Static and contract gates

| Command | Result | Exact output / scope |
|---|---|---|
| `npm run audit:theme` | PASS | Nine official colors, light/dark entrypoints and token usage across 82 non-brand frontend CSS files. |
| `npm run audit:organization` | PASS | Official product/legal name, ERN provenance, contact/postal details and `productionApproved=false`. |
| `npm run check:financial` | PASS | 12 canonical files; source-contract check only, not a ledger E2E. |
| `npm run rbac:gate` | PASS | Static RBAC gate. |
| `npm run validate:syntax` | PASS | 2,622 JS/TS-family files parsed; runtime-version warning remains. |
| `npm run check:enterprise-contracts` | PASS | 11 control-plane contracts. |
| `npm run check:runtime-imports` | PASS_WITH_WARNING | Canonical financial surface: 0 missing local imports, 0 mixed-module violations; repository overall reports 208 missing local imports. |
| `npm run audit:modules` | FAIL | 2,108 backend files; 207 unresolved relative `require()`; 345 CJS→ESM boundaries; 45 mixed-module files. |
| `npm run check:commercial-core` | PASS | Commercial billing core static/contract gate. |
| `npm run check:ussd` | PASS | USSD contract gate. |
| `npm run i18n:check` | PASS | Structural locale validation. |
| `npm run i18n:production-gate` | BLOCKED | Status `BLOCKED_HUMAN_REVIEW`; structural parity is not qualified human translation approval. |
| `npm run audit:frontend-runtime` | PASS_WITH_WARNINGS | Static frontend runtime audit produced warnings; no browser execution. |
| `npm run check:faith-giving` | PASS | 22 contracts and 8 required backend files. |
| `npm run release:gate` | PASS_WITH_WARNINGS | Audit mode exits 0; runtime mismatch and 208 missing imports are warnings, not proof of production readiness. |
| `npm run release:gate:strict` | BLOCKED | Strict release gate rejects Node 22.16.0 vs required Node 24.15.0. |
| `npm run titech:critical-gates` | PASS_WITH_OPEN_GATES | Contract executes; release status BLOCKED with 8 open P0/P1 gates. |
| `npm run titech:implementation-gate` | PASS | Canonical bootstrap compatibility and nine-color brand contract checks. |
| `npm run titech:90-day-gate` | PASS_WITH_WARNINGS | No live MTN configuration, callback secret, connectivity, transaction or certification asserted; production approval false. |
| `npm run enterprise:master-gate` | PASS_WITH_BLOCKERS | Gate report generated; recovery, partner, security and production evidence remain unverified/blocked. |

## Dependency-free tests that passed

The root `npm run test:ci` sequence executed 27 dependency-free test batches and reported **343 passed, 0 failed, 0 skipped** before reaching `test:backend:ci`. This is a preflight portion of the full CI command, not a full CI pass.

Additional focused command re-runs:

| Command | Result |
|---|---:|
| `npm run test:bootstrap:contract` | 4/4 PASS |
| `npm run test:bankconnect` | 9/9 PASS |
| `npm run test:organization` | 4/4 PASS |
| `npm run test:dashboard-brand` | 4/4 PASS |
| `npm run test:pilot-readiness` | 5/5 PASS |
| `npm run test:financial:product-rules` | 5/5 PASS |
| `npm run test:faith-giving` | 18/18 PASS |
| `npm run test:ubuntu-float` | 13/13 PASS |
| `npm run test:edufinance` | 16/16 PASS |
| `npm run test:ussd` | 10/10 PASS |
| `npm run test:i18n:native` | 27/27 PASS |
| `npm run test:performance-contract` | 8/8 PASS |
| `npm run test:document-malware-scan` | 4/4 PASS |
| `npm run test:commercial:core` | 37/37 PASS |
| `npm run test:faith-giving-donations` | 4/4 PASS |
| `npm run test:profile-avatar` | 6/6 PASS |
| `npm run test:admin-dashboard-contract` | 9/9 PASS |
| `npm run test:critical-gates` | 4/4 PASS |
| `npm run test:remediation:unit` | 29/29 PASS |

**Do not add the focused re-runs to the 343 preflight count as independent coverage:** several are the same test groups re-executed separately.

## Golden Money Path reference harness

| Command | Result | Scope |
|---|---|---|
| `node scripts/golden-money-path-proof.mjs` | PASS | Dependency-free reference harness for a simulated UGX 50,000 lifecycle including timeout/restart, duplicate protection, status recovery, ledger, settlement, reconciliation, receipt and reversal. This is not MongoDB/Redis/provider integration or browser E2E. |

Machine-readable evidence: `reports/evidence/golden-money-path-proof.json`. The report marks 11 modeled guarantees true, but explicitly states that it does not contact MTN, Airtel, banks, Redis or MongoDB and cannot establish external authorization.

## Build and full CI

| Command | Result | Reason |
|---|---|---|
| `npm run build:backend` | NOT RUN (no-op script) | Invocation exits zero but only prints that Node runtime requires no compilation; no backend package/build artifact or runtime execution was produced. |
| `npm run build:frontend` | FAIL | `vite: not found`; dependencies are absent. |
| `npm run test:frontend:ci` | FAIL | `vitest: not found`; dependencies are absent. |
| `npm run test:backend:ci` | FAIL | Jest entry point under `backend/node_modules` is missing. |
| `npm run test:ci` | FAIL | Root preflight succeeded, then backend Jest could not be loaded. |

## Infrastructure / external execution

- MongoDB replica-set integration: NOT RUN (MongoDB unavailable; port 27017 closed).
- Redis integration/recovery: NOT RUN (Redis unavailable; port 6379 closed).
- Docker/container build: NOT RUN (Docker CLI unavailable).
- Browser E2E/Playwright: NOT RUN (frontend dependencies/browser environment unavailable).
- Provider sandbox/production transaction: NOT RUN (no credentials or authorisation; no provider connectivity claimed).
- Database-backed tenant attack tests: NOT RUN.
- Ledger posting/replay/reversal: NOT RUN at runtime.
- Backup/restore drill: NOT RUN.
- Independent penetration test: NOT RUN.

Full command output is retained in `logs/` and current generated static reports remain under the repository `reports/` directory.
