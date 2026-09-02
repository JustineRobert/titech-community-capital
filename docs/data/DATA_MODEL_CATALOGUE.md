# TITech Community Capital Ltd — Data Model Catalogue

> **System:** Community Savings Platform
> **Document:** `docs/data/DATA_MODEL_CATALOGUE.md`
> **Status:** Enterprise Production Architecture Reference
> **Version:** 2.0
> **Last Updated:** August 16, 2026
> **Scope:** Core data model, financial domain model, operational data, security, compliance, SaaS tenancy, integrations, statements, events, auditability, and data governance.

---

# 1. Purpose

This document is the central catalogue of the TITech Community Capital Ltd Community Savings Platform data model.

It defines the logical entities, ownership boundaries, relationships, lifecycle rules, immutability requirements, tenant isolation requirements, indexing expectations, audit requirements, and financial integrity rules used throughout the platform.

This document is intended to support:

* Backend engineering
* Database engineering
* API design
* Service design
* Financial-engine implementation
* Reconciliation
* Payment integrations
* Compliance
* Reporting
* Analytics
* Security
* Testing
* Data migration
* Disaster recovery
* Observability
* Architecture governance

The catalogue is complementary to:

```text
docs/api/API_CATALOGUE.md
docs/api/BACKEND_API_SPECIFICATION.md
docs/api/API_REFERENCE_QUICK_START.md
docs/02-architecture/SERVICE_CATALOGUE.md
docs/02-architecture/DEPENDENCY_MAP.md
docs/02-architecture/EVENT_CATALOGUE.md
```

---

# 2. Data Architecture Principles

The platform data architecture follows these principles.

## 2.1 Single Source of Truth

Each critical business concept must have a clearly defined system of record.

Examples:

```text
User identity              -> User domain
Tenant identity            -> Tenant domain
Group membership           -> Membership domain
Loan lifecycle             -> Loan domain
Financial balances         -> Ledger/Finance domain
Payment provider state     -> Payment domain
Statement processing       -> Statement domain
Regulatory submissions     -> Compliance domain
Audit evidence             -> Audit domain
```

Derived data must never silently become an alternative source of truth.

---

## 2.2 Multi-Tenant Isolation

Tenant-scoped data must include or be resolvable to:

```text
tenantId
```

Tenant isolation must be enforced at repository/service boundaries, not merely in controllers.

Every tenant-scoped read/write must be constrained by the authenticated tenant context.

---

## 2.3 Financial Immutability

Financial records must be treated as immutable after posting.

The platform must not directly edit historical:

```text
posted journal entries
posted transactions
ledger postings
settlement postings
financial balances
```

Corrections must use controlled:

```text
reversal
adjustment
compensating transaction
write-off
```

mechanisms.

---

## 2.4 Double-Entry Integrity

Every posted financial transaction must balance.

For every journal:

```text
SUM(debits) = SUM(credits)
```

No financial operation may bypass the financial engine.

---

## 2.5 Explicit Lifecycle State

Entities with business workflows must have explicit state transitions.

Examples:

```text
Loan
Payment
Statement
Reconciliation
Subscription
KYC case
AML case
Forum moderation
Notification delivery
```

Clients must not be allowed to set arbitrary lifecycle states.

---

## 2.6 Auditability

Material business and administrative actions must be attributable to:

```text
who
what
when
where
why
requestId
tenantId
resource
outcome
```

---

## 2.7 Privacy by Design

Sensitive information should be:

* Minimized
* Access-controlled
* Encrypted where required
* Redacted from logs
* Retained according to policy
* Deleted/anonymized according to approved retention rules

---

## 2.8 Derived Data

Aggregates and reporting projections may be cached or materialized, but the underlying source records remain authoritative.

Examples:

```text
group contribution total
loan outstanding balance
dashboard counters
forum reply count
popular content score
risk scores
analytics aggregates
```

---

# 3. Data Domain Map

The platform is logically organized into the following domains.

| Domain         | Primary Data                                             |
| -------------- | -------------------------------------------------------- |
| Identity       | Users, credentials, sessions, verification               |
| Tenant/SaaS    | Tenants, plans, subscriptions, billing                   |
| Organization   | Groups, memberships, roles                               |
| Savings        | Contributions, contribution schedules                    |
| Finance        | Accounts, journals, journal entries, transactions        |
| Loans          | Products, applications, approvals, schedules, repayments |
| Payments       | Payment intents, provider transactions, callbacks        |
| Reconciliation | Matches, exceptions, repair actions                      |
| Statements     | Imported statements, batches, processing operations      |
| Compliance     | KYC, AML, risk, regulatory submissions                   |
| Communications | Notifications, delivery attempts, templates              |
| Chat           | Messages, reactions, flags                               |
| Help           | Articles, categories, feedback                           |
| FAQ            | Questions, answers, categories, feedback                 |
| Community      | Forum topics, replies, votes, tags, reports              |
| Referrals      | Codes, referrals, rewards                                |
| Audit          | Audit events, administrative actions                     |
| Events         | Domain events, outbox records                            |
| Observability  | Metrics, tracing metadata, operation status              |
| Risk/Fraud     | Risk assessments, alerts, anomaly results                |
| Reporting      | Dashboard projections, financial reports                 |

---

# 4. Identifier Standards

## 4.1 Primary Identifiers

Every persisted entity must have a stable unique identifier.

The implementation may use:

```text
MongoDB ObjectId
UUID
ULID
Database-native identifier
```

The selected physical implementation must remain consistent within the relevant domain.

---

## 4.2 Public Resource IDs

Public-facing IDs must not expose unnecessary database implementation details where this creates a security or enumeration risk.

Example:

```text
user_01J...
loan_01J...
payment_01J...
```

or the repository's established identifier format.

