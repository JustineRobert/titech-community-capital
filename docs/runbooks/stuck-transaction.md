# Runbook — Stuck Financial Transaction

1. Locate the transaction timeline using the correlation ID.
2. Determine whether the payment is provider-pending, unknown, ledger-pending, settlement-pending or reconciliation-pending.
3. Apply only the retry/status/recovery policy for that state.
4. Confirm idempotency before every retryable operation.
5. Escalate to `REQUIRES_REVIEW` where external truth is ambiguous.
6. Verify final state, ledger and reconciliation before closing the incident.
