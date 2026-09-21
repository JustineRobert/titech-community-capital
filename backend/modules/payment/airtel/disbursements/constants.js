'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Disbursement Constants / Shared Contract
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/disbursements/constants.js
 *
 * Architectural role
 * ------------------
 * Canonical, dependency-free vocabulary for the Airtel disbursement bounded
 * context. This module is intentionally boring: it contains shared constants,
 * immutable state-transition contracts, error/status classifications, provider
 * operation metadata, validation limits, event names and compatibility helpers.
 *
 * It is designed to be consumed by:
 *   - approvalWorkflow.js
 *   - beneficiaryValidator.js
 *   - compensationManager.js
 *   - Airtel disbursement provider adapters
 *   - reconciliation / repair services
 *   - controllers / route handlers
 *   - jobs / workers
 *   - tests and observability adapters
 *
 * Responsibilities
 * ----------------
 * - Provide one authoritative naming contract for the disbursement module.
 * - Prevent string-literal drift across financial workflows.
 * - Describe safe state machines and terminal states.
 * - Define provider/error/reconciliation classifications.
 * - Define default Uganda/Airtel operational metadata without embedding secrets.
 * - Provide small pure helpers for normalization and safe classification.
 *
 * Non-responsibilities
 * --------------------
 * - No provider API calls.
 * - No database or Redis access.
 * - No financial mutation.
 * - No approval execution.
 * - No KYC/AML/sanctions decisions.
 * - No environment-variable reads or secret handling.
 * - No dynamic mutable singleton state.
 *
 * Financial safety principles
 * ---------------------------
 * 1. Original transaction identity and original idempotency identity remain
 *    separate from any compensation/recovery identity.
 * 2. Provider outcome uncertainty is never represented as confirmed failure.
 * 3. LOCAL_ONLY / PENDING_SYNC / SYNCING are operational states, not settlement.
 * 4. Disbursement states are explicit; illegal transitions are rejected by
 *    consumers using the immutable transition map below.
 * 5. Numeric money policy is expressed in minor-unit strings; callers must use
 *    exact decimal arithmetic at the financial boundary.
 * 6. Constants must remain serializable, immutable and safe to import anywhere.
 *
 * Module format
 * -------------
 * Native ESM. Node.js built-ins are deliberately not required.
 * =============================================================================
 */

// =============================================================================
// Module identity
// =============================================================================

export const MODULE_NAME = 'titech.airtel.disbursements.constants';
export const ENGINE_NAME = 'airtel-disbursement-contracts';
export const ENGINE_VERSION = '2.0.0';
export const SCHEMA_VERSION = 2;
export const COMPONENT = ENGINE_NAME;
export const PROVIDER = 'AIRTEL';
export const OPERATION = 'DISBURSEMENT';
export const COMPENSATION_OPERATION = 'AIRTEL_COMPENSATION';
export const STATUS_OPERATION = 'AIRTEL_DISBURSEMENT_STATUS';

// =============================================================================
// Generic provider / command vocabulary
// =============================================================================

export const PROVIDERS = Object.freeze([
  PROVIDER,
]);

export const OPERATIONS = Object.freeze({
  DISBURSEMENT: 'DISBURSEMENT',
  REFUND: 'REFUND',
  REVERSAL: 'REVERSAL',
  STATUS: 'STATUS',
  COMPENSATION: 'AIRTEL_COMPENSATION',
});

export const COMMANDS = Object.freeze({
  CREATE: 'CREATE',
  VALIDATE: 'VALIDATE',
  SUBMIT: 'SUBMIT',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  CANCEL: 'CANCEL',
  EXECUTE: 'EXECUTE',
  STATUS_CHECK: 'STATUS_CHECK',
  RECONCILE: 'RECONCILE',
  COMPENSATE: 'COMPENSATE',
  REFUND: 'REFUND',
  REVERSE: 'REVERSE',
  RELEASE_RESERVATION: 'RELEASE_RESERVATION',
  RETRY: 'RETRY',
  REPAIR: 'REPAIR',
  REVIEW: 'REVIEW',
  SYNC_OFFLINE: 'SYNC_OFFLINE',
});

export const ACTIONS = Object.freeze({
  CREATE: 'CREATE',
  VALIDATE: 'VALIDATE',
  SUBMIT: 'SUBMIT',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  CANCEL: 'CANCEL',
  EXECUTE: 'EXECUTE',
  STATUS_CHECK: 'STATUS_CHECK',
  RECONCILE: 'RECONCILE',
  COMPENSATE: 'COMPENSATE',
  RELEASE_RESERVATION: 'RELEASE_RESERVATION',
  MARK_FAILED: 'MARK_FAILED',
  MARK_AMBIGUOUS: 'MARK_AMBIGUOUS',
  MARK_SETTLED: 'MARK_SETTLED',
  MARK_RECONCILED: 'MARK_RECONCILED',
  ESCALATE: 'ESCALATE',
  RETRY: 'RETRY',
  REPAIR: 'REPAIR',
  SUPERSEDE: 'SUPERSEDE',
});

// =============================================================================
// Disbursement lifecycle state machine
// =============================================================================

export const DISBURSEMENT_STATES = Object.freeze({
  DRAFT: 'DRAFT',
  VALIDATING: 'VALIDATING',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  QUEUED: 'QUEUED',
  EXECUTING: 'EXECUTING',
  PROVIDER_ACCEPTED: 'PROVIDER_ACCEPTED',
  PROVIDER_PENDING: 'PROVIDER_PENDING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  AMBIGUOUS: 'AMBIGUOUS',
  RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
  RECONCILING: 'RECONCILING',
  RECONCILED: 'RECONCILED',
  COMPENSATION_REQUIRED: 'COMPENSATION_REQUIRED',
  COMPENSATING: 'COMPENSATING',
  COMPENSATED: 'COMPENSATED',
  REFUND_REQUIRED: 'REFUND_REQUIRED',
  REFUNDING: 'REFUNDING',
  REFUNDED: 'REFUNDED',
  REVERSED: 'REVERSED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  REJECTED: 'REJECTED',
  ESCALATED: 'ESCALATED',
});

export const TERMINAL_DISBURSEMENT_STATES = Object.freeze([
  DISBURSEMENT_STATES.SUCCESS,
  DISBURSEMENT_STATES.FAILED,
  DISBURSEMENT_STATES.COMPENSATED,
  DISBURSEMENT_STATES.REFUNDED,
  DISBURSEMENT_STATES.REVERSED,
  DISBURSEMENT_STATES.CANCELLED,
  DISBURSEMENT_STATES.EXPIRED,
  DISBURSEMENT_STATES.REJECTED,
]);

export const ACTIVE_DISBURSEMENT_STATES = Object.freeze([
  DISBURSEMENT_STATES.DRAFT,
  DISBURSEMENT_STATES.VALIDATING,
  DISBURSEMENT_STATES.PENDING_APPROVAL,
  DISBURSEMENT_STATES.APPROVED,
  DISBURSEMENT_STATES.QUEUED,
  DISBURSEMENT_STATES.EXECUTING,
  DISBURSEMENT_STATES.PROVIDER_ACCEPTED,
  DISBURSEMENT_STATES.PROVIDER_PENDING,
  DISBURSEMENT_STATES.AMBIGUOUS,
  DISBURSEMENT_STATES.RECONCILIATION_REQUIRED,
  DISBURSEMENT_STATES.RECONCILING,
  DISBURSEMENT_STATES.COMPENSATION_REQUIRED,
  DISBURSEMENT_STATES.COMPENSATING,
  DISBURSEMENT_STATES.REFUND_REQUIRED,
  DISBURSEMENT_STATES.REFUNDING,
  DISBURSEMENT_STATES.ESCALATED,
]);

