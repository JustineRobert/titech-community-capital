'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Golden Money Path Service
 * ============================================================================
 *
 * File:
 *   backend/modules/payment/goldenMoneyPathService.js
 *
 * Purpose:
 *   Implements the canonical, production-grade "Golden Money Path" for
 *   financially material payment operations.
 *
 * Golden Money Path
 * ----------------------------------------------------------------------------
 *
 *   MEMBER / CLIENT
 *        |
 *        v
 *   API / CONTROLLER
 *        |
 *        +--> Authentication
 *        +--> Tenant Resolution
 *        +--> Authorization
 *        +--> Idempotency
 *        +--> Request Validation
 *        |
 *        v
 *   GOLDEN MONEY PATH SERVICE
 *        |
 *        +--> Payment Creation
 *        |
 *        +--> Payment State Machine
 *        |
 *        +--> Provider Adapter
 *        |
 *        +--> Provider Verification
 *        |
 *        +--> Payment Completion
 *        |
 *        +--> Financial Transaction Creation/Post
 *        |
 *        +--> Ledger / Posting Engine
 *        |
 *        +--> Audit / Outbox
 *        |
 *        +--> Settlement / Reconciliation
 *        |
 *        v
 *   AUTHORITATIVE FINANCIAL STATE
 *
 * Core Principle
 * ----------------------------------------------------------------------------
 * The Golden Money Path is the smallest safe production path by which external
 * money becomes an authoritative financial transaction inside TITech.
 *
 * A provider "success" response is NOT equivalent to:
 *
 *   - ledger posting
 *   - account balance mutation
 *   - settlement
 *   - reconciliation completion
 *
 * The Golden Money Path coordinates these boundaries explicitly.
 *
 * Non-Negotiable Rules
 * ----------------------------------------------------------------------------
 * 1. Every financial operation has a stable business identity.
 * 2. Every externally repeatable operation has idempotency protection.
 * 3. Payment state changes only through PaymentStateMachine.
 * 4. Provider execution remains behind PaymentProviderInterface.
 * 5. Provider evidence is verified before financial posting.
 * 6. Unknown provider outcomes never become automatic failures.
 * 7. Unknown outcomes are reconciled rather than duplicated.
 * 8. Amount and currency mismatches fail closed.
 * 9. Financial posting is idempotent.
 * 10. No direct account balance mutation occurs here.
 * 11. Reversals are compensating operations, never edits to history.
 * 12. Tenant scope is enforced throughout the workflow.
 * 13. Concurrency is controlled through versioned state/idempotency records.
 * 14. Audit/outbox events are produced only after authoritative commits.
 * 15. Provider credentials and raw sensitive payloads are never logged.
 *
 * Scope
 * ----------------------------------------------------------------------------
 * Supported canonical money paths include:
 *
 *   - Contributions
 *   - Loan repayments
 *   - Loan disbursements
 *   - Withdrawals
 *   - Transfers
 *   - Refunds
 *   - Fees
 *
 * This service is deliberately orchestration-focused.
 *
 * It does NOT directly implement:
 *
 *   - MTN MoMo authentication
 *   - Airtel Money authentication
 *   - Provider HTTP details
 *   - Callback signature verification
 *   - Ledger journal balancing
 *   - Account balance arithmetic
 *   - Settlement matching algorithms
 *
 * Those concerns belong to their respective domain services.
 *
 * ============================================================================
 */

const crypto = require('crypto');

const PaymentStateMachineModule =
  require('./paymentStateMachine');

const PaymentProcessingServiceModule =
  require('./paymentProcessingService');

const PaymentIdempotencyServiceModule =
  require('./paymentIdempotencyService');

const PaymentVerificationServiceModule =
  require('./paymentVerificationService');

/* ============================================================================
 * Resolve Constructors
 * ========================================================================== */

const PaymentStateMachine =
  PaymentStateMachineModule.PaymentStateMachine ||
  PaymentStateMachineModule;

const PaymentProcessingService =
  PaymentProcessingServiceModule.PaymentProcessingService ||
  PaymentProcessingServiceModule;

const PaymentIdempotencyService =
  PaymentIdempotencyServiceModule.PaymentIdempotencyService ||
  PaymentIdempotencyServiceModule;

const PaymentVerificationService =
  PaymentVerificationServiceModule.PaymentVerificationService ||
  PaymentVerificationServiceModule;

/* ============================================================================
 * Constants
 * ========================================================================== */

const PAYMENT_STATES =
  PaymentStateMachineModule.PAYMENT_STATES ||
  PaymentStateMachineModule.STATES ||
  PaymentStateMachine.PAYMENT_STATES ||
  Object.freeze({
    INITIATED: 'INITIATED',
    PENDING: 'PENDING',
    PROCESSING: 'PROCESSING',
    SUCCESSFUL: 'SUCCESSFUL',
    FAILED: 'FAILED',
    CANCELLED: 'CANCELLED',
    REVERSED: 'REVERSED',
    RETRYING: 'RETRYING',
    UNKNOWN: 'UNKNOWN',
    REQUIRES_RECONCILIATION: 'REQUIRES_RECONCILIATION',
    EXPIRED: 'EXPIRED',
    DEAD_LETTER: 'DEAD_LETTER',
  });

const IDEMPOTENCY_STATUS =
  PaymentIdempotencyServiceModule.PAYMENT_IDEMPOTENCY_STATUS ||
  PaymentIdempotencyService.STATUS ||
  Object.freeze({
    RESERVED: 'RESERVED',
    PROCESSING: 'PROCESSING',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    UNKNOWN: 'UNKNOWN',
    EXPIRED: 'EXPIRED',
    RELEASED: 'RELEASED',
  });

const IDEMPOTENCY_OPERATION_TYPES =
  PaymentIdempotencyServiceModule.PAYMENT_IDEMPOTENCY_OPERATION_TYPES ||
  PaymentIdempotencyService.OPERATION_TYPES ||
  Object.freeze({
    PAYMENT_PROCESS: 'PAYMENT_PROCESS',
    FINANCIAL_POSTING: 'FINANCIAL_POSTING',
    PAYMENT_CALLBACK: 'PAYMENT_CALLBACK',
    RECONCILIATION_REPAIR: 'RECONCILIATION_REPAIR',
  });

const VERIFICATION_STATUS =
  PaymentVerificationServiceModule.PAYMENT_VERIFICATION_STATUS ||
  PaymentVerificationService.STATUS ||
  Object.freeze({
    VERIFIED: 'VERIFIED',
    REJECTED: 'REJECTED',
    PENDING: 'PENDING',
    UNKNOWN: 'UNKNOWN',
    REQUIRES_RECONCILIATION: 'REQUIRES_RECONCILIATION',
  });

const VERIFICATION_OUTCOMES =
  PaymentVerificationServiceModule.PAYMENT_VERIFICATION_OUTCOMES ||
  PaymentVerificationService.OUTCOMES ||
  Object.freeze({
    SUCCESS: 'SUCCESS',
    FAILED: 'FAILED',
    PENDING: 'PENDING',
    CANCELLED: 'CANCELLED',
    REVERSED: 'REVERSED',
    UNKNOWN: 'UNKNOWN',
  });

const GOLDEN_MONEY_PATH_STAGES = Object.freeze({
  VALIDATION: 'VALIDATION',
  IDEMPOTENCY: 'IDEMPOTENCY',
  PAYMENT_CREATION: 'PAYMENT_CREATION',
  PAYMENT_PROCESSING: 'PAYMENT_PROCESSING',
  PROVIDER_EXECUTION: 'PROVIDER_EXECUTION',
  PROVIDER_VERIFICATION: 'PROVIDER_VERIFICATION',
  FINANCIAL_POSTING: 'FINANCIAL_POSTING',
  LEDGER_COMMIT: 'LEDGER_COMMIT',
  COMPLETION: 'COMPLETION',
  AUDIT: 'AUDIT',
  OUTBOX: 'OUTBOX',
  SETTLEMENT: 'SETTLEMENT',
  RECONCILIATION: 'RECONCILIATION',
});

const GOLDEN_MONEY_PATH_OUTCOMES = Object.freeze({
  SUCCESS: 'SUCCESS',
  PENDING: 'PENDING',
  FAILED: 'FAILED',
  UNKNOWN: 'UNKNOWN',
  REQUIRES_RECONCILIATION: 'REQUIRES_RECONCILIATION',
});

const GOLDEN_MONEY_PATH_ERROR_CODES = Object.freeze({
  INVALID_REQUEST:
    'GOLDEN_MONEY_PATH_INVALID_REQUEST',

  TENANT_REQUIRED:
    'GOLDEN_MONEY_PATH_TENANT_REQUIRED',

  ACTOR_REQUIRED:
    'GOLDEN_MONEY_PATH_ACTOR_REQUIRED',

  IDEMPOTENCY_REQUIRED:
    'GOLDEN_MONEY_PATH_IDEMPOTENCY_REQUIRED',

  PAYMENT_CREATION_FAILED:
    'GOLDEN_MONEY_PATH_PAYMENT_CREATION_FAILED',

  PAYMENT_PROCESSING_FAILED:
    'GOLDEN_MONEY_PATH_PAYMENT_PROCESSING_FAILED',

  PAYMENT_NOT_FOUND:
    'GOLDEN_MONEY_PATH_PAYMENT_NOT_FOUND',

  PROVIDER_FAILED:
    'GOLDEN_MONEY_PATH_PROVIDER_FAILED',

  PROVIDER_UNKNOWN:
    'GOLDEN_MONEY_PATH_PROVIDER_UNKNOWN',

  VERIFICATION_FAILED:
    'GOLDEN_MONEY_PATH_VERIFICATION_FAILED',

  AMOUNT_MISMATCH:
    'GOLDEN_MONEY_PATH_AMOUNT_MISMATCH',

  CURRENCY_MISMATCH:
    'GOLDEN_MONEY_PATH_CURRENCY_MISMATCH',

  FINANCIAL_POSTING_FAILED:
    'GOLDEN_MONEY_PATH_FINANCIAL_POSTING_FAILED',

  FINANCIAL_POSTING_UNKNOWN:
    'GOLDEN_MONEY_PATH_FINANCIAL_POSTING_UNKNOWN',

  FINANCIAL_TRANSACTION_REQUIRED:
    'GOLDEN_MONEY_PATH_FINANCIAL_TRANSACTION_REQUIRED',

  LEDGER_NOT_POSTED:
    'GOLDEN_MONEY_PATH_LEDGER_NOT_POSTED',

  RECONCILIATION_REQUIRED:
    'GOLDEN_MONEY_PATH_RECONCILIATION_REQUIRED',

  CONCURRENT_UPDATE:
    'GOLDEN_MONEY_PATH_CONCURRENT_UPDATE',

  IDEMPOTENCY_CONFLICT:
    'GOLDEN_MONEY_PATH_IDEMPOTENCY_CONFLICT',

  ALREADY_COMPLETED:
    'GOLDEN_MONEY_PATH_ALREADY_COMPLETED',

  ALREADY_REVERSED:
    'GOLDEN_MONEY_PATH_ALREADY_REVERSED',

  UNSUPPORTED_OPERATION:
    'GOLDEN_MONEY_PATH_UNSUPPORTED_OPERATION',

  CONFIGURATION_ERROR:
    'GOLDEN_MONEY_PATH_CONFIGURATION_ERROR',
});

