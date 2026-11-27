# Billing gap analysis — 27 November 2026

## Executive finding

The archive contains a meaningful commercial pricing/usage-assessment foundation and a substantial billing-payment service, but it does not contain an operational end-to-end SaaS billing lifecycle. The key gap is not a lack of dashboard styling: several canonical persistence and service files required by the payment service are empty, and the invoice/subscription lifecycle is not mounted.

## Critical gaps (P0)

1. **Plans/pricing:** No functional SaaS plan model/service; only fee-rule/fee-assessment foundations. No approved TITech subscription price list was supplied. Do not activate price selection or contract charging.
2. **Billing account/subscription:** The billing repository/bridge and subscription model/service are empty. The migration's collection shapes do not substitute for validated Mongoose models and service rules.
3. **Invoice issuance:** Invoice model/item and billing invoice service are empty. New UI can read existing invoices but cannot issue, amend or render trusted invoice PDFs.
4. **Payment service integration:** `billingPayment.service.js` expects repository methods, `findInvoiceById`, and a canonical financial-core posting path. Do not wire it to new ad-hoc repositories or report payments as settled.
5. **Ledger segregation:** The canonical financial-core adapter boundary exists, but there is no verified end-to-end platform billing account/journal mapping, transaction commit/reversal proof or segregation regression suite.
6. **Tenant security:** New read API uses authenticated tenant derivation and read-only RBAC. Live cross-tenant attack tests against MongoDB/API are still required.
7. **Production environment:** Node/npm versions are below project requirement; MongoDB, Redis and the browser-based E2E environment were not available in this execution.

## Newly closed gaps in this increment

- The three named billing dashboard paths now render a shared branded dashboard component under role-aware authenticated routes.
- The billing API is mounted under the canonical `/api/v1` router prefix.
- Platform, finance and tenant reads have explicit permission checks.
- Institution scope is forced from `req.user.tenantId` after `requireAuthenticatedTenant`, never from a query/body tenant ID.
- Invoice/subscription/payment list endpoints are paginated and use allowlisted projections.
- Dashboard aggregates keep monetary values grouped by currency.
- MRR, ARR, recognized revenue and settled cash are explicitly unavailable; no demo numbers are substituted.
- A six-case service unit test file covers the primary read-model controls.

## Still open before P0 acceptance

- Implement approved, versioned SaaS billing plans and institutional billing accounts.
- Implement immutable subscriptions and entitlement snapshots against the migration conventions.
- Implement invoice issuance and immutable invoice snapshots; add invoice numbering concurrency tests.
- Add billing payment-attempt/invoice/allocation repository and service only after tracing exact payment service dependencies.
- Inject actual canonical financial-core and accounting mapping functions, session-bound writes and reversals.
- Implement verified provider inquiry/callback/settlement and reconciliation flows.
- Add cross-tenant API tests, concurrency tests, database replica-set tests and real browser E2E for full customer journeys.
- Obtain finance, legal, tax, provider and operational review; keep production release disabled until evidence is complete.

## Release recommendation

Use the present increment as a **read-only billing visibility preview** behind established authentication and role controls. Do not use it to collect money, make contractual pricing commitments, issue invoices/receipts, suspend institutions, grant entitlements or close books. `productionApproved=false` remains mandatory.