const DISBURSEMENT_TRANSITIONS = {
  [DISBURSEMENT_STATES.DRAFT]: [
    DISBURSEMENT_STATES.VALIDATING,
    DISBURSEMENT_STATES.CANCELLED,
    DISBURSEMENT_STATES.EXPIRED,
  ],

  [DISBURSEMENT_STATES.VALIDATING]: [
    DISBURSEMENT_STATES.PENDING_APPROVAL,
    DISBURSEMENT_STATES.APPROVED,
    DISBURSEMENT_STATES.VALIDATION_FAILED,
    DISBURSEMENT_STATES.ESCALATED,
  ],

  [DISBURSEMENT_STATES.VALIDATION_FAILED]: [
    DISBURSEMENT_STATES.VALIDATING,
    DISBURSEMENT_STATES.CANCELLED,
  ],

  [DISBURSEMENT_STATES.PENDING_APPROVAL]: [
    DISBURSEMENT_STATES.APPROVED,
    DISBURSEMENT_STATES.REJECTED,
    DISBURSEMENT_STATES.CANCELLED,
    DISBURSEMENT_STATES.EXPIRED,
    DISBURSEMENT_STATES.ESCALATED,
  ],

  [DISBURSEMENT_STATES.APPROVED]: [
    DISBURSEMENT_STATES.QUEUED,
    DISBURSEMENT_STATES.EXECUTING,
    DISBURSEMENT_STATES.CANCELLED,
    DISBURSEMENT_STATES.EXPIRED,
  ],

  [DISBURSEMENT_STATES.QUEUED]: [
    DISBURSEMENT_STATES.EXECUTING,
    DISBURSEMENT_STATES.CANCELLED,
    DISBURSEMENT_STATES.EXPIRED,
  ],

  [DISBURSEMENT_STATES.EXECUTING]: [
    DISBURSEMENT_STATES.PROVIDER_ACCEPTED,
    DISBURSEMENT_STATES.PROVIDER_PENDING,
    DISBURSEMENT_STATES.SUCCESS,
    DISBURSEMENT_STATES.FAILED,
    DISBURSEMENT_STATES.AMBIGUOUS,
    DISBURSEMENT_STATES.RECONCILIATION_REQUIRED,
    DISBURSEMENT_STATES.COMPENSATION_REQUIRED,
    DISBURSEMENT_STATES.ESCALATED,
  ],

  [DISBURSEMENT_STATES.PROVIDER_ACCEPTED]: [
    DISBURSEMENT_STATES.PROVIDER_PENDING,
    DISBURSEMENT_STATES.SUCCESS,
    DISBURSEMENT_STATES.RECONCILIATION_REQUIRED,
    DISBURSEMENT_STATES.AMBIGUOUS,
  ],

  [DISBURSEMENT_STATES.PROVIDER_PENDING]: [
    DISBURSEMENT_STATES.SUCCESS,
    DISBURSEMENT_STATES.FAILED,
    DISBURSEMENT_STATES.AMBIGUOUS,
    DISBURSEMENT_STATES.RECONCILIATION_REQUIRED,
    DISBURSEMENT_STATES.ESCALATED,
  ],

  [DISBURSEMENT_STATES.SUCCESS]: [
    DISBURSEMENT_STATES.RECONCILIATION_REQUIRED,
    DISBURSEMENT_STATES.REVERSAL,
    DISBURSEMENT_STATES.REFUND_REQUIRED,
  ],

  [DISBURSEMENT_STATES.FAILED]: [
    DISBURSEMENT_STATES.COMPENSATION_REQUIRED,
    DISBURSEMENT_STATES.RECONCILIATION_REQUIRED,
    DISBURSEMENT_STATES.ESCALATED,
  ],

  [DISBURSEMENT_STATES.AMBIGUOUS]: [
    DISBURSEMENT_STATES.RECONCILIATION_REQUIRED,
    DISBURSEMENT_STATES.ESCALATED,
  ],

  [DISBURSEMENT_STATES.RECONCILIATION_REQUIRED]: [
    DISBURSEMENT_STATES.RECONCILING,
    DISBURSEMENT_STATES.COMPENSATION_REQUIRED,
    DISBURSEMENT_STATES.REFUND_REQUIRED,
    DISBURSEMENT_STATES.SUCCESS,
    DISBURSEMENT_STATES.FAILED,
    DISBURSEMENT_STATES.ESCALATED,
  ],

  [DISBURSEMENT_STATES.RECONCILING]: [
    DISBURSEMENT_STATES.RECONCILED,
    DISBURSEMENT_STATES.COMPENSATION_REQUIRED,
    DISBURSEMENT_STATES.REFUND_REQUIRED,
    DISBURSEMENT_STATES.SUCCESS,
    DISBURSEMENT_STATES.FAILED,
    DISBURSEMENT_STATES.ESCALATED,
  ],

  [DISBURSEMENT_STATES.RECONCILED]: [
    DISBURSEMENT_STATES.SUCCESS,
    DISBURSEMENT_STATES.FAILED,
    DISBURSEMENT_STATES.COMPENSATION_REQUIRED,
    DISBURSEMENT_STATES.REFUND_REQUIRED,
  ],

  [DISBURSEMENT_STATES.COMPENSATION_REQUIRED]: [
    DISBURSEMENT_STATES.COMPENSATING,
    DISBURSEMENT_STATES.ESCALATED,
    DISBURSEMENT_STATES.CANCELLED,
  ],

  [DISBURSEMENT_STATES.COMPENSATING]: [
    DISBURSEMENT_STATES.COMPENSATED,
    DISBURSEMENT_STATES.RECONCILIATION_REQUIRED,
    DISBURSEMENT_STATES.ESCALATED,
  ],

  [DISBURSEMENT_STATES.COMPENSATED]: [],

  [DISBURSEMENT_STATES.REFUND_REQUIRED]: [
    DISBURSEMENT_STATES.REFUNDING,
    DISBURSEMENT_STATES.ESCALATED,
  ],

  [DISBURSEMENT_STATES.REFUNDING]: [
    DISBURSEMENT_STATES.REFUNDED,
    DISBURSEMENT_STATES.RECONCILIATION_REQUIRED,
    DISBURSEMENT_STATES.ESCALATED,
  ],

  [DISBURSEMENT_STATES.REFUNDED]: [],

  [DISBURSEMENT_STATES.REVERSED]: [],

  [DISBURSEMENT_STATES.CANCELLED]: [],

  [DISBURSEMENT_STATES.EXPIRED]: [],

  [DISBURSEMENT_STATES.REJECTED]: [],

  [DISBURSEMENT_STATES.ESCALATED]: [
    DISBURSEMENT_STATES.RECONCILIATION_REQUIRED,
    DISBURSEMENT_STATES.COMPENSATION_REQUIRED,
    DISBURSEMENT_STATES.REFUND_REQUIRED,
    DISBURSEMENT_STATES.CANCELLED,
  ],
};

export const ALLOWED_DISBURSEMENT_TRANSITIONS = Object.freeze(
  Object.fromEntries(
    Object.entries(
      DISBURSEMENT_TRANSITIONS,
    ).map(
      ([state, targets]) => [
        state,
        Object.freeze([
          ...targets,
        ]),
      ],
    ),
  ),
);

// =============================================================================
// Provider execution states and outcomes
// =============================================================================

export const PROVIDER_EXECUTION_STATES = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',
  REQUEST_BUILT: 'REQUEST_BUILT',
  SUBMITTED: 'SUBMITTED',
  ACCEPTED: 'ACCEPTED',
  PENDING: 'PENDING',
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  TIMEOUT: 'TIMEOUT',
  UNKNOWN: 'UNKNOWN',
  AMBIGUOUS: 'AMBIGUOUS',
});

