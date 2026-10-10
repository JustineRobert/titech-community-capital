# TITech Community Capital — Login/Auth and Theme Change Discovery

**Date:** 2026-10-09  
**Repository source:** uploaded `titech-community-capital-main.zip`  
**Target upstream:** `https://github.com/JustineRobert/titech-community-capital` (`main`)  
**Result classification:** focused engineering remediation; **not Production Approved**.

## 1. Objective and scope

Apply a targeted, repository-truth remediation to the existing browser → readiness → login path. Preserve the existing React/Vite and Express/ESM/Mongoose architecture, current `/api/auth/login`, `/api/auth/register`, `/api/auth/logout`, `/api/auth/refresh` contract, `/api/v1/ready` and `/api/v1/health` endpoints, access-token/session model, refresh-cookie flow, Redis and database controls, tenant context, server-side RBAC, audit, payment, ledger and reconciliation boundaries.

Unrelated feature expansion was intentionally frozen. The change is scoped to connectivity/readiness correctness, login gating, regression coverage, active duplicate runtime files and verification documentation.

## 2. Incident finding: what the observed evidence proves

The captured `net::ERR_CONNECTION_REFUSED` for `GET http://localhost:5000/api/v1/ready` proves that the browser could not establish a connection to a listening HTTP service at that origin/port at the time of the request. That explains `API_UNAVAILABLE` and why authentication bootstrap was deferred. It does **not** prove invalid credentials, a bad user, a tenant-resolution error, an RBAC denial, or a session issuance failure.

Connection-refused alone cannot distinguish among a backend process that failed before binding, a process bound to a different host/port, a port conflict/restart, or a frontend origin pointing at the wrong process. The user's machine-specific startup log and effective runtime configuration are not attached as live evidence, so this delivery does not invent a definitive process-level root cause. Repository documentation already identifies ESM/CJS bootstrap boundaries and readiness/listener ordering as risks to verify on the target runtime.

The chrome-extension message-channel and `chrome-extension://.../AdobeClean-*.otf` warnings are not evidence of a TITech authentication defect. They remain classified as external/environmental unless reproducible in a clean browser profile or traced to TITech-owned code.

## 3. Step-by-step folder/file changes

### Step 1 — `backend/` (delete duplicate active entry points)

| Path | Change | Why |
|---|---|---|
| `backend/PRODUCTION_IMPLEMENTATION_v2.js` | Deleted from active backend root | It is an archived legacy duplicate, not the canonical entry point; its presence contradicted the repository's remediation contract and risks confusing runtime discovery. |
| `backend/app.cjs` | Deleted from active backend root | It duplicates the archived legacy app implementation and is not part of the chosen ESM backend entry path. |
| `backend/` → `.titech-remediation/archive/2026-10-07-legacy-duplicates/` | Retained | Historical versions remain preserved for audit/rollback comparison; they are not active root runtime entry points. |

### Step 2 — `frontend/src/services/runtimeConnectivity.js`

- Added `HTTP_SERVER_ERROR`, `REQUEST_TIMEOUT`, and `REQUEST_CANCELLED` as distinct connectivity states.
- Preserved the existing states and backward-compatible `DEGRADED` alias.
- Added a single-flight readiness probe, propagated an `AbortSignal`, and invalidated active probes on browser online/offline changes.
- Guarded both success and failure results with a generation token so a stale response cannot replace a newer offline/recovery state.
- Added safe subscriber isolation and retained existing listener cleanup/unsubscribe behavior.

### Step 3 — `frontend/src/services/api.js`

- Kept the existing endpoint paths and API base-URL resolver; no parallel authentication API or V2 architecture was added.
- Added distinct classification for connection refusal/unavailability, timeout, cancellation, HTTP 5xx, readiness-not-confirmed and authentication errors.
- Passed the abort signal and existing bounded health timeout into health/readiness requests.
- Made low-level health/readiness checks return classified results rather than mutating the shared connectivity state themselves. The shared single-flight probe is the authoritative state writer and can reject stale results.
- Marked health/readiness requests in Axios metadata and excluded those probe requests from generic Axios connectivity side effects; otherwise an interceptor could mutate OFFLINE/READY before the single-flight generation guard could enforce the correct state. Normal successful API responses no longer downgrade an already-READY state, and HTTP 5xx errors receive their own state.
- Enforced a fresh readiness gate in the login service itself: every login submission performs or joins one bounded single-flight readiness check and refuses to send the login POST unless the resulting state is genuinely `READY`. This prevents an old READY value from acting as a stale permit after backend restart/outage.
- Removed the success-path behavior that downgraded a valid `READY` state to merely reachable after login.
- Improved the service-unavailable classifier so the UI/API does not misreport server errors as invalid credentials.

### Step 4 — `frontend/src/pages/Login.jsx`

- Disabled credential submission unless the connectivity state is `READY` and `ready === true`; readiness is not bypassed for degraded or reachable-only states.
- Added state-specific service messaging for offline, unreachable, HTTP server error, timeout, degraded and ready conditions.
- Preserved the existing form/auth context rather than creating another login implementation.
- Kept the retry action explicit and tied it to the shared readiness probe.

### Step 5 — `frontend/src/services/runtimeConnectivity.test.js`

Added regression cases for:

- HTTP 5xx versus transport unavailability;
- timeout and cancellation as distinct states;
- a late successful response not overriding a browser-offline transition;
- successful return to READY after an unavailable state;
- existing single-flight and subscriber behavior.

The repository's configured test runner dependencies are not installed in this delivery environment, so the Jest/Vitest file itself could not be executed here. Equivalent module-level runtime smoke checks were executed directly with Node and passed; see the verification report.

