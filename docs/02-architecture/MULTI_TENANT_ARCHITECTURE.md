# TITech Community Capital Ltd

# Enterprise Multi-Tenant Architecture

**Document:** `docs/02-architecture/MULTI_TENANT_ARCHITECTURE.md`
**Status:** Production Multi-Tenant Architecture Baseline
**Audience:** Architecture, Backend Engineering, Frontend/Mobile Engineering, Security, Database Engineering, DevOps/SRE, Compliance, QA, Operations, Internal Audit
**Owner:** Architecture / Platform Engineering / Security
**Classification:** Internal / Confidential
**Version:** 1.0.0
**Review Cadence:** At least annually and after any material tenant, identity, authorization, data-isolation, financial, or infrastructure change

---

# 1. Purpose

This document defines the authoritative multi-tenant architecture for TITech Community Capital.

TITech is designed as a multi-tenant financial SaaS platform supporting multiple independent:

* SACCOs;
* VSLAs;
* community savings groups;
* cooperatives;
* financial organizations;
* enterprise customers;
* operational teams;
* ecosystem partners.

The architecture MUST ensure that one tenant cannot access, modify, infer, or otherwise compromise another tenant's data or financial state without explicitly authorized platform-level access.

This document defines:

```text
Tenant Identity
Tenant Context
Tenant Isolation
Tenant Membership
Tenant Authorization
Tenant-Scoped Data
Tenant-Scoped Financial State
Cross-Tenant Administration
Service-to-Service Tenant Propagation
Background Worker Isolation
Event Tenant Propagation
Cache Isolation
Database Isolation
Operational Isolation
Security Monitoring
Tenant Lifecycle
Tenant Offboarding
Tenant Recovery
```

---

# 2. Governing Principle

The central multi-tenant rule is:

> **Tenant isolation is a security boundary, not merely a database filtering convention. Every tenant-owned request, record, operation, event, cache key, background job, financial posting, integration, and audit action must carry or derive trusted tenant context, and every cross-tenant operation must require explicit privileged authorization.**

---

# 3. Multi-Tenant Objectives

The architecture MUST guarantee:

```text
Confidentiality
Integrity
Availability
Isolation
Authorization
Accountability
Financial Segregation
Operational Safety
Recoverability
```

The primary invariant is:

```text
Tenant A
  ≠
Tenant B
```

unless a specifically authorized platform-level operation explicitly crosses that boundary.

---

# 4. Tenant Isolation Model

The default model is:

```text
                     TITech Platform
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
       Tenant A         Tenant B         Tenant C
          │                │                │
      Users/etc.       Users/etc.       Users/etc.
          │                │                │
       Data A           Data B           Data C
          │                │                │
       Ledger A         Ledger B         Ledger C
```

Tenant A MUST NOT be able to access:

```text
Tenant B users
Tenant B members
Tenant B groups
Tenant B savings
Tenant B loans
Tenant B payments
Tenant B accounts
Tenant B transactions
Tenant B compliance data
Tenant B reports
Tenant B audit records
Tenant B operational state
```

---

# 5. Default Isolation Strategy

The primary logical isolation strategy is:

```text
Shared Application
+
Shared Database Cluster
+
Tenant-Scoped Collections
+
Tenant-Aware Queries
+
Tenant-Aware Authorization
+
Tenant-Aware Indexes
+
Tenant-Aware Financial State
```

This architecture is suitable for efficient SaaS operation while maintaining strong logical tenant boundaries.

Physical isolation MAY be introduced later for specific customers, jurisdictions, regulatory requirements, or risk classes.

---

# 6. Tenant Isolation Layers

Tenant isolation MUST be enforced at multiple layers:

```text
1. Identity
2. Authentication
3. Tenant Membership
4. Authorization
5. Request Context
6. Application Services
7. Repository Queries
8. Database Constraints
9. Financial Core
10. Events
11. Background Jobs
12. Caches
13. File/Object Storage
14. Audit
15. Reporting
16. Infrastructure
```

No single layer is sufficient.

---

# 7. Defense-in-Depth Tenant Model

Canonical request path:

```text
Client
  ↓
Authentication
  ↓
Identity
  ↓
Tenant Membership
  ↓
Tenant Context
  ↓
Authorization
  ↓
Tenant-Aware Application Service
  ↓
Tenant-Aware Repository
  ↓
Tenant-Scoped Persistence
```

A failure in one control MUST NOT automatically expose another tenant.

---

# 8. Tenant Identity

Every tenant MUST have a stable unique identifier.

Canonical:

```text
tenantId
```

A tenant may additionally have:

```text
tenantCode
tenantNumber
publicTenantId
registrationNumber
```

These represent different concepts and MUST NOT be conflated.

---

# 9. Tenant Database Identity

The database identifier may be:

```text
_id
```

while the domain identifier is:

```text
tenantId
```

The public API identifier MAY be separate if required.

---

# 10. Tenant Lifecycle

Canonical tenant lifecycle:

```text
PENDING
   ↓
ONBOARDING
   ↓
ACTIVE
   ↓
SUSPENDED
   ↓
CLOSED
```

Additional controlled states MAY include:

```text
UNDER_REVIEW
RESTRICTED
DECOMMISSIONING
ARCHIVED
```

---

# 11. Tenant State Definitions

## PENDING

Tenant record exists but onboarding is not complete.

## ONBOARDING

Tenant is undergoing verification/configuration.

## ACTIVE

Tenant may access permitted platform capabilities.

## SUSPENDED

Access is restricted due to policy, billing, risk, compliance, or operational reasons.

## CLOSED

Tenant operations are permanently closed subject to retention obligations.

## ARCHIVED

Historical tenant data has been moved to controlled archival storage.

---

# 12. Tenant Provisioning

Tenant provisioning SHOULD be explicit and idempotent.

Canonical flow:

```text
Tenant Request
      ↓
Validation
      ↓
Tenant Created
      ↓
Default Configuration
      ↓
Default Roles
      ↓
Default Accounts / Financial Configuration
      ↓
Onboarding
      ↓
Activation
```

Provisioning MUST NOT create duplicate tenant infrastructure on retry.

---

# 13. Tenant Provisioning Identity

Provisioning SHOULD use:

```text
tenantId
+
provisioningOperationId
+
idempotencyKey
```

Repeated provisioning requests MUST return the existing result or a deterministic conflict.

---

# 14. Tenant Configuration

Tenant-specific configuration SHOULD include:

```text
currency
timezone
locale
financial settings
loan settings
savings settings
payment settings
notification settings
compliance settings
operational limits
feature entitlements
```

Configuration MUST be scoped to the correct tenant.

---

# 15. Tenant Secrets

Tenant-specific provider credentials MUST NOT be stored in ordinary tenant configuration if secure secret management is available.

Use:

```text
Secret Manager
Vault
KMS-backed secret storage
Environment-specific secure configuration
```

Application responses MUST never expose tenant secrets.

---

# 16. Tenant Membership

A user belongs to a tenant through an explicit membership record.

Canonical:

```text
User
   ↓
TenantMembership
   ↓
Tenant
```

Membership SHOULD contain:

```text
tenantId
userId
roleIds
status
joinedAt
revokedAt
```

---

# 17. User vs Tenant

A user is a platform identity.

A tenant is a business/customer boundary.

A tenant membership creates the relationship.

Therefore:

```text
User ≠ Tenant
User ≠ TenantMembership
```

---

# 18. Multi-Tenant Users

A user MAY belong to more than one tenant where permitted.

Example:

```text
User U1
 ├── Tenant A → Treasurer
 └── Tenant B → Auditor
```

The active tenant context MUST be explicit.

A user's membership in Tenant A MUST NOT automatically grant access to Tenant B.

---

# 19. Active Tenant Context

For multi-tenant users, requests MUST resolve an active tenant context.

Possible trusted sources:

```text
authenticated membership
authorized tenant selection
session context
trusted token claim
explicit platform-admin context
```

A raw client-provided tenant ID MUST NOT override authorization.

---

# 20. Tenant Selection

A multi-tenant client MAY select a tenant through:

```text
POST /api/v1/auth/select-tenant
```

or an equivalent controlled mechanism.

The server MUST verify:

```text
user is a member
membership is active
tenant is accessible
```

Only then may the tenant become active context.

---

# 21. Tenant Context Object

