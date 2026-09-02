# TITech Community Capital Ltd

# Enterprise Dependency Map

**Document:** `docs/02-architecture/DEPENDENCY_MAP.md`
**Status:** Production Architecture Dependency Baseline
**Audience:** Architecture, Backend Engineering, Finance Engineering, Payment Engineering, Security, Compliance, DevOps/SRE, QA, Operations, Internal Audit
**Owner:** Architecture / Platform Engineering
**Classification:** Internal / Confidential / Architecture Control
**Version:** 1.0.0
**Review Cadence:** At least annually and after any material architectural, service, dependency, infrastructure, financial, or integration change

---

# 1. Purpose

This document defines the authoritative dependency architecture for TITech Community Capital.

It describes:

* service dependencies;
* domain dependencies;
* infrastructure dependencies;
* data dependencies;
* API dependencies;
* event dependencies;
* financial dependencies;
* security dependencies;
* provider dependencies;
* runtime dependencies;
* worker dependencies;
* dependency direction;
* allowed coupling;
* prohibited coupling;
* critical-path dependencies;
* optional dependencies;
* degraded-mode behavior;
* dependency ownership;
* failure propagation;
* startup dependencies;
* shutdown dependencies;
* migration dependencies;
* production readiness requirements.

The goal is to prevent architectural drift caused by unmanaged coupling.

The dependency map complements:

```text
docs/02-architecture/ARCHITECTURE_MAP.md
docs/02-architecture/SERVICE_CATALOGUE.md
docs/02-architecture/API_CATALOGUE.md
docs/02-architecture/DATA_MODEL_CATALOGUE.md
docs/02-architecture/SECURITY_MODEL.md
docs/02-architecture/MULTI_TENANT_ARCHITECTURE.md
docs/02-architecture/EVENT_CATALOGUE.md
docs/02-architecture/FINANCIAL_LEDGER_SPECIFICATION.md
docs/02-architecture/TRANSACTION_STATE_MACHINE.md
```

---

# 2. Governing Principle

The central dependency rule is:

> **Dependencies must flow toward stable, authoritative capabilities; financial and security invariants must never depend on optional integrations; external providers must remain behind adapters; asynchronous consumers must not become hidden authorities; and every production dependency must have explicit ownership, failure behavior, observability, and recovery semantics.**

---

# 3. Dependency Architecture Objectives

The dependency architecture MUST optimize for:

```text
Low Coupling
High Cohesion
Clear Ownership
Predictable Failure
Financial Integrity
Tenant Isolation
Security
Operability
Testability
Replaceability
Scalability
Recoverability
```

A dependency is acceptable only when its benefits justify the operational and architectural coupling it introduces.

---

# 4. Dependency Categories

Dependencies are classified as:

```text
1. Domain Dependency
2. Application Dependency
3. Data Dependency
4. Infrastructure Dependency
5. External Provider Dependency
6. Event Dependency
7. Runtime Dependency
8. Security Dependency
9. Deployment Dependency
10. Operational Dependency
11. Development Dependency
12. Optional Dependency
```

---

# 5. Dependency Direction

Preferred direction:

```text
Experience / API
        ↓
Application Services
        ↓
Domain Services
        ↓
Authoritative Data / Infrastructure
```

External integration:

```text
Domain
  ↓
Port / Interface
  ↓
Adapter
  ↓
External Provider
```

Event-driven:

```text
Authoritative State
  ↓
Outbox
  ↓
Publisher
  ↓
Consumer
```

Dependencies MUST NOT reverse these boundaries without explicit architectural justification.

---

# 6. High-Level Dependency Architecture

```text
                           ┌────────────────────┐
                           │ Clients / Frontend │
                           └─────────┬──────────┘
                                     │
                                     ▼
                           ┌────────────────────┐
                           │ API / Edge Layer   │
                           └─────────┬──────────┘
                                     │
                ┌────────────────────┼────────────────────┐
                │                    │                    │
                ▼                    ▼                    ▼
          Identity / Auth       SaaS / Tenant        Business Domains
                                   Platform                │
                                                           │
                        ┌──────────────┬──────────────┬─────┴───────┐
                        │              │              │             │
                        ▼              ▼              ▼             ▼
                     Savings        Lending       Payments      Compliance
                        │              │              │             │
                        └──────────────┴──────┬───────┴─────────────┘
                                             │
                                             ▼
                                      Financial Core
                                             │
                               ┌─────────────┼─────────────┐
                               │             │             │
                               ▼             ▼             ▼
                           Settlement    Reconciliation  Reporting
                               │
                               ▼
                      Provider / External APIs
                               │
                               ▼
                   Event / Workflow Infrastructure
                               │
                ┌──────────────┼──────────────┐
                │              │              │
                ▼              ▼              ▼
             Outbox         Queues          Workers
                │              │              │
                └──────────────┼──────────────┘
                               │
                               ▼
                       Data / Infrastructure
                     MongoDB / Redis / Storage
                               │
                               ▼
                       Observability / Ops
```

---

# 7. Dependency Tiers

The platform should be understood as dependency tiers.

```text
TIER 0
Runtime / OS / Network

TIER 1
Database / Cache / Storage

TIER 2
Financial / Identity / Security Foundations

TIER 3
Core Business Domains

TIER 4
Integration / Workflow / Settlement

TIER 5
Reporting / Analytics / Notifications

TIER 6
Client / Presentation
```

Higher tiers MUST NOT create hidden feedback dependencies into lower layers.

---

# 8. Tier 0 — Runtime Dependencies

Typical dependencies:

```text
Node.js
Operating System
Container Runtime
Network
TLS
DNS
Process Manager / Orchestrator
```

Runtime dependencies are foundational.

Failure may make the entire service unavailable.

---

# 9. Tier 1 — Infrastructure Dependencies

Primary infrastructure:

```text
MongoDB
Redis
Queue / Worker Runtime
Object Storage
Secrets Management
Observability Platform
```

These dependencies support many services and therefore require strong reliability controls.

---

# 10. Tier 2 — Platform Foundations

Foundational application capabilities:

```text
Identity
Authentication
Authorization
Tenant Context
Financial Core
Audit
Configuration
Observability
```

These are high-leverage dependencies.

Changes require architectural review.

---

# 11. Tier 3 — Business Domains

Primary business domains:

```text
Community Finance
Savings
Lending
Payments
Settlement
Compliance
Risk
Fraud
Billing
```

These depend on platform foundations.

They SHOULD NOT create uncontrolled lateral dependencies.

---

# 12. Tier 4 — Workflow / Integration

Supporting capabilities:

```text
Workflow Engine
Distributed Transaction Manager
Event Publisher
Outbox
Callback Processing
Provider Adapters
Queue Workers
Settlement Jobs
```

These coordinate business capabilities but MUST NOT become hidden system-of-record authorities.

---

# 13. Tier 5 — Read / Notification / Analytics

Examples:

```text
Reporting
Dashboard Aggregation
Notifications
Forecasting
Repair Analytics
Executive Dashboard
```

These should generally depend on authoritative events/data.

Core financial state SHOULD NOT depend on these components.

---

# 14. Tier 6 — Experience Layer

Examples:

```text
Web Application
Mobile Application
Admin Console
Partner Clients
```

Experience components consume APIs and events.

They MUST NOT directly depend on:

```text
MongoDB
Redis
Ledger Collections
Provider Credentials
Internal Worker Queues
```

---

# 15. Critical Dependencies

A dependency is **critical** when its failure prevents a core safety or financial operation.

Typical critical dependencies:

```text
MongoDB
Identity / Authorization
Financial Core
Tenant Context
Secrets Management
```

Conditional critical dependencies:

```text
Redis
Queue
Provider APIs
```

Their criticality depends on the operation being executed.

---

# 16. Optional Dependencies

Optional capabilities MAY include:

```text
BullMQ
Advanced AI
Analytics Projection
Notification Providers
Certain Observability Backends
Provider-Specific Enhancements
```