export const PROVIDER_OUTCOMES = Object.freeze({
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  AMBIGUOUS: 'AMBIGUOUS',
  PENDING: 'PENDING',
  UNKNOWN: 'UNKNOWN',
  REJECTED: 'REJECTED',
  ACCEPTED: 'ACCEPTED',
});

export const PROVIDER_RESULT_CATEGORIES = Object.freeze({
  TERMINAL_SUCCESS: 'TERMINAL_SUCCESS',
  TERMINAL_FAILURE: 'TERMINAL_FAILURE',
  ACCEPTED_PENDING: 'ACCEPTED_PENDING',
  AMBIGUOUS: 'AMBIGUOUS',
  UNKNOWN: 'UNKNOWN',
});

export const AMBIGUOUS_PROVIDER_OUTCOMES = Object.freeze([
  PROVIDER_OUTCOMES.AMBIGUOUS,
  PROVIDER_OUTCOMES.PENDING,
  PROVIDER_OUTCOMES.UNKNOWN,
]);

// =============================================================================
// Reconciliation vocabulary
// =============================================================================

export const RECONCILIATION_STATES = Object.freeze({
  NOT_RUN: 'NOT_RUN',
  RUNNING: 'RUNNING',
  PENDING: 'PENDING',
  CONFIRMED_SUCCESS: 'CONFIRMED_SUCCESS',
  CONFIRMED_FAILURE: 'CONFIRMED_FAILURE',
  CONFLICT: 'CONFLICT',
  REPAIR_REQUIRED: 'REPAIR_REQUIRED',
  REPAIRED: 'REPAIRED',
  ESCALATED: 'ESCALATED',
});

export const RECONCILIATION_OUTCOMES = Object.freeze({
  NO_ACTION: 'NO_ACTION',
  MATCHED: 'MATCHED',
  MISMATCH: 'MISMATCH',
  CONFIRMED_SUCCESS: 'CONFIRMED_SUCCESS',
  CONFIRMED_FAILURE: 'CONFIRMED_FAILURE',
  PENDING: 'PENDING',
  AMBIGUOUS: 'AMBIGUOUS',
  REPAIR_REQUIRED: 'REPAIR_REQUIRED',
  ESCALATED: 'ESCALATED',
});

export const RECONCILIATION_ACTIONS = Object.freeze({
  NO_ACTION: 'NO_ACTION',
  STATUS_CHECK: 'STATUS_CHECK',
  REPAIR: 'REPAIR',
  COMPENSATE: 'COMPENSATE',
  REFUND: 'REFUND',
  REVERSE: 'REVERSE',
  REVIEW: 'REVIEW',
});

// =============================================================================
// Compensation vocabulary
// =============================================================================

export const COMPENSATION_TYPES = Object.freeze({
  RELEASE_RESERVATION: 'RELEASE_RESERVATION',
  REVERSAL: 'REVERSAL',
  REFUND: 'REFUND',
  CORRECTION: 'CORRECTION',
  RECONCILIATION_REPAIR: 'RECONCILIATION_REPAIR',
  MANUAL_REVIEW: 'MANUAL_REVIEW',
  NO_ACTION: 'NO_ACTION',
});

export const COMPENSATION_STATES = Object.freeze({
  DISCOVERED: 'DISCOVERED',
  REQUIRES_RECONCILIATION: 'REQUIRES_RECONCILIATION',
  READY_FOR_COMPENSATION: 'READY_FOR_COMPENSATION',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  EXECUTING: 'EXECUTING',
  VERIFYING: 'VERIFYING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  ESCALATED: 'ESCALATED',
  CANCELLED: 'CANCELLED',
  SUPERSEDED: 'SUPERSEDED',
});

export const TERMINAL_COMPENSATION_STATES = Object.freeze([
  COMPENSATION_STATES.COMPLETED,
  COMPENSATION_STATES.FAILED,
  COMPENSATION_STATES.CANCELLED,
  COMPENSATION_STATES.SUPERSEDED,
]);

export const COMPENSATION_TRANSITIONS = Object.freeze({
  [COMPENSATION_STATES.DISCOVERED]: Object.freeze([
    COMPENSATION_STATES.REQUIRES_RECONCILIATION,
    COMPENSATION_STATES.READY_FOR_COMPENSATION,
    COMPENSATION_STATES.PENDING_APPROVAL,
    COMPENSATION_STATES.ESCALATED,
    COMPENSATION_STATES.CANCELLED,
  ]),

  [COMPENSATION_STATES.REQUIRES_RECONCILIATION]: Object.freeze([
    COMPENSATION_STATES.READY_FOR_COMPENSATION,
    COMPENSATION_STATES.PENDING_APPROVAL,
    COMPENSATION_STATES.ESCALATED,
    COMPENSATION_STATES.CANCELLED,
  ]),

  [COMPENSATION_STATES.READY_FOR_COMPENSATION]: Object.freeze([
    COMPENSATION_STATES.PENDING_APPROVAL,
    COMPENSATION_STATES.APPROVED,
    COMPENSATION_STATES.EXECUTING,
    COMPENSATION_STATES.ESCALATED,
    COMPENSATION_STATES.CANCELLED,
  ]),

  [COMPENSATION_STATES.PENDING_APPROVAL]: Object.freeze([
    COMPENSATION_STATES.APPROVED,
    COMPENSATION_STATES.ESCALATED,
    COMPENSATION_STATES.CANCELLED,
    COMPENSATION_STATES.SUPERSEDED,
  ]),

  [COMPENSATION_STATES.APPROVED]: Object.freeze([
    COMPENSATION_STATES.EXECUTING,
    COMPENSATION_STATES.CANCELLED,
    COMPENSATION_STATES.SUPERSEDED,
  ]),

  [COMPENSATION_STATES.EXECUTING]: Object.freeze([
    COMPENSATION_STATES.VERIFYING,
    COMPENSATION_STATES.FAILED,
    COMPENSATION_STATES.ESCALATED,
  ]),

  [COMPENSATION_STATES.VERIFYING]: Object.freeze([
    COMPENSATION_STATES.COMPLETED,
    COMPENSATION_STATES.FAILED,
    COMPENSATION_STATES.ESCALATED,
  ]),

  [COMPENSATION_STATES.COMPLETED]: Object.freeze([]),

  [COMPENSATION_STATES.FAILED]: Object.freeze([
    COMPENSATION_STATES.ESCALATED,
  ]),

  [COMPENSATION_STATES.ESCALATED]: Object.freeze([
    COMPENSATION_STATES.REQUIRES_RECONCILIATION,
    COMPENSATION_STATES.READY_FOR_COMPENSATION,
    COMPENSATION_STATES.PENDING_APPROVAL,
    COMPENSATION_STATES.CANCELLED,
    COMPENSATION_STATES.SUPERSEDED,
  ]),

  [COMPENSATION_STATES.CANCELLED]: Object.freeze([]),

  [COMPENSATION_STATES.SUPERSEDED]: Object.freeze([]),
});

// =============================================================================
// Approval / governance vocabulary
// =============================================================================

export const APPROVAL_STATES = Object.freeze({
  DRAFT: 'DRAFT',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  SUPERSEDED: 'SUPERSEDED',
  CONSUMED: 'CONSUMED',
  EXECUTION_FAILED: 'EXECUTION_FAILED',
});

export const APPROVAL_ACTIONS = Object.freeze({
  CREATE: 'CREATE',
  SUBMIT: 'SUBMIT',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  CANCEL: 'CANCEL',
  EXPIRE: 'EXPIRE',
  SUPERSEDE: 'SUPERSEDE',
  CONSUME: 'CONSUME',
  MARK_EXECUTION_FAILED: 'MARK_EXECUTION_FAILED',
});

export const APPROVAL_DECISIONS = Object.freeze({
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  REQUIRE_REVIEW: 'REQUIRE_REVIEW',
  BLOCK: 'BLOCK',
});

