# Authentication Platform Truth — 31 October 2026

**Source:** supplied repository archive; static inspection only.  
**Release decision:** `NOT READY`; production approval remains disabled.

## Canonical path observed

- Frontend authentication context: `frontend/src/context/AuthContext.jsx`; `frontend/src/routes/AppRoutes.jsx` imports `useAuth` from this context. The context includes in-memory access-token lifecycle, a refresh single-flight guard, session-generation guards and local signout behavior.
- API client: `frontend/src/services/api.js`.
- Canonical backend auth routes: `backend/routes/auth.js`; `backend/routes/index.js` imports and mounts these routes under `/api/auth`.
- Canonical backend controller: `backend/controllers/authController.js`.
- User/session data models: `backend/models/User.js` and `backend/models/RefreshToken.js`.
- Tenant invitation model: `backend/models/TenantInvitation.js`.
- Email verification route/controller: `backend/routes/email.js` and `backend/controllers/emailController.js`.
- Login explicitly rejects `user.isVerified === false` with `403 EMAIL_VERIFICATION_REQUIRED`.
- Refresh rotation opens a MongoDB session/transaction and raises an explicit `AUTH_TRANSACTION_UNAVAILABLE` error when MongoDB transaction support is absent. Refresh token persistence uses a hash; rotation/reuse checks and session-family metadata exist in source.
- Refresh cookies are HttpOnly and use the `/api/auth` path. `Secure` is enabled in production, and `SameSite` is environment-dependent (`Strict` in production, `Lax` otherwise).
- Normal logout and logout-all controller handlers exist in the canonical auth controller/router.

## Confirmed release-blocking findings

1. `backend/controllers/authController.js` defines `CANONICAL_LEGAL_ACCEPTANCE_INTEGRATION_READY = false`. Production registration includes fail-closed legal publication and acceptance gates. This is protective behavior and must not be bypassed.
2. **Remediated at source level in this update:** invitation use and `User.create` now execute in one `User.startSession().withTransaction(...)` operation. Duplicate email and invalid invitation have explicit responses; transaction-unavailable errors fail closed with `503 REGISTRATION_TRANSACTION_UNAVAILABLE`. A replica-set concurrency regression test was added, but not executed here.
3. The registration handler still does not persist separate terms acceptance and privacy acknowledgement records as part of the same transaction. The canonical legal-acceptance readiness constant remains false and production registration stays fail-closed.
4. Registration returns `verificationRequired: true`, while the frontend separately invokes verification-email delivery. The UI now distinguishes `REQUEST_ACCEPTED` from `UNCONFIRMED`, never claims inbox delivery based on HTTP success, provides a resend request, and does not install a registration-response access token or tenant context. A durable transactional outbox and recoverable provider delivery worker remain unestablished.
5. The supplied repository environment in this execution used Node.js 22.16.0 and npm 10.9.2, below the repository's declared Node >=24.15.0/npm >=11 baseline. Dependencies were not installed, so complete frontend/backend suites, full production build and browser E2E were not run.
6. MongoDB replica-set transaction behavior, Redis failure behavior, provider delivery, browser refresh/signout, logout-all across sessions, and cross-tenant denials have not been operationally verified in this execution.

## Evidence classification

| Capability | Source status | Evidence level achieved in this update |
|---|---|---|
| Canonical auth entry points | Identified in source | Source-inspected; not runtime-proven |
| Email verification login guard | Implemented in source | Not integration/E2E proven here |
| Refresh transaction guard | Implemented in source | Not proven against replica-set MongoDB here |
| Legal publication gate | Fail-closed constant and controller condition present | Source-inspected; external approval outstanding |
| Invitation/account atomicity | Single transaction now implemented in source; replica-set integration test added | `IMPLEMENTED`; integration proof remains outstanding |
| Registration session boundary | Frontend API registration no longer persists a returned access token or tenant; context remains anonymous until login | Source change + syntax parsing; backend API contract and browser proof remain outstanding |
| Legal acceptance persistence | Not demonstrated by canonical register handler | Remains a P0 gap |
| Durable email outbox/delivery recovery | Not demonstrated as atomic with registration | Remains a P0 gap |
| Logout/logout-all | Handlers exist | Persistence and cross-session runtime tests outstanding |

The word “implemented” in this table describes inspected source only. It does not imply operational acceptance.
