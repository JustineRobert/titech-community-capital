# TITech Community Capital — Authoritative Commercial Billing Core

**Organization:** TITech Capital SMC LTD  
**Product:** TITech Community Capital  
**Principle:** FINANCIAL CORRECTNESS BEFORE CONVENIENCE  
**Status:** foundational implementation; not an end-to-end production billing release  

## Purpose and boundaries

This change establishes a central service-layer foundation for approved pricing, service-usage recording, immutable fee assessment and an explicit port to the existing TITech financial core. It is intended to be integrated into the current application architecture, not to create another payment or accounting system.

The code does **not** independently collect customer funds, issue invoices, activate paid entitlements, recognise revenue, execute provider settlements, or post directly to a ledger. Those transitions remain owned by the existing canonical billing/payment/financial services and must be connected and verified before the capability is described as end to end.

## Implemented contracts

- `FeeRule` represents tenant-scoped, versioned commercial pricing. A rule is usable only when it is approved, active and effective for the event date. Maker/checker identity must be distinct for activation.
- `feeRule.service.js` resolves candidate rules by tenant, service, currency, contract/institution/payer/event dimensions, priority and specificity. Equal-precedence ambiguity fails closed.
- `feeCalculation.service.js` calculates fixed, percentage, fixed-plus-percentage, and tiered tariffs with `BigInt` minor-unit arithmetic, basis-point rates, explicit rounding, and optional minimum/maximum caps. The supported tier interpretation must be stated (`WHOLE_VOLUME` or `PROGRESSIVE`); progressive per-tier fixed charges apply only to tiers actually used.
- `UsageRecord` persists source-event provenance and processing status. `transactionRevenue.service.js` requires server-resolved commercial terms and an authorised emitter; it distinguishes billable, included/non-billable, sponsored/contract, unpriced/pending, disabled/restricted and unsuccessful events.
- `FeeAssessment` persists the calculated amount and a pricing snapshot. Tenant-scoped idempotency and an input fingerprint prevent reuse of an idempotency key for different commercial inputs.
- `FeeRuleRepository`, `FeeAssessmentRepository` and `UsageRecordRepository` provide tenant-scoped persistence interfaces.
- `billingFinancialCore.port.js` defines the boundary to the established financial core. `titechFinancialCore.adapter.js` delegates posting/reversal to injected canonical functions and requires a live MongoDB transaction session. No parallel ledger is introduced.

## Integration requirements before production use

1. Wire the server-side commercial-terms resolver to approved commercial accounts, contracts, service classifications and the real authenticated tenant context.
2. Wire the emitter authorizer to the existing service identity / RBAC policy. Do not allow arbitrary frontend callers to emit trusted usage.
3. Register the new Mongoose models with the established model registry and deploy indexes through the repository's migration/index process. Confirm index creation against a replica set before enabling writes.
4. Inject the actual canonical financial posting/reversal functions into the adapter. Their contracts must be verified against the current financial transaction and journal services; do not guess a method name.
5. Run the service operations in appropriate MongoDB transactions and connect the established durable outbox/inbox, audit and reconciliation facilities.
6. Add a commercial event producer to each enabled billable service only after the payer, contractual classification and definition of a completed/billable business event have been approved.
7. Integrate invoice/credit-note, receivable, payment-attempt, provider outcome, collection, settlement and reconciliation workflows. The current code slice does not implement these end-to-end.
8. Add real replica-set/Redis integration tests and E2E tests using isolated fixtures. The committed tests in this slice are unit tests with injected/in-memory dependencies.
9. Review account mapping, revenue-recognition, tax, fee disclosure, contract and statutory treatment with qualified finance/legal professionals before activation.

## Fail-closed rules

- Missing, ambiguous, inactive, unapproved, future or expired pricing is an error, not a zero-fee result.
- The submitted client amount is not authoritative; pricing input and payer must come from trusted server-side sources.
- Unsuccessful operations are not charged unless the resolved contract explicitly authorises that treatment.
- Duplicate usage delivery must not create a second assessment.
- A fee assessment is not a payment, invoice, earned-revenue entry, settlement or customer receipt.
- The adapter must not be considered operationally wired until it receives actual canonical financial functions and an active database transaction.
- `productionApproved` remains `false`.

## Verification

Run:

```bash
npm run check:commercial-core
npm run test:commercial:core
```

The first command is a static contract gate. The second runs the focused Node test suite. Neither substitutes for the database, provider, ledger, settlement, security or production approval gates listed above.
