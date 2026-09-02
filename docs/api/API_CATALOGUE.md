# TITech Community Capital Ltd

# API Catalogue

**Document:** `docs/api/API_CATALOGUE.md`
**Status:** Enterprise Production Baseline
**Version:** 1.0.0
**API Version:** `v1`
**Owner:** TITech Community Capital Engineering
**Classification:** Internal Engineering / Architecture
**Last Updated:** 2026-08-15

---

## 1. Purpose

This document is the authoritative catalogue of the TITech Community Capital API surface.

It defines:

* API boundaries
* API versioning
* endpoint conventions
* authentication requirements
* tenant isolation
* authorization
* request validation
* idempotency
* financial transaction safety
* callback security
* pagination
* filtering
* sorting
* error contracts
* correlation and tracing
* audit requirements
* API lifecycle governance
* service ownership
* domain-to-API mapping
* operational requirements
* compatibility rules
* endpoint inventory
* implementation status

The API catalogue is a **governance document**, not an implementation specification for individual controllers.

Controllers must orchestrate existing modules and services. Business rules, accounting rules, transaction state transitions, provider integration logic, and compliance decisions must remain within their respective domain services.

---

# 2. Architectural Position

The API layer is the controlled entry point into the TITech platform.

```text
┌───────────────────────────────────────────────────────────────────┐
│                         External Clients                          │
│                                                                   │
│ Web │ Mobile │ Admin │ SACCO Systems │ Partner Systems │ Providers│
└─────────────────────────────────┬─────────────────────────────────┘
                                  │
                                  ▼
┌───────────────────────────────────────────────────────────────────┐
│                         API Gateway / HTTP                         │
│                                                                   │
│ TLS │ CORS │ Request ID │ Rate Limit │ Body Limits │ Compression  │
└─────────────────────────────────┬─────────────────────────────────┘
                                  │
                                  ▼
┌───────────────────────────────────────────────────────────────────┐
│                       Request Context Layer                        │
│                                                                   │
│ correlation_id │ request_id │ trace_id │ tenant_id │ actor_id     │
└─────────────────────────────────┬─────────────────────────────────┘
                                  │
                                  ▼
┌───────────────────────────────────────────────────────────────────┐
│                    Authentication / Authorization                  │
│                                                                   │
│ JWT │ Session │ RBAC │ Policy │ Tenant Isolation │ Permissions    │
└─────────────────────────────────┬─────────────────────────────────┘
                                  │
                                  ▼
┌───────────────────────────────────────────────────────────────────┐
│                       Validation Layer                             │
│                                                                   │
│ Schema │ Type │ Business Preconditions │ Idempotency │ Limits     │
└─────────────────────────────────┬─────────────────────────────────┘
                                  │
                                  ▼
┌───────────────────────────────────────────────────────────────────┐
│                         API Controllers                            │
│                                                                   │
│ HTTP translation │ orchestration │ response mapping               │
└─────────────────────────────────┬─────────────────────────────────┘
                                  │
                                  ▼
┌───────────────────────────────────────────────────────────────────┐
│                     Domain Services / Modules                      │
│                                                                   │
│ Finance │ Loans │ Payments │ Compliance │ Onboarding │ SaaS       │
└─────────────────────────────────┬─────────────────────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
          ┌──────────────────┐        ┌──────────────────┐
          │ Persistence      │        │ Event / Queue    │
          │ MongoDB / Repos  │        │ Outbox / Events  │
          └──────────────────┘        └──────────────────┘
```

---

# 3. API Design Principles

The API platform SHALL follow these principles.

## 3.1 Contract first

Every production endpoint MUST have a documented:

* method
* path
* purpose
* authentication requirement
* authorization requirement
* tenant scope
* request contract
* response contract
* error contract
* idempotency requirement
* audit requirement
* observability requirement

## 3.2 Thin controllers

Controllers SHALL:

* authenticate the request
* resolve request context
* validate transport-level input
* invoke domain services
* translate domain results to HTTP responses
* translate known domain errors to stable API errors
* emit appropriate API telemetry

Controllers SHALL NOT:

* directly mutate financial balances
* implement double-entry accounting
* bypass ledger services
* implement provider settlement logic
* modify immutable financial records
* perform arbitrary tenant selection
* contain duplicated domain business rules

## 3.3 Single source of truth

Financial state MUST originate from the financial domain and ledger.

The API MUST NOT become an alternative accounting engine.

```text
API
 ↓
Financial Service
 ↓
Ledger Engine
 ↓
Journal / JournalEntry
 ↓
Account Balances / Snapshots
```

Never:

```text
API
 ↓
Account.balance += amount
```

---

# 4. Base URL

Production API base path:

```text
/api/v1
```

Example:

```text
https://api.example.com/api/v1
```

Environment-specific hosts MUST be configuration-driven.

Clients MUST NOT hard-code environment-specific hosts into business logic.

---

# 5. Versioning Strategy

The canonical external API version is:

```text
v1
```

Example:

```text
/api/v1/auth/login
/api/v1/loans
/api/v1/payments
```

## 5.1 Versioning rules

A new API version is required for breaking changes including:

* removing fields
* changing field meaning
* changing data types incompatibly
* changing authentication semantics
* changing transaction semantics
* changing required request fields
* changing response structures incompatibly
* changing endpoint meaning

Non-breaking additions MAY remain within the current version.

Examples:

* adding optional response fields
* adding optional request fields
* adding new endpoints
* adding new enum values where clients are required to tolerate unknown values

## 5.2 Version lifecycle

```text
DRAFT
  ↓
INTERNAL
  ↓
BETA
  ↓
GA
  ↓
DEPRECATED
  ↓
SUNSET
```

Every version SHALL have an explicit lifecycle owner.

---

# 6. Request Context

Every request SHOULD establish a request context containing:

```json
{
  "request_id": "req_01...",
  "correlation_id": "cor_01...",
  "trace_id": "trace_01...",
  "tenant_id": "tenant_01...",
  "actor_id": "user_01...",
  "client_id": "client_01..."
}
```

## 6.1 Request ID

Header:

```http
X-Request-ID: req_01J...
```

If supplied by a trusted upstream, it MAY be preserved subject to validation.

Otherwise the platform SHALL generate one.

## 6.2 Correlation ID

Header:

```http
X-Correlation-ID: cor_01J...
```

Correlation IDs SHALL propagate across:

* API calls
* service calls
* asynchronous jobs
* payment operations
* callbacks
* ledger operations
* audit records
* events

## 6.3 Trace context

Where OpenTelemetry is enabled, standard trace propagation SHOULD be used.

The API layer MUST NOT create unrelated traces for child operations that should belong to the originating transaction.

---

# 7. Authentication

Production authenticated APIs SHALL use short-lived access credentials.

Preferred model:

```text
Access Token
    +
Refresh Token
```

Refresh tokens SHOULD be:

* opaque
* rotated
* revocable
* securely stored
* associated with a session/device context
* protected against replay

For browser clients, refresh tokens SHOULD preferably use:

```text
HttpOnly
Secure
SameSite
```

cookies.

---

# 8. Authorization

Authentication answers:

> Who is making this request?

Authorization answers:

> Is this actor allowed to perform this operation on this resource in this tenant?

Authorization SHALL be enforced server-side.

Client-side permission checks are UX controls only and SHALL NOT be treated as security controls.

---

# 9. Tenant Isolation

TITech is a multi-tenant platform.

Every tenant-scoped API operation MUST resolve exactly one authoritative tenant context.

```text
Authenticated Actor
        │
        ▼
Tenant Membership
        │
        ▼
Tenant Authorization
        │
        ▼
Resource Authorization
```

The API MUST NOT trust:

```json
{
  "tenant_id": "arbitrary-client-value"
}
```

as proof of tenant access.

Where a tenant identifier is supplied by a client, it MUST be validated against the authenticated actor's authorized tenant context.

## 9.1 Tenant isolation invariants

A request MUST NOT:

* read another tenant's resources
* mutate another tenant's resources
* enumerate another tenant's identifiers
* infer another tenant's existence through authorization failures
* use cross-tenant identifiers without explicit privileged authorization

---

