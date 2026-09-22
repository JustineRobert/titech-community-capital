/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Callback Validator
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/callbacks/callbackValidator.js
 *
 * Architectural role
 * ------------------
 * Canonical validation/security-admission boundary for inbound Airtel callback
 * messages after HTTP transport parsing and before correlation/processing.
 *
 * Canonical flow
 * --------------
 * Airtel callback
 *      -> callbackController transport guard
 *      -> signature verification (controller OR this validator)
 *      -> THIS VALIDATOR
 *      -> schema + freshness + replay validation
 *      -> callbackNormalizer
 *      -> callbackCorrelation
 *      -> callbackDispatcher / callbackProcessor
 *
 * Responsibilities
 * ----------------
 * - Validate trusted tenant context.
 * - Validate callback payload shape and bounded size.
 * - Consume trusted signature-verification evidence or invoke the configured
 *   signature verifier when this module owns that boundary.
 * - Validate provider callback schema.
 * - Validate callback freshness/timestamp constraints.
 * - Protect against callback replay through an injected replay/idempotency guard.
 * - Normalize a callback through the canonical normalizer when supplied.
 * - Extract safe fraud/risk signals without becoming the final fraud authority.
 * - Return stable validation status and evidence for the controller.
 * - Publish sanitized audit/events and metrics.
 * - Provide health/readiness/diagnostics/lifecycle information.
 *
 * Explicitly NOT responsible for
 * -------------------------------
 * - HTTP request/response handling.
 * - Airtel OAuth.
 * - Callback correlation or transaction lookup.
 * - Payment execution.
 * - Financial ledger posting.
 * - Balance/wallet mutation.
 * - Settlement finality.
 * - Reconciliation adjudication.
 * - Direct provider API calls other than an injected signature-verifier
 *   boundary when explicitly configured for signature ownership.
 *
 * Security principles
 * -------------------
 * 1. Tenant identity comes from trusted execution context; payload.tenantId is
 *    never accepted as tenant authority.
 * 2. An indeterminate signature result is rejected fail-closed.
 * 3. An already-verified callback is not downgraded merely because a separate
 *    validator instance cannot independently see the raw signature.
 * 4. When signature ownership is delegated to this validator, a synthetic
 *    delegated result from the controller is NOT cryptographic proof; the
 *    validator performs the actual signature verification.
 * 5. Replay protection is performed only after cryptographic/schema validation.
 * 6. Replay reservation is atomic when the injected guard supports it; a plain
 *    exists()+store() pair is not considered production-authoritative unless
 *    explicitly allowed by configuration.
 * 7. Timestamp checks reject future/expired callbacks outside configured skew.
 * 8. Validation failures contain safe identifiers only; raw callback payloads,
 *    credentials and signatures are never written to audit/log/event output.
 * 9. Validation never mutates financial state.
 *
 * Module format
 * -------------
 * Native ESM. No external dependencies.
 * =============================================================================
 */

import crypto from 'node:crypto';

export const PROVIDER = 'AIRTEL';
export const OPERATION = 'CALLBACK';
export const COMPONENT = 'titech.airtel.callbacks.validator';
export const ENGINE_NAME = 'airtel-callback-validator';
export const ENGINE_VERSION = '5.0.0';
export const SCHEMA_VERSION = 5;
export const FINANCIAL_BOUNDARY = 'TITECH_FINANCIAL_CORE';

export const VALIDATION_STATUS = Object.freeze({
  VALID: 'VALID',
  INVALID: 'INVALID',
  REPLAY: 'REPLAY',
  UNAUTHORIZED: 'UNAUTHORIZED',
  REVIEW: 'REVIEW',
});

export const SECURITY_STATUS = Object.freeze({
  VERIFIED: 'VERIFIED',
  INVALID: 'INVALID',
  MISSING: 'MISSING',
  UNAVAILABLE: 'UNAVAILABLE',
  INDETERMINATE: 'INDETERMINATE',
  DELEGATED: 'DELEGATED',
});

export const FRAUD_SIGNAL = Object.freeze({
  HIGH_VALUE_TRANSACTION: 'HIGH_VALUE_TRANSACTION',
  STALE_TIMESTAMP: 'STALE_TIMESTAMP',
  FUTURE_TIMESTAMP: 'FUTURE_TIMESTAMP',
  DUPLICATE_CALLBACK: 'DUPLICATE_CALLBACK',
  UNKNOWN_REFERENCE: 'UNKNOWN_REFERENCE',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  VALIDATION_REVIEW: 'VALIDATION_REVIEW',
});

export const CALLBACK_OUTCOME = Object.freeze({
  SUCCESS: 'SUCCESS',
  PENDING: 'PENDING',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REVERSED: 'REVERSED',
  UNKNOWN: 'UNKNOWN',
});

export const DEFAULTS = Object.freeze({
  maxCallbackAgeSeconds: 300,
  maxFutureSkewSeconds: 30,
  maxCallbackBytes: 1024 * 1024,
  maxMetadataBytes: 64 * 1024,
  maxAmountThresholdMinor: 10_000_000,
  maxAmountThreshold: 10_000_000,
  requireTenantId: true,
  requireSignatureVerification: true,
  validatorOwnsSignature: false,
  failClosedOnMissingSignatureVerifier: true,
  failClosedOnReplayGuardUnavailable: true,
  failClosedOnSchemaValidatorUnavailable: true,
  failClosedOnFraudEngineUnavailable: false,
  requireCallbackIdentity: true,
  requireProviderReference: false,
  allowReplayGuardExistsStoreFallback: false,
  allowUnknownProvider: false,
  publishEvents: true,
  audit: true,
  failClosedOnAuditError: false,
  failClosedOnEventError: false,
  requireFreshTimestamp: false,
  defaultCurrency: 'UGX',
});

const SENSITIVE_KEY =
  /authorization|proxy.?authorization|cookie|set-cookie|password|secret|token|signature|private.?key|api.?key|credential|otp|pin|cvv|cvc|pan|raw.?body|raw.?payload|request.?body|response.?body/i;

const BLOCKED_KEYS =
  new Set([
    '__proto__',
    'prototype',
    'constructor',
  ]);

function isObject(value) {
  return (
    value !== null &&
    typeof value === 'object'
  );
}

function isFunction(value) {
  return typeof value === 'function';
}

function now(clock) {
  const value =
    isFunction(clock?.now)
      ? clock.now()
      : Date.now();

  return new Date(value);
}

function normalizeString(
  value,
  maxLength = 1024,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const output =
    String(value).trim();

  return output
    ? output.slice(0, maxLength)
    : null;
}

function normalizeUpper(
  value,
  maxLength = 128,
) {
  const output =
    normalizeString(
      value,
      maxLength,
    );

  return output
    ? output.toUpperCase()
    : null;
}

function safeClone(
  value,
  depth = 0,
) {
  if (depth > 8) {
    return '[DEPTH_LIMIT]';
  }

  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return '[BUFFER_REDACTED]';
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value !== 'object') {
    return typeof value === 'bigint'
      ? String(value)
      : value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 250)
      .map((item) =>
        safeClone(
          item,
          depth + 1,
        ),
      );
  }

  const output = {};

  for (
    const [key, child] of
      Object.entries(value)
  ) {
    if (
      BLOCKED_KEYS.has(
        key,
      )
    ) {
      continue;
    }

    if (
      SENSITIVE_KEY.test(
        key,
      )
    ) {
      output[key] =
        '[REDACTED]';

      continue;
    }

    output[key] =
      safeClone(
        child,
        depth + 1,
      );
  }

  return output;
}

function canonicalize(
  value,
  depth = 0,
) {
  if (depth > 10) {
    return '[DEPTH_LIMIT]';
  }

  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return `[BUFFER:${sha256(value)}]`;
  }

  if (typeof value !== 'object') {
    return typeof value === 'bigint'
      ? String(value)
      : value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 500)
      .map((item) =>
        canonicalize(
          item,
          depth + 1,
        ),
      );
  }

  return Object.keys(value)
    .sort()
    .reduce(
      (
        output,
        key,
      ) => {
        if (
          BLOCKED_KEYS.has(
            key,
          )
        ) {
          return output;
        }

        output[key] =
          canonicalize(
            value[key],
            depth + 1,
          );

        return output;
      },
      {},
    );
}

function sha256(value) {
  const input =
    Buffer.isBuffer(value)
      ? value
      : typeof value === 'string'
        ? value
        : JSON.stringify(
            canonicalize(
              value,
            ),
          );

  return crypto
    .createHash(
      'sha256',
    )
    .update(input)
    .digest('hex');
}

