# Payroll E2E Implementation Status

## Approved product boundary for this release

TITech Payroll is a controlled **employer-approved net-pay register intake and disbursement orchestration capability**. It is not currently a gross-to-net payroll computation engine. The employer remains the source of truth for pay calculations and applicable deductions. Jurisdiction-specific statutory logic requires separately approved rules, effective dates, qualified review and its own acceptance gate.

## Implemented or strengthened

| Capability | Change | Evidence status |
|---|---|---|
| CSV monetary validation | Positive amount checks avoid floating-point parsing for validation. | Native CSV contract tests PASS. |
| Batch currency | Upload requires a single batch currency and uses exact integer minor-unit summation. | Source contract present; persistent integration NOT RUN. |
| Upload idempotency | File-content fingerprint binds an idempotency key to the original payload; changed content under the same key conflicts. | Source contract present. |
| Atomic upload/audit | Batch, transaction rows and audit writes use the same Mongoose session helper. | Source contract present; Mongo replica-set test BLOCKED. |
| Submission | Explicit `PENDING_APPROVAL` transition. | Native approval contract PASS. |
| Independent approval/rejection | Explicit approval/rejection actions and existing `PayrollApproval` evidence; uploader cannot self-approve. | Native approval contract PASS. |
| Processing guard | Provider processing requires `APPROVED` state plus approval metadata and a conditional claim. | Native approval contract PASS; provider sandbox NOT RUN. |
| Retry behavior | Blind retry fails closed rather than issuing a fresh potentially duplicate provider reference. | Native contract PASS. Recovery/status-query workflow remains to be integrated. |
| Callback signature | HMAC verification consumes raw request bytes captured by the app-level parser. | Native raw-body signature test PASS. |
| RBAC | `payroll:batch:approve` added to canonical permission and payroll-officer mapping; routes enforce permission. | RBAC gate PASS; runtime API test NOT RUN. |
| UI | Existing `/payroll` route and page now expose submit/approve/reject actions and currency. Blind retry action removed. | Source contract PASS; Vite/browser build NOT RUN. |

## Relevant API actions

- `POST /uploadPayroll`
- `POST /submitForApproval`
- `POST /approveBatch`
- `POST /rejectBatch`
- `POST /processBatch`
- `POST /reconcile`

The existing route and page were retained. Processing is not a claim of provider success; callback and status evidence still determine transaction outcome.

## Required next integration steps

1. Provision the supported Node/npm runtime and install root/backend/frontend dependencies from lockfiles.
2. Run full backend Jest, frontend unit, lint, format and Vite production build.
3. Run replica-set MongoDB + Redis integration tests for upload, approval, process claim, transaction persistence and audit atomicity.
4. Connect and contract-test the canonical provider adapter in sandbox, including accepted, rejected, timeout, unknown, callback replay and provider status lookup.
5. Verify that a confirmed outcome flows through canonical `FinancialTransaction`, double-entry ledger, outbox, settlement evidence, receipt and reconciliation.
6. Prove batch-to-row-to-provider-to-ledger totals by currency; exercise reversals and concurrent processing.
7. Complete employer and employee onboarding, destination ownership, consent, privacy, payslip and self-service E2E.

## Production restrictions

No live disbursement is approved by this implementation. Do not enable production payroll processing until employer onboarding, funding authority, provider certification, callback secrets, ledger mapping, reconciliation, legal/compliance ownership and release gates are evidenced.

**Acceptance status:** PARTIAL. Approval and ingestion contracts are improved; full payroll E2E and provider/ledger settlement remain unproven.
