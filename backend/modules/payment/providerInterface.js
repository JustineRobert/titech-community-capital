'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Payment Provider Interface
 * ============================================================================
 *
 * File:
 *   backend/modules/payment/providerInterface.js
 *
 * Purpose:
 *   Defines the canonical provider contract used by the TITech payment
 *   orchestration layer for MTN MoMo, Airtel Money, banking integrations,
 *   settlement providers, and future payment rails.
 *
 * Architectural Responsibilities
 * ----------------------------------------------------------------------------
 * This interface defines:
 *
 *   - Payment initiation
 *   - Payment status verification
 *   - Payment cancellation
 *   - Payment reversal
 *   - Refund initiation
 *   - Provider capability discovery
 *   - Provider result normalization
 *   - Provider error classification
 *   - Retryability classification
 *   - Provider health checks
 *
 * This interface does NOT own:
 *
 *   - Payment state mutation
 *   - Idempotency persistence
 *   - Callback signature verification
 *   - Tenant authorization
 *   - Customer authorization
 *   - Ledger posting
 *   - Account balance mutation
 *   - Financial reconciliation
 *
 * Canonical Architecture
 * ----------------------------------------------------------------------------
 *
 *                 PAYMENT PROCESSING SERVICE
 *                            |
 *                            v
 *                  PROVIDER REGISTRY
 *                            |
 *             +--------------+--------------+
 *             |                             |
 *             v                             v
 *       MTN PROVIDER                  AIRTEL PROVIDER
 *             |                             |
 *             +--------------+--------------+
 *                            |
 *                            v
 *                   PROVIDER INTERFACE
 *                            |
 *                            v
 *               EXTERNAL PROVIDER API
 *
 * Provider implementations MUST remain behind this boundary.
 *
 * Design Principles
 * ----------------------------------------------------------------------------
 * 1. Provider implementations are adapters, not financial authorities.
 * 2. Every provider operation must be correlation-friendly.
 * 3. Every externally initiated financial operation must support idempotency
 *    whenever the provider contract permits it.
 * 4. Provider responses must be normalized before entering payment domain logic.
 * 5. Unknown outcomes must be represented explicitly.
 * 6. Provider errors must distinguish retryable failures from permanent
 *    failures and ambiguous outcomes.
 * 7. Secrets must never appear in provider results, logs, or normalized errors.
 * 8. Monetary values must remain decimal-safe and must not be calculated using
 *    binary floating-point arithmetic inside this interface.
 * 9. Provider-specific payloads should be preserved only through controlled
 *    metadata/evidence mechanisms.
 * 10. Provider implementations must be testable without real external calls.
 *
 * ============================================================================
 */

/* ============================================================================
 * Constants
 * ========================================================================== */

const PROVIDER_OPERATION_TYPES = Object.freeze({
  INITIATE_PAYMENT: 'INITIATE_PAYMENT',
  GET_PAYMENT_STATUS: 'GET_PAYMENT_STATUS',
  CANCEL_PAYMENT: 'CANCEL_PAYMENT',
  REVERSE_PAYMENT: 'REVERSE_PAYMENT',
  REFUND_PAYMENT: 'REFUND_PAYMENT',
  HEALTH_CHECK: 'HEALTH_CHECK',
});

const PROVIDER_OUTCOMES = Object.freeze({
  SUCCESS: 'SUCCESS',
  PENDING: 'PENDING',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REVERSED: 'REVERSED',
  UNKNOWN: 'UNKNOWN',
});

const PROVIDER_ERROR_CATEGORIES = Object.freeze({
  VALIDATION: 'VALIDATION',
  AUTHENTICATION: 'AUTHENTICATION',
  AUTHORIZATION: 'AUTHORIZATION',
  RATE_LIMIT: 'RATE_LIMIT',
  TIMEOUT: 'TIMEOUT',
  NETWORK: 'NETWORK',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PROVIDER_REJECTED: 'PROVIDER_REJECTED',
  DUPLICATE: 'DUPLICATE',
  INVALID_REFERENCE: 'INVALID_REFERENCE',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  INVALID_CURRENCY: 'INVALID_CURRENCY',
  CALLBACK: 'CALLBACK',
  UNKNOWN_OUTCOME: 'UNKNOWN_OUTCOME',
  CONFIGURATION: 'CONFIGURATION',
  INTERNAL: 'INTERNAL',
  UNSUPPORTED: 'UNSUPPORTED',
});

const PROVIDER_CAPABILITIES = Object.freeze({
  INITIATE_PAYMENT: 'initiatePayment',
  GET_PAYMENT_STATUS: 'getPaymentStatus',
  CANCEL_PAYMENT: 'cancelPayment',
  REVERSE_PAYMENT: 'reversePayment',
  REFUND_PAYMENT: 'refundPayment',
  HEALTH_CHECK: 'healthCheck',

  CALLBACKS: 'callbacks',
  STATUS_POLLING: 'statusPolling',
  IDEMPOTENCY: 'idempotency',
  REFUNDS: 'refunds',
  REVERSALS: 'reversals',
  CANCELLATION: 'cancellation',
});

