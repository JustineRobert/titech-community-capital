# TITech Community Capital Ltd

# Enterprise Transaction State Machine

**Document:** `docs/02-architecture/TRANSACTION_STATE_MACHINE.md`
**Status:** Production Transaction-Control Baseline
**Audience:** Architecture, Backend Engineering, Finance Engineering, Payment Engineering, Compliance, Risk, DevOps/SRE, QA, Operations, Internal Audit
**Owner:** Architecture / Finance Engineering / Platform Engineering
**Classification:** Internal / Confidential / Financial Control
**Version:** 1.0.0
**Review Cadence:** At least annually and after any material transaction lifecycle or financial-control change

---

# 1. Purpose

This document defines the authoritative state-machine architecture for transaction processing across the TITech Community Capital platform.

It establishes the lifecycle rules for:

* financial transactions;
* payment operations;
* provider callbacks;
* settlement operations;
* billing operations;
* workflow operations;
* statement-processing operations;
* loan financial operations;
* reversals;
* adjustments;
* background execution;
* retries;
* failure recovery;
* compensation;
* reconciliation;
* concurrency control;
* idempotency;
* terminal states.

The purpose of a state machine is to ensure that critical operations move through **explicit, valid, auditable, deterministic states** rather than arbitrary status changes.

---

# 2. Governing Principle

The central rule is:

> **A production transaction may move only through an explicitly permitted state transition, under the correct tenant and authorization context, with concurrency protection, idempotency, auditability, and deterministic failure handling.**

A transaction MUST NOT become successful merely because:

* a request reached the application;
* a provider API returned a transport-level success;
* a callback was received;
* a worker finished;
* a database update succeeded partially.

The state machine represents **business truth**, not merely transport activity.

---

# 3. State Machine Objectives

The transaction state architecture MUST provide:

```text
Explicit lifecycle
Deterministic transitions
Idempotent retries
Concurrency protection
Failure isolation
Recovery
Compensation
Auditability
Tenant isolation
Financial integrity
Operational observability
```

---

# 4. State Machine Design Principles

## 4.1 Explicit States

Every critical operation MUST use a controlled state enumeration.

Do not permit arbitrary strings such as:

```text
"done"
"success"
"finished"
"working"
```

when the canonical state machine defines:

```text
COMPLETED
PROCESSING
```

---

## 4.2 Explicit Transitions

The application MUST define:

```text
currentState
+
command/event
→
nextState
```

Invalid transitions MUST be rejected.

---

## 4.3 No Generic Status Mutation

The following pattern is prohibited for critical transactions:

```text
transaction.status = req.body.status
save()
```

Instead:

```text
transition(
  currentState,
  command,
  context
)
```

MUST validate the transition.

---

## 4.4 State Is Not the Same as Event

A state is:

> the current business position of an operation.

An event is:

> something that happened and may cause a state transition.

Example:

```text
Event:
PAYMENT_CONFIRMED

Current State:
PROCESSING

Next State:
SUCCEEDED
```

---

# 5. Canonical Transaction Concepts

The platform distinguishes:

```text
Business Operation
Payment Operation
Financial Transaction
Provider Transaction
Workflow Operation
Job / Processing Operation
```

These are related but not interchangeable.

---

# 6. Business Operation

A business operation represents an intent such as:

```text
save money
withdraw money
disburse loan
repay loan
pay subscription
refund payment
settle provider funds
reverse transaction
```

It may result in one or more operational and financial records.

---

# 7. Payment Operation

Represents the lifecycle of an external/internal payment command.

Example:

```text
INITIATED
→ PROCESSING
→ SUCCEEDED
```

Payment operations may later result in:

```text
FINANCIAL POSTING
SETTLEMENT
```

---

# 8. Financial Transaction

A financial transaction represents the authoritative accounting operation.

Canonical financial lifecycle:

```text
CREATED
→ VALIDATED
→ POSTED
```

Possible terminal branches:

```text
FAILED
REVERSED
```

---

# 9. Provider Transaction

Represents an external payment-provider-side operation.

Example:

```text
SUBMITTED
→ PENDING
→ SUCCESS
```

or:

```text
SUBMITTED
→ FAILED
```

Provider state MUST NOT be treated as authoritative without verification and normalization.

---

# 10. Workflow Operation

Represents a long-running business process.

Example:

```text
PENDING
→ RUNNING
→ COMPLETED
```

with:

```text
FAILED
CANCELLED
TIMED_OUT
```

Workflow state MUST be persisted for recovery.

---

# 11. Processing Job

Represents background execution.

Example:

```text
PENDING
→ CLAIMED
→ PROCESSING
→ COMPLETED
```

or:

```text
PROCESSING
→ FAILED
```

or:

```text
PROCESSING
→ RELEASED
```

---

# 12. State Machine Vocabulary

Canonical lifecycle terms:

```text
CREATED
PENDING
VALIDATING
VALIDATED
INITIATED
PROCESSING
SUBMITTED
AUTHORIZED
APPROVED
SUCCEEDED
COMPLETED
FAILED
REJECTED
CANCELLED
EXPIRED
TIMED_OUT
RELEASED
REVERSED
PARTIALLY_COMPLETED
UNKNOWN
RECONCILIATION_REQUIRED
```

Not every state applies to every domain.

Each model MUST define its allowed subset.

---

# 13. State Categories

States SHOULD be classified as:

```text
Non-terminal
Terminal Success
Terminal Failure
Terminal Cancellation
Recovery / Investigation
```

Example:

```text
Non-terminal:
PENDING
PROCESSING
UNKNOWN

Success:
SUCCEEDED
COMPLETED

Failure:
FAILED
REJECTED

Cancellation:
CANCELLED
EXPIRED

Investigation:
RECONCILIATION_REQUIRED
```

---

# 14. Terminal State Principle

A terminal state means:

> automated transition to ordinary processing is complete.

Examples:

```text
COMPLETED
FAILED
REJECTED
CANCELLED
REVERSED
```

A terminal state MUST NOT automatically change to another state unless an explicit recovery operation exists.

---

# 15. Immutable State History

Critical workflows SHOULD preserve state-transition history.

Recommended transition record:

```text
_id
tenantId
aggregateType
aggregateId
fromState
toState
transition
actorType
actorId
reason
operationId
correlationId
requestId
timestamp
metadata
```

Current state is optimized for lookup.

Transition history provides the audit trail.

---

# 16. Canonical Transition Model

Every transition SHOULD follow:

```text
Current State
      ↓
Command / Event
      ↓
Transition Validator
      ↓
Authorization
      ↓
Business Preconditions
      ↓
Concurrency Check
      ↓
Idempotency Check
      ↓
Persist New State
      ↓
Record Transition
      ↓
Audit / Event
```

---

# 17. Transition Preconditions

Before moving state, validate:

```text
tenant
authorization
current state
expected version
operation identity
business rules
required references
financial state
external evidence where required
```

---

# 18. Concurrency Requirement

Transitions MUST be concurrency-safe.

Example:

```text
PROCESSING
```

may only transition to:

```text
COMPLETED
```

if the worker still owns the operation.

A stale worker MUST NOT transition:

```text
FAILED
→
COMPLETED
```

