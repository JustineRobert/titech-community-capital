# TITech Community Capital
# GLOBAL SCALABILITY, 1.5-BILLION-MEMBER ARCHITECTURE, ENTERPRISE REMEDIATION, LOAD TESTING, FINANCIAL CORRECTNESS AND PRODUCTION-READINESS MASTER PROMPT

**Organization:** TITech Capital LTD  
**Product:** TITech Community Capital  
**Canonical repository:** https://github.com/JustineRobert/titech-community-capital  
**Primary objective:** Engineer the existing TITech platform toward globally distributed operation, measure its demonstrated capacity, remediate critical bottlenecks, and prove reliability, security, recovery and financial correctness at progressively higher capacity levels.

**Governing principle: BUILD LESS. PROVE MORE. FINANCIAL CORRECTNESS BEFORE CONVENIENCE. CAPACITY CLAIMS MUST BE EVIDENCE-BASED.**

---

## 1. YOUR ROLE AND EXECUTION MANDATE

Act as a coordinated team of principal-level software and infrastructure specialists:

- Principal distributed-systems architect.
- Staff backend and full-stack engineer.
- Performance and capacity engineer.
- Database and data-platform engineer.
- Site reliability and cloud-platform engineer.
- FinTech security and financial-integrity engineer.
- Quality assurance, reliability-testing and release-evidence engineer.

You are operating on the **existing TITech Community Capital product**, not a new application.

Inspect the actual working repository, understand what is implemented, identify current defects and bottlenecks, implement the highest-priority safe improvements, execute the tests that are genuinely possible, and produce the evidence needed to decide what should happen next.

This is an execution task, not merely a consultation.

Do not stop after writing recommendations or finding defects. Remediate the defects that can safely be resolved in the available environment, rerun the relevant verification, and record any residual blockers precisely.

If infrastructure, credentials, production-like datasets, external services, compute capacity or execution limits prevent completion, finish the highest-value safe implementation and leave the repository in a coherent state. Clearly report what was implemented, what actually passed, what failed, and what requires external execution.

Do not ask for clarification when a reasonable, safe implementation path can be derived from the repository. Use explicit, documented assumptions where necessary.

## 2. THE CENTRAL ENGINEERING QUESTION

Can TITech Community Capital handle 1.5 billion members simultaneously interacting without breaking down?

Treat this as an engineering hypothesis to investigate—not an established capability.

The required outcome is to:

1. Establish what capacity TITech supports today, based on reproducible measurements.
2. Make the existing architecture more scalable where actual evidence identifies a need.
3. Eliminate critical bottlenecks, correctness defects and overload-amplification risks.
4. Test the system using progressively increasing, realistic workloads.
5. prove that financial operations remain correct during concurrency, retries, timeouts, crashes and recovery.
6. Establish a technically defensible path toward larger regional and global deployments.
7. Distinguish verified capacity from estimated capacity, theoretical capacity and future architectural ambition.

**Never declare that TITech supports 1.5 billion concurrent active users just because the architecture contains Kubernetes, distributed components, caching, queues, multiple application replicas or autoscaling configuration.**

A passing source-code audit, a passing unit test, a successful deployment and a successful capacity test are different types of evidence.

The final report must explicitly answer:

- What is the highest tested number of concurrent virtual users?
- How many concurrent authenticated sessions or connections were demonstrated?
- What sustained and peak requests per second were achieved?
- What was the successful financial transaction rate?
- What were p50, p95 and p99 response times?
- What were the error, timeout, rejection and saturation rates?
- How long was each successful load held?
- What infrastructure and test-generator resources were used?
- Did ledger, balance, tenant-isolation and reconciliation invariants remain intact?
- What capacity is demonstrated, what capacity is modelled, and what remains unproven?

## 3. REPOSITORY TRUTH IS AUTHORITATIVE

Before changing code, inspect the current branch, commit, working tree, package scripts, runtime configuration, source tree, deployment manifests, tests and existing evidence.

Read the applicable files that exist, including:

- `README.md`
- `TITECH_PLATFORM_TRUTH.md`
- `TITECH_ENTERPRISE_PRODUCTION_READINESS_CERTIFICATE.md`
- `TITECH_ENTERPRISE_READINESS_STATUS_2026-10-07.md`
- `TITECH_NOT_YET_PROVEN_2026-10-11.md`, if present
- The current production-readiness matrix and regulatory-boundary documents.
- The latest master implementation and remediation reports.
- Existing master-gate implementation and reports.
- `package.json`, the lockfile and the applicable runtime-version files.
- Existing test configurations and test suites.
- Docker Compose, Dockerfiles, Nginx and Kubernetes manifests.
- Existing health, readiness, resilience, metrics and logging implementations.
- Existing transaction, ledger, balance, idempotency, payment and reconciliation boundaries.
- Existing offline synchronization and background-processing mechanisms.
- Existing CI/CD workflows and release-verification scripts.

These filenames identify initial discovery candidates, not permission to assume their contents are still current. Some documents may be superseded. Establish which source is authoritative today and document discrepancies.

### Initial safety and baseline procedure

1. Record the starting commit and branch.
2. Inspect `git status` and preserve all existing user changes.
3. Identify the supported Node.js and npm versions from the actual repository contract. The previously documented target was Node.js 24.15.x and npm 11.x; verify it rather than assuming it.
4. Inventory the existing scripts and identify the supported installation, test, lint, build, hosting and enterprise master-gate commands.
5. Run the available baseline gates before remediation where the environment permits.
6. Save command output and exit codes.
7. Identify which failures predate your changes.
8. Create an evidence-backed remediation ledger mapping each defect to its root cause, affected components, changes, regression tests and verification outcome.