const PROVIDER_INTERFACE_ERROR_CODES = Object.freeze({
  INVALID_PROVIDER: 'INVALID_PAYMENT_PROVIDER',
  PROVIDER_ID_REQUIRED: 'PAYMENT_PROVIDER_ID_REQUIRED',
  PROVIDER_NAME_REQUIRED: 'PAYMENT_PROVIDER_NAME_REQUIRED',

  INVALID_OPERATION: 'INVALID_PROVIDER_OPERATION',
  UNSUPPORTED_OPERATION: 'UNSUPPORTED_PROVIDER_OPERATION',

  INVALID_REQUEST: 'INVALID_PROVIDER_REQUEST',
  INVALID_RESULT: 'INVALID_PROVIDER_RESULT',

  PAYMENT_REFERENCE_REQUIRED: 'PAYMENT_REFERENCE_REQUIRED',
  PROVIDER_REFERENCE_REQUIRED: 'PROVIDER_REFERENCE_REQUIRED',

  AMOUNT_REQUIRED: 'PAYMENT_AMOUNT_REQUIRED',
  INVALID_AMOUNT: 'INVALID_PAYMENT_AMOUNT',

  CURRENCY_REQUIRED: 'PAYMENT_CURRENCY_REQUIRED',
  INVALID_CURRENCY: 'INVALID_PAYMENT_CURRENCY',

  CREDENTIALS_UNAVAILABLE: 'PROVIDER_CREDENTIALS_UNAVAILABLE',
  CONFIGURATION_ERROR: 'PROVIDER_CONFIGURATION_ERROR',

  OPERATION_TIMEOUT: 'PROVIDER_OPERATION_TIMEOUT',
  UNKNOWN_OUTCOME: 'PROVIDER_OPERATION_UNKNOWN_OUTCOME',

  NOT_IMPLEMENTED: 'PROVIDER_METHOD_NOT_IMPLEMENTED',
  HEALTH_CHECK_FAILED: 'PROVIDER_HEALTH_CHECK_FAILED',
});

/* ============================================================================
 * Provider Interface Error
 * ========================================================================== */

class ProviderInterfaceError extends Error {
  constructor(message, options = {}) {
    super(message);

    this.name = 'ProviderInterfaceError';

    this.code =
      options.code ||
      PROVIDER_INTERFACE_ERROR_CODES.INVALID_PROVIDER;

    this.statusCode =
      Number.isInteger(options.statusCode)
        ? options.statusCode
        : 502;

    this.provider =
      options.provider || null;

    this.operation =
      options.operation || null;

    this.requestId =
      options.requestId || null;

    this.correlationId =
      options.correlationId || null;

    this.paymentReference =
      options.paymentReference || null;

    this.providerTransactionId =
      options.providerTransactionId || null;

    this.category =
      options.category || PROVIDER_ERROR_CATEGORIES.INTERNAL;

    this.retryable =
      options.retryable === true;

    this.unknownOutcome =
      options.unknownOutcome === true;

    this.details =
      options.details || {};

    if (options.cause) {
      this.cause = options.cause;
    }

    Error.captureStackTrace?.(
      this,
      ProviderInterfaceError,
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

function normalizeProviderId(value) {
  const normalized = normalizeString(value);

  if (!normalized) {
    throw new ProviderInterfaceError(
      'Provider identifier is required.',
      {
        code:
          PROVIDER_INTERFACE_ERROR_CODES
            .PROVIDER_ID_REQUIRED,
        statusCode: 500,
      },
    );
  }

  return normalized.toLowerCase();
}

function normalizeProviderName(value) {
  const normalized = normalizeString(value);

  if (!normalized) {
    throw new ProviderInterfaceError(
      'Provider name is required.',
      {
        code:
          PROVIDER_INTERFACE_ERROR_CODES
            .PROVIDER_NAME_REQUIRED,
        statusCode: 500,
      },
    );
  }

  return normalized;
}

function normalizeOperation(value) {
  const normalized = normalizeString(value);

  if (!normalized) {
    throw new ProviderInterfaceError(
      'Provider operation is required.',
      {
        code:
          PROVIDER_INTERFACE_ERROR_CODES
            .INVALID_OPERATION,
        statusCode: 400,
      },
    );
  }

  return normalized.toUpperCase();
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
  const normalized = normalizeAmount(value);

  if (!normalized) {
    return null;
  }

  const trimmed = normalized.trim();

  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return null;
  }

  const parts = trimmed.split('.');

  const integerPart =
    parts[0].replace(/^0+(?=\d)/, '');

  const decimalPart = parts[1]
    ? parts[1].replace(/0+$/, '')
    : '';

  return decimalPart
    ? `${integerPart}.${decimalPart}`
    : integerPart;
}

function canonicalCurrency(value) {
  const currency = normalizeString(value);

  if (!currency) {
    return null;
  }

  return currency.toUpperCase();
}

function normalizeProviderStatus(value) {
  const status = normalizeString(value);

  return status
    ? status.toUpperCase()
    : null;
}

function normalizeOutcome(value) {
  const status = normalizeProviderStatus(value);

  if (!status) {
    return PROVIDER_OUTCOMES.UNKNOWN;
  }

  if (
    [
      'SUCCESS',
      'SUCCESSFUL',
      'COMPLETED',
      'COMPLETE',
      'PAID',
      'APPROVED',
    ].includes(status)
  ) {
    return PROVIDER_OUTCOMES.SUCCESS;
  }

  if (
    [
      'PENDING',
      'PROCESSING',
      'IN_PROGRESS',
      'QUEUED',
      'ACCEPTED',
      'INITIATED',
    ].includes(status)
  ) {
    return PROVIDER_OUTCOMES.PENDING;
  }

  if (
    [
      'FAILED',
      'FAILURE',
      'DECLINED',
      'REJECTED',
      'ERROR',
    ].includes(status)
  ) {
    return PROVIDER_OUTCOMES.FAILED;
  }

  if (
    [
      'CANCELLED',
      'CANCELED',
    ].includes(status)
  ) {
    return PROVIDER_OUTCOMES.CANCELLED;
  }

  if (
    [
      'REVERSED',
      'REVERSAL',
    ].includes(status)
  ) {
    return PROVIDER_OUTCOMES.REVERSED;
  }

  return PROVIDER_OUTCOMES.UNKNOWN;
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
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return value;
  }
}

function sha256(value) {
  return require('crypto')
    .createHash('sha256')
    .update(
      typeof value === 'string'
        ? value
        : JSON.stringify(value),
    )
    .digest('hex');
}

function redactObject(
  value,
  sensitiveKeys,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      redactObject(
        item,
        sensitiveKeys,
      ),
    );
  }

  if (typeof value !== 'object') {
    return value;
  }

  const output = {};

  for (
    const [key, child]
    of Object.entries(value)
  ) {
    if (sensitiveKeys.has(key)) {
      output[key] = '[REDACTED]';
      continue;
    }

    output[key] = redactObject(
      child,
      sensitiveKeys,
    );
  }

  return output;
}

