# TITech Community Capital Ltd

# Enterprise Event Catalogue

**Document:** `docs/02-architecture/EVENT_CATALOGUE.md`
**Status:** Production Event Architecture Baseline
**Audience:** Architecture, Backend Engineering, Finance Engineering, Payment Engineering, Compliance, Risk, Fraud, DevOps/SRE, QA, Operations, Internal Audit
**Owner:** Architecture / Platform Engineering
**Classification:** Internal / Confidential / Financial Integration
**Version:** 1.0.0
**Review Cadence:** At least annually and after any material event contract, financial workflow, integration, security, or tenant-isolation change

---

# 1. Purpose

This document defines the authoritative event architecture and event catalogue for TITech Community Capital.

It establishes the standards governing:

* domain events;
* integration events;
* financial events;
* payment events;
* settlement events;
* compliance events;
* risk and fraud events;
* workflow events;
* tenant lifecycle events;
* audit/security events;
* outbox events;
* event consumers;
* event versioning;
* event ordering;
* idempotency;
* replay;
* dead-letter processing;
* event security;
* tenant isolation;
* observability;
* event ownership;
* event retention.

The event architecture exists to decouple long-running and asynchronous workflows while preserving financial correctness, tenant isolation, auditability, and operational recoverability.

---

# 2. Governing Principle

The central rule is:

> **An event is a durable statement about something that has already happened in authoritative system state. Events must never be used as a substitute for authoritative state, and critical state changes must be persisted before their corresponding event is published.**

For financial operations:

```text
Authoritative Financial State
        ↓
Durable Outbox Event
        ↓
Publisher
        ↓
Consumers
```

Never:

```text
Publish Event
        ↓
Attempt Financial Write
```

---

# 3. Event Architecture Objectives

The event system MUST provide:

```text
Durability
At-Least-Once Delivery
Idempotent Consumption
Tenant Isolation
Ordering Where Required
Versioning
Replayability
Failure Recovery
Auditability
Observability
Security
Traceability
```

Exactly-once processing SHOULD NOT be assumed at the transport level.

Exactly-once business effect SHOULD be achieved through:

```text
Idempotency
+
Unique Constraints
+
State Preconditions
+
Durable Processing State
```

---

# 4. Event Architecture

```text
                              Domain Command
                                    │
                                    ▼
                            Application Service
                                    │
                                    ▼
                             Domain Operation
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
                    ▼                               ▼
             Authoritative State              Outbox Event
                    │                               │
                    └───────────────┬───────────────┘
                                    │
                                  COMMIT
                                    │
                                    ▼
                              Outbox Publisher
                                    │
                         ┌──────────┼──────────┐
                         │          │          │
                         ▼          ▼          ▼
                       Risk    Notification Reporting
                         │          │          │
                         └──────────┼──────────┘
                                    ▼
                               Consumers
```

---

# 5. Event Definitions

An **event** represents a fact.

Examples:

```text
loan.application.submitted
payment.succeeded
financial.transaction.posted
settlement.reconciled
tenant.suspended
kyc.verified
```

An event is NOT:

```text
"Please approve this loan"
```

That is a command.

The corresponding event is:

```text
loan.application.approved
```

---

# 6. Command vs Event

## Command

A command asks the system to perform an action.

```text
ApproveLoan
CreatePayment
ReverseTransaction
CloseFinancialPeriod
```

## Event

An event states that the action occurred.

```text
loan.application.approved
payment.created
financial.transaction.reversed
financial.period.locked
```

Commands are intent.

Events are facts.

---

# 7. Event Categories

The platform SHOULD distinguish:

```text
DOMAIN
INTEGRATION
FINANCIAL
PAYMENT
SETTLEMENT
COMPLIANCE
RISK
FRAUD
WORKFLOW
TENANT
BILLING
NOTIFICATION
SECURITY
AUDIT
OPERATIONAL
```

---

# 8. Event Ownership

Every event MUST have an authoritative producer.

Examples:

| Event Domain     | Producer              |
| ---------------- | --------------------- |
| `tenant.*`       | SaaS / Tenant Service |
| `member.*`       | Community Finance     |
| `savings.*`      | Savings Domain        |
| `loan.*`         | Lending               |
| `payment.*`      | Payments              |
| `financial.*`    | Financial Core        |
| `settlement.*`   | Settlement            |
| `compliance.*`   | Compliance            |
| `risk.*`         | Risk                  |
| `fraud.*`        | Fraud                 |
| `workflow.*`     | Workflow Engine       |
| `billing.*`      | Billing               |
| `notification.*` | Notification          |
| `security.*`     | Security              |
| `audit.*`        | Audit / Control Plane |

A consumer MUST NOT impersonate another domain's event namespace.

---

# 9. Event Naming Standard

Canonical format:

```text
<domain>.<aggregate>.<action>
```

Examples:

```text
tenant.created
tenant.suspended

member.created
member.updated

savings.account.opened
savings.contribution.posted

loan.application.submitted
loan.application.approved
loan.disbursement.completed

payment.created
payment.processing
payment.succeeded
payment.failed

financial.transaction.posted
financial.transaction.reversed

settlement.reconciled

compliance.kyc.verified

risk.assessment.completed

fraud.alert.created
```

Event names MUST be:

```text
stable
semantic
lowercase
dot-delimited
```

---

# 10. Event Naming Rules

Avoid:

```text
paymentDone
PAYMENT_SUCCESS
payment-success-v2-final
```

Prefer:

```text
payment.succeeded
```

The event name describes the business fact, not implementation details.

---

# 11. Event Identity

Every durable event MUST have a globally unique:

```text
eventId
```

Recommended:

```text
UUID / UUIDv4 / UUIDv7 / other collision-resistant identifier
```

An event ID MUST remain stable across retries and redelivery.

---

# 12. Aggregate Identity

Every domain event SHOULD identify:

```text
aggregateType
aggregateId
```

Example:

```json
{
  "aggregateType": "Loan",
  "aggregateId": "..."
}
```

This allows consumers to determine what business entity changed.

---

# 13. Tenant Identity

Every tenant-owned event MUST contain:

```text
tenantId
```

Global platform events MAY omit tenant context.

Example:

```text
platform.subscription_plan.updated
```

may be global.

While:

```text
loan.application.approved
```

MUST be tenant-aware.

---

# 14. Event Envelope

The canonical event envelope SHOULD be:

```json
{
  "eventId": "...",
  "eventType": "loan.application.approved",
  "eventVersion": 1,
  "schemaVersion": 1,
  "tenantId": "...",
  "aggregateType": "LoanApplication",
  "aggregateId": "...",
  "operationId": "...",
  "correlationId": "...",
  "causationId": "...",
  "producer": "lending-service",
  "occurredAt": "2026-08-15T19:00:00.000Z",
  "payload": {}
}
```

---

# 15. Event Envelope Fields

Required or strongly recommended:

```text
eventId
eventType
eventVersion
schemaVersion
aggregateType
aggregateId
occurredAt
producer
```

Required for tenant-aware events:

```text
tenantId
```

Recommended for distributed workflows:

```text
operationId
correlationId
causationId
```

---

# 16. eventVersion vs schemaVersion

These MUST be treated as distinct concepts.

`eventVersion` represents semantic evolution of the event.

`schemaVersion` represents the serialized payload structure.

Example:

```text
eventVersion = 2
schemaVersion = 3
```

The exact relationship MUST be documented per event family.

