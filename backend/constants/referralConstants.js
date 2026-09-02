"use strict";

/**
 * =============================================================================
 * TITech Community Capital
 * Enterprise Referral Domain Constants
 * =============================================================================
 *
 * File:
 *   backend/constants/referralConstants.js
 *
 * Purpose:
 *   Canonical, immutable constants for the TITech referral domain.
 *
 * Architectural Scope:
 *
 *   Referral
 *      │
 *      ├── Referral lifecycle
 *      ├── Qualification
 *      ├── Reward eligibility
 *      ├── Reward issuance
 *      ├── Fraud / risk review
 *      ├── Attribution
 *      ├── Referral limits
 *      └── Audit / event semantics
 *             │
 *             ▼
 *      ReferralReward / Reward Outbox
 *
 * DESIGN PRINCIPLES
 * -----------------------------------------------------------------------------
 * 1. Constants are immutable.
 * 2. No tenant-specific business configuration belongs here.
 * 3. No financial balances belong here.
 * 4. No secrets belong here.
 * 5. Status values are explicit and finite.
 * 6. Event names are stable integration contracts.
 * 7. Public/API-facing values are centralized.
 * 8. Internal workflow values are centralized.
 * 9. Reward values are policy-driven, not hard-coded here.
 * 10. All terminology uses TITech consistently.
 *
 * IMPORTANT
 * -----------------------------------------------------------------------------
 * These constants do NOT replace:
 *
 * - Authorization
 * - Tenant isolation
 * - Referral eligibility rules
 * - Fraud detection
 * - Financial ledger validation
 * - Reward calculation
 * - Idempotency
 * - Transaction management
 * - Database constraints
 *
 * Those responsibilities belong to the appropriate domain/service layers.
 *
 * =============================================================================
 */


/**
 * =============================================================================
 * DOMAIN IDENTIFICATION
 * =============================================================================
 */

const REFERRAL_DOMAIN = "referral";

const REFERRAL_SYSTEM = "titech-community-capital";

const REFERRAL_VERSION = "1.0.0";


/**
 * =============================================================================
 * REFERRAL STATUS
 * =============================================================================
 *
 * Lifecycle:
 *
 *   PENDING
 *      ↓
 *   QUALIFIED
 *      ↓
 *   COMPLETED
 *      ↓
 *   REWARD_PENDING
 *      ↓
 *   REWARDED
 *
 * Exceptional states:
 *
 *   CANCELLED
 *   REJECTED
 *   FRAUD_REVIEW
 *
 * IMPORTANT:
 * -----------------------------------------------------------------------------
 * Status transitions must be enforced by ReferralService/domain logic.
 * Controllers and clients must never be allowed to perform arbitrary
 * state transitions.
 * =============================================================================
 */

const REFERRAL_STATUS = Object.freeze({
  PENDING: "pending",
  QUALIFIED: "qualified",
  COMPLETED: "completed",
  REWARD_PENDING: "reward_pending",
  REWARDED: "rewarded",
  CANCELLED: "cancelled",
  REJECTED: "rejected",
  FRAUD_REVIEW: "fraud_review",
});


const REFERRAL_STATUSES = Object.freeze(
  Object.values(REFERRAL_STATUS)
);


/**
 * =============================================================================
 * TERMINAL REFERRAL STATES
 * =============================================================================
 */

const REFERRAL_TERMINAL_STATUSES = Object.freeze([
  REFERRAL_STATUS.REWARDED,
  REFERRAL_STATUS.CANCELLED,
  REFERRAL_STATUS.REJECTED,
]);


/**
 * =============================================================================
 * ACTIVE REFERRAL STATES
 * ============================================================================= */

const REFERRAL_ACTIVE_STATUSES = Object.freeze([
  REFERRAL_STATUS.PENDING,
  REFERRAL_STATUS.QUALIFIED,
  REFERRAL_STATUS.COMPLETED,
  REFERRAL_STATUS.REWARD_PENDING,
  REFERRAL_STATUS.FRAUD_REVIEW,
]);


/**
 * =============================================================================
 * REFERRAL STATUS TRANSITIONS
 * =============================================================================
 *
 * Explicit transition map.
 *
 * This is intentionally centralized so ReferralService can enforce a
 * deterministic state machine instead of allowing arbitrary status updates.
 * =============================================================================
 */

const REFERRAL_STATUS_TRANSITIONS = Object.freeze({
  [REFERRAL_STATUS.PENDING]: Object.freeze([
    REFERRAL_STATUS.QUALIFIED,
    REFERRAL_STATUS.REJECTED,
    REFERRAL_STATUS.CANCELLED,
    REFERRAL_STATUS.FRAUD_REVIEW,
  ]),

  [REFERRAL_STATUS.QUALIFIED]: Object.freeze([
    REFERRAL_STATUS.COMPLETED,
    REFERRAL_STATUS.REJECTED,
    REFERRAL_STATUS.CANCELLED,
    REFERRAL_STATUS.FRAUD_REVIEW,
  ]),

  [REFERRAL_STATUS.COMPLETED]: Object.freeze([
    REFERRAL_STATUS.REWARD_PENDING,
    REFERRAL_STATUS.REJECTED,
    REFERRAL_STATUS.FRAUD_REVIEW,
  ]),

  [REFERRAL_STATUS.REWARD_PENDING]: Object.freeze([
    REFERRAL_STATUS.REWARDED,
    REFERRAL_STATUS.FRAUD_REVIEW,
  ]),

  [REFERRAL_STATUS.FRAUD_REVIEW]: Object.freeze([
    REFERRAL_STATUS.PENDING,
    REFERRAL_STATUS.QUALIFIED,
    REFERRAL_STATUS.COMPLETED,
    REFERRAL_STATUS.REWARD_PENDING,
    REFERRAL_STATUS.REWARDED,
    REFERRAL_STATUS.REJECTED,
    REFERRAL_STATUS.CANCELLED,
  ]),

  [REFERRAL_STATUS.REWARDED]: Object.freeze([]),

  [REFERRAL_STATUS.CANCELLED]: Object.freeze([]),

  [REFERRAL_STATUS.REJECTED]: Object.freeze([]),
});


/**
 * =============================================================================
 * REFERRAL TYPE
 * =============================================================================
 *
 * Referral types identify how attribution originated.
 * =============================================================================
 */

const REFERRAL_TYPE = Object.freeze({
  CODE: "code",
  LINK: "link",
  INVITATION: "invitation",
  CAMPAIGN: "campaign",
  ADMIN: "admin",
  SYSTEM: "system",
});


const REFERRAL_TYPES = Object.freeze(
  Object.values(REFERRAL_TYPE)
);


/**
 * =============================================================================
 * REFERRAL SOURCE
 * =============================================================================
 *
 * High-level attribution channels.
 * =============================================================================
 */

