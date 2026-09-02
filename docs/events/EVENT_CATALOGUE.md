# TITech Community Capital Ltd — Event Catalogue

> **System:** Community Savings Platform
> **Document:** `docs/events/EVENT_CATALOGUE.md`
> **Status:** Enterprise Production Architecture Reference
> **Version:** 2.0
> **Last Updated:** August 16, 2026
> **Scope:** Domain events, integration events, financial events, payment events, compliance events, workflow events, outbox processing, event contracts, delivery guarantees, idempotency, retries, dead-letter handling, replay, observability, and event governance.

---

# 1. Purpose

This document is the central catalogue for events emitted, consumed, persisted, retried, replayed, or integrated by the TITech Community Capital Community Savings Platform.

The event architecture exists to decouple bounded services while preserving:

* Financial integrity
* Transaction traceability
* Tenant isolation
* Idempotency
* Reliable delivery
* Auditability
* Operational observability
* Event replayability
* Backward-compatible event evolution

This catalogue defines the logical event contract.

The physical implementation may use:

```text
Outbox pattern
Redis
BullMQ
Message broker
Internal event bus
Webhook dispatcher
Provider callback processor
Managed event infrastructure
```

The event transport must not become the source of financial truth.

---

# 2. Event Architecture Principles

## 2.1 Events Are Facts

An event represents something that has happened.

Preferred naming:

```text
LoanApplied
LoanApproved
LoanDisbursed
PaymentCompleted
ContributionPosted
```

Avoid event names that represent commands:

```text
ApproveLoan
DisburseLoan
MakePayment
```

Commands request actions.

Events report completed facts.

---

## 2.2 Events Must Be Immutable

Once published, an event must not be modified.

If a correction is required, publish another event.

Example:

```text
PaymentCompleted
      |
      v
PaymentReversed
```

Do not edit the historical `PaymentCompleted` event.

---

## 2.3 Event IDs Are Globally Unique

Every event must have a unique:

```text
eventId
```

The identifier is used for:

```text
deduplication
traceability
replay
audit
consumer processing
incident investigation
```

---

## 2.4 Every Event Has an Aggregate

Each business event must identify its primary aggregate:

```text
aggregateType
aggregateId
aggregateVersion
```

Example:

```json
{
  "aggregateType": "Loan",
  "aggregateId": "loan_01J...",
  "aggregateVersion": 7
}
```

---

## 2.5 Tenant Context Is Mandatory

All tenant-scoped events must include:

```text
tenantId
```

A global platform event may explicitly declare:

```text
scope = global
```

Tenant identity must be established by trusted application context.

It must never be inferred from arbitrary consumer input.

---

## 2.6 Events Are At-Least-Once by Default

Consumers must assume that an event may be delivered more than once.

Therefore:

```text
consumer processing must be idempotent
```

An event consumer must not assume exactly-once delivery unless the transport and implementation explicitly guarantee it.

---

# 3. Canonical Event Envelope

All internal domain events should follow a common envelope.

```json
{
  "eventId": "evt_01JABCDE...",
  "eventType": "LoanDisbursed",
  "eventVersion": 1,
  "eventSchema": "titech.loan.disbursed.v1",
  "occurredAt": "2026-08-16T00:00:00.000Z",
  "publishedAt": null,
  "tenantId": "tenant_01J...",
  "aggregateType": "Loan",
  "aggregateId": "loan_01J...",
  "aggregateVersion": 8,
  "correlationId": "corr_01J...",
  "causationId": "evt_01J...",
  "requestId": "req_01J...",
  "producer": "LoanService",
  "environment": "production",
  "data": {}
}
```

---

# 4. Canonical Event Fields

| Field              |    Required | Purpose                             |
| ------------------ | ----------: | ----------------------------------- |
| `eventId`          |         Yes | Unique event identity               |
| `eventType`        |         Yes | Logical event name                  |
| `eventVersion`     |         Yes | Contract version                    |
| `eventSchema`      |         Yes | Schema identifier                   |
| `occurredAt`       |         Yes | Time event actually occurred        |
| `publishedAt`      |          No | Time event was published            |
| `tenantId`         |     Usually | Tenant ownership                    |
| `aggregateType`    |         Yes | Aggregate/resource type             |
| `aggregateId`      |         Yes | Aggregate identity                  |
| `aggregateVersion` | Recommended | Aggregate version at event creation |
| `correlationId`    | Recommended | End-to-end business flow            |
| `causationId`      | Recommended | Event that caused this event        |
| `requestId`        | Recommended | HTTP/request correlation            |
| `producer`         |         Yes | Producing service/module            |
| `environment`      |         Yes | Runtime environment                 |
| `data`             |         Yes | Event-specific payload              |

---

# 5. Event Naming Standard

Event names should use past-tense business facts.

Recommended:

```text
UserRegistered
UserVerified
GroupCreated
ContributionPosted
LoanApplied
LoanApproved
LoanDisbursed
LoanPaymentRecorded
PaymentCompleted
StatementProcessed
ReconciliationCompleted
KycVerified
```

Avoid:

```text
CreateUser
ApproveLoan
ProcessPayment
DoReconciliation
```

Those represent commands rather than facts.

---

# 6. Event Categories

Events are grouped into the following domains:

```text
Identity
Tenant/SaaS
Groups
Membership
Savings
Loans
Finance/Ledger
Payments
Provider Callbacks
Statements
Reconciliation
Compliance
Notifications
Chat
Help Center
FAQ
Community Forum
Referrals
Risk/Fraud
Administration
Audit
Workflow
Platform
```

---

# 7. Event Classification

Each event must be classified as one of:

```text
domain
integration
workflow
audit
operational
```

## Domain Event

Represents an important business fact within the platform.

Example:

```text
LoanApproved
```

## Integration Event

Intended for external or cross-boundary consumption.

Example:

```text
PaymentCompleted
```

## Workflow Event

Represents asynchronous workflow progress.

Example:

```text
StatementProcessingCompleted
```

## Audit Event

Represents an auditable security/administrative action.

Example:

```text
AdminUserSuspended
```

## Operational Event

Represents infrastructure/application state.

Example:

```text
ServiceDegraded
```

Operational events should not replace monitoring systems.

---

# 8. Event Source of Truth

An event is not normally the source of truth for the business entity that emitted it.

Example:

```text
Loan
  |
  +--> LoanApproved
```

The `Loan` aggregate remains authoritative.

The event communicates a fact about that aggregate.

For financial operations:

```text
Ledger
  |
  +--> Financial event
```

The ledger remains authoritative.

---

# 9. Event Catalogue — Identity

## UserRegistered

**Type**

```text
UserRegistered
```

**Schema**

```text
titech.identity.user-registered.v1
```

**Producer**

