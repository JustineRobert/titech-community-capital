'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Payment Settlement Workflow
 * ============================================================================
 *
 * File:
 *   backend/modules/payment/workflows/paymentSettlementWorkflow.js
 *
 * Purpose
 * -------
 * Coordinates the post-payment settlement lifecycle after a payment has
 * reached an authoritative financial state.
 *
 * Settlement is intentionally separated from:
 *
 *   - Payment Processing
 *   - Provider Authentication
 *   - Payment Verification
 *   - Ledger Posting
 *   - Reconciliation
 *
 * Settlement answers:
 *
 *   "Has the provider-side/payment-rail money been successfully accounted for,
 *    matched, and finalized against the expected settlement obligation?"
 *
 * It does NOT answer:
 *
 *   "Did the customer payment happen?"
 *
 * That is owned by PaymentProcessingService / PaymentVerificationService.
 *
 * Canonical Workflow
 * ------------------
 *
 *   PAYMENT SUCCESSFUL
 *          |
 *          v
 *   Financial Transaction POSTED
 *          |
 *          v
 *   Settlement Eligibility
 *          |
 *          v
 *   Settlement Idempotency Reservation
 *          |
 *          v
 *   Load / Create Settlement
 *          |
 *          v
 *   Match Provider Settlement Evidence
 *          |
 *          +-------------------------+
 *          |                         |
 *          v                         v
 *       MATCHED                 UNRESOLVED
 *          |                         |
 *          v                         v
 *   Settlement Completed       Reconciliation
 *          |
 *          v
 *   Settlement Event
 *
 * Settlement State Model
 * ----------------------
 *
 *   NOT_REQUIRED
 *   PENDING
 *   PROCESSING
 *   MATCHED
 *   SETTLED
 *   PARTIALLY_SETTLED
 *   MISMATCHED
 *   FAILED
 *   UNKNOWN
 *   REQUIRES_RECONCILIATION
 *   CANCELLED
 *
 * Non-Negotiable Financial Rules
 * ------------------------------
 * 1. Settlement never rewrites payment history.
 * 2. Settlement never edits ledger entries.
 * 3. Settlement never changes customer balances directly.
 * 4. Settlement always references the authoritative payment/financial
 *    transaction.
 * 5. Settlement amounts are compared as exact decimal values.
 * 6. Settlement currency must match the payment currency.
 * 7. Provider transaction references are immutable correlation anchors.
 * 8. Duplicate settlement operations must be idempotent.
 * 9. Unknown settlement outcomes must never be treated as failures.
 * 10. Settlement mismatches require investigation/reconciliation.
 * 11. Tenant isolation is enforced on every operation.
 * 12. Settlement completion requires authoritative evidence.
 * 13. Settlement publication is durable/outbox-backed where available.
 * 14. Provider evidence is treated as external evidence, never direct truth.
 * 15. All externally observable transitions must be auditable.
 *
 * ============================================================================
 */

const crypto = require('crypto');

/* ============================================================================
 * Optional Dependencies
 * ========================================================================== */

let PaymentEventPublisherModule = null;

try {
  PaymentEventPublisherModule =
    require('./paymentEventPublisher');
} catch (_error) {
  /*
   * The workflow can still be constructed in isolation for unit testing.
   * Production configuration validation will report the missing publisher
   * when event publication is required.
   */
}

let PaymentIdempotencyServiceModule = null;

try {
  PaymentIdempotencyServiceModule =
    require('../paymentIdempotencyService');
} catch (_error) {
  /*
   * Same rationale as above.
   */
}

/* ============================================================================
 * Constants
 * ========================================================================== */

const SETTLEMENT_STATES = Object.freeze({
  NOT_REQUIRED:
    'NOT_REQUIRED',

  PENDING:
    'PENDING',

  PROCESSING:
    'PROCESSING',

  MATCHED:
    'MATCHED',

  SETTLED:
    'SETTLED',

  PARTIALLY_SETTLED:
    'PARTIALLY_SETTLED',

  MISMATCHED:
    'MISMATCHED',

  FAILED:
    'FAILED',

  UNKNOWN:
    'UNKNOWN',

  REQUIRES_RECONCILIATION:
    'REQUIRES_RECONCILIATION',

  CANCELLED:
    'CANCELLED',
});

const SETTLEMENT_OUTCOMES = Object.freeze({
  SETTLED:
    'SETTLED',

  PENDING:
    'PENDING',

  PARTIALLY_SETTLED:
    'PARTIALLY_SETTLED',

  MISMATCHED:
    'MISMATCHED',

  FAILED:
    'FAILED',

  UNKNOWN:
    'UNKNOWN',

  REQUIRES_RECONCILIATION:
    'REQUIRES_RECONCILIATION',
});

const SETTLEMENT_OPERATION_TYPES = Object.freeze({
  INITIATE:
    'SETTLEMENT_INITIATE',

  MATCH:
    'SETTLEMENT_MATCH',

  COMPLETE:
    'SETTLEMENT_COMPLETE',

  RECONCILE:
    'SETTLEMENT_RECONCILE',

  RELEASE:
    'SETTLEMENT_RELEASE',
});

const SETTLEMENT_EVENT_TYPES = Object.freeze({
  INITIATED:
    'PaymentSettlementInitiated',

  PROCESSING:
    'PaymentSettlementProcessing',

  MATCHED:
    'PaymentSettlementMatched',

  COMPLETED:
    'PaymentSettlementCompleted',

  PARTIALLY_SETTLED:
    'PaymentSettlementPartiallySettled',

  MISMATCHED:
    'PaymentSettlementMismatched',

  FAILED:
    'PaymentSettlementFailed',

  UNKNOWN:
    'PaymentSettlementUnknown',

  REQUIRES_RECONCILIATION:
    'PaymentSettlementReconciliationRequired',

  CANCELLED:
    'PaymentSettlementCancelled',
});

const SETTLEMENT_ERROR_CODES = Object.freeze({
  INVALID_REQUEST:
    'PAYMENT_SETTLEMENT_INVALID_REQUEST',

  TENANT_REQUIRED:
    'PAYMENT_SETTLEMENT_TENANT_REQUIRED',

  TENANT_MISMATCH:
    'PAYMENT_SETTLEMENT_TENANT_MISMATCH',

  PAYMENT_ID_REQUIRED:
    'PAYMENT_SETTLEMENT_PAYMENT_ID_REQUIRED',

  PAYMENT_NOT_FOUND:
    'PAYMENT_SETTLEMENT_PAYMENT_NOT_FOUND',

  PAYMENT_NOT_SUCCESSFUL:
    'PAYMENT_SETTLEMENT_PAYMENT_NOT_SUCCESSFUL',

  FINANCIAL_TRANSACTION_REQUIRED:
    'PAYMENT_SETTLEMENT_FINANCIAL_TRANSACTION_REQUIRED',

  FINANCIAL_TRANSACTION_NOT_POSTED:
    'PAYMENT_SETTLEMENT_FINANCIAL_TRANSACTION_NOT_POSTED',

  PROVIDER_REQUIRED:
    'PAYMENT_SETTLEMENT_PROVIDER_REQUIRED',

  PROVIDER_REFERENCE_REQUIRED:
    'PAYMENT_SETTLEMENT_PROVIDER_REFERENCE_REQUIRED',

  SETTLEMENT_ID_REQUIRED:
    'PAYMENT_SETTLEMENT_ID_REQUIRED',

  SETTLEMENT_NOT_FOUND:
    'PAYMENT_SETTLEMENT_NOT_FOUND',

  SETTLEMENT_ALREADY_COMPLETED:
    'PAYMENT_SETTLEMENT_ALREADY_COMPLETED',

  INVALID_STATE:
    'PAYMENT_SETTLEMENT_INVALID_STATE',

  INVALID_TRANSITION:
    'PAYMENT_SETTLEMENT_INVALID_TRANSITION',

  AMOUNT_REQUIRED:
    'PAYMENT_SETTLEMENT_AMOUNT_REQUIRED',

  INVALID_AMOUNT:
    'PAYMENT_SETTLEMENT_INVALID_AMOUNT',

  AMOUNT_MISMATCH:
    'PAYMENT_SETTLEMENT_AMOUNT_MISMATCH',

  CURRENCY_REQUIRED:
    'PAYMENT_SETTLEMENT_CURRENCY_REQUIRED',

  CURRENCY_MISMATCH:
    'PAYMENT_SETTLEMENT_CURRENCY_MISMATCH',

  PROVIDER_REFERENCE_MISMATCH:
    'PAYMENT_SETTLEMENT_PROVIDER_REFERENCE_MISMATCH',

  DUPLICATE_REFERENCE:
    'PAYMENT_SETTLEMENT_DUPLICATE_REFERENCE',

  IDEMPOTENCY_REQUIRED:
    'PAYMENT_SETTLEMENT_IDEMPOTENCY_REQUIRED',

  IDEMPOTENCY_CONFLICT:
    'PAYMENT_SETTLEMENT_IDEMPOTENCY_CONFLICT',

  CONCURRENT_UPDATE:
    'PAYMENT_SETTLEMENT_CONCURRENT_UPDATE',

  UNKNOWN_OUTCOME:
    'PAYMENT_SETTLEMENT_UNKNOWN_OUTCOME',

  RECONCILIATION_REQUIRED:
    'PAYMENT_SETTLEMENT_RECONCILIATION_REQUIRED',

  RECONCILIATION_UNAVAILABLE:
    'PAYMENT_SETTLEMENT_RECONCILIATION_UNAVAILABLE',

  PROVIDER_QUERY_UNAVAILABLE:
    'PAYMENT_SETTLEMENT_PROVIDER_QUERY_UNAVAILABLE',

  PERSISTENCE_UNAVAILABLE:
    'PAYMENT_SETTLEMENT_PERSISTENCE_UNAVAILABLE',

  EVENT_PUBLISH_FAILED:
    'PAYMENT_SETTLEMENT_EVENT_PUBLISH_FAILED',

  CONFIGURATION_ERROR:
    'PAYMENT_SETTLEMENT_CONFIGURATION_ERROR',
});

const DEFAULT_OPTIONS = Object.freeze({
  strictMode:
    true,

  requireTenant:
    true,

  requireSuccessfulPayment:
    true,

  requireFinancialTransaction:
    true,

  requirePostedFinancialTransaction:
    true,

  requireProvider:
    true,

  requireProviderTransactionReference:
    true,

  requireIdempotency:
    true,

  allowAsynchronousSettlement:
    true,

  /**
   * Settlement can be created before a provider statement is available.
   */
  createPendingSettlement:
    true,

  /**
   * Provider settlement evidence should normally be queried/reconciled by a
   * dedicated adapter/service rather than by this workflow directly.
   */
  allowProviderQuery:
    true,

  providerQueryTimeoutMs:
    15000,

  /**
   * Completion requires exact amount/currency agreement.
   */
  requireExactAmountMatch:
    true,

  requireExactCurrencyMatch:
    true,

  /**
   * Never downgrade SETTLED settlement state.
   */
  preventSettledDowngrade:
    true,

  /**
   * Prefer event outbox.
   */
  publishEvents:
    true,

  failOnEventPublicationError:
    true,

  /**
   * Automatically create a reconciliation exception when evidence conflicts.
   */
  enableReconciliation:
    true,

  /**
   * A single payment should normally map to one canonical settlement
   * obligation unless explicitly configured otherwise.
   */
  enforceSingleActiveSettlement:
    true,

  /**
   * Provider statement feeds are external evidence and should never be
   * trusted merely because they reference a known provider transaction.
   */
  requireVerifiedSettlementEvidence:
    true,
});

/* ============================================================================
 * Error
 * ========================================================================== */

