'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Collection Callback Correlation Engine
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/collections/callbackCorrelation.js
 *
 * Architectural role
 * ------------------
 * Canonical, tenant-scoped correlation boundary between an Airtel Money
 * COLLECTION callback and an internal TITech collection transaction.
 *
 * Flow
 * ----
 *   Callback Receiver -> Signature/Validation -> Correlator -> Processor
 *                                              |               |
 *                                              v               v
 *                                   MATCHED / REVIEW      State Machine
 *                                   PARTIAL / UNKNOWN            |
 *                                   DUPLICATE                  Financial Core
 *
 * Responsibilities
 * ----------------
 * - Validate tenant/callback correlation context.
 * - Normalize identifiers and money into deterministic forms.
 * - Produce a deterministic SHA-256 callback fingerprint.
 * - Detect duplicates/replays through authoritative repository checks.
 * - Resolve collection candidates using strong and constrained fallback keys.
 * - Verify tenant/provider/operation/amount/currency consistency.
 * - Detect conflicting high-confidence matches and return REVIEW.
 * - Persist only a sanitized correlation decision through an injected repository.
 * - Publish sanitized audit/events and expose health/readiness/diagnostics.
 *
 * Explicit non-responsibilities
 * -----------------------------
 * - No Airtel HTTP/API calls or callback reception.
 * - No signature verification or authentication.
 * - No KYC/AML/sanctions/fraud adjudication.
 * - No collection state transition or provider execution.
 * - No ledger/journal/balance/wallet mutation.
 * - No settlement/finality authority.
 * - No automatic retry of provider callbacks.
 *
 * Security principles
 * -------------------
 * - Tenant/provider/operation are always part of the lookup namespace.
 * - Strong identifiers outrank weak identifiers.
 * - Conflicting strong matches fail closed to REVIEW.
 * - Amount/currency mismatches invalidate a candidate.
 * - Cache is never financial truth; it is only an optimization.
 * - Raw callback payloads, signatures, credentials and secrets are never sent
 *   to audit/event boundaries or persisted by this module.
 * - Correlation is not settlement. MATCHED means a safe internal target was
 *   identified; PARTIAL remains review-bound unless an explicit downstream
 *   policy authorizes it; the downstream processor remains responsible for state/funds.
 * - Distributed duplicate safety depends on an atomic repository uniqueness
 *   contract (for example createIfAbsent with a unique tenant+fingerprint key).
 *
 * Module format
 * -------------
 * Native ESM. No new runtime dependency is introduced.
 * =============================================================================
 */

import crypto from 'node:crypto';

export const PROVIDER = 'AIRTEL';
export const OPERATION = 'COLLECTION';
export const MODULE_NAME = 'titech.airtel.collections.callback-correlation';
export const ENGINE_NAME = 'airtel-collection-callback-correlation';
export const ENGINE_VERSION = '3.1.0';
export const COMPONENT = ENGINE_NAME;
export const SCHEMA_VERSION = 3;

export const HEALTH_STATUS = Object.freeze({
  STARTING: 'STARTING', READY: 'READY', DEGRADED: 'DEGRADED', STOPPING: 'STOPPING', DOWN: 'DOWN',
});

export const CORRELATION_STATUS = Object.freeze({
  MATCHED: 'MATCHED', PARTIAL: 'PARTIAL', UNKNOWN: 'UNKNOWN', DUPLICATE: 'DUPLICATE', REVIEW: 'REVIEW', FAILED: 'FAILED',
});

export const DECISION = Object.freeze({
  ACCEPT: 'ACCEPT', REVIEW: 'REVIEW', UNKNOWN: 'UNKNOWN', DUPLICATE: 'DUPLICATE', FAILED: 'FAILED',
});

export const MATCH_TYPE = Object.freeze({
  PROVIDER_REFERENCE: 'PROVIDER_REFERENCE',
  TRANSACTION_ID: 'TRANSACTION_ID',
  PAYMENT_REFERENCE: 'PAYMENT_REFERENCE',
  EXTERNAL_REFERENCE: 'EXTERNAL_REFERENCE',
  CUSTOMER_REFERENCE: 'CUSTOMER_REFERENCE',
  PHONE_AMOUNT: 'PHONE_AMOUNT',
  PHONE_ONLY: 'PHONE_ONLY',
  FALLBACK: 'FALLBACK',
  NONE: 'NONE',
});

export const MATCH_CONFIDENCE = Object.freeze({
  EXACT_PROVIDER_REFERENCE: 100,
  EXACT_TRANSACTION_ID: 100,
  EXACT_PAYMENT_REFERENCE: 97,
  EXACT_EXTERNAL_REFERENCE: 95,
  EXACT_CUSTOMER_REFERENCE: 88,
  PHONE_AND_AMOUNT: 82,
  PHONE_ONLY: 45,
  NONE: 0,
});

export const EVENT_TYPES = Object.freeze({
  CORRELATED: 'AIRTEL_COLLECTION_CALLBACK_CORRELATED',
  DUPLICATE: 'AIRTEL_COLLECTION_CALLBACK_DUPLICATE',
  REVIEW_REQUIRED: 'AIRTEL_COLLECTION_CALLBACK_CORRELATION_REVIEW_REQUIRED',
  UNKNOWN: 'AIRTEL_COLLECTION_CALLBACK_UNKNOWN',
  FAILED: 'AIRTEL_COLLECTION_CALLBACK_CORRELATION_FAILED',
});

export const CAPABILITIES = Object.freeze({
  callbackReception: false,
  signatureVerification: false,
  providerCommunication: false,
  paymentExecution: false,
  collectionMutation: false,
  stateTransition: false,
  ledgerPosting: false,
  balanceMutation: false,
  walletMutation: false,
  settlementFinality: false,
  kycAdjudication: false,
  amlAdjudication: false,
  fraudAdjudication: false,
  authoritativeDuplicateStore: true,
  distributedCacheOptimization: true,
  deterministicCorrelation: true,
  tenantIsolation: true,
  auditIntegration: true,
  eventIntegration: true,
});

export const DEFAULT_CONFIGURATION = Object.freeze({
  provider: PROVIDER,
  operation: OPERATION,
  minimumConfidence: 90,
  partialConfidence: 70,
  allowPartial: true,
  allowPhoneOnly: false,
  amountToleranceMinor: 0,
  duplicateWindowSeconds: 300,
  cacheTTLSeconds: 300,
  maxCallbackAgeMinutes: 1440,
  requireTenantId: true,
  requireCallbackIdentity: true,
  requireRepositoryForReady: true,
  requireAtomicCorrelationPersistence: false,
  failClosedOnPersistenceError: true,
  failOpenOnAuditError: true,
  failOpenOnEventError: true,
  maxCandidatesPerSignal: 25,
  maxMatchCandidates: 100,
  maxReasonLength: 500,
  maxStringLength: 512,
  countryCode: 'UG',
  defaultCurrency: 'UGX',
  defaultMinorUnits: 0,
  currencyMinorUnits: Object.freeze({
    UGX: 0,
    USD: 2,
    KES: 2,
    TZS: 2,
    RWF: 0,
    ZMW: 2,
    GHS: 2,
    NGN: 2,
  }),
});

export class AirtelCollectionCallbackCorrelationError extends Error {
  constructor(message, {
    code = 'AIRTEL_CALLBACK_CORRELATION_ERROR',
    status = 500,
    retryable = false,
    tenantId = null,
    correlationId = null,
    details = undefined,
    cause = undefined,
  } = {}) {
    super(
      String(message || 'Airtel callback correlation error.'),
      cause ? { cause } : undefined,
    );
    this.name = 'AirtelCollectionCallbackCorrelationError';
    this.code = code;
    this.status = status;
    this.retryable = Boolean(retryable);
    this.provider = PROVIDER;
    this.operation = OPERATION;
    this.tenantId = tenantId;
    this.correlationId = correlationId;
    this.details = sanitize(details);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      status: this.status,
      retryable: this.retryable,
      provider: this.provider,
      operation: this.operation,
      tenantId: this.tenantId,
      correlationId: this.correlationId,
      details: this.details,
    };
  }
}

const SENSITIVE_KEY_PATTERN =
  /authorization|token|secret|password|signature|credential|api[-_]?key|private[-_]?key|client[-_]?secret|rawpayload|raw_payload|webhook[-_]?body|access[-_]?token|refresh[-_]?token/i;

function boundedString(
  value,
  max = DEFAULT_CONFIGURATION.maxStringLength,
) {
  if (value === undefined || value === null) return null;
  const string = String(value).trim();
  return string ? string.slice(0, max) : null;
}

function upper(value) {
  const v = boundedString(value);
  return v ? v.toUpperCase() : null;
}

function identifier(value) {
  return boundedString(value);
}

function reference(value) {
  return upper(value);
}

