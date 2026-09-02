# TITech Community Capital LTD

# Service Catalogue

**Document:** `docs/02-architecture/SERVICE_CATALOGUE.md`
**Status:** Enterprise Production Baseline
**Version:** 1.0.0
**Classification:** Internal Architecture / Engineering Standard
**System:** TITech Community Capital – Community Savings Platform
**Last Updated:** 2026-08-15

---

## 1. Purpose

This document defines the authoritative service catalogue for the TITech Community Capital platform.

The catalogue establishes:

* service boundaries;
* service ownership and responsibilities;
* authoritative data ownership;
* synchronous and asynchronous dependencies;
* API and command boundaries;
* event publishing and consumption responsibilities;
* transactional guarantees;
* security and tenancy boundaries;
* observability expectations;
* failure and recovery characteristics;
* integration points;
* operational criticality;
* architectural constraints.

The catalogue exists to prevent uncontrolled feature expansion, duplicated business logic, direct cross-module data manipulation, hidden dependencies, and inconsistent transaction handling.

No new production service should be introduced without determining where it belongs in this catalogue.

---

# 2. Architectural Principles

## 2.1 Service Boundary Principle

Every business capability SHALL have one authoritative service boundary.

A capability MUST NOT be implemented independently in multiple modules merely because multiple consumers need the same outcome.

Consumers MUST call the authoritative service rather than reproducing its business rules.

---

## 2.2 Financial Authority Principle

The Financial Core is the authoritative source of truth for financial state.

No application service, controller, integration adapter, scheduled job, or background worker may directly mutate authoritative financial balances outside the approved ledger/posting interfaces.

Financial state changes SHALL flow through the Ledger Engine and its controlled posting/reversal mechanisms.

---

## 2.3 Immutable Financial History

Financial records representing completed economic activity SHALL be append-only.

Corrections SHALL be represented through:

* reversals;
* adjustments;
* compensating journal entries;
* reconciliation adjustments;
* explicit investigation outcomes.

Historical financial records SHALL NOT be silently edited to change economic meaning.

---

## 2.4 Multi-Tenant Isolation

Every tenant-aware service SHALL preserve tenant isolation across:

* authentication;
* authorization;
* persistence;
* caching;
* queues;
* events;
* observability;
* background jobs;
* integrations.

Tenant context SHALL be explicit and traceable.

Cross-tenant access SHALL require an explicitly authorized platform-level operation.

---

## 2.5 Idempotency

All externally retriable financial and integration operations SHALL be idempotent.

At minimum, idempotency SHALL exist for:

* payment requests;
* payment callbacks;
* ledger postings;
* billing operations;
* settlement operations;
* regulatory submissions;
* batch operations;
* asynchronous command execution where duplicate delivery is possible.

---

## 2.6 Explicit State Machines

Business workflows SHALL use explicit lifecycle states rather than implicit status mutation.

Examples include:

* onboarding;
* loan applications;
* loan approvals;
* disbursements;
* repayments;
* payments;
* settlement;
* billing;
* statement processing;
* reconciliation;
* compliance submissions.

Invalid state transitions SHALL be rejected.

---

## 2.7 Outbox/Event Reliability

Business-critical events SHALL use durable publication mechanisms where required.

The preferred pattern is:

```text
Business Transaction
      ↓
Database State Change
      ↓
Outbox Record
      ↓
Publisher
      ↓
Event Bus / Queue
      ↓
Consumers
```

Services SHALL NOT rely on an in-memory event alone for a business-critical state transition.

---

## 2.8 Observability by Default

Production services SHALL expose sufficient telemetry to correlate:

* tenant;
* request;
* user;
* operation;
* transaction;
* payment;
* provider;
* batch;
* job;
* event;
* trace.

Structured logging, metrics, tracing, audit logging, and failure classification SHALL be treated as platform capabilities rather than optional enhancements.

---

# 3. Service Classification

Services are classified into the following tiers.

| Tier | Classification       | Description                                                      |
| ---- | -------------------- | ---------------------------------------------------------------- |
| T0   | Critical Financial   | Failure can compromise financial correctness or ledger integrity |
| T1   | Critical Business    | Failure can stop major business workflows                        |
| T2   | Platform Critical    | Required for platform operation, security, or tenant isolation   |
| T3   | Integration Critical | Required for external provider or regulatory communication       |
| T4   | Supporting           | Important operational or analytical capability                   |
| T5   | Optional / Extension | Non-core capability that can degrade independently               |

---

# 4. High-Level Service Map