const REFERRAL_SOURCE = Object.freeze({
  WEB: "web",
  MOBILE_APP: "mobile_app",
  ANDROID: "android",
  IOS: "ios",
  USSD: "ussd",
  SMS: "sms",
  EMAIL: "email",
  WHATSAPP: "whatsapp",
  SOCIAL: "social",
  API: "api",
  ADMIN: "admin",
  SYSTEM: "system",
  UNKNOWN: "unknown",
});


const REFERRAL_SOURCES = Object.freeze(
  Object.values(REFERRAL_SOURCE)
);


/**
 * =============================================================================
 * ATTRIBUTION METHODS
 * =============================================================================
 */

const REFERRAL_ATTRIBUTION_METHOD = Object.freeze({
  CODE: "code",
  LINK: "link",
  INVITATION: "invitation",
  CAMPAIGN: "campaign",
  MANUAL: "manual",
  SYSTEM: "system",
});


const REFERRAL_ATTRIBUTION_METHODS = Object.freeze(
  Object.values(REFERRAL_ATTRIBUTION_METHOD)
);


/**
 * =============================================================================
 * REWARD TYPES
 * =============================================================================
 *
 * These are reward categories, NOT reward amounts.
 *
 * Actual reward amounts must be calculated by the reward policy/service layer.
 * =============================================================================
 */

const REFERRAL_REWARD_TYPE = Object.freeze({
  CASHBACK: "cashback",
  SAVINGS_BONUS: "savings_bonus",
  LOAN_DISCOUNT: "loan_discount",
});


const REFERRAL_REWARD_TYPES = Object.freeze(
  Object.values(REFERRAL_REWARD_TYPE)
);


/**
 * =============================================================================
 * REWARD STATUS
 * =============================================================================
 *
 * Referral reward lifecycle.
 *
 * This is intentionally separate from Referral status.
 * =============================================================================
 */

const REFERRAL_REWARD_STATUS = Object.freeze({
  PENDING: "pending",
  ELIGIBLE: "eligible",
  PROCESSING: "processing",
  ISSUED: "issued",
  FAILED: "failed",
  RETRYING: "retrying",
  CANCELLED: "cancelled",
  REVERSED: "reversed",
  FRAUD_REVIEW: "fraud_review",
});


const REFERRAL_REWARD_STATUSES = Object.freeze(
  Object.values(REFERRAL_REWARD_STATUS)
);


/**
 * =============================================================================
 * REWARD STATUS TRANSITIONS
 * =============================================================================
 */

const REFERRAL_REWARD_STATUS_TRANSITIONS = Object.freeze({
  [REFERRAL_REWARD_STATUS.PENDING]: Object.freeze([
    REFERRAL_REWARD_STATUS.ELIGIBLE,
    REFERRAL_REWARD_STATUS.CANCELLED,
    REFERRAL_REWARD_STATUS.FRAUD_REVIEW,
  ]),

  [REFERRAL_REWARD_STATUS.ELIGIBLE]: Object.freeze([
    REFERRAL_REWARD_STATUS.PROCESSING,
    REFERRAL_REWARD_STATUS.CANCELLED,
    REFERRAL_REWARD_STATUS.FRAUD_REVIEW,
  ]),

  [REFERRAL_REWARD_STATUS.PROCESSING]: Object.freeze([
    REFERRAL_REWARD_STATUS.ISSUED,
    REFERRAL_REWARD_STATUS.FAILED,
    REFERRAL_REWARD_STATUS.RETRYING,
    REFERRAL_REWARD_STATUS.FRAUD_REVIEW,
  ]),

  [REFERRAL_REWARD_STATUS.RETRYING]: Object.freeze([
    REFERRAL_REWARD_STATUS.PROCESSING,
    REFERRAL_REWARD_STATUS.FAILED,
    REFERRAL_REWARD_STATUS.CANCELLED,
  ]),

  [REFERRAL_REWARD_STATUS.ISSUED]: Object.freeze([
    REFERRAL_REWARD_STATUS.REVERSED,
  ]),

  [REFERRAL_REWARD_STATUS.FAILED]: Object.freeze([
    REFERRAL_REWARD_STATUS.RETRYING,
    REFERRAL_REWARD_STATUS.CANCELLED,
  ]),

  [REFERRAL_REWARD_STATUS.CANCELLED]: Object.freeze([]),

  [REFERRAL_REWARD_STATUS.REVERSED]: Object.freeze([]),

  [REFERRAL_REWARD_STATUS.FRAUD_REVIEW]: Object.freeze([
    REFERRAL_REWARD_STATUS.PENDING,
    REFERRAL_REWARD_STATUS.ELIGIBLE,
    REFERRAL_REWARD_STATUS.CANCELLED,
  ]),
});


/**
 * =============================================================================
 * REWARD CURRENCIES
 * =============================================================================
 *
 * These represent supported referral reward currencies.
 *
 * IMPORTANT:
 * -----------------------------------------------------------------------------
 * Currency availability must still be validated against tenant/account
 * configuration and the financial ledger.
 * =============================================================================
 */

const REFERRAL_REWARD_CURRENCY = Object.freeze({
  UGX: "UGX",
  KES: "KES",
  TZS: "TZS",
  RWF: "RWF",
  ETB: "ETB",
  NGN: "NGN",
  USD: "USD",
});


const REFERRAL_REWARD_CURRENCIES = Object.freeze(
  Object.values(REFERRAL_REWARD_CURRENCY)
);


/**
 * =============================================================================
 * QUALIFICATION EVENTS
 * =============================================================================
 *
 * Events that may cause a referral to become eligible for qualification.
 *
 * These values are domain event identifiers and should remain stable once
 * consumed by queues, analytics, or integrations.
 * =============================================================================
 */

const REFERRAL_QUALIFICATION_EVENT = Object.freeze({
  USER_REGISTERED: "user.registered",
  USER_VERIFIED: "user.verified",
  KYC_COMPLETED: "user.kyc_completed",
  MEMBERSHIP_ACTIVATED: "membership.activated",
  FIRST_DEPOSIT_COMPLETED: "savings.first_deposit_completed",
  FIRST_CONTRIBUTION_COMPLETED: "savings.first_contribution_completed",
  FIRST_TRANSACTION_COMPLETED: "transaction.first_completed",
  LOAN_DISBURSED: "loan.disbursed",
});


const REFERRAL_QUALIFICATION_EVENTS = Object.freeze(
  Object.values(REFERRAL_QUALIFICATION_EVENT)
);


/**
 * =============================================================================
 * REFERRAL DOMAIN EVENTS
 * =============================================================================
 *
 * These events are suitable for:
 *
 * - Audit logs
 * - Event bus
 * - Queue workers
 * - Notifications
 * - Analytics
 * - Reward processing
 *
 * Do not casually rename these once external consumers depend on them.
 * =============================================================================
 */

