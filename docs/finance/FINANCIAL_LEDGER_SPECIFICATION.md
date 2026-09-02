# TITech Community Capital Ltd — Financial Ledger Specification

> **System:** Community Savings Platform
> **Document:** `docs/finance/FINANCIAL_LEDGER_SPECIFICATION.md`
> **Status:** Enterprise Production Financial Architecture Specification
> **Version:** 2.0
> **Last Updated:** August 16, 2026
> **Domain:** Finance / Accounting / Ledger / Reconciliation
> **Authority:** Financial System of Record

---

# 1. Purpose

This document defines the authoritative financial ledger architecture for the TITech Community Capital Ltd Community Savings Platform.

The ledger is the system of record for financial state.

All financially material operations must ultimately resolve into controlled ledger postings.

The specification defines:

* Chart of accounts
* Double-entry accounting
* Journal structure
* Journal entries
* Financial transactions
* Posting rules
* Transaction state management
* Idempotency
* Reversals
* Adjustments
* Account balances
* Balance snapshots
* Financial periods
* Reconciliation
* Settlement integration
* Loan accounting
* Contribution accounting
* Payment accounting
* Fees and income
* Interest accrual
* Write-offs
* Auditability
* Event publication
* Concurrency control
* Financial integrity checks
* Operational controls
* Security
* Disaster recovery
* Reporting requirements

---

# 2. Financial System-of-Record Principle

The ledger is authoritative for accounting state.

The following are derived from or reconciled against the ledger:

```text
Account balances
Financial statements
Loan financial balances
Contribution financial balances
Payment financial effects
Settlement balances
Revenue
Expenses
Interest income
Fees
Write-offs
Reconciliation reports
Financial dashboards
```

No application subsystem may create a second independent source of truth for posted financial balances.

---

# 3. Non-Negotiable Financial Rules

The following rules are mandatory.

```text
1. Every posted financial transaction must balance.
2. Every financial mutation must be attributable.
3. Posted financial records are immutable.
4. Corrections are performed through reversals or approved adjustments.
5. Duplicate financial operations must be prevented.
6. Financial operations must be tenant-scoped.
7. Monetary values use exact arithmetic.
8. Every posting has an explicit currency.
9. Account ownership and state must be validated before posting.
10. Closed financial periods cannot be modified without controlled reopening.
11. Financial events are emitted only after authoritative state commits.
12. No controller may directly mutate a financial balance.
13. No provider callback may directly create an unvalidated ledger entry.
14. Reconciliation differences must remain traceable.
15. Every financial adjustment must have an audit trail.
```

---

# 4. Architecture

The financial architecture is:

```text
                    +----------------------+
                    |   Application APIs   |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    | Application Services |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    | Financial Operations  |
                    | / Posting Engine      |
                    +----------+-----------+
                               |
              +----------------+----------------+
              |                                 |
              v                                 v
     +------------------+             +------------------+
     | Transaction      |             | Validation /    |
     | Manager          |             | Policy Engine   |
     +--------+---------+             +---------+--------+
              |                                 |
              +----------------+----------------+
                               |
                               v
                    +----------------------+
                    | Journal Service      |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    | Double-Entry Ledger  |
                    +----------+-----------+
                               |
             +-----------------+------------------+
             |                 |                  |
             v                 v                  v
      Account Balances   Reconciliation      Financial Reports
             |
             v
       Balance Snapshots

Ledger Commit
      |
      v
    Outbox
      |
      v
  Domain Events
```

The ledger itself remains authoritative.

---

# 5. Financial Bounded Contexts

The finance platform consists of:

```text
Chart of Accounts
Account Management
Transaction Management
Journal Management
Posting Engine
Balance Engine
Reversal Engine
Adjustment Engine
Period Management
Interest Accrual
Write-Off Management
Reconciliation
Settlement
Financial Statements
Ledger Integrity
Audit
Financial Events
```

---

# 6. Core Financial Entities

The canonical financial model consists of:

```text
Account
FinancialTransaction
Journal
JournalEntry
BalanceSnapshot
FinancialPeriod
Reversal
Adjustment
Settlement
ReconciliationRun
ReconciliationException
```

Related domain entities include:

```text
Loan
LoanRepayment
Contribution
Payment
Statement
ProviderTransaction
```

These related entities may reference financial records but do not replace them.

---

# 7. Account Model

## 7.1 Account Purpose

An account represents a financial ledger account against which debits and credits are posted.

## 7.2 Required Fields

```text
id
tenantId
accountCode
accountName
accountType
currency
normalBalance
parentAccountId
status
metadata
createdAt
updatedAt
version
```

## 7.3 Account Types

```text
ASSET
LIABILITY
EQUITY
INCOME
EXPENSE
```

## 7.4 Account Status

```text
ACTIVE
FROZEN
CLOSED
ARCHIVED
```

## 7.5 Normal Balance

```text
ASSET     -> DEBIT
EXPENSE   -> DEBIT

LIABILITY -> CREDIT
EQUITY    -> CREDIT
INCOME    -> CREDIT
```

The normal balance does not prohibit the account from temporarily having the opposite balance; it defines the account's expected accounting orientation.

---

# 8. Chart of Accounts

Each tenant must have a controlled chart of accounts.

Typical structure:

```text
1000 Assets
  1100 Cash
  1200 Mobile Money Receivables
  1300 Bank Accounts
  1400 Loan Receivables
  1500 Interest Receivable

2000 Liabilities
  2100 Member Savings
  2200 Mobile Money Payables
  2300 Supplier Payables

3000 Equity
  3100 Member Capital
  3200 Retained Earnings

4000 Income
  4100 Loan Interest Income
  4200 Loan Fees
  4300 Transaction Fees
  4400 Other Income

5000 Expenses
  5100 Payment Processing Expense
  5200 Operating Expense
  5300 Bad Debt Expense
  5400 Other Financial Expense
```

The actual deployed chart must be maintained through configuration/migration rather than hard-coded independently in application logic.

---

# 9. Account Code Rules

Account codes must be:

* Unique within the applicable tenant scope.
* Stable after creation.
* Human-readable.
* Validated before posting.
* Protected from arbitrary client creation.

