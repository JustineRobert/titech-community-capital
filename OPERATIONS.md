# Operations

Operational readiness requires structured logs, request/correlation IDs, health/readiness/liveness endpoints, financial metrics, payment/reconciliation metrics, alerts, queue observability and documented incident procedures.

No backup is considered sufficient evidence until a restore test has succeeded and been recorded.

## 2026-09-22 operations control plane

Operational support is represented as tenant-scoped cases with priority, lifecycle, SLA target and linked evidence. The new operations API is under `/api/v1/operations/cases`.

Minimum incident reconstruction path:

```text
Case
 ↓
Request / Correlation ID
 ↓
Payment / Provider / Ledger references
 ↓
Reconciliation exception
 ↓
Evidence
 ↓
Decision / Repair / Resolution
```

No support action is permitted to mutate financial truth directly.
