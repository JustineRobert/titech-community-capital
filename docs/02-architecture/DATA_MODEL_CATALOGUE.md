# TITech Community Capital Ltd

# Enterprise Data Model Catalogue

**Document:** `docs/02-architecture/DATA_MODEL_CATALOGUE.md`
**Status:** Production Data Architecture Baseline
**Audience:** Engineering, Architecture, Database, Security, Compliance, DevOps/SRE, Operations, QA
**Owner:** Architecture / Engineering
**Classification:** Internal Engineering Documentation
**Version:** 1.0.0

---

# 1. Purpose

This document defines the authoritative data-model catalogue for the TITech Community Capital platform.

It establishes:

* domain data ownership;
* aggregate boundaries;
* entity responsibilities;
* persistence responsibilities;
* identifiers;
* tenant isolation requirements;
* financial data integrity rules;
* lifecycle states;
* relationships;
* indexing requirements;
* uniqueness requirements;
* concurrency requirements;
* audit requirements;
* retention considerations;
* event/outbox data requirements;
* operational data structures;
* reference architecture for MongoDB/Mongoose persistence.

This document complements:

```text
docs/02-architecture/ARCHITECTURE_MAP.md
docs/02-architecture/SERVICE_CATALOGUE.md
docs/02-architecture/API_CATALOGUE.md
docs/02-architecture/SECURITY_MODEL.md
docs/02-architecture/EVENT_CATALOGUE.md
docs/02-architecture/FINANCIAL_LEDGER_SPECIFICATION.md
docs/02-architecture/TRANSACTION_STATE_MACHINE.md
```

The catalogue is intentionally domain-oriented.

Individual implementation files may evolve, but the underlying ownership, invariants, relationships, and financial controls MUST remain consistent with this document.

---

# 2. Data Architecture Principles

## 2.1 One Authoritative Owner Per Critical State

Every important business datum MUST have one authoritative owner.

Examples:

```text
Tenant
  → SaaS / Tenant Platform

User Identity
  → Identity Domain

Member
  → Community Finance

Loan
  → Lending

Payment Operation
  → Payment Domain

Ledger Account
  → Financial Core

Journal Entry
  → Financial Core

Settlement Statement
  → Settlement Domain

Regulatory Submission
  → Compliance Domain

Fraud Alert
  → Fraud Domain

Outbox Event
  → Event Infrastructure
```

A read model or cache MUST NOT become an accidental second source of truth.

---

# 3. Multi-Tenant Data Model

Tenant isolation is a mandatory architectural property.

Tenant-aware records SHOULD include:

```text
tenantId
```

where the entity is owned by a tenant.

The default persistence pattern is:

```text
tenantId
+
entityId
```

Queries MUST scope tenant-owned data.

Bad:

```text
findOne({ _id })
```

Preferred:

```text
findOne({
  tenantId,
  _id
})
```

The service layer MUST verify tenant authorization before accessing tenant-owned resources.

Database design MUST assume that application-layer filtering can fail and should therefore reinforce isolation through:

* compound indexes;
* ownership validation;
* unique constraints;
* repository conventions;
* test coverage;
* privileged access controls.

---

# 4. Identifier Strategy

Production entities SHOULD use stable identifiers.

Recommended identifier classes:

```text
_internal Mongo ObjectId / UUID
_external public identifier
_domain reference / operation key
_provider reference
```

Examples:

```text
_id
tenantId
userId
accountId
transactionId
operationId
correlationId
providerReference
idempotencyKey
```

The platform MUST distinguish:

```text
database identity
business identity
external provider identity
request identity
operation identity
```

These identifiers MUST NOT be conflated.

---

# 5. Identifier Requirements

## 5.1 Database Identifier

Each persistent document MUST have a unique database identifier.

```text
_id
```

---

## 5.2 Public Identifier

Where an entity is externally exposed, a stable public identifier SHOULD be used when appropriate.

Example:

```text
memberId
loanId
paymentId
transactionId
```

Public identifiers SHOULD NOT expose internal database implementation details unless intentionally designed as such.

---

## 5.3 Operation Identity

Long-running and retryable operations MUST have a durable operation identity.

Examples:

```text
operationId
operationKey
idempotencyKey
```

---

## 5.4 Correlation Identity

Operational workflows SHOULD carry:

```text
requestId
correlationId
traceId
```

These are observability identifiers and MUST NOT be used as primary business identity.

---

# 6. Standard Document Metadata

Tenant-aware documents SHOULD follow a standard metadata convention.

Representative fields:

```text
_id
tenantId
createdAt
updatedAt
createdBy
updatedBy
version
status
```

Where applicable:

```text
deletedAt
deletedBy
correlationId
requestId
operationId
idempotencyKey
```

Financial documents require stronger immutability rules.

---

# 7. Timestamp Requirements

All persistent records SHOULD use UTC timestamps.

Recommended fields:

```text
createdAt
updatedAt
```

Domain-specific timestamps MAY include:

```text
submittedAt
approvedAt
postedAt
completedAt
failedAt
reversedAt
settledAt
expiredAt
closedAt
```

Timestamp semantics MUST be explicitly documented.

Do not overload a single timestamp for multiple lifecycle meanings.

---

# 8. Data Classification

Data SHOULD be classified at model level.

Suggested classes:

```text
PUBLIC
INTERNAL
CONFIDENTIAL
FINANCIAL
SENSITIVE_PERSONAL
REGULATORY
SECURITY_SENSITIVE
SECRET
```

Examples:

| Data                   | Classification           |
| ---------------------- | ------------------------ |
| Tenant Name            | INTERNAL                 |
| Member Name            | SENSITIVE_PERSONAL       |
| Account Balance        | FINANCIAL                |
| KYC Document Metadata  | REGULATORY / SENSITIVE   |
| Password Hash          | SECURITY_SENSITIVE       |
| Provider Client Secret | SECRET                   |
| Access Token           | SECRET                   |
| Audit Record           | CONFIDENTIAL             |
| Ledger Entry           | FINANCIAL / CONFIDENTIAL |

Secrets MUST NOT be persisted in ordinary business documents unless specifically required and securely protected.

---

# 9. Core Domain Model Map

```text
Platform
├── Tenant
├── TenantSettings
├── SubscriptionPlan
├── TenantSubscription
├── BillingOperation
└── Entitlement

Identity
├── User
├── Role
├── Permission
├── RefreshToken / Session
└── TenantMembership

Community Finance
├── Group
├── GroupMembership
├── Member
├── SavingsProduct
├── SavingsAccount
├── Contribution
├── Share
└── Fine / Charge

Lending
├── LoanProduct
├── LoanApplication
├── LoanRiskProfile
├── LoanApproval
├── Loan
├── RepaymentSchedule
├── Repayment
├── Disbursement
└── WriteOff

Financial Core
├── Account
├── Journal
├── JournalEntry
├── Transaction
├── BalanceSnapshot
├── FinancialPeriod
├── ReconciliationRecord
└── Adjustment / Reversal

Payments
├── PaymentOperation
├── PaymentAttempt
├── ProviderTransaction
├── CallbackRecord
└── Settlement

Compliance
├── KycCase
├── KycVerification
├── AmlCase
├── ScreeningResult
└── RegulatorySubmission

Workflow / Integration
├── WorkflowOperation
├── OutboxEvent
├── Job / Batch
├── CallbackEnvelope
└── DeadLetterRecord

Risk / Fraud / Intelligence
├── FraudAlert
├── RiskAssessment
├── RiskProfile
├── Anomaly
├── RepairRecommendation
└── IntelligenceResult

Observability
├── AuditLog
├── OperationalEvent
├── Metric / Aggregate
└── Trace Context Metadata
```

