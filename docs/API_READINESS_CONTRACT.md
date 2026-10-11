# TITech API Readiness Contract

**Contract date:** 11 October 2026  
**Canonical path:** `GET /api/v1/ready`  
**Related liveness/health path:** `GET /api/v1/health`

## Readiness response rules

| Condition | HTTP | `status` | `success` |
|---|---:|---|---|
| Readiness evaluator reports `ready: true` | 200 | `ready` | `true` |
| Evaluator absent or structured result does not explicitly set `ready: true` | 503 | `not_ready` | `false` |
| Evaluator returns false | 503 | `not_ready` | `false` |
| Evaluator throws or readiness cannot be evaluated | 503 | `not_ready` | `false` |

Boolean evaluators are retained for compatibility. A structured readiness callback must set `ready: true`; `status: "ready"` alone is not enough.

The JSON body includes a service/application/version identifier, request/correlation identifiers when present and timestamp. Dependency `checks` are reduced to `{ready, critical}` flags; blocker entries are bounded and must be non-secret codes. Credentials, connection strings, raw errors and secret values must never be returned.

## Implementation source

- Route: `backend/routes/index.js`.
- Bootstrap readiness callback: `backend/bootstrap/ApplicationBootstrap.js`.
- Dependency/readiness registration: `backend/bootstrap/infrastructure/index.js` and `backend/bootstrap/readinessState.js`.
- Contract tests: `backend/routes/index.test.js`.

## Consumer rules

The browser must distinguish a TCP/network failure from HTTP 503, other HTTP 5xx, timeout/cancellation and an actual ready response. One shared readiness probe is active at a time; transitions cancel the active request and invalidate its generation. Login submission is gated by a fresh `READY` preflight. Only the canonical readiness probe can transition the frontend to `READY`. A health endpoint responding successfully is not by itself proof that the service can authenticate or perform financial operations.

## Evidence and limitations

The source/static contract verifier passed; the enterprise syntax gate parsed the touched project source. The backend HTTP route has not been exercised against a running process in this environment because the target Node/npm runtime and dependency installation are unavailable. Live HTTP 200/503 behavior must be captured after the clean target-runtime install.