---

## 4.3 Correlation Identifiers

Operational transactions should support:

```text
requestId
traceId
correlationId
operationId
idempotencyKey
```

These are not substitutes for primary entity identifiers.

---

# 5. Core Identity Models

# 5.1 User

**Purpose:** Represents an authenticated platform user.

### Core Fields

```text
id
tenantId
name
email
phone
passwordHash
role
status
isVerified
verification metadata
preferences
createdAt
updatedAt
deletedAt
version
```

### Security Rules

Never expose:

```text
passwordHash
refreshToken
session secrets
password reset secrets
MFA secrets
provider credentials
```

through ordinary API responses.

### User Status

```text
pending
active
suspended
blocked
deactivated
deleted
```

### Relationships

```text
User -> Tenant
User -> GroupMembership
User -> Loan
User -> Contribution
User -> Payment
User -> Notification
User -> AuditEvent
User -> ForumTopic
User -> ForumReply
```

---

# 5.2 User Session / Refresh Token

**Purpose:** Maintains authenticated session state where persistent sessions are implemented.

### Core Fields

```text
id
userId
tenantId
tokenHash
deviceId
ipAddress
userAgent
expiresAt
revokedAt
createdAt
lastUsedAt
```

Tokens must be stored using a secure hash or equivalent protected representation.

Never persist raw refresh tokens.

---

# 5.3 User Verification

**Purpose:** Tracks account verification.

### Core Fields

```text
id
userId
type
status
tokenHash
expiresAt
verifiedAt
createdAt
```

Potential verification types:

```text
email
phone
identity
```

---

# 6. Tenant & SaaS Models

# 6.1 Tenant

**Purpose:** Represents an independent SaaS customer/environment.

### Core Fields

```text
id
name
slug
status
country
currency
timezone
configuration
createdAt
updatedAt
deletedAt
version
```

### Tenant Status

```text
pending
trial
active
suspended
expired
terminated
```

### Relationships

```text
Tenant -> Users
Tenant -> Groups
Tenant -> Plans
Tenant -> Subscription
Tenant -> Financial Accounts
Tenant -> Compliance Records
Tenant -> Audit Records
```

---

# 6.2 SaaS Plan

**Purpose:** Defines the commercial service configuration.

### Core Fields

```text
id
name
code
description
currency
billingInterval
price
limits
features
status
createdAt
updatedAt
```

---

# 6.3 Subscription

**Purpose:** Tracks a tenant's commercial subscription.

### Core Fields

```text
id
tenantId
planId
status
startAt
currentPeriodStart
currentPeriodEnd
cancelledAt
trialEndsAt
createdAt
updatedAt
version
```

### Status

```text
trialing
active
past_due
paused
cancelled
expired
```

---

# 7. Organization Models

# 7.1 Group

**Purpose:** Represents a savings/community group.

### Core Fields

```text
id
tenantId
name
description
status
groupType
currency
contributionConfiguration
loanConfiguration
createdBy
createdAt
updatedAt
deletedAt
version
```

### Status

```text
pending
active
suspended
closed
archived
```

---

# 7.2 Group Membership

**Purpose:** Represents a user's participation in a group.

### Core Fields

```text
id
tenantId
groupId
userId
role
status
joinedAt
leftAt
createdAt
updatedAt
version
```

### Membership Roles

```text
member
treasurer
secretary
chairperson
group_admin
```

### Status

```text
pending
active
suspended
left
removed
```

---

# 8. Savings & Contribution Models

# 8.1 Contribution

**Purpose:** Represents a member contribution.

### Core Fields

```text
id
tenantId
groupId
userId
amount
currency
status
paymentMethod
paymentId
reference
contributedAt
createdAt
updatedAt
version
```

### Status

```text
pending
posted
reversed
failed
cancelled
```

Contribution financial posting must flow through the ledger.

---

# 8.2 Contribution Schedule

**Purpose:** Defines expected contribution obligations.

### Core Fields

```text
id
tenantId
groupId
frequency
amount
currency
startDate
endDate
status
createdAt
updatedAt
```

---

# 9. Financial Data Model

The finance domain is the system of record for monetary state.

# 9.1 Account

**Purpose:** Represents a ledger account.

### Core Fields

```text
id
tenantId
accountCode
name
type
currency
status
parentAccountId
normalBalance
metadata
createdAt
updatedAt
version
```

### Account Types

```text
asset
liability
equity
income
expense
```

### Status

```text
active
frozen
closed
archived
```

---

# 9.2 Journal

**Purpose:** Represents a balanced accounting journal.

### Core Fields

```text
id
tenantId
journalNumber
transactionId
description
source
status
postingDate
effectiveDate
currency
createdAt
postedAt
reversedAt
version
```

### Status

```text
draft
pending
posted
reversed
void
```

---

# 9.3 Journal Entry

**Purpose:** Represents an individual debit or credit entry.

### Core Fields

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

### Entry Type

```text
debit
credit
```

### Immutable Rule

Once the parent journal is posted, journal entries must not be edited.

---

# 9.4 Financial Transaction

**Purpose:** Represents a business transaction mapped to accounting activity.

### Core Fields

```text
id
tenantId
transactionReference
transactionType
status
amount
currency
source
sourceId
idempotencyKey
journalId
createdAt
completedAt
failedAt
reversedAt
version
```

### Status

```text
initiated
pending
processing
completed
failed
reversed
cancelled
```

---

# 9.5 Account Balance Snapshot

**Purpose:** Provides a point-in-time balance representation.

### Core Fields

```text
id
tenantId
accountId
currency
ledgerBalance
availableBalance
pendingBalance
reservedBalance
snapshotAt
source
createdAt
```

Snapshots are derived records and must not replace ledger truth.

---

# 9.6 Financial Period