after another worker has already taken ownership or completed the operation.

---

# 19. Optimistic Concurrency

Where versioning is used:

```text
stateVersion
```

MUST be checked during transition.

Example:

```text
Expected:
version = 4

Actual:
version = 5
```

Result:

```text
CONCURRENCY_CONFLICT
```

The stale operation MUST stop.

---

# 20. Idempotent Transition Principle

Repeated commands MUST produce deterministic results.

Example:

```text
POST_COMPLETE
```

received twice:

```text
First:
PROCESSING → COMPLETED

Second:
COMPLETED → COMPLETED
```

may safely return the existing result rather than failing unpredictably, provided the command is semantically identical.

A semantically different duplicate MUST be rejected.

---

# 21. Canonical Financial Transaction State Machine

```text
                    ┌──────────────┐
                    │   CREATED    │
                    └──────┬───────┘
                           │ validate
                           ▼
                    ┌──────────────┐
                    │  VALIDATED   │
                    └──────┬───────┘
                           │ post
                           ▼
                    ┌──────────────┐
                    │    POSTED    │
                    └──────┬───────┘
                           │ reverse
                           ▼
                    ┌──────────────┐
                    │   REVERSED   │
                    └──────────────┘

CREATED / VALIDATED
       │
       └── fail ──→ FAILED
```

---

# 22. Financial Transaction States

## CREATED

The financial operation has been recorded but has not passed all validations.

Allowed transitions:

```text
CREATED → VALIDATED
CREATED → FAILED
```

---

## VALIDATED

All required accounting and business validations have passed.

Allowed transitions:

```text
VALIDATED → POSTED
VALIDATED → FAILED
```

---

## POSTED

The transaction has been committed to the ledger.

Terminal for ordinary processing.

Allowed explicit recovery:

```text
POSTED → REVERSED
```

---

## FAILED

The transaction could not be posted.

Terminal for the original attempt.

A recovery workflow MUST use a new controlled operation rather than silently changing the existing financial meaning.

---

## REVERSED

The original posted transaction has been financially compensated.

Terminal for the original transaction.

---

# 23. Financial Transaction Transition Table

| Current   | Command/Event | Next           |                Allowed |
| --------- | ------------- | -------------- | ---------------------: |
| CREATED   | VALIDATE      | VALIDATED      |                    Yes |
| CREATED   | FAIL          | FAILED         |                    Yes |
| CREATED   | POST          | CREATED→POSTED |                     No |
| VALIDATED | POST          | POSTED         |                    Yes |
| VALIDATED | FAIL          | FAILED         |                    Yes |
| VALIDATED | CANCEL        | CANCELLED      | Only if policy permits |
| POSTED    | REVERSE       | REVERSED       |                    Yes |
| POSTED    | POST          | POSTED         |                     No |
| POSTED    | UPDATE_AMOUNT | —              |                     No |
| POSTED    | DELETE        | —              |                     No |
| FAILED    | POST          | —              |                     No |
| REVERSED  | POST          | —              |                     No |
| REVERSED  | REVERSE       | —              |                     No |

---

# 24. Canonical Payment Operation State Machine

```text
                 ┌──────────────┐
                 │  INITIATED   │
                 └──────┬───────┘
                        │ submit
                        ▼
                 ┌──────────────┐
                 │ PROCESSING   │
                 └──────┬───────┘
                        │
             ┌──────────┼───────────┐
             │          │           │
             ▼          ▼           ▼
        SUCCEEDED    FAILED      EXPIRED
             │
             ▼
     FINANCIAL POSTING
             │
             ▼
         COMPLETED
```

---

# 25. Payment Operation States

## INITIATED

A payment request has been accepted internally.

Required:

```text
tenant
operationId
idempotencyKey
amount
currency
payer/payee context
```

---

## PROCESSING

An external or asynchronous payment attempt is active.

This state MUST support:

```text
timeout
retry
callback
provider status query
```

---

## SUCCEEDED

The provider has produced a verified successful result.

However:

> `SUCCEEDED` at the provider/payment layer does not automatically mean `POSTED` in the ledger.

Financial posting remains a distinct controlled transition.

---

## FAILED

The payment attempt has failed and is not expected to complete automatically.

---

## EXPIRED

The payment exceeded its permitted execution window.

An expired payment MUST NOT automatically be treated as successful.

---

## COMPLETED

The complete business operation, including required financial posting and other mandatory steps, has successfully concluded.

---

# 26. Payment Transition Matrix

| Current    | Event                    | Next                    |
| ---------- | ------------------------ | ----------------------- |
| INITIATED  | SUBMIT                   | PROCESSING              |
| INITIATED  | CANCEL                   | CANCELLED               |
| PROCESSING | PROVIDER_SUCCESS         | SUCCEEDED               |
| PROCESSING | PROVIDER_FAILURE         | FAILED                  |
| PROCESSING | TIMEOUT                  | EXPIRED / UNKNOWN       |
| PROCESSING | PROVIDER_UNKNOWN         | UNKNOWN                 |
| SUCCEEDED  | POST_FINANCIAL_EFFECT    | COMPLETED               |
| SUCCEEDED  | POSTING_FAILURE          | RECONCILIATION_REQUIRED |
| UNKNOWN    | STATUS_CONFIRMED_SUCCESS | SUCCEEDED               |
| UNKNOWN    | STATUS_CONFIRMED_FAILURE | FAILED                  |
| UNKNOWN    | EVIDENCE_UNRESOLVED      | RECONCILIATION_REQUIRED |

---

# 27. Unknown State

`UNKNOWN` is a critical state.

It means:

> The system cannot currently prove whether the external operation succeeded or failed.

Examples:

```text
provider timeout after submission
network connection lost after request transmission
callback unavailable
provider status endpoint unavailable
```

Rules:

```text
UNKNOWN ≠ FAILED
UNKNOWN ≠ SUCCEEDED
```

---

# 28. Reconciliation Required State

`RECONCILIATION_REQUIRED` means:

> automated execution cannot safely determine the correct outcome.

Possible evidence:

```text
provider status
provider callback
statement
internal operation history
ledger history
manual investigation
```

No blind retry is permitted when financial duplication is possible.

---

# 29. Payment Unknown Recovery

```text
UNKNOWN
   │
   ├── Provider status success
   │        ↓
   │     SUCCEEDED
   │
   ├── Provider status failure
   │        ↓
   │      FAILED
   │
   └── Evidence unresolved
            ↓
      RECONCILIATION_REQUIRED
```

---

# 30. Payment Completion Rule

A payment may enter `COMPLETED` only when:

```text
provider/payment success
+
required financial effect
+
required internal state
+
mandatory validations
```

are all satisfied.

---

# 31. Payment Reversal State

A completed payment may later require compensation.

Where supported:

```text
COMPLETED
   ↓
REVERSAL_REQUESTED
   ↓
REVERSING
   ↓
REVERSED
```

The original payment record remains historically intact.

---

# 32. Canonical Provider Transaction State Machine

```text
SUBMITTED
    │
    ▼
PENDING
    │
 ┌──┴───────────────┐
 ▼                  ▼
SUCCESS           FAILED
```

Possible:

```text
PENDING → UNKNOWN
UNKNOWN → SUCCESS
UNKNOWN → FAILED
```

Provider-specific states MUST be normalized into platform states.

---

# 33. Provider State Normalization

Example:

```text
MTN:
PENDING
SUCCESSFUL
FAILED

Airtel:
INITIATED
TS
SUCCESS
ERROR
```

Normalized:

```text
PENDING
SUCCEEDED
FAILED
UNKNOWN
```

The domain layer MUST NOT depend directly on provider-specific status strings.

---

# 34. Callback State Machine

```text
RECEIVED
   ↓
SIGNATURE_VERIFIED
   ↓
VALIDATED
   ↓
DEDUPLICATED
   ↓
PROCESSING
   ↓
PROCESSED
```

Failure:

```text
RECEIVED
→ REJECTED
```

or:

```text
PROCESSING
→ FAILED
```

---

# 35. Callback State Table

| State              | Meaning                           |
| ------------------ | --------------------------------- |
| RECEIVED           | Payload captured                  |
| SIGNATURE_VERIFIED | Authenticity verified             |
| VALIDATED          | Schema/business validation passed |
| DEDUPLICATED       | Replay check completed            |
| PROCESSING         | Domain processing active          |
| PROCESSED          | Processing completed              |
| REJECTED           | Callback rejected                 |
| FAILED             | Processing failed                 |
| REPLAYED           | Duplicate callback safely handled |

---

# 36. Callback Security Rule

A callback MUST NOT move a payment to success merely because:

```text
HTTP 200
```

The callback MUST first pass:

```text
signature
schema
tenant/context
provider reference
replay
business validation
```

---

# 37. Callback Duplicate Handling

If a callback is received twice:

```text
First:
RECEIVED → ... → PROCESSED

Second:
RECEIVED → REPLAYED
```

The second delivery MUST NOT cause another financial posting.

---

# 38. Settlement State Machine

```text
IMPORTED
   ↓
VALIDATING
   ↓
VALIDATED
   ↓
PROCESSING
   ↓
RECONCILING
   ├── RECONCILED
   ├── PARTIALLY_RECONCILED
   └── EXCEPTION
```

---

# 39. Settlement States

## IMPORTED

Statement or settlement data has been captured.

## VALIDATING

Schema, source, tenant, account, period, and integrity checks are running.

## VALIDATED

The input passed validation.

## PROCESSING

Settlement matching and processing are underway.

## RECONCILING

Internal and external transactions are being matched.

## RECONCILED

All required records are reconciled.

## PARTIALLY_RECONCILED

Some records are reconciled but exceptions remain.

## EXCEPTION

An unresolved discrepancy requires investigation.

---

# 40. Settlement Transition Matrix

| Current              | Event              | Next                 |
| -------------------- | ------------------ | -------------------- |
| IMPORTED             | START_VALIDATION   | VALIDATING           |
| VALIDATING           | VALIDATION_SUCCESS | VALIDATED            |
| VALIDATING           | VALIDATION_FAILURE | EXCEPTION            |
| VALIDATED            | START_PROCESSING   | PROCESSING           |
| PROCESSING           | MATCHING_STARTED   | RECONCILING          |
| RECONCILING          | ALL_MATCHED        | RECONCILED           |
| RECONCILING          | SOME_UNMATCHED     | PARTIALLY_RECONCILED |
| RECONCILING          | MATERIAL_FAILURE   | EXCEPTION            |
| PARTIALLY_RECONCILED | RESOLVE_EXCEPTION  | RECONCILING          |
| EXCEPTION            | REPAIR_SUCCESS     | RECONCILING          |

---

# 41. Statement Processing State Machine

```text
IMPORTED
   ↓
NORMALIZING
   ↓
VALIDATING
   ↓
READY
   ↓
PROCESSING
   ↓
RECONCILING
   ↓
COMPLETED
```

Failures:

```text
NORMALIZING → FAILED
VALIDATING → FAILED
PROCESSING → FAILED
RECONCILING → EXCEPTION
```

---

# 42. Statement Batch State Machine

```text
PENDING
  ↓
CLAIMED
  ↓
PROCESSING
  ↓
COMPLETED
```

Failure:

```text
PROCESSING → FAILED
```

Recovery:

```text
CLAIMED / PROCESSING
       ↓
EXPIRED
       ↓
PENDING
```

A new worker may only reclaim an expired operation.

---

# 43. Claim Ownership

A claim MUST include:

```text
claimOwner
claimedAt
claimExpiresAt
```

Completion requires:

```text
same operation
+
same owner
+
expected state
```

---

# 44. Lease Expiry

When:

```text
now > claimExpiresAt
```

the operation may be considered reclaimable.

The old worker MUST NOT retain authority after lease expiry.

---

# 45. Worker State Transition

Canonical worker flow:

```text
PENDING
   ↓ claim
CLAIMED
   ↓ start
PROCESSING
   ↓ success
COMPLETED
```

Failure:

```text
PROCESSING → FAILED
```

Recoverable failure:

```text
PROCESSING → PENDING
```

only through an explicit release/retry mechanism.

---

# 46. Billing Operation State Machine

```text
PENDING
   ↓
PROCESSING
   ├── COMPLETED
   ├── FAILED
   └── EXPIRED
```

Billing operations MUST remain idempotent.

The operation key SHOULD uniquely identify the billing coordination action within its intended scope.

---

# 47. Subscription State vs Billing Operation State

These are distinct.

Example:

```text
Subscription:
ACTIVE

BillingOperation:
PROCESSING
```

is valid.

The subscription may remain active while a renewal operation is still being processed.

---

# 48. Workflow Operation State Machine

```text
PENDING
  ↓
RUNNING
  ↓
COMPLETED
```

Failure branches:

```text
RUNNING
 ├── FAILED
 ├── CANCELLED
 └── TIMED_OUT
```

Recovery:

```text
FAILED / TIMED_OUT
      ↓
RECOVERY_PENDING
      ↓
RUNNING
```

only through an explicit recovery policy.

---

# 49. Workflow State Rules

A workflow MUST persist:

```text
operationId
currentState
currentStep
attempt
deadline
context/result references
```

State MUST remain recoverable after process restart.

---

# 50. Workflow Step State Machine

```text
PENDING
  ↓
RUNNING
  ├── COMPLETED
  ├── FAILED
  └── TIMED_OUT
```

A completed step MUST NOT be executed again unless it is explicitly idempotent and the workflow semantics require reconciliation.

---

# 51. Compensation State Machine

Compensation may be needed when a long-running workflow partially succeeds.

```text
FORWARD_EXECUTION
      ↓
PARTIAL_FAILURE
      ↓
COMPENSATION_REQUIRED
      ↓
COMPENSATING
      ├── COMPENSATED
      └── COMPENSATION_FAILED
```

Compensation is not the same as database rollback.

---

# 52. Compensation Principle

For distributed workflows:

```text
Rollback
```

may not be possible.

Instead:

```text
Compensation
```

creates a controlled business correction.

Example:

```text
Provider payment succeeded
+
internal workflow failed
```

Possible compensation:

```text
refund / reversal / settlement correction
```

depending on business rules.

---

# 53. Compensation Safety

Compensation MUST be:

```text
idempotent
auditable
authorized
tenant-scoped
traceable to original operation
```

---

# 54. Loan Application State Machine

```text
DRAFT
 ↓
SUBMITTED
 ↓
UNDER_REVIEW
 ├── APPROVED
 ├── REJECTED
 └── CANCELLED
```

---

# 55. Loan Approval Transition Rules

```text
DRAFT → SUBMITTED
SUBMITTED → UNDER_REVIEW
UNDER_REVIEW → APPROVED
UNDER_REVIEW → REJECTED
UNDER_REVIEW → CANCELLED
```

No ordinary operation may move:

```text
REJECTED → APPROVED
```

without an explicit reapplication/review workflow.

---

# 56. Loan Lifecycle State Machine

```text
APPROVED
   ↓
DISBURSEMENT_PENDING
   ↓
DISBURSING
   ├── DISBURSED
   └── DISBURSEMENT_FAILED

DISBURSED
   ↓
ACTIVE
   ↓
COMPLETED
```

Additional states may include:

```text
PAST_DUE
RESTRUCTURED
WRITTEN_OFF
CANCELLED
```

---

# 57. Loan Disbursement State Machine

```text
PENDING
 ↓
PROCESSING
 ├── SUCCEEDED
 ├── FAILED
 └── UNKNOWN
```

Then:

```text
SUCCEEDED
 ↓
FINANCIAL_POSTING
 ↓
COMPLETED
```

---

# 58. Loan Repayment State Machine

```text
INITIATED
 ↓
PROCESSING
 ├── RECEIVED
 ├── FAILED
 └── UNKNOWN
```

Then:

```text
RECEIVED
 ↓
ALLOCATING
 ↓
POSTING
 ↓
COMPLETED
```

---

# 59. Loan Write-Off State Machine

```text
REQUESTED
 ↓
UNDER_REVIEW
 ↓
APPROVED
 ↓
POSTING
 ↓
POSTED
```

Failure:

```text
REJECTED
```

A posted write-off is not deleted; correction requires a new controlled transaction.

---

# 60. Reversal State Machine

```text
REQUESTED
   ↓
VALIDATING
   ↓
APPROVED
   ↓
REVERSING
   ↓
REVERSED
```

Failure:

```text
REJECTED
FAILED
```

---

# 61. Reversal Preconditions

Before reversal:

```text
original transaction exists
original transaction is POSTED
original transaction is eligible
tenant matches
reversal amount is valid
period policy permits reversal
reversal has not already been completed
authorization is sufficient
```

---

# 62. Reversal Idempotency

A reversal MUST have its own operation identity.

Example:

```text
originalTransactionId
+
reversalOperationId
+
idempotencyKey
```

Repeated reversal requests MUST NOT create multiple compensating postings.

---

# 63. Adjustment State Machine

```text
REQUESTED
  ↓
VALIDATING
  ↓
APPROVAL_REQUIRED
  ↓
APPROVED
  ↓
POSTING
  ↓
POSTED
```

Failure:

```text
REJECTED
FAILED
```

---

# 64. Financial Period State Machine

```text
OPEN
 ↓
SOFT_CLOSE
 ↓
FINAL_CLOSE
 ↓
LOCKED
```

Possible recovery:

```text
SOFT_CLOSE → OPEN
```

only when policy permits.

Reopening a locked period MUST be exceptional.

---

# 65. Financial Period Posting Rule

Permitted:

```text
OPEN → normal posting
```

Restricted:

```text
SOFT_CLOSE → controlled posting only
```

Prohibited:

```text
FINAL_CLOSE → ordinary posting
LOCKED → ordinary posting
```

unless explicit controlled exception procedures are used.

---

# 66. Period Close State Machine

```text
OPEN
  ↓
CLOSE_REQUESTED
  ↓
VALIDATING
  ├── VALIDATION_FAILED
  └── READY_TO_CLOSE
         ↓
      CLOSING
         ↓
      CLOSED
         ↓
      LOCKED
```

---

# 67. Period Close Preconditions

The close process SHOULD verify:

```text
no blocking ledger integrity failures
no prohibited unreconciled balances
no invalid pending postings
period dates valid
trial balance balanced
required reports generated
```

---

# 68. Notification State Machine

Notifications are non-financial asynchronous operations.

```text
PENDING
 ↓
QUEUED
 ↓
SENDING
 ├── SENT
 ├── FAILED
 └── RETRYING
```

Notification failure MUST NOT automatically roll back a successful financial operation.

---

# 69. Regulatory Submission State Machine

```text
DRAFT
 ↓
VALIDATING
 ↓
READY
 ↓
SUBMITTED
 ↓
PROCESSING
 ├── ACCEPTED
 ├── REJECTED
 └── UNKNOWN
```

Unknown regulatory outcomes require controlled reconciliation.

---

# 70. KYC Case State Machine

```text
OPEN
 ↓
IN_REVIEW
 ↓
VERIFICATION_PENDING
 ↓
VERIFIED
```

Alternative outcomes:

```text
REJECTED
EXPIRED
REQUIRES_REVIEW
```

---

# 71. AML Case State Machine

```text
OPEN
 ↓
INVESTIGATING
 ↓
DECISION_PENDING
 ├── CLEARED
 ├── ESCALATED
 └── CLOSED
```

Sensitive case transitions MUST be audited.

---

# 72. Fraud Alert State Machine

```text
OPEN
 ↓
TRIAGED
 ↓
INVESTIGATING
 ├── FALSE_POSITIVE
 ├── CONFIRMED
 └── ESCALATED
       ↓
     RESOLVED
```

Fraud state MUST remain separate from ledger state.

---

# 73. Risk Assessment State Machine

```text
REQUESTED
 ↓
PROCESSING
 ↓
COMPLETED
```

Failure:

```text
FAILED
```

Every scoring execution SHOULD retain its version and input fingerprint.

---

# 74. State Transition Authorization

Not every actor may trigger every transition.

Example:

| Transition          | Typical Authority                |
| ------------------- | -------------------------------- |
| Loan SUBMITTED      | Member / Officer                 |
| Loan APPROVED       | Authorized Loan Officer          |
| Loan DISBURSED      | Payment/Finance Workflow         |
| Ledger POSTED       | Ledger Service                   |
| Ledger REVERSED     | Authorized Financial Workflow    |
| Period LOCKED       | Finance Administrator            |
| Regulatory ACCEPTED | External Regulator / Integration |
| Fraud RESOLVED      | Fraud/Compliance Officer         |

---

# 75. State Transition Command Model

Recommended internal command:

```text id="r1fjae"
{
  aggregateType,
  aggregateId,
  expectedState,
  expectedVersion,
  command,
  actor,
  tenantId,
  operationId,
  idempotencyKey,
  reason,
  metadata
}
```

The state-machine engine validates the complete context before changing state.

---

# 76. State Machine Engine

A reusable state-machine engine SHOULD provide:

```text id="7h6n33"
canTransition()
validateTransition()
transition()
recordTransition()
getCurrentState()
getTransitionHistory()
```

The engine MUST be domain-aware enough to enforce domain-specific guards.

---

# 77. Transition Guards

A transition guard verifies conditions.

Example:

```text id="xj1jz7"
PROCESSING
→ COMPLETED
```

guards:

```text
claim owner matches
provider result verified
financial posting exists
required event persisted
tenant matches
current version matches
```

---

# 78. Transition Actions

A transition may perform controlled side effects:

```text id="ii7w8c"
persist state
write transition history
create audit event
create outbox event
update operational projection
```

External side effects MUST be carefully separated from the state commit.

---

# 79. State Transition Atomicity

Where state and domain evidence must remain consistent, persist them atomically.

Example:

```text id="7i1q9r"
PaymentOperation
PROCESSING → SUCCEEDED
+
provider result
+
transition record
```

should be committed together where the storage architecture allows.

---

# 80. State vs Event Ordering

Critical event ordering SHOULD follow:

```text id="3g8n84"
validate
→ persist authoritative state
→ persist event/outbox
→ commit
→ publish asynchronously
```

Do not publish a success event before authoritative state is durable.

---

# 81. Event Delivery vs State

Consumers MUST treat durable state as authoritative.

Events may be:

```text
duplicated
delayed
reordered
retried
```

Consumer logic MUST account for this.

---

# 82. Out-of-Order Events

Where event order matters, consumers SHOULD use:

```text id="30qv84"
sequence
version
event timestamp
aggregate version
```

to reject stale transitions.

Example:

```text
COMPLETED
```

MUST NOT be overwritten by an older:

```text
PROCESSING
```

event.

---

# 83. Stale Event Protection

Consumers SHOULD compare:

```text id="6k7g8l"
aggregateVersion
```

before applying state changes.

If the event is stale:

```text
IGNORE / ACK
```

where safe, while preserving observability.

---

# 84. Terminal State Protection

Once a transaction reaches a terminal state:

```text id="c2s5am"
COMPLETED
FAILED
REJECTED
CANCELLED
REVERSED
```

ordinary transitions MUST stop.

Only explicitly documented recovery or compensation flows may operate.

---

# 85. Retry State Machine

A retryable operation may follow:

```text
FAILED
 ↓
RETRY_PENDING
 ↓
PROCESSING
```

Retry count MUST be bounded.

---

# 86. Retry Metadata

Store:

```text id="u1farl"
attempt
maxAttempts
lastAttemptAt
nextAttemptAt
lastErrorCode
lastErrorMessage
```

Sensitive provider responses MUST be redacted.

---

# 87. Exponential Backoff

Retry scheduling SHOULD use:

```text id="7s6a9b"
baseDelay
×
2^attempt
+
jitter
```

with a maximum delay.

Exact policy SHOULD be configurable.

---

# 88. Non-Retryable State

An operation MUST NOT retry automatically when the error is deterministic.

Examples:

```text id="jexkuq"
UNAUTHORIZED
INVALID_ACCOUNT
TENANT_MISMATCH
INVALID_CURRENCY
JOURNAL_UNBALANCED
PERIOD_LOCKED
IDEMPOTENCY_CONFLICT
INVALID_STATE
```

---

# 89. Timeout State

Timeouts must be explicit.

Possible transitions:

```text id="ilr8fj"
PROCESSING
→ TIMED_OUT
```

However, a provider timeout may actually mean:

```text
UNKNOWN
```

if the request may have succeeded externally.

The state semantics must reflect this distinction.

---

# 90. Expiration vs Timeout

`EXPIRED` means:

> the operation exceeded its business validity window.

`TIMED_OUT` means:

> an execution attempt exceeded its technical time limit.

They are related but distinct.

---

# 91. Cancellation

Cancellation is a business action, not merely an error.

Example:

```text
PENDING → CANCELLED
```

Cancellation rules MUST verify whether financial execution has already started.

A posted transaction cannot simply be “cancelled”; it requires reversal or another financial correction.

---

# 92. Rejection

Rejection means the operation was explicitly denied.

Example:

```text
LOAN UNDER_REVIEW
→ REJECTED
```

Rejection is different from technical failure.

---

# 93. Failure

Failure means the operation could not complete as intended because of technical or business processing failure.

The system SHOULD distinguish:

```text
business rejection
technical failure
external failure
financial integrity failure
```

---

# 94. Error Taxonomy

Recommended transition result classes:

```text
INVALID_TRANSITION
AUTHORIZATION_FAILED
TENANT_MISMATCH
STALE_VERSION
CONCURRENCY_CONFLICT
IDEMPOTENCY_CONFLICT
MISSING_PRECONDITION
EXTERNAL_STATE_UNKNOWN
BUSINESS_RULE_VIOLATION
FINANCIAL_INTEGRITY_FAILURE
```

---

# 95. Transaction Correlation

Every critical transaction SHOULD carry:

```text
requestId
correlationId
operationId
transactionId
```

External integrations SHOULD additionally include:

```text
provider
providerReference
providerTransactionId
```

---

# 96. Canonical Transaction Trace

```text
Request
 ↓
Business Operation
 ↓
Operation ID
 ↓
Payment / Workflow Operation
 ↓
Provider Operation
 ↓
Financial Transaction
 ↓
Journal
 ↓
Ledger
 ↓
Outbox Event
 ↓
Settlement / Reporting / Notification
```

All relevant components SHOULD share correlation context.

---

# 97. State Transition Audit Event

Every privileged state transition SHOULD record:

```text
eventId
tenantId
aggregateType
aggregateId
fromState
toState
command
actor
reason
operationId
correlationId
timestamp
```

---

# 98. State Transition Metrics

The platform SHOULD expose:

```text id="q3pnhf"
state_transitions_total
invalid_transitions_total
concurrency_conflicts_total
idempotency_conflicts_total
timeouts_total
expired_operations_total
unknown_operations_total
reconciliation_required_total
retries_total
terminal_failures_total
```

---

# 99. State Transition Logging

Structured logs SHOULD include:

```text id="x1t4p2"
aggregateType
aggregateId
tenantId
fromState
toState
command
operationId
correlationId
actorId
result
```

---

# 100. State Machine Persistence

Current state MUST be persisted durably.

Minimum fields:

```text id="1o3na5"
status
stateVersion
updatedAt
```

Critical workflows SHOULD also persist:

```text id="x4wz7e"
lastTransitionAt
lastTransitionBy
transitionReason
```

---

# 101. State Transition History Retention

Critical financial transitions SHOULD be retained for as long as the underlying financial record is retained.

The transition history is part of the audit trail.

---

# 102. Invalid State Recovery

If persisted state is invalid or impossible:

```text id="wwdt0v"
DO NOT AUTO-ADVANCE
```

The operation SHOULD enter:

```text id="7f06x6"
RECONCILIATION_REQUIRED
```

and generate an operational alert.

---

# 103. State Repair

State repair MUST be:

```text id="rbv3tq"
authorized
auditable
reasoned
targeted
idempotent
```

Prefer creating a new correction operation rather than rewriting unexplained state history.

---

# 104. Financial State Repair

For financial transactions, repair MUST generally use:

```text id="phlxpk"
reversal
adjustment
new controlled transaction
```

rather than:

```text id="w9l4o1"
UPDATE status
```

or:

```text id="jty9ox"
UPDATE balance
```

---

# 105. State Machine and Ledger Relationship

