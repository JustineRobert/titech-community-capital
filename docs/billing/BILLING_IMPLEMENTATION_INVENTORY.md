# Billing implementation inventory — 27 November 2026

**Product:** TITech Community Capital  
**Organization:** TITECH CAPITAL - SMC LTD  
**Tagline:** Community Finance. Stronger Together.  
**Control principle:** FINANCIAL CORRECTNESS BEFORE CONVENIENCE.  
**Release status:** NOT READY · `productionApproved=false`

## Evidence basis

This inventory is based on the uploaded repository archive, its source and migration files, the existing commercial-core documentation, the November 22 billing E2E evidence, and the November 27 archive-local validation. The archive has no `.git` metadata. The current public GitHub branch could not be queried because DNS/network access was unavailable; no remote state is inferred.

Evidence status labels follow the engineering brief. “PRESENT” means a specific source artifact exists; it does not imply operational integration, production data or completed E2E proof.

## Capability inventory

| Capability | Actual source / evidence | Status | Current finding / action |
|---|---|---|---|
| Official identity and tagline | `frontend/src/branding/brand.js`; `branding/TITECH_ORGANIZATION_PROFILE.json`; `branding/TITECH_OFFICIAL_THEME.json` | PRESENT_AND_VERIFIED (configuration) | Correct active product, configured organization, ERN, contact, PO Box and tagline. Legal identity is still not independently authenticated. |
| Nine-colour palette and light/dark themes | `frontend/src/branding/brand.css`; `frontend/src/branding/official-theme.css`; theme manifest | PRESENT_AND_VERIFIED | Use the existing tokens; no replacement palette or logo introduced. |
| Authentication | `backend/middleware/auth.js`; `frontend/src/context/AuthContext` | PRESENT_AND_VERIFIED (source) | Existing JWT/refresh mechanism is reused. Runtime authentication was not exercised in this environment. |
| Canonical RBAC | `backend/security/rbacPolicy.js`; `frontend/src/security/rbacPolicy.js` | PRESENT_AND_VERIFIED (static) | Added read-only billing permission vocabulary and finance reader roles; platform and tenant scopes remain distinct. |
| Tenant resolution | `backend/middleware/auth.js` (`requireAuthenticatedTenant`) | PRESENT_AND_VERIFIED (source) | Institution APIs use JWT-derived tenant identity. Cross-tenant runtime tests remain outstanding. |
| Commercial pricing / usage assessment | `backend/commercial/models/FeeRule.js`, `FeeAssessment.js`, `usageRecord.model.js`; `backend/commercial/services/transactionRevenue/*` | PRESENT_BUT_INCOMPLETE | Foundation exists for approved fee rules, source-backed usage and fee assessments. This is not a SaaS invoice or subscription lifecycle. |
| Payment orchestration | `backend/commercial/models/billingPayment.model.js`; `backend/commercial/services/billing/billingPayment.service.js` | PRESENT_BUT_INCOMPLETE | Substantial canonical billing payment service exists, but it expects invoice/repository/financial-core dependencies that are absent or empty. It is not wired to the new dashboard API. |
| Canonical financial core adapter | `backend/commercial/financial/billingFinancialCore.port.js`; `titechFinancialCore.adapter.js` | PRESENT_BUT_INCOMPLETE | Adapter boundary exists; actual production dependency injection and full journal/reversal evidence are not established. |
| SaaS plans | `backend/commercial/models/billingPlan.model.js`; `backend/commercial/services/saas/billingPlan.service.js` | PRESENT_BUT_INCOMPLETE | Both files are zero bytes in this archive. Pricing must not be invented or enabled. |
| Billing accounts | `backend/commercial/repositories/billingRepository.js` and `canonicalBillingRepository.bridge.js` | MISSING / PRESENT_BUT_INCOMPLETE | Repository/bridge files are zero bytes; no verified billing-account service. |
| Subscriptions | `backend/commercial/models/subscription.model.js`; `subscription.service.js` | PRESENT_BUT_INCOMPLETE | Both files are zero bytes. Migration collections exist, but operational lifecycle is not implemented. |
| Entitlements | `backend/commercial/models/entitlement.model.js` | PRESENT_BUT_INCOMPLETE | File is zero bytes; authoritative entitlement updates are not enabled. |
| Invoicing | `backend/commercial/models/invoice.model.js`, `invoiceItem.model.js`; `billingInvoice.service.js` | PRESENT_BUT_INCOMPLETE | Files are zero bytes. Existing invoice collection is read for visibility only; no issuance or PDF generation. |
| Payment allocations | Existing payment model/service; no verified billing allocation service in this snapshot | MISSING | No full allocation lifecycle is mounted. |
| Collections and finance visibility | New `backend/commercial/services/billing/billingReadModel.service.js`; `backend/commercial/api/billingRead.routes.js` | PRESENT_AND_VERIFIED (unit/static scope only) | New read-only views for invoice ageing and payment exceptions; no collections mutation or reminder scheduling. |
| Platform billing dashboard | `frontend/src/pages/billing/BillingDashboardPage.jsx`; `/platform/billing` | PRESENT_BUT_INCOMPLETE | Added connected read-only dashboard. It does not manage plans, subscriptions or invoices. |
| Institution My Billing | Same page; `/settings/billing` | PRESENT_BUT_INCOMPLETE | Added authenticated tenant-scoped read-only view. It does not initiate payments or manage billing profile. |
| Finance & Collections dashboard | Same page; `/finance/billing-operations` | PRESENT_BUT_INCOMPLETE | Added read-only ageing and exception queues. No case workflow, matching, reconciliation mutation or export. |
| Revenue analytics | Read projection from canonical invoice/payment collections | PRESENT_BUT_INCOMPLETE | Currency-specific invoice totals and status counts only. MRR, ARR, recognized revenue and settled cash return NOT_AVAILABLE. |
| Provider callbacks / settlement | `billingPayment.service.js`; provider/financial adapter contracts | PRESENT_BUT_INCOMPLETE | No evidence of active provider credentials, signed webhook route integration or settlement verification. |
| Reconciliation | Existing platform reconciliation/BankConnect modules | NOT_VERIFIABLE_IN_CURRENT_ENVIRONMENT for SaaS billing | No verified SaaS payment-to-bank reconciliation workflow is mounted. |
| Billing audit trail | Existing global audit infrastructure | PRESENT_BUT_INCOMPLETE | New read routes do not mutate data; sensitive billing write actions and their audit flows are not implemented. |
| Browser E2E | Existing E2E harness and historical evidence | NOT_VERIFIABLE_IN_CURRENT_ENVIRONMENT | No browser session/runtime was available for live journeys. |
| Production release | `branding/TITECH_ORGANIZATION_PROFILE.json` and release gates | NOT VERIFIED | `productionApproved=false`; external approvals and runtime gates remain unsatisfied. |

