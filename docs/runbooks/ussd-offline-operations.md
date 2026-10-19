# USSD and Offline Operations Runbook

**Organization:** TITech Capital LTD  
**Product:** TITech Community Capital  
**Status:** Preparatory runbook; use only after environment-specific review

## Safe initial configuration

Keep `TITECH_USSD_ENABLED=false`, `TITECH_OFFLINE_SYNC_ENABLED=false`, and `TITECH_OFFLINE_RECONCILIATION_ENABLED=false` until the corresponding provider, device-key, persistence, idempotency, receipt, financial and security gates have documented evidence. Never enable flags to bypass a `NOT_READY` status.

## Readiness reports `NOT_READY`

1. Read the structured blocker list from the canonical readiness endpoint / application logs.
2. Confirm MongoDB topology supports the transactions required by the configured processor; do not downgrade to non-atomic writes.
3. Confirm the durable sync cursor, durable idempotency reservation, receipt adapter, device registration verifier, event-signature verifier, transaction boundary, atomic offline processor, audit/outbox and reconciliation adapters are registered in the canonical application service container.
4. Check configuration and secret availability without exposing values in logs.
5. Re-run the required unit, route/HTTP, MongoDB replica-set, Redis, browser and release-gate tests.
6. Enable only the exact approved capability in a controlled non-production environment after the readiness contract is green.

## MongoDB or Redis outage

- Fail closed for new sync operations when required dependencies cannot establish their safety guarantees.
- Do not treat a lost Redis session/idempotency key as proof that a financial event is new; MongoDB/durable transactional idempotency remains authoritative.
- Do not replay with a new idempotency key. Inspect the authoritative transaction/event first.
- Restore the dependency, verify consistency, then retry using the existing event and idempotency identities.

## Pending or unknown provider outcome

- Keep the transaction pending/indeterminate.
- Query the provider's documented status interface or run the authorized reconciliation procedure.
- Do not issue a second collection or payout merely because a USSD session or browser request timed out.
- Escalate mismatches to the authorized operations/maker-checker role, preserve evidence, and post reversals only through the existing reversal domain process.

## Suspected device compromise

- Revoke the device centrally through the approved administration workflow.
- Verify revocation is observed by all service instances; do not rely on unbounded caches.
- Preserve already accepted event and transaction evidence; do not delete committed ledger history.
- Review its last synchronization and transaction references, and refer anomalies to security/financial operations.
- Require re-registration and proof of possession through the approved device-key workflow before the device can be re-authorized.

## USSD provider outage

- Keep the user-facing response accurate and within the provider's documented message constraints.
- Do not claim payments settled while the provider status is unknown.
- Correlate callback identifiers with transaction IDs and reconciliation records.
- Re-enable only after the provider recovers and the runbook's approved validation checks pass.

## Release evidence to retain

Record the runtime versions, exact commands and exit codes, database topology, service readiness output, provider sandbox artifacts, browser end-to-end traces, transaction/idempotency/reversal proofs, security findings, restore/rollback drill results and approved release decision. Mark missing evidence as blocked; never invent a pass.
