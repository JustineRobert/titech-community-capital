# API REFERENCE - Quick Start

> **TITech Community Capital Ltd — Community Savings Platform**
>
> Production-oriented quick reference for authentication, loan management, administration, chat, referrals, health/observability, error handling, and API usage conventions.
>
> **API Version:** `2.0`
> **Document Status:** Production Reference
> **Last Updated:** August 15, 2026

---

## 1. API BASE URL

### Local Development

```text
http://localhost:5000
```

### API Prefix

```text
/api
```

Therefore, for example:

```text
GET http://localhost:5000/api/loans/:loanId
```

For production deployments, replace the host with the configured public API origin.

---

## 2. AUTHENTICATION

All protected endpoints require a valid authenticated access token.

### Bearer Token

```http
Authorization: Bearer {accessToken}
```

### Legacy Token Header

```http
x-auth-token: {accessToken}
```

### Example

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### Authentication Rules

* Do not send access tokens in URLs.
* Do not log access tokens.
* Do not expose access tokens in client-side error messages.
* Use HTTPS in all non-local environments.
* Expired or invalid tokens should be treated as unauthorized.
* Administrative endpoints require an authenticated user with the appropriate administrative privileges.
* Financially significant requests should also provide a request correlation identifier where supported.

---

## 3. REQUEST CONVENTIONS

### Content Type

JSON requests should use:

```http
Content-Type: application/json
```

### Recommended Correlation Header

Where supported:

```http
X-Request-ID: <unique-request-id>
```

A client may generate a UUID for each request when a request identifier is not supplied by the platform.

### Idempotency

Financially significant write operations should use an idempotency key where supported.

```http
Idempotency-Key: <unique-operation-key>
```

For example:

```http
Idempotency-Key: loan-application-20260815-000001
```

The exact header name and endpoint-level enforcement should follow the backend implementation.

### Timestamp Format

API timestamps should be represented as ISO 8601 UTC values:

```text
2026-08-15T20:00:00.000Z
```

### MongoDB Object IDs

Identifier examples use MongoDB ObjectId-compatible values:

```text
507f1f77bcf86cd799439011
```

---

# 🎯 LOAN MANAGEMENT

## Check Eligibility

```http
GET /api/loans/eligibility/:groupId
Authorization: Bearer {accessToken}
```

### Example

