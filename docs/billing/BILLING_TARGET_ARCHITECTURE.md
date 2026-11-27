# Billing target architecture and current implemented slice

## Target boundaries

**Domain A — TITech SaaS business billing:** amounts an institution owes TITech under an approved platform subscription, licence, usage, service or contract.

**Domain B — institution/community financial operations:** member savings, contributions, loans, group money, member wallets and community financial transactions.

No SaaS billing operation may mutate Domain B. Any future billing journal must use a platform-owned billing account/classification through the canonical financial core; it must not create a parallel ledger.

## Current release slice

The implementation added in this increment is a read-only CQRS-style projection over existing commercial collections. It reuses current Express, JWT, tenant/RBAC, Mongoose and frontend routing infrastructure. No separate authentication, database, payment engine, ledger, microservice or subscription app was introduced.

## Intended complete flow (not yet operational)

```text
Approved contract + institutional billing account
  -> versioned plan / pricing approval
  -> subscription and entitlement snapshot
  -> source-backed usage event aggregation
  -> immutable invoice generation
  -> payment attempt via canonical provider adapter
  -> authenticated provider inquiry/callback
  -> verified outcome + settlement evidence
  -> bounded payment allocation
  -> canonical platform-owned financial posting
  -> reconciliation and immutable audit
  -> tenant/platform/finance dashboards
```

Every transition above requires its own implementation and evidence. Only the final read-only dashboard/projection segment is added now.

## Dashboard ownership

- `/platform/billing`: platform administrator and finance reader roles. Platform-wide read-only billing summary, subscription/invoice lists and currency-safe invoice position.
- `/settings/billing`: tenant administrator, current JWT tenant only. Own subscription, invoices and payment records.
- `/finance/billing-operations`: platform finance reader roles. Overdue invoice ageing and payment exception queues.

The API is the security boundary. Frontend route restrictions are only menu/page presentation controls.

## Explicit capability gates

Plan changes, subscription mutations, usage aggregation jobs, invoice issuance, payment initiation, provider callbacks, settlement, receipt generation, credit notes, refunds, collections actions, reconciliation mutations, exports, tax treatment and automatic renewals are not enabled by this increment.
