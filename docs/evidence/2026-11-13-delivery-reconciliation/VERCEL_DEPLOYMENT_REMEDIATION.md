# Vercel deployment remediation report — 13 November 2026

**Production domain supplied:** `https://titech-community-capital.vercel.app`  
**Login route supplied:** `https://titech-community-capital.vercel.app/login`

## Access and deployment result

No Vercel CLI or authenticated Vercel project session was available. This execution could not inspect the project ID, linked GitHub repo, production branch, root directory, Node runtime, build/install command, output directory, environment variable names/values, deployment logs, alias assignment, domain/TLS, function logs or the commit SHA associated with the current deployment. No deploy, redeploy, rollback, environment edit or production smoke request is claimed.

## Source configuration inspected

- `frontend/vercel.json` currently contains a catch-all SPA rewrite from `/(.*)` to `/index.html`.
- `frontend/.env.production.example` declares `VITE_API_URL=/api/v1`, a same-origin API contract, and explicitly requires a reverse proxy to route API and websocket paths to the backend.
- The repository contains an Express backend; the available evidence does not prove that Vercel runs it as serverless functions. The documented intended topology appears compatible with a separate backend behind a same-origin edge, but the actual deployed topology must be established from the project/dashboard and backend host.

## Important routing risk — not changed blindly

A catch-all rewrite may return `index.html` for an unhandled `/api/*` request. That would make API calls receive HTML instead of the expected JSON. The production template expects API and websocket routes to be handled before the SPA fallback, but the uploaded source does not establish whether Vercel project rewrites, edge middleware, serverless functions or an upstream proxy already provide that ordering. Changing `vercel.json` without confirming the API host/topology could break a working deployment; therefore it was not modified.

## Required operator checks

1. Open the Vercel project and confirm it is the intended account/project/domain.
2. Confirm GitHub connection is `JustineRobert/titech-community-capital`, production branch is the verified `main`, and root directory points to `frontend` only if that is the actual chosen frontend project architecture.
3. Confirm runtime Node version meets the repository-supported release baseline.
4. Confirm install/build commands and output directory (Vite output normally `dist`) match the package structure.
5. Inspect configured environment variable **names** and scopes without printing values. Confirm the public `VITE_API_URL` points to the actual production API origin or a verified same-origin proxy path; no browser-visible secrets.
6. Verify `/api/v1/health`, `/api/v1/ready`, authentication and websocket paths are routed to Express before any SPA catch-all. Ensure `/api/*` failures remain API responses, not HTML fallback.
7. Verify frontend deep links (`/login`, protected route refresh) return the SPA entry document while API paths do not.
8. Deploy only the validated commit, inspect build and runtime logs, verify alias/domain/TLS, and record deployed commit SHA.

## Status

`deploymentStatus=NOT_VERIFIED`; `productionCommitSha=UNAVAILABLE`; `apiRouting=NOT_VERIFIED`; `productionSmokeTests=NOT_RUN`. The source contract gate reports 7/7 pass for repository hosting configuration, but that is a static source-contract result, not a Vercel deployment result.
