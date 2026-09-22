/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Callback Dead-Letter Queue
 * =============================================================================
 *
 * File
 * ----
 * backend/modules/payment/airtel/callbacks/callbackDeadLetterQueue.js
 *
 * Architectural role
 * ------------------
 * Canonical callback-specific dead-letter boundary for Airtel callback failures.
 * It records processing failures after transport/security validation has been
 * performed and provides controlled operator/recovery lifecycle operations.
 *
 * Processing boundary
 * -------------------
 * Airtel callback
 *   -> transport/signature/validation
 *   -> callback correlation
 *   -> callback processor
 *   -> this DLQ on safe failure
 *   -> recovery worker / canonical callback processor
 *   -> financial core / reconciliation
 *
 * Responsibilities
 * ----------------
 * - Validate trusted tenant and required DLQ identity.
 * - Classify callback processing failures.
 * - Generate deterministic callback fingerprints/idempotency keys.
 * - Protect against concurrent and durable duplicate DLQ insertion.
 * - Bound and sanitize replayable callback payloads and metadata.
 * - Preserve correlation/provider/payment identifiers without trusting payload
 *   tenant identity.
 * - Persist records using an injected repository or durable queue adapter.
 * - Expose publish()/enqueue()/store() compatibility aliases.
 * - Support operator claim, requeue, resolve, discard and poison workflows.
 * - Enforce optimistic/concurrent status transitions through repository CAS when
 *   available.
 * - Integrate optional recovery dispatcher, audit, outbox/event and metrics.
 * - Provide health, readiness, diagnostics and statistics.
 *
 * Explicitly NOT responsible for
 * -------------------------------
 * - HTTP request handling.
 * - Airtel OAuth or provider API calls.
 * - Callback signature verification.
 * - Callback schema validation.
 * - Correlation decisions.
 * - Fraud/KYC/AML adjudication.
 * - Payment execution.
 * - Ledger posting.
 * - Balance/wallet mutation.
 * - Settlement finality.
 * - Reconciliation truth.
 * - Direct financial retry.
 *
 * Security principles
 * -------------------
 * 1. Tenant context must be trusted by the caller or resolver; tenantId inside
 *    callback payload is never used to establish tenant scope.
 * 2. Every durable lookup and mutation is tenant + provider scoped.
 * 3. Secrets, credentials, authorization material and transport internals are
 *    redacted before persistence, audit, logs and events.
 * 4. Raw transport bodies are not owned by this module as authoritative data.
 * 5. Duplicate insertion must tolerate races; database uniqueness remains the
 *    final authority where supported.
 * 6. Requeue changes DLQ state only; it does not execute a payment.
 * 7. Poison messages terminate automatic retry eligibility and require review.
 * 8. A DLQ record is evidence of processing failure, never proof of settlement.
 * 9. Cache/local locks are optimizations only and are never financial truth.
 *
 * Module format
 * -------------
 * ES module. The backend package is configured with type=module.
 *
 * =============================================================================
 */

import crypto from 'node:crypto';

const PROVIDER = 'AIRTEL';
const OPERATION = 'CALLBACK';
const COMPONENT = 'titech.airtel.callbacks.dead-letter-queue';
const ENGINE_NAME = 'airtel-callback-dead-letter-queue';
const ENGINE_VERSION = '5.0.0';
const SCHEMA_VERSION = 5;
const FINANCIAL_BOUNDARY = 'TITECH_FINANCIAL_CORE';
const QUEUE_NAME = 'airtel-callback-dlq';

const DLQ_STATUS = Object.freeze({
  DEAD_LETTERED: 'DEAD_LETTERED',
  READY_FOR_REVIEW: 'READY_FOR_REVIEW',
  REQUEUE_PENDING: 'REQUEUE_PENDING',
  REQUEUED: 'REQUEUED',
  PROCESSING: 'PROCESSING',
  RESOLVED: 'RESOLVED',
  DISCARDED: 'DISCARDED',
  POISON: 'POISON',
});

const FAILURE_CLASS = Object.freeze({
  VALIDATION: 'VALIDATION',
  SIGNATURE: 'SIGNATURE',
  REPLAY: 'REPLAY',
  DUPLICATE: 'DUPLICATE',
  PROVIDER: 'PROVIDER',
  NETWORK: 'NETWORK',
  TIMEOUT: 'TIMEOUT',
  STATE: 'STATE',
  RECONCILIATION: 'RECONCILIATION',
  FINANCIAL: 'FINANCIAL',
  DEPENDENCY: 'DEPENDENCY',
  INTERNAL: 'INTERNAL',
  UNKNOWN: 'UNKNOWN',
});

const DISPATCH_STATUS = Object.freeze({
  NOT_REQUIRED: 'NOT_REQUIRED',
  PENDING: 'PENDING',
  DISPATCHED: 'DISPATCHED',
  FAILED: 'FAILED',
});

const DEFAULTS = Object.freeze({
  maxPayloadBytes: 512 * 1024,
  maxMetadataBytes: 64 * 1024,
  maxAttempts: 5,
  visibilityTimeoutMs: 60_000,
  retentionDays: 30,
  maxListLimit: 500,
  publishQueueMessages: false,
  queueName: QUEUE_NAME,
  requireTenantId: true,
  requireRepository: true,
  failClosedOnPersistenceError: true,
  failClosedOnAuditError: false,
  failClosedOnEventError: false,
  lockTtlMs: 15_000,
  allowReplayablePayload: true,
});

const TERMINAL_STATUSES = new Set([
  DLQ_STATUS.RESOLVED,
  DLQ_STATUS.DISCARDED,
  DLQ_STATUS.POISON,
]);

const CLAIMABLE_STATUSES = new Set([
  DLQ_STATUS.REQUEUED,
  DLQ_STATUS.DEAD_LETTERED,
  DLQ_STATUS.READY_FOR_REVIEW,
]);

const SENSITIVE_KEY_PATTERN = /authorization|proxy.?authorization|cookie|set-cookie|password|secret|client.?secret|api.?key|token|access.?token|refresh.?token|signature|private.?key|credential|otp|pin|cvv|cvc|pan/i;
const RAW_TRANSPORT_KEY_PATTERN = /^raw|request|response|webhook.?body|request.?body|response.?body/i;
const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function isFunction(value) {
  return typeof value === 'function';
}