function normalizeContext(context = {}) {
  return {
    tenantId:
      normalizeString(context.tenantId),

    actorId:
      normalizeString(context.actorId),

    actorType:
      normalizeString(context.actorType) ||
      'SYSTEM',

    requestId:
      normalizeString(context.requestId),

    correlationId:
      normalizeString(context.correlationId),

    causationId:
      normalizeString(context.causationId),

    idempotencyKey:
      normalizeString(context.idempotencyKey),

    provider:
      normalizeString(context.provider)
        ?.toLowerCase(),

    operationId:
      normalizeString(context.operationId),

    metadata:
      context.metadata &&
      typeof context.metadata === 'object'
        ? clone(context.metadata)
        : {},
  };
}

/* ============================================================================
 * Canonical Request Schemas
 * ========================================================================== */

/**
 * The interface intentionally keeps request contracts provider-neutral.
 * Provider implementations may require additional data through metadata,
 * but the common fields below must retain their meaning across providers.
 */

function normalizePaymentRequest(
  request = {},
) {
  const normalized = {
    paymentId:
      normalizeString(request.paymentId),

    paymentReference:
      normalizeString(
        request.paymentReference ||
        request.reference,
      ),

    tenantId:
      normalizeString(request.tenantId),

    customerReference:
      normalizeString(
        request.customerReference,
      ),

    phoneNumber:
      normalizeString(
        request.phoneNumber ||
        request.msisdn,
      ),

    accountReference:
      normalizeString(
        request.accountReference,
      ),

    amount:
      canonicalAmount(
        request.amount,
      ),

    currency:
      canonicalCurrency(
        request.currency,
      ),

    direction:
      normalizeString(
        request.direction,
      )?.toLowerCase(),

    paymentType:
      normalizeString(
        request.paymentType ||
        request.type,
      )?.toLowerCase(),

    idempotencyKey:
      normalizeString(
        request.idempotencyKey,
      ),

    providerTransactionId:
      normalizeString(
        request.providerTransactionId,
      ),

    callbackUrl:
      normalizeString(
        request.callbackUrl,
      ),

    narration:
      normalizeString(
        request.narration,
      ),

    metadata:
      request.metadata &&
      typeof request.metadata === 'object'
        ? clone(request.metadata)
        : {},
  };

  return normalized;
}

/* ============================================================================
 * Provider Interface
 * ========================================================================== */

class PaymentProviderInterface {
  /**
   * @param {Object} config
   * @param {string} config.id
   * @param {string} config.name
   * @param {Object} [config.capabilities]
   * @param {Object} [config.options]
   * @param {Object} [config.logger]
   */
  constructor(config = {}) {
    this.id =
      normalizeProviderId(
        config.id,
      );

    this.name =
      normalizeProviderName(
        config.name || config.id,
      );

    this.capabilities = Object.freeze({
      [PROVIDER_CAPABILITIES.INITIATE_PAYMENT]:
        false,

      [PROVIDER_CAPABILITIES.GET_PAYMENT_STATUS]:
        false,

      [PROVIDER_CAPABILITIES.CANCEL_PAYMENT]:
        false,

      [PROVIDER_CAPABILITIES.REVERSE_PAYMENT]:
        false,

      [PROVIDER_CAPABILITIES.REFUND_PAYMENT]:
        false,

      [PROVIDER_CAPABILITIES.HEALTH_CHECK]:
        false,

      [PROVIDER_CAPABILITIES.CALLBACKS]:
        false,

      [PROVIDER_CAPABILITIES.STATUS_POLLING]:
        false,

      [PROVIDER_CAPABILITIES.IDEMPOTENCY]:
        false,

      [PROVIDER_CAPABILITIES.REFUNDS]:
        false,

      [PROVIDER_CAPABILITIES.REVERSALS]:
        false,

      [PROVIDER_CAPABILITIES.CANCELLATION]:
        false,

      ...(config.capabilities || {}),
    });

    this.options = Object.freeze({
      strictMode:
        config.options?.strictMode !== false,

      defaultTimeoutMs:
        Number(
          config.options?.defaultTimeoutMs ||
          30000,
        ),

      maxRequestAttempts:
        Math.max(
          1,
          Number(
            config.options?.maxRequestAttempts ||
            1,
          ),
        ),
    });

    this.logger =
      config.logger ||
      console;
  }

