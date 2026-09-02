'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Airtel Money Callback Handler
 * ============================================================================
 *
 * File:
 *   backend/modules/payment/providers/airtel/airtelCallbackHandler.js
 *
 * Purpose
 * -------
 * Production-grade Airtel Money callback/webhook adapter for receiving,
 * validating, normalizing, deduplicating, and handing Airtel provider events
 * into the canonical payment callback processing pipeline.
 *
 * ARCHITECTURAL BOUNDARY
 * ----------------------
 *
 *   Airtel Money
 *       |
 *       v
 *   HTTP Route / Controller
 *       |
 *       v
 *   AirtelCallbackHandler
 *       |
 *       +--> Raw body capture
 *       +--> Signature verification
 *       +--> Callback validation
 *       +--> Callback normalization
 *       +--> Tenant resolution
 *       +--> Replay / idempotency protection
 *       +--> Durable callback receipt
 *       +--> CallbackProcessingEngine
 *       |
 *       v
 *   Payment State Machine
 *       |
 *       +--> Payment Verification
 *       +--> Golden Money Path
 *       +--> Financial Posting
 *       +--> Settlement
 *       +--> Reconciliation
 *       +--> Events / Outbox
 *
 * IMPORTANT
 * ---------
 * This module must NEVER:
 *
 *   - mutate customer balances directly
 *   - post ledger entries directly
 *   - create financial transactions directly
 *   - assume callback "success" means ledger posting succeeded
 *   - bypass payment state-machine validation
 *   - retry an unknown external operation with a new identity
 *   - trust provider callback data as ledger authority
 *
 * SECURITY MODEL
 * -------------
 * 1. Signature verification occurs before business processing.
 * 2. Raw body is preserved where cryptographic verification requires it.
 * 3. Callback identity is deterministic.
 * 4. Duplicate callbacks are expected and safe.
 * 5. Callback order is not assumed.
 * 6. Unknown external outcomes remain UNKNOWN/reconciliation-required.
 * 7. Sensitive callback data is never logged or exposed unnecessarily.
 * 8. Tenant isolation is enforced.
 * 9. Provider references remain correlation anchors.
 * 10. Financial effects remain owned by downstream authoritative services.
 *
 * DEPENDENCY CONTRACTS
 * --------------------
 * Supported adapters/services:
 *
 *   callbackValidator
 *     validate(...)
 *     validateCallback(...)
 *     validateSignature(...)
 *
 *   callbackNormalizer
 *     normalize(...)
 *     transform(...)
 *
 *   callbackProcessingEngine
 *     process(...)
 *     processCallback(...)
 *     handle(...)
 *
 *   callbackRegistry
 *     record(...)
 *     register(...)
 *     create(...)
 *     markProcessed(...)
 *     update(...)
 *
 *   idempotencyService
 *     reserve(...)
 *     complete(...)
 *     fail(...)
 *     markUnknown(...)
 *
 *   signatureVerifier
 *     verify(...)
 *     validate(...)
 *     verifySignature(...)
 *
 *   tenantResolver
 *     resolve(...)
 *     resolveTenant(...)
 *
 *   eventPublisher
 *     publish(...)
 *     publishEvent(...)
 *     emit(...)
 *
 * ============================================================================
 */

const crypto = require('crypto');

/* ============================================================================
 * Constants
 * ========================================================================== */

const AIRTEL_PROVIDER = 'airtel';

const CALLBACK_STATES = Object.freeze({
  RECEIVED:
    'RECEIVED',

  VALIDATED:
    'VALIDATED',

  NORMALIZED:
    'NORMALIZED',

  PROCESSING:
    'PROCESSING',

  PROCESSED:
    'PROCESSED',

  DUPLICATE:
    'DUPLICATE',

  REJECTED:
    'REJECTED',

  UNKNOWN:
    'UNKNOWN',

  FAILED:
    'FAILED',

  REQUIRES_RECONCILIATION:
    'REQUIRES_RECONCILIATION',
});

const CALLBACK_OUTCOMES = Object.freeze({
  SUCCESS:
    'SUCCESS',

  PENDING:
    'PENDING',

  FAILED:
    'FAILED',

  CANCELLED:
    'CANCELLED',

  REVERSED:
    'REVERSED',

  UNKNOWN:
    'UNKNOWN',

  DUPLICATE:
    'DUPLICATE',

  REQUIRES_RECONCILIATION:
    'REQUIRES_RECONCILIATION',
});

const CALLBACK_ERROR_CODES = Object.freeze({
  INVALID_REQUEST:
    'AIRTEL_CALLBACK_INVALID_REQUEST',

  INVALID_CONTENT_TYPE:
    'AIRTEL_CALLBACK_INVALID_CONTENT_TYPE',

  EMPTY_PAYLOAD:
    'AIRTEL_CALLBACK_EMPTY_PAYLOAD',

  INVALID_JSON:
    'AIRTEL_CALLBACK_INVALID_JSON',

  SIGNATURE_REQUIRED:
    'AIRTEL_CALLBACK_SIGNATURE_REQUIRED',

  SIGNATURE_INVALID:
    'AIRTEL_CALLBACK_SIGNATURE_INVALID',

  SIGNATURE_VALIDATION_UNAVAILABLE:
    'AIRTEL_CALLBACK_SIGNATURE_VALIDATION_UNAVAILABLE',

  VALIDATION_FAILED:
    'AIRTEL_CALLBACK_VALIDATION_FAILED',

  NORMALIZATION_FAILED:
    'AIRTEL_CALLBACK_NORMALIZATION_FAILED',

  CALLBACK_ID_REQUIRED:
    'AIRTEL_CALLBACK_ID_REQUIRED',

  PROVIDER_TRANSACTION_ID_REQUIRED:
    'AIRTEL_CALLBACK_PROVIDER_TRANSACTION_ID_REQUIRED',

  PAYMENT_REFERENCE_REQUIRED:
    'AIRTEL_CALLBACK_PAYMENT_REFERENCE_REQUIRED',

  IDEMPOTENCY_REQUIRED:
    'AIRTEL_CALLBACK_IDEMPOTENCY_REQUIRED',

  DUPLICATE_CALLBACK:
    'AIRTEL_CALLBACK_DUPLICATE',

  CALLBACK_REPLAY:
    'AIRTEL_CALLBACK_REPLAY',

  PAYMENT_NOT_FOUND:
    'AIRTEL_CALLBACK_PAYMENT_NOT_FOUND',

  PROCESSING_FAILED:
    'AIRTEL_CALLBACK_PROCESSING_FAILED',

  UNKNOWN_OUTCOME:
    'AIRTEL_CALLBACK_UNKNOWN_OUTCOME',

  RECONCILIATION_REQUIRED:
    'AIRTEL_CALLBACK_RECONCILIATION_REQUIRED',

  TENANT_REQUIRED:
    'AIRTEL_CALLBACK_TENANT_REQUIRED',

  PROVIDER_MISMATCH:
    'AIRTEL_CALLBACK_PROVIDER_MISMATCH',

  AMOUNT_MISMATCH:
    'AIRTEL_CALLBACK_AMOUNT_MISMATCH',

  CURRENCY_MISMATCH:
    'AIRTEL_CALLBACK_CURRENCY_MISMATCH',

  STORAGE_UNAVAILABLE:
    'AIRTEL_CALLBACK_STORAGE_UNAVAILABLE',

  CONFIGURATION_ERROR:
    'AIRTEL_CALLBACK_CONFIGURATION_ERROR',

  CALLBACK_TIMESTAMP_INVALID:
    'AIRTEL_CALLBACK_TIMESTAMP_INVALID',
});

const IDEMPOTENCY_OPERATION =
  'PAYMENT_CALLBACK';

const DEFAULT_OPTIONS = Object.freeze({
  strictMode:
    true,

  requireRawBodyForSignature:
    true,

  requireSignature:
    true,

  requireCallbackId:
    true,

  requireProviderTransactionId:
    true,

  requirePaymentReference:
    false,

  requireTenant:
    true,

  allowUnknownPayment:
    false,

  processDuplicateCallbacks:
    false,

  persistRawPayload:
    false,

  includeRawPayloadInResult:
    false,

  maxPayloadBytes:
    1024 * 1024,

  maxMetadataDepth:
    8,

  maxMetadataKeys:
    100,

  maxMetadataStringLength:
    5000,

  callbackTimeoutMs:
    15000,

  requireProcessingEngine:
    true,

  allowOutOfOrderCallbacks:
    true,

  enableReconciliation:
    true,

  acknowledgeAfterDurableAcceptance:
    true,

  publishEvents:
    true,

  failOnEventPublicationError:
    false,

  /**
   * Airtel callback implementations can expose timestamp headers. When
   * present, they may be validated by the configured verifier.
   */
  validateSignatureTimestamp:
    true,

  maxSignatureAgeSeconds:
    300,

  /**
   * Do not fail a provider callback solely because a non-authoritative
   * optional field is missing.
   */
  strictProviderSchema:
    false,
});

/* ============================================================================
 * Error
 * ========================================================================== */

class AirtelCallbackHandlerError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(message);

    this.name =
      'AirtelCallbackHandlerError';

    this.code =
      options.code ||
      CALLBACK_ERROR_CODES
        .INVALID_REQUEST;

    this.statusCode =
      Number.isInteger(
        options.statusCode,
      )
        ? options.statusCode
        : 400;

    this.provider =
      AIRTEL_PROVIDER;

    this.callbackId =
      options.callbackId ||
      null;

    this.paymentId =
      options.paymentId ||
      null;

    this.paymentReference =
      options.paymentReference ||
      null;

    this.providerTransactionId =
      options.providerTransactionId ||
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
      options.unknownOutcome ===
      true;

    this.reconciliationRequired =
      options.reconciliationRequired ===
      true;

    this.details =
      options.details ||
      {};

    if (
      options.cause
    ) {
      this.cause =
        options.cause;
    }

    Error.captureStackTrace?.(
      this,
      AirtelCallbackHandlerError,
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
  return isNonEmptyString(
    value,
  )
    ? value.trim()
    : null;
}