function byteLength(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return 0;
  }

  if (Buffer.isBuffer(value)) {
    return value.length;
  }

  if (typeof value === 'string') {
    return Buffer.byteLength(
      value,
      'utf8',
    );
  }

  try {
    return Buffer.byteLength(
      JSON.stringify(value),
      'utf8',
    );
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function firstValue(
  source,
  paths = [],
) {
  for (const path of paths) {
    let current = source;

    for (
      const segment of
        path.split('.')
    ) {
      if (
        !isObject(current) &&
        !Array.isArray(current)
      ) {
        current = undefined;
        break;
      }

      current =
        current?.[
          segment
        ];
    }

    if (
      current !== undefined &&
      current !== null &&
      current !== ''
    ) {
      return current;
    }
  }

  return null;
}

function parsePayload(
  payload,
  maxBytes,
) {
  if (
    payload === undefined ||
    payload === null
  ) {
    throw validatorError(
      'AIRTEL_CALLBACK_PAYLOAD_REQUIRED',
      'Airtel callback payload is required.',
      400,
    );
  }

  if (
    byteLength(payload) >
    maxBytes
  ) {
    throw validatorError(
      'AIRTEL_CALLBACK_PAYLOAD_TOO_LARGE',
      'Airtel callback payload exceeds the configured limit.',
      413,
    );
  }

  if (Buffer.isBuffer(payload)) {
    try {
      return JSON.parse(
        payload.toString(
          'utf8',
        ),
      );
    } catch (error) {
      throw validatorError(
        'AIRTEL_CALLBACK_INVALID_JSON',
        'Airtel callback body is not valid JSON.',
        400,
        error,
      );
    }
  }

  if (typeof payload === 'string') {
    try {
      return JSON.parse(
        payload,
      );
    } catch (error) {
      throw validatorError(
        'AIRTEL_CALLBACK_INVALID_JSON',
        'Airtel callback payload is not valid JSON.',
        400,
        error,
      );
    }
  }

  if (
    !isObject(payload) ||
    Array.isArray(payload)
  ) {
    throw validatorError(
      'AIRTEL_CALLBACK_INVALID_PAYLOAD',
      'Airtel callback payload must be an object.',
      400,
    );
  }

  return payload;
}

function validatorError(
  code,
  message,
  statusCode = 400,
  cause = undefined,
) {
  const error =
    new Error(
      message,
    );

  error.name =
    'AirtelCallbackValidationError';

  error.code =
    code;

  error.statusCode =
    statusCode;

  error.retryable =
    false;

  if (cause) {
    error.cause =
      cause;
  }

  return error;
}

function safeError(error) {
  if (!error) {
    return null;
  }

  return {
    name:
      normalizeString(
        error.name,
        128,
      ),

    code:
      normalizeString(
        error.code,
        256,
      ),

    message:
      normalizeString(
        error.message,
        1500,
      ),

    statusCode:
      Number(
        error.statusCode ||
        error.status,
      ) ||
      500,

    retryable:
      Boolean(
        error.retryable,
      ),
  };
}

function extractSignatureValidity(
  result,
) {
  if (result === true) {
    return {
      valid: true,
      verified: true,
      status:
        SECURITY_STATUS.VERIFIED,
    };
  }

  if (result === false) {
    return {
      valid: false,
      verified: false,
      status:
        SECURITY_STATUS.INVALID,
    };
  }

  if (
    !result ||
    typeof result !== 'object'
  ) {
    return {
      valid: false,
      verified: false,
      status:
        SECURITY_STATUS.INDETERMINATE,
    };
  }

  const explicitValid =
    result.valid ??
    result.isValid ??
    result.authenticated;

  const explicitVerified =
    result.verified ??
    result.signatureVerified ??
    result.authenticated;

  const status =
    normalizeUpper(
      result.status,
    );

  if (
    explicitValid === true ||
    explicitVerified === true ||
    [
      'VALID',
      'VERIFIED',
      'AUTHORIZED',
      'SUCCESS',
    ].includes(
      status,
    )
  ) {
    return {
      valid: true,
      verified: true,
      status:
        SECURITY_STATUS.VERIFIED,
      delegated:
        Boolean(
          result.delegated,
        ),
    };
  }

  if (
    explicitValid === false ||
    explicitVerified === false ||
    [
      'INVALID',
      'UNAUTHORIZED',
      'REJECTED',
      'EXPIRED',
    ].includes(
      status,
    )
  ) {
    return {
      valid: false,
      verified: false,
      status:
        SECURITY_STATUS.INVALID,
      code:
        result.code ||
        'AIRTEL_CALLBACK_SIGNATURE_INVALID',
    };
  }

  return {
    valid: false,
    verified: false,
    status:
      SECURITY_STATUS.INDETERMINATE,
    code:
      result.code ||
      'AIRTEL_CALLBACK_SIGNATURE_VERIFICATION_INDETERMINATE',
  };
}

function extractSchemaValidity(
  result,
) {
  if (result === true) {
    return {
      valid: true,
    };
  }

  if (
    result === false ||
    result === null ||
    result === undefined
  ) {
    return {
      valid: false,
    };
  }

  if (typeof result !== 'object') {
    return {
      valid: Boolean(
        result,
      ),
    };
  }

  const status =
    normalizeUpper(
      result.status,
    );

  const explicit =
    result.valid ??
    result.isValid;

  if (
    explicit === true ||
    [
      'VALID',
      'SUCCESS',
      'OK',
    ].includes(
      status,
    )
  ) {
    return {
      valid: true,
      errors:
        result.errors ||
        [],
      warnings:
        result.warnings ||
        [],
    };
  }

  if (
    explicit === false ||
    [
      'INVALID',
      'REJECTED',
      'FAILED',
    ].includes(
      status,
    )
  ) {
    return {
      valid: false,
      errors:
        result.errors ||
        [],
      warnings:
        result.warnings ||
        [],
      code:
        result.code,
    };
  }

  return {
    valid: false,
    indeterminate: true,
    errors:
      result.errors ||
      [],
    warnings:
      result.warnings ||
      [],
  };
}

function callbackIdentity(
  payload,
) {
  return {
    callbackId:
      normalizeString(
        firstValue(
          payload,
          [
            'callbackId',
            'eventId',
            'notificationId',
            'id',
            'event.id',
          ],
        ),
        256,
      ),

    providerTransactionId:
      normalizeString(
        firstValue(
          payload,
          [
            'providerTransactionId',
            'providerReference',
            'providerTransactionReference',
            'airtelTransactionId',
            'airtelMoneyId',
            'transactionId',
            'transaction.id',
          ],
        ),
        256,
      ),

    transactionReference:
      normalizeString(
        firstValue(
          payload,
          [
            'transactionReference',
            'transaction.reference',
          ],
        ),
        256,
      ),

    paymentReference:
      normalizeString(
        firstValue(
          payload,
          [
            'paymentReference',
            'payment.reference',
            'merchantReference',
            'clientReference',
          ],
        ),
        256,
      ),

    externalReference:
      normalizeString(
        firstValue(
          payload,
          [
            'externalReference',
            'external.reference',
            'clientReference',
          ],
        ),
        256,
      ),

    tenantId:
      normalizeString(
        firstValue(
          payload,
          [
            'tenantId',
            'tenant.id',
          ],
        ),
        256,
      ),
  };
}

function extractTimestamp(
  payload,
) {
  return firstValue(
    payload,
    [
      'timestamp',
      'createdAt',
      'occurredAt',
      'event.timestamp',
      'transaction.timestamp',
      'transaction.createdAt',
    ],
  );
}

function parseTimestamp(
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
    /^\d+$/.test(
      String(value),
    )
  ) {
    const numeric =
      Number(value);

    if (
      numeric <
      10_000_000_000
    ) {
      return new Date(
        numeric * 1000,
      );
    }

    return new Date(
      numeric,
    );
  }

  const date =
    new Date(value);

  return Number.isNaN(
    date.getTime(),
  )
    ? null
    : date;
}

function deriveProviderOutcome(
  payload,
) {
  const explicit =
    normalizeUpper(
      firstValue(
        payload,
        [
          'outcome',
          'providerOutcome',
        ],
      ),
    );

  if (
    explicit &&
    Object.values(
      CALLBACK_OUTCOME,
    ).includes(
      explicit,
    )
  ) {
    return explicit;
  }

  const status =
    normalizeUpper(
      firstValue(
        payload,
        [
          'status',
          'transactionStatus',
          'resultCode',
          'event.status',
          'transaction.status',
        ],
      ),
    );

  if (
    payload?.success ===
    true
  ) {
    return CALLBACK_OUTCOME
      .SUCCESS;
  }

  if (
    payload?.success ===
    false
  ) {
    return CALLBACK_OUTCOME
      .FAILED;
  }

  if (
    [
      'SUCCESS',
      'SUCCESSFUL',
      'COMPLETED',
      'COMPLETE',
      'PAID',
      'APPROVED',
      '0',
    ].includes(
      status,
    )
  ) {
    return CALLBACK_OUTCOME
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
    ].includes(
      status,
    )
  ) {
    return CALLBACK_OUTCOME
      .PENDING;
  }

  if (
    [
      'FAILED',
      'FAILURE',
      'ERROR',
      'DECLINED',
      'REJECTED',
      'CANCELLED',
      'CANCELED',
    ].includes(
      status,
    )
  ) {
    return status.startsWith(
      'CANCEL',
    )
      ? CALLBACK_OUTCOME
          .CANCELLED
      : CALLBACK_OUTCOME
          .FAILED;
  }

  if (
    [
      'REVERSED',
      'REVERSAL',
    ].includes(
      status,
    )
  ) {
    return CALLBACK_OUTCOME
      .REVERSED;
  }

  return CALLBACK_OUTCOME
    .UNKNOWN;
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

  const output =
    String(value).trim();

  if (
    !/^\d+(?:\.\d+)?$/.test(
      output,
    )
  ) {
    return null;
  }

  return output;
}

