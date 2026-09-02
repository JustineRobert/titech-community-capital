# TITech Community Capital Ltd — Transaction State Machine Specification

> **System:** Community Savings Platform
> **Document:** `docs/transactions/TRANSACTION_STATE_MACHINE_SPECIFICATION.md`
> **Status:** Enterprise Production Financial Architecture Standard
> **Version:** 2.0
> **Last Updated:** August 16, 2026
> **Domain:** Transactions / Payments / Finance / Ledger / Workflow
> **Primary Principle:** A transaction is a controlled stateful financial workflow. No client, provider callback, worker, or administrative process may arbitrarily mutate transaction state or create a financial side effect outside the approved transition and posting architecture.

---

# 1. Purpose

This document defines the authoritative transaction state machine for the TITech Community Capital Ltd Community Savings Platform.

The transaction state machine governs the lifecycle of financially significant operations including:

```text
Contributions
Loan Disbursements
Loan Repayments
Withdrawals
Transfers
Refunds
Fees
Interest
Settlement
Adjustments
Reversals
Provider-backed Payments
```

The state machine ensures that every transaction has:

* A defined lifecycle
* Explicit valid transitions
* Controlled side effects
* Idempotent processing
* Concurrency protection
* Auditability
* Event traceability
* Failure recovery
* Reconciliation support
* Financial integrity

---

# 2. Scope

This specification covers:

```text
Transaction states
State transitions
Transition guards
Transition ownership
Transition side effects
Idempotency
Concurrency
Retries
Timeouts
Unknown outcomes
Provider callbacks
Ledger posting
Reversals
Cancellation
Failure handling
Dead-letter processing
Recovery
Audit
Events
Observability
Testing
Operational controls
```

It applies to both:

```text
Internal financial transactions
External provider-backed financial transactions
```

---

# 3. Core Principle

> **A transaction state describes a verified business fact or controlled processing condition. It is not an arbitrary field that clients are allowed to assign.**

The valid state is determined by:

```text
Current State
+
Requested Transition
+
Business Rules
+
Authorization
+
Resource State
+
Financial State
+
External Evidence
+
Idempotency
+
Concurrency Controls
```

---

# 4. Canonical Transaction State Machine

The default transaction lifecycle is:

```text
                              +------------------+
                              |                  |
                              v                  |
+-----------+      +----------+---------+        |
| INITIATED | ---> |      PENDING      |        |
+-----------+      +----------+---------+        |
       |                       |                 |
       |                       v                 |
       |                +--------------+         |
       |                |  PROCESSING  |         |
       |                +------+-------+         |
       |                       |                 |
       |             +---------+---------+       |
       |             |                   |       |
       v             v                   v       |
+-------------+   +--------+        +---------+  |
| CANCELLED   |   | FAILED |        | POSTED  |--+
+-------------+   +--------+        +----+----+
                                      |
                                      v
                                +-----------+
                                | REVERSED  |
                                +-----------+
```

The actual workflow may include provider-specific intermediate states.

---

# 5. Canonical States

The platform recognizes the following core transaction states:

```text
INITIATED
PENDING
PROCESSING
POSTED
FAILED
CANCELLED
REVERSED
```

Optional operational states may include:

```text
RETRYING
UNKNOWN
REQUIRES_RECONCILIATION
DEAD_LETTER
```

These optional states should be used only where the implementation needs to represent an operational condition that cannot safely be reduced to the core financial state.

---

# 6. State Categories

The states should be understood in two broad categories.

## 6.1 Operational States

```text
INITIATED
PENDING
PROCESSING
RETRYING
UNKNOWN
REQUIRES_RECONCILIATION
DEAD_LETTER
```

These describe workflow/process status.

## 6.2 Financial/Business States

```text
POSTED
FAILED
CANCELLED
REVERSED
```

The platform must avoid confusing operational workflow status with authoritative accounting status.

---

# 7. State Definitions

# 7.1 INITIATED

### Meaning

The transaction request has been accepted by the application but has not yet entered active execution.

### Typical Entry

```text
API request accepted
Scheduled operation created
Domain event initiates financial operation
```

### Allowed Characteristics

```text
No authoritative ledger posting
No final financial completion
Idempotency registered
Validation may still be completed
```

### Valid Transitions

```text
INITIATED -> PENDING
INITIATED -> PROCESSING
INITIATED -> CANCELLED
INITIATED -> FAILED
```

---

# 8. PENDING

### Meaning

The transaction is valid enough to proceed but is waiting for an external dependency, approval, callback, queue worker, or other prerequisite.

Examples:

```text
Provider request pending
Manual approval pending
Settlement pending
Compliance review pending
```

### Valid Transitions

```text
PENDING -> PROCESSING
PENDING -> FAILED
PENDING -> CANCELLED
PENDING -> UNKNOWN
```

---

# 9. PROCESSING

### Meaning

The transaction is actively being executed.

Examples:

```text
Provider API operation
Financial posting
Settlement processing
Reconciliation-linked financial operation
```

### Valid Transitions

```text
PROCESSING -> POSTED
PROCESSING -> FAILED
PROCESSING -> PENDING
PROCESSING -> UNKNOWN
```

A transaction must not remain in `PROCESSING` indefinitely.

A timeout/recovery policy must exist.

---

# 10. POSTED

### Meaning

The authoritative financial effect has been successfully committed.

A transaction may be marked `POSTED` only when:

```text
Financial transaction persisted
+
Journal persisted
+
Journal entries persisted
+
Debits = Credits
+
Required financial state committed
```

### Valid Transitions

```text
POSTED -> REVERSED
```

No normal update should move a posted transaction back to:

```text
PENDING
PROCESSING
FAILED
CANCELLED
```

---

# 11. FAILED

### Meaning

The operation completed unsuccessfully without an accepted authoritative financial effect.

### Critical Rule

A failed transaction must not leave an unapproved posted financial effect.

If external evidence later indicates that the provider actually succeeded, the transaction must move through a controlled reconciliation/recovery process rather than simply being rewritten.

### Valid Transitions

Depending on implementation:

```text
FAILED -> RETRYING
FAILED -> REQUIRES_RECONCILIATION
```

A failed financial transaction must not become `POSTED` through an arbitrary client request.

---

# 12. CANCELLED

### Meaning

The operation was intentionally stopped before it reached an irreversible financial completion.

### Typical Causes