function isPlainObject(value) {
  if (!isObject(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function generateId() {
  return crypto.randomUUID();
}

function now(clock) {
  const value = isFunction(clock?.now) ? clock.now() : Date.now();
  return new Date(value);
}

function safeString(value, maxLength = 2048) {
  if (value === null || value === undefined) return undefined;
  return String(value).trim().slice(0, maxLength);
}

function requireString(value, name, maxLength = 256) {
  const normalized = safeString(value, maxLength);
  if (!normalized) {
    throw createQueueError(
      'AIRTEL_DLQ_REQUIRED_FIELD',
      `${name} is required`,
      { field: name },
    );
  }
  return normalized;
}

function isSafePositiveInteger(value) {
  return Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

function normalizePositiveInteger(value, name) {
  const number = Number(value);
  if (!isSafePositiveInteger(number)) {
    throw createQueueError(
      'AIRTEL_DLQ_CONFIGURATION_INVALID',
      `${name} must be a positive safe integer`,
      { field: name },
    );
  }
  return number;
}

function estimateBytes(value) {
  if (value === undefined || value === null) return 0;
  if (Buffer.isBuffer(value)) return value.length;
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function canonicalize(value, depth = 0) {
  if (depth > 10) return '[DEPTH_LIMIT]';
  if (value === null || value === undefined) return value;
  if (Buffer.isBuffer(value)) return `[BUFFER:${sha256(value)}]`;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, 500)
      .map((item) => canonicalize(item, depth + 1));
  }

  return Object.keys(value)
    .sort()
    .reduce((output, key) => {
      if (BLOCKED_KEYS.has(key)) return output;
      output[key] = canonicalize(value[key], depth + 1);
      return output;
    }, {});
}

function sha256(value) {
  const source = Buffer.isBuffer(value)
    ? value
    : typeof value === 'string'
      ? value
      : JSON.stringify(canonicalize(value));

  return crypto
    .createHash('sha256')
    .update(source)
    .digest('hex');
}

function stableFingerprint(value) {
  return sha256(value);
}

function sanitize(value, depth = 0) {
  if (depth > 8) return '[TRUNCATED]';
  if (value === null || value === undefined) return value;
  if (Buffer.isBuffer(value)) return '[BUFFER_REDACTED]';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value.slice(0, 4000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();

  if (Array.isArray(value)) {
    return value
      .slice(0, 250)
      .map((item) => sanitize(item, depth + 1));
  }

  if (isObject(value)) {
    const output = {};

    for (const [key, item] of Object.entries(value)) {
      if (BLOCKED_KEYS.has(key)) continue;

      if (SENSITIVE_KEY_PATTERN.test(key)) {
        output[key] = '[REDACTED]';
        continue;
      }

      if (RAW_TRANSPORT_KEY_PATTERN.test(key)) {
        output[key] = '[OMITTED]';
        continue;
      }

      output[key] = sanitize(item, depth + 1);
    }

    return output;
  }

  return safeString(value);
}

function sanitizeHeaders(headers, maxBytes) {
  const sanitized = sanitize(headers || {});

  if (estimateBytes(sanitized) <= maxBytes) {
    return sanitized;
  }

  return {
    omitted: true,
    reason: 'METADATA_TOO_LARGE',
    bytes: estimateBytes(sanitized),
    sha256: stableFingerprint(sanitized),
  };
}

function sanitizeMetadata(metadata, maxBytes) {
  const sanitized = sanitize(metadata || {});

  if (estimateBytes(sanitized) <= maxBytes) {
    return sanitized;
  }

  return {
    omitted: true,
    reason: 'METADATA_TOO_LARGE',
    bytes: estimateBytes(sanitized),
    sha256: stableFingerprint(sanitized),
  };
}

function sanitizePayload(
  payload,
  maxBytes,
  allowReplayablePayload = true,
) {
  if (!allowReplayablePayload) {
    return {
      omitted: true,
      reason: 'REPLAYABLE_PAYLOAD_DISABLED',
      sha256: stableFingerprint(payload),
    };
  }

  const bytes = estimateBytes(payload);

  if (bytes > maxBytes) {
    return {
      omitted: true,
      reason: 'PAYLOAD_TOO_LARGE',
      bytes,
      sha256: stableFingerprint(payload),
    };
  }

  return sanitize(payload);
}

function sanitizeError(error) {
  if (!error) return null;

  const output = {
    name: safeString(error.name, 128) || 'Error',
    code: safeString(error.code, 256),
    message: safeString(error.message || String(error), 2000),
    retryable: Boolean(error.retryable),
    uncertain: Boolean(error.uncertain),
  };

  if (error.statusCode !== undefined) {
    output.statusCode = Number(error.statusCode) || 500;
  }

  return output;
}

function inferFailureClass({ failureClass, error, reason }) {
  const requested = normalizeUpper(failureClass);

  if (
    requested &&
    Object.values(FAILURE_CLASS).includes(requested)
  ) {
    return requested;
  }

  const code =
    normalizeUpper(error?.code) || '';

  const combined =
    `${code} ${normalizeUpper(reason) || ''}`;

  if (combined.includes('SIGNATURE')) {
    return FAILURE_CLASS.SIGNATURE;
  }

  if (combined.includes('REPLAY')) {
    return FAILURE_CLASS.REPLAY;
  }

  if (combined.includes('DUPLICATE')) {
    return FAILURE_CLASS.DUPLICATE;
  }

  if (
    combined.includes('TIMEOUT') ||
    combined.includes('ETIMEDOUT')
  ) {
    return FAILURE_CLASS.TIMEOUT;
  }

  if (
    combined.includes('NETWORK') ||
    [
      'ECONNRESET',
      'ECONNREFUSED',
      'ENETUNREACH',
      'EHOSTUNREACH',
    ].includes(code)
  ) {
    return FAILURE_CLASS.NETWORK;
  }

  if (combined.includes('RECONCILIATION')) {
    return FAILURE_CLASS.RECONCILIATION;
  }

  if (
    combined.includes('FINANCIAL') ||
    combined.includes('LEDGER')
  ) {
    return FAILURE_CLASS.FINANCIAL;
  }

  if (
    combined.includes('STATE') ||
    combined.includes('TRANSITION')
  ) {
    return FAILURE_CLASS.STATE;
  }

  if (combined.includes('VALID')) {
    return FAILURE_CLASS.VALIDATION;
  }

  if (
    combined.includes('PROVIDER') ||
    error?.provider
  ) {
    return FAILURE_CLASS.PROVIDER;
  }

  if (combined.includes('DEPENDENCY')) {
    return FAILURE_CLASS.DEPENDENCY;
  }

  if (error) {
    return FAILURE_CLASS.INTERNAL;
  }

  return FAILURE_CLASS.UNKNOWN;
}

function normalizeUpper(value) {
  if (value === null || value === undefined) return null;

  const normalized =
    String(value)
      .trim()
      .toUpperCase();

  return normalized || null;
}

function normalizeTenantId(value) {
  return safeString(value, 256);
}

function normalizeStatus(value) {
  return normalizeUpper(value);
}

function createQueueError(code, message, details = {}) {
  const error =
    new Error(message);

  error.name =
    'AirtelCallbackDeadLetterQueueError';

  error.code =
    code;

  error.provider =
    PROVIDER;

  Object.assign(
    error,
    details,
  );

  return error;
}

function isDuplicateKeyError(error) {
  const code =
    String(error?.code || '')
      .toLowerCase();

  const message =
    String(error?.message || '')
      .toLowerCase();

  return (
    code === '11000' ||
    code.includes('duplicate') ||
    message.includes('duplicate key') ||
    message.includes('e11000')
  );
}

function getActorId(actor) {
  return safeString(
    actor?.id ||
      actor?.userId ||
      actor?._id ||
      actor?.actorId,
    256,
  );
}

function normalizeLimit(limit, max) {
  const value = Number(limit);

  if (!Number.isFinite(value)) {
    return Math.min(100, max);
  }

  return Math.min(
    Math.max(Math.trunc(value), 1),
    max,
  );
}

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(
    normalizeStatus(status),
  );
}

function isRetryableFailure(error) {
  if (!error) return false;

  if (error.retryable === true) {
    return true;
  }

  if (
    error.statusCode === 408 ||
    error.statusCode === 429 ||
    error.statusCode >= 500
  ) {
    return true;
  }

  return [
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'ENETUNREACH',
    'EHOSTUNREACH',
  ].includes(
    String(error.code || '').toUpperCase(),
  );
}

class AirtelCallbackDeadLetterQueue {
  constructor({
    repository = null,
    queueAdapter = null,
    publisher = null,
    recoveryDispatcher = null,
    outboxService = null,
    auditService = null,
    metrics = null,
    tracer = null,
    tenantResolver = null,
    logger = null,
    configuration = {},
    clock = Date,
  } = {}) {
    this.repository =
      repository;

    this.queueAdapter =
      queueAdapter ||
      publisher ||
      null;

    this.recoveryDispatcher =
      recoveryDispatcher ||
      null;

    this.outboxService =
      outboxService ||
      null;

    this.auditService =
      auditService ||
      null;

    this.metrics =
      metrics ||
      null;

    this.tracer =
      tracer ||
      null;

    this.tenantResolver =
      tenantResolver ||
      null;

    this.logger =
      logger ||
      console;

    this.clock =
      clock ||
      Date;

    this.options = {
      ...DEFAULTS,
      ...(configuration || {}),
    };

    this.options.maxPayloadBytes =
      normalizePositiveInteger(
        this.options.maxPayloadBytes,
        'maxPayloadBytes',
      );

    this.options.maxMetadataBytes =
      normalizePositiveInteger(
        this.options.maxMetadataBytes,
        'maxMetadataBytes',
      );

    this.options.maxAttempts =
      normalizePositiveInteger(
        this.options.maxAttempts,
        'maxAttempts',
      );

    this.options.visibilityTimeoutMs =
      normalizePositiveInteger(
        this.options.visibilityTimeoutMs,
        'visibilityTimeoutMs',
      );

    this.options.retentionDays =
      normalizePositiveInteger(
        this.options.retentionDays,
        'retentionDays',
      );

    this.options.maxListLimit =
      normalizePositiveInteger(
        this.options.maxListLimit,
        'maxListLimit',
      );

    this.options.lockTtlMs =
      normalizePositiveInteger(
        this.options.lockTtlMs,
        'lockTtlMs',
      );

    this.options.requireTenantId =
      this.options.requireTenantId !== false;

    this.options.requireRepository =
      this.options.requireRepository !== false;

    this.options.publishQueueMessages =
      Boolean(
        this.options.publishQueueMessages,
      );

    this.options.queueName =
      safeString(
        this.options.queueName,
        256,
      ) ||
      QUEUE_NAME;

    this.startedAt =
      now(this.clock);

    this.runtime = {
      activeFingerprints:
        new Map(),

      activeClaims:
        new Map(),

      lastEnqueuedAt:
        null,

      lastFailureAt:
        null,

      lastFailureCode:
        null,
    };

    this.statistics = {
      enqueued:
        0,

      duplicates:
        0,

      enqueueFailures:
        0,

      requeueAttempts:
        0,

      requeued:
        0,

      requeueFailures:
        0,

      claims:
        0,

      claimFailures:
        0,

      releasedClaims:
        0,

      resolved:
        0,

      discarded:
        0,

      poison:
        0,

      dispatchAttempts:
        0,

      dispatchSuccesses:
        0,

      dispatchFailures:
        0,

      repositoryLookups:
        0,

      repositoryFailures:
        0,

      auditFailures:
        0,

      eventFailures:
        0,

      tenantFailures:
        0,
    };
  }

  // ---------------------------------------------------------------------------
  // Primary enqueue/publish contract
  // ---------------------------------------------------------------------------

  async enqueue({
    tenantId,
    payload,
    headers = {},
    actor = null,
    reason,
    error,
    failureClass,
    source = 'AIRTEL_CALLBACK_PROCESSOR',
    transactionId = null,
    paymentReference = null,
    providerReference = null,
    collectionId = null,
    operationId = generateId(),
    correlationId = generateId(),
    idempotencyKey = null,
    callbackFingerprint = null,
    sourceEventId = null,
    callbackId = null,
    context = {},
    authenticated = false,
    signatureVerified = false,
    session = null,
  } = {}) {
    const span =
      this.startSpan(
        'airtel.callback.dlq.enqueue',
        {
          tenantId,
          correlationId,
          operationId,
        },
      );

    const receivedAt =
      now(this.clock);

    let acquiredFingerprint =
      null;

    let resolvedTenantId =
      normalizeTenantId(
        tenantId,
      );

    try {
      resolvedTenantId =
        await this.requireTenant({
          tenantId,
          context,
        });

      const fingerprint =
        callbackFingerprint ||
        this.buildCallbackFingerprint({
          payload,
          callbackId,
          providerReference,
          transactionId,
          paymentReference,
          collectionId,
          sourceEventId,
        });

      this.assertLocalFingerprintCapacity({
        tenantId:
          resolvedTenantId,
        fingerprint,
      });

      acquiredFingerprint =
        fingerprint;

      const effectiveIdempotencyKey =
        idempotencyKey ||
        this.buildIdempotencyKey({
          tenantId:
            resolvedTenantId,
          callbackFingerprint:
            fingerprint,
          paymentReference,
          providerReference,
          transactionId,
          sourceEventId,
        });

      const existing =
        await this.findDuplicate({
          tenantId:
            resolvedTenantId,
          idempotencyKey:
            effectiveIdempotencyKey,
          sourceEventId,
          fingerprint,
          callbackId,
          session,
        });

      if (existing) {
        this.statistics.duplicates += 1;

        this.incrementMetric(
          'airtel_callback_dlq_duplicates_total',
        );

        return {
          ...existing,
          duplicate:
            true,
        };
      }

      const record =
        this.buildRecord({
          tenantId:
            resolvedTenantId,
          payload,
          headers,
          actor,
          reason,
          error,
          failureClass,
          source,
          transactionId,
          paymentReference,
          providerReference,
          collectionId,
          operationId,
          correlationId,
          idempotencyKey:
            effectiveIdempotencyKey,
          callbackFingerprint:
            fingerprint,
          sourceEventId,
          callbackId,
          context,
          authenticated,
          signatureVerified,
          receivedAt,
        });

      let stored;

      try {
        stored =
          await this.persist(
            record,
            session,
          );
      } catch (persistError) {
        if (!isDuplicateKeyError(persistError)) {
          throw persistError;
        }

        const concurrent =
          await this.findDuplicate({
            tenantId:
              resolvedTenantId,
            idempotencyKey:
              effectiveIdempotencyKey,
            sourceEventId,
            fingerprint,
            callbackId,
            session,
          });

        if (!concurrent) {
          throw persistError;
        }

        this.statistics.duplicates += 1;

        this.incrementMetric(
          'airtel_callback_dlq_duplicates_total',
        );

        return {
          ...concurrent,
          duplicate:
            true,
          raceRecovered:
            true,
        };
      }

      this.statistics.enqueued += 1;

      this.runtime.lastEnqueuedAt =
        receivedAt;

      this.incrementMetric(
        'airtel_callback_dlq_enqueued_total',
      );

      await this.safeAudit(
        'AIRTEL_CALLBACK_DLQ_ENQUEUED',
        resolvedTenantId,
        correlationId,
        operationId,
        {
          dlqId:
            stored?.dlqId ||
            record.dlqId,

          failureClass:
            record.failureClass,

          reason:
            record.reason,

          callbackFingerprint:
            fingerprint,

          dispatchStatus:
            stored?.dispatchStatus ||
            record.dispatchStatus,
        },
      );

      if (
        this.options.publishQueueMessages
      ) {
        await this.dispatchRecord(
          stored ||
          record,
        );
      }

      return stored ||
        record;
    } catch (enqueueError) {
      this.statistics.enqueueFailures += 1;

      this.runtime.lastFailureAt =
        now(this.clock);

      this.runtime.lastFailureCode =
        String(
          enqueueError?.code ||
            'AIRTEL_DLQ_ENQUEUE_FAILED',
        );

      this.incrementMetric(
        'airtel_callback_dlq_enqueue_failures_total',
      );

      this.log(
        'error',
        'Airtel callback dead-letter enqueue failed',
        {
          provider:
            PROVIDER,

          tenantId:
            normalizeTenantId(
              tenantId,
            ),

          correlationId,
          operationId,

          error:
            sanitizeError(
              enqueueError,
            ),
        },
      );

      throw enqueueError;
    } finally {
      this.releaseLocalFingerprintCapacity({
        tenantId:
          resolvedTenantId ||
          normalizeTenantId(
            tenantId,
          ),

        fingerprint:
          acquiredFingerprint,
      });

      span?.end?.();
    }
  }

  async publish(input = {}) {
    const normalized =
      isPlainObject(input)
        ? input
        : {
            payload:
              input,
          };

    const payload =
      normalized.payload ??
      normalized.callback ??
      normalized.data ??
      undefined;

    const callback =
      normalized.callback ??
      normalized.payload ??
      undefined;

    const errorValue =
      normalized.error;

    return this.enqueue({
      tenantId:
        normalized.tenantId,

      payload,

      headers:
        normalized.headers ||
        {},

      actor:
        normalized.actor ||
        null,

      reason:
        normalized.reason ||
        normalized.type ||
        errorValue?.code ||
        'AIRTEL_CALLBACK_PROCESSING_FAILED',

      error:
        errorValue,

      failureClass:
        normalized.failureClass,

      source:
        normalized.source ||
        'AIRTEL_CALLBACK_PROCESSOR',

      transactionId:
        normalized.transactionId ||
        normalized.financialTransactionId ||
        null,

      paymentReference:
        normalized.paymentReference ||
        null,

      providerReference:
        normalized.providerReference ||
        null,

      collectionId:
        normalized.collectionId ||
        null,

      operationId:
        normalized.operationId,

      correlationId:
        normalized.correlationId,

      idempotencyKey:
        normalized.idempotencyKey,

      callbackFingerprint:
        normalized.callbackFingerprint ||
        normalized.payloadFingerprint,

      sourceEventId:
        normalized.sourceEventId,

      callbackId:
        normalized.callbackId ||
        callback?.callbackId ||
        callback?.id,

      context:
        normalized.context ||
        {},

      authenticated:
        normalized.authenticated === true ||
        normalized.internal === true,

      signatureVerified:
        normalized.signatureVerified === true,

      session:
        normalized.session,
    });
  }

  async store(input = {}) {
    return this.enqueue(
      input,
    );
  }

  async deadLetter(input = {}) {
    return this.enqueue(
      input,
    );
  }

  buildRecord({
    tenantId,
    payload,
    headers,
    actor,
    reason,
    error,
    failureClass,
    source,
    transactionId,
    paymentReference,
    providerReference,
    collectionId,
    operationId,
    correlationId,
    idempotencyKey,
    callbackFingerprint,
    sourceEventId,
    callbackId,
    context,
    authenticated,
    signatureVerified,
    receivedAt,
  }) {
    const failure =
      inferFailureClass({
        failureClass,
        error,
        reason,
      });

    const actorId =
      getActorId(actor);

    const payloadValue =
      sanitizePayload(
        payload,
        this.options.maxPayloadBytes,
        this.options.allowReplayablePayload,
      );

    return {
      dlqId:
        generateId(),

      provider:
        PROVIDER,

      operation:
        OPERATION,

      queueName:
        this.options.queueName,

      schemaVersion:
        SCHEMA_VERSION,

      engineVersion:
        ENGINE_VERSION,

      source:
        safeString(
          source,
          256,
        ) ||
        'AIRTEL_CALLBACK_PROCESSOR',

      tenantId,

      tenantIdHash:
        sha256(
          tenantId,
        ),

      status:
        DLQ_STATUS.DEAD_LETTERED,

      failureClass:
        failure,

      reason:
        safeString(
          reason ||
            error?.code ||
            'AIRTEL_CALLBACK_PROCESSING_FAILED',
          1000,
        ),

      error:
        sanitizeError(
          error,
        ),

      callbackId:
        safeString(
          callbackId,
          256,
        ),

      transactionId:
        safeString(
          transactionId,
          256,
        ),

      collectionId:
        safeString(
          collectionId,
          256,
        ),

      paymentReference:
        safeString(
          paymentReference,
          256,
        ),

      providerReference:
        safeString(
          providerReference,
          256,
        ),

      callbackFingerprint,

      sourceEventId:
        safeString(
          sourceEventId,
          256,
        ),

      idempotencyKey,

      correlationId:
        safeString(
          correlationId,
          256,
        ) ||
        generateId(),

      operationId:
        safeString(
          operationId,
          256,
        ) ||
        generateId(),

      actorId:
        actorId ||
        null,

      authenticated:
        Boolean(
          authenticated,
        ),

      signatureVerified:
        Boolean(
          signatureVerified,
        ),

      payload:
        payloadValue,

      headers:
        sanitizeHeaders(
          headers,
          this.options.maxMetadataBytes,
        ),

      context:
        sanitizeMetadata(
          context,
          this.options.maxMetadataBytes,
        ),

      attempts:
        0,

      maxAttempts:
        this.options.maxAttempts,

      leaseUntil:
        null,

      workerId:
        null,

      processingStartedAt:
        null,

      nextAttemptAt:
        null,

      requeuedAt:
        null,

      resolvedAt:
        null,

      discardedAt:
        null,

      poisonAt:
        null,

      createdAt:
        receivedAt,

      updatedAt:
        receivedAt,

      lastFailureAt:
        receivedAt,

      retentionUntil:
        new Date(
          receivedAt.getTime() +
          this.options.retentionDays *
            86400000,
        ),

      dispatchStatus:
        this.options.publishQueueMessages
          ? DISPATCH_STATUS.PENDING
          : DISPATCH_STATUS.NOT_REQUIRED,
    };
  }

  buildCallbackFingerprint({
    payload,
    callbackId,
    providerReference,
    transactionId,
    paymentReference,
    collectionId,
    sourceEventId,
  }) {
    return stableFingerprint({
      provider:
        PROVIDER,

      operation:
        OPERATION,

      callbackId:
        safeString(
          callbackId,
          256,
        ) ||
        null,

      providerReference:
        safeString(
          providerReference,
          256,
        ) ||
        null,

      transactionId:
        safeString(
          transactionId,
          256,
        ) ||
        null,

      paymentReference:
        safeString(
          paymentReference,
          256,
        ) ||
        null,

      collectionId:
        safeString(
          collectionId,
          256,
        ) ||
        null,

      sourceEventId:
        safeString(
          sourceEventId,
          256,
        ) ||
        null,

      payload:
        sanitize(
          payload,
        ),
    });
  }

  generateCallbackFingerprint(
    payload,
  ) {
    return this.buildCallbackFingerprint({
      payload,
    });
  }

  buildIdempotencyKey({
    tenantId,
    callbackFingerprint,
    paymentReference,
    providerReference,
    transactionId,
    sourceEventId,
  }) {
    return stableFingerprint({
      provider:
        PROVIDER,

      operation:
        OPERATION,

      tenantId,

      callbackFingerprint:
        callbackFingerprint ||
        null,

      paymentReference:
        paymentReference ||
        null,

      providerReference:
        providerReference ||
        null,

      transactionId:
        transactionId ||
        null,

      sourceEventId:
        sourceEventId ||
        null,
    });
  }

  // ---------------------------------------------------------------------------
  // Durable persistence / duplicate detection
  // ---------------------------------------------------------------------------

  async persist(
    record,
    session = null,
  ) {
    if (this.repository) {
      if (
        isFunction(
          this.repository.enqueue,
        )
      ) {
        return this.repository.enqueue({
          ...record,
          session,
        });
      }

      if (
        isFunction(
          this.repository.create,
        )
      ) {
        return this.repository.create({
          ...record,
          session,
        });
      }

      if (
        isFunction(
          this.repository.insert,
        )
      ) {
        return this.repository.insert({
          ...record,
          session,
        });
      }

      if (
        isFunction(
          this.repository.store,
        )
      ) {
        return this.repository.store({
          ...record,
          session,
        });
      }
    }

    if (
      this.options.requireRepository
    ) {
      throw createQueueError(
        'AIRTEL_DLQ_STORAGE_UNAVAILABLE',
        'No durable Airtel callback dead-letter repository is configured',
        {
          retryable:
            true,

          statusCode:
            503,
        },
      );
    }

    if (this.queueAdapter) {
      const message = {
        queue:
          this.options.queueName,

        type:
          'AIRTEL_CALLBACK_DEAD_LETTER',

        payload:
          record,
      };

      if (
        isFunction(
          this.queueAdapter.deadLetter,
        )
      ) {
        return this.queueAdapter.deadLetter(
          message,
        );
      }

      if (
        isFunction(
          this.queueAdapter.send,
        )
      ) {
        return this.queueAdapter.send(
          message,
        );
      }

      if (
        isFunction(
          this.queueAdapter.publish,
        )
      ) {
        return this.queueAdapter.publish(
          message,
        );
      }
    }

    throw createQueueError(
      'AIRTEL_DLQ_STORAGE_UNAVAILABLE',
      'No Airtel dead-letter persistence or queue adapter is configured',
      {
        retryable:
          true,

        statusCode:
          503,
      },
    );
  }

  async findDuplicate({
    tenantId,
    idempotencyKey,
    sourceEventId,
    fingerprint,
    callbackId,
    session = null,
  } = {}) {
    if (!this.repository) {
      return null;
    }

    const lookups = [
      [
        'findByIdempotencyKey',
        idempotencyKey,
        {
          tenantId,
          provider:
            PROVIDER,
          operation:
            OPERATION,
          idempotencyKey,
          session,
        },
      ],

      [
        'findBySourceEventId',
        sourceEventId,
        {
          tenantId,
          provider:
            PROVIDER,
          operation:
            OPERATION,
          sourceEventId,
          session,
        },
      ],

      [
        'findByFingerprint',
        fingerprint,
        {
          tenantId,
          provider:
            PROVIDER,
          operation:
            OPERATION,
          callbackFingerprint:
            fingerprint,
          fingerprint,
          session,
        },
      ],

      [
        'findByCallbackFingerprint',
        fingerprint,
        {
          tenantId,
          provider:
            PROVIDER,
          operation:
            OPERATION,
          callbackFingerprint:
            fingerprint,
          session,
        },
      ],

      [
        'findByCallbackId',
        callbackId,
        {
          tenantId,
          provider:
            PROVIDER,
          operation:
            OPERATION,
          callbackId,
          session,
        },
      ],
    ];

    for (
      const [
        method,
        value,
        query,
      ] of lookups
    ) {
      if (
        !value ||
        !isFunction(
          this.repository[method],
        )
      ) {
        continue;
      }

      try {
        this.statistics.repositoryLookups += 1;

        const result =
          await this.repository[method](
            query,
          );

        if (result) {
          return result;
        }
      } catch (error) {
        this.statistics.repositoryFailures += 1;

        this.log(
          'warn',
          'Airtel callback DLQ duplicate lookup failed',
          {
            method,
            tenantId,

            error:
              sanitizeError(
                error,
              ),
          },
        );

        if (
          this.options.failClosedOnPersistenceError
        ) {
          throw error;
        }
      }
    }

    return null;
  }

  async findById({
    dlqId,
    tenantId,
    session = null,
  } = {}) {
    const resolvedTenantId =
      await this.requireTenant({
        tenantId,
      });

    requireString(
      dlqId,
      'dlqId',
    );

    if (!this.repository) {
      throw createQueueError(
        'AIRTEL_DLQ_LOOKUP_UNAVAILABLE',
        'Dead-letter repository is not configured',
        {
          statusCode:
            503,

          retryable:
            true,
        },
      );
    }

    if (
      isFunction(
        this.repository.findById,
      )
    ) {
      this.statistics.repositoryLookups += 1;

      return this.repository.findById({
        dlqId,
        tenantId:
          resolvedTenantId,
        provider:
          PROVIDER,
        session,
      });
    }

    if (
      isFunction(
        this.repository.findOne,
      )
    ) {
      this.statistics.repositoryLookups += 1;

      return this.repository.findOne({
        dlqId,
        tenantId:
          resolvedTenantId,
        provider:
          PROVIDER,
        operation:
          OPERATION,
        session,
      });
    }

    throw createQueueError(
      'AIRTEL_DLQ_LOOKUP_UNAVAILABLE',
      'Dead-letter repository does not support lookup',
      {
        statusCode:
          503,

        retryable:
          true,
      },
    );
  }

  async get(input = {}) {
    const params =
      isPlainObject(input)
        ? input
        : {
            dlqId:
              input,
          };

    const dlqId =
      params.dlqId ||
      params.id;

    /*
     * Legacy callbackProcessor.replayDeadLetter() expects get({ id }) to return
     * the replayable callback payload rather than the internal DLQ envelope.
     *
     * Tenant-scoped inspection remains available through findById()/getRecord().
     *
     * The unscoped branch is deliberately limited to this internal replay
     * compatibility path. The repository remains the security boundary for
     * ID-based replay lookup.
     */
    const record =
      params.tenantId
        ? await this.findById({
            dlqId,
            tenantId:
              params.tenantId,
            session:
              params.session,
          })
        : await this.findByIdForInternalReplay({
            dlqId,
            session:
              params.session,
          });

    if (!record) {
      return null;
    }

    if (
      record.payload?.omitted === true
    ) {
      throw createQueueError(
        'AIRTEL_DLQ_REPLAY_PAYLOAD_UNAVAILABLE',
        'Replayable callback payload is unavailable for this dead-letter record',
        {
          statusCode:
            409,
        },
      );
    }

    return record.payload ||
      null;
  }

  async getRecord(input = {}) {
    const params =
      isPlainObject(input)
        ? input
        : {
            dlqId:
              input,
          };

    return this.findById({
      dlqId:
        params.dlqId ||
        params.id,

      tenantId:
        params.tenantId,

      session:
        params.session,
    });
  }

  async findByIdForInternalReplay({
    dlqId,
    session = null,
  } = {}) {
    requireString(
      dlqId,
      'dlqId',
    );

    if (!this.repository) {
      throw createQueueError(
        'AIRTEL_DLQ_LOOKUP_UNAVAILABLE',
        'Dead-letter repository is not configured',
        {
          statusCode:
            503,

          retryable:
            true,
        },
      );
    }

    if (
      isFunction(
        this.repository.findByIdForReplay,
      )
    ) {
      this.statistics.repositoryLookups += 1;

      return this.repository.findByIdForReplay({
        dlqId,
        provider:
          PROVIDER,
        operation:
          OPERATION,
        session,
      });
    }

    if (
      isFunction(
        this.repository.findById,
      )
    ) {
      this.statistics.repositoryLookups += 1;

      return this.repository.findById({
        dlqId,
        provider:
          PROVIDER,
        operation:
          OPERATION,
        session,
      });
    }

    if (
      isFunction(
        this.repository.findOne,
      )
    ) {
      this.statistics.repositoryLookups += 1;

      return this.repository.findOne({
        dlqId,
        provider:
          PROVIDER,
        operation:
          OPERATION,
        session,
      });
    }

    throw createQueueError(
      'AIRTEL_DLQ_LOOKUP_UNAVAILABLE',
      'Dead-letter repository does not support replay lookup',
      {
        statusCode:
          503,

        retryable:
          true,
      },
    );
  }

  async list({
    tenantId,
    status,
    failureClass,
    limit = 100,
    cursor,
    session = null,
    includePayload = false,
  } = {}) {
    const resolvedTenantId =
      await this.requireTenant({
        tenantId,
      });

    const normalizedLimit =
      normalizeLimit(
        limit,
        this.options.maxListLimit,
      );

    if (!this.repository) {
      throw createQueueError(
        'AIRTEL_DLQ_LIST_UNAVAILABLE',
        'Dead-letter repository is not configured',
        {
          statusCode:
            503,

          retryable:
            true,
        },
      );
    }

    const query = {
      tenantId:
        resolvedTenantId,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      status:
        normalizeStatus(
          status,
        ),

      failureClass:
        normalizeUpper(
          failureClass,
        ),

      limit:
        normalizedLimit,

      cursor,

      includePayload:
        Boolean(
          includePayload,
        ),

      session,
    };

    let result;

    if (
      isFunction(
        this.repository.list,
      )
    ) {
      this.statistics.repositoryLookups += 1;

      result =
        await this.repository.list(
          query,
        );
    } else if (
      isFunction(
        this.repository.find,
      )
    ) {
      this.statistics.repositoryLookups += 1;

      result =
        await this.repository.find(
          query,
        );
    } else {
      throw createQueueError(
        'AIRTEL_DLQ_LIST_UNAVAILABLE',
        'Dead-letter repository does not support listing',
        {
          statusCode:
            503,

          retryable:
            true,
        },
      );
    }

    if (!includePayload) {
      return this.stripListPayload(
        result,
      );
    }

    return result;
  }

  stripListPayload(result) {
    if (Array.isArray(result)) {
      return result.map(
        (item) =>
          this.stripPayloadFromRecord(
            item,
          ),
      );
    }

    if (
      Array.isArray(
        result?.items,
      )
    ) {
      return {
        ...result,

        items:
          result.items.map(
            (item) =>
              this.stripPayloadFromRecord(
                item,
              ),
          ),
      };
    }

    return this.stripPayloadFromRecord(
      result,
    );
  }

  stripPayloadFromRecord(record) {
    if (
      !record ||
      !isObject(record)
    ) {
      return record;
    }

    const copy = {
      ...record,
    };

    delete copy.payload;
    delete copy.headers;
    delete copy.context;

    return copy;
  }

  // ---------------------------------------------------------------------------
  // Claims and recovery state machine
  // ---------------------------------------------------------------------------

  async claim({
    dlqId,
    tenantId,
    workerId,
    correlationId = generateId(),
    operationId = generateId(),
    session = null,
  } = {}) {
    const resolvedTenantId =
      await this.requireTenant({
        tenantId,
      });

    const id =
      requireString(
        dlqId,
        'dlqId',
      );

    const worker =
      requireString(
        workerId,
        'workerId',
        256,
      );

    const claimKey =
      `${resolvedTenantId}:${id}`;

    if (
      this.runtime.activeClaims.has(
        claimKey,
      )
    ) {
      throw createQueueError(
        'AIRTEL_DLQ_CLAIM_IN_FLIGHT',
        'Dead-letter claim is already active',
        {
          statusCode:
            409,

          retryable:
            true,
        },
      );
    }

    this.runtime.activeClaims.set(
      claimKey,
      Date.now(),
    );

    try {
      const leaseUntil =
        new Date(
          now(this.clock).getTime() +
          this.options.visibilityTimeoutMs,
        );

      const update = {
        workerId:
          worker,

        leaseUntil,

        processingStartedAt:
          now(this.clock),

        correlationId:
          safeString(
            correlationId,
            256,
          ),

        operationId:
          safeString(
            operationId,
            256,
          ),

        updatedAt:
          now(this.clock),
      };

      let result;

      if (
        this.repository &&
        isFunction(
          this.repository.claim,
        )
      ) {
        result =
          await this.repository.claim({
            dlqId:
              id,

            tenantId:
              resolvedTenantId,

            provider:
              PROVIDER,

            expectedStatuses:
              [
                ...CLAIMABLE_STATUSES,
              ],

            nextStatus:
              DLQ_STATUS.PROCESSING,

            update,

            session,

            correlationId,

            operationId,
          });
      } else {
        result =
          await this.transition({
            dlqId:
              id,

            tenantId:
              resolvedTenantId,

            expectedStatuses:
              [
                ...CLAIMABLE_STATUSES,
              ],

            nextStatus:
              DLQ_STATUS.PROCESSING,

            update,

            session,

            correlationId,

            operationId,
          });
      }

      this.statistics.claims += 1;

      this.incrementMetric(
        'airtel_callback_dlq_claims_total',
      );

      return result;
    } catch (error) {
      this.statistics.claimFailures += 1;

      this.incrementMetric(
        'airtel_callback_dlq_claim_failures_total',
      );

      throw error;
    } finally {
      this.runtime.activeClaims.delete(
        claimKey,
      );
    }
  }

  async releaseClaim({
    dlqId,
    tenantId,
    workerId,
    reason =
      'CLAIM_RELEASED',
    correlationId = generateId(),
    operationId = generateId(),
    session = null,
  } = {}) {
    const resolvedTenantId =
      await this.requireTenant({
        tenantId,
      });

    const id =
      requireString(
        dlqId,
        'dlqId',
      );

    const record =
      await this.findById({
        dlqId:
          id,

        tenantId:
          resolvedTenantId,

        session,
      });

    if (!record) {
      throw createQueueError(
        'AIRTEL_DLQ_NOT_FOUND',
        'Dead-letter record not found',
        {
          statusCode:
            404,
        },
      );
    }

    const currentStatus =
      normalizeStatus(
        record.status,
      );

    if (
      currentStatus !==
      DLQ_STATUS.PROCESSING
    ) {
      return record;
    }

    if (
      workerId &&
      record.workerId &&
      String(record.workerId) !==
        String(workerId)
    ) {
      throw createQueueError(
        'AIRTEL_DLQ_CLAIM_OWNER_MISMATCH',
        'Dead-letter claim is owned by another worker',
        {
          statusCode:
            409,
        },
      );
    }

    const nextStatus =
      Number(
        record.attempts ||
          0,
      ) >=
      Math.min(
        Number(
          record.maxAttempts ||
            this.options.maxAttempts,
        ),
        this.options.maxAttempts,
      )
        ? DLQ_STATUS.POISON
        : DLQ_STATUS.READY_FOR_REVIEW;

    const updated =
      await this.transition({
        dlqId:
          id,

        tenantId:
          resolvedTenantId,

        expectedStatus:
          DLQ_STATUS.PROCESSING,

        nextStatus,

        update: {
          leaseUntil:
            null,

          workerId:
            null,

          claimReleasedAt:
            now(this.clock),

          claimReleaseReason:
            safeString(
              reason,
              1000,
            ),

          correlationId,

          operationId,

          updatedAt:
            now(this.clock),
        },

        session,

        correlationId,

        operationId,
      });

    this.statistics.releasedClaims += 1;

    this.incrementMetric(
      'airtel_callback_dlq_claim_released_total',
    );

    return updated;
  }

  async requeue({
    dlqId,
    tenantId,
    actor,
    reason =
      'OPERATOR_REQUEUE',
    context = {},
    session = null,
    correlationId = generateId(),
    operationId = generateId(),
    dispatch = false,
  } = {}) {
    this.statistics.requeueAttempts += 1;

    const resolvedTenantId =
      await this.requireTenant({
        tenantId,
        context,
      });

    const id =
      requireString(
        dlqId,
        'dlqId',
      );

    try {
      const record =
        await this.findById({
          dlqId:
            id,

          tenantId:
            resolvedTenantId,

          session,
        });

      if (!record) {
        throw createQueueError(
          'AIRTEL_DLQ_NOT_FOUND',
          'Dead-letter record not found',
          {
            statusCode:
              404,
          },
        );
      }

      const status =
        normalizeStatus(
          record.status,
        );

      if (
        status ===
        DLQ_STATUS.RESOLVED
      ) {
        return {
          ...record,
          duplicate:
            true,
        };
      }

      if (
        status ===
        DLQ_STATUS.DISCARDED
      ) {
        throw createQueueError(
          'AIRTEL_DLQ_DISCARDED',
          'Discarded dead-letter records cannot be requeued',
          {
            statusCode:
              409,
          },
        );
      }

      if (
        status ===
        DLQ_STATUS.POISON
      ) {
        throw createQueueError(
          'AIRTEL_DLQ_POISON_REQUIRES_REVIEW',
          'Poison dead-letter records require explicit review before requeue',
          {
            statusCode:
              409,
          },
        );
      }

      const attempts =
        Number(
          record.attempts ||
            0,
        );

      const maxAttempts =
        Math.min(
          Number(
            record.maxAttempts ||
              this.options.maxAttempts,
          ),
          this.options.maxAttempts,
        );

      if (
        attempts >=
        maxAttempts
      ) {
        await this.markPoison({
          dlqId:
            id,

          tenantId:
            resolvedTenantId,

          reason:
            'MAX_ATTEMPTS_EXCEEDED',

          session,

          correlationId,

          operationId,
        });

        throw createQueueError(
          'AIRTEL_DLQ_MAX_ATTEMPTS_EXCEEDED',
          'Dead-letter message reached the maximum retry attempts',
          {
            statusCode:
              409,
          },
        );
      }

      let updated =
        await this.transition({
          dlqId:
            id,

          tenantId:
            resolvedTenantId,

          expectedStatuses:
            [
              DLQ_STATUS.DEAD_LETTERED,
              DLQ_STATUS.READY_FOR_REVIEW,
              DLQ_STATUS.REQUEUE_PENDING,
            ],

          nextStatus:
            dispatch &&
            (
              this.recoveryDispatcher ||
              this.outboxService
            )
              ? DLQ_STATUS.REQUEUE_PENDING
              : DLQ_STATUS.REQUEUED,

          update: {
            attempts:
              attempts + 1,

            requeuedAt:
              now(this.clock),

            requeueReason:
              safeString(
                reason,
                1000,
              ),

            lastActorId:
              getActorId(actor) ||
              null,

            correlationId,

            operationId,

            nextAttemptAt:
              now(this.clock),

            updatedAt:
              now(this.clock),
          },

          session,

          correlationId,

          operationId,
        });

      if (dispatch) {
        try {
          updated =
            await this.dispatchRecovery({
              record:
                updated,

              tenantId:
                resolvedTenantId,

              correlationId,

              operationId,
            });
        } catch (dispatchError) {
          await this.safeTransitionRecoveryDispatchFailure({
            record:
              updated,

            tenantId:
              resolvedTenantId,

            correlationId,

            operationId,

            dispatchError,

            session,
          });

          throw dispatchError;
        }
      }

      this.statistics.requeued += 1;

      this.incrementMetric(
        'airtel_callback_dlq_requeued_total',
      );

      await this.safeAudit(
        'AIRTEL_CALLBACK_DLQ_REQUEUED',
        resolvedTenantId,
        correlationId,
        operationId,
        {
          dlqId:
            id,

          reason,

          attempts:
            Number(
              updated?.attempts ||
                attempts + 1,
            ),
        },
      );

      return updated;
    } catch (error) {
      this.statistics.requeueFailures += 1;

      this.incrementMetric(
        'airtel_callback_dlq_requeue_failures_total',
      );

      throw error;
    }
  }

  async dispatchRecovery({
    record,
    tenantId,
    correlationId,
    operationId,
  }) {
    this.statistics.dispatchAttempts += 1;

    const message = {
      type:
        'AIRTEL_CALLBACK_DLQ_REPLAY_REQUESTED',

      provider:
        PROVIDER,

      operation:
        OPERATION,

      queueName:
        this.options.queueName,

      tenantId,

      correlationId,

      operationId,

      dlqId:
        record?.dlqId,

      callbackId:
        record?.callbackId,

      callbackFingerprint:
        record?.callbackFingerprint,

      transactionId:
        record?.transactionId,

      paymentReference:
        record?.paymentReference,

      providerReference:
        record?.providerReference,

      payload:
        record?.payload,

      context:
        record?.context,
    };

    try {
      let result;

      if (this.recoveryDispatcher) {
        const method =
          [
            'dispatch',
            'enqueue',
            'publish',
            'send',
          ].find(
            (name) =>
              isFunction(
                this.recoveryDispatcher?.[name],
              ),
          );

        if (method) {
          result =
            await this.recoveryDispatcher[method](
              message,
            );
        }
      }

      if (
        !result &&
        this.outboxService
      ) {
        const method =
          [
            'enqueue',
            'publish',
            'append',
          ].find(
            (name) =>
              isFunction(
                this.outboxService?.[name],
              ),
          );

        if (method) {
          result =
            await this.outboxService[method](
              message,
            );
        }
      }

      if (!result) {
        throw createQueueError(
          'AIRTEL_DLQ_RECOVERY_DISPATCH_UNAVAILABLE',
          'No recovery dispatcher is configured',
          {
            statusCode:
              503,

            retryable:
              true,
          },
        );
      }

      this.statistics.dispatchSuccesses += 1;

      this.incrementMetric(
        'airtel_callback_dlq_dispatch_success_total',
      );

      return (
        await this.safeTransitionToRequeued({
          record,
          tenantId,
          correlationId,
          operationId,
        })
      ) || record;
    } catch (error) {
      this.statistics.dispatchFailures += 1;

      this.incrementMetric(
        'airtel_callback_dlq_dispatch_failures_total',
      );

      throw error;
    }
  }

  async safeTransitionToRequeued({
    record,
    tenantId,
    correlationId,
    operationId,
  }) {
    if (
      normalizeStatus(
        record?.status,
      ) !==
      DLQ_STATUS.REQUEUE_PENDING
    ) {
      return record;
    }

    return this.transition({
      dlqId:
        record.dlqId,

      tenantId,

      expectedStatus:
        DLQ_STATUS.REQUEUE_PENDING,

      nextStatus:
        DLQ_STATUS.REQUEUED,

      update: {
        dispatchStatus:
          DISPATCH_STATUS.DISPATCHED,

        dispatchedAt:
          now(this.clock),

        updatedAt:
          now(this.clock),

        correlationId,

        operationId,
      },

      correlationId,

      operationId,
    });
  }

  async safeTransitionRecoveryDispatchFailure({
    record,
    tenantId,
    correlationId,
    operationId,
    dispatchError,
    session,
  }) {
    if (!record?.dlqId) {
      return null;
    }

    try {
      return await this.transition({
        dlqId:
          record.dlqId,

        tenantId,

        expectedStatuses:
          [
            DLQ_STATUS.REQUEUE_PENDING,
          ],

        nextStatus:
          DLQ_STATUS.READY_FOR_REVIEW,

        update: {
          dispatchStatus:
            DISPATCH_STATUS.FAILED,

          dispatchError:
            sanitizeError(
              dispatchError,
            ),

          nextAttemptAt:
            null,

          updatedAt:
            now(this.clock),

          correlationId,

          operationId,
        },

        session,

        correlationId,

        operationId,
      });
    } catch {
      return null;
    }
  }

  async resolve({
    dlqId,
    tenantId,
    actor,
    reason,
    session = null,
    correlationId = generateId(),
    operationId = generateId(),
  } = {}) {
    const resolvedTenantId =
      await this.requireTenant({
        tenantId,
      });

    const id =
      requireString(
        dlqId,
        'dlqId',
      );

    const resolutionReason =
      requireString(
        reason,
        'reason',
        1000,
      );

    const updated =
      await this.transition({
        dlqId:
          id,

        tenantId:
          resolvedTenantId,

        expectedStatuses:
          [
            DLQ_STATUS.PROCESSING,
            DLQ_STATUS.REQUEUED,
            DLQ_STATUS.READY_FOR_REVIEW,
            DLQ_STATUS.REQUEUE_PENDING,
          ],

        nextStatus:
          DLQ_STATUS.RESOLVED,

        update: {
          resolvedAt:
            now(this.clock),

          resolutionReason,

          resolvedBy:
            getActorId(actor) ||
            null,

          leaseUntil:
            null,

          workerId:
            null,

          updatedAt:
            now(this.clock),

          correlationId,

          operationId,
        },

        session,

        correlationId,

        operationId,
      });

    this.statistics.resolved += 1;

    this.incrementMetric(
      'airtel_callback_dlq_resolved_total',
    );

    await this.safeAudit(
      'AIRTEL_CALLBACK_DLQ_RESOLVED',
      resolvedTenantId,
      correlationId,
      operationId,
      {
        dlqId:
          id,

        reason:
          resolutionReason,
      },
    );

    return updated;
  }

  async discard({
    dlqId,
    tenantId,
    actor,
    reason,
    session = null,
    correlationId = generateId(),
    operationId = generateId(),
  } = {}) {
    const resolvedTenantId =
      await this.requireTenant({
        tenantId,
      });

    const id =
      requireString(
        dlqId,
        'dlqId',
      );

    const discardReason =
      requireString(
        reason,
        'reason',
        1000,
      );

    const updated =
      await this.transition({
        dlqId:
          id,

        tenantId:
          resolvedTenantId,

        expectedStatuses:
          [
            DLQ_STATUS.DEAD_LETTERED,
            DLQ_STATUS.READY_FOR_REVIEW,
            DLQ_STATUS.POISON,
            DLQ_STATUS.REQUEUE_PENDING,
          ],

        nextStatus:
          DLQ_STATUS.DISCARDED,

        update: {
          discardedAt:
            now(this.clock),

          discardReason,

          discardedBy:
            getActorId(actor) ||
            null,

          updatedAt:
            now(this.clock),

          correlationId,

          operationId,
        },

        session,

        correlationId,

        operationId,
      });

    this.statistics.discarded += 1;

    this.incrementMetric(
      'airtel_callback_dlq_discarded_total',
    );

    await this.safeAudit(
      'AIRTEL_CALLBACK_DLQ_DISCARDED',
      resolvedTenantId,
      correlationId,
      operationId,
      {
        dlqId:
          id,

        reason:
          discardReason,
      },
    );

    return updated;
  }

  async markPoison({
    dlqId,
    tenantId,
    reason =
      'MAX_ATTEMPTS_EXCEEDED',
    session = null,
    correlationId = generateId(),
    operationId = generateId(),
  } = {}) {
    const resolvedTenantId =
      await this.requireTenant({
        tenantId,
      });

    const id =
      requireString(
        dlqId,
        'dlqId',
      );

    const result =
      await this.transition({
        dlqId:
          id,

        tenantId:
          resolvedTenantId,

        expectedStatuses:
          [
            DLQ_STATUS.DEAD_LETTERED,
            DLQ_STATUS.REQUEUED,
            DLQ_STATUS.REQUEUE_PENDING,
            DLQ_STATUS.PROCESSING,
            DLQ_STATUS.READY_FOR_REVIEW,
          ],

        nextStatus:
          DLQ_STATUS.POISON,

        update: {
          poisonReason:
            safeString(
              reason,
              1000,
            ),

          poisonAt:
            now(this.clock),

          leaseUntil:
            null,

          workerId:
            null,

          updatedAt:
            now(this.clock),

          correlationId,

          operationId,
        },

        session,

        correlationId,

        operationId,
      });

    this.statistics.poison += 1;

    this.incrementMetric(
      'airtel_callback_dlq_poison_total',
    );

    await this.safeAudit(
      'AIRTEL_CALLBACK_DLQ_POISON',
      resolvedTenantId,
      correlationId,
      operationId,
      {
        dlqId:
          id,

        reason,
      },
    );

    return result;
  }

  // ---------------------------------------------------------------------------
  // Atomic state transitions
  // ---------------------------------------------------------------------------

  async transition({
    dlqId,
    tenantId,
    expectedStatus,
    expectedStatuses = null,
    nextStatus,
    update = {},
    session = null,
    correlationId = null,
    operationId = null,
  } = {}) {
    const resolvedTenantId =
      await this.requireTenant({
        tenantId,
      });

    const id =
      requireString(
        dlqId,
        'dlqId',
      );

    const target =
      normalizeStatus(
        nextStatus,
      );

    const expected =
      Array.isArray(
        expectedStatuses,
      )
        ? expectedStatuses
            .map(
              normalizeStatus,
            )
            .filter(Boolean)
        : expectedStatus
          ? [
              normalizeStatus(
                expectedStatus,
              ),
            ]
          : [];

    if (
      !Object.values(
        DLQ_STATUS,
      ).includes(
        target,
      )
    ) {
      throw createQueueError(
        'AIRTEL_DLQ_STATUS_INVALID',
        `Invalid DLQ target status: ${nextStatus}`,
      );
    }

    this.assertTransitionAllowed(
      expected,
      target,
    );

    const safeUpdate =
      sanitizeMetadata(
        update,
        this.options.maxMetadataBytes,
      );

    if (
      this.repository &&
      isFunction(
        this.repository.transition,
      )
    ) {
      this.statistics.repositoryLookups += 1;

      return this.repository.transition({
        dlqId:
          id,

        tenantId:
          resolvedTenantId,

        provider:
          PROVIDER,

        operation:
          OPERATION,

        expectedStatuses:
          expected,

        nextStatus:
          target,

        update:
          safeUpdate,

        session,

        correlationId,

        operationId,
      });
    }

    if (
      this.repository &&
      isFunction(
        this.repository.compareAndSetStatus,
      )
    ) {
      this.statistics.repositoryLookups += 1;

      return this.repository.compareAndSetStatus({
        dlqId:
          id,

        tenantId:
          resolvedTenantId,

        provider:
          PROVIDER,

        operation:
          OPERATION,

        expectedStatuses:
          expected,

        nextStatus:
          target,

        update:
          safeUpdate,

        session,

        correlationId,

        operationId,
      });
    }

    if (
      this.repository &&
      isFunction(
        this.repository.atomicTransition,
      )
    ) {
      this.statistics.repositoryLookups += 1;

      return this.repository.atomicTransition({
        dlqId:
          id,

        tenantId:
          resolvedTenantId,

        provider:
          PROVIDER,

        operation:
          OPERATION,

        expectedStatuses:
          expected,

        nextStatus:
          target,

        update:
          safeUpdate,

        session,

        correlationId,

        operationId,
      });
    }

    throw createQueueError(
      'AIRTEL_DLQ_TRANSITION_UNAVAILABLE',
      'Dead-letter repository does not expose an atomic transition primitive',
      {
        statusCode:
          503,

        retryable:
          true,
      },
    );
  }

  assertTransitionAllowed(
    expectedStatuses,
    target,
  ) {
    if (
      !expectedStatuses?.length
    ) {
      throw createQueueError(
        'AIRTEL_DLQ_EXPECTED_STATUS_REQUIRED',
        'Expected status is required for an atomic dead-letter transition',
        {
          statusCode:
            400,
        },
      );
    }

    const compatibility = {
      [DLQ_STATUS.DEAD_LETTERED]:
        new Set([
          DLQ_STATUS.READY_FOR_REVIEW,
          DLQ_STATUS.REQUEUE_PENDING,
          DLQ_STATUS.REQUEUED,
          DLQ_STATUS.PROCESSING,
          DLQ_STATUS.RESOLVED,
          DLQ_STATUS.DISCARDED,
          DLQ_STATUS.POISON,
        ]),

      [DLQ_STATUS.READY_FOR_REVIEW]:
        new Set([
          DLQ_STATUS.REQUEUE_PENDING,
          DLQ_STATUS.REQUEUED,
          DLQ_STATUS.PROCESSING,
          DLQ_STATUS.RESOLVED,
          DLQ_STATUS.DISCARDED,
          DLQ_STATUS.POISON,
        ]),

      [DLQ_STATUS.REQUEUE_PENDING]:
        new Set([
          DLQ_STATUS.REQUEUED,
          DLQ_STATUS.READY_FOR_REVIEW,
          DLQ_STATUS.DISCARDED,
          DLQ_STATUS.POISON,
        ]),

      [DLQ_STATUS.REQUEUED]:
        new Set([
          DLQ_STATUS.PROCESSING,
          DLQ_STATUS.RESOLVED,
          DLQ_STATUS.POISON,
        ]),

      [DLQ_STATUS.PROCESSING]:
        new Set([
          DLQ_STATUS.READY_FOR_REVIEW,
          DLQ_STATUS.RESOLVED,
          DLQ_STATUS.POISON,
        ]),

      [DLQ_STATUS.POISON]:
        new Set([
          DLQ_STATUS.DISCARDED,
        ]),

      [DLQ_STATUS.RESOLVED]:
        new Set(),

      [DLQ_STATUS.DISCARDED]:
        new Set(),
    };

    const valid =
      expectedStatuses.some(
        (source) =>
          compatibility[
            source
          ]?.has(
            target,
          ),
      );

    if (!valid) {
      throw createQueueError(
        'AIRTEL_DLQ_ILLEGAL_TRANSITION',
        `Illegal Airtel DLQ transition to ${target}`,
        {
          statusCode:
            409,

          expectedStatuses,

          nextStatus:
            target,
        },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Tenant/security boundary
  // ---------------------------------------------------------------------------

  async requireTenant({
    tenantId,
    context = {},
  } = {}) {
    let resolved =
      normalizeTenantId(
        tenantId ||
          context?.tenantId ||
          context?.trustedTenantId,
      );

    if (
      !resolved &&
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
              this.tenantResolver?.[name],
            ),
        );

      if (method) {
        try {
          const result =
            await this.tenantResolver[
              method
            ](
              context,
            );

          resolved =
            normalizeTenantId(
              result?.id ||
                result?.tenantId ||
                result,
            );
        } catch (error) {
          this.statistics.tenantFailures += 1;

          throw createQueueError(
            'AIRTEL_DLQ_TENANT_RESOLUTION_FAILED',
            'Trusted tenant resolution failed',
            {
              statusCode:
                403,

              cause:
                error,
            },
          );
        }
      }
    }

    if (
      !resolved &&
      this.options.requireTenantId
    ) {
      this.statistics.tenantFailures += 1;

      throw createQueueError(
        'AIRTEL_DLQ_TENANT_REQUIRED',
        'Trusted tenant context is required',
        {
          statusCode:
            403,
        },
      );
    }

    return (
      resolved ||
      'UNSCOPED'
    );
  }

  // ---------------------------------------------------------------------------
  // Audit/events/observability
  // ---------------------------------------------------------------------------

  async safeAudit(
    action,
    tenantId,
    correlationId,
    operationId,
    metadata = {},
  ) {
    if (!this.auditService) {
      return;
    }

    const payload = {
      action,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      tenantId,

      correlationId,

      operationId,

      metadata:
        sanitizeMetadata(
          metadata,
          this.options.maxMetadataBytes,
        ),

      at:
        now(
          this.clock,
        ).toISOString(),
    };

    try {
      const method =
        [
          'record',
          'audit',
          'write',
        ].find(
          (name) =>
            isFunction(
              this.auditService?.[name],
            ),
        );

      if (method) {
        await this.auditService[
          method
        ](
          payload,
        );
      }
    } catch (error) {
      this.statistics.auditFailures += 1;

      this.log(
        'error',
        'Airtel callback DLQ audit failed',
        {
          action,
          tenantId,
          correlationId,
          operationId,

          error:
            sanitizeError(
              error,
            ),
        },
      );

      if (
        this.options.failClosedOnAuditError
      ) {
        throw error;
      }
    }
  }

  async publishEvent(
    type,
    tenantId,
    correlationId,
    operationId,
    metadata = {},
  ) {
    const payload = {
      type,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      tenantId,

      correlationId,

      operationId,

      payload:
        sanitizeMetadata(
          metadata,
          this.options.maxMetadataBytes,
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
                this.outboxService?.[name],
              ),
          );

        if (method) {
          await this.outboxService[
            method
          ](
            payload,
          );

          return;
        }
      }

      if (
        this.queueAdapter
      ) {
        const method =
          [
            'publish',
            'send',
            'enqueue',
          ].find(
            (name) =>
              isFunction(
                this.queueAdapter?.[name],
              ),
          );

        if (method) {
          await this.queueAdapter[
            method
          ](
            payload,
          );
        }
      }
    } catch (error) {
      this.statistics.eventFailures += 1;

      this.log(
        'error',
        'Airtel callback DLQ event publication failed',
        {
          type,
          tenantId,
          correlationId,
          operationId,

          error:
            sanitizeError(
              error,
            ),
        },
      );

      if (
        this.options.failClosedOnEventError
      ) {
        throw error;
      }
    }
  }

  async dispatchRecord(
    record,
  ) {
    this.statistics.dispatchAttempts += 1;

    try {
      const message = {
        type:
          'AIRTEL_CALLBACK_DEAD_LETTER',

        provider:
          PROVIDER,

        operation:
          OPERATION,

        queueName:
          this.options.queueName,

        tenantId:
          record?.tenantId,

        dlqId:
          record?.dlqId,

        callbackId:
          record?.callbackId,

        correlationId:
          record?.correlationId,

        operationId:
          record?.operationId,

        callbackFingerprint:
          record?.callbackFingerprint,

        payload:
          record?.payload,

        context:
          record?.context,
      };

      let result;

      if (
        this.queueAdapter
      ) {
        const method =
          [
            'publish',
            'send',
            'enqueue',
          ].find(
            (name) =>
              isFunction(
                this.queueAdapter?.[name],
              ),
          );

        if (method) {
          result =
            await this.queueAdapter[
              method
            ](
              message,
            );
        }
      }

      if (
        !result &&
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
                this.outboxService?.[name],
              ),
          );

        if (method) {
          result =
            await this.outboxService[
              method
            ](
              message,
            );
        }
      }

      if (!result) {
        throw createQueueError(
          'AIRTEL_DLQ_DISPATCH_UNAVAILABLE',
          'No queue or outbox dispatcher is configured',
          {
            statusCode:
              503,

            retryable:
              true,
          },
        );
      }

      this.statistics.dispatchSuccesses += 1;

      this.incrementMetric(
        'airtel_callback_dlq_dispatch_success_total',
      );

      return result;
    } catch (error) {
      this.statistics.dispatchFailures += 1;

      this.incrementMetric(
        'airtel_callback_dlq_dispatch_failures_total',
      );

      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Health / readiness / diagnostics
  // ---------------------------------------------------------------------------

  async health() {
    const storage =
      await this.safeDependencyHealth(
        this.repository,
      );

    const queue =
      await this.safeDependencyHealth(
        this.queueAdapter,
      );

    const recovery =
      await this.safeDependencyHealth(
        this.recoveryDispatcher,
      );

    const storageConfigured =
      Boolean(
        this.repository ||
          (
            !this.options.requireRepository &&
            this.queueAdapter
          ),
      );

    const status =
      !storageConfigured
        ? 'DOWN'
        : storage.status === 'DOWN'
          ? 'DOWN'
          : 'UP';

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

      queueName:
        this.options.queueName,

      status,

      storage,

      queueAdapter:
        queue,

      recoveryDispatcher:
        recovery,

      tenantAware:
        Boolean(
          this.options.requireTenantId ||
            this.tenantResolver,
        ),

      directFinancialMutation:
        false,

      automaticFinancialRetry:
        false,

      startedAt:
        this.startedAt.toISOString(),

      uptimeMs:
        Date.now() -
        this.startedAt.getTime(),

      statistics:
        this.statisticsSnapshot(),
    };
  }

  async readiness() {
    const health =
      await this.health();

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

  async safeDependencyHealth(
    dependency,
  ) {
    if (!dependency) {
      return {
        status:
          'NOT_CONFIGURED',
      };
    }

    try {
      const method =
        [
          'health',
          'status',
          'readiness',
        ].find(
          (name) =>
            isFunction(
              dependency?.[name],
            ),
        );

      if (!method) {
        return {
          status:
            'AVAILABLE',
        };
      }

      const value =
        await dependency[
          method
        ]();

      return sanitize(
        value,
      );
    } catch (error) {
      return {
        status:
          'DOWN',

        error:
          sanitizeError(
            error,
          ),
      };
    }
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

      queueName:
        this.options.queueName,

      architecture: {
        repository:
          Boolean(
            this.repository,
          ),

        queueAdapter:
          Boolean(
            this.queueAdapter,
          ),

        recoveryDispatcher:
          Boolean(
            this.recoveryDispatcher,
          ),

        outboxService:
          Boolean(
            this.outboxService,
          ),

        auditService:
          Boolean(
            this.auditService,
          ),

        tenantResolver:
          Boolean(
            this.tenantResolver,
          ),

        directProviderHttp:
          false,

        directDatabaseMutation:
          false,

        directLedgerMutation:
          false,

        directBalanceMutation:
          false,

        directWalletMutation:
          false,

        settlementFinality:
          false,

        automaticFinancialRetry:
          false,

        authoritativeFinancialBoundary:
          FINANCIAL_BOUNDARY,
      },

      policy: {
        maxPayloadBytes:
          this.options.maxPayloadBytes,

        maxMetadataBytes:
          this.options.maxMetadataBytes,

        maxAttempts:
          this.options.maxAttempts,

        visibilityTimeoutMs:
          this.options.visibilityTimeoutMs,

        retentionDays:
          this.options.retentionDays,

        requireTenantId:
          this.options.requireTenantId,

        requireRepository:
          this.options.requireRepository,

        publishQueueMessages:
          this.options.publishQueueMessages,
      },

      statuses:
        Object.values(
          DLQ_STATUS,
        ),

      failureClasses:
        Object.values(
          FAILURE_CLASS,
        ),

      dispatchStatuses:
        Object.values(
          DISPATCH_STATUS,
        ),

      statistics:
        this.statisticsSnapshot(),

      runtime: {
        activeFingerprints:
          this.runtime.activeFingerprints.size,

        activeClaims:
          this.runtime.activeClaims.size,

        lastEnqueuedAt:
          this.runtime.lastEnqueuedAt
            ?.toISOString?.() ||
          null,

        lastFailureAt:
          this.runtime.lastFailureAt
            ?.toISOString?.() ||
          null,

        lastFailureCode:
          this.runtime.lastFailureCode,
      },

      uptimeMs:
        Date.now() -
        this.startedAt.getTime(),
    };
  }

  snapshot() {
    return this.diagnostics();
  }

  statisticsSnapshot() {
    return {
      ...this.statistics,
    };
  }

  capabilities() {
    return {
      provider:
        PROVIDER,

      operation:
        OPERATION,

      queue:
        true,

      enqueue:
        true,

      publish:
        true,

      inspection:
        Boolean(
          this.repository,
        ),

      claim:
        Boolean(
          this.repository,
        ),

      requeue:
        Boolean(
          this.repository,
        ),

      resolve:
        Boolean(
          this.repository,
        ),

      discard:
        Boolean(
          this.repository,
        ),

      poison:
        Boolean(
          this.repository,
        ),

      tenantIsolation:
        true,

      duplicateProtection:
        true,

      payloadRedaction:
        true,

      boundedPayload:
        true,

      recoveryDispatch:
        Boolean(
          this.recoveryDispatcher ||
            this.outboxService ||
            this.queueAdapter,
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

      automaticFinancialRetry:
        false,

      authoritativeFinancialBoundary:
        FINANCIAL_BOUNDARY,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal concurrency/utility helpers
  // ---------------------------------------------------------------------------

  assertLocalFingerprintCapacity({
    tenantId,
    fingerprint,
  }) {
    if (
      !tenantId ||
      !fingerprint
    ) {
      return;
    }

    const key =
      `${tenantId}:${fingerprint}`;

    const current =
      this.runtime.activeFingerprints.get(
        key,
      );

    const timestamp =
      Date.now();

    if (
      current &&
      timestamp - current <
        this.options.lockTtlMs
    ) {
      throw createQueueError(
        'AIRTEL_DLQ_FINGERPRINT_IN_FLIGHT',
        'Equivalent Airtel callback DLQ insertion is already in progress',
        {
          statusCode:
            409,

          retryable:
            true,

          tenantId,
        },
      );
    }

    this.runtime.activeFingerprints.set(
      key,
      timestamp,
    );
  }

  releaseLocalFingerprintCapacity({
    tenantId,
    fingerprint,
  }) {
    if (
      !tenantId ||
      !fingerprint
    ) {
      return;
    }

    this.runtime.activeFingerprints.delete(
      `${tenantId}:${fingerprint}`,
    );
  }

  incrementMetric(
    name,
    value = 1,
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

      if (method) {
        this.metrics[
          method
        ](
          name,
          value,
        );
      }
    } catch {
      // Observability must not affect DLQ correctness.
    }
  }

  startSpan(
    name,
    context = {},
  ) {
    try {
      if (
        !isFunction(
          this.tracer?.startSpan,
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
              context.tenantId ||
              'unknown',

            'titech.correlation_id':
              context.correlationId ||
              'unknown',

            'titech.operation_id':
              context.operationId ||
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

        ...sanitize(
          metadata,
        ),
      });
    } catch {
      // Logging must never change DLQ behavior.
    }
  }

  hashTenant(
    tenantId,
  ) {
    return sha256(
      String(
        tenantId,
      ),
    );
  }

  retentionDate() {
    return new Date(
      now(
        this.clock,
      ).getTime() +
      this.options.retentionDays *
        86400000,
    );
  }
}

export function createAirtelCallbackDeadLetterQueue(
  options = {},
) {
  return new AirtelCallbackDeadLetterQueue(
    options,
  );
}

export function createCallbackDeadLetterQueue(
  options = {},
) {
  return new AirtelCallbackDeadLetterQueue(
    options,
  );
}

export {
  AirtelCallbackDeadLetterQueue,
  PROVIDER,
  OPERATION,
  COMPONENT,
  ENGINE_NAME,
  ENGINE_VERSION,
  SCHEMA_VERSION,
  QUEUE_NAME,
  DLQ_STATUS,
  FAILURE_CLASS,
  DISPATCH_STATUS,
  DEFAULTS,
  sanitize,
  sanitizeError,
  inferFailureClass,
};

export const CONSTANTS = Object.freeze({
  PROVIDER,
  OPERATION,
  COMPONENT,
  ENGINE_NAME,
  ENGINE_VERSION,
  SCHEMA_VERSION,
  QUEUE_NAME,
  DLQ_STATUS,
  FAILURE_CLASS,
  DISPATCH_STATUS,
  FINANCIAL_BOUNDARY,
});

export default AirtelCallbackDeadLetterQueue;