---

# 10. Domain Ownership Matrix

| Entity               | Domain                    | Authoritative? | Tenant Scoped? | Financially Sensitive? |
| -------------------- | ------------------------- | -------------: | -------------: | ---------------------: |
| Tenant               | SaaS                      |            Yes |             No |                     No |
| TenantSettings       | SaaS                      |            Yes |            Yes |                     No |
| SubscriptionPlan     | SaaS                      |            Yes |             No |                     No |
| TenantSubscription   | SaaS                      |            Yes |            Yes |                    Yes |
| BillingOperation     | SaaS/Billing              |            Yes |            Yes |                    Yes |
| User                 | Identity                  |            Yes |             No |                     No |
| TenantMembership     | Identity                  |            Yes |            Yes |                     No |
| Group                | Community Finance         |            Yes |            Yes |                     No |
| Member               | Community Finance         |            Yes |            Yes |                    Yes |
| SavingsAccount       | Community Finance         |            Yes |            Yes |                    Yes |
| Contribution         | Community Finance         |            Yes |            Yes |                    Yes |
| LoanProduct          | Lending                   |            Yes |            Yes |                    Yes |
| LoanApplication      | Lending                   |            Yes |            Yes |                    Yes |
| LoanRiskProfile      | Risk/Lending              |            Yes |            Yes |                    Yes |
| LoanApproval         | Lending                   |            Yes |            Yes |                    Yes |
| Loan                 | Lending                   |            Yes |            Yes |                    Yes |
| RepaymentSchedule    | Lending                   |            Yes |            Yes |                    Yes |
| Repayment            | Lending                   |            Yes |            Yes |                    Yes |
| PaymentOperation     | Payments                  |            Yes |            Yes |                    Yes |
| PaymentAttempt       | Payments                  |            Yes |            Yes |                    Yes |
| CallbackRecord       | Payments/Integration      |            Yes |            Yes |                    Yes |
| Settlement           | Settlement                |            Yes |            Yes |                    Yes |
| Account              | Financial Core            |            Yes |            Yes |                    Yes |
| Journal              | Financial Core            |            Yes |            Yes |                    Yes |
| JournalEntry         | Financial Core            |            Yes |            Yes |                    Yes |
| Transaction          | Financial Core            |            Yes |            Yes |                    Yes |
| BalanceSnapshot      | Financial Core            |            Yes |            Yes |                    Yes |
| FinancialPeriod      | Financial Core            |            Yes |            Yes |                    Yes |
| ReconciliationRecord | Financial Core/Settlement |            Yes |            Yes |                    Yes |
| AuditLog             | Audit                     |            Yes |        Usually |                   High |
| OutboxEvent          | Event Infrastructure      |            Yes |        Usually |                   High |
| RegulatorySubmission | Compliance                |            Yes |            Yes |                   High |
| FraudAlert           | Fraud                     |            Yes |            Yes |                   High |

---

# 11. Tenant Model

## 11.1 Tenant

Represents a SACCO, VSLA, cooperative, organization, or other customer account on the platform.

Core fields:

```text
_id
tenantId / publicId
name
legalName
tenantType
registrationNumber
status
country
currency
timezone
contactDetails
configuration
createdAt
updatedAt
```

Recommended lifecycle:

```text
PENDING
  ↓
ONBOARDING
  ↓
ACTIVE
  ↓
SUSPENDED
  ↓
CLOSED
```

---

# 12. Tenant Settings

Stores tenant-specific configuration.

Examples:

```text
tenantId
currency
timezone
locale
loanSettings
savingsSettings
paymentSettings
notificationSettings
complianceSettings
featureFlags
operationalLimits
```

Secrets SHOULD NOT be stored in this document.

Provider secrets SHOULD be delegated to secure secret management.

---

# 13. Subscription Plan

Represents a platform-wide SaaS plan.

Fields:

```text
_id
code
name
description
status
billingCycle
pricing
limits
features
effectiveFrom
effectiveTo
version
createdAt
updatedAt
```

Plans SHOULD be versioned where commercial behavior changes over time.

---

# 14. Tenant Subscription

Represents a tenant's subscription.

Fields:

```text
_id
tenantId
planId
status
startedAt
renewalAt
cancelledAt
billingProfile
entitlements
usageLimits
version
createdAt
updatedAt
```

Subscription state MUST remain separate from financial ledger state.

---

# 15. Billing Operation

The billing coordination entity is intended for safe, persistent billing workflows.

Recommended fields:

```text
_id
tenantId
operationKey
operationType
status
amount
currency
subscriptionId
billingPeriod
idempotencyKey
requestFingerprint
providerReference
claimedAt
claimOwner
claimExpiresAt
completedAt
failedAt
failureCode
failureReason
metadata
createdAt
updatedAt
```

Critical uniqueness:

```text
tenantId + operationKey
```

or another deliberately scoped unique coordination key.

Claiming MUST be concurrency-safe.

Supported lifecycle:

```text
PENDING
  ↓
PROCESSING
  ├── COMPLETED
  ├── FAILED
  └── EXPIRED / RELEASED
```

---

# 16. User Model

Represents platform identity.

Fields SHOULD include:

```text
_id
email
phone
username
displayName
passwordHash
status
lastLoginAt
security
mfa
createdAt
updatedAt
```

Credentials MUST be stored using secure password hashing.

Plain-text passwords MUST never be persisted.

---

# 17. Tenant Membership

Represents user membership within a tenant.

Fields:

```text
_id
tenantId
userId
roleIds
status
joinedAt
revokedAt
createdAt
updatedAt
```

Recommended uniqueness:

```text
tenantId + userId
```

A user MAY belong to multiple tenants if the platform permits it.

Tenant membership MUST NOT be inferred solely from a user record.

---

# 18. Role

Defines a reusable authorization role.

Fields:

```text
_id
tenantId / systemScope
name
code
permissions
status
createdAt
updatedAt
```

System roles and tenant roles SHOULD be distinguished.

---

# 19. Permission

Defines an atomic authorization capability.

Representative format:

```text
resource.action
```

Examples:

```text
loans.read
loans.approve
payments.create
payments.refund
ledger.read
ledger.reverse
compliance.submit
```

---

# 20. Community Finance Models

The Community Finance domain represents group-based savings and financial participation.

Primary models:

```text
Group
GroupMembership
Member
SavingsProduct
SavingsAccount
Contribution
Share
Fine / Charge
```

---

# 21. Group

Represents a SACCO/VSLA/community savings group under a tenant.

Fields:

```text
_id
tenantId
name
code
groupType
status
currency
cycle
rules
meetingSchedule
officers
createdAt
updatedAt
```

Potential lifecycle:

```text
DRAFT
ACTIVE
SUSPENDED
CLOSED
```

