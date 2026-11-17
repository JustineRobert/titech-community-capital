# Backend Startup Verification

**Source archive SHA-256:** `536f74fdf60bbf5a6c9425c59e2dd3d16add398d0750875122f117d324cdd831`  
**Runtime available:** Node `v22.16.0`, npm `10.9.2`  
**Repository requirement:** Node `>=24.15.0`, npm `>=11.0.0`

## Source defects established and corrected

- The ordinary direct-execution startup rejection handler previously called `process.exit(FATAL_EXIT_CODE)` after logging and assigning the failure code. It now sets the non-zero exit code and allows post-rollback logging/remaining event-loop work to complete.
- Startup diagnostic output previously defaulted readiness to `true` if the bootstrap object exposed no readiness signal. The optimistic fallback was removed.
- The graceful signal handler previously set exit code `0` unconditionally on a clean signal-driven shutdown. It now does so only if no non-zero exit code has already been established.
- The logger argument contract and sanitization are documented in `ROOT_CAUSE_ANALYSIS.md`.

## What was actually verified

| Lifecycle item | Status | Evidence |
|---|---|---|
| Existing canonical bootstrap identity/lock | **PASS — source regression** | `application-lock-regression.test.mjs` 4/4. |
| Ordinary startup rejection exit semantics | **PASS — source contract** | `startup-failure-contract.test.mjs` 4/4 includes no immediate `process.exit()` in ordinary rejection path. |
| Readiness fallback removal | **PASS — source contract** | No `?? true` fallback remains in startup diagnostic. |
| Signal exit-code preservation | **PASS — source contract** | Clean signal status does not overwrite pre-existing non-zero status. |
| MongoDB actual connection to `community_savings` | **NOT RUN** | No MongoDB process/test replica set available. |
| Redis actual connection and ready event | **NOT RUN** | No Redis instance available; client creation alone is not treated as connected. |
| Application service initialization | **NOT RUN** | Dependency-backed backend bootstrap could not be executed. |
| Middleware and route initialization in live process | **NOT RUN** | No live server process. Static import/syntax gates only. |
| HTTP server listening | **NOT RUN** | No process start; Node version and backend dependencies are blockers. |
| `/api/v1/health` and `/api/v1/ready` HTTP responses | **NOT RUN** | No active server to query. |
| Nodemon remains running | **NOT RUN** | No live command `cd backend && npm run dev`. |
| SIGINT / SIGTERM live shutdown | **NOT RUN** | Only code-contract tests executed. |
| Simulated failed infrastructure start and reverse rollback | **NOT RUN** | Isolated live MongoDB/Redis failure-injection environment unavailable. |

## Honest startup outcome

The owner's earlier log transcript shows that the historical application emitted a startup failure after infrastructure initialization messages. The exact exception/phase was not recoverable from the source archive; the complete original stack trace and live environment were not provided. I have **not** attributed that failure to Redis, MongoDB or a route import without evidence. The verified code changes prevent misleading readiness, forceful ordinary-exit handling and signal-code erasure, but the original runtime failure must still be reproduced under Node 24.15+ with real isolated MongoDB/Redis services before startup can be certified.
