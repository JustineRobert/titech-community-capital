# Community Savings App Backend — API Catalogue

**TITech Community Capital Ltd**
**System:** Community Savings Platform Backend
**Document:** `docs/api/API_CATALOGUE.md`
**API Contract:** Production-Grade Catalogue
**API Base Prefix:** `/api`
**Default Port:** `5000`
**Document Status:** Production Reference
**Last Updated:** August 16, 2026

---

## 1. Purpose

This document is the central API catalogue for the TITech Community Capital Ltd Community Savings App backend.

It provides a production-oriented inventory of API domains, endpoint families, HTTP methods, access requirements, lifecycle expectations, security controls, observability requirements, and operational conventions.

This document is intended to provide a single navigation point across the backend API surface.

It should be maintained together with:

* `docs/api/API_REFERENCE_QUICK_START.md`
* `docs/api/BACKEND_API_SPECIFICATION.md`
* `docs/02-architecture/SERVICE_CATALOGUE.md`
* `docs/02-architecture/DEPENDENCY_MAP.md`
* `docs/02-architecture/EVENT_CATALOGUE.md`
* `docs/data/DATA_MODEL_CATALOGUE.md`
* Financial ledger specifications
* Transaction state machine specifications
* Security and compliance documentation

> **Authoritative contract rule:** The deployed route registration, middleware, validation schema, controller/service implementation, and versioned API contract are authoritative at runtime. This catalogue is the architectural inventory and must be kept synchronized with the implementation.

---

# 2. API Design Principles

The backend API is designed around the following principles:

1. **Secure by default**
2. **Authentication and authorization enforced server-side**
3. **Tenant isolation enforced server-side**
4. **Financial operations are immutable and auditable**
5. **Idempotency for retry-sensitive operations**
6. **Explicit state transitions**
7. **Consistent response and error envelopes**
8. **Centralized validation**
9. **Structured observability**
10. **Backward-compatible evolution**
11. **Graceful degradation where appropriate**
12. **No direct balance mutation outside the financial engine**
13. **No silent breaking API changes**
14. **Production-safe operational controls**

---

# 3. Runtime Configuration

## Development

Start the development server with automatic restarts:

```bash
nodemon server.js
```

This uses the repository's `nodemon.json` configuration where present.

Typical development settings may include:

* Automatic restart on source changes
* Restart delay to avoid rapid restart loops
* Increased Node.js heap size for large development workloads
* Development logging
* Local service configuration

Example:

```bash
npm run dev
```

where the repository's `package.json` maps the command to the appropriate development process.

---

# 4. Production Runtime

For a direct Node.js production process:

```bash
node server.js
```

Recommended production deployments should normally execute the backend under the platform's process supervisor, container runtime, orchestration platform, or managed service rather than relying on an interactive shell.

Examples include:

```text
Docker
Kubernetes
systemd
PM2
Managed container runtime
```

The selected runtime must provide:

* Automatic restart
* Health checking
* Log collection
* Resource limits
* Graceful termination
* Secret injection
* Configuration management

---

# 5. API Base URL

Default local origin:

```text
http://localhost:5000
```

API prefix:

```text
/api
```

Example:

```text
GET http://localhost:5000/api/loans/:loanId
```

Production deployments should use the configured public API origin.

Example:

```text
https://api.<production-domain>/api/...
```

Do not hard-code production domains in source code.

---

# 6. Authentication

## Bearer Authentication

Preferred authentication mechanism:

```http
Authorization: Bearer <accessToken>
```

Legacy compatibility may support:

```http
x-auth-token: <accessToken>
```

Clients should prefer the standard `Authorization` header.

---

## Authentication Requirements

Protected endpoints should verify:

* Access token presence
* Token signature
* Token expiration
* Token issuer where configured
* Token audience where configured
* User status
* Tenant context
* Required claims
* Revocation/session state where supported

---

# 7. Authorization Model

API authorization should be based on both:

```text
Identity
+
Permission
+
Tenant scope
+
Resource ownership
+
Resource state
```

Typical authorization levels include:

| Access Level  | Description                                        |
| ------------- | -------------------------------------------------- |
| `PUBLIC`      | Unauthenticated public resources                   |
| `USER`        | Authenticated standard user                        |
| `MEMBER`      | Authenticated tenant/group member                  |
| `MODERATOR`   | Community moderation privileges                    |
| `ADMIN`       | Administrative privileges                          |
| `FINANCE`     | Financial operational privileges where configured  |
| `COMPLIANCE`  | Compliance operational privileges where configured |
| `SERVICE`     | Internal service-to-service identity               |
| `SUPER_ADMIN` | Restricted platform-level administration           |

