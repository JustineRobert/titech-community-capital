# Agriculture & Payroll Financial Controls

## Golden money path

All real financial effects must continue to use the canonical platform path:

`Tenant → Authorized actor → consent/authority → financial intent → instruction → provider attempt → verified outcome → settlement evidence → FinancialTransaction → double-entry ledger → receipt/outbox → reconciliation → audit → period close`

Neither Agriculture nor Payroll may maintain a parallel ledger, update balances directly, treat an accepted HTTP request as a completed payment, or post money based only on client assertions.

## Controls now present in source

### Agriculture

- Domain money values are validated through exact minor-unit representations; quantities have a separate exact decimal format.
- Nested payloads are canonicalized for idempotency fingerprints; unsupported values fail closed.
- Producer, buyer, farm, contract and delivery relationships are validated in tenant scope.
- Verified deliveries are checked against contract fulfilled quantity, with optimistic concurrency/version handling.
- Settlement creation stores an idempotent settlement intent and audit evidence.
- `confirmSettlement` is deliberately fail-closed until a provider outcome is verified and canonical financial posting is integrated.

### Payroll

- Upload payload fingerprint binds a reused idempotency key to identical content.
- Batch upload requires one currency; amounts are accumulated using integer minor units/BigInt arithmetic.
- Batch, payroll rows and audit writes are grouped under the Mongoose session helper.
- Approval is explicit and independent of the submitter; approval metadata is mandatory before processing.
- Provider processing conditionally claims an approved batch.
- Blind retry fails closed to avoid double-disbursement after an uncertain provider response.
- Webhook HMAC is computed from captured raw request bytes.

## Required release controls still outstanding

1. Demonstrate MongoDB transaction topology and rollback under actual replica-set runtime.
2. Demonstrate same-session writes, duplicate-key race behavior, transaction retry and recovery after process termination.
3. Verify canonical provider idempotency and authoritative status query before retrying an `UNKNOWN` outcome.
4. Verify provider callback signature, timestamp/replay window, unique provider event ID and late/out-of-order state semantics end to end.
5. Prove each confirmed provider payout maps once to balanced ledger entries and exact currency-safe batch totals.
6. Demonstrate outbox delivery, receipts, reconciliation exceptions and controlled reversal.
7. Prove funding source, account ownership, employer/producer authority and fee/allocation policy with approved partner configuration.
8. Reconcile the complete Agriculture delivery allocation and Payroll batch totals to provider settlement files and ledger outputs.

## Money-state definitions

- `PENDING` / `APPROVED`: workflow state only; not payment confirmation.
- `PROCESSING`: an authorized operation has been claimed; not proof of provider settlement.
- `UNKNOWN`: outcome cannot yet be established; do not create a second instruction.
- `CONFIRMED` / `SETTLED`: only after the canonical provider-specific verification evidence and financial posting criteria succeed.
- `RECONCILED`: only after provider, internal transaction, ledger and batch/settlement totals agree.

## Current decision

The source-level controls have improved and the focused contracts pass. Database-backed financial execution, live/sandbox provider outcomes, canonical ledger effects and reconciliation have not been run in this environment. Financial production readiness is therefore **BLOCKED**.
