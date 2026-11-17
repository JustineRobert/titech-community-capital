# Members, Loans and Savings — canonical read API architecture

**Updated:** 17 November 2026  
**Product:** TITech Community Capital  
**Organization:** TITECH CAPITAL - SMC LTD  
**Tagline:** Community Finance. Stronger Together.

## Scope

This document describes the tenant-scoped read surfaces added for the Members, Loans and Savings user experiences. The APIs are read-only. They reuse the existing Express ES-module router registry, JWT authentication, tenant middleware, Mongoose domain models, role/permission policy and existing financial transaction/ledger boundaries. They do not create a replacement member registry, loan engine, savings ledger, auth service or financial posting service.

## Confirmed member-detail defect

The protected React Router did not register `/members/:memberId`. Consequently the client wildcard route rendered the global Page Not Found screen without attempting to load the member. A second integration defect was that the existing directory page used legacy `/api/members`, a user-administration listing guarded for platform administrators, rather than the canonical `Member` model. This implementation registers the missing route and changes the directory to the canonical Member API. Whether a given 24-hex ID exists in a particular database remains a runtime data question; its syntax alone is not evidence of record existence or tenant ownership.

## Frontend routes

| Route | Component | Purpose |
|---|---|---|
| `/members` | `Members.jsx` | Tenant-scoped member directory, search/status filtering and pagination |
| `/members/:memberId` | `MemberProfile.jsx` | Independent deep-linked member profile |
| `/loans` | `Loans.jsx` | Read-only loan portfolio with server-side search/status/pagination |
| `/loans/:loanId` | `LoanDetails.jsx` | Tenant-scoped individual loan record |
| `/savings` | `Savings.jsx` | Savings transaction activity read model |
| `/savings/accounts` | `SavingsAccounts.jsx` | Savings account directory; supports `?memberId=` |
| `/savings/accounts/:accountId` | `SavingsAccountDetails.jsx` | Savings account detail and account transaction activity |
| `/savings/transactions/:transactionId` | `SavingsTransactionDetails.jsx` | Individual savings-linked transaction record |

The routes are registered within the existing protected route/layout tree. Browser refresh and server-side SPA fallback still require the actual configured frontend host to serve the application entry point for deep links; that deployment behavior was not tested in this archive-only environment.

## Backend API contracts

All three routers are mounted in the canonical route registry after `authenticate` and `tenantAuthorization`. Each endpoint also invokes a module-specific read permission.

### Members — `backend/routes/member-read.routes.js`

- `GET /api/v1/members?page=1&limit=25&search=&status=`
- `GET /api/v1/members/:memberId`

Permission: `MEMBER_VIEW`.  
Source: `Member` Mongoose model.  
Tenant key: trusted tenant context resolved by middleware and converted to the member schema's ObjectId tenant key.  
List limit: 1–100 records.  
Allowed filters: name, member number, email/phone search and supported member status values.  
Identifier validation: exactly 24 hexadecimal characters.  
The general profile projection intentionally excludes raw national ID, passport number and identity-document number/file contents. A cross-tenant ID returns the same `404 MEMBER_NOT_FOUND` response as a nonexistent record to reduce enumeration.

### Loans — `backend/routes/loan-read.routes.js`

- `GET /api/v1/loans?page=1&limit=25&search=&status=&memberId=`
- `GET /api/v1/loans/:loanId`

Permission: `LOAN_VIEW`.  
Source: `Loan` model with tenant filter, and authorized `Member` / `Group` population.  
Tenant key: trusted tenant context; the current Loan model stores tenantId as a string for deployment compatibility.  
List limit: 1–100 records.  
Search: loan document purpose/description/reason and ObjectId, plus a tenant-scoped lookup of member name/member number. This Loan model snapshot does not define a dedicated customer-facing loan-number field; the directory labels the persisted Mongo record identifier as Loan ID rather than suggesting a separate reference. Status and member filters are validated.  
The read API does not approve/reject applications, initiate disbursements, post repayments or mutate balances. Loan-model metrics are not proof of financial posting. Canonical Transaction / FinancialTransactionService / ledger / reconciliation evidence remains authoritative.