Optional dependencies MUST fail gracefully.

An optional module failure MUST NOT crash the entire application.

---

# 17. Dependency Classification by Failure

Each dependency SHOULD have one of:

```text
CRITICAL
DEGRADED
OPTIONAL
ASYNC
BEST_EFFORT
EXTERNAL
```

Example:

| Dependency            | Class                                          |
| --------------------- | ---------------------------------------------- |
| MongoDB               | CRITICAL                                       |
| Identity              | CRITICAL                                       |
| Financial Core        | CRITICAL                                       |
| Redis                 | CRITICAL/DEGRADED depending on feature         |
| MTN API               | EXTERNAL                                       |
| Airtel API            | EXTERNAL                                       |
| Notification Provider | BEST_EFFORT                                    |
| Reporting Projection  | ASYNC                                          |
| AI Classification     | OPTIONAL/ASYNC                                 |
| Fraud Analytics       | ASYNC/CRITICAL to risk workflows where enabled |

---

# 18. Dependency Ownership

Every production dependency MUST have:

```text
Technical Owner
Business Owner
Operational Owner
Security Owner where applicable
Escalation Path
```

An unowned dependency is architectural risk.

---

# 19. Domain Dependency Matrix

| Domain           | Depends On                                            | Must Not Depend On            |
| ---------------- | ----------------------------------------------------- | ----------------------------- |
| Identity         | DB, security config                                   | Payment provider              |
| SaaS/Tenant      | Identity, DB, Billing                                 | Raw ledger collections        |
| Savings          | Tenant, Member, Financial Core                        | Provider-specific internals   |
| Lending          | Tenant, Risk, Financial Core                          | Notification delivery success |
| Payments         | Tenant, Provider Adapter, Financial Core              | Reporting projections         |
| Settlement       | Payments, Statements, Financial Core                  | UI/frontend                   |
| Compliance       | Identity, Tenant, External Providers                  | UI state                      |
| Risk             | Lending data, transaction data                        | Direct ledger mutation        |
| Fraud            | Payments, Financial events                            | Direct balance mutation       |
| Billing          | Tenant, Subscription, Financial Core where applicable | Raw provider implementation   |
| Reporting        | Financial events/data                                 | Business write path           |
| Notifications    | Events                                                | Financial Core authority      |
| Audit            | Domain events/commands                                | Client-provided truth         |
| Workflow         | Domain services, state                                | Direct UI state               |
| Provider Adapter | HTTP/SDK, secrets                                     | Domain persistence            |

---

# 20. Identity Dependencies

Identity depends on:

```text
MongoDB
Secrets / Token Configuration
Security Middleware
```

Identity SHOULD NOT depend on:

```text
Payments
Loans
Savings
Reporting
Notifications
```

unless optional flows explicitly require them.

Authentication is a platform foundation.

---

# 21. Authentication Dependencies

Authentication typically depends on:

```text
User Repository
Password Hashing
Session / Refresh Token Store
Rate Limiting
Audit / Security Event
```

Authentication SHOULD NOT call the ledger.

---

# 22. Authorization Dependencies

Authorization depends on:

```text
Identity
Tenant Membership
Roles
Permissions
Resource Ownership
Tenant Context
```

Authorization SHOULD remain independent from payment providers and reporting.

---

# 23. Tenant Context Dependencies

Tenant context depends on:

```text
Authenticated Identity
Tenant Membership
Tenant Status
Request Context
```

Tenant context MUST be available before accessing tenant-owned data.

---

# 24. Financial Core Dependencies

The Financial Core depends on:

```text
Tenant Context
Financial Data Models
Database Transactions
Authorization Context
Idempotency
Audit
Outbox
```

The Financial Core MUST NOT depend on:

```text
UI
Notification Provider
Dashboard
Reporting Projection
AI
Fraud Analytics
```

for its core accounting correctness.

---

# 25. Financial Core Dependency Direction

Correct:

```text
Savings
Loans
Payments
Billing
Settlement
       ↓
Financial Core
```

Incorrect:

```text
Financial Core
       ↓
Savings
```

when the Financial Core would become dependent on a business feature.

---

# 26. Ledger Dependency Rule

The following dependency is mandatory:

```text
Financial Operation
      ↓
Ledger Service
      ↓
Posting Engine
```

No business module may bypass this path.

---

# 27. Ledger Independence Rule

Ledger posting MUST remain possible even when:

```text
Notification Provider
Reporting
Dashboard
AI
Fraud Analytics
```

are unavailable.

---

# 28. Ledger and Event Dependency

Financial Core may depend on:

```text
Outbox Persistence
```

for durable event creation.

It MUST NOT depend on:

```text
event consumer success
```

for the financial transaction to commit.

---

# 29. Ledger and Redis Dependency

Redis MAY accelerate:

```text
idempotency lookup
rate limiting
locks
cache
```

but:

```text
Ledger
≠
Redis
```

Financial truth MUST survive total Redis failure.

---

# 30. Ledger and Queue Dependency

A ledger operation SHOULD NOT require queue availability to persist financial truth.

Preferred:

```text
Financial Commit
+
Outbox
```

then:

```text
Queue Publication
```

---

# 31. Savings Dependencies

Savings typically depends on:

```text
Tenant
Identity / Authorization
Member
Group
Savings Product
Financial Core
Payment Operation where applicable
```

Savings SHOULD consume the Financial Core, not duplicate it.

---

# 32. Lending Dependencies

Lending typically depends on:

```text
Tenant
Identity / Authorization
Member
Group
Loan Product
Risk
Financial Core
Payment
Compliance where required
```

Lending MUST NOT make loan financial state authoritative outside controlled accounting integration.

---

# 33. Loan Risk Dependency

Loan approval may depend on:

```text
Loan Application
Risk Profile
KYC Status
Business Rules
Approval Rules
```

Risk scoring MUST NOT be the sole holder of loan state.

---

# 34. Payment Dependencies

Payments depend on:

```text
Tenant
Identity / Authorization
Provider Adapter
Idempotency
Callback Processing
Financial Core
```

The payment domain MUST remain provider-neutral.

---

# 35. Payment Provider Dependency

Provider adapters depend on:

```text
Provider API
Authentication
Secrets
HTTP Client
Timeout Configuration
Retry Policy
```

Adapters MUST NOT depend on:

```text
Loan Model
Savings Model
Reporting Model
Frontend
```

---

# 36. MTN Dependency Graph

```text
Payment Service
      ↓
MTN Adapter
      ↓
MTN Authentication
      ↓
HTTP Client
      ↓
MTN API
```

Callback:

```text
MTN
 ↓
MTN Callback Handler
 ↓
Callback Validation
 ↓
Payment Processing
```

---

# 37. Airtel Dependency Graph

```text
Payment Service
      ↓
Airtel Adapter
      ↓
Airtel Authentication
      ↓
HTTP Client
      ↓
Airtel API
```

Callback:

```text
Airtel
 ↓
Airtel Callback Handler
 ↓
Validation
 ↓
Payment Processing
```

---

# 38. Provider Adapter Isolation

A provider adapter MUST NOT directly:

```text
update ledger
update loan balance
modify savings balance
create audit records by bypassing standard APIs
```

Instead:

```text
Provider Adapter
      ↓
Normalized Provider Result
      ↓
Payment Service
      ↓
Financial Core
```

---

# 39. Callback Processing Dependencies

Callback subsystem depends on:

```text
Provider Handler
Callback Registry
Callback Validator
Callback Normalizer
Idempotency
Provider Transaction
Payment Operation
Financial Core
Audit
```

Callback receipt MUST NOT directly mutate business records.

---

# 40. Settlement Dependencies

Settlement depends on:

```text
Provider Statement
Payment Operations
Provider Transactions
Statement Processing
Reconciliation
Financial Core
```

Settlement MUST NOT depend on frontend/API availability.

---

# 41. Statement Processing Dependencies

Statement Processing typically depends on:

```text
File/Object Storage
Statement Repository
Statement Normalizer
Statement Validator
Batch Manager
Reconciliation Service
```