function plainObject(value) {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

function sanitize(value, depth = 0, seen = new WeakSet()) {
  if (depth > 6) return '[MAX_DEPTH]';
  if (value === undefined || value === null) return value ?? null;
  if (typeof value === 'string') return value.slice(0, 1000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[CIRCULAR]';

  seen.add(value);

  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((v) => sanitize(v, depth + 1, seen));
  }

  const result = {};

  for (const [key, child] of Object.entries(value).slice(0, 200)) {
    result[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? '[REDACTED]'
      : sanitize(child, depth + 1, seen);
  }

  return result;
}

function stable(value, depth = 0) {
  if (depth > 8) return '[MAX_DEPTH]';
  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    return value.map((v) => stable(v, depth + 1));
  }

  if (!plainObject(value)) {
    return typeof value === 'bigint'
      ? value.toString()
      : value;
  }

  return Object.keys(value)
    .sort()
    .reduce((out, key) => {
      out[key] = stable(value[key], depth + 1);
      return out;
    }, {});
}

function json(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ circular: true });
  }
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(String(value), 'utf8')
    .digest('hex');
}

function resolveMinorUnits(currency, config) {
  const c = upper(currency);
  const configured = config?.currencyMinorUnits?.[c];

  if (
    Number.isInteger(configured) &&
    configured >= 0 &&
    configured <= 8
  ) {
    return configured;
  }

  return Number.isInteger(config?.defaultMinorUnits)
    ? config.defaultMinorUnits
    : 0;
}

function decimalToMinor(value, minorUnits) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const raw = String(value).trim();

  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) {
    return null;
  }

  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole = '0', fractional = ''] = unsigned.split('.');

  if (
    fractional.length > minorUnits &&
    /[^0]/.test(fractional.slice(minorUnits))
  ) {
    return null;
  }

  const scale = 10n ** BigInt(minorUnits);
  const padded = `${fractional}00000000`.slice(0, minorUnits);
  const valueMinor =
    BigInt(whole) * scale +
    BigInt(padded || '0');

  const result = Number(
    negative ? -valueMinor : valueMinor,
  );

  return Number.isSafeInteger(result)
    ? result
    : null;
}

function amountMinor(value, currency, config) {
  const units = resolveMinorUnits(currency, config);

  if (
    value?.amountMinor !== undefined &&
    value?.amountMinor !== null
  ) {
    const raw = String(value.amountMinor).trim();

    if (/^-?\d+$/.test(raw)) {
      const parsed = Number(raw);

      if (Number.isSafeInteger(parsed)) {
        return parsed;
      }
    }
  }

  return decimalToMinor(value?.amount, units);
}

function normalizePhone(value, config) {
  const input = boundedString(value, 64);

  if (!input) return null;

  const digits = input.replace(/\D/g, '');

  if (!digits) return null;

  if (digits.startsWith('00')) {
    return `+${digits.slice(2)}`;
  }

  if (digits.startsWith('256')) {
    return `+${digits}`;
  }

  if (
    config?.countryCode === 'UG' &&
    digits.length === 10 &&
    digits.startsWith('0')
  ) {
    return `+256${digits.slice(1)}`;
  }

  if (
    config?.countryCode === 'UG' &&
    digits.length === 9
  ) {
    return `+256${digits}`;
  }

  return `+${digits}`;
}

function maskPhone(
  value,
  config = DEFAULT_CONFIGURATION,
) {
  const phone = normalizePhone(value, config);

  if (!phone) return null;

  return phone.length <= 6
    ? `${phone.slice(0, 2)}***`
    : `${phone.slice(0, 4)}***${phone.slice(-3)}`;
}

function callbackIdentity(
  callback = {},
  config = DEFAULT_CONFIGURATION,
) {
  const currency =
    upper(callback.currency) ||
    upper(config.defaultCurrency) ||
    'UGX';

  return {
    callbackId: identifier(
      callback.callbackId ?? callback.id,
    ),

    providerEventId: identifier(
      callback.providerEventId ?? callback.eventId,
    ),

    transactionId:
      identifier(callback.transactionId),

    providerReference: reference(
      callback.providerReference ??
      callback.reference ??
      callback.transactionId,
    ),

    paymentReference: reference(
      callback.paymentReference ??
      callback.paymentRef,
    ),

    externalReference: reference(
      callback.externalReference ??
      callback.clientReference,
    ),

    customerReference: reference(
      callback.customerReference ??
      callback.customerId ??
      callback.payerId,
    ),

    status:
      upper(callback.status),

    currency,

    amountMinor:
      amountMinor(
        callback,
        currency,
        config,
      ),

    phone:
      normalizePhone(
        callback.phone ??
        callback.phoneNumber ??
        callback.msisdn ??
        callback.payerPhone,
        config,
      ),

    accountNumber:
      identifier(
        callback.accountNumber ??
        callback.account,
      ),

    requestId:
      identifier(callback.requestId),
  };
}

function fingerprintFromIdentity(
  identity,
  tenantId = null,
) {
  return sha256(
    json(
      stable({
        tenantId:
          tenantId
            ? String(tenantId)
            : null,

        provider:
          PROVIDER,

        operation:
          OPERATION,

        identity,
      }),
    ),
  );
}

function safeCallbackIdentity(
  callback = {},
  config = DEFAULT_CONFIGURATION,
) {
  const i = callbackIdentity(
    callback,
    config,
  );

  return {
    ...i,

    phone:
      maskPhone(
        i.phone,
        config,
      ),

    accountNumber:
      i.accountNumber
        ? `${i.accountNumber.slice(0, 2)}***${i.accountNumber.slice(-2)}`
        : null,
  };
}

function cacheKey(
  tenantId,
  fingerprint,
) {
  return (
    `titech:airtel:collection:callback-correlation:` +
    `v${SCHEMA_VERSION}:${tenantId}:${fingerprint}`
  );
}

function collectionId(record = {}) {
  return (
    record.collectionId ??
    record.paymentId ??
    record.transactionId ??
    record._id ??
    record.id ??
    null
  );
}

function providerReference(record = {}) {
  return reference(
    record.providerReference ??
    record.providerTransactionId ??
    record.providerReferenceId ??
    record.transactionId,
  );
}

function externalReference(record = {}) {
  return reference(
    record.externalReference ??
    record.clientReference ??
    record.reference,
  );
}

function paymentReference(record = {}) {
  return reference(
    record.paymentReference ??
    record.transactionReference ??
    record.reference,
  );
}

function customerReference(record = {}) {
  return reference(
    record.customerReference ??
    record.customerId ??
    record.payerId,
  );
}

function recordPhone(
  record = {},
  config,
) {
  return normalizePhone(
    record.phone ??
    record.phoneNumber ??
    record.msisdn ??
    record.payerPhone ??
    record.customerPhone,
    config,
  );
}

function recordCurrency(
  record = {},
  config,
) {
  return (
    upper(record.currency) ||
    upper(config.defaultCurrency) ||
    'UGX'
  );
}

function recordAmountMinor(
  record = {},
  config,
) {
  const currency =
    recordCurrency(
      record,
      config,
    );

  return amountMinor(
    {
      amountMinor:
        record.amountMinor,

      amount:
        record.amount,

      currency,
    },
    currency,
    config,
  );
}

function safeEventStatus(status) {
  if (
    [
      CORRELATION_STATUS.MATCHED,
      CORRELATION_STATUS.PARTIAL,
    ].includes(status)
  ) {
    return EVENT_TYPES.CORRELATED;
  }

  return {
    [CORRELATION_STATUS.DUPLICATE]:
      EVENT_TYPES.DUPLICATE,

    [CORRELATION_STATUS.REVIEW]:
      EVENT_TYPES.REVIEW_REQUIRED,

    [CORRELATION_STATUS.UNKNOWN]:
      EVENT_TYPES.UNKNOWN,

    [CORRELATION_STATUS.FAILED]:
      EVENT_TYPES.FAILED,
  }[status] || EVENT_TYPES.FAILED;
}

function repositoryArray(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  if (Array.isArray(value.items)) {
    return value.items.filter(Boolean);
  }

  if (Array.isArray(value.results)) {
    return value.results.filter(Boolean);
  }

  if (Array.isArray(value.docs)) {
    return value.docs.filter(Boolean);
  }

  return [value];
}

async function firstMethod(
  target,
  methods,
  args,
) {
  if (!target) {
    return {
      called: false,
      value: undefined,
      method: null,
    };
  }

  for (const method of methods) {
    if (typeof target[method] === 'function') {
      return {
        called: true,
        value: await target[method](args),
        method,
      };
    }
  }

  return {
    called: false,
    value: undefined,
    method: null,
  };
}

function uniqueCandidates(list) {
  const seen = new Set();
  const out = [];

  for (const item of list) {
    const id = collectionId(item);

    const key = id
      ? String(id)
      : sha256(json(stable(item)));

    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }

  return out;
}