---

# 22. Group Membership

Represents the relationship between a member and group.

Fields:

```text
_id
tenantId
groupId
memberId
role
status
joinedAt
leftAt
shareClass
membershipNumber
createdAt
updatedAt
```

Recommended uniqueness:

```text
tenantId + groupId + memberId
```

Historical membership SHOULD NOT be deleted.

---

# 23. Member

Represents a person or organization participating in community finance.

Fields:

```text
_id
tenantId
memberNumber
personType
identityReferences
profile
contactDetails
status
groupIds
kycStatus
createdAt
updatedAt
```

Sensitive identity data SHOULD be minimized and protected.

Member identity MUST remain distinct from:

```text
User authentication identity
```

A member may have a user account, but the two concepts are not inherently identical.

---

# 24. Savings Product

Defines the rules of a savings product.

Fields:

```text
_id
tenantId
code
name
description
currency
minimumContribution
maximumContribution
frequency
interestPolicy
penaltyPolicy
status
effectiveFrom
effectiveTo
version
createdAt
updatedAt
```

Products SHOULD be versioned when their financial terms change.

---

# 25. Savings Account

Represents a member's savings account.

Fields:

```text
_id
tenantId
groupId
memberId
productId
accountNumber
currency
status
openedAt
closedAt
ledgerAccountId
createdAt
updatedAt
```

The savings account references the Financial Core ledger account.

The savings account MUST NOT maintain an independent authoritative financial balance that can diverge from the ledger.

A displayed balance MAY be a projection/cache, but the ledger remains authoritative.

---

# 26. Contribution

Represents a contribution instruction or completed contribution event.

Fields may include:

```text
_id
tenantId
groupId
memberId
savingsAccountId
amount
currency
paymentMethod
paymentOperationId
ledgerTransactionId
status
reference
contributionDate
postedAt
createdAt
updatedAt
```

Financial state MUST be finalized through the Financial Core.

---

# 27. Share

Represents member or group share ownership where applicable.

Fields:

```text
_id
tenantId
groupId
memberId
shareClass
units
unitValue
currency
status
effectiveAt
ledgerAccountId
createdAt
updatedAt
```

Share accounting rules MUST be defined separately from ordinary savings balances.

---

# 28. Fine / Charge

Represents a group or product-level fee/fine.

Fields:

```text
_id
tenantId
groupId
memberId
type
reasonCode
amount
currency
status
assessedAt
paidAt
ledgerTransactionId
createdAt
updatedAt
```

Any collected monetary amount MUST reconcile to the ledger.

---

# 29. Lending Domain Models

Primary lending models:

```text
LoanProduct
LoanApplication
LoanRiskProfile
LoanApproval
Loan
Disbursement
RepaymentSchedule
Repayment
WriteOff
```

---

# 30. Loan Product

Defines lending terms.

Fields:

```text
_id
tenantId
code
name
currency
principalLimits
interestPolicy
fees
penalties
termRules
repaymentFrequency
eligibilityRules
status
effectiveFrom
effectiveTo
version
createdAt
updatedAt
```

Products MUST be immutable in financial meaning after issuance.

Changed terms SHOULD create a new version.

---

# 31. Loan Application

Represents a loan request.

Fields:

```text
_id
tenantId
groupId
memberId
loanProductId
applicationNumber
requestedAmount
approvedAmount
currency
purpose
term
status
submittedAt
decisionAt
rejectionReason
riskAssessmentId
createdAt
updatedAt
```

Lifecycle:

```text
DRAFT
→ SUBMITTED
→ UNDER_REVIEW
→ APPROVED
→ REJECTED
→ CANCELLED
```

Approved applications MAY result in a separate loan record.

---

# 32. Loan Risk Profile

Represents risk-scoring inputs and outputs associated with an applicant/application.

Recommended fields:

```text
_id
tenantId
applicantId
loanApplicationId
baseScore
finalScore
riskGrade
inputFingerprint
correlationId
idempotencyKey
scoringVersion
modelVersion
decision
factors
reasonCodes
calculatedAt
createdAt
updatedAt
```

The record SHOULD preserve the scoring version used to make the decision.

The identity of the evaluated applicant MUST be immutable after scoring unless a new scoring record is created.

Recommended uniqueness should prevent accidental duplicate scoring for the same logical operation where appropriate.

---

# 33. Loan Approval

Represents a controlled approval decision.

Fields:

```text
_id
tenantId
loanApplicationId
approvalLevel
approverId
decision
amount
conditions
reason
approvedAt
rejectedAt
createdAt
updatedAt
```

Approval records SHOULD be append-oriented.

Do not silently replace historical approval decisions.

---

# 34. Loan

Represents an originated loan.

Fields:

```text
_id
tenantId
groupId
memberId
loanApplicationId
loanProductId
loanNumber
principalAmount
approvedAmount
disbursedAmount
currency
interestPolicy
feePolicy
term
status
disbursementDate
maturityDate
outstandingPrincipal
outstandingInterest
outstandingFees
ledgerAccountId
createdAt
updatedAt
```

Outstanding amounts MAY be maintained as controlled projections, but authoritative accounting MUST remain connected to the ledger and underlying transaction history.

---

# 35. Loan Disbursement

Represents the actual disbursement operation.

Fields:

```text
_id
tenantId
loanId
paymentOperationId
amount
currency
status
providerReference
ledgerTransactionId
disbursedAt
failureCode
failureReason
createdAt
updatedAt
```

A loan MUST NOT be treated as financially disbursed solely because an API request succeeded.

Financial completion requires successful posting and appropriate payment confirmation state.

---

# 36. Repayment Schedule

Represents planned repayment obligations.

Fields:

```text
_id
tenantId
loanId
installmentNumber
dueDate
principalDue
interestDue
feesDue
penaltiesDue
totalDue
currency
status
paidAmount
paidAt
createdAt
updatedAt
```

The schedule is an obligation model.

It is not the ledger.

Actual repayment MUST be represented through payment and financial transaction records.

---

# 37. Repayment

Represents an actual repayment operation.

Fields:

```text
_id
tenantId
loanId
memberId
installmentReferences
amount
currency
paymentOperationId
ledgerTransactionId
allocation
status
receivedAt
postedAt
createdAt
updatedAt
```

Allocation SHOULD explicitly identify how amounts are applied to:

```text
principal
interest
fees
penalties
```

---

# 38. Write-Off

Represents an approved accounting treatment for a non-performing receivable.

Fields:

```text
_id
tenantId
loanId
amount
currency
reason
approvalId
ledgerTransactionId
status
effectiveAt
createdAt
updatedAt
```

Write-off MUST be represented by controlled accounting entries.

Deleting outstanding balances is prohibited.

---

# 39. Financial Core Data Model

The Financial Core is the canonical accounting model.

Primary entities:

```text
Account
Journal
JournalEntry
Transaction
BalanceSnapshot
FinancialPeriod
ReconciliationRecord
Adjustment
Reversal
```

---

# 40. Financial Account

Represents a ledger account.

Fields:

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

Account types MAY include:

```text
ASSET
LIABILITY
EQUITY
REVENUE
EXPENSE
```

The account hierarchy MUST support controlled financial reporting.

Recommended uniqueness:

```text
tenantId + accountCode
```

---

# 41. Journal

Represents an accounting journal or accounting transaction container.

Fields:

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

Posted journals MUST NOT be edited.

---

# 42. Journal Entry

Represents an individual debit or credit leg.

Fields:

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

Mandatory invariant:

```text
SUM(DEBITS) = SUM(CREDITS)
```

An entry MUST belong to exactly one journal.

---

# 43. Transaction

Represents the authoritative financial transaction identity.

Fields:

```text
_id
tenantId
transactionNumber
transactionType
sourceType
sourceId
operationId
idempotencyKey
currency
amount
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

Recommended lifecycle:

```text
CREATED
→ VALIDATED
→ POSTED
```

Failure:

```text
CREATED / VALIDATED
→ FAILED
```

Correction:

```text
POSTED
→ REVERSED
```

A posted transaction MUST NOT be updated to alter its financial meaning.

---

# 44. Ledger Posting Identity

Each posting SHOULD be uniquely attributable.

Logical key:

```text
tenantId
+
operationType
+
operationId
+
idempotencyKey
```

This prevents repeated requests from creating duplicate accounting effects.

---

# 45. Balance Snapshot

Represents a point-in-time calculated balance snapshot.

Fields:

```text
_id
tenantId
accountId
asOf
ledgerBalance
availableBalance
pendingBalance
reservedBalance
currency
sourceTransactionId
snapshotVersion
createdAt
```

Snapshots MUST be traceable to underlying ledger state.

They MUST NOT be used to overwrite ledger history.

---

# 46. Financial Period

Represents an accounting period.

Fields:

```text
_id
tenantId
periodCode
startDate
endDate
status
closedAt
closedBy
closeRunId
integrityHash
createdAt
updatedAt
```

Lifecycle:

```text
OPEN
→ SOFT_CLOSE
→ FINAL_CLOSE
→ LOCKED
```

Posting rules MUST enforce period status.

---

# 47. Reversal

Represents the controlled reversal of a previously posted transaction.

Fields:

```text
_id
tenantId
originalTransactionId
reversalTransactionId
reasonCode
reason
requestedBy
approvedBy
status
createdAt
updatedAt
```

The original transaction remains immutable.

---

# 48. Adjustment

Represents a controlled corrective accounting entry.

Fields:

```text
_id
tenantId
adjustmentNumber
reasonCode
description
sourceType
sourceId
amount
currency
approvalReference
transactionId
status
createdAt
updatedAt
```

Adjustments MUST be auditable.

---

# 49. Payment Data Model

Payment entities are operational and integration-oriented.

Primary models:

```text
PaymentOperation
PaymentAttempt
ProviderTransaction
CallbackRecord
Settlement
```

---

# 50. Payment Operation

Represents the internal lifecycle of a payment instruction.

Fields:

```text
_id
tenantId
operationKey
operationType
direction
amount
currency
payer
payee
sourceType
sourceId
destinationType
destinationId
status
provider
providerReference
internalReference
idempotencyKey
requestFingerprint
correlationId
transactionId
createdAt
updatedAt
completedAt
failedAt
```

Recommended uniqueness:

```text
tenantId + operationKey
```

Potential state machine:

```text
INITIATED
→ PROCESSING
→ SUCCESS
```

Alternative outcomes:

```text
FAILED
CANCELLED
EXPIRED
REVERSED
```

---

# 51. Payment Attempt

Represents a specific provider interaction.

Fields:

```text
_id
tenantId
paymentOperationId
attemptNumber
provider
requestReference
providerReference
status
requestMetadata
responseMetadata
startedAt
completedAt
failureCode
failureReason
createdAt
updatedAt
```

Each retry SHOULD create or record a distinct attempt.

Do not overwrite the history of previous attempts.

---

# 52. Provider Transaction

Represents provider-side transaction identity and normalized provider state.

Fields:

```text
_id
tenantId
provider
providerTransactionId
providerReference
paymentOperationId
status
amount
currency
rawStatus
normalizedStatus
receivedAt
updatedAt
```

Recommended uniqueness:

```text
provider + providerTransactionId
```

Raw provider payloads SHOULD be stored separately when necessary for audit/security.

---

# 53. Callback Record

Represents an incoming external callback.

Fields:

```text
_id
tenantId
provider
callbackType
providerEventId
providerReference
signatureVerified
validationStatus
processingStatus
payloadHash
payloadVersion
receivedAt
processedAt
correlationId
retryCount
errorCode
errorReason
createdAt
updatedAt
```

Recommended uniqueness:

```text
provider + providerEventId
```

Where providers do not offer stable event IDs, a controlled replay fingerprint SHOULD be used.

---

# 54. Settlement Model

Represents settlement between external providers and internal financial records.

Fields:

```text
_id
tenantId
provider
settlementBatchId
settlementDate
currency
grossAmount
feeAmount
netAmount
statementReference
status
matchedCount
unmatchedCount
reconciledAt
createdAt
updatedAt
```

Settlement records SHOULD link to detailed statement and reconciliation records.

---

# 55. Statement Data Model

Statement processing SHOULD use explicit entities for imported provider statements and batches.

Recommended models:

```text
Statement
StatementBatch
StatementLine
StatementProcessingOperation
```

---

# 56. Statement

Represents an imported statement source.

Fields:

```text
_id
tenantId
provider
accountReference
statementPeriod
sourceFileReference
contentHash
format
status
rowCount
importedAt
processedAt
createdAt
updatedAt
```

The `contentHash` helps detect accidental duplicate imports.

---

# 57. Statement Batch

Represents a unit of processing and worker ownership.

Fields:

```text
_id
tenantId
statementId
batchKey
status
claimOwner
claimedAt
claimExpiresAt
attempts
processedCount
failedCount
releasedAt
completedAt
createdAt
updatedAt
```

Workers MUST claim batches atomically.

---

# 58. Statement Line

Represents a normalized financial statement row.

Fields:

```text
_id
tenantId
statementId
batchId
lineNumber
providerReference
transactionDate
valueDate
description
amount
direction
currency
runningBalance
normalizedType
matchingStatus
matchedTransactionId
repairStatus
createdAt
updatedAt
```

Statement lines are external evidence and MUST NOT automatically become ledger entries without validation.

---

# 59. Reconciliation Record

Represents the result of matching internal and external financial records.

Fields:

```text
_id
tenantId
reconciliationType
externalReference
internalReference
statementLineId
transactionId
status
matchScore
differenceAmount
currency
exceptionCode
resolution
resolvedBy
resolvedAt
createdAt
updatedAt
```

Possible states:

```text
MATCHED
PARTIALLY_MATCHED
UNMATCHED
EXCEPTION
RESOLVED
```

---

# 60. Compliance Data Model

Primary models:

```text
KycCase
KycVerification
AmlCase
ScreeningResult
RegulatorySubmission
RegulatoryValidation
```

---

# 61. KYC Case

Fields:

```text
_id
tenantId
subjectType
subjectId
caseNumber
status
riskLevel
verificationType
assignedTo
openedAt
completedAt
expiresAt
createdAt
updatedAt
```

Sensitive documents SHOULD be referenced rather than embedded unnecessarily.

---

# 62. KYC Verification

Fields:

```text
_id
tenantId
kycCaseId
provider
verificationType
status
externalReference
resultCode
confidence
verifiedAt
expiresAt
createdAt
updatedAt
```

---

# 63. AML Case

Fields:

```text
_id
tenantId
subjectType
subjectId
caseNumber
triggerType
riskLevel
status
assignedTo
openedAt
resolvedAt
resolutionCode
createdAt
updatedAt
```

---

# 64. Screening Result

Fields:

```text
_id
tenantId
subjectType
subjectId
screeningType
provider
screeningReference
status
riskLevel
matchCount
matchedEntities
screenedAt
createdAt
updatedAt
```

Sensitive screening data MUST be access-controlled.

---

# 65. Regulatory Submission

Fields:

```text
_id
tenantId
submissionType
regulator
reportingPeriod
submissionReference
schemaVersion
payloadHash
status
validationStatus
submittedAt
acceptedAt
rejectedAt
failureCode
failureReason
createdAt
updatedAt
```

Regulatory submissions SHOULD preserve immutable evidence of what was submitted.

---

# 66. Risk Data Model

Primary models:

```text
RiskAssessment
RiskProfile
RiskFactor
ScoringExecution
```

A risk assessment SHOULD record:

```text
assessmentId
tenantId
subjectId
subjectType
inputFingerprint
modelVersion
scoringVersion
score
grade
decision
reasonCodes
calculatedAt
correlationId
```

---

# 67. Fraud Data Model

Primary models:

```text
FraudAlert
FraudCase
FraudSignal
CrossAccountAnalysis
```

Fraud alerts SHOULD include:

```text
tenantId
subjectType
subjectId
transactionId
severity
classification
confidence
signals
status
assignedTo
openedAt
resolvedAt
```

Fraud detection MUST NOT alter ledger state directly.

Any financial intervention MUST proceed through authorized financial workflows.

---

# 68. Intelligence Data Model

For anomaly detection, repair analytics, forecasting, and recommendation systems:

```text
Anomaly
RepairPrediction
Forecast
Recommendation
AIClassification
AIConfidenceRecord
```

These records SHOULD retain:

```text
modelVersion
rulesetVersion
inputFingerprint
confidence
reasonCodes
generatedAt
correlationId
```

AI outputs MUST remain auditable.

---

# 69. Workflow Data Model

Primary operational entities:

```text
WorkflowOperation
WorkflowExecution
WorkflowStep
CompensationAction
```

---

# 70. Workflow Operation

Fields:

```text
_id
tenantId
operationId
operationType
state
currentStep
status
idempotencyKey
correlationId
startedAt
completedAt
failedAt
retryCount
deadline
context
result
error
createdAt
updatedAt
```

Workflow state MUST be persisted for recoverability.

---

# 71. Workflow Step

Fields:

```text
_id
tenantId
operationId
stepKey
sequence
status
attempt
startedAt
completedAt
failedAt
outputReference
errorCode
errorMessage
createdAt
updatedAt
```

Each step SHOULD be independently observable.

---

# 72. Outbox Event

Represents a durable event pending publication.

Fields:

```text
_id
tenantId
eventId
eventType
eventVersion
aggregateType
aggregateId
operationId
correlationId
causationId
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