function safeProviderError(
  error,
) {
  if (!error) {
    return null;
  }

  return {
    code:
      normalizeString(
        error.code,
        256,
      ) ||
      'AIRTEL_CALLBACK_PROVIDER_ERROR',

    message:
      normalizeString(
        error.message,
        1000,
      ) ||
      'Airtel callback provider error.',

    statusCode:
      Number(
        error.statusCode ||
        error.status,
      ) ||
      500,

    retryable:
      Boolean(
        error.retryable,
      ),
  };
}

export class AirtelCallbackValidator {
  constructor({
    signatureVerifier = null,
    replayProtection = null,
    replayGuard = null,
    schemaValidator = null,
    callbackNormalizer = null,
    fraudEngine = null,
    riskEngine = null,
    providerErrorMapper = null,
    auditService = null,
    eventBus = null,
    outboxService = null,
    metrics = null,
    tracer = null,
    logger = null,
    tenantResolver = null,
    configuration = {},
    clock = Date,
  } = {}) {
    this.signatureVerifier =
      signatureVerifier;

    this.replayProtection =
      replayProtection ||
      replayGuard;

    this.schemaValidator =
      schemaValidator;

    this.callbackNormalizer =
      callbackNormalizer;

    this.fraudEngine =
      fraudEngine;

    this.riskEngine =
      riskEngine;

    this.providerErrorMapper =
      providerErrorMapper;

    this.auditService =
      auditService;

    this.eventBus =
      eventBus;

    this.outboxService =
      outboxService;

    this.metrics =
      metrics;

    this.tracer =
      tracer;

    this.logger =
      logger ||
      null;

    this.tenantResolver =
      tenantResolver;

    this.clock =
      clock ||
      Date;

    this.options = {
      ...DEFAULTS,
      ...(configuration || {}),
    };

    this.runtime = {
      initialized:
        false,

      startedAt:
        now(
          this.clock,
        ),

      lastValidationAt:
        null,

      lastFailureAt:
        null,

      lastFailureCode:
        null,
    };

    this.statistics = {
      received:
        0,

      validated:
        0,

      rejected:
        0,

      replayBlocked:
        0,

      replayChecks:
        0,

      replayReservations:
        0,

      replayGuardFailures:
        0,

      signatureChecks:
        0,

      signatureFailures:
        0,

      signatureIndeterminate:
        0,

      schemaChecks:
        0,

      schemaFailures:
        0,

      timestampFailures:
        0,

      fraudReviews:
        0,

      unknownOutcomes:
        0,

      highValueSignals:
        0,

      tenantFailures:
        0,

      auditFailures:
        0,

      eventFailures:
        0,

      normalizerFailures:
        0,
    };
  }

  async initialize() {
    this.runtime.initialized =
      true;

    return this;
  }

  async shutdown() {
    this.runtime.initialized =
      false;
  }

  async validate(
    input = {},
  ) {
    const startedAt =
      Date.now();

    const normalizedInput =
      this.normalizeInputEnvelope(
        input,
      );

    const context =
      await this.buildTrustedContext(
        normalizedInput,
      );

    const span =
      this.startSpan(
        'airtel.callback.validation',
        context,
      );

    this.statistics.received +=
      1;

    try {
      const payload =
        parsePayload(
          normalizedInput.payload,
          this.options
            .maxCallbackBytes,
        );

      await this.assertProvider(
        payload,
      );

      this.assertTrustedTenant(
        normalizedInput.tenantId ||
          normalizedInput.context
            ?.tenantId,
        context,
      );

      this.validateTransportHints(
        normalizedInput,
      );

      const verification =
        await this.resolveSignatureVerification(
          {
            payload,

            input:
              normalizedInput,

            context,
          },
        );

      const schema =
        await this.validateSchema({
          payload,
          tenantId:
            context.tenantId,
          correlationId:
            context.correlationId,
          operationId:
            context.operationId,
          context,
        });

      const timestamp =
        this.validateTimestamp(
          payload,
          context,
        );

      const replay =
        await this.checkReplay({
          payload,
          tenantId:
            context.tenantId,
          correlationId:
            context.correlationId,
          operationId:
            context.operationId,
          reserve:
            true,
        });

      const callback =
        await this.normalizeCallback({
          payload,
          normalizedInput,
          context,
          verification,
        });

      const fraud =
        await this.detectFraud({
          tenantId:
            context.tenantId,
          callback,
          context,
        });

      if (
        fraud.requiresReview
      ) {
        this.statistics
          .fraudReviews +=
          1;

        const reviewResult =
          this.buildValidationResult({
            status:
              VALIDATION_STATUS
                .REVIEW,

            callback,
            context,
            verification,
            schema,
            replay,
            timestamp,
            fraud,

            durationMs:
              Date.now() -
              startedAt,
          });

        await this.recordAudit({
          tenantId:
            context.tenantId,

          callback,

          correlationId:
            context.correlationId,

          operationId:
            context.operationId,

          status:
            VALIDATION_STATUS
              .REVIEW,

          verification,

          fraud,
        });

        return reviewResult;
      }

      const result =
        this.buildValidationResult({
          status:
            VALIDATION_STATUS
              .VALID,

          callback,
          context,
          verification,
          schema,
          replay,
          timestamp,
          fraud,

          durationMs:
            Date.now() -
            startedAt,
        });

      await this.recordAudit({
        tenantId:
          context.tenantId,

        callback,

        correlationId:
          context.correlationId,

        operationId:
          context.operationId,

        status:
          VALIDATION_STATUS
            .VALID,

        verification,

        fraud,
      });

      this.statistics.validated +=
        1;

      this.runtime.lastValidationAt =
        now(
          this.clock,
        );

      this.incrementMetric(
        'airtel_callback_validation_success_total',
        1,
      );

      return result;
    } catch (error) {
      this.statistics.rejected +=
        1;

      this.runtime.lastFailureAt =
        now(
          this.clock,
        );

      this.runtime.lastFailureCode =
        error?.code ||
        'AIRTEL_CALLBACK_VALIDATION_FAILED';

      this.classifyFailure(
        error,
      );

      const safeValidationError =
        this.mapValidationError(
          error,
        );

      await this.handleValidationFailure({
        tenantId:
          context?.tenantId ||
          null,

        correlationId:
          context?.correlationId ||
          null,

        operationId:
          context?.operationId ||
          null,

        payload:
          normalizedInput.payload,

        error:
          safeValidationError,
      });

      this.incrementMetric(
        'airtel_callback_validation_failure_total',
        1,
        {
          code:
            safeValidationError.code,
        },
      );

      throw safeValidationError;
    } finally {
      this.runtime.lastValidationAt =
        now(
          this.clock,
        );

      this.incrementMetric(
        'airtel_callback_validation_duration_ms',
        Date.now() -
          startedAt,
      );

      span?.end?.();
    }
  }

  async validateCallback(
    input = {},
  ) {
    return this.validate(
      input,
    );
  }

  async validateDetailed(
    input = {},
  ) {
    return this.validate(
      input,
    );
  }

  async validateOrThrow(
    input = {},
  ) {
    return this.validate(
      input,
    );
  }

  validateInput(
    payload,
  ) {
    return parsePayload(
      payload,
      this.options
        .maxCallbackBytes,
    );
  }

  async assertProvider(
    payload,
  ) {
    const provider =
      normalizeUpper(
        firstValue(
          payload,
          [
            'provider',
            'providerName',
            'operator',
          ],
        ),
      );

    if (!provider) {
      return true;
    }

    if (
      provider !==
        PROVIDER &&
      !this.options
        .allowUnknownProvider
    ) {
      throw validatorError(
        'AIRTEL_CALLBACK_PROVIDER_MISMATCH',
        `Expected ${PROVIDER} callback.`,
        400,
      );
    }

    return true;
  }

  validateTransportHints(
    input,
  ) {
    if (!input) {
      return true;
    }

    if (
      input.headers &&
      byteLength(
        input.headers,
      ) >
        this.options
          .maxMetadataBytes
    ) {
      throw validatorError(
        'AIRTEL_CALLBACK_HEADERS_TOO_LARGE',
        'Airtel callback headers exceed the configured limit.',
        413,
      );
    }

    return true;
  }

  assertTrustedTenant(
    tenantId,
    context,
  ) {
    const trustedTenantId =
      normalizeString(
        tenantId ||
          context?.tenantId,
        256,
      );

    if (
      this.options
        .requireTenantId &&
      !trustedTenantId
    ) {
      this.statistics
        .tenantFailures +=
        1;

      throw validatorError(
        'AIRTEL_CALLBACK_TENANT_REQUIRED',
        'Trusted tenant context is required for Airtel callback validation.',
        403,
      );
    }

    return true;
  }

