# TITech Community Capital Ltd

# Enterprise Financial Ledger Specification

**Document:** `docs/02-architecture/FINANCIAL_LEDGER_SPECIFICATION.md`
**Status:** Production Financial Control Baseline
**Audience:** Finance Engineering, Architecture, Backend Engineering, Accounting, Compliance, Risk, DevOps/SRE, QA, Internal Audit
**Owner:** Finance Engineering / Architecture
**Classification:** Internal / Confidential / Financial Control
**Version:** 1.0.0
**Review Cadence:** At least annually and after any material accounting or ledger architecture change

---

# 1. Purpose

This document defines the authoritative financial ledger architecture for TITech Community Capital.

The ledger is the platform's **system of record for financial truth**.

It defines the rules governing:

* accounts;
* journals;
* journal entries;
* transactions;
* posting;
* double-entry accounting;
* balances;
* available and pending funds;
* idempotency;
* reversals;
* adjustments;
* financial periods;
* reconciliation;
* snapshots;
* financial controls;
* auditability;
* concurrency;
* settlement;
* financial event publication;
* recovery;
* ledger integrity validation.

All services that create or modify financial state MUST comply with this specification.

---

# 2. Governing Principle

The central rule is:

> **No business service, payment adapter, controller, worker, callback handler, or external integration may directly mutate authoritative financial balances. Every financial effect MUST be represented by a controlled, balanced, auditable, tenant-scoped ledger posting.**

The ledger is authoritative.

Caches, projections, dashboards, provider records, statements, and operational databases are supporting representations.

They do not replace the ledger.

---

# 3. Financial Architecture Position

The Financial Core sits beneath business domains.

```text
Savings
Loans
Payments
Billing
Settlement
Fees
Interest
Write-Offs
Adjustments
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
       ├── Validation
       ├── Idempotency
       ├── Journal Creation
       ├── Journal Entry Creation
       ├── Balance Update
       ├── Audit
       └── Outbox Event
       │
       ▼
MongoDB / Persistent Store
```

---

# 4. Accounting Model

The platform uses **double-entry accounting**.

For every posted journal:

```text
Total Debits = Total Credits
```

No journal may be considered posted unless this invariant is satisfied.

A financial transaction MAY contain:

* one debit and one credit;
* multiple debits and one credit;
* one debit and multiple credits;
* multiple debits and multiple credits.

The total monetary value on both sides MUST balance exactly according to the defined currency/precision rules.

---

# 5. Ledger Components

The core financial model consists of:

```text
Account
Journal
JournalEntry
Transaction
Balance
BalanceSnapshot
FinancialPeriod
Reversal
Adjustment
ReconciliationRecord
```

Supporting infrastructure includes:

```text
LedgerService
PostingEngine
ReversalService
BalanceService
SnapshotService
PeriodCloseService
ReconciliationService
FinancialStatementService
InterestAccrualService
WriteOffService
LedgerIntegrityJob
```

---

# 6. Financial Data Ownership

The Financial Core owns:

```text
Account
Journal
JournalEntry
Posted Transaction
Financial Period
Ledger Balance
Ledger Snapshot
Reversal
Adjustment
```

Business domains own their operational entities.

Examples:

```text
Loan → Lending
PaymentOperation → Payments
SavingsAccount → Community Finance
Statement → Settlement
Subscription → SaaS/Billing
```

Business-domain models MAY reference ledger records, but they MUST NOT recreate the ledger.

---

# 7. Source of Truth Hierarchy

The financial source-of-truth hierarchy is:

```text
1. Posted Journal Entries
2. Journal
3. Financial Transaction
4. Account Ledger State
5. Balance Snapshots
6. Business Projections / Reporting Models
7. Caches
```

Where a derived value conflicts with a lower-level authoritative record, the authoritative record wins.

---

# 8. Core Financial Invariants

The following invariants are mandatory:

```text
1. Every posted journal is balanced.
2. Every journal belongs to one tenant.
3. Every journal has a transaction identity.
4. Every journal entry belongs to exactly one journal.
5. Every journal entry references a valid account.
6. Posted financial history is immutable.
7. Duplicate financial operations cannot produce duplicate postings.
8. Reversals create compensating entries.
9. Adjustments create explicit accounting records.
10. Financial periods enforce posting rules.
11. All financial operations are auditable.
12. Every financial amount has an explicit currency.
13. Cross-tenant financial references are rejected.
14. Unknown or invalid states cannot be posted.
15. Financial state is durable before a successful completion is returned.
```

---

# 9. Tenant Isolation

Every financial record MUST be tenant-scoped.

Required pattern:

```text
tenantId
```

and tenant-aware queries:

```text
{
  tenantId,
  _id
}
```

A financial account from Tenant A MUST NOT be usable in a posting for Tenant B.

Every posting MUST validate:

```text
transaction.tenantId
journal.tenantId
account.tenantId
```

and all MUST agree.

---

# 10. Account Model

An account represents a ledger location capable of carrying a financial balance.

Representative fields:

```text
_id
tenantId
accountCode
accountNumber
name
type
subtype
currency
parentAccountId
normalBalance
status
systemAccount
externalReference
createdAt
updatedAt
```

---

# 11. Account Types

The platform SHOULD support:

```text
ASSET
LIABILITY
EQUITY
REVENUE
EXPENSE
```

Additional classifications MAY exist under `subtype`.

Examples:

```text
ASSET
 ├── Cash
 ├── Bank
 ├── Mobile Money
 ├── Receivable
 └── Loan Portfolio

LIABILITY
 ├── Member Savings
 ├── Payables
 └── Settlement Liability

EQUITY
 ├── Capital
 └── Retained Earnings

REVENUE
 ├── Interest Income
 ├── Fees
 └── Penalties

EXPENSE
 ├── Interest Expense
 ├── Operations
 └── Provider Fees
```

The chart of accounts MUST remain configurable without breaking accounting invariants.

---

# 12. Account Normal Balance

Each account SHOULD define its expected normal balance:

```text
DEBIT
CREDIT
```

Typical classification:

```text
ASSET   → DEBIT
EXPENSE → DEBIT

LIABILITY → CREDIT
EQUITY    → CREDIT
REVENUE   → CREDIT
```

The account's normal balance does not replace double-entry validation.

---

# 13. Account Hierarchy

Accounts MAY form a controlled hierarchy:

```text
Parent Account
   ├── Child Account
   ├── Child Account
   └── Child Account
```

Parent balances SHOULD be derivable from children where the accounting design requires it.

A child account MUST NOT belong to another tenant's parent account.

---

# 14. Account Numbering

Accounts SHOULD have stable, tenant-scoped codes.

Example:

```text
1000 Cash
1100 Mobile Money
1200 Loan Receivables
2000 Member Savings
3000 Equity
4000 Interest Income
5000 Operating Expense
```

Actual numbering MUST be determined by the organization's chart-of-accounts policy.

Recommended uniqueness:

```text
tenantId + accountCode
```

---

# 15. System Accounts

System-managed financial accounts MAY be created for:

```text
payment clearing
settlement clearing
provider fees
interest income
interest expense
rounding
suspense
write-off
reversal
```

System accounts MUST be explicitly identifiable.

Example:

```text
systemAccount: true
```

System accounts SHOULD NOT be editable by ordinary tenant users.

---

# 16. Journal Model

A Journal groups balanced accounting entries for one financial event.

Representative fields:

```text
_id
tenantId
journalNumber
journalType
transactionId
currency
status
description
sourceType
sourceId
postingDate
reversalOfJournalId
createdAt
updatedAt
```

Journal lifecycle:

```text
DRAFT
 ↓
VALIDATED
 ↓
POSTED
```

Failure:

```text
DRAFT / VALIDATED
 ↓
REJECTED
```

A posted journal is immutable.

---

# 17. Journal Types

Typical journal types include:

```text
SAVINGS_CONTRIBUTION
LOAN_DISBURSEMENT
LOAN_REPAYMENT
INTEREST_ACCRUAL
FEE
PENALTY
REFUND
PAYMENT
SETTLEMENT
REVERSAL
ADJUSTMENT
WRITE_OFF
BILLING
TRANSFER
```

The exact enumeration may evolve, but journal types MUST remain explicit.

---

# 18. Journal Entry Model

A Journal Entry is one debit or credit leg.

Representative fields:

```text
_id
tenantId
journalId
accountId
entryNumber
direction
amount
currency
description
reference
metadata
createdAt
```

Direction:

```text
DEBIT
CREDIT
```

Each entry MUST belong to one journal.

---

# 19. Journal Entry Requirements

Every journal entry MUST have:

```text
tenantId
journalId
accountId
direction
amount
currency
```

Additional required metadata MAY include:

```text
transactionId
reference
sourceType
sourceId
```

Financial entries SHOULD be append-oriented.

---

# 20. Amount Rules

Amounts MUST:

```text
be numeric
be finite
respect configured precision
be greater than zero where an entry exists
have an explicit currency
```

Do not create zero-value journal entries unless the accounting design explicitly requires them.

---

# 21. Currency Rules

Every journal and journal entry MUST identify a currency.

At minimum:

```text
journal.currency
entry.currency
```

must be compatible.

For ordinary single-currency journals:

```text
journal.currency
=
every entry.currency
```

Foreign-exchange transactions require explicit FX modeling.

---

# 22. Precision and Rounding

Financial calculations MUST NOT depend on binary floating-point semantics.

The implementation MUST use a deterministic monetary representation such as:

```text
minor units
or
controlled decimal arithmetic
```

Rounding rules MUST be explicit.

Example policy:

```text
ROUND_HALF_UP
```

may be used where appropriate, but the actual accounting policy MUST determine the implementation.

---

# 23. Transaction Model

A Financial Transaction provides the authoritative business-level financial operation identity.

Representative fields:

```text
_id
tenantId
transactionNumber
transactionType
sourceType
sourceId
operationId
idempotencyKey
amount
currency
status
postingState
journalId
reference
correlationId
requestId
providerReference
postedAt
reversedAt
reversalOfTransactionId
createdAt
updatedAt
```

---

# 24. Transaction Lifecycle

Canonical lifecycle:

```text
CREATED
  ↓
VALIDATED
  ↓
POSTED
```

Failure:

```text
CREATED
  ↓
FAILED
```

Correction:

```text
POSTED
  ↓
REVERSED
```

The state machine MUST reject invalid transitions.

---

# 25. Transaction vs Payment Operation

A Payment Operation is an operational payment workflow.

A Financial Transaction represents its accounting effect.

Example:

```text
PaymentOperation
       ↓
Payment success
       ↓
Financial Transaction
       ↓
Journal
       ↓
Ledger
```

A payment may have multiple provider attempts but SHOULD result in a single authoritative financial transaction for one accounting event.

---

# 26. Transaction Identity

Every financial operation MUST have stable identity.

Recommended:

```text
transactionId
operationId
idempotencyKey
```

A provider reference MAY also exist.

These identities MUST NOT be treated as interchangeable.

---

# 27. Idempotency

Financial posting MUST be idempotent.

Recommended logical key:

```text
tenantId
+
operationType
+
operationId
+
idempotencyKey
```

Depending on the workflow, a scoped unique operation key MAY be sufficient.

The implementation MUST prevent:

```text
same logical operation
→
multiple financial postings
```

---

# 28. Idempotency Conflict

If an existing idempotency key is reused with a different request fingerprint:

```text
existingKey + differentPayload
```

the system MUST reject the request.

Recommended response classification:

```text
IDEMPOTENCY_CONFLICT
```

The existing operation MUST NOT be overwritten.

---

# 29. Request Fingerprint

Critical operations SHOULD store a deterministic fingerprint.

Example:

```text
SHA-256(canonical request)
```

Stored alongside:

```text
idempotencyKey
```

This protects against accidental or malicious key reuse.

---

# 30. Posting Engine

The Posting Engine is responsible for converting a validated financial instruction into an immutable ledger posting.

Responsibilities:

```text
load operation
validate tenant
validate accounts
validate currency
validate amount
validate period
validate state
validate idempotency
construct journal
construct entries
verify balance
persist atomically
create audit evidence
create outbox event
```

---

# 31. Posting Pipeline

Canonical posting pipeline:

```text
Financial Command
      ↓
Authentication / Authorization
      ↓
Tenant Validation
      ↓
Business Validation
      ↓
Idempotency Validation
      ↓
Account Validation
      ↓
Period Validation
      ↓
Journal Construction
      ↓
Entry Construction
      ↓
Balance Validation
      ↓
Atomic Persistence
      ↓
Audit
      ↓
Outbox
      ↓
Posted
```

---

# 32. Posting Preconditions

Before posting, the system MUST validate:

```text
transaction exists
tenant exists
tenant is active where required
accounts exist
accounts belong to tenant
accounts are active
currency matches
amounts are valid
journal balances
financial period is open
idempotency has not already been consumed
state transition is valid
```

---

# 33. Atomic Posting

A financial posting SHOULD execute atomically.

Preferred conceptual transaction:

```text
BEGIN
  create transaction state
  create journal
  create journal entries
  update account balances
  create audit event
  create outbox event
COMMIT
```

If any required operation fails:

```text
ROLLBACK
```

No partial financial state may remain.

---

# 34. MongoDB Transaction Boundary

Where MongoDB transactions are used, the ledger posting SHOULD ensure that:

```text
Transaction
Journal
JournalEntry
Account Balance State
Audit Evidence
Outbox Event
```

are committed consistently where those records are part of the same atomic accounting operation.

Operational side effects such as external provider API calls MUST NOT be included inside an uncontrolled database transaction.

---

# 35. External Payment Boundary

A payment provider call and a database transaction are separate systems.

Do not assume:

```text
MongoDB transaction
+
MTN/Airtel API
=
one atomic transaction
```

Instead use:

```text
Payment Operation
→ Provider Interaction
→ Verified Result
→ Financial Posting
```

with idempotency and reconciliation.

---

# 36. Unknown External Outcome

If an external payment call times out after submission, the platform MUST NOT assume failure.

Possible state:

```text
UNKNOWN
```

Resolution MUST occur through:

```text
provider status query
callback
statement reconciliation
manual investigation
```

Never blindly re-submit an unknown financial payment.

---

# 37. Double-Entry Validation

A journal is balanced only when:

```text
SUM(DEBIT entries)
=
SUM(CREDIT entries)
```

Comparison MUST use the platform's monetary precision rules.

Example:

```text
Debit:
Cash                 100,000 UGX

Credit:
Member Savings       100,000 UGX
```

Balanced:

```text
100,000 = 100,000
```

---

# 38. Multi-Line Posting

Example loan disbursement:

```text
DEBIT
Loan Receivable             1,000,000

CREDIT
Cash / Settlement           1,000,000
```

Example fee allocation:

```text
DEBIT
Cash / Settlement           1,050,000

CREDIT
Loan Principal              1,000,000
Fee Revenue                    50,000
```

The actual account mappings MUST be determined by approved accounting policy.

---

# 39. Loan Disbursement Posting

A typical architecture:

```text
Loan Disbursement
      ↓
Payment Operation
      ↓
Financial Transaction
      ↓
Journal
      ├── Debit: Loan Receivable
      └── Credit: Cash / Settlement
```

The loan MUST NOT be marked financially disbursed merely because the payment request was sent.

---

# 40. Loan Repayment Posting

A repayment SHOULD allocate funds according to approved allocation policy.

Example:

```text
DEBIT
Cash / Settlement              100,000

CREDIT
Interest Receivable             10,000
Fee Receivable                   5,000
Loan Principal                  85,000
```

The exact allocation order MUST be defined by product/accounting rules.

---

# 41. Savings Contribution Posting

Typical pattern:

```text
DEBIT
Cash / Mobile Money             50,000

CREDIT
Member Savings Liability        50,000
```

The member-facing savings balance is derived from authoritative financial state.

---

# 42. Interest Accrual

Interest accrual is an accounting operation.

A typical pattern:

```text
DEBIT
Interest Receivable

CREDIT
Interest Income
```

Accrual MUST be:

```text
deterministic
idempotent
period-aware
auditable
```

The same accrual period MUST NOT be posted twice.

---

# 43. Interest Accrual Identity

An accrual SHOULD have a unique operational identity:

```text
tenantId
+
account/loan
+
accrualPeriod
+
policyVersion
```

This prevents duplicate accrual postings.

---

# 44. Fees and Charges

Fees MUST be represented as explicit financial operations.

Typical pattern:

```text
DEBIT
Customer / Cash / Receivable

CREDIT
Fee Revenue
```

The actual debit depends on whether the fee is collected immediately or accrued.

---

# 45. Penalties

Penalties MUST be explicitly identified.

The system MUST distinguish:

```text
assessed
accrued
collected
waived
reversed
```

A penalty waiver MUST NOT simply delete the original penalty history.

---

# 46. Refunds

A refund MUST be represented as a new financial operation.

It MUST reference:

```text
originalTransactionId
```

where applicable.

Refunds MUST NOT mutate the original posted transaction.

---

# 47. Reversals

A reversal is a compensating accounting event.

Example:

Original:

```text
DEBIT
Loan Receivable       1,000,000

CREDIT
Cash                  1,000,000
```

Reversal:

```text
DEBIT
Cash                  1,000,000

CREDIT
Loan Receivable       1,000,000
```

The original journal remains immutable.

---

# 48. Reversal Rules

A reversal MUST:

```text
reference original transaction
have a new transaction identity
have a new journal
have compensating entries
record reversal reason
record requesting actor
record approving actor where required
remain auditable
```

A transaction MUST NOT be reversed twice unless explicitly modeled as a controlled multi-step process.

---

# 49. Partial Reversals

Partial reversals MAY be supported.

A partial reversal MUST record:

```text
originalTransactionId
reversedAmount
remainingReversibleAmount
reason
```

The total reversal amount MUST NOT exceed the eligible original amount.

---

# 50. Adjustments

Adjustments are controlled accounting corrections.

An adjustment MUST include:

```text
reasonCode
description
sourceType
sourceId
amount
currency
requester
approver where required
resulting transaction
```

Adjustments MUST NOT be used as a convenience mechanism to bypass missing domain logic.

---

# 51. Manual Adjustments

Manual financial adjustments require stronger controls.

Recommended:

```text
request
→ approval
→ posting
→ audit
```

The requester and approver SHOULD be different individuals for material amounts.

---

# 52. Write-Offs

A write-off changes the treatment of a receivable.

It MUST NOT delete or silently reduce historical loan transactions.

A write-off SHOULD generate an explicit accounting entry.

Example:

```text
DEBIT
Write-Off Expense

CREDIT
Loan Receivable
```

The exact accounting treatment depends on the organization's financial policy.

---

# 53. Transfers

Transfers MUST be modeled as balanced internal financial operations.

Example:

```text
DEBIT
Destination Account

CREDIT
Source Account
```

Both accounts MUST:

```text
belong to the same permitted tenant scope
have compatible currencies
be active
```

Cross-currency transfers require explicit FX treatment.

---

# 54. Suspense Accounts

Suspense accounts MAY be used for controlled unmatched financial amounts.

Suspense records MUST be:

```text
visible
reconciled
aged
audited
resolved
```

Suspense MUST NOT become a permanent dumping ground for unexplained balances.

---

# 55. Clearing Accounts

Clearing accounts SHOULD represent money in transit.

Examples:

```text
MTN Clearing
Airtel Clearing
Bank Clearing
Settlement Clearing
```

The platform MUST have reconciliation processes to move cleared balances into final accounts.

---

# 56. Payment Provider Clearing

A payment provider interaction SHOULD commonly use:

```text
Customer Account
      ↕
Provider Clearing Account
      ↕
Settlement Account
```

The exact accounting depends on when financial ownership changes.

Accounting treatment MUST be approved before implementation.

---

# 57. Settlement Posting

Settlement SHOULD reconcile:

```text
provider-side transaction
        ↕
internal payment operation
        ↕
ledger transaction
```

Settlement MAY create:

```text
settlement entries
provider fee entries
FX adjustments
exception adjustments
```

All postings remain idempotent and auditable.

---

# 58. Statement-Based Reconciliation

The statement pipeline:

```text
Import
 ↓
Normalize
 ↓
Validate
 ↓
Batch
 ↓
Claim
 ↓
Match
 ↓
Reconcile
 ↓
Exception / Repair
 ↓
Ledger Adjustment
```

A statement is evidence.

It is not automatically authoritative over the ledger until validated and reconciled.

---

# 59. Reconciliation States

Recommended states:

```text
UNMATCHED
PARTIALLY_MATCHED
MATCHED
EXCEPTION
RESOLVED
```

Reconciliation records MUST preserve history.

A resolved exception MUST remain traceable to its original state.

---

# 60. Financial Periods

Financial periods control when posting is permitted.

Lifecycle:

```text
OPEN
 ↓
SOFT_CLOSE
 ↓
FINAL_CLOSE
 ↓
LOCKED
```

---

# 61. Open Period

An `OPEN` period permits ordinary posting subject to other controls.

---

# 62. Soft Close

A `SOFT_CLOSE` period indicates that ordinary operations are substantially complete but controlled adjustments may still be permitted.

Rules MUST be explicit.

---

# 63. Final Close

A `FINAL_CLOSE` period prevents ordinary posting and prepares the period for permanent closure.

Financial integrity checks SHOULD run before completion.

---

# 64. Locked Period

A `LOCKED` period MUST reject ordinary financial posting.

Corrections require a controlled adjustment process, potentially in a subsequent period.

Historic locked entries MUST remain immutable.

---

# 65. Backdated Transactions

Backdated posting MUST be explicitly controlled.

Before accepting a historical posting, validate:

```text
target period
period status
accounting policy
cutoff rules
approval requirements
reconciliation impact
```

Backdating MUST NOT bypass period controls.

---

# 66. Accounting Date vs System Date

The ledger SHOULD distinguish:

```text
transactionDate
postingDate
effectiveDate
createdAt
```

Definitions MUST be documented.

Example:

```text
transactionDate
→ business event date

postingDate
→ accounting ledger date

createdAt
→ system persistence timestamp
```

---

# 67. Ledger Balances

The platform SHOULD distinguish:

```text
Ledger Balance
Available Balance
Pending Balance
Reserved Balance
Current Balance
```

Definitions MUST remain consistent across APIs and services.

---

# 68. Ledger Balance

Ledger Balance represents the authoritative posted financial position according to ledger rules.

It derives from posted entries.

---

# 69. Available Balance

Available Balance is the amount available for a particular permitted action.

It MAY be:

```text
ledger balance
-
holds
-
reserved amounts
-
pending restrictions
```

The calculation MUST be deterministic.

---

# 70. Pending Balance

Pending Balance represents funds associated with operations that have not reached final accounting state.

Pending funds MUST NOT be treated as posted money.

---

# 71. Reserved Balance

Reserved Balance represents amounts blocked for a known obligation or operation.

Examples:

```text
loan reserve
payment reservation
withdrawal hold
```

Reservations MUST be explicitly modeled.

---

# 72. Balance Authority

Balance calculation MUST derive from authoritative ledger state and approved pending/reservation models.

No service may arbitrarily overwrite:

```text
ledgerBalance
```

through a convenience update.

---

# 73. Balance Updates

Account balance updates MUST occur through controlled ledger operations.

Preferred:

```text
posting
→ balance impact
```

Avoid:

```text
account.balance += amount
```

outside the Financial Core.

---

# 74. Balance Snapshots

Snapshots improve read performance and support historical reporting.

Snapshot fields MAY include:

```text
accountId
tenantId
asOf
ledgerBalance
availableBalance
pendingBalance
reservedBalance
currency
sourceTransactionId
snapshotVersion
```

Snapshots are derived data.

They are not the primary accounting record.

---

# 75. Snapshot Integrity

Each snapshot SHOULD record:

```text
source position
calculation version
timestamp
```

Integrity checks SHOULD compare snapshot state against ledger state.

---

# 76. Transaction Ordering

Financial transactions SHOULD carry ordering information where necessary:

```text
sequence
postingDate
effectiveDate
createdAt
```

Ordering MUST be deterministic enough to reproduce balances.

---

# 77. Concurrency Model

Ledger posting is concurrency-sensitive.

Controls SHOULD include:

```text
unique operation keys
atomic writes
transactions
optimistic concurrency
account versioning
state preconditions
```

Two workers processing the same financial operation MUST NOT both successfully post it.

---

# 78. Optimistic Concurrency

Where versioning is used:

```text
version = expectedVersion
```

must be part of the update condition.

If version changes:

```text
CONFLICT
```

The operation MUST be retried/reconciled rather than blindly overwritten.

---

# 79. Atomic Account Updates

When a posting affects account balance state, all required account updates SHOULD be atomic.

A partially applied journal is unacceptable.

---

# 80. Race Condition Prevention

Bad:

```text
read balance
calculate new balance
write balance
```

when multiple workers may execute concurrently.

Preferred:

```text
validated atomic transaction
+
unique posting identity
+
expected state/version
```

---

# 81. Duplicate Posting Protection

The ledger MUST guard against duplicates through multiple layers:

```text
business operation identity
idempotency key
unique database constraint
transaction state
journal state
```

Defense in depth is required.

---

# 82. Orphan Prevention

A posted transaction MUST NOT exist without a corresponding journal.

A posted journal MUST NOT exist without its required entries.

Journal entries MUST reference valid accounts.

---

# 83. Orphan Detection

Ledger integrity jobs SHOULD detect:

```text
transaction without journal
journal without transaction
journal without entries
entries without account
duplicate operation
duplicate journal
invalid tenant relationship
unbalanced journal
```

---

# 84. Ledger Integrity Job

A periodic integrity job SHOULD verify:

```text
journal balance
account references
transaction references
tenant consistency
currency consistency
state consistency
period consistency
duplicate identities
snapshot consistency
```

Critical violations MUST generate alerts.

---

# 85. Financial Reconciliation Levels

The platform SHOULD support:

```text
Level 1 — Transaction Reconciliation
Level 2 — Settlement Reconciliation
Level 3 — Account Reconciliation
Level 4 — Ledger Integrity Reconciliation
Level 5 — Financial Statement Reconciliation
```

---

# 86. Transaction Reconciliation

Matches internal transaction records against provider or operational sources.

---

# 87. Settlement Reconciliation

Matches provider settlement results against internal financial operations.

---

# 88. Account Reconciliation

Validates account balances against underlying journal entries.

---

# 89. Ledger Reconciliation

Validates:

```text
journal totals
account movements
period movements
snapshot values
```

against financial rules.

---

# 90. Financial Statement Reconciliation

Statement generation MUST reconcile to the ledger.

Examples:

```text
Balance Sheet
Income Statement
Cash Position
Loan Portfolio
Member Savings
```

Financial reporting MUST be derived from controlled ledger data.

---

# 91. Financial Statement Rule

No reporting service may invent financial totals independently.

Preferred:

```text
Ledger
 ↓
Controlled Reporting Query / Projection
 ↓
Financial Statement
```

---

# 92. Audit Trail

Every material financial action MUST be auditable.

Minimum context:

```text
tenantId
actorId
operationId
transactionId
requestId
correlationId
timestamp
action
result
reason
```

---

# 93. Financial Event Auditability

Financial operations SHOULD produce:

```text
transaction event
audit event
outbox event
```

within the appropriate transaction boundary.

---

# 94. Reversal Auditability

Reversals MUST preserve:

```text
original transaction
reversal transaction
reason
requester
approver
timestamp
correlation
```

---

# 95. Manual Journal Security

Manual journals MUST require:

```text
authorization
reason
balanced entries
audit
approval where required
```

Users MUST NOT have a generic ability to manipulate arbitrary account balances.

---

# 96. General Ledger vs Subledger

The platform SHOULD distinguish:

```text
General Ledger
```

from operational subledgers such as:

```text
Loan Subledger
Savings Subledger
Payments Subledger
Provider Settlement Subledger
```

The subledger provides operational detail.

The General Ledger remains the accounting authority.

---

# 97. Subledger Principle

A subledger MAY maintain operational state.

It MUST reconcile to corresponding General Ledger accounts.

Example:

```text
Loan Portfolio Subledger Total
=
Corresponding Loan Receivable Ledger Balance
```

Differences MUST produce reconciliation exceptions.

---

# 98. Loan Subledger

Loan records SHOULD track:

```text
principal
interest
fees
penalties
write-offs
repayments
```

The cumulative accounting result MUST reconcile to ledger accounts.

---

# 99. Savings Subledger

Savings accounts MAY track:

```text
member contribution activity
withdrawal activity
savings product metadata
```

Total financial value MUST reconcile to the member savings liability accounts.

---

# 100. Payment Subledger

Payment operations SHOULD track:

```text
initiated
processing
success
failed
reversed
```

The resulting financial position MUST map to ledger transactions.

---

# 101. Provider Settlement Subledger

Provider settlement records SHOULD maintain:

```text
provider gross
provider fees
net amount
internal matched amount
unmatched amount
settled amount
```

The net effect MUST reconcile with ledger settlement accounts.

---

# 102. Financial Event Model

Financial events SHOULD use explicit names.

Examples:

```text
financial.transaction.posted
financial.transaction.reversed
financial.journal.posted
financial.adjustment.created
financial.period.closed
financial.account.balance.changed
```

Events MUST be versioned.

---

# 103. Outbox Integration

When an operation modifies financial state and requires an event:

```text
Financial Write
+
Outbox Event
```

SHOULD commit atomically.

This prevents:

```text
ledger committed
event lost
```

from leaving downstream systems permanently inconsistent.

---

# 104. Event Metadata

Financial events SHOULD include:

```text
eventId
eventType
eventVersion
tenantId
transactionId
journalId
accountId where applicable
operationId
correlationId
causationId
occurredAt
```

---

# 105. Event Payload Security

Events MUST NOT expose:

```text
passwords
tokens
provider secrets
private keys
unnecessary PII
```

Financial events should contain only the data required by consumers.

---

# 106. Financial Event Consumers

Consumers MUST be idempotent.

Example:

```text
same event
received twice
```

must not create:

```text
duplicate notification
duplicate settlement
duplicate financial posting
```

where the consumer is not inherently repeatable.

---

# 107. Financial Workflow Boundary

The ledger is not a workflow engine.

Workflow state belongs to:

```text
PaymentOperation
WorkflowOperation
Loan
Settlement
BillingOperation
```

The ledger records the financial result.

---

# 108. Payment Workflow vs Ledger

Example:

```text
PaymentOperation
INITIATED
 ↓
PROCESSING
 ↓
SUCCESS
 ↓
Financial Posting
 ↓
POSTED
```

A payment workflow MUST NOT mark itself financially complete without verifying the corresponding ledger state when accounting is required.

---

# 109. Settlement Workflow vs Ledger

Settlement may have operational state:

```text
IMPORTED
PROCESSING
RECONCILING
PARTIALLY_RECONCILED
RECONCILED
```

The ledger only changes after the appropriate financial event is validated.

---

# 110. Billing Ledger Integration

Tenant SaaS billing MAY produce financial ledger entries where accounting requires it.

Subscription state remains owned by SaaS/Billing.

Accounting state remains owned by Financial Core.

Example:

```text
Subscription Invoice
      ↓
Billing Operation
      ↓
Financial Transaction
      ↓
Journal
```

---

# 111. Billing Separation

Do not confuse:

```text
subscription state
```

with:

```text
accounting state
```

A subscription being active does not imply that an invoice was financially settled.

---

# 112. Fees and Provider Charges

External provider fees SHOULD be explicitly accounted for.

Example:

```text
DEBIT
Provider Expense

CREDIT
Provider Clearing / Payable
```

The precise treatment depends on the organization's accounting policy.

---

# 113. Suspense and Exceptions

When a transaction cannot be confidently classified:

```text
Do not guess.
Do not silently post.
Do not discard.
```

Use:

```text
exception
or
controlled suspense
```

Then resolve through reconciliation.

---

# 114. Financial Repair Service

Repair operations SHOULD:

```text
identify exception
validate source evidence
calculate correction
create controlled adjustment
post correction
record resolution
close exception
```

Repair MUST never directly overwrite historical entries.

---

# 115. Ledger Repair Safety

Repair tools SHOULD require:

```text
strong authorization
reason code
target transaction
before/after evidence
approval where required
audit
```

---

# 116. Financial Period Close Procedure

Before closing a period:

```text
1. Validate all journals.
2. Verify debits = credits.
3. Resolve critical reconciliation exceptions.
4. Validate account balances.
5. Run ledger integrity checks.
6. Validate snapshots.
7. Produce closing reports.
8. Record closing operation.
9. Lock posting according to period policy.
```

---

# 117. Period Close Idempotency

Closing a period MUST be idempotent.

Repeated close commands MUST NOT corrupt the period.

Use:

```text
closeRunId
periodId
operationKey
```

as appropriate.

---

# 118. Period Reopening

Reopening a final/locked period SHOULD be exceptional.

It requires:

```text
privileged authorization
reason
approval
audit
post-reopen validation
```

Prefer controlled adjustment in the next period where policy permits.

---

# 119. Balance Recalculation

The platform SHOULD support controlled balance recomputation from ledger history.

Purpose:

```text
audit
reconciliation
recovery
repair verification
```

Recalculation MUST NOT silently mutate authoritative data.

---

# 120. Reconciliation Difference

When:

```text
derived balance ≠ stored balance
```

the system MUST:

```text
raise an integrity exception
```

rather than automatically overwriting the stored value.

---

# 121. Data Integrity Hashing

Critical records MAY use cryptographic hashes for tamper evidence.

Possible targets:

```text
journal canonical payload
statement file
regulatory submission
audit record
provider callback
```

Example:

```text
SHA-256(canonical representation)
```

Hashes are integrity controls, not replacements for authorization.

---

# 122. Canonical Journal Representation

For hashing/auditing, a journal SHOULD have deterministic field ordering.

Conceptually:

```text
tenantId
transactionId
journalType
currency
postingDate
ordered entries
```

The serialization method MUST be deterministic.

---

# 123. Ledger Sequence

The platform MAY maintain a tenant-scoped posting sequence.

Example:

```text
transactionNumber
journalNumber
```

Sequences SHOULD be:

```text
monotonic where practical
tenant-scoped where appropriate
auditable
not relied upon for authorization
```

---

# 124. Sequence Gaps

Sequence gaps MAY occur because operations can fail or be rolled back.

A gap does not necessarily indicate data loss.

The architecture MUST distinguish:

```text
missing sequence
```

from:

```text
missing financial record
```

---

# 125. Financial Transaction References

Each posting SHOULD have a human-traceable reference.

Examples:

```text
transactionNumber
journalNumber
accountNumber
providerReference
loanNumber
paymentReference
```

References are operational aids and do not replace internal IDs.

---

# 126. Financial Search

Operational search SHOULD support:

```text
transactionNumber
journalNumber
operationId
idempotencyKey
providerReference
accountId
loanId
memberId
date range
status
```

Search MUST remain tenant-scoped.

---

# 127. Financial Data Access

Read access MUST be permission-controlled.

Write access to the ledger MUST be more restrictive than ordinary financial read access.

Suggested access tiers:

```text
Ledger Viewer
Ledger Operator
Ledger Poster
Ledger Approver
Ledger Administrator
Auditor
```

---

# 128. Ledger Administrator

Ledger administrator permissions SHOULD remain highly restricted.

Potential capabilities:

```text
chart-of-accounts management
financial period controls
reversal controls
adjustment controls
integrity operations
```

Direct record editing is prohibited.

---

# 129. Financial Segregation of Duties

At minimum, material operations SHOULD distinguish:

```text
requester
approver
poster
```

Automated workflows MAY collapse roles only when the risk profile permits it and the control is documented.

---

# 130. Audit Evidence

Financial audit evidence SHOULD allow reconstruction:

```text
Who initiated?
What happened?
When?
For which tenant?
For which account?
For what amount?
Why?
Which operation?
Which transaction?
Which journal?
Which entries?
Which provider reference?
What was the result?
```

---

# 131. Security of Ledger Data

Financial database access MUST be:

```text
authenticated
least-privileged
encrypted
audited where appropriate
network-restricted
```

Ordinary application users MUST NOT receive raw database credentials.

---

# 132. Backup and Recovery

The ledger MUST have reliable backups.

Recovery testing MUST verify:

```text
journal completeness
entry completeness
transaction uniqueness
account relationships
period state
outbox recoverability
```

---

# 133. Recovery After Database Failure

After restore:

```text
1. Validate database integrity.
2. Run ledger integrity checks.
3. Validate unique financial keys.
4. Validate outbox state.
5. Validate job claims.
6. Reconcile provider transactions.
7. Validate account balances.
8. Compare snapshots.
9. Approve return to service.
```

---

# 134. Recovery After Provider Outage

When a provider is unavailable:

```text
do not create duplicate payment operations
do not assume success/failure without evidence
retain operation state
retry according to policy
reconcile unknown outcomes
```

Provider outage MUST NOT automatically compromise ledger integrity.

---

# 135. Recovery After Partial Workflow Failure

Example:

```text
Provider succeeded
Database confirmation failed
```

The operation enters:

```text
UNKNOWN / RECONCILIATION_REQUIRED
```

Recovery relies on:

```text
provider status
callback
statement
reconciliation
```

Do not simply repeat the payment.

---

# 136. Financial Observability

Ledger operations SHOULD emit metrics including:

```text
ledger_postings_total
ledger_posting_failures_total
ledger_reversals_total
ledger_adjustments_total
ledger_integrity_failures_total
unbalanced_journal_attempts_total
idempotency_conflicts_total
financial_period_closes_total
reconciliation_exceptions_total
```

---

# 137. Ledger Tracing

Financial workflows SHOULD propagate:

```text
traceId
spanId
correlationId
requestId
tenantId
transactionId
operationId
```

A financial operation should be traceable from:

```text
API
→ application service
→ payment/loan/savings workflow
→ ledger
→ database
→ event
```

---

# 138. Financial Logging

Structured logs SHOULD record:

```text
tenantId
transactionId
journalId
operationId
accountId
event
status
amount
currency
providerReference where applicable
```

Sensitive credentials MUST never be logged.

---

# 139. Amount Logging

Operational logs MAY record:

```text
amount
currency
```

when necessary for troubleshooting.

However:

```text
full account credentials
secret payment information
unnecessary PII
```

must be excluded.

---

# 140. Financial Error Model

Recommended categories:

```text
INVALID_FINANCIAL_COMMAND
ACCOUNT_NOT_FOUND
ACCOUNT_INACTIVE
ACCOUNT_TENANT_MISMATCH
CURRENCY_MISMATCH
INVALID_AMOUNT
JOURNAL_UNBALANCED
PERIOD_CLOSED
DUPLICATE_OPERATION
IDEMPOTENCY_CONFLICT
INVALID_STATE
ALREADY_REVERSED
REVERSAL_EXCEEDS_ORIGINAL
CONCURRENCY_CONFLICT
RECONCILIATION_REQUIRED
FINANCIAL_INTEGRITY_FAILURE
```

Errors MUST be machine-readable.

---

# 141. Fail-Closed Financial Behavior

When financial integrity cannot be established:

```text
DO NOT POST
```

Examples:

```text
unknown account
unknown currency
invalid period
ambiguous operation
duplicate identity
unbalanced journal
unknown provider state
```

The safe behavior is to stop and reconcile.

---

# 142. Financial Command Contract

A financial posting request SHOULD contain:

```text
tenantId
operationId
idempotencyKey
transactionType
sourceType
sourceId
amount
currency
postingDate
requestedBy
correlationId
metadata
```

The exact contract may differ by workflow.

---

# 143. Posting Instruction

Before touching the database, business services SHOULD construct an explicit posting instruction.

Example concept:

```text
{
  transactionType,
  amount,
  currency,
  debitAccount,
  creditAccount,
  sourceType,
  sourceId,
  operationId,
  idempotencyKey,
  reason
}
```

This creates a clear boundary between business logic and accounting execution.

---

# 144. Multi-Line Posting Instruction

For multi-line journals:

```text
{
  currency,
  operationId,
  lines: [
    {
      accountId,
      direction,
      amount
    },
    {
      accountId,
      direction,
      amount
    }
  ]
}
```

The Posting Engine owns balance validation.

---

# 145. Posting Validation Order

Recommended order:

```text
1. Command schema
2. Authentication context
3. Authorization
4. Tenant scope
5. Idempotency
6. Amount/currency
7. Account existence
8. Account state
9. Financial period
10. Business state
11. Journal construction
12. Debit/credit balancing
13. Concurrency checks
14. Persistence
```

---

# 146. Financial State Transitions

Financial state changes MUST occur through explicit transitions.

Example:

```text
CREATED
→ VALIDATED
→ POSTED
```

Do not allow arbitrary:

```text
status = "POSTED"
```

updates from generic repository methods.

---

# 147. Reversal Eligibility

A transaction is reversible only when:

```text
POSTED
```

and:

```text
not already fully reversed
```

subject to:

```text
period policy
approval policy
business rules
```

---

# 148. Refund vs Reversal

A reversal corrects accounting for a prior posted transaction.

A refund is a new customer-facing financial event that returns money.

They may produce similar accounting effects but have different business semantics.

Do not conflate them.

---

# 149. Adjustment vs Reversal

Use:

```text
Reversal
```

when the original transaction itself is incorrect and should be economically negated.

Use:

```text
Adjustment
```

when a new correction is required without simply negating the original event.

---

# 150. Financial Ledger Production Gate

The Financial Core is production-ready only when:

```text
[ ] Chart of accounts defined
[ ] Account ownership enforced
[ ] Tenant isolation enforced
[ ] Double-entry validation implemented
[ ] Posting transactionality implemented
[ ] Idempotency implemented
[ ] Duplicate constraints implemented
[ ] State machine implemented
[ ] Immutable posting implemented
[ ] Reversal framework implemented
[ ] Adjustment framework implemented
[ ] Financial periods implemented
[ ] Balance service implemented
[ ] Snapshot controls implemented
[ ] Reconciliation implemented
[ ] Audit trail implemented
[ ] Outbox/event integration implemented
[ ] Ledger integrity job implemented
[ ] Observability implemented
[ ] Recovery tested
[ ] Security controls tested
```

---

# 151. Financial Integration Production Gate

A provider/payment integration is production-ready only when:

```text
[ ] Authentication secured
[ ] Provider credentials externalized
[ ] Timeout defined
[ ] Retry policy defined
[ ] Idempotency defined
[ ] Provider reference uniqueness defined
[ ] Callback signature verification defined
[ ] Callback replay protection defined
[ ] Unknown outcome handling defined
[ ] Settlement reconciliation defined
[ ] Ledger posting rules defined
[ ] Failure recovery defined
[ ] Audit trail implemented
[ ] Monitoring implemented
```

---

# 152. Example: Successful Savings Contribution

```text
Member
  ↓
SavingsAccount
  ↓
Contribution Request
  ↓
Idempotency Check
  ↓
Payment Operation
  ↓
Provider / Cash Confirmation
  ↓
Financial Transaction
  ↓
Journal
  ├── DEBIT  Cash / Mobile Money
  └── CREDIT Savings Liability
  ↓
POSTED
  ↓
Audit
  ↓
Outbox
  ↓
Notification / Reporting
```

---

# 153. Example: Failed Savings Contribution

```text
Contribution
  ↓
Payment Attempt
  ↓
Provider Failure
  ↓
PaymentOperation = FAILED
  ↓
No Financial Posting
```

No ledger transaction is created unless a real financial effect occurred.

---

# 154. Example: Successful Loan Disbursement