---

# 17. Causation ID

`causationId` identifies the event/command that directly caused the current event.

Example:

```text
payment.created
    ↓
payment.processing
    ↓
payment.succeeded
```

The event sequence can be traced through causation relationships.

---

# 18. Correlation ID

`correlationId` identifies the overall business workflow.

Example:

```text
API Request
→ Payment
→ Provider Callback
→ Ledger Posting
→ Settlement
```

All related events SHOULD share the same correlation ID.

---

# 19. Operation ID

`operationId` identifies a long-running business operation.

Examples:

```text
paymentOperationId
billingOperationId
workflowOperationId
settlementOperationId
```

An operation MAY produce multiple events.

---

# 20. Producer Identity

Every event SHOULD identify its producer.

Example:

```text
producer = "payment-service"
```

Producer identifiers MUST remain stable enough for operational attribution.

---

# 21. Event Time

`occurredAt` represents when the business event occurred.

It SHOULD NOT be confused with:

```text
createdAt
publishedAt
processedAt
```

These timestamps may differ.

---

# 22. Event Publication Time

The publisher MAY record:

```text
publishedAt
```

when the event was successfully delivered to the event transport.

---

# 23. Event Processing Time

Consumers SHOULD record:

```text
processedAt
```

when their processing completed.

---

# 24. Event Payload Rules

Payloads MUST be:

```text
minimal
explicit
versioned
validated
safe
deterministic
```

Avoid embedding the complete database document.

---

# 25. Event Payload Example

Preferred:

```json
{
  "loanId": "...",
  "memberId": "...",
  "approvedAmount": 1000000,
  "currency": "UGX",
  "approvalId": "..."
}
```

Avoid:

```json
{
  "_entireMongoDocument": "..."
}
```

Events should carry business facts, not storage implementation.

---

# 26. Sensitive Data Rule

Events MUST NOT contain unnecessary:

```text
passwords
access tokens
refresh tokens
provider secrets
private keys
encryption keys
raw authentication credentials
```

Sensitive personal or financial data MUST be minimized.

---

# 27. Event Immutability

Once published, an event MUST NOT be modified.

Correction is represented by another event.

Example:

```text
payment.succeeded
```

followed later by:

```text
payment.reversed
```

The original event remains part of history.

---

# 28. Event Durability

Critical events MUST be durably persisted before publication.

The preferred mechanism is the Outbox pattern.

```text
Business Transaction
      +
Outbox Event
      ↓
Atomic Commit
```

---

# 29. Outbox Event Model

Recommended fields:

```text
_id
eventId
tenantId
eventType
eventVersion
schemaVersion
aggregateType
aggregateId
operationId
correlationId
causationId
producer
payload
payloadHash
status
attempts
nextAttemptAt
publishedAt
lastError
createdAt
updatedAt
```

---

# 30. Outbox Lifecycle

```text
PENDING
   ↓
PUBLISHING
   ↓
PUBLISHED
```

Failure:

```text
PUBLISHING
   ↓
FAILED
   ↓
PENDING / RETRY_PENDING
```

Exhausted:

```text
FAILED
   ↓
DEAD_LETTERED
```

---

# 31. Outbox Transaction Boundary

For critical state changes:

```text
BEGIN
  update domain state
  create outbox event
COMMIT
```

The event MUST NOT be created after the transaction has already committed unless an explicit recovery design handles event loss.

---

# 32. At-Least-Once Delivery

The platform MUST assume event delivery is:

```text
AT_LEAST_ONCE
```

Therefore:

```text
same event
may be delivered
more than once
```

Consumers MUST be idempotent.

---

# 33. Exactly-Once Business Effect

The platform should strive for:

```text
Exactly Once Business Effect
```

through:

```text
eventId
+
consumer deduplication
+
unique constraints
+
state preconditions
+
idempotent side effects
```

Exactly-once network delivery MUST NOT be assumed.

---

# 34. Consumer Record

Consumers MAY maintain a durable processing record:

```text
consumerName
eventId
eventType
status
processedAt
attempts
lastError
```

Recommended unique key:

```text
consumerName + eventId
```

---

# 35. Consumer Lifecycle

```text
RECEIVED
   ↓
PROCESSING
   ↓
PROCESSED
```

Failure:

```text
PROCESSING
   ↓
FAILED
```

Retry:

```text
FAILED
   ↓
RETRY_PENDING
   ↓
PROCESSING
```

---

# 36. Idempotent Consumer Rule

A consumer MUST be safe when receiving:

```text
eventId = X
```

multiple times.

Example:

```text
loan.application.approved
```

must not create duplicate notifications, duplicate billing records, or duplicate financial effects.

---

# 37. Consumer State Validation

Consumers MUST load current authoritative state where needed.

An event is a fact, but it may be:

```text
late
duplicated
reordered
stale
```

The consumer must prevent stale events from corrupting current state.

---

# 38. Event Ordering

Events SHOULD contain sufficient metadata to establish ordering where required:

```text
aggregateVersion
sequence
occurredAt
```

Consumers SHOULD prefer aggregate version/sequence over timestamps where strict ordering matters.

---

# 39. Aggregate Version

For stateful aggregates, events SHOULD include:

```text
aggregateVersion
```

Example:

```text
LoanApplication version 8
```

An event carrying version 7 is stale if version 8 has already been processed.

---

# 40. Stale Event Rule

A stale event MUST NOT overwrite newer state.

Possible behavior:

```text
IGNORE + ACK
```

or:

```text
QUARANTINE
```

depending on the event's criticality.

Stale financial events SHOULD trigger stronger controls.

---

# 41. Event Replay

Replay is a controlled operational capability.

Replay MUST require:

```text
authorization
tenant context where applicable
event identity
reason
audit
```

Financial event replay MUST be idempotent.

---

# 42. Event Replay Principle

Replay should reproduce or reconcile business processing without creating duplicate financial effects.

The preferred pattern is:

```text
Historical Event
      ↓
Replay Validation
      ↓
Current State Check
      ↓
Idempotency Check
      ↓
Controlled Consumer Execution
```

---

# 43. Dead-Letter Architecture

Failed events that cannot be processed automatically SHOULD enter a dead-letter store/queue.

```text
Event
 ↓
Consumer
 ↓
Retry
 ↓
Retry Exhausted
 ↓
Dead Letter
 ↓
Investigation
 ↓
Repair / Replay
```

---

# 44. Dead-Letter Record

Recommended:

```text
deadLetterId
tenantId
eventId
eventType
aggregateId
operationId
attempts
failureCode
failureReason
lastAttemptAt
status
replayedAt
replayedBy
createdAt
updatedAt
```

---

# 45. Event Failure Classification

Failures SHOULD be classified:

```text
TRANSIENT
PERMANENT
AUTHORIZATION
VALIDATION
CONFLICT
CONCURRENCY
DEPENDENCY
FINANCIAL_INTEGRITY
UNKNOWN
```

Only retryable classes SHOULD be retried automatically.

---

# 46. Retry Policy

Retryable event processing SHOULD use:

```text
bounded retries
exponential backoff
jitter
maximum delay
observability
```

A consumer MUST NOT retry indefinitely without escalation.

---

# 47. Financial Event Retry Rule

Financial event processing must be particularly conservative.

If a financial event produces an unknown external outcome:

```text
DO NOT
blindly execute financial side effect again
```

Instead:

```text
verify state
+
reconcile
+
recover
```

---

