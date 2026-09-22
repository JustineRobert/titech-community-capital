'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Callback Controller
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/callbacks/callbackController.js
 *
 * Architectural role
 * ------------------
 * Canonical HTTP/application boundary for inbound Airtel Money callbacks.
 * It owns transport safety, trusted request context, security-gate delegation,
 * pipeline dispatch, acknowledgement shaping, and observability. Financial
 * mutation remains downstream.
 *
 * Canonical flow
 * --------------
 * HTTP -> transport guard -> trusted tenant -> signature/validation
 *      -> normalization/correlation -> canonical processor
 *      -> acknowledgement / outbox / audit
 *
 * Explicit boundaries
 * -------------------
 * - No Airtel API/OAuth implementation.
 * - No direct Mongo/Mongoose/Redis access.
 * - No direct ledger/journal/balance/wallet mutation.
 * - No KYC/AML/sanctions/fraud adjudication.
 * - No settlement finality.
 * - No tenant inference from callback payloads.
 * - No controller-owned raw callback persistence in audit/events/DLQ.
 *
 * Security principles
 * -------------------
 * 1. Tenant context is trusted from middleware/resolver, never from the body.
 * 2. Signature/validation must precede callback processing when this controller
 *    owns the security gate.
 * 3. Raw request bytes are retained for cryptographic verification when needed.
 * 4. Unverified callbacks are never written to the controller DLQ.
 * 5. Duplicate acknowledgement is allowed only after downstream authoritative
 *    duplicate detection.
 * 6. Callback acknowledgement is not financial settlement.
 * 7. Provider success is downstream evidence, not ledger finality.
 * 8. Observability failures do not silently change financial safety semantics.
 *
 * Module format
 * -------------
 * Native ESM. Node.js built-ins only.
 * =============================================================================
 */

import crypto from 'node:crypto';

// =============================================================================
// Module contract
// =============================================================================

export const PROVIDER = 'AIRTEL';
export const OPERATION = 'CALLBACK';
export const COLLECTION_OPERATION = 'COLLECTION';
export const MODULE_NAME = 'titech.airtel.callbacks.controller';
export const ENGINE_NAME = 'airtel-callback-controller';
export const ENGINE_VERSION = '4.1.0';
export const COMPONENT = ENGINE_NAME;
export const SCHEMA_VERSION = 5;
export const HASH_ALGORITHM = 'sha256';

export const CALLBACK_HTTP_STATUS = Object.freeze({
  RECEIVED: 200,
  ACCEPTED: 202,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
});

export const CONTROLLER_STATUS = Object.freeze({
  CREATED: 'CREATED',
  INITIALIZING: 'INITIALIZING',
  READY: 'READY',
  DEGRADED: 'DEGRADED',
  PROCESSING: 'PROCESSING',
  STOPPING: 'STOPPING',
  STOPPED: 'STOPPED',
});

export const CALLBACK_OUTCOMES = Object.freeze({
  PROCESSED: 'PROCESSED',
  COMPLETED: 'COMPLETED',
  ACCEPTED: 'ACCEPTED',
  DUPLICATE: 'DUPLICATE',
  PENDING: 'PENDING',
  AMBIGUOUS: 'AMBIGUOUS',
  REVIEW: 'REVIEW',
  RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
  UNKNOWN: 'UNKNOWN',
});

export const SECURITY_RESULTS = Object.freeze({
  VERIFIED: 'VERIFIED',
  INVALID: 'INVALID',
  MISSING: 'MISSING',
  UNAVAILABLE: 'UNAVAILABLE',
  REVIEW: 'REVIEW',
});

export const PIPELINE_TYPES = Object.freeze({
  CALLBACK_MODULE: 'CALLBACK_MODULE',
  COLLECTION_SERVICE: 'COLLECTION_SERVICE',
  CORRELATED_PROCESSOR: 'CORRELATED_PROCESSOR',
  GENERIC_PROCESSOR: 'GENERIC_PROCESSOR',
});

export const ACKNOWLEDGEMENT_OUTCOMES = Object.freeze({
  SUCCESS: Object.freeze([
    CALLBACK_OUTCOMES.PROCESSED,
    CALLBACK_OUTCOMES.COMPLETED,
    CALLBACK_OUTCOMES.ACCEPTED,
    CALLBACK_OUTCOMES.DUPLICATE,
  ]),
  ASYNC_ACCEPTED: Object.freeze([
    CALLBACK_OUTCOMES.PENDING,
    CALLBACK_OUTCOMES.AMBIGUOUS,
    CALLBACK_OUTCOMES.RECONCILIATION_REQUIRED,
    CALLBACK_OUTCOMES.REVIEW,
  ]),
});

export const DEFAULT_CONFIGURATION = Object.freeze({
  maxBodyBytes: 1024 * 1024,
  maxHeaderValueLength: 2048,
  requirePost: true,
  acceptedMethods: Object.freeze(['POST']),
  requireJsonContentType: false,
  requireTenantId: true,
  failClosedOnMissingTenant: true,

  requireRawBodyForSignature: true,
  requireSignatureVerifierWhenControllerOwnsSecurity: true,
  controllerOwnsSecurityByDefault: true,
  delegateSecurityToCallbackModule: true,
  validatorOwnsSignature: true,
  allowUnsignedMode: false,

  strictPipeline: true,
  acknowledgeDuplicates: true,
  acknowledgeAsyncProcessing: true,
  delegateErrorsToNext: false,

  includeErrorMessageFor4xx: true,
  includeErrorMessageFor5xx: false,
  failClosedOnAuditError: false,
  failClosedOnEventError: false,

  eventNamespace: 'titech.payment.airtel.callbacks',
  systemActorId: 'SYSTEM:AIRTEL_CALLBACK',
  systemActorType: 'SYSTEM',
  provider: PROVIDER,
  operation: OPERATION,
});

export const CAPABILITIES = Object.freeze({
  httpBoundary: true,
  trustedTenantContext: true,
  rawBodyProtection: true,
  signatureDelegation: true,
  callbackValidationDelegation: true,
  normalizationDelegation: true,
  correlationDelegation: true,
  duplicateAcknowledgement: true,
  sanitizedAudit: true,
  sanitizedEvents: true,
  verifiedDlqBoundary: true,
  directProviderHttp: false,
  directDatabaseWrites: false,
  directLedgerWrites: false,
  directBalanceMutation: false,
  directWalletMutation: false,
  directSettlementFinality: false,
  directKycAmlAdjudication: false,
});

export const FINANCIAL_BOUNDARY = Object.freeze({
  providerCalls: false,
  databaseWrites: false,
  ledgerWrites: false,
  balanceMutation: false,
  walletMutation: false,
  settlementFinality: false,
  financialAuthorization: false,
  preserveOriginalFinancialIdentity: true,
  preserveOriginalIdempotencyIdentity: true,
  authoritativeFinancialBoundary: 'TITECH_FINANCIAL_CORE',
});

// =============================================================================
// Errors
// =============================================================================

export class AirtelCallbackControllerError extends Error {
  constructor(message, options = {}) {
    super(
      String(message || 'Airtel callback controller error.'),
      options.cause ? { cause: options.cause } : undefined,
    );
    this.name = 'AirtelCallbackControllerError';
    this.code = options.code || 'AIRTEL_CALLBACK_CONTROLLER_ERROR';
    this.statusCode = Number.isInteger(Number(options.statusCode ?? options.status))
      ? Number(options.statusCode ?? options.status)
      : CALLBACK_HTTP_STATUS.INTERNAL_ERROR;
    this.retryable = Boolean(options.retryable);
    this.uncertain = Boolean(options.uncertain);
    this.securityRejected = Boolean(options.securityRejected);
    this.tenantId = options.tenantId ?? null;
    this.correlationId = options.correlationId ?? null;
    this.operationId = options.operationId ?? null;
    this.payloadFingerprint = options.payloadFingerprint ?? null;
    this.details = options.details ?? {};
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      retryable: this.retryable,
      uncertain: this.uncertain,
      securityRejected: this.securityRejected,
      tenantId: this.tenantId,
      correlationId: this.correlationId,
      operationId: this.operationId,
      payloadFingerprint: this.payloadFingerprint,
      details: this.details,
    };
  }
}

export const CallbackControllerError = AirtelCallbackControllerError;

// =============================================================================
// Pure helpers
// =============================================================================

const isFunction = (value) => typeof value === 'function';
const isObject = (value) => Boolean(value && typeof value === 'object');
const isPlainObject = (value) => Boolean(
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  !(value instanceof Date) &&
  !Buffer.isBuffer(value),
);

const normalizeString = (value, max = 512) => {
  if (value === undefined || value === null) return null;
  const result = String(value).trim();
  return result ? result.slice(0, max) : null;
};

const upper = (value) => {
  const normalized = normalizeString(value);
  return normalized ? normalized.toUpperCase() : null;
};