export const GOVERNANCE_OUTCOMES = Object.freeze({
  READY: 'READY',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  BLOCKED: 'BLOCKED',
  EXPIRED: 'EXPIRED',
  INVALID: 'INVALID',
  REPLAY: 'REPLAY',
  STALE: 'STALE',
});

// =============================================================================
// Beneficiary / identity vocabulary
// =============================================================================

export const BENEFICIARY_TYPES = Object.freeze({
  MSISDN: 'MSISDN',
  ACCOUNT: 'ACCOUNT',
  WALLET: 'WALLET',
  MERCHANT: 'MERCHANT',
  EXTERNAL_ID: 'EXTERNAL_ID',
});

export const BENEFICIARY_STATUSES = Object.freeze({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  SUSPENDED: 'SUSPENDED',
  BLOCKED: 'BLOCKED',
  CLOSED: 'CLOSED',
  UNKNOWN: 'UNKNOWN',
});

export const BENEFICIARY_VALIDATION_OUTCOMES = Object.freeze({
  PASS: 'PASS',
  REVIEW: 'REVIEW',
  BLOCK: 'BLOCK',
  ERROR: 'ERROR',
});

export const BENEFICIARY_VALIDATION_CODES = Object.freeze({
  VALID: 'BENEFICIARY_VALID',
  REQUIRED: 'BENEFICIARY_REQUIRED',
  STRUCTURE_INVALID: 'BENEFICIARY_STRUCTURE_INVALID',
  TENANT_REQUIRED: 'TENANT_REQUIRED',
  TENANT_SCOPE_MISMATCH: 'TENANT_SCOPE_MISMATCH',
  PROVIDER_SCOPE_VIOLATION: 'PROVIDER_SCOPE_VIOLATION',
  COUNTRY_REQUIRED: 'COUNTRY_REQUIRED',
  UNSUPPORTED_COUNTRY: 'UNSUPPORTED_COUNTRY',
  CURRENCY_REQUIRED: 'CURRENCY_REQUIRED',
  UNSUPPORTED_CURRENCY: 'UNSUPPORTED_CURRENCY',
  PARTY_ID_REQUIRED: 'BENEFICIARY_PARTY_ID_REQUIRED',
  PARTY_TYPE_INVALID: 'BENEFICIARY_PARTY_TYPE_INVALID',
  PARTY_ID_INVALID: 'BENEFICIARY_PARTY_ID_INVALID',
  MSISDN_INVALID: 'BENEFICIARY_MSISDN_INVALID',
  MSISDN_COUNTRY_MISMATCH: 'BENEFICIARY_MSISDN_COUNTRY_MISMATCH',
  REFERENCE_REQUIRED: 'DISBURSEMENT_REFERENCE_REQUIRED',
  IDEMPOTENCY_REQUIRED: 'ORIGINAL_IDEMPOTENCY_KEY_REQUIRED',
  AMOUNT_REQUIRED: 'DISBURSEMENT_AMOUNT_REQUIRED',
  AMOUNT_INVALID: 'DISBURSEMENT_AMOUNT_INVALID',
  AMOUNT_TOO_LOW: 'DISBURSEMENT_AMOUNT_TOO_LOW',
  AMOUNT_TOO_HIGH: 'DISBURSEMENT_AMOUNT_TOO_HIGH',
  OFFLINE_UNSAFE: 'BENEFICIARY_OFFLINE_STATE_UNSAFE',
  BLACKLISTED: 'BENEFICIARY_BLACKLISTED',
  KYC_FAILED: 'BENEFICIARY_KYC_FAILED',
  KYC_REQUIRED: 'BENEFICIARY_KYC_REQUIRED',
  AML_FAILED: 'BENEFICIARY_AML_FAILED',
  AML_REQUIRED: 'BENEFICIARY_AML_REQUIRED',
  SANCTIONS_FAILED: 'BENEFICIARY_SANCTIONS_FAILED',
  FRAUD_BLOCKED: 'BENEFICIARY_FRAUD_BLOCKED',
  RISK_REVIEW: 'BENEFICIARY_RISK_REVIEW',
  DIRECTORY_NOT_FOUND: 'BENEFICIARY_NOT_FOUND',
  DIRECTORY_INACTIVE: 'BENEFICIARY_INACTIVE',
  DIRECTORY_CONFLICT: 'BENEFICIARY_DIRECTORY_CONFLICT',
  RULE_REJECTED: 'BENEFICIARY_RULE_REJECTED',
  RULE_REVIEW: 'BENEFICIARY_RULE_REVIEW',
  SERVICE_UNAVAILABLE: 'BENEFICIARY_VALIDATION_SERVICE_UNAVAILABLE',
});

// =============================================================================
// Risk, impact and compliance vocabulary
// =============================================================================

export const RISK_LEVELS = Object.freeze({
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
});

export const RISK_RANK = Object.freeze({
  [RISK_LEVELS.LOW]: 1,
  [RISK_LEVELS.MEDIUM]: 2,
  [RISK_LEVELS.HIGH]: 3,
  [RISK_LEVELS.CRITICAL]: 4,
});

export const IMPACT_LEVELS = Object.freeze({
  DISBURSEMENT: 'DISBURSEMENT',
  REFUND: 'REFUND',
  REVERSAL: 'REVERSAL',
  CORRECTION: 'CORRECTION',
  NON_FINANCIAL: 'NON_FINANCIAL',
});

export const COMPLIANCE_DECISIONS = Object.freeze({
  ALLOW: 'ALLOW',
  ALLOW_WITH_CONTROLS: 'ALLOW_WITH_CONTROLS',
  REVIEW: 'REVIEW',
  BLOCK: 'BLOCK',
  NO_POLICY: 'NO_POLICY',
  INDETERMINATE: 'INDETERMINATE',
});

export const COMPLIANCE_STATES = Object.freeze({
  NOT_RUN: 'NOT_RUN',
  PASSED: 'PASSED',
  REVIEW: 'REVIEW',
  BLOCKED: 'BLOCKED',
  STALE: 'STALE',
  CONFLICT: 'CONFLICT',
  UNAVAILABLE: 'UNAVAILABLE',
});

// =============================================================================
// Offline-first vocabulary
// =============================================================================

export const OFFLINE_STATES = Object.freeze({
  LOCAL_ONLY: 'LOCAL_ONLY',
  PENDING_SYNC: 'PENDING_SYNC',
  SYNCING: 'SYNCING',
  SERVER_ACCEPTED: 'SERVER_ACCEPTED',
  SERVER_REJECTED: 'SERVER_REJECTED',
  CONFLICT: 'CONFLICT',
  REQUIRES_REVIEW: 'REQUIRES_REVIEW',
  CONFIRMED: 'CONFIRMED',
});

export const UNSAFE_OFFLINE_STATES = Object.freeze([
  OFFLINE_STATES.LOCAL_ONLY,
  OFFLINE_STATES.PENDING_SYNC,
  OFFLINE_STATES.SYNCING,
  OFFLINE_STATES.SERVER_REJECTED,
  OFFLINE_STATES.CONFLICT,
  OFFLINE_STATES.REQUIRES_REVIEW,
]);

// =============================================================================
// Error taxonomy
// =============================================================================