# 48. Event Security

Events cross trust boundaries inside the platform.

Therefore consumers MUST validate:

```text
event origin
event type
schema
tenant
aggregate identity
event version
authorization context
```

where applicable.

---

# 49. Event Integrity

Critical event payloads SHOULD include:

```text
payloadHash
```

or equivalent integrity metadata.

Example:

```text
SHA-256(canonicalPayload)
```

---

# 50. Event Authenticity

When events cross service or infrastructure trust boundaries, the platform MAY require:

```text
signed events
message authentication
mTLS
service identity
```

Sensitive/high-risk events SHOULD have stronger integrity controls.

---

# 51. Tenant Event Isolation

Every tenant event MUST include:

```text
tenantId
```

unless the event is explicitly global.

Consumers MUST validate:

```text
event.tenantId
=
aggregate.tenantId
```

before applying tenant-owned changes.

---

# 52. Cross-Tenant Event Prohibition

A tenant-scoped event MUST NOT cause changes in another tenant's data.

Example invalid flow:

```text
Tenant A event
      ↓
Tenant B loan updated
```

This MUST be rejected.

---

# 53. Global Event Classification

Global events SHOULD use a recognizable namespace.

Examples:

```text
platform.subscription_plan.updated
platform.feature_flag.changed
platform.configuration.updated
```

Tenant events use tenant/domain context:

```text
tenant.created
loan.application.approved
payment.succeeded
```

---

# 54. Event Context Propagation

Events SHOULD carry:

```text
tenantId
requestId where relevant
correlationId
operationId
causationId
traceId where supported
```

This enables end-to-end observability.

---

# 55. Event Traceability

A payment workflow SHOULD be traceable as:

```text
payment.created
      ↓
payment.processing
      ↓
payment.succeeded
      ↓
financial.transaction.posted
      ↓
settlement.reconciled
```

A single correlation ID SHOULD connect the chain.

---

# 56. Domain Event Catalogue

The following sections define the canonical event families.

---

# 57. Tenant Events

## `tenant.created`

Meaning:

> A new tenant record was successfully created.

Producer:

```text
SaaS / Tenant Service
```

Typical payload:

```json
{
  "tenantId": "...",
  "tenantType": "...",
  "status": "PENDING",
  "country": "UG"
}
```

Consumers MAY include:

```text
Onboarding
Notifications
Provisioning
Audit
Analytics
```

---

## `tenant.onboarding.started`

Meaning:

> Tenant onboarding has begun.

---

## `tenant.onboarding.completed`

Meaning:

> Required onboarding workflow completed.

---

## `tenant.activated`

Meaning:

> Tenant is authorized to operate within its enabled capabilities.

---

## `tenant.suspended`

Meaning:

> Tenant access or selected capabilities have been restricted.

Consumers MAY:

```text
disable new transactions
restrict payments
notify administrators
update operational controls
```

---

## `tenant.reactivated`

Meaning:

> Tenant restrictions have been removed.

---

## `tenant.closed`

Meaning:

> Tenant has entered final operational closure.

This does not mean all historical data is deleted.

---

## `tenant.archived`

Meaning:

> Tenant data has entered controlled archival state.

---

# 58. Tenant Membership Events

## `tenant.membership.created`

A user was granted membership.

Payload:

```text
tenantId
membershipId
userId
roleIds
```

---

## `tenant.membership.updated`

Membership roles or attributes changed.

---

## `tenant.membership.revoked`

Membership access was revoked.

Security consumers SHOULD invalidate relevant sessions/permissions.

---

## `tenant.membership.suspended`

Membership is temporarily restricted.

---

# 59. User Security Events

## `user.registered`

User identity created.

## `user.authenticated`

Successful authentication.

## `user.authentication_failed`

Authentication attempt failed.

This SHOULD be treated as a security event rather than a broad business event where appropriate.

## `user.password_changed`

Password successfully changed.

## `user.password_reset`

Password reset workflow completed.

## `user.session.revoked`

Session/token access revoked.

## `user.mfa.enabled`

MFA enabled.

## `user.mfa.disabled`

MFA disabled.

Privileged MFA changes SHOULD trigger enhanced audit/security monitoring.

---

# 60. Group Events

## `group.created`

New community group created.

## `group.activated`

Group activated.

## `group.suspended`

Group suspended.

## `group.closed`

Group closed.

## `group.member.added`

Member joined group.

## `group.member.removed`

Membership ended.

---

# 61. Member Events

## `member.created`

Member created.

## `member.updated`

Non-financial member data updated.

Sensitive changes SHOULD additionally create audit/security evidence.

## `member.status_changed`

Member lifecycle/status changed.

## `member.kyc_required`

KYC workflow required.

---

# 62. Savings Events

## `savings.account.opened`

Savings account opened.

Payload SHOULD include:

```text
tenantId
accountId
memberId
groupId
productId
currency
```

---

## `savings.account.closed`

Savings account closed.

---

## `savings.contribution.initiated`

Contribution workflow began.

---

## `savings.contribution.processing`

Contribution is being processed.

---

## `savings.contribution.succeeded`

Contribution succeeded at the business/payment layer.

---

## `savings.contribution.posted`

Contribution accounting effect has been successfully posted.

This event SHOULD be emitted from/after the authoritative financial posting.

---

## `savings.contribution.failed`

Contribution failed without a successful financial effect.

---

## `savings.withdrawal.initiated`

Withdrawal requested.

---

## `savings.withdrawal.completed`

Withdrawal completed, including required financial processing.

---

## `savings.withdrawal.failed`

Withdrawal failed.

---

# 63. Savings Financial Event Rule

Do not use:

```text
savings.contribution.succeeded
```

as proof that the ledger is posted.

Use:

```text
savings.contribution.posted
```

for the accounting fact.

This distinction prevents reporting and downstream consumers from confusing operational success with financial finality.

---

# 64. Loan Application Events

## `loan.application.created`

Loan application created.

## `loan.application.submitted`

Application formally submitted.

## `loan.application.review_started`

Review process started.

## `loan.application.approved`

Application approved.

Payload SHOULD include:

```text
tenantId
applicationId
loanProductId
approvedAmount
currency
approvalId
```

---

## `loan.application.rejected`

Application rejected.

## `loan.application.cancelled`

Application cancelled.

---

# 65. Loan Events

## `loan.created`

Loan originated.

## `loan.disbursement.initiated`

Disbursement workflow started.

## `loan.disbursement.processing`

Disbursement is being executed.

## `loan.disbursement.succeeded`

Provider/payment execution succeeded.

## `loan.disbursement.posted`

Disbursement accounting effect successfully posted.

## `loan.disbursement.failed`

Disbursement failed.

---

# 66. Loan Lifecycle Events

## `loan.activated`

Loan entered active state.

## `loan.past_due`

Loan crossed configured delinquency threshold.

## `loan.restructured`

Loan was restructured.

## `loan.completed`

Loan fully completed.

## `loan.written_off`

Approved write-off was posted.

---

# 67. Repayment Events

## `loan.repayment.initiated`

Repayment workflow started.

## `loan.repayment.received`

Funds received/confirmed.

## `loan.repayment.allocated`

Repayment allocation calculated.

## `loan.repayment.posted`

Financial effect successfully posted.

## `loan.repayment.failed`

Repayment failed.

---

# 68. Risk Events

## `risk.assessment.requested`

Risk assessment initiated.

## `risk.assessment.processing`