```text
                           ┌──────────────────────┐
                           │      API Gateway     │
                           └──────────┬───────────┘
                                      │
                 ┌────────────────────┼────────────────────┐
                 │                    │                    │
                 ▼                    ▼                    ▼
          Authentication        Tenant / SaaS        Onboarding
                 │                    │                    │
                 └───────────────┬────┴────────────────────┘
                                 │
                                 ▼
                      ┌─────────────────────┐
                      │    Business Core    │
                      └──────────┬──────────┘
                                 │
             ┌───────────────────┼────────────────────┐
             │                   │                    │
             ▼                   ▼                    ▼
        Loan Engine         Savings Core         Billing
             │                   │                    │
             └───────────────────┼────────────────────┘
                                 │
                                 ▼
                      ┌─────────────────────┐
                      │   Financial Core    │
                      │ Double-Entry Ledger │
                      └──────────┬──────────┘
                                 │
                ┌────────────────┼─────────────────┐
                │                │                 │
                ▼                ▼                 ▼
           Payments         Settlement        Reconciliation
                │                │                 │
                ▼                ▼                 ▼
          MTN MoMo         Airtel Money      Statements
                │
                ▼
       External Provider Rails

                    ┌───────────────────────────────┐
                    │ Compliance / Risk / Fraud     │
                    └──────────────┬────────────────┘
                                   │
                  ┌────────────────┼────────────────┐
                  ▼                ▼                ▼
                 KYC              AML          Regulatory
                                               Reporting

                    ┌───────────────────────────────┐
                    │ Platform Infrastructure       │
                    ├───────────────────────────────┤
                    │ Queue / Events / Audit         │
                    │ Notifications / Observability  │
                    │ Resilience / Scheduling        │
                    └───────────────────────────────┘
```

---

# 5. Service Registry

## 5.1 API and Platform Foundation

| Service                        | Tier | Primary Responsibility                           | Authoritative Data            |
| ------------------------------ | ---- | ------------------------------------------------ | ----------------------------- |
| API Gateway / HTTP Application | T2   | Request routing, middleware, security, lifecycle | None                          |
| Authentication Service         | T2   | Identity authentication, tokens, sessions        | User credentials / auth state |
| Authorization / Access Control | T2   | Permission and role enforcement                  | Roles / permissions           |
| Tenant Service                 | T2   | Tenant identity and tenancy boundaries           | Tenant records                |
| Configuration Service          | T2   | Runtime/application configuration                | Configuration                 |
| Audit Service                  | T2   | Security and business audit trail                | Audit records                 |
| Observability Service          | T2   | Logs, metrics, traces, correlation               | Telemetry                     |
| Notification Service           | T4   | Email/SMS/push/in-app delivery orchestration     | Notification state            |
| Queue / Workflow Service       | T2   | Background job execution and orchestration       | Job/workflow state            |
| Event Publisher / Bus          | T2   | Durable event publication and delivery           | Outbox/event state            |

---

# 6. Identity and Access Services

## 6.1 Authentication Service

**Responsibility**

* login;
* credential verification;
* access token issuance;
* refresh token management;
* session lifecycle;
* authentication context.

**Must not own**

* tenant business rules;
* financial authorization;
* loan approval logic;
* payment approval logic.

**Dependencies**

```text
Authentication
 ├── User Repository
 ├── Tenant Service
 ├── Authorization Service
 ├── Audit Service
 └── Observability
```

**Security Requirements**

* password hashing;
* token rotation;
* refresh-token controls;
* secure cookie policy where applicable;
* brute-force protection;
* audit events;
* request correlation.

---

## 6.2 Authorization Service

**Responsibility**

* roles;
* permissions;
* capability checks;
* resource authorization;
* tenant-aware access checks.

Authorization SHALL be enforced before sensitive business operations.

---

# 7. Tenant and SaaS Platform Services

## 7.1 Tenant Service

**Responsibility**

* tenant lifecycle;
* tenant identity;
* tenant configuration;
* tenant status;
* tenant-scoped policy resolution.

**Authoritative Object**

```text
Tenant
```

**Critical Invariant**

Every tenant-scoped operation MUST resolve a valid tenant context before accessing tenant-owned data.

---

## 7.2 SACCO Onboarding Service

**Responsibility**

* tenant registration;
* onboarding workflow;
* KYC onboarding;
* subscription onboarding;
* readiness validation;
* go-live transition.

**Workflow**

```text
REGISTERED
   ↓
VERIFICATION
   ↓
KYC
   ↓
SUBSCRIPTION
   ↓
CONFIGURATION
   ↓
READY
   ↓
GO_LIVE
```

The onboarding service SHALL orchestrate the workflow but SHALL NOT duplicate financial, KYC, subscription, or payment business rules owned by other services.

---

## 7.3 Billing / SaaS Service

**Responsibility**

* tenant plans;
* subscriptions;
* billing cycles;
* invoices;
* usage billing;
* billing operations;
* billing state transitions.

**Critical Coordination Key**

```text
operationKey
```

`BillingOperation` SHALL be used where persistent coordination is required.

---

# 8. Financial Core

The Financial Core is the most critical application boundary.

## 8.1 Ledger Engine

**Tier:** T0

**Responsibility**

* double-entry posting;
* journal creation;
* journal entry validation;
* transaction posting;
* account balancing;
* posting idempotency;
* immutable accounting records;
* transaction correlation.

**Authoritative Data**

* accounts;
* journals;
* journal entries;
* ledger transactions;
* posting metadata.

**Core Invariants**

```text
Total Debits = Total Credits
```

```text
Every posted financial transaction is balanced.
```

```text
Posted financial history is immutable.
```

```text
Every financial mutation has a unique idempotency boundary.
```

---

## 8.2 Account Service

**Responsibility**

* chart of accounts;
* account lifecycle;
* account classification;
* account ownership;
* tenant account isolation.