Recommended uniqueness:

```text
eventId
```

An outbox event MUST be written atomically with the domain transaction it describes whenever the Outbox pattern is used.

---

# 73. Event Consumer Record

Where consumer-side deduplication is required, maintain a durable consumer record.

Fields:

```text
_id
consumerName
eventId
eventType
status
processedAt
attempts
lastError
createdAt
updatedAt
```

Recommended uniqueness:

```text
consumerName + eventId
```

This supports at-least-once event delivery with idempotent consumption.

---

# 74. Dead Letter Record

Represents an event/job that exhausted automated processing.

Fields:

```text
_id
tenantId
sourceType
sourceId
eventType
operationId
payload
attempts
failureCode
failureReason
status
lastAttemptAt
replayedAt
replayedBy
createdAt
updatedAt
```

Dead-letter records MUST support controlled investigation and replay.

---

# 75. Job / Batch Operation

Long-running processing entities SHOULD contain:

```text
_id
tenantId
jobType
operationKey
status
claimOwner
claimedAt
claimExpiresAt
attempts
scheduledAt
startedAt
completedAt
failedAt
result
error
createdAt
updatedAt
```

Claim semantics MUST prevent two active workers from owning the same job simultaneously.

---

# 76. Audit Log

Audit logs represent security, compliance, and operational evidence.

Fields:

```text
_id
tenantId
eventId
actorType
actorId
action
resourceType
resourceId
requestId
correlationId
operationId
before
after
result
reason
ipAddress
userAgent
hash
previousHash
timestamp
```

For hash-chained audit implementations:

```text
previousHash
+
canonicalEvent
=
currentHash
```

Audit records SHOULD be append-only.

---

# 77. Soft Deletion

Soft deletion MAY be used for non-financial administrative data.

Example:

```text
deletedAt
deletedBy
deletionReason
```

Financial records MUST NOT be soft-deleted in a way that removes them from the authoritative financial history.

Financial correction is accomplished by reversal/adjustment.

---

# 78. Versioning

Versioning is required when a record's business meaning evolves.

Common approaches:

```text
schemaVersion
version
effectiveFrom
effectiveTo
policyVersion
modelVersion
scoringVersion
```

Versioning is especially important for:

* loan products;
* savings products;
* risk models;
* regulatory payloads;
* event schemas;
* pricing;
* billing rules.

---

# 79. Currency Model

Financial entities MUST explicitly identify currency.

Recommended:

```text
currency
```

Prefer ISO-style currency codes.

Amounts MUST use a representation that avoids floating-point financial errors.

Where integer minor units are used:

```text
amountMinor
currency
```

Where decimal storage is used, the precision and rounding rules MUST be explicit.

Financial calculations MUST use deterministic rounding policies.

---

# 80. Monetary Invariants

Every monetary record MUST preserve:

```text
amount >= 0
currency != null
```

where non-negative amounts are semantically appropriate.

Debit/credit direction MUST be represented explicitly.

Do not encode monetary direction ambiguously as a signed value unless the domain contract explicitly defines that convention.

---

# 81. Financial Referential Integrity

The following references require controlled integrity:

```text
JournalEntry → Journal
Journal → Transaction
Transaction → Account / Journal
Loan → LoanApplication
Repayment → Loan
Contribution → SavingsAccount
PaymentOperation → Transaction
Settlement → PaymentOperation / Transaction
ReconciliationRecord → StatementLine / Transaction
```

Orphaned financial references SHOULD be prevented.

---

# 82. Data Integrity Rules

The data layer MUST enforce, where possible:

* required fields;
* valid enumerations;
* valid references;
* unique business keys;
* tenant-scoped uniqueness;
* amount constraints;
* state transition constraints;
* immutable fields;
* timestamps;
* schema validation.

Application-level validation is necessary but SHOULD be reinforced by database constraints where available.

---

# 83. Indexing Standards

Every high-volume production collection SHOULD have explicit indexes.

Indexes MUST support:

* tenant filtering;
* primary lookup patterns;
* state-based workers;
* idempotency;
* provider reconciliation;
* time-based operations;
* uniqueness.