Do not reset the repository, discard uncommitted work, replace lockfiles without justification, or rewrite major modules before understanding their callers and contracts.

## 4. NON-NEGOTIABLE ARCHITECTURAL RULES

### 4.1 Preserve the canonical application

Retain and extend the existing architecture and public contracts wherever appropriate.

The documented baseline includes React/Vite, Express, the existing Node.js module boundaries, MongoDB/Mongoose, Redis, financial services, and deployment infrastructure. Confirm their current status in the repository before relying on them.

Do not introduce:

- A parallel TITech V2 application.
- Duplicate authentication, ledger, payment or reconciliation implementations.
- Shadow financial models or competing sources of truth.
- A second routing system that bypasses the canonical application.
- Fake authentication or authorization bypasses.
- Placeholder services represented as operational capabilities.
- Unverified production integrations or invented external approvals.
- Unnecessary infrastructure products simply because they are popular at scale.

Do not perform a speculative monolith-to-microservices rewrite.

Keep the current architecture when it can meet measurable requirements. Introduce service boundaries or additional infrastructure only when supported by a documented bottleneck, a failure-isolation requirement, a security requirement or a clear capacity constraint.

Every architectural change must include its rationale, migration approach, compatibility requirements, rollback plan and verification.

### 4.2 Protect the financial system

Maintain the integrity of the canonical financial path:

Community activity → authorized financial operation → transaction state → ledger posting → balance integrity → payment settlement → reconciliation → audit evidence.

Adapt this sequence to the actual implementation rather than introducing duplicate abstractions.

The financial database and ledger must remain authoritative. Caches, queues, search indexes, analytics databases, UI state and provider callbacks must not silently become competing sources of truth.

No performance improvement may permit:

- Double posting.
- Duplicate monetary effects.
- Unbalanced journal entries.
- Negative balances where prohibited by business rules.
- Cross-tenant data access.
- Unauthorized transaction execution.
- Lost or untraceable financial events.
- Irreconcilable provider outcomes.
- Silent loss of acknowledged financial activity.

### 4.3 No fabricated evidence

Distinguish these evidence levels:

1. Designed.
2. Implemented.
3. Unit tested.
4. Integration tested.
5. End-to-end tested.
6. Load tested.
7. Resilience tested.
8. Operationally verified.
9. Independently assessed.
10. Externally approved.
11. Production approved.

Advance a capability only when the corresponding evidence exists.

Static checks, mocks, documentation, generated reports, successful builds and simulated infrastructure do not prove that a live distributed financial system works correctly.

---

## 5. DEFINE THE CAPACITY TARGET CORRECTLY

Model these as separate requirements.

| Capacity dimension | Required interpretation |
|---|---|
| Registered members | Total member records managed over the platform’s lifetime. |
| Concurrent sessions | Simultaneously authenticated or active application sessions. |
| Concurrent connections | Simultaneous HTTP keep-alive, WebSocket or other persistent connections, as applicable. |
| Active virtual users | Load-test actors executing defined user journeys. |
| Request throughput | Successfully processed application requests per second. |
| Financial write throughput | Safely completed financial operations per second. |
| Event throughput | Events produced, delivered, processed and acknowledged per second. |
| Synchronization capacity | Offline operations received, deduplicated, validated and reconciled per second. |
| Background-processing capacity | Reports, notifications, reconciliation, and other jobs processed within defined latency budgets. |
| Global availability | Ability to serve supported workloads across regions while containing failures. |

Do not equate one million virtual users with one million simultaneously connected human users. Do not equate connected sessions with active requests, or request throughput with completed financial transactions.

### Illustrative mathematical demand model

For a simplified workload in which every active member generates one request at a fixed interval:

`Request rate = Concurrent active members / Seconds between requests`

At 1.5 billion active members:

- One request per five minutes corresponds to approximately 5 million requests per second.
- One request per minute corresponds to approximately 25 million requests per second.
- One request every ten seconds corresponds to approximately 150 million requests per second.

These calculations are illustrative scenarios, not measurements, proposed service-level guarantees or predictions of actual member behavior.

Real usage involves different operation costs, bursts, authentication, reads, writes, background jobs and external dependencies. Build workload models from observed traffic if available. Otherwise use clearly labelled synthetic workload assumptions and perform sensitivity analysis.

Do not base capacity claims on registered-account counts alone.

---

## 6. PHASE ONE — BASELINE INVENTORY AND IMPLEMENTATION AUDIT

Produce a machine-readable inventory and a human-readable report covering:

### Application and runtime

- Frontend build integrity.
- Backend startup and module loading.
- Runtime compatibility.
- API route registration.
- Error handling.
- Connection lifecycle and shutdown behavior.
- Health and readiness checks.
- Session and authentication handling.
- Existing request and response validation.
- Existing retry, timeout and rate-limit behavior.

### Financial correctness

- Transaction boundaries.
- Journal balancing.
- Atomic posting.
- Idempotency.
- Balance derivation and caching.
- Reversal semantics.
- Account locking or concurrency-control mechanisms.
- Transaction-state transitions.
- Provider callback validation.
- Settlement and reconciliation.
- Audit and event publication.

### Data and isolation

- MongoDB indexes and query patterns.
- Collection growth and document sizes.
- Hot-key and hot-tenant exposure.
- Database pool sizing.
- Redis usage and failure behavior.
- Tenant-scoped access control.
- Pagination and unbounded-query risks.
- Data retention and lifecycle.
- Backup and restore evidence.