```text
AuthService
```

**Consumers**

```text
NotificationService
OnboardingService
Analytics
AuditService
ReferralService
```

**Payload**

```json
{
  "userId": "user_01J...",
  "tenantId": "tenant_01J...",
  "email": "justine@titech.com",
  "name": "Justine Robert",
  "registrationSource": "web"
}
```

Sensitive authentication credentials must never be included.

---

## UserVerified

```text
titech.identity.user-verified.v1
```

Payload:

```json
{
  "userId": "user_01J...",
  "verificationType": "email",
  "verifiedAt": "2026-08-16T00:00:00.000Z"
}
```

---

## UserSuspended

```text
titech.identity.user-suspended.v1
```

Payload:

```json
{
  "userId": "user_01J...",
  "reasonCode": "policy_violation",
  "suspendedAt": "2026-08-16T00:00:00.000Z"
}
```

---

## UserReactivated

```text
titech.identity.user-reactivated.v1
```

---

## UserDeactivated

```text
titech.identity.user-deactivated.v1
```

---

# 10. Event Catalogue — Tenant & SaaS

## TenantCreated

```text
titech.tenant.created.v1
```

Payload:

```json
{
  "tenantId": "tenant_01J...",
  "name": "Example SACCO",
  "country": "UG",
  "currency": "UGX"
}
```

---

## TenantActivated

```text
titech.tenant.activated.v1
```

---

## TenantSuspended

```text
titech.tenant.suspended.v1
```

---

## TenantTerminated

```text
titech.tenant.terminated.v1
```

---

## SubscriptionActivated

```text
titech.saas.subscription-activated.v1
```

---

## SubscriptionChanged

```text
titech.saas.subscription-changed.v1
```

---

## SubscriptionSuspended

```text
titech.saas.subscription-suspended.v1
```

---

## SubscriptionCancelled

```text
titech.saas.subscription-cancelled.v1
```

---

# 11. Event Catalogue — Groups

## GroupCreated

```text
titech.group.created.v1
```

Payload:

```json
{
  "groupId": "group_01J...",
  "tenantId": "tenant_01J...",
  "name": "Example Community Group",
  "createdBy": "user_01J..."
}
```

---

## GroupActivated

```text
titech.group.activated.v1
```

---

## GroupSuspended

```text
titech.group.suspended.v1
```

---

## GroupClosed

```text
titech.group.closed.v1
```

---

# 12. Event Catalogue — Membership

## MemberAdded

```text
titech.membership.member-added.v1
```

Payload:

```json
{
  "membershipId": "membership_01J...",
  "groupId": "group_01J...",
  "userId": "user_01J...",
  "role": "member"
}
```

---

## MemberActivated

```text
titech.membership.member-activated.v1
```

---

## MemberSuspended

```text
titech.membership.member-suspended.v1
```

---

## MemberRemoved

```text
titech.membership.member-removed.v1
```

---

## MemberRoleChanged

```text
titech.membership.member-role-changed.v1
```

Payload:

```json
{
  "membershipId": "membership_01J...",
  "previousRole": "member",
  "newRole": "treasurer",
  "changedBy": "user_01J..."
}
```

---

# 13. Event Catalogue — Savings

## ContributionInitiated

```text
titech.savings.contribution-initiated.v1
```

---

## ContributionPosted

```text
titech.savings.contribution-posted.v1
```

Payload:

```json
{
  "contributionId": "contribution_01J...",
  "groupId": "group_01J...",
  "userId": "user_01J...",
  "amount": "50000.00",
  "currency": "UGX",
  "paymentId": "payment_01J...",
  "financialTransactionId": "txn_01J..."
}
```

A `ContributionPosted` event must only be emitted after the authoritative posting operation succeeds.

---

## ContributionFailed

```text
titech.savings.contribution-failed.v1
```

---

## ContributionReversed

```text
titech.savings.contribution-reversed.v1
```

Payload should include:

```json
{
  "contributionId": "contribution_01J...",
  "reversalTransactionId": "txn_01J...",
  "reasonCode": "payment_reversed"
}
```

---

# 14. Event Catalogue — Loans

## LoanEligibilityEvaluated

```text
titech.loan.eligibility-evaluated.v1
```

Payload:

```json
{
  "loanApplicationId": "application_01J...",
  "userId": "user_01J...",
  "groupId": "group_01J...",
  "eligible": true,
  "score": 75.5,
  "maxLoanAmount": "50000.00",
  "currency": "UGX"
}
```

Sensitive scoring features should only be included where policy permits.

---

## LoanApplied

```text
titech.loan.applied.v1
```

Payload:

```json
{
  "loanApplicationId": "application_01J...",
  "userId": "user_01J...",
  "groupId": "group_01J...",
  "amount": "30000.00",
  "currency": "UGX",
  "reason": "Business expansion"
}
```

---

## LoanReviewStarted

```text
titech.loan.review-started.v1
```

---

## LoanApproved

```text
titech.loan.approved.v1
```

Payload:

```json
{
  "loanId": "loan_01J...",
  "approvedAmount": "30000.00",
  "currency": "UGX",
  "interestRate": "5.00",
  "termMonths": 6,
  "approvedBy": "user_01J..."
}
```

---

## LoanRejected

```text
titech.loan.rejected.v1
```

---

## LoanDisbursementInitiated

```text
titech.loan.disbursement-initiated.v1
```

---

## LoanDisbursed

```text
titech.loan.disbursed.v1
```

Payload:

```json
{
  "loanId": "loan_01J...",
  "paymentId": "payment_01J...",
  "financialTransactionId": "txn_01J...",
  "amount": "30000.00",
  "currency": "UGX"
}
```

`LoanDisbursed` must not be emitted merely because a disbursement request was submitted.

It represents a confirmed business state.

---

## LoanActivated

```text
titech.loan.activated.v1
```

---

## LoanPaymentRecorded

```text
titech.loan.payment-recorded.v1
```

Payload:

```json
{
  "loanId": "loan_01J...",
  "repaymentId": "repayment_01J...",
  "paymentId": "payment_01J...",
  "amount": "5500.00",
  "currency": "UGX",
  "allocation": {
    "principal": "4500.00",
    "interest": "1000.00",
    "fees": "0.00"
  }
}
```

---

## LoanDelinquent

```text
titech.loan.delinquent.v1
```

---

## LoanDefaulted

```text
titech.loan.defaulted.v1
```

---

## LoanCompleted

```text
titech.loan.completed.v1
```

---

## LoanWrittenOff

```text
titech.loan.written-off.v1
```

A write-off event must reference the approved write-off operation.

---

## LoanReversed

```text
titech.loan.reversed.v1
```

---

# 15. Event Catalogue — Finance & Ledger

