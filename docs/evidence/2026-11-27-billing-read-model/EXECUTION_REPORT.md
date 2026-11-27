# TITech Community Capital — billing remediation execution report

**Execution date:** 27 November 2026 (Africa/Kampala)  
**Product:** TITech Community Capital  
**Organization:** TITECH CAPITAL - SMC LTD  
**Official tagline:** Community Finance. Stronger Together.  
**Financial principle:** FINANCIAL CORRECTNESS BEFORE CONVENIENCE.  
**Release outcome:** PARTIAL IMPLEMENTATION — READ-ONLY BILLING VISIBILITY  
**Production approval:** `false`

## 1. Executive result

The uploaded source archive was inspected and extended with a protected read-only billing API, three role-specific billing dashboards, a server-side billing read model, permission vocabulary and ten focused unit/source-contract tests. The existing React/Vite, Express native-ESM, JWT/refresh-cookie, MongoDB/Mongoose connection, RBAC, tenant middleware, API router, navigation, brand/logo and theme runtime were reused. No parallel authentication, database connection, payment engine, ledger or microservice was introduced.

This is **not** the complete E2E billing implementation described in the master brief. The source archive contains 22 zero-byte canonical commercial plan, subscription, invoice, repository, revenue and service files. The existing payment service expects invoice/repository/financial-core dependencies that are not yet complete. Therefore this increment intentionally exposes records only; it does not create financial transactions or pretend that an interface is production-ready.

## 2. Baseline findings

- The uploaded archive contains 4,147 file entries and has no `.git` directory. A Git working-tree/branch/commit status could not be established from the upload.
- The source archive SHA-256 is `10cc5de08c6b868acdcaf255676966e71821bfed0a15908cd04017798ac1e7c8`.
- Existing official identity, ERN/contact configuration, circular logo, nine-colour palette, light/dark theme contracts, canonical auth/RBAC/tenant middleware and commercial pricing/usage/payment modules are present in source.
- No complete connected SaaS billing dashboard pages or billing admin read API were present in the starting snapshot/evidence.
- 22 core commercial model/repository/service files listed in `docs/billing/BILLING_IMPLEMENTATION_INVENTORY.md` were zero bytes in the uploaded archive.
- The existing `billingPayment.service.js` is substantial but its expected repository and invoice service dependencies are incomplete; it was not activated by this read-only work.

## 3. What changed

### 3.1 Product and organization identity

- Product remains **TITech Community Capital**.
- Organization remains **TITECH CAPITAL - SMC LTD**.
- Active tagline displayed by the dashboards is **Community Finance. Stronger Together.**
- Organization details displayed from the current official brand contract: ERN 80049233029029; P.O. Box 601200; titechcapital@gmail.com; phone +256782397907; WhatsApp +256772123546.
- The existing circular logo and nine official palette tokens are retained. Dashboard styling consumes the existing CSS variables and therefore follows the platform's configured light/dark mode.
- The organization profile itself records the incorporation evidence as supplied but not independently authenticated; this implementation does not change that verification status.

### 3.2 New dashboards

| Dashboard | Path | Access model | Implemented visibility |
|---|---|---|---|
| Platform Owner Billing Control Centre | `/platform/billing` | platform admin / finance reader RBAC | Subscription/invoice/payment counts and status summaries, invoice totals by currency, subscription and invoice paginated lists, financial metric unavailability indicators |
| Institution Administrator — My Billing | `/settings/billing` | tenant administrator + authenticated tenant | Own subscription, invoices, payments, currency-separated invoice totals and status charts |
| Finance & Collections Operations | `/finance/billing-operations` | platform admin / finance reader RBAC | Receivables ageing counts, first 50 overdue invoice records and first 50 payment-exception records |

The supplied three dashboard screenshots are retained under `docs/billing/reference/` as layout references. Their sample values were not copied into the product.

### 3.3 New API

Mounted under the existing canonical `/api/v1/billing` route namespace:

- `GET /platform/overview`
- `GET /platform/subscriptions`
- `GET /platform/invoices`
- `GET /platform/payments`
- `GET /platform/collections`
- `GET /me/overview`
- `GET /me/subscriptions`
- `GET /me/invoices`
- `GET /me/payments`