  async buildTrustedContext(
    input = {},
  ) {
    let tenantId =
      normalizeString(
        input.tenantId ||
          input.context?.tenantId ||
          input.context
            ?.trustedTenantId,
        256,
      );

    if (
      !tenantId &&
      this.tenantResolver
    ) {
      const method =
        [
          'resolveTrustedTenant',
          'resolveTenant',
          'resolve',
        ].find(
          (name) =>
            isFunction(
              this.tenantResolver?.[
                name
              ],
            ),
        );

      if (method) {
        try {
          const result =
            await this.tenantResolver[
              method
            ]({
              ...input.context,

              tenantId:
                undefined,

              provider:
                PROVIDER,

              operation:
                OPERATION,

              correlationId:
                input.correlationId,

              operationId:
                input.operationId,
            });

          tenantId =
            normalizeString(
              result?.id ||
                result?.tenantId ||
                result,
              256,
            );
        } catch (error) {
          this.statistics
            .tenantFailures +=
            1;

          throw validatorError(
            'AIRTEL_CALLBACK_TENANT_RESOLUTION_FAILED',
            'Trusted tenant resolution failed.',
            403,
            error,
          );
        }
      }
    }

    if (
      this.options
        .requireTenantId &&
      !tenantId
    ) {
      this.statistics
        .tenantFailures +=
        1;

      throw validatorError(
        'AIRTEL_CALLBACK_TENANT_REQUIRED',
        'Trusted tenant context is required for Airtel callback validation.',
        403,
      );
    }

    return {
      provider:
        PROVIDER,

      operation:
        normalizeUpper(
          input.operation,
        ) ||
        OPERATION,

      tenantId,

      correlationId:
        normalizeString(
          input.correlationId,
          256,
        ) ||
        crypto.randomUUID(),

      operationId:
        normalizeString(
          input.operationId,
          256,
        ) ||
        crypto.randomUUID(),

      requestId:
        normalizeString(
          input.requestId,
          256,
        ),

      callbackId:
        normalizeString(
          input.callbackId,
          256,
        ),

      signatureVerified:
        input.signatureVerified ===
          true ||
        input.context
          ?.signatureVerified ===
          true,

      securityVerified:
        input.securityVerified ===
          true ||
        input.context
          ?.securityVerified ===
          true,

      authenticated:
        input.authenticated ===
          true ||
        input.context
          ?.authenticated ===
          true,
    };
  }

  async resolveSignatureVerification({
    payload,
    input,
    context,
  }) {
    if (
      context.signatureVerified ||
      context.securityVerified
    ) {
      return {
        valid:
          true,

        verified:
          true,

        delegated:
          true,

        status:
          SECURITY_STATUS
            .DELEGATED,

        source:
          'TRUSTED_EXECUTION_CONTEXT',
      };
    }

    const suppliedVerification =
      input.verification ||
      input.signatureVerification ||
      input.context
        ?.verification;

    /*
     * Important ownership rule:
     *
     * If this validator owns signature verification, a controller-provided
     * "delegated" result is not cryptographic proof. In that case we continue
     * to the actual signature-verifier dependency below.
     */
    if (
      suppliedVerification &&
      !(
        this.options
          .validatorOwnsSignature &&
        suppliedVerification
          .delegated === true
      )
    ) {
      const result =
        extractSignatureValidity(
          suppliedVerification,
        );

      if (
        !result.valid ||
        !result.verified
      ) {
        this.statistics
          .signatureFailures +=
          1;

        if (
          result.status ===
          SECURITY_STATUS
            .INDETERMINATE
        ) {
          this.statistics
            .signatureIndeterminate +=
            1;
        }

        throw validatorError(
          result.status ===
            SECURITY_STATUS
              .INDETERMINATE
            ? 'AIRTEL_CALLBACK_SIGNATURE_VERIFICATION_INDETERMINATE'
            : 'AIRTEL_CALLBACK_SIGNATURE_INVALID',

          'Airtel callback signature verification did not produce a valid trusted result.',

          401,
        );
      }

      return {
        ...result,

        source:
          'SUPPLIED_VERIFICATION',
      };
    }

    if (
      !this.options
        .requireSignatureVerification
    ) {
      return {
        valid:
          true,

        verified:
          false,

        delegated:
          false,

        status:
          SECURITY_STATUS
            .UNAVAILABLE,

        source:
          'CONFIGURED_OPTIONAL',
      };
    }

    if (
      !this.options
        .validatorOwnsSignature
    ) {
      throw validatorError(
        'AIRTEL_CALLBACK_SIGNATURE_VERIFICATION_REQUIRED',
        'Airtel callback signature verification must be completed by the controller or another trusted security boundary before validation.',
        401,
      );
    }

    if (
      !this.signatureVerifier
    ) {
      if (
        this.options
          .failClosedOnMissingSignatureVerifier
      ) {
        throw validatorError(
          'AIRTEL_CALLBACK_SIGNATURE_VERIFIER_UNAVAILABLE',
          'Airtel callback signature verifier is unavailable.',
          503,
        );
      }

      return {
        valid:
          false,

        verified:
          false,

        status:
          SECURITY_STATUS
            .UNAVAILABLE,
      };
    }

    const method =
      [
        'verify',
        'validate',
        'verifySignature',
      ].find(
        (name) =>
          isFunction(
            this.signatureVerifier?.[
              name
            ],
          ),
      );

    if (!method) {
      throw validatorError(
        'AIRTEL_CALLBACK_SIGNATURE_VERIFIER_CONTRACT_INVALID',
        'Configured Airtel signature verifier exposes no supported method.',
        503,
      );
    }

    this.statistics
      .signatureChecks +=
      1;

    let result;

    try {
      result =
        await this.signatureVerifier[
          method
        ]({
          provider:
            PROVIDER,

          tenantId:
            context.tenantId,

          payload,

          rawBody:
            input.rawBody,

          headers:
            input.headers || {},

          signature:
            input.signature,

          signatureTimestamp:
            input.signatureTimestamp,

          correlationId:
            context.correlationId,

          operationId:
            context.operationId,

          context,
        });
    } catch (error) {
      this.statistics
        .signatureFailures +=
        1;

      throw validatorError(
        'AIRTEL_CALLBACK_SIGNATURE_VERIFICATION_FAILED',
        'Airtel callback signature verification failed.',
        Number(
          error?.statusCode ||
            error?.status,
        ) ||
          503,
        error,
      );
    }

    const verification =
      extractSignatureValidity(
        result,
      );

    if (
      !verification.valid ||
      !verification.verified
    ) {
      this.statistics
        .signatureFailures +=
        1;

      if (
        verification.status ===
        SECURITY_STATUS
          .INDETERMINATE
      ) {
        this.statistics
          .signatureIndeterminate +=
          1;
      }

      throw validatorError(
        verification.status ===
          SECURITY_STATUS
            .INDETERMINATE
          ? 'AIRTEL_CALLBACK_SIGNATURE_VERIFICATION_INDETERMINATE'
          : 'AIRTEL_CALLBACK_SIGNATURE_INVALID',

        'Invalid Airtel callback signature.',

        401,
      );
    }

    return {
      ...verification,

      source:
        'SIGNATURE_VERIFIER',
    };
  }

  async verifySignature(
    args = {},
  ) {
    return this.resolveSignatureVerification({
      payload:
        parsePayload(
          args.payload,
          this.options
            .maxCallbackBytes,
        ),

      input:
        args,

      context: {
        tenantId:
          args.tenantId,

        correlationId:
          args.correlationId ||
          crypto.randomUUID(),

        operationId:
          args.operationId ||
          crypto.randomUUID(),

        signatureVerified:
          false,

        securityVerified:
          false,
      },
    });
  }

  async validateSchema(
    input = {},
  ) {
    const directPayload =
      isObject(input) &&
      Object.prototype
        .hasOwnProperty
        .call(
          input,
          'payload',
        )
        ? input.payload
        : input;

    const payload =
      parsePayload(
        directPayload,
        this.options
          .maxCallbackBytes,
      );

    const tenantId =
      input?.tenantId ||
      input?.context?.tenantId ||
      null;

    const correlationId =
      input?.correlationId ||
      input?.context
        ?.correlationId ||
      null;

    const operationId =
      input?.operationId ||
      input?.context
        ?.operationId ||
      null;

    const context =
      input?.context ||
      {};

    this.statistics
      .schemaChecks +=
      1;

    if (
      !this.schemaValidator
    ) {
      if (
        this.options
          .failClosedOnSchemaValidatorUnavailable
      ) {
        /*
         * A small intrinsic schema is still enforced below. The fail-closed
         * option applies to the injected provider-specific schema boundary.
         */
        const intrinsic =
          this.intrinsicSchemaValidate(
            payload,
          );

        if (
          !intrinsic.valid
        ) {
          this.statistics
            .schemaFailures +=
            1;

          throw validatorError(
            intrinsic.code,
            intrinsic.message,
            400,
          );
        }

        return {
          valid:
            true,

          providerSpecificValidator:
            false,

          intrinsic:
            true,
        };
      }

      return {
        valid:
          true,

        providerSpecificValidator:
          false,

        intrinsic:
          true,
      };
    }

    const method =
      [
        'validate',
        'validateCallback',
        'validateDetailed',
      ].find(
        (name) =>
          isFunction(
            this.schemaValidator?.[
              name
            ],
          ),
      );

    if (!method) {
      if (
        this.options
          .failClosedOnSchemaValidatorUnavailable
      ) {
        throw validatorError(
          'AIRTEL_CALLBACK_SCHEMA_VALIDATOR_CONTRACT_INVALID',
          'Configured Airtel schema validator exposes no supported method.',
          503,
        );
      }

      return {
        valid:
          true,

        providerSpecificValidator:
          false,
      };
    }

    let result;

    try {
      result =
        await this.schemaValidator[
          method
        ]({
          provider:
            PROVIDER,

          operation:
            OPERATION,

          tenantId,

          payload,

          correlationId,

          operationId,

          context,
        });
    } catch (error) {
      throw validatorError(
        'AIRTEL_CALLBACK_SCHEMA_VALIDATION_FAILED',
        'Airtel callback schema validation failed.',
        Number(
          error?.statusCode ||
            error?.status,
        ) ||
          400,
        error,
      );
    }

    const schema =
      extractSchemaValidity(
        result,
      );

    if (
      !schema.valid
    ) {
      this.statistics
        .schemaFailures +=
        1;

      throw validatorError(
        schema.indeterminate
          ? 'AIRTEL_CALLBACK_SCHEMA_VALIDATION_INDETERMINATE'
          : schema.code ||
            'AIRTEL_CALLBACK_SCHEMA_INVALID',

        'Airtel callback schema validation failed.',

        schema.indeterminate
          ? 503
          : 400,
      );
    }

    return {
      ...schema,

      providerSpecificValidator:
        true,
    };
  }