Optional:

```text
AI Repair Classification
Forecasting
```

These optional systems MUST NOT block basic statement ingestion.

---

# 42. Reconciliation Dependencies

Reconciliation depends on:

```text
Internal Financial Transactions
External Statement/Provider Records
Matching Rules
Financial Core
Repair Service
```

Reconciliation MUST remain independent from dashboard availability.

---

# 43. Compliance Dependencies

Compliance may depend on:

```text
Identity
Tenant
Member
KYC Provider
AML Provider
Regulatory Adapter
Document Storage
Audit
```

Compliance services SHOULD NOT depend on frontend state.

---

# 44. Risk Dependencies

Risk services MAY depend on:

```text
Loan Application
Member Data
Repayment History
Financial Events
KYC Status
Risk Model
Scoring Engine
```

Risk should consume financial facts rather than mutate them.

---

# 45. Fraud Dependencies

Fraud services MAY consume:

```text
Payment Events
Financial Events
Member Events
Login/Security Events
Risk Signals
```

Fraud MUST NOT directly edit ledger records.

---

# 46. Billing Dependencies

Billing depends on:

```text
Tenant
Subscription
Plan
Entitlements
Payment
Financial Core where accounting is required
```

Billing must distinguish:

```text
Subscription State
```

from:

```text
Financial State
```

---

# 47. Reporting Dependencies

Reporting should depend on:

```text
Financial Core
Domain Events
Read Models
Controlled Queries
```

Reporting MUST NOT become an upstream dependency of:

```text
Ledger
Payment
Loan
Savings
```

---

# 48. Dashboard Dependencies

Dashboards should consume:

```text
Reporting Projections
Read Models
Operational Metrics
```

Dashboards MUST NOT directly query sensitive operational collections indiscriminately.

---

# 49. Notification Dependencies

Notification services depend on:

```text
Events
Template Configuration
Tenant Branding
Email/SMS/Push Providers
```

Financial systems MUST NOT synchronously depend on successful notification delivery.

---

# 50. Audit Dependencies

Audit depends on:

```text
Application Events
Financial Events
Security Events
Administrative Commands
```

Audit should remain independently durable.

A failed notification MUST NOT delete audit evidence.

---

# 51. Workflow Dependencies

Workflow orchestration depends on:

```text
State Machines
Persistent Operation Models
Queue
Domain Services
Outbox
Idempotency
```

Workflow SHOULD orchestrate.

It should NOT become the authoritative owner of every domain's state.

---

# 52. Distributed Transaction Manager Dependencies

The Distributed Transaction Manager depends on:

```text
Persistent Operation State
State Machine
Idempotency
Compensation
Retry Policy
Timeout Policy
Audit
```

It should NOT attempt a global database transaction across independent providers.

---

# 53. Event Publisher Dependencies

Event Publisher depends on:

```text
Outbox
Message Transport
Serialization
Schema Validation
Retry
Dead Letter
Observability
```

It does not own domain state.

---

# 54. Outbox Dependencies

Outbox depends primarily on:

```text
Primary Database
Domain Transaction
Event Contract
```

Outbox publication MUST survive temporary queue failure.

---

# 55. Queue Dependencies

Queues depend on:

```text
Redis / Broker
Worker Runtime
Job Definitions
```

Queue failure SHOULD degrade asynchronous processing but MUST NOT silently destroy durable operations.

---

# 56. Worker Dependencies

Workers may depend on:

```text
Queue
Database
Redis
Domain Service
External Provider
```

Each worker MUST define which dependencies are critical versus optional.

---

# 57. Worker Financial Dependencies

A financial worker may depend on:

```text
Database
Financial Core
Queue
Provider
```

but final accounting truth remains in the Financial Core.

---

# 58. Infrastructure Dependency Map

```text
Application
   │
   ├── MongoDB
   │
   ├── Redis
   │
   ├── Queue / Worker Runtime
   │
   ├── Object Storage
   │
   ├── Secrets Management
   │
   └── Observability
```

---

# 59. MongoDB Dependency

MongoDB is the primary persistent system of record for application/domain data.

Services depending on MongoDB include:

```text
Identity
SaaS
Community Finance
Lending
Payments
Settlement
Compliance
Risk
Fraud
Billing
Workflow
Outbox
Audit
```

Because MongoDB is highly shared, production availability is critical.

---

# 60. MongoDB Independence Rules

Services MUST:

```text
use controlled repositories
use tenant-scoped queries
use explicit indexes
use transactions where required
use least-privilege credentials
```

Services MUST NOT:

```text
access another domain's collections arbitrarily
```

---

# 61. Redis Dependency

Redis may support:

```text
cache
rate limiting
idempotency acceleration
locks
session/token support
queue
temporary coordination
```

Redis MUST remain non-authoritative for financial state.

---

# 62. Redis Degradation

If Redis becomes unavailable:

```text
financial truth
MUST remain safe
```

Feature-specific behavior MAY degrade:

```text
rate limiter fallback
cache miss
temporary queue pause
slower idempotency lookup
```

The application MUST define appropriate fallback behavior.

---

# 63. Queue Dependency

Queue infrastructure supports:

```text
background jobs
notifications
reconciliation
settlement
event consumers
reports
```

Queue failure MUST NOT erase durable operation state.

---

# 64. Object Storage Dependency

Object storage may contain:

```text
KYC documents
statements
regulatory files
exports
attachments
```

Object references MUST remain access-controlled and tenant-scoped.

---

# 65. Secrets Management Dependency

Secrets management is critical for:

```text
database credentials
JWT secrets
provider credentials
OAuth client secrets
encryption keys
```

Failure mode SHOULD be:

```text
fail closed
```

for operations requiring unavailable secrets.

The application MUST NOT invent fallback secrets in production.

---

# 66. Observability Dependency

Observability systems support:

```text
logs
metrics
traces
alerts
dashboards
```

Observability failure SHOULD NOT corrupt business state.

Where possible:

```text
business operation
continues safely
telemetry buffers/degrades
```

---

# 67. External Provider Dependency Model

External providers include:

```text
MTN MoMo
Airtel Money
Banks
Identity Providers
KYC Providers
AML Providers
Regulatory Systems
SMS Providers
Email Providers
Push Notification Providers
```

Every external dependency MUST define:

```text
authentication
timeout
retry
circuit breaker
rate limit
failure state
reconciliation
credential rotation
monitoring
```

---

# 68. External Dependency Rule

External systems are:

```text
untrusted
non-transactional
failure-prone
independently operated
```

The platform MUST not assume external availability or atomicity.

---

# 69. Provider Availability Model

External provider failure SHOULD affect only dependent capabilities.

Example:

```text
MTN outage
```

should not automatically make:

```text
Loan Reporting
Member Search
Internal Ledger Reads
```

unavailable.

---

# 70. Provider Circuit Breaker

Provider integrations SHOULD implement:

```text
CLOSED
 ↓
OPEN
 ↓
HALF_OPEN
 ↓
CLOSED / OPEN
```

to prevent cascading failures.

---

# 71. Provider Retry Dependency

Retry only when:

```text
failure is classified retryable
AND
operation is idempotent
```

Unknown payment outcomes require reconciliation.

---

# 72. Provider Reconciliation Dependency

When provider outcome is uncertain:

```text
Provider Status
+
Callback
+
Statement
+
Internal Transaction
```

must be reconciled.

---

# 73. Development Dependencies

Development/runtime dependencies SHOULD include:

```text
Node.js
npm
Jest
Supertest
Mongoose
Express
ESLint
Type/Schema Validation
OpenTelemetry-compatible tooling
```

Actual production dependencies MUST be inventoried separately from test/development dependencies.

---

# 74. Dependency Version Governance

Production dependencies MUST be version-controlled.

Use:

```text
package-lock.json
```

or equivalent package manager lockfile.

Unbounded dependency ranges SHOULD be avoided for critical packages.

---