The state machine controls:

```text
whether a business operation may proceed
```

The ledger controls:

```text
what financial effect actually occurred
```

Example:

```text
PaymentOperation
    ↓
SUCCEEDED
    ↓
Ledger Posting
    ↓
POSTED
```

State should reflect durable financial evidence.

---

# 106. Ledger Posting State

A business payment may be:

```text
SUCCEEDED
```

while its financial transaction is:

```text
VALIDATED
```

during the short interval before posting.

The application MUST handle such transitional states explicitly.

---

# 107. State Reconciliation Rule

If business state and financial state disagree:

```text
Business = COMPLETED
Ledger = NOT_POSTED
```

the operation MUST be investigated.

The platform MUST NOT silently change one state to match the other without evidence.

---

# 108. Provider State vs Internal State

Provider:

```text
SUCCESS
```

Internal:

```text
PROCESSING
```

is possible while internal financial posting is pending.

Internal state should only become:

```text
COMPLETED
```

when all required internal steps are complete.

---

# 109. State Machine and Outbox

A successful transition that requires downstream event processing SHOULD atomically persist:

```text
new state
+
transition record
+
outbox event
```

---

# 110. State Machine and Queue

Queues are delivery mechanisms.

They are not authoritative state stores.

The worker SHOULD:

```text
load operation
→ validate current state
→ claim
→ process
→ transition
```

rather than trusting stale job payload state.

---

# 111. State Machine and Idempotency Store

A Redis-backed idempotency acceleration layer MAY exist.

However:

```text
Redis ≠ authoritative lifecycle state
```

Durable operation state MUST remain in the authoritative persistence layer.

---

# 112. State Machine and Distributed Transactions

The platform MUST NOT pretend that multiple external systems participate in one ACID transaction.

Use:

```text
state machine
+
idempotency
+
outbox
+
retries
+
compensation
+
reconciliation
```

instead.

---

# 113. Distributed Transaction Example

```text
Payment
  ↓
Provider Submission
  ↓
Provider Success
  ↓
Internal Financial Posting
  ↓
Notification
```

If notification fails:

```text
Financial state remains successful.
Notification retries independently.
```

The notification failure MUST NOT reverse the financial transaction.

---

# 114. Distributed Failure Example

```text
Provider Success
      ↓
Ledger Posting Failure
      ↓
RECONCILIATION_REQUIRED
```

Do not:

```text
retry payment blindly
```

Instead:

```text
verify financial state
+
verify provider state
→
complete/recover/reverse
```

according to evidence.

---

# 115. State Machine Security

Every state transition MUST validate:

```text
authentication
authorization
tenant
resource ownership
current state
expected version
business conditions
```

Privileged transitions SHOULD require enhanced authentication/approval.

---

# 116. High-Risk Transition Controls

Examples:

```text
APPROVED → DISBURSED
POSTED → REVERSED
REQUESTED → APPROVED
OPEN → LOCKED
```

may require:

```text
step-up authentication
approval
separation of duties
enhanced audit
```

based on policy.

---

# 117. State Transition Separation of Duties

High-risk workflows SHOULD distinguish:

```text
requester
approver
executor
```

For automated operations, the system identity may execute the approved workflow, but the originating human decision SHOULD remain identifiable.

---

# 118. State Machine API Pattern

Recommended internal API:

```text
canTransition(
  aggregate,
  command,
  context
)

transition(
  aggregate,
  command,
  context
)
```

The transition result SHOULD contain:

```text
previousState
newState
stateVersion
transitionId
timestamp
```

---

# 119. Transition Result

Example conceptual result:

```json id="0hrc1s"
{
  "aggregateId": "…",
  "previousState": "PROCESSING",
  "newState": "COMPLETED",
  "stateVersion": 8,
  "transitionId": "…",
  "operationId": "…"
}
```

---

# 120. Invalid Transition Example

Attempt:

```text
POSTED
→
PROCESSING
```

Result:

```text
INVALID_TRANSITION
```

The existing state remains unchanged.

---

# 121. Duplicate Transition Example

Attempt:

```text
PROCESSING
→ COMPLETED
```

already completed:

```text
COMPLETED
→ COMPLETED
```

The system SHOULD return the existing completion result when the request is the same logical idempotent operation.

---

# 122. Conflicting Duplicate Example

Existing:

```text
operationKey = OP-100
amount = 100,000
```

New request:

```text
operationKey = OP-100
amount = 200,000
```

Result:

```text
IDEMPOTENCY_CONFLICT
```

No state change occurs.

---

# 123. Retryable Transition Example

```text
PROCESSING
 ↓
provider timeout
 ↓
UNKNOWN
```

After provider verification:

```text
UNKNOWN
 ↓
SUCCESS_CONFIRMED
 ↓
SUCCEEDED
```

or:

```text
UNKNOWN
 ↓
FAILURE_CONFIRMED
 ↓
FAILED
```

---

# 124. State Machine Testing Model

Every state machine MUST test:

```text
valid transitions
invalid transitions
terminal protection
authorization
tenant isolation
idempotency
duplicate commands
concurrency
stale version
timeout
expiration
recovery
replay
event ordering
```

---

# 125. Transition Coverage

Testing SHOULD verify every transition in the documented transition table.

Untested transitions are considered production risk.

---

# 126. Property-Based State Testing

Where feasible, state-machine tests SHOULD assert:

```text
No invalid transition can produce a valid terminal state.
No duplicate command creates duplicate side effects.
No stale worker can overwrite newer state.
No terminal financial state can be silently mutated.
```

---

# 127. State Invariants

Every aggregate SHOULD define invariants.

Example Payment:

```text
COMPLETED
→ provider outcome verified
→ required ledger posting exists
```

Example Financial Transaction:

```text
POSTED
→ journal exists
→ journal balanced
→ all entries persisted
```

Example Settlement:

```text
RECONCILED
→ no blocking reconciliation exceptions
```

---

# 128. State Machine Documentation Standard

Every production state machine MUST document:

```text
initial state
states
events/commands
transition guards
transition actions
terminal states
recovery states
failure states
authorization
side effects
idempotency behavior
concurrency behavior
```

---

# 129. Generic Transition Table Template

Each new state machine SHOULD use:

| Current State | Command/Event | Conditions       | Next State | Side Effects | Idempotent | Terminal |
| ------------- | ------------- | ---------------- | ---------- | ------------ | ---------: | -------: |
| PENDING       | START         | Authorized       | PROCESSING | Claim        |        Yes |       No |
| PROCESSING    | SUCCESS       | Valid evidence   | COMPLETED  | Audit/Event  |        Yes |      Yes |
| PROCESSING    | FAILURE       | Classified error | FAILED     | Audit        |        Yes |      Yes |

---

# 130. State Machine Production Readiness Gate

A state machine is production-ready only when:

```text
[ ] Initial state defined
[ ] All states documented
[ ] Allowed transitions documented
[ ] Invalid transitions rejected
[ ] Terminal states defined
[ ] Recovery states defined
[ ] Concurrency rules defined
[ ] Idempotency rules defined
[ ] Authorization rules defined
[ ] Tenant scope defined
[ ] Transition history defined
[ ] Audit defined
[ ] Metrics defined
[ ] Timeout rules defined
[ ] Retry rules defined
[ ] Compensation defined where required
[ ] Reconciliation defined where required
[ ] Integration tests implemented
```

