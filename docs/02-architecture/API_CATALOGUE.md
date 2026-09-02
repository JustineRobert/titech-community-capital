# TITech Community Capital Ltd

# Enterprise API Catalogue

**Document:** `docs/02-architecture/API_CATALOGUE.md`
**Status:** Production API Architecture Baseline
**Audience:** Architecture, Backend Engineering, Frontend Engineering, Mobile Engineering, Security, Compliance, DevOps/SRE, QA, Operations, Integration Partners
**Owner:** API Architecture / Backend Engineering
**Classification:** Internal / Confidential
**Version:** 1.0.0
**Review Cadence:** At least annually and after any material API contract, security, financial, or integration change

---

# 1. Purpose

This document defines the authoritative API catalogue for the TITech Community Capital platform.

It establishes:

* API domains;
* route ownership;
* versioning;
* request/response conventions;
* authentication;
* authorization;
* tenant isolation;
* idempotency;
* financial API controls;
* provider integration boundaries;
* callbacks;
* error contracts;
* pagination;
* filtering;
* rate limiting;
* concurrency behavior;
* asynchronous processing;
* event-driven APIs;
* audit requirements;
* API lifecycle and compatibility rules.

This document is the API-level companion to:

```text
docs/02-architecture/ARCHITECTURE_MAP.md
docs/02-architecture/DATA_MODEL_CATALOGUE.md
docs/02-architecture/SECURITY_MODEL.md
docs/02-architecture/FINANCIAL_LEDGER_SPECIFICATION.md
docs/02-architecture/TRANSACTION_STATE_MACHINE.md
docs/02-architecture/SERVICE_CATALOGUE.md
docs/02-architecture/EVENT_CATALOGUE.md
```

The API catalogue defines **external and internal API contracts**, not implementation details.

---

# 2. API Architecture Principles

## 2.1 APIs Are Contract Boundaries

An API is a contract between:

```text
Consumer
   ↓
API Boundary
   ↓
Application Service
   ↓
Domain Service
   ↓
Persistence / Integration
```

Consumers MUST NOT depend on internal database schema.

---

# 2.2 API Security Is Mandatory

Every protected endpoint MUST explicitly define:

```text
Authentication
Authorization
Tenant Scope
Input Validation
Output Filtering
Rate Limit
Audit Requirement
Idempotency Requirement
```

---

# 2.3 Controllers Remain Thin

Controllers SHOULD handle:

```text
request parsing
validation invocation
authentication context
service invocation
response mapping
error mapping
```

Controllers MUST NOT contain:

```text
ledger posting logic
complex accounting rules
provider-specific orchestration
large workflows
direct database mutation
```

---

# 2.4 Financial APIs Are Command-Oriented

Financial state MUST NOT be mutated through generic CRUD endpoints.

Preferred:

```text
POST /api/v1/payments
POST /api/v1/transactions
POST /api/v1/transactions/:id/reverse
POST /api/v1/adjustments
POST /api/v1/settlements/:id/reconcile
```

Avoid:

```text
PATCH /api/v1/accounts/:id
{
  "balance": 1000000
}
```

---

# 3. API Logical Architecture

```text
                              Clients
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
              ▼                   ▼                   ▼
            Web                Mobile            Partners
              │                   │                   │
              └───────────────────┼───────────────────┘
                                  ▼
                         API / Edge Layer
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
              ▼                   ▼                   ▼
         Authentication     Tenant Context       Security
              │                   │             Rate Limits
              └───────────────────┼───────────────────┘
                                  ▼
                         Application Services
                                  │
       ┌──────────────┬───────────┼────────────┬─────────────┐
       │              │           │            │             │
       ▼              ▼           ▼            ▼             ▼
   Platform       Savings      Lending      Payments      Compliance
       │              │           │            │             │
       └──────────────┴───────────┼────────────┴─────────────┘
                                  ▼
                           Financial Core
                                  │
                  ┌───────────────┼────────────────┐
                  │               │                │
                  ▼               ▼                ▼
                Ledger        Reconciliation    Settlement
                                  │
                                  ▼
                         Provider / External APIs
```

---

# 4. API Base Path

The canonical API base path is:

```text
/api/v1
```

Example:

```text
GET /api/v1/tenants
```

All public APIs SHOULD use explicit versioning.

---

# 5. API Versioning

Versioning MUST protect consumers from breaking changes.

Recommended:

```text
/api/v1
/api/v2
```

Breaking changes SHOULD introduce a new major API version.

Non-breaking additions MAY remain within the current version.

---

# 6. Breaking Changes

The following are breaking changes:

```text
removing a field
renaming a field
changing data type
changing required/optional behavior
changing endpoint semantics
changing authorization semantics
changing state meaning
changing financial calculation semantics
changing error meaning
```

Breaking changes require:

```text
new API version
or
explicit compatibility strategy
```

---

# 7. Non-Breaking Changes

Generally safe changes may include:

```text
adding optional response fields
adding new endpoints
adding new optional filters
adding new event fields
adding new states only when clients are designed to tolerate unknown values
```

However, state-machine changes MUST still be reviewed.

---

# 8. API Request Context

Every authenticated request SHOULD establish:

```text
requestId
correlationId
tenantId
userId
sessionId where applicable
traceId where available
```

Example:

```text
Request
  ↓
Request ID
  ↓
Authentication
  ↓
Tenant Resolution
  ↓
Authorization
  ↓
Application Service
```

---

# 9. Standard HTTP Headers

Recommended headers:

```text
Authorization
Content-Type
Accept
X-Request-ID
X-Correlation-ID
Idempotency-Key
If-Match
```

Additional headers MAY be used for provider-specific integration requirements.

---

# 10. Request ID

Every request SHOULD have a request ID.

Behavior:

```text
Client sends X-Request-ID
        ↓
Validate format
        ↓
Use if trusted/allowed
        ↓
Generate if absent
        ↓
Return in response
```

Request IDs MUST NOT be used as authentication credentials.

---

# 11. Correlation ID

Correlation IDs link multiple operations across services.

Examples:

```text
API Request
→ Payment Operation
→ Provider Call
→ Callback
→ Ledger Posting
→ Settlement
```

A correlation ID SHOULD remain stable across the logical workflow.

---

# 12. Authentication

Protected APIs MUST require authentication.

Canonical flow:

```text
Client
 ↓
Credentials / Token
 ↓
Authentication
 ↓
Identity
 ↓
Tenant Membership
 ↓
Authorization
 ↓
Resource
```

---

# 13. Authorization

Authorization MUST verify:

```text
identity
tenant
role / permission
resource ownership
business rules
```

Authentication alone does not grant resource access.

---

# 14. Tenant Isolation

All tenant-owned API endpoints MUST enforce tenant scope.

Example:

```text
GET /api/v1/loans/:loanId
```

