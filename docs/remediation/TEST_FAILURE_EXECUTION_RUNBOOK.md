# TITech Test Failure — Targeted Execution Runbook

This runbook adapts the supplied test-failure master prompt to the publicly visible package manifests. Confirm each path exists in the actual checkout and its runner owner before invocation.

## 1. Reproduce environment and package context

From repository root in PowerShell:

```powershell
node --version
npm --version
git status --short
git rev-parse --show-toplevel
git rev-parse HEAD
npm run
npm --prefix backend run
npm --prefix frontend run
```

The repository declares Node `>=24.15.0` and npm `>=11.0.0`. The root and backend are ESM. Backend Jest is launched with `--experimental-vm-modules`; frontend tests use Vitest. Do not run every test file through Jest merely because the failure report mentions Jest.

## 2. Install only with the correct runtime

After reviewing the branch, lockfiles, npm configuration and package boundaries, use the repository's intended clean install in order:

```powershell
npm ci
npm --prefix backend ci
npm --prefix frontend ci
```

If a workspace/package lock design requires a different install sequence, follow that verified configuration instead; do not run overlapping installs that rewrite locks unnecessarily.

## 3. Representative Jest probes (backend-owned only)

Run from the backend directory after confirming these paths belong to this package and the tests are owned by Jest:

```powershell
Set-Location backend
npm test -- --runInBand --runTestsByPath tests/helpers/__tests__/mockLocalStorage.test.cjs
npm test -- --runInBand --runTestsByPath tests/commercial/stage01d/stage01d.behavioralParity.test.cjs
npm test -- --runInBand --runTestsByPath tests/unit/loanWorkflowService.test.cjs
npm test -- --runInBand --runTestsByPath tests/integration/groups.journey.test.js
npm test -- --runInBand --runTestsByPath tests/unit/loan.controller.test.cjs
npm test -- --runInBand --runTestsByPath tests/unit/contribution.controller.test.cjs
npm test -- --runInBand --detectOpenHandles --runTestsByPath tests/integration/groups.journey.test.js
Set-Location ..
```

These commands are probes only. If a path is actually under another package or belongs to Mocha/Vitest/native Node tests, route it to the correct runner instead. Capture complete errors and JSON/log outputs, and build a failure register before making broad edits.

## 4. Required failure clusters from the supplied report

| Cluster | Required investigation before fix | Regression proof |
|---|---|---|
| `tests/helpers/mockLocalStorage.js` parser error near line 1579 | Full parser message/caret, lines 1535–1615, helper export contract and actual runner | Direct parse/load plus storage behavior assertions |
| `require is not defined` | Determine whether the test, source, mock, transform or dependency executes in the wrong module context | Loader/module-map test through the intended package runner |
| `jest is not defined` | Confirm effective `injectGlobals`, file module type and runner ownership | Targeted test imports/uses supported Jest API |
| Missing default exports | Inspect canonical source exports and all consumers; do not create arbitrary defaults | Export contract plus consumer/API regression |
| Empty-suite errors | Determine whether no test registers or import/setup fails before registration | Meaningful assertions or documented helper/other-runner disposition |
| Controller import path errors | Resolve import relative to test and compare with production route imports; check case sensitivity | Assert canonical source module is loaded |
| Jest/Mocha/Vitest overlap | Inventory test APIs, config and intended owner; split non-overlapping runner commands | Manifest plus aggregate CI inclusion proof |
| Duplicate/case-only tests | Compare assertions, formats and coverage before retiring anything | Replacement-coverage evidence and Linux case-sensitivity check |
| Open handles | Locate owning timers, Mongo/Redis clients, sockets, servers, streams, queues and teardown | Diagnostic run exits normally without unexplained handles |

## 5. Focused and aggregate verification order

After each minimal repair, run the smallest relevant test, inspect the diff, then run the affected subsystem. Use existing repository scripts for:

```powershell
npm run check:bootstrap
npm run test:backend
npm run test:frontend
npm run test:e2e
npm run check
npm run test
npm run build
npm run release:gate:strict
```

Only invoke names that still exist in `npm run` output and package scripts. If a script takes arguments through npm, include the correct `--` separator. Record each command's working directory, runtime versions, exit code, executed/discovered/passed/failed/skipped counts, dependencies available, warnings, and evidence path.

## 6. Release integrity

Do not:

- turn a parser/load error into a skipped suite;
- add dummy passing tests or blanket empty-suite allowances;
- weaken security, tenancy, ledger, idempotency or readiness assertions;
- create a default export to conceal a mismatched API contract;
- make `--forceExit` normal test execution;
- treat a clean static gate as a successful integration or production build.

Preserve `TITECH_PLATFORM_TRUTH.md` as the readiness authority. Production approval remains false until the complete evidence gate—including real dependencies, provider/settlement verification, security, legal/privacy review, operations/recovery and pilot evidence—is satisfied.
