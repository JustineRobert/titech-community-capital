'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Payment Processing Service
 * ============================================================================
 *
 * File:
 *   backend/modules/payment/paymentProcessingService.js
 *
 * Purpose:
 *   Orchestrates the complete payment processing lifecycle while keeping
 *   payment workflow state, provider execution, financial posting,
 *   reconciliation, audit, and event publication separated by responsibility.
 *
 * Architectural Principles
 * ----------------------------------------------------------------------------
 * 1. PaymentProcessingService orchestrates; it does not own accounting truth.
 * 2. Payment state changes go through PaymentStateMachine.
 * 3. Financial state changes go through the approved Finance/Transaction/
 *    Posting Engine layer.
 * 4. Provider-specific behavior stays inside provider adapters.
 * 5. Provider responses are treated as external evidence.
 * 6. Every retry-sensitive operation is idempotent.
 * 7. Unknown provider outcomes are never blindly retried as new payments.
 * 8. Provider callbacks and active status polling converge on the same
 *    normalized processing pipeline.
 * 9. Amount and currency mismatches fail closed.
 * 10. Tenant isolation is enforced at every payment lookup/mutation boundary.
 * 11. Duplicate provider callbacks must produce at most one business effect.
 * 12. Payment completion does not mean ledger posting unless finance has
 *     independently committed the corresponding financial transaction.
 * 13. External provider calls are never performed while unnecessarily holding
 *     an open database transaction.
 * 14. All material operations are observable and auditable.
 * 15. Financial secrets are never logged or exposed.
 *
 * Expected High-Level Flow
 * ----------------------------------------------------------------------------
 *
 *   Request
 *      |
 *      v
 *   Authenticate / Authorize
 *      |
 *      v
 *   Tenant Resolution
 *      |
 *      v
 *   Validate Payment Request
 *      |
 *      v
 *   Idempotency
 *      |
 *      v
 *   Create / Load Payment
 *      |
 *      v
 *   PaymentStateMachine
 *      |
 *      v
 *   Provider Adapter
 *      |
 *      +------ SUCCESS -----> Confirmation Validation
 *      |
 *      +------ FAILURE -----> Safe Failure
 *      |
 *      +------ UNKNOWN -----> Reconciliation
 *      |
 *      v
 *   Payment State Update
 *      |
 *      v
 *   Financial Transaction / Posting Engine
 *      |
 *      v
 *   Ledger
 *      |
 *      v
 *   Audit + Outbox
 *      |
 *      v
 *   Reconciliation / Settlement
 *
 * This service intentionally does not directly update:
 *
 *   account.balance
 *   ledger.balance
 *   journal entries
 *   posted financial transaction amounts
 *
 * ============================================================================
 */

const crypto = require('crypto');

const PaymentStateMachine =
  require('./paymentStateMachine');

/* ============================================================================
 * Constants
 * ========================================================================== */

const PAYMENT_TYPES = Object.freeze({
  CONTRIBUTION: 'contribution',
  LOAN_REPAYMENT: 'loan_repayment',
  LOAN_DISBURSEMENT: 'loan_disbursement',
  WITHDRAWAL: 'withdrawal',
  TRANSFER: 'transfer',
  REFUND: 'refund',
  FEE: 'fee',
  OTHER: 'other',
});

const PAYMENT_DIRECTIONS = Object.freeze({
  INBOUND: 'inbound',
  OUTBOUND: 'outbound',
});