  /* ==========================================================================
   * Provider Identity
   * ======================================================================== */

  getProviderId() {
    return this.id;
  }

  getProviderName() {
    return this.name;
  }

  getCapabilities() {
    return Object.freeze({
      ...this.capabilities,
    });
  }

  supports(
    capability,
  ) {
    if (!isNonEmptyString(capability)) {
      return false;
    }

    return (
      this.capabilities[capability] === true
    );
  }

  getConfiguration() {
    /**
     * Provider implementations should override this if non-secret
     * configuration metadata is needed.
     *
     * Never expose credentials here.
     */
    return Object.freeze({
      id: this.id,
      name: this.name,
      capabilities: {
        ...this.capabilities,
      },
    });
  }

  /* ==========================================================================
   * Payment Operations
   * ======================================================================== */

  /**
   * Initiate a payment.
   *
   * @param {Object} request
   * @param {Object} context
   * @returns {Promise<Object>}
   */
  async initiatePayment(
    request,
    context = {},
  ) {
    this._assertImplemented(
      'initiatePayment',
    );

    const normalized =
      this.validatePaymentRequest(
        request,
        context,
      );

    return this._normalizeProviderResult(
      await this._executeWithProviderContext(
        'INITIATE_PAYMENT',
        () =>
          this._initiatePayment(
            normalized,
            normalizeContext(context),
          ),
      ),
      {
        operation:
          PROVIDER_OPERATION_TYPES
            .INITIATE_PAYMENT,
      },
    );
  }

  /**
   * Internal extension point for concrete providers.
   */
  async _initiatePayment() {
    throw this._notImplemented(
      '_initiatePayment',
    );
  }

  /**
   * Verify/query payment status.
   *
   * @param {Object} request
   * @param {Object} context
   */
  async getPaymentStatus(
    request,
    context = {},
  ) {
    this._assertImplemented(
      'getPaymentStatus',
    );

    const normalized =
      this.validatePaymentStatusRequest(
        request,
        context,
      );

    return this._normalizeProviderResult(
      await this._executeWithProviderContext(
        'GET_PAYMENT_STATUS',
        () =>
          this._getPaymentStatus(
            normalized,
            normalizeContext(context),
          ),
      ),
      {
        operation:
          PROVIDER_OPERATION_TYPES
            .GET_PAYMENT_STATUS,
      },
    );
  }

  async _getPaymentStatus() {
    throw this._notImplemented(
      '_getPaymentStatus',
    );
  }

  /**
   * Cancel a payment where supported by the provider.
   */
  async cancelPayment(
    request,
    context = {},
  ) {
    this._assertImplemented(
      'cancelPayment',
    );

    const normalized =
      this.validatePaymentMutationRequest(
        request,
        context,
      );

    return this._normalizeProviderResult(
      await this._executeWithProviderContext(
        'CANCEL_PAYMENT',
        () =>
          this._cancelPayment(
            normalized,
            normalizeContext(context),
          ),
      ),
      {
        operation:
          PROVIDER_OPERATION_TYPES
            .CANCEL_PAYMENT,
      },
    );
  }

  async _cancelPayment() {
    throw this._notImplemented(
      '_cancelPayment',
    );
  }

  /**
   * Reverse a payment where supported.
   */
  async reversePayment(
    request,
    context = {},
  ) {
    this._assertImplemented(
      'reversePayment',
    );

    const normalized =
      this.validatePaymentMutationRequest(
        request,
        context,
      );

    return this._normalizeProviderResult(
      await this._executeWithProviderContext(
        'REVERSE_PAYMENT',
        () =>
          this._reversePayment(
            normalized,
            normalizeContext(context),
          ),
      ),
      {
        operation:
          PROVIDER_OPERATION_TYPES
            .REVERSE_PAYMENT,
      },
    );
  }

  async _reversePayment() {
    throw this._notImplemented(
      '_reversePayment',
    );
  }

  /**
   * Refund a payment where supported.
   */
  async refundPayment(
    request,
    context = {},
  ) {
    this._assertImplemented(
      'refundPayment',
    );

    const normalized =
      this.validatePaymentMutationRequest(
        request,
        context,
      );

    return this._normalizeProviderResult(
      await this._executeWithProviderContext(
        'REFUND_PAYMENT',
        () =>
          this._refundPayment(
            normalized,
            normalizeContext(context),
          ),
      ),
      {
        operation:
          PROVIDER_OPERATION_TYPES
            .REFUND_PAYMENT,
      },
    );
  }

  async _refundPayment() {
    throw this._notImplemented(
      '_refundPayment',
    );
  }

  /* ==========================================================================
   * Health / Readiness
   * ======================================================================== */

  async healthCheck(
    context = {},
  ) {
    this._assertImplemented(
      'healthCheck',
    );

    return this._normalizeHealthResult(
      await this._executeWithProviderContext(
        'HEALTH_CHECK',
        () =>
          this._healthCheck(
            normalizeContext(context),
          ),
      ),
    );
  }

  async _healthCheck() {
    throw this._notImplemented(
      '_healthCheck',
    );
  }

  /* ==========================================================================
   * Validation
   * ======================================================================== */