export class CallbackCorrelation {
  constructor({
    paymentRepository,
    collectionRepository,
    transactionRepository,
    callbackRepository,
    idempotencyManager,
    cache,
    auditService,
    eventBus,
    metrics,
    tracer,
    logger,
    configuration,
    clock = Date,
  } = {}) {
    this.paymentRepository =
      paymentRepository;

    this.collectionRepository =
      collectionRepository;

    this.transactionRepository =
      transactionRepository;

    this.callbackRepository =
      callbackRepository;

    this.idempotencyManager =
      idempotencyManager;

    this.cache =
      cache;

    this.auditService =
      auditService;

    this.eventBus =
      eventBus;

    this.metrics =
      metrics;

    this.tracer =
      tracer;

    this.logger =
      logger;

    this.clock =
      clock;

    this.configuration =
      Object.freeze({
        ...DEFAULT_CONFIGURATION,
        ...(configuration || {}),

        currencyMinorUnits:
          Object.freeze({
            ...DEFAULT_CONFIGURATION.currencyMinorUnits,
            ...(configuration?.currencyMinorUnits || {}),
          }),
      });

    this.runtime = {
      state:
        HEALTH_STATUS.STARTING,

      initialized:
        false,

      startedAt:
        new Date(this.clock.now()),

      initializationPromise:
        null,

      activeCorrelations:
        0,

      cacheHits:
        0,

      cacheMisses:
        0,

      lastCorrelationAt:
        null,

      lastFailureAt:
        null,

      lastErrorCode:
        null,
    };

    this.statistics = {
      totalCallbacks:
        0,

      validatedCallbacks:
        0,

      matched:
        0,

      partial:
        0,

      unknown:
        0,

      duplicates:
        0,

      reviews:
        0,

      failed:
        0,

      repositoryCorrelations:
        0,

      cacheHits:
        0,

      cacheMisses:
        0,

      providerReferenceMatches:
        0,

      transactionIdMatches:
        0,

      paymentReferenceMatches:
        0,

      externalReferenceMatches:
        0,

      customerReferenceMatches:
        0,

      phoneAmountMatches:
        0,

      conflictingMatchSets:
        0,

      persistenceRaces:
        0,

      ageRejected:
        0,

      tenantRejected:
        0,

      amountMismatches:
        0,

      currencyMismatches:
        0,

      auditFailures:
        0,

      eventFailures:
        0,
    };

    this._localCache =
      new Map();
  }

  async initialize() {
    if (this.runtime.initialized) {
      return this.health();
    }

    if (this.runtime.initializationPromise) {
      return this.runtime.initializationPromise;
    }

    this.runtime.initializationPromise =
      Promise.resolve().then(() => {
        const readiness =
          this.readiness();

        if (
          readiness.status === HEALTH_STATUS.DEGRADED &&
          this.configuration.requireRepositoryForReady
        ) {
          this.runtime.state =
            HEALTH_STATUS.DEGRADED;

          this.runtime.lastReadiness =
            readiness;

          return this.health();
        }

        this.runtime.initialized =
          true;

        this.runtime.state =
          readiness.status;

        this.runtime.lastReadiness =
          readiness;

        return this.health();
      });

    try {
      return await this.runtime.initializationPromise;
    } finally {
      this.runtime.initializationPromise =
        null;
    }
  }

  async shutdown() {
    this.runtime.state =
      HEALTH_STATUS.STOPPING;

    this.runtime.initialized =
      false;

    this.pruneLocalCache();

    this.runtime.state =
      HEALTH_STATUS.DOWN;

    return this.health();
  }

  async correlate({
    tenantId,
    callback,
    correlationId =
      crypto.randomUUID(),
    requestId = null,
    traceId = null,
    context = {},
  } = {}) {
    const span =
      this.startSpan(
        'airtel.collection.callback.correlate',
        {
          tenantId,
          correlationId,
        },
      );

    const started =
      this.clock.now();

    this.statistics.totalCallbacks++;
    this.runtime.activeCorrelations++;

    try {
      this.assertContext({
        tenantId,
        callback,
        correlationId,
      });

      const identity =
        callbackIdentity(
          callback,
          this.configuration,
        );

      const fingerprint =
        fingerprintFromIdentity(
          identity,
          tenantId,
        );

      const safeContext = {
        tenantId:
          String(tenantId),

        correlationId,

        requestId:
          identifier(
            requestId ??
            callback?.requestId,
          ),

        traceId:
          identifier(
            traceId ??
            callback?.traceId,
          ),

        provider:
          PROVIDER,

        operation:
          OPERATION,

        fingerprint,

        ...sanitize(context),
      };

      this.assertCallbackAge(
        callback,
        tenantId,
        correlationId,
      );

      this.statistics.validatedCallbacks++;

      const cached =
        await this.getCachedCorrelation({
          tenantId,
          fingerprint,
        });

      if (cached) {
        this.statistics.cacheHits++;
        this.runtime.cacheHits++;

        this.emitMetric(
          'airtel_collection_callback_correlation_cache_hit_total',
        );

        return this.decorateResult({
          ...cached,
          correlationId,
          replay: true,
          cacheSource:
            'optimization-cache',
        });
      }

      this.statistics.cacheMisses++;
      this.runtime.cacheMisses++;

      if (
        await this.detectDuplicate({
          tenantId,
          callback,
          identity,
          fingerprint,
        })
      ) {
        this.statistics.duplicates++;

        this.emitMetric(
          'airtel_collection_callback_correlation_duplicate_total',
        );

        const duplicate =
          this.buildResult({
            status:
              CORRELATION_STATUS.DUPLICATE,

            decision:
              DECISION.DUPLICATE,

            correlationId,
            callback,
            identity,
            fingerprint,

            duplicate:
              true,

            replay:
              true,

            reason:
              'Callback identity was already recorded.',
          });

        await this.recordDecision({
          tenantId,
          callback,
          fingerprint,
          result:
            duplicate,
          context:
            safeContext,
        });

        await this.publishCorrelationEvent({
          tenantId,
          callback,
          identity,
          fingerprint,
          result:
            duplicate,
          correlationId,
          requestId:
            safeContext.requestId,
          traceId:
            safeContext.traceId,
        });

        return duplicate;
      }

      const matches =
        await this.findMatches({
          tenantId,
          callback,
          identity,
          correlationId,
        });

      let result =
        this.evaluateMatches({
          tenantId,
          callback,
          identity,
          fingerprint,
          matches,
          correlationId,
        });

      const persistence =
        await this.persistCorrelation({
          tenantId,
          callback,
          identity,
          fingerprint,
          result,
          correlationId,
          requestId:
            safeContext.requestId,
          traceId:
            safeContext.traceId,
        });

      if (persistence.duplicate) {
        this.statistics.duplicates++;

        result =
          this.buildResult({
            status:
              CORRELATION_STATUS.DUPLICATE,

            decision:
              DECISION.DUPLICATE,

            correlationId,
            callback,
            identity,
            fingerprint,

            matchType:
              result.matchType,

            confidence:
              result.confidence,

            collection:
              result.collection,

            collectionId:
              result.collectionId,

            matches:
              result.matches,

            duplicate:
              true,

            replay:
              true,

            reason:
              'A concurrent worker already persisted this callback correlation identity.',
          });
      }

      await this.recordDecision({
        tenantId,
        callback,
        fingerprint,
        result,
        context:
          safeContext,
      });

      if (
        [
          CORRELATION_STATUS.MATCHED,
          CORRELATION_STATUS.PARTIAL,
        ].includes(result.status)
      ) {
        await this.setCachedCorrelation({
          tenantId,
          fingerprint,
          result,
        });
      }

      await this.publishCorrelationEvent({
        tenantId,
        callback,
        identity,
        fingerprint,
        result,
        correlationId,
        requestId:
          safeContext.requestId,
        traceId:
          safeContext.traceId,
      });

      this.updateStatistics(
        result,
      );

      this.runtime.lastCorrelationAt =
        new Date(this.clock.now());

      this.emitMetric(
        'airtel_collection_callback_correlation_total',
      );

      this.emitTiming(
        'airtel_collection_callback_correlation_duration_ms',
        this.clock.now() - started,
      );

      return result;
    } catch (error) {
      this.statistics.failed++;

      this.runtime.lastFailureAt =
        new Date(this.clock.now());

      this.runtime.lastErrorCode =
        error?.code ||
        'AIRTEL_CALLBACK_CORRELATION_ERROR';

      this.emitMetric(
        'airtel_collection_callback_correlation_failed_total',
      );

      this.logError(
        'Airtel collection callback correlation failed',
        error,
        {
          tenantId,
          correlationId,
        },
      );

      throw this.normalizeError(
        error,
        {
          tenantId,
          correlationId,
        },
      );
    } finally {
      this.runtime.activeCorrelations =
        Math.max(
          0,
          this.runtime.activeCorrelations - 1,
        );

      span?.end?.();
    }
  }

  async correlateCallback(
    args = {},
  ) {
    return this.correlate(args);
  }

  fingerprint(
    callback = {},
    { tenantId = null } = {},
  ) {
    return fingerprintFromIdentity(
      callbackIdentity(
        callback,
        this.configuration,
      ),
      tenantId,
    );
  }

  normalizeCallback(
    callback = {},
  ) {
    return callbackIdentity(
      callback,
      this.configuration,
    );
  }