```http
GET /api/loans/eligibility/507f1f77bcf86cd799439011
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### Response

```json
{
  "success": true,
  "data": {
    "isEligible": true,
    "overallScore": 75.5,
    "maxLoanAmount": 50000,
    "rejectionReason": null,
    "components": {
      "contributionScore": 35,
      "participationScore": 25,
      "repaymentScore": 15,
      "riskScore": 10
    },
    "metadata": {
      "monthsActive": 6,
      "totalContributed": 20000,
      "completedLoans": 1,
      "onTimeRepaymentRate": 100
    }
  }
}
```

---

## Apply for Loan

```http
POST /api/loans/apply
Authorization: Bearer {accessToken}
Content-Type: application/json
Idempotency-Key: <unique-operation-key>
```

### Request

```json
{
  "groupId": "507f1f77bcf86cd799439011",
  "amount": 30000,
  "reason": "Business expansion",
  "idempotencyKey": "unique-key-123"
}
```

> **Implementation note:** If the backend standardizes idempotency through the `Idempotency-Key` HTTP header, prefer the header and omit `idempotencyKey` from the request body. If the endpoint contract currently requires the body field, send the value required by that implementation.

### Response — `201 Created`

```json
{
  "success": true,
  "message": "Loan application submitted successfully",
  "data": {
    "_id": "507f...",
    "user": "...",
    "group": "...",
    "amount": 30000,
    "status": "pending",
    "eligibilityScore": 75.5,
    "createdAt": "2026-08-15T20:00:00.000Z"
  }
}
```

---

## Approve Loan

Administrative operation.

```http
PUT /api/loans/:loanId/approve
Authorization: Bearer {adminAccessToken}
Content-Type: application/json
```

### Request

```json
{
  "interestRate": 5,
  "repaymentPeriodMonths": 6,
  "notes": "Approved for business expansion"
}
```

### Response

```json
{
  "success": true,
  "message": "Loan approved successfully",
  "data": {
    "_id": "507f...",
    "status": "approved"
  }
}
```

> Approval should be subject to the platform's authorization, workflow, validation, audit, and financial controls.

---

## Reject Loan

Administrative operation.

```http
PUT /api/loans/:loanId/reject
Authorization: Bearer {adminAccessToken}
Content-Type: application/json
```

### Request

```json
{
  "reason": "Insufficient contribution history"
}
```

### Response

```json
{
  "success": true,
  "message": "Loan rejected",
  "data": {
    "_id": "507f...",
    "status": "rejected"
  }
}
```

---

## Disburse Loan

Administrative operation.

```http
PUT /api/loans/:loanId/disburse
Authorization: Bearer {adminAccessToken}
Content-Type: application/json
```

### Request

```json
{
  "paymentMethod": "bank_transfer",
  "notes": "Transferred to user account"
}
```

### Response

```json
{
  "success": true,
  "message": "Loan disbursed successfully",
  "data": {
    "loan": {
      "...": "loan details"
    },
    "schedule": {
      "installments": [],
      "totalAmount": 30000,
      "interestRate": 5,
      "status": "active"
    }
  }
}
```

> Loan disbursement is a financially significant operation and should be protected by authorization, idempotency, audit logging, state validation, and the platform's financial transaction controls.

---

## Make Payment

```http
PUT /api/loans/:loanId/pay
Authorization: Bearer {accessToken}
Content-Type: application/json
```

### Request

```json
{
  "amount": 5500,
  "paymentMethod": "mobile_money",
  "notes": "Monthly payment"
}
```

### Response

```json
{
  "success": true,
  "message": "Payment recorded successfully",
  "data": {
    "loan": {
      "...": "updated loan"
    },
    "schedule": {
      "...": "updated schedule"
    },
    "paymentRecord": {
      "amount": 5500,
      "method": "mobile_money",
      "paidAt": "2026-08-15T20:00:00.000Z"
    }
  }
}
```

> Payment posting should be idempotent and must not result in duplicate financial entries when the same logical operation is retried.

---

## Get Loan Details

```http
GET /api/loans/:loanId
Authorization: Bearer {accessToken}
```

### Response

```json
{
  "success": true,
  "data": {
    "loan": {
      "_id": "...",
      "user": {
        "name": "Justine Robert",
        "email": "justine@titech.com",
        "phone": "+256700000000"
      },
      "group": {
        "name": "Example Community Group"
      },
      "amount": 30000,
      "status": "disbursed",
      "interestRate": 5,
      "repaymentPeriodMonths": 6,
      "approvedBy": {
        "name": "Justine Robert",
        "email": "justine@titech.com"
      }
    },
    "schedule": {
      "installments": [],
      "totalPaid": 5500,
      "outstandingAmount": 24500
    }
  }
}
```

---

# 👨‍💼 ADMIN DASHBOARD

Administrative endpoints require an authenticated administrator.

## Dashboard Metrics

```http
GET /api/admin/dashboard
Authorization: Bearer {adminAccessToken}
```

### Response

```json
{
  "success": true,
  "data": {
    "users": {
      "total": 250,
      "verified": 200,
      "unverified": 50
    },
    "groups": {
      "total": 15,
      "active": 12
    },
    "contributions": {
      "total": 500000,
      "count": 1200
    },
    "loans": {
      "total": 45,
      "disbursed": 15,
      "disbursedAmount": 300000,
      "repaid": 20,
      "defaulted": 2,
      "pending": 8,
      "defaultRate": "4.44%"
    }
  }
}
```

---

## List Users

```http
GET /api/admin/users?status=all&search=Justine&skip=0&limit=20
Authorization: Bearer {adminAccessToken}
```

### Response

```json
{
  "success": true,
  "count": 20,
  "total": 250,
  "data": [
    {
      "_id": "...",
      "name": "Justine Robert",
      "email": "justine@titech.com",
      "phone": "+256700000000",
      "role": "user",
      "isVerified": true,
      "createdAt": "2026-08-01T10:00:00.000Z"
    }
  ]
}
```

---

## User Details

```http
GET /api/admin/users/:userId
Authorization: Bearer {adminAccessToken}
```

### Response

```json
{
  "success": true,
  "data": {
    "user": {
      "...": "user details"
    },
    "activity": {
      "groups": 3,
      "loans": 2,
      "contributions": 12
    },
    "recentActivity": [
      "...audit logs"
    ]
  }
}
```

---

## Verify User

```http
PUT /api/admin/users/:userId/verify
Authorization: Bearer {adminAccessToken}
```

### Response

```json
{
  "success": true,
  "message": "User verified successfully"
}
```

---

## Suspend User

```http
PUT /api/admin/users/:userId/suspend
Authorization: Bearer {adminAccessToken}
Content-Type: application/json
```

### Request

```json
{
  "reason": "Multiple fraud attempts"
}
```

### Response

```json
{
  "success": true,
  "message": "User suspended successfully"
}
```

---

## Loan Risk Overview

```http
GET /api/admin/loan-risk
Authorization: Bearer {adminAccessToken}
```

### Response

```json
{
  "success": true,
  "data": {
    "atRisk": {
      "count": 3,
      "totalAmount": 45000
    },
    "approachingMaturity": 5,
    "defaultAnalysis": {
      "count": 2,
      "totalAmount": 20000,
      "avgAmount": 10000
    }
  }
}
```

---

## Audit Log

```http
GET /api/admin/audit-log?action=loan_approved&skip=0&limit=50
Authorization: Bearer {adminAccessToken}
```

### Response

```json
{
  "success": true,
  "count": 20,
  "total": 150,
  "data": [
    {
      "_id": "...",
      "action": "loan_approved",
      "user": {
        "name": "Justine Robert",
        "email": "justine@titech.com"
      },
      "actor": {
        "name": "Justine Robert",
        "email": "justine@titech.com",
        "role": "admin"
      },
      "description": "Loan approved: 30000, 5% interest, 6 months",
      "amount": 30000,
      "changes": {
        "before": {},
        "after": {}
      },
      "createdAt": "2026-08-15T20:00:00.000Z"
    }
  ]
}
```

> Audit records should be treated as append-oriented evidence. Financially material historical records should not be silently overwritten.

---

# 💬 CHAT

## Send Message

```http
POST /api/chat/:groupId
Authorization: Bearer {accessToken}
Content-Type: application/json
```

### Request

```json
{
  "message": "How are we progressing with savings?",
  "messageType": "text"
}
```

### Response

```json
{
  "success": true,
  "data": {
    "_id": "...",
    "group": "...",
    "sender": {
      "name": "Justine Robert",
      "email": "justine@titech.com"
    },
    "message": "How are we progressing with savings?",
    "messageType": "text",
    "readBy": [],
    "reactions": [],
    "createdAt": "2026-08-15T20:00:00.000Z"
  }
}
```

---

## Get Group Messages

```http
GET /api/chat/:groupId?skip=0&limit=50
Authorization: Bearer {accessToken}
```

### Response

```json
{
  "success": true,
  "count": 50,
  "total": 150,
  "data": [
    "...messages"
  ]
}
```

---

## Mark as Read

```http
PUT /api/chat/message/:messageId/read
Authorization: Bearer {accessToken}
```

### Response

```json
{
  "success": true,
  "data": {
    "...": "message with updated readBy"
  }
}
```

---

## Add Reaction

```http
POST /api/chat/message/:messageId/reaction
Authorization: Bearer {accessToken}
Content-Type: application/json
```

### Request

```json
{
  "emoji": "👍"
}
```

### Response

```json
{
  "success": true,
  "data": {
    "...": "message with reactions updated"
  }
}
```

---

## Flag Message

```http
POST /api/chat/message/:messageId/flag
Authorization: Bearer {accessToken}
Content-Type: application/json
```

### Request

```json
{
  "reason": "Inappropriate language"
}
```

### Response

```json
{
  "success": true,
  "data": {
    "...": "message with flag recorded"
  }
}
```

---

## Hide Message — Admin

```http
PUT /api/chat/message/:messageId/hide
Authorization: Bearer {adminAccessToken}
Content-Type: application/json
```

### Request

```json
{
  "reason": "Violates community guidelines"
}
```

### Response

```json
{
  "success": true,
  "data": {
    "...": "message with isHidden: true"
  }
}
```

---

# 🤝 REFERRAL

## Generate Code

```http
POST /api/referrals/generate
Authorization: Bearer {accessToken}
```

### Response

```json
{
  "success": true,
  "data": {
    "referralCode": "REF-A1B2C3D4-1FABC9X",
    "expiresAt": "2026-11-15T20:00:00.000Z",
    "shareUrl": "https://app.example.com/join?ref=REF-A1B2C3D4-1FABC9X"
  }
}
```

---

## Get My Code

```http
GET /api/referrals/my-code
Authorization: Bearer {accessToken}
```

### Response

```json
{
  "success": true,
  "data": {
    "referralCode": "REF-A1B2C3D4-1FABC9X",
    "expiresAt": "2026-11-15T20:00:00.000Z"
  }
}
```

---

## Use Referral Code

```http
POST /api/referrals/use
Content-Type: application/json
```

### Request

```json
{
  "referralCode": "REF-A1B2C3D4-1FABC9X"
}
```

> This operation may be invoked during or immediately after the applicable registration/onboarding workflow, depending on the implemented signup flow.

### Response

```json
{
  "success": true,
  "message": "Referral code accepted"
}
```

---

## Pending Referrals

```http
GET /api/referrals/pending
Authorization: Bearer {accessToken}
```

### Response

```json
{
  "success": true,
  "data": [
    {
      "_id": "...",
      "referralCode": "...",
      "referee": {
        "name": "Example User",
        "email": "user@example.com"
      },
      "status": "pending",
      "expiresAt": "2026-11-15T20:00:00.000Z"
    }
  ]
}
```

---

## Completed Referrals

```http
GET /api/referrals/completed
Authorization: Bearer {accessToken}
```

### Response

```json
{
  "success": true,
  "data": [
    {
      "_id": "...",
      "referee": {
        "name": "Example User",
        "email": "user@example.com"
      },
      "status": "completed",
      "rewardAmount": 500,
      "rewardType": "bonus_credit",
      "rewardIssuedAt": "2026-08-01T10:00:00.000Z"
    }
  ]
}
```

---

## Referral Rewards

```http
GET /api/referrals/rewards
Authorization: Bearer {accessToken}
```

### Response

```json
{
  "success": true,
  "data": {
    "totalRewards": 2500,
    "completedCount": 5,
    "rewardType": "bonus_credit"
  }
}
```

---

# 🔒 SECURITY & OPERATIONS

## Health Check

```http
GET /api/health
```

### Response

```json
{
  "success": true,
  "message": "API is healthy",
  "timestamp": "2026-08-15T20:00:00.000Z",
  "uptime": 3600
}
```

> The health endpoint should remain lightweight and suitable for load balancer or service-level availability checks.

---

## Readiness Check

Where implemented:

```http
GET /api/ready
```

Recommended semantics:

* Return success only when required application dependencies are ready.
* Dependency state may include database, Redis, queue infrastructure, or other mandatory runtime services.
* A service that is alive but not ready should not receive normal application traffic.

Example:

```json
{
  "success": true,
  "status": "ready",
  "timestamp": "2026-08-15T20:00:00.000Z"
}
```

---

## Liveness Check

Where implemented:

```http
GET /api/live
```

Example:

```json
{
  "success": true,
  "status": "alive",
  "timestamp": "2026-08-15T20:00:00.000Z"
}
```

---

## Metrics

Where enabled:

```http
GET /api/metrics
```

### Response

Prometheus exposition format:

```text
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",status="200"} 1234
```

> Metrics endpoints should be protected from unauthorized public exposure in environments where they contain operational or infrastructure-sensitive information.

---

# 📋 STANDARD ERROR RESPONSES

The API uses a consistent response envelope for application errors.

## 400 Bad Request

```json
{
  "success": false,
  "message": "Invalid group ID"
}
```

Typical causes:

* Invalid request body.
* Invalid identifier format.
* Missing required field.
* Invalid parameter value.

---

## 401 Unauthorized

```json
{
  "success": false,
  "message": "No token provided, authorization denied"
}
```

Typical causes:

* Missing access token.
* Invalid access token.
* Expired access token.
* Authentication failure.

---

## 403 Forbidden

```json
{
  "success": false,
  "message": "Only admins can approve loans"
}
```

Typical causes:

* Authenticated user lacks required privileges.
* Resource-level authorization failure.
* Administrative role requirement not satisfied.

---

## 404 Not Found

```json
{
  "success": false,
  "message": "Loan not found"
}
```

Typical causes:

* Resource does not exist.
* Resource is not accessible within the authenticated scope.

---

## 409 Conflict

```json
{
  "success": false,
  "message": "You already have a pending or active loan in this group"
}
```

Typical causes:

* Duplicate logical operation.
* Invalid state transition.
* Existing conflicting resource.
* Idempotency conflict.

---

## 422 Unprocessable Entity

Where implemented:

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "field": "amount",
      "message": "Amount must be greater than zero"
    }
  ]
}
```