### Step 6 — production environment examples, `docs/` and `reports/`

- Added `backend/.env.production.example` with production-oriented configuration names, externally injected secret placeholders, required MongoDB/Redis configuration, cookie/CORS/CSRF/rate-limit requirements and TLS/proxy guidance. Empty secret and infrastructure URI values are intentional fail-closed placeholders; this template is not deployable as-is.
- Added `frontend/.env.production.example` with a single authoritative API origin, canonical health/readiness paths, bounded timeouts/retries and no localhost/developer-machine origin. Vite variables are public build-time configuration and contain no secrets.
- Updated `docs/API_READINESS_CONTRACT.md` with the frontend state interpretation and single-writer/stale-result rules.
- Appended the 2026-10-09 follow-up and root-cause evidence boundary to `docs/LOGIN_AUTH_REMEDIATION.md`.
- Added `docs/TITECH_LOGIN_AUTH_CHANGE_DISCOVERY_2026-10-09.md` (this file).
- Added `docs/REMEDIATION_VERIFICATION_2026-10-09.md` with checks performed and limitations.
- Refreshed `reports/runtime-import-audit.json` from the repository's import audit command.
- Updated `scripts/verify-login-readiness-remediation.mjs` to assert the new status/cancellation and stale-probe contracts, fail-closed Login UI behavior, Axios probe isolation and production environment template presence.
- Retained the generated `reports/` gate outputs (theme, runtime, RBAC, security, startup, connectivity/import and enterprise master/remediation gates) as point-in-time evidence for this source snapshot.

## 4. Official TITech colors: retained and verified

The uploaded source already includes `branding/TITECH_OFFICIAL_THEME.json`, the brand manifest, the official reference image and transparent logo, semantic CSS tokens, JS token bridge and mobile token layer. Those canonical assets were retained rather than replaced with a second theme system.

The official theme audit passed for all nine colors:

| Token | Official value |
|---|---|
| deepBlue | `#0030A0` |
| electricBlue | `#0058D8` |
| brightBlue | `#0066E8` |
| cyan | `#00B8F8` |
| africaGreen | `#008000` |
| limeGreen | `#A8F000` |
| goldYellow | `#F8D800` |
| navyInk | `#082B67` |
| white | `#FFFFFF` |

Evidence from `node scripts/official-theme-audit.mjs`: audit `PASS`; 57 non-brand frontend CSS files scanned; zero hard-coded official-palette occurrences in those consumer CSS files; root/web/mobile token contracts, light/dark theme contract, logo/reference provenance and web/PWA bootstrap checks passed. The canonical theme includes web, mobile, authentication, dashboards, forms, reports, receipts, onboarding, administration, notifications and marketing coverage. Security/financial state colors remain semantic and may be distinct for risk and accessibility.

## 5. API/authentication/financial architecture preserved

- Existing login/register/logout/refresh contract and readiness/health paths were not renamed.
- No second authentication context, user model, session model or tenant architecture was introduced.
- Existing in-memory-only access-token and HttpOnly refresh-cookie design was retained.
- Server-side tenant authorization and RBAC remain authoritative; frontend readiness is not authorization.
- Redis/session requirements, JWT configuration, audit events, payment/provider lifecycle, `FinancialTransactionService`, double-entry ledger and reconciliation boundaries were not bypassed by this UI/connectivity change.
- No mock production credentials, fake provider success, fake readiness or financial success path was introduced.

## 6. Verification evidence

Source/contract gates that passed in this environment:

- `node scripts/verify-login-readiness-remediation.mjs`
- `node scripts/verify-runtime-contract.mjs`
- `node scripts/verify-auth-contract.mjs`
- `node scripts/verify-api-contract.mjs`
- `node scripts/verify-deployment-contract.mjs`
- `node scripts/official-theme-audit.mjs`
- `node scripts/enterprise-contract-contracts.mjs`
- `node scripts/financial-static-gate.mjs`
- `node scripts/rbac-security-gate.mjs`
- `node --check frontend/src/services/runtimeConnectivity.js`
- `node --check frontend/src/services/api.js`
- direct Node runtime smoke checks for single-flight, 5xx classification, timeout, abort signaling, offline stale-result protection and recovery to READY.

The canonical financial surface audit found zero missing local imports and zero mixed-module violations on that surface. It also warned about 214 missing local imports in legacy/non-critical areas; the warning is not hidden by this remediation.

## 7. What this delivery does not prove

This environment uses Node `22.16.0` and npm `10.9.2`; the repository declares Node `>=24.15.0` and npm `>=11.0.0`. Full dependencies are not installed. MongoDB and Redis are unavailable locally. Accordingly, this package does not claim successful execution of the complete frontend/backend test suites, production build, live login, browser E2E, provider sandbox lifecycle, backup/restore, real tenant isolation against live data, independent security review or a real institutional pilot.

The production origin gate remains blocked until a real staging/production API origin and secret-free deployment settings are provided. MTN/Airtel/bank integration is not certified by static source checks.

## 8. Machine-readable remediation manifest

`reports/titech-login-auth-remediation-2026-10-09.json` records the incident evidence boundary, exact file inventory, official palette, validation commands, residual risks and release decision. It explicitly keeps `productionApproved` false while external/runtime gates remain open.

## 9. Release decision

**Status: focused code remediation and static verification completed; production approval remains blocked by runtime and external evidence.**

The uploaded incident can be resolved only as far as repository-level correctness in this environment. On the user's actual machine, verify the backend startup log, effective bind host/port, `/api/v1/ready` response, database/Redis dependencies and a real protected-resource flow under Node 24.15+/npm 11+ before calling the original incident fully remediated or the platform production approved.
