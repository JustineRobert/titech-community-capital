# TITech Community Capital — API Dependency Matrix

**Organization:** TITech Capital SMC LTD  
**Product:** TITech Community Capital  
**Review date:** 11 November 2026

## Scope and evidence level

This is a **static source inventory**, not a live endpoint/response verification. The mounted route modules and direct API-client call sites were inspected. Many pages delegate API work to hooks, feature services, providers or shared clients, so a zero direct call count must not be interpreted as “no API dependency”. Exact endpoint contracts, HTTP status, authentication, tenant scope and database behaviour must be confirmed during runtime tests.

The canonical frontend API client is `frontend/src/services/api.js`. The backend route registration and service graph must be verified against the active server bootstrap before the matrix can be promoted to integration-tested.

## Page-to-client inventory

| Route/module | Page source | Direct API call references observed in page module | Verification requirement |
|---|---|---:|---|
| `/dashboard` | `frontend/src/pages/Dashboard.jsx` | 3 | Confirm dashboard stats, groups, activity, notices and readiness calls; per-widget failure isolation; tenant-scoped values |
| `/admin` | `frontend/src/pages/admin/AdminDashboard.jsx` | 2 | Confirm admin permissions, tenant scope, system-wide data restrictions and error state |
| `/members` | `frontend/src/pages/Members.jsx` | 1 | Confirm tenant-scoped member list, pagination and role restrictions |
| `/savings` | `frontend/src/pages/Savings.jsx` | 1 | Confirm read/write capabilities and canonical financial source |
| `/loans` | `frontend/src/pages/Loans.jsx` | 2 | Confirm lender/partner boundaries, no unauthorized credit approval or disbursement |
| `/transactions` | `frontend/src/pages/Transactions.jsx` | 2 | Confirm read model and canonical financial transaction source; no client balance mutation |
| `/reports` | `frontend/src/pages/Reports.jsx` | 2 | Confirm export permission, tenant filters, PII minimisation and query limits |
| `/login` | `frontend/src/pages/Login.jsx` | 1 | Confirm credential handling, CSRF/origin rules, HttpOnly refresh cookie and rate limits |
| `/forgot-password` | `frontend/src/pages/ForgotPassword.jsx` | 1 | Confirm one-time challenge, enumeration-safe responses and rate limits |
| `/verify-email` | `frontend/src/pages/VerifyEmail.jsx` | 2 | Confirm verification token validation and replay/expiry rules |
| `/reset-password` | `frontend/src/pages/ResetPassword.jsx` | 1 | Confirm token expiry/one-time use and no token leakage in errors/logs |
| `/settings` | `frontend/src/pages/Settings.jsx` | 5 | Confirm admin permissions and sensitive configuration controls |
| `/groups` | `frontend/src/pages/GroupList.jsx` | 3 | Confirm tenant-scoped discovery, stable group ID, join requests and authoritative refresh |
| `/groups/:groupId` | `frontend/src/pages/GroupDetails.jsx` | 4 | Confirm object-level ownership, tenant isolation, membership request authorization and audit trail |
| `/create-group` | `frontend/src/pages/CreateGroupV2.jsx` | 2 | Confirm tenant resolution, creator admin membership, idempotency and persisted group state |
| `/meetings` | `frontend/src/pages/meetings/Meetings.jsx` | 12 | Confirm meeting CRUD, permissions, scheduling/timezone, attendance and any external provider status |
| `/inclusive-onboarding` | `frontend/src/pages/inclusive-onboarding/InclusiveOnboardingPage.jsx` | 1 | Confirm canonical KYC/consent services, human review, privacy and partner scope |
| `/retirement-support` | `frontend/src/pages/retirement-support/RetirementSupportPage.jsx` | 1 | Confirm retirement case/records API; official scheme credit remains separately evidenced |
| `/agriculture` | `frontend/src/pages/agriculture/AgricultureDashboard.jsx` | 1 grouped reference | Confirm all resource calls, tenant/member relationship and approved partner scope |
| `/ubuntu-float` | `frontend/src/pages/ubuntu-float/UbuntuFloatPage.jsx` | 1 grouped client import | Confirm capabilities endpoint, feature gate, agent RBAC and no ledger effect from manual observations |
| `/education-support/manage` | `frontend/src/pages/education-support/EducationCampaignManagerPage.jsx` | 1 grouped client import | Confirm server-side institution scope, review workflow, transaction/audit boundaries |
| `/faith-community-giving` | `frontend/src/pages/faith-community-giving/FaithCommunityGivingPage.jsx` | 1 grouped client import | Confirm public DTO allow-list and no public mutation/custody surface |
| `/faith-community-giving/manage` | `frontend/src/pages/faith-community-giving/FaithGivingManagerPage.jsx` | 1 grouped client import | Confirm management role, institution ownership, maker-checker and canonical ledger use |
| `/edufinance` | `frontend/src/pages/edufinance/EduFinancePage.jsx` | 0 direct call matches | Inspect delegated hooks/services and confirm guardian/borrower vs student beneficiary, partner lender, no TITech lending/custody |
| `/partner-support` | `frontend/src/pages/PartnerPortal.jsx` | 0 direct call matches | Inspect delegated services and confirm partner-specific access and tenant scope |
| Public institutional pages | `frontend/src/pages/public/InstitutionalPublicPages.jsx` | 1 shared submission function | Confirm data-minimised lead/contact submissions and consent; no public privileged API |

## Required endpoint contract columns for runtime completion

For each API invoked by a page, add the following evidence before marking it integration-tested:

1. HTTP method and exact versioned path.
2. Route registrar and middleware chain.
3. Controller and canonical service.
4. Auth requirement and allowed role/capability.
5. Tenant derivation and query scoping.
6. Request schema and validation rules.
7. Response schema and frontend consumer contract.
8. Error mapping for 400/401/403/404/409/422/429/500/502/503.
9. Database models/indexes/transaction boundary.
10. Audit/outbox/inbox effects and idempotency semantics.
11. Retry safety and timeout behaviour.
12. Integration/E2E evidence using controlled test tenants/data.

## Blockers

- No backend service was started in this environment.
- No MongoDB or Redis runtime was available.
- No frontend/backend dependencies were installed; outbound package downloads were unavailable.
- No provider sandbox credentials, institution test accounts or callback evidence were supplied.
- No API endpoint was promoted to live-verified from static source inspection.

**Current classification:** component import relationships are statically inventoried; API and database contracts are designed/implemented in source where present, but live integration status remains **NOT RUN / BLOCKED**.