function normalizeStatus(
  value,
) {
  const status =
    normalizeString(
      value,
    );

  return status
    ? status.toUpperCase()
    : null;
}

function normalizeCurrency(
  value,
) {
  const currency =
    normalizeString(
      value,
    );

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
    typeof value.toString ===
      'function'
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
    typeof value.toString ===
      'function'
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
      JSON.stringify(
        value,
      ),
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
      typeof value ===
        'string'
        ? value
        : JSON.stringify(
            value,
          ),
    )
    .digest('hex');
}

function hmacSha256(
  secret,
  payload,
) {
  return crypto
    .createHmac(
      'sha256',
      secret,
    )
    .update(
      payload,
    )
    .digest('hex');
}

function timingSafeEqualString(
  a,
  b,
) {
  if (
    !isNonEmptyString(a) ||
    !isNonEmptyString(b)
  ) {
    return false;
  }

  const left =
    Buffer.from(
      a,
      'utf8',
    );

  const right =
    Buffer.from(
      b,
      'utf8',
    );

  if (
    left.length !==
    right.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    left,
    right,
  );
}

function isoNow() {
  return new Date().toISOString();
}

function createOperationId() {
  return `airtel_cb_op_${crypto.randomUUID()}`;
}

function createCallbackFingerprint(
  input,
) {
  return sha256({
    provider:
      AIRTEL_PROVIDER,

    callbackId:
      input.callbackId ||
      null,

    providerTransactionId:
      input.providerTransactionId ||
      null,

    paymentReference:
      input.paymentReference ||
      null,

    status:
      input.status ||
      null,

    outcome:
      input.outcome ||
      null,

    amount:
      canonicalAmount(
        input.amount,
      ),

    currency:
      normalizeCurrency(
        input.currency,
      ),
  });
}

/* ============================================================================
 * Airtel Callback Handler
 * ========================================================================== */

class AirtelCallbackHandler {
  /**
   * @param {Object} dependencies
   */
  constructor(
    dependencies = {},
  ) {
    this.callbackValidator =
      dependencies.callbackValidator ||
      dependencies.validator ||
      null;

    this.callbackNormalizer =
      dependencies.callbackNormalizer ||
      dependencies.normalizer ||
      null;

    this.callbackProcessingEngine =
      dependencies.callbackProcessingEngine ||
      dependencies.processingEngine ||
      null;

    this.callbackRegistry =
      dependencies.callbackRegistry ||
      null;

    this.idempotencyService =
      dependencies.idempotencyService ||
      null;

    this.paymentRepository =
      dependencies.paymentRepository ||
      null;

    this.eventPublisher =
      dependencies.eventPublisher ||
      null;

    this.auditService =
      dependencies.auditService ||
      null;

    this.metrics =
      dependencies.metrics ||
      null;

    this.logger =
      dependencies.logger ||
      console;

    this.signatureVerifier =
      dependencies.signatureVerifier ||
      null;

    this.tenantResolver =
      dependencies.tenantResolver ||
      null;

    this.options =
      Object.freeze({
        ...DEFAULT_OPTIONS,
        ...(dependencies.options || {}),
      });
  }

  /* ==========================================================================
   * Public Entry Points
   * ======================================================================== */

  async handle(
    input,
    rawContext = {},
  ) {
    const request =
      this._normalizeIncomingRequest(
        input,
        rawContext,
      );

    const context =
      await this._buildContext(
        request,
      );

    this._metric(
      'airtel_callbacks_received_total',
      1,
    );

    let callback;

    try {
      callback =
        await this._acceptAndValidate(
          request,
          context,
        );
    } catch (error) {
      this._metric(
        'airtel_callbacks_rejected_total',
        1,
      );

      await this._recordAuditSafe(
        'AIRTEL_CALLBACK_REJECTED',
        {
          ...context,
          error:
            this._safeError(
              error,
            ),
        },
      );

      throw error instanceof
        AirtelCallbackHandlerError
        ? error
        : this._wrapError(
            error,
            CALLBACK_ERROR_CODES
              .VALIDATION_FAILED,
            context,
          );
    }

    const operation =
      await this._reserveCallbackIdempotency(
        callback,
        context,
      );

    if (
      operation.duplicate
      || operation.completed
    ) {
      this._metric(
        'airtel_callbacks_duplicate_total',
        1,
      );

      const duplicateResult =
        this._buildDuplicateResult(
          callback,
          operation,
          context,
        );

      await this._publishEventSafe(
        'PaymentProviderCallbackDuplicate',
        callback,
        duplicateResult,
        context,
      );

      return duplicateResult;
    }

    await this._persistCallbackReceipt(
      callback,
      operation,
      context,
    );

    await this._publishEventSafe(
      'PaymentProviderCallbackReceived',
      callback,
      operation,
      context,
    );

    let result;

    try {
      result =
        await this._processCallback(
          callback,
          operation,
          context,
        );
    } catch (error) {
      return this._handleProcessingFailure(
        callback,
        operation,
        context,
        error,
      );
    }

    return this._finalizeCallback(
      callback,
      operation,
      result,
      context,
    );
  }

  async process(
    input,
    context = {},
  ) {
    return this.handle(
      input,
      context,
    );
  }

  async handleHttp(
    req,
    res,
    next,
  ) {
    try {
      const result =
        await this.handle(
          req,
        );

      const statusCode =
        this._httpStatusForResult(
          result,
        );

      if (
        res &&
        typeof res.status ===
          'function'
      ) {
        return res
          .status(
            statusCode,
          )
          .json(
            this._buildHttpResponse(
              result,
            ),
          );
      }

      return result;
    } catch (error) {
      if (
        typeof next ===
        'function'
      ) {
        return next(
          error,
        );
      }

      throw error;
    }
  }

  /* ==========================================================================
   * Acceptance / Validation
   * ======================================================================== */

  async _acceptAndValidate(
    request,
    context,
  ) {
    this._validateIncomingRequest(
      request,
    );

    await this._verifySignature(
      request,
      context,
    );

    const validated =
      await this._runValidator(
        request,
        context,
      );

    const normalized =
      await this._runNormalizer(
        validated,
        request,
        context,
      );

    const callback =
      this._normalizeCallback(
        normalized,
        request,
        context,
      );

    this._validateCanonicalCallback(
      callback,
      context,
    );

    return callback;
  }

  _validateIncomingRequest(
    request,
  ) {
    if (
      !request ||
      typeof request !==
        'object'
    ) {
      throw new AirtelCallbackHandlerError(
        'Airtel callback request is required.',
        {
          code:
            CALLBACK_ERROR_CODES
              .INVALID_REQUEST,

          statusCode:
            400,
        },
      );
    }

    if (
      request.rawBody
      && Buffer.isBuffer(
        request.rawBody,
      )
      && request.rawBody.length >
        this.options
          .maxPayloadBytes
    ) {
      throw new AirtelCallbackHandlerError(
        'Airtel callback payload exceeds the configured size limit.',
        {
          code:
            CALLBACK_ERROR_CODES
              .INVALID_REQUEST,

          statusCode:
            413,
        },
      );
    }

    if (
      request.payload ===
        undefined ||
      request.payload ===
        null
    ) {
      throw new AirtelCallbackHandlerError(
        'Airtel callback payload is empty.',
        {
          code:
            CALLBACK_ERROR_CODES
              .EMPTY_PAYLOAD,

          statusCode:
            400,
        },
      );
    }
  }

  async _verifySignature(
    request,
    context,
  ) {
    if (
      !this.options.requireSignature
    ) {
      return {
        verified:
          false,

        skipped:
          true,
      };
    }

    if (
      !request.rawBody
      && this.options
        .requireRawBodyForSignature
    ) {
      throw new AirtelCallbackHandlerError(
        'Raw request body is required for Airtel callback signature verification.',
        {
          code:
            CALLBACK_ERROR_CODES
              .SIGNATURE_REQUIRED,

          statusCode:
            400,

          tenantId:
            context.tenantId ||
            null,
        },
      );
    }

    if (
      this.signatureVerifier
    ) {
      const result =
        await this._invokeSignatureVerifier(
          request,
          context,
        );

      if (
        result === false
        || result?.valid === false
      ) {
        throw new AirtelCallbackHandlerError(
          'Airtel callback signature verification failed.',
          {
            code:
              CALLBACK_ERROR_CODES
                .SIGNATURE_INVALID,

            statusCode:
              401,

            tenantId:
              context.tenantId ||
              null,
          },
        );
      }

      return {
        verified:
          true,
      };
    }

    if (
      this.callbackValidator
      && typeof this.callbackValidator
        .validateSignature ===
        'function'
    ) {
      const result =
        await this.callbackValidator
          .validateSignature(
            {
              provider:
                AIRTEL_PROVIDER,

              payload:
                request.payload,

              rawBody:
                request.rawBody,

              headers:
                request.headers,

              signature:
                request.signature,

              signatureTimestamp:
                request.signatureTimestamp,

              context,
            },
          );

      if (
        result === false
        || result?.valid === false
      ) {
        throw new AirtelCallbackHandlerError(
          'Airtel callback signature verification failed.',
          {
            code:
              CALLBACK_ERROR_CODES
                .SIGNATURE_INVALID,

            statusCode:
              401,

            tenantId:
              context.tenantId ||
              null,
          },
        );
      }

      return {
        verified:
          true,
      };
    }

    /**
     * Optional direct HMAC fallback.
     *
     * This is intentionally enabled only when explicitly configured.
     */
    const secret =
      normalizeString(
        request.signatureSecret,
      );

    if (
      secret
      && request.signature
    ) {
      const rawPayload =
        Buffer.isBuffer(
          request.rawBody,
        )
          ? request.rawBody
          : Buffer.from(
              String(
                request.rawBody,
              ),
              'utf8',
            );

      const expected =
        hmacSha256(
          secret,
          rawPayload,
        );

      const signature =
        request.signature
          .replace(
            /^sha256=/i,
            '',
          )
          .trim();

      if (
        timingSafeEqualString(
          expected,
          signature,
        )
      ) {
        return {
          verified:
            true,

          method:
            'HMAC_SHA256',
        };
      }
    }

    throw new AirtelCallbackHandlerError(
      'No Airtel callback signature verifier is configured.',
      {
        code:
          CALLBACK_ERROR_CODES
            .SIGNATURE_VALIDATION_UNAVAILABLE,

        statusCode:
          503,

        tenantId:
          context.tenantId ||
          null,
      },
    );
  }