export const ERROR_CLASSES = Object.freeze({
  VALIDATION: 'VALIDATION',
  AUTHENTICATION: 'AUTHENTICATION',
  AUTHORIZATION: 'AUTHORIZATION',
  RATE_LIMITED: 'RATE_LIMITED',
  NETWORK_TRANSIENT: 'NETWORK_TRANSIENT',
  TIMEOUT_TRANSIENT: 'TIMEOUT_TRANSIENT',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PROVIDER_SERVER_ERROR: 'PROVIDER_SERVER_ERROR',
  PROVIDER_BUSINESS_FAILURE: 'PROVIDER_BUSINESS_FAILURE',
  PROVIDER_REJECTED: 'PROVIDER_REJECTED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  DUPLICATE_REQUEST: 'DUPLICATE_REQUEST',
  FINANCIAL_CONFLICT: 'FINANCIAL_CONFLICT',
  RECONCILIATION_CONFLICT: 'RECONCILIATION_CONFLICT',
  COMPLIANCE_BLOCK: 'COMPLIANCE_BLOCK',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  APPROVAL_INVALID: 'APPROVAL_INVALID',
  TENANT_SCOPE: 'TENANT_SCOPE',
  CONFIGURATION: 'CONFIGURATION',
  PERSISTENCE: 'PERSISTENCE',
  CONCURRENCY: 'CONCURRENCY',
  UNKNOWN: 'UNKNOWN',
});

export const ERROR_CODES = Object.freeze({
  TENANT_REQUIRED: 'TENANT_REQUIRED',
  TENANT_SCOPE_MISMATCH: 'TENANT_SCOPE_MISMATCH',
  PROVIDER_SCOPE_VIOLATION: 'PROVIDER_SCOPE_VIOLATION',
  OPERATION_NOT_SUPPORTED: 'OPERATION_NOT_SUPPORTED',

  REQUEST_REQUIRED: 'DISBURSEMENT_REQUEST_REQUIRED',
  REFERENCE_REQUIRED: 'DISBURSEMENT_REFERENCE_REQUIRED',
  IDEMPOTENCY_KEY_REQUIRED: 'ORIGINAL_IDEMPOTENCY_KEY_REQUIRED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  DUPLICATE_REQUEST: 'DUPLICATE_DISBURSEMENT_REQUEST',

  AMOUNT_REQUIRED: 'DISBURSEMENT_AMOUNT_REQUIRED',
  AMOUNT_INVALID: 'DISBURSEMENT_AMOUNT_INVALID',
  CURRENCY_REQUIRED: 'DISBURSEMENT_CURRENCY_REQUIRED',
  CURRENCY_UNSUPPORTED: 'DISBURSEMENT_CURRENCY_UNSUPPORTED',
  AMOUNT_LIMIT_EXCEEDED: 'DISBURSEMENT_AMOUNT_LIMIT_EXCEEDED',

  BENEFICIARY_REQUIRED: 'BENEFICIARY_REQUIRED',
  BENEFICIARY_INVALID: 'BENEFICIARY_INVALID',
  BENEFICIARY_BLOCKED: 'BENEFICIARY_BLOCKED',

  VALIDATION_FAILED: 'DISBURSEMENT_VALIDATION_FAILED',
  COMPLIANCE_BLOCKED: 'DISBURSEMENT_COMPLIANCE_BLOCKED',
  COMPLIANCE_REVIEW_REQUIRED: 'DISBURSEMENT_COMPLIANCE_REVIEW_REQUIRED',

  APPROVAL_REQUIRED: 'DISBURSEMENT_APPROVAL_REQUIRED',
  APPROVAL_INVALID: 'DISBURSEMENT_APPROVAL_INVALID',
  APPROVAL_SCOPE_MISMATCH: 'DISBURSEMENT_APPROVAL_SCOPE_MISMATCH',
  MAKER_CHECKER_VIOLATION: 'DISBURSEMENT_MAKER_CHECKER_VIOLATION',

  INVALID_STATE_TRANSITION: 'DISBURSEMENT_INVALID_STATE_TRANSITION',
  STALE_VERSION: 'DISBURSEMENT_STALE_VERSION',
  STALE_SCOPE: 'DISBURSEMENT_STALE_SCOPE',

  PROVIDER_TIMEOUT: 'AIRTEL_PROVIDER_TIMEOUT',
  PROVIDER_AMBIGUOUS: 'AIRTEL_PROVIDER_AMBIGUOUS_OUTCOME',
  PROVIDER_REJECTED: 'AIRTEL_PROVIDER_REJECTED',
  PROVIDER_UNAVAILABLE: 'AIRTEL_PROVIDER_UNAVAILABLE',
  PROVIDER_AUTHENTICATION_FAILED: 'AIRTEL_PROVIDER_AUTHENTICATION_FAILED',
  PROVIDER_RATE_LIMITED: 'AIRTEL_PROVIDER_RATE_LIMITED',

  RECONCILIATION_REQUIRED: 'DISBURSEMENT_RECONCILIATION_REQUIRED',
  RECONCILIATION_CONFLICT: 'DISBURSEMENT_RECONCILIATION_CONFLICT',
  RECONCILIATION_UNAVAILABLE: 'DISBURSEMENT_RECONCILIATION_UNAVAILABLE',

  COMPENSATION_REQUIRED: 'DISBURSEMENT_COMPENSATION_REQUIRED',
  COMPENSATION_NOT_SAFE: 'DISBURSEMENT_COMPENSATION_NOT_SAFE',
  COMPENSATION_DUPLICATE: 'DISBURSEMENT_COMPENSATION_DUPLICATE',
  COMPENSATION_CONFLICT: 'DISBURSEMENT_COMPENSATION_CONFLICT',
  COMPENSATION_EXECUTION_FAILED: 'DISBURSEMENT_COMPENSATION_EXECUTION_FAILED',

  FINANCIAL_CORE_UNAVAILABLE: 'FINANCIAL_CORE_UNAVAILABLE',
  LEDGER_POSTING_FAILED: 'LEDGER_POSTING_FAILED',
  BALANCE_MUTATION_FORBIDDEN: 'BALANCE_MUTATION_FORBIDDEN',

  OFFLINE_UNSAFE: 'DISBURSEMENT_OFFLINE_UNSAFE',
  OFFLINE_SYNC_REQUIRED: 'DISBURSEMENT_OFFLINE_SYNC_REQUIRED',

  AUDIT_UNAVAILABLE: 'DISBURSEMENT_AUDIT_UNAVAILABLE',
  EVENT_PUBLICATION_FAILED: 'DISBURSEMENT_EVENT_PUBLICATION_FAILED',
  INTERNAL_ERROR: 'DISBURSEMENT_INTERNAL_ERROR',
});

// =============================================================================
// Retry / resilience vocabulary
// =============================================================================

export const RETRY_DECISIONS = Object.freeze({
  RETRY: 'RETRY',
  NO_RETRY: 'NO_RETRY',
  STATUS_CHECK: 'STATUS_CHECK',
  RECONCILE: 'RECONCILE',
  REVIEW: 'REVIEW',
  STOP: 'STOP',
});

export const RETRY_MODES = Object.freeze({
  IMMEDIATE: 'IMMEDIATE',
  EXPONENTIAL: 'EXPONENTIAL',
  FULL_JITTER: 'EXPONENTIAL_FULL_JITTER',
  EQUAL_JITTER: 'EXPONENTIAL_EQUAL_JITTER',
  RETRY_AFTER: 'RETRY_AFTER',
});

export const CIRCUIT_STATES = Object.freeze({
  CLOSED: 'CLOSED',
  HALF_OPEN: 'HALF_OPEN',
  OPEN: 'OPEN',
  UNKNOWN: 'UNKNOWN',
});

export const HEALTH_STATES = Object.freeze({
  UP: 'UP',
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  DOWN: 'DOWN',
  UNKNOWN: 'UNKNOWN',
});

// =============================================================================
// Monetary / currency defaults
// =============================================================================

export const COUNTRY_CODES = Object.freeze({
  UGANDA: 'UG',
});

export const CURRENCY_CODES = Object.freeze({
  UGX: 'UGX',
});

export const DEFAULT_COUNTRY =
  COUNTRY_CODES.UGANDA;

export const DEFAULT_CURRENCY =
  CURRENCY_CODES.UGX;

export const SUPPORTED_COUNTRIES = Object.freeze([
  DEFAULT_COUNTRY,
]);

