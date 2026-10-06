# TITech Authentication Operations

## Request flow

```text
Login UI
  -> runtime connectivity state
  -> POST /api/auth/login
  -> validation / rate limit
  -> authentication service
  -> user/account status
  -> tenant/RBAC context
  -> access token in memory
  -> HttpOnly refresh cookie
  -> authenticated application state
```

Transport and authentication errors are intentionally separate.

| Category | Meaning |
| --- | --- |
| `AUTH_API_UNAVAILABLE` | The API could not be reached. |
| `AUTH_API_TIMEOUT` | The authentication request timed out. |
| `AUTH_API_NOT_READY` | The API answered but reported degraded/not-ready state. |
| `AUTH_INVALID_CREDENTIALS` | Backend returned `401`. |
| `AUTH_FORBIDDEN` | Backend returned `403`. |
| `AUTH_ACCOUNT_LOCKED` | Backend returned `423`. |
| `AUTH_RATE_LIMITED` | Backend returned `429`. |
| `AUTH_SERVER_ERROR` | Backend returned `5xx`. |

Client-side login attempt lockout counts only authoritative credential failures. Network outages, timeouts, readiness degradation and server failures never consume the credential attempt budget.

## Token security

Access tokens remain memory-only. Refresh tokens remain backend-owned in an HttpOnly cookie. Browser JavaScript does not read or persist refresh tokens.

Authentication request metadata uses request/correlation/device/client-version headers but never logs credentials, tokens, cookies or passwords.

## Session recovery

A temporary API outage must not force a false logout. Authentication bootstrap may defer session restoration until the API is reachable again. A confirmed `401/403` remains authoritative for invalidation according to the existing AuthContext lifecycle.