Example:

```text
tenantId + accountCode -> unique
```

An account code must not be silently reassigned from one accounting meaning to another.

---

# 10. Journal Model

A journal represents one balanced accounting operation.

Required fields:

```text
id
tenantId
journalNumber
transactionId
description
sourceType
sourceId
currency
postingDate
effectiveDate
status
createdBy
createdAt
postedAt
reversedAt
version
```

## Journal Status

```text
DRAFT
PENDING
POSTED
REVERSED
VOID
```

A journal may not enter `POSTED` unless all posting invariants pass.

---

# 11. Journal Entry Model

Each journal consists of one or more journal entries.

Required fields:

```text
id
tenantId
journalId
accountId
entryType
amount
currency
description
sequence
createdAt
```

Entry type:

```text
DEBIT
CREDIT
```

Rules:

```text
amount > 0
currency must match journal currency unless explicitly supported
account must be valid
account must be open for posting
```

---

# 12. Double-Entry Rule

For every posted journal:

```text
SUM(debits) = SUM(credits)
```

Example:

```text
Debit   Loan Receivable     30,000 UGX
Credit  Cash/Settlement     30,000 UGX
```

The journal is valid because:

```text
Total Debits  = 30,000
Total Credits = 30,000
```

A journal with unequal totals must never be posted.

---

# 13. Multi-Line Journal Rule

Transactions may contain multiple entries.

Example loan repayment:

```text
Debit   Cash / Mobile Money        5,500
Credit  Loan Principal Receivable  4,500
Credit  Interest Income            1,000
```

Therefore:

```text
Total Debits  = 5,500
Total Credits = 5,500
```

This is a valid balanced journal.

---

# 14. Financial Transaction Model

A financial transaction is the business-level operation that results in one or more journal postings.

Required fields:

```text
id
tenantId
transactionReference
transactionType
status
amount
currency
sourceType
sourceId
idempotencyKey
journalId
correlationId
requestId
createdAt
processedAt
failedAt
reversedAt
version
```

---

# 15. Transaction Types

Representative transaction types:

```text
CONTRIBUTION
LOAN_DISBURSEMENT
LOAN_REPAYMENT
LOAN_INTEREST
LOAN_FEE
PAYMENT
REFUND
WITHDRAWAL
TRANSFER
SETTLEMENT
REVERSAL
ADJUSTMENT
WRITE_OFF
INTEREST_ACCRUAL
```

The catalogue must remain extensible while enforcing explicit accounting mappings.

---

# 16. Financial Transaction States

Recommended state machine:

```text
INITIATED
    |
    v
PENDING
    |
    v
PROCESSING
    |
    +------> FAILED
    |
    v
POSTED
    |
    +------> REVERSED
```

Optional cancellation:

```text
INITIATED
    |
    v
CANCELLED
```

A transaction may not move arbitrarily between states.

---

# 17. Transaction State Invariants

## INITIATED

The request exists but has not necessarily been processed.

## PENDING

Required prerequisites are outstanding.

## PROCESSING

The financial operation is actively being executed.

## POSTED

The authoritative ledger posting has committed successfully.

## FAILED

The transaction did not complete and has no valid posted financial effect.

## REVERSED

A previously posted financial effect has been compensated by an approved reversal.

---

# 18. Posting Engine

The Posting Engine is the primary control point for financial postings.

Recommended responsibilities:

```text
validate transaction
validate tenant
validate accounts
validate currency
validate period
validate state
validate idempotency
construct journal
validate balance
persist journal
persist journal entries
update transaction state
publish outbox event
```

No controller should perform these responsibilities independently.

---

# 19. Posting Pipeline

Canonical flow:

```text
Request
   |
   v
Authentication
   |
   v
Authorization
   |
   v
Tenant Resolution
   |
   v
Transaction Validation
   |
   v
Idempotency Check
   |
   v
Account Validation
   |
   v
Financial Policy Validation
   |
   v
Journal Construction
   |
   v
Double-Entry Validation
   |
   v
Financial Period Validation
   |
   v
Atomic Persistence
   |
   +---- Transaction
   +---- Journal
   +---- Journal Entries
   +---- Audit
   +---- Outbox
   |
   v
COMMIT
```

---

# 20. Atomicity Requirement

A financial posting must be atomic.

Either:

```text
transaction
+
journal
+
journal entries
+
required balance projection/update
+
outbox event
```

are committed consistently,

or none of the financial state is committed.

The exact persistence mechanism may use the repository's database transaction facilities.

---

# 21. Idempotency

Every retry-sensitive financial operation must have a unique idempotency key.

Recommended logical uniqueness:

```text
tenantId
+
idempotencyKey
+
operationType
```

Example:

```text
tenant_001
loan-payment-20260816-000001
LOAN_REPAYMENT
```

A duplicate request must not result in a second financial posting.

---

# 22. Idempotency Rules

For a duplicate request:

```text
same key
same operation
same request fingerprint
```

return the existing transaction result.

For:

```text
same key
different operation payload
```

reject with a conflict.

Example:

```json
{
  "success": false,
  "error": {
    "code": "IDEMPOTENCY_KEY_REUSED",
    "message": "The idempotency key has already been used for a different request."
  }
}
```

---

# 23. Request Fingerprinting

The financial operation may store a normalized request hash:

```text
requestHash
```

The hash should include the operation's material input fields.

Never include secrets unnecessarily.

This prevents:

```text
same idempotency key
+
different amount
```

from silently changing the financial effect.

---

# 24. Reversal Architecture

Financial records must not be edited to undo history.

To reverse a posted transaction:

```text
Original Transaction
        |
        v
Reversal Request
        |
        v
Authorization
        |
        v
Reversal Validation
        |
        v
Reversal Journal
        |
        v
Original + Reversal
```

The original journal remains intact.

---

# 25. Reversal Rules

A reversal must:

* Reference the original transaction.
* Reference the original journal.
* Explain the reason.
* Be authorized.
* Be idempotent.
* Create compensating entries.
* Preserve the original audit trail.