  async _invokeSignatureVerifier(
    request,
    context,
  ) {
    const args = {
      provider:
        AIRTEL_PROVIDER,

      payload:
        request.payload,

      rawBody:
        request.rawBody,

      headers:
        request.headers,

      signature:
        request.signature,

      signatureTimestamp:
        request.signatureTimestamp,

      context,
    };

    const verifier =
      this.signatureVerifier;

    if (
      typeof verifier.verify ===
      'function'
    ) {
      return verifier.verify(
        args,
      );
    }

    if (
      typeof verifier.validate ===
      'function'
    ) {
      return verifier.validate(
        args,
      );
    }

    if (
      typeof verifier.verifySignature ===
      'function'
    ) {
      return verifier.verifySignature(
        args,
      );
    }

    throw new AirtelCallbackHandlerError(
      'Configured Airtel signature verifier does not expose a supported method.',
      {
        code:
          CALLBACK_ERROR_CODES
            .SIGNATURE_VALIDATION_UNAVAILABLE,

        statusCode:
          500,
      },
    );
  }

  /* ==========================================================================
   * Validator / Normalizer
   * ======================================================================== */

  async _runValidator(
    request,
    context,
  ) {
    if (
      !this.callbackValidator
    ) {
      if (
        this.options.strictMode
      ) {
        throw new AirtelCallbackHandlerError(
          'Airtel callback validator is not configured.',
          {
            code:
              CALLBACK_ERROR_CODES
                .CONFIGURATION_ERROR,

            statusCode:
              500,
          },
        );
      }

      return request.payload;
    }

    try {
      if (
        typeof this.callbackValidator
          .validate ===
        'function'
      ) {
        return await this.callbackValidator
          .validate(
            {
              provider:
                AIRTEL_PROVIDER,

              payload:
                request.payload,

              rawBody:
                request.rawBody,

              headers:
                request.headers,

              context,
            },
          );
      }

      if (
        typeof this.callbackValidator
          .validateCallback ===
        'function'
      ) {
        return await this.callbackValidator
          .validateCallback(
            {
              provider:
                AIRTEL_PROVIDER,

              payload:
                request.payload,

              rawBody:
                request.rawBody,

              headers:
                request.headers,

              context,
            },
          );
      }

      return request.payload;
    } catch (error) {
      throw new AirtelCallbackHandlerError(
        error?.message ||
          'Airtel callback validation failed.',
        {
          code:
            CALLBACK_ERROR_CODES
              .VALIDATION_FAILED,

          statusCode:
            Number(
              error?.statusCode,
            ) || 400,

          tenantId:
            context.tenantId ||
            null,

          cause:
            error,
        },
      );
    }
  }

  async _runNormalizer(
    validated,
    request,
    context,
  ) {
    if (
      !this.callbackNormalizer
    ) {
      if (
        this.options.strictMode
      ) {
        throw new AirtelCallbackHandlerError(
          'Airtel callback normalizer is not configured.',
          {
            code:
              CALLBACK_ERROR_CODES
                .CONFIGURATION_ERROR,

            statusCode:
              500,
          },
        );
      }

      return validated;
    }

    try {
      if (
        typeof this.callbackNormalizer
          .normalize ===
        'function'
      ) {
        return await this.callbackNormalizer
          .normalize(
            {
              provider:
                AIRTEL_PROVIDER,

              payload:
                validated,

              rawPayload:
                request.payload,

              rawBody:
                request.rawBody,

              headers:
                request.headers,

              context,
            },
          );
      }

      if (
        typeof this.callbackNormalizer
          .transform ===
        'function'
      ) {
        return await this.callbackNormalizer
          .transform(
            {
              provider:
                AIRTEL_PROVIDER,

              payload:
                validated,

              rawPayload:
                request.payload,

              rawBody:
                request.rawBody,

              headers:
                request.headers,

              context,
            },
          );
      }

      return validated;
    } catch (error) {
      throw new AirtelCallbackHandlerError(
        error?.message ||
          'Airtel callback normalization failed.',
        {
          code:
            CALLBACK_ERROR_CODES
              .NORMALIZATION_FAILED,

          statusCode:
            400,

          tenantId:
            context.tenantId ||
            null,

          cause:
            error,
        },
      );
    }
  }

  _normalizeCallback(
    normalized,
    request,
    context,
  ) {
    const payload =
      this._coercePayloadObject(
        normalized ||
          request.payload,
      );

    /**
     * Airtel integrations often expose nested transaction/status objects.
     */
    const transaction =
      payload.transaction ||
      payload.data?.transaction ||
      payload.data ||
      payload;

    const response =
      payload.response ||
      payload.data?.response ||
      {};

    const callbackId =
      normalizeString(
        payload.callbackId ||
        payload.eventId ||
        payload.notificationId ||
        payload.id ||
        payload.resourceId ||
        request.callbackId ||
        transaction.callbackId ||
        transaction.eventId,
      );

    const providerTransactionId =
      normalizeString(
        transaction.transactionId ||
        transaction.txnId ||
        transaction.transactionReference ||
        transaction.referenceId ||
        transaction.airtelTransactionId ||
        transaction.providerTransactionId ||
        transaction.externalTransactionId ||
        payload.providerTransactionId ||
        payload.transactionId ||
        payload.txnId,
      );

    const paymentReference =
      normalizeString(
        transaction.reference ||
        transaction.clientReference ||
        transaction.externalReference ||
        transaction.merchantTransactionId ||
        transaction.merchantReference ||
        transaction.requestReference ||
        payload.paymentReference ||
        payload.reference ||
        request.paymentReference,
      );

    const status =
      normalizeStatus(
        transaction.status ||
        transaction.transactionStatus ||
        transaction.result ||
        transaction.responseCode ||
        response.status ||
        payload.status,
      );

    const rawOutcome =
      transaction.outcome ||
      transaction.resultCode ||
      transaction.responseCode ||
      transaction.status ||
      response.status ||
      payload.outcome ||
      payload.status;

    const outcome =
      this._normalizeOutcome(
        rawOutcome,
        transaction,
        response,
      );

    const amount =
      canonicalAmount(
        transaction.amount ||
        transaction.transactionAmount ||
        transaction.requestAmount ||
        payload.amount ||
        payload.transactionAmount,
      );

    const currency =
      normalizeCurrency(
        transaction.currency ||
        transaction.currencyCode ||
        payload.currency ||
        payload.currencyCode ||
        response.currency,
      );

    const phoneNumber =
      normalizeString(
        transaction.msisdn ||
        transaction.mobileNumber ||
        transaction.phoneNumber ||
        transaction.customerMsisdn ||
        payload.msisdn ||
        payload.phoneNumber,
      );

    const providerReasonCode =
      normalizeString(
        transaction.responseCode ||
        transaction.resultCode ||
        response.code ||
        payload.reasonCode ||
        payload.responseCode ||
        payload.resultCode,
      );

    const providerReasonMessage =
      normalizeString(
        transaction.responseMessage ||
        transaction.resultMessage ||
        transaction.message ||
        response.message ||
        payload.message ||
        payload.description,
      );

    const callbackType =
      normalizeString(
        payload.callbackType ||
        payload.eventType ||
        payload.type ||
        transaction.eventType,
      ) ||
      'PAYMENT_CALLBACK';

    const occurredAt =
      payload.occurredAt ||
      payload.timestamp ||
      transaction.timestamp ||
      transaction.createdAt ||
      transaction.updatedAt ||
      isoNow();

    const callback = {
      provider:
        AIRTEL_PROVIDER,

      callbackId,

      callbackType,

      providerTransactionId,

      paymentReference,

      transactionReference:
        normalizeString(
          transaction.transactionReference ||
          transaction.reference ||
          providerTransactionId,
        ),

      status,

      outcome,

      amount,

      currency,

      phoneNumber,

      payer:
        this._sanitizeParty(
          transaction.payer ||
          transaction.customer ||
          transaction.sender ||
          payload.payer ||
          payload.customer,
        ),

      payee:
        this._sanitizeParty(
          transaction.payee ||
          transaction.recipient ||
          transaction.receiver ||
          payload.payee ||
          payload.recipient,
        ),

      providerReasonCode,

      providerReasonMessage,

      fee:
        canonicalAmount(
          transaction.fee ||
          transaction.serviceFee ||
          transaction.charges ||
          payload.fee ||
          payload.charges,
        ),

      rawTimestamp:
        payload.timestamp ||
        transaction.timestamp ||
        null,

      occurredAt,

      signatureVerified:
        request.signatureVerified ===
          true ||
        context.signatureVerified ===
          true,

      tenantId:
        normalizeString(
          transaction.tenantId ||
          payload.tenantId ||
          context.tenantId,
        ),

      metadata:
        this._sanitizeMetadata(
          payload.metadata ||
          transaction.metadata ||
          {},
        ),

      payloadFingerprint:
        sha256(
          this._sanitizeMetadata(
            payload,
          ),
        ),
    };

    callback.callbackFingerprint =
      createCallbackFingerprint(
        callback,
      );

    return callback;
  }

