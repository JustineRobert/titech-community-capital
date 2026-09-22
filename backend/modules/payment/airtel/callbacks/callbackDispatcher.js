/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Callback Dispatcher
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/callbacks/callbackDispatcher.js
 *
 * Architectural role
 * ------------------
 * Canonical application dispatch boundary between the already authenticated /
 * validated Airtel callback and the correct internal callback processor.
 *
 * Processing boundary
 * -------------------
 * HTTP/controller
 *      -> signature + validation
 *      -> normalization
 *      -> correlation
 *      -> THIS DISPATCHER
 *      -> callback processor / operation handler
 *      -> Financial Core / reconciliation
 *
 * Responsibilities
 * ----------------
 * - Require a trusted tenant context.
 * - Require an explicitly trusted/security-validated callback by default.
 * - Resolve the Airtel operation/handler deterministically.
 * - Enforce idempotent dispatch admission where an injected authoritative
 *   idempotency/callback repository supports it.
 * - Prevent concurrent duplicate dispatches in-process.
 * - Preserve correlationId, operationId, callbackId and callback fingerprint.
 * - Route successful, pending, review, unknown and failed outcomes consistently.
 * - Bound handler execution with timeout and retry policy.
 * - Route safe failures to an injected DLQ without persisting raw transport data.
 * - Publish sanitized audit/events and operational metrics.
 * - Expose health, readiness, diagnostics, lifecycle and statistics.
 *
 * Explicitly NOT responsible for
 * -------------------------------
 * - Airtel OAuth/API calls.
 * - Signature implementation.
 * - HTTP response generation.
 * - Callback schema ownership when a validator already exists upstream.
 * - Correlation decisions.
 * - Fraud/KYC/AML source-of-truth decisions.
 * - Direct ledger posting.
 * - Balance/wallet mutation.
 * - Settlement finality.
 * - Direct payment execution outside the injected processor.
 * - Treating callback acknowledgement as financial settlement.
 *
 * Security principles
 * -------------------
 * 1. Tenant identity comes only from trusted execution context; callback-body
 *    tenantId is never authority.
 * 2. An unverified/indeterminate callback is rejected before dispatch by
 *    default.
 * 3. Exact callback identity is preserved across all retries; a retry never
 *    creates a new callback identity.
 * 4. Duplicate admission is read-only and financial-state agnostic.
 * 5. Concurrent duplicate dispatch is blocked before processor invocation.
 * 6. Requeue/DLQ is recovery orchestration only; it does not execute money.
 * 7. Raw callback bodies, credentials and signatures never enter logs/audits.
 * 8. Weak or unknown operation routing fails closed to review / DLQ.
 * 9. Handler output cannot be used to claim settlement unless the downstream
 *    Financial Core explicitly provides authoritative settlement evidence.
 *
 * Module format
 * -------------
 * Native ESM. The target backend is ESM and Node.js 24.x.
 * =============================================================================
 */

import crypto from 'node:crypto';

export const PROVIDER = 'AIRTEL';
export const OPERATION = 'CALLBACK';
export const COMPONENT = 'titech.airtel.callbacks.dispatcher';
export const ENGINE_NAME = 'airtel-callback-dispatcher';
export const ENGINE_VERSION = '5.0.0';
export const SCHEMA_VERSION = 5;
export const FINANCIAL_BOUNDARY = 'TITECH_FINANCIAL_CORE';

export const DISPATCH_STATUS = Object.freeze({
  ACCEPTED: 'ACCEPTED',
  PROCESSED: 'PROCESSED',
  PENDING: 'PENDING',
  REVIEW: 'REVIEW',
  UNKNOWN: 'UNKNOWN',
  DUPLICATE: 'DUPLICATE',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
  DEAD_LETTERED: 'DEAD_LETTERED',
});

export const ROUTES = Object.freeze({
  COLLECTION: 'COLLECTION',
  DISBURSEMENT: 'DISBURSEMENT',
  GENERIC: 'GENERIC',
  DEFAULT: 'DEFAULT',
  REVIEW: 'REVIEW',
  UNKNOWN: 'UNKNOWN',
});

export const HANDLER_METHODS = Object.freeze([
  'processCallback',
  'process',
  'handle',
  'dispatch',
]);

export const DEFAULTS = Object.freeze({
  requireTenantId: true,
  requireSecurityVerification: true,
  failClosedOnMissingHandler: true,
  failClosedOnIdempotencyUnavailable: true,
  failClosedOnHandlerError: true,
  failClosedOnDlqFailure: false,
  maxPayloadBytes: 1024 * 1024,
  maxMetadataBytes: 64 * 1024,
  handlerTimeoutMs: 15_000,
  maxRetries: 1,
  retryBackoffMs: 150,
  maxConcurrentDispatches: 250,
  localLockTtlMs: 30_000,
  publishEvents: true,
  audit: true,
  failureStatus: DISPATCH_STATUS.FAILED,
  acceptedMethods: ['POST'],
  operationAliases: Object.freeze({
    COLLECTION: ROUTES.COLLECTION,
    COLLECT: ROUTES.COLLECTION,
    RECEIVE: ROUTES.COLLECTION,
    RECEIVEMONEY: ROUTES.COLLECTION,
    PAYMENT: ROUTES.COLLECTION,
    PAYMENTS: ROUTES.COLLECTION,
    DISBURSEMENT: ROUTES.DISBURSEMENT,
    DISBURSE: ROUTES.DISBURSEMENT,
    PAYOUT: ROUTES.DISBURSEMENT,
    GENERIC: ROUTES.GENERIC,
    CALLBACK: ROUTES.GENERIC,
  }),
});

const SENSITIVE_KEY = /authorization|proxy.?authorization|cookie|set-cookie|secret|password|token|signature|private.?key|api.?key|credential|otp|pin|cvv|cvc|pan/i;
const RAW_KEY = /^raw|request.?body|response.?body|webhook.?body|request|response/i;
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function isFunction(value) {
  return typeof value === 'function';
}