Financial events have the highest integrity requirements.

## FinancialTransactionInitiated

```text
titech.finance.transaction-initiated.v1
```

---

## FinancialTransactionPosted

```text
titech.finance.transaction-posted.v1
```

Payload:

```json
{
  "transactionId": "txn_01J...",
  "journalId": "journal_01J...",
  "amount": "30000.00",
  "currency": "UGX",
  "sourceType": "loan_disbursement",
  "sourceId": "loan_01J..."
}
```

---

## JournalPosted

```text
titech.finance.journal-posted.v1
```

Payload must identify:

```text
journalId
transactionId
postingDate
effectiveDate
```

Do not expose sensitive ledger internals unnecessarily.

---

## TransactionFailed

```text
titech.finance.transaction-failed.v1
```

---

## TransactionReversed

```text
titech.finance.transaction-reversed.v1
```

---

## JournalReversed

```text
titech.finance.journal-reversed.v1
```

---

## FinancialPeriodClosed

```text
titech.finance.period-closed.v1
```

---

## FinancialPeriodReopened

```text
titech.finance.period-reopened.v1
```

This is a highly privileged event and must always be audited.

---

## InterestAccrued

```text
titech.finance.interest-accrued.v1
```

---

## WriteOffPosted

```text
titech.finance.writeoff-posted.v1
```

---

# 16. Financial Event Integrity Rules

Financial events must comply with:

```text
double-entry validation
idempotent posting
immutable history
reversal-based correction
exact monetary precision
currency consistency
tenant consistency
period controls
auditability
traceability
```

The event bus cannot be used to "repair" an invalid ledger after the fact without an approved financial operation.

---

# 17. Event Catalogue — Payments

## PaymentInitiated

```text
titech.payment.initiated.v1
```

Payload:

```json
{
  "paymentId": "payment_01J...",
  "type": "loan_repayment",
  "direction": "inbound",
  "amount": "5500.00",
  "currency": "UGX",
  "provider": "mtn_momo"
}
```

---

## PaymentProcessing

```text
titech.payment.processing.v1
```

---

## PaymentCompleted

```text
titech.payment.completed.v1
```

Payload:

```json
{
  "paymentId": "payment_01J...",
  "provider": "mtn_momo",
  "providerTransactionId": "provider-reference",
  "amount": "5500.00",
  "currency": "UGX",
  "completedAt": "2026-08-16T00:00:00.000Z"
}
```

Provider confirmation must be validated before this event is emitted.

---

## PaymentFailed

```text
titech.payment.failed.v1
```

---

## PaymentCancelled

```text
titech.payment.cancelled.v1
```

---

## PaymentReversed

```text
titech.payment.reversed.v1
```

---

# 18. Event Catalogue — Provider Callbacks

## ProviderCallbackReceived

```text
titech.payment.callback-received.v1
```

Payload:

```json
{
  "callbackId": "callback_01J...",
  "provider": "mtn_momo",
  "providerEventId": "provider-event-id",
  "signatureStatus": "valid",
  "receivedAt": "2026-08-16T00:00:00.000Z"
}
```

Raw secrets or credentials must never be emitted into normal application events.

---

## ProviderCallbackValidated

```text
titech.payment.callback-validated.v1
```

---

## ProviderCallbackDuplicate

```text
titech.payment.callback-duplicate.v1
```

---

## ProviderCallbackProcessingFailed

```text
titech.payment.callback-processing-failed.v1
```

---

## ProviderCallbackDeadLettered

```text
titech.payment.callback-dead-lettered.v1
```

---

# 19. Event Catalogue — Statements

## StatementReceived

```text
titech.statement.received.v1
```

---

## StatementValidated

```text
titech.statement.validated.v1
```

---

## StatementClaimed

```text
titech.statement.claimed.v1
```

Payload:

```json
{
  "statementId": "statement_01J...",
  "batchId": "batch_01J...",
  "workerId": "worker-01",
  "claimToken": "claim-reference"
}
```

Claim tokens should not be exposed to untrusted clients.

---

## StatementProcessingStarted

```text
titech.statement.processing-started.v1
```

---

## StatementProcessingCompleted

```text
titech.statement.processing-completed.v1
```

Payload:

```json
{
  "statementId": "statement_01J...",
  "recordsProcessed": 1250,
  "successfulRecords": 1245,
  "failedRecords": 5
}
```

---

## StatementProcessingFailed

```text
titech.statement.processing-failed.v1
```

---

## StatementBatchReleased

```text
titech.statement.batch-released.v1
```

---

# 20. Event Catalogue — Reconciliation

## ReconciliationStarted

```text
titech.reconciliation.started.v1
```

---

## ReconciliationMatchCreated

```text
titech.reconciliation.match-created.v1
```

---

## ReconciliationExceptionCreated

```text
titech.reconciliation.exception-created.v1
```

Payload:

```json
{
  "exceptionId": "exception_01J...",
  "exceptionType": "unmatched_transaction",
  "severity": "high",
  "sourceId": "statement-txn_01J..."
}
```

---

## ReconciliationExceptionAssigned

```text
titech.reconciliation.exception-assigned.v1
```

---

## ReconciliationExceptionResolved

```text
titech.reconciliation.exception-resolved.v1
```

---

## ReconciliationCompleted

```text
titech.reconciliation.completed.v1
```

---

# 21. Event Catalogue — Repair

## RepairInstructionCreated

```text
titech.repair.instruction-created.v1
```

---

## RepairInstructionApproved

```text
titech.repair.instruction-approved.v1
```

---

## RepairInstructionExecuted

```text
titech.repair.instruction-executed.v1
```

---

## RepairInstructionFailed

```text
titech.repair.instruction-failed.v1
```

Any financial repair event must reference the resulting financial transaction or adjustment where applicable.

---

# 22. Event Catalogue — Compliance

## KycCaseCreated

```text
titech.compliance.kyc-case-created.v1
```

---

## KycVerificationStarted

```text
titech.compliance.kyc-verification-started.v1
```

---

## KycVerified

```text
titech.compliance.kyc-verified.v1
```

---

## KycRejected

```text
titech.compliance.kyc-rejected.v1
```

---

## AmlAlertCreated

```text
titech.compliance.aml-alert-created.v1
```

---

## AmlCaseEscalated

```text
titech.compliance.aml-case-escalated.v1
```

---

## AmlCaseCleared

```text
titech.compliance.aml-case-cleared.v1
```

---

## RegulatorySubmissionCreated

```text
titech.compliance.regulatory-submission-created.v1
```

---

## RegulatorySubmissionSubmitted

```text
titech.compliance.regulatory-submission-submitted.v1
```

---

## RegulatorySubmissionAcknowledged

```text
titech.compliance.regulatory-submission-acknowledged.v1
```