  assertContext({
    tenantId,
    callback,
    correlationId,
  }) {
    if (
      this.configuration.requireTenantId &&
      !identifier(tenantId)
    ) {
      this.statistics.tenantRejected++;

      throw new AirtelCollectionCallbackCorrelationError(
        'Tenant context is required.',
        {
          code:
            'AIRTEL_CALLBACK_TENANT_REQUIRED',

          status:
            400,

          correlationId,
        },
      );
    }

    if (
      !callback ||
      typeof callback !== 'object'
    ) {
      throw new AirtelCollectionCallbackCorrelationError(
        'Callback payload is required.',
        {
          code:
            'AIRTEL_CALLBACK_INVALID',

          status:
            400,

          tenantId,
          correlationId,
        },
      );
    }

    const identity =
      callbackIdentity(
        callback,
        this.configuration,
      );

    if (
      callback.amount !== undefined ||
      callback.amountMinor !== undefined
    ) {
      if (
        identity.amountMinor === null
      ) {
        throw new AirtelCollectionCallbackCorrelationError(
          'Callback amount is invalid or uses unsupported precision.',
          {
            code:
              'AIRTEL_CALLBACK_AMOUNT_INVALID',

            status:
              400,

            tenantId,
            correlationId,
          },
        );
      }

      if (
        identity.amountMinor < 0
      ) {
        throw new AirtelCollectionCallbackCorrelationError(
          'Callback amount must not be negative.',
          {
            code:
              'AIRTEL_CALLBACK_AMOUNT_NEGATIVE',

            status:
              400,

            tenantId,
            correlationId,
          },
        );
      }
    }

    if (
      this.configuration.requireCallbackIdentity &&
      !(
        identity.callbackId ||
        identity.providerEventId ||
        identity.transactionId ||
        identity.providerReference ||
        identity.paymentReference ||
        identity.externalReference ||
        identity.customerReference
      )
    ) {
      throw new AirtelCollectionCallbackCorrelationError(
        'Callback has no supported correlation identifier.',
        {
          code:
            'AIRTEL_CALLBACK_IDENTIFIER_REQUIRED',

          status:
            400,

          tenantId,
          correlationId,
        },
      );
    }
  }

  validateCallback(
    callback = {},
    context = {},
  ) {
    this.assertContext({
      tenantId:
        context.tenantId,

      callback,

      correlationId:
        context.correlationId,
    });

    return true;
  }

  assertCallbackAge(
    callback,
    tenantId,
    correlationId,
  ) {
    const raw =
      callback?.createdAt ??
      callback?.timestamp ??
      callback?.eventTimestamp ??
      callback?.occurredAt;

    if (!raw) return true;

    const ageMinutes =
      (
        this.clock.now() -
        new Date(raw).getTime()
      ) / 60000;

    if (
      !Number.isFinite(ageMinutes) ||
      ageMinutes < 0
    ) {
      return true;
    }

    if (
      ageMinutes >
      Number(
        this.configuration.maxCallbackAgeMinutes,
      )
    ) {
      this.statistics.ageRejected++;

      throw new AirtelCollectionCallbackCorrelationError(
        'Callback is outside the configured age window.',
        {
          code:
            'AIRTEL_CALLBACK_TOO_OLD',

          status:
            409,

          tenantId,
          correlationId,

          details: {
            ageMinutes,
            maxCallbackAgeMinutes:
              this.configuration.maxCallbackAgeMinutes,
          },
        },
      );
    }

    return true;
  }

  async detectDuplicate({
    tenantId,
    callback,
    identity,
    fingerprint,
  }) {
    const directKeys = [
      [
        'findByFingerprint',
        {
          tenantId,
          provider: PROVIDER,
          operation: OPERATION,
          fingerprint,
        },
      ],

      [
        'findByCallbackFingerprint',
        {
          tenantId,
          provider: PROVIDER,
          fingerprint,
        },
      ],

      [
        'findDuplicate',
        {
          tenantId,
          provider: PROVIDER,
          operation: OPERATION,
          fingerprint,
          callbackId:
            identity.callbackId,
          providerEventId:
            identity.providerEventId,
        },
      ],

      [
        'findByProviderEventId',
        {
          tenantId,
          provider: PROVIDER,
          eventId:
            identity.providerEventId,
        },
      ],

      [
        'findByCallbackId',
        {
          tenantId,
          provider: PROVIDER,
          callbackId:
            identity.callbackId,
        },
      ],
    ];

    const cached = [
      fingerprint,
      identity.callbackId,
      identity.providerEventId,
    ].filter(Boolean);

    for (const item of cached) {
      if (
        await this.safeCacheGet(
          `titech:airtel:collection:callback:${tenantId}:${item}`,
        )
      ) {
        return true;
      }
    }

    for (const [method, args] of directKeys) {
      if (
        !Object.values(args).some(Boolean) ||
        typeof this.callbackRepository?.[method] !== 'function'
      ) {
        continue;
      }

      if (
        await this.callbackRepository[method](args)
      ) {
        return true;
      }
    }

    return false;
  }

  async reserveCallback({
    tenantId,
    callback,
    correlationId =
      crypto.randomUUID(),
  } = {}) {
    this.assertContext({
      tenantId,
      callback,
      correlationId,
    });

    if (!this.idempotencyManager) {
      return {
        reserved:
          false,

        authoritative:
          false,

        reason:
          'No idempotency manager injected.',
      };
    }

    const identity =
      callbackIdentity(
        callback,
        this.configuration,
      );

    const fingerprint =
      fingerprintFromIdentity(
        identity,
        tenantId,
      );

    const args = {
      tenantId,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      key:
        `CALLBACK:${fingerprint}`,

      idempotencyKey:
        `CALLBACK:${fingerprint}`,

      fingerprint,

      correlationId,

      metadata: {
        callbackId:
          identity.callbackId,

        providerEventId:
          identity.providerEventId,
      },
    };

    const {
      called,
      value,
    } = await firstMethod(
      this.idempotencyManager,
      [
        'reserveCallback',
        'reserve',
        'claim',
        'begin',
      ],
      args,
    );

    if (!called) {
      return {
        reserved:
          false,

        authoritative:
          false,

        fingerprint,

        reason:
          'No compatible reservation method.',
      };
    }

    return {
      reserved:
        Boolean(
          value?.reserved ??
          value?.claimed ??
          value?.created ??
          value === true,
        ),

      alreadyReserved:
        Boolean(
          value?.alreadyReserved ??
          value?.duplicate ??
          value?.replay,
        ),

      authoritative:
        true,

      fingerprint,

      result:
        sanitize(value),
    };
  }

  async findMatches({
    tenantId,
    callback,
    identity,
    correlationId,
  }) {
    const repositories = [
      this.collectionRepository,
      this.paymentRepository,
      this.transactionRepository,
    ].filter(Boolean);

    const candidates = [];

    const plans = [
      [
        MATCH_TYPE.PROVIDER_REFERENCE,

        identity.providerReference,

        MATCH_CONFIDENCE.EXACT_PROVIDER_REFERENCE,

        [
          'findByProviderReference',
          'findCollectionByProviderReference',
          'findByProviderTransactionId',
        ],

        (v) => ({
          tenantId,
          provider:
            PROVIDER,

          operation:
            OPERATION,

          reference:
            v,

          providerReference:
            v,

          correlationId,
        }),
      ],

      [
        MATCH_TYPE.TRANSACTION_ID,

        identity.transactionId,

        MATCH_CONFIDENCE.EXACT_TRANSACTION_ID,

        [
          'findByTransactionId',
          'findCollectionByTransactionId',
          'findByIdForTenant',
        ],

        (v) => ({
          tenantId,
          provider:
            PROVIDER,

          operation:
            OPERATION,

          transactionId:
            v,

          id:
            v,

          correlationId,
        }),
      ],

      [
        MATCH_TYPE.PAYMENT_REFERENCE,

        identity.paymentReference,

        MATCH_CONFIDENCE.EXACT_PAYMENT_REFERENCE,

        [
          'findByPaymentReference',
          'findByTransactionReference',
        ],

        (v) => ({
          tenantId,
          provider:
            PROVIDER,

          operation:
            OPERATION,

          paymentReference:
            v,

          reference:
            v,

          correlationId,
        }),
      ],

      [
        MATCH_TYPE.EXTERNAL_REFERENCE,

        identity.externalReference,

        MATCH_CONFIDENCE.EXACT_EXTERNAL_REFERENCE,

        [
          'findByExternalReference',
          'findCollectionByExternalReference',
        ],

        (v) => ({
          tenantId,
          provider:
            PROVIDER,

          operation:
            OPERATION,

          externalReference:
            v,

          correlationId,
        }),
      ],

      [
        MATCH_TYPE.CUSTOMER_REFERENCE,

        identity.customerReference,

        MATCH_CONFIDENCE.EXACT_CUSTOMER_REFERENCE,

        [
          'findByCustomerReference',
          'findByCustomerId',
          'findCollectionByCustomerId',
        ],

        (v) => ({
          tenantId,
          provider:
            PROVIDER,

          operation:
            OPERATION,

          customerReference:
            v,

          customerId:
            v,

          limit:
            this.configuration.maxCandidatesPerSignal,

          correlationId,
        }),
      ],
    ];

    for (const [
      type,
      value,
      base,
      methods,
      args,
    ] of plans) {
      if (!value) continue;

      for (const repository of repositories) {
        const lookup =
          await firstMethod(
            repository,
            methods,
            args(value),
          );

        if (!lookup.called) {
          continue;
        }

        const records =
          repositoryArray(
            lookup.value,
          ).slice(
            0,
            this.configuration.maxCandidatesPerSignal,
          );

        for (const payment of records) {
          candidates.push(
            this.scoreCandidate({
              type,
              baseScore:
                base,

              payment,
              tenantId,
              callback,
              identity,
              correlationId,
            }),
          );
        }

        if (records.length) {
          break;
        }
      }
    }

    if (identity.phone) {
      for (const repository of repositories) {
        if (identity.amountMinor !== null) {
          const lookup =
            await firstMethod(
              repository,
              [
                'findByPhoneAndAmount',
                'findByPayerPhoneAndAmount',
                'findCollectionByPhoneAndAmount',
              ],
              {
                tenantId,
                provider:
                  PROVIDER,

                operation:
                  OPERATION,

                phone:
                  identity.phone,

                msisdn:
                  identity.phone,

                amountMinor:
                  identity.amountMinor,

                amount:
                  callback?.amount,

                currency:
                  identity.currency,

                limit:
                  this.configuration.maxCandidatesPerSignal,

                correlationId,
              },
            );

          if (lookup.called) {
            const records =
              repositoryArray(
                lookup.value,
              ).slice(
                0,
                this.configuration.maxCandidatesPerSignal,
              );

            for (const payment of records) {
              candidates.push(
                this.scoreCandidate({
                  type:
                    MATCH_TYPE.PHONE_AMOUNT,

                  baseScore:
                    MATCH_CONFIDENCE.PHONE_AND_AMOUNT,

                  payment,
                  tenantId,
                  callback,
                  identity,
                  correlationId,
                }),
              );
            }

            if (records.length) {
              break;
            }
          }
        }

        if (this.configuration.allowPhoneOnly) {
          const lookup =
            await firstMethod(
              repository,
              [
                'findByPhone',
                'findByPayerPhone',
                'findCollectionByPhone',
              ],
              {
                tenantId,
                provider:
                  PROVIDER,

                operation:
                  OPERATION,

                phone:
                  identity.phone,

                msisdn:
                  identity.phone,

                limit:
                  this.configuration.maxCandidatesPerSignal,

                correlationId,
              },
            );

          if (lookup.called) {
            const records =
              repositoryArray(
                lookup.value,
              ).slice(
                0,
                this.configuration.maxCandidatesPerSignal,
              );

            for (const payment of records) {
              candidates.push(
                this.scoreCandidate({
                  type:
                    MATCH_TYPE.PHONE_ONLY,

                  baseScore:
                    MATCH_CONFIDENCE.PHONE_ONLY,

                  payment,
                  tenantId,
                  callback,
                  identity,
                  correlationId,
                }),
              );
            }

            if (records.length) {
              break;
            }
          }
        }
      }
    }

    return uniqueCandidates(
      candidates,
    )
      .sort(
        (a, b) =>
          b.confidence -
          a.confidence,
      )
      .slice(
        0,
        this.configuration.maxMatchCandidates,
      );
  }

