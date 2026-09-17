'use strict';

/**
 * ==========================================================
 * TITech Community Capital LTD
 * Enterprise MTN MoMo Callback Gateway
 * ----------------------------------------------------------
 * File
 * ----
 * backend/modules/payment/mtn/callbacks.js
 *
 * Architectural Role
 * ------------------
 * Secure ingress/orchestration boundary for MTN MoMo
 * provider callbacks.
 *
 * Callback lifecycle:
 *
 *   HTTP Request
 *        ↓
 *   Header Normalization
 *        ↓
 *   Structural Validation
 *        ↓
 *   Tenant Resolution
 *        ↓
 *   Signature Verification
 *        ↓
 *   Replay / Idempotency Guard
 *        ↓
 *   Callback Processor
 *        ↓
 *   Audit / Event Publication
 *        ↓
 *   HTTP Acknowledgement
 *
 * Responsibilities
 * ----------------
 * - Receive MTN callback payloads.
 * - Normalize provider headers.
 * - Validate callback structure.
 * - Verify provider authenticity/signature.
 * - Protect against replay/duplicate callback processing.
 * - Correlate callbacks with internal transactions.
 * - Delegate callback business processing.
 * - Persist failed/poison callbacks to a dead-letter mechanism.
 * - Produce safe audit events.
 * - Publish integration events after successful processing.
 * - Provide structured observability.
 * - Preserve correlation/request identifiers.
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * - Direct ledger manipulation.
 * - Balance mutation.
 * - Financial settlement.
 * - Payment state-machine ownership.
 * - Reconciliation logic.
 * - Provider HTTP initiation.
 * - Provider business rules.
 * - Credit decisions.
 *
 * Critical Financial Safety Rule
 * ------------------------------
 * A callback being received, authenticated, validated, or processed does
 * NOT itself mean that money settled.
 *
 * Authoritative settlement remains the responsibility of:
 *
 *   provider evidence
 *        +
 *   payment/settlement state machine
 *        +
 *   reconciliation
 *        +
 *   financial transaction service
 *
 * HTTP acknowledgement should therefore never be used as proof of financial
 * settlement.
 *
 * Security Principles
 * -------------------
 * - Never log raw callback payloads by default.
 * - Never log provider signatures.
 * - Never log credentials or authorization headers.
 * - Require tenant scope where the architecture requires it.
 * - Reject unauthenticated callbacks before business processing.
 * - Make duplicate callback handling explicit.
 * - Do not silently convert malformed callbacks into successful processing.
 * - Preserve evidence needed for investigation without storing secrets.
 * - Keep callback ingress independent from ledger mutation.
 *
 * Module Format
 * -------------
 * CommonJS.
 *
 * ==========================================================
 */

const crypto = require('crypto');

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024;
const DEFAULT_PROCESSING_TIMEOUT_MS = 30_000;
const DEFAULT_DLP_STRING_LENGTH = 512;
const DEFAULT_DEAD_LETTER_RETRYABLE = true;

const CALLBACK_EVENTS = Object.freeze({
  RECEIVED: 'MTN_CALLBACK_RECEIVED',
  VALIDATED: 'MTN_CALLBACK_VALIDATED',
  SIGNATURE_REJECTED: 'MTN_CALLBACK_SIGNATURE_REJECTED',
  DUPLICATE: 'MTN_CALLBACK_DUPLICATE',
  PROCESSED: 'MTN_CALLBACK_PROCESSED',
  FAILED: 'MTN_CALLBACK_FAILED',
  DEAD_LETTERED: 'MTN_CALLBACK_DEAD_LETTERED'
});

const CALLBACK_OUTCOMES = Object.freeze({
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  DUPLICATE: 'DUPLICATE',
  FAILED: 'FAILED',
  PENDING: 'PENDING'
});

const ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'MTN_CALLBACK_INVALID_INPUT',
  TENANT_REQUIRED: 'MTN_CALLBACK_TENANT_REQUIRED',
  PAYLOAD_REQUIRED: 'MTN_CALLBACK_PAYLOAD_REQUIRED',
  PAYLOAD_TOO_LARGE: 'MTN_CALLBACK_PAYLOAD_TOO_LARGE',
  VALIDATION_FAILED: 'MTN_CALLBACK_VALIDATION_FAILED',
  SIGNATURE_MISSING: 'MTN_CALLBACK_SIGNATURE_MISSING',
  SIGNATURE_INVALID: 'MTN_CALLBACK_SIGNATURE_INVALID',
  SIGNATURE_VERIFICATION_FAILED:
    'MTN_CALLBACK_SIGNATURE_VERIFICATION_FAILED',
  REPLAY_DETECTED: 'MTN_CALLBACK_REPLAY_DETECTED',
  DUPLICATE_CALLBACK: 'MTN_CALLBACK_DUPLICATE_CALLBACK',
  PROCESSING_FAILED: 'MTN_CALLBACK_PROCESSING_FAILED',
  DEAD_LETTER_FAILED: 'MTN_CALLBACK_DEAD_LETTER_FAILED',
  CONFIGURATION_ERROR: 'MTN_CALLBACK_CONFIGURATION_ERROR'
});

const SECRET_HEADER_PATTERN =
  /(authorization|cookie|set-cookie|token|secret|api[-_]?key|signature)/i;

/* -------------------------------------------------------------------------- */
/* Error                                                                      */
/* -------------------------------------------------------------------------- */

class MTNCallbackError extends Error {
  constructor(
    message,
    code = ERROR_CODES.PROCESSING_FAILED,
    details = undefined,
    options = {}
  ) {
    super(message);

    this.name = 'MTNCallbackError';
    this.code = code;
    this.httpStatus = Number.isFinite(options.httpStatus)
      ? options.httpStatus
      : undefined;
    this.retryable = Boolean(options.retryable);
    this.rejected = Boolean(options.rejected);
    this.duplicate = Boolean(options.duplicate);

    if (details !== undefined) {
      this.details = details;
    }

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MTNCallbackError);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function normalizeString(value, maxLength = DEFAULT_DLP_STRING_LENGTH) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim();