Internal application context SHOULD contain:

```text
tenantId
userId
membershipId
roles
permissions
requestId
correlationId
traceId
```

For service identities:

```text
serviceId
tenantId where applicable
operationId
```

---

# 22. Trusted Tenant Context

The authoritative tenant context MUST be derived server-side.

Bad:

```text
req.body.tenantId
```

being trusted directly.

Preferred:

```text
authenticatedPrincipal
       ↓
membership
       ↓
authorizedTenantContext
```

---

# 23. Tenant Context Propagation

Tenant context MUST propagate across:

```text
API
Application Services
Domain Services
Repositories
Transactions
Events
Queues
Workers
Provider Operations
Audit
Tracing
```

---

# 24. HTTP Tenant Context

The API layer SHOULD establish:

```text
tenantId
requestId
correlationId
userId
```

before invoking tenant-owned business services.

The service layer MUST NOT accept an untrusted tenant context supplied independently from the authenticated context.

---

# 25. Service-to-Service Tenant Context

Internal service calls SHOULD carry:

```text
tenantId
operationId
correlationId
callerServiceId
```

Service identity MUST be authenticated separately from tenant identity.

---

# 26. Tenant Context and Authentication

Authentication establishes:

```text
Who is this?
```

Tenant context establishes:

```text
Which tenant are they acting for?
```

Authorization establishes:

```text
What may they do within that tenant?
```

These are three distinct security decisions.

---

# 27. Authorization Model

Recommended:

```text
Identity
  ↓
Tenant Membership
  ↓
Role
  ↓
Permission
  ↓
Resource Ownership
  ↓
Business Rule
```

Example:

```text
User U
→ Member of Tenant A
→ Role Treasurer
→ Permission payments.create
→ Resource belongs to Tenant A
→ Payment rules satisfied
```

Only then may the operation proceed.

---

# 28. Tenant Resource Ownership

Every tenant-owned resource MUST have an ownership relationship.

Examples:

```text
Member → tenantId
Loan → tenantId
PaymentOperation → tenantId
Account → tenantId
Transaction → tenantId
Statement → tenantId
```

---

# 29. Tenant-Scoped Query Rule

Every repository query for tenant-owned data MUST apply tenant scope.

Bad:

```text
findOne({
  _id: resourceId
})
```

Preferred:

```text
findOne({
  tenantId,
  _id: resourceId
})
```

---

# 30. Repository Tenant Contract

Tenant-aware repository methods SHOULD make tenant identity explicit.

Preferred:

```text
findById(tenantId, resourceId)
findOne(tenantId, filter)
findByOperationKey(tenantId, operationKey)
```

Avoid APIs that make it easy to omit tenant context.

---

# 31. Tenant-Safe Repository Design

Repositories SHOULD enforce:

```text
tenantId
+
resource identifier
```

before accessing tenant-owned records.

For privileged platform operations, repository methods SHOULD require an explicit elevated context rather than silently bypassing tenant filtering.

---

# 32. Cross-Tenant Query Prohibition

Generic repository methods MUST NOT support uncontrolled cross-tenant queries.

Bad:

```text
find({ status: "ACTIVE" })
```

for tenant-owned resources.

Preferred:

```text
find({
  tenantId,
  status: "ACTIVE"
})
```

---

# 33. Global Entities

Some entities are legitimately platform-global:

```text
SubscriptionPlan
SystemRole
SystemPermission
PlatformConfiguration
CurrencyDefinition
```

These MUST be explicitly classified as:

```text
GLOBAL
```

A global entity MUST NOT be treated as tenant-owned.

---

# 34. Tenant-Owned Entities

Examples:

```text
TenantSettings
Group
Member
Loan
SavingsAccount
PaymentOperation
Account
Transaction
Statement
ComplianceCase
RiskAssessment
FraudAlert
```

These MUST carry tenant ownership.

---

# 35. Hybrid Entities

Some records contain both platform-global and tenant-specific components.

Example:

```text
SubscriptionPlan
    ↓
TenantSubscription
```

The plan is global.

The subscription is tenant-scoped.

This relationship MUST be explicit.

---

# 36. Tenant-Scoped Unique Constraints

Uniqueness MUST generally be scoped to tenant.

Examples:

```text
tenantId + memberNumber
tenantId + groupCode
tenantId + loanNumber
tenantId + accountCode
tenantId + operationKey
```

This allows different tenants to use the same local business number safely.

---

# 37. Global Unique Constraints

Global uniqueness SHOULD only be used where the business meaning requires it.

Examples:

```text
tenantId
eventId
provider + providerTransactionId
consumerName + eventId
```

Do not use global uniqueness merely for implementation convenience.

---

# 38. Financial Tenant Isolation

Financial records MUST be tenant-scoped.

The following MUST carry tenant ownership:

```text
Account
Journal
JournalEntry
Transaction
BalanceSnapshot
FinancialPeriod
Reversal
Adjustment
```

---

# 39. Financial Cross-Tenant Rule

A transaction MUST NOT contain:

```text
Tenant A transaction
+
Tenant B account
```

This MUST be rejected before posting.

Validation:

```text
transaction.tenantId
===
journal.tenantId
===
account.tenantId
```

---

# 40. Cross-Tenant Financial Transfers

Cross-tenant financial transfers MUST NOT be implemented as ordinary tenant-scoped transfers.

If TITech eventually supports inter-tenant settlement:

```text
Tenant A
   ↓
Platform / Clearing Layer
   ↓
Tenant B
```

the transaction MUST use an explicitly defined platform-level accounting model.

The operation MUST NOT bypass tenant isolation by simply referencing another tenant's account.

---

# 41. Platform Clearing

If cross-tenant financial relationships become necessary, use controlled clearing accounts:

```text
Tenant A
  ↓
Platform Clearing
  ↓
Tenant B
```

Both sides remain explicitly identifiable and auditable.

---

# 42. Tenant Financial Chart of Accounts

Each tenant MAY have its own chart of accounts.

Recommended:

```text
tenantId + accountCode
```

The platform MAY provide system account templates while allowing tenant-specific configuration.

---

# 43. Tenant Financial Configuration

Tenant financial configuration MAY define:

```text
baseCurrency
fiscalCalendar
accountingPeriod
chartOfAccounts
interest policies
fee policies
loan configuration
savings configuration
```

Financial configuration changes MUST be versioned/audited where they affect accounting semantics.

---

# 44. Tenant Currency

Every tenant SHOULD have a configured base currency.

However:

```text
tenant.currency
```

does not eliminate the requirement that every actual financial record contains its own currency where appropriate.

---

# 45. Multi-Currency Tenant

A tenant may support more than one currency where business policy permits.

The data model MUST distinguish:

```text
tenant base currency
transaction currency
account currency
settlement currency
```

Cross-currency operations require explicit FX rules.

---

# 46. Tenant Financial Periods

Financial periods MUST be tenant-scoped.

Example:

```text
Tenant A
  2026-08 → LOCKED

Tenant B
  2026-08 → OPEN
```

One tenant's period state MUST NOT influence another tenant's accounting period.

---

# 47. Tenant-Specific Ledger Posting

Every posting request MUST contain or derive:

```text
tenantId
operationId
currency
sourceType
sourceId
```

The Posting Engine MUST validate tenant consistency before commit.

---

# 48. Tenant-Specific Idempotency

Idempotency keys MUST normally be tenant-scoped.

Example:

```text
Tenant A + PAY-100
```

is separate from:

```text
Tenant B + PAY-100
```

Recommended:

```text
tenantId + operationType + idempotencyKey
```

where operation semantics require it.

---

# 49. Tenant-Specific Operation Identity

A logical operation SHOULD use:

```text
tenantId
+
operationKey
```

to distinguish same-key operations across tenants.

---

# 50. Tenant-Specific Request Fingerprints

Request fingerprint validation MUST occur within tenant scope.

A key conflict in Tenant A MUST NOT interfere with Tenant B.

---

# 51. Payment Tenant Isolation

Payment operations MUST contain:

```text
tenantId
operationId
provider
amount
currency
```

Provider callbacks MUST be mapped to the correct tenant before changing payment state.

---

# 52. Provider Reference Mapping

Provider references MUST resolve to one authorized internal payment operation.

Example:

```text
providerTransactionId
   ↓
ProviderTransaction
   ↓
tenantId + paymentOperationId
```

