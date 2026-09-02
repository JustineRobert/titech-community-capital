'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise MTN MoMo Callback Errors
 * ============================================================================
 *
 * File:
 * backend/modules/payment/mtn/callbacks/mtnCallbackErrors.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Shared error hierarchy for the MTN callback pipeline.
 *
 * Callback lifecycle:
 *
 *   RECEIVE
 *      ↓
 *   VALIDATE
 *      ↓
 *   VERIFY
 *      ↓
 *   IDEMPOTENCY
 *      ↓
 *   PROCESS
 *      ↓
 *   COMPLETE / RETRY / DLQ
 *
 * Design Goals
 * ----------------------------------------------------------------------------
 * - Stable machine-readable error codes
 * - Explicit error classification
 * - Retry semantics
 * - DLQ semantics
 * - HTTP status mapping
 * - Tenant context
 * - Request/correlation context
 * - Provider reference context
 * - Safe cause preservation
 * - Safe serialization
 * - Operational fingerprinting
 *
 * Explicitly NOT Responsible For
 * ----------------------------------------------------------------------------
 * - Logging
 * - Metrics
 * - Callback execution
 * - Signature verification
 * - Ledger posting
 * - Queue scheduling
 *
 * ============================================================================
 */

const crypto = require('crypto');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const DEFAULT_CODE =
  'MTN_CALLBACK_ERROR';

const DEFAULT_MESSAGE =
  'MTN callback processing error';

const DEFAULT_STATUS_CODE =
  500;

const MAX_CODE_LENGTH =
  128;

const MAX_MESSAGE_LENGTH =
  2000;

const MAX_REFERENCE_LENGTH =
  256;

const MAX_PROVIDER_REFERENCE_LENGTH =
  256;

const MAX_CALLBACK_ID_LENGTH =
  256;

const MAX_TENANT_ID_LENGTH =
  256;

const MAX_REQUEST_ID_LENGTH =
  256;

const MAX_CORRELATION_ID_LENGTH =
  256;

const MAX_OPERATION_LENGTH =
  128;

const MAX_STAGE_LENGTH =
  128;

/**
 * ============================================================================
 * Error Categories
 * ============================================================================
 */

const MTN_CALLBACK_ERROR_CATEGORY =
  Object.freeze({

    VALIDATION:
      'VALIDATION',

    SIGNATURE:
      'SIGNATURE',

    AUTHENTICATION:
      'AUTHENTICATION',

    IDEMPOTENCY:
      'IDEMPOTENCY',

    CONFLICT:
      'CONFLICT',

    CORRELATION:
      'CORRELATION',

    PROCESSING:
      'PROCESSING',

    PROVIDER:
      'PROVIDER',

    NETWORK:
      'NETWORK',

    TIMEOUT:
      'TIMEOUT',

    STATE:
      'STATE',

    CONFIGURATION:
      'CONFIGURATION',

    DEAD_LETTER:
      'DEAD_LETTER',

    INTERNAL:
      'INTERNAL',

  });

/**
 * ============================================================================
 * Helpers
 * ============================================================================
 */

function normalizeString(
  value,
  fallback = null,
  maxLength = MAX_MESSAGE_LENGTH
) {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  const normalized =
    String(value).trim();

  if (
    normalized.length === 0
  ) {
    return fallback;
  }

  return normalized.slice(
    0,
    maxLength
  );
}

function normalizeStatusCode(
  value,
  fallback = DEFAULT_STATUS_CODE
) {
  const status =
    Number(value);

  if (
    !Number.isInteger(status) ||
    status < 100 ||
    status > 599
  ) {
    return fallback;
  }

  return status;
}

function normalizeCategory(
  category
) {
  const value =
    normalizeString(
      category,
      MTN_CALLBACK_ERROR_CATEGORY.INTERNAL,
      64
    )?.toUpperCase();

  if (
    Object.values(
      MTN_CALLBACK_ERROR_CATEGORY
    ).includes(value)
  ) {
    return value;
  }

  return MTN_CALLBACK_ERROR_CATEGORY.INTERNAL;
}

