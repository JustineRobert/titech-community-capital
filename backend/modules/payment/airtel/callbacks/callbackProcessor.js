/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Callback Processor
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/callbacks/callbackProcessor.js
 *
 * Architectural role
 * ------------------
 * Canonical application processor for authenticated and validated Airtel
 * callback events. This module consumes the normalized callback contract,
 * consumes correlation intelligence, applies the callback lifecycle state
 * transition through injected boundaries, and delegates any consequential
 * financial operation to the authoritative TITech Financial Core.
 *
 * Canonical processing chain
 * --------------------------
 * Airtel HTTP callback
 *   -> callbackController
 *   -> signatureVerifier / callbackValidator
 *   -> callbackNormalizer
 *   -> callbackCorrelation
 *   -> callbackDispatcher
 *   -> THIS PROCESSOR
 *   -> payment state / financial core / reconciliation / notifications
 *
 * Responsibilities
 * ----------------
 * - Enforce trusted tenant and security context.
 * - Normalize or validate the canonical callback contract.
 * - Reuse a supplied correlation result; otherwise invoke the correlation
 *   boundary rather than performing ad-hoc database lookup.
 * - Route MATCHED / PENDING / REVIEW / UNKNOWN / DUPLICATE callbacks.
 * - Protect callback processing with authoritative duplicate/idempotency hooks.
 * - Transition the callback lifecycle with compare-and-set repository methods
 *   where provided.
 * - Delegate financial posting through Financial Core / FinancialTransaction-
 *   Service / LedgerBridge adapters without owning accounting logic.
 * - Trigger reconciliation after provider evidence or when ambiguity exists.
 * - Confirm settlement only from authoritative financial evidence.
 * - Publish sanitized domain events and notification requests.
 * - Route safe processing failures to the callback dead-letter queue.
 * - Expose reliability, compliance and operations diagnostics.
 *
 * Explicitly NOT responsible for
 * -------------------------------
 * - HTTP transport.
 * - Airtel OAuth or provider API calls.
 * - Callback signature generation or verification.
 * - Raw callback persistence.
 * - Correlation candidate lookup implementation.
 * - KYC / AML / sanctions source-of-truth decisions.
 * - Fraud source-of-truth decisions.
 * - Direct Mongo/Mongoose writes.
 * - Direct ledger/journal implementation.
 * - Direct balance or wallet mutation.
 * - Settlement finality without authoritative Financial Core evidence.
 * - Blind retries of ambiguous money movement.
 *
 * Financial safety principles
 * ---------------------------
 * 1. Signature/security verification must happen before this module is called.
 * 2. A trusted tenant is mandatory by default and is never inferred from the
 *    callback payload.
 * 3. Correlation status is not settlement status.
 * 4. Provider acceptance/pending is not accounting settlement.
 * 5. Only a successful provider callback with an authoritative correlation can
 *    reach the financial boundary.
 * 6. Ambiguous/unknown/review callbacks are reconciliation/review work only.
 * 7. Duplicate callbacks never create another financial posting.
 * 8. Financial Core failures do not get converted to successful callbacks.
 * 9. Historical financial records are not rewritten by this module.
 * 10. Raw payloads, credentials, signatures and secrets are never persisted by
 *     the processor's audit/event/logging surfaces.
 *
 * Module format
 * -------------
 * Native ESM. External framework dependencies are intentionally avoided.
 * =============================================================================
 */

import crypto from 'node:crypto';

export const PROVIDER = 'AIRTEL';
export const OPERATION = 'CALLBACK';
export const COMPONENT = 'titech.airtel.callbacks.processor';
export const ENGINE_NAME = 'airtel-callback-processor';
export const ENGINE_VERSION = '5.0.0';
export const SCHEMA_VERSION = 5;
export const FINANCIAL_BOUNDARY = 'TITECH_FINANCIAL_CORE';

export const CALLBACK_STATUS = Object.freeze({
  RECEIVED: 'RECEIVED',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  PENDING: 'PENDING',
  REVIEW: 'REVIEW',
  RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
  DUPLICATE: 'DUPLICATE',
  FAILED: 'FAILED',
  DEAD_LETTER: 'DEAD_LETTER',
});

export const PAYMENT_STATUS = Object.freeze({
  SUCCESS: 'SUCCESS',
  PENDING: 'PENDING',
  FAILED: 'FAILED',
  REVIEW: 'REVIEW',
  RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
  DUPLICATE: 'DUPLICATE',
});

export const ROUTES = Object.freeze({
  PROCESS_PAYMENT: 'PROCESS_PAYMENT',
  MANUAL_REVIEW: 'MANUAL_REVIEW',
  FRAUD_REVIEW: 'FRAUD_REVIEW',
  UNKNOWN_QUEUE: 'UNKNOWN_QUEUE',
  FAILED_QUEUE: 'FAILED_QUEUE',
});

export const PROVIDER_OUTCOMES = Object.freeze({
  SUCCESS: 'SUCCESS',
  PENDING: 'PENDING',
  FAILURE: 'FAILURE',
  UNKNOWN: 'UNKNOWN',
});

export const DEFAULTS = Object.freeze({
  requireTenantId: true,
  requireSecurityVerification: true,
  requireCorrelation: true,
  requireCallbackIdentity: true,
  requireProviderReferenceForSuccess: true,
  maxPayloadBytes: 1024 * 1024,
  maxMetadataBytes: 64 * 1024,
  processingTimeoutMs: 20_000,
  maxRetries: 1,
  retryBackoffMs: 150,
  maxConcurrentCallbacks: 250,
  localLockTtlMs: 30_000,
  failClosedOnLifecyclePersistenceError: true,
  failClosedOnFinancialBoundaryError: true,
  failClosedOnReconciliationError: true,
  failClosedOnSettlementVerificationError: true,
  failClosedOnDlqError: false,
  publishEvents: true,
  audit: true,
  failClosedOnAuditError: false,
  failClosedOnEventError: false,
  allowLegacyLedgerBridge: true,
  allowLegacyPaymentRepositoryMutation: false,
  callbackSLA: 5_000,
  terminalCallbackOutcomes: Object.freeze([
    PROVIDER_OUTCOMES.SUCCESS,
    PROVIDER_OUTCOMES.FAILURE,
  ]),
});

const SENSITIVE_KEY = /authorization|proxy.?authorization|cookie|set-cookie|secret|password|token|signature|private.?key|api.?key|credential|otp|pin|cvv|cvc|pan/i;
const RAW_KEY = /^raw|request.?body|response.?body|webhook.?body/i;
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

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

function now(clock) {
  const value = isFunction(clock?.now) ? clock.now() : Date.now();
  return new Date(value);
}

function id() {
  return crypto.randomUUID();
}

function string(value, max = 1024) {
  if (value === undefined || value === null) return null;
  const output = String(value).trim();
  return output ? output.slice(0, max) : null;
}

function upper(value) {
  const output = string(value, 128);
  return output ? output.toUpperCase() : null;
}

function firstFunction(target, names = []) {
  return names.find((name) => isFunction(target?.[name])) || null;
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

function safeClone(value, depth = 0) {
  if (depth > 8) return '[DEPTH_LIMIT]';
  if (value === undefined || value === null) return value;
  if (Buffer.isBuffer(value)) return '[BUFFER_REDACTED]';
  if (value instanceof Date) return value.toISOString();

  if (typeof value !== 'object') {
    return typeof value === 'bigint'
      ? String(value)
      : value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 250)
      .map((item) => safeClone(item, depth + 1));
  }

  const output = {};

  for (const [key, child] of Object.entries(value)) {
    if (BLOCKED_KEYS.has(key)) continue;

    if (SENSITIVE_KEY.test(key)) {
      output[key] = '[REDACTED]';
      continue;
    }

    if (RAW_KEY.test(key)) {
      output[key] = '[OMITTED]';
      continue;
    }

    output[key] = safeClone(
      child,
      depth + 1,
    );
  }

  return output;
}

