# TITech Community Capital — Login and API Readiness Remediation

**Evidence date:** 11 October 2026  
**Decision:** **NOT READY for controlled-pilot or production approval from this run**  
**Production approval:** NO  
**Scope:** Browser connectivity, API readiness, startup/module boundaries, authentication request safety and truthful failure states.

## Incident evidence and root-cause confidence

The supplied browser trace shows `GET http://localhost:5000/api/v1/ready` failing with `net::ERR_CONNECTION_REFUSED`. A refused connection means that, at the captured time, the browser could not establish a TCP connection to the configured host/port. The login POST was not confirmed in the trace, so that trace does **not** implicate credentials, account status, session creation, tenant resolution or RBAC.

The uploaded source also contained a concrete readiness correctness defect: the `/api/v1/ready` route initialized its local `isReady` flag to `true` before it had established that readiness was wired or successful. That could misreport service readiness even when no evaluator existed. The route in this working tree fails closed (`isReady = false`) and only treats a structured evaluator result as ready when `result.ready === true`; boolean readiness remains supported for compatibility.

The prior remediation archive also contained startup/module-boundary corrections: ESM modules now use ESM imports at the canonical bootstrap boundary, and CommonJS adapters are explicitly `.cjs` where appropriate. Those changes reduce a credible class of startup failure. However, the actual process could not be started in the target runtime in this environment, so it is **not proven** that those were the sole cause of the captured connection refusal. The remaining root-cause question is whether the deployed/local service failed during bootstrap, failed to bind its configured listener, or the frontend targeted the wrong host/port. The next operational run must capture the first backend startup error and listener/bind result.

## Implemented in the working tree

- `/api/v1/ready` defaults to not-ready; absence or failure of a readiness evaluator cannot return a false success.
- Readiness returns HTTP 200 only for `ready === true`; otherwise it returns HTTP 503 and the stable `not_ready` status. Boolean legacy evaluators remain supported.
- Readiness detail is minimized to `ready`/`critical` flags for dependency checks and bounded blocker codes, not arbitrary dependency objects or secrets.
- The bootstrap-provided readiness callback requires the application lifecycle to be ready and evaluates the database adapter through an explicit readiness contract. An adapter object without `isReady`, `readiness`, or `isConnected` is not treated as proof of database availability. Test-only no-database behavior remains isolated to `NODE_ENV=test`.
- Runtime connectivity guards stale asynchronous probe results, so an older successful probe cannot override a browser-offline transition or a newer API failure.
- Readiness/health response interceptors do not independently mark the API ready before the canonical readiness evaluator classifies the response. The readiness probe is single-flight, uses AbortController cancellation, invalidates stale generations, and distinguishes offline, connection failure, HTTP 503/not-ready, other HTTP 5xx, timeout and cancellation. The login form forces a fresh shared readiness check before sending credentials.
- Added focused regression assertions for readiness objects and a dependency-free Node test harness for stale responses and single-flight connectivity probes.
- Preserved the established `/api/auth/*` and `/api/v1/ready` contracts and the existing JWT/refresh-cookie model; no new auth system or V2 endpoints were introduced.

## Test evidence in this run

Passing source/static checks are logged under `reports/` and indexed by `reports/static-validation-results-2026-10-11.json`, `reports/runtime-validation-results-2026-10-11.json`, and `reports/additional-validation-results-2026-10-11.json`.

- Login/readiness remediation contract verifier: PASS.
- Runtime configuration contract verifier: PASS.
- Runtime connectivity state harness: PASS, 5 scenarios, including abort on offline transition and distinct timeout/HTTP 5xx outcomes.
- Backend source syntax command: PASS.
- Enterprise syntax gate: PASS, 2,348 executable JS/TS-family files parsed under Node 22.16.0.
- Official theme audit: PASS.
- Financial static gate: PASS, 12 canonical financial files checked.
- Enterprise contract gate: PASS, 11 control-plane contracts checked.
- Canonical financial runtime-import audit: PASS for audited critical surface; 214 legacy/non-critical missing local import findings remain.
- RBAC static gate: PASS.
- Native Node tests: money arithmetic 3/3 passed, control-plane 9/9 passed, frontend runtime audit unit tests 2/2 passed.

Not proven: target Node 24.15.x/npm 11.x runtime; dependency-backed backend Jest tests; frontend Vitest tests; Vite production build; lint; live server listener; HTTP readiness against a running server; live MongoDB/Redis; browser E2E; real login/session/refresh/logout flow; tenant isolation against a live API; MTN/Airtel sandbox; production security review.

The dependency-backed commands failed to launch because dependencies/binaries are not installed in this extracted archive (`jest`, `vitest`, `vite`, `eslint`; ESM import check could not find package `pino`). The local runtime is Node 22.16.0/npm 10.9.2, below the declared Node >=24.15.0/npm >=11.0.0 baseline. These are blockers, not passing tests.

## Remaining P0/P1 actions

1. Run under Node 24.15.x and npm 11.x after a clean lockfile-based install; capture the first bootstrap failure (if any), actual bind host/port, process survival and `curl` results for `/api/v1/ready` and `/api/v1/health`.
2. Run backend integration and frontend E2E in a controlled environment with real MongoDB and Redis test instances; prove valid login → session → `/api/auth/me` or the actual protected resource → refresh → logout → rejection after logout.
3. Prove server-side tenant/RBAC boundaries and failure recovery in E2E/security testing before any production claim.

## Scope deliberately not claimed

This remediation does not claim the full recurring-contribution workflow, fixed-deposit lifecycle, investment execution, live payment settlement, reconciliation closure or production approval. These require separate finance-path evidence, provider outcomes and external institutional/legal prerequisites, documented in `docs/evidence/financial-products-baseline-2026-10-11.md`.