```text
User cancellation
Administrative cancellation
Expired operation
Policy cancellation
Provider cancellation
```

### Valid Transitions

```text
CANCELLED -> REQUIRES_RECONCILIATION
```

only where an external operation may still have an unknown outcome.

Otherwise `CANCELLED` is terminal.

---

# 13. REVERSED

### Meaning

A previously posted transaction has been compensated by an approved reversal.

The original transaction remains immutable.

### Valid Transition

```text
POSTED -> REVERSED
```

A reversal creates a new compensating financial transaction/journal where accounting policy requires it.

---

# 14. Optional State — RETRYING

### Meaning

A transient failure is being retried under a controlled retry policy.

```text
RETRYING -> PROCESSING
RETRYING -> FAILED
RETRYING -> UNKNOWN
```

A retry must preserve the same logical transaction identity where the operation is idempotent.

---

# 15. Optional State — UNKNOWN

### Meaning

The system cannot yet determine whether the external operation succeeded.

Typical example:

```text
Request sent
    |
    v
Provider timeout
    |
    v
UNKNOWN
```

The state exists to prevent unsafe duplicate execution.

### Valid Resolution

```text
UNKNOWN -> POSTED
UNKNOWN -> FAILED
UNKNOWN -> REQUIRES_RECONCILIATION
```

Resolution should be based on authoritative evidence.

---

# 16. Optional State — REQUIRES_RECONCILIATION

### Meaning

The available internal and/or external evidence cannot safely determine a final financial outcome automatically.

Examples:

```text
Provider says SUCCESS
Internal state says FAILED
```

or:

```text
Provider amount != internal amount
```

### Resolution

```text
REQUIRES_RECONCILIATION -> POSTED
REQUIRES_RECONCILIATION -> FAILED
REQUIRES_RECONCILIATION -> REVERSED
```

only through controlled reconciliation/repair workflows.

---

# 17. Optional State — DEAD_LETTER

### Meaning

The transaction workflow or callback processing has exhausted configured automated retries and requires controlled recovery.

A dead-letter condition must never automatically produce a second financial effect.

---

# 18. State Transition Matrix

| From                      | To                        |    Allowed | Typical Trigger                       |
| ------------------------- | ------------------------- | ---------: | ------------------------------------- |
| `INITIATED`               | `PENDING`                 |        Yes | Waiting for provider/approval         |
| `INITIATED`               | `PROCESSING`              |        Yes | Worker begins                         |
| `INITIATED`               | `FAILED`                  |        Yes | Validation/execution failure          |
| `INITIATED`               | `CANCELLED`               |        Yes | Explicit cancellation                 |
| `PENDING`                 | `PROCESSING`              |        Yes | Prerequisite satisfied                |
| `PENDING`                 | `FAILED`                  |        Yes | Permanent failure                     |
| `PENDING`                 | `CANCELLED`               |        Yes | Cancellation/expiry                   |
| `PENDING`                 | `UNKNOWN`                 |        Yes | External ambiguity                    |
| `PROCESSING`              | `POSTED`                  |        Yes | Financial commit                      |
| `PROCESSING`              | `FAILED`                  |        Yes | Permanent failure                     |
| `PROCESSING`              | `PENDING`                 |        Yes | Dependency still pending              |
| `PROCESSING`              | `UNKNOWN`                 |        Yes | Timeout/ambiguous result              |
| `POSTED`                  | `REVERSED`                |        Yes | Approved reversal                     |
| `FAILED`                  | `RETRYING`                | Controlled | Transient failure                     |
| `RETRYING`                | `PROCESSING`              |        Yes | Retry begins                          |
| `UNKNOWN`                 | `POSTED`                  | Controlled | Authoritative success                 |
| `UNKNOWN`                 | `FAILED`                  | Controlled | Authoritative failure                 |
| `UNKNOWN`                 | `REQUIRES_RECONCILIATION` |        Yes | Cannot resolve automatically          |
| `CANCELLED`               | `REQUIRES_RECONCILIATION` | Controlled | External operation may have succeeded |
| `REQUIRES_RECONCILIATION` | `POSTED`                  | Controlled | Verified financial success            |
| `REQUIRES_RECONCILIATION` | `FAILED`                  | Controlled | Verified failure                      |
| `REQUIRES_RECONCILIATION` | `REVERSED`                | Controlled | Existing financial effect compensated |

---

# 19. Invalid Transitions

The following transitions are prohibited by default:

```text
POSTED -> PENDING
POSTED -> PROCESSING
POSTED -> FAILED
POSTED -> CANCELLED

REVERSED -> POSTED
REVERSED -> PROCESSING
REVERSED -> FAILED

FAILED -> POSTED without controlled recovery
CANCELLED -> POSTED without controlled reconciliation
```

Any exceptional transition must use an explicit financial repair workflow.

---

# 20. State Machine Ownership

The state machine must have one authoritative owner.

Recommended:

```text
TransactionStateMachine
```

or an equivalent domain service.

Controllers, providers, workers, and scripts must call the state machine rather than manipulating status fields directly.

Incorrect:

```javascript id="v9p9do"
transaction.status = "posted";
await transaction.save();
```

Correct:

```text id="nixm6r"
Transaction Service
       |
       v
State Machine
       |
       v
Guard Validation
       |
       v
Financial Transition
```

---

# 21. Transition Command vs Event

Commands request transitions:

```text id="d9ab4c"
ApproveLoan
ProcessPayment
CancelPayment
ReverseTransaction
```

Events report transitions that occurred:

```text id="wea8c1n"
PaymentPosted
PaymentFailed
PaymentCancelled
PaymentReversed
```

Do not use domain events as a mechanism for clients to directly assign transaction state.

---

# 22. Transition Structure

Every transition should be represented conceptually as:

```json id="z3wqld"
{
  "transactionId": "txn_01J...",
  "fromState": "PROCESSING",
  "toState": "POSTED",
  "transition": "POST_TRANSACTION",
  "actorId": "user_01J...",
  "actorType": "SERVICE",
  "requestId": "req_01J...",
  "correlationId": "corr_01J...",
  "reason": "Provider payment confirmed and ledger posted"
}
```

---

# 23. Transition Guards

Every transition must have guards.

Typical guards:

```text id="a8x9v0"
Authentication
Authorization
Tenant ownership
Current state
Resource existence
Resource version
Idempotency
Payment status
Provider status
Amount
Currency
Account state
Financial period
Compliance state
Fraud state
Financial freeze
```