A second reversal of the same original posting must be rejected unless an explicitly supported correction workflow exists.

---

# 26. Example Reversal

Original:

```text
Debit   Loan Receivable  30,000
Credit  Cash             30,000
```

Reversal:

```text
Debit   Cash             30,000
Credit  Loan Receivable  30,000
```

The combined accounting effect is zero.

The original transaction remains visible.

---

# 27. Adjustment Architecture

Adjustments are controlled financial corrections that are not simply direct reversals.

Required metadata:

```text
adjustmentId
reason
requestedBy
approvedBy
sourceTransactionId
approvalReference
createdAt
```

Adjustments must result in explicit journal entries.

---

# 28. Financial Transaction Traceability

Every material financial transaction should be traceable across:

```text
requestId
correlationId
idempotencyKey
business entity
payment
financial transaction
journal
journal entries
accounts
ledger
audit event
domain event
```

Example:

```text
HTTP Request
   |
   v
Payment ID
   |
   v
Transaction ID
   |
   v
Journal ID
   |
   +--> Debit Account
   |
   +--> Credit Account
   |
   v
Ledger Event
```

---

# 29. Balance Engine

Balances should be calculated from ledger postings or controlled ledger-derived projections.

The Balance Engine may maintain:

```text
ledgerBalance
availableBalance
pendingBalance
reservedBalance
```

These are distinct concepts and must not be conflated.

---

# 30. Ledger Balance

Represents the accounting balance after posted ledger entries.

Conceptually:

```text
Opening Balance
+
Posted Debits/Credits
=
Ledger Balance
```

The exact sign convention depends on account type and reporting requirements.

---

# 31. Available Balance

Represents the amount available for permitted operations after applicable reservations/restrictions.

Possible calculation:

```text
Available Balance
=
Ledger Balance
-
Pending Restrictions
-
Reserved Amounts
```

It must not be assumed to equal ledger balance.

---

# 32. Pending Balance

Represents financial operations that have not yet reached authoritative posting.

Examples:

```text
pending payment
pending settlement
pending provider callback
```

Pending balances must not be treated as posted accounting state.

---

# 33. Reserved Balance

Represents amounts intentionally held against an approved reservation.

Examples:

```text
payment reservation
loan processing reserve
operational reserve
```

Reservations require their own lifecycle and expiry rules.

---

# 34. Balance Snapshot

Snapshots may be created for:

```text
daily reporting
reconciliation
performance
statement generation
historical reporting
```

Snapshot fields:

```text
accountId
tenantId
currency
ledgerBalance
availableBalance
pendingBalance
reservedBalance
snapshotAt
```

Snapshots are derived data.

They do not replace the ledger.

---

# 35. Balance Recalculation

The platform must support controlled balance rebuilding.

Conceptual process:

```text
Account
  |
  v
Read Posted Ledger Entries
  |
  v
Recalculate
  |
  v
Compare Existing Balance
  |
  +---- Match
  |
  +---- Difference -> Integrity Alert
```

A mismatch must not be silently overwritten.

---

# 36. Account Posting Controls

Before posting, validate:

```text
account exists
account belongs to tenant
account is ACTIVE
currency permitted
financial period open
posting type permitted
account restrictions satisfied
```

A `CLOSED` or `FROZEN` account must reject prohibited postings.

---

# 37. Currency Model

Every financial record must have an explicit currency.

Examples:

```text
UGX
KES
TZS
RWF
USD
```

A tenant may define supported currencies.

Cross-currency transactions require explicit FX handling and must never assume:

```text
1 UGX = 1 USD
```

---

# 38. Currency Integrity

Within a single journal, currency should normally be consistent.

If multi-currency journals are supported, they must explicitly include:

```text
source currency
target currency
exchange rate
rate source
rate timestamp
rounding rule
```

Otherwise reject mixed-currency postings.

---

# 39. Monetary Precision

Financial calculations must use exact decimal semantics.

Do not use uncontrolled JavaScript binary floating-point calculations for authoritative monetary arithmetic.

Preferred approaches include:

```text
Decimal128
integer minor units
exact decimal arithmetic library
```

depending on the existing financial implementation.

Represent API/event amounts explicitly:

```json
{
  "amount": "5500.00",
  "currency": "UGX"
}
```

---

# 40. Rounding Rules

The platform must define centralized:

```text
precision
scale
rounding mode
currency exponent
minimum monetary unit
```

Rounding must not be independently decided by each service.

This applies especially to:

```text
interest
fees
repayment allocation
FX
tax
financial statements
```

---

# 41. Financial Periods

Each tenant should have controlled financial periods.

States:

```text
OPEN
CLOSING
CLOSED
REOPENED
```

---

# 42. Period Validation

A posting must specify:

```text
postingDate
effectiveDate
```

and determine the applicable financial period.

Rules:

```text
OPEN -> posting permitted
CLOSING -> restricted/controlled
CLOSED -> posting prohibited
REOPENED -> exceptional controlled posting
```

---

# 43. Period Close

Closing a period should include:

```text
validate ledger balance
run reconciliation
validate unresolved exceptions
post required accruals
complete required adjustments
generate closing reports
lock period
record close audit event
```

---

# 44. Period Reopen

Reopening a closed period is highly privileged.

Requirements:

```text
authorization
reason
approval
audit record
period lock override
post-reopen review
```

The system should prefer posting an adjustment in an open period where accounting policy permits rather than reopening history.

---

# 45. Contribution Accounting

A contribution may produce:

```text
Debit   Cash / Payment Clearing
Credit  Member Savings Liability
```

or another tenant-approved account mapping.

The exact mapping must come from the configured accounting policy.

---

# 46. Loan Disbursement Accounting

A typical disbursement may produce:

```text
Debit   Loan Receivable
Credit  Cash / Bank / Payment Clearing
```

Example:

```text
Debit   Loan Receivable        30,000 UGX
Credit  Mobile Money Clearing  30,000 UGX
```

The actual account mapping depends on the settlement architecture.

---

# 47. Loan Repayment Accounting

A repayment may be split:

```text
Debit   Cash / Mobile Money Clearing    5,500
Credit  Loan Principal Receivable       4,500
Credit  Interest Income                 1,000
```

The allocation engine must determine the actual split based on the loan contract and accounting policy.

---

# 48. Interest Accrual

Interest accrual may produce:

```text
Debit   Interest Receivable
Credit  Interest Income
```

The accrual engine must store:

```text
loanId
accrualPeriod
principalBase
rate
calculationMethod
amount
currency
modelVersion
createdAt
```

Accruals must be idempotent by accounting period and source operation.

---

# 49. Interest Reversal

If an accrual must be reversed:

```text
Debit   Interest Income
Credit  Interest Receivable
```

The reversal must reference the original accrual.

---

# 50. Loan Fee Accounting

Example:

```text
Debit   Cash / Receivable
Credit  Loan Fee Income
```

If the fee is capitalized, deferred, or recognized differently, the appropriate accounting treatment must be configured explicitly.

---

# 51. Payment Processing Fees

A provider fee may be accounted as:

```text
Debit   Payment Processing Expense
Credit  Cash / Payable
```

or through the provider settlement mechanism.

The provider settlement statement remains the evidence for external cash movement.

---

# 52. Refund Accounting

A refund should produce a compensating financial transaction.

Example:

```text
Debit   Refund / Revenue Adjustment
Credit  Cash / Payment Clearing
```

Exact account mapping depends on the original transaction and accounting policy.

---

# 53. Write-Off Accounting

A write-off may produce:

```text
Debit   Bad Debt Expense
Credit  Loan Receivable
```

The write-off must include:

```text
approval
reason
loan reference
amount
currency
policy reference
audit evidence
```

A write-off must not erase the original loan history.

---

# 54. Settlement Accounting

Provider settlement operations should distinguish:

```text
provider transaction
payment transaction
clearing account
settlement account
actual bank/cash movement
```

Example conceptual chain:

```text
Customer Payment
      |
      v
Provider
      |
      v
Clearing Account
      |
      v
Settlement
      |
      v
Bank/Cash Account
```

---

# 55. Reconciliation

The ledger must support reconciliation against:

```text
payment provider records
bank statements
mobile money statements
internal transactions
settlement reports
```

Reconciliation must preserve:

```text
source record
matched record
matching method
confidence
timestamp
exception state
resolution
```

---

# 56. Reconciliation States

Recommended:

```text
UNMATCHED
MATCHED
PARTIALLY_MATCHED
EXCEPTION
RESOLVED
DISMISSED
```

A resolved exception must retain resolution evidence.

---

# 57. Reconciliation Matching

Matching may use:

```text
providerReference
transactionReference
amount
currency
transactionDate
valueDate
account
metadata
```

Matching rules must be deterministic and auditable.

---

# 58. Reconciliation Exception Management

Exceptions may include:

```text
missing internal transaction
missing provider transaction
amount mismatch
currency mismatch
duplicate transaction
unknown reference
date mismatch
settlement mismatch
```

Every exception should receive:

```text
severity
status
owner
createdAt
resolvedAt
resolution
```

---

# 59. Ledger Repair

Repairs must use controlled financial operations.

A repair must never:

```text
edit historical journal entry
delete a transaction
overwrite posted amount
rewrite original timestamps
```

Instead:

```text
identify discrepancy
create repair instruction
approve repair
post adjustment/reversal
link repair to source
audit outcome
```

---

# 60. Financial Audit Trail

Every financial mutation should be traceable through audit metadata:

```text
actorId
actorRole
tenantId
requestId
correlationId
transactionId
journalId
sourceType
sourceId
action
reason
timestamp
```

Financial audit records should be append-oriented.

---

# 61. Ledger Event Publication

The ledger should publish events through the outbox mechanism.

Example:

```text
FinancialTransactionPosted
JournalPosted
TransactionReversed
```

Publication sequence:

```text
Persist financial state
+
Persist outbox event
      |
      v
COMMIT
      |
      v
Outbox Publisher
      |
      v
Event Bus
```

Events must not be published externally before the financial commit is authoritative.

---

# 62. Event Consumers

Consumers may include:

```text
NotificationService
ReportingService
ReconciliationService
AnalyticsService
ComplianceService
RiskService
AuditService
```

Each consumer must be idempotent.

The ledger remains authoritative even if an event consumer fails.

---

# 63. Financial Event Payload

Example:

```json
{
  "eventId": "evt_01J...",
  "eventType": "FinancialTransactionPosted",
  "eventVersion": 1,
  "tenantId": "tenant_01J...",
  "aggregateType": "FinancialTransaction",
  "aggregateId": "txn_01J...",
  "occurredAt": "2026-08-16T00:00:00.000Z",
  "correlationId": "corr_01J...",
  "data": {
    "transactionId": "txn_01J...",
    "journalId": "journal_01J...",
    "amount": "30000.00",
    "currency": "UGX"
  }
}
```

Do not place raw secrets or unnecessary sensitive data in the event.

---

# 64. Concurrency Control

Financial operations must be protected against concurrent execution.

Potential mechanisms:

```text
database transaction
optimistic versioning
atomic update
unique constraint
distributed lock
idempotency record
```

The implementation should prefer database-level atomicity wherever possible.

---

# 65. Concurrent Posting Example

Two workers attempt:

```text
LoanPayment
idempotencyKey = PAY-001
```

Expected:

```text
Worker A -> creates transaction
Worker B -> detects existing transaction
Worker B -> returns prior result
```

Not:

```text
Worker A -> posts 5,500
Worker B -> posts another 5,500
```

---

# 66. Account Balance Concurrency

Balance updates must never rely on:

```text
read balance
+
calculate
+
write balance
```

without concurrency protection.

Prefer:

```text
append ledger entry
+
recalculate/project atomically
```

or a properly locked/versioned balance update.

---

# 67. Financial Integrity Checks

The platform must continuously verify:

```text
journal debits = credits
```

```text
posted transaction -> valid journal
```

```text
journal entries -> valid accounts
```

```text
transaction currency -> journal currency
```

```text
loan outstanding -> ledger/schedule reconciliation
```