Avoid uncontrolled index proliferation.

---

# 84. Core Compound Index Patterns

Representative patterns include:

```text
{ tenantId: 1, status: 1, createdAt: -1 }

{ tenantId: 1, memberId: 1 }

{ tenantId: 1, groupId: 1, memberId: 1 }

{ tenantId: 1, accountId: 1 }

{ tenantId: 1, transactionNumber: 1 }

{ tenantId: 1, operationKey: 1 }

{ tenantId: 1, idempotencyKey: 1 }

{ tenantId: 1, correlationId: 1 }

{ provider: 1, providerTransactionId: 1 }

{ provider: 1, providerEventId: 1 }
```

Exact indexes MUST be derived from real query patterns.

---

# 85. Unique Index Rules

Uniqueness MUST be deliberately scoped.

Examples:

```text
tenantId + accountCode
tenantId + memberNumber
tenantId + loanNumber
tenantId + operationKey
consumerName + eventId
provider + providerTransactionId
provider + providerEventId
```

Global uniqueness MUST NOT be assumed when tenant scope is required.

---

# 86. Partial Indexes

Partial indexes SHOULD be considered for:

* active records;
* unexpired claims;
* non-deleted data;
* pending jobs;
* unresolved alerts.

This helps reduce index size and supports operational query patterns.

---

# 87. Time-Based Data

High-volume operational collections SHOULD consider:

* archival;
* retention windows;
* TTL indexes where safe;
* partitioning/sharding strategies as scale requires.

TTL indexes MUST NOT be used for authoritative financial records unless the retention and legal/accounting policy explicitly permits deletion.

---

# 88. Immutability Model

The following records are immutable after posting/finalization:

```text
Journal
JournalEntry
Posted Transaction
Closed Financial Period
Submitted Regulatory Payload
Completed Audit Event
Provider Callback Evidence
```

Immutable means:

> The historical meaning cannot be overwritten.

Metadata updates MAY be allowed where explicitly defined, but financial meaning MUST remain unchanged.

---

# 89. State Transition Storage

Every stateful model SHOULD store:

```text
status
```

and MAY maintain:

```text
stateVersion
lastTransitionAt
lastTransitionBy
transitionReason
```

For highly controlled workflows, transition history SHOULD be persisted separately.

---

# 90. State History

A generic transition history model MAY be:

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
correlationId
operationId
timestamp
metadata
```

This is particularly useful for:

* loans;
* payments;
* onboarding;
* compliance cases;
* workflow operations.

---

# 91. Data Access Layer

Repositories SHOULD prevent accidental unsafe access patterns.

Examples:

```text
findById(tenantId, id)
findOneByOperationKey(tenantId, key)
findByProviderReference(provider, reference)
claim(operationId, owner)
complete(operationId, owner)
fail(operationId, owner)
```

Financial repositories SHOULD expose domain-safe operations instead of arbitrary update methods where feasible.

---

# 92. Unsafe Repository Patterns

Avoid unrestricted methods such as:

```text
updateBalance()
setStatus()
deleteFinancialRecord()
overwritePostedTransaction()
```

Prefer guarded methods:

```text
postTransaction()
reverseTransaction()
applyAdjustment()
transitionStatus()
claim()
complete()
fail()
```

---

# 93. Repository Concurrency Rules

State-sensitive updates SHOULD use expected-state conditions.

Example:

```text
filter:
{
  _id,
  status: "PROCESSING",
  claimOwner
}
```

then atomically transition to:

```text
COMPLETE
```

This prevents stale workers from completing work they no longer own.

---

# 94. Data Encryption

Sensitive data SHOULD be encrypted:

* in transit;
* at rest;
* within sensitive object storage;
* within secrets systems.

Highly sensitive fields MAY require application-level field encryption where necessary.

Encryption keys MUST be managed independently from application source code.

---

# 95. PII Protection

Personally identifiable information SHOULD be minimized.

Store only what is operationally necessary.

Examples include:

```text
identity number
date of birth
phone
email
address
KYC metadata
```

Access to sensitive PII MUST be role-controlled and audited.

---

# 96. Secret Management

The following MUST NOT be committed to source control:

```text
passwords
API keys
provider client secrets
OAuth secrets
JWT signing secrets
encryption keys
private keys
refresh tokens
database credentials
```

Secrets SHOULD be provided through secure environment/configuration mechanisms or a dedicated secrets manager.

---

# 97. Data Retention

Retention SHOULD be defined by domain.

Indicative classification:

```text
Financial Records
→ Long-term / statutory retention

Audit Records
→ Long-term retention

Regulatory Records
→ Regulatory retention

Operational Logs
→ Shorter operational retention

Cache
→ Short-lived

Temporary Processing Data
→ Short-lived / TTL
```

Exact periods MUST be defined by legal, regulatory, security, and operational requirements.

---

# 98. Archival Strategy

Archiving SHOULD occur without breaking referential integrity.

A financial record MUST remain discoverable even when moved from hot operational storage to archive storage.

The architecture SHOULD preserve:

```text
originalId
tenantId
archiveLocation
archivedAt
checksum
```

---

# 99. Data Migration Rules

Schema migrations MUST be:

* version-controlled;
* reversible where practical;
* idempotent;
* observable;
* tested on representative data;
* compatible with rolling deployments where required.

Do not combine destructive migrations with application rollout without a controlled migration strategy.

---

# 100. Migration Pattern

Preferred:

```text
1. Add new field/model
2. Deploy backward-compatible code
3. Backfill data
4. Validate
5. Switch reads
6. Switch writes
7. Monitor
8. Remove legacy path only after stabilization
```

---

# 101. Financial Migration Rules

Financial historical data MUST NOT be rewritten casually.

Any financial migration requires:

```text
data reconciliation
ledger integrity validation
before/after totals
audit evidence
rollback or recovery strategy
```

Historical financial semantics MUST be preserved.

---

# 102. Referential Validation Jobs

The platform SHOULD periodically validate:

```text
orphaned journal entries
missing ledger references
duplicate operation keys
duplicate provider references
broken tenant ownership
stale processing claims
unresolved reconciliation exceptions
invalid financial period postings
```

Validation failures SHOULD generate operational alerts.

---

# 103. Ledger Integrity Checks

A ledger integrity job SHOULD verify:

```text
Debits = Credits
```

for every posted journal.

It SHOULD also verify:

```text
transaction → journal
journal → entries
entry → account
account → tenant
```

and detect duplicate or invalid postings.

---

# 104. Balance Integrity

Balance verification SHOULD compare:

```text
Opening Balance
+
Debits
-
Credits
+
Adjustments
-
Reversals
=
Closing Balance
```

The exact accounting equation depends on account type and representation, but all calculations MUST be deterministic and auditable.

---

# 105. Data Event Metadata

Events emitted from model changes SHOULD carry:

```text
eventId
eventType
eventVersion
tenantId
aggregateType
aggregateId
operationId
correlationId
causationId
occurredAt
producer
schemaVersion
```

---

# 106. Event Payload Rules

Event payloads MUST be:

* versioned;
* minimal;
* deterministic;
* safe for consumers;
* free of secrets;
* explicit about identifiers.

Avoid embedding unnecessary full database documents into events.

---

# 107. Read Models and Projections

Read-optimized projections MAY exist for:

* dashboards;
* statements;
* reporting;
* analytics;
* operational views.

Projection names SHOULD make it clear that they are derived.

Example:

```text
AccountBalanceProjection
LoanDashboardProjection
TenantUsageProjection
SettlementDashboardProjection
```

A projection MUST NOT silently become the authoritative source of financial truth.

---

# 108. Search Indexes

Search-oriented data MAY be replicated into specialized search infrastructure.

Search replicas are non-authoritative.

Search results MUST link back to authoritative identifiers.

---

# 109. Caching Model

Cache keys SHOULD be tenant-aware.

Preferred:

```text
tenant:{tenantId}:resource:{resourceId}
```

Avoid:

```text
resource:{resourceId}
```

when resource identity is tenant-scoped.

Cache invalidation MUST occur when authoritative state changes.

---

# 110. Object/File Data

KYC documents, regulatory files, statements, and other binary artifacts SHOULD be stored outside MongoDB where appropriate.

Database records SHOULD store metadata:

```text
fileId
storageProvider
storageKey
contentType
contentLength
checksum
encryptionStatus
uploadedAt
```

The object storage reference MUST NOT itself expose sensitive credentials.

---

# 111. Data Checksums

Checksums SHOULD be used for critical immutable artifacts:

```text
statement files
regulatory submissions
audit payloads
provider callback payloads
export files
```

Example:

```text
SHA-256(payload)
```

The checksum supports integrity verification and duplicate detection.

---

# 112. Raw Provider Payloads

Raw provider payloads MAY be preserved for:

* callback auditing;
* dispute resolution;
* forensic analysis;
* provider reconciliation.

Raw payload storage MUST be:

* access-controlled;
* retention-controlled;
* integrity-protected;
* free of unnecessary secret material.

---

# 113. API DTO vs Persistence Model

API request/response DTOs SHOULD NOT simply expose raw database documents.

Use:

```text
HTTP DTO
    ↓