function canonicalize(value, depth = 0) {
  if (depth > 10) return '[DEPTH_LIMIT]';

  if (
    value === undefined ||
    value === null
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return `[BUFFER:${hash(value)}]`;
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
      (output, key) => {
        if (
          BLOCKED_KEYS.has(key)
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

function hash(value) {
  const input = Buffer.isBuffer(value)
    ? value
    : typeof value === 'string'
      ? value
      : JSON.stringify(
          canonicalize(value),
        );

  return crypto
    .createHash('sha256')
    .update(input)
    .digest('hex');
}

function payloadSize(value) {
  try {
    return Buffer.byteLength(
      JSON.stringify(
        canonicalize(value),
      ),
      'utf8',
    );
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function callbackFingerprint(
  callback,
  tenantId = null,
) {
  return hash({
    provider: PROVIDER,
    operation: OPERATION,
    tenantId:
      tenantId || null,
    callbackId:
      string(
        callback?.callbackId ||
          callback?.id,
        256,
      ),
    providerTransactionId:
      string(
        callback?.providerTransactionId ||
          callback?.providerReference,
        256,
      ),
    paymentReference:
      string(
        callback?.paymentReference,
        256,
      ),
    transactionReference:
      string(
        callback?.transactionReference,
        256,
      ),
    amountMinor:
      callback?.amountMinor ??
      null,
    amount:
      callback?.amount ??
      null,
    currency:
      upper(callback?.currency),
    status:
      upper(callback?.status),
    outcome:
      upper(
        callback?.outcome ||
          callback?.providerOutcome,
      ),
    payloadFingerprint:
      callback?.payloadFingerprint ||
      null,
  });
}

function normalizeProviderOutcome(
  callback,
) {
  const outcome =
    upper(
      callback?.outcome ||
      callback?.providerOutcome,
    );

  if (
    Object.values(
      PROVIDER_OUTCOMES,
    ).includes(outcome)
  ) {
    return outcome;
  }

  const status =
    upper(callback?.status);

  if (
    [
      'SUCCESS',
      'SUCCESSFUL',
      'COMPLETED',
      'COMPLETE',
      'PAID',
      'CONFIRMED',
      'SETTLED',
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
      'SUBMITTED',
    ].includes(status)
  ) {
    return PROVIDER_OUTCOMES.PENDING;
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
    ].includes(status)
  ) {
    return PROVIDER_OUTCOMES.FAILURE;
  }

  return PROVIDER_OUTCOMES.UNKNOWN;
}

function normalizeError(
  error,
  context = {},
) {
  if (
    error instanceof AirtelCallbackProcessorError
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

    return error;
  }

  return new AirtelCallbackProcessorError(
    error?.message ||
      'Airtel callback processing failed.',
    {
      code:
        error?.code ||
        'AIRTEL_CALLBACK_PROCESSING_FAILED',

      statusCode:
        Number(
          error?.statusCode ||
          error?.status,
        ) || 500,

      retryable:
        Boolean(
          error?.retryable,
        ),

      uncertain:
        Boolean(
          error?.uncertain,
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

function isRetryable(error) {
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
    String(
      error.code || '',
    ).toUpperCase(),
  );
}

function sanitizeError(error) {
  if (!error) return null;

  return {
    name:
      string(
        error.name,
        128,
      ),

    code:
      string(
        error.code,
        256,
      ),

    message:
      string(
        error.message,
        2000,
      ),

    statusCode:
      Number(
        error.statusCode ||
          500,
      ),

    retryable:
      Boolean(
        error.retryable,
      ),

    uncertain:
      Boolean(
        error.uncertain,
      ),
  };
}

function outcomeStatus(
  outcome,
) {
  switch (outcome) {
    case PROVIDER_OUTCOMES
      .SUCCESS:
      return CALLBACK_STATUS
        .COMPLETED;

    case PROVIDER_OUTCOMES
      .PENDING:
      return CALLBACK_STATUS
        .PENDING;

    case PROVIDER_OUTCOMES
      .FAILURE:
      return CALLBACK_STATUS
        .FAILED;

    default:
      return CALLBACK_STATUS
        .RECONCILIATION_REQUIRED;
  }
}

function isFinanciallySuccessfulResult(
  result,
) {
  return Boolean(
    result?.financialEvidence
      ?.settlementConfirmed ===
      true ||
    result?.financialEvidence
      ?.financialTransactionCommitted ===
      true ||
    result?.financialSettlement
      ?.confirmed ===
      true,
  );
}

function isAuthoritativeDuplicate(
  record,
) {
  if (!record) return false;
  if (record === true) return true;

  const status =
    upper(
      record.status ||
      record.state ||
      record.lifecycleStatus,
    );

  if (
    [
      'PROCESSED',
      'COMPLETED',
      'SUCCESS',
      'COMMITTED',
      'ACCEPTED',
      'SETTLED',
      'CONFIRMED',
      'FINALIZED',
    ].includes(status)
  ) {
    return true;
  }

  if (
    record.processed === true ||
    record.processedAt
  ) {
    return true;
  }

  return false;
}

function extractEntityId(
  entity,
) {
  return string(
    getValue(
      entity,
      [
        'id',
        '_id',
        'uuid',
        'paymentId',
        'collectionId',
        'transactionId',
      ],
    ),
    256,
  );
}

function extractCorrelationEntity(
  correlation,
) {
  return (
    correlation?.entity ||
    correlation?.payment ||
    correlation?.collection ||
    correlation?.transaction ||
    null
  );
}

function providerReferenceFrom(
  callback,
) {
  return string(
    callback?.providerTransactionId ||
    callback?.providerReference ||
    callback?.airtelTransactionId ||
    callback?.transactionId,
    256,
  );
}

function transactionReferenceFrom(
  callback,
) {
  return string(
    callback?.transactionReference ||
    callback?.reference,
    256,
  );
}

export class AirtelCallbackProcessorError
  extends Error
{
  constructor(
    message,
    options = {},
  ) {
    super(message);

    this.name =
      'AirtelCallbackProcessorError';

    this.code =
      options.code ||
      'AIRTEL_CALLBACK_PROCESSING_FAILED';

    this.statusCode =
      Number(
        options.statusCode ||
          500,
      );

    this.retryable =
      Boolean(
        options.retryable,
      );

    this.uncertain =
      Boolean(
        options.uncertain,
      );

    this.securityRejected =
      Boolean(
        options.securityRejected,
      );

    this.tenantId =
      string(
        options.tenantId,
        256,
      );

    this.correlationId =
      string(
        options.correlationId,
        256,
      );

    this.operationId =
      string(
        options.operationId,
        256,
      );

    this.cause =
      options.cause;
  }

  toJSON() {
    return {
      name:
        this.name,

      code:
        this.code,

      message:
        this.message,

      statusCode:
        this.statusCode,

      retryable:
        this.retryable,

      uncertain:
        this.uncertain,

      securityRejected:
        this.securityRejected,

      tenantId:
        this.tenantId,

      correlationId:
        this.correlationId,

      operationId:
        this.operationId,
    };
  }
}

export class CallbackProcessor {
  constructor({
    callbackCorrelation = null,
    callbackNormalizer = null,
    callbackDispatcher = null,
    paymentRepository = null,
    transactionService = null,
    financialCore = null,
    financialTransactionService = null,
    ledgerBridge = null,
    ledgerService = null,
    paymentStateEngine = null,
    reconciliationService = null,
    settlementService = null,
    notificationService = null,
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
    circuitBreaker = null,
    lockManager = null,
    fraudEngine = null,
    amlService = null,
    velocityEngine = null,
    velocityService = null,
    policyEngine = null,
    limitService = null,
    approvalWorkflow = null,
    securityVerifier = null,
    configuration = {},
    clock = Date,
  } = {}) {
    this.callbackCorrelation =
      callbackCorrelation;

    this.callbackNormalizer =
      callbackNormalizer;

    this.callbackDispatcher =
      callbackDispatcher;

    this.paymentRepository =
      paymentRepository;

    this.transactionService =
      transactionService;

    this.financialCore =
      financialCore;

    this.financialTransactionService =
      financialTransactionService;

    this.ledgerBridge =
      ledgerBridge;

    this.ledgerService =
      ledgerService;

    this.paymentStateEngine =
      paymentStateEngine;

    this.reconciliationService =
      reconciliationService;

    this.settlementService =
      settlementService;

    this.notificationService =
      notificationService;

    this.callbackRepository =
      callbackRepository;

    this.idempotencyManager =
      idempotencyManager;

    this.deadLetterQueue =
      deadLetterQueue;

    this.recoveryService =
      recoveryService;

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
      console;

    this.circuitBreaker =
      circuitBreaker;

    this.lockManager =
      lockManager;

    this.fraudEngine =
      fraudEngine;

    this.amlService =
      amlService;

    this.velocityEngine =
      velocityEngine;

    this.velocityService =
      velocityService;

    this.policyEngine =
      policyEngine;

    this.limitService =
      limitService;

    this.approvalWorkflow =
      approvalWorkflow;

    this.securityVerifier =
      securityVerifier;

    this.configuration =
      configuration ||
      {};

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

      stopping:
        false,

      startedAt:
        now(this.clock),

      activeCallbacks:
        new Map(),

      activeFingerprints:
        new Map(),

      incidents:
        [],

      lastCompletedAt:
        null,

      lastFailureAt:
        null,

      lastFailureCode:
        null,
    };

    this.statistics = {
      received:
        0,

      processed:
        0,

      pending:
        0,

      reviewed:
        0,

      reconciliations:
        0,

      settlements:
        0,

      ledgerUpdates:
        0,

      duplicates:
        0,

      failed:
        0,

      deadLettered:
        0,

      securityRejected:
        0,

      unknownCallbacks:
        0,

      lifecycleUpdates:
        0,

      financialOperations:
        0,

      financialFailures:
        0,

      notificationEvents:
        0,

      handlerRetries:
        0,

      handlerTimeouts:
        0,

      callbackLockConflicts:
        0,

      idempotencyConflicts:
        0,

      auditFailures:
        0,

      eventFailures:
        0,

      repositoryFailures:
        0,

      tenantFailures:
        0,

      fraudReviews:
        0,

      amlReviews:
        0,

      velocityReviews:
        0,

      policyReviews:
        0,

      approvalReviews:
        0,

      slaBreaches:
        0,

      startedAt:
        now(this.clock),
    };

    this.initializationPromise =
      null;
  }

  // ---------------------------------------------------------------------------
  // Initialization / lifecycle
  // ---------------------------------------------------------------------------

  async initialize() {
    if (
      this.runtime.initialized &&
      !this.runtime.stopping
    ) {
      return this;
    }

    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise =
      Promise
        .resolve()
        .then(async () => {
          const diagnostics =
            this.dependencyDiagnostics();

          if (
            diagnostics.errors.length
          ) {
            this.runtime.initialized =
              false;

            throw new AirtelCallbackProcessorError(
              'Airtel callback processor dependencies are incomplete.',
              {
                code:
                  'AIRTEL_CALLBACK_PROCESSOR_DEPENDENCY_FAILURE',

                statusCode:
                  503,

                retryable:
                  true,
              },
            );
          }

          this.runtime.stopping =
            false;

          this.runtime.initialized =
            true;

          await this.safeAudit(
            'AIRTEL_CALLBACK_PROCESSOR_INITIALIZED',
            {
              correlationId:
                id(),

              operationId:
                id(),
            },
            {
              version:
                ENGINE_VERSION,
            },
          );

          return this;
        })
        .finally(() => {
          this.initializationPromise =
            null;
        });

    return this.initializationPromise;
  }

  async shutdown({
    timeout = 30_000,
  } = {}) {
    this.runtime.stopping =
      true;

    const startedAt =
      Date.now();

    while (
      this.runtime.activeCallbacks
        .size > 0 &&
      Date.now() -
        startedAt <
        Number(timeout)
    ) {
      await this.sleep(
        100,
      );
    }

    this.runtime.activeCallbacks
      .clear();

    this.runtime.activeFingerprints
      .clear();

    this.runtime.initialized =
      false;

    await this.safeAudit(
      'AIRTEL_CALLBACK_PROCESSOR_SHUTDOWN',
      {
        correlationId:
          id(),

        operationId:
          id(),
      },
    );

    return true;
  }

  // ---------------------------------------------------------------------------
  // Canonical entry points
  // ---------------------------------------------------------------------------

  async processCallback({
    callback,
    context,
    correlation = null,
    session = null,
  } = {}) {
    return this.process({
      tenantId:
        context?.tenantId,

      callback,

      context,

      correlation,

      correlationId:
        context?.correlationId ||
        id(),

      operationId:
        context?.operationId ||
        id(),

      requestId:
        context?.requestId ||
        null,

      session,
    });
  }

  async process({
    tenantId,
    callback,
    context = {},
    correlation = null,
    correlationId = id(),
    operationId = id(),
    requestId = null,
    session = null,
  } = {}) {
    await this.assertReady();

    const startedAt =
      Date.now();

    const trustedContext =
      await this.buildTrustedContext({
        tenantId,
        context,
        correlationId,
        operationId,
        requestId,
      });

    const span =
      this.startSpan(
        'airtel.callback.process',
        trustedContext,
      );

    let fingerprint =
      null;

    let callbackLockAcquired =
      false;

    this.statistics.received +=
      1;

    try {
      const canonicalCallback =
        await this.normalizeAndValidateCallback({
          callback,
          context:
            trustedContext,
        });

      fingerprint =
        callbackFingerprint(
          canonicalCallback,
          trustedContext.tenantId,
        );

      trustedContext.callbackId =
        trustedContext.callbackId ||
        canonicalCallback.callbackId;

      trustedContext.callbackFingerprint =
        fingerprint;

      this.acquireCallbackLock({
        tenantId:
          trustedContext.tenantId,

        fingerprint,

        correlationId:
          trustedContext.correlationId,
      });

      callbackLockAcquired =
        true;

      const duplicate =
        await this.checkDuplicate({
          tenantId:
            trustedContext.tenantId,

          callback:
            canonicalCallback,

          callbackFingerprint:
            fingerprint,

          context:
            trustedContext,

          session,
        });

      if (duplicate.found) {
        this.statistics.duplicates +=
          1;

        const result =
          this.buildResult({
            context:
              trustedContext,

            callback:
              canonicalCallback,

            fingerprint,

            status:
              CALLBACK_STATUS.DUPLICATE,

            outcome:
              PROVIDER_OUTCOMES.SUCCESS,

            route:
              ROUTES.UNKNOWN_QUEUE,

            duplicate:
              true,

            durationMs:
              Date.now() -
              startedAt,

            duplicateRecord:
              duplicate.record,
          });

        await this.completeLifecycleSafe({
          context:
            trustedContext,

          callback:
            canonicalCallback,

          fingerprint,

          status:
            CALLBACK_STATUS.DUPLICATE,

          session,
        });

        await this.safeAudit(
          'AIRTEL_CALLBACK_DUPLICATE',
          trustedContext,
          this.auditMetadata(
            result,
          ),
        );

        return result;
      }

      await this.markProcessing({
        tenantId:
          trustedContext.tenantId,

        callback:
          canonicalCallback,

        fingerprint,

        context:
          trustedContext,

        session,
      });

      const resolvedCorrelation =
        await this.resolveCorrelation({
          callback:
            canonicalCallback,

          context:
            trustedContext,

          correlation,
        });

      const routeDecision =
        await this.resolveRouteDecision({
          callback:
            canonicalCallback,

          context:
            trustedContext,

          correlation:
            resolvedCorrelation,
        });

      let result;

      switch (
        routeDecision.route
      ) {
        case ROUTES.PROCESS_PAYMENT:
          result =
            await this.processSuccessfulCallback({
              callback:
                canonicalCallback,

              context:
                trustedContext,

              correlation:
                resolvedCorrelation,

              session,
            });

          break;

        case ROUTES.MANUAL_REVIEW:
          result =
            await this.routeManualReview({
              callback:
                canonicalCallback,

              context:
                trustedContext,

              correlation:
                resolvedCorrelation,

              reason:
                routeDecision.reason,

              session,
            });

          break;

        case ROUTES.FRAUD_REVIEW:
          result =
            await this.routeFraudReview({
              callback:
                canonicalCallback,

              context:
                trustedContext,

              correlation:
                resolvedCorrelation,

              reason:
                routeDecision.reason,

              session,
            });

          break;

        case ROUTES.UNKNOWN_QUEUE:
        default:
          result =
            await this.handleUnknownCallback({
              callback:
                canonicalCallback,

              context:
                trustedContext,

              correlation:
                resolvedCorrelation,

              session,
            });

          break;
      }

      const completed =
        await this.completeProcessing({
          callback:
            canonicalCallback,

          context:
            trustedContext,

          result,

          session,
        });

      this.runtime.lastCompletedAt =
        now(this.clock);

      this.statistics.processed +=
        1;

      this.recordSLA({
        duration:
          Date.now() -
          startedAt,

        context:
          trustedContext,
      });

      return completed;
    } catch (error) {
      this.statistics.failed +=
        1;

      this.runtime.lastFailureAt =
        now(this.clock);

      this.runtime.lastFailureCode =
        error?.code ||
        'AIRTEL_CALLBACK_PROCESSING_FAILED';

      const normalizedError =
        normalizeError(
          error,
          trustedContext,
        );

      await this.handleProcessingFailure({
        callback,
        context:
          trustedContext,

        callbackFingerprint:
          fingerprint,

        error:
          normalizedError,

        session,
      });

      throw normalizedError;
    } finally {
      if (
        fingerprint &&
        callbackLockAcquired
      ) {
        this.releaseCallbackLock({
          tenantId:
            trustedContext.tenantId,

          fingerprint,
        });
      }

      span?.end?.();
    }
  }

  // ---------------------------------------------------------------------------
  // Validation / context
  // ---------------------------------------------------------------------------

  async buildTrustedContext({
    tenantId,
    context = {},
    correlationId,
    operationId,
    requestId,
  }) {
    const resolvedTenantId =
      string(
        tenantId ||
          context?.tenantId ||
          context?.trustedTenantId ||
          context?.tenant?.id,
        256,
      );

    if (
      !resolvedTenantId &&
      this.options.requireTenantId
    ) {
      this.statistics.tenantFailures +=
        1;

      throw new AirtelCallbackProcessorError(
        'Trusted tenant context is required for Airtel callback processing.',
        {
          code:
            'AIRTEL_CALLBACK_TENANT_REQUIRED',

          statusCode:
            403,

          retryable:
            false,
        },
      );
    }

    if (
      this.options
        .requireSecurityVerification
    ) {
      const trusted =
        Boolean(
          context?.trustedCallback ===
            true ||
          context?.securityVerified ===
            true ||
          context?.signatureVerified ===
            true,
        );

      if (!trusted) {
        this.statistics.securityRejected +=
          1;

        throw new AirtelCallbackProcessorError(
          'Airtel callback security verification is required before processing.',
          {
            code:
              'AIRTEL_CALLBACK_SECURITY_VERIFICATION_REQUIRED',

            statusCode:
              401,

            retryable:
              false,

            securityRejected:
              true,
          },
        );
      }
    }

    return {
      provider:
        PROVIDER,

      operation:
        OPERATION,

      tenantId:
        resolvedTenantId,

      correlationId:
        string(
          correlationId,
          256,
        ) ||
        id(),

      operationId:
        string(
          operationId,
          256,
        ) ||
        id(),

      requestId:
        string(
          requestId,
          256,
        ),

      callbackId:
        string(
          context?.callbackId,
          256,
        ),

      actorId:
        string(
          context?.actorId ||
            context?.actor?.id ||
            context?.actor?.actorId,
          256,
        ) ||
        'SYSTEM:AIRTEL_CALLBACK',

      actorType:
        upper(
          context?.actorType ||
            context?.actor?.actorType,
        ) ||
        'SYSTEM',

      trustedCallback:
        Boolean(
          context?.trustedCallback ===
            true,
        ),

      securityVerified:
        Boolean(
          context?.securityVerified ===
            true,
        ),

      signatureVerified:
        Boolean(
          context?.signatureVerified ===
            true,
        ),

      authenticated:
        Boolean(
          context?.authenticated ===
            true,
        ),
    };
  }

  validateInput({
    callback,
    correlation,
    context,
  }) {
    if (!callback) {
      throw new AirtelCallbackProcessorError(
        'Airtel callback payload is required.',
        {
          code:
            'AIRTEL_CALLBACK_PAYLOAD_REQUIRED',

          statusCode:
            400,
        },
      );
    }

    if (
      this.options
        .requireCallbackIdentity &&
      !callback.callbackId &&
      !callback.providerTransactionId &&
      !callback.providerReference &&
      !callback.transactionId
    ) {
      throw new AirtelCallbackProcessorError(
        'Airtel callback identity is required.',
        {
          code:
            'AIRTEL_CALLBACK_IDENTITY_REQUIRED',

          statusCode:
            400,
        },
      );
    }

    if (
      this.options.requireCorrelation &&
      !correlation
    ) {
      throw new AirtelCallbackProcessorError(
        'Airtel callback correlation is required.',
        {
          code:
            'AIRTEL_CALLBACK_CORRELATION_REQUIRED',

          statusCode:
            503,

          retryable:
            true,
        },
      );
    }

    if (
      !context?.tenantId &&
      this.options.requireTenantId
    ) {
      throw new AirtelCallbackProcessorError(
        'Airtel callback trusted tenant context is missing.',
        {
          code:
            'AIRTEL_CALLBACK_TENANT_REQUIRED',

          statusCode:
            403,
        },
      );
    }
  }

  async normalizeAndValidateCallback({
    callback,
    context,
  }) {
    let normalized =
      callback;

    if (this.callbackNormalizer) {
      const method =
        firstFunction(
          this.callbackNormalizer,
          [
            'normalize',
            'normalizeCallback',
            'transform',
            'process',
          ],
        );

      if (method) {
        normalized =
          await this.callbackNormalizer[
            method
          ]({
            payload:
              callback,

            callback,

            context,
          });
      }
    }

    if (
      !isPlainObject(
        normalized,
      )
    ) {
      throw new AirtelCallbackProcessorError(
        'Airtel callback normalizer did not return an object.',
        {
          code:
            'AIRTEL_CALLBACK_NORMALIZATION_INVALID_RESULT',

          statusCode:
            400,
        },
      );
    }

    const callbackValue =
      normalized.callback ||
      normalized;

    const callbackResult = {
      ...callbackValue,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      callbackId:
        string(
          callbackValue.callbackId ||
            callbackValue.id,
          256,
        ),

      providerTransactionId:
        string(
          callbackValue.providerTransactionId ||
            callbackValue.providerReference ||
            callbackValue.transactionId,
          256,
        ),

      paymentReference:
        string(
          callbackValue.paymentReference,
          256,
        ),

      transactionReference:
        string(
          callbackValue.transactionReference ||
            callbackValue.reference,
          256,
        ),

      status:
        upper(
          callbackValue.status,
        ) ||
        'UNKNOWN',

      outcome:
        normalizeProviderOutcome(
          callbackValue,
        ),

      providerOutcome:
        normalizeProviderOutcome(
          callbackValue,
        ),

      tenantId:
        context.tenantId,

      normalizedAt:
        callbackValue.normalizedAt ||
        now(
          this.clock,
        ).toISOString(),
    };

    if (
      this.options
        .requireProviderReferenceForSuccess &&
      callbackResult.outcome ===
        PROVIDER_OUTCOMES.SUCCESS &&
      !callbackResult.providerTransactionId
    ) {
      throw new AirtelCallbackProcessorError(
        'Successful Airtel callback is missing its provider transaction identity.',
        {
          code:
            'AIRTEL_CALLBACK_PROVIDER_REFERENCE_REQUIRED',

          statusCode:
            400,
        },
      );
    }

    if (
      payloadSize(
        callbackResult,
      ) >
      Number(
        this.options.maxPayloadBytes,
      )
    ) {
      throw new AirtelCallbackProcessorError(
        'Airtel callback exceeds the processor payload limit.',
        {
          code:
            'AIRTEL_CALLBACK_PAYLOAD_TOO_LARGE',

          statusCode:
            413,
        },
      );
    }

    return Object.freeze(
      callbackResult,
    );
  }

  // ---------------------------------------------------------------------------
  // Correlation / routing
  // ---------------------------------------------------------------------------

  async resolveCorrelation({
    callback,
    context,
    correlation,
  }) {
    if (correlation) {
      return correlation;
    }

    if (!this.callbackCorrelation) {
      throw new AirtelCallbackProcessorError(
        'Airtel callback correlation boundary is not configured.',
        {
          code:
            'AIRTEL_CALLBACK_CORRELATION_UNAVAILABLE',

          statusCode:
            503,

          retryable:
            true,
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
      throw new AirtelCallbackProcessorError(
        'Airtel callback correlation boundary exposes no supported method.',
        {
          code:
            'AIRTEL_CALLBACK_CORRELATION_CONTRACT_INVALID',

          statusCode:
            503,

          retryable:
            true,
        },
      );
    }

    return this.callbackCorrelation[
      method
    ]({
      callback,
      context,
      tenantId:
        context.tenantId,
      correlationId:
        context.correlationId,
      operationId:
        context.operationId,
    });
  }

  async resolveRouteDecision({
    callback,
    context,
    correlation,
  }) {
    if (!correlation) {
      return {
        route:
          ROUTES.UNKNOWN_QUEUE,

        reason:
          'NO_CORRELATION_RESULT',
      };
    }

    let enrichedCorrelation =
      correlation;

    if (
      this.callbackCorrelation &&
      isFunction(
        this.callbackCorrelation
          .executeCorrelationIntelligence,
      ) &&
      !correlation.intelligence
    ) {
      const intelligence =
        await this.callbackCorrelation
          .executeCorrelationIntelligence({
            callback,
            context,
            correlationResult:
              correlation,
          });

      enrichedCorrelation = {
        ...correlation,
        intelligence,
      };
    }

    const fraudSignals =
      enrichedCorrelation
        .intelligence
        ?.signals ||
      enrichedCorrelation
        .fraudSignals ||
      [];

    let route;

    if (
      this.callbackCorrelation &&
      isFunction(
        this.callbackCorrelation
          .determineCallbackRoute,
      )
    ) {
      route =
        this.callbackCorrelation
          .determineCallbackRoute({
            ...enrichedCorrelation,
            fraudSignals,
          });
    }

    const status =
      upper(
        enrichedCorrelation.status,
      );

    const providerOutcome =
      normalizeProviderOutcome(
        callback,
      );

    if (!route) {
      if (
        status === 'DUPLICATE'
      ) {
        route =
          ROUTES.UNKNOWN_QUEUE;
      } else if (
        status === 'MATCHED' &&
        providerOutcome ===
          PROVIDER_OUTCOMES.SUCCESS &&
        Number(
          enrichedCorrelation.confidence ||
            0,
        ) >= 90
      ) {
        route =
          ROUTES.PROCESS_PAYMENT;
      } else if (
        status === 'REVIEW' ||
        status === 'PARTIAL' ||
        status ===
          'RECONCILIATION_REQUIRED'
      ) {
        route =
          ROUTES.MANUAL_REVIEW;
      } else {
        route =
          ROUTES.UNKNOWN_QUEUE;
      }
    }

    let reason =
      'CORRELATION_ROUTE';

    if (
      enrichedCorrelation.status ===
      'REVIEW'
    ) {
      reason =
        'CORRELATION_REVIEW';
    }

    if (
      enrichedCorrelation.status ===
      'UNKNOWN'
    ) {
      reason =
        'CORRELATION_UNKNOWN';
    }

    if (
      enrichedCorrelation.conflict
    ) {
      reason =
        'CONFLICTING_CORRELATION_CANDIDATES';
    }

    if (
      fraudSignals.some(
        (signal) =>
          String(
            signal,
          ).includes('FRAUD') ||
          String(
            signal,
          ).includes('AML') ||
          String(
            signal,
          ).includes('SANCTIONS'),
      )
    ) {
      route =
        ROUTES.FRAUD_REVIEW;

      reason =
        'FRAUD_OR_COMPLIANCE_SIGNAL';
    }

    return {
      route,
      reason,
      correlation:
        enrichedCorrelation,
    };
  }

  // ---------------------------------------------------------------------------
  // Duplicate and lifecycle control
  // ---------------------------------------------------------------------------

  async checkDuplicate({
    tenantId,
    callback,
    callbackFingerprint,
    context,
    session,
  }) {
    if (this.callbackRepository) {
      const methods = [
        'findByFingerprint',
        'findByCallbackFingerprint',
        'findByCallbackId',
        'findProcessed',
        'existsByFingerprint',
      ];

      for (
        const method of methods
      ) {
        if (
          !isFunction(
            this.callbackRepository[
              method
            ],
          )
        ) {
          continue;
        }

        try {
          const result =
            await this.callbackRepository[
              method
            ]({
              tenantId,
              provider:
                PROVIDER,
              operation:
                OPERATION,

              callbackFingerprint,

              fingerprint:
                callbackFingerprint,

              callbackId:
                callback.callbackId,

              session,
            });

          if (
            method.startsWith(
              'exists',
            ) &&
            result === true
          ) {
            return {
              found:
                true,

              record:
                null,
            };
          }

          if (
            isAuthoritativeDuplicate(
              result,
            )
          ) {
            return {
              found:
                true,

              record:
                result,
            };
          }
        } catch (error) {
          this.statistics.repositoryFailures +=
            1;

          this.log(
            'warn',
            'Airtel callback duplicate repository check failed',
            {
              tenantId,
              correlationId:
                context.correlationId,

              method,

              error:
                sanitizeError(
                  error,
                ),
            },
          );

          if (
            this.options
              .failClosedOnLifecyclePersistenceError
          ) {
            throw new AirtelCallbackProcessorError(
              'Authoritative callback duplicate check failed.',
              {
                code:
                  'AIRTEL_CALLBACK_DUPLICATE_CHECK_FAILED',

                statusCode:
                  503,

                retryable:
                  true,

                cause:
                  error,
              },
            );
          }
        }

        break;
      }
    }

    if (this.idempotencyManager) {
      const method =
        firstFunction(
          this.idempotencyManager,
          [
            'check',
            'exists',
            'find',
            'get',
            'lookup',
          ],
        );

      if (method) {
        try {
          const result =
            await this.idempotencyManager[
              method
            ]({
              tenantId,

              provider:
                PROVIDER,

              operation:
                OPERATION,

              key:
                `AIRTEL_CALLBACK:${callbackFingerprint}`,

              idempotencyKey:
                `AIRTEL_CALLBACK:${callbackFingerprint}`,

              fingerprint:
                callbackFingerprint,

              callbackId:
                callback.callbackId,
            });

          if (
            method === 'exists' &&
            result === true
          ) {
            return {
              found:
                true,

              record:
                null,
            };
          }

          if (
            isAuthoritativeDuplicate(
              result,
            )
          ) {
            return {
              found:
                true,

              record:
                result,
            };
          }

          if (
            result?.duplicate ===
              true ||
            result?.status ===
              'COMMITTED'
          ) {
            return {
              found:
                true,

              record:
                result,
            };
          }
        } catch (error) {
          this.statistics.repositoryFailures +=
            1;

          this.log(
            'warn',
            'Airtel callback idempotency check failed',
            {
              tenantId,

              correlationId:
                context.correlationId,

              error:
                sanitizeError(
                  error,
                ),
            },
          );

          if (
            this.options
              .failClosedOnLifecyclePersistenceError
          ) {
            throw new AirtelCallbackProcessorError(
              'Authoritative callback idempotency check failed.',
              {
                code:
                  'AIRTEL_CALLBACK_IDEMPOTENCY_CHECK_FAILED',

                statusCode:
                  503,

                retryable:
                  true,

                cause:
                  error,
              },
            );
          }
        }
      }
    }

    return {
      found:
        false,

      record:
        null,
    };
  }

  async markProcessing({
    tenantId,
    callback,
    fingerprint,
    context,
    session,
  }) {
    if (!this.callbackRepository) {
      return;
    }

    const update = {
      tenantId,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      callbackId:
        callback.callbackId,

      callbackFingerprint:
        fingerprint,

      status:
        CALLBACK_STATUS.PROCESSING,

      processingStartedAt:
        now(this.clock),

      correlationId:
        context.correlationId,

      operationId:
        context.operationId,

      updatedAt:
        now(this.clock),
    };

    try {
      const method =
        firstFunction(
          this.callbackRepository,
          [
            'markProcessing',
            'transitionToProcessing',
            'updateStatus',
          ],
        );

      if (!method) {
        return;
      }

      const result =
        await this.callbackRepository[
          method
        ]({
          ...update,

          expectedStatuses: [
            CALLBACK_STATUS.RECEIVED,
            CALLBACK_STATUS.FAILED,
            CALLBACK_STATUS.PENDING,
            CALLBACK_STATUS.REVIEW,
            CALLBACK_STATUS.RECONCILIATION_REQUIRED,
          ],

          session,
        });

      this.statistics.lifecycleUpdates +=
        1;

      return result;
    } catch (error) {
      this.statistics.repositoryFailures +=
        1;

      throw new AirtelCallbackProcessorError(
        'Airtel callback lifecycle could not enter PROCESSING state.',
        {
          code:
            'AIRTEL_CALLBACK_PROCESSING_STATE_UPDATE_FAILED',

          statusCode:
            503,

          retryable:
            true,

          cause:
            error,
        },
      );
    }
  }

  async completeLifecycleSafe({
    context,
    callback,
    fingerprint = null,
    status,
    session,
  }) {
    if (!this.callbackRepository) {
      return null;
    }

    const method =
      firstFunction(
        this.callbackRepository,
        [
          'complete',
          'transition',
          'updateStatus',
        ],
      );

    if (!method) {
      return null;
    }

    try {
      return await this.callbackRepository[
        method
      ]({
        tenantId:
          context.tenantId,

        provider:
          PROVIDER,

        operation:
          OPERATION,

        callbackId:
          callback.callbackId,

        callbackFingerprint:
          fingerprint ||
          callbackFingerprint(
            callback,
            context.tenantId,
          ),

        status,

        completedAt:
          now(this.clock),

        correlationId:
          context.correlationId,

        operationId:
          context.operationId,

        session,
      });
    } catch (error) {
      if (
        this.options
          .failClosedOnLifecyclePersistenceError
      ) {
        throw error;
      }

      this.log(
        'warn',
        'Airtel callback lifecycle completion persistence failed',
        {
          tenantId:
            context.tenantId,

          correlationId:
            context.correlationId,

          error:
            sanitizeError(
              error,
            ),
        },
      );

      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Success path
  // ---------------------------------------------------------------------------

  async processSuccessfulCallback({
    callback,
    context,
    correlation,
    session,
  }) {
    const payment =
      extractCorrelationEntity(
        correlation,
      );

    if (!payment) {
      return this.handleUnknownCallback({
        callback,
        context,
        correlation,
        session,
      });
    }

    const paymentId =
      extractEntityId(
        payment,
      );

    if (!paymentId) {
      throw new AirtelCallbackProcessorError(
        'Correlated Airtel payment does not expose a canonical payment identity.',
        {
          code:
            'AIRTEL_CALLBACK_PAYMENT_ID_REQUIRED',

          statusCode:
            409,
        },
      );
    }

    const securityChecks =
      await this.runSecurityControls({
        callback,
        context,
        correlation,
      });

    const requiresSecurityReview =
      securityChecks.some(
        (check) =>
          check?.result?.requiresReview ===
            true ||
          check?.result?.decision ===
            'REVIEW' ||
          check?.result?.status ===
            'REVIEW',
      );

    if (
      requiresSecurityReview
    ) {
      return this.routeManualReview({
        callback,
        context,
        correlation,
        reason:
          'SECURITY_CONTROL_REVIEW_REQUIRED',
        session,
      });
    }

    const updatedPayment =
      await this.transitionPaymentState({
        payment,
        callback,
        context,

        event:
          'PROVIDER_CONFIRMED',

        metadata: {
          providerReference:
            providerReferenceFrom(
              callback,
            ),

          transactionReference:
            transactionReferenceFrom(
              callback,
            ),
        },

        session,
      });

    const financialEvidence =
      await this.applyFinancialEffects({
        callback,
        context,
        payment:
          updatedPayment,
        correlation,
        session,
      });

    const reconciliation =
      await this.triggerSettlementReconciliation({
        callback,
        context,
        payment:
          updatedPayment,
        financialEvidence,
        session,
      });

    const settlement =
      await this.confirmSettlement({
        callback,
        context,
        payment:
          updatedPayment,
        financialEvidence,
        session,
      });

    await this.publishPaymentEvent({
      type:
        'AIRTEL_PAYMENT_COMPLETED',

      context,

      payment:
        updatedPayment,

      financialEvidence,

      settlement,

      result: {
        reconciliation,
      },
    });

    await this.sendNotification({
      type:
        'PAYMENT_COMPLETED',

      context,

      payment:
        updatedPayment,
    });

    return {
      status:
        CALLBACK_STATUS.COMPLETED,

      outcome:
        PROVIDER_OUTCOMES.SUCCESS,

      payment:
        safeClone(
          updatedPayment,
        ),

      paymentId,

      transactionId:
        callback.transactionId ||
        null,

      providerReference:
        providerReferenceFrom(
          callback,
        ),

      correlationId:
        context.correlationId,

      operationId:
        context.operationId,

      financialEvidence:
        safeClone(
          financialEvidence,
        ),

      settlement:
        safeClone(
          settlement,
        ),

      financialSettlement:
        Boolean(
          settlement?.confirmed ===
            true,
        ),

      nextAction:
        settlement?.confirmed ===
          true
          ? 'ACKNOWLEDGE'
          : 'RECONCILIATION_REQUIRED',

      timestamp:
        now(
          this.clock,
        ).toISOString(),
    };
  }

  async transitionPaymentState({
    payment,
    callback,
    context,
    event,
    metadata = {},
    session,
  }) {
    if (!this.paymentStateEngine) {
      return payment;
    }

    const method =
      firstFunction(
        this.paymentStateEngine,
        [
          'transition',
          'apply',
          'transitionPayment',
        ],
      );

    if (!method) {
      throw new AirtelCallbackProcessorError(
        'Airtel payment state engine exposes no supported transition method.',
        {
          code:
            'AIRTEL_PAYMENT_STATE_ENGINE_CONTRACT_INVALID',

          statusCode:
            503,

          retryable:
            true,
        },
      );
    }

    const result =
      await this.paymentStateEngine[
        method
      ]({
        paymentId:
          extractEntityId(
            payment,
          ),

        event,

        tenantId:
          context.tenantId,

        provider:
          PROVIDER,

        callbackId:
          callback.callbackId,

        providerReference:
          providerReferenceFrom(
            callback,
          ),

        correlationId:
          context.correlationId,

        operationId:
          context.operationId,

        metadata:
          safeClone(
            metadata,
          ),

        session,
      });

    return result ||
      payment;
  }

  // ---------------------------------------------------------------------------
  // Financial boundary
  // ---------------------------------------------------------------------------

  async applyFinancialEffects({
    callback,
    context,
    payment,
    correlation,
    session,
  }) {
    this.statistics.financialOperations +=
      1;

    const command = {
      provider:
        PROVIDER,

      operation:
        'COLLECTION',

      tenantId:
        context.tenantId,

      paymentId:
        extractEntityId(
          payment,
        ),

      transactionId:
        callback.transactionId ||
        null,

      providerReference:
        providerReferenceFrom(
          callback,
        ),

      paymentReference:
        callback.paymentReference ||
        null,

      transactionReference:
        transactionReferenceFrom(
          callback,
        ),

      amount:
        payment.amount ??
        callback.amount ??
        null,

      amountMinor:
        payment.amountMinor ??
        callback.amountMinor ??
        null,

      currency:
        payment.currency ||
        callback.currency ||
        'UGX',

      correlationId:
        context.correlationId,

      operationId:
        context.operationId,

      idempotencyKey:
        `AIRTEL_CALLBACK_SETTLEMENT:${callbackFingerprint(
          callback,
          context.tenantId,
        )}`,

      callbackFingerprint:
        callbackFingerprint(
          callback,
          context.tenantId,
        ),

      callback,

      payment:
        safeClone(
          payment,
        ),

      correlation:
        this.safeCorrelation(
          correlation,
        ),

      session,
    };

    try {
      if (this.financialCore) {
        const method =
          firstFunction(
            this.financialCore,
            [
              'processCollectionCallback',
              'applyProviderSettlement',
              'settleCollection',
              'postCollection',
              'commitCollection',
              'executeCollectionSettlement',
            ],
          );

        if (method) {
          const result =
            await this.financialCore[
              method
            ](
              command,
            );

          return this.normalizeFinancialEvidence(
            result,
            command,
            'FINANCIAL_CORE',
          );
        }
      }

      if (
        this.financialTransactionService
      ) {
        const method =
          firstFunction(
            this.financialTransactionService,
            [
              'executeCollectionCallback',
              'executeCollectionSettlement',
              'processCollection',
              'execute',
            ],
          );

        if (method) {
          const result =
            await this.financialTransactionService[
              method
            ](
              command,
            );

          return this.normalizeFinancialEvidence(
            result,
            command,
            'FINANCIAL_TRANSACTION_SERVICE',
          );
        }
      }

      if (
        this.options
          .allowLegacyLedgerBridge &&
        this.ledgerBridge
      ) {
        const method =
          firstFunction(
            this.ledgerBridge,
            [
              'postCollection',
              'postSettlement',
              'applyCollectionSettlement',
            ],
          );

        if (method) {
          const result =
            await this.ledgerBridge[
              method
            ](
              command,
            );

          this.statistics.ledgerUpdates +=
            1;

          return this.normalizeFinancialEvidence(
            result,
            command,
            'LEDGER_BRIDGE',
          );
        }
      }

      if (
        this.options
          .failClosedOnFinancialBoundaryError
      ) {
        throw new AirtelCallbackProcessorError(
          'No authoritative financial processing boundary is configured.',
          {
            code:
              'AIRTEL_FINANCIAL_CORE_UNAVAILABLE',

            statusCode:
              503,

            retryable:
              true,
          },
        );
      }

      return {
        committed:
          false,

        settlementConfirmed:
          false,

        financialTransactionCommitted:
          false,

        authoritative:
          false,

        boundary:
          'NONE',
      };
    } catch (error) {
      this.statistics.financialFailures +=
        1;

      throw normalizeError(
        error,
        context,
      );
    }
  }

  normalizeFinancialEvidence(
    result,
    command,
    boundary,
  ) {
    const safeResult =
      safeClone(
        result ||
          {},
      );

    const settlementConfirmed =
      Boolean(
        safeResult
          ?.settlementConfirmed ===
          true ||
        safeResult
          ?.financialSettlement
          ?.confirmed ===
          true ||
        (
          safeResult?.committed ===
            true &&
          safeResult
            ?.financialTransactionCommitted ===
            true
        ) ||
        safeResult?.status ===
          'SETTLED' ||
        safeResult?.status ===
          'COMPLETED',
      );

    return {
      ...safeResult,

      committed:
        Boolean(
          safeResult?.committed ===
            true ||
          safeResult
            ?.financialTransactionCommitted ===
            true ||
          safeResult?.status ===
            'COMMITTED' ||
          safeResult?.status ===
            'COMPLETED',
        ),

      settlementConfirmed,

      financialTransactionCommitted:
        Boolean(
          safeResult
            ?.financialTransactionCommitted ===
            true ||
          safeResult?.committed ===
            true,
        ),

      authoritative:
        true,

      boundary,

      tenantId:
        command.tenantId,

      paymentId:
        command.paymentId,

      providerReference:
        command.providerReference,

      correlationId:
        command.correlationId,

      operationId:
        command.operationId,
    };
  }

  async postLedgerTransaction({
    callback,
    context,
    payment,
    correlation = null,
    session,
  }) {
    return this.applyFinancialEffects({
      callback,
      context,
      payment,
      correlation,
      session,
    });
  }

  async postLedger({
    tenantId,
    payment,
    callback,
    correlationId,
    session,
  }) {
    return this.applyFinancialEffects({
      tenantId,

      context: {
        tenantId,
        correlationId:
          correlationId ||
          id(),

        operationId:
          id(),
      },

      payment,
      callback,
      session,
    });
  }

  // ---------------------------------------------------------------------------
  // Pending / review / unknown / failure paths
  // ---------------------------------------------------------------------------

  async handleUnknownCallback({
    callback,
    context,
    correlation,
    session,
  }) {
    this.statistics.unknownCallbacks +=
      1;

    const status =
      upper(
        correlation?.status,
      );

    const providerOutcome =
      normalizeProviderOutcome(
        callback,
      );

    const nextStatus =
      status === 'PENDING' ||
      providerOutcome ===
        PROVIDER_OUTCOMES.PENDING
        ? CALLBACK_STATUS.PENDING
        : status === 'REVIEW' ||
            status === 'PARTIAL'
          ? CALLBACK_STATUS.REVIEW
          : CALLBACK_STATUS.RECONCILIATION_REQUIRED;

    if (
      nextStatus ===
      CALLBACK_STATUS.PENDING
    ) {
      this.statistics.pending +=
        1;
    } else if (
      nextStatus ===
      CALLBACK_STATUS.REVIEW
    ) {
      this.statistics.reviewed +=
        1;
    } else {
      this.statistics.reconciliations +=
        1;
    }

    await this.completeLifecycleSafe({
      context,

      callback,

      fingerprint:
        callbackFingerprint(
          callback,
          context.tenantId,
        ),

      status:
        nextStatus,

      session,
    });

    await this.triggerReconciliation({
      tenantId:
        context.tenantId,

      payment:
        extractCorrelationEntity(
          correlation,
        ),

      callback,

      correlationId:
        context.correlationId,

      reason:
        correlation?.reason ||
        'CALLBACK_REQUIRES_RECONCILIATION',

      session,
    });

    await this.publishPaymentEvent({
      type:
        nextStatus ===
        CALLBACK_STATUS.PENDING
          ? 'AIRTEL_PAYMENT_PENDING'
          : 'AIRTEL_PAYMENT_RECONCILIATION_REQUIRED',

      context,

      payment:
        extractCorrelationEntity(
          correlation,
        ),

      reason:
        correlation?.reason ||
        'NO_AUTHORITATIVE_MATCH',
    });

    return {
      status:
        nextStatus,

      outcome:
        providerOutcome,

      callbackId:
        callback.callbackId,

      providerReference:
        providerReferenceFrom(
          callback,
        ),

      paymentReference:
        callback.paymentReference ||
        null,

      transactionReference:
        transactionReferenceFrom(
          callback,
        ),

      correlationId:
        context.correlationId,

      operationId:
        context.operationId,

      matched:
        Boolean(
          correlation?.matched,
        ),

      reason:
        correlation?.reason ||
        'NO_AUTHORITATIVE_MATCH',

      nextAction:
        nextStatus ===
        CALLBACK_STATUS.PENDING
          ? 'WAIT_FOR_PROVIDER_CONFIRMATION'
          : nextStatus ===
              CALLBACK_STATUS.REVIEW
            ? 'MANUAL_REVIEW'
            : 'RECONCILIATION_REQUIRED',

      financialSettlement:
        false,

      timestamp:
        now(
          this.clock,
        ).toISOString(),
    };
  }

  async routeManualReview({
    callback,
    context,
    correlation,
    reason =
      'MANUAL_REVIEW_REQUIRED',
    session,
  }) {
    this.statistics.reviewed +=
      1;

    let approval =
      null;

    if (
      this.approvalWorkflow
    ) {
      const method =
        firstFunction(
          this.approvalWorkflow,
          [
            'create',
            'request',
            'openCase',
          ],
        );

      if (method) {
        approval =
          await this.approvalWorkflow[
            method
          ]({
            type:
              'AIRTEL_CALLBACK_MANUAL_REVIEW',

            tenantId:
              context.tenantId,

            provider:
              PROVIDER,

            correlationId:
              context.correlationId,

            operationId:
              context.operationId,

            callbackId:
              callback.callbackId,

            reason,

            correlation:
              this.safeCorrelation(
                correlation,
              ),

            session,
          });
      }
    }

    if (approval) {
      this.statistics.approvalReviews +=
        1;
    }

    await this.completeLifecycleSafe({
      context,

      callback,

      fingerprint:
        callbackFingerprint(
          callback,
          context.tenantId,
        ),

      status:
        CALLBACK_STATUS.REVIEW,

      session,
    });

    await this.publishPaymentEvent({
      type:
        'AIRTEL_CALLBACK_MANUAL_REVIEW_REQUIRED',

      context,

      payment:
        extractCorrelationEntity(
          correlation,
        ),

      reason,

      approval,
    });

    return {
      status:
        CALLBACK_STATUS.REVIEW,

      outcome:
        normalizeProviderOutcome(
          callback,
        ),

      callbackId:
        callback.callbackId,

      paymentId:
        extractEntityId(
          extractCorrelationEntity(
            correlation,
          ),
        ),

      correlationId:
        context.correlationId,

      operationId:
        context.operationId,

      reviewRequired:
        true,

      reason,

      approvalId:
        approval?.id ||
        approval?.approvalId ||
        null,

      financialSettlement:
        false,

      nextAction:
        'MANUAL_REVIEW',

      timestamp:
        now(
          this.clock,
        ).toISOString(),
    };
  }

  async routeFraudReview({
    callback,
    context,
    correlation,
    reason =
      'FRAUD_OR_COMPLIANCE_REVIEW',
    session,
  }) {
    this.statistics.fraudReviews +=
      1;

    await this.completeLifecycleSafe({
      context,

      callback,

      fingerprint:
        callbackFingerprint(
          callback,
          context.tenantId,
        ),

      status:
        CALLBACK_STATUS.REVIEW,

      session,
    });

    await this.publishPaymentEvent({
      type:
        'AIRTEL_CALLBACK_FRAUD_REVIEW_REQUIRED',

      context,

      payment:
        extractCorrelationEntity(
          correlation,
        ),

      reason,
    });

    return {
      status:
        CALLBACK_STATUS.REVIEW,

      outcome:
        normalizeProviderOutcome(
          callback,
        ),

      callbackId:
        callback.callbackId,

      paymentId:
        extractEntityId(
          extractCorrelationEntity(
            correlation,
          ),
        ),

      correlationId:
        context.correlationId,

      operationId:
        context.operationId,

      reviewRequired:
        true,

      fraudReview:
        true,

      reason,

      financialSettlement:
        false,

      nextAction:
        'FRAUD_REVIEW',

      timestamp:
        now(
          this.clock,
        ).toISOString(),
    };
  }

  async handleProcessingFailure({
    callback,
    context,
    callbackFingerprint,
    error,
    session,
  }) {
    await this.safeAudit(
      'AIRTEL_CALLBACK_PROCESSING_FAILED',
      context,
      {
        code:
          error.code,

        retryable:
          error.retryable,

        uncertain:
          error.uncertain,

        callbackFingerprint,
      },
    );

    if (
      error.retryable ||
      error.uncertain
    ) {
      try {
        await this.triggerReconciliation({
          tenantId:
            context.tenantId,

          payment:
            null,

          callback,

          correlationId:
            context.correlationId,

          reason:
            error.code,

          session,
        });
      } catch (
        reconciliationError
      ) {
        if (
          this.options
            .failClosedOnReconciliationError
        ) {
          this.log(
            'error',
            'Airtel callback reconciliation escalation failed',
            {
              tenantId:
                context.tenantId,

              correlationId:
                context.correlationId,

              error:
                sanitizeError(
                  reconciliationError,
                ),
            },
          );
        }
      }
    }

    if (
      !error.securityRejected &&
      (
        context.signatureVerified ||
        context.securityVerified ||
        context.trustedCallback
      )
    ) {
      await this.sendToDeadLetter({
        callback,

        context,

        error,

        callbackFingerprint,
      });
    }

    await this.recoverProviderFailure({
      error,

      context,
    });
  }

  async sendToDeadLetter({
    callback,
    context,
    error,
    callbackFingerprint,
  }) {
    if (
      !this.deadLetterQueue
    ) {
      return null;
    }

    const method =
      firstFunction(
        this.deadLetterQueue,
        [
          'publish',
          'enqueue',
          'deadLetter',
          'store',
        ],
      );

    if (!method) {
      return null;
    }

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

          callbackId:
            callback?.callbackId ||
            null,

          transactionId:
            callback?.transactionId ||
            null,

          providerReference:
            providerReferenceFrom(
              callback,
            ),

          paymentReference:
            callback?.paymentReference ||
            null,

          callbackFingerprint,

          correlationId:
            context.correlationId,

          operationId:
            context.operationId,

          authenticated:
            context.authenticated,

          signatureVerified:
            context.signatureVerified,

          payload:
            safeClone(
              callback,
            ),

          error:
            sanitizeError(
              error,
            ),

          reason:
            error?.code ||
            'AIRTEL_CALLBACK_PROCESSING_FAILED',
        });

      this.statistics.deadLettered +=
        1;

      return result;
    } catch (dlqError) {
      if (
        this.options
          .failClosedOnDlqError
      ) {
        throw dlqError;
      }

      this.log(
        'error',
        'Airtel callback DLQ routing failed',
        {
          tenantId:
            context.tenantId,

          correlationId:
            context.correlationId,

          error:
            sanitizeError(
              dlqError,
            ),
        },
      );

      return null;
    }
  }

  async recoverProviderFailure({
    error,
    context,
  }) {
    if (
      !this.recoveryService
    ) {
      return null;
    }

    const method =
      firstFunction(
        this.recoveryService,
        [
          'schedule',
          'recover',
          'enqueue',
        ],
      );

    if (!method) {
      return null;
    }

    try {
      return await this.recoveryService[
        method
      ]({
        provider:
          PROVIDER,

        operation:
          OPERATION,

        tenantId:
          context.tenantId,

        correlationId:
          context.correlationId,

        operationId:
          context.operationId,

        reason:
          error?.code ||
          'AIRTEL_PROVIDER_FAILURE',

        retryable:
          Boolean(
            error?.retryable,
          ),

        uncertain:
          Boolean(
            error?.uncertain,
          ),
      });
    } catch (recoveryError) {
      this.log(
        'error',
        'Airtel callback recovery scheduling failed',
        {
          tenantId:
            context.tenantId,

          correlationId:
            context.correlationId,

          error:
            sanitizeError(
              recoveryError,
            ),
        },
      );

      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Reconciliation / settlement
  // ---------------------------------------------------------------------------

  async triggerReconciliation({
    tenantId,
    payment,
    callback,
    correlationId,
    reason,
    session,
  }) {
    if (
      !this.reconciliationService
    ) {
      if (
        this.options
          .failClosedOnReconciliationError
      ) {
        throw new AirtelCallbackProcessorError(
          'Airtel reconciliation service is not configured.',
          {
            code:
              'AIRTEL_RECONCILIATION_UNAVAILABLE',

            statusCode:
              503,

            retryable:
              true,
          },
        );
      }

      return null;
    }

    const method =
      firstFunction(
        this.reconciliationService,
        [
          'enqueue',
          'queue',
          'trigger',
          'request',
          'enqueueSettlementReconciliation',
        ],
      );

    if (!method) {
      if (
        this.options
          .failClosedOnReconciliationError
      ) {
        throw new AirtelCallbackProcessorError(
          'Airtel reconciliation service exposes no supported method.',
          {
            code:
              'AIRTEL_RECONCILIATION_CONTRACT_INVALID',

            statusCode:
              503,

            retryable:
              true,
          },
        );
      }

      return null;
    }

    try {
      const result =
        await this.reconciliationService[
          method
        ]({
          tenantId,

          provider:
            PROVIDER,

          operation:
            OPERATION,

          paymentId:
            extractEntityId(
              payment,
            ),

          transactionReference:
            transactionReferenceFrom(
              callback,
            ),

          providerReference:
            providerReferenceFrom(
              callback,
            ),

          transactionId:
            callback?.transactionId ||
            null,

          callbackId:
            callback?.callbackId ||
            null,

          correlationId,

          reason:
            reason ||
            'AIRTEL_CALLBACK_RECONCILIATION',

          session,
        });

      this.statistics.reconciliations +=
        1;

      return result;
    } catch (error) {
      throw normalizeError(
        error,
        {
          tenantId,
          correlationId,
        },
      );
    }
  }

  async triggerSettlementReconciliation({
    callback,
    context,
    payment,
    financialEvidence,
    session,
  }) {
    if (
      !this.reconciliationService
    ) {
      if (
        this.options
          .failClosedOnReconciliationError
      ) {
        throw new AirtelCallbackProcessorError(
          'Settlement reconciliation service is not configured.',
          {
            code:
              'AIRTEL_SETTLEMENT_RECONCILIATION_UNAVAILABLE',

            statusCode:
              503,

            retryable:
              true,
          },
        );
      }

      return null;
    }

    const method =
      firstFunction(
        this.reconciliationService,
        [
          'enqueueSettlementReconciliation',
          'enqueue',
          'queue',
          'trigger',
        ],
      );

    if (!method) {
      if (
        this.options
          .failClosedOnReconciliationError
      ) {
        throw new AirtelCallbackProcessorError(
          'Settlement reconciliation service exposes no supported method.',
          {
            code:
              'AIRTEL_SETTLEMENT_RECONCILIATION_CONTRACT_INVALID',

            statusCode:
              503,

            retryable:
              true,
          },
        );
      }

      return null;
    }

    const result =
      await this.reconciliationService[
        method
      ]({
        tenantId:
          context.tenantId,

        provider:
          PROVIDER,

        operation:
          OPERATION,

        paymentId:
          extractEntityId(
            payment,
          ),

        transactionReference:
          transactionReferenceFrom(
            callback,
          ),

        providerReference:
          providerReferenceFrom(
            callback,
          ),

        transactionId:
          callback.transactionId ||
          null,

        correlationId:
          context.correlationId,

        financialEvidence:
          safeClone(
            financialEvidence,
          ),

        session,
      });

    return result;
  }

  async confirmSettlement({
    callback,
    context,
    payment,
    financialEvidence,
    session,
  }) {
    if (
      !isFinanciallySuccessfulResult({
        financialEvidence,
      })
    ) {
      return {
        confirmed:
          false,

        authoritative:
          Boolean(
            financialEvidence
              ?.authoritative,
          ),

        reason:
          'FINANCIAL_EVIDENCE_NOT_FINAL',
      };
    }

    if (
      !this.settlementService
    ) {
      if (
        this.options
          .failClosedOnSettlementVerificationError
      ) {
        return {
          confirmed:
            false,

          authoritative:
            false,

          reason:
            'SETTLEMENT_SERVICE_UNAVAILABLE',
        };
      }

      return {
        confirmed:
          Boolean(
            financialEvidence
              .settlementConfirmed,
          ),

        authoritative:
          Boolean(
            financialEvidence
              .authoritative,
          ),

        reason:
          'FINANCIAL_CORE_EVIDENCE',
      };
    }

    const method =
      firstFunction(
        this.settlementService,
        [
          'confirmCollection',
          'confirmSettlement',
          'verifySettlement',
          'recordSettlement',
        ],
      );

    if (!method) {
      if (
        this.options
          .failClosedOnSettlementVerificationError
      ) {
        return {
          confirmed:
            false,

          authoritative:
            false,

          reason:
            'SETTLEMENT_SERVICE_CONTRACT_INVALID',
        };
      }

      return {
        confirmed:
          Boolean(
            financialEvidence
              .settlementConfirmed,
          ),

        authoritative:
          Boolean(
            financialEvidence
              .authoritative,
          ),

        reason:
          'FINANCIAL_CORE_EVIDENCE',
      };
    }

    const result =
      await this.settlementService[
        method
      ]({
        tenantId:
          context.tenantId,

        provider:
          PROVIDER,

        operation:
          OPERATION,

        transactionId:
          callback.transactionId ||
          extractEntityId(
            payment,
          ),

        paymentId:
          extractEntityId(
            payment,
          ),

        providerReference:
          providerReferenceFrom(
            callback,
          ),

        correlationId:
          context.correlationId,

        financialEvidence:
          safeClone(
            financialEvidence,
          ),

        session,
      });

    this.statistics.settlements +=
      1;

    return {
      ...safeClone(
        result,
      ),

      confirmed:
        Boolean(
          result?.confirmed ===
            true ||
          result?.settled ===
            true ||
          result?.status ===
            'CONFIRMED' ||
          result?.status ===
            'SETTLED',
        ),

      authoritative:
        true,
    };
  }

  // ---------------------------------------------------------------------------
  // Security controls
  // ---------------------------------------------------------------------------

  async runSecurityControls({
    callback,
    context,
    correlation,
  }) {
    const checks = [];

    if (this.fraudEngine) {
      const method =
        firstFunction(
          this.fraudEngine,
          [
            'evaluate',
            'assess',
            'score',
          ],
        );

      if (method) {
        const result =
          await this.fraudEngine[
            method
          ]({
            provider:
              PROVIDER,

            operation:
              OPERATION,

            tenantId:
              context.tenantId,

            transaction:
              safeClone(
                callback,
              ),

            correlation:
              this.safeCorrelation(
                correlation,
              ),

            correlationId:
              context.correlationId,
          });

        checks.push({
          type:
            'FRAUD',

          result:
            safeClone(
              result,
            ),
        });

        if (
          result?.block === true ||
          result?.decision ===
            'BLOCK'
        ) {
          throw new AirtelCallbackProcessorError(
            'Airtel callback was blocked by fraud controls.',
            {
              code:
                'AIRTEL_CALLBACK_FRAUD_BLOCKED',

              statusCode:
                403,
            },
          );
        }

        if (
          result?.requiresReview ===
            true ||
          result?.decision ===
            'REVIEW'
        ) {
          this.statistics.fraudReviews +=
            1;
        }
      }
    }

    if (this.amlService) {
      const method =
        firstFunction(
          this.amlService,
          [
            'screen',
            'evaluate',
            'check',
          ],
        );

      if (method) {
        const result =
          await this.amlService[
            method
          ]({
            provider:
              PROVIDER,

            operation:
              OPERATION,

            tenantId:
              context.tenantId,

            transaction:
              safeClone(
                callback,
              ),

            correlationId:
              context.correlationId,
          });

        checks.push({
          type:
            'AML',

          result:
            safeClone(
              result,
            ),
        });

        if (
          result?.blocked === true ||
          result?.match === true
        ) {
          throw new AirtelCallbackProcessorError(
            'Airtel callback was blocked by AML/compliance controls.',
            {
              code:
                'AIRTEL_CALLBACK_AML_BLOCKED',

              statusCode:
                403,
            },
          );
        }

        if (
          result?.requiresReview ===
            true
        ) {
          this.statistics.amlReviews +=
            1;
        }
      }
    }

    const velocity =
      this.velocityEngine ||
      this.velocityService;

    if (velocity) {
      const method =
        firstFunction(
          velocity,
          [
            'check',
            'evaluate',
            'assert',
          ],
        );

      if (method) {
        const result =
          await velocity[
            method
          ]({
            tenantId:
              context.tenantId,

            provider:
              PROVIDER,

            operation:
              OPERATION,

            customerId:
              callback.customerReference ||
              callback.customerId,

            phoneNumber:
              callback.phoneNumber,

            amountMinor:
              callback.amountMinor,

            amount:
              callback.amount,

            correlationId:
              context.correlationId,
          });

        checks.push({
          type:
            'VELOCITY',

          result:
            safeClone(
              result,
            ),
        });

        if (
          result?.blocked === true
        ) {
          throw new AirtelCallbackProcessorError(
            'Airtel callback exceeded configured velocity controls.',
            {
              code:
                'AIRTEL_CALLBACK_VELOCITY_BLOCKED',

              statusCode:
                429,

              retryable:
                false,
            },
          );
        }

        if (
          result?.requiresReview ===
            true
        ) {
          this.statistics.velocityReviews +=
            1;
        }
      }
    }

    if (this.policyEngine) {
      const method =
        firstFunction(
          this.policyEngine,
          [
            'evaluate',
            'check',
            'assert',
          ],
        );

      if (method) {
        const result =
          await this.policyEngine[
            method
          ]({
            tenantId:
              context.tenantId,

            operation:
              'AIRTEL_COLLECTION',

            provider:
              PROVIDER,

            transaction:
              safeClone(
                callback,
              ),

            correlationId:
              context.correlationId,
          });

        checks.push({
          type:
            'POLICY',

          result:
            safeClone(
              result,
            ),
        });

        if (
          result?.blocked === true ||
          result?.decision ===
            'BLOCK'
        ) {
          throw new AirtelCallbackProcessorError(
            'Airtel callback was blocked by tenant policy.',
            {
              code:
                'AIRTEL_CALLBACK_POLICY_BLOCKED',

              statusCode:
                403,
            },
          );
        }

        if (
          result?.requiresReview ===
            true
        ) {
          this.statistics.policyReviews +=
            1;
        }
      }
    }

    await this.recordSecurityAudit({
      context,
      checks,
    });

    return checks;
  }

  async recordSecurityAudit({
    context,
    checks,
  }) {
    if (!checks.length) return;

    await this.safeAudit(
      'AIRTEL_CALLBACK_SECURITY_CHECK',
      context,
      {
        checks,
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Events / notifications / completion
  // ---------------------------------------------------------------------------

  buildResult({
    context,
    callback,
    status,
    outcome = null,
    route = null,
    duplicate = false,
    fingerprint = null,
    durationMs = 0,
    duplicateRecord = null,
    reason = null,
    payment = null,
    financialEvidence = null,
    settlement = null,
    nextAction = null,
  } = {}) {
    const resolvedOutcome =
      outcome ||
      normalizeProviderOutcome(
        callback,
      );

    return {
      provider:
        PROVIDER,

      operation:
        OPERATION,

      schemaVersion:
        SCHEMA_VERSION,

      engineVersion:
        ENGINE_VERSION,

      status,

      outcome:
        resolvedOutcome,

      dispatchStatus:
        status,

      route,

      success:
        ![
          CALLBACK_STATUS.FAILED,
          CALLBACK_STATUS.DEAD_LETTER,
        ].includes(
          status,
        ),

      duplicate:
        Boolean(
          duplicate,
        ),

      reviewRequired:
        status ===
          CALLBACK_STATUS.REVIEW ||
        status ===
          CALLBACK_STATUS.RECONCILIATION_REQUIRED,

      tenantId:
        context?.tenantId ||
        null,

      correlationId:
        context?.correlationId ||
        null,

      operationId:
        context?.operationId ||
        null,

      requestId:
        context?.requestId ||
        null,

      callbackId:
        callback?.callbackId ||
        null,

      callbackFingerprint:
        fingerprint ||
        callbackFingerprint(
          callback,
          context?.tenantId,
        ),

      transactionId:
        callback?.transactionId ||
        null,

      paymentReference:
        callback?.paymentReference ||
        null,

      transactionReference:
        callback?.transactionReference ||
        callback?.reference ||
        null,

      providerReference:
        providerReferenceFrom(
          callback,
        ),

      paymentId:
        extractEntityId(
          payment,
        ),

      payment:
        safeClone(
          payment,
        ),

      duplicateRecord:
        safeClone(
          duplicateRecord,
        ),

      reason:
        string(
          reason,
          1000,
        ),

      financialEvidence:
        safeClone(
          financialEvidence,
        ),

      settlement:
        safeClone(
          settlement,
        ),

      financialSettlement:
        Boolean(
          settlement?.confirmed ===
            true,
        ),

      authoritativeFinancialEvidence:
        Boolean(
          financialEvidence
            ?.authoritative ===
            true,
        ),

      nextAction:
        nextAction ||
        (
          status ===
            CALLBACK_STATUS.COMPLETED
            ? 'ACKNOWLEDGE'
            : status ===
                CALLBACK_STATUS.PENDING
              ? 'WAIT_FOR_PROVIDER'
              : status ===
                  CALLBACK_STATUS.REVIEW
                ? 'MANUAL_REVIEW'
                : status ===
                    CALLBACK_STATUS.RECONCILIATION_REQUIRED
                  ? 'RECONCILIATION_REQUIRED'
                  : null
        ),

      durationMs:
        Number(
          durationMs ||
            0,
        ),

      timestamp:
        now(
          this.clock,
        ).toISOString(),
    };
  }

  async completeProcessing({
    callback,
    context,
    result,
    session,
  }) {
    const finalStatus =
      result?.status ||
      CALLBACK_STATUS.FAILED;

    await this.completeLifecycleSafe({
      context,

      callback,

      fingerprint:
        callbackFingerprint(
          callback,
          context.tenantId,
        ),

      status:
        finalStatus,

      session,
    });

    await this.commitIdempotency({
      callback,
      context,
      result,
      session,
    });

    await this.publishPaymentEvent({
      type:
        'AIRTEL_CALLBACK_PROCESSED',

      context,

      payment:
        result?.payment ||
        null,

      result,
    });

    return result;
  }

  async publishPaymentEvent({
    type,
    context,
    payment = null,
    result = null,
    financialEvidence = null,
    settlement = null,
    reason = null,
    approval = null,
  }) {
    const payload = {
      type,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      tenantId:
        context?.tenantId ||
        null,

      correlationId:
        context?.correlationId ||
        null,

      operationId:
        context?.operationId ||
        null,

      paymentId:
        extractEntityId(
          payment,
        ),

      reason:
        string(
          reason,
          1000,
        ),

      financialSettlement:
        Boolean(
          settlement?.confirmed ===
            true,
        ),

      authoritativeFinancialEvidence:
        Boolean(
          financialEvidence
            ?.authoritative ===
            true,
        ),

      approvalId:
        approval?.id ||
        approval?.approvalId ||
        null,

      result:
        safeClone(
          result,
        ),
    };

    try {
      let published =
        false;

      if (this.outboxService) {
        const method =
          firstFunction(
            this.outboxService,
            [
              'publish',
              'enqueue',
              'append',
            ],
          );

        if (method) {
          await this.outboxService[
            method
          ](
            payload,
          );

          published =
            true;
        }
      }

      if (
        !published &&
        this.eventBus
      ) {
        const method =
          firstFunction(
            this.eventBus,
            [
              'publish',
              'emit',
              'send',
            ],
          );

        if (method) {
          await this.eventBus[
            method
          ](
            payload,
          );

          published =
            true;
        }
      }

      if (published) {
        this.statistics.notificationEvents +=
          1;
      }

      return published;
    } catch (error) {
      this.statistics.eventFailures +=
        1;

      if (
        this.options
          .failClosedOnEventError
      ) {
        throw error;
      }

      this.log(
        'error',
        'Airtel callback event publication failed',
        {
          tenantId:
            context?.tenantId,

          correlationId:
            context?.correlationId,

          error:
            sanitizeError(
              error,
            ),
        },
      );

      return false;
    }
  }

  async sendNotification({
    type,
    context,
    payment,
  }) {
    if (
      !this.notificationService
    ) {
      return null;
    }

    const method =
      firstFunction(
        this.notificationService,
        [
          'notify',
          'publish',
          'send',
        ],
      );

    if (!method) {
      return null;
    }

    return this.notificationService[
      method
    ]({
      type,

      tenantId:
        context.tenantId,

      paymentId:
        extractEntityId(
          payment,
        ),

      correlationId:
        context.correlationId,

      provider:
        PROVIDER,
    });
  }

  async commitIdempotency({
    callback,
    context,
    result,
    session,
  }) {
    if (
      !this.idempotencyManager
    ) {
      return null;
    }

    const method =
      firstFunction(
        this.idempotencyManager,
        [
          'commit',
          'complete',
          'markCommitted',
        ],
      );

    if (!method) {
      return null;
    }

    try {
      const fingerprint =
        callbackFingerprint(
          callback,
          context.tenantId,
        );

      return await this.idempotencyManager[
        method
      ]({
        tenantId:
          context.tenantId,

        provider:
          PROVIDER,

        operation:
          OPERATION,

        key:
          `AIRTEL_CALLBACK:${fingerprint}`,

        idempotencyKey:
          `AIRTEL_CALLBACK:${fingerprint}`,

        callbackId:
          callback.callbackId,

        fingerprint,

        correlationId:
          context.correlationId,

        operationId:
          context.operationId,

        result:
          safeClone(
            result,
          ),

        session,
      });
    } catch (error) {
      if (
        this.options
          .failClosedOnLifecyclePersistenceError
      ) {
        throw new AirtelCallbackProcessorError(
          'Airtel callback idempotency completion failed.',
          {
            code:
              'AIRTEL_CALLBACK_IDEMPOTENCY_COMMIT_FAILED',

            statusCode:
              503,

            retryable:
              true,

            cause:
              error,
          },
        );
      }

      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Compatibility helpers from the legacy processor API
  // ---------------------------------------------------------------------------

  async updatePaymentStatus({
    tenantId,
    payment,
    callback,
    correlationId,
    session,
  }) {
    if (!payment) {
      throw new AirtelCallbackProcessorError(
        'Payment is required.',
        {
          code:
            'AIRTEL_PAYMENT_REQUIRED',

          statusCode:
            400,
        },
      );
    }

    const outcome =
      normalizeProviderOutcome(
        callback,
      );

    const event =
      outcome ===
        PROVIDER_OUTCOMES.SUCCESS
        ? 'PROVIDER_CONFIRMED'
        : outcome ===
            PROVIDER_OUTCOMES.PENDING
          ? 'PROVIDER_PENDING'
          : 'PROVIDER_FAILED';

    return this.transitionPaymentState({
      payment,

      callback,

      context: {
        tenantId,

        correlationId:
          correlationId ||
          id(),

        operationId:
          id(),
      },

      event,

      session,
    });
  }

  async processFinancialEffects({
    tenantId,
    payment,
    callback,
    correlationId,
    session,
  }) {
    const outcome =
      normalizeProviderOutcome(
        callback,
      );

    if (
      outcome !==
      PROVIDER_OUTCOMES.SUCCESS
    ) {
      return {
        financialSettlement:
          false,

        reason:
          outcome ===
            PROVIDER_OUTCOMES.PENDING
            ? 'PROVIDER_PENDING'
            : 'PROVIDER_NOT_SUCCESS',
      };
    }

    return this.applyFinancialEffects({
      tenantId,

      context: {
        tenantId,

        correlationId:
          correlationId ||
          id(),

        operationId:
          id(),
      },

      payment,

      callback,

      session,
    });
  }

  async triggerReconciliationCompat({
    tenantId,
    payment,
    correlationId,
    callback,
    session,
  }) {
    return this.triggerReconciliation({
      tenantId,

      payment,

      callback,

      correlationId:
        correlationId ||
        id(),

      reason:
        'AIRTEL_CALLBACK',

      session,
    });
  }

  async confirmSettlementCompat({
    tenantId,
    payment,
    correlationId,
    callback,
    financialEvidence,
    session,
  }) {
    return this.confirmSettlement({
      context: {
        tenantId,

        correlationId:
          correlationId ||
          id(),

        operationId:
          id(),
      },

      payment,

      callback,

      financialEvidence,

      session,
    });
  }

  async replayDeadLetter({
    id: deadLetterId,
    tenantId,
    workerId = `processor-${process.pid}`,
  } = {}) {
    if (
      !this.deadLetterQueue
    ) {
      throw new AirtelCallbackProcessorError(
        'Airtel callback dead-letter queue is not configured.',
        {
          code:
            'AIRTEL_CALLBACK_DLQ_UNAVAILABLE',

          statusCode:
            503,

          retryable:
            true,
        },
      );
    }

    if (
      isFunction(
        this.deadLetterQueue
          .recover,
      )
    ) {
      return this.deadLetterQueue
        .recover({
          deadLetterId,
          tenantId,
          workerId,
          dispatch:
            true,
        });
    }

    if (
      isFunction(
        this.deadLetterQueue
          .replayDeadLetter,
      )
    ) {
      return this.deadLetterQueue
        .replayDeadLetter({
          id:
            deadLetterId,

          tenantId,

          workerId,
        });
    }

    const get =
      firstFunction(
        this.deadLetterQueue,
        [
          'getRecord',
          'get',
        ],
      );

    if (!get) {
      throw new AirtelCallbackProcessorError(
        'Airtel callback dead-letter queue does not support replay.',
        {
          code:
            'AIRTEL_CALLBACK_DLQ_REPLAY_UNAVAILABLE',

          statusCode:
            503,

          retryable:
            true,
        },
      );
    }

    const record =
      await this.deadLetterQueue[
        get
      ]({
        id:
          deadLetterId,

        dlqId:
          deadLetterId,

        tenantId,
      });

    if (!record) {
      throw new AirtelCallbackProcessorError(
        'Airtel callback dead-letter record was not found.',
        {
          code:
            'AIRTEL_CALLBACK_DLQ_RECORD_NOT_FOUND',

          statusCode:
            404,
        },
      );
    }

    const payload =
      record.payload ||
      record.callback ||
      record.data ||
      record;

    return this.process({
      tenantId,

      callback:
        payload,

      context: {
        tenantId,

        correlationId:
          record.correlationId ||
          id(),

        operationId:
          record.operationId ||
          id(),

        callbackId:
          record.callbackId,

        trustedCallback:
          record.signatureVerified ===
          true,

        securityVerified:
          record.signatureVerified ===
          true,

        signatureVerified:
          record.signatureVerified ===
          true,

        authenticated:
          record.authenticated ===
          true,

        replay:
          true,
      },

      correlationId:
        record.correlationId ||
        id(),

      operationId:
        record.operationId ||
        id(),
    });
  }

  async compensateFailedCallback({
    payment,
    context,
    reason,
  }) {
    await this.safeAudit(
      'AIRTEL_CALLBACK_COMPENSATION_REQUESTED',
      context,
      {
        paymentId:
          extractEntityId(
            payment,
          ),

        reason,
      },
    );

    return {
      executed:
        false,

      mode:
        'RECONCILIATION_FIRST',

      reason:
        'FINANCIAL_COMPENSATION_REQUIRES_CANONICAL_RECOVERY_BOUNDARY',

      paymentId:
        extractEntityId(
          payment,
        ),

      correlationId:
        context?.correlationId,
    };
  }

  // ---------------------------------------------------------------------------
  // Lock / retry / timeout infrastructure
  // ---------------------------------------------------------------------------

  acquireCallbackLock({
    tenantId,
    fingerprint,
    correlationId,
  }) {
    this.pruneLocalLocks();

    if (
      this.runtime.activeCallbacks
        .size >=
      Number(
        this.options
          .maxConcurrentCallbacks,
      )
    ) {
      throw new AirtelCallbackProcessorError(
        'Airtel callback processor concurrency capacity is exhausted.',
        {
          code:
            'AIRTEL_CALLBACK_PROCESSOR_CAPACITY_EXCEEDED',

          statusCode:
            503,

          retryable:
            true,
        },
      );
    }

    const key =
      `${tenantId}:${fingerprint}`;

    if (
      this.runtime.activeFingerprints.has(
        key,
      )
    ) {
      this.statistics.callbackLockConflicts +=
        1;

      throw new AirtelCallbackProcessorError(
        'The Airtel callback is already being processed.',
        {
          code:
            'AIRTEL_CALLBACK_PROCESSING_IN_FLIGHT',

          statusCode:
            409,

          retryable:
            true,

          correlationId,
        },
      );
    }

    const entry = {
      correlationId,

      startedAt:
        Date.now(),
    };

    this.runtime.activeCallbacks.set(
      correlationId,
      entry,
    );

    this.runtime.activeFingerprints.set(
      key,
      entry,
    );
  }

  releaseCallbackLock({
    tenantId,
    fingerprint,
  }) {
    const key =
      `${tenantId}:${fingerprint}`;

    const entry =
      this.runtime.activeFingerprints.get(
        key,
      );

    if (entry) {
      this.runtime.activeCallbacks.delete(
        entry.correlationId,
      );
    }

    this.runtime.activeFingerprints.delete(
      key,
    );
  }

  pruneLocalLocks() {
    const cutoff =
      Date.now() -
      Number(
        this.options
          .localLockTtlMs,
      );

    for (
      const [
        key,
        entry,
      ] of
        this.runtime.activeFingerprints
          .entries()
    ) {
      if (
        entry.startedAt <
        cutoff
      ) {
        this.runtime.activeFingerprints.delete(
          key,
        );

        this.runtime.activeCallbacks.delete(
          entry.correlationId,
        );
      }
    }
  }

  async executeWithRetry(
    operation,
    {
      context,
      maxRetries =
        this.options.maxRetries,
    } = {},
  ) {
    let lastError;

    for (
      let attempt = 0;
      attempt <=
        Number(
          maxRetries,
        );
      attempt +=
        1
    ) {
      try {
        return await this.executeWithTimeout(
          operation,
          {
            timeoutMs:
              this.options
                .processingTimeoutMs,

            context,
          },
        );
      } catch (error) {
        lastError =
          error;

        if (
          attempt >=
            Number(
              maxRetries,
            ) ||
          !isRetryable(
            error,
          )
        ) {
          throw error;
        }

        this.statistics
          .handlerRetries +=
          1;

        await this.sleep(
          Number(
            this.options
              .retryBackoffMs,
          ) *
            (
              attempt + 1
            ),
        );
      }
    }

    throw lastError;
  }

  async executeWithCircuitBreaker({
    operation,
    context,
  }) {
    if (!this.circuitBreaker) {
      return operation();
    }

    const method =
      firstFunction(
        this.circuitBreaker,
        [
          'execute',
          'run',
          'call',
        ],
      );

    if (!method) {
      return operation();
    }

    return this.circuitBreaker[
      method
    ]({
      name:
        'airtel-callback-processing',

      action:
        operation,

      operation,

      context,

      correlationId:
        context?.correlationId,
    });
  }

  async executeWithTimeout(
    operation,
    {
      timeoutMs,
      context,
    },
  ) {
    const timeout =
      Math.max(
        1,
        Number(
          timeoutMs,
        ) ||
          DEFAULTS
            .processingTimeoutMs,
      );

    let timer;

    try {
      return await Promise.race([
        this.executeWithCircuitBreaker(
          {
            operation,

            context,
          },
        ),

        new Promise(
          (
            _,
            reject,
          ) => {
            timer =
              setTimeout(
                () => {
                  this.statistics
                    .handlerTimeouts +=
                    1;

                  reject(
                    new AirtelCallbackProcessorError(
                      'Airtel callback processing timed out.',
                      {
                        code:
                          'AIRTEL_CALLBACK_PROCESSING_TIMEOUT',

                        statusCode:
                          504,

                        retryable:
                          true,

                        uncertain:
                          true,

                        tenantId:
                          context?.tenantId,

                        correlationId:
                          context?.correlationId,

                        operationId:
                          context?.operationId,
                      },
                    ),
                  );
                },
                timeout,
              );
          },
        ),
      ]);
    } finally {
      if (timer) {
        clearTimeout(
          timer,
        );
      }
    }
  }

  async sleep(ms) {
    const delay =
      Math.max(
        0,
        Number(ms) ||
          0,
      );

    if (!delay) {
      return;
    }

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          delay,
        ),
    );
  }

  // ---------------------------------------------------------------------------
  // Reliability / compliance helpers
  // ---------------------------------------------------------------------------

  createReliabilityContext({
    callback,
    context,
  }) {
    return Object.freeze({
      provider:
        PROVIDER,

      tenantId:
        context?.tenantId,

      correlationId:
        context?.correlationId,

      operationId:
        context?.operationId,

      callbackId:
        callback?.callbackId,

      callbackFingerprint:
        callbackFingerprint(
          callback,
          context?.tenantId,
        ),

      startedAt:
        Date.now(),

      retryCount:
        0,

      recoveryAttempt:
        0,
    });
  }

  async enforceIdempotency({
    callback,
    context,
  }) {
    const fingerprint =
      callbackFingerprint(
        callback,
        context.tenantId,
      );

    const duplicate =
      await this.checkDuplicate({
        tenantId:
          context.tenantId,

        callback,

        callbackFingerprint:
          fingerprint,

        context,
      });

    return !duplicate.found;
  }

  generateIdempotencyKey(
    callback,
    tenantId = null,
  ) {
    return `AIRTEL_CALLBACK:${callbackFingerprint(
      callback,
      tenantId,
    )}`;
  }

  async executeRetry({
    operation,
    context,
    attempts =
      this.options.maxRetries,
  }) {
    return this.executeWithRetry(
      operation,
      {
        context,

        maxRetries:
          attempts,
      },
    );
  }

  async acquireCallbackLockLegacy({
    callback,
    context,
  }) {
    if (!this.lockManager) {
      this.acquireCallbackLock({
        tenantId:
          context.tenantId,

        fingerprint:
          callbackFingerprint(
            callback,
            context.tenantId,
          ),

        correlationId:
          context.correlationId,
      });

      return true;
    }

    const method =
      firstFunction(
        this.lockManager,
        [
          'acquire',
          'lock',
        ],
      );

    if (!method) {
      return true;
    }

    const lockKey =
      `airtel:callback:${context.tenantId}:${callbackFingerprint(
        callback,
        context.tenantId,
      )}`;

    const acquired =
      await this.lockManager[
        method
      ]({
        key:
          lockKey,

        ttl:
          this.options
            .localLockTtlMs,

        correlationId:
          context.correlationId,
      });

    if (!acquired) {
      this.statistics.callbackLockConflicts +=
        1;

      throw new AirtelCallbackProcessorError(
        'Callback processing lock is already held.',
        {
          code:
            'AIRTEL_CALLBACK_LOCK_CONFLICT',

          statusCode:
            409,

          retryable:
            true,
        },
      );
    }

    return true;
  }

  async releaseCallbackLockLegacy({
    callback,
    context,
  }) {
    if (!this.lockManager) {
      this.releaseCallbackLock({
        tenantId:
          context.tenantId,

        fingerprint:
          callbackFingerprint(
            callback,
            context.tenantId,
          ),
      });

      return true;
    }

    const method =
      firstFunction(
        this.lockManager,
        [
          'release',
          'unlock',
        ],
      );

    if (!method) {
      return true;
    }

    const lockKey =
      `airtel:callback:${context.tenantId}:${callbackFingerprint(
        callback,
        context.tenantId,
      )}`;

    await this.lockManager[
      method
    ]({
      key:
        lockKey,

      correlationId:
        context.correlationId,
    });

    return true;
  }

  // ---------------------------------------------------------------------------
  // Operations / diagnostics
  // ---------------------------------------------------------------------------

  createOperationsContext() {
    return {
      startedAt:
        this.runtime.startedAt,

      status:
        this.runtime.stopping
          ? 'STOPPING'
          : 'ACTIVE',

      activeCallbacks:
        this.runtime.activeCallbacks
          .size,

      totalProcessed:
        this.statistics
          .processed,

      totalFailures:
        this.statistics
          .failed,

      incidents:
        safeClone(
          this.runtime
            .incidents,
        ),

      shutdownRequested:
        this.runtime
          .stopping,
    };
  }

  registerCallbackOperation({
    context,
  }) {
    return {
      operationId:
        context?.operationId ||
        id(),

      startedAt:
        Date.now(),

      activeCallbacks:
        this.runtime
          .activeCallbacks
          .size,
    };
  }

  completeCallbackOperation({
    success,
    duration,
  }) {
    this.recordSLA({
      duration,

      context:
        {},
    });

    return success;
  }

  recordSLA({
    duration,
    context,
  }) {
    if (
      Number(duration) <=
      Number(
        this.options
          .callbackSLA,
      )
    ) {
      return false;
    }

    this.statistics.slaBreaches +=
      1;

    this.raiseIncident({
      type:
        'SLA_BREACH',

      context,

      metadata: {
        duration,

        threshold:
          this.options
            .callbackSLA,
      },
    }).catch(() => undefined);

    return true;
  }

  calculateProviderScore() {
    const total =
      this.statistics
        .processed +
      this.statistics
        .failed;

    if (!total) {
      return 100;
    }

    return Math.max(
      0,
      Math.round(
        (
          this.statistics
            .processed /
          total
        ) *
          100,
      ),
    );
  }

  performanceAnalytics() {
    const elapsedSeconds =
      Math.max(
        1,
        (
          Date.now() -
          this.runtime
            .startedAt
            .getTime()
        ) /
          1000,
      );

    const terminal =
      this.statistics
        .processed +
      this.statistics
        .failed;

    return {
      throughputPerSecond:
        this.statistics
          .processed /
        elapsedSeconds,

      failureRate:
        terminal
          ? this.statistics
              .failed /
            terminal
          : 0,

      duplicateRate:
        this.statistics
          .received
          ? this.statistics
              .duplicates /
            this.statistics
              .received
          : 0,

      providerScore:
        this.calculateProviderScore(),

      averageActiveCallbacks:
        this.runtime
          .activeCallbacks
          .size,
    };
  }

  async dashboard() {
    return {
      service:
        'AIRTEL_CALLBACK_PROCESSOR',

      provider:
        PROVIDER,

      health:
        await this.health(),

      operations: {
        active:
          this.runtime
            .activeCallbacks
            .size,

        received:
          this.statistics
            .received,

        processed:
          this.statistics
            .processed,

        pending:
          this.statistics
            .pending,

        reviewed:
          this.statistics
            .reviewed,

        reconciliations:
          this.statistics
            .reconciliations,

        failures:
          this.statistics
            .failed,

        duplicates:
          this.statistics
            .duplicates,
      },

      financial: {
        operations:
          this.statistics
            .financialOperations,

        failures:
          this.statistics
            .financialFailures,

        ledgerAdapterCalls:
          this.statistics
            .ledgerUpdates,

        settlements:
          this.statistics
            .settlements,
      },

      providerScore:
        this.calculateProviderScore(),

      incidents:
        safeClone(
          this.runtime
            .incidents,
        ),

      generatedAt:
        now(
          this.clock,
        ).toISOString(),
    };
  }

  async raiseIncident({
    type,
    context,
    metadata = {},
  }) {
    const incident = {
      id:
        id(),

      type,

      severity:
        'HIGH',

      provider:
        PROVIDER,

      tenantId:
        context?.tenantId ||
        null,

      correlationId:
        context?.correlationId ||
        null,

      operationId:
        context?.operationId ||
        null,

      metadata:
        safeClone(
          metadata,
        ),

      createdAt:
        now(
          this.clock,
        ).toISOString(),
    };

    this.runtime.incidents.push(
      incident,
    );

    if (
      this.runtime
        .incidents.length >
      100
    ) {
      this.runtime
        .incidents.shift();
    }

    await this.publishPaymentEvent({
      type:
        'AIRTEL_CALLBACK_INCIDENT_CREATED',

      context:
        context ||
        {},

      result:
        incident,
    });

    return incident;
  }

  async sendAlert({
    severity,
    message,
    metadata = {},
  }) {
    await this.publishPaymentEvent({
      type:
        'AIRTEL_CALLBACK_ALERT',

      context:
        {},

      result: {
        severity,

        message:
          string(
            message,
            1000,
          ),

        metadata:
          safeClone(
            metadata,
          ),
      },
    });
  }

  async executiveReport() {
    const health =
      await this.health();

    const performance =
      this.performanceAnalytics();

    return {
      provider:
        PROVIDER,

      service:
        ENGINE_NAME,

      availability:
        health.status,

      processed:
        this.statistics
          .processed,

      failed:
        this.statistics
          .failed,

      pending:
        this.statistics
          .pending,

      review:
        this.statistics
          .reviewed,

      duplicates:
        this.statistics
          .duplicates,

      reconciliations:
        this.statistics
          .reconciliations,

      financialOperations:
        this.statistics
          .financialOperations,

      financialFailures:
        this.statistics
          .financialFailures,

      reliabilityScore:
        performance.providerScore,

      failureRate:
        performance.failureRate,

      slaBreaches:
        this.statistics
          .slaBreaches,

      incidents:
        this.runtime
          .incidents
          .length,

      generatedAt:
        now(
          this.clock,
        ).toISOString(),
    };
  }

  async complianceReport({
    tenantId,
  }) {
    return {
      provider:
        PROVIDER,

      tenantId,

      security: {
        securityRejected:
          this.statistics
            .securityRejected,

        fraudReviews:
          this.statistics
            .fraudReviews,

        amlReviews:
          this.statistics
            .amlReviews,

        velocityReviews:
          this.statistics
            .velocityReviews,

        policyReviews:
          this.statistics
            .policyReviews,

        approvalReviews:
          this.statistics
            .approvalReviews,
      },

      financialBoundary:
        FINANCIAL_BOUNDARY,

      directLedgerMutation:
        false,

      directBalanceMutation:
        false,

      directWalletMutation:
        false,

      generatedAt:
        now(
          this.clock,
        ).toISOString(),
    };
  }

  async health() {
    const dependencies =
      this.dependencyDiagnostics();

    const status =
      this.runtime.stopping
        ? 'STOPPING'
        : dependencies.errors.length
          ? 'DEGRADED'
          : 'UP';

    return {
      service:
        'AIRTEL_CALLBACK_PROCESSOR',

      component:
        COMPONENT,

      engine:
        ENGINE_NAME,

      version:
        ENGINE_VERSION,

      status,

      initialized:
        this.runtime
          .initialized,

      dependencies,

      activeCallbacks:
        this.runtime
          .activeCallbacks
          .size,

      uptimeMs:
        Date.now() -
        this.runtime
          .startedAt
          .getTime(),

      statistics:
        this.statisticsSnapshot(),

      timestamp:
        now(
          this.clock,
        ).toISOString(),
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
        !this.runtime.stopping,

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

  async assertReady() {
    if (
      !this.runtime
        .initialized
    ) {
      await this.initialize();
    }

    if (
      this.runtime.stopping
    ) {
      throw new AirtelCallbackProcessorError(
        'Airtel callback processor is stopping.',
        {
          code:
            'AIRTEL_CALLBACK_PROCESSOR_STOPPING',

          statusCode:
            503,

          retryable:
            true,
        },
      );
    }
  }

  isReady() {
    return (
      this.runtime
        .initialized &&
      !this.runtime
        .stopping
    );
  }

  dependencyDiagnostics() {
    const errors = [];

    if (
      this.options
        .requireCorrelation &&
      !this.callbackCorrelation
    ) {
      errors.push(
        'callbackCorrelation',
      );
    }

    if (
      !this.paymentStateEngine
    ) {
      errors.push(
        'paymentStateEngine',
      );
    }

    if (
      this.options
        .failClosedOnFinancialBoundaryError &&
      !this.financialCore &&
      !this.financialTransactionService &&
      !(
        this.options
          .allowLegacyLedgerBridge &&
        this.ledgerBridge
      )
    ) {
      errors.push(
        'financialBoundary',
      );
    }

    if (
      !this.reconciliationService &&
      this.options
        .failClosedOnReconciliationError
    ) {
      errors.push(
        'reconciliationService',
      );
    }

    return {
      errors,

      callbackCorrelation:
        Boolean(
          this.callbackCorrelation,
        ),

      callbackNormalizer:
        Boolean(
          this.callbackNormalizer,
        ),

      callbackDispatcher:
        Boolean(
          this.callbackDispatcher,
        ),

      paymentRepository:
        Boolean(
          this.paymentRepository,
        ),

      paymentStateEngine:
        Boolean(
          this.paymentStateEngine,
        ),

      financialCore:
        Boolean(
          this.financialCore,
        ),

      financialTransactionService:
        Boolean(
          this.financialTransactionService,
        ),

      ledgerBridge:
        Boolean(
          this.ledgerBridge,
        ),

      ledgerService:
        Boolean(
          this.ledgerService,
        ),

      reconciliationService:
        Boolean(
          this.reconciliationService,
        ),

      settlementService:
        Boolean(
          this.settlementService,
        ),

      callbackRepository:
        Boolean(
          this.callbackRepository,
        ),

      idempotencyManager:
        Boolean(
          this.idempotencyManager,
        ),

      deadLetterQueue:
        Boolean(
          this.deadLetterQueue,
        ),

      recoveryService:
        Boolean(
          this.recoveryService,
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
    };
  }

  diagnostics() {
    return {
      service:
        'AIRTEL_CALLBACK_PROCESSOR',

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

      health: {
        initialized:
          this.runtime
            .initialized,

        stopping:
          this.runtime
            .stopping,
      },

      dependencies:
        this.dependencyDiagnostics(),

      capabilities:
        this.capabilities(),

      configuration:
        safeClone(
          this.options,
        ),

      runtime: {
        activeCallbacks:
          this.runtime
            .activeCallbacks
            .size,

        activeFingerprints:
          this.runtime
            .activeFingerprints
            .size,

        incidents:
          this.runtime
            .incidents
            .length,

        lastCompletedAt:
          this.runtime
            .lastCompletedAt
            ?.toISOString?.() ||
          null,

        lastFailureAt:
          this.runtime
            .lastFailureAt
            ?.toISOString?.() ||
          null,

        lastFailureCode:
          this.runtime
            .lastFailureCode,
      },

      statistics:
        this.statisticsSnapshot(),

      financialBoundary: {
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

        authoritativeBoundary:
          FINANCIAL_BOUNDARY,
      },

      generatedAt:
        now(
          this.clock,
        ).toISOString(),
    };
  }

  async healthReport() {
    return this.health();
  }

  async readinessReport() {
    return this.readiness();
  }

  snapshot() {
    return this.diagnostics();
  }

  statisticsSnapshot() {
    return safeClone(
      this.statistics,
    );
  }

  capabilities() {
    return {
      provider:
        PROVIDER,

      operation:
        OPERATION,

      processor:
        true,

      tenantIsolation:
        true,

      securityGate:
        Boolean(
          this.options
            .requireSecurityVerification,
        ),

      correlationRequired:
        Boolean(
          this.options
            .requireCorrelation,
        ),

      duplicateProtection:
        true,

      callbackLifecycle:
        Boolean(
          this.callbackRepository,
        ),

      financialCore:
        Boolean(
          this.financialCore ||
          this.financialTransactionService,
        ),

      legacyLedgerBridge:
        Boolean(
          this.options
            .allowLegacyLedgerBridge &&
          this.ledgerBridge,
        ),

      reconciliation:
        Boolean(
          this.reconciliationService,
        ),

      settlementVerification:
        Boolean(
          this.settlementService,
        ),

      dlq:
        Boolean(
          this.deadLetterQueue,
        ),

      recovery:
        Boolean(
          this.recoveryService,
        ),

      fraud:
        Boolean(
          this.fraudEngine,
        ),

      aml:
        Boolean(
          this.amlService,
        ),

      velocity:
        Boolean(
          this.velocityEngine ||
          this.velocityService,
        ),

      policy:
        Boolean(
          this.policyEngine,
        ),

      approval:
        Boolean(
          this.approvalWorkflow,
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

  safeCorrelation(
    correlation,
  ) {
    if (!correlation) {
      return null;
    }

    return {
      status:
        correlation.status ||
        null,

      matched:
        Boolean(
          correlation.matched,
        ),

      confidence:
        Number(
          correlation.confidence ||
            0,
        ),

      matchType:
        correlation.matchType ||
        null,

      paymentId:
        correlation.paymentId ||
        extractEntityId(
          correlation.payment,
        ),

      collectionId:
        correlation.collectionId ||
        extractEntityId(
          correlation.collection,
        ),

      transactionId:
        correlation.transactionId ||
        extractEntityId(
          correlation.transaction,
        ),

      providerReference:
        correlation.providerReference ||
        null,

      callbackFingerprint:
        correlation.callbackFingerprint ||
        null,

      conflict:
        Boolean(
          correlation.conflict,
        ),

      reason:
        correlation.reason ||
        null,
    };
  }

  auditMetadata(
    value = {},
  ) {
    return safeClone(
      value,
    );
  }

  // ---------------------------------------------------------------------------
  // Observability
  // ---------------------------------------------------------------------------

  async safeAudit(
    action,
    context = {},
    metadata = {},
  ) {
    if (
      !this.options.audit ||
      !this.auditService
    ) {
      return;
    }

    const method =
      firstFunction(
        this.auditService,
        [
          'record',
          'audit',
          'write',
        ],
      );

    if (!method) {
      return;
    }

    try {
      await this.auditService[
        method
      ]({
        action,

        provider:
          PROVIDER,

        operation:
          OPERATION,

        tenantId:
          context?.tenantId ||
          null,

        correlationId:
          context?.correlationId ||
          null,

        operationId:
          context?.operationId ||
          null,

        actorId:
          context?.actorId ||
          'SYSTEM:AIRTEL_CALLBACK',

        metadata:
          safeClone(
            metadata,
          ),

        at:
          now(
            this.clock,
          ).toISOString(),
      });
    } catch (error) {
      this.statistics.auditFailures +=
        1;

      if (
        this.options
          .failClosedOnAuditError
      ) {
        throw error;
      }

      this.log(
        'error',
        'Airtel callback processor audit failed',
        {
          action,

          tenantId:
            context?.tenantId,

          correlationId:
            context?.correlationId,

          error:
            sanitizeError(
              error,
            ),
        },
      );
    }
  }

  metric(
    name,
    value = 1,
    labels = undefined,
  ) {
    try {
      const method =
        firstFunction(
          this.metrics,
          [
            'increment',
            'inc',
            'counter',
            'histogram',
            'gauge',
          ],
        );

      if (!method) {
        return;
      }

      if (
        labels !== undefined
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
      // Metrics are advisory only.
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
              context?.tenantId ||
              'unknown',

            'titech.correlation_id':
              context?.correlationId ||
              'unknown',

            'titech.operation_id':
              context?.operationId ||
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
      // Logging must never affect callback correctness.
    }
  }
}

export function createCallbackProcessor(
  options = {},
) {
  return new CallbackProcessor(
    options,
  );
}

export function createAirtelCallbackProcessor(
  options = {},
) {
  return new CallbackProcessor(
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
    CALLBACK_STATUS,
    PAYMENT_STATUS,
    ROUTES,
    PROVIDER_OUTCOMES,
    DEFAULTS,
    FINANCIAL_BOUNDARY,
  });

export const DEFAULT_CONFIGURATION =
  DEFAULTS;

export const AirtelCallbackProcessor =
  CallbackProcessor;

export default CallbackProcessor;