const DEFAULT_OPTIONS = Object.freeze({
  strictMode: true,

  requireTenant: true,

  requireActor: true,

  requireIdempotencyKey: true,

  /**
   * Inbound provider success must pass verification before financial posting.
   */
  requireProviderVerification: true,

  /**
   * A successful payment may exist while financial posting is asynchronous.
   * The returned outcome makes that distinction explicit.
   */
  allowAsynchronousFinancialPosting: true,

  /**
   * When false, execute() waits until finance confirms the posting operation.
   * Even then, it never edits ledger records directly.
   */
  requireLedgerPostBeforeSuccessResponse: false,

  /**
   * An UNKNOWN provider result must never be retried as a new external
   * financial operation.
   */
  neverDuplicateUnknownProviderOperation: true,

  /**
   * Enable reconciliation handoff for ambiguous external or financial states.
   */
  enableReconciliationHandoff: true,

  /**
   * Perform settlement as a separate downstream operation.
   */
  autoInitiateSettlement: false,

  /**
   * Provider operations should be executed outside long-lived database
   * transactions.
   */
  providerCallOutsideDatabaseTransaction: true,

  /**
   * Include a path execution trace in responses/logging.
   */
  includePathTrace: true,

  /**
   * Do not expose raw provider responses to API consumers.
   */
  sanitizeProviderResults: true,
});

/* ============================================================================
 * Error
 * ========================================================================== */

class GoldenMoneyPathError extends Error {
  constructor(message, options = {}) {
    super(message);

    this.name =
      'GoldenMoneyPathError';

    this.code =
      options.code ||
      GOLDEN_MONEY_PATH_ERROR_CODES.INVALID_REQUEST;

    this.statusCode =
      Number.isInteger(options.statusCode)
        ? options.statusCode
        : 400;

    this.stage =
      options.stage || null;

    this.paymentId =
      options.paymentId || null;

    this.tenantId =
      options.tenantId || null;

    this.operationId =
      options.operationId || null;

    this.correlationId =
      options.correlationId || null;

    this.retryable =
      options.retryable === true;

    this.unknownOutcome =
      options.unknownOutcome === true;

    this.reconciliationRequired =
      options.reconciliationRequired === true;

    this.details =
      options.details || {};

    if (options.cause) {
      this.cause = options.cause;
    }

    Error.captureStackTrace?.(
      this,
      GoldenMoneyPathError,
    );
  }
}

/* ============================================================================
 * Utility Functions
 * ========================================================================== */

function isNonEmptyString(value) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0
  );
}

function normalizeString(value) {
  return isNonEmptyString(value)
    ? value.trim()
    : null;
}

function safeId(value) {
  if (
    value &&
    typeof value.toString === 'function'
  ) {
    return value.toString();
  }

  return normalizeString(value);
}

function normalizeProvider(value) {
  const provider = normalizeString(value);

  return provider
    ? provider.toLowerCase()
    : null;
}

function normalizeType(value) {
  const type = normalizeString(value);

  return type
    ? type.toLowerCase()
    : null;
}

function normalizeDirection(value) {
  const direction = normalizeString(value);

  return direction
    ? direction.toLowerCase()
    : null;
}

function normalizeAmount(value) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number'
  ) {
    return String(value);
  }

  if (
    value &&
    typeof value.toString === 'function'
  ) {
    return value.toString();
  }

  return null;
}

function canonicalAmount(value) {
  const amount = normalizeAmount(value);

  if (!amount) {
    return null;
  }

  const trimmed = amount.trim();

  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return null;
  }

  const parts = trimmed.split('.');

  const integerPart =
    parts[0].replace(
      /^0+(?=\d)/,
      '',
    );

  const decimalPart =
    parts[1]
      ? parts[1].replace(/0+$/, '')
      : '';

  return decimalPart
    ? `${integerPart}.${decimalPart}`
    : integerPart;
}

function canonicalCurrency(value) {
  const currency = normalizeString(value);

  return currency
    ? currency.toUpperCase()
    : null;
}

function clone(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return value;
  }

  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch (_error) {
      // Fall through.
    }
  }

  try {
    return JSON.parse(
      JSON.stringify(value),
    );
  } catch (_error) {
    return value;
  }
}

function stableStringify(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return String(value);
  }

  if (
    typeof value !== 'object'
  ) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value
      .map(stableStringify)
      .join(',')}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(
          key,
        )}:${stableStringify(
          value[key],
        )}`,
    )
    .join(',')}}`;
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(
      typeof value === 'string'
        ? value
        : stableStringify(value),
    )
    .digest('hex');
}

function createOperationId() {
  return `gmp_${crypto.randomUUID()}`;
}

function createPathTraceId() {
  return `gmp_trace_${crypto.randomUUID()}`;
}

function now() {
  return new Date();
}

function isoNow() {
  return now().toISOString();
}

function parseVersion(value) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }

  const parsed = Number(value);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 0
  ) {
    return null;
  }

  return parsed;
}

/* ============================================================================
 * Golden Money Path Service
 * ========================================================================== */

class GoldenMoneyPathService {
  /**
   * @param {Object} dependencies
   *
   * Core dependencies:
   *   paymentRepository
   *   paymentStateMachine
   *   paymentProcessingService
   *   paymentIdempotencyService
   *   paymentVerificationService
   *
   * Financial:
   *   financialService
   *   transactionService
   *   financeService
   *
   * Operational:
   *   reconciliationService
   *   settlementService
   *   auditService
   *   eventPublisher
   *   metrics
   *   logger
   *
   * Controls:
   *   riskService
   *   complianceService
   *   limitService
   */
  constructor(
    dependencies = {},
  ) {
    this.paymentRepository =
      dependencies.paymentRepository || null;

    this.paymentStateMachine =
      dependencies.paymentStateMachine ||
      new PaymentStateMachine({
        paymentRepository:
          this.paymentRepository,

        auditService:
          dependencies.auditService,

        eventPublisher:
          dependencies.eventPublisher,

        logger:
          dependencies.logger || console,

        options:
          dependencies.paymentStateMachineOptions ||
          {},
      });

    this.paymentIdempotencyService =
      dependencies.paymentIdempotencyService ||
      new PaymentIdempotencyService({
        repository:
          dependencies.idempotencyRepository,

        auditService:
          dependencies.auditService,

        metrics:
          dependencies.metrics,

        logger:
          dependencies.logger || console,

        options:
          dependencies.idempotencyOptions ||
          {},
      });

    this.paymentVerificationService =
      dependencies.paymentVerificationService ||
      new PaymentVerificationService({
        paymentRepository:
          this.paymentRepository,

        paymentStateMachine:
          this.paymentStateMachine,

        providerRegistry:
          dependencies.providerRegistry ||
          dependencies.paymentProviderRegistry,

        reconciliationService:
          dependencies.reconciliationService,

        evidenceRepository:
          dependencies.verificationEvidenceRepository,

        auditService:
          dependencies.auditService,

        metrics:
          dependencies.metrics,

        logger:
          dependencies.logger || console,

        options:
          dependencies.paymentVerificationOptions ||
          {},
      });

    this.paymentProcessingService =
      dependencies.paymentProcessingService ||
      new PaymentProcessingService({
        paymentRepository:
          this.paymentRepository,

        paymentStateMachine:
          this.paymentStateMachine,

        providerRegistry:
          dependencies.providerRegistry ||
          dependencies.paymentProviderRegistry,

        financialService:
          dependencies.financialService ||
          dependencies.transactionService ||
          dependencies.financeService,

        reconciliationService:
          dependencies.reconciliationService,

        auditService:
          dependencies.auditService,

        eventPublisher:
          dependencies.eventPublisher,

        riskService:
          dependencies.riskService,

        complianceService:
          dependencies.complianceService,

        limitService:
          dependencies.limitService,

        notificationService:
          dependencies.notificationService,

        logger:
          dependencies.logger || console,

        options:
          dependencies.paymentProcessingOptions ||
          {},
      });

    this.financialService =
      dependencies.financialService ||
      dependencies.transactionService ||
      dependencies.financeService ||
      null;

    this.reconciliationService =
      dependencies.reconciliationService ||
      null;

    this.settlementService =
      dependencies.settlementService ||
      null;

    this.auditService =
      dependencies.auditService ||
      null;

    this.eventPublisher =
      dependencies.eventPublisher ||
      null;

    this.riskService =
      dependencies.riskService ||
      null;

    this.complianceService =
      dependencies.complianceService ||
      null;

    this.limitService =
      dependencies.limitService ||
      null;

    this.metrics =
      dependencies.metrics ||
      null;

    this.logger =
      dependencies.logger ||
      console;

    this.options = Object.freeze({
      ...DEFAULT_OPTIONS,
      ...(dependencies.options || {}),
    });
  }

  /* ==========================================================================
   * Public API — Execute Golden Money Path
   * ======================================================================== */

