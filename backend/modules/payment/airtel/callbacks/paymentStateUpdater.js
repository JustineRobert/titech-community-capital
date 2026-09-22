/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Payment State Updater
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/callbacks/paymentStateUpdater.js
 *
 * Architectural role
 * ------------------
 * Tenant-scoped adapter that converts a security-validated, normalized Airtel
 * callback into an internal payment-state transition through the canonical
 * Payment State Machine.
 *
 * Canonical boundary
 * ------------------
 * Airtel callback
 *   -> signature validation
 *   -> callback normalization
 *   -> correlation
 *   -> callback processor/dispatcher
 *   -> THIS MODULE
 *   -> PaymentStateMachine
 *   -> Financial Core / reconciliation
 *
 * Responsibilities
 * ----------------
 * - Resolve the correlated payment/transaction using trusted tenant scope.
 * - Validate callback identity and provider evidence.
 * - Map provider outcome to an internal payment state conservatively.
 * - Preserve callback/provider/idempotency/correlation identities.
 * - Delegate all legal state transitions to the canonical state machine.
 * - Prevent unsafe success transitions when provider evidence is incomplete.
 * - Preserve terminal-success protection and out-of-order protection.
 * - Emit sanitized audit/event evidence after the state operation.
 * - Provide deterministic diagnostics, health and statistics.
 * - Preserve compatibility with the existing update(callback) API.
 *
 * Explicitly NOT responsible for
 * -------------------------------
 * - Airtel API/OAuth calls.
 * - Callback signature verification implementation.
 * - Callback schema validation implementation.
 * - Correlation candidate scoring.
 * - Fraud/KYC/AML source-of-truth decisions.
 * - Ledger/journal posting.
 * - Balance or wallet mutation.
 * - Financial settlement/finality.
 * - Reconciliation execution.
 * - Blind financial retry.
 *
 * Financial safety principles
 * ---------------------------
 * 1. Tenant identity never comes from an untrusted callback payload.
 * 2. Provider callback acceptance is evidence, not accounting settlement.
 * 3. Provider UNKNOWN/PENDING outcomes never become SUCCESSFUL.
 * 4. A SUCCESSFUL transition requires trusted provider confirmation and an
 *    authoritative provider transaction identity by default.
 * 5. State transitions are delegated to PaymentStateMachine; this module never
 *    assigns payment.status directly.
 * 6. Same-state callbacks are safe no-ops when the state machine permits them.
 * 7. Out-of-order callbacks rely on the canonical state machine to prevent
 *    terminal-success downgrade.
 * 8. Repository persistence, where needed, must use an atomic compare-and-set
 *    contract; blind updateStatus() is not accepted in strict mode.
 * 9. Callback retries retain the original callback fingerprint/idempotency key.
 * 10. Audit/events contain safe identifiers and outcome evidence only.
 * 11. No local/offline/PENDING_SYNC state is interpreted as settlement.
 *
 * Module format
 * -------------
 * Native ESM. Node.js built-ins only.
 * =============================================================================
 */

import crypto from 'node:crypto';

export const PROVIDER = 'AIRTEL';
export const OPERATION = 'CALLBACK';
export const COMPONENT = 'titech.airtel.callbacks.payment-state-updater';
export const ENGINE_NAME = 'airtel-payment-state-updater';
export const ENGINE_VERSION = '5.0.0';
export const SCHEMA_VERSION = 5;
export const FINANCIAL_BOUNDARY = 'TITECH_FINANCIAL_CORE';

export const PAYMENT_STATES = Object.freeze({
  INITIATED: 'INITIATED',
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SUCCESSFUL: 'SUCCESSFUL',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REVERSED: 'REVERSED',
  RETRYING: 'RETRYING',
  UNKNOWN: 'UNKNOWN',
  REQUIRES_RECONCILIATION: 'REQUIRES_RECONCILIATION',
  EXPIRED: 'EXPIRED',
  DEAD_LETTER: 'DEAD_LETTER',
});

export const CALLBACK_OUTCOMES = Object.freeze({
  SUCCESS: 'SUCCESS',
  PENDING: 'PENDING',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REVERSED: 'REVERSED',
  UNKNOWN: 'UNKNOWN',
  DUPLICATE: 'DUPLICATE',
});

export const UPDATE_STATUS = Object.freeze({
  UPDATED: 'UPDATED',
  NOOP: 'NOOP',
  DUPLICATE: 'DUPLICATE',
  REJECTED: 'REJECTED',
  REVIEW: 'REVIEW',
});

export const DEFAULTS = Object.freeze({
  requireTenantId: true,
  requireSecurityVerification: true,
  requirePaymentStateMachine: true,
  requireCallbackIdentity: true,
  requireProviderTransactionIdForSuccess: true,
  requirePaymentReferenceForSuccess: false,
  requireRepositoryForLookup: true,
  requireAtomicRepositoryMutation: true,
  allowUnknownOutcomeTransition: true,
  allowProviderFailureFromSuccess: false,
  allowSuccessFromFailed: false,
  allowSuccessWithoutAmountMatch: false,
  requireCurrencyMatch: true,
  maxStringLength: 512,
  maxMetadataBytes: 64 * 1024,
  maxCallbackBytes: 1024 * 1024,
  lookupTimeoutMs: 5000,
  maxLookupRetries: 1,
  retryBackoffMs: 100,
  maxConcurrentUpdates: 250,
  localLockTtlMs: 30_000,
  publishEvents: true,
  audit: true,
  failClosedOnAuditError: false,
  failClosedOnEventError: false,
  preserveOriginalStatus: true,
});

const SENSITIVE_KEY_PATTERN = /authorization|proxy.?authorization|cookie|set-cookie|secret|password|token|signature|private.?key|api.?key|credential|otp|pin|cvv|cvc|pan|refresh/i;
const RAW_KEY_PATTERN = /^raw|request.?body|response.?body|webhook.?body/i;
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function isFunction(value) {
  return typeof value === 'function';
}

function now(clock) {
  const value = isFunction(clock?.now) ? clock.now() : Date.now();
  return new Date(value);
}

function id() {
  return crypto.randomUUID();
}

function text(value, max = 512) {
  if (value === undefined || value === null) return null;
  const output = String(value).trim();
  return output ? output.slice(0, max) : null;
}

function upper(value) {
  const output = text(value, 128);
  return output ? output.toUpperCase() : null;
}

