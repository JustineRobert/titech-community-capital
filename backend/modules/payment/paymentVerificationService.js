'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Payment Verification Service
 * ============================================================================
 *
 * File:
 *   backend/modules/payment/paymentVerificationService.js
 *
 * Purpose:
 *   Provides a centralized, production-grade verification boundary for
 *   payment operations before a payment is considered sufficiently verified
 *   for downstream state progression and financial processing.
 *
 * Verification Responsibilities
 * ----------------------------------------------------------------------------
 * 1. Validate payment identity and tenant scope.
 * 2. Validate amount and currency.
 * 3. Validate payment/provider references.
 * 4. Validate provider result structure.
 * 5. Validate provider status against internal state.
 * 6. Detect provider-reference collisions.
 * 7. Detect amount/currency mismatches.
 * 8. Detect stale/out-of-order provider evidence.
 * 9. Validate callback/provider correlation.
 * 10. Validate financial transaction linkage where supplied.
 * 11. Support provider status verification.
 * 12. Support reconciliation when verification cannot safely complete.
 * 13. Preserve verification evidence without storing secrets.
 * 14. Produce deterministic verification results.
 * 15. Never mutate the ledger directly.
 *
 * Architectural Boundary
 * ----------------------------------------------------------------------------
 *
 *   Provider / Payment Evidence
 *             |
 *             v
 *   +--------------------------+
 *   | Payment Verification     |
 *   | Service                  |
 *   +------------+-------------+
 *                |
 *        +-------+-------+
 *        |               |
 *        v               v
 *    VERIFIED        EXCEPTION/
 *                     RECONCILE
 *        |
 *        v
 * PaymentStateMachine
 *        |
 *        v
 * PaymentProcessingService
 *        |
 *        v
 * Financial Posting Engine
 *        |
 *        v
 * Ledger
 *
 * This service is deliberately separate from:
 *
 *   - provider signature authentication
 *   - payment state mutation
 *   - financial ledger posting
 *   - settlement reconciliation
 *
 * Those concerns are complementary, not interchangeable.
 *
 * ============================================================================
 */

const crypto = require('crypto');

const PaymentStateMachine =
  require('./paymentStateMachine');

/* ============================================================================
 * Constants
 * ========================================================================== */

const VERIFICATION_STATUS = Object.freeze({
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
  PENDING: 'PENDING',
  UNKNOWN: 'UNKNOWN',
  REQUIRES_RECONCILIATION: 'REQUIRES_RECONCILIATION',
});

const VERIFICATION_OUTCOMES = Object.freeze({
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  PENDING: 'PENDING',
  CANCELLED: 'CANCELLED',
  REVERSED: 'REVERSED',
  UNKNOWN: 'UNKNOWN',
});

const VERIFICATION_ERROR_CODES = Object.freeze({
  INVALID_REQUEST:
    'PAYMENT_VERIFICATION_INVALID_REQUEST',

  PAYMENT_NOT_FOUND:
    'PAYMENT_VERIFICATION_PAYMENT_NOT_FOUND',

  TENANT_REQUIRED:
    'PAYMENT_VERIFICATION_TENANT_REQUIRED',

  TENANT_MISMATCH:
    'PAYMENT_VERIFICATION_TENANT_MISMATCH',

  PROVIDER_REQUIRED:
    'PAYMENT_VERIFICATION_PROVIDER_REQUIRED',

  PROVIDER_MISMATCH:
    'PAYMENT_VERIFICATION_PROVIDER_MISMATCH',

  PROVIDER_REFERENCE_REQUIRED:
    'PAYMENT_VERIFICATION_PROVIDER_REFERENCE_REQUIRED',

  PROVIDER_REFERENCE_MISMATCH:
    'PAYMENT_VERIFICATION_PROVIDER_REFERENCE_MISMATCH',

  PROVIDER_REFERENCE_CONFLICT:
    'PAYMENT_VERIFICATION_PROVIDER_REFERENCE_CONFLICT',

  AMOUNT_REQUIRED:
    'PAYMENT_VERIFICATION_AMOUNT_REQUIRED',

  AMOUNT_MISMATCH:
    'PAYMENT_VERIFICATION_AMOUNT_MISMATCH',

  INVALID_AMOUNT:
    'PAYMENT_VERIFICATION_INVALID_AMOUNT',

  CURRENCY_REQUIRED:
    'PAYMENT_VERIFICATION_CURRENCY_REQUIRED',

  CURRENCY_MISMATCH:
    'PAYMENT_VERIFICATION_CURRENCY_MISMATCH',

  INVALID_STATUS:
    'PAYMENT_VERIFICATION_INVALID_STATUS',

  INVALID_STATE_TRANSITION:
    'PAYMENT_VERIFICATION_INVALID_STATE_TRANSITION',

  OUT_OF_ORDER_RESULT:
    'PAYMENT_VERIFICATION_OUT_OF_ORDER_RESULT',

  DUPLICATE_RESULT:
    'PAYMENT_VERIFICATION_DUPLICATE_RESULT',

  UNKNOWN_RESULT:
    'PAYMENT_VERIFICATION_UNKNOWN_RESULT',

  SIGNATURE_REQUIRED:
    'PAYMENT_VERIFICATION_SIGNATURE_REQUIRED',

  SIGNATURE_INVALID:
    'PAYMENT_VERIFICATION_SIGNATURE_INVALID',

  TIMESTAMP_INVALID:
    'PAYMENT_VERIFICATION_TIMESTAMP_INVALID',

  TIMESTAMP_EXPIRED:
    'PAYMENT_VERIFICATION_TIMESTAMP_EXPIRED',

  EVENT_ID_REQUIRED:
    'PAYMENT_VERIFICATION_EVENT_ID_REQUIRED',

  FINANCIAL_LINK_REQUIRED:
    'PAYMENT_VERIFICATION_FINANCIAL_LINK_REQUIRED',

  FINANCIAL_LINK_MISMATCH:
    'PAYMENT_VERIFICATION_FINANCIAL_LINK_MISMATCH',

  RECONCILIATION_REQUIRED:
    'PAYMENT_VERIFICATION_RECONCILIATION_REQUIRED',

  STORAGE_UNAVAILABLE:
    'PAYMENT_VERIFICATION_STORAGE_UNAVAILABLE',

  PROVIDER_QUERY_UNAVAILABLE:
    'PAYMENT_VERIFICATION_PROVIDER_QUERY_UNAVAILABLE',
});

const DEFAULT_OPTIONS = Object.freeze({
  strictMode: true,

  requireTenant:
    true,

  requireProviderForProviderEvidence:
    true,

  requireProviderReferenceForSuccess:
    false,

  requireEventIdForCallback:
    false,

  allowUnknownProviderStatus:
    true,

  preventSuccessfulDowngrade:
    true,

  preventReversedDowngrade:
    true,

  allowSameStatusVerification:
    true,

  verifyProviderStatusWhenAvailable:
    true,

  providerStatusTimeoutMs:
    15000,

  defaultTimestampToleranceMs:
    5 * 60 * 1000,

  allowFutureTimestampSkewMs:
    60 * 1000,

  /**
   * A payment amount must be exactly equivalent after canonical decimal
   * normalization. No JavaScript floating-point arithmetic is used.
   */
  requireExactAmountMatch:
    true,

  requireExactCurrencyMatch:
    true,

  /**
   * Verification is evidence gathering. It does not post the ledger.
   */
  verifyFinancialLink:
    true,

  /**
   * Store only safe verification evidence.
   */
  retainEvidence:
    true,

  /**
   * Never retain raw provider secrets/signatures unless an injected evidence
   * service explicitly manages secure retention.
   */
  retainSensitiveEvidence:
    false,
});

/* ============================================================================
 * Error Class
 * ========================================================================== */