# 10. Actor Context

The authenticated request context SHOULD contain:

```text
actor_id
actor_type
tenant_id
roles
permissions
session_id
client_id
authentication_method
```

Possible actor types include:

```text
USER
ADMIN
SYSTEM
SERVICE
PROVIDER
JOB
WEBHOOK
```

System/service actors MUST use controlled machine identities rather than ordinary end-user credentials.

---

# 11. HTTP Conventions

## 11.1 Methods

| Method | Purpose                             |
| ------ | ----------------------------------- |
| GET    | Read                                |
| POST   | Create / command / action           |
| PUT    | Full replacement where appropriate  |
| PATCH  | Partial update where permitted      |
| DELETE | Deletion where explicitly supported |

Financial records SHALL NOT use ordinary update semantics to rewrite historical financial facts.

## 11.2 Status codes

| Status | Meaning                                    |
| ------ | ------------------------------------------ |
| 200    | Successful request                         |
| 201    | Resource created                           |
| 202    | Accepted for asynchronous processing       |
| 204    | Successful operation without response body |
| 400    | Malformed request                          |
| 401    | Authentication required/failed             |
| 403    | Authenticated but unauthorized             |
| 404    | Resource unavailable/not visible           |
| 409    | Conflict                                   |
| 422    | Validation/business rule failure           |
| 429    | Rate limit exceeded                        |
| 500    | Unexpected server error                    |
| 502    | Upstream/provider failure                  |
| 503    | Service temporarily unavailable            |
| 504    | Upstream timeout                           |

---

# 12. Content Type

Default request:

```http
Content-Type: application/json
```

Default response:

```http
Content-Type: application/json
```

Webhook/provider payloads MAY use provider-specific content types and MUST be normalized by the provider adapter layer.

---

# 13. Standard Response Envelope

Successful responses SHOULD use a consistent envelope.

```json
{
  "success": true,
  "data": {},
  "meta": {
    "request_id": "req_01J...",
    "correlation_id": "cor_01J..."
  }
}
```

Collection response:

```json
{
  "success": true,
  "data": [],
  "meta": {
    "request_id": "req_01J...",
    "correlation_id": "cor_01J...",
    "pagination": {
      "page": 1,
      "page_size": 25,
      "has_next": true,
      "has_previous": false
    }
  }
}
```

---

# 14. Standard Error Contract

Production APIs SHALL expose stable machine-readable error codes.

Example:

```json
{
  "success": false,
  "error": {
    "code": "LOAN_APPLICATION_NOT_ELIGIBLE",
    "message": "The loan application does not satisfy the required eligibility conditions.",
    "details": [],
    "retryable": false
  },
  "meta": {
    "request_id": "req_01J...",
    "correlation_id": "cor_01J..."
  }
}
```

## 14.1 Error requirements

Errors SHALL contain:

* stable error code
* safe human-readable message
* retryability where applicable
* request ID
* correlation ID

Errors MUST NOT expose:

* passwords
* access tokens
* refresh tokens
* secret keys
* provider credentials
* internal stack traces
* database credentials
* sensitive internal infrastructure details

---

# 15. Error Taxonomy

Recommended error namespaces:

```text
AUTH_*
TENANT_*
USER_*
KYC_*
AML_*
ONBOARDING_*
SUBSCRIPTION_*
LOAN_*
PAYMENT_*
LEDGER_*
TRANSACTION_*
SETTLEMENT_*
STATEMENT_*
COMPLIANCE_*
PROVIDER_*
IDEMPOTENCY_*
VALIDATION_*
RATE_LIMIT_*
SYSTEM_*
```

Examples:

```text
AUTH_INVALID_CREDENTIALS
AUTH_TOKEN_EXPIRED
TENANT_ACCESS_DENIED
VALIDATION_FAILED
IDEMPOTENCY_KEY_REUSED
LEDGER_POSTING_REJECTED
TRANSACTION_ALREADY_COMPLETED
PAYMENT_PROVIDER_UNAVAILABLE
SETTLEMENT_ALREADY_PROCESSED
```

---

# 16. Idempotency

All financial commands MUST support idempotency.

Recommended header:

```http
Idempotency-Key: <unique-client-generated-key>
```

Applicable operations include:

* payment initiation
* loan disbursement
* loan repayment
* ledger posting
* transaction creation
* settlement
* refund
* reversal
* subscription creation
* billing operations
* regulatory submission
* other externally retryable commands

## 16.1 Idempotency semantics

The same:

```text
tenant_id
+
operation
+
Idempotency-Key
```

MUST resolve to the same logical operation.

A repeated request MUST NOT create a second financial effect.

## 16.2 Idempotency states

```text
RECEIVED
  ↓
PROCESSING
  ↓
SUCCEEDED
  ├── replay → original result
  │
  └── FAILED
         │
         ├── retryable
         └── terminal
```

Concurrent requests using the same idempotency key MUST be serialized or deterministically rejected.

---

# 17. Financial API Safety

Financial APIs are command interfaces into the ledger.

The API layer MUST enforce the following invariant:

> No financial balance is changed directly by an HTTP controller.

Financial mutations MUST pass through the appropriate financial service and ledger/posting engine.

---

# 18. Financial Transaction State

Where transaction state is externally exposed, it MUST map to the authoritative transaction state machine.

Example lifecycle:

```text
INITIATED
   ↓
VALIDATING
   ↓
AUTHORIZED
   ↓
PROCESSING
   ↓
POSTING
   ↓
COMPLETED
```

Failure paths:

```text
INITIATED
   ↓
FAILED
```

```text
PROCESSING
   ↓
FAILED
```

```text
COMPLETED
   ↓
REVERSAL_REQUESTED
   ↓
REVERSED
```

A completed financial transaction MUST NOT be converted into an arbitrary edited state.

---

# 19. Immutability

The API MUST distinguish between:

### Mutable operational data

Examples:

* display preferences
* notification preferences
* configuration
* non-financial profile metadata

### Immutable financial facts

Examples:

* posted journal entries
* ledger postings
* completed transactions
* settlement records
* accounting events
* historical audit events

Financial correction SHALL use:

```text
Reversal
+
Adjustment
+
Audit Trail
```

rather than destructive mutation.

---

# 20. Monetary Values

Financial APIs SHOULD represent monetary amounts in a deterministic format.

Preferred representation:

```json
{
  "amount": "150000.00",
  "currency": "UGX"
}
```

The API MUST NOT depend on binary floating-point arithmetic for financial calculations.

Currency MUST be explicit for monetary commands and responses where ambiguity is possible.

---

# 21. Pagination

Collection endpoints SHOULD support:

```text
page
page_size
```

or a cursor-based strategy where high-volume datasets require it.

Recommended maximum:

```text
page_size <= 100
```

Clients MUST NOT be allowed to request unbounded collections.

For high-volume operational data, cursor pagination SHOULD be preferred.

---

# 22. Filtering

Filtering MUST be allowlisted.

Example:

```http
GET /api/v1/transactions?status=COMPLETED&from=2026-08-01&to=2026-08-15
```

The API MUST NOT expose arbitrary database query operators.

---

# 23. Sorting

Sorting MUST use an allowlist.

Example:

```http
GET /api/v1/loans?sort=-createdAt
```

The server MUST reject unsupported sort fields.

---

# 24. Rate Limiting

Rate limiting SHALL be applied at multiple levels where appropriate:

```text
Global
  ↓
IP / Client
  ↓
Authenticated Actor
  ↓
Tenant
  ↓
Endpoint
  ↓
Sensitive Operation
```

Higher protection SHOULD apply to:

* login
* OTP operations
* password reset
* token refresh
* payment initiation
* provider callbacks
* administrative commands

Rate-limit responses SHOULD include:

```http
Retry-After
```

where practical.

---

# 25. API Security Requirements

All production APIs SHALL implement appropriate controls for:

* TLS
* authentication
* authorization
* tenant isolation
* request validation
* output encoding
* CORS
* security headers
* request size limits
* timeout protection
* rate limiting
* audit logging
* secret protection
* replay protection
* idempotency
* abuse prevention

Sensitive data MUST be minimized in requests and responses.