  if (!normalized) {
    return undefined;
  }

  return normalized.length > maxLength
    ? normalized.slice(0, maxLength)
    : normalized;
}

function normalizeId(value) {
  return normalizeString(value, 256);
}

function createCorrelationId() {
  return `mtn-callback-${crypto.randomUUID()}`;
}

function createCallbackReceiptId() {
  return `mtn-cb-${crypto.randomUUID()}`;
}

function safeHeaderValue(value) {
  return normalizeString(value, 2000);
}

function normalizeHeaders(headers = {}) {
  const normalized = {};

  for (const [key, value] of Object.entries(headers || {})) {
    const normalizedKey = String(key).toLowerCase();

    if (Array.isArray(value)) {
      normalized[normalizedKey] = value
        .map((item) => safeHeaderValue(item))
        .filter(Boolean)
        .join(', ');
    } else {
      normalized[normalizedKey] = safeHeaderValue(value);
    }
  }

  return normalized;
}

function getHeader(headers, ...names) {
  const normalized = normalizeHeaders(headers);

  for (const name of names) {
    const key = String(name).toLowerCase();

    if (normalized[key]) {
      return normalized[key];
    }
  }

  return undefined;
}

function hashPayload(payload) {
  const serialized =
    typeof payload === 'string'
      ? payload
      : JSON.stringify(payload ?? null);

  return crypto
    .createHash('sha256')
    .update(serialized, 'utf8')
    .digest('hex');
}

function hashIdentifier(value) {
  if (!value) {
    return undefined;
  }

  return crypto
    .createHash('sha256')
    .update(String(value), 'utf8')
    .digest('hex')
    .slice(0, 24);
}

function sanitizeForLog(value, depth = 0) {
  if (value === null || value === undefined) {
    return value;
  }

  if (depth > 6) {
    return '[TRUNCATED]';
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return typeof value === 'string' && value.length > 512
      ? `${value.slice(0, 512)}...[TRUNCATED]`
      : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      sanitizeForLog(item, depth + 1)
    );
  }

  if (typeof value === 'object') {
    const output = {};

    for (const [key, child] of Object.entries(value)) {
      if (SECRET_HEADER_PATTERN.test(key)) {
        output[key] = '[REDACTED]';
      } else {
        output[key] = sanitizeForLog(child, depth + 1);
      }
    }

    return output;
  }

  return '[REDACTED]';
}

function serializeSafeError(error) {
  if (!error) {
    return undefined;
  }

  return {
    name: normalizeString(error.name, 128),
    code: normalizeString(error.code, 256),
    message: normalizeString(error.message, 1000),
    retryable: Boolean(error.retryable),
    rejected: Boolean(error.rejected),
    duplicate: Boolean(error.duplicate)
  };
}

/**
 * Calculate a fingerprint from the callback's stable business identifiers.
 *
 * This fingerprint is not an authenticity mechanism. Signature verification
 * remains the source of provider-authenticity evidence.
 */
function createCallbackFingerprint({
  payload,
  tenantId,
  providerEventId,
  transactionId
}) {
  return hashPayload({
    provider: 'MTN',
    tenantId: normalizeId(tenantId),
    providerEventId: normalizeId(providerEventId),
    transactionId: normalizeId(transactionId),
    payload
  });
}

/**
 * Promise timeout helper.
 */
async function withTimeout(promise, timeoutMs, message) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  let timer;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new MTNCallbackError(
              message,
              ERROR_CODES.PROCESSING_FAILED,
              undefined,
              {
                httpStatus: 504,
                retryable: true
              }
            )
          );
        }, timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* Dependency helpers                                                         */
/* -------------------------------------------------------------------------- */

function requireDependency(dependency, name) {
  if (!dependency) {
    throw new MTNCallbackError(
      `${name} dependency is not configured.`,
      ERROR_CODES.CONFIGURATION_ERROR,
      { dependency: name },
      {
        httpStatus: 500
      }
    );
  }
}

function resolveLogger(injected) {
  if (injected) {
    return injected;
  }

  const candidates = [
    '../../../utils/logger',
    '../../../utils/log',
    '../../../config/logger'
  ];

  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const loaded = require(candidate);
      const logger = loaded?.default || loaded;

      if (logger) {
        return logger;
      }
    } catch (_error) {
      // Continue.
    }
  }

  return {
    debug() {},
    info() {},
    warn() {},
    error() {}
  };
}

/* -------------------------------------------------------------------------- */
/* MTN Callback Gateway                                                       */
/* -------------------------------------------------------------------------- */

class MTNCallbacks {
  constructor({
    callbackProcessor,
    callbackValidator,
    signatureVerifier,
    deadLetterQueue,
    eventPublisher,
    auditService,
    idempotencyService,
    callbackReplayGuard,
    tenantResolver,
    logger,
    metrics,
    tracer,
    config = {}
  } = {}) {
    this.callbackProcessor = callbackProcessor;
    this.callbackValidator = callbackValidator;
    this.signatureVerifier = signatureVerifier;
    this.deadLetterQueue = deadLetterQueue;
    this.eventPublisher = eventPublisher;
    this.auditService = auditService;
    this.idempotencyService = idempotencyService;
    this.callbackReplayGuard = callbackReplayGuard;
    this.tenantResolver = tenantResolver;

    this.logger = resolveLogger(logger);
    this.metrics = metrics;
    this.tracer = tracer;

    this.config = {
      maxPayloadBytes:
        Number.isFinite(config.maxPayloadBytes) &&
        config.maxPayloadBytes > 0
          ? config.maxPayloadBytes
          : DEFAULT_MAX_PAYLOAD_BYTES,

      processingTimeoutMs:
        Number.isFinite(config.processingTimeoutMs) &&
        config.processingTimeoutMs > 0
          ? config.processingTimeoutMs
          : DEFAULT_PROCESSING_TIMEOUT_MS,

      deadLetterRetryable:
        config.deadLetterRetryable !== undefined
          ? Boolean(config.deadLetterRetryable)
          : DEFAULT_DEAD_LETTER_RETRYABLE,

      requireTenant:
        config.requireTenant !== undefined
          ? Boolean(config.requireTenant)
          : true,

      acknowledgeDuplicates:
        config.acknowledgeDuplicates !== undefined
          ? Boolean(config.acknowledgeDuplicates)
          : true
    };

    this.statistics = {
      received: 0,
      validated: 0,
      signatureRejected: 0,
      duplicates: 0,
      successful: 0,
      failed: 0,
      deadLettered: 0,
      replayRejected: 0
    };
  }

