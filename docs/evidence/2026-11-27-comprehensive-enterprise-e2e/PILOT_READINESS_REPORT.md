# First-institution pilot readiness — 27 November 2026

## Recommended pilot posture

**Controlled, read-only shadow reconciliation only**, after the supported runtime, dependencies, operational security and data-processing agreements are established. The first customer profile remains one Uganda SACCO or non-deposit-taking MFI. A 500–5,000 member/account scope is a proposed planning range, not an achieved deployment or a tested capacity claim.

## What can be demonstrated from the current source

- Tenant-scoped application foundations and role/permission contracts.
- Existing finance/member/savings/payroll and specialist domain structure.
- BankConnect local statement-file parser/evidence storage foundations.
- CSV/XLSX/MT940 and constrained CAMT parser contract tests (9/9 PASS).
- A BankConnect UI and integration-health states that do not claim live bank connectivity.
- Official organization identity and theme contracts.

## What prevents pilot acceptance today

- No supported Node/npm runtime or installed frontend/backend dependencies in this runner.
- No live app startup against MongoDB/Redis.
- No real institution, authorised data feed, test data agreement, consent record or pilot acceptance letter in the evidence supplied here.
- BankConnect statement evidence is not yet wired through the canonical reconciliation matcher and canonical ledger; this gap is explicitly documented by the module status.
- No live MTN MoMo provider feed; configuration and callback authentication are missing in this runner.
- No operational backup/restore, incident runbook rehearsal, tenant-attack test, security review or privacy impact review was executed.

## Pre-pilot checklist

1. Obtain written institution pilot scope, controller/processor roles, data-sharing authority and retention instructions.
2. Use synthetic test records to validate parsing, tenant isolation and audit before any institution records are uploaded.
3. Configure malware scanning and bank evidence encryption in a controlled environment.
4. Select one lawful read-only source: statement file export or authorised provider evidence feed.
5. Reconcile imported rows to institution-supplied obligations through a validated mapping; no write-back to institution books.
6. Require maker-checker for ambiguous/manual exceptions.
7. Export reproducible results and preserve unmatched/duplicate evidence.
8. Measure baseline manual hours, eligible-match rate, exception rate and reconciliation turnaround.
9. Obtain institution sign-off before labelling the environment a pilot.

## Proposed targets (not achieved results)

- >=95% automated match rate for eligible, well-structured rows.
- 100% traceability/visibility of unmatched rows.
- Zero unexplained differences and duplicate canonical postings.
- Reconciliation within one working day of agreed cutoff.
- Measurable manual-work reduction, compared with a recorded baseline.

No pilot/customer/adoption result is claimed in this report.