  scoreCandidate({
    type,
    baseScore,
    payment,
    tenantId,
    callback,
    identity,
    correlationId,
  }) {
    const consistency =
      this.verifyCandidateConsistency({
        tenantId,
        callback,
        identity,
        payment,
      });

    let confidence =
      baseScore;

    const reasons = [];

    for (const [
      name,
      value,
    ] of Object.entries(
      consistency,
    )) {
      if (
        [
          'tenantMatched',
          'providerMatched',
          'operationMatched',
          'amountMatched',
          'currencyMatched',
        ].includes(name) &&
        value === false
      ) {
        confidence = 0;
      }
    }

    if (
      consistency.tenantMatched === false
    ) {
      reasons.push('TENANT_MISMATCH');
    } else {
      reasons.push('TENANT_MATCH');
    }

    if (
      consistency.providerMatched === false
    ) {
      reasons.push(
        'PROVIDER_MISMATCH',
      );
    }

    if (
      consistency.operationMatched === false
    ) {
      reasons.push(
        'OPERATION_MISMATCH',
      );
    }

    if (
      consistency.amountMatched === false
    ) {
      reasons.push(
        'AMOUNT_MISMATCH',
      );
    }

    if (
      consistency.currencyMatched === false
    ) {
      reasons.push(
        'CURRENCY_MISMATCH',
      );
    }

    if (
      consistency.phoneMatched === true
    ) {
      reasons.push(
        'PHONE_MATCH',
      );

      if (
        confidence > 0 &&
        confidence < 100
      ) {
        confidence =
          Math.min(
            100,
            confidence + 3,
          );
      }
    }

    if (
      consistency.statusUsable === false
    ) {
      reasons.push(
        'COLLECTION_STATUS_REVIEW',
      );
    }

    return {
      collectionId:
        collectionId(payment),

      type,

      confidence,

      baseConfidence:
        baseScore,

      reasons,

      consistency,

      payment,

      providerReference:
        providerReference(payment),

      externalReference:
        externalReference(payment),

      correlationId,
    };
  }

  verifyCandidateConsistency({
    tenantId,
    identity,
    payment = {},
  }) {
    const candidateTenant =
      payment.tenantId ??
      payment.tenant ??
      null;

    const candidateProvider =
      upper(payment.provider);

    const candidateOperation =
      upper(
        payment.operation ??
        payment.transactionType,
      );

    const candidateCurrency =
      recordCurrency(
        payment,
        this.configuration,
      );

    const candidateAmount =
      recordAmountMinor(
        payment,
        this.configuration,
      );

    const candidatePhone =
      recordPhone(
        payment,
        this.configuration,
      );

    const tenantMatched =
      candidateTenant == null
        ? true
        : String(candidateTenant) ===
          String(tenantId);

    const providerMatched =
      candidateProvider == null
        ? true
        : candidateProvider ===
          PROVIDER;

    const operationMatched =
      candidateOperation == null
        ? true
        : candidateOperation ===
          OPERATION;

    const amountMatched =
      identity.amountMinor == null ||
      candidateAmount == null
        ? true
        : Math.abs(
            identity.amountMinor -
            candidateAmount,
          ) <=
          Number(
            this.configuration.amountToleranceMinor ||
            0,
          );

    const currencyMatched =
      !identity.currency ||
      !candidateCurrency
        ? true
        : identity.currency ===
          candidateCurrency;

    const phoneMatched =
      identity.phone &&
      candidatePhone
        ? identity.phone ===
          candidatePhone
        : null;

    const statusUsable =
      !payment.status ||
      ![
        'CANCELLED',
        'REJECTED',
      ].includes(
        upper(payment.status),
      );

    if (
      amountMatched === false
    ) {
      this.statistics.amountMismatches++;
    }

    if (
      currencyMatched === false
    ) {
      this.statistics.currencyMismatches++;
    }

    return {
      tenantMatched,
      providerMatched,
      operationMatched,
      amountMatched,
      currencyMatched,
      phoneMatched,
      statusUsable,
      candidateStatus:
        upper(payment.status),
      candidateAmountMinor:
        candidateAmount,
      candidateCurrency,
      candidatePhone:
        maskPhone(
          candidatePhone,
          this.configuration,
        ),
    };
  }

  evaluateMatches({
    callback,
    identity,
    fingerprint,
    matches = [],
    correlationId,
  }) {
    const valid =
      matches.filter(
        (m) =>
          m &&
          m.confidence > 0,
      );

    if (!valid.length) {
      return this.buildResult({
        status:
          CORRELATION_STATUS.UNKNOWN,

        decision:
          DECISION.UNKNOWN,

        correlationId,
        callback,
        identity,
        fingerprint,

        reason:
          'No tenant-consistent collection matched the callback identifiers.',
      });
    }

    const strongest =
      valid[0];

    const highConfidence =
      uniqueCandidates(
        valid.filter(
          (m) =>
            m.confidence >=
            this.configuration.minimumConfidence,
        ),
      );

    if (highConfidence.length > 1) {
      this.statistics.conflictingMatchSets++;

      return this.buildResult({
        status:
          CORRELATION_STATUS.REVIEW,

        decision:
          DECISION.REVIEW,

        correlationId,
        callback,
        identity,
        fingerprint,

        confidence:
          strongest.confidence,

        matchType:
          strongest.type,

        matches:
          this.summarizeMatches(
            highConfidence,
          ),

        reviewRequired:
          true,

        reason:
          'Multiple distinct high-confidence collections matched the callback; automatic selection is unsafe.',
      });
    }

    const status =
      strongest.confidence >=
      this.configuration.minimumConfidence
        ? CORRELATION_STATUS.MATCHED
        : (
            strongest.confidence >=
              this.configuration.partialConfidence &&
            this.configuration.allowPartial
          )
            ? CORRELATION_STATUS.PARTIAL
            : CORRELATION_STATUS.REVIEW;

    return this.buildResult({
      status,

      decision:
        status ===
        CORRELATION_STATUS.MATCHED
          ? DECISION.ACCEPT
          : DECISION.REVIEW,

      correlationId,
      callback,
      identity,
      fingerprint,

      matchType:
        strongest.type,

      confidence:
        strongest.confidence,

      collection:
        strongest.payment,

      collectionId:
        strongest.collectionId,

      matches:
        this.summarizeMatches(
          valid.slice(0, 10),
        ),

      reviewRequired:
        status !==
        CORRELATION_STATUS.MATCHED,

      reason:
        status ===
        CORRELATION_STATUS.REVIEW
          ? 'Match confidence is below the configured acceptance threshold.'
          : 'Callback correlated using a tenant-consistent collection candidate.',
    });
  }

