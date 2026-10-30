# Authentication, Session Security and Dashboard Baseline — 30 October 2026

**Product:** TITech Community Capital  
**Organization:** TITech Capital LTD  
**Decision:** `NOT_READY`; `productionApproved=false`  
**Source type:** supplied ZIP snapshot (no `.git` directory)  
**Evidence level:** repository inspection and selected dependency-free tests only

## Active application path inspected

The source tree uses the Vite React entry point (`frontend/src/main.jsx`), application providers (`frontend/src/app/providers.jsx`), canonical `AuthContext` (`frontend/src/context/AuthContext.jsx`), Vite route tree (`frontend/src/routes/AppRoutes.jsx`) and `AdminLayout`. The current active community dashboard is `frontend/src/pages/Dashboard.jsx`; the enterprise admin candidate is `frontend/src/pages/admin/AdminDashboard.jsx`. The latter's presence does not prove that its upstream API metrics are correct or that administrator workflows have been end-to-end validated.

The source contains several similarly named dashboard components and legacy route candidates. They must not be treated as active solely because they exist. The production router must remain the authority for active routes; this change registers `/logout` as a canonical public sign-out operation and `/admin` as an admin-gated entry to the existing enterprise administration dashboard. Only normalized `platform_admin` and `tenant_admin` role aliases are admitted by the frontend guard; backend authorization remains authoritative.

## Authentication changes implemented in this archive

- Added `backend/security/tokenVersionPolicy.js` to require explicit `securityVersion` and `sessionVersion` claims and compare them with the authoritative identity versions.
- Updated `backend/middleware/auth.js` to reject missing/malformed or stale token-version claims after resolving the current persisted identity. The normal protected-request flow requires the identity store; the `NODE_ENV=test` disconnected-store shortcut remains an existing test-only behavior and is not production evidence.
- Updated refresh-token rotation in `backend/controllers/authController.js` to insert the replacement record and conditionally consume the previous refresh record in the same MongoDB transaction. The production path no longer falls back to non-transactional rotation when transaction support is unavailable.
- Updated current-session logout to distinguish confirmed revocation, already-revoked state, missing server-side session record, and persistence-unconfirmed failure. MongoDB failure does not clear the HttpOnly cookie or produce a successful-revocation claim.
- Updated logout-all to revoke persistent refresh records and increment persisted security/session versions within one transaction; the response clears the current cookie only after a successful commit.
- Updated `frontend/src/context/AuthContext.jsx` and `frontend/src/pages/Logout.jsx` to always clear local authenticated state, keep a non-secret pending-revocation marker after an unconfirmed attempt, avoid restoring authentication while the marker persists, and present honest retryable feedback.
- Updated the frontend registration password minimum to 12 characters, consistent with the existing backend user-model/reset validators; the maximum remains governed by the established frontend constant.
- Added `backend/tests/unit/security/token-version-policy.test.mjs` covering current versions, session revocation, security-version changes, missing claims and nested legacy claim shape.

## Dashboard and route changes implemented in this archive

- Kept the existing community dashboard in place and removed the misleading fraud fallback that represented absent data as 100% clean and 0% flagged.
- Dashboard KPI values that are absent, invalid or negative now render as unavailable rather than fabricated zeroes; fraud data uses an explicit unavailable/no-data state.
- Replaced the static “services operational” assertion with a probe using the existing readiness client and visible READY/DEGRADED/NOT_READY/UNAVAILABLE state plus last-check information.
- Normalized dashboard/admin visibility through the existing frontend role-policy utility.
- Registered `/logout` to use the existing canonical logout page and integrated the existing enterprise Administration Center at `/admin`; no second dashboard or auth provider was introduced.
- Protected-route redirect state now preserves local pathname, query and hash, while login rejects absolute/external, protocol-relative and backslash redirect targets.

## Verification status and limitations

This archive was evaluated in Linux x86_64 with Node `v22.16.0` and npm `10.9.2`, both below the repository requirement Node `>=24.15.0`, npm `>=11.0.0`. Root/backend/frontend `node_modules` directories are absent and Docker is unavailable. Therefore the required clean install, dependency-backed lint/build/Jest/Vitest, browser E2E and live database/provider tests were not executed. Static JSX parsing with the globally available TypeScript parser and syntax checks of changed backend modules are reported separately in the dated implementation handoff.

No test in this evidence proves that MongoDB transactions work on a replica set, refresh/logout concurrency works under real database contention, multi-tab browser coordination works in supported browsers, the MTN provider lifecycle settles, all tenant access is isolated at runtime, or the complete dashboard datasets are authoritative. The full legal acceptance workflow is still not established: a registration checkbox is not equivalent to approved, versioned and auditable backend legal acceptance. `APPLICATION_LOCKED` startup root cause remains open until reproduced and tested on the supported runtime.

## Next required work

1. Run all changes on Node `>=24.15.0` / npm `>=11.0.0` with clean committed-lockfile installs.
2. Execute transaction-backed tests against a MongoDB replica set for refresh rotation, reuse, logout-all, invitation/account creation, idempotency, ledger/outbox and restart replay.
3. Add/test HTTP-level logout/refresh concurrency, multi-tab browser E2E and protected-route query/hash restoration.
4. Complete versioned legal acceptance persistence and approved legal publication before enabling production registration.
5. Verify real endpoint authorization, scoped/read-model provenance and full route/API contracts for administration, executive/risk/onboarding/agriculture dashboards.
6. Complete MTN sandbox/status/settlement proof, tenant E2E, independent security review, backup/restore/rollback drills, legal/privacy review and institutional pilot evidence.

**No production, regulatory, partner, commercial or GitHub status is upgraded by this file.**