  intrinsicSchemaValidate(
    payload,
  ) {
    if (
      !isObject(payload) ||
      Array.isArray(payload)
    ) {
      return {
        valid:
          false,

        code:
          'AIRTEL_CALLBACK_INVALID_PAYLOAD',

        message:
          'Airtel callback payload must be an object.',
      };
    }

    const identity =
      callbackIdentity(
        payload,
      );

    if (
      this.options
        .requireCallbackIdentity &&
      !identity.callbackId &&
      !identity.providerTransactionId &&
      !identity.transactionReference &&
      !identity.paymentReference
    ) {
      return {
        valid:
          false,

        code:
          'AIRTEL_CALLBACK_IDENTITY_REQUIRED',

        message:
          'Airtel callback does not contain a usable callback identity.',
      };
    }

    return {
      valid:
        true,
    };
  }

  validateTimestamp(
    payload,
    context = {},
  ) {
    const rawTimestamp =
      extractTimestamp(
        payload,
      );

    if (!rawTimestamp) {
      if (
        this.options
          .requireFreshTimestamp
      ) {
        this.statistics
          .timestampFailures +=
          1;

        throw validatorError(
          'AIRTEL_CALLBACK_TIMESTAMP_REQUIRED',
          'Airtel callback timestamp is required.',
          400,
        );
      }

      return {
        present:
          false,

        valid:
          true,

        timestamp:
          null,
      };
    }

    const timestamp =
      parseTimestamp(
        rawTimestamp,
      );

    if (!timestamp) {
      this.statistics
        .timestampFailures +=
        1;

      throw validatorError(
        'AIRTEL_CALLBACK_TIMESTAMP_INVALID',
        'Airtel callback timestamp is invalid.',
        400,
      );
    }

    const current =
      now(
        this.clock,
      ).getTime();

    const ageMs =
      current -
      timestamp.getTime();

    const maxAgeMs =
      Number(
        this.options
          .maxCallbackAgeSeconds,
      ) *
      1000;

    const futureSkewMs =
      Number(
        this.options
          .maxFutureSkewSeconds,
      ) *
      1000;

    if (
      ageMs >
      maxAgeMs
    ) {
      this.statistics
        .timestampFailures +=
        1;

      throw validatorError(
        'AIRTEL_CALLBACK_TIMESTAMP_EXPIRED',
        'Airtel callback timestamp has expired.',
        400,
      );
    }

    if (
      ageMs <
      -futureSkewMs
    ) {
      this.statistics
        .timestampFailures +=
        1;

      throw validatorError(
        'AIRTEL_CALLBACK_TIMESTAMP_FUTURE',
        'Airtel callback timestamp is too far in the future.',
        400,
      );
    }

    return {
      present:
        true,

      valid:
        true,

      timestamp:
        timestamp.toISOString(),

      ageMs,

      futureSkewMs,
    };
  }

  async checkReplay({
    payload,
    tenantId,
    correlationId,
    operationId,
    reserve = true,
  }) {
    if (
      !this.replayProtection
    ) {
      if (
        this.options
          .failClosedOnReplayGuardUnavailable
      ) {
        throw validatorError(
          'AIRTEL_CALLBACK_REPLAY_GUARD_UNAVAILABLE',
          'Airtel callback replay protection is unavailable.',
          503,
        );
      }

      return {
        enabled:
          false,

        replay:
          false,

        reserved:
          false,
      };
    }

    const identity =
      callbackIdentity(
        payload,
      );

    const fingerprint =
      this.buildReplayFingerprint({
        tenantId,
        identity,
        payload,
      });

    this.statistics
      .replayChecks +=
      1;

    if (
      isFunction(
        this.replayProtection
          .checkAndReserve,
      )
    ) {
      const result =
        await this.replayProtection
          .checkAndReserve({
            key:
              fingerprint,

            tenantId,

            provider:
              PROVIDER,

            operation:
              OPERATION,

            callbackId:
              identity.callbackId,

            correlationId,

            operationId,

            ttlSeconds:
              this.options
                .maxCallbackAgeSeconds,
          });

      const replay =
        Boolean(
          result === true ||
            result?.replay ===
              true ||
            result?.duplicate ===
              true ||
            result?.reserved ===
              false,
        );

      if (replay) {
        this.statistics
          .replayBlocked +=
          1;

        throw validatorError(
          'AIRTEL_CALLBACK_REPLAY_DETECTED',
          'Duplicate Airtel callback detected.',
          409,
        );
      }

      this.statistics
        .replayReservations +=
        1;

      return {
        enabled:
          true,

        replay:
          false,

        reserved:
          true,

        fingerprint,

        source:
          'CHECK_AND_RESERVE',
      };
    }

    if (
      isFunction(
        this.replayProtection
          .reserve,
      )
    ) {
      const result =
        await this.replayProtection
          .reserve({
            key:
              fingerprint,

            tenantId,

            provider:
              PROVIDER,

            operation:
              OPERATION,

            callbackId:
              identity.callbackId,

            correlationId,

            operationId,

            ttlSeconds:
              this.options
                .maxCallbackAgeSeconds,
          });

      const replay =
        Boolean(
          result === false ||
            result?.replay ===
              true ||
            result?.duplicate ===
              true ||
            result?.reserved ===
              false ||
            result?.conflict ===
              true,
        );

      if (replay) {
        this.statistics
          .replayBlocked +=
          1;

        throw validatorError(
          'AIRTEL_CALLBACK_REPLAY_DETECTED',
          'Duplicate Airtel callback detected.',
          409,
        );
      }

      this.statistics
        .replayReservations +=
        1;

      return {
        enabled:
          true,

        replay:
          false,

        reserved:
          true,

        fingerprint,

        source:
          'RESERVE',
      };
    }

    if (
      this.options
        .allowReplayGuardExistsStoreFallback &&
      isFunction(
        this.replayProtection
          .exists,
      ) &&
      isFunction(
        this.replayProtection
          .store,
      )
    ) {
      const exists =
        await this.replayProtection
          .exists(
            fingerprint,
          );

      if (exists) {
        this.statistics
          .replayBlocked +=
          1;

        throw validatorError(
          'AIRTEL_CALLBACK_REPLAY_DETECTED',
          'Duplicate Airtel callback detected.',
          409,
        );
      }

      if (reserve) {
        await this.replayProtection
          .store(
            fingerprint,
            this.options
              .maxCallbackAgeSeconds,
          );

        this.statistics
          .replayReservations +=
          1;
      }

      return {
        enabled:
          true,

        replay:
          false,

        reserved:
          reserve,

        fingerprint,

        source:
          'EXISTS_STORE_FALLBACK',
      };
    }

    this.statistics
      .replayGuardFailures +=
      1;

    if (
      this.options
        .failClosedOnReplayGuardUnavailable
    ) {
      throw validatorError(
        'AIRTEL_CALLBACK_REPLAY_GUARD_CONTRACT_INVALID',
        'Configured Airtel replay guard does not expose an atomic reservation method.',
        503,
      );
    }

    return {
      enabled:
        false,

      replay:
        false,

      reserved:
        false,

      fingerprint,
    };
  }

  buildReplayFingerprint({
    tenantId,
    identity,
    payload,
  }) {
    return sha256({
      schemaVersion:
        SCHEMA_VERSION,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      tenantId:
        tenantId ||
        null,

      callbackId:
        identity.callbackId,

      providerTransactionId:
        identity.providerTransactionId,

      transactionReference:
        identity.transactionReference,

      paymentReference:
        identity.paymentReference,

      externalReference:
        identity.externalReference,

      status:
        normalizeUpper(
          firstValue(
            payload,
            [
              'status',
              'transactionStatus',
            ],
          ),
        ),

      outcome:
        deriveProviderOutcome(
          payload,
        ),

      amount:
        normalizeAmount(
          firstValue(
            payload,
            [
              'amount',
              'transaction.amount',
            ],
          ),
        ),

      currency:
        normalizeUpper(
          firstValue(
            payload,
            [
              'currency',
              'transaction.currency',
            ],
          ),
        ),
    });
  }

