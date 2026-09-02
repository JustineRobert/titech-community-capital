'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise MTN MoMo Callback Handler
 * ============================================================================
 *
 * File:
 *   backend/modules/payment/providers/mtn/mtnCallbackHandler.js
 *
 * Purpose
 * -------
 * Production-grade adapter for receiving, validating, normalizing, and safely
 * handing MTN MoMo callback/webhook notifications into the canonical payment
 * callback pipeline.
 *
 * IMPORTANT
 * ---------
 * This module is a CALLBACK ADAPTER.
 *
 * It does not:
 *
 *   - mutate ledger balances
 *   - post journal entries
 *   - mark a payment successful directly
 *   - trust provider callback payloads without validation
 *   - create duplicate financial transactions
 *   - bypass payment state machine rules
 *
 * Canonical flow
 * --------------
 *
 *   MTN MoMo
 *      |
 *      v
 *   HTTP Route / Controller
 *      |
 *      v
 *   mtnCallbackHandler
 *      |
 *      +--> raw-body preservation
 *      +--> signature/security validation
 *      +--> schema/shape validation
 *      +--> callback normalization
 *      +--> replay/idempotency protection
 *      +--> callback processing engine
 *      |
 *      v
 *   Payment State Machine
 *      |
 *      +--> PaymentVerificationService
 *      +--> GoldenMoneyPath / Settlement
 *      +--> Ledger / Finance
 *      +--> Event / Outbox
 *
 * Security principles
 * -------------------
 * 1. Raw request material is never trusted as authoritative financial state.
 * 2. Signature validation must happen before business processing where the
 *    configured validator requires the original body.
 * 3. Callback duplicates are expected and must be safe.
 * 4. Unknown callbacks are not silently treated as failures.
 * 5. Tenant context must be established by trusted application context or
 *    deterministic callback correlation.
 * 6. Provider transaction references are correlation identifiers, not ledger
 *    authority.
 * 7. A callback may arrive before or after status polling.
 * 8. A callback may arrive multiple times.
 * 9. Callbacks may arrive out of order.
 * 10. Callback processing must be idempotent.
 * 11. Raw provider payloads must be sanitized before persistence or logging.
 * 12. Callback acknowledgement should be separated from financial completion.
 *
 * Expected dependency contracts
 * -----------------------------
 * The handler supports common method names so it can be integrated into an
 * existing payment callback subsystem without forcing a folder restructure.
 *
 *   callbackValidator
 *     validate(...)
 *     verify(...)
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
 *     register(...)
 *     record(...)
 *     find(...)
 *
 *   idempotencyService
 *     reserve(...)
 *     complete(...)
 *     fail(...)
 *     markUnknown(...)
 *
 *   paymentRepository
 *     findByProviderTransactionId(...)
 *     findByReference(...)
 *     getById(...)
 *
 *   eventPublisher
 *     publish(...)
 *     publishEvent(...)
 *
 * ============================================================================
 */

const crypto = require('crypto');

/* ============================================================================
 * Constants
 * ========================================================================== */