Use `422` for structurally valid requests that fail domain or validation rules when the backend contract defines this status.

---

## 429 Too Many Requests

```json
{
  "success": false,
  "message": "Too many requests from this IP, please try again after 15 minutes"
}
```

Clients should respect server-provided retry guidance when available.

---

## 500 Internal Server Error

```json
{
  "success": false,
  "message": "Internal server error"
}
```

Production responses should not expose:

* Stack traces.
* Database credentials.
* Access tokens.
* Internal secrets.
* Provider credentials.
* Private infrastructure details.

---

# 🔁 IDEMPOTENCY & RETRIES

Financial and externally integrated operations can be retried by clients, gateways, queues, or infrastructure.

Clients should therefore assume that network failures do not necessarily mean the original operation failed.

### Recommended Pattern

```http
POST /api/loans/apply
Authorization: Bearer {accessToken}
Idempotency-Key: 3c0f7d3d-8f6b-4f55-a576-6f770e9f3a0e
Content-Type: application/json
```

The client should reuse the same idempotency key when retrying the same logical operation.

Do not create a new idempotency key for a retry of the same transaction unless the operation is intentionally being submitted as a new transaction.

---

# 📄 PAGINATION CONVENTIONS

List endpoints may support:

```text
skip=0
limit=20
```

