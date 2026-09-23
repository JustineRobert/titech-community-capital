# Runbook — Duplicate Callback

1. Identify provider event ID/reference and correlation ID.
2. Verify tenant association.
3. Confirm callback idempotency record.
4. Confirm only one state-transition effect and one ledger posting.
5. If a duplicate changed financial state, open a reconciliation exception immediately.
6. Record the investigation in the audit trail.