The Account Service SHALL NOT directly alter posted balances.

---

## 8.3 Journal Service

**Responsibility**

* journal lifecycle;
* journal headers;
* journal metadata;
* relationship between business operations and ledger entries.

---

## 8.4 Posting Engine

**Responsibility**

* posting validation;
* debit/credit balancing;
* account validation;
* period validation;
* idempotency;
* posting authorization;
* ledger write orchestration.

All financial services SHALL use the Posting Engine rather than writing journal entries directly.

---

## 8.5 Reversal Service

**Responsibility**

* transaction reversal;
* journal reversal;
* settlement reversal;
* loan disbursement reversal;
* adjustment entries.

Reversals MUST create compensating accounting records.

---

## 8.6 Balance Service

**Responsibility**

* current balance;
* ledger balance;
* available balance;
* pending balance;
* reserved balance.

The Balance Service SHALL derive balances from authoritative ledger data or approved balance materializations.

---

## 8.7 Snapshot Service

**Responsibility**

* balance snapshots;
* period snapshots;
* audit-supporting historical state;
* reconciliation checkpoints.

Snapshots SHALL NOT replace the ledger as the authoritative financial record.

---

## 8.8 Financial Period Close Service

**Responsibility**

* accounting period closure;
* period validation;
* close controls;
* reopen governance where explicitly authorized;
* financial reporting boundaries.

A closed period SHALL reject unauthorized posting.

---

## 8.9 Reconciliation Service

**Responsibility**

* compare external financial state against internal ledger state;
* detect discrepancies;
* classify mismatches;
* create reconciliation cases;
* initiate approved repair workflows.

The service SHALL NOT silently overwrite the ledger to make records match.

---

# 9. Loan Services

## 9.1 Loan Service

**Responsibility**

* loan product configuration;
* loan applications;
* loan lifecycle;
* loan contracts;
* loan status;
* repayment obligations.

---

## 9.2 Loan Risk Scoring Service

**Responsibility**

* applicant scoring;
* risk profile creation;
* score versioning;
* input fingerprinting;
* model/version traceability;
* risk decision metadata.

Relevant immutable metadata includes:

```text
baseScore
inputFingerprint
correlationId
idempotencyKey
scoringVersion
tenantId
applicant identity
```

The scoring service SHALL produce a decision artifact; final lending authorization remains controlled by the loan approval workflow.

---

## 9.3 Loan Approval Service

**Responsibility**

* approval workflow;
* maker-checker controls;
* decision recording;
* approval authority;
* approval audit trail.

Approval MUST be separate from automated scoring where policy requires independent authorization.

---

## 9.4 Loan Disbursement Service

**Responsibility**

* approved disbursement orchestration;
* payment initiation;
* ledger integration;
* idempotency;
* settlement tracking.

Disbursement SHALL NOT be treated as complete until the required financial and provider state transitions are satisfied.

---

## 9.5 Repayment / Schedule Service

**Responsibility**

* repayment schedules;
* due dates;
* principal;
* interest;
* fees;
* repayment allocation;
* overdue state.

Repayment accounting SHALL ultimately post through the Financial Core.

---

# 10. Savings Services

The Savings domain covers member savings, contributions, withdrawals, and related business rules.

Typical responsibilities include:

* savings account lifecycle;
* contribution processing;
* withdrawal workflows;
* savings product rules;
* contribution schedules;
* member savings state.

Financial effects MUST be posted through the Ledger Engine.

---

# 11. Payment Services

## 11.1 Payment Orchestration Service

**Responsibility**

* payment request lifecycle;
* provider selection;
* idempotency;
* retry orchestration;
* provider-independent transaction state;
* payment correlation.

The orchestration layer SHALL NOT contain provider-specific protocol logic.

---

## 11.2 Provider Adapter Layer

Provider integrations SHALL be isolated behind adapters.

Current/target adapters include:

```text
providers/
├── mtn/
│   └── mtnCallbackHandler.js
└── airtel/
    └── airtelCallbackHandler.js
```

Adapters SHALL translate provider protocols into normalized internal commands/events.

---

## 11.3 MTN MoMo Service

**Responsibility**

* authentication;
* payment initiation;
* provider API communication;
* callback handling;
* response normalization;
* provider-specific error mapping.

---

## 11.4 Airtel Money Service

**Responsibility**

* OAuth/client credential handling;
* token caching;
* payment initiation;
* callback handling;
* provider-specific error mapping;
* provider response normalization.

Authentication and token configuration SHALL remain centralized in the Airtel authentication subsystem.

---

# 12. Callback Processing Services

The callback subsystem exists as a separate security and reliability boundary.

## 12.1 Callback Registry

Stores provider callback registrations and routing metadata.

---

## 12.2 Callback Dispatcher

Routes accepted callbacks to the appropriate provider/business handler.

---

## 12.3 Callback Normalizer

Converts provider-specific payloads into a canonical internal representation.

---

## 12.4 Callback Validator

Validates:

* schema;
* required fields;
* provider identity;
* timestamps;
* replay conditions;
* transaction references.

---

## 12.5 Callback Processing Engine

Responsible for:

* idempotency;
* replay protection;
* state transition validation;
* processing;
* retry;
* failure classification;
* dead-letter handling.

---

# 13. Settlement Services

## 13.1 Settlement Service

**Responsibility**

* provider settlement tracking;
* settlement batches;
* settlement matching;
* settlement state machine;
* provider-to-ledger reconciliation.

---

## 13.2 Settlement Reliability Engine

**Responsibility**

* settlement reliability scoring;
* failure trend detection;
* settlement forecasting;
* operational risk indicators.

Analytical outputs SHALL NOT directly modify financial state.

---

# 14. Statement Processing Services

## 14.1 Statement Importer

Imports raw external statements.

---

## 14.2 Statement Normalizer

Transforms provider/bank-specific records into the canonical statement format.

---

## 14.3 Statement Validator

Validates normalized statement data before reconciliation.

---

## 14.4 Statement Repository

Provides persistence and controlled retrieval of statement records.

---

## 14.5 Statement Batch Manager

Responsible for controlled batch ownership, claims, completion, failure, release, and concurrent worker coordination.

Batch ownership SHALL use a claim token to prevent concurrent processing races.

---

## 14.6 Statement Processor

Coordinates:

```text
Import
  ↓
Normalize
  ↓
Validate
  ↓
Claim Batch
  ↓
Process
  ↓
Reconcile
  ↓
Complete / Fail / Release
```

---

## 14.7 Statement Reconciliation Service

Responsible for matching statement transactions against:

* internal payments;
* settlements;
* ledger transactions;
* provider references.

---

## 14.8 Statement Repair Service

Responsible for reconciliation exceptions.

Potential outcomes include:

* investigation case;
* ledger adjustment instruction;
* unmatched transaction queue;
* duplicate detection;
* repair recommendation.

Repair SHALL NOT mutate authoritative financial history outside approved ledger interfaces.

---

# 15. Compliance Services

## 15.1 KYC Service

Responsibilities:

* customer identity collection;
* verification state;
* document workflows;
* verification outcomes;
* KYC auditability.

---

## 15.2 AML Service

Responsibilities:

* AML screening;
* transaction monitoring;
* suspicious activity detection;
* risk classification;
* escalation workflows.

---

## 15.3 Regulatory Validation Service

Validates regulatory submissions before delivery.

Validation SHALL include:

* schema;
* required fields;
* regulatory rules;
* tenant identity;
* reporting period;
* reference integrity;
* submission state.

---

## 15.4 Regulatory Submission Service

Responsible for:

* submission lifecycle;
* submission packaging;
* idempotency;
* provider/regulator integration;
* acknowledgment tracking;
* retries;
* resubmission;
* audit history.

---

## 15.5 Uganda Regulatory Adapter

The Uganda regulatory adapter isolates Uganda-specific regulatory communication from the platform-wide regulatory domain.

Responsibilities include:

* jurisdiction-specific payload mapping;
* regulatory endpoint integration;
* authentication;
* submission transport;
* response normalization;
* regulatory error mapping.

Jurisdiction-specific rules SHALL NOT leak into the generic regulatory service.

---

## 15.6 Regulatory Reporting Service

Responsible for generation and lifecycle management of regulatory reports, including applicable:

* CTR;
* STR;
* SAR;
* KYC;
* fraud;
* transaction reports.

The reporting service SHALL separate report generation from submission transport.

---

# 16. Fraud and Risk Services

## 16.1 Fraud Alert Service

Creates and manages fraud alerts.

---

## 16.2 Cross-Account Analyzer

Detects suspicious relationships across accounts while enforcing tenant boundaries and privacy controls.

---

## 16.3 Risk Intelligence Services

Includes:

```text
priorityEngine
severityScorer
anomalyClassifier
riskIndexCalculator
trendDetector
```

These services SHALL be analytical and SHOULD NOT directly mutate authoritative transaction state.

---

# 17. Intelligence, Forecasting and Analytics

## 17.1 Repair Analytics

Measures:

* exception volume;
* repair rates;
* failure causes;
* resolution times.

---

## 17.2 Aging Metrics

Measures unresolved exception aging.

---

## 17.3 SLA Monitor

Tracks reconciliation, settlement, compliance, and operational SLA performance.

---

## 17.4 Recommendation Engine

Generates operational recommendations from approved analytical inputs.

Recommendations MUST remain distinguishable from authoritative business decisions unless explicitly approved by a governing workflow.

---

## 17.5 Executive Dashboard

Aggregates operational and financial indicators for management consumption.

Dashboard calculations SHALL NOT become a second financial system of record.

---

## 17.6 Board Reporting Service

Provides governance-level reporting with explicit data lineage and reporting-period semantics.

---

# 18. Distributed Transaction Coordination

## 18.1 Distributed Transaction Manager

Responsible for coordinating workflows crossing multiple services where a single database transaction is insufficient.

Capabilities include:

* transaction IDs;
* state machines;
* idempotency;
* timeout controls;
* retries;
* compensation;
* rollback/compensation handling;
* execution context.

The manager SHALL prefer compensating actions over pretending distributed ACID semantics exist across independent systems.

---

# 19. Event and Messaging Services

## 19.1 Transaction Event Publisher

