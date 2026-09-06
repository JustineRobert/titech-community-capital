# Authentication Architecture

## Architectural preservation

Authentication is implemented inside the existing TITech Community Capital architecture. The remediation does not replace Express, React, MongoDB, Redis, JWT, refresh-token persistence, RBAC, or the existing configuration/observability layers.

## Runtime composition

```text
server.js
  -> ApplicationBootstrap
     -> route bootstrap
        -> backend/routes/index.js
           -> /api/auth -> backend/routes/auth.js
           -> /api/email -> backend/routes/email.js
           -> existing financial/application routes
```

The route registry is the single application route-composition boundary. Authentication routers retain ownership of authentication-specific validation, throttling, and controller orchestration.

## Authentication state

```text
Browser
  |
  +-- access token: memory only
  |
  +-- refresh token: HttpOnly cookie
  |
  v
AuthProvider
  |
  v
central Axios API client
  |
  v
Express authentication routes
  |
  +-- validation
  +-- rate limits
  +-- controller
  +-- service/model
```

## Password reset

```text
Forgot password request
  -> generic response
  -> secure random token
  -> SHA-256 token hash persisted
  -> reset URL emailed
  -> user opens reset URL
  -> token identifies reset record
  -> atomic token consumption
  -> password update
  -> other reset tokens revoked
  -> active refresh sessions revoked
  -> user signs in with new password
```

The reset URL contains the opaque token only. A client-controlled user ID is not part of the reset credential.

## Production requirement

MongoDB transactions are required for the production password-reset path by default. The password-reset service has an explicit controlled non-transaction path for test environments where standalone MongoDB cannot support transactions.