# Billing data model status

## Existing collection contracts

The repository migrations refer to:

| Collection | Purpose | Current use in read model |
|---|---|---|
| `titech_billing_plans` | SaaS plan/pricing definitions | Platform count only |
| `titech_subscriptions` | Institution subscriptions | Read-only list and status aggregates |
| `titech_billing_invoices` | Billing invoices | Read-only list, currency aggregates and ageing |
| `titech_usage_records` | Billable usage events | Not read in current dashboards |
| `titech_billing_payments` | SaaS billing payment records | Read-only list/status aggregate and exception queue |

Collection existence in migration source does not prove deployment or data validity.

## Current read projections

- Subscription: tenant, plan reference/version, status, billing interval, currency, stored amount/quantity, trial and current-period dates.
- Invoice: tenant, subscription, invoice number/status, currency, subtotal/discount/tax/total, allocated/paid amount, amount due, period and issue/due/paid dates.
- Payment: tenant, invoice/subscription, provider/reference, amount/currency/status and timestamps/failure code.

Projections are allowlists. Provider payloads, raw responses, `metadata` and Mongoose version fields are not returned to the dashboard.

## Required future entities and invariants

The model/service files for BillingPlan, BillingAccount, Subscription, Entitlement, Invoice and InvoiceItem are empty in the supplied snapshot. Implement only after validating the migration shape and existing Mongoose conventions. Requirements include tenant ownership, versioned approved pricing, immutable issued invoice snapshots, integer/decimal-safe arithmetic, explicit currency, idempotency, unique invoice numbering, and audit-linked status transitions.

A payment allocation model/service, credit-note/refund records, provider-event inbox, settlement-evidence record and billing journal mapping also require full implementation. Do not infer these models from the read projection.

## Monetary representation

MongoDB decimal values are normalized to decimal strings for presentation; JavaScript floating-point arithmetic is not used for monetary totals in the service. Aggregated sums remain separated by currency. The helper `addDecimalStrings` is tested for exact string addition, but current dashboard totals are read from MongoDB aggregations and are not converted or combined across currencies.