Responsible for publishing durable business events.

Example event families:

```text
LoanCreated
LoanApproved
LoanDisbursed
RepaymentReceived
PaymentInitiated
PaymentCompleted
PaymentFailed
SettlementCreated
SettlementCompleted
ReconciliationExceptionCreated
RegulatorySubmissionCreated
RegulatorySubmissionAccepted
BillingOperationCompleted
```

Event names SHALL describe business facts rather than implementation details.

---

## 19.2 Outbox Service

The outbox pattern SHALL provide transactional coupling between domain state changes and event publication.

Minimum outbox metadata SHOULD include:

```text
eventId
eventType
aggregateId
tenantId
correlationId
causationId
occurredAt
payload
status
attemptCount
nextAttemptAt
publishedAt
lastError
```

---

## 19.3 Dead-Letter Processing

Failed messages that exhaust retry policy SHALL be isolated for investigation and controlled replay.

Dead-letter replay SHALL preserve original event identity and correlation metadata.

---

# 20. Job and Workflow Services

Background jobs SHOULD exist for:

* ledger integrity checks;
* reconciliation;
* interest accrual;
* settlement processing;
* statement processing;
* callback retries;
* regulatory retries;
* billing;
* notification delivery;
* analytics aggregation.

Jobs MUST be:

* idempotent;
* observable;
* retry-safe;
* tenant-aware;
* timeout-controlled.

---

# 21. Observability Services

## 21.1 Structured Logging

Every production log SHOULD support:

```text
timestamp
level
service
environment
tenantId
userId
requestId
correlationId
traceId
spanId
operationId
transactionId
event
errorCode
duration
```

Secrets, credentials, tokens, and sensitive payloads SHALL NOT be logged.

---

## 21.2 Metrics

Minimum production metrics SHOULD include:

* request rate;
* error rate;
* latency;
* queue depth;
* retry count;
* failed jobs;
* payment success/failure;
* settlement mismatch count;
* reconciliation backlog;
* ledger posting failures;
* regulatory submission failures.

---

## 21.3 Distributed Tracing

Financial and integration workflows SHOULD propagate:

```text
traceId
spanId
correlationId
causationId
```

Tracing SHALL cross service and provider adapter boundaries where practical.

---

## 21.4 Audit Logging

Audit records SHALL capture security-sensitive and business-sensitive actions, including:

* authentication;
* authorization decisions where required;
* configuration changes;
* financial approvals;
* reversals;
* manual repairs;
* regulatory actions;
* privileged administration.

Audit trails SHOULD support hash chaining or equivalent tamper-evidence controls.

---

# 22. Data Ownership Matrix

| Domain                | Authoritative Owner                    |
| --------------------- | -------------------------------------- |
| Tenant                | Tenant Service                         |
| User Identity         | Authentication / Identity Service      |
| Roles & Permissions   | Authorization Service                  |
| Onboarding State      | Onboarding Service                     |
| Subscription          | Billing Service                        |
| Billing Operation     | Billing Service                        |
| Account Definition    | Account Service                        |
| Journal               | Journal Service                        |
| Journal Entry         | Ledger / Posting Engine                |
| Financial Transaction | Ledger Engine                          |
| Financial Balances    | Balance Service / Ledger-derived state |
| Loan                  | Loan Service                           |
| Loan Risk Profile     | Risk Scoring Service                   |
| Loan Approval         | Loan Approval Service                  |
| Payment               | Payment Orchestration Service          |
| Provider Callback     | Callback Processing Subsystem          |
| Settlement            | Settlement Service                     |
| Statement             | Statement Processing Subsystem         |
| Reconciliation Case   | Reconciliation Service                 |
| Repair Case           | Statement Repair Service               |
| KYC                   | KYC Service                            |
| AML                   | AML Service                            |
| Regulatory Submission | Regulatory Submission Service          |
| Fraud Alert           | Fraud Alert Service                    |
| Notification          | Notification Service                   |
| Audit Record          | Audit Service                          |
| Event                 | Outbox / Event Publisher               |

---

# 23. Synchronous Dependency Rules

Synchronous calls are appropriate when:

* immediate authorization is required;
* a definitive validation response is required;
* the caller cannot continue without the result;
* the operation is short-lived and bounded.

Synchronous calls SHOULD NOT be used for long-running workflows where durable asynchronous orchestration is more appropriate.

---

# 24. Asynchronous Dependency Rules

Asynchronous execution SHOULD be used for:

* provider callbacks;
* retries;
* statement batches;
* reconciliation;
* notification delivery;
* analytics;
* report generation;
* regulatory retries;
* long-running workflows;
* non-blocking event propagation.

---

# 25. Service-to-Service Contract Rules

Every service contract SHOULD define:

```text
Command
Query
Event
Error
Idempotency
Authorization
Tenant Scope
Timeout
Retry Policy
Observability Context
```

A service SHALL NOT require consumers to depend upon its internal database schema.

---

# 26. API Layering Standard

The preferred request flow is:

```text
HTTP Request
   ↓
Authentication
   ↓
Tenant Context
   ↓
Authorization
   ↓
Controller
   ↓
Application Service
   ↓
Domain Service
   ↓
Repository / External Adapter
   ↓
Persistence / Provider
```