---

# 26. Authentication API

## 26.1 Login

```http
POST /api/v1/auth/login
```

**Purpose:** Authenticate an account.

**Authentication:** Public.

**Idempotency:** Not required.

**Audit:** Required.

**Security:** Aggressive rate limiting and credential abuse protection.

---

## 26.2 Refresh Token

```http
POST /api/v1/auth/refresh
```

**Purpose:** Rotate/refresh access credentials.

**Authentication:** Refresh credential.

**Idempotency:** Not required.

**Security:** Replay protection required.

---

## 26.3 Logout

```http
POST /api/v1/auth/logout
```

**Purpose:** Terminate current session.

**Authentication:** Required.

**Audit:** Required.

---

## 26.4 Current User

```http
GET /api/v1/auth/me
```

**Purpose:** Return authenticated actor context.

**Authentication:** Required.

---

## 26.5 Password Change

```http
POST /api/v1/auth/change-password
```

**Purpose:** Change authenticated account credentials.

**Authentication:** Required.

**Audit:** Required.

**Security:** Never log credentials.

---

# 27. User API

Base:

```text
/api/v1/users
```

Representative operations:

| Method | Endpoint         | Purpose                        | Auth             |
| ------ | ---------------- | ------------------------------ | ---------------- |
| GET    | `/users/me`      | Current profile                | User             |
| PATCH  | `/users/me`      | Update permitted profile data  | User             |
| GET    | `/users/:userId` | Retrieve authorized user       | Admin/Authorized |
| PATCH  | `/users/:userId` | Update authorized profile data | Admin/Authorized |
| GET    | `/users`         | Tenant user listing            | Tenant Admin     |

User endpoints MUST enforce tenant authorization.

---

# 28. Tenant API

Base:

```text
/api/v1/tenants
```

Representative operations:

| Method | Endpoint                             | Purpose                        |
| ------ | ------------------------------------ | ------------------------------ |
| POST   | `/tenants`                           | Create tenant where authorized |
| GET    | `/tenants/:tenantId`                 | Retrieve tenant                |
| PATCH  | `/tenants/:tenantId`                 | Update tenant configuration    |
| GET    | `/tenants/:tenantId/members`         | List tenant members            |
| POST   | `/tenants/:tenantId/members`         | Add/invite member              |
| PATCH  | `/tenants/:tenantId/members/:userId` | Change membership/role         |
| DELETE | `/tenants/:tenantId/members/:userId` | Remove membership              |

Cross-tenant administrative operations require explicit platform-level authorization.

---

# 29. SACCO / Community Onboarding API

Base:

```text
/api/v1/onboarding
```

Representative operations:

| Method | Endpoint                                          | Purpose                          |
| ------ | ------------------------------------------------- | -------------------------------- |
| POST   | `/onboarding/applications`                        | Start onboarding                 |
| GET    | `/onboarding/applications/:applicationId`         | Retrieve application             |
| PATCH  | `/onboarding/applications/:applicationId`         | Update permitted onboarding data |
| POST   | `/onboarding/applications/:applicationId/submit`  | Submit application               |
| POST   | `/onboarding/applications/:applicationId/verify`  | Execute verification             |
| POST   | `/onboarding/applications/:applicationId/approve` | Approve                          |
| POST   | `/onboarding/applications/:applicationId/reject`  | Reject                           |
| POST   | `/onboarding/applications/:applicationId/go-live` | Activate tenant                  |

Onboarding transitions MUST be controlled by the onboarding workflow engine.

Clients MUST NOT directly set arbitrary workflow states.

---

# 30. KYC API

Base:

```text
/api/v1/kyc
```

Representative operations:

| Method | Endpoint                       | Purpose                  |
| ------ | ------------------------------ | ------------------------ |
| POST   | `/kyc/cases`                   | Create KYC case          |
| GET    | `/kyc/cases/:caseId`           | Retrieve KYC case        |
| POST   | `/kyc/cases/:caseId/documents` | Submit document metadata |
| POST   | `/kyc/cases/:caseId/verify`    | Request verification     |
| POST   | `/kyc/cases/:caseId/approve`   | Approve                  |
| POST   | `/kyc/cases/:caseId/reject`    | Reject                   |

KYC data MUST be protected according to its sensitivity classification.

---

# 31. Compliance API

Base:

```text
/api/v1/compliance
```

Representative operations:

| Method | Endpoint                                       | Purpose                     |
| ------ | ---------------------------------------------- | --------------------------- |
| GET    | `/compliance/cases`                            | List compliance cases       |
| GET    | `/compliance/cases/:caseId`                    | Retrieve case               |
| POST   | `/compliance/cases/:caseId/review`             | Start/review case           |
| POST   | `/compliance/cases/:caseId/resolve`            | Resolve case                |
| GET    | `/compliance/alerts`                           | Retrieve compliance alerts  |
| GET    | `/compliance/submissions`                      | List regulatory submissions |
| POST   | `/compliance/submissions`                      | Create submission           |
| POST   | `/compliance/submissions/:submissionId/submit` | Submit regulatory report    |

Regulatory submission operations MUST be auditable and idempotent.

---

# 32. Account API

Base:

```text
/api/v1/accounts
```

Representative operations:

| Method | Endpoint                            | Purpose                        |
| ------ | ----------------------------------- | ------------------------------ |
| GET    | `/accounts`                         | List authorized accounts       |
| POST   | `/accounts`                         | Create account where permitted |
| GET    | `/accounts/:accountId`              | Retrieve account               |
| GET    | `/accounts/:accountId/balance`      | Retrieve balance               |
| GET    | `/accounts/:accountId/statement`    | Retrieve account statement     |
| GET    | `/accounts/:accountId/transactions` | Retrieve account transactions  |

Account balance responses MUST originate from the authoritative balance engine.

---

# 33. Ledger API

Base:

```text
/api/v1/ledger
```

Ledger APIs are primarily administrative/internal financial interfaces.

Representative operations:

| Method | Endpoint                                      | Purpose                              |
| ------ | --------------------------------------------- | ------------------------------------ |
| GET    | `/ledger/accounts`                            | List ledger accounts                 |
| GET    | `/ledger/accounts/:accountId`                 | Retrieve ledger account              |
| GET    | `/ledger/accounts/:accountId/balance`         | Retrieve authoritative balance       |
| GET    | `/ledger/journals/:journalId`                 | Retrieve journal                     |
| GET    | `/ledger/entries/:entryId`                    | Retrieve journal entry               |
| GET    | `/ledger/transactions/:transactionId`         | Retrieve ledger transaction          |
| POST   | `/ledger/transactions`                        | Controlled financial posting command |
| POST   | `/ledger/transactions/:transactionId/reverse` | Reverse transaction                  |
| POST   | `/ledger/adjustments`                         | Create authorized adjustment         |

Direct journal-entry editing endpoints MUST NOT exist.

For example, the API MUST NOT expose:

```http
PATCH /ledger/journal-entries/:id
```

for changing posted accounting facts.

---

# 34. Transaction API

Base:

```text
/api/v1/transactions
```

Representative operations:

| Method | Endpoint                               | Purpose                    |
| ------ | -------------------------------------- | -------------------------- |
| POST   | `/transactions`                        | Initiate transaction       |
| GET    | `/transactions/:transactionId`         | Retrieve transaction       |
| GET    | `/transactions`                        | Search/list transactions   |
| POST   | `/transactions/:transactionId/cancel`  | Cancel where state permits |
| POST   | `/transactions/:transactionId/reverse` | Initiate reversal          |
| GET    | `/transactions/:transactionId/events`  | Retrieve lifecycle events  |

Transaction operations MUST enforce state-machine rules.

---

# 35. Payment API

Base:

```text
/api/v1/payments
```

Representative operations:

| Method | Endpoint                       | Purpose                                  |
| ------ | ------------------------------ | ---------------------------------------- |
| POST   | `/payments`                    | Initiate payment                         |
| GET    | `/payments/:paymentId`         | Retrieve payment                         |
| GET    | `/payments`                    | Search/list payments                     |
| POST   | `/payments/:paymentId/cancel`  | Cancel eligible payment                  |
| POST   | `/payments/:paymentId/refund`  | Initiate refund where supported          |
| POST   | `/payments/:paymentId/reverse` | Reverse financial effect where supported |