class PaymentSettlementWorkflowError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(message);

    this.name =
      'PaymentSettlementWorkflowError';

    this.code =
      options.code ||
      SETTLEMENT_ERROR_CODES
        .INVALID_REQUEST;

    this.statusCode =
      Number.isInteger(
        options.statusCode,
      )
        ? options.statusCode
        : 409;

    this.paymentId =
      options.paymentId ||
      null;

    this.settlementId =
      options.settlementId ||
      null;

    this.tenantId =
      options.tenantId ||
      null;

    this.operationId =
      options.operationId ||
      null;

    this.retryable =
      options.retryable === true;

    this.unknownOutcome =
      options.unknownOutcome === true;

    this.reconciliationRequired =
      options.reconciliationRequired === true;

    this.details =
      options.details ||
      {};

    if (options.cause) {
      this.cause =
        options.cause;
    }

    Error.captureStackTrace?.(
      this,
      PaymentSettlementWorkflowError,
    );
  }
}

/* ============================================================================
 * Utility Functions
 * ========================================================================== */

function isNonEmptyString(
  value,
) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0
  );
}

function normalizeString(
  value,
) {
  return isNonEmptyString(value)
    ? value.trim()
    : null;
}

function normalizeStatus(
  value,
) {
  const status =
    normalizeString(value);

  return status
    ? status.toUpperCase()
    : null;
}

function normalizeProvider(
  value,
) {
  const provider =
    normalizeString(value);

  return provider
    ? provider.toLowerCase()
    : null;
}

function normalizeCurrency(
  value,
) {
  const currency =
    normalizeString(value);

  return currency
    ? currency.toUpperCase()
    : null;
}

