/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Callback Correlation Engine
 * =============================================================================
 *
 * Architectural role
 * ------------------
 * Canonical, tenant-scoped correlation boundary between a validated Airtel
 * callback and an existing TITech payment/collection/transaction intent.
 *
 * Execution boundary
 * ------------------
 * HTTP/controller -> signature/validation boundary -> this correlator ->
 * callback processor -> financial core/reconciliation.
 *
 * Responsibilities
 * ----------------
 * - Require a trusted tenant context; never infer tenant identity from payload.
 * - Normalize correlation identifiers and callback metadata.
 * - Detect previously accepted/processed callbacks through authoritative
 *   read-only duplicate checks when available.
 * - Resolve exact and progressively weaker correlation candidates.
 * - Detect conflicting candidates rather than silently selecting one.
 * - Produce deterministic confidence, match evidence and explainability.
 * - Expose the legacy processor contract: correlate(),
 *   executeCorrelationLookup(), executeCorrelationIntelligence(), and
 *   determineCallbackRoute().
 * - Provide bounded retry/timeout controls around repository lookups.
 * - Publish sanitized audit/events and operational metrics.
 * - Provide health, readiness, diagnostics and runtime statistics.
 *
 * Explicitly NOT responsible for
 * --------------------------------
 * - HTTP transport or response acknowledgement.
 * - Airtel OAuth/API calls.
 * - Signature verification or cryptographic authentication.
 * - Callback schema validation owned by callbackValidator/signatureVerifier.
 * - Payment execution/provider communication.
 * - Direct ledger posting, balance mutation or wallet mutation.
 * - Settlement finality.
 * - Reconciliation execution.
 * - Fraud adjudication or AML/KYC decisions.
 * - Callback raw-payload persistence.
 *
 * Security principles
 * -------------------
 * 1. Tenant identity is trusted only from the already-authenticated execution
 *    context or an explicitly trusted dependency; callback payload tenant IDs
 *    are ignored for security decisions.
 * 2. Financial identity is scoped by tenant + provider + operation + semantic
 *    reference. Cross-tenant matches are never accepted.
 * 3. Weak identifiers (phone, amount, time) cannot auto-process a callback.
 * 4. Conflicting high-confidence candidates fail closed to REVIEW.
 * 5. Audit/event payloads never contain raw callback payloads or secrets.
 * 6. Cache is an optimization only; repository truth remains authoritative.
 * 7. Duplicate detection never mutates financial state.
 * 8. Queue/local/offline state is never treated as settlement proof.
 *
 * Module format
 * -------------
 * ES module. The backend package is type=module.
 *
 * =============================================================================
 */

import crypto from 'node:crypto';

class CallbackCorrelationValidationError extends Error {
  constructor(message = 'Invalid Airtel callback correlation request.', options = {}) {
    super(message);
    this.name = 'ValidationError';
    this.code = options.code || 'AIRTEL_CALLBACK_CORRELATION_VALIDATION';
    this.statusCode = Number(options.statusCode || 400);
    this.retryable = Boolean(options.retryable);
  }
}

const ValidationError = CallbackCorrelationValidationError;

function normalizeError(error) {
  if (error instanceof AirtelCallbackCorrelationError) return error;
  return {
    message: error?.message || 'Unexpected Airtel callback correlation failure.',
    code: error?.code || error?.name || 'AIRTEL_CALLBACK_CORRELATION_FAILED',
    httpStatus: Number(error?.httpStatus || error?.statusCode) || 500,
    statusCode: Number(error?.statusCode || error?.httpStatus) || 500,
    retryable: Boolean(error?.retryable),
  };
}

const PROVIDER = 'AIRTEL';
const OPERATION = 'CALLBACK';
const COMPONENT = 'titech.airtel.callbacks.correlation';
const ENGINE_NAME = 'airtel-callback-correlation';
const ENGINE_VERSION = '5.1.0';
const SCHEMA_VERSION = 5;
const HASH_ALGORITHM = 'sha256';
const FINANCIAL_BOUNDARY = 'TITECH_FINANCIAL_CORE';

const HEALTH_STATUS = Object.freeze({
  STARTING: 'STARTING',
  READY: 'READY',
  DEGRADED: 'DEGRADED',
  STOPPING: 'STOPPING',
  DOWN: 'DOWN',
});

const CORRELATION_STATUS = Object.freeze({
  MATCHED: 'MATCHED',
  PARTIAL: 'PARTIAL',
  UNKNOWN: 'UNKNOWN',
  DUPLICATE: 'DUPLICATE',
  REVIEW: 'REVIEW',
  FAILED: 'FAILED',
});

const MATCH_TYPE = Object.freeze({
  PROVIDER_REFERENCE: 'PROVIDER_REFERENCE',
  TRANSACTION_REFERENCE: 'TRANSACTION_REFERENCE',
  PAYMENT_REFERENCE: 'PAYMENT_REFERENCE',
  EXTERNAL_REFERENCE: 'EXTERNAL_REFERENCE',
  CUSTOMER_REFERENCE: 'CUSTOMER_REFERENCE',
  PHONE_AMOUNT: 'PHONE_AMOUNT',
  PHONE_NUMBER: 'PHONE_NUMBER',
  AMOUNT_TIME_WINDOW: 'AMOUNT_TIME_WINDOW',
  FALLBACK: 'FALLBACK',
  NONE: 'NONE',
});

const CONFIDENCE = Object.freeze({
  VERY_HIGH: 100,
  HIGH: 95,
  STRONG: 90,
  MEDIUM: 75,
  LOW: 55,
  UNKNOWN: 0,
});

const DUPLICATE_STATUS = Object.freeze({
  CONFIRMED: 'CONFIRMED',
  NOT_FOUND: 'NOT_FOUND',
  UNAVAILABLE: 'UNAVAILABLE',
  UNKNOWN: 'UNKNOWN',
});

const ROUTES = Object.freeze({
  PROCESS_PAYMENT: 'PROCESS_PAYMENT',
  MANUAL_REVIEW: 'MANUAL_REVIEW',
  FRAUD_REVIEW: 'FRAUD_REVIEW',
  UNKNOWN_QUEUE: 'UNKNOWN_QUEUE',
  FAILED_QUEUE: 'FAILED_QUEUE',
});

const DEFAULTS = Object.freeze({
  confidenceThreshold: 90,
  reviewThreshold: 60,
  cacheTTLSeconds: 300,
  maxCorrelationAgeMinutes: 1440,
  amountTimeWindowMinutes: 15,
  maxCandidatesPerStrategy: 10,
  correlationTimeoutMs: 5000,
  lookupTimeoutMs: 2500,
  maxRetries: 2,
  retryBackoffMs: 100,
  duplicateWindowSeconds: 86400,
  maxActiveCorrelations: 250,
  maxCacheEntries: 1000,
  requireTenantId: true,
  requireLookupRepository: true,
  requireDuplicateReader: true,
  failClosedOnMissingTenant: true,
  failClosedOnLookupError: true,
  failClosedOnFraudIntelligenceError: true,
  allowWeakMatchAutoProcess: false,
  publishEvents: true,
  audit: true,
  failClosedOnAuditError: false,
  failClosedOnEventError: false,
  cacheResolvedEntity: false,
  enabledStrategies: Object.freeze([
    'PROVIDER_REFERENCE',
    'PAYMENT_REFERENCE',
    'TRANSACTION_REFERENCE',
    'EXTERNAL_REFERENCE',
    'CUSTOMER_REFERENCE',
    'PHONE_AMOUNT',
    'PHONE_NUMBER',
    'AMOUNT_TIME_WINDOW',
  ]),
});

const SENSITIVE_KEYS = /(?:authorization|cookie|token|secret|password|signature|credential|private.?key|api.?key|otp|pin|cvv|cvc|pan|^raw$|raw.?body|raw.?payload|payload|request|response)/i;
const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function isFn(value) {
  return typeof value === 'function';
}

function nowFrom(clock) {
  const value = isFn(clock?.now) ? clock.now() : Date.now();
  return new Date(value);
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeUpper(value) {
  if (value === null || value === undefined) return null;
  const result = String(value).trim().toUpperCase();
  return result || null;
}

function normalizeReference(value, maxLength = 256) {
  if (value === null || value === undefined) return null;
  const result = String(value).trim();
  if (!result) return null;
  return result.slice(0, maxLength);
}

function normalizePhone(value) {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/[^0-9]/g, '');
  if (!digits) return null;
  if (digits.startsWith('256') && digits.length === 12) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 10) return `+256${digits.slice(1)}`;
  if (digits.length >= 9 && digits.length <= 15) return `+${digits}`;
  return null;
}

function canonicalJson(value) {
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isObject(value)) {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return JSON.stringify(value);
  }
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function sha256(value) {
  return crypto.createHash(HASH_ALGORITHM).update(String(value)).digest('hex');
}

function stableFingerprint(value) {
  return sha256(canonicalJson(value));
}