must validate:

```text
loan.tenantId === authenticatedTenantId
```

where the request is tenant-scoped.

The client MUST NOT be allowed to bypass the trusted tenant context.

---

# 15. Cross-Tenant Administrative APIs

Cross-tenant operations require explicit privileged authorization.

Example:

```text
GET /api/v1/platform/tenants/:tenantId/operations
```

must require:

```text
platform-level permission
+
tenant target
+
audit
```

---

# 16. Content Negotiation

JSON is the canonical API representation.

Default:

```text
Content-Type: application/json
Accept: application/json
```

File APIs MAY support:

```text
multipart/form-data
```

---

# 17. Standard Success Response

Recommended envelope:

```json
{
  "success": true,
  "data": {},
  "requestId": "..."
}
```

For list operations:

```json
{
  "success": true,
  "data": [],
  "pagination": {
    "page": 1,
    "pageSize": 25,
    "total": 100
  },
  "requestId": "..."
}
```

---

# 18. Standard Error Response

Recommended:

```json
{
  "success": false,
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Resource not found",
    "details": null
  },
  "requestId": "..."
}
```

Production responses MUST NOT expose stack traces or sensitive infrastructure details.

---

# 19. Error Code Standards

Errors SHOULD use stable machine-readable codes.

Examples:

```text
VALIDATION_ERROR
AUTHENTICATION_REQUIRED
AUTHENTICATION_FAILED
AUTHORIZATION_DENIED
TENANT_ACCESS_DENIED
RESOURCE_NOT_FOUND
RESOURCE_CONFLICT
DUPLICATE_OPERATION
IDEMPOTENCY_CONFLICT
INVALID_STATE_TRANSITION
CONCURRENCY_CONFLICT
RATE_LIMITED
PROVIDER_UNAVAILABLE
PROVIDER_ERROR
RECONCILIATION_REQUIRED
FINANCIAL_INTEGRITY_FAILURE
INTERNAL_ERROR
```

---

# 20. HTTP Status Standards

Recommended mapping:

| Status | Meaning                                 |
| ------ | --------------------------------------- |
| 200    | Successful read/update/action           |
| 201    | Resource created                        |
| 202    | Accepted for asynchronous processing    |
| 204    | Successful no-content response          |
| 400    | Invalid request                         |
| 401    | Authentication required/failed          |
| 403    | Authorization denied                    |
| 404    | Resource not found                      |
| 409    | Conflict / idempotency / state conflict |
| 422    | Business validation failure             |
| 429    | Rate limited                            |
| 500    | Internal error                          |
| 502    | Upstream/provider failure               |
| 503    | Service unavailable                     |
| 504    | Upstream timeout                        |

The application SHOULD maintain consistent semantics.

---

# 21. API Domain Map

Primary API domains:

```text
/auth
/platform
/tenants
/onboarding
/users
/members
/groups
/savings
/loans
/payments
/settlements
/accounts
/transactions
/ledger
/billing
/compliance
/risk
/fraud
/reports
/notifications
/admin
/health
```

---

# 22. Authentication API

Base:

```text
/api/v1/auth
```

Primary endpoints:

```text
POST   /register
POST   /login
POST   /refresh
POST   /logout
POST   /forgot-password
POST   /reset-password
POST   /verify
POST   /mfa/challenge
POST   /mfa/verify
GET    /session
GET    /sessions
DELETE /sessions/:sessionId
```

---

# 23. Register

```text
POST /api/v1/auth/register
```

Purpose:

Create a platform identity.

Security:

```text
Public / controlled
Rate Limited
Input Validated
Audit Security Event
```

Response:

```text
201 Created
```

The registration workflow MUST NOT automatically grant privileged tenant access.

---

# 24. Login

```text
POST /api/v1/auth/login
```

Purpose:

Authenticate a user.

Controls:

```text
rate limit
credential protection
generic failure responses
audit
MFA where required
```

Response:

```text
200 OK
```

---

# 25. Refresh Token

```text
POST /api/v1/auth/refresh
```

Purpose:

Issue a new access token according to session policy.

Security requirements:

```text
refresh-token validation
rotation
reuse detection
session validation
audit
```

---

# 26. Logout

```text
POST /api/v1/auth/logout
```

Purpose:

Invalidate the current session/token context.

May return:

```text
204 No Content
```

---

# 27. Password Reset

```text
POST /api/v1/auth/forgot-password
POST /api/v1/auth/reset-password
```

Requirements:

```text
rate limit
single-use token
short expiration
generic responses
audit
```

---

# 28. Session APIs

```text
GET    /api/v1/auth/session
GET    /api/v1/auth/sessions
DELETE /api/v1/auth/sessions/:sessionId
```

Users may view and revoke their own sessions.

Privileged operators MAY have controlled security-session management permissions.

---

# 29. Platform Tenant APIs

Base:

```text
/api/v1/tenants
```

Endpoints:

```text
POST   /
GET    /
GET    /:tenantId
PATCH  /:tenantId
POST   /:tenantId/suspend
POST   /:tenantId/activate
POST   /:tenantId/close
GET    /:tenantId/settings
PATCH  /:tenantId/settings
```

Tenant administration MUST be tenant-scoped unless invoked through platform administration.

---

# 30. Tenant Creation

```text
POST /api/v1/tenants
```

Purpose:

Create a tenant or begin onboarding.

Typical workflow:

```text
PENDING
→ ONBOARDING
→ ACTIVE
```

The endpoint SHOULD support asynchronous completion where KYC/compliance dependencies exist.

---

# 31. Tenant Settings

```text
GET   /api/v1/tenants/:tenantId/settings
PATCH /api/v1/tenants/:tenantId/settings
```

Only authorized tenant administrators may change settings.

Provider secrets MUST NOT be returned.

---

# 32. Onboarding APIs

Base:

```text
/api/v1/onboarding
```

Representative endpoints:

```text
POST  /
GET   /:onboardingId
POST  /:onboardingId/submit
POST  /:onboardingId/verify
POST  /:onboardingId/approve
POST  /:onboardingId/reject
GET   /:onboardingId/status
```

Onboarding MUST use an explicit state machine.

---

# 33. User APIs

Base:

```text
/api/v1/users
```

Endpoints:

```text
GET   /me
PATCH /me
GET   /:userId
PATCH /:userId
GET   /:userId/sessions
```

Sensitive security fields MUST never be exposed.

---

# 34. Membership APIs

Base:

```text
/api/v1/tenants/:tenantId/memberships
```

Endpoints:

```text
POST   /
GET    /
GET    /:membershipId
PATCH  /:membershipId
POST   /:membershipId/suspend
POST   /:membershipId/revoke
POST   /:membershipId/restore
```

---

# 35. Member APIs

Base:

```text
/api/v1/members
```

Endpoints:

```text
POST   /
GET    /
GET    /:memberId
PATCH  /:memberId
GET    /:memberId/groups
GET    /:memberId/savings
GET    /:memberId/loans
GET    /:memberId/kyc
```

Member data MUST be filtered according to role and privacy requirements.

---

# 36. Group APIs

Base:

```text
/api/v1/groups
```

Endpoints:

```text
POST   /
GET    /
GET    /:groupId
PATCH  /:groupId
POST   /:groupId/activate
POST   /:groupId/suspend
POST   /:groupId/close
GET    /:groupId/members
POST   /:groupId/members
DELETE /:groupId/members/:memberId
```

Group membership changes MUST be auditable.

---

# 37. Savings Product APIs

Base:

```text
/api/v1/savings/products
```

Endpoints:

```text
POST  /
GET   /
GET   /:productId
POST  /:productId/activate
POST  /:productId/deactivate
```

Financial terms SHOULD be versioned.

---

# 38. Savings Account APIs

Base:

```text
/api/v1/savings/accounts
```

Endpoints:

```text
POST  /
GET   /
GET   /:accountId
GET   /:accountId/balance
GET   /:accountId/statement
POST  /:accountId/close
```

The balance response MUST be sourced from the financial core or an authoritative projection.

---

# 39. Savings Contribution API

```text
POST /api/v1/savings/accounts/:accountId/contributions
```

Required controls:

```text
authentication
authorization
tenant isolation
idempotency
amount validation
currency validation
financial posting
audit
```

Recommended header:

```text
Idempotency-Key: <unique-key>
```

---

# 40. Savings Withdrawal API

```text
POST /api/v1/savings/accounts/:accountId/withdrawals
```

Controls:

```text
available balance validation
authorization
limits
idempotency
payment processing
ledger posting
audit
```

---

# 41. Savings Transaction History

```text
GET /api/v1/savings/accounts/:accountId/transactions
```

Supports:

```text
date range
transaction type
status
reference
pagination
```

Tenant and account ownership MUST be enforced.

---

# 42. Loan Product APIs

Base:

```text
/api/v1/loans/products
```

Endpoints:

```text
POST  /
GET   /
GET   /:productId
POST  /:productId/activate
POST  /:productId/deactivate
```

---

# 43. Loan Application APIs

Base:

```text
/api/v1/loans/applications
```

Endpoints:

```text
POST  /
GET   /
GET   /:applicationId
PATCH /:applicationId
POST  /:applicationId/submit
POST  /:applicationId/cancel
```

State changes MUST use the loan application state machine.

---

# 44. Loan Review APIs

```text
POST /api/v1/loans/applications/:applicationId/review
GET  /api/v1/loans/applications/:applicationId/risk
POST /api/v1/loans/applications/:applicationId/approve
POST /api/v1/loans/applications/:applicationId/reject
```

Approval endpoints require explicit authorization.

---

# 45. Loan Risk API

Base:

```text
/api/v1/risk
```

Examples:

```text
POST /loan-applications/:applicationId/score
GET  /loan-applications/:applicationId/score
GET  /loan-applications/:applicationId/risk-profile
```

Scoring results SHOULD expose:

```text
score
grade
decision
reasonCodes
scoringVersion
```

Sensitive underlying features MUST be filtered.

---

# 46. Loan APIs

Base:

```text
/api/v1/loans
```

Endpoints:

```text
GET  /
GET  /:loanId
GET  /:loanId/balance
GET  /:loanId/schedule
GET  /:loanId/statement
POST /:loanId/disburse
POST /:loanId/repay
POST /:loanId/restructure
POST /:loanId/write-off
```

---

# 47. Loan Disbursement API

```text
POST /api/v1/loans/:loanId/disburse
```

This MUST create or use a controlled payment operation.

It MUST NOT directly modify:

```text
loan.outstandingPrincipal
```

without corresponding financial accounting.

---

# 48. Loan Repayment API

```text
POST /api/v1/loans/:loanId/repay
```

The request SHOULD support:

```text
amount
currency
paymentMethod
allocation instructions where permitted
idempotencyKey
```

Final allocation MUST follow approved product/accounting policy.

---

# 49. Loan Write-Off API

```text
POST /api/v1/loans/:loanId/write-off
```

Required controls:

```text
authorization
approval
reason
financial posting
audit
```

A write-off MUST NOT delete repayment history.

---

# 50. Payment APIs

Base:

```text
/api/v1/payments
```

Primary endpoints:

```text
POST  /
GET   /
GET   /:paymentId
POST  /:paymentId/cancel
POST  /:paymentId/retry
POST  /:paymentId/refund
GET   /:paymentId/attempts
GET   /:paymentId/status
```

---

# 51. Payment Create API

```text
POST /api/v1/payments
```

Required:

```text
amount
currency
payer
payee
paymentMethod
operationType
```

Recommended:

```text
Idempotency-Key
X-Correlation-ID
```

The endpoint MUST return an operation identity.

---

# 52. Payment Create Response

For synchronous completion:

```text
200 OK
```

For accepted asynchronous processing:

```text
202 Accepted
```

Example:

```json
{
  "success": true,
  "data": {
    "paymentId": "...",
    "operationId": "...",
    "status": "PROCESSING"
  },
  "requestId": "..."
}
```

---

# 53. Payment Status API

```text
GET /api/v1/payments/:paymentId/status
```

Response SHOULD distinguish:

```text
payment state
provider state
financial state
settlement state
```

Example:

```json
{
  "data": {
    "paymentStatus": "SUCCEEDED",
    "providerStatus": "SUCCESS",
    "financialStatus": "POSTED",
    "settlementStatus": "PENDING"
  }
}
```

This avoids collapsing multiple lifecycle states into one misleading value.

---

# 54. Payment Retry API

```text
POST /api/v1/payments/:paymentId/retry
```

Retry is allowed only when:

```text
current state is retryable
```

It MUST NOT blindly retry:

```text
UNKNOWN
```

when an external financial effect may already exist.

Unknown outcomes require reconciliation.

---

# 55. Payment Refund API

```text
POST /api/v1/payments/:paymentId/refund
```

The refund MUST create a new operation.

Required:

```text
originalPaymentId
amount
reason
idempotencyKey
```

A refund MUST NOT overwrite the original payment's financial history.

---

# 56. Settlement APIs

Base:

```text
/api/v1/settlements
```

Endpoints:

```text
GET  /
GET  /:settlementId
POST /:settlementId/reconcile
GET  /:settlementId/exceptions
POST /:settlementId/exceptions/:exceptionId/resolve
POST /:settlementId/finalize
```

---

# 57. Statement APIs

Base:

```text
/api/v1/statements
```

Endpoints:

```text
POST /import
GET  /
GET  /:statementId
GET  /:statementId/lines
POST /:statementId/process
POST /:statementId/reconcile
```

