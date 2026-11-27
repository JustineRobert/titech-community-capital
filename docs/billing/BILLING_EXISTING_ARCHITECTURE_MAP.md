# Existing billing architecture map

## Established application path

```text
React + Vite
  frontend/src/routes/AppRoutes.jsx
  frontend/src/layouts/AdminLayout.jsx
  frontend/src/services/api.js
        │ protected by existing AuthContext/JWT refresh model
        ▼
Express native-ESM API registry
  backend/routes/index.js
        │ `/api/v1/billing` mounted here
        ▼
Canonical auth and RBAC
  backend/middleware/auth.js
  backend/security/rbacPolicy.js
        │
        ▼
Read-only billing projection (added)
  backend/commercial/api/billingRead.routes.js
  backend/commercial/services/billing/billingReadModel.service.js
        │ existing Mongoose connection / MongoDB collections
        ▼
`titech_subscriptions`
`titech_billing_invoices`
`titech_billing_payments`
`titech_billing_plans` (count only)
```

## Reused components

- Existing `backend/routes/index.js` API router and `/api/v1` namespace.
- Existing `backend/middleware/auth.js` JWT/session authentication, canonical role resolution, `requirePermission`, and `requireAuthenticatedTenant`.
- Existing `backend/security/rbacPolicy.js` permission registry and role mapping.
- Existing Mongoose connection; no new connection or database client was created.
- Existing React Router/ProtectedRoute/ProtectedLayout and `AdminLayout` shell.
- Existing `frontend/src/services/api.js` transport, refresh-token and request correlation behavior.
- Existing `frontend/src/navigation/navigationRegistry.js` for menu discovery.
- Existing `frontend/src/branding/brand.js`, `BrandLogo.jsx`, global theme tokens and circular-logo asset.

## Canonical financial modules discovered but not activated

- `backend/commercial/models/billingPayment.model.js`
- `backend/commercial/services/billing/billingPayment.service.js`
- `backend/commercial/financial/billingFinancialCore.port.js`
- `backend/commercial/financial/titechFinancialCore.adapter.js`
- `backend/commercial/models/FeeRule.js`, `FeeAssessment.js`, `usageRecord.model.js`
- `backend/commercial/services/transactionRevenue/*`

The payment service depends on incomplete repository/invoice functions. The read-only API deliberately does not invoke it. The adapter boundary is not proof of a live posted/settled transaction.

## Existing migration collections

`backend/migrations/20260830_120000_consolidate_titech_saas_billing.js` establishes collection names for the billing plan, subscription, invoice, usage and migration state. `backend/migrations/20260830_130000_add_saas_billing_payment.js` establishes the payment collection `titech_billing_payments`. Migrations describe intended storage; this execution did not connect to a database to verify that they ran.