  /**
   * ------------------------------------------------------
   * Resolve tenant safely
   * ------------------------------------------------------
   *
   * A caller-supplied tenantId may be accepted when it has already been
   * established by trusted routing/infrastructure. A public provider callback
   * should ideally use a resolver based on provider identity/configuration.
   */
  async resolveTenant({
    tenantId,
    headers,
    payload
  }) {
    if (tenantId) {
      return normalizeId(tenantId);
    }

    if (!this.config.requireTenant) {
      return undefined;
    }

    if (!this.tenantResolver) {
      throw new MTNCallbackError(
        'MTN callback tenant could not be resolved.',
        ERROR_CODES.TENANT_REQUIRED,
        undefined,
        {
          httpStatus: 400,
          rejected: true
        }
      );
    }

    if (typeof this.tenantResolver.resolveMTN === 'function') {
      const resolved =
        await this.tenantResolver.resolveMTN({
          headers,
          payload
        });

      return normalizeId(
        resolved?.tenantId ||
          resolved?.id ||
          resolved
      );
    }

    if (typeof this.tenantResolver.resolve === 'function') {
      const resolved =
        await this.tenantResolver.resolve({
          provider: 'MTN',
          headers,
          payload
        });

      return normalizeId(
        resolved?.tenantId ||
          resolved?.id ||
          resolved
      );
    }

    throw new MTNCallbackError(
      'MTN callback tenant resolver does not implement a supported contract.',
      ERROR_CODES.CONFIGURATION_ERROR,
      undefined,
      {
        httpStatus: 500
      }
    );
  }

  /**
   * ------------------------------------------------------
   * Extract stable provider identifiers
   * ------------------------------------------------------
   */
  extractIdentifiers(payload = {}, headers = {}) {
    const providerEventId =
      normalizeId(
        payload.eventId ||
          payload.eventID ||
          payload.callbackId ||
          payload.referenceId ||
          payload.requestId ||
          getHeader(
            headers,
            'x-mtn-event-id',
            'x-event-id',
            'x-reference-id'
          )
      );

    const transactionId =
      normalizeId(
        payload.externalId ||
          payload.externalID ||
          payload.transactionId ||
          payload.transactionID ||
          payload.financialTransactionId ||
          payload.providerTransactionId ||
          payload.referenceId
      );

    return {
      providerEventId,
      transactionId
    };
  }

  /**
   * ------------------------------------------------------
   * Validate callback structure
   * ------------------------------------------------------
   */
  async validatePayload(payload, context) {
    if (
      payload === null ||
      payload === undefined
    ) {
      throw new MTNCallbackError(
        'MTN callback payload is required.',
        ERROR_CODES.PAYLOAD_REQUIRED,
        undefined,
        {
          httpStatus: 400,
          rejected: true
        }
      );
    }

    const payloadSize = Buffer.byteLength(
      typeof payload === 'string'
        ? payload
        : JSON.stringify(payload),
      'utf8'
    );

    if (
      payloadSize >
      this.config.maxPayloadBytes
    ) {
      throw new MTNCallbackError(
        'MTN callback payload exceeds the configured size limit.',
        ERROR_CODES.PAYLOAD_TOO_LARGE,
        {
          payloadSize,
          maxPayloadBytes:
            this.config.maxPayloadBytes
        },
        {
          httpStatus: 413,
          rejected: true
        }
      );
    }

    if (!this.callbackValidator) {
      throw new MTNCallbackError(
        'MTN callback validator is not configured.',
        ERROR_CODES.CONFIGURATION_ERROR,
        undefined,
        {
          httpStatus: 500
        }
      );
    }

    try {
      if (
        typeof this.callbackValidator.validate ===
        'function'
      ) {
        const result =
          await this.callbackValidator.validate(
            payload,
            context
          );

        return result === undefined
          ? true
          : result;
      }

      if (
        typeof this.callbackValidator.validateAsync ===
        'function'
      ) {
        const result =
          await this.callbackValidator.validateAsync(
            payload,
            context
          );

        return result === undefined
          ? true
          : result;
      }

      throw new MTNCallbackError(
        'MTN callback validator does not expose a supported validation method.',
        ERROR_CODES.CONFIGURATION_ERROR,
        undefined,
        {
          httpStatus: 500
        }
      );
    } catch (error) {
      if (
        error instanceof
        MTNCallbackError
      ) {
        throw error;
      }

      throw new MTNCallbackError(
        'MTN callback payload validation failed.',
        ERROR_CODES.VALIDATION_FAILED,
        {
          causeCode:
            normalizeString(
              error?.code,
              128
            )
        },
        {
          httpStatus: 400,
          rejected: true
        }
      );
    }
  }