const REFERRAL_EVENT = Object.freeze({
  CREATED: "referral.created",
  ATTRIBUTED: "referral.attributed",
  APPLIED: "referral.applied",

  QUALIFICATION_STARTED: "referral.qualification_started",
  QUALIFIED: "referral.qualified",

  COMPLETED: "referral.completed",

  REWARD_ELIGIBLE: "referral.reward_eligible",
  REWARD_PENDING: "referral.reward_pending",
  REWARD_PROCESSING: "referral.reward_processing",
  REWARD_ISSUED: "referral.reward_issued",
  REWARD_FAILED: "referral.reward_failed",
  REWARD_REVERSED: "referral.reward_reversed",

  CANCELLED: "referral.cancelled",
  REJECTED: "referral.rejected",

  FRAUD_REVIEW_STARTED: "referral.fraud_review_started",
  FRAUD_REVIEW_CLEARED: "referral.fraud_review_cleared",
  FRAUD_CONFIRMED: "referral.fraud_confirmed",

  EXPIRED: "referral.expired",
});


const REFERRAL_EVENTS = Object.freeze(
  Object.values(REFERRAL_EVENT)
);


/**
 * =============================================================================
 * REWARD EVENTS
 * =============================================================================
 */

const REFERRAL_REWARD_EVENT = Object.freeze({
  CREATED: "referral_reward.created",
  ELIGIBLE: "referral_reward.eligible",
  PROCESSING: "referral_reward.processing",
  ISSUED: "referral_reward.issued",
  FAILED: "referral_reward.failed",
  RETRY_SCHEDULED: "referral_reward.retry_scheduled",
  CANCELLED: "referral_reward.cancelled",
  REVERSED: "referral_reward.reversed",
});


const REFERRAL_REWARD_EVENTS = Object.freeze(
  Object.values(REFERRAL_REWARD_EVENT)
);


/**
 * =============================================================================
 * FRAUD / RISK STATUS
 * =============================================================================
 */

const REFERRAL_RISK_STATUS = Object.freeze({
  NOT_REVIEWED: "not_reviewed",
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
  REVIEW: "review",
  BLOCKED: "blocked",
  CLEARED: "cleared",
});


const REFERRAL_RISK_STATUSES = Object.freeze(
  Object.values(REFERRAL_RISK_STATUS)
);


/**
 * =============================================================================
 * FRAUD / RISK REASONS
 * ============================================================================= */

const REFERRAL_RISK_REASON = Object.freeze({
  SELF_REFERRAL: "self_referral",
  DUPLICATE_REFERRAL: "duplicate_referral",
  DUPLICATE_DEVICE: "duplicate_device",
  DUPLICATE_PHONE: "duplicate_phone",
  DUPLICATE_EMAIL: "duplicate_email",
  SUSPICIOUS_IP: "suspicious_ip",
  VELOCITY_EXCEEDED: "velocity_exceeded",
  RAPID_ACCOUNT_CREATION: "rapid_account_creation",
  MULTIPLE_ACCOUNTS: "multiple_accounts",
  SHARED_DEVICE: "shared_device",
  SHARED_PAYMENT_IDENTIFIER: "shared_payment_identifier",
  CHARGEBACK: "chargeback",
  REVERSED_TRANSACTION: "reversed_transaction",
  KYC_FAILURE: "kyc_failure",
  AML_ALERT: "aml_alert",
  ACCOUNT_RESTRICTED: "account_restricted",
  POLICY_VIOLATION: "policy_violation",
  MANUAL_REVIEW: "manual_review",
});


const REFERRAL_RISK_REASONS = Object.freeze(
  Object.values(REFERRAL_RISK_REASON)
);


/**
 * =============================================================================
 * REFERRAL EXPIRY
 * =============================================================================
 *
 * These are safe default policy constants.
 *
 * Tenant-specific overrides should live in configuration/database policy,
 * NOT be mutated here.
 * =============================================================================
 */

const REFERRAL_DEFAULT_EXPIRY_DAYS = 30;


/**
 * =============================================================================
 * REFERRAL CODE POLICY
 * =============================================================================
 */

const REFERRAL_CODE = Object.freeze({
  MIN_LENGTH: 4,
  MAX_LENGTH: 64,

  /**
   * Uppercase alphanumeric plus underscore/hyphen.
   *
   * Canonical representation:
   *   TITECH-AB123
   */
  PATTERN: /^[A-Z0-9][A-Z0-9_-]{3,63}$/,

  /**
   * Canonicalization policy.
   */
  NORMALIZATION: "uppercase",

  /**
   * Codes are case-insensitive at the API boundary.
   */
  CASE_SENSITIVE: false,
});


/**
 * =============================================================================
 * REFERRAL LIMITS
 * =============================================================================
 *
 * These represent protective defaults rather than tenant business policy.
 *
 * Production deployments should be able to override applicable limits through
 * tenant policy/configuration where required.
 * =============================================================================
 */

const REFERRAL_LIMITS = Object.freeze({
  MAX_ACTIVE_REFERRALS_PER_REFERRER: 100,
  MAX_REFERRALS_PER_DAY: 20,
  MAX_REFERRALS_PER_HOUR: 10,

  MAX_INVITATIONS_PER_DAY: 50,
  MAX_INVITATIONS_PER_HOUR: 10,

  MAX_REWARD_ATTEMPTS: 5,

  MAX_REWARD_RETRIES: 5,

  MAX_NOTE_LENGTH: 1000,
  MAX_SOURCE_LENGTH: 100,

  MAX_SEARCH_LENGTH: 100,

  MAX_PAGE_LIMIT: 100,
  DEFAULT_PAGE_LIMIT: 20,
});


/**
 * =============================================================================
 * REWARD POLICY DEFAULTS
 * =============================================================================
 *
 * IMPORTANT:
 * -----------------------------------------------------------------------------
 * NO ACTUAL MONEY VALUES are hard-coded here.
 *
 * Reward amounts must be determined from:
 *
 * - tenant policy
 * - referral campaign
 * - product policy
 * - currency
 * - eligibility
 * - regulatory rules
 * - risk controls
 *
 * The service layer should resolve the effective reward policy.
 * =============================================================================
 */

const REFERRAL_REWARD_POLICY = Object.freeze({
  CALCULATION_MODE: "policy_driven",

  /**
   * Financial amounts should be represented in minor units internally wherever
   * supported by the financial architecture.
   */
  INTERNAL_AMOUNT_MODE: "minor_units",

  /**
   * Reward issuance must be idempotent.
   */
  REQUIRE_IDEMPOTENCY: true,

  /**
   * Reward issuance should produce an auditable financial event.
   */
  REQUIRE_AUDIT_EVENT: true,

  /**
   * Reward issuance should be linked to the financial ledger.
   */
  REQUIRE_LEDGER_REFERENCE: true,

  /**
   * Reward issuance should not occur for fraud-blocked referrals.
   */
  BLOCK_FRAUD_REVIEW_REWARDS: true,
});


/**
 * =============================================================================
 * IDEMPOTENCY
 * =============================================================================
 */

const REFERRAL_IDEMPOTENCY = Object.freeze({
  HEADER: "Idempotency-Key",

  /**
   * Default persistence window.
   *
   * This is not a substitute for durable financial idempotency.
   */
  TTL_SECONDS: 86400,

  REQUIRED_FOR_REWARD_ISSUANCE: true,

  REQUIRED_FOR_FINANCIAL_MUTATION: true,
});


