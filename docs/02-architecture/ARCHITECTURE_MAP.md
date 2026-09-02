# TITech Community Capital Ltd

# Enterprise Architecture Map

**Document:** `docs/02-architecture/ARCHITECTURE_MAP.md`
**Status:** Production Architecture Baseline
**Audience:** Engineering, Architecture, Security, DevOps/SRE, Compliance, Operations, Product
**Owner:** Architecture / Engineering
**Classification:** Internal Engineering Documentation
**Version:** 1.0.0

---

## 1. Purpose

This document defines the authoritative architecture map for the TITech Community Capital platform.

The architecture is designed to evolve the Community Savings application from an MVP into an **enterprise-grade, multi-tenant financial platform** supporting SACCOs, VSLAs, community savings organizations, lenders, payment providers, administrators, regulators, and ecosystem partners.

This document establishes:

* system boundaries;
* architectural domains;
* module ownership;
* service boundaries;
* dependency direction;
* data ownership;
* transaction boundaries;
* event and integration boundaries;
* security boundaries;
* observability boundaries;
* deployment boundaries;
* financial-control boundaries;
* resilience requirements;
* operational ownership;
* architectural invariants.

This file is the high-level architectural source of truth.

Detailed implementation specifications MUST be maintained in the appropriate documents under `docs/02-architecture/`.

---

# 2. Architectural Vision

TITech Community Capital is structured as a **modular financial operating platform** with a strong financial-core foundation.

The target logical architecture is:

```text
                           ┌───────────────────────────┐
                           │       Clients / UX        │
                           │                           │
                           │ Web • Mobile • Admin     │
                           │ Partner / API Clients     │
                           └─────────────┬─────────────┘
                                         │
                                         ▼
                           ┌───────────────────────────┐
                           │       API / EDGE          │
                           │                           │
                           │ Routing                   │
                           │ Authentication            │
                           │ Authorization              │
                           │ Tenant Context             │
                           │ Rate Limiting              │
                           │ Request Validation         │
                           │ Idempotency                │
                           │ Correlation / Request ID   │
                           └─────────────┬─────────────┘
                                         │
                 ┌───────────────────────┼────────────────────────┐
                 │                       │                        │
                 ▼                       ▼                        ▼
        ┌─────────────────┐    ┌──────────────────┐    ┌──────────────────┐
        │ SaaS / Tenant   │    │ Financial Core   │    │ Business Domain  │
        │ Platform        │    │                  │    │ Services         │
        │                 │    │ Ledger            │    │                  │
        │ Tenants         │    │ Accounts          │    │ Savings          │
        │ Users           │    │ Journal           │    │ Loans            │
        │ Plans/Billing   │    │ Journal Entries  │    │ Members          │
        │ Entitlements    │    │ Transactions     │    │ Groups           │
        │ Configuration   │    │ Balances         │    │ Contributions    │
        └────────┬────────┘    │ Reconciliation   │    │ Repayments       │
                 │             │ Period Close     │    │ Schedules        │
                 │             │ Snapshots        │    └─────────┬────────┘
                 │             └────────┬─────────┘              │
                 │                      │                        │
                 └──────────────────────┼────────────────────────┘
                                        │
                                        ▼
                           ┌───────────────────────────┐
                           │ Transaction / Workflow    │
                           │ Orchestration              │
                           │                           │
                           │ State Machines             │
                           │ Distributed Transactions  │
                           │ Idempotency                │
                           │ Outbox                     │
                           │ Retry / Recovery           │
                           └─────────────┬─────────────┘
                                         │
                 ┌───────────────────────┼────────────────────────┐
                 │                       │                        │
                 ▼                       ▼                        ▼
       ┌──────────────────┐   ┌──────────────────┐    ┌──────────────────┐
       │ Payment Rails    │   │ Compliance       │    │ Risk / Fraud /AI │
       │                  │   │                  │    │                  │
       │ MTN MoMo         │   │ KYC              │    │ Risk Scoring     │
       │ Airtel Money     │   │ AML              │    │ Fraud Detection  │
       │ Bank Integrations│   │ Regulatory       │    │ Anomaly Detection│
       │ Settlement       │   │ Submissions      │    │ AI Classification│
       └────────┬─────────┘   └────────┬─────────┘    └────────┬─────────┘
                │                      │                       │
                └──────────────────────┼───────────────────────┘
                                       │
                                       ▼
                           ┌───────────────────────────┐
                           │ Integration / Event Layer │
                           │                           │
                           │ Adapters                   │
                           │ Callback Processing        │
                           │ Event Publisher            │
                           │ Outbox                      │
                           │ Message / Queue Processing  │
                           │ Dead Letter / Replay        │
                           └─────────────┬─────────────┘
                                         │
                                         ▼
                           ┌───────────────────────────┐
                           │ Persistence / Infrastructure│
                           │                           │
                           │ MongoDB                    │
                           │ Redis                      │
                           │ Queue / Worker Runtime     │
                           │ Object / File Storage      │
                           └─────────────┬─────────────┘
                                         │
                                         ▼
                           ┌───────────────────────────┐
                           │ Observability / Operations │
                           │                           │
                           │ Logs                       │
                           │ Metrics                    │
                           │ Traces                     │
                           │ Audit Trail                │
                           │ Alerts                     │
                           │ Health / Readiness         │
                           │ Operational Dashboards     │
                           └───────────────────────────┘
```

---

# 3. Core Architectural Principles

## 3.1 Financial Core First

The financial engine is the platform's system of record for financial truth.

No business module may maintain an independent authoritative monetary balance.

All monetary operations MUST ultimately resolve through the financial core.

---

## 3.2 Double-Entry Accounting Is Mandatory

Every financial movement MUST result in balanced journal entries.

```text
Total Debits = Total Credits
```

No production financial workflow may bypass:

```text
Ledger
  ↓
Journal
  ↓
Journal Entries
  ↓
Accounts
  ↓
Balances / Snapshots
```

Direct mutation of authoritative financial balances is prohibited.

---

## 3.3 Immutable Financial History