  /**
   * ------------------------------------------------------
   * Verify provider signature
   * ------------------------------------------------------
   */
  async verifySignature({
    payload,
    headers,
    tenantId,
    correlationId
  }) {
    requireDependency(
      this.signatureVerifier,
      'signatureVerifier'
    );

    const signature =
      getHeader(
        headers,
        'x-mtn-signature',
        'x-momo-signature',
        'x-signature',
        'signature'
      );

    if (!signature) {
      throw new MTNCallbackError(
        'MTN callback signature is missing.',
        ERROR_CODES.SIGNATURE_MISSING,
        undefined,
        {
          httpStatus: 401,
          rejected: true
        }
      );
    }

    try {
      let verified;

      if (
        typeof this.signatureVerifier.verify ===
        'function'
      ) {
        verified =
          await this.signatureVerifier.verify({
            provider:
              'MTN',
            payload,
            headers,
            signature,
            tenantId,
            correlationId
          });
      } else if (
        typeof this.signatureVerifier.verifySignature ===
        'function'
      ) {
        verified =
          await this.signatureVerifier.verifySignature({
            provider:
              'MTN',
            payload,
            headers,
            signature,
            tenantId,
            correlationId
          });
      } else {
        throw new MTNCallbackError(
          'MTN signature verifier does not expose a supported verification method.',
          ERROR_CODES.CONFIGURATION_ERROR,
          undefined,
          {
            httpStatus: 500
          }
        );
      }

      if (
        verified === true ||
        verified?.valid === true
      ) {
        return {
          verified: true,
          algorithm:
            verified?.algorithm,
          keyId:
            verified?.keyId
        };
      }

      throw new MTNCallbackError(
        'Invalid MTN callback signature.',
        ERROR_CODES.SIGNATURE_INVALID,
        undefined,
        {
          httpStatus: 401,
          rejected: true
        }
      );
    } catch (error) {
      if (
        error instanceof
        MTNCallbackError
      ) {
        throw error;
      }

      throw new MTNCallbackError(
        'MTN callback signature verification failed.',
        ERROR_CODES.SIGNATURE_VERIFICATION_FAILED,
        undefined,
        {
          httpStatus: 401,
          rejected: true
        }
      );
    }
  }

  /**
   * ------------------------------------------------------
   * Replay / duplicate guard
   * ------------------------------------------------------
   */
  async checkReplay({
    tenantId,
    providerEventId,
    transactionId,
    fingerprint,
    correlationId
  }) {
    const key =
      providerEventId ||
      fingerprint ||
      transactionId;

    if (!key) {
      /*
       * Do not fabricate a unique identifier from the current timestamp.
       * If the provider gives no stable identifier, duplicate detection
       * should be explicitly delegated to the processor/business layer.
       */
      return {
        checked: false,
        duplicate: false
      };
    }

    if (
      this.callbackReplayGuard
    ) {
      if (
        typeof this.callbackReplayGuard.checkAndReserve ===
        'function'
      ) {
        const result =
          await this.callbackReplayGuard.checkAndReserve({
            provider:
              'MTN',
            tenantId,
            providerEventId,
            transactionId,
            fingerprint,
            correlationId,
            key
          });

        if (
          result?.duplicate === true ||
          result?.replayed === true
        ) {
          return {
            checked: true,
            duplicate: true,
            source: 'replay-guard',
            result
          };
        }

        return {
          checked: true,
          duplicate: false,
          source: 'replay-guard',
          result
        };
      }

      if (
        typeof this.callbackReplayGuard.check ===
        'function'
      ) {
        const result =
          await this.callbackReplayGuard.check({
            provider:
              'MTN',
            tenantId,
            providerEventId,
            transactionId,
            fingerprint,
            correlationId,
            key
          });

        return {
          checked: true,
          duplicate:
            result?.duplicate === true ||
            result === true,
          source: 'replay-guard',
          result
        };
      }
    }

    if (
      this.idempotencyService
    ) {
      if (
        typeof this.idempotencyService.check ===
        'function'
      ) {
        const result =
          await this.idempotencyService.check({
            tenantId,
            provider:
              'MTN',
            idempotencyKey:
              `mtn-callback:${key}`,
            requestFingerprint:
              fingerprint
          });

        return {
          checked: true,
          duplicate:
            Boolean(
              result?.duplicate ||
              result?.processed ||
              result?.completed
            ),
          source:
            'idempotency-service',
          result
        };
      }

      if (
        typeof this.idempotencyService.get ===
        'function'
      ) {
        const result =
          await this.idempotencyService.get({
            tenantId,
            provider:
              'MTN',
            idempotencyKey:
              `mtn-callback:${key}`
          });

        return {
          checked: true,
          duplicate:
            Boolean(
              result?.duplicate ||
              result?.processed ||
              result?.completed
            ),
          source:
            'idempotency-service',
          result
        };
      }
    }

    /*
     * No infrastructure guard available. The callback processor remains
     * responsible for its own business-idempotency.
     */
    return {
      checked: false,
      duplicate: false,
      source: 'processor'
    };
  }

  /**
   * ------------------------------------------------------
   * Record duplicate safely
   * ------------------------------------------------------
   */
  async recordDuplicate({
    tenantId,
    providerEventId,
    transactionId,
    fingerprint,
    correlationId
  }) {
    this.statistics.duplicates += 1;

    this.metrics?.counter?.(
      'payment_mtn_callback_duplicate_total',
      {
        tenantId
      }
    );

    await this.audit(
      CALLBACK_EVENTS.DUPLICATE,
      {
        tenantId,
        transactionId,
        correlationId,
        metadata: {
          provider:
            'MTN',
          providerEventId:
            hashIdentifier(
              providerEventId
            ),
          fingerprint
        }
      }
    );

    return {
      success: true,
      duplicate: true,
      acknowledged:
        this.config.acknowledgeDuplicates,
      correlationId,
      transactionId
    };
  }