export const SUPPORTED_CURRENCIES = Object.freeze([
  DEFAULT_CURRENCY,
]);

export const COUNTRY_CONFIGURATION = Object.freeze({
  [DEFAULT_COUNTRY]: Object.freeze({
    countryCode:
      DEFAULT_COUNTRY,

    dialCode:
      '256',

    defaultCurrency:
      DEFAULT_CURRENCY,

    nationalMsisdnDigits:
      9,

    nationalPrefixes:
      Object.freeze([
        '0',
      ]),
  }),
});

export const MONEY_POLICY = Object.freeze({
  representation:
    'MINOR_UNIT_STRING',

  noBinaryFloatingPoint:
    true,

  requirePositiveAmount:
    true,

  requireCurrency:
    true,

  minimumFractionDigitsAtDisplayBoundary:
    2,

  maximumMinorUnitDigits:
    24,
});

// =============================================================================
// Identifier / input limits
// =============================================================================

export const LIMITS = Object.freeze({
  tenantIdLength:
    160,

  caseIdLength:
    160,

  transactionIdLength:
    240,

  paymentIdLength:
    240,

  commandIdLength:
    240,

  referenceLength:
    240,

  idempotencyKeyLength:
    240,

  actorIdLength:
    160,

  beneficiaryIdLength:
    240,

  reasonLength:
    2000,

  errorCodeLength:
    160,

  policyVersionLength:
    120,

  correlationIdLength:
    200,

  traceIdLength:
    200,

  requestIdLength:
    200,

  metadataDepth:
    5,

  metadataKeys:
    70,

  metadataArrayLength:
    50,

  metadataStringLength:
    500,
});

// =============================================================================
// Timing / TTL policy
// =============================================================================

export const TTL_POLICY_MS = Object.freeze({
  approvalDefault:
    15 * 60 * 1000,

  approvalMin:
    30 * 1000,

  approvalMax:
    24 * 60 * 60 * 1000,

  compensationDefault:
    30 * 60 * 1000,

  compensationMin:
    60 * 1000,

  compensationMax:
    7 * 24 * 60 * 60 * 1000,

  statusCheckMinDelay:
    500,

  statusCheckMaxDelay:
    5 * 60 * 1000,
});

// =============================================================================
// Event catalogue
// =============================================================================

export const EVENT_TYPES = Object.freeze({
  VALIDATION_STARTED:
    'PAYMENT.AIRTEL.DISBURSEMENT.VALIDATION_STARTED',

  VALIDATION_COMPLETED:
    'PAYMENT.AIRTEL.DISBURSEMENT.VALIDATION_COMPLETED',

  VALIDATION_BLOCKED:
    'PAYMENT.AIRTEL.DISBURSEMENT.VALIDATION_BLOCKED',

  VALIDATION_REVIEW_REQUIRED:
    'PAYMENT.AIRTEL.DISBURSEMENT.VALIDATION_REVIEW_REQUIRED',

  APPROVAL_CREATED:
    'PAYMENT.AIRTEL.DISBURSEMENT.APPROVAL_CREATED',

  APPROVAL_SUBMITTED:
    'PAYMENT.AIRTEL.DISBURSEMENT.APPROVAL_SUBMITTED',

  APPROVAL_APPROVED:
    'PAYMENT.AIRTEL.DISBURSEMENT.APPROVAL_APPROVED',

  APPROVAL_REJECTED:
    'PAYMENT.AIRTEL.DISBURSEMENT.APPROVAL_REJECTED',

  APPROVAL_CANCELLED:
    'PAYMENT.AIRTEL.DISBURSEMENT.APPROVAL_CANCELLED',

  APPROVAL_EXPIRED:
    'PAYMENT.AIRTEL.DISBURSEMENT.APPROVAL_EXPIRED',

  APPROVAL_CONSUMED:
    'PAYMENT.AIRTEL.DISBURSEMENT.APPROVAL_CONSUMED',

  APPROVAL_EXECUTION_FAILED:
    'PAYMENT.AIRTEL.DISBURSEMENT.APPROVAL_EXECUTION_FAILED',

  CREATED:
    'PAYMENT.AIRTEL.DISBURSEMENT.CREATED',

  QUEUED:
    'PAYMENT.AIRTEL.DISBURSEMENT.QUEUED',

  EXECUTION_STARTED:
    'PAYMENT.AIRTEL.DISBURSEMENT.EXECUTION_STARTED',

  PROVIDER_ACCEPTED:
    'PAYMENT.AIRTEL.DISBURSEMENT.PROVIDER_ACCEPTED',

  PROVIDER_PENDING:
    'PAYMENT.AIRTEL.DISBURSEMENT.PROVIDER_PENDING',

  SUCCEEDED:
    'PAYMENT.AIRTEL.DISBURSEMENT.SUCCEEDED',

  FAILED:
    'PAYMENT.AIRTEL.DISBURSEMENT.FAILED',

  AMBIGUOUS:
    'PAYMENT.AIRTEL.DISBURSEMENT.AMBIGUOUS',

  RECONCILIATION_REQUIRED:
    'PAYMENT.AIRTEL.DISBURSEMENT.RECONCILIATION_REQUIRED',

  RECONCILIATION_COMPLETED:
    'PAYMENT.AIRTEL.DISBURSEMENT.RECONCILIATION_COMPLETED',

  RECONCILIATION_CONFLICT:
    'PAYMENT.AIRTEL.DISBURSEMENT.RECONCILIATION_CONFLICT',

  COMPENSATION_CASE_CREATED:
    'PAYMENT.AIRTEL.DISBURSEMENT.COMPENSATION.CASE_CREATED',

  COMPENSATION_APPROVAL_REQUIRED:
    'PAYMENT.AIRTEL.DISBURSEMENT.COMPENSATION.APPROVAL_REQUIRED',

  COMPENSATION_EXECUTION_STARTED:
    'PAYMENT.AIRTEL.DISBURSEMENT.COMPENSATION.EXECUTION_STARTED',

  COMPENSATION_COMPLETED:
    'PAYMENT.AIRTEL.DISBURSEMENT.COMPENSATION.COMPLETED',

  COMPENSATION_FAILED:
    'PAYMENT.AIRTEL.DISBURSEMENT.COMPENSATION.FAILED',

  COMPENSATION_ESCALATED:
    'PAYMENT.AIRTEL.DISBURSEMENT.COMPENSATION.ESCALATED',

  STATUS_CHECK_REQUESTED:
    'PAYMENT.AIRTEL.DISBURSEMENT.STATUS_CHECK_REQUESTED',

  STATUS_CHECK_COMPLETED:
    'PAYMENT.AIRTEL.DISBURSEMENT.STATUS_CHECK_COMPLETED',

  ESCALATED:
    'PAYMENT.AIRTEL.DISBURSEMENT.ESCALATED',
});

// =============================================================================
// Metrics catalogue
// =============================================================================

export const METRIC_NAMES = Object.freeze({
  VALIDATION_TOTAL:
    'airtel.disbursement.validation.total',

  VALIDATION_BLOCKED:
    'airtel.disbursement.validation.blocked',

  VALIDATION_REVIEW:
    'airtel.disbursement.validation.review',

  CREATED_TOTAL:
    'airtel.disbursement.created.total',

  APPROVAL_PENDING:
    'airtel.disbursement.approval.pending',

  APPROVAL_APPROVED:
    'airtel.disbursement.approval.approved',

  APPROVAL_REJECTED:
    'airtel.disbursement.approval.rejected',

  EXECUTION_TOTAL:
    'airtel.disbursement.execution.total',

  EXECUTION_SUCCESS:
    'airtel.disbursement.execution.success',

  EXECUTION_FAILURE:
    'airtel.disbursement.execution.failure',

  EXECUTION_AMBIGUOUS:
    'airtel.disbursement.execution.ambiguous',

  RECONCILIATION_TOTAL:
    'airtel.disbursement.reconciliation.total',

  RECONCILIATION_CONFLICT:
    'airtel.disbursement.reconciliation.conflict',

  COMPENSATION_CASES:
    'airtel.disbursement.compensation.cases',

  COMPENSATION_SUCCESS:
    'airtel.disbursement.compensation.success',

  COMPENSATION_FAILURE:
    'airtel.disbursement.compensation.failure',

  COMPENSATION_ESCALATED:
    'airtel.disbursement.compensation.escalated',
});