Posted financial records MUST NOT be edited in place.

Corrections MUST use compensating transactions, reversals, adjustments, or approved correction workflows.

```text
Original Posting
      │
      ▼
Immutable Historical Record
      │
      ├── Reversal
      ├── Adjustment
      └── Corrective Posting
```

---

## 3.4 Multi-Tenant by Design

Tenant isolation is an architectural invariant.

Every tenant-aware operation MUST have an explicit tenant context.

```text
Request
  ↓
Authentication
  ↓
Tenant Resolution
  ↓
Tenant Authorization
  ↓
Tenant-Aware Service
  ↓
Tenant-Scoped Persistence
```

Cross-tenant access MUST be denied by default.

---

## 3.5 Idempotency by Default

External financial workflows MUST be safe to retry.

Idempotency MUST be applied to:

* API commands;
* payment initiation;
* payment callbacks;
* settlement operations;
* ledger postings;
* billing operations;
* background jobs;
* regulatory submissions;
* event publication where applicable.

Repeated delivery MUST NOT result in duplicate financial effects.

---

## 3.6 Explicit State Machines

Critical workflows MUST use explicit state transitions.

Examples:

```text
Payment
INITIATED → PROCESSING → SUCCESS
                    └──→ FAILED
                    └──→ EXPIRED
```

```text
Loan
DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED
                                ├→ REJECTED
                                └→ CANCELLED
APPROVED → DISBURSED → ACTIVE → COMPLETED
```

```text
Transaction
CREATED → VALIDATED → POSTED
                  └──→ FAILED
POSTED → REVERSED
```

Invalid transitions MUST be rejected.

---

## 3.7 Eventual Consistency Must Be Explicit

Strong consistency is required for financial posting and other critical transactional invariants.

Eventual consistency may be used for:

* notifications;
* analytics;
* dashboards;
* search indexes;
* reporting projections;
* asynchronous integrations;
* non-critical enrichment.

---

## 3.8 Adapter Isolation

External provider-specific behavior MUST remain behind adapters.

Business services MUST NOT contain provider-specific protocol logic.

```text
Business Domain
      │
      ▼
Provider Interface / Port
      │
      ├── MTN Adapter
      ├── Airtel Adapter
      ├── Bank Adapter
      └── Future Provider Adapter
```

---

## 3.9 Security by Boundary

Security MUST be enforced in depth:

```text
Edge
 ↓
Authentication
 ↓
Authorization
 ↓
Tenant Isolation
 ↓
Service Validation
 ↓
Domain Authorization
 ↓
Persistence Constraints
 ↓
Audit / Observability
```

No single middleware or service is considered sufficient security enforcement.

---

## 3.10 Observable by Default

Production components MUST support:

* structured logging;
* correlation IDs;
* request IDs;
* tenant IDs;
* transaction IDs;
* provider correlation;
* metrics;
* tracing;
* audit trails;
* health checks.

---

# 4. System Context

## 4.1 Internal Actors

The platform contains the following major actors:

| Actor                       | Responsibility                                  |
| --------------------------- | ----------------------------------------------- |
| Platform Administrator      | Global platform administration                  |
| Tenant Administrator        | SACCO / organization administration             |
| Group Officer               | Group operations                                |
| Treasurer / Finance Officer | Financial operations                            |
| Member                      | Savings, loans, payments and account access     |
| Compliance Officer          | KYC, AML and regulatory workflows               |
| Risk Officer                | Risk and fraud operations                       |
| Operations Team             | Exceptions, settlements and operational support |
| Engineering / SRE           | Platform reliability                            |
| Auditor                     | Audit and controlled investigation              |

---

## 4.2 External Systems

The platform may integrate with:

* MTN MoMo;
* Airtel Money;
* Banks;
* Identity/KYC services;
* AML and screening providers;
* Regulatory systems;
* SMS providers;
* Email providers;
* Push notification providers;
* Queue infrastructure;
* Redis;
* MongoDB;
* cloud infrastructure;
* observability platforms.

External systems MUST be treated as untrusted integration boundaries.

---

# 5. Logical Architecture Domains

The platform is divided into the following primary domains.

```text
01. Edge / API
02. Identity & Access
03. SaaS / Tenant Platform
04. Financial Core
05. Savings / Community Finance
06. Lending
07. Payments
08. Settlement
09. Compliance
10. Risk / Fraud / AI
11. Workflow / Orchestration
12. Notifications
13. Reporting / Analytics
14. Integration / Provider Adapters
15. Observability
16. Infrastructure
```

---

# 6. Domain Architecture

## 6.1 Edge / API Layer

Responsibilities:

* HTTP routing;
* API versioning;
* authentication entry;
* authorization entry;
* tenant resolution;
* request validation;
* request size limits;
* timeout protection;
* rate limiting;
* idempotency enforcement;
* correlation IDs;
* structured HTTP logging;
* security headers;
* CORS;
* health endpoints.

Primary boundary:

```text
HTTP
 ↓
API / Controller
 ↓
Application Service
```

Controllers MUST remain thin.

Controllers MUST NOT implement complex business rules or accounting logic.

---

# 7. Identity and Access Domain

Responsibilities:

* authentication;
* access tokens;
* refresh tokens;
* password management;
* session management;
* roles;
* permissions;
* tenant membership;
* privileged operations;
* service-to-service authorization.

Security hierarchy:

```text
Identity
   ↓
User
   ↓
Tenant Membership
   ↓
Role
   ↓
Permission
   ↓
Resource
   ↓
Operation
```

Privileged administrative operations MUST be audited.

---

# 8. SaaS / Tenant Platform Domain

Responsibilities:

* tenant lifecycle;
* SACCO onboarding;
* tenant configuration;
* tenant status;
* subscription plans;
* billing;
* feature entitlements;
* tenant-level limits;
* tenant administration;
* tenant metadata.

Logical structure:

```text
Platform
 ├── Tenant
 │    ├── Configuration
 │    ├── Users
 │    ├── Groups
 │    ├── Members
 │    ├── Plans
 │    └── Entitlements
 │
 └── Platform Administration
```