  /**
   * ------------------------------------------------------
   * Process callback
   * ------------------------------------------------------
   */
  async processCallback({
    headers,
    payload,
    tenantId,
    correlationId,
    providerEventId,
    transactionId,
    fingerprint,
    signatureMetadata
  }) {
    requireDependency(
      this.callbackProcessor,
      'callbackProcessor'
    );

    const processorContext = {
      provider:
        'MTN',

      tenantId,

      correlationId,

      providerEventId,

      transactionId,

      callbackFingerprint:
        fingerprint,

      signatureVerified:
        true,

      signatureAlgorithm:
        signatureMetadata?.algorithm,

      signatureKeyId:
        signatureMetadata?.keyId
    };

    const processorInput = {
      headers,
      payload,
      tenantId,
      correlationId,
      providerEventId,
      transactionId,
      fingerprint,
      context:
        processorContext
    };

    if (
      typeof this.callbackProcessor.process !==
      'function'
    ) {
      throw new MTNCallbackError(
        'MTN callback processor does not expose a supported process method.',
        ERROR_CODES.CONFIGURATION_ERROR,
        undefined,
        {
          httpStatus: 500
        }
      );
    }

    return withTimeout(
      this.callbackProcessor.process(
        processorInput
      ),
      this.config.processingTimeoutMs,
      'MTN callback processing timed out.'
    );
  }

  /**
   * ------------------------------------------------------
   * Audit adapter
   * ------------------------------------------------------
   */
  async audit(
    eventType,
    payload
  ) {
    if (
      !this.auditService
    ) {
      return;
    }

    const safePayload =
      sanitizeForLog(
        payload
      );

    try {
      if (
        typeof this.auditService.recordEvent ===
        'function'
      ) {
        await this.auditService.recordEvent(
          eventType,
          safePayload
        );

        return;
      }

      if (
        typeof this.auditService.record ===
        'function'
      ) {
        await this.auditService.record({
          ...safePayload,
          eventType
        });
      }
    } catch (error) {
      /*
       * Audit infrastructure should not transform a provider callback into
       * a fabricated financial failure. The callback's authoritative
       * business processor determines financial state.
       */
      this.logger.error?.(
        {
          provider:
            'MTN',
          eventType,
          tenantId:
            payload?.tenantId,
          correlationId:
            payload?.correlationId,
          error:
            serializeSafeError(
              error
            )
        },
        'Failed to persist MTN callback audit event'
      );
    }
  }

  /**
   * ------------------------------------------------------
   * Publish processed event
   * ------------------------------------------------------
   */
  async publishProcessedEvent({
    tenantId,
    correlationId,
    transactionId,
    providerEventId,
    result
  }) {
    if (
      !this.eventPublisher
    ) {
      return {
        published:
          false,
        skipped:
          true
      };
    }

    const event = {
      type:
        CALLBACK_EVENTS.PROCESSED,

      provider:
        'MTN',

      tenantId,

      correlationId,

      occurredAt:
        new Date(),

      payload: {
        transactionId,
        providerEventId:
          hashIdentifier(
            providerEventId
          ),
        /*
         * Do not publish the entire provider callback.
         */
        result: sanitizeForLog({
          id:
            result?.id ||
            result?._id,
          status:
            result?.status,
          state:
            result?.state,
          outcome:
            result?.outcome
        })
      }
    };

    if (
      typeof this.eventPublisher.publish !==
      'function'
    ) {
      throw new MTNCallbackError(
        'MTN callback event publisher does not expose publish().',
        ERROR_CODES.CONFIGURATION_ERROR,
        undefined,
        {
          httpStatus: 500
        }
      );
    }

    await this.eventPublisher.publish(
      event
    );

    return {
      published:
        true
    };
  }

  /**
   * ------------------------------------------------------
   * Dead-letter failed callback
   * ------------------------------------------------------
   */
  async deadLetter({
    headers,
    payload,
    tenantId,
    correlationId,
    providerEventId,
    transactionId,
    fingerprint,
    error
  }) {
    if (
      !this.deadLetterQueue
    ) {
      this.logger.error?.(
        {
          provider:
            'MTN',
          tenantId,
          correlationId,
          transactionId,
          providerEventId:
            hashIdentifier(
              providerEventId
            ),
          error:
            serializeSafeError(
              error
            )
        },
        'MTN callback dead-letter queue is unavailable'
      );

      return {
        stored:
          false,
        unavailable:
          true
      };
    }

    /*
     * Never place sensitive headers or arbitrary credentials into the DLQ
     * without an explicit secure-storage contract.
     */
    const safeHeaders = {};

    for (
      const [key, value] of Object.entries(
        normalizeHeaders(
          headers
        )
      )
    ) {
      safeHeaders[key] =
        SECRET_HEADER_PATTERN.test(
          key
        )
          ? '[REDACTED]'
          : value;
    }

    const entry = {
      provider:
        'MTN',

      callbackReceiptId:
        createCallbackReceiptId(),

      tenantId,

      correlationId,

      providerEventId:
        providerEventId ||
        undefined,

      transactionId,

      fingerprint,

      payload:
        sanitizeForLog(
          payload
        ),

      headers:
        safeHeaders,

      error:
        serializeSafeError(
          error
        ),

      retryable:
        error?.retryable !==
        undefined
          ? Boolean(
              error.retryable
            )
          : this.config
              .deadLetterRetryable,

      occurredAt:
        new Date()
    };

    try {
      if (
        typeof this.deadLetterQueue.store ===
        'function'
      ) {
        await this.deadLetterQueue.store(
          entry
        );
      } else if (
        typeof this.deadLetterQueue.enqueue ===
        'function'
      ) {
        await this.deadLetterQueue.enqueue(
          entry
        );
      } else {
        throw new MTNCallbackError(
          'MTN callback dead-letter queue does not expose a supported storage method.',
          ERROR_CODES.DEAD_LETTER_FAILED
        );
      }

      this.statistics.deadLettered +=
        1;

      this.metrics?.counter?.(
        'payment_mtn_callback_dead_letter_total',
        {
          tenantId
        }
      );

      await this.audit(
        CALLBACK_EVENTS.DEAD_LETTERED,
        {
          tenantId,
          transactionId,
          correlationId,
          metadata: {
            provider:
              'MTN',
            providerEventId:
              hashIdentifier(
                providerEventId
              ),
            callbackFingerprint:
              fingerprint,
            errorCode:
              error?.code
          }
        }
      );

      return {
        stored:
          true
      };
    } catch (dlqError) {
      this.metrics?.counter?.(
        'payment_mtn_callback_dead_letter_failure_total',
        {
          tenantId
        }
      );

      this.logger.error?.(
        {
          provider:
            'MTN',
          tenantId,
          correlationId,
          transactionId,
          error:
            serializeSafeError(
              dlqError
            )
        },
        'Failed to store MTN callback in dead-letter queue'
      );

      return {
        stored:
          false,
        unavailable:
          true
      };
    }
  }