### Deployment and operations

- Container images and resource settings.
- Kubernetes deployment, autoscaling and rollout configurations where present.
- Readiness, liveness and startup probes.
- Graceful termination and in-flight request handling.
- Logs, metrics and distributed tracing.
- Alerts and incident response.
- Deployment, rollback and recovery procedures.
- CI/CD and release gates.

### Tests and debt

- Existing unit, integration, contract and E2E coverage.
- Empty or skipped tests.
- Mock-only test suites.
- Unresolved imports and unused modules.
- Zero-byte or dormant files affecting critical runtime paths.
- Duplicate implementation boundaries.
- Test gaps around concurrent financial mutations.
- Current performance tests and the extent to which they reflect realistic workloads.

Rank findings by financial risk, security risk, likelihood of production failure, capacity impact and remediation cost.

Do not classify every legacy file or static warning as a critical blocker. Identify whether the finding affects an executable production path, a critical financial boundary, a deployment dependency or unused scaffolding.

---

## 7. PHASE TWO — ESTABLISH A REPEATABLE PERFORMANCE TEST FOUNDATION

Implement or repair the repository’s performance-testing infrastructure using established, reproducible tools compatible with the existing environment.

Prefer the existing test tooling where it is sufficient. Grafana k6 is an acceptable candidate for HTTP/API scenarios, staged workloads and threshold enforcement if it fits the repository and deployment model.

Do not add a large testing platform without demonstrating the need.

Create a clearly separated load-test suite, for example:

`tests/performance/`

Adapt this location to existing repository conventions and avoid duplicate test directories if a suitable one already exists.

Provide reusable tests covering:

- Authentication and session lifecycle.
- Member and institution reads.
- Group and contribution workflows.
- Financial operation initiation.
- Ledger and balance reads.
- Payment-state retrieval.
- Reconciliation workflows.
- Reporting and pagination.
- Offline synchronization and idempotent retries.
- Background processing and notification workloads.
- WebSocket or persistent-connection behavior when those features are implemented.

Use actual, existing API routes and user journeys. Do not invent successful endpoints merely to make performance tests pass.

Include:

- Test configuration.
- Reusable data setup and cleanup.
- Synthetic-data generation.
- Authentication bootstrap suitable for the test environment.
- Request-rate controls.
- Timeouts and cancellation.
- Explicit pass/fail thresholds.
- Structured test output.
- Machine-readable result summaries.
- A documented way to reproduce every run.

Tests must never depend on personal production data or hard-coded secrets.

A test should return a failure result when its threshold is breached. Do not silently continue with a passing exit code after severe performance or correctness failure.

---

## 8. PHASE THREE — DEFINE CAPACITY GATES AND STOP CONDITIONS

Establish staged capacity gates instead of immediately attempting an unrealistic global-scale run.

Use this as an initial progression, adjusted according to measured capacity and available safe infrastructure:

| Gate | Initial target | Purpose |
|---|---:|---|
| G0 | 1–100 virtual users | Confirm the test path and basic measurement accuracy. |
| G1 | 1,000 concurrent virtual users | Establish a baseline with realistic application journeys. |
| G2 | 10,000 concurrent virtual users | Identify early application and database bottlenecks. |
| G3 | 100,000 concurrent virtual users | Prove a materially larger workload using distributed generators when required. |
| G4 | 250,000–1,000,000 concurrent virtual users | Progressive distributed-capacity validation, only after previous gates pass. |
| G5 | Above one million | Expand in controlled stages when infrastructure, load generators, budget and prior evidence support the next step. |
| G6 | Billion-scale objective | Establish a separate global-capacity validation programme with an agreed workload and independent verification plan. |

These are proposed test milestones, not claimed capacity figures. They must not be treated as guaranteed completion targets for one local coding session.

Do not jump to the next gate merely because the current run completed. Require a verified pass at the current gate first.

### Required load patterns

Implement or configure:

1. Smoke tests.
2. Baseline tests.
3. Gradual ramp-up.
4. Step-load tests.
5. Burst and spike tests.
6. Sustained-load tests.
7. Long-duration soak tests.
8. Recovery tests after overload.
9. Multi-tenant fairness tests.
10. Read-heavy workload tests.
11. Write-heavy workload tests.
12. Mixed financial and non-financial traffic.
13. Persistent-connection and session tests.
14. Offline synchronization bursts.
15. Database and dependency degradation tests.

Use both virtual-user scenarios and request-arrival-rate scenarios where appropriate. The former models sessions and user journeys; the latter helps specify the offered request rate independently of response latency.

A saturated load generator can understate system capacity. Monitor generator CPU, memory, network, scheduling delays and dropped iterations, and distribute the generators when needed.

### Safe load-test restrictions

- Default to a dedicated staging or performance environment.
- Do not stress the public production deployment.
- Do not conduct destructive tests against real member data.
- Do not generate real payments unless the precise integration test is explicitly authorized and controlled.
- Use synthetic tenants, test accounts and isolated financial data.
- Establish a maximum request rate, resource budget and automatic stop condition.
- Stop automatically when error rates, latency, memory, connection exhaustion or financial-integrity failures exceed configured limits.
- Require explicit authorization before production experiments or external dependency disruption.
- Preserve diagnostics and test artifacts after aborting a run.

A failed or aborted test is valuable evidence. Do not conceal it or rerun indefinitely until a passing result happens to appear.

---

## 9. PHASE FOUR — DEFINE AND ENFORCE PERFORMANCE TARGETS