Imported statements MUST be validated before financial action.

---

# 58. Statement Batch APIs

```text
GET  /api/v1/statements/batches
GET  /api/v1/statements/batches/:batchId
POST /api/v1/statements/batches/:batchId/claim
POST /api/v1/statements/batches/:batchId/release
POST /api/v1/statements/batches/:batchId/complete
POST /api/v1/statements/batches/:batchId/fail
```

These endpoints are normally restricted to worker/operations contexts.

---

# 59. Financial Account APIs

Base:

```text
/api/v1/accounts
```

Endpoints:

```text
POST / 
GET  /
GET  /:accountId
GET  /:accountId/balance
GET  /:accountId/statement
GET  /:accountId/transactions
```

Account creation SHOULD be restricted to authorized finance/platform workflows.

---

# 60. Account Balance API

```text
GET /api/v1/accounts/:accountId/balance
```

Response SHOULD distinguish:

```text
ledgerBalance
availableBalance
pendingBalance
reservedBalance
currency
asOf
```

Example:

```json
{
  "data": {
    "ledgerBalance": 1000000,
    "availableBalance": 850000,
    "pendingBalance": 100000,
    "reservedBalance": 50000,
    "currency": "UGX",
    "asOf": "..."
  }
}
```

The implementation MUST use the authoritative financial balance rules.

---

# 61. Transaction APIs

Base:

```text
/api/v1/transactions
```

Endpoints:

```text
GET  /
GET  /:transactionId
GET  /:transactionId/journal
GET  /:transactionId/status
POST /:transactionId/reverse
```

Generic transaction creation SHOULD be restricted.

Business-specific financial commands are preferred.

---

# 62. Journal APIs

Base:

```text
/api/v1/ledger/journals
```

Endpoints:

```text
GET / 
GET /:journalId
GET /:journalId/entries
```

Creation should be restricted to controlled financial services.

---

# 63. Ledger APIs

Base:

```text
/api/v1/ledger
```

Read operations:

```text
GET /accounts
GET /accounts/:accountId
GET /transactions
GET /journals
GET /snapshots
GET /periods
GET /integrity
```

Write operations MUST be command-based.

---

# 64. Ledger Posting API

Where externally exposed:

```text
POST /api/v1/ledger/postings
```

This endpoint MUST NOT be available to general users.

It requires:

```text
high-privilege authorization
strict validation
idempotency
double-entry validation
period validation
audit
```

In many deployments, posting SHOULD remain internal to domain services rather than being a general public API.

---

# 65. Reversal API

```text
POST /api/v1/transactions/:transactionId/reverse
```

Request:

```json
{
  "reasonCode": "DUPLICATE_PAYMENT",
  "reason": "..."
}
```

Required:

```text
authorization
reason
idempotency
eligibility
period policy
```

---

# 66. Adjustment API

```text
POST /api/v1/ledger/adjustments
```

Request SHOULD include:

```text
sourceType
sourceId
reasonCode
description
lines
currency
idempotencyKey
```

Approval MUST be enforced where required.

---

# 67. Financial Period APIs

Base:

```text
/api/v1/ledger/periods
```

Endpoints:

```text
GET  /
GET  /:periodId
POST /:periodId/soft-close
POST /:periodId/final-close
POST /:periodId/lock
POST /:periodId/reopen
```

Period-management APIs are privileged.

---

# 68. Billing APIs

Base:

```text
/api/v1/billing
```

Endpoints:

```text
GET  /plans
GET  /subscription
POST /subscription
POST /subscription/change
POST /subscription/cancel
GET  /invoices
GET  /invoices/:invoiceId
POST /invoices/:invoiceId/pay
GET  /operations/:operationId
```

Subscription state and financial settlement state MUST remain distinct.

---

# 69. Billing Operation API

```text
GET /api/v1/billing/operations/:operationId
```

Should expose:

```text
status
operationType
amount
currency
subscription
provider reference where applicable
financial transaction reference where permitted
```

---

# 70. Compliance APIs

Base:

```text
/api/v1/compliance
```

Primary areas:

```text
/kyc
/aml
/screening
/regulatory
```

---

# 71. KYC APIs

```text
POST /api/v1/compliance/kyc
GET  /api/v1/compliance/kyc/:caseId
POST /api/v1/compliance/kyc/:caseId/submit
POST /api/v1/compliance/kyc/:caseId/verify
POST /api/v1/compliance/kyc/:caseId/reject
```

Sensitive KYC data MUST be filtered by role.

---

# 72. AML APIs

```text
GET  /api/v1/compliance/aml/cases
GET  /api/v1/compliance/aml/cases/:caseId
POST /api/v1/compliance/aml/cases/:caseId/assign
POST /api/v1/compliance/aml/cases/:caseId/escalate
POST /api/v1/compliance/aml/cases/:caseId/resolve
```

AML investigation details MUST remain restricted.

---

# 73. Screening APIs

```text
POST /api/v1/compliance/screening
GET  /api/v1/compliance/screening/:screeningId
```

---

# 74. Regulatory APIs

```text
POST /api/v1/compliance/regulatory/submissions
GET  /api/v1/compliance/regulatory/submissions
GET  /api/v1/compliance/regulatory/submissions/:submissionId
POST /api/v1/compliance/regulatory/submissions/:submissionId/validate
POST /api/v1/compliance/regulatory/submissions/:submissionId/submit
```

Submission state MUST use an explicit state machine.

---

# 75. Fraud APIs

Base:

```text
/api/v1/fraud
```

Endpoints:

```text
GET  /alerts
GET  /alerts/:alertId
POST /alerts/:alertId/assign
POST /alerts/:alertId/escalate
POST /alerts/:alertId/resolve
```

Fraud permissions MUST be tightly restricted.

---

# 76. Risk APIs

Base:

```text
/api/v1/risk
```

Examples:

```text
POST /assessments
GET  /assessments/:assessmentId
GET  /loan-applications/:applicationId/profile
```

---

# 77. Reporting APIs

Base:

```text
/api/v1/reports
```

Examples:

```text
GET /financial
GET /financial/trial-balance
GET /financial/income-statement
GET /financial/balance-sheet
GET /loans
GET /savings
GET /payments
GET /settlements
GET /risk
GET /fraud
```

Financial reports MUST derive from controlled financial data.

---

# 78. Dashboard APIs

Base:

```text
/api/v1/dashboards
```

Examples:

```text
GET /executive
GET /finance
GET /operations
GET /risk
GET /fraud
GET /settlement
```

Dashboards SHOULD consume read models/projections where appropriate.

---

# 79. Notification APIs

Base:

```text
/api/v1/notifications
```

Endpoints:

```text
GET  /
GET  /:notificationId
POST /:notificationId/retry
POST /preferences
GET  /preferences
```

