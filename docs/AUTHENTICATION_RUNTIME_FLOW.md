# Authentication Runtime Flow — Evidence-Based Contract

**Status as of 11 October 2026:** source/static remediation implemented; operationally unverified in the target runtime.

## Existing source path

```text
frontend/index.html
  → frontend/src/main.jsx
  → existing providers/router/AuthContext
  → frontend/src/services/apiConfiguration.js
  → frontend/src/services/api.js
  → frontend/src/services/runtimeConnectivity.js
  → GET /api/v1/ready
  → backend/routes/index.js
  → backend/bootstrap/ApplicationBootstrap.js readiness callback
  → bootstrap lifecycle + database readiness contract
  → existing backend/routes/auth.js mounted at /api/auth
  → backend/controllers/authController.js
  → existing user / refresh-token models and session logic
  → authenticated user / tenant / RBAC middleware
  → protected resource
```

This is the source-inspection flow. Only the route/configuration relationships and static guards were checked here; the whole request path was not exercised against a running backend in this environment.

## API origin and routes

- Existing development origin contract: `VITE_API_URL=http://localhost:5000` in `frontend/.env.example`.
- Production template uses a placeholder HTTPS API origin and does not default to localhost.
- Readiness path: `GET /api/v1/ready`.
- Health path: `GET /api/v1/health` (confirm the exact production reverse-proxy prefix during deployment).
- Existing authentication router: `backend/routes/auth.js`, mounted at `/api/auth`.
- The login contract is preserved; this remediation does not rename it or create an alternate auth API.

## State-safety decisions

- Readiness `200`/`ready` means an evaluator actually returned readiness; missing evaluator, false result, thrown error or a structured result without `ready: true` fails closed.
- Readiness `503`/`not_ready` differs from a transport-level connection refusal or timeout.
- A request that becomes stale due to a newer browser connectivity transition or API observation cannot commit its old result.
- Concurrent readiness/connectivity callers share the existing in-flight promise. Online/offline transitions abort the active request and invalidate its generation; late results cannot overwrite newer state. Distinct timeout, cancellation, HTTP 5xx, HTTP 503/not-ready and network-unavailable states are retained. The Node harness proves this narrow behavior, not a browser-wide request-storm bound.
- Readiness/health HTTP responses are not allowed to set client connectivity state via generic API interceptors; the canonical readiness check classifies them.
- Credential errors are not retried as network/readiness errors. The login submit handler performs a fresh readiness preflight and does not submit credentials unless the shared readiness state is confirmed `READY`.

## Session and authorization contract to verify operationally

The source retains the existing server-side user/password verification and refresh-token model, including opaque refresh token hashing/rotation logic and an HttpOnly refresh cookie scoped to `/api/auth`. Access/refresh contracts and roles must remain as actually defined by current model/middleware; this report does not infer a valid session from HTTP 200 alone.

Required next E2E proof is a real successful login response plus authenticated current-user/protected-resource request, tenant resolution, permissions, browser refresh/refresh-session continuity, successful server-side logout/revocation, and a post-logout protected-resource rejection. A separate cross-tenant attempt must be denied server-side.