---

# 24. State Guard Example — POSTED

Before:

```text
PROCESSING -> POSTED
```

require:

```text id="m9q8ua"
financial transaction exists
journal exists
journal balanced
accounts valid
currency valid
period open
posting transaction committed
```

---

# 25. State Guard Example — REVERSED

Before:

```text
POSTED -> REVERSED
```

require:

```text id="h5x7fe"
original is POSTED
original not already reversed
reversal authorized
reversal reason provided
reversal amount valid
reversal journal balanced
reversal references original
```

---

# 26. State Guard Example — CANCELLED

Before:

```text
PENDING -> CANCELLED
```

require:

```text id="r4qbw7"
operation cancellable
no posted financial effect
authorization valid
cancellation policy allows operation
```

If the external provider operation may already have succeeded, move to:

```text
REQUIRES_RECONCILIATION
```

instead of treating cancellation as proof of failure.

---

# 27. Transaction Immutability

Once a transaction reaches:

```text
POSTED
```

the financial fields must be immutable.

Protected fields include:

```text id="t1yqbr"
amount
currency
source
destination
account references
journal reference
posting date
financial effect
```

Corrections use:

```text id="3uyv4d"
reversal
adjustment
compensating transaction
```

---

# 28. State Versioning

Transactions should maintain:

```text
version
```

Example:

```text id="q1j5v9"
State       Version
INITIATED      1
PENDING        2
PROCESSING     3
POSTED         4
```

A transition should succeed only if the expected version matches the current version.

This prevents lost updates.

---

# 29. Optimistic Concurrency

Example:

```text id="8ot3fi"
Worker A reads:
state = PROCESSING
version = 4

Worker B reads:
state = PROCESSING
version = 4

Worker A:
PROCESSING -> POSTED
version = 5

Worker B:
PROCESSING -> FAILED
```

Worker B must fail because version `4` is stale.

Expected result:

```text id="xw4l3g"
CONCURRENT_TRANSACTION_UPDATE
```

---

# 30. Distributed Concurrency

Where processing spans multiple workers/processes:

```text id="xbzq75"
database transaction
+
unique constraint
+
idempotency key
+
lease/claim token where needed
```

should be preferred over unbounded distributed locks.

---

# 31. Idempotency

State transitions themselves should be idempotent where appropriate.

Example:

```text id="7hpo6r"
PROCESSING -> POSTED
```

repeated with the same operation identity should not create:

```text id="jp5b1p"
second journal
second payment
second event
```

---

# 32. Idempotent State Transition Record

A transition record may include:

```text id="3o4qjb"
transactionId
transitionId
fromState
toState
operationKey
requestHash
actorId
createdAt
```

Uniqueness:

```text id="5kb6fd"
transactionId + operationKey
```

---

# 33. Transaction State History

The system should preserve a state history for material transactions.

Example:

```json id="y7qsck"
[
  {
    "from": null,
    "to": "INITIATED",
    "at": "2026-08-16T00:40:00.000Z"
  },
  {
    "from": "INITIATED",
    "to": "PENDING",
    "at": "2026-08-16T00:40:01.000Z"
  },
  {
    "from": "PENDING",
    "to": "PROCESSING",
    "at": "2026-08-16T00:40:05.000Z"
  },
  {
    "from": "PROCESSING",
    "to": "POSTED",
    "at": "2026-08-16T00:40:06.000Z"
  }
]
```

---

# 34. Transition Audit Record

Each material transition should capture:

```text id="2x8xkr"
transactionId
fromState
toState
transition
actorId
actorType
tenantId
requestId
correlationId
reason
createdAt
```

Administrative/high-risk transitions require stronger audit detail.

---

# 35. Transaction Events

A successful state transition may emit an event.

Example:

```text id="h9z7mu"
PROCESSING -> POSTED
```

produces:

```text id="0a8u4j"
FinancialTransactionPosted
```

The event must only be emitted after the authoritative state change commits.

---

# 36. Event Ordering

For one transaction, event ordering should follow state progression.

Example:

```text id="bpv2d9"
TransactionInitiated
PaymentProcessing
FinancialTransactionPosted
PaymentCompleted
```

The exact event set depends on domain boundaries, but events must not claim impossible state order.

---

# 37. State-to-Event Mapping

| State Transition                    | Typical Event                |
| ----------------------------------- | ---------------------------- |
| `INITIATED -> PENDING`              | `TransactionPending`         |
| `PENDING -> PROCESSING`             | `TransactionProcessing`      |
| `PROCESSING -> POSTED`              | `FinancialTransactionPosted` |
| `PROCESSING -> FAILED`              | `TransactionFailed`          |
| `PENDING -> CANCELLED`              | `TransactionCancelled`       |
| `POSTED -> REVERSED`                | `TransactionReversed`        |
| `UNKNOWN -> POSTED`                 | `FinancialTransactionPosted` |
| `UNKNOWN -> FAILED`                 | `TransactionFailed`          |
| `REQUIRES_RECONCILIATION -> POSTED` | `FinancialTransactionPosted` |

---

# 38. Event Publication Rule

Use the outbox pattern:

```text
State Change
+
Financial Data
+
Audit
+
Outbox Event
      |
      v
COMMIT
      |
      v
Publish Event
```

Never publish a completion event before the state transition is committed.

---

# 39. Provider Callback State Transitions

A provider callback may request a transition such as:

```text
PENDING -> POSTED
```

but the callback does not own the transition.

The processing chain is:

```text id="z2alj0"
Provider Callback
      |
      v
Callback Security
      |
      v
Payment Correlation
      |
      v
State Machine
      |
      v
Financial Posting
      |
      v
POSTED
```

---

# 40. Provider Status vs Internal State

Provider state must be normalized.

Example:

```text
Provider:
SUCCESS

Internal:
SUCCESSFUL / POSTED
```

But provider status alone must not determine the final internal state.

The state machine additionally checks:

```text id="fq9o6h"
amount
currency
reference
current state
ledger status
tenant
```

---

# 41. Out-of-Order Events

Example:

```text id="m1pfge"
Provider callback A -> SUCCESS
Provider callback B -> PENDING
```

If `SUCCESS` has already produced an authoritative completion:

```text id="wfwylm"
PENDING
```

must not downgrade:

```text id="sp9p3f"
POSTED
```

---

# 42. Duplicate State Transition

