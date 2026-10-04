# TITech Community Capital — Agriculture Architecture

Agriculture is implemented as a first-class capability inside the existing Community Capital platform. It is **not** a separate agriculture application, wallet, ledger, or identity system.

## Canonical economic flow

`Tenant → Group → Producer → Farm → ProductionCycle → Buyer → OfftakeContract → Delivery → Settlement → FinancialTransaction/Ledger → Allocation → FinancialHistory`

## Reuse rules

- Existing `Group`, `Member`, tenant middleware, RBAC, audit, financial transaction service, ledger/balance repositories, outbox, and API composition remain authoritative.
- Agriculture entities are tenant-scoped with explicit indexes and optimistic/idempotency metadata where appropriate.
- Controllers only orchestrate authorization/validation and delegate financial effects to the agriculture service and canonical financial transaction boundary.
- No agriculture-specific balance or ledger is created.

## Delivered foundation

- Producer
- Farm
- Commodity
- Production cycle
- Buyer
- Offtake contract
- Delivery and verification
- Settlement and allocation
- Producer financial history
- Agriculture permissions and tenant-scoped routes
- Agriculture dashboard
- Offline operation metadata on operational entities
- Official TITech theme tokens for agriculture UX

## Settlement safety

A delivery must be verified before settlement creation. Settlement confirmation requires provider evidence and an explicit source account plus balanced allocation list. Confirmation enters the existing `TRANSACTION_CREATE` financial operation boundary, persists the settlement and delivery state changes in the same Mongo transaction, writes the existing transaction outbox, and records an audit event.

## Offline boundary

Agriculture operational entities carry `deviceId`, `clientOperationId`, `payloadHash`, `syncStatus`, and idempotency fields. A local record is not financial finality. The repository's existing offline synchronization module remains the authoritative transport/event subsystem. Full agriculture event-handler activation is intentionally not duplicated in this bounded change; the current vertical slice exposes server-accepted state and the dashboard explicitly distinguishes offline availability from financial confirmation.

## Globalization posture

The domain stores tenant/country-independent concepts such as currency codes, units, commodity configuration, pricing methods, status enums, and tenant-scoped entities. Country activation, regulatory policy, payment-rail onboarding, tax behavior, data residency, and local identity configuration remain deployment/policy gates rather than being silently enabled by having configuration values.