Example:

```http
GET /api/admin/users?skip=0&limit=20
```

Where supported, responses may include:

```json
{
  "success": true,
  "count": 20,
  "total": 250,
  "data": []
}
```

Clients should:

* Treat `limit` as server-constrained.
* Avoid requesting unnecessarily large result sets.
* Follow the server's maximum page size.
* Preserve filtering and sorting parameters between pages.

---

# 🧭 API RESPONSE ENVELOPE

Successful responses generally follow:

```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": {}
}
```

Collection responses may additionally include:

```json
{
  "success": true,
  "count": 20,
  "total": 250,
  "data": []
}
```

Error responses generally follow:

```json
{
  "success": false,
  "message": "Human-readable error message"
}
```

Validation-capable implementations may additionally return:

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": []
}
```

---

# 🧱 STATE & FINANCIAL SAFETY

The following principles apply to financially significant API operations:

1. Financial operations must not rely solely on client-side validation.
2. Authorization must be enforced by the backend.
3. Duplicate submissions must be controlled through idempotency.
4. Financial state transitions must be validated server-side.
5. Financially material changes should be auditable.
6. Historical financial records should not be mutated to conceal or overwrite prior activity.
7. Balance changes should be performed through the platform's financial/ledger controls rather than direct client-controlled balance mutation.
8. Provider callbacks and asynchronous payment events should be treated as replayable and potentially duplicated.
9. Retry handling must not create duplicate financial postings.
10. Sensitive operational information must not be returned to untrusted clients.

---

# 🛡️ CLIENT SECURITY GUIDANCE

Never include the following in client logs, browser URLs, analytics payloads, or error reports:

```text
Access tokens
Refresh tokens
API secrets
Provider credentials
Database credentials
Private keys
Webhook signing secrets
Payment provider OAuth secrets
```

Prefer redaction such as:

```text
Authorization: Bearer [REDACTED]
```

---

# 🚀 QUICK START EXAMPLE

The following sequence demonstrates a typical loan workflow.

## 1. Check Eligibility

```bash
curl -X GET \
  "http://localhost:5000/api/loans/eligibility/groupId" \
  -H "Authorization: Bearer token"