Do not resolve provider references globally without tenant/business validation.

---

# 53. Callback Tenant Resolution

A callback may not contain reliable tenant information.

Therefore tenant resolution MAY require:

```text
providerReference
↓
ProviderTransaction
↓
PaymentOperation
↓
tenantId
```

The callback handler MUST verify the resulting relationship before processing.

---

# 54. Callback Tenant Mismatch

If:

```text
callback tenant
≠
payment operation tenant
```

the callback MUST be rejected or routed to controlled investigation.

No financial state may be changed.

---

# 55. Settlement Tenant Isolation

Statements, statement batches, statement lines, and settlement records MUST carry tenant ownership.

The settlement engine MUST never match a statement line from Tenant A against Tenant B's transaction.

---

# 56. Statement Import Isolation

Every import operation MUST establish:

```text
tenantId
provider
accountReference
statementPeriod
```

before processing begins.

An operator MUST NOT import an arbitrary tenant statement into another tenant's processing context.

---

# 57. Reconciliation Tenant Isolation

Matching criteria MUST include tenant scope.

Conceptually:

```text
tenantId
+
providerReference
+
currency
+
amount
```

where appropriate.

A cross-tenant match is invalid unless explicitly represented as a platform-level transaction.

---

# 58. Loan Tenant Isolation

Every loan-related entity MUST be tenant-scoped:

```text
LoanProduct
LoanApplication
LoanRiskProfile
LoanApproval
Loan
LoanDisbursement
RepaymentSchedule
Repayment
WriteOff
```

Loan references MUST resolve within the authorized tenant.

---

# 59. Member Tenant Isolation

A member belongs to one tenant by default unless the data model explicitly supports a separate cross-tenant identity.

Recommended:

```text
tenantId + memberNumber
```

A member number reused by another tenant is valid if tenant-scoped uniqueness is used.

---

# 60. Group Tenant Isolation

Groups MUST belong to exactly one tenant:

```text
group.tenantId
```

Group membership MUST verify:

```text
member.tenantId === group.tenantId
```

A member from Tenant A MUST NOT be added to Tenant B's group.

---

# 61. Savings Tenant Isolation

Savings accounts MUST verify:

```text
savingsAccount.tenantId
member.tenantId
group.tenantId
product.tenantId
ledgerAccount.tenantId
```

before important operations.

---

# 62. Loan Relationship Isolation

Loan relationships MUST maintain the same tenant:

```text
Loan
 ├── Member
 ├── Group
 ├── LoanProduct
 ├── RiskProfile
 ├── Disbursement
 ├── Repayment
 └── Ledger Account
```

Any tenant mismatch MUST be rejected.

---

# 63. Compliance Tenant Isolation

KYC/AML cases MUST remain tenant-scoped.

Compliance officers may only access cases:

```text
within authorized tenant
```

unless they have an explicit platform compliance role.

---

# 64. Regulatory Tenant Isolation

Regulatory submission records MUST contain:

```text
tenantId
regulator
submissionReference
reportingPeriod
```

The submission payload MUST correspond to the authorized tenant.

---

# 65. Risk Data Tenant Isolation

Risk models MUST carry:

```text
tenantId
subjectId
subjectType
```

A risk score generated for Tenant A MUST not be used to silently make decisions for Tenant B.

---

# 66. Fraud Data Tenant Isolation

Fraud analysis MUST be tenant-scoped by default.

Cross-tenant fraud analytics MAY exist only when:

```text
platform-level authority
+
documented business purpose
+
privacy/security controls
```

are present.

---

# 67. Cross-Tenant Intelligence

Cross-tenant analytics MAY be allowed for platform-level aggregate intelligence where legally and contractually permitted.

Examples:

```text
system-wide fraud trends
aggregate operational metrics
anonymized benchmarking
```

The data SHOULD be:

```text
aggregated
de-identified where necessary
access-controlled
audited
```

---

# 68. Cross-Tenant Analytics Rule

Raw tenant records MUST NOT be exposed merely to produce platform-wide statistics.

Prefer:

```text
Tenant Data
   ↓
Controlled Aggregation
   ↓
Platform Metric
```

rather than:

```text
Tenant A + Tenant B raw data
→ unrestricted query
```

---

# 69. Reporting Tenant Isolation

Every tenant-facing report MUST apply tenant scope.

Example:

```text
GET /api/v1/reports/financial
```

must derive tenant context from authentication and authorization.

A client-supplied `tenantId` MUST NOT broaden access.

---

# 70. Dashboard Tenant Isolation

Dashboards MUST aggregate only data visible to the active tenant.

Cached dashboard data MUST use tenant-safe keys.

---

# 71. Export Tenant Isolation

Export operations MUST preserve tenant context.

Example:

```text
ExportOperation
 ├── tenantId
 ├── requestedBy
 ├── filters
 └── dataScope
```

A tenant export MUST never include another tenant's records.

---

# 72. File/Object Storage Isolation

Storage paths SHOULD be tenant-scoped.

Recommended:

```text
tenants/{tenantId}/documents/{fileId}
```

or an equivalent non-enumerable structure.

Do not expose predictable public storage URLs for sensitive tenant documents.

---

# 73. Object Access

Every file retrieval MUST verify:

```text
authenticated user
+
tenant membership
+
resource ownership
```

A valid file identifier alone MUST NOT authorize access.

---

# 74. Cache Isolation

Cache keys MUST include tenant context where the data is tenant-specific.

Preferred:

```text
tenant:{tenantId}:member:{memberId}
tenant:{tenantId}:loan:{loanId}
tenant:{tenantId}:account:{accountId}
tenant:{tenantId}:payment:{paymentId}
```

---

# 75. Cache Poisoning Protection

A response generated for Tenant A MUST NOT be stored under a cache key that Tenant B can resolve.

Cache keys SHOULD contain all relevant authorization dimensions where necessary.

---

# 76. Redis Isolation

Redis data SHOULD use tenant-aware namespaces.

Examples:

```text
tenant:{tenantId}:rate-limit:...
tenant:{tenantId}:idempotency:...
tenant:{tenantId}:cache:...
```

System-global keys MUST be explicitly identified as global.

---

# 77. Rate-Limit Tenant Isolation

Rate limiting SHOULD distinguish:

```text
global limits
tenant limits
user limits
IP limits
operation limits
```

A single abusive tenant SHOULD NOT consume the entire platform's available capacity where isolation can be provided.

---

# 78. Queue Tenant Isolation

Background jobs MUST carry tenant context.

Example:

```text
{
  tenantId,
  operationId,
  jobId
}
```

Workers MUST validate the tenant before processing.

---

# 79. Queue Routing

Where practical, queues may be partitioned or logically namespaced:

```text
tenant:{tenantId}:payments
tenant:{tenantId}:settlement
```

or by a shared queue with strict tenant-aware job validation.

The correct choice depends on workload scale and operational requirements.

---

# 80. Worker Tenant Context

Worker processing SHOULD follow:

```text
Job
 ↓
Tenant Context
 ↓
Authorization / Service Identity
 ↓
Repository Scope
 ↓
Processing
```

Workers MUST NOT rely solely on job payload data without validating current authoritative state.

---

# 81. Worker Cross-Tenant Protection

A worker processing:

```text
tenantId = A
```

MUST NOT fetch or modify:

```text
tenantId = B
```

records unless it is executing an explicitly authorized platform-level operation.

---

# 82. Worker Claim Isolation

Claim keys SHOULD incorporate tenant scope when operation keys are not globally unique.

Example:

```text
tenantId + operationKey
```

---

# 83. Event Tenant Isolation

Tenant-aware events SHOULD include:

```text
tenantId
aggregateType
aggregateId
eventId
eventType
eventVersion
operationId
correlationId
```

---

# 84. Event Consumer Isolation

Consumers MUST validate:

```text
event tenant
+
current resource tenant
```

before applying a state change.

A consumer must not assume that a valid event automatically grants access to all resources identified inside it.

---

# 85. Outbox Tenant Isolation

Outbox records for tenant-aware operations MUST contain:

```text
tenantId
```

This makes event routing, observability, replay, and audit safer.

---

# 86. Event Replay Isolation

Replay operations MUST require explicit tenant context.

Example:

```text
replay(eventId, tenantId)
```

The replay tool MUST verify that the event actually belongs to the requested tenant.