  /**
   * Execute the canonical money path.
   *
   * This method can be used for:
   *
   *   - member contribution
   *   - loan repayment
   *   - loan disbursement
   *   - withdrawal
   *   - transfer
   *   - refund
   *   - fee collection
   *
   * Request example:
   *
   * {
   *   tenantId,
   *   userId,
   *   groupId,
   *   loanId,
   *   amount: "10000",
   *   currency: "UGX",
   *   type: "contribution",
   *   direction: "inbound",
   *   provider: "mtn",
   *   phoneNumber: "+256...",
   *   idempotencyKey: "..."
   * }
   */
  async execute(
    request = {},
    rawContext = {},
  ) {
    const context =
      this._buildContext(
        rawContext,
      );

    const trace = this._createTrace(
      context,
    );

    this._assertContext(
      context,
    );

    const normalizedRequest =
      this._normalizeRequest(
        request,
        context,
      );

    this._recordStage(
      trace,
      GOLDEN_MONEY_PATH_STAGES.VALIDATION,
      'STARTED',
    );

    this._validateRequest(
      normalizedRequest,
      context,
    );

    this._recordStage(
      trace,
      GOLDEN_MONEY_PATH_STAGES.VALIDATION,
      'COMPLETED',
    );

    /* ------------------------------------------------------------------------
     * Stage 1 — Idempotency Reservation
     * ---------------------------------------------------------------------- */

    this._recordStage(
      trace,
      GOLDEN_MONEY_PATH_STAGES.IDEMPOTENCY,
      'STARTED',
    );

    const idempotency =
      await this._reserveOperation(
        normalizedRequest,
        context,
      );

    this._recordStage(
      trace,
      GOLDEN_MONEY_PATH_STAGES.IDEMPOTENCY,
      'COMPLETED',
      {
        operationId:
          idempotency.operationId,

        replay:
          idempotency.replay === true,
      },
    );

    /**
     * A completed idempotent request must return its original authoritative
     * result rather than creating another payment.
     */
    if (
      idempotency.completed
      && idempotency.result
    ) {
      return this._finalizeResponse(
        {
          outcome:
            GOLDEN_MONEY_PATH_OUTCOMES.SUCCESS,

          idempotentReplay:
            true,

          paymentId:
            idempotency.paymentId,

          payment:
            idempotency.result.payment
            || null,

          provider:
            idempotency.result.provider
            || null,

          financial:
            idempotency.result.financial
            || null,
        },
        context,
        trace,
      );
    }

    /* ------------------------------------------------------------------------
     * Stage 2 — Payment Creation
     * ---------------------------------------------------------------------- */

    this._recordStage(
      trace,
      GOLDEN_MONEY_PATH_STAGES.PAYMENT_CREATION,
      'STARTED',
    );

    let payment;

    try {
      payment =
        await this._getOrCreatePayment(
          normalizedRequest,
          context,
        );
    } catch (error) {
      await this._handleOperationFailure(
        idempotency,
        error,
        context,
        trace,
        GOLDEN_MONEY_PATH_STAGES.PAYMENT_CREATION,
      );

      throw this._wrapError(
        error,
        {
          code:
            GOLDEN_MONEY_PATH_ERROR_CODES
              .PAYMENT_CREATION_FAILED,

          stage:
            GOLDEN_MONEY_PATH_STAGES
              .PAYMENT_CREATION,

          context,
        },
      );
    }

    this._recordStage(
      trace,
      GOLDEN_MONEY_PATH_STAGES.PAYMENT_CREATION,
      'COMPLETED',
      {
        paymentId:
          payment.id,
      },
    );

    /* ------------------------------------------------------------------------
     * Stage 3 — Payment Processing / Provider Execution
     * ---------------------------------------------------------------------- */

    this._recordStage(
      trace,
      GOLDEN_MONEY_PATH_STAGES.PAYMENT_PROCESSING,
      'STARTED',
    );

    let processingResult;

    try {
      processingResult =
        await this._processPayment(
          payment,
          normalizedRequest,
          context,
          trace,
        );
    } catch (error) {
      await this._handleOperationFailure(
        idempotency,
        error,
        context,
        trace,
        GOLDEN_MONEY_PATH_STAGES
          .PAYMENT_PROCESSING,
      );

      throw this._wrapError(
        error,
        {
          code:
            GOLDEN_MONEY_PATH_ERROR_CODES
              .PAYMENT_PROCESSING_FAILED,

          stage:
            GOLDEN_MONEY_PATH_STAGES
              .PAYMENT_PROCESSING,

          paymentId:
            payment.id,

          context,
        },
      );
    }

    this._recordStage(
      trace,
      GOLDEN_MONEY_PATH_STAGES.PAYMENT_PROCESSING,
      'COMPLETED',
      {
        outcome:
          processingResult.outcome,
      },
    );

    /* ------------------------------------------------------------------------
     * Stage 4 — Provider / Payment Outcome Classification
     * ---------------------------------------------------------------------- */

    if (
      processingResult.outcome
      === GOLDEN_MONEY_PATH_OUTCOMES
        .PENDING
    ) {
      return this._completePendingPath(
        payment,
        processingResult,
        idempotency,
        context,
        trace,
      );
    }

    if (
      processingResult.outcome
      === GOLDEN_MONEY_PATH_OUTCOMES
        .FAILED
    ) {
      await this.paymentIdempotencyService.fail(
        idempotency.operationId,
        new Error(
          processingResult.message ||
          'Payment provider rejected the operation.',
        ),
        {
          paymentId:
            payment.id,

          reasonCode:
            processingResult.reasonCode ||
            'PAYMENT_PROVIDER_FAILED',

          retryable:
            processingResult.retryable === true,
        },
      );

      return this._finalizeResponse(
        processingResult,
        context,
        trace,
      );
    }

    if (
      processingResult.outcome
      === GOLDEN_MONEY_PATH_OUTCOMES
        .UNKNOWN
    ) {
      return this._completeUnknownPath(
        payment,
        processingResult,
        idempotency,
        context,
        trace,
      );
    }

    if (
      processingResult.outcome
      === GOLDEN_MONEY_PATH_OUTCOMES
        .REQUIRES_RECONCILIATION
    ) {
      return this._completeReconciliationPath(
        payment,
        processingResult,
        idempotency,
        context,
        trace,
      );
    }

    /* ------------------------------------------------------------------------
     * Stage 5 — Provider Verification
     * ---------------------------------------------------------------------- */

    this._recordStage(
      trace,
      GOLDEN_MONEY_PATH_STAGES.PROVIDER_VERIFICATION,
      'STARTED',
    );

    let verification;

    try {
      verification =
        await this._verifyProviderOutcome(
          payment,
          processingResult,
          context,
        );
    } catch (error) {
      await this._handleOperationFailure(
        idempotency,
        error,
        context,
        trace,
        GOLDEN_MONEY_PATH_STAGES
          .PROVIDER_VERIFICATION,
      );

      throw this._wrapError(
        error,
        {
          code:
            GOLDEN_MONEY_PATH_ERROR_CODES
              .VERIFICATION_FAILED,

          stage:
            GOLDEN_MONEY_PATH_STAGES
              .PROVIDER_VERIFICATION,

          paymentId:
            payment.id,

          context,
        },
      );
    }

    this._recordStage(
      trace,
      GOLDEN_MONEY_PATH_STAGES.PROVIDER_VERIFICATION,
      'COMPLETED',
      {
        verificationStatus:
          verification.status,
      },
    );

    if (
      verification.status
      === VERIFICATION_STATUS.REQUIRES_RECONCILIATION
      || verification.status
      === VERIFICATION_STATUS.UNKNOWN
    ) {
      return this._completeReconciliationPath(
        payment,
        {
          ...processingResult,

          verification,
        },
        idempotency,
        context,
        trace,
      );
    }

    if (
      verification.status
      !== VERIFICATION_STATUS.VERIFIED
    ) {
      await this._handleOperationFailure(
        idempotency,
        new GoldenMoneyPathError(
          'Provider verification failed.',
          {
            code:
              GOLDEN_MONEY_PATH_ERROR_CODES
                .VERIFICATION_FAILED,

            stage:
              GOLDEN_MONEY_PATH_STAGES
                .PROVIDER_VERIFICATION,

            paymentId:
              payment.id,

            tenantId:
              context.tenantId,
          },
        ),
        context,
        trace,
        GOLDEN_MONEY_PATH_STAGES
          .PROVIDER_VERIFICATION,
      );

      throw new GoldenMoneyPathError(
        'Payment provider verification failed.',
        {
          code:
            GOLDEN_MONEY_PATH_ERROR_CODES
              .VERIFICATION_FAILED,

          statusCode:
            409,

          stage:
            GOLDEN_MONEY_PATH_STAGES
              .PROVIDER_VERIFICATION,

          paymentId:
            payment.id,

          tenantId:
            context.tenantId,

          details: {
            failedChecks:
              verification.failedChecks,
          },
        },
      );
    }

    /* ------------------------------------------------------------------------
     * Stage 6 — Financial Posting
     * ---------------------------------------------------------------------- */

    this._recordStage(
      trace,
      GOLDEN_MONEY_PATH_STAGES.FINANCIAL_POSTING,
      'STARTED',
    );

    let financialResult;

    try {
      financialResult =
        await this._postFinancialEffect(
          payment,
          processingResult,
          verification,
          normalizedRequest,
          context,
        );
    } catch (error) {
      return this._handleFinancialPostingFailure(
        payment,
        processingResult,
        verification,
        idempotency,
        error,
        context,
        trace,
      );
    }

    this._recordStage(
      trace,
      GOLDEN_MONEY_PATH_STAGES.FINANCIAL_POSTING,
      'COMPLETED',
      {
        status:
          financialResult.status,

        posted:
          financialResult.posted === true,

        financialTransactionId:
          financialResult.financialTransactionId,
      },
    );

    /* ------------------------------------------------------------------------
     * Stage 7 — Ledger Commit Verification
     * ---------------------------------------------------------------------- */

    this._recordStage(
      trace,
      GOLDEN_MONEY_PATH_STAGES.LEDGER_COMMIT,
      'STARTED',
    );

    let ledgerResult;

    try {
      ledgerResult =
        await this._verifyLedgerCommit(
          payment,
          financialResult,
          context,
        );
    } catch (error) {
      return this._handleFinancialPostingFailure(
        payment,
        processingResult,
        verification,
        idempotency,
        error,
        context,
        trace,
      );
    }

    this._recordStage(
      trace,
      GOLDEN_MONEY_PATH_STAGES.LEDGER_COMMIT,
      'COMPLETED',
      {
        posted:
          ledgerResult.posted === true,

        journalId:
          ledgerResult.journalId,
      },
    );

    if (
      !ledgerResult.posted
      && this.options.requireLedgerPostBeforeSuccessResponse
    ) {
      return this._completeReconciliationPath(
        payment,
        {
          ...processingResult,

          verification,

          financial:
            financialResult,

          ledger:
            ledgerResult,
        },
        idempotency,
        context,
        trace,
      );
    }

    /* ------------------------------------------------------------------------
     * Stage 8 — Completion / Idempotency
     * ---------------------------------------------------------------------- */

    this._recordStage(
      trace,
      GOLDEN_MONEY_PATH_STAGES.COMPLETION,
      'STARTED',
    );

    const completedResult =
      await this._completeSuccessfulOperation(
        payment,
        processingResult,
        verification,
        financialResult,
        ledgerResult,
        idempotency,
        context,
        trace,
      );

    this._recordStage(
      trace,
      GOLDEN_MONEY_PATH_STAGES.COMPLETION,
      'COMPLETED',
    );

    /* ------------------------------------------------------------------------
     * Stage 9 — Optional Settlement
     * ---------------------------------------------------------------------- */

    if (
      this.options.autoInitiateSettlement
    ) {
      await this._initiateSettlement(
        payment,
        completedResult,
        context,
        trace,
      );
    }

    return this._finalizeResponse(
      completedResult,
      context,
      trace,
    );
  }

  /* ==========================================================================
   * Request Validation
   * ======================================================================== */

  _buildContext(
    rawContext,
  ) {
    const context = {
      ...rawContext,

      operationId:
        normalizeString(
          rawContext.operationId,
        ) ||
        createOperationId(),

      correlationId:
        normalizeString(
          rawContext.correlationId,
        ) ||
        `corr_${crypto.randomUUID()}`,

      requestId:
        normalizeString(
          rawContext.requestId,
        ) ||
        `req_${crypto.randomUUID()}`,

      actorType:
        normalizeString(
          rawContext.actorType,
        ) ||
        'USER',
    };

    return context;
  }

  _assertContext(
    context,
  ) {
    if (
      this.options.requireTenant
      && !normalizeString(
        context.tenantId,
      )
    ) {
      throw new GoldenMoneyPathError(
        'Tenant context is required.',
        {
          code:
            GOLDEN_MONEY_PATH_ERROR_CODES
              .TENANT_REQUIRED,

          statusCode:
            403,
        },
      );
    }

    if (
      this.options.requireActor
      && !normalizeString(
        context.actorId,
      )
    ) {
      throw new GoldenMoneyPathError(
        'Authenticated actor context is required.',
        {
          code:
            GOLDEN_MONEY_PATH_ERROR_CODES
              .ACTOR_REQUIRED,

          statusCode:
            403,

          tenantId:
            context.tenantId,
        },
      );
    }
  }

  _normalizeRequest(
    rawRequest,
    context,
  ) {
    const request = {
      tenantId:
        normalizeString(
          rawRequest.tenantId,
        ) ||
        context.tenantId,

      userId:
        normalizeString(
          rawRequest.userId,
        ),

      groupId:
        normalizeString(
          rawRequest.groupId,
        ),

      loanId:
        normalizeString(
          rawRequest.loanId,
        ),

      type:
        normalizeType(
          rawRequest.type ||
          rawRequest.paymentType,
        ),

      direction:
        normalizeDirection(
          rawRequest.direction,
        ),

      amount:
        canonicalAmount(
          rawRequest.amount,
        ),

      currency:
        canonicalCurrency(
          rawRequest.currency,
        ),

      provider:
        normalizeProvider(
          rawRequest.provider,
        ),

      paymentReference:
        normalizeString(
          rawRequest.paymentReference ||
          rawRequest.reference,
        ),

      phoneNumber:
        normalizeString(
          rawRequest.phoneNumber ||
          rawRequest.msisdn,
        ),

      accountReference:
        normalizeString(
          rawRequest.accountReference,
        ),

      customerReference:
        normalizeString(
          rawRequest.customerReference,
        ),

      narration:
        normalizeString(
          rawRequest.narration,
        ),

      idempotencyKey:
        normalizeString(
          rawRequest.idempotencyKey ||
          rawRequest['Idempotency-Key'],
        ),

      metadata:
        this._sanitizeMetadata(
          rawRequest.metadata,
        ),
    };

    return request;
  }

