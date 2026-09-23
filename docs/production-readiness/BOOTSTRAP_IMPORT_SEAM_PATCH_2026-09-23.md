# TITech Community Capital — Bootstrap Import Seam Patch — 2026-09-23

## Baseline

This patch is applied to:

`titech-community-capital-enterprise-production-2026-09-23.zip`

The patch is deliberately narrow. It fixes a verified ESM/CommonJS initialization-order defect without redesigning the bootstrap, route, payment, ledger, tenancy, or transaction architecture.

## Verified defect

`backend/bootstrap/observability.js` evaluated:

```js
require('./startupErrors.js');
```

before:

```js
const require = createRequire(import.meta.url);
```

Under the repository's ESM package boundary, that ordering can trigger the exact TDZ failure:

`ReferenceError: Cannot access 'require' before initialization`

This was a real defect in the previously generated enterprise archive and is now corrected.

## Step-by-step changes

### 1. `backend/bootstrap/observability.js`

**Change type:** Runtime/import correctness.

**Before:** `require('./startupErrors.js')` executed before the `createRequire()` binding was initialized.

**After:** the file imports `createRequire`, initializes the compatibility `require` function, and only then loads the legacy CommonJS startup-error and canonical observability modules.

**Architectural impact:** none beyond restoring the intended ESM-to-CJS compatibility boundary already documented by the module.

### 2. `backend/tests/bootstrap/bootstrap-seam-regression.test.mjs`

**Change type:** Regression coverage.

Adds dependency-free Node test coverage for:

- observability `createRequire()` initialization order;
- resilience CommonJS fallback initialization order;
- preservation of nested route import/load errors by `bootstrap/routes.js`.

The test uses only Node built-ins so it can run even when project dependencies are unavailable.

### 3. `backend/package.json`

**Change type:** Test/release tooling.

Adds:

```text
npm run test:bootstrap:seams
```

which executes the new Node-native regression suite.

### 4. `package.json`

**Change type:** Quality-gate wiring.

Adds the root `test:bootstrap:seams` proxy and includes the seam regression suite in the normal root `check` sequence after architecture-debt validation and before the Golden Money Path proof.

No existing dependency, framework, or runtime script was replaced.

### 5. `reports/architecture-debt-audit.json`

**Change type:** Regenerated evidence timestamp.

The audit was rerun after the patch. Counts remain:

- source files scanned: 2,154
- zero-byte source files: 278
- critical financial zero-byte files: 0
- repository-wide missing local imports: 341

### 6. `reports/evidence/golden-money-path-proof.json`

**Change type:** Regenerated evidence timestamp.

The deterministic Golden Money Path proof was rerun and remains PASS.

### 7. `reports/runtime-import-audit.json`

**Change type:** Regenerated evidence timestamp.

The runtime-import audit was rerun and remains PASS for the canonical financial surface, with the pre-existing 341 repository-wide non-canonical missing-local-import findings still recorded.

### 8. `reports/release-readiness.json`

**Change type:** Regenerated evidence timestamp.

The audit-mode release gate remains PASS with the same explicit repository-wide debt warnings.

### 9. `reports/evidence/bootstrap-seam-regression.json`

**Change type:** New machine-readable evidence.

Records the exact dependency-free seam regression results for this patch.

## Exact patch inventory

Compared with the baseline archive `titech-community-capital-enterprise-production-2026-09-23.zip`:

**Added (3)**

- `backend/tests/bootstrap/bootstrap-seam-regression.test.mjs`
- `docs/production-readiness/BOOTSTRAP_IMPORT_SEAM_PATCH_2026-09-23.md`
- `reports/evidence/bootstrap-seam-regression.json`

**Modified (8)**

- `TITECH_PLATFORM_TRUTH.md`
- `package.json`
- `backend/bootstrap/observability.js`
- `backend/package.json`
- `reports/architecture-debt-audit.json`
- `reports/evidence/golden-money-path-proof.json`
- `reports/release-readiness.json`
- `reports/runtime-import-audit.json`

**Removed (0)**

No files were removed in this patch.

## Files intentionally not changed

The following were inspected but not redesigned:

- `backend/bootstrap/resilience.js`
- `backend/bootstrap/routes.js`
- `backend/routes/index.js`
- payment provider adapters and callback paths
- transaction orchestration and ledger modules
- tenancy/security boundaries

No duplicate payment/ledger/transaction architecture was introduced.

## Validation actually performed

| Validation | Result |
|---|---|
| Enterprise syntax gate | PASS — 2,153 executable JS/TS-family files parsed |
| Backend bootstrap syntax | PASS |
| Bootstrap require-order audit | PASS — 0 violations found |
| Bootstrap seam regression tests | PASS — 3/3 |
| Route/bootstrap JS parse scan | PASS — 76 files |
| Canonical financial static gate | PASS |
| Canonical financial runtime-import surface | PASS — 0 missing imports / 0 mixed-module violations |
| Golden Money Path reference proof | PASS |
| Enterprise product gate | PASS with 1,374 legacy CommonJS-compatible candidates warned |
| Release-readiness audit | PASS with repository-wide warnings |

## Important limitations

Full dependency-backed runtime startup was not claimed in this environment because:

- the available runtime is Node `22.16.0` / npm `10.9.2`;
- the repository requires Node `24.15.0` / npm `11.x`;
- dependency installation is unavailable offline (`npm ci --offline` failed on uncached `zxcvbn`);
- therefore full Jest, ESLint, Prettier and live MongoDB/Redis/provider integration were not executable here.

The patch therefore proves the original import-order defect is corrected at source level and that the regression is guarded, but it does not constitute production approval.

## Live repository note

The supplied GitHub repository remains the intended design reference. A fresh network fetch of GitHub was unavailable from this execution environment, so this patch does not claim a new live-repository synchronization or push.


Machine-readable file-by-file inventory: `reports/production-readiness/THIS_PATCH_FILE_MANIFEST.csv`.