Tenant billing MUST remain separate from member financial ledger activity.

---

# 9. Financial Core Domain

The Financial Core is the highest-control domain in the platform.

Core components include:

```text
Account
Journal
JournalEntry
Transaction
Ledger Engine
Posting Engine
Reversal Service
Balance Service
Snapshot Service
Period Close Service
Reconciliation Service
Financial Statement Service
Interest Accrual Service
Write-Off Service
```

Reference flow:

```text
Business Operation
      │
      ▼
Financial Application Service
      │
      ▼
Ledger Service
      │
      ▼
Posting Engine
      │
      ├── Validate
      ├── Idempotency
      ├── Journal Creation
      ├── Journal Entry Creation
      ├── Balance Update
      ├── Audit
      └── Event Publication
```

### Financial Core Invariants

The platform MUST enforce:

```text
1. Every posting is balanced.
2. Every posting is attributable to a tenant.
3. Every posting has a transaction identity.
4. Every posting supports idempotency.
5. Every posting is auditable.
6. Posted entries are immutable.
7. Corrections occur through reversal or adjustment.
8. Account ownership is explicit.
9. Ledger state is the financial source of truth.
10. Business services do not directly mutate financial balances.
```

---

# 10. Savings / Community Finance Domain

This domain represents community savings functionality.

Responsibilities include:

* savings groups;
* members;
* contributions;
* shares;
* savings plans;
* group cycles;
* member balances;
* contribution schedules;
* fines;
* group-level financial workflows.

All financial effects MUST flow through the Financial Core.

Example:

```text
Member Contribution
      ↓
Contribution Service
      ↓
Ledger Posting Instruction
      ↓
Ledger Engine
      ↓
Balanced Journal
```

---

# 11. Lending Domain

The lending architecture includes:

```text
Loan Product
Loan Application
Loan Risk Profile
Loan Approval
Approval Workflow
Loan Disbursement
Repayment Schedule
Repayment
Interest Accrual
Loan Status
Write-Off
Collections
```

Reference lifecycle:

```text
APPLICATION
    ↓
CREDIT ASSESSMENT
    ↓
APPROVAL WORKFLOW
    ↓
APPROVED
    ↓
DISBURSEMENT
    ↓
ACTIVE
    ↓
REPAYMENT
    ↓
COMPLETED
```

Every disbursement and repayment MUST integrate with the Financial Core.

---

# 12. Payment Domain

Payment architecture is divided into:

```text
Payment Orchestration
        ↓
Provider Port
        ↓
Provider Adapter
        ↓
External Provider
```

Primary providers:

```text
MTN MoMo
Airtel Money
Banking Integrations
Future Payment Providers
```

Payment operations MUST support:

* idempotency;
* provider reference;
* internal transaction reference;
* tenant context;
* retries;
* timeout handling;
* callback processing;
* signature validation;
* reconciliation;
* settlement;
* auditability.

---

# 13. Callback Architecture

Callbacks from external providers MUST NEVER be trusted directly.

Reference flow:

```text
Provider
   ↓
Callback Endpoint
   ↓
Request Capture
   ↓
Signature Verification
   ↓
Schema Validation
   ↓
Normalization
   ↓
Replay / Idempotency Check
   ↓
Callback Registry
   ↓
Processing Engine
   ↓
Transaction State Update
   ↓
Ledger / Settlement
   ↓
Audit + Event
```

Provider callback handlers MUST remain provider-specific.

The normalized domain event MUST remain provider-neutral.

---

# 14. Settlement Domain

Settlement reconciles provider transactions with internal financial records.

Reference flow:

```text
Provider Statement
      ↓
Statement Import
      ↓
Normalization
      ↓
Validation
      ↓
Batch Ownership / Claim
      ↓
Matching
      ↓
Reconciliation
      ↓
Repair / Exception
      ↓
Ledger Adjustment
      ↓
Settlement Completion
```

The statement-processing subsystem includes:

```text
StatementContext
StatementConstants
StatementErrors
StatementImporter
StatementNormalizer
StatementValidator
StatementRepository
StatementBatchManager
StatementProcessor
StatementReconciliationService
StatementRepairService
```

Worker coordination MUST be safe against concurrent claims.

---

# 15. Compliance Domain

Compliance is divided into:

```text
KYC
AML
Regulatory Reporting
Regulatory Submission
Compliance Validation
Screening
Case Management
Audit
```

Regulatory workflows MUST be:

* traceable;
* tenant-aware;
* auditable;
* idempotent;
* retryable;
* versioned where regulatory schemas evolve.

External regulatory adapters MUST remain isolated from domain rules.

---

# 16. Risk / Fraud / AI Domain

The risk and intelligence platform may include:

```text
Loan Risk Profile
Risk Scoring
Fraud Detection
Anomaly Classification
Cross-Account Analysis
Risk Index Calculation
Trend Detection
AI Confidence Scoring
AI Repair Classification
Recommendation Engine
```

AI and heuristic outputs MUST be treated as decision-support signals unless an explicit controlled workflow authorizes automated decisions.

Every material automated decision SHOULD retain:

* scoring version;
* input fingerprint;
* correlation ID;
* tenant identity;
* subject identity;
* decision timestamp;
* model / ruleset identity;
* reason codes.

---

# 17. Workflow and Transaction Orchestration

Long-running workflows MUST NOT depend on a single synchronous HTTP request.

The orchestration layer provides:

* state machines;
* workflow execution;
* retry policies;
* execution timeouts;
* transaction contexts;
* idempotency;
* compensation;
* rollback orchestration where applicable;
* persistent operation state;
* asynchronous recovery.

Representative architecture:

```text
Command
  ↓
Operation Context
  ↓
State Machine
  ↓
Step 1
  ↓
Step 2
  ↓
Step 3
  ↓
Completion
```

Failure:

```text
Step Failure
   ↓
Retry
   ↓
Compensation
   ↓
Recovery / Manual Intervention
```

---

# 18. Distributed Transaction Manager