---

## RegulatorySubmissionRejected

```text
titech.compliance.regulatory-submission-rejected.v1
```

Compliance events must minimize personally identifiable information.

---

# 23. Event Catalogue — Notifications

## NotificationCreated

```text
titech.notification.created.v1
```

---

## NotificationQueued

```text
titech.notification.queued.v1
```

---

## NotificationSent

```text
titech.notification.sent.v1
```

---

## NotificationDelivered

```text
titech.notification.delivered.v1
```

---

## NotificationFailed

```text
titech.notification.failed.v1
```

---

## NotificationRead

```text
titech.notification.read.v1
```

---

# 24. Event Catalogue — Chat

## ChatMessageCreated

```text
titech.chat.message-created.v1
```

---

## ChatMessageRead

```text
titech.chat.message-read.v1
```

---

## ChatMessageFlagged

```text
titech.chat.message-flagged.v1
```

---

## ChatMessageHidden

```text
titech.chat.message-hidden.v1
```

---

## ChatMessageDeleted

```text
titech.chat.message-deleted.v1
```

---

# 25. Event Catalogue — Help Center

## HelpArticleCreated

```text
titech.help.article-created.v1
```

---

## HelpArticleUpdated

```text
titech.help.article-updated.v1
```

---

## HelpArticlePublished

```text
titech.help.article-published.v1
```

---

## HelpArticleArchived

```text
titech.help.article-archived.v1
```

---

## HelpArticleDeleted

```text
titech.help.article-deleted.v1
```

---

## HelpArticleFeedbackSubmitted

```text
titech.help.article-feedback-submitted.v1
```

---

# 26. Event Catalogue — FAQ

## FaqCreated

```text
titech.faq.created.v1
```

---

## FaqUpdated

```text
titech.faq.updated.v1
```

---

## FaqPublished

```text
titech.faq.published.v1
```

---

## FaqArchived

```text
titech.faq.archived.v1
```

---

## FaqDeleted

```text
titech.faq.deleted.v1
```

---

## FaqImportStarted

```text
titech.faq.import-started.v1
```

---

## FaqImportCompleted

```text
titech.faq.import-completed.v1
```

---

## FaqImportFailed

```text
titech.faq.import-failed.v1
```

---

# 27. Event Catalogue — Community Forum

## ForumTopicCreated

```text
titech.forum.topic-created.v1
```

---

## ForumTopicUpdated

```text
titech.forum.topic-updated.v1
```

---

## ForumTopicDeleted

```text
titech.forum.topic-deleted.v1
```

---

## ForumReplyCreated

```text
titech.forum.reply-created.v1
```

---

## ForumReplyUpdated

```text
titech.forum.reply-updated.v1
```

---

## ForumReplyDeleted

```text
titech.forum.reply-deleted.v1
```

---

## ForumReplyVoted

```text
titech.forum.reply-voted.v1
```

---

## ForumTopicSolved

```text
titech.forum.topic-solved.v1
```

---

## ForumTopicReopened

```text
titech.forum.topic-reopened.v1
```

---

## ForumTopicLocked

```text
titech.forum.topic-locked.v1
```

---

## ForumTopicUnlocked

```text
titech.forum.topic-unlocked.v1
```

---

## ForumTopicFollowed

```text
titech.forum.topic-followed.v1
```

---

## ForumTopicUnfollowed

```text
titech.forum.topic-unfollowed.v1
```

---

## ContentReported

```text
titech.community.content-reported.v1
```

---

## ContentModerationCompleted

```text
titech.community.content-moderation-completed.v1
```

---

# 28. Event Catalogue — Referrals

## ReferralCodeGenerated

```text
titech.referral.code-generated.v1
```

---

## ReferralUsed

```text
titech.referral.used.v1
```

---

## ReferralQualified

```text
titech.referral.qualified.v1
```

---

## ReferralCompleted

```text
titech.referral.completed.v1
```

---

## ReferralRewardIssued

```text
titech.referral.reward-issued.v1
```

Reward issuance must be linked to the authoritative financial operation.

---

# 29. Event Catalogue — Risk & Fraud

## RiskAssessmentCompleted

```text
titech.risk.assessment-completed.v1
```

---

## RiskLevelChanged

```text
titech.risk.level-changed.v1
```

---

## FraudAlertCreated

```text
titech.fraud.alert-created.v1
```

---

## FraudAlertEscalated

```text
titech.fraud.alert-escalated.v1
```

---

## FraudAlertResolved

```text
titech.fraud.alert-resolved.v1
```

---

## AnomalyDetected

```text
titech.risk.anomaly-detected.v1
```

Risk and fraud events should not automatically expose sensitive model features to broad consumers.

---

# 30. Event Catalogue — Administration

## AdminUserVerified

```text
titech.admin.user-verified.v1
```

---

## AdminUserSuspended

```text
titech.admin.user-suspended.v1
```

---

## AdminLoanApproved

```text
titech.admin.loan-approved.v1
```

---

## AdminLoanRejected

```text
titech.admin.loan-rejected.v1
```

---

## AdminContentModerated

```text
titech.admin.content-moderated.v1
```

Administrative actions should also generate audit records.

---

# 31. Event Catalogue — Audit

Audit events are distinct from business domain events.

## AuditEventCreated

```text
titech.audit.event-created.v1
```

Potential payload:

```json
{
  "actorId": "user_01J...",
  "action": "LOAN_APPROVED",
  "resourceType": "Loan",
  "resourceId": "loan_01J...",
  "outcome": "success",
  "requestId": "req_01J..."
}
```

Sensitive values must be redacted.

---

# 32. Event Catalogue — Workflow

## WorkflowStarted

```text
titech.workflow.started.v1
```

---

## WorkflowStepStarted

```text
titech.workflow.step-started.v1
```

---

## WorkflowStepCompleted

```text
titech.workflow.step-completed.v1
```

---

## WorkflowStepFailed

```text
titech.workflow.step-failed.v1
```

---

## WorkflowRetryScheduled

```text
titech.workflow.retry-scheduled.v1
```

---

## WorkflowCompleted

```text
titech.workflow.completed.v1
```

---

## WorkflowFailed

```text
titech.workflow.failed.v1
```

---

## WorkflowDeadLettered

```text
titech.workflow.dead-lettered.v1
```

---

# 33. Event Catalogue — Platform Operations

## ServiceStarted

```text
titech.platform.service-started.v1
```

---

## ServiceReady

```text
titech.platform.service-ready.v1
```

---

## ServiceDegraded

```text
titech.platform.service-degraded.v1
```

---

## ServiceRecovered

```text
titech.platform.service-recovered.v1
```

---

## DependencyUnavailable

```text
titech.platform.dependency-unavailable.v1
```

