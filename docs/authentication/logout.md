# Logout / Sign Out

## Endpoint

`POST /api/auth/logout`

Logout is intentionally callable without an access token because the access token may already be expired while the refresh session remains active.

## Server behavior

- Hashes the presented refresh credential.
- Revokes the matching refresh-token record when present.
- Clears the HttpOnly refresh cookie.
- Does not revoke unrelated sessions.
- Treats repeated logout safely.

## Frontend behavior

AuthProvider invalidates its session generation before awaiting the API request. This prevents an in-flight refresh or bootstrap request from resurrecting a session after logout.

The frontend then clears:

- access token
- tenant session state
- user state
- refresh timers
- realtime socket state
- authentication errors

## Logout all

`POST /api/auth/logout-all` requires authentication and revokes all active refresh sessions for the current user.