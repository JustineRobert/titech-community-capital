# Security assessment — archive-local, source and selected-test scope

## Scope and conclusion

This is a limited source/static and selected-test assessment. It is **not** an independent penetration test, runtime application assessment, threat-model sign-off or production security certification.

## Verified controls

- Existing JWT/refresh-session and centralized application architecture remain the declared target; no second authentication system or browser token store was added in this refresh.
- Static RBAC security gate: PASS.
- Canonical financial static gate: PASS (12 files).
- Runtime import audit: zero missing relative imports and zero mixed-module violations on the canonical financial surface; 208 missing local import candidates remain elsewhere in the backend scan.
- Conflict-marker scan: PASS (4,015 files).
- Strict release gate reports no committed `.env`/private-key artifact in the archive.
- Commercial tests verify maker/checker distinction, RBAC-required approval, tenant-scoped rule resolution, ambiguity rejection, assessment idempotency and fail-closed adapter wiring.
- Inclusive tests verify consent withdrawal, cross-tenant consent behavior, authorization boundaries, private document access and malware scanner fail-closed behavior.
- Live insurance premium processing remains blocked while no canonical premium payment adapter is registered.

## Not verified

- Live login, refresh, logout, session revocation and MFA.
- Runtime RBAC and tenant isolation across real MongoDB records.
- BOLA/IDOR and privilege escalation against running APIs.
- Socket handshake/session expiry, forged room-join events and cross-tenant room attacks.
- Chat attachment security, message moderation and abuse controls.
- Actual rate limits under load.
- Webhook signature verification against real provider requests.
- Independent SAST/DAST, dependency vulnerability scan or penetration test.
- Secret-manager integration and production secret rotation.
- Audit tamper-resistance and backup restore.

## Chat-specific security blockers

Legacy Chat code is not integrated into the canonical route/socket lifecycle. Legacy `room:join` accepts a conversation identifier and joins without a verified conversation membership and tenant check. Message service writes and reads do not include the required tenant predicate. The legacy CommonJS service is incompatible with direct import into the backend ESM scope. These are reasons to keep the routes unmounted, not defects to bypass with a permissive adapter.

## Billing-specific security blockers

The commercial core tests exercise the pricing/assessment layer, but no live billing API or admin screen was found. Subscription/entitlement/invoice/collection operations therefore have not undergone endpoint-level authorization or tenant isolation tests. Revenue posting remains an unproven adapter boundary. Do not enable commercial billing activation or trust frontend-submitted tenant/price authority.

## Recommendations before release

1. Complete canonical Chat ESM service boundaries, apply the same tenant/membership guard to REST and socket operations, and use durable MongoDB persistence before attaching handlers.
2. Implement billing routes/UI only after model, service, RBAC, audit and canonical financial service contracts are verified.
3. Run real runtime BOLA/IDOR, cross-tenant, privilege escalation, webhook, session-revocation and socket forgery tests.
4. Complete independent security assessment, secret rotation, encrypted backup/restore and incident response rehearsal.
5. Keep production approval and all unsupported financial/insurance flags disabled pending authorized evidence.