Assessment being calculated.

## `risk.assessment.completed`

Assessment completed.

Payload SHOULD include:

```text
assessmentId
subjectId
score
grade
decision
scoringVersion
modelVersion
```

Sensitive feature-level inputs SHOULD NOT be included unless required.

---

# 69. Risk Model Events

## `risk.model.version_activated`

A new risk model version became active.

## `risk.model.deprecated`

A model version was deprecated.

Model changes SHOULD be audited.

---

# 70. Fraud Events

## `fraud.alert.created`

Fraud signal produced an alert.

## `fraud.alert.triaged`

Alert triage completed.

## `fraud.alert.escalated`

Alert escalated.

## `fraud.alert.confirmed`

Fraud confirmed.

## `fraud.alert.false_positive`

Alert determined not to be fraudulent.

## `fraud.alert.resolved`

Fraud investigation resolved.

---

# 71. Payment Events

Canonical payment events:

```text
payment.created
payment.processing
payment.succeeded
payment.failed
payment.cancelled
payment.expired
payment.unknown
payment.reconciliation_required
payment.refunded
payment.reversed
```

---

# 72. `payment.created`

A payment operation was accepted internally.

This is an operational event.

It does NOT imply payment success.

---

# 73. `payment.processing`

Payment has entered active provider/internal execution.

---

# 74. `payment.succeeded`

Provider/business outcome verified as successful.

Consumers SHOULD distinguish this from:

```text
financial.transaction.posted
```

---

# 75. `payment.failed`

Payment failed without a successful financial outcome.

---

# 76. `payment.cancelled`

Payment was explicitly cancelled before completion.

---

# 77. `payment.expired`

Payment exceeded its business validity window.

---

# 78. `payment.unknown`

The platform cannot safely determine the external outcome.

Consumers SHOULD NOT automatically treat this as a failure.

---

# 79. `payment.reconciliation_required`

Payment requires manual/controlled reconciliation.

This is a high-value operational signal.

---

# 80. `payment.refunded`

A refund operation was successfully completed.

The event SHOULD reference the original payment.

---

# 81. `payment.reversed`

Payment was successfully reversed.

Reversal MUST remain traceable to the original payment.

---

# 82. Payment Attempt Events

Optional events:

```text
payment.attempt.started
payment.attempt.succeeded
payment.attempt.failed
payment.attempt.timed_out
```

These are lower-level integration events and should not be confused with overall payment state.

---

# 83. Provider Transaction Events

## `payment.provider.submitted`

Provider request submitted.

## `payment.provider.pending`

Provider reports pending state.

## `payment.provider.succeeded`

Provider reports success.

## `payment.provider.failed`

Provider reports failure.

## `payment.provider.unknown`

Provider outcome cannot be determined.

Provider-specific normalized events MAY be retained internally, while domain consumers use provider-neutral payment events.

---

# 84. Callback Events

## `payment.callback.received`

Callback captured.

## `payment.callback.verified`

Signature/authenticity verified.

## `payment.callback.rejected`

Callback rejected.

## `payment.callback.replayed`

Duplicate callback safely recognized.

## `payment.callback.processed`

Callback successfully processed.

## `payment.callback.failed`

Callback processing failed.

---

# 85. Financial Events

Financial events represent authoritative accounting facts.

These events are among the highest-control events on the platform.

Canonical:

```text
financial.transaction.created
financial.transaction.validated
financial.transaction.posted
financial.transaction.failed
financial.transaction.reversed
financial.adjustment.created
financial.adjustment.posted
financial.period.soft_closed
financial.period.final_closed
financial.period.locked
```

---

# 86. `financial.transaction.created`

A financial operation record exists.

It does NOT mean financial effect has occurred.

---

# 87. `financial.transaction.validated`

All required accounting validations passed.

---

# 88. `financial.transaction.posted`

The authoritative ledger posting successfully committed.

Consumers may rely on this as proof of accounting state.

---

# 89. `financial.transaction.failed`

Financial transaction could not be posted.

No financial effect should be assumed.

---

# 90. `financial.transaction.reversed`

A previously posted transaction was successfully compensated by a reversal.

Payload SHOULD reference:

```text
originalTransactionId
reversalTransactionId
reasonCode
```

---

# 91. `financial.adjustment.created`

Controlled financial adjustment requested/created.

---

# 92. `financial.adjustment.posted`

Adjustment accounting effect successfully committed.

---

# 93. Financial Account Events

## `financial.account.created`

Ledger account created.

## `financial.account.activated`

Account enabled for posting.

## `financial.account.suspended`

Posting access restricted.

## `financial.account.closed`

Account closed according to accounting policy.

---

# 94. Financial Balance Events

Optional projection-oriented events:

```text
financial.balance.changed
financial.balance.snapshot_created
```

These events SHOULD be considered derived notifications unless specifically generated from authoritative posting state.

---

# 95. Financial Period Events

## `financial.period.opened`

Period became open.

## `financial.period.soft_closed`

Period entered soft-close.

## `financial.period.final_closed`

Period reached final close.

## `financial.period.locked`

Period entered locked state.

## `financial.period.reopened`

Controlled reopening occurred.

Reopening is a high-risk financial event and MUST be audited.

---

# 96. Reconciliation Events

Canonical:

```text
reconciliation.started
reconciliation.matched
reconciliation.partially_matched
reconciliation.exception_created
reconciliation.exception_resolved
reconciliation.completed
```

---

# 97. `reconciliation.exception_created`

An unresolved difference was detected.

Payload SHOULD include:

```text
tenantId
reconciliationId
exceptionCode
differenceAmount
currency
externalReference
internalReference
```

---

# 98. `reconciliation.exception_resolved`

Exception has been resolved through controlled action.

Consumers SHOULD retain the original exception context.

---

# 99. Settlement Events

Canonical:

```text
settlement.imported
settlement.validated
settlement.processing
settlement.reconciling
settlement.partially_reconciled
settlement.reconciled
settlement.finalized
settlement.failed
```

---

# 100. Statement Events

```text
statement.imported
statement.normalized
statement.validated
statement.processing
statement.reconciled
statement.failed
```

---

# 101. Statement Batch Events

```text
statement.batch.created
statement.batch.claimed
statement.batch.processing
statement.batch.completed
statement.batch.failed
statement.batch.released
statement.batch.expired
```

Worker processing consumers MUST use claim ownership.

---

# 102. Compliance Events

Canonical:

```text
compliance.kyc.case_created
compliance.kyc.verification_started
compliance.kyc.verified
compliance.kyc.rejected
compliance.kyc.expired

compliance.aml.case_created
compliance.aml.investigation_started
compliance.aml.escalated
compliance.aml.resolved

compliance.screening.started
compliance.screening.completed
compliance.screening.match_detected

compliance.regulatory.submission_created
compliance.regulatory.validated
compliance.regulatory.submitted
compliance.regulatory.accepted
compliance.regulatory.rejected
```

---

# 103. Billing Events

Canonical:

```text
billing.subscription.created
billing.subscription.activated
billing.subscription.renewal_due
billing.subscription.renewed
billing.subscription.cancelled

billing.invoice.created
billing.invoice.finalized
billing.invoice.paid
billing.invoice.failed

billing.operation.created
billing.operation.processing
billing.operation.completed
billing.operation.failed
```

Billing events MUST remain distinguishable from financial ledger events.

---

# 104. Workflow Events

Canonical:

```text
workflow.created
workflow.started
workflow.step.started
workflow.step.completed
workflow.step.failed
workflow.completed
workflow.failed
workflow.cancelled
workflow.timed_out
workflow.compensation_required
workflow.compensated
```

---

# 105. Workflow Event Rule

Workflow events describe orchestration state.

They do not automatically prove financial success.

Use:

```text
financial.transaction.posted
```

for authoritative financial posting.

---

# 106. Notification Events

```text
notification.created
notification.queued
notification.sending
notification.sent
notification.failed
notification.retrying
```

Notification failures MUST NOT normally reverse successful financial state.

---

# 107. Security Events

Security events may include:

```text
security.authentication_failed
security.authorization_denied
security.tenant_access_denied
security.privilege_changed
security.session_revoked
security.mfa_changed
security.secret_rotation_completed
security.suspicious_activity_detected
```

---

# 108. Audit Events

Audit events SHOULD capture security/control evidence:

```text
audit.created
audit.high_risk_action
audit.financial_action
audit.privileged_access
audit.cross_tenant_operation
```

Audit events MUST remain append-oriented.

---

# 109. Operational Events

Examples:

```text
operation.started
operation.completed
operation.failed
operation.timed_out
operation.reconciliation_required

provider.health_degraded
provider.health_restored

worker.claimed
worker.released
worker.failed

queue.depth_high
queue.recovered
```

---

# 110. Event Catalogue Summary

| Event Family | Examples                        | Primary Consumers                  |
| ------------ | ------------------------------- | ---------------------------------- |
| Tenant       | `tenant.activated`              | Provisioning, Audit, Notifications |
| Membership   | `tenant.membership.revoked`     | Security, Sessions                 |
| Member       | `member.created`                | KYC, Reporting                     |
| Savings      | `savings.contribution.posted`   | Ledger, Reporting                  |
| Loan         | `loan.application.approved`     | Disbursement, Notifications        |
| Risk         | `risk.assessment.completed`     | Lending, Fraud                     |
| Fraud        | `fraud.alert.created`           | Operations, Compliance             |
| Payment      | `payment.succeeded`             | Ledger, Settlement                 |
| Financial    | `financial.transaction.posted`  | Reporting, Settlement              |
| Settlement   | `settlement.reconciled`         | Finance, Reporting                 |
| Compliance   | `compliance.kyc.verified`       | Onboarding, Lending                |
| Billing      | `billing.invoice.paid`          | SaaS, Financial                    |
| Workflow     | `workflow.completed`            | Orchestration Consumers            |
| Notification | `notification.sent`             | Reporting                          |
| Security     | `security.authorization_denied` | SOC/Ops                            |
| Audit        | `audit.high_risk_action`        | Compliance/Internal Audit          |

---

# 111. Event Consumer Architecture

Consumers SHOULD follow:

```text
Receive
  ↓
Authenticate/Validate
  ↓
Tenant Check
  ↓
Schema Validation
  ↓
Deduplication
  ↓
Current State Check
  ↓
Business Processing
  ↓
Persist Result
  ↓
Record Consumer State
  ↓
Emit Follow-up Event if required
```

---

# 112. Consumer Authorization

Consumers MUST have only the permissions required to process their events.

Example:

```text
notification-worker
```

should not receive authority to post ledger transactions.

---

# 113. Consumer Isolation

A consumer processing:

```text
loan.application.approved
```

MUST NOT assume it can access unrelated tenant resources.

All reads remain tenant-scoped.

---

# 114. Consumer Side Effects

Consumers SHOULD make side effects idempotent.

Examples:

```text
notification creation
billing synchronization
report projection
risk projection
search indexing
```

---

# 115. Financial Event Consumer Rules

Consumers of:

```text
financial.transaction.posted
```

MUST treat the event as authoritative evidence that the financial posting exists.

They SHOULD NOT re-post the same transaction.

---

# 116. Financial Event Consumers

Potential consumers:

```text
Settlement
Reporting
Notifications
Risk
Fraud
Analytics
Compliance
Statements
```

They generally react to the financial fact rather than create another financial fact unless an explicit workflow requires it.

---

# 117. Event Chaining

Event chains SHOULD remain bounded and understandable.

Example:

```text
loan.application.approved
    ↓
loan.disbursement.initiated
    ↓
payment.created
    ↓
payment.succeeded
    ↓
financial.transaction.posted
    ↓
loan.disbursement.posted
    ↓
notification.created
```

---

# 118. Event Loop Prevention

The architecture MUST prevent event feedback loops.

Example prohibited cycle:

```text
A event
 ↓
B
 ↓
A event
 ↓
B
```

where each consumer emits an event that causes the original event repeatedly.

Use:

```text
event type discipline
causationId
state guards
consumer idempotency
```

---

# 119. Event Storm Prevention

High-volume events SHOULD be controlled through:

```text
batching
aggregation
debouncing
projection updates
rate limits
queue partitioning
```

Do not emit an event for every internal field change unless the business value justifies it.

---

# 120. Event Granularity

Prefer business facts:

```text
loan.repayment.posted
```

over implementation noise:

```text
loan.balance.field.1.updated
loan.balance.field.2.updated
```

---

# 121. Event Contract Stability

Once an event becomes stable and consumed externally, its semantics MUST remain backward compatible.

Breaking semantic changes require:

```text
new event version
or
new event type
```

---

# 122. Event Schema Evolution

Preferred approaches:

```text
add optional field
add new event version
support old consumers during migration
```

Avoid changing:

```text
field meaning
field type
requiredness
semantic interpretation
```

without versioning.

---

# 123. Event Deprecation

Deprecated events SHOULD have:

```text
deprecation notice
replacement
migration window
sunset date
consumer inventory
```

---

# 124. Event Contract Registry

The platform SHOULD maintain a machine-readable event contract registry where practical.

Each event definition should include:

```text
eventType
eventVersion
producer
schema
owner
classification
tenantScope
financialImpact
consumer list
retention
```

---

# 125. Event Ownership Matrix

Every production event MUST have:

```text
technical owner
domain owner
schema owner
operational owner
```

Unowned events are architectural debt.

---

# 126. Financial Event Classification

Financial events SHOULD be classified:

```text
FINANCIAL_AUTHORITATIVE
FINANCIAL_DERIVED
FINANCIAL_OPERATIONAL
```

Example:

```text
financial.transaction.posted
→ FINANCIAL_AUTHORITATIVE

financial.balance.changed
→ FINANCIAL_DERIVED

payment.processing
→ FINANCIAL_OPERATIONAL
```

---

# 127. Event Security Classification

Events SHOULD also carry data classification:

```text
PUBLIC
INTERNAL
CONFIDENTIAL
FINANCIAL
SENSITIVE
REGULATORY
SECURITY_SENSITIVE
```

---

# 128. Event Retention

Retention depends on event class.

Typical guidance:

```text
Financial events
→ Long-term / audit-aligned

Regulatory events
→ Regulatory retention

Security events
→ Security retention

Operational events
→ Shorter operational retention

Transient internal events
→ Short-lived where safe
```

Exact retention MUST follow applicable policy.

---

# 129. Event Archival

High-volume historic events MAY be archived.

Archived events MUST preserve:

```text
eventId
eventType
eventVersion
tenantId
aggregateId
occurredAt
payloadHash
archiveReference
```

---

# 130. Event Replay Safety

Before replay:

```text
[ ] Event exists.
[ ] Event is authentic.
[ ] Event belongs to intended tenant.
[ ] Schema version supported.
[ ] Consumer is authorized.
[ ] Current state is compatible.
[ ] Replay is idempotent.
[ ] Audit record created.
```

---

# 131. Financial Event Replay

Financial event replay MUST NOT simply call the original financial command again.

Preferred:

```text
Historic Event
      ↓
State Check
      ↓
Existing Transaction Check
      ↓
Idempotency Check
      ↓
Reconciliation / Projection
```

If a real corrective financial effect is needed, create a new controlled financial transaction.

---

# 132. Event Replay Authorization

Replay SHOULD require:

```text
event:replay
```

or equivalent privileged permission.

Financial replay SHOULD require stronger authorization.

---

# 133. Consumer Retry Policy

A consumer SHOULD distinguish:

```text
retryable
non-retryable
investigation-required
```

Example:

```text
Temporary Redis failure → retry
Schema validation failure → dead letter
Tenant mismatch → security/investigation
Duplicate event → acknowledge safely
```

---

# 134. Event Observability

Every event SHOULD be observable through:

```text
logs
metrics
traces
outbox state
consumer state
dead-letter state
```

---

# 135. Event Metrics

Recommended:

```text
events_published_total
events_failed_total
events_retried_total
events_dead_lettered_total
events_replayed_total

consumer_processing_total
consumer_processing_failures_total
consumer_duplicate_total
consumer_latency
consumer_lag

outbox_pending_total
outbox_publish_failures_total
outbox_oldest_age
```

---

# 136. Event Lag

Monitor:

```text
event occurredAt
vs
consumer processedAt
```

The difference identifies consumer lag.

Critical financial consumers SHOULD have defined operational latency targets.

---

# 137. Outbox Health Metrics

Monitor:

```text
pending outbox count
oldest pending event age
publish failure rate
retry count
dead-letter count
```

An increasing outbox backlog indicates downstream delivery degradation.

---

# 138. Consumer Lag Monitoring

For each important consumer monitor:

```text
lag
throughput
error rate
retry rate
dead letters
```

---

# 139. Event Tracing

Events SHOULD carry tracing context where supported.

Potential metadata:

```text
traceId
spanId
correlationId
causationId
```

Do not include secrets in trace baggage.

---

# 140. Event Logging

Structured event logs SHOULD include:

```text
eventId
eventType
tenantId
aggregateType
aggregateId
operationId
correlationId
producer
result
```

Payload logging MUST be minimized.

---

# 141. Event Security Logging

Security-sensitive events SHOULD log:

```text
actor
tenant
eventType
result
source
correlationId
```

Sensitive payload content SHOULD remain outside general logs.

---

# 142. Event Transport

The architecture may use:

```text
queue
message broker
event bus
BullMQ
Redis Streams
Kafka
RabbitMQ
cloud messaging service
```

depending on deployment needs.

The transport is replaceable.

The domain event contract is not.

---

# 143. Transport Abstraction

Domain services SHOULD publish through an abstraction:

```text
EventPublisher
```

rather than directly depending on one broker.

Example:

```text
Domain
 ↓
EventPublisher
 ↓
Outbox
 ↓
Transport Adapter
```

---

# 144. Queue Infrastructure Optionality

If a queue dependency is temporarily unavailable:

```text
critical durable event
```

must remain in the outbox.

The event MUST NOT be silently discarded.

---

# 145. Event Publisher Responsibilities

Publisher SHOULD:

```text
load pending event
validate status
publish
record attempt
record publishedAt
handle failure
retry
dead-letter if exhausted
```

Publisher MUST NOT modify business state beyond event-delivery metadata.

---

# 146. Event Consumer Responsibilities

Consumer SHOULD:

```text
validate
deduplicate
load authoritative state
apply side effect
persist result
emit downstream events when necessary
```

---

# 147. Event Consumer Anti-Patterns

Avoid:

```text
trust event payload as current state
update records without tenant check
ignore event duplication
perform non-idempotent side effects
publish before local state commit
```

---

# 148. Event Ordering Strategy

For events requiring strict order, use:

```text
aggregateId
+
sequence/version
```

and ensure the transport supports ordering semantics or consumers compensate for reordering.

---

# 149. Event Partitioning

Where supported, partition by:

```text
aggregateId
```

to preserve ordering within a business aggregate.

For tenant fairness, broader partitioning strategies may combine:

```text
tenantId
+
aggregateId
```

depending on the broker.

---

# 150. Event Backpressure

Consumers MUST be protected from overload.

Use:

```text
bounded concurrency
queue limits
consumer autoscaling
backoff
batching
```

---

# 151. Event Storm Backpressure

If a producer generates excessive events:

```text
detect
→ throttle
→ aggregate
→ backpressure
→ alert
```

Do not allow uncontrolled event volume to exhaust shared infrastructure.

---

# 152. Tenant Event Quotas

High-volume tenants MAY have event-related quotas:

```text
events/sec
queue depth
consumer concurrency
```

These controls protect the shared platform.

---

# 153. Event Data Privacy

Events SHOULD contain only the minimum data required by consumers.

Prefer:

```text
memberId
```

over embedding:

```text
full member profile
identity document
address
```

unless explicitly necessary.

---

# 154. Financial Event Privacy

Financial events may contain:

```text
amount
currency
accountId
transactionId
```

Access MUST be restricted.

Do not publish complete financial statements into broad event topics.

---

# 155. Compliance Event Privacy

KYC/AML events SHOULD minimize personal and investigative details.

For example:

```text
compliance.kyc.verified
```

may contain:

```text
caseId
subjectId
verificationType
status
```

rather than raw identity documents.

---

# 156. Security Event Privacy

Security events must avoid exposing:

```text
passwords
tokens
secret material
```

Even privileged monitoring systems should receive only necessary context.

---

# 157. Event Auditability

Critical events MUST allow investigators to reconstruct:

```text
what happened
when
for which tenant
to which aggregate
because of which operation
caused by which event/command
produced by which service
```

---

# 158. Event Causality Graph

The platform SHOULD be able to reconstruct:

```text
Command
   ↓
Event A
   ↓
Event B
   ↓
Event C
```

using:

```text
causationId
correlationId
operationId
```

---

# 159. Financial Causality Example

```text
Payment Request
      ↓
payment.created
      ↓
payment.succeeded
      ↓
financial.transaction.posted
      ↓
settlement.reconciled
```

The chain SHOULD remain traceable.

---

# 160. Event Consistency Model

Events generally provide:

```text
EVENTUAL CONSISTENCY
```

while the authoritative financial transaction requires:

```text
STRONG TRANSACTIONAL CONSISTENCY
```

The architecture MUST clearly distinguish the two.

---

# 161. Eventual Consistency Rule

It is acceptable for:

```text
financial.transaction.posted
```

to be committed before:

```text
reporting projection updated
```

provided the event is durable and the projection is recoverable.

---

# 162. Financial Consistency Rule

It is not acceptable for:

```text
report says posted
```

when:

```text
ledger transaction does not exist
```

Reporting projections must not outrun authoritative financial state.

---

# 163. Event-Based Reporting

Reporting consumers SHOULD process:

```text
financial.transaction.posted
financial.transaction.reversed
```

to update projections.

A failed projection should enter retry/recovery.

---

# 164. Event-Based Notifications

Notification consumers MAY process:

```text
loan.application.approved
payment.succeeded
financial.transaction.posted
```

