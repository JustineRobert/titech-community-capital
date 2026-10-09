# TITech Community Capital — Login/Auth Runtime Remediation

**Date:** 2026-10-08  
**Baseline:** `titech-community-capital-main(1).zip`  
**Scope:** browser startup → API configuration → connectivity → readiness → login → session → tenant/RBAC → protected resource

## Incident

The observed login symptom is rooted at the service-availability boundary. The browser repeatedly targeted `http://localhost:5000/api/v1/ready` and received `ERR_CONNECTION_REFUSED`, so the frontend correctly deferred authentication instead of pretending credentials were invalid.

Source inspection found several independent startup/readiness hazards capable of producing that condition:

- Critical ESM bootstrap modules were loaded through CommonJS `require()` boundaries even though the backend package is ESM.
- The canonical CJS database/config adapters used ambiguous `.js` names under an ESM package boundary.
- The readiness route could fail open when the application did not wire a readiness callback.
- The HTTP server's pre-listen readiness gate could require final READY before binding the socket, while the application only reaches final READY after the server phase completes.
- JWT access-secret authority was split between `JWT_ACCESS_SECRET` and legacy names.
- Authentication controller fallback could use in-memory user/session state unless explicitly prevented in production.

Historical project evidence also records backend startup failures involving unsafe JWT placeholder configuration and `require is not defined in ES module scope` during bootstrap imports.

## Changes implemented

### Runtime/bootstrap

- Replaced critical `require()` use with native ESM imports in `bootstrap/server.js`, while retaining `createRequire` only for the explicitly optional legacy runtime boundary.
- Restored and preserved the existing TLS/HTTPS handling rather than replacing the server architecture.
- Changed pre-listen readiness gating to verify completed predecessor bootstrap phases. The server can bind the management/readiness endpoint while the application is not ready, allowing `/api/v1/ready` to truthfully return `503` instead of `ECONNREFUSED`.
- Bound `application.locals.titechReadiness` to the canonical `BootstrapContext` and actual database readiness.

### Readiness/API

- `/api/v1/ready` now defaults to not-ready and returns HTTP `503` until readiness is genuinely established.
- Public readiness output is restricted to safe status/check metadata; secrets, connection strings and stack traces are not exposed.
- Database readiness is registered with the existing readiness coordinator.
- Infrastructure adapter discovery resolves from the actual backend repository root and uses the canonical database/Redis boundaries.

### Authentication/session security

- `JWT_ACCESS_SECRET` is the preferred access-token secret throughout the canonical auth path, with legacy aliases retained only for compatibility.
- Production cannot use process-memory authentication fallback.
- Login/register/refresh/logout return a safe `AUTH_STORE_UNAVAILABLE` response when persistent authentication storage is required but unavailable.
- Access credentials remain memory-only on the frontend; refresh/session credentials use the existing credentialed HttpOnly-cookie architecture.
- Existing refresh-token rotation, reuse detection, logout/revocation, tenant resolution and RBAC boundaries were preserved.

### Module boundary repair

- `backend/bootstrap/database.js` → `backend/bootstrap/database.cjs`
- `backend/config/db.js` → `backend/config/db.cjs`
- `backend/config/redis.js` → `backend/config/redis.cjs`
- Direct consumers were updated to use the explicit CJS boundaries.
- Active-root duplicate `backend/PRODUCTION_IMPLEMENTATION_v2.js` and `backend/app.cjs` were removed; archived copies remain in `.titech-remediation/archive/2026-10-07-legacy-duplicates/`.

### Branding

The existing official TITech theme contract remains the single visual authority. The delivery verifies the nine official values across the root theme, web semantic token layer and mobile token layer and retains the supplied transparent logo as a provenance asset.

## Verification performed

Passed source/static checks include:

- `node scripts/verify-login-readiness-remediation.mjs`
- `node scripts/verify-runtime-contract.mjs`
- `node scripts/verify-auth-contract.mjs`
- `node scripts/verify-api-contract.mjs`
- `node scripts/verify-deployment-contract.mjs`
- `node scripts/enterprise-contract-contracts.mjs`
- `node scripts/enterprise-completeness-gate.mjs`
- `node scripts/financial-static-gate.mjs`
- `node scripts/rbac-security-gate.mjs`
- `node scripts/security-static-gate.mjs`
- `node scripts/startup-contract.mjs`
- `node scripts/official-theme-audit.mjs`
- `node scripts/frontend-runtime-audit.mjs`
- `node scripts/runtime-import-audit.mjs`
- `node scripts/titech-enterprise-remediation-gate.mjs`

These are source/contract proofs. They do not substitute for live infrastructure proof.

## Verification boundary

This delivery environment is running Node 22.16.0 and npm 10.9.2, while the repository requires Node 24.15.0+ and npm 11.0.0+. The full dependency tree was not available, MongoDB and Redis were not listening locally, Docker was unavailable, and a real browser E2E session could not be executed here.

Therefore this package is a **remediated engineering delivery with production-gate prerequisites outstanding**, not a declaration of independent production approval.

## Root-cause answer

**What caused the login failure?** The browser could not establish connectivity to the backend on port 5000, so authentication bootstrap remained deferred. The source contains multiple startup defects capable of causing the backend not to become reachable, with ESM/CJS bootstrap loading and readiness/listener coupling being the most direct infrastructure risks identified in this baseline.

**Why did the frontend report `API_UNAVAILABLE`?** Because the readiness request received a connection-refused transport error; that is correctly classified as service unavailability rather than credential rejection.

**Why was `/api/v1/ready` unavailable?** A backend process that fails during bootstrap or never binds its HTTP listener makes the readiness endpoint unreachable. The remediation separates listener availability from final application READY and makes an available-but-not-ready service return truthful `503` status.

**What evidence proves the correction?** The canonical static contracts now pass, the readiness test explicitly covers fail-closed behavior, the active duplicate runtime files are removed, the official-theme audit passes, and the enterprise remediation gate is `PASS_WITH_WARNINGS`. Live Node 24+/MongoDB/Redis/browser evidence remains a required next gate.
