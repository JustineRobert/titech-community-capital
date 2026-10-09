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