function normalizeAmount(
  value,
) {
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

function canonicalAmount(
  value,
) {
  const amount =
    normalizeAmount(
      value,
    );

  if (!amount) {
    return null;
  }

  const trimmed =
    amount.trim();

  if (
    !/^\d+(\.\d+)?$/.test(
      trimmed,
    )
  ) {
    return null;
  }

  const parts =
    trimmed.split('.');

  const integerPart =
    parts[0].replace(
      /^0+(?=\d)/,
      '',
    );

  const decimalPart =
    parts[1]
      ? parts[1].replace(
        /0+$/,
        '',
      )
      : '';

  return decimalPart
    ? `${integerPart}.${decimalPart}`
    : integerPart;
}

function safeId(
  value,
) {
  if (
    value &&
    typeof value.toString === 'function'
  ) {
    return value.toString();
  }

  return normalizeString(
    value,
  );
}

function clone(
  value,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return value;
  }

  if (
    typeof structuredClone ===
    'function'
  ) {
    try {
      return structuredClone(
        value,
      );
    } catch (_error) {
      // Continue.
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

function sha256(
  value,
) {
  return crypto
    .createHash('sha256')
    .update(
      typeof value === 'string'
        ? value
        : JSON.stringify(value),
    )
    .digest('hex');
}

function now() {
  return new Date();
}

function isoNow() {
  return now().toISOString();
}

function parseVersion(
  value,
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }

  const parsed =
    Number(value);

  if (
    !Number.isSafeInteger(
      parsed,
    ) ||
    parsed < 0
  ) {
    return null;
  }

  return parsed;
}

function createOperationId() {
  return `settlement_op_${crypto.randomUUID()}`;
}

function createSettlementReference() {
  const timestamp =
    Date.now().toString(36)
      .toUpperCase();

  const random =
    crypto.randomBytes(4)
      .toString('hex')
      .toUpperCase();

  return `SET-${timestamp}-${random}`;
}

/* ============================================================================
 * State Transition Map
 * ========================================================================== */

const SETTLEMENT_TRANSITIONS = Object.freeze({
  [SETTLEMENT_STATES.NOT_REQUIRED]:
    Object.freeze([]),

  [SETTLEMENT_STATES.PENDING]:
    Object.freeze([
      SETTLEMENT_STATES.PROCESSING,
      SETTLEMENT_STATES.CANCELLED,
      SETTLEMENT_STATES.UNKNOWN,
      SETTLEMENT_STATES.REQUIRES_RECONCILIATION,
    ]),

  [SETTLEMENT_STATES.PROCESSING]:
    Object.freeze([
      SETTLEMENT_STATES.MATCHED,
      SETTLEMENT_STATES.SETTLED,
      SETTLEMENT_STATES.PARTIALLY_SETTLED,
      SETTLEMENT_STATES.MISMATCHED,
      SETTLEMENT_STATES.FAILED,
      SETTLEMENT_STATES.UNKNOWN,
      SETTLEMENT_STATES.REQUIRES_RECONCILIATION,
    ]),

  [SETTLEMENT_STATES.MATCHED]:
    Object.freeze([
      SETTLEMENT_STATES.SETTLED,
      SETTLEMENT_STATES.PARTIALLY_SETTLED,
      SETTLEMENT_STATES.MISMATCHED,
      SETTLEMENT_STATES.REQUIRES_RECONCILIATION,
    ]),

  [SETTLEMENT_STATES.SETTLED]:
    Object.freeze([]),

  [SETTLEMENT_STATES.PARTIALLY_SETTLED]:
    Object.freeze([
      SETTLEMENT_STATES.SETTLED,
      SETTLEMENT_STATES.MISMATCHED,
      SETTLEMENT_STATES.REQUIRES_RECONCILIATION,
    ]),

  [SETTLEMENT_STATES.MISMATCHED]:
    Object.freeze([
      SETTLEMENT_STATES.MATCHED,
      SETTLEMENT_STATES.SETTLED,
      SETTLEMENT_STATES.REQUIRES_RECONCILIATION,
    ]),

  [SETTLEMENT_STATES.FAILED]:
    Object.freeze([
      SETTLEMENT_STATES.PROCESSING,
      SETTLEMENT_STATES.UNKNOWN,
      SETTLEMENT_STATES.REQUIRES_RECONCILIATION,
    ]),

  [SETTLEMENT_STATES.UNKNOWN]:
    Object.freeze([
      SETTLEMENT_STATES.PROCESSING,
      SETTLEMENT_STATES.MATCHED,
      SETTLEMENT_STATES.SETTLED,
      SETTLEMENT_STATES.FAILED,
      SETTLEMENT_STATES.REQUIRES_RECONCILIATION,
    ]),

  [SETTLEMENT_STATES.REQUIRES_RECONCILIATION]:
    Object.freeze([
      SETTLEMENT_STATES.PROCESSING,
      SETTLEMENT_STATES.MATCHED,
      SETTLEMENT_STATES.PARTIALLY_SETTLED,
      SETTLEMENT_STATES.SETTLED,
      SETTLEMENT_STATES.FAILED,
    ]),

  [SETTLEMENT_STATES.CANCELLED]:
    Object.freeze([]),
});

/* ============================================================================
 * Payment Settlement Workflow
 * ========================================================================== */

class PaymentSettlementWorkflow {
  /**
   * @param {Object} dependencies
   *
   * Recommended dependencies:
   *
   * settlementRepository
   * paymentRepository
   * financialService
   * providerSettlementService
   * settlementMatcher
   * reconciliationService
   * paymentEventPublisher
   * paymentIdempotencyService
   * auditService
   * metrics
   * logger
   */
  constructor(
    dependencies = {},
  ) {
    this.settlementRepository =
      dependencies.settlementRepository ||
      dependencies.paymentSettlementRepository ||
      null;

    this.paymentRepository =
      dependencies.paymentRepository ||
      null;

    this.financialService =
      dependencies.financialService ||
      dependencies.transactionService ||
      dependencies.financeService ||
      null;

    this.providerSettlementService =
      dependencies.providerSettlementService ||
      dependencies.settlementProviderService ||
      null;

    this.settlementMatcher =
      dependencies.settlementMatcher ||
      null;

    this.reconciliationService =
      dependencies.reconciliationService ||
      null;

    this.paymentEventPublisher =
      dependencies.paymentEventPublisher ||
      (
        PaymentEventPublisherModule &&
        (
          PaymentEventPublisherModule
            .PaymentEventPublisher ||
          PaymentEventPublisherModule
        )
          ? new (
              PaymentEventPublisherModule
                .PaymentEventPublisher ||
              PaymentEventPublisherModule
            )(
              {
                outboxRepository:
                  dependencies.outboxRepository,

                eventPublisher:
                  dependencies.eventPublisher,

                transactionEventPublisher:
                  dependencies.transactionEventPublisher,

                auditService:
                  dependencies.auditService,

                metrics:
                  dependencies.metrics,

                logger:
                  dependencies.logger ||
                  console,

                options:
                  dependencies
                    .paymentEventPublisherOptions ||
                  {},
              },
            )
          : null
      );

    this.paymentIdempotencyService =
      dependencies.paymentIdempotencyService ||
      (
        PaymentIdempotencyServiceModule &&
        (
          PaymentIdempotencyServiceModule
            .PaymentIdempotencyService ||
          PaymentIdempotencyServiceModule
        )
          ? new (
              PaymentIdempotencyServiceModule
                .PaymentIdempotencyService ||
              PaymentIdempotencyServiceModule
            )(
              {
                repository:
                  dependencies.idempotencyRepository,

                auditService:
                  dependencies.auditService,

                metrics:
                  dependencies.metrics,

                logger:
                  dependencies.logger ||
                  console,

                options:
                  dependencies
                    .idempotencyOptions ||
                  {},
              },
            )
          : null
      );

    this.auditService =
      dependencies.auditService ||
      null;

    this.metrics =
      dependencies.metrics ||
      null;

    this.logger =
      dependencies.logger ||
      console;

    this.options =
      Object.freeze({
        ...DEFAULT_OPTIONS,
        ...(dependencies.options || {}),
      });
  }

  /* ==========================================================================
   * Primary Entry Point
   * ======================================================================== */

  /**
   * Start settlement for a successful financial payment.
   *
   * @param {string|Object} paymentOrId
   * @param {Object} context
   *
   * Returns a settlement workflow result rather than mutating the caller's
   * payment object.
   */
  async execute(
    paymentOrId,
    rawContext = {},
  ) {
    const context =
      this._normalizeContext(
        rawContext,
      );

    const operationId =
      context.operationId ||
      createOperationId();

    context.operationId =
      operationId;

    this._assertContext(
      context,
    );

    const payment =
      await this._loadPayment(
        paymentOrId,
        context,
      );

    await this._validatePaymentEligibility(
      payment,
      context,
    );

    const idempotency =
      await this._reserveIdempotency(
        payment,
        context,
      );

    if (
      idempotency.completed
    ) {
      return this._buildReplayResult(
        payment,
        idempotency,
        context,
      );
    }

    const existingSettlement =
      await this._findExistingSettlement(
        payment,
        context,
      );

    if (
      existingSettlement
      && this._isSettlementComplete(
        existingSettlement,
      )
    ) {
      await this._completeIdempotency(
        idempotency,
        existingSettlement,
        payment,
        context,
      );

      return this._buildResult(
        payment,
        existingSettlement,
        context,
        {
          replay:
            true,
        },
      );
    }

    const settlement =
      existingSettlement ||
      await this._createSettlement(
        payment,
        context,
      );

    try {
      await this._publishInitiated(
        payment,
        settlement,
        context,
      );
    } catch (error) {
      await this._handleEventPublicationFailure(
        error,
        payment,
        settlement,
        context,
      );
    }

    const processingSettlement =
      await this._transitionSettlement(
        settlement,
        SETTLEMENT_STATES.PROCESSING,
        context,
        {
          reasonCode:
            'SETTLEMENT_PROCESSING_STARTED',
        },
      );

    let evidence;

    try {
      evidence =
        await this._obtainSettlementEvidence(
          payment,
          processingSettlement,
          context,
        );
    } catch (error) {
      return this._handleSettlementError(
        payment,
        processingSettlement,
        idempotency,
        error,
        context,
      );
    }

    const verification =
      await this._verifySettlementEvidence(
        payment,
        processingSettlement,
        evidence,
        context,
      );

    if (
      verification.outcome
      === SETTLEMENT_OUTCOMES
        .SETTLED
    ) {
      return this._completeSettlement(
        payment,
        processingSettlement,
        verification,
        idempotency,
        context,
      );
    }

    if (
      verification.outcome
      === SETTLEMENT_OUTCOMES
        .PARTIALLY_SETTLED
    ) {
      return this._completePartialSettlement(
        payment,
        processingSettlement,
        verification,
        idempotency,
        context,
      );
    }

    if (
      verification.outcome
      === SETTLEMENT_OUTCOMES
        .MISMATCHED
    ) {
      return this._handleSettlementMismatch(
        payment,
        processingSettlement,
        verification,
        idempotency,
        context,
      );
    }

    if (
      verification.outcome
      === SETTLEMENT_OUTCOMES
        .PENDING
    ) {
      return this._completeSettlementPending(
        payment,
        processingSettlement,
        verification,
        idempotency,
        context,
      );
    }

    if (
      verification.outcome
      === SETTLEMENT_OUTCOMES
        .UNKNOWN
    ) {
      return this._handleSettlementUnknown(
        payment,
        processingSettlement,
        verification,
        idempotency,
        context,
      );
    }

    return this._handleSettlementFailure(
      payment,
      processingSettlement,
      verification,
      idempotency,
      context,
    );
  }

  /* ==========================================================================
   * Eligibility
   * ======================================================================== */

  _assertContext(
    context,
  ) {
    if (
      this.options.requireTenant &&
      !context.tenantId
    ) {
      throw new PaymentSettlementWorkflowError(
        'Tenant context is required for settlement processing.',
        {
          code:
            SETTLEMENT_ERROR_CODES
              .TENANT_REQUIRED,

          statusCode:
            403,
        },
      );
    }

    if (
      this.options.requireIdempotency &&
      !context.idempotencyKey
    ) {
      throw new PaymentSettlementWorkflowError(
        'An idempotency key is required for settlement processing.',
        {
          code:
            SETTLEMENT_ERROR_CODES
              .IDEMPOTENCY_REQUIRED,

          statusCode:
            400,

          tenantId:
            context.tenantId,
        },
      );
    }
  }

  async _validatePaymentEligibility(
    payment,
    context,
  ) {
    if (
      this.options.requireSuccessfulPayment &&
      normalizeStatus(
        payment.status,
      ) !== 'SUCCESSFUL'
    ) {
      throw new PaymentSettlementWorkflowError(
        'Only successful payments may enter the settlement workflow.',
        {
          code:
            SETTLEMENT_ERROR_CODES
              .PAYMENT_NOT_SUCCESSFUL,

          statusCode:
            409,

          paymentId:
            payment.id,

          tenantId:
            context.tenantId,
        },
      );
    }

    if (
      this.options.requireFinancialTransaction
      && !payment.financialTransactionId
    ) {
      throw new PaymentSettlementWorkflowError(
        'A financial transaction is required before settlement.',
        {
          code:
            SETTLEMENT_ERROR_CODES
              .FINANCIAL_TRANSACTION_REQUIRED,

          statusCode:
            409,

          paymentId:
            payment.id,

          tenantId:
            context.tenantId,
        },
      );
    }

    if (
      this.options.requirePostedFinancialTransaction
      && payment.financialTransactionId
    ) {
      const financial =
        await this._getFinancialTransaction(
          payment.financialTransactionId,
          context,
        );

      if (
        financial
        && !this._isPostedFinancialTransaction(
          financial,
        )
      ) {
        throw new PaymentSettlementWorkflowError(
          'The financial transaction is not yet posted and cannot be settled.',
          {
            code:
              SETTLEMENT_ERROR_CODES
                .FINANCIAL_TRANSACTION_NOT_POSTED,

            statusCode:
              409,

            paymentId:
              payment.id,

            tenantId:
              context.tenantId,
          },
        );
      }
    }

    if (
      this.options.requireProvider
      && !normalizeProvider(
        payment.provider,
      )
    ) {
      throw new PaymentSettlementWorkflowError(
        'Payment provider is required for settlement.',
        {
          code:
            SETTLEMENT_ERROR_CODES
              .PROVIDER_REQUIRED,

          statusCode:
            400,

          paymentId:
            payment.id,

          tenantId:
            context.tenantId,
        },
      );
    }

    if (
      this.options.requireProviderTransactionReference
      && !normalizeString(
        payment.providerTransactionId,
      )
    ) {
      throw new PaymentSettlementWorkflowError(
        'Provider transaction reference is required for settlement.',
        {
          code:
            SETTLEMENT_ERROR_CODES
              .PROVIDER_REFERENCE_REQUIRED,

          statusCode:
            409,

          paymentId:
            payment.id,

          tenantId:
            context.tenantId,
        },
      );
    }

    if (
      !canonicalAmount(
        payment.amount,
      )
    ) {
      throw new PaymentSettlementWorkflowError(
        'Payment amount is required for settlement.',
        {
          code:
            SETTLEMENT_ERROR_CODES
              .AMOUNT_REQUIRED,

          statusCode:
            400,

          paymentId:
            payment.id,

          tenantId:
            context.tenantId,
        },
      );
    }

    if (
      !canonicalCurrency(
        payment.currency,
      )
    ) {
      throw new PaymentSettlementWorkflowError(
        'Payment currency is required for settlement.',
        {
          code:
            SETTLEMENT_ERROR_CODES
              .CURRENCY_REQUIRED,

          statusCode:
            400,

          paymentId:
            payment.id,

          tenantId:
            context.tenantId,
        },
      );
    }
  }

  /* ==========================================================================
   * Idempotency
   * ======================================================================== */

  async _reserveIdempotency(
    payment,
    context,
  ) {
    if (
      !this.paymentIdempotencyService
    ) {
      if (
        this.options.strictMode
      ) {
        throw new PaymentSettlementWorkflowError(
          'Payment idempotency service is required for settlement.',
          {
            code:
              SETTLEMENT_ERROR_CODES
                .CONFIGURATION_ERROR,

            statusCode:
              500,

            paymentId:
              payment.id,

            tenantId:
              context.tenantId,
          },
        );
      }

      return {
        operationId:
          context.operationId,

        completed:
          false,
      };
    }

    const key =
      context.idempotencyKey ||
      `settlement:${payment.id}`;

    const result =
      await this.paymentIdempotencyService
        .reserve({
          tenantId:
            context.tenantId,

          operationType:
            (
              PaymentIdempotencyServiceModule
              ?.PAYMENT_IDEMPOTENCY_OPERATION_TYPES
                ?.SETTLEMENT
            ) ||
            'SETTLEMENT',

          key,

          operationId:
            context.operationId,

          paymentId:
            payment.id,

          paymentReference:
            payment.paymentReference,

          provider:
            payment.provider,

          providerTransactionId:
            payment.providerTransactionId,

          request: {
            paymentId:
              payment.id,

            financialTransactionId:
              payment.financialTransactionId,

            amount:
              canonicalAmount(
                payment.amount,
              ),

            currency:
              canonicalCurrency(
                payment.currency,
              ),

            provider:
              normalizeProvider(
                payment.provider,
              ),

            providerTransactionId:
              payment.providerTransactionId,
          },

          metadata:
            this._sanitizeMetadata(
              context.metadata,
            ),
        });

    return {
      ...result,

      operationId:
        result.operationId,

      completed:
        result.status === 'COMPLETED',

      result:
        result.result ||
        null,
    };
  }

  async _completeIdempotency(
    idempotency,
    settlement,
    payment,
    context,
  ) {
    if (
      !this.paymentIdempotencyService
      || !idempotency?.operationId
    ) {
      return null;
    }

    return this.paymentIdempotencyService
      .complete(
        idempotency.operationId,
        {
          success:
            true,

          outcome:
            SETTLEMENT_OUTCOMES
              .SETTLED,

          settlementId:
            settlement.id,

          settlementReference:
            settlement.settlementReference,

          paymentId:
            payment.id,

          status:
            SETTLEMENT_STATES.SETTLED,
        },
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
  }

  /* ==========================================================================
   * Settlement Persistence
   * ======================================================================== */

  async _findExistingSettlement(
    payment,
    context,
  ) {
    if (
      !this.settlementRepository
    ) {
      if (
        this.options.strictMode
      ) {
        throw new PaymentSettlementWorkflowError(
          'Settlement repository is required.',
          {
            code:
              SETTLEMENT_ERROR_CODES
                .PERSISTENCE_UNAVAILABLE,

            statusCode:
              503,

            paymentId:
              payment.id,

            tenantId:
              context.tenantId,
          },
        );
      }

      return null;
    }

    let settlement = null;

    if (
      typeof this.settlementRepository
        .findActiveByPaymentId
        === 'function'
    ) {
      settlement =
        await this.settlementRepository
          .findActiveByPaymentId(
            payment.id,
            {
              tenantId:
                context.tenantId,
            },
          );
    } else if (
      typeof this.settlementRepository
        .findByPaymentId
        === 'function'
    ) {
      settlement =
        await this.settlementRepository
          .findByPaymentId(
            payment.id,
            {
              tenantId:
                context.tenantId,
            },
          );
    }

    if (
      Array.isArray(
        settlement,
      )
    ) {
      if (
        !settlement.length
      ) {
        return null;
      }

      const active =
        settlement.find(
          (item) =>
            ![
              SETTLEMENT_STATES
                .CANCELLED,
            ].includes(
              normalizeStatus(
                item.status,
              ),
            ),
        );

      if (
        this.options
          .enforceSingleActiveSettlement
        &&
        settlement.filter(
          (item) =>
            normalizeStatus(
              item.status,
            ) ===
            SETTLEMENT_STATES.SETTLED,
        ).length > 1
      ) {
        throw new PaymentSettlementWorkflowError(
          'Multiple settled records exist for a single payment.',
          {
            code:
              SETTLEMENT_ERROR_CODES
                .DUPLICATE_REFERENCE,

            statusCode:
              409,

            paymentId:
              payment.id,

            tenantId:
              context.tenantId,

            reconciliationRequired:
              true,
          },
        );
      }

      return active || settlement[0];
    }

    return settlement ||
      null;
  }

  async _createSettlement(
    payment,
    context,
  ) {
    if (
      !this.settlementRepository
      || typeof this.settlementRepository
        .create !== 'function'
    ) {
      if (
        this.options.strictMode
      ) {
        throw new PaymentSettlementWorkflowError(
          'Settlement repository does not implement create().',
          {
            code:
              SETTLEMENT_ERROR_CODES
                .PERSISTENCE_UNAVAILABLE,

            statusCode:
              503,

            paymentId:
              payment.id,

            tenantId:
              context.tenantId,
          },
        );
      }

      return {
        id:
          `settlement_${crypto.randomUUID()}`,

        tenantId:
          context.tenantId,

        paymentId:
          payment.id,

        paymentReference:
          payment.paymentReference,

        settlementReference:
          createSettlementReference(),

        provider:
          payment.provider,

        providerTransactionId:
          payment.providerTransactionId,

        expectedAmount:
          canonicalAmount(
            payment.amount,
          ),

        settledAmount:
          null,

        currency:
          canonicalCurrency(
            payment.currency,
          ),

        financialTransactionId:
          payment.financialTransactionId,

        status:
          SETTLEMENT_STATES.PENDING,

        version:
          0,

        createdAt:
          now(),

        updatedAt:
          now(),
      };
    }

    const payload = {
      tenantId:
        context.tenantId,

      paymentId:
        payment.id,

      paymentReference:
        payment.paymentReference ||
        null,

      settlementReference:
        createSettlementReference(),

      provider:
        normalizeProvider(
          payment.provider,
        ),

      providerTransactionId:
        payment.providerTransactionId,

      expectedAmount:
        canonicalAmount(
          payment.amount,
        ),

      expectedCurrency:
        canonicalCurrency(
          payment.currency,
        ),

      settledAmount:
        null,

      financialTransactionId:
        payment.financialTransactionId,

      status:
        SETTLEMENT_STATES.PENDING,

      version:
        0,

      createdAt:
        now(),

      updatedAt:
        now(),

      createdBy:
        context.actorId || null,
    };

    const settlement =
      await this.settlementRepository.create(
        payload,
        {
          tenantId:
            context.tenantId,

          persistenceContext:
            context.persistenceContext,
        },
      );

    if (!settlement) {
      throw new PaymentSettlementWorkflowError(
        'Settlement could not be created.',
        {
          code:
            SETTLEMENT_ERROR_CODES
              .PERSISTENCE_UNAVAILABLE,

          statusCode:
            503,

          paymentId:
            payment.id,

          tenantId:
            context.tenantId,
        },
      );
    }

    return this._normalizeSettlement(
      settlement,
    );
  }

  async _transitionSettlement(
    settlement,
    targetState,
    context,
    options = {},
  ) {
    const current =
      this._normalizeSettlement(
        settlement,
      );

    const fromState =
      normalizeStatus(
        current.status,
      );

    if (
      fromState ===
      targetState
    ) {
      return current;
    }

    const allowed =
      SETTLEMENT_TRANSITIONS[
        fromState
      ] || [];

    if (
      !allowed.includes(
        targetState,
      )
    ) {
      throw new PaymentSettlementWorkflowError(
        `Settlement transition ${fromState} -> ${targetState} is not permitted.`,
        {
          code:
            SETTLEMENT_ERROR_CODES
              .INVALID_TRANSITION,

          statusCode:
            409,

          paymentId:
            current.paymentId,

          settlementId:
            current.id,

          tenantId:
            context.tenantId,

          details: {
            allowedTransitions:
              allowed,
          },
        },
      );
    }

    if (
      this.options.preventSettledDowngrade &&
      fromState ===
        SETTLEMENT_STATES.SETTLED
    ) {
      throw new PaymentSettlementWorkflowError(
        'A SETTLED settlement cannot be downgraded.',
        {
          code:
            SETTLEMENT_ERROR_CODES
              .INVALID_TRANSITION,

          statusCode:
            409,

          paymentId:
            current.paymentId,

          settlementId:
            current.id,

          tenantId:
            context.tenantId,
        },
      );
    }

    const expectedVersion =
      parseVersion(
        current.version,
      ) ?? 0;

    const patch = {
      status:
        targetState,

      version:
        expectedVersion + 1,

      updatedAt:
        now(),

      updatedBy:
        context.actorId || null,

      lastTransition:
        options.reasonCode ||
        null,

      lastTransitionAt:
        now(),

      lastTransitionBy:
        context.actorId || null,

      ...(targetState ===
      SETTLEMENT_STATES.SETTLED
        ? {
            settledAt:
              now(),
          }
        : {}),

      ...(targetState ===
      SETTLEMENT_STATES.MATCHED
        ? {
            matchedAt:
              now(),
          }
        : {}),

      ...(targetState ===
      SETTLEMENT_STATES.REQUIRES_RECONCILIATION
        ? {
            reconciliationRequired:
              true,
          }
        : {}),
    };

    if (
      this.settlementRepository
      && typeof this.settlementRepository
        .updateWithVersion
        === 'function'
    ) {
      const updated =
        await this.settlementRepository
          .updateWithVersion(
            current.id,
            expectedVersion,
            patch,
            {
              tenantId:
                context.tenantId,

              persistenceContext:
                context.persistenceContext,
            },
          );

      if (!updated) {
        throw new PaymentSettlementWorkflowError(
          'Settlement was modified concurrently.',
          {
            code:
              SETTLEMENT_ERROR_CODES
                .CONCURRENT_UPDATE,

            statusCode:
              409,

            paymentId:
              current.paymentId,

            settlementId:
              current.id,

            tenantId:
              context.tenantId,
          },
        );
      }

      return this._normalizeSettlement(
        updated,
      );
    }

    if (
      this.settlementRepository
      && typeof this.settlementRepository
        .transitionWithVersion
        === 'function'
    ) {
      const updated =
        await this.settlementRepository
          .transitionWithVersion(
            current.id,
            expectedVersion,
            patch,
            {
              tenantId:
                context.tenantId,

              persistenceContext:
                context.persistenceContext,
            },
          );

      if (!updated) {
        throw new PaymentSettlementWorkflowError(
          'Settlement was modified concurrently.',
          {
            code:
              SETTLEMENT_ERROR_CODES
                .CONCURRENT_UPDATE,

            statusCode:
              409,

            paymentId:
              current.paymentId,

            settlementId:
              current.id,

            tenantId:
              context.tenantId,
          },
        );
      }

      return this._normalizeSettlement(
        updated,
      );
    }

    if (
      this.options.strictMode
    ) {
      throw new PaymentSettlementWorkflowError(
        'Atomic settlement state persistence is required in strict mode.',
        {
          code:
            SETTLEMENT_ERROR_CODES
              .PERSISTENCE_UNAVAILABLE,

          statusCode:
            500,

          paymentId:
            current.paymentId,

          settlementId:
            current.id,

          tenantId:
            context.tenantId,
        },
      );
    }

    return this._normalizeSettlement({
      ...current,
      ...patch,
    });
  }

  /* ==========================================================================
   * Settlement Evidence
   * ======================================================================== */

  async _obtainSettlementEvidence(
    payment,
    settlement,
    context,
  ) {
    /**
     * 1. Explicit evidence supplied to the workflow.
     */
    if (
      context.settlementEvidence
    ) {
      return this._normalizeSettlementEvidence(
        context.settlementEvidence,
        payment,
        settlement,
      );
    }

    /**
     * 2. Dedicated settlement service.
     */
    if (
      this.providerSettlementService
    ) {
      return this._queryProviderSettlement(
        payment,
        settlement,
        context,
      );
    }

    /**
     * 3. No external evidence yet.
     */
    if (
      this.options.allowAsynchronousSettlement
    ) {
      return {
        outcome:
          SETTLEMENT_OUTCOMES
            .PENDING,

        provider:
          payment.provider,

        providerTransactionId:
          payment.providerTransactionId,

        expectedAmount:
          canonicalAmount(
            payment.amount,
          ),

        settledAmount:
          null,

        currency:
          canonicalCurrency(
            payment.currency,
          ),

        evidenceVerified:
          false,

        reasonCode:
          'SETTLEMENT_EVIDENCE_NOT_AVAILABLE',
      };
    }

    throw new PaymentSettlementWorkflowError(
      'No settlement evidence source is configured.',
      {
        code:
          SETTLEMENT_ERROR_CODES
            .PROVIDER_QUERY_UNAVAILABLE,

        statusCode:
          503,

        paymentId:
          payment.id,

        settlementId:
          settlement.id,

        tenantId:
          context.tenantId,
      },
    );
  }

  async _queryProviderSettlement(
    payment,
    settlement,
    context,
  ) {
    const service =
      this.providerSettlementService;

    let result = null;

    try {
      if (
        typeof service.getSettlementStatus
        === 'function'
      ) {
        result =
          await this._withTimeout(
            () =>
              service.getSettlementStatus(
                {
                  paymentId:
                    payment.id,

                  settlementId:
                    settlement.id,

                  settlementReference:
                    settlement.settlementReference,

                  provider:
                    payment.provider,

                  providerTransactionId:
                    payment.providerTransactionId,

                  expectedAmount:
                    canonicalAmount(
                      payment.amount,
                    ),

                  currency:
                    canonicalCurrency(
                      payment.currency,
                    ),
                },
                context,
              ),
            this.options
              .providerQueryTimeoutMs,
          );
      } else if (
        typeof service.querySettlement
        === 'function'
      ) {
        result =
          await this._withTimeout(
            () =>
              service.querySettlement(
                {
                  paymentId:
                    payment.id,

                  settlementId:
                    settlement.id,

                  provider:
                    payment.provider,

                  providerTransactionId:
                    payment.providerTransactionId,
                },
                context,
              ),
            this.options
              .providerQueryTimeoutMs,
          );
      } else if (
        typeof service.verifySettlement
        === 'function'
      ) {
        result =
          await this._withTimeout(
            () =>
              service.verifySettlement(
                {
                  payment,
                  settlement,
                },
                context,
              ),
            this.options
              .providerQueryTimeoutMs,
          );
      } else {
        throw new PaymentSettlementWorkflowError(
          'Settlement provider service does not implement a supported status operation.',
          {
            code:
              SETTLEMENT_ERROR_CODES
                .PROVIDER_QUERY_UNAVAILABLE,

            statusCode:
              503,

            paymentId:
              payment.id,

            settlementId:
              settlement.id,

            tenantId:
              context.tenantId,
          },
        );
      }
    } catch (error) {
      if (
        this._isUnknownOutcome(
          error,
        )
      ) {
        return {
          outcome:
            SETTLEMENT_OUTCOMES
              .UNKNOWN,

          provider:
            payment.provider,

          providerTransactionId:
            payment.providerTransactionId,

          evidenceVerified:
            false,

          reasonCode:
            'SETTLEMENT_PROVIDER_QUERY_UNKNOWN',

          errorCode:
            error.code || null,
        };
      }

      throw new PaymentSettlementWorkflowError(
        'Provider settlement query failed.',
        {
          code:
            SETTLEMENT_ERROR_CODES
              .PROVIDER_QUERY_UNAVAILABLE,

          statusCode:
            Number(
              error?.statusCode,
            ) || 503,

          paymentId:
            payment.id,

          settlementId:
            settlement.id,

          tenantId:
            context.tenantId,

          retryable:
            true,

          cause:
            error,
        },
      );
    }

    return this._normalizeSettlementEvidence(
      result,
      payment,
      settlement,
    );
  }

  _normalizeSettlementEvidence(
    evidence,
    payment,
    settlement,
  ) {
    const plain =
      evidence &&
      typeof evidence === 'object'
        ? evidence
        : {};

    const status =
      normalizeStatus(
        plain.status ||
        plain.settlementStatus ||
        plain.outcome,
      );

    const explicitOutcome =
      normalizeStatus(
        plain.outcome,
      );

    let outcome =
      this._normalizeOutcome(
        explicitOutcome ||
        status,
      );

    const expectedAmount =
      canonicalAmount(
        plain.expectedAmount ||
        payment.amount ||
        settlement.expectedAmount,
      );

    const settledAmount =
      canonicalAmount(
        plain.settledAmount ||
        plain.amount ||
        plain.settledAmountReceived,
      );

    const currency =
      normalizeCurrency(
        plain.currency ||
        payment.currency ||
        settlement.currency,
      );

    const providerTransactionId =
      normalizeString(
        plain.providerTransactionId ||
        plain.transactionReference ||
        plain.externalTransactionId ||
        payment.providerTransactionId,
      );

    const providerSettlementReference =
      normalizeString(
        plain.providerSettlementReference ||
        plain.settlementReference ||
        plain.statementReference,
      );

    const evidenceVerified =
      plain.evidenceVerified === true ||
      plain.verified === true ||
      plain.authoritative === true;

    /**
     * Infer matched/settled state when a provider returns complete settlement
     * evidence without an explicit outcome.
     */
    if (
      !explicitOutcome &&
      expectedAmount &&
      settledAmount &&
      expectedAmount === settledAmount &&
      evidenceVerified
    ) {
      outcome =
        SETTLEMENT_OUTCOMES
          .SETTLED;
    }

    return {
      outcome,

      status,

      provider:
        normalizeProvider(
          plain.provider ||
          payment.provider,
        ),

      providerTransactionId,

      providerSettlementReference,

      expectedAmount,

      settledAmount,

      currency,

      evidenceVerified,

      reconciliationRequired:
        plain.reconciliationRequired
        === true,

      statementDate:
        plain.statementDate ||
        null,

      settlementDate:
        plain.settlementDate ||
        null,

      reasonCode:
        normalizeString(
          plain.reasonCode ||
          plain.code,
        ),

      reason:
        normalizeString(
          plain.reason ||
          plain.message,
        ),

      evidenceId:
        normalizeString(
          plain.evidenceId ||
          plain.id,
        ),

      evidenceHash:
        sha256({
          provider:
            normalizeProvider(
              plain.provider ||
              payment.provider,
            ),

          providerTransactionId,

          providerSettlementReference,

          expectedAmount,

          settledAmount,

          currency,

          outcome,
        }),

      metadata:
        this._sanitizeMetadata(
          plain.metadata,
        ),
    };
  }

  _normalizeOutcome(
    value,
  ) {
    const status =
      normalizeStatus(
        value,
      );

    if (!status) {
      return SETTLEMENT_OUTCOMES
        .UNKNOWN;
    }

    if (
      [
        'SETTLED',
        'SUCCESS',
        'SUCCESSFUL',
        'COMPLETED',
        'MATCHED',
      ].includes(
        status,
      )
    ) {
      return SETTLEMENT_OUTCOMES
        .SETTLED;
    }

    if (
      [
        'PARTIAL',
        'PARTIALLY_SETTLED',
        'PARTIAL_SETTLEMENT',
      ].includes(
        status,
      )
    ) {
      return SETTLEMENT_OUTCOMES
        .PARTIALLY_SETTLED;
    }

    if (
      [
        'PENDING',
        'PROCESSING',
        'IN_PROGRESS',
        'QUEUED',
      ].includes(
        status,
      )
    ) {
      return SETTLEMENT_OUTCOMES
        .PENDING;
    }

    if (
      [
        'MISMATCHED',
        'MISMATCH',
        'AMOUNT_MISMATCH',
        'CURRENCY_MISMATCH',
      ].includes(
        status,
      )
    ) {
      return SETTLEMENT_OUTCOMES
        .MISMATCHED;
    }

    if (
      [
        'FAILED',
        'FAILURE',
        'ERROR',
        'REJECTED',
      ].includes(
        status,
      )
    ) {
      return SETTLEMENT_OUTCOMES
        .FAILED;
    }

    if (
      [
        'UNKNOWN',
        'UNCONFIRMED',
      ].includes(
        status,
      )
    ) {
      return SETTLEMENT_OUTCOMES
        .UNKNOWN;
    }

    return SETTLEMENT_OUTCOMES
      .UNKNOWN;
  }

  async _verifySettlementEvidence(
    payment,
    settlement,
    evidence,
    context,
  ) {
    const checks = [];

    checks.push(
      this._checkSettlementProvider(
        payment,
        settlement,
        evidence,
      ),
    );

    checks.push(
      this._checkSettlementReference(
        payment,
        settlement,
        evidence,
      ),
    );

    checks.push(
      this._checkSettlementAmount(
        payment,
        settlement,
        evidence,
      ),
    );

    checks.push(
      this._checkSettlementCurrency(
        payment,
        settlement,
        evidence,
      ),
    );

    checks.push(
      this._checkEvidenceAuthority(
        evidence,
      ),
    );

    const failed =
      checks.filter(
        (check) =>
          check.status === 'FAILED',
      );

    const pending =
      checks.filter(
        (check) =>
          check.status === 'PENDING',
      );

    let outcome =
      evidence.outcome;

    if (
      failed.length
    ) {
      outcome =
        SETTLEMENT_OUTCOMES
          .MISMATCHED;
    } else if (
      outcome ===
      SETTLEMENT_OUTCOMES.SETTLED
    ) {
      outcome =
        SETTLEMENT_OUTCOMES
          .SETTLED;
    } else if (
      outcome ===
      SETTLEMENT_OUTCOMES
        .PARTIALLY_SETTLED
    ) {
      outcome =
        SETTLEMENT_OUTCOMES
          .PARTIALLY_SETTLED;
    } else if (
      outcome ===
      SETTLEMENT_OUTCOMES.PENDING
    ) {
      outcome =
        SETTLEMENT_OUTCOMES
          .PENDING;
    } else if (
      outcome ===
      SETTLEMENT_OUTCOMES.FAILED
    ) {
      outcome =
        SETTLEMENT_OUTCOMES
          .FAILED;
    } else {
      outcome =
        SETTLEMENT_OUTCOMES
          .UNKNOWN;
    }

    if (
      pending.length
      && outcome ===
        SETTLEMENT_OUTCOMES.SETTLED
    ) {
      outcome =
        SETTLEMENT_OUTCOMES
          .REQUIRES_RECONCILIATION;
    }

    return {
      outcome,

      verified:
        outcome ===
        SETTLEMENT_OUTCOMES.SETTLED,

      checks,

      failedChecks:
        failed,

      pendingChecks:
        pending,

      evidenceHash:
        evidence.evidenceHash,

      provider:
        evidence.provider,

      providerTransactionId:
        evidence.providerTransactionId,

      providerSettlementReference:
        evidence.providerSettlementReference,

      expectedAmount:
        evidence.expectedAmount,

      settledAmount:
        evidence.settledAmount,

      currency:
        evidence.currency,

      reconciliationRequired:
        outcome ===
          SETTLEMENT_OUTCOMES
            .MISMATCHED ||
        outcome ===
          SETTLEMENT_OUTCOMES
            .UNKNOWN ||
        outcome ===
          SETTLEMENT_OUTCOMES
            .REQUIRES_RECONCILIATION,

      verifiedAt:
        isoNow(),
    };
  }

  _checkSettlementProvider(
    payment,
    settlement,
    evidence,
  ) {
    const paymentProvider =
      normalizeProvider(
        payment.provider,
      );

    const evidenceProvider =
      normalizeProvider(
        evidence.provider,
      );

    if (
      paymentProvider &&
      evidenceProvider &&
      paymentProvider !==
        evidenceProvider
    ) {
      return this._failedCheck(
        'PROVIDER',
        SETTLEMENT_ERROR_CODES
          .PROVIDER_REFERENCE_MISMATCH,
        'Settlement evidence provider does not match payment provider.',
        {
          expectedProvider:
            paymentProvider,

          receivedProvider:
            evidenceProvider,
        },
      );
    }

    return this._passedCheck(
      'PROVIDER',
    );
  }

  _checkSettlementReference(
    payment,
    settlement,
    evidence,
  ) {
    const paymentReference =
      normalizeString(
        payment.providerTransactionId,
      );

    const evidenceReference =
      normalizeString(
        evidence.providerTransactionId,
      );

    if (
      this.options
        .requireProviderTransactionReference
      && !evidenceReference
    ) {
      return this._failedCheck(
        'PROVIDER_REFERENCE',
        SETTLEMENT_ERROR_CODES
          .PROVIDER_REFERENCE_REQUIRED,
        'Settlement evidence requires a provider transaction reference.',
      );
    }

    if (
      paymentReference &&
      evidenceReference &&
      paymentReference !==
        evidenceReference
    ) {
      return this._failedCheck(
        'PROVIDER_REFERENCE',
        SETTLEMENT_ERROR_CODES
          .PROVIDER_REFERENCE_MISMATCH,
        'Settlement provider transaction reference does not match the payment.',
        {
          expectedReference:
            paymentReference,

          receivedReference:
            evidenceReference,
        },
      );
    }

    return this._passedCheck(
      'PROVIDER_REFERENCE',
    );
  }

  _checkSettlementAmount(
    payment,
    settlement,
    evidence,
  ) {
    const expected =
      canonicalAmount(
        payment.amount ||
        settlement.expectedAmount,
      );

    const received =
      canonicalAmount(
        evidence.settledAmount,
      );

    if (!expected) {
      return this._failedCheck(
        'AMOUNT',
        SETTLEMENT_ERROR_CODES
          .AMOUNT_REQUIRED,
        'Expected settlement amount is unavailable.',
      );
    }

    /**
     * A pending statement may legitimately omit the settled amount.
     */
    if (
      !received
      && evidence.outcome ===
        SETTLEMENT_OUTCOMES.PENDING
    ) {
      return this._pendingCheck(
        'AMOUNT',
        'SETTLEMENT_AMOUNT_NOT_YET_AVAILABLE',
        'Settlement amount is not yet available.',
      );
    }

    if (
      this.options.requireExactAmountMatch
      && received
      && expected !== received
    ) {
      return this._failedCheck(
        'AMOUNT',
        SETTLEMENT_ERROR_CODES
          .AMOUNT_MISMATCH,
        'Settlement amount does not match expected payment amount.',
        {
          expectedAmount:
            expected,

          settledAmount:
            received,
        },
      );
    }

    return this._passedCheck(
      'AMOUNT',
      {
        expectedAmount:
          expected,

        settledAmount:
          received,
      },
    );
  }

  _checkSettlementCurrency(
    payment,
    settlement,
    evidence,
  ) {
    const expected =
      normalizeCurrency(
        payment.currency ||
        settlement.currency,
      );

    const received =
      normalizeCurrency(
        evidence.currency,
      );

    if (!expected) {
      return this._failedCheck(
        'CURRENCY',
        SETTLEMENT_ERROR_CODES
          .CURRENCY_REQUIRED,
        'Expected settlement currency is unavailable.',
      );
    }

    if (
      !received
      && evidence.outcome ===
        SETTLEMENT_OUTCOMES.PENDING
    ) {
      return this._pendingCheck(
        'CURRENCY',
        'SETTLEMENT_CURRENCY_NOT_YET_AVAILABLE',
        'Settlement currency is not yet available.',
      );
    }

    if (
      this.options.requireExactCurrencyMatch
      && received
      && expected !== received
    ) {
      return this._failedCheck(
        'CURRENCY',
        SETTLEMENT_ERROR_CODES
          .CURRENCY_MISMATCH,
        'Settlement currency does not match the payment currency.',
        {
          expectedCurrency:
            expected,

          receivedCurrency:
            received,
        },
      );
    }

    return this._passedCheck(
      'CURRENCY',
    );
  }

  _checkEvidenceAuthority(
    evidence,
  ) {
    if (
      evidence.outcome ===
      SETTLEMENT_OUTCOMES.PENDING
    ) {
      return this._pendingCheck(
        'AUTHORITY',
        'SETTLEMENT_EVIDENCE_PENDING',
        'Authoritative settlement evidence is not yet available.',
      );
    }

    if (
      this.options
        .requireVerifiedSettlementEvidence
      && !evidence.evidenceVerified
    ) {
      return this._failedCheck(
        'AUTHORITY',
        SETTLEMENT_ERROR_CODES
          .RECONCILIATION_REQUIRED,
        'Settlement evidence has not been marked as authoritative.',
      );
    }

    return this._passedCheck(
      'AUTHORITY',
    );
  }

  _passedCheck(
    name,
    details = {},
  ) {
    return {
      name,
      status:
        'PASSED',
      code:
        null,
      message:
        null,
      details:
        clone(details),
    };
  }

  _failedCheck(
    name,
    code,
    message,
    details = {},
  ) {
    return {
      name,
      status:
        'FAILED',
      code,
      message,
      details:
        clone(details),
    };
  }

  _pendingCheck(
    name,
    code,
    message,
    details = {},
  ) {
    return {
      name,
      status:
        'PENDING',
      code,
      message,
      details:
        clone(details),
    };
  }

  /* ==========================================================================
   * Successful Settlement
   * ======================================================================== */

  async _completeSettlement(
    payment,
    settlement,
    verification,
    idempotency,
    context,
  ) {
    const updated =
      await this._transitionSettlement(
        settlement,
        SETTLEMENT_STATES.MATCHED,
        context,
        {
          reasonCode:
            'SETTLEMENT_MATCHED',
        },
      );

    const settled =
      await this._transitionSettlement(
        {
          ...updated,

          settledAmount:
            verification.settledAmount ||
            verification.expectedAmount,

          settledCurrency:
            verification.currency,

          providerSettlementReference:
            verification
              .providerSettlementReference,

          providerSettlementEvidenceHash:
            verification.evidenceHash,
        },
        SETTLEMENT_STATES.SETTLED,
        context,
        {
          reasonCode:
            'SETTLEMENT_COMPLETED',
        },
      );

    await this._persistSettlementEvidence(
      payment,
      settled,
      verification,
      context,
    );

    await this._completeIdempotency(
      idempotency,
      settled,
      payment,
      context,
    );

    await this._publishCompleted(
      payment,
      settled,
      verification,
      context,
    );

    return this._buildResult(
      payment,
      settled,
      context,
      {
        outcome:
          SETTLEMENT_OUTCOMES.SETTLED,

        verification,
      },
    );
  }

  async _completePartialSettlement(
    payment,
    settlement,
    verification,
    idempotency,
    context,
  ) {
    const partial =
      await this._transitionSettlement(
        {
          ...settlement,

          settledAmount:
            verification.settledAmount,

          providerSettlementReference:
            verification
              .providerSettlementReference,

          providerSettlementEvidenceHash:
            verification.evidenceHash,
        },
        SETTLEMENT_STATES.PARTIALLY_SETTLED,
        context,
        {
          reasonCode:
            'SETTLEMENT_PARTIALLY_SETTLED',
        },
      );

    await this._persistSettlementEvidence(
      payment,
      partial,
      verification,
      context,
    );

    /**
     * Partial settlement is not final completion of the settlement obligation.
     * Keep idempotency open as a recoverable operational state.
     */
    await this._publishPartialSettlement(
      payment,
      partial,
      verification,
      context,
    );

    return this._buildResult(
      payment,
      partial,
      context,
      {
        outcome:
          SETTLEMENT_OUTCOMES
            .PARTIALLY_SETTLED,

        verification,

        nextAction:
          'AWAIT_REMAINING_SETTLEMENT',
      },
    );
  }

  async _completeSettlementPending(
    payment,
    settlement,
    verification,
    idempotency,
    context,
  ) {
    const pending =
      this._normalizeSettlement({
        ...settlement,

        status:
          SETTLEMENT_STATES.PROCESSING,

        lastSettlementEvidenceAt:
          now(),
      });

    await this._persistSettlementEvidence(
      payment,
      pending,
      verification,
      context,
    );

    await this._publishProcessing(
      payment,
      pending,
      context,
    );

    return this._buildResult(
      payment,
      pending,
      context,
      {
        outcome:
          SETTLEMENT_OUTCOMES.PENDING,

        verification,

        nextAction:
          'RETRY_SETTLEMENT_QUERY',
      },
    );
  }

  /* ==========================================================================
   * Mismatch / Unknown / Failure
   * ======================================================================== */

  async _handleSettlementMismatch(
    payment,
    settlement,
    verification,
    idempotency,
    context,
  ) {
    const mismatched =
      await this._transitionSettlement(
        settlement,
        SETTLEMENT_STATES.MISMATCHED,
        context,
        {
          reasonCode:
            'SETTLEMENT_EVIDENCE_MISMATCH',
        },
      );

    await this._persistSettlementEvidence(
      payment,
      mismatched,
      verification,
      context,
    );

    const reconciliation =
      await this._createReconciliationCase(
        payment,
        mismatched,
        verification,
        context,
      );

    await this._markIdempotencyUnknown(
      idempotency,
      context,
      'SETTLEMENT_MISMATCH',
    );

    await this._publishMismatched(
      payment,
      mismatched,
      verification,
      context,
    );

    return this._buildResult(
      payment,
      mismatched,
      context,
      {
        outcome:
          SETTLEMENT_OUTCOMES.MISMATCHED,

        verification,

        reconciliation,

        nextAction:
          'RECONCILE_SETTLEMENT',
      },
    );
  }

  async _handleSettlementUnknown(
    payment,
    settlement,
    verification,
    idempotency,
    context,
  ) {
    const unknown =
      await this._transitionSettlement(
        settlement,
        SETTLEMENT_STATES.UNKNOWN,
        context,
        {
          reasonCode:
            'SETTLEMENT_OUTCOME_UNKNOWN',
        },
      );

    await this._persistSettlementEvidence(
      payment,
      unknown,
      verification,
      context,
    );

    const reconciliation =
      await this._createReconciliationCase(
        payment,
        unknown,
        verification,
        context,
      );

    await this._markIdempotencyUnknown(
      idempotency,
      context,
      'SETTLEMENT_OUTCOME_UNKNOWN',
    );

    await this._publishUnknown(
      payment,
      unknown,
      verification,
      context,
    );

    return this._buildResult(
      payment,
      unknown,
      context,
      {
        outcome:
          SETTLEMENT_OUTCOMES.UNKNOWN,

        verification,

        reconciliation,

        nextAction:
          'RECONCILE_SETTLEMENT',
      },
    );
  }

  async _handleSettlementFailure(
    payment,
    settlement,
    verification,
    idempotency,
    context,
  ) {
    const failed =
      await this._transitionSettlement(
        settlement,
        SETTLEMENT_STATES.FAILED,
        context,
        {
          reasonCode:
            verification.reasonCode ||
            'SETTLEMENT_FAILED',
        },
      );

    await this._persistSettlementEvidence(
      payment,
      failed,
      verification,
      context,
    );

    if (
      this.paymentIdempotencyService
    ) {
      await this.paymentIdempotencyService
        .fail(
          idempotency.operationId,
          new Error(
            verification.reason ||
            'Settlement failed.',
          ),
          {
            paymentId:
              payment.id,

            reasonCode:
              verification.reasonCode ||
              'SETTLEMENT_FAILED',

            retryable:
              true,
          },
        );
    }

    await this._publishFailed(
      payment,
      failed,
      verification,
      context,
    );

    return this._buildResult(
      payment,
      failed,
      context,
      {
        outcome:
          SETTLEMENT_OUTCOMES.FAILED,

        verification,

        nextAction:
          'RETRY_SETTLEMENT',
      },
    );
  }

  async _handleSettlementError(
    payment,
    settlement,
    idempotency,
    error,
    context,
  ) {
    if (
      this._isUnknownOutcome(
        error,
      )
    ) {
      return this._handleSettlementUnknown(
        payment,
        settlement,
        {
          outcome:
            SETTLEMENT_OUTCOMES.UNKNOWN,

          reason:
            error?.message,

          reasonCode:
            error?.code ||
            SETTLEMENT_ERROR_CODES
              .UNKNOWN_OUTCOME,

          evidenceVerified:
            false,

          evidenceHash:
            null,
        },
        idempotency,
        context,
      );
    }

    const failed =
      await this._transitionSettlement(
        settlement,
        SETTLEMENT_STATES.FAILED,
        context,
        {
          reasonCode:
            'SETTLEMENT_WORKFLOW_ERROR',
        },
      );

    if (
      this.paymentIdempotencyService
    ) {
      await this.paymentIdempotencyService
        .fail(
          idempotency.operationId,
          error,
          {
            paymentId:
              payment.id,

            reasonCode:
              error?.code ||
              'SETTLEMENT_WORKFLOW_ERROR',

            retryable:
              error?.retryable === true,
          },
        );
    }

    await this._publishFailed(
      payment,
      failed,
      {
        outcome:
          SETTLEMENT_OUTCOMES.FAILED,

        reason:
          error?.message,

        reasonCode:
          error?.code,

        evidenceVerified:
          false,
      },
      context,
    );

    throw error instanceof
      PaymentSettlementWorkflowError
      ? error
      : new PaymentSettlementWorkflowError(
          error?.message ||
          'Settlement workflow failed.',
          {
            code:
              SETTLEMENT_ERROR_CODES
                .INVALID_REQUEST,

            statusCode:
              Number(
                error?.statusCode,
              ) || 503,

            paymentId:
              payment.id,

            settlementId:
              settlement.id,

            tenantId:
              context.tenantId,

            retryable:
              error?.retryable === true,

            cause:
              error,
          },
        );
  }

  async _createReconciliationCase(
    payment,
    settlement,
    verification,
    context,
  ) {
    if (
      !this.options.enableReconciliation
    ) {
      return {
        status:
          'DISABLED',
      };
    }

    if (
      !this.reconciliationService
    ) {
      if (
        this.options.strictMode
      ) {
        throw new PaymentSettlementWorkflowError(
          'Reconciliation service is required for settlement exceptions.',
          {
            code:
              SETTLEMENT_ERROR_CODES
                .RECONCILIATION_UNAVAILABLE,

            statusCode:
              503,

            paymentId:
              payment.id,

            settlementId:
              settlement.id,

            tenantId:
              context.tenantId,

            reconciliationRequired:
              true,
          },
        );
      }

      return {
        status:
          'NOT_CONFIGURED',
      };
    }

    const payload = {
      sourceType:
        'PAYMENT_SETTLEMENT',

      sourceId:
        settlement.id,

      paymentId:
        payment.id,

      settlementId:
        settlement.id,

      tenantId:
        context.tenantId,

      provider:
        normalizeProvider(
          payment.provider,
        ),

      providerTransactionId:
        normalizeString(
          payment.providerTransactionId,
        ),

      settlementReference:
        normalizeString(
          settlement.settlementReference,
        ),

      exceptionType:
        this._deriveSettlementExceptionType(
          verification,
        ),

      severity:
        'HIGH',

      expectedAmount:
        canonicalAmount(
          payment.amount,
        ),

      settledAmount:
        canonicalAmount(
          verification.settledAmount,
        ),

      expectedCurrency:
        normalizeCurrency(
          payment.currency,
        ),

      receivedCurrency:
        normalizeCurrency(
          verification.currency,
        ),

      evidenceHash:
        verification.evidenceHash,

      metadata:
        this._sanitizeMetadata(
          verification,
        ),
    };

    if (
      typeof this.reconciliationService
        .createSettlementException
        === 'function'
    ) {
      return this.reconciliationService
        .createSettlementException(
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

    if (
      typeof this.reconciliationService
        .createPaymentException
        === 'function'
    ) {
      return this.reconciliationService
        .createPaymentException(
          payload,
          context,
        );
    }

    throw new PaymentSettlementWorkflowError(
      'Configured reconciliation service does not implement a supported settlement exception API.',
      {
        code:
          SETTLEMENT_ERROR_CODES
            .RECONCILIATION_UNAVAILABLE,

        statusCode:
          503,

        paymentId:
          payment.id,

        settlementId:
          settlement.id,

        tenantId:
          context.tenantId,

        reconciliationRequired:
          true,
      },
    );
  }

  _deriveSettlementExceptionType(
    verification,
  ) {
    if (
      verification.failedChecks
      ?.some(
        (check) =>
          check.code ===
          SETTLEMENT_ERROR_CODES
            .AMOUNT_MISMATCH,
      )
    ) {
      return 'SETTLEMENT_AMOUNT_MISMATCH';
    }

    if (
      verification.failedChecks
      ?.some(
        (check) =>
          check.code ===
          SETTLEMENT_ERROR_CODES
            .CURRENCY_MISMATCH,
      )
    ) {
      return 'SETTLEMENT_CURRENCY_MISMATCH';
    }

    if (
      verification.failedChecks
      ?.some(
        (check) =>
          check.code ===
          SETTLEMENT_ERROR_CODES
            .PROVIDER_REFERENCE_MISMATCH,
      )
    ) {
      return 'SETTLEMENT_PROVIDER_REFERENCE_MISMATCH';
    }

    if (
      verification.outcome ===
      SETTLEMENT_OUTCOMES.UNKNOWN
    ) {
      return 'SETTLEMENT_OUTCOME_UNKNOWN';
    }

    return 'PAYMENT_SETTLEMENT_REQUIRES_RECONCILIATION';
  }

  async _markIdempotencyUnknown(
    idempotency,
    context,
    reasonCode,
  ) {
    if (
      !this.paymentIdempotencyService
      || !idempotency?.operationId
    ) {
      return null;
    }

    return this.paymentIdempotencyService
      .markUnknown(
        idempotency.operationId,
        {
          reasonCode,
        },
      );
  }

  /* ==========================================================================
   * Settlement Evidence Persistence
   * ======================================================================== */

  async _persistSettlementEvidence(
    payment,
    settlement,
    verification,
    context,
  ) {
    if (
      !this.settlementRepository
    ) {
      return null;
    }

    const patch = {
      status:
        settlement.status,

      settledAmount:
        canonicalAmount(
          verification.settledAmount,
        ),

      settledCurrency:
        normalizeCurrency(
          verification.currency,
        ),

      providerTransactionId:
        normalizeString(
          verification.providerTransactionId ||
          payment.providerTransactionId,
        ),

      providerSettlementReference:
        normalizeString(
          verification
            .providerSettlementReference,
        ),

      providerSettlementEvidenceHash:
        normalizeString(
          verification.evidenceHash,
        ),

      settlementEvidenceStatus:
        normalizeStatus(
          verification.outcome,
        ),

      settlementEvidenceVerified:
        verification
          .verified === true,

      settlementEvidenceAt:
        now(),

      updatedAt:
        now(),
    };

    if (
      typeof this.settlementRepository
        .recordEvidence
        === 'function'
    ) {
      return this.settlementRepository
        .recordEvidence(
          settlement.id,
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
      typeof this.settlementRepository
        .updateEvidence
        === 'function'
    ) {
      return this.settlementRepository
        .updateEvidence(
          settlement.id,
          patch,
          {
            tenantId:
              context.tenantId,

            persistenceContext:
              context.persistenceContext,
          },
        );
    }

    /**
     * State itself is already persisted by _transitionSettlement when the
     * repository exposes atomic transitions. Do not perform unsafe unversioned
     * updates in strict mode.
     */
    if (
      this.options.strictMode
    ) {
      return null;
    }

    if (
      typeof this.settlementRepository
        .update === 'function'
    ) {
      return this.settlementRepository.update(
        settlement.id,
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
   * Event Publication
   * ======================================================================== */

  async _publishInitiated(
    payment,
    settlement,
    context,
  ) {
    if (
      !this.paymentEventPublisher
    ) {
      return null;
    }

    if (
      typeof this.paymentEventPublisher
        .publishSettlementInitiated
        === 'function'
    ) {
      return this.paymentEventPublisher
        .publishSettlementInitiated(
          payment,
          settlement,
          {
            ...context,

            reasonCode:
              'SETTLEMENT_INITIATED',
          },
        );
    }

    return this._publishGenericEvent(
      SETTLEMENT_EVENT_TYPES
        .INITIATED,
      payment,
      settlement,
      context,
    );
  }

  async _publishProcessing(
    payment,
    settlement,
    context,
  ) {
    return this._publishGenericEvent(
      SETTLEMENT_EVENT_TYPES
        .PROCESSING,
      payment,
      settlement,
      context,
    );
  }

  async _publishCompleted(
    payment,
    settlement,
    verification,
    context,
  ) {
    if (
      !this.paymentEventPublisher
    ) {
      return null;
    }

    if (
      typeof this.paymentEventPublisher
        .publishSettlementCompleted
        === 'function'
    ) {
      return this.paymentEventPublisher
        .publishSettlementCompleted(
          payment,
          {
            ...settlement,

            status:
              SETTLEMENT_STATES.SETTLED,

            settledAmount:
              verification.settledAmount,
          },
          {
            ...context,

            reasonCode:
              'SETTLEMENT_COMPLETED',
          },
        );
    }

    return this._publishGenericEvent(
      SETTLEMENT_EVENT_TYPES
        .COMPLETED,
      payment,
      settlement,
      context,
    );
  }

  async _publishPartialSettlement(
    payment,
    settlement,
    verification,
    context,
  ) {
    return this._publishGenericEvent(
      SETTLEMENT_EVENT_TYPES
        .PARTIALLY_SETTLED,
      payment,
      settlement,
      {
        ...context,

        reasonCode:
          'SETTLEMENT_PARTIALLY_SETTLED',

        metadata: {
          ...(context.metadata || {}),
          settledAmount:
            verification.settledAmount,
        },
      },
    );
  }

  async _publishMismatched(
    payment,
    settlement,
    verification,
    context,
  ) {
    return this._publishGenericEvent(
      SETTLEMENT_EVENT_TYPES
        .MISMATCHED,
      payment,
      settlement,
      {
        ...context,

        reasonCode:
          'SETTLEMENT_MISMATCHED',

        metadata: {
          ...(context.metadata || {}),
          evidenceHash:
            verification.evidenceHash,

          failedChecks:
            verification.failedChecks,
        },
      },
    );
  }

  async _publishUnknown(
    payment,
    settlement,
    verification,
    context,
  ) {
    return this._publishGenericEvent(
      SETTLEMENT_EVENT_TYPES
        .UNKNOWN,
      payment,
      settlement,
      {
        ...context,

        reasonCode:
          'SETTLEMENT_UNKNOWN',

        metadata: {
          ...(context.metadata || {}),
          evidenceHash:
            verification.evidenceHash,
        },
      },
    );
  }

  async _publishFailed(
    payment,
    settlement,
    verification,
    context,
  ) {
    if (
      !this.paymentEventPublisher
    ) {
      return null;
    }

    if (
      typeof this.paymentEventPublisher
        .publishSettlementFailed
        === 'function'
    ) {
      return this.paymentEventPublisher
        .publishSettlementFailed(
          payment,
          {
            ...settlement,

            errorCode:
              verification.reasonCode,

            status:
              SETTLEMENT_STATES.FAILED,
          },
          {
            ...context,

            reasonCode:
              verification.reasonCode ||
              'SETTLEMENT_FAILED',
          },
        );
    }

    return this._publishGenericEvent(
      SETTLEMENT_EVENT_TYPES
        .FAILED,
      payment,
      settlement,
      context,
    );
  }

  async _publishGenericEvent(
    eventType,
    payment,
    settlement,
    context,
  ) {
    if (
      !this.paymentEventPublisher
      || typeof this.paymentEventPublisher
        .publish !== 'function'
    ) {
      return null;
    }

    return this.paymentEventPublisher.publish({
      eventType,

      category:
        'PAYMENT_SETTLEMENT',

      source:
        'PaymentSettlementWorkflow',

      payment,

      context,

      payload: {
        settlementId:
          settlement.id,

        settlementReference:
          settlement.settlementReference,

        status:
          settlement.status,

        expectedAmount:
          canonicalAmount(
            settlement.expectedAmount ||
            payment.amount,
          ),

        settledAmount:
          canonicalAmount(
            settlement.settledAmount,
          ),

        currency:
          normalizeCurrency(
            settlement.currency ||
            payment.currency,
          ),

        provider:
          normalizeProvider(
            payment.provider,
          ),

        providerTransactionId:
          normalizeString(
            payment.providerTransactionId,
          ),

        financialTransactionId:
          safeId(
            payment.financialTransactionId,
          ),
      },
    });
  }

  async _handleEventPublicationFailure(
    error,
    payment,
    settlement,
    context,
  ) {
    this._logError(
      'Payment settlement event publication failed.',
      error,
      {
        paymentId:
          payment.id,

        settlementId:
          settlement.id,

        tenantId:
          context.tenantId,
      },
    );

    if (
      this.options
        .failOnEventPublicationError
    ) {
      throw new PaymentSettlementWorkflowError(
        'Settlement event publication failed.',
        {
          code:
            SETTLEMENT_ERROR_CODES
              .EVENT_PUBLISH_FAILED,

          statusCode:
            503,

          paymentId:
            payment.id,

          settlementId:
            settlement.id,

          tenantId:
            context.tenantId,

          retryable:
            true,

          cause:
            error,
        },
      );
    }
  }

  /* ==========================================================================
   * Financial Transaction
   * ======================================================================== */

  async _getFinancialTransaction(
    financialTransactionId,
    context,
  ) {
    if (
      !this.financialService
    ) {
      return null;
    }

    if (
      typeof this.financialService
        .getTransaction
        === 'function'
    ) {
      return this.financialService
        .getTransaction(
          financialTransactionId,
          context,
        );
    }

    if (
      typeof this.financialService
        .findTransaction
        === 'function'
    ) {
      return this.financialService
        .findTransaction(
          financialTransactionId,
          context,
        );
    }

    return null;
  }

  _isPostedFinancialTransaction(
    financial,
  ) {
    if (!financial) {
      return false;
    }

    const status =
      normalizeStatus(
        financial.status,
      );

    return (
      financial.posted === true ||
      [
        'POSTED',
        'COMPLETED',
        'SUCCESSFUL',
      ].includes(
        status,
      )
    );
  }

  /* ==========================================================================
   * Results
   * ======================================================================== */

  _buildReplayResult(
    payment,
    idempotency,
    context,
  ) {
    const result =
      idempotency.result ||
      {};

    return {
      success:
        true,

      replay:
        true,

      outcome:
        result.outcome ||
        SETTLEMENT_OUTCOMES
          .SETTLED,

      paymentId:
        payment.id,

      settlementId:
        result.settlementId ||
        null,

      settlementReference:
        result.settlementReference ||
        null,

      status:
        result.status ||
        SETTLEMENT_STATES.SETTLED,

      operationId:
        context.operationId,

      idempotencyOperationId:
        idempotency.operationId,

      requestId:
        context.requestId ||
        null,

      correlationId:
        context.correlationId ||
        null,
    };
  }

  _buildResult(
    payment,
    settlement,
    context,
    options = {},
  ) {
    const outcome =
      options.outcome ||
      this._outcomeFromSettlement(
        settlement,
      );

    return {
      success:
        outcome ===
        SETTLEMENT_OUTCOMES
          .SETTLED,

      outcome,

      paymentId:
        payment.id,

      paymentReference:
        payment.paymentReference ||
        null,

      settlementId:
        settlement.id,

      settlementReference:
        settlement.settlementReference ||
        null,

      status:
        settlement.status,

      expectedAmount:
        canonicalAmount(
          settlement.expectedAmount ||
          payment.amount,
        ),

      settledAmount:
        canonicalAmount(
          settlement.settledAmount,
        ),

      currency:
        normalizeCurrency(
          settlement.currency ||
          payment.currency,
        ),

      provider:
        normalizeProvider(
          payment.provider,
        ),

      providerTransactionId:
        normalizeString(
          payment.providerTransactionId,
        ),

      financialTransactionId:
        safeId(
          payment.financialTransactionId,
        ),

      operationId:
        context.operationId,

      requestId:
        context.requestId ||
        null,

      correlationId:
        context.correlationId ||
        null,

      replay:
        options.replay === true,

      reconciliationRequired:
        options.reconciliation?.required === true
          ||
        settlement.status ===
          SETTLEMENT_STATES
            .REQUIRES_RECONCILIATION
          ||
        settlement.status ===
          SETTLEMENT_STATES
            .MISMATCHED
          ||
        settlement.status ===
          SETTLEMENT_STATES.UNKNOWN,

      reconciliation:
        options.reconciliation ||
        null,

      verification:
        options.verification
          ? this._sanitizeVerification(
              options.verification,
            )
          : null,

      nextAction:
        options.nextAction ||
        null,
    };
  }

  _outcomeFromSettlement(
    settlement,
  ) {
    switch (
      normalizeStatus(
        settlement.status,
      )
    ) {
      case SETTLEMENT_STATES.SETTLED:
        return SETTLEMENT_OUTCOMES
          .SETTLED;

      case SETTLEMENT_STATES
        .PARTIALLY_SETTLED:
        return SETTLEMENT_OUTCOMES
          .PARTIALLY_SETTLED;

      case SETTLEMENT_STATES
        .MISMATCHED:
        return SETTLEMENT_OUTCOMES
          .MISMATCHED;

      case SETTLEMENT_STATES
        .UNKNOWN:
        return SETTLEMENT_OUTCOMES
          .UNKNOWN;

      case SETTLEMENT_STATES
        .REQUIRES_RECONCILIATION:
        return SETTLEMENT_OUTCOMES
          .REQUIRES_RECONCILIATION;

      case SETTLEMENT_STATES.FAILED:
        return SETTLEMENT_OUTCOMES
          .FAILED;

      default:
        return SETTLEMENT_OUTCOMES
          .PENDING;
    }
  }

  _sanitizeVerification(
    verification,
  ) {
    if (!verification) {
      return null;
    }

    return {
      outcome:
        verification.outcome ||
        null,

      verified:
        verification.verified === true,

      evidenceHash:
        verification.evidenceHash ||
        null,

      provider:
        verification.provider ||
        null,

      providerTransactionId:
        verification.providerTransactionId ||
        null,

      providerSettlementReference:
        verification.providerSettlementReference ||
        null,

      expectedAmount:
        canonicalAmount(
          verification.expectedAmount,
        ),

      settledAmount:
        canonicalAmount(
          verification.settledAmount,
        ),

      currency:
        normalizeCurrency(
          verification.currency,
        ),

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

  /* ==========================================================================
   * Settlement Normalization
   * ======================================================================== */

  _normalizeSettlement(
    settlement,
  ) {
    if (
      !settlement
      || typeof settlement !==
        'object'
    ) {
      throw new PaymentSettlementWorkflowError(
        'Invalid settlement object.',
        {
          code:
            SETTLEMENT_ERROR_CODES
              .INVALID_REQUEST,

          statusCode:
            400,
        },
      );
    }

    const plain =
      typeof settlement.toObject ===
        'function'
        ? settlement.toObject()
        : settlement;

    const id =
      safeId(
        plain.id ||
        plain._id,
      );

    return {
      ...clone(plain),

      id:

        id ||
        `settlement_${crypto.randomUUID()}`,

      tenantId:
        normalizeString(
          plain.tenantId,
        ),

      paymentId:
        safeId(
          plain.paymentId,
        ),

      paymentReference:
        normalizeString(
          plain.paymentReference,
        ),

      settlementReference:
        normalizeString(
          plain.settlementReference,
        ) ||
        createSettlementReference(),

      provider:
        normalizeProvider(
          plain.provider,
        ),

      providerTransactionId:
        normalizeString(
          plain.providerTransactionId,
        ),

      providerSettlementReference:
        normalizeString(
          plain.providerSettlementReference,
        ),

      financialTransactionId:
        safeId(
          plain.financialTransactionId,
        ),

      expectedAmount:
        canonicalAmount(
          plain.expectedAmount,
        ),

      settledAmount:
        canonicalAmount(
          plain.settledAmount,
        ),

      currency:
        normalizeCurrency(
          plain.currency,
        ),

      settledCurrency:
        normalizeCurrency(
          plain.settledCurrency,
        ),

      status:
        normalizeStatus(
          plain.status,
        ) ||
        SETTLEMENT_STATES.PENDING,

      version:
        parseVersion(
          plain.version,
        ) ??
        0,

      reconciliationRequired:
        plain.reconciliationRequired
        === true,

      createdAt:
        plain.createdAt ||
        null,

      updatedAt:
        plain.updatedAt ||
        null,
    };
  }

  _isSettlementComplete(
    settlement,
  ) {
    return (
      normalizeStatus(
        settlement.status,
      ) ===
      SETTLEMENT_STATES.SETTLED
    );
  }

  /* ==========================================================================
   * Generic Helpers
   * ======================================================================== */

  _normalizeContext(
    context,
  ) {
    return {
      tenantId:
        normalizeString(
          context?.tenantId,
        ),

      actorId:
        normalizeString(
          context?.actorId,
        ),

      actorType:
        normalizeString(
          context?.actorType,
        ) ||
        'SYSTEM',

      actorRole:
        normalizeString(
          context?.actorRole,
        ),

      requestId:
        normalizeString(
          context?.requestId,
        ),

      correlationId:
        normalizeString(
          context?.correlationId,
        ),

      causationId:
        normalizeString(
          context?.causationId,
        ),

      operationId:
        normalizeString(
          context?.operationId,
        ),

      idempotencyKey:
        normalizeString(
          context?.idempotencyKey,
        ),

      settlementEvidence:
        context?.settlementEvidence ||
        null,

      metadata:
        this._sanitizeMetadata(
          context?.metadata ||
          {},
        ),

      persistenceContext:
        context?.persistenceContext ||
        null,
    };
  }

  _isUnknownOutcome(
    error,
  ) {
    if (
      error?.unknownOutcome === true ||
      error?.reconciliationRequired === true
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
      'SETTLEMENT_UNKNOWN',
      'PROVIDER_QUERY_UNKNOWN',
    ].includes(
      code,
    );
  }

  _sanitizeMetadata(
    metadata,
  ) {
    if (
      !metadata ||
      typeof metadata !==
        'object'
    ) {
      return {};
    }

    const sensitiveKeys =
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

    const sanitize =
      (value, depth = 0) => {
        if (
          depth > 8
        ) {
          return '[MAX_DEPTH]';
        }

        if (
          value === null ||
          value === undefined
        ) {
          return value;
        }

        if (
          typeof value === 'string'
        ) {
          return value.length > 5000
            ? `${value.slice(
                0,
                5000,
              )}...`
            : value;
        }

        if (
          typeof value !== 'object'
        ) {
          return value;
        }

        if (
          Array.isArray(value)
        ) {
          return value
            .slice(0, 100)
            .map(
              (item) =>
                sanitize(
                  item,
                  depth + 1,
                ),
            );
        }

        const output = {};

        for (
          const [
            key,
            child,
          ] of Object.entries(
            value,
          ).slice(0, 100)
        ) {
          if (
            sensitiveKeys.has(
              key,
            )
          ) {
            output[key] =
              '[REDACTED]';

            continue;
          }

          output[key] =
            sanitize(
              child,
              depth + 1,
            );
        }

        return output;
      };

    return sanitize(
      metadata,
    );
  }

  async _withTimeout(
    operation,
    timeoutMs,
  ) {
    if (
      !Number.isFinite(
        timeoutMs,
      ) ||
      timeoutMs <= 0
    ) {
      return operation();
    }

    let timer = null;

    const timeoutPromise =
      new Promise(
        (_resolve, reject) => {
          timer =
            setTimeout(
              () => {
                const error =
                  new Error(
                    'Settlement provider query timed out.',
                  );

                error.code =
                  'ETIMEDOUT';

                reject(
                  error,
                );
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

  /* ==========================================================================
   * Configuration / Diagnostics
   * ======================================================================== */

  getStates() {
    return Object.freeze({
      ...SETTLEMENT_STATES,
    });
  }

  getTransitions() {
    return Object.freeze({
      ...SETTLEMENT_TRANSITIONS,
    });
  }

  getOutcomes() {
    return Object.freeze({
      ...SETTLEMENT_OUTCOMES,
    });
  }

  getConfiguration() {
    return Object.freeze({
      strictMode:
        this.options.strictMode,

      requireTenant:
        this.options.requireTenant,

      requireSuccessfulPayment:
        this.options.requireSuccessfulPayment,

      requireFinancialTransaction:
        this.options
          .requireFinancialTransaction,

      requirePostedFinancialTransaction:
        this.options
          .requirePostedFinancialTransaction,

      requireProvider:
        this.options.requireProvider,

      requireProviderTransactionReference:
        this.options
          .requireProviderTransactionReference,

      requireIdempotency:
        this.options.requireIdempotency,

      allowAsynchronousSettlement:
        this.options
          .allowAsynchronousSettlement,

      createPendingSettlement:
        this.options
          .createPendingSettlement,

      allowProviderQuery:
        this.options.allowProviderQuery,

      requireExactAmountMatch:
        this.options.requireExactAmountMatch,

      requireExactCurrencyMatch:
        this.options.requireExactCurrencyMatch,

      preventSettledDowngrade:
        this.options.preventSettledDowngrade,

      publishEvents:
        this.options.publishEvents,

      enableReconciliation:
        this.options.enableReconciliation,

      hasSettlementRepository:
        Boolean(
          this.settlementRepository,
        ),

      hasPaymentRepository:
        Boolean(
          this.paymentRepository,
        ),

      hasFinancialService:
        Boolean(
          this.financialService,
        ),

      hasProviderSettlementService:
        Boolean(
          this.providerSettlementService,
        ),

      hasReconciliationService:
        Boolean(
          this.reconciliationService,
        ),

      hasEventPublisher:
        Boolean(
          this.paymentEventPublisher,
        ),

      hasIdempotencyService:
        Boolean(
          this.paymentIdempotencyService,
        ),
    });
  }

  validateConfiguration() {
    const errors = [];

    if (
      this.options.strictMode &&
      !this.settlementRepository
    ) {
      errors.push(
        'Settlement repository is required in strict mode.',
      );
    }

    if (
      this.options.strictMode &&
      !this.paymentRepository
    ) {
      errors.push(
        'Payment repository is required in strict mode.',
      );
    }

    if (
      this.options.strictMode &&
      !this.paymentIdempotencyService
    ) {
      errors.push(
        'Payment idempotency service is required in strict mode.',
      );
    }

    if (
      this.options.publishEvents &&
      this.options.failOnEventPublicationError &&
      !this.paymentEventPublisher
    ) {
      errors.push(
        'Payment event publisher is required when settlement event publication is mandatory.',
      );
    }

    if (
      this.options.enableReconciliation &&
      this.options.strictMode &&
      !this.reconciliationService
    ) {
      errors.push(
        'Reconciliation service is required for settlement exceptions in strict mode.',
      );
    }

    if (
      this.options.requirePostedFinancialTransaction &&
      this.options.strictMode &&
      !this.financialService
    ) {
      errors.push(
        'Financial service is required to verify posted financial transactions.',
      );
    }

    return {
      valid:
        errors.length === 0,

      errors,
    };
  }

  /* ==========================================================================
   * Metrics / Logging
   * ======================================================================== */

  _metric(
    name,
    value,
    labels = {},
  ) {
    try {
      if (
        !this.metrics
      ) {
        return;
      }

      if (
        typeof this.metrics.increment
          === 'function'
      ) {
        this.metrics.increment(
          name,
          value,
          labels,
        );

        return;
      }

      if (
        typeof this.metrics.inc
          === 'function'
      ) {
        this.metrics.inc(
          name,
          value,
          labels,
        );
      }
    } catch (_error) {
      // Metrics must never break settlement processing.
    }
  }

  _logError(
    message,
    error,
    metadata = {},
  ) {
    try {
      if (
        this.logger &&
        typeof this.logger.error ===
          'function'
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
      // Never mask settlement errors.
    }
  }
}

/* ============================================================================
 * Static API
 * ========================================================================== */

PaymentSettlementWorkflow.STATES =
  SETTLEMENT_STATES;

PaymentSettlementWorkflow.TRANSITIONS =
  SETTLEMENT_TRANSITIONS;

PaymentSettlementWorkflow.OUTCOMES =
  SETTLEMENT_OUTCOMES;

PaymentSettlementWorkflow.OPERATION_TYPES =
  SETTLEMENT_OPERATION_TYPES;

PaymentSettlementWorkflow.EVENT_TYPES =
  SETTLEMENT_EVENT_TYPES;

PaymentSettlementWorkflow.ERROR_CODES =
  SETTLEMENT_ERROR_CODES;

PaymentSettlementWorkflow.PaymentSettlementWorkflowError =
  PaymentSettlementWorkflowError;

/* ============================================================================
 * Factory
 * ========================================================================== */

function createPaymentSettlementWorkflow(
  dependencies = {},
) {
  return new PaymentSettlementWorkflow(
    dependencies,
  );
}

/* ============================================================================
 * Exports
 * ========================================================================== */

module.exports =
  PaymentSettlementWorkflow;

module.exports.PaymentSettlementWorkflow =
  PaymentSettlementWorkflow;

module.exports.PaymentSettlementWorkflowError =
  PaymentSettlementWorkflowError;

module.exports.createPaymentSettlementWorkflow =
  createPaymentSettlementWorkflow;

module.exports.SETTLEMENT_STATES =
  SETTLEMENT_STATES;

module.exports.SETTLEMENT_TRANSITIONS =
  SETTLEMENT_TRANSITIONS;

module.exports.SETTLEMENT_OUTCOMES =
  SETTLEMENT_OUTCOMES;

module.exports.SETTLEMENT_OPERATION_TYPES =
  SETTLEMENT_OPERATION_TYPES;

module.exports.SETTLEMENT_EVENT_TYPES =
  SETTLEMENT_EVENT_TYPES;

module.exports.SETTLEMENT_ERROR_CODES =
  SETTLEMENT_ERROR_CODES;

/* ============================================================================
 * End of File
 * ============================================================================
 */