Every payment command MUST have:

```text
tenant context
actor context
correlation ID
idempotency key
audit record
transaction reference
```

---

# 36. MTN MoMo API

Provider-specific API operations SHOULD remain behind the payment/provider abstraction.

Representative internal command surface:

```text
POST /api/v1/payments/momo/collections
POST /api/v1/payments/momo/disbursements
GET  /api/v1/payments/momo/:paymentId
```

Provider credentials MUST never be exposed to clients.

Provider-specific implementation MUST remain within the provider adapter/service layer.

---

# 37. Airtel Money API

Representative internal command surface:

```text
POST /api/v1/payments/airtel/collections
POST /api/v1/payments/airtel/disbursements
GET  /api/v1/payments/airtel/:paymentId
```

Authentication and provider token management MUST remain inside the Airtel integration layer.

Clients MUST NOT supply provider access tokens.

---

# 38. Provider Callback API

Callbacks are security-sensitive APIs.

Base:

```text
/api/v1/webhooks
```

Representative endpoints:

```text
POST /api/v1/webhooks/mtn
POST /api/v1/webhooks/airtel
```

Provider callbacks MUST pass through:

```text
Provider Callback
      ↓
Callback Registry
      ↓
Provider Adapter
      ↓
Signature Verification
      ↓
Payload Normalization
      ↓
Replay Protection
      ↓
Idempotency
      ↓
Callback Processing Engine
      ↓
Payment / Transaction Service
      ↓
Ledger
      ↓
Audit / Events
```

The callback endpoint MUST NOT blindly trust provider payloads.

---

# 39. Callback Security

Every supported provider callback SHOULD implement:

* signature verification
* timestamp validation where available
* replay protection
* idempotency
* provider transaction correlation
* payload normalization
* schema validation
* audit logging
* structured tracing

A callback MUST NOT directly modify an account balance.

---

# 40. Loan API

Base:

```text
/api/v1/loans
```

Representative operations:

| Method | Endpoint                                      | Purpose                      |
| ------ | --------------------------------------------- | ---------------------------- |
| GET    | `/loans/products`                             | List loan products           |
| POST   | `/loans/products`                             | Create loan product          |
| GET    | `/loans/products/:productId`                  | Retrieve product             |
| POST   | `/loans/applications`                         | Create application           |
| GET    | `/loans/applications/:applicationId`          | Retrieve application         |
| PATCH  | `/loans/applications/:applicationId`          | Update eligible application  |
| POST   | `/loans/applications/:applicationId/submit`   | Submit application           |
| POST   | `/loans/applications/:applicationId/approve`  | Approve                      |
| POST   | `/loans/applications/:applicationId/reject`   | Reject                       |
| POST   | `/loans/applications/:applicationId/disburse` | Disburse                     |
| GET    | `/loans/:loanId`                              | Retrieve loan                |
| GET    | `/loans/:loanId/schedule`                     | Retrieve repayment schedule  |
| GET    | `/loans/:loanId/repayments`                   | Retrieve repayments          |
| POST   | `/loans/:loanId/repayments`                   | Record repayment command     |
| POST   | `/loans/:loanId/restructure`                  | Restructure where supported  |
| POST   | `/loans/:loanId/write-off`                    | Authorized write-off command |

Loan lifecycle transitions MUST be controlled by the loan domain.

---

# 41. Loan Risk API

Base:

```text
/api/v1/risk
```

Representative operations:

| Method | Endpoint                                          | Purpose                |
| ------ | ------------------------------------------------- | ---------------------- |
| POST   | `/risk/loan-applications/:applicationId/score`    | Request risk score     |
| GET    | `/risk/loan-applications/:applicationId/profile`  | Retrieve risk profile  |
| GET    | `/risk/loan-applications/:applicationId/decision` | Retrieve decision data |

Risk scoring SHOULD record:

```text
scoring_version
input_fingerprint
base_score
correlation_id
idempotency_key
```

Risk decisions MUST be reproducible and auditable.

---

# 42. Savings API

Base:

```text
/api/v1/savings
```

Representative operations:

| Method | Endpoint                                    | Purpose               |
| ------ | ------------------------------------------- | --------------------- |
| GET    | `/savings/accounts`                         | List savings accounts |
| POST   | `/savings/accounts`                         | Open savings account  |
| GET    | `/savings/accounts/:accountId`              | Retrieve account      |
| GET    | `/savings/accounts/:accountId/balance`      | Retrieve balance      |
| POST   | `/savings/accounts/:accountId/deposits`     | Initiate deposit      |
| POST   | `/savings/accounts/:accountId/withdrawals`  | Initiate withdrawal   |
| GET    | `/savings/accounts/:accountId/transactions` | Retrieve history      |

All financial effects MUST pass through the ledger.

---

# 43. Statements API

Base:

```text
/api/v1/statements
```

Representative operations:

| Method | Endpoint                                     | Purpose                         |
| ------ | -------------------------------------------- | ------------------------------- |
| POST   | `/statements/imports`                        | Start statement import          |
| GET    | `/statements/imports/:importId`              | Retrieve import                 |
| GET    | `/statements/batches/:batchId`               | Retrieve processing batch       |
| POST   | `/statements/batches/:batchId/retry`         | Retry eligible batch            |
| GET    | `/statements/reconciliation`                 | Retrieve reconciliation results |
| GET    | `/statements/exceptions`                     | Retrieve exceptions             |
| POST   | `/statements/exceptions/:exceptionId/repair` | Initiate repair                 |
| GET    | `/statements/:statementId`                   | Retrieve statement              |

Statement processing MUST maintain ownership and concurrency controls for batch workers.

---

# 44. Reconciliation API

Base:

```text
/api/v1/reconciliation
```

Representative operations:

| Method | Endpoint                                          | Purpose                  |
| ------ | ------------------------------------------------- | ------------------------ |
| GET    | `/reconciliation/runs`                            | List reconciliation runs |
| POST   | `/reconciliation/runs`                            | Start reconciliation     |
| GET    | `/reconciliation/runs/:runId`                     | Retrieve run             |
| GET    | `/reconciliation/runs/:runId/exceptions`          | Retrieve exceptions      |
| POST   | `/reconciliation/exceptions/:exceptionId/resolve` | Resolve exception        |

Reconciliation MUST NOT silently alter financial facts.

Adjustments MUST use controlled ledger commands.

---

# 45. Settlement API

Base:

```text
/api/v1/settlements
```

Representative operations:

| Method | Endpoint                               | Purpose                     |
| ------ | -------------------------------------- | --------------------------- |
| GET    | `/settlements`                         | List settlements            |
| GET    | `/settlements/:settlementId`           | Retrieve settlement         |
| POST   | `/settlements/:settlementId/reconcile` | Reconcile settlement        |
| POST   | `/settlements/:settlementId/reverse`   | Reverse eligible settlement |

Settlement operations MUST be idempotent.

---

# 46. SaaS Subscription API

Base:

```text
/api/v1/subscriptions
```

Representative operations:

| Method | Endpoint                                     | Purpose               |
| ------ | -------------------------------------------- | --------------------- |
| GET    | `/subscriptions/plans`                       | List plans            |
| GET    | `/subscriptions/plans/:planId`               | Retrieve plan         |
| POST   | `/subscriptions`                             | Create subscription   |
| GET    | `/subscriptions/:subscriptionId`             | Retrieve subscription |
| POST   | `/subscriptions/:subscriptionId/change-plan` | Change plan           |
| POST   | `/subscriptions/:subscriptionId/cancel`      | Cancel                |
| GET    | `/subscriptions/:subscriptionId/invoices`    | Retrieve invoices     |

Subscription state transitions MUST be controlled by the SaaS/billing domain.

---

# 47. Billing API

Base:

```text
/api/v1/billing
```

Representative operations:

| Method | Endpoint                           | Purpose                 |
| ------ | ---------------------------------- | ----------------------- |
| GET    | `/billing/invoices`                | List invoices           |
| GET    | `/billing/invoices/:invoiceId`     | Retrieve invoice        |
| POST   | `/billing/invoices/:invoiceId/pay` | Pay invoice             |
| GET    | `/billing/usage`                   | Retrieve usage          |
| GET    | `/billing/ledger`                  | Retrieve billing ledger |

Billing financial effects MUST integrate with the financial ledger rather than maintaining an independent balance model.

---

# 48. Notifications API

Base:

```text
/api/v1/notifications
```

Representative operations:

| Method | Endpoint                              | Purpose               |
| ------ | ------------------------------------- | --------------------- |
| GET    | `/notifications`                      | List notifications    |
| GET    | `/notifications/:notificationId`      | Retrieve notification |
| POST   | `/notifications/:notificationId/read` | Mark read             |
| POST   | `/notifications/read-all`             | Mark all read         |
| GET    | `/notifications/preferences`          | Retrieve preferences  |
| PATCH  | `/notifications/preferences`          | Update preferences    |

Sensitive notification payloads MUST avoid exposing unnecessary financial or authentication information.

---

# 49. Audit API

Base:

```text
/api/v1/audit
```

Audit data is append-oriented.

Representative operations:

| Method | Endpoint                                     | Purpose                        |
| ------ | -------------------------------------------- | ------------------------------ |
| GET    | `/audit/events`                              | Search authorized audit events |
| GET    | `/audit/events/:eventId`                     | Retrieve event                 |
| GET    | `/audit/actors/:actorId`                     | Retrieve actor activity        |
| GET    | `/audit/resources/:resourceType/:resourceId` | Retrieve resource history      |

There MUST NOT be a public endpoint for editing or deleting audit events.

---

# 50. Reporting API

Base:

```text
/api/v1/reports
```

Representative operations:

| Method | Endpoint                  | Purpose                  |
| ------ | ------------------------- | ------------------------ |
| GET    | `/reports/financial`      | Financial reporting      |
| GET    | `/reports/loans`          | Loan reporting           |
| GET    | `/reports/savings`        | Savings reporting        |
| GET    | `/reports/payments`       | Payment reporting        |
| GET    | `/reports/reconciliation` | Reconciliation reporting |
| GET    | `/reports/compliance`     | Compliance reporting     |
| GET    | `/reports/executive`      | Executive reporting      |

Reports MUST use authoritative domain data.

Financial reports MUST reconcile with the ledger.

---

# 51. Administrative API

Administrative operations SHALL be isolated from ordinary user operations.

Base:

```text
/api/v1/admin
```

Representative areas:

```text
/admin/users
/admin/tenants
/admin/configuration
/admin/providers
/admin/audit
/admin/ledger
/admin/compliance
/admin/jobs
```

Administrative authorization MUST use explicit privileged permissions.

---

# 52. Health and Operational APIs

Operational endpoints are separate from business APIs.

Recommended:

```text
/health
/health/live
/health/ready
/health/startup
```

These endpoints SHOULD NOT require ordinary application authentication where infrastructure orchestration requires unauthenticated probes.

They MUST NOT expose secrets or sensitive internal configuration.

---

# 53. Metrics and Observability

Metrics endpoints SHOULD be isolated from public business APIs.

Where Prometheus is used:

```text
/metrics
```

Access MUST be restricted to trusted infrastructure.

The API platform SHOULD emit:

```text
http_request_total
http_request_duration_seconds
http_request_errors_total
http_rate_limit_total
http_authentication_failures_total
http_authorization_failures_total
http_idempotency_conflicts_total
http_webhook_total
```

Financial services SHOULD additionally emit domain-specific metrics.

---

# 54. Asynchronous Operations

Long-running commands SHOULD return:

```http
202 Accepted
```

with an operation reference.

Example:

```json
{
  "success": true,
  "data": {
    "operation_id": "op_01J..."
  },
  "meta": {
    "request_id": "req_01J...",
    "correlation_id": "cor_01J..."
  }
}
```

Operation status:

```http
GET /api/v1/operations/:operationId
```

---

# 55. Event-Driven API Integration

The API layer MAY publish domain events through the transactional outbox.

Example:

```text
POST /payments
      ↓
Payment Service
      ↓
Ledger / Transaction
      ↓
Outbox
      ↓
Event Publisher
      ↓
Subscribers
```

The API MUST NOT assume that event publication and HTTP response delivery are inherently atomic.

The outbox pattern SHOULD be used for reliable event publication.

---

# 56. Event Correlation

Every API-originated domain command SHOULD carry:

```text
event_id
correlation_id
causation_id
tenant_id
actor_id
request_id
trace_id
```

Example:

```json
{
  "event_id": "evt_01J...",
  "event_type": "payment.completed",
  "tenant_id": "tenant_01J...",
  "correlation_id": "cor_01J...",
  "causation_id": "cmd_01J...",
  "actor_id": "user_01J..."
}
```

---

# 57. API-to-Service Mapping

The API layer MUST map to existing domain services rather than duplicating domain logic.

| API Domain     | Primary Domain Layer         |
| -------------- | ---------------------------- |
| Authentication | Auth services/controllers    |
| Users          | User module                  |
| Tenants        | SaaS/Tenant module           |
| Onboarding     | Onboarding workflow/services |
| KYC            | Compliance/KYC services      |
| AML            | Compliance/AML services      |
| Loans          | Loan services                |
| Risk           | Risk/scoring services        |
| Savings        | Finance/Savings services     |
| Payments       | Payment orchestration        |
| MTN            | MTN provider adapter         |
| Airtel         | Airtel provider adapter      |
| Ledger         | Finance ledger engine        |
| Statements     | Statement processing         |
| Reconciliation | Reconciliation services      |
| Settlement     | Settlement services          |
| Billing        | SaaS/Billing services        |
| Notifications  | Notification services        |
| Audit          | Audit subsystem              |
| Reporting      | Reporting services           |

---

# 58. API Dependency Direction

The API layer SHALL depend inward on application/domain services.

Preferred:

```text
Routes
  ↓
Controllers
  ↓
Application Services
  ↓
Domain Services
  ↓
Repositories / Infrastructure
```

Avoid:

```text
Controller
  ↓
MongoDB Model
  ↓
Manual financial calculation
```

Avoid:

```text
Route
  ↓
Provider SDK
  ↓
Direct balance mutation
```

---

# 59. API Security Boundaries

The following boundaries MUST remain explicit.

```text
HTTP Boundary
    │
    ├── Authentication
    ├── Authorization
    ├── Validation
    ├── Rate Limiting
    ├── Idempotency
    │
    ▼
Application Boundary
    │
    ├── Business Rules
    ├── Workflow
    ├── Transaction State
    │
    ▼
Financial Boundary
    │
    ├── Ledger
    ├── Journal
    ├── Posting
    ├── Reversal
    └── Reconciliation
```

No boundary may be bypassed for convenience.

---

# 60. Sensitive API Operations

The following operations require elevated controls:

* login
* credential changes
* account recovery
* KYC approval
* AML decisions
* loan approval
* loan disbursement
* repayment
* withdrawal
* payment initiation
* refund
* reversal
* ledger adjustment
* settlement
* regulatory submission
* tenant administration
* role/permission changes

These operations SHOULD require:

```text
authentication
+
authorization
+
audit
+
idempotency where applicable
+
correlation
+
enhanced monitoring
```

---

# 61. API Audit Requirements

The API SHALL produce audit records for security-sensitive and business-sensitive actions.

Minimum audit context:

```text
event_id
timestamp
tenant_id
actor_id
actor_type
action
resource_type
resource_id
request_id
correlation_id
trace_id
outcome
reason
source
```

Audit records MUST NOT contain plaintext credentials or secrets.

---

# 62. Logging Requirements

HTTP logs SHOULD contain:

```text
timestamp
request_id
correlation_id
trace_id
tenant_id
actor_id
method
route
status
duration_ms
user_agent
client_id
```

Logs SHOULD record route templates rather than raw URLs when raw paths could contain sensitive identifiers.

Request/response bodies MUST NOT be logged by default for financial or credential-bearing endpoints.

---

# 63. API Timeout Policy

Every outbound operation MUST have a bounded timeout.