Operational events supplement metrics, logs, and health checks.

---

# 34. Event Catalogue Summary

| Domain         | Representative Events                                                                 |
| -------------- | ------------------------------------------------------------------------------------- |
| Identity       | `UserRegistered`, `UserVerified`, `UserSuspended`                                     |
| Tenant         | `TenantCreated`, `TenantActivated`, `TenantSuspended`                                 |
| SaaS           | `SubscriptionActivated`, `SubscriptionChanged`                                        |
| Groups         | `GroupCreated`, `GroupClosed`                                                         |
| Membership     | `MemberAdded`, `MemberRemoved`, `MemberRoleChanged`                                   |
| Savings        | `ContributionPosted`, `ContributionReversed`                                          |
| Loans          | `LoanApplied`, `LoanApproved`, `LoanDisbursed`, `LoanCompleted`                       |
| Finance        | `FinancialTransactionPosted`, `JournalPosted`, `TransactionReversed`                  |
| Payments       | `PaymentInitiated`, `PaymentCompleted`, `PaymentFailed`, `PaymentReversed`            |
| Callbacks      | `ProviderCallbackReceived`, `ProviderCallbackValidated`, `ProviderCallbackDuplicate`  |
| Statements     | `StatementReceived`, `StatementProcessingCompleted`                                   |
| Reconciliation | `ReconciliationStarted`, `ReconciliationCompleted`, `ReconciliationExceptionResolved` |
| Repairs        | `RepairInstructionCreated`, `RepairInstructionExecuted`                               |
| Compliance     | `KycVerified`, `AmlAlertCreated`, `RegulatorySubmissionSubmitted`                     |
| Notifications  | `NotificationCreated`, `NotificationSent`, `NotificationDelivered`                    |
| Chat           | `ChatMessageCreated`, `ChatMessageFlagged`                                            |
| Help           | `HelpArticlePublished`, `HelpArticleFeedbackSubmitted`                                |
| FAQ            | `FaqCreated`, `FaqImportCompleted`                                                    |
| Forum          | `ForumTopicCreated`, `ForumReplyCreated`, `ForumTopicSolved`                          |
| Referrals      | `ReferralUsed`, `ReferralCompleted`, `ReferralRewardIssued`                           |
| Risk/Fraud     | `RiskAssessmentCompleted`, `FraudAlertCreated`, `AnomalyDetected`                     |
| Administration | `AdminUserSuspended`, `AdminLoanApproved`                                             |
| Audit          | `AuditEventCreated`                                                                   |
| Workflow       | `WorkflowStarted`, `WorkflowCompleted`, `WorkflowDeadLettered`                        |
| Platform       | `ServiceReady`, `ServiceDegraded`, `DependencyUnavailable`                            |

---

# 35. Event Producer/Consumer Matrix

The following is the logical ownership model.

| Event                            | Primary Producer | Typical Consumers                     |
| -------------------------------- | ---------------- | ------------------------------------- |
| `UserRegistered`                 | Auth             | Notification, Referral, Onboarding    |
| `ContributionPosted`             | Savings/Finance  | Ledger, Reporting, Notification       |
| `LoanApplied`                    | Loan             | Risk, Notification, Audit             |
| `LoanApproved`                   | Loan             | Notification, Ledger workflow, Audit  |
| `LoanDisbursed`                  | Loan/Finance     | Notification, Reporting               |
| `LoanPaymentRecorded`            | Loan/Finance     | Ledger, Reporting, Notification       |
| `PaymentCompleted`               | Payment          | Finance, Reconciliation, Notification |
| `PaymentReversed`                | Payment/Finance  | Finance, Reconciliation               |
| `StatementProcessed`             | Statement        | Reconciliation                        |
| `ReconciliationExceptionCreated` | Reconciliation   | Repair, Operations                    |
| `KycVerified`                    | Compliance       | Onboarding, Risk                      |
| `NotificationCreated`            | Notification     | Delivery workers                      |
| `ForumTopicCreated`              | Forum            | Notifications, Analytics              |
| `ContentReported`                | Community        | Moderation                            |
| `ReferralCompleted`              | Referral         | Rewarding, Analytics                  |
| `FraudAlertCreated`              | Fraud            | Compliance, Risk, Operations          |

The exact consumer list may expand without changing the event producer contract.

---

# 36. Event Delivery Semantics

Default event delivery guarantee:

```text
AT_LEAST_ONCE
```

The platform must therefore support duplicate delivery.

Exactly-once business effects must be achieved through:

```text
idempotency
deduplication
transactional state checks
unique constraints
consumer checkpoints
```

---

# 37. Outbox Pattern

Critical events must use an outbox pattern when the business state change and event publication must be atomic.

Example:

```text
BEGIN TRANSACTION

Update Loan
Create Ledger Transaction
Insert Outbox Event

COMMIT
```

The outbox publisher then:

```text
reads pending event
claims event
publishes event
records publish state
```

This avoids the failure mode:

```text
Database updated
+
Event lost
```

---

# 38. Outbox States

Recommended states:

```text
pending
processing
published
failed
dead_letter
```

Additional timestamps:

```text
createdAt
claimedAt
publishedAt
nextAttemptAt
```

Additional metadata:

```text
attemptCount
workerId
lastError
```

---

# 39. Event Claiming

Concurrent workers must not process the same outbox record simultaneously.

Use:

```text
lease
claim token
optimistic locking
database row lock
atomic update
```

depending on the persistence implementation.

A claim must have an expiration/recovery mechanism.

---

# 40. Retry Policy

Retryable failures should use bounded exponential backoff.

Example conceptual schedule:

```text
attempt 1 -> immediate
attempt 2 -> short delay
attempt 3 -> increasing delay
attempt 4 -> increasing delay
...
dead-letter after maximum attempts
```

Retry policy should be configurable by event category.

Permanent failures should not be retried indefinitely.

---

# 41. Dead-Letter Queue

Events that cannot be successfully processed after the configured retry policy should enter:

```text
dead_letter
```

A dead-letter record must retain:

```text
eventId
eventType
consumer
attemptCount
lastError
failedAt
tenantId
aggregateId
```

Dead-letter processing must be controlled and audited.

---

# 42. Event Replay

The platform must support replay where practical.

Replay may be required for:

```text
new consumer deployment
bug recovery
projection rebuild
analytics backfill
notification recovery
integration repair
```

Replay must not automatically repeat irreversible financial side effects.

A replayed financial event should be interpreted according to consumer idempotency rules.

---

# 43. Replay Modes

Recommended modes:

```text
PROJECTION_REBUILD
ANALYTICS_REPLAY
NOTIFICATION_REPLAY
INTEGRATION_REPLAY
REPAIR_REPLAY
```

Avoid a generic:

```text
REPLAY_EVERYTHING
```

mode for production.

---

# 44. Consumer Idempotency

Every consumer must define a deterministic deduplication strategy.

Example:

```text
consumerId + eventId
```

or:

```text
consumerId + aggregateId + aggregateVersion
```

The consumer must persist its processing state where duplicate delivery can create side effects.

---

# 45. Ordering

Events are not guaranteed to be globally ordered.

Where ordering matters, consumers should use:

```text
aggregateId
aggregateVersion
sequenceNumber
```

Example:

```text
LoanApproved
aggregateVersion = 5

LoanDisbursed
aggregateVersion = 6
```

A consumer can reject/defer an event if its predecessor version has not been observed.

---

# 46. Duplicate Event Protection

Duplicate detection should use:

```text
eventId
providerEventId
idempotencyKey
aggregateVersion
```

depending on event type.

Provider callbacks require separate provider-specific duplicate detection.

---

# 47. Event Correlation

A single business operation should maintain correlation.

Example:

```text
HTTP Request
   |
   v
Loan Application
   |
   v
LoanApplied
   |
   +--> RiskAssessmentCompleted
   |
   +--> NotificationCreated
```

All related events should preserve:

```text
correlationId
```

Causation should show direct parentage:

```text
LoanApproved
causationId = LoanApplied eventId
```

where appropriate.

---

# 48. Event Security

Events must be treated as controlled internal data.

Never include:

```text
passwords
refresh tokens
API keys
private keys
provider secrets
raw authentication headers
full KYC documents
unnecessary AML case details
```

Events containing sensitive information require restricted consumer access.

---

# 49. Event Privacy

Payloads should follow data minimization.

Instead of sending:

```json
{
  "user": {
    "name": "...",
    "email": "...",
    "phone": "...",
    "address": "...",
    "nationalId": "..."
  }
}
```

prefer:

```json
{
  "userId": "user_01J..."
}
```

Consumers can obtain additional authorized information through their own domain/API where appropriate.

---

# 50. Financial Event Rules

The following events must be emitted only after the authoritative financial operation reaches the corresponding state:

```text
ContributionPosted
LoanDisbursed
LoanPaymentRecorded
PaymentCompleted
PaymentReversed
FinancialTransactionPosted
JournalPosted
TransactionReversed
WriteOffPosted
```

Do not emit a completed financial event before the ledger/finance operation is actually committed.

---

# 51. Event Failure Semantics

An event processing failure must not corrupt the source transaction.

For example:

```text
Loan disbursement committed
      |
      v
LoanDisbursed outbox record
      |
      v
Notification consumer fails
```

The notification failure must not roll back the already committed financial transaction.

Instead:

```text
retry
dead-letter
alert
manual recovery
```

---

# 52. Event Schema Versioning

Every event must carry:

```text
eventVersion
eventSchema
```

Example:

```text
titech.loan.disbursed.v1
```

Breaking payload changes require a new schema version.

Example:

```text
titech.loan.disbursed.v2
```

Non-breaking additions may remain within the same version if consumers can safely ignore unknown fields.

---

# 53. Event Compatibility

Consumers should follow tolerant-reader principles.

Consumers should:

```text
ignore unknown fields
handle missing optional fields
validate required fields
reject incompatible schema versions
```

Producers must not silently remove fields still required by supported consumers.

---

# 54. Event Payload Standards

Use:

```text
camelCase
ISO-8601 timestamps
UTC
exact monetary representation
stable identifiers
explicit enums
```

Example:

```json
{
  "amount": "30000.00",
  "currency": "UGX",
  "occurredAt": "2026-08-16T00:00:00.000Z"
}
```

---

# 55. Event Storage

Persist events when replay, audit, operational recovery, or integration guarantees require them.

Minimum persisted metadata:

```text
eventId
eventType
eventVersion
tenantId
aggregateType
aggregateId
correlationId
causationId
producer
payload
status
attemptCount
createdAt
publishedAt
```

Event retention should follow domain-specific policy.

---

# 56. Event Observability

Recommended metrics:

```text
events_published_total
events_consumed_total
events_failed_total
events_retried_total
events_dead_lettered_total
events_replayed_total
event_processing_duration_seconds
event_lag_seconds
event_duplicate_total
outbox_pending_total
outbox_oldest_pending_age_seconds
```

---

# 57. Event Logging

Structured event logs should include:

```text
eventId
eventType
consumer
tenantId
aggregateType
aggregateId
correlationId
causationId
attempt
status
durationMs
errorCode
```

Payloads must be redacted where sensitive.

---

# 58. Event Tracing

OpenTelemetry-compatible event processing should propagate:

```text
traceId
spanId
correlationId
causationId
requestId
```

Recommended spans:

```text
event.publish
event.consume
event.process
event.retry
event.dead_letter
```

Do not put secrets into tracing attributes.

---

# 59. Event Monitoring & Alerts

Alert on:

```text
high outbox backlog
stale events
dead-letter growth
consumer failure spikes
repeated event retries
processing latency spikes
duplicate-event spikes
provider callback failure spikes
financial-event processing failures
```

Critical financial event failures should have higher severity.

---

# 60. Event Health Checks

Operational health should distinguish:

```text
service alive
service ready
event infrastructure ready
event consumers healthy
outbox healthy
dead-letter backlog
```

A healthy HTTP process does not imply healthy event processing.

---

# 61. Event Governance

Every event must have:

```text
owner
producer
consumer classification
schema
version
sensitivity
tenant scope
delivery guarantee
retry policy
retention
replay policy
```

New production events should not be introduced without documentation.

---

# 62. Event Ownership Matrix

| Event Domain   | Primary Owner              |
| -------------- | -------------------------- |
| Identity       | Authentication/User domain |
| Tenant         | SaaS/Tenant domain         |
| Groups         | Group domain               |
| Membership     | Membership domain          |
| Savings        | Savings/Finance            |
| Loans          | Loan domain                |
| Finance        | Finance/Ledger             |
| Payments       | Payment domain             |
| Callbacks      | Payment integration        |
| Statements     | Statement domain           |
| Reconciliation | Finance/Reconciliation     |
| Compliance     | Compliance                 |
| Notifications  | Notification domain        |
| Chat           | Communication domain       |
| Help           | Help Center                |
| FAQ            | FAQ domain                 |
| Forum          | Community domain           |
| Referrals      | Referral domain            |
| Risk/Fraud     | Risk/Fraud                 |
| Administration | Administration             |
| Audit          | Audit/Security             |
| Workflow       | Workflow engine            |
| Platform       | Infrastructure/Platform    |

---

# 63. Critical Event Chains

## User Onboarding