# 75. Dependency Upgrade Policy

Upgrades MUST consider:

```text
security
breaking changes
runtime compatibility
database compatibility
API behavior
observability
performance
financial correctness
```

Critical dependencies SHOULD be upgraded through staging before production.

---

# 76. Node.js Dependency

The backend currently targets a modern supported Node.js runtime.

The project MUST define and enforce a minimum supported major version.

Example:

```text
MINIMUM_NODE_MAJOR
```

Runtime enforcement SHOULD happen at startup and CI.

---

# 77. Mongoose Dependency

Mongoose is responsible for:

```text
schema
validation
MongoDB access
indexes
transactions
```

Business ownership remains above the persistence layer.

Mongoose schema hooks MUST NOT become hidden domain engines.

---

# 78. Express Dependency

Express is an API transport layer.

Express handlers SHOULD depend on:

```text
application services
middleware
validation
```

not on raw financial persistence.

---

# 79. Jest Dependency

Jest SHOULD support:

```text
unit tests
integration tests
state-machine tests
tenant isolation tests
financial invariant tests
contract tests
```

---

# 80. Supertest Dependency

Supertest SHOULD support:

```text
API integration testing
authentication testing
tenant isolation testing
error contract testing
```

---

# 81. Optional BullMQ Dependency

BullMQ, if installed, may provide:

```text
queue
job
retry
worker
```

If unavailable:

```text
core API startup
MUST NOT necessarily fail
```

unless the deployment explicitly declares BullMQ mandatory.

Optional dependency availability MUST be visible through health/readiness state.

---

# 82. Queue Service Dependency

A custom QueueService SHOULD abstract the underlying queue implementation.

Consumers should depend on:

```text
QueueService interface
```

rather than:

```text
BullMQ internals
```

---

# 83. Optional Feature Dependency

Optional components such as:

```text
AI Repair Classifier
Forecasting
Advanced Fraud Models
Advanced Analytics
```

MUST not become mandatory dependencies of the financial core.

---

# 84. Dependency Injection Principle

Services SHOULD receive dependencies through:

```text
constructor injection
factory injection
explicit context
```

Avoid excessive:

```text
global singleton state
```

where it creates hidden coupling.

---

# 85. Dependency Graph Example

```text
PaymentService
 ├── TenantService
 ├── PaymentRepository
 ├── ProviderAdapterFactory
 │    ├── MTNAdapter
 │    └── AirtelAdapter
 ├── IdempotencyService
 ├── LedgerService
 ├── AuditService
 └── EventPublisher
```

This is a valid explicit dependency graph.

---

# 86. Payment Dependency Constraints

PaymentService MUST NOT depend directly on:

```text
MongoDB models for unrelated domains
Frontend
Reporting
Notification provider
Fraud persistence implementation
```

It may publish events consumed by those systems.

---

# 87. Lending Dependency Graph

```text
LoanService
 ├── TenantService
 ├── MemberService
 ├── LoanProductService
 ├── RiskService
 ├── ComplianceService where required
 ├── PaymentService
 ├── LedgerService
 └── EventPublisher
```

---

# 88. Savings Dependency Graph

```text
SavingsService
 ├── TenantService
 ├── MemberService
 ├── GroupService
 ├── SavingsProductService
 ├── PaymentService where applicable
 ├── LedgerService
 └── EventPublisher
```

---

# 89. Settlement Dependency Graph

```text
SettlementService
 ├── StatementRepository
 ├── StatementProcessingService
 ├── PaymentRepository
 ├── ReconciliationService
 ├── RepairService
 ├── LedgerService
 └── EventPublisher
```

---

# 90. Compliance Dependency Graph

```text
ComplianceService
 ├── TenantService
 ├── MemberService
 ├── KYC Provider Adapter
 ├── AML Provider Adapter
 ├── Document Storage
 ├── Regulatory Adapter
 └── AuditService
```

---

# 91. Risk Dependency Graph

```text
RiskService
 ├── LoanApplication
 ├── Member
 ├── Financial Read Model
 ├── Risk Model
 ├── Scoring Engine
 └── EventPublisher
```

Risk MUST NOT depend on direct ledger mutation.

---

# 92. Fraud Dependency Graph

```text
FraudService
 ├── Payment Events
 ├── Financial Events
 ├── Security Events
 ├── Risk Signals
 ├── CrossAccountAnalyzer
 └── EventPublisher
```

Fraud analysis should be event-driven where practical.

---

# 93. Reporting Dependency Graph

```text
ReportingService
 ├── Financial Data
 ├── Domain Events
 ├── Read Models
 └── Aggregation Services
```

Reporting MUST NOT be a prerequisite for financial posting.

---

# 94. Notification Dependency Graph

```text
NotificationService
 ├── Event Consumer
 ├── Tenant Branding
 ├── Template Repository
 ├── SMS Adapter
 ├── Email Adapter
 └── Push Adapter
```

Notification provider failure MUST not roll back successful transactions.

---

# 95. Circular Dependency Rule

Circular dependencies are prohibited at architecture level.

Example prohibited:

```text
Payment
  ↓
Reporting
  ↓
Payment
```

Another:

```text
Ledger
  ↓
Notification
  ↓
Ledger
```

---

# 96. Event-Based Decoupling

When two domains need to communicate but should not create synchronous coupling:

```text
Domain A
  ↓
Event
  ↓
Domain B
```

instead of:

```text
Domain A
  ↓
direct service dependency
  ↓
Domain B
```

Use asynchronous integration where business semantics permit.

---

# 97. Synchronous Dependency Rule

Synchronous dependencies SHOULD be reserved for data required to safely complete the current operation.

Examples:

```text
Loan Approval
→ Risk Score

Payment Posting
→ Ledger

API Authorization
→ Tenant Membership
```

---

# 98. Asynchronous Dependency Rule

Asynchronous dependencies SHOULD be used for:

```text
Notifications
Reporting
Analytics
Fraud Analysis
Forecasting
Statement Processing
Regulatory workflows where permitted
```

---

# 99. Dependency Strength

Each dependency SHOULD be classified as:

```text
STRONG
WEAK
ASYNC
OPTIONAL
EXTERNAL
```

Strong dependencies require availability before the operation can proceed.

Weak dependencies allow degradation.

---

# 100. Critical Path Mapping

Example payment critical path:

```text
Authentication
    ↓
Tenant Context
    ↓
Payment Service
    ↓
Provider
    ↓
Ledger
    ↓
Database
```

Non-critical side path:

```text
Payment Posted
    ↓
Notification
    ↓
SMS Provider
```

Notification failure MUST NOT fail the financial operation.

---

# 101. Critical Path Rule

Only dependencies required to establish correctness should be on the synchronous critical path.

Avoid placing:

```text
analytics
notifications
dashboard projections
```

on financial commit paths.

---

# 102. Dependency Failure Isolation

When a dependency fails:

```text
Dependency Failure
      ↓
Classify
      ↓
Retry / Degrade / Block
```

Do not allow an external failure to automatically cascade across unrelated domains.

---

# 103. Dependency Health

Every critical dependency SHOULD expose:

```text
availability
latency
error rate
connection state
capacity
```

---

# 104. Readiness Dependency Rules

Readiness SHOULD distinguish:

```text
essential dependency
optional dependency
feature-specific dependency
```

Example:

```text
MongoDB unavailable
→ API NOT READY

Email provider unavailable
→ API may remain READY
```

---

# 105. Dependency Health Endpoints

Health checks SHOULD support:

```text
/liveness
/readiness
/health
```

Readiness SHOULD include sanitized dependency state.

---

# 106. Dependency Startup Order

Preferred:

```text
1. Load configuration
2. Validate required secrets/config
3. Establish database
4. Establish essential infrastructure
5. Initialize repositories
6. Initialize critical services
7. Initialize optional services
8. Start workers
9. Start API
```

Application behavior MUST remain deterministic if optional dependencies are missing.

---

# 107. Dependency Shutdown Order

Preferred:

```text
1. Stop accepting traffic
2. Mark not ready
3. Stop new jobs
4. Drain active requests
5. Drain/release workers
6. Stop consumers
7. Flush telemetry
8. Close queue
9. Close Redis
10. Close MongoDB
11. Exit
```

---

# 108. Dependency Startup Failure

Startup SHOULD fail fast when a mandatory dependency is unavailable.

Examples:

```text
MongoDB
Secrets Management
Required Configuration
```

Do not silently continue with unsafe defaults.

---

# 109. Optional Dependency Startup Failure

For optional dependencies:

```text
log warning
mark unavailable
continue safely
```

provided no critical security/financial invariant is weakened.

---

# 110. Dependency Degradation Matrix

| Dependency            | Failure Behavior                                         |
| --------------------- | -------------------------------------------------------- |
| MongoDB               | Application unavailable/unready                          |
| Redis                 | Feature-dependent degradation/fallback                   |
| Queue                 | Async operations delayed; durable state preserved        |
| MTN                   | MTN payments unavailable; other capabilities continue    |
| Airtel                | Airtel payments unavailable; other capabilities continue |
| SMS                   | Notification degradation                                 |
| Email                 | Notification degradation                                 |
| Reporting             | Reporting degradation                                    |
| AI                    | AI feature unavailable                                   |
| Fraud Analytics       | Fraud analytics degradation; defined controls remain     |
| Observability Backend | Telemetry degradation, business logic preserved          |

---

# 111. External Provider Independence

MTN and Airtel integrations MUST remain independent.

MTN outage MUST NOT:

```text
disable Airtel
disable ledger reads
disable loan review
disable member management
```

unless the product explicitly requires a shared downstream dependency.

---

# 112. Payment Provider Factory

Recommended:

```text
PaymentService
      ↓
ProviderAdapterFactory
      ↓
Provider Interface
      ├── MTN
      ├── Airtel
      └── Future Provider
```

Business services depend on the interface, not concrete implementations.

---

# 113. Integration Port Pattern

Example:

```text
PaymentProviderPort
    │
    ├── initiate()
    ├── queryStatus()
    ├── cancel()
    └── normalizeCallback()
```

Provider adapters implement the port.

---

# 114. Dependency Inversion

Stable core domains should depend on abstractions.

Example:

```text
Payment Domain
      ↓
PaymentProviderPort
      ↓
MTNAdapter / AirtelAdapter
```

Not:

```text
Payment Domain
      ↓
MTN SDK
```

---

# 115. Database Dependency Isolation

Services SHOULD use repositories rather than querying MongoDB throughout business code.

Preferred:

```text
Application Service
      ↓
Repository
      ↓
Mongoose
      ↓
MongoDB
```

---

# 116. Repository Dependency Boundary

Repositories own:

```text
query construction
persistence
indexes
transactions
concurrency conditions
```

They SHOULD NOT own:

```text
loan approval workflow
payment provider business rules
financial policy decisions
```

---

# 117. Infrastructure Adapter Boundary

Infrastructure adapters SHOULD isolate:

```text
MongoDB
Redis
Queue
Object Storage
Email
SMS
```

from business services.

---

# 118. Dependency Context

Each dependency call SHOULD preserve necessary context:

```text
tenantId
requestId
correlationId
operationId
traceId
```

Do not lose tenant context when crossing service boundaries.

---

# 119. Dependency Timeouts

All external dependencies MUST have explicit timeouts.

Examples:

```text
database timeout
HTTP connect timeout
HTTP response timeout
queue operation timeout
worker execution timeout
```

---

# 120. Dependency Retries

Retries MUST be:

```text
bounded
classified
idempotent where required
observable
jittered
```

Do not retry deterministic authorization/business errors.

---

# 121. Dependency Circuit Breakers

Circuit breakers SHOULD be used for unstable external dependencies.

Especially:

```text
payment providers
notification providers
regulatory APIs
third-party KYC/AML providers
```

---

# 122. Dependency Bulkheads

High-risk external calls SHOULD use separate resource pools where practical.

For example:

```text
MTN HTTP Pool
Airtel HTTP Pool
KYC HTTP Pool
Notification HTTP Pool
```

This prevents one provider from exhausting all outbound resources.

---

# 123. Dependency Rate Limits

Outbound requests SHOULD respect provider limits.

The adapter SHOULD own provider-specific throttling.

Business services should not hard-code provider-specific rate policies.

---

# 124. Dependency Secrets

External dependencies that require credentials MUST use secure secret management.

Credential dependencies include:

```text
MTN client credentials
Airtel credentials
SMTP credentials
SMS credentials
KYC credentials
AML credentials
Regulatory credentials
```

---

# 125. Dependency Credential Rotation

External adapters MUST support credential rotation without code changes.

A credential rotation SHOULD support:

```text
new credential
→ validation
→ activation
→ old credential retirement
```

---

# 126. Dependency Compatibility Matrix

Critical dependencies SHOULD maintain a compatibility matrix.

Example:

| Dependency    | Runtime | Version          | Compatibility        |
| ------------- | ------- | ---------------- | -------------------- |
| Node.js       | Backend | Supported major  | Required             |
| MongoDB       | Backend | Approved version | Required             |
| Mongoose      | Backend | Supported        | Required             |
| Redis         | Backend | Approved         | Conditional          |
| BullMQ        | Workers | Supported        | Optional/Conditional |
| Provider APIs | Payment | Current contract | External             |

Exact versions SHOULD be maintained with the repository dependency lockfile and deployment manifests.

---

# 127. Dependency Vulnerability Management

Production dependencies MUST be scanned for:

```text
known vulnerabilities
license risk
supply-chain anomalies
outdated versions
```

Critical vulnerabilities require documented remediation.

---

# 128. Dependency Supply Chain Security

Use:

```text
lockfiles
integrity checks
protected package sources
CI scanning
artifact verification
```

Avoid installing arbitrary production dependencies at runtime.

---

# 129. Dependency Licensing

Each third-party dependency SHOULD be reviewed for licensing compatibility before production use.

---

# 130. Dependency Inventory

A production software bill of materials SHOULD identify:

```text
package
version
license
source
risk
owner
purpose
```

---

# 131. Dependency Removal

Unused dependencies SHOULD be removed.

Every unnecessary dependency increases:

```text
attack surface
maintenance cost
upgrade burden
startup complexity
failure possibilities
```

---

# 132. Dependency Failure Ownership

Every critical failure must have an operational owner.

Example:

```text
MongoDB unavailable
→ Database/SRE

MTN unavailable
→ Payment Integration

Airtel unavailable
→ Payment Integration

Queue unavailable
→ Platform Engineering
```

---

# 133. Dependency Incident Runbook

For each critical dependency document:

```text
Detection
Impact
Containment
Fallback
Recovery
Validation
Rollback
Communication
```

---

# 134. Dependency Impact Analysis

Before removing or changing a dependency:

```text
Identify Consumers
↓
Identify Critical Paths
↓
Identify Data Contracts
↓
Identify Events
↓
Identify Security Controls
↓
Identify Operational Runbooks
↓
Migrate
↓
Validate
↓
Remove
```

---

# 135. Dependency Graph Tooling

The repository SHOULD support automated dependency analysis where practical.

Potential outputs:

```text
module graph
route graph
service graph
package graph
event consumer graph
infrastructure graph
```

Architecture documentation should remain synchronized with actual implementation.

---

# 136. Static Dependency Rules

CI SHOULD detect:

```text
circular imports
forbidden module dependencies
domain boundary violations
direct persistence access
provider logic leakage
```

---

# 137. Forbidden Dependency Examples

The following are prohibited:

```text
Controller
→ MongoDB financial collection
```

```text
Provider Adapter
→ Loan model mutation
```

```text
Notification
→ Ledger
```

```text
Dashboard
→ direct financial writes
```

```text
Frontend
→ Redis
```

```text
Fraud Analytics
→ direct account balance update
```

---

# 138. Financial Core Dependency Firewall