This includes:

* database operations
* provider APIs
* internal HTTP calls
* callback processing
* external compliance services

An API request MUST NOT remain indefinitely open because an upstream provider is unavailable.

---

# 64. Retry Policy

Retries MUST be limited to operations known to be safe.

Safe retry candidates generally include:

* idempotent reads
* explicitly idempotent commands
* transient infrastructure failures

Retries MUST NOT blindly repeat financial effects.

The preferred pattern is:

```text
Idempotency
+
Bounded Retry
+
Backoff
+
Circuit Breaker
```

---

# 65. Provider Failure Semantics

Provider failures SHOULD be normalized.

Example:

```json
{
  "success": false,
  "error": {
    "code": "PAYMENT_PROVIDER_UNAVAILABLE",
    "message": "The payment provider is temporarily unavailable.",
    "retryable": true
  }
}
```

Internal provider errors MUST NOT leak raw provider credentials, stack traces, or implementation details.

---

# 66. API Consistency Rules

Across all domains:

1. Use consistent resource naming.
2. Use plural nouns for collections.
3. Use action endpoints for explicit commands.
4. Never encode business state changes through arbitrary PATCH operations.
5. Use stable identifiers.
6. Use machine-readable error codes.
7. Include request/correlation metadata.
8. Enforce tenant scope.
9. Enforce authorization.
10. Use idempotency for financial commands.
11. Audit sensitive actions.
12. Preserve financial immutability.

---

# 67. Naming Convention

Preferred:

```text
/loans
/loans/:loanId
/loans/:loanId/repayments
```

Avoid:

```text
/getLoans
/createLoan
/doRepayment
```

Explicit state transitions MAY use verbs:

```text
/loans/:loanId/disburse
/loans/:loanId/restructure
/transactions/:transactionId/reverse
```

These are commands, not ordinary CRUD updates.

---

# 68. Query Parameter Standards

Common parameters:

```text
page
page_size
cursor
limit
sort
status
from
to
created_from
created_to
search
```

Date/time values SHOULD use ISO 8601.

Example:

```text
2026-08-15T19:00:00Z
```

Server-side timezone handling MUST be deterministic.

---

# 69. Resource Identifier Rules

Public identifiers SHOULD be opaque.

Avoid exposing sequential database IDs where enumeration could create security or privacy concerns.

Example:

```text
loan_01J...
txn_01J...
payment_01J...
tenant_01J...
```

Identifiers MUST NOT themselves contain secrets or sensitive information.

---

# 70. API Documentation Standard

Every production endpoint SHALL be represented in the API specification with:

```text
operationId
summary
description
tags
parameters
requestBody
responses
security
tenantScope
idempotency
audit
errors
```

OpenAPI SHOULD be the machine-readable contract.

The Markdown API catalogue remains the human-readable architecture/governance catalogue.

---

# 71. OpenAPI Governance

The canonical machine-readable API definition SHOULD be maintained alongside the implementation.

Recommended location:

```text
docs/api/openapi.yaml
```

The OpenAPI document MUST NOT become a disconnected duplicate.

CI SHOULD validate:

```text
Routes ↔ OpenAPI
Schemas ↔ OpenAPI
Authentication ↔ OpenAPI
Responses ↔ OpenAPI
```

---

# 72. API Contract Testing

Production API contracts SHOULD be protected by:

### Unit tests

Validate:

* request validation
* controller behavior
* error mapping
* authorization logic

### Integration tests

Validate:

* authentication
* tenant isolation
* database behavior
* domain integration
* idempotency

### Contract tests

Validate:

* OpenAPI compatibility
* response schemas
* request schemas
* status codes

### End-to-end tests

Validate:

```text
Client
 ↓
HTTP
 ↓
Auth
 ↓
Domain
 ↓
Ledger / Provider
 ↓
Response
```

---

# 73. Financial API Integration Test Requirements

Financial command tests MUST verify:

```text
one request
    ↓
one financial effect
```

and:

```text
same idempotency key
    ↓
no duplicate financial effect
```

and:

```text
reversal
    ↓
new compensating financial entries
    ↓
original entry remains immutable
```

and:

```text
successful transaction
    ↓
balanced ledger posting
```

---

# 74. Tenant Isolation Test Requirements

Automated tests MUST verify:

```text
Tenant A user
    ↓
Tenant B resource
    ↓
DENIED
```

Tests SHOULD cover:

* GET
* POST
* PATCH
* DELETE
* search
* pagination
* nested resources
* report endpoints
* exports
* callbacks
* administrative endpoints

---

# 75. API Rate-Limit Test Requirements

Tests SHOULD verify:

* limit enforcement
* authenticated limits
* anonymous limits
* tenant limits
* sensitive-operation limits
* Retry-After behavior
* distributed Redis-backed behavior
* fallback behavior where applicable

---

# 76. API Observability Requirements

Every production request SHOULD be traceable through:

```text
request_id
      ↓
correlation_id
      ↓
trace_id
      ↓
service operation
      ↓
database / provider call
      ↓
ledger operation
      ↓
event
```

A production incident MUST be diagnosable from the request ID/correlation ID without requiring database guesswork.

---

# 77. API Reliability Model

The API platform SHALL support:

```text
Timeouts
Retries
Circuit Breakers
Idempotency
Dead-Letter Handling
Outbox
Graceful Shutdown
Rate Limiting
Backpressure
```

These mechanisms must be applied according to operation semantics rather than indiscriminately.

---

# 78. API Availability Classes

| Class          | Examples                   | Availability Expectation      |
| -------------- | -------------------------- | ----------------------------- |
| Critical       | Auth, payments, ledger     | Highest                       |
| Financial      | Loans, savings, settlement | Very High                     |
| Compliance     | KYC, AML, regulatory       | High                          |
| Operational    | Statements, reports        | High                          |
| Administrative | Configuration              | Controlled                    |
| Analytical     | Dashboards                 | Degraded operation acceptable |

Critical APIs MUST have explicit failure behavior.

---

# 79. API Data Export

Exports SHOULD be asynchronous for large datasets.

Preferred flow:

```text
POST /api/v1/reports/export
        ↓
202 Accepted
        ↓
operation_id
        ↓
background processing
        ↓
GET /api/v1/operations/:operationId
        ↓
download/reference
```

Exports MUST enforce tenant authorization.

---

# 80. API Security for Downloads

Download endpoints MUST verify:

* authenticated actor
* tenant scope
* resource ownership/permission
* export authorization
* expiration
* audit requirements

Temporary download references SHOULD expire.

---

# 81. API Deprecation

Deprecated endpoints MUST be explicitly marked.

Recommended headers:

```http
Deprecation: true
Sunset: <date>
```

Clients SHOULD receive migration guidance.

An endpoint MUST NOT be silently removed.

---

# 82. Backward Compatibility

Changes to production APIs MUST be classified as:

```text
PATCH
MINOR
MAJOR
```

Breaking changes require:

* impact assessment
* migration plan
* documentation
* client communication
* compatibility window
* sunset date where appropriate

---

# 83. API Change Control

Any API change affecting financial behavior requires review from the relevant domain owner.

Changes affecting:

```text
Ledger
Transactions
Payments
Settlement
Loans
Compliance
Tenant isolation
Authentication
Authorization
```

require security/architecture review before production release.

---

# 84. API Ownership Model

Every endpoint SHALL have:

```text
Domain Owner
Service Owner
Security Owner
Operational Owner
```

Example:

```text
POST /api/v1/payments
Domain Owner: Payments
Service Owner: Payment Orchestration
Security Owner: Platform Security
Operational Owner: Platform Engineering
```

---

# 85. API Catalogue Status

The following statuses SHALL be used:

| Status           | Meaning                                    |
| ---------------- | ------------------------------------------ |
| `PROPOSED`       | Designed but not implemented               |
| `IN_DEVELOPMENT` | Implementation underway                    |
| `IMPLEMENTED`    | Code exists                                |
| `INTEGRATED`     | Integrated with dependent services         |
| `TESTED`         | Automated integration/contract tests exist |
| `GA`             | Production approved                        |
| `DEPRECATED`     | Still available but scheduled for removal  |
| `SUNSET`         | Removed from production                    |