  /**
   * ------------------------------------------------------
   * Main callback ingress
   * ------------------------------------------------------
   */
  async handle({
    headers = {},
    payload,
    tenantId = null,
    correlationId = createCorrelationId(),
    requestId
  } = {}) {
    const span =
      this.tracer?.startSpan?.(
        'payment.mtn.callback.handle'
      );

    this.statistics.received +=
      1;

    this.metrics?.counter?.(
      'payment_mtn_callback_received_total'
    );

    const normalizedHeaders =
      normalizeHeaders(
        headers
      );

    const callbackReceiptId =
      createCallbackReceiptId();

    const context = {
      provider:
        'MTN',

      callbackReceiptId,

      requestId:
        normalizeId(
          requestId
        ),

      correlationId,

      tenantId:
        normalizeId(
          tenantId
        )
    };

    try {
      this.logger.info?.(
        {
          provider:
            'MTN',
          callbackReceiptId,
          tenantId:
            context.tenantId,
          correlationId,
          requestId:
            context.requestId
        },
        'MTN callback received'
      );

      /*
       * 1. Tenant resolution
       */
      const resolvedTenantId =
        await this.resolveTenant({
          tenantId,
          headers:
            normalizedHeaders,
          payload
        });

      context.tenantId =
        resolvedTenantId;

      /*
       * 2. Structural validation
       */
      await this.validatePayload(
        payload,
        context
      );

      this.statistics.validated +=
        1;

      this.metrics?.counter?.(
        'payment_mtn_callback_validated_total',
        {
          tenantId:
            resolvedTenantId
        }
      );

      const {
        providerEventId,
        transactionId
      } =
        this.extractIdentifiers(
          payload,
          normalizedHeaders
        );

      const fingerprint =
        createCallbackFingerprint({
          payload,
          tenantId:
            resolvedTenantId,
          providerEventId,
          transactionId
        });

      await this.audit(
        CALLBACK_EVENTS.RECEIVED,
        {
          tenantId:
            resolvedTenantId,

          correlationId,

          transactionId,

          metadata: {
            provider:
              'MTN',

            callbackReceiptId,

            providerEventId:
              hashIdentifier(
                providerEventId
              ),

            callbackFingerprint:
              fingerprint,

            payloadSize:
              Buffer.byteLength(
                typeof payload ===
                  'string'
                  ? payload
                  : JSON.stringify(
                      payload
                    ),
                'utf8'
              )
          }
        }
      );

      /*
       * 3. Signature verification
       */
      const signatureMetadata =
        await this.verifySignature({
          payload,
          headers:
            normalizedHeaders,
          tenantId:
            resolvedTenantId,
          correlationId
        });

      this.metrics?.counter?.(
        'payment_mtn_callback_signature_success_total',
        {
          tenantId:
            resolvedTenantId
        }
      );

      await this.audit(
        CALLBACK_EVENTS.VALIDATED,
        {
          tenantId:
            resolvedTenantId,

          correlationId,

          transactionId,

          metadata: {
            provider:
              'MTN',

            callbackReceiptId,

            providerEventId:
              hashIdentifier(
                providerEventId
              ),

            callbackFingerprint:
              fingerprint,

            signatureVerified:
              true,

            signatureAlgorithm:
              signatureMetadata?.algorithm,

            signatureKeyId:
              signatureMetadata?.keyId
          }
        }
      );

      /*
       * 4. Replay / duplicate guard
       *
       * Signature must be verified before this point. Otherwise an attacker
       * could poison the duplicate cache using unauthenticated traffic.
       */
      const replayResult =
        await this.checkReplay({
          tenantId:
            resolvedTenantId,
          providerEventId,
          transactionId,
          fingerprint,
          correlationId
        });

      if (
        replayResult.duplicate
      ) {
        return this.recordDuplicate({
          tenantId:
            resolvedTenantId,
          providerEventId,
          transactionId,
          fingerprint,
          correlationId
        });
      }

      /*
       * 5. Delegate authoritative callback processing.
       *
       * The processor remains responsible for translating the callback into
       * the payment/settlement lifecycle. This gateway does not post money.
       */
      const result =
        await this.processCallback({
          headers:
            normalizedHeaders,

          payload,

          tenantId:
            resolvedTenantId,

          correlationId,

          providerEventId,

          transactionId,

          fingerprint,

          signatureMetadata
        });

      /*
       * 6. Publish an integration event after the processor succeeds.
       *
       * The event itself is not the financial source of truth.
       */
      try {
        await this.publishProcessedEvent({
          tenantId:
            resolvedTenantId,

          correlationId,

          transactionId,

          providerEventId,

          result
        });
      } catch (
        publishError
      ) {
        /*
         * If event publishing is required to be atomic with financial state,
         * the repository should replace this direct publisher with a
         * transactional outbox. We do not turn a successfully processed
         * financial callback into an invented failure solely because a
         * non-authoritative notification path failed.
         */
        this.logger.error?.(
          {
            provider:
              'MTN',
            tenantId:
              resolvedTenantId,
            correlationId,
            transactionId,
            error:
              serializeSafeError(
                publishError
              )
          },
          'MTN callback event publication failed'
        );

        this.metrics?.counter?.(
          'payment_mtn_callback_event_publish_failure_total',
          {
            tenantId:
              resolvedTenantId
          }
        );
      }

      /*
       * 7. Audit successful callback processing.
       */
      await this.audit(
        CALLBACK_EVENTS.PROCESSED,
        {
          tenantId:
            resolvedTenantId,

          correlationId,

          transactionId,

          metadata: {
            provider:
              'MTN',

            callbackReceiptId,

            providerEventId:
              hashIdentifier(
                providerEventId
              ),

            callbackFingerprint:
              fingerprint,

            processorResult: {
              id:
                result?.id ||
                result?._id,

              status:
                result?.status,

              state:
                result?.state,

              outcome:
                result?.outcome
            }
          }
        }
      );

      this.statistics.successful +=
        1;

      this.metrics?.counter?.(
        'payment_mtn_callback_success_total',
        {
          tenantId:
            resolvedTenantId
        }
      );

      return {
        success:
          true,

        correlationId,

        callbackReceiptId,

        transactionId:
          result?.id ||
          result?._id ||
          transactionId,

        /*
         * Do not expose or imply a financial settlement status here unless
         * the callback processor explicitly returns one.
         */
        status:
          result?.status,

        acknowledged:
          true
      };
    } catch (
      error
    ) {
      const normalized =
        normalizeCallbackError(
          error
        );

      if (
        normalized.rejected
      ) {
        this.statistics.rejected =
          (this.statistics.rejected || 0) +
          1;

        this.metrics?.counter?.(
          'payment_mtn_callback_rejected_total',
          {
            tenantId:
              context.tenantId,
            code:
              normalized.code
          }
        );
      } else {
        this.statistics.failed +=
          1;

        this.metrics?.counter?.(
          'payment_mtn_callback_failure_total',
          {
            tenantId:
              context.tenantId,
            code:
              normalized.code
          }
        );
      }

      await this.audit(
        normalized.rejected
          ? CALLBACK_EVENTS.SIGNATURE_REJECTED
          : CALLBACK_EVENTS.FAILED,
        {
          tenantId:
            context.tenantId,

          correlationId,

          metadata: {
            provider:
              'MTN',

            callbackReceiptId,

            transactionId:
              this.extractIdentifiers(
                payload,
                normalizedHeaders
              ).transactionId,

            error:
              serializeSafeError(
                normalized
              )
          }
        }
      );

      /*
       * Do not dead-letter authentication failures by default if the callback
       * was never verified. Storing attacker-controlled unauthenticated
       * payloads can become a persistence/DoS vector.
       */
      if (
        normalized.rejected &&
        (
          normalized.code ===
            ERROR_CODES.SIGNATURE_MISSING ||
          normalized.code ===
            ERROR_CODES.SIGNATURE_INVALID ||
          normalized.code ===
            ERROR_CODES.SIGNATURE_VERIFICATION_FAILED
        )
      ) {
        this.logger.warn?.(
          {
            provider:
              'MTN',
            tenantId:
              context.tenantId,
            correlationId,
            callbackReceiptId,
            code:
              normalized.code
          },
          'Rejected unauthenticated MTN callback'
        );
      } else {
        await this.deadLetter({
          headers:
            normalizedHeaders,

          payload,

          tenantId:
            context.tenantId,

          correlationId,

          providerEventId:
            this.extractIdentifiers(
              payload,
              normalizedHeaders
            ).providerEventId,

          transactionId:
            this.extractIdentifiers(
              payload,
              normalizedHeaders
            ).transactionId,

          fingerprint:
            payload !==
            undefined
              ? hashPayload(
                  payload
                )
              : undefined,

          error:
            normalized
        });
      }

      this.logger.error?.(
        {
          provider:
            'MTN',

          tenantId:
            context.tenantId,

          correlationId,

          callbackReceiptId,

          error:
            serializeSafeError(
              normalized
            )
        },
        'MTN callback processing failed'
      );

      throw normalized;
    } finally {
      span?.setAttribute?.(
        'payment.provider',
        'MTN'
      );

      span?.setAttribute?.(
        'payment.callback',
        true
      );

      span?.end?.();
    }
  }