function number(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstValue(source, paths = []) {
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

function firstFunction(target, names = []) {
  return names.find((name) => isFunction(target?.[name])) || null;
}

function bytes(value) {
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
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[BUFFER:${sha256(value)}]`;
  if (typeof value !== 'object') return typeof value === 'bigint' ? String(value) : value;
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => canonicalize(item, depth + 1));

  return Object.keys(value).sort().reduce((result, key) => {
    if (BLOCKED_KEYS.has(key)) return result;
    result[key] = canonicalize(value[key], depth + 1);
    return result;
  }, {});
}

function sha256(value) {
  const input = Buffer.isBuffer(value)
    ? value
    : typeof value === 'string'
      ? value
      : JSON.stringify(canonicalize(value));

  return crypto.createHash('sha256').update(input).digest('hex');
}

function safeClone(value, depth = 0) {
  if (depth > 8) return '[DEPTH_LIMIT]';
  if (value === null || value === undefined) return value;
  if (Buffer.isBuffer(value)) return '[BUFFER_REDACTED]';
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return typeof value === 'bigint' ? String(value) : value;
  if (Array.isArray(value)) return value.slice(0, 250).map((item) => safeClone(item, depth + 1));

  return Object.entries(value).reduce((result, [key, child]) => {
    if (BLOCKED_KEYS.has(key)) return result;
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = '[REDACTED]';
      return result;
    }
    if (RAW_KEY_PATTERN.test(key)) {
      result[key] = '[OMITTED]';
      return result;
    }
    result[key] = safeClone(child, depth + 1);
    return result;
  }, {});
}

function normalizePhone(value) {
  if (value === undefined || value === null) return null;
  let digits = String(value).replace(/[^0-9]/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('256') && digits.length === 12) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 10) return `+256${digits.slice(1)}`;
  return digits.length >= 9 && digits.length <= 15 ? `+${digits}` : null;
}

function normalizeStatus(value) {
  return upper(value);
}

function normalizeOutcome(value) {
  const status = upper(value);
  if (!status) return CALLBACK_OUTCOMES.UNKNOWN;
  if (['SUCCESS', 'SUCCESSFUL', 'COMPLETED', 'COMPLETE', 'PAID', 'SETTLED', 'CONFIRMED', 'APPROVED', '0'].includes(status)) return CALLBACK_OUTCOMES.SUCCESS;
  if (['PENDING', 'PROCESSING', 'IN_PROGRESS', 'QUEUED', 'INITIATED', 'ACCEPTED', 'SUBMITTED'].includes(status)) return CALLBACK_OUTCOMES.PENDING;
  if (['FAILED', 'FAILURE', 'ERROR', 'DECLINED', 'REJECTED', 'DENIED'].includes(status)) return CALLBACK_OUTCOMES.FAILED;
  if (['CANCELLED', 'CANCELED'].includes(status)) return CALLBACK_OUTCOMES.CANCELLED;
  if (['REVERSED', 'REVERSAL'].includes(status)) return CALLBACK_OUTCOMES.REVERSED;
  if (['DUPLICATE', 'ALREADY_PROCESSED'].includes(status)) return CALLBACK_OUTCOMES.DUPLICATE;
  return CALLBACK_OUTCOMES.UNKNOWN;
}

function outcomeToState(outcome, currentState, options) {
  switch (outcome) {
    case CALLBACK_OUTCOMES.SUCCESS:
      return PAYMENT_STATES.SUCCESSFUL;
    case CALLBACK_OUTCOMES.PENDING:
      return PAYMENT_STATES.PENDING;
    case CALLBACK_OUTCOMES.FAILED:
      if (currentState === PAYMENT_STATES.SUCCESSFUL && !options.allowProviderFailureFromSuccess) {
        return PAYMENT_STATES.REQUIRES_RECONCILIATION;
      }
      return PAYMENT_STATES.FAILED;
    case CALLBACK_OUTCOMES.CANCELLED:
      if (currentState === PAYMENT_STATES.SUCCESSFUL) return PAYMENT_STATES.REQUIRES_RECONCILIATION;
      return PAYMENT_STATES.CANCELLED;
    case CALLBACK_OUTCOMES.REVERSED:
      return PAYMENT_STATES.REVERSED;
    case CALLBACK_OUTCOMES.UNKNOWN:
      return options.allowUnknownOutcomeTransition
        ? PAYMENT_STATES.UNKNOWN
        : PAYMENT_STATES.REQUIRES_RECONCILIATION;
    case CALLBACK_OUTCOMES.DUPLICATE:
    default:
      return currentState || PAYMENT_STATES.UNKNOWN;
  }
}

function entityId(payment) {
  const value = firstValue(payment, ['id', '_id', 'uuid', 'paymentId', 'transactionId']);
  if (value === null || value === undefined) return null;
  return text(typeof value?.toString === 'function' ? value.toString() : value, 256);
}

function entityTenantId(payment) {
  return text(firstValue(payment, ['tenantId', 'tenant.id']), 256);
}

function paymentStatus(payment) {
  return normalizeStatus(firstValue(payment, ['status', 'state', 'paymentStatus']));
}

function providerTransactionId(callback) {
  return text(firstValue(callback, [
    'providerTransactionId',
    'airtelTransactionId',
    'airtelMoneyId',
    'providerReference',
    'providerTransactionReference',
    'transaction.providerTransactionId',
    'transaction.transactionId',
  ]), 256);
}

function providerEventId(callback) {
  return text(firstValue(callback, [
    'providerEventId',
    'eventId',
    'notificationId',
    'callbackId',
    'event.id',
  ]), 256);
}

function paymentReference(callback) {
  return text(firstValue(callback, [
    'paymentReference',
    'payment.reference',
    'merchantReference',
    'clientReference',
  ]), 256);
}

function transactionReference(callback) {
  return text(firstValue(callback, [
    'transactionReference',
    'transaction.reference',
    'reference',
    'externalReference',
  ]), 256);
}

function externalId(callback) {
  return text(firstValue(callback, [
    'externalId',
    'externalReference',
    'clientReference',
    'transactionReference',
    'reference',
  ]), 256);
}

function amount(callback) {
  const raw = firstValue(callback, [
    'amount',
    'transactionAmount',
    'amount.value',
    'money.amount',
  ]);
  return raw === null ? null : text(raw, 128);
}

function amountMinor(callback) {
  const raw = firstValue(callback, [
    'amountMinor',
    'amountInMinorUnits',
    'money.amountMinor',
  ]);
  const parsed = number(raw);
  return parsed === null ? null : Math.round(parsed);
}

function currency(callback) {
  return upper(firstValue(callback, [
    'currency',
    'currencyCode',
    'money.currency',
  ]));
}

function occurredAt(callback) {
  const raw = firstValue(callback, [
    'occurredAt',
    'timestamp',
    'event.timestamp',
    'transaction.timestamp',
    'transactionTime',
  ]);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function actorId(context) {
  return text(firstValue(context, [
    'actorId',
    'actor.id',
    'actor.userId',
    'actor.actorId',
  ]) || 'SYSTEM:AIRTEL_CALLBACK', 256);
}

function createError(code, message, options = {}) {
  const error = new Error(message);
  error.name = 'AirtelPaymentStateUpdaterError';
  error.code = code;
  error.statusCode = Number(options.statusCode || 500);
  error.retryable = Boolean(options.retryable);
  error.uncertain = Boolean(options.uncertain);
  Object.assign(error, options);
  return error;
}

function sanitizeError(error) {
  if (!error) return null;
  return {
    name: text(error.name, 128),
    code: text(error.code, 256),
    message: text(error.message, 2000),
    statusCode: Number(error.statusCode || 500),
    retryable: Boolean(error.retryable),
    uncertain: Boolean(error.uncertain),
  };
}

function isDuplicateError(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return code.includes('duplicate') || code.includes('already') || message.includes('duplicate key') || message.includes('already processed');
}

function isRetryable(error) {
  if (!error) return false;
  if (error.retryable === true) return true;
  if ([408, 429].includes(Number(error.statusCode))) return true;
  if (Number(error.statusCode) >= 500) return true;
  return ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH'].includes(String(error.code || '').toUpperCase());
}

export class AirtelPaymentStateUpdater {
  constructor({
    repository = null,
    paymentRepository = null,
    stateMachine = null,
    paymentStateMachine = null,
    paymentStateEngine = null,
    auditService = null,
    metrics = null,
    eventBus = null,
    eventPublisher = null,
    outboxService = null,
    idempotencyManager = null,
    tenantResolver = null,
    logger = null,
    tracer = null,
    configuration = {},
    clock = Date,
  } = {}) {
    this.repository = repository || paymentRepository || null;
    this.stateMachine = stateMachine || paymentStateMachine || paymentStateEngine || null;
    this.auditService = auditService || null;
    this.metrics = metrics || null;
    this.eventBus = eventBus || null;
    this.eventPublisher = eventPublisher || null;
    this.outboxService = outboxService || null;
    this.idempotencyManager = idempotencyManager || null;
    this.tenantResolver = tenantResolver || null;
    this.logger = logger || console;
    this.tracer = tracer || null;
    this.clock = clock || Date;

    this.options = {
      ...DEFAULTS,
      ...(configuration || {}),
    };

    this.runtime = {
      initialized: false,
      stopping: false,
      startedAt: now(this.clock),
      activeUpdates: new Map(),
      activeFingerprints: new Map(),
      lastUpdateAt: null,
      lastFailureAt: null,
      lastFailureCode: null,
    };

    this.statistics = {
      received: 0,
      updated: 0,
      noop: 0,
      duplicate: 0,
      pending: 0,
      successful: 0,
      failed: 0,
      cancelled: 0,
      reversed: 0,
      unknown: 0,
      reconciliationRequired: 0,
      rejected: 0,
      lookupAttempts: 0,
      lookupFailures: 0,
      lookupTimeouts: 0,
      transitionAttempts: 0,
      transitionFailures: 0,
      concurrentConflicts: 0,
      idempotencyChecks: 0,
      idempotencyConflicts: 0,
      auditFailures: 0,
      eventFailures: 0,
      tenantFailures: 0,
      securityRejections: 0,
    };
  }

  async initialize() {
    this.runtime.initialized = true;
    this.runtime.stopping = false;
    return this;
  }

  async shutdown() {
    this.runtime.stopping = true;
    this.runtime.activeUpdates.clear();
    this.runtime.activeFingerprints.clear();
    this.runtime.initialized = false;
  }

  async update(input = {}, options = {}) {
    return this.updatePaymentState(input, options);
  }

  async updatePaymentState(input = {}, options = {}) {
    const startedAt = Date.now();
    const span = this.startSpan('airtel.payment.state.update', input?.context || {});
    let activeContext = null;
    let activeLockKey = null;

    try {
      await this.assertReady();

      const request = this.normalizeRequest(input, options);
      const context = await this.buildTrustedContext(request);
      const callback = request.callback;
      const callbackFingerprint = this.buildCallbackFingerprint(callback, context.tenantId);
      context.callbackFingerprint = callbackFingerprint;
      activeContext = context;
      activeLockKey = `${context.tenantId}:${callbackFingerprint}`;

      this.assertCapacity(context, callbackFingerprint);

      this.statistics.received += 1;

      const lockKey = activeLockKey;
      this.runtime.activeUpdates.set(context.correlationId, {
        startedAt: Date.now(),
        tenantId: context.tenantId,
        callbackFingerprint,
      });
      this.runtime.activeFingerprints.set(lockKey, {
        startedAt: Date.now(),
        correlationId: context.correlationId,
      });

      const transaction = await this.resolvePayment({
        callback,
        context,
        transaction: request.transaction,
        session: request.session,
      });

      this.assertPaymentTenant(transaction, context);

      const currentState = paymentStatus(transaction) || PAYMENT_STATES.INITIATED;
      const outcome = normalizeOutcome(
        callback.outcome ||
        callback.providerOutcome ||
        callback.status ||
        callback.providerStatus,
      );

      const targetState = outcomeToState(
        outcome,
        currentState,
        this.options,
      );

      const validated = this.validateProviderEvidence({
        callback,
        context,
        transaction,
        outcome,
        currentState,
        targetState,
      });

      if (outcome === CALLBACK_OUTCOMES.DUPLICATE) {
        this.statistics.duplicate += 1;
        return this.buildResult({
          status: UPDATE_STATUS.DUPLICATE,
          currentState,
          targetState: currentState,
          outcome,
          transaction,
          callback,
          context,
          callbackFingerprint,
          durationMs: Date.now() - startedAt,
        });
      }

      if (currentState === targetState) {
        this.statistics.noop += 1;
        const result = this.buildResult({
          status: UPDATE_STATUS.NOOP,
          currentState,
          targetState,
          outcome,
          transaction,
          callback,
          context,
          callbackFingerprint,
          durationMs: Date.now() - startedAt,
          reason: 'PAYMENT_ALREADY_IN_TARGET_STATE',
        });

        await this.safeAudit('AIRTEL_PAYMENT_STATE_NOOP', context, result);
        return result;
      }

      if (!validated.allowed) {
        this.statistics.rejected += 1;
        throw createError(
          validated.code,
          validated.message,
          {
            statusCode: validated.statusCode || 409,
            retryable: false,
            tenantId: context.tenantId,
            correlationId: context.correlationId,
            operationId: context.operationId,
          },
        );
      }

      const transitionContext = this.buildStateMachineContext({
        callback,
        context,
        transaction,
        outcome,
        targetState,
        callbackFingerprint,
      });

      const transitionResult = await this.executeTransition({
        transaction,
        targetState,
        context: transitionContext,
        session: request.session,
      });

      const result = this.buildResult({
        status: UPDATE_STATUS.UPDATED,
        currentState,
        targetState,
        outcome,
        transaction,
        callback,
        context,
        callbackFingerprint,
        transitionResult,
        durationMs: Date.now() - startedAt,
      });

      this.recordOutcome(outcome, targetState);
      await this.safeAudit('AIRTEL_PAYMENT_STATE_UPDATED', context, result);
      await this.publishEvent('AIRTEL_PAYMENT_STATE_UPDATED', context, result);

      this.runtime.lastUpdateAt = now(this.clock);

      return result;
    } catch (error) {
      this.statistics.transitionFailures += 1;
      this.runtime.lastFailureAt = now(this.clock);
      this.runtime.lastFailureCode = error?.code || 'AIRTEL_PAYMENT_STATE_UPDATE_FAILED';
      this.incrementMetric('airtel_payment_state_update_failures_total', 1);
      throw error;
    } finally {
      if (activeContext?.correlationId) {
        this.runtime.activeUpdates.delete(activeContext.correlationId);
      }
      if (activeLockKey) {
        this.runtime.activeFingerprints.delete(activeLockKey);
      }
      this.incrementMetric('airtel_payment_state_update_duration_ms', Date.now() - startedAt);
      span?.end?.();
    }
  }

  async apply(input = {}, options = {}) {
    return this.updatePaymentState(input, options);
  }

  async process(input = {}, options = {}) {
    return this.updatePaymentState(input, options);
  }

  async transitionFromCallback(input = {}, options = {}) {
    return this.updatePaymentState(input, options);
  }

  normalizeRequest(input = {}, options = {}) {
    const envelope = isObject(input) && !Array.isArray(input) && (
      Object.prototype.hasOwnProperty.call(input, 'callback') ||
      Object.prototype.hasOwnProperty.call(input, 'payload') ||
      Object.prototype.hasOwnProperty.call(input, 'context') ||
      Object.prototype.hasOwnProperty.call(input, 'tenantId') ||
      Object.prototype.hasOwnProperty.call(input, 'session')
    );

    const callback = envelope
      ? (input.callback ?? input.payload ?? input.data)
      : input;

    if (!isObject(callback) || Array.isArray(callback)) {
      throw createError(
        'AIRTEL_PAYMENT_STATE_CALLBACK_REQUIRED',
        'Airtel callback payload is required.',
        { statusCode: 400 },
      );
    }

    if (bytes(callback) > Number(this.options.maxCallbackBytes)) {
      throw createError(
        'AIRTEL_PAYMENT_STATE_CALLBACK_TOO_LARGE',
        'Airtel callback payload exceeds the configured size limit.',
        { statusCode: 413 },
      );
    }

    const context = envelope
      ? { ...(input.context || {}) }
      : {};

    const mergedContext = {
      ...context,
      tenantId: context.tenantId || input.tenantId || options.tenantId,
      correlationId: context.correlationId || input.correlationId || options.correlationId,
      operationId: context.operationId || input.operationId || options.operationId,
      requestId: context.requestId || input.requestId || options.requestId,
      actorId: context.actorId || input.actorId || options.actorId,
      actorType: context.actorType || input.actorType || options.actorType,
      actorRole: context.actorRole || input.actorRole || options.actorRole,
      signatureVerified: context.signatureVerified === true || input.signatureVerified === true || options.signatureVerified === true,
      securityVerified: context.securityVerified === true || input.securityVerified === true || options.securityVerified === true,
      authenticated: context.authenticated === true || input.authenticated === true || options.authenticated === true,
      trustedCallback: context.trustedCallback === true || input.trustedCallback === true || options.trustedCallback === true,
    };

    return {
      callback,
      context: mergedContext,
      transaction: envelope ? (input.transaction || input.payment || null) : null,
      session: envelope ? (input.session || null) : null,
    };
  }

  async buildTrustedContext(request) {
    const context = request.context || {};
    let tenantId = text(context.tenantId, 256);

    if (!tenantId && this.tenantResolver) {
      const method = firstFunction(this.tenantResolver, [
        'resolveTrustedTenant',
        'resolveTenant',
        'resolve',
      ]);

      if (method) {
        try {
          const resolved = await this.tenantResolver[method](context);
          tenantId = text(resolved?.id || resolved?.tenantId || resolved, 256);
        } catch (error) {
          this.statistics.tenantFailures += 1;
          throw createError(
            'AIRTEL_PAYMENT_STATE_TENANT_RESOLUTION_FAILED',
            'Trusted tenant resolution failed.',
            { statusCode: 403, retryable: false, cause: error },
          );
        }
      }
    }

    if (!tenantId && this.options.requireTenantId) {
      this.statistics.tenantFailures += 1;
      throw createError(
        'AIRTEL_PAYMENT_STATE_TENANT_REQUIRED',
        'Trusted tenant context is required for payment state update.',
        { statusCode: 403, retryable: false },
      );
    }

    if (this.options.requireSecurityVerification) {
      const verified = Boolean(
        context.signatureVerified ||
        context.securityVerified ||
        context.trustedCallback,
      );

      if (!verified) {
        this.statistics.securityRejections += 1;
        throw createError(
          'AIRTEL_PAYMENT_STATE_SECURITY_VERIFICATION_REQUIRED',
          'Airtel callback must be security-verified before payment state mutation.',
          { statusCode: 401, retryable: false },
        );
      }
    }

    return {
      ...context,
      tenantId,
      provider: PROVIDER,
      operation: OPERATION,
      correlationId: text(context.correlationId, 256) || id(),
      operationId: text(context.operationId, 256) || id(),
      requestId: text(context.requestId, 256),
      actorId: actorId(context),
      actorType: upper(context.actorType) || 'SYSTEM',
      authenticated: Boolean(context.authenticated),
      signatureVerified: Boolean(context.signatureVerified),
      securityVerified: Boolean(context.securityVerified || context.signatureVerified || context.trustedCallback),
      trustedCallback: Boolean(context.trustedCallback),
      fromCallback: true,
    };
  }

  safeNormalizeCallbackForFingerprint(input) {
    if (!input) return null;
    const callback = input.callback || input.payload || input.data || input;
    return isObject(callback) && !Array.isArray(callback) ? callback : null;
  }

  buildCallbackFingerprint(callback, tenantId) {
    return sha256({
      schemaVersion: SCHEMA_VERSION,
      provider: PROVIDER,
      operation: OPERATION,
      tenantId: tenantId || null,
      callbackId: providerEventId(callback),
      providerTransactionId: providerTransactionId(callback),
      paymentReference: paymentReference(callback),
      transactionReference: transactionReference(callback),
      externalId: externalId(callback),
      status: normalizeStatus(callback.status || callback.providerStatus || callback.transactionStatus),
      outcome: normalizeOutcome(callback.outcome || callback.providerOutcome || callback.status),
      amount: amount(callback),
      amountMinor: amountMinor(callback),
      currency: currency(callback),
      occurredAt: occurredAt(callback),
    });
  }

  async resolvePayment({ callback, context, transaction = null, session = null }) {
    if (transaction) {
      this.assertPaymentTenant(transaction, context);
      return transaction;
    }

    if (!this.repository && this.options.requireRepositoryForLookup) {
      throw createError(
        'AIRTEL_PAYMENT_STATE_REPOSITORY_UNAVAILABLE',
        'Airtel payment repository is required for payment-state lookup.',
        { statusCode: 503, retryable: true },
      );
    }

    if (!this.repository) {
      throw createError(
        'AIRTEL_PAYMENT_STATE_REPOSITORY_UNAVAILABLE',
        'Airtel payment repository is not configured.',
        { statusCode: 503, retryable: true },
      );
    }

    const referenceCandidates = [
      ['findByProviderTransactionId', providerTransactionId(callback)],
      ['findByProviderReference', providerTransactionId(callback)],
      ['findByPaymentReference', paymentReference(callback)],
      ['findByTransactionReference', transactionReference(callback)],
      ['findByExternalId', externalId(callback)],
      ['findByTransactionId', firstValue(callback, ['transactionId', 'transaction.id'])],
      ['findById', firstValue(callback, ['paymentId', 'id'])],
    ];

    for (const [method, reference] of referenceCandidates) {
      if (!reference || !isFunction(this.repository?.[method])) continue;

      try {
        this.statistics.lookupAttempts += 1;
        const query = {
          tenantId: context.tenantId,
          provider: PROVIDER,
          operation: OPERATION,
          providerTransactionId: providerTransactionId(callback),
          providerReference: providerTransactionId(callback),
          paymentReference: paymentReference(callback),
          transactionReference: transactionReference(callback),
          externalId: externalId(callback),
          transactionId: firstValue(callback, ['transactionId', 'transaction.id']),
          paymentId: firstValue(callback, ['paymentId']),
          reference,
          session,
        };

        const result = await this.executeWithRetryAndTimeout(
          () => {
            if (method === 'findByExternalId') {
              return this.repository[method](reference, context.tenantId, { session });
            }
            if (method === 'findById') {
              return this.repository[method](reference, context.tenantId, { session });
            }
            return this.repository[method](query);
          },
          context,
        );

        if (result) {
          this.assertPaymentTenant(result, context);
          return result;
        }
      } catch (error) {
        this.statistics.lookupFailures += 1;
        if (error?.code === 'AIRTEL_PAYMENT_STATE_LOOKUP_TIMEOUT') this.statistics.lookupTimeouts += 1;
        if (!isRetryable(error)) throw error;
        if (this.options.maxLookupRetries <= 0) throw error;
      }
    }

    throw createError(
      'AIRTEL_PAYMENT_NOT_FOUND',
      'No Airtel payment was found for the trusted callback identity.',
      {
        statusCode: 404,
        retryable: false,
        tenantId: context.tenantId,
        correlationId: context.correlationId,
      },
    );
  }

  assertPaymentTenant(payment, context) {
    if (!payment) return;
    const tenantId = entityTenantId(payment);
    if (this.options.requireTenantId && tenantId && tenantId !== context.tenantId) {
      throw createError(
        'AIRTEL_PAYMENT_STATE_TENANT_MISMATCH',
        'Payment belongs to a different tenant.',
        {
          statusCode: 403,
          retryable: false,
          tenantId: context.tenantId,
        },
      );
    }
  }

  validateProviderEvidence({ callback, context, transaction, outcome, currentState, targetState }) {
    if (this.options.requireCallbackIdentity) {
      const identity = providerTransactionId(callback) || paymentReference(callback) || transactionReference(callback) || externalId(callback);
      if (!identity) {
        return {
          allowed: false,
          code: 'AIRTEL_PAYMENT_STATE_CALLBACK_IDENTITY_REQUIRED',
          message: 'Airtel callback requires a provider, payment, transaction, or external reference.',
          statusCode: 400,
        };
      }
    }

    if (this.options.requireProviderTransactionIdForSuccess && outcome === CALLBACK_OUTCOMES.SUCCESS && !providerTransactionId(callback)) {
      return {
        allowed: false,
        code: 'AIRTEL_PAYMENT_STATE_PROVIDER_REFERENCE_REQUIRED',
        message: 'Successful Airtel payment state update requires a provider transaction identity.',
        statusCode: 409,
      };
    }

    if (this.options.requirePaymentReferenceForSuccess && outcome === CALLBACK_OUTCOMES.SUCCESS && !paymentReference(callback)) {
      return {
        allowed: false,
        code: 'AIRTEL_PAYMENT_STATE_PAYMENT_REFERENCE_REQUIRED',
        message: 'Successful Airtel payment state update requires a payment reference.',
        statusCode: 409,
      };
    }

    if (this.options.requireCurrencyMatch) {
      const paymentCurrency = upper(firstValue(transaction, ['currency', 'money.currency']));
      const callbackCurrency = currency(callback);
      if (paymentCurrency && callbackCurrency && paymentCurrency !== callbackCurrency) {
        return {
          allowed: false,
          code: 'AIRTEL_PAYMENT_STATE_CURRENCY_MISMATCH',
          message: 'Airtel callback currency does not match the payment.',
          statusCode: 409,
        };
      }
    }

    if (!this.options.allowSuccessWithoutAmountMatch && outcome === CALLBACK_OUTCOMES.SUCCESS) {
      const paymentAmountMinor = number(firstValue(transaction, ['amountMinor', 'money.amountMinor']));
      const callbackAmountMinor = amountMinor(callback);

      if (paymentAmountMinor !== null && callbackAmountMinor !== null && paymentAmountMinor !== callbackAmountMinor) {
        return {
          allowed: false,
          code: 'AIRTEL_PAYMENT_STATE_AMOUNT_MISMATCH',
          message: 'Airtel callback amount does not match the payment.',
          statusCode: 409,
        };
      }
    }

    if (outcome === CALLBACK_OUTCOMES.REVERSED && !firstValue(callback, ['reversalPaymentId', 'reversalId', 'reversalPaymentReference'])) {
      return {
        allowed: false,
        code: 'AIRTEL_PAYMENT_STATE_REVERSAL_REFERENCE_REQUIRED',
        message: 'Airtel payment reversal requires a reversal reference.',
        statusCode: 409,
      };
    }

    if (outcome === CALLBACK_OUTCOMES.SUCCESS && currentState === PAYMENT_STATES.FAILED && !this.options.allowSuccessFromFailed) {
      return {
        allowed: false,
        code: 'AIRTEL_PAYMENT_STATE_SUCCESS_FROM_FAILED_REQUIRES_RECONCILIATION',
        message: 'A successful provider callback cannot directly revive a failed payment.',
        statusCode: 409,
      };
    }

    if (targetState === PAYMENT_STATES.REQUIRES_RECONCILIATION) {
      return {
        allowed: true,
        code: null,
        message: null,
        reconciliationRequired: true,
      };
    }

    return {
      allowed: true,
      code: null,
      message: null,
    };
  }

  buildStateMachineContext({ callback, context, transaction, outcome, targetState, callbackFingerprint }) {
    const transactionId = entityId(transaction);
    const providerReference = providerTransactionId(callback);
    const providerEvent = providerEventId(callback);
    const reasonCode = text(
      callback.reasonCode ||
      callback.providerReasonCode ||
      callback.responseCode ||
      (outcome === CALLBACK_OUTCOMES.SUCCESS ? 'AIRTEL_PROVIDER_CONFIRMED' : `AIRTEL_PROVIDER_${outcome}`),
      256,
    );

    return {
      ...context,
      provider: PROVIDER,
      providerTransactionId: providerReference,
      providerEventId: providerEvent,
      providerStatus: normalizeStatus(callback.status || callback.providerStatus || callback.transactionStatus),
      providerTimestamp: occurredAt(callback),
      providerConfirmed: outcome === CALLBACK_OUTCOMES.SUCCESS,
      providerFailed: outcome === CALLBACK_OUTCOMES.FAILED,
      fromCallback: true,
      allowProviderEvidence: true,
      idempotencyKey: `AIRTEL_CALLBACK_STATE:${context.tenantId}:${callbackFingerprint}`,
      reason: text(callback.reason || callback.providerReasonMessage || `Airtel provider outcome: ${outcome}`, 1000),
      reasonCode,
      reversalPaymentId: text(firstValue(callback, ['reversalPaymentId', 'reversalId']), 256),
      financialTransactionId: text(firstValue(callback, ['financialTransactionId', 'transactionId']), 256),
      persistenceContext: context.persistenceContext || null,
      metadata: safeClone({
        callbackFingerprint,
        callbackId: providerEvent,
        providerReference,
        paymentReference: paymentReference(callback),
        transactionReference: transactionReference(callback),
        targetState,
        outcome,
        amount: amount(callback),
        amountMinor: amountMinor(callback),
        currency: currency(callback),
      }),
      paymentId: transactionId,
    };
  }

  async executeTransition({ transaction, targetState, context, session }) {
    this.statistics.transitionAttempts += 1;

    if (!this.stateMachine) {
      if (this.options.requirePaymentStateMachine) {
        throw createError(
          'AIRTEL_PAYMENT_STATE_MACHINE_UNAVAILABLE',
          'Canonical Payment State Machine is required.',
          { statusCode: 503, retryable: true },
        );
      }

      return this.executeRepositoryFallbackTransition({
        transaction,
        targetState,
        context,
        session,
      });
    }

    if (isFunction(this.stateMachine.applyProviderResult)) {
      return this.stateMachine.applyProviderResult(
        transaction,
        {
          provider: PROVIDER,
          status: context.providerStatus,
          providerStatus: context.providerStatus,
          providerTransactionId: context.providerTransactionId,
          providerEventId: context.providerEventId,
          confirmed: context.providerConfirmed,
          failed: context.providerFailed,
          timestamp: context.providerTimestamp,
          reversalPaymentId: context.reversalPaymentId,
          transactionId: context.financialTransactionId,
        },
        context,
      );
    }

    if (isFunction(this.stateMachine.transition)) {
      return this.stateMachine.transition(
        transaction,
        targetState,
        {
          ...context,
          persistenceContext: session || context.persistenceContext || null,
        },
      );
    }

    throw createError(
      'AIRTEL_PAYMENT_STATE_MACHINE_CONTRACT_INVALID',
      'Configured Payment State Machine exposes no supported transition method.',
      { statusCode: 503, retryable: true },
    );
  }

  async executeRepositoryFallbackTransition({ transaction, targetState, context, session }) {
    if (!this.repository) {
      throw createError(
        'AIRTEL_PAYMENT_STATE_REPOSITORY_UNAVAILABLE',
        'Payment repository is required for fallback state mutation.',
        { statusCode: 503, retryable: true },
      );
    }

    const method = firstFunction(this.repository, [
      'compareAndSetStatus',
      'updateStatusAtomic',
      'transitionStatus',
      'atomicStateTransition',
    ]);

    if (!method && this.options.requireAtomicRepositoryMutation) {
      throw createError(
        'AIRTEL_PAYMENT_STATE_ATOMIC_MUTATION_REQUIRED',
        'An atomic payment-state repository transition method is required.',
        { statusCode: 503, retryable: true },
      );
    }

    if (!method) {
      throw createError(
        'AIRTEL_PAYMENT_STATE_REPOSITORY_CONTRACT_INVALID',
        'Payment repository does not expose an atomic state mutation method.',
        { statusCode: 503, retryable: true },
      );
    }

    return this.repository[method]({
      id: entityId(transaction),
      paymentId: entityId(transaction),
      tenantId: context.tenantId,
      provider: PROVIDER,
      operation: OPERATION,
      expectedStatus: paymentStatus(transaction),
      expectedStatuses: [paymentStatus(transaction)],
      nextStatus: targetState,
      status: targetState,
      providerReference: context.providerTransactionId,
      providerTransactionId: context.providerTransactionId,
      providerEventId: context.providerEventId,
      providerStatus: context.providerStatus,
      correlationId: context.correlationId,
      operationId: context.operationId,
      idempotencyKey: context.idempotencyKey,
      updatedAt: now(this.clock),
      session,
    });
  }

  buildResult({
    status,
    currentState,
    targetState,
    outcome,
    transaction,
    callback,
    context,
    callbackFingerprint,
    transitionResult = null,
    durationMs = 0,
    reason = null,
  }) {
    const paymentId = entityId(transaction);

    return {
      provider: PROVIDER,
      operation: OPERATION,
      schemaVersion: SCHEMA_VERSION,
      engineVersion: ENGINE_VERSION,
      status,
      outcome,
      providerOutcome: outcome,
      currentState,
      targetState,
      changed: status === UPDATE_STATUS.UPDATED,
      duplicate: status === UPDATE_STATUS.DUPLICATE,
      tenantId: context?.tenantId || null,
      paymentId,
      transactionId: text(firstValue(transaction, ['transactionId']) || callback?.transactionId, 256),
      callbackId: providerEventId(callback),
      providerTransactionId: providerTransactionId(callback),
      paymentReference: paymentReference(callback),
      transactionReference: transactionReference(callback),
      providerStatus: normalizeStatus(callback.status || callback.providerStatus || callback.transactionStatus),
      callbackFingerprint,
      correlationId: context?.correlationId || null,
      operationId: context?.operationId || null,
      requestId: context?.requestId || null,
      reason: reason || text(callback.reason || callback.providerReasonMessage, 1000),
      reversalPaymentId: text(firstValue(callback, ['reversalPaymentId', 'reversalId']), 256),
      financialBoundary: FINANCIAL_BOUNDARY,
      financialSettlement: false,
      transition: safeClone(transitionResult),
      timestamp: now(this.clock).toISOString(),
      durationMs: Number(durationMs || 0),
    };
  }

  recordOutcome(outcome, targetState) {
    switch (outcome) {
      case CALLBACK_OUTCOMES.SUCCESS:
        this.statistics.successful += 1;
        break;
      case CALLBACK_OUTCOMES.PENDING:
        this.statistics.pending += 1;
        break;
      case CALLBACK_OUTCOMES.FAILED:
        this.statistics.failed += 1;
        break;
      case CALLBACK_OUTCOMES.CANCELLED:
        this.statistics.cancelled += 1;
        break;
      case CALLBACK_OUTCOMES.REVERSED:
        this.statistics.reversed += 1;
        break;
      case CALLBACK_OUTCOMES.UNKNOWN:
        this.statistics.unknown += 1;
        break;
      default:
        break;
    }

    if (targetState === PAYMENT_STATES.REQUIRES_RECONCILIATION) {
      this.statistics.reconciliationRequired += 1;
    }

    this.statistics.updated += 1;
    this.incrementMetric(
      'airtel_payment_state_updates_total',
      1,
      { outcome, targetState },
    );
  }

  async safeAudit(action, context, result) {
    if (!this.options.audit || !this.auditService) return;

    const method = firstFunction(this.auditService, [
      'record',
      'audit',
      'write',
    ]);

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
        metadata: safeClone(result),
        at: now(this.clock).toISOString(),
      });
    } catch (error) {
      this.statistics.auditFailures += 1;
      this.log('error', 'Airtel payment state audit failed', {
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

  async publishEvent(type, context, result) {
    if (!this.options.publishEvents) return;

    const event = {
      type,
      provider: PROVIDER,
      operation: OPERATION,
      tenantId: context?.tenantId || null,
      correlationId: context?.correlationId || null,
      operationId: context?.operationId || null,
      payload: safeClone(result),
      at: now(this.clock).toISOString(),
    };

    try {
      if (this.outboxService) {
        const method = firstFunction(this.outboxService, [
          'enqueue',
          'publish',
          'append',
        ]);
        if (method) {
          await this.outboxService[method](event);
          return;
        }
      }

      const publisher = this.eventBus || this.eventPublisher;
      const method = firstFunction(publisher, [
        'publish',
        'emit',
        'send',
      ]);

      if (method) {
        await publisher[method](event);
      }
    } catch (error) {
      this.statistics.eventFailures += 1;
      this.log('error', 'Airtel payment state event publication failed', {
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

  assertCapacity(context, callbackFingerprint) {
    this.pruneLocalLocks();

    if (this.runtime.activeUpdates.size >= Number(this.options.maxConcurrentUpdates)) {
      throw createError(
        'AIRTEL_PAYMENT_STATE_CAPACITY_EXCEEDED',
        'Airtel payment state updater concurrency capacity is exhausted.',
        { statusCode: 503, retryable: true },
      );
    }

    const key = `${context.tenantId}:${callbackFingerprint}`;

    if (this.runtime.activeFingerprints.has(key)) {
      throw createError(
        'AIRTEL_PAYMENT_STATE_CALLBACK_IN_FLIGHT',
        'The same Airtel callback is already being processed.',
        { statusCode: 409, retryable: true },
      );
    }
  }

  pruneLocalLocks() {
    const cutoff = Date.now() - Number(this.options.localLockTtlMs);

    for (const [key, entry] of this.runtime.activeFingerprints.entries()) {
      if (entry.startedAt < cutoff) {
        this.runtime.activeFingerprints.delete(key);
        this.runtime.activeUpdates.delete(entry.correlationId);
      }
    }
  }

  async assertReady() {
    if (!this.runtime.initialized) await this.initialize();

    if (this.runtime.stopping) {
      throw createError(
        'AIRTEL_PAYMENT_STATE_UPDATER_STOPPING',
        'Airtel payment state updater is stopping.',
        { statusCode: 503, retryable: true },
      );
    }

    if (this.options.requirePaymentStateMachine && !this.stateMachine) {
      throw createError(
        'AIRTEL_PAYMENT_STATE_MACHINE_UNAVAILABLE',
        'Canonical Payment State Machine is not configured.',
        { statusCode: 503, retryable: true },
      );
    }

    if (this.options.requireRepositoryForLookup && !this.repository) {
      throw createError(
        'AIRTEL_PAYMENT_STATE_REPOSITORY_UNAVAILABLE',
        'Payment repository is not configured.',
        { statusCode: 503, retryable: true },
      );
    }
  }

  async executeWithRetryAndTimeout(operation, context) {
    const maxRetries = Math.max(0, Number(this.options.maxLookupRetries) || 0);
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await this.executeWithTimeout(
          operation,
          context,
        );
      } catch (error) {
        lastError = error;
        if (attempt >= maxRetries || !isRetryable(error)) throw error;
        await this.sleep(Number(this.options.retryBackoffMs) * (attempt + 1));
      }
    }

    throw lastError;
  }

  async executeWithTimeout(operation, context) {
    const timeoutMs = Math.max(1, Number(this.options.lookupTimeoutMs) || 5000);
    let timer;

    return Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(createError(
            'AIRTEL_PAYMENT_STATE_LOOKUP_TIMEOUT',
            'Airtel payment lookup timed out.',
            {
              statusCode: 504,
              retryable: true,
              uncertain: true,
              tenantId: context?.tenantId,
              correlationId: context?.correlationId,
            },
          ));
        }, timeoutMs);
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  async sleep(ms) {
    if (!ms) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  incrementMetric(name, value = 1, labels = undefined) {
    try {
      const method = firstFunction(this.metrics, [
        'increment',
        'inc',
        'counter',
      ]);

      if (!method) return;

      if (labels !== undefined) {
        this.metrics[method](name, value, labels);
      } else {
        this.metrics[method](name, value);
      }
    } catch {
      // Metrics are advisory and cannot change financial correctness.
    }
  }

  startSpan(name, context = {}) {
    try {
      if (!isFunction(this.tracer?.startSpan)) return null;

      return this.tracer.startSpan(name, {
        attributes: {
          'titech.provider': PROVIDER,
          'titech.operation': OPERATION,
          'titech.tenant_id': text(context?.tenantId, 256) || 'unknown',
          'titech.correlation_id': text(context?.correlationId, 256) || 'unknown',
          'titech.operation_id': text(context?.operationId, 256) || 'unknown',
        },
      });
    } catch {
      return null;
    }
  }

  log(level, message, metadata = {}) {
    try {
      const method = isFunction(this.logger?.[level]) ? level : 'info';
      this.logger?.[method]?.({
        message,
        provider: PROVIDER,
        component: COMPONENT,
        ...safeClone(metadata),
      });
    } catch {
      // Logging must never alter payment-state semantics.
    }
  }

  async health() {
    const ready = Boolean(
      this.repository &&
      this.stateMachine &&
      !this.runtime.stopping,
    );

    return {
      status: ready ? 'UP' : 'DOWN',
      provider: PROVIDER,
      operation: OPERATION,
      component: COMPONENT,
      engine: ENGINE_NAME,
      version: ENGINE_VERSION,
      schemaVersion: SCHEMA_VERSION,
      initialized: this.runtime.initialized,
      tenantIsolation: true,
      stateMachineConfigured: Boolean(this.stateMachine),
      repositoryConfigured: Boolean(this.repository),
      activeUpdates: this.runtime.activeUpdates.size,
      activeFingerprints: this.runtime.activeFingerprints.size,
      uptimeMs: Date.now() - this.runtime.startedAt.getTime(),
      checkedAt: now(this.clock).toISOString(),
    };
  }

  async readiness() {
    const health = await this.health();
    return { ready: health.status === 'UP', ...health };
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
    return Boolean(
      this.runtime.initialized &&
      !this.runtime.stopping &&
      this.stateMachine,
    );
  }

  capabilities() {
    return {
      provider: PROVIDER,
      operation: OPERATION,
      paymentStateMutation: true,
      providerEvidenceMapping: true,
      tenantIsolation: true,
      callbackFingerprint: true,
      localConcurrencyProtection: true,
      canonicalStateMachineDelegation: Boolean(this.stateMachine),
      repositoryLookup: Boolean(this.repository),
      repositoryFallbackAtomicMutation: Boolean(this.repository),
      directProviderHttp: false,
      directLedgerMutation: false,
      directBalanceMutation: false,
      directWalletMutation: false,
      settlementFinality: false,
      reconciliationExecution: false,
      fraudAdjudication: false,
      authoritativeFinancialBoundary: FINANCIAL_BOUNDARY,
    };
  }

  statisticsSnapshot() {
    return safeClone(this.statistics);
  }

  diagnostics() {
    return {
      provider: PROVIDER,
      operation: OPERATION,
      component: COMPONENT,
      engine: ENGINE_NAME,
      version: ENGINE_VERSION,
      schemaVersion: SCHEMA_VERSION,
      runtime: {
        initialized: this.runtime.initialized,
        stopping: this.runtime.stopping,
        activeUpdates: this.runtime.activeUpdates.size,
        activeFingerprints: this.runtime.activeFingerprints.size,
        lastUpdateAt: this.runtime.lastUpdateAt?.toISOString?.() || null,
        lastFailureAt: this.runtime.lastFailureAt?.toISOString?.() || null,
        lastFailureCode: this.runtime.lastFailureCode,
      },
      dependencies: {
        repository: Boolean(this.repository),
        stateMachine: Boolean(this.stateMachine),
        auditService: Boolean(this.auditService),
        eventBus: Boolean(this.eventBus),
        eventPublisher: Boolean(this.eventPublisher),
        outboxService: Boolean(this.outboxService),
        idempotencyManager: Boolean(this.idempotencyManager),
        tenantResolver: Boolean(this.tenantResolver),
      },
      policy: safeClone(this.options),
      financialBoundary: {
        providerHttp: false,
        ledgerWrites: false,
        balanceMutation: false,
        walletMutation: false,
        settlementFinality: false,
        reconciliationExecution: false,
        authoritativeBoundary: FINANCIAL_BOUNDARY,
      },
      capabilities: this.capabilities(),
      statistics: this.statisticsSnapshot(),
    };
  }

  snapshot() {
    return this.diagnostics();
  }
}

export function createAirtelPaymentStateUpdater(options = {}) {
  return new AirtelPaymentStateUpdater(options);
}

export function createPaymentStateUpdater(options = {}) {
  return new AirtelPaymentStateUpdater(options);
}

export const CONSTANTS = Object.freeze({
  PROVIDER,
  OPERATION,
  COMPONENT,
  ENGINE_NAME,
  ENGINE_VERSION,
  SCHEMA_VERSION,
  FINANCIAL_BOUNDARY,
  PAYMENT_STATES,
  CALLBACK_OUTCOMES,
  UPDATE_STATUS,
  DEFAULTS,
});

export {
  normalizeOutcome,
  outcomeToState,
  providerTransactionId,
  providerEventId,
  paymentReference,
  transactionReference,
  externalId,
  normalizePhone,
  safeClone,
};

export default AirtelPaymentStateUpdater;