# TITech Community Capital — Vercel frontend/backend connectivity

**Product:** TITech Community Capital  
**Organization:** TITECH CAPITAL - SMC LTD  
**Updated:** 14 November 2026

## Why this configuration exists

The production frontend template sets `VITE_API_URL=/api/v1`, which causes the canonical Axios client to use same-origin relative paths. The group-list module also sends JSON API requests to the bare `/groups` path, while browser navigation uses `/groups/:groupId` for the React details page.

The previous `frontend/vercel.json` sent every unmatched request to `/index.html`. It did not provide a backend proxy for `/api/*` and did not distinguish JSON API calls on `/groups` from browser navigation to the SPA route. With the same-origin production template, this configuration could return the frontend HTML document where the client expected JSON, or fail to reach the backend. This source-level configuration mismatch is a credible explanation for network/response failures, but the live Vercel project settings and deployment were not available for verification.

## Implemented source changes

- `frontend/api/[...path].js` is a Vercel Web Handler that forwards `/api/*` requests to a configured backend HTTPS origin.
- It accepts only a server-configured origin; a request cannot choose the upstream host.
- It permits only known HTTP methods and allowlisted request/response headers.
- It preserves Authorization, cookies, content type, request/correlation IDs and idempotency headers where supplied.
- It caps request bodies at 4 MiB.
- It uses a 25-second upstream timeout and returns safe 502/504 errors without leaking the internal backend origin or exception text.
- It preserves response status/content type and forwards `Set-Cookie` while removing an upstream `Domain` attribute so a refresh cookie can be scoped to the browser-facing TITech host. Cookie security attributes remain intact.
- API responses are marked `Cache-Control: no-store`.
- Missing or invalid backend configuration fails closed with HTTP 503.
- `frontend/vercel.json` rewrites `/groups` and `/groups/:path*` to `/api/groups` only when the request `Accept` header identifies JSON. Browser document navigation (HTML Accept) falls through to `/index.html`, preserving React Router deep links.

## Required Vercel project configuration

Set the following in the Vercel project under **Settings → Environment Variables** for every environment that will be used (Production, Preview and Development as applicable):

| Variable | Required value | Exposure |
|---|---|---|
| `TITECH_API_ORIGIN` | The approved backend origin, e.g. `https://api.<approved-domain>` | Server-side only; never prefix with `VITE_` |
| `VITE_API_URL` | `/api/v1` | Browser build configuration |
| `VITE_API_HEALTH_PATH` | `/api/v1/health` | Browser build configuration |
| `VITE_API_READINESS_PATH` | `/api/v1/ready` | Browser build configuration |

`TITECH_API_ORIGIN` must be an HTTPS origin only: no path, username/password, query or fragment. Do not copy credentials into it. The code allows `http://localhost` only in non-production local test/development environments. The real backend hostname must be entered by the deployment owner; no production hostname or secret is embedded in this repository.

Configure the backend's allowed-origin/CSRF policy for the exact approved TITech frontend origin(s) where the backend requires the `Origin` header. Do not use a wildcard origin with credentialed browser requests. Preserve the existing JWT access-token-in-memory and HttpOnly refresh-cookie design. The proxy forwards the request `Origin`; the backend remains responsible for authorization and CSRF controls.

## Routes and expected behavior

| Browser/API path | Expected behavior |
|---|---|
| `GET /api/v1/health` | Proxied to the configured backend; must return backend health JSON, not `index.html` |
| `GET /api/v1/ready` | Proxied to the configured backend readiness endpoint |
| `/api/groups`, `/api/v1/groups` | Routed through the API function to the backend |
| JSON request `/groups` | Rewritten to `/api/groups` before SPA fallback |
| JSON request `/groups/:id/...` | Rewritten to `/api/groups/:id/...` |
| Browser document `/groups/:groupId` | Served by the SPA fallback; React Router renders Group Details |
| WebSocket `/socket.io` | Not handled by this HTTP function; configure and test a separate supported WebSocket endpoint/proxy |

## Deployment verification checklist

1. Confirm the deployment project root is `frontend` so `frontend/api/[...path].js` is detected as a function.
2. Set `TITECH_API_ORIGIN` in the Vercel project environment without making it a `VITE_*` variable.
3. Confirm the backend is reachable from Vercel over HTTPS.
4. Confirm exact frontend origins are accepted by the backend security/CSRF policy as required.
5. Deploy a Preview build first.
6. Request `/api/v1/health` and `/api/v1/ready`; verify JSON from the backend and the expected `X-Request-Id` headers.
7. Test authenticated login/refresh/logout to verify HttpOnly cookie propagation and refresh rotation.
8. Verify `/groups` with `Accept: application/json` reaches the backend group list, while browser navigation to `/groups/<id>` returns the SPA shell.
9. Execute the create → discover → request membership → review → approve/reject journey using isolated Preview test accounts and tenant data.
10. Inspect Vercel function logs and backend logs using request/correlation IDs.
11. Promote only after Preview tests, security review, and an approved deployment decision.

## Important limitations

This archive-local change has not been deployed to Vercel. The Vercel project, environment variables, actual backend origin, backend allowlist, provider credentials and remote logs were not available in this execution environment. A live deployment must set `TITECH_API_ORIGIN` or the proxy intentionally returns 503. The function does not proxy WebSockets and does not replace backend authentication, RBAC, tenant isolation, data validation or financial controls.