**Purpose:** Defines an accounting period.

### Core Fields

```text
id
tenantId
periodCode
startDate
endDate
status
closedBy
closedAt
createdAt
updatedAt
```

### Status

```text
open
closing
closed
reopened
```

A closed financial period must require elevated authorization and explicit audit controls before reopening.

---

# 10. Loan Domain Models

# 10.1 Loan Product

**Purpose:** Defines lending rules.

### Core Fields

```text
id
tenantId
name
code
description
currency
minAmount
maxAmount
interestRate
interestMethod
repaymentFrequency
minTerm
maxTerm
eligibilityRules
status
createdAt
updatedAt
version
```

---

# 10.2 Loan Application

**Purpose:** Represents a request for financing.

### Core Fields

```text
id
tenantId
groupId
userId
loanProductId
amount
currency
reason
eligibilityScore
status
idempotencyKey
submittedAt
createdAt
updatedAt
version
```

### Status

```text
draft
pending
under_review
approved
rejected
cancelled
```

---

# 10.3 Loan Approval

**Purpose:** Records an approval decision.

### Core Fields

```text
id
tenantId
loanId
approvedBy
interestRate
repaymentPeriodMonths
decision
notes
approvedAt
createdAt
```

The approval record should be append-oriented.

---

# 10.4 Loan

**Purpose:** Represents the financial lending contract after approval.

### Core Fields

```text
id
tenantId
groupId
userId
loanApplicationId
loanProductId
principalAmount
approvedAmount
currency
interestRate
interestMethod
term
status
approvedBy
approvedAt
disbursedAt
maturityDate
outstandingPrincipal
outstandingInterest
createdAt
updatedAt
version
```

### Status

```text
approved
ready_for_disbursement
disbursed
active
delinquent
defaulted
completed
written_off
reversed
```

Outstanding amounts are derived financial values and must remain consistent with the ledger and loan schedule.

---

# 10.5 Repayment Schedule

**Purpose:** Defines expected loan repayments.

### Core Fields

```text
id
tenantId
loanId
currency
installments
totalPrincipal
totalInterest
totalAmount
status
generatedAt
updatedAt
version
```

---

# 10.6 Loan Installment

**Purpose:** Represents an individual scheduled repayment.

### Core Fields

```text
id
scheduleId
loanId
installmentNumber
dueDate
principalDue
interestDue
feesDue
totalDue
principalPaid
interestPaid
feesPaid
status
paidAt
createdAt
updatedAt
```

### Status

```text
pending
partially_paid
paid
overdue
waived
cancelled
```

---

# 10.7 Loan Repayment

**Purpose:** Represents money received against a loan.

### Core Fields

```text
id
tenantId
loanId
userId
amount
currency
paymentId
allocation
status
receivedAt
createdAt
```

Repayment allocation may contain:

```text
principal
interest
fees
penalties
```

The allocation must reconcile with the corresponding financial postings.

---

# 11. Payment Domain Models

# 11.1 Payment

**Purpose:** Represents an external or internal payment operation.

### Core Fields

```text
id
tenantId
userId
groupId
loanId
paymentReference
provider
providerReference
type
direction
amount
currency
status
idempotencyKey
initiatedAt
completedAt
failedAt
reversedAt
createdAt
updatedAt
version
```

### Type

```text
contribution
loan_repayment
loan_disbursement
withdrawal
refund
fee
adjustment
```

### Direction

```text
inbound
outbound
```

### Status

```text
initiated
pending
processing
successful
failed
cancelled
reversed
```

---

# 11.2 Payment Provider Transaction

**Purpose:** Stores normalized provider-side transaction state.

### Core Fields

```text
id
tenantId
paymentId
provider
providerTransactionId
providerStatus
rawReference
amount
currency
providerPayloadHash
createdAt
updatedAt
```

Raw provider secrets must never be persisted unnecessarily.

Sensitive provider payloads should be minimized, encrypted, or retained according to integration and compliance requirements.

---

# 11.3 Payment Callback

**Purpose:** Represents an inbound provider callback/webhook.

### Core Fields

```text
id
provider
providerEventId
signatureStatus
payloadHash
paymentId
receivedAt
processedAt
processingStatus
attemptCount
lastError
createdAt
```

### Processing Status

```text
received
validated
processing
processed
failed
duplicate
dead_letter
```

Callback processing must be idempotent.

---

# 12. Reconciliation Models

# 12.1 Reconciliation Run

**Purpose:** Represents one reconciliation execution.

### Core Fields

```text
id
tenantId
source
periodStart
periodEnd
status
recordsProcessed
matchedCount
unmatchedCount
exceptionCount
startedAt
completedAt
createdAt
```

### Status

```text
pending
running
completed
failed
cancelled
```

---

# 12.2 Reconciliation Exception

**Purpose:** Represents a transaction that requires investigation.

### Core Fields

```text
id
tenantId
reconciliationRunId
sourceType
sourceId
exceptionType
severity
status
assignedTo
resolution
createdAt
updatedAt
resolvedAt
```

### Status

```text
open
investigating
resolved
dismissed
escalated
```

---

# 12.3 Reconciliation Match

**Purpose:** Links external and internal financial records.

### Core Fields

```text
id
tenantId
reconciliationRunId
internalTransactionId
externalTransactionId
matchMethod
confidence
status
matchedAt
createdAt
```

---

# 12.4 Repair Instruction

**Purpose:** Represents a controlled correction proposed or approved during exception processing.

### Core Fields

```text
id
tenantId
exceptionId
repairType
instruction
status
createdBy
approvedBy
executedAt
createdAt
```

### Status

```text
proposed
approved
executing
completed
failed
rejected
```

Repairs must never silently mutate historical financial records.

---

# 13. Statement Domain Models