  validatePaymentRequest(
    request,
    context = {},
  ) {
    const normalized =
      normalizePaymentRequest(
        request,
      );

    if (
      this.options.strictMode &&
      !normalized.paymentReference
    ) {
      throw new ProviderInterfaceError(
        'Payment reference is required.',
        {
          code:
            PROVIDER_INTERFACE_ERROR_CODES
              .PAYMENT_REFERENCE_REQUIRED,
          statusCode: 400,
          provider: this.id,
          operation:
            PROVIDER_OPERATION_TYPES
              .INITIATE_PAYMENT,
        },
      );
    }

    if (!normalized.amount) {
      throw new ProviderInterfaceError(
        'Payment amount is required.',
        {
          code:
            PROVIDER_INTERFACE_ERROR_CODES
              .AMOUNT_REQUIRED,
          statusCode: 400,
          provider: this.id,
          operation:
            PROVIDER_OPERATION_TYPES
              .INITIATE_PAYMENT,
        },
      );
    }

    if (!/^\d+(\.\d+)?$/.test(
      normalized.amount,
    )) {
      throw new ProviderInterfaceError(
        'Payment amount is invalid.',
        {
          code:
            PROVIDER_INTERFACE_ERROR_CODES
              .INVALID_AMOUNT,
          statusCode: 400,
          provider: this.id,
          operation:
            PROVIDER_OPERATION_TYPES
              .INITIATE_PAYMENT,
        },
      );
    }

    if (!normalized.currency) {
      throw new ProviderInterfaceError(
        'Payment currency is required.',
        {
          code:
            PROVIDER_INTERFACE_ERROR_CODES
              .CURRENCY_REQUIRED,
          statusCode: 400,
          provider: this.id,
          operation:
            PROVIDER_OPERATION_TYPES
              .INITIATE_PAYMENT,
        },
      );
    }

    if (
      !/^[A-Z]{3}$/.test(
        normalized.currency,
      )
    ) {
      throw new ProviderInterfaceError(
        'Payment currency must be an ISO-like three-letter currency code.',
        {
          code:
            PROVIDER_INTERFACE_ERROR_CODES
              .INVALID_CURRENCY,
          statusCode: 400,
          provider: this.id,
          operation:
            PROVIDER_OPERATION_TYPES
              .INITIATE_PAYMENT,
        },
      );
    }

    return normalized;
  }

  validatePaymentStatusRequest(
    request,
    context = {},
  ) {
    const normalized =
      normalizePaymentRequest(
        request,
      );

    const providerReference =
      normalized.providerTransactionId ||
      normalized.paymentReference;

    if (!providerReference) {
      throw new ProviderInterfaceError(
        'A payment or provider transaction reference is required.',
        {
          code:
            PROVIDER_INTERFACE_ERROR_CODES
              .PROVIDER_REFERENCE_REQUIRED,
          statusCode: 400,
          provider: this.id,
          operation:
            PROVIDER_OPERATION_TYPES
              .GET_PAYMENT_STATUS,
        },
      );
    }

    return normalized;
  }

  validatePaymentMutationRequest(
    request,
    context = {},
  ) {
    const normalized =
      normalizePaymentRequest(
        request,
      );

    const providerReference =
      normalized.providerTransactionId ||
      normalized.paymentReference;

    if (!providerReference) {
      throw new ProviderInterfaceError(
        'A payment or provider transaction reference is required.',
        {
          code:
            PROVIDER_INTERFACE_ERROR_CODES
              .PROVIDER_REFERENCE_REQUIRED,
          statusCode: 400,
          provider: this.id,
        },
      );
    }

    return normalized;
  }

  /* ==========================================================================
   * Result Normalization
   * ======================================================================== */

  /**
   * All provider implementations must ultimately return the normalized
   * structure emitted by this method.
   *
   * Concrete providers may return additional provider-specific metadata, but
   * the canonical fields below must be stable.
   */
  _normalizeProviderResult(
    result,
    context = {},
  ) {
    const plain =
      result &&
      typeof result === 'object'
        ? result
        : {};

    const provider =
      normalizeString(
        plain.provider,
      )?.toLowerCase()
      || this.id;

    const providerStatus =
      normalizeProviderStatus(
        plain.providerStatus ||
        plain.status ||
        plain.outcome,
      );

    const outcome =
      normalizeOutcome(
        plain.outcome ||
        providerStatus,
      );

    const normalized = {
      success:
        outcome ===
        PROVIDER_OUTCOMES.SUCCESS,

      outcome,

      status:
        providerStatus,

      provider,

      providerTransactionId:
        normalizeString(
          plain.providerTransactionId ||
          plain.transactionId ||
          plain.providerReference ||
          plain.externalTransactionId,
        ),

      providerEventId:
        normalizeString(
          plain.providerEventId ||
          plain.eventId,
        ),

      paymentReference:
        normalizeString(
          plain.paymentReference ||
          plain.reference,
        ),

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

      reasonCode:
        normalizeString(
          plain.reasonCode ||
          plain.code,
        ),

      occurredAt:
        plain.occurredAt ||
        plain.timestamp ||
        null,

      retryable:
        plain.retryable === true,

      unknownOutcome:
        plain.unknownOutcome === true ||
        outcome ===
          PROVIDER_OUTCOMES.UNKNOWN,

      /**
       * Provider-specific metadata is safe only after sanitization.
       */
      metadata:
        this._sanitizeMetadata(
          plain.metadata,
        ),

      operation:
        context.operation ||
        null,

      /**
       * The response fingerprint allows the payment layer to retain a stable
       * correlation/evidence hash without exposing raw provider payloads.
       */
      responseFingerprint:
        this._buildResponseFingerprint(
          plain,
          context,
        ),
    };

    return normalized;
  }

