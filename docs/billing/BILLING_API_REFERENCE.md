# Billing API reference — read-only release slice

Base path: `/api/v1/billing` (registered by `backend/routes/index.js`). All routes are GET-only. Successful responses use `{ success, data, requestId, correlationId, timestamp }`; errors expose a generic safe message and correlated request metadata.

| Method / path | Permission | Scope | Response |
|---|---|---|---|
| GET `/platform/overview` | `BILLING_PLATFORM_VIEW` | Platform | Subscription/invoice/payment record counts, statuses, invoice totals by currency, overdue bands, explicit unavailability of MRR/ARR/recognized revenue/settled cash, capability flags |
| GET `/platform/subscriptions` | `BILLING_SUBSCRIPTION_VIEW` | Platform | Paginated subscription projection |
| GET `/platform/invoices` | `BILLING_INVOICE_VIEW` | Platform | Paginated invoice projection |
| GET `/platform/payments` | `BILLING_PAYMENT_VIEW` | Platform | Paginated billing payment projection |
| GET `/platform/collections` | `BILLING_COLLECTION_VIEW` | Platform finance | Overview plus up to 50 overdue invoices and up to 50 payment exception records |
| GET `/me/overview` | authenticated tenant + `BILLING_SELF_VIEW` | JWT tenant only | Own billing overview |
| GET `/me/subscriptions` | authenticated tenant + `BILLING_SELF_VIEW` | JWT tenant only | Own paginated subscriptions |
| GET `/me/invoices` | authenticated tenant + `BILLING_SELF_INVOICE_VIEW` | JWT tenant only | Own paginated invoices |
| GET `/me/payments` | authenticated tenant + `BILLING_SELF_PAYMENT_VIEW` | JWT tenant only | Own paginated payments |

## Query parameters for list routes

- `page`: integer, clamped to 1 through 1,000,000; default 1.
- `pageSize`: integer, clamped to 1 through 100; default 25.
- `status`: allowlisted uppercase status identifier (invalid values are ignored).
- `search`: max 80 characters; invoice numbers or internal/provider payment references only; regular-expression metacharacters are escaped.
- `from`, `to`: optional date bounds on issue date for invoices or creation date for subscriptions/payments. Invalid dates are ignored.

Tenant endpoints override any tenant ID query parameter with `req.user.tenantId` after canonical `requireAuthenticatedTenant` middleware. The frontend cannot choose another tenant.

## Explicitly absent

No POST/PATCH/DELETE billing routes, invoice issue, payment initiation, callback, settlement, allocation, refunds, credits, plan changes, entitlement mutations, PDF generation, receipt generation or tax calculation are mounted here.