Notification failure does not change the originating financial state.

---

# 165. Event-Based Fraud

Fraud consumers MAY react to:

```text
payment.created
payment.succeeded
financial.transaction.posted
```

and create:

```text
fraud.alert.created
```

Fraud analysis SHOULD NOT mutate financial state directly.

---

# 166. Event-Based Risk

Risk systems MAY consume:

```text
loan.application.submitted
loan.repayment.posted
loan.completed
```

to update risk intelligence.

Risk output remains advisory/control data unless explicit business rules govern automated blocking.

---

# 167. Event-Based Compliance

Compliance systems MAY consume:

```text
member.created
loan.application.submitted
payment.succeeded
financial.transaction.posted
```

for:

```text
KYC triggers
AML monitoring
regulatory reporting
```

---

# 168. Event-Based Billing

Billing may consume:

```text
tenant.activated
billing.invoice.created
billing.invoice.paid
tenant.suspended
```

The event relationship between billing and ledger must remain explicit.

---

# 169. Event-Based Tenant Lifecycle

Tenant events may trigger:

```text
tenant.activated
→ provision features
→ initialize monitoring
→ enable workflows
```

and:

```text
tenant.suspended
→ disable new operations
→ notify operators
```

---

# 170. Event-Based Session Revocation

```text
tenant.membership.revoked
```

may cause:

```text
security.session_revoked
```

or direct session invalidation.

This is a security-critical event chain.

---

# 171. Event-Based Provider Health

Provider health events:

```text
provider.health_degraded
provider.health_restored
```

may influence:

```text
circuit breaker
routing
retry strategy
operational alerts
```

They MUST NOT silently change financial transaction state.

---

# 172. Event-Based Settlement

```text
payment.succeeded
```

may trigger:

```text
settlement.pending
```

or a settlement workflow.

The settlement process remains independent and reconciliatory.

---

# 173. Event-Based Reversal

```text
financial.transaction.reversed
```

may trigger:

```text
account projection update
report projection update
notification
audit
fraud monitoring
```

Consumers MUST not reverse another transaction merely because a reversal event was received.

---

# 174. Event-Based Period Close

```text
financial.period.locked
```

may trigger:

```text
report generation
snapshot generation
compliance reporting
notification
```

Consumers MUST not modify the locked financial period.

---

# 175. Event-Based Regulatory Submission

```text
compliance.regulatory.submitted
```

may trigger:

```text
submission monitoring
audit
notification
regulatory status polling
```

The final regulatory outcome remains authoritative in the compliance subsystem.

---

# 176. Event-Based Audit

High-risk domain events SHOULD generate audit records.

Example:

```text
financial.transaction.reversed
      ↓
audit.financial_action
```

Audit generation SHOULD be durable.

---

# 177. Event and Audit Relationship

Audit records and domain events are distinct.

```text
Domain Event
→ describes business fact

Audit Event
→ records control/accountability evidence
```

They may both exist for the same operation.

---

# 178. Event and Notification Relationship

A notification is an effect of an event.

Example:

```text
loan.application.approved
      ↓
notification.created
```

Notification status does not redefine loan state.

---

# 179. Event and Workflow Relationship

A workflow may consume events and create new commands/events.

Example:

```text
loan.application.approved
      ↓
Workflow
      ↓
loan.disbursement.initiated
```

The workflow remains responsible for orchestration state.

---

# 180. Event and State-Machine Relationship

Events are transition inputs or outputs.

Example:

```text
PROCESSING
   +
provider.success
   ↓
SUCCEEDED
```

State machines remain authoritative for valid transitions.

---

# 181. Event and Data Model Relationship

Events MUST reference stable aggregate identities rather than requiring consumers to know MongoDB implementation details.

Example:

```text
loanId
```

is preferable to exposing internal collection-specific structures.

---

# 182. Event and API Relationship

APIs may produce events.

But APIs MUST respond based on authoritative state, not merely event publication.

Example:

```text
POST /payments
```

may return:

```text
202 PROCESSING
```

while the event is later:

```text
payment.succeeded
```

---

# 183. Event Catalogue Production Gate

An event is production-ready only when:

```text
[ ] Event name defined
[ ] Producer defined
[ ] Domain owner defined
[ ] Schema defined
[ ] Version defined
[ ] Tenant scope defined
[ ] Data classification defined
[ ] Aggregate identity defined
[ ] Event identity defined
[ ] Idempotency behavior defined
[ ] Consumer list defined
[ ] Ordering requirements defined
[ ] Retry policy defined
[ ] Dead-letter behavior defined
[ ] Replay behavior defined
[ ] Security controls defined
[ ] Retention defined
[ ] Observability defined
[ ] Contract tests implemented
```

Financial events additionally require:

```text
[ ] Ledger relationship defined
[ ] Posting semantics defined
[ ] Reversal semantics defined
[ ] Reconciliation semantics defined
[ ] Financial auditability defined
```

---

# 184. Event Contract Template

Every new event SHOULD document:

```text
### <event.type>

Owner:
Producer:

Purpose:
Business meaning:

Tenant Scope:
GLOBAL / TENANT

Event Version:
1

Schema Version:
1

Aggregate:
<type>

Payload:
{ ... }

Required Fields:
...

Consumers:
...

Ordering:
...

Idempotency:
...

Retry:
...

Dead Letter:
...

Replay:
...

Financial Impact:
NONE / DERIVED / AUTHORITATIVE

Security Classification:
...

Retention:
...

Audit:
...

Observability:
...
```

---

# 185. Event Naming Governance

New event names MUST be reviewed for:

```text
semantic clarity
namespace ownership
duplicate meaning
future extensibility
backward compatibility
consumer expectations
```

Avoid creating:

```text
loan.approved
loan.application.approved
loanApproval.completed
```

for the same semantic fact.

Choose one canonical meaning.

---

# 186. Event Namespace Governance

Recommended top-level namespaces:

```text
tenant
member
group
savings
loan
payment
financial
settlement
compliance
risk
fraud
billing
workflow
notification
security
audit
platform
operation
```

---

# 187. Event Catalogue Ownership

Architecture SHOULD maintain one authoritative event catalogue.

Code-level event names MUST be reconciled with this document.

Unknown production event types indicate documentation drift.

---

# 188. Event Contract Testing

Each event SHOULD have automated contract tests verifying:

```text
eventType
schema
required fields
tenant behavior
version
producer
payload safety
```

---

# 189. Producer Contract Testing

Producers MUST guarantee:

```text
valid event schema
correct tenantId
correct aggregateId
correct eventType
stable eventId
correct eventVersion
```

---

# 190. Consumer Contract Testing

Consumers SHOULD verify:

```text
known event versions
unknown/additive field tolerance
duplicate behavior
stale event behavior
tenant isolation
failure handling
```

---

# 191. Event Security Testing

Security tests SHOULD include:

```text
event spoofing
tenant mismatch
schema injection
duplicate delivery
replay
stale event
unauthorized consumer
sensitive payload leakage
```

---

# 192. Event Performance Testing

Production-scale tests SHOULD include:

```text
high event volume
consumer backlog
provider burst traffic
tenant noisy-neighbor load
event replay
dead-letter storms
```

---

# 193. Event Failure Testing

Chaos/failure tests SHOULD simulate:

```text
database unavailable
outbox unavailable
queue unavailable
consumer crash
network timeout
duplicate events
out-of-order events
provider outage
```