### Savings — `backend/routes/savings-read.routes.js`

- `GET /api/v1/savings?page=1&limit=25&search=&type=&memberId=&accountId=`
- `GET /api/v1/savings/transactions?page=1&limit=25&search=&type=&memberId=&accountId=`
- `GET /api/v1/savings/accounts?page=1&limit=25&search=&status=&memberId=`
- `GET /api/v1/savings/accounts/:accountId`
- `GET /api/v1/savings/transactions/:transactionId`

Permission: `SAVINGS_VIEW`.  
Sources: `Savings` account model and tenant-scoped `Transaction` records linked to `savingsId`. Transaction search/type filtering and pagination are server-side; member/account filters are resolved against the tenant-scoped Savings records. Populated account/member relations are tenant-constrained. The UI amount summaries are explicitly limited to the current page.  
The transaction list supports server-side reference/provider/source/status/member/account search, canonical transaction-type filtering and bounded pagination. The account aggregate snapshot identifies `financialSnapshotSource: SAVINGS_ACCOUNT_AGGREGATE` and `ledgerAuthority: false`; transaction DTOs do not infer a balance. The UI describes balance snapshots as non-authoritative and does not call them ledger-confirmed. No contribution, deposit, withdrawal or reversal write operation was added.

## Permission policy

`MEMBER_VIEW`, `LOAN_VIEW` and `SAVINGS_VIEW` are explicitly configured for `tenant_admin`; `platform_admin` receives permissions according to the existing policy resolver. Roles such as `member` and `guest` do not gain these module-level read permissions from this change. The API permission middleware is the enforcement boundary; frontend visibility is not authorization.

## Response and error behavior

Responses use the existing `{ success, data, requestId }` envelope. Relevant errors include:

- `400`: invalid 24-hex resource/filter identifier or unsupported status.
- `401`: authentication/session failure from the existing middleware/client.
- `403`: missing permission or invalid trusted tenant context.
- `404`: absent or cross-tenant resource (where enumeration protection is relevant).
- `503`: temporary read-service/database failure; request identifiers are preserved and internal details are not returned.

Frontend member profile screens distinguish invalid identifier, sign-in required, access denied, member not found and service-unavailable states. A server/API failure is not rewritten as the global route Not Found view.

## Financial display and controls

The frontend's `moneyDisplay.js` is presentation-only. It accepts non-negative safe integers, BigInt and integer strings, and rejects fractional or unsafe numeric representations rather than silently rounding. Authoritative financial arithmetic and balances are not computed in React. Savings account aggregate values remain snapshots and require canonical ledger/reconciliation verification before financial use. Loan status/amount fields do not establish a successful provider outcome, disbursement or settlement.

## Deliberately not implemented in this read-surface pass

- Member registration/update/status mutation/KYC decision endpoints.
- Loan origination, approval/rejection, maker-checker or disbursement actions.
- Repayment initiation/allocation/reversal actions.
- Savings contribution/deposit/withdrawal instructions.
- Financial receipt generation and authoritative member balance rollups.

These actions must only be surfaced after their canonical consent, authorization, transaction, provider verification, settlement, ledger, reconciliation and audit workflows are verified. The UI removes/does not present nonfunctional create/edit/approve/withdraw action buttons rather than simulating success.

## Verification status

Source-contract and exact-money helper tests pass 10/10. Backend syntax checks and repository syntax gate pass. Live MongoDB/Redis execution, actual database records, browser deep-link refresh, deployed SPA fallback, cross-tenant attack tests, ledger replay, provider sandbox/settlement and full E2E remain unverified because the supplied archive environment has no supported Node/npm runtime, installed dependencies or service credentials. This document is not production approval.