Create a documented capacity contract containing SLOs, measurement boundaries, workloads, infrastructure assumptions and test duration.

Do not pretend that universal latency figures fit every feature. Propose initial targets and finalize them using actual service behavior and product requirements.

As a starting point for the first controlled performance environment, evaluate these provisional targets:

| Measurement | Initial proposed target |
|---|---|
| Read API latency | p95 ≤ 300 ms; p99 ≤ 1,000 ms |
| Core financial API latency | p95 ≤ 500 ms; p99 ≤ 1,500 ms, measured separately from external provider latency |
| Sustained unexpected HTTP error rate | Less than 0.1% during a steady-state benchmark |
| Financial correctness | Zero unexplained ledger mismatches, duplicate monetary effects or cross-tenant authorization violations |
| Resource behavior | No continuously increasing memory usage, uncontrolled queue growth or sustained resource saturation that defeats the gate |
| Backpressure | Excess load is bounded, observable and recoverable |
| Recovery | Measured against explicitly configured recovery objectives |
| Test reproducibility | Run configuration, software revision, infrastructure details and raw results are retained |

These are engineering starting points, not existing TITech achievements, production SLAs or universal guarantees.

Before treating a target as binding, document its measurement scope, warm-up period, sample size, dependencies, exceptions and workload assumptions. Do not change the target retrospectively merely to convert a failed run into a pass.

External payment-provider latency must be reported separately from TITech’s internal processing latency.

Every capacity result must include at least:

- Offered request rate and achieved request rate.
- Concurrent virtual users and connected sessions, where applicable.
- Successful, failed, rejected and timed-out requests.
- p50, p95 and p99 latency.
- CPU and memory utilization.
- Database connection-pool and query metrics.
- Redis latency and connection usage where applicable.
- Queue depth, oldest-event age and processing delay where applicable.
- Event-loop lag and garbage-collection evidence where relevant.
- Network utilization and test-generator saturation.
- Financial correctness results.
- Test duration and termination reason.
- Infrastructure cost and resource configuration.

Averages alone are not acceptable evidence of tail performance.

---

## 10. PHASE FIVE — REMEDIATE APPLICATION BOTTLENECKS

Use profiling and measurements to guide changes.

Investigate:

- Synchronous CPU-heavy operations blocking Node.js event loops.
- Excessive JSON processing and object allocation.
- Large payloads and unbounded result sets.
- N+1 database queries.
- Missing, incorrectly ordered or inefficient indexes.
- Expensive aggregation pipelines.
- Repeated authorization or configuration queries.
- Inefficient serialization.
- Excessive logging on hot paths.
- Unbounded connection creation.
- Retry storms.
- Long-held locks.
- Unbounded background work.
- Redundant cache invalidation.
- Slow external dependencies blocking request completion.
- Memory leaks and unreleased timers, sockets or listeners.

Implement targeted improvements that preserve existing behavior and financial invariants.

Possible remediations include:

- Efficient pagination and database query patterns.
- Correct indexes validated using query execution statistics.
- Appropriate connection-pool limits.
- Caching of eligible, non-authoritative reads.
- Conditional requests or response compression when beneficial.
- Bounded concurrency for CPU-heavy and I/O-heavy processing.
- Timeouts and cancellation.
- Rate limiting and admission control.
- Properly bounded background queues.
- Reduced unnecessary payloads.
- Graceful shutdown and connection draining.

Do not cache mutable financial state without explicit consistency semantics, invalidation controls and a verified policy for authoritative reads.

A cache miss or Redis outage must not silently permit invalid financial decisions.

For every optimization, include:

1. Evidence of the original bottleneck.
2. The exact change made.
3. Regression coverage.
4. Before-and-after measurements, when safely measurable.
5. Any change to consistency, timeout or failure semantics.
6. Rollback requirements.

---

## 11. PHASE SIX — DATABASE AND DISTRIBUTED-DATA CAPACITY

Review the real MongoDB deployment requirements, Mongoose models, indexes, transaction usage and Redis responsibilities.

### MongoDB

- Verify required transaction support against the actual deployment topology.
- Test real transaction and concurrent-write behavior in an isolated replica-set environment.
- Audit pool sizing as application replicas scale.
- Measure query latency, lock contention, index usage and hot partitions.
- Eliminate unbounded queries and unsafe full-collection scans on hot paths.
- Evaluate tenant-scoped partition and index patterns.
- Define retention, archival and data-growth expectations.
- Verify behavior during primary failover and transient network errors.
- Test actual backup restoration and data consistency.

### Partitioning and sharding

Develop a measured partitioning plan based on observed query patterns, write distribution, tenant size and consistency requirements.

Evaluate tenant distribution, hot groups, large institutions, cross-tenant analytics and high-volume financial accounts.

Do not implement sharding merely to claim that the architecture is distributed. Document why the current topology is insufficient before making a major change.

If sharding is required, prove routing behavior, index compatibility, transaction boundaries, hot-key mitigation, rebalancing and failure recovery.

Financial partitioning must retain deterministic account ownership and safe transaction boundaries. Do not assume that a transaction spanning shards behaves like a single local database transaction.

### Redis and caching

Establish exactly what Redis is used for today.

If it supports cache, rate limiting, queues, sessions, distributed locks or idempotency coordination, test each role under real concurrent conditions.

Test restarts, failover, eviction, network partition, reconnect, queue recovery and duplicate-delivery behavior.

A Redis lock must not become the sole protection for money-moving operations unless its ownership, expiration, fencing and failure semantics are rigorously proved.