Do not assume an authenticated user automatically has administrative privileges.

---

# 8. Multi-Tenant API Context

The platform is designed as a multi-tenant SaaS environment.

Tenant context must be established by trusted backend mechanisms.

Examples:

```text
JWT tenant claims
Validated tenant session
Trusted service context
Tenant middleware
```

The API must never rely solely on a user-supplied tenant identifier to establish authorization scope.

Every tenant-scoped resource query must apply tenant isolation.

Example logical rule:

```text
WHERE tenantId = authenticatedTenantId
```

The actual persistence implementation may use MongoDB filters, relational predicates, repository policies, or another compatible mechanism.

---

# 9. API Request Standards

## Content Type

JSON requests:

```http
Content-Type: application/json
```

Multipart requests:

```http
Content-Type: multipart/form-data
```

---

## Request ID

Clients may provide:

```http
X-Request-ID: <request-id>
```

If absent, the server should generate one.

The request ID should be propagated into:

```text
HTTP logs
Application logs
Audit logs
Tracing
Error responses
Metrics correlation
```

---

## Idempotency

Retry-sensitive operations should support:

```http
Idempotency-Key: <unique-operation-key>
```

Recommended for:

* Loan application
* Loan approval
* Loan disbursement
* Loan payment
* Financial operations
* Payment initiation
* Referral creation
* Content creation
* Moderation actions
* Callback processing
* Provider settlement operations

A retry of the same logical operation should reuse the same idempotency key.

---

# 10. Response Standards

## Successful Response

```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": {},
  "requestId": "req_..."
}
```

## Collection Response

```json
{
  "success": true,
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "pages": 5,
    "hasNext": true,
    "hasPrevious": false
  },
  "requestId": "req_..."
}
```