# 13.1 Statement

**Purpose:** Represents an imported financial statement.

### Core Fields

```text
id
tenantId
source
accountReference
provider
statementPeriodStart
statementPeriodEnd
fileName
fileHash
currency
status
createdBy
createdAt
updatedAt
```

### Status

```text
received
validated
processing
completed
failed
archived
```

---

# 13.2 Statement Batch

**Purpose:** Controls concurrent statement processing.

### Core Fields

```text
id
tenantId
statementId
batchReference
status
claimedBy
claimToken
claimExpiresAt
attemptCount
startedAt
completedAt
failedAt
createdAt
updatedAt
```

### Status

```text
pending
claimed
processing
completed
failed
released
```

Workers must use claim tokens/ownership semantics to prevent concurrent processing of the same batch.

---

# 13.3 Statement Processing Operation

**Purpose:** Represents an individual processing attempt.

### Core Fields

```text
id
tenantId
statementId
batchId
operationType
workerId
claimToken
status
attempt
startedAt
completedAt
failedAt
errorCode
errorMessage
createdAt
```

---

# 13.4 Statement Transaction

**Purpose:** Represents an individual normalized statement entry.

### Core Fields

```text
id
tenantId
statementId
externalReference
transactionDate
valueDate
description
amount
currency
direction
balanceAfter
normalizedHash
status
createdAt
updatedAt
```

---

# 14. Compliance Data Models

# 14.1 KYC Case

### Core Fields

```text
id
tenantId
userId
status
riskLevel
verificationProvider
documents
reviewedBy
reviewedAt
createdAt
updatedAt
```

### Status

```text
pending
in_review
verified
rejected
expired
```

Sensitive identity data must have strict access controls.

---

# 14.2 AML Case

### Core Fields

```text
id
tenantId
userId
transactionId
riskScore
riskCategory
status
trigger
assignedTo
resolution
createdAt
updatedAt
```

### Status

```text
open
investigating
escalated
cleared
closed
```

---

# 14.3 Regulatory Submission

### Core Fields

```text
id
tenantId
submissionType
reportingPeriod
payloadHash
status
externalReference
submittedBy
submittedAt
acknowledgedAt
rejectedAt
createdAt
updatedAt
```

### Status

```text
draft
validated
submitted
acknowledged
rejected
resubmission_required
```

---

# 15. Risk & Fraud Models

# 15.1 Risk Assessment

### Core Fields

```text
id
tenantId
subjectType
subjectId
riskScore
riskLevel
modelVersion
factors
assessedAt
expiresAt
createdAt
```

Risk scoring must be versioned so that historical decisions remain explainable.

---

# 15.2 Fraud Alert

### Core Fields

```text
id
tenantId
subjectType
subjectId
transactionId
alertType
severity
score
status
assignedTo
resolution
createdAt
updatedAt
resolvedAt
```

### Status

```text
open
investigating
confirmed
false_positive
resolved
```

---

# 15.3 Anomaly Detection Result

### Core Fields

```text
id
tenantId
entityType
entityId
anomalyType
severity
score
modelVersion
signals
createdAt
```

Automated detection results should not automatically become irreversible enforcement actions without the appropriate policy/workflow.

---

# 16. Communication Models

# 16.1 Notification

### Core Fields

```text
id
tenantId
userId
type
channel
title
message
data
status
readAt
createdAt
updatedAt
```

### Status

```text
pending
queued
sent
delivered
failed
read
```

---

# 16.2 Notification Delivery Attempt

### Core Fields

```text
id
notificationId
provider
attemptNumber
status
providerReference
errorCode
errorMessage
attemptedAt
```

---

# 16.3 Notification Template

### Core Fields

```text
id
tenantId
name
eventType
channel
subject
template
locale
version
status
createdAt
updatedAt
```

Templates should be versioned rather than silently changing previously issued messages.

---

# 17. Chat Models

# 17.1 Chat Message

### Core Fields

```text
id
tenantId
groupId
senderId
message
messageType
status
createdAt
updatedAt
deletedAt
```

### Status

```text
active
flagged
hidden
deleted
```

---

# 17.2 Message Read Receipt

```text
messageId
userId
readAt
```

Uniqueness:

```text
(messageId, userId)
```

---

# 17.3 Message Reaction

```text
messageId
userId
emoji
createdAt
```

Uniqueness should prevent duplicate identical reactions as defined by product requirements.

---

# 18. Help Center Models

# 18.1 Help Article

### Core Fields

```text
id
tenantId
title
content
category
authorId
status
views
helpfulCount
unhelpfulCount
isFeatured
publishedAt
createdAt
updatedAt
deletedAt
version
```

---

# 18.2 Help Category

```text
id
tenantId
name
description
displayOrder
status
createdAt
updatedAt
```

---

# 18.3 Helpfulness Vote

```text
id
tenantId
userId
contentType
contentId
voteType
createdAt
updatedAt
```

Uniqueness:

```text
(tenantId, userId, contentType, contentId)
```

---

# 19. FAQ Models

# 19.1 FAQ

### Core Fields

```text
id
tenantId
question
answer
category
authorId
status
views
helpfulCount
unhelpfulCount
displayOrder
publishedAt
createdAt
updatedAt
deletedAt
version
```

---

# 19.2 FAQ Import Job

### Core Fields

```text
id
tenantId
uploadedBy
fileName
fileHash
format
status
totalRecords
processedRecords
successfulRecords
failedRecords
errorReport
startedAt
completedAt
createdAt
```

### Status

```text
queued
processing
completed
completed_with_errors
failed
cancelled
```

---

# 20. Community Forum Models

# 20.1 Forum Topic

### Core Fields