Controllers SHALL remain thin.

Controllers SHALL NOT implement:

* accounting rules;
* complex state transitions;
* provider authentication;
* settlement matching;
* regulatory decision logic.

---

# 27. Repository Rules

Repositories are responsible for persistence concerns.

Repositories SHALL NOT become hidden domain services.

Repositories SHOULD provide:

* create;
* find;
* update where permitted;
* transactional operations;
* atomic claim operations;
* idempotent lookup;
* optimistic/concurrency controls where required.

Financial repositories MUST enforce immutability boundaries.

---

# 28. Error Taxonomy

Services SHOULD expose structured error categories.

Recommended categories:

```text
VALIDATION_ERROR
AUTHENTICATION_ERROR
AUTHORIZATION_ERROR
NOT_FOUND
CONFLICT
DUPLICATE_OPERATION
INVALID_STATE_TRANSITION
IDEMPOTENCY_CONFLICT
TENANT_SCOPE_VIOLATION
PROVIDER_ERROR
TIMEOUT
RATE_LIMITED
DEPENDENCY_UNAVAILABLE
LEDGER_ERROR
RECONCILIATION_ERROR
COMPLIANCE_ERROR
INTERNAL_ERROR
```

Errors SHALL be safe for external exposure and SHALL NOT leak internal secrets or implementation details.

---

# 29. Retry Policy

Retries SHALL be classified by error type.

### Retryable

* transient network failure;
* temporary provider outage;
* connection reset;
* rate limiting;
* temporary dependency unavailability.

### Non-Retryable

* invalid request;
* invalid signature;
* invalid authorization;
* immutable state conflict;
* malformed regulatory payload;
* invalid financial posting;
* invalid business rule.

Retry operations MUST preserve idempotency.

---

# 30. Timeout Policy

Every outbound call SHALL have a bounded timeout.

Timeouts SHALL be:

* explicit;
* observable;
* classified;
* compatible with retry policy.

Long-running workflows SHALL move to asynchronous execution rather than using unbounded HTTP requests.

---

# 31. Concurrency Controls

Critical services SHALL implement appropriate concurrency controls.

Examples include:

```text
Atomic compare-and-set
Unique indexes
Idempotency keys
Operation keys
Claim tokens
Optimistic locking
State transition guards
Database transactions
Distributed locks where justified
```

Distributed locks SHOULD NOT be used where a database constraint or atomic update can provide a simpler and stronger guarantee.

---

# 32. Security Boundaries

Sensitive services SHALL enforce:

```text
Authentication
Authorization
Tenant isolation
Input validation
Output filtering
Auditability
Secret management
Rate limiting
Replay protection
Idempotency
```

External provider integrations SHALL isolate secrets from application-level business objects.

---

# 33. Service Criticality Matrix

| Service               | Tier | Financial Integrity | External Dependency | Async Required |
| --------------------- | ---: | ------------------: | ------------------: | -------------: |
| Ledger Engine         |   T0 |                 Yes |                  No |       Optional |
| Posting Engine        |   T0 |                 Yes |                  No |             No |
| Reversal Service      |   T0 |                 Yes |                  No |             No |
| Balance Service       |   T0 |                 Yes |                  No |       Optional |
| Reconciliation        |   T0 |                 Yes |                 Yes |            Yes |
| Payment Orchestration |   T1 |                 Yes |                 Yes |            Yes |
| Settlement            |   T1 |                 Yes |                 Yes |            Yes |
| Loan Service          |   T1 |                 Yes |                  No |       Optional |
| Loan Approval         |   T1 |            Indirect |                  No |       Optional |
| Billing               |   T1 |                 Yes |            Optional |            Yes |
| Onboarding            |   T1 |            Indirect |                 Yes |            Yes |
| KYC                   |   T1 |                  No |                 Yes |            Yes |
| AML                   |   T1 |            Indirect |                 Yes |            Yes |
| Regulatory Submission |   T3 |                  No |                 Yes |            Yes |
| Callback Processing   |   T1 |                 Yes |                 Yes |            Yes |
| Statement Processing  |   T1 |                 Yes |                 Yes |            Yes |
| Notification          |   T4 |                  No |                 Yes |            Yes |
| Observability         |   T2 |                  No |            Optional |            Yes |

---

# 34. Service Ownership Requirements

Every production service SHALL have:

```text
Service Name
Service Purpose
Owning Domain
Authoritative Data
Public Interfaces
Dependencies
Events Published
Events Consumed
Security Boundary
Failure Modes
Retry Policy
Timeout Policy
Observability
Operational Runbook
Test Strategy
```

A service lacking a defined owner SHALL be treated as architectural debt.

---

# 35. Forbidden Architectural Patterns

The following patterns are prohibited in production:

## 35.1 Direct Balance Mutation

```text
account.balance += amount
```

outside approved ledger/balance mechanisms.

---

## 35.2 Controller-Coupled Accounting

Controllers SHALL NOT construct journal entries directly.

---

## 35.3 Provider Logic in Business Services

MTN/Airtel-specific protocol logic SHALL NOT leak into generic payment or loan services.

---

