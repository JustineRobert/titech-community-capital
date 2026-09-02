# TITech Community Capital Ltd — Golden Money Path

> **System:** Community Savings Platform
> **Document:** `docs/finance/GOLDEN_MONEY_PATH.md`
> **Status:** Enterprise Production Financial Architecture Standard
> **Version:** 2.0
> **Last Updated:** August 16, 2026
> **Domain:** Financial Operations / Payments / Ledger / Reconciliation / Settlement
> **Primary Principle:** Every monetary movement must have one authoritative, traceable, idempotent, auditable financial path.

---

# 1. Purpose

This document defines the **Golden Money Path** for TITech Community Capital Ltd.

The Golden Money Path is the canonical lifecycle through which money-related business operations move from:

```text
Business Intent
      |
      v
Payment / Financial Operation
      |
      v
Provider or Internal Execution
      |
      v
Authoritative Financial Posting
      |
      v
Ledger
      |
      v
Reconciliation
      |
      v
Settlement
      |
      v
Financial Reporting
```

The objective is to ensure that every monetary event is:

* Authorized
* Validated
* Idempotent
* Traceable
* Tenant-scoped
* Double-entry balanced
* Immutable after posting
* Reconciliable
* Observable
* Recoverable
* Auditable

The Golden Money Path applies to:

```text
Member Savings
Contributions
Loan Disbursements
Loan Repayments
Withdrawals
Transfers
Fees
Interest
Refunds
Reversals
Adjustments
Provider Settlements
Write-offs
```

---

# 2. Golden Rule

> **No money enters, leaves, or changes accounting ownership without a controlled financial transaction and an authoritative ledger posting.**

The following pattern is prohibited:

```text
API Request
   |
   v
account.balance += amount
```

The required pattern is:

```text
API / Event / Provider Callback
            |
            v
Financial Operation
            |
            v
Validation + Authorization
            |
            v
Idempotency
            |
            v
Payment / Transaction State
            |
            v
Posting Engine
            |
            v
Balanced Journal
            |
            v
Ledger
            |
            v
Outbox / Events
            |
            v
Reconciliation
```

---

# 3. Golden Money Path Objectives

Every money movement must guarantee:

```text
Correct actor
Correct tenant
Correct operation
Correct amount
Correct currency
Correct account
Correct state
Correct financial period
Correct provider reference
Correct journal
Correct ledger effect
Correct event
Correct audit trail
```

Any missing link is a financial control weakness.

---

# 4. Financial Source of Truth

The authoritative hierarchy is:

```text
                 +----------------------+
                 |     GENERAL LEDGER   |
                 |   AUTHORITATIVE      |
                 +----------+-----------+
                            |
            +---------------+----------------+
            |                                |
            v                                v
     Financial Transaction             Journal/Entries
            |                                |
            +---------------+----------------+
                            |
                            v
                    Balance Projections
                            |
                            v
                 Reports / Dashboards
```

External providers are evidence sources.

They are not the internal accounting source of truth.

The provider tells the platform what happened externally.

The ledger records the authoritative internal accounting effect.

---

# 5. Golden Money Path Architecture

```text
+------------------+
| User / Admin /   |
| Scheduled Job /  |
| Provider Callback|
+--------+---------+
         |
         v
+--------------------------+
| API / Event / Callback   |
| Security Boundary        |
+------------+-------------+
             |
             v
+--------------------------+
| Authentication           |
| Authorization            |
| Tenant Resolution        |
| Request Validation       |
+------------+-------------+
             |
             v
+--------------------------+
| Financial Operation      |
| + Idempotency            |
| + Concurrency Control    |
+------------+-------------+
             |
             +--------------------+
             |                    |
             v                    v
+------------------+     +----------------------+
| Payment / Loan / |     | Provider / External  |
| Contribution     |     | Execution            |
| Domain State     |     +----------+-----------+
+---------+--------+                |
          |                         |
          +------------+------------+
                       |
                       v
              +-------------------+
              | Posting Engine    |
              +---------+---------+
                        |
                        v
              +-------------------+
              | Journal Service   |
              +---------+---------+
                        |
                        v
              +-------------------+
              | Double-Entry      |
              | Ledger            |
              +---------+---------+
                        |
             +----------+-----------+
             |                      |
             v                      v
      +-------------+       +---------------+
      | Balance     |       | Outbox/Event  |
      | Projection  |       | Publication   |
      +-------------+       +-------+-------+
                                    |
                                    v
                         +--------------------+
                         | Reconciliation /   |
                         | Settlement         |
                         +----------+---------+
                                    |
                                    v
                         +--------------------+
                         | Financial Reports  |
                         | Audit / Analytics   |
                         +--------------------+
```

---

# 6. Golden Money Path Stages

Every financial operation should conceptually pass through these stages:

```text
1. IDENTIFY
2. AUTHORIZE
3. VALIDATE
4. IDEMPOTENTLY REGISTER
5. INITIATE
6. EXECUTE
7. CONFIRM
8. POST
9. COMMIT
10. PUBLISH
11. RECONCILE
12. SETTLE
13. REPORT
```

Not every operation uses an external provider.

Internal-only operations still pass through the financial posting and ledger stages.

---

# 7. Stage 1 — Identify

The system must identify:

```text
userId
tenantId
groupId where applicable
operationType
sourceType
sourceId
amount
currency
```

Example:

```json
{
  "tenantId": "tenant_01J...",
  "userId": "user_01J...",
  "groupId": "group_01J...",
  "operationType": "loan_repayment",
  "amount": "5500.00",
  "currency": "UGX"
}
```

The source entity must exist and belong to the correct tenant.

---

# 8. Stage 2 — Authorize

The platform verifies:

```text
Identity
Role
Permission
Tenant scope
Resource ownership
Operation eligibility
Account restrictions
```

Examples:

```text
Member -> may initiate permitted repayment
Finance Officer -> may perform authorized financial operations
Admin -> may approve permitted administrative operations
System Worker -> may execute assigned workflow
Provider Callback -> must pass provider signature verification
```

Authorization must happen before any financial side effect.

---

# 9. Stage 3 — Validate

Validation must cover both technical and business rules.

## Technical Validation

```text
Valid identifier
Valid amount
Valid currency
Valid request schema
Valid enum values
Valid timestamps
```

## Financial Validation

```text
Account exists
Account active
Currency supported
Financial period open
Operation allowed
Source resource valid
Amount permitted
Loan state valid
Contribution state valid
Payment state valid
```

## Policy Validation

```text
Transaction limits
Tenant limits
Risk restrictions
Compliance restrictions
Fraud controls
Operational freezes
```

---

# 10. Stage 4 — Idempotently Register

Before executing a retry-sensitive operation, establish a unique logical operation identity.

Recommended:

```text
tenantId
+
operationType
+
idempotencyKey
```

Example:

```text
tenant_001
+
loan_repayment
+
repayment-20260816-000001
```

Store:

```text
idempotencyKey
requestHash
operation
status
resourceId
createdAt
expiresAt
```

A duplicate request must resolve to the original logical operation.

---

# 11. Stage 5 — Initiate

The platform records the operation as initiated.

Example:

```text
Payment
status = initiated
```

or:

```text
FinancialTransaction
status = initiated
```

At this stage:

```text
No posted ledger entry yet.
```

This distinction is critical.

---

# 12. Stage 6 — Execute

Execution depends on the money path.

Possible destinations:

```text
MTN MoMo
Airtel Money
Bank
Internal Ledger Transfer
Cash Clearing Workflow
```

The execution boundary must not create duplicate financial effects on retry.

---

# 13. Provider Execution Rule

External providers must be accessed through provider adapters.

Conceptual architecture:

```text
Financial Operation
      |
      v
Payment Service
      |
      v
Provider Adapter
      |
      +---- MTN Adapter
      |
      +---- Airtel Adapter
      |
      +---- Bank Adapter
```

Provider-specific logic must not be embedded directly in financial posting logic.

---

# 14. Stage 7 — Confirm

The system determines the authoritative outcome.

External payment operations may receive:

```text
success
failure
pending
timeout
unknown
```

A timeout is not automatically a failure.

---

# 15. Unknown Outcome Rule

If:

```text
request sent
+
provider timeout
```

the system must not blindly retry with a new logical transaction.

Instead:

```text
Query provider status
        |
        v
Check existing payment state
        |
        v
Inspect callback state
        |
        v
Determine authoritative outcome
```

Only then should the operation proceed.

This prevents duplicate payments and duplicate loan disbursements.

---

# 16. Provider Callback Path

The canonical callback flow is:

```text
Provider
   |
   v
Callback Endpoint
   |
   v
Request Identification
   |
   v
Signature Validation
   |
   v
Schema Validation
   |
   v
Provider Event Deduplication
   |
   v
Payload Normalization
   |
   v
Payment Lookup
   |
   v
State Validation
   |
   v
Financial Processing
```

Never trust a provider callback solely because it reached the endpoint.

---

# 17. Stage 8 — Post

Once the financial result is authoritative, the Posting Engine creates the accounting effect.

The Posting Engine must:

```text
Validate account mapping
Validate currency
Validate period
Validate transaction state
Construct journal
Validate debit/credit equality
Persist journal
Persist entries
Link financial transaction
```

---

# 18. Golden Ledger Posting Rule

For every posted journal:

```text
TOTAL DEBITS = TOTAL CREDITS
```

Example:

```text
Debit   Cash / Payment Clearing     5,500 UGX
Credit  Loan Principal Receivable   4,500 UGX
Credit  Interest Income             1,000 UGX
```

Therefore:

```text
Debits  = 5,500
Credits = 5,500
```

---

# 19. Stage 9 — Commit

The following must be committed consistently within the appropriate transaction boundary:

```text
Financial Transaction
Journal
Journal Entries
Required balance projection/update
Idempotency state
Outbox Event
Required audit record
```

Where database transactions are available, they should be used.

---

# 20. Commit Boundary Rule

Do not publish a financial-completion event before the authoritative financial state commits.

Correct:

```text
BEGIN
  Persist transaction
  Persist journal
  Persist journal entries
  Persist audit
  Persist outbox event
COMMIT
       |
       v
Publish Event
```

Incorrect:

```text
Publish PaymentCompleted
       |
       v
Try to post ledger
```

The latter can create a false financial fact.

---

# 21. Stage 10 — Publish

After commit, the outbox publisher publishes the domain/integration event.

Example:

```text
FinancialTransactionPosted
PaymentCompleted
LoanDisbursed
LoanPaymentRecorded
ContributionPosted
```

The event must reference:

```text
transactionId
journalId where appropriate
aggregateId
tenantId
correlationId
```

---

# 22. Outbox Pattern

Canonical implementation:

```text
Application Transaction
        |
        +---- Business State
        |
        +---- Ledger State
        |
        +---- Audit
        |
        +---- Outbox Event
        |
       COMMIT
        |
        v
Outbox Worker
        |
        v
Event Bus
```

This prevents:

```text
Database committed
+
event lost
```

---

# 23. Stage 11 — Reconcile

After execution and posting, the operation is reconciled where external evidence exists.

For payment providers:

```text
Provider Transaction
        |
        v
Internal Payment
        |
        v
Financial Transaction
        |
        v
Ledger
```

All sides should converge.

---

# 24. Reconciliation Rule

A successful reconciliation should establish:

```text
External amount
=
Internal amount
=
Ledger amount
```

and:

```text
External currency
=
Internal currency
=
Ledger currency
```

where the same transaction is being reconciled.

---

# 25. Settlement

Settlement moves money from provider/clearing state into the actual operational cash/bank account.

Conceptually:

```text
Customer
   |
   v
Provider
   |
   v
Provider Clearing
   |
   v
Settlement
   |
   v
Bank / Cash Account
```

Settlement must be separately traceable from the customer transaction.

---

# 26. Clearing vs Settlement

These are not equivalent.

## Clearing

Represents:

```text
money acknowledged or expected
```

## Settlement

Represents:

```text
money moved/settled between financial institutions or provider accounts
```

The platform must not assume successful payment equals settlement.

---

# 27. Golden Money Paths

The following canonical money paths must be supported.

---

# 28. Member Contribution Golden Path

```text
Member
  |
  v
Contribution Request
  |
  v
Authentication
  |
  v
Group Membership Validation
  |
  v
Contribution Validation
  |
  v
Idempotency
  |
  v
Payment Initiation
  |
  v
Provider
  |
  v
Payment Confirmation
  |
  v
Financial Transaction
  |
  v
Journal
  |
  +---- Debit Cash/Clearing
  |
  +---- Credit Member Savings Liability
  |
  v
Ledger Commit
  |
  v
Contribution Posted
  |
  v
Event
  |
  v
Reconciliation
  |
  v
Settlement
```

---

# 29. Contribution Accounting Example

For a UGX 50,000 contribution:

```text
Debit   Cash / Payment Clearing      50,000 UGX
Credit  Member Savings Liability     50,000 UGX
```

The actual chart-of-accounts mapping must be tenant/accounting-policy driven.

---

# 30. Contribution Failure Path

```text
Contribution Initiated
        |
        v
Payment Failed
        |
        v
Contribution Failed
```

No posted contribution ledger effect should exist unless the financial transaction actually posted.

---

# 31. Contribution Reversal Path

```text
Original Contribution
        |
        v
Approved Reversal
        |
        v
Compensating Journal
        |
        v
Contribution Reversed
        |
        v
Audit + Event
```

Original records remain immutable.

---

# 32. Loan Disbursement Golden Path

```text
Loan Application
      |
      v
Eligibility
      |
      v
Approval
      |
      v
Disbursement Authorization
      |
      v
Idempotency Registration
      |
      v
Payment Initiation
      |
      v
Provider
      |
      v
Provider Confirmation
      |
      v
Financial Transaction
      |
      v
Journal
      |
      +---- Debit Loan Receivable
      |
      +---- Credit Cash/Clearing
      |
      v
Ledger Commit
      |
      v
Loan Disbursed
      |
      v
Event Publication
      |
      v
Settlement/Reconciliation
```

---

# 33. Loan Disbursement Accounting Example

UGX 30,000 disbursement:

```text
Debit   Loan Receivable        30,000 UGX
Credit  Cash / Clearing        30,000 UGX
```

If provider clearing is involved:

```text
Credit  Mobile Money Clearing  30,000 UGX
```

and the eventual settlement moves the clearing amount to the actual bank/cash account.

---

# 34. Loan Repayment Golden Path

```text
Borrower
   |
   v
Repayment Request
   |
   v
Loan State Validation
   |
   v
Amount Validation
   |
   v
Idempotency
   |
   v
Payment
   |
   v
Provider
   |
   v
Confirmation
   |
   v
Repayment Allocation
   |
   v
Financial Transaction
   |
   v
Balanced Journal
   |
   +---- Debit Cash/Clearing
   +---- Credit Principal Receivable
   +---- Credit Interest Income
   +---- Credit Fees, if applicable
   |
   v
Ledger
   |
   v
Loan Balance Update
   |
   v
LoanPaymentRecorded
   |
   v
Reconciliation
```

---

# 35. Repayment Allocation

The allocation engine must follow the configured loan policy.

Potential components:

```text
principal
interest
fees
penalties
```

Example:

```text
Payment = 5,500 UGX

Principal = 4,500
Interest  = 1,000
Fees      = 0
```

Total:

```text
5,500 UGX
```

---

# 36. Loan Repayment Partial Payment

A partial repayment may result in:

```text
Installment = partially_paid
Loan = active
Payment = successful
FinancialTransaction = posted
```

The loan schedule must remain consistent with the ledger-derived financial state.

---

# 37. Loan Repayment Failure

```text
Repayment Initiated
       |
       v
Payment Failed
       |
       v
Repayment Not Posted
```

Do not create a successful repayment ledger entry for a failed payment.

---

# 38. Loan Disbursement Unknown Outcome

```text
Disbursement Requested
       |
       v
Provider Request Sent
       |
       v
Timeout
       |
       v
UNKNOWN
       |
       +---- Provider says SUCCESS
       |          |
       |          v
       |     Continue authoritative path
       |
       +---- Provider says FAILED
       |          |
       |          v
       |     Mark failed
       |
       +---- Provider still PENDING
                  |
                  v
             Await / Reconcile
```

Do not issue a second disbursement request under a new idempotency key merely because the original request timed out.

---

# 39. Withdrawal Golden Path

```text
Withdrawal Request
      |
      v
Authorization
      |
      v
Available Balance Check
      |
      v
Risk/Policy Validation
      |
      v
Reservation
      |
      v
Payment Initiation
      |
      v
Provider
      |
      v
Confirmation
      |
      v
Financial Posting
      |
      +---- Debit Member Liability/Account
      +---- Credit Cash/Clearing
      |
      v
Ledger
      |
      v
Reservation Release
      |
      v
Settlement
```

The reservation must prevent concurrent withdrawals from consuming the same available funds.

---

# 40. Internal Transfer Golden Path

An internal transfer does not necessarily require an external payment provider.

```text
Transfer Request
      |
      v
Authorization
      |
      v
Source Account Validation
      |
      v
Destination Account Validation
      |
      v
Funds Validation
      |
      v
Idempotency
      |
      v
Balanced Journal
      |
      +---- Debit Destination/Source-side Account
      +---- Credit Source Account
      |
      v
Ledger Commit
      |
      v
Transfer Completed
```

Both sides must commit atomically.

---