  _validateRequest(
    request,
    context,
  ) {
    const errors = [];

    if (
      !request.tenantId
    ) {
      errors.push(
        'tenantId is required',
      );
    }

    if (
      !request.userId
    ) {
      errors.push(
        'userId is required',
      );
    }

    if (
      !request.amount
    ) {
      errors.push(
        'amount is required',
      );
    }

    if (
      request.amount
      && !/^\d+(\.\d+)?$/.test(
        request.amount,
      )
    ) {
      errors.push(
        'amount must be a positive decimal value',
      );
    }

    if (
      request.amount
      && /^0+(\.0+)?$/.test(
        request.amount,
      )
    ) {
      errors.push(
        'amount must be greater than zero',
      );
    }

    if (
      !request.currency
    ) {
      errors.push(
        'currency is required',
      );
    }

    if (
      request.currency
      && !/^[A-Z]{3}$/.test(
        request.currency,
      )
    ) {
      errors.push(
        'currency must be a three-letter currency code',
      );
    }

    if (
      !request.type
    ) {
      errors.push(
        'payment type is required',
      );
    }

    if (
      !request.direction
    ) {
      errors.push(
        'payment direction is required',
      );
    }

    if (
      !request.provider
    ) {
      errors.push(
        'payment provider is required',
      );
    }

    if (
      this.options.requireIdempotencyKey
      && !request.idempotencyKey
    ) {
      throw new GoldenMoneyPathError(
        'Idempotency key is required for the Golden Money Path.',
        {
          code:
            GOLDEN_MONEY_PATH_ERROR_CODES
              .IDEMPOTENCY_REQUIRED,

          statusCode:
            400,

          tenantId:
            context.tenantId,
        },
      );
    }

    if (
      request.tenantId
      !== context.tenantId
    ) {
      throw new GoldenMoneyPathError(
        'Request tenant does not match authenticated tenant context.',
        {
          code:
            GOLDEN_MONEY_PATH_ERROR_CODES
              .TENANT_REQUIRED,

          statusCode:
            403,

          tenantId:
            context.tenantId,
        },
      );
    }

    if (
      errors.length
    ) {
      throw new GoldenMoneyPathError(
        'Golden Money Path request validation failed.',
        {
          code:
            GOLDEN_MONEY_PATH_ERROR_CODES
              .INVALID_REQUEST,

          statusCode:
            400,

          tenantId:
            context.tenantId,

          details: {
            errors,
          },
        },
      );
    }

    return true;
  }

  /* ==========================================================================
   * Idempotency
   * ======================================================================== */

  async _reserveOperation(
    request,
    context,
  ) {
    let result;

    try {
      result =
        await this.paymentIdempotencyService
          .reserve({
            tenantId:
              context.tenantId,

            operationType:
              IDEMPOTENCY_OPERATION_TYPES
                .PAYMENT_PROCESS,

            key:
              request.idempotencyKey,

            request: {
              tenantId:
                request.tenantId,

              userId:
                request.userId,

              groupId:
                request.groupId,

              loanId:
                request.loanId,

              type:
                request.type,

              direction:
                request.direction,

              amount:
                request.amount,

              currency:
                request.currency,

              provider:
                request.provider,

              paymentReference:
                request.paymentReference,

              accountReference:
                request.accountReference,

              customerReference:
                request.customerReference,
            },

            provider:
              request.provider,

            metadata:
              request.metadata,
          });
    } catch (error) {
      throw this._wrapError(
        error,
        {
          code:
            GOLDEN_MONEY_PATH_ERROR_CODES
              .IDEMPOTENCY_CONFLICT,

          stage:
            GOLDEN_MONEY_PATH_STAGES
              .IDEMPOTENCY,

          context,
        },
      );
    }

    return {
      ...result,

      operationId:
        result.operationId,

      completed:
        result.status
        === IDEMPOTENCY_STATUS.COMPLETED,

      result:
        result.result || null,
    };
  }

  /* ==========================================================================
   * Payment Creation
   * ======================================================================== */

  async _getOrCreatePayment(
    request,
    context,
  ) {
    /**
     * Prefer an existing payment linked to the idempotency operation.
     */
    const existing =
      await this._findExistingPayment(
        request,
        context,
      );

    if (existing) {
      return existing;
    }

    return this.paymentProcessingService
      .createAndInitiate(
        {
          ...request,

          idempotencyKey:
            request.idempotencyKey,
        },
        context,
      )
      .then(
        (result) =>
          this._resolveCreatedPayment(
            result,
            context,
          ),
      );
  }

  async _resolveCreatedPayment(
    result,
    context,
  ) {
    if (!result) {
      throw new GoldenMoneyPathError(
        'Payment creation returned no result.',
        {
          code:
            GOLDEN_MONEY_PATH_ERROR_CODES
              .PAYMENT_CREATION_FAILED,

          statusCode:
            500,

          tenantId:
            context.tenantId,
        },
      );
    }

    const payment =
      result.payment ||
      result.data ||
      result;

    if (
      payment
      && (
        payment.id
        || payment._id
      )
    ) {
      return this._normalizePayment(
        payment,
      );
    }

    const paymentId =
      safeId(
        result.paymentId ||
        payment?.paymentId,
      );

    if (
      paymentId
      && this.paymentRepository
    ) {
      return this._loadPayment(
        paymentId,
        context,
      );
    }

    throw new GoldenMoneyPathError(
      'Payment creation did not return a resolvable payment.',
      {
        code:
          GOLDEN_MONEY_PATH_ERROR_CODES
            .PAYMENT_CREATION_FAILED,

        statusCode:
          500,

        tenantId:
          context.tenantId,
      },
    );
  }

  async _findExistingPayment(
    request,
    context,
  ) {
    if (
      !this.paymentRepository
    ) {
      return null;
    }

    let payment = null;

    if (
      typeof this.paymentRepository
        .findByIdempotencyKey === 'function'
    ) {
      payment =
        await this.paymentRepository
          .findByIdempotencyKey({
            tenantId:
              context.tenantId,

            idempotencyKey:
              request.idempotencyKey,
          });
    }

    if (!payment) {
      return null;
    }

    return this._normalizePayment(
      payment,
    );
  }

  /* ==========================================================================
   * Payment Processing
   * ======================================================================== */

  async _processPayment(
    payment,
    request,
    context,
    trace,
  ) {
    const result =
      await this.paymentProcessingService
        .process(
          payment,
          {
            ...context,

            provider:
              request.provider ||
              payment.provider,

            idempotencyKey:
              request.idempotencyKey,

            reasonCode:
              'GOLDEN_MONEY_PATH_PROCESS',
          },
        );

    return this._normalizeProcessingResult(
      result,
      payment,
    );
  }

  _normalizeProcessingResult(
    result,
    payment,
  ) {
    const outcome =
      normalizeString(
        result?.outcome,
      )?.toUpperCase();

    if (
      outcome ===
      GOLDEN_MONEY_PATH_OUTCOMES.SUCCESS
    ) {
      return {
        ...result,

        outcome:
          GOLDEN_MONEY_PATH_OUTCOMES
            .SUCCESS,
      };
    }

    if (
      outcome ===
      GOLDEN_MONEY_PATH_OUTCOMES.PENDING
    ) {
      return {
        ...result,

        outcome:
          GOLDEN_MONEY_PATH_OUTCOMES
            .PENDING,
      };
    }

    if (
      outcome ===
      GOLDEN_MONEY_PATH_OUTCOMES.FAILED
      ||
      result?.status ===
        PAYMENT_STATES.FAILED
    ) {
      return {
        ...result,

        outcome:
          GOLDEN_MONEY_PATH_OUTCOMES
            .FAILED,
      };
    }

    if (
      outcome ===
      GOLDEN_MONEY_PATH_OUTCOMES.UNKNOWN
    ) {
      return {
        ...result,

        outcome:
          GOLDEN_MONEY_PATH_OUTCOMES
            .UNKNOWN,
      };
    }

    if (
      outcome ===
      GOLDEN_MONEY_PATH_OUTCOMES
        .REQUIRES_RECONCILIATION
      ||
      result?.requiresReconciliation
    ) {
      return {
        ...result,

        outcome:
          GOLDEN_MONEY_PATH_OUTCOMES
            .REQUIRES_RECONCILIATION,
      };
    }

    /**
     * If PaymentProcessingService returned SUCCESS with no explicit outcome,
     * treat it as success only after the provider verification stage.
     */
    if (
      result?.success === true
      && (
        result?.status ===
          PAYMENT_STATES.SUCCESSFUL
        || result?.payment?.status ===
          PAYMENT_STATES.SUCCESSFUL
      )
    ) {
      return {
        ...result,

        outcome:
          GOLDEN_MONEY_PATH_OUTCOMES
            .SUCCESS,
      };
    }

    return {
      ...result,

      outcome:
        GOLDEN_MONEY_PATH_OUTCOMES
          .UNKNOWN,
    };
  }

  /* ==========================================================================
   * Provider Verification
   * ======================================================================== */

  async _verifyProviderOutcome(
    payment,
    processingResult,
    context,
  ) {
    if (
      !this.options.requireProviderVerification
    ) {
      return {
        status:
          VERIFICATION_STATUS
            .VERIFIED,

        paymentId:
          payment.id,

        outcome:
          VERIFICATION_OUTCOMES
            .SUCCESS,

        bypassed:
          true,
      };
    }

    const providerEvidence =
      this._extractProviderEvidence(
        processingResult,
        payment,
      );

    return this.paymentVerificationService
      .verify(
        payment,
        providerEvidence,
        {
          ...context,

          provider:
            providerEvidence.provider ||
            payment.provider,

          providerTransactionId:
            providerEvidence.providerTransactionId ||
            payment.providerTransactionId,

          providerEventId:
            providerEvidence.providerEventId ||
            payment.providerEventId,

          reasonCode:
            'GOLDEN_MONEY_PATH_PROVIDER_VERIFICATION',
        },
      );
  }

  _extractProviderEvidence(
    processingResult,
    payment,
  ) {
    const provider =
      processingResult?.provider ||
      processingResult?.providerResult ||
      processingResult?.providerResponse ||
      {};

    const nested =
      provider
      && typeof provider === 'object'
        ? provider
        : {};

    const explicitProvider =
      normalizeProvider(
        nested.provider ||
        processingResult.providerName ||
        payment.provider,
      );

    const providerTransactionId =
      normalizeString(
        nested.providerTransactionId ||
        processingResult.providerTransactionId ||
        payment.providerTransactionId,
      );

    const providerEventId =
      normalizeString(
        nested.providerEventId ||
        processingResult.providerEventId ||
        payment.providerEventId,
      );

    const amount =
      canonicalAmount(
        nested.amount ||
        processingResult.amount ||
        payment.amount,
      );

    const currency =
      canonicalCurrency(
        nested.currency ||
        processingResult.currency ||
        payment.currency,
      );

    const outcome =
      normalizeString(
        nested.outcome ||
        nested.status ||
        processingResult.outcome ||
        processingResult.status,
      )?.toUpperCase();

    return {
      source:
        'GOLDEN_MONEY_PATH',

      paymentId:
        payment.id,

      provider:
        explicitProvider,

      providerTransactionId,

      providerEventId,

      paymentReference:
        payment.paymentReference ||
        payment.reference ||
        null,

      amount,

      currency,

      status:
        outcome,

      outcome:
        outcome,

      confirmed:
        outcome === 'SUCCESS'
        || outcome === 'SUCCESSFUL'
        || outcome === 'COMPLETED'
        || processingResult?.success === true,

      metadata:
        this._sanitizeMetadata(
          nested.metadata ||
          processingResult.metadata,
        ),
    };
  }