/**
 * =============================================================================
 * REWARD OUTBOX
 * =============================================================================
 *
 * Intended for the separate ReferralReward / Reward Outbox architecture.
 * =============================================================================
 */

const REFERRAL_REWARD_OUTBOX = Object.freeze({
  EVENT_TYPE: "referral.reward.issue",

  DEFAULT_ATTEMPTS: 5,

  BACKOFF_STRATEGY: "exponential",

  /**
   * Prevent immediate hot-loop retry storms.
   */
  INITIAL_BACKOFF_MS: 1000,

  MAX_BACKOFF_MS: 300000,

  /**
   * Outbox records should be processed atomically with the originating
   * business transaction where supported.
   */
  REQUIRE_ATOMIC_CREATION: true,

  /**
   * Consumers must be idempotent.
   */
  REQUIRE_IDEMPOTENT_CONSUMER: true,
});


/**
 * =============================================================================
 * NOTIFICATION TYPES
 * =============================================================================
 */

const REFERRAL_NOTIFICATION_TYPE = Object.freeze({
  REFERRAL_CREATED: "referral_created",
  REFERRAL_APPLIED: "referral_applied",
  REFERRAL_QUALIFIED: "referral_qualified",
  REFERRAL_COMPLETED: "referral_completed",
  REWARD_PENDING: "reward_pending",
  REWARD_ISSUED: "reward_issued",
  REWARD_FAILED: "reward_failed",
  REFERRAL_REJECTED: "referral_rejected",
  REFERRAL_CANCELLED: "referral_cancelled",
  FRAUD_REVIEW: "fraud_review",
});


const REFERRAL_NOTIFICATION_TYPES = Object.freeze(
  Object.values(REFERRAL_NOTIFICATION_TYPE)
);


/**
 * =============================================================================
 * AUDIT ACTIONS
 * =============================================================================
 */

const REFERRAL_AUDIT_ACTION = Object.freeze({
  CREATED: "referral.created",
  UPDATED: "referral.updated",
  ATTRIBUTED: "referral.attributed",
  QUALIFIED: "referral.qualified",
  COMPLETED: "referral.completed",

  REWARD_CREATED: "referral.reward_created",
  REWARD_ISSUED: "referral.reward_issued",
  REWARD_FAILED: "referral.reward_failed",
  REWARD_REVERSED: "referral.reward_reversed",

  STATUS_CHANGED: "referral.status_changed",

  FRAUD_REVIEW_STARTED: "referral.fraud_review_started",
  FRAUD_REVIEW_CLEARED: "referral.fraud_review_cleared",
  FRAUD_BLOCKED: "referral.fraud_blocked",

  CANCELLED: "referral.cancelled",
  REJECTED: "referral.rejected",
});


const REFERRAL_AUDIT_ACTIONS = Object.freeze(
  Object.values(REFERRAL_AUDIT_ACTION)
);


/**
 * =============================================================================
 * ACTOR TYPES
 * =============================================================================
 */

const REFERRAL_ACTOR_TYPE = Object.freeze({
  USER: "user",
  ADMIN: "admin",
  SYSTEM: "system",
  SERVICE: "service",
  WORKER: "worker",
  API: "api",
});


const REFERRAL_ACTOR_TYPES = Object.freeze(
  Object.values(REFERRAL_ACTOR_TYPE)
);


/**
 * =============================================================================
 * PAGINATION / SORTING
 * ============================================================================= */

const REFERRAL_SORT_FIELD = Object.freeze({
  CREATED_AT: "createdAt",
  UPDATED_AT: "updatedAt",
  STATUS: "status",
  COMPLETED_AT: "completedAt",
  REWARD_AMOUNT: "rewardAmount",
});


const REFERRAL_SORT_FIELDS = Object.freeze(
  Object.values(REFERRAL_SORT_FIELD)
);


const REFERRAL_SORT_ORDER = Object.freeze({
  ASC: "asc",
  DESC: "desc",
});


const REFERRAL_SORT_ORDERS = Object.freeze(
  Object.values(REFERRAL_SORT_ORDER)
);


/**
 * =============================================================================
 * REWARD CALCULATION MODES
 * ============================================================================= */

const REFERRAL_REWARD_CALCULATION_MODE = Object.freeze({
  POLICY_DRIVEN: "policy_driven",
  FIXED: "fixed",
  PERCENTAGE: "percentage",
  TIERED: "tiered",
  CAMPAIGN: "campaign",
});


const REFERRAL_REWARD_CALCULATION_MODES = Object.freeze(
  Object.values(REFERRAL_REWARD_CALCULATION_MODE)
);


/**
 * =============================================================================
 * REWARD FUNDING SOURCES
 * =============================================================================
 */

const REFERRAL_REWARD_FUNDING_SOURCE = Object.freeze({
  PROMOTIONAL_BUDGET: "promotional_budget",
  TENANT_REWARD_POOL: "tenant_reward_pool",
  OPERATING_ACCOUNT: "operating_account",
  CAMPAIGN_BUDGET: "campaign_budget",
});


const REFERRAL_REWARD_FUNDING_SOURCES = Object.freeze(
  Object.values(REFERRAL_REWARD_FUNDING_SOURCE)
);


/**
 * =============================================================================
 * REFERRAL QUALIFICATION REQUIREMENTS
 * =============================================================================
 *
 * Requirement identifiers only.
 *
 * Actual qualification configuration belongs to policy/configuration.
 * =============================================================================
 */

const REFERRAL_QUALIFICATION_REQUIREMENT = Object.freeze({
  ACCOUNT_CREATED: "account_created",
  EMAIL_VERIFIED: "email_verified",
  PHONE_VERIFIED: "phone_verified",
  KYC_COMPLETED: "kyc_completed",
  MEMBERSHIP_ACTIVE: "membership_active",
  FIRST_DEPOSIT: "first_deposit",
  FIRST_CONTRIBUTION: "first_contribution",
  FIRST_TRANSACTION: "first_transaction",
  LOAN_DISBURSED: "loan_disbursed",
});


const REFERRAL_QUALIFICATION_REQUIREMENTS = Object.freeze(
  Object.values(REFERRAL_QUALIFICATION_REQUIREMENT)
);


/**
 * =============================================================================
 * REFERRAL CAMPAIGN STATUS
 * ============================================================================= */

const REFERRAL_CAMPAIGN_STATUS = Object.freeze({
  DRAFT: "draft",
  SCHEDULED: "scheduled",
  ACTIVE: "active",
  PAUSED: "paused",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
});


const REFERRAL_CAMPAIGN_STATUSES = Object.freeze(
  Object.values(REFERRAL_CAMPAIGN_STATUS)
);


/**
 * =============================================================================
 * ERROR CODES
 * =============================================================================
 *
 * Stable machine-readable codes for controllers, API responses, monitoring,
 * support tooling and automated tests.
 * =============================================================================
 */