Where a workflow crosses multiple transactional systems, the Distributed Transaction Manager coordinates business-level consistency.

It MUST NOT attempt to simulate a global ACID database transaction across external systems.

It coordinates:

* transaction identity;
* state;
* execution context;
* retries;
* timeout;
* compensation;
* idempotency;
* persistence;
* audit.

External payment providers remain autonomous systems.

---

# 19. Event Architecture

The event architecture follows an asynchronous integration model.

```text
Domain Operation
      ↓
Database Transaction
      ↓
Outbox Record
      ↓
Publisher
      ↓
Message / Event Bus
      ↓
Consumers
```

Critical domain events SHOULD be published from a durable outbox to prevent:

```text
Database Commit = SUCCESS
Event Publish   = FAILED
```

from causing permanent event loss.

---

# 20. Outbox Architecture

The Outbox pattern is authoritative for reliable event publication from transactional operations.

Reference flow:

```text
BEGIN TRANSACTION
    │
    ├── Domain State Change
    │
    └── Outbox Event
        │
COMMIT
    │
    ▼
Outbox Publisher
    │
    ├── Retry
    ├── Backoff
    ├── Circuit Breaker
    └── Dead Letter
           │
           ▼
       Replay / Recovery
```

Events MUST include sufficient metadata to support:

* correlation;
* causation;
* tenant identification;
* versioning;
* replay;
* tracing;
* idempotent consumption.

---

# 21. Data Architecture

Primary persistence technologies include:

```text
MongoDB
Redis
Queue / Worker Infrastructure
Object / File Storage
```

### MongoDB

Primary system-of-record persistence for application/domain data.

MongoDB stores:

* identity;
* tenants;
* applications;
* financial records;
* operational state;
* workflow state;
* audit metadata;
* outbox records;
* reconciliation records;
* configuration.

### Redis

Redis MAY be used for:

* caching;
* distributed locks;
* rate limiting;
* token caching;
* callback replay protection;
* transient coordination;
* idempotency acceleration;
* queue support where appropriate.

Redis MUST NOT become the authoritative financial source of truth.

---

# 22. Data Ownership Rules

Each domain MUST have a clear owner for authoritative state.

Example:

| Data                  | Authoritative Owner      |
| --------------------- | ------------------------ |
| Tenant                | SaaS Platform            |
| User Identity         | Identity                 |
| Member                | Community Finance        |
| Loan                  | Lending                  |
| Payment Operation     | Payments                 |
| Ledger Account        | Financial Core           |
| Journal               | Financial Core           |
| Journal Entry         | Financial Core           |
| Posted Transaction    | Financial Core           |
| Regulatory Submission | Compliance               |
| Fraud Alert           | Fraud                    |
| Workflow Operation    | Workflow / Orchestration |
| Outbox Event          | Event Infrastructure     |
| Statement             | Settlement               |

Other modules MAY reference owned data but MUST NOT silently create competing authorities.

---

# 23. Dependency Direction

Dependencies MUST flow inward toward stable domain capabilities.

Preferred direction:

```text
API / Controllers
       ↓
Application Services
       ↓
Domain Services
       ↓
Infrastructure / Repositories
```

For financial operations:

```text
Business Domain
       ↓
Financial Application Service
       ↓
Ledger Core
       ↓
Persistence
```

External integrations:

```text
Domain
  ↓
Port / Interface
  ↓
Adapter
  ↓
External Provider
```

---

# 24. Forbidden Dependency Patterns

The following patterns are prohibited:

```text
Controller
   ↓
Direct MongoDB financial mutation
```

```text
Provider Adapter
   ↓
Direct modification of Ledger collections
```

```text
Business Module A
   ↓
Private duplicate balance engine
```

```text
Payment Provider
   ↓
Direct trust of callback payload
```

```text
Frontend
   ↓
Authoritative financial calculation
```

```text
Redis
   ↓
Authoritative financial state
```

---

# 25. Transaction Boundaries

## 25.1 Strong Transaction Boundary

A strong transactional boundary is REQUIRED when modifying:

* ledger postings;
* journal entries;
* authoritative balances;
* financial transaction status;
* financial account state.

---

## 25.2 Asynchronous Boundary

Asynchronous processing SHOULD be used for:

* notifications;
* email;
* SMS;
* analytics;
* dashboards;
* external callbacks;
* statement processing;
* settlement jobs;
* reporting;
* regulatory submissions where permitted;
* fraud analysis;
* AI analysis.

---

# 26. Security Architecture

Security controls include:

```text
TLS
 ↓
Helmet / Security Headers
 ↓
CORS Policy
 ↓
Rate Limiting
 ↓
Authentication
 ↓
Authorization
 ↓
Tenant Isolation
 ↓
Input Validation
 ↓
Idempotency
 ↓
Audit Logging
 ↓
Encryption / Secret Management
 ↓
Monitoring / Alerting
```

Security-sensitive values MUST NOT be logged.

Examples:

* passwords;
* access tokens;
* refresh tokens;
* provider secrets;
* client secrets;
* API keys;
* full financial credentials;
* sensitive KYC information.

---

# 27. Tenant Isolation Model

Every tenant-scoped record SHOULD contain tenant identity where applicable.

Representative pattern:

```text
tenantId
   ↓
Resource Ownership
   ↓
Authorization
   ↓
Query Scope
```

Every repository query MUST apply tenant scope where the underlying entity is tenant-owned.

Cross-tenant administrative operations MUST require explicit elevated authorization.

---

# 28. Audit Architecture

Auditing is mandatory for high-risk and high-value actions.

Audit records SHOULD include:

```text
eventId
tenantId
actorId
actorType
action
resourceType
resourceId
correlationId
requestId
before
after
result
reason
timestamp
ipAddress
userAgent
```

Financial and compliance audit data MUST be tamper-evident where required.

Hash-chain support MAY be applied to audit logs:

```text
Previous Hash
      +
Current Event
      ↓
Current Hash
```

---

# 29. Observability Architecture

The platform MUST support three observability pillars.

## Logs