```text
Approved Loan
  ↓
Disbursement Request
  ↓
Payment Operation
  ↓
Provider Confirmation
  ↓
Financial Transaction
  ↓
Journal
  ├── DEBIT  Loan Receivable
  └── CREDIT Provider Clearing
  ↓
POSTED
  ↓
Loan = ACTIVE / DISBURSED
  ↓
Settlement
```

The exact ordering of business and accounting state transitions MUST be designed so that neither side falsely claims completion.

---

# 155. Example: Provider Settlement

```text
Provider Statement
  ↓
Statement Import
  ↓
Validation
  ↓
Matching
  ↓
Settlement Reconciliation
  ↓
Matched Transactions
  ↓
Financial Settlement Posting
  ↓
Journal
  ↓
Reconciled
```

---

# 156. Example: Manual Adjustment

```text
Investigation
  ↓
Adjustment Request
  ↓
Reason
  ↓
Approval
  ↓
Posting Instruction
  ↓
Ledger
  ↓
Balanced Journal
  ↓
Audit
  ↓
Reconciliation
```

No direct database update is permitted.

---

# 157. Financial Data Model Relationships

```text
Transaction
   │
   └── Journal
         │
         └── JournalEntry
                │
                └── Account
```

Supporting:

```text
Transaction
   ├── PaymentOperation
   ├── Loan
   ├── SavingsAccount
   ├── Settlement
   └── BillingOperation
```

---

# 158. Canonical Financial Trace

Every major financial event SHOULD be traceable as:

```text
Customer / Business Event
        ↓
Business Entity
        ↓
Operation
        ↓
Financial Transaction
        ↓
Journal
        ↓
Journal Entries
        ↓
Accounts
        ↓
Balance
        ↓
Audit
        ↓
Event
        ↓
Reconciliation
```

---

# 159. Data Immutability Rules

The following MUST NOT be edited after posting in a way that changes financial meaning:

```text
transaction amount
transaction currency
journal identity
journal entries
debit/credit direction
account referenced by posted entry
posting date where accounting immutability requires it
```

Any correction MUST create a new financial record.

---

# 160. Metadata Updates

Administrative metadata MAY be corrected if allowed:

```text
display description
supporting reference
internal annotations
```

But financial meaning MUST remain unchanged.

Every permitted post-posting metadata edit SHOULD be audited.

---

# 161. Financial Record Deletion

Posted financial records MUST NOT be deleted.

Database-level deletion access SHOULD be disabled or heavily restricted for ledger collections.

Retention policies MUST preserve legally required financial history.

---

# 162. Financial Collection Access

Recommended logical access:

```text
Application Financial Service
    → controlled read/write

Reporting
    → read-only

Auditor
    → read-only + audit access

Operations
    → restricted operational read

Support
    → limited read

General User
    → derived views only
```

No general support interface should provide raw journal-entry mutation.

---

# 163. Ledger Integrity Alerting

Critical alerts:

```text
unbalanced journal
duplicate posting identity
orphan journal
orphan entry
tenant mismatch
currency mismatch
negative impossible balance
closed-period posting
unauthorized adjustment
duplicate provider reconciliation
snapshot mismatch
```

---

# 164. Ledger Integrity Response

When integrity failure is detected:

```text
1. Stop affected operation.
2. Preserve evidence.
3. Mark affected scope.
4. Prevent further corrupting writes where necessary.
5. Investigate.
6. Reconcile.
7. Apply controlled correction.
8. Re-run integrity checks.
9. Record incident.
```

Automatic silent correction is prohibited for material financial integrity failures.

---

# 165. Accounting Policy Boundary

This specification defines the **technical ledger architecture**.

Actual accounting policies such as:

```text
interest recognition
fee recognition
penalty treatment
loan provisioning
write-off treatment
FX accounting
tax treatment
capital classification
```

MUST be approved by the appropriate finance/accounting authority.

Technical implementation MUST encode approved policy rather than invent accounting treatment.

---

# 166. Regulatory and Accounting Evidence

The ledger SHOULD be capable of supporting:

```text
transaction history
account statements
financial statements
settlement reconciliation
loan portfolio reporting
member savings reporting
audit examination
regulatory reporting
```

The exact regulatory obligations depend on jurisdiction and business model.

---

# 167. Financial Statement Generation

Financial statements MUST use controlled ledger aggregation.

Example:

```text
Account
 ↓
Account Type
 ↓
Trial Balance
 ↓
Financial Statement Mapping
 ↓
Statement
```

Every reported financial total MUST be traceable back to ledger accounts.

---

# 168. Trial Balance

The platform SHOULD support trial-balance generation.

At a minimum:

```text
Account
Debit Total
Credit Total
Net Balance
Currency
Period
```

The trial balance MUST satisfy the accounting balancing rules.

---

# 169. Trial Balance Integrity

A trial balance should confirm:

```text
Total Debits = Total Credits
```

Any difference MUST be treated as a critical financial integrity issue.

---

# 170. Account Statement

An account statement SHOULD contain:

```text
opening balance
transactions
debits
credits
running balance
closing balance
currency
date range
```

Statements MUST be derived from authoritative ledger data.

---

# 171. Running Balance Calculation

Running balance MUST be deterministic.

The calculation SHOULD account for:

```text
opening balance
ordered postings
reversals
adjustments
effective dates
```

The ordering rules MUST be documented.

---

# 172. Financial Export

Exports SHOULD preserve:

```text
transaction ID
transaction number
journal number
account
date
description
debit
credit
currency
balance
reference
```

Financial exports MUST not silently omit material historical records.

---

# 173. Financial Search Security

Search endpoints MUST:

```text
authenticate
authorize
scope tenant
limit page size
validate filters
audit sensitive searches where required
```

---

# 174. Financial API Principle

The API MUST expose financial state as controlled projections.

Clients MUST NOT be able to:

```text
set balance
set journal status
set transaction posted
set account balance
```

through ordinary REST fields.

---

# 175. Financial Command Principle

Use commands:

```text
POST /transactions
POST /payments
POST /reversals
POST /adjustments
POST /settlements
```

rather than generic mutable resource updates for important financial state.

---

# 176. Service Boundary

The preferred architecture is:

```text
Business Service
      ↓
Financial Command
      ↓
Ledger Service
      ↓
Posting Engine
```

Business services SHOULD provide financial intent.

The Posting Engine enforces accounting correctness.

---

# 177. Ledger Service Responsibilities

`ledgerService` SHOULD orchestrate:

```text
posting
reversal
adjustment
balance retrieval
transaction lookup
ledger validation
```

It SHOULD NOT contain provider-specific API logic.

---

# 178. Posting Engine Responsibilities

`postingEngine` SHOULD focus on:

```text
journal construction
entry construction
double-entry validation
atomic persistence
idempotency
state transition
```

---

# 179. Reversal Service Responsibilities

`reversalService` SHOULD:

```text
validate eligibility
construct compensating journal
create reversal relationship
persist atomically
audit
publish event
```

---

# 180. Balance Service Responsibilities

`balanceService` SHOULD:

```text
retrieve authoritative balances
calculate available state
resolve pending/reserved amounts
verify snapshot consistency
```

It MUST NOT invent accounting effects.

---

# 181. Snapshot Service Responsibilities

`snapshotService` SHOULD:

```text
create controlled snapshots
validate source state
store calculation version
support historical retrieval
support reconciliation
```

---