  _validateCanonicalCallback(
    callback,
    context,
  ) {
    if (
      this.options.requireCallbackId
      && !callback.callbackId
    ) {
      /**
       * Deterministically derive an immutable callback identity when Airtel
       * does not expose a dedicated callback/event ID.
       */
      if (
        !callback.providerTransactionId
      ) {
        throw new AirtelCallbackHandlerError(
          'Airtel callback ID or provider transaction reference is required.',
          {
            code:
              CALLBACK_ERROR_CODES
                .CALLBACK_ID_REQUIRED,

            statusCode:
              400,

            tenantId:
              context.tenantId ||
              null,
          },
        );
      }

      callback.callbackId =
        `airtel_${sha256(
          {
            providerTransactionId:
              callback
                .providerTransactionId,

            paymentReference:
              callback
                .paymentReference,

            amount:
              callback.amount,

            status:
              callback.status,
          },
        ).slice(
          0,
          48,
        )}`;
    }

    if (
      this.options
        .requireProviderTransactionId
      && !callback.providerTransactionId
    ) {
      throw new AirtelCallbackHandlerError(
        'Airtel provider transaction ID is required.',
        {
          code:
            CALLBACK_ERROR_CODES
              .PROVIDER_TRANSACTION_ID_REQUIRED,

          statusCode:
            400,

          callbackId:
            callback.callbackId,

          tenantId:
            context.tenantId ||
            null,
        },
      );
    }

    if (
      this.options
        .requirePaymentReference
      && !callback.paymentReference
    ) {
      throw new AirtelCallbackHandlerError(
        'Payment reference is required.',
        {
          code:
            CALLBACK_ERROR_CODES
              .PAYMENT_REFERENCE_REQUIRED,

          statusCode:
            400,

          callbackId:
            callback.callbackId,

          providerTransactionId:
            callback
              .providerTransactionId,

          tenantId:
            context.tenantId ||
            null,
        },
      );
    }

    if (
      this.options.requireTenant
      && !(
        callback.tenantId ||
        context.tenantId
      )
    ) {
      throw new AirtelCallbackHandlerError(
        'Tenant context is required for Airtel callback processing.',
        {
          code:
            CALLBACK_ERROR_CODES
              .TENANT_REQUIRED,

          statusCode:
            403,

          callbackId:
            callback.callbackId,
        },
      );
    }

    /**
     * Airtel success callbacks without amount are not necessarily invalid at
     * this layer if the provider adapter deliberately defers financial
     * matching to PaymentVerificationService.
     */
  }

  _coercePayloadObject(
    payload,
  ) {
    if (
      Buffer.isBuffer(
        payload,
      )
    ) {
      try {
        return JSON.parse(
          payload.toString(
            'utf8',
          ),
        );
      } catch (error) {
        throw new AirtelCallbackHandlerError(
          'Airtel callback body is not valid JSON.',
          {
            code:
              CALLBACK_ERROR_CODES
                .INVALID_JSON,

            statusCode:
              400,

            cause:
              error,
          },
        );
      }
    }

    if (
      typeof payload ===
      'string'
    ) {
      try {
        return JSON.parse(
          payload,
        );
      } catch (error) {
        throw new AirtelCallbackHandlerError(
          'Airtel callback payload is not valid JSON.',
          {
            code:
              CALLBACK_ERROR_CODES
                .INVALID_JSON,

            statusCode:
              400,

            cause:
              error,
          },
        );
      }
    }

    if (
      payload &&
      typeof payload ===
        'object'
    ) {
      return payload;
    }

    throw new AirtelCallbackHandlerError(
      'Airtel callback payload could not be parsed.',
      {
        code:
          CALLBACK_ERROR_CODES
            .INVALID_REQUEST,

        statusCode:
          400,
      },
    );
  }

  /* ==========================================================================
   * Tenant / Request Context
   * ======================================================================== */

  async _buildContext(
    request,
  ) {
    let tenantId =
      normalizeString(
        request.tenantId,
      );

    if (
      !tenantId &&
      this.tenantResolver
    ) {
      const resolver =
        this.tenantResolver;

      if (
        typeof resolver.resolve ===
        'function'
      ) {
        tenantId =
          normalizeString(
            await resolver.resolve(
              {
                provider:
                  AIRTEL_PROVIDER,

                callbackId:
                  request.callbackId,

                paymentReference:
                  request.paymentReference,

                headers:
                  request.headers,
              },
              {
                provider:
                  AIRTEL_PROVIDER,
              },
            ),
          );
      } else if (
        typeof resolver.resolveTenant ===
        'function'
      ) {
        tenantId =
          normalizeString(
            await resolver.resolveTenant(
              {
                provider:
                  AIRTEL_PROVIDER,

                callbackId:
                  request.callbackId,

                paymentReference:
                  request.paymentReference,

                headers:
                  request.headers,
              },
            ),
          );
      }
    }

    return {
      tenantId,

      actorId:
        'SYSTEM:AIRTEL_CALLBACK',

      actorType:
        'SYSTEM',

      provider:
        AIRTEL_PROVIDER,

      requestId:
        normalizeString(
          request.requestId,
        ) ||
        `airtel_req_${crypto.randomUUID()}`,

      correlationId:
        normalizeString(
          request.correlationId,
        ) ||
        `airtel_corr_${crypto.randomUUID()}`,

      causationId:
        normalizeString(
          request.causationId,
        ),

      operationId:
        normalizeString(
          request.operationId,
        ) ||
        createOperationId(),

      idempotencyKey:
        normalizeString(
          request.idempotencyKey,
        ),

      callbackId:
        normalizeString(
          request.callbackId,
        ),

      signatureVerified:
        request.signatureVerified ===
          true,

      receivedAt:
        isoNow(),

      metadata:
        this._sanitizeMetadata(
          request.metadata,
        ),
    };
  }

  /* ==========================================================================
   * Idempotency
   * ======================================================================== */

  async _reserveCallbackIdempotency(
    callback,
    context,
  ) {
    if (
      !this.idempotencyService
    ) {
      if (
        this.options.strictMode
      ) {
        throw new AirtelCallbackHandlerError(
          'Idempotency service is required for Airtel callback processing.',
          {
            code:
              CALLBACK_ERROR_CODES
                .CONFIGURATION_ERROR,

            statusCode:
              500,

            callbackId:
              callback.callbackId,

            providerTransactionId:
              callback
                .providerTransactionId,

            tenantId:
              context.tenantId,
          },
        );
      }

      return {
        operationId:
          context.operationId,

        created:
          true,

        duplicate:
          false,

        completed:
          false,
      };
    }

    const key =
      [
        'airtel-callback',
        context.tenantId ||
          'unknown-tenant',
        callback.callbackId ||
          callback
            .providerTransactionId,
      ].join(':');

    const result =
      await this.idempotencyService
        .reserve({
          tenantId:
            context.tenantId,

          operationType:
            IDEMPOTENCY_OPERATION,

          key,

          operationId:
            context.operationId,

          request: {
            provider:
              AIRTEL_PROVIDER,

            callbackId:
              callback.callbackId,

            providerTransactionId:
              callback
                .providerTransactionId,

            paymentReference:
              callback
                .paymentReference,

            status:
              callback.status,

            outcome:
              callback.outcome,

            amount:
              callback.amount,

            currency:
              callback.currency,

            callbackFingerprint:
              callback
                .callbackFingerprint,
          },

          paymentReference:
            callback.paymentReference,

          provider:
            AIRTEL_PROVIDER,

          providerTransactionId:
            callback
              .providerTransactionId,

          metadata: {
            callbackFingerprint:
              callback
                .callbackFingerprint,

            payloadFingerprint:
              callback
                .payloadFingerprint,
          },
        });

    return {
      ...result,

      duplicate:
        result.replay === true
        ||
        result.status ===
          'COMPLETED'
        ||
        result.status ===
          'UNKNOWN'
        ||
        result.inProgress ===
          true,

      completed:
        result.completed ===
          true,
    };
  }

  /* ==========================================================================
   * Callback Receipt
   * ======================================================================== */

  async _persistCallbackReceipt(
    callback,
    operation,
    context,
  ) {
    if (
      !this.callbackRegistry
    ) {
      if (
        this.options.strictMode
      ) {
        throw new AirtelCallbackHandlerError(
          'Airtel callback registry is required in strict mode.',
          {
            code:
              CALLBACK_ERROR_CODES
                .STORAGE_UNAVAILABLE,

            statusCode:
              503,

            callbackId:
              callback.callbackId,

            providerTransactionId:
              callback
                .providerTransactionId,

            tenantId:
              context.tenantId,
          },
        );
      }

      return null;
    }

    const record = {
      provider:
        AIRTEL_PROVIDER,

      callbackId:
        callback.callbackId,

      callbackType:
        callback.callbackType,

      providerTransactionId:
        callback
          .providerTransactionId,

      paymentReference:
        callback
          .paymentReference,

      tenantId:
        context.tenantId,

      status:
        CALLBACK_STATES.RECEIVED,

      outcome:
        callback.outcome,

      amount:
        callback.amount,

      currency:
        callback.currency,

      callbackFingerprint:
        callback.callbackFingerprint,

      payloadFingerprint:
        callback.payloadFingerprint,

      signatureVerified:
        callback.signatureVerified,

      operationId:
        operation.operationId ||
        context.operationId,

      receivedAt:
        context.receivedAt ||
        isoNow(),

      metadata:
        this._sanitizeMetadata(
          callback.metadata,
        ),
    };

    try {
      if (
        typeof this.callbackRegistry
          .record ===
        'function'
      ) {
        return this.callbackRegistry.record(
          record,
        );
      }

      if (
        typeof this.callbackRegistry
          .register ===
        'function'
      ) {
        return this.callbackRegistry.register(
          record,
        );
      }

      if (
        typeof this.callbackRegistry
          .create ===
        'function'
      ) {
        return this.callbackRegistry.create(
          record,
        );
      }

      throw new AirtelCallbackHandlerError(
        'Airtel callback registry has no supported persistence method.',
        {
          code:
            CALLBACK_ERROR_CODES
              .STORAGE_UNAVAILABLE,

          statusCode:
            500,

          callbackId:
            callback.callbackId,

          tenantId:
            context.tenantId,
        },
      );
    } catch (error) {
      if (
        this._isDuplicateError(
          error,
        )
      ) {
        return {
          duplicate:
            true,

          callbackId:
            callback.callbackId,
        };
      }

      throw error;
    }
  }

  /* ==========================================================================
   * Processing Engine
   * ======================================================================== */