  summarizeMatches(
    matches = [],
  ) {
    return matches.map(
      (m) => ({
        collectionId:
          m.collectionId ??
          null,

        type:
          m.type,

        confidence:
          m.confidence,

        baseConfidence:
          m.baseConfidence,

        reasons:
          m.reasons?.slice(
            0,
            20,
          ) || [],

        consistency:
          sanitize(
            m.consistency,
          ),
      }),
    );
  }

  buildResult({
    status,
    decision,
    correlationId,
    callback,
    identity,
    fingerprint,
    matchType =
      MATCH_TYPE.NONE,
    confidence = 0,
    collection = null,
    collectionId = null,
    matches = [],
    reason = null,
    duplicate = false,
    replay = false,
    reviewRequired = false,
  } = {}) {
    return {
      provider:
        PROVIDER,

      operation:
        OPERATION,

      status,

      decision,

      correlationId,

      callbackId:
        identity?.callbackId ??
        null,

      providerEventId:
        identity?.providerEventId ??
        null,

      callbackFingerprint:
        fingerprint,

      matchType,

      confidence:
        Math.max(
          0,
          Math.min(
            100,
            Number(
              confidence || 0,
            ),
          ),
        ),

      collectionId,

      collection:
        [
          CORRELATION_STATUS.MATCHED,
          CORRELATION_STATUS.PARTIAL,
        ].includes(status)
          ? sanitize(collection)
          : null,

      matches,

      duplicate,

      replay,

      reviewRequired,

      callbackIdentity:
        safeCallbackIdentity(
          callback,
          this.configuration,
        ),

      reason:
        boundedString(
          reason,
          this.configuration.maxReasonLength,
        ),

      timestamp:
        new Date(
          this.clock.now(),
        ),
    };
  }

  decorateResult(
    result,
  ) {
    return {
      ...sanitize(result),

      collection:
        result.collection
          ? sanitize(
              result.collection,
            )
          : null,
    };
  }

  updateStatistics(
    result,
  ) {
    if (
      result.status ===
      CORRELATION_STATUS.MATCHED
    ) {
      this.statistics.matched++;
      this.statistics.repositoryCorrelations++;
    }

    if (
      result.status ===
      CORRELATION_STATUS.PARTIAL
    ) {
      this.statistics.partial++;
      this.statistics.repositoryCorrelations++;
    }

    if (
      result.status ===
      CORRELATION_STATUS.UNKNOWN
    ) {
      this.statistics.unknown++;
    }

    if (
      result.status ===
      CORRELATION_STATUS.REVIEW
    ) {
      this.statistics.reviews++;
    }

    const mapping = {
      [MATCH_TYPE.PROVIDER_REFERENCE]:
        'providerReferenceMatches',

      [MATCH_TYPE.TRANSACTION_ID]:
        'transactionIdMatches',

      [MATCH_TYPE.PAYMENT_REFERENCE]:
        'paymentReferenceMatches',

      [MATCH_TYPE.EXTERNAL_REFERENCE]:
        'externalReferenceMatches',

      [MATCH_TYPE.CUSTOMER_REFERENCE]:
        'customerReferenceMatches',

      [MATCH_TYPE.PHONE_AMOUNT]:
        'phoneAmountMatches',
    };

    if (
      mapping[result.matchType]
    ) {
      this.statistics[
        mapping[result.matchType]
      ]++;
    }
  }

  async persistCorrelation({
    tenantId,
    callback,
    identity,
    fingerprint,
    result,
    correlationId,
    requestId,
    traceId,
  }) {
    if (!this.callbackRepository) {
      if (
        this.configuration
          .requireAtomicCorrelationPersistence
      ) {
        throw new AirtelCollectionCallbackCorrelationError(
          'Callback correlation repository is required.',
          {
            code:
              'AIRTEL_CALLBACK_REPOSITORY_REQUIRED',

            status:
              503,

            retryable:
              true,

            tenantId,
            correlationId,
          },
        );
      }

      return {
        persisted:
          false,

        authoritative:
          false,
      };
    }

    const record = {
      tenantId,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      correlationId,

      callbackId:
        identity.callbackId,

      providerEventId:
        identity.providerEventId,

      transactionId:
        identity.transactionId,

      providerReference:
        identity.providerReference,

      externalReference:
        identity.externalReference,

      callbackFingerprint:
        fingerprint,

      fingerprint,

      status:
        result.status,

      decision:
        result.decision,

      confidence:
        result.confidence,

      matchType:
        result.matchType,

      collectionId:
        result.collectionId,

      reviewRequired:
        result.reviewRequired,

      reason:
        result.reason,

      receivedAt:
        new Date(
          this.clock.now(),
        ),

      requestId:
        requestId || null,

      traceId:
        traceId || null,

      identity: {
        ...identity,

        phone:
          maskPhone(
            identity.phone,
            this.configuration,
          ),

        accountNumber:
          identity.accountNumber
            ? `${identity.accountNumber.slice(0, 2)}***${identity.accountNumber.slice(-2)}`
            : null,
      },

      metadata: {
        schemaVersion:
          SCHEMA_VERSION,

        callbackStatus:
          identity.status,

        amountMinor:
          identity.amountMinor,

        currency:
          identity.currency,
      },
    };

    const method =
      [
        'createIfAbsent',
        'createCorrelationIfAbsent',
        'upsertCorrelation',
        'recordCorrelation',
        'persistCorrelation',
        'create',
      ].find(
        (name) =>
          typeof this.callbackRepository?.[name] ===
          'function',
      );

    if (!method) {
      if (
        this.configuration
          .requireAtomicCorrelationPersistence
      ) {
        throw new AirtelCollectionCallbackCorrelationError(
          'Callback repository contract is unavailable.',
          {
            code:
              'AIRTEL_CALLBACK_REPOSITORY_CONTRACT_INVALID',

            status:
              503,

            retryable:
              true,

            tenantId,
            correlationId,
          },
        );
      }

      return {
        persisted:
          false,

        authoritative:
          false,
      };
    }

    try {
      const persisted =
        await this.callbackRepository[
          method
        ](record);

      const duplicate =
        Boolean(
          persisted?.duplicate ??
          persisted?.alreadyExists ??
          persisted?.replay,
        );

      if (duplicate) {
        this.statistics.persistenceRaces++;
      }

      return {
        persisted:
          true,

        authoritative:
          true,

        duplicate,

        record:
          sanitize(
            persisted,
          ),
      };
    } catch (error) {
      if (
        /DUPLICATE|E11000|ALREADY EXISTS/i.test(
          `${error?.code || ''} ${error?.name || ''} ${error?.message || ''}`,
        )
      ) {
        this.statistics.persistenceRaces++;

        return {
          persisted:
            false,

          authoritative:
            true,

          duplicate:
            true,
        };
      }

      if (
        !this.configuration
          .failClosedOnPersistenceError
      ) {
        this.logWarn(
          'Callback correlation persistence failed; continuing by policy.',
          error,
          {
            tenantId,
            correlationId,
          },
        );

        return {
          persisted:
            false,

          authoritative:
            false,
        };
      }

      throw new AirtelCollectionCallbackCorrelationError(
        'Failed to persist callback correlation decision.',
        {
          code:
            'AIRTEL_CALLBACK_CORRELATION_PERSIST_FAILED',

          status:
            503,

          retryable:
            true,

          tenantId,
          correlationId,

          cause:
            error,
        },
      );
    }
  }

  async recordDecision({
    tenantId,
    callback,
    fingerprint,
    result,
    context,
  }) {
    if (!this.auditService) {
      return {
        recorded:
          false,
      };
    }

    const payload = {
      action:
        safeEventStatus(
          result.status,
        ),

      tenantId,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      correlationId:
        result.correlationId,

      metadata: {
        callbackFingerprint:
          fingerprint,

        callbackIdentity:
          safeCallbackIdentity(
            callback,
            this.configuration,
          ),

        status:
          result.status,

        decision:
          result.decision,

        confidence:
          result.confidence,

        matchType:
          result.matchType,

        collectionId:
          result.collectionId,

        reviewRequired:
          result.reviewRequired,

        reason:
          result.reason,

        requestId:
          context?.requestId ||
          null,

        traceId:
          context?.traceId ||
          null,
      },
    };

    try {
      const method =
        [
          'record',
          'append',
          'write',
          'createAuditLog',
        ].find(
          (name) =>
            typeof this.auditService?.[name] ===
            'function',
        );

      if (!method) {
        return {
          recorded:
            false,

          reason:
            'No audit method exposed.',
        };
      }

      await this.auditService[
        method
      ](payload);

      return {
        recorded:
          true,
      };
    } catch (error) {
      this.statistics.auditFailures++;

      if (
        this.configuration
          .failOpenOnAuditError
      ) {
        this.logWarn(
          'Callback correlation audit failed; continuing by policy.',
          error,
          {
            tenantId,

            correlationId:
              result.correlationId,
          },
        );

        return {
          recorded:
            false,
        };
      }

      throw new AirtelCollectionCallbackCorrelationError(
        'Callback correlation audit recording failed.',
        {
          code:
            'AIRTEL_CALLBACK_CORRELATION_AUDIT_FAILED',

          status:
            503,

          retryable:
            true,

          tenantId,

          correlationId:
            result.correlationId,

          cause:
            error,
        },
      );
    }
  }

