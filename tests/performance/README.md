# TITech performance and capacity test suite

## Scope

`k6/titech-read-only-capacity.js` is the initial safe HTTP capacity workload. It uses only `GET` calls against repository-confirmed health/readiness and existing refugee-inclusive onboarding/insurance read routes. It does **not** create or alter participant records, consent, documents, insurance enrolments, premium obligations, claims, payments, ledger entries, or reconciliation state.

This suite measures an HTTP workload with virtual users. It does not establish distinct authenticated session counts, production readiness, financial-write throughput, or billion-scale capacity. Reusing a supplied bearer token across virtual users is a test-fixture shortcut, not a session-capacity proof.

## Preconditions

- Use a dedicated local or staging instance and synthetic data only.
- Install k6 separately in the approved test environment; it is not a production runtime dependency.
- For authenticated route coverage, supply dedicated non-production bearer tokens with exactly the permissions needed for the selected read routes. Never paste tokens into source files, command history that is shared, test reports, or CI logs.
- The optional `TITECH_PERF_TENANT_ID` is a consistency assertion. It cannot grant tenant authority or override the authenticated tenant.
- The default profile is `smoke` against `http://127.0.0.1:5000`. `baseline` caps at 10 VUs. Profiles above 10 VUs require an explicit staging environment, exact approved target, approval ID, and approved VU ceiling.
- A production target is blocked by the harness. Do not change the guard to run load tests against production.

## Commands

From the repository root, create an artifact directory first:

```sh
mkdir -p reports/performance
k6 run --summary-export=reports/performance/k6-smoke-summary.json tests/performance/k6/titech-read-only-capacity.js
```

Baseline (local or approved staging, no more than 10 VUs):

```sh
TITECH_PERF_PROFILE=baseline TITECH_PERF_APPROVED_MAX_VUS=10 \
  k6 run --summary-export=reports/performance/k6-baseline-summary.json tests/performance/k6/titech-read-only-capacity.js
```

A larger controlled staging run must use values approved for that specific change window and environment:

```sh
TITECH_PERF_BASE_URL=https://<approved-staging-origin> \
TITECH_PERF_ENVIRONMENT=staging \
TITECH_PERF_TARGET_APPROVED=https://<approved-staging-origin> \
TITECH_PERF_APPROVAL_ID=<change-or-test-approval-reference> \
TITECH_PERF_APPROVED_MAX_VUS=100 \
TITECH_PERF_PROFILE=load-100 \
  k6 run --summary-export=reports/performance/k6-load-100-summary.json tests/performance/k6/titech-read-only-capacity.js
```

Substitute real approved values in the shell environment; do not commit credentials or actual approval secrets. Never test against an origin whose ownership or staging status has not been confirmed.

Set `TITECH_PERF_PARTICIPANT_TOKEN`, `TITECH_PERF_PARTNER_TOKEN`, and/or `TITECH_PERF_INSURER_TOKEN` to include the relevant authenticated read journeys. An authorization failure is a failed test and should be investigated; do not disable RBAC to make it pass.

## Provisional gates

- HTTP request failure rate `< 0.1%`.
- p95 response time `< 500 ms` and p99 `< 1,500 ms` for this mixed read-only workload.
- HTTP checks success rate `>= 99.9%`.

These are provisional benchmark thresholds, not current TITech SLOs or achieved performance. Confirm the workload, dependency topology, warm-up, duration, generator health, and business-specific latency budgets before using a run for a capacity decision. Do not loosen thresholds after a failed run without a reviewed contract change.

## Evidence required per run

Retain the Git commit or archive SHA-256, k6 version, origin/environment, profile, maximum/achieved VUs, request rate, p50/p95/p99, error rate, HTTP status counts, CPU/memory, event-loop delay, MongoDB pool/query metrics, Redis metrics where applicable, generator CPU/network, test duration, start/end time, abort reason, and raw k6 summary. Record missing telemetry as a limitation, not as a zero value.

## Not covered yet

- Real authenticated session creation at scale.
- Write-heavy member/group/contribution workloads.
- Financial writes under duplicate requests and concurrent account mutation.
- Provider callback, settlement, ledger, receipt/outbox and reconciliation stress.
- MongoDB replica-set failover, Redis failure, offline-sync backlog, chaos, restore/rollback, multi-region or regional-recovery proof.
- Independent verification of 100,000+, 1,000,000+, or 1.5-billion-member capacity.

Financial-mutating load scenarios must be implemented only against an isolated environment with synthetic accounts, an explicit approval boundary, seeded balances, deterministic cleanup, and post-run ledger/reconciliation invariant checks.