```text
id
tenantId
title
content
category
authorId
status
views
repliesCount
isSticky
isLocked
isSolved
solutionReplyId
lastReplyAt
createdAt
updatedAt
deletedAt
version
```

---

# 20.2 Forum Reply

### Core Fields

```text
id
tenantId
topicId
authorId
content
upvotes
downvotes
isSolution
status
createdAt
updatedAt
deletedAt
version
```

---

# 20.3 Forum Tag

```text
id
tenantId
name
normalizedName
description
usageCount
createdAt
updatedAt
```

---

# 20.4 Forum Topic Tag

```text
topicId
tagId
```

Composite uniqueness:

```text
(topicId, tagId)
```

---

# 20.5 Forum Vote

```text
id
tenantId
userId
topicId
replyId
voteType
createdAt
updatedAt
```

A user should have at most one active vote per target.

---

# 20.6 Forum Topic Follower

```text
id
tenantId
userId
topicId
createdAt
```

Uniqueness:

```text
(tenantId, userId, topicId)
```

---

# 20.7 Content Report

```text
id
tenantId
reporterId
contentType
contentId
reason
description
status
reviewedBy
resolutionNotes
createdAt
updatedAt
resolvedAt
```

---

# 21. Referral Models

# 21.1 Referral Code

### Core Fields

```text
id
tenantId
referrerUserId
code
status
expiresAt
usageLimit
usageCount
createdAt
updatedAt
```

### Status

```text
active
expired
disabled
exhausted
```

Codes must have uniqueness constraints appropriate to tenant/global scope.

---

# 21.2 Referral

### Core Fields

```text
id
tenantId
referralCodeId
referrerUserId
refereeUserId
status
completedAt
createdAt
updatedAt
```

### Status

```text
pending
qualified
completed
expired
cancelled
```

---

# 21.3 Referral Reward

### Core Fields

```text
id
tenantId
referralId
recipientUserId
rewardType
amount
currency
status
transactionId
issuedAt
createdAt
```

Reward issuance must be idempotent and financially auditable.

---

# 22. Audit Data Models

# 22.1 Audit Event

**Purpose:** Immutable operational/security evidence.

### Core Fields

```text
id
tenantId
actorId
actorType
action
resourceType
resourceId
requestId
correlationId
ipAddress
userAgent
outcome
reason
before
after
metadata
createdAt
```

### Rules

Audit events should be append-only.

Deletion or modification of audit records must be highly restricted and itself auditable.

---

# 23. Event & Messaging Models

# 23.1 Domain Event

### Core Fields

```text
id
tenantId
eventType
aggregateType
aggregateId
version
payload
occurredAt
publishedAt
correlationId
causationId
```

Example event types:

```text
UserRegistered
ContributionPosted
LoanApplied
LoanApproved
LoanDisbursed
LoanPaymentRecorded
PaymentInitiated
PaymentCompleted
PaymentFailed
StatementProcessed
ReconciliationCompleted
KycVerified
ForumTopicCreated
```

---

# 23.2 Outbox Event

**Purpose:** Guarantees reliable event publication.

### Core Fields

```text
id
tenantId
aggregateType
aggregateId
eventType
payload
status
attemptCount
nextAttemptAt
lastError
createdAt
publishedAt
```

### Status

```text
pending
processing
published
failed
dead_letter
```

The outbox pattern must be used where atomic database state change and event publication need reliable coordination.

---

# 23.3 Idempotency Record

### Core Fields

```text
id
tenantId
key
operation
requestHash
status
responseStatus
responseBody
resourceId
expiresAt
createdAt
updatedAt
```

Uniqueness:

```text
(tenantId, key, operation)
```

The implementation must prevent the same logical mutation from creating duplicate side effects.

---

# 24. Job & Workflow Models

# 24.1 Workflow Instance

### Core Fields

```text
id
tenantId
workflowType
subjectType
subjectId
state
version
context
startedAt
completedAt
failedAt
createdAt
updatedAt
```

---

# 24.2 Job Execution

### Core Fields

```text
id
tenantId
jobType
jobKey
status
attempt
workerId
startedAt
completedAt
failedAt
errorCode
errorMessage
createdAt
updatedAt
```

Job execution must support retry and concurrency control.

---

# 25. Data Relationships

Core relationship graph:

```text
Tenant
 ├── Users
 │    ├── Memberships
 │    ├── Contributions
 │    ├── Loans
 │    ├── Payments
 │    ├── Notifications
 │    └── Audit Events
 │
 ├── Groups
 │    ├── Memberships
 │    ├── Contributions
 │    ├── Loans
 │    └── Chat Messages
 │
 ├── Finance
 │    ├── Accounts
 │    ├── Journals
 │    │    └── Journal Entries
 │    ├── Transactions
 │    └── Balance Snapshots
 │
 ├── Payments
 │    ├── Provider Transactions
 │    └── Callbacks
 │
 ├── Statements
 │    ├── Statement Batches
 │    ├── Processing Operations
 │    └── Statement Transactions
 │
 ├── Reconciliation
 │    ├── Runs
 │    ├── Matches
 │    ├── Exceptions
 │    └── Repairs
 │
 ├── Compliance
 │    ├── KYC
 │    ├── AML
 │    └── Regulatory Submissions
 │
 ├── Help
 ├── FAQ
 ├── Forum
 ├── Referrals
 └── Audit
```

---

# 26. Financial Relationship Integrity

The following chain must remain traceable:

```text
Business Operation
      |
      v
Financial Transaction
      |
      v
Journal
      |
      +---- Journal Entry -> Debit Account
      |
      +---- Journal Entry -> Credit Account
      |
      v
Ledger
      |
      v
Balance / Statement / Reporting
```

For payment-backed operations:

```text
Provider Transaction
      |
      v
Payment
      |
      v
Financial Transaction
      |
      v
Journal
      |
      v
Ledger
```