Only approved services should be able to invoke financial posting.

Conceptually:

```text
Savings ─────┐
Loans ───────┤
Payments ────┼──→ Financial Command → Ledger
Settlement ──┤
Billing ─────┘
```

Reporting, notifications, AI, and dashboards MUST remain downstream.

---

# 139. Dependency Firewall for Provider APIs

Only provider adapters may invoke provider APIs.

Preferred:

```text
PaymentService
 ↓
ProviderPort
 ↓
MTNAdapter
 ↓
MTN
```

Prohibited:

```text
LoanService
 ↓
MTN HTTP API
```

---

# 140. Dependency Firewall for Sensitive Data

Sensitive datasets such as:

```text
KYC
AML
Secrets
Audit
```

MUST have restricted dependency access.

A general-purpose analytics component SHOULD NOT receive unrestricted raw sensitive datasets.

---

# 141. Dependency Graph of Financial Core

```text
                 Tenant Context
                       │
                       ▼
                Financial Command
                       │
             ┌─────────┴─────────┐
             │                   │
             ▼                   ▼
       Idempotency            Authorization
             │                   │
             └─────────┬─────────┘
                       ▼
                 Posting Engine
                       │
             ┌─────────┼─────────┐
             │         │         │
             ▼         ▼         ▼
           Account   Journal   Transaction
             │         │
             │         ▼
             │      Entries
             │
             └──────────┬───────────┐
                        │           │
                        ▼           ▼
                      Audit      Outbox
```

---

# 142. Dependency Graph of Payment

```text
API
 ↓
PaymentService
 ├── TenantContext
 ├── Idempotency
 ├── ProviderPort
 │     ├── MTN
 │     └── Airtel
 ├── LedgerService
 ├── CallbackRegistry
 ├── Audit
 └── EventPublisher
```

---

# 143. Dependency Graph of Settlement

```text
StatementImporter
      ↓
StatementNormalizer
      ↓
StatementValidator
      ↓
StatementBatchManager
      ↓
StatementProcessor
      ↓
ReconciliationService
      ↓
RepairService
      ↓
LedgerService
      ↓
EventPublisher
```

---

# 144. Dependency Graph of Compliance

```text
Compliance Service
 ├── Tenant
 ├── Member
 ├── KYC Adapter
 ├── AML Adapter
 ├── Regulatory Adapter
 ├── Document Storage
 └── Audit
```

---

# 145. Dependency Graph of Risk/Fraud

```text
Financial / Business Events
          │
      ┌───┴────┐
      ▼        ▼
     Risk     Fraud
      │        │
      └───┬────┘
          ▼
      Intelligence
```

Risk/fraud systems consume facts rather than becoming financial authorities.

---

# 146. Reporting Dependency Direction

Correct:

```text
Financial Core
   ↓
Financial Events / Data
   ↓
Reporting Projection
   ↓
Dashboard
```

Incorrect:

```text
Dashboard
   ↓
Financial Core
```

for financial writes.

---

# 147. Notification Dependency Direction

Correct:

```text
Domain Event
   ↓
Notification Service
   ↓
Provider
```

Incorrect:

```text
Notification
   ↓
Domain State Mutation
```

---

# 148. Event Consumer Dependency Direction

Consumers should depend on event contracts rather than private producer internals.

Correct:

```text
Consumer
  ↓
Event Schema
```

Incorrect:

```text
Consumer
  ↓
Producer MongoDB Collection
```

---

# 149. Dependency Through APIs vs Shared Database

Cross-domain dependencies SHOULD use:

```text
application service
API
event
repository interface
```

rather than direct access to another domain's private collection.

---

# 150. Shared Database Rule

A shared MongoDB cluster does NOT mean:

```text
shared collection ownership
```

Each domain MUST have clear data ownership.

---

# 151. Data Ownership Dependency

Example:

```text
LoanService
→ may read authorized member information
→ may reference account
→ may invoke LedgerService
```

but should not:

```text
LoanService
→ directly update JournalEntry collection
```

---

# 152. Dependency and Schema Coupling

Services SHOULD avoid depending on another domain's internal schema.

Use:

```text
DTO
Port
API
Event
```

instead.

---

# 153. Dependency and Migration

The more direct the dependency, the greater the migration blast radius.

Prefer:

```text
interface
adapter
event
```

to:

```text
shared internal implementation
```

for replaceable components.

---

# 154. Stable Dependency Principle

Stable components should be depended upon by less stable components.

Examples:

```text
Financial Core
← Savings
← Lending
← Payments
```

not:

```text
Financial Core
→ Savings
```

---

# 155. Dependency Volatility

Classify components:

```text
Stable:
Financial Core
Identity
Core Data Contracts

Moderately Stable:
Lending
Savings
Payments

Highly Volatile:
Provider Adapters
AI
Analytics
UI
```

High-volatility components SHOULD be kept behind interfaces/events.

---

# 156. Dependency Risk Matrix

| Dependency            | Criticality | Volatility | Replaceability |       Risk |
| --------------------- | ----------: | ---------: | -------------: | ---------: |
| MongoDB               |    Critical | Low/Medium |         Medium |       High |
| Redis                 |        High |     Medium |           High |     Medium |
| Financial Core        |    Critical |        Low |            Low |   Critical |
| Identity              |    Critical |        Low |         Medium |       High |
| MTN Adapter           |        High |     Medium |           High |     Medium |
| Airtel Adapter        |        High |     Medium |           High |     Medium |
| Queue                 |        High |     Medium |           High |     Medium |
| Notification Provider |         Low |       High |           High | Low/Medium |
| AI Model              |    Optional |       High |           High |        Low |
| Reporting Projection  |      Medium |     Medium |           High | Low/Medium |

---

# 157. Dependency Blast Radius

Every critical dependency SHOULD have a documented blast radius.

Example:

```text
MongoDB outage
→ almost all tenant APIs affected

MTN outage
→ MTN transactions affected

Email outage
→ email notifications affected

AI outage
→ AI-assisted workflows affected
```

---

# 158. Dependency Isolation Target

The architecture SHOULD aim for:

```text
Failure
   ↓
Smallest possible domain impact
```

rather than:

```text
Failure
   ↓
Platform-wide outage
```

---

# 159. Dependency Bulkheads by Domain

Potential isolation:

```text
Payments
→ provider-specific connection pools

Notifications
→ separate workers

Reporting
→ separate workers

Settlement
→ controlled worker pool

AI
→ optional worker pool
```

---

# 160. Worker Dependency Pools

Do not allow:

```text
notification jobs
```

to starve:

```text
financial settlement jobs
```

Use concurrency controls and separate queues where necessary.

---

# 161. Dependency Priority

Suggested priority:

```text
P0
Financial Integrity
Authentication
Tenant Isolation
Database Integrity

P1
Payments
Settlement
Compliance
Loan Processing

P2
Notifications
Reporting
Fraud Analytics
Risk Enrichment

P3
AI / Forecasting / Experimental
```

---

# 162. Dependency Failure Policy

For each dependency, define:

```text
FAIL_FAST
RETRY
DEGRADE
QUEUE
RECONCILE
MANUAL_REVIEW
```

Never use an implicit failure behavior.

---

# 163. Example Dependency Policies

### MongoDB

```text
FAIL_FAST
```

### MTN

```text
TIMEOUT
→ RETRY if safe
→ UNKNOWN if outcome ambiguous
→ RECONCILE
```

### Email

```text
QUEUE
→ RETRY
→ DEAD LETTER
```

### AI

```text
DEGRADE
→ continue with non-AI workflow
```

---

# 164. Dependency Security Boundary

Each external/internal dependency crossing a trust boundary SHOULD have:

```text
authentication
authorization
encryption
validation
timeout
audit where required
```

---

# 165. Service Identity

Privileged services/workers SHOULD have distinct identities.

Examples:

```text
ledger-worker
settlement-worker
notification-worker
compliance-worker
fraud-worker
```

Each receives only required permissions.

---