## Zero-byte commercial files at baseline

The following 22 files were empty in the uploaded archive and remain unimplemented by this read-only increment:

- `backend/commercial/bridges/canonicalBillingRepository.bridge.js`
- `backend/commercial/config/billingCutover.config.js`
- `backend/commercial/config/billingRuntime.js`
- `backend/commercial/models/RevenueEntry.js`
- `backend/commercial/models/RevenueSettlement.js`
- `backend/commercial/models/billingPlan.model.js`
- `backend/commercial/models/entitlement.model.js`
- `backend/commercial/models/invoice.model.js`
- `backend/commercial/models/invoiceItem.model.js`
- `backend/commercial/models/subscription.model.js`
- `backend/commercial/models/subscriptionItem.model.js`
- `backend/commercial/repositories/billingRepository.js`
- `backend/commercial/repositories/revenueEntry.repository.js`
- `backend/commercial/repositories/revenueSettlement.repository.js`
- `backend/commercial/services/billing/billingInvoice.service.js`
- `backend/commercial/services/billing/saasBilling.service.js`
- `backend/commercial/services/saas/billingPlan.service.js`
- `backend/commercial/services/saas/index.js`
- `backend/commercial/services/saas/subscription.service.js`
- `backend/commercial/services/transactionRevenue/revenueEntry.service.js`
- `backend/commercial/services/transactionRevenue/revenueReversal.service.js`
- `backend/commercial/services/transactionRevenue/settlement.service.js`

All 22 paths above were zero-byte in the uploaded archive at baseline. Adjacent non-empty fee-calculation and transaction-revenue modules are retained; do not infer the empty modules' implementation from migration files or file names.

## Newly added read-only capability

- A MongoDB-native read projection over the established `titech_subscriptions`, `titech_billing_invoices`, and `titech_billing_payments` collections; plan count reads `titech_billing_plans` for platform overview.
- API routes under `/api/v1/billing` use the canonical JWT authentication, permission middleware and `requireAuthenticatedTenant` guard.
- Read projections exclude `metadata`, provider payload and raw response fields.
- Financial aggregate measures remain separated by currency.
- The front end has loading, error, empty, permission-denied and page navigation states.
- No mutation endpoint or financial posting was introduced.

See `BILLING_GAP_ANALYSIS.md`, `BILLING_API_REFERENCE.md` and the dated execution evidence under `../evidence/2026-11-27-billing-read-model/`.