function cloneSafe(value, depth = 0) {
  if (depth > 5) return '[DEPTH_LIMIT]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return String(value);
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[BUFFER_SHA256:${sha256(value)}]`;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => cloneSafe(item, depth + 1));

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (BLOCKED_KEYS.has(key)) continue;
    if (SENSITIVE_KEYS.test(key)) continue;
    output[key] = cloneSafe(item, depth + 1);
  }
  return output;
}

function safeIdentifier(value) {
  const normalized = normalizeReference(value, 256);
  return normalized ? normalized : null;
}

function getValue(object, paths = []) {
  for (const path of paths) {
    let cursor = object;
    for (const segment of path.split('.')) {
      if (!isObject(cursor) && !Array.isArray(cursor)) {
        cursor = undefined;
        break;
      }
      cursor = cursor?.[segment];
    }
    if (cursor !== undefined && cursor !== null && cursor !== '') return cursor;
  }
  return null;
}

function unwrapRepositoryResult(result) {
  if (!result) return null;
  if (Array.isArray(result)) return result;
  if (result.document) return unwrapRepositoryResult(result.document);
  if (result.record) return unwrapRepositoryResult(result.record);
  if (result.item) return unwrapRepositoryResult(result.item);
  if (Array.isArray(result.data)) return result.data;
  if (result.data && isObject(result.data)) return result.data;
  return result;
}

function toArray(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function hasOwn(value, key) {
  return isObject(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function getEntityId(entity) {
  return safeIdentifier(getValue(entity, ['id', '_id', 'uuid', 'paymentId', 'collectionId', 'transactionId']));
}

function entityType(entity) {
  const explicit = normalizeUpper(getValue(entity, ['entityType', 'type', 'kind', 'operationType']));
  if (explicit) return explicit;
  if (hasOwn(entity, 'collectionId')) return 'COLLECTION';
  if (hasOwn(entity, 'paymentId')) return 'PAYMENT';
  if (hasOwn(entity, 'transactionId')) return 'TRANSACTION';
  return 'PAYMENT';
}

function extractEntityIdentity(entity) {
  return {
    id: getEntityId(entity),
    entityType: entityType(entity),
    paymentId: safeIdentifier(getValue(entity, ['paymentId'])),
    collectionId: safeIdentifier(getValue(entity, ['collectionId'])),
    transactionId: safeIdentifier(getValue(entity, ['transactionId', 'idempotencyTransactionId'])),
    providerReference: normalizeReference(getValue(entity, [
      'providerReference',
      'providerTransactionId',
      'providerTransactionReference',
      'airtelMoneyId',
      'airtelTransactionId',
    ])),
    transactionReference: normalizeReference(getValue(entity, [
      'transactionReference',
      'transaction.reference',
      'reference',
    ])),
    paymentReference: normalizeReference(getValue(entity, [
      'paymentReference',
      'payment.reference',
    ])),
    externalReference: normalizeReference(getValue(entity, [
      'externalReference',
      'external.reference',
      'clientReference',
    ])),
    customerReference: normalizeReference(getValue(entity, [
      'customerReference',
      'customer.reference',
      'customerId',
      'memberId',
    ])),
    phoneNumber: normalizePhone(getValue(entity, [
      'phoneNumber',
      'phone',
      'msisdn',
      'customer.phoneNumber',
      'customer.phone',
      'payer.phoneNumber',
      'payer.phone',
    ])),
    amountMinor: toFiniteNumber(getValue(entity, [
      'amountMinor',
      'amountInMinorUnits',
      'money.amountMinor',
    ])),
    amount: toFiniteNumber(getValue(entity, ['amount', 'money.amount'])),
    currency: normalizeUpper(getValue(entity, ['currency', 'money.currency'])),
    status: normalizeUpper(getValue(entity, ['status', 'state', 'paymentStatus'])),
    createdAt: getValue(entity, ['createdAt', 'initiatedAt', 'requestedAt', 'created'] ),
  };
}

function normalizeAmountMinor(callback = {}) {
  const explicit = toFiniteNumber(getValue(callback, ['amountMinor', 'amountInMinorUnits', 'money.amountMinor']));
  if (explicit !== null) return Math.round(explicit);

  const amount = toFiniteNumber(getValue(callback, ['amount', 'money.amount']));
  if (amount === null) return null;

  const currency = normalizeUpper(getValue(callback, ['currency', 'money.currency'])) || 'UGX';
  const minorExponent = Number(getValue(callback, ['minorUnitExponent', 'currencyExponent'])) || (currency === 'UGX' ? 0 : 2);
  return Math.round(amount * (10 ** minorExponent));
}

function deriveProviderOutcome(callback = {}) {
  const status = normalizeUpper(getValue(callback, ['status', 'transactionStatus', 'resultCode', 'event.status']));
  if (callback.success === true || ['SUCCESS', 'SUCCEEDED', 'COMPLETED', 'SETTLED', 'CONFIRMED', '0'].includes(status)) return 'SUCCESS';
  if (callback.success === false || ['FAILED', 'FAILURE', 'REJECTED', 'DECLINED', 'ERROR', 'CANCELLED'].includes(status)) return 'FAILURE';
  if (['PENDING', 'PROCESSING', 'QUEUED', 'ACCEPTED', 'IN_PROGRESS'].includes(status)) return 'PENDING';
  return 'UNKNOWN';
}

function normalizeCallback(callback = {}, receivedAt = new Date()) {
  if (!isObject(callback) || Array.isArray(callback)) {
    throw new ValidationError('Airtel callback payload is required.');
  }

  const normalized = {
    provider: PROVIDER,
    operation: normalizeUpper(callback.operation) || normalizeUpper(callback.transactionType) || null,
    callbackId: normalizeReference(getValue(callback, ['callbackId', 'id', 'notificationId', 'eventId', 'event.id'])),
    transactionId: normalizeReference(getValue(callback, ['transactionId', 'event.transactionId', 'transaction.id'])),
    transactionReference: normalizeReference(getValue(callback, ['transactionReference', 'transaction.reference'])),
    reference: normalizeReference(getValue(callback, ['reference', 'transactionReference'])),
    paymentReference: normalizeReference(getValue(callback, ['paymentReference', 'payment.reference'])),
    providerReference: normalizeReference(getValue(callback, [
      'providerReference',
      'providerTransactionId',
      'providerTransactionReference',
      'airtelMoneyId',
      'airtelTransactionId',
      'transactionId',
    ])),
    externalReference: normalizeReference(getValue(callback, [
      'externalReference',
      'external.reference',
      'clientReference',
      'merchantReference',
    ])),
    customerReference: normalizeReference(getValue(callback, [
      'customerReference',
      'customer.reference',
      'customerId',
      'memberId',
      'subscriberId',
    ])),
    phoneNumber: normalizePhone(getValue(callback, [
      'phoneNumber',
      'phone',
      'msisdn',
      'customer.phoneNumber',
      'customer.phone',
      'payer.phoneNumber',
      'payer.phone',
    ])),
    amountMinor: normalizeAmountMinor(callback),
    amount: toFiniteNumber(getValue(callback, ['amount', 'money.amount'])),
    currency: normalizeUpper(getValue(callback, ['currency', 'money.currency'])) || 'UGX',
    status: normalizeUpper(getValue(callback, ['status', 'transactionStatus', 'resultCode', 'event.status'])) || 'UNKNOWN',
    providerOutcome: deriveProviderOutcome(callback),
    success: callback.success === true ? true : callback.success === false ? false : null,
    timestamp: getValue(callback, ['timestamp', 'createdAt', 'event.timestamp', 'transactionTime']) || null,
    receivedAt: new Date(receivedAt),
  };

  if (!normalized.providerReference && normalized.transactionId) {
    normalized.providerReference = normalized.transactionId;
  }

  return Object.freeze(normalized);
}

function buildCallbackFingerprint(callback) {
  const logical = {
    provider: PROVIDER,
    operation: OPERATION,
    callbackId: callback.callbackId,
    providerReference: callback.providerReference,
    transactionId: callback.transactionId,
    transactionReference: callback.transactionReference,
    paymentReference: callback.paymentReference,
    externalReference: callback.externalReference,
    customerReference: callback.customerReference,
    phoneNumber: callback.phoneNumber ? sha256(callback.phoneNumber) : null,
    amountMinor: callback.amountMinor,
    currency: callback.currency,
    status: callback.status,
  };

  return stableFingerprint(logical);
}

function compareExact(a, b) {
  if (!a || !b) return false;
  return String(a).trim().toUpperCase() === String(b).trim().toUpperCase();
}

function amountMatches(callback, entity) {
  if (callback.amountMinor !== null && entity.amountMinor !== null) {
    return callback.amountMinor === entity.amountMinor;
  }
  if (callback.amount !== null && entity.amount !== null) {
    return Math.abs(callback.amount - entity.amount) < 0.000001;
  }
  return false;
}

function currencyMatches(callback, entity) {
  if (!callback.currency || !entity.currency) return true;
  return compareExact(callback.currency, entity.currency);
}

function normalizeTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function withinMinutes(timestamp, minutes, clock = Date) {
  const date = normalizeTimestamp(timestamp);
  if (!date) return false;
  const current = nowFrom(clock).getTime();
  const diff = Math.abs(current - date.getTime());
  return diff <= minutes * 60 * 1000;
}

function errorCode(error) {
  return normalizeReference(error?.code || error?.name, 128) || 'UNKNOWN_ERROR';
}

function isRetryableError(error) {
  if (!error) return false;
  if (error.retryable === true) return true;
  if (error.name === 'ValidationError') return false;
  if (errorCode(error).includes('NOT_FOUND')) return false;
  if (error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408 && error.statusCode !== 429) return false;
  return true;
}

function extractStatus(record) {
  return normalizeUpper(getValue(record, ['status', 'state', 'processingStatus', 'lifecycleStatus']));
}

function duplicateRecordIsAuthoritative(record) {
  if (!record) return false;
  if (record === true) return true;
  const status = extractStatus(record);
  if (['COMMITTED', 'PROCESSED', 'COMPLETED', 'SUCCESS', 'SUCCEEDED', 'ACCEPTED', 'SETTLED', 'CONFIRMED', 'FINALIZED'].includes(status)) return true;
  if (record.processed === true || record.processedAt) return true;
  if (record.settled === true || record.settledAt) return true;
  return false;
}

export class AirtelCallbackCorrelationError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'AirtelCallbackCorrelationError';
    this.code = options.code || 'AIRTEL_CALLBACK_CORRELATION_FAILED';
    this.statusCode = Number(options.statusCode || 500);
    this.retryable = Boolean(options.retryable);
    this.uncertain = Boolean(options.uncertain);
    this.tenantId = safeIdentifier(options.tenantId);
    this.correlationId = safeIdentifier(options.correlationId);
    this.operationId = safeIdentifier(options.operationId);
    this.cause = options.cause;
    this.details = cloneSafe(options.details || {});
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      retryable: this.retryable,
      uncertain: this.uncertain,
      tenantId: this.tenantId,
      correlationId: this.correlationId,
      operationId: this.operationId,
      details: this.details,
    };
  }
}

export class AirtelCallbackCorrelationEngine {
  constructor({
    paymentRepository,
    transactionRepository,
    collectionRepository,
    paymentIntentRepository,
    tenantRepository,
    tenantResolver,
    callbackRepository,
    customerRepository,
    accountRepository,
    idempotencyManager,
    fraudEngine,
    riskEngine,
    amlService,
    auditService,
    metrics,
    tracer,
    logger,
    eventBus,
    outboxService,
    cache,
    configuration = {},
    clock = Date,
  } = {}) {
    this.paymentRepository = paymentRepository || null;
    this.transactionRepository = transactionRepository || null;
    this.collectionRepository = collectionRepository || null;
    this.paymentIntentRepository = paymentIntentRepository || null;
    this.tenantRepository = tenantRepository || null;
    this.tenantResolver = tenantResolver || null;
    this.callbackRepository = callbackRepository || null;
    this.customerRepository = customerRepository || null;
    this.accountRepository = accountRepository || null;
    this.idempotencyManager = idempotencyManager || null;
    this.fraudEngine = fraudEngine || null;
    this.riskEngine = riskEngine || null;
    this.amlService = amlService || null;
    this.auditService = auditService || null;
    this.metrics = metrics || null;
    this.tracer = tracer || null;
    this.logger = logger || null;
    this.eventBus = eventBus || null;
    this.outboxService = outboxService || null;
    this.cache = cache || null;
    this.configuration = configuration || {};
    this.clock = clock || Date;

    this.options = {
      ...DEFAULTS,
      ...this.configuration,
      enabledStrategies: Array.isArray(this.configuration.enabledStrategies)
        ? [...new Set(this.configuration.enabledStrategies.map(normalizeUpper).filter(Boolean))]
        : [...DEFAULTS.enabledStrategies],
    };

    this.runtime = {
      initialized: false,
      stopping: false,
      startedAt: nowFrom(this.clock),
      activeCorrelations: new Map(),
      activeFingerprints: new Map(),
      localCache: new Map(),
      lastCorrelation: null,
      lastSuccessfulCorrelation: null,
      lastFailure: null,
      lastHealthCheck: null,
      lastSuccessfulHealthCheck: null,
    };

    this.healthState = {
      status: HEALTH_STATUS.STARTING,
      dependenciesHealthy: false,
      degradedReasons: [],
    };

    this.statistics = {
      callbacksReceived: 0,
      callbacksMatched: 0,
      callbacksPartial: 0,
      callbacksUnknown: 0,
      callbacksDuplicate: 0,
      callbacksReviewed: 0,
      callbacksFailed: 0,
      tenantContextFailures: 0,
      duplicateChecksConfirmed: 0,
      duplicateChecksUnavailable: 0,
      providerReferenceMatches: 0,
      paymentReferenceMatches: 0,
      transactionReferenceMatches: 0,
      externalReferenceMatches: 0,
      customerReferenceMatches: 0,
      phoneMatches: 0,
      amountTimeMatches: 0,
      conflictingCandidates: 0,
      repositoryLookups: 0,
      repositoryLookupFailures: 0,
      repositoryLookupTimeouts: 0,
      cacheHits: 0,
      cacheMisses: 0,
      intelligenceEvaluations: 0,
      intelligenceReviews: 0,
      fraudReviews: 0,
      auditFailures: 0,
      eventFailures: 0,
      totalConfidence: 0,
      averageConfidence: 0,
      retries: 0,
      recoveryAttempts: 0,
      startedAt: nowFrom(this.clock),
    };

    this.initializationPromise = null;
    this._sequence = 0;
  }

  async initialize() {
    if (this.runtime.initialized && !this.runtime.stopping) return this;
    if (this.initializationPromise) return this.initializationPromise;

    this.initializationPromise = (async () => {
      this.healthState.status = HEALTH_STATUS.STARTING;
      this.runtime.stopping = false;
      const diagnostics = await this.dependencyDiagnostics();
      this.healthState.dependenciesHealthy = diagnostics.ready;
      this.healthState.degradedReasons = diagnostics.degradedReasons;
      this.healthState.status = diagnostics.ready ? HEALTH_STATUS.READY : HEALTH_STATUS.DEGRADED;
      this.runtime.initialized = true;
      this.log('info', 'Airtel callback correlation engine initialized', {
        status: this.healthState.status,
        dependencyReadiness: diagnostics.ready,
      });
      return this;
    })().finally(() => {
      this.initializationPromise = null;
    });

    return this.initializationPromise;
  }

  async shutdown() {
    if (this.runtime.stopping || this.healthState.status === HEALTH_STATUS.DOWN) return;
    this.runtime.stopping = true;
    this.healthState.status = HEALTH_STATUS.STOPPING;
    this.runtime.activeCorrelations.clear();
    this.runtime.activeFingerprints.clear();
    this.runtime.localCache.clear();
    this.healthState.status = HEALTH_STATUS.DOWN;
    this.runtime.initialized = false;
  }

  async assertReady() {
    if (!this.runtime.initialized) await this.initialize();
    if (this.options.requireLookupRepository && !this.paymentRepository && !this.collectionRepository && !this.transactionRepository && !this.paymentIntentRepository) {
      throw new AirtelCallbackCorrelationError('Airtel callback correlation lookup repositories are not configured.', {
        code: 'AIRTEL_CALLBACK_CORRELATION_REPOSITORY_UNAVAILABLE',
        statusCode: 503,
        retryable: true,
      });
    }
    if (this.options.requireDuplicateReader && !this.callbackRepository && !this.idempotencyManager) {
      throw new AirtelCallbackCorrelationError('An authoritative duplicate reader is required for Airtel callback correlation.', {
        code: 'AIRTEL_CALLBACK_CORRELATION_DUPLICATE_READER_UNAVAILABLE',
        statusCode: 503,
        retryable: true,
      });
    }
    if (this.runtime.stopping || this.healthState.status === HEALTH_STATUS.DOWN) {
      throw new AirtelCallbackCorrelationError('Airtel callback correlation engine is unavailable.', {
        code: 'AIRTEL_CALLBACK_CORRELATION_UNAVAILABLE',
        statusCode: 503,
        retryable: true,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Public contract
  // ---------------------------------------------------------------------------

  async correlate({ tenantId, callback, correlationId = crypto.randomUUID(), requestId = null, traceId = null, context = {} } = {}) {
    const correlationContext = this.createCorrelationContext({
      tenantId,
      correlationId,
      requestId,
      traceId,
      context,
    });

    const startedAt = Date.now();
    const fingerprint = buildCallbackFingerprint(normalizeCallback(callback, nowFrom(this.clock)));
    const activityKey = `${correlationContext.tenantId}:${correlationId}`;
    const fingerprintActivityKey = `${correlationContext.tenantId}:fingerprint:${fingerprint}`;

    await this.assertReady();
    this.assertCapacity(activityKey, correlationContext);
    this.assertFingerprintCapacity(fingerprintActivityKey, correlationContext);
    this.statistics.callbacksReceived += 1;
    this.runtime.activeCorrelations.set(activityKey, { startedAt, tenantId: correlationContext.tenantId, fingerprint });
    this.runtime.activeFingerprints.set(fingerprintActivityKey, { startedAt, tenantId: correlationContext.tenantId, fingerprint });

    const span = this.startSpan('airtel.callback.correlation', correlationContext);

    try {
      const normalizedCallback = normalizeCallback(callback, nowFrom(this.clock));
      const result = await this.executeCorrelationLookup({
        callback: normalizedCallback,
        context: correlationContext,
        callbackFingerprint: fingerprint,
      });

      const intelligence = await this.executeCorrelationIntelligence({
        callback: normalizedCallback,
        context: correlationContext,
        correlationResult: result,
      });

      const enriched = {
        ...result,
        intelligence,
        callbackFingerprint: fingerprint,
      };

      enriched.route = this.determineCallbackRoute({
        ...enriched,
        fraudSignals: intelligence?.signals || result?.fraudSignals || [],
      });
      enriched.decision = intelligence?.decision?.action || 'RECONCILIATION_REQUIRED';

      await this.completeCorrelation({
        context: correlationContext,
        callback: normalizedCallback,
        result: enriched,
        startedAt,
      });

      return enriched;
    } catch (error) {
      this.statistics.callbacksFailed += 1;
      this.runtime.lastFailure = {
        at: nowFrom(this.clock),
        code: errorCode(error),
        correlationId,
      };
      await this.safeAudit('AIRTEL_CALLBACK_CORRELATION_FAILED', correlationContext, {
        code: errorCode(error),
        retryable: Boolean(error?.retryable),
      });
      this.metric('titech_airtel_callback_correlation_failures_total', 1);
      throw this.toCorrelationError(error, correlationContext);
    } finally {
      this.runtime.activeCorrelations.delete(activityKey);
      this.runtime.activeFingerprints.delete(fingerprintActivityKey);
      span?.end?.();
    }
  }

  async correlateCallback(args = {}) {
    return this.correlate(args);
  }

  async findCorrelation(args = {}) {
    return this.executeCorrelationLookup(args);
  }

  async executeCorrelationLookup({ callback, context, callbackFingerprint = null } = {}) {
    const validatedContext = this.validateContext(context);
    const normalizedCallback = normalizeCallback(callback, nowFrom(this.clock));
    const fingerprint = callbackFingerprint || buildCallbackFingerprint(normalizedCallback);
    const startedAt = Date.now();
    const span = this.startSpan('airtel.callback.correlation.lookup', validatedContext);

    try {
      await this.safeAudit('AIRTEL_CALLBACK_CORRELATION_STARTED', validatedContext, {
        callbackFingerprint: fingerprint,
        operation: normalizedCallback.operation,
      });

      const duplicate = await this.detectDuplicateCallback({
        tenantId: validatedContext.tenantId,
        callback: normalizedCallback,
        callbackFingerprint: fingerprint,
        context: validatedContext,
      });

      if (duplicate.confirmed) {
        this.statistics.callbacksDuplicate += 1;
        const result = this.buildResult({
          status: CORRELATION_STATUS.DUPLICATE,
          correlationId: validatedContext.correlationId,
          tenantId: validatedContext.tenantId,
          callback: normalizedCallback,
          callbackFingerprint: fingerprint,
          confidence: CONFIDENCE.VERY_HIGH,
          matchType: MATCH_TYPE.NONE,
          entity: duplicate.entity || null,
          duplicate: true,
          duplicateEvidence: duplicate.evidence,
          duplicateStatus: duplicate.status,
          lookupDurationMs: Date.now() - startedAt,
        });
        await this.safeAudit('AIRTEL_CALLBACK_DUPLICATE_DETECTED', validatedContext, this.auditMetadata(result));
        this.recordCorrelationMetrics(result);
        return result;
      }

      const cached = await this.getCachedCorrelation({
        tenantId: validatedContext.tenantId,
        callback: normalizedCallback,
        callbackFingerprint: fingerprint,
        context: validatedContext,
      });

      if (cached?.entityId) {
        const hydrated = await this.hydrateCachedEntity(cached, validatedContext);
        if (hydrated) {
          const result = this.finalizeCandidateResult({
            candidate: hydrated,
            strategy: cached.strategy || 'CACHE',
            strategyConfidence: cached.confidence || CONFIDENCE.STRONG,
            candidates: [],
            callback: normalizedCallback,
            context: validatedContext,
            fingerprint,
            duplicateStatus: duplicate.status,
            lookupDurationMs: Date.now() - startedAt,
          });
          if (result.status !== CORRELATION_STATUS.UNKNOWN) {
            return result;
          }
        }
      }

      const candidates = await this.collectCandidates({
        callback: normalizedCallback,
        context: validatedContext,
      });

      const result = this.resolveCandidateSet({
        callback: normalizedCallback,
        context: validatedContext,
        candidates,
        callbackFingerprint: fingerprint,
        lookupDurationMs: Date.now() - startedAt,
      });

      if (result.matched) {
        await this.setCachedCorrelation({
          tenantId: validatedContext.tenantId,
          callback: normalizedCallback,
          callbackFingerprint: fingerprint,
          result,
        });
      } else {
        this.statistics.callbacksUnknown += 1;
        await this.processUnknownCallback({
          context: validatedContext,
          callback: normalizedCallback,
          result,
        });
      }

      await this.safeAudit('AIRTEL_CALLBACK_CORRELATION_COMPLETED', validatedContext, this.auditMetadata(result));
      this.recordCorrelationMetrics(result);
      return result;
    } catch (error) {
      this.statistics.repositoryLookupFailures += 1;
      throw this.toCorrelationError(error, validatedContext);
    } finally {
      this.metric('titech_airtel_callback_correlation_lookup_duration_ms', Date.now() - startedAt);
      span?.end?.();
    }
  }

  async executeCorrelationIntelligence({ callback, context, correlationResult } = {}) {
    const validatedContext = this.validateContext(context);
    const normalizedCallback = normalizeCallback(callback, nowFrom(this.clock));
    this.statistics.intelligenceEvaluations += 1;
    const span = this.startSpan('airtel.callback.correlation.intelligence', validatedContext);

    try {
      const signals = [];
      const decisions = [];

      if (correlationResult?.status === CORRELATION_STATUS.REVIEW) {
        signals.push('CORRELATION_REVIEW');
        decisions.push('MANUAL_REVIEW');
      }
      if (correlationResult?.status === CORRELATION_STATUS.UNKNOWN) {
        signals.push('CORRELATION_UNKNOWN');
        decisions.push('RECONCILIATION_REQUIRED');
      }
      if (correlationResult?.conflict) {
        signals.push('CONFLICTING_CANDIDATES');
        decisions.push('MANUAL_REVIEW');
      }

      const fraud = await this.evaluateFraudRisk({
        tenantId: validatedContext.tenantId,
        callback: normalizedCallback,
        correlationResult,
        context: validatedContext,
      });

      signals.push(...fraud.signals);
      if (fraud.requiresReview) decisions.push('FRAUD_REVIEW');

      const provider = await this.evaluateProviderBehavior({
        callback: normalizedCallback,
        correlationResult,
        context: validatedContext,
      });

      if (provider?.signals?.length) signals.push(...provider.signals);

      const decision = this.buildIntelligenceDecision({
        correlationResult,
        fraud,
        provider,
        signals,
        decisions,
      });

      if (decision.reviewRequired) this.statistics.intelligenceReviews += 1;

      const result = {
        schemaVersion: SCHEMA_VERSION,
        provider: PROVIDER,
        correlationId: validatedContext.correlationId,
        tenantId: validatedContext.tenantId,
        signals: [...new Set(signals)],
        decisions: [...new Set(decisions)],
        fraud,
        provider,
        decision,
        generatedAt: nowFrom(this.clock).toISOString(),
      };

      await this.publishCorrelationEvent('AIRTEL_CALLBACK_CORRELATION_INTELLIGENCE', validatedContext, {
        status: correlationResult?.status || CORRELATION_STATUS.UNKNOWN,
        confidence: Number(correlationResult?.confidence || 0),
        signals: result.signals,
        decision: decision.action,
      });

      return Object.freeze(result);
    } finally {
      span?.end?.();
    }
  }

  determineCallbackRoute(result = {}) {
    const fraudSignals = Array.isArray(result.fraudSignals) ? result.fraudSignals : [];
    const intelligenceSignals = Array.isArray(result.intelligence?.signals) ? result.intelligence.signals : [];
    const allSignals = [...new Set([...fraudSignals, ...intelligenceSignals])];

    if (allSignals.some((signal) => String(signal).includes('FRAUD') || String(signal).includes('SANCTIONS') || String(signal).includes('AML'))) {
      return ROUTES.FRAUD_REVIEW;
    }
    if (result.status === CORRELATION_STATUS.DUPLICATE) return ROUTES.UNKNOWN_QUEUE;
    if (result.status === CORRELATION_STATUS.MATCHED && Number(result.confidence || 0) >= Number(this.options.confidenceThreshold)) {
      if (result.providerOutcome !== 'SUCCESS') return ROUTES.MANUAL_REVIEW;
      return ROUTES.PROCESS_PAYMENT;
    }
    if (result.status === CORRELATION_STATUS.PARTIAL || result.status === CORRELATION_STATUS.REVIEW) return ROUTES.MANUAL_REVIEW;
    if (result.status === CORRELATION_STATUS.UNKNOWN) return ROUTES.UNKNOWN_QUEUE;
    return ROUTES.FAILED_QUEUE;
  }

  async handleUnknownCallback({ context, callback, correlation } = {}) {
    return this.processUnknownCallback({
      context: this.validateContext(context),
      callback: normalizeCallback(callback, nowFrom(this.clock)),
      result: correlation || null,
    });
  }

  async processUnknownCallback({ context, callback, result } = {}) {
    const safeContext = this.validateContext(context);
    const payload = {
      provider: PROVIDER,
      operation: OPERATION,
      tenantId: safeContext.tenantId,
      correlationId: safeContext.correlationId,
      callbackFingerprint: result?.callbackFingerprint || buildCallbackFingerprint(callback),
      callbackId: callback?.callbackId || null,
      providerReference: callback?.providerReference || null,
      transactionReference: callback?.transactionReference || null,
      paymentReference: callback?.paymentReference || null,
      externalReference: callback?.externalReference || null,
      confidence: Number(result?.confidence || 0),
      reason: result?.reason || 'NO_DETERMINISTIC_MATCH',
    };

    await this.safeAudit('AIRTEL_CALLBACK_UNKNOWN', safeContext, payload);
    await this.publishCorrelationEvent('AIRTEL_CALLBACK_UNKNOWN', safeContext, payload);
    this.metric('titech_airtel_callback_unknown_total', 1);
    return payload;
  }

  // ---------------------------------------------------------------------------
  // Context and tenant safety
  // ---------------------------------------------------------------------------

  createCorrelationContext({ tenantId, correlationId, requestId, traceId, context = {} } = {}) {
    const trustedTenantId = safeIdentifier(
      tenantId ||
      context?.tenantId ||
      context?.tenant?.id ||
      context?.trustedTenantId,
    );

    if (!trustedTenantId && this.options.requireTenantId) {
      this.statistics.tenantContextFailures += 1;
      if (this.options.failClosedOnMissingTenant) {
        throw new AirtelCallbackCorrelationError('Trusted tenant context is required for Airtel callback correlation.', {
          code: 'AIRTEL_CALLBACK_TENANT_CONTEXT_REQUIRED',
          statusCode: 403,
          retryable: false,
          tenantId: null,
          correlationId,
        });
      }
    }

    return Object.freeze({
      tenantId: trustedTenantId,
      correlationId: safeIdentifier(correlationId) || crypto.randomUUID(),
      requestId: safeIdentifier(requestId || context?.requestId),
      traceId: safeIdentifier(traceId || context?.traceId),
      provider: PROVIDER,
      operation: OPERATION,
      actor: {
        actorId: safeIdentifier(context?.actorId || context?.actor?.actorId) || 'SYSTEM:AIRTEL_CALLBACK',
        actorType: normalizeUpper(context?.actorType || context?.actor?.actorType) || 'SYSTEM',
      },
    });
  }

  validateContext(context) {
    const tenantId = safeIdentifier(context?.tenantId || context?.tenant?.id);
    const correlationId = safeIdentifier(context?.correlationId) || crypto.randomUUID();
    if (!tenantId && this.options.requireTenantId) {
      throw new AirtelCallbackCorrelationError('Airtel callback correlation requires a trusted tenant ID.', {
        code: 'AIRTEL_CALLBACK_TENANT_CONTEXT_REQUIRED',
        statusCode: 403,
        retryable: false,
        correlationId,
      });
    }

    return {
      ...context,
      tenantId,
      correlationId,
      provider: PROVIDER,
      operation: OPERATION,
    };
  }

  resolveTrustedTenant({ context } = {}) {
    const tenantId = safeIdentifier(context?.tenantId || context?.tenant?.id);
    return tenantId ? { id: tenantId } : null;
  }

  async resolveTenant({ context } = {}) {
    const tenant = this.resolveTrustedTenant({ context });
    if (tenant) return tenant;
    throw new AirtelCallbackCorrelationError('Tenant cannot be inferred from an Airtel callback payload.', {
      code: 'AIRTEL_CALLBACK_TENANT_INFERENCE_BLOCKED',
      statusCode: 403,
      retryable: false,
    });
  }

  assertCapacity(activityKey, context) {
    if (this.runtime.activeCorrelations.size >= Number(this.options.maxActiveCorrelations)) {
      throw new AirtelCallbackCorrelationError('Airtel callback correlation capacity is temporarily exhausted.', {
        code: 'AIRTEL_CALLBACK_CORRELATION_CAPACITY_EXCEEDED',
        statusCode: 503,
        retryable: true,
        tenantId: context?.tenantId,
        correlationId: context?.correlationId,
        details: { maxActiveCorrelations: this.options.maxActiveCorrelations },
      });
    }
    if (this.runtime.activeCorrelations.has(activityKey)) {
      throw new AirtelCallbackCorrelationError('Duplicate correlation operation is already active.', {
        code: 'AIRTEL_CALLBACK_CORRELATION_IN_FLIGHT',
        statusCode: 409,
        retryable: true,
        tenantId: context?.tenantId,
        correlationId: context?.correlationId,
      });
    }
  }

  assertFingerprintCapacity(fingerprintActivityKey, context) {
    const existing = this.runtime.activeFingerprints.get(fingerprintActivityKey);
    if (!existing) return;
    throw new AirtelCallbackCorrelationError('The same Airtel callback fingerprint is already being correlated.', {
      code: 'AIRTEL_CALLBACK_CORRELATION_FINGERPRINT_IN_FLIGHT',
      statusCode: 409,
      retryable: true,
      tenantId: context?.tenantId,
      correlationId: context?.correlationId,
    });
  }

  // ---------------------------------------------------------------------------
  // Candidate collection
  // ---------------------------------------------------------------------------

  async collectCandidates({ callback, context }) {
    const candidates = [];
    const strategies = [
      ['PROVIDER_REFERENCE', () => this.findByProviderReference({ context, callback })],
      ['PAYMENT_REFERENCE', () => this.findByPaymentReference({ context, callback })],
      ['TRANSACTION_REFERENCE', () => this.findTransaction({ context, callback })],
      ['EXTERNAL_REFERENCE', () => this.findByExternalReference({ context, callback })],
      ['CUSTOMER_REFERENCE', () => this.findByCustomerReference({ context, callback })],
      ['PHONE_AMOUNT', () => this.findByPhoneAndAmount({ context, callback })],
      ['PHONE_NUMBER', () => this.findByPhoneNumber({ context, callback })],
      ['AMOUNT_TIME_WINDOW', () => this.findByAmountTimeWindow({ context, callback })],
    ];

    for (const [strategy, execute] of strategies) {
      if (!this.options.enabledStrategies.includes(strategy)) continue;
      let result = null;
      try {
        result = await execute();
      } catch (error) {
        if (isRetryableError(error) && this.options.failClosedOnLookupError) throw error;
        this.log('warn', 'Airtel callback correlation strategy failed', {
          strategy,
          tenantId: context.tenantId,
          correlationId: context.correlationId,
          code: errorCode(error),
        });
      }

      for (const record of toArray(unwrapRepositoryResult(result)).slice(0, Number(this.options.maxCandidatesPerStrategy))) {
        const candidate = this.buildCandidate({
          entity: record,
          strategy,
          callback,
          context,
        });
        if (candidate) candidates.push(candidate);
      }
    }

    return this.dedupeCandidates(candidates);
  }

  buildCandidate({ entity, strategy, callback, context }) {
    if (!entity || Array.isArray(entity)) return null;
    const identity = extractEntityIdentity(entity);
    if (!identity.id && !identity.paymentId && !identity.collectionId && !identity.transactionId) return null;

    const entityTenantId = safeIdentifier(getValue(entity, ['tenantId', 'tenant.id']));
    if (entityTenantId && context?.tenantId && entityTenantId !== context.tenantId) return null;

    const entityProvider = normalizeUpper(getValue(entity, ['provider', 'paymentProvider']));
    if (entityProvider && entityProvider !== PROVIDER) return null;

    if (identity.providerReference && callback.providerReference && !compareExact(identity.providerReference, callback.providerReference) && strategy === 'PROVIDER_REFERENCE') return null;
    if (identity.currency && callback.currency && !compareExact(identity.currency, callback.currency)) return null;

    const evidence = [];
    let confidence = 0;

    const add = (type, points, detail) => {
      if (!evidence.some((item) => item.type === type)) {
        evidence.push({ type, points, detail });
        confidence = Math.max(confidence, points);
      }
    };

    switch (strategy) {
      case 'PROVIDER_REFERENCE':
        if (compareExact(identity.providerReference, callback.providerReference)) add(MATCH_TYPE.PROVIDER_REFERENCE, CONFIDENCE.VERY_HIGH, 'Exact provider reference match.');
        break;
      case 'PAYMENT_REFERENCE':
        if (compareExact(identity.paymentReference || identity.reference, callback.paymentReference)) add(MATCH_TYPE.PAYMENT_REFERENCE, CONFIDENCE.HIGH, 'Exact payment reference match.');
        else if (compareExact(identity.transactionReference, callback.paymentReference)) add(MATCH_TYPE.PAYMENT_REFERENCE, CONFIDENCE.HIGH, 'Callback payment reference matches internal transaction reference.');
        break;
      case 'TRANSACTION_REFERENCE':
        if (compareExact(identity.transactionReference, callback.transactionReference) || compareExact(identity.id, callback.transactionId)) add(MATCH_TYPE.TRANSACTION_REFERENCE, CONFIDENCE.HIGH, 'Exact transaction identity match.');
        break;
      case 'EXTERNAL_REFERENCE':
        if (compareExact(identity.externalReference, callback.externalReference)) add(MATCH_TYPE.EXTERNAL_REFERENCE, CONFIDENCE.STRONG, 'Exact external reference match.');
        break;
      case 'CUSTOMER_REFERENCE':
        if (compareExact(identity.customerReference, callback.customerReference)) add(MATCH_TYPE.CUSTOMER_REFERENCE, CONFIDENCE.MEDIUM + 5, 'Exact customer reference match.');
        break;
      case 'PHONE_AMOUNT':
        if (compareExact(identity.phoneNumber, callback.phoneNumber) && amountMatches(callback, identity)) add(MATCH_TYPE.PHONE_AMOUNT, CONFIDENCE.MEDIUM, 'Phone number and amount match.');
        break;
      case 'PHONE_NUMBER':
        if (compareExact(identity.phoneNumber, callback.phoneNumber)) add(MATCH_TYPE.PHONE_NUMBER, CONFIDENCE.LOW, 'Phone number match only.');
        break;
      case 'AMOUNT_TIME_WINDOW':
        if (amountMatches(callback, identity) && withinMinutes(identity.createdAt || identity.updatedAt, this.options.amountTimeWindowMinutes, this.clock)) add(MATCH_TYPE.AMOUNT_TIME_WINDOW, CONFIDENCE.LOW, 'Amount matches inside the configured time window.');
        break;
      default:
        break;
    }

    if (!evidence.length) return null;

    if (!currencyMatches(callback, identity)) return null;

    if (callback.amountMinor !== null && identity.amountMinor !== null && callback.amountMinor !== identity.amountMinor && ['PROVIDER_REFERENCE', 'PAYMENT_REFERENCE', 'TRANSACTION_REFERENCE', 'EXTERNAL_REFERENCE', 'CUSTOMER_REFERENCE'].includes(strategy)) {
      confidence = Math.max(0, confidence - 25);
      evidence.push({ type: 'AMOUNT_CONFLICT', points: -25, detail: 'Reference matched but amount differs.' });
    }

    return {
      entity,
      identity,
      strategy,
      confidence,
      evidence,
      tenantId: context.tenantId,
    };
  }

  dedupeCandidates(candidates) {
    const map = new Map();
    for (const candidate of candidates) {
      const key = `${candidate.identity.entityType}:${candidate.identity.id || candidate.identity.paymentId || candidate.identity.collectionId || candidate.identity.transactionId}`;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, candidate);
        continue;
      }
      existing.confidence = Math.max(existing.confidence, candidate.confidence);
      existing.evidence = [...existing.evidence, ...candidate.evidence.filter((item) => !existing.evidence.some((x) => x.type === item.type))];
      if (candidate.confidence > existing.confidence) existing.strategy = candidate.strategy;
    }
    return [...map.values()].sort((a, b) => b.confidence - a.confidence);
  }

  resolveCandidateSet({ callback, context, candidates, callbackFingerprint, lookupDurationMs }) {
    if (!candidates.length) {
      return this.buildResult({
        status: CORRELATION_STATUS.UNKNOWN,
        matched: false,
        correlationId: context.correlationId,
        tenantId: context.tenantId,
        callback,
        callbackFingerprint,
        confidence: CONFIDENCE.UNKNOWN,
        matchType: MATCH_TYPE.NONE,
        candidates: [],
        candidateCount: 0,
        reason: 'NO_DETERMINISTIC_MATCH',
        lookupDurationMs,
      });
    }

    const top = candidates[0];
    const second = candidates[1] || null;
    const conflict = Boolean(second && this.isConflictingCandidate(top, second));

    if (conflict) {
      this.statistics.conflictingCandidates += 1;
      this.statistics.callbacksReviewed += 1;
      return this.buildResult({
        status: CORRELATION_STATUS.REVIEW,
        matched: false,
        conflict: true,
        correlationId: context.correlationId,
        tenantId: context.tenantId,
        callback,
        callbackFingerprint,
        confidence: top.confidence,
        matchType: top.evidence[0]?.type || MATCH_TYPE.FALLBACK,
        entity: null,
        candidates,
        candidateCount: candidates.length,
        reason: 'CONFLICTING_CORRELATION_CANDIDATES',
        lookupDurationMs,
      });
    }

    const status = this.resolveCorrelationStatus({ confidence: top.confidence, candidate: top, callback });
    if (status === CORRELATION_STATUS.REVIEW) this.statistics.callbacksReviewed += 1;
    if (status === CORRELATION_STATUS.PARTIAL) this.statistics.callbacksPartial += 1;

    const result = this.buildResult({
      status,
      matched: status === CORRELATION_STATUS.MATCHED || status === CORRELATION_STATUS.PARTIAL,
      conflict: false,
      correlationId: context.correlationId,
      tenantId: context.tenantId,
      callback,
      callbackFingerprint,
      confidence: top.confidence,
      matchType: top.evidence[0]?.type || MATCH_TYPE.FALLBACK,
      entity: top.entity,
      candidates,
      candidateCount: candidates.length,
      reason: status === CORRELATION_STATUS.MATCHED ? 'DETERMINISTIC_MATCH' : 'WEAK_OR_REVIEW_MATCH',
      lookupDurationMs,
      explanation: this.buildMatchExplanation(top, candidates),
    });

    if (result.status === CORRELATION_STATUS.MATCHED) this.statistics.callbacksMatched += 1;
    return result;
  }

  isConflictingCandidate(a, b) {
    const aId = getEntityId(a.entity);
    const bId = getEntityId(b.entity);
    if (!aId || !bId || aId === bId) return false;
    return a.confidence >= this.options.reviewThreshold && b.confidence >= this.options.reviewThreshold;
  }

  resolveCorrelationStatus({ confidence, candidate }) {
    if (!candidate?.entity) return CORRELATION_STATUS.UNKNOWN;
    if (confidence >= Number(this.options.confidenceThreshold)) return CORRELATION_STATUS.MATCHED;
    if (confidence >= Number(this.options.reviewThreshold)) {
      return this.options.allowWeakMatchAutoProcess ? CORRELATION_STATUS.PARTIAL : CORRELATION_STATUS.REVIEW;
    }
    return CORRELATION_STATUS.UNKNOWN;
  }

  finalizeCandidateResult({ candidate, strategy, strategyConfidence, candidates, callback, context, fingerprint, duplicateStatus, lookupDurationMs }) {
    const candidateObject = this.buildCandidate({ entity: candidate.entity || candidate, strategy, callback, context });
    if (!candidateObject) return this.buildResult({ status: CORRELATION_STATUS.UNKNOWN, matched: false, callback, context, callbackFingerprint: fingerprint });
    candidateObject.confidence = Math.max(candidateObject.confidence, strategyConfidence || 0);
    const candidateList = [candidateObject, ...(candidates || [])];
    const uniqueCandidates = this.dedupeCandidates(candidateList);
    return this.resolveCandidateSet({
      callback,
      context,
      candidates: uniqueCandidates,
      callbackFingerprint: fingerprint,
      lookupDurationMs,
      duplicateStatus,
    });
  }

  buildMatchExplanation(candidate, candidates = []) {
    return {
      strategy: candidate?.strategy || MATCH_TYPE.NONE,
      confidence: Number(candidate?.confidence || 0),
      candidateCount: candidates.length,
      evidence: cloneSafe(candidate?.evidence || []),
      safeEntity: extractEntityIdentity(candidate?.entity || {}),
    };
  }

  buildResult({
    status,
    correlationId,
    tenantId,
    callback,
    callbackFingerprint,
    confidence = 0,
    matchType = MATCH_TYPE.NONE,
    entity = null,
    candidates = [],
    candidateCount = 0,
    matched = false,
    conflict = false,
    duplicate = false,
    duplicateEvidence = null,
    reason = null,
    lookupDurationMs = 0,
    explanation = null,
  } = {}) {
    const safeEntity = entity ? cloneSafe(entity) : null;
    const identity = extractEntityIdentity(entity || {});
    const result = {
      provider: PROVIDER,
      operation: OPERATION,
      schemaVersion: SCHEMA_VERSION,
      engineVersion: ENGINE_VERSION,
      status,
      providerOutcome: callback?.providerOutcome || deriveProviderOutcome(callback),
      matched,
      correlationId: safeIdentifier(correlationId) || crypto.randomUUID(),
      tenantId: safeIdentifier(tenantId),
      callbackId: callback?.callbackId || null,
      callbackReference: callback?.reference || callback?.transactionReference || null,
      callbackFingerprint,
      matchType,
      strategy: normalizeUpper(matchType),
      confidence: Math.max(0, Math.min(100, Number(confidence) || 0)),
      candidateCount: Number(candidateCount || candidates.length || 0),
      conflict: Boolean(conflict),
      duplicate: Boolean(duplicate),
      duplicateEvidence: cloneSafe(duplicateEvidence),
      duplicateStatus: null,
      reason,
      entity: safeEntity,
      payment: safeEntity && (identity.paymentId || identity.entityType === 'PAYMENT') ? safeEntity : null,
      collection: safeEntity && (identity.collectionId || identity.entityType === 'COLLECTION') ? safeEntity : null,
      transaction: safeEntity && (identity.transactionId || identity.entityType === 'TRANSACTION') ? safeEntity : null,
      paymentId: identity.paymentId || (identity.entityType === 'PAYMENT' ? identity.id : null),
      collectionId: identity.collectionId || (identity.entityType === 'COLLECTION' ? identity.id : null),
      transactionId: identity.transactionId || (identity.entityType === 'TRANSACTION' ? identity.id : null),
      evidence: candidates.map((candidate) => ({
        strategy: candidate.strategy,
        confidence: candidate.confidence,
        evidence: cloneSafe(candidate.evidence),
        entity: extractEntityIdentity(candidate.entity),
      })).slice(0, 20),
      explanation: explanation || null,
      lookupDurationMs: Number(lookupDurationMs || 0),
      generatedAt: nowFrom(this.clock).toISOString(),
    };

    return result;
  }

  auditMetadata(result) {
    return {
      status: result?.status,
      providerOutcome: result?.providerOutcome || null,
      confidence: Number(result?.confidence || 0),
      matchType: result?.matchType || null,
      candidateCount: Number(result?.candidateCount || 0),
      callbackFingerprint: result?.callbackFingerprint || null,
      paymentId: result?.paymentId || null,
      collectionId: result?.collectionId || null,
      transactionId: result?.transactionId || null,
      conflict: Boolean(result?.conflict),
      duplicate: Boolean(result?.duplicate),
      reason: result?.reason || null,
    };
  }

  // ---------------------------------------------------------------------------
  // Lookup strategies
  // ---------------------------------------------------------------------------

  async findByProviderReference({ context, callback }) {
    const reference = callback.providerReference;
    if (!reference) return null;
    return this.executeRepositoryLookup({
      context,
      strategy: 'PROVIDER_REFERENCE',
      repositories: [this.paymentRepository, this.collectionRepository, this.paymentIntentRepository, this.transactionRepository],
      operations: [
        (repository) => this.callRepository(repository, ['findByProviderReference', 'findByExternalProviderReference'], { tenantId: context.tenantId, provider: PROVIDER, providerReference: reference }),
        (repository) => this.callRepository(repository, ['findOne'], { tenantId: context.tenantId, provider: PROVIDER, providerReference: reference }),
      ],
    });
  }

  async findByPaymentReference({ context, callback }) {
    const reference = callback.paymentReference || callback.reference;
    if (!reference) return null;
    return this.executeRepositoryLookup({
      context,
      strategy: 'PAYMENT_REFERENCE',
      repositories: [this.paymentRepository, this.collectionRepository, this.paymentIntentRepository],
      operations: [
        (repository) => this.callRepository(repository, ['findByPaymentReference'], { tenantId: context.tenantId, paymentReference: reference }),
        (repository) => this.callRepository(repository, ['findOne'], { tenantId: context.tenantId, reference, paymentReference: reference }),
      ],
    });
  }

  async findTransaction({ context, callback }) {
    const reference = callback.transactionReference || callback.transactionId;
    if (!reference) return null;
    return this.executeRepositoryLookup({
      context,
      strategy: 'TRANSACTION_REFERENCE',
      repositories: [this.transactionRepository, this.paymentRepository, this.collectionRepository],
      operations: [
        (repository) => this.callRepository(repository, ['findByTransactionReference'], { tenantId: context.tenantId, reference, transactionReference: reference }),
        (repository) => this.callRepository(repository, ['findOne'], { tenantId: context.tenantId, reference, transactionReference: reference, transactionId: reference }),
      ],
    });
  }

  async findByExternalReference({ context, callback }) {
    if (!callback.externalReference) return null;
    return this.executeRepositoryLookup({
      context,
      strategy: 'EXTERNAL_REFERENCE',
      repositories: [this.paymentRepository, this.collectionRepository, this.paymentIntentRepository],
      operations: [
        (repository) => this.callRepository(repository, ['findByExternalReference'], { tenantId: context.tenantId, externalReference: callback.externalReference }),
        (repository) => this.callRepository(repository, ['findOne'], { tenantId: context.tenantId, externalReference: callback.externalReference }),
      ],
    });
  }

  async findByCustomerReference({ context, callback }) {
    if (!callback.customerReference) return null;
    return this.executeRepositoryLookup({
      context,
      strategy: 'CUSTOMER_REFERENCE',
      repositories: [this.paymentRepository, this.collectionRepository, this.customerRepository],
      operations: [
        (repository) => this.callRepository(repository, ['findPaymentByCustomerReference', 'findByCustomerReference'], { tenantId: context.tenantId, customerReference: callback.customerReference }),
        (repository) => this.callRepository(repository, ['findOne'], { tenantId: context.tenantId, customerReference: callback.customerReference }),
      ],
    });
  }

  async findByPhoneAndAmount({ context, callback }) {
    if (!callback.phoneNumber || callback.amountMinor === null) return null;
    return this.executeRepositoryLookup({
      context,
      strategy: 'PHONE_AMOUNT',
      repositories: [this.paymentRepository, this.collectionRepository, this.transactionRepository],
      operations: [
        (repository) => this.callRepository(repository, ['findByPhoneAndAmount', 'findCandidates'], {
          tenantId: context.tenantId,
          phoneNumber: callback.phoneNumber,
          amountMinor: callback.amountMinor,
          amount: callback.amount,
          currency: callback.currency,
          from: new Date(nowFrom(this.clock).getTime() - this.options.amountTimeWindowMinutes * 60 * 1000),
          to: nowFrom(this.clock),
          limit: this.options.maxCandidatesPerStrategy,
        }),
      ],
    });
  }

  async findByPhoneNumber({ context, callback }) {
    if (!callback.phoneNumber) return null;
    return this.executeRepositoryLookup({
      context,
      strategy: 'PHONE_NUMBER',
      repositories: [this.paymentRepository, this.collectionRepository],
      operations: [
        (repository) => this.callRepository(repository, ['findRecentByPhoneNumber', 'findByPhoneNumber'], {
          tenantId: context.tenantId,
          phoneNumber: callback.phoneNumber,
          limit: this.options.maxCandidatesPerStrategy,
          from: new Date(nowFrom(this.clock).getTime() - this.options.maxCorrelationAgeMinutes * 60 * 1000),
          to: nowFrom(this.clock),
        }),
      ],
    });
  }

  async findByAmountTimeWindow({ context, callback }) {
    if (callback.amountMinor === null && callback.amount === null) return null;
    return this.executeRepositoryLookup({
      context,
      strategy: 'AMOUNT_TIME_WINDOW',
      repositories: [this.transactionRepository, this.paymentRepository, this.collectionRepository],
      operations: [
        (repository) => this.callRepository(repository, ['findCandidates', 'findRecentByAmount'], {
          tenantId: context.tenantId,
          amountMinor: callback.amountMinor,
          amount: callback.amount,
          currency: callback.currency,
          from: new Date(nowFrom(this.clock).getTime() - this.options.amountTimeWindowMinutes * 60 * 1000),
          to: nowFrom(this.clock),
          limit: this.options.maxCandidatesPerStrategy,
        }),
      ],
    });
  }

  async executeRepositoryLookup({ context, strategy, repositories = [], operations = [] }) {
    const usableRepositories = repositories.filter(Boolean);
    if (!usableRepositories.length) return null;

    let lastError = null;
    for (const repository of usableRepositories) {
      for (const operation of operations) {
        if (!isFn(operation)) continue;
        try {
          const result = await this.executeWithRetryAndTimeout(() => operation(repository), {
            timeoutMs: this.options.lookupTimeoutMs,
            maxRetries: this.options.maxRetries,
            strategy,
            context,
          });
          if (result) return result;
        } catch (error) {
          lastError = error;
          this.statistics.repositoryLookupFailures += 1;
          if (error?.code === 'AIRTEL_CALLBACK_CORRELATION_LOOKUP_TIMEOUT') this.statistics.repositoryLookupTimeouts += 1;
        }
      }
    }

    if (lastError && this.options.failClosedOnLookupError) throw lastError;
    return null;
  }

  async callRepository(repository, methods, query) {
    for (const method of methods) {
      if (!isFn(repository?.[method])) continue;
      this.statistics.repositoryLookups += 1;
      const result = await repository[method](query);
      return result;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Duplicate detection - read only
  // ---------------------------------------------------------------------------

  async detectDuplicateCallback({ tenantId, callback, callbackFingerprint, context }) {
    const evidence = [];
    let checked = false;

    const repository = this.callbackRepository;
    if (repository) {
      const methods = [
        'findByFingerprint',
        'findByCallbackFingerprint',
        'existsByFingerprint',
        'hasFingerprint',
      ];
      for (const method of methods) {
        if (!isFn(repository[method])) continue;
        checked = true;
        try {
          const record = await this.executeWithRetryAndTimeout(
            () => repository[method]({
              tenantId,
              provider: PROVIDER,
              operation: OPERATION,
              fingerprint: callbackFingerprint,
              callbackFingerprint,
              callbackId: callback.callbackId,
              providerReference: callback.providerReference,
              transactionReference: callback.transactionReference,
            }),
            {
              timeoutMs: this.options.lookupTimeoutMs,
              maxRetries: 1,
              strategy: 'DUPLICATE_CHECK',
              context,
            },
          );

          if (method.startsWith('exists') || method === 'hasFingerprint') {
            if (record === true) {
              this.statistics.duplicateChecksConfirmed += 1;
              return { confirmed: true, status: DUPLICATE_STATUS.CONFIRMED, evidence: { source: `callbackRepository.${method}` } };
            }
          } else if (duplicateRecordIsAuthoritative(record)) {
            this.statistics.duplicateChecksConfirmed += 1;
            evidence.push({ source: `callbackRepository.${method}`, status: extractStatus(record) || 'PROCESSED' });
            return { confirmed: true, status: DUPLICATE_STATUS.CONFIRMED, entity: record?.payment || record?.collection || record?.entity || null, evidence };
          }
        } catch (error) {
          this.log('warn', 'Airtel callback duplicate check failed', {
            tenantId,
            correlationId: context?.correlationId,
            method,
            code: errorCode(error),
          });
        }
        if (checked) break;
      }
    }

    const idempotency = this.idempotencyManager;
    if (idempotency) {
      const methods = ['find', 'get', 'lookup', 'check', 'exists'];
      for (const method of methods) {
        if (!isFn(idempotency[method])) continue;
        checked = true;
        try {
          const record = await this.executeWithRetryAndTimeout(
            () => idempotency[method]({
              tenantId,
              provider: PROVIDER,
              operation: OPERATION,
              idempotencyKey: `AIRTEL_CALLBACK:${callbackFingerprint}`,
              fingerprint: callbackFingerprint,
              callbackFingerprint,
            }),
            { timeoutMs: this.options.lookupTimeoutMs, maxRetries: 1, strategy: 'DUPLICATE_IDEMPOTENCY_CHECK', context },
          );
          if (method === 'exists' && record === true) {
            this.statistics.duplicateChecksConfirmed += 1;
            return { confirmed: true, status: DUPLICATE_STATUS.CONFIRMED, evidence: { source: `idempotencyManager.${method}` } };
          }
          if (duplicateRecordIsAuthoritative(record)) {
            this.statistics.duplicateChecksConfirmed += 1;
            return { confirmed: true, status: DUPLICATE_STATUS.CONFIRMED, evidence: { source: `idempotencyManager.${method}`, status: extractStatus(record) } };
          }
        } catch (error) {
          this.log('debug', 'Airtel callback idempotency duplicate check unavailable', {
            correlationId: context?.correlationId,
            code: errorCode(error),
          });
        }
        break;
      }
    }

    if (!checked) {
      this.statistics.duplicateChecksUnavailable += 1;
      return { confirmed: false, status: DUPLICATE_STATUS.UNAVAILABLE, evidence: { source: 'NO_AUTHORITATIVE_DUPLICATE_READER' } };
    }

    return { confirmed: false, status: DUPLICATE_STATUS.NOT_FOUND, evidence: evidence.length ? evidence : null };
  }

  // ---------------------------------------------------------------------------
  // Cache - optimization only
  // ---------------------------------------------------------------------------

  cacheKey(tenantId, callbackFingerprint) {
    return `titech:${PROVIDER.toLowerCase()}:callback-correlation:${tenantId}:${callbackFingerprint}`;
  }

  async getCachedCorrelation({ tenantId, callbackFingerprint, context }) {
    if (!this.options.cacheResolvedEntity) return null;
    const key = this.cacheKey(tenantId, callbackFingerprint);
    const now = Date.now();

    if (this.cache && isFn(this.cache.get)) {
      try {
        const value = await this.cache.get(key);
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        if (parsed?.expiresAt > now && parsed?.tenantId === tenantId) {
          this.statistics.cacheHits += 1;
          return parsed;
        }
      } catch (error) {
        this.log('debug', 'Airtel callback correlation external cache read failed', { code: errorCode(error), correlationId: context?.correlationId });
      }
    }

    const local = this.runtime.localCache.get(key);
    if (local?.expiresAt > now && local?.tenantId === tenantId) {
      this.statistics.cacheHits += 1;
      return local;
    }

    this.statistics.cacheMisses += 1;
    if (local) this.runtime.localCache.delete(key);
    return null;
  }

  async setCachedCorrelation({ tenantId, callbackFingerprint, result, callback }) {
    if (!this.options.cacheResolvedEntity || !result?.matched) return;
    const identity = extractEntityIdentity(result.entity);
    if (!identity.id) return;

    const entry = {
      tenantId,
      entityId: identity.id,
      entityType: identity.entityType,
      strategy: result.strategy,
      confidence: result.confidence,
      expiresAt: Date.now() + this.options.cacheTTLSeconds * 1000,
      callbackFingerprint,
    };
    const key = this.cacheKey(tenantId, callbackFingerprint);

    while (this.runtime.localCache.size >= Number(this.options.maxCacheEntries)) {
      const oldestKey = this.runtime.localCache.keys().next().value;
      if (!oldestKey) break;
      this.runtime.localCache.delete(oldestKey);
    }

    this.runtime.localCache.set(key, entry);
    if (this.cache && isFn(this.cache.set)) {
      try {
        await this.cache.set(key, JSON.stringify(entry), this.options.cacheTTLSeconds);
      } catch (error) {
        this.log('debug', 'Airtel callback correlation external cache write failed', { code: errorCode(error) });
      }
    }
  }

  async hydrateCachedEntity(cached, context) {
    const repositories = {
      PAYMENT: this.paymentRepository,
      COLLECTION: this.collectionRepository,
      TRANSACTION: this.transactionRepository,
    };
    const repository = repositories[cached.entityType] || this.paymentRepository;
    if (!repository || !cached.entityId) return null;
    for (const method of ['findById', 'findOneById']) {
      if (!isFn(repository[method])) continue;
      try {
        const result = await this.executeWithRetryAndTimeout(
          () => repository[method]({ tenantId: context.tenantId, id: cached.entityId }),
          { timeoutMs: this.options.lookupTimeoutMs, maxRetries: 1, strategy: 'CACHE_HYDRATION', context },
        );
        return result || null;
      } catch {
        return null;
      }
    }
    return null;
  }

  async clearCache() {
    this.runtime.localCache.clear();
  }

  // ---------------------------------------------------------------------------
  // Fraud / provider intelligence
  // ---------------------------------------------------------------------------

  async evaluateFraudRisk({ tenantId, callback, correlationResult, context }) {
    const signals = [];
    let score = 0;
    let requiresReview = false;

    if (this.fraudEngine) {
      for (const method of ['evaluate', 'score', 'assess']) {
        if (!isFn(this.fraudEngine[method])) continue;
        try {
          const result = await this.fraudEngine[method]({
            tenantId,
            provider: PROVIDER,
            operation: OPERATION,
            callback: cloneSafe(callback),
            correlation: this.auditMetadata(correlationResult),
            context: cloneSafe(context),
          });
          score = toFiniteNumber(result?.score) ?? score;
          requiresReview = Boolean(result?.requiresReview || result?.decision === 'REVIEW' || result?.decision === 'BLOCK');
          signals.push(...(Array.isArray(result?.signals) ? result.signals.map((value) => normalizeUpper(value)).filter(Boolean) : []));
          break;
        } catch (error) {
          this.log('warn', 'Airtel callback fraud intelligence failed', { code: errorCode(error), correlationId: context.correlationId });
          if (this.options.failClosedOnFraudIntelligenceError) requiresReview = true;
        }
      }
    }

    if (this.riskEngine) {
      try {
        const result = await this.riskEngine.evaluate?.({ tenantId, provider: PROVIDER, callback: cloneSafe(callback), correlation: this.auditMetadata(correlationResult) });
        score = Math.max(score, toFiniteNumber(result?.score) ?? 0);
        requiresReview = requiresReview || Boolean(result?.requiresReview);
        signals.push(...(Array.isArray(result?.signals) ? result.signals.map((value) => normalizeUpper(value)).filter(Boolean) : []));
      } catch (error) {
        this.log('debug', 'Airtel callback risk engine unavailable', { code: errorCode(error) });
      }
    }

    if (this.amlService) {
      try {
        const result = await (this.amlService.screen || this.amlService.evaluate)?.call(this.amlService, {
          tenantId,
          provider: PROVIDER,
          callback: cloneSafe(callback),
          correlation: this.auditMetadata(correlationResult),
        });
        if (result?.match || result?.blocked || result?.requiresReview) {
          signals.push('AML_REVIEW');
          requiresReview = true;
        }
      } catch (error) {
        this.log('debug', 'Airtel callback AML screening unavailable', { code: errorCode(error) });
      }
    }

    if (score >= 80) {
      signals.push('HIGH_RISK_SCORE');
      requiresReview = true;
    } else if (score >= 50) {
      signals.push('ELEVATED_RISK_SCORE');
      requiresReview = true;
    }

    if (requiresReview) this.statistics.fraudReviews += 1;
    return Object.freeze({
      score,
      requiresReview,
      signals: [...new Set(signals)],
      decision: requiresReview ? 'REVIEW' : 'CLEAR',
    });
  }

  async evaluateProviderBehavior({ callback, correlationResult, context }) {
    const signals = [];
    const providerReference = callback?.providerReference;
    if (!providerReference) signals.push('MISSING_PROVIDER_REFERENCE');
    if (correlationResult?.status === CORRELATION_STATUS.UNKNOWN) signals.push('UNMATCHED_CALLBACK');
    return {
      signals,
      score: correlationResult?.status === CORRELATION_STATUS.MATCHED ? 100 : 0,
      tenantId: context.tenantId,
    };
  }

  buildIntelligenceDecision({ correlationResult, fraud, provider, signals, decisions }) {
    if (fraud?.requiresReview) return { action: 'FRAUD_REVIEW', reviewRequired: true, reason: 'FRAUD_OR_AML_SIGNAL' };
    if (correlationResult?.conflict) return { action: 'MANUAL_REVIEW', reviewRequired: true, reason: 'CONFLICTING_CANDIDATES' };
    if (correlationResult?.status === CORRELATION_STATUS.REVIEW || correlationResult?.status === CORRELATION_STATUS.PARTIAL) {
      return { action: 'MANUAL_REVIEW', reviewRequired: true, reason: 'CORRELATION_CONFIDENCE_BELOW_AUTO_THRESHOLD' };
    }
    if (correlationResult?.status === CORRELATION_STATUS.UNKNOWN) {
      return { action: 'RECONCILIATION_REQUIRED', reviewRequired: true, reason: 'NO_DETERMINISTIC_MATCH' };
    }
    return { action: 'PROCESS_PAYMENT', reviewRequired: false, reason: 'CORRELATION_CONFIRMED' };
  }

  // ---------------------------------------------------------------------------
  // Recovery / replay / route helpers retained for compatibility
  // ---------------------------------------------------------------------------

  async detectDuplicate({ tenantId, callback }) {
    const normalized = normalizeCallback(callback, nowFrom(this.clock));
    return this.detectDuplicateCallback({
      tenantId,
      callback: normalized,
      callbackFingerprint: buildCallbackFingerprint(normalized),
      context: { tenantId, correlationId: crypto.randomUUID() },
    });
  }

  generateCallbackFingerprint(callback = {}) {
    return buildCallbackFingerprint(normalizeCallback(callback, nowFrom(this.clock)));
  }

  generateCorrelationId() {
    const suffix = (++this._sequence).toString(36);
    return `${crypto.randomUUID()}-${suffix}`;
  }

  async retryCorrelationLookup({ callback, context, attempts = this.options.maxRetries } = {}) {
    let lastError = null;
    for (let attempt = 0; attempt <= Number(attempts); attempt += 1) {
      try {
        return await this.executeCorrelationLookup({ callback, context });
      } catch (error) {
        lastError = error;
        if (!isRetryableError(error) || attempt >= attempts) throw error;
        this.statistics.retries += 1;
        await this.sleep(this.options.retryBackoffMs * (attempt + 1));
      }
    }
    throw lastError;
  }

  async routeForReview({ context, reason = 'MANUAL_REVIEW_REQUIRED', result = null }) {
    const safeContext = this.validateContext(context);
    const payload = {
      tenantId: safeContext.tenantId,
      correlationId: safeContext.correlationId,
      reason,
      result: this.auditMetadata(result),
    };
    await this.safeAudit('AIRTEL_CALLBACK_CORRELATION_REVIEW', safeContext, payload);
    await this.publishCorrelationEvent('AIRTEL_CALLBACK_CORRELATION_REVIEW', safeContext, payload);
    return payload;
  }

  async recoverCorrelation({ callback, context } = {}) {
    this.statistics.recoveryAttempts += 1;
    return this.retryCorrelationLookup({ callback, context });
  }

  // ---------------------------------------------------------------------------
  // Persistence hooks - intentionally non-financial
  // ---------------------------------------------------------------------------

  async completeCorrelation({ context, callback, result, startedAt }) {
    this.runtime.lastCorrelation = {
      at: nowFrom(this.clock),
      correlationId: context.correlationId,
      tenantId: context.tenantId,
      status: result.status,
      confidence: result.confidence,
    };
    if (result.status === CORRELATION_STATUS.MATCHED || result.status === CORRELATION_STATUS.DUPLICATE) {
      this.runtime.lastSuccessfulCorrelation = this.runtime.lastCorrelation;
    }

    await this.safeAudit('AIRTEL_CALLBACK_CORRELATION_RESULT', context, this.auditMetadata(result));

    if (this.options.publishEvents) {
      await this.publishCorrelationEvent('AIRTEL_CALLBACK_CORRELATED', context, this.auditMetadata(result));
    }

    this.metric('titech_airtel_callback_correlation_duration_ms', Date.now() - startedAt);
  }

  async persistCorrelation() {
    // Intentionally a no-op. Correlation is not the callback persistence owner.
    return { persisted: false, owner: 'callbackProcessor/callbackRepository' };
  }

  // ---------------------------------------------------------------------------
  // Repository execution infrastructure
  // ---------------------------------------------------------------------------

  async executeWithRetryAndTimeout(operation, { timeoutMs, maxRetries, strategy, context } = {}) {
    let lastError = null;
    const attempts = Math.max(0, Number(maxRetries) || 0);

    for (let attempt = 0; attempt <= attempts; attempt += 1) {
      try {
        return await this.executeWithTimeout(operation, {
          timeoutMs: Number(timeoutMs) || DEFAULTS.lookupTimeoutMs,
          strategy,
          context,
        });
      } catch (error) {
        lastError = error;
        if (attempt >= attempts || !isRetryableError(error)) throw error;
        this.statistics.retries += 1;
        await this.sleep(Number(this.options.retryBackoffMs) * (attempt + 1));
      }
    }

    throw lastError;
  }

  async executeWithTimeout(operation, { timeoutMs, strategy, context } = {}) {
    const timeout = Math.max(1, Number(timeoutMs) || DEFAULTS.lookupTimeoutMs);
    let timer;
    const startedAt = Date.now();

    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new AirtelCallbackCorrelationError('Airtel callback correlation lookup timed out.', {
              code: 'AIRTEL_CALLBACK_CORRELATION_LOOKUP_TIMEOUT',
              statusCode: 504,
              retryable: true,
              uncertain: true,
              tenantId: context?.tenantId,
              correlationId: context?.correlationId,
              details: { strategy, timeoutMs: timeout },
            }));
          }, timeout);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      this.metric('titech_airtel_callback_correlation_lookup_ms', Date.now() - startedAt);
    }
  }

  async sleep(ms) {
    const duration = Math.max(0, Number(ms) || 0);
    if (!duration) return;
    await new Promise((resolve) => setTimeout(resolve, duration));
  }

  // ---------------------------------------------------------------------------
  // Audit / events / observability
  // ---------------------------------------------------------------------------

  async safeAudit(action, context, metadata = {}) {
    if (!this.options.audit || !this.auditService) return;
    const payload = {
      action,
      provider: PROVIDER,
      operation: OPERATION,
      tenantId: context?.tenantId || null,
      correlationId: context?.correlationId || null,
      actorId: context?.actor?.actorId || 'SYSTEM:AIRTEL_CALLBACK',
      metadata: cloneSafe(metadata),
      at: nowFrom(this.clock).toISOString(),
    };

    try {
      const method = ['record', 'audit', 'write'].find((name) => isFn(this.auditService?.[name]));
      if (!method) return;
      await this.auditService[method](payload);
    } catch (error) {
      this.statistics.auditFailures += 1;
      this.log('error', 'Airtel callback correlation audit failed', {
        action,
        tenantId: context?.tenantId,
        correlationId: context?.correlationId,
        code: errorCode(error),
      });
      if (this.options.failClosedOnAuditError) throw error;
    }
  }

  async publishCorrelationEvent(type, context, payload = {}) {
    if (!this.options.publishEvents) return;
    const safePayload = cloneSafe(payload);
    const event = {
      type,
      provider: PROVIDER,
      operation: OPERATION,
      tenantId: context?.tenantId || null,
      correlationId: context?.correlationId || null,
      payload: safePayload,
      at: nowFrom(this.clock).toISOString(),
    };

    try {
      if (this.outboxService) {
        const method = ['publish', 'enqueue', 'append'].find((name) => isFn(this.outboxService?.[name]));
        if (method) {
          await this.outboxService[method](event);
          return;
        }
      }
      const method = ['publish', 'emit', 'send'].find((name) => isFn(this.eventBus?.[name]));
      if (method) await this.eventBus[method](event);
    } catch (error) {
      this.statistics.eventFailures += 1;
      this.log('error', 'Airtel callback correlation event publication failed', {
        type,
        tenantId: context?.tenantId,
        correlationId: context?.correlationId,
        code: errorCode(error),
      });
      if (this.options.failClosedOnEventError) throw error;
    }
  }

  recordCorrelationMetrics(result) {
    const status = result?.status || CORRELATION_STATUS.FAILED;
    const confidence = Number(result?.confidence || 0);
    this.statistics.totalConfidence += confidence;
    const completedCount = this.statistics.callbacksMatched + this.statistics.callbacksReviewed + this.statistics.callbacksUnknown + this.statistics.callbacksDuplicate + this.statistics.callbacksPartial;
    this.statistics.averageConfidence = completedCount > 0 ? Math.round((this.statistics.totalConfidence / completedCount) * 100) / 100 : 0;

    this.metric('titech_airtel_callback_correlations_total', 1, { status });
    this.metric('titech_airtel_callback_correlation_confidence', confidence);

    const counters = {
      [MATCH_TYPE.PROVIDER_REFERENCE]: 'providerReferenceMatches',
      [MATCH_TYPE.PAYMENT_REFERENCE]: 'paymentReferenceMatches',
      [MATCH_TYPE.TRANSACTION_REFERENCE]: 'transactionReferenceMatches',
      [MATCH_TYPE.EXTERNAL_REFERENCE]: 'externalReferenceMatches',
      [MATCH_TYPE.CUSTOMER_REFERENCE]: 'customerReferenceMatches',
      [MATCH_TYPE.PHONE_AMOUNT]: 'phoneMatches',
      [MATCH_TYPE.PHONE_NUMBER]: 'phoneMatches',
      [MATCH_TYPE.AMOUNT_TIME_WINDOW]: 'amountTimeMatches',
    };
    const key = counters[result?.matchType];
    if (key) this.statistics[key] += 1;
  }

  metric(name, value = 1, labels = undefined) {
    try {
      const method = String(name).includes('_ms') || String(name).includes('confidence')
        ? 'histogram'
        : 'counter';
      if (isFn(this.metrics?.[method])) {
        if (labels !== undefined) this.metrics[method](name, value, labels);
        else this.metrics[method](name, value);
      }
    } catch {
      // Observability must not mutate correlation correctness.
    }
  }

  startSpan(name, context) {
    try {
      if (!isFn(this.tracer?.startSpan)) return null;
      return this.tracer.startSpan(name, {
        attributes: {
          'titech.provider': PROVIDER,
          'titech.operation': OPERATION,
          'titech.tenant_id': context?.tenantId || 'unknown',
          'titech.correlation_id': context?.correlationId || 'unknown',
        },
      });
    } catch {
      return null;
    }
  }

  log(level, message, metadata = {}) {
    const safe = cloneSafe(metadata);
    const method = isFn(this.logger?.[level]) ? level : 'info';
    try {
      this.logger?.[method]?.({ message, provider: PROVIDER, module: COMPONENT, ...safe });
    } catch {
      // Logging must not affect financial callback processing.
    }
  }

  toCorrelationError(error, context) {
    if (error instanceof AirtelCallbackCorrelationError) return error;
    const normalized = normalizeError(error);
    return new AirtelCallbackCorrelationError(
      normalized?.message || error?.message || 'Airtel callback correlation failed.',
      {
        code: normalized?.code || errorCode(error),
        statusCode: Number(normalized?.httpStatus || normalized?.statusCode || error?.statusCode) || 500,
        retryable: Boolean(normalized?.retryable || error?.retryable),
        uncertain: Boolean(error?.uncertain),
        tenantId: context?.tenantId,
        correlationId: context?.correlationId,
        cause: error,
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Compatibility helpers for existing composition roots
  // ---------------------------------------------------------------------------

  buildCacheKey({ tenantId, providerReference, transactionReference, paymentReference, phoneNumber, type = 'correlation' } = {}) {
    return [
      'titech', PROVIDER.toLowerCase(), type, tenantId || 'global',
      providerReference || '-', transactionReference || '-',
      paymentReference || '-', phoneNumber ? sha256(normalizePhone(phoneNumber) || phoneNumber) : '-',
    ].join(':');
  }

  resolveCacheTTL(ttl) {
    const value = Number(ttl);
    return Number.isFinite(value) && value > 0 ? value : Number(this.options.cacheTTLSeconds);
  }

  cacheDiagnostics() {
    return this.cacheSnapshot();
  }

  validateLookupContext(context) {
    return this.validateContext(context);
  }

  extendLookupContext(context, extension = {}) {
    return { ...this.validateContext(context), ...cloneSafe(extension) };
  }

  buildRepositoryContext(context) {
    const safe = this.validateContext(context);
    return { tenantId: safe.tenantId, provider: PROVIDER, operation: OPERATION, correlationId: safe.correlationId };
  }

  lookupContextSnapshot(context) {
    const safe = this.validateContext(context);
    return { tenantId: safe.tenantId, provider: PROVIDER, operation: OPERATION, correlationId: safe.correlationId, requestId: safe.requestId || null, traceId: safe.traceId || null };
  }

  async executeLookup({ context, operation, repository, execute } = {}) {
    const safeContext = this.validateContext(context);
    if (!isFn(execute)) return null;
    if (!repository) return null;
    return this.executeWithRetryAndTimeout(execute, {
      timeoutMs: this.options.lookupTimeoutMs,
      maxRetries: this.options.maxRetries,
      strategy: operation || 'REPOSITORY_LOOKUP',
      context: safeContext,
    });
  }

  normalizeLookupResult({ result, context, callback } = {}) {
    const safeContext = this.validateContext(context);
    const normalizedCallback = normalizeCallback(callback, nowFrom(this.clock));
    if (!result) return this.buildResult({ status: CORRELATION_STATUS.UNKNOWN, matched: false, correlationId: safeContext.correlationId, tenantId: safeContext.tenantId, callback: normalizedCallback, callbackFingerprint: buildCallbackFingerprint(normalizedCallback), reason: 'NO_DETERMINISTIC_MATCH' });
    const candidate = this.buildCandidate({ entity: result.entity || result.payment || result.collection || result, strategy: result.strategy || 'FALLBACK', callback: normalizedCallback, context: safeContext });
    return candidate
      ? this.buildResult({ status: this.resolveCorrelationStatus({ confidence: candidate.confidence, candidate }), matched: candidate.confidence >= this.options.confidenceThreshold, correlationId: safeContext.correlationId, tenantId: safeContext.tenantId, callback: normalizedCallback, callbackFingerprint: buildCallbackFingerprint(normalizedCallback), confidence: candidate.confidence, matchType: candidate.evidence[0]?.type || MATCH_TYPE.FALLBACK, entity: candidate.entity, candidates: [candidate], candidateCount: 1, explanation: this.buildMatchExplanation(candidate, [candidate]) })
      : this.buildResult({ status: CORRELATION_STATUS.UNKNOWN, matched: false, correlationId: safeContext.correlationId, tenantId: safeContext.tenantId, callback: normalizedCallback, callbackFingerprint: buildCallbackFingerprint(normalizedCallback) });
  }

  resolveMultipleMatches({ context, callback, candidates = [], partialResult = null } = {}) {
    const safeContext = this.validateContext(context);
    const normalizedCallback = normalizeCallback(callback, nowFrom(this.clock));
    const normalizedCandidates = candidates.flatMap((item) => {
      const entity = item?.result || item?.entity || item;
      const strategy = item?.strategy || 'FALLBACK';
      const built = this.buildCandidate({ entity, strategy, callback: normalizedCallback, context: safeContext });
      return built ? [built] : [];
    });
    return this.resolveCandidateSet({ callback: normalizedCallback, context: safeContext, candidates: normalizedCandidates, callbackFingerprint: buildCallbackFingerprint(normalizedCallback), lookupDurationMs: 0 }) || partialResult;
  }

  calculateConfidence({ strategy, result, callback } = {}) {
    const candidate = this.buildCandidate({ entity: result?.entity || result, strategy: strategy || 'FALLBACK', callback: normalizeCallback(callback, nowFrom(this.clock)), context: { tenantId: 'confidence-only', correlationId: crypto.randomUUID() } });
    return candidate?.confidence || 0;
  }

  calculateFinalConfidence({ callback, matchedEntity, candidates = [], fraudSignals = [] } = {}) {
    const normalizedCallback = normalizeCallback(callback, nowFrom(this.clock));
    const identity = extractEntityIdentity(matchedEntity || {});
    let score = matchedEntity ? 50 : 0;
    if (identity.providerReference && compareExact(identity.providerReference, normalizedCallback.providerReference)) score += 35;
    if (amountMatches(normalizedCallback, identity)) score += 10;
    if (candidates.length > 1) score -= 10;
    if (fraudSignals.length) score -= Math.min(fraudSignals.length * 5, 30);
    return Math.max(0, Math.min(100, score));
  }

  buildCorrelationResult({ context, callback, matchedEntity, confidence, candidates = [], status } = {}) {
    const safeContext = this.validateContext(context);
    const normalizedCallback = normalizeCallback(callback, nowFrom(this.clock));
    const resolvedConfidence = Number(confidence ?? this.calculateFinalConfidence({ callback: normalizedCallback, matchedEntity, candidates }));
    return this.buildResult({
      status: status || this.resolveCorrelationStatus({ confidence: resolvedConfidence, candidate: matchedEntity ? { entity: matchedEntity } : null }),
      matched: Boolean(matchedEntity && resolvedConfidence >= this.options.confidenceThreshold),
      correlationId: safeContext.correlationId, tenantId: safeContext.tenantId, callback: normalizedCallback,
      callbackFingerprint: buildCallbackFingerprint(normalizedCallback), confidence: resolvedConfidence, entity: matchedEntity, candidates,
      candidateCount: candidates.length, matchType: candidates[0]?.strategy || MATCH_TYPE.FALLBACK,
    });
  }

  createIntelligenceContext({ context, correlationResult, callback } = {}) {
    const safeContext = this.validateContext(context);
    const normalizedCallback = normalizeCallback(callback, nowFrom(this.clock));
    return Object.freeze({ correlationId: safeContext.correlationId, tenantId: safeContext.tenantId, provider: PROVIDER, callbackReference: normalizedCallback.reference || normalizedCallback.transactionReference || null, correlationResult: this.auditMetadata(correlationResult), signals: [], decisions: [], createdAt: nowFrom(this.clock).toISOString() });
  }

  async generateFraudSignals({ context, callback, correlationResult } = {}) {
    const result = await this.evaluateFraudRisk({ tenantId: this.validateContext(context).tenantId, callback: normalizeCallback(callback, nowFrom(this.clock)), correlationResult, context: this.validateContext(context) });
    return result.signals;
  }

  explainDecision(result = {}) {
    return { route: this.determineCallbackRoute(result), status: result.status, providerOutcome: result.providerOutcome || null, confidence: Number(result.confidence || 0), matchType: result.matchType || null, reason: result.reason || null, signals: [...new Set([...(result.fraudSignals || []), ...(result.intelligence?.signals || [])])] };
  }

  buildAutomatedDecision({ correlationResult, intelligence } = {}) {
    return this.buildIntelligenceDecision({ correlationResult, fraud: intelligence?.fraud, provider: intelligence?.provider, signals: intelligence?.signals || [], decisions: intelligence?.decisions || [] });
  }

  async evaluateHistoricalMatching({ context, correlationResult } = {}) {
    return { available: false, tenantId: this.validateContext(context).tenantId, correlationId: context.correlationId, confidenceAdjustment: 0, reason: 'HISTORICAL_CORRELATION_ADAPTER_NOT_CONFIGURED', correlation: this.auditMetadata(correlationResult) };
  }

  async analyzeCallbackReplay({ context, callback } = {}) {
    const safeContext = this.validateContext(context);
    const normalizedCallback = normalizeCallback(callback, nowFrom(this.clock));
    const fingerprint = buildCallbackFingerprint(normalizedCallback);
    const duplicate = await this.detectDuplicateCallback({ tenantId: safeContext.tenantId, callback: normalizedCallback, callbackFingerprint: fingerprint, context: safeContext });
    return { ...duplicate, callbackFingerprint: fingerprint };
  }

  async generateRepairSuggestions({ context, result } = {}) {
    const safeContext = this.validateContext(context);
    if (result?.status === CORRELATION_STATUS.UNKNOWN) return [{ action: 'RECONCILIATION_LOOKUP', tenantId: safeContext.tenantId, correlationId: safeContext.correlationId, reason: 'LOCATE_ORIGINAL_PAYMENT_USING_PROVIDER_STATUS' }];
    if (result?.status === CORRELATION_STATUS.REVIEW || result?.conflict) return [{ action: 'MANUAL_CORRELATION_REVIEW', tenantId: safeContext.tenantId, correlationId: safeContext.correlationId, reason: 'MULTIPLE_OR_WEAK_CANDIDATES' }];
    return [];
  }

  async executeSelfHealing({ context, callback } = {}) {
    return { executed: false, mode: 'SAFE_SUGGESTION_ONLY', suggestions: await this.generateRepairSuggestions({ context, result: await this.executeCorrelationLookup({ context, callback }) }) };
  }

  async escalateProviderIssue({ context, reason = 'CORRELATION_PROVIDER_ISSUE', result = null } = {}) {
    return this.routeForReview({ context, reason, result });
  }

  evaluateCorrelationSLA({ startedAt, completedAt = Date.now() } = {}) {
    const durationMs = Math.max(0, Number(completedAt) - Number(startedAt));
    return { durationMs, withinTarget: durationMs <= Number(this.options.correlationTimeoutMs), targetMs: Number(this.options.correlationTimeoutMs) };
  }

  // ---------------------------------------------------------------------------
  // Health / diagnostics / snapshots
  // ---------------------------------------------------------------------------

  async dependencyDiagnostics() {
    const required = [];
    const optional = [];
    const degradedReasons = [];

    if (this.options.requireTenantId) required.push(['tenant-context', Boolean(this.configuration.trustTenantContext !== false)]);
    required.push(['provider', PROVIDER === 'AIRTEL']);
    required.push(['financial-boundary', FINANCIAL_BOUNDARY === 'TITECH_FINANCIAL_CORE']);

    optional.push(['paymentRepository', Boolean(this.paymentRepository)]);
    optional.push(['transactionRepository', Boolean(this.transactionRepository)]);
    optional.push(['collectionRepository', Boolean(this.collectionRepository)]);
    optional.push(['callbackRepository', Boolean(this.callbackRepository)]);
    optional.push(['auditService', Boolean(this.auditService)]);
    optional.push(['eventBusOrOutbox', Boolean(this.eventBus || this.outboxService)]);

    for (const [name, available] of [...required, ...optional]) {
      if (!available && required.some(([requiredName]) => requiredName === name)) degradedReasons.push(`${name}:MISSING`);
    }

    const hasLookupRepository = Boolean(this.paymentRepository || this.collectionRepository || this.transactionRepository || this.paymentIntentRepository);
    if (this.options.requireLookupRepository && !hasLookupRepository) degradedReasons.push('lookup-repositories:MISSING');
    const hasDuplicateReader = Boolean(this.callbackRepository || this.idempotencyManager);
    if (this.options.requireDuplicateReader && !hasDuplicateReader) degradedReasons.push('duplicate-reader:UNAVAILABLE');

    return {
      ready: degradedReasons.length === 0,
      degradedReasons,
      required: Object.fromEntries(required.map(([name, available]) => [name, available])),
      optional: Object.fromEntries(optional.map(([name, available]) => [name, available])),
      financialBoundary: {
        providerHttp: false,
        ledgerWrites: false,
        balanceMutation: false,
        walletMutation: false,
        settlementFinality: false,
        authoritativeBoundary: FINANCIAL_BOUNDARY,
      },
    };
  }

  async health() {
    const diagnostics = await this.dependencyDiagnostics();
    const status = diagnostics.ready ? HEALTH_STATUS.READY : HEALTH_STATUS.DEGRADED;
    this.healthState.status = this.runtime.stopping ? HEALTH_STATUS.STOPPING : status;
    this.healthState.dependenciesHealthy = diagnostics.ready;
    this.healthState.degradedReasons = diagnostics.degradedReasons;
    this.runtime.lastHealthCheck = nowFrom(this.clock);
    if (diagnostics.ready) this.runtime.lastSuccessfulHealthCheck = this.runtime.lastHealthCheck;

    return {
      provider: PROVIDER,
      component: COMPONENT,
      engine: ENGINE_NAME,
      version: ENGINE_VERSION,
      status: this.healthState.status,
      initialized: this.runtime.initialized,
      dependenciesHealthy: diagnostics.ready,
      degradedReasons: diagnostics.degradedReasons,
      activeCorrelations: this.runtime.activeCorrelations.size,
      uptimeMs: Date.now() - this.runtime.startedAt.getTime(),
      checkedAt: this.runtime.lastHealthCheck.toISOString(),
    };
  }

  async readiness() {
    const health = await this.health();
    return {
      ready: health.status === HEALTH_STATUS.READY,
      ...health,
    };
  }

  async liveness() {
    return {
      alive: !this.runtime.stopping,
      provider: PROVIDER,
      component: COMPONENT,
      timestamp: nowFrom(this.clock).toISOString(),
    };
  }

  isReady() {
    return this.runtime.initialized && !this.runtime.stopping && this.healthState.status !== HEALTH_STATUS.DOWN;
  }

  capabilities() {
    return {
      provider: PROVIDER,
      operation: OPERATION,
      engine: ENGINE_NAME,
      version: ENGINE_VERSION,
      correlation: true,
      duplicateRead: Boolean(this.callbackRepository || this.idempotencyManager),
      cache: Boolean(this.cache || this.runtime.localCache),
      audit: Boolean(this.auditService),
      events: Boolean(this.eventBus || this.outboxService),
      fraudHooks: Boolean(this.fraudEngine || this.riskEngine || this.amlService),
      tenantIsolation: true,
      weakMatchAutoProcess: Boolean(this.options.allowWeakMatchAutoProcess),
      directProviderHttp: false,
      directLedgerMutation: false,
      directBalanceMutation: false,
      directWalletMutation: false,
      settlementFinality: false,
      authoritativeFinancialBoundary: FINANCIAL_BOUNDARY,
    };
  }

  cacheSnapshot() {
    return {
      enabled: Boolean(this.options.cacheResolvedEntity),
      localEntries: this.runtime.localCache.size,
      maxEntries: Number(this.options.maxCacheEntries),
      ttlSeconds: Number(this.options.cacheTTLSeconds),
      cacheHits: this.statistics.cacheHits,
      cacheMisses: this.statistics.cacheMisses,
    };
  }

  activeLookupSnapshot() {
    return [...this.runtime.activeCorrelations.entries()].map(([key, value]) => ({
      key,
      tenantId: value.tenantId,
      fingerprint: value.fingerprint,
      startedAt: new Date(value.startedAt).toISOString(),
      ageMs: Date.now() - value.startedAt,
    }));
  }

  statisticsSnapshot() {
    return cloneSafe(this.statistics);
  }

  async diagnostics() {
    return {
      provider: PROVIDER,
      component: COMPONENT,
      engine: ENGINE_NAME,
      version: ENGINE_VERSION,
      schemaVersion: SCHEMA_VERSION,
      health: await this.health(),
      readiness: await this.readiness(),
      dependencies: await this.dependencyDiagnostics(),
      capabilities: this.capabilities(),
      cache: this.cacheSnapshot(),
      runtime: {
        activeCorrelations: this.runtime.activeCorrelations.size,
        activeFingerprints: this.runtime.activeFingerprints.size,
        lastCorrelation: cloneSafe(this.runtime.lastCorrelation),
        lastSuccessfulCorrelation: cloneSafe(this.runtime.lastSuccessfulCorrelation),
        lastFailure: cloneSafe(this.runtime.lastFailure),
        lastHealthCheck: this.runtime.lastHealthCheck?.toISOString?.() || null,
      },
      statistics: this.statisticsSnapshot(),
      generatedAt: nowFrom(this.clock).toISOString(),
    };
  }

  snapshot() {
    return {
      provider: PROVIDER,
      component: COMPONENT,
      engine: ENGINE_NAME,
      version: ENGINE_VERSION,
      schemaVersion: SCHEMA_VERSION,
      runtime: {
        initialized: this.runtime.initialized,
        stopping: this.runtime.stopping,
        startedAt: this.runtime.startedAt.toISOString(),
        activeCorrelations: this.runtime.activeCorrelations.size,
        activeFingerprints: this.runtime.activeFingerprints.size,
      },
      statistics: this.statisticsSnapshot(),
      capabilities: this.capabilities(),
    };
  }

  intelligenceSnapshot() {
    return {
      provider: PROVIDER,
      correlationEngine: ENGINE_NAME,
      averageConfidence: this.statistics.averageConfidence,
      reviewed: this.statistics.callbacksReviewed,
      fraudReviews: this.statistics.fraudReviews,
      conflicts: this.statistics.conflictingCandidates,
      generatedAt: nowFrom(this.clock).toISOString(),
    };
  }

  async getExecutiveAnalytics() {
    return {
      provider: PROVIDER,
      callbacks: this.statistics.callbacksReceived,
      matched: this.statistics.callbacksMatched,
      duplicates: this.statistics.callbacksDuplicate,
      unknown: this.statistics.callbacksUnknown,
      review: this.statistics.callbacksReviewed,
      averageConfidence: this.statistics.averageConfidence,
      repositoryLookupFailures: this.statistics.repositoryLookupFailures,
      cacheHitRate: (this.statistics.cacheHits + this.statistics.cacheMisses) > 0
        ? this.statistics.cacheHits / (this.statistics.cacheHits + this.statistics.cacheMisses)
        : 0,
      intelligence: this.intelligenceSnapshot(),
      generatedAt: nowFrom(this.clock).toISOString(),
    };
  }

  async operationalDashboard() {
    return {
      health: await this.health(),
      activeOperations: this.activeLookupSnapshot(),
      statistics: this.statisticsSnapshot(),
      intelligence: this.intelligenceSnapshot(),
    };
  }

  async providerIntelligenceReport() {
    return {
      provider: PROVIDER,
      reliability: {
        callbacks: this.statistics.callbacksReceived,
        matched: this.statistics.callbacksMatched,
        unknown: this.statistics.callbacksUnknown,
        duplicate: this.statistics.callbacksDuplicate,
        review: this.statistics.callbacksReviewed,
        failure: this.statistics.callbacksFailed,
      },
      generatedAt: nowFrom(this.clock).toISOString(),
    };
  }

  calculateProviderScore(metrics = {}) {
    const total = Number(metrics.total || metrics.callbacks || 0);
    if (!total) return 0;
    const failures = Number(metrics.failures || 0);
    const unknown = Number(metrics.unknown || 0);
    return Math.max(0, Math.min(100, 100 - ((failures + unknown) / total) * 100));
  }

  async calculateProviderReliability() {
    return {
      score: this.calculateProviderScore({
        total: this.statistics.callbacksReceived,
        failures: this.statistics.callbacksFailed,
        unknown: this.statistics.callbacksUnknown,
      }),
      callbacks: this.statistics.callbacksReceived,
      matched: this.statistics.callbacksMatched,
      unknown: this.statistics.callbacksUnknown,
      failures: this.statistics.callbacksFailed,
    };
  }

  async recordLearningFeedback({ context, result, outcome } = {}) {
    await this.safeAudit('AIRTEL_CALLBACK_CORRELATION_LEARNING_FEEDBACK', this.validateContext(context), {
      outcome: normalizeUpper(outcome),
      result: this.auditMetadata(result),
    });
    return true;
  }
}

// Backward-compatible class name used by composition roots.
export class AirtelCallbackCorrelation extends AirtelCallbackCorrelationEngine {}
export { AirtelCallbackCorrelation as CallbackCorrelation };
export { PROVIDER, OPERATION, COMPONENT, ENGINE_NAME, ENGINE_VERSION, SCHEMA_VERSION, HEALTH_STATUS, CORRELATION_STATUS, MATCH_TYPE, CONFIDENCE, DEFAULTS, ROUTES, FINANCIAL_BOUNDARY, buildCallbackFingerprint, normalizeCallback, cloneSafe };

export function createAirtelCallbackCorrelation(options = {}) {
  return new AirtelCallbackCorrelation(options);
}

export function createCallbackCorrelation(options = {}) {
  return new AirtelCallbackCorrelation(options);
}

export const DEFAULT_CONFIGURATION = DEFAULTS;
export const CONSTANTS = Object.freeze({
  PROVIDER,
  OPERATION,
  COMPONENT,
  ENGINE_NAME,
  ENGINE_VERSION,
  SCHEMA_VERSION,
  HEALTH_STATUS,
  CORRELATION_STATUS,
  MATCH_TYPE,
  CONFIDENCE,
  ROUTES,
  FINANCIAL_BOUNDARY,
});

export default AirtelCallbackCorrelation;