# 41. Refund Golden Path

```text
Original Payment
      |
      v
Refund Request
      |
      v
Validate Original Transaction
      |
      v
Validate Refund Amount
      |
      v
Idempotency
      |
      v
Refund Provider Operation
      |
      v
Provider Confirmation
      |
      v
Compensating Financial Posting
      |
      v
Ledger
      |
      v
RefundCompleted
      |
      v
Reconciliation
```

A refund must be linked to the original payment.

---

# 42. Payment Reversal Golden Path

```text
Successful Payment
      |
      v
Reversal Request
      |
      v
Authorization
      |
      v
Validate Reversible State
      |
      v
Provider Reversal where required
      |
      v
Compensating Journal
      |
      v
PaymentReversed
      |
      v
Reconciliation
```

The original payment remains immutable.

---

# 43. Fee Golden Path

```text
Fee Assessment
      |
      v
Fee Validation
      |
      v
Financial Transaction
      |
      v
Journal
      |
      +---- Debit Customer Receivable/Cash
      +---- Credit Fee Income
      |
      v
Ledger
      |
      v
FeeRecognized
```

---

# 44. Interest Accrual Golden Path

```text
Loan
 |
 v
Accrual Period
 |
 v
Principal / Contract Data
 |
 v
Interest Calculation
 |
 v
Validation
 |
 v
Idempotency
 |
 v
Journal
 |
 +---- Debit Interest Receivable
 +---- Credit Interest Income
 |
 v
Ledger
 |
 v
InterestAccrued
```

Accruals must be idempotent by:

```text
loanId
+
accrualPeriod
+
calculationVersion
```

where appropriate.

---

# 45. Interest Collection Path

Accrued interest and collected interest are distinct concepts.

```text
Interest Accrued
      |
      v
Interest Receivable
      |
      v
Repayment Received
      |
      v
Interest Allocation
      |
      v
Receivable Cleared
```

Do not recognize the same interest twice.

---

# 46. Write-Off Golden Path

```text
Loan Default / Approved Write-Off Candidate
              |
              v
Write-Off Assessment
              |
              v
Authorization
              |
              v
Approval
              |
              v
Financial Posting
              |
              +---- Debit Bad Debt Expense
              +---- Credit Loan Receivable
              |
              v
Ledger
              |
              v
Loan Written Off
              |
              v
Event + Audit
```

Write-off does not mean deletion.

---

# 47. Settlement Golden Path

```text
Provider Transactions
       |
       v
Settlement File / Report
       |
       v
Statement Import
       |
       v
Normalization
       |
       v
Reconciliation
       |
       v
Matched Transactions
       |
       v
Settlement Journal
       |
       +---- Debit Bank/Cash
       +---- Credit Provider Clearing
       |
       v
Ledger
       |
       v
Settlement Completed
```

---

# 48. Statement-to-Ledger Path

```text
External Statement
       |
       v
Statement Import
       |
       v
Normalization
       |
       v
Validation
       |
       v
Processing Batch
       |
       v
Transaction Matching
       |
       +---- MATCH
       |
       +---- EXCEPTION
                  |
                  v
              Investigation
                  |
                  v
                Repair
                  |
                  v
            Ledger Adjustment
```

---

# 49. Golden Reconciliation Path

```text
Internal Record
     |
     +------------------+
     |                  |
     v                  v
External Record     Ledger Record
     |                  |
     +--------+---------+
              |
              v
        Matching Engine
              |
       +------+------+ 
       |             |
       v             v
    MATCH        EXCEPTION
       |             |
       v             v
   Reconciled     Investigation
                     |
                     v
                   Repair
                     |
                     v
                 Reconcile
```

---

# 50. Reconciliation Evidence

Every match should preserve:

```text
internalTransactionId
externalTransactionId
source
matchingMethod
amount
currency
matchTimestamp
operator/system
confidence where applicable
```

---

# 51. Financial Repair Path

```text
Exception
    |
    v
Investigate
    |
    v
Determine Cause
    |
    +---- Data Issue
    |
    +---- Provider Issue
    |
    +---- Internal Processing Issue
    |
    +---- True Financial Difference
             |
             v
      Repair Instruction
             |
             v
          Approval
             |
             v
        Ledger Adjustment
             |
             v
         Reconcile
             |
             v
         Close Exception
```

---

# 52. Golden Money Path — Failure Philosophy

A failed operation must fail safely.

The system must prefer:

```text
unknown
pending
exception
retry
reconcile
```

over:

```text
guess
duplicate
silently overwrite
```

---

# 53. Golden Money Path — Duplicate Philosophy

Every retry must be evaluated as:

```text
same logical operation?
```

not merely:

```text
new HTTP request?
```

Example:

```text
Request A
Idempotency Key = PAY-001

Network timeout

Retry A
Idempotency Key = PAY-001
```

This is the same logical operation.

---

# 54. Golden Money Path — Concurrency Philosophy

Concurrent operations must not create contradictory financial state.

Example:

```text
Two repayment requests
        |
        v
Same idempotency key
        |
        v
One financial effect
```

For different legitimate operations:

```text
Operation A
Operation B
```

the platform must still enforce balance/loan/account concurrency rules.

---

# 55. Account Reservation Path

For operations that require available-funds protection:

```text
Available Balance
      |
      v
Reserve
      |
      v
Execute
      |
      +---- SUCCESS -> Consume Reservation
      |
      +---- FAILURE -> Release Reservation
```

Reservations must have:

```text
reservationId
accountId
amount
currency
operationId
status
expiresAt
```

---

# 56. Reservation States

```text
PENDING
ACTIVE
CONSUMED
RELEASED
EXPIRED
CANCELLED
```

Expired reservations must not permanently reduce availability.

---

# 57. Financial State vs Operational State

The platform must clearly distinguish:

## Financial State

```text
POSTED
REVERSED
```

## Operational State

```text
INITIATED
PROCESSING
PENDING
FAILED
RETRYING
```

