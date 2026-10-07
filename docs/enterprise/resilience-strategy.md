# Resilience Strategy

## Failure catalogue

- MongoDB unavailable.
- Redis unavailable.
- Provider timeout.
- Provider HTTP 5xx.
- DNS/network failure.
- Duplicate callback.
- Delayed callback.
- Callback after reversal.
- Process restart.
- Queue delay/backlog.
- Expired credentials.
- Stale provider configuration.
- Deployment interruption.

## Required behavior

Every failure maps to:

```text
Detection
→ containment
→ retry policy
→ user-visible state
→ financial safety decision
→ recovery
→ reconciliation
→ audit evidence
```

Financial failures must fail closed. A provider timeout must never be converted automatically to “FAILED” when the actual external outcome is unknown.

## Recovery objectives

Define per environment and customer contract:

- RTO
- RPO
- maximum tolerated reconciliation lag
- maximum callback backlog
- maximum manual exception age

The values are customer/contract dependent and must not be invented in code defaults.