  async normalizeCallback({
    payload,
    normalizedInput,
    context,
    verification,
  }) {
    if (
      !this.callbackNormalizer
    ) {
      return this.localNormalize(
        payload,
        context,
        verification,
      );
    }

    const method =
      [
        'normalize',
        'normalizeCallback',
        'transform',
      ].find(
        (name) =>
          isFunction(
            this.callbackNormalizer?.[
              name
            ],
          ),
      );

    if (!method) {
      this.statistics
        .normalizerFailures +=
        1;

      throw validatorError(
        'AIRTEL_CALLBACK_NORMALIZER_CONTRACT_INVALID',
        'Configured Airtel callback normalizer exposes no supported method.',
        503,
      );
    }

    try {
      const result =
        await this.callbackNormalizer[
          method
        ]({
          provider:
            PROVIDER,

          operation:
            OPERATION,

          payload,

          rawPayload:
            payload,

          rawBody:
            normalizedInput
              .rawBody,

          headers:
            normalizedInput
              .headers ||
            {},

          tenantId:
            context.tenantId,

          correlationId:
            context.correlationId,

          operationId:
            context.operationId,

          context: {
            ...context,

            verification,
          },
        });

      const callback =
        result?.callback ||
        result?.payload ||
        result;

      if (
        !callback ||
        typeof callback !==
          'object'
      ) {
        throw validatorError(
          'AIRTEL_CALLBACK_NORMALIZER_INVALID_RESULT',
          'Airtel callback normalizer returned an invalid result.',
          503,
        );
      }

      return callback;
    } catch (error) {
      this.statistics
        .normalizerFailures +=
        1;

      if (
        error?.statusCode
      ) {
        throw error;
      }

      throw validatorError(
        'AIRTEL_CALLBACK_NORMALIZATION_FAILED',
        'Airtel callback normalization failed.',
        400,
        error,
      );
    }
  }

  normalize(
    payload,
    context = {},
  ) {
    const parsed =
      parsePayload(
        payload,
        this.options
          .maxCallbackBytes,
      );

    if (
      this.callbackNormalizer
    ) {
      const method =
        [
          'normalize',
          'normalizeCallback',
          'transform',
        ].find(
          (name) =>
            isFunction(
              this.callbackNormalizer?.[
                name
              ],
            ),
        );

      if (method) {
        const result =
          this.callbackNormalizer[
            method
          ]({
            provider:
              PROVIDER,

            operation:
              OPERATION,

            payload:
              parsed,

            rawPayload:
              parsed,

            tenantId:
              context?.tenantId ||
              null,

            correlationId:
              context?.correlationId ||
              null,

            operationId:
              context?.operationId ||
              null,

            context,
          });

        if (
          result &&
          isFunction(
            result.then,
          )
        ) {
          throw validatorError(
            'AIRTEL_CALLBACK_ASYNC_NORMALIZER_REQUIRES_ASYNC_API',
            'The configured Airtel callback normalizer is asynchronous; use validate() for asynchronous normalization.',
            500,
          );
        }

        return (
          result?.callback ||
          result?.payload ||
          result
        );
      }
    }

    return this.localNormalize(
      parsed,
      {
        tenantId:
          context?.tenantId ||
          null,

        correlationId:
          context?.correlationId ||
          crypto.randomUUID(),

        operationId:
          context?.operationId ||
          crypto.randomUUID(),

        authenticated:
          context
            ?.authenticated ===
            true,

        securityVerified:
          context
            ?.securityVerified ===
            true,

        callbackId:
          context
            ?.callbackId ||
          null,
      },
      {
        verified:
          context
            ?.signatureVerified ===
            true ||
          context
            ?.securityVerified ===
            true,
      },
    );
  }

  localNormalize(
    payload,
    context,
    verification,
  ) {
    const identity =
      callbackIdentity(
        payload,
      );

    const amount =
      normalizeAmount(
        firstValue(
          payload,
          [
            'amount',
            'transaction.amount',
          ],
        ),
      );

    const currency =
      normalizeUpper(
        firstValue(
          payload,
          [
            'currency',
            'currencyCode',
            'transaction.currency',
          ],
        ),
      ) ||
      this.options
        .defaultCurrency;

    const status =
      normalizeUpper(
        firstValue(
          payload,
          [
            'status',
            'transactionStatus',
            'resultCode',
            'transaction.status',
          ],
        ),
      ) ||
      'UNKNOWN';

    const normalized = {
      provider:
        PROVIDER,

      operation:
        OPERATION,

      schemaVersion:
        SCHEMA_VERSION,

      engineVersion:
        ENGINE_VERSION,

      tenantId:
        context.tenantId,

      callbackId:
        identity.callbackId ||
        context.callbackId,

      providerTransactionId:
        identity.providerTransactionId,

      transactionReference:
        identity.transactionReference,

      paymentReference:
        identity.paymentReference,

      externalReference:
        identity.externalReference,

      status,

      outcome:
        deriveProviderOutcome(
          payload,
        ),

      amount,

      currency,

      providerReasonCode:
        normalizeString(
          firstValue(
            payload,
            [
              'reasonCode',
              'responseCode',
              'resultCode',
              'transaction.responseCode',
            ],
          ),
          128,
        ),

      providerReasonMessage:
        normalizeString(
          firstValue(
            payload,
            [
              'reasonMessage',
              'responseMessage',
              'resultMessage',
              'message',
              'description',
            ],
          ),
          1000,
        ),

      phoneNumber:
        normalizeString(
          firstValue(
            payload,
            [
              'phoneNumber',
              'msisdn',
              'mobileNumber',
              'customer.phoneNumber',
              'customer.msisdn',
            ],
          ),
          32,
        ),

      payer:
        safeClone(
          firstValue(
            payload,
            [
              'payer',
              'customer',
              'sender',
            ],
          ),
        ),

      payee:
        safeClone(
          firstValue(
            payload,
            [
              'payee',
              'recipient',
              'receiver',
            ],
          ),
        ),

      metadata:
        this.sanitizeMetadata(
          firstValue(
            payload,
            [
              'metadata',
            ],
          ),
        ),

      occurredAt:
        (() => {
          const date =
            parseTimestamp(
              extractTimestamp(
                payload,
              ),
            );

          return date
            ? date.toISOString()
            : null;
        })(),

      securityVerified:
        verification.verified ===
        true,

      signatureVerified:
        verification.verified ===
        true,

      authenticated:
        Boolean(
          context.authenticated ||
            context.securityVerified,
        ),

      correlationId:
        context.correlationId,

      operationId:
        context.operationId,

      normalizedAt:
        now(
          this.clock,
        ).toISOString(),
    };

    normalized.callbackFingerprint =
      sha256({
        provider:
          PROVIDER,

        tenantId:
          context.tenantId,

        callbackId:
          normalized.callbackId,

        providerTransactionId:
          normalized.providerTransactionId,

        transactionReference:
          normalized.transactionReference,

        paymentReference:
          normalized.paymentReference,

        externalReference:
          normalized.externalReference,

        status:
          normalized.status,

        outcome:
          normalized.outcome,

        amount:
          normalized.amount,

        currency:
          normalized.currency,
      });

    normalized.payloadFingerprint =
      sha256(
        safeClone(
          payload,
        ),
      );

    return Object.freeze(
      safeClone(
        normalized,
      ),
    );
  }

  sanitizeMetadata(
    metadata,
  ) {
    if (
      !metadata ||
      typeof metadata !==
        'object'
    ) {
      return {};
    }

    const safe =
      safeClone(
        metadata,
      );

    if (
      byteLength(safe) <=
      this.options
        .maxMetadataBytes
    ) {
      return safe;
    }

    return {
      omitted:
        true,

      reason:
        'METADATA_TOO_LARGE',

      sha256:
        sha256(
          safe,
        ),
    };
  }

  async detectFraud({
    tenantId,
    callback,
    context,
  }) {
    const signals = [];
    let score = 0;
    let requiresReview =
      false;

    const amount =
      Number(
        callback?.amountMinor ??
          callback?.amount ??
          0,
      );

    if (
      Number.isFinite(
        amount,
      ) &&
      amount >
        Number(
          this.options
            .maxAmountThresholdMinor,
        )
    ) {
      signals.push(
        FRAUD_SIGNAL
          .HIGH_VALUE_TRANSACTION,
      );

      this.statistics
        .highValueSignals +=
        1;

      requiresReview =
        true;
    }

    if (
      callback?.status ===
        'UNKNOWN' &&
      callback?.outcome ===
        CALLBACK_OUTCOME.UNKNOWN
    ) {
      signals.push(
        FRAUD_SIGNAL
          .UNKNOWN_REFERENCE,
      );
    }

    const engine =
      this.fraudEngine ||
      this.riskEngine;

    if (engine) {
      const method =
        [
          'evaluate',
          'assess',
          'score',
        ].find(
          (name) =>
            isFunction(
              engine?.[
                name
              ],
            ),
        );

      if (method) {
        try {
          const result =
            await engine[
              method
            ]({
              provider:
                PROVIDER,

              operation:
                OPERATION,

              tenantId,

              callback:
                safeClone(
                  callback,
                ),

              context:
                safeClone(
                  context,
                ),
            });

          score =
            Number(
              result?.score,
            ) ||
            0;

          requiresReview =
            Boolean(
              requiresReview ||
                result
                  ?.requiresReview ||
                result
                  ?.decision ===
                  'REVIEW' ||
                result
                  ?.decision ===
                  'BLOCK',
            );

          if (
            Array.isArray(
              result?.signals,
            )
          ) {
            signals.push(
              ...result.signals
                .map(
                  (signal) =>
                    normalizeUpper(
                      signal,
                    ),
                )
                .filter(
                  Boolean,
                ),
            );
          }
        } catch (error) {
          if (
            this.options
              .failClosedOnFraudEngineUnavailable
          ) {
            requiresReview =
              true;
          }

          this.log(
            'warn',
            'Airtel callback fraud intelligence unavailable',
            {
              tenantId,

              correlationId:
                context
                  ?.correlationId,

              code:
                error?.code,
            },
          );
        }
      }
    }

    return Object.freeze({
      score,

      signals:
        [
          ...new Set(
            signals,
          ),
        ],

      requiresReview,

      decision:
        requiresReview
          ? 'REVIEW'
          : 'CLEAR',
    });
  }

