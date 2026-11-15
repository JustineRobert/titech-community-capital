# Operational Readiness — Current Evidence and Gaps

## Observed source-level foundations

- Backend environment example establishes port `5000`, Mongo URI for `community_savings` with replica set `rs0`, Redis URL and a development CORS origin.
- Frontend development origin defaults to port `3000` and Vite proxies `/api` and Socket.IO to the configured backend origin.
- API origin resolution validates configured absolute origin or explicit same-origin proxy path and rejects missing production origin.
- Existing backend bootstrap/configuration, health routes, structured logger, request/correlation IDs, audit and readiness infrastructure are present in the archive.
- The group router attaches request/correlation IDs and `Cache-Control: no-store` and caps request bodies/rates.

## Execution evidence

The archive's actual runtime could not be started here. The supplied container exposed Node 22.16.0/npm 10.9.2 while the repo requires Node 24.15.0/npm 11.0.0. There were no installed dependencies or available Mongo replica set / Redis service. Therefore no health endpoint, readiness dependency check, log correlation, latency metric, alert or worker recovery was tested.

## Operations still required

- Confirm deployment-specific `VITE_API_URL` / `VITE_API_BASE_URL` and server-only upstream origin without disclosing their values in public reports.
- Verify browser preflight/credentials from each approved origin.
- Run liveness and readiness checks separately, including Mongo, Redis and required workers.
- Confirm Mongo replica set, transaction availability, backup schedule and tested restore.
- Confirm Redis persistence/namespace, restart recovery and no financial source-of-truth reliance.
- Verify structured correlation IDs across API, worker, provider, financial transaction and reconciliation.
- Configure actionable alerts for backend health, database/Redis failure, failed contribution instructions, `UNKNOWN` provider outcomes, unbalanced journals, outbox lag and reconciliation exceptions.
- Demonstrate operator runbooks and least-privilege support access without exposing KYC documents or tokens.

## Current decision

The operational substrate exists in code, but operational verification is NOT STARTED / NOT VERIFIED for this execution. Do not claim an SLO or on-call service level.
