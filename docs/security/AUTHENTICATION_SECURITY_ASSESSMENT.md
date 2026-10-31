# Authentication Security Assessment — Source Baseline

**Assessment date:** 31 October 2026. **Status:** NOT SECURITY APPROVED.

## Positive controls observed

- Unverified-account login rejection is explicit (`403 EMAIL_VERIFICATION_REQUIRED`) in `backend/controllers/authController.js`.
- Refresh cookie is `HttpOnly`, scoped to `/api/auth`, and `Secure` in production.
- Refresh token hashes and family/reuse handling exist in `backend/models/RefreshToken.js` and auth controller logic.
- Refresh rotation requires transaction support in the persistent MongoDB path.
- `frontend/src/context/AuthContext.jsx` includes lifecycle-generation guards designed to prevent stale refresh completion from reauthenticating after logout.
- RBAC static gate and canonical financial static gate were executed separately (see release evidence report).

## Material open risks / missing evidence

- Invitation usage and user creation have now been moved into one MongoDB transaction in the canonical handler. Replica-set integration/concurrency proof has not been executed, and legal acceptance/outbox writes are not yet included in the transaction.
- Frontend registration no longer persists or attaches any access token returned by the register endpoint; a response containing one is surfaced as a policy violation, but backend contract tests/browser proof remain outstanding.
- Canonical legal acceptance persistence is absent from the inspected register handler and its integration-ready constant is false.
- Durable email outbox atomicity, production mail transport, and recipient delivery are not demonstrated. The verification page now includes a resend-request form, but the interaction has only been syntax-parsed and provider delivery is not demonstrated.
- No supported-runtime complete backend/frontend build or browser E2E ran in this environment.
- MongoDB replica-set concurrent-refresh proof, Redis failure/recovery, session revocation across browser tabs/devices, CSRF/Origin validation, socket revocation, and cross-tenant negative tests remain unproven.
- Independent application penetration testing and external approval remain outstanding.

## Required test cases

Exercise malformed/expired JWT, missing credentials, unverified/suspended/disabled users, password spraying and invitation guessing controls, token replay, concurrent refresh, logout in flight, logout-all, database outage, CSRF/Origin violations, role escalation, cross-tenant read/write/export, unauthorized socket subscription and safe error/log redaction. Do not interpret a static gate pass as penetration-test approval.
