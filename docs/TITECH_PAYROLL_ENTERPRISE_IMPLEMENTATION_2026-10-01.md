# TITech Community Capital — Enterprise Payroll Implementation

**Date:** 2026-10-01  
**Product:** TITech Community Capital  
**Organization:** TITech Africa  
**Primary market:** Uganda  
**Implementation scope:** Employer Payroll Disbursement integrated with existing TITech payments, financial gateway, reconciliation, audit, tenancy and branding contracts.

## 1. Repository-first finding

The repository already contained a payroll module under `backend/modules/payroll/` with CSV validation, MTN/Airtel provider gateways, idempotency, provider webhook verification, employer callback subscriptions, reconciliation hooks and a financial gateway boundary. The implementation therefore **enhances and consolidates the existing payroll subsystem** rather than creating a parallel V2 application.

## 2. Implemented in this change

- Explicit payroll batch lifecycle/state machine.
- Maker-checker submit/approve/reject workflow.
- Same-user maker/checker segregation-of-duties enforcement.
- Immutable approval-history records.
- Employer onboarding domain record with KYC/compliance/risk status fields.
- Employee/member-facing payroll identity record with employment, consent and verification states.
- Employee upsert/list API contracts.
- Persisted payment-attempt evidence for each provider attempt.
- Provider webhook event-ID deduplication with payload hash evidence.
- Strict processing gate requiring approval before disbursement.
- Retry filtering so known non-retryable provider errors are not blindly retried.
- Existing financial gateway remains the authoritative posting boundary.
- Existing provider adapters remain the provider abstraction boundary.
- Official TITech theme remains the canonical visual system across the platform; no parallel color palette is introduced.

## 3. Evidence classification

| Capability | Current evidence status |
|---|---|
| Payroll CSV validation | UNIT TESTED |
| Payroll lifecycle state machine | UNIT TESTED |
| Maker-checker separation | UNIT TESTED |
| Employer model | IMPLEMENTED BUT NOT VERIFIED |
| Employee model/API | IMPLEMENTED BUT NOT VERIFIED |
| Provider adapter boundary | IMPLEMENTED BUT NOT VERIFIED against live provider |
| Provider webhook signature | UNIT TESTED |
| Provider webhook deduplication | IMPLEMENTED BUT NOT VERIFIED with live provider |
| Payment-attempt evidence | IMPLEMENTED BUT NOT VERIFIED under production concurrency |
| Financial posting | IMPLEMENTED through existing canonical gateway; external evidence required |
| Reconciliation | IMPLEMENTED through existing provider/financial machinery; external evidence required |
| Multi-tenancy | Existing architecture retained; targeted payroll integration tests remain required |
| MFA | Existing identity/security capability; production validation remains required |
| Backup/restore | Existing operational documentation; restore drill evidence remains required |
| Disaster recovery | Existing architecture/documentation; failover evidence remains required |
| Official TITech theme | VERIFIED by repository theme audit |

## 4. Production boundary

This change does not claim live provider settlement, regulatory approval, certification, investor commitment, uptime, or production approval. Those require external evidence and operational gates.

## 5. Canonical financial path

`Employer -> PayrollBatch -> Approval -> PaymentAttempt -> Provider -> Webhook/Status -> Settlement/Reconciliation -> Canonical Financial Gateway -> Ledger -> Audit/Reporting`

The payroll module must not directly mutate balances or ledger history.

## 6. Official TITech theme

The supplied official palette remains:

- Deep Blue `#0030A0`
- Electric Blue `#0058D8`
- Bright Blue `#0066E8`
- Cyan `#00B8F8`
- Africa Green `#008000`
- Lime Green `#A8F000`
- Gold Yellow `#F8D800`
- Navy Ink `#082B67`
- White `#FFFFFF`

The authoritative sources are `branding/BRAND_MANIFEST.json`, `branding/reference/TITech_FinTech_Platform_Hosting_Guide_2026-09-30.png`, `frontend/src/branding/official-theme.css`, and `mobile/branding/titech-theme.tokens.json`.