Ensure financial correctness survives a cache outage and that cache rebuilds cannot overwrite the authoritative ledger or balance source.

### Read/write separation

Separate analytical workloads from transactional financial workloads when this materially reduces contention.

Define consistency and staleness explicitly for replicas, materialized views, search indexes and reporting projections.

Never acknowledge a committed financial operation based only on an asynchronous analytics projection.

---

## 12. PHASE SEVEN — DISTRIBUTED APPLICATION AND GLOBAL INFRASTRUCTURE

Inspect and improve the existing deployment architecture incrementally.

When justified by measured demand, establish a path toward:

- Geographically distributed traffic entry.
- CDN and edge caching for appropriate non-sensitive content.
- Secure load balancing and API protection.
- Horizontally scalable, stateless application replicas where feasible.
- Resource-based and queue-based autoscaling where supported.
- Multiple availability zones or equivalent regional redundancy.
- Independent scaling of resource-intensive background workloads.
- Bounded inter-service connections.
- Health-aware traffic routing.
- Automated deployment and rollback.
- Isolated performance and disaster-recovery environments.

### Kubernetes and container operations

Where the repository’s Kubernetes infrastructure supports it, inspect:

- CPU and memory requests and limits.
- Startup, readiness and liveness probes.
- Horizontal pod autoscaling metrics and bounds.
- Pod disruption budgets.
- Topology-spread and anti-affinity policies.
- Graceful termination and connection draining.
- Rolling update strategy.
- Resource quotas and namespace boundaries.
- Autoscaler stabilization and scale-down behavior.
- Secrets management and network controls.
- Application shutdown while requests or financial jobs are in flight.

Do not add these settings mechanically without checking the deployed workloads and cluster model.

Validate scale-out and scale-in behavior under load. A pod count increasing is not proof of additional useful capacity.

### Global regions and financial consistency

Design explicit regional ownership and recovery behavior for financial writes.

Do not activate unrestricted multi-region active-active financial writes until duplicate prevention, regional ownership, fencing, conflict handling and recovery have been demonstrated.

Define what happens when:

- A region loses connectivity to another region.
- A financial partition becomes unavailable.
- An application instance retries after a timeout.
- A committed operation is not acknowledged to the caller.
- A replica is stale.
- A region is restored after a prolonged outage.
- Two regions attempt to modify the same logical financial state.

Where safety and availability conflict during a network partition, apply the documented financial consistency and authorization rules rather than inventing silent reconciliation.

Separate the application’s ability to continue reading eligible data from its ability to approve and commit new financial operations.

### External dependencies

Identify all synchronous and asynchronous dependencies.

Implement or verify appropriate:

- Per-dependency deadlines.
- Bounded retries with jitter where appropriate.
- Exponential backoff.
- Circuit breakers where beneficial.
- Concurrency limits.
- Admission control.
- Bulkheads or equivalent failure isolation.
- Dead-letter handling for eligible asynchronous events.
- Idempotent replay.
- Explicit timeout and unknown-outcome states.

Do not retry non-idempotent financial writes blindly.

A provider timeout does not necessarily mean the provider rejected the payment.

---

## 13. PHASE EIGHT — FINANCIAL CORRECTNESS UNDER EXTREME CONCURRENCY

Financial correctness is a release gate at every capacity stage.

Build or extend automated tests around the canonical TITech financial services. Reuse actual domain boundaries and business rules.

### Required concurrency tests

1. Simultaneous requests using the same idempotency key.
2. Simultaneous identical and conflicting transaction requests.
3. Competing mutations affecting the same account or financial resource.
4. Parallel transactions affecting different accounts.
5. Concurrent balance reads and committed writes.
6. Retries after client timeout.
7. Application crash during a transaction.
8. Database failover during a transaction.
9. Duplicate and out-of-order provider callbacks.
10. Worker crash after processing but before acknowledging an event.
11. Replayed offline synchronization batches.
12. Reversals and corrections during concurrent activity.
13. Duplicate event delivery after queue recovery.
14. Reconciliation while new operations arrive.

### Mandatory invariants

Prove with deterministic tests and post-test database inspection that:

- Every committed journal satisfies the repository’s balancing rules.
- Monetary values do not acquire duplicate effects through retries.
- Idempotency is enforced at the authoritative mutation boundary.
- A successful response corresponds to the documented committed state.
- An unknown external payment outcome remains recoverable and traceable.
- Reversals reference valid original transactions and obey reversal rules.
- An incomplete or ambiguous transaction cannot become silently successful.
- Balances comply with the actual account and overdraft rules.
- The audit trail links operations to their resulting state changes.
- Tenant authorization is checked server-side.
- Concurrent processing does not bypass maker-checker or equivalent approval controls.
- Reconciliation discovers discrepancies rather than silently suppressing them.

Use atomic transactions, unique database constraints, deterministic state transitions, conditional mutations and existing financial controls as appropriate.

Test transaction ordering and concurrent updates against a real supported database topology whenever possible. Mocks may supplement these tests but cannot substitute for live concurrency evidence.

For asynchronous processing, document the delivery semantics. Prefer durable delivery plus idempotent consumers over unsupported claims of universal exactly-once execution.

### Financial proof artefacts

Every financial-concurrency run must record:

- Initial test balances and account state.
- Number of submitted operations.
- Number of accepted and rejected operations.
- Committed and reversed operations.
- Duplicate attempts.
- Timeouts and unknown outcomes.
- Journal and ledger invariant results.
- Balance consistency results.
- Provider-event and reconciliation results.
- Final account states.
- Any unmatched or unexplained financial records.