For example:

```text
Payment = PROCESSING
FinancialTransaction = NOT_POSTED
```

is valid.

But:

```text
Payment = FAILED
FinancialTransaction = POSTED
```

may indicate a serious state inconsistency depending on the operation and must be reconciled.

---

# 58. Golden Money Path Data Trace

Every transaction should be traceable:

```text
requestId
    |
    v
correlationId
    |
    v
operationId
    |
    v
paymentId / loanId / contributionId
    |
    v
financialTransactionId
    |
    v
journalId
    |
    v
journalEntryIds
    |
    v
accountIds
    |
    v
providerReference
    |
    v
settlementReference
    |
    v
auditEventId
    |
    v
eventId
```

The exact fields present depend on the operation.

---

# 59. Golden Money Path Audit Trail

For every material operation record:

```text
who
what
when
tenant
amount
currency
source
destination
provider
status
reason
requestId
correlationId
idempotencyKey
transactionId
journalId
```

Sensitive secrets are excluded.

---

# 60. Golden Money Path Event Sequence

Example contribution:

```text
ContributionInitiated
        |
        v
PaymentInitiated
        |
        v
PaymentCompleted
        |
        v
FinancialTransactionPosted
        |
        v
JournalPosted
        |
        v
ContributionPosted
        |
        v
ReconciliationCompleted
```

The actual event order must follow the authoritative transaction boundaries in the implementation.

---

# 61. Golden Money Path Event Rules

Never emit:

```text
PaymentCompleted
```

before the payment has actually reached the completed business state.

Never emit:

```text
FinancialTransactionPosted
```

before the ledger posting commits.

Never emit:

```text
LoanDisbursed
```

before the loan is actually marked disbursed according to the authoritative workflow.

---

# 62. Event Replay Rule

Replaying an event must not recreate a monetary side effect.

Example:

```text
PaymentCompleted event replay
```

should allow:

```text
notifications rebuild
analytics rebuild
projection rebuild
```

but must not cause:

```text
another ledger posting
```

unless an explicitly controlled repair workflow is executing.

---

# 63. Golden Money Path and Event Consumers

Consumers may perform:

```text
Notification
Reporting
Analytics
Risk evaluation
Reconciliation
Search indexing
Audit projection
```

Consumers must not independently create competing financial truth.

A financial side effect triggered from an event must still call the approved financial services.

---

# 64. Golden Money Path Security Boundary

Every money path begins at a security boundary:

```text
Authentication
      |
      v
Authorization
      |
      v
Tenant Resolution
      |
      v
Financial Operation
```

Provider callbacks have a different boundary:

```text
Provider Signature
      |
      v
Callback Authentication
      |
      v
Normalization
      |
      v
Idempotency
      |
      v
Financial Operation
```

---

# 65. Golden Money Path Compliance Boundary

Where required, financial operations must pass through:

```text
KYC
AML
Risk
Fraud Controls
Transaction Limits
Regulatory Controls
```

The exact placement depends on the product and transaction type.

---

# 66. Fraud Detection Integration

For higher-risk operations:

```text
Payment Request
      |
      v
Risk/Fraud Assessment
      |
      +---- ACCEPT
      |
      +---- REVIEW
      |
      +---- BLOCK
```

A block must prevent the prohibited financial operation from posting.

---

# 67. Financial Limit Enforcement

Limits may exist at:

```text
User
Group
Tenant
Provider
Payment rail
Transaction type
Daily period
Monthly period
```

Limits must be evaluated server-side.

---

# 68. Currency Conversion Path

Where multi-currency is supported:

```text
Source Amount
    |
    v
FX Rate Selection
    |
    v
Rate Validation
    |
    v
Converted Amount
    |
    v
Multi-Currency Journal
```

Record:

```text
rate
rateSource
rateTimestamp
sourceCurrency
targetCurrency
sourceAmount
targetAmount
```

---

# 69. Golden Money Path for FX

FX is not a simple multiplication.

It must define:

```text
pricing source
spread
rounding
effective time
rate validity
currency pair
```

All relevant data must be reproducible for audit.

---

# 70. Fees in the Golden Path

Fees must be explicit financial operations.

Example:

```text
Transaction
   |
   +---- Principal/Amount
   |
   +---- Fee
```

Do not silently subtract fees from customer balances without a corresponding accounting entry.

---

# 71. Tax Treatment

Where applicable, tax may require separate accounting entries.

Example:

```text
Debit   Customer Receivable / Cash
Credit  Revenue
Credit  Tax Payable
```

Tax treatment must be defined by the applicable accounting/compliance policy.

---

# 72. Golden Money Path and Notifications

Notifications are downstream of authoritative financial state.

Correct:

```text
Ledger Commit
    |
    v
PaymentCompleted
    |
    v
NotificationCreated
```

Incorrect:

```text
Payment Request
    |
    v
"You have successfully paid"
```

before payment completion is confirmed.

---

# 73. Golden Money Path and Reporting

Reports must consume:

```text
ledger
+
controlled projections
```

not transient API request state.

Example:

```text
Loan Dashboard
    |
    v
Financial Reporting Projection
    |
    v
Ledger-derived data
```

---

# 74. Golden Money Path and Data Model

Primary entities:

```text
Payment
FinancialTransaction
Journal
JournalEntry
Account
BalanceSnapshot
Settlement
ReconciliationRun
ReconciliationException
AuditEvent
OutboxEvent
```

Business entities:

```text
Contribution
Loan
LoanRepayment
Statement
ProviderTransaction
```

---

# 75. Golden Money Path — Transaction Invariants

For a posted transaction:

```text
transaction.status = POSTED
```

must imply:

```text
journal exists
journal.status = POSTED
journal is balanced
journal entries exist
accounts are valid
tenant scope is correct
currency is correct
audit exists where required
outbox event exists where required
```

---

# 76. Golden Money Path — Reversed Transaction Invariants

