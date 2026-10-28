# TITech Archive-Local Verification — 28 October 2026

## Decision

- Release: `NOT_READY`
- `productionApproved`: `false`
- Critical contract validator: `PASS`
- Open blocking P0/P1 gates: all eight remain open in `docs/evidence/critical-gates-2026-10-28.json`.

This is an archive-local verification record, not a passing CI run, independent security assessment, provider certification, institution-approved pilot, legal opinion, or production approval.

## Environment and limitations

- Actual runtime: Node.js `v22.16.0`, npm `10.9.2`.
- Required runtime: Node.js `>=24.15.0`, npm `>=11.0.0`.
- Root/backend/frontend `node_modules` directories were absent; no dependency-backed clean install, full app test suite, or application build was performed.
- Docker executable was unavailable in this environment; MongoDB replica-set and Redis persistence configurations were not started or operationally tested here.
- The supplied ZIP did not contain `.git`, so changes are inventoried by byte-for-byte comparison against the uploaded ZIP, not `git diff`; no push or remote repository update is claimed.

## Checks actually executed

| Check | Result | Evidence boundary |
|---|---|---|
| Selected native tests | 108 passed / 108 total across 11 npm scripts; 0 failures | Not the full backend/frontend test suites |
| New critical-gate tests | 4/4 passed | Validates gate contract and runtime helper behavior, not live infrastructure |
| `node scripts/check-conflicts.js` | Exit 0 | Conflict-marker check only |
| `node scripts/financial-static-gate.mjs` | PASS, 12 canonical files checked | Static/source scope only |
| `node scripts/titech-hosting-gate.mjs` | PASS | Static hosting/template contract only |
| `node scripts/rbac-security-gate.mjs` | PASS | Script-defined checks only; not live authorization E2E |
| `node scripts/performance-contract-gate.mjs` | PASS | Contract-only, not measured production load |
| `node scripts/runtime-import-audit.mjs` | PASS for canonical financial surface | Output also records non-critical missing imports elsewhere; see generated report |
| `node scripts/enterprise-gate.mjs --syntax` | PASS; 2,461 JS/TS-family files parsed | Syntax parsing only |
| YAML parse with duplicate-key detection | 10 workflow/Compose files parsed | Syntax/duplicate-key check only; not GitHub Actions or Docker execution |
| `npm run titech:critical-gates` | Contract PASS; release BLOCKED | Correctly reports all 8 gates open |

Raw selected-test, static-gate and blocking-gate outputs are retained alongside this report in `reports/evidence/`. The complete byte-level added/modified file manifest is `docs/evidence/remediation-file-manifest-2026-10-28.json`; the high-level change map is `TITECH_REMEDIATION_CHANGESET_2026-10-28.md`.

## Expected blockers confirmed

`npm run check:runtime` exits non-zero on the observed Node/npm versions. `npm run check` therefore stops at its first supported-runtime gate and does not run the downstream lint/build commands in this environment. `npm run titech:critical-gates:strict` exits non-zero while P0/P1 evidence remains open. Both are intended fail-closed behavior, not a defect to bypass.

## Main archive changes

- Added a copy-ready end-to-end P0/P1 remediation prompt and machine-readable gate contract.
- Added a dependency-free supported-runtime gate, a critical-gate validator and native regression tests.
- Put runtime and critical-gate checks at the start of the root check, and the contract test first in `test:ci`.
- Aligned CI and deployment validation with the declared runtime, pinned npm 11.12.1, transaction-capable MongoDB replica set and persistent Redis validation stack; removed silent `npm audit` failure suppression; enforced the backend integration-test command rather than logging success when the script was missing.
- Made database/cache host ports loopback-only in the maintained/root Compose stacks; configured Redis persistence and `noeviction` in critical validation/root stacks. The root `docker-compose.dev.yml` is marked legacy and non-transactional; it must not be used to claim replay proof.
- Updated local CI guidance and the platform-truth handoff; kept all gate statuses unverified/external-required and production approval false.

## Remaining required proof

1. Run on Node 24.15.0+/npm 11+ in a clean CI environment; complete root/backend/frontend lockfile installs, tests, lint and builds.
2. Execute start/stop twice, bootstrap rollback, real health/readiness transitions, Mongo transaction commit/abort and concurrent replay/restart tests against the validation service stack.
3. Prove authenticated MTN sandbox calls, signature verification, duplicate/out-of-order callbacks, timeout-to-UNKNOWN status verification, settlement matching, refund/reversal and reconciliation.
4. Execute live API/E2E cross-tenant denial, least-privilege, service identity and maker-checker tests.
5. Complete independent security review, document-scanner E2E, secret/container/IaC/dependency scans, encrypted restore, rollback and incident drills.
6. Obtain qualified Uganda legal/privacy and current PDPO status confirmation; record written provider/institution permissions and keep restricted features OFF until approved.
7. Run a named institution's signed sandbox/shadow pilot with pre-agreed baseline, weekly metrics, institution-reviewed ROI and paid-conversion evidence.
8. Review the release artifact and evidence bundle independently, then pass the protected production-approval gate with authorized, unexpired approval evidence.

The Golden Money Path remains the target proof sequence; source-level wiring is not evidence that the full path has passed end to end.