Structured JSON logs SHOULD include:

```text
timestamp
level
service
environment
requestId
correlationId
tenantId
transactionId
operationId
userId
event
message
error
```

## Metrics

Examples:

```text
http_requests_total
http_request_duration
payment_attempts_total
payment_failures_total
ledger_postings_total
ledger_posting_failures_total
reconciliation_backlog
queue_depth
callback_replays
callback_failures
loan_applications_total
loan_disbursements_total
```

## Traces

OpenTelemetry-compatible tracing SHOULD propagate:

```text
traceId
spanId
parentSpanId
tenantId
correlationId
```

across internal and external boundaries where technically feasible.

---

# 30. Resilience Architecture

Production components MUST be designed for:

* retries;
* exponential backoff;
* timeouts;
* circuit breakers;
* dead-letter processing;
* idempotency;
* graceful degradation;
* failure isolation;
* health checks;
* graceful shutdown.

Reference pattern:

```text
Request
  ↓
Timeout
  ↓
Retry Policy
  ↓
Circuit Breaker
  ↓
Provider
  ↓
Failure
  ↓
Dead Letter / Recovery
```

Retries MUST NOT create duplicate financial effects.

---

# 31. Background Processing Architecture

Long-running tasks SHOULD run outside the synchronous HTTP request lifecycle.

Examples:

```text
Statement Processing
Payment Settlement
MoMo Settlement
Airtel Settlement
Ledger Integrity Checks
Interest Accrual
Regulatory Submission
Notifications
Reporting
Risk Analysis
Fraud Analysis
```

Workers MUST support:

* operation identity;
* job identity;
* claim ownership;
* lease/timeout;
* retry;
* completion;
* failure;
* release;
* recovery.

---

# 32. Deployment Architecture

Target production topology:

```text
                    Internet
                       │
                       ▼
                Load Balancer / CDN
                       │
                       ▼
                API / Edge Layer
                       │
              ┌────────┴────────┐
              │                 │
              ▼                 ▼
        Application Pods    Worker Pods
              │                 │
              └────────┬────────┘
                       │
              ┌────────┼─────────┐
              │        │         │
              ▼        ▼         ▼
           MongoDB   Redis     Queue
              │
              ▼
        Backup / Recovery
```

The platform SHOULD support horizontal scaling of stateless API processes and worker processes.

---

# 33. Runtime Configuration

Environment-specific configuration MUST be externalized.

Typical environments:

```text
development
test
staging
production
```

Production secrets MUST NOT be committed to source control.

Configuration SHOULD distinguish:

```text
application configuration
provider configuration
security secrets
database configuration
observability configuration
feature flags
operational limits
```

---

# 34. Health Architecture

The platform SHOULD expose:

```text
/liveness
/readiness
/health
```

### Liveness

Answers:

> Is the process alive?

### Readiness

Answers:

> Can the process safely receive production traffic?

Readiness SHOULD consider critical dependencies such as:

* database;
* Redis;
* required configuration;
* required initialization state.

A temporary external payment-provider outage should not necessarily make the whole API process unready unless that dependency is required for core service availability.

---

# 35. Graceful Shutdown

Shutdown sequence:

```text
Receive SIGTERM
      ↓
Stop accepting new requests
      ↓
Mark instance unready
      ↓
Stop new background work
      ↓
Drain active requests
      ↓
Finish / safely release owned jobs
      ↓
Flush telemetry
      ↓
Close queue connections
      ↓
Close Redis
      ↓
Close MongoDB
      ↓
Exit
```

Shutdown MUST be bounded by an operational timeout.

---

# 36. API Architecture

API design SHOULD follow:

```text
/version
   /resource
      /sub-resource
```

Examples:

```text
/api/v1/auth
/api/v1/tenants
/api/v1/members
/api/v1/savings
/api/v1/loans
/api/v1/payments
/api/v1/accounts
/api/v1/transactions
/api/v1/compliance
```

APIs SHOULD provide:

* consistent HTTP semantics;
* consistent error envelopes;
* request IDs;
* idempotency where applicable;
* pagination;
* filtering;
* authorization;
* schema validation;
* API versioning.

---

# 37. Error Architecture

Application errors SHOULD be categorized.

Representative categories:

```text
ValidationError
AuthenticationError
AuthorizationError
NotFoundError
ConflictError
IdempotencyConflictError
BusinessRuleError
FinancialPostingError
ProviderError
TimeoutError
RateLimitError
ConfigurationError
InfrastructureError
InternalError
```

External error responses MUST NOT expose sensitive internal implementation details.

---

# 38. Idempotency Architecture

Idempotency keys SHOULD be scoped appropriately.

Recommended logical model:

```text
tenantId
+
operationType
+
idempotencyKey
+
requestFingerprint
```

The system SHOULD preserve the original result for safely repeatable operations.

Duplicate requests MUST produce deterministic behavior.

---

# 39. Financial Reconciliation Architecture

Reconciliation is a first-class control.

Three levels are expected:

```text
Transaction Reconciliation
Settlement Reconciliation
Ledger Reconciliation
```

Reference model:

```text
External Source
      ↓
Statement / Callback
      ↓
Normalization
      ↓
Matching Engine
      ↓
Reconciliation Result
      ├── Matched
      ├── Partially Matched
      ├── Unmatched
      └── Exception
```

Exceptions MUST enter a controlled investigation / repair process.

---

# 40. Statement Processing Architecture

The statement pipeline is:

```text
IMPORT
  ↓
NORMALIZE
  ↓
VALIDATE
  ↓
BATCH
  ↓
CLAIM
  ↓
PROCESS
  ↓
MATCH
  ↓
RECONCILE
  ↓
REPAIR
  ↓
POST / ADJUST
  ↓
COMPLETE
```

Concurrent workers MUST use safe ownership semantics.

A worker MUST NOT process a batch unless it has successfully acquired ownership.

---

# 41. Financial Period Architecture

Financial periods provide operational accounting controls.

Expected lifecycle:

```text
OPEN
  ↓
SOFT_CLOSE
  ↓
FINAL_CLOSE
  ↓
LOCKED
```