  async _processCallback(
    callback,
    operation,
    context,
  ) {
    if (
      !this.callbackProcessingEngine
    ) {
      if (
        this.options
          .requireProcessingEngine
      ) {
        throw new AirtelCallbackHandlerError(
          'Airtel callback processing engine is not configured.',
          {
            code:
              CALLBACK_ERROR_CODES
                .CONFIGURATION_ERROR,

            statusCode:
              500,

            callbackId:
              callback.callbackId,

            providerTransactionId:
              callback
                .providerTransactionId,

            tenantId:
              context.tenantId,
          },
        );
      }

      return {
        success:
          true,

        outcome:
          callback.outcome,

        state:
          CALLBACK_STATES.PROCESSED,

        callbackId:
          callback.callbackId,

        providerTransactionId:
          callback
            .providerTransactionId,

        paymentReference:
          callback.paymentReference,
      };
    }

    const processingContext =
      {
        ...context,

        provider:
          AIRTEL_PROVIDER,

        callbackId:
          callback.callbackId,

        providerTransactionId:
          callback
            .providerTransactionId,

        operationId:
          operation.operationId ||
          context.operationId,

        idempotencyKey:
          operation.idempotencyKey ||
          context.idempotencyKey,
      };

    let result;

    try {
      if (
        typeof this.callbackProcessingEngine
          .processCallback ===
        'function'
      ) {
        result =
          await this._withTimeout(
            () =>
              this.callbackProcessingEngine
                .processCallback(
                  callback,
                  processingContext,
                ),
            this.options
              .callbackTimeoutMs,
          );
      } else if (
        typeof this.callbackProcessingEngine
          .process ===
        'function'
      ) {
        result =
          await this._withTimeout(
            () =>
              this.callbackProcessingEngine.process(
                callback,
                processingContext,
              ),
            this.options
              .callbackTimeoutMs,
          );
      } else if (
        typeof this.callbackProcessingEngine
          .handle ===
        'function'
      ) {
        result =
          await this._withTimeout(
            () =>
              this.callbackProcessingEngine.handle(
                callback,
                processingContext,
              ),
            this.options
              .callbackTimeoutMs,
          );
      } else {
        throw new AirtelCallbackHandlerError(
          'Airtel callback processing engine does not expose a supported API.',
          {
            code:
              CALLBACK_ERROR_CODES
                .CONFIGURATION_ERROR,

            statusCode:
              500,
          },
        );
      }
    } catch (error) {
      throw this._wrapError(
        error,
        CALLBACK_ERROR_CODES
          .PROCESSING_FAILED,
        context,
        callback,
      );
    }

    return this._normalizeProcessingResult(
      result,
      callback,
    );
  }

  _normalizeProcessingResult(
    result,
    callback,
  ) {
    const plain =
      result &&
      typeof result ===
        'object'
        ? result
        : {};

    const outcome =
      this._normalizeOutcome(
        plain.outcome ||
        plain.status ||
        plain.result ||
        plain.transactionStatus,
      );

    const state =
      normalizeStatus(
        plain.state ||
        plain.status,
      );

    return {
      success:
        plain.success ===
          true ||
        outcome ===
          CALLBACK_OUTCOMES.SUCCESS,

      outcome,

      state:
        state ||
        CALLBACK_STATES.PROCESSED,

      paymentId:
        safeId(
          plain.paymentId ||
          plain.payment?.id,
        ),

      paymentReference:
        normalizeString(
          plain.paymentReference ||
          plain.payment?.paymentReference ||
          callback.paymentReference,
        ),

      providerTransactionId:
        normalizeString(
          plain.providerTransactionId ||
          plain.providerTransaction?.id ||
          callback
            .providerTransactionId,
        ),

      financialTransactionId:
        safeId(
          plain.financialTransactionId ||
          plain.financialTransaction?.id,
        ),

      settlementId:
        safeId(
          plain.settlementId ||
          plain.settlement?.id,
        ),

      reconciliationId:
        safeId(
          plain.reconciliationId ||
          plain.reconciliation?.id ||
          plain.reconciliation?.caseId,
        ),

      message:
        normalizeString(
          plain.message,
        ),

      reasonCode:
        normalizeString(
          plain.reasonCode ||
          plain.code ||
          plain.resultCode,
        ),

      retryable:
        plain.retryable ===
          true,

      unknownOutcome:
        plain.unknownOutcome ===
          true ||
        outcome ===
          CALLBACK_OUTCOMES.UNKNOWN,

      reconciliationRequired:
        plain.reconciliationRequired ===
          true ||
        outcome ===
          CALLBACK_OUTCOMES
            .REQUIRES_RECONCILIATION,

      nextAction:
        normalizeString(
          plain.nextAction,
        ),

      data:
        this._sanitizeMetadata(
          plain.data ||
          plain.result ||
          {},
        ),
    };
  }

  /* ==========================================================================
   * Finalization
   * ======================================================================== */

  async _finalizeCallback(
    callback,
    operation,
    result,
    context,
  ) {
    const finalResult = {
      ...result,

      provider:
        AIRTEL_PROVIDER,

      callbackId:
        callback.callbackId,

      providerTransactionId:
        callback
          .providerTransactionId,

      paymentReference:
        result.paymentReference ||
        callback.paymentReference,

      tenantId:
        context.tenantId,

      operationId:
        operation.operationId ||
        context.operationId,

      correlationId:
        context.correlationId,

      requestId:
        context.requestId,

      receivedAt:
        context.receivedAt,

      processedAt:
        isoNow(),
    };

    if (
      this.idempotencyService
      &&
      operation.operationId
    ) {
      if (
        finalResult.unknownOutcome
        ||
        finalResult.reconciliationRequired
        ||
        finalResult.outcome ===
          CALLBACK_OUTCOMES.UNKNOWN
      ) {
        await this.idempotencyService
          .markUnknown(
            operation.operationId,
            {
              tenantId:
                context.tenantId,

              reasonCode:
                finalResult.reasonCode ||
                CALLBACK_ERROR_CODES
                  .UNKNOWN_OUTCOME,

              reason:
                finalResult.message,

              metadata: {
                callbackId:
                  callback.callbackId,

                providerTransactionId:
                  callback
                    .providerTransactionId,
              },
            },
          );
      } else if (
        finalResult.outcome ===
        CALLBACK_OUTCOMES.SUCCESS
      ) {
        await this.idempotencyService
          .complete(
            operation.operationId,
            finalResult,
            {
              tenantId:
                context.tenantId,
            },
          );
      } else if (
        [
          CALLBACK_OUTCOMES.FAILED,
          CALLBACK_OUTCOMES.CANCELLED,
          CALLBACK_OUTCOMES.REVERSED,
        ].includes(
          finalResult.outcome,
        )
      ) {
        await this.idempotencyService
          .fail(
            operation.operationId,
            {
              code:
                finalResult.reasonCode ||
                `AIRTEL_CALLBACK_${finalResult.outcome}`,

              message:
                finalResult.message ||
                `Airtel callback outcome: ${finalResult.outcome}`,

              retryable:
                finalResult.retryable ===
                  true,

              unknownOutcome:
                false,

              details:
                finalResult.data,
            },
            {
              tenantId:
                context.tenantId,

              retryable:
                finalResult.retryable ===
                  true,
            },
          );
      }
    }

    await this._updateCallbackReceipt(
      callback,
      finalResult,
      context,
    );

    await this._publishEventSafe(
      this._eventTypeForOutcome(
        finalResult.outcome,
      ),
      callback,
      finalResult,
      context,
    );

    await this._recordAuditSafe(
      'AIRTEL_CALLBACK_PROCESSED',
      {
        ...context,

        callbackId:
          callback.callbackId,

        providerTransactionId:
          callback
            .providerTransactionId,

        outcome:
          finalResult.outcome,

        paymentId:
          finalResult.paymentId,

        financialTransactionId:
          finalResult
            .financialTransactionId,
      },
    );

    this._metric(
      'airtel_callbacks_processed_total',
      1,
      {
        outcome:
          finalResult.outcome ||
          CALLBACK_OUTCOMES.UNKNOWN,
      },
    );

    return this._buildPublicResult(
      callback,
      finalResult,
      context,
    );
  }

  async _updateCallbackReceipt(
    callback,
    result,
    context,
  ) {
    if (
      !this.callbackRegistry
    ) {
      return null;
    }

    const patch = {
      status:
        this._receiptStateForOutcome(
          result.outcome,
        ),

      outcome:
        result.outcome,

      paymentId:
        result.paymentId ||
        null,

      financialTransactionId:
        result.financialTransactionId ||
        null,

      settlementId:
        result.settlementId ||
        null,

      reconciliationId:
        result.reconciliationId ||
        null,

      reasonCode:
        result.reasonCode ||
        null,

      processedAt:
        new Date(),

      updatedAt:
        new Date(),
    };

    try {
      if (
        typeof this.callbackRegistry
          .markProcessed ===
        'function'
      ) {
        return this.callbackRegistry
          .markProcessed(
            callback.callbackId,
            patch,
            {
              tenantId:
                context.tenantId,
            },
          );
      }

      if (
        typeof this.callbackRegistry
          .update ===
        'function'
      ) {
        return this.callbackRegistry
          .update(
            callback.callbackId,
            patch,
            {
              tenantId:
                context.tenantId,
            },
          );
      }
    } catch (error) {
      this._logError(
        'Failed to update Airtel callback receipt.',
        error,
        {
          callbackId:
            callback.callbackId,

          tenantId:
            context.tenantId,
        },
      );
    }

    return null;
  }

  /* ==========================================================================
   * Duplicate Handling
   * ======================================================================== */

  _buildDuplicateResult(
    callback,
    operation,
    context,
  ) {
    const existing =
      operation.result ||
      {};

    return {
      success:
        true,

      provider:
        AIRTEL_PROVIDER,

      state:
        CALLBACK_STATES.DUPLICATE,

      outcome:
        CALLBACK_OUTCOMES.DUPLICATE,

      duplicate:
        true,

      callbackId:
        callback.callbackId,

      providerTransactionId:
        callback
          .providerTransactionId,

      paymentReference:
        callback
          .paymentReference,

      paymentId:
        existing.paymentId ||
        operation.paymentId ||
        null,

      financialTransactionId:
        existing
          .financialTransactionId ||
        null,

      operationId:
        operation.operationId ||
        context.operationId,

      correlationId:
        context.correlationId,

      requestId:
        context.requestId,

      acknowledged:
        true,

      message:
        'Duplicate Airtel callback accepted safely.',
    };
  }

