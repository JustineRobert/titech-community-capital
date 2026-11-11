# Backend API Recovery Runbook

**Organization:** TITech Capital SMC LTD  
**Product:** TITech Community Capital

## 1. Purpose

Recover the existing Express ESM backend while preserving MongoDB `community_savings`, the existing Redis `titech:` namespace, auth/session, tenant isolation, RBAC, audit, payment, ledger and reconciliation services.

## 2. Preflight

```bash
node --version
npm --version
git status --short
```

Use Node `>=24.15.0` and npm `>=11.0.0`. Inspect the operator's existing environment and `.env.example` files; do not display or copy live secrets into logs or reports.

## 3. Reproducible dependencies and code checks

```bash
npm --prefix backend ci
npm --prefix backend run check:bootstrap
npm --prefix backend run check
npm --prefix backend run test:control-plane
npm --prefix backend run test:financial
npm --prefix backend run test:integration
```

Run all applicable backend unit/integration/provider suites. Use the real test database and Redis service for integration tests; mocks only prove the mocked boundary.

## 4. Dependency readiness

Verify MongoDB connection to the configured `community_savings` database, required replica-set/transaction support, connection pool, indexes and query timeouts. Verify Redis connection, namespace, TTL, rate-limit and idempotency/session behaviours. If either critical dependency is unavailable, readiness must fail closed where the dependency is mandatory.

Never drop collections, reset the database, delete indexes indiscriminately, truncate queues or apply irreversible migrations as a troubleshooting shortcut.

## 5. Health and readiness

Check:

```bash
curl -i http://localhost:5000/api/v1/health
curl -i http://localhost:5000/api/v1/ready
```

Health/liveness and readiness must remain distinct. A process starting does not prove that MongoDB, Redis, migrations/indexes, queues or mandatory dependencies are ready. Capture status, correlation ID, dependency state and timestamp.

## 6. Financial safety

- Use synthetic test records only.
- Do not initiate live provider payments.
- Preserve `UNKNOWN` for uncertain provider outcomes.
- Verify idempotency and database uniqueness under concurrent requests.
- Verify balanced double-entry journals and atomic rollback.
- Use explicit reversal/adjustment records; never edit posted financial entries.
- Ensure callbacks are authenticated, replay-safe and routed through the canonical transaction/ledger path.
- Verify tenant scope in controllers, services, repositories, jobs, exports and audit records.

## 7. Logs and observability

Correlate browser request ID, API middleware, controller, service, database/provider reference and audit event. Logs must exclude passwords, JWTs, refresh cookies, API credentials, private KYC evidence and unnecessary personal data. Keep original exception details in protected server logs; return safe error envelopes to clients.

## 8. Recovery and shutdown

For process recovery, use the existing service manager/container orchestration. Gracefully stop accepting new requests, drain jobs, flush durable outbox work where safe, close Redis and MongoDB, then restart. Do not replay financial outbox messages or provider calls manually without idempotency and reconciliation checks.

## 9. Restore and incident response

Restore backups into an isolated environment first. Verify data consistency, indexes, ledger balances, financial transaction counts/control totals, evidence object references, tenant mapping and application readiness before any cutover. Record actual recovery time; do not claim RPO/RTO without a timed drill.