  async publishCorrelationEvent({
    tenantId,
    callback,
    identity,
    fingerprint,
    result,
    correlationId,
    requestId,
    traceId,
  }) {
    if (!this.eventBus) {
      return {
        published:
          false,
      };
    }

    const payload = {
      type:
        safeEventStatus(
          result.status,
        ),

      tenantId,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      correlationId,

      requestId:
        requestId ||
        null,

      traceId:
        traceId ||
        null,

      timestamp:
        new Date(
          this.clock.now(),
        ),

      payload: {
        callbackFingerprint:
          fingerprint,

        callbackIdentity:
          safeCallbackIdentity(
            callback,
            this.configuration,
          ),

        callbackStatus:
          identity.status,

        result: {
          status:
            result.status,

          decision:
            result.decision,

          confidence:
            result.confidence,

          matchType:
            result.matchType,

          collectionId:
            result.collectionId,

          reviewRequired:
            result.reviewRequired,

          reason:
            result.reason,

          matches:
            result.matches,
        },
      },
    };

    try {
      const method =
        [
          'publish',
          'enqueue',
          'emit',
        ].find(
          (name) =>
            typeof this.eventBus?.[name] ===
            'function',
        );

      if (!method) {
        return {
          published:
            false,

          reason:
            'No event method exposed.',
        };
      }

      await this.eventBus[
        method
      ](payload);

      return {
        published:
          true,
      };
    } catch (error) {
      this.statistics.eventFailures++;

      if (
        this.configuration
          .failOpenOnEventError
      ) {
        this.logWarn(
          'Callback correlation event publication failed; continuing by policy.',
          error,
          {
            tenantId,
            correlationId,
          },
        );

        return {
          published:
            false,
        };
      }

      throw new AirtelCollectionCallbackCorrelationError(
        'Callback correlation event publication failed.',
        {
          code:
            'AIRTEL_CALLBACK_CORRELATION_EVENT_FAILED',

          status:
            503,

          retryable:
            true,

          tenantId,
          correlationId,

          cause:
            error,
        },
      );
    }
  }

  async publishCorrelation({
    tenantId,
    callback,
    result,
    correlationId =
      crypto.randomUUID(),
  } = {}) {
    const identity =
      callbackIdentity(
        callback || {},
        this.configuration,
      );

    const fingerprint =
      fingerprintFromIdentity(
        identity,
        tenantId,
      );

    return this.publishCorrelationEvent({
      tenantId,
      callback,
      identity,
      fingerprint,
      result,
      correlationId,
      requestId:
        null,
      traceId:
        null,
    });
  }

  buildCacheKey({
    tenantId,
    fingerprint,
  }) {
    return cacheKey(
      tenantId,
      fingerprint,
    );
  }

  resolveCacheTTL(
    ttl =
      this.configuration.cacheTTLSeconds,
  ) {
    const n =
      Number(ttl);

    return Number.isFinite(n) &&
      n > 0
      ? Math.min(
          86400,
          Math.floor(n),
        )
      : 300;
  }

  async getCachedCorrelation({
    tenantId,
    fingerprint,
  }) {
    const key =
      cacheKey(
        tenantId,
        fingerprint,
      );

    const external =
      await this.safeCacheGet(
        key,
      );

    if (external) {
      return (
        external.result ??
        external.value ??
        external
      );
    }

    this.pruneLocalCache();

    const local =
      this._localCache.get(
        key,
      );

    if (
      !local ||
      local.expiresAt <=
        this.clock.now()
    ) {
      if (local) {
        this._localCache.delete(
          key,
        );
      }

      return null;
    }

    return local.result;
  }

  async setCachedCorrelation({
    tenantId,
    fingerprint,
    result,
    ttlSeconds,
  }) {
    const key =
      cacheKey(
        tenantId,
        fingerprint,
      );

    const ttl =
      this.resolveCacheTTL(
        ttlSeconds,
      );

    const expiresAt =
      this.clock.now() +
      ttl * 1000;

    const value = {
      result:
        sanitize(result),

      cachedAt:
        new Date(
          this.clock.now(),
        ),

      expiresAt:
        new Date(
          expiresAt,
        ),

      provider:
        PROVIDER,

      operation:
        OPERATION,

      callbackFingerprint:
        fingerprint,
    };

    if (this.cache) {
      try {
        if (
          typeof this.cache.setEx ===
          'function'
        ) {
          await this.cache.setEx(
            key,
            ttl,
            JSON.stringify(
              value,
            ),
          );
        } else if (
          typeof this.cache.set ===
          'function'
        ) {
          try {
            await this.cache.set(
              key,
              value,
              ttl,
            );
          } catch {
            await this.cache.set(
              key,
              JSON.stringify(
                value,
              ),
              ttl,
            );
          }
        }
      } catch (error) {
        this.logWarn(
          'Callback correlation cache write failed.',
          error,
          {
            key,
          },
        );
      }
    }

    this._localCache.set(
      key,
      {
        result:
          value.result,

        expiresAt,
      },
    );

    return {
      stored:
        true,

      key,

      expiresAt:
        new Date(
          expiresAt,
        ),
    };
  }

  async invalidateCache({
    tenantId,
    fingerprint,
  }) {
    const key =
      cacheKey(
        tenantId,
        fingerprint,
      );

    this._localCache.delete(
      key,
    );

    try {
      if (
        typeof this.cache?.delete ===
        'function'
      ) {
        await this.cache.delete(
          key,
        );

        return true;
      }

      if (
        typeof this.cache?.del ===
        'function'
      ) {
        await this.cache.del(
          key,
        );

        return true;
      }
    } catch (error) {
      this.logWarn(
        'Callback correlation cache invalidation failed.',
        error,
        {
          key,
        },
      );
    }

    return false;
  }

  async clearCache() {
    this._localCache.clear();

    try {
      if (
        typeof this.cache?.clear ===
        'function'
      ) {
        await this.cache.clear();
        return true;
      }

      if (
        typeof this.cache?.flush ===
        'function'
      ) {
        await this.cache.flush();
        return true;
      }
    } catch (error) {
      this.logWarn(
        'Callback correlation cache clear failed.',
        error,
      );
    }

    return false;
  }

  pruneLocalCache() {
    const now =
      this.clock.now();

    for (
      const [key, item]
      of this._localCache
    ) {
      if (
        !item ||
        item.expiresAt <= now
      ) {
        this._localCache.delete(
          key,
        );
      }
    }
  }

  pruneExpiredCache() {
    this.pruneLocalCache();
    return this.getCacheStatistics();
  }

  async safeCacheGet(
    key,
  ) {
    if (!this.cache) {
      return null;
    }

    try {
      const value =
        await this.cache.get?.(
          key,
        );

      if (!value) {
        return null;
      }

      if (
        typeof value ===
        'string'
      ) {
        try {
          return JSON.parse(
            value,
          );
        } catch {
          return value;
        }
      }

      return value;
    } catch (error) {
      this.logWarn(
        'Callback correlation cache read failed.',
        error,
        {
          key,
        },
      );

      return null;
    }
  }

  getCacheStatistics() {
    this.pruneLocalCache();

    return {
      localEntries:
        this._localCache.size,

      cacheHits:
        this.runtime.cacheHits,

      cacheMisses:
        this.runtime.cacheMisses,

      externalCacheConfigured:
        Boolean(this.cache),

      ttlSeconds:
        this.resolveCacheTTL(),
    };
  }

  cacheHealth() {
    return {
      status:
        this.cache
          ? 'CONFIGURED'
          : 'LOCAL_ONLY',

      ...this.getCacheStatistics(),
    };
  }

  statisticsSnapshot() {
    return Object.freeze({
      ...this.statistics,
    });
  }

  health() {
    const readiness =
      this.readiness();

    const status =
      [
        HEALTH_STATUS.STOPPING,
        HEALTH_STATUS.DOWN,
      ].includes(
        this.runtime.state,
      )
        ? this.runtime.state
        : readiness.status;

    return {
      provider:
        PROVIDER,

      operation:
        OPERATION,

      module:
        MODULE_NAME,

      engine:
        ENGINE_NAME,

      version:
        ENGINE_VERSION,

      status,

      initialized:
        this.runtime.initialized,

      activeCorrelations:
        this.runtime.activeCorrelations,

      uptimeMs:
        this.clock.now() -
        this.runtime.startedAt.getTime(),

      startedAt:
        this.runtime.startedAt,

      lastCorrelationAt:
        this.runtime.lastCorrelationAt,

      lastFailureAt:
        this.runtime.lastFailureAt,

      lastErrorCode:
        this.runtime.lastErrorCode,

      statistics:
        this.statisticsSnapshot(),

      cache:
        this.cacheHealth(),

      readiness,

      capabilities:
        CAPABILITIES,
    };
  }