Notification failures MUST NOT mutate financial state.

---

# 80. Administrative APIs

Base:

```text
/api/v1/admin
```

Administrative resources MAY include:

```text
/users
/roles
/permissions
/tenants
/jobs
/queues
/integrations
/security
/audit
```

Admin APIs require elevated privileges.

---

# 81. Audit APIs

Base:

```text
/api/v1/admin/audit
```

Examples:

```text
GET /events
GET /events/:eventId
GET /resources/:resourceType/:resourceId
```

Audit queries MUST be permission-controlled.

Sensitive audit payloads MUST be filtered.

---

# 82. Operations APIs

Base:

```text
/api/v1/admin/operations
```

Examples:

```text
GET /jobs
GET /jobs/:jobId
POST /jobs/:jobId/retry
POST /jobs/:jobId/release
POST /jobs/:jobId/replay
```

Replay/retry actions MUST be strongly authorized and audited.

---

# 83. Health APIs

Health endpoints SHOULD be separately exposed:

```text
GET /health
GET /health/live
GET /health/ready
```

They SHOULD NOT require normal user authentication if infrastructure probes need anonymous access, but they MUST avoid exposing sensitive internals.

---

# 84. Health Response

Example:

```json
{
  "status": "ok",
  "service": "community-savings-backend",
  "timestamp": "..."
}
```

Readiness MAY include sanitized dependency status.

Do not expose:

```text
database credentials
internal hostnames
connection strings
secret names
```

---

# 85. Provider Callback APIs

Provider callback endpoints are separate trust-boundary APIs.

Examples:

```text
POST /api/v1/payments/providers/mtn/callback
POST /api/v1/payments/providers/airtel/callback
```

These endpoints MUST:

```text
capture
authenticate/signature-verify
validate
deduplicate
normalize
process
audit
```

---

# 86. MTN Callback API

```text
POST /api/v1/payments/providers/mtn/callback
```

Requirements:

```text
signature / authenticity validation where supported
payload validation
provider reference validation
replay prevention
correlation
audit
```

The callback handler MUST NOT directly mutate the ledger.

---

# 87. Airtel Callback API

```text
POST /api/v1/payments/providers/airtel/callback
```

Requirements:

```text
signature/authenticity validation where supported
payload validation
replay prevention
provider reference verification
normalization
audit
```

---

# 88. Callback Response Semantics

Callbacks SHOULD return a safe acknowledgement after the request is:

```text
captured
validated sufficiently
queued/processed according to provider contract
```

Do not return success for an obviously invalid or forged callback merely to hide the failure.

Provider-specific acknowledgment semantics MUST be followed.

---

# 89. Provider Callback Idempotency

Every callback SHOULD be deduplicated using the strongest available identity:

```text
providerEventId
providerTransactionId
providerReference
payloadHash
```

The exact key depends on the provider contract.

---

# 90. API Idempotency

Idempotency is REQUIRED for critical commands such as:

```text
payment creation
payment refund
loan disbursement
loan repayment
ledger posting
ledger reversal
manual adjustment
billing payment
settlement finalization
regulatory submission
```

Header:

```text
Idempotency-Key: <unique-value>
```

---

# 91. Idempotency Response Behavior

If the same request is repeated:

```text
same idempotency key
+
same request fingerprint
```

the API SHOULD return the original result.

If the key is reused with a different request:

```text
409 Conflict
IDEMPOTENCY_CONFLICT
```

---

# 92. Request Fingerprint

For protected commands:

```text
fingerprint = SHA-256(canonical request)
```

may be persisted alongside:

```text
tenantId
operationType
idempotencyKey
```

---

# 93. Pagination

List endpoints SHOULD support pagination.

Preferred:

```text
?page=1&pageSize=25
```

or cursor-based pagination for high-volume collections.

Maximum page size MUST be enforced.

---

# 94. Cursor Pagination

For high-volume data:

```text
GET /api/v1/transactions?cursor=...&limit=50
```

Cursor tokens SHOULD be:

```text
opaque
non-sensitive
tamper-resistant
```

---

# 95. Sorting

Sort parameters SHOULD be allowlisted.

Example:

```text
?sort=-createdAt
```

Do not allow arbitrary field execution.

---

# 96. Filtering

Filters SHOULD be explicit.

Example:

```text
/status
/dateFrom
/dateTo
/provider
/accountId
```

Do not expose arbitrary database query operators.

---

# 97. Search

Search endpoints SHOULD:

```text
validate search fields
limit result size
enforce tenant scope
rate-limit expensive queries
```

---

# 98. API Query Limits

The API MUST control expensive operations.

Controls:

```text
maximum page size
maximum date range
maximum export range
maximum filter complexity
request timeout
```

---

# 99. Financial Query Controls

Financial transaction queries MUST be:

```text
tenant-scoped
permission-controlled
paginated
auditable where necessary
```

Large financial exports SHOULD run asynchronously.

---

# 100. Asynchronous APIs

Use `202 Accepted` when the operation is accepted but not completed synchronously.

Example:

```text
POST /api/v1/loans/:loanId/disburse
```

Response:

```json
{
  "success": true,
  "data": {
    "operationId": "...",
    "status": "PROCESSING"
  }
}
```

---

# 101. Operation Status API

For asynchronous commands:

```text
GET /api/v1/operations/:operationId
```

The response SHOULD include:

```text
operationId
operationType
status
progress where available
createdAt
updatedAt
completedAt
failureCode
```

---

# 102. Operation State

Canonical states MAY include:

```text
PENDING
PROCESSING
COMPLETED
FAILED
CANCELLED
TIMED_OUT
UNKNOWN
RECONCILIATION_REQUIRED
```

The exact state machine depends on the operation.

---

# 103. Polling vs Events

Clients MAY poll:

```text
GET /api/v1/operations/:operationId
```

For scalable integrations, event/webhook mechanisms SHOULD be preferred where supported.

Events MUST remain backed by durable state.

---

# 104. Webhooks

Outbound webhooks SHOULD support:

```text
eventId
eventType
eventVersion
tenantId where permitted
aggregateId
occurredAt
signature
deliveryAttempt
```

Consumers MUST verify webhook authenticity.

---

# 105. Webhook Signing

Outbound webhook signatures SHOULD use:

```text
canonical payload
+
shared secret / signing key
```

Verification MUST use timing-safe comparison where applicable.

---

# 106. Webhook Replay Protection

Consumers SHOULD deduplicate using:

```text
eventId
```

and optionally:

```text
eventVersion
aggregateId
```

---

# 107. API Security Requirements

Protected APIs MUST enforce:

```text
TLS
authentication
authorization
tenant isolation
input validation
output filtering
rate limiting
timeouts
safe errors
audit where required
```

---

# 108. Financial API Security Requirements