For a reversed transaction:

```text
originalTransaction.status = REVERSED
```

must imply:

```text
reversal transaction exists
reversal journal exists
reversal journal is balanced
original transaction remains intact
reversal references original
audit exists
event exists where required
```

---

# 77. Golden Money Path — Failed Transaction Invariants

For a failed transaction:

```text
transaction.status = FAILED
```

must imply that no unapproved posted financial effect remains.

If a provider reports success after an internal failure, reconciliation must resolve the discrepancy.

---

# 78. Golden Money Path — Settlement Invariants

A settled operation must have:

```text
provider reference
settlement reference
internal transaction reference
ledger reference
reconciliation status
```

where those concepts exist for the applicable payment rail.

---

# 79. Operational Recovery Matrix

| Situation              | Required Action                    |
| ---------------------- | ---------------------------------- |
| API timeout            | Query operation state              |
| Provider timeout       | Query provider/status before retry |
| Duplicate callback     | Deduplicate                        |
| Duplicate API request  | Return existing idempotent result  |
| Ledger posting failure | No completed financial event       |
| Event publish failure  | Retry outbox                       |
| Consumer failure       | Retry consumer                     |
| Dead-letter event      | Controlled recovery                |
| Settlement mismatch    | Reconciliation exception           |
| Balance mismatch       | Integrity investigation            |
| Unknown payment state  | Provider + internal reconciliation |
| Duplicate settlement   | Block/reconcile before posting     |

---

# 80. No-Silent-Repair Rule

The following are prohibited:

```text
Silently editing a transaction amount
Silently overwriting a balance
Silently deleting a duplicate
Silently changing a journal entry
Silently moving money between accounts
Silently re-running a failed payment
```

Every correction must produce a traceable operation.

---

# 81. Operational Idempotency Layers

Idempotency should exist across:

```text
HTTP
Payment Service
Provider Adapter
Callback Handler
Financial Transaction
Posting Engine
Settlement Processor
Reconciliation Repair
Event Consumer
```

Each layer should protect the side effect it owns.

---

# 82. Golden Money Path Observability

Track:

```text
money_operations_total
money_operations_success_total
money_operations_failed_total
money_operations_unknown_total
money_operations_reversed_total
money_operations_duration_seconds
financial_postings_total
financial_posting_failures_total
financial_posting_reversals_total
duplicate_money_operations_total
provider_callback_duplicates_total
settlement_mismatches_total
ledger_integrity_failures_total
```

---

# 83. Golden Money Path Tracing

Recommended span structure:

```text
HTTP Request
 |
 +-- Authentication
 |
 +-- Authorization
 |
 +-- Financial Operation
      |
      +-- Idempotency
      |
      +-- Provider Operation
      |
      +-- Posting Engine
            |
            +-- Journal
            |
            +-- Ledger
      |
      +-- Outbox
      |
      +-- Reconciliation
```

Use:

```text
traceId
spanId
requestId
correlationId
transactionId
```

Do not include financial secrets or sensitive PII unnecessarily.

---

# 84. Golden Money Path Audit Event

Example:

```json
{
  "auditId": "audit_01J...",
  "tenantId": "tenant_01J...",
  "actorId": "user_01J...",
  "action": "LOAN_PAYMENT_POSTED",
  "resourceType": "FinancialTransaction",
  "resourceId": "txn_01J...",
  "amount": "5500.00",
  "currency": "UGX",
  "requestId": "req_01J...",
  "correlationId": "corr_01J...",
  "outcome": "success",
  "createdAt": "2026-08-16T00:31:00.000Z"
}
```

---

# 85. Golden Money Path API Pattern

A financial mutation API should conceptually follow:

```http
POST /api/financial-operation
Authorization: Bearer <accessToken>
Idempotency-Key: <unique-key>
X-Request-ID: <request-id>
Content-Type: application/json
```

Request:

```json
{
  "amount": "5500.00",
  "currency": "UGX",
  "sourceId": "loan_01J..."
}
```

The API should return operation state, not pretend completion before completion is authoritative.

---

# 86. Asynchronous Financial Operations

Some operations may return:

```http
202 Accepted
```

Example:

```json
{
  "success": true,
  "message": "Payment processing initiated",
  "data": {
    "paymentId": "payment_01J...",
    "status": "processing"
  }
}
```

The client then retrieves status.

---

# 87. Financial Status Query

Recommended:

```http
GET /api/payments/:paymentId
Authorization: Bearer <accessToken>
```

or:

```http
GET /api/finance/transactions/:transactionId
Authorization: Bearer <accessToken>
```

Clients must rely on the authoritative status rather than local assumptions.

---

# 88. Golden Money Path Performance

The request path should avoid holding a database transaction open while waiting for external providers.

Preferred:

```text
Create operation
      |
      v
Commit pending state
      |
      v
Call provider
      |
      v
Process callback/status
      |
      v
Post financial effect
```

The exact implementation may differ for synchronous provider capabilities, but the principle remains:

> **Do not make long-running external dependencies part of an unnecessarily long database transaction.**

---

# 89. Financial Transaction Lifecycle

Canonical:

```text
INITIATED
   |
   v
PENDING
   |
   v
PROCESSING
   |
   +----> FAILED
   |
   v
POSTED
   |
   +----> REVERSED
```

Invalid transitions must be rejected.

---

# 90. Golden Money Path and Closed Periods

If the intended posting period is closed:

```text
Reject posting
```

or route through:

```text
approved adjustment process
```

Do not silently force a closed-period posting.

---

# 91. Golden Money Path and Financial Freeze

If a financial freeze applies:

```text
Request
   |
   v
Freeze Check
   |
   +---- ACTIVE -> proceed
   |
   +---- FROZEN -> block
```

Blocking must return an explicit business error.

Example:

```json
{
  "success": false,
  "error": {
    "code": "FINANCIAL_FREEZE_ACTIVE",
    "message": "This financial operation is temporarily unavailable."
  }
}
```