After final close:

* ordinary posting is restricted;
* corrections require approved controlled processes;
* period integrity checks SHOULD run;
* audit evidence MUST be retained.

---

# 42. Snapshot Architecture

Balance snapshots SHOULD support:

* historical balance reporting;
* reconciliation;
* audit;
* performance optimization;
* period-close verification.

Snapshots MUST be traceable back to authoritative ledger state.

Snapshots MUST NOT replace the ledger as the financial source of truth.

---

# 43. Reporting Architecture

Reporting SHOULD be separated from transactional write paths.

Reference model:

```text
Transactional Data
      ↓
Events / CDC / Controlled Reads
      ↓
Reporting Projection
      ↓
Dashboard / Report
```

Operational dashboards MAY use near-real-time projections.

Financial reports MUST use authoritative financial data and controlled reporting logic.

---

# 44. Integration Architecture

All external systems MUST be represented as integration boundaries.

Recommended pattern:

```text
Application Service
       ↓
Port / Interface
       ↓
Adapter Factory
       ↓
Provider Adapter
       ↓
HTTP / SDK
       ↓
External System
```

Provider adapters SHOULD handle:

* authentication;
* provider request construction;
* provider response parsing;
* provider-specific errors;
* retries;
* timeouts;
* callback normalization;
* provider correlation.

Business logic belongs outside the adapter.

---

# 45. MTN MoMo Architecture

High-level structure:

```text
Payment Service
      ↓
MTN Adapter
      ↓
Authentication Service
      ↓
MTN API
```

Callback:

```text
MTN
 ↓
MTN Callback Handler
 ↓
Signature / Validation
 ↓
Normalization
 ↓
Payment Processing Engine
 ↓
Ledger / Settlement
```

---

# 46. Airtel Money Architecture

High-level structure:

```text
Payment Service
      ↓
Airtel Adapter
      ↓
Airtel Authentication
      ↓
Airtel API
```

Authentication SHOULD isolate:

* OAuth configuration;
* token caching;
* token skew;
* retry policy;
* HTTP configuration;
* security policy.

Callback:

```text
Airtel
 ↓
Airtel Callback Handler
 ↓
Signature / Validation
 ↓
Normalization
 ↓
Payment Processing Engine
 ↓
Ledger / Settlement
```

---

# 47. Notification Architecture

Notifications MUST be asynchronous.

Reference:

```text
Domain Event
      ↓
Notification Decision
      ↓
Notification Queue
      ↓
Channel Adapter
      ├── SMS
      ├── Email
      ├── Push
      └── In-App
```

Notification failures MUST NOT roll back successful financial transactions unless explicitly defined as part of the transaction boundary.

---

# 48. API-to-Domain Mapping

Recommended high-level ownership:

| API Area        | Primary Domain          |
| --------------- | ----------------------- |
| `/auth`         | Identity                |
| `/tenants`      | SaaS Platform           |
| `/onboarding`   | SaaS / Onboarding       |
| `/members`      | Community Finance       |
| `/groups`       | Community Finance       |
| `/savings`      | Community Finance       |
| `/loans`        | Lending                 |
| `/payments`     | Payment                 |
| `/settlements`  | Settlement              |
| `/accounts`     | Financial Core          |
| `/transactions` | Financial Core          |
| `/ledger`       | Financial Core          |
| `/compliance`   | Compliance              |
| `/risk`         | Risk                    |
| `/fraud`        | Fraud                   |
| `/reports`      | Reporting               |
| `/admin`        | Platform Administration |

---

# 49. Service Layer Responsibilities

## Controllers

Responsible for:

* transport;
* parsing;
* response formatting;
* HTTP status mapping.

Not responsible for:

* ledger logic;
* complex domain rules;
* provider orchestration.

## Application Services

Responsible for:

* use-case orchestration;
* authorization checks;
* transaction coordination;
* invoking domain services.

## Domain Services

Responsible for:

* domain rules;
* invariants;
* lifecycle decisions;
* state transitions.

## Repositories

Responsible for:

* persistence;
* query composition;
* optimistic/concurrency controls;
* data access.

Repositories MUST NOT silently implement business workflows.

---

# 50. Repository Architecture

Repositories SHOULD expose domain-oriented persistence operations where appropriate.

Examples:

```text
create()
findOne()
findById()
update()
findOneAndUpdate()
claim()
complete()
fail()
release()
releaseExpiredClaims()
```

State transition methods MUST enforce the expected current state.

Example:

```text
PROCESSING → COMPLETE
```

MUST NOT overwrite:

```text
FAILED
```

without an explicit recovery transition.

---

# 51. Concurrency Architecture

Financial and operational concurrency MUST be treated as a first-class concern.

Controls include:

* atomic updates;
* optimistic concurrency;
* unique constraints;
* operation keys;
* idempotency;
* job claims;
* lease expiration;
* transactional writes;
* state preconditions.

Bad:

```text
read state
modify in memory
save unconditionally
```

Preferred:

```text
atomic update where state = expectedState
```

---

# 52. Caching Rules

Caching MAY improve performance but MUST NOT invalidate financial correctness.

Caching MUST NOT become authoritative for:

* ledger balances;
* posted transactions;
* financial account state;
* regulatory submissions.

Cache invalidation MUST be designed explicitly.

---

# 53. Configuration and Feature Flags

Feature flags SHOULD control risky rollout of:

* payment providers;
* financial workflows;
* experimental risk models;
* regulatory features;
* tenant capabilities.

Flags MUST NOT be used to bypass core financial integrity rules.

---

# 54. Disaster Recovery

Production infrastructure MUST support:

```text
Backup
Restore
Point-in-Time Recovery
Recovery Testing
Data Integrity Verification
Operational Runbooks
```

Critical financial data requires stricter recovery objectives than non-critical analytics.

Recovery procedures MUST preserve:

* ledger integrity;
* transaction uniqueness;
* audit continuity;
* event recoverability.

---

# 55. Backup Architecture

Backups SHOULD be:

* automated;
* encrypted;
* monitored;
* retained according to policy;
* periodically restored in test environments.

A backup is not considered valid until restoration has been tested.

---

# 56. Operational Control Plane

Operational systems SHOULD provide visibility into:

```text
Payments
Settlements
Ledger
Jobs
Queues
Callbacks
Reconciliation
Compliance
Fraud
Errors
Provider Health
Database Health
Redis Health
```

Operational workflows MUST expose sufficient information for investigation without exposing protected secrets.

---

# 57. Architecture Invariants

The following are non-negotiable:

```text
1. No direct balance mutation outside the Financial Core.
2. No unbalanced journal posting.
3. No mutable posted financial history.
4. No cross-tenant access without explicit authorization.
5. No trust of unsigned/unvalidated provider callbacks.
6. No retry of non-idempotent financial operations.
7. No provider-specific business logic leaking into core domains.
8. No Redis-only authoritative financial state.
9. No silent state-machine transitions.
10. No uncontrolled background job execution.
11. No sensitive secrets in logs.
12. No financial workflow without auditability.
13. No production dependency without observability.
14. No critical external integration without timeout and retry policy.
15. No event-dependent workflow without a durable delivery strategy.
```

---

# 58. Architecture Decision Rules

When introducing a new module, the engineering team MUST answer:

```text
1. Which domain owns it?
2. Which data does it own?
3. Which service owns its business rules?
4. Which APIs expose it?
5. What are its transaction boundaries?
6. What events does it emit?
7. What events does it consume?
8. What external systems does it integrate with?
9. How is it idempotent?
10. How is it audited?
11. How is it observed?
12. How does it recover from failure?
13. How is tenant isolation enforced?
14. How is concurrency controlled?
15. How is it tested?
```

A module MUST NOT be added solely because it solves a local feature requirement while introducing an uncontrolled architectural dependency.

---

# 59. Production Readiness Gate

A domain is considered production-ready only when it demonstrates:

```text
[ ] Explicit ownership
[ ] Tenant isolation
[ ] Authentication and authorization
[ ] Input validation
[ ] Business invariants
[ ] Idempotency
[ ] Concurrency protection
[ ] Persistence integrity
[ ] Error handling
[ ] Retry and timeout policy
[ ] Auditability
[ ] Structured logging
[ ] Metrics
[ ] Tracing where appropriate
[ ] Health checks
[ ] Graceful shutdown support
[ ] Operational dashboards
[ ] Failure recovery
[ ] Integration tests
[ ] Security tests
[ ] Documentation
```

Financial domains require additional controls:

```text
[ ] Double-entry validation
[ ] Immutable history
[ ] Reversal mechanism
[ ] Reconciliation
[ ] Period controls
[ ] Audit evidence
[ ] Ledger integrity verification
[ ] Duplicate posting protection
```

---

# 60. Architecture Evolution Strategy

The platform MUST evolve incrementally.

Preferred strategy:

```text
Stabilize
   ↓
Harden
   ↓
Observe
   ↓
Test
   ↓
Scale
   ↓
Expand
```

Avoid:

```text
Feature Expansion
   ↓
More Modules
   ↓
More Dependencies
   ↓
More Exceptions
   ↓
Architectural Drift
```

The platform should prioritize consolidation and hardening of the financial operating foundation before uncontrolled expansion of peripheral capabilities.

---

# 61. Current Strategic Build Order

Recommended architecture-first sequence:

```text
PHASE 1
Financial Core
 ├── Ledger
 ├── Journal
 ├── Posting
 ├── Reversal
 ├── Balances
 ├── Snapshots
 ├── Reconciliation
 └── Period Close

PHASE 2
Core Financial Workflows
 ├── Savings
 ├── Loan Lifecycle
 ├── Disbursement
 └── Repayment

PHASE 3
Payment Rails
 ├── MTN MoMo
 ├── Airtel Money
 ├── Callback Security
 └── Settlement

PHASE 4
Platform Operations
 ├── Tenant Billing
 ├── Plans
 ├── Entitlements
 └── SaaS Controls

PHASE 5
Compliance
 ├── KYC
 ├── AML
 └── Regulatory Reporting

PHASE 6
Workflow Infrastructure
 ├── Outbox
 ├── Queue
 ├── Retry
 ├── Dead Letter
 └── Replay

PHASE 7
Risk / Fraud / Intelligence
 ├── Risk Scoring
 ├── Fraud Detection
 ├── AI
 └── Forecasting

PHASE 8
Scale / Platform Engineering
 ├── Kubernetes
 ├── Horizontal Scaling
 ├── Advanced Observability
 └── Disaster Recovery
```

---

# 62. Canonical Architecture Flow

The preferred end-to-end pattern for a critical financial operation is:

```text
Client
  ↓
API Gateway / Express Edge
  ↓
Authentication
  ↓
Authorization
  ↓
Tenant Context
  ↓
Request Validation
  ↓
Idempotency Check
  ↓
Application Service
  ↓
Domain Validation
  ↓
Workflow / Transaction Context
  ↓
Financial Service
  ↓
Ledger Engine
  ↓
Double-Entry Posting
  ↓
Audit Record
  ↓
Outbox Event
  ↓
Commit
  ↓
Async Consumers
  ├── Settlement
  ├── Notification
  ├── Reporting
  ├── Risk
  └── Compliance
```

This pattern SHOULD be used wherever practical.

---

# 63. Reference Dependency Graph