# 182. Period Close Service Responsibilities

`periodCloseService` SHOULD:

```text
validate period
run integrity checks
check unresolved exceptions
generate close evidence
transition period state
prevent invalid postings
```

---

# 183. Reconciliation Service Responsibilities

`reconciliationService` SHOULD:

```text
compare external and internal records
calculate differences
classify exceptions
trigger repair workflows
record resolution
```

It MUST NOT silently alter the ledger.

---

# 184. Financial Statement Service Responsibilities

`financialStatementService` SHOULD:

```text
aggregate ledger
apply approved account mappings
generate statements
validate totals
provide traceability
```

---

# 185. Interest Accrual Service Responsibilities

`interestAccrualService` SHOULD:

```text
calculate accrual
apply product policy
ensure idempotency
respect periods
create posting instructions
audit
```

---

# 186. Write-Off Service Responsibilities

`writeOffService` SHOULD:

```text
validate eligibility
require approval
calculate write-off
create posting
audit
update operational loan state
```

The ledger remains authoritative for accounting effect.

---

# 187. Financial Background Jobs

Recommended jobs include:

```text
ledgerIntegrityJob
interestAccrualJob
reconciliationJob
momoSettlementJob
airtelSettlementJob
snapshotJob
periodCloseJob
```

Jobs MUST be:

```text
idempotent
claimable
observable
retryable
recoverable
```

---

# 188. Financial Job Claiming

Workers SHOULD use:

```text
claimOwner
claimedAt
claimExpiresAt
```

A job MAY transition:

```text
PENDING
→ PROCESSING
→ COMPLETED
```

or:

```text
PROCESSING
→ FAILED
```

Expired claims SHOULD be recoverable.

---

# 189. Stale Worker Protection

A worker that loses ownership MUST NOT later complete the operation.

Completion SHOULD require:

```text
operationId
claimOwner
expectedState
```

matching current persisted state.

---

# 190. Financial Queue Security

Financial queue messages SHOULD carry:

```text
tenantId
operationId
jobId
correlationId
attempt
```

Sensitive financial payloads SHOULD be minimized.

---

# 191. Financial Retry Policy

Retry only when the failure is classified as retryable.

Retry classes MAY include:

```text
temporary provider error
temporary network failure
transient database error
queue delivery failure
```

Do not automatically retry:

```text
invalid account
unbalanced journal
tenant mismatch
authorization failure
period closed
idempotency conflict
business-rule rejection
```

---

# 192. Dead Letter Financial Operations

A failed financial workflow SHOULD enter a dead-letter or investigation queue when automatic recovery is exhausted.

Never discard failed financial operations.

---

# 193. Financial Replay

Replay MUST be controlled.

For financial operations:

```text
replay command
→ validate original identity
→ verify current state
→ verify idempotency
→ execute controlled recovery
```

Replaying a historical event MUST NOT create a second financial effect.

---

# 194. Financial Disaster Recovery Runbook

At minimum:

```text
1. Isolate affected service.
2. Stop new corrupting operations.
3. Confirm database health.
4. Validate ledger integrity.
5. Identify affected transaction range.
6. Compare against providers/subledgers.
7. Reconcile discrepancies.
8. Repair through reversals/adjustments.
9. Re-run integrity checks.
10. Approve service restoration.
11. Document incident.
```

---

# 195. Security Controls

Financial ledger access MUST enforce:

```text
authentication
authorization
tenant scope
least privilege
separation of duties
audit
encryption
secure secrets
```

---

# 196. Financial Threat Model

The ledger MUST defend against:

```text
duplicate posting
unauthorized posting
cross-tenant posting
ledger tampering
stale worker execution
callback replay
provider fraud
manual adjustment abuse
period manipulation
balance overwrite
audit deletion
```

---

# 197. Control Matrix

| Control            | Purpose                         |
| ------------------ | ------------------------------- |
| Double Entry       | Accounting integrity            |
| Idempotency        | Duplicate prevention            |
| Unique Constraints | Persistent duplicate prevention |
| Transactions       | Atomicity                       |
| State Machine      | Lifecycle integrity             |
| Immutable History  | Tamper resistance               |
| Reversals          | Safe correction                 |
| Adjustments        | Controlled correction           |
| Period Locks       | Historical accounting integrity |
| Reconciliation     | External/internal consistency   |
| Audit              | Accountability                  |
| Outbox             | Reliable event publication      |
| Claim Locks        | Worker concurrency              |
| Snapshots          | Efficient historical state      |
| Integrity Jobs     | Continuous validation           |

---

# 198. Non-Negotiable Prohibitions

The following are prohibited:

```text
1. Direct balance mutation outside the Financial Core.
2. Editing posted journal entries.
3. Deleting posted transactions.
4. Creating an unbalanced journal.
5. Posting without tenant context.
6. Posting to inactive/unknown accounts.
7. Posting into a locked period.
8. Reusing an idempotency key for a different command.
9. Retrying unknown payment outcomes blindly.
10. Trusting provider callbacks without verification.
11. Allowing stale workers to complete financial operations.
12. Treating Redis as authoritative financial storage.
13. Hiding financial exceptions.
14. Silently overwriting reconciliation differences.
15. Mutating financial history to “fix” reports.
```

---

# 199. Financial Architecture Invariants

The complete invariants are:

```text
1. Financial truth lives in the ledger.
2. Every posted journal is balanced.
3. Every financial record is tenant-scoped.
4. Every posting has stable operation identity.
5. Every retryable financial operation is idempotent.
6. Every posted record is immutable.
7. Corrections create new accounting events.
8. Period controls govern posting eligibility.
9. External provider state is reconciled.
10. Subledgers reconcile to the ledger.
11. Financial reporting is derived from controlled ledger data.
12. All material adjustments are authorized and auditable.
13. Background workers are concurrency-safe.
14. Events are durably published where required.
15. Ledger integrity is continuously validated.
16. Recovery preserves historical meaning.
17. Unknown financial outcomes require reconciliation.
18. No financial write bypasses the Posting Engine.
```

---

# 200. Final Ledger Principle

The TITech Community Capital Financial Ledger is not merely a balance table.

It is an **immutable, double-entry, tenant-aware, idempotent, auditable, reconciliation-driven financial system of record**.

The final governing rule is:

> **Every financial effect must be represented as an explicit, balanced accounting event; every event must have a traceable identity and tenant context; every posted result must be immutable; every correction must be compensating; every external financial state must be reconciled; and no application feature may bypass the Ledger and Posting Engine to change authoritative financial truth.**

---

# 201. Related Architecture Documents

This specification MUST remain aligned with:

```text
docs/02-architecture/ARCHITECTURE_MAP.md
docs/02-architecture/DATA_MODEL_CATALOGUE.md
docs/02-architecture/SECURITY_MODEL.md
docs/02-architecture/SERVICE_CATALOGUE.md
docs/02-architecture/API_CATALOGUE.md
docs/02-architecture/EVENT_CATALOGUE.md
docs/02-architecture/TRANSACTION_STATE_MACHINE.md
```

Implementation references SHOULD include:

```text
backend/modules/finance/
backend/modules/payment/
backend/modules/settlement/
backend/modules/models/
backend/modules/finance/statements/
```

Any implementation that changes the accounting meaning, posting semantics, balance semantics, reversal behavior, period controls, or financial data model MUST update this specification and undergo the appropriate architecture/finance review.

---

**End of Financial Ledger Specification**