---

# 87. Dead-Letter Tenant Isolation

Dead-letter records SHOULD preserve:

```text
tenantId
operationId
eventId
```

Cross-tenant replay is prohibited unless explicitly authorized.

---

# 88. Audit Tenant Isolation

Audit logs SHOULD contain:

```text
tenantId
actorId
resourceType
resourceId
action
correlationId
timestamp
```

Tenant audit queries MUST be tenant-scoped.

---

# 89. Platform Audit Access

Platform security/compliance operators MAY query across tenants only with:

```text
explicit global permission
business need
enhanced auditing
```

---

# 90. Security Event Tenant Context

Security events SHOULD preserve:

```text
tenantId where applicable
actorId
resource
source
result
requestId
correlationId
```

This enables tenant-specific threat detection.

---

# 91. Authentication Tenant Enumeration Protection

Authentication APIs MUST avoid revealing tenant membership information unnecessarily.

Do not expose:

```text
"This user belongs to Tenant X"
```

through unauthenticated enumeration endpoints.

---

# 92. Tenant Enumeration Protection

Public endpoints MUST avoid exposing:

```text
tenant existence
membership status
internal tenant IDs
administrative details
```

unless explicitly intended.

---

# 93. Tenant ID Exposure

Public tenant IDs MAY be exposed where necessary, but authorization MUST never rely on obscurity.

Use:

```text
opaque/stable identifiers
```

where appropriate.

---

# 94. Tenant-Safe API Routing

Acceptable patterns:

```text
GET /api/v1/loans/:loanId
```

where tenant is derived from authorization.

Also valid:

```text
GET /api/v1/tenants/:tenantId/loans/:loanId
```

when tenant-scoped routing is explicitly authorized.

The second form MUST NOT be interpreted as authorization merely because the URL contains a tenant ID.

---

# 95. Tenant Header Rules

A custom header such as:

```text
X-Tenant-ID
```

MAY be used as a routing hint, but it MUST NOT override server-derived tenant authorization.

If present:

```text
X-Tenant-ID
```

MUST be validated against authenticated membership.

---

# 96. Tenant Token Claims

Tokens MAY contain:

```text
tenantId
tenant memberships
activeTenantId
roles
```

However:

> Token claims are security inputs, not unconditional truth.

The application SHOULD validate relevant membership/status against current authoritative state where necessary.

---

# 97. Revoked Membership

When membership is revoked:

```text
User
→ TenantMembership = REVOKED
```

future requests MUST fail tenant authorization even if an old token still claims tenant access, subject to token/session policy.

High-risk operations SHOULD revalidate membership at execution time.

---

# 98. Suspended Tenant

When tenant state becomes:

```text
SUSPENDED
```

the platform SHOULD restrict:

```text
new financial operations
new member creation
new loan disbursements
new payment initiation
administrative changes
```

according to the suspension policy.

Read access may remain available where appropriate.

---

# 99. Closed Tenant

A closed tenant MUST NOT initiate normal new business activity.

Permitted operations may include:

```text
historical reads
regulated reporting
audit
settlement completion
controlled recovery
data export
data retention management
```

subject to policy.

---

# 100. Tenant Offboarding

Offboarding SHOULD follow:

```text
ACTIVE
  ↓
DECOMMISSIONING
  ↓
CLOSED
  ↓
ARCHIVED
```

Offboarding MUST account for:

```text
users
members
financial accounts
loans
payments
settlements
compliance
reports
files
subscriptions
events
audit records
```

---

# 101. Tenant Offboarding Financial Rule

A tenant MUST NOT be archived until financial closure requirements are satisfied.

Potential checks:

```text
open financial periods
outstanding settlement
unresolved reconciliation
pending payments
active loans
unresolved adjustments
regulatory obligations
```

---

# 102. Tenant Closure Checklist

Before closure:

```text
[ ] Access restrictions applied
[ ] Active sessions handled
[ ] Billing state resolved
[ ] Pending payments reviewed
[ ] Settlement reconciled
[ ] Financial period finalized where required
[ ] Outstanding loans handled according to policy
[ ] Regulatory obligations reviewed
[ ] Data retention policy applied
[ ] Final audit captured
[ ] Backups verified
```

---

# 103. Tenant Deletion Policy

Tenant deletion SHOULD be exceptional.

Financial, audit, and regulatory records may require retention.

Where deletion is permitted:

```text
logical deactivation
→ retention
→ controlled destruction
```

is preferred over uncontrolled cascading deletion.

---

# 104. Cascading Delete Prohibition

A tenant record MUST NOT be deleted with an uncontrolled cascade that silently deletes:

```text
financial history
audit history
regulatory evidence
payment evidence
settlement evidence
```

---

# 105. Tenant Archival

Archived tenant data SHOULD remain:

```text
encrypted
addressable
integrity-verifiable
access-controlled
auditable
```

---

# 106. Tenant Backup Isolation

Backups MUST preserve tenant identity.

Restore operations MUST support:

```text
full-platform restore
or
controlled tenant-scoped restore
```

where technically feasible.

---

# 107. Tenant Recovery

A tenant recovery process MUST verify:

```text
tenantId
data ownership
financial integrity
event state
audit continuity
```

before restoring access.

---

# 108. Tenant Restore Security

A restored tenant MUST NOT accidentally gain access to:

```text
deleted tenants
other tenant data
stale sessions
cross-tenant cache entries
unauthorized events
```

---

# 109. Tenant Disaster Recovery

If the entire platform is restored:

```text
MongoDB
+
Redis
+
Queue
+
Object Storage
```

must preserve tenant boundaries.

Post-restore validation MUST include tenant isolation tests.

---

# 110. Tenant Data Encryption

Sensitive tenant data SHOULD be encrypted:

```text
in transit
at rest
in backups
in object storage
```

Highly sensitive fields MAY use application-level encryption where warranted.

---

# 111. Tenant-Specific Encryption

Where contractual/regulatory requirements demand stronger isolation, tenant-specific encryption keys MAY be introduced.

Architecture:

```text
Tenant A
  ↓
Key A

Tenant B
  ↓
Key B
```

Such a model increases operational complexity and SHOULD be adopted deliberately.

---

# 112. Tenant-Specific Database Isolation

For high-isolation customers, architecture MAY evolve toward:

```text
Tenant
  ↓
Dedicated Database
```

or:

```text
Tenant
  ↓
Dedicated Database Cluster
```

without changing domain-level ownership semantics.

---

# 113. Physical Isolation Tiers

The platform MAY support isolation tiers:

```text
Tier 1
Shared Database / Logical Isolation

Tier 2
Dedicated Database

Tier 3
Dedicated Database Cluster / Infrastructure

Tier 4
Dedicated Region / Environment
```

Tenant placement MUST remain transparent to business-domain contracts.

---

# 114. Tenant Sharding

At large scale, tenant data MAY be partitioned/sharded.

Potential shard key:

```text
tenantId
```

This architecture is compatible with future horizontal tenant distribution.

Tenant-aware data ownership MUST remain unchanged.

---

# 115. Tenant Placement Registry

If physical tenant placement is introduced, maintain a controlled registry:

```text
TenantPlacement
 ├── tenantId
 ├── isolationTier
 ├── databaseCluster
 ├── region
 ├── shard
 ├── status
 └── version
```

Placement information MUST be security-controlled.

---

# 116. Tenant Routing

A routing layer MAY resolve:

```text
tenantId
→
database / shard / cluster
```

The application domain MUST remain unaware of infrastructure-specific placement where practical.

---

# 117. Tenant Migration Between Clusters

Tenant migration MUST preserve:

```text
tenant identity
financial transaction IDs
audit IDs
operation IDs
event IDs
provider references
```

Migration SHOULD be performed using controlled:

```text
copy
→ validate
→ dual-read/dual-write if necessary
→ cutover
→ verify
→ retire source
```

---

# 118. Tenant Migration Financial Integrity

Before migration completion:

```text
source ledger
=
target ledger
```

for the relevant scope.

Validate:

```text
transaction counts
journal counts
debit totals
credit totals
account balances
period state
```

---

# 119. Tenant Migration Security

Migration operators MUST have:

```text
privileged authorization
reason
change record
audit
```

Raw customer data should not be copied outside approved infrastructure.

---

# 120. Tenant Rate Limits