Financial commands additionally require:

```text
idempotency
ledger integrity
state validation
approval where required
audit
reconciliation
concurrency protection
```

---

# 109. Sensitive API Fields

Sensitive fields MUST NOT be exposed casually.

Examples:

```text
passwordHash
refreshToken
accessToken
providerClientSecret
encryptionKey
KYC raw documents
AML investigative details
private financial credentials
```

---

# 110. API Field Filtering

Different roles MAY receive different projections.

Example:

```text
Member:
limited account details

Finance Officer:
financial details

Auditor:
historical/audit details

Platform Security Admin:
security details where permitted
```

No endpoint should return raw database documents by default.

---

# 111. Optimistic Concurrency

APIs that update state-sensitive resources SHOULD support optimistic concurrency.

Potential mechanism:

```text
ETag
If-Match
version
stateVersion
```

Example:

```text
PATCH /api/v1/loans/:loanId
If-Match: "7"
```

If the resource version changed:

```text
409 Conflict
CONCURRENCY_CONFLICT
```

---

# 112. State Transition APIs

State-sensitive operations SHOULD use explicit commands:

```text
POST /:id/approve
POST /:id/reject
POST /:id/cancel
POST /:id/reverse
POST /:id/complete
POST /:id/release
```

rather than:

```text
PATCH /:id
{
  "status": "APPROVED"
}
```

---

# 113. API and State Machine Alignment

API commands MUST map to valid state transitions.

Example:

```text
POST /loans/:id/approve
```

is allowed only when:

```text
UNDER_REVIEW → APPROVED
```

It MUST reject:

```text
REJECTED → APPROVED
```

unless a separate reapplication process exists.

---

# 114. API and Ledger Alignment

Financial APIs MUST call controlled financial services.

Preferred:

```text
API
 ↓
Application Service
 ↓
Ledger Service
 ↓
Posting Engine
```

Not:

```text
API
 ↓
MongoDB Account.updateOne(...)
```

---

# 115. API and External Provider Alignment

Payment APIs SHOULD use:

```text
API
 ↓
Payment Service
 ↓
Provider Port
 ↓
Provider Adapter
 ↓
External Provider
```

Provider-specific logic MUST NOT leak into controllers.

---

# 116. API and Event Alignment

When a command changes durable state:

```text
Command
 ↓
Domain Operation
 ↓
Authoritative State
 +
Outbox Event
 ↓
Response
```

Do not return a success response before the required authoritative state is safely committed.

---

# 117. API Rate-Limit Classes

Suggested classes:

```text
AUTH
AUTH_SENSITIVE
PUBLIC
TENANT
FINANCIAL
CALLBACK
ADMIN
EXPORT
SEARCH
```

Financial commands should have stricter controls than ordinary reads.

---

# 118. Authentication Rate Limits

Apply separate limits to:

```text
login
registration
password reset
OTP request
OTP verification
token refresh
```

Limits MUST consider abuse and legitimate customer behavior.

---

# 119. Callback Rate Limits

Provider callback endpoints may require provider-specific controls.

However, callback rejection must not cause an external provider to enter endless retries.

Implement provider-specific acknowledgment behavior carefully.

---

# 120. API Timeout Policy

Every endpoint MUST have bounded execution time.

Long-running operations SHOULD return:

```text
202 Accepted
```

and continue asynchronously.

---

# 121. API Error Classification

The API SHOULD distinguish:

```text
client error
authorization error
business error
financial error
provider error
infrastructure error
```

Clients should receive stable codes rather than internal implementation errors.

---

# 122. Provider Error Mapping

Provider-specific errors MUST be normalized.

Example:

```text
MTN:
NETWORK_ERROR

Airtel:
TIMEOUT

Normalized:
PROVIDER_UNAVAILABLE
```

Provider-specific details MAY be retained internally.

---

# 123. Unknown Provider Outcome

If the provider outcome is unknown:

API SHOULD expose:

```text
status: "UNKNOWN"
```

or:

```text
status: "RECONCILIATION_REQUIRED"
```

rather than falsely reporting:

```text
FAILED
```

---

# 124. API Audit Requirements

Audit SHOULD be mandatory for:

```text
authentication/security events
tenant administration
role changes
financial commands
loan approval
disbursement
refund
reversal
adjustment
write-off
period close
regulatory submissions
high-risk administrative operations
```

---

# 125. API Observability

Every API request SHOULD produce:

```text
requestId
correlationId
route
method
statusCode
duration
tenantId where available
userId where available
```

Financial requests SHOULD additionally include:

```text
operationId
transactionId
```

---

# 126. API Metrics

Recommended:

```text
http_requests_total
http_request_duration
http_errors_total
auth_failures_total
authorization_denied_total
rate_limit_exceeded_total
idempotency_conflicts_total
financial_command_failures_total
provider_errors_total
callback_failures_total
```

---

# 127. API Tracing

OpenTelemetry-compatible tracing SHOULD cover:

```text
API request
 ↓
Controller
 ↓
Application service
 ↓
Repository / provider
 ↓
Ledger
 ↓
Outbox
```

Trace attributes SHOULD include only safe metadata.

---

# 128. API Logging

Structured logs SHOULD include:

```text
method
route
requestId
correlationId
tenantId
userId where safe
operationId
statusCode
duration
errorCode
```

Never log:

```text
password
access token
refresh token
provider secret
private key
sensitive payment credentials
```

---

# 129. API Documentation Standard

Every production endpoint MUST document:

```text
method
path
purpose
authentication
authorization
tenant scope
request schema
response schema
errors
idempotency
rate limit
state transitions
audit requirement
asynchronous behavior
```

---

# 130. Endpoint Documentation Template

```text
### POST /api/v1/resource

Purpose:
Create/process the resource.

Authentication:
Required.

Authorization:
Permission required.

Tenant Scope:
Tenant-owned.

Idempotency:
Required.

Request:
{ ... }

Response:
{ ... }

Errors:
- VALIDATION_ERROR
- AUTHORIZATION_DENIED
- IDEMPOTENCY_CONFLICT
- ...

Audit:
Required.

State Impact:
PENDING → PROCESSING

Async:
Yes / No
```

---

# 131. Public vs Internal APIs

The platform SHOULD distinguish:

```text
Public API
Partner API
Tenant API
Admin API
Internal API
Worker API
Provider Callback API
```

Each category may have different security and versioning requirements.

---

# 132. Internal API Security

Internal does not mean trusted.

Internal APIs MUST still enforce appropriate:

```text
service identity
authorization
tenant scope
validation
audit where required
```

---

# 133. Worker APIs

Worker-control APIs SHOULD be private/internal.

Examples:

```text
claim
complete
fail
release
replay
```

They SHOULD NOT be publicly routable.

---

# 134. Provider Callback APIs

