# Runbook — Provider Outage / Timeout

## Symptoms

- Provider timeout/error rate rises.
- Payment attempts remain `UNKNOWN`/pending.
- Callback latency increases or stops.

## Safe actions

1. Confirm provider health and correlation IDs.
2. Stop blind re-initiation of ambiguous payments.
3. Run provider status queries for affected references.
4. Keep `UNKNOWN` transactions in controlled recovery.
5. Monitor reconciliation exceptions.
6. Record incident and operator actions in audit.

## Prohibited

- Do not mark UNKNOWN payments as failed without provider evidence.
- Do not create a second payment for a timed-out provider request.
- Do not edit ledger entries to compensate for an external outage.