```text
provider settlement -> payment reconciliation
```

```text
closed period -> no unauthorized posting
```

---

# 68. Ledger Integrity Job

A recurring integrity job should inspect:

```text
unbalanced journals
orphan journal entries
duplicate transactions
duplicate provider references
invalid account state
currency mismatches
negative/invalid values
missing transaction links
stale processing states
```

The integrity job should report and quarantine discrepancies rather than silently rewriting history.

---

# 69. Data Retention

Financial data must be retained according to applicable:

```text
financial policy
regulatory requirements
tax requirements
audit requirements
tenant policy
```

Posted financial records must not be destructively deleted merely to clean up operational data.

---

# 70. Financial Data Security

Protect:

```text
customer financial information
account numbers
provider references
payment details
transaction metadata
KYC linkage
financial statements
```

Use:

```text
TLS
encrypted storage
least privilege
role-based authorization
tenant isolation
secret management
audit logging
```

---

# 71. Secret Management

Never store in ledger records:

```text
API secrets
provider client secrets
OAuth secrets
private keys
access tokens
refresh tokens
webhook signing secrets
```

Only non-secret references should be persisted where needed.

---

# 72. API-to-Ledger Boundary

API endpoints may request financial actions but may not decide accounting truth.

Correct:

```text
POST /api/loans/:loanId/pay
        |
        v
LoanPaymentService
        |
        v
Financial Operation
        |
        v
Posting Engine
```

Incorrect:

```text
Controller
   |
   v
account.balance += amount
```

---

# 73. Service Responsibilities

## LedgerService

Responsible for:

```text
posting
validation
journal coordination
reversal
ledger queries
integrity
```

## JournalService

Responsible for:

```text
journal construction
entry validation
journal persistence
journal reversal linkage
```

## PostingEngine

Responsible for:

```text
financial posting orchestration
double-entry validation
transactional persistence
idempotency
```

## BalanceService

Responsible for:

```text
ledger-derived balances
available balances
pending balances
reserved balances
```

## ReconciliationService

Responsible for:

```text
matching
exceptions
resolution linkage
```

## PeriodCloseService

Responsible for:

```text
period validation
close
reopen controls
```

## InterestAccrualService

Responsible for:

```text
interest calculations
accrual transactions
period idempotency
```

## WriteOffService

Responsible for:

```text
write-off validation
authorization
accounting treatment
posting
```

---

# 74. Repository Responsibilities

Repositories should own persistence mechanics.

Examples:

```text
AccountRepository
TransactionRepository
JournalRepository
JournalEntryRepository
BalanceSnapshotRepository
FinancialPeriodRepository
```

Repositories must not bypass:

```text
tenant filtering
soft-delete policy
financial state rules
immutability
```

---

# 75. Reporting

Financial reporting should be generated from posted ledger data.

Reports may include:

```text
trial balance
income statement
balance sheet
cash flow
loan portfolio
interest income
fee income
expense report
member savings liability
settlement report
reconciliation report
```

Reports should identify their reporting period and source timestamp.

---

# 76. Trial Balance

A trial balance verifies that:

```text
Total Debits = Total Credits
```

for the selected scope and period.

A failed trial balance is a critical integrity incident.

---

# 77. Income Statement

The income statement derives:

```text
Income
-
Expenses
=
Net Income
```

Income examples:

```text
interest income
loan fees
transaction fees
other income
```

Expense examples:

```text
processing expense
operating expense
bad debt expense
```

---

# 78. Balance Sheet

The balance sheet follows:

```text
Assets = Liabilities + Equity
```

A failure to balance must trigger investigation.

---

# 79. Cash Flow

Cash flow reports should distinguish:

```text
cash inflows
cash outflows
operating activity
investing activity
financing activity
```

Cash-flow reporting must not equate all ledger activity with actual cash movement.

---

# 80. Loan Ledger Reconciliation

Every loan should support reconciliation among:

```text
loan principal
accrued interest
fees
repayments
write-offs
reversals
ledger balances
```

Expected relationship:

```text
Original Principal
+
Accrued/Capitalized Amounts
-
Principal Payments
-
Principal Write-Offs
+
Approved Adjustments
=
Outstanding Principal
```

The exact accounting model must follow product policy.

---

# 81. Payment Ledger Reconciliation

Each payment should be traceable:

```text
Payment
  |
  v
Provider Transaction
  |
  v
Financial Transaction
  |
  v
Journal
  |
  v
Ledger Entries
```

A payment with provider success but missing financial posting must generate an operational exception.

---

# 82. Settlement Ledger Reconciliation

Settlement should reconcile:

```text
provider transaction totals
=
settlement totals
=
internal payment totals
=
ledger clearing movement
```

Exceptions must be explicit.

---

# 83. Financial Exception Handling

Financial exceptions should not be buried in logs.

They require:

```text
exceptionId
severity
status
owner
source
financial impact
createdAt
resolution
resolvedAt
```

Critical financial exceptions should trigger alerts.

---

# 84. Financial Incident Severity

Suggested classification:

```text
SEV-1
Systemic financial integrity failure

SEV-2
Material financial discrepancy affecting multiple transactions

SEV-3
Isolated financial discrepancy requiring investigation

SEV-4
Non-material operational inconsistency
```

Severity thresholds should be configurable.

---

# 85. Financial Freeze Controls

The platform should support controlled suspension of financial posting during critical incidents.

Possible controls:

```text
tenant financial freeze
payment rail freeze
loan disbursement freeze
reconciliation freeze
account freeze
```

A freeze must not silently delete or reverse transactions.

It prevents new prohibited operations until resolution.

---

# 86. Transaction Processing Timeouts

Financial workflows must have bounded execution time.

A timeout must not automatically mean:

```text
financial transaction failed
```

Instead, the state may become:

```text
UNKNOWN / PENDING_REVIEW
```

and the system should reconcile against authoritative state before retrying.

---

# 87. Unknown Outcome Handling

For external payment operations:

```text
Request sent
   |
   v
Network timeout
   |
   v
Unknown outcome
```

The system must query:

```text
provider status
internal payment status
callback state
```