Repeated request:

```text id="b1g0ka"
POSTED -> POSTED
```

should normally return the current authoritative state without performing another side effect, where the operation is idempotent.

Repeated request attempting:

```text id="6b7q3i"
POSTED -> POSTED
```

must not create:

```text id="yn2y8b"
new journal
new reversal
new event
```

unless the endpoint explicitly represents a distinct operation.

---

# 43. Retry Model

Retry only transient failures.

## Transient

```text id="yq9f0s"
network timeout
temporary database error
temporary queue unavailable
temporary provider unavailable
```

## Permanent

```text id="z2g6yw"
invalid signature
invalid amount
currency mismatch
authorization failure
invalid state
closed period
```

Permanent failures should not be retried indefinitely.

---

# 44. Retry State

When retrying:

```text id="qv31b4"
PROCESSING
   |
   v
RETRYING
   |
   v
PROCESSING
```

The same logical transaction identity should be preserved.

---

# 45. Retry Limits

Every retryable transaction must define:

```text id="x1w9xv"
maximum attempts
backoff
jitter
timeout
dead-letter behavior
```

Example conceptual schedule:

```text id="qshh6b"
Attempt 1 -> immediate
Attempt 2 -> short delay
Attempt 3 -> longer delay
Attempt 4 -> longer delay
Maximum -> manual/reconciliation recovery
```

---

# 46. UNKNOWN State

The `UNKNOWN` state is critical for external money operations.

It means:

> The system cannot prove failure and cannot yet prove success.

Typical causes:

```text id="tkgxd5"
provider timeout
network interruption
worker crash after external request
ambiguous provider response
```

The correct response is investigation, not duplication.

---

# 47. UNKNOWN Resolution

Resolve through:

```text id="0r6gyf"
Provider status API
Provider callback
Internal payment record
Settlement statement
Reconciliation
```

Never guess.

---

# 48. Reconciliation-Required State

Use:

```text id="lbrjug"
REQUIRES_RECONCILIATION
```

when automated evidence cannot safely produce a definitive final state.

Example:

```text id="jmlm48"
Provider SUCCESS
+
Internal payment missing
```

or:

```text id="i0cxny"
Provider amount = 10,000
Internal amount = 5,000
```

---

# 49. Reconciliation Ownership

The state machine should hand responsibility to the reconciliation domain when required.

Example:

```text id="5ynn6t"
Transaction
    |
    v
REQUIRES_RECONCILIATION
    |
    v
ReconciliationService
    |
    +---- Match
    |
    +---- Exception
```

---

# 50. Reconciliation Resolution

A reconciliation workflow may determine:

```text id="twdaj1"
confirmed success
confirmed failure
confirmed duplicate
confirmed reversal
manual financial adjustment required
```

Any financial correction must still go through the financial engine.

---

# 51. Cancellation

Cancellation is allowed only before irreversible financial completion.

Examples:

```text id="mtso4d"
INITIATED -> CANCELLED
PENDING -> CANCELLED
```

Cancellation after provider execution may require:

```text id="frg8hy"
UNKNOWN
or
REQUIRES_RECONCILIATION
```

rather than direct cancellation.

---

# 52. Expiration

Transactions may have an expiration deadline.

Example:

```text id="f7z3j0"
PENDING
+
expiresAt reached
```

may transition to:

```text id="h5krh4"
CANCELLED
```

only if policy guarantees no financial effect can still occur.

Otherwise:

```text id="9gl26i"
REQUIRES_RECONCILIATION
```

---

# 53. Timeout

A timeout is an operational condition, not automatically a business failure.

Example:

```text id="1d89fd"
PROCESSING
   |
   v
timeout
   |
   v
UNKNOWN
```

Do not automatically set:

```text id="u6fd7n"
FAILED
```

when an external financial outcome remains unknown.

---

# 54. Reversal State

`REVERSED` is terminal for the original financial transaction.

The reversal itself is a separate transaction:

```text id="m3mskh"
Original Transaction
        |
        v
Reversal Transaction
```

This preserves history.

---

# 55. Partial Reversal

If the business supports partial reversal:

```text id="cv4zqf"
Original Amount = 10,000
Reversal Amount = 4,000
Remaining Effective Amount = 6,000
```

The original transaction remains immutable.

The reversal model must explicitly record:

```text id="eh9nwi"
originalTransactionId
reversalAmount
remainingReversibleAmount
```

A second reversal may not exceed the remaining reversible amount.

---

# 56. Full Reversal

Example:

```text id="mnrpf9"
Original = 10,000
Reversal = 10,000
Remaining reversible = 0
```

The original becomes:

```text id="mfq8lt"
REVERSED
```

---

# 57. Transaction State vs Loan State

A loan and its payment transaction are separate state machines.

Example:

```text id="3k1du3"
Payment Transaction:
PROCESSING -> POSTED

Loan:
ACTIVE -> ACTIVE
```

Posting a repayment may update the loan state separately.

Example:

```text id="f1td7y"
Payment Transaction -> POSTED
Loan -> COMPLETED
```

only if the repayment makes the loan fully settled.

---

# 58. Transaction State vs Payment State

Payment may have:

```text id="a4p5l7"
initiated
pending
processing
successful
failed
cancelled
reversed
```

Financial transaction may have:

```text id="h41n9p"
INITIATED
PENDING
PROCESSING
POSTED
FAILED
CANCELLED
REVERSED
```

These states must not be blindly copied across domains.

The domain service determines the mapping.

---

# 59. Transaction State vs Provider State

Provider state should be stored separately:

```text id="2mgy2g"
providerStatus
```

The internal state is calculated from:

```text id="cdqdz2"
provider evidence
+
internal state
+
financial state
+
business policy
```

---

# 60. State Machine API

Recommended service interface:

```text id="g6zzmr"
canTransition(transaction, targetState)
transition(transaction, targetState, context)
getAllowedTransitions(transaction)
validateTransition(transaction, targetState, context)
recordTransition(transaction, transition)
```

The exact implementation may differ.

---

# 61. Transition Context

A transition context should support:

```text id="1gkcw9"
actorId
actorType
tenantId
requestId
correlationId
idempotencyKey
reason
source
provider
providerTransactionId
expectedVersion
metadata
```

---

# 62. Transition Result

Recommended result:

```json id="3t0brh"
{
  "transactionId": "txn_01J...",
  "previousState": "PROCESSING",
  "currentState": "POSTED",
  "version": 5,
  "transitionId": "transition_01J..."
}
```

---

# 63. Transition Errors

Recommended error codes:

```text id="s3m6zj"
INVALID_STATE_TRANSITION
CONCURRENT_TRANSACTION_UPDATE
TRANSACTION_NOT_FOUND
TRANSACTION_ALREADY_POSTED
TRANSACTION_ALREADY_REVERSED
TRANSACTION_NOT_CANCELLABLE
TRANSACTION_UNKNOWN_OUTCOME
RECONCILIATION_REQUIRED
IDEMPOTENCY_CONFLICT
FINANCIAL_PERIOD_CLOSED
FINANCIAL_FREEZE_ACTIVE
INSUFFICIENT_AUTHORIZATION
```

---

# 64. Transaction Repository Rules

Repositories must:

```text id="r83y0s"
enforce tenant scope
enforce version checks
protect immutable fields
provide atomic updates
support unique idempotency constraints
support state queries
```

Repositories must not expose unsafe methods that allow arbitrary status assignment.

Avoid:

```javascript id="ih69ox"
updateStatus(id, arbitraryStatus)
```

Prefer:

```text id="o7c6wh"
transitionTransaction(id, transition, context)
```

---

# 65. State Transition Audit

At minimum, record:

```text id="3g7s1w"
transactionId
tenantId
fromState
toState
transition
actorId
actorType
reason
requestId
correlationId
createdAt
```

For financial transitions also record:

```text id="zq01hl"
financialTransactionId
journalId where available
```

---

# 66. Event Publication

Events should map to completed facts.

Example:

```text id="drt7ck"
PROCESSING -> POSTED
```

publishes:

```text id="q2f1v0"
FinancialTransactionPosted
```

not:

```text id="glkp50"
FinancialTransactionPosting
```

unless an explicit operational event is required.

---

# 67. Outbox Requirements

The outbox record should include:

```text id="lv3zgw"
eventId
eventType
eventVersion
tenantId
aggregateType
aggregateId
aggregateVersion
payload
status
attemptCount
nextAttemptAt
createdAt
publishedAt
```

---

# 68. Event Consumer Idempotency

Consumers must record processed event identity.

Example:

```text id="n1ow8q"
consumerId
+
eventId
```

must be unique.

A consumer crash after processing but before acknowledgement must not repeat a financial side effect.

---

# 69. Transaction State History Immutability

State history must be append-oriented.

Do not:

```text id="04f2bb"
edit historical transition
```

Instead:

```text id="2jfxpi"
append correction/recovery transition
```

Historical transition records should remain available for investigation.

---

# 70. Financial State Immutability

Transaction state can change according to the state machine.

The financial effect of a posted transaction cannot be rewritten.

This distinction is critical:

```text id="d8j4xj"
Mutable:
transaction workflow state

Immutable after posting:
financial accounting effect
```

---

# 71. Transaction State Machine and Ledger

The state machine is downstream of business logic but upstream of authoritative final state.

Example:

```text id="gufsiq"
PROCESSING
    |
    v
Posting Engine
    |
    v
Ledger Commit
    |
    v
POSTED
```

`POSTED` must mean that the ledger effect exists.

---

# 72. Transaction State Machine and Reversals

Reversal flow:

```text id="3xv2k2"
POSTED
   |
   v
Reversal Requested
   |
   v
Reversal Validation
   |
   v
Compensating Journal
   |
   v
REVERSED
```

The original transaction remains unchanged except for controlled state metadata indicating its reversal.

---

# 73. Transaction State Machine and Settlement

Settlement should have its own state machine where needed.

A payment transaction may be:

```text id="5b8z66"
POSTED
```

while settlement is:

```text id="4qsqik"
PENDING
```

This is valid.

Customer transaction posting and provider settlement are related but distinct workflows.

---

# 74. Transaction State Machine and Reconciliation

Similarly:

```text id="vzch14"
Transaction = POSTED
Reconciliation = PENDING
```

is valid.

A posted transaction must not be reverted merely because reconciliation is incomplete.

The reconciliation subsystem investigates evidence.

---

# 75. Transaction State Machine and Audit

Every transition of financial consequence must be auditable.

Examples:

```text id="8iqwuf"
PROCESSING -> POSTED
POSTED -> REVERSED
UNKNOWN -> POSTED
UNKNOWN -> FAILED
```

---

# 76. Transaction State Machine and Notifications

Notifications must be downstream.

Correct:

```text id="s9c2i3"
POSTED
  |
  v
FinancialTransactionPosted
  |
  v
Notification
```

Do not notify success merely because:

```text id="jshdj5"
INITIATED
```

was reached.

---

# 77. Transaction State Machine and Risk

A transaction may be held before final processing:

```text id="dmjthx"
PENDING
   |
   v
Risk Review
   |
   +---- Approve -> PROCESSING
   |
   +---- Reject  -> FAILED
```

Risk systems do not directly mutate ledger state.

---

# 78. Transaction State Machine and Compliance

Compliance may block:

```text id="v3zv4u"
INITIATED
```

from progressing:

```text id="iy5k0l"
PENDING
```

until required verification is satisfied.

Compliance cannot silently change financial accounting.

---

# 79. Transaction State Machine and Fraud

Fraud controls may produce:

```text id="zw1jfv"
PENDING
   |
   v
Fraud Review
   |
   +---- CLEAR -> PROCESSING
   |
   +---- BLOCK -> FAILED
```

A blocked transaction must remain auditable.

---

# 80. Transaction State Machine and Financial Freeze

If a financial freeze is enabled:

```text id="j70dgy"
INITIATED
PENDING
```

may be prevented from progressing to:

```text id="t46msh"
PROCESSING
```

for affected transaction types.

Existing transactions may still be permitted to complete if required for financial consistency.

---

# 81. State Transition Atomicity

A transition with financial side effects must be atomic.

Example:

```text id="2fsy6r"
PROCESSING -> POSTED
```

must not leave:

```text id="4trh2c"
transaction = POSTED
journal = missing
```

or:

```text id="h7zq9n"
journal = POSTED
transaction = PROCESSING
```

unless the architecture explicitly uses durable intermediate states and has recovery controls.

---

# 82. State Machine Recovery

If a worker crashes during transition:

```text id="b7c9ay"
1. Inspect transaction state.
2. Inspect journal state.
3. Inspect idempotency record.
4. Inspect outbox.
5. Determine whether transition committed.
6. Resume or safely finalize.
```

Do not repeat a financial operation blindly.

---

# 83. State Machine Watchdog

A background watchdog should detect transactions stuck beyond expected time.

Examples:

```text id="ksp8dm"
INITIATED > threshold
PENDING > threshold
PROCESSING > threshold
RETRYING > threshold
UNKNOWN > threshold
```

Actions:

```text id="gjes8f"
alert
requeue
reconcile
dead-letter
manual review
```

The watchdog must not create duplicate financial effects.

---

# 84. Stuck Transaction Metrics

Recommended:

```text id="ygo3vq"
transactions_stuck_initiated_total
transactions_stuck_pending_total
transactions_stuck_processing_total
transactions_unknown_total
transactions_reconciliation_required_total
transactions_dead_letter_total
```

---

# 85. State Duration

Track:

```text id="u8z1ce"
time_in_state
transition_latency
end_to_end_duration
```

Example:

```text id="0hj1fh"
INITIATED -> PENDING = 50 ms
PENDING -> PROCESSING = 2 sec
PROCESSING -> POSTED = 800 ms
```

---

# 86. State Machine Tracing

Recommended spans:

```text id="qwjp5i"
transaction.create
transaction.validate
transaction.idempotency
transaction.transition
transaction.process
transaction.post
transaction.reverse
transaction.reconcile
```

Attributes:

```text id="cy0yz2"
transactionId
tenantId
operationType
fromState
toState
version
```

Do not include sensitive financial payloads unnecessarily.

---

# 87. State Machine Metrics

Recommended:

```text id="wmyw83"
transactions_created_total
transactions_transitioned_total
transactions_posted_total
transactions_failed_total
transactions_cancelled_total
transactions_reversed_total
transaction_transition_errors_total
transaction_concurrency_conflicts_total
transaction_idempotency_conflicts_total
transaction_state_duration_seconds
```

---

# 88. Transaction State Machine Security

Clients must never directly submit:

```json id="9am6vp"
{
  "status": "posted"
}
```

and expect the server to accept it.

The API may accept commands such as:

```json id="p4it1g"
{
  "action": "cancel"
}
```

but the backend decides whether:

```text id="gvda8w"
current state
+
authorization
+
business conditions
```

permit the command.

---

# 89. Administrative Transitions

High-risk transitions require stronger authorization.

Examples:

```text id="w4ihio"
POSTED -> REVERSED
FAILED -> RETRYING
UNKNOWN -> POSTED
REQUIRES_RECONCILIATION -> POSTED
```

The exact permission should be policy-defined.

Possible permissions:

```text id="lh3vcy"
TRANSACTION_RETRY
TRANSACTION_REVERSE
TRANSACTION_RECONCILE
TRANSACTION_ADJUST
TRANSACTION_ADMIN
```

---

# 90. Segregation of Duties

Where required:

```text id="5t3kc9"
Requester != Approver
```

Examples:

```text id="o8v35i"
Financial adjustment requested by Operator A
Financial adjustment approved by Operator B
```

This must be enforced for designated high-risk transactions.

---

# 91. Transaction Limits

Transition guards may include:

```text id="8dvrxr"
maximum amount
daily total
monthly total
provider limits
tenant limits
user limits
```

Limits should be checked before external execution and again before final financial posting where necessary.

---

# 92. Transaction Currency

Every transaction must have explicit:

```text id="v3j9b7"
currency
```

A state transition cannot override currency.

Currency changes require a distinct FX operation rather than mutation of an existing posted transaction.

---

# 93. Transaction Amount

The amount is immutable after posting.

Before posting:

```text id="zybgj5"
amount
```

may be corrected only through a controlled transition/workflow.

After posting:

```text id="4mgn2x"
reversal/adjustment
```

is required.

---

# 94. Transaction Source

Every transaction should identify its business source:

```text id="7w7qso"
CONTRIBUTION
LOAN
PAYMENT
WITHDRAWAL
TRANSFER
SETTLEMENT
REFUND
ADJUSTMENT
```

and source ID:

```text id="2a8lqg"
sourceId
```

This enables end-to-end traceability.

---

# 95. Transaction State and Idempotency Keys

A transaction should persist:

```text id="qu0kt4"
idempotencyKey
requestHash
```

The key is associated with the logical operation, not merely one HTTP request.

---

# 96. State Machine and API Semantics

Recommended responses:

## Accepted

```http id="5i8gr8"
202 Accepted
```

when processing continues asynchronously.

## Completed

```http id="g5qz4n"
200 OK
```

when the authoritative state is already complete.

## Conflict

```http id="h0lrvp"
409 Conflict
```

for invalid/concurrent state conflicts.

Example:

```json id="q0g0n5"
{
  "success": false,
  "error": {
    "code": "INVALID_STATE_TRANSITION",
    "message": "The transaction cannot be processed from its current state."
  }
}
```

---

# 97. Example — Loan Repayment

Initial:

```json id="af17r6"
{
  "transactionId": "txn_01J...",
  "status": "INITIATED",
  "amount": "5500.00",
  "currency": "UGX"
}
```

Processing:

```text id="4rsl7x"
INITIATED
   |
   v
PENDING
   |
   v
PROCESSING
```

Provider confirms payment:

```text id="3mq20u"
PROCESSING
   |
   v
POSTING
```

After ledger commit:

```text id="uk8e7d"
PROCESSING
   |
   v
POSTED
```

Event:

```text id="f5f4ge"
FinancialTransactionPosted
LoanPaymentRecorded
```

---

# 98. Example — Failed Payment

```text id="nrmlc4"
INITIATED
   |
   v
PENDING
   |
   v
PROCESSING
   |
   v
FAILED
```

No posted ledger effect.

Possible event:

```text id="i58s74"
PaymentFailed
```

---

# 99. Example — Provider Timeout

```text id="k8n5yd"
INITIATED
   |
   v
PENDING
   |
   v
PROCESSING
   |
   v
UNKNOWN
```

Then provider callback:

```text id="xpfq7g"
UNKNOWN
   |
   v
POSTED
```

after all internal financial checks succeed.

---

# 100. Example — Duplicate Callback

First callback:

```text id="ih4dl1"
PENDING
   |
   v
PROCESSING
   |
   v
POSTED
```

Duplicate callback:

```text id="pcst5q"
POSTED
   |
   v
POSTED
```

No new financial effect.

---

# 101. Example — Reversal

```text id="yrg1ym"
POSTED
   |
   v
Reversal Requested
   |
   v
Reversal Approved
   |
   v
Compensating Journal
   |
   v
REVERSED
```

---

# 102. Example — Amount Mismatch

Internal:

```text id="2z6skp"
amount = 5500 UGX
```

Callback:

```text id="q6c2sj"
amount = 6000 UGX
```

Result:

```text id="a45y2h"
PROCESSING
   |
   v
REQUIRES_RECONCILIATION
```

No automatic ledger posting.

---

# 103. Example — Duplicate Operation

Request A:

```text id="cu3sbd"
Idempotency-Key: PAY-001
```

Request B:

```text id="u4v69m"
Idempotency-Key: PAY-001
```

Same request hash:

```text id="1xv1n3"
Return existing transaction.
```

Different request hash:

```text id="b7y8ja"
409 IDEMPOTENCY_KEY_REUSED
```

---

# 104. Transaction State Machine and Golden Money Path

The state machine forms the control layer inside the Golden Money Path:

```text id="i98r7g"
Business Intent
      |
      v
Transaction INITIATED
      |
      v
PENDING
      |
      v
PROCESSING
      |
      v
Provider/Financial Confirmation
      |
      v
Posting Engine
      |
      v
LEDGER COMMIT
      |
      v
POSTED
      |
      v
Reconciliation / Settlement
```

For errors:

```text id="xeu2jg"
PROCESSING
   |
   +---- FAILED
   |
   +---- UNKNOWN
   |
   +---- REQUIRES_RECONCILIATION
```

For corrections:

```text id="qcegbs"
POSTED
   |
   v
REVERSED
```

---

# 105. State Machine and Financial Ledger Rule

The transaction state machine must never claim:

```text id="jvmfez"
POSTED
```

unless the authoritative ledger posting has committed successfully.

Likewise, the ledger must not silently post a transaction while leaving the transaction state indefinitely at:

```text id="pe4x25"
PROCESSING
```

without a durable recovery strategy.

---

# 106. State Machine and Event Rule

A completion event means:

```text id="yozvku"
state transition committed
```

It does not mean:

```text id="rygkcx"
operation requested
```

This distinction prevents false downstream notifications and reporting.

---

# 107. State Machine and Audit Rule

Every financial state transition must be reconstructable.

An investigator should be able to answer:

```text id="oec5p6"
Who initiated it?
Which tenant?
What was the original state?
What was the new state?
Why did it change?
Which request caused it?
Which provider evidence supported it?
Which financial transaction was posted?
Which journal was created?
Which event was published?
```

---

# 108. State Machine and Reconciliation Rule

The transaction state must not be used to hide reconciliation discrepancies.

Example:

```text id="39mzrj"
Provider SUCCESS
+
Internal FAILED
```

must become:

```text id="taq4xn"
REQUIRES_RECONCILIATION
```

until evidence is resolved.

---

# 109. State Machine and Settlement Rule

Settlement is a separate financial process.

Example:

```text id="b5x8yz"
Transaction = POSTED
Settlement = PENDING
```

is valid.

Later:

```text id="om63ac"
Settlement = COMPLETED
```

must not rewrite the original transaction.

---

# 110. State Machine Storage

Recommended transaction fields:

```text id="i2x7zu"
id
tenantId
transactionReference
transactionType
status
statusVersion
amount
currency
sourceType
sourceId
idempotencyKey
requestHash
provider
providerTransactionId
journalId
correlationId
requestId
createdAt
updatedAt
processedAt
failedAt
cancelledAt
reversedAt
lastErrorCode
lastErrorMessage
version
```

---

# 111. Transition History Storage

Recommended:

```text id="3k0t8f"
transactionId
transitionId
fromState
toState
transitionType
actorId
actorType
reasonCode
reason
requestId
correlationId
createdAt
```

Historical transitions must be append-oriented.

---

# 112. State Machine Repository Constraints

Recommended unique constraints:

```text id="4zv8qt"
tenantId + transactionReference
tenantId + idempotencyKey + transactionType
provider + providerTransactionId
```

The exact uniqueness strategy depends on provider behavior and database capabilities.

---

# 113. State Machine Performance

State transitions should be efficient and bounded.

Avoid:

```text id="l61g7f"
full ledger scan
unbounded event scan
large report generation
external provider wait
```

inside a transition database transaction.

---

# 114. State Machine and Background Jobs

Jobs may handle:

```text id="b2ly5j"
retrying
stale transaction detection
unknown outcome reconciliation
dead-letter recovery
settlement
reconciliation
```

Jobs must use the same state machine and financial services as API requests.

---

# 115. Worker Concurrency

Workers claiming transactions for processing should use:

```text id="y9r6rf"
atomic claim
lease
claimToken
version check
```

A worker losing its claim must not finalize the transaction.

---

# 116. Stale Worker Protection

Example:

```text id="7w0p1s"
Worker A claims transaction
Worker A crashes

Lease expires

Worker B claims transaction
Worker B posts transaction
Worker A resumes
```

Worker A must not be able to post again.

Claim tokens/version checks must prevent stale-worker side effects.

---

# 117. State Machine Lease

Where applicable:

```text id="hi7hii"
claimedBy
claimToken
claimExpiresAt
```

A worker may transition only while its claim is valid.

---

# 118. Transaction Recovery

Recovery algorithm:

```text id="3t1rpl"
1. Load transaction.
2. Validate tenant scope.
3. Validate current state.
4. Inspect version.
5. Inspect idempotency record.
6. Inspect provider state if applicable.
7. Inspect ledger state.
8. Determine valid transition.
9. Execute state transition.
10. Emit event if required.
11. Record audit.
```

---

# 119. Transaction State Machine Testing

Every allowed transition must have:

```text id="wgo2cy"
happy-path test
authorization test
tenant isolation test
idempotency test
concurrency test
invalid transition test
failure test
audit test
event test
```

---

# 120. State Transition Property Tests

The following properties should always hold:

```text id="r6r7uy"
No invalid transition is accepted.
No transition bypasses authorization.
No posted transaction loses its financial history.
No reversal duplicates accounting effects.
No retry duplicates financial posting.
No stale worker can finalize an operation.
No tenant can transition another tenant's transaction.
```

---