# 166. Service Dependency Permissions

Example:

```text
notification-worker
→ events.read
→ notification.write

NOT:
ledger.write
```

Settlement worker may have:

```text
statement.read
reconciliation.write
ledger.command
```

where explicitly required.

---

# 167. Dependency Least Privilege

A service should receive:

```text
minimum permissions
minimum data
minimum network access
minimum runtime privileges
```

needed to perform its function.

---

# 168. Dependency Secrets Boundary

A service should receive only the secrets for its dependencies.

Example:

```text
MTN worker
→ MTN secret

Notification worker
→ SMS/email secret
```

Do not expose all platform secrets to every process.

---

# 169. Dependency Configuration Boundary

Configuration MUST distinguish:

```text
global configuration
service configuration
tenant configuration
secret configuration
provider configuration
```

---

# 170. Dependency Configuration Failure

Missing required configuration MUST fail clearly.

Do not silently use:

```text
hard-coded defaults
development credentials
unsafe fallback endpoints
```

for production security-sensitive dependencies.

---

# 171. Dependency Migration Strategy

Replacing a dependency SHOULD follow:

```text
Current Dependency
      ↓
Introduce Port
      ↓
New Adapter
      ↓
Dual Run if needed
      ↓
Validation
      ↓
Cutover
      ↓
Monitor
      ↓
Retire Old Dependency
```

---

# 172. Dependency Adapter Strategy

Replaceable dependencies SHOULD be encapsulated.

Examples:

```text
PaymentProviderPort
NotificationProviderPort
ObjectStoragePort
EventTransportPort
QueuePort
```

---

# 173. Dependency Contract Stability

The platform domain should depend on stable interfaces:

```text
ProviderPort
RepositoryInterface
EventPublisher
NotificationPort
```

rather than SDK-specific structures.

---

# 174. SDK Leakage Prohibition

Provider SDK objects MUST NOT leak into domain models.

Bad:

```text
LoanService
→ MTN SDK response
```

Preferred:

```text
MTN Adapter
→ normalized PaymentProviderResult
```

---

# 175. Dependency Error Normalization

Each dependency adapter SHOULD normalize errors into domain-neutral categories.

Examples:

```text
NETWORK_TIMEOUT
PROVIDER_UNAVAILABLE
AUTHENTICATION_FAILED
RATE_LIMITED
INVALID_REQUEST
UNKNOWN_OUTCOME
```

Business services should not need to understand provider-specific codes.

---

# 176. Dependency Observability Contract

Every critical dependency call SHOULD record:

```text
dependency
operation
tenantId where appropriate
latency
result
error category
correlationId
```

Do not record secret payloads.

---

# 177. Dependency Metrics

Recommended:

```text
dependency_requests_total
dependency_failures_total
dependency_timeouts_total
dependency_latency
dependency_retries_total
dependency_circuit_open_total
dependency_rate_limit_total
```

---

# 178. Dependency Tracing

External/internal calls SHOULD create spans:

```text
HTTP
Database
Redis
Queue
Provider
```

with:

```text
tenantId
correlationId
operationId
```

where safe.

---

# 179. Dependency Alerting

Alerts SHOULD cover:

```text
high failure rate
high latency
timeouts
circuit breaker open
queue backlog
database connection exhaustion
Redis unavailable
provider authentication failures
```

---

# 180. Dependency Health SLOs

Critical dependencies SHOULD have defined SLOs.

Example dimensions:

```text
availability
latency
error rate
recovery time
```

---

# 181. Dependency Recovery

Every critical dependency MUST have a recovery path.

Example:

```text
Redis outage
→ fallback/cache miss

Queue outage
→ durable outbox / pending jobs

MTN outage
→ retry/reconciliation

Database outage
→ failover/recovery
```

---

# 182. Dependency Recovery Verification

After recovery:

```text
validate dependency health
validate backlog
validate financial integrity
validate event delivery
validate worker claims
validate reconciliation
```

---

# 183. Dependency Recovery and Financial Systems

External recovery MUST NOT automatically trigger duplicate execution.

After provider recovery:

```text
inspect existing operations
→ reconcile
→ continue
```

rather than:

```text
retry everything
```

---

# 184. Dependency Recovery and Outbox

After queue recovery:

```text
Outbox
→ publisher resumes
→ pending events delivered
→ consumers catch up
```

No committed critical event should be silently lost.

---

# 185. Dependency Recovery and Dead Letters

Dead-letter events remain until:

```text
resolved
replayed
or explicitly closed
```

with audit evidence.

---

# 186. Dependency Architecture Testing

Tests SHOULD verify:

```text
allowed dependencies
forbidden dependencies
failure behavior
fallback behavior
provider isolation
tenant propagation
event flow
startup order
shutdown order
```

---

# 187. Architecture Boundary Tests

CI SHOULD fail if:

```text
controllers import database models directly
provider adapters import domain persistence
reporting imports financial write services
frontend imports backend infrastructure
```

---

# 188. Dependency Contract Tests

Each port/adapter SHOULD have common contract tests.

Example:

```text
PaymentProviderPort
→ MTN contract
→ Airtel contract
```

Both must satisfy the same domain interface semantics.

---

# 189. Provider Substitution Test

A provider should be replaceable without rewriting business logic.

Example:

```text
MTN
→ Airtel
```

should require adapter/configuration changes rather than modifications across loans/savings/ledger services.

---

# 190. Dependency Resilience Testing

The platform SHOULD simulate:

```text
MongoDB unavailable
Redis unavailable
queue unavailable
MTN timeout
Airtel timeout
KYC unavailable
email unavailable
SMS unavailable
```

and verify expected degradation.

---

# 191. Dependency Chaos Testing

High-priority components SHOULD be tested under controlled failures:

```text
network delay
network partition
connection refusal
timeout
duplicate response
malformed response
slow dependency
partial dependency outage
```

---

# 192. Dependency Security Testing

Security tests SHOULD include:

```text
credential theft
credential rotation
unauthorized service call
tenant context loss
dependency spoofing
TLS failure
secret leakage
SSRF
```

---

# 193. Dependency Documentation Standard

Every production dependency SHOULD document:

```text
Name
Purpose
Owner
Type
Criticality
Consumers
Input Contract
Output Contract
Authentication
Timeout
Retry
Circuit Breaker
Rate Limit
Failure Mode
Fallback
Recovery
Monitoring
Security Classification
```

---

# 194. Dependency Catalogue Template

```text
### <Dependency Name>

Purpose:

Owner:

Category:

Criticality:

Consumers:

Provider / Technology:

Authentication:

Data Exchanged:

Tenant Scoped:

Timeout:

Retry:

Circuit Breaker:

Rate Limit:

Failure Mode:

Fallback:

Recovery:

Observability:

Security Classification:

Migration / Replacement Strategy:
```

---

# 195. Dependency Review Checklist

Before introducing a dependency:

```text
[ ] Why is it needed?
[ ] Can existing platform capability satisfy the need?
[ ] Is it critical?
[ ] Who owns it?
[ ] What data does it access?
[ ] Is it tenant-aware?
[ ] Is it replaceable?
[ ] What happens if it fails?
[ ] Does it add a security boundary?
[ ] Does it add a financial dependency?
[ ] Does it introduce a licensing concern?
[ ] How is it observed?
[ ] How is it tested?
[ ] How is it removed?
```

---

# 196. Dependency Production Gate

A critical dependency is production-ready only when:

```text
[ ] Owner defined
[ ] Purpose defined
[ ] Criticality defined
[ ] Security review completed
[ ] Tenant implications assessed
[ ] Timeout defined
[ ] Retry defined
[ ] Circuit breaker evaluated
[ ] Failure behavior defined
[ ] Fallback defined
[ ] Recovery defined
[ ] Observability implemented
[ ] Alerts defined
[ ] Runbook defined
[ ] Tests implemented
[ ] Dependency version pinned/controlled
[ ] Upgrade plan defined
```

---

# 197. Critical Dependency Matrix