before creating a new financial operation.

This is critical for preventing duplicate disbursements and repayments.

---

# 88. Financial Workflow Idempotency

Idempotency must exist at multiple levels:

```text
API operation
Payment operation
Financial transaction
Ledger posting
Provider callback
Settlement processing
Reconciliation repair
```

Each layer must prevent duplicate side effects appropriate to its scope.

---

# 89. Financial Event Ordering

For a loan disbursement:

```text
LoanDisbursementInitiated
      |
      v
PaymentCompleted
      |
      v
FinancialTransactionPosted
      |
      v
LoanDisbursed
```

The actual implementation may use a different business sequence, but the event contract must never claim a financial completion before the authoritative state exists.

---

# 90. Ledger Disaster Recovery

Recovery must preserve:

```text
journal history
transaction IDs
idempotency records
audit history
event traceability
period state
reconciliation history
```

Recovery must not generate duplicate postings.

---

# 91. Backup Verification

Backups must be regularly tested through restoration.

A successful backup process is not proven until:

```text
restore
+
integrity checks
+
ledger trial balance
+
application verification
```

have completed successfully.

---

# 92. Financial Migration Rules

Financial schema migrations must be:

```text
backward compatible where possible
tested against production-like data
transactionally safe
audited
rollback-aware
```

Data correction migrations must use approved financial procedures.

Never use raw update scripts to rewrite posted accounting history.

---

# 93. Ledger API Contract

Illustrative financial endpoints:

```text
GET    /api/finance/accounts
GET    /api/finance/accounts/:accountId
GET    /api/finance/accounts/:accountId/balance

GET    /api/finance/transactions
GET    /api/finance/transactions/:transactionId

GET    /api/finance/journals
GET    /api/finance/journals/:journalId

POST   /api/finance/transactions
POST   /api/finance/transactions/:transactionId/reverse

GET    /api/finance/statements
GET    /api/finance/reconciliation
```

Actual route registration remains authoritative.

---

# 94. Financial API Authorization

Typical privileges:

```text
FINANCE_READ
FINANCE_POST
FINANCE_REVERSE
FINANCE_ADJUST
FINANCE_PERIOD_CLOSE
FINANCE_PERIOD_REOPEN
FINANCE_RECONCILE
FINANCE_WRITE_OFF
FINANCE_ADMIN
```

Permissions must be enforced server-side.

---

# 95. Financial API Response Example

```json
{
  "success": true,
  "data": {
    "transactionId": "txn_01J...",
    "status": "POSTED",
    "journalId": "journal_01J...",
    "amount": "30000.00",
    "currency": "UGX"
  },
  "requestId": "req_01J..."
}
```

---

# 96. Financial Error Catalogue

| Code                          | Meaning                             |
| ----------------------------- | ----------------------------------- |
| `FINANCIAL_VALIDATION_ERROR`  | Financial data invalid              |
| `ACCOUNT_NOT_FOUND`           | Account does not exist              |
| `ACCOUNT_NOT_ACTIVE`          | Account cannot accept posting       |
| `CURRENCY_MISMATCH`           | Currencies do not match             |
| `UNBALANCED_JOURNAL`          | Debits and credits differ           |
| `PERIOD_CLOSED`               | Posting period is closed            |
| `DUPLICATE_TRANSACTION`       | Duplicate financial operation       |
| `IDEMPOTENCY_KEY_REUSED`      | Same key used for different request |
| `TRANSACTION_NOT_REVERSIBLE`  | Reversal not permitted              |
| `ALREADY_REVERSED`            | Transaction already reversed        |
| `CONCURRENT_FINANCIAL_UPDATE` | Concurrent mutation detected        |
| `INSUFFICIENT_AUTHORIZATION`  | Financial permission missing        |
| `RECONCILIATION_REQUIRED`     | State requires reconciliation       |
| `FINANCIAL_FREEZE_ACTIVE`     | Posting is temporarily blocked      |

---

# 97. Financial Audit Example

Example audit record:

```json
{
  "auditId": "audit_01J...",
  "tenantId": "tenant_01J...",
  "actorId": "user_01J...",
  "actorRole": "finance_admin",
  "action": "FINANCIAL_TRANSACTION_REVERSED",
  "resourceType": "FinancialTransaction",
  "resourceId": "txn_01J...",
  "reason": "Duplicate provider settlement",
  "requestId": "req_01J...",
  "correlationId": "corr_01J...",
  "createdAt": "2026-08-16T00:00:00.000Z"
}
```

No access tokens, passwords, API secrets, or private keys may appear.

---

# 98. Financial Metrics

Recommended metrics:

```text
financial_transactions_total
financial_transactions_posted_total
financial_transactions_failed_total
financial_transactions_reversed_total

ledger_journals_total
ledger_journals_unbalanced_total
ledger_posting_duration_seconds

ledger_integrity_failures_total
ledger_balance_mismatch_total

financial_idempotency_replays_total
financial_concurrency_conflicts_total

reconciliation_exceptions_total
reconciliation_unresolved_total

loan_disbursements_total
loan_repayments_total
interest_accruals_total
writeoffs_total
```

---

# 99. Financial Tracing

Recommended spans:

```text
financial.transaction
financial.validation
financial.posting
financial.journal
financial.balance
financial.reversal
financial.reconciliation
financial.period_close
```

Trace attributes should include safe identifiers such as:

```text
tenantId
transactionId
journalId
operationType
currency
```

Avoid sensitive customer information.

---

# 100. Financial Alerts

Critical alerts should include:

```text
unbalanced journal
ledger balance mismatch
duplicate financial transaction
provider settlement discrepancy
stuck financial operation
large reconciliation backlog
repeated posting failure
closed-period violation attempt
unexpected negative balance
financial event backlog
```

---

# 101. Financial Integrity Dashboard

Operations should monitor:

```text
posted transactions
failed transactions
pending transactions
reversed transactions
ledger balance health
unbalanced journals
reconciliation exceptions
provider settlement status
statement processing status
period status
financial freeze state
```

---

# 102. Segregation of Duties

High-risk actions should support separation of duties.