  mapProviderError(
    error,
  ) {
    if (
      this.providerErrorMapper
    ) {
      const method =
        [
          'map',
          'mapError',
          'normalize',
        ].find(
          (name) =>
            isFunction(
              this.providerErrorMapper?.[
                name
              ],
            ),
        );

      if (method) {
        try {
          const result =
            this.providerErrorMapper[
              method
            ](
              error,
            );

          if (result) {
            return safeClone(
              result,
            );
          }
        } catch {
          // Fall back to local safe provider-error mapping.
        }
      }
    }

    return safeProviderError(
      error,
    );
  }

  buildValidationResult({
    status,
    callback,
    context,
    verification,
    schema,
    replay,
    timestamp,
    fraud,
    durationMs,
  }) {
    const safeCallback =
      safeClone(
        callback,
      );

    return {
      valid:
        status ===
        VALIDATION_STATUS
          .VALID,

      verified:
        verification
          ?.verified ===
        true,

      status,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      schemaVersion:
        SCHEMA_VERSION,

      engineVersion:
        ENGINE_VERSION,

      tenantId:
        context.tenantId,

      correlationId:
        context.correlationId,

      operationId:
        context.operationId,

      callback:
        safeCallback,

      payload:
        safeCallback,

      normalizedCallback:
        safeCallback,

      callbackId:
        callback?.callbackId ||
        context.callbackId ||
        null,

      callbackFingerprint:
        callback
          ?.callbackFingerprint ||
        sha256({
          tenantId:
            context.tenantId,

          callback:
            safeCallback,
        }),

      verification: {
        status:
          verification?.status ||
          SECURITY_STATUS
            .UNAVAILABLE,

        verified:
          Boolean(
            verification?.verified,
          ),

        delegated:
          Boolean(
            verification?.delegated,
          ),

        source:
          verification?.source ||
          null,
      },

      schema:
        safeClone(
          schema,
        ),

      replay:
        safeClone(
          replay,
        ),

      timestamp:
        safeClone(
          timestamp,
        ),

      fraud:
        safeClone(
          fraud,
        ),

      reviewRequired:
        status ===
        VALIDATION_STATUS
          .REVIEW,

      retryable:
        false,

      securityRejected:
        false,

      durationMs,

      timestampGenerated:
        now(
          this.clock,
        ).toISOString(),
    };
  }

  classifyFailure(
    error,
  ) {
    switch (
      error?.code
    ) {
      case 'AIRTEL_CALLBACK_REPLAY_DETECTED':
        this.statistics
          .replayBlocked +=
          1;
        break;

      case 'AIRTEL_CALLBACK_SIGNATURE_INVALID':
      case 'AIRTEL_CALLBACK_SIGNATURE_VERIFICATION_INDETERMINATE':
      case 'AIRTEL_CALLBACK_SIGNATURE_VERIFICATION_FAILED':
        this.statistics
          .signatureFailures +=
          1;
        break;

      case 'AIRTEL_CALLBACK_TIMESTAMP_EXPIRED':
      case 'AIRTEL_CALLBACK_TIMESTAMP_FUTURE':
      case 'AIRTEL_CALLBACK_TIMESTAMP_INVALID':
        this.statistics
          .timestampFailures +=
          1;
        break;

      case 'AIRTEL_CALLBACK_SCHEMA_INVALID':
      case 'AIRTEL_CALLBACK_SCHEMA_VALIDATION_FAILED':
      case 'AIRTEL_CALLBACK_SCHEMA_VALIDATION_INDETERMINATE':
        this.statistics
          .schemaFailures +=
          1;
        break;

      default:
        break;
    }
  }

  mapValidationError(
    error,
  ) {
    if (
      error?.name ===
      'AirtelCallbackValidationError'
    ) {
      return error;
    }

    const mapped =
      this.mapProviderError(
        error,
      );

    const wrapped =
      validatorError(
        mapped?.code ||
          error?.code ||
          'AIRTEL_CALLBACK_VALIDATION_FAILED',

        mapped?.message ||
          error?.message ||
          'Airtel callback validation failed.',

        Number(
          mapped?.statusCode ||
            error?.statusCode ||
            error?.status,
        ) ||
          500,

        error,
      );

    wrapped.retryable =
      Boolean(
        mapped?.retryable ||
          error?.retryable,
      );

    return wrapped;
  }

  async recordAudit({
    tenantId,
    callback,
    correlationId,
    operationId,
    status,
    verification,
    fraud,
  }) {
    if (
      !this.options.audit ||
      !this.auditService
    ) {
      return;
    }

    const method =
      [
        'record',
        'audit',
        'write',
      ].find(
        (name) =>
          isFunction(
            this.auditService?.[
              name
            ],
          ),
      );

    if (!method) {
      return;
    }

    const safeCallback =
      safeClone(
        callback,
      );

    try {
      await this.auditService[
        method
      ]({
        action:
          status ===
          VALIDATION_STATUS
            .VALID
            ? 'AIRTEL_CALLBACK_VALIDATED'
            : 'AIRTEL_CALLBACK_REVIEW_REQUIRED',

        provider:
          PROVIDER,

        operation:
          OPERATION,

        tenantId,

        correlationId,

        operationId,

        metadata: {
          status,

          callbackId:
            safeCallback
              ?.callbackId ||
            null,

          providerTransactionId:
            safeCallback
              ?.providerTransactionId ||
            null,

          paymentReference:
            safeCallback
              ?.paymentReference ||
            null,

          callbackFingerprint:
            safeCallback
              ?.callbackFingerprint ||
            null,

          verification: {
            status:
              verification
                ?.status ||
              null,

            verified:
              Boolean(
                verification
                  ?.verified,
              ),
          },

          fraud: {
            score:
              Number(
                fraud?.score ||
                  0,
              ),

            requiresReview:
              Boolean(
                fraud
                  ?.requiresReview,
              ),

            signals:
              Array.isArray(
                fraud?.signals,
              )
                ? fraud.signals.slice(
                    0,
                    25,
                  )
                : [],
          },
        },

        at:
          now(
            this.clock,
          ).toISOString(),
      });
    } catch (error) {
      this.statistics
        .auditFailures +=
        1;

      this.log(
        'error',
        'Airtel callback validation audit failed',
        {
          tenantId,

          correlationId,

          operationId,

          code:
            error?.code,
        },
      );

      if (
        this.options
          .failClosedOnAuditError
      ) {
        throw error;
      }
    }
  }

  async handleValidationFailure({
    tenantId,
    correlationId,
    operationId,
    payload,
    error,
  }) {
    this.log(
      'warn',
      'Airtel callback validation failed',
      {
        tenantId,
        correlationId,
        operationId,
        code:
          error?.code,

        statusCode:
          error?.statusCode,
      },
    );

    if (
      !this.options.audit ||
      !this.auditService
    ) {
      return;
    }

    const method =
      [
        'record',
        'audit',
        'write',
      ].find(
        (name) =>
          isFunction(
            this.auditService?.[
              name
            ],
          ),
      );

    if (!method) {
      return;
    }

    try {
      await this.auditService[
        method
      ]({
        action:
          'AIRTEL_CALLBACK_VALIDATION_FAILED',

        provider:
          PROVIDER,

        operation:
          OPERATION,

        tenantId:
          tenantId ||
          null,

        correlationId:
          correlationId ||
          null,

        operationId:
          operationId ||
          null,

        metadata: {
          error: {
            code:
              error?.code ||
              null,

            statusCode:
              Number(
                error?.statusCode,
              ) ||
              500,

            retryable:
              Boolean(
                error?.retryable,
              ),
          },

          payloadFingerprint:
            payload !==
              undefined &&
            payload !==
              null
              ? sha256(
                  safeClone(
                    payload,
                  ),
                )
              : null,
        },

        at:
          now(
            this.clock,
          ).toISOString(),
      });
    } catch (auditError) {
      this.statistics
        .auditFailures +=
        1;

      if (
        this.options
          .failClosedOnAuditError
      ) {
        throw auditError;
      }
    }
  }

  async publishEvent(
    type,
    context,
    metadata = {},
  ) {
    if (
      !this.options
        .publishEvents
    ) {
      return;
    }

    const event = {
      type,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      tenantId:
        context?.tenantId ||
        null,

      correlationId:
        context
          ?.correlationId ||
        null,

      operationId:
        context
          ?.operationId ||
        null,

      payload:
        safeClone(
          metadata,
        ),

      at:
        now(
          this.clock,
        ).toISOString(),
    };

    try {
      if (
        this.outboxService
      ) {
        const method =
          [
            'publish',
            'enqueue',
            'append',
          ].find(
            (name) =>
              isFunction(
                this.outboxService?.[
                  name
                ],
              ),
          );

        if (method) {
          await this.outboxService[
            method
          ](
            event,
          );

          return;
        }
      }

      if (
        this.eventBus
      ) {
        const method =
          [
            'publish',
            'emit',
            'send',
          ].find(
            (name) =>
              isFunction(
                this.eventBus?.[
                  name
                ],
              ),
          );

        if (method) {
          await this.eventBus[
            method
          ](
            event,
          );
        }
      }
    } catch (error) {
      this.statistics
        .eventFailures +=
        1;

      this.log(
        'error',
        'Airtel callback validation event publication failed',
        {
          type,

          tenantId:
            context
              ?.tenantId,

          correlationId:
            context
              ?.correlationId,

          code:
            error?.code,
        },
      );

      if (
        this.options
          .failClosedOnEventError
      ) {
        throw error;
      }
    }
  }