const MTN_PROVIDER = 'mtn';

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
    'MTN_CALLBACK_INVALID_REQUEST',

  INVALID_CONTENT_TYPE:
    'MTN_CALLBACK_INVALID_CONTENT_TYPE',

  EMPTY_PAYLOAD:
    'MTN_CALLBACK_EMPTY_PAYLOAD',

  INVALID_JSON:
    'MTN_CALLBACK_INVALID_JSON',

  SIGNATURE_REQUIRED:
    'MTN_CALLBACK_SIGNATURE_REQUIRED',

  SIGNATURE_INVALID:
    'MTN_CALLBACK_SIGNATURE_INVALID',

  SIGNATURE_VALIDATION_UNAVAILABLE:
    'MTN_CALLBACK_SIGNATURE_VALIDATION_UNAVAILABLE',

  VALIDATION_FAILED:
    'MTN_CALLBACK_VALIDATION_FAILED',

  NORMALIZATION_FAILED:
    'MTN_CALLBACK_NORMALIZATION_FAILED',

  PROVIDER_TRANSACTION_ID_REQUIRED:
    'MTN_CALLBACK_PROVIDER_TRANSACTION_ID_REQUIRED',

  PAYMENT_REFERENCE_REQUIRED:
    'MTN_CALLBACK_PAYMENT_REFERENCE_REQUIRED',

  CALLBACK_ID_REQUIRED:
    'MTN_CALLBACK_ID_REQUIRED',

  IDEMPOTENCY_REQUIRED:
    'MTN_CALLBACK_IDEMPOTENCY_REQUIRED',

  DUPLICATE_CALLBACK:
    'MTN_CALLBACK_DUPLICATE',

  CALLBACK_REPLAY:
    'MTN_CALLBACK_REPLAY',

  PAYMENT_NOT_FOUND:
    'MTN_CALLBACK_PAYMENT_NOT_FOUND',

  PROCESSING_FAILED:
    'MTN_CALLBACK_PROCESSING_FAILED',

  UNKNOWN_OUTCOME:
    'MTN_CALLBACK_UNKNOWN_OUTCOME',

  RECONCILIATION_REQUIRED:
    'MTN_CALLBACK_RECONCILIATION_REQUIRED',

  TENANT_REQUIRED:
    'MTN_CALLBACK_TENANT_REQUIRED',

  PROVIDER_MISMATCH:
    'MTN_CALLBACK_PROVIDER_MISMATCH',

  AMOUNT_MISMATCH:
    'MTN_CALLBACK_AMOUNT_MISMATCH',

  CURRENCY_MISMATCH:
    'MTN_CALLBACK_CURRENCY_MISMATCH',

  STORAGE_UNAVAILABLE:
    'MTN_CALLBACK_STORAGE_UNAVAILABLE',

  CONFIGURATION_ERROR:
    'MTN_CALLBACK_CONFIGURATION_ERROR',
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

  /**
   * Do not let provider callbacks change financial state directly.
   * Everything goes through the callback processing engine.
   */
  requireProcessingEngine:
    true,

  /**
   * Out-of-order callbacks are expected in distributed systems.
   * The processing engine/state machine decides whether a transition is valid.
   */
  allowOutOfOrderCallbacks:
    true,

  /**
   * Unknown provider outcome should enter reconciliation rather than become
   * a normal failed payment.
   */
  enableReconciliation:
    true,

  /**
   * Callback acknowledgement should normally occur even when business
   * processing has already durably recorded the callback.
   */
  acknowledgeAfterDurableAcceptance:
    true,

  /**
   * Event publication is optional at runtime but recommended in production.
   */
  publishEvents:
    true,

  failOnEventPublicationError:
    false,
});

/* ============================================================================
 * Error
 * ========================================================================== */