const REFERRAL_ERROR_CODE = Object.freeze({
  INVALID_REFERRAL_ID: "REFERRAL_INVALID_ID",
  REFERRAL_NOT_FOUND: "REFERRAL_NOT_FOUND",

  INVALID_REFERRAL_CODE: "REFERRAL_INVALID_CODE",
  REFERRAL_CODE_NOT_FOUND: "REFERRAL_CODE_NOT_FOUND",
  REFERRAL_CODE_EXPIRED: "REFERRAL_CODE_EXPIRED",

  DUPLICATE_REFERRAL: "REFERRAL_DUPLICATE",
  SELF_REFERRAL: "REFERRAL_SELF_REFERRAL",

  TENANT_CONTEXT_REQUIRED: "REFERRAL_TENANT_CONTEXT_REQUIRED",
  TENANT_MISMATCH: "REFERRAL_TENANT_MISMATCH",

  REFERRER_REQUIRED: "REFERRAL_REFERRER_REQUIRED",
  REFERRED_USER_REQUIRED: "REFERRAL_REFERRED_USER_REQUIRED",

  REFERRAL_NOT_ELIGIBLE: "REFERRAL_NOT_ELIGIBLE",
  REFERRAL_ALREADY_COMPLETED: "REFERRAL_ALREADY_COMPLETED",

  INVALID_STATUS: "REFERRAL_INVALID_STATUS",
  INVALID_STATUS_TRANSITION: "REFERRAL_INVALID_STATUS_TRANSITION",

  REWARD_NOT_ELIGIBLE: "REFERRAL_REWARD_NOT_ELIGIBLE",
  REWARD_ALREADY_ISSUED: "REFERRAL_REWARD_ALREADY_ISSUED",
  REWARD_PROCESSING: "REFERRAL_REWARD_PROCESSING",
  REWARD_ISSUANCE_FAILED: "REFERRAL_REWARD_ISSUANCE_FAILED",
  REWARD_REVERSED: "REFERRAL_REWARD_REVERSED",

  INVALID_REWARD_AMOUNT: "REFERRAL_INVALID_REWARD_AMOUNT",
  INVALID_REWARD_CURRENCY: "REFERRAL_INVALID_REWARD_CURRENCY",
  INVALID_REWARD_TYPE: "REFERRAL_INVALID_REWARD_TYPE",

  IDEMPOTENCY_REQUIRED: "REFERRAL_IDEMPOTENCY_REQUIRED",
  IDEMPOTENCY_CONFLICT: "REFERRAL_IDEMPOTENCY_CONFLICT",

  VELOCITY_LIMIT_EXCEEDED: "REFERRAL_VELOCITY_LIMIT_EXCEEDED",
  REFERRAL_LIMIT_EXCEEDED: "REFERRAL_LIMIT_EXCEEDED",

  FRAUD_REVIEW: "REFERRAL_FRAUD_REVIEW",
  FRAUD_BLOCKED: "REFERRAL_FRAUD_BLOCKED",

  CAMPAIGN_INACTIVE: "REFERRAL_CAMPAIGN_INACTIVE",

  CONCURRENT_MODIFICATION: "REFERRAL_CONCURRENT_MODIFICATION",
});


const REFERRAL_ERROR_CODES = Object.freeze(
  Object.values(REFERRAL_ERROR_CODE)
);


/**
 * =============================================================================
 * HTTP-LEVEL SEMANTIC CODES
 * =============================================================================
 *
 * These are not Express status codes themselves. They provide centralized
 * semantic mappings for controllers if required.
 * =============================================================================
 */

const REFERRAL_HTTP_STATUS = Object.freeze({
  CREATED: 201,
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
});


/**
 * =============================================================================
 * DATABASE / CONCURRENCY SEMANTICS
 * =============================================================================
 */

const REFERRAL_CONCURRENCY = Object.freeze({
  /**
   * Optimistic versioning should be used where supported.
   */
  USE_OPTIMISTIC_CONCURRENCY: true,

  /**
   * Financial reward issuance must not rely on blind document overwrites.
   */
  REQUIRE_ATOMIC_REWARD_TRANSITION: true,

  /**
   * Duplicate referral prevention should be enforced with database indexes
   * in addition to application checks.
   */
  REQUIRE_UNIQUE_DATABASE_CONSTRAINTS: true,

  /**
   * Reward issuance should use an idempotency key/reference.
   */
  REQUIRE_REWARD_IDEMPOTENCY: true,
});


/**
 * =============================================================================
 * DATABASE INDEX IDENTIFIERS
 * =============================================================================
 *
 * Logical index names can be reused by migration/index-management tooling.
 *
 * The actual index definitions belong in the Referral model/migrations.
 * =============================================================================
 */

const REFERRAL_INDEX = Object.freeze({
  TENANT_REFERRER: "idx_referral_tenant_referrer",
  TENANT_REFERRED_USER: "idx_referral_tenant_referred_user",
  TENANT_STATUS: "idx_referral_tenant_status",
  TENANT_CREATED_AT: "idx_referral_tenant_created_at",
  TENANT_CODE: "idx_referral_tenant_code",

  TENANT_REWARD_STATUS: "idx_referral_tenant_reward_status",

  IDEMPOTENCY_KEY: "idx_referral_idempotency_key",

  CAMPAIGN: "idx_referral_campaign",
});


/**
 * =============================================================================
 * API FIELDS
 * =============================================================================
 *
 * Canonical field names shared by validators/controllers/services.
 * =============================================================================
 */

const REFERRAL_FIELD = Object.freeze({
  ID: "referralId",

  TENANT_ID: "tenantId",

  REFERRER_ID: "referrerId",
  REFERRED_USER_ID: "referredUserId",

  REFERRAL_CODE: "referralCode",
  REFERRAL_TYPE: "referralType",

  SOURCE: "source",
  ATTRIBUTION_METHOD: "attributionMethod",

  CAMPAIGN_ID: "campaignId",

  STATUS: "status",

  QUALIFIED_AT: "qualifiedAt",
  COMPLETED_AT: "completedAt",
  EXPIRED_AT: "expiredAt",
  CANCELLED_AT: "cancelledAt",
  REJECTED_AT: "rejectedAt",

  REWARD_ID: "rewardId",
  REWARD_STATUS: "rewardStatus",
  REWARD_TYPE: "rewardType",
  REWARD_AMOUNT: "rewardAmount",
  REWARD_CURRENCY: "rewardCurrency",

  RISK_STATUS: "riskStatus",
  RISK_SCORE: "riskScore",
  RISK_REASONS: "riskReasons",

  IDEMPOTENCY_KEY: "idempotencyKey",

  CREATED_AT: "createdAt",
  UPDATED_AT: "updatedAt",
});


/**
 * =============================================================================
 * SECURITY POLICY
 * =============================================================================
 */