  /* ==========================================================================
   * Error Handling
   * ======================================================================== */

  async _handleProcessingFailure(
    callback,
    operation,
    context,
    error,
  ) {
    const unknown =
      error?.unknownOutcome ===
        true
      ||
      error?.reconciliationRequired ===
        true
      ||
      this._isUnknownError(
        error,
      );

    const result = unknown
      ? {
          success:
            false,

          provider:
            AIRTEL_PROVIDER,

          state:
            CALLBACK_STATES.UNKNOWN,

          outcome:
            CALLBACK_OUTCOMES.UNKNOWN,

          callbackId:
            callback.callbackId,

          providerTransactionId:
            callback
              .providerTransactionId,

          paymentReference:
            callback.paymentReference,

          reasonCode:
            error?.code ||
            CALLBACK_ERROR_CODES
              .UNKNOWN_OUTCOME,

          message:
            this._safeMessage(
              error,
            ),

          unknownOutcome:
            true,

          reconciliationRequired:
            this.options
              .enableReconciliation,

          retryable:
            false,

          nextAction:
            this.options
              .enableReconciliation
              ? 'RECONCILE_CALLBACK'
              : 'VERIFY_PROVIDER_STATUS',
        }
      : {
          success:
            false,

          provider:
            AIRTEL_PROVIDER,

          state:
            CALLBACK_STATES.FAILED,

          outcome:
            CALLBACK_OUTCOMES.FAILED,

          callbackId:
            callback.callbackId,

          providerTransactionId:
            callback
              .providerTransactionId,

          paymentReference:
            callback.paymentReference,

          reasonCode:
            error?.code ||
            CALLBACK_ERROR_CODES
              .PROCESSING_FAILED,

          message:
            this._safeMessage(
              error,
            ),

          retryable:
            error?.retryable ===
              true,

          unknownOutcome:
            false,

          reconciliationRequired:
            error
              ?.reconciliationRequired ===
              true,

          nextAction:
            error?.retryable
              ? 'RETRY_CALLBACK_PROCESSING'
              : null,
        };

    if (
      this.idempotencyService
      &&
      operation.operationId
    ) {
      try {
        if (
          unknown
        ) {
          await this.idempotencyService
            .markUnknown(
              operation.operationId,
              {
                tenantId:
                  context.tenantId,

                reasonCode:
                  result.reasonCode,

                reason:
                  result.message,

                metadata: {
                  callbackId:
                    callback.callbackId,

                  providerTransactionId:
                    callback
                      .providerTransactionId,
                },
              },
            );
        } else {
          await this.idempotencyService
            .fail(
              operation.operationId,
              error,
              {
                tenantId:
                  context.tenantId,

                retryable:
                  error?.retryable ===
                    true,
              },
            );
        }
      } catch (idempotencyError) {
        this._logError(
          'Failed to persist Airtel callback idempotency failure state.',
          idempotencyError,
          {
            callbackId:
              callback.callbackId,

            operationId:
              operation.operationId,

            tenantId:
              context.tenantId,
          },
        );
      }
    }

    await this._updateCallbackReceipt(
      callback,
      result,
      context,
    );

    await this._publishEventSafe(
      unknown
        ? 'PaymentProviderCallbackUnknown'
        : 'PaymentProviderCallbackFailed',
      callback,
      result,
      context,
    );

    await this._recordAuditSafe(
      unknown
        ? 'AIRTEL_CALLBACK_UNKNOWN'
        : 'AIRTEL_CALLBACK_PROCESSING_FAILED',
      {
        ...context,

        callbackId:
          callback.callbackId,

        providerTransactionId:
          callback
            .providerTransactionId,

        error:
          this._safeError(
            error,
          ),
      },
    );

    return this._buildPublicResult(
      callback,
      result,
      context,
    );
  }

  /* ==========================================================================
   * Outcome Mapping
   * ======================================================================== */

  _normalizeOutcome(
    value,
    transaction = {},
    response = {},
  ) {
    const candidates = [
      value,
      transaction?.outcome,
      transaction?.status,
      transaction?.transactionStatus,
      transaction?.resultCode,
      transaction?.responseCode,
      response?.status,
      response?.resultCode,
      response?.responseCode,
    ];

    for (
      const candidate of
        candidates
    ) {
      const normalized =
        normalizeStatus(
          candidate,
        );

      if (
        !normalized
      ) {
        continue;
      }

      if (
        [
          'SUCCESS',
          'SUCCESSFUL',
          'COMPLETED',
          'COMPLETE',
          'PAID',
          'APPROVED',
          'SUCCESSFULLY_COMPLETED',
          'TS',
          'TRANSACTION_SUCCESS',
        ].includes(
          normalized,
        )
      ) {
        return CALLBACK_OUTCOMES
          .SUCCESS;
      }

      if (
        [
          'PENDING',
          'PROCESSING',
          'IN_PROGRESS',
          'QUEUED',
          'INITIATED',
          'ACCEPTED',
          'SUBMITTED',
          'REQUESTED',
        ].includes(
          normalized,
        )
      ) {
        return CALLBACK_OUTCOMES
          .PENDING;
      }

      if (
        [
          'FAILED',
          'FAILURE',
          'ERROR',
          'DECLINED',
          'REJECTED',
          'TF',
          'TRANSACTION_FAILED',
        ].includes(
          normalized,
        )
      ) {
        return CALLBACK_OUTCOMES
          .FAILED;
      }

      if (
        [
          'CANCELLED',
          'CANCELED',
        ].includes(
          normalized,
        )
      ) {
        return CALLBACK_OUTCOMES
          .CANCELLED;
      }

      if (
        [
          'REVERSED',
          'REVERSAL',
        ].includes(
          normalized,
        )
      ) {
        return CALLBACK_OUTCOMES
          .REVERSED;
      }

      if (
        [
          'UNKNOWN',
          'UNCONFIRMED',
        ].includes(
          normalized,
        )
      ) {
        return CALLBACK_OUTCOMES
          .UNKNOWN;
      }
    }

    /**
     * Airtel integrations sometimes communicate an application-level success
     * using response codes instead of textual status. Do not invent a success
     * mapping here without a configured normalizer. Unknown remains safe.
     */
    return CALLBACK_OUTCOMES
      .UNKNOWN;
  }

  _eventTypeForOutcome(
    outcome,
  ) {
    switch (
      outcome
    ) {
      case CALLBACK_OUTCOMES.SUCCESS:
        return 'PaymentProviderCallbackSuccessful';

      case CALLBACK_OUTCOMES.PENDING:
        return 'PaymentProviderCallbackPending';

      case CALLBACK_OUTCOMES.FAILED:
        return 'PaymentProviderCallbackFailed';

      case CALLBACK_OUTCOMES.CANCELLED:
        return 'PaymentProviderCallbackCancelled';

      case CALLBACK_OUTCOMES.REVERSED:
        return 'PaymentProviderCallbackReversed';

      case CALLBACK_OUTCOMES.UNKNOWN:
        return 'PaymentProviderCallbackUnknown';

      case CALLBACK_OUTCOMES.DUPLICATE:
        return 'PaymentProviderCallbackDuplicate';

      case CALLBACK_OUTCOMES
        .REQUIRES_RECONCILIATION:
        return 'PaymentProviderCallbackReconciliationRequired';

      default:
        return 'PaymentProviderCallbackProcessed';
    }
  }

  _receiptStateForOutcome(
    outcome,
  ) {
    switch (
      outcome
    ) {
      case CALLBACK_OUTCOMES.SUCCESS:
      case CALLBACK_OUTCOMES.FAILED:
      case CALLBACK_OUTCOMES.CANCELLED:
      case CALLBACK_OUTCOMES.REVERSED:
        return CALLBACK_STATES.PROCESSED;

      case CALLBACK_OUTCOMES.PENDING:
        return CALLBACK_STATES.PROCESSING;

      case CALLBACK_OUTCOMES.UNKNOWN:
        return CALLBACK_STATES.UNKNOWN;

      case CALLBACK_OUTCOMES
        .REQUIRES_RECONCILIATION:
        return CALLBACK_STATES
          .REQUIRES_RECONCILIATION;

      default:
        return CALLBACK_STATES.FAILED;
    }
  }

  /* ==========================================================================
   * Public Response
   * ======================================================================== */

  _buildPublicResult(
    callback,
    result,
    context,
  ) {
    const output = {
      success:
        result.success ===
          true,

      provider:
        AIRTEL_PROVIDER,

      state:
        result.state ||
        CALLBACK_STATES.PROCESSED,

      outcome:
        result.outcome ||
        CALLBACK_OUTCOMES.UNKNOWN,

      callbackId:
        callback.callbackId,

      providerTransactionId:
        callback
          .providerTransactionId,

      paymentReference:
        result.paymentReference ||
        callback.paymentReference ||
        null,

      paymentId:
        result.paymentId ||
        null,

      financialTransactionId:
        result.financialTransactionId ||
        null,

      settlementId:
        result.settlementId ||
        null,

      reconciliationId:
        result.reconciliationId ||
        null,

      reasonCode:
        result.reasonCode ||
        null,

      message:
        result.message ||
        null,

      duplicate:
        result.duplicate ===
          true,

      retryable:
        result.retryable ===
          true,

      unknownOutcome:
        result.unknownOutcome ===
          true,

      reconciliationRequired:
        result
          .reconciliationRequired ===
          true,

      acknowledged:
        true,

      operationId:
        result.operationId ||
        context.operationId,

      correlationId:
        result.correlationId ||
        context.correlationId,

      requestId:
        result.requestId ||
        context.requestId,

      nextAction:
        result.nextAction ||
        null,

      data:
        this._sanitizeMetadata(
          result.data,
        ),
    };

    if (
      this.options
        .includeRawPayloadInResult
    ) {
      output.rawPayload =
        this._sanitizeMetadata(
          callback.rawPayload,
        );
    }

    return output;
  }