## 35.4 Cross-Domain Database Writes

One service SHALL NOT directly update another service's authoritative tables unless the architecture explicitly defines such ownership.

---

## 35.5 Silent Financial Corrections

A financial record SHALL NOT be modified simply to make reconciliation pass.

---

## 35.6 Unbounded Retries

Retry loops SHALL always have bounded policy.

---

## 35.7 Non-Idempotent Callbacks

Provider callbacks SHALL NOT directly mutate business state without replay protection.

---

## 35.8 Hidden Background Work

Business-critical work SHALL NOT be silently delegated to an untracked background task.

---

# 36. Service Lifecycle

Every service SHALL progress through:

```text
PROPOSED
   ↓
DESIGNED
   ↓
IMPLEMENTED
   ↓
TESTED
   ↓
OBSERVABLE
   ↓
SECURITY_REVIEWED
   ↓
PRODUCTION_READY
   ↓
PRODUCTION
   ↓
DEPRECATED
   ↓
RETIRED
```

---

# 37. Production Readiness Gate

A service SHALL NOT be considered production-ready until it has:

* defined ownership;
* tenant isolation;
* authorization controls;
* input validation;
* explicit state transitions;
* idempotency where required;
* bounded retries;
* bounded timeouts;
* structured errors;
* structured logs;
* metrics;
* trace correlation;
* audit trail where applicable;
* tests;
* failure-path handling;
* operational documentation;
* data ownership boundaries;
* migration/rollback strategy;
* dependency health checks where applicable.

For financial services, additional requirements include:

* double-entry validation where applicable;
* immutable history;
* reconciliation support;
* reversal support;
* ledger correlation;
* financial-period controls;
* transaction-level auditability.

---

# 38. Service Dependency Direction

The preferred dependency direction is:

```text
API / Transport
      ↓
Application Services
      ↓
Domain Services
      ↓
Financial / Business Authorities
      ↓
Repositories / Adapters
      ↓
Infrastructure
```

Infrastructure SHALL NOT become the source of business rules.

Domain services SHALL NOT depend on HTTP transport concerns.

Provider adapters SHALL NOT become business-authority services.

---

# 39. Financial Transaction Authority

All financially material operations SHALL converge on the Financial Core.

Examples:

```text
Loan Disbursement
      ↓
Loan Service
      ↓
Payment / Disbursement
      ↓
Ledger Posting
```

```text
Repayment
      ↓
Payment Service
      ↓
Repayment Allocation
      ↓
Ledger Posting
```

```text
Settlement
      ↓
Settlement Service
      ↓
Reconciliation
      ↓
Ledger Adjustment / Confirmation
```

```text
Billing
      ↓
Billing Service
      ↓
Ledger Posting
```

The final accounting effect SHALL be represented by authoritative ledger entries.

---

# 40. Event Governance

Events SHALL be:

* versioned where required;
* tenant-aware;
* traceable;
* idempotently consumable;
* semantically meaningful;
* backward-compatible within the supported contract window.

Events SHOULD use:

```text
eventId
eventType
eventVersion
tenantId
aggregateType
aggregateId
correlationId
causationId
occurredAt
producer
payload
```

Consumers SHALL NOT assume delivery exactly once.

The platform SHALL be designed for at-least-once delivery.

---

# 41. Data Consistency Model

The platform uses multiple consistency levels.

### Strong Consistency

Required for:

* ledger posting;
* journal balancing;
* state transitions;
* idempotency ownership;
* financial period closure;
* critical authorization decisions.

### Eventual Consistency

Acceptable for:

* dashboards;
* analytics;
* notifications;
* non-critical reporting projections;
* operational trend metrics.

The consistency model SHALL be explicit for each service.

---

# 42. Disaster Recovery Expectations

Critical services SHALL define:

* backup requirements;
* recovery procedure;
* replay capability;
* reconciliation capability;
* failure isolation;
* operational dependencies.

Financial services SHALL support reconstruction or verification of balances from authoritative records.

---

# 43. Testing Strategy by Service Type

## Financial Core

Required:

* unit tests;
* integration tests;
* transaction tests;
* concurrency tests;
* idempotency tests;
* reversal tests;
* reconciliation tests;
* failure-injection tests.

## External Integrations

Required:

* contract tests;
* signature tests;
* callback replay tests;
* timeout tests;
* provider error tests;
* retry tests.

## Workflow Services

Required:

* state-machine tests;
* authorization tests;
* race-condition tests;
* duplicate-request tests.

## Reporting / Analytics

Required:

* aggregation correctness;
* period-boundary tests;
* tenant isolation tests;
* source lineage tests.

---

# 44. Current Core Service Catalogue

The production architecture currently recognizes the following primary capability families:

