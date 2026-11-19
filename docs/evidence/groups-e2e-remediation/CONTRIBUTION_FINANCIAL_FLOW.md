# Group Contribution Financial Flow

## Current observed behavior

`frontend/src/pages/GroupDetails.jsx` renders a contribution availability panel that states initiation is not enabled. It does not present a Make Contribution control. The component describes the missing mounted group-scoped contribution instruction route and does not claim that a payment was initiated.

The Group balance read uses `/api/v1/group-wallets/:id/balance`. `backend/controllers/groupWalletController.js` validates the trusted tenant, group ID and group-view authorization, then deliberately returns `GROUP_FINANCIAL_ACCOUNT_NOT_CONFIGURED` because the Group model has no canonical financial account reference. The UI displays unavailable, not a synthetic zero, and identifies the authoritative ledger as the source when available.

## Canonical components available for reuse

The repository has an existing financial operation controller/service flow under `backend/controllers/contributionsController.js`, `backend/services/financial/financialOperation.service.js`, and `backend/services/financial/financialTransaction.service.js`; it is not automatically a group contribution flow. The canonical ledger and provider orchestration must be reused rather than duplicated.

## Required before enablement

- Approved and unique group-to-ledger-account mapping with tenant/group/currency validation.
- Group-scoped contribution intent and payment instruction using the financial transaction boundary.
- Active-member and contribution authorization checks.
- Idempotency, retry/UNKNOWN handling and provider callback verification.
- Double-entry posting and correct reversal semantics.
- Ledger-linked contribution history and receipt only after verified posting.
- Reconciliation and audit evidence.
- Isolated integration tests against a transaction-capable MongoDB replica set and provider sandbox.

Until these items are complete, keep real-money contribution initiation disabled.