```

---

## 2. Apply for Loan

```bash
curl -X POST \
  "http://localhost:5000/api/loans/apply" \
  -H "Authorization: Bearer token" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: loan-application-001" \
  -d '{
    "groupId": "...",
    "amount": 30000,
    "reason": "Business expansion"
  }'
```

---

## 3. Admin Approves Loan

```bash
curl -X PUT \
  "http://localhost:5000/api/loans/loanId/approve" \
  -H "Authorization: Bearer adminToken" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: loan-approval-001" \
  -d '{
    "interestRate": 5,
    "repaymentPeriodMonths": 6,
    "notes": "Approved for business expansion"
  }'
```

---

## 4. Disburse Loan

```bash
curl -X PUT \
  "http://localhost:5000/api/loans/loanId/disburse" \
  -H "Authorization: Bearer adminToken" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: loan-disbursement-001" \
  -d '{
    "paymentMethod": "mobile_money",
    "notes": "Loan disbursement"
  }'
```

---

## 5. Make Payment

```bash
curl -X PUT \
  "http://localhost:5000/api/loans/loanId/pay" \
  -H "Authorization: Bearer token" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: loan-payment-001" \
  -d '{
    "amount": 5500,
    "paymentMethod": "mobile_money",
    "notes": "Monthly payment"
  }'