  /* ==========================================================================
   * Financial Posting
   * ======================================================================== */

  async _postFinancialEffect(
    payment,
    processingResult,
    verification,
    request,
    context,
  ) {
    /**
     * A previous financial transaction link is authoritative evidence that
     * financial posting may already have occurred.
     */
    if (
      payment.financialTransactionId
    ) {
      return this._loadExistingFinancialResult(
        payment,
        context,
      );
    }

    if (
      !this.financialService
    ) {
      if (
        this.options.allowAsynchronousFinancialPosting
      ) {
        return {
          attempted:
            false,

          posted:
            false,

          status:
            'PENDING',

          financialTransactionId:
            null,

          journalId:
            null,

          asynchronous:
            true,
        };
      }

      throw new GoldenMoneyPathError(
        'Financial posting service is not configured.',
        {
          code:
            GOLDEN_MONEY_PATH_ERROR_CODES
              .FINANCIAL_POSTING_FAILED,

          statusCode:
            503,

          stage:
            GOLDEN_MONEY_PATH_STAGES
              .FINANCIAL_POSTING,

          paymentId:
            payment.id,

          tenantId:
            context.tenantId,
        },
      );
    }

    const idempotencyKey =
      this._buildFinancialPostingKey(
        payment,
        context,
      );

    const payload = {
      paymentId:
        payment.id,

      tenantId:
        payment.tenantId ||
        context.tenantId,

      userId:
        payment.userId ||
        request.userId ||
        null,

      groupId:
        payment.groupId ||
        request.groupId ||
        null,

      loanId:
        payment.loanId ||
        request.loanId ||
        null,

      transactionType:
        this._financialTransactionType(
          request.type ||
          payment.type,
        ),

      amount:
        canonicalAmount(
          payment.amount ||
          request.amount,
        ),

      currency:
        canonicalCurrency(
          payment.currency ||
          request.currency,
        ),

      direction:
        normalizeDirection(
          payment.direction ||
          request.direction,
        ),

      provider:
        payment.provider ||
        request.provider ||
        null,

      providerTransactionId:
        processingResult.providerTransactionId ||
        payment.providerTransactionId ||
        null,

      providerEventId:
        processingResult.providerEventId ||
        payment.providerEventId ||
        null,

      paymentReference:
        payment.paymentReference ||
        request.paymentReference ||
        null,

      sourceType:
        'PAYMENT',

      sourceId:
        payment.id,

      idempotencyKey,

      verificationId:
        verification.evidenceHash ||
        null,

      correlationId:
        context.correlationId,

      requestId:
        context.requestId,

      metadata:
        this._sanitizeMetadata(
          {
            ...(request.metadata || {}),

            verificationStatus:
              verification.status,
          },
        ),
    };

    /**
     * Reserve an explicit financial-posting idempotency operation before
     * invoking the finance layer.
     */
    const postingReservation =
      await this._reserveFinancialPosting(
        payload,
        context,
      );

    if (
      postingReservation.completed
      && postingReservation.result
    ) {
      return {
        ...postingReservation.result,

        idempotentReplay:
          true,
      };
    }

    let financialResult;

    try {
      financialResult =
        await this._executeFinancialPosting(
          payload,
          context,
        );
    } catch (error) {
      await this._handleFinancialPostingException(
        payment,
        postingReservation,
        error,
        context,
      );

      throw error;
    }

    const normalized =
      this._normalizeFinancialResult(
        financialResult,
      );

    if (
      normalized.unknown
    ) {
      await this.paymentIdempotencyService
        .markUnknown(
          postingReservation.operationId,
          {
            reasonCode:
              'FINANCIAL_POSTING_UNKNOWN',
          },
        );

      throw new GoldenMoneyPathError(
        'Financial posting outcome is unknown and requires reconciliation.',
        {
          code:
            GOLDEN_MONEY_PATH_ERROR_CODES
              .FINANCIAL_POSTING_UNKNOWN,

          statusCode:
            202,

          stage:
            GOLDEN_MONEY_PATH_STAGES
              .FINANCIAL_POSTING,

          paymentId:
            payment.id,

          tenantId:
            context.tenantId,

          operationId:
            postingReservation.operationId,

          unknownOutcome:
            true,

          reconciliationRequired:
            true,
        },
      );
    }

    await this.paymentIdempotencyService.complete(
      postingReservation.operationId,
      normalized,
      {
        paymentId:
          payment.id,

        paymentReference:
          payment.paymentReference,

        provider:
          payment.provider,

        providerTransactionId:
          payment.providerTransactionId,
      },
    );

    return normalized;
  }

  async _reserveFinancialPosting(
    payload,
    context,
  ) {
    return this.paymentIdempotencyService.reserve({
      tenantId:
        context.tenantId,

      operationType:
        IDEMPOTENCY_OPERATION_TYPES
          .FINANCIAL_POSTING,

      key:
        payload.idempotencyKey,

      request:
        {
          paymentId:
            payload.paymentId,

          amount:
            payload.amount,

          currency:
            payload.currency,

          transactionType:
            payload.transactionType,

          direction:
            payload.direction,

          provider:
            payload.provider,

          providerTransactionId:
            payload.providerTransactionId,
        },

      paymentId:
        payload.paymentId,

      paymentReference:
        payload.paymentReference,

      provider:
        payload.provider,

      providerTransactionId:
        payload.providerTransactionId,

      metadata:
        payload.metadata,
    });
  }

  async _executeFinancialPosting(
    payload,
    context,
  ) {
    if (
      typeof this.financialService.postPayment
      === 'function'
    ) {
      return this.financialService.postPayment(
        payload,
        context,
      );
    }

    if (
      typeof this.financialService.post
      === 'function'
    ) {
      return this.financialService.post(
        payload,
        context,
      );
    }

    if (
      typeof this.financialService.recordPayment
      === 'function'
    ) {
      return this.financialService.recordPayment(
        payload,
        context,
      );
    }

    if (
      typeof this.financialService.createTransaction
      === 'function'
    ) {
      return this.financialService.createTransaction(
        payload,
        context,
      );
    }

    throw new GoldenMoneyPathError(
      'No supported financial posting method is configured.',
      {
        code:
          GOLDEN_MONEY_PATH_ERROR_CODES
            .FINANCIAL_POSTING_FAILED,

        statusCode:
          500,

        stage:
          GOLDEN_MONEY_PATH_STAGES
            .FINANCIAL_POSTING,

        tenantId:
          context.tenantId,
      },
    );
  }

  _normalizeFinancialResult(
    result,
  ) {
    const plain =
      result &&
      typeof result === 'object'
        ? result
        : {};

    const status =
      normalizeString(
        plain.status,
      )?.toUpperCase();

    const posted =
      plain.posted === true ||
      [
        'POSTED',
        'COMPLETED',
        'SUCCESSFUL',
      ].includes(
        status,
      );

    const unknown =
      plain.unknownOutcome === true ||
      status === 'UNKNOWN';

    return {
      attempted:
        true,

      posted:
        posted && !unknown,

      unknown,

      status:
        unknown
          ? 'UNKNOWN'
          : (
            status ||
            (posted
              ? 'POSTED'
              : 'PENDING')
          ),

      financialTransactionId:
        safeId(
          plain.financialTransactionId ||
          plain.transactionId ||
          plain.id,
        ),

      journalId:
        safeId(
          plain.journalId,
        ),

      journalEntryIds:
        Array.isArray(
          plain.journalEntryIds,
        )
          ? [
              ...plain.journalEntryIds,
            ]
          : [],

      amount:
        canonicalAmount(
          plain.amount,
        ),

      currency:
        canonicalCurrency(
          plain.currency,
        ),

      message:
        normalizeString(
          plain.message,
        ),
    };
  }

  async _loadExistingFinancialResult(
    payment,
    context,
  ) {
    if (
      !this.financialService
    ) {
      return {
        attempted:
          false,

        posted:
          false,

        status:
          'LINKED_NOT_VERIFIED',

        financialTransactionId:
          payment.financialTransactionId,
      };
    }

    let transaction = null;

    if (
      typeof this.financialService.getTransaction
      === 'function'
    ) {
      transaction =
        await this.financialService.getTransaction(
          payment.financialTransactionId,
          context,
        );
    } else if (
      typeof this.financialService.findTransaction
      === 'function'
    ) {
      transaction =
        await this.financialService.findTransaction(
          payment.financialTransactionId,
          context,
        );
    }

    if (!transaction) {
      throw new GoldenMoneyPathError(
        'Payment references a missing financial transaction.',
        {
          code:
            GOLDEN_MONEY_PATH_ERROR_CODES
              .FINANCIAL_TRANSACTION_REQUIRED,

          statusCode:
            409,

          stage:
            GOLDEN_MONEY_PATH_STAGES
              .FINANCIAL_POSTING,

          paymentId:
            payment.id,

          tenantId:
            context.tenantId,

          reconciliationRequired:
            true,
        },
      );
    }

    return this._normalizeFinancialResult(
      transaction,
    );
  }

  async _handleFinancialPostingException(
    payment,
    postingReservation,
    error,
    context,
  ) {
    const unknown =
      this._isUnknownFinancialOutcome(
        error,
      );

    if (unknown) {
      await this.paymentIdempotencyService
        .markUnknown(
          postingReservation.operationId,
          {
            reasonCode:
              'FINANCIAL_POSTING_UNKNOWN',
          },
        );
    } else {
      await this.paymentIdempotencyService
        .fail(
          postingReservation.operationId,
          error,
          {
            paymentId:
              payment.id,

            reasonCode:
              'FINANCIAL_POSTING_FAILED',
          },
        );
    }
  }

  _isUnknownFinancialOutcome(
    error,
  ) {
    if (
      error?.unknownOutcome === true
    ) {
      return true;
    }

    const code =
      String(
        error?.code ||
        '',
      ).toUpperCase();

    return [
      'ETIMEDOUT',
      'ECONNRESET',
      'UNKNOWN_OUTCOME',
      'POSTING_UNKNOWN',
      'TRANSACTION_TIMEOUT',
    ].includes(
      code,
    );
  }

  _buildFinancialPostingKey(
    payment,
    context,
  ) {
    if (
      typeof this.paymentIdempotencyService
        .buildFinancialPostingKey
      === 'function'
    ) {
      return this.paymentIdempotencyService
        .buildFinancialPostingKey({
          paymentId:
            payment.id,

          paymentReference:
            payment.paymentReference,

          tenantId:
            context.tenantId,
        });
    }

    return [
      'financial-posting',
      context.tenantId,
      payment.id,
    ].join(':');
  }

  _financialTransactionType(
    type,
  ) {
    switch (
      normalizeType(type)
    ) {
      case 'contribution':
        return 'CONTRIBUTION';

      case 'loan_repayment':
        return 'LOAN_REPAYMENT';

      case 'loan_disbursement':
        return 'LOAN_DISBURSEMENT';

      case 'withdrawal':
        return 'WITHDRAWAL';

      case 'transfer':
        return 'TRANSFER';

      case 'refund':
        return 'REFUND';

      case 'fee':
        return 'FEE';

      default:
        return 'PAYMENT';
    }
  }

  /* ==========================================================================
   * Ledger Commit Verification
   * ======================================================================== */