```text
Platform
├── API / HTTP
├── Authentication
├── Authorization
├── Tenant Management
├── Onboarding
├── Configuration
├── Audit
└── Observability

Finance
├── Ledger Engine
├── Account Management
├── Journal Management
├── Posting Engine
├── Reversal Service
├── Balance Service
├── Snapshot Service
├── Period Close
└── Reconciliation

Loans
├── Loan Management
├── Loan Risk Scoring
├── Loan Approval
├── Loan Disbursement
└── Repayment / Schedule

Savings
├── Savings Accounts
├── Contributions
└── Withdrawals

Payments
├── Payment Orchestration
├── MTN MoMo Adapter
├── Airtel Money Adapter
├── Callback Registry
├── Callback Dispatcher
├── Callback Normalizer
├── Callback Validator
└── Callback Processing Engine

Settlement
├── Settlement Management
├── Settlement Matching
└── Settlement Reliability

Statements
├── Importer
├── Normalizer
├── Validator
├── Repository
├── Batch Manager
├── Processor
├── Reconciliation
└── Repair

Compliance
├── KYC
├── AML
├── Regulatory Validation
├── Regulatory Submission
├── Uganda Regulatory Adapter
└── Regulatory Reporting

Risk / Fraud
├── Fraud Alerts
├── Cross-Account Analysis
├── Risk Scoring
├── Anomaly Classification
├── Severity Scoring
└── Risk Index

Platform Operations
├── Notifications
├── Queue / Workflow
├── Event Publisher
├── Outbox
├── Dead-Letter Processing
├── Distributed Transactions
└── Scheduled Jobs

Analytics
├── Repair Analytics
├── Aging Metrics
├── SLA Monitoring
├── Trend Detection
├── Recommendation Engine
├── Executive Dashboard
└── Board Reporting
```

---

# 45. Architectural Source-of-Truth Rules

When conflicts occur between services, the following precedence SHALL apply.

### Financial State

```text
Ledger
   >
Derived Balance
   >
Operational Projection
   >
Dashboard
```

### Payment State

```text
Canonical Payment State
   >
Provider Callback
   >
Provider Query Result
   >
UI Representation
```

### Regulatory State

```text
Regulatory Submission Record
   >
Transport Response
   >
Dashboard / UI
```

### Tenant State

```text
Tenant Service
   >
Cached Tenant State
   >
Request-Supplied Tenant Metadata
```

---

# 46. Change Management

Changes to an existing production service SHALL first determine:

1. whether the capability already exists;
2. whether the requested feature belongs to the existing service boundary;
3. whether a new domain service is genuinely required;
4. whether an existing service can provide the capability;
5. whether a new persistent model is necessary;
6. whether an API contract changes;
7. whether an event contract changes;
8. whether financial correctness is affected;
9. whether migration is required;
10. whether rollback is possible.

Feature duplication SHALL be avoided.

---

# 47. New Service Admission Criteria

A new service is justified only when at least one of the following materially applies:

* a separate authoritative data owner is required;
* an independent security boundary is required;
* an independent lifecycle is required;
* a separate scaling profile is required;
* an external protocol boundary must be isolated;
* a distinct regulatory boundary exists;
* the existing service has a materially different domain responsibility.

A new service SHALL NOT be created merely because a file or feature is becoming large.

---

# 48. Service Catalogue Governance

This document SHALL be maintained alongside architectural changes.

Any new production capability SHALL update:

```text
SERVICE_CATALOGUE.md
ARCHITECTURE_MAP.md
DEPENDENCY_MAP.md
API_CATALOGUE.md
EVENT_CATALOGUE.md
DATA_MODEL_CATALOGUE.md
```

where applicable.

Documentation drift SHALL be treated as architectural debt.

---

# 49. Definition of Done for a Production Service

A service is considered complete only when:

```text
[✓] Domain boundary defined
[✓] Data ownership defined
[✓] API boundary defined
[✓] Event boundary defined
[✓] Tenant isolation enforced
[✓] Authorization enforced
[✓] Idempotency evaluated
[✓] Concurrency strategy defined
[✓] Timeout policy defined
[✓] Retry policy defined
[✓] Error taxonomy defined
[✓] Audit requirements defined
[✓] Logging implemented
[✓] Metrics implemented
[✓] Tracing implemented where applicable
[✓] Tests implemented
[✓] Failure paths tested
[✓] Operational runbook defined
[✓] Backup/recovery impact assessed
[✓] Security review completed
[✓] Migration strategy defined
[✓] Rollback strategy defined
[✓] Documentation updated
```

---

# 50. Final Architectural Rule

The TITech platform SHALL operate as one coherent financial system, not as a collection of unrelated feature modules.

The governing relationship is:

```text
Identity
   ↓
Tenant
   ↓
Business Workflow
   ↓
Authoritative Domain Service
   ↓
Financial Core
   ↓
Ledger
   ↓
Settlement / Reconciliation
   ↓
Compliance / Reporting
   ↓
Audit / Observability
```

Every new feature SHALL fit into this model.

Every financial mutation SHALL converge on the Financial Core.

Every external integration SHALL terminate at a controlled adapter boundary.

Every asynchronous workflow SHALL be idempotent and observable.

Every authoritative record SHALL have one clear owner.

Every production service SHALL have an explicit operational and security boundary.

This catalogue is the baseline architecture contract for future implementation, hardening, testing, and production readiness work.

---

**Document Owner:** TITech Community Capital LTD – Engineering / Architecture
**Canonical Location:** `docs/02-architecture/SERVICE_CATALOGUE.md`
**Review Requirement:** Update on material domain, service, API, event, data ownership, or financial architecture changes.