  incrementMetric(
    name,
    value = 1,
    labels = undefined,
  ) {
    try {
      const method =
        [
          'increment',
          'inc',
          'counter',
        ].find(
          (candidate) =>
            isFunction(
              this.metrics?.[
                candidate
              ],
            ),
        );

      if (!method) {
        return;
      }

      if (
        labels !==
        undefined
      ) {
        this.metrics[
          method
        ](
          name,
          value,
          labels,
        );
      } else {
        this.metrics[
          method
        ](
          name,
          value,
        );
      }
    } catch {
      // Metrics must not affect validation correctness.
    }
  }

  startSpan(
    name,
    context = {},
  ) {
    try {
      if (
        !isFunction(
          this.tracer
            ?.startSpan,
        )
      ) {
        return null;
      }

      return this.tracer.startSpan(
        name,
        {
          attributes: {
            'titech.provider':
              PROVIDER,

            'titech.operation':
              OPERATION,

            'titech.tenant_id':
              context
                ?.tenantId ||
              'unknown',

            'titech.correlation_id':
              context
                ?.correlationId ||
              'unknown',

            'titech.operation_id':
              context
                ?.operationId ||
              'unknown',
          },
        },
      );
    } catch {
      return null;
    }
  }

  log(
    level,
    message,
    metadata = {},
  ) {
    try {
      const method =
        isFunction(
          this.logger?.[
            level
          ],
        )
          ? level
          : 'info';

      this.logger?.[
        method
      ]?.({
        message,

        provider:
          PROVIDER,

        component:
          COMPONENT,

        ...safeClone(
          metadata,
        ),
      });
    } catch {
      // Logging must never affect validation.
    }
  }

  health() {
    const securityReady =
      !this.options
        .requireSignatureVerification ||
      Boolean(
        this.signatureVerifier,
      ) ||
      !this.options
        .validatorOwnsSignature;

    const replayReady =
      !this.options
        .failClosedOnReplayGuardUnavailable ||
      Boolean(
        this.replayProtection,
      );

    return {
      provider:
        PROVIDER,

      operation:
        OPERATION,

      component:
        COMPONENT,

      engine:
        ENGINE_NAME,

      version:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      status:
        securityReady &&
        replayReady
          ? 'UP'
          : 'DEGRADED',

      initialized:
        this.runtime
          .initialized,

      dependencies: {
        signatureVerifier:
          Boolean(
            this.signatureVerifier,
          ),

        replayProtection:
          Boolean(
            this.replayProtection,
          ),

        schemaValidator:
          Boolean(
            this.schemaValidator,
          ),

        callbackNormalizer:
          Boolean(
            this.callbackNormalizer,
          ),

        fraudEngine:
          Boolean(
            this.fraudEngine ||
              this.riskEngine,
          ),

        providerErrorMapper:
          Boolean(
            this.providerErrorMapper,
          ),

        auditService:
          Boolean(
            this.auditService,
          ),

        eventBoundary:
          Boolean(
            this.eventBus ||
              this.outboxService,
          ),

        tenantResolver:
          Boolean(
            this.tenantResolver,
          ),
      },

      security: {
        requireSignatureVerification:
          Boolean(
            this.options
              .requireSignatureVerification,
          ),

        validatorOwnsSignature:
          Boolean(
            this.options
              .validatorOwnsSignature,
          ),

        failClosedOnReplayGuardUnavailable:
          Boolean(
            this.options
              .failClosedOnReplayGuardUnavailable,
          ),
      },

      uptimeMs:
        Date.now() -
        this.runtime
          .startedAt
          .getTime(),

      statistics:
        this.statisticsSnapshot(),
    };
  }

  async readiness() {
    const health =
      this.health();

    return {
      ready:
        health.status ===
        'UP',

      ...health,
    };
  }

  async liveness() {
    return {
      alive:
        true,

      provider:
        PROVIDER,

      component:
        COMPONENT,

      timestamp:
        now(
          this.clock,
        ).toISOString(),
    };
  }

  isReady() {
    return (
      this.health()
        .status ===
      'UP'
    );
  }

  capabilities() {
    return {
      provider:
        PROVIDER,

      operation:
        OPERATION,

      validation:
        true,

      signatureVerificationIntegration:
        Boolean(
          this.signatureVerifier,
        ),

      replayProtectionIntegration:
        Boolean(
          this.replayProtection,
        ),

      schemaValidationIntegration:
        Boolean(
          this.schemaValidator,
        ),

      normalizationIntegration:
        Boolean(
          this.callbackNormalizer,
        ),

      fraudIntelligenceHooks:
        Boolean(
          this.fraudEngine ||
            this.riskEngine,
        ),

      tenantIsolation:
        true,

      boundedPayloads:
        true,

      timestampProtection:
        true,

      safeAudit:
        Boolean(
          this.auditService,
        ),

      safeEvents:
        Boolean(
          this.eventBus ||
            this.outboxService,
        ),

      directProviderHttp:
        false,

      directLedgerMutation:
        false,

      directBalanceMutation:
        false,

      directWalletMutation:
        false,

      settlementFinality:
        false,

      authoritativeFinancialBoundary:
        FINANCIAL_BOUNDARY,
    };
  }

  diagnostics() {
    return {
      provider:
        PROVIDER,

      operation:
        OPERATION,

      component:
        COMPONENT,

      engine:
        ENGINE_NAME,

      version:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      configuration:
        safeClone(
          this.options,
        ),

      capabilities:
        this.capabilities(),

      runtime:
        safeClone(
          this.runtime,
        ),

      statistics:
        this.statisticsSnapshot(),

      financialBoundary: {
        directProviderHttp:
          false,

        directLedgerMutation:
          false,

        directBalanceMutation:
          false,

        directWalletMutation:
          false,

        settlementFinality:
          false,

        authoritativeBoundary:
          FINANCIAL_BOUNDARY,
      },
    };
  }

  snapshot() {
    return this.diagnostics();
  }

  statisticsSnapshot() {
    return safeClone(
      this.statistics,
    );
  }

  normalizeInputEnvelope(
    input = {},
  ) {
    const isEnvelope =
      isObject(input) &&
      (
        Object.prototype
          .hasOwnProperty
          .call(
            input,
            'payload',
          ) ||
        Object.prototype
          .hasOwnProperty
          .call(
            input,
            'rawPayload',
          ) ||
        Object.prototype
          .hasOwnProperty
          .call(
            input,
            'callback',
          ) ||
        Object.prototype
          .hasOwnProperty
          .call(
            input,
            'tenantId',
          ) ||
        Object.prototype
          .hasOwnProperty
          .call(
            input,
            'context',
          )
      );

    if (!isEnvelope) {
      return {
        payload:
          input,

        tenantId:
          null,

        headers:
          {},

        context:
          {},

        correlationId:
          null,

        operationId:
          null,

        requestId:
          null,

        callbackId:
          null,

        operation:
          null,

        verification:
          null,

        rawBody:
          undefined,

        signature:
          undefined,

        signatureTimestamp:
          undefined,

        signatureVerified:
          false,

        securityVerified:
          false,

        authenticated:
          false,
      };
    }

    return {
      payload:
        input.payload ??
        input.rawPayload ??
        input.callback ??
        input.data,

      tenantId:
        input.tenantId ??
        input.context
          ?.tenantId,

      headers:
        input.headers ||
        {},

      context:
        input.context ||
        {},

      correlationId:
        input.correlationId ??
        input.context
          ?.correlationId,

      operationId:
        input.operationId ??
        input.context
          ?.operationId,

      requestId:
        input.requestId ??
        input.context
          ?.requestId,

      callbackId:
        input.callbackId ??
        input.context
          ?.callbackId,

      operation:
        input.operation ??
        input.context
          ?.operation,

      verification:
        input.verification ??
        input.signatureVerification ??
        input.context
          ?.verification,

      rawBody:
        input.rawBody,

      signature:
        input.signature,

      signatureTimestamp:
        input.signatureTimestamp,

      signatureVerified:
        input.signatureVerified ===
        true,

      securityVerified:
        input.securityVerified ===
        true,

      authenticated:
        input.authenticated ===
        true,
    };
  }
}

export class CallbackValidator
  extends AirtelCallbackValidator {}

export function createAirtelCallbackValidator(
  options = {},
) {
  return new AirtelCallbackValidator(
    options,
  );
}

export function createCallbackValidator(
  options = {},
) {
  return new AirtelCallbackValidator(
    options,
  );
}

export const CONSTANTS =
  Object.freeze({
    PROVIDER,

    OPERATION,

    COMPONENT,

    ENGINE_NAME,

    ENGINE_VERSION,

    SCHEMA_VERSION,

    FINANCIAL_BOUNDARY,

    VALIDATION_STATUS,

    SECURITY_STATUS,

    FRAUD_SIGNAL,

    CALLBACK_OUTCOME,

    DEFAULTS,
  });

export {
  safeClone,
  sha256,
  callbackIdentity,
  deriveProviderOutcome,
  parsePayload,
};

export default AirtelCallbackValidator;