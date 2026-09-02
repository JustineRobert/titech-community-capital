
---

# 17.6 — docs/retry/troubleshooting.md

```markdown
# Troubleshooting Guide


## Retry Exhausted


Symptoms:


Retry attempts exhausted



Check:

- dependency availability
- policy configuration
- classification rules


## High Retry Volume


Possible causes:

- provider outage
- database latency
- network problems


Check:

- retry metrics
- dashboards
- traces


## Duplicate Payment Prevention


Verify:

- Idempotency-Key
- transaction reference
- ledger transaction ID