  readiness() {
    const repositories = [
      this.collectionRepository,
      this.paymentRepository,
      this.transactionRepository,
    ].filter(Boolean);

    const lookupMethods = [
      'findByProviderReference',
      'findByTransactionId',
      'findByExternalReference',
      'findByPaymentReference',
      'findByCustomerReference',
      'findByPhoneAndAmount',
    ];

    const lookupAvailable =
      repositories.some(
        (repo) =>
          lookupMethods.some(
            (method) =>
              typeof repo?.[method] ===
              'function',
          ),
      );

    const persistenceAvailable =
      [
        'createIfAbsent',
        'createCorrelationIfAbsent',
        'upsertCorrelation',
        'recordCorrelation',
        'persistCorrelation',
        'create',
      ].some(
        (method) =>
          typeof this.callbackRepository?.[method] ===
          'function',
      );

    const errors = [];

    if (
      this.configuration
        .requireRepositoryForReady &&
      !this.callbackRepository
    ) {
      errors.push(
        'CALLBACK_REPOSITORY_UNAVAILABLE',
      );
    }

    if (!lookupAvailable) {
      errors.push(
        'COLLECTION_LOOKUP_UNAVAILABLE',
      );
    }

    if (
      this.configuration
        .requireRepositoryForReady &&
      this.callbackRepository &&
      !persistenceAvailable
    ) {
      errors.push(
        'CORRELATION_PERSISTENCE_CONTRACT_UNAVAILABLE',
      );
    }

    return {
      status:
        errors.length
          ? HEALTH_STATUS.DEGRADED
          : HEALTH_STATUS.READY,

      ready:
        !errors.length,

      errors,

      lookupAvailable,

      persistenceAvailable,

      duplicateProtection: {
        authoritativeRepository:
          Boolean(
            this.callbackRepository,
          ),

        distributedCache:
          Boolean(
            this.cache,
          ),

        localCache:
          true,
      },
    };
  }

  capabilities() {
    return {
      ...CAPABILITIES,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      engine:
        ENGINE_NAME,

      version:
        ENGINE_VERSION,

      matchTypes:
        Object.values(
          MATCH_TYPE,
        ),

      minimumConfidence:
        this.configuration.minimumConfidence,

      partialConfidence:
        this.configuration.partialConfidence,
    };
  }

  diagnostics() {
    return {
      component:
        COMPONENT,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      module:
        MODULE_NAME,

      version:
        ENGINE_VERSION,

      schemaVersion:
        SCHEMA_VERSION,

      configuration:
        sanitize(
          this.configuration,
        ),

      runtime:
        sanitize(
          this.runtime,
        ),

      statistics:
        this.statisticsSnapshot(),

      health:
        this.health(),

      cache:
        this.cacheHealth(),

      dependencies: {
        paymentRepository:
          Boolean(
            this.paymentRepository,
          ),

        collectionRepository:
          Boolean(
            this.collectionRepository,
          ),

        transactionRepository:
          Boolean(
            this.transactionRepository,
          ),

        callbackRepository:
          Boolean(
            this.callbackRepository,
          ),

        idempotencyManager:
          Boolean(
            this.idempotencyManager,
          ),

        cache:
          Boolean(
            this.cache,
          ),

        auditService:
          Boolean(
            this.auditService,
          ),

        eventBus:
          Boolean(
            this.eventBus,
          ),

        metrics:
          Boolean(
            this.metrics,
          ),

        tracer:
          Boolean(
            this.tracer,
          ),

        logger:
          Boolean(
            this.logger,
          ),
      },

      security: {
        tenantIsolation:
          true,

        rawCallbackPersistence:
          false,

        rawCallbackAudit:
          false,

        rawCallbackEventPublication:
          false,

        financialMutation:
          false,

        providerCommunication:
          false,

        finalityAuthority:
          false,
      },
    };
  }

  snapshot() {
    return this.diagnostics();
  }

  resetStatistics() {
    for (
      const key
      of Object.keys(
        this.statistics,
      )
    ) {
      this.statistics[key] = 0;
    }

    return this.statisticsSnapshot();
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

      if (
        span?.setAttributes
      ) {
        span.setAttributes(
          sanitize(attributes),
        );
      } else if (
        span?.setAttribute
      ) {
        for (
          const [
            key,
            value,
          ]
          of Object.entries(
            sanitize(attributes),
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

  emitMetric(
    name,
    value = 1,
  ) {
    try {
      if (
        typeof this.metrics?.counter ===
        'function'
      ) {
        return this.metrics.counter(
          name,
          value,
        );
      }

      if (
        typeof this.metrics?.increment ===
        'function'
      ) {
        return this.metrics.increment(
          name,
          value,
        );
      }

      if (
        typeof this.metrics?.inc ===
        'function'
      ) {
        return this.metrics.inc(
          name,
          value,
        );
      }
    } catch {}

    return undefined;
  }

  emitTiming(
    name,
    value,
  ) {
    try {
      if (
        typeof this.metrics?.histogram ===
        'function'
      ) {
        return this.metrics.histogram(
          name,
          value,
        );
      }

      if (
        typeof this.metrics?.observe ===
        'function'
      ) {
        return this.metrics.observe(
          name,
          value,
        );
      }
    } catch {}

    return undefined;
  }

  logWarn(
    message,
    error,
    context = {},
  ) {
    try {
      this.logger?.warn?.({
        component:
          COMPONENT,

        message,

        ...sanitize(
          context,
        ),

        error:
          error
            ? this.safeErrorDetails(
                error,
              )
            : undefined,
      });
    } catch {}
  }

  logError(
    message,
    error,
    context = {},
  ) {
    try {
      this.logger?.error?.({
        component:
          COMPONENT,

        message,

        ...sanitize(
          context,
        ),

        error:
          error
            ? this.safeErrorDetails(
                error,
              )
            : undefined,
      });
    } catch {}
  }

  safeErrorDetails(
    error,
  ) {
    return {
      name:
        boundedString(
          error?.name,
          120,
        ),

      code:
        boundedString(
          error?.code,
          160,
        ),

      message:
        boundedString(
          error?.message,
          500,
        ),

      retryable:
        Boolean(
          error?.retryable,
        ),
    };
  }

  normalizeError(
    error,
    context = {},
  ) {
    return error instanceof
      AirtelCollectionCallbackCorrelationError
      ? error
      : new AirtelCollectionCallbackCorrelationError(
          error?.message ||
            'Airtel collection callback correlation failed.',
          {
            code:
              error?.code ||
              'AIRTEL_CALLBACK_CORRELATION_ERROR',

            status:
              Number(
                error?.status ||
                error?.statusCode,
              ) || 500,

            retryable:
              Boolean(
                error?.retryable,
              ),

            tenantId:
              context.tenantId ||
              error?.tenantId ||
              null,

            correlationId:
              context.correlationId ||
              error?.correlationId ||
              null,

            details: {
              causeName:
                error?.name,
            },

            cause:
              error,
          },
        );
  }
}

export function createCallbackIdentity(
  callback = {},
  configuration = DEFAULT_CONFIGURATION,
) {
  return callbackIdentity(
    callback,
    configuration,
  );
}

export function createCallbackFingerprint(
  callback = {},
  configuration = DEFAULT_CONFIGURATION,
  tenantId = null,
) {
  return fingerprintFromIdentity(
    callbackIdentity(
      callback,
      configuration,
    ),
    tenantId,
  );
}

export function normalizeAirtelPhone(
  value,
  configuration = DEFAULT_CONFIGURATION,
) {
  return normalizePhone(
    value,
    configuration,
  );
}

export function normalizeCollectionAmountMinor(
  callback = {},
  configuration = DEFAULT_CONFIGURATION,
) {
  return amountMinor(
    callback,
    upper(callback.currency) ||
      upper(configuration.defaultCurrency),
    configuration,
  );
}

export function buildCallbackCacheKey({
  tenantId,
  fingerprint,
}) {
  return cacheKey(
    tenantId,
    fingerprint,
  );
}

export function isCallbackTerminal(
  callback = {},
) {
  return [
    'SUCCESS',
    'FAILED',
    'COMPLETED',
    'REVERSED',
    'CANCELLED',
    'REJECTED',
  ].includes(
    upper(callback.status),
  );
}

export function compareCallbackFingerprint(
  left,
  right,
) {
  const a =
    identifier(left);

  const b =
    identifier(right);

  return Boolean(
    a &&
    b &&
    a.length === b.length &&
    crypto.timingSafeEqual(
      Buffer.from(a),
      Buffer.from(b),
    ),
  );
}

export function sanitizeCallbackForAudit(
  callback = {},
  configuration = DEFAULT_CONFIGURATION,
) {
  const identity =
    callbackIdentity(
      callback,
      configuration,
    );

  return {
    provider:
      PROVIDER,

    operation:
      OPERATION,

    callbackIdentity:
      safeCallbackIdentity(
        callback,
        configuration,
      ),

    callbackFingerprint:
      fingerprintFromIdentity(
        identity,
      ),
  };
}

export function getDefaultConfiguration() {
  return {
    ...DEFAULT_CONFIGURATION,

    currencyMinorUnits: {
      ...DEFAULT_CONFIGURATION.currencyMinorUnits,
    },
  };
}

export function createCallbackCorrelation(
  options = {},
) {
  return new CallbackCorrelation(
    options,
  );
}

export default CallbackCorrelation;