Each tenant SHOULD have configurable quotas for:

```text
API requests
payment requests
concurrent jobs
file uploads
exports
reports
notifications
```

Limits SHOULD prevent one tenant from exhausting shared platform capacity.

---

# 121. Tenant Resource Quotas

Tenant-specific limits MAY include:

```text
maxUsers
maxGroups
maxMembers
maxLoans
maxApiRequests
maxStorage
maxExports
maxConcurrentOperations
```

Quotas are platform controls, not substitutes for authorization.

---

# 122. Noisy Neighbor Protection

The platform MUST protect tenants against disproportionate resource consumption.

Controls:

```text
rate limits
worker concurrency limits
queue isolation
database query limits
export limits
storage quotas
circuit breakers
```

---

# 123. Tenant Fairness

Shared infrastructure SHOULD enforce fair scheduling where practical.

Examples:

```text
weighted queues
tenant concurrency limits
per-tenant rate limits
resource quotas
```

---

# 124. Tenant Performance Isolation

One tenant's:

```text
large report
large statement import
high-volume payment workload
fraud analysis
```

MUST NOT unnecessarily degrade all other tenants.

Use asynchronous processing and controlled concurrency.

---

# 125. Tenant Queue Priorities

Operationally important tasks MAY use priority classes:

```text
CRITICAL
HIGH
NORMAL
LOW
```

Priority MUST NOT be used to bypass security or tenant isolation.

---

# 126. Tenant Observability

Operational metrics SHOULD support dimensions:

```text
tenantId
service
operation
status
region
```

Tenant identifiers in telemetry MUST be protected from inappropriate exposure.

---

# 127. Tenant-Specific Metrics

Examples:

```text
tenant_api_requests_total
tenant_payment_operations_total
tenant_payment_failures_total
tenant_queue_depth
tenant_reconciliation_backlog
tenant_loan_disbursements_total
```

---

# 128. Tenant Security Monitoring

Monitor:

```text
tenant_access_denied_total
cross_tenant_attempts_total
tenant_auth_failures_total
tenant_rate_limit_exceeded_total
tenant_export_operations_total
tenant_privileged_actions_total
```

---

# 129. Cross-Tenant Access Alerting

Any unexpected cross-tenant access attempt SHOULD generate a high-severity security signal.

Possible triggers:

```text
resource tenant ≠ context tenant
tenant ID mismatch
foreign account reference
foreign loan reference
foreign callback resolution
foreign event application
```

---

# 130. Tenant Isolation Testing

Automated security testing MUST include:

```text
Tenant A → Tenant B Member
Tenant A → Tenant B Loan
Tenant A → Tenant B Payment
Tenant A → Tenant B Account
Tenant A → Tenant B Transaction
Tenant A → Tenant B Statement
Tenant A → Tenant B Compliance Case
Tenant A → Tenant B File
Tenant A → Tenant B Event
Tenant A → Tenant B Job
```

Expected result:

```text
DENY
```

---

# 131. Tenant Isolation Negative Testing

The test suite SHOULD deliberately attack:

```text
IDOR
BOLA
tenant header spoofing
token claim manipulation
path tenant manipulation
query tenant manipulation
cache key collision
event tenant mismatch
worker tenant mismatch
provider reference collision
```

---

# 132. Tenant Context Tampering

Test attempts:

```text
X-Tenant-ID: Tenant B
```

while authenticated as:

```text
Tenant A user
```

Expected:

```text
DENY
```

---

# 133. Tenant Query Tampering

Test:

```text
GET /members?tenantId=B
```

from Tenant A.

Expected:

```text
Tenant A context remains authoritative.
Tenant B data is not returned.
```

---

# 134. Tenant Path Tampering

Test:

```text
GET /api/v1/tenants/B/loans/loanA
```

while authenticated as Tenant A.

Expected:

```text
DENY
```

unless the identity has legitimate platform-level access.

---

# 135. Tenant Event Tampering

An event:

```text
tenantId = A
aggregateId = resource belonging to B
```

MUST be rejected by consumers.

---

# 136. Tenant Job Tampering

A worker MUST not execute:

```text
job.tenantId = A
```

against:

```text
resource.tenantId = B
```

---

# 137. Tenant Callback Tampering

A provider callback that resolves to a payment operation in Tenant A but contains inconsistent business context MUST be rejected or quarantined.

---

# 138. Tenant Cache Collision Testing

Test:

```text
Tenant A cache key
=
Tenant B cache key
```

must never occur for tenant-owned data.

---

# 139. Tenant Search Isolation

Full-text search/search index operations MUST include tenant scope.

Search must never return:

```text
Tenant B
```

records to Tenant A users.

---

# 140. Tenant Data Export Isolation

Export jobs MUST capture a fixed authorized data scope at creation.

A later privilege change or filter manipulation MUST NOT allow the export to grow into another tenant's data.

---

# 141. Tenant Import Isolation

Import jobs MUST capture:

```text
tenantId
requestedBy
operationId
```

at creation.

The worker MUST revalidate current tenant status and permissions before execution when appropriate.

---

# 142. Tenant Notification Isolation

Notifications MUST be addressed only to recipients belonging to the originating tenant/workflow context.

A notification event MUST include enough context to prevent cross-tenant delivery.

---

# 143. Tenant Email/SMS Isolation

Templates and recipient data SHOULD be tenant-aware.

Do not allow:

```text
tenant A template
```

to accidentally render:

```text
tenant B branding / data
```

---

# 144. Tenant Branding

Tenant-specific presentation data MAY include:

```text
name
logo
colors
contact information
SMS sender configuration
email branding
```

Branding data MUST be tenant-scoped.

---

# 145. Tenant Feature Flags

Feature flags SHOULD be scoped:

```text
global
tenant
environment
```

A tenant-specific feature must not affect another tenant unintentionally.

---

# 146. Tenant Entitlements

Authorization MAY depend on:

```text
tenant subscription
feature entitlement
resource quota
```

However:

> Entitlements must never bypass security authorization or financial integrity controls.

---

# 147. Tenant Billing Isolation

Billing operations MUST be scoped to the tenant's subscription.

A billing operation for Tenant A MUST NOT be reusable for Tenant B.

---

# 148. Tenant Billing and Financial Ledger

Billing state:

```text
subscription
invoice
billing operation
```

is separate from:

```text
ledger transaction
journal
account
```

The relationship MUST be explicit.

---

# 149. Tenant Compliance Isolation

Compliance roles MUST be restricted to authorized tenants.

Global compliance access requires a separate platform-level permission.

---

# 150. Tenant Regulatory Reporting

Regulatory reports MUST be generated from the correct tenant scope.

The report generator MUST validate:

```text
tenant
reporting period
source datasets
authorization
```

before submission.

---

# 151. Tenant Risk Isolation

Risk assessments SHOULD include:

```text
tenantId
subjectId
assessmentId
```

The same person/entity may have separate risk contexts across tenants if the business model allows it.

---

# 152. Cross-Tenant Identity Matching

If platform-wide identity matching is eventually required, it MUST use a distinct identity architecture.

Do not infer cross-tenant identity solely from:

```text
phone
email
name
```

because such matching has privacy and correctness implications.

---

# 153. Tenant Data Sharing

Tenant-to-tenant data sharing MUST be an explicit product capability.

Requirements:

```text
consent/policy
authorization
scope
purpose
audit
expiration
```

Default behavior remains:

```text
NO SHARING
```

---

# 154. Platform-Level Operations

Platform administrators MAY require:

```text
tenant listing
tenant health
tenant suspension
tenant recovery
tenant migration
global billing operations
global security investigation
```

These capabilities MUST remain separated from ordinary tenant administration.

---

# 155. Platform Admin vs Tenant Admin

Tenant Admin:

```text
one tenant
```

Platform Admin:

```text
platform-wide
```

A Tenant Admin MUST NOT inherit Platform Admin capabilities.

---

# 156. Platform Admin Audit

Every cross-tenant administrative operation MUST record:

```text
actor
tenant target
action
reason
requestId
correlationId
timestamp
result
```

---

# 157. Break-Glass Tenant Access

Emergency cross-tenant access MUST require:

```text
explicit authorization
reason
time-bound access
enhanced audit
post-incident review
```

Permanent unrestricted tenant access is prohibited.

---

# 158. Tenant Security Incident