function stableSerialize(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return JSON.stringify(value);
  }

  if (
    value instanceof Date
  ) {
    return JSON.stringify(
      value.toISOString()
    );
  }

  if (
    Array.isArray(value)
  ) {
    return `[${value
      .map(stableSerialize)
      .join(',')}]`;
  }

  if (
    typeof value === 'object'
  ) {
    return `{${Object.keys(value)
      .sort()
      .map(
        key =>
          `${JSON.stringify(key)}:${stableSerialize(
            value[key]
          )}`
      )
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function createFingerprint(
  error
) {
  return crypto
    .createHash('sha256')
    .update(
      stableSerialize({
        code:
          error.code,

        category:
          error.category,

        stage:
          error.stage,

        providerCode:
          error.providerCode,

        operation:
          error.operation,
      }),
      'utf8'
    )
    .digest('hex');
}

function safeCause(
  cause
) {
  if (
    !cause
  ) {
    return undefined;
  }

  return {
    name:
      normalizeString(
        cause.name,
        'Error',
        128
      ),

    message:
      normalizeString(
        cause.message,
        'Unknown error',
        MAX_MESSAGE_LENGTH
      ),

    code:
      normalizeString(
        cause.code,
        null,
        MAX_CODE_LENGTH
      ),
  };
}

/**
 * ============================================================================
 * Base Error
 * ============================================================================
 */

class MTNCallbackError
  extends Error {

  constructor(
    message,
    options = {}
  ) {
    super(
      normalizeString(
        message,
        DEFAULT_MESSAGE,
        MAX_MESSAGE_LENGTH
      )
    );

    this.name =
      'MTNCallbackError';

    this.code =
      normalizeString(
        options.code,
        DEFAULT_CODE,
        MAX_CODE_LENGTH
      );

    this.category =
      normalizeCategory(
        options.category
      );

    this.statusCode =
      normalizeStatusCode(
        options.statusCode
      );

    this.retryable =
      typeof options.retryable ===
        'boolean'
        ? options.retryable
        : false;

    this.dlq =
      typeof options.dlq ===
        'boolean'
        ? options.dlq
        : false;

    this.reference =
      normalizeString(
        options.reference,
        null,
        MAX_REFERENCE_LENGTH
      );

    this.providerReference =
      normalizeString(
        options.providerReference,
        null,
        MAX_PROVIDER_REFERENCE_LENGTH
      );

    this.callbackId =
      normalizeString(
        options.callbackId,
        null,
        MAX_CALLBACK_ID_LENGTH
      );

    this.tenantId =
      normalizeString(
        options.tenantId,
        null,
        MAX_TENANT_ID_LENGTH
      );

    this.requestId =
      normalizeString(
        options.requestId,
        null,
        MAX_REQUEST_ID_LENGTH
      );

    this.correlationId =
      normalizeString(
        options.correlationId,
        null,
        MAX_CORRELATION_ID_LENGTH
      );

    this.operation =
      normalizeString(
        options.operation,
        null,
        MAX_OPERATION_LENGTH
      );

    this.stage =
      normalizeString(
        options.stage,
        null,
        MAX_STAGE_LENGTH
      );

    this.providerCode =
      normalizeString(
        options.providerCode,
        null,
        256
      );

    this.providerMessage =
      normalizeString(
        options.providerMessage,
        null,
        MAX_MESSAGE_LENGTH
      );

    this.providerRequestId =
      normalizeString(
        options.providerRequestId,
        null,
        MAX_REQUEST_ID_LENGTH
      );

    this.attempt =
      Number.isSafeInteger(
        Number(options.attempt)
      ) &&
      Number(options.attempt) >= 1
        ? Number(options.attempt)
        : null;

    this.retryAfterMs =
      Number.isFinite(
        Number(
          options.retryAfterMs
        )
      ) &&
      Number(
        options.retryAfterMs
      ) >= 0
        ? Number(
            options.retryAfterMs
          )
        : null;

    this.timestamp =
      new Date();

    this.cause =
      options.cause;

    this.fingerprint =
      createFingerprint(
        this
      );

    Error.captureStackTrace?.(
      this,
      MTNCallbackError
    );
  }

  /**
   * --------------------------------------------------------------------------
   * Retry classification
   * --------------------------------------------------------------------------
   */

  isRetryable() {
    return (
      this.retryable === true
    );
  }

  /**
   * --------------------------------------------------------------------------
   * Dead-letter classification
   * --------------------------------------------------------------------------
   */

  shouldDeadLetter() {
    return (
      this.dlq === true
    );
  }

  /**
   * --------------------------------------------------------------------------
   * Retry headers / scheduling hints
   * --------------------------------------------------------------------------
   */

  getRetryMetadata() {
    if (
      !this.isRetryable()
    ) {
      return {};
    }

    if (
      this.retryAfterMs ===
        null
    ) {
      return {};
    }

    return {
      retryAfterMs:
        this.retryAfterMs,

      retryAfterSeconds:
        Math.ceil(
          this.retryAfterMs /
            1000
        ),
    };
  }

  /**
   * --------------------------------------------------------------------------
   * Safe JSON representation
   * --------------------------------------------------------------------------
   */

  toJSON() {
    return {
      name:
        this.name,

      code:
        this.code,

      category:
        this.category,

      message:
        this.message,

      statusCode:
        this.statusCode,

      retryable:
        this.retryable,

      dlq:
        this.dlq,

      reference:
        this.reference,

      providerReference:
        this.providerReference,

      callbackId:
        this.callbackId,

      tenantId:
        this.tenantId,

      requestId:
        this.requestId,

      correlationId:
        this.correlationId,

      operation:
        this.operation,

      stage:
        this.stage,

      providerCode:
        this.providerCode,

      providerMessage:
        this.providerMessage,

      providerRequestId:
        this.providerRequestId,

      attempt:
        this.attempt,

      retryAfterMs:
        this.retryAfterMs,

      fingerprint:
        this.fingerprint,

      timestamp:
        new Date(
          this.timestamp.getTime()
        ),

      cause:
        safeCause(
          this.cause
        ),
    };
  }

  /**
   * --------------------------------------------------------------------------
   * Operational representation
   * --------------------------------------------------------------------------
   */

  toOperationalError() {
    return {
      code:
        this.code,

      category:
        this.category,

      message:
        this.message,

      statusCode:
        this.statusCode,

      retryable:
        this.retryable,

      dlq:
        this.dlq,

      callbackId:
        this.callbackId,

      tenantId:
        this.tenantId,

      requestId:
        this.requestId,

      correlationId:
        this.correlationId,

      operation:
        this.operation,

      stage:
        this.stage,

      providerCode:
        this.providerCode,

      providerRequestId:
        this.providerRequestId,

      attempt:
        this.attempt,

      fingerprint:
        this.fingerprint,
    };
  }

  /**
   * --------------------------------------------------------------------------
   * API-safe representation
   * --------------------------------------------------------------------------
   *
   * Deliberately excludes:
   * - provider internals
   * - provider messages
   * - cause
   * - retry implementation details
   */

  toApiResponse() {
    return {
      success:
        false,

      code:
        this.code,

      message:
        this.message,

      retryable:
        this.retryable,

      requestId:
        this.requestId,

      correlationId:
        this.correlationId,
    };
  }

  /**
   * --------------------------------------------------------------------------
   * Wrap arbitrary error
   * --------------------------------------------------------------------------
   */

  static from(
    error,
    options = {}
  ) {
    if (
      error instanceof
      MTNCallbackError
    ) {
      return error;
    }

    return new MTNCallbackProcessingError(
      options.message ||
        error?.message ||
        DEFAULT_MESSAGE,
      {
        ...options,

        code:
          options.code ||
          error?.code ||
          'MTN_CALLBACK_PROCESSING_ERROR',

        category:
          options.category ||
          MTN_CALLBACK_ERROR_CATEGORY.INTERNAL,

        cause:
          error,

        retryable:
          options.retryable !== undefined
            ? options.retryable
            : Boolean(
                error?.retryable
              ),
      }
    );
  }

  /**
   * --------------------------------------------------------------------------
   * Validation
   * --------------------------------------------------------------------------
   */

  static validation(
    message,
    options = {}
  ) {
    return new MTNCallbackValidationError(
      message,
      options
    );
  }

  /**
   * --------------------------------------------------------------------------
   * Signature
   * --------------------------------------------------------------------------
   */

  static signature(
    message,
    options = {}
  ) {
    return new MTNCallbackSignatureError(
      message,
      options
    );
  }

  /**
   * --------------------------------------------------------------------------
   * Idempotency
   * --------------------------------------------------------------------------
   */

  static idempotency(
    message,
    options = {}
  ) {
    return new MTNCallbackIdempotencyError(
      message,
      options
    );
  }

  /**
   * --------------------------------------------------------------------------
   * Correlation
   * --------------------------------------------------------------------------
   */

  static correlation(
    message,
    options = {}
  ) {
    return new MTNCallbackCorrelationError(
      message,
      options
    );
  }

  /**
   * --------------------------------------------------------------------------
   * State
   * --------------------------------------------------------------------------
   */

  static state(
    message,
    options = {}
  ) {
    return new MTNCallbackStateError(
      message,
      options
    );
  }

  /**
   * --------------------------------------------------------------------------
   * Processing
   * --------------------------------------------------------------------------
   */

  static processing(
    message,
    options = {}
  ) {
    return new MTNCallbackProcessingError(
      message,
      options
    );
  }

  /**
   * --------------------------------------------------------------------------
   * Dead letter
   * --------------------------------------------------------------------------
   */

  static deadLetter(
    message,
    options = {}
  ) {
    return new MTNCallbackDeadLetterError(
      message,
      options
    );
  }
}

/**
 * ============================================================================
 * Validation Error
 * ============================================================================
 */

class MTNCallbackValidationError
  extends MTNCallbackError {

  constructor(
    message,
    options = {}
  ) {
    super(
      message,
      {
        ...options,

        code:
          options.code ||
          'MTN_CALLBACK_VALIDATION_ERROR',

        category:
          MTN_CALLBACK_ERROR_CATEGORY.VALIDATION,

        statusCode:
          options.statusCode ??
          400,

        retryable:
          false,

        dlq:
          false,
      }
    );

    this.name =
      'MTNCallbackValidationError';
  }
}

/**
 * ============================================================================
 * Signature Error
 * ============================================================================
 */

class MTNCallbackSignatureError
  extends MTNCallbackError {

  constructor(
    message,
    options = {}
  ) {
    super(
      message,
      {
        ...options,

        code:
          options.code ||
          'MTN_CALLBACK_SIGNATURE_INVALID',

        category:
          MTN_CALLBACK_ERROR_CATEGORY.SIGNATURE,

        statusCode:
          options.statusCode ??
          401,

        retryable:
          false,

        dlq:
          false,
      }
    );

    this.name =
      'MTNCallbackSignatureError';
  }
}

/**
 * ============================================================================
 * Duplicate Error
 * ============================================================================
 */

class MTNCallbackDuplicateError
  extends MTNCallbackError {

  constructor(
    message,
    options = {}
  ) {
    super(
      message,
      {
        ...options,

        code:
          options.code ||
          'MTN_CALLBACK_DUPLICATE',

        category:
          MTN_CALLBACK_ERROR_CATEGORY.IDEMPOTENCY,

        statusCode:
          options.statusCode ??
          409,

        retryable:
          false,

        dlq:
          false,
      }
    );

    this.name =
      'MTNCallbackDuplicateError';
  }
}

/**
 * ============================================================================
 * Idempotency Error
 * ============================================================================
 */

class MTNCallbackIdempotencyError
  extends MTNCallbackError {

  constructor(
    message,
    options = {}
  ) {
    super(
      message,
      {
        ...options,

        code:
          options.code ||
          'MTN_CALLBACK_IDEMPOTENCY_ERROR',

        category:
          MTN_CALLBACK_ERROR_CATEGORY.IDEMPOTENCY,

        statusCode:
          options.statusCode ??
          409,

        retryable:
          options.retryable !== undefined
            ? options.retryable
            : true,

        dlq:
          false,
      }
    );

    this.name =
      'MTNCallbackIdempotencyError';
  }
}

/**
 * ============================================================================
 * Correlation Error
 * ============================================================================
 */

class MTNCallbackCorrelationError
  extends MTNCallbackError {

  constructor(
    message,
    options = {}
  ) {
    super(
      message,
      {
        ...options,

        code:
          options.code ||
          'MTN_CALLBACK_CORRELATION_ERROR',

        category:
          MTN_CALLBACK_ERROR_CATEGORY.CORRELATION,

        statusCode:
          options.statusCode ??
          409,

        retryable:
          false,

        dlq:
          options.dlq !== undefined
            ? options.dlq
            : true,
      }
    );

    this.name =
      'MTNCallbackCorrelationError';
  }
}

/**
 * ============================================================================
 * State Error
 * ============================================================================
 */

class MTNCallbackStateError
  extends MTNCallbackError {

  constructor(
    message,
    options = {}
  ) {
    super(
      message,
      {
        ...options,

        code:
          options.code ||
          'MTN_CALLBACK_STATE_ERROR',

        category:
          MTN_CALLBACK_ERROR_CATEGORY.STATE,

        statusCode:
          options.statusCode ??
          409,

        retryable:
          options.retryable !== undefined
            ? options.retryable
            : true,

        dlq:
          false,
      }
    );

    this.name =
      'MTNCallbackStateError';
  }
}

/**
 * ============================================================================
 * Processing Error
 * ============================================================================
 */

class MTNCallbackProcessingError
  extends MTNCallbackError {

  constructor(
    message,
    options = {}
  ) {
    super(
      message,
      {
        ...options,

        code:
          options.code ||
          'MTN_CALLBACK_PROCESSING_ERROR',

        category:
          options.category ||
          MTN_CALLBACK_ERROR_CATEGORY.PROCESSING,

        statusCode:
          options.statusCode ??
          500,

        retryable:
          options.retryable !== undefined
            ? options.retryable
            : true,

        dlq:
          options.dlq !== undefined
            ? options.dlq
            : false,
      }
    );

    this.name =
      'MTNCallbackProcessingError';
  }
}

/**
 * ============================================================================
 * Provider Error
 * ============================================================================
 */

class MTNCallbackProviderError
  extends MTNCallbackError {

  constructor(
    message,
    options = {}
  ) {
    super(
      message,
      {
        ...options,

        code:
          options.code ||
          'MTN_CALLBACK_PROVIDER_ERROR',

        category:
          MTN_CALLBACK_ERROR_CATEGORY.PROVIDER,

        statusCode:
          options.statusCode ??
          502,

        retryable:
          options.retryable !== undefined
            ? options.retryable
            : true,

        dlq:
          false,
      }
    );

    this.name =
      'MTNCallbackProviderError';
  }
}

/**
 * ============================================================================
 * Dead Letter Error
 * ============================================================================
 */

class MTNCallbackDeadLetterError
  extends MTNCallbackError {

  constructor(
    message,
    options = {}
  ) {
    super(
      message,
      {
        ...options,

        code:
          options.code ||
          'MTN_CALLBACK_DLQ_ERROR',

        category:
          MTN_CALLBACK_ERROR_CATEGORY.DEAD_LETTER,

        statusCode:
          options.statusCode ??
          500,

        retryable:
          false,

        dlq:
          true,
      }
    );

    this.name =
      'MTNCallbackDeadLetterError';
  }
}

/**
 * ============================================================================
 * Configuration Error
 * ============================================================================
 */

class MTNCallbackConfigurationError
  extends MTNCallbackError {

  constructor(
    message,
    options = {}
  ) {
    super(
      message,
      {
        ...options,

        code:
          options.code ||
          'MTN_CALLBACK_CONFIGURATION_ERROR',

        category:
          MTN_CALLBACK_ERROR_CATEGORY.CONFIGURATION,

        statusCode:
          options.statusCode ??
          500,

        retryable:
          false,

        dlq:
          false,
      }
    );

    this.name =
      'MTNCallbackConfigurationError';
  }
}

/**
 * ============================================================================
 * Static Constants
 * ============================================================================
 */

MTNCallbackError.CATEGORY =
  MTN_CALLBACK_ERROR_CATEGORY;

MTNCallbackError.CATEGORIES =
  MTN_CALLBACK_ERROR_CATEGORY;

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = {

  MTNCallbackError,

  MTNCallbackValidationError,

  MTNCallbackSignatureError,

  MTNCallbackDuplicateError,

  MTNCallbackIdempotencyError,

  MTNCallbackCorrelationError,

  MTNCallbackStateError,

  MTNCallbackProcessingError,

  MTNCallbackProviderError,

  MTNCallbackDeadLetterError,

  MTNCallbackConfigurationError,

  MTNCallbackErrorCategory:
    MTN_CALLBACK_ERROR_CATEGORY,

  MTN_CALLBACK_ERROR_CATEGORY,

};