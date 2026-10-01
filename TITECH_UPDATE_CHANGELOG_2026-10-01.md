
# TITech Update Changelog — 2026-10-01

## Enterprise Payroll & Financial Control Enhancement

- Added deterministic payroll batch state machine.
- Added maker-checker approval workflow and separation-of-duties enforcement.
- Added employer onboarding domain model.
- Added employee/member payroll domain model.
- Added persisted payment-attempt evidence.
- Added webhook event deduplication and payload hashing.
- Added strict approval gate before payroll processing.
- Added retry classification to prevent blind retries of known non-retryable failures.
- Added payroll state/money-safety unit tests.
- Added security/compliance evidence register.
- Added implementation change discovery index.
- Added official theme audit to CI quality gates.

## Production evidence boundary

Source implementation does not by itself establish live provider, regulatory, deployment, restore, DR, penetration-testing, or production-approval evidence. Those remain explicit external/operational gates.