Provider callback APIs are external integration endpoints with specialized trust models.

They SHOULD be isolated from generic application APIs.

---

# 135. Admin APIs

Admin endpoints SHOULD use stronger access control and may require:

```text
MFA
network restrictions
step-up authentication
enhanced audit
```

---

# 136. API Data Export

For large exports:

```text
POST /api/v1/reports/exports
```

Response:

```text
202 Accepted
```

Then:

```text
GET /api/v1/reports/exports/:exportId
```

Export files SHOULD be:

```text
encrypted
time-limited
permission-controlled
audited
```

---

# 137. Import APIs

Examples:

```text
POST /api/v1/statements/import
POST /api/v1/members/import
POST /api/v1/regulatory/submissions/import
```

Imports MUST:

```text
validate schema
validate tenant
validate content
limit size
detect duplicates
audit
```

---

# 138. File Upload Security

File APIs MUST enforce:

```text
size limits
content-type validation
extension allowlist
content signature checks
filename normalization
malware scanning where required
tenant ownership
secure storage
```

---

# 139. API Compatibility Rules

API consumers SHOULD tolerate:

```text
additional response fields
unknown enum values where safe
new optional fields
```

Consumers MUST NOT assume:

```text
field order
database IDs have a particular format
event timing is synchronous
HTTP 200 means financial completion
```

---

# 140. API Deprecation

Deprecated APIs SHOULD provide:

```text
deprecation notice
migration guidance
sunset date
replacement endpoint
```

Example response header:

```text
Deprecation: true
```

where supported.

---

# 141. API Lifecycle

Canonical lifecycle:

```text
DRAFT
 ↓
INTERNAL
 ↓
BETA
 ↓
STABLE
 ↓
DEPRECATED
 ↓
RETIRED
```

Financial APIs SHOULD require stricter change control before becoming stable.

---

# 142. API Contract Testing

Critical APIs SHOULD use contract tests covering:

```text
authentication
authorization
tenant isolation
request schema
response schema
error schema
state transitions
idempotency
concurrency
provider integration
ledger effects
```

---

# 143. API Integration Testing

Examples:

```text
POST payment
→ PaymentOperation created
→ Provider call
→ Callback
→ Payment succeeded
→ Financial transaction posted
```

and:

```text
POST loan disbursement
→ Loan state changes correctly
→ Payment operation created
→ Ledger posting created
→ Audit created
```

---

# 144. Financial API Test Requirements

Financial APIs MUST test:

```text
duplicate request
duplicate callback
same idempotency key + different payload
unauthorized posting
cross-tenant access
invalid account
closed period
unbalanced posting
stale state
provider timeout
provider unknown result
reversal
partial reversal
```

---

# 145. Tenant Isolation API Tests

Tests MUST include attempts such as:

```text
Tenant A user
→ Tenant B member
→ Tenant B loan
→ Tenant B account
→ Tenant B payment
→ Tenant B transaction
→ Tenant B statement
```

All unauthorized attempts MUST fail safely.

---

# 146. API Security Test Requirements

At minimum:

```text
authentication bypass
IDOR/BOLA
tenant escape
privilege escalation
NoSQL injection
rate-limit bypass
request smuggling considerations
SSRF
file upload abuse
secret exposure
error leakage
```

---

# 147. API Production Readiness Gate

An API is production-ready only when:

```text
[ ] Version defined
[ ] Owner defined
[ ] Authentication defined
[ ] Authorization defined
[ ] Tenant scope defined
[ ] Request schema defined
[ ] Response schema defined
[ ] Error contract defined
[ ] Idempotency defined where required
[ ] Rate limit defined
[ ] Timeout defined
[ ] Audit defined
[ ] Observability defined
[ ] State-machine impact defined
[ ] Financial impact defined
[ ] Concurrency behavior defined
[ ] Integration tests implemented
[ ] Security tests implemented
[ ] Documentation complete
```

---

# 148. Canonical Secure API Flow

```text
Client
  ↓
TLS
  ↓
Edge / Rate Limit
  ↓
Request ID
  ↓
Authentication
  ↓
Tenant Context
  ↓
Authorization
  ↓
Schema Validation
  ↓
Idempotency
  ↓
Application Service
  ↓
Domain Rules
  ↓
Financial / Provider / Persistence Operation
  ↓
Audit
  ↓
Outbox
  ↓
Response
```

---

# 149. Canonical Financial API Flow

```text
Client
  ↓
POST /api/v1/payments
  ↓
Authenticate
  ↓
Authorize
  ↓
Tenant Scope
  ↓
Validate
  ↓
Idempotency
  ↓
Payment Operation
  ↓
Provider Adapter
  ↓
Provider
  ↓
Verified Outcome
  ↓
Financial Posting
  ↓
Ledger
  ↓
Audit + Outbox
  ↓
Operation Status
```

---

# 150. Canonical Reversal API Flow

```text
POST /api/v1/transactions/:id/reverse
      ↓
Authentication
      ↓
Authorization
      ↓
Tenant Validation
      ↓
Transaction Eligibility
      ↓
Idempotency
      ↓
Approval
      ↓
Reversal Service
      ↓
Compensating Journal
      ↓
Atomic Commit
      ↓
Audit
      ↓
Outbox
```

---

# 151. Canonical Settlement API Flow

```text
Statement
  ↓
POST /api/v1/statements/:id/process
  ↓
Batch
  ↓
Claim
  ↓
Normalize
  ↓
Validate
  ↓
Reconcile
  ↓
Exception / Repair
  ↓
Ledger
  ↓
Settlement Complete
```

---

# 152. Canonical Admin Operation Flow

```text
Admin Request
  ↓
MFA / Strong Authentication
  ↓
Permission
  ↓
Tenant / Resource Scope
  ↓
Reason
  ↓
Approval where required
  ↓
Operation
  ↓
Audit
  ↓
Response
```

---

# 153. Non-Negotiable API Prohibitions

The following are prohibited:

```text
1. Unauthenticated access to protected resources.
2. Authentication without authorization.
3. Cross-tenant data access through object IDs.
4. Generic PATCH status mutation for controlled state machines.
5. Direct financial balance updates through public APIs.
6. Direct provider logic in controllers.
7. Accepting unvalidated provider callbacks.
8. Retrying unknown financial outcomes blindly.
9. Reusing idempotency keys for different payloads.
10. Returning secrets or sensitive internal data.
11. Unbounded list queries.
12. Unbounded file uploads.
13. Public database/worker control APIs.
14. Treating HTTP 200 as proof of financial completion.
15. Returning success before required authoritative state is committed.
```

---

# 154. API Ownership Matrix