  async _verifyLedgerCommit(
    payment,
    financialResult,
    context,
  ) {
    if (
      financialResult.unknown
    ) {
      return {
        posted:
          false,

        status:
          'UNKNOWN',

        financialTransactionId:
          financialResult.financialTransactionId,

        journalId:
          financialResult.journalId,
      };
    }

    if (
      !financialResult.financialTransactionId
    ) {
      return {
        posted:
          Boolean(
            financialResult.posted,
          ),

        status:
          financialResult.status,

        financialTransactionId:
          null,

        journalId:
          financialResult.journalId ||
          null,
      };
    }

    if (
      !this.financialService
    ) {
      return {
        posted:
          financialResult.posted === true,

        status:
          financialResult.status,

        financialTransactionId:
          financialResult.financialTransactionId,

        journalId:
          financialResult.journalId,
      };
    }

    let transaction = null;

    if (
      typeof this.financialService.getTransaction
      === 'function'
    ) {
      transaction =
        await this.financialService.getTransaction(
          financialResult.financialTransactionId,
          context,
        );
    } else if (
      typeof this.financialService.findTransaction
      === 'function'
    ) {
      transaction =
        await this.financialService.findTransaction(
          financialResult.financialTransactionId,
          context,
        );
    }

    if (!transaction) {
      throw new GoldenMoneyPathError(
        'Financial transaction cannot be verified after posting.',
        {
          code:
            GOLDEN_MONEY_PATH_ERROR_CODES
              .FINANCIAL_TRANSACTION_REQUIRED,

          statusCode:
            409,

          stage:
            GOLDEN_MONEY_PATH_STAGES
              .LEDGER_COMMIT,

          paymentId:
            payment.id,

          tenantId:
            context.tenantId,

          reconciliationRequired:
            true,
        },
      );
    }

    const status =
      normalizeString(
        transaction.status,
      )?.toUpperCase();

    const posted =
      transaction.posted === true ||
      [
        'POSTED',
        'COMPLETED',
        'SUCCESSFUL',
      ].includes(
        status,
      );

    /**
     * A financial transaction that references a payment with a mismatching
     * amount/currency must never be considered a valid ledger commit.
     */
    if (
      transaction.amount
      && payment.amount
      && canonicalAmount(
        transaction.amount,
      )
      !== canonicalAmount(
        payment.amount,
      )
    ) {
      throw new GoldenMoneyPathError(
        'Financial transaction amount does not match payment amount.',
        {
          code:
            GOLDEN_MONEY_PATH_ERROR_CODES
              .AMOUNT_MISMATCH,

          statusCode:
            409,

          stage:
            GOLDEN_MONEY_PATH_STAGES
              .LEDGER_COMMIT,

          paymentId:
            payment.id,

          tenantId:
            context.tenantId,

          reconciliationRequired:
            true,
        },
      );
    }

    if (
      transaction.currency
      && payment.currency
      && canonicalCurrency(
        transaction.currency,
      )
      !== canonicalCurrency(
        payment.currency,
      )
    ) {
      throw new GoldenMoneyPathError(
        'Financial transaction currency does not match payment currency.',
        {
          code:
            GOLDEN_MONEY_PATH_ERROR_CODES
              .CURRENCY_MISMATCH,

          statusCode:
            409,

          stage:
            GOLDEN_MONEY_PATH_STAGES
              .LEDGER_COMMIT,

          paymentId:
            payment.id,

          tenantId:
            context.tenantId,

          reconciliationRequired:
            true,
        },
      );
    }

    return {
      posted,

      status:
        posted
          ? 'POSTED'
          : status || 'PENDING',

      financialTransactionId:
        financialResult.financialTransactionId,

      journalId:
        safeId(
          transaction.journalId ||
          financialResult.journalId,
        ),

      journalEntryIds:
        Array.isArray(
          transaction.journalEntryIds,
        )
          ? [
              ...transaction.journalEntryIds,
            ]
          : financialResult.journalEntryIds || [],
    };
  }

  /* ==========================================================================
   * Successful Completion
   * ======================================================================== */

  async _completeSuccessfulOperation(
    payment,
    processingResult,
    verification,
    financialResult,
    ledgerResult,
    idempotency,
    context,
    trace,
  ) {
    const result = {
      success:
        true,

      outcome:
        GOLDEN_MONEY_PATH_OUTCOMES
          .SUCCESS,

      paymentId:
        payment.id,

      paymentReference:
        payment.paymentReference ||
        null,

      payment:
        this._sanitizePayment(
          await this._reloadPayment(
            payment.id,
            context,
          ) || payment,
        ),

      provider:
        this._sanitizeProviderResult(
          processingResult,
        ),

      verification:
        this._sanitizeVerification(
          verification,
        ),

      financial: {
        attempted:
          financialResult.attempted === true,

        posted:
          financialResult.posted === true,

        status:
          financialResult.status,

        financialTransactionId:
          financialResult.financialTransactionId,

        journalId:
          financialResult.journalId,
      },

      ledger: {
        posted:
          ledgerResult.posted === true,

        status:
          ledgerResult.status,

        financialTransactionId:
          ledgerResult.financialTransactionId,

        journalId:
          ledgerResult.journalId,
      },

      settlement: {
        status:
          'NOT_STARTED',
      },

      operationId:
        context.operationId,

      idempotencyOperationId:
        idempotency.operationId,

      requestId:
        context.requestId,

      correlationId:
        context.correlationId,
    };

    await this.paymentIdempotencyService
      .complete(
        idempotency.operationId,
        result,
        {
          paymentId:
            payment.id,

          paymentReference:
            payment.paymentReference,

          provider:
            payment.provider,

          providerTransactionId:
            processingResult.providerTransactionId ||
            payment.providerTransactionId,
        },
      );

    return result;
  }

  /* ==========================================================================
   * Pending Path
   * ======================================================================== */

  async _completePendingPath(
    payment,
    processingResult,
    idempotency,
    context,
    trace,
  ) {
    const result = {
      success:
        false,

      outcome:
        GOLDEN_MONEY_PATH_OUTCOMES
          .PENDING,

      paymentId:
        payment.id,

      status:
        PAYMENT_STATES.PENDING,

      payment:
        this._sanitizePayment(
          await this._reloadPayment(
            payment.id,
            context,
          ) || payment,
        ),

      provider:
        this._sanitizeProviderResult(
          processingResult,
        ),

      operationId:
        context.operationId,

      idempotencyOperationId:
        idempotency.operationId,

      requestId:
        context.requestId,

      correlationId:
        context.correlationId,

      nextAction:
        'WAIT_FOR_PROVIDER_RESULT',
    };

    /**
     * A pending operation remains PROCESSING/IN_PROGRESS from the business
     * perspective and must not be marked complete in the idempotency store.
     */
    return this._finalizeResponse(
      result,
      context,
      trace,
    );
  }

  /* ==========================================================================
   * Unknown / Reconciliation Paths
   * ======================================================================== */

  async _completeUnknownPath(
    payment,
    processingResult,
    idempotency,
    context,
    trace,
  ) {
    await this.paymentIdempotencyService
      .markUnknown(
        idempotency.operationId,
        {
          reasonCode:
            'GOLDEN_MONEY_PATH_PROVIDER_OUTCOME_UNKNOWN',
        },
      );

    if (
      this.options.neverDuplicateUnknownProviderOperation
    ) {
      return this._completeReconciliationPath(
        payment,
        processingResult,
        idempotency,
        context,
        trace,
      );
    }

    return this._finalizeResponse(
      {
        success:
          false,

        outcome:
          GOLDEN_MONEY_PATH_OUTCOMES
            .UNKNOWN,

        paymentId:
          payment.id,

        operationId:
          context.operationId,

        idempotencyOperationId:
          idempotency.operationId,
      },
      context,
      trace,
    );
  }

  async _completeReconciliationPath(
    payment,
    processingResult,
    idempotency,
    context,
    trace,
  ) {
    this._recordStage(
      trace,
      GOLDEN_MONEY_PATH_STAGES.RECONCILIATION,
      'STARTED',
    );

    let reconciliation =
      null;

    if (
      this.options.enableReconciliationHandoff
    ) {
      reconciliation =
        await this._createReconciliationCase(
          payment,
          processingResult,
          context,
        );
    }

    await this.paymentIdempotencyService
      .markUnknown(
        idempotency.operationId,
        {
          reasonCode:
            'GOLDEN_MONEY_PATH_RECONCILIATION_REQUIRED',
        },
      );

    this._recordStage(
      trace,
      GOLDEN_MONEY_PATH_STAGES.RECONCILIATION,
      'COMPLETED',
      {
        caseId:
          reconciliation?.caseId ||
          reconciliation?.id ||
          null,
      },
    );

    return this._finalizeResponse(
      {
        success:
          false,

        outcome:
          GOLDEN_MONEY_PATH_OUTCOMES
            .REQUIRES_RECONCILIATION,

        paymentId:
          payment.id,

        payment:
          this._sanitizePayment(
            await this._reloadPayment(
              payment.id,
              context,
            ) || payment,
          ),

        provider:
          this._sanitizeProviderResult(
            processingResult,
          ),

        verification:
          processingResult.verification
            ? this._sanitizeVerification(
                processingResult.verification,
              )
            : null,

        reconciliation: {
          required:
            true,

          caseId:
            reconciliation?.caseId ||
            reconciliation?.id ||
            null,

          status:
            reconciliation?.status ||
            'PENDING',
        },

        operationId:
          context.operationId,

        idempotencyOperationId:
          idempotency.operationId,

        requestId:
          context.requestId,

        correlationId:
          context.correlationId,

        nextAction:
          'RECONCILE_PAYMENT',
      },
      context,
      trace,
    );
  }

  async _createReconciliationCase(
    payment,
    processingResult,
    context,
  ) {
    if (
      !this.reconciliationService
    ) {
      return {
        status:
          'NOT_CONFIGURED',
      };
    }

    const payload = {
      sourceType:
        'GOLDEN_MONEY_PATH',

      sourceId:
        payment.id,

      paymentId:
        payment.id,

      tenantId:
        context.tenantId,

      provider:
        payment.provider ||
        processingResult.provider ||
        null,

      providerTransactionId:
        processingResult.providerTransactionId ||
        payment.providerTransactionId ||
        null,

      exceptionType:
        this._deriveReconciliationException(
          processingResult,
        ),

      severity:
        'HIGH',

      amount:
        canonicalAmount(
          payment.amount,
        ),

      currency:
        canonicalCurrency(
          payment.currency,
        ),

      metadata:
        this._sanitizeMetadata(
          {
            operationId:
              context.operationId,

            correlationId:
              context.correlationId,

            processingResult,
          },
        ),
    };

    if (
      typeof this.reconciliationService
        .createPaymentException === 'function'
    ) {
      return this.reconciliationService
        .createPaymentException(
          payload,
          context,
        );
    }

    if (
      typeof this.reconciliationService
        .createException === 'function'
    ) {
      return this.reconciliationService
        .createException(
          payload,
          context,
        );
    }

    return {
      status:
        'NOT_CONFIGURED',
    };
  }

  _deriveReconciliationException(
    result,
  ) {
    if (
      result?.verification
        ?.status ===
      VERIFICATION_STATUS.REQUIRES_RECONCILIATION
    ) {
      return (
        result.verification
          .failedChecks?.[0]?.code ||
        'PAYMENT_VERIFICATION_MISMATCH'
      );
    }

    if (
      result?.outcome ===
      GOLDEN_MONEY_PATH_OUTCOMES.UNKNOWN
    ) {
      return 'PROVIDER_OUTCOME_UNKNOWN';
    }

    return 'GOLDEN_MONEY_PATH_RECONCILIATION_REQUIRED';
  }

  /* ==========================================================================
   * Financial Posting Failure
   * ======================================================================== */