```text
UserRegistered
      |
      +--> UserVerified
      |
      +--> ReferralUsed
      |
      +--> KycCaseCreated
      |
      +--> KycVerified
```

---

## Contribution

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
ContributionPosted
```

---

## Loan Lifecycle

```text
LoanEligibilityEvaluated
      |
      v
LoanApplied
      |
      v
LoanReviewStarted
      |
      +--> LoanRejected
      |
      +--> LoanApproved
                 |
                 v
        LoanDisbursementInitiated
                 |
                 v
            PaymentCompleted
                 |
                 v
            LoanDisbursed
                 |
                 v
            LoanActivated
                 |
                 v
         LoanPaymentRecorded
                 |
       +---------+---------+
       |                   |
       v                   v
LoanDelinquent       LoanCompleted
       |
       v
LoanDefaulted
       |
       v
LoanWrittenOff
```

---

## Payment Callback

```text
ProviderCallbackReceived
        |
        v
ProviderCallbackValidated
        |
        +--> ProviderCallbackDuplicate
        |
        v
PaymentProcessing
        |
        +--> PaymentCompleted
        |
        +--> PaymentFailed
```

---

## Statement

```text
StatementReceived
      |
      v
StatementValidated
      |
      v
StatementClaimed
      |
      v
StatementProcessingStarted
      |
      +--> StatementProcessingCompleted
      |
      +--> StatementProcessingFailed
```

---

## Reconciliation

```text
ReconciliationStarted
      |
      +--> ReconciliationMatchCreated
      |
      +--> ReconciliationExceptionCreated
                         |
                         v
              RepairInstructionCreated
                         |
                         v
              RepairInstructionApproved
                         |
                         v
              RepairInstructionExecuted
                         |
                         v
              ReconciliationExceptionResolved
      |
      v
ReconciliationCompleted
```

---

# 64. Event Anti-Patterns

The following are prohibited:

```text
Using events as a replacement for the ledger
Publishing secrets
Publishing unnecessary PII
Using command names as events
Mutating published events
Ignoring duplicate delivery
Assuming global ordering
Retrying permanently failed events forever
Performing irreversible financial effects during unsafe replay
Publishing before transaction commit
Skipping tenant context
Using arbitrary event payload structures
Creating undocumented event types
```

---

# 65. Event Testing Requirements

## Unit Tests

Test:

```text
event construction
schema validation
required fields
version handling
mapping logic
```

## Integration Tests

Test:

```text
outbox creation
publication
consumer processing
retry
duplicate delivery
dead-letter
replay
ordering
tenant propagation
trace propagation
```

## Financial Tests

Test:

```text
financial state committed before completion event
no duplicate posting
reversal events
ledger traceability
idempotent consumers
```

## Failure Tests

Simulate:

```text
database outage
broker outage
consumer crash
network timeout
duplicate event
out-of-order event
poison message
schema mismatch
dead-letter recovery
```

---

# 66. Event Production Checklist

Before publishing a new event:

* [ ] Event name uses past-tense fact terminology.
* [ ] Owner defined.
* [ ] Producer defined.
* [ ] Consumer impact identified.
* [ ] Tenant scope defined.
* [ ] Schema defined.
* [ ] Version assigned.
* [ ] Sensitive data reviewed.
* [ ] Idempotency strategy defined.
* [ ] Ordering requirements defined.
* [ ] Retry policy defined.
* [ ] Dead-letter policy defined.
* [ ] Retention policy defined.
* [ ] Replay policy defined.
* [ ] Metrics defined.
* [ ] Audit implications reviewed.
* [ ] Automated tests added.
* [ ] This catalogue updated.

---

# 67. Event Consumer Checklist

Every consumer should:

* [ ] Validate event schema.
* [ ] Verify tenant scope.
* [ ] Verify required event version.
* [ ] Check duplicate processing.
* [ ] Check aggregate version where required.
* [ ] Apply business rules.
* [ ] Record processing outcome.
* [ ] Retry transient errors.
* [ ] Dead-letter permanent failures.
* [ ] Emit relevant metrics.
* [ ] Propagate tracing context.
* [ ] Avoid secret logging.
* [ ] Remain safe under replay.

---

# 68. Event Security Model

Event access should follow least privilege.

Consumers should subscribe only to events required for their responsibilities.

Example:

```text
NotificationService
  -> may consume LoanApproved

AnalyticsService
  -> may consume LoanCompleted

General reporting
  -> should not automatically receive sensitive AML events
```

Highly restricted event streams must be separately authorized.

---

# 69. Event Retention

Suggested baseline categories:

| Event Class       | Retention Strategy                      |
| ----------------- | --------------------------------------- |
| Financial         | Long-term according to financial policy |
| Audit             | According to security/compliance policy |
| Compliance        | According to regulatory policy          |
| Provider Callback | Integration-specific retention          |
| Workflow          | Operational retention                   |
| Analytics         | Analytics retention policy              |
| Notification      | Operational retention                   |
| Community         | Product/content retention               |

Retention policies must be centrally governed.

---

# 70. Event Data Migration

Event schemas must not be modified retroactively.

If historical events need transformation:

```text
Read v1
   |
   v
Transform
   |
   v
Produce v2 projection
```

Do not rewrite historical event facts.

---

# 71. Event Disaster Recovery

The event platform must support recovery from:

```text
broker outage
worker failure
database outage
network partition
process crash
deployment rollback
```

Recovery procedures must preserve:

```text
eventId
ordering requirements
idempotency
tenant scope
financial state integrity
auditability
```

---

# 72. Event Contract Registry

The platform should maintain a registry/catalogue containing:

```text
eventType
schema
version
owner
producer
consumers
sensitivity
tenant scope
status
createdAt
deprecatedAt
replacement
```

Example:

| Event                     | Version | Status | Owner           |
| ------------------------- | ------: | ------ | --------------- |
| `LoanApplied`             |       1 | Active | Loan            |
| `LoanApproved`            |       1 | Active | Loan            |
| `LoanDisbursed`           |       1 | Active | Loan/Finance    |
| `PaymentCompleted`        |       1 | Active | Payment         |
| `PaymentReversed`         |       1 | Active | Payment/Finance |
| `StatementProcessed`      |       1 | Active | Statements      |
| `ReconciliationCompleted` |       1 | Active | Reconciliation  |

---

# 73. Event Status Lifecycle

An event itself may have:

```text
created
pending
processing
published
consumed
failed
dead_letter
replayed
```

These processing statuses must not be confused with the business state represented by the event.

For example:

```text
PaymentCompleted
```

is a business fact.

```text
published
```

is transport/processing state.

---

# 74. Event Ownership and Source Boundaries

A service must not emit an event claiming a state that another service owns unless that service has authoritative confirmation.

Example:

```text
PaymentService
```

may publish:

```text
PaymentCompleted
```

after provider confirmation and payment-state commitment.

It should not publish:

```text
LoanDisbursed
```

unless the loan/finance domain has actually committed that business state.

This prevents contradictory event streams.

---

# 75. Financial Event Source-of-Truth Rule

The following hierarchy is mandatory:

```text
Financial Ledger
      >