// =============================================================================
// Provider HTTP / transport semantics
// =============================================================================

export const HTTP_STATUS_CLASSES = Object.freeze({
  SUCCESS_MIN:
    200,

  SUCCESS_MAX:
    299,

  CLIENT_ERROR_MIN:
    400,

  CLIENT_ERROR_MAX:
    499,

  SERVER_ERROR_MIN:
    500,

  SERVER_ERROR_MAX:
    599,
});

export const TRANSIENT_HTTP_STATUSES = Object.freeze([
  408,
  425,
  429,
  500,
  502,
  503,
  504,
]);

export const AMBIGUOUS_HTTP_STATUSES = Object.freeze([
  408,
  502,
  504,
]);

// =============================================================================
// Approval policy defaults
// =============================================================================

export const APPROVAL_POLICY = Object.freeze({
  makerCheckerRequiredForFinancialImpact:
    true,

  makerCheckerRequiredForDisbursement:
    true,

  makerCanExecute:
    false,

  originalIdempotencyKeyRequired:
    true,

  scopeFingerprintRequired:
    true,

  reasonRequired:
    true,

  requireAtomicTransition:
    true,
});

// =============================================================================
// Safety boundaries
// =============================================================================

export const FINANCIAL_SAFETY_BOUNDARY = Object.freeze({
  providerCallsAllowedHere:
    false,

  ledgerWritesAllowedHere:
    false,

  balanceMutationAllowedHere:
    false,

  walletMutationAllowedHere:
    false,

  directSettlementAllowedHere:
    false,

  approvalAuthorizationAllowedHere:
    false,

  preserveOriginalTransactionIdentity:
    true,

  preserveOriginalIdempotencyIdentity:
    true,

  ambiguousOutcomeMayBlindRetry:
    false,

  ambiguousOutcomeMayBlindCompensate:
    false,

  localOfflineStateEqualsSettlement:
    false,

  authoritativeFinancialBoundary:
    'TITECH_FINANCIAL_CORE',
});

export const OPERATION_REQUIREMENTS = Object.freeze({
  DISBURSEMENT: Object.freeze({
    financial:
      true,

    requiresBeneficiary:
      true,

    requiresReference:
      true,

    requiresOriginalIdempotencyKey:
      true,

    requiresApprovalByPolicy:
      true,

    requiresFinancialCore:
      true,
  }),

  REFUND: Object.freeze({
    financial:
      true,

    requiresBeneficiary:
      false,

    requiresReference:
      true,

    requiresOriginalIdempotencyKey:
      true,

    requiresApprovalByPolicy:
      true,

    requiresFinancialCore:
      true,
  }),

  REVERSAL: Object.freeze({
    financial:
      true,

    requiresBeneficiary:
      false,

    requiresReference:
      true,

    requiresOriginalIdempotencyKey:
      true,

    requiresApprovalByPolicy:
      true,

    requiresFinancialCore:
      true,
  }),
});

// =============================================================================
// Compatibility aliases retained for existing implementations
// =============================================================================

export const PROVIDER_CODE =
  PROVIDER;

export const PROVIDER_NAME =
  PROVIDER;

export const DEFAULT_PROVIDER =
  PROVIDER;

export const DISBURSEMENT_OPERATION =
  OPERATION;

export const AIRTEL_OPERATION =
  OPERATION;

export const AIRTEL_PROVIDER =
  PROVIDER;

export const AIRTEL_STATUS_OPERATION =
  STATUS_OPERATION;

export const AIRTEL_COMPENSATION_OPERATION =
  COMPENSATION_OPERATION;

export const PAYMENT_STATES =
  DISBURSEMENT_STATES;

export const PAYMENT_STATUS =
  DISBURSEMENT_STATES;

export const TRANSACTION_STATES =
  DISBURSEMENT_STATES;

export const TRANSACTION_STATUS =
  DISBURSEMENT_STATES;

export const APPROVAL_REQUIRED =
  APPROVAL_POLICY
    .makerCheckerRequiredForDisbursement;

export const MAKER_CHECKER_REQUIRED =
  APPROVAL_POLICY
    .makerCheckerRequiredForFinancialImpact;

// =============================================================================
// Pure helpers
// =============================================================================

export const normalizeProvider = (
  value,
) => {
  const normalized =
    value === undefined ||
    value === null
      ? PROVIDER
      : String(value)
          .trim()
          .toUpperCase();

  return normalized;
};

export const normalizeOperation = (
  value,
) => {
  const normalized =
    value === undefined ||
    value === null
      ? OPERATION
      : String(value)
          .trim()
          .toUpperCase();

  return normalized;
};

export const isAirtelProvider = (
  value,
) =>
  normalizeProvider(
    value,
  ) === PROVIDER;

export const isSupportedOperation = (
  value,
) =>
  [
    OPERATION,
    OPERATIONS.REFUND,
    OPERATIONS.REVERSAL,
    OPERATIONS.STATUS,
  ].includes(
    normalizeOperation(
      value,
    ),
  );

export const normalizeState = (
  value,
) =>
  value === undefined ||
  value === null
    ? undefined
    : String(value)
        .trim()
        .toUpperCase();

export const isDisbursementStateTerminal = (
  state,
) =>
  TERMINAL_DISBURSEMENT_STATES.includes(
    normalizeState(
      state,
    ),
  );

export const isDisbursementStateActive = (
  state,
) =>
  ACTIVE_DISBURSEMENT_STATES.includes(
    normalizeState(
      state,
    ),
  );

export const canTransitionDisbursement = (
  fromState,
  toState,
) =>
  Boolean(
    ALLOWED_DISBURSEMENT_TRANSITIONS[
      normalizeState(
        fromState,
      )
    ]?.includes(
      normalizeState(
        toState,
      ),
    ),
  );

export const isCompensationStateTerminal = (
  state,
) =>
  TERMINAL_COMPENSATION_STATES.includes(
    normalizeState(
      state,
    ),
  );

export const canTransitionCompensation = (
  fromState,
  toState,
) =>
  Boolean(
    COMPENSATION_TRANSITIONS[
      normalizeState(
        fromState,
      )
    ]?.includes(
      normalizeState(
        toState,
      ),
    ),
  );

export const isApprovalStateTerminal = (
  state,
) =>
  [
    APPROVAL_STATES.REJECTED,
    APPROVAL_STATES.CANCELLED,
    APPROVAL_STATES.EXPIRED,
    APPROVAL_STATES.SUPERSEDED,
    APPROVAL_STATES.CONSUMED,
    APPROVAL_STATES.EXECUTION_FAILED,
  ].includes(
    normalizeState(
      state,
    ),
  );