  async _handleFinancialPostingFailure(
    payment,
    processingResult,
    verification,
    idempotency,
    error,
    context,
    trace,
  ) {
    if (
      this._isUnknownFinancialOutcome(
        error,
      )
    ) {
      await this.paymentIdempotencyService
        .markUnknown(
          idempotency.operationId,
          {
            reasonCode:
              'GOLDEN_MONEY_PATH_FINANCIAL_POSTING_UNKNOWN',
          },
        );

      return this._completeReconciliationPath(
        payment,
        {
          ...processingResult,

          verification,

          financialError: {
            code:
              error?.code,

            message:
              this._safeErrorMessage(
                error,
              ),
          },
        },
        idempotency,
        context,
        trace,
      );
    }

    await this.paymentIdempotencyService
      .fail(
        idempotency.operationId,
        error,
        {
          paymentId:
            payment.id,

          reasonCode:
            'GOLDEN_MONEY_PATH_FINANCIAL_POSTING_FAILED',

          retryable:
            error?.retryable === true,
        },
      );

    throw this._wrapError(
      error,
      {
        code:
          GOLDEN_MONEY_PATH_ERROR_CODES
            .FINANCIAL_POSTING_FAILED,

        stage:
          GOLDEN_MONEY_PATH_STAGES
            .FINANCIAL_POSTING,

        paymentId:
          payment.id,

        context,
      },
    );
  }

  /* ==========================================================================
   * Settlement
   * ======================================================================== */

  async _initiateSettlement(
    payment,
    result,
    context,
    trace,
  ) {
    if (
      !this.settlementService
    ) {
      return {
        status:
          'NOT_CONFIGURED',
      };
    }

    this._recordStage(
      trace,
      GOLDEN_MONEY_PATH_STAGES.SETTLEMENT,
      'STARTED',
    );

    let settlement = null;

    try {
      if (
        typeof this.settlementService
          .initiatePaymentSettlement
        === 'function'
      ) {
        settlement =
          await this.settlementService
            .initiatePaymentSettlement(
              {
                paymentId:
                  payment.id,

                tenantId:
                  context.tenantId,

                provider:
                  payment.provider,

                providerTransactionId:
                  payment.providerTransactionId,

                amount:
                  canonicalAmount(
                    payment.amount,
                  ),

                currency:
                  canonicalCurrency(
                    payment.currency,
                  ),

                financialTransactionId:
                  result.financial
                    ?.financialTransactionId,
              },
              context,
            );
      } else if (
        typeof this.settlementService
          .settlePayment
        === 'function'
      ) {
        settlement =
          await this.settlementService
            .settlePayment(
              {
                paymentId:
                  payment.id,

                tenantId:
                  context.tenantId,

                provider:
                  payment.provider,

                providerTransactionId:
                  payment.providerTransactionId,
              },
              context,
            );
      }
    } catch (error) {
      /**
       * Settlement failure should not rewrite a successfully posted customer
       * transaction. It becomes a downstream settlement/reconciliation
       * concern.
       */
      this._logError(
        'Golden Money Path settlement initiation failed.',
        error,
        {
          paymentId:
            payment.id,

          tenantId:
            context.tenantId,
        },
      );

      settlement = {
        status:
          'FAILED',

        requiresReconciliation:
          true,
      };
    }

    this._recordStage(
      trace,
      GOLDEN_MONEY_PATH_STAGES.SETTLEMENT,
      'COMPLETED',
      {
        status:
          settlement?.status ||
          'NOT_CONFIGURED',
      },
    );

    return settlement;
  }

  /* ==========================================================================
   * General Failure Handling
   * ======================================================================== */

  async _handleOperationFailure(
    idempotency,
    error,
    context,
    trace,
    stage,
  ) {
    try {
      if (
        this._isUnknownOutcome(
          error,
        )
      ) {
        await this.paymentIdempotencyService
          .markUnknown(
            idempotency.operationId,
            {
              reasonCode:
                `GOLDEN_MONEY_PATH_${stage}_UNKNOWN`,
            },
          );
      } else {
        await this.paymentIdempotencyService
          .fail(
            idempotency.operationId,
            error,
            {
              reasonCode:
                `GOLDEN_MONEY_PATH_${stage}_FAILED`,
            },
          );
      }
    } catch (idempotencyError) {
      this._logError(
        'Failed to update Golden Money Path idempotency state after failure.',
        idempotencyError,
        {
          operationId:
            idempotency.operationId,

          stage,
        },
      );
    }

    this._recordStage(
      trace,
      stage,
      'FAILED',
      {
        errorCode:
          error?.code || null,
      },
    );
  }

  _isUnknownOutcome(
    error,
  ) {
    if (
      error?.unknownOutcome === true
      || error?.reconciliationRequired === true
    ) {
      return true;
    }

    const code =
      String(
        error?.code || '',
      ).toUpperCase();

    return [
      'ETIMEDOUT',
      'ECONNRESET',
      'UNKNOWN_OUTCOME',
      'PROVIDER_OPERATION_UNKNOWN_OUTCOME',
      'FINANCIAL_POSTING_UNKNOWN',
      'POSTING_UNKNOWN',
      'TRANSACTION_TIMEOUT',
    ].includes(
      code,
    );
  }

  _wrapError(
    error,
    options = {},
  ) {
    if (
      error instanceof GoldenMoneyPathError
    ) {
      return error;
    }

    return new GoldenMoneyPathError(
      error?.message ||
      'Golden Money Path operation failed.',
      {
        code:
          options.code,

        statusCode:
          Number(
            error?.statusCode,
          ) ||
          500,

        stage:
          options.stage,

        paymentId:
          options.paymentId ||
          error?.paymentId ||
          null,

        tenantId:
          options.context?.tenantId ||
          error?.tenantId ||
          null,

        operationId:
          options.context?.operationId ||
          error?.operationId ||
          null,

        correlationId:
          options.context?.correlationId ||
          null,

        retryable:
          error?.retryable === true,

        unknownOutcome:
          error?.unknownOutcome === true,

        reconciliationRequired:
          error?.reconciliationRequired === true,

        details:
          this._sanitizeMetadata(
            error?.details,
          ),

        cause:
          error,
      },
    );
  }

  /* ==========================================================================
   * Trace
   * ======================================================================== */

  _createTrace(
    context,
  ) {
    return {
      traceId:
        createPathTraceId(),

      operationId:
        context.operationId,

      requestId:
        context.requestId,

      correlationId:
        context.correlationId,

      tenantId:
        context.tenantId,

      startedAt:
        isoNow(),

      completedAt:
        null,

      stages: [],
    };
  }

  _recordStage(
    trace,
    stage,
    status,
    metadata = {},
  ) {
    if (
      !trace
      || !this.options.includePathTrace
    ) {
      return;
    }

    trace.stages.push({
      stage,

      status,

      timestamp:
        isoNow(),

      metadata:
        this._sanitizeMetadata(
          metadata,
        ),
    });
  }

  /* ==========================================================================
   * Final Response
   * ======================================================================== */

  _finalizeResponse(
    result,
    context,
    trace,
  ) {
    if (trace) {
      trace.completedAt =
        isoNow();
    }

    this._recordMetrics(
      result,
    );

    return {
      success:
        result.success === true,

      outcome:
        result.outcome ||
        GOLDEN_MONEY_PATH_OUTCOMES
          .UNKNOWN,

      paymentId:
        result.paymentId ||
        null,

      paymentReference:
        result.paymentReference ||
        null,

      status:
        result.status ||
        result.payment?.status ||
        null,

      payment:
        this._sanitizePayment(
          result.payment,
        ),

      provider:
        this._sanitizeProviderResult(
          result.provider,
        ),

      verification:
        this._sanitizeVerification(
          result.verification,
        ),

      financial:
        result.financial
        ? {
            attempted:
              result.financial
                .attempted === true,

            posted:
              result.financial
                .posted === true,

            status:
              result.financial.status,

            financialTransactionId:
              result.financial
                .financialTransactionId ||
              null,

            journalId:
              result.financial.journalId ||
              null,
          }
        : null,

      ledger:
        result.ledger
        ? {
            posted:
              result.ledger.posted === true,

            status:
              result.ledger.status,

            financialTransactionId:
              result.ledger
                .financialTransactionId ||
              null,

            journalId:
              result.ledger.journalId ||
              null,
          }
        : null,

      reconciliation:
        result.reconciliation
        ? {
            required:
              result.reconciliation
                .required === true,

            caseId:
              result.reconciliation
                .caseId ||
              null,

            status:
              result.reconciliation.status ||
              null,
          }
        : null,

      settlement:
        result.settlement
        ? {
            status:
              result.settlement.status ||
              null,
          }
        : null,

      operationId:
        result.operationId ||
        context.operationId,

      idempotencyOperationId:
        result.idempotencyOperationId ||
        null,

      requestId:
        result.requestId ||
        context.requestId,

      correlationId:
        result.correlationId ||
        context.correlationId,

      nextAction:
        result.nextAction ||
        null,

      ...(this.options.includePathTrace
        ? {
            pathTrace:
              clone(trace),
          }
        : {}),
    };
  }

  /* ==========================================================================
   * Normalization / Sanitization
   * ======================================================================== */

  _normalizePayment(
    payment,
  ) {
    const plain =
      payment &&
      typeof payment === 'object'
        ? (
            typeof payment.toObject ===
            'function'
              ? payment.toObject()
              : payment
          )
        : {};

    return {
      ...plain,

      id:
        safeId(
          plain.id ||
          plain._id,
        ),

      tenantId:
        normalizeString(
          plain.tenantId,
        ),

      userId:
        normalizeString(
          plain.userId,
        ),

      groupId:
        normalizeString(
          plain.groupId,
        ),

      loanId:
        normalizeString(
          plain.loanId,
        ),

      type:
        normalizeType(
          plain.type ||
          plain.paymentType,
        ),

      paymentType:
        normalizeType(
          plain.paymentType ||
          plain.type,
        ),

      direction:
        normalizeDirection(
          plain.direction,
        ),

      amount:
        canonicalAmount(
          plain.amount,
        ),

      currency:
        canonicalCurrency(
          plain.currency,
        ),

      provider:
        normalizeProvider(
          plain.provider,
        ),

      paymentReference:
        normalizeString(
          plain.paymentReference ||
          plain.reference,
        ),

      providerTransactionId:
        normalizeString(
          plain.providerTransactionId,
        ),

      providerEventId:
        normalizeString(
          plain.providerEventId,
        ),

      financialTransactionId:
        normalizeString(
          plain.financialTransactionId,
        ),

      status:
        normalizeString(
          plain.status ||
          plain.state,
        )?.toUpperCase(),

      version:
        parseVersion(
          plain.version,
        ) ??
        parseVersion(
          plain.__v,
        ) ??
        0,
    };
  }

  async _loadPayment(
    paymentOrId,
    context,
  ) {
    if (
      paymentOrId &&
      typeof paymentOrId === 'object'
    ) {
      const payment =
        this._normalizePayment(
          paymentOrId,
        );

      if (
        payment.tenantId &&
        payment.tenantId !==
          context.tenantId
      ) {
        throw new GoldenMoneyPathError(
          'Payment does not belong to the current tenant.',
          {
            code:
              GOLDEN_MONEY_PATH_ERROR_CODES
                .PAYMENT_NOT_FOUND,

            statusCode:
              403,

            paymentId:
              payment.id,

            tenantId:
              context.tenantId,
          },
        );
      }

      return payment;
    }

    const paymentId =
      safeId(
        paymentOrId,
      );

    if (
      !paymentId
      || !this.paymentRepository
    ) {
      throw new GoldenMoneyPathError(
        'Payment could not be resolved.',
        {
          code:
            GOLDEN_MONEY_PATH_ERROR_CODES
              .PAYMENT_NOT_FOUND,

          statusCode:
            404,

          tenantId:
            context.tenantId,
        },
      );
    }

    let payment = null;

    if (
      typeof this.paymentRepository
        .getById === 'function'
    ) {
      payment =
        await this.paymentRepository
          .getById(
            paymentId,
            {
              tenantId:
                context.tenantId,
            },
          );
    } else if (
      typeof this.paymentRepository
        .findById === 'function'
    ) {
      payment =
        await this.paymentRepository
          .findById(
            paymentId,
            {
              tenantId:
                context.tenantId,
            },
          );
    }

    if (!payment) {
      throw new GoldenMoneyPathError(
        'Payment was not found.',
        {
          code:
            GOLDEN_MONEY_PATH_ERROR_CODES
              .PAYMENT_NOT_FOUND,

          statusCode:
            404,

          paymentId,

          tenantId:
            context.tenantId,
        },
      );
    }

    return this._normalizePayment(
      payment,
    );
  }

