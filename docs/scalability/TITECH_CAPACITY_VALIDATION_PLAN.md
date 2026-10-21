# TITech Community Capital — capacity validation plan

**Organization:** TITech Capital LTD  
**Product:** TITech Community Capital  
**Principle:** BUILD LESS. PROVE MORE. FINANCIAL CORRECTNESS BEFORE CONVENIENCE.

## 1. Capacity is not one number

Report registered member records, concurrent authenticated sessions, simultaneous connections, active virtual users, requests/second, successful financial writes/second, event throughput, offline-sync throughput, and background-job throughput separately. A load-test virtual user is not a distinct human, and connected sessions are not equivalent to requests or settled financial transactions.

The simplified demand equation is:

`requests per second = concurrent active members / seconds between requests`

Illustrative demand only, not a forecast or a benchmark:

| Assumed activity by 1.5 billion active members | Approximate request rate |
|---|---:|
| One request per five minutes | 5 million requests/second |
| One request per minute | 25 million requests/second |
| One request every ten seconds | 150 million requests/second |

These figures exclude retries, burstiness, authentication, response payloads, database amplification, financial-write contention, background jobs, provider calls, replication, failover headroom, and network overhead. A local test cannot validate this global operating envelope.

## 2. Repository-confirmed current boundaries

- Canonical versioned routes mount participant onboarding, refugee-serving partner and insurance modules behind the existing authentication and tenant authorization middleware.
- Action-level permission checks and server-side feature flags remain in place.
- Refugee and asylum-seeker credentials coexist with national ID, passport and other policy-approved credentials. Refugee status, nationality, preferred language, and absence of a national ID are not an identity-risk signal.
- Insurance licence verification, participant consent, partner-specific scopes and maker-checker controls remain separate. A submitted licence or record is not approval.
- Premium creation is an obligation/reference workflow only. Live premium payment processing and payout settlement remain blocked without an approved canonical adapter and payment/ledger/reconciliation evidence.
- The central official-theme contract is `branding/TITECH_OFFICIAL_THEME.json`; the brand manifest, web tokens, CSS, chart tokens and mobile tokens remain the palette authorities. Use their semantic tokens; do not hard-code palette values in feature styles.

## 3. Progressive test gates

The staged capacity programme below is a proposal, not evidence of capacity:

| Gate | Target | Acceptance evidence |
|---|---:|---|
| G0 | 1 VU / smoke | Known routes, safe test target, telemetry, valid thresholds |
| G1 | Up to 10 VUs | Reproducible baseline and generator health |
| G2 | 100 VUs | Approved staging environment, no material SLO regression, tenant-scope regression |
| G3 | 1,000 VUs | Distributed generators if needed, dependency and resource telemetry |
| G4 | 10,000+ VUs | Explicit approval, capacity planning, bounded costs, tested stop controls |
| G5 | 100,000 to 1,000,000+ VUs | Separately planned distributed campaign and independently reviewable raw evidence |
| G6 | 1.5-billion active-member objective | A global-scale programme covering connection, request and financial workloads, independent verification, regional recovery and cost model; do not infer from lower gates |

A gate passes only when the requested load was actually achieved, generator saturation is excluded, thresholds pass for the full agreed duration, and correctness checks pass. An aborted run or unmet target is a reported failure/limitation, not a pass.

## 4. First executable workload

Run `tests/performance/k6/titech-read-only-capacity.js` in local or approved staging. It only issues GET requests to the versioned health/readiness paths and, when separate non-production scoped tokens are provided, participant identity status, refugee partner status, and insurance read paths. It cannot be used to claim write throughput or distinct-session capacity.

The harness defaults to one virtual user on loopback. Its higher profiles require a VU ceiling, staging declaration, exact approved target and approval ID. Do not test a public production service. Never use real refugee identity evidence, live participant records, real payment credentials or real-money provider calls for capacity testing.

## 5. Capacity and correctness evidence required

For every run record:

- Source commit or exact archive SHA-256, runtime/tool versions and deployment configuration.
- Origin, approved environment, profile, requested and achieved virtual users, active connections, duration and ramp/hold schedule.
- Offered/achieved RPS, p50/p95/p99 latency, status/error/timeout/rejection rates and retry counts.
- Generator CPU, memory, network, scheduling delays and dropped iterations.
- Application CPU/memory, event-loop lag, garbage collection, pool sizes, query latency/index use, Redis latency/connection use, queue depth/age, worker throughput and resource saturation.
- Tenant fairness/isolation, authorization checks and traceable rejected/blocked requests.
- For any approved financial-write campaign: initial and final account states, accepted/rejected operations, duplicate attempts, unknown provider outcomes, journal balance, idempotency, reversals, ledger-to-balance comparison, receipts/outbox durability, settlement and reconciliation results.
- Infrastructure cost and missing measurement instrumentation.

Financial acceptance is zero unexplained monetary discrepancies and zero cross-tenant disclosure or unauthorized mutations. API latency passing does not compensate for a financial-integrity failure.

## 6. Next engineering gates

1. Complete dependency-backed build and full tests on the repository-declared Node.js/npm versions.
2. Run the smoke and baseline load tests with an operational server and capture full resource telemetry.
3. Run MongoDB replica-set and Redis integration tests, including transaction contention, failover, idempotency races and recovery.
4. Extend the test fixture to generate synthetic institutions with different roles and multiple tenants; prove fairness and isolation.
5. Implement write-load tests only through canonical financial services, with deterministic post-run invariant queries and safe cleanup.
6. Test offline-sync replays, duplicate device events, backlog throttling, worker interruption and recovery.
7. Run approved staged scale gates in order. Update target numbers only through a reviewed, evidence-backed capacity contract.
8. Independently assess security, privacy, local regulatory boundaries, partner agreements, backup restore, rollback, on-call readiness and incident response.

## 7. Release decision rule

Until these tests and outside dependencies are complete, classify the work as **capacity-test foundation implemented; demonstrated global capacity not established**. Do not claim production approval, insurer authorization, refugee-programme approval, live payment capability, or 1.5-billion concurrent-user support from source-code presence, static gates, mocked tests or a capacity model.