  _normalizeHealthResult(
    result,
  ) {
    const plain =
      result &&
      typeof result === 'object'
        ? result
        : {};

    const healthy =
      plain.healthy !== undefined
        ? Boolean(
            plain.healthy,
          )
        : plain.status === 'ok'
        || plain.status === 'healthy';

    return {
      healthy,

      provider:
        this.id,

      name:
        this.name,

      status:
        normalizeString(
          plain.status,
        ) ||
        (healthy
          ? 'healthy'
          : 'unhealthy'),

      latencyMs:
        Number.isFinite(
          Number(
            plain.latencyMs,
          ),
        )
          ? Number(
              plain.latencyMs,
            )
          : null,

      checkedAt:
        plain.checkedAt ||
        new Date().toISOString(),

      message:
        normalizeString(
          plain.message,
        ),

      details:
        this._sanitizeMetadata(
          plain.details,
        ),
    };
  }

  _buildResponseFingerprint(
    result,
    context,
  ) {
    return sha256({
      provider:
        this.id,

      operation:
        context.operation ||
        null,

      providerTransactionId:
        normalizeString(
          result.providerTransactionId ||
          result.transactionId,
        ),

      providerEventId:
        normalizeString(
          result.providerEventId ||
          result.eventId,
        ),

      status:
        normalizeProviderStatus(
          result.providerStatus ||
          result.status ||
          result.outcome,
        ),

      amount:
        canonicalAmount(
          result.amount,
        ),

      currency:
        canonicalCurrency(
          result.currency,
        ),
    });
  }

  /* ==========================================================================
   * Error Normalization
   * ======================================================================== */

  normalizeError(
    error,
    operation,
    context = {},
  ) {
    if (
      error instanceof
      ProviderInterfaceError
    ) {
      return error;
    }

    const normalizedOperation =
      operation
        ? normalizeOperation(
            operation,
          )
        : null;

    const source =
      error || {};

    const rawStatus =
      Number(
        source.statusCode ||
        source.status ||
        source.httpStatus ||
        0,
      );

    const category =
      this._classifyError(
        source,
      );

    const unknownOutcome =
      this._isUnknownOutcomeError(
        source,
      );

    const retryable =
      this._isRetryableError(
        source,
        category,
        unknownOutcome,
      );

    let code =
      normalizeString(
        source.code,
      );

    if (!code) {
      code = unknownOutcome
        ? PROVIDER_INTERFACE_ERROR_CODES
            .UNKNOWN_OUTCOME
        : category ===
          PROVIDER_ERROR_CATEGORIES.TIMEOUT
        ? PROVIDER_INTERFACE_ERROR_CODES
            .OPERATION_TIMEOUT
        : PROVIDER_INTERFACE_ERROR_CODES
            .INVALID_PROVIDER;
    }

    return new ProviderInterfaceError(
      this._safeErrorMessage(
        source.message,
      ),
      {
        code,
        statusCode:
          rawStatus || 502,
        provider:
          this.id,
        operation:
          normalizedOperation,
        requestId:
          context.requestId,
        correlationId:
          context.correlationId,
        paymentReference:
          context.paymentReference,
        providerTransactionId:
          context.providerTransactionId,
        category,
        retryable,
        unknownOutcome,
        details:
          this._sanitizeMetadata(
            source.details ||
            source.response?.data ||
            {},
          ),
        cause:
          error,
      },
    );
  }

  _classifyError(
    error,
  ) {
    if (!error) {
      return PROVIDER_ERROR_CATEGORIES.INTERNAL;
    }

    if (
      error.category
      && Object.values(
        PROVIDER_ERROR_CATEGORIES,
      ).includes(
        error.category,
      )
    ) {
      return error.category;
    }

    const code =
      String(
        error.code || '',
      ).toUpperCase();

    const status =
      Number(
        error.statusCode ||
        error.status ||
        error.httpStatus ||
        0,
      );

    if (
      [
        'ETIMEDOUT',
        'ESOCKETTIMEDOUT',
        'TIMEOUT',
        'PROVIDER_TIMEOUT',
      ].includes(
        code,
      )
      || status === 408
      || status === 504
    ) {
      return PROVIDER_ERROR_CATEGORIES.TIMEOUT;
    }

    if (
      [
        'ECONNRESET',
        'ECONNREFUSED',
        'EAI_AGAIN',
        'ENETUNREACH',
        'EHOSTUNREACH',
      ].includes(
        code,
      )
    ) {
      return PROVIDER_ERROR_CATEGORIES.NETWORK;
    }

    if (status === 401) {
      return PROVIDER_ERROR_CATEGORIES
        .AUTHENTICATION;
    }

    if (status === 403) {
      return PROVIDER_ERROR_CATEGORIES
        .AUTHORIZATION;
    }

    if (status === 429) {
      return PROVIDER_ERROR_CATEGORIES
        .RATE_LIMIT;
    }

    if (
      [
        502,
        503,
      ].includes(
        status,
      )
    ) {
      return PROVIDER_ERROR_CATEGORIES
        .PROVIDER_UNAVAILABLE;
    }

    if (
      code.includes('INVALID')
      && code.includes('AMOUNT')
    ) {
      return PROVIDER_ERROR_CATEGORIES
        .INVALID_AMOUNT;
    }

    if (
      code.includes('INVALID')
      && code.includes('CURRENCY')
    ) {
      return PROVIDER_ERROR_CATEGORIES
        .INVALID_CURRENCY;
    }

    if (
      code.includes('DUPLICATE')
      || code.includes('ALREADY')
    ) {
      return PROVIDER_ERROR_CATEGORIES
        .DUPLICATE;
    }

    if (
      code.includes('REFERENCE')
    ) {
      return PROVIDER_ERROR_CATEGORIES
        .INVALID_REFERENCE;
    }

    if (
      code.includes('UNKNOWN')
      || error.unknownOutcome === true
    ) {
      return PROVIDER_ERROR_CATEGORIES
        .UNKNOWN_OUTCOME;
    }

    return PROVIDER_ERROR_CATEGORIES
      .PROVIDER_REJECTED;
  }