| Dependency           | Primary Consumers               |                  Criticality | Failure Strategy    |
| -------------------- | ------------------------------- | ---------------------------: | ------------------- |
| MongoDB              | Most domains                    |                     Critical | Fail fast / recover |
| Redis                | Rate limit, cache, coordination |             High/Conditional | Degrade/fallback    |
| Queue                | Workers                         |                         High | Persist/retry       |
| Outbox               | Financial/event flows           |                     Critical | Persist durably     |
| MTN                  | MTN payments                    | External Critical to feature | Timeout/reconcile   |
| Airtel               | Airtel payments                 | External Critical to feature | Timeout/reconcile   |
| Object Storage       | Documents/statements            |      High for file workflows | Retry/degrade       |
| Secrets Manager      | Secure integrations             |                     Critical | Fail closed         |
| SMS Provider         | Notifications                   |                  Best Effort | Queue/retry         |
| Email Provider       | Notifications                   |                  Best Effort | Queue/retry         |
| Reporting Projection | Reporting                       |                        Async | Rebuild/retry       |
| AI                   | AI features                     |                     Optional | Degrade             |
| Fraud Analytics      | Fraud intelligence              |                   Async/High | Alert/retry         |

---

# 198. Dependency Map by Architectural Layer

```text
EXPERIENCE
  ↓
API
  ↓
IDENTITY / TENANT / AUTHORIZATION
  ↓
APPLICATION SERVICES
  ↓
DOMAIN SERVICES
  ↓
FINANCIAL CORE / WORKFLOW
  ↓
REPOSITORIES / ADAPTERS
  ↓
DATABASE / REDIS / QUEUE / STORAGE
  ↓
EXTERNAL PROVIDERS
```

External providers SHOULD only be reachable through their adapters.

---

# 199. Dependency Map by Business Flow

## Savings

```text
User
 ↓
API
 ↓
Tenant/Auth
 ↓
Savings
 ↓
Payment
 ↓
Ledger
 ↓
MongoDB
 ↓
Outbox
 ↓
Reporting/Notification
```

## Loan

```text
User
 ↓
API
 ↓
Tenant/Auth
 ↓
Loan
 ↓
Risk / Compliance
 ↓
Payment
 ↓
Ledger
 ↓
Settlement
 ↓
Reporting
```

## Payment

```text
API
 ↓
Tenant/Auth
 ↓
Payment
 ↓
Provider Adapter
 ↓
Provider
 ↓
Callback
 ↓
Payment
 ↓
Ledger
 ↓
Settlement
```

---

# 200. Dependency Architecture Invariants

The following are mandatory:

```text
1. Dependencies flow toward stable capabilities.
2. Financial Core remains authoritative for financial state.
3. Providers remain behind adapters.
4. Controllers do not own persistence/business rules.
5. Reporting is downstream of financial truth.
6. Notifications are downstream of business facts.
7. Redis is not authoritative financial storage.
8. Queues are delivery mechanisms, not business truth.
9. Cross-domain data access uses controlled interfaces.
10. Tenant context propagates through all tenant-aware dependencies.
11. Critical dependencies have explicit failure behavior.
12. Optional dependencies fail gracefully.
13. External dependencies have bounded timeouts.
14. Retry is never implicit for financial operations.
15. Circular dependencies are prohibited.
16. Sensitive dependencies use least privilege.
17. Dependency failure should have the smallest practical blast radius.
18. All critical dependencies are observable.
19. Dependency changes are reviewed and documented.
20. Replaceable infrastructure is hidden behind adapters or ports.
```

---

# 201. Non-Negotiable Dependency Prohibitions

The following are prohibited:

```text
1. Direct controller-to-database financial writes.
2. Provider adapter-to-ledger direct mutation.
3. Frontend-to-database dependencies.
4. Notification-to-financial-state dependencies.
5. Reporting-to-financial-write dependencies.
6. AI-to-authoritative-financial-state dependencies.
7. Tenant-unaware repositories for tenant-owned data.
8. Unbounded synchronous dependency chains.
9. Indefinite retries against external providers.
10. Critical financial operations depending on optional services.
11. Uncontrolled circular service dependencies.
12. Shared secrets across unrelated services.
13. Global cache keys for tenant-owned records.
14. Blind provider retry after unknown financial outcome.
15. Undocumented production dependencies.
```

---

# 202. Dependency Change Control

Any material dependency change MUST document:

```text
Current Dependency
Proposed Dependency
Reason
Affected Consumers
Affected APIs
Affected Data
Affected Events
Affected Security Controls
Failure-Mode Changes
Operational Impact
Migration Strategy
Rollback Strategy
Testing Strategy
```

---

# 203. Dependency Migration Gate

Before retiring a dependency:

```text
[ ] All consumers identified
[ ] No hidden imports
[ ] No runtime references
[ ] Event dependencies migrated
[ ] Data migration completed
[ ] Metrics migrated
[ ] Alerts migrated
[ ] Runbooks updated
[ ] Fallback removed safely
[ ] Production validated
```

---

# 204. Dependency Drift Detection

CI/CD SHOULD detect:

```text
new direct database imports
new forbidden package dependencies
new circular imports
new provider coupling
new cross-domain persistence access
new undocumented packages
```

---

# 205. Dependency Governance

Architecture governance SHOULD review:

```text
new infrastructure
new external providers
new queues
new storage systems
new databases
new security services
new SDKs
new workflow engines
```

before production adoption.

---

# 206. Dependency Complexity Budget

Each new dependency adds:

```text
operational cost
security surface
failure modes
upgrade burden
observability work
testing requirements
```

A new dependency SHOULD solve a problem that cannot be safely solved with existing capabilities.

---

# 207. Preferred Extension Pattern

Prefer:

```text
Existing Domain
      ↓
New Port / Adapter
      ↓
New Provider
```

over:

```text
New Provider
      ↓
new duplicated domain logic
      ↓
new duplicated database
```

---

# 208. Architecture Fitness Rule

When evaluating a dependency, ask:

```text
Does it reduce coupling?
Does it preserve ownership?
Does it improve replaceability?
Does it preserve financial integrity?
Does it preserve tenant isolation?
Does it improve reliability?
Is its failure isolated?
Can we observe it?
Can we recover from it?
```

If the answer is no to several of these, the dependency should be reconsidered.

---

# 209. Final Enterprise Dependency Principle

The TITech Community Capital dependency architecture is governed by:

> **Stable domains own business truth; the Financial Core owns financial truth; tenant context crosses every tenant-aware boundary; providers are isolated behind adapters; events decouple asynchronous consumers; repositories protect data ownership; optional dependencies remain optional; and every critical dependency has a clearly defined owner, timeout, retry strategy, failure mode, observability path, and recovery procedure.**

---

# 210. Related Architecture Documents

This dependency map MUST remain aligned with:

```text
docs/02-architecture/ARCHITECTURE_MAP.md
docs/02-architecture/SERVICE_CATALOGUE.md
docs/02-architecture/API_CATALOGUE.md
docs/02-architecture/DATA_MODEL_CATALOGUE.md
docs/02-architecture/SECURITY_MODEL.md
docs/02-architecture/MULTI_TENANT_ARCHITECTURE.md
docs/02-architecture/EVENT_CATALOGUE.md
docs/02-architecture/FINANCIAL_LEDGER_SPECIFICATION.md
docs/02-architecture/TRANSACTION_STATE_MACHINE.md
```

Implementation areas SHOULD remain aligned with:

```text
backend/app.js
backend/server.js
backend/routes/
backend/controllers/
backend/middleware/
backend/modules/
backend/modules/models/
backend/modules/finance/
backend/modules/payment/
backend/modules/settlement/
backend/modules/compliance/
backend/modules/risk/
backend/modules/fraud/
backend/services/
backend/jobs/
backend/shared/
```

Any change that introduces, removes, redirects, or materially alters a production dependency MUST update this document and all affected architecture/service/security/data/event documentation.

---

**End of Dependency Map**