Application Model
    ↓
Domain Model
    ↓
Persistence Model
```

This protects the data model from accidental API coupling.

---

# 114. Data Model vs Domain Model

Persistence schemas SHOULD represent storage concerns.

Domain models SHOULD represent business concepts and invariants.

Do not allow MongoDB-specific behavior to leak throughout the business domain.

---

# 115. MongoDB/Mongoose Standards

Mongoose models SHOULD:

* define explicit schemas;
* disable uncontrolled auto-indexing in production where operational policy requires;
* define indexes explicitly;
* validate enumerations;
* define timestamps;
* prevent accidental strict-mode violations;
* avoid excessive virtual business logic;
* expose domain-safe static/model methods only when appropriate.

Production index creation MUST be operationally controlled.

---

# 116. Auto-Indexing Policy

In production environments:

```text
autoIndex = false
```

SHOULD be considered the default.

Indexes SHOULD be created through controlled deployment/migration procedures.

Model imports MUST occur only after global Mongoose configuration has been established where required.

---

# 117. Duplicate Index Prevention

Model definitions MUST avoid declaring duplicate indexes through both:

```text
field: { unique: true }
```

and a duplicate explicit schema index unless intentionally required.

Index definitions MUST be reviewed during schema changes.

---

# 118. Default Values

Defaults MUST be deterministic.

Do not use unstable default values for important financial data.

Example:

```text
createdAt → current timestamp
status → explicitly defined initial state
currency → only if inherited deterministically from context
```

Financial amounts SHOULD never default silently to a meaningful value without explicit business semantics.

---

# 119. Nullability

Nullability MUST have defined semantics.

Use:

```text
null
```

only when “known to be empty/not applicable” has meaningful business semantics.

Avoid ambiguous mixtures of:

```text
null
undefined
empty string
zero
false
```

for the same conceptual field.

---

# 120. Enumerations

Statuses SHOULD use controlled enumerations.

Avoid arbitrary free-text status values.

Examples:

```text
PENDING
PROCESSING
COMPLETED
FAILED
CANCELLED
EXPIRED
REVERSED
```

Status changes MUST be validated through explicit state-transition logic.

---

# 121. Data Integrity Across Modules

Cross-domain writes SHOULD follow this pattern:

```text
Originating Domain
      ↓
Application Service
      ↓
Authoritative Owner
      ↓
Transactional Write
      ↓
Outbox Event
      ↓
Dependent Domain Projection / Action
```

Do not allow a dependent module to directly mutate another domain's private state.

---

# 122. Example: Loan Disbursement

Correct data relationship:

```text
LoanApplication
      │
      ▼
Loan
      │
      ▼
Disbursement
      │
      ▼
PaymentOperation
      │
      ▼
Transaction
      │
      ▼
Journal
      │
      ├── JournalEntry → Loan Account
      └── JournalEntry → Cash/Settlement Account
```

This creates a traceable chain:

```text
Loan
→ Payment
→ Transaction
→ Journal
→ Entries
→ Accounts
```

---

# 123. Example: Savings Contribution

```text
Member
   ↓
SavingsAccount
   ↓
Contribution
   ↓
PaymentOperation
   ↓
Transaction
   ↓
Journal
   ↓
JournalEntries
```

Every financial effect remains traceable.

---

# 124. Example: Provider Callback

```text
CallbackRecord
      ↓
ProviderTransaction
      ↓
PaymentOperation
      ↓
Transaction
      ↓
Ledger Posting
      ↓
Settlement / Reconciliation
```

This supports end-to-end traceability.

---

# 125. Example: Statement Reconciliation

```text
Statement
   ↓
StatementBatch
   ↓
StatementLine
   ↓
ReconciliationRecord
   ↓
Transaction
   ↓
Ledger
```

Unmatched records flow into:

```text
Repair / Investigation
```

rather than being silently posted.

---

# 126. Data Lifecycle

Each domain model SHOULD define:

```text
creation
validation
activation
processing
completion
failure
closure
archival
```

Lifecycle ownership MUST be explicit.

---

# 127. Data Quality Rules

Production data quality controls SHOULD detect:

```text
duplicate IDs
duplicate business keys
missing tenant IDs
invalid status values
orphan references
negative invalid amounts
currency mismatches
broken ledger references
stale operations
unclaimed jobs
duplicate provider callbacks
unreconciled settlement entries
```

---

# 128. Currency Consistency

Cross-document financial operations MUST validate currency compatibility.

For example:

```text
PaymentOperation.currency
=
Transaction.currency
=
Journal.currency
=
JournalEntry.currency
```

unless explicit foreign-exchange semantics are modeled.

---

# 129. Foreign Exchange

If FX is introduced, do not overload ordinary amount fields.

A proper FX model SHOULD contain:

```text
sourceCurrency
sourceAmount
targetCurrency
targetAmount
exchangeRate
rateProvider
rateTimestamp
roundingPolicy
```

The resulting accounting entries MUST remain balanced.

---

# 130. Metadata and Extensibility

Flexible metadata MAY be included:

```text
metadata: {}
```

However, metadata MUST NOT become an uncontrolled replacement for schema design.

Business-critical fields belong in explicit schema fields.

---

# 131. Sensitive Field Logging Rules

Repository and API logging MUST redact:

```text
passwordHash
accessToken
refreshToken
clientSecret
apiKey
identityNumber
KYC documents
full payment credentials
```

Large sensitive documents SHOULD never be logged.

---

# 132. Data Access Auditing

Read access MAY require auditing for particularly sensitive domains:

```text
KYC
AML
Regulatory
Identity
Fraud
Security
```

Audit depth SHOULD reflect risk.

---

# 133. Model Testing Requirements

Every critical model SHOULD have tests covering:

```text
schema validation
required fields
enum validation
tenant isolation
unique indexes
state transitions
immutability
financial invariants
concurrency
idempotency
serialization
migration compatibility
```

Financial models require especially strong integration tests.

---

# 134. Model Integration Testing

Critical workflows SHOULD verify complete relationships.

Examples:

```text
Loan → Disbursement → Payment → Ledger