For statement reconciliation:

```text
Statement Transaction
      |
      v
Normalization
      |
      v
Matching
      |
      +---- Matched -> Financial Transaction
      |
      +---- Exception -> Investigation
                          |
                          v
                       Repair
                          |
                          v
                    Ledger Adjustment
```

---

# 27. Data Lifecycle Rules

Every major entity should define:

```text
creation
activation
mutation
state transitions
archival
soft deletion
retention
purging/anonymization
```

A generic lifecycle:

```text
created
   |
   v
active
   |
   +---- suspended
   |
   +---- archived
   |
   v
deleted/retained according to policy
```

Financial entities have stricter lifecycle rules and must not use destructive deletion for posted historical records.

---

# 28. Soft Delete Standard

Soft-deletable entities should include:

```text
deletedAt
```

and, where useful:

```text
deletedBy
deletionReason
```

Default queries must exclude deleted records.

Example logical repository behavior:

```text
filter = {
  tenantId,
  deletedAt: null
}
```

Administrative recovery must be explicitly authorized and audited.

---

# 29. Versioning & Optimistic Concurrency

Mutable entities should support a version field:

```text
version
```

On successful update:

```text
version = version + 1
```

A stale update should fail rather than overwrite a newer version.

This protects against:

```text
lost updates
concurrent administration
double moderation
duplicate workflow transitions
```

---

# 30. Indexing Standards

Every high-volume collection/table must have indexes supporting:

```text
tenantId
status
createdAt
updatedAt
foreign-key/reference fields
external provider reference
business reference
idempotency key
state
```

Examples:

```text
(tenantId, status)
(tenantId, createdAt)
(tenantId, groupId)
(tenantId, userId)
(tenantId, externalReference)
```

Indexes must be reviewed using actual production query patterns.

Do not create unnecessary indexes without assessing:

```text
write amplification
storage cost
memory impact
query benefit
```

---

# 31. Uniqueness Standards

Uniqueness constraints should exist for business keys that must not be duplicated.

Examples:

```text
tenant + slug
tenant + accountCode
tenant + paymentReference
tenant + providerTransactionId
tenant + idempotencyKey
tenant + user + topic
tenant + user + content vote
topic + tag
```

The exact physical uniqueness strategy must match the repository's database technology.

---

# 32. Sensitive Data Classification

## Public/Low Sensitivity

Examples:

```text
published help article
published FAQ
public forum topic
public category
```

## Internal

Examples:

```text
internal operational metadata
system configuration references
non-public analytics
```

## Confidential

Examples:

```text
user phone
financial transaction metadata
loan details
membership data
audit metadata
```

## Highly Restricted

Examples:

```text
password hashes
refresh-token secrets
KYC identity documents
AML investigation information
provider credentials
API secrets
private keys
webhook secrets
```

Highly restricted data requires additional access controls.

---

# 33. Data Encryption

Sensitive data should be protected using encryption:

```text
in transit -> TLS
at rest -> encrypted storage
application secrets -> secret manager/environment injection
highly sensitive fields -> field-level encryption where required
```

Encryption keys must not be stored alongside encrypted payloads without an appropriate key-management design.

---

# 34. Data Access Control

Access must be governed by:

```text
tenant
user identity
role
permission
resource ownership
business state
compliance restrictions
```

Sensitive datasets should use dedicated service methods rather than unrestricted repository access.

---

# 35. Data Validation

Validation must occur before persistence.

Validate:

```text
required fields
types
formats
ranges
enum values
relationships
tenant ownership
state transitions
uniqueness
```

Critical financial validation must also include:

```text
currency
precision
amount > 0 where required
debit/credit balance
account state
financial period
idempotency
```

---

# 36. Monetary Data Standards

Money values must never be represented as uncontrolled floating-point values for accounting calculations.

Preferred representations:

```text
Decimal128
integer minor units
exact decimal library
```

depending on the existing implementation.

Every monetary amount should be associated with:

```text
amount
currency
```

Example:

```json
{
  "amount": "30000.00",
  "currency": "UGX"
}
```

Avoid ambiguous monetary payloads such as:

```json
{
  "amount": 30000
}
```

without a clearly established currency context.

---

# 37. Date & Time Standards

Persist timestamps in UTC.

Recommended representation:

```text
2026-08-16T00:14:00.000Z
```

Store explicit business dates separately from timestamps when the distinction matters.

Examples:

```text
transactionDate
valueDate
dueDate
effectiveDate
postingDate
```

Timezone presentation should occur at the application/UI boundary.

---

# 38. Financial Precision Rules

Interest, fees, repayments, and ledger calculations must use deterministic precision and rounding rules.

The platform should define:

```text
precision
rounding mode
currency exponent
minimum unit
allocation order
```

These rules must be centralized rather than implemented independently in multiple services.

---

# 39. Data Integrity Rules

The following invariants are mandatory.

## Ledger

```text
Debits = Credits
```

## Payment

```text
One logical payment operation
!= multiple financial postings
```

## Loan

```text
Outstanding balance must reconcile with
loan schedule + financial ledger
```

## Contribution

```text
Posted contribution must reconcile with
payment/financial transaction where payment-backed
```

## Statement

```text
Processed statement transaction
must retain traceability to source statement
```

## Reconciliation

```text
A resolved exception must retain
evidence of the resolution
```

## Audit

```text
Audit history must remain append-oriented
```

---

# 40. Referential Integrity

Relationships should prevent orphaned critical records.

Examples:

```text
JournalEntry -> Journal
JournalEntry -> Account
Loan -> User
Loan -> Group
LoanRepayment -> Loan
Payment -> User/Tenant
StatementTransaction -> Statement
ForumReply -> ForumTopic
ReferralReward -> Referral
```

