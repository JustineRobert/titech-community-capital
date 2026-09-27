# TITech Community Capital

# Golden Money Path

**Reference proof:** `scripts/golden-money-path-proof.mjs`  
**Reference evidence:** `reports/evidence/golden-money-path-proof.json`

Canonical lifecycle:

`Institution → Tenant → Group → Member → Contribution → Payment Intent → Provider → Callback → Transaction → Ledger → Balance → Receipt → Outbox → Settlement → Reconciliation → Audit`

The repository includes a dependency-free reference harness that proves core invariants against a provider simulator. This is **not** external provider or production evidence.

A production E2E evidence record must be created as `reports/golden-money-path-e2e.json` and must record the actual environment, commit, transaction references, ledger entries, settlement, reconciliation and audit reconstruction.
