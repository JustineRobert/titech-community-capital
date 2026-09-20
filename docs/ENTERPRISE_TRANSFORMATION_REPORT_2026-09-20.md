# TITech Community Capital — Enterprise Transformation Report

**Date:** 2026-09-20  
**Baseline archive:** `titech-community-capital-main(5).zip`  
**Baseline archive SHA-256:** `9c14d196a042997c669500f83140f3d461052df6d0636cb969326683ce7676fd`  
**Baseline commit:** `273f78768c994362fca646fd0fa820593e6c8a17`  
**Implementation commit:** `5021021f49d0586b7a22a21e319b2dd1d7963def`  
**Repository target:** `https://github.com/JustineRobert/titech-community-capital`

## Executive summary

This delivery applies an incremental enterprise-hardening pass to the uploaded repository rather than
creating a parallel replacement architecture. The changes concentrate on the canonical financial boundary:
ESM/runtime correctness, exact monetary representation, idempotency boundary loading, session validation,
and executable CI gates. Existing repository truth/status documents are preserved and extended rather than
promoted without evidence.

## What was discovered

1. The repository was already an RC-1 remediation tree with broad enterprise structure.
2. The backend is an ESM package (`type: module`) but several canonical financial modules still used
   `createRequire()`, `require()` and `module.exports`, creating a Node 24 runtime-loading risk.
3. `financialTransaction.service.js` validated the `mongoose.startSession` function instead of the created
   MongoDB session object. That boundary would reject a valid session before financial execution.
4. The financial operation layer had its own amount-format validator instead of sharing an exact-money
   primitive.
5. Syntax validation alone did not prove local relative imports resolve at runtime; the canonical financial
   surface needed a dedicated runtime-import audit.
6. The repository did not have a CI-enforced exact-money regression gate tied to the root `check` command.

## Changes applied

### Financial runtime boundary

Converted the canonical financial service/controller/idempotency boundary to native ESM imports/exports,
including explicit `.js` local module specifiers. This removes the mixed-module constructs from the critical
financial surface while retaining named exports and a frozen default module object for compatibility.

### MongoDB session correctness

Fixed financial session validation so the newly created MongoDB session is what gets validated before the
transaction loop starts.

### Exact monetary arithmetic

Added `backend/services/financial/money.js`, a fixed-point BigInt utility for deterministic decimal
validation, normalization, addition, subtraction, comparison, and zero/positive checks. Financial-domain
arithmetic does not use JavaScript floating-point operations in this utility.

Updated `financialOperation.service.js` to use the shared exact-money primitive and reject non-string,
malformed, negative/zero, and over-precision monetary inputs at the operation boundary.

### Runtime import verification

Added `scripts/runtime-import-audit.mjs` and persisted its result in `docs/RUNTIME_IMPORT_AUDIT.json` plus
narrative documentation. The audit records 352 broader legacy/non-critical missing local imports, but the
canonical financial surface has zero missing local imports and zero mixed-module violations.

### Financial static gate

Added `scripts/financial-static-gate.mjs`. It checks canonical financial files for CommonJS leakage,
unsafe money conversion patterns, exact-money primitives/tests, and the known session-validation regression.

### Tests

Added `backend/tests/unit/financial/money.test.js` using Node's built-in test runner. It passes 3/3 tests.

### CI

Updated `.github/workflows/ci.yml` and root/backend package scripts so the financial static gate, runtime
import audit, and exact-money test are part of the repository quality gate.

## File-level traceability

The complete machine-readable and human-readable file index is:

- `docs/CHANGESET_FILE_INDEX_2026-09-20.csv`
- `docs/CHANGESET_FILE_INDEX_2026-09-20.md`
- `CHANGESET_TRACEABILITY_2026-09-20.md`

These identify each changed path, classification, insertions/deletions and content hashes.

## Verification evidence

| Verification | Result |
|---|---|
| Merge-conflict scan | PASS — 2,468 files scanned |
| Enterprise syntax gate | PASS — 2,111 executable JS/TS-family files parsed |
| Financial static gate | PASS — 8 canonical files |
| Canonical runtime-import audit | PASS — 0 missing imports on critical financial surface |
| Exact-money tests | PASS — 3/3 |
| `git diff --check` | PASS |
| Full `npm run check` | BLOCKED at backend ESLint because dependency installation is unavailable |

The local runtime is Node 22.16.0 while the repository declares Node 24.15.0. Full dependency-backed tests,
MongoDB/Redis integration, frontend build, provider sandboxes, SAST/container scans, Kubernetes cluster tests,
and restore drills therefore remain unverified in this environment.

## Remaining production blockers

This archive is **not production-certified**. The repository truth model correctly remains `PRODUCTION_APPROVED: NO`.
Remaining evidence-gated work includes:

- full dependency installation and test execution under Node 24.15.x/npm 11 with registry access;
- resolution/validation of the broader legacy backend runtime-import surface;
- MongoDB/Redis financial invariant and failure-injection tests;
- live or sandbox payment-provider contract/callback/reconciliation tests;
- security/SAST/dependency/container/IaC scans;
- backup and restore execution;
- Kubernetes deployment and resilience validation;
- jurisdiction-specific legal/compliance review and approval.

## Traceability conclusion

The uploaded repository has been materially hardened in the critical financial runtime path without inventing
unverified production capabilities. The updated ZIP is a real transformed copy of the uploaded archive; the
change index, baseline hash, implementation commit, and verification evidence provide the intended audit trail.
