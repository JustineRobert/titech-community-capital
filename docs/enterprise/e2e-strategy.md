# End-to-End Strategy

## Production artifact rule

The E2E suite must validate the exact artifact produced by the build step, not source files in isolation.

## Critical browser flows

1. Login → tenant selection → dashboard.
2. Institution onboarding → group → member.
3. Create contribution/payment intent.
4. Provider callback/status lifecycle.
5. Success → financial transaction → ledger → receipt.
6. Duplicate submission → one financial effect.
7. Callback replay → zero additional financial effect.
8. Provider timeout → UNKNOWN/RECONCILIATION_REQUIRED.
9. Reversal/refund → compensating financial effect.
10. Reconciliation exception → investigation → resolution.
11. Maker-checker approval for manual adjustment.
12. Tenant-isolation denial across two tenants.

## Evidence artifact

Each E2E run must record:

```text
commit / archive hash
build artifact hash
environment
Node/npm version
browser version
test run ID
correlation IDs
provider references
financial transaction IDs
ledger/journal references
reconciliation result
screenshots/video where appropriate
failures and rerun history
```