Financial state machines additionally require:

```text
[ ] Ledger dependency defined
[ ] Posting semantics defined
[ ] Reversal semantics defined
[ ] Financial integrity guards
[ ] Period controls
[ ] Accounting auditability
```

---

# 131. Canonical End-to-End Payment State Flow

```text
                    PAYMENT REQUEST
                          │
                          ▼
                      INITIATED
                          │
                          ▼
                      PROCESSING
                          │
             ┌────────────┼─────────────┐
             │            │             │
             ▼            ▼             ▼
          SUCCESS       FAILURE       UNKNOWN
             │            │             │
             ▼            │             │
         SUCCEEDED        │             │
             │            │             │
             ▼            │             ▼
     FINANCIAL POSTING    │       RECONCILIATION
             │            │             │
             ▼            │             │
         COMPLETED        │             │
                          │             │
                          └──────┬──────┘
                                 ▼
                               FAILED
```

---

# 132. Canonical Financial State Flow

```text
              FINANCIAL COMMAND
                      │
                      ▼
                   CREATED
                      │
                      ▼
                  VALIDATED
                      │
                      ▼
                    POSTED
                      │
                  reversal
                      ▼
                  REVERSED
```

Failure:

```text
CREATED / VALIDATED
       ↓
     FAILED
```

---

# 133. Canonical Long-Running Workflow

```text
PENDING
  │
  ▼
RUNNING
  │
  ├── SUCCESS ──→ COMPLETED
  │
  ├── FAILURE ──→ FAILED
  │                │
  │                ▼
  │        RECOVERY_PENDING
  │                │
  │                ▼
  │              RUNNING
  │
  └── TIMEOUT ──→ TIMED_OUT
                   │
                   ▼
             RECOVERY_PENDING
```

---

# 134. Canonical State Recovery Model

```text
Active Operation
      │
      ▼
Failure / Timeout
      │
      ▼
Classify Failure
      │
 ┌────┼──────────────┐
 │    │              │
 ▼    ▼              ▼
Retry Compensate  Reconcile
 │    │              │
 └────┴──────────────┘
          │
          ▼
      Final State
```

---

# 135. Canonical Transaction Integrity Rule

A transaction may move forward only when:

```text
identity valid
AND
tenant valid
AND
authorization valid
AND
current state valid
AND
version valid
AND
business conditions valid
AND
financial conditions valid
AND
idempotency valid
```

---

# 136. Canonical Failure Rule

When the system cannot establish the correct next state:

```text
STOP
↓
PRESERVE EVIDENCE
↓
MARK SAFE INVESTIGATION STATE
↓
RECONCILE
↓
RECOVER
```

Never guess.

---

# 137. Canonical Terminal-State Rule

After a financial transaction reaches:

```text
POSTED
```

ordinary workflow status mutation is prohibited.

Correction requires:

```text
REVERSAL
or
ADJUSTMENT
```

---

# 138. Canonical External-State Rule

If an external system says:

```text
SUCCESS
```

the platform MUST still validate:

```text
authenticity
reference
amount
currency
tenant association
operation identity
duplicate status
internal state
```

before applying the result.

---

# 139. Canonical Worker Rule

Workers MUST:

```text
load current state
→ claim
→ verify ownership
→ process
→ transition using expected state/version
→ release/complete
```

A job payload MUST NOT be trusted as the current state.

---

# 140. Canonical Event Rule

Events describe durable state changes.

Therefore:

```text
persist authoritative state
+
persist outbox event
→
commit
→
publish
```

not:

```text
publish event
→
attempt database write
```

---

# 141. Canonical Idempotency Rule

For every retryable transaction:

```text
same logical command
+
same idempotency key
→
same logical result
```

while:

```text
same key
+
different meaning
→
IDEMPOTENCY_CONFLICT
```

---

# 142. Canonical Tenant Rule

Every state transition MUST operate within an explicit tenant context.

No aggregate may transition across tenant boundaries.

---

# 143. Canonical Audit Rule

Every critical transition MUST leave enough evidence to reconstruct:

```text
who
what
when
from
to
why
tenant
operation
correlation
result
```

---

# 144. Non-Negotiable State Machine Prohibitions

The following are prohibited:

```text
1. Arbitrary status updates.
2. Skipping mandatory states.
3. Silent terminal-state changes.
4. Blind retries of unknown financial outcomes.
5. Cross-tenant transitions.
6. Stale-worker completion.
7. Duplicate financial transitions.
8. Provider callback trust without verification.
9. State changes without audit for critical operations.
10. Financial completion without corresponding ledger evidence.
11. Publishing success events before durable state.
12. Rewriting historical financial state to repair workflow problems.
13. Using Redis as authoritative transaction state.
14. Treating queue delivery as proof of business success.
15. Treating HTTP success as proof of financial success.
```

---

# 145. Architecture Decision Rules

When adding a new transactional workflow, engineering MUST define:

```text
1. Aggregate.
2. Owner.
3. Initial state.
4. States.
5. Commands/events.
6. Transition guards.
7. Terminal states.
8. Failure states.
9. Recovery states.
10. Timeout semantics.
11. Retry semantics.
12. Idempotency strategy.
13. Concurrency strategy.
14. Tenant-scope rules.
15. Authorization rules.
16. Audit requirements.
17. Event/outbox behavior.
18. Financial posting requirements.
19. Compensation behavior.
20. Reconciliation behavior.
```

---

# 146. State-Machine Change Control

A state-machine change MUST document:

```text
Current State Model
Proposed State Model
Reason
Affected APIs
Affected Services
Affected Data
Affected Events
Migration Strategy
Backward Compatibility
Failure Scenarios
Recovery Strategy
Test Coverage
Operational Impact
```

Changing a state name, transition, terminal state, or meaning is an architectural change.

---

# 147. Backward Compatibility

When adding a new state:

```text
old consumers
```

must remain safe.

For events, use:

```text
eventVersion
schemaVersion
```

where necessary.

Do not introduce a new status string without reviewing all consumers.

---

# 148. State Enumeration Governance

State values SHOULD be defined centrally.

Avoid duplicated independent enums such as:

```text
PaymentStatus
ProviderStatus
TransactionStatus
```

with overlapping but inconsistent meanings.

Each enum MUST have an explicit domain contract.

---

# 149. State Naming Standards

Use:

```text
UPPER_SNAKE_CASE
```

for persisted canonical state values.

Examples:

```text
PENDING
PROCESSING
COMPLETED
RECONCILIATION_REQUIRED
```

Do not mix:

```text
pending
Pending
IN_PROGRESS
inProgress
```

within the same state machine.

---

# 150. State Machine and API Contracts

API responses SHOULD expose canonical states.

The API MUST NOT map:

```text
POSTED
```

randomly to:

```text
SUCCESS
```

without documenting the semantic relationship.

If a UI needs a simplified status, use a separate presentation mapping.

---

# 151. Presentation Status vs Domain Status

Example:

```text
Domain:
RECONCILIATION_REQUIRED

UI:
Action Required
```