---

# 92. Golden Money Path and Compliance

Before financial execution, where applicable:

```text
KYC status
AML status
Risk level
Transaction limits
Sanctions/other screening
```

must be evaluated according to policy.

Compliance failure must prevent the prohibited financial operation from posting.

---

# 93. Golden Money Path and Fraud

For risk-sensitive operations:

```text
Transaction
    |
    v
Fraud/Risk Evaluation
    |
    +---- CLEAR -> Continue
    |
    +---- REVIEW -> Hold
    |
    +---- BLOCK -> Reject
```

A risk engine must not directly modify the ledger.

It provides a decision to the financial workflow.

---

# 94. Golden Money Path and Notifications

Notification failure must not reverse a successful financial operation.

Example:

```text
Ledger Posted
   |
   v
PaymentCompleted
   |
   +---- Notification succeeds
   |
   +---- Notification fails -> retry/dead-letter
```

Financial state remains authoritative.

---

# 95. Golden Money Path and Analytics

Analytics consumers may lag.

The financial API must not wait for:

```text
analytics
dashboards
search
notifications
```

before committing authoritative financial state.

---

# 96. Golden Money Path and Event Replay

Replay may rebuild:

```text
analytics
projections
notifications
```

but must not blindly repeat:

```text
ledger posting
external payment
loan disbursement
provider settlement
```

---

# 97. Golden Money Path and Manual Operations

Manual financial operations must use approved tools/services.

A manual operator must not:

```text
edit MongoDB records directly
update balances manually
delete journal entries
rewrite provider references
```

without a controlled financial adjustment mechanism.

---

# 98. Golden Money Path and Scripts

Administrative scripts that create or change financial state must:

```text
authenticate
authorize
use domain services
enforce idempotency
create audit record
use financial posting engine
```

Raw database mutation scripts are not an approved financial workflow.

---

# 99. Golden Money Path Deployment Controls

Changes affecting the money path require:

```text
unit tests
integration tests
financial integrity tests
concurrency tests
idempotency tests
provider integration tests
reconciliation tests
rollback/recovery tests
observability validation
```

---

# 100. Golden Money Path Release Gate

A money-path release must not proceed if any of the following are unresolved:

```text
unbalanced journal
ledger integrity failure
duplicate posting defect
broken reversal
broken idempotency
unreconciled material settlement issue
missing audit trail
tenant-isolation defect
financial event ordering defect
```

---

# 101. Golden Money Path Incident Response

For a suspected financial integrity incident:

```text
1. Identify affected transactions.
2. Freeze affected operation types if required.
3. Preserve logs/events/audit evidence.
4. Query provider state.
5. Query internal financial state.
6. Reconcile.
7. Determine authoritative outcome.
8. Execute controlled repair.
9. Reconcile again.
10. Release freeze.
11. Record incident evidence.
12. Implement preventive controls.
```

---

# 102. Financial Integrity Incident Priority

Suggested classification:

```text
SEV-1
Ledger integrity or systemic duplicate money movement

SEV-2
Material multi-transaction discrepancy

SEV-3
Isolated financial discrepancy

SEV-4
Non-material operational inconsistency
```

The exact severity threshold should be defined by operational policy.

---

# 103. Golden Money Path Operational Dashboard

Operations should be able to see:

```text
Active Financial Operations
Pending Payments
Unknown Payment Outcomes
Posted Transactions
Failed Transactions
Reversed Transactions
Ledger Posting Failures
Unbalanced Journals
Settlement Differences
Reconciliation Exceptions
Dead-Letter Financial Events
Financial Freeze State
```

---

# 104. Golden Money Path Integrity Dashboard

The dashboard should expose:

```text
Total Debits
Total Credits
Unbalanced Journals
Balance Mismatches
Pending Transactions
Unknown Outcomes
Unreconciled Provider Transactions
Unresolved Exceptions
```

---

# 105. Golden Money Path Security Dashboard

Monitor:

```text
Financial Authorization Failures
Duplicate Requests
Idempotency Conflicts
Suspicious Retry Patterns
Provider Signature Failures
Unexpected Tenant Access
Rate-Limit Violations
Manual Financial Adjustments
```

---

# 106. Golden Money Path Non-Negotiable Invariants

## Invariant 1

```text
A posted financial transaction must have a balanced journal.
```

## Invariant 2

```text
A duplicated logical request must not create a duplicated financial effect.
```

## Invariant 3

```text
A financial event must not claim a state before the authoritative state exists.
```

## Invariant 4

```text
A posted financial record must not be edited to correct history.
```

## Invariant 5

```text
An external provider response must be reconciled to internal financial state.
```

## Invariant 6

```text
A financial correction must remain traceable to its source.
```

## Invariant 7

```text
A tenant may never affect another tenant's financial records.
```

## Invariant 8

```text
An unknown provider outcome must not trigger an unverified duplicate transaction.
```

---

# 107. Golden Money Path Reference Sequence

The canonical enterprise sequence is:

```text
                 GOLDEN MONEY PATH

      +----------------------------+
      | 1. BUSINESS INTENT         |
      +-------------+--------------+
                    |
                    v
      +----------------------------+
      | 2. AUTHENTICATE/AUTHORIZE  |
      +-------------+--------------+
                    |
                    v
      +----------------------------+
      | 3. TENANT + POLICY CHECK   |
      +-------------+--------------+
                    |
                    v
      +----------------------------+
      | 4. VALIDATE                |
      +-------------+--------------+
                    |
                    v
      +----------------------------+
      | 5. IDEMPOTENCY             |
      +-------------+--------------+
                    |
                    v
      +----------------------------+
      | 6. INITIATE                |
      +-------------+--------------+
                    |
                    v
      +----------------------------+
      | 7. EXECUTE / PROVIDER      |
      +-------------+--------------+
                    |
                    v
      +----------------------------+
      | 8. CONFIRM / RECONCILE     |
      +-------------+--------------+
                    |
                    v
      +----------------------------+
      | 9. POST DOUBLE-ENTRY       |
      +-------------+--------------+
                    |
                    v
      +----------------------------+
      | 10. COMMIT                 |
      +-------------+--------------+
                    |
                    v
      +----------------------------+
      | 11. PUBLISH OUTBOX EVENT   |
      +-------------+--------------+
                    |
                    v
      +----------------------------+
      | 12. SETTLE                 |
      +-------------+--------------+
                    |
                    v
      +----------------------------+
      | 13. REPORT / AUDIT         |
      +----------------------------+
```