All nine routes are read-only. Platform routes use route-specific canonical RBAC. Tenant routes require `requireAuthenticatedTenant` and the scope is taken from `req.user.tenantId`; caller-supplied tenant IDs are overwritten and cannot select another institution.

The read model uses the existing Mongo connection and billing collections. Queries are paginated (maximum 100), search is bounded/escaped, status syntax is constrained, and returned record fields use allowlisted projections. Provider payloads, raw provider responses and internal metadata are not exposed.

### 3.4 Financial correctness and capability boundaries

- Amount totals are grouped by currency; no UGX/USD/KES/etc. aggregation is performed.
- Decimal values are returned as decimal strings; no JavaScript floating-point amount calculation is used for display.
- Ageing counts include only OPEN, PARTIALLY_PAID and PAST_DUE invoices with positive amounts due and past due dates.
- Payment records/statuses are not described as settled cash.
- MRR, ARR, recognized revenue and settled cash explicitly return `NOT_AVAILABLE` because the full approved pricing, accounting journal and settlement evidence lifecycle is not integrated.
- Invoice issuance, subscriptions/plan mutation, payment initiation, provider callbacks, settlement, allocations, receipt/PDF generation, credit notes, refunds, collections mutations, reconciliation changes and ledger posting remain disabled/not implemented.
- No writes are made to member savings, SACCO contributions, member loans, group wallets or community ledger data.
- `productionApproved=false` remains in force.

## 4. Test and gate results

The new test command `npm run test:billing-read` passes **10/10**: six backend service unit tests and four frontend source-contract tests. `npm run check:billing-read` passes. The repository syntax gate parses 2,628 JS/TS-family files. The RBAC, commercial-core, financial-static, enterprise-contract, official-theme and organization-profile gates pass. Detailed command results are in `TEST_RESULTS.md`.

The release audit command `npm run release:gate` reports structural PASS with warnings for the local runtime mismatch and 208 existing missing local imports. This is not a production approval.

## 5. Environment and unverified work

The execution environment reports Node `22.16.0` and npm `10.9.2`; the repository declares Node `>=24.15.0` and npm `>=11.0.0`. `npm run check:runtime` therefore reports BLOCKED. The archive has no installed `node_modules`, and registry/GitHub DNS access was unavailable; declared dependencies could not safely be installed.

Consequently, the following were **not** executed or proven:

- Full backend Jest suite and frontend Vitest suite.
- Vite production build or running Express application.
- MongoDB migration/index application or replica-set transaction tests.
- Redis/queue/background-worker integration.
- Real authenticated browser E2E for any of the required eight journeys.
- Dynamic cross-tenant security tests against a live API/database.
- Live MTN MoMo/Airtel Money/banking provider initiation, webhook signature, inquiry, settlement or refund.
- Canonical journal posting, double-entry balance, allocation/reversal and bank reconciliation.
- Production deployment, monitoring/restore drills and external finance/legal/tax/regulatory/partner approval.

No GitHub push, commit, merge or deployment was performed. The remote repository could not be checked from this environment.

## 6. Acceptance conclusion

The read-only dashboard/API increment is implemented and source/test-gated. The enterprise E2E acceptance criteria in the master brief are **not met** because the core subscription/invoice/payment-to-ledger lifecycle and dynamic infrastructure tests remain outstanding. Do not use this increment for live billing collection, invoice issuance, receipts, accounting recognition, entitlement enforcement or regulatory claims.

**Final disposition: PARTIAL IMPLEMENTATION · CONTROLLED READ-ONLY VALIDATION ONLY · NOT PRODUCTION APPROVED.**

See:
- [`../../billing/BILLING_IMPLEMENTATION_INVENTORY.md`](../../billing/BILLING_IMPLEMENTATION_INVENTORY.md)
- [`../../billing/BILLING_GAP_ANALYSIS.md`](../../billing/BILLING_GAP_ANALYSIS.md)
- [`../../billing/BILLING_RELEASE_READINESS.md`](../../billing/BILLING_RELEASE_READINESS.md)
- [`CHANGED_FILES.md`](CHANGED_FILES.md)
- [`TEST_RESULTS.md`](TEST_RESULTS.md)
