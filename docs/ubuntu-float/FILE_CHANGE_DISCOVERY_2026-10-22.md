# UbuntuFloat file/folder change discovery — 22 October 2026

## Folders created

- `backend/modules/ubuntu-float/` — additive backend domain boundary, controllers, persistence models, routes, pure domain rules, capability descriptor and native tests.
- `frontend/src/pages/ubuntu-float/` — protected read-only capability dashboard and official-theme-token styling.
- `docs/ubuntu-float/` — implementation status, file discovery, archive comparison index and command/evidence record.
- `.titech-remediation/ubuntu-float-execution-2026-10-22/` — captured stdout/stderr and machine-readable exit codes for the actual validation commands.

## Files added

| File | Change and purpose |
|---|---|
| `backend/modules/ubuntu-float/domain/ubuntuFloatRules.js` | Exact integer amount guards, currency normalization, agent hierarchy rules and explicit notice acknowledgement. |
| `backend/modules/ubuntu-float/domain/capabilities.js` | Server-reported feature status with hard-disabled live funds movement. |
| `backend/modules/ubuntu-float/models/UbuntuFloatAgent.js` | Tenant-scoped agent hierarchy record; new records are pending verification. |
| `backend/modules/ubuntu-float/models/UbuntuFloatPositionObservation.js` | Provider-associated observation that stays `UNVERIFIED` and cannot be used for settlement. |
| `backend/modules/ubuntu-float/models/UbuntuFloatAdvanceApplication.js` | Tenant/applicant-scoped advance application record; not a loan account or disbursement. |
| `backend/modules/ubuntu-float/services/ubuntuFloatService.js` | Tenant-aware domain operations and audited transaction boundaries. |
| `backend/modules/ubuntu-float/controllers/ubuntuFloatController.js` | HTTP adaptation, safe errors, request/correlation IDs and trusted context extraction. |
| `backend/modules/ubuntu-float/ubuntuFloat.routes.js` | Action-authorized routes and fail-closed feature gates. |
| `backend/modules/ubuntu-float/index.js` | Stable public exports of the domain contract. |
| `backend/modules/ubuntu-float/tests/ubuntuFloatRules.test.js` | Native Node test suite for deterministic domain invariants. |
| `backend/modules/ubuntu-float/tests/ubuntuFloatPermissions.test.js` | Tests narrow permission grants for applicants and operator roles. |
| `backend/modules/ubuntu-float/tests/ubuntuFloatSecurityContract.test.js` | Tests that the route registry stays authenticated/tenant-scoped and exposes no live money-movement mutation endpoints. |
| `frontend/src/pages/ubuntu-float/UbuntuFloatPage.jsx` | Authenticated capability dashboard that consumes server status. |
| `frontend/src/pages/ubuntu-float/UbuntuFloatPage.css` | Responsive styles using official TITech semantic tokens only. |
| `docs/ubuntu-float/UBUNTFLOAT_IMPLEMENTATION_STATUS_2026-10-22.md` | Scope, evidence boundary, current status and release gates. |
| `docs/ubuntu-float/FILE_CHANGE_DISCOVERY_2026-10-22.md` | This step-by-step file map. |
| `docs/ubuntu-float/TEST_EVIDENCE_2026-10-22.md` | Actual commands, exits, test counts, warnings and unproven areas. |
| `docs/ubuntu-float/ARCHIVE_CHANGE_INDEX_2026-10-22.csv` | SHA-256/byte-size inventory comparing this working tree with the supplied archive (excluding generated build output and ignored root `reports/`). |
| `.titech-remediation/ubuntu-float-execution-2026-10-22/results.json` and `01-*.txt`–`17-*.txt` | Machine-readable command status and retained command logs for reproducibility. |

## Existing files modified

| File | Change and purpose |
|---|---|
| `backend/routes/index.js` | Imports and mounts UbuntuFloat within the existing authenticated, tenant-authorized `/api/v1` route registry. |
| `backend/middleware/platformPermissions.js` | Adds narrowly scoped read/agent/application permissions to existing role maps; applicant roles receive only self-scoped application permissions, not approval or disbursement rights. |
| `backend/modules/audit/audit.service.js` | Adds optional MongoDB session support so an audit append can participate in the same transaction as an UbuntuFloat record create. Existing non-session callers retain the original behavior. |
| `backend/.env.example` | Adds false-by-default UbuntuFloat feature flags and an unconfigured notice-version value. |
| `backend/.env.production.example` | Restores a safe, secret-free production template with MongoDB/Redis TLS endpoint placeholders and UbuntuFloat gates off. |
| `frontend/.env.production.example` | Restores a browser-safe same-origin API/health/readiness/socket configuration template with no secrets. |
| `package.json` | Adds `test:ubuntu-float` and runs it in the existing CI native-test sequence. |
| `frontend/src/routes/AppRoutes.jsx` | Adds the protected `/ubuntu-float` route using the existing lazy-route pattern. |
| `frontend/src/layouts/AdminLayout.jsx` | Adds UbuntuFloat to the existing sidebar and uses an existing Lucide icon family. |
| `PRODUCT_POSITIONING.md` | Adds the provisional UbuntuFloat product positioning and explicitly keeps TITech Community Capital as the platform identity. |
| `README.md` | Documents the UbuntuFloat foundation, API route, official theme reuse, feature gates, and open proof requirements. |

## Step-by-step discovery in a local checkout

From the repository root, run:

```bash
git status --short
git diff --stat
git diff -- backend/routes/index.js backend/middleware/platformPermissions.js backend/modules/audit/audit.service.js backend/.env.example package.json frontend/src/routes/AppRoutes.jsx frontend/src/layouts/AdminLayout.jsx PRODUCT_POSITIONING.md README.md
find backend/modules/ubuntu-float frontend/src/pages/ubuntu-float docs/ubuntu-float -type f -print | sort
cat docs/ubuntu-float/ARCHIVE_CHANGE_INDEX_2026-10-22.csv
```

The supplied ZIP does not contain `.git`, so those Git commands can only provide authoritative changes after the ZIP is placed in or compared against a local Git checkout. The CSV index is the byte/hash-based archive comparison: 37 added and 9 modified paths relative to the supplied ZIP, with no deletions among the indexed source and evidence paths. The index excludes itself to avoid a recursive self-hash; therefore the index file is an additional generated artifact not self-listed. The tables above are the human-readable change inventory, not a fabricated Git diff. A portable unified source patch is supplied separately with the delivery artifacts.

## Architecture preservation

No second authentication system, user/tenant implementation, RBAC engine, ledger, balance store, payment provider abstraction, refresh-token system, or reconciliation engine was introduced. No existing payment adapter was treated as proof of direct agent e-float functionality. The feature page uses the existing API client and official TITech semantic design tokens.