The catalogue MUST NOT label an endpoint `GA` merely because a route exists.

---

# 86. Endpoint Readiness Gates

A production endpoint should progress through:

```text
DESIGN
  ↓
IMPLEMENTATION
  ↓
VALIDATION
  ↓
AUTHORIZATION
  ↓
TENANT ISOLATION
  ↓
IDEMPOTENCY
  ↓
AUDIT
  ↓
OBSERVABILITY
  ↓
TESTING
  ↓
SECURITY REVIEW
  ↓
OPERATIONAL REVIEW
  ↓
GA
```

Financial endpoints require additional ledger verification.

---

# 87. Production Readiness Checklist

For every production endpoint:

* [ ] OpenAPI definition exists.
* [ ] Request schema exists.
* [ ] Response schema exists.
* [ ] Authentication requirement documented.
* [ ] Authorization requirement documented.
* [ ] Tenant scope documented.
* [ ] Validation implemented.
* [ ] Rate limiting assessed.
* [ ] Idempotency assessed.
* [ ] Audit requirements implemented.
* [ ] Correlation ID propagated.
* [ ] Trace context propagated.
* [ ] Errors use stable codes.
* [ ] Sensitive fields are redacted.
* [ ] Timeouts configured.
* [ ] Retry behavior documented.
* [ ] Integration tests exist.
* [ ] Contract tests exist.
* [ ] Security tests exist.
* [ ] Operational metrics exist.
* [ ] Logging is structured.
* [ ] Documentation is current.
* [ ] Owner is assigned.
* [ ] Production status is explicitly approved.

---

# 88. Financial Endpoint Readiness Checklist

For every financial command:

* [ ] Idempotency key required.
* [ ] Transaction correlation exists.
* [ ] Ledger service is the accounting authority.
* [ ] Double-entry validation exists.
* [ ] No direct balance mutation occurs.
* [ ] Transaction state machine is enforced.
* [ ] Reversal semantics are defined.
* [ ] Audit event is generated.
* [ ] Duplicate request behavior is tested.
* [ ] Concurrent request behavior is tested.
* [ ] Provider timeout behavior is tested where applicable.
* [ ] Provider retry behavior is tested where applicable.
* [ ] Reconciliation behavior is defined.
* [ ] Financial period rules are respected.
* [ ] Authorization is verified.
* [ ] Tenant isolation is verified.

---

# 89. Callback Readiness Checklist

For every provider callback:

* [ ] Provider identified.
* [ ] Signature verification implemented.
* [ ] Timestamp/replay protection implemented where supported.
* [ ] Payload schema validation implemented.
* [ ] Callback normalization implemented.
* [ ] Idempotency implemented.
* [ ] Provider transaction correlation implemented.
* [ ] Duplicate callbacks tested.
* [ ] Out-of-order callbacks tested.
* [ ] Invalid signatures tested.
* [ ] Unknown transaction behavior defined.
* [ ] Audit event generated.
* [ ] Trace/correlation propagated.
* [ ] Financial posting passes through ledger.
* [ ] Provider credentials are not exposed.

---

# 90. API Catalogue Matrix

| Domain         | Base Path         | Primary Responsibility  | Financial Impact | Tenant Scoped     | Idempotency      |
| -------------- | ----------------- | ----------------------- | ---------------- | ----------------- | ---------------- |
| Auth           | `/auth`           | Authentication/session  | No               | Context dependent | Selected         |
| Users          | `/users`          | User management         | No               | Yes               | Selected         |
| Tenants        | `/tenants`        | Tenant administration   | Indirect         | Yes               | Selected         |
| Onboarding     | `/onboarding`     | Tenant onboarding       | Indirect         | Yes               | Yes for commands |
| KYC            | `/kyc`            | Identity verification   | No               | Yes               | Commands         |
| Compliance     | `/compliance`     | Regulatory controls     | Indirect         | Yes               | Commands         |
| Accounts       | `/accounts`       | Financial accounts      | Yes              | Yes               | Commands         |
| Ledger         | `/ledger`         | Accounting              | Yes              | Yes               | Required         |
| Transactions   | `/transactions`   | Financial lifecycle     | Yes              | Yes               | Required         |
| Payments       | `/payments`       | Payment orchestration   | Yes              | Yes               | Required         |
| Loans          | `/loans`          | Credit lifecycle        | Yes              | Yes               | Required         |
| Risk           | `/risk`           | Risk evaluation         | Indirect         | Yes               | Required         |
| Savings        | `/savings`        | Savings operations      | Yes              | Yes               | Required         |
| Statements     | `/statements`     | Statement processing    | Yes/Indirect     | Yes               | Commands         |
| Reconciliation | `/reconciliation` | Financial matching      | Yes              | Yes               | Commands         |
| Settlement     | `/settlements`    | Provider settlement     | Yes              | Yes               | Required         |
| Subscriptions  | `/subscriptions`  | SaaS plans              | Financial        | Yes               | Commands         |
| Billing        | `/billing`        | Tenant billing          | Financial        | Yes               | Required         |
| Notifications  | `/notifications`  | Communication           | No               | Yes               | Selected         |
| Audit          | `/audit`          | Audit history           | No               | Yes               | N/A              |
| Reports        | `/reports`        | Reporting               | Read-only        | Yes               | N/A              |
| Admin          | `/admin`          | Platform administration | Potentially      | Restricted        | Selected         |
| Webhooks       | `/webhooks`       | Provider callbacks      | Yes              | Provider-scoped   | Required         |

---

# 91. Forbidden API Patterns

The following patterns are prohibited.

## 91.1 Direct financial mutation

```text
PATCH /accounts/:id
{
  "balance": 100000
}
```

## 91.2 Posted ledger modification

```text
PATCH /ledger/entries/:id
```

for changing historical accounting facts.

## 91.3 Client-controlled tenant authority

```json
{
  "tenant_id": "another-tenant"
}
```

without authorization verification.

## 91.4 Provider credential submission

Clients MUST NOT submit:

```text
provider_client_secret
provider_access_token
provider_private_key
```

through ordinary payment APIs.

## 91.5 Silent transaction retries

A payment command MUST NOT be automatically retried without idempotency protection.

## 91.6 Arbitrary state mutation

Avoid:

```http
PATCH /loans/:id
```

with:

```json
{
  "status": "DISBURSED"
}
```

Use a controlled command:

```http
POST /loans/:id/disburse
```

---

# 92. API Boundary Invariants

The following invariants are mandatory:

### Invariant 1 — Authentication

No protected operation executes without valid authentication.

### Invariant 2 — Authorization

Authentication alone does not grant resource access.

### Invariant 3 — Tenant isolation

A tenant-scoped request can only access authorized tenant resources.

### Invariant 4 — Financial integrity

No API endpoint bypasses the ledger for financial posting.

### Invariant 5 — Idempotency

Retrying an idempotent financial command cannot create duplicate financial effects.

### Invariant 6 — Immutability

Posted financial records are not edited.

### Invariant 7 — Auditability

Sensitive operations are traceable.

### Invariant 8 — Observability

Production operations are correlated and traceable.

### Invariant 9 — Error safety

Internal implementation details are not exposed through API errors.

### Invariant 10 — Contract stability

Production API changes follow versioning and compatibility governance.

---

# 93. API Request Lifecycle

The canonical request lifecycle is:

```text
1. TLS termination
       ↓
2. Request ID generation
       ↓
3. Correlation ID resolution
       ↓
4. Trace context extraction
       ↓
5. Rate-limit evaluation
       ↓
6. Body/query/path validation
       ↓
7. Authentication
       ↓
8. Tenant resolution
       ↓
9. Authorization
       ↓
10. Idempotency evaluation
       ↓
11. Controller
       ↓
12. Domain service
       ↓
13. Persistence / Ledger / Provider
       ↓
14. Audit
       ↓
15. Event / Outbox
       ↓
16. Response mapping
       ↓
17. Structured logging / metrics
```

Security-critical steps MUST occur before the protected business operation executes.

---

# 94. Financial Command Lifecycle

For financial commands:

```text
HTTP Request
    ↓
Authentication
    ↓
Tenant Authorization
    ↓
Validation
    ↓
Idempotency Lock
    ↓
Transaction Context
    ↓
Domain Validation
    ↓
Financial Operation
    ↓
Ledger Posting
    ↓
Transaction State Update
    ↓
Audit
    ↓
Outbox Event
    ↓
Commit
    ↓
Response
```

Where the persistence architecture supports atomic transactions, financial state and required transactional metadata SHOULD commit atomically.

---

# 95. API and Event Relationship

An API response does not replace a domain event.

For example:

```text
POST /payments
```

may return:

```json
{
  "success": true,
  "data": {
    "payment_id": "payment_01J...",
    "status": "PROCESSING"
  }
}
```

while the domain subsequently produces:

```text
payment.initiated
payment.processing
payment.completed
```

The client MUST NOT assume that an asynchronous command has completed merely because the HTTP request was accepted.

---

# 96. API and Ledger Relationship

The API catalogue establishes the following rule:

```text
API
 ↓
Application Service
 ↓
Financial Domain Service
 ↓
Ledger Engine
```

The API is never the authoritative source of:

* account balance
* ledger balance
* available balance
* transaction posting
* journal state
* settlement accounting

Those belong to the financial core.

---

# 97. API and Reconciliation Relationship

Reconciliation endpoints expose the results of reconciliation services.

They MUST NOT independently calculate authoritative financial balances.

The relationship is:

```text
Statement
    ↓
Statement Processing
    ↓
Normalization
    ↓
Validation
    ↓
Reconciliation
    ↓
Exception / Repair
    ↓
Ledger Adjustment where authorized
```

---

# 98. API and Compliance Relationship

Compliance APIs SHALL preserve:

```text
case
decision
actor
timestamp
reason
evidence/reference
tenant
correlation
audit
```

Compliance decisions MUST be traceable to the actor and workflow responsible for them.

---

# 99. API and SaaS Relationship

Tenant subscription APIs SHALL distinguish:

```text
Plan
Subscription
Usage
Invoice
Payment
Entitlement
```

The API MUST NOT infer subscription entitlement from arbitrary client-side state.

Entitlements SHOULD be resolved through the SaaS platform's authoritative subscription/billing services.

---

# 100. API Governance Rules

The API catalogue is governed by these rules:

1. Every production endpoint must have an owner.
2. Every endpoint must have an explicit tenant scope.
3. Every sensitive endpoint must have an explicit authorization policy.
4. Every financial command must define idempotency behavior.
5. Every financial mutation must use the ledger.
6. Every state-changing command must respect its state machine.
7. Every provider callback must be authenticated and replay-protected.
8. Every production endpoint must have observability.
9. Every API contract must be tested.
10. Breaking changes require version governance.
11. Deprecated endpoints require a documented sunset.
12. API documentation must remain synchronized with implementation.

---

# 101. API Catalogue Maintenance

This document SHALL be updated whenever any of the following changes:

* new public endpoint
* endpoint removal
* endpoint version change
* authentication change
* authorization change
* tenant model change
* financial command change
* transaction state change
* provider integration change
* webhook change
* error contract change
* idempotency behavior change
* response contract change

API changes MUST NOT be considered complete until this catalogue and the machine-readable API specification are updated.

---

# 102. Definition of Done

An API feature is complete only when:

```text
Code
 +
Validation
 +
Authorization
 +
Tenant Isolation
 +
Idempotency
 +
Audit
 +
Observability
 +
Error Contract
 +
Tests
 +
OpenAPI
 +
API Catalogue
 +
Operational Readiness
```

are complete.

For financial features:

```text
Code
 +
Validation
 +
Authorization
 +
Tenant Isolation
 +
Idempotency
 +
Transaction State Machine
 +
Ledger Integration
 +
Double-Entry Validation
 +
Reversal Semantics
 +
Audit
 +
Observability
 +
Reconciliation
 +
Tests
 +
OpenAPI
 +
API Catalogue
```

are required.

---

# 103. Production API Exit Criteria

The TITech API platform SHALL be considered production-ready when:

* [ ] API versioning is enforced.
* [ ] Authentication is centralized.
* [ ] Authorization is centralized and policy-driven.
* [ ] Tenant isolation is enforced at every tenant-scoped boundary.
* [ ] Financial operations cannot bypass the ledger.
* [ ] Financial commands have deterministic idempotency.
* [ ] Provider callbacks have signature/replay protection.
* [ ] Stable error contracts are implemented.
* [ ] Request and correlation IDs propagate end-to-end.
* [ ] OpenTelemetry tracing is available.
* [ ] Structured logging is implemented.
* [ ] Metrics are available.
* [ ] Rate limiting is operational.
* [ ] Request timeouts are enforced.
* [ ] Graceful shutdown is implemented.
* [ ] API contracts are covered by automated tests.
* [ ] OpenAPI documentation is synchronized.
* [ ] API catalogue is synchronized.
* [ ] Security review is complete.
* [ ] Financial integrity tests are passing.
* [ ] Tenant isolation tests are passing.
* [ ] Provider callback tests are passing.
* [ ] Reconciliation behavior is verified.
* [ ] Production incident diagnostics are possible using request/correlation IDs.
* [ ] Endpoint ownership is assigned.
* [ ] Deprecated API lifecycle is governed.

---

# 104. Authoritative API Architecture

The final production API architecture is:

```text
                         ┌───────────────────────┐
                         │       Clients         │
                         └───────────┬───────────┘
                                     │
                                     ▼
                         ┌───────────────────────┐
                         │     API Gateway       │
                         │ TLS / CORS / Limits   │
                         └───────────┬───────────┘
                                     │
                                     ▼
                         ┌───────────────────────┐
                         │   Request Context     │
                         │ Request / Correlation │
                         │ Trace / Tenant / Actor│
                         └───────────┬───────────┘
                                     │
                                     ▼
                         ┌───────────────────────┐
                         │ AuthN / AuthZ / RBAC  │
                         └───────────┬───────────┘
                                     │
                                     ▼
                         ┌───────────────────────┐
                         │ Validation / Idempot. │
                         └───────────┬───────────┘
                                     │
                                     ▼
                         ┌───────────────────────┐
                         │     Controllers       │
                         └───────────┬───────────┘
                                     │
             ┌───────────────────────┼───────────────────────┐
             │                       │                       │
             ▼                       ▼                       ▼
      ┌─────────────┐         ┌─────────────┐         ┌─────────────┐
      │ Finance     │         │ Payments    │         │ Loans       │
      │ / Ledger    │         │ / Providers │         │ / Risk      │
      └──────┬──────┘         └──────┬──────┘         └──────┬──────┘
             │                       │                       │
             └───────────────────────┼───────────────────────┘
                                     │
                                     ▼
                         ┌───────────────────────┐
                         │ Persistence / Outbox  │
                         └───────────┬───────────┘
                                     │
                    ┌────────────────┴────────────────┐
                    ▼                                 ▼
          ┌──────────────────┐              ┌──────────────────┐
          │ Ledger / Audit   │              │ Events / Queues  │
          └──────────────────┘              └──────────────────┘
```

---

# 105. Final Architectural Rule

The TITech API is a **controlled application boundary**, not a second business-logic layer.

The governing principle is:

```text
External Request
      ↓
Secure API Boundary
      ↓
Authorized Application Command
      ↓
Domain Service
      ↓
Authoritative Financial / Business State
      ↓
Audit + Events + Observability
      ↓
Deterministic API Response
```

For financial operations:

```text
NO API
  ↓
DIRECT BALANCE MUTATION

NO API
  ↓
DIRECT POSTED LEDGER EDIT

NO API
  ↓
UNPROTECTED FINANCIAL RETRY

NO API
  ↓
UNAUTHORIZED CROSS-TENANT ACCESS

NO API
  ↓
UNVERIFIED PROVIDER CALLBACK
```

The API catalogue therefore serves as the governing contract between **clients, API infrastructure, application services, financial core, payment rails, compliance services, SaaS services, and operational infrastructure** while preserving the existing TITech architecture and enforcing enterprise production-system controls.