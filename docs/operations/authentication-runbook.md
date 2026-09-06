# Authentication Operations Runbook

## Login failures

1. Check backend readiness.
2. Check MongoDB connectivity.
3. Check account status.
4. Check authentication rate-limit events.
5. Check request/correlation IDs in logs.
6. Never request or record the user's password or token.

## Refresh failures

Check whether the refresh session is expired, revoked, rotated, or detected as reused. A reuse-detection event is security-sensitive and should be investigated.

## Password reset delivery failures

1. Confirm `FRONTEND_URL` is configured.
2. Confirm email provider configuration.
3. Inspect email-service operational logs using request/correlation IDs.
4. Verify that the reset token was revoked when delivery failed.
5. Never copy a reset token into tickets or logs.

## Session problems after password reset

Successful password reset revokes active refresh sessions. The user should sign in again with the new password.

## Configuration

Authentication secrets, cookie settings, URLs, token expiry, database URLs, and Redis URLs must come from the existing environment/configuration architecture.