const PAYMENT_STATES =
  PaymentStateMachine.PAYMENT_STATES
  || PaymentStateMachine.STATES
  || Object.freeze({
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

const ERROR_CODES = Object.freeze({
  INVALID_PAYMENT_REQUEST:
    'INVALID_PAYMENT_REQUEST',

  PAYMENT_NOT_FOUND:
    'PAYMENT_NOT_FOUND',

  PAYMENT_ALREADY_FINAL:
    'PAYMENT_ALREADY_FINAL',

  PAYMENT_ALREADY_PROCESSING:
    'PAYMENT_ALREADY_PROCESSING',

  PAYMENT_ALREADY_SUCCESSFUL:
    'PAYMENT_ALREADY_SUCCESSFUL',

  PAYMENT_AMOUNT_MISMATCH:
    'PAYMENT_AMOUNT_MISMATCH',

  PAYMENT_CURRENCY_MISMATCH:
    'PAYMENT_CURRENCY_MISMATCH',

  PAYMENT_PROVIDER_REQUIRED:
    'PAYMENT_PROVIDER_REQUIRED',

  PROVIDER_NOT_CONFIGURED:
    'PROVIDER_NOT_CONFIGURED',

  PROVIDER_OPERATION_FAILED:
    'PROVIDER_OPERATION_FAILED',

  PROVIDER_OPERATION_TIMEOUT:
    'PROVIDER_OPERATION_TIMEOUT',

  PROVIDER_UNKNOWN_OUTCOME:
    'PROVIDER_UNKNOWN_OUTCOME',

  PROVIDER_REFERENCE_MISMATCH:
    'PROVIDER_REFERENCE_MISMATCH',

  PROVIDER_RESULT_INVALID:
    'PROVIDER_RESULT_INVALID',

  FINANCIAL_POSTING_FAILED:
    'FINANCIAL_POSTING_FAILED',

  FINANCIAL_POSTING_PENDING:
    'FINANCIAL_POSTING_PENDING',

  IDEMPOTENCY_KEY_REQUIRED:
    'IDEMPOTENCY_KEY_REQUIRED',

  IDEMPOTENCY_CONFLICT:
    'IDEMPOTENCY_CONFLICT',

  TENANT_CONTEXT_REQUIRED:
    'TENANT_CONTEXT_REQUIRED',

  TENANT_MISMATCH:
    'TENANT_MISMATCH',

  AUTHORIZATION_REQUIRED:
    'AUTHORIZATION_REQUIRED',

  INVALID_PAYMENT_STATE:
    'INVALID_PAYMENT_STATE',

  CONCURRENT_PAYMENT_UPDATE:
    'CONCURRENT_PAYMENT_UPDATE',

  RECONCILIATION_REQUIRED:
    'RECONCILIATION_REQUIRED',

  PAYMENT_FROZEN:
    'PAYMENT_FROZEN',

  FINANCIAL_FREEZE_ACTIVE:
    'FINANCIAL_FREEZE_ACTIVE',

  RISK_BLOCKED:
    'RISK_BLOCKED',

  COMPLIANCE_BLOCKED:
    'COMPLIANCE_BLOCKED',

  LIMIT_EXCEEDED:
    'LIMIT_EXCEEDED',

  OPERATION_REQUIRES_REVIEW:
    'OPERATION_REQUIRES_REVIEW',
});

const DEFAULT_OPTIONS = Object.freeze({
  strictMode: true,

  requireTenant: true,

  requireActor: true,

  requireIdempotency: true,

  defaultProviderTimeoutMs: 30000,

  maxProviderAttempts: 1,

  /**
   * The service can optionally perform controlled status recovery after an
   * ambiguous provider result.
   */
  allowProviderStatusRecovery: true,

  /**
   * Do not automatically create a second external provider operation after
   * an unknown result.
   */
  neverRetryUnknownAsNewOperation: true,

  /**
   * A successful Payment can exist before the corresponding ledger posting is
   * complete, but the service records the financial posting relationship and
   * never lies that the ledger is posted.
   */
  allowPaymentSuccessBeforeLedgerPost:
    true,

  /**
   * If enabled, payment completion waits for an injected financial processor.
   * In deployments using asynchronous financial posting, this can be false.
   */
  requireFinancialPostingForCompletedResponse:
    false,

  /**
   * Amounts are compared as canonical decimal strings.
   */
  normalizeAmountScale:
    false,

  /**
   * Provider operations should be retried only when the adapter explicitly
   * declares the error safe to retry.
   */
  retryProviderTransientFailures:
    true,

  /**
   * Notifications/events are expected to be outbox-backed in production.
   */
  strictEventPublication:
    false,

  /**
   * Logging must always redact sensitive information.
   */
  redactSensitiveData:
    true,
});

/* ============================================================================
 * Error Class
 * ========================================================================== */

class PaymentProcessingError extends Error {
  constructor(message, options = {}) {
    super(message);

    this.name =
      'PaymentProcessingError';

    this.code =
      options.code
      || ERROR_CODES.INVALID_PAYMENT_REQUEST;

    this.statusCode =
      Number.isInteger(options.statusCode)
        ? options.statusCode
        : 400;

    this.paymentId =
      options.paymentId || null;

    this.tenantId =
      options.tenantId || null;

    this.operationId =
      options.operationId || null;

    this.provider =
      options.provider || null;

    this.retryable =
      options.retryable === true;

    this.unknownOutcome =
      options.unknownOutcome === true;

    this.details =
      options.details || {};

    if (options.cause) {
      this.cause =
        options.cause;
    }

    Error.captureStackTrace?.(
      this,
      PaymentProcessingError,
    );
  }
}

/* ============================================================================
 * Utility Functions
 * ========================================================================== */

function isNonEmptyString(value) {
  return (
    typeof value === 'string'
    && value.trim().length > 0
  );
}

function normalizeString(value) {
  return isNonEmptyString(value)
    ? value.trim()
    : null;
}

function normalizeProvider(value) {
  const provider =
    normalizeString(value);

  return provider
    ? provider.toLowerCase()
    : null;
}

function normalizeType(value) {
  const type =
    normalizeString(value);

  return type
    ? type.toLowerCase()
    : null;
}

function normalizeDirection(value) {
  const direction =
    normalizeString(value);

  return direction
    ? direction.toLowerCase()
    : null;
}

function normalizeAmount(value) {
  if (
    value === undefined
    || value === null
    || value === ''
  ) {
    return null;
  }

  if (
    typeof value === 'string'
    || typeof value === 'number'
  ) {
    return String(value);
  }

  if (
    value
    && typeof value.toString === 'function'
  ) {
    return value.toString();
  }

  return null;
}

function canonicalAmount(value) {
  const amount =
    normalizeAmount(value);

  if (!amount) {
    return null;
  }

  const normalized =
    amount.trim();

  if (
    !/^\d+(\.\d+)?$/.test(
      normalized,
    )
  ) {
    return null;
  }

  /**
   * Avoid JavaScript Number conversion.
   * Remove insignificant leading zeros.
   */
  const [integerPart, decimalPart] =
    normalized.split('.');

  const integer =
    integerPart.replace(
      /^0+(?=\d)/,
      '',
    );

  const decimal =
    decimalPart
      ? decimalPart.replace(
        /0+$/,
        '',
      )
      : '';

  return decimal
    ? `${integer}.${decimal}`
    : integer;
}

function canonicalCurrency(value) {
  const currency =
    normalizeString(value);

  if (!currency) {
    return null;
  }

  return currency.toUpperCase();
}

function clone(value) {
  if (
    value === undefined
    || value === null
  ) {
    return value;
  }

  if (
    typeof structuredClone === 'function'
  ) {
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

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(
      typeof value === 'string'
        ? value
        : JSON.stringify(
          value,
        ),
    )
    .digest('hex');
}

function now() {
  return new Date();
}

function isoNow() {
  return now().toISOString();
}

function toPlainObject(value) {
  if (!value) {
    return value;
  }

  if (
    typeof value.toObject === 'function'
  ) {
    return value.toObject();
  }

  return value;
}

function parseVersion(value) {
  if (
    value === undefined
    || value === null
    || value === ''
  ) {
    return null;
  }

  const parsed =
    Number(value);

  if (
    !Number.isSafeInteger(parsed)
    || parsed < 0
  ) {
    return null;
  }

  return parsed;
}

function safeId(value) {
  if (
    value
    && typeof value.toString
      === 'function'
  ) {
    return value.toString();
  }

  return normalizeString(
    value,
  );
}

function createOperationId(prefix = 'payment') {
  return `${prefix}_${crypto.randomUUID()}`;
}

function normalizeContext(
  rawContext = {},
) {
  return {
    operationId:
      normalizeString(
        rawContext.operationId,
      )
      || createOperationId(
        'payment_op',
      ),

    actorId:
      normalizeString(
        rawContext.actorId,
      ),

    actorType:
      normalizeString(
        rawContext.actorType,
      )
      || 'USER',

    actorRole:
      normalizeString(
        rawContext.actorRole,
      ),

    tenantId:
      normalizeString(
        rawContext.tenantId,
      ),

    requestId:
      normalizeString(
        rawContext.requestId,
      ),

    correlationId:
      normalizeString(
        rawContext.correlationId,
      ),

    causationId:
      normalizeString(
        rawContext.causationId,
      ),

    idempotencyKey:
      normalizeString(
        rawContext.idempotencyKey,
      ),

    reason:
      normalizeString(
        rawContext.reason,
      ),

    reasonCode:
      normalizeString(
        rawContext.reasonCode,
      ),

    provider:
      normalizeProvider(
        rawContext.provider,
      ),

    providerTransactionId:
      normalizeString(
        rawContext.providerTransactionId,
      ),

    providerEventId:
      normalizeString(
        rawContext.providerEventId,
      ),

    expectedVersion:
      parseVersion(
        rawContext.expectedVersion,
      ),

    fromCallback:
      rawContext.fromCallback === true,

    isRetry:
      rawContext.isRetry === true,

    metadata:
      rawContext.metadata
      && typeof rawContext.metadata
        === 'object'
        ? clone(
          rawContext.metadata,
        )
        : {},

    persistenceContext:
      rawContext.persistenceContext
      || null,
  };
}

function isProbablyTransientError(
  error,
) {
  const code =
    String(
      error?.code || '',
    ).toUpperCase();

  const status =
    Number(
      error?.statusCode
      || error?.status
      || 0,
    );

  return (
    [
      'ETIMEDOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      'EAI_AGAIN',
      'ENETUNREACH',
      'EHOSTUNREACH',
      'TIMEOUT',
      'UPSTREAM_TIMEOUT',
      'PROVIDER_UNAVAILABLE',
    ].includes(code)
    || [
      408,
      425,
      429,
      500,
      502,
      503,
      504,
    ].includes(status)
  );
}

/* ============================================================================
 * Payment Processing Service
 * ========================================================================== */

class PaymentProcessingService {
  /**
   * @param {Object} dependencies
   *
   * Expected dependencies:
   *
   * paymentRepository
   * paymentStateMachine
   * providerRegistry
   * financialService / transactionService / financeService
   * reconciliationService
   * auditService
   * eventPublisher
   * riskService
   * complianceService
   * limitService
   * logger
   */
  constructor(
    dependencies = {},
  ) {
    this.paymentRepository =
      dependencies.paymentRepository
      || null;

    this.paymentStateMachine =
      dependencies.paymentStateMachine
      || new PaymentStateMachine({
        paymentRepository:
          this.paymentRepository,
        auditService:
          dependencies.auditService,
        eventPublisher:
          dependencies.eventPublisher,
        logger:
          dependencies.logger
          || console,
        options:
          dependencies.paymentStateMachineOptions
          || {},
      });

    this.providerRegistry =
      dependencies.providerRegistry
      || dependencies.paymentProviderRegistry
      || null;

    this.financialService =
      dependencies.financialService
      || dependencies.transactionService
      || dependencies.financeService
      || null;

    this.reconciliationService =
      dependencies.reconciliationService
      || null;

    this.auditService =
      dependencies.auditService
      || null;

    this.eventPublisher =
      dependencies.eventPublisher
      || null;

    this.riskService =
      dependencies.riskService
      || null;

    this.complianceService =
      dependencies.complianceService
      || null;

    this.limitService =
      dependencies.limitService
      || null;

    this.notificationService =
      dependencies.notificationService
      || null;

    this.logger =
      dependencies.logger
      || console;

    this.options = Object.freeze({
      ...DEFAULT_OPTIONS,
      ...(dependencies.options || {}),
    });
  }

  /* ==========================================================================
   * Public Validation
   * ======================================================================== */

  validateCreateRequest(
    rawRequest = {},
  ) {
    const request =
      this._normalizePaymentRequest(
        rawRequest,
      );

    const errors = [];

    if (!request.tenantId) {
      errors.push(
        'tenantId is required',
      );
    }

    if (!request.userId) {
      errors.push(
        'userId is required',
      );
    }

    if (!request.amount) {
      errors.push(
        'amount is required',
      );
    }

    if (!request.currency) {
      errors.push(
        'currency is required',
      );
    }

    if (!request.type) {
      errors.push(
        'payment type is required',
      );
    }

    if (!request.direction) {
      errors.push(
        'payment direction is required',
      );
    }

    if (
      request.amount
      && !/^\d+(\.\d+)?$/.test(
        request.amount,
      )
    ) {
      errors.push(
        'amount must be a valid positive decimal value',
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
      request.direction
      && !Object.values(
        PAYMENT_DIRECTIONS,
      ).includes(
        request.direction,
      )
    ) {
      errors.push(
        'invalid payment direction',
      );
    }

    if (
      request.type
      && !Object.values(
        PAYMENT_TYPES,
      ).includes(
        request.type,
      )
    ) {
      errors.push(
        'invalid payment type',
      );
    }

    return {
      valid:
        errors.length === 0,

      errors,

      request,
    };
  }

  /* ==========================================================================
   * Primary API — Create + Initiate
   * ======================================================================== */

  async createAndInitiate(
    rawRequest = {},
    rawContext = {},
  ) {
    const context =
      normalizeContext(
        rawContext,
      );

    const request =
      this._normalizePaymentRequest(
        rawRequest,
      );

    this._assertContext(
      context,
    );

    this._validateOrThrow(
      request,
      context,
    );

    await this._runPreProcessingControls(
      request,
      context,
    );

    /**
     * Idempotency must be checked before creating a second payment.
     */
    const existing =
      await this._findExistingByIdempotency(
        request,
        context,
      );

    if (existing) {
      return this._buildIdempotentResult(
        existing,
        context,
      );
    }

    const payment =
      await this._createPayment(
        request,
        context,
      );

    const initiated =
      await this.paymentStateMachine.initiate(
        payment,
        {
          ...context,
          reasonCode:
            'PAYMENT_CREATED',
        },
      );

    return {
      success: true,

      paymentId:
        payment.id
        || safeId(
          payment._id,
        ),

      status:
        initiated.currentState,

      state:
        initiated,

      payment:
        this._sanitizePaymentForResponse(
          payment,
        ),

      operationId:
        context.operationId,

      requestId:
        context.requestId,

      correlationId:
        context.correlationId,
    };
  }

  /**
   * Start an already-created payment.
   *
   * This is the canonical orchestration method for synchronous/asynchronous
   * provider execution.
   */
  async process(
    paymentOrId,
    rawContext = {},
  ) {
    const context =
      normalizeContext(
        rawContext,
      );

    this._assertContext(
      context,
    );

    let payment =
      await this._loadPayment(
        paymentOrId,
        context,
      );

    payment =
      this._normalizePayment(
        payment,
      );

    const operationContext =
      this._mergePaymentContext(
        context,
        payment,
      );

    await this._assertPaymentTenant(
      payment,
      operationContext,
    );

    /**
     * If already successfully completed, return current authoritative state.
     */
    if (
      payment.status
      === PAYMENT_STATES.SUCCESSFUL
    ) {
      return this._buildAlreadySuccessfulResult(
        payment,
        operationContext,
      );
    }

    if (
      payment.status
      === PAYMENT_STATES.REVERSED
    ) {
      throw new PaymentProcessingError(
        'A reversed payment cannot be processed again.',
        {
          code:
            ERROR_CODES.PAYMENT_ALREADY_FINAL,
          statusCode: 409,
          paymentId:
            payment.id,
          tenantId:
            operationContext.tenantId,
        },
      );
    }

    /**
     * Ensure risk/compliance/limit checks happen before external execution.
     */
    await this._runPreProcessingControlsForPayment(
      payment,
      operationContext,
    );

    /**
     * Move payment into PROCESSING.
     */
    if (
      [
        PAYMENT_STATES.INITIATED,
        PAYMENT_STATES.PENDING,
        PAYMENT_STATES.RETRYING,
      ].includes(
        payment.status,
      )
    ) {
      const processing =
        await this.paymentStateMachine.process(
          payment,
          {
            ...operationContext,

            expectedVersion:
              operationContext.expectedVersion
              ?? payment.version,

            reasonCode:
              'PAYMENT_PROCESSING_STARTED',
          },
        );

      payment =
        await this._reloadPayment(
          payment.id,
          operationContext,
        );

      /**
       * If repository does not return the updated entity, retain the state
       * machine result as local authoritative workflow state.
       */
      payment =
        payment || {
          ...payment,
          status:
            processing.currentState,
          version:
            processing.version,
        };
    }

    const provider =
      await this._resolveProvider(
        payment,
        operationContext,
      );

    if (!provider) {
      throw new PaymentProcessingError(
        'No payment provider is configured for this payment.',
        {
          code:
            ERROR_CODES.PROVIDER_NOT_CONFIGURED,
          statusCode: 503,
          paymentId:
            payment.id,
          tenantId:
            operationContext.tenantId,
          provider:
            payment.provider,
          retryable:
            false,
        },
      );
    }

    /**
     * Perform external provider operation outside any database transaction.
     */
    let providerResult;

    try {
      providerResult =
        await this._executeProviderOperation(
          provider,
          payment,
          operationContext,
        );
    } catch (error) {
      return this._handleProviderExecutionError(
        payment,
        provider,
        error,
        operationContext,
      );
    }

    const normalizedResult =
      this._normalizeProviderResult(
        providerResult,
        payment,
        provider,
      );

    /**
     * External provider result is an assertion that must pass internal checks.
     */
    await this._validateProviderResult(
      payment,
      normalizedResult,
      operationContext,
    );

    return this._processProviderResult(
      payment,
      normalizedResult,
      operationContext,
    );
  }

  /* ==========================================================================
   * Provider Result Processing
   * ======================================================================== */

  async _processProviderResult(
    payment,
    providerResult,
    context,
  ) {
    switch (
      providerResult.outcome
    ) {
      case 'SUCCESS':
        return this._handleProviderSuccess(
          payment,
          providerResult,
          context,
        );

      case 'FAILED':
        return this._handleProviderFailure(
          payment,
          providerResult,
          context,
        );

      case 'PENDING':
        return this._handleProviderPending(
          payment,
          providerResult,
          context,
        );

      case 'CANCELLED':
        return this._handleProviderCancelled(
          payment,
          providerResult,
          context,
        );

      case 'REVERSED':
        return this._handleProviderReversed(
          payment,
          providerResult,
          context,
        );

      case 'UNKNOWN':
      default:
        return this._handleProviderUnknown(
          payment,
          providerResult,
          context,
        );
    }
  }

  async _handleProviderSuccess(
    payment,
    providerResult,
    context,
  ) {
    /**
     * Update payment workflow state first. Financial posting remains
     * deliberately separate.
     */
    const successState =
      await this.paymentStateMachine.succeed(
        payment,
        {
          ...context,

          provider:
            providerResult.provider,

          providerTransactionId:
            providerResult.providerTransactionId,

          providerEventId:
            providerResult.providerEventId,

          providerConfirmed:
            true,

          reason:
            providerResult.reason
            || context.reason,

          reasonCode:
            'PROVIDER_PAYMENT_CONFIRMED',
        },
      );

    /**
     * Reload to ensure we use the latest state/version from the repository.
     */
    const updatedPayment =
      await this._reloadPayment(
        payment.id,
        context,
      );

    const effectivePayment =
      updatedPayment
      || {
        ...payment,
        status:
          successState.currentState,
        version:
          successState.version,
        providerTransactionId:
          providerResult.providerTransactionId
          || payment.providerTransactionId,
        providerEventId:
          providerResult.providerEventId
          || payment.providerEventId,
      };

    /**
     * Financial posting.
     *
     * The payment may become SUCCESSFUL before ledger posting if the
     * architecture supports asynchronous accounting.
     */
    const financialResult =
      await this._postFinancialEffect(
        effectivePayment,
        providerResult,
        context,
      );

    const finalPayment =
      await this._reloadPayment(
        payment.id,
        context,
      );

    return {
      success: true,

      outcome:
        'SUCCESS',

      paymentId:
        payment.id,

      status:
        finalPayment?.status
        || successState.currentState,

      payment:
        this._sanitizePaymentForResponse(
          finalPayment
          || effectivePayment,
        ),

      provider:
        this._sanitizeProviderResult(
          providerResult,
        ),

      financial:
        financialResult,

      operationId:
        context.operationId,

      requestId:
        context.requestId,

      correlationId:
        context.correlationId,
    };
  }

  async _handleProviderFailure(
    payment,
    providerResult,
    context,
  ) {
    const failure =
      await this.paymentStateMachine.fail(
        payment,
        {
          ...context,

          provider:
            providerResult.provider,

          providerTransactionId:
            providerResult.providerTransactionId,

          providerEventId:
            providerResult.providerEventId,

          providerFailed:
            true,

          reason:
            providerResult.failureReason
            || context.reason,

          reasonCode:
            providerResult.reasonCode
            || 'PROVIDER_PAYMENT_FAILED',
        },
      );

    return {
      success: true,

      outcome:
        'FAILED',

      paymentId:
        payment.id,

      status:
        failure.currentState,

      payment:
        this._sanitizePaymentForResponse(
          await this._reloadPayment(
            payment.id,
            context,
          )
          || payment,
        ),

      provider:
        this._sanitizeProviderResult(
          providerResult,
        ),

      operationId:
        context.operationId,

      requestId:
        context.requestId,

      correlationId:
        context.correlationId,
    };
  }

  async _handleProviderPending(
    payment,
    providerResult,
    context,
  ) {
    const pending =
      await this.paymentStateMachine.pend(
        payment,
        {
          ...context,

          provider:
            providerResult.provider,

          providerTransactionId:
            providerResult.providerTransactionId,

          providerEventId:
            providerResult.providerEventId,

          reasonCode:
            'PROVIDER_PAYMENT_PENDING',
        },
      );

    return {
      success: true,

      outcome:
        'PENDING',

      paymentId:
        payment.id,

      status:
        pending.currentState,

      payment:
        this._sanitizePaymentForResponse(
          await this._reloadPayment(
            payment.id,
            context,
          )
          || payment,
        ),

      provider:
        this._sanitizeProviderResult(
          providerResult,
        ),

      operationId:
        context.operationId,

      requestId:
        context.requestId,

      correlationId:
        context.correlationId,
    };
  }

  async _handleProviderCancelled(
    payment,
    providerResult,
    context,
  ) {
    const cancelled =
      await this.paymentStateMachine.cancel(
        payment,
        {
          ...context,

          provider:
            providerResult.provider,

          providerTransactionId:
            providerResult.providerTransactionId,

          providerEventId:
            providerResult.providerEventId,

          providerFailed:
            true,

          reasonCode:
            'PROVIDER_PAYMENT_CANCELLED',
        },
      );

    return {
      success: true,

      outcome:
        'CANCELLED',

      paymentId:
        payment.id,

      status:
        cancelled.currentState,

      payment:
        this._sanitizePaymentForResponse(
          await this._reloadPayment(
            payment.id,
            context,
          )
          || payment,
        ),

      provider:
        this._sanitizeProviderResult(
          providerResult,
        ),
    };
  }

  async _handleProviderReversed(
    payment,
    providerResult,
    context,
  ) {
    /**
     * A provider reversal is external evidence. The internal payment cannot
     * become REVERSED without a distinct reversal payment/financial operation.
     */
    const reversalPaymentId =
      providerResult.reversalPaymentId
      || context.reversalPaymentId
      || null;

    if (!reversalPaymentId) {
      return this._moveToReconciliation(
        payment,
        context,
        {
          reasonCode:
            'PROVIDER_REVERSAL_WITHOUT_INTERNAL_REVERSAL_REFERENCE',

          providerResult,
        },
      );
    }

    const reversed =
      await this.paymentStateMachine.reverse(
        payment,
        {
          ...context,

          provider:
            providerResult.provider,

          providerTransactionId:
            providerResult.providerTransactionId,

          providerEventId:
            providerResult.providerEventId,

          reversalPaymentId,

          reasonCode:
            'PROVIDER_PAYMENT_REVERSED',
        },
      );

    return {
      success: true,

      outcome:
        'REVERSED',

      paymentId:
        payment.id,

      status:
        reversed.currentState,

      payment:
        this._sanitizePaymentForResponse(
          await this._reloadPayment(
            payment.id,
            context,
          )
          || payment,
        ),

      provider:
        this._sanitizeProviderResult(
          providerResult,
        ),
    };
  }

  async _handleProviderUnknown(
    payment,
    providerResult,
    context,
  ) {
    /**
     * Never create a second provider payment operation when the existing
     * operation has an unknown outcome.
     */
    const unknown =
      await this.paymentStateMachine.markUnknown(
        payment,
        {
          ...context,

          provider:
            providerResult.provider,

          providerTransactionId:
            providerResult.providerTransactionId
            || payment.providerTransactionId,

          providerEventId:
            providerResult.providerEventId,

          reasonCode:
            'PROVIDER_PAYMENT_OUTCOME_UNKNOWN',
        },
      );

    if (
      this.options.allowProviderStatusRecovery
      && this._providerCanQueryStatus(
        providerResult,
      )
    ) {
      const recovery =
        await this._attemptProviderStatusRecovery(
          payment,
          providerResult,
          context,
        );

      if (recovery) {
        return recovery;
      }
    }

    return this._moveToReconciliation(
      payment,
      context,
      {
        reasonCode:
          'PROVIDER_PAYMENT_OUTCOME_UNKNOWN',

        providerResult,

        currentState:
          unknown.currentState,
      },
    );
  }

  /* ==========================================================================
   * Financial Integration
   * ======================================================================== */

  async _postFinancialEffect(
    payment,
    providerResult,
    context,
  ) {
    /**
     * If no Finance service is configured, fail closed in strict production
     * mode rather than pretending that payment completion equals ledger
     * posting.
     */
    if (!this.financialService) {
      if (
        this.options.allowPaymentSuccessBeforeLedgerPost
      ) {
        return {
          attempted:
            false,

          posted:
            false,

          status:
            'NOT_CONFIGURED',

          financialTransactionId:
            payment.financialTransactionId
            || null,
        };
      }

      throw new PaymentProcessingError(
        'Financial posting service is not configured.',
        {
          code:
            ERROR_CODES.FINANCIAL_POSTING_FAILED,
          statusCode: 503,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
        },
      );
    }

    /**
     * Prevent duplicate financial posting if a financial transaction is
     * already linked.
     */
    if (
      payment.financialTransactionId
    ) {
      const existing =
        await this._getFinancialTransaction(
          payment.financialTransactionId,
          context,
        );

      if (
        existing
        && this._isFinancialPosted(
          existing,
        )
      ) {
        return {
          attempted:
            false,

          posted:
            true,

          status:
            'ALREADY_POSTED',

          financialTransactionId:
            payment.financialTransactionId,
        };
      }
    }

    const payload = {
      paymentId:
        payment.id,

      tenantId:
        payment.tenantId
        || context.tenantId,

      userId:
        payment.userId
        || null,

      groupId:
        payment.groupId
        || null,

      loanId:
        payment.loanId
        || null,

      type:
        this._financialTransactionType(
          payment,
        ),

      amount:
        normalizeAmount(
          payment.amount,
        ),

      currency:
        canonicalCurrency(
          payment.currency,
        ),

      direction:
        normalizeDirection(
          payment.direction,
        ),

      provider:
        payment.provider
        || providerResult.provider
        || null,

      providerTransactionId:
        providerResult.providerTransactionId
        || payment.providerTransactionId
        || null,

      sourceType:
        'PAYMENT',

      sourceId:
        payment.id,

      idempotencyKey:
        context.idempotencyKey
        || this._paymentPostingIdempotencyKey(
          payment,
        ),

      correlationId:
        context.correlationId,

      requestId:
        context.requestId,

      metadata:
        this._redactMetadata(
          {
            ...(
              context.metadata
              || {}
            ),

            providerEventId:
              providerResult.providerEventId
              || null,
          },
        ),
    };

    let result;

    try {
      result =
        await this._executeFinancialPosting(
          payload,
          context,
        );
    } catch (error) {
      this._logError(
        'Payment financial posting failed.',
        error,
        {
          paymentId:
            payment.id,

          tenantId:
            context.tenantId,

          operationId:
            context.operationId,
        },
      );

      /**
       * A financial posting timeout is not necessarily a financial failure.
       * Reconciliation should determine the authoritative outcome.
       */
      if (
        this._isUnknownFinancialOutcomeError(
          error,
        )
      ) {
        return this._movePaymentToFinancialReconciliation(
          payment,
          context,
          error,
        );
      }

      throw new PaymentProcessingError(
        'Payment financial posting failed.',
        {
          code:
            ERROR_CODES.FINANCIAL_POSTING_FAILED,
          statusCode:
            Number(
              error?.statusCode,
            ) || 503,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
          retryable:
            isProbablyTransientError(
              error,
            ),
          cause:
            error,
        },
      );
    }

    const normalizedFinancial =
      this._normalizeFinancialResult(
        result,
      );

    /**
     * Persist linkage from payment -> financial transaction where supported.
     */
    if (
      normalizedFinancial.financialTransactionId
    ) {
      await this._linkFinancialTransaction(
        payment,
        normalizedFinancial,
        context,
      );
    }

    return normalizedFinancial;
  }

  async _executeFinancialPosting(
    payload,
    context,
  ) {
    if (
      typeof this.financialService
        .postPayment === 'function'
    ) {
      return this.financialService.postPayment(
        payload,
        context,
      );
    }

    if (
      typeof this.financialService
        .post === 'function'
    ) {
      return this.financialService.post(
        payload,
        context,
      );
    }

    if (
      typeof this.financialService
        .recordPayment === 'function'
    ) {
      return this.financialService.recordPayment(
        payload,
        context,
      );
    }

    if (
      typeof this.financialService
        .createTransaction === 'function'
    ) {
      return this.financialService.createTransaction(
        payload,
        context,
      );
    }

    throw new PaymentProcessingError(
      'No supported financial posting operation exists on the configured finance service.',
      {
        code:
          ERROR_CODES.FINANCIAL_POSTING_FAILED,
        statusCode: 500,
        tenantId:
          context.tenantId,
      },
    );
  }

  async _getFinancialTransaction(
    financialTransactionId,
    context,
  ) {
    if (!this.financialService) {
      return null;
    }

    if (
      typeof this.financialService
        .getTransaction === 'function'
    ) {
      return this.financialService.getTransaction(
        financialTransactionId,
        context,
      );
    }

    if (
      typeof this.financialService
        .findTransaction === 'function'
    ) {
      return this.financialService.findTransaction(
        financialTransactionId,
        context,
      );
    }

    return null;
  }

  _isFinancialPosted(
    transaction,
  ) {
    if (!transaction) {
      return false;
    }

    const status =
      String(
        transaction.status
        || '',
      ).toUpperCase();

    return [
      'POSTED',
      'COMPLETED',
      'SUCCESSFUL',
    ].includes(
      status,
    );
  }

  _normalizeFinancialResult(
    result,
  ) {
    const plain =
      toPlainObject(
        result,
      )
      || {};

    const status =
      String(
        plain.status
        || '',
      ).toUpperCase();

    return {
      attempted:
        true,

      posted:
        Boolean(
          plain.posted
          || [
            'POSTED',
            'COMPLETED',
            'SUCCESSFUL',
          ].includes(
            status,
          ),
        ),

      status:
        status
        || (
          plain.posted
            ? 'POSTED'
            : 'UNKNOWN'
        ),

      financialTransactionId:
        normalizeString(
          plain.financialTransactionId
          || plain.transactionId
          || plain.id,
        ),

      journalId:
        normalizeString(
          plain.journalId,
        ),

      message:
        normalizeString(
          plain.message,
        ),
    };
  }

  _isUnknownFinancialOutcomeError(
    error,
  ) {
    if (!error) {
      return false;
    }

    if (
      error.unknownOutcome === true
    ) {
      return true;
    }

    const code =
      String(
        error.code
        || '',
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

  _financialTransactionType(
    payment,
  ) {
    switch (
      normalizeType(
        payment.type,
      )
    ) {
      case PAYMENT_TYPES.CONTRIBUTION:
        return 'CONTRIBUTION';

      case PAYMENT_TYPES.LOAN_REPAYMENT:
        return 'LOAN_REPAYMENT';

      case PAYMENT_TYPES.LOAN_DISBURSEMENT:
        return 'LOAN_DISBURSEMENT';

      case PAYMENT_TYPES.WITHDRAWAL:
        return 'WITHDRAWAL';

      case PAYMENT_TYPES.TRANSFER:
        return 'TRANSFER';

      case PAYMENT_TYPES.REFUND:
        return 'REFUND';

      case PAYMENT_TYPES.FEE:
        return 'FEE';

      default:
        return 'PAYMENT';
    }
  }

  _paymentPostingIdempotencyKey(
    payment,
  ) {
    return `payment-posting:${payment.id}`;
  }

  async _linkFinancialTransaction(
    payment,
    financialResult,
    context,
  ) {
    if (
      !this.paymentRepository
    ) {
      return null;
    }

    const paymentId =
      payment.id;

    const patch = {
      financialTransactionId:
        financialResult
          .financialTransactionId,

      financialJournalId:
        financialResult.journalId
        || null,

      financialPostingStatus:
        financialResult.posted
          ? 'POSTED'
          : financialResult.status,

      updatedAt:
        now(),

      updatedBy:
        context.actorId,
    };

    if (
      typeof this.paymentRepository
        .linkFinancialTransaction
        === 'function'
    ) {
      return this.paymentRepository
        .linkFinancialTransaction(
          paymentId,
          patch,
          {
            tenantId:
              context.tenantId,

            persistenceContext:
              context.persistenceContext,
          },
        );
    }

    if (
      typeof this.paymentRepository
        .updateFinancialLink
        === 'function'
    ) {
      return this.paymentRepository
        .updateFinancialLink(
          paymentId,
          patch,
          {
            tenantId:
              context.tenantId,

            persistenceContext:
              context.persistenceContext,
          },
        );
    }

    return null;
  }

  /* ==========================================================================
   * Provider Resolution / Execution
   * ======================================================================== */

  async _resolveProvider(
    payment,
    context,
  ) {
    const providerName =
      normalizeProvider(
        payment.provider
        || context.provider,
      );

    if (!providerName) {
      throw new PaymentProcessingError(
        'Payment provider is required.',
        {
          code:
            ERROR_CODES.PROVIDER_NOT_CONFIGURED,
          statusCode: 400,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
        },
      );
    }

    if (
      !this.providerRegistry
    ) {
      throw new PaymentProcessingError(
        'Payment provider registry is not configured.',
        {
          code:
            ERROR_CODES.PROVIDER_NOT_CONFIGURED,
          statusCode: 503,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
          provider:
            providerName,
        },
      );
    }

    let provider = null;

    if (
      typeof this.providerRegistry
        .get === 'function'
    ) {
      provider =
        await this.providerRegistry.get(
          providerName,
          {
            tenantId:
              context.tenantId,

            payment:
              clone(payment),
          },
        );
    } else if (
      typeof this.providerRegistry
        .resolve === 'function'
    ) {
      provider =
        await this.providerRegistry.resolve(
          providerName,
          {
            tenantId:
              context.tenantId,

            payment:
              clone(payment),
          },
        );
    } else if (
      this.providerRegistry[
        providerName
      ]
    ) {
      provider =
        this.providerRegistry[
          providerName
        ];
    }

    if (!provider) {
      throw new PaymentProcessingError(
        'Payment provider could not be resolved.',
        {
          code:
            ERROR_CODES.PROVIDER_NOT_CONFIGURED,
          statusCode: 503,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
          provider:
            providerName,
        },
      );
    }

    return provider;
  }

  async _executeProviderOperation(
    provider,
    payment,
    context,
  ) {
    const payload =
      this._buildProviderRequest(
        payment,
        context,
      );

    const timeoutMs =
      Number(
        payment.providerTimeoutMs
        || this.options
          .defaultProviderTimeoutMs,
      );

    const maxAttempts =
      Math.max(
        1,
        Number(
          this.options
            .maxProviderAttempts,
        ),
      );

    let attempt = 0;
    let lastError = null;

    while (
      attempt < maxAttempts
    ) {
      attempt += 1;

      try {
        const operation =
          () => this._invokeProvider(
            provider,
            payment,
            payload,
            {
              ...context,
              attempt,
            },
          );

        return await this._withTimeout(
          operation,
          timeoutMs,
        );
      } catch (error) {
        lastError =
          error;

        const retryable =
          this._isProviderRetryable(
            error,
            provider,
            payment,
          );

        /**
         * Critical safety rule:
         * Unknown outcome from an external financial operation must never be
         * retried as a new operation.
         */
        if (
          this._isUnknownProviderOutcome(
            error,
          )
          && this.options
            .neverRetryUnknownAsNewOperation
        ) {
          throw new PaymentProcessingError(
            'Provider operation outcome is unknown and requires reconciliation.',
            {
              code:
                ERROR_CODES
                  .PROVIDER_UNKNOWN_OUTCOME,
              statusCode: 202,
              paymentId:
                payment.id,
              tenantId:
                context.tenantId,
              provider:
                payment.provider,
              retryable:
                false,
              unknownOutcome:
                true,
              cause:
                error,
            },
          );
        }

        if (
          !retryable
          || !this.options
            .retryProviderTransientFailures
          || attempt >= maxAttempts
        ) {
          throw error;
        }

        await this._backoff(
          attempt,
          context,
        );
      }
    }

    throw lastError
      || new PaymentProcessingError(
        'Provider operation failed.',
        {
          code:
            ERROR_CODES
              .PROVIDER_OPERATION_FAILED,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
        },
      );
  }

  async _invokeProvider(
    provider,
    payment,
    payload,
    context,
  ) {
    if (
      typeof provider
        .initiatePayment === 'function'
    ) {
      return provider.initiatePayment(
        payload,
        context,
      );
    }

    if (
      typeof provider
        .processPayment === 'function'
    ) {
      return provider.processPayment(
        payload,
        context,
      );
    }

    if (
      typeof provider
        .pay === 'function'
    ) {
      return provider.pay(
        payload,
        context,
      );
    }

    if (
      typeof provider
        .createPayment === 'function'
    ) {
      return provider.createPayment(
        payload,
        context,
      );
    }

    throw new PaymentProcessingError(
      'Configured payment provider does not implement a supported payment operation.',
      {
        code:
          ERROR_CODES
            .PROVIDER_OPERATION_FAILED,
        statusCode: 500,
        paymentId:
          payment.id,
        tenantId:
          context.tenantId,
        provider:
          payment.provider,
      },
    );
  }

  _buildProviderRequest(
    payment,
    context,
  ) {
    return {
      paymentId:
        payment.id,

      paymentReference:
        payment.paymentReference
        || payment.reference
        || null,

      amount:
        normalizeAmount(
          payment.amount,
        ),

      currency:
        canonicalCurrency(
          payment.currency,
        ),

      direction:
        normalizeDirection(
          payment.direction,
        ),

      type:
        normalizeType(
          payment.type,
        ),

      customerReference:
        payment.customerReference
        || payment.userId
        || null,

      phoneNumber:
        payment.phoneNumber
        || payment.msisdn
        || null,

      accountReference:
        payment.accountReference
        || null,

      recipient:
        payment.recipient
        || null,

      metadata:
        this._redactMetadata(
          payment.metadata
          || {},
        ),

      idempotencyKey:
        context.idempotencyKey
        || payment.idempotencyKey
        || `payment:${payment.id}`,
    };
  }

  async _withTimeout(
    operation,
    timeoutMs,
  ) {
    if (
      !Number.isFinite(
        timeoutMs,
      )
      || timeoutMs <= 0
    ) {
      return operation();
    }

    let timer = null;

    const timeoutPromise =
      new Promise(
        (_, reject) => {
          timer =
            setTimeout(
              () => {
                const error =
                  new Error(
                    'Payment provider operation timed out.',
                  );

                error.code =
                  'ETIMEDOUT';

                reject(error);
              },
              timeoutMs,
            );
        },
      );

    try {
      return await Promise.race([
        operation(),
        timeoutPromise,
      ]);
    } finally {
      if (timer) {
        clearTimeout(
          timer,
        );
      }
    }
  }

  _isProviderRetryable(
    error,
    provider,
    payment,
  ) {
    if (
      error
      && typeof error.retryable
        === 'boolean'
    ) {
      return error.retryable;
    }

    if (
      typeof provider
        .isRetryableError
        === 'function'
    ) {
      try {
        return provider.isRetryableError(
          error,
          payment,
        );
      } catch (_error) {
        return false;
      }
    }

    return isProbablyTransientError(
      error,
    );
  }

  _isUnknownProviderOutcome(
    error,
  ) {
    if (!error) {
      return false;
    }

    if (
      error.unknownOutcome === true
    ) {
      return true;
    }

    const code =
      String(
        error.code
        || '',
      ).toUpperCase();

    return [
      'ETIMEDOUT',
      'ECONNRESET',
      'UNKNOWN_OUTCOME',
      'PROVIDER_TIMEOUT',
      'PROVIDER_OPERATION_UNKNOWN',
    ].includes(
      code,
    );
  }

  async _backoff(
    attempt,
    context,
  ) {
    /**
     * Bounded exponential backoff with jitter.
     *
     * Keep it modest because payment APIs often have provider-specific retry
     * windows that should be implemented by the provider adapter when needed.
     */
    const base =
      Math.min(
        2000,
        250 * (2 ** Math.max(
          0,
          attempt - 1,
        )),
      );

    const jitter =
      Math.floor(
        Math.random() * 100,
      );

    const delay =
      base + jitter;

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          delay,
        ),
    );

    this._logDebug(
      'Payment provider retry scheduled.',
      {
        operationId:
          context.operationId,

        attempt,

        delayMs:
          delay,
      },
    );
  }

  /* ==========================================================================
   * Provider Result Validation
   * ======================================================================== */

  _normalizeProviderResult(
    rawResult,
    payment,
    provider,
  ) {
    const result =
      toPlainObject(
        rawResult,
      )
      || {};

    const rawStatus =
      normalizeString(
        result.status
        || result.providerStatus
        || result.outcome,
      );

    const outcome =
      this._normalizeOutcome(
        rawStatus,
      );

    const providerName =
      normalizeProvider(
        result.provider
        || payment.provider,
        );

    const providerTransactionId =
      normalizeString(
        result.providerTransactionId
        || result.transactionId
        || result.providerReference
        || result.reference,
      );

    const providerEventId =
      normalizeString(
        result.providerEventId
        || result.eventId,
      );

    const amount =
      normalizeAmount(
        result.amount,
      );

    const currency =
      canonicalCurrency(
        result.currency,
      );

    return {
      outcome,

      status:
        rawStatus,

      provider:
        providerName,

      providerTransactionId,

      providerEventId,

      amount,

      currency,

      confirmed:
        Boolean(
          result.confirmed
          || outcome === 'SUCCESS',
        ),

      failed:
        Boolean(
          result.failed
          || outcome === 'FAILED',
        ),

      pending:
        Boolean(
          outcome === 'PENDING',
        ),

      reversalPaymentId:
        normalizeString(
          result.reversalPaymentId,
        ),

      reason:
        normalizeString(
          result.reason
          || result.message
          || result.failureReason,
        ),

      reasonCode:
        normalizeString(
          result.reasonCode
          || result.code,
        ),

      occurredAt:
        result.occurredAt
        || result.timestamp
        || null,

      retryable:
        result.retryable === true,

      unknownOutcome:
        result.unknownOutcome === true,

      raw:
        this._sanitizeProviderResult(
          result,
        ),
    };
  }

  _normalizeOutcome(
    rawStatus,
  ) {
    if (!rawStatus) {
      return 'UNKNOWN';
    }

    const status =
      rawStatus
        .trim()
        .toUpperCase();

    if (
      [
        'SUCCESS',
        'SUCCESSFUL',
        'COMPLETED',
        'COMPLETE',
        'PAID',
        'APPROVED',
      ].includes(
        status,
      )
    ) {
      return 'SUCCESS';
    }

    if (
      [
        'FAILED',
        'FAILURE',
        'ERROR',
        'DECLINED',
        'REJECTED',
      ].includes(
        status,
      )
    ) {
      return 'FAILED';
    }

    if (
      [
        'PENDING',
        'PROCESSING',
        'IN_PROGRESS',
        'INITIATED',
        'QUEUED',
      ].includes(
        status,
      )
    ) {
      return 'PENDING';
    }

    if (
      [
        'CANCELLED',
        'CANCELED',
      ].includes(
        status,
      )
    ) {
      return 'CANCELLED';
    }

    if (
      [
        'REVERSED',
        'REVERSAL',
      ].includes(
        status,
      )
    ) {
      return 'REVERSED';
    }

    return 'UNKNOWN';
  }

  async _validateProviderResult(
    payment,
    providerResult,
    context,
  ) {
    if (
      !providerResult
      || !providerResult.outcome
    ) {
      throw new PaymentProcessingError(
        'Provider returned an invalid payment result.',
        {
          code:
            ERROR_CODES
              .PROVIDER_RESULT_INVALID,
          statusCode: 502,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
        },
      );
    }

    /**
     * Provider identity must match expected provider.
     */
    if (
      payment.provider
      && providerResult.provider
      && normalizeProvider(
        payment.provider,
      )
      !== normalizeProvider(
        providerResult.provider,
      )
    ) {
      throw new PaymentProcessingError(
        'Provider response does not match the payment provider.',
        {
          code:
            ERROR_CODES
              .PROVIDER_REFERENCE_MISMATCH,
          statusCode: 409,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
        },
      );
    }

    /**
     * A provider success should normally contain a provider transaction
     * reference. Allow providers that intentionally do not return one only
     * when the adapter explicitly marks the operation as internally confirmed.
     */
    if (
      providerResult.outcome === 'SUCCESS'
      && !providerResult.providerTransactionId
      && !providerResult.confirmed
      && this.options.strictMode
    ) {
      throw new PaymentProcessingError(
        'A successful provider result requires a provider transaction reference or authoritative internal confirmation.',
        {
          code:
            ERROR_CODES
              .PROVIDER_REFERENCE_REQUIRED,
          statusCode: 409,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
          provider:
            payment.provider,
        },
      );
    }

    /**
     * Validate amount when provider supplies it.
     */
    if (
      providerResult.amount
      && payment.amount
    ) {
      const expected =
        canonicalAmount(
          payment.amount,
        );

      const received =
        canonicalAmount(
          providerResult.amount,
        );

      if (
        expected
        && received
        && expected !== received
      ) {
        throw new PaymentProcessingError(
          'Provider payment amount does not match internal payment amount.',
          {
            code:
              ERROR_CODES
                .PAYMENT_AMOUNT_MISMATCH,
            statusCode: 409,
            paymentId:
              payment.id,
            tenantId:
              context.tenantId,
            provider:
              payment.provider,
            details: {
              expectedAmount:
                expected,

              receivedAmount:
                received,
            },
          },
        );
      }
    }

    /**
     * Validate currency.
     */
    if (
      providerResult.currency
      && payment.currency
    ) {
      const expected =
        canonicalCurrency(
          payment.currency,
        );

      const received =
        canonicalCurrency(
          providerResult.currency,
        );

      if (
        expected
        && received
        && expected !== received
      ) {
        throw new PaymentProcessingError(
          'Provider payment currency does not match internal payment currency.',
          {
            code:
              ERROR_CODES
                .PAYMENT_CURRENCY_MISMATCH,
            statusCode: 409,
            paymentId:
              payment.id,
            tenantId:
              context.tenantId,
          },
        );
      }
    }

    /**
     * If a provider reference already exists internally, do not silently
     * attach a different external reference.
     */
    if (
      payment.providerTransactionId
      && providerResult.providerTransactionId
      && payment.providerTransactionId
        !== providerResult.providerTransactionId
    ) {
      throw new PaymentProcessingError(
        'Provider transaction reference mismatch.',
        {
          code:
            ERROR_CODES
              .PROVIDER_REFERENCE_MISMATCH,
          statusCode: 409,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
        },
      );
    }
  }

  _providerCanQueryStatus(
    providerResult,
  ) {
    return Boolean(
      providerResult.providerTransactionId,
    );
  }

  async _attemptProviderStatusRecovery(
    payment,
    providerResult,
    context,
  ) {
    try {
      const provider =
        await this._resolveProvider(
          payment,
          context,
        );

      if (
        typeof provider
          .getPaymentStatus !== 'function'
      ) {
        return null;
      }

      const result =
        await provider.getPaymentStatus(
          {
            paymentId:
              payment.id,

            providerTransactionId:
              providerResult
                .providerTransactionId,
          },
          context,
        );

      const normalized =
        this._normalizeProviderResult(
          result,
          payment,
          provider,
        );

      await this._validateProviderResult(
        payment,
        normalized,
        context,
      );

      return this._processProviderResult(
        payment,
        normalized,
        {
          ...context,

          reasonCode:
            'PROVIDER_STATUS_RECOVERY',
        },
      );
    } catch (error) {
      this._logError(
        'Provider status recovery failed.',
        error,
        {
          paymentId:
            payment.id,

          tenantId:
            context.tenantId,
        },
      );

      return null;
    }
  }

  /* ==========================================================================
   * Provider Error Handling
   * ======================================================================== */

  async _handleProviderExecutionError(
    payment,
    provider,
    error,
    context,
  ) {
    if (
      this._isUnknownProviderOutcome(
        error,
      )
    ) {
      await this.paymentStateMachine.markUnknown(
        payment,
        {
          ...context,

          provider:
            payment.provider,

          providerTransactionId:
            context.providerTransactionId
            || payment.providerTransactionId,

          reasonCode:
            'PROVIDER_OPERATION_UNKNOWN',
        },
      );

      /**
       * Optional recovery through provider status inquiry.
       */
      if (
        this.options.allowProviderStatusRecovery
        && this._providerSupportsStatusQuery(
          provider,
        )
      ) {
        const recovered =
          await this._attemptProviderStatusRecovery(
            payment,
            {
              outcome:
                'UNKNOWN',

              provider:
                payment.provider,

              providerTransactionId:
                context.providerTransactionId
                || payment.providerTransactionId,
            },
            context,
          );

        if (recovered) {
          return recovered;
        }
      }

      return this._moveToReconciliation(
        payment,
        context,
        {
          reasonCode:
            'PROVIDER_OPERATION_UNKNOWN',

          error,
        },
      );
    }

    const retryable =
      this._isProviderRetryable(
        error,
        provider,
        payment,
      );

    if (
      retryable
      && this.options
        .retryProviderTransientFailures
    ) {
      return {
        success: false,

        outcome:
          'RETRYABLE_FAILURE',

        paymentId:
          payment.id,

        status:
          PAYMENT_STATES.PROCESSING,

        retryable:
          true,

        errorCode:
          error?.code
          || ERROR_CODES
            .PROVIDER_OPERATION_FAILED,

        operationId:
          context.operationId,
      };
    }

    /**
     * Permanent provider failure.
     */
    await this.paymentStateMachine.fail(
      payment,
      {
        ...context,

        provider:
          payment.provider,

        reason:
          error?.message
          || 'Provider operation failed.',

        reasonCode:
          'PROVIDER_OPERATION_FAILED',
      },
    );

    return {
      success: false,

      outcome:
        'FAILED',

      paymentId:
        payment.id,

      status:
        PAYMENT_STATES.FAILED,

      retryable:
        false,

      errorCode:
        error?.code
        || ERROR_CODES
          .PROVIDER_OPERATION_FAILED,

      operationId:
        context.operationId,
    };
  }

  _providerSupportsStatusQuery(
    provider,
  ) {
    return (
      Boolean(
        provider
        && typeof provider
          .getPaymentStatus
          === 'function',
      )
    );
  }

  /* ==========================================================================
   * Reconciliation
   * ======================================================================== */

  async _moveToReconciliation(
    payment,
    context,
    metadata = {},
  ) {
    const state =
      await this.paymentStateMachine
        .requireReconciliation(
          payment,
          {
            ...context,

            reasonCode:
              metadata.reasonCode
              || 'PAYMENT_RECONCILIATION_REQUIRED',

            metadata: {
              ...(context.metadata || {}),
              reconciliation:
                this._sanitizeMetadata(
                  metadata,
                ),
            },
          },
        );

    if (
      this.reconciliationService
    ) {
      try {
        await this._createReconciliationCase(
          payment,
          context,
          metadata,
        );
      } catch (error) {
        this._logError(
          'Failed to create payment reconciliation case.',
          error,
          {
            paymentId:
              payment.id,

            tenantId:
              context.tenantId,
          },
        );

        /**
         * The payment is already safely held in a reconciliation-required
         * state. Do not turn that into an artificial provider failure.
       */
      }
    }

    return {
      success: false,

      outcome:
        'RECONCILIATION_REQUIRED',

      paymentId:
        payment.id,

      status:
        state.currentState,

      requiresReconciliation:
        true,

      operationId:
        context.operationId,

      requestId:
        context.requestId,

      correlationId:
        context.correlationId,
    };
  }

  async _movePaymentToFinancialReconciliation(
    payment,
    context,
    error,
  ) {
    return this._moveToReconciliation(
      payment,
      context,
      {
        reasonCode:
          'FINANCIAL_POSTING_UNKNOWN',

        error: {
          code:
            error?.code,

          message:
            error?.message,
        },
      },
    );
  }

  async _createReconciliationCase(
    payment,
    context,
    metadata,
  ) {
    if (
      typeof this.reconciliationService
        .createPaymentException === 'function'
    ) {
      return this.reconciliationService
        .createPaymentException(
          {
            paymentId:
              payment.id,

            tenantId:
              context.tenantId,

            provider:
              payment.provider,

            providerTransactionId:
              payment.providerTransactionId,

            exceptionType:
              metadata.reasonCode
              || 'PAYMENT_RECONCILIATION_REQUIRED',

            severity:
              metadata.severity
              || 'HIGH',

            metadata:
              this._sanitizeMetadata(
                metadata,
              ),
          },
          context,
        );
    }

    if (
      typeof this.reconciliationService
        .createException === 'function'
    ) {
      return this.reconciliationService
        .createException(
          {
            sourceType:
              'PAYMENT',

            sourceId:
              payment.id,

            tenantId:
              context.tenantId,

            exceptionType:
              metadata.reasonCode
              || 'PAYMENT_RECONCILIATION_REQUIRED',

            severity:
              metadata.severity
              || 'HIGH',

            metadata:
              this._sanitizeMetadata(
                metadata,
              ),
          },
          context,
        );
    }

    return null;
  }

  /* ==========================================================================
   * Pre-Processing Controls
   * ======================================================================== */

  async _runPreProcessingControls(
    request,
    context,
  ) {
    if (
      this.riskService
      && typeof this.riskService
        .evaluatePayment === 'function'
    ) {
      const result =
        await this.riskService
          .evaluatePayment(
            {
              tenantId:
                request.tenantId,

              userId:
                request.userId,

              amount:
                request.amount,

              currency:
                request.currency,

              type:
                request.type,

              provider:
                request.provider,
            },
            context,
          );

      this._assertRiskResult(
        result,
      );
    }

    if (
      this.complianceService
      && typeof this.complianceService
        .validatePayment === 'function'
    ) {
      const result =
        await this.complianceService
          .validatePayment(
            {
              tenantId:
                request.tenantId,

              userId:
                request.userId,

              amount:
                request.amount,

              currency:
                request.currency,

              type:
                request.type,
            },
            context,
          );

      this._assertComplianceResult(
        result,
      );
    }

    if (
      this.limitService
      && typeof this.limitService
        .checkPaymentLimit === 'function'
    ) {
      const result =
        await this.limitService
          .checkPaymentLimit(
            {
              tenantId:
                request.tenantId,

              userId:
                request.userId,

              amount:
                request.amount,

              currency:
                request.currency,

              type:
                request.type,

              direction:
                request.direction,
            },
            context,
          );

      this._assertLimitResult(
        result,
      );
    }
  }

  async _runPreProcessingControlsForPayment(
    payment,
    context,
  ) {
    return this._runPreProcessingControls(
      {
        ...payment,

        tenantId:
          payment.tenantId
          || context.tenantId,

        userId:
          payment.userId,

        amount:
          normalizeAmount(
            payment.amount,
          ),

        currency:
          canonicalCurrency(
            payment.currency,
          ),

        type:
          payment.type,

        provider:
          payment.provider,

        direction:
          payment.direction,
      },
      context,
    );
  }

  _assertRiskResult(
    result,
  ) {
    if (
      !result
    ) {
      return;
    }

    if (
      result.allowed === false
      || result.blocked === true
    ) {
      throw new PaymentProcessingError(
        'Payment was blocked by risk controls.',
        {
          code:
            ERROR_CODES.RISK_BLOCKED,
          statusCode: 403,
          details: {
            reasonCode:
              result.reasonCode
              || null,
          },
        },
      );
    }

    if (
      result.requiresReview === true
    ) {
      throw new PaymentProcessingError(
        'Payment requires risk review before processing.',
        {
          code:
            ERROR_CODES
              .OPERATION_REQUIRES_REVIEW,
          statusCode: 202,
          details: {
            reasonCode:
              result.reasonCode
              || null,
          },
        },
      );
    }
  }

  _assertComplianceResult(
    result,
  ) {
    if (
      !result
    ) {
      return;
    }

    if (
      result.allowed === false
      || result.blocked === true
    ) {
      throw new PaymentProcessingError(
        'Payment was blocked by compliance controls.',
        {
          code:
            ERROR_CODES.COMPLIANCE_BLOCKED,
          statusCode: 403,
          details: {
            reasonCode:
              result.reasonCode
              || null,
          },
        },
      );
    }

    if (
      result.requiresReview === true
    ) {
      throw new PaymentProcessingError(
        'Payment requires compliance review.',
        {
          code:
            ERROR_CODES
              .OPERATION_REQUIRES_REVIEW,
          statusCode: 202,
          details: {
            reasonCode:
              result.reasonCode
              || null,
          },
        },
      );
    }
  }

  _assertLimitResult(
    result,
  ) {
    if (
      !result
    ) {
      return;
    }

    if (
      result.allowed === false
      || result.exceeded === true
    ) {
      throw new PaymentProcessingError(
        'Payment transaction limit has been exceeded.',
        {
          code:
            ERROR_CODES.LIMIT_EXCEEDED,
          statusCode: 422,
        },
      );
    }
  }

  /* ==========================================================================
   * Payment Persistence
   * ======================================================================== */

  _normalizePaymentRequest(
    rawRequest,
  ) {
    return {
      tenantId:
        normalizeString(
          rawRequest.tenantId,
        ),

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
          rawRequest.type
          || rawRequest.paymentType,
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
          rawRequest.paymentReference
          || rawRequest.reference,
        ),

      providerTransactionId:
        normalizeString(
          rawRequest.providerTransactionId,
        ),

      accountReference:
        normalizeString(
          rawRequest.accountReference,
        ),

      phoneNumber:
        normalizeString(
          rawRequest.phoneNumber
          || rawRequest.msisdn,
        ),

      customerReference:
        normalizeString(
          rawRequest.customerReference,
        ),

      metadata:
        this._redactMetadata(
          rawRequest.metadata
          || {},
        ),

      idempotencyKey:
        normalizeString(
          rawRequest.idempotencyKey,
        ),
    };
  }

  async _findExistingByIdempotency(
    request,
    context,
  ) {
    const key =
      request.idempotencyKey
      || context.idempotencyKey;

    if (!key) {
      if (
        this.options.requireIdempotency
      ) {
        throw new PaymentProcessingError(
          'An idempotency key is required for payment creation.',
          {
            code:
              ERROR_CODES
                .IDEMPOTENCY_KEY_REQUIRED,
            statusCode: 400,
            tenantId:
              context.tenantId,
          },
        );
      }

      return null;
    }

    if (
      !this.paymentRepository
    ) {
      return null;
    }

    let existing = null;

    if (
      typeof this.paymentRepository
        .findByIdempotencyKey
        === 'function'
    ) {
      existing =
        await this.paymentRepository
          .findByIdempotencyKey(
            {
              tenantId:
                context.tenantId,
              idempotencyKey:
                key,
            },
          );
    }

    if (!existing) {
      return null;
    }

    const existingPayment =
      this._normalizePayment(
        existing,
      );

    const expectedHash =
      sha256({
        tenantId:
          context.tenantId,

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

        key,
      });

    const storedHash =
      existingPayment
        .requestHash
        || null;

    if (
      storedHash
      && storedHash !== expectedHash
    ) {
      throw new PaymentProcessingError(
        'Payment idempotency key has been reused for a different request.',
        {
          code:
            ERROR_CODES
              .IDEMPOTENCY_CONFLICT,
          statusCode: 409,
          paymentId:
            existingPayment.id,
          tenantId:
            context.tenantId,
        },
      );
    }

    return existingPayment;
  }

  async _createPayment(
    request,
    context,
  ) {
    if (
      !this.paymentRepository
    ) {
      throw new PaymentProcessingError(
        'Payment repository is not configured.',
        {
          code:
            ERROR_CODES
              .INVALID_PAYMENT_REQUEST,
          statusCode: 500,
          tenantId:
            context.tenantId,
        },
      );
    }

    const requestHash =
      sha256({
        tenantId:
          context.tenantId,

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

        idempotencyKey:
          request.idempotencyKey
          || context.idempotencyKey,
      });

    const payload = {
      tenantId:
        context.tenantId,

      userId:
        request.userId,

      groupId:
        request.groupId,

      loanId:
        request.loanId,

      type:
        request.type,

      paymentType:
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
        request.paymentReference
        || this._generatePaymentReference(
          context,
        ),

      providerTransactionId:
        request.providerTransactionId,

      accountReference:
        request.accountReference,

      phoneNumber:
        request.phoneNumber,

      customerReference:
        request.customerReference,

      metadata:
        request.metadata,

      idempotencyKey:
        request.idempotencyKey
        || context.idempotencyKey,

      requestHash,

      status:
        PAYMENT_STATES.INITIATED,

      createdAt:
        now(),

      updatedAt:
        now(),

      createdBy:
        context.actorId,

      version:
        0,
    };

    let payment;

    if (
      typeof this.paymentRepository
        .create === 'function'
    ) {
      payment =
        await this.paymentRepository.create(
          payload,
          {
            tenantId:
              context.tenantId,

            persistenceContext:
              context.persistenceContext,
          },
        );
    } else {
      throw new PaymentProcessingError(
        'Payment repository does not implement create().',
        {
          code:
            ERROR_CODES
              .INVALID_PAYMENT_REQUEST,
          statusCode: 500,
          tenantId:
            context.tenantId,
        },
      );
    }

    if (!payment) {
      throw new PaymentProcessingError(
        'Payment could not be created.',
        {
          code:
            ERROR_CODES
              .INVALID_PAYMENT_REQUEST,
          statusCode: 500,
          tenantId:
            context.tenantId,
        },
      );
    }

    return this._normalizePayment(
      payment,
    );
  }

  _generatePaymentReference(
    context,
  ) {
    const timestamp =
      Date.now().toString(
        36,
      ).toUpperCase();

    const random =
      crypto.randomBytes(
        4,
      ).toString(
        'hex',
      ).toUpperCase();

    return `PAY-${timestamp}-${random}`;
  }

  async _loadPayment(
    paymentOrId,
    context,
  ) {
    if (
      paymentOrId
      && typeof paymentOrId
        === 'object'
    ) {
      return paymentOrId;
    }

    if (
      !this.paymentRepository
    ) {
      throw new PaymentProcessingError(
        'Payment repository is not configured.',
        {
          code:
            ERROR_CODES
              .PAYMENT_NOT_FOUND,
          statusCode: 500,
          tenantId:
            context.tenantId,
        },
      );
    }

    const paymentId =
      safeId(
        paymentOrId,
      );

    if (!paymentId) {
      throw new PaymentProcessingError(
        'A payment identifier is required.',
        {
          code:
            ERROR_CODES
              .PAYMENT_NOT_FOUND,
          statusCode: 400,
          tenantId:
            context.tenantId,
        },
      );
    }

    let payment = null;

    if (
      typeof this.paymentRepository
        .getById
        === 'function'
    ) {
      payment =
        await this.paymentRepository.getById(
          paymentId,
          {
            tenantId:
              context.tenantId,
          },
        );
    } else if (
      typeof this.paymentRepository
        .findById
        === 'function'
    ) {
      payment =
        await this.paymentRepository.findById(
          paymentId,
          {
            tenantId:
              context.tenantId,
          },
        );
    }

    if (!payment) {
      throw new PaymentProcessingError(
        'Payment not found.',
        {
          code:
            ERROR_CODES
              .PAYMENT_NOT_FOUND,
          statusCode: 404,
          paymentId,
          tenantId:
            context.tenantId,
        },
      );
    }

    return payment;
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
        error.code
        === ERROR_CODES.PAYMENT_NOT_FOUND
      ) {
        return null;
      }

      throw error;
    }
  }

  _mergePaymentContext(
    context,
    payment,
  ) {
    return {
      ...context,

      tenantId:
        context.tenantId
        || payment.tenantId,

      provider:
        context.provider
        || payment.provider,

      providerTransactionId:
        context.providerTransactionId
        || payment.providerTransactionId,

      idempotencyKey:
        context.idempotencyKey
        || payment.idempotencyKey,

      expectedVersion:
        context.expectedVersion
        ?? payment.version,
    };
  }

  async _assertPaymentTenant(
    payment,
    context,
  ) {
    if (
      this.options.requireTenant
      && !context.tenantId
    ) {
      throw new PaymentProcessingError(
        'Tenant context is required.',
        {
          code:
            ERROR_CODES
              .TENANT_CONTEXT_REQUIRED,
          statusCode: 403,
          paymentId:
            payment.id,
        },
      );
    }

    if (
      payment.tenantId
      && payment.tenantId !== context.tenantId
    ) {
      throw new PaymentProcessingError(
        'Payment does not belong to the current tenant.',
        {
          code:
            ERROR_CODES.TENANT_MISMATCH,
          statusCode: 403,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
        },
      );
    }
  }

  _assertContext(
    context,
  ) {
    if (
      this.options.requireTenant
      && !context.tenantId
    ) {
      throw new PaymentProcessingError(
        'Tenant context is required for payment processing.',
        {
          code:
            ERROR_CODES
              .TENANT_CONTEXT_REQUIRED,
          statusCode: 403,
        },
      );
    }

    if (
      this.options.requireActor
      && !context.actorId
    ) {
      throw new PaymentProcessingError(
        'Authenticated actor context is required for payment processing.',
        {
          code:
            ERROR_CODES
              .AUTHORIZATION_REQUIRED,
          statusCode: 403,
          tenantId:
            context.tenantId,
        },
      );
    }

    if (
      this.options.requireIdempotency
      && !context.idempotencyKey
      && context.actorType !== 'PROVIDER'
      && !context.fromCallback
    ) {
      /**
       * createAndInitiate enforces request.idempotencyKey. Context-only
       * operations may also carry it.
       */
      return;
    }
  }

  _validateOrThrow(
    request,
    context,
  ) {
    const validation =
      this.validateCreateRequest(
        request,
      );

    if (!validation.valid) {
      throw new PaymentProcessingError(
        'Payment request validation failed.',
        {
          code:
            ERROR_CODES
              .INVALID_PAYMENT_REQUEST,
          statusCode: 400,
          tenantId:
            context.tenantId,
          details: {
            errors:
              validation.errors,
          },
        },
      );
    }

    if (
      this.options.requireIdempotency
      && !(
        request.idempotencyKey
        || context.idempotencyKey
      )
    ) {
      throw new PaymentProcessingError(
        'Idempotency key is required for payment creation.',
        {
          code:
            ERROR_CODES
              .IDEMPOTENCY_KEY_REQUIRED,
          statusCode: 400,
          tenantId:
            context.tenantId,
        },
      );
    }
  }

  /* ==========================================================================
   * Response / Result Helpers
   * ======================================================================== */

  _buildIdempotentResult(
    payment,
    context,
  ) {
    return {
      success: true,

      duplicateRequest:
        true,

      idempotentReplay:
        true,

      paymentId:
        payment.id,

      status:
        payment.status,

      payment:
        this._sanitizePaymentForResponse(
          payment,
        ),

      operationId:
        context.operationId,

      requestId:
        context.requestId,

      correlationId:
        context.correlationId,
    };
  }

  _buildAlreadySuccessfulResult(
    payment,
    context,
  ) {
    return {
      success: true,

      alreadyCompleted:
        true,

      paymentId:
        payment.id,

      status:
        PAYMENT_STATES.SUCCESSFUL,

      payment:
        this._sanitizePaymentForResponse(
          payment,
        ),

      financialTransactionId:
        payment.financialTransactionId
        || null,

      operationId:
        context.operationId,

      requestId:
        context.requestId,

      correlationId:
        context.correlationId,
    };
  }

  _sanitizePaymentForResponse(
    payment,
  ) {
    if (!payment) {
      return null;
    }

    const plain =
      toPlainObject(
        payment,
      );

    const output = {
      id:
        safeId(
          plain.id
          || plain._id,
        ),

      tenantId:
        plain.tenantId
        || null,

      userId:
        plain.userId
        || null,

      groupId:
        plain.groupId
        || null,

      loanId:
        plain.loanId
        || null,

      paymentReference:
        plain.paymentReference
        || plain.reference
        || null,

      type:
        plain.type
        || plain.paymentType
        || null,

      direction:
        plain.direction
        || null,

      amount:
        normalizeAmount(
          plain.amount,
        ),

      currency:
        canonicalCurrency(
          plain.currency,
        ),

      provider:
        plain.provider
        || null,

      providerTransactionId:
        plain.providerTransactionId
        || null,

      status:
        plain.status
        || null,

      financialTransactionId:
        plain.financialTransactionId
        || null,

      createdAt:
        plain.createdAt
        || null,

      updatedAt:
        plain.updatedAt
        || null,

      completedAt:
        plain.completedAt
        || null,

      failedAt:
        plain.failedAt
        || null,

      cancelledAt:
        plain.cancelledAt
        || null,

      reversedAt:
        plain.reversedAt
        || null,
    };

    return output;
  }

  _sanitizeProviderResult(
    result,
  ) {
    if (!result) {
      return null;
    }

    return {
      provider:
        result.provider
        || null,

      outcome:
        result.outcome
        || null,

      status:
        result.status
        || null,

      providerTransactionId:
        result.providerTransactionId
        || null,

      providerEventId:
        result.providerEventId
        || null,

      amount:
        normalizeAmount(
          result.amount,
        ),

      currency:
        canonicalCurrency(
          result.currency,
        ),

      reasonCode:
        result.reasonCode
        || null,

      occurredAt:
        result.occurredAt
        || null,
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
        'signature',
        'signatureSecret',
        'webhookSecret',
        'rawBody',
      ]);

    const result = {};

    for (
      const [key, value]
      of Object.entries(
        metadata,
      )
    ) {
      if (
        sensitive.has(
          key,
        )
      ) {
        result[key] =
          '[REDACTED]';
      } else {
        result[key] =
          clone(value);
      }
    }

    return result;
  }

  _redactMetadata(
    metadata,
  ) {
    return this._sanitizeMetadata(
      metadata,
    );
  }

  /* ==========================================================================
   * Logging / Observability
   * ======================================================================== */

  _logDebug(
    message,
    metadata = {},
  ) {
    try {
      if (
        this.logger
        && typeof this.logger.debug
          === 'function'
      ) {
        this.logger.debug(
          message,
          this._sanitizeMetadata(
            metadata,
          ),
        );
      }
    } catch (_error) {
      // Never fail business processing due to logging.
    }
  }

  _logInfo(
    message,
    metadata = {},
  ) {
    try {
      if (
        this.logger
        && typeof this.logger.info
          === 'function'
      ) {
        this.logger.info(
          message,
          this._sanitizeMetadata(
            metadata,
          ),
        );
      }
    } catch (_error) {
      // Never fail business processing due to logging.
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
      // Never mask the original error.
    }
  }

  /* ==========================================================================
   * Utility / State Helpers
   * ======================================================================== */

  _normalizePayment(
    payment,
  ) {
    if (
      !payment
      || typeof payment !== 'object'
    ) {
      throw new PaymentProcessingError(
        'Invalid payment object.',
        {
          code:
            ERROR_CODES
              .INVALID_PAYMENT_REQUEST,
          statusCode: 400,
        },
      );
    }

    const plain =
      toPlainObject(
        payment,
      );

    return {
      ...plain,

      id:
        safeId(
          plain.id
          || plain._id,
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

      status:
        normalizeString(
          plain.status
          || plain.state,
        )
        ?.toUpperCase(),

      type:
        normalizeType(
          plain.type
          || plain.paymentType,
        ),

      paymentType:
        normalizeType(
          plain.paymentType
          || plain.type,
        ),

      direction:
        normalizeDirection(
          plain.direction,
        ),

      amount:
        normalizeAmount(
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

      providerTransactionId:
        normalizeString(
          plain.providerTransactionId,
        ),

      providerEventId:
        normalizeString(
          plain.providerEventId,
        ),

      paymentReference:
        normalizeString(
          plain.paymentReference
          || plain.reference,
        ),

      reference:
        normalizeString(
          plain.reference
          || plain.paymentReference,
        ),

      idempotencyKey:
        normalizeString(
          plain.idempotencyKey,
        ),

      financialTransactionId:
        normalizeString(
          plain.financialTransactionId,
        ),

      version:
        parseVersion(
          plain.version,
        )
        ?? parseVersion(
          plain.__v,
        )
        ?? 0,
    };
  }

  _isFinanciallyFinal(
    payment,
  ) {
    return (
      payment.status
      === PAYMENT_STATES.SUCCESSFUL
      || payment.status
      === PAYMENT_STATES.REVERSED
    );
  }

  _isProviderPending(
    providerResult,
  ) {
    return (
      providerResult
      && providerResult.outcome
      === 'PENDING'
    );
  }
}

/* ============================================================================
 * Static API
 * ========================================================================== */

PaymentProcessingService.PAYMENT_TYPES =
  PAYMENT_TYPES;

PaymentProcessingService.PAYMENT_DIRECTIONS =
  PAYMENT_DIRECTIONS;

PaymentProcessingService.PAYMENT_STATES =
  PAYMENT_STATES;

PaymentProcessingService.ERROR_CODES =
  ERROR_CODES;

PaymentProcessingService.PaymentProcessingError =
  PaymentProcessingError;

/* ============================================================================
 * Factory
 * ========================================================================== */

function createPaymentProcessingService(
  dependencies = {},
) {
  return new PaymentProcessingService(
    dependencies,
  );
}

/* ============================================================================
 * Exports
 * ========================================================================== */

module.exports =
  PaymentProcessingService;

module.exports.PaymentProcessingService =
  PaymentProcessingService;

module.exports.PaymentProcessingError =
  PaymentProcessingError;

module.exports.createPaymentProcessingService =
  createPaymentProcessingService;

module.exports.PAYMENT_TYPES =
  PAYMENT_TYPES;

module.exports.PAYMENT_DIRECTIONS =
  PAYMENT_DIRECTIONS;

module.exports.PAYMENT_STATES =
  PAYMENT_STATES;

module.exports.PAYMENT_PROCESSING_ERROR_CODES =
  ERROR_CODES;

/* ============================================================================
 * End of File
 * ============================================================================
 */