const REFERRAL_SECURITY = Object.freeze({
  /**
   * Never trust tenantId from public payloads.
   */
  TRUST_CLIENT_TENANT_ID: false,

  /**
   * Never trust referrer identity from public payloads where it can be derived
   * from authentication context.
   */
  TRUST_CLIENT_REFERRER_ID: false,

  /**
   * Never trust reward amount from public clients.
   */
  TRUST_CLIENT_REWARD_AMOUNT: false,

  /**
   * Never trust referral status from public clients.
   */
  TRUST_CLIENT_STATUS: false,

  /**
   * Never trust reward status from clients.
   */
  TRUST_CLIENT_REWARD_STATUS: false,

  /**
   * Referral code comparison should use canonical normalized values.
   */
  NORMALIZE_REFERRAL_CODE: true,

  /**
   * Prevent self-referrals.
   */
  BLOCK_SELF_REFERRAL: true,

  /**
   * Enforce tenant isolation at every data-access boundary.
   */
  REQUIRE_TENANT_ISOLATION: true,

  /**
   * Require authenticated context for mutation operations.
   */
  REQUIRE_AUTHENTICATION_FOR_MUTATIONS: true,

  /**
   * Financial reward issuance requires authorization.
   */
  REQUIRE_REWARD_AUTHORIZATION: true,
});


/**
 * =============================================================================
 * OBSERVABILITY
 * =============================================================================
 */

const REFERRAL_METRIC = Object.freeze({
  CREATED_TOTAL: "titech_referral_created_total",
  QUALIFIED_TOTAL: "titech_referral_qualified_total",
  COMPLETED_TOTAL: "titech_referral_completed_total",

  REWARD_ELIGIBLE_TOTAL: "titech_referral_reward_eligible_total",
  REWARD_ISSUED_TOTAL: "titech_referral_reward_issued_total",
  REWARD_FAILED_TOTAL: "titech_referral_reward_failed_total",

  FRAUD_REVIEW_TOTAL: "titech_referral_fraud_review_total",
  FRAUD_BLOCKED_TOTAL: "titech_referral_fraud_blocked_total",

  REWARD_PROCESSING_DURATION: "titech_referral_reward_processing_duration",

  REWARD_AMOUNT_TOTAL: "titech_referral_reward_amount_total",
});


/**
 * =============================================================================
 * LOGGING EVENT NAMES
 * ============================================================================= */

const REFERRAL_LOG_EVENT = Object.freeze({
  CREATE: "referral.create",
  APPLY: "referral.apply",
  QUALIFY: "referral.qualify",
  COMPLETE: "referral.complete",

  REWARD_CREATE: "referral.reward.create",
  REWARD_PROCESS: "referral.reward.process",
  REWARD_ISSUE: "referral.reward.issue",
  REWARD_FAIL: "referral.reward.fail",

  FRAUD_REVIEW: "referral.fraud.review",
  FRAUD_BLOCK: "referral.fraud.block",

  STATUS_TRANSITION: "referral.status.transition",
});


/**
 * =============================================================================
 * CACHE
 * =============================================================================
 *
 * Cache identifiers only.
 *
 * Do not use cache as the source of financial truth.
 * =============================================================================
 */

const REFERRAL_CACHE = Object.freeze({
  CODE_PREFIX: "titech:referral:code:",
  REFERRAL_PREFIX: "titech:referral:",
  STATS_PREFIX: "titech:referral:stats:",
  LIMIT_PREFIX: "titech:referral:limit:",

  /**
   * Referral-code lookup can be cached briefly.
   */
  CODE_TTL_SECONDS: 300,

  /**
   * Never use cache to determine final reward issuance state.
   */
  CACHE_IS_SOURCE_OF_TRUTH: false,
});


/**
 * =============================================================================
 * QUEUE
 * =============================================================================
 */

const REFERRAL_QUEUE = Object.freeze({
  REWARD_ISSUANCE: "titech.referral.reward.issuance",
  REWARD_RETRY: "titech.referral.reward.retry",
  FRAUD_REVIEW: "titech.referral.fraud.review",
  NOTIFICATION: "titech.referral.notification",
  ANALYTICS: "titech.referral.analytics",
});


/**
 * =============================================================================
 * QUEUE JOB TYPES
 * ============================================================================= */

const REFERRAL_JOB_TYPE = Object.freeze({
  ISSUE_REWARD: "issue_reward",
  RETRY_REWARD: "retry_reward",
  RUN_FRAUD_REVIEW: "run_fraud_review",
  SEND_NOTIFICATION: "send_notification",
  RECORD_ANALYTICS: "record_analytics",
  EXPIRE_REFERRALS: "expire_referrals",
});


const REFERRAL_JOB_TYPES = Object.freeze(
  Object.values(REFERRAL_JOB_TYPE)
);


/**
 * =============================================================================
 * DEFAULT RETRY POLICY
 * ============================================================================= */

const REFERRAL_RETRY_POLICY = Object.freeze({
  MAX_ATTEMPTS: 5,

  INITIAL_DELAY_MS: 1000,

  MAX_DELAY_MS: 300000,

  BACKOFF_MULTIPLIER: 2,

  /**
   * Randomized delay helps prevent synchronized retry storms.
   */
  USE_JITTER: true,
});


/**
 * =============================================================================
 * REFERRAL CODE GENERATION
 * =============================================================================
 *
 * These are generation rules only.
 *
 * Cryptographically secure random generation belongs in the referral service
 * using Node's crypto module.
 * =============================================================================
 */

const REFERRAL_CODE_GENERATION = Object.freeze({
  PREFIX: "TITECH",

  DEFAULT_RANDOM_LENGTH: 10,

  MIN_RANDOM_LENGTH: 6,

  MAX_RANDOM_LENGTH: 32,

  ALPHABET: "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",

  /**
   * Excludes ambiguous characters:
   *
   * I, O, 0, 1
   */
  EXCLUDE_AMBIGUOUS_CHARACTERS: true,

  /**
   * Generated codes should always be normalized.
   */
  UPPERCASE: true,
});


/**
 * =============================================================================
 * DATA RETENTION
 * =============================================================================
 *
 * Retention policy identifiers/defaults.
 *
 * Regulatory/legal retention must ultimately be governed by TITech's
 * applicable compliance policy and legal requirements.
 * =============================================================================
 */

const REFERRAL_RETENTION = Object.freeze({
  /**
   * Referral operational records should not be automatically deleted merely
   * because they become terminal.
   */
  AUTO_DELETE_TERMINAL_REFERRALS: false,

  /**
   * Financial reward/audit records require durable retention.
   */
  RETAIN_FINANCIAL_AUDIT_RECORDS: true,

  /**
   * Expiry is a business state, not physical deletion.
   */
  EXPIRY_IS_SOFT_STATE: true,
});


/**
 * =============================================================================
 * DATA CLASSIFICATION
 * ============================================================================= */

