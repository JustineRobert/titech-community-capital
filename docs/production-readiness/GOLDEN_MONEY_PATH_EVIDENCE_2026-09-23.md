# Golden Money Path Evidence — 2026-09-23

## Evidence classification

**TESTED — dependency-free reference harness**

This evidence demonstrates the financial invariants represented by the repository's canonical architecture. It does not claim external provider connectivity, live database/Redis behavior, regulator approval, or production deployment approval.

## Reference scenario

```text
UGX 50,000
-> authenticated/tenant-scoped operation
-> idempotency
-> provider request
-> provider timeout
-> UNKNOWN
-> server restart
-> status query
-> provider confirms SUCCESS
-> callback arrives twice
-> exactly one ledger posting
-> balance projection
-> settlement
-> reconciliation
-> receipt
-> reversal
```

## Proven locally by the reference harness

| Control | Status | Evidence |
|---|---|---|
| One logical payment per idempotency key | TESTED | `reports/evidence/golden-money-path-proof.json` |
| Same key + changed financial payload | TESTED | `IDEMPOTENCY_CONFLICT` assertion |
| Provider timeout is not blind failure | TESTED | timeout -> UNKNOWN -> status query |
| Restart recovery | TESTED | serialized/restored state |
| Duplicate callback | TESTED | callback identity deduplication |
| Stale/out-of-order callback | TESTED | no downgrade after authoritative success |
| Tenant isolation | TESTED | cross-tenant access assertion |
| Currency mismatch | TESTED | fail-closed initiation assertion |
| Double-entry invariant | TESTED | debits == credits |
| Reversal | TESTED | compensating entry + rebuilt balance |
| Reconciliation mismatch | TESTED | explicit mismatch/review path |
| Offline replay | TESTED | replay resolves to original operation |
| Receipt gating | TESTED | settlement + reconciliation required |
| Audit coverage | TESTED | lifecycle event assertions |

## Not yet environment-verified

- MTN/Airtel production credentials and provider SLA behavior.
- Real MongoDB transactional/concurrency behavior under the target deployment topology.
- Real Redis locks/idempotency behavior under multi-instance load.
- Network partitions and process-kill testing in staging.
- Actual backup/restore execution against a staging database.
- Pilot institutions and operational support workflow.
- Regulatory authorization, safeguarding arrangements and partner contracts.

## Readiness interpretation

The evidence supports **TESTED** for the reference lifecycle. It does not by itself advance any capability to `PILOT-VERIFIED` or `PRODUCTION-APPROVED`.