class PaymentVerificationError extends Error {
  constructor(message, options = {}) {
    super(message);

    this.name =
      'PaymentVerificationError';

    this.code =
      options.code
      || VERIFICATION_ERROR_CODES
        .INVALID_REQUEST;

    this.statusCode =
      Number.isInteger(
        options.statusCode,
      )
        ? options.statusCode
        : 409;

    this.paymentId =
      options.paymentId || null;

    this.tenantId =
      options.tenantId || null;

    this.provider =
      options.provider || null;

    this.providerTransactionId =
      options.providerTransactionId || null;

    this.retryable =
      options.retryable === true;

    this.reconciliationRequired =
      options.reconciliationRequired === true;

    this.details =
      options.details || {};

    if (options.cause) {
      this.cause =
        options.cause;
    }

    Error.captureStackTrace?.(
      this,
      PaymentVerificationError,
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
    normalizeString(
      value,
    );

  return provider
    ? provider.toLowerCase()
    : null;
}

function normalizeStatus(value) {
  const status =
    normalizeString(
      value,
    );

  return status
    ? status.toUpperCase()
    : null;
}

function canonicalCurrency(value) {
  const currency =
    normalizeString(
      value,
    );

  return currency
    ? currency.toUpperCase()
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
    && typeof value.toString
      === 'function'
  ) {
    return value.toString();
  }

  return null;
}

function canonicalAmount(value) {
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

function clone(value) {
  if (
    value === undefined
    || value === null
  ) {
    return value;
  }

  if (
    typeof structuredClone
      === 'function'
  ) {
    try {
      return structuredClone(
        value,
      );
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
    value === null
    || value === undefined
  ) {
    return String(value);
  }

  if (
    typeof value !== 'object'
  ) {
    return JSON.stringify(
      value,
    );
  }

  if (
    Array.isArray(value)
  ) {
    return `[${value
      .map(stableStringify)
      .join(',')}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify(
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
        : stableStringify(
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

function parseDate(value) {
  if (!value) {
    return null;
  }

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  return Number.isNaN(
    date.getTime(),
  )
    ? null
    : date;
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

function normalizeContext(
  rawContext = {},
) {
  return {
    tenantId:
      normalizeString(
        rawContext.tenantId,
      ),

    actorId:
      normalizeString(
        rawContext.actorId,
      ),

    actorType:
      normalizeString(
        rawContext.actorType,
      )
      || 'SYSTEM',

    actorRole:
      normalizeString(
        rawContext.actorRole,
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

    idempotencyKey:
      normalizeString(
        rawContext.idempotencyKey,
      ),

    fromCallback:
      rawContext.fromCallback
      === true,

    signatureVerified:
      rawContext.signatureVerified
      === true,

    timestampVerified:
      rawContext.timestampVerified
      === true,

    expectedVersion:
      rawContext.expectedVersion,

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

/* ============================================================================
 * Payment Verification Service
 * ========================================================================== */

class PaymentVerificationService {
  /**
   * @param {Object} dependencies
   *
   * Recommended dependencies:
   *
   * paymentRepository
   * paymentStateMachine
   * providerRegistry
   * reconciliationService
   * evidenceRepository
   * auditService
   * metrics
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
          dependencies
            .paymentStateMachineOptions
          || {},
      });

    this.providerRegistry =
      dependencies.providerRegistry
      || dependencies
        .paymentProviderRegistry
      || null;

    this.reconciliationService =
      dependencies.reconciliationService
      || null;

    this.evidenceRepository =
      dependencies.evidenceRepository
      || dependencies
        .verificationEvidenceRepository
      || null;

    this.auditService =
      dependencies.auditService
      || null;

    this.metrics =
      dependencies.metrics
      || null;

    this.logger =
      dependencies.logger
      || console;

    this.customValidator =
      typeof dependencies
        .customValidator
        === 'function'
        ? dependencies.customValidator
        : null;

    this.options = Object.freeze({
      ...DEFAULT_OPTIONS,
      ...(dependencies.options || {}),
    });
  }

  /* ==========================================================================
   * Public Verification Entry Points
   * ======================================================================== */

  /**
   * Verify an internal payment against externally supplied evidence.
   *
   * This is the primary method used by PaymentProcessingService and
   * authenticated callback processors.
   */
  async verify(
    paymentOrId,
    evidence = {},
    rawContext = {},
  ) {
    const context =
      normalizeContext(
        rawContext,
      );

    const payment =
      await this._loadPayment(
        paymentOrId,
        context,
      );

    const normalizedPayment =
      this._normalizePayment(
        payment,
      );

    const normalizedEvidence =
      this._normalizeEvidence(
        evidence,
        normalizedPayment,
      );

    await this._validateContext(
      normalizedPayment,
      normalizedEvidence,
      context,
    );

    const checks = [];

    checks.push(
      await this._checkPaymentIdentity(
        normalizedPayment,
        normalizedEvidence,
        context,
      ),
    );

    checks.push(
      await this._checkAmount(
        normalizedPayment,
        normalizedEvidence,
        context,
      ),
    );

    checks.push(
      await this._checkCurrency(
        normalizedPayment,
        normalizedEvidence,
        context,
      ),
    );

    checks.push(
      await this._checkProvider(
        normalizedPayment,
        normalizedEvidence,
        context,
      ),
    );

    checks.push(
      await this._checkProviderReference(
        normalizedPayment,
        normalizedEvidence,
        context,
      ),
    );

    checks.push(
      await this._checkProviderStatus(
        normalizedPayment,
        normalizedEvidence,
        context,
      ),
    );

    checks.push(
      await this._checkStateCompatibility(
        normalizedPayment,
        normalizedEvidence,
        context,
      ),
    );

    if (
      this.options.verifyFinancialLink
    ) {
      checks.push(
        await this._checkFinancialLink(
          normalizedPayment,
          normalizedEvidence,
          context,
        ),
      );
    }

    if (
      this.customValidator
    ) {
      checks.push(
        await this._runCustomValidation(
          normalizedPayment,
          normalizedEvidence,
          context,
        ),
      );
    }

    const result =
      this._buildVerificationResult(
        normalizedPayment,
        normalizedEvidence,
        checks,
        context,
      );

    await this._persistEvidence(
      normalizedPayment,
      normalizedEvidence,
      result,
      context,
    );

    await this._recordAudit(
      normalizedPayment,
      normalizedEvidence,
      result,
      context,
    );

    this._recordMetrics(
      normalizedPayment,
      result,
    );

    return result;
  }

  /**
   * Verify a provider callback after the callback security subsystem has
   * authenticated the provider signature.
   *
   * IMPORTANT:
   * Signature verification itself should occur in
   * PAYMENT_CALLBACK_SECURITY / provider adapter code.
   */
  async verifyCallback(
    paymentOrId,
    callbackPayload = {},
    rawContext = {},
  ) {
    const context =
      normalizeContext({
        ...rawContext,

        fromCallback:
          true,
      });

    if (
      !context.signatureVerified
      && this.options.strictMode
    ) {
      throw new PaymentVerificationError(
        'Authenticated provider callback evidence is required before callback verification.',
        {
          code:
            VERIFICATION_ERROR_CODES
              .SIGNATURE_REQUIRED,
          statusCode: 401,
          paymentId:
            safeId(
              paymentOrId,
            ),
          tenantId:
            context.tenantId,
        },
      );
    }

    return this.verify(
      paymentOrId,
      {
        ...callbackPayload,

        source:
          'PROVIDER_CALLBACK',
      },
      context,
    );
  }

  /**
   * Query the provider for authoritative status and verify the response
   * against the internal payment.
   */
  async verifyWithProvider(
    paymentOrId,
    rawContext = {},
  ) {
    const context =
      normalizeContext(
        rawContext,
      );

    const payment =
      await this._loadPayment(
        paymentOrId,
        context,
      );

    const normalizedPayment =
      this._normalizePayment(
        payment,
      );

    await this._validateProviderQueryContext(
      normalizedPayment,
      context,
    );

    const provider =
      await this._resolveProvider(
        normalizedPayment,
        context,
      );

    const providerResult =
      await this._queryProviderStatus(
        provider,
        normalizedPayment,
        context,
      );

    return this.verify(
      normalizedPayment,
      providerResult,
      {
        ...context,

        provider:
          providerResult.provider
          || context.provider
          || normalizedPayment.provider,

        providerTransactionId:
          providerResult.providerTransactionId
          || context.providerTransactionId,

        providerEventId:
          providerResult.providerEventId
          || context.providerEventId,

        signatureVerified:
          context.signatureVerified,

        timestampVerified:
          context.timestampVerified,
      },
    );
  }

  /**
   * Lightweight verification for pre-posting checks.
   *
   * Does not persist evidence by default unless explicitly requested.
   */
  async verifyForPosting(
    paymentOrId,
    evidence = {},
    rawContext = {},
  ) {
    const context =
      normalizeContext(
        rawContext,
      );

    const result =
      await this.verify(
        paymentOrId,
        evidence,
        context,
      );

    if (
      result.status
      !== VERIFICATION_STATUS.VERIFIED
    ) {
      throw new PaymentVerificationError(
        'Payment has not passed all verification checks required for financial posting.',
        {
          code:
            VERIFICATION_ERROR_CODES
              .RECONCILIATION_REQUIRED,
          statusCode: 409,
          paymentId:
            result.paymentId,
          tenantId:
            result.tenantId,
          reconciliationRequired:
            true,
          details: {
            status:
              result.status,

            failedChecks:
              result.failedChecks,
          },
        },
      );
    }

    return result;
  }

  /* ==========================================================================
   * Basic Checks
   * ======================================================================== */

  async _checkPaymentIdentity(
    payment,
    evidence,
    context,
  ) {
    const passed =
      Boolean(
        payment.id,
      )
      && (
        !evidence.paymentId
        || payment.id
          === evidence.paymentId
      );

    if (!passed) {
      return this._failedCheck(
        'PAYMENT_IDENTITY',
        VERIFICATION_ERROR_CODES
          .PAYMENT_NOT_FOUND,
        'Payment identity does not match verification evidence.',
      );
    }

    return this._passedCheck(
      'PAYMENT_IDENTITY',
    );
  }

  async _checkAmount(
    payment,
    evidence,
    context,
  ) {
    const internal =
      canonicalAmount(
        payment.amount,
      );

    const external =
      canonicalAmount(
        evidence.amount,
      );

    if (!internal) {
      return this._failedCheck(
        'AMOUNT',
        VERIFICATION_ERROR_CODES
          .AMOUNT_REQUIRED,
        'Internal payment amount is missing or invalid.',
      );
    }

    /**
     * Some provider status endpoints omit amount. In that case, retain the
     * internal amount as the expected amount and do not manufacture a mismatch.
     */
    if (!external) {
      return this._passedCheck(
        'AMOUNT',
        {
          evidenceAmountProvided:
            false,

          verifiedAgainstInternal:
            false,
        },
      );
    }

    if (
      this.options.requireExactAmountMatch
      && internal !== external
    ) {
      return this._failedCheck(
        'AMOUNT',
        VERIFICATION_ERROR_CODES
          .AMOUNT_MISMATCH,
        'External payment amount does not match the internal payment amount.',
        {
          expectedAmount:
            internal,

          receivedAmount:
            external,
        },
      );
    }

    return this._passedCheck(
      'AMOUNT',
      {
        evidenceAmountProvided:
          true,

        verifiedAgainstInternal:
          true,
      },
    );
  }

  async _checkCurrency(
    payment,
    evidence,
    context,
  ) {
    const internal =
      canonicalCurrency(
        payment.currency,
      );

    const external =
      canonicalCurrency(
        evidence.currency,
      );

    if (!internal) {
      return this._failedCheck(
        'CURRENCY',
        VERIFICATION_ERROR_CODES
          .CURRENCY_REQUIRED,
        'Internal payment currency is missing.',
      );
    }

    /**
     * Provider status responses may omit currency if it is fixed at account/
     * transaction level.
     */
    if (!external) {
      return this._passedCheck(
        'CURRENCY',
        {
          evidenceCurrencyProvided:
            false,

          verifiedAgainstInternal:
            false,
        },
      );
    }

    if (
      this.options.requireExactCurrencyMatch
      && internal !== external
    ) {
      return this._failedCheck(
        'CURRENCY',
        VERIFICATION_ERROR_CODES
          .CURRENCY_MISMATCH,
        'External payment currency does not match the internal payment currency.',
        {
          expectedCurrency:
            internal,

          receivedCurrency:
            external,
        },
      );
    }

    return this._passedCheck(
      'CURRENCY',
      {
        evidenceCurrencyProvided:
          true,

        verifiedAgainstInternal:
          true,
      },
    );
  }

  async _checkProvider(
    payment,
    evidence,
    context,
  ) {
    const expected =
      normalizeProvider(
        payment.provider,
      );

    const received =
      normalizeProvider(
        evidence.provider
        || context.provider,
      );

    if (
      this.options.requireProviderForProviderEvidence
      && evidence.source !== 'INTERNAL'
      && !received
      && this.options.strictMode
    ) {
      return this._failedCheck(
        'PROVIDER',
        VERIFICATION_ERROR_CODES
          .PROVIDER_REQUIRED,
        'Provider identity is required for external payment evidence.',
      );
    }

    if (
      expected
      && received
      && expected !== received
    ) {
      return this._failedCheck(
        'PROVIDER',
        VERIFICATION_ERROR_CODES
          .PROVIDER_MISMATCH,
        'Provider identity does not match the payment provider.',
        {
          expectedProvider:
            expected,

          receivedProvider:
            received,
        },
      );
    }

    return this._passedCheck(
      'PROVIDER',
      {
        expectedProvider:
          expected,

        receivedProvider:
          received,
      },
    );
  }

  async _checkProviderReference(
    payment,
    evidence,
    context,
  ) {
    const internal =
      normalizeString(
        payment.providerTransactionId,
      );

    const external =
      normalizeString(
        evidence.providerTransactionId
        || context.providerTransactionId,
      );

    if (
      !external
    ) {
      if (
        evidence.outcome
        === VERIFICATION_OUTCOMES.SUCCESS
        && this.options
          .requireProviderReferenceForSuccess
      ) {
        return this._failedCheck(
          'PROVIDER_REFERENCE',
          VERIFICATION_ERROR_CODES
            .PROVIDER_REFERENCE_REQUIRED,
          'A provider transaction reference is required for successful payment verification.',
        );
      }

      return this._passedCheck(
        'PROVIDER_REFERENCE',
        {
          providerReferenceProvided:
            false,
        },
      );
    }

    if (
      internal
      && internal !== external
    ) {
      return this._failedCheck(
        'PROVIDER_REFERENCE',
        VERIFICATION_ERROR_CODES
          .PROVIDER_REFERENCE_MISMATCH,
        'Provider transaction reference does not match the payment.',
        {
          expectedReference:
            internal,

          receivedReference:
            external,
        },
      );
    }

    /**
     * Detect a provider transaction reference that is already linked to a
     * different payment.
     */
    if (
      this.paymentRepository
      && typeof this.paymentRepository
        .findByProviderReference
        === 'function'
    ) {
      const existing =
        await this.paymentRepository
          .findByProviderReference({
            provider:
              normalizeProvider(
                payment.provider
                || evidence.provider,
              ),

            providerTransactionId:
              external,

            tenantId:
              context.tenantId,
          });

      if (existing) {
        const existingId =
          safeId(
            existing.id
            || existing._id,
          );

        if (
          existingId
          && existingId
            !== payment.id
        ) {
          return this._failedCheck(
            'PROVIDER_REFERENCE',
            VERIFICATION_ERROR_CODES
              .PROVIDER_REFERENCE_CONFLICT,
            'Provider transaction reference is already associated with another payment.',
            {
              existingPaymentId:
                existingId,
            },
          );
        }
      }
    }

    return this._passedCheck(
      'PROVIDER_REFERENCE',
      {
        providerReferenceProvided:
          true,

        matchesExistingPayment:
          Boolean(
            internal
            && internal === external,
          ),
      },
    );
  }

  async _checkProviderStatus(
    payment,
    evidence,
    context,
  ) {
    const outcome =
      this._normalizeOutcome(
        evidence.outcome
        || evidence.status
        || evidence.providerStatus,
      );

    if (!outcome) {
      if (
        this.options
          .allowUnknownProviderStatus
      ) {
        return this._pendingCheck(
          'PROVIDER_STATUS',
          VERIFICATION_ERROR_CODES
            .UNKNOWN_RESULT,
          'Provider status could not be mapped to a known payment outcome.',
        );
      }

      return this._failedCheck(
        'PROVIDER_STATUS',
        VERIFICATION_ERROR_CODES
          .INVALID_STATUS,
        'Provider returned an unsupported payment status.',
      );
    }

    if (
      [
        VERIFICATION_OUTCOMES
          .SUCCESS,
        VERIFICATION_OUTCOMES
          .FAILED,
        VERIFICATION_OUTCOMES
          .PENDING,
        VERIFICATION_OUTCOMES
          .CANCELLED,
        VERIFICATION_OUTCOMES
          .REVERSED,
        VERIFICATION_OUTCOMES
          .UNKNOWN,
      ].includes(
        outcome,
      )
    ) {
      return this._passedCheck(
        'PROVIDER_STATUS',
        {
          outcome,
        },
      );
    }

    return this._failedCheck(
      'PROVIDER_STATUS',
      VERIFICATION_ERROR_CODES
        .INVALID_STATUS,
      'Unsupported payment verification outcome.',
    );
  }

  async _checkStateCompatibility(
    payment,
    evidence,
    context,
  ) {
    const currentState =
      normalizeStatus(
        payment.status,
      );

    const outcome =
      this._normalizeOutcome(
        evidence.outcome
        || evidence.status
        || evidence.providerStatus,
      );

    if (!currentState) {
      return this._failedCheck(
        'STATE_COMPATIBILITY',
        VERIFICATION_ERROR_CODES
          .INVALID_STATUS,
        'Payment has no valid internal state.',
      );
    }

    if (!outcome) {
      return this._pendingCheck(
        'STATE_COMPATIBILITY',
        VERIFICATION_ERROR_CODES
          .UNKNOWN_RESULT,
        'State compatibility cannot be determined from an unknown provider result.',
      );
    }

    /**
     * SUCCESSFUL and REVERSED are authoritative final states and must not be
     * silently downgraded.
     */
    if (
      this.options.preventSuccessfulDowngrade
      && currentState
        === PaymentStateMachine
          .STATES
          .SUCCESSFUL
      && [
        VERIFICATION_OUTCOMES
          .PENDING,
        VERIFICATION_OUTCOMES
          .FAILED,
        VERIFICATION_OUTCOMES
          .CANCELLED,
      ].includes(
        outcome,
      )
    ) {
      return this._failedCheck(
        'STATE_COMPATIBILITY',
        VERIFICATION_ERROR_CODES
          .OUT_OF_ORDER_RESULT,
        'A terminal successful payment cannot be downgraded by later provider evidence.',
      );
    }

    if (
      this.options.preventReversedDowngrade
      && currentState
        === PaymentStateMachine
          .STATES
          .REVERSED
      && outcome
        !== VERIFICATION_OUTCOMES
          .REVERSED
    ) {
      return this._failedCheck(
        'STATE_COMPATIBILITY',
        VERIFICATION_ERROR_CODES
          .OUT_OF_ORDER_RESULT,
        'A reversed payment cannot be downgraded by later provider evidence.',
      );
    }

    /**
     * Same-state evidence is valid and common for duplicate polling/callbacks.
     */
    if (
      this._isStateAlreadyEquivalent(
        currentState,
        outcome,
      )
    ) {
      if (
        this.options.allowSameStatusVerification
      ) {
        return this._passedCheck(
          'STATE_COMPATIBILITY',
          {
            sameState:
              true,
          },
        );
      }
    }

    const targetState =
      this._mapOutcomeToPaymentState(
        outcome,
      );

    if (
      targetState
      && this.paymentStateMachine
    ) {
      const canTransition =
        this.paymentStateMachine.canTransition(
          currentState,
          targetState,
        );

      if (!canTransition) {
        /**
         * Unknown/reconciliation transitions are intentionally not treated
         * as ordinary state failures.
         */
        if (
          [
            VERIFICATION_OUTCOMES
              .UNKNOWN,
          ].includes(
            outcome,
          )
        ) {
          return this._pendingCheck(
            'STATE_COMPATIBILITY',
            VERIFICATION_ERROR_CODES
              .UNKNOWN_RESULT,
            'Payment outcome is unresolved and requires reconciliation.',
          );
        }

        return this._failedCheck(
          'STATE_COMPATIBILITY',
          VERIFICATION_ERROR_CODES
            .INVALID_STATE_TRANSITION,
          'Provider outcome cannot be applied to the current payment state.',
          {
            currentState,
            targetState,
          },
        );
      }
    }

    return this._passedCheck(
      'STATE_COMPATIBILITY',
      {
        currentState,
        outcome,
        targetState,
      },
    );
  }

  async _checkFinancialLink(
    payment,
    evidence,
    context,
  ) {
    const financialTransactionId =
      normalizeString(
        payment.financialTransactionId
        || evidence.financialTransactionId,
      );

    /**
     * Not every payment must have a posted financial transaction yet.
     * Verification establishes consistency when linkage exists.
     */
    if (!financialTransactionId) {
      return this._passedCheck(
        'FINANCIAL_LINK',
        {
          linked:
            false,
        },
      );
    }

    if (
      !this.paymentRepository
      || typeof this.paymentRepository
        .getFinancialTransaction
        !== 'function'
    ) {
      return this._passedCheck(
        'FINANCIAL_LINK',
        {
          linked:
            true,

          verified:
            false,
        },
      );
    }

    const financial =
      await this.paymentRepository
        .getFinancialTransaction(
          financialTransactionId,
          {
            tenantId:
              context.tenantId,
          },
        );

    if (!financial) {
      return this._failedCheck(
        'FINANCIAL_LINK',
        VERIFICATION_ERROR_CODES
          .FINANCIAL_LINK_MISMATCH,
        'Referenced financial transaction could not be found.',
        {
          financialTransactionId,
        },
      );
    }

    const financialPaymentId =
      safeId(
        financial.paymentId
        || financial.sourceId,
      );

    if (
      financialPaymentId
      && financialPaymentId
        !== payment.id
    ) {
      return this._failedCheck(
        'FINANCIAL_LINK',
        VERIFICATION_ERROR_CODES
          .FINANCIAL_LINK_MISMATCH,
        'Financial transaction is linked to a different payment.',
        {
          financialTransactionId,
          linkedPaymentId:
            financialPaymentId,
        },
      );
    }

    if (
      payment.amount
      && financial.amount
      && canonicalAmount(
        payment.amount,
      )
      !== canonicalAmount(
        financial.amount,
      )
    ) {
      return this._failedCheck(
        'FINANCIAL_LINK',
        VERIFICATION_ERROR_CODES
          .AMOUNT_MISMATCH,
        'Financial transaction amount does not match payment amount.',
        {
          paymentAmount:
            canonicalAmount(
              payment.amount,
            ),

          financialAmount:
            canonicalAmount(
              financial.amount,
            ),
        },
      );
    }

    if (
      payment.currency
      && financial.currency
      && canonicalCurrency(
        payment.currency,
      )
      !== canonicalCurrency(
        financial.currency,
      )
    ) {
      return this._failedCheck(
        'FINANCIAL_LINK',
        VERIFICATION_ERROR_CODES
          .CURRENCY_MISMATCH,
        'Financial transaction currency does not match payment currency.',
        {
          paymentCurrency:
            canonicalCurrency(
              payment.currency,
            ),

          financialCurrency:
            canonicalCurrency(
              financial.currency,
            ),
        },
      );
    }

    return this._passedCheck(
      'FINANCIAL_LINK',
      {
        linked:
          true,

        verified:
          true,

        financialTransactionId,
      },
    );
  }

  async _runCustomValidation(
    payment,
    evidence,
    context,
  ) {
    try {
      const result =
        await this.customValidator({
          payment:
            clone(payment),

          evidence:
            clone(
              evidence,
            ),

          context:
            clone(
              context,
            ),
        });

      if (result === false) {
        return this._failedCheck(
          'CUSTOM',
          VERIFICATION_ERROR_CODES
            .INVALID_REQUEST,
          'Custom payment verification failed.',
        );
      }

      if (
        result
        && typeof result === 'object'
      ) {
        if (
          result.status === 'PENDING'
        ) {
          return this._pendingCheck(
            'CUSTOM',
            result.code
            || VERIFICATION_ERROR_CODES
              .UNKNOWN_RESULT,
            result.message
            || 'Custom payment verification is pending.',
            result.details,
          );
        }

        if (
          result.valid === false
        ) {
          return this._failedCheck(
            'CUSTOM',
            result.code
            || VERIFICATION_ERROR_CODES
              .INVALID_REQUEST,
            result.message
            || 'Custom payment verification failed.',
            result.details,
          );
        }

        return this._passedCheck(
          'CUSTOM',
          result.details,
        );
      }

      return this._passedCheck(
        'CUSTOM',
      );
    } catch (error) {
      throw new PaymentVerificationError(
        'Custom payment verification failed unexpectedly.',
        {
          code:
            VERIFICATION_ERROR_CODES
              .STORAGE_UNAVAILABLE,
          statusCode: 500,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
          cause:
            error,
        },
      );
    }
  }

  /* ==========================================================================
   * Provider Status Verification
   * ======================================================================== */

  async _validateProviderQueryContext(
    payment,
    context,
  ) {
    if (
      this.options.requireTenant
      && !context.tenantId
    ) {
      throw new PaymentVerificationError(
        'Tenant context is required for provider verification.',
        {
          code:
            VERIFICATION_ERROR_CODES
              .TENANT_REQUIRED,
          statusCode: 403,
          paymentId:
            payment.id,
        },
      );
    }

    if (
      payment.tenantId
      && context.tenantId
      && payment.tenantId
        !== context.tenantId
    ) {
      throw new PaymentVerificationError(
        'Payment does not belong to the current tenant.',
        {
          code:
            VERIFICATION_ERROR_CODES
              .TENANT_MISMATCH,
          statusCode: 403,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
        },
      );
    }

    if (
      !payment.provider
    ) {
      throw new PaymentVerificationError(
        'Payment provider is required for provider verification.',
        {
          code:
            VERIFICATION_ERROR_CODES
              .PROVIDER_REQUIRED,
          statusCode: 400,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
        },
      );
    }

    if (
      !payment.providerTransactionId
      && !context.providerTransactionId
    ) {
      throw new PaymentVerificationError(
        'Provider transaction reference is required for provider status verification.',
        {
          code:
            VERIFICATION_ERROR_CODES
              .PROVIDER_REFERENCE_REQUIRED,
          statusCode: 400,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
        },
      );
    }
  }

  async _resolveProvider(
    payment,
    context,
  ) {
    if (
      !this.providerRegistry
    ) {
      throw new PaymentVerificationError(
        'Payment provider registry is not configured.',
        {
          code:
            VERIFICATION_ERROR_CODES
              .PROVIDER_QUERY_UNAVAILABLE,
          statusCode: 503,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
        },
      );
    }

    const providerName =
      normalizeProvider(
        payment.provider
        || context.provider,
      );

    if (!providerName) {
      throw new PaymentVerificationError(
        'Payment provider is required.',
        {
          code:
            VERIFICATION_ERROR_CODES
              .PROVIDER_REQUIRED,
          statusCode: 400,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
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
      throw new PaymentVerificationError(
        'Payment provider could not be resolved.',
        {
          code:
            VERIFICATION_ERROR_CODES
              .PROVIDER_QUERY_UNAVAILABLE,
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

  async _queryProviderStatus(
    provider,
    payment,
    context,
  ) {
    const providerTransactionId =
      context.providerTransactionId
      || payment.providerTransactionId;

    if (
      typeof provider
        .getPaymentStatus
        !== 'function'
      && typeof provider
        .getTransactionStatus
        !== 'function'
      && typeof provider
        .queryPayment
        !== 'function'
    ) {
      throw new PaymentVerificationError(
        'The configured provider does not support payment status verification.',
        {
          code:
            VERIFICATION_ERROR_CODES
              .PROVIDER_QUERY_UNAVAILABLE,
          statusCode: 503,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
          provider:
            payment.provider,
        },
      );
    }

    const request = {
      paymentId:
        payment.id,

      paymentReference:
        payment.paymentReference
        || payment.reference
        || null,

      providerTransactionId,

      amount:
        canonicalAmount(
          payment.amount,
        ),

      currency:
        canonicalCurrency(
          payment.currency,
        ),
    };

    try {
      const operation =
        () => {
          if (
            typeof provider
              .getPaymentStatus
              === 'function'
          ) {
            return provider.getPaymentStatus(
              request,
              context,
            );
          }

          if (
            typeof provider
              .getTransactionStatus
              === 'function'
          ) {
            return provider.getTransactionStatus(
              request,
              context,
            );
          }

          return provider.queryPayment(
            request,
            context,
          );
        };

      const result =
        await this._withTimeout(
          operation,
          this.options
            .providerStatusTimeoutMs,
        );

      return this._normalizeEvidence(
        {
          ...(toPlainObject(
            result,
          ) || {}),

          source:
            'PROVIDER_STATUS_QUERY',
        },
        payment,
      );
    } catch (error) {
      throw new PaymentVerificationError(
        'Provider payment status verification failed.',
        {
          code:
            VERIFICATION_ERROR_CODES
              .PROVIDER_QUERY_UNAVAILABLE,
          statusCode:
            Number(
              error?.statusCode,
            ) || 503,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
          provider:
            payment.provider,
          retryable:
            true,
          cause:
            error,
        },
      );
    }
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
                    'Payment provider verification timed out.',
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
   * Evidence Normalization
   * ======================================================================== */

  _normalizeEvidence(
    rawEvidence,
    payment,
  ) {
    const evidence =
      toPlainObject(
        rawEvidence,
      )
      || {};

    const provider =
      normalizeProvider(
        evidence.provider
        || evidence.paymentProvider
        || payment.provider,
      );

    const status =
      normalizeStatus(
        evidence.status
        || evidence.providerStatus
        || evidence.outcome,
      );

    return {
      source:
        normalizeString(
          evidence.source,
        )
        || 'INTERNAL',

      paymentId:
        safeId(
          evidence.paymentId,
        ),

      provider,

      providerTransactionId:
        normalizeString(
          evidence.providerTransactionId
          || evidence.providerReference
          || evidence.transactionReference
          || evidence.externalTransactionId,
        ),

      providerEventId:
        normalizeString(
          evidence.providerEventId
          || evidence.eventId,
        ),

      paymentReference:
        normalizeString(
          evidence.paymentReference
          || evidence.reference,
        ),

      amount:
        canonicalAmount(
          evidence.amount,
        ),

      currency:
        canonicalCurrency(
          evidence.currency,
        ),

      status,

      providerStatus:
        status,

      outcome:
        this._normalizeOutcome(
          status,
        ),

      confirmed:
        evidence.confirmed === true,

      failed:
        evidence.failed === true,

      timestamp:
        parseDate(
          evidence.timestamp
          || evidence.occurredAt
          || evidence.eventTimestamp,
        ),

      receivedAt:
        parseDate(
          evidence.receivedAt,
        )
        || now(),

      signatureVerified:
        evidence.signatureVerified
        === true,

      timestampVerified:
        evidence.timestampVerified
        === true,

      callbackAuthenticated:
        evidence.callbackAuthenticated
        === true,

      financialTransactionId:
        normalizeString(
          evidence.financialTransactionId,
        ),

      financialStatus:
        normalizeStatus(
          evidence.financialStatus,
        ),

      reasonCode:
        normalizeString(
          evidence.reasonCode,
        ),

      reason:
        normalizeString(
          evidence.reason
          || evidence.message,
        ),

      metadata:
        this._sanitizeMetadata(
          evidence.metadata,
        ),
    };
  }

  _normalizePayment(
    payment,
  ) {
    if (
      !payment
      || typeof payment !== 'object'
    ) {
      throw new PaymentVerificationError(
        'Invalid payment object.',
        {
          code:
            VERIFICATION_ERROR_CODES
              .INVALID_REQUEST,
          statusCode: 400,
        },
      );
    }

    const plain =
      toPlainObject(
        payment,
      );

    const id =
      safeId(
        plain.id
        || plain._id,
      );

    if (!id) {
      throw new PaymentVerificationError(
        'Payment identifier is required.',
        {
          code:
            VERIFICATION_ERROR_CODES
              .PAYMENT_NOT_FOUND,
          statusCode: 400,
        },
      );
    }

    return {
      ...plain,

      id,

      tenantId:
        normalizeString(
          plain.tenantId,
        ),

      status:
        normalizeStatus(
          plain.status
          || plain.state,
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

      financialTransactionId:
        normalizeString(
          plain.financialTransactionId,
        ),

      version:
        Number(
          plain.version
          ?? plain.__v
          ?? 0,
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
      return null;
    }

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
      return VERIFICATION_OUTCOMES
        .SUCCESS;
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
      return VERIFICATION_OUTCOMES
        .FAILED;
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
      return VERIFICATION_OUTCOMES
        .PENDING;
    }

    if (
      [
        'CANCELLED',
        'CANCELED',
      ].includes(
        status,
      )
    ) {
      return VERIFICATION_OUTCOMES
        .CANCELLED;
    }

    if (
      [
        'REVERSED',
        'REVERSAL',
      ].includes(
        status,
      )
    ) {
      return VERIFICATION_OUTCOMES
        .REVERSED;
    }

    if (
      [
        'UNKNOWN',
        'UNDEFINED',
        'UNCONFIRMED',
      ].includes(
        status,
      )
    ) {
      return VERIFICATION_OUTCOMES
        .UNKNOWN;
    }

    return null;
  }

  _mapOutcomeToPaymentState(
    outcome,
  ) {
    const states =
      PaymentStateMachine.STATES
      || PaymentStateMachine
        .PAYMENT_STATES
      || {};

    switch (
      outcome
    ) {
      case VERIFICATION_OUTCOMES
        .SUCCESS:
        return states.SUCCESSFUL;

      case VERIFICATION_OUTCOMES
        .FAILED:
        return states.FAILED;

      case VERIFICATION_OUTCOMES
        .PENDING:
        return states.PENDING;

      case VERIFICATION_OUTCOMES
        .CANCELLED:
        return states.CANCELLED;

      case VERIFICATION_OUTCOMES
        .REVERSED:
        return states.REVERSED;

      default:
        return states.UNKNOWN;
    }
  }

  _isStateAlreadyEquivalent(
    currentState,
    outcome,
  ) {
    const state =
      normalizeStatus(
        currentState,
      );

    return (
      (
        state
        === 'SUCCESSFUL'
        && outcome
          === VERIFICATION_OUTCOMES
            .SUCCESS
      )
      || (
        state
        === 'FAILED'
        && outcome
          === VERIFICATION_OUTCOMES
            .FAILED
      )
      || (
        state
        === 'PENDING'
        && outcome
          === VERIFICATION_OUTCOMES
            .PENDING
      )
      || (
        state
        === 'PROCESSING'
        && outcome
          === VERIFICATION_OUTCOMES
            .PENDING
      )
      || (
        state
        === 'CANCELLED'
        && outcome
          === VERIFICATION_OUTCOMES
            .CANCELLED
      )
      || (
        state
        === 'REVERSED'
        && outcome
          === VERIFICATION_OUTCOMES
            .REVERSED
      )
    );
  }

  /* ==========================================================================
   * Context / Correlation
   * ======================================================================== */

  async _validateContext(
    payment,
    evidence,
    context,
  ) {
    if (
      this.options.requireTenant
      && !context.tenantId
    ) {
      throw new PaymentVerificationError(
        'Tenant context is required for payment verification.',
        {
          code:
            VERIFICATION_ERROR_CODES
              .TENANT_REQUIRED,
          statusCode: 403,
          paymentId:
            payment.id,
        },
      );
    }

    if (
      payment.tenantId
      && context.tenantId
      && payment.tenantId
        !== context.tenantId
    ) {
      throw new PaymentVerificationError(
        'Payment does not belong to the current tenant.',
        {
          code:
            VERIFICATION_ERROR_CODES
              .TENANT_MISMATCH,
          statusCode: 403,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
        },
      );
    }

    /**
     * Authenticated callback verification must not proceed without verified
     * callback security evidence in strict mode.
     */
    if (
      context.fromCallback
      && this.options.strictMode
      && !context.signatureVerified
    ) {
      throw new PaymentVerificationError(
        'Provider callback signature verification is required.',
        {
          code:
            VERIFICATION_ERROR_CODES
              .SIGNATURE_REQUIRED,
          statusCode: 401,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
        },
      );
    }

    if (
      context.fromCallback
      && this.options.requireEventIdForCallback
      && !evidence.providerEventId
      && !evidence.providerTransactionId
    ) {
      throw new PaymentVerificationError(
        'Provider callback event identity is required.',
        {
          code:
            VERIFICATION_ERROR_CODES
              .EVENT_ID_REQUIRED,
          statusCode: 400,
          paymentId:
            payment.id,
          tenantId:
            context.tenantId,
        },
      );
    }

    /**
     * Validate callback/provider timestamp when one is available.
     */
    if (
      context.fromCallback
      && evidence.timestamp
    ) {
      const timestampCheck =
        this._verifyTimestamp(
          evidence.timestamp,
        );

      if (!timestampCheck.valid) {
        throw new PaymentVerificationError(
          timestampCheck.message,
          {
            code:
              timestampCheck.code,
            statusCode: 409,
            paymentId:
              payment.id,
            tenantId:
              context.tenantId,
          },
        );
      }
    }
  }

  _verifyTimestamp(
    timestamp,
    options = {},
  ) {
    const date =
      parseDate(
        timestamp,
      );

    if (!date) {
      return {
        valid: false,

        code:
          VERIFICATION_ERROR_CODES
            .TIMESTAMP_INVALID,

        message:
          'Provider timestamp is invalid.',
      };
    }

    const tolerance =
      Number(
        options.toleranceMs
        || this.options
          .defaultTimestampToleranceMs,
      );

    const futureSkew =
      Number(
        options.futureSkewMs
        || this.options
          .allowFutureTimestampSkewMs,
      );

    const current =
      Date.now();

    const time =
      date.getTime();

    if (
      time
      < current - tolerance
    ) {
      return {
        valid: false,

        code:
          VERIFICATION_ERROR_CODES
            .TIMESTAMP_EXPIRED,

        message:
          'Provider timestamp is outside the permitted verification window.',
      };
    }

    if (
      time
      > current + futureSkew
    ) {
      return {
        valid: false,

        code:
          VERIFICATION_ERROR_CODES
            .TIMESTAMP_INVALID,

        message:
          'Provider timestamp is unexpectedly in the future.',
      };
    }

    return {
      valid: true,
    };
  }

  /* ==========================================================================
   * Result Construction
   * ======================================================================== */

  _buildVerificationResult(
    payment,
    evidence,
    checks,
    context,
  ) {
    const failedChecks =
      checks.filter(
        (check) =>
          check.status === 'FAILED',
      );

    const pendingChecks =
      checks.filter(
        (check) =>
          check.status === 'PENDING',
      );

    let status =
      VERIFICATION_STATUS.VERIFIED;

    if (
      failedChecks.length
    ) {
      const onlyReconciliationFailures =
        failedChecks.every(
          (check) =>
            [
              VERIFICATION_ERROR_CODES
                .PROVIDER_REFERENCE_CONFLICT,
              VERIFICATION_ERROR_CODES
                .OUT_OF_ORDER_RESULT,
              VERIFICATION_ERROR_CODES
                .UNKNOWN_RESULT,
              VERIFICATION_ERROR_CODES
                .FINANCIAL_LINK_MISMATCH,
            ].includes(
              check.code,
            ),
        );

      status =
        onlyReconciliationFailures
          ? VERIFICATION_STATUS
              .REQUIRES_RECONCILIATION
          : VERIFICATION_STATUS
              .REJECTED;
    } else if (
      pendingChecks.length
    ) {
      status =
        VERIFICATION_STATUS
          .PENDING;
    }

    const evidenceHash =
      sha256({
        paymentId:
          payment.id,

        provider:
          evidence.provider,

        providerTransactionId:
          evidence.providerTransactionId,

        providerEventId:
          evidence.providerEventId,

        amount:
          evidence.amount,

        currency:
          evidence.currency,

        status:
          evidence.status,

        outcome:
          evidence.outcome,

        timestamp:
          evidence.timestamp
            ? evidence.timestamp
                .toISOString()
            : null,
      });

    return {
      success:
        status
        === VERIFICATION_STATUS
          .VERIFIED,

      status,

      paymentId:
        payment.id,

      tenantId:
        context.tenantId,

      paymentStatus:
        payment.status,

      outcome:
        evidence.outcome,

      provider:
        evidence.provider
        || payment.provider
        || null,

      providerTransactionId:
        evidence.providerTransactionId
        || payment.providerTransactionId
        || null,

      providerEventId:
        evidence.providerEventId
        || payment.providerEventId
        || null,

      amount:
        canonicalAmount(
          payment.amount,
        ),

      currency:
        canonicalCurrency(
          payment.currency,
        ),

      evidenceHash,

      checks,

      failedChecks,

      pendingChecks,

      verified:
        status
        === VERIFICATION_STATUS
          .VERIFIED,

      reconciliationRequired:
        status
        === VERIFICATION_STATUS
          .REQUIRES_RECONCILIATION,

      operationId:
        context.operationId
        || null,

      requestId:
        context.requestId
        || null,

      correlationId:
        context.correlationId
        || null,

      verifiedAt:
        isoNow(),
    };
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
   * Evidence Persistence
   * ======================================================================== */

  async _persistEvidence(
    payment,
    evidence,
    result,
    context,
  ) {
    if (
      !this.options.retainEvidence
      || !this.evidenceRepository
    ) {
      return null;
    }

    const record = {
      verificationId:
        `verification_${crypto.randomUUID()}`,

      tenantId:
        context.tenantId,

      paymentId:
        payment.id,

      provider:
        evidence.provider
        || payment.provider
        || null,

      providerTransactionId:
        evidence.providerTransactionId
        || payment.providerTransactionId
        || null,

      providerEventId:
        evidence.providerEventId
        || payment.providerEventId
        || null,

      source:
        evidence.source,

      status:
        result.status,

      outcome:
        evidence.outcome,

      amount:
        canonicalAmount(
          payment.amount,
        ),

      currency:
        canonicalCurrency(
          payment.currency,
        ),

      evidenceHash:
        result.evidenceHash,

      checks:
        clone(
          result.checks,
        ),

      verifiedAt:
        result.verifiedAt,

      requestId:
        context.requestId
        || null,

      correlationId:
        context.correlationId
        || null,

      metadata:
        this._sanitizeMetadata(
          evidence.metadata,
        ),

      createdAt:
        now(),
    };

    /**
     * Raw provider evidence is intentionally not persisted here.
     */
    if (
      typeof this.evidenceRepository
        .create === 'function'
    ) {
      return this.evidenceRepository
        .create(
          record,
          {
            tenantId:
              context.tenantId,

            persistenceContext:
              context.persistenceContext,
          },
        );
    }

    if (
      typeof this.evidenceRepository
        .record === 'function'
    ) {
      return this.evidenceRepository
        .record(
          record,
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
   * Reconciliation Integration
   * ======================================================================== */

  async createReconciliationException(
    paymentOrId,
    evidence,
    rawContext = {},
  ) {
    const context =
      normalizeContext(
        rawContext,
      );

    const payment =
      await this._loadPayment(
        paymentOrId,
        context,
      );

    const normalizedPayment =
      this._normalizePayment(
        payment,
      );

    const normalizedEvidence =
      this._normalizeEvidence(
        evidence,
        normalizedPayment,
      );

    if (
      !this.reconciliationService
    ) {
      throw new PaymentVerificationError(
        'Reconciliation service is not configured.',
        {
          code:
            VERIFICATION_ERROR_CODES
              .RECONCILIATION_REQUIRED,
          statusCode: 503,
          paymentId:
            normalizedPayment.id,
          tenantId:
            context.tenantId,
          reconciliationRequired:
            true,
        },
      );
    }

    const payload = {
      sourceType:
        'PAYMENT_VERIFICATION',

      sourceId:
        normalizedPayment.id,

      paymentId:
        normalizedPayment.id,

      tenantId:
        context.tenantId,

      provider:
        normalizedEvidence.provider
        || normalizedPayment.provider
        || null,

      providerTransactionId:
        normalizedEvidence.providerTransactionId
        || normalizedPayment
          .providerTransactionId
        || null,

      exceptionType:
        this._deriveExceptionType(
          normalizedPayment,
          normalizedEvidence,
        ),

      severity:
        this._deriveSeverity(
          normalizedPayment,
          normalizedEvidence,
        ),

      expectedAmount:
        canonicalAmount(
          normalizedPayment.amount,
        ),

      receivedAmount:
        canonicalAmount(
          normalizedEvidence.amount,
        ),

      expectedCurrency:
        canonicalCurrency(
          normalizedPayment.currency,
        ),

      receivedCurrency:
        canonicalCurrency(
          normalizedEvidence.currency,
        ),

      expectedStatus:
        normalizedPayment.status,

      receivedStatus:
        normalizedEvidence.outcome,

      evidenceHash:
        sha256({
          paymentId:
            normalizedPayment.id,

          providerTransactionId:
            normalizedEvidence
              .providerTransactionId,

          amount:
            normalizedEvidence.amount,

          currency:
            normalizedEvidence.currency,

          outcome:
            normalizedEvidence.outcome,
        }),

      metadata:
        this._sanitizeMetadata(
          normalizedEvidence.metadata,
        ),
    };

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

    if (
      typeof this.reconciliationService
        .createException
        === 'function'
    ) {
      return this.reconciliationService
        .createException(
          payload,
          context,
        );
    }

    throw new PaymentVerificationError(
      'Configured reconciliation service does not implement a supported exception API.',
      {
        code:
          VERIFICATION_ERROR_CODES
            .RECONCILIATION_REQUIRED,
        statusCode: 503,
        paymentId:
          normalizedPayment.id,
        tenantId:
          context.tenantId,
        reconciliationRequired:
          true,
      },
    );
  }

  _deriveExceptionType(
    payment,
    evidence,
  ) {
    if (
      payment.amount
      && evidence.amount
      && canonicalAmount(
        payment.amount,
      )
        !== canonicalAmount(
          evidence.amount,
        )
    ) {
      return VERIFICATION_ERROR_CODES
        .AMOUNT_MISMATCH;
    }

    if (
      payment.currency
      && evidence.currency
      && canonicalCurrency(
        payment.currency,
      )
        !== canonicalCurrency(
          evidence.currency,
        )
    ) {
      return VERIFICATION_ERROR_CODES
        .CURRENCY_MISMATCH;
    }

    if (
      payment.providerTransactionId
      && evidence.providerTransactionId
      && payment.providerTransactionId
        !== evidence.providerTransactionId
    ) {
      return VERIFICATION_ERROR_CODES
        .PROVIDER_REFERENCE_MISMATCH;
    }

    if (
      evidence.outcome
      === VERIFICATION_OUTCOMES
        .UNKNOWN
    ) {
      return VERIFICATION_ERROR_CODES
        .UNKNOWN_RESULT;
    }

    return VERIFICATION_ERROR_CODES
      .RECONCILIATION_REQUIRED;
  }

  _deriveSeverity(
    payment,
    evidence,
  ) {
    const exceptionType =
      this._deriveExceptionType(
        payment,
        evidence,
      );

    if (
      [
        VERIFICATION_ERROR_CODES
          .AMOUNT_MISMATCH,
        VERIFICATION_ERROR_CODES
          .PROVIDER_REFERENCE_CONFLICT,
        VERIFICATION_ERROR_CODES
          .FINANCIAL_LINK_MISMATCH,
      ].includes(
        exceptionType,
      )
    ) {
      return 'HIGH';
    }

    if (
      exceptionType
      === VERIFICATION_ERROR_CODES
        .UNKNOWN_RESULT
    ) {
      return 'MEDIUM';
    }

    return 'MEDIUM';
  }

  /* ==========================================================================
   * Persistence / Lookup
   * ======================================================================== */

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
      throw new PaymentVerificationError(
        'Payment repository is not configured.',
        {
          code:
            VERIFICATION_ERROR_CODES
              .STORAGE_UNAVAILABLE,
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
      throw new PaymentVerificationError(
        'Payment identifier is required.',
        {
          code:
            VERIFICATION_ERROR_CODES
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
        .getById === 'function'
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
        .findById === 'function'
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
      throw new PaymentVerificationError(
        'Payment not found.',
        {
          code:
            VERIFICATION_ERROR_CODES
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

  /* ==========================================================================
   * Audit / Metrics
   * ======================================================================== */

  async _recordAudit(
    payment,
    evidence,
    result,
    context,
  ) {
    if (
      !this.auditService
    ) {
      return null;
    }

    const payload = {
      tenantId:
        context.tenantId,

      actorId:
        context.actorId,

      actorType:
        context.actorType,

      action:
        'PAYMENT_VERIFICATION_COMPLETED',

      resourceType:
        'Payment',

      resourceId:
        payment.id,

      paymentId:
        payment.id,

      provider:
        evidence.provider
        || payment.provider
        || null,

      providerTransactionId:
        evidence.providerTransactionId
        || payment.providerTransactionId
        || null,

      providerEventId:
        evidence.providerEventId
        || payment.providerEventId
        || null,

      verificationStatus:
        result.status,

      outcome:
        evidence.outcome,

      evidenceHash:
        result.evidenceHash,

      requestId:
        context.requestId
        || null,

      correlationId:
        context.correlationId
        || null,

      createdAt:
        result.verifiedAt,
    };

    try {
      if (
        typeof this.auditService
          .record === 'function'
      ) {
        return this.auditService.record(
          payload,
        );
      }

      if (
        typeof this.auditService
          .create === 'function'
      ) {
        return this.auditService.create(
          payload,
        );
      }
    } catch (error) {
      this._logError(
        'Failed to record payment verification audit event.',
        error,
        {
          paymentId:
            payment.id,

          tenantId:
            context.tenantId,
        },
      );

      if (
        this.options.strictMode
      ) {
        throw error;
      }
    }

    return null;
  }

  _recordMetrics(
    payment,
    result,
  ) {
    const status =
      String(
        result.status
        || 'UNKNOWN',
      ).toLowerCase();

    this._metric(
      'payment_verifications_total',
      1,
      {
        status,
        provider:
          payment.provider
          || 'unknown',
      },
    );

    if (
      result.reconciliationRequired
    ) {
      this._metric(
        'payment_verification_reconciliation_total',
        1,
        {
          provider:
            payment.provider
            || 'unknown',
        },
      );
    }
  }

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
      // Metrics must never affect payment verification.
    }
  }

  /* ==========================================================================
   * Sanitization
   * ======================================================================== */

  _sanitizeMetadata(
    metadata,
  ) {
    if (
      !metadata
      || typeof metadata
        !== 'object'
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
        'rawAuthorizationHeader',
      ]);

    const output = {};

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
        output[key] =
          '[REDACTED]';

        continue;
      }

      output[key] =
        clone(value);
    }

    return output;
  }

  _sanitizeEvidenceForLog(
    evidence,
  ) {
    return {
      source:
        evidence.source,

      provider:
        evidence.provider,

      providerTransactionId:
        evidence.providerTransactionId,

      providerEventId:
        evidence.providerEventId,

      paymentReference:
        evidence.paymentReference,

      amount:
        evidence.amount,

      currency:
        evidence.currency,

      status:
        evidence.status,

      outcome:
        evidence.outcome,

      timestamp:
        evidence.timestamp
          ? evidence.timestamp
              .toISOString()
          : null,

      signatureVerified:
        evidence.signatureVerified,

      timestampVerified:
        evidence.timestampVerified,
    };
  }

  /* ==========================================================================
   * Logging
   * ======================================================================== */

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
      // Never mask primary verification failure.
    }
  }
}

/* ============================================================================
 * Static API
 * ========================================================================== */

PaymentVerificationService.STATUS =
  VERIFICATION_STATUS;

PaymentVerificationService.STATUSES =
  VERIFICATION_STATUS;

PaymentVerificationService.OUTCOMES =
  VERIFICATION_OUTCOMES;

PaymentVerificationService.ERROR_CODES =
  VERIFICATION_ERROR_CODES;

PaymentVerificationService.PaymentVerificationError =
  PaymentVerificationError;

/* ============================================================================
 * Factory
 * ========================================================================== */

function createPaymentVerificationService(
  dependencies = {},
) {
  return new PaymentVerificationService(
    dependencies,
  );
}

/* ============================================================================
 * Exports
 * ========================================================================== */

module.exports =
  PaymentVerificationService;

module.exports.PaymentVerificationService =
  PaymentVerificationService;

module.exports.PaymentVerificationError =
  PaymentVerificationError;

module.exports.createPaymentVerificationService =
  createPaymentVerificationService;

module.exports.PAYMENT_VERIFICATION_STATUS =
  VERIFICATION_STATUS;

module.exports.PAYMENT_VERIFICATION_STATUSES =
  VERIFICATION_STATUS;

module.exports.PAYMENT_VERIFICATION_OUTCOMES =
  VERIFICATION_OUTCOMES;

module.exports.PAYMENT_VERIFICATION_ERROR_CODES =
  VERIFICATION_ERROR_CODES;

/* ============================================================================
 * End of File
 * ============================================================================
 */