const REFERRAL_DATA_CLASSIFICATION = Object.freeze({
  REFERRAL_CODE: "internal",
  REFERRAL_STATUS: "internal",
  REWARD_AMOUNT: "financial",
  REWARD_CURRENCY: "financial",
  RISK_SCORE: "restricted",
  RISK_REASONS: "restricted",
  TENANT_ID: "restricted",
  USER_IDENTIFIERS: "restricted",
  AUDIT_METADATA: "restricted",
});


/**
 * =============================================================================
 * HELPER FUNCTIONS
 * =============================================================================
 */

/**
 * Determine whether a referral status is valid.
 *
 * @param {string} status
 * @returns {boolean}
 */
function isValidReferralStatus(status) {
  return REFERRAL_STATUSES.includes(status);
}


/**
 * Determine whether a referral status is terminal.
 *
 * @param {string} status
 * @returns {boolean}
 */
function isTerminalReferralStatus(status) {
  return REFERRAL_TERMINAL_STATUSES.includes(status);
}


/**
 * Determine whether a referral status is active.
 *
 * @param {string} status
 * @returns {boolean}
 */
function isActiveReferralStatus(status) {
  return REFERRAL_ACTIVE_STATUSES.includes(status);
}


/**
 * Determine whether a referral status transition is allowed.
 *
 * @param {string} currentStatus
 * @param {string} nextStatus
 * @returns {boolean}
 */
function isValidReferralStatusTransition(
  currentStatus,
  nextStatus
) {
  if (!isValidReferralStatus(currentStatus)) {
    return false;
  }

  if (!isValidReferralStatus(nextStatus)) {
    return false;
  }

  return REFERRAL_STATUS_TRANSITIONS[currentStatus].includes(
    nextStatus
  );
}


/**
 * Determine whether a reward status is valid.
 *
 * @param {string} status
 * @returns {boolean}
 */
function isValidReferralRewardStatus(status) {
  return REFERRAL_REWARD_STATUSES.includes(status);
}


/**
 * Determine whether a reward status transition is allowed.
 *
 * @param {string} currentStatus
 * @param {string} nextStatus
 * @returns {boolean}
 */
function isValidReferralRewardStatusTransition(
  currentStatus,
  nextStatus
) {
  if (!isValidReferralRewardStatus(currentStatus)) {
    return false;
  }

  if (!isValidReferralRewardStatus(nextStatus)) {
    return false;
  }

  return REFERRAL_REWARD_STATUS_TRANSITIONS[currentStatus].includes(
    nextStatus
  );
}


/**
 * Determine whether a reward type is supported.
 *
 * @param {string} rewardType
 * @returns {boolean}
 */
function isValidReferralRewardType(rewardType) {
  return REFERRAL_REWARD_TYPES.includes(rewardType);
}


/**
 * Determine whether a reward currency is supported.
 *
 * @param {string} currency
 * @returns {boolean}
 */
function isValidReferralRewardCurrency(currency) {
  return REFERRAL_REWARD_CURRENCIES.includes(
    String(currency || "").toUpperCase()
  );
}


/**
 * Determine whether a referral type is supported.
 *
 * @param {string} type
 * @returns {boolean}
 */
function isValidReferralType(type) {
  return REFERRAL_TYPES.includes(type);
}


/**
 * Determine whether a referral source is supported.
 *
 * @param {string} source
 * @returns {boolean}
 */
function isValidReferralSource(source) {
  return REFERRAL_SOURCES.includes(source);
}


/**
 * Normalize a referral code to its canonical representation.
 *
 * @param {string} code
 * @returns {string}
 */
function normalizeReferralCode(code) {
  if (typeof code !== "string") {
    return code;
  }

  return code.trim().toUpperCase();
}


/**
 * Validate canonical referral-code format.
 *
 * @param {string} code
 * @returns {boolean}
 */
function isValidReferralCode(code) {
  if (typeof code !== "string") {
    return false;
  }

  return REFERRAL_CODE.PATTERN.test(
    normalizeReferralCode(code)
  );
}


/**
 * Get valid status transitions.
 *
 * Returns a new array to prevent accidental mutation of internal constants.
 *
 * @param {string} currentStatus
 * @returns {string[]}
 */
function getReferralStatusTransitions(currentStatus) {
  const transitions =
    REFERRAL_STATUS_TRANSITIONS[currentStatus];

  return transitions ? [...transitions] : [];
}


/**
 * Get valid reward status transitions.
 *
 * Returns a new array to prevent accidental mutation of internal constants.
 *
 * @param {string} currentStatus
 * @returns {string[]}
 */
function getReferralRewardStatusTransitions(currentStatus) {
  const transitions =
    REFERRAL_REWARD_STATUS_TRANSITIONS[currentStatus];

  return transitions ? [...transitions] : [];
}


/**
 * =============================================================================
 * FROZEN MASTER CONFIGURATION
 * =============================================================================
 *
 * Useful for diagnostics, configuration introspection and tests.
 *
 * Nested structures are already individually frozen above.
 * =============================================================================
 */

