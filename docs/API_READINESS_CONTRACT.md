# TITech Community Capital — API Readiness Contract

## Endpoint

`GET /api/v1/ready`

## Semantics

**Liveness** asks whether the process is able to answer requests.  
**Readiness** asks whether the service is operationally capable of serving the requests it claims to support.

A service may therefore be alive but not ready.

## Ready response

HTTP `200` is reserved for genuine readiness:

```json
{
  "success": true,
  "status": "ready",
  "service": "titech-community-capital-backend",
  "version": "...",
  "requestId": "...",
  "correlationId": "...",
  "timestamp": "..."
}
```

## Not-ready response

HTTP `503` is used when the application has not established the required readiness contract:

```json
{
  "success": false,
  "status": "not_ready",
  "blockers": ["database_not_ready"],
  "checks": {
    "database": { "ready": false, "critical": true }
  },
  "timestamp": "..."
}
```

Only safe operational information is exposed. Credentials, secrets, database URLs, Redis URLs, raw error stacks and internal implementation details are excluded.

## Current implementation contract

- No readiness callback wired → `not_ready`.
- Readiness evaluator throws → `503`.
- Database required but missing/unready → `503`.
- Bootstrap context not READY → `503`.
- Genuine READY state → `200`.
- HTTP listener may bind before final application READY so orchestration can observe `503` rather than `ECONNREFUSED`.

## Frontend interpretation

The frontend distinguishes at least:

```text
CHECKING
API_UNAVAILABLE
DEGRADED
READY
REQUEST_TIMEOUT
REQUEST_CANCELLED
```

A transport/readiness failure is not treated as invalid credentials and must not trigger automatic credential replay.

## Prohibited behavior

```text
ready=true while required authentication storage is broken
HTTP 200 used to hide a dependency failure
wildcard credentialed CORS
production localhost API configuration
unbounded readiness polling
multiple independent readiness probes for the same purpose
```

## Browser state interpretation — 2026-10-09 follow-up

The canonical frontend connectivity state machine additionally distinguishes:

- `API_UNAVAILABLE`: no HTTP response was received (for example, connection refused).
- `OFFLINE`: the browser reports that the device is offline.
- `API_DEGRADED`: an HTTP response was received but readiness was not confirmed; HTTP 503 is not login permission.
- `HTTP_SERVER_ERROR`: an HTTP 5xx error other than the readiness-specific 503 was returned.
- `REQUEST_TIMEOUT`: the readiness request exceeded its bounded timeout.
- `REQUEST_CANCELLED`: a probe was cancelled and must not be interpreted as a successful check.
- `API_REACHABLE`: the HTTP service responded, but readiness was not established.
- `READY`: the canonical readiness endpoint returned a successful response whose `status` value is `ready`.

A single-flight readiness probe owns the state transition. The low-level API request classifier returns result metadata without mutating shared connectivity state. An online/offline event cancels and invalidates the in-flight probe, so an old response cannot overwrite the newer browser/network state. A login call that reaches the API service directly performs one bounded readiness probe and refuses to send credentials unless the resulting state is genuinely `READY`.

These states describe frontend transport/readiness observations; they do not certify database, Redis, credential store, JWT, refresh-token, tenancy, RBAC, or financial operations unless those are represented by the backend's actual readiness checks and separately verified.