```text
                         ┌───────────────────┐
                         │      Clients      │
                         └─────────┬─────────┘
                                   │
                                   ▼
                         ┌───────────────────┐
                         │   API / Gateway   │
                         └─────────┬─────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────┐
                    │ Application / Use Cases     │
                    └──────────────┬──────────────┘
                                   │
             ┌─────────────────────┼─────────────────────┐
             │                     │                     │
             ▼                     ▼                     ▼
      ┌─────────────┐       ┌─────────────┐       ┌─────────────┐
      │ Lending     │       │ Savings     │       │ Payments    │
      └──────┬──────┘       └──────┬──────┘       └──────┬──────┘
             │                     │                     │
             └─────────────────────┼─────────────────────┘
                                   ▼
                         ┌───────────────────┐
                         │ Financial Core    │
                         ├───────────────────┤
                         │ Ledger            │
                         │ Journal           │
                         │ Posting           │
                         │ Balance           │
                         │ Reconciliation    │
                         └─────────┬─────────┘
                                   │
                         ┌─────────┴─────────┐
                         │                   │
                         ▼                   ▼
                  ┌────────────┐      ┌───────────────┐
                  │ Persistence│      │ Outbox/Event  │
                  └────────────┘      └───────┬───────┘
                                              │
                          ┌───────────────────┼──────────────────┐
                          │                   │                  │
                          ▼                   ▼                  ▼
                    Notifications       Compliance          Analytics
```

---

# 64. Architecture Ownership Model

Each production service/module SHOULD have:

```text
Technical Owner
Business Owner
Data Owner
Operational Owner
Security Responsibility
Compliance Responsibility
```

Ownership MUST be explicit enough to answer:

> Who is responsible when this component fails?

---

# 65. Documentation Hierarchy

The architecture documentation hierarchy is:

```text
docs/
├── 01-product/
├── 02-architecture/
│   ├── ARCHITECTURE_MAP.md
│   ├── SERVICE_CATALOGUE.md
│   ├── API_CATALOGUE.md
│   ├── DATA_MODEL_CATALOGUE.md
│   ├── SECURITY_MODEL.md
│   ├── EVENT_CATALOGUE.md
│   ├── FINANCIAL_LEDGER_SPECIFICATION.md
│   ├── TRANSACTION_STATE_MACHINE.md
│   └── ...
├── 03-security/
├── 04-operations/
└── ...
```

`ARCHITECTURE_MAP.md` is the top-level structural map.

Detailed documents MUST NOT contradict the architecture map.

When architecture changes, dependent documentation MUST be updated as part of the same change.

---

# 66. Architecture Change Control

Architectural changes MUST identify:

```text
Current State
Proposed State
Reason
Affected Domains
Affected Data
Affected APIs
Affected Events
Affected Security Controls
Migration Plan
Rollback Plan
Operational Impact
Testing Strategy
```

Breaking changes require explicit review.

Architectural changes MUST NOT be hidden inside unrelated feature implementation.

---

# 67. Definition of Architectural Integrity

The TITech architecture remains structurally healthy when:

```text
Business modules
      ↓
Use cases
      ↓
Authoritative domain services
      ↓
Financial Core where financial state is involved
      ↓
Controlled persistence
      ↓
Durable event publication
      ↓
Observable asynchronous processing
```

The architecture is considered degraded when:

```text
Business logic is duplicated
Financial balances are independently calculated
Providers directly mutate domain data
Callbacks bypass validation
State transitions are implicit
Tenant filtering is inconsistent
Jobs cannot be safely retried
Events can be lost after database commit
Critical operations cannot be audited
Production failures cannot be observed or recovered
```

---

# 68. Enterprise Target State

The target production platform can be represented as:

```text
                         TITech Community Capital
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
              ▼                   ▼                   ▼
         EXPERIENCE           PLATFORM          INTEGRATION
              │                   │                   │
      Web / Mobile / API      Identity / SaaS     Providers / Banks
              │               Tenants / Billing        │
              │                   │                    │
              └───────────────────┼────────────────────┘
                                  │
                                  ▼
                         BUSINESS DOMAINS
              ┌───────────────────┼───────────────────┐
              │                   │                   │
              ▼                   ▼                   ▼
          Savings             Lending            Payments
              │                   │                   │
              └───────────────────┼───────────────────┘
                                  │
                                  ▼
                         FINANCIAL OPERATING
                               CORE
                                  │
             ┌────────────────────┼────────────────────┐
             │                    │                    │
             ▼                    ▼                    ▼
           Ledger            Reconciliation        Period Close
             │                    │                    │
             └────────────────────┼────────────────────┘
                                  │
                                  ▼
                       CONTROL / INTELLIGENCE
               ┌────────────┬──────────────┬──────────────┐
               │            │              │              │
               ▼            ▼              ▼              ▼
            Compliance     Risk          Fraud           AI
               │            │              │              │
               └────────────┴──────────────┴──────────────┘
                                  │
                                  ▼
                    EVENT / WORKFLOW PLATFORM
                                  │
             ┌────────────────────┼────────────────────┐
             │                    │                    │
             ▼                    ▼                    ▼
           Queue              Outbox               Workers
             │                    │                    │
             └────────────────────┼────────────────────┘
                                  │
                                  ▼
                    DATA + INFRASTRUCTURE
              MongoDB / Redis / Storage / Runtime
                                  │
                                  ▼
                     OBSERVABILITY + OPERATIONS
             Logs / Metrics / Traces / Audit / Alerts
```

---

# 69. Final Architectural Rule

The central rule of the TITech Community Capital architecture is:

> **Every critical business capability must have a clear owner, every financial effect must pass through the Financial Core, every external integration must cross a controlled adapter boundary, every important state transition must be explicit, every retryable operation must be idempotent, every production-critical action must be observable, and every material financial action must be auditable.**

This architecture map is the baseline against which new services, modules, APIs, integrations, data models, jobs, workflows, and infrastructure changes SHOULD be evaluated.

---

## 70. Related Architecture Documents

The following documents should remain aligned with this architecture map:

```text
docs/02-architecture/SERVICE_CATALOGUE.md
docs/02-architecture/API_CATALOGUE.md
docs/02-architecture/DATA_MODEL_CATALOGUE.md
docs/02-architecture/SECURITY_MODEL.md
docs/02-architecture/EVENT_CATALOGUE.md
docs/02-architecture/FINANCIAL_LEDGER_SPECIFICATION.md
docs/02-architecture/TRANSACTION_STATE_MACHINE.md
```

Where a conflict exists, the architecture decision record and approved architectural change MUST determine the authoritative target state.

---

**End of Architecture Map**