class MtnCallbackHandlerError extends Error {
  constructor(
    message,
    options = {},
  ) {
    super(message);

    this.name =
      'MtnCallbackHandlerError';

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
      MTN_PROVIDER;

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
      MtnCallbackHandlerError,
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

function now() {
  return new Date();
}

function isoNow() {
  return now().toISOString();
}

function createOperationId() {
  return `mtn_cb_op_${crypto.randomUUID()}`;
}

function createCallbackFingerprint(
  input,
) {
  return sha256({
    provider:
      MTN_PROVIDER,

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
 * Handler
 * ========================================================================== */

class MtnCallbackHandler {
  /**
   * @param {Object} dependencies
   *
   * Supported dependencies:
   *
   *   callbackValidator
   *   callbackNormalizer
   *   callbackProcessingEngine
   *   callbackRegistry
   *   idempotencyService
   *   paymentRepository
   *   eventPublisher
   *   auditService
   *   metrics
   *   logger
   *   signatureVerifier
   *   tenantResolver
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
   * Primary API
   * ======================================================================== */

  /**
   * Main entry point.
   *
   * The method accepts either:
   *
   *   handle(request)
   *
   * or:
   *
   *   handle(payload, context)
   *
   * Express-compatible request objects are also supported.
   */
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
      this._buildContext(
        request,
      );

    const receivedAt =
      isoNow();

    this._metric(
      'mtn_callbacks_received_total',
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
        'mtn_callbacks_rejected_total',
        1,
      );

      await this._recordAuditSafe(
        'MTN_CALLBACK_REJECTED',
        {
          ...context,
          error:
            this._safeError(
              error,
            ),
        },
      );

      throw error instanceof
        MtnCallbackHandlerError
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
        'mtn_callbacks_duplicate_total',
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

    const finalized =
      await this._finalizeCallback(
        callback,
        operation,
        result,
        context,
      );

    this._metric(
      'mtn_callbacks_processed_total',
      1,
      {
        outcome:
          finalized.outcome ||
          CALLBACK_OUTCOMES.UNKNOWN,
      },
    );

    return finalized;
  }

  /**
   * Express-friendly alias.
   *
   * This returns a normalized application result. The route/controller is
   * responsible for selecting the HTTP response status.
   */
  async process(
    input,
    context = {},
  ) {
    return this.handle(
      input,
      context,
    );
  }

  /**
   * Callback route helper.
   *
   * Returns a safe HTTP-oriented response envelope.
   */
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
   * Acceptance / Security
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
      !request
      || typeof request !==
        'object'
    ) {
      throw new MtnCallbackHandlerError(
        'MTN callback request is required.',
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
      !request.payload
      || (
        typeof request.payload ===
          'string'
          &&
        !request.payload.trim()
      )
    ) {
      throw new MtnCallbackHandlerError(
        'MTN callback payload is empty.',
        {
          code:
            CALLBACK_ERROR_CODES
              .EMPTY_PAYLOAD,

          statusCode:
            400,
        },
      );
    }

    if (
      request.rawBody
      &&
      Buffer.isBuffer(
        request.rawBody,
      )
      &&
      request.rawBody.length >
        this.options
          .maxPayloadBytes
    ) {
      throw new MtnCallbackHandlerError(
        'MTN callback payload exceeds the configured size limit.',
        {
          code:
            CALLBACK_ERROR_CODES
              .INVALID_REQUEST,

          statusCode:
            413,
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
        throw new MtnCallbackHandlerError(
          'MTN callback signature validation failed.',
          {
            code:
              CALLBACK_ERROR_CODES
                .SIGNATURE_INVALID,

            statusCode:
              401,

            callbackId:
              request.callbackId ||
              null,

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
     * Support a validator that performs signature validation internally.
     */
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
                MTN_PROVIDER,

              payload:
                request.payload,

              rawBody:
                request.rawBody,

              headers:
                request.headers,

              signature:
                request.signature,

              context,
            },
          );

      if (
        result === false
        || result?.valid === false
      ) {
        throw new MtnCallbackHandlerError(
          'MTN callback signature validation failed.',
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
      this.options
        .requireRawBodyForSignature
      && !request.rawBody
    ) {
      throw new MtnCallbackHandlerError(
        'Raw request body is required for MTN callback signature validation.',
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

    throw new MtnCallbackHandlerError(
      'No MTN callback signature verifier is configured.',
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
    const verifier =
      this.signatureVerifier;

    const args = {
      provider:
        MTN_PROVIDER,

      payload:
        request.payload,

      rawBody:
        request.rawBody,

      headers:
        request.headers,

      signature:
        request.signature,

      timestamp:
        request.signatureTimestamp,

      context,
    };

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

    throw new MtnCallbackHandlerError(
      'Configured MTN signature verifier does not expose a supported method.',
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
   * Validation / Normalization
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
        throw new MtnCallbackHandlerError(
          'MTN callback validator is not configured.',
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
                MTN_PROVIDER,

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
                MTN_PROVIDER,

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
      throw new MtnCallbackHandlerError(
        error?.message ||
          'MTN callback validation failed.',
        {
          code:
            CALLBACK_ERROR_CODES
              .VALIDATION_FAILED,

          statusCode:
            Number(
              error?.statusCode,
            ) || 400,

          cause:
            error,

          tenantId:
            context.tenantId ||
            null,
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
        throw new MtnCallbackHandlerError(
          'MTN callback normalizer is not configured.',
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
                MTN_PROVIDER,

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
                MTN_PROVIDER,

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
      throw new MtnCallbackHandlerError(
        error?.message ||
          'MTN callback normalization failed.',
        {
          code:
            CALLBACK_ERROR_CODES
              .NORMALIZATION_FAILED,

          statusCode:
            400,

          cause:
            error,

          tenantId:
            context.tenantId ||
            null,
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

    const providerTransactionId =
      normalizeString(
        payload.providerTransactionId ||
        payload.transactionId ||
        payload.financialTransactionId ||
        payload.externalTransactionId ||
        payload.externalId ||
        payload.referenceId ||
        payload.mtnTransactionId ||
        payload.financialId,
      );

    const paymentReference =
      normalizeString(
        payload.paymentReference ||
        payload.reference ||
        payload.externalReference ||
        payload.clientReference ||
        payload.externalId ||
        request.paymentReference,
      );

    const callbackId =
      normalizeString(
        payload.callbackId ||
        payload.eventId ||
        payload.id ||
        payload.notificationId ||
        payload.resourceId ||
        request.callbackId,
      );

    const status =
      normalizeStatus(
        payload.status ||
        payload.transactionStatus ||
        payload.result ||
        payload.financialStatus,
      );

    const outcome =
      this._normalizeOutcome(
        payload,
      );

    const amount =
      canonicalAmount(
        payload.amount ||
        payload.financialAmount ||
        payload.totalAmount,
      );

    const currency =
      normalizeCurrency(
        payload.currency ||
        payload.currencyCode,
      );

    const occurredAt =
      payload.occurredAt ||
      payload.timestamp ||
      payload.createdAt ||
      payload.updatedAt ||
      isoNow();

    const callback = {
      provider:
        MTN_PROVIDER,

      callbackId,

      callbackType:
        normalizeString(
          payload.callbackType ||
          payload.eventType ||
          payload.type,
        ) ||
        'PAYMENT_CALLBACK',

      providerTransactionId,

      paymentReference,

      transactionReference:
        normalizeString(
          payload.transactionReference ||
          payload.transactionRef ||
          providerTransactionId,
        ),

      status,

      outcome,

      amount,

      currency,

      payer:
        this._sanitizeParty(
          payload.payer ||
          payload.customer ||
          payload.sender,
        ),

      payee:
        this._sanitizeParty(
          payload.payee ||
          payload.recipient ||
          payload.receiver,
        ),

      phoneNumber:
        normalizeString(
          payload.phoneNumber ||
          payload.msisdn ||
          payload.mobileNumber,
        ),

      providerReasonCode:
        normalizeString(
          payload.reasonCode ||
          payload.reason ||
          payload.resultCode ||
          payload.financialResult,
        ),

      providerReasonMessage:
        normalizeString(
          payload.reasonMessage ||
          payload.message ||
          payload.resultMessage ||
          payload.statusMessage,
        ),

      fee:
        canonicalAmount(
          payload.fee ||
          payload.charges,
        ),

      rawTimestamp:
        payload.timestamp ||
        null,

      occurredAt,

      signatureVerified:
        request.signatureVerified ===
          true
        ||
        context.signatureVerified ===
          true,

      tenantId:
        normalizeString(
          payload.tenantId ||
          context.tenantId,
        ),

      metadata:
        this._sanitizeMetadata(
          payload.metadata ||
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
       * Provider ecosystems sometimes do not expose a callback/event ID.
       * In that case the immutable provider transaction reference becomes the
       * deterministic event identity.
       */
      if (
        !callback.providerTransactionId
      ) {
        throw new MtnCallbackHandlerError(
          'MTN callback ID or provider transaction reference is required.',
          {
            code:
              CALLBACK_ERROR_CODES
                .CALLBACK_ID_REQUIRED,

            statusCode:
              400,

            providerTransactionId:
              callback
                .providerTransactionId ||
              null,

            tenantId:
              context.tenantId ||
              null,
          },
        );
      }

      callback.callbackId =
        `mtn_${sha256(
          {
            providerTransactionId:
              callback.providerTransactionId,

            paymentReference:
              callback.paymentReference,

            amount:
              callback.amount,
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
      throw new MtnCallbackHandlerError(
        'MTN provider transaction ID is required.',
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
      throw new MtnCallbackHandlerError(
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
            callback.providerTransactionId,

          tenantId:
            context.tenantId ||
            null,
        },
      );
    }

    if (
      this.options.requireTenant
      && !(
        callback.tenantId
        ||
        context.tenantId
      )
    ) {
      throw new MtnCallbackHandlerError(
        'Tenant context is required for MTN callback processing.',
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

    if (
      callback.amount ===
        null
      &&
      callback.outcome ===
        CALLBACK_OUTCOMES.SUCCESS
    ) {
      /**
       * Do not necessarily reject here if the normalizer intentionally leaves
       * amount reconciliation to PaymentVerificationService. The downstream
       * validator remains authoritative for financial matching.
       */
    }
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
        throw new MtnCallbackHandlerError(
          'MTN callback body is not valid JSON.',
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
        throw new MtnCallbackHandlerError(
          'MTN callback payload is not valid JSON.',
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

    throw new MtnCallbackHandlerError(
      'MTN callback payload could not be parsed.',
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
   * Context
   * ======================================================================== */

  _buildContext(
    request,
  ) {
    let tenantId =
      normalizeString(
        request.tenantId,
      );

    if (
      !tenantId
      && this.tenantResolver
    ) {
      /**
       * Tenant resolution from an external callback must never trust a
       * customer-provided tenantId blindly. The resolver may use provider
       * credentials, callback registration, client reference, account
       * configuration, or provider-specific routing.
       */
      tenantId =
        normalizeString(
          request.resolvedTenantId,
        );
    }

    return {
      tenantId,

      actorId:
        'SYSTEM:MTN_CALLBACK',

      actorType:
        'SYSTEM',

      provider:
        MTN_PROVIDER,

      requestId:
        normalizeString(
          request.requestId,
        ) ||
        `mtn_req_${crypto.randomUUID()}`,

      correlationId:
        normalizeString(
          request.correlationId,
        ) ||
        `mtn_corr_${crypto.randomUUID()}`,

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
   * Idempotency / Replay Protection
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
        throw new MtnCallbackHandlerError(
          'Idempotency service is required for MTN callback processing.',
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
        'mtn-callback',
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
              MTN_PROVIDER,

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
            callback
              .paymentReference,

          provider:
            MTN_PROVIDER,

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

    /**
     * If an existing callback has a different fingerprint, the shared
     * idempotency service should reject key reuse. Do not bypass it here.
     */
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
   * Callback Receipt Persistence
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
        throw new MtnCallbackHandlerError(
          'MTN callback registry is required in strict mode.',
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
        MTN_PROVIDER,

      callbackId:
        callback.callbackId,

      callbackType:
        callback.callbackType,

      providerTransactionId:
        callback.providerTransactionId,

      paymentReference:
        callback.paymentReference,

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
        callback.receivedAt ||
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

      if (
        this.options.strictMode
      ) {
        throw new MtnCallbackHandlerError(
          'MTN callback registry has no supported persistence method.',
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
      }
    } catch (error) {
      /**
       * Duplicate callback receipt is safe. The shared idempotency boundary
       * remains authoritative for replay prevention.
       */
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

    return null;
  }

  /* ==========================================================================
   * Callback Processing
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
        throw new MtnCallbackHandlerError(
          'MTN callback processing engine is not configured.',
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
          callback
            .paymentReference,
      };
    }

    const processingContext =
      {
        ...context,

        provider:
          MTN_PROVIDER,

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
        throw new MtnCallbackHandlerError(
          'MTN callback processing engine does not expose a supported API.',
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
        plain,
      );

    const state =
      normalizeStatus(
        plain.state ||
        plain.status,
      );

    return {
      success:
        plain.success === true
        ||
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
          plain.code,
        ),

      retryable:
        plain.retryable ===
          true,

      unknownOutcome:
        plain.unknownOutcome ===
          true
        ||
        outcome ===
          CALLBACK_OUTCOMES.UNKNOWN,

      reconciliationRequired:
        plain.reconciliationRequired ===
          true
        ||
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

      rawProviderResult:
        this.options
          .persistRawPayload
          ? this._sanitizeMetadata(
              plain.providerResult,
            )
          : undefined,
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
    const finalResult =
      {
        ...result,

        provider:
          MTN_PROVIDER,

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
          callback.receivedAt ||
          context.receivedAt ||
          null,

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
        [
          CALLBACK_OUTCOMES.SUCCESS,
          CALLBACK_OUTCOMES.FAILED,
          CALLBACK_OUTCOMES.CANCELLED,
          CALLBACK_OUTCOMES.REVERSED,
        ].includes(
          finalResult.outcome,
        )
      ) {
        if (
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
        } else {
          await this.idempotencyService
            .fail(
              operation.operationId,
              {
                code:
                  finalResult.reasonCode ||
                  `MTN_CALLBACK_${finalResult.outcome}`,

                message:
                  finalResult.message ||
                  `MTN callback outcome: ${finalResult.outcome}`,

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
              },
            );
        }
      } else {
        /**
         * PENDING/PROCESSING should remain owned by the processing lifecycle.
         * Do not prematurely mark the callback operation completed.
         */
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
      'MTN_CALLBACK_PROCESSED',
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
        now(),

      updatedAt:
        now(),
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
        'Failed to update MTN callback receipt.',
        error,
        {
          callbackId:
            callback.callbackId,

          tenantId:
            context.tenantId,
        },
      );

      /**
       * Receipt persistence is operationally important, but if the payment
       * processing result has already become authoritative, the handler should
       * not reverse it merely because a monitoring record could not update.
       */
    }

    return null;
  }

  /* ==========================================================================
   * Duplicate Result
   * ======================================================================== */

  _buildDuplicateResult(
    callback,
    operation,
    context,
  ) {
    const existingResult =
      operation.result ||
      {};

    return {
      success:
        true,

      provider:
        MTN_PROVIDER,

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
        callback.paymentReference,

      paymentId:
        existingResult.paymentId ||
        operation.paymentId ||
        null,

      financialTransactionId:
        existingResult
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
        'Duplicate MTN callback accepted safely.',
    };
  }

  /* ==========================================================================
   * Failures
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

    let result;

    if (
      unknown
    ) {
      result = {
        success:
          false,

        provider:
          MTN_PROVIDER,

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
      };
    } else {
      result = {
        success:
          false,

        provider:
          MTN_PROVIDER,

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
          error?.reconciliationRequired ===
            true,

        nextAction:
          error?.retryable
            ? 'RETRY_CALLBACK_PROCESSING'
            : null,
      };
    }

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
          'Failed to persist MTN callback idempotency failure state.',
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
        ? 'MTN_CALLBACK_UNKNOWN'
        : 'MTN_CALLBACK_PROCESSING_FAILED',
      {
        ...context,

        callbackId:
          callback.callbackId,

        providerTransactionId:
          callback.providerTransactionId,

        error:
          this._safeError(
            error,
          ),
      },
    );

    /**
     * Callback routes should normally acknowledge a safely accepted callback
     * even if business processing is pending/reconciliation-required. Returning
     * an application result allows the controller to select an appropriate
     * 2xx/4xx policy.
     */
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
    payload,
  ) {
    const outcome =
      normalizeStatus(
        payload?.outcome ||
        payload?.result ||
        payload?.transactionStatus ||
        payload?.status ||
        payload?.financialStatus ||
        payload?.financialResult,
      );

    if (
      [
        'SUCCESS',
        'SUCCESSFUL',
        'COMPLETED',
        'COMPLETE',
        'PAID',
        'APPROVED',
        'SUCCESSFULLY_COMPLETED',
      ].includes(
        outcome,
      )
    ) {
      return CALLBACK_OUTCOMES.SUCCESS;
    }

    if (
      [
        'PENDING',
        'PROCESSING',
        'IN_PROGRESS',
        'QUEUED',
        'INITIATED',
        'ACCEPTED',
      ].includes(
        outcome,
      )
    ) {
      return CALLBACK_OUTCOMES.PENDING;
    }

    if (
      [
        'FAILED',
        'FAILURE',
        'ERROR',
        'DECLINED',
        'REJECTED',
      ].includes(
        outcome,
      )
    ) {
      return CALLBACK_OUTCOMES.FAILED;
    }

    if (
      [
        'CANCELLED',
        'CANCELED',
      ].includes(
        outcome,
      )
    ) {
      return CALLBACK_OUTCOMES.CANCELLED;
    }

    if (
      [
        'REVERSED',
        'REVERSAL',
      ].includes(
        outcome,
      )
    ) {
      return CALLBACK_OUTCOMES.REVERSED;
    }

    if (
      [
        'UNKNOWN',
        'UNCONFIRMED',
      ].includes(
        outcome,
      )
    ) {
      return CALLBACK_OUTCOMES.UNKNOWN;
    }

    return CALLBACK_OUTCOMES.UNKNOWN;
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
   * Result / HTTP
   * ======================================================================== */

  _buildPublicResult(
    callback,
    result,
    context,
  ) {
    const safeResult = {
      success:
        result.success ===
          true,

      provider:
        MTN_PROVIDER,

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
        result.reconciliationRequired ===
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
      safeResult.rawPayload =
        this._sanitizeMetadata(
          callback.rawPayload,
        );
    }

    return safeResult;
  }

  _httpStatusForResult(
    result,
  ) {
    /**
     * The handler acknowledges receipt unless the request itself was invalid.
     * Business outcome is represented in the response body and downstream
     * event/reconciliation state.
     */
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
        MTN_PROVIDER,

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
   * Safe Events / Audit
   * ======================================================================== */

  async _publishEventSafe(
    eventType,
    callback,
    result,
    context,
  ) {
    if (
      !this.options.publishEvents
      || !this.eventPublisher
      || !eventType
    ) {
      return null;
    }

    const event = {
      eventId:
        `evt_mtn_callback_${crypto.randomUUID()}`,

      eventType,

      eventVersion:
        1,

      occurredAt:
        isoNow(),

      provider:
        MTN_PROVIDER,

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
          callback?.providerTransactionId,

        paymentReference:
          callback?.paymentReference,

        outcome:
          result?.outcome ||
          callback?.outcome,

        status:
          callback?.status,

        amount:
          callback?.amount,

        currency:
          callback?.currency,

        paymentId:
          result?.paymentId ||
          null,

        financialTransactionId:
          result?.financialTransactionId ||
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
        'MTN callback event publication failed.',
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
        throw new MtnCallbackHandlerError(
          'MTN callback event publication failed.',
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
        MTN_PROVIDER,

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
        return await this.auditService
          .record(
            payload,
          );
      }

      if (
        typeof this.auditService
          .create ===
        'function'
      ) {
        return await this.auditService
          .create(
            payload,
          );
      }
    } catch (error) {
      this._logError(
        'MTN callback audit persistence failed.',
        error,
        {
          action,
        },
      );
    }

    return null;
  }

  /* ==========================================================================
   * Party / Payload Sanitization
   * ======================================================================== */

  _sanitizeParty(
    party,
  ) {
    if (
      !party
      || typeof party !==
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
      !metadata
      || typeof metadata !==
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
        'signatureSecret',
        'webhookSecret',
        'rawBody',
        'pin',
        'otp',
        'passcode',
        'encryptedSecret',
      ]);

    const sanitize =
      (value, level) => {
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
              'number'
          ||
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
              'rawPayload'
            &&
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
   * Incoming Request Normalization
   * ======================================================================== */

  _normalizeIncomingRequest(
    input,
    rawContext,
  ) {
    /**
     * Express request object.
     */
    if (
      input
      && input.body !== undefined
      && (
        input.headers
        || input.rawBody
        || input.method
      )
    ) {
      const headers =
        this._normalizeHeaders(
          input.headers ||
            {},
        );

      const rawBody =
        input.rawBody ||
        input.bodyRaw ||
        input.locals?.rawBody ||
        null;

      const signature =
        normalizeString(
          headers['x-signature'] ||
          headers['x-callback-signature'] ||
          headers['x-mtn-signature'] ||
          headers['signature'],
        );

      const signatureTimestamp =
        normalizeString(
          headers[
            'x-signature-timestamp'
          ] ||
          headers[
            'x-callback-timestamp'
          ],
        );

      const payload =
        input.body;

      return {
        payload,

        rawBody,

        headers,

        signature,

        signatureTimestamp,

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

    /**
     * Direct payload + context.
     */
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

      resolvedTenantId:
        normalizeString(
          rawContext.resolvedTenantId,
        ),

      idempotencyKey:
        normalizeString(
          rawContext.idempotencyKey,
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
      !headers
      || typeof headers !==
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
   * Error / Timeout
   * ======================================================================== */

  _wrapError(
    error,
    code,
    context,
    callback = {},
  ) {
    if (
      error instanceof
      MtnCallbackHandlerError
    ) {
      return error;
    }

    return new MtnCallbackHandlerError(
      error?.message ||
        'MTN callback processing failed.',
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
          callback.providerTransactionId ||
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
          error?.reconciliationRequired ===
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
        'MTN callback processing failed.',
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
                    'MTN callback processing timed out.',
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
    return MTN_PROVIDER;
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
        'A callback signature verifier is required in strict mode.',
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
      /**
       * Metrics must never affect callback correctness.
       */
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
      // Never mask callback failures.
    }
  }
}

/* ============================================================================
 * Static API
 * ========================================================================== */

MtnCallbackHandler.PROVIDER =
  MTN_PROVIDER;

MtnCallbackHandler.STATES =
  CALLBACK_STATES;

MtnCallbackHandler.OUTCOMES =
  CALLBACK_OUTCOMES;

MtnCallbackHandler.ERROR_CODES =
  CALLBACK_ERROR_CODES;

MtnCallbackHandler.IDEMPOTENCY_OPERATION =
  IDEMPOTENCY_OPERATION;

MtnCallbackHandler.MtnCallbackHandlerError =
  MtnCallbackHandlerError;

/* ============================================================================
 * Factory
 * ========================================================================== */

function createMtnCallbackHandler(
  dependencies = {},
) {
  return new MtnCallbackHandler(
    dependencies,
  );
}

/* ============================================================================
 * Exports
 * ========================================================================== */

module.exports =
  MtnCallbackHandler;

module.exports.MtnCallbackHandler =
  MtnCallbackHandler;

module.exports.MtnCallbackHandlerError =
  MtnCallbackHandlerError;

module.exports.createMtnCallbackHandler =
  createMtnCallbackHandler;

module.exports.MTN_PROVIDER =
  MTN_PROVIDER;

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