  _isUnknownOutcomeError(
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

    const category =
      error.category;

    if (
      category ===
      PROVIDER_ERROR_CATEGORIES
        .UNKNOWN_OUTCOME
    ) {
      return true;
    }

    const code =
      String(
        error.code || '',
      ).toUpperCase();

    return [
      'ETIMEDOUT',
      'ESOCKETTIMEDOUT',
      'ECONNRESET',
      'UNKNOWN_OUTCOME',
      'PROVIDER_TIMEOUT',
      'PROVIDER_OPERATION_UNKNOWN',
    ].includes(
      code,
    );
  }

  _isRetryableError(
    error,
    category,
    unknownOutcome,
  ) {
    /**
     * Unknown outcome is deliberately NOT automatically retryable as a new
     * financial operation.
     */
    if (unknownOutcome) {
      return false;
    }

    if (
      typeof error?.retryable === 'boolean'
    ) {
      return error.retryable;
    }

    return [
      PROVIDER_ERROR_CATEGORIES
        .TIMEOUT,
      PROVIDER_ERROR_CATEGORIES
        .NETWORK,
      PROVIDER_ERROR_CATEGORIES
        .PROVIDER_UNAVAILABLE,
      PROVIDER_ERROR_CATEGORIES
        .RATE_LIMIT,
    ].includes(
      category,
    );
  }

  _safeErrorMessage(
    message,
  ) {
    if (!message) {
      return 'Payment provider operation failed.';
    }

    const text =
      String(
        message,
      );

    return text.length > 500
      ? `${text.slice(0, 500)}...`
      : text;
  }

  /* ==========================================================================
   * Provider Execution Wrapper
   * ======================================================================== */

  async _executeWithProviderContext(
    operation,
    fn,
  ) {
    const normalizedOperation =
      normalizeOperation(
        operation,
      );

    const startedAt =
      Date.now();

    try {
      const result =
        await fn();

      return result;
    } catch (error) {
      const normalizedError =
        this.normalizeError(
          error,
          normalizedOperation,
        );

      this._logError(
        'Payment provider operation failed.',
        normalizedError,
        {
          provider:
            this.id,

          operation:
            normalizedOperation,

          latencyMs:
            Date.now() -
            startedAt,
        },
      );

      throw normalizedError;
    }
  }

  /* ==========================================================================
   * Capability / Interface Enforcement
   * ======================================================================== */

  _assertImplemented(
    methodName,
  ) {
    if (
      typeof this[methodName]
      !== 'function'
    ) {
      throw this._notImplemented(
        methodName,
      );
    }

    const extensionMethod =
      `_${methodName}`;

    if (
      typeof this[extensionMethod]
      !== 'function'
    ) {
      throw this._notImplemented(
        extensionMethod,
      );
    }

    /**
     * Detect whether the concrete implementation actually overrides the
     * extension method inherited from this interface.
     */
    if (
      this[extensionMethod]
      === PaymentProviderInterface
        .prototype[extensionMethod]
    ) {
      throw this._notImplemented(
        extensionMethod,
      );
    }
  }

  _assertCapability(
    capability,
    operation,
  ) {
    if (
      !this.supports(
        capability,
      )
    ) {
      throw new ProviderInterfaceError(
        `Provider does not support ${operation}.`,
        {
          code:
            PROVIDER_INTERFACE_ERROR_CODES
              .UNSUPPORTED_OPERATION,
          statusCode: 501,
          provider:
            this.id,
          operation,
          category:
            PROVIDER_ERROR_CATEGORIES
              .UNSUPPORTED,
        },
      );
    }
  }

  _notImplemented(
    methodName,
  ) {
    return new ProviderInterfaceError(
      `Provider method ${methodName} is not implemented.`,
      {
        code:
          PROVIDER_INTERFACE_ERROR_CODES
            .NOT_IMPLEMENTED,
        statusCode: 501,
        provider:
          this.id,
        category:
          PROVIDER_ERROR_CATEGORIES
            .UNSUPPORTED,
      },
    );
  }

  /* ==========================================================================
   * Safe Metadata
   * ======================================================================== */

  _sanitizeMetadata(
    metadata,
  ) {
    if (
      !metadata
      || typeof metadata !== 'object'
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
        'signature',
        'signatureSecret',
        'webhookSecret',
        'rawBody',
        'rawAuthorizationHeader',
      ]);

    return redactObject(
      metadata,
      sensitiveKeys,
    );
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

            provider:
              this.id,