  async _reloadPayment(
    paymentId,
    context,
  ) {
    try {
      return await this._loadPayment(
        paymentId,
        context,
      );
    } catch (error) {
      if (
        error.code ===
        GOLDEN_MONEY_PATH_ERROR_CODES
          .PAYMENT_NOT_FOUND
      ) {
        return null;
      }

      throw error;
    }
  }

  _sanitizePayment(
    payment,
  ) {
    if (!payment) {
      return null;
    }

    return {
      id:
        safeId(
          payment.id ||
          payment._id,
        ),

      tenantId:
        payment.tenantId ||
        null,

      userId:
        payment.userId ||
        null,

      groupId:
        payment.groupId ||
        null,

      loanId:
        payment.loanId ||
        null,

      paymentReference:
        payment.paymentReference ||
        payment.reference ||
        null,

      type:
        payment.type ||
        payment.paymentType ||
        null,

      direction:
        payment.direction ||
        null,

      amount:
        canonicalAmount(
          payment.amount,
        ),

      currency:
        canonicalCurrency(
          payment.currency,
        ),

      provider:
        payment.provider ||
        null,

      providerTransactionId:
        payment.providerTransactionId ||
        null,

      status:
        payment.status ||
        null,

      financialTransactionId:
        payment.financialTransactionId ||
        null,

      createdAt:
        payment.createdAt ||
        null,

      updatedAt:
        payment.updatedAt ||
        null,

      completedAt:
        payment.completedAt ||
        null,
    };
  }

  _sanitizeProviderResult(
    result,
  ) {
    if (!result) {
      return null;
    }

    const provider =
      result.provider ||
      result.providerResult ||
      result.providerResponse ||
      result;

    if (
      !provider
      || typeof provider !== 'object'
    ) {
      return null;
    }

    return {
      provider:
        normalizeProvider(
          provider.provider,
        ),

      outcome:
        normalizeString(
          provider.outcome ||
          provider.status,
        )?.toUpperCase() ||
        null,

      status:
        normalizeString(
          provider.status,
        )?.toUpperCase() ||
        null,

      providerTransactionId:
        normalizeString(
          provider.providerTransactionId ||
          provider.transactionId ||
          provider.providerReference,
        ),

      providerEventId:
        normalizeString(
          provider.providerEventId ||
          provider.eventId,
        ),

      amount:
        canonicalAmount(
          provider.amount,
        ),

      currency:
        canonicalCurrency(
          provider.currency,
        ),

      reasonCode:
        normalizeString(
          provider.reasonCode ||
          provider.code,
        ),

      occurredAt:
        provider.occurredAt ||
        provider.timestamp ||
        null,
    };
  }

  _sanitizeVerification(
    verification,
  ) {
    if (!verification) {
      return null;
    }

    return {
      status:
        verification.status ||
        null,

      verified:
        verification.verified === true,

      reconciliationRequired:
        verification.reconciliationRequired === true,

      paymentId:
        verification.paymentId ||
        null,

      provider:
        verification.provider ||
        null,

      providerTransactionId:
        verification.providerTransactionId ||
        null,

      evidenceHash:
        verification.evidenceHash ||
        null,

      failedChecks:
        Array.isArray(
          verification.failedChecks,
        )
          ? verification.failedChecks.map(
              (check) => ({
                name:
                  check?.name ||
                  null,

                code:
                  check?.code ||
                  null,

                message:
                  check?.message ||
                  null,
              }),
            )
          : [],
    };
  }

  _sanitizeMetadata(
    metadata,
  ) {
    if (
      !metadata
      || typeof metadata !== 'object'
    ) {
      return {};
    }

    const sensitive =
      new Set([
        'password',
        'token',
        'accessToken',
        'refreshToken',
        'secret',
        'clientSecret',
        'apiKey',
        'privateKey',
        'authorization',
        'rawAuthorizationHeader',
        'signature',
        'signatureSecret',
        'webhookSecret',
        'rawBody',
      ]);

    const sanitize = (
      value,
    ) => {
      if (
        value === null
        || value === undefined
      ) {
        return value;
      }

      if (
        Array.isArray(value)
      ) {
        return value.map(
          sanitize,
        );
      }

      if (
        typeof value !== 'object'
      ) {
        return value;
      }

      const output = {};

      for (
        const [
          key,
          child,
        ] of Object.entries(
          value,
        )
      ) {
        if (
          sensitive.has(
            key,
          )
        ) {
          output[key] =
            '[REDACTED]';

          continue;
        }

        output[key] =
          sanitize(child);
      }

      return output;
    };

    return sanitize(
      metadata,
    );
  }

  _safeErrorMessage(
    error,
  ) {
    const message =
      error?.message ||
      'Golden Money Path operation failed.';

    return String(
      message,
    ).slice(
      0,
      500,
    );
  }

  /* ==========================================================================
   * Observability
   * ======================================================================== */

  _recordMetrics(
    result,
  ) {
    if (!this.metrics) {
      return;
    }

    const labels = {
      outcome:
        normalizeString(
          result?.outcome,
        )?.toLowerCase() ||
        'unknown',

      provider:
        normalizeProvider(
          result?.provider?.provider,
        ) ||
        'unknown',
    };

    try {
      if (
        typeof this.metrics.increment
          === 'function'
      ) {
        this.metrics.increment(
          'golden_money_path_total',
          1,
          labels,
        );

        return;
      }

      if (
        typeof this.metrics.inc
          === 'function'
      ) {
        this.metrics.inc(
          'golden_money_path_total',
          1,
          labels,
        );
      }
    } catch (_error) {
      // Metrics must never break money processing.
    }
  }

  _logError(
    message,
    error,
    metadata = {},
  ) {
    try {
      if (
        this.logger
        && typeof this.logger.error
          === 'function'
      ) {
        this.logger.error(
          message,
          {
            error: {
              name:
                error?.name,

              code:
                error?.code,

              message:
                error?.message,
            },

            ...this._sanitizeMetadata(
              metadata,
            ),
          },
        );
      }
    } catch (_loggingError) {
      // Never mask the primary financial error.
    }
  }

  /* ==========================================================================
   * Contract / Diagnostics
   * ======================================================================== */

  getStages() {
    return Object.freeze({
      ...GOLDEN_MONEY_PATH_STAGES,
    });
  }

  getOutcomes() {
    return Object.freeze({
      ...GOLDEN_MONEY_PATH_OUTCOMES,
    });
  }

  getConfiguration() {
    return Object.freeze({
      strictMode:
        this.options.strictMode,

      requireTenant:
        this.options.requireTenant,

      requireActor:
        this.options.requireActor,

      requireIdempotencyKey:
        this.options.requireIdempotencyKey,

      requireProviderVerification:
        this.options.requireProviderVerification,

      allowAsynchronousFinancialPosting:
        this.options.allowAsynchronousFinancialPosting,

      requireLedgerPostBeforeSuccessResponse:
        this.options
          .requireLedgerPostBeforeSuccessResponse,

      neverDuplicateUnknownProviderOperation:
        this.options
          .neverDuplicateUnknownProviderOperation,

      enableReconciliationHandoff:
        this.options
          .enableReconciliationHandoff,

      autoInitiateSettlement:
        this.options
          .autoInitiateSettlement,
    });
  }

  validateConfiguration() {
    const errors = [];

    if (
      !this.paymentStateMachine
      || typeof this.paymentStateMachine
        .process !== 'function'
    ) {
      errors.push(
        'PaymentStateMachine is unavailable.',
      );
    }

    if (
      !this.paymentIdempotencyService
      || typeof this.paymentIdempotencyService
        .reserve !== 'function'
    ) {
      errors.push(
        'PaymentIdempotencyService is unavailable.',
      );
    }

    if (
      !this.paymentVerificationService
      || typeof this.paymentVerificationService
        .verify !== 'function'
    ) {
      errors.push(
        'PaymentVerificationService is unavailable.',
      );
    }

    if (
      !this.paymentProcessingService
      || typeof this.paymentProcessingService
        .process !== 'function'
    ) {
      errors.push(
        'PaymentProcessingService is unavailable.',
      );
    }

    if (
      this.options.strictMode
      && !this.paymentRepository
    ) {
      errors.push(
        'Payment repository is required in strict production mode.',
      );
    }

    if (
      this.options.strictMode
      && !this.financialService
    ) {
      errors.push(
        'Financial service is required in strict production mode unless asynchronous posting is explicitly supported.',
      );
    }

    return {
      valid:
        errors.length === 0,

      errors,
    };
  }
}

/* ============================================================================
 * Static API
 * ========================================================================== */

GoldenMoneyPathService.STAGES =
  GOLDEN_MONEY_PATH_STAGES;

GoldenMoneyPathService.OUTCOMES =
  GOLDEN_MONEY_PATH_OUTCOMES;

GoldenMoneyPathService.ERROR_CODES =
  GOLDEN_MONEY_PATH_ERROR_CODES;

GoldenMoneyPathService.PAYMENT_STATES =
  PAYMENT_STATES;

GoldenMoneyPathService.IDEMPOTENCY_STATUS =
  IDEMPOTENCY_STATUS;

GoldenMoneyPathService.IDEMPOTENCY_OPERATION_TYPES =
  IDEMPOTENCY_OPERATION_TYPES;

GoldenMoneyPathService.VERIFICATION_STATUS =
  VERIFICATION_STATUS;

GoldenMoneyPathService.VERIFICATION_OUTCOMES =
  VERIFICATION_OUTCOMES;

GoldenMoneyPathService.GoldenMoneyPathError =
  GoldenMoneyPathError;

/* ============================================================================
 * Factory
 * ========================================================================== */

function createGoldenMoneyPathService(
  dependencies = {},
) {
  return new GoldenMoneyPathService(
    dependencies,
  );
}

/* ============================================================================
 * Exports
 * ========================================================================== */

module.exports =
  GoldenMoneyPathService;

module.exports.GoldenMoneyPathService =
  GoldenMoneyPathService;

module.exports.GoldenMoneyPathError =
  GoldenMoneyPathError;

module.exports.createGoldenMoneyPathService =
  createGoldenMoneyPathService;

module.exports.GOLDEN_MONEY_PATH_STAGES =
  GOLDEN_MONEY_PATH_STAGES;

module.exports.GOLDEN_MONEY_PATH_OUTCOMES =
  GOLDEN_MONEY_PATH_OUTCOMES;

module.exports.GOLDEN_MONEY_PATH_ERROR_CODES =
  GOLDEN_MONEY_PATH_ERROR_CODES;

module.exports.PAYMENT_STATES =
  PAYMENT_STATES;

module.exports.IDEMPOTENCY_STATUS =
  IDEMPOTENCY_STATUS;

module.exports.IDEMPOTENCY_OPERATION_TYPES =
  IDEMPOTENCY_OPERATION_TYPES;

module.exports.VERIFICATION_STATUS =
  VERIFICATION_STATUS;

module.exports.VERIFICATION_OUTCOMES =
  VERIFICATION_OUTCOMES;

/* ============================================================================
 * End of File
 * ============================================================================
 */