Where database-level foreign keys are not available, equivalent service/repository safeguards are mandatory.

---

# 41. Denormalized Counters

Counters such as:

```text
views
repliesCount
helpfulCount
unhelpfulCount
usageCount
```

are derived values.

They must be updated atomically where possible and periodically reconcilable against source records.

A corrupted counter must never become the sole source of truth for a financial or regulatory decision.

---

# 42. Eventual Consistency

Some components may be eventually consistent:

```text
notifications
analytics
dashboard aggregates
search indexes
trending scores
audit projections
```

The API should not expose eventually consistent projections as authoritative financial state.

Financial state remains authoritative in the financial engine.

---

# 43. Caching Rules

Cacheable:

```text
published articles
published FAQs
categories
public content
popular/trending aggregates
```

Do not cache sensitive personalized information without appropriate scope.

Cache keys should include appropriate:

```text
tenant
resource
version
locale
authorization scope
```

---

# 44. Search Indexing

Search indexes may cover:

```text
Help Article title/content
FAQ question/answer
Forum Topic title/content
Forum Reply content
```

Search documents should contain only data necessary for retrieval.

Deleted/hidden/private content must be removed from active search indexes promptly.

---

# 45. Audit Integrity

Audit logs should include:

```text
actor
action
resource
requestId
tenantId
timestamp
outcome
```

Where applicable:

```text
before
after
reason
```

Never store:

```text
password
access token
refresh token
API key
private key
secret
```

in audit payloads.

---

# 46. Event Integrity

Domain events should include:

```text
eventId
eventType
aggregateType
aggregateId
tenantId
occurredAt
version
correlationId
causationId
```

Consumers should treat events as potentially duplicated.

Event consumers should therefore be idempotent.

---

# 47. Data Migration Standards

All production schema/data migrations must be:

```text
versioned
repeatable where possible
tested
auditable
rollback-aware
observed
```

Migration procedures must consider:

```text
existing data
indexes
backward compatibility
live traffic
partial failure
long-running migrations
```

Never perform uncontrolled production data mutation through ad-hoc scripts.

---

# 48. Backup & Recovery Requirements

Critical production data must support:

```text
scheduled backups
point-in-time recovery where supported
backup verification
restore testing
disaster recovery procedures
retention policy
```

Backups must be encrypted and access-controlled.

Financial data recovery procedures must preserve transaction ordering and auditability.

---

# 49. Data Retention

Retention requirements should be defined by domain.

Examples:

```text
Operational content -> product policy
Financial records -> financial/regulatory policy
KYC/AML data -> compliance policy
Audit logs -> security/compliance policy
Provider callback records -> integration policy
User account data -> privacy policy
```

Retention periods must not be hard-coded independently across services.

---

# 50. Anonymization & Deletion

Where legally and operationally permissible, user deletion may require:

```text
anonymization
de-identification
soft deletion
data retention exceptions
```

Financial and regulatory records may be retained after user account closure where legally required.

Deletion workflows must therefore distinguish:

```text
account deletion
personal-data deletion
financial record retention
audit retention
legal retention
```

---

# 51. Data Observability

Data health should be monitored.

Recommended checks:

```text
orphaned records
duplicate business keys
unbalanced journals
negative/invalid balances
stale processing jobs
stuck statement batches
stale reconciliation exceptions
duplicate provider references
duplicate idempotency keys
corrupted aggregate counters
cross-tenant access attempts
```

Automated integrity jobs should raise alerts when invariants fail.

---

# 52. Data Integrity Jobs

Recommended background jobs include:

```text
ledgerIntegrityJob
reconciliationJob
statementIntegrityJob
paymentIntegrityJob
loanBalanceIntegrityJob
auditIntegrityJob
dataRetentionJob
staleWorkflowRecoveryJob
```

Integrity jobs must report discrepancies rather than silently altering financial history.

---

# 53. Data Ownership Matrix

| Entity            | Primary Owner    | Financial Impact |
| ----------------- | ---------------- | ---------------: |
| User              | Identity         |               No |
| Tenant            | SaaS             |               No |
| Group             | Organization     |         Indirect |
| Membership        | Organization     |         Indirect |
| Contribution      | Savings          |              Yes |
| Account           | Finance          |              Yes |
| Journal           | Finance          |              Yes |
| Journal Entry     | Finance          |              Yes |
| Transaction       | Finance          |              Yes |
| Loan Product      | Loans            |         Indirect |
| Loan Application  | Loans            |         Indirect |
| Loan              | Loans/Finance    |              Yes |
| Loan Schedule     | Loans            |              Yes |
| Repayment         | Loans/Finance    |              Yes |
| Payment           | Payments/Finance |              Yes |
| Provider Callback | Payments         |              Yes |
| Statement         | Statements       |              Yes |
| Reconciliation    | Finance          |              Yes |
| KYC               | Compliance       |    No/Regulatory |
| AML Case          | Compliance       |       Regulatory |
| Notification      | Communications   |               No |
| Chat Message      | Communications   |               No |
| Forum Topic       | Community        |               No |
| Referral          | Growth           |      Potentially |
| Audit Event       | Security         |         Evidence |
| Domain Event      | Platform         |         Indirect |
| Outbox Event      | Platform         |         Indirect |

---

# 54. Cross-Domain Dependency Rules

The data model must preserve clear ownership.

Example:

```text
Loan
  -> may reference User
  -> may reference Group
  -> may reference LoanProduct
  -> may reference Payment
  -> may reference FinancialTransaction
```

But:

```text
Loan service
  != owner of ledger balance
```

Similarly:

```text
Payment
  -> may reference financial transaction

Payment
  != owner of accounting truth
```

And:

```text
Statement
  -> provides external financial evidence

Statement
  != replacement for ledger truth
```

---

# 55. Data Model Anti-Patterns

The following are prohibited:

```text
Direct balance mutation
Duplicated source-of-truth fields with no reconciliation
Unscoped tenant queries
Floating-point financial calculations
Raw secret persistence
Unbounded JSON blobs for critical financial state
Silent status mutation
Deleting posted financial records
Non-idempotent provider callbacks
Client-controlled authorization state
Unindexed high-volume tenant queries
```

---

# 56. Production Data Model Checklist

## Core

* [ ] Every entity has a stable identifier.
* [ ] Tenant ownership is explicit where required.
* [ ] Relationships are documented.
* [ ] Lifecycle states are documented.
* [ ] Soft-delete requirements are documented.
* [ ] Version/concurrency requirements are defined.

## Financial

* [ ] Double-entry accounting enforced.
* [ ] Monetary precision defined.
* [ ] Currency always known.
* [ ] Posted transactions immutable.
* [ ] Reversals supported.
* [ ] Financial period controls implemented.
* [ ] Ledger is system of record.
* [ ] Financial integrity jobs enabled.

## Security

* [ ] Sensitive fields classified.
* [ ] Secrets excluded from normal records/logs.
* [ ] Access restrictions implemented.
* [ ] Tenant isolation tested.
* [ ] Audit trail implemented.
* [ ] Data retention policy defined.

## Operational

* [ ] Indexes reviewed.
* [ ] Backup policy established.
* [ ] Restore tested.
* [ ] Data integrity monitoring enabled.
* [ ] Migration process established.
* [ ] Search indexing controlled.
* [ ] Cache invalidation defined.

---

# 57. Data Model Change Control

Any change to a production entity must be assessed for:

```text
API impact
financial impact
migration impact
index impact
tenant isolation impact
security impact
compliance impact
event/schema compatibility
reporting impact
backup/recovery impact
```

Changes to these entities require additional review:

```text
Account
Journal
JournalEntry
Transaction
Loan
Payment
Settlement
Statement
Reconciliation
KYC
AML
RegulatorySubmission
AuditEvent
```

---

# 58. Data Contract Governance

A model is not considered production-ready until:

```text
schema defined
validation defined
ownership defined
tenant behavior defined
lifecycle defined
indexes defined
audit behavior defined
retention defined
migration path defined
tests implemented
API impact reviewed
```

---

# 59. Canonical Data Flow

The platform's preferred financial data flow is:

```text
User / Group Operation
        |
        v
Application Service
        |
        v
Domain Transaction
        |
        +--------------------+
        |                    |
        v                    v
Financial Engine        Domain Event
        |                    |
        v                    v
Ledger                 Outbox/Event Bus
        |
        +--------------------+
        |
        v
Balances / Statements / Reporting
```

For external payment providers:

```text
Payment Request
      |
      v
Payment Service
      |
      v
Provider Adapter
      |
      v
External Provider
      |
      v
Callback/Webhook
      |
      v
Callback Validator
      |
      v
Idempotency
      |
      v
Payment State
      |
      v
Financial Engine
      |
      v
Ledger
```

For statement reconciliation:

```text
Statement
    |
    v
Importer
    |
    v
Normalizer
    |
    v
Validator
    |
    v
Batch Manager
    |
    v
Processor
    |
    v
Reconciliation
    |
    +---- Match
    |
    +---- Exception
              |
              v
        Repair Service
              |
              v
       Ledger Adjustment
```

---

# 60. Authoritative Data Rules

The following entities are authoritative for their respective concepts:

| Concept                       | Source of Truth             |
| ----------------------------- | --------------------------- |
| User identity                 | User domain                 |
| Tenant identity               | Tenant domain               |
| Group membership              | Membership domain           |
| Contribution financial effect | Finance/Ledger              |
| Loan lifecycle                | Loan domain                 |
| Accounting balance            | Ledger                      |
| Payment provider state        | Payment/Provider domain     |
| External statement evidence   | Statement domain            |
| Reconciliation result         | Reconciliation domain       |
| KYC decision                  | Compliance domain           |
| AML investigation             | Compliance domain           |
| Notification delivery         | Notification domain         |
| Audit evidence                | Audit domain                |
| Domain event publication      | Outbox/Event infrastructure |

Derived projections must not override these sources.

---

# 61. Final Enterprise Data Model Standard

The TITech Community Capital data layer should be considered production-grade only when:

```text
All critical entities have explicit ownership.
Tenant isolation is enforced.
Financial records are immutable after posting.
Double-entry integrity is guaranteed.
State transitions are validated.
Idempotency is implemented for retry-sensitive operations.
Sensitive data is classified and protected.
Audit evidence is append-oriented.
Cross-domain references are traceable.
Indexes support production access patterns.
Data migrations are controlled.
Backups and restore procedures are tested.
Data integrity checks are automated.
Derived data is distinguishable from source-of-truth data.
```

---

# 62. Document Metadata

**Document:** `docs/data/DATA_MODEL_CATALOGUE.md`
**Organization:** TITech Community Capital Ltd
**Platform:** Community Savings Platform
**Version:** `2.0`
**Status:** Enterprise Production Architecture Reference
**Last Updated:** August 16, 2026

**Primary Example User**

```text
Name: Justine Robert
Email: justine@titech.com
```

**Maintenance Rule**

> Every production model addition, removal, field change, relationship change, lifecycle change, financial invariant change, retention change, or tenant-isolation change must be reflected in this catalogue and the associated API, service, event, migration, and security documentation before the implementation is considered fully governed.

**Non-Negotiable Financial Rule**

> No application-layer endpoint, controller, job, provider adapter, or administrative tool may directly mutate authoritative financial balances outside the approved financial/ledger engine.