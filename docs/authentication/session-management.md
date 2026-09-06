# Session Management

TITech uses short-lived access tokens and persistent opaque refresh sessions.

## Access token

- JWT
- short-lived
- frontend memory only
- used for authenticated API requests
- never persisted in localStorage/sessionStorage

## Refresh token

- opaque random value
- hashed before persistence
- HttpOnly cookie
- rotated on refresh
- revoked on logout
- reuse detection revokes the user's active refresh sessions

## Frontend lifecycle

AuthProvider maintains a session generation counter. Async operations started under an older generation cannot write authentication state after logout or a new login lifecycle.

## Password reset

Successful password reset invalidates active refresh sessions through the existing session mechanism.