If tenant isolation is suspected to be compromised:

```text
1. Identify affected tenant(s).
2. Stop affected access path.
3. Preserve evidence.
4. Determine scope.
5. Rotate credentials where necessary.
6. Validate financial state.
7. Validate event/job/cache boundaries.
8. Notify stakeholders according to policy.
9. Recover.
10. Perform post-incident review.
```

---

# 159. Tenant Isolation Incident Severity

Severity SHOULD consider:

```text
number of tenants affected
data type
financial exposure
duration
access scope
regulatory impact
```

Any confirmed cross-tenant financial exposure should be treated as critical.

---

# 160. Tenant Data Breach Response

Where tenant boundaries are crossed:

```text
Tenant Scope
      ↓
Affected Records
      ↓
Affected Users
      ↓
Affected Financial Operations
      ↓
Affected Integrations
      ↓
Audit Evidence
```

The system SHOULD support rapid identification of affected data.

---

# 161. Financial Tenant Breach Response

After a tenant isolation incident affecting financial data:

```text
1. Freeze affected operations where necessary.
2. Identify impacted transactions.
3. Reconcile ledger against external evidence.
4. Verify transaction uniqueness.
5. Review provider callbacks.
6. Review audit history.
7. Apply controlled corrections if necessary.
```

---

# 162. Tenant Isolation and Backups

Backup/restore systems MUST preserve:

```text
tenant IDs
financial ownership
audit records
event ownership
```

Restores MUST NOT collapse multiple tenant namespaces into ambiguous data.

---

# 163. Tenant Isolation and Disaster Recovery

DR environments MUST maintain the same logical security boundaries as production.

Testing MUST verify:

```text
Tenant A restore
≠
Tenant B exposure
```

---

# 164. Tenant Isolation and Observability

Observability systems MUST support tenant-level investigation without exposing tenant data unnecessarily.

Use metadata:

```text
tenantId
```

rather than embedding full sensitive payloads.

---

# 165. Tenant Isolation and Logs

Logs SHOULD include tenant context:

```text
tenantId
requestId
operationId
```

but MUST NOT include unnecessary customer payload data.

---

# 166. Tenant Isolation and Traces

Trace metadata MAY include:

```text
tenantId
operationId
correlationId
```

Sensitive data MUST NOT be placed in tracing baggage.

---

# 167. Tenant Isolation and Metrics

Metrics SHOULD expose aggregated tenant dimensions when useful, but cardinality must be managed carefully.

For high-cardinality tenant metrics, use controlled tenant-level telemetry rather than unrestricted metric label creation.

---

# 168. Tenant Isolation and APIs

Every tenant API MUST define:

```text
tenant source
authorization
resource ownership
```

Example:

```text
GET /api/v1/loans/:loanId
```

Tenant is derived from the authenticated context and verified against the loan record.

---

# 169. Tenant Isolation and Events

Every tenant event SHOULD include:

```text
tenantId
```

unless the event is explicitly platform-global.

Global events MUST be marked clearly as global.

---

# 170. Global Event Rule

A global event such as:

```text
platform.subscription_plan.updated
```

may omit tenant scope.

A tenant event such as:

```text
loan.application.submitted
```

MUST include tenant scope.

---

# 171. Tenant Isolation and Jobs

All tenant-specific jobs MUST store:

```text
tenantId
```

before enqueueing.

Worker processing MUST validate current tenant state.

---

# 172. Tenant Isolation and Financial Jobs

Jobs such as:

```text
interestAccrualJob
reconciliationJob
momoSettlementJob
airtelSettlementJob
ledgerIntegrityJob
```

MUST operate within explicit tenant scope unless intentionally defined as platform-wide aggregation jobs.

---

# 173. Tenant Isolation and Interest Accrual

Interest accrual MUST never:

```text
calculate Tenant A
using Tenant B policy
```

The operation must resolve:

```text
tenantId
loan/account
product
policy version
period
```

before calculation.

---

# 174. Tenant Isolation and Reconciliation

Reconciliation MUST use tenant-aware matching.

Example:

```text
statementLine.tenantId
=
candidateTransaction.tenantId
```

is a mandatory condition.

---

# 175. Tenant Isolation and Ledger Integrity

Ledger integrity checks MAY run:

```text
per tenant
```

or:

```text
platform-wide
```

but every record comparison MUST retain tenant identity.

---

# 176. Tenant Isolation and Period Close

Period close operations MUST be tenant-specific.

One tenant closing August 2026 MUST NOT close another tenant's August 2026 period.

---

# 177. Tenant Isolation and Snapshots

Balance snapshots MUST include:

```text
tenantId
accountId
```

and the account must belong to the same tenant.

---

# 178. Tenant Isolation and Reports

Reports MUST be generated from the authorized tenant's data scope.

A report parameter such as:

```text
tenantId=B
```

does not override:

```text
authorizedTenant=A
```

for a normal tenant user.

---

# 179. Tenant Isolation and Search

Search indexes MUST maintain tenant ownership.

Recommended logical key:

```text
tenantId + resourceId
```

---

# 180. Tenant Isolation and API Caching

API response caches MUST be keyed using all relevant tenant authorization context.

Never cache:

```text
GET /loans/123
```

under a global key if loan 123 is tenant-owned.

---

# 181. Tenant Isolation and CDN

Public static tenant branding may be CDN-cached.

Private tenant API responses MUST not be publicly cached.

---

# 182. Tenant Isolation and Browser Storage

Frontend clients SHOULD avoid storing cross-tenant sensitive data in global browser state.

When switching tenants:

```text
clear tenant-scoped cached state
reload authorized context
revalidate permissions
```

---

# 183. Tenant Switching

When a user changes tenants:

```text
Current Tenant A
      ↓
Switch Request
      ↓
Membership Validation
      ↓
Tenant B Context
      ↓
Invalidate Tenant A UI Cache
      ↓
Load Tenant B Context
```

The client MUST NOT reuse Tenant A authorization state for Tenant B.

---

# 184. Tenant Switch Security

Tenant switching SHOULD invalidate or refresh:

```text
current context
permissions
tenant-scoped cache
dashboard state
selected resources
```

---

# 185. Tenant-Scoped Frontend State

Frontend stores SHOULD namespace tenant data.

Conceptually:

```text
tenantState[A]
tenantState[B]
```

or clear/reload state during tenant switch.

Global user identity can remain separate.

---

# 186. Tenant Isolation and Notifications

Notification delivery SHOULD resolve:

```text
tenantId
recipientId
channel
template
```

before sending.

The template renderer MUST load tenant-specific configuration only from the authorized tenant.

---

# 187. Tenant Isolation and Email Branding

Email messages SHOULD use:

```text
tenant branding
tenant sender policy
tenant content configuration
```

without allowing arbitrary tenant configuration to inject unsafe headers or URLs.

---

# 188. Tenant Isolation and SMS

SMS sender identities and templates MUST be tenant-aware and provider-approved.

Tenant A configuration MUST NOT be used for Tenant B.

---

# 189. Tenant Isolation and File Processing

Background document processing MUST preserve:

```text
tenantId
fileId
operationId
```

Any generated derived file MUST remain in the same tenant scope unless explicitly designed otherwise.

---

# 190. Tenant Isolation and Object Metadata

Object metadata SHOULD contain:

```text
tenantId
resourceId
contentHash
classification
```

This helps enforce storage-layer ownership.

---

# 191. Tenant Isolation and Data Warehousing

Analytics warehouses MUST preserve tenant identifiers.

Tenant access rules MUST apply to reporting data as well as transactional data.

Potential patterns:

```text
row-level security
tenant-specific views
tenant filters
separate schemas
```

depending on architecture.

---

# 192. Tenant Row-Level Security

If supported by downstream analytics infrastructure, enforce:

```text
tenant context
→ row-level filtering
```

as an additional isolation layer.

---

# 193. Tenant Data Lake Security

Raw tenant financial/PII data MUST remain access-controlled and segregated in data-lake storage.

Aggregated analytics should be separated from raw customer data.

---

# 194. Tenant Isolation and Support Tools

Support tooling MUST default to the support user's authorized tenant scope.

Global support tools require explicit tenant selection and elevated permissions.

---

# 195. Support Impersonation

Tenant impersonation MAY be implemented only through a controlled support workflow.

Requirements:

```text
reason
authorization
time limit
target tenant
target user
audit
```

The impersonated session MUST be clearly marked internally.

---

# 196. Tenant Isolation and Auditors

Auditors MAY require read-only access across multiple tenants.

This must be implemented as:

```text
specialized global audit role
```

rather than weakening tenant isolation for normal roles.

---

# 197. Tenant Security Roles

Representative roles:

```text
TENANT_ADMIN
TENANT_FINANCE_ADMIN
TENANT_OPERATIONS
TENANT_COMPLIANCE
TENANT_AUDITOR
TENANT_SUPPORT
PLATFORM_ADMIN
PLATFORM_SECURITY
PLATFORM_AUDITOR
```

Exact RBAC configuration belongs in the Security Model.

---

# 198. Tenant Privilege Boundaries

A tenant user MUST NOT:

```text
modify another tenant
read platform secrets
access platform database
modify global roles
read other tenant audit logs
replay another tenant events
```

---

# 199. Tenant Isolation and Billing

A tenant's subscription/usage information MUST remain private to that tenant except for authorized platform operators.

Tenant A MUST NOT see Tenant B's:

```text
plan
usage
invoice
payment status
billing history
```

unless explicitly permitted by a platform-level business function.

---

# 200. Tenant Isolation and Platform Administration

Platform-wide dashboards may aggregate tenant activity.

However:

```text
raw tenant records
```

should not be exposed unless the operator requires them for an authorized purpose.

---

# 201. Tenant Data Residency

The architecture MAY support tenant-specific residency requirements.

Tenant metadata SHOULD record:

```text
region
dataResidencyPolicy
isolationTier
```

if legally/business relevant.

---

# 202. Tenant Regional Placement

Potential model:

```text
Tenant A → Uganda Region
Tenant B → East Africa Region
Tenant C → Dedicated Region
```

The application domain remains tenant-aware regardless of physical placement.

---

# 203. Tenant Regional Isolation

Regional routing MUST preserve:

```text
tenant identity
authorization
data ownership
encryption
audit
```

Routing must never be used to bypass authorization.

---

# 204. Tenant Security Configuration

Tenant-specific security settings MAY include:

```text
MFA requirement
password policy
session duration
IP allowlist
approval thresholds
notification rules
```

Tenant security settings MUST not weaken global minimum security requirements.

---

# 205. Security Policy Precedence

Recommended precedence:

```text
Global Security Policy
        >
Platform Policy
        >
Tenant Policy
        >
User Preference
```

A tenant may strengthen controls but SHOULD NOT weaken mandatory platform/security baseline requirements.

---

# 206. Tenant Financial Policy Precedence

Financial configuration should similarly respect controlled precedence:

```text
Regulatory / Accounting Requirements
        >
Platform Financial Controls
        >
Tenant Accounting Configuration
        >
Product Configuration
```

Tenant customization cannot bypass ledger invariants.

---

# 207. Tenant Data Retention

Tenant-specific retention MAY be more restrictive than global defaults.

However:

```text
financial
regulatory
audit
```

retention requirements remain subject to platform/legal policy.

---

# 208. Tenant Data Export Rights

Tenant administrators may request authorized exports of their organization's data.

Exports MUST respect:

```text
role
scope
privacy
retention
regulatory restrictions
financial integrity
```

---

# 209. Tenant Data Portability

If tenant portability is supported, exported data SHOULD include:

```text
tenant-owned business records
relevant financial statements
authorized audit metadata
file metadata
```

while excluding:

```text
platform secrets
other tenant data
internal security mechanisms
```

---

# 210. Tenant Destruction

Permanent destruction requires:

```text
approval
retention validation
financial closure
legal validation
audit evidence
secure deletion process
```

Destruction MUST not be performed through ordinary tenant-admin APIs.

---

# 211. Multi-Tenant API Error Handling

For unauthorized cross-tenant resource access, the platform MAY return:

```text
404 RESOURCE_NOT_FOUND
```

to avoid exposing resource existence.

The exact policy MUST be consistent.

---

# 212. Tenant Access Error

Recommended machine code:

```text
TENANT_ACCESS_DENIED
```

or:

```text
RESOURCE_NOT_FOUND
```

depending on information-disclosure policy.

---

# 213. Tenant Context Error

If no authorized tenant context exists:

```text
TENANT_CONTEXT_REQUIRED
```

The request MUST stop before accessing tenant-owned resources.

---

# 214. Tenant Suspension Error

When a suspended tenant attempts a restricted operation:

```text
TENANT_SUSPENDED
```

may be returned where disclosure is appropriate.

---

# 215. Tenant Closed Error

Attempts to perform prohibited operations on a closed tenant should return a stable error:

```text
TENANT_CLOSED
```

where appropriate.

---

# 216. Tenant Isolation Metrics

Recommended:

```text
tenant_access_denied_total
cross_tenant_attempts_total
tenant_query_failures_total
tenant_context_missing_total
tenant_context_mismatch_total
tenant_cache_collision_total
tenant_event_mismatch_total
tenant_job_mismatch_total
```

---

# 217. Tenant Isolation Alerts

High-priority alerts SHOULD trigger on:

```text
cross-tenant access attempt
tenant context mismatch
foreign account reference
foreign payment reference
foreign event processing
foreign file access
foreign job execution
```

---

# 218. Tenant Isolation Audit

Audit should record:

```text
actor
sourceTenant
targetTenant
resource
action
result
reason
timestamp
correlationId
```

for privileged cross-tenant operations.

---

# 219. Tenant Architecture Invariants

The following are mandatory:

```text
1. Every tenant-owned record has authoritative tenant ownership.
2. Tenant context is derived from trusted identity/membership.
3. Client-provided tenant identifiers cannot override authorization.
4. Every tenant query is tenant-scoped.
5. Tenant-scoped unique keys prevent collisions.
6. Financial records cannot cross tenant boundaries.
7. Background jobs carry tenant context.
8. Events carry tenant context where relevant.
9. Cache keys are tenant-safe.
10. Files are tenant-scoped.
11. Reports are tenant-scoped.
12. Exports are tenant-scoped.
13. Tenant switching invalidates prior tenant-scoped client state.
14. Platform-level cross-tenant access is exceptional and audited.
15. Tenant suspension/revocation affects authorization.
16. Tenant closure preserves required financial and regulatory history.
17. Recovery preserves tenant isolation.
18. Physical isolation may change without changing tenant-domain semantics.
19. Cross-tenant analytics require controlled aggregation/access.
20. Tenant isolation must be continuously tested.
```

---

# 220. Non-Negotiable Prohibitions

The following are prohibited:

```text
1. Trusting req.body.tenantId as authorization.
2. Trusting X-Tenant-ID without membership validation.
3. Querying tenant-owned data without tenant scope.
4. Allowing a tenant user to select another tenant arbitrarily.
5. Using global cache keys for tenant-owned data.
6. Processing jobs without tenant context.
7. Applying events without tenant/resource verification.
8. Posting financial entries to another tenant's accounts.
9. Matching statements across tenants.
10. Returning raw records across tenant boundaries.
11. Cascading tenant deletion into financial history.
12. Allowing tenant configuration to disable mandatory security.
13. Reusing tenant-specific idempotency keys globally.
14. Publishing tenant-sensitive events without authorization controls.
15. Treating physical database separation as a substitute for application authorization.
```

---

# 221. Tenant Production Readiness Gate

The multi-tenant architecture is production-ready only when:

```text
[ ] Tenant identity defined
[ ] Tenant lifecycle defined
[ ] Tenant provisioning implemented
[ ] Tenant membership implemented
[ ] Tenant context established
[ ] Authorization enforced
[ ] Repository tenant scoping enforced
[ ] Tenant-aware unique indexes implemented
[ ] Financial tenant isolation implemented
[ ] Payment tenant isolation implemented
[ ] Callback tenant resolution implemented
[ ] Settlement tenant isolation implemented
[ ] Worker tenant isolation implemented
[ ] Event tenant isolation implemented
[ ] Cache tenant isolation implemented
[ ] File tenant isolation implemented
[ ] Reporting tenant isolation implemented
[ ] Export isolation implemented
[ ] Tenant suspension implemented
[ ] Tenant closure implemented
[ ] Tenant recovery tested
[ ] Cross-tenant attack tests implemented
[ ] Monitoring implemented
[ ] Audit implemented
[ ] Incident response defined
```