  /**
   * ------------------------------------------------------
   * Express middleware adapter
   * ------------------------------------------------------
   */
  middleware() {
    return async (req, res, next) => {
      const correlationId =
        normalizeId(
          req.id ||
            req.headers?.['x-correlation-id'] ||
            req.headers?.['x-request-id']
        ) ||
        createCorrelationId();

      try {
        const result =
          await this.handle({
            headers:
              req.headers,

            payload:
              req.body,

            tenantId:
              req.tenantId ||
              req.context?.tenantId,

            correlationId,

            requestId:
              req.id ||
              req.requestId
          });

        /*
         * Provider callbacks generally require a timely acknowledgement.
         * The HTTP response must not claim financial settlement semantics.
         */
        return res.status(200).json({
          success:
            true,

          correlationId,

          acknowledged:
            true,

          callback:
            result
        });
      } catch (
        error
      ) {
        const status =
          Number.isFinite(
            error?.httpStatus
          )
            ? error.httpStatus
            : mapCallbackHttpStatus(
                error
              );

        const response = {
          success:
            false,

          correlationId,

          error: {
            code:
              error?.code ||
              ERROR_CODES.PROCESSING_FAILED,

            message:
              safeClientMessage(
                error
              )
          }
        };

        /*
         * Do not leak stack traces, provider secrets, raw payloads, or
         * internal dependency details through callback responses.
         */
        if (
          res.headersSent
        ) {
          return undefined;
        }

        const sent =
          res
            .status(
              status
            )
            .json(
              response
            );

        /*
         * If an Express error middleware is intentionally installed, callers
         * may opt into next(error) instead. The default here is to terminate
         * the callback response deterministically.
         */
        if (
          typeof next ===
            'function' &&
          req.callbackUseNextOnError ===
            true
        ) {
          next(error);
        }

        return sent;
      }
    };
  }