The UI label MUST NOT become the persisted domain state.

---

# 152. State Machine and Reporting

Reports SHOULD derive from canonical state.

Do not infer success using:

```text
providerReference != null
```

or:

```text
completedAt != null
```

alone.

Use:

```text
status
+
authoritative evidence
```

---

# 153. State Machine and Analytics

Analytics MAY transform state into categories:

```text
successful
failed
pending
recovery_required
```

but the source state must remain canonical.

---

# 154. State Machine and Notifications

Notifications SHOULD be triggered from durable transitions.

Example:

```text
Loan
APPROVED
→
LoanApproved event
→
Notification
```

If notification fails, retry notification independently.

Do not change:

```text
APPROVED
→
FAILED
```

because SMS delivery failed.

---

# 155. State Machine and Compliance

Compliance decisions SHOULD trigger explicit workflow transitions.

Example:

```text
KYC:
VERIFICATION_PENDING
→
VERIFIED
```

A compliance rejection MUST NOT directly mutate financial balances.

It may instead prevent future financial operations.

---

# 156. State Machine and Fraud

Fraud workflows are advisory/control workflows unless explicitly integrated into financial policy.

Example:

```text
FraudAlert = OPEN
```

does not automatically mean:

```text
Payment = FAILED
```

unless a defined fraud-control rule says the payment must be blocked.

---

# 157. State Machine and Risk

Risk scoring MAY gate a transition:

```text
Loan Application
UNDER_REVIEW
   ↓
Risk decision
   ↓
APPROVED / REJECTED
```

The scoring result itself remains a separate persisted assessment.

---

# 158. State Machine and Financial Period

A financial transition MUST check period state before posting.

Example:

```text
Payment SUCCESS
```

does not guarantee:

```text
Ledger POSTED
```

if the accounting period is unavailable or locked.

The operation must enter an appropriate controlled state.

---

# 159. State Machine and Reconciliation

When internal and external systems disagree:

```text
state = RECONCILIATION_REQUIRED
```

is preferred to:

```text
guess success
```

or:

```text
guess failure
```

---

# 160. State Machine Production Operating Model

The production lifecycle is:

```text
Command
 ↓
Transition Validation
 ↓
Concurrency Check
 ↓
Idempotency Check
 ↓
Business Guards
 ↓
State Persistence
 ↓
Transition Audit
 ↓
Outbox Event
 ↓
Async Processing
 ↓
Monitoring
 ↓
Recovery if required
```

---

# 161. State Machine Health Metrics

Operational dashboards SHOULD monitor:

```text
pending operations
processing operations
unknown operations
reconciliation-required operations
timed-out operations
stale claims
retry counts
terminal failures
invalid transition attempts
state transition latency
```

---

# 162. State Aging Metrics

Operations SHOULD be monitored by age.

Examples:

```text
processing > 5 min
unknown > 15 min
reconciliation_required > 1 hour
approval_pending > SLA
settlement_exception > SLA
```

Exact thresholds depend on operation type.

Aging metrics SHOULD drive operational alerts.

---

# 163. State SLA Monitoring

Each long-running state SHOULD have an expected maximum duration.

Example:

```text
PENDING
→ expected < X

PROCESSING
→ expected < Y

RECONCILIATION_REQUIRED
→ expected < Z
```

SLA breaches SHOULD generate operational signals.

---

# 164. State Transition Alerts

Alert on:

```text
stuck PROCESSING
rapid FAILED loops
repeated UNKNOWN
high RECONCILIATION_REQUIRED volume
large state-transition latency
unexpected terminal-state frequency
```

---

# 165. Data Integrity Monitoring

State consistency checks SHOULD identify:

```text
state says COMPLETED
but required ledger record missing

state says REVERSED
but reversal transaction missing

state says SETTLED
but settlement record incomplete

state says RECONCILED
but exceptions remain
```

These are critical integrity signals.

---

# 166. State Rebuild Principle

If current state becomes corrupted but event/transition history remains intact, the platform SHOULD be able to reconstruct or validate state from authoritative history where practical.

For financial records:

```text
ledger history
```

remains more authoritative than an easily mutable status field.

---

# 167. State Snapshot Principle

Current state is a projection of the state history.

Conceptually:

```text
Initial State
+
Valid Transitions
=
Current State
```

This relationship SHOULD be testable.

---

# 168. State Machine Invariant Testing

For every state machine:

```text
For every valid transition:
    state changes only once.

For every invalid transition:
    state does not change.

For every duplicate command:
    no duplicate side effect.

For every stale worker:
    no stale overwrite.

For every terminal state:
    no ordinary mutation.
```

---

# 169. Financial Transaction Invariant Testing

For financial operations:

```text
POSTED
→ journal exists

journal exists
→ entries exist

entries exist
→ debits = credits

posted
→ immutable

reversed
→ valid compensating transaction exists
```

---

# 170. Final Transaction State-Machine Invariants

The following are mandatory:

```text
1. Every critical operation has an explicit initial state.
2. Every critical operation has an explicit terminal state.
3. Every transition is defined.
4. Invalid transitions fail closed.
5. State changes are tenant-scoped.
6. State changes require authorization.
7. State changes are concurrency-safe.
8. Retryable commands are idempotent.
9. Transition history is preserved for critical operations.
10. Financial states are consistent with ledger evidence.
11. Unknown external outcomes require reconciliation.
12. Terminal financial states cannot be silently mutated.
13. Recovery is explicit.
14. Compensation is explicit where distributed rollback is impossible.
15. Events are emitted only from durable authoritative transitions.
16. Queue delivery does not define business truth.
17. Provider status does not automatically define internal truth.
18. State repair is controlled and auditable.
19. State-machine changes are version-controlled and reviewed.
20. Every production state machine is tested against its complete transition contract.
```

---

# 171. Final Enterprise Rule

The transaction state architecture for TITech Community Capital is governed by the following rule:

> **A transaction is not merely a record with a status field; it is a controlled lifecycle with explicit states, valid transitions, business guards, authorization, tenant isolation, concurrency protection, idempotency, durable evidence, and recovery semantics. Financial completion must be supported by authoritative ledger evidence, external uncertainty must result in reconciliation rather than guesswork, and historical financial state must never be rewritten to hide an operational problem.**

---

# 172. Related Architecture Documents

This state-machine specification MUST remain aligned with:

```text
docs/02-architecture/ARCHITECTURE_MAP.md
docs/02-architecture/DATA_MODEL_CATALOGUE.md
docs/02-architecture/SECURITY_MODEL.md
docs/02-architecture/SERVICE_CATALOGUE.md
docs/02-architecture/API_CATALOGUE.md
docs/02-architecture/EVENT_CATALOGUE.md
docs/02-architecture/FINANCIAL_LEDGER_SPECIFICATION.md
```

Implementation areas SHOULD include:

```text
backend/modules/finance/
backend/modules/payment/
backend/modules/settlement/
backend/modules/compliance/
backend/modules/onboarding/
backend/modules/models/
backend/modules/finance/statements/
```

Any change to a canonical state, transition, terminal state, failure mode, recovery path, or financial-state relationship MUST be reflected in this document and in all affected service/data/event documentation.

---

**End of Transaction State Machine**