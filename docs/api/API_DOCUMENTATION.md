# TITech Community Capital Ltd

# API Documentation

**Document:** `docs/api/API_DOCUMENTATION.md`
**Status:** Enterprise Production Baseline
**API Version:** `v1`
**Base Path:** `/api/v1`
**Owner:** TITech Community Capital Engineering
**Classification:** Internal Engineering / API Consumer Reference
**Last Updated:** 2026-08-15

---

## 1. Overview

This document provides the implementation-facing API reference for the TITech Community Capital platform.

It complements:

* `docs/api/API_CATALOGUE.md` — API architecture, governance, ownership, lifecycle, and endpoint catalogue.
* `docs/api/openapi.yaml` — machine-readable API contract, where present.
* `docs/02-architecture/SERVICE_CATALOGUE.md` — service ownership and responsibilities.
* `docs/02-architecture/DEPENDENCY_MAP.md` — service and module dependencies.
* `docs/02-architecture/EVENT_CATALOGUE.md` — domain and integration events.
* `docs/data/DATA_MODEL_CATALOGUE.md` — authoritative data model catalogue.

This document describes how clients interact with the platform and establishes the production API conventions that all new endpoints must follow.

---

# 2. API Architecture

The API is a controlled application boundary.

```text
Client
  │
  ▼
API Gateway / Express
  │
  ├── TLS / CORS / Security Headers
  ├── Request ID
  ├── Correlation ID
  ├── Rate Limiting
  ├── Request Size Limits
  └── Timeout Protection
  │
  ▼
Authentication
  │
  ▼
Tenant Resolution
  │
  ▼
Authorization
  │
  ▼
Validation
  │
  ▼
Idempotency
  │
  ▼
Controller
  │
  ▼
Application / Domain Service
  │
  ├── Finance
  ├── Loans
  ├── Payments
  ├── Compliance
  ├── Onboarding
  ├── SaaS / Billing
  └── Statements / Reconciliation
  │
  ▼
Persistence / Ledger / Provider
  │
  ▼
Audit + Outbox + Events + Observability
```

Controllers MUST NOT become a second business-logic layer.

---

# 3. Base URLs

## 3.1 Local Development

```text
http://localhost:5000/api/v1
```

The current local development server may expose the legacy `/api` base path depending on the running route configuration.

For new API development, `/api/v1` is the canonical production contract.

## 3.2 Production

The production hostname is environment-specific and MUST be configured through deployment configuration.

Canonical structure:

```text
https://<api-host>/api/v1
```

Clients MUST NOT hard-code production hostnames.

---

# 4. API Versioning

Current API version:

```text
v1
```

Canonical example:

```http
POST /api/v1/auth/login
```

Versioning rules:

* Breaking changes require a new major API version.
* Non-breaking additions MAY remain in `v1`.
* Deprecated endpoints MUST have a documented migration path.
* API clients SHOULD explicitly target a supported version.
* Financial contract changes require architecture review.

---

# 5. Transport Security

Production APIs MUST use HTTPS.

HTTP is acceptable only for controlled local development environments.

Production clients MUST NOT transmit:

* passwords
* JWTs
* refresh tokens
* payment credentials
* provider credentials
* sensitive KYC information

over unencrypted HTTP.

---

# 6. Authentication

## 6.1 Access Token

Protected endpoints require an authenticated access token.

Legacy-compatible header:

```http
x-auth-token: <jwt-token>
```

Example:

```http
GET /api/v1/auth/me
x-auth-token: eyJhbGciOiJIUzI1NiIs...
```

The platform SHOULD progressively standardize on:

```http
Authorization: Bearer <access-token>
```

for new integrations.

Existing clients using `x-auth-token` MUST NOT be broken without an explicit migration plan.

---

# 7. Authentication Model

The recommended authentication lifecycle is:

```text
Login
  ↓
Access Token
  ↓
Protected API Calls
  ↓
Access Token Expiry
  ↓
Refresh Token
  ↓
Rotated Access Token
  ↓
Continue
```

Refresh tokens SHOULD be:

* securely stored
* rotated
* revocable
* protected against replay
* associated with a session/device context

---

# 8. Standard Headers

Clients SHOULD provide:

```http
Content-Type: application/json
Accept: application/json
X-Request-ID: <request-id>
X-Correlation-ID: <correlation-id>
```

Authenticated requests additionally provide:

```http
Authorization: Bearer <access-token>
```

or, for legacy compatibility:

```http
x-auth-token: <jwt-token>
```

Financial commands additionally require:

```http
Idempotency-Key: <unique-key>
```

---

# 9. Request ID

The API assigns a unique request identifier to every HTTP request.

Example:

```http
X-Request-ID: req_01J...
```

If a valid trusted request ID is supplied, the server MAY preserve it.

Otherwise, the server generates one.

The request ID MUST appear in:

* structured logs
* API errors
* relevant audit records
* distributed traces

---

# 10. Correlation ID

Clients MAY provide:

```http
X-Correlation-ID: cor_01J...
```

If absent, the API SHOULD generate one.

Correlation IDs MUST propagate across:

* internal service calls
* payment operations
* callbacks
* asynchronous jobs
* ledger operations
* events
* audit records

---

# 11. Tenant Context

TITech is a multi-tenant platform.

Protected tenant-scoped requests are authorized against the authenticated actor's tenant membership.

Clients MUST NOT treat:

```json
{
  "tenantId": "tenant_x"
}
```

as proof of authorization.

The server remains the authoritative source of tenant access.

---

# 12. Tenant Isolation

Every tenant-scoped operation MUST enforce:

```text
Authenticated Actor
        ↓
Authorized Tenant Membership
        ↓
Resource Authorization
        ↓
Operation
```

A user from Tenant A MUST NOT be able to:

* retrieve Tenant B records
* modify Tenant B records
* enumerate Tenant B resources
* infer Tenant B data through unauthorized queries
* bypass tenant restrictions by changing request parameters

---

# 13. Standard Success Response

New endpoints SHOULD use:

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

Existing endpoints may continue returning their established response structures until explicitly migrated.

Backward compatibility MUST be considered before changing an existing response contract.

---

# 14. Standard Collection Response

```json
{
  "success": true,
  "data": [],
  "meta": {
    "request_id": "req_01J...",
    "correlation_id": "cor_01J...",
    "pagination": {
      "page": 1,
      "page_size": 20,
      "total": 100,
      "pages": 5,
      "has_next": true,
      "has_previous": false
    }
  }
}
```

Legacy endpoints may currently use:

```json
{
  "message": "Groups retrieved successfully",
  "data": [],
  "pagination": {
    "total": 1,
    "page": 1,
    "limit": 10,
    "pages": 1
  }
}
```

Both formats may coexist during API evolution.

---

# 15. Standard Error Response

The production error contract SHOULD be:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Validation failed",
    "details": [],
    "retryable": false
  },
  "meta": {
    "request_id": "req_01J...",
    "correlation_id": "cor_01J..."
  }
}
```

Legacy-compatible responses may currently contain:

```json
{
  "message": "Invalid credentials"
}
```

Existing client contracts MUST be preserved until migration is approved.

---

# 16. Error Information Security

Production responses MUST NOT expose:

* stack traces
* database connection strings
* JWT signing secrets
* refresh tokens
* provider credentials
* API keys
* internal file paths
* raw MongoDB errors
* internal service topology
* sensitive personal information

Detailed diagnostic information belongs in controlled server-side logs.

---

# 17. HTTP Status Codes

| Status | Meaning                                    |
| -----: | ------------------------------------------ |
|  `200` | Successful operation                       |
|  `201` | Resource created                           |
|  `202` | Accepted for asynchronous processing       |
|  `204` | Successful operation with no response body |
|  `400` | Malformed/invalid request                  |
|  `401` | Authentication required or failed          |
|  `403` | Authenticated but unauthorized             |
|  `404` | Resource not found or not visible          |
|  `409` | Resource/state/idempotency conflict        |
|  `422` | Business validation failure                |
|  `429` | Rate limit exceeded                        |
|  `500` | Unexpected server error                    |
|  `502` | Upstream/provider failure                  |
|  `503` | Service unavailable                        |
|  `504` | Upstream timeout                           |

---

# 18. Auth Endpoints

Base:

```text
/api/v1/auth
```

---

## 18.1 Register New User

```http
POST /api/v1/auth/register
Content-Type: application/json
```

### Authentication

Public.

### Request

```json
{
  "name": "Justine Robert",
  "email": "justine@titech.com",
  "password": "SecurePass123"
}
```

### Successful Response

```http
201 Created
```

```json
{
  "message": "User registered successfully",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "justine@titech.com",
    "name": "Justine Robert",
    "role": "user"
  }
}
```

### Validation Error

```http
400 Bad Request
```

```json
{
  "message": "Validation failed",
  "errors": [
    {
      "field": "email",
      "message": "Please provide a valid email"
    },
    {
      "field": "password",
      "message": "Password must contain at least one uppercase letter"
    }
  ]
}
```

### Security Requirements

* Rate limiting required.
* Password MUST never be logged.
* Duplicate account creation MUST be rejected deterministically.
* Email uniqueness MUST be enforced server-side.
* Audit event SHOULD be recorded.
* Enumeration-resistant behavior SHOULD be used where appropriate.

---

# 19. Login

```http
POST /api/v1/auth/login
Content-Type: application/json
```

### Request

```json
{
  "email": "justine@titech.com",
  "password": "SecurePass123"
}
```

### Response

```http
200 OK
```

```json
{
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "justine@titech.com",
    "name": "Justine Robert",
    "role": "user"
  }
}
```

### Error

```http
401 Unauthorized
```

```json
{
  "message": "Invalid credentials"
}
```

### Security

Login requires:

* aggressive rate limiting
* brute-force protection
* credential protection
* structured security logging
* audit logging
* no password logging

---

# 20. Get Current User

```http
GET /api/v1/auth/me
x-auth-token: <token>
```

### Response

```http
200 OK
```

```json
{
  "id": "507f1f77bcf86cd799439011",
  "email": "justine@titech.com",
  "name": "Justine Robert",
  "role": "user",
  "phone": "+256782397907",
  "profile": {
    "address": "123 Main St",
    "city": "Kampala",
    "country": "Uganda",
    "occupation": "Founder/CEO/Engineer"
  },
  "bonus": 0,
  "referralCode": "REF123ABC",
  "isVerified": false,
  "lastLogin": "2026-08-15T10:30:00Z"
}
```

### Error

```http
401 Unauthorized
```

```json
{
  "message": "Token has expired"
}
```

---

# 21. Refresh Access Token

```http
POST /api/v1/auth/refresh
Cookie: refreshToken=<refresh-token>
```

### Response

```http
200 OK
```

```json
{
  "message": "Token refreshed successfully",
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

### Errors

```http
401 Unauthorized
```

```json
{
  "message": "Missing refresh token"
}
```

```http
403 Forbidden
```

```json
{
  "message": "Invalid or expired refresh token"
}
```

### Security Requirements

Refresh tokens SHOULD be:

* HttpOnly
* Secure
* SameSite-protected
* rotated
* revocable
* replay-protected

---

# 22. Logout

```http
POST /api/v1/auth/logout
```

### Response

```http
200 OK
```

```json
{
  "message": "Logged out successfully"
}
```

Logout SHOULD revoke the relevant refresh session/token.

---

# 23. Group Endpoints

Base:

```text
/api/v1/groups
```

Groups represent community savings structures and MUST remain tenant-scoped where the tenant model is enabled.

---

# 24. Create Group

```http
POST /api/v1/groups
x-auth-token: <token>
Content-Type: application/json
```

### Request

```json
{
  "name": "Savings Circle 2025",
  "description": "Weekly savings group for community members"
}
```

### Response

```http
201 Created
```

```json
{
  "message": "Group created successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439012",
    "name": "Savings Circle 2025",
    "description": "Weekly savings group...",
    "members": [
      "507f1f77bcf86cd799439011"
    ],
    "createdBy": "507f1f77bcf86cd799439011",
    "createdAt": "2026-08-15T10:00:00Z",
    "updatedAt": "2026-08-15T10:00:00Z"
  }
}
```

---

# 25. List User Groups

```http
GET /api/v1/groups?page=1&limit=10
x-auth-token: <token>
```

### Response

```http
200 OK
```

```json
{
  "message": "Groups retrieved successfully",
  "data": [
    {
      "_id": "507f1f77bcf86cd799439012",
      "name": "Savings Circle 2025",
      "description": "Weekly savings group...",
      "members": [
        "507f1f77bcf86cd799439011"
      ],
      "createdBy": {
        "_id": "507f1f77bcf86cd799439011",
        "name": "Justine Robert",
        "email": "justine@titech.com"
      },
      "createdAt": "2026-08-15T10:00:00Z"
    }
  ],
  "pagination": {
    "total": 1,
    "page": 1,
    "limit": 10,
    "pages": 1
  }
}
```

### Query Parameters

| Parameter | Type    | Description              |
| --------- | ------- | ------------------------ |
| `page`    | integer | Page number              |
| `limit`   | integer | Maximum records returned |

Server-side maximum limits MUST be enforced.

---

# 26. Get Group Details

```http
GET /api/v1/groups/:groupId
x-auth-token: <token>
```

### Response

```http
200 OK
```

```json
{
  "message": "Group retrieved successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439012",
    "name": "Savings Circle 2025",
    "description": "Weekly savings group...",
    "members": [
      {
        "_id": "507f1f77bcf86cd799439011",
        "name": "Justine Robert",
        "email": "justine@titech.com"
      }
    ],
    "createdBy": {
      "_id": "507f1f77bcf86cd799439011",
      "name": "Justine Robert",
      "email": "justine@titech.com"
    },
    "createdAt": "2026-08-15T10:00:00Z"
  }
}
```

### Errors

```http
403 Forbidden
```

```json
{
  "message": "Not authorized to view this group"
}
```

```http
404 Not Found
```

```json
{
  "message": "Group not found"
}
```

---

# 27. Join Group

```http
POST /api/v1/groups/:groupId/join
x-auth-token: <token>
```

### Response

```http
200 OK
```

```json
{
  "message": "Successfully joined group",
  "data": {}
}
```

### Error

```http
400 Bad Request
```

```json
{
  "message": "You are already a member of this group"
}
```

Joining a group MUST be idempotent at the business-operation level or return a deterministic conflict.

---

# 28. Leave Group

```http
POST /api/v1/groups/:groupId/leave
x-auth-token: <token>
```

### Response

```http
200 OK
```

```json
{
  "message": "Successfully left the group",
  "data": {}
}
```

### Error

```http
403 Forbidden
```

```json
{
  "message": "Group creator cannot leave the group"
}
```

---

# 29. Contribution Endpoints

Base:

```text
/api/v1/contributions
```

Contributions are financial operations.

Consequently, production implementations MUST integrate with the financial transaction/ledger architecture.

The API MUST NOT directly mutate an account balance.

---

# 30. Add Contribution

```http
POST /api/v1/contributions
x-auth-token: <token>
Content-Type: application/json
Idempotency-Key: contribution-unique-key
```

### Request

```json
{
  "groupId": "507f1f77bcf86cd799439012",
  "amount": "5000.00",
  "currency": "UGX"
}
```

### Response

```http
201 Created
```

```json
{
  "message": "Contribution added successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439013",
    "user": "507f1f77bcf86cd799439011",
    "group": "507f1f77bcf86cd799439012",
    "amount": "5000.00",
    "currency": "UGX",
    "status": "COMPLETED",
    "createdAt": "2026-08-15T10:30:00Z"
  }
}
```

### Authorization Error

```http
403 Forbidden
```

```json
{
  "message": "You are not a member of this group"
}
```

### Financial Requirements

The operation MUST provide:

* tenant context
* actor context
* idempotency
* transaction correlation
* ledger posting
* audit event
* financial state transition
* duplicate request protection

---

# 31. Get Group Contributions

```http
GET /api/v1/contributions/group/:groupId?page=1&limit=20
x-auth-token: <token>
```

### Response

```json
{
  "message": "Group contributions retrieved successfully",
  "data": [
    {
      "_id": "507f1f77bcf86cd799439013",
      "user": {
        "_id": "507f1f77bcf86cd799439011",
        "name": "Justine Robert",
        "email": "justine@titech.com"
      },
      "group": "507f1f77bcf86cd799439012",
      "amount": "5000.00",
      "currency": "UGX",
      "createdAt": "2026-08-15T10:30:00Z"
    }
  ],
  "pagination": {
    "total": 1,
    "page": 1,
    "limit": 20,
    "pages": 1
  }
}
```

---

# 32. Get User Contributions

```http
GET /api/v1/contributions/user?page=1&limit=20
x-auth-token: <token>
```

### Response

```json
{
  "message": "User contributions retrieved successfully",
  "data": [
    {
      "_id": "507f1f77bcf86cd799439013",
      "user": "507f1f77bcf86cd799439011",
      "group": {
        "_id": "507f1f77bcf86cd799439012",
        "name": "Savings Circle 2025"
      },
      "amount": "5000.00",
      "currency": "UGX",
      "createdAt": "2026-08-15T10:30:00Z"
    }
  ],
  "pagination": {}
}
```

---

# 33. Get Group Statistics

```http
GET /api/v1/contributions/group/:groupId/stats
x-auth-token: <token>
```

### Response

```json
{
  "message": "Group statistics retrieved successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439012",
    "totalAmount": "50000.00",
    "currency": "UGX",
    "contributionCount": 10,
    "avgContribution": "5000.00"
  }
}
```

Financial statistics MUST be calculated from authoritative financial data.

---

# 34. Account APIs

Base:

```text
/api/v1/accounts
```

Representative endpoints:

```http
GET /api/v1/accounts
GET /api/v1/accounts/:accountId
GET /api/v1/accounts/:accountId/balance
GET /api/v1/accounts/:accountId/statement
GET /api/v1/accounts/:accountId/transactions
```

Protected endpoints require authentication and tenant/resource authorization.

Balances MUST originate from the authoritative balance engine.

---

# 35. Transaction APIs

Base:

```text
/api/v1/transactions
```

Representative endpoints:

```http
POST /api/v1/transactions
GET /api/v1/transactions
GET /api/v1/transactions/:transactionId
POST /api/v1/transactions/:transactionId/cancel
POST /api/v1/transactions/:transactionId/reverse
GET /api/v1/transactions/:transactionId/events
```

Financial commands require:

```http
Idempotency-Key: <unique-key>
```

Transaction state MUST be enforced by the transaction state machine.

---

# 36. Ledger APIs

Base:

```text
/api/v1/ledger
```

Representative endpoints:

```http
GET /api/v1/ledger/accounts
GET /api/v1/ledger/accounts/:accountId
GET /api/v1/ledger/accounts/:accountId/balance
GET /api/v1/ledger/journals/:journalId
GET /api/v1/ledger/entries/:entryId
GET /api/v1/ledger/transactions/:transactionId
POST /api/v1/ledger/transactions
POST /api/v1/ledger/transactions/:transactionId/reverse
POST /api/v1/ledger/adjustments
```

### Critical Rule

There MUST NOT be an endpoint that edits a posted journal entry.

Forbidden:

```http
PATCH /api/v1/ledger/entries/:entryId
```

Financial corrections MUST use reversal and/or adjustment operations.

---

# 37. Payment APIs

Base:

```text
/api/v1/payments
```

Representative endpoints:

```http
POST /api/v1/payments
GET /api/v1/payments
GET /api/v1/payments/:paymentId
POST /api/v1/payments/:paymentId/cancel
POST /api/v1/payments/:paymentId/refund
POST /api/v1/payments/:paymentId/reverse
```

Financial payment requests require:

```http
Idempotency-Key: <unique-key>
```

---

# 38. MTN MoMo Integration

Provider integration is abstracted behind the payment/provider layer.

Representative API surface:

```http
POST /api/v1/payments/momo/collections
POST /api/v1/payments/momo/disbursements
GET /api/v1/payments/momo/:paymentId
```

Provider credentials MUST remain server-side.

Clients MUST NOT supply MTN access tokens or provider secrets.

---

# 39. Airtel Money Integration

Representative API surface:

```http
POST /api/v1/payments/airtel/collections
POST /api/v1/payments/airtel/disbursements
GET /api/v1/payments/airtel/:paymentId
```

Provider authentication MUST remain inside the Airtel integration layer.

---

# 40. Provider Webhooks

Base:

```text
/api/v1/webhooks
```

Representative endpoints:

```http
POST /api/v1/webhooks/mtn
POST /api/v1/webhooks/airtel
```

Provider callbacks MUST pass through:

```text
Webhook
  ↓
Provider Identification
  ↓
Signature Verification
  ↓
Replay Protection
  ↓
Schema Validation
  ↓
Normalization
  ↓
Idempotency
  ↓
Callback Processing
  ↓
Payment / Transaction Service
  ↓
Ledger
  ↓
Audit / Events
```

Webhook handlers MUST NOT directly modify balances.

---

# 41. Loan APIs

Base:

```text
/api/v1/loans
```

Representative endpoints:

```http
GET  /api/v1/loans/products
POST /api/v1/loans/products

POST /api/v1/loans/applications
GET  /api/v1/loans/applications/:applicationId
PATCH /api/v1/loans/applications/:applicationId

POST /api/v1/loans/applications/:applicationId/submit
POST /api/v1/loans/applications/:applicationId/approve
POST /api/v1/loans/applications/:applicationId/reject
POST /api/v1/loans/applications/:applicationId/disburse

GET /api/v1/loans/:loanId
GET /api/v1/loans/:loanId/schedule
GET /api/v1/loans/:loanId/repayments
POST /api/v1/loans/:loanId/repayments
POST /api/v1/loans/:loanId/restructure
POST /api/v1/loans/:loanId/write-off
```

Loan workflow transitions MUST be performed through the loan workflow/domain service.

Clients MUST NOT directly set loan state.

---

# 42. Loan Risk APIs

Base:

```text
/api/v1/risk
```

Representative endpoints:

```http
POST /api/v1/risk/loan-applications/:applicationId/score
GET  /api/v1/risk/loan-applications/:applicationId/profile
GET  /api/v1/risk/loan-applications/:applicationId/decision
```

Risk calculations SHOULD preserve:

```text
baseScore
inputFingerprint
correlationId
idempotencyKey
scoringVersion
```

Risk results MUST be auditable and reproducible.

---

# 43. Savings APIs

Base:

```text
/api/v1/savings
```

Representative endpoints:

```http
GET  /api/v1/savings/accounts
POST /api/v1/savings/accounts
GET  /api/v1/savings/accounts/:accountId
GET  /api/v1/savings/accounts/:accountId/balance
POST /api/v1/savings/accounts/:accountId/deposits
POST /api/v1/savings/accounts/:accountId/withdrawals
GET  /api/v1/savings/accounts/:accountId/transactions
```

Deposits and withdrawals are financial commands and require idempotency.

---

# 44. Onboarding APIs

Base:

```text
/api/v1/onboarding
```

Representative endpoints:

```http
POST /api/v1/onboarding/applications
GET  /api/v1/onboarding/applications/:applicationId
PATCH /api/v1/onboarding/applications/:applicationId
POST /api/v1/onboarding/applications/:applicationId/submit
POST /api/v1/onboarding/applications/:applicationId/verify
POST /api/v1/onboarding/applications/:applicationId/approve
POST /api/v1/onboarding/applications/:applicationId/reject
POST /api/v1/onboarding/applications/:applicationId/go-live
```

Workflow state MUST be controlled by the onboarding workflow engine.

---

# 45. KYC APIs

Base:

```text
/api/v1/kyc
```

Representative endpoints:

```http
POST /api/v1/kyc/cases
GET  /api/v1/kyc/cases/:caseId
POST /api/v1/kyc/cases/:caseId/documents
POST /api/v1/kyc/cases/:caseId/verify
POST /api/v1/kyc/cases/:caseId/approve
POST /api/v1/kyc/cases/:caseId/reject
```

KYC information MUST be protected according to its sensitivity.

---

# 46. Compliance APIs

Base:

```text
/api/v1/compliance
```

Representative endpoints:

```http
GET  /api/v1/compliance/cases
GET  /api/v1/compliance/cases/:caseId
POST /api/v1/compliance/cases/:caseId/review
POST /api/v1/compliance/cases/:caseId/resolve

GET  /api/v1/compliance/alerts

GET  /api/v1/compliance/submissions
POST /api/v1/compliance/submissions
POST /api/v1/compliance/submissions/:submissionId/submit
```

Regulatory submissions require auditability and idempotency.

---

# 47. Statements APIs

Base:

```text
/api/v1/statements
```

Representative endpoints:

```http
POST /api/v1/statements/imports
GET  /api/v1/statements/imports/:importId
GET  /api/v1/statements/batches/:batchId
POST /api/v1/statements/batches/:batchId/retry
GET  /api/v1/statements/reconciliation
GET  /api/v1/statements/exceptions
POST /api/v1/statements/exceptions/:exceptionId/repair
GET  /api/v1/statements/:statementId
```

Statement processing MUST preserve batch ownership and concurrent-worker safety.

---

# 48. Reconciliation APIs

Base:

```text
/api/v1/reconciliation
```

Representative endpoints:

```http
GET  /api/v1/reconciliation/runs
POST /api/v1/reconciliation/runs
GET  /api/v1/reconciliation/runs/:runId
GET  /api/v1/reconciliation/runs/:runId/exceptions
POST /api/v1/reconciliation/exceptions/:exceptionId/resolve
```

Reconciliation MUST NOT silently alter posted financial records.

---

# 49. Settlement APIs

Base:

```text
/api/v1/settlements
```

Representative endpoints:

```http
GET  /api/v1/settlements
GET  /api/v1/settlements/:settlementId
POST /api/v1/settlements/:settlementId/reconcile
POST /api/v1/settlements/:settlementId/reverse
```

Settlement commands require idempotency.

---

# 50. SaaS Subscription APIs

Base:

```text
/api/v1/subscriptions
```

Representative endpoints:

```http
GET  /api/v1/subscriptions/plans
GET  /api/v1/subscriptions/plans/:planId
POST /api/v1/subscriptions
GET  /api/v1/subscriptions/:subscriptionId
POST /api/v1/subscriptions/:subscriptionId/change-plan
POST /api/v1/subscriptions/:subscriptionId/cancel
GET  /api/v1/subscriptions/:subscriptionId/invoices
```

---

# 51. Billing APIs

Base:

```text
/api/v1/billing
```

Representative endpoints:

```http
GET  /api/v1/billing/invoices
GET  /api/v1/billing/invoices/:invoiceId
POST /api/v1/billing/invoices/:invoiceId/pay
GET  /api/v1/billing/usage
GET  /api/v1/billing/ledger
```

Billing financial effects MUST use the authoritative financial ledger.

---

# 52. Notifications APIs

Base:

```text
/api/v1/notifications
```

Representative endpoints:

```http
GET   /api/v1/notifications
GET   /api/v1/notifications/:notificationId
POST  /api/v1/notifications/:notificationId/read
POST  /api/v1/notifications/read-all
GET   /api/v1/notifications/preferences
PATCH /api/v1/notifications/preferences
```

---

# 53. Audit APIs

Base:

```text
/api/v1/audit
```

Representative endpoints:

```http
GET /api/v1/audit/events
GET /api/v1/audit/events/:eventId
GET /api/v1/audit/actors/:actorId
GET /api/v1/audit/resources/:resourceType/:resourceId
```

Audit records are append-oriented.

There MUST NOT be a general API for editing audit history.

---

# 54. Reporting APIs

Base:

```text
/api/v1/reports
```

Representative endpoints:

```http
GET /api/v1/reports/financial
GET /api/v1/reports/loans
GET /api/v1/reports/savings
GET /api/v1/reports/payments
GET /api/v1/reports/reconciliation
GET /api/v1/reports/compliance
GET /api/v1/reports/executive
```

Financial reports MUST reconcile to authoritative ledger data.

---

# 55. Operations API

Long-running operations MAY return:

```http
202 Accepted
```

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

Status:

```http
GET /api/v1/operations/:operationId
```

---

# 56. Health Endpoints

Operational health endpoints are separate from business APIs.

Recommended:

```http
GET /health
GET /health/live
GET /health/ready
GET /health/startup
```

These endpoints MUST NOT expose secrets.

Readiness SHOULD verify critical dependencies such as:

* database
* Redis
* required infrastructure services

Liveness SHOULD remain lightweight.

---

# 57. Metrics

Where enabled:

```http
GET /metrics
```

Access MUST be restricted to trusted infrastructure.

The endpoint SHOULD expose application and infrastructure metrics without exposing sensitive information.

---

# 58. Pagination

Supported collection parameters:

```text
page
limit
page_size
cursor
```

Example:

```http
GET /api/v1/groups?page=1&limit=20
```

The server MUST enforce maximum page sizes.

Clients MUST NOT assume that the total number of records is unboundedly retrievable through a single request.

---

# 59. Filtering

Filtering parameters MUST be explicitly allowlisted.

Example:

```http
GET /api/v1/transactions?status=COMPLETED
```

Arbitrary database operators MUST NOT be accepted from clients.

---

# 60. Sorting

Sorting fields MUST be allowlisted.

Example:

```http
GET /api/v1/transactions?sort=-createdAt
```

Unsupported sort fields MUST be rejected.

---

# 61. Monetary Amounts

Financial APIs SHOULD represent amounts as decimal strings.

Preferred:

```json
{
  "amount": "5000.00",
  "currency": "UGX"
}
```

Avoid:

```json
{
  "amount": 5000.123456789
}
```

where floating-point precision could affect financial calculations.

The API MUST NOT rely on JavaScript binary floating-point arithmetic as the accounting authority.

---

# 62. Currency

Monetary operations SHOULD explicitly include:

```json
{
  "amount": "5000.00",
  "currency": "UGX"
}
```

Currency codes SHOULD use ISO 4217 conventions.

---

# 63. Financial Idempotency

Every externally retryable financial command SHOULD require:

```http
Idempotency-Key: <unique-operation-key>
```

Example:

```http
POST /api/v1/payments
Idempotency-Key: pay_01JXYZ...
```

The key MUST be scoped by:

```text
tenant
+
operation
+
client
```

where appropriate.

Repeated requests MUST NOT create duplicate financial effects.

---

# 64. Financial Immutability

The API MUST NOT allow clients to rewrite posted financial facts.

Incorrect:

```http
PATCH /api/v1/transactions/:id
```

```json
{
  "amount": "100000"
}
```

Correct pattern:

```http
POST /api/v1/transactions/:id/reverse
```

followed by a new authorized financial transaction or adjustment.

---

# 65. Transaction State

Typical lifecycle:

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

Failure:

```text
PROCESSING
    ↓
FAILED
```

Reversal:

```text
COMPLETED
    ↓
REVERSAL_REQUESTED
    ↓
REVERSED
```

Clients MUST NOT directly assign arbitrary transaction states.

---

# 66. Rate Limiting

Current baseline:

```text
Global:
100 requests / 15 minutes / IP
```

This is a development/baseline policy and MUST NOT be interpreted as the complete production rate-limit strategy.

Production SHOULD additionally support differentiated limits for:

* authentication
* password reset
* token refresh
* financial commands
* provider callbacks
* administrative operations
* tenant-level traffic

Rate-limit responses SHOULD expose:

```http
X-RateLimit-Remaining
Retry-After
```

where supported.

---

# 67. Token Expiry

The current target authentication policy is:

```text
Access Token:
15 minutes

Refresh Token:
7 days
```

Actual values MUST be configuration-driven and environment-specific.

Clients MUST NOT hard-code expiry durations as authoritative.

When an access token expires:

1. Use the refresh operation.
2. Obtain a new access token.
3. Retry the original request only where retry is safe.
4. Do not retry financial commands without idempotency protection.

---

# 68. Validation Rules

## 68.1 Password

Baseline requirements:

* minimum 8 characters
* uppercase character
* lowercase character
* numeric character

Production password policy MAY be stricter.

Passwords MUST never be stored or logged in plaintext.

---

# 69. Email

Email addresses MUST:

* follow valid email syntax
* be normalized consistently
* be unique where required
* be validated server-side

Email uniqueness checks MUST be backed by database constraints where applicable.

---

# 70. Amount

Financial amounts MUST:

* be greater than zero where the operation requires positive values
* have valid decimal representation
* include a currency where required
* respect currency precision
* be validated before financial posting

---

# 71. Group Name

Baseline:

```text
Minimum: 3 characters
Maximum: 100 characters
```

Uniqueness MUST be scoped appropriately.

For multi-tenant operation, uniqueness SHOULD generally be evaluated within the relevant tenant rather than globally unless business rules explicitly require global uniqueness.

---

# 72. Request Size Limits

Clients MUST NOT assume unlimited request body size.

Production API configuration SHOULD impose strict body-size limits appropriate to endpoint requirements.

File/document uploads SHOULD use dedicated upload mechanisms rather than excessively large JSON bodies.

---

# 73. API Timeout Policy

All external calls MUST have bounded timeouts.

This includes:

* database operations
* payment providers
* regulatory services
* notification providers
* internal HTTP services

The API MUST NOT wait indefinitely for an unavailable upstream dependency.

---

# 74. Retry Policy

Retries are permitted only where semantics are safe.

Safe examples:

```text
GET requests
```

and explicitly idempotent operations.

Financial operations require:

```text
Idempotency
+
Bounded Retry
+
Backoff
```

A timeout does NOT prove that a financial operation failed.

Clients MUST query operation status before issuing an unprotected second command.

---

# 75. Provider Failure Handling

Provider errors SHOULD be normalized.

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

Raw provider error payloads MUST NOT automatically be exposed to clients.

---

# 76. Common Error Codes

Recommended machine-readable error codes include:

```text
AUTH_INVALID_CREDENTIALS
AUTH_TOKEN_EXPIRED
AUTH_TOKEN_INVALID
AUTH_REFRESH_REQUIRED

TENANT_ACCESS_DENIED
TENANT_NOT_FOUND

VALIDATION_FAILED
RESOURCE_NOT_FOUND
RESOURCE_CONFLICT

IDEMPOTENCY_KEY_REQUIRED
IDEMPOTENCY_KEY_REUSED
IDEMPOTENCY_REQUEST_IN_PROGRESS

TRANSACTION_INVALID_STATE
TRANSACTION_ALREADY_COMPLETED
TRANSACTION_NOT_FOUND

LEDGER_POSTING_REJECTED
LEDGER_IMBALANCED_ENTRY
LEDGER_ACCOUNT_NOT_FOUND

PAYMENT_PROVIDER_UNAVAILABLE
PAYMENT_PROVIDER_TIMEOUT
PAYMENT_PROVIDER_REJECTED

LOAN_NOT_ELIGIBLE
LOAN_INVALID_STATE

SETTLEMENT_ALREADY_PROCESSED
SETTLEMENT_RECONCILIATION_FAILED

RATE_LIMIT_EXCEEDED

INTERNAL_ERROR
SERVICE_UNAVAILABLE
```

---

# 77. Legacy Error Compatibility

Existing implementations may return:

```json
{
  "message": "Group not found"
}
```

New implementations SHOULD return:

```json
{
  "success": false,
  "error": {
    "code": "GROUP_NOT_FOUND",
    "message": "Group not found",
    "retryable": false
  },
  "meta": {
    "request_id": "req_01J...",
    "correlation_id": "cor_01J..."
  }
}
```

Migration from legacy responses MUST be coordinated with consumers.

---

# 78. cURL Testing

## 78.1 Register

```bash
curl -X POST http://localhost:5000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Justine Robert",
    "email": "justine@titech.com",
    "password": "SecurePass123"
  }'
```

---

# 79. Login

```bash
curl -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "justine@titech.com",
    "password": "SecurePass123"
  }' \
  -c cookies.txt
```

---

# 80. Get Current User

```bash
TOKEN="<token_from_login>"

curl -X GET http://localhost:5000/api/v1/auth/me \
  -H "Authorization: Bearer $TOKEN"
```

Legacy-compatible form:

```bash
curl -X GET http://localhost:5000/api/v1/auth/me \
  -H "x-auth-token: $TOKEN"
```

---

# 81. Create Group

```bash
TOKEN="<token>"

curl -X POST http://localhost:5000/api/v1/groups \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Savings Circle 2025",
    "description": "Weekly savings group"
  }'
```

---

# 82. Create Contribution

Because contributions are financial operations, use an idempotency key:

```bash
TOKEN="<token>"
IDEMPOTENCY_KEY="contribution-$(uuidgen)"

curl -X POST http://localhost:5000/api/v1/contributions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  -d '{
    "groupId": "507f1f77bcf86cd799439012",
    "amount": "5000.00",
    "currency": "UGX"
  }'
```

---

# 83. Query Groups

```bash
TOKEN="<token>"

curl -X GET \
  "http://localhost:5000/api/v1/groups?page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

---

# 84. Refresh Token

```bash
curl -X POST \
  http://localhost:5000/api/v1/auth/refresh \
  -b cookies.txt
```

---

# 85. Logout

```bash
curl -X POST \
  http://localhost:5000/api/v1/auth/logout \
  -b cookies.txt
```

---

# 86. API Testing Strategy

Every production endpoint SHOULD have:

### Unit tests

Test:

* validation
* authorization
* controller behavior
* error mapping

### Integration tests

Test:

* authentication
* database integration
* tenant isolation
* domain service integration
* idempotency

### Contract tests

Test:

* request schema
* response schema
* status codes
* OpenAPI compatibility

### End-to-end tests

Test complete business flows.

Example:

```text
Register
  ↓
Login
  ↓
Create Group
  ↓
Join Group
  ↓
Create Contribution
  ↓
Ledger Posting
  ↓
Transaction Completion
  ↓
Audit/Event
```

---

# 87. Financial Integration Testing

Financial API tests MUST verify:

### Duplicate protection

```text
Request A
   ↓
Financial effect = 1

Request A repeated
   ↓
Financial effect remains = 1
```

### Concurrent requests

```text
Request A ─┐
           ├── same Idempotency-Key
Request B ─┘

Result:
Exactly one financial effect
```

### Reversal

```text
Original transaction
       ↓
Immutable
       ↓
Reversal transaction
       ↓
Compensating ledger entries
```

### Double-entry

Every posted transaction MUST satisfy:

```text
Total Debits = Total Credits
```

---

# 88. Tenant Isolation Testing

Tests MUST verify:

```text
Tenant A
   ↓
User A
   ↓
Tenant B resource
   ↓
403 / 404
```

depending on the resource-enumeration policy.

Coverage SHOULD include:

* groups
* contributions
* accounts
* loans
* payments
* statements
* reports
* audit events
* administrative resources

---

# 89. Security Testing

Production API security testing SHOULD cover:

* invalid JWT
* expired JWT
* missing JWT
* malformed JWT
* refresh-token replay
* privilege escalation
* cross-tenant access
* object-level authorization
* injection attempts
* oversized payloads
* rate-limit bypass
* webhook signature bypass
* replayed callbacks
* duplicate financial commands

---

# 90. Observability

Every API request SHOULD be observable through:

```text
request_id
correlation_id
trace_id
tenant_id
actor_id
route
method
status
duration
```

Financial operations SHOULD additionally correlate:

```text
transaction_id
payment_id
ledger_transaction_id
journal_id
event_id
```

This permits a complete transaction investigation:

```text
HTTP Request
     ↓
Transaction
     ↓
Payment
     ↓
Ledger
     ↓
Event
     ↓
Settlement
```

---

# 91. Logging Rules

Structured logs SHOULD include:

```text
timestamp
level
service
environment
request_id
correlation_id
trace_id
tenant_id
actor_id
route
method
status
duration_ms
```

Do NOT log:

```text
password
JWT
refresh token
API secret
provider secret
private key
full payment credentials
```

Sensitive request bodies MUST be redacted or excluded.

---

# 92. Audit Requirements

Audit records SHOULD be generated for:

* authentication
* failed authentication
* authorization failures
* role changes
* tenant changes
* KYC decisions
* AML decisions
* loan approvals
* loan disbursements
* payments
* refunds
* reversals
* ledger adjustments
* settlement actions
* regulatory submissions
* administrative operations

Minimum audit context:

```text
event_id
timestamp
tenant_id
actor_id
action
resource_type
resource_id
request_id
correlation_id
outcome
reason
```

---

# 93. API Performance Requirements

Production APIs SHOULD be monitored for:

```text
p50 latency
p95 latency
p99 latency
error rate
timeout rate
rate-limit rate
provider latency
database latency
queue latency
```

Critical financial endpoints require tighter operational monitoring.

---

# 94. API Availability

Critical API domains include:

```text
Authentication
Payments
Ledger
Transactions
Loans
Savings
Settlement
```

These require explicit:

* timeout policies
* failure policies
* recovery procedures
* monitoring
* alerting
* idempotency behavior

---

# 95. Asynchronous Processing

Long-running operations SHOULD return:

```http
202 Accepted
```

rather than holding an HTTP request indefinitely.

Example:

```json
{
  "success": true,
  "data": {
    "operation_id": "op_01J..."
  }
}
```

The operation can then be queried through:

```http
GET /api/v1/operations/:operationId
```

---

# 96. API Deprecation

Deprecated endpoints MUST be documented.

Where supported:

```http
Deprecation: true
Sunset: <date>
```

Clients SHOULD receive migration guidance.

No production endpoint should disappear without:

1. deprecation notice
2. replacement endpoint
3. migration documentation
4. sunset date
5. consumer impact assessment

---

# 97. Backward Compatibility

Existing clients are part of the API contract.

Changes to:

* response fields
* request fields
* authentication
* status codes
* error formats
* transaction semantics
* pagination
* resource identifiers

MUST be evaluated for backward compatibility.

Breaking changes require a new API version or approved migration strategy.

---

# 98. API Design Rules

All new endpoints MUST follow these rules:

1. Use nouns for resources.
2. Use explicit command endpoints for state transitions.
3. Validate all client input.
4. Authenticate protected endpoints.
5. Authorize every protected resource.
6. Enforce tenant isolation.
7. Use stable machine-readable errors.
8. Use request/correlation IDs.
9. Apply rate limits where appropriate.
10. Use idempotency for financial commands.
11. Never directly mutate financial balances.
12. Never edit posted ledger entries.
13. Audit sensitive operations.
14. Propagate trace context.
15. Define timeout behavior.
16. Define retry behavior.
17. Add automated tests.
18. Update OpenAPI.
19. Update `API_CATALOGUE.md`.
20. Assign an endpoint owner.

---

# 99. Forbidden API Patterns

## Direct balance mutation

```http
PATCH /api/v1/accounts/:accountId
```

```json
{
  "balance": "100000.00"
}
```

**Forbidden.**

---

## Direct ledger editing

```http
PATCH /api/v1/ledger/entries/:entryId
```

**Forbidden for posted financial records.**

---

## Client-controlled transaction state

```http
PATCH /api/v1/loans/:loanId
```

```json
{
  "status": "DISBURSED"
}
```

**Forbidden.**

Use:

```http
POST /api/v1/loans/:loanId/disburse
```

---

## Unprotected financial retry

```text
POST payment
   ↓
timeout
   ↓
POST payment again
```

**Forbidden unless idempotency is enforced.**

---

## Cross-tenant access

```text
User authenticated
     ↓
tenantId changed manually
     ↓
Tenant B resource
```

**Forbidden.**

---

# 100. API Request Lifecycle

The canonical request lifecycle is:

```text
1. TLS
   ↓
2. Request ID
   ↓
3. Correlation ID
   ↓
4. Trace Context
   ↓
5. Rate Limit
   ↓
6. Input Validation
   ↓
7. Authentication
   ↓
8. Tenant Resolution
   ↓
9. Authorization
   ↓
10. Idempotency
   ↓
11. Controller
   ↓
12. Domain Service
   ↓
13. Persistence / Ledger / Provider
   ↓
14. Audit
   ↓
15. Outbox / Event
   ↓
16. Response
   ↓
17. Metrics / Structured Logging
```

---

# 101. Financial Request Lifecycle

```text
Client
  ↓
POST financial command
  ↓
Authentication
  ↓
Tenant Authorization
  ↓
Validation
  ↓
Idempotency
  ↓
Transaction Context
  ↓
Domain Validation
  ↓
Financial Service
  ↓
Ledger Engine
  ↓
Double-Entry Validation
  ↓
Transaction State
  ↓
Audit
  ↓
Outbox
  ↓
Commit
  ↓
API Response
```

The API layer does not become the accounting authority.

---

# 102. API Contract Governance

The API contract consists of three synchronized layers:

```text
API Implementation
       │
       ├──────────────┐
       ▼              ▼
OpenAPI Contract   Human Documentation
       │              │
       └──────┬───────┘
              ▼
       API Catalogue
```

A production API change is incomplete until all applicable layers are updated.

---

# 103. Production Readiness Checklist

For every endpoint:

* [ ] Authentication defined.
* [ ] Authorization defined.
* [ ] Tenant scope defined.
* [ ] Input validation implemented.
* [ ] Output contract defined.
* [ ] Error contract defined.
* [ ] Request ID supported.
* [ ] Correlation ID supported.
* [ ] Distributed tracing supported.
* [ ] Rate limiting assessed.
* [ ] Timeout configured.
* [ ] Retry semantics defined.
* [ ] Idempotency assessed.
* [ ] Audit requirements implemented.
* [ ] Structured logging implemented.
* [ ] Metrics implemented.
* [ ] Integration tests implemented.
* [ ] Contract tests implemented.
* [ ] Security tests implemented.
* [ ] OpenAPI updated.
* [ ] API catalogue updated.
* [ ] Service owner assigned.

---

# 104. Financial Production Readiness Checklist

For every financial command:

* [ ] Authentication required.
* [ ] Authorization enforced.
* [ ] Tenant isolation enforced.
* [ ] Idempotency required.
* [ ] Transaction correlation established.
* [ ] Transaction state machine enforced.
* [ ] Ledger integration implemented.
* [ ] Double-entry validation enforced.
* [ ] No direct balance mutation.
* [ ] Posted financial records immutable.
* [ ] Reversal behavior defined.
* [ ] Audit trail generated.
* [ ] Outbox/event behavior defined.
* [ ] Duplicate requests tested.
* [ ] Concurrent requests tested.
* [ ] Provider failure tested where applicable.
* [ ] Reconciliation behavior defined.
* [ ] Operational metrics available.

---

# 105. API Documentation Maintenance

Update this document whenever:

* an endpoint is added
* an endpoint is removed
* a request contract changes
* a response contract changes
* authentication changes
* authorization changes
* tenant behavior changes
* an endpoint becomes financial
* idempotency behavior changes
* an error code changes
* a provider integration changes
* a webhook changes
* an endpoint is deprecated

Documentation drift is considered an API quality defect.

---

# 106. Definition of Done

An API feature is complete only when:

```text
Implementation
+
Validation
+
Authentication
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
Documentation
+
Operational Readiness
```

For financial features:

```text
Implementation
+
Validation
+
Authentication
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
Events
+
Observability
+
Reconciliation
+
Tests
+
OpenAPI
+
Documentation
```

---

# 107. Production API Invariants

The following invariants are mandatory:

### Authentication

Protected resources require valid authentication.

### Authorization

Authentication does not imply resource authorization.

### Tenant Isolation

A request cannot cross tenant boundaries without explicit privileged authorization.

### Financial Integrity

No API controller directly mutates financial balances.

### Ledger Authority

All posted financial effects originate from the authoritative ledger engine.

### Idempotency

A retried financial command cannot create duplicate financial effects.

### Immutability

Posted financial records cannot be edited.

### Auditability

Sensitive operations are traceable to an actor and request context.

### Observability

Production requests can be traced using request and correlation identifiers.

### Contract Stability

API changes follow versioning and compatibility governance.

---

# 108. API Reference Summary

| Domain         | Base Path          | Authentication | Financial Impact |
| -------------- | ------------------ | -------------- | ---------------- |
| Auth           | `/auth`            | Mixed          | No               |
| Users          | `/users`           | Required       | No               |
| Groups         | `/groups`          | Required       | Indirect         |
| Contributions  | `/contributions`   | Required       | **Yes**          |
| Accounts       | `/accounts`        | Required       | **Yes**          |
| Transactions   | `/transactions`    | Required       | **Yes**          |
| Ledger         | `/ledger`          | Privileged     | **Yes**          |
| Payments       | `/payments`        | Required       | **Yes**          |
| MTN MoMo       | `/payments/momo`   | Required       | **Yes**          |
| Airtel Money   | `/payments/airtel` | Required       | **Yes**          |
| Webhooks       | `/webhooks`        | Provider Auth  | **Yes**          |
| Loans          | `/loans`           | Required       | **Yes**          |
| Risk           | `/risk`            | Required       | Indirect         |
| Savings        | `/savings`         | Required       | **Yes**          |
| Onboarding     | `/onboarding`      | Required       | Indirect         |
| KYC            | `/kyc`             | Required       | No               |
| Compliance     | `/compliance`      | Required       | Indirect         |
| Statements     | `/statements`      | Required       | Indirect         |
| Reconciliation | `/reconciliation`  | Privileged     | **Yes**          |
| Settlement     | `/settlements`     | Privileged     | **Yes**          |
| Subscriptions  | `/subscriptions`   | Required       | Financial        |
| Billing        | `/billing`         | Required       | **Yes**          |
| Notifications  | `/notifications`   | Required       | No               |
| Audit          | `/audit`           | Privileged     | No               |
| Reports        | `/reports`         | Required       | Read-only        |
| Operations     | `/operations`      | Required       | Indirect         |
| Health         | `/health*`         | Infrastructure | No               |
| Metrics        | `/metrics`         | Restricted     | No               |

---

# 109. Final API Principle

The TITech API is not merely an HTTP wrapper around database models.

It is the controlled boundary through which external actors invoke authenticated, authorized, validated, observable and auditable business operations.

The production rule is:

```text
External Client
      ↓
Secure HTTP Boundary
      ↓
Authentication
      ↓
Tenant Authorization
      ↓
Validation
      ↓
Idempotency
      ↓
Application Command
      ↓
Domain Service
      ↓
Authoritative State
      ↓
Ledger / Persistence
      ↓
Audit + Events
      ↓
Deterministic Response
```

For financial operations:

```text
NO DIRECT BALANCE MUTATION
NO DIRECT POSTED-LEDGER EDITING
NO UNPROTECTED FINANCIAL RETRIES
NO CROSS-TENANT ACCESS
NO UNVERIFIED PROVIDER CALLBACKS
NO CLIENT-CONTROLLED FINANCIAL STATE TRANSITIONS
```

This document is the implementation-facing companion to `docs/api/API_CATALOGUE.md` and SHALL evolve together with the production API, OpenAPI contract, service catalogue, dependency map, event catalogue, and financial architecture.