Contribution → Payment → Ledger

Callback → PaymentOperation → Transaction

Statement → Reconciliation → Transaction

BillingOperation → Subscription → Ledger/Billing workflow
```

---

# 135. Data Model Production Gate

A production-ready model MUST satisfy:

```text
[ ] Domain ownership defined
[ ] Tenant scope defined
[ ] Identifier strategy defined
[ ] Lifecycle defined
[ ] State machine defined where necessary
[ ] Required fields defined
[ ] Unique keys defined
[ ] Indexes defined
[ ] Concurrency semantics defined
[ ] Audit requirements defined
[ ] Data classification defined
[ ] Retention policy defined
[ ] Migration strategy defined
[ ] Security controls defined
[ ] Tests defined
[ ] Operational observability defined
```

Financial models additionally require:

```text
[ ] Double-entry impact defined
[ ] Posting identity defined
[ ] Reversal behavior defined
[ ] Reconciliation behavior defined
[ ] Immutability rules defined
[ ] Period-close behavior defined
```

---

# 136. Canonical Financial Relationship Graph

```text
                ┌──────────────┐
                │   Business   │
                │   Operation  │
                └──────┬───────┘
                       │
                       ▼
              ┌─────────────────┐
              │ Payment / Loan  │
              │ / Savings       │
              └───────┬─────────┘
                      │
                      ▼
              ┌─────────────────┐
              │   Transaction   │
              └───────┬─────────┘
                      │
                      ▼
              ┌─────────────────┐
              │     Journal     │
              └───────┬─────────┘
                      │
             ┌────────┴────────┐
             ▼                 ▼
      ┌──────────────┐  ┌──────────────┐
      │ JournalEntry │  │ JournalEntry │
      └──────┬───────┘  └──────┬───────┘
             │                 │
             ▼                 ▼
        ┌─────────┐       ┌─────────┐
        │ Account │       │ Account │
        └─────────┘       └─────────┘
```

---

# 137. Canonical Tenant Relationship Graph

```text
Tenant
 ├── Users
 │    └── TenantMembership
 │
 ├── Groups
 │    ├── Members
 │    ├── Savings
 │    └── Loans
 │
 ├── Payments
 ├── Settlements
 ├── Compliance
 ├── Risk
 ├── Fraud
 ├── Billing
 └── Financial Core
      ├── Accounts
      ├── Journals
      ├── Transactions
      ├── Snapshots
      └── Periods
```

---

# 138. Canonical Payment Relationship Graph

```text
PaymentOperation
      │
      ├── PaymentAttempt(s)
      │
      ├── ProviderTransaction
      │
      ├── CallbackRecord(s)
      │
      └── Transaction
             │
             └── Journal
                    └── JournalEntry(s)
```

---

# 139. Canonical Lending Relationship Graph

```text
LoanProduct
      │
      ▼
LoanApplication
      │
      ├── LoanRiskProfile
      │
      └── LoanApproval
              │
              ▼
             Loan
              │
       ┌──────┼─────────────┐
       ▼      ▼             ▼
Disbursement  Schedule   Repayment
       │                     │
       ▼                     ▼
PaymentOperation       Transaction
                             │
                             ▼
                           Ledger
```

---

# 140. Canonical Settlement Relationship Graph

```text
Provider
   │
   ▼
Statement
   │
   ▼
StatementBatch
   │
   ▼
StatementLine
   │
   ▼
ReconciliationRecord
   │
   ├── Matched → Transaction
   │
   └── Exception → Repair / Investigation
```

---

# 141. Canonical Event Relationship

```text
Domain Aggregate
      │
      ▼
Transactional Write
      │
      ├── State Change
      └── OutboxEvent
              │
              ▼
          Publisher
              │
        ┌─────┼─────┐
        ▼     ▼     ▼
      Risk  Alerts Reporting
```

---

# 142. Model Catalogue Maintenance Rules

This catalogue MUST be updated whenever any of the following occurs:

* new authoritative entity;
* changed ownership;
* changed financial behavior;
* new tenant boundary;
* new lifecycle state;
* new unique key;
* new external reference;
* new high-risk field;
* changed retention requirement;
* changed relationship;
* migration of persistent state.

Code changes that alter data semantics MUST include documentation changes.

---

# 143. Review Requirements

Data model changes SHOULD be reviewed by the appropriate owners:

```text
Architecture
Database / Engineering
Security
Finance / Accounting
Compliance
Operations
```

High-risk financial changes require stronger review than ordinary metadata changes.

---

# 144. Architectural Data Invariants

The following invariants are mandatory:

```text
1. Every tenant-owned record is tenant-scoped.
2. Every critical entity has one authoritative owner.
3. Every financial posting is balanced.
4. Every posted financial record is immutable.
5. Every correction uses reversal or adjustment semantics.
6. Every critical operation has stable identity.
7. Every retryable operation supports idempotency.
8. Every provider transaction can be reconciled to an internal operation.
9. Every critical external event can be traced to a durable record.
10. Every asynchronous critical event has recoverable delivery state.
11. Every worker operation supports safe ownership.
12. Every sensitive record has defined access controls.
13. Every high-value record is auditable.
14. Every migration preserves data meaning and integrity.
15. No cache or projection replaces authoritative financial state.
```

---

# 145. Final Data Architecture Rule

The central data architecture rule for TITech Community Capital is:

> **Every critical datum must have one authoritative owner, every tenant-owned record must be isolated by tenant context, every financial effect must be represented through immutable double-entry accounting, every operational workflow must be identifiable and idempotent, every cross-domain relationship must remain traceable, and every production-critical record must be secure, auditable, recoverable, and operationally observable.**

---

# 146. Related Documents

This catalogue MUST remain aligned with:

```text
docs/02-architecture/ARCHITECTURE_MAP.md
docs/02-architecture/SERVICE_CATALOGUE.md
docs/02-architecture/API_CATALOGUE.md
docs/02-architecture/SECURITY_MODEL.md
docs/02-architecture/EVENT_CATALOGUE.md
docs/02-architecture/FINANCIAL_LEDGER_SPECIFICATION.md
docs/02-architecture/TRANSACTION_STATE_MACHINE.md
```

Where a data-model implementation conflicts with this catalogue, the approved architecture/data-model decision and migration plan determine the target state.

---

**End of Data Model Catalogue**