---

# 222. Enterprise Tenant Architecture

The target enterprise model is:

```text
                              TITech Platform
                                     │
                   ┌─────────────────┼─────────────────┐
                   │                 │                 │
                   ▼                 ▼                 ▼
               Tenant A           Tenant B           Tenant C
                   │                 │                 │
          ┌────────┼───────┐ ┌──────┼────────┐ ┌──────┼────────┐
          │        │       │ │      │        │ │      │        │
          ▼        ▼       ▼ ▼      ▼        ▼ ▼      ▼        ▼
        Users    Groups  Finance Users       Finance Users    Finance
          │        │       │ │      │        │ │      │        │
          └────────┼───────┘ └──────┼────────┘ └──────┼────────┘
                   │                 │                 │
                   ▼                 ▼                 ▼
              Tenant Data       Tenant Data       Tenant Data
                   │                 │                 │
                   ▼                 ▼                 ▼
               Tenant A          Tenant B          Tenant C
                Ledger             Ledger             Ledger
```

The platform layer coordinates them without collapsing their ownership boundaries.

---

# 223. Canonical Tenant-Aware Request Flow

```text
Client
  ↓
TLS
  ↓
API Edge
  ↓
Authentication
  ↓
Identity Resolution
  ↓
Tenant Membership
  ↓
Tenant Context
  ↓
Authorization
  ↓
Resource Ownership
  ↓
Application Service
  ↓
Tenant-Aware Repository
  ↓
Tenant-Scoped Data
  ↓
Audit / Events
```

---

# 224. Canonical Tenant-Aware Financial Flow

```text
Tenant User
    ↓
Payment / Loan / Savings API
    ↓
Trusted Tenant Context
    ↓
Authorization
    ↓
Idempotency
    ↓
Business Operation
    ↓
Financial Command
    ↓
Ledger Validation
    ↓
Tenant Account Validation
    ↓
Balanced Journal
    ↓
Atomic Commit
    ↓
Audit
    ↓
Outbox
```

---

# 225. Canonical Tenant-Aware Background Flow

```text
Schedule / Event
      ↓
Tenant-Aware Job
      ↓
Claim
      ↓
Validate Tenant
      ↓
Load Current State
      ↓
Process
      ↓
Tenant-Scoped Persistence
      ↓
Transition
      ↓
Audit
      ↓
Event
```

---

# 226. Canonical Tenant-Aware Event Flow

```text
Tenant Operation
      ↓
Domain State
      ↓
OutboxEvent
      │
      ├── tenantId
      ├── eventId
      ├── aggregateId
      └── operationId
      ↓
Publisher
      ↓
Consumer
      ↓
Validate tenant/resource
      ↓
Apply
```

---

# 227. Canonical Tenant-Aware Recovery

```text
Failure
  ↓
Identify Tenant
  ↓
Identify Operation
  ↓
Preserve Evidence
  ↓
Verify Tenant Ownership
  ↓
Reconcile
  ↓
Correct
  ↓
Audit
  ↓
Restore
```

---

# 228. Tenant Architecture Change Control

Any change affecting:

```text
tenant identity
tenant context
authorization
repository filtering
financial ownership
data partitioning
event routing
cache keys
worker routing
tenant placement
```

MUST undergo architecture and security review.

---

# 229. Tenant Change Impact Assessment

Every tenant architecture change SHOULD document:

```text
Current Isolation Model
Proposed Isolation Model
Affected Domains
Affected Models
Affected APIs
Affected Events
Affected Workers
Affected Caches
Affected Financial Controls
Security Impact
Migration Strategy
Rollback Strategy
Test Strategy
```

---

# 230. Tenant Data Migration

Tenant migration MUST preserve:

```text
tenantId
business identifiers
financial transaction IDs
journal IDs
operation IDs
event IDs
audit IDs
provider references
```

No identity rewriting should occur without a formally controlled migration design.

---

# 231. Tenant Migration Validation

Before cutover:

```text
[ ] Record counts match
[ ] Financial totals match
[ ] Account balances match
[ ] Transaction uniqueness verified
[ ] Events preserved
[ ] Audit preserved
[ ] File checksums verified
[ ] API tenant access verified
[ ] Cross-tenant tests pass
```

---

# 232. Tenant Scaling Strategy

The platform SHOULD evolve from:

```text
shared infrastructure
```

toward:

```text
logical tenant partitioning
→
tenant-aware sharding
→
selective physical isolation
→
dedicated infrastructure for high-value/high-risk tenants
```

The domain model SHOULD remain stable throughout.

---

# 233. Tenant Isolation and Kubernetes

When deployed on Kubernetes, tenant isolation may use:

```text
namespace
network policy
service account
dedicated worker pools
resource quota
node pools
```

Physical Kubernetes isolation SHOULD complement, not replace, application-level tenant isolation.

---

# 234. Tenant Resource Quotas in Kubernetes

For tenants requiring dedicated workload pools, apply:

```text
CPU limits
memory limits
worker concurrency
queue limits
storage limits
```

Tenant-specific limits SHOULD protect platform stability.

---

# 235. Tenant Network Isolation

Application services SHOULD prevent direct network access from one tenant-specific workload to another tenant's isolated infrastructure where physical isolation exists.

---

# 236. Tenant Database Credentials

Where dedicated databases exist, each tenant database SHOULD use separate credentials and least-privilege roles.

A compromised Tenant A connection MUST NOT grant Tenant B database access.

---

# 237. Tenant Isolation and Encryption Keys

Where tenant-specific keying is used:

```text
Tenant A → Key A
Tenant B → Key B
```

Key access MUST be authorized by tenant/security context.

---

# 238. Tenant Security Principle for Shared Infrastructure

Shared infrastructure does not mean shared authorization.

Even when:

```text
same MongoDB
same Redis
same API pods
same queue
```

are used, logical tenant isolation MUST remain enforced.

---

# 239. Tenant Isolation and Deployment

Deployment changes MUST avoid introducing:

```text
global mutable state
tenant-unaware singleton caches
tenant-unaware queues
tenant-unaware batch jobs
```

without explicit design.

---

# 240. Tenant-Aware Configuration Loading

Configuration loaders MUST distinguish:

```text
global configuration
tenant configuration
secret configuration
```

Tenant configuration MUST not accidentally override global security requirements.

---

# 241. Tenant Architecture Security Principle

The most important rule remains:

> **The tenant boundary is enforced by identity, authorization, data ownership, persistence, execution context, and operational controls simultaneously.**

---

# 242. Final Enterprise Multi-Tenant Principle

TITech Community Capital's multi-tenant architecture is designed around a simple invariant:

```text
ONE PLATFORM
      │
      ├── Tenant A
      ├── Tenant B
      ├── Tenant C
      └── Tenant N
```

Every tenant receives an independent logical business and financial boundary while sharing appropriate platform capabilities.

The governing rule is:

> **No tenant must be able to access, infer, modify, execute, reconcile, cache, publish, export, or financially affect another tenant's authoritative state unless a deliberately designed platform-level capability explicitly permits the operation under strong authorization, audit, isolation, and security controls.**

---

# 243. Related Architecture Documents

This document MUST remain aligned with:

```text
docs/02-architecture/ARCHITECTURE_MAP.md
docs/02-architecture/DATA_MODEL_CATALOGUE.md
docs/02-architecture/SECURITY_MODEL.md
docs/02-architecture/SERVICE_CATALOGUE.md
docs/02-architecture/API_CATALOGUE.md
docs/02-architecture/EVENT_CATALOGUE.md
docs/02-architecture/FINANCIAL_LEDGER_SPECIFICATION.md
docs/02-architecture/TRANSACTION_STATE_MACHINE.md
```

Implementation areas SHOULD remain aligned with:

```text
backend/middleware/
backend/routes/
backend/controllers/
backend/modules/
backend/modules/models/
backend/shared/
backend/modules/finance/
backend/modules/payment/
backend/modules/settlement/
backend/modules/compliance/
backend/modules/risk/
backend/modules/fraud/
```

Any change to tenant ownership, tenant context, authorization boundaries, financial isolation, event routing, cache strategy, worker execution, database topology, or tenant placement MUST be reflected in this document and the affected architecture/security/data-model documentation.

---

**End of Multi-Tenant Architecture**