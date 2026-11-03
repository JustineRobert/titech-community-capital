# TITech Capital LTD — Change Discovery (19 October 2026)

**Product:** TITech Community Capital  
**Source baseline:** uploaded repository ZIP from 18 October 2026; live remote was unreachable.  
**Decision:** `NOT READY — BLOCKED`; see `docs/reports/TITech_Capital_LTD_USSD_Offline_Inclusive_Onboarding_Implementation_Report_2026-10-19.md`.

## Step-by-step discovery

1. Confirm the supplied snapshot is the editable source; do not claim the GitHub remote was modified. The archive did not contain `.git`, and DNS lookup for `github.com` failed in this execution environment.
2. Confirm Node ESM is the backend convention (`backend/package.json` declares `type: module`). The selected offline models/services contained CommonJS module boundaries.
3. Trace `frontend/src/hooks/useOfflineSync.js` and `frontend/public/sw.js` against the route registry and offline router. Align the canonical client path to `/api/v1/offline/sync` and status to `/api/v1/offline/sync/status`.
4. Trace tenant establishment through the canonical authenticated, tenant-authorized route registry. Make `X-Tenant-ID` a consistency assertion, never the source of tenant authority.
5. Trace the sync controller payload into `OfflineSyncService.synchronize`. Include required tenant/device/idempotency fields; avoid sending the raw Express request into domain code; only pass the device secret transiently to the canonical device verification call and strip credentials before event processing.
6. Run the canonical monetary decimal tests as a correctness check. The run found leading-zero decimal strings were rejected before the intended normalization step, while the antisymmetry assertion treated `0` and `-0` as different; corrected the regex and assertion without permitting negative values or binary floating-point money.
7. Require feature flags, `offline:sync:submit`, registered device authentication, and an explicit green readiness contract. Health/readiness cannot report ready if collaborators are missing or only the HTTP listener exists.
8. Verify browser/server hash conformance over the current v1 envelope and add executable test vectors. Keep per-event public-key verification as a mandatory, currently unsatisfied readiness prerequisite.
9. Require the financial service to demonstrate atomic financial event persistence, receipt persistence and durable idempotency reservation. Keep sync disabled rather than falling back to non-atomic writes or a mock provider.
10. Preserve inclusive identity/insurer onboarding and official colors; rerun its policy suite and official-theme audit.
11. Produce report, API contract, threat model and operations runbook with explicit external/runtime limitations.

## File-by-file list

- `backend/services/financial/money.js`
- `backend/tests/unit/financial/money.test.js`

The full path-by-path baseline and updated SHA-256 index is `TITech_Capital_LTD_File_Change_Index_2026-10-19.csv`. It has one row per added/modified/removed source or evidence artifact (33 changed paths at generation time, 14 added, 19 modified, no removals). The index omits its own hash to avoid a self-referential checksum. The full changed-path list and rationale appears in the implementation report. The main changed paths are:

- `backend/modules/offline/models/OfflineDevice.js`
- `backend/modules/offline/models/OfflineEvent.js`
- `backend/modules/offline/services/offlineDeviceService.js`
- `backend/modules/offline/services/offlineReceiptService.js`
- `backend/modules/offline/services/offlineSyncService.js`
- `backend/modules/offline/controllers/offlineSyncController.js`
- `backend/modules/offline/routes/offline-sync.routes.js`
- `backend/routes/index.js`
- `backend/middleware/platformPermissions.js`
- `frontend/src/hooks/useOfflineSync.js`
- `frontend/public/sw.js`
- `backend/.env.example`
- `backend/.env.production.example`
- `frontend/.env.production.example`
- `reports/implementation-validation-2026-10-19.log` and refreshed output artifacts in `reports/` (theme, RBAC, runtime-import, frontend-runtime, i18n, release, hosting and implementation-gate evidence)
- `backend/tests/unit/inclusive-onboarding/offline-contract.test.mjs`
- `docs/api/offline-sync.md`
- `docs/api/ussd-integration.md`
- `docs/architecture/offline-event-integrity.md`
- `docs/security/ussd-offline-threat-model.md`
- `docs/runbooks/ussd-offline-operations.md`
- `docs/reports/TITech_Capital_LTD_USSD_Offline_Inclusive_Onboarding_Implementation_Report_2026-10-19.md`

## Current proof

- Offline focused test: 6/6 passed.
- Inclusive onboarding policy/static suite: 21/21 passed.
- Official theme audit: PASS.
- Canonical financial decimal unit suite: PASS — 11/11, including leading-zero normalization and invalid input checks.
- Enterprise contracts, financial static, RBAC, syntax, frontend runtime, i18n, and hosting gates passed; `reports/runtime-import-audit.json` records 209 non-critical legacy import gaps.
- Strict release gate is BLOCKED by Node 22.16.0 vs required 24.15.0; production approval gate is BLOCKED because protected approval evidence is absent.
- JavaScript syntax checks for modified backend routing/controller/services: PASS.
- Full install/build/runtime, MongoDB/Redis/browser E2E, provider sandbox, independent security and production approval: BLOCKED / NOT RUN.

The change does not claim enterprise-production readiness or external regulatory/partner approval.