---

# 108. Golden Money Path Service Boundaries

Recommended responsibility boundaries:

```text
API Layer
    -> request handling

Authentication
    -> identity

Authorization
    -> permission

Tenant Context
    -> tenant isolation

Domain Service
    -> business state

Payment Service
    -> payment workflow

Provider Adapter
    -> external payment provider

Posting Engine
    -> accounting posting

Journal Service
    -> journal construction

Ledger
    -> financial truth

Balance Service
    -> ledger-derived balances

Reconciliation Service
    -> external/internal matching

Settlement Service
    -> settlement accounting

Outbox
    -> reliable event publication

Audit
    -> financial evidence
```

No service should silently absorb another service's ownership responsibilities.

---

# 109. Golden Money Path Source Documents

This specification should be maintained alongside:

```text
docs/finance/FINANCIAL_LEDGER_SPECIFICATION.md
docs/data/DATA_MODEL_CATALOGUE.md
docs/events/EVENT_CATALOGUE.md
docs/api/API_CATALOGUE.md
docs/api/BACKEND_API_SPECIFICATION.md
docs/02-architecture/SERVICE_CATALOGUE.md
docs/02-architecture/DEPENDENCY_MAP.md
```

---

# 110. Production Readiness Checklist

## Business

* [ ] Every monetary operation has a defined lifecycle.
* [ ] Accounting treatment is documented.
* [ ] Failure behavior is documented.
* [ ] Reversal behavior is documented.
* [ ] Settlement behavior is documented.

## Security

* [ ] Authentication enforced.
* [ ] Authorization enforced.
* [ ] Tenant isolation enforced.
* [ ] Sensitive data protected.
* [ ] Provider signatures validated.
* [ ] Financial freeze available.

## Financial Integrity

* [ ] Double-entry posting enforced.
* [ ] Exact monetary arithmetic used.
* [ ] Currency validated.
* [ ] Period controls active.
* [ ] Ledger immutable.
* [ ] Reversals supported.
* [ ] Adjustments controlled.
* [ ] Balance integrity verified.

## Idempotency

* [ ] API idempotency implemented.
* [ ] Payment idempotency implemented.
* [ ] Callback deduplication implemented.
* [ ] Posting idempotency implemented.
* [ ] Settlement idempotency implemented.
* [ ] Replay protection implemented.

## Reconciliation

* [ ] Provider reconciliation implemented.
* [ ] Settlement reconciliation implemented.
* [ ] Statement processing integrated.
* [ ] Exceptions tracked.
* [ ] Repairs audited.

## Observability

* [ ] Request IDs propagated.
* [ ] Correlation IDs propagated.
* [ ] Financial metrics implemented.
* [ ] Distributed tracing implemented.
* [ ] Alerts configured.
* [ ] Financial dashboard available.

## Recovery

* [ ] Unknown outcomes handled.
* [ ] Retry policy implemented.
* [ ] Dead-letter handling implemented.
* [ ] Recovery runbooks documented.
* [ ] Backups verified.
* [ ] Restore procedures tested.

---

# 111. Golden Money Path Final Standard

The TITech Community Capital platform shall treat money movement as a controlled financial lifecycle rather than a simple API operation.

The production standard is:

```text
IDENTIFY
   +
AUTHORIZE
   +
VALIDATE
   +
IDEMPOTENTLY REGISTER
   +
INITIATE
   +
EXECUTE
   +
CONFIRM
   +
POST
   +
COMMIT
   +
PUBLISH
   +
RECONCILE
   +
SETTLE
   +
REPORT
   =
GOLDEN MONEY PATH
```

The platform must never sacrifice financial correctness for convenience.

When a money outcome is uncertain, the system must prefer:

```text
reconciliation
```

over:

```text
guessing
```

When a transaction must be corrected, the system must prefer:

```text
reversal / adjustment
```

over:

```text
destructive mutation
```

When a request is retried, the system must prefer:

```text
idempotent recovery
```

over:

```text
duplicate posting
```

When an external provider disagrees with internal state, the system must prefer:

```text
traceable reconciliation
```

over:

```text
silent overwrite
```

---

# 112. Non-Negotiable Financial Rule

> **Every unit of money must be traceable from business intent through execution, authoritative ledger posting, reconciliation, settlement, and reporting — with one logical financial effect, one immutable accounting history, and a complete audit trail.**

---

# 113. Document Metadata

**Document:** `docs/finance/GOLDEN_MONEY_PATH.md`
**Organization:** TITech Community Capital Ltd
**Platform:** Community Savings Platform
**Domain:** Financial Operations / Money Movement
**Version:** `2.0`
**Status:** Enterprise Production Architecture Standard
**Last Updated:** August 16, 2026

**Primary Example User**

```text
Name: Justine Robert
Email: justine@titech.com
```

## Maintenance Requirement

> Any change to payment flow, loan disbursement, contribution posting, repayment allocation, withdrawal, transfer, refund, settlement, reconciliation, reversal, interest accrual, write-off, provider integration, ledger posting, or financial event sequencing must be evaluated against this Golden Money Path and reflected in the relevant finance, data, API, event, service, security, and testing documentation.

## Final Authority

> **The financial ledger remains the authoritative accounting system of record. All money paths must ultimately converge on a controlled, balanced, immutable, auditable ledger outcome.**