Examples:

```text
Loan approval != loan disbursement
Write-off request != write-off approval
Period reopen request != period reopen approval
Financial adjustment request != financial adjustment approval
```

The exact policy depends on tenant and platform governance.

---

# 103. Administrative Financial Controls

Admin financial tools must:

* Require explicit permissions.
* Validate tenant scope.
* Validate financial state.
* Require reason codes where appropriate.
* Record actor identity.
* Record request identity.
* Produce audit events.
* Support idempotency.
* Prevent destructive historical mutation.

---

# 104. Financial Data Access

Read access should be scoped.

Users may access:

```text
their own permitted transactions
their own loan information
their own contribution history
```

Group/tenant administrators may access:

```text
authorized group/tenant financial reports
```

Finance operators may access:

```text
financial records required for assigned responsibilities
```

Platform administrators should not automatically receive unrestricted financial access without explicit authorization.

---

# 105. Immutable Financial Records

The following records are immutable after posting:

```text
posted Journal
posted JournalEntry
posted FinancialTransaction
published Reversal record
closed FinancialPeriod
historical Settlement record
```

If a field must be corrected:

```text
create compensating record
```

rather than:

```text
UPDATE posted_record
```

---

# 106. Financial Data Model Relationship

```text
Tenant
  |
  +--> Account
  |
  +--> FinancialTransaction
           |
           v
        Journal
           |
           +--> JournalEntry --> Account
           |
           v
      Balance Projection
```

Business domains:

```text
Loan
  |
  +--> FinancialTransaction
  |
  +--> Payment
```

```text
Contribution
  |
  +--> Payment
  |
  +--> FinancialTransaction
```

```text
Statement
  |
  +--> Reconciliation
          |
          +--> FinancialTransaction
```

---

# 107. Financial Closing Controls

Before a period is closed:

```text
All required journals posted
No unresolved critical integrity errors
Reconciliation completed or explicitly approved
Required accruals posted
Required reports generated
Close authorization verified
```

After close:

```text
Posting blocked
Reports reproducible
Audit record retained
```

---

# 108. Month-End / Period-End Workflow

```text
1. Stop normal period mutations according to policy.
2. Complete statement processing.
3. Complete payment reconciliation.
4. Resolve material exceptions.
5. Run interest accrual.
6. Run required fee recognition.
7. Process approved write-offs.
8. Verify trial balance.
9. Generate financial statements.
10. Execute period close.
11. Record close audit event.
12. Publish FinancialPeriodClosed.
```

---

# 109. Financial Statement Integrity

Every financial statement must identify:

```text
tenant
period
currency
generatedAt
data-as-of timestamp
```

Statements must be reproducible from the underlying ledger.

---

# 110. Reporting Reconciliation

Dashboard/report projections must periodically reconcile with:

```text
ledger balances
loan balances
contribution totals
payment totals
```

Differences must generate data-integrity alerts.

---

# 111. Financial Event Reconciliation

For every important event:

```text
Business state
=
Financial state
=
Event state
```

within the defined transaction boundary.

Example:

```text
LoanDisbursed
```

must correspond to:

```text
Loan state = disbursed
Payment state = successful/settled as applicable
Financial transaction = posted
Journal = posted
```

where the product accounting workflow requires all of these states.

---

# 112. Operational Recovery

For an interrupted financial operation:

```text
1. Identify transaction.
2. Inspect transaction state.
3. Inspect journal state.
4. Inspect provider state.
5. Inspect outbox state.
6. Inspect reconciliation state.
7. Determine authoritative outcome.
8. Resume/reconcile using controlled operation.
```

Never blindly rerun a timed-out financial mutation.

---

# 113. Financial Freeze

A financial freeze may be activated during:

```text
ledger integrity incident
provider settlement incident
data migration
suspected fraud
systemic duplicate posting
```

During a freeze:

```text
new affected financial operations -> blocked
read operations -> permitted where safe
reconciliation -> permitted where appropriate
recovery operations -> privileged
```

The freeze itself must be audited.

---

# 114. Performance Requirements

Financial operations should be designed for predictable latency.

The implementation must avoid:

```text
unbounded queries
full ledger scans on request path
unbounded aggregation
synchronous external dependencies inside database transactions
```

Large reporting and reconciliation operations should use:

```text
background jobs
batch processing
materialized projections
controlled pagination
```

---

# 115. Transaction Boundary Rules

Database transaction boundaries should be as narrow as possible while preserving atomic financial integrity.

Do not hold database transactions open while waiting for:

```text
external HTTP calls
mobile money providers
bank APIs
notification providers
slow search services
```

Instead:

```text
Persist intent
+
Commit
+
Perform external operation
+
Process callback
+
Post authoritative result
```

The exact workflow depends on the financial operation.

---

# 116. External Provider Rule

External provider responses are evidence, not immediate ledger truth.

Provider results must pass through:

```text
signature/security validation
normalization
business validation
idempotency
payment state management
financial posting
```

---

# 117. Financial Source-of-Truth Hierarchy

The following hierarchy applies:

```text
1. Posted Ledger
2. Financial Transaction
3. Journal / Journal Entries
4. Business Aggregate
5. Payment / Provider State
6. Reconciliation Projection
7. Reporting Projection
8. UI State
```

For provider settlement investigations, external provider evidence is reconciled against the internal financial records rather than silently replacing them.

---

# 118. Ledger Integrity Certification

A production release affecting finance should verify:

```text
double-entry tests passing
ledger integrity tests passing
idempotency tests passing
reversal tests passing
period tests passing
reconciliation tests passing
concurrency tests passing
audit tests passing
event publication tests passing
```

No financial feature should be released solely because its HTTP endpoint works.

---

# 119. Financial Test Scenarios

## Contribution

```text
contribution initiated
payment successful
financial transaction posted
ledger balanced
contribution marked posted
event emitted once
```

## Loan Disbursement

```text
loan approved
disbursement initiated
provider/payment succeeds
financial transaction posted
loan marked disbursed
ledger balanced
duplicate retry prevented
```

## Repayment

```text
payment received
allocation calculated
journal balanced
loan principal reduced
interest recognized
payment recorded
```

