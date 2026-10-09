# TITech Community Capital — Authentication Runtime Flow

## Canonical healthy path

```text
Browser
  ↓
frontend/src/main.jsx / providers / router
  ↓
canonical API-origin resolution
  ↓
shared runtime connectivity state
  ↓
GET /api/v1/ready
  ↓
Express route registry
  ↓
application.locals.titechReadiness
  ↓
BootstrapContext + database readiness
  ↓
Login becomes operational
  ↓
POST /api/auth/login
  ↓
canonical auth route/controller
  ↓
credential verification
  ↓
account-status validation
  ↓
tenant context + role/permission resolution
  ↓
short-lived access token + HttpOnly refresh cookie
  ↓
frontend AUTHENTICATED state
  ↓
tenant/RBAC context
  ↓
protected resource request
```

## Recovery path

```text
READY
  ↓
backend outage
  ↓
connection/timeout classification
  ↓
API_UNAVAILABLE or degraded/checking state
  ↓
single-flight bounded retry with cancellation
  ↓
backend recovery
  ↓
GET /api/v1/ready = 200
  ↓
authentication can resume without a forced authentication bypass
```

## Session path

```text
login
  ↓
authenticated
  ↓
protected requests
  ↓
401 / access expiry
  ↓
single-flight refresh
  ↓
new access token + rotated refresh session
  ↓
continued authenticated state
```

On refresh failure:

```text
refresh rejected
  ↓
no infinite refresh loop
  ↓
session-expired state
  ↓
login required
```

Logout is a real authentication operation:

```text
logout
  ↓
server-side refresh-session revocation where applicable
  ↓
refresh cookie cleared
  ↓
frontend auth state cleared
  ↓
protected request rejected afterwards
```

## Authorization path

The server is authoritative for:

```text
user identity
↓
tenant identity
↓
role
↓
permission
↓
resource scope
```

A frontend-supplied tenant ID, role or permission cannot override server-side authorization. Cross-tenant access must be denied by the backend regardless of client state.
