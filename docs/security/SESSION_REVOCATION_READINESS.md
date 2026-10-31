# Session Revocation Readiness

**Assessment date:** 31 October 2026. **Status:** SOURCE IMPLEMENTATION PRESENT; integration and multi-browser evidence outstanding.

The inspected canonical controller has `/api/auth/refresh`, `/api/auth/logout` and `/api/auth/logout-all` handlers in `backend/controllers/authController.js`, mounted through `backend/routes/auth.js`. Refresh uses the HttpOnly cookie, hashes the presented value, checks expiry/revocation, starts a MongoDB session transaction for the persistent store and maintains refresh-token family/reuse semantics. Logout attempts to distinguish revocation outcomes; logout-all revokes eligible refresh records and updates user session/security state transactionally in the observed path. `frontend/src/context/AuthContext.jsx` has session generation guards and explicit warning behavior when server revocation cannot be confirmed.

This is source-inspection evidence only. It is not proof of transaction execution, concurrent rotation behavior, socket invalidation, or cross-device logout.

## Required evidence to close

- Use a real replica-set MongoDB test database and execute rotation/rollback tests.
- Test two concurrent refreshes with one old token; prove only one valid transition and family reuse response.
- Test refresh after logout, after logout-all, after suspension and after user security-version changes.
- Test refresh/logout with MongoDB unavailable and confirm no false “server revoked” success.
- Exercise signout across two browser tabs and multiple sessions/devices, including a refresh in flight.
- Verify cookie attributes in supported production-like HTTPS and local development environments without weakening production settings.
- Verify CSRF/Origin controls for cookie-authenticated refresh/logout requests.
- Capture redacted test output without token/cookie values.