Financial Transaction
      >
Payment/Loan business state
      >
Domain events
      >
Projections / dashboards
```

Events communicate financial facts.

They do not replace the ledger.

---

# 76. Event Catalogue Governance Rules

Any event addition, modification, removal, or version change must trigger review of:

```text
API catalogue
Service catalogue
Dependency map
Data model catalogue
Event consumers
Observability
Security
Compliance
Testing
Deployment/migration strategy
```

---

# 77. Production Readiness Criteria

The event platform is considered enterprise production-ready only when:

```text
All critical events use durable publication.
All critical events have unique event IDs.
All tenant events carry tenant context.
All consumers are idempotent.
Financial events are emitted after authoritative commit.
Retry policies are bounded.
Dead-letter handling exists.
Replay is controlled.
Schema versions are explicit.
Sensitive data is minimized.
Audit requirements are defined.
Metrics and tracing are implemented.
Outbox processing is monitored.
Consumer lag is monitored.
Concurrency controls are implemented.
Event ownership is documented.
Event contracts are tested.
```

---

# 78. Final Event Catalogue Index

## Identity

```text
UserRegistered
UserVerified
UserSuspended
UserReactivated
UserDeactivated
```

## Tenant/SaaS

```text
TenantCreated
TenantActivated
TenantSuspended
TenantTerminated
SubscriptionActivated
SubscriptionChanged
SubscriptionSuspended
SubscriptionCancelled
```

## Groups/Membership

```text
GroupCreated
GroupActivated
GroupSuspended
GroupClosed
MemberAdded
MemberActivated
MemberSuspended
MemberRemoved
MemberRoleChanged
```

## Savings

```text
ContributionInitiated
ContributionPosted
ContributionFailed
ContributionReversed
```

## Loans

```text
LoanEligibilityEvaluated
LoanApplied
LoanReviewStarted
LoanApproved
LoanRejected
LoanDisbursementInitiated
LoanDisbursed
LoanActivated
LoanPaymentRecorded
LoanDelinquent
LoanDefaulted
LoanCompleted
LoanWrittenOff
LoanReversed
```

## Finance

```text
FinancialTransactionInitiated
FinancialTransactionPosted
TransactionFailed
TransactionReversed
JournalPosted
JournalReversed
FinancialPeriodClosed
FinancialPeriodReopened
InterestAccrued
WriteOffPosted
```

## Payments

```text
PaymentInitiated
PaymentProcessing
PaymentCompleted
PaymentFailed
PaymentCancelled
PaymentReversed
```

## Provider Callbacks

```text
ProviderCallbackReceived
ProviderCallbackValidated
ProviderCallbackDuplicate
ProviderCallbackProcessingFailed
ProviderCallbackDeadLettered
```

## Statements

```text
StatementReceived
StatementValidated
StatementClaimed
StatementProcessingStarted
StatementProcessingCompleted
StatementProcessingFailed
StatementBatchReleased
```

## Reconciliation/Repair

```text
ReconciliationStarted
ReconciliationMatchCreated
ReconciliationExceptionCreated
ReconciliationExceptionAssigned
ReconciliationExceptionResolved
ReconciliationCompleted
RepairInstructionCreated
RepairInstructionApproved
RepairInstructionExecuted
RepairInstructionFailed
```

## Compliance

```text
KycCaseCreated
KycVerificationStarted
KycVerified
KycRejected
AmlAlertCreated
AmlCaseEscalated
AmlCaseCleared
RegulatorySubmissionCreated
RegulatorySubmissionSubmitted
RegulatorySubmissionAcknowledged
RegulatorySubmissionRejected
```

## Notifications/Chat

```text
NotificationCreated
NotificationQueued
NotificationSent
NotificationDelivered
NotificationFailed
NotificationRead
ChatMessageCreated
ChatMessageRead
ChatMessageFlagged
ChatMessageHidden
ChatMessageDeleted
```

## Help/FAQ

```text
HelpArticleCreated
HelpArticleUpdated
HelpArticlePublished
HelpArticleArchived
HelpArticleDeleted
HelpArticleFeedbackSubmitted
FaqCreated
FaqUpdated
FaqPublished
FaqArchived
FaqDeleted
FaqImportStarted
FaqImportCompleted
FaqImportFailed
```

## Forum

```text
ForumTopicCreated
ForumTopicUpdated
ForumTopicDeleted
ForumReplyCreated
ForumReplyUpdated
ForumReplyDeleted
ForumReplyVoted
ForumTopicSolved
ForumTopicReopened
ForumTopicLocked
ForumTopicUnlocked
ForumTopicFollowed
ForumTopicUnfollowed
ContentReported
ContentModerationCompleted
```

## Referrals

```text
ReferralCodeGenerated
ReferralUsed
ReferralQualified
ReferralCompleted
ReferralRewardIssued
```

## Risk/Fraud

```text
RiskAssessmentCompleted
RiskLevelChanged
FraudAlertCreated
FraudAlertEscalated
FraudAlertResolved
AnomalyDetected
```

## Administration/Audit

```text
AdminUserVerified
AdminUserSuspended
AdminLoanApproved
AdminLoanRejected
AdminContentModerated
AuditEventCreated
```

## Workflow/Platform

```text
WorkflowStarted
WorkflowStepStarted
WorkflowStepCompleted
WorkflowStepFailed
WorkflowRetryScheduled
WorkflowCompleted
WorkflowFailed
WorkflowDeadLettered
ServiceStarted
ServiceReady
ServiceDegraded
ServiceRecovered
DependencyUnavailable
```

---

# 79. Document Metadata

**Document:** `docs/events/EVENT_CATALOGUE.md`
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

## Maintenance Rule

> Every production event added, removed, renamed, versioned, republished, deprecated, or materially modified must be reflected in this catalogue and in the corresponding service, data-model, API, security, observability, and workflow documentation.

## Non-Negotiable Event Rules

```text
1. Events are immutable facts.
2. Events are not commands.
3. Financial events never replace the ledger.
4. Critical events are emitted only after authoritative state commits.
5. Consumers must be idempotent.
6. Tenant context must be preserved.
7. Event schemas must be versioned.
8. Sensitive information must be minimized.
9. Retry behavior must be bounded.
10. Dead-letter handling must be operationally supported.
11. Replay must be controlled.
12. Event ownership must be explicit.
13. Published events must never be silently rewritten.
14. Every critical event must be observable and auditable.
```