export const canTransitionApproval = (
  fromState,
  toState,
) => {
  const from =
    normalizeState(
      fromState,
    );

  const to =
    normalizeState(
      toState,
    );

  const allowed = {
    [APPROVAL_STATES.DRAFT]: [
      APPROVAL_STATES.PENDING,
      APPROVAL_STATES.APPROVED,
      APPROVAL_STATES.CANCELLED,
    ],

    [APPROVAL_STATES.PENDING]: [
      APPROVAL_STATES.PENDING,
      APPROVAL_STATES.APPROVED,
      APPROVAL_STATES.REJECTED,
      APPROVAL_STATES.CANCELLED,
      APPROVAL_STATES.EXPIRED,
      APPROVAL_STATES.SUPERSEDED,
    ],

    [APPROVAL_STATES.APPROVED]: [
      APPROVAL_STATES.CONSUMED,
      APPROVAL_STATES.EXECUTION_FAILED,
      APPROVAL_STATES.CANCELLED,
      APPROVAL_STATES.SUPERSEDED,
    ],

    [APPROVAL_STATES.CONSUMED]: [
      APPROVAL_STATES.EXECUTION_FAILED,
    ],

    [APPROVAL_STATES.REJECTED]: [],
    [APPROVAL_STATES.CANCELLED]: [],
    [APPROVAL_STATES.EXPIRED]: [],
    [APPROVAL_STATES.SUPERSEDED]: [],
    [APPROVAL_STATES.EXECUTION_FAILED]: [],
  };

  return Boolean(
    allowed[from]?.includes(
      to,
    ),
  );
};

export const isAmbiguousProviderOutcome = (
  value,
) =>
  AMBIGUOUS_PROVIDER_OUTCOMES.includes(
    normalizeState(
      value,
    ),
  );

export const isProviderSuccessOutcome = (
  value,
) =>
  [
    PROVIDER_OUTCOMES.SUCCESS,
    PROVIDER_OUTCOMES.ACCEPTED,
  ].includes(
    normalizeState(
      value,
    ),
  );

export const isProviderFailureOutcome = (
  value,
) =>
  [
    PROVIDER_OUTCOMES.FAILURE,
    PROVIDER_OUTCOMES.REJECTED,
  ].includes(
    normalizeState(
      value,
    ),
  );

export const isUnsafeOfflineState = (
  state,
) =>
  UNSAFE_OFFLINE_STATES.includes(
    normalizeState(
      state,
    ),
  );

export const riskRankOf = (
  value,
) =>
  RISK_RANK[
    normalizeState(
      value,
    )
  ] ?? 0;

export const maxRiskLevel = (
  ...values
) =>
  values
    .map(
      normalizeState,
    )
    .filter(Boolean)
    .reduce(
      (
        highest,
        current,
      ) =>
        riskRankOf(
          current,
        ) >
        riskRankOf(
          highest,
        )
          ? current
          : highest,
      RISK_LEVELS.LOW,
    );

export const normalizeMinorUnitAmount = (
  value,
) => {
  if (
    value === undefined ||
    value === null
  ) {
    return undefined;
  }

  const normalized =
    String(value).trim();

  if (
    !/^\d+$/.test(
      normalized,
    )
  ) {
    return undefined;
  }

  return (
    normalized.replace(
      /^0+(?=\d)/,
      '',
    ) || '0'
  );
};

export const isPositiveMinorUnitAmount = (
  value,
) => {
  const normalized =
    normalizeMinorUnitAmount(
      value,
    );

  return (
    normalized !== undefined &&
    normalized !== '0'
  );
};

export const compareMinorUnitAmounts = (
  left,
  right,
) => {
  const a =
    normalizeMinorUnitAmount(
      left,
    );

  const b =
    normalizeMinorUnitAmount(
      right,
    );

  if (
    a === undefined ||
    b === undefined
  ) {
    return null;
  }

  if (
    a.length !==
    b.length
  ) {
    return a.length >
      b.length
      ? 1
      : -1;
  }

  if (a === b) {
    return 0;
  }

  return a > b
    ? 1
    : -1;
};

export const classifyHttpStatus = (
  status,
) => {
  const numeric =
    Number(status);

  if (
    !Number.isInteger(
      numeric,
    )
  ) {
    return 'UNKNOWN';
  }

  if (
    numeric >= 200 &&
    numeric <= 299
  ) {
    return 'SUCCESS';
  }

  if (
    numeric >= 400 &&
    numeric <= 499
  ) {
    return 'CLIENT_ERROR';
  }

  if (
    numeric >= 500 &&
    numeric <= 599
  ) {
    return 'SERVER_ERROR';
  }

  return 'OTHER';
};

export const isTransientHttpStatus = (
  status,
) =>
  TRANSIENT_HTTP_STATUSES.includes(
    Number(status),
  );

export const isAmbiguousHttpStatus = (
  status,
) =>
  AMBIGUOUS_HTTP_STATUSES.includes(
    Number(status),
  );

export const classifyProviderOutcome = (
  input = {},
) => {
  const status =
    normalizeState(
      input.outcome ??
        input.providerOutcome ??
        input.status,
    );

  if (
    isProviderSuccessOutcome(
      status,
    )
  ) {
    return (
      PROVIDER_RESULT_CATEGORIES
        .TERMINAL_SUCCESS
    );
  }

  if (
    isProviderFailureOutcome(
      status,
    )
  ) {
    return (
      PROVIDER_RESULT_CATEGORIES
        .TERMINAL_FAILURE
    );
  }

  if (
    [
      PROVIDER_OUTCOMES.ACCEPTED,
      PROVIDER_OUTCOMES.PENDING,
    ].includes(
      status,
    )
  ) {
    return (
      PROVIDER_RESULT_CATEGORIES
        .ACCEPTED_PENDING
    );
  }

  if (
    isAmbiguousProviderOutcome(
      status,
    ) ||
    isAmbiguousHttpStatus(
      input.httpStatus,
    )
  ) {
    return (
      PROVIDER_RESULT_CATEGORIES
        .AMBIGUOUS
    );
  }

  return (
    PROVIDER_RESULT_CATEGORIES
      .UNKNOWN
  );
};

export const normalizeCorrelationContext = (
  input = {},
) => ({
  requestId:
    input.requestId ===
    undefined
      ? undefined
      : String(
          input.requestId,
        )
          .trim()
          .slice(
            0,
            LIMITS.requestIdLength,
          ),

  correlationId:
    input.correlationId ===
    undefined
      ? undefined
      : String(
          input.correlationId,
        )
          .trim()
          .slice(
            0,
            LIMITS.correlationIdLength,
          ),

  traceId:
    input.traceId ===
    undefined
      ? undefined
      : String(
          input.traceId,
        )
          .trim()
          .slice(
            0,
            LIMITS.traceIdLength,
          ),
});

export const getOperationRequirements = (
  operation =
    OPERATION,
) =>
  OPERATION_REQUIREMENTS[
    normalizeOperation(
      operation,
    )
  ] ?? null;

export const buildProviderScope = (
  tenantId,
) => ({
  tenantId:
    tenantId ===
      undefined ||
    tenantId === null
      ? undefined
      : String(
          tenantId,
        )
          .trim()
          .slice(
            0,
            LIMITS.tenantIdLength,
          ),

  provider:
    PROVIDER,

  operation:
    OPERATION,
});

// =============================================================================
// Immutable contract envelope
// =============================================================================

export const CONTRACT = Object.freeze({
  moduleName:
    MODULE_NAME,

  engineName:
    ENGINE_NAME,

  engineVersion:
    ENGINE_VERSION,

  schemaVersion:
    SCHEMA_VERSION,

  provider:
    PROVIDER,

  operation:
    OPERATION,

  compensationOperation:
    COMPENSATION_OPERATION,

  statusOperation:
    STATUS_OPERATION,

  financialSafety:
    FINANCIAL_SAFETY_BOUNDARY,

  moneyPolicy:
    MONEY_POLICY,

  approvalPolicy:
    APPROVAL_POLICY,
});

export const CONSTANTS = Object.freeze({
  MODULE_NAME,
  ENGINE_NAME,
  ENGINE_VERSION,
  SCHEMA_VERSION,
  COMPONENT,
  PROVIDER,
  OPERATION,
  COMPENSATION_OPERATION,
  STATUS_OPERATION,
});

export const constants =
  CONSTANTS;

export default CONSTANTS;