| API Domain   | Primary Owner     | Financial Impact | High Risk |
| ------------ | ----------------- | ---------------: | --------: |
| Auth         | Identity          |               No |      High |
| Tenants      | SaaS Platform     |         Possible |      High |
| Members      | Community Finance |         Indirect |    Medium |
| Groups       | Community Finance |         Indirect |    Medium |
| Savings      | Community Finance |              Yes |      High |
| Loans        | Lending           |              Yes |      High |
| Payments     | Payments          |              Yes |  Critical |
| Settlements  | Settlement        |              Yes |  Critical |
| Accounts     | Financial Core    |              Yes |  Critical |
| Transactions | Financial Core    |              Yes |  Critical |
| Ledger       | Financial Core    |              Yes |  Critical |
| Billing      | SaaS/Billing      |              Yes |      High |
| Compliance   | Compliance        |         Indirect |      High |
| Risk         | Risk              |         Indirect |      High |
| Fraud        | Fraud             |         Possible |      High |
| Reports      | Reporting         |          Derived |    Medium |
| Admin        | Platform/Security |         Possible |  Critical |

---

# 155. API Security Matrix

| API Class         |                    Auth | Tenant Scope |      Idempotency |                          Audit |        Rate Limit |
| ----------------- | ----------------------: | -----------: | ---------------: | -----------------------------: | ----------------: |
| Public Auth       |                 Special |           No | Where applicable |                       Security |            Strict |
| Tenant CRUD       |                     Yes |          Yes |         Commands |                            Yes |               Yes |
| Member Read       |                     Yes |          Yes |               No | Sensitive reads where required |               Yes |
| Savings Command   |                     Yes |          Yes |              Yes |                            Yes |            Strict |
| Loan Approval     |                     Yes |          Yes |              Yes |                            Yes |            Strict |
| Payment           |                     Yes |          Yes |              Yes |                            Yes |            Strict |
| Provider Callback | Signature/Provider Auth |      Derived |              Yes |                            Yes | Provider-specific |
| Ledger            |                     Yes |          Yes |              Yes |                            Yes |       Very Strict |
| Settlement        |                     Yes |          Yes |              Yes |                            Yes |            Strict |
| Compliance        |                     Yes |          Yes | Where applicable |                            Yes |            Strict |
| Admin             |            Yes + Strong |     Explicit | Where applicable |                      Mandatory |            Strict |
| Health            |    Usually public probe |           No |               No |              No sensitive logs |        Controlled |

---

# 156. API Documentation Maintenance Rules

This catalogue MUST be updated whenever:

```text
new API added
endpoint removed
endpoint renamed
request schema changed
response schema changed
permission changed
tenant scope changed
state transition changed
financial semantics changed
provider integration changed
error contract changed
```

Code and documentation changes SHOULD be delivered together.

---

# 157. API Change Control

Every material API change SHOULD identify:

```text
Current Contract
Proposed Contract
Consumer Impact
Security Impact
Tenant Impact
Financial Impact
State Impact
Migration Plan
Backward Compatibility
Rollback Plan
Testing Strategy
```

---

# 158. API Design Decision Questions

Before adding an endpoint, answer:

```text
1. Which domain owns it?
2. Is it read or command?
3. Is it tenant-scoped?
4. Who may call it?
5. Is it idempotent?
6. What state machine does it affect?
7. Does it affect money?
8. Does it call an external provider?
9. Does it need async processing?
10. What happens on timeout?
11. What happens on duplicate request?
12. What happens if state is unknown?
13. What is audited?
14. What are the rate limits?
15. How is it observed?
```

---

# 159. Financial API Design Rules

For any endpoint that can affect money:

```text
[ ] Explicit command semantics
[ ] Idempotency
[ ] Tenant scope
[ ] Authorization
[ ] Amount validation
[ ] Currency validation
[ ] State-machine guard
[ ] Ledger path defined
[ ] Reversal behavior defined
[ ] Reconciliation path defined
[ ] Audit defined
[ ] Timeout/retry semantics defined
[ ] Unknown outcome handling defined
```

---

# 160. External Integration API Design Rules

For every provider integration:

```text
[ ] Provider authentication
[ ] TLS
[ ] Timeout
[ ] Retry
[ ] Circuit breaker
[ ] Provider reference
[ ] Signature verification
[ ] Replay protection
[ ] Normalized status
[ ] Unknown outcome handling
[ ] Reconciliation
[ ] Credential rotation
[ ] Audit
```

---

# 161. API Architecture Invariants

The following are mandatory:

```text
1. Every protected API is authenticated.
2. Every protected resource is authorized.
3. Every tenant-owned resource is tenant-scoped.
4. Every financial command is idempotent.
5. Every controlled state change uses an explicit transition.
6. Every external input is validated.
7. Every external callback is treated as untrusted.
8. Every financial result is backed by authoritative ledger state.
9. Every critical operation is observable.
10. Sensitive secrets never appear in API responses or logs.
11. Large operations are asynchronous.
12. Generic database structures are never exposed as API contracts.
13. API versioning protects consumers from breaking changes.
14. High-risk administrative operations are strongly controlled and audited.
15. Provider-specific logic remains behind adapter boundaries.
16. API success does not imply financial success unless explicitly defined.
17. Unknown external outcomes require controlled reconciliation.
18. Direct mutation of financial balances through APIs is prohibited.
19. API state values remain aligned with canonical state machines.
20. Material API changes are documented and reviewed.
```

---

# 162. Final Enterprise API Principle

The TITech Community Capital API layer is not merely an HTTP routing system.

It is a **security boundary, tenant-isolation boundary, workflow boundary, financial-command boundary, integration boundary, and operational observability boundary**.

The governing rule is:

> **Every API must have a clear domain owner, explicit authentication and authorization, strict tenant isolation, validated input, stable contracts, controlled state transitions, idempotent financial commands, safe external-integration behavior, observable execution, and deterministic failure handling. No API may bypass the Financial Core, state-machine controls, security model, or authoritative data ownership rules to achieve a local feature outcome.**

---

# 163. Related Architecture Documents

This API catalogue MUST remain aligned with:

```text
docs/02-architecture/ARCHITECTURE_MAP.md
docs/02-architecture/DATA_MODEL_CATALOGUE.md
docs/02-architecture/SECURITY_MODEL.md
docs/02-architecture/SERVICE_CATALOGUE.md
docs/02-architecture/EVENT_CATALOGUE.md
docs/02-architecture/FINANCIAL_LEDGER_SPECIFICATION.md
docs/02-architecture/TRANSACTION_STATE_MACHINE.md
```

Implementation SHOULD map to:

```text
backend/routes/
backend/controllers/
backend/middleware/
backend/modules/
backend/shared/
```

Any API implementation that changes authentication, authorization, tenant isolation, data ownership, transaction semantics, financial posting, provider integration, or lifecycle behavior MUST trigger updates to the relevant architecture documentation.

---

**End of API Catalogue**