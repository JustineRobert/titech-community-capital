# Community Institution Pilot — Operational Runbook (Controlled / Not Activated)

## 1. Current control state

This runbook is a preparation artifact. It does not create or approve a pilot record. The repository contains a pure readiness helper (`backend/modules/pilot/pilotReadiness.js`) and an insurer-specific onboarding profile, but the inspected active route registry contains no persistent general group-pilot CRUD/review workflow. A checklist with booleans is not proof of completed controls.

Do not activate a pilot or process real funds based solely on this document.

## 2. Pre-pilot evidence bundle

For each institution and pilot, retain evidence for:

1. Institution application, registration evidence and independently confirmed legal status.
2. Activity-specific regulatory/competent-authority authorization where required.
3. Executed institution/partner agreement and data-processing agreement.
4. Documented data controller/processor roles, lawful basis, data minimization, retention and subject rights.
5. Tenant ownership and separation review.
6. Named pilot owner and escalation contacts on both partner and TITech sides.
7. Approved groups, member population, territory, currencies, scope and feature flags.
8. Role assignments and maker-checker thresholds.
9. Identity/KYC/consent policies including any approved alternative credential procedure.
10. Financial account mapping, contribution instructions, amount limits, settlement/reconciliation procedure and reversal approvals.
11. Supported provider sandbox evidence and callback validation evidence.
12. Backup/restore test, monitoring/alerts, security incident plan and support coverage.
13. Staff/member training and accessibility/low-bandwidth field test.
14. Acceptance criteria, review schedule, stop conditions and exit plan.

## 3. Suggested lifecycle mapping

Use a persisted lifecycle aggregate and explicit transition policy when implemented. The current helper names `PROSPECT`, `QUALIFIED`, `AGREEMENT_PENDING`, `ONBOARDING`, `CONTROLLED_GO_LIVE`, `OPERATIONAL_PILOT`, `EXPANSION_REVIEW`, `CLOSED`. Do not silently conflate these with the legacy SACCO `DRAFT`/`LIVE` statuses. Define a migration/compatibility map before unifying lifecycle owners.

## 4. Pre-activation checks

- [ ] Institution legal identity independently checked.
- [ ] Applicable licences/permissions checked against named regulator/authority and valid date range.
- [ ] Partner approval is current and signed.
- [ ] Tenant has correct legal sponsor/owner.
- [ ] Two test tenants pass cross-tenant access attempts.
- [ ] Admin, finance, reviewer, auditor and member accounts have least-privilege roles.
- [ ] Maker-checker rules tested using separate actors.
- [ ] KYC and consent workflows, data access and retention tested.
- [ ] Group type classification and financial model policy agreed.
- [ ] Group financial account mapping configured and reconciled.
- [ ] Contribution amount/currency/fee contract approved.
- [ ] Provider sandbox callback authenticity/replay and unknown state tested.
- [ ] Ledger journals balanced and transactions idempotent.
- [ ] Statements/receipts match ledger and reconciliation outcomes.
- [ ] Backup restore drill, observability, support and incident drills completed.
- [ ] Staff training, accessibility and low-bandwidth recovery demonstrated.
- [ ] External partner, insurer, privacy/legal and regulatory approvals recorded where needed.

## 5. Safe stop / rollback triggers

Suspend new activity and escalate if any of the following is observed:

- Tenant leakage or unauthorized record/file access.
- Unauthorized or ambiguous approval.
- Duplicate contribution/posting or unbalanced journal.
- Provider outcome remains `UNKNOWN` past the defined escalation threshold.
- Provider callback verification failure or settlement mismatch.
- Missing/inaccurate receipt or unreconciled account position.
- Loss of audit trail or inability to identify the responsible actor.
- Data breach or misuse of participant credentials.
- Partner agreement/authorization expires, is withdrawn or is suspended.
- Backup restore, monitoring or incident response is unavailable.

Do not erase financial history to roll back. Stop new instructions, preserve evidence, reconcile pending outcomes and use authorized compensating operations.

## 6. Review and exit

Review actual outcomes from persisted data only. Track institutions, active groups, unique active members, pending/verified identity counts, real completed contributions, confirmed/failed/unknown provider outcomes, ledger posting status, reconciliation match rate and open exceptions. Null/missing values remain unknown, not zero. Close/exit must preserve audit and financial history and return or delete partner data in accordance with the signed data agreement.

## 7. Current hard blockers

- No persistent general pilot lifecycle management API/UI.
- No verified real partner agreement or external authority record supplied in this execution.
- No group-to-financial-account map.
- No group contribution UI/payment provider journey.
- No running DB/provider/restore/browser evidence from this environment.
- No production approval.