**Acceptance criterion: zero unexplained monetary discrepancies.**

If the result cannot be reconciled, the relevant capacity gate fails even if the API latency and availability metrics pass.

---

## 14. PHASE NINE — MULTI-TENANT ISOLATION AND NOISY-NEIGHBOR TESTING

Generate synthetic tenants representing different institution sizes and workloads.

Include:

- Many small tenants.
- Several large tenants.
- One intentionally high-volume tenant.
- Tenants with unusually large record sets.
- Tenants performing simultaneous batch operations.
- Tenants experiencing high authentication or retry volume.

Test whether a large tenant can starve other tenants of database connections, worker capacity, queue slots or API capacity.

Verify tenant-scoped authorization under both normal and high-load conditions.

Enforce and test, as appropriate:

- Per-tenant quotas.
- Fair scheduling.
- Rate limits.
- Maximum batch sizes.
- Query deadlines.
- Resource isolation.
- Administrative action limits.
- Safe throttling of abusive clients.

Do not allow load-test-generated tenant traffic to bypass the same authorization and domain validations used by ordinary clients.

Any cross-tenant data disclosure or unauthorized financial mutation fails the release gate regardless of throughput.

---

## 15. PHASE TEN — SECURITY AND ABUSE RESILIENCE AT SCALE

Performance testing must not weaken security.

Verify existing authentication, authorization, session-management, input-validation and secret-handling boundaries.

Test high-volume authentication attempts, rate-limit enforcement, malformed payloads, oversized requests, slow clients, repeated callbacks, abusive batch submission and attempts to bypass tenant isolation.

Check that logs and metrics do not leak credentials, session tokens, personal records or unnecessary financial data.

Verify that metrics labels, tracing attributes and logs avoid unbounded cardinality from member IDs, tenant IDs, idempotency keys or other request-specific values.

Use aggregation and controlled diagnostic sampling when appropriate.

Do not add unauthenticated administrative diagnostics, unrestricted profiling endpoints or publicly exposed metrics simply to simplify testing.

Security regression tests must run alongside capacity tests. When a new dependency or infrastructure component is introduced, update the threat model, configuration, access policies and release checks.

External penetration testing remains independent evidence. Do not represent automated code scanning as an independent security assessment.

---

## 16. PHASE ELEVEN — RESILIENCE, CHAOS AND RECOVERY

Design a controlled failure-injection suite in an isolated environment.

Where supported by the real deployment, test:

- An application instance being terminated under load.
- A rolling deployment while requests are in flight.
- Sudden loss of a database primary.
- Transient database latency and connection failures.
- Redis restart or unavailability.
- Background worker termination.
- Queue backlog and consumer slowdown.
- A simulated payment-provider timeout or outage.
- Network delay and partial connectivity.
- Sudden traffic spikes.
- Resource exhaustion bounded by the test environment.
- Recovery after an interrupted deployment.
- Regional traffic failover when the required regional infrastructure exists.

Do not perform uncontrolled experiments against production.

### Required observations

During every failure test, record:

- Detection time.
- Time until service degradation becomes observable.
- Error and timeout behavior.
- Financial state transitions.
- Queue growth.
- Duplicate requests and deliveries.
- Containment of the failure.
- Recovery initiation.
- Time to restore the agreed service level.
- Whether any reconciliation is required.
- Whether the service recovered automatically or required operator action.

### Recovery objectives

Establish documented Recovery Time Objective (RTO) and Recovery Point Objective (RPO) values based on business and regulatory needs.

Do not invent evidence that a backup is restorable because a backup command completed. Restore it into an isolated environment and verify that the restored data is usable, consistent and appropriately scoped.

Test database backups, required supporting state, configuration restoration, deployment rollback and credential-rotation procedures using safe test environments.

A system that survives a crash but loses acknowledged financial transactions has failed the relevant resilience gate.

---

## 17. PHASE TWELVE — OFFLINE SYNCHRONIZATION AND BURST RECOVERY

TITech must remain safe when members reconnect after prolonged periods offline.

Inspect the existing offline-first implementation, data model and synchronization contracts.

Verify that:

- Synchronization batches have bounded size.
- Each operation has a durable identity and authorization context.
- Replayed operations are handled deterministically.
- Conflicting edits follow documented domain rules.
- Acknowledgements identify which operations were accepted, rejected or remain pending.
- Financial operations cannot be double-applied during retries.
- Synchronization does not bypass current membership, tenant or approval permissions.
- Large synchronization bursts do not exhaust the database or block interactive financial traffic.
- Backlog processing can be throttled and recovered after worker failure.
- Failed records remain observable and actionable.

Test small, medium and large synthetic synchronization batches, concurrent devices, duplicate submissions, out-of-order delivery and interrupted sessions.

Financial changes must use the authoritative transaction services. Do not turn an offline synchronization payload into a trusted balance update.

If an operation cannot be safely applied, retain a deterministic conflict or rejection state instead of silently discarding it.

---

## 18. PHASE THIRTEEN — OBSERVABILITY AND LIVE CAPACITY DIAGNOSTICS

Establish a consistent set of operational signals across frontend edge, API instances, financial services, databases and background workers.

Where applicable, implement or verify:

- Request rate and response latency.
- HTTP and domain error rates.
- Event-loop delay.
- CPU and memory.
- Garbage-collection behavior.
- Active database connections and query latency.
- Redis health and latency.
- Queue depth and oldest-event age.
- Background processing latency.
- Payment state transitions and reconciliation discrepancies.
- Per-tenant throttling and quota usage.
- Autoscaling actions.
- Circuit-breaker and retry activity.
- Deployment and recovery events.