  /**
   * ------------------------------------------------------
   * Health
   * ------------------------------------------------------
   */
  health() {
    const dependencies = {
      callbackProcessor:
        Boolean(
          this.callbackProcessor
        ),

      callbackValidator:
        Boolean(
          this.callbackValidator
        ),

      signatureVerifier:
        Boolean(
          this.signatureVerifier
        ),

      deadLetterQueue:
        Boolean(
          this.deadLetterQueue
        ),

      eventPublisher:
        Boolean(
          this.eventPublisher
        ),

      auditService:
        Boolean(
          this.auditService
        ),

      idempotencyService:
        Boolean(
          this.idempotencyService
        ),

      callbackReplayGuard:
        Boolean(
          this.callbackReplayGuard
        ),

      tenantResolver:
        Boolean(
          this.tenantResolver
        )
    };

    const requiredReady =
      dependencies.callbackProcessor &&
      dependencies.callbackValidator &&
      dependencies.signatureVerifier;

    let status =
      requiredReady
        ? 'UP'
        : 'DEGRADED';

    if (
      !requiredReady
    ) {
      status =
        'DOWN';
    }

    return {
      provider:
        'MTN',

      module:
        'callbacks',

      status,

      requiredDependenciesReady:
        requiredReady,

      dependencies,

      statistics: {
        ...this.statistics
      },

      configuration: {
        maxPayloadBytes:
          this.config.maxPayloadBytes,

        processingTimeoutMs:
          this.config.processingTimeoutMs,

        requireTenant:
          this.config.requireTenant,

        acknowledgeDuplicates:
          this.config.acknowledgeDuplicates
      }
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Error normalization                                                        */
/* -------------------------------------------------------------------------- */

function normalizeCallbackError(
  error
) {
  if (
    error instanceof
    MTNCallbackError
  ) {
    return error;
  }

  /*
   * Preserve existing enterprise error contracts when available without
   * creating a hard dependency on the repository's shared error module.
   */
  let normalized = error;

  try {
    // eslint-disable-next-line global-require
    const shared =
      require('../shared/errors');

    if (
      typeof shared.normalizeError ===
      'function'
    ) {
      normalized =
        shared.normalizeError(
          error,
          {
            provider:
              'MTN'
          }
        );
    }
  } catch (
    _error
  ) {
    // Fall back to the local normalization contract.
  }

  return new MTNCallbackError(
    normalizeString(
      normalized?.message,
      1000
    ) ||
      'MTN callback processing failed.',

    normalizeString(
      normalized?.code,
      256
    ) ||
      ERROR_CODES.PROCESSING_FAILED,

    undefined,

    {
      httpStatus:
        Number.isFinite(
          normalized?.httpStatus
        )
          ? normalized.httpStatus
          : undefined,

      retryable:
        Boolean(
          normalized?.retryable
        ),

      rejected:
        Boolean(
          normalized?.rejected
        ),

      duplicate:
        Boolean(
          normalized?.duplicate
        )
    }
  );
}

function mapCallbackHttpStatus(
  error
) {
  if (
    error?.rejected
  ) {
    return (
      Number.isFinite(
        error.httpStatus
      )
        ? error.httpStatus
        : 401
    );
  }

  switch (
    error?.code
  ) {
    case ERROR_CODES.PAYLOAD_REQUIRED:
    case ERROR_CODES.VALIDATION_FAILED:
      return 400;

    case ERROR_CODES.PAYLOAD_TOO_LARGE:
      return 413;

    case ERROR_CODES.SIGNATURE_MISSING:
    case ERROR_CODES.SIGNATURE_INVALID:
    case ERROR_CODES.SIGNATURE_VERIFICATION_FAILED:
      return 401;

    case ERROR_CODES.TENANT_REQUIRED:
      return 400;

    case ERROR_CODES.REPLAY_DETECTED:
      return 409;

    case ERROR_CODES.DUPLICATE_CALLBACK:
      return 200;

    case ERROR_CODES.PROCESSING_FAILED:
      return 500;

    default:
      return 500;
  }
}

function safeClientMessage(
  error
) {
  if (
    error?.duplicate
  ) {
    return 'Callback already processed.';
  }

  if (
    error?.rejected
  ) {
    if (
      error.code ===
        ERROR_CODES.SIGNATURE_MISSING ||
      error.code ===
        ERROR_CODES.SIGNATURE_INVALID ||
      error.code ===
        ERROR_CODES.SIGNATURE_VERIFICATION_FAILED
    ) {
      return 'Callback authentication failed.';
    }

    return 'Callback request was rejected.';
  }

  if (
    error?.code ===
    ERROR_CODES.PAYLOAD_TOO_LARGE
  ) {
    return 'Callback payload is too large.';
  }

  if (
    error?.code ===
    ERROR_CODES.VALIDATION_FAILED
  ) {
    return 'Callback payload is invalid.';
  }

  /*
   * Do not expose provider/internal dependency details to the callback
   * sender by default.
   */
  return 'Callback processing failed.';
}

/* -------------------------------------------------------------------------- */
/* Exports                                                                    */
/* -------------------------------------------------------------------------- */

module.exports =
  MTNCallbacks;

module.exports.MTNCallbacks =
  MTNCallbacks;

module.exports.MTNCallbackError =
  MTNCallbackError;

module.exports.CALLBACK_EVENTS =
  CALLBACK_EVENTS;

module.exports.CALLBACK_OUTCOMES =
  CALLBACK_OUTCOMES;

module.exports.ERROR_CODES =
  ERROR_CODES;