## Reversal

```text
original posted
reversal requested
authorization passed
compensating journal posted
original remains immutable
reversal event emitted
```

---

# 120. Failure Testing

Simulate:

```text
database failure before commit
database failure after external provider call
duplicate callback
duplicate API request
worker crash
timeout
partial reconciliation
period already closed
account frozen
currency mismatch
unbalanced journal
stale transaction version
```

The financial outcome must remain deterministic and auditable.

---

# 121. Data Migration Rules

When introducing a new financial field:

```text
1. Add schema support.
2. Add backward-compatible service handling.
3. Backfill safely.
4. Validate historical records.
5. Update indexes.
6. Update documentation.
7. Add integrity checks.
8. Only then enforce new required constraints.
```

Never make a destructive migration on posted financial records without an approved migration plan.

---

# 122. Security Review Requirements

Finance changes require review of:

```text
authorization
tenant isolation
idempotency
replay
concurrency
auditability
data exposure
financial precision
period locking
reversal behavior
provider interaction
```

---

# 123. Code Architecture Alignment

The ledger specification is intended to align with the finance implementation layers:

```text
backend/modules/finance/
```

Typical components include:

```text
ledger
journal
transaction
posting
reversal
balance
snapshot
period close
reconciliation
interest accrual
write-off
observability
```

The exact existing repository structure remains authoritative.

---

# 124. Recommended Core Services

```text
LedgerService
JournalService
PostingEngine
TransactionService
ReversalService
AdjustmentService
BalanceService
SnapshotService
PeriodCloseService
InterestAccrualService
WriteOffService
ReconciliationService
FinancialStatementService
LedgerIntegrityService
```

Services should have explicit responsibilities and avoid duplicated financial rules.

---

# 125. Recommended Repository Boundaries

```text
AccountRepository
TransactionRepository
JournalRepository
JournalEntryRepository
BalanceSnapshotRepository
FinancialPeriodRepository
ReconciliationRepository
SettlementRepository
OutboxRepository
AuditRepository
```

---

# 126. Financial Observability Metadata

Each material financial operation should carry:

```text
tenantId
userId where applicable
requestId
correlationId
transactionId
idempotencyKey
operationType
currency
sourceType
sourceId
```

Do not expose sensitive payloads through logs or metrics.

---

# 127. Production Financial Readiness Checklist

## Ledger

* [ ] Chart of accounts established.
* [ ] Account codes unique.
* [ ] Account states enforced.
* [ ] Double-entry validation enforced.
* [ ] Journal immutability enforced.
* [ ] Transaction state machine enforced.
* [ ] Posting engine is the only posting authority.
* [ ] Reversals implemented.
* [ ] Adjustments implemented.

## Financial Integrity

* [ ] Monetary precision standardized.
* [ ] Currency validation implemented.
* [ ] Period control implemented.
* [ ] Balance engine implemented.
* [ ] Balance snapshots implemented.
* [ ] Ledger integrity job implemented.
* [ ] Trial balance verification implemented.

## Payments

* [ ] Provider callback idempotency implemented.
* [ ] Payment-to-ledger traceability implemented.
* [ ] Settlement reconciliation implemented.
* [ ] Unknown outcome handling implemented.
* [ ] Duplicate payment protection implemented.

## Loans

* [ ] Loan disbursement accounting defined.
* [ ] Repayment allocation defined.
* [ ] Interest accrual defined.
* [ ] Write-off accounting defined.
* [ ] Loan/ledger reconciliation implemented.

## Reconciliation

* [ ] Statement ingestion integrated.
* [ ] Matching rules implemented.
* [ ] Exceptions tracked.
* [ ] Repair workflow implemented.
* [ ] Resolution audited.

## Security

* [ ] Finance permissions defined.
* [ ] Tenant isolation enforced.
* [ ] Sensitive data protected.
* [ ] Secrets excluded from financial records.
* [ ] Administrative actions audited.
* [ ] Financial freeze capability available.

## Events

* [ ] Outbox pattern implemented.
* [ ] Financial events emitted after commit.
* [ ] Event versions defined.
* [ ] Consumer idempotency implemented.
* [ ] Dead-letter handling implemented.
* [ ] Replay strategy defined.

---

# 128. Final Financial Architecture Standard

The TITech financial engine is production-grade only when the following invariants hold:

```text
Every posted transaction is balanced.
Every posted transaction is immutable.
Every financial mutation is attributable.
Every financial mutation is tenant-scoped.
Every retry-sensitive operation is idempotent.
Every reversal preserves historical truth.
Every balance is ledger-derived or reconciled to the ledger.
Every financial period is controlled.
Every external payment is reconciled.
Every financial exception is visible.
Every financial event is traceable.
Every administrative financial action is audited.
Every material financial change is tested.
```

---

# 129. Non-Negotiable Implementation Rule

> **No controller, route, provider adapter, scheduled job, background worker, administrative script, or external integration may directly modify an authoritative financial balance or posted accounting record.**

All such changes must pass through the approved financial transaction and posting architecture.

---

# 130. Document Metadata

**Document:** `docs/finance/FINANCIAL_LEDGER_SPECIFICATION.md`
**Organization:** TITech Community Capital Ltd
**Platform:** Community Savings Platform
**Domain:** Financial Ledger / Accounting Core
**Version:** `2.0`
**Status:** Enterprise Production Financial Architecture Specification
**Last Updated:** August 16, 2026

**Primary Example User**

```text
Name: Justine Robert
Email: justine@titech.com
```

## Maintenance Requirement

> Any change to accounts, journals, journal entries, transactions, balances, periods, reversals, adjustments, payment accounting, loan accounting, interest, write-offs, reconciliation, settlement, or financial events must update this specification and the associated data model, service catalogue, event catalogue, API documentation, migration, security, and test documentation.

## Financial Authority Statement

> The ledger is the authoritative accounting system of record. Application-facing balances, loan balances, payment states, dashboards, reports, reconciliation projections, and events must either derive from or reconcile to the authoritative ledger. Historical posted financial records must never be silently overwritten.