Preserve the repository’s established observability stack where suitable.

Add request correlation across application boundaries without exposing secrets or personal data.

Use bounded metric labels. Do not create a separate time series for every user, request or idempotency key.

Health checks must be cheap, meaningful and safe. Readiness must represent the ability to accept the relevant traffic; it must not falsely report successful financial operation when a required critical dependency is unavailable.

Distinguish overall process health from dependency readiness and actual financial-operation capability.

Generate actionable alerts for abnormal financial discrepancies, queue growth, persistent latency regression, pool exhaustion, repeated restarts, recovery failures and sustained rejection.

Every failure test must have enough telemetry to explain the observed result. A test with insufficient telemetry is not adequate evidence.

---

## 19. PHASE FOURTEEN — CAPACITY MODELLING AND BILLION-SCALE DESIGN

Do not attempt to prove a billion-user operating envelope by extrapolating a single local benchmark.

Build an explicit capacity model from measured component performance.

The model must document:

- User activity assumptions.
- Read/write ratios.
- Peak-to-average burst ratio.
- Authentication and session costs.
- Average and peak request rates.
- Transaction cost and write amplification.
- Payload sizes and network usage.
- Database operation counts.
- Cache hit-rate assumptions.
- Queue and worker throughput.
- Connection counts and pool sizes.
- Regional distribution.
- Redundancy and failover requirements.
- Infrastructure cost assumptions.
- Limits of the model and uncertainty ranges.

Estimate resource needs from observed measurements. For each major component, identify whether it scales horizontally, vertically, by partition, through read separation or through workload reduction.

Build an explicit bottleneck and failure-dependency map.

### Architecture decisions that require proof

Evaluate, rather than automatically mandate:

- Multi-region entry and traffic distribution.
- Database partitioning and read scaling.
- Isolation of long-running workloads.
- Dedicated worker pools.
- Queue partitioning.
- Tenant-level workload controls.
- Regional financial ownership.
- Locality-aware reads.
- Data lifecycle and archival.
- Recovery capacity reserved for regional failure.
- Automated scaling stability.
- Capacity headroom during deployments.

For each major option, document its expected benefit, implementation complexity, operational cost, consistency impact, migration and rollback requirements, and evidence supporting the decision.

Do not claim that adding a queue, another database, more pods or more regions automatically multiplies system capacity linearly.

### Billion-scale proof standard

A modelled capacity of 1.5 billion concurrent members is not the same as a system tested with 1.5 billion members.

A final billion-scale claim requires a defined workload and clear evidence covering the required connection and request rates, production-equivalent deployment architecture, database capacity, regional failure behavior, financial integrity, load-generator validity and independent verification.

If a full-scale test is not performed, the result must be recorded as **not yet verified**, even if component benchmarks and a capacity model look promising.

---

## 20. PHASE FIFTEEN — CI/CD AND AUTOMATED RELEASE GATES

Integrate the new tests with the existing development and release pipeline.

Do not create duplicate or conflicting master gates.

At minimum, establish or update the appropriate gates for:

1. Dependency installation and runtime compatibility.
2. Frontend and backend builds.
3. Unit and integration tests.
4. Financial invariants and concurrency regressions.
5. Security and dependency scanning.
6. API contract and E2E tests.
7. Deployment and configuration validation.
8. Performance smoke tests.
9. Capacity regression tests.
10. Release-evidence and production-approval checks.

Separate inexpensive per-commit checks from costly scheduled or manually authorized distributed performance tests.

Performance-test results must be compared against a defined baseline. Material regression must be visible and must fail the relevant gate.

Do not allow a performance test to pass because it never generated the target load. Record achieved versus requested throughput and the integrity of the generator metrics.

Use existing scripts and gate naming conventions. Suggested script names are optional and must not replace working canonical scripts without justification.

All release gates must produce machine-readable output and meaningful exit codes.

No gate may elevate a status merely because the latest test file exists or its name includes words such as `enterprise`, `production` or `passed`.

---

## 21. PHASE SIXTEEN — REQUIRED DELIVERABLES

Implement the work in the actual repository and create or update these deliverables, adapting paths to existing conventions.

### A. Implementation and tests

- Repaired or enhanced application code.
- Regression tests for each remediated defect.
- Reproducible performance-test scenarios.
- Synthetic test-data generation.
- Financial concurrency and failure-recovery tests.
- Appropriate environment configuration and safe test scripts.
- CI/CD integration for suitable verification stages.
- Necessary deployment and operational configuration changes.

### B. Scalability evidence

Produce a capacity and performance report containing:

- Tested application and repository version.
- Environment and component configuration.
- Test-tool version and generator details.
- The exact workload and run configuration.
- Requested and achieved throughput.
- Concurrent virtual users and measured connection counts.
- Latency percentiles and error rates.
- Resource utilization and identified bottlenecks.
- Financial-invariant results.
- Test start/end times and durations.
- Raw or suitably detailed machine-readable results.
- Failed thresholds and aborted runs.
- Cost measurements or the limits of available cost evidence.

### C. Architectural and operational evidence

Produce a scalability architecture assessment and prioritized remediation plan.

Document data partitioning, connection budgets, regional boundaries, failure dependencies, recovery requirements and cost drivers.

Update deployment, scaling, rollback, backup/restore and operational runbooks where changes require them.

### D. Readiness and traceability

Update the appropriate canonical readiness documents and evidence matrix.

Each significant finding must identify:

- Unique finding ID.
- Severity.
- Affected capability.
- Evidence or reproduction command.
- Root cause.
- Remediation performed.
- Tests added or updated.
- Result and artefact location.
- Outstanding external dependency.
- Whether the finding blocks a specific release gate.

Do not create several contradictory readiness documents when an authoritative document already exists.

### E. Final execution report

At the end, state:

- What changed.
- Why it changed.
- Which files were changed.
- Which commands were executed.
- Which commands passed and failed.
- Which tests were not run and why.
- Which tests were mocked versus executed against real infrastructure.
- What performance was actually measured.
- What capacity remains modelled or unproven.
- Which findings remain blocking.
- Whether the current production-readiness status changed and the exact evidence supporting that decision.

---

## 22. ACCEPTANCE CRITERIA

Work is acceptable only when the evidence supports each claimed result.

### Code and runtime

- Existing application boundaries are preserved or their changes are explicitly justified.
- The supported toolchain has been verified.
- Relevant installation, build, startup and test paths have been exercised where possible.
- Critical regression tests are executable.
- Changes do not introduce authentication, authorization or secret-handling bypasses.

### Financial integrity

- Critical financial invariants hold under controlled concurrency.
- Idempotency survives duplicate requests and retries.
- Failure states remain traceable.
- Reconciliation discovers discrepancies.
- No unexplained financial discrepancy is accepted as a successful result.

### Performance

- A working, repeatable performance-test suite exists.
- The workload and pass/fail criteria are documented.
- The achieved workload matches the claimed workload.
- Results contain percentile latency, error rates, resource utilization and generator-health measurements.
- Capacity claims refer to the exact tested environment and duration.
- Bottlenecks are supported by evidence rather than speculation.

### Resilience

- Overload protection is exercised.
- Failure injection is controlled and reproducible.
- Recovery outcomes are measured.
- Backup restoration and deployment rollback are verified where the relevant environment exists.
- Financial state remains correct across the tested failure scenarios.

### Governance and status

- External dependencies are not fabricated.
- Missing partner, regulatory, infrastructure or independent security evidence remains explicitly unresolved.
- Production approval is determined by evidence, not source-code presence.
- The tested capacity and the global-scale ambition remain clearly separated.

A passing code build is not a capacity certificate. A passing load test is not automatically a production-approval certificate. A theoretical capacity model is not live operational proof.

---

## 23. REQUIRED EXECUTION ORDER

Follow this order, with each stage feeding the next:

**Stage A — Discover and baseline.** Inspect repository truth, preserve changes, run the existing gates and establish the initial defect inventory.

**Stage B — Repair critical execution blockers.** Fix runtime, dependency, build, test-discovery and readiness defects blocking trustworthy validation.

**Stage C — Protect financial invariants.** Verify the canonical financial path and remediate concurrency, retry, transaction or reconciliation defects before increasing load.

**Stage D — Build the test foundation.** Implement realistic, repeatable load scenarios, synthetic datasets, thresholds, stop conditions and evidence capture.

**Stage E — Measure before optimizing.** Run a controlled baseline and profile the actual bottlenecks.

**Stage F — Remediate and benchmark.** Improve the limiting components and compare measured results using equivalent workloads.

**Stage G — Prove resilience.** Test overload, dependency failures, financial retries, recovery and tenant isolation.

**Stage H — Scale progressively.** Advance through capacity gates only when the preceding gate passes and safe resources are available.

**Stage I — Develop the global capacity model.** Use measured results to plan higher-scale infrastructure, regional separation, database growth and operating costs.

**Stage J — Report and gate.** Update canonical documentation, publish the evidence and assign the correct readiness status.

Do not interpret this sequence as permission to stop at documentation. Implement every safe and feasible engineering change in the available working environment.

If a phase cannot be completed because a real external dependency is unavailable, continue with independent work that is safe, keep its evidence boundary explicit, and do not simulate a successful external result.

---

## 24. FINAL RESPONSE CONTRACT

After implementation and verification, finish with a direct, evidence-backed report.

Use the following sections:

1. **Executive result:** what is now demonstrably better.
2. **Repository baseline:** the starting commit, environment and verified initial status.
3. **Implemented changes:** grouped by runtime, financial integrity, performance, infrastructure, security and testing.
4. **Test execution:** actual commands, outcomes, durations and relevant logs or artefacts.
5. **Measured performance:** actual throughput, latency percentiles, errors, concurrency and resource use.
6. **Financial-integrity evidence:** exact invariant results and any remaining discrepancies.
7. **Failure and recovery results:** scenarios tested, recovery measurements and failures.
8. **Highest demonstrated capacity:** the largest capacity gate that passed, precisely defining what was concurrent and for how long.
9. **Remaining blockers:** source, runtime, infrastructure, provider, security, legal, regulatory, pilot or operational limitations.
10. **Capacity decision:** what TITech supports today, what is modelled, and what remains unproven.
11. **Production approval:** approved or not approved, with the evidence supporting the decision.
12. **Next release gate:** the smallest set of high-priority actions needed to advance safely.

Never report a test as passing if it was not actually executed. Never describe an environment as production-equivalent without verifying its material differences. Never claim an independently verified result without independent evidence.

### Final governing instruction

Engineer TITech toward global scale, but release it according to demonstrated capability.

The immediate goal is not to advertise 1.5 billion concurrent active users. It is to establish a repeatable, financially correct, secure and measurable scaling process, prove the largest safe workload available in the real test environment, and build the architectural and operational evidence needed to progress toward larger global capacity.

**The platform must remain financially correct under failure, and no scalability claim may exceed the strongest evidence supporting it.**