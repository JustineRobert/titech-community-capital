# TITech Community Capital — Vercel configuration contract

**Product:** TITech Community Capital  
**Organization:** TITECH CAPITAL - SMC LTD  
**Updated:** 24 November 2026

## Repository evidence

The Vercel frontend is the Vite application under `frontend/`:

- `frontend/package.json` owns Vite and Terser.
- `frontend/package-lock.json` is the frontend deterministic dependency lock.
- `frontend/vite.config.js` writes production assets to `frontend/dist` and explicitly selects Terser minification.
- `frontend/vercel.json` preserves SPA document routing and the existing JSON `/groups` rewrite contract.
- `frontend/api/[...path].js` is the same-origin server-side API bridge. It accepts only `/api/*`, uses a server-only `TITECH_API_ORIGIN`, restricts methods and forwarded headers, applies a bounded request size and timeout, and does not provide a WebSocket proxy.

## Vercel project settings to verify/apply

The actual Vercel project dashboard was not accessible from this repository-only execution. The following is the intended configuration; it is **not represented as remotely verified**.

| Setting | Intended value | Notes |
|---|---|---|
| Root Directory | `frontend` | Ensures the frontend package, `frontend/api` function and `frontend/vercel.json` are in the deployed project root. |
| Framework Preset | Vite | Must match the Vite application. |
| Install Command | `npm ci --include=dev` | Install frontend dev dependencies required for Vite and Terser build. Vercel root is `frontend`, so it uses `frontend/package-lock.json`. |
| Build Command | `npm run build` | Runs `vite build`. |
| Output Directory | `dist` | Matches `vite.config.js`. |
| Node.js Version | 24.x | Repository manifests restrict Node to `>=24.15.0 <25`; confirm Vercel selects Node 24. |

## Required environment contract

Configure each Preview and Production environment intentionally. Values below are names/contracts, not credentials supplied by this report.

| Variable | Scope | Purpose | Required |
|---|---|---|---|
| `TITECH_API_ORIGIN` | Server-side only | HTTPS origin for the approved TITech backend; no path, credentials, query or fragment | Yes for API bridge |
| `VITE_API_URL` | Public build-time | `/api/v1` to call the same-origin Vercel bridge | Yes |
| `VITE_API_HEALTH_PATH` | Public build-time | `/api/v1/health` | Recommended |
| `VITE_API_READINESS_PATH` | Public build-time | `/api/v1/ready` | Recommended |
| `VITE_SOCKET_URL` | Public build-time | WebSocket origin/path; must be configured to a supported backend endpoint | Yes for socket-dependent features |

Never put database URLs, JWT secrets, refresh secrets, provider keys or any private credential in a `VITE_*` variable. The API bridge fails closed with 503 when `TITECH_API_ORIGIN` is absent or invalid. The API bridge does not proxy Socket.IO/WebSocket traffic; that connection needs a separately supported endpoint and verification.

## Preview verification required before promotion

1. Confirm the settings above in the Vercel dashboard for the project and each environment.
2. Set `TITECH_API_ORIGIN` to the approved backend's HTTPS origin and confirm backend CORS/CSRF policy allows the exact frontend origin.
3. Deploy a Preview, not Production.
4. Verify `/api/v1/health` and `/api/v1/ready` return backend JSON, not the SPA HTML shell.
5. Verify login, refresh-cookie rotation and logout using isolated Preview accounts.
6. Verify React Router deep links and JSON `/groups` behavior.
7. Verify frontend asset loading, browser console, responsive layout and the video provider's honest unavailable/configured state.
8. Verify API and Socket.IO connectivity separately.
9. Retain preview URL, Vercel build logs, smoke-test results and request/correlation IDs.
10. Do not promote until security, financial, operational, partner/legal and production-approval gates are satisfied.

## Current status

The source configuration was inspected; no Vercel authentication, dashboard access, backend origin, Preview URL or remote build log was available. No Vercel build, Preview deployment or Production deployment was executed in this remediation. `productionApproved` remains `false`.