const stable = (value, depth = 0) => {
  if (depth > 8) return '[MAX_DEPTH]';
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (value instanceof Date) return `date:${value.toISOString()}`;
  if (typeof value === 'bigint') return `bigint:${value}`;
  if (Array.isArray(value)) return `[${value.map((item) => stable(item, depth + 1)).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key], depth + 1)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const sha256 = (value) => crypto
  .createHash(HASH_ALGORITHM)
  .update(typeof value === 'string' ? value : stable(value), 'utf8')
  .digest('hex');

const nowMs = (clock) => {
  try {
    const result = isFunction(clock) ? clock() : clock?.now?.();
    if (result instanceof Date) return result.getTime();
    if (Number.isFinite(Number(result))) return Number(result);
  } catch {
    // System clock fallback.
  }
  return Date.now();
};

const nowIso = (clock) => new Date(nowMs(clock)).toISOString();

const firstFunction = (target, names = []) => {
  if (!target) return null;
  for (const name of names) {
    if (isFunction(target[name])) return name;
  }
  return null;
};

const bodyBytes = (value) => {
  if (value === undefined || value === null) return 0;
  if (Buffer.isBuffer(value)) return value.length;
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
};

const SENSITIVE_KEY_PATTERN = /(authorization|proxy-authorization|token|secret|password|signature|credential|api[-_]?key|private[-_]?key|client[-_]?secret|cookie|set-cookie|otp|pin|cvv|cvc|pan|access[-_]?token|refresh[-_]?token|raw(body|payload|request|response)|webhook[-_]?body)/i;
const unsafeKeyPattern = /(^\$)|\.|__proto__|^constructor$|^prototype$/i;

const sanitize = (value, depth = 0, seen = new WeakSet()) => {
  if (depth > 7) return '[MAX_DEPTH]';
  if (value === undefined || value === null) return value ?? null;
  if (typeof value === 'string') return value.slice(0, 1000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) {
    return {
      omitted: true,
      reason: 'BINARY_PAYLOAD',
      sha256: sha256(value),
    };
  }
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((item) => sanitize(item, depth + 1, seen));
  }

  const output = {};
  for (const [key, child] of Object.entries(value).slice(0, 200)) {
    if (unsafeKeyPattern.test(key)) continue;
    output[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? '[REDACTED]'
      : sanitize(child, depth + 1, seen);
  }
  return output;
};

const safeError = (error) => {
  if (!error) return null;
  let serialized = null;
  try {
    serialized = isFunction(error.toJSON) ? error.toJSON() : null;
  } catch {
    serialized = null;
  }

  return {
    name: normalizeString(serialized?.name ?? error.name, 120),
    code: normalizeString(serialized?.code ?? error.code, 160),
    message: normalizeString(serialized?.message ?? error.message, 500),
    statusCode: Number.isInteger(
      Number(
        serialized?.statusCode ??
        error.statusCode ??
        error.status,
      ),
    )
      ? Number(
        serialized?.statusCode ??
        error.statusCode ??
        error.status,
      )
      : null,
    retryable: Boolean(
      serialized?.retryable ??
      error.retryable,
    ),
    uncertain: Boolean(
      serialized?.uncertain ??
      error.uncertain,
    ),
  };
};

const normalizeHeaderMap = (headers = {}) => {
  if (!isObject(headers)) return {};

  const output = {};

  for (const [key, value] of Object.entries(headers)) {
    output[String(key).toLowerCase()] = Array.isArray(value)
      ? value.join(',')
      : normalizeString(
        value,
        DEFAULT_CONFIGURATION.maxHeaderValueLength,
      );
  }

  return output;
};

const extractSignature = (headers) => {
  const h = normalizeHeaderMap(headers);

  return (
    h['x-airtel-signature'] ||
    h['x-signature'] ||
    h['x-callback-signature'] ||
    h['x-webhook-signature'] ||
    h.signature ||
    null
  );
};

const extractSignatureTimestamp = (headers) => {
  const h = normalizeHeaderMap(headers);

  return (
    h['x-airtel-timestamp'] ||
    h['x-signature-timestamp'] ||
    h['x-callback-timestamp'] ||
    h['x-webhook-timestamp'] ||
    null
  );
};

const extractCallbackId = (headers, payload) => {
  const h = normalizeHeaderMap(headers);

  return normalizeString(
    h['x-callback-id'] ||
    h['x-event-id'] ||
    h['x-notification-id'] ||
    h['x-airtel-event-id'] ||
    payload?.callbackId ||
    payload?.eventId ||
    payload?.notificationId ||
    payload?.id,
    240,
  );
};

const parsePayload = (body) => {
  if (
    body === undefined ||
    body === null ||
    body === ''
  ) {
    throw new AirtelCallbackControllerError(
      'Airtel callback payload is required.',
      {
        code: 'AIRTEL_CALLBACK_PAYLOAD_REQUIRED',
        statusCode: CALLBACK_HTTP_STATUS.BAD_REQUEST,
      },
    );
  }

  if (Buffer.isBuffer(body)) {
    return parsePayload(
      body.toString('utf8'),
    );
  }

  if (isPlainObject(body)) return body;

  if (typeof body !== 'string') {
    throw new AirtelCallbackControllerError(
      'Airtel callback payload format is invalid.',
      {
        code: 'AIRTEL_CALLBACK_PAYLOAD_INVALID',
        statusCode: CALLBACK_HTTP_STATUS.BAD_REQUEST,
      },
    );
  }

  try {
    const parsed = JSON.parse(body);

    if (!isPlainObject(parsed)) {
      throw new Error(
        'Callback JSON root must be an object.',
      );
    }

    return parsed;
  } catch (error) {
    throw new AirtelCallbackControllerError(
      'Airtel callback payload is not valid JSON.',
      {
        code: 'AIRTEL_CALLBACK_JSON_INVALID',
        statusCode: CALLBACK_HTTP_STATUS.BAD_REQUEST,
        details: {
          causeName:
            error?.name ?? null,
        },
      },
    );
  }
};

const extractBooleanValidity = (result) => {
  if (
    result === true ||
    result?.valid === true ||
    result?.verified === true
  ) {
    return true;
  }

  if (
    result === false ||
    result?.valid === false ||
    result?.verified === false
  ) {
    return false;
  }

  const status = upper(
    result?.status,
  );

  if (
    status === 'VALID' ||
    status === 'VERIFIED'
  ) {
    return true;
  }

  if (status === 'INVALID') {
    return false;
  }

  return null;
};

const extractOutcome = (result) => {
  const normalized = upper(
    result?.outcome ??
    result?.status ??
    result?.state ??
    result?.callbackStatus,
  );

  if (!normalized) {
    return CALLBACK_OUTCOMES.ACCEPTED;
  }

  if (
    ['PROCESSED'].includes(
      normalized,
    )
  ) {
    return CALLBACK_OUTCOMES.PROCESSED;
  }

  if (
    [
      'COMPLETED',
      'SUCCESS',
      'SUCCEEDED',
      'SETTLED',
      'PAID',
      'CONFIRMED',
      'COMPLETED_SUCCESSFULLY',
    ].includes(normalized)
  ) {
    return CALLBACK_OUTCOMES.COMPLETED;
  }

  if (
    normalized ===
    CALLBACK_OUTCOMES.DUPLICATE
  ) {
    return CALLBACK_OUTCOMES.DUPLICATE;
  }

  if (
    [
      'PENDING',
      'PROVIDER_PENDING',
      'IN_FLIGHT',
      'PROCESSING',
      'ACCEPTED_PENDING',
    ].includes(normalized)
  ) {
    return CALLBACK_OUTCOMES.PENDING;
  }

  if (
    ['AMBIGUOUS'].includes(
      normalized,
    )
  ) {
    return CALLBACK_OUTCOMES.AMBIGUOUS;
  }

  if (
    [
      'UNKNOWN',
      'INDETERMINATE',
    ].includes(normalized)
  ) {
    return CALLBACK_OUTCOMES.UNKNOWN;
  }

  if (
    [
      'REVIEW',
      'REQUIRES_REVIEW',
      'MANUAL_REVIEW',
    ].includes(normalized)
  ) {
    return CALLBACK_OUTCOMES.REVIEW;
  }

  if (
    [
      'RECONCILIATION_REQUIRED',
      'RECONCILE',
      'RECONCILIATION',
    ].includes(normalized)
  ) {
    return CALLBACK_OUTCOMES.RECONCILIATION_REQUIRED;
  }

  if (
    [
      'REJECTED',
      'INVALID',
      'DECLINED',
      'DENIED',
    ].includes(normalized)
  ) {
    return CALLBACK_OUTCOMES.REJECTED;
  }

  if (
    [
      'FAILED',
      'FAILURE',
      'ERROR',
    ].includes(normalized)
  ) {
    return CALLBACK_OUTCOMES.FAILED;
  }

  return CALLBACK_OUTCOMES.ACCEPTED;
};

const pipelineResult = (value) =>
  value?.result &&
  isObject(value.result)
    ? value.result
    : value;

const collectionId = (value) =>
  normalizeString(
    value?.collectionId ??
    value?.paymentId ??
    value?.transactionId ??
    value?.financialTransactionId ??
    value?.id,
    240,
  );

// =============================================================================
// Controller
// =============================================================================

export class AirtelCallbackController {
  constructor(options = {}) {
    if (!isPlainObject(options)) {
      throw new AirtelCallbackControllerError(
        'Controller options must be a plain object.',
        {
          code:
            'AIRTEL_CALLBACK_INVALID_OPTIONS',
          statusCode:
            CALLBACK_HTTP_STATUS.INTERNAL_ERROR,
        },
      );
    }

    this.configuration = Object.freeze({
      ...DEFAULT_CONFIGURATION,
      ...(options.configuration ??
        options.config ??
        {}),
      acceptedMethods: Object.freeze([
        ...(
          (
            options.configuration ??
            options.config
          )?.acceptedMethods ??
          DEFAULT_CONFIGURATION.acceptedMethods
        ),
      ]),
    });

    this.callbackModule =
      options.callbackModule ??
      null;

    this.callbackService =
      options.callbackService ??
      null;

    this.collectionService =
      options.collectionService ??
      null;

    this.callbackProcessor =
      options.callbackProcessor ??
      null;

    this.callbackValidator =
      options.callbackValidator ??
      options.validator ??
      null;

    this.callbackNormalizer =
      options.callbackNormalizer ??
      options.normalizer ??
      null;

    this.callbackCorrelation =
      options.callbackCorrelation ??
      options.correlator ??
      null;

    this.signatureVerifier =
      options.signatureVerifier ??
      null;

    this.tenantResolver =
      options.tenantResolver ??
      null;

    this.authorizationService =
      options.authorizationService ??
      null;

    this.deadLetterQueue =
      options.deadLetterQueue ??
      null;

    this.auditService =
      options.auditService ??
      null;

    this.eventBus =
      options.eventBus ??
      options.eventPublisher ??
      null;

    this.outboxService =
      options.outboxService ??
      null;

    this.metrics =
      options.metrics ??
      null;

    this.tracer =
      options.tracer ??
      null;

    this.logger =
      options.logger ??
      null;

    this.clock =
      options.clock ??
      Date;

    this.state =
      CONTROLLER_STATUS.CREATED;

    this.initialized =
      false;

    this.initializingPromise =
      null;

    this.startedAt =
      new Date(
        nowMs(
          this.clock,
        ),
      );

    this.statistics = {
      received: 0,
      accepted: 0,
      processed: 0,
      duplicates: 0,
      pending: 0,
      ambiguous: 0,
      reviews: 0,
      rejected: 0,
      failed: 0,
      oversized: 0,
      signatureRejected: 0,
      validationRejected: 0,
      tenantRejected: 0,
      pipelineFailures: 0,
      auditFailures: 0,
      eventFailures: 0,
      deadLettered: 0,
    };
  }

  // ---------------------------------------------------------------------------
  // HTTP / public entry points
  // ---------------------------------------------------------------------------

  async handle(
    req,
    res,
    next,
  ) {
    try {
      const result =
        await this.processRequest(
          req,
        );

      if (
        !res ||
        !isFunction(res.status) ||
        !isFunction(res.json)
      ) {
        return result;
      }

      return res
        .status(
          this.httpStatusForResult(
            result,
          ),
        )
        .json(
          this.buildHttpResponse(
            result,
          ),
        );
    } catch (error) {
      const normalized =
        this.normalizeError(
          error,
        );

      if (
        this.configuration
          .delegateErrorsToNext &&
        isFunction(next)
      ) {
        return next(
          normalized,
        );
      }

      if (
        !res ||
        !isFunction(res.status) ||
        !isFunction(res.json)
      ) {
        throw normalized;
      }

      return res
        .status(
          this.httpStatusForError(
            normalized,
          ),
        )
        .json(
          this.buildHttpErrorResponse(
            normalized,
          ),
        );
    }
  }

  async handleHttp(
    req,
    res,
    next,
  ) {
    return this.handle(
      req,
      res,
      next,
    );
  }

  async process(
    input,
    context = {},
  ) {
    if (
      input?.body !== undefined ||
      input?.headers
    ) {
      return this.processRequest(
        input,
        context,
      );
    }

    return this.processRequest({
      body: input,
      rawBody:
        context.rawBody ??
        input,
      headers:
        context.headers ??
        {},
      method:
        context.method ??
        'POST',
      ...context,
    });
  }

  async processRequest(
    req,
    overrides = {},
  ) {
    const started =
      nowMs(this.clock);

    this.statistics.received += 1;

    if (
      this.state !==
        CONTROLLER_STATUS.STOPPING &&
      this.state !==
        CONTROLLER_STATUS.STOPPED
    ) {
      this.state =
        CONTROLLER_STATUS.PROCESSING;
    }

    const request =
      this.normalizeRequest(
        req,
        overrides,
      );

    let context =
      null;

    let span =
      null;

    try {
      context =
        await this.buildTrustedContext(
          request,
        );

      span =
        this.startSpan(
          'airtel.callback.controller.process',
          {
            tenantId:
              context.tenantId,
            correlationId:
              context.correlationId,
            operationId:
              context.operationId,
          },
        );

      this.assertTransport(
        request,
      );

      const payload =
        parsePayload(
          request.body,
        );

      const size =
        bodyBytes(
          request.rawBody ??
            request.body,
        );

      if (
        size >
        this.configuration
          .maxBodyBytes
      ) {
        this.statistics.oversized += 1;

        throw new AirtelCallbackControllerError(
          'Airtel callback payload exceeds the configured maximum size.',
          {
            code:
              'AIRTEL_CALLBACK_PAYLOAD_TOO_LARGE',
            statusCode:
              CALLBACK_HTTP_STATUS.PAYLOAD_TOO_LARGE,
            tenantId:
              context.tenantId,
            correlationId:
              context.correlationId,
            operationId:
              context.operationId,
            details: {
              bytes: size,
              maxBytes:
                this.configuration
                  .maxBodyBytes,
            },
          },
        );
      }

      context.payloadFingerprint =
        this.fingerprint(
          payload,
          context.tenantId,
        );

      await this.assertAuthorized(
        context,
      );

      const pipeline =
        this.selectPipeline();

      const result =
        await this.executePipeline({
          pipeline,
          request,
          payload,
          context,
        });

      const normalized =
        this.normalizeResult(
          result,
          context,
          pipeline,
        );

      this.recordStatistics(
        normalized,
      );

      await this.recordAuditSafe(
        normalized.outcome ===
          CALLBACK_OUTCOMES.DUPLICATE
          ? 'AIRTEL_CALLBACK_DUPLICATE'
          : 'AIRTEL_CALLBACK_PROCESSED',
        {
          context,
          outcome:
            normalized.outcome,
          status:
            normalized.status,
          callbackId:
            normalized.callbackId,
          collectionId:
            normalized.collectionId,
          fingerprint:
            context.payloadFingerprint,
        },
      );

      await this.publishEventSafe(
        normalized.outcome ===
          CALLBACK_OUTCOMES.DUPLICATE
          ? 'AIRTEL_CALLBACK_DUPLICATE'
          : 'AIRTEL_CALLBACK_PROCESSED',
        {
          context,
          outcome:
            normalized.outcome,
          callbackId:
            normalized.callbackId,
          collectionId:
            normalized.collectionId,
          fingerprint:
            context.payloadFingerprint,
        },
      );

      normalized.durationMs =
        nowMs(
          this.clock,
        ) - started;

      this.metric(
        'airtel_callback_controller_processed_total',
        {
          outcome:
            normalized.outcome,
          pipeline:
            pipeline.type,
        },
      );

      this.metric(
        'airtel_callback_controller_duration_ms',
        normalized.durationMs,
      );

      this.state =
        CONTROLLER_STATUS.READY;

      this.statistics.accepted += 1;

      return normalized;
    } catch (error) {
      this.statistics.pipelineFailures += 1;

      const normalized =
        this.normalizeError(
          error,
          context ??
            {},
        );

      if (
        normalized.securityRejected
      ) {
        this.statistics.signatureRejected += 1;
      }

      if (
        normalized.statusCode >=
          400 &&
        normalized.statusCode < 500
      ) {
        this.statistics.rejected += 1;
      }

      this.statistics.failed += 1;

      if (
        this.state !==
          CONTROLLER_STATUS.STOPPING &&
        this.state !==
          CONTROLLER_STATUS.STOPPED
      ) {
        this.state =
          CONTROLLER_STATUS.READY;
      }

      this.metric(
        'airtel_callback_controller_failed_total',
        {
          code:
            normalized.code,
        },
      );

      await this.recordAuditSafe(
        'AIRTEL_CALLBACK_CONTROLLER_FAILED',
        {
          context:
            context ??
            {},
          error:
            normalized,
          fingerprint:
            context?.payloadFingerprint ??
            null,
        },
      );

      await this.safeVerifiedDeadLetter(
        request,
        context,
        normalized,
      );

      this.log(
        'error',
        'Airtel callback controller processing failed.',
        {
          tenantId:
            context?.tenantId,
          correlationId:
            context?.correlationId,
          operationId:
            context?.operationId,
          callbackId:
            context?.callbackId,
          payloadFingerprint:
            context?.payloadFingerprint,
          error:
            safeError(
              normalized,
            ),
        },
      );

      throw normalized;
    } finally {
      span?.end?.();
    }
  }

  // ---------------------------------------------------------------------------
  // Request / tenant context
  // ---------------------------------------------------------------------------

  normalizeRequest(
    req,
    overrides = {},
  ) {
    if (
      !req ||
      !isObject(req)
    ) {
      throw new AirtelCallbackControllerError(
        'Airtel callback HTTP request is required.',
        {
          code:
            'AIRTEL_CALLBACK_REQUEST_REQUIRED',
          statusCode:
            CALLBACK_HTTP_STATUS.BAD_REQUEST,
        },
      );
    }

    const headers =
      normalizeHeaderMap(
        overrides.headers ??
          req.headers ??
          {},
      );

    const rawBody =
      overrides.rawBody ??
      req.rawBody ??
      req.bodyRaw ??
      req.locals?.rawBody ??
      null;

    const body =
      overrides.body !== undefined
        ? overrides.body
        : req.body;

    const callbackId =
      normalizeString(
        overrides.callbackId ??
          extractCallbackId(
            headers,
            isPlainObject(body)
              ? body
              : null,
          ),
        240,
      );

    const requestId =
      normalizeString(
        overrides.requestId ??
          headers['x-request-id'] ??
          headers['x-correlation-id'],
        240,
      ) ??
      `airtel_req_${crypto.randomUUID()}`;

    const correlationId =
      normalizeString(
        overrides.correlationId ??
          headers['x-correlation-id'] ??
          requestId,
        240,
      ) ??
      `airtel_corr_${crypto.randomUUID()}`;

    const operationId =
      normalizeString(
        overrides.operationId ??
          headers['x-operation-id'],
        240,
      ) ??
      `airtel_op_${crypto.randomUUID()}`;

    const causationId =
      normalizeString(
        overrides.causationId ??
          headers['x-causation-id'],
        240,
      );

    const signature =
      normalizeString(
        overrides.signature ??
          extractSignature(
            headers,
          ),
        2048,
      );

    const signatureTimestamp =
      normalizeString(
        overrides.signatureTimestamp ??
          extractSignatureTimestamp(
            headers,
          ),
        240,
      );

    return {
      ...overrides,
      headers,
      body,
      rawBody,

      method:
        normalizeString(
          overrides.method ??
            req.method ??
            'POST',
          16,
        )
          ?.toUpperCase() ??
        'POST',

      path:
        normalizeString(
          overrides.path ??
            req.originalUrl ??
            req.url,
          2048,
        ),

      protocol:
        normalizeString(
          overrides.protocol ??
            req.protocol,
          32,
        ),

      contentType:
        normalizeString(
          overrides.contentType ??
            headers['content-type'],
          128,
        ),

      callbackId,
      requestId,
      correlationId,
      operationId,
      causationId,
      signature,
      signatureTimestamp,

      traceId:
        normalizeString(
          overrides.traceId ??
            headers['x-trace-id'],
          240,
        ),

      userAgent:
        normalizeString(
          headers['user-agent'],
          512,
        ),

      clientIp:
        normalizeString(
          overrides.clientIp ??
            req.ip ??
            headers['x-forwarded-for'] ??
            req.socket?.remoteAddress ??
            req.connection
              ?.remoteAddress,
          256,
        ),

      trustedTenantId:
        normalizeString(
          overrides.tenantId ??
            req.tenantId ??
            req.locals?.tenantId ??
            req.auth?.tenantId ??
            req.user?.tenantId,
          160,
        ),

      actor:
        overrides.actor ??
        req.actor ??
        req.auth?.actor ??
        null,

      metadata:
        sanitize({
          httpMethod:
            req.method,
          path:
            req.originalUrl ??
            req.url,
          contentType:
            headers['content-type'],
          userAgent:
            headers['user-agent'],
        }),
    };
  }

  async buildTrustedContext(
    request,
  ) {
    let tenantId =
      request.trustedTenantId;

    if (
      !tenantId &&
      this.tenantResolver
    ) {
      const method =
        firstFunction(
          this.tenantResolver,
          [
            'resolveTrustedTenant',
            'resolveTenant',
            'resolve',
          ],
        );

      if (method) {
        try {
          const resolved =
            await this.tenantResolver[
              method
            ](
              {
                provider:
                  PROVIDER,
                operation:
                  OPERATION,
                callbackId:
                  request.callbackId,
                requestId:
                  request.requestId,
                correlationId:
                  request.correlationId,
                headers:
                  request.headers,
              },
              {
                provider:
                  PROVIDER,
                source:
                  'airtel-callback-controller',
              },
            );

          tenantId =
            normalizeString(
              typeof resolved ===
                'string'
                ? resolved
                : resolved?.tenantId ??
                  resolved?.id,
              160,
            );
        } catch (error) {
          throw new AirtelCallbackControllerError(
            'Trusted Airtel callback tenant resolution failed.',
            {
              code:
                'AIRTEL_CALLBACK_TENANT_RESOLUTION_FAILED',
              statusCode:
                CALLBACK_HTTP_STATUS.SERVICE_UNAVAILABLE,
              retryable:
                true,
              cause:
                error,
            },
          );
        }
      }
    }

    if (
      this.configuration
        .requireTenantId &&
      !tenantId
    ) {
      this.statistics.tenantRejected += 1;

      throw new AirtelCallbackControllerError(
        'Trusted tenant context is required for Airtel callbacks.',
        {
          code:
            'AIRTEL_CALLBACK_TENANT_REQUIRED',
          statusCode:
            this.configuration
              .failClosedOnMissingTenant
              ? CALLBACK_HTTP_STATUS.FORBIDDEN
              : CALLBACK_HTTP_STATUS.BAD_REQUEST,
          securityRejected:
            true,
        },
      );
    }

    return {
      provider:
        PROVIDER,

      operation:
        OPERATION,

      collectionOperation:
        COLLECTION_OPERATION,

      tenantId,

      actorId:
        normalizeString(
          request.actor?.actorId ??
            request.actor?.id ??
            this.configuration
              .systemActorId,
          200,
        ),

      actorType:
        normalizeString(
          request.actor?.actorType ??
            this.configuration
              .systemActorType,
          80,
        ),

      requestId:
        request.requestId,

      correlationId:
        request.correlationId,

      operationId:
        request.operationId,

      causationId:
        request.causationId,

      callbackId:
        request.callbackId,

      signature:
        request.signature,

      signatureTimestamp:
        request.signatureTimestamp,

      signatureVerified:
        false,

      receivedAt:
        nowIso(
          this.clock,
        ),

      userAgent:
        request.userAgent,

      clientIp:
        request.clientIp,

      payloadFingerprint:
        null,

      traceId:
        request.traceId,

      metadata:
        sanitize(
          request.metadata,
        ),
    };
  }

  assertTransport(
    request,
  ) {
    if (
      this.configuration
        .requirePost &&
      !this.configuration
        .acceptedMethods
        .includes(
          request.method ??
          'POST',
        )
    ) {
      throw new AirtelCallbackControllerError(
        'Airtel callback endpoint only accepts POST requests.',
        {
          code:
            'AIRTEL_CALLBACK_METHOD_NOT_ALLOWED',
          statusCode:
            CALLBACK_HTTP_STATUS.METHOD_NOT_ALLOWED,
          details: {
            method:
              request.method,
            allowed:
              this.configuration
                .acceptedMethods,
          },
        },
      );
    }

    const declaredLength =
      Number(
        request.headers?.[
          'content-length'
        ],
      );

    if (
      Number.isFinite(
        declaredLength,
      ) &&
      declaredLength >
        this.configuration
          .maxBodyBytes
    ) {
      this.statistics.oversized += 1;

      throw new AirtelCallbackControllerError(
        'Airtel callback request exceeds the configured maximum size.',
        {
          code:
            'AIRTEL_CALLBACK_PAYLOAD_TOO_LARGE',
          statusCode:
            CALLBACK_HTTP_STATUS.PAYLOAD_TOO_LARGE,
          details: {
            contentLength:
              declaredLength,
            maxBytes:
              this.configuration
                .maxBodyBytes,
          },
        },
      );
    }

    if (
      this.configuration
        .requireJsonContentType &&
      !/^application\/(json|.+\+json)(?:;|$)/i.test(
        request.contentType ??
          '',
      )
    ) {
      throw new AirtelCallbackControllerError(
        'Airtel callback endpoint requires a JSON content type.',
        {
          code:
            'AIRTEL_CALLBACK_CONTENT_TYPE_INVALID',
          statusCode:
            CALLBACK_HTTP_STATUS.UNSUPPORTED_MEDIA_TYPE,
        },
      );
    }

    if (
      this.configuration
        .requireRawBodyForSignature &&
      this.configuration
        .requireSignatureVerifierWhenControllerOwnsSecurity &&
      this.controllerOwnsSecurity() &&
      !request.rawBody
    ) {
      throw new AirtelCallbackControllerError(
        'Raw request body is required before Airtel callback signature verification.',
        {
          code:
            'AIRTEL_CALLBACK_RAW_BODY_REQUIRED',
          statusCode:
            CALLBACK_HTTP_STATUS.BAD_REQUEST,
        },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Pipeline selection / execution
  // ---------------------------------------------------------------------------

  controllerOwnsSecurity() {
    const pipeline =
      this.safeSelectPipeline();

    if (
      pipeline?.type ===
        PIPELINE_TYPES.CALLBACK_MODULE &&
      this.configuration
        .delegateSecurityToCallbackModule
    ) {
      return false;
    }

    return Boolean(
      this.configuration
        .controllerOwnsSecurityByDefault,
    );
  }

  selectPipeline() {
    const candidates = [
      [
        this.callbackModule,
        PIPELINE_TYPES.CALLBACK_MODULE,
        [
          'process',
          'handleCallback',
          'handle',
        ],
      ],

      [
        this.callbackService,
        PIPELINE_TYPES.COLLECTION_SERVICE,
        [
          'processCallback',
          'process',
          'handleCallback',
          'handle',
        ],
      ],

      [
        this.collectionService,
        PIPELINE_TYPES.COLLECTION_SERVICE,
        [
          'processCallback',
          'process',
          'handleCallback',
          'handle',
        ],
      ],

      [
        this.callbackProcessor,
        this.callbackCorrelation
          ? PIPELINE_TYPES.CORRELATED_PROCESSOR
          : PIPELINE_TYPES.GENERIC_PROCESSOR,
        [
          'process',
          'processCallback',
          'handleCallback',
          'handle',
        ],
      ],
    ];

    for (
      const [
        component,
        type,
        methods,
      ] of candidates
    ) {
      const method =
        firstFunction(
          component,
          methods,
        );

      if (method) {
        return {
          type,
          component,
          method,
        };
      }
    }

    if (
      this.configuration
        .strictPipeline
    ) {
      throw new AirtelCallbackControllerError(
        'No compatible Airtel callback processing boundary is configured.',
        {
          code:
            'AIRTEL_CALLBACK_PIPELINE_UNAVAILABLE',
          statusCode:
            CALLBACK_HTTP_STATUS.SERVICE_UNAVAILABLE,
          retryable:
            true,
        },
      );
    }

    return null;
  }

  safeSelectPipeline() {
    try {
      return this.selectPipeline();
    } catch {
      return null;
    }
  }

  async executePipeline({
    pipeline,
    request,
    payload,
    context,
  }) {
    let prepared =
      payload;

    let validation =
      null;

    let correlation =
      null;

    if (
      this.controllerOwnsSecurity()
    ) {
      const security =
        await this.runSecurityPipeline({
          request,
          payload,
          context,
        });

      validation =
        security.validation;

      prepared =
        security.callback;

      context.signatureVerified =
        true;

      context.securityMethod =
        security.securityMethod;

      prepared =
        await this.runNormalization({
          payload:
            prepared,
          request,
          context,
        });
    }

    if (!pipeline) {
      return {
        success:
          true,

        outcome:
          CALLBACK_OUTCOMES.ACCEPTED,

        status:
          CALLBACK_OUTCOMES.ACCEPTED,

        callback:
          sanitize(
            prepared,
          ),
      };
    }

    if (
      pipeline.type ===
        PIPELINE_TYPES.COLLECTION_SERVICE
    ) {
      return pipeline.component[
        pipeline.method
      ]({
        tenantId:
          context.tenantId,

        callback:
          prepared,

        correlation,

        correlationId:
          context.correlationId,

        operationId:
          context.operationId,

        requestId:
          context.requestId,

        traceId:
          context.traceId,

        context: {
          ...context,

          validation:
            sanitize(
              validation,
            ),
        },
      });
    }

    if (
      pipeline.type ===
        PIPELINE_TYPES.CORRELATED_PROCESSOR
    ) {
      correlation =
        await this.runCorrelation({
          callback:
            prepared,
          context,
        });

      return pipeline.component[
        pipeline.method
      ]({
        tenantId:
          context.tenantId,

        callback:
          prepared,

        correlation,

        correlationId:
          context.correlationId,

        operationId:
          context.operationId,

        context,
      });
    }

    if (
      pipeline.type ===
        PIPELINE_TYPES.CALLBACK_MODULE
    ) {
      return pipeline.component[
        pipeline.method
      ]({
        headers:
          request.headers,

        payload:
          prepared,

        rawBody:
          request.rawBody,

        tenantId:
          context.tenantId,

        actor: {
          actorId:
            context.actorId,
          actorType:
            context.actorType,
        },

        context,

        correlationId:
          context.correlationId,

        operationId:
          context.operationId,
      });
    }

    return pipeline.component[
      pipeline.method
    ]({
      tenantId:
        context.tenantId,

      callback:
        prepared,

      payload:
        prepared,

      context,

      correlation,

      correlationId:
        context.correlationId,

      operationId:
        context.operationId,

      headers:
        request.headers,

      rawBody:
        request.rawBody,
    });
  }

  async runSecurityPipeline({
    request,
    payload,
    context,
  }) {
    const verification =
      await this.verifySignature({
        request,
        payload,
        context,
      });

    if (
      verification?.valid !== true ||
      verification?.verified !== true
    ) {
      throw new AirtelCallbackControllerError(
        'Airtel callback signature could not be verified.',
        {
          code:
            verification?.code ??
            'AIRTEL_CALLBACK_SIGNATURE_VERIFICATION_UNAVAILABLE',

          statusCode:
            CALLBACK_HTTP_STATUS.UNAUTHORIZED,

          tenantId:
            context.tenantId,

          correlationId:
            context.correlationId,

          operationId:
            context.operationId,

          securityRejected:
            true,

          retryable:
            verification?.status ===
            SECURITY_RESULTS.UNAVAILABLE,
        },
      );
    }

    if (
      verification?.valid === false
    ) {
      throw new AirtelCallbackControllerError(
        'Airtel callback signature verification failed.',
        {
          code:
            verification.code ??
            'AIRTEL_CALLBACK_SIGNATURE_INVALID',

          statusCode:
            CALLBACK_HTTP_STATUS.UNAUTHORIZED,

          tenantId:
            context.tenantId,

          correlationId:
            context.correlationId,

          operationId:
            context.operationId,

          securityRejected:
            true,
        },
      );
    }

    const validation =
      await this.validateCallback({
        request,
        payload,
        context,
        verification,
      });

    if (
      validation?.valid === false ||
      validation?.verified === false
    ) {
      this.statistics
        .validationRejected += 1;

      throw new AirtelCallbackControllerError(
        'Airtel callback validation was rejected.',
        {
          code:
            validation?.code ??
            'AIRTEL_CALLBACK_VALIDATION_REJECTED',

          statusCode:
            CALLBACK_HTTP_STATUS.BAD_REQUEST,

          tenantId:
            context.tenantId,

          correlationId:
            context.correlationId,

          operationId:
            context.operationId,

          securityRejected:
            true,
        },
      );
    }

    const validationStatus =
      upper(
        validation?.status,
      );

    if (
      [
        'INVALID',
        'UNAUTHORIZED',
        'REJECTED',
      ].includes(
        validationStatus,
      )
    ) {
      if (
        validationStatus ===
        'UNAUTHORIZED'
      ) {
        this.statistics
          .signatureRejected += 1;
      } else {
        this.statistics
          .validationRejected += 1;
      }

      throw new AirtelCallbackControllerError(
        'Airtel callback validation was rejected.',
        {
          code:
            validation?.code ??
            'AIRTEL_CALLBACK_VALIDATION_REJECTED',

          statusCode:
            validationStatus ===
            'UNAUTHORIZED'
              ? CALLBACK_HTTP_STATUS.UNAUTHORIZED
              : CALLBACK_HTTP_STATUS.BAD_REQUEST,

          tenantId:
            context.tenantId,

          correlationId:
            context.correlationId,

          operationId:
            context.operationId,

          securityRejected:
            true,
        },
      );
    }

    if (
      validationStatus ===
        'REVIEW' ||
      validation?.reviewRequired ===
        true
    ) {
      this.statistics
        .validationRejected += 1;

      throw new AirtelCallbackControllerError(
        'Airtel callback requires security review before processing.',
        {
          code:
            validation?.code ??
            'AIRTEL_CALLBACK_SECURITY_REVIEW_REQUIRED',

          statusCode:
            CALLBACK_HTTP_STATUS.FORBIDDEN,

          tenantId:
            context.tenantId,

          correlationId:
            context.correlationId,

          operationId:
            context.operationId,

          securityRejected:
            true,
        },
      );
    }

    return {
      verification,
      validation,

      callback:
        validation?.callback ??
        validation?.payload ??
        payload,

      securityMethod:
        verification?.verified
          ? 'SIGNATURE_VERIFIER'
          : 'VALIDATOR',
    };
  }

  async verifySignature({
    request,
    payload,
    context,
  }) {
    if (!this.signatureVerifier) {
      if (
        this.callbackValidator &&
        this.configuration
          .validatorOwnsSignature
      ) {
        return {
          valid:
            true,

          verified:
            true,

          delegated:
            true,

          status:
            SECURITY_RESULTS.VERIFIED,
        };
      }

      if (
        this.configuration
          .allowUnsignedMode
      ) {
        return {
          valid:
            true,

          verified:
            false,

          status:
            SECURITY_RESULTS.UNAVAILABLE,
        };
      }

      if (
        this.configuration
          .requireSignatureVerifierWhenControllerOwnsSecurity
      ) {
        throw new AirtelCallbackControllerError(
          'No Airtel callback signature verifier is configured.',
          {
            code:
              'AIRTEL_CALLBACK_SIGNATURE_VERIFIER_UNAVAILABLE',

            statusCode:
              CALLBACK_HTTP_STATUS.SERVICE_UNAVAILABLE,

            retryable:
              true,

            tenantId:
              context.tenantId,

            correlationId:
              context.correlationId,

            operationId:
              context.operationId,
          },
        );
      }

      return {
        valid:
          true,

        verified:
          false,

        status:
          SECURITY_RESULTS.UNAVAILABLE,
      };
    }

    const method =
      firstFunction(
        this.signatureVerifier,
        [
          'verify',
          'validate',
          'verifySignature',
        ],
      );

    if (!method) {
      throw new AirtelCallbackControllerError(
        'Configured Airtel signature verifier exposes no supported method.',
        {
          code:
            'AIRTEL_CALLBACK_SIGNATURE_VERIFIER_CONTRACT_INVALID',

          statusCode:
            CALLBACK_HTTP_STATUS.SERVICE_UNAVAILABLE,

          retryable:
            true,

          tenantId:
            context.tenantId,

          correlationId:
            context.correlationId,

          operationId:
            context.operationId,
        },
      );
    }

    const result =
      await this.signatureVerifier[
        method
      ]({
        provider:
          PROVIDER,

        tenantId:
          context.tenantId,

        payload,

        rawBody:
          request.rawBody,

        headers:
          request.headers,

        signature:
          request.signature,

        signatureTimestamp:
          request.signatureTimestamp,

        correlationId:
          context.correlationId,

        operationId:
          context.operationId,

        context,
      });

    const valid =
      extractBooleanValidity(
        result,
      );

    if (
      valid === false
    ) {
      return {
        valid:
          false,

        verified:
          false,

        status:
          SECURITY_RESULTS.INVALID,

        code:
          result?.code ??
          'AIRTEL_CALLBACK_SIGNATURE_INVALID',
      };
    }

    if (
      valid !== true
    ) {
      return {
        ...(
          isPlainObject(result)
            ? sanitize(result)
            : {}
        ),

        valid:
          false,

        verified:
          false,

        status:
          SECURITY_RESULTS.UNAVAILABLE,

        code:
          result?.code ??
          'AIRTEL_CALLBACK_SIGNATURE_VERIFICATION_INDETERMINATE',
      };
    }

    return {
      ...(
        isPlainObject(result)
          ? sanitize(result)
          : {}
      ),

      valid:
        valid === true,

      verified:
        valid === true,

      status:
        valid === true
          ? SECURITY_RESULTS.VERIFIED
          : SECURITY_RESULTS.UNAVAILABLE,
    };
  }

  async validateCallback({
    request,
    payload,
    context,
    verification,
  }) {
    if (!this.callbackValidator) {
      return {
        valid:
          true,
        callback:
          payload,
      };
    }

    const method =
      firstFunction(
        this.callbackValidator,
        [
          'validate',
          'validateCallback',
          'validateDetailed',
        ],
      );

    if (!method) {
      throw new AirtelCallbackControllerError(
        'Configured Airtel callback validator exposes no supported method.',
        {
          code:
            'AIRTEL_CALLBACK_VALIDATOR_CONTRACT_INVALID',

          statusCode:
            CALLBACK_HTTP_STATUS.SERVICE_UNAVAILABLE,

          retryable:
            true,

          tenantId:
            context.tenantId,

          correlationId:
            context.correlationId,

          operationId:
            context.operationId,
        },
      );
    }

    try {
      return await this.callbackValidator[
        method
      ]({
        provider:
          PROVIDER,

        tenantId:
          context.tenantId,

        payload,

        rawBody:
          request.rawBody,

        headers:
          request.headers,

        signature:
          request.signature,

        signatureTimestamp:
          request.signatureTimestamp,

        verification,

        correlationId:
          context.correlationId,

        operationId:
          context.operationId,

        context,
      });
    } catch (error) {
      throw new AirtelCallbackControllerError(
        error?.message ??
          'Airtel callback validation failed.',
        {
          code:
            error?.code ??
            'AIRTEL_CALLBACK_VALIDATION_FAILED',

          statusCode:
            Number(
              error?.statusCode ??
              error?.status,
            ) ||
            CALLBACK_HTTP_STATUS.BAD_REQUEST,

          retryable:
            Boolean(
              error?.retryable,
            ),

          tenantId:
            context.tenantId,

          correlationId:
            context.correlationId,

          operationId:
            context.operationId,

          securityRejected:
            Boolean(
              error?.securityRejected,
            ),

          cause:
            error,
        },
      );
    }
  }

  async runNormalization({
    payload,
    request,
    context,
  }) {
    if (!this.callbackNormalizer) {
      return payload;
    }

    const method =
      firstFunction(
        this.callbackNormalizer,
        [
          'normalize',
          'transform',
        ],
      );

    if (!method) {
      return payload;
    }

    try {
      const result =
        await this.callbackNormalizer[
          method
        ]({
          provider:
            PROVIDER,

          operation:
            COLLECTION_OPERATION,

          payload,

          rawPayload:
            payload,

          rawBody:
            request.rawBody,

          headers:
            request.headers,

          context,
        });

      return (
        result?.callback ??
        result?.payload ??
        result ??
        payload
      );
    } catch (error) {
      throw new AirtelCallbackControllerError(
        'Airtel callback normalization failed.',
        {
          code:
            error?.code ??
            'AIRTEL_CALLBACK_NORMALIZATION_FAILED',

          statusCode:
            Number(
              error?.statusCode ??
              error?.status,
            ) ||
            CALLBACK_HTTP_STATUS.BAD_REQUEST,

          retryable:
            Boolean(
              error?.retryable,
            ),

          tenantId:
            context.tenantId,

          correlationId:
            context.correlationId,

          operationId:
            context.operationId,

          cause:
            error,
        },
      );
    }
  }

  async runCorrelation({
    callback,
    context,
  }) {
    if (!this.callbackCorrelation) {
      throw new AirtelCallbackControllerError(
        'Airtel callback correlation boundary is required.',
        {
          code:
            'AIRTEL_CALLBACK_CORRELATION_UNAVAILABLE',

          statusCode:
            CALLBACK_HTTP_STATUS.SERVICE_UNAVAILABLE,

          retryable:
            true,

          tenantId:
            context.tenantId,

          correlationId:
            context.correlationId,

          operationId:
            context.operationId,
        },
      );
    }

    const method =
      firstFunction(
        this.callbackCorrelation,
        [
          'correlate',
          'correlateCallback',
          'executeCorrelationLookup',
          'findCorrelation',
        ],
      );

    if (!method) {
      throw new AirtelCallbackControllerError(
        'Configured Airtel callback correlation boundary exposes no supported method.',
        {
          code:
            'AIRTEL_CALLBACK_CORRELATION_CONTRACT_INVALID',

          statusCode:
            CALLBACK_HTTP_STATUS.SERVICE_UNAVAILABLE,

          retryable:
            true,

          tenantId:
            context.tenantId,
        },
      );
    }

    const result =
      await this.callbackCorrelation[
        method
      ]({
        tenantId:
          context.tenantId,

        callback,

        correlationId:
          context.correlationId,

        requestId:
          context.requestId,

        traceId:
          context.traceId,

        context,
      });

    const status =
      upper(
        result?.status,
      );

    if (
      [
        'UNKNOWN',
        'REVIEW',
        'FAILED',
      ].includes(
        status,
      )
    ) {
      return result;
    }

    if (
      !result?.collection &&
      !result?.payment &&
      !result?.collectionId
    ) {
      throw new AirtelCallbackControllerError(
        'Airtel callback did not produce a safe correlation target.',
        {
          code:
            'AIRTEL_CALLBACK_NOT_CORRELATED',

          statusCode:
            CALLBACK_HTTP_STATUS.CONFLICT,

          tenantId:
            context.tenantId,

          correlationId:
            context.correlationId,

          operationId:
            context.operationId,
        },
      );
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Authorization / audit / events / dead-letter
  // ---------------------------------------------------------------------------

  async assertAuthorized(
    context,
  ) {
    if (!this.authorizationService) {
      return true;
    }

    const method =
      firstFunction(
        this.authorizationService,
        [
          'assertAuthorized',
          'authorize',
          'check',
        ],
      );

    if (!method) {
      return true;
    }

    const result =
      await this.authorizationService[
        method
      ]({
        tenantId:
          context.tenantId,

        actor: {
          actorId:
            context.actorId,

          actorType:
            context.actorType,
        },

        action:
          'PROCESS_AIRTEL_CALLBACK',

        provider:
          PROVIDER,

        operation:
          OPERATION,

        context,
      });

    if (
      result === false ||
      result?.allowed === false
    ) {
      throw new AirtelCallbackControllerError(
        'Airtel callback processing is not authorized for the resolved tenant context.',
        {
          code:
            'AIRTEL_CALLBACK_UNAUTHORIZED',

          statusCode:
            CALLBACK_HTTP_STATUS.FORBIDDEN,

          securityRejected:
            true,

          tenantId:
            context.tenantId,

          correlationId:
            context.correlationId,

          operationId:
            context.operationId,
        },
      );
    }

    return true;
  }

  async recordAuditSafe(
    action,
    {
      context,
      outcome,
      status,
      callbackId,
      collectionId: id,
      fingerprint,
      error,
    } = {},
  ) {
    if (!this.auditService) {
      return null;
    }

    const method =
      firstFunction(
        this.auditService,
        [
          'append',
          'record',
          'write',
          'createAuditLog',
        ],
      );

    if (!method) {
      return null;
    }

    const payload =
      sanitize({
        action,

        provider:
          PROVIDER,

        operation:
          OPERATION,

        tenantId:
          context?.tenantId ??
          null,

        correlationId:
          context?.correlationId ??
          null,

        operationId:
          context?.operationId ??
          null,

        callbackId:
          callbackId ??
          context?.callbackId ??
          null,

        collectionId:
          id ??
          null,

        fingerprint:
          fingerprint ??
          context?.payloadFingerprint ??
          null,

        outcome:
          outcome ??
          null,

        status:
          status ??
          null,

        error:
          error
            ? safeError(
              error,
            )
            : null,

        occurredAt:
          nowIso(
            this.clock,
          ),
      });

    payload.auditFingerprint =
      sha256(
        payload,
      );

    try {
      return await this.auditService[
        method
      ](payload);
    } catch (auditError) {
      this.statistics
        .auditFailures += 1;

      this.log(
        'error',
        'Airtel callback audit recording failed.',
        {
          tenantId:
            context?.tenantId,

          correlationId:
            context?.correlationId,

          error:
            safeError(
              auditError,
            ),
        },
      );

      if (
        this.configuration
          .failClosedOnAuditError
      ) {
        throw new AirtelCallbackControllerError(
          'Airtel callback audit boundary is unavailable.',
          {
            code:
              'AIRTEL_CALLBACK_AUDIT_UNAVAILABLE',

            statusCode:
              CALLBACK_HTTP_STATUS.SERVICE_UNAVAILABLE,

            retryable:
              true,

            tenantId:
              context?.tenantId,

            correlationId:
              context?.correlationId,

            operationId:
              context?.operationId,

            cause:
              auditError,
          },
        );
      }

      return null;
    }
  }

  async publishEventSafe(
    eventType,
    {
      context,
      outcome,
      callbackId,
      collectionId: id,
      fingerprint,
    } = {},
  ) {
    const publisher =
      this.outboxService ??
      this.eventBus;

    if (!publisher) {
      return null;
    }

    const method =
      firstFunction(
        publisher,
        [
          'publish',
          'enqueue',
          'emit',
          'publishEvent',
        ],
      );

    if (!method) {
      return null;
    }

    const payload =
      sanitize({
        type:
          `${this.configuration.eventNamespace}.${eventType}`,

        provider:
          PROVIDER,

        operation:
          OPERATION,

        tenantId:
          context?.tenantId ??
          null,

        correlationId:
          context?.correlationId ??
          null,

        operationId:
          context?.operationId ??
          null,

        occurredAt:
          nowIso(
            this.clock,
          ),

        payload: {
          callbackId:
            callbackId ??
            context?.callbackId ??
            null,

          collectionId:
            id ??
            null,

          outcome:
            outcome ??
            null,

          callbackFingerprint:
            fingerprint ??
            context?.payloadFingerprint ??
            null,
        },
      });

    payload.eventFingerprint =
      sha256(
        payload,
      );

    try {
      return await publisher[
        method
      ](payload);
    } catch (eventError) {
      this.statistics
        .eventFailures += 1;

      this.log(
        'error',
        'Airtel callback event publication failed.',
        {
          tenantId:
            context?.tenantId,

          correlationId:
            context?.correlationId,

          error:
            safeError(
              eventError,
            ),
        },
      );

      if (
        this.configuration
          .failClosedOnEventError
      ) {
        throw new AirtelCallbackControllerError(
          'Airtel callback event boundary is unavailable.',
          {
            code:
              'AIRTEL_CALLBACK_EVENT_UNAVAILABLE',

            statusCode:
              CALLBACK_HTTP_STATUS.SERVICE_UNAVAILABLE,

            retryable:
              true,

            tenantId:
              context?.tenantId,

            correlationId:
              context?.correlationId,

            operationId:
              context?.operationId,

            cause:
              eventError,
          },
        );
      }

      return null;
    }
  }

  async safeVerifiedDeadLetter(
    request,
    context,
    error,
  ) {
    if (
      !this.deadLetterQueue ||
      error?.securityRejected ||
      !context?.signatureVerified
    ) {
      return null;
    }

    const method =
      firstFunction(
        this.deadLetterQueue,
        [
          'enqueue',
          'add',
          'push',
          'deadLetter',
        ],
      );

    if (!method) {
      return null;
    }

    const fingerprint =
      context.payloadFingerprint ??
      sha256(
        request.rawBody ??
          request.body ??
          {},
      );

    try {
      const result =
        await this.deadLetterQueue[
          method
        ]({
          provider:
            PROVIDER,

          operation:
            OPERATION,

          tenantId:
            context.tenantId,

          actor: {
            actorId:
              context.actorId,

            actorType:
              context.actorType,
          },

          callbackId:
            context.callbackId,

          correlationId:
            context.correlationId,

          operationId:
            context.operationId,

          payloadFingerprint:
            fingerprint,

          headers:
            this.redactHeaders(
              request.headers,
            ),

          reason:
            error?.code ??
            'AIRTEL_CALLBACK_PROCESSING_FAILED',

          error:
            safeError(
              error,
            ),

          payload: {
            omitted:
              true,

            reason:
              'RAW_CALLBACK_PAYLOAD_NOT_PERSISTED_BY_CONTROLLER',

            sha256:
              fingerprint,
          },

          receivedAt:
            nowIso(
              this.clock,
            ),
        });

      this.statistics
        .deadLettered += 1;

      this.metric(
        'airtel_callback_controller_dead_lettered_total',
      );

      return result;
    } catch (dlqError) {
      this.log(
        'error',
        'Airtel callback dead-letter persistence failed.',
        {
          tenantId:
            context?.tenantId,

          correlationId:
            context?.correlationId,

          error:
            safeError(
              dlqError,
            ),
        },
      );

      return null;
    }
  }

  redactHeaders(
    headers = {},
  ) {
    const normalized =
      normalizeHeaderMap(
        headers,
      );

    return Object.fromEntries(
      Object.entries(
        normalized,
      ).map(
        ([key, value]) => [
          key,
          SENSITIVE_KEY_PATTERN.test(
            key,
          )
            ? '[REDACTED]'
            : value,
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Result/error shaping
  // ---------------------------------------------------------------------------

  recordStatistics(
    result = {},
  ) {
    switch (
      extractOutcome(
        result,
      )
    ) {
      case CALLBACK_OUTCOMES.DUPLICATE:
        this.statistics
          .duplicates += 1;
        break;

      case CALLBACK_OUTCOMES.PENDING:
        this.statistics
          .pending += 1;
        break;

      case CALLBACK_OUTCOMES.AMBIGUOUS:
      case CALLBACK_OUTCOMES.UNKNOWN:
        this.statistics
          .ambiguous += 1;
        break;

      case CALLBACK_OUTCOMES.REVIEW:
      case CALLBACK_OUTCOMES.RECONCILIATION_REQUIRED:
        this.statistics
          .reviews += 1;
        break;

      case CALLBACK_OUTCOMES.REJECTED:
        this.statistics
          .rejected += 1;
        break;

      case CALLBACK_OUTCOMES.FAILED:
        this.statistics
          .failed += 1;
        break;

      default:
        this.statistics
          .processed += 1;
        break;
    }

    return this.statisticsSnapshot();
  }

  normalizeResult(
    result,
    context,
    pipeline = null,
  ) {
    const value =
      pipelineResult(
        result,
      ) ??
      {};

    const outcome =
      extractOutcome(
        value,
      );

    const callback =
      value.callback ??
      value.normalizedCallback ??
      null;

    return {
      success:
        value.success !== false &&
        ![
          CALLBACK_OUTCOMES.REJECTED,
          CALLBACK_OUTCOMES.FAILED,
        ].includes(
          outcome,
        ),

      provider:
        PROVIDER,

      operation:
        OPERATION,

      outcome,

      status:
        normalizeString(
          value.status ??
            outcome,
          120,
        ),

      duplicate:
        Boolean(
          value.duplicate ||
          outcome ===
            CALLBACK_OUTCOMES.DUPLICATE,
        ),

      replay:
        Boolean(
          value.replay,
        ),

      callbackId:
        normalizeString(
          value.callbackId ??
            callback?.callbackId ??
            callback?.id ??
            context.callbackId,
          240,
        ),

      collectionId:
        collectionId(
          value,
        ) ??
        collectionId(
          callback,
        ),

      transactionId:
        normalizeString(
          value.transactionId ??
            value.financialTransactionId ??
            callback?.transactionId,
          240,
        ),

      providerReference:
        normalizeString(
          value.providerReference ??
            callback?.providerReference ??
            callback?.transactionId,
          240,
        ),

      reviewRequired:
        Boolean(
          value.reviewRequired ||
          outcome ===
            CALLBACK_OUTCOMES.REVIEW ||
          outcome ===
            CALLBACK_OUTCOMES.RECONCILIATION_REQUIRED,
        ),

      nextAction:
        normalizeString(
          value.nextAction ??
            value.action,
          240,
        ),

      reason:
        normalizeString(
          value.reason ??
            value.message,
          500,
        ),

      callbackFingerprint:
        context.payloadFingerprint,

      correlationId:
        context.correlationId,

      operationId:
        context.operationId,

      tenantId:
        context.tenantId,

      pipeline:
        pipeline?.type ??
        null,

      financialSettlement:
        Boolean(
          value.settled === true ||
          value.financialSettlement
            ?.confirmed === true,
        ),

      retryable:
        Boolean(
          value.retryable,
        ),

      uncertain:
        Boolean(
          value.uncertain,
        ),

      timestamp:
        nowIso(
          this.clock,
        ),
    };
  }

  normalizeError(
    error,
    context = {},
  ) {
    if (
      error instanceof
      AirtelCallbackControllerError
    ) {
      error.tenantId ??=
        context.tenantId ??
        null;

      error.correlationId ??=
        context.correlationId ??
        null;

      error.operationId ??=
        context.operationId ??
        null;

      error.payloadFingerprint ??=
        context.payloadFingerprint ??
        null;

      return error;
    }

    const details =
      safeError(
        error,
      );

    const code =
      normalizeString(
        error?.code,
        160,
      ) ??
      'AIRTEL_CALLBACK_PROCESSING_FAILED';

    const upperCode =
      upper(
        code,
      ) ??
      '';

    const statusCode =
      Number(
        error?.statusCode ??
        error?.status,
      );

    return new AirtelCallbackControllerError(
      error?.message ??
        'Airtel callback processing failed.',
      {
        code,

        statusCode:
          Number.isInteger(
            statusCode,
          ) &&
          statusCode >= 100 &&
          statusCode <= 599
            ? statusCode
            : upperCode.includes(
                'SIGNATURE',
              )
              ? CALLBACK_HTTP_STATUS.UNAUTHORIZED
              : upperCode.includes(
                  'TIMEOUT',
                )
                ? CALLBACK_HTTP_STATUS.GATEWAY_TIMEOUT
                : upperCode.includes(
                    'TENANT',
                  )
                  ? CALLBACK_HTTP_STATUS.FORBIDDEN
                  : CALLBACK_HTTP_STATUS.INTERNAL_ERROR,

        retryable:
          Boolean(
            error?.retryable,
          ),

        uncertain:
          Boolean(
            error?.uncertain,
          ),

        securityRejected:
          Boolean(
            error?.securityRejected ||
            upperCode.includes(
              'SIGNATURE',
            ) ||
            upperCode.includes(
              'UNAUTHORIZED',
            ) ||
            upperCode.includes(
              'FORBIDDEN',
            ),
          ),

        tenantId:
          context.tenantId ??
          error?.tenantId ??
          null,

        correlationId:
          context.correlationId ??
          error?.correlationId ??
          null,

        operationId:
          context.operationId ??
          error?.operationId ??
          null,

        payloadFingerprint:
          context.payloadFingerprint ??
          null,

        details: {
          causeName:
            error?.name ??
            null,

          cause:
            details,
        },

        cause:
          error,
      },
    );
  }

  httpStatusForResult(
    result,
  ) {
    const outcome =
      extractOutcome(
        result,
      );

    if (
      outcome ===
        CALLBACK_OUTCOMES.DUPLICATE &&
      this.configuration
        .acknowledgeDuplicates
    ) {
      return CALLBACK_HTTP_STATUS.RECEIVED;
    }

    if (
      ACKNOWLEDGEMENT_OUTCOMES
        .ASYNC_ACCEPTED
        .includes(
          outcome,
        ) &&
      this.configuration
        .acknowledgeAsyncProcessing
    ) {
      return CALLBACK_HTTP_STATUS.ACCEPTED;
    }

    if (
      result?.uncertain ||
      result?.retryable
    ) {
      return CALLBACK_HTTP_STATUS.SERVICE_UNAVAILABLE;
    }

    if (
      result?.success === false ||
      [
        CALLBACK_OUTCOMES.REJECTED,
        CALLBACK_OUTCOMES.FAILED,
      ].includes(
        outcome,
      )
    ) {
      return CALLBACK_HTTP_STATUS.CONFLICT;
    }

    return CALLBACK_HTTP_STATUS.RECEIVED;
  }

  httpStatusForError(
    error,
  ) {
    if (
      Number.isInteger(
        error?.statusCode,
      ) &&
      error.statusCode >=
        400 &&
      error.statusCode <=
        599
    ) {
      return error.statusCode;
    }

    if (
      error?.uncertain ||
      error?.retryable
    ) {
      return CALLBACK_HTTP_STATUS.SERVICE_UNAVAILABLE;
    }

    return CALLBACK_HTTP_STATUS.INTERNAL_ERROR;
  }

  buildHttpResponse(
    result,
  ) {
    const status =
      this.httpStatusForResult(
        result,
      );

    return {
      received:
        true,

      accepted:
        status < 400,

      success:
        result?.success !== false,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      status:
        result?.status ??
        result?.outcome ??
        CALLBACK_OUTCOMES.ACCEPTED,

      outcome:
        result?.outcome ??
        CALLBACK_OUTCOMES.ACCEPTED,

      duplicate:
        Boolean(
          result?.duplicate,
        ),

      replay:
        Boolean(
          result?.replay,
        ),

      callbackId:
        result?.callbackId ??
        null,

      collectionId:
        result?.collectionId ??
        null,

      transactionId:
        result?.transactionId ??
        null,

      providerReference:
        result?.providerReference ??
        null,

      correlationId:
        result?.correlationId ??
        null,

      operationId:
        result?.operationId ??
        null,

      nextAction:
        result?.nextAction ??
        null,

      reviewRequired:
        Boolean(
          result?.reviewRequired,
        ),

      message:
        result?.reason ??
        null,
    };
  }

  buildHttpErrorResponse(
    error,
  ) {
    const status =
      this.httpStatusForError(
        error,
      );

    return {
      received:
        false,

      accepted:
        false,

      success:
        false,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      correlationId:
        error?.correlationId ??
        null,

      operationId:
        error?.operationId ??
        null,

      error: {
        code:
          error?.code ??
          'AIRTEL_CALLBACK_PROCESSING_FAILED',

        message:
          status >= 500 ||
          !this.configuration
            .includeErrorMessageFor4xx
            ? 'Airtel callback processing could not be completed.'
            : error?.message,

        retryable:
          Boolean(
            error?.retryable,
          ),

        uncertain:
          Boolean(
            error?.uncertain,
          ),
      },
    };
  }

  fingerprint(
    payload,
    tenantId,
  ) {
    return sha256({
      schemaVersion:
        SCHEMA_VERSION,

      provider:
        PROVIDER,

      tenantId:
        tenantId ??
        null,

      payload:
        sanitize(
          payload,
        ),
    });
  }

  // ---------------------------------------------------------------------------
  // Lifecycle / diagnostics
  // ---------------------------------------------------------------------------

  async initialize(
    context = {},
  ) {
    if (
      this.initialized
    ) {
      return this.health();
    }

    if (
      this.initializingPromise
    ) {
      return this.initializingPromise;
    }

    this.state =
      CONTROLLER_STATUS.INITIALIZING;

    this.initializingPromise =
      Promise.resolve()
        .then(
          async () => {
            const dependencies =
              this.dependencyDiagnostics();

            if (
              dependencies
                .errors.length
            ) {
              throw new AirtelCallbackControllerError(
                'Airtel callback controller dependencies are incomplete.',
                {
                  code:
                    'AIRTEL_CALLBACK_CONTROLLER_DEPENDENCY_FAILURE',

                  statusCode:
                    CALLBACK_HTTP_STATUS.SERVICE_UNAVAILABLE,

                  retryable:
                    true,

                  tenantId:
                    context.tenantId ??
                    null,

                  details:
                    dependencies,
                },
              );
            }

            this.initialized =
              true;

            this.state =
              CONTROLLER_STATUS.READY;

            await this.recordAuditSafe(
              'AIRTEL_CALLBACK_CONTROLLER_INITIALIZED',
              {
                context: {
                  ...context,

                  tenantId:
                    context.tenantId ??
                    null,

                  correlationId:
                    context.correlationId ??
                    null,

                  operationId:
                    context.operationId ??
                    null,
                },
              },
            );

            return this.health();
          },
        )
        .catch(
          (error) => {
            this.state =
              CONTROLLER_STATUS.DEGRADED;

            throw error;
          },
        )
        .finally(
          () => {
            this.initializingPromise =
              null;
          },
        );

    return this.initializingPromise;
  }

  async shutdown() {
    this.state =
      CONTROLLER_STATUS.STOPPING;

    this.initialized =
      false;

    this.state =
      CONTROLLER_STATUS.STOPPED;

    return this.health();
  }

  dependencyDiagnostics() {
    const errors = [];

    const pipeline =
      this.safeSelectPipeline();

    if (!pipeline) {
      errors.push(
        'callbackPipeline',
      );
    }

    const securityDelegated =
      !this.controllerOwnsSecurity();

    const securitySatisfied =
      securityDelegated ||
      Boolean(
        this.signatureVerifier,
      ) ||
      Boolean(
        this.callbackValidator,
      ) ||
      this.configuration
        .allowUnsignedMode;

    if (
      this.controllerOwnsSecurity() &&
      this.configuration
        .requireSignatureVerifierWhenControllerOwnsSecurity &&
      !securitySatisfied
    ) {
      errors.push(
        'signatureOrValidationBoundary',
      );
    }

    return {
      errors,

      pipeline:
        pipeline
          ? {
              type:
                pipeline.type,
              method:
                pipeline.method,
            }
          : null,

      trustedTenantContext:
        Boolean(
          this.tenantResolver,
        ),

      requestScopedTenantAccepted:
        true,

      securityDelegated,

      signatureVerifier:
        Boolean(
          this.signatureVerifier,
        ),

      callbackValidator:
        Boolean(
          this.callbackValidator,
        ),

      callbackNormalizer:
        Boolean(
          this.callbackNormalizer,
        ),

      callbackCorrelation:
        Boolean(
          this.callbackCorrelation,
        ),

      authorizationService:
        Boolean(
          this.authorizationService,
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

      deadLetterQueue:
        Boolean(
          this.deadLetterQueue,
        ),
    };
  }

  isReady() {
    return this.health().ready;
  }

  async assertReady() {
    if (this.isReady()) {
      return true;
    }

    throw new AirtelCallbackControllerError(
      'Airtel callback controller is not ready.',
      {
        code:
          'AIRTEL_CALLBACK_CONTROLLER_NOT_READY',

        statusCode:
          CALLBACK_HTTP_STATUS.SERVICE_UNAVAILABLE,

        retryable:
          true,
      },
    );
  }

  health() {
    const dependencies =
      this.dependencyDiagnostics();

    return {
      component:
        COMPONENT,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      engine:
        ENGINE_NAME,

      engineVersion:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      state:
        this.state,

      initialized:
        this.initialized,

      ready:
        this.initialized &&
        dependencies.errors.length ===
          0,

      startedAt:
        this.startedAt,

      activePipeline:
        dependencies.pipeline,

      dependencies,

      statistics:
        this.statisticsSnapshot(),

      financialBoundary:
        FINANCIAL_BOUNDARY,
    };
  }

  readiness() {
    const health =
      this.health();

    return {
      ready:
        health.ready,

      status:
        health.ready
          ? 'READY'
          : this.state ===
              CONTROLLER_STATUS.DEGRADED
            ? 'DEGRADED'
            : 'NOT_READY',

      provider:
        PROVIDER,

      operation:
        OPERATION,

      missing:
        health
          .dependencies
          .errors,

      timestamp:
        nowIso(
          this.clock,
        ),
    };
  }

  liveness() {
    return {
      alive:
        true,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      service:
        ENGINE_NAME,

      timestamp:
        nowIso(
          this.clock,
        ),
    };
  }

  capabilities() {
    return {
      ...CAPABILITIES,

      pipeline:
        this.safeSelectPipeline(),

      configuration: {
        requireTenantId:
          this.configuration
            .requireTenantId,

        controllerOwnsSecurity:
          this.controllerOwnsSecurity(),

        validatorOwnsSignature:
          this.configuration
            .validatorOwnsSignature,

        requireRawBodyForSignature:
          this.configuration
            .requireRawBodyForSignature,

        maxBodyBytes:
          this.configuration
            .maxBodyBytes,
      },
    };
  }

  diagnostics() {
    return {
      module:
        MODULE_NAME,

      component:
        COMPONENT,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      engine:
        ENGINE_NAME,

      engineVersion:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      health:
        this.health(),

      readiness:
        this.readiness(),

      liveness:
        this.liveness(),

      capabilities:
        this.capabilities(),

      configuration:
        sanitize(
          this.configuration,
        ),

      architecture: {
        tenantResolution:
          true,

        signatureVerification:
          this.controllerOwnsSecurity(),

        callbackValidation:
          Boolean(
            this.callbackValidator,
          ),

        normalization:
          Boolean(
            this.callbackNormalizer,
          ),

        correlation:
          Boolean(
            this.callbackCorrelation,
          ),

        deadLetterBoundary:
          Boolean(
            this.deadLetterQueue,
          ),

        auditBoundary:
          Boolean(
            this.auditService,
          ),

        eventBoundary:
          Boolean(
            this.eventBus ||
            this.outboxService,
          ),
      },

      financialBoundary:
        FINANCIAL_BOUNDARY,
    };
  }

  snapshot() {
    return {
      timestamp:
        nowIso(
          this.clock,
        ),

      state:
        this.state,

      initialized:
        this.initialized,

      statistics:
        this.statisticsSnapshot(),

      capabilities:
        this.capabilities(),
    };
  }

  statisticsSnapshot() {
    return {
      ...this.statistics,
    };
  }

  // ---------------------------------------------------------------------------
  // Observability
  // ---------------------------------------------------------------------------

  metric(
    name,
    labelsOrValue,
  ) {
    try {
      if (
        typeof labelsOrValue ===
        'number'
      ) {
        if (
          isFunction(
            this.metrics?.histogram,
          )
        ) {
          return this.metrics.histogram(
            name,
            labelsOrValue,
          );
        }

        if (
          isFunction(
            this.metrics?.observe,
          )
        ) {
          return this.metrics.observe(
            name,
            labelsOrValue,
          );
        }

        if (
          isFunction(
            this.metrics?.increment,
          )
        ) {
          return this.metrics.increment(
            name,
            labelsOrValue,
          );
        }

        if (
          isFunction(
            this.metrics?.inc,
          )
        ) {
          return this.metrics.inc(
            name,
            labelsOrValue,
          );
        }

        return undefined;
      }

      const labels =
        sanitize(
          labelsOrValue ??
            {},
        );

      if (
        isFunction(
          this.metrics?.increment,
        )
      ) {
        return this.metrics.increment(
          name,
          1,
          labels,
        );
      }

      if (
        isFunction(
          this.metrics?.inc,
        )
      ) {
        return this.metrics.inc(
          name,
          1,
          labels,
        );
      }

      if (
        isFunction(
          this.metrics?.counter,
        )
      ) {
        return this.metrics.counter(
          name,
          1,
          labels,
        );
      }
    } catch {
      // Metrics are non-authoritative.
    }

    return undefined;
  }

  startSpan(
    name,
    attributes = {},
  ) {
    try {
      const span =
        this.tracer?.startSpan?.(
          name,
        );

      if (!span) {
        return null;
      }

      const safeAttributes =
        sanitize(
          attributes,
        );

      if (
        isFunction(
          span.setAttributes,
        )
      ) {
        span.setAttributes(
          safeAttributes,
        );
      } else if (
        isFunction(
          span.setAttribute,
        )
      ) {
        for (
          const [
            key,
            value,
          ] of Object.entries(
            safeAttributes,
          )
        ) {
          span.setAttribute(
            key,
            value == null
              ? ''
              : String(value),
          );
        }
      }

      return span;
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
      if (!this.logger) {
        return;
      }

      const method =
        isFunction(
          this.logger[level],
        )
          ? this.logger[level]
          : this.logger.info;

      method?.call(
        this.logger,
        {
          component:
            COMPONENT,

          provider:
            PROVIDER,

          operation:
            OPERATION,

          message,

          ...sanitize(
            metadata,
          ),
        },
      );
    } catch {
      // Logging is non-authoritative.
    }
  }
}

// =============================================================================
// Factories / compatibility aliases
// =============================================================================

export function createAirtelCallbackController(
  options = {},
) {
  return new AirtelCallbackController(
    options,
  );
}

export function createCallbackController(
  options = {},
) {
  return createAirtelCallbackController(
    options,
  );
}

export const CallbackController =
  AirtelCallbackController;

export const AirtelCallbackHttpController =
  AirtelCallbackController;

export const DEFAULTS =
  DEFAULT_CONFIGURATION;

export const CONSTANTS =
  Object.freeze({
    PROVIDER,
    OPERATION,
    COLLECTION_OPERATION,
    MODULE_NAME,
    ENGINE_NAME,
    ENGINE_VERSION,
    COMPONENT,
    SCHEMA_VERSION,
    CALLBACK_HTTP_STATUS,
    CONTROLLER_STATUS,
    CALLBACK_OUTCOMES,
    SECURITY_RESULTS,
    PIPELINE_TYPES,
    ACKNOWLEDGEMENT_OUTCOMES,
    DEFAULT_CONFIGURATION,
    CAPABILITIES,
    FINANCIAL_BOUNDARY,
  });

export default AirtelCallbackController;