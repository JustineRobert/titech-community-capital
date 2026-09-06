# Login / Sign In

## Endpoint

`POST /api/auth/login`

## Request

```json
{
  "email": "member@example.com",
  "password": "StrongPassword123!"
}
```

Optional device metadata may be supplied using the existing `deviceInfo` contract.

## Success

The existing controller returns a short-lived access token plus a safe user profile. The refresh token is delivered using the HttpOnly refresh cookie.

## Failure behavior

Malformed requests are rejected by validation. Invalid credentials do not expose whether a matching account exists. Disabled, suspended, and locked account handling remains enforced by the existing account-status policy.

## Frontend

`AuthProvider.login()` calls the central API client. It clears stale session state before beginning a new login lifecycle and ignores stale asynchronous operations from previous sessions.