            ...this._sanitizeMetadata(
              metadata,
            ),
          },
        );
      }
    } catch (_loggingError) {
      // Logging must never mask provider errors.
    }
  }

  /* ==========================================================================
   * Provider Contract Verification
   * ======================================================================== */

  /**
   * Validate a concrete provider implementation at startup.
   *
   * This is designed to fail fast rather than discovering an incomplete
   * provider contract during a production payment.
   */
  validateImplementation() {
    const errors = [];

    if (
      this.supports(
        PROVIDER_CAPABILITIES
          .INITIATE_PAYMENT,
      )
      &&
      this[
        '_initiatePayment'
      ] ===
        PaymentProviderInterface
          .prototype
          ._initiatePayment
    ) {
      errors.push(
        'initiatePayment capability is enabled but _initiatePayment is not implemented.',
      );
    }

    if (
      this.supports(
        PROVIDER_CAPABILITIES
          .GET_PAYMENT_STATUS,
      )
      &&
      this[
        '_getPaymentStatus'
      ] ===
        PaymentProviderInterface
          .prototype
          ._getPaymentStatus
    ) {
      errors.push(
        'getPaymentStatus capability is enabled but _getPaymentStatus is not implemented.',
      );
    }

    if (
      this.supports(
        PROVIDER_CAPABILITIES
          .CANCEL_PAYMENT,
      )
      &&
      this[
        '_cancelPayment'
      ] ===
        PaymentProviderInterface
          .prototype
          ._cancelPayment
    ) {
      errors.push(
        'cancelPayment capability is enabled but _cancelPayment is not implemented.',
      );
    }

    if (
      this.supports(
        PROVIDER_CAPABILITIES
          .REVERSE_PAYMENT,
      )
      &&
      this[
        '_reversePayment'
      ] ===
        PaymentProviderInterface
          .prototype
          ._reversePayment
    ) {
      errors.push(
        'reversePayment capability is enabled but _reversePayment is not implemented.',
      );
    }

    if (
      this.supports(
        PROVIDER_CAPABILITIES
          .REFUND_PAYMENT,
      )
      &&
      this[
        '_refundPayment'
      ] ===
        PaymentProviderInterface
          .prototype
          ._refundPayment
    ) {
      errors.push(
        'refundPayment capability is enabled but _refundPayment is not implemented.',
      );
    }

    if (
      this.supports(
        PROVIDER_CAPABILITIES
          .HEALTH_CHECK,
      )
      &&
      this[
        '_healthCheck'
      ] ===
        PaymentProviderInterface
          .prototype
          ._healthCheck
    ) {
      errors.push(
        'healthCheck capability is enabled but _healthCheck is not implemented.',
      );
    }

    return {
      valid:
        errors.length === 0,

      provider:
        this.id,

      name:
        this.name,

      errors,
    };
  }
}

/* ============================================================================
 * Provider Adapter Base Class
 * ========================================================================== */

/**
 * Alias that communicates the architectural intent more clearly to concrete
 * adapter implementations.
 */
class PaymentProviderAdapter
  extends PaymentProviderInterface {}

/* ============================================================================
 * Static Metadata
 * ========================================================================== */

PaymentProviderInterface.OPERATIONS =
  PROVIDER_OPERATION_TYPES;

PaymentProviderInterface.OUTCOMES =
  PROVIDER_OUTCOMES;

PaymentProviderInterface.ERROR_CATEGORIES =
  PROVIDER_ERROR_CATEGORIES;

PaymentProviderInterface.CAPABILITIES =
  PROVIDER_CAPABILITIES;

PaymentProviderInterface.ERROR_CODES =
  PROVIDER_INTERFACE_ERROR_CODES;

PaymentProviderInterface.Error =
  ProviderInterfaceError;

PaymentProviderInterface.normalizePaymentRequest =
  normalizePaymentRequest;

PaymentProviderInterface.normalizeOutcome =
  normalizeOutcome;

PaymentProviderInterface.canonicalAmount =
  canonicalAmount;

PaymentProviderInterface.canonicalCurrency =
  canonicalCurrency;

/* ============================================================================
 * Factory
 * ========================================================================== */

function createPaymentProviderInterface(
  config = {},
) {
  return new PaymentProviderInterface(
    config,
  );
}

function createPaymentProviderAdapter(
  config = {},
) {
  return new PaymentProviderAdapter(
    config,
  );
}

/* ============================================================================
 * Exports
 * ========================================================================== */

module.exports =
  PaymentProviderInterface;

module.exports.PaymentProviderInterface =
  PaymentProviderInterface;

module.exports.PaymentProviderAdapter =
  PaymentProviderAdapter;

module.exports.ProviderInterfaceError =
  ProviderInterfaceError;

module.exports.createPaymentProviderInterface =
  createPaymentProviderInterface;

module.exports.createPaymentProviderAdapter =
  createPaymentProviderAdapter;

module.exports.PROVIDER_OPERATION_TYPES =
  PROVIDER_OPERATION_TYPES;

module.exports.PROVIDER_OUTCOMES =
  PROVIDER_OUTCOMES;

module.exports.PROVIDER_ERROR_CATEGORIES =
  PROVIDER_ERROR_CATEGORIES;

module.exports.PROVIDER_CAPABILITIES =
  PROVIDER_CAPABILITIES;

module.exports.PROVIDER_INTERFACE_ERROR_CODES =
  PROVIDER_INTERFACE_ERROR_CODES;

/* ============================================================================
 * End of File
 * ============================================================================
 */