## Error Response

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request",
    "details": {}
  },
  "requestId": "req_..."
}
```

---

# 11. HTTP Status Catalogue

| HTTP Status | Meaning                                      |
| ----------: | -------------------------------------------- |
|       `200` | Successful request                           |
|       `201` | Resource successfully created                |
|       `202` | Request accepted for asynchronous processing |
|       `204` | Successful request with no response body     |
|       `400` | Invalid request                              |
|       `401` | Authentication required/failed               |
|       `403` | Insufficient authorization                   |
|       `404` | Resource not found                           |
|       `409` | Resource/state conflict                      |
|       `413` | Payload too large                            |
|       `415` | Unsupported media type                       |
|       `422` | Domain validation failure                    |
|       `429` | Rate limit exceeded                          |
|       `500` | Unexpected server failure                    |
|       `502` | Upstream provider failure                    |
|       `503` | Service temporarily unavailable              |
|       `504` | Upstream timeout                             |

---

# 12. API Domain Catalogue

The backend API is organized into the following major domains.

| Domain         | Primary Responsibility                        |
| -------------- | --------------------------------------------- |
| Authentication | Identity, login, tokens, sessions             |
| Users          | User lifecycle and profile management         |
| Tenant/SaaS    | Tenant context and platform tenancy           |
| Groups         | Community/SACCO group management              |
| Membership     | Group membership and roles                    |
| Contributions  | Savings/contribution operations               |
| Loans          | Loan lifecycle and repayment                  |
| Finance        | Financial engine and ledger-backed operations |
| Payments       | Payment initiation and provider integration   |
| Reconciliation | Settlement and financial matching             |
| Statements     | Statement ingestion and processing            |
| Compliance     | KYC, AML, regulatory operations               |
| Notifications  | Email, SMS, push and in-app messaging         |
| Chat           | Group/member messaging                        |
| Help Center    | Knowledge-base articles                       |
| FAQ            | Frequently asked questions                    |
| Forum          | Community discussions                         |
| Referrals      | Referral lifecycle and rewards                |
| Administration | Platform administrative operations            |
| Audit          | Security and operational audit records        |
| Health         | Service health/readiness/liveness             |
| Metrics        | Prometheus/observability metrics              |
| Callbacks      | External provider callbacks                   |
| Webhooks       | Event delivery integrations                   |
| Events         | Internal/domain event publication             |

---

# 13. Authentication API

## Endpoint Family

```text
/api/auth/*
```

Primary responsibilities:

```text
registration
login
logout
refresh token
password management
email verification
authentication state
session management
```

Representative endpoints:

| Method | Endpoint                    | Access                |
| ------ | --------------------------- | --------------------- |
| `POST` | `/api/auth/register`        | Public                |
| `POST` | `/api/auth/login`           | Public                |
| `POST` | `/api/auth/logout`          | Authenticated         |
| `POST` | `/api/auth/refresh`         | Authenticated/session |
| `POST` | `/api/auth/forgot-password` | Public                |
| `POST` | `/api/auth/reset-password`  | Public/token          |
| `GET`  | `/api/auth/me`              | Authenticated         |
| `POST` | `/api/auth/verify-email`    | Authenticated/token   |

Authentication mutations must be protected against:

```text
credential stuffing
brute force
token replay
session fixation
account enumeration
rate-limit bypass
```

---

# 14. User API

## Endpoint Family

```text
/api/users/*
```

Responsibilities:

```text
profile
preferences
verification status
account status
membership context
user settings
```

Representative endpoints:

| Method  | Endpoint                      | Access        |
| ------- | ----------------------------- | ------------- |
| `GET`   | `/api/users/me`               | Authenticated |
| `PUT`   | `/api/users/me`               | Authenticated |
| `PATCH` | `/api/users/me`               | Authenticated |
| `GET`   | `/api/users/:userId`          | Authorized    |
| `PUT`   | `/api/users/:userId/status`   | Admin         |
| `GET`   | `/api/users/:userId/activity` | Authorized    |

---

# 15. Tenant / SaaS API

## Endpoint Family

```text
/api/tenants/*
/api/saas/*
```

Responsibilities:

```text
tenant registration
tenant configuration
tenant status
subscription context
plan management
tenant administrators
tenant isolation
```

Representative endpoints:

| Method | Endpoint                        | Access                |
| ------ | ------------------------------- | --------------------- |
| `POST` | `/api/tenants`                  | Authorized/onboarding |
| `GET`  | `/api/tenants/current`          | Tenant Admin          |
| `PUT`  | `/api/tenants/current`          | Tenant Admin          |
| `GET`  | `/api/tenants/current/settings` | Tenant Admin          |
| `GET`  | `/api/saas/plans`               | Public/Auth           |
| `GET`  | `/api/saas/subscription`        | Tenant Admin          |
| `POST` | `/api/saas/subscription`        | Tenant Admin          |
| `PUT`  | `/api/saas/subscription`        | Tenant Admin          |

---

# 16. Group API

## Endpoint Family

```text
/api/groups/*
```

Responsibilities:

```text
group creation
group details
group settings
membership
group administration
group financial configuration
```

Representative endpoints:

| Method   | Endpoint                       | Access               |
| -------- | ------------------------------ | -------------------- |
| `POST`   | `/api/groups`                  | Authenticated        |
| `GET`    | `/api/groups`                  | Authenticated        |
| `GET`    | `/api/groups/:groupId`         | Member               |
| `PUT`    | `/api/groups/:groupId`         | Group Admin          |
| `DELETE` | `/api/groups/:groupId`         | Group Admin/Platform |
| `GET`    | `/api/groups/:groupId/members` | Member/Admin         |

---

# 17. Contribution API

## Endpoint Family

```text
/api/contributions/*
```

Responsibilities:

```text
savings contributions
contribution history
contribution summaries
member contribution status
```

Representative endpoints:

| Method | Endpoint                                    | Access       |
| ------ | ------------------------------------------- | ------------ |
| `POST` | `/api/contributions`                        | Member       |
| `GET`  | `/api/contributions`                        | Member/Admin |
| `GET`  | `/api/contributions/:contributionId`        | Authorized   |
| `GET`  | `/api/groups/:groupId/contributions`        | Member/Admin |
| `GET`  | `/api/groups/:groupId/contribution-summary` | Member/Admin |

Financial posting must pass through the financial engine rather than direct balance mutation.

---

# 18. Loan API

## Endpoint Family

```text
/api/loans/*
```

Primary loan lifecycle:

```text
eligibility
application
review
approval
rejection
disbursement
repayment
completion
default
write-off
reversal
```

Representative endpoints:

| Method | Endpoint                          | Access         |
| ------ | --------------------------------- | -------------- |
| `GET`  | `/api/loans/eligibility/:groupId` | Authenticated  |
| `POST` | `/api/loans/apply`                | Member         |
| `GET`  | `/api/loans`                      | Authorized     |
| `GET`  | `/api/loans/:loanId`              | Authorized     |
| `PUT`  | `/api/loans/:loanId/approve`      | Admin/Finance  |
| `PUT`  | `/api/loans/:loanId/reject`       | Admin/Finance  |
| `PUT`  | `/api/loans/:loanId/disburse`     | Admin/Finance  |
| `PUT`  | `/api/loans/:loanId/pay`          | Member/Finance |
| `GET`  | `/api/loans/:loanId/schedule`     | Authorized     |
| `GET`  | `/api/loans/:loanId/payments`     | Authorized     |

Loan operations must enforce state-machine rules.

Example:

```text
pending
  -> approved
  -> rejected

approved
  -> disbursed

disbursed
  -> active
  -> completed
  -> defaulted

defaulted
  -> written_off
```

No API client may directly assign arbitrary financial statuses.

---

# 19. Financial API

## Endpoint Family

```text
/api/finance/*
```

Responsibilities:

```text
accounts
journals
journal entries
transactions
balances
financial statements
reversals
period closing
interest accrual
write-offs
ledger integrity
```

Representative endpoint families:

```text
/api/finance/accounts
/api/finance/journals
/api/finance/transactions
/api/finance/balances
/api/finance/statements
/api/finance/reconciliation
```

Financial records must follow:

```text
double-entry principles
immutability
auditability
idempotent posting
reversal instead of destructive mutation
```

---

# 20. Payment API

## Endpoint Family

```text
/api/payments/*
```

Responsibilities:

```text
payment initiation
payment status
payment history
provider selection
payment confirmation
payment reversals where supported
```

Provider integrations may include:

```text
MTN MoMo
Airtel Money
Bank transfer
Other approved payment rails
```

Representative endpoints:

| Method | Endpoint                          | Access                     |
| ------ | --------------------------------- | -------------------------- |
| `POST` | `/api/payments`                   | Authenticated              |
| `GET`  | `/api/payments/:paymentId`        | Authorized                 |
| `GET`  | `/api/payments`                   | Authorized                 |
| `POST` | `/api/payments/:paymentId/retry`  | Authorized                 |
| `POST` | `/api/payments/:paymentId/cancel` | Authorized where permitted |

Payment endpoints must not trust client-provided final provider status.

---

# 21. Provider Callback API

## Endpoint Family

```text
/api/callbacks/*
/api/webhooks/*
```

Responsibilities:

```text
provider callback reception
signature validation
payload normalization
idempotency
replay detection
callback processing
settlement linkage
event publication
```

Provider-specific adapters may include:

```text
MTN MoMo
Airtel Money
Banking providers
```

Callbacks must support:

```text
signature verification
duplicate delivery
out-of-order delivery
retry delivery
unknown transaction handling
dead-letter handling
audit logging
```

---

# 22. Reconciliation API

## Endpoint Family

```text
/api/reconciliation/*
```

Responsibilities:

```text
provider settlement matching
statement matching
exception processing
reconciliation status
repair workflows
financial discrepancy investigation
```

Representative resources:

```text
reconciliation runs
reconciliation exceptions
matched records
unmatched records
repair instructions
```

---

# 23. Statement API

## Endpoint Family

```text
/api/statements/*
```

Responsibilities:

```text
statement upload/import
normalization
validation
batch processing
claim ownership
reconciliation
repair
processing status
```

Representative endpoints:

| Method | Endpoint                                 | Access        |
| ------ | ---------------------------------------- | ------------- |
| `POST` | `/api/statements`                        | Finance/Admin |
| `GET`  | `/api/statements/:statementId`           | Finance/Admin |
| `POST` | `/api/statements/:statementId/process`   | Finance/Admin |
| `GET`  | `/api/statements/:statementId/status`    | Finance/Admin |
| `POST` | `/api/statements/:statementId/reconcile` | Finance/Admin |

Concurrent workers must use safe claim/ownership semantics where batch processing is asynchronous.

---

# 24. Compliance API

## Endpoint Family

```text
/api/compliance/*
```

Responsibilities:

```text
KYC
AML
risk screening
regulatory validation
regulatory submission
compliance case management
```

Representative domains:

```text
/api/compliance/kyc/*
/api/compliance/aml/*
/api/compliance/risk/*
/api/compliance/regulatory/*
```

Compliance records must have restricted access and appropriate audit coverage.

---

# 25. Notification API

## Endpoint Family

```text
/api/notifications/*
```

Responsibilities:

```text
in-app notifications
email
SMS
push notifications
notification preferences
delivery status
```

Representative endpoints:

| Method | Endpoint                                  | Access        |
| ------ | ----------------------------------------- | ------------- |
| `GET`  | `/api/notifications`                      | Authenticated |
| `PUT`  | `/api/notifications/:notificationId/read` | Authenticated |
| `PUT`  | `/api/notifications/read-all`             | Authenticated |
| `GET`  | `/api/notifications/preferences`          | Authenticated |
| `PUT`  | `/api/notifications/preferences`          | Authenticated |

---

# 26. Chat API

## Endpoint Family

```text
/api/chat/*
```

Representative endpoints:

```text
POST /api/chat/:groupId
GET  /api/chat/:groupId
PUT  /api/chat/message/:messageId/read
POST /api/chat/message/:messageId/reaction
POST /api/chat/message/:messageId/flag
PUT  /api/chat/message/:messageId/hide
```

Access must enforce group membership and moderation privileges.

---

# 27. Help Center API

## Endpoint Family

```text
/api/help/*
```

Representative endpoints:

| Method   | Endpoint                           | Access      |
| -------- | ---------------------------------- | ----------- |
| `GET`    | `/api/help/articles`               | Public/Auth |
| `GET`    | `/api/help/search`                 | Public/Auth |
| `GET`    | `/api/help/articles/:id`           | Public/Auth |
| `GET`    | `/api/help/categories`             | Public      |
| `GET`    | `/api/help/articles/featured`      | Public      |
| `POST`   | `/api/help/articles/:id/helpful`   | Auth        |
| `POST`   | `/api/help/articles/:id/unhelpful` | Auth        |
| `POST`   | `/api/help/articles`               | Admin       |
| `PUT`    | `/api/help/articles/:id`           | Admin       |
| `DELETE` | `/api/help/articles/:id`           | Admin       |

Detailed contract:

```text
docs/api/BACKEND_API_SPECIFICATION.md
```

---

# 28. FAQ API

## Endpoint Family

```text
/api/faq/*
```

Representative endpoints:

```text
GET  /api/faq
GET  /api/faq/search
GET  /api/faq/categories
GET  /api/faq/popular
POST /api/faq/:id/helpful
POST /api/faq/:id/unhelpful
POST /api/faq
PUT  /api/faq/:id
POST /api/faq/bulk-import
```

Administrative FAQ operations must be audited.

---

# 29. Community Forum API

## Endpoint Family

```text
/api/forum/*
```

Representative endpoints:

```text
GET    /api/forum/topics
GET    /api/forum/topics/:id
POST   /api/forum/topics
PUT    /api/forum/topics/:id
DELETE /api/forum/topics/:id

GET    /api/forum/topics/:topicId/replies
POST   /api/forum/topics/:topicId/replies
PUT    /api/forum/topics/:topicId/replies/:replyId
DELETE /api/forum/topics/:topicId/replies/:replyId

POST   /api/forum/topics/:topicId/replies/:replyId/vote
DELETE /api/forum/topics/:topicId/replies/:replyId/vote

POST   /api/forum/topics/:topicId/replies/:replyId/mark-solution

POST   /api/forum/topics/:id/sticky
POST   /api/forum/topics/:id/lock

GET    /api/forum/categories
GET    /api/forum/stats
GET    /api/forum/search
GET    /api/forum/topics/recent
GET    /api/forum/topics/popular
GET    /api/forum/topics/trending

POST   /api/forum/topics/:id/follow
DELETE /api/forum/topics/:id/follow
GET    /api/forum/topics/following

POST   /api/forum/report
```

---

# 30. Referral API

## Endpoint Family

```text
/api/referrals/*
```

Representative endpoints:

```text
POST /api/referrals/generate
GET  /api/referrals/my-code
POST /api/referrals/use
GET  /api/referrals/pending
GET  /api/referrals/completed
GET  /api/referrals/rewards
```

Referral reward issuance must be idempotent and auditable.

---

# 31. Administration API

## Endpoint Family

```text
/api/admin/*
```

Representative endpoint families:

```text
/api/admin/dashboard
/api/admin/users
/api/admin/loan-risk
/api/admin/audit-log
/api/admin/content-reports
```

Administrative APIs must enforce:

```text
admin role
permission scope
tenant scope
audit logging
rate limiting
sensitive-action controls
```

---

# 32. Audit API

## Endpoint Family

```text
/api/audit/*
/api/admin/audit-log/*
```

Audit access should be restricted according to role and tenant scope.

Audit records should capture:

```text
actor
action
resource
tenant
requestId
timestamp
result
reason
before/after where appropriate
```

Sensitive secrets must be redacted.

---

# 33. Health & Operations API

## Health

```http
GET /api/health
```

Example:

```json
{
  "success": true,
  "message": "API is healthy",
  "timestamp": "2026-08-16T00:10:00.000Z",
  "uptime": 3600
}
```

---

## Readiness

Where implemented:

```http
GET /api/ready
```

Readiness should verify required runtime dependencies before traffic is accepted.

Potential dependencies:

```text
MongoDB
Redis
Queue infrastructure
Critical configuration
Required provider dependencies
```

---

## Liveness

Where implemented:

```http
GET /api/live
```

Liveness should answer whether the application process itself is functioning.

---

## Metrics

Where enabled:

```http
GET /api/metrics
```

Prometheus exposition format may include:

```text
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",status="200"} 1234
```

Metrics endpoints should be protected from inappropriate public exposure.

---

# 34. Endpoint State Catalogue

API resources that participate in business workflows must expose only valid state transitions.

## Loan

```text
pending
approved
rejected
disbursed
active
completed
defaulted
written_off
reversed
```

## Payment

```text
initiated
pending
processing
successful
failed
cancelled
reversed
```

## Statement Processing

```text
received
validated
claimed
processing
completed
failed
released
```

## Forum Topic

```text
open
locked
archived
deleted
```

## Moderation Report

```text
pending
reviewed
resolved
dismissed
```

No client should be able to bypass state-machine validation by sending arbitrary status values.

---

# 35. Financial API Safety Rules

Financial API endpoints have stricter requirements than ordinary CRUD endpoints.

Every financially material mutation must provide:

```text
Authentication
Authorization
Validation
Idempotency
Transaction context
Auditability
Concurrency protection
Ledger integration
Error handling
Observability
```

The backend must not allow API clients to directly update:

```text
account balance
ledger balance
available balance
journal totals
posted transaction amount
settled financial state
```

outside the approved financial engine.

A financial correction should normally be implemented through:

```text
reversal
adjustment
compensating entry
approved write-off
```

rather than destructive modification.

---

# 36. Retry Semantics

Clients must distinguish between:

```text
safe retry
unsafe retry
unknown outcome
permanent failure
```

For example:

```text
GET -> generally retryable
POST financial operation -> retry only with preserved idempotency key
payment callback -> safe to replay through idempotent processing
```

A `500`, timeout, or connection reset does not automatically mean a financial operation failed.

The client should first query operation state where an operation identifier is available.

---

# 37. Rate Limiting

Recommended baseline policies:

| Endpoint Class      |             Suggested Baseline |
| ------------------- | -----------------------------: |
| Public reads        |                      1000/hour |
| Authenticated reads |                      2000/hour |
| Writes              |                       100/hour |
| Search              |                       200/hour |
| Authentication      | Strict endpoint-specific limit |
| Financial mutations | Strict endpoint-specific limit |
| Provider callbacks  |      Provider-aware throttling |
| Admin operations    |                    50–100/hour |
| Bulk operations     |                    Very strict |

Rate limits should consider:

```text
IP
user
tenant
endpoint
operation
role
provider
```

A Redis-backed limiter should be preferred where the deployment architecture supports distributed rate limiting.

A memory-only fallback must have clearly understood multi-instance limitations.

---

# 38. API Security Requirements

The API layer should provide:

```text
Helmet/security headers
CORS enforcement
Content Security Policy where applicable
HSTS in HTTPS deployments
Request body size limits
Request timeout protection
Rate limiting
Authentication
Authorization
Tenant isolation
Input validation
Output sanitization
Secure cookies where used
Trust proxy configuration
Structured audit logging
Secret redaction
```

Never expose:

```text
JWT signing secrets
refresh-token secrets
database credentials
provider OAuth secrets
API keys
private keys
webhook signing secrets
internal stack traces
```

---

# 39. API Observability Requirements

Every request should be traceable through at least:

```text
requestId
traceId where tracing is enabled
tenantId where applicable
userId where applicable
route
method
status
latency
```

Recommended metrics:

```text
api_requests_total
api_request_errors_total
api_request_duration_seconds
api_rate_limit_exceeded_total
api_authentication_failures_total
api_authorization_failures_total
api_idempotency_replays_total
api_validation_failures_total
```

Financial operations should additionally expose domain-specific metrics through the finance/ledger observability layer.

---

# 40. Graceful Shutdown

The backend must respond to:

```text
SIGINT
SIGTERM
```

Graceful shutdown should:

1. Stop accepting new requests.
2. Allow in-flight requests to finish within a bounded timeout.
3. Stop scheduled/background work where appropriate.
4. Release queue ownership safely.
5. Close Redis connections.
6. Close database connections.
7. Flush logs/telemetry where supported.
8. Exit with an appropriate status.

Shutdown must not corrupt in-flight financial operations.

---

# 41. Port Management

Default port:

```text
5000
```

Configured through:

```bash
PORT=5000
```

Example:

```bash
PORT=5000 node server.js
```

The application should validate the configured port during startup.

---

# 42. EADDRINUSE Handling

The current development/runtime behavior may handle:

```text
EADDRINUSE
```

by retrying on the next available port where this behavior is intentionally configured.

Example development behavior:

```text
5000
  -> unavailable
5001
  -> unavailable
5002
  -> start
```

This behavior must not silently violate production infrastructure expectations.

For production deployments, the preferred approach is:

```text
fix the conflicting process
or
configure the expected externally managed port
```

Automated port shifting should not cause health checks, service discovery, reverse proxies, containers, or Kubernetes services to target the wrong port.

---

# 43. Development Commands

Typical development invocation:

```bash
nodemon server.js
```

or:

```bash
npm run dev
```

Typical production invocation:

```bash
node server.js
```

The exact `package.json` scripts remain authoritative.

---

# 44. API Documentation Standards

Every new API endpoint must document:

```text
HTTP method
route
purpose
authentication
authorization
tenant scope
request headers
path parameters
query parameters
request body
validation rules
success status
success response
error statuses
idempotency
audit requirements
rate-limit class
side effects
state transitions
observability
```

A new endpoint is incomplete until its documentation is updated.

---

# 45. API Change Management

Before introducing an API change:

```text
1. Identify affected consumers.
2. Determine whether the change is backward compatible.
3. Update validation.
4. Update tests.
5. Update documentation.
6. Update observability.
7. Update security rules.
8. Update relevant service/catalogue documents.
9. Perform regression testing.
10. Release through the approved deployment process.
```

Breaking changes must not be introduced silently.

---

# 46. API Deprecation

Deprecated endpoints should include:

```text
Deprecation date
Replacement endpoint
Migration instructions
Removal target
Consumer impact
```

Where appropriate, provide headers such as:

```http
Deprecation: true
Sunset: <HTTP-date>
Link: </api/v2/resource>; rel="successor-version"
```

Only use these headers where the deployment standard supports them.

---

# 47. API Testing Matrix

Every endpoint category should be covered by:

| Test Class             | Required                          |
| ---------------------- | --------------------------------- |
| Unit tests             | Yes                               |
| Integration tests      | Yes                               |
| Authentication tests   | Yes                               |
| Authorization tests    | Yes                               |
| Tenant isolation tests | Yes                               |
| Validation tests       | Yes                               |
| Error-path tests       | Yes                               |
| Concurrency tests      | For mutation endpoints            |
| Idempotency tests      | For retry-sensitive mutations     |
| Rate-limit tests       | For protected/high-risk endpoints |
| Security tests         | Yes                               |
| Regression tests       | Yes                               |

Financial endpoints require additional:

```text
ledger posting verification
double-entry verification
duplicate transaction protection
reversal verification
audit trail verification
reconciliation verification
```

---

# 48. API Catalogue Governance

The API catalogue must be reviewed whenever any of the following changes:

```text
route added
route removed
route renamed
HTTP method changed
authentication changed
authorization changed
tenant behavior changed
request schema changed
response schema changed
state transition changed
financial behavior changed
provider integration changed
error code changed
rate limit changed
deprecation introduced
```

Documentation drift is a production risk.

---

# 49. API Inventory

## Core Business APIs

```text
/api/auth/*
/api/users/*
/api/tenants/*
/api/saas/*
/api/groups/*
/api/contributions/*
/api/loans/*
```

## Financial APIs

```text
/api/finance/*
/api/payments/*
/api/reconciliation/*
/api/statements/*
```

## Compliance APIs

```text
/api/compliance/*
```

## Communication APIs

```text
/api/chat/*
/api/notifications/*
```

## Community APIs

```text
/api/help/*
/api/faq/*
/api/forum/*
/api/referrals/*
```

## Integration APIs

```text
/api/callbacks/*
/api/webhooks/*
/api/events/*
```

## Administrative APIs

```text
/api/admin/*
/api/audit/*
```

## Operational APIs

```text
/api/health
/api/ready
/api/live
/api/metrics
```

> The catalogue above is a domain inventory. An endpoint listed here should be treated as an intended contract only where the corresponding route is actually registered in the deployed backend.

---

# 50. Production Deployment Checklist

## Runtime

* [ ] `PORT` configured through environment.
* [ ] Correct production start command configured.
* [ ] Process supervision enabled.
* [ ] Automatic restart policy configured.
* [ ] Resource limits configured.
* [ ] Graceful shutdown enabled.

## Security

* [ ] HTTPS enforced.
* [ ] Secure headers configured.
* [ ] CORS configured.
* [ ] Authentication middleware active.
* [ ] Authorization middleware active.
* [ ] Tenant isolation verified.
* [ ] Rate limiting active.
* [ ] Request size limits configured.
* [ ] Sensitive logging redaction active.

## Data

* [ ] Database connectivity verified.
* [ ] Required indexes deployed.
* [ ] Auto-index policy appropriate for environment.
* [ ] Transactions configured where required.
* [ ] Soft-delete behavior verified.
* [ ] Financial immutability verified.

## Observability

* [ ] Structured logging active.
* [ ] Request IDs active.
* [ ] Metrics exposed.
* [ ] Health endpoint verified.
* [ ] Readiness endpoint verified.
* [ ] Liveness endpoint verified.
* [ ] Distributed tracing active where configured.
* [ ] Alerting configured.

## API

* [ ] API routes registered.
* [ ] Validation active.
* [ ] Error envelope standardized.
* [ ] Pagination limits enforced.
* [ ] Idempotency active for required mutations.
* [ ] API tests passing.
* [ ] Security tests passing.
* [ ] Documentation synchronized.

---

# 51. Development Troubleshooting

## Server Does Not Start

Check:

```text
Environment variables
Database connectivity
Redis connectivity
Required configuration
Port availability
Node.js version
Dependency installation
```

---

## EADDRINUSE

Identify the process using the configured port.

Windows:

```powershell
netstat -ano | findstr :5000
```

Then inspect the corresponding process:

```powershell
tasklist | findstr <PID>
```

Linux/macOS:

```bash
lsof -i :5000
```

or:

```bash
ss -ltnp | grep :5000
```

Do not terminate unknown processes blindly in production.

---

## API Returns 401

Check:

```text
Authorization header
Bearer token format
token expiration
token signing configuration
authentication middleware
user/session state
```

---

## API Returns 403

Check:

```text
role
permission
tenant context
resource ownership
resource state
```

---

## API Returns 409

Check:

```text
state transition
duplicate resource
idempotency conflict
concurrent update
existing active workflow
```

---

# 52. Production API Operating Rules

The following rules are mandatory architectural expectations:

```text
1. No unauthenticated access to protected resources.
2. No cross-tenant resource access.
3. No direct financial balance mutation.
4. No destructive modification of immutable financial records.
5. No duplicate financial posting from retries.
6. No silent authorization escalation.
7. No secrets in logs or API responses.
8. No arbitrary database sorting/filter injection.
9. No unbounded pagination.
10. No uncontrolled file uploads.
11. No undocumented breaking API changes.
12. No production deployment without health/readiness verification.
```

---

# 53. Reference Documentation

The API catalogue should be read together with:

```text
docs/api/API_REFERENCE_QUICK_START.md
docs/api/BACKEND_API_SPECIFICATION.md
docs/02-architecture/SERVICE_CATALOGUE.md
docs/02-architecture/DEPENDENCY_MAP.md
docs/02-architecture/EVENT_CATALOGUE.md
docs/data/DATA_MODEL_CATALOGUE.md
```

For finance-specific API behavior, consult the financial engine, ledger, reconciliation, statement-processing, and transaction-state specifications maintained under the corresponding documentation domains.

---

# 54. Final API Readiness Standard

The TITech Community Savings backend API is considered production-ready only when:

```text
All protected routes enforce authentication.
All privileged routes enforce authorization.
All tenant-scoped routes enforce tenant isolation.
All user inputs are validated.
All high-risk mutations have idempotency controls.
All financial mutations integrate with the financial engine.
All material administrative actions are audited.
All critical APIs emit structured observability data.
All list APIs have bounded pagination.
All search APIs are rate limited and query-safe.
All destructive actions follow approved lifecycle rules.
All state transitions are validated server-side.
All production API changes are documented and tested.
All health and graceful-shutdown controls are operational.
```

---

# 55. Document Metadata

**Document:** `docs/api/API_CATALOGUE.md`
**System:** Community Savings App Backend
**Organization:** TITech Community Capital Ltd
**API Prefix:** `/api`
**Default Development Port:** `5000`
**Primary Runtime:** Node.js
**Development Runtime:** `nodemon server.js`
**Production Runtime:** `node server.js` or approved process/container supervisor
**Current Document Status:** Production Architecture Reference
**Last Updated:** August 16, 2026

**Primary Example User**

```text
Name: Justine Robert
Email: justine@titech.com
```

**Maintenance Requirement**

> Every API route added, changed, deprecated, or removed from the backend must be reflected in this catalogue and in the appropriate detailed API specification before the change is considered fully documented.