  _httpStatusForResult(
    result,
  ) {
    if (
      result.outcome ===
        CALLBACK_OUTCOMES
          .REQUIRES_RECONCILIATION
      ||
      result.outcome ===
        CALLBACK_OUTCOMES.UNKNOWN
    ) {
      return 202;
    }

    return 200;
  }

  _buildHttpResponse(
    result,
  ) {
    return {
      success:
        true,

      provider:
        AIRTEL_PROVIDER,

      acknowledged:
        true,

      state:
        result.state,

      outcome:
        result.outcome,

      callbackId:
        result.callbackId,

      providerTransactionId:
        result.providerTransactionId,

      paymentReference:
        result.paymentReference ||
        null,
    };
  }

  /* ==========================================================================
   * Events / Audit
   * ======================================================================== */

  async _publishEventSafe(
    eventType,
    callback,
    result,
    context,
  ) {
    if (
      !this.options.publishEvents
      ||
      !this.eventPublisher
      ||
      !eventType
    ) {
      return null;
    }

    const event = {
      eventId:
        `evt_airtel_callback_${crypto.randomUUID()}`,

      eventType,

      eventVersion:
        1,

      occurredAt:
        isoNow(),

      provider:
        AIRTEL_PROVIDER,

      tenantId:
        context.tenantId,

      aggregateType:
        'Payment',

      aggregateId:
        result?.paymentId ||
        callback?.paymentId ||
        callback?.paymentReference ||
        callback?.providerTransactionId,

      correlationId:
        context.correlationId,

      causationId:
        context.causationId,

      requestId:
        context.requestId,

      operationId:
        result?.operationId ||
        context.operationId,

      data: {
        callbackId:
          callback?.callbackId,

        providerTransactionId:
          callback
            ?.providerTransactionId,

        paymentReference:
          callback?.paymentReference,

        status:
          callback?.status,

        outcome:
          result?.outcome ||
          callback?.outcome,

        amount:
          callback?.amount,

        currency:
          callback?.currency,

        paymentId:
          result?.paymentId ||
          null,

        financialTransactionId:
          result
            ?.financialTransactionId ||
          null,

        settlementId:
          result?.settlementId ||
          null,

        reconciliationId:
          result?.reconciliationId ||
          null,

        reasonCode:
          result?.reasonCode ||
          null,
      },

      metadata:
        this._sanitizeMetadata(
          context.metadata,
        ),
    };

    event.eventFingerprint =
      sha256(
        {
          eventType:
            event.eventType,

          tenantId:
            event.tenantId,

          callbackId:
            callback.callbackId,

          providerTransactionId:
            callback
              .providerTransactionId,
        },
      );

    try {
      if (
        typeof this.eventPublisher
          .publish ===
        'function'
      ) {
        return await this.eventPublisher
          .publish(
            event,
          );
      }

      if (
        typeof this.eventPublisher
          .publishEvent ===
        'function'
      ) {
        return await this.eventPublisher
          .publishEvent(
            event,
          );
      }

      if (
        typeof this.eventPublisher
          .emit ===
        'function'
      ) {
        return await this.eventPublisher
          .emit(
            eventType,
            event,
          );
      }
    } catch (error) {
      this._logError(
        'Airtel callback event publication failed.',
        error,
        {
          callbackId:
            callback?.callbackId,

          providerTransactionId:
            callback
              ?.providerTransactionId,

          eventType,
        },
      );

      if (
        this.options
          .failOnEventPublicationError
      ) {
        throw new AirtelCallbackHandlerError(
          'Airtel callback event publication failed.',
          {
            code:
              CALLBACK_ERROR_CODES
                .PROCESSING_FAILED,

            statusCode:
              503,

            callbackId:
              callback?.callbackId,

            providerTransactionId:
              callback
                ?.providerTransactionId,

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

    return null;
  }

  async _recordAuditSafe(
    action,
    data,
  ) {
    if (
      !this.auditService
    ) {
      return null;
    }

    const payload = {
      action,

      provider:
        AIRTEL_PROVIDER,

      createdAt:
        isoNow(),

      ...this._sanitizeMetadata(
        data,
      ),
    };

    try {
      if (
        typeof this.auditService
          .record ===
        'function'
      ) {
        return await this.auditService.record(
          payload,
        );
      }

      if (
        typeof this.auditService
          .create ===
        'function'
      ) {
        return await this.auditService.create(
          payload,
        );
      }
    } catch (error) {
      this._logError(
        'Airtel callback audit persistence failed.',
        error,
        {
          action,
        },
      );
    }

    return null;
  }

  /* ==========================================================================
   * Payload Sanitization
   * ======================================================================== */

  _sanitizeParty(
    party,
  ) {
    if (
      !party ||
      typeof party !==
        'object'
    ) {
      return null;
    }

    return {
      id:
        safeId(
          party.id ||
          party.userId ||
          party.customerId,
        ),

      name:
        normalizeString(
          party.name ||
          party.fullName,
        ),

      phoneNumber:
        normalizeString(
          party.phoneNumber ||
          party.msisdn ||
          party.mobileNumber,
        ),

      accountReference:
        normalizeString(
          party.accountReference ||
          party.account,
        ),
    };
  }

  _sanitizeMetadata(
    metadata,
    depth = 0,
  ) {
    if (
      !metadata ||
      typeof metadata !==
        'object'
    ) {
      return {};
    }

    if (
      depth >
      this.options
        .maxMetadataDepth
    ) {
      return '[MAX_DEPTH]';
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
        'pin',
        'otp',
        'passcode',
        'encryptedSecret',
      ]);

    const sanitize =
      (
        value,
        level,
      ) => {
        if (
          level >
          this.options
            .maxMetadataDepth
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
          typeof value ===
            'string'
        ) {
          return value.length >
            this.options
              .maxMetadataStringLength
            ? `${value.slice(
                0,
                this.options
                  .maxMetadataStringLength,
              )}...`
            : value;
        }

        if (
          typeof value ===
              'number' ||
          typeof value ===
              'boolean'
        ) {
          return value;
        }

        if (
          value instanceof Date
        ) {
          return value.toISOString();
        }

        if (
          Buffer.isBuffer(
            value,
          )
        ) {
          return '[BUFFER]';
        }

        if (
          Array.isArray(value)
        ) {
          return value
            .slice(
              0,
              this.options
                .maxMetadataKeys,
            )
            .map(
              (item) =>
                sanitize(
                  item,
                  level + 1,
                ),
            );
        }

        if (
          typeof value !==
            'object'
        ) {
          return String(
            value,
          );
        }

        const output = {};

        for (
          const [
            key,
            child,
          ] of Object.entries(
            value,
          ).slice(
            0,
            this.options
              .maxMetadataKeys,
          )
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

          if (
            key ===
              'rawPayload' &&
            !this.options
              .persistRawPayload
          ) {
            continue;
          }

          output[key] =
            sanitize(
              child,
              level + 1,
            );
        }

        return output;
      };

    return sanitize(
      metadata,
      depth,
    );
  }

  /* ==========================================================================
   * Request Normalization
   * ======================================================================== */

  _normalizeIncomingRequest(
    input,
    rawContext,
  ) {
    if (
      input &&
      input.body !==
        undefined &&
      (
        input.headers ||
        input.rawBody ||
        input.method
      )
    ) {
      const headers =
        this._normalizeHeaders(
          input.headers ||
            {},
        );

      return {
        payload:
          input.body,

        rawBody:
          input.rawBody ||
          input.bodyRaw ||
          input.locals?.rawBody ||
          null,

        headers,

        signature:
          normalizeString(
            headers['x-signature'] ||
            headers[
              'x-callback-signature'
            ] ||
            headers[
              'x-airtel-signature'
            ] ||
            headers['signature'],
          ),

        signatureTimestamp:
          normalizeString(
            headers[
              'x-signature-timestamp'
            ] ||
            headers[
              'x-callback-timestamp'
            ] ||
            headers[
              'x-airtel-timestamp'
            ],
          ),

        signatureSecret:
          normalizeString(
            rawContext.signatureSecret ||
            input.signatureSecret,
          ),

        callbackId:
          normalizeString(
            headers[
              'x-callback-id'
            ] ||
            headers[
              'x-event-id'
            ] ||
            headers[
              'x-notification-id'
            ],
          ),

        requestId:
          normalizeString(
            headers[
              'x-request-id'
            ],
          ),

        correlationId:
          normalizeString(
            headers[
              'x-correlation-id'
            ],
          ),

        causationId:
          normalizeString(
            headers[
              'x-causation-id'
            ],
          ),

        tenantId:
          normalizeString(
            rawContext.tenantId ||
            input.tenantId ||
            input.locals
              ?.tenantId,
          ),

        idempotencyKey:
          normalizeString(
            headers[
              'idempotency-key'
            ],
          ),

        paymentReference:
          normalizeString(
            input.paymentReference ||
            rawContext.paymentReference,
          ),

        signatureVerified:
          rawContext.signatureVerified ===
            true,

        metadata:
          {
            httpMethod:
              input.method ||
              null,

            path:
              input.path ||
              input.originalUrl ||
              null,

            contentType:
              headers[
                'content-type'
              ] ||
              null,

            userAgent:
              headers[
                'user-agent'
              ] ||
              null,
          },
      };
    }

    return {
      payload:
        input,

      rawBody:
        rawContext.rawBody ||
        null,

      headers:
        this._normalizeHeaders(
          rawContext.headers ||
            {},
        ),

      signature:
        normalizeString(
          rawContext.signature,
        ),

      signatureTimestamp:
        normalizeString(
          rawContext.signatureTimestamp,
        ),

      signatureSecret:
        normalizeString(
          rawContext.signatureSecret,
        ),

      callbackId:
        normalizeString(
          rawContext.callbackId,
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

      tenantId:
        normalizeString(
          rawContext.tenantId,
        ),

      idempotencyKey:
        normalizeString(
          rawContext.idempotencyKey,
        ),

      paymentReference:
        normalizeString(
          rawContext.paymentReference,
        ),

      signatureVerified:
        rawContext.signatureVerified ===
          true,

      metadata:
        rawContext.metadata ||
        {},
    };
  }

  _normalizeHeaders(
    headers,
  ) {
    const result = {};

    if (
      !headers ||
      typeof headers !==
        'object'
    ) {
      return result;
    }

    for (
      const [
        key,
        value,
      ] of Object.entries(
        headers,
      )
    ) {
      result[
        String(
          key,
        ).toLowerCase()
      ] =
        Array.isArray(
          value,
        )
          ? value.join(
              ',',
            )
          : String(
              value,
            );
    }

    return result;
  }

  /* ==========================================================================
   * Errors / Timeouts
   * ======================================================================== */

  _wrapError(
    error,
    code,
    context,
    callback = {},
  ) {
    if (
      error instanceof
      AirtelCallbackHandlerError
    ) {
      return error;
    }

    return new AirtelCallbackHandlerError(
      error?.message ||
        'Airtel callback processing failed.',
      {
        code,

        statusCode:
          Number(
            error?.statusCode,
          ) || 500,

        callbackId:
          callback.callbackId ||
          context.callbackId ||
          null,

        paymentReference:
          callback.paymentReference ||
          null,

        providerTransactionId:
          callback
            .providerTransactionId ||
          null,

        tenantId:
          context.tenantId ||
          null,

        operationId:
          context.operationId ||
          null,

        retryable:
          error?.retryable ===
            true,

        unknownOutcome:
          error?.unknownOutcome ===
            true,

        reconciliationRequired:
          error
            ?.reconciliationRequired ===
            true,

        details:
          this._sanitizeMetadata(
            error?.details,
          ),

        cause:
          error,
      },
    );
  }

  _isUnknownError(
    error,
  ) {
    if (
      error?.unknownOutcome ===
      true
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
      'ESOCKETTIMEDOUT',
      'ECONNRESET',
      'UNKNOWN_OUTCOME',
      'PROVIDER_OPERATION_UNKNOWN',
      'PAYMENT_PROVIDER_UNKNOWN',
    ].includes(
      code,
    );
  }

  _safeError(
    error,
  ) {
    return {
      name:
        normalizeString(
          error?.name,
        ),

      code:
        normalizeString(
          error?.code,
        ),

      message:
        this._safeMessage(
          error,
        ),

      retryable:
        error?.retryable ===
          true,

      unknownOutcome:
        error?.unknownOutcome ===
          true,

      reconciliationRequired:
        error
          ?.reconciliationRequired ===
          true,
    };
  }

  _safeMessage(
    error,
  ) {
    return String(
      error?.message ||
        'Airtel callback processing failed.',
    ).slice(
      0,
      500,
    );
  }

  _isDuplicateError(
    error,
  ) {
    if (
      !error
    ) {
      return false;
    }

    const code =
      String(
        error.code ||
          '',
      ).toUpperCase();

    const message =
      String(
        error.message ||
          '',
      ).toLowerCase();

    return (
      [
        'E11000',
        'DUPLICATE_KEY',
        'DUPLICATE_ENTRY',
        'UNIQUE_CONSTRAINT',
      ].includes(
        code,
      )
      ||
      message.includes(
        'duplicate key',
      )
      ||
      message.includes(
        'already exists',
      )
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

    let timer =
      null;

    const timeoutPromise =
      new Promise(
        (
          _resolve,
          reject,
        ) => {
          timer =
            setTimeout(
              () => {
                const error =
                  new Error(
                    'Airtel callback processing timed out.',
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
      return await Promise.race(
        [
          operation(),
          timeoutPromise,
        ],
      );
    } finally {
      if (
        timer
      ) {
        clearTimeout(
          timer,
        );
      }
    }
  }

  /* ==========================================================================
   * Diagnostics
   * ======================================================================== */

  getProvider() {
    return AIRTEL_PROVIDER;
  }

  getStates() {
    return Object.freeze({
      ...CALLBACK_STATES,
    });
  }

  getOutcomes() {
    return Object.freeze({
      ...CALLBACK_OUTCOMES,
    });
  }

  getErrorCodes() {
    return Object.freeze({
      ...CALLBACK_ERROR_CODES,
    });
  }

  getConfiguration() {
    return Object.freeze({
      strictMode:
        this.options.strictMode,

      requireRawBodyForSignature:
        this.options
          .requireRawBodyForSignature,

      requireSignature:
        this.options.requireSignature,

      requireCallbackId:
        this.options.requireCallbackId,

      requireProviderTransactionId:
        this.options
          .requireProviderTransactionId,

      requirePaymentReference:
        this.options
          .requirePaymentReference,

      requireTenant:
        this.options.requireTenant,

      allowUnknownPayment:
        this.options.allowUnknownPayment,

      processDuplicateCallbacks:
        this.options
          .processDuplicateCallbacks,

      persistRawPayload:
        this.options.persistRawPayload,

      maxPayloadBytes:
        this.options.maxPayloadBytes,

      callbackTimeoutMs:
        this.options.callbackTimeoutMs,

      requireProcessingEngine:
        this.options
          .requireProcessingEngine,

      allowOutOfOrderCallbacks:
        this.options
          .allowOutOfOrderCallbacks,

      enableReconciliation:
        this.options
          .enableReconciliation,

      validateSignatureTimestamp:
        this.options
          .validateSignatureTimestamp,

      maxSignatureAgeSeconds:
        this.options
          .maxSignatureAgeSeconds,

      hasCallbackValidator:
        Boolean(
          this.callbackValidator,
        ),

      hasCallbackNormalizer:
        Boolean(
          this.callbackNormalizer,
        ),

      hasProcessingEngine:
        Boolean(
          this.callbackProcessingEngine,
        ),

      hasCallbackRegistry:
        Boolean(
          this.callbackRegistry,
        ),

      hasIdempotencyService:
        Boolean(
          this.idempotencyService,
        ),

      hasEventPublisher:
        Boolean(
          this.eventPublisher,
        ),

      hasAuditService:
        Boolean(
          this.auditService,
        ),

      hasSignatureVerifier:
        Boolean(
          this.signatureVerifier,
        ),

      hasTenantResolver:
        Boolean(
          this.tenantResolver,
        ),
    });
  }

  validateConfiguration() {
    const errors = [];

    if (
      this.options.strictMode
      &&
      !this.callbackValidator
    ) {
      errors.push(
        'callbackValidator is required in strict mode.',
      );
    }

    if (
      this.options.strictMode
      &&
      !this.callbackNormalizer
    ) {
      errors.push(
        'callbackNormalizer is required in strict mode.',
      );
    }

    if (
      this.options
        .requireProcessingEngine
      &&
      this.options.strictMode
      &&
      !this.callbackProcessingEngine
    ) {
      errors.push(
        'callbackProcessingEngine is required in strict mode.',
      );
    }

    if (
      this.options.requireSignature
      &&
      this.options.strictMode
      &&
      !this.signatureVerifier
      &&
      !(
        this.callbackValidator
        &&
        typeof this.callbackValidator
          .validateSignature ===
          'function'
      )
    ) {
      errors.push(
        'signatureVerifier or callbackValidator.validateSignature is required in strict mode.',
      );
    }

    if (
      this.options.strictMode
      &&
      !this.idempotencyService
    ) {
      errors.push(
        'idempotencyService is required in strict mode.',
      );
    }

    if (
      this.options.strictMode
      &&
      !this.callbackRegistry
    ) {
      errors.push(
        'callbackRegistry is required in strict mode.',
      );
    }

    return {
      valid:
        errors.length === 0,

      errors,
    };
  }

  /* ==========================================================================
   * Observability
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
        typeof this.metrics
          .increment ===
        'function'
      ) {
        this.metrics.increment(
          name,
          value,
          labels,
        );

        return;
      }

      if (
        typeof this.metrics.inc ===
        'function'
      ) {
        this.metrics.inc(
          name,
          value,
          labels,
        );
      }
    } catch (_error) {
      // Metrics must never break callback correctness.
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
        &&
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
      // Never mask the primary callback error.
    }
  }
}

/* ============================================================================
 * Static API
 * ========================================================================== */

AirtelCallbackHandler.PROVIDER =
  AIRTEL_PROVIDER;

AirtelCallbackHandler.STATES =
  CALLBACK_STATES;

AirtelCallbackHandler.OUTCOMES =
  CALLBACK_OUTCOMES;

AirtelCallbackHandler.ERROR_CODES =
  CALLBACK_ERROR_CODES;

AirtelCallbackHandler.IDEMPOTENCY_OPERATION =
  IDEMPOTENCY_OPERATION;

AirtelCallbackHandler.AirtelCallbackHandlerError =
  AirtelCallbackHandlerError;

/* ============================================================================
 * Factory
 * ========================================================================== */

function createAirtelCallbackHandler(
  dependencies = {},
) {
  return new AirtelCallbackHandler(
    dependencies,
  );
}

/* ============================================================================
 * Exports
 * ========================================================================== */

module.exports =
  AirtelCallbackHandler;

module.exports.AirtelCallbackHandler =
  AirtelCallbackHandler;

module.exports.AirtelCallbackHandlerError =
  AirtelCallbackHandlerError;

module.exports.createAirtelCallbackHandler =
  createAirtelCallbackHandler;

module.exports.AIRTEL_PROVIDER =
  AIRTEL_PROVIDER;

module.exports.CALLBACK_STATES =
  CALLBACK_STATES;

module.exports.CALLBACK_OUTCOMES =
  CALLBACK_OUTCOMES;

module.exports.CALLBACK_ERROR_CODES =
  CALLBACK_ERROR_CODES;

module.exports.IDEMPOTENCY_OPERATION =
  IDEMPOTENCY_OPERATION;

/* ============================================================================
 * End of File
 * ============================================================================
 */