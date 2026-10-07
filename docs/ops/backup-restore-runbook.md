# Backup / Restore Runbook

## Backup requirements

- automated backup schedule;
- encryption at rest;
- restricted access;
- retention policy;
- restore-point identification;
- monitoring of backup failures.

## Restore drill

1. Select an approved restore point.
2. Restore to an isolated environment.
3. Run schema/index validation.
4. Run financial invariant checks.
5. Run reconciliation consistency checks.
6. Verify tenant isolation.
7. Measure RTO/RPO.
8. Record evidence and sign-off.

A backup file existing is not evidence of a successful restore.