# 121. Transaction State Machine Security Checklist

* [ ] Clients cannot directly assign status.
* [ ] State transitions are centralized.
* [ ] Authorization enforced per transition.
* [ ] Tenant scope enforced.
* [ ] Current version checked.
* [ ] Idempotency enforced.
* [ ] Financial posting controlled.
* [ ] Reversal controlled.
* [ ] Audit record created.
* [ ] Events emitted only after commit.
* [ ] Sensitive details redacted.
* [ ] Administrative transitions protected.

---

# 122. Production Readiness Checklist

## State Model

* [ ] Core states defined.
* [ ] Optional operational states defined.
* [ ] All valid transitions documented.
* [ ] Invalid transitions rejected.
* [ ] Terminal states identified.
* [ ] State versioning implemented.

## Financial Integrity

* [ ] `POSTED` requires ledger commit.
* [ ] Financial records immutable after posting.
* [ ] Reversal workflow implemented.
* [ ] Double-entry validation enforced.
* [ ] Closed-period protection implemented.
* [ ] Financial freeze integrated.

## Reliability

* [ ] Idempotency implemented.
* [ ] Concurrency protection implemented.
* [ ] Retry policy implemented.
* [ ] Unknown state supported where required.
* [ ] Reconciliation state supported.
* [ ] Dead-letter recovery implemented.
* [ ] Watchdog for stuck states implemented.

## External Payments

* [ ] Provider status normalized.
* [ ] Callback security integrated.
* [ ] Duplicate callback handling implemented.
* [ ] Amount validation implemented.
* [ ] Currency validation implemented.
* [ ] Reference matching implemented.
* [ ] Out-of-order protection implemented.

## Observability

* [ ] State transition metrics available.
* [ ] State duration measured.
* [ ] Request/correlation IDs propagated.
* [ ] Transition tracing available.
* [ ] Alerts configured.
* [ ] Audit history available.

## Testing

* [ ] Transition unit tests.
* [ ] Integration tests.
* [ ] Concurrency tests.
* [ ] Idempotency tests.
* [ ] Failure injection tests.
* [ ] Provider callback tests.
* [ ] Reversal tests.
* [ ] Recovery tests.
* [ ] Tenant-isolation tests.

---

# 123. Transaction State Machine Invariants

The following invariants are mandatory:

```text id="8o0bpx"
1. A transaction has exactly one authoritative current state.
2. A state can change only through a defined transition.
3. Every material transition is attributable.
4. Every transition is tenant-scoped.
5. Every financial posting transition is idempotent.
6. POSTED means authoritative financial effect exists.
7. REVERSED means an approved compensating effect exists.
8. FAILED means no unauthorized posted financial effect exists.
9. UNKNOWN means the outcome is unresolved, not failed.
10. REQUIRES_RECONCILIATION means automatic finalization is unsafe.
11. State history is append-oriented.
12. Invalid transitions cannot be forced through the API.
13. Stale workers cannot finalize transactions.
14. Events are emitted only after authoritative state commits.
15. Transaction state never replaces ledger truth.
```

---

# 124. Canonical State Machine

```text
                         +----------------------+
                         |      INITIATED       |
                         +----------+-----------+
                                    |
                         +----------+----------+
                         |                     |
                         v                     v
                 +---------------+       +-------------+
                 |    PENDING    |       |  CANCELLED  |
                 +-------+-------+       +-------------+
                         |
                         v
                 +---------------+
                 |  PROCESSING   |
                 +-------+-------+
                         |
          +--------------+--------------+
          |              |              |
          v              v              v
     +---------+     +---------+   +-----------+
     | FAILED  |     | UNKNOWN |   |  POSTED   |
     +----+----+     +----+----+   +-----+-----+
          |               |               |
          |               |               v
          |               |         +-----------+
          |               +-------> | REVERSED  |
          |                         +-----------+
          v
     +----------+
     | RETRYING |
     +----+-----+
          |
          v
      PROCESSING

UNKNOWN
   |
   +------> POSTED
   |
   +------> FAILED
   |
   v
REQUIRES_RECONCILIATION
   |
   +------> POSTED
   |
   +------> FAILED
   |
   +------> REVERSED
```

---

# 125. Final Architecture Rule

> **The transaction state machine is the gatekeeper of workflow state, while the financial ledger is the authority for accounting truth.**

Neither may be bypassed.

The correct relationship is:

```text
Transaction State Machine
          |
          v
Controls when an operation may proceed
          |
          v
Financial Posting Engine
          |
          v
Authoritative Ledger
```

---

# 126. Non-Negotiable Transaction Rule

> **No API endpoint, provider callback, scheduled job, worker, event consumer, administrator, migration, or script may directly assign an arbitrary transaction status or create a financial effect outside the approved transaction state machine and financial posting architecture.**

---

# 127. Related Documentation

This specification must remain synchronized with:

```text
docs/finance/FINANCIAL_LEDGER_SPECIFICATION.md
docs/finance/GOLDEN_MONEY_PATH.md
docs/security/PAYMENT_CALLBACK_SECURITY.md
docs/events/EVENT_CATALOGUE.md
docs/data/DATA_MODEL_CATALOGUE.md
docs/api/API_CATALOGUE.md
docs/api/BACKEND_API_SPECIFICATION.md
docs/02-architecture/SERVICE_CATALOGUE.md
docs/02-architecture/DEPENDENCY_MAP.md
```

---

# 128. Document Metadata

**Document:** `docs/transactions/TRANSACTION_STATE_MACHINE_SPECIFICATION.md`
**Organization:** TITech Community Capital Ltd
**Platform:** Community Savings Platform
**Domain:** Transaction State Management
**Version:** `2.0`
**Status:** Enterprise Production Financial Architecture Standard
**Last Updated:** August 16, 2026

**Primary Example User**

```text id="uqs0u6"
Name: Justine Robert
Email: justine@titech.com
```

## Maintenance Requirement

> Any change to transaction states, state transitions, payment workflows, provider behavior, retry handling, reconciliation behavior, reversal logic, financial posting semantics, or transaction APIs must update this specification together with the corresponding finance, security, data-model, event, service, and API documentation.

## Final Authority

> **Transaction state controls workflow progression. The financial ledger controls accounting truth. A transaction may reach `POSTED` only when its authoritative financial effect has successfully committed; a transaction may reach `REVERSED` only through an approved compensating financial operation.**