```

---

## 6. Retrieve Loan

```bash
curl -X GET \
  "http://localhost:5000/api/loans/loanId" \
  -H "Authorization: Bearer token"
```

---

# 🧪 CURL ENVIRONMENT VARIABLES

For repeated testing, define:

```bash
export API_BASE_URL="http://localhost:5000"
export ACCESS_TOKEN="your-access-token"
export ADMIN_TOKEN="your-admin-access-token"
```

Then:

```bash
curl -X GET \
  "${API_BASE_URL}/api/health"
```

Authenticated request:

```bash
curl -X GET \
  "${API_BASE_URL}/api/loans/loanId" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}"
```

Administrative request:

```bash
curl -X GET \
  "${API_BASE_URL}/api/admin/dashboard" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}"
```

---

# 🔍 API TROUBLESHOOTING

## Authentication Failure

Check:

```text
Authorization header
Access-token validity
Token expiration
User authorization
API host and port
```

Expected format:

```http
Authorization: Bearer <token>
```

---

## Validation Failure

Verify:

```text
Required request fields
ObjectId format
Numeric fields
Enumerated values
Date formats
Business/domain constraints
```

---

## 403 Authorization Failure

Verify that the authenticated user has the required role and permissions.

For example:

```text
User operation -> authenticated member
Administrative operation -> administrator
```

Do not attempt to solve authorization failures by bypassing backend checks.

---

## 409 Conflict

Check for:

```text
Existing pending operation
Existing active loan
Duplicate logical submission
Invalid resource state
Idempotency conflict
```

A `409` should normally be investigated before retrying the same business operation with a new request.

---

## 429 Rate Limit

Clients should:

1. Respect the server's rate-limit policy.
2. Use exponential backoff for retryable operations.
3. Avoid aggressive concurrent retry loops.
4. Preserve idempotency keys for repeated attempts of the same operation.

---

# 🏭 PRODUCTION INTEGRATION CHECKLIST

Before integrating a client with the production API, verify:

* Authentication uses HTTPS.
* Access tokens are stored securely.
* Tokens are never written to logs.
* Administrative operations use the required privileges.
* Financial mutations use the required idempotency mechanism.
* Retries preserve logical-operation identity.
* Client timeouts are configured.
* `429` responses are handled gracefully.
* `5xx` responses are treated as potentially transient unless the endpoint contract says otherwise.
* Error messages are surfaced without exposing sensitive internals.
* Pagination is implemented for large collections.
* Request identifiers are propagated where supported.
* API responses are validated against the actual deployed contract.
* Deprecated/legacy headers are only used where still supported.

---

# 📚 RELATED API AREAS

This quick-start reference should be used alongside the platform's deeper documentation for:

```text
Authentication & Authorization
Tenant / SaaS Context
User & Membership Management
Group Management
Contributions & Savings
Loan Management
Payments & Payment Rails
Financial Ledger
Reconciliation
Statements
Compliance
KYC / AML
Notifications
Audit & Security
Observability
Webhooks / Callbacks
Administrative Operations
```

The detailed API catalogue should remain the authoritative source for endpoint ownership, request schemas, response schemas, state transitions, security requirements, and versioning.

---

# ⚠️ CONTRACT OWNERSHIP & VERSIONING

This document is a quick-start reference, not a substitute for endpoint-level contract specifications.

When an implementation differs from an illustrative example in this document, the deployed and versioned API contract takes precedence.

API changes should follow the platform's change-management rules, including:

* Backward-compatibility assessment.
* Explicit versioning where required.
* Deprecation notice before removal.
* Security review for authentication/authorization changes.
* Financial-impact review for transaction-related changes.
* Integration and regression testing.
* Documentation updates.

Breaking changes must not be introduced silently into an existing production API contract.

---

# ✅ QUICK REFERENCE

| Area                | Method | Endpoint                                | Access                   |
| ------------------- | ------ | --------------------------------------- | ------------------------ |
| Eligibility         | `GET`  | `/api/loans/eligibility/:groupId`       | Authenticated            |
| Loan Application    | `POST` | `/api/loans/apply`                      | Authenticated            |
| Approve Loan        | `PUT`  | `/api/loans/:loanId/approve`            | Admin                    |
| Reject Loan         | `PUT`  | `/api/loans/:loanId/reject`             | Admin                    |
| Disburse Loan       | `PUT`  | `/api/loans/:loanId/disburse`           | Admin                    |
| Pay Loan            | `PUT`  | `/api/loans/:loanId/pay`                | Authenticated            |
| Loan Details        | `GET`  | `/api/loans/:loanId`                    | Authenticated            |
| Admin Dashboard     | `GET`  | `/api/admin/dashboard`                  | Admin                    |
| Users               | `GET`  | `/api/admin/users`                      | Admin                    |
| User Details        | `GET`  | `/api/admin/users/:userId`              | Admin                    |
| Verify User         | `PUT`  | `/api/admin/users/:userId/verify`       | Admin                    |
| Suspend User        | `PUT`  | `/api/admin/users/:userId/suspend`      | Admin                    |
| Loan Risk           | `GET`  | `/api/admin/loan-risk`                  | Admin                    |
| Audit Log           | `GET`  | `/api/admin/audit-log`                  | Admin                    |
| Send Chat           | `POST` | `/api/chat/:groupId`                    | Authenticated            |
| Group Messages      | `GET`  | `/api/chat/:groupId`                    | Authenticated            |
| Mark Message Read   | `PUT`  | `/api/chat/message/:messageId/read`     | Authenticated            |
| Reaction            | `POST` | `/api/chat/message/:messageId/reaction` | Authenticated            |
| Flag Message        | `POST` | `/api/chat/message/:messageId/flag`     | Authenticated            |
| Hide Message        | `PUT`  | `/api/chat/message/:messageId/hide`     | Admin                    |
| Generate Referral   | `POST` | `/api/referrals/generate`               | Authenticated            |
| My Referral Code    | `GET`  | `/api/referrals/my-code`                | Authenticated            |
| Use Referral        | `POST` | `/api/referrals/use`                    | Public / Signup Flow     |
| Pending Referrals   | `GET`  | `/api/referrals/pending`                | Authenticated            |
| Completed Referrals | `GET`  | `/api/referrals/completed`              | Authenticated            |
| Referral Rewards    | `GET`  | `/api/referrals/rewards`                | Authenticated            |
| Health              | `GET`  | `/api/health`                           | Public / Operational     |
| Readiness           | `GET`  | `/api/ready`                            | Operational              |
| Liveness            | `GET`  | `/api/live`                             | Operational              |
| Metrics             | `GET`  | `/api/metrics`                          | Operational / Restricted |

---

# 📌 DOCUMENT METADATA

**Document:** `docs/api/API_REFERENCE_QUICK_START.md`
**Platform:** TITech Community Capital Ltd — Community Savings Platform
**API Version:** `2.0`
**Status:** Production Reference
**Last Updated:** `August 15, 2026`

**Primary Example User**

```text
Name: Justine Robert
Email: justine@titech.com
```

**Important:** The endpoint examples in this quick-start document should be kept synchronized with the actual mounted routes, middleware, validation schemas, authorization rules, and deployed API version.