The system must preserve authoritative state and recover.

---

# 194. Event Disaster Recovery

After event infrastructure recovery, validate:

```text
outbox pending events
publisher state
consumer offsets/state
consumer deduplication records
dead letters
event ordering
financial downstream projections
```

---

# 195. Event Backup

Critical durable event data SHOULD be backed up or recoverable through:

```text
outbox records
event store
durable broker retention
archival storage
```

The recovery strategy MUST be explicit.

---

# 196. Event Archival Integrity

Archived events SHOULD have:

```text
eventId
contentHash
archiveReference
tenantId
eventType
occurredAt
```

to support verification.

---

# 197. Event Data Retention Categories

Suggested:

```text
AUTHORITATIVE_FINANCIAL
AUTHORITATIVE_COMPLIANCE
SECURITY
OPERATIONAL
TRANSIENT
```

Each category requires an explicit retention policy.

---

# 198. Event Data Classification Matrix

| Event Class      | Sensitivity | Typical Retention     |
| ---------------- | ----------- | --------------------- |
| Financial        | High        | Long-term             |
| Compliance       | Critical    | Regulatory            |
| Security         | High        | Security policy       |
| Tenant Lifecycle | Medium/High | Long-term operational |
| Payment          | Critical    | Long-term/financial   |
| Notification     | Low/Medium  | Operational           |
| Analytics        | Variable    | Policy-based          |
| Transient Worker | Low/Medium  | Short-term            |

---

# 199. Event Non-Negotiable Rules

The following are prohibited:

```text
1. Publishing critical events before authoritative state exists.
2. Dropping an event because a consumer is unavailable.
3. Assuming exactly-once delivery.
4. Allowing duplicate delivery to create duplicate financial effects.
5. Mutating published historical events.
6. Ignoring tenant boundaries.
7. Emitting secrets in event payloads.
8. Allowing unrestricted replay.
9. Replaying financial events as blind commands.
10. Allowing stale events to overwrite current state.
11. Creating uncontrolled event loops.
12. Treating queue delivery as proof of business completion.
13. Treating event publication as proof of financial posting.
14. Allowing consumers unrestricted database access.
15. Creating undocumented production event types.
```

---

# 200. Canonical Financial Event Flow

```text
Financial Command
      ↓
Validation
      ↓
Ledger Posting
      ↓
Atomic Commit
      ├── Financial State
      ├── Audit Evidence
      └── Outbox Event
              │
              ▼
     financial.transaction.posted
              │
      ┌───────┼────────┬─────────┐
      ▼       ▼        ▼         ▼
 Reporting Settlement Risk   Notification
```

---

# 201. Canonical Payment Event Flow

```text
Payment Request
      ↓
payment.created
      ↓
payment.processing
      ↓
Provider
      ↓
Callback / Status
      ↓
payment.succeeded
      ↓
Financial Posting
      ↓
financial.transaction.posted
      ↓
Settlement / Reporting / Notification
```

---

# 202. Canonical Failure Flow

```text
Event Published
      ↓
Consumer Failure
      ↓
Retry
      ↓
Retry Exhausted
      ↓
Dead Letter
      ↓
Investigation
      ↓
Repair
      ↓
Replay
      ↓
Processed
```

---

# 203. Canonical Unknown Outcome Flow

```text
Provider Operation
      ↓
Timeout
      ↓
payment.unknown
      ↓
Reconciliation
      ├── Success Confirmed
      │       ↓
      │ payment.succeeded
      │
      ├── Failure Confirmed
      │       ↓
      │ payment.failed
      │
      └── Unresolved
              ↓
      payment.reconciliation_required
```

---

# 204. Canonical Tenant Event Flow

```text
Tenant Operation
      ↓
Tenant-Scoped State
      ↓
OutboxEvent
      ├── tenantId
      ├── aggregateId
      └── operationId
      ↓
Publisher
      ↓
Consumer
      ↓
Tenant Validation
      ↓
Projection / Action
```

---

# 205. Canonical Audit Event Flow

```text
High-Risk Operation
      ↓
Authoritative State Change
      ↓
Domain Event
      +
Audit Evidence
      ↓
Security / Compliance / Monitoring
```

---

# 206. Canonical Event Dependency Graph

```text
                    ┌──────────────────────┐
                    │    Domain Command    │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Authoritative State  │
                    └──────────┬───────────┘
                               │
                               ▼
                         ┌───────────┐
                         │  Outbox   │
                         └─────┬─────┘
                               │
                               ▼
                         ┌───────────┐
                         │ Publisher │
                         └─────┬─────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
         ▼                     ▼                     ▼
      Consumer A            Consumer B            Consumer C
         │                     │                     │
         ▼                     ▼                     ▼
     Projection            Workflow             Notification
         │                     │                     │
         └─────────────────────┼─────────────────────┘
                               ▼
                         Follow-up Events
```

---

# 207. Event Architecture Invariants

The following are mandatory:

```text
1. Events represent facts.
2. Commands represent intent.
3. Authoritative state is persisted before critical events are published.
4. Critical events use durable outbox semantics.
5. Event IDs are unique and stable.
6. Consumers are idempotent.
7. Tenant events are tenant-scoped.
8. Published events are immutable.
9. Event contracts are versioned.
10. Stale events cannot overwrite newer state.
11. Replay is controlled.
12. Dead-lettered events remain recoverable.
13. Critical financial events are traceable to ledger state.
14. Events never contain unnecessary secrets.
15. Event transport is replaceable; event semantics remain stable.
16. Event failures are observable.
17. Event consumers use least privilege.
18. Cross-tenant event processing is prohibited by default.
19. Event loops are explicitly prevented.
20. New production event types require architecture ownership and documentation.
```

---

# 208. Final Enterprise Event Principle

The TITech Community Capital event platform is a **durable integration and workflow backbone**, not a replacement for authoritative business or financial state.

Its governing rule is:

> **Persist the truth first, record the event durably with that truth, publish safely, consume idempotently, preserve tenant and security boundaries, tolerate duplicates and delays, recover through retries and dead-letter workflows, and use explicit reconciliation whenever external state is uncertain.**

For financial operations specifically:

> **A financial event may describe a posting, but only the authoritative Financial Core determines whether the financial effect actually exists.**

---

# 209. Related Architecture Documents

This Event Catalogue MUST remain aligned with:

```text
docs/02-architecture/ARCHITECTURE_MAP.md
docs/02-architecture/DATA_MODEL_CATALOGUE.md
docs/02-architecture/SECURITY_MODEL.md
docs/02-architecture/MULTI_TENANT_ARCHITECTURE.md
docs/02-architecture/SERVICE_CATALOGUE.md
docs/02-architecture/API_CATALOGUE.md
docs/02-architecture/FINANCIAL_LEDGER_SPECIFICATION.md
docs/02-architecture/TRANSACTION_STATE_MACHINE.md
```

Implementation areas SHOULD remain aligned with:

```text
backend/modules/
backend/modules/finance/
backend/modules/payment/
backend/modules/settlement/
backend/modules/compliance/
backend/modules/risk/
backend/modules/fraud/
backend/shared/
backend/services/
backend/jobs/
```

Any change to:

```text
event type
event semantics
event schema
event version
tenant scope
financial meaning
producer
consumer contract
replay behavior
retention
```

MUST trigger corresponding architecture, data-model, security, transaction-state, and service documentation updates.

---

**End of Event Catalogue**