# Rollback Runbook

## Rule

Rollback must be a controlled deployment operation. Never “fix” a financial data problem by destructive database rollback.

## Steps

1. Declare incident/change rollback.
2. Freeze non-essential financial mutation if necessary.
3. Capture correlation IDs and current settlement/reconciliation state.
4. Revert application artifact/configuration to last known-good version.
5. Validate schema compatibility before rollback.
6. Run health/readiness checks.
7. Validate financial invariants.
8. Re-run reconciliation for the affected window.
9. Review duplicate/replay risk.
10. Document outcome and approval.

## Required drill

At least one successful controlled rollback must be evidenced before production infrastructure readiness is declared.