function isPlainObject(value) {
  if (!isObject(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function now(clock) {
  const value = isFunction(clock?.now) ? clock.now() : Date.now();
  return new Date(value);
}

function randomId() {
  return crypto.randomUUID();
}

function normalizeString(value, max = 512) {
  if (value === undefined || value === null) return null;
  const output = String(value).trim();
  return output ? output.slice(0, max) : null;
}

function normalizeUpper(value) {
  const output = normalizeString(value, 128);
  return output ? output.toUpperCase() : null;
}

function byteLength(value) {
  if (value === undefined || value === null) return 0;
  if (Buffer.isBuffer(value)) return value.length;
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function safeClone(value, depth = 0) {
  if (depth > 8) return '[DEPTH_LIMIT]';
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return typeof value === 'bigint' ? String(value) : value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return '[BUFFER_REDACTED]';
  if (Array.isArray(value)) return value.slice(0, 250).map((item) => safeClone(item, depth + 1));

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (BLOCKED_KEYS.has(key)) continue;
    if (SENSITIVE_KEY.test(key)) {
      out[key] = '[REDACTED]';
      continue;
    }
    if (RAW_KEY.test(key)) {
      out[key] = '[OMITTED]';
      continue;
    }
    out[key] = safeClone(item, depth + 1);
  }
  return out;
}

function canonicalize(value, depth = 0) {
  if (depth > 10) return '[DEPTH_LIMIT]';
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[BUFFER:${sha256(value)}]`;
  if (typeof value !== 'object') return typeof value === 'bigint' ? String(value) : value;
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => canonicalize(item, depth + 1));

  return Object.keys(value).sort().reduce((acc, key) => {
    if (BLOCKED_KEYS.has(key)) return acc;
    acc[key] = canonicalize(value[key], depth + 1);
    return acc;
  }, {});
}

function sha256(value) {
  const source = Buffer.isBuffer(value)
    ? value
    : typeof value === 'string'
      ? value
      : JSON.stringify(canonicalize(value));

  return crypto.createHash('sha256').update(source).digest('hex');
}

function normalizePayload(payload) {
  if (payload === undefined || payload === null) return {};
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return {};
    try {
      return JSON.parse(trimmed);
    } catch {
      return { value: trimmed };
    }
  }
  return payload;
}

function getValue(source, paths = []) {
  for (const path of paths) {
    let current = source;
    for (const segment of path.split('.')) {
      if (!isObject(current) && !Array.isArray(current)) {
        current = undefined;
        break;
      }
      current = current?.[segment];
    }
    if (current !== undefined && current !== null && current !== '') return current;
  }
  return null;
}

function extractOperation(payload, context = {}) {
  return normalizeUpper(
    getValue(payload, [
      'operation',
      'transactionType',
      'transaction.type',
      'type',
      'eventType',
      'event.type',
      'paymentType',
    ]) || context.operation,
  );
}

function extractCallbackId(payload, context = {}) {
  return normalizeString(
    getValue(payload, [
      'callbackId',
      'notificationId',
      'eventId',
      'id',
      'event.id',
      'transaction.notificationId',
    ]) || context.callbackId,
    256,
  );
}

function extractTransactionId(payload, context = {}) {
  return normalizeString(
    getValue(payload, [
      'transactionId',
      'transaction.id',
      'event.transactionId',
      'transaction.reference',
    ]) || context.transactionId,
    256,
  );
}

function extractProviderReference(payload, context = {}) {
  return normalizeString(
    getValue(payload, [
      'providerReference',
      'providerTransactionId',
      'providerTransactionReference',
      'airtelTransactionId',
      'airtelMoneyId',
    ]) || context.providerReference,
    256,
  );
}

function extractReference(payload, context = {}) {
  return normalizeString(
    getValue(payload, [
      'externalReference',
      'clientReference',
      'paymentReference',
      'transactionReference',
      'reference',
    ]) || context.reference,
    256,
  );
}

function extractProviderOutcome(payload) {
  const explicit = normalizeUpper(
    getValue(payload, [
      'providerOutcome',
      'outcome',
    ]),
  );

  if (explicit) return explicit;

  const status = normalizeUpper(
    getValue(payload, [
      'status',
      'transactionStatus',
      'resultCode',
      'event.status',
    ]),
  );

  if (payload?.success === true) return 'SUCCESS';
  if (payload?.success === false) return 'FAILURE';
  if (['SUCCESS', 'SUCCEEDED', 'COMPLETED', 'SETTLED', 'CONFIRMED', '0'].includes(status)) return 'SUCCESS';
  if (['PENDING', 'PROCESSING', 'QUEUED', 'ACCEPTED', 'IN_PROGRESS'].includes(status)) return 'PENDING';
  if (['FAILED', 'FAILURE', 'REJECTED', 'DECLINED', 'ERROR', 'CANCELLED'].includes(status)) return 'FAILURE';
  return 'UNKNOWN';
}

function outcomeFromResult(result) {
  const status = normalizeUpper(result?.status || result?.outcome || result?.state);
  if (['DUPLICATE', 'ALREADY_PROCESSED'].includes(status)) return DISPATCH_STATUS.DUPLICATE;
  if (['PENDING', 'QUEUED', 'ACCEPTED', 'PROCESSING'].includes(status)) return DISPATCH_STATUS.PENDING;
  if (['REVIEW', 'MANUAL_REVIEW', 'RECONCILIATION_REQUIRED', 'AMBIGUOUS'].includes(status)) return DISPATCH_STATUS.REVIEW;
  if (['UNKNOWN', 'NOT_FOUND'].includes(status)) return DISPATCH_STATUS.UNKNOWN;
  if (['REJECTED', 'UNAUTHORIZED', 'INVALID'].includes(status)) return DISPATCH_STATUS.REJECTED;
  if (['FAILED', 'ERROR'].includes(status)) return DISPATCH_STATUS.FAILED;
  if (result?.success === false) return DISPATCH_STATUS.FAILED;
  if (['COMPLETED', 'PROCESSED', 'SUCCESS', 'CONFIRMED', 'SETTLED'].includes(status) || result?.success === true) return DISPATCH_STATUS.PROCESSED;
  return DISPATCH_STATUS.ACCEPTED;
}

function createError(code, message, options = {}) {
  const error = new Error(message);
  error.name = 'AirtelCallbackDispatcherError';
  error.code = code;
  error.statusCode = Number(options.statusCode || 500);
  error.retryable = Boolean(options.retryable);
  error.uncertain = Boolean(options.uncertain);
  Object.assign(error, options);
  return error;
}

function firstFunction(target, names) {
  return names.find((name) => isFunction(target?.[name])) || null;
}

function isRetryableError(error) {
  if (!error) return false;
  if (error.retryable === true) return true;
  if (error.statusCode === 408 || error.statusCode === 429 || error.statusCode >= 500) return true;
  return ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH'].includes(String(error.code || '').toUpperCase());
}

function sanitizeError(error) {
  if (!error) return null;
  return {
    name: normalizeString(error.name, 128),
    code: normalizeString(error.code, 256),
    message: normalizeString(error.message, 2000),
    statusCode: Number(error.statusCode || 500),
    retryable: Boolean(error.retryable),
    uncertain: Boolean(error.uncertain),
  };
}

export class AirtelCallbackDispatcher {
  constructor({
    callbackProcessor = null,
    collectionProcessor = null,
    disbursementProcessor = null,
    defaultProcessor = null,
    registry = null,
    callbackRepository = null,
    idempotencyManager = null,
    deadLetterQueue = null,
    recoveryService = null,
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
    this.callbackProcessor = callbackProcessor;
    this.collectionProcessor = collectionProcessor;
    this.disbursementProcessor = disbursementProcessor;
    this.defaultProcessor = defaultProcessor;
    this.registry = registry;
    this.callbackRepository = callbackRepository;
    this.idempotencyManager = idempotencyManager;
    this.deadLetterQueue = deadLetterQueue;
    this.recoveryService = recoveryService;
    this.auditService = auditService;
    this.eventBus = eventBus;
    this.outboxService = outboxService;
    this.metrics = metrics;
    this.tracer = tracer;
    this.logger = logger || console;
    this.tenantResolver = tenantResolver;
    this.clock = clock || Date;

    this.options = {
      ...DEFAULTS,
      ...(configuration || {}),
      acceptedMethods: Array.isArray(configuration?.acceptedMethods)
        ? [...configuration.acceptedMethods]
        : [...DEFAULTS.acceptedMethods],
      operationAliases: {
        ...DEFAULTS.operationAliases,
        ...(configuration?.operationAliases || {}),
      },
    };

    this.runtime = {
      initialized: false,
      stopping: false,
      startedAt: now(this.clock),
      activeDispatches: new Map(),
      activeFingerprints: new Map(),
      lastDispatch: null,
      lastFailure: null,
    };

    this.statistics = {
      received: 0,
      accepted: 0,
      processed: 0,
      pending: 0,
      reviewed: 0,
      unknown: 0,
      rejected: 0,
      duplicates: 0,
      failed: 0,
      deadLettered: 0,
      handlerInvocations: 0,
      handlerRetries: 0,
      handlerTimeouts: 0,
      handlerErrors: 0,
      repositoryChecks: 0,
      repositoryFailures: 0,
      idempotencyChecks: 0,
      idempotencyConflicts: 0,
      localDuplicateLocks: 0,
      tenantFailures: 0,
      dlqFailures: 0,
      auditFailures: 0,
      eventFailures: 0,
    };

    this.initializationPromise = null;
  }

  async initialize() {
    if (this.runtime.initialized && !this.runtime.stopping) return this;
    if (this.initializationPromise) return this.initializationPromise;

    this.initializationPromise = (async () => {
      this.runtime.stopping = false;
      this.runtime.initialized = true;
      return this;
    })().finally(() => {
      this.initializationPromise = null;
    });

    return this.initializationPromise;
  }

  async shutdown() {
    this.runtime.stopping = true;
    this.runtime.activeDispatches.clear();
    this.runtime.activeFingerprints.clear();
    this.runtime.initialized = false;
  }

  async dispatch({
    provider = PROVIDER,
    payload,
    callback = null,
    context = {},
    tenantId = null,
    headers = {},
    rawBody = undefined,
    signatureVerified = false,
    verified = false,
    authenticated = false,
    correlationId = null,
    operationId = null,
    requestId = null,
    callbackId = null,
    operation = null,
    retry = true,
    session = null,
  } = {}) {
    const effectivePayload = callback ?? payload;
    const normalizedProvider = normalizeUpper(provider) || PROVIDER;

    if (normalizedProvider !== PROVIDER) {
      throw createError(
        'AIRTEL_CALLBACK_PROVIDER_MISMATCH',
        `Dispatcher only accepts ${PROVIDER} callbacks`,
        { statusCode: 400 },
      );
    }

    await this.assertReady();

    const trustedContext = await this.buildTrustedContext({
      tenantId,
      context,
      correlationId,
      operationId,
      requestId,
      callbackId,
      operation,
      payload: effectivePayload,
    });

    if (this.options.requireSecurityVerification) {
      const securityVerified = Boolean(
        signatureVerified ||
        verified ||
        context?.signatureVerified === true ||
        context?.securityVerified === true ||
        context?.trustedCallback === true,
      );

      if (!securityVerified) {
        this.statistics.rejected += 1;
        throw createError(
          'AIRTEL_CALLBACK_DISPATCH_SECURITY_VERIFICATION_REQUIRED',
          'Airtel callback must be authenticated and security-verified before dispatch',
          {
            statusCode: 401,
            retryable: false,
          },
        );
      }
    }

    const safePayload = this.preparePayload(
      effectivePayload,
    );

    const fingerprint = this.buildCallbackFingerprint({
      payload: safePayload,
      callbackId: trustedContext.callbackId,
      operation: trustedContext.operation,
      providerReference: extractProviderReference(safePayload, trustedContext),
      transactionId: extractTransactionId(safePayload, trustedContext),
      reference: extractReference(safePayload, trustedContext),
    });

    trustedContext.callbackFingerprint = fingerprint;
    trustedContext.provider = PROVIDER;

    const dispatchKey = `${trustedContext.tenantId}:${fingerprint}`;

    this.acquireLocalLocks({
      fingerprintKey: dispatchKey,
      correlationId: trustedContext.correlationId,
    });

    this.statistics.received += 1;

    const span = this.startSpan(
      'airtel.callback.dispatch',
      trustedContext,
    );

    const startedAt = Date.now();

    try {
      const duplicate = await this.checkDuplicate({
        tenantId: trustedContext.tenantId,
        callbackFingerprint: fingerprint,
        callbackId: trustedContext.callbackId,
        context: trustedContext,
        session,
      });

      if (duplicate.found) {
        this.statistics.duplicates += 1;
        this.statistics.accepted += 1;

        const duplicateResult = this.buildResult({
          status: DISPATCH_STATUS.DUPLICATE,
          route: duplicate.route || ROUTES.DEFAULT,
          context: trustedContext,
          callback: safePayload,
          fingerprint,
          duplicate: true,
          result: duplicate.record,
          durationMs: Date.now() - startedAt,
        });

        await this.safeAudit(
          'AIRTEL_CALLBACK_DISPATCH_DUPLICATE',
          trustedContext,
          duplicateResult,
        );

        return duplicateResult;
      }

      const route = this.resolveRoute({
        operation: trustedContext.operation,
        payload: safePayload,
        context: trustedContext,
      });

      const handler = this.resolveHandler({
        route,
        operation: trustedContext.operation,
        payload: safePayload,
        context: trustedContext,
      });

      if (!handler) {
        this.statistics.unknown += 1;

        const result = this.buildResult({
          status: DISPATCH_STATUS.UNKNOWN,
          route: ROUTES.UNKNOWN,
          context: trustedContext,
          callback: safePayload,
          fingerprint,
          durationMs: Date.now() - startedAt,
          reason: 'NO_CALLBACK_HANDLER',
        });

        await this.safeAudit(
          'AIRTEL_CALLBACK_DISPATCH_HANDLER_NOT_FOUND',
          trustedContext,
          result,
        );

        if (this.options.failClosedOnMissingHandler) {
          throw createError(
            'AIRTEL_CALLBACK_HANDLER_UNAVAILABLE',
            'No Airtel callback handler is configured for the requested operation',
            {
              statusCode: 503,
              retryable: true,
              uncertain: false,
            },
          );
        }

        return result;
      }

      const handlerResult = await this.executeHandler({
        handler,
        payload: safePayload,
        callback: safePayload,
        context: trustedContext,
        headers,
        rawBody,
        route,
        retry,
        session,
      });

      const normalized = this.normalizeHandlerResult({
        result: handlerResult,
        route,
        context: trustedContext,
        callback: safePayload,
        fingerprint,
        durationMs: Date.now() - startedAt,
      });

      this.recordOutcome(normalized);

      await this.persistDispatchOutcome({
        context: trustedContext,
        fingerprint,
        result: normalized,
        session,
      });

      await this.safeAudit(
        'AIRTEL_CALLBACK_DISPATCH_COMPLETED',
        trustedContext,
        normalized,
      );

      await this.publishEvent(
        'AIRTEL_CALLBACK_DISPATCHED',
        trustedContext,
        normalized,
      );

      return normalized;
    } catch (error) {
      this.statistics.failed += 1;
      this.statistics.handlerErrors += Number(error?.handlerError ? 1 : 0);

      this.runtime.lastFailure = {
        at: now(this.clock).toISOString(),
        tenantId: trustedContext.tenantId,
        correlationId: trustedContext.correlationId,
        code: error?.code || 'AIRTEL_CALLBACK_DISPATCH_FAILED',
      };

      const normalizedError = this.normalizeDispatchError(
        error,
        trustedContext,
      );

      const dlqResult = await this.safeDeadLetter({
        tenantId: trustedContext.tenantId,
        payload: safePayload,
        headers,
        error: normalizedError,
        callbackFingerprint: fingerprint,
        callbackId: trustedContext.callbackId,
        transactionId: extractTransactionId(safePayload, trustedContext),
        providerReference: extractProviderReference(safePayload, trustedContext),
        operationId: trustedContext.operationId,
        correlationId: trustedContext.correlationId,
        authenticated: Boolean(
          authenticated ||
          context?.authenticated === true ||
          context?.trustedCallback === true,
        ),
        signatureVerified: Boolean(
          signatureVerified ||
          verified ||
          context?.signatureVerified === true,
        ),
      });

      if (dlqResult) {
        this.statistics.deadLettered += 1;
      }

      await this.safeAudit(
        'AIRTEL_CALLBACK_DISPATCH_FAILED',
        trustedContext,
        {
          error: normalizedError,
          deadLettered: Boolean(dlqResult),
        },
      );

      throw normalizedError;
    } finally {
      this.releaseLocalLocks({
        fingerprintKey: dispatchKey,
      });

      this.runtime.lastDispatch = {
        at: now(this.clock).toISOString(),
        tenantId: trustedContext.tenantId,
        correlationId: trustedContext.correlationId,
        fingerprint,
      };

      this.incrementMetric(
        'airtel_callback_dispatch_duration_ms',
        Date.now() - startedAt,
      );

      span?.end?.();
    }
  }

  async dispatchCallback(args = {}) {
    return this.dispatch(args);
  }

  async handle(args = {}) {
    return this.dispatch(args);
  }

  async process(args = {}) {
    return this.dispatch(args);
  }

  async route(args = {}) {
    const {
      provider = PROVIDER,
      payload,
      context = {},
      operation = null,
      tenantId = null,
    } = args;

    if (normalizeUpper(provider) !== PROVIDER) {
      throw createError(
        'AIRTEL_CALLBACK_PROVIDER_MISMATCH',
        'Unsupported callback provider',
        { statusCode: 400 },
      );
    }

    const trustedContext = await this.buildTrustedContext({
      tenantId,
      context,
      operation,
      correlationId: context?.correlationId,
      operationId: context?.operationId,
      requestId: context?.requestId,
      callbackId: context?.callbackId,
    });

    return {
      route: this.resolveRoute({
        operation: trustedContext.operation,
        payload: normalizePayload(payload),
        context: trustedContext,
      }),
      handler: Boolean(
        this.resolveHandler({
          route: this.resolveRoute({
            operation: trustedContext.operation,
            payload: normalizePayload(payload),
            context: trustedContext,
          }),
          operation: trustedContext.operation,
          payload: normalizePayload(payload),
          context: trustedContext,
        }),
      ),
      tenantId: trustedContext.tenantId,
      correlationId: trustedContext.correlationId,
    };
  }

  // ---------------------------------------------------------------------------
  // Readiness
  // ---------------------------------------------------------------------------

  async assertReady() {
    if (!this.runtime.initialized) await this.initialize();

    if (this.runtime.stopping) {
      throw createError(
        'AIRTEL_CALLBACK_DISPATCHER_STOPPING',
        'Airtel callback dispatcher is stopping',
        {
          statusCode: 503,
          retryable: true,
        },
      );
    }

    if (
      this.options.failClosedOnIdempotencyUnavailable &&
      !this.callbackRepository &&
      !this.idempotencyManager
    ) {
      throw createError(
        'AIRTEL_CALLBACK_DISPATCH_IDEMPOTENCY_UNAVAILABLE',
        'An authoritative callback/idempotency read boundary is required',
        {
          statusCode: 503,
          retryable: true,
        },
      );
    }

    if (
      this.options.failClosedOnMissingHandler &&
      !this.hasAnyHandler()
    ) {
      throw createError(
        'AIRTEL_CALLBACK_DISPATCH_HANDLER_UNAVAILABLE',
        'No Airtel callback processor is configured',
        {
          statusCode: 503,
          retryable: true,
        },
      );
    }
  }

  hasAnyHandler() {
    return Boolean(
      this.callbackProcessor ||
      this.collectionProcessor ||
      this.disbursementProcessor ||
      this.defaultProcessor ||
      this.registry,
    );
  }

  // ---------------------------------------------------------------------------
  // Context/security
  // ---------------------------------------------------------------------------

  async buildTrustedContext({
    tenantId,
    context = {},
    correlationId,
    operationId,
    requestId,
    callbackId,
    operation,
    payload = undefined,
  } = {}) {
    let resolvedTenantId = normalizeString(
      tenantId ||
        context?.tenantId ||
        context?.trustedTenantId ||
        context?.tenant?.id,
      256,
    );

    if (!resolvedTenantId && this.tenantResolver) {
      const method = firstFunction(
        this.tenantResolver,
        ['resolveTrustedTenant', 'resolveTenant', 'resolve'],
      );

      if (method) {
        try {
          const result = await this.tenantResolver[method]({
            ...context,
            provider: PROVIDER,
            operation: operation || context?.operation || OPERATION,
            correlationId,
            operationId,
            requestId,
          });
          resolvedTenantId = normalizeString(
            result?.id || result?.tenantId || result,
            256,
          );
        } catch (error) {
          this.statistics.tenantFailures += 1;
          throw createError(
            'AIRTEL_CALLBACK_DISPATCH_TENANT_RESOLUTION_FAILED',
            'Trusted tenant resolution failed',
            {
              statusCode: 403,
              retryable: false,
              cause: error,
            },
          );
        }
      }
    }

    if (!resolvedTenantId && this.options.requireTenantId) {
      this.statistics.tenantFailures += 1;
      throw createError(
        'AIRTEL_CALLBACK_DISPATCH_TENANT_REQUIRED',
        'Trusted tenant context is required for Airtel callback dispatch',
        {
          statusCode: 403,
          retryable: false,
        },
      );
    }

    const effectiveCorrelationId = normalizeString(
      correlationId || context?.correlationId,
      256,
    ) || randomId();

    const effectiveOperationId = normalizeString(
      operationId || context?.operationId,
      256,
    ) || randomId();

    const effectiveOperation = extractOperation(
      payload || context?.normalizedCallback || context?.callback || {},
      {
        operation: operation || context?.operation,
      },
    );

    return {
      provider: PROVIDER,
      operation: effectiveOperation || normalizeUpper(operation) || OPERATION,
      tenantId: resolvedTenantId,
      correlationId: effectiveCorrelationId,
      operationId: effectiveOperationId,
      requestId: normalizeString(
        requestId || context?.requestId,
        256,
      ),
      callbackId: normalizeString(
        callbackId || context?.callbackId,
        256,
      ),
      actorId: normalizeString(
        context?.actorId || context?.actor?.id || context?.actor?.actorId,
        256,
      ) || 'SYSTEM:AIRTEL_CALLBACK',
      actorType: normalizeUpper(
        context?.actorType || context?.actor?.actorType,
      ) || 'SYSTEM',
      signatureVerified: Boolean(
        context?.signatureVerified === true ||
        context?.securityVerified === true,
      ),
      trustedCallback: Boolean(
        context?.trustedCallback === true,
      ),
    };
  }

  // ---------------------------------------------------------------------------
  // Routing
  // ---------------------------------------------------------------------------

  resolveRoute({
    operation,
    payload,
    context,
  } = {}) {
    const normalized = normalizeUpper(
      operation ||
      extractOperation(payload, context),
    );

    const route =
      this.options.operationAliases?.[normalized] ||
      normalized;

    if (Object.values(ROUTES).includes(route)) {
      return route;
    }

    if (
      normalized?.includes('COLLECT') ||
      normalized?.includes('RECEIVE') ||
      normalized?.includes('PAYMENT')
    ) {
      return ROUTES.COLLECTION;
    }

    if (
      normalized?.includes('DISBURSE') ||
      normalized?.includes('PAYOUT')
    ) {
      return ROUTES.DISBURSEMENT;
    }

    return ROUTES.DEFAULT;
  }

  resolveHandler({
    route,
    operation,
    payload,
    context,
  } = {}) {
    const direct = this.resolveFromRegistry({
      route,
      operation,
      payload,
      context,
    });

    if (direct) return direct;

    switch (route) {
      case ROUTES.COLLECTION:
        return this.collectionProcessor || this.callbackProcessor || this.defaultProcessor;
      case ROUTES.DISBURSEMENT:
        return this.disbursementProcessor || this.callbackProcessor || this.defaultProcessor;
      case ROUTES.GENERIC:
      case ROUTES.DEFAULT:
      default:
        return this.callbackProcessor || this.defaultProcessor;
    }
  }

  resolveFromRegistry({
    route,
    operation,
    payload,
    context,
  }) {
    if (!this.registry) return null;

    const candidates = [
      route,
      normalizeUpper(operation),
      'AIRTEL',
      PROVIDER,
      'CALLBACK',
      'DEFAULT',
    ].filter(Boolean);

    for (const key of candidates) {
      try {
        if (isFunction(this.registry.resolve)) {
          const result = this.registry.resolve(
            key,
            {
              provider: PROVIDER,
              route,
              operation,
              payload: safeClone(payload),
              context: safeClone(context),
            },
          );
          if (result) return result;
        }
      } catch (error) {
        this.log('warn', 'Airtel callback registry resolution failed', {
          key,
          error: sanitizeError(error),
        });
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Idempotency / duplicate protection
  // ---------------------------------------------------------------------------

  async checkDuplicate({
    tenantId,
    callbackFingerprint,
    callbackId,
    context,
    session,
  } = {}) {
    if (this.callbackRepository) {
      const methods = [
        'findByFingerprint',
        'findByCallbackFingerprint',
        'findByCallbackId',
        'findProcessed',
        'existsByFingerprint',
      ];

      for (const method of methods) {
        if (!isFunction(this.callbackRepository[method])) continue;

        try {
          this.statistics.repositoryChecks += 1;
          const query = {
            tenantId,
            provider: PROVIDER,
            operation: OPERATION,
            callbackFingerprint,
            fingerprint: callbackFingerprint,
            callbackId,
            session,
          };

          const record = await this.callbackRepository[method](query);

          if (
            method.startsWith('exists') &&
            record === true
          ) {
            return {
              found: true,
              record: null,
            };
          }

          if (record) {
            return {
              found: true,
              record,
            };
          }
        } catch (error) {
          this.statistics.repositoryFailures += 1;
          this.log('warn', 'Airtel callback duplicate check failed', {
            method,
            tenantId,
            correlationId: context?.correlationId,
            error: sanitizeError(error),
          });

          if (this.options.failClosedOnIdempotencyUnavailable) {
            throw createError(
              'AIRTEL_CALLBACK_DISPATCH_IDEMPOTENCY_CHECK_FAILED',
              'Authoritative callback duplicate check failed',
              {
                statusCode: 503,
                retryable: true,
                cause: error,
              },
            );
          }
        }

        break;
      }
    }

    if (this.idempotencyManager) {
      const methods = [
        'find',
        'get',
        'lookup',
        'check',
        'exists',
      ];

      for (const method of methods) {
        if (!isFunction(this.idempotencyManager[method])) continue;

        try {
          this.statistics.idempotencyChecks += 1;
          const result = await this.idempotencyManager[method]({
            tenantId,
            provider: PROVIDER,
            operation: OPERATION,
            idempotencyKey: `AIRTEL_CALLBACK:${callbackFingerprint}`,
            fingerprint: callbackFingerprint,
            callbackId,
            session,
          });

          if (method === 'exists') {
            if (result === true) {
              return {
                found: true,
                record: null,
              };
            }
          } else if (result) {
            return {
              found: true,
              record: result,
            };
          }
        } catch (error) {
          this.statistics.repositoryFailures += 1;
          this.log('warn', 'Airtel callback idempotency check failed', {
            method,
            tenantId,
            correlationId: context?.correlationId,
            error: sanitizeError(error),
          });

          if (this.options.failClosedOnIdempotencyUnavailable) {
            throw createError(
              'AIRTEL_CALLBACK_DISPATCH_IDEMPOTENCY_CHECK_FAILED',
              'Authoritative idempotency check failed',
              {
                statusCode: 503,
                retryable: true,
                cause: error,
              },
            );
          }
        }

        break;
      }
    }

    if (
      this.options.failClosedOnIdempotencyUnavailable &&
      !this.callbackRepository &&
      !this.idempotencyManager
    ) {
      throw createError(
        'AIRTEL_CALLBACK_DISPATCH_IDEMPOTENCY_UNAVAILABLE',
        'No authoritative callback idempotency reader is configured',
        {
          statusCode: 503,
          retryable: true,
        },
      );
    }

    return {
      found: false,
      record: null,
    };
  }

  buildCallbackFingerprint({
    payload,
    callbackId,
    operation,
    providerReference,
    transactionId,
    reference,
  } = {}) {
    return sha256({
      provider: PROVIDER,
      operation: normalizeUpper(operation) || OPERATION,
      callbackId: normalizeString(callbackId, 256),
      providerReference: normalizeString(providerReference, 256),
      transactionId: normalizeString(transactionId, 256),
      reference: normalizeString(reference, 256),
      payload: safeClone(payload),
    });
  }

  generateCallbackFingerprint(input = {}) {
    return this.buildCallbackFingerprint(input);
  }

  async reserveIdempotency({
    tenantId,
    callbackFingerprint,
    correlationId,
    operationId,
    session,
  } = {}) {
    if (!this.idempotencyManager) {
      return {
        reserved: true,
        managed: false,
      };
    }

    const method = firstFunction(
      this.idempotencyManager,
      ['reserve', 'acquire', 'claim'],
    );

    if (!method) {
      return {
        reserved: true,
        managed: false,
      };
    }

    this.statistics.idempotencyChecks += 1;

    try {
      const result = await this.idempotencyManager[method]({
        tenantId,
        provider: PROVIDER,
        operation: OPERATION,
        idempotencyKey: `AIRTEL_CALLBACK:${callbackFingerprint}`,
        fingerprint: callbackFingerprint,
        correlationId,
        operationId,
        session,
      });

      if (result?.conflict || result?.status === 'CONFLICT') {
        this.statistics.idempotencyConflicts += 1;
        return {
          reserved: false,
          conflict: true,
          result,
        };
      }

      return {
        reserved: result?.reserved !== false,
        managed: true,
        result,
      };
    } catch (error) {
      if (isDuplicateLikeError(error)) {
        this.statistics.idempotencyConflicts += 1;
        return {
          reserved: false,
          conflict: true,
          error,
        };
      }

      throw createError(
        'AIRTEL_CALLBACK_DISPATCH_IDEMPOTENCY_RESERVATION_FAILED',
        'Callback idempotency reservation failed',
        {
          statusCode: 503,
          retryable: true,
          cause: error,
        },
      );
    }
  }

  async commitIdempotency({
    tenantId,
    callbackFingerprint,
    result,
    correlationId,
    operationId,
    session,
  } = {}) {
    if (!this.idempotencyManager) return;

    const method = firstFunction(
      this.idempotencyManager,
      ['commit', 'complete', 'markCommitted'],
    );

    if (!method) return;

    await this.idempotencyManager[method]({
      tenantId,
      provider: PROVIDER,
      operation: OPERATION,
      idempotencyKey: `AIRTEL_CALLBACK:${callbackFingerprint}`,
      fingerprint: callbackFingerprint,
      result: safeClone(result),
      correlationId,
      operationId,
      session,
    });
  }

  async releaseIdempotency({
    tenantId,
    callbackFingerprint,
    correlationId,
    operationId,
    session,
  } = {}) {
    if (!this.idempotencyManager) return;

    const method = firstFunction(
      this.idempotencyManager,
      ['release', 'rollback', 'fail'],
    );

    if (!method) return;

    try {
      await this.idempotencyManager[method]({
        tenantId,
        provider: PROVIDER,
        operation: OPERATION,
        idempotencyKey: `AIRTEL_CALLBACK:${callbackFingerprint}`,
        fingerprint: callbackFingerprint,
        correlationId,
        operationId,
        session,
      });
    } catch (error) {
      this.log('warn', 'Airtel callback idempotency release failed', {
        tenantId,
        correlationId,
        error: sanitizeError(error),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Handler execution
  // ---------------------------------------------------------------------------

  async executeHandler({
    handler,
    payload,
    callback,
    context,
    headers,
    rawBody,
    route,
    retry = true,
    session,
  }) {
    const method = firstFunction(
      handler,
      HANDLER_METHODS,
    );

    if (!method) {
      throw createError(
        'AIRTEL_CALLBACK_DISPATCH_HANDLER_CONTRACT_INVALID',
        'Resolved Airtel callback handler exposes no supported dispatch method',
        {
          statusCode: 503,
          retryable: true,
        },
      );
    }

    const reservation = await this.reserveIdempotency({
      tenantId: context.tenantId,
      callbackFingerprint: context.callbackFingerprint,
      correlationId: context.correlationId,
      operationId: context.operationId,
      session,
    });

    if (reservation.conflict) {
      return {
        status: DISPATCH_STATUS.DUPLICATE,
        duplicate: true,
        idempotency: reservation.result,
      };
    }

    const argumentsObject = {
      provider: PROVIDER,
      operation: OPERATION,
      route,
      tenantId: context.tenantId,
      callback,
      payload,
      headers: safeClone(headers),
      rawBody: undefined,
      context,
      correlationId: context.correlationId,
      operationId: context.operationId,
      requestId: context.requestId,
      callbackId: context.callbackId,
      callbackFingerprint: context.callbackFingerprint,
      session,
    };

    let lastError;
    const maxRetries = retry ? Number(this.options.maxRetries) : 0;

    try {
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
          this.statistics.handlerInvocations += 1;

          const result = await this.executeWithTimeout(
            () => handler[method](argumentsObject),
            {
              timeoutMs: this.options.handlerTimeoutMs,
              context,
            },
          );

          await this.commitIdempotency({
            tenantId: context.tenantId,
            callbackFingerprint: context.callbackFingerprint,
            result,
            correlationId: context.correlationId,
            operationId: context.operationId,
            session,
          });

          return result;
        } catch (error) {
          lastError = error;

          if (
            error?.code === 'AIRTEL_CALLBACK_DISPATCH_HANDLER_TIMEOUT'
          ) {
            this.statistics.handlerTimeouts += 1;
          }

          if (
            attempt >= maxRetries ||
            !isRetryableError(error)
          ) {
            throw error;
          }

          this.statistics.handlerRetries += 1;
          await this.sleep(
            Number(this.options.retryBackoffMs) * (attempt + 1),
          );
        }
      }

      throw lastError;
    } catch (error) {
      error.handlerError = true;
      await this.releaseIdempotency({
        tenantId: context.tenantId,
        callbackFingerprint: context.callbackFingerprint,
        correlationId: context.correlationId,
        operationId: context.operationId,
        session,
      });
      throw error;
    }
  }

  async executeWithTimeout(
    operation,
    {
      timeoutMs,
      context,
    } = {},
  ) {
    const timeout = Math.max(
      1,
      Number(timeoutMs) || DEFAULTS.handlerTimeoutMs,
    );

    let timer;

    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(
              createError(
                'AIRTEL_CALLBACK_DISPATCH_HANDLER_TIMEOUT',
                'Airtel callback handler execution timed out',
                {
                  statusCode: 504,
                  retryable: true,
                  uncertain: true,
                  correlationId: context?.correlationId,
                  tenantId: context?.tenantId,
                },
              ),
            );
          }, timeout);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async sleep(milliseconds) {
    const ms = Math.max(
      0,
      Number(milliseconds) || 0,
    );

    if (!ms) return;

    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  // ---------------------------------------------------------------------------
  // Result/error shaping
  // ---------------------------------------------------------------------------

  preparePayload(payload) {
    const normalized = normalizePayload(payload);
    const bytes = byteLength(normalized);

    if (bytes > Number(this.options.maxPayloadBytes)) {
      throw createError(
        'AIRTEL_CALLBACK_DISPATCH_PAYLOAD_TOO_LARGE',
        'Airtel callback payload exceeds configured dispatcher limit',
        {
          statusCode: 413,
          retryable: false,
          details: {
            bytes,
            maxPayloadBytes: this.options.maxPayloadBytes,
          },
        },
      );
    }

    return normalized;
  }

  normalizeHandlerResult({
    result,
    route,
    context,
    callback,
    fingerprint,
    durationMs,
  }) {
    const status = outcomeFromResult(result);
    const providerOutcome = extractProviderOutcome(
      callback,
    );

    return {
      provider: PROVIDER,
      operation: OPERATION,
      route,
      dispatchStatus: status,
      status: normalizeUpper(result?.status || status) || status,
      providerOutcome,
      success: [
        DISPATCH_STATUS.ACCEPTED,
        DISPATCH_STATUS.PROCESSED,
        DISPATCH_STATUS.DUPLICATE,
        DISPATCH_STATUS.PENDING,
      ].includes(status),
      duplicate: Boolean(
        result?.duplicate ||
        status === DISPATCH_STATUS.DUPLICATE,
      ),
      reviewRequired: Boolean(
        result?.reviewRequired ||
        status === DISPATCH_STATUS.REVIEW,
      ),
      retryable: Boolean(result?.retryable),
      uncertain: Boolean(result?.uncertain),
      tenantId: context.tenantId,
      correlationId: context.correlationId,
      operationId: context.operationId,
      requestId: context.requestId,
      callbackId: context.callbackId,
      callbackFingerprint: fingerprint,
      transactionId: normalizeString(
        result?.transactionId || extractTransactionId(callback, context),
        256,
      ),
      paymentReference: normalizeString(
        result?.paymentReference,
        256,
      ),
      providerReference: normalizeString(
        result?.providerReference || extractProviderReference(callback, context),
        256,
      ),
      nextAction: normalizeString(
        result?.nextAction || result?.action,
        256,
      ),
      reason: normalizeString(
        result?.reason || result?.message,
        1000,
      ),
      financialSettlement: Boolean(
        result?.financialSettlement?.confirmed === true ||
        result?.settled === true,
      ),
      handlerResult: safeClone(result),
      durationMs,
      timestamp: now(this.clock).toISOString(),
    };
  }

  buildResult({
    status,
    route,
    context,
    callback,
    fingerprint,
    duplicate = false,
    result = null,
    reason = null,
    durationMs = 0,
  }) {
    const providerOutcome = extractProviderOutcome(
      callback,
    );

    return {
      provider: PROVIDER,
      operation: OPERATION,
      route,
      dispatchStatus: status,
      status,
      providerOutcome,
      success: ![
        DISPATCH_STATUS.REJECTED,
        DISPATCH_STATUS.FAILED,
      ].includes(status),
      duplicate: Boolean(duplicate),
      tenantId: context?.tenantId || null,
      correlationId: context?.correlationId || null,
      operationId: context?.operationId || null,
      requestId: context?.requestId || null,
      callbackId: context?.callbackId || null,
      callbackFingerprint: fingerprint || null,
      duplicateRecord: safeClone(result),
      reason,
      durationMs,
      timestamp: now(this.clock).toISOString(),
    };
  }

  normalizeDispatchError(error, context) {
    if (error?.name === 'AirtelCallbackDispatcherError') {
      return error;
    }

    return createError(
      error?.code || 'AIRTEL_CALLBACK_DISPATCH_FAILED',
      error?.message || 'Airtel callback dispatch failed',
      {
        statusCode: Number(error?.statusCode || error?.status) || 500,
        retryable: Boolean(error?.retryable),
        uncertain: Boolean(error?.uncertain),
        tenantId: context?.tenantId,
        correlationId: context?.correlationId,
        operationId: context?.operationId,
        cause: error,
      },
    );
  }

  recordOutcome(result) {
    switch (result.dispatchStatus) {
      case DISPATCH_STATUS.ACCEPTED:
        this.statistics.accepted += 1;
        break;
      case DISPATCH_STATUS.PROCESSED:
        this.statistics.processed += 1;
        break;
      case DISPATCH_STATUS.PENDING:
        this.statistics.pending += 1;
        break;
      case DISPATCH_STATUS.REVIEW:
        this.statistics.reviewed += 1;
        break;
      case DISPATCH_STATUS.UNKNOWN:
        this.statistics.unknown += 1;
        break;
      case DISPATCH_STATUS.DUPLICATE:
        this.statistics.duplicates += 1;
        break;
      case DISPATCH_STATUS.REJECTED:
        this.statistics.rejected += 1;
        break;
      case DISPATCH_STATUS.FAILED:
      default:
        this.statistics.failed += 1;
        break;
    }

    this.incrementMetric(
      'airtel_callback_dispatch_total',
      1,
      { status: result.dispatchStatus },
    );
  }

  // ---------------------------------------------------------------------------
  // Persistence outcome hook
  // ---------------------------------------------------------------------------

  async persistDispatchOutcome({
    context,
    fingerprint,
    result,
    session,
  }) {
    if (!this.callbackRepository) return;

    const method = firstFunction(
      this.callbackRepository,
      ['recordDispatchOutcome', 'recordOutcome', 'markProcessed'],
    );

    if (!method) return;

    try {
      this.statistics.repositoryChecks += 1;

      await this.callbackRepository[method]({
        tenantId: context.tenantId,
        provider: PROVIDER,
        operation: OPERATION,
        callbackFingerprint: fingerprint,
        correlationId: context.correlationId,
        operationId: context.operationId,
        callbackId: context.callbackId,
        status: result.dispatchStatus,
        outcome: safeClone(result),
        session,
      });
    } catch (error) {
      this.statistics.repositoryFailures += 1;

      throw createError(
        'AIRTEL_CALLBACK_DISPATCH_OUTCOME_PERSIST_FAILED',
        'Airtel callback dispatch outcome persistence failed',
        {
          statusCode: 503,
          retryable: true,
          cause: error,
        },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // DLQ / recovery
  // ---------------------------------------------------------------------------

  async safeDeadLetter({
    tenantId,
    payload,
    headers,
    error,
    callbackFingerprint,
    callbackId,
    transactionId,
    providerReference,
    operationId,
    correlationId,
    authenticated,
    signatureVerified,
  }) {
    if (!this.deadLetterQueue) return null;

    const method = firstFunction(
      this.deadLetterQueue,
      ['publish', 'enqueue', 'deadLetter', 'store'],
    );

    if (!method) return null;

    try {
      return await this.deadLetterQueue[method]({
        provider: PROVIDER,
        operation: OPERATION,
        tenantId,
        callbackId,
        transactionId,
        providerReference,
        callbackFingerprint,
        correlationId,
        operationId,
        authenticated: Boolean(authenticated),
        signatureVerified: Boolean(signatureVerified),
        payload: safeClone(payload),
        headers: safeClone(headers),
        error: sanitizeError(error),
        reason: error?.code || 'AIRTEL_CALLBACK_DISPATCH_FAILED',
        failureClass: error?.failureClass,
      });
    } catch (dlqError) {
      this.statistics.dlqFailures += 1;

      this.log(
        'error',
        'Airtel callback DLQ routing failed',
        {
          tenantId,
          correlationId,
          operationId,
          error: sanitizeError(dlqError),
        },
      );

      if (this.options.failClosedOnDlqFailure) {
        throw createError(
          'AIRTEL_CALLBACK_DISPATCH_DLQ_FAILED',
          'Airtel callback dead-letter routing failed',
          {
            statusCode: 503,
            retryable: true,
            cause: dlqError,
          },
        );
      }

      return null;
    }
  }

  async recover({
    deadLetterId,
    tenantId,
    context = {},
    workerId = null,
    dispatch = true,
  } = {}) {
    if (!this.deadLetterQueue) {
      throw createError(
        'AIRTEL_CALLBACK_DISPATCH_DLQ_UNAVAILABLE',
        'Airtel dead-letter queue is not configured',
        { statusCode: 503, retryable: true },
      );
    }

    const resolvedTenantId = await this.requireTenant({
      tenantId,
      context,
    });

    const claim = firstFunction(
      this.deadLetterQueue,
      ['claim'],
    );

    let record;

    if (claim && workerId) {
      record = await this.deadLetterQueue[claim]({
        dlqId: deadLetterId,
        tenantId: resolvedTenantId,
        workerId,
        correlationId: context.correlationId || randomId(),
        operationId: context.operationId || randomId(),
      });
    } else {
      const get = firstFunction(
        this.deadLetterQueue,
        ['getRecord', 'get'],
      );
      if (!get) {
        throw createError(
          'AIRTEL_CALLBACK_DISPATCH_DLQ_LOOKUP_UNAVAILABLE',
          'Dead-letter queue does not support recovery lookup',
          { statusCode: 503, retryable: true },
        );
      }
      record = await this.deadLetterQueue[get]({
        id: deadLetterId,
        dlqId: deadLetterId,
        tenantId: resolvedTenantId,
      });
    }

    if (!record) {
      throw createError(
        'AIRTEL_CALLBACK_DISPATCH_DLQ_RECORD_NOT_FOUND',
        'Airtel callback dead-letter record was not found',
        { statusCode: 404 },
      );
    }

    if (!dispatch) return safeClone(record);

    const payload = record.payload || record.callback || record.data;

    if (payload?.omitted === true) {
      throw createError(
        'AIRTEL_CALLBACK_DISPATCH_REPLAY_PAYLOAD_UNAVAILABLE',
        'Replay payload is unavailable for this dead-letter record',
        { statusCode: 409 },
      );
    }

    return this.dispatch({
      provider: PROVIDER,
      payload,
      tenantId: resolvedTenantId,
      context: {
        ...context,
        tenantId: resolvedTenantId,
        correlationId: context.correlationId || record.correlationId || randomId(),
        operationId: context.operationId || record.operationId || randomId(),
        callbackId: context.callbackId || record.callbackId,
        signatureVerified: record.signatureVerified === true,
        trustedCallback: record.signatureVerified === true,
      },
      callbackId: record.callbackId,
      correlationId: context.correlationId || record.correlationId,
      operationId: context.operationId || record.operationId,
      signatureVerified: record.signatureVerified === true,
      authenticated: record.authenticated === true,
    });
  }

  async replayDeadLetter(args = {}) {
    return this.recover({
      ...args,
      dispatch: true,
    });
  }

  // ---------------------------------------------------------------------------
  // Tenant helper
  // ---------------------------------------------------------------------------

  async requireTenant({
    tenantId,
    context = {},
  } = {}) {
    const trusted = await this.buildTrustedContext({
      tenantId,
      context,
      correlationId: context.correlationId,
      operationId: context.operationId,
      requestId: context.requestId,
    });

    return trusted.tenantId;
  }

  // ---------------------------------------------------------------------------
  // Local concurrency guards
  // ---------------------------------------------------------------------------

  acquireLocalLocks({
    fingerprintKey,
    correlationId,
  }) {
    this.pruneLocalLocks();

    if (
      this.runtime.activeDispatches.size >=
      Number(this.options.maxConcurrentDispatches)
    ) {
      throw createError(
        'AIRTEL_CALLBACK_DISPATCH_CAPACITY_EXCEEDED',
        'Airtel callback dispatcher concurrency capacity is exhausted',
        {
          statusCode: 503,
          retryable: true,
        },
      );
    }

    if (this.runtime.activeFingerprints.has(fingerprintKey)) {
      this.statistics.localDuplicateLocks += 1;
      throw createError(
        'AIRTEL_CALLBACK_DISPATCH_FINGERPRINT_IN_FLIGHT',
        'Equivalent Airtel callback is already being dispatched',
        {
          statusCode: 409,
          retryable: true,
          correlationId,
        },
      );
    }

    const entry = {
      startedAt: Date.now(),
      correlationId,
    };

    this.runtime.activeDispatches.set(
      correlationId,
      entry,
    );

    this.runtime.activeFingerprints.set(
      fingerprintKey,
      entry,
    );
  }

  releaseLocalLocks({
    fingerprintKey,
  }) {
    const entry =
      this.runtime.activeFingerprints.get(
        fingerprintKey,
      );

    if (entry) {
      this.runtime.activeDispatches.delete(
        entry.correlationId,
      );
    }

    this.runtime.activeFingerprints.delete(
      fingerprintKey,
    );
  }

  pruneLocalLocks() {
    const cutoff =
      Date.now() -
      Number(this.options.localLockTtlMs);

    for (const [key, entry] of this.runtime.activeFingerprints.entries()) {
      if (entry.startedAt < cutoff) {
        this.runtime.activeFingerprints.delete(key);
        this.runtime.activeDispatches.delete(entry.correlationId);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Audit / events / metrics / logging
  // ---------------------------------------------------------------------------

  async safeAudit(
    action,
    context,
    metadata = {},
  ) {
    if (!this.options.audit || !this.auditService) return;

    const method = firstFunction(
      this.auditService,
      ['record', 'audit', 'write'],
    );

    if (!method) return;

    try {
      await this.auditService[method]({
        action,
        provider: PROVIDER,
        operation: OPERATION,
        tenantId: context?.tenantId || null,
        correlationId: context?.correlationId || null,
        operationId: context?.operationId || null,
        actorId: context?.actorId || 'SYSTEM:AIRTEL_CALLBACK',
        metadata: safeClone(metadata),
        at: now(this.clock).toISOString(),
      });
    } catch (error) {
      this.statistics.auditFailures += 1;
      this.log('error', 'Airtel callback dispatcher audit failed', {
        action,
        tenantId: context?.tenantId,
        correlationId: context?.correlationId,
        error: sanitizeError(error),
      });

      if (this.options.failClosedOnAuditError) {
        throw error;
      }
    }
  }

  async publishEvent(
    type,
    context,
    payload = {},
  ) {
    if (!this.options.publishEvents) return;

    const event = {
      type,
      provider: PROVIDER,
      operation: OPERATION,
      tenantId: context?.tenantId || null,
      correlationId: context?.correlationId || null,
      operationId: context?.operationId || null,
      payload: safeClone(payload),
      at: now(this.clock).toISOString(),
    };

    try {
      if (this.outboxService) {
        const method = firstFunction(
          this.outboxService,
          ['publish', 'enqueue', 'append'],
        );
        if (method) {
          await this.outboxService[method](event);
          return;
        }
      }

      if (this.eventBus) {
        const method = firstFunction(
          this.eventBus,
          ['publish', 'emit', 'send'],
        );
        if (method) {
          await this.eventBus[method](event);
        }
      }
    } catch (error) {
      this.statistics.eventFailures += 1;
      this.log('error', 'Airtel callback dispatcher event publication failed', {
        type,
        tenantId: context?.tenantId,
        correlationId: context?.correlationId,
        error: sanitizeError(error),
      });

      if (this.options.failClosedOnEventError) {
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
      const method = firstFunction(
        this.metrics,
        ['increment', 'inc', 'counter'],
      );

      if (!method) return;

      if (labels !== undefined) {
        this.metrics[method](name, value, labels);
      } else {
        this.metrics[method](name, value);
      }
    } catch {
      // Metrics are advisory; they never change dispatch correctness.
    }
  }

  startSpan(
    name,
    context,
  ) {
    try {
      if (!isFunction(this.tracer?.startSpan)) {
        return null;
      }

      return this.tracer.startSpan(name, {
        attributes: {
          'titech.provider': PROVIDER,
          'titech.operation': OPERATION,
          'titech.tenant_id': context?.tenantId || 'unknown',
          'titech.correlation_id': context?.correlationId || 'unknown',
          'titech.operation_id': context?.operationId || 'unknown',
        },
      });
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
      const method = isFunction(this.logger?.[level])
        ? level
        : 'info';

      this.logger?.[method]?.({
        message,
        provider: PROVIDER,
        component: COMPONENT,
        ...safeClone(metadata),
      });
    } catch {
      // Logging must never affect callback dispatch.
    }
  }

  // ---------------------------------------------------------------------------
  // Health / diagnostics / lifecycle
  // ---------------------------------------------------------------------------

  async health() {
    const handlerConfigured = this.hasAnyHandler();
    const idempotencyConfigured = Boolean(
      this.callbackRepository ||
      this.idempotencyManager,
    );

    let status = 'UP';
    const degradedReasons = [];

    if (!handlerConfigured) {
      status = 'DOWN';
      degradedReasons.push('handler:UNAVAILABLE');
    }

    if (!idempotencyConfigured) {
      status = 'DOWN';
      degradedReasons.push('idempotency:UNAVAILABLE');
    }

    if (this.runtime.stopping) {
      status = 'STOPPING';
    }

    return {
      provider: PROVIDER,
      component: COMPONENT,
      engine: ENGINE_NAME,
      version: ENGINE_VERSION,
      schemaVersion: SCHEMA_VERSION,
      status,
      initialized: this.runtime.initialized,
      handlerConfigured,
      idempotencyConfigured,
      degradedReasons,
      activeDispatches: this.runtime.activeDispatches.size,
      activeFingerprints: this.runtime.activeFingerprints.size,
      uptimeMs: Date.now() - this.runtime.startedAt.getTime(),
      checkedAt: now(this.clock).toISOString(),
    };
  }

  async readiness() {
    const health = await this.health();
    return {
      ready: health.status === 'UP',
      ...health,
    };
  }

  async liveness() {
    return {
      alive: !this.runtime.stopping,
      provider: PROVIDER,
      component: COMPONENT,
      timestamp: now(this.clock).toISOString(),
    };
  }

  isReady() {
    return (
      this.runtime.initialized &&
      !this.runtime.stopping
    );
  }

  capabilities() {
    return {
      provider: PROVIDER,
      operation: OPERATION,
      engine: ENGINE_NAME,
      version: ENGINE_VERSION,
      tenantIsolation: true,
      securityVerificationGate: Boolean(this.options.requireSecurityVerification),
      localDuplicateProtection: true,
      authoritativeDuplicateLookup: Boolean(this.callbackRepository || this.idempotencyManager),
      idempotencyReservation: Boolean(this.idempotencyManager),
      recovery: Boolean(this.deadLetterQueue),
      routing: true,
      boundedHandlerExecution: true,
      audit: Boolean(this.auditService),
      events: Boolean(this.eventBus || this.outboxService),
      directProviderHttp: false,
      directDatabaseMutation: false,
      directLedgerMutation: false,
      directBalanceMutation: false,
      directWalletMutation: false,
      settlementFinality: false,
      automaticFinancialRetry: false,
      authoritativeFinancialBoundary: FINANCIAL_BOUNDARY,
    };
  }

  statisticsSnapshot() {
    return safeClone(this.statistics);
  }

  diagnostics() {
    return {
      provider: PROVIDER,
      component: COMPONENT,
      engine: ENGINE_NAME,
      version: ENGINE_VERSION,
      schemaVersion: SCHEMA_VERSION,
      queue: {
        maxConcurrentDispatches: this.options.maxConcurrentDispatches,
        localLockTtlMs: this.options.localLockTtlMs,
      },
      policy: {
        requireTenantId: this.options.requireTenantId,
        requireSecurityVerification: this.options.requireSecurityVerification,
        failClosedOnMissingHandler: this.options.failClosedOnMissingHandler,
        failClosedOnIdempotencyUnavailable: this.options.failClosedOnIdempotencyUnavailable,
        maxPayloadBytes: this.options.maxPayloadBytes,
        handlerTimeoutMs: this.options.handlerTimeoutMs,
        maxRetries: this.options.maxRetries,
      },
      dependencies: {
        callbackProcessor: Boolean(this.callbackProcessor),
        collectionProcessor: Boolean(this.collectionProcessor),
        disbursementProcessor: Boolean(this.disbursementProcessor),
        defaultProcessor: Boolean(this.defaultProcessor),
        registry: Boolean(this.registry),
        callbackRepository: Boolean(this.callbackRepository),
        idempotencyManager: Boolean(this.idempotencyManager),
        deadLetterQueue: Boolean(this.deadLetterQueue),
        recoveryService: Boolean(this.recoveryService),
        auditService: Boolean(this.auditService),
        eventBus: Boolean(this.eventBus),
        outboxService: Boolean(this.outboxService),
        tenantResolver: Boolean(this.tenantResolver),
      },
      financialBoundary: {
        directProviderHttp: false,
        directLedgerMutation: false,
        directBalanceMutation: false,
        directWalletMutation: false,
        settlementFinality: false,
        authoritativeBoundary: FINANCIAL_BOUNDARY,
      },
      runtime: {
        initialized: this.runtime.initialized,
        stopping: this.runtime.stopping,
        activeDispatches: this.runtime.activeDispatches.size,
        activeFingerprints: this.runtime.activeFingerprints.size,
        lastDispatch: safeClone(this.runtime.lastDispatch),
        lastFailure: safeClone(this.runtime.lastFailure),
      },
      statistics: this.statisticsSnapshot(),
    };
  }

  snapshot() {
    return this.diagnostics();
  }
}

function isDuplicateLikeError(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return (
    code.includes('duplicate') ||
    code.includes('conflict') ||
    message.includes('duplicate key') ||
    message.includes('already exists')
  );
}

export function createAirtelCallbackDispatcher(options = {}) {
  return new AirtelCallbackDispatcher(options);
}

export function createCallbackDispatcher(options = {}) {
  return new AirtelCallbackDispatcher(options);
}

export const CONSTANTS = Object.freeze({
  PROVIDER,
  OPERATION,
  COMPONENT,
  ENGINE_NAME,
  ENGINE_VERSION,
  SCHEMA_VERSION,
  DISPATCH_STATUS,
  ROUTES,
  HANDLER_METHODS,
  DEFAULTS,
  FINANCIAL_BOUNDARY,
});

export default AirtelCallbackDispatcher;