const REFERRAL_CONFIG = Object.freeze({
  domain: REFERRAL_DOMAIN,
  system: REFERRAL_SYSTEM,
  version: REFERRAL_VERSION,

  status: REFERRAL_STATUS,
  statuses: REFERRAL_STATUSES,
  terminalStatuses: REFERRAL_TERMINAL_STATUSES,
  activeStatuses: REFERRAL_ACTIVE_STATUSES,
  statusTransitions: REFERRAL_STATUS_TRANSITIONS,

  type: REFERRAL_TYPE,
  types: REFERRAL_TYPES,

  source: REFERRAL_SOURCE,
  sources: REFERRAL_SOURCES,

  attributionMethod: REFERRAL_ATTRIBUTION_METHOD,
  attributionMethods: REFERRAL_ATTRIBUTION_METHODS,

  rewardType: REFERRAL_REWARD_TYPE,
  rewardTypes: REFERRAL_REWARD_TYPES,

  rewardStatus: REFERRAL_REWARD_STATUS,
  rewardStatuses: REFERRAL_REWARD_STATUSES,
  rewardStatusTransitions: REFERRAL_REWARD_STATUS_TRANSITIONS,

  rewardCurrency: REFERRAL_REWARD_CURRENCY,
  rewardCurrencies: REFERRAL_REWARD_CURRENCIES,

  qualificationEvent: REFERRAL_QUALIFICATION_EVENT,
  qualificationEvents: REFERRAL_QUALIFICATION_EVENTS,

  event: REFERRAL_EVENT,
  events: REFERRAL_EVENTS,

  rewardEvent: REFERRAL_REWARD_EVENT,
  rewardEvents: REFERRAL_REWARD_EVENTS,

  riskStatus: REFERRAL_RISK_STATUS,
  riskStatuses: REFERRAL_RISK_STATUSES,

  riskReason: REFERRAL_RISK_REASON,
  riskReasons: REFERRAL_RISK_REASONS,

  qualificationRequirement:
    REFERRAL_QUALIFICATION_REQUIREMENT,

  qualificationRequirements:
    REFERRAL_QUALIFICATION_REQUIREMENTS,

  limits: REFERRAL_LIMITS,

  code: REFERRAL_CODE,

  rewardPolicy: REFERRAL_REWARD_POLICY,

  idempotency: REFERRAL_IDEMPOTENCY,

  rewardOutbox: REFERRAL_REWARD_OUTBOX,

  notificationType: REFERRAL_NOTIFICATION_TYPE,
  notificationTypes: REFERRAL_NOTIFICATION_TYPES,

  auditAction: REFERRAL_AUDIT_ACTION,
  auditActions: REFERRAL_AUDIT_ACTIONS,

  actorType: REFERRAL_ACTOR_TYPE,
  actorTypes: REFERRAL_ACTOR_TYPES,

  sortField: REFERRAL_SORT_FIELD,
  sortFields: REFERRAL_SORT_FIELDS,

  sortOrder: REFERRAL_SORT_ORDER,
  sortOrders: REFERRAL_SORT_ORDERS,

  rewardCalculationMode:
    REFERRAL_REWARD_CALCULATION_MODE,

  rewardCalculationModes:
    REFERRAL_REWARD_CALCULATION_MODES,

  rewardFundingSource:
    REFERRAL_REWARD_FUNDING_SOURCE,

  rewardFundingSources:
    REFERRAL_REWARD_FUNDING_SOURCES,

  campaignStatus:
    REFERRAL_CAMPAIGN_STATUS,

  campaignStatuses:
    REFERRAL_CAMPAIGN_STATUSES,

  errorCode: REFERRAL_ERROR_CODE,
  errorCodes: REFERRAL_ERROR_CODES,

  httpStatus: REFERRAL_HTTP_STATUS,

  concurrency: REFERRAL_CONCURRENCY,

  index: REFERRAL_INDEX,

  field: REFERRAL_FIELD,

  security: REFERRAL_SECURITY,

  metric: REFERRAL_METRIC,

  logEvent: REFERRAL_LOG_EVENT,

  cache: REFERRAL_CACHE,

  queue: REFERRAL_QUEUE,

  jobType: REFERRAL_JOB_TYPE,
  jobTypes: REFERRAL_JOB_TYPES,

  retryPolicy: REFERRAL_RETRY_POLICY,

  codeGeneration: REFERRAL_CODE_GENERATION,

  retention: REFERRAL_RETENTION,

  dataClassification:
    REFERRAL_DATA_CLASSIFICATION,
});


/**
 * =============================================================================
 * EXPORTS
 * =============================================================================
 *
 * CommonJS is used to remain compatible with the existing Node.js backend
 * architecture.
 * =============================================================================
 */

module.exports = Object.freeze({
  // Domain identity
  REFERRAL_DOMAIN,
  REFERRAL_SYSTEM,
  REFERRAL_VERSION,

  // Referral lifecycle
  REFERRAL_STATUS,
  REFERRAL_STATUSES,
  REFERRAL_TERMINAL_STATUSES,
  REFERRAL_ACTIVE_STATUSES,
  REFERRAL_STATUS_TRANSITIONS,

  // Referral classification
  REFERRAL_TYPE,
  REFERRAL_TYPES,

  REFERRAL_SOURCE,
  REFERRAL_SOURCES,

  REFERRAL_ATTRIBUTION_METHOD,
  REFERRAL_ATTRIBUTION_METHODS,

  // Rewards
  REFERRAL_REWARD_TYPE,
  REFERRAL_REWARD_TYPES,

  REFERRAL_REWARD_STATUS,
  REFERRAL_REWARD_STATUSES,
  REFERRAL_REWARD_STATUS_TRANSITIONS,

  REFERRAL_REWARD_CURRENCY,
  REFERRAL_REWARD_CURRENCIES,

  REFERRAL_REWARD_POLICY,
  REFERRAL_REWARD_CALCULATION_MODE,
  REFERRAL_REWARD_CALCULATION_MODES,

  REFERRAL_REWARD_FUNDING_SOURCE,
  REFERRAL_REWARD_FUNDING_SOURCES,

  // Qualification
  REFERRAL_QUALIFICATION_EVENT,
  REFERRAL_QUALIFICATION_EVENTS,

  REFERRAL_QUALIFICATION_REQUIREMENT,
  REFERRAL_QUALIFICATION_REQUIREMENTS,

  // Events
  REFERRAL_EVENT,
  REFERRAL_EVENTS,

  REFERRAL_REWARD_EVENT,
  REFERRAL_REWARD_EVENTS,

  // Fraud / risk
  REFERRAL_RISK_STATUS,
  REFERRAL_RISK_STATUSES,

  REFERRAL_RISK_REASON,
  REFERRAL_RISK_REASONS,

  // Campaigns
  REFERRAL_CAMPAIGN_STATUS,
  REFERRAL_CAMPAIGN_STATUSES,

  // Limits / policy
  REFERRAL_DEFAULT_EXPIRY_DAYS,
  REFERRAL_LIMITS,

  // Codes
  REFERRAL_CODE,
  REFERRAL_CODE_GENERATION,

  // Idempotency / outbox / retries
  REFERRAL_IDEMPOTENCY,
  REFERRAL_REWARD_OUTBOX,
  REFERRAL_RETRY_POLICY,

  // Notifications / audit
  REFERRAL_NOTIFICATION_TYPE,
  REFERRAL_NOTIFICATION_TYPES,

  REFERRAL_AUDIT_ACTION,
  REFERRAL_AUDIT_ACTIONS,

  REFERRAL_ACTOR_TYPE,
  REFERRAL_ACTOR_TYPES,

  // API / query
  REFERRAL_SORT_FIELD,
  REFERRAL_SORT_FIELDS,

  REFERRAL_SORT_ORDER,
  REFERRAL_SORT_ORDERS,

  REFERRAL_ERROR_CODE,
  REFERRAL_ERROR_CODES,

  REFERRAL_HTTP_STATUS,

  REFERRAL_FIELD,

  // Persistence / infrastructure
  REFERRAL_CONCURRENCY,
  REFERRAL_INDEX,

  REFERRAL_SECURITY,

  REFERRAL_METRIC,
  REFERRAL_LOG_EVENT,

  REFERRAL_CACHE,

  REFERRAL_QUEUE,

  REFERRAL_JOB_TYPE,
  REFERRAL_JOB_TYPES,

  // Data governance
  REFERRAL_RETENTION,
  REFERRAL_DATA_CLASSIFICATION,

  // Master configuration
  REFERRAL_CONFIG,

  // Helpers
  isValidReferralStatus,
  isTerminalReferralStatus,
  isActiveReferralStatus,
  isValidReferralStatusTransition,

  isValidReferralRewardStatus,
  isValidReferralRewardStatusTransition,

  isValidReferralRewardType,
  isValidReferralRewardCurrency,

  isValidReferralType,
  isValidReferralSource,

  normalizeReferralCode,
  isValidReferralCode,

  getReferralStatusTransitions,
  getReferralRewardStatusTransitions,
});