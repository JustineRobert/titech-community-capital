'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Collection Service
 * =============================================================================
 * File:
 *   backend/modules/payment/airtel/collections/collectionService.js
 *
 * Architectural role
 * ------------------
 * Canonical orchestration boundary for Airtel Money inbound COLLECTION
 * operations. It owns workflow orchestration and integration boundaries, not
 * financial accounting itself.
 *
 * Canonical flow
 * --------------
 * Request -> Validation -> Policy/Fraud/AML -> Idempotency -> Durable Intent
 * -> Approval (when required) -> Provider Adapter -> Outcome Normalization
 * -> Transaction State Machine -> Financial Core (on confirmed success)
 * -> Callback Correlation / Reconciliation / Recovery
 *
 * Explicit boundaries
 * -------------------
 * - No Airtel OAuth implementation.
 * - No raw HTTP implementation.
 * - No direct database/Mongoose/Redis access.
 * - No direct ledger, balance or wallet mutation.
 * - No KYC/AML/fraud source of truth.
 * - No callback signature verification.
 * - No settlement finality outside TITECH FINANCIAL CORE.
 * - No blind retry after ambiguous provider outcomes.
 *
 * Financial safety principles
 * ---------------------------
 * 1. Provider transport success is not financial settlement.
 * 2. PENDING / UNKNOWN / TIMEOUT / AMBIGUOUS never become SUCCESS by inference.
 * 3. Original financial idempotency identity is preserved across retries.
 * 4. Callback delivery is evidence for an existing transaction, not a new one.
 * 5. Every mutation is tenant scoped and routed through the canonical state
 *    machine using optimistic concurrency information.
 * 6. Financial Core is the authoritative settlement/accounting boundary.
 * =============================================================================
 */

import crypto from 'node:crypto';

export const PROVIDER = 'AIRTEL';
export const OPERATION = 'COLLECTION';
export const MODULE_NAME = 'titech.airtel.collections';
export const ENGINE_NAME = 'airtel-collection-service';
export const ENGINE_VERSION = '4.1.3';
export const COMPONENT = ENGINE_NAME;
export const SCHEMA_VERSION = 5;

export const SERVICE_STATUS = Object.freeze({
  CREATED: 'CREATED', INITIALIZING: 'INITIALIZING', READY: 'READY',
  DEGRADED: 'DEGRADED', SHUTTING_DOWN: 'SHUTTING_DOWN', STOPPED: 'STOPPED',
});

export const COLLECTION_STATES = Object.freeze({
  DRAFT: 'DRAFT', VALIDATING: 'VALIDATING', VALIDATION_FAILED: 'VALIDATION_FAILED',
  PENDING_APPROVAL: 'PENDING_APPROVAL', APPROVED: 'APPROVED', QUEUED: 'QUEUED',
  EXECUTING: 'EXECUTING', PROVIDER_ACCEPTED: 'PROVIDER_ACCEPTED',
  PROVIDER_PENDING: 'PROVIDER_PENDING', SUCCESS: 'SUCCESS', FAILED: 'FAILED',
  AMBIGUOUS: 'AMBIGUOUS', RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
  RECONCILING: 'RECONCILING', RECONCILED: 'RECONCILED',
  COMPENSATION_REQUIRED: 'COMPENSATION_REQUIRED', COMPENSATING: 'COMPENSATING',
  COMPENSATED: 'COMPENSATED', REFUND_REQUIRED: 'REFUND_REQUIRED',
  REFUNDING: 'REFUNDING', REFUNDED: 'REFUNDED', REVERSED: 'REVERSED',
  CANCELLED: 'CANCELLED', EXPIRED: 'EXPIRED', REJECTED: 'REJECTED', ESCALATED: 'ESCALATED',
});

export const TERMINAL_COLLECTION_STATES = Object.freeze([
  COLLECTION_STATES.SUCCESS, COLLECTION_STATES.FAILED, COLLECTION_STATES.COMPENSATED,
  COLLECTION_STATES.REFUNDED, COLLECTION_STATES.REVERSED, COLLECTION_STATES.CANCELLED,
  COLLECTION_STATES.EXPIRED, COLLECTION_STATES.REJECTED,
]);

export const UNCERTAIN_COLLECTION_STATES = Object.freeze([
  COLLECTION_STATES.PROVIDER_PENDING, COLLECTION_STATES.AMBIGUOUS,
  COLLECTION_STATES.RECONCILIATION_REQUIRED, COLLECTION_STATES.RECONCILING,
]);

export const PROVIDER_OUTCOME = Object.freeze({
  SUCCESS: 'SUCCESS', ACCEPTED: 'ACCEPTED', PENDING: 'PENDING', FAILURE: 'FAILURE',
  REJECTED: 'REJECTED', AMBIGUOUS: 'AMBIGUOUS', UNKNOWN: 'UNKNOWN', TIMEOUT: 'TIMEOUT',
});

export const SERVICE_OUTCOME = Object.freeze({
  CREATED: 'CREATED', EXECUTED: 'EXECUTED', REPLAY: 'REPLAY', IN_FLIGHT: 'IN_FLIGHT',
  PENDING_APPROVAL: 'PENDING_APPROVAL', PROVIDER_PENDING: 'PROVIDER_PENDING',
  SUCCESS: 'SUCCESS', FAILED: 'FAILED', AMBIGUOUS: 'AMBIGUOUS',
  RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED', DUPLICATE: 'DUPLICATE',
  REVIEW: 'REVIEW', CANCELLED: 'CANCELLED',
});

export const ERROR_CODES = Object.freeze({
  SHUTTING_DOWN: 'AIRTEL_COLLECTION_SHUTTING_DOWN',
  TENANT_REQUIRED: 'AIRTEL_COLLECTION_TENANT_REQUIRED',
  TENANT_MISMATCH: 'AIRTEL_COLLECTION_TENANT_MISMATCH',
  REQUEST_INVALID: 'AIRTEL_COLLECTION_REQUEST_INVALID',
  AMOUNT_INVALID: 'AIRTEL_COLLECTION_AMOUNT_INVALID',
  AMOUNT_PRECISION_INVALID: 'AIRTEL_COLLECTION_AMOUNT_PRECISION_INVALID',
  AMOUNT_NEGATIVE: 'AIRTEL_COLLECTION_AMOUNT_NEGATIVE',
  CURRENCY_INVALID: 'AIRTEL_COLLECTION_CURRENCY_INVALID',
  PHONE_INVALID: 'AIRTEL_COLLECTION_PHONE_INVALID',
  REFERENCE_REQUIRED: 'AIRTEL_COLLECTION_REFERENCE_REQUIRED',
  IDEMPOTENCY_REQUIRED: 'AIRTEL_COLLECTION_IDEMPOTENCY_REQUIRED',
  IDEMPOTENCY_CONFLICT: 'AIRTEL_COLLECTION_IDEMPOTENCY_CONFLICT',
  IDEMPOTENCY_UNAVAILABLE: 'AIRTEL_COLLECTION_IDEMPOTENCY_UNAVAILABLE',
  INTENT_PERSISTENCE_FAILED: 'AIRTEL_COLLECTION_INTENT_PERSISTENCE_FAILED',
  STATE_TRANSITION_FAILED: 'AIRTEL_COLLECTION_STATE_TRANSITION_FAILED',
  STATE_CONFLICT: 'AIRTEL_COLLECTION_STATE_CONFLICT',
  PROVIDER_UNAVAILABLE: 'AIRTEL_COLLECTION_PROVIDER_UNAVAILABLE',
  AUTHENTICATION_FAILED: 'AIRTEL_COLLECTION_AUTHENTICATION_FAILED',
  PROVIDER_REJECTED: 'AIRTEL_COLLECTION_PROVIDER_REJECTED',
  PROVIDER_AMBIGUOUS: 'AIRTEL_COLLECTION_PROVIDER_AMBIGUOUS',
  PROVIDER_PENDING: 'AIRTEL_COLLECTION_PROVIDER_PENDING',
  PROVIDER_TIMEOUT: 'AIRTEL_COLLECTION_PROVIDER_TIMEOUT',
  FINANCIAL_CORE_REQUIRED: 'AIRTEL_COLLECTION_FINANCIAL_CORE_REQUIRED',
  FINANCIAL_CORE_FAILED: 'AIRTEL_COLLECTION_FINANCIAL_CORE_FAILED',
  POLICY_BLOCKED: 'AIRTEL_COLLECTION_POLICY_BLOCKED',
  FRAUD_BLOCKED: 'AIRTEL_COLLECTION_FRAUD_BLOCKED',
  AML_BLOCKED: 'AIRTEL_COLLECTION_AML_BLOCKED',
  APPROVAL_REQUIRED: 'AIRTEL_COLLECTION_APPROVAL_REQUIRED',
  REVIEW_REQUIRED: 'AIRTEL_COLLECTION_REVIEW_REQUIRED',
  CALLBACK_CORRELATION_FAILED: 'AIRTEL_COLLECTION_CALLBACK_CORRELATION_FAILED',
  CALLBACK_NOT_CORRELATED: 'AIRTEL_COLLECTION_CALLBACK_NOT_CORRELATED',
  RECONCILIATION_REQUIRED: 'AIRTEL_COLLECTION_RECONCILIATION_REQUIRED',
  CONFIGURATION_INVALID: 'AIRTEL_COLLECTION_CONFIGURATION_INVALID',
  DEPENDENCY_INVALID: 'AIRTEL_COLLECTION_DEPENDENCY_INVALID',
});

export const DEFAULT_CONFIGURATION = Object.freeze({
  requestTimeoutMs: 30000,
  statusTimeoutMs: 20000,
  shutdownTimeoutMs: 30000,
  maxProviderAttempts: 1,
  enableProviderRetries: false,
  retryBaseDelayMs: 1000,
  retryMaxDelayMs: 10000,
  idempotencyLeaseSeconds: 120,
  idempotencyTtlSeconds: 86400,
  requireFinancialCoreForSuccess: true,
  allowProviderSuccessWithoutFinancialCore: false,
  requireDurableIntent: true,
  requireAtomicStateTransition: true,
  requireCallbackCorrelation: false,
  approvalRequiredByDefault: false,
  callbackCorrelationRequired: false,
  enableAudit: true,
  enableEvents: true,
  enableReconciliation: true,
  enableSettlementHooks: true,
  enableCallbackRegistration: true,
  failClosedOnPolicyError: true,
  failClosedOnFraudError: true,
  failClosedOnAmlError: true,
  failClosedOnIdempotencyError: true,
  failClosedOnIntentPersistenceError: true,
  failOpenOnAuditError: true,
  failOpenOnEventError: true,
  countryCode: 'UG',
  defaultCurrency: 'UGX',
  supportedCurrencies: Object.freeze(['UGX']),
  currencyMinorUnits: Object.freeze({
    UGX: 0,
    RWF: 0,
    KES: 2,
    TZS: 2,
    ZMW: 2,
    GHS: 2,
    NGN: 2,
    USD: 2,
  }),
});

export class AirtelCollectionServiceError extends Error {
  constructor(message, options = {}) {
    super(
      String(
        message ||
        'Airtel collection operation failed.',
      ),
      options.cause
        ? { cause: options.cause }
        : undefined,
    );

    this.name =
      'AirtelCollectionServiceError';

    this.code =
      options.code ||
      ERROR_CODES.REQUEST_INVALID;

    this.statusCode =
      Number(
        options.statusCode ||
        options.status ||
        500,
      );

    this.retryable =
      Boolean(options.retryable);

    this.uncertain =
      Boolean(options.uncertain);

    this.tenantId =
      options.tenantId ||
      null;

    this.correlationId =
      options.correlationId ||
      null;

    this.operationId =
      options.operationId ||
      null;

    this.details =
      sanitize(options.details);
  }

  toJSON() {
    return {
      name:
        this.name,

      message:
        this.message,

      code:
        this.code,

      statusCode:
        this.statusCode,

      retryable:
        this.retryable,

      uncertain:
        this.uncertain,

      tenantId:
        this.tenantId,

      correlationId:
        this.correlationId,

      operationId:
        this.operationId,

      details:
        this.details,
    };
  }
}

const SENSITIVE =
  /authorization|token|secret|password|signature|credential|api[-_]?key|private[-_]?key|client[-_]?secret|rawpayload|raw_payload|refresh[-_]?token|access[-_]?token/i;

const isFn =
  (v) =>
    typeof v === 'function';

const now =
  (clock) =>
    new Date(clock.now());

const upper =
  (v) => {
    const s =
      v == null
        ? ''
        : String(v).trim();

    return s
      ? s.toUpperCase()
      : null;
  };

const bounded =
  (
    v,
    max = 512,
  ) => {
    if (v == null) return null;

    const s =
      String(v).trim();

    return s
      ? s.slice(0, max)
      : null;
  };

const reference =
  (v) =>
    upper(v);

const collectionId =
  (r) =>
    r?.collectionId ??
    r?.paymentId ??
    r?.transactionId ??
    r?._id ??
    r?.id ??
    null;

const terminal =
  (s) =>
    TERMINAL_COLLECTION_STATES.includes(
      upper(s),
    );

const uncertain =
  (s) =>
    UNCERTAIN_COLLECTION_STATES.includes(
      upper(s),
    );

const opKey =
  (tenantId, ref) =>
    `${tenantId}:${ref}`;

function sanitize(
  value,
  depth = 0,
  seen = new WeakSet(),
) {
  if (value == null) {
    return value ?? null;
  }

  if (depth > 7) {
    return '[MAX_DEPTH]';
  }

  if (typeof value === 'string') {
    return value.slice(0, 2000);
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value !== 'object') {
    return String(value);
  }

  if (seen.has(value)) {
    return '[CIRCULAR]';
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map(
        (v) =>
          sanitize(
            v,
            depth + 1,
            seen,
          ),
      );
  }

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 300)
      .map(
        ([k, v]) => [
          k,
          SENSITIVE.test(k)
            ? '[REDACTED]'
            : sanitize(
                v,
                depth + 1,
                seen,
              ),
        ],
      ),
  );
}

function stable(
  value,
  depth = 0,
) {
  if (depth > 10) {
    return '[MAX_DEPTH]';
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(
      (v) =>
        stable(
          v,
          depth + 1,
        ),
    );
  }

  if (
    !value ||
    typeof value !== 'object' ||
    value instanceof Date
  ) {
    return typeof value === 'bigint'
      ? value.toString()
      : value;
  }

  return Object.keys(value)
    .sort()
    .reduce(
      (o, k) => {
        o[k] =
          stable(
            value[k],
            depth + 1,
          );
        return o;
      },
      {},
    );
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(
      String(value),
      'utf8',
    )
    .digest('hex');
}

function normalizePhone(
  value,
  config,
) {
  const raw =
    bounded(
      value,
      64,
    );

  if (!raw) {
    return null;
  }

  const d =
    raw.replace(
      /\D/g,
      '',
    );

  if (!d) {
    return null;
  }

  if (
    d.startsWith('00')
  ) {
    return `+${d.slice(2)}`;
  }

  if (
    d.startsWith('256')
  ) {
    return `+${d}`;
  }

  if (
    config.countryCode === 'UG' &&
    d.length === 10 &&
    d.startsWith('0')
  ) {
    return `+256${d.slice(1)}`;
  }

  if (
    config.countryCode === 'UG' &&
    d.length === 9
  ) {
    return `+256${d}`;
  }

  return `+${d}`;
}

function parseMinor(
  value,
  currency,
  config,
) {
  if (
    value == null ||
    value === ''
  ) {
    return null;
  }

  const raw =
    String(value).trim();

  if (
    !/^-?\d+(?:\.\d+)?$/.test(
      raw,
    )
  ) {
    return null;
  }

  const units =
    Number(
      config.currencyMinorUnits?.[
        currency
      ] ?? 0,
    );

  const negative =
    raw.startsWith('-');

  const unsigned =
    negative
      ? raw.slice(1)
      : raw;

  const [
    whole,
    fraction = '',
  ] =
    unsigned.split('.');

  if (
    fraction.length > units &&
    /[^0]/.test(
      fraction.slice(units),
    )
  ) {
    return null;
  }

  const scale =
    10n ** BigInt(units);

  const padded =
    `${fraction}00000000`.slice(
      0,
      units,
    );

  const minor =
    BigInt(whole) * scale +
    BigInt(padded || '0');

  const result =
    negative
      ? -minor
      : minor;

  if (
    result >
      BigInt(
        Number.MAX_SAFE_INTEGER,
      ) ||
    result <
      BigInt(
        Number.MIN_SAFE_INTEGER,
      )
  ) {
    return null;
  }

  return Number(result);
}

function normalizeAmount(
  amount,
  currency,
  config,
) {
  const c =
    upper(currency) ||
    upper(
      config.defaultCurrency,
    );

  return {
    amount:
      String(amount),

    amountMinor:
      parseMinor(
        amount,
        c,
        config,
      ),

    currency:
      c,
  };
}

function safeError(error) {
  return {
    name:
      bounded(
        error?.name,
        120,
      ),

    code:
      bounded(
        error?.code,
        160,
      ),

    message:
      bounded(
        error?.message,
        500,
      ),

    statusCode:
      error?.statusCode ??
      error?.status ??
      null,

    retryable:
      Boolean(
        error?.retryable,
      ),

    uncertain:
      Boolean(
        error?.uncertain,
      ),
  };
}

async function invoke(
  target,
  methods,
  args,
) {
  for (
    const method
    of methods
  ) {
    if (
      isFn(
        target?.[method],
      )
    ) {
      return {
        called:
          true,

        method,

        value:
          await target[
            method
          ](args),
      };
    }
  }

  return {
    called:
      false,

    method:
      null,

    value:
      null,
  };
}

export class CollectionService {
  constructor({
    configuration,
    authService,
    providerClient,
    httpClient,
    validator,
    transactionBuilder,
    transactionStateMachine,
    collectionStateMachine,
    stateMachine,
    idempotencyManager,
    fraudGuard,
    fraudService,
    amlService,
    policyEngine,
    velocityService,
    approvalService,
    callbackCorrelation,
    callbackRegistry,
    collectionRepository,
    intentRepository,
    financialCore,
    financialTransactionService,
    ledgerBridge,
    reconciliationService,
    settlementService,
    compensationService,
    recoveryService,
    circuitBreaker,
    distributedLock,
    auditService,
    eventBus,
    outboxService,
    deadLetterQueue,
    metrics,
    tracer,
    logger,
    clock = Date,
  } = {}) {
    const c =
      configuration?.collections ||
      configuration ||
      {};

    this.configuration = {
      ...DEFAULT_CONFIGURATION,
      ...c,

      currencyMinorUnits: {
        ...DEFAULT_CONFIGURATION.currencyMinorUnits,
        ...(c.currencyMinorUnits || {}),
      },

      supportedCurrencies:
        [
          ...(c.supportedCurrencies ||
            DEFAULT_CONFIGURATION.supportedCurrencies),
        ],
    };

    Object.freeze(
      this.configuration.currencyMinorUnits,
    );

    Object.freeze(
      this.configuration.supportedCurrencies,
    );

    Object.freeze(
      this.configuration,
    );

    Object.assign(
      this,
      {
        authService,
        providerClient,
        httpClient,
        validator,
        transactionBuilder,
        idempotencyManager,
        fraudGuard,
        fraudService,
        amlService,
        policyEngine,
        velocityService,
        approvalService,
        callbackCorrelation,
        callbackRegistry,
        collectionRepository,
        intentRepository,
        ledgerBridge,
        reconciliationService,
        settlementService,
        compensationService,
        recoveryService,
        circuitBreaker,
        distributedLock,
        auditService,
        eventBus,
        outboxService,
        deadLetterQueue,
        metrics,
        tracer,
        logger,
        clock,
      },
    );

    this.transactionStateMachine =
      collectionStateMachine ||
      transactionStateMachine ||
      stateMachine;

    this.financialCore =
      financialCore ||
      financialTransactionService;

    this.state =
      SERVICE_STATUS.CREATED;

    this.initialized =
      false;

    this.initializationPromise =
      null;

    this.shutdownRequested =
      false;

    this.startedAt =
      now(clock);

    this.lastActivityAt =
      null;

    this.lastSuccessAt =
      null;

    this.lastFailureAt =
      null;

    this.lastHealthCheckAt =
      null;

    this.activeOperations =
      new Map();

    this.stats =
      Object.fromEntries(
        [
          'initialized',
          'collectionsStarted',
          'collectionsCompleted',
          'collectionsSucceeded',
          'collectionsFailed',
          'collectionsPending',
          'collectionsAmbiguous',
          'validationFailures',
          'policyBlocks',
          'fraudBlocks',
          'amlBlocks',
          'approvalRequired',
          'authenticationFailures',
          'idempotentReplays',
          'idempotencyConflicts',
          'providerAttempts',
          'providerFailures',
          'providerTimeouts',
          'unsafeRetriesPrevented',
          'stateTransitions',
          'callbackCorrelations',
          'callbackReviews',
          'callbackDuplicates',
          'reconciliationRequests',
          'financialCoreSettlements',
          'financialCoreFailures',
          'auditEvents',
          'eventPublications',
          'outboxEvents',
          'deadLetters',
          'lockAcquisitions',
          'lockFailures',
        ].map(
          (k) =>
            [
              k,
              0,
            ],
        ),
      );

    this.stats.totalProviderDurationMs =
      0;

    this.healthState = {
      status:
        SERVICE_STATUS.CREATED,

      readiness:
        false,

      liveness:
        true,

      dependencies:
        {},

      lastError:
        null,
    };
  }

  async initialize({
    tenantId = null,
    correlationId =
      crypto.randomUUID(),
  } = {}) {
    if (
      this.initialized
    ) {
      return this.health();
    }

    if (
      this.initializationPromise
    ) {
      return this.initializationPromise;
    }

    this.initializationPromise =
      (async () => {
        this.state =
          SERVICE_STATUS.INITIALIZING;

        try {
          this.validateConfiguration();

          const dependencies =
            this.validateDependencies();

          await this.verifyProviderReadiness();

          this.healthState.dependencies =
            {
              ...dependencies,
              ...this.healthState.dependencies,
            };

          const criticalProvider =
            [
              this.healthState.dependencies.provider,
              this.healthState.dependencies.authentication,
            ]
              .filter(Boolean)
              .some(
                (x) =>
                  [
                    'DOWN',
                    'ERROR',
                    'UNAVAILABLE',
                  ].includes(
                    upper(
                      x?.status,
                    ),
                  ),
              );

          if (
            criticalProvider
          ) {
            throw new AirtelCollectionServiceError(
              'Airtel collection dependencies are not ready.',
              {
                code:
                  ERROR_CODES.PROVIDER_UNAVAILABLE,

                statusCode:
                  503,

                retryable:
                  true,

                tenantId,

                correlationId,
              },
            );
          }

          this.initialized =
            true;

          this.state =
            SERVICE_STATUS.READY;

          this.healthState.status =
            SERVICE_STATUS.READY;

          this.healthState.readiness =
            true;

          this.stats.initialized +=
            1;

          await this.audit(
            'AIRTEL_COLLECTION_SERVICE_INITIALIZED',
            {
              tenantId,
              correlationId,
            },
          );

          await this.publishEvent(
            'AIRTEL_COLLECTION_SERVICE_INITIALIZED',
            {
              tenantId,
              correlationId,
            },
          );

          return this.health();
        } catch (error) {
          this.initialized =
            false;

          this.state =
            SERVICE_STATUS.DEGRADED;

          this.healthState.status =
            SERVICE_STATUS.DEGRADED;

          this.healthState.readiness =
            false;

          this.healthState.lastError =
            safeError(error);

          this.lastFailureAt =
            now(this.clock);

          throw this.normalizeError(
            error,
            {
              tenantId,
              correlationId,
            },
          );
        }
      })().finally(
        () => {
          this.initializationPromise =
            null;
        },
      );

    return this.initializationPromise;
  }

  validateConfiguration() {
    if (
      !(
        Number(
          this.configuration.requestTimeoutMs,
        ) > 0
      )
    ) {
      throw new AirtelCollectionServiceError(
        'Invalid collection request timeout.',
        {
          code:
            ERROR_CODES.CONFIGURATION_INVALID,

          statusCode:
            500,
        },
      );
    }

    if (
      !this.configuration.defaultCurrency
    ) {
      throw new AirtelCollectionServiceError(
        'Default collection currency is required.',
        {
          code:
            ERROR_CODES.CONFIGURATION_INVALID,

          statusCode:
            500,
        },
      );
    }

    return isFn(
      this.configuration.validate,
    )
      ? this.configuration.validate()
      : true;
  }

  isCompatibleCollectionStateMachine() {
    const sm =
      this.transactionStateMachine;

    if (!sm) {
      return false;
    }

    if (
      isFn(
        sm.supportsOperation,
      )
    ) {
      try {
        return (
          sm.supportsOperation(
            OPERATION,
          ) === true
        );
      } catch {
        return false;
      }
    }

    const declared =
      upper(
        sm.operation ||
        sm.OPERATION ||
        sm.componentOperation,
      );

    if (declared) {
      return declared === OPERATION;
    }

    if (
      isFn(
        sm.transitionCollection,
      ) ||
      isFn(
        sm.transitionDisbursement,
      )
    ) {
      return isFn(
        sm.transitionCollection,
      );
    }

    return (
      isFn(
        sm.transition,
      ) ||
      isFn(
        sm.move,
      )
    );
  }

  validateDependencies() {
    const available = {
      authService:
        Boolean(
          this.authService &&
          (
            isFn(
              this.authService
                .getAccessToken,
            ) ||
            isFn(
              this.authService
                .authenticate,
            )
          ),
        ),

      providerClient:
        Boolean(
          this.providerClient &&
          (
            isFn(
              this.providerClient.collect,
            ) ||
            isFn(
              this.providerClient.request,
            )
          ),
        ),

      validator:
        Boolean(
          this.validator,
        ),

      idempotencyManager:
        Boolean(
          this.idempotencyManager,
        ),

      transactionStateMachine:
        Boolean(
          this.transactionStateMachine,
        ),

      financialCore:
        Boolean(
          this.financialCore,
        ),

      callbackCorrelation:
        Boolean(
          this.callbackCorrelation,
        ),

      durableIntent:
        this.hasIntentRepository(),
    };

    const required = [
      'authService',
      'providerClient',
      'validator',
      'idempotencyManager',
      'transactionStateMachine',
    ];

    if (
      available.transactionStateMachine &&
      !this.isCompatibleCollectionStateMachine()
    ) {
      required.push(
        'collectionStateMachineCompatibility',
      );
    }

    if (
      this.configuration
        .requireDurableIntent
    ) {
      required.push(
        'durableIntent',
      );
    }

    if (
      this.configuration
        .requireFinancialCoreForSuccess
    ) {
      required.push(
        'financialCore',
      );
    }

    if (
      this.configuration
        .callbackCorrelationRequired ||
      this.configuration
        .requireCallbackCorrelation
    ) {
      required.push(
        'callbackCorrelation',
      );
    }

    const missing =
      required.filter(
        (k) =>
          !available[k],
      );

    if (
      missing.length
    ) {
      throw new AirtelCollectionServiceError(
        'Required collection dependencies are unavailable.',
        {
          code:
            ERROR_CODES.DEPENDENCY_INVALID,

          statusCode:
            503,

          retryable:
            true,

          details: {
            missing,
          },
        },
      );
    }

    return {
      available,
      missing,
    };
  }

  async verifyProviderReadiness() {
    try {
      this.healthState.dependencies.provider =
        isFn(
          this.providerClient?.health,
        )
          ? await this.providerClient.health()
          : {
              status:
                'UNKNOWN',
            };
    } catch (e) {
      this.healthState.dependencies.provider =
        {
          status:
            'DEGRADED',

          error:
            safeError(e),
        };
    }

    try {
      this.healthState.dependencies.authentication =
        isFn(
          this.authService?.health,
        )
          ? await this.authService.health()
          : {
              status:
                'UNKNOWN',
            };
    } catch (e) {
      this.healthState.dependencies.authentication =
        {
          status:
            'DEGRADED',

          error:
            safeError(e),
        };
    }

    return this.healthState.dependencies;
  }

  hasIntentRepository() {
    return Boolean(
      this.collectionRepository ||
      this.intentRepository ||
      this.providerClient
        ?.collectionRepository ||
      this.providerClient
        ?.repository,
    );
  }

  async shutdown() {
    this.shutdownRequested =
      true;

    this.state =
      SERVICE_STATUS.SHUTTING_DOWN;

    this.healthState.status =
      SERVICE_STATUS.SHUTTING_DOWN;

    const deadline =
      this.clock.now() +
      Number(
        this.configuration
          .shutdownTimeoutMs,
      );

    while (
      this.activeOperations.size &&
      this.clock.now() <
        deadline
    ) {
      await new Promise(
        (r) =>
          setTimeout(
            r,
            50,
          ),
      );
    }

    try {
      await this.providerClient?.close?.();
    } catch (e) {
      this.log(
        'warn',
        'Airtel provider shutdown failed.',
        {
          error:
            safeError(e),
        },
      );
    }

    try {
      await this.authService?.shutdown?.();
    } catch (e) {
      this.log(
        'warn',
        'Airtel auth shutdown failed.',
        {
          error:
            safeError(e),
        },
      );
    }

    this.initialized =
      false;

    this.state =
      SERVICE_STATUS.STOPPED;

    this.healthState.status =
      SERVICE_STATUS.STOPPED;

    this.healthState.readiness =
      false;

    return this.health();
  }

  async collect({
    tenantId,
    amount,
    currency =
      this.configuration.defaultCurrency,
    phoneNumber,
    externalReference,
    reference,
    payer = {},
    metadata = {},
    idempotencyKey,
    callbackUrl,
    actor,
    approvalContext,
    context = {},
    correlationId =
      crypto.randomUUID(),
    operationId =
      crypto.randomUUID(),
  } = {}) {
    this.stats.collectionsStarted +=
      1;

    this.lastActivityAt =
      now(this.clock);

    const started =
      this.clock.now();

    let intent =
      null;

    let reservation =
      null;

    let lock =
      null;

    try {
      if (
        this.shutdownRequested
      ) {
        throw new AirtelCollectionServiceError(
          'Collection service is shutting down.',
          {
            code:
              ERROR_CODES.SHUTTING_DOWN,

            statusCode:
              503,

            retryable:
              true,

            tenantId,
            correlationId,
            operationId,
          },
        );
      }

      const request =
        await this.validateCollectionRequest(
          {
            tenantId,
            amount,
            currency,
            phoneNumber,
            externalReference:
              externalReference ||
              reference,
            payer,
            metadata,
            idempotencyKey,
            callbackUrl,
            actor,
            context,
            correlationId,
            operationId,
          },
        );

      const security =
        await this.runSecurityPipeline(
          {
            request,
            tenantId,
            correlationId,
            operationId,
          },
        );

      if (
        security.reviewRequired
      ) {
        this.stats.approvalRequired +=
          1;
      }

      const idem =
        await this.reserveIdempotency(
          {
            tenantId,
            idempotencyKey:
              request.idempotencyKey,
            fingerprint:
              request.financialFingerprint,
            correlationId,
            operationId,
          },
        );

      reservation =
        idem.reservation;

      if (
        idem.conflict
      ) {
        this.stats.idempotencyConflicts +=
          1;

        throw new AirtelCollectionServiceError(
          'Idempotency key conflict.',
          {
            code:
              ERROR_CODES.IDEMPOTENCY_CONFLICT,

            statusCode:
              409,

            tenantId,
            correlationId,
            operationId,
          },
        );
      }

      if (
        idem.replay
      ) {
        this.stats.idempotentReplays +=
          1;

        return this.decorateReplay(
          idem.response,
          {
            tenantId,
            correlationId,
            operationId,
          },
        );
      }

      const referenceConflict =
        await this.findReferenceConflict(
          {
            tenantId,
            request,
          },
        );

      if (
        referenceConflict?.existing
      ) {
        if (
          referenceConflict
            .sameFinancialIdentity
        ) {
          this.stats
            .idempotentReplays +=
            1;

          return this.decorateReplay(
            this.buildResponse(
              {
                outcome:
                  SERVICE_OUTCOME.REPLAY,

                state:
                  upper(
                    referenceConflict
                      .existing
                      .state ||
                    referenceConflict
                      .existing
                      .status,
                  ) ||
                  COLLECTION_STATES.DRAFT,

                request,

                intent:
                  referenceConflict
                    .existing,

                correlationId,
                operationId,

                nextAction:
                  'NONE',
              },
            ),
            {
              tenantId,
              correlationId,
              operationId,
            },
          );
        }

        throw new AirtelCollectionServiceError(
          'External collection reference conflicts with another financial request.',
          {
            code:
              ERROR_CODES.IDEMPOTENCY_CONFLICT,

            statusCode:
              409,

            tenantId,
            correlationId,
            operationId,
          },
        );
      }

      intent =
        await this.createOrLoadIntent(
          {
            request,
            tenantId,
            correlationId,
            operationId,
            policyDecision:
              security,
          },
        );

      lock =
        await this.acquireOperationLock(
          opKey(
            tenantId,
            request.externalReference,
          ),
          {
            tenantId,
            correlationId,
            operationId,
          },
        );

      if (
        await this.requiresApproval(
          {
            request,
            policyDecision:
              security,
            approvalContext,
          },
        )
      ) {
        const approval =
          await this.prepareApproval(
            {
              request,
              intent,
              actor,
              approvalContext,
              tenantId,
              correlationId,
              operationId,
            },
          );

        const pending =
          this.buildResponse(
            {
              outcome:
                SERVICE_OUTCOME.PENDING_APPROVAL,

              state:
                COLLECTION_STATES.PENDING_APPROVAL,

              request,
              intent,
              correlationId,
              operationId,

              nextAction:
                'APPROVE_COLLECTION',

              approval,
            },
          );

        await this.commitIdempotency(
          {
            tenantId,
            idempotencyKey:
              request.idempotencyKey,
            fingerprint:
              request.financialFingerprint,
            response:
              pending,
          },
        );

        this.stats.collectionsPending +=
          1;

        await this.audit(
          'AIRTEL_COLLECTION_PENDING_APPROVAL',
          {
            tenantId,
            correlationId,
            operationId,
            collectionId:
              collectionId(intent),
          },
        );

        return pending;
      }

      await this.transitionState(
        {
          intent,
          tenantId,
          correlationId,
          operationId,
          toState:
            COLLECTION_STATES.VALIDATING,
          action:
            'VALIDATE',
          reason:
            'Collection entered canonical validation state.',
        },
      );

      await this.transitionState(
        {
          intent,
          tenantId,
          correlationId,
          operationId,
          toState:
            COLLECTION_STATES.APPROVED,
          action:
            'APPROVE',
          reason:
            'Collection passed configured security controls.',
        },
      );

      await this.transitionState(
        {
          intent,
          tenantId,
          correlationId,
          operationId,
          toState:
            COLLECTION_STATES.QUEUED,
          action:
            'QUEUE',
          reason:
            'Collection is queued for Airtel execution.',
        },
      );

      const accessToken =
        await this.authenticate(
          {
            tenantId,
            correlationId,
            operationId,
          },
        );

      await this.transitionState(
        {
          intent,
          tenantId,
          correlationId,
          operationId,
          toState:
            COLLECTION_STATES.EXECUTING,
          action:
            'EXECUTE',
          reason:
            'Provider execution started.',
        },
      );

      const providerRequest =
        await this.buildProviderRequest(
          {
            request,
            accessToken,
            tenantId,
            correlationId,
            operationId,
          },
        );

      const execution =
        await this.executeProviderOperation(
          {
            request,
            providerRequest,
            accessToken,
            tenantId,
            correlationId,
            operationId,
          },
        );

      const normalized =
        this.normalizeProviderResponse(
          {
            providerResponse:
              execution.response,

            request,

            tenantId,
            correlationId,
            operationId,

            execution,
          },
        );

      const response =
        await this.applyProviderOutcome(
          {
            intent,
            request,
            normalized,
            tenantId,
            correlationId,
            operationId,
          },
        );

      await this.commitIdempotency(
        {
          tenantId,
          idempotencyKey:
            request.idempotencyKey,
          fingerprint:
            request.financialFingerprint,
          response,
        },
      );

      this.stats.collectionsCompleted +=
        1;

      if (
        response.outcome ===
        SERVICE_OUTCOME.SUCCESS
      ) {
        this.stats.collectionsSucceeded +=
          1;

        this.lastSuccessAt =
          now(this.clock);
      }

      if (
        [
          SERVICE_OUTCOME.FAILED,
          SERVICE_OUTCOME.AMBIGUOUS,
        ].includes(
          response.outcome,
        )
      ) {
        this.stats.collectionsFailed +=
          1;

        this.lastFailureAt =
          now(this.clock);
      }

      this.timing(
        'payment_airtel_collection_duration_ms',
        this.clock.now() -
          started,
      );

      this.metric(
        `payment_airtel_collection_${String(
          response.outcome,
        ).toLowerCase()}_total`,
      );

      return response;
    } catch (error) {
      this.stats.collectionsFailed +=
        1;

      this.lastFailureAt =
        now(this.clock);

      const normalizedError =
        this.normalizeError(
          error,
          {
            tenantId,
            correlationId,
            operationId,
          },
        );

      if (intent) {
        await this.handleExecutionFailure(
          {
            intent,
            tenantId,
            correlationId,
            operationId,
            error:
              normalizedError,
          },
        );
      } else {
        await this.releaseIdempotencyOnFailure(
          {
            tenantId,
            idempotencyKey,
            reservation,
            error:
              normalizedError,
          },
        );
      }

      await this.publishFailureTelemetry(
        {
          tenantId,
          correlationId,
          operationId,
          error:
            normalizedError,
        },
      );

      throw normalizedError;
    } finally {
      await this.releaseOperationLock(
        lock,
      );

      this.activeOperations.delete(
        correlationId,
      );

      this.lastActivityAt =
        now(this.clock);
    }
  }

  async initiate(
    args = {},
  ) {
    return this.collect(
      args,
    );
  }

  async createCollection(
    args = {},
  ) {
    return this.collect(
      args,
    );
  }

  async requestCollection(
    args = {},
  ) {
    return this.collect(
      args,
    );
  }

  async requestPayment(
    args = {},
  ) {
    return this.collect(
      args,
    );
  }

  async validateCollectionRequest(
    input,
  ) {
    const tenantId =
      bounded(
        input.tenantId,
        256,
      );

    if (!tenantId) {
      this.stats.validationFailures +=
        1;

      throw new AirtelCollectionServiceError(
        'Tenant context is required.',
        {
          code:
            ERROR_CODES.TENANT_REQUIRED,

          statusCode:
            400,

          correlationId:
            input.correlationId,

          operationId:
            input.operationId,
        },
      );
    }

    if (
      input.context?.tenantId &&
      String(
        input.context.tenantId,
      ) !==
        String(
          tenantId,
        )
    ) {
      throw new AirtelCollectionServiceError(
        'Tenant context mismatch.',
        {
          code:
            ERROR_CODES.TENANT_MISMATCH,

          statusCode:
            403,

          tenantId,
          correlationId:
            input.correlationId,
          operationId:
            input.operationId,
        },
      );
    }

    const externalReference =
      reference(
        input.externalReference,
      );

    if (!externalReference) {
      throw new AirtelCollectionServiceError(
        'External collection reference is required.',
        {
          code:
            ERROR_CODES.REFERENCE_REQUIRED,

          statusCode:
            400,

          tenantId,
          correlationId:
            input.correlationId,
          operationId:
            input.operationId,
        },
      );
    }

    const idem =
      bounded(
        input.idempotencyKey,
        256,
      );

    if (!idem) {
      throw new AirtelCollectionServiceError(
        'Idempotency key is required.',
        {
          code:
            ERROR_CODES.IDEMPOTENCY_REQUIRED,

          statusCode:
            400,

          tenantId,
          correlationId:
            input.correlationId,
          operationId:
            input.operationId,
        },
      );
    }

    const normalizedAmount =
      normalizeAmount(
        input.amount,
        input.currency,
        this.configuration,
      );

    if (
      normalizedAmount.amountMinor ==
      null
    ) {
      throw new AirtelCollectionServiceError(
        'Collection amount is invalid or has unsupported precision.',
        {
          code:
            String(
              input.amount ??
              '',
            ).includes(
              '.',
            )
              ? ERROR_CODES.AMOUNT_PRECISION_INVALID
              : ERROR_CODES.AMOUNT_INVALID,

          statusCode:
            400,

          tenantId,
          correlationId:
            input.correlationId,
          operationId:
            input.operationId,
        },
      );
    }

    if (
      normalizedAmount.amountMinor <=
      0
    ) {
      throw new AirtelCollectionServiceError(
        'Collection amount must be greater than zero.',
        {
          code:
            ERROR_CODES.AMOUNT_NEGATIVE,

          statusCode:
            400,

          tenantId,
          correlationId:
            input.correlationId,
          operationId:
            input.operationId,
        },
      );
    }

    if (
      !this.configuration
        .supportedCurrencies
        .includes(
          normalizedAmount.currency,
        )
    ) {
      throw new AirtelCollectionServiceError(
        'Unsupported collection currency.',
        {
          code:
            ERROR_CODES.CURRENCY_INVALID,

          statusCode:
            400,

          tenantId,
          correlationId:
            input.correlationId,
          operationId:
            input.operationId,
        },
      );
    }

    const phone =
      normalizePhone(
        input.phoneNumber,
        this.configuration,
      );

    if (
      !phone ||
      phone.length < 10
    ) {
      throw new AirtelCollectionServiceError(
        'A valid collection phone number is required.',
        {
          code:
            ERROR_CODES.PHONE_INVALID,

          statusCode:
            400,

          tenantId,
          correlationId:
            input.correlationId,
          operationId:
            input.operationId,
        },
      );
    }

    const request = {
      tenantId,

      amount:
        normalizedAmount.amount,

      amountMinor:
        normalizedAmount.amountMinor,

      currency:
        normalizedAmount.currency,

      phoneNumber:
        phone,

      externalReference,

      reference:
        externalReference,

      payer:
        sanitize(
          input.payer || {},
        ),

      metadata:
        sanitize(
          input.metadata || {},
        ),

      idempotencyKey:
        idem,

      callbackUrl:
        bounded(
          input.callbackUrl,
          2048,
        ),

      actor:
        sanitize(
          input.actor || null,
        ),

      context:
        sanitize(
          input.context || {},
        ),

      correlationId:
        input.correlationId,

      operationId:
        input.operationId,

      provider:
        PROVIDER,

      operation:
        OPERATION,
    };

    request.financialFingerprint =
      sha256(
        JSON.stringify(
          stable(
            {
              tenantId,
              provider:
                PROVIDER,
              operation:
                OPERATION,
              externalReference,
              amountMinor:
                request.amountMinor,
              currency:
                request.currency,
              phoneNumber:
                request.phoneNumber,
              payer:
                request.payer,
            },
          ),
        ),
      );

    if (
      isFn(
        this.validator
          ?.validateCollection,
      )
    ) {
      await this.validator.validateCollection(
        request,
      );
    } else if (
      isFn(
        this.validator?.validate,
      )
    ) {
      await this.validator.validate(
        request,
      );
    }

    return request;
  }

  async runSecurityPipeline({
    request,
    tenantId,
    correlationId,
    operationId,
  }) {
    const result = {
      allowed:
        true,

      reviewRequired:
        false,

      policy:
        await this.evaluatePolicy(
          {
            request,
            tenantId,
            correlationId,
            operationId,
          },
        ),

      fraud:
        await this.evaluateFraud(
          {
            request,
            tenantId,
            correlationId,
            operationId,
          },
        ),

      aml:
        await this.evaluateAml(
          {
            request,
            tenantId,
            correlationId,
            operationId,
          },
        ),

      velocity:
        await this.evaluateVelocity(
          {
            request,
            tenantId,
            correlationId,
            operationId,
          },
        ),
    };

    for (
      const decision
      of [
        result.policy,
        result.fraud,
        result.aml,
        result.velocity,
      ]
    ) {
      if (
        decision?.blocked
      ) {
        throw new AirtelCollectionServiceError(
          decision.reason ||
            'Collection blocked by security controls.',
          {
            code:
              decision.code,

            statusCode:
              403,

            tenantId,
            correlationId,
            operationId,
          },
        );
      }

      if (
        decision?.reviewRequired
      ) {
        result.reviewRequired =
          true;
      }
    }

    return result;
  }

  async evaluatePolicy({
    request,
    tenantId,
    correlationId,
    operationId,
  }) {
    if (
      !this.policyEngine
    ) {
      return {
        allowed:
          true,

        blocked:
          false,

        reviewRequired:
          false,
      };
    }

    try {
      const r =
        await this.policyEngine.evaluate(
          {
            provider:
              PROVIDER,

            operation:
              OPERATION,

            tenantId,

            amount:
              request.amount,

            amountMinor:
              request.amountMinor,

            currency:
              request.currency,

            phoneNumber:
              request.phoneNumber,

            externalReference:
              request.externalReference,

            metadata:
              request.metadata,

            correlationId,
            operationId,
          },
        );

      const s =
        upper(
          r?.status ||
          r?.decision,
        );

      const blocked =
        [
          'BLOCKED',
          'DENIED',
          'REJECTED',
        ].includes(
          s,
        );

      const reviewRequired =
        [
          'REVIEW',
          'REVIEW_REQUIRED',
          'MANUAL_REVIEW',
        ].includes(
          s,
        );

      if (blocked) {
        this.stats.policyBlocks +=
          1;
      }

      return {
        allowed:
          !blocked,

        blocked,

        reviewRequired,

        code:
          blocked
            ? ERROR_CODES.POLICY_BLOCKED
            : null,

        reason:
          r?.reason ||
          r?.message,

        raw:
          sanitize(r),
      };
    } catch (e) {
      if (
        !this.configuration
          .failClosedOnPolicyError
      ) {
        return {
          allowed:
            true,

          blocked:
            false,

          reviewRequired:
            true,

          degraded:
            true,
        };
      }

      throw new AirtelCollectionServiceError(
        'Collection policy evaluation failed.',
        {
          code:
            ERROR_CODES.POLICY_BLOCKED,

          statusCode:
            503,

          retryable:
            true,

          tenantId,
          correlationId,
          operationId,

          cause:
            e,
        },
      );
    }
  }

  async evaluateFraud({
    request,
    tenantId,
    correlationId,
    operationId,
  }) {
    const engine =
      this.fraudGuard ||
      this.fraudService;

    if (!engine) {
      return {
        allowed:
          true,

        blocked:
          false,

        reviewRequired:
          false,
      };
    }

    try {
      const r =
        isFn(
          engine.inspect,
        )
          ? await engine.inspect(
              {
                provider:
                  PROVIDER,

                operation:
                  OPERATION,

                tenantId,

                amountMinor:
                  request.amountMinor,

                currency:
                  request.currency,

                phoneNumber:
                  request.phoneNumber,

                payer:
                  request.payer,

                metadata:
                  request.metadata,

                correlationId,
                operationId,
              },
            )
          : isFn(
              engine.assess,
            )
            ? await engine.assess(
                {
                  provider:
                    PROVIDER,

                  operation:
                    OPERATION,

                  tenantId,

                  amountMinor:
                    request.amountMinor,

                  currency:
                    request.currency,

                  beneficiary:
                    request.payer,

                  metadata:
                    request.metadata,

                  correlationId,
                  operationId,
                },
              )
            : await engine.score?.(
                {
                  provider:
                    PROVIDER,

                  operation:
                    OPERATION,

                  tenantId,

                  amountMinor:
                    request.amountMinor,

                  currency:
                    request.currency,

                  phoneNumber:
                    request.phoneNumber,

                  payer:
                    request.payer,

                  metadata:
                    request.metadata,

                  correlationId,
                  operationId,
                },
              );

      const s =
        upper(
          r?.status ||
          r?.decision ||
          r?.outcome,
        );

      const blocked =
        [
          'BLOCKED',
          'DENIED',
          'DENY',
          'HIGH_RISK',
        ].includes(
          s,
        );

      const reviewRequired =
        [
          'REVIEW',
          'REVIEW_REQUIRED',
          'MANUAL_REVIEW',
        ].includes(
          s,
        );

      if (blocked) {
        this.stats.fraudBlocks +=
          1;
      }

      return {
        allowed:
          !blocked,

        blocked,

        reviewRequired,

        code:
          blocked
            ? ERROR_CODES.FRAUD_BLOCKED
            : null,

        reason:
          r?.reason ||
          r?.message,

        raw:
          sanitize(r),
      };
    } catch (e) {
      if (
        !this.configuration
          .failClosedOnFraudError
      ) {
        return {
          allowed:
            true,

          blocked:
            false,

          reviewRequired:
            true,

          degraded:
            true,
        };
      }

      throw new AirtelCollectionServiceError(
        'Collection fraud evaluation failed.',
        {
          code:
            ERROR_CODES.FRAUD_BLOCKED,

          statusCode:
            503,

          retryable:
            true,

          tenantId,
          correlationId,
          operationId,

          cause:
            e,
        },
      );
    }
  }

  async evaluateAml({
    request,
    tenantId,
    correlationId,
    operationId,
  }) {
    if (
      !this.amlService
    ) {
      return {
        allowed:
          true,

        blocked:
          false,

        reviewRequired:
          false,
      };
    }

    try {
      const r =
        await (
          this.amlService.check?.(
            {
              provider:
                PROVIDER,

              operation:
                OPERATION,

              tenantId,

              amountMinor:
                request.amountMinor,

              currency:
                request.currency,

              phoneNumber:
                request.phoneNumber,

              payer:
                request.payer,

              metadata:
                request.metadata,

              correlationId,
              operationId,
            },
          ) ??
          this.amlService.evaluate?.(
            {
              provider:
                PROVIDER,

              operation:
                OPERATION,

              tenantId,

              amountMinor:
                request.amountMinor,

              currency:
                request.currency,

              phoneNumber:
                request.phoneNumber,

              payer:
                request.payer,

              metadata:
                request.metadata,

              correlationId,
              operationId,
            },
          )
        );

      const s =
        upper(
          r?.status ||
          r?.decision ||
          r?.outcome,
        );

      const blocked =
        [
          'BLOCKED',
          'DENIED',
          'REJECTED',
          'MATCH',
        ].includes(
          s,
        );

      const reviewRequired =
        [
          'REVIEW',
          'REVIEW_REQUIRED',
          'MANUAL_REVIEW',
        ].includes(
          s,
        );

      if (blocked) {
        this.stats.amlBlocks +=
          1;
      }

      return {
        allowed:
          !blocked,

        blocked,

        reviewRequired,

        code:
          blocked
            ? ERROR_CODES.AML_BLOCKED
            : null,

        reason:
          r?.reason ||
          r?.message,

        raw:
          sanitize(r),
      };
    } catch (e) {
      if (
        !this.configuration
          .failClosedOnAmlError
      ) {
        return {
          allowed:
            true,

          blocked:
            false,

          reviewRequired:
            true,

          degraded:
            true,
        };
      }

      throw new AirtelCollectionServiceError(
        'Collection AML evaluation failed.',
        {
          code:
            ERROR_CODES.AML_BLOCKED,

          statusCode:
            503,

          retryable:
            true,

          tenantId,
          correlationId,
          operationId,

          cause:
            e,
        },
      );
    }
  }

  async evaluateVelocity({
    request,
    tenantId,
    correlationId,
    operationId,
  }) {
    const r =
      await invoke(
        this.velocityService,
        [
          'check',
          'evaluate',
          'assess',
        ],
        {
          provider:
            PROVIDER,

          operation:
            OPERATION,

          tenantId,

          amountMinor:
            request.amountMinor,

          currency:
            request.currency,

          phoneNumber:
            request.phoneNumber,

          externalReference:
            request.externalReference,

          correlationId,
          operationId,
        },
      );

    if (!r.called) {
      return {
        allowed:
          true,

        blocked:
          false,

        reviewRequired:
          false,
      };
    }

    const s =
      upper(
        r.value?.status ||
        r.value?.decision ||
        r.value?.outcome,
      );

    return {
      allowed:
        ![
          'BLOCKED',
          'DENIED',
          'REJECTED',
        ].includes(
          s,
        ),

      blocked:
        [
          'BLOCKED',
          'DENIED',
          'REJECTED',
        ].includes(
          s,
        ),

      reviewRequired:
        [
          'REVIEW',
          'REVIEW_REQUIRED',
        ].includes(
          s,
        ),

      code:
        [
          'BLOCKED',
          'DENIED',
          'REJECTED',
        ].includes(
          s,
        )
          ? ERROR_CODES.POLICY_BLOCKED
          : null,

      reason:
        r.value?.reason ||
        r.value?.message,

      raw:
        sanitize(
          r.value,
        ),
    };
  }

  async requiresApproval({
    request,
    policyDecision,
    approvalContext,
  }) {
    if (
      !this.approvalService &&
      !this.configuration
        .approvalRequiredByDefault
    ) {
      return false;
    }

    if (
      policyDecision?.reviewRequired ||
      approvalContext?.required ===
        true
    ) {
      return true;
    }

    if (
      !this.approvalService
    ) {
      return Boolean(
        this.configuration
          .approvalRequiredByDefault,
      );
    }

    const r =
      await invoke(
        this.approvalService,
        [
          'requiresApproval',
          'evaluate',
          'check',
        ],
        {
          provider:
            PROVIDER,

          operation:
            OPERATION,

          tenantId:
            request.tenantId,

          amountMinor:
            request.amountMinor,

          currency:
            request.currency,

          request,

          approvalContext,
        },
      );

    return r.called
      ? Boolean(
          r.value?.required ??
          r.value?.reviewRequired ??
          r.value === true,
        )
      : Boolean(
          this.configuration
            .approvalRequiredByDefault,
        );
  }

  async prepareApproval({
    request,
    intent,
    actor,
    approvalContext,
    tenantId,
    correlationId,
    operationId,
  }) {
    if (
      !this.approvalService
    ) {
      throw new AirtelCollectionServiceError(
        'Collection approval service is required for an approval-gated collection.',
        {
          code:
            ERROR_CODES.APPROVAL_REQUIRED,

          statusCode:
            503,

          retryable:
            false,

          tenantId,
          correlationId,
          operationId,
        },
      );
    }

    const payload = {
      provider:
        PROVIDER,

      operation:
        OPERATION,

      tenantId,

      collectionId:
        collectionId(
          intent,
        ),

      request:
        sanitize(
          request,
        ),

      actor:
        sanitize(
          actor,
        ),

      approvalContext:
        sanitize(
          approvalContext,
        ),

      correlationId,
      operationId,
    };

    const r =
      await invoke(
        this.approvalService,
        [
          'create',
          'requestApproval',
          'submit',
        ],
        payload,
      );

    await this.transitionState(
      {
        intent,
        tenantId,
        correlationId,
        operationId,

        toState:
          COLLECTION_STATES
            .PENDING_APPROVAL,

        action:
          'SUBMIT_APPROVAL',

        reason:
          'Collection requires maker-checker approval.',

        patch: {
          approval:
            sanitize(
              r.value,
            ),
        },
      },
    );

    return sanitize(
      r.value,
    );
  }

  async reserveIdempotency({
    tenantId,
    idempotencyKey,
    fingerprint,
    correlationId,
    operationId,
  }) {
    if (
      !this.idempotencyManager
    ) {
      throw new AirtelCollectionServiceError(
        'Collection idempotency manager is unavailable.',
        {
          code:
            ERROR_CODES.IDEMPOTENCY_UNAVAILABLE,

          statusCode:
            503,

          retryable:
            true,

          tenantId,
          correlationId,
          operationId,
        },
      );
    }

    try {
      const r =
        await invoke(
          this.idempotencyManager,
          [
            'reserve',
            'claim',
            'check',
          ],
          {
            tenantId,

            provider:
              PROVIDER,

            operation:
              OPERATION,

            key:
              idempotencyKey,

            idempotencyKey,

            fingerprint,

            correlationId,
            operationId,

            leaseSeconds:
              this.configuration
                .idempotencyLeaseSeconds,

            ttlSeconds:
              this.configuration
                .idempotencyTtlSeconds,
          },
        );

      if (
        !r.called ||
        !r.value
      ) {
        throw new Error(
          'Idempotency contract unavailable.',
        );
      }

      const v =
        r.value;

      const conflict =
        Boolean(
          v.conflict ||
          v.fingerprintConflict ||
          v.outcome ===
            'CONFLICT',
        );

      const replay =
        Boolean(
          v.replay ||
          v.committed ||
          v.alreadyCommitted ||
          v.outcome ===
            'REPLAY',
        );

      const inFlight =
        Boolean(
          v.inFlight ||
          v.alreadyReserved ||
          v.outcome ===
            'IN_FLIGHT' ||
          v.outcome ===
            'ALREADY_RESERVED',
        );

      if (conflict) {
        return {
          conflict:
            true,

          replay:
            false,

          reservation:
            v,
        };
      }

      if (
        replay &&
        (
          v.response ||
          v.value ||
          v.cachedResponse
        )
      ) {
        return {
          conflict:
            false,

          replay:
            true,

          response:
            v.response ||
            v.value ||
            v.cachedResponse,

          reservation:
            v,
        };
      }

      if (inFlight) {
        return {
          conflict:
            false,

          replay:
            false,

          reservation:
            v,
        };
      }

      return {
        conflict:
          false,

        replay:
          false,

        reservation:
          v,
      };
    } catch (e) {
      if (
        !this.configuration
          .failClosedOnIdempotencyError
      ) {
        return {
          conflict:
            false,

          replay:
            false,

          reservation:
            null,
        };
      }

      if (
        e instanceof
        AirtelCollectionServiceError
      ) {
        throw e;
      }

      throw new AirtelCollectionServiceError(
        'Collection idempotency reservation failed.',
        {
          code:
            ERROR_CODES.IDEMPOTENCY_UNAVAILABLE,

          statusCode:
            503,

          retryable:
            true,

          tenantId,
          correlationId,
          operationId,

          cause:
            e,
        },
      );
    }
  }

  async commitIdempotency({
    tenantId,
    idempotencyKey,
    fingerprint,
    response,
  }) {
    if (
      !this.idempotencyManager ||
      !idempotencyKey
    ) {
      return;
    }

    const r =
      await invoke(
        this.idempotencyManager,
        [
          'commit',
          'store',
        ],
        {
          tenantId,

          provider:
            PROVIDER,

          operation:
            OPERATION,

          key:
            idempotencyKey,

          idempotencyKey,

          fingerprint,

          response:
            sanitize(
              response,
            ),
        },
      );

    if (
      !r.called &&
      this.configuration
        .failClosedOnIdempotencyError
    ) {
      throw new AirtelCollectionServiceError(
        'Collection idempotency commit contract is unavailable.',
        {
          code:
            ERROR_CODES.IDEMPOTENCY_UNAVAILABLE,

          statusCode:
            503,

          retryable:
            true,

          tenantId,
        },
      );
    }
  }

  async releaseIdempotencyOnFailure({
    tenantId,
    idempotencyKey,
    reservation,
    error,
  }) {
    if (
      !this.idempotencyManager ||
      !idempotencyKey ||
      error?.uncertain
    ) {
      return;
    }

    try {
      await invoke(
        this.idempotencyManager,
        [
          'release',
        ],
        {
          tenantId,

          provider:
            PROVIDER,

          operation:
            OPERATION,

          key:
            idempotencyKey,

          idempotencyKey,

          reservationId:
            reservation?.reservationId,

          reason:
            error?.code,
        },
      );
    } catch (e) {
      this.log(
        'warn',
        'Collection idempotency release failed.',
        {
          error:
            safeError(e),
        },
      );
    }
  }

  decorateReplay(
    response,
    {
      tenantId,
      correlationId,
      operationId,
    },
  ) {
    return {
      ...sanitize(
        response,
      ),

      provider:
        PROVIDER,

      operation:
        OPERATION,

      tenantId,

      correlationId,

      operationId,

      outcome:
        SERVICE_OUTCOME.REPLAY,

      replay:
        true,
    };
  }

  resolveCollectionRepository() {
    return (
      this.collectionRepository ||
      this.intentRepository ||
      this.providerClient
        ?.collectionRepository ||
      this.providerClient
        ?.repository ||
      null
    );
  }

  async findReferenceConflict({
    tenantId,
    request,
  }) {
    const repo =
      this.resolveCollectionRepository();

    if (!repo) {
      return null;
    }

    const r =
      await invoke(
        repo,
        [
          'findByExternalReference',
          'findByReference',
          'findCollectionByExternalReference',
        ],
        {
          tenantId,

          provider:
            PROVIDER,

          operation:
            OPERATION,

          externalReference:
            request.externalReference,

          reference:
            request.externalReference,
        },
      );

    if (
      !r.called ||
      !r.value
    ) {
      return null;
    }

    const record =
      r.value.record ||
      r.value.collection ||
      r.value;

    const fp =
      record.financialFingerprint ||
      record.fingerprint;

    return {
      existing:
        record,

      sameFinancialIdentity:
        Boolean(
          fp &&
          fp ===
            request.financialFingerprint,
        ),
    };
  }

  async createOrLoadIntent({
    request,
    tenantId,
    correlationId,
    operationId,
    policyDecision,
  }) {
    const repo =
      this.resolveCollectionRepository();

    const payload = {
      tenantId,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      state:
        COLLECTION_STATES.DRAFT,

      status:
        COLLECTION_STATES.DRAFT,

      amount:
        request.amount,

      amountMinor:
        request.amountMinor,

      currency:
        request.currency,

      phoneNumber:
        request.phoneNumber,

      payer:
        request.payer,

      externalReference:
        request.externalReference,

      reference:
        request.externalReference,

      idempotencyKey:
        request.idempotencyKey,

      originalIdempotencyKey:
        request.idempotencyKey,

      financialFingerprint:
        request.financialFingerprint,

      metadata:
        request.metadata,

      policy:
        sanitize(
          policyDecision,
        ),

      correlationId,

      operationId,

      version:
        0,

      createdAt:
        now(this.clock),

      updatedAt:
        now(this.clock),
    };

    if (
      !repo &&
      this.configuration
        .requireDurableIntent
    ) {
      throw new AirtelCollectionServiceError(
        'Durable collection intent repository is required.',
        {
          code:
            ERROR_CODES.INTENT_PERSISTENCE_FAILED,

          statusCode:
            503,

          retryable:
            true,

          tenantId,
          correlationId,
          operationId,
        },
      );
    }

    if (!repo) {
      return payload;
    }

    const r =
      await invoke(
        repo,
        [
          'createCollectionIfAbsent',
          'createIfAbsent',
          'createIntent',
          'create',
          'insert',
        ],
        payload,
      );

    if (!r.called) {
      throw new AirtelCollectionServiceError(
        'Collection repository contract does not support durable intent creation.',
        {
          code:
            ERROR_CODES.INTENT_PERSISTENCE_FAILED,

          statusCode:
            503,

          retryable:
            true,

          tenantId,
          correlationId,
          operationId,
        },
      );
    }

    return (
      r.value?.record ||
      r.value?.collection ||
      r.value ||
      payload
    );
  }

  async findExistingCollection({
    tenantId,
    externalReference,
    idempotencyKey,
    transactionId,
  }) {
    const repo =
      this.resolveCollectionRepository();

    if (!repo) {
      return null;
    }

    const plans = [
      [
        'findByIdempotencyKey',
        {
          tenantId,
          provider:
            PROVIDER,
          operation:
            OPERATION,
          idempotencyKey,
        },
      ],

      [
        'findByTransactionId',
        {
          tenantId,
          provider:
            PROVIDER,
          operation:
            OPERATION,
          transactionId,
        },
      ],

      [
        'findByExternalReference',
        {
          tenantId,
          provider:
            PROVIDER,
          operation:
            OPERATION,
          externalReference,
        },
      ],

      [
        'findByReference',
        {
          tenantId,
          provider:
            PROVIDER,
          operation:
            OPERATION,
          reference:
            externalReference,
        },
      ],
    ];

    for (
      const [
        method,
        args,
      ]
      of plans
    ) {
      if (
        !args.idempotencyKey &&
        !args.transactionId &&
        !args.externalReference &&
        !args.reference
      ) {
        continue;
      }

      if (
        !isFn(
          repo[method],
        )
      ) {
        continue;
      }

      const v =
        await repo[method](
          args,
        );

      if (v) {
        return (
          v.record ||
          v.collection ||
          v
        );
      }
    }

    return null;
  }

  async transitionState({
    intent,
    tenantId,
    correlationId,
    operationId,
    toState,
    action,
    reason,
    patch = {},
  }) {
    if (!intent) {
      return null;
    }

    const fromState =
      upper(
        intent.state ||
        intent.status ||
        COLLECTION_STATES.DRAFT,
      );

    if (
      fromState ===
      toState
    ) {
      return intent;
    }

    if (
      !this.transactionStateMachine ||
      !this.isCompatibleCollectionStateMachine()
    ) {
      throw new AirtelCollectionServiceError(
        'A collection-scoped transaction state machine is required; a disbursement-scoped state machine must not be reused for collections.',
        {
          code:
            ERROR_CODES.STATE_TRANSITION_FAILED,

          statusCode:
            503,

          retryable:
            true,

          tenantId,
          correlationId,
          operationId,

          details: {
            provider:
              PROVIDER,

            operation:
              OPERATION,
          },
        },
      );
    }

    const input = {
      collectionId:
        collectionId(intent),

      transactionId:
        intent.transactionId ||
        intent.collectionId ||
        null,

      tenantId,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      fromState,

      toState,

      action,

      reason,

      expectedVersion:
        intent.version ??
        intent.__v ??
        0,

      expectedFingerprint:
        intent.financialFingerprint ||
        intent.fingerprint,

      originalIdempotencyKey:
        intent.originalIdempotencyKey ||
        intent.idempotencyKey ||
        null,

      expectedIdempotencyKey:
        intent.originalIdempotencyKey ||
        intent.idempotencyKey ||
        null,

      actorId:
        intent.actorId ||
        intent.createdBy ||
        null,

      patch: {
        ...patch,

        status:
          toState,

        state:
          toState,

        updatedAt:
          now(this.clock),

        lastCorrelationId:
          correlationId,

        lastOperationId:
          operationId,
      },

      context: {
        correlationId,
        operationId,
      },
    };

    try {
      const r =
        await (
          isFn(
            this.transactionStateMachine
              .transitionCollection,
          )
            ? this.transactionStateMachine
                .transitionCollection(
                  input,
                )
            : isFn(
                this.transactionStateMachine
                  .transition,
              )
              ? this.transactionStateMachine
                  .transition(
                    input,
                  )
              : isFn(
                  this.transactionStateMachine
                    .move,
                )
                ? this.transactionStateMachine
                    .move(
                      input,
                    )
                : Promise.reject(
                    new Error(
                      'No compatible collection state transition method is available.',
                    ),
                  )
        );

      this.stats.stateTransitions +=
        1;

      const updated =
        r?.record ||
        r?.collection ||
        r?.transaction ||
        r;

      if (
        updated &&
        typeof updated ===
          'object'
      ) {
        Object.assign(
          intent,
          updated,
        );
      } else {
        Object.assign(
          intent,
          input.patch,
        );
      }

      return intent;
    } catch (e) {
      if (
        e instanceof
        AirtelCollectionServiceError
      ) {
        throw e;
      }

      throw new AirtelCollectionServiceError(
        'Collection state transition failed.',
        {
          code:
            e?.code ||
            ERROR_CODES.STATE_TRANSITION_FAILED,

          statusCode:
            e?.statusCode ||
            409,

          retryable:
            Boolean(
              e?.retryable,
            ),

          tenantId,
          correlationId,
          operationId,

          details: {
            fromState,
            toState,
            action,
            reason,
          },

          cause:
            e,
        },
      );
    }
  }

  async authenticate({
    tenantId,
    correlationId,
    operationId,
  }) {
    try {
      const token =
        isFn(
          this.authService
            ?.getAccessToken,
        )
          ? await this.authService
              .getAccessToken(
                {
                  tenantId,
                  correlationId,
                  operationId,
                },
              )
          : await this.authService
              ?.authenticate?.(
                {
                  tenantId,
                  correlationId,
                  operationId,
                },
              );

      if (!token) {
        throw new Error(
          'Airtel access token unavailable.',
        );
      }

      return token;
    } catch (e) {
      this.stats.authenticationFailures +=
        1;

      throw new AirtelCollectionServiceError(
        'Airtel authentication failed.',
        {
          code:
            ERROR_CODES.AUTHENTICATION_FAILED,

          statusCode:
            503,

          retryable:
            true,

          tenantId,
          correlationId,
          operationId,

          cause:
            e,
        },
      );
    }
  }

  async buildProviderRequest({
    request,
    accessToken,
    tenantId,
    correlationId,
    operationId,
  }) {
    const base = {
      provider:
        PROVIDER,

      operation:
        OPERATION,

      tenantId,

      amount:
        request.amount,

      amountMinor:
        request.amountMinor,

      currency:
        request.currency,

      phoneNumber:
        request.phoneNumber,

      payer:
        request.payer,

      externalReference:
        request.externalReference,

      idempotencyKey:
        request.idempotencyKey,

      callbackUrl:
        request.callbackUrl,

      metadata:
        request.metadata,

      correlationId,
      operationId,
    };

    if (
      isFn(
        this.transactionBuilder
          ?.buildCollection,
      )
    ) {
      return this.transactionBuilder
        .buildCollection(
          {
            ...base,
            accessToken,
          },
        );
    }

    if (
      isFn(
        this.transactionBuilder
          ?.build,
      )
    ) {
      return this.transactionBuilder
        .build(
          {
            ...base,
            accessToken,
          },
        );
    }

    return base;
  }

  async executeProviderOperation({
    request,
    providerRequest,
    accessToken,
    tenantId,
    correlationId,
    operationId,
  }) {
    const started =
      this.clock.now();

    this.stats.providerAttempts +=
      1;

    this.activeOperations.set(
      correlationId,
      {
        tenantId,
        operationId,
        externalReference:
          request.externalReference,
        state:
          COLLECTION_STATES.EXECUTING,
        startedAt:
          now(this.clock),
      },
    );

    try {
      const response =
        await this.withTimeout(
          {
            timeoutMs:
              this.configuration
                .requestTimeoutMs,

            operation:
              (signal) =>
                this.performProviderCall(
                  {
                    request,
                    providerRequest,
                    accessToken,
                    tenantId,
                    correlationId,
                    operationId,
                    signal,
                  },
                ),
          },
        );

      this.circuitBreaker
        ?.recordSuccess?.();

      return {
        response,

        attempts:
          1,

        durationMs:
          this.clock.now() -
          started,
      };
    } catch (e) {
      this.circuitBreaker
        ?.recordFailure?.();

      this.stats.providerFailures +=
        1;

      const error =
        this.normalizeProviderError(
          e,
          {
            tenantId,
            correlationId,
            operationId,
          },
        );

      if (
        this.canSafelyRetryProviderCall(
          error,
        )
      ) {
        return this.retryProviderCall(
          {
            request,
            providerRequest,
            accessToken,
            tenantId,
            correlationId,
            operationId,
            firstError:
              error,
          },
        );
      }

      if (
        error.uncertain
      ) {
        this.stats.unsafeRetriesPrevented +=
          1;
      }

      if (
        error.code ===
        ERROR_CODES.PROVIDER_TIMEOUT
      ) {
        this.stats.providerTimeouts +=
          1;
      }

      throw error;
    } finally {
      this.stats.totalProviderDurationMs +=
        this.clock.now() -
        started;
    }
  }

  async performProviderCall({
    request,
    providerRequest,
    accessToken,
    tenantId,
    correlationId,
    operationId,
    signal,
  }) {
    if (
      this.circuitBreaker
        ?.isOpen?.()
    ) {
      throw new AirtelCollectionServiceError(
        'Airtel collection circuit is open.',
        {
          code:
            ERROR_CODES.PROVIDER_UNAVAILABLE,

          statusCode:
            503,

          retryable:
            true,

          tenantId,
          correlationId,
          operationId,
        },
      );
    }

    if (
      isFn(
        this.providerClient?.collect,
      )
    ) {
      return this.providerClient.collect(
        {
          ...providerRequest,
          accessToken,
          tenantId,
          correlationId,
          operationId,
          signal,
        },
      );
    }

    if (
      isFn(
        this.providerClient?.request,
      )
    ) {
      return this.providerClient.request(
        {
          method:
            'POST',

          operation:
            OPERATION,

          tenantId,
          correlationId,
          operationId,
          accessToken,

          body:
            providerRequest,

          signal,
        },
      );
    }

    if (
      isFn(
        this.httpClient?.request,
      )
    ) {
      return this.httpClient.request(
        {
          method:
            'POST',

          operation:
            OPERATION,

          tenantId,
          correlationId,
          operationId,
          accessToken,

          body:
            providerRequest,

          signal,
        },
      );
    }

    throw new AirtelCollectionServiceError(
      'No Airtel collection provider adapter is configured.',
      {
        code:
          ERROR_CODES.PROVIDER_UNAVAILABLE,

        statusCode:
          503,

        retryable:
          true,

        tenantId,
        correlationId,
        operationId,
      },
    );
  }

  canSafelyRetryProviderCall(
    error,
  ) {
    return (
      this.configuration
        .enableProviderRetries &&
      this.configuration
        .maxProviderAttempts >
        1 &&
      Boolean(
        error?.retryable,
      ) &&
      !error?.uncertain
    );
  }

  async retryProviderCall({
    request,
    providerRequest,
    accessToken,
    tenantId,
    correlationId,
    operationId,
    firstError,
  }) {
    let last =
      firstError;

    const max =
      Math.max(
        1,
        Number(
          this.configuration
            .maxProviderAttempts,
        ),
      );

    for (
      let attempt = 2;
      attempt <= max;
      attempt += 1
    ) {
      this.stats.providerAttempts +=
        1;

      await this.sleep(
        Math.min(
          Number(
            this.configuration
              .retryMaxDelayMs,
          ),
          Number(
            this.configuration
              .retryBaseDelayMs,
          ) *
            2 **
              (
                attempt -
                2
              ),
        ),
      );

      try {
        const response =
          await this.performProviderCall(
            {
              request,
              providerRequest,
              accessToken,
              tenantId,
              correlationId,
              operationId,
            },
          );

        return {
          response,

          attempts:
            attempt,

          retried:
            true,

          durationMs:
            null,
        };
      } catch (e) {
        last =
          this.normalizeProviderError(
            e,
            {
              tenantId,
              correlationId,
              operationId,
            },
          );

        if (
          !this.canSafelyRetryProviderCall(
            last,
          )
        ) {
          break;
        }
      }
    }

    throw last;
  }

  normalizeProviderError(
    error,
    {
      tenantId,
      correlationId,
      operationId,
    },
  ) {
    const code =
      upper(
        error?.code,
      );

    const message =
      upper(
        error?.message,
      );

    const timeout =
      Boolean(
        error?.uncertain ||
        error?.financiallyAmbiguous ||
        code?.includes(
          'TIMEOUT',
        ) ||
        code?.includes(
          'ETIMEDOUT',
        ) ||
        message?.includes(
          'TIMEOUT',
        ) ||
        message?.includes(
          'ABORT',
        ),
      );

    const rejected =
      Boolean(
        error?.providerRejected ||
        code?.includes(
          'REJECT',
        ) ||
        code?.includes(
          'DECLIN',
        ) ||
        message?.includes(
          'REJECT',
        ) ||
        message?.includes(
          'DECLIN',
        ),
      );

    return new AirtelCollectionServiceError(
      rejected
        ? 'Airtel provider rejected the collection.'
        : 'Airtel collection provider execution failed.',
      {
        code:
          timeout
            ? ERROR_CODES.PROVIDER_TIMEOUT
            : rejected
              ? ERROR_CODES.PROVIDER_REJECTED
              : ERROR_CODES.PROVIDER_UNAVAILABLE,

        statusCode:
          timeout
            ? 504
            : Number(
                error?.statusCode ||
                error?.status,
              ) || 503,

        retryable:
          Boolean(
            error?.retryable,
          ) &&
          !timeout,

        uncertain:
          timeout,

        tenantId,
        correlationId,
        operationId,

        details: {
          providerCode:
            code,

          providerStatus:
            error?.statusCode ||
            error?.status,
        },

        cause:
          error,
      },
    );
  }

  async withTimeout({
    timeoutMs,
    operation,
  }) {
    const controller =
      new AbortController();

    let timer;

    const timeout =
      new Promise(
        (
          _,
          reject,
        ) => {
          timer =
            setTimeout(
              () => {
                controller.abort();

                reject(
                  new AirtelCollectionServiceError(
                    'Airtel collection provider request timed out.',
                    {
                      code:
                        ERROR_CODES.PROVIDER_TIMEOUT,

                      statusCode:
                        504,

                      uncertain:
                        true,
                    },
                  ),
                );
              },
              Number(
                timeoutMs,
              ),
            );
        },
      );

    try {
      return await Promise.race(
        [
          Promise.resolve().then(
            () =>
              operation(
                controller.signal,
              ),
          ),

          timeout,
        ],
      );
    } finally {
      clearTimeout(
        timer,
      );
    }
  }

  normalizeProviderResponse({
    providerResponse,
    request,
    tenantId,
    correlationId,
    operationId,
    execution,
  }) {
    const body =
      providerResponse?.data ||
      providerResponse?.body ||
      providerResponse ||
      {};

    const status =
      upper(
        body.status ||
        body.transactionStatus ||
        body.responseStatus ||
        body.resultCode ||
        body.code,
      );

    const providerReference =
      reference(
        body.providerReference ||
        body.transactionId ||
        body.reference ||
        body.airtelMoneyId ||
        body.id,
      );

    let outcome =
      PROVIDER_OUTCOME.UNKNOWN;

    if (
      body.success ===
        true ||
      [
        'SUCCESS',
        'SUCCEEDED',
        'COMPLETED',
        'COMPLETED_SUCCESSFULLY',
        '0',
      ].includes(
        status,
      )
    ) {
      outcome =
        PROVIDER_OUTCOME.SUCCESS;
    } else if (
      [
        'PENDING',
        'PROCESSING',
        'IN_PROGRESS',
        'ACCEPTED',
        'QUEUED',
      ].includes(
        status,
      )
    ) {
      outcome =
        [
          'ACCEPTED',
          'QUEUED',
        ].includes(
          status,
        )
          ? PROVIDER_OUTCOME.ACCEPTED
          : PROVIDER_OUTCOME.PENDING;
    } else if (
      body.success ===
        false ||
      [
        'FAILED',
        'FAILURE',
        'ERROR',
        'DECLINED',
        'REJECTED',
      ].includes(
        status,
      )
    ) {
      outcome =
        [
          'DECLINED',
          'REJECTED',
        ].includes(
          status,
        )
          ? PROVIDER_OUTCOME.REJECTED
          : PROVIDER_OUTCOME.FAILURE;
    } else if (
      execution?.timedOut
    ) {
      outcome =
        PROVIDER_OUTCOME.TIMEOUT;
    }

    return {
      provider:
        PROVIDER,

      operation:
        OPERATION,

      tenantId,

      correlationId,

      operationId,

      outcome,

      status,

      providerReference,

      transactionId:
        body.transactionId ||
        providerReference ||
        null,

      externalReference:
        request.externalReference,

      amount:
        request.amount,

      amountMinor:
        request.amountMinor,

      currency:
        request.currency,

      message:
        bounded(
          body.message ||
          body.description,
          500,
        ),

      providerCode:
        bounded(
          body.resultCode ||
          body.code,
          160,
        ),

      callbackExpected:
        [
          PROVIDER_OUTCOME.PENDING,
          PROVIDER_OUTCOME.ACCEPTED,
          PROVIDER_OUTCOME.UNKNOWN,
        ].includes(
          outcome,
        ),

      uncertain:
        [
          PROVIDER_OUTCOME.TIMEOUT,
          PROVIDER_OUTCOME.UNKNOWN,
        ].includes(
          outcome,
        ),

      execution: {
        attempts:
          execution?.attempts ||
          1,

        durationMs:
          execution
            ?.durationMs ??
          null,

        retried:
          Boolean(
            execution?.retried,
          ),
      },

      metadata:
        sanitize(
          body.metadata || {},
        ),
    };
  }

  async applyProviderOutcome({
    intent,
    request,
    normalized,
    tenantId,
    correlationId,
    operationId,
  }) {
    if (
      normalized.outcome ===
      PROVIDER_OUTCOME.SUCCESS
    ) {
      await this.transitionState(
        {
          intent,
          tenantId,
          correlationId,
          operationId,

          toState:
            COLLECTION_STATES.PROVIDER_ACCEPTED,

          action:
            'MARK_PROVIDER_ACCEPTED',

          reason:
            'Airtel provider reported a successful collection response.',

          patch: {
            providerReference:
              normalized.providerReference,

            providerOutcome:
              normalized.outcome,

            providerStatus:
              normalized.status,
          },
        },
      );

      return this.settleSuccessfulCollection(
        {
          intent,
          request,
          normalized,
          tenantId,
          correlationId,
          operationId,
        },
      );
    }

    if (
      [
        PROVIDER_OUTCOME.PENDING,
        PROVIDER_OUTCOME.ACCEPTED,
      ].includes(
        normalized.outcome,
      )
    ) {
      await this.transitionState(
        {
          intent,
          tenantId,
          correlationId,
          operationId,

          toState:
            COLLECTION_STATES.PROVIDER_PENDING,

          action:
            'MARK_PROVIDER_PENDING',

          reason:
            'Airtel accepted the collection without final settlement confirmation.',

          patch: {
            providerReference:
              normalized.providerReference,

            providerOutcome:
              normalized.outcome,

            providerStatus:
              normalized.status,
          },
        },
      );

      this.stats.collectionsPending +=
        1;

      await this.registerCallbackExpectation(
        {
          request,
          intent,
          normalized,
          tenantId,
          correlationId,
          operationId,
        },
      );

      return this.buildResponse(
        {
          outcome:
            SERVICE_OUTCOME.PROVIDER_PENDING,

          state:
            COLLECTION_STATES.PROVIDER_PENDING,

          request,
          intent,
          normalized,
          correlationId,
          operationId,

          nextAction:
            'WAIT_FOR_CALLBACK_OR_STATUS_CHECK',
        },
      );
    }

    if (
      [
        PROVIDER_OUTCOME.FAILURE,
        PROVIDER_OUTCOME.REJECTED,
      ].includes(
        normalized.outcome,
      )
    ) {
      await this.transitionState(
        {
          intent,
          tenantId,
          correlationId,
          operationId,

          toState:
            COLLECTION_STATES.FAILED,

          action:
            'MARK_FAILED',

          reason:
            normalized.message ||
            'Airtel provider reported collection failure.',

          patch: {
            providerReference:
              normalized.providerReference,

            providerOutcome:
              normalized.outcome,

            providerStatus:
              normalized.status,
          },
        },
      );

      return this.buildResponse(
        {
          outcome:
            SERVICE_OUTCOME.FAILED,

          state:
            COLLECTION_STATES.FAILED,

          request,
          intent,
          normalized,
          correlationId,
          operationId,

          nextAction:
            'REVIEW_OR_RETRY_IF_PROVEN_SAFE',
        },
      );
    }

    await this.transitionState(
      {
        intent,
        tenantId,
        correlationId,
        operationId,

        toState:
          COLLECTION_STATES.AMBIGUOUS,

        action:
          'MARK_AMBIGUOUS',

        reason:
          'Airtel provider outcome is not deterministic enough for financial finality.',

        patch: {
          providerReference:
            normalized.providerReference,

          providerOutcome:
            normalized.outcome,

          providerStatus:
            normalized.status,
        },
      },
    );

    this.stats.collectionsAmbiguous +=
      1;

    await this.enqueueReconciliation(
      {
        intent,
        request,
        normalized,
        tenantId,
        correlationId,
        operationId,
      },
    );

    return this.buildResponse(
      {
        outcome:
          SERVICE_OUTCOME.AMBIGUOUS,

        state:
          COLLECTION_STATES.AMBIGUOUS,

        request,
        intent,
        normalized,
        correlationId,
        operationId,

        nextAction:
          'STATUS_CHECK_OR_RECONCILE',
      },
    );
  }

  async settleSuccessfulCollection({
    intent,
    request,
    normalized,
    tenantId,
    correlationId,
    operationId,
  }) {
    if (
      !this.financialCore
    ) {
      if (
        !this.configuration
          .allowProviderSuccessWithoutFinancialCore
      ) {
        throw new AirtelCollectionServiceError(
          'Financial Core is required before successful collection finality.',
          {
            code:
              ERROR_CODES.FINANCIAL_CORE_REQUIRED,

            statusCode:
              503,

            retryable:
              true,

            tenantId,
            correlationId,
            operationId,
          },
        );
      }

      await this.transitionState(
        {
          intent,
          tenantId,
          correlationId,
          operationId,

          toState:
            COLLECTION_STATES
              .RECONCILIATION_REQUIRED,

          action:
            'RECONCILE',

          reason:
            'Provider success cannot be finalized without Financial Core.',
        },
      );

      return this.buildResponse(
        {
          outcome:
            SERVICE_OUTCOME
              .RECONCILIATION_REQUIRED,

          state:
            COLLECTION_STATES
              .RECONCILIATION_REQUIRED,

          request,
          intent,
          normalized,
          correlationId,
          operationId,

          nextAction:
            'FINANCIAL_CORE_REQUIRED',
        },
      );
    }

    try {
      const financial =
        await this.confirmFinancialSuccess(
          {
            intent,
            request,
            normalized,
            tenantId,
            correlationId,
            operationId,
          },
        );

      const fs =
        upper(
          financial?.status ||
          financial?.state ||
          financial?.outcome,
        );

      if (
        [
          'REVIEW',
          'PENDING',
          'FAILED',
          'REJECTED',
        ].includes(
          fs,
        ) ||
        financial?.reviewRequired
      ) {
        await this.transitionState(
          {
            intent,
            tenantId,
            correlationId,
            operationId,

            toState:
              COLLECTION_STATES
                .RECONCILIATION_REQUIRED,

            action:
              'RECONCILE',

            reason:
              'Financial Core did not confirm final settlement.',
          },
        );

        return this.buildResponse(
          {
            outcome:
              SERVICE_OUTCOME
                .RECONCILIATION_REQUIRED,

            state:
              COLLECTION_STATES
                .RECONCILIATION_REQUIRED,

            request,
            intent,
            normalized,
            correlationId,
            operationId,

            nextAction:
              'FINANCIAL_REVIEW',

            financialResult:
              financial,
          },
        );
      }

      await this.transitionState(
        {
          intent,
          tenantId,
          correlationId,
          operationId,

          toState:
            COLLECTION_STATES.SUCCESS,

          action:
            'MARK_SUCCESS',

          reason:
            'Provider success was confirmed through Financial Core.',

          patch: {
            providerReference:
              normalized.providerReference,

            providerOutcome:
              normalized.outcome,

            providerStatus:
              normalized.status,

            settledAt:
              now(
                this.clock,
              ),

            financialCoreReference:
              financial?.transactionId ||
              financial?.reference ||
              null,
          },
        },
      );

      this.stats.financialCoreSettlements +=
        1;

      await this.afterSuccessfulSettlement(
        {
          intent,
          request,
          normalized,
          financialResult:
            financial,
          tenantId,
          correlationId,
          operationId,
        },
      );

      return this.buildResponse(
        {
          outcome:
            SERVICE_OUTCOME.SUCCESS,

          state:
            COLLECTION_STATES.SUCCESS,

          request,
          intent,
          normalized,
          correlationId,
          operationId,

          nextAction:
            'NONE',

          financialResult:
            financial,
        },
      );
    } catch (e) {
      this.stats.financialCoreFailures +=
        1;

      await this.transitionState(
        {
          intent,
          tenantId,
          correlationId,
          operationId,

          toState:
            COLLECTION_STATES
              .RECONCILIATION_REQUIRED,

          action:
            'RECONCILE',

          reason:
            'Financial Core settlement requires reconciliation.',
        },
      ).catch(
        () =>
          undefined,
      );

      if (
        e instanceof
        AirtelCollectionServiceError
      ) {
        throw e;
      }

      throw new AirtelCollectionServiceError(
        'Financial Core could not finalize the Airtel collection.',
        {
          code:
            ERROR_CODES.FINANCIAL_CORE_FAILED,

          statusCode:
            503,

          retryable:
            true,

          tenantId,
          correlationId,
          operationId,

          cause:
            e,
        },
      );
    }
  }

  async confirmFinancialSuccess({
    intent,
    request,
    normalized,
    tenantId,
    correlationId,
    operationId,
  }) {
    const payload = {
      tenantId,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      collectionId:
        collectionId(intent),

      transactionId:
        normalized.transactionId ||
        intent.transactionId ||
        null,

      providerReference:
        normalized.providerReference,

      externalReference:
        request.externalReference,

      amount:
        request.amount,

      amountMinor:
        request.amountMinor,

      currency:
        request.currency,

      correlationId,
      operationId,

      metadata:
        request.metadata,

      providerEvidence: {
        outcome:
          normalized.outcome,

        status:
          normalized.status,

        providerCode:
          normalized.providerCode,
      },
    };

    const r =
      await invoke(
        this.financialCore,
        [
          'confirmCollection',
          'settleCollection',
          'finalizeCollection',
          'recordCollection',
        ],
        payload,
      );

    if (!r.called) {
      throw new AirtelCollectionServiceError(
        'Financial Core does not expose a collection settlement contract.',
        {
          code:
            ERROR_CODES.FINANCIAL_CORE_REQUIRED,

          statusCode:
            503,

          retryable:
            true,

          tenantId,
          correlationId,
          operationId,
        },
      );
    }

    return r.value;
  }

  async afterSuccessfulSettlement({
    intent,
    request,
    normalized,
    financialResult,
    tenantId,
    correlationId,
    operationId,
  }) {
    await this.audit(
      'AIRTEL_COLLECTION_SETTLED',
      {
        tenantId,

        correlationId,

        operationId,

        collectionId:
          collectionId(
            intent,
          ),

        providerReference:
          normalized.providerReference,

        externalReference:
          request.externalReference,

        amountMinor:
          request.amountMinor,

        currency:
          request.currency,

        financialReference:
          financialResult
            ?.transactionId ||
          financialResult
            ?.reference ||
          null,
      },
    );

    await this.publishEvent(
      'AIRTEL_COLLECTION_SETTLED',
      {
        tenantId,

        correlationId,

        operationId,

        collectionId:
          collectionId(
            intent,
          ),

        providerReference:
          normalized.providerReference,

        amountMinor:
          request.amountMinor,

        currency:
          request.currency,
      },
    );

    if (
      this.configuration
        .enableReconciliation
    ) {
      await this.enqueueReconciliation(
        {
          intent,
          request,
          normalized,
          tenantId,
          correlationId,
          operationId,
        },
      );
    }

    if (
      this.configuration
        .enableSettlementHooks &&
      this.settlementService
    ) {
      await this.callSettlementHook(
        {
          intent,
          request,
          normalized,
          financialResult,
          tenantId,
          correlationId,
          operationId,
        },
      );
    }
  }

  async processCallback({
    tenantId,
    callback,
    correlationId =
      crypto.randomUUID(),
    operationId =
      crypto.randomUUID(),
    context = {},
  } = {}) {
    if (
      !this.callbackCorrelation
    ) {
      throw new AirtelCollectionServiceError(
        'Callback correlation component is unavailable.',
        {
          code:
            ERROR_CODES.CALLBACK_CORRELATION_FAILED,

          statusCode:
            503,

          retryable:
            true,

          tenantId,
          correlationId,
          operationId,
        },
      );
    }

    const correlation =
      await this.callbackCorrelation.correlate(
        {
          tenantId,
          callback,
          correlationId,
          requestId:
            context.requestId,
          traceId:
            context.traceId,
          context,
        },
      );

    this.stats.callbackCorrelations +=
      1;

    if (
      correlation.status ===
      'REVIEW'
    ) {
      this.stats.callbackReviews +=
        1;
    }

    if (
      correlation.status ===
      'DUPLICATE'
    ) {
      this.stats.callbackDuplicates +=
        1;
    }

    if (
      [
        'DUPLICATE',
        'UNKNOWN',
        'REVIEW',
      ].includes(
        correlation.status,
      )
    ) {
      return {
        ...sanitize(
          correlation,
        ),

        outcome:
          correlation.status ===
          'DUPLICATE'
            ? SERVICE_OUTCOME.DUPLICATE
            : correlation.status ===
              'REVIEW'
              ? SERVICE_OUTCOME.REVIEW
              : SERVICE_OUTCOME
                  .RECONCILIATION_REQUIRED,

        nextAction:
          correlation.status ===
          'DUPLICATE'
            ? 'NONE'
            : correlation.status ===
              'REVIEW'
              ? 'MANUAL_REVIEW'
              : 'LOCATE_COLLECTION',
      };
    }

    const collection =
      correlation.collection;

    if (!collection) {
      throw new AirtelCollectionServiceError(
        'Callback did not resolve to a collection.',
        {
          code:
            ERROR_CODES.CALLBACK_NOT_CORRELATED,

          statusCode:
            409,

          tenantId,
          correlationId,
          operationId,
        },
      );
    }

    const normalized =
      this.normalizeCallbackOutcome(
        callback,
      );

    const request =
      this.collectionRecordToRequest(
        collection,
        tenantId,
        correlationId,
        operationId,
      );

    const state =
      upper(
        collection.state ||
        collection.status,
      );

    const patch = {
      providerReference:
        normalized.providerReference ||
        collection.providerReference ||
        null,

      callbackProcessedAt:
        now(
          this.clock,
        ),

      lastCallbackFingerprint:
        correlation.callbackFingerprint ||
        null,
    };

    if (
      normalized.outcome ===
      PROVIDER_OUTCOME.SUCCESS
    ) {
      if (
        state ===
        COLLECTION_STATES.SUCCESS
      ) {
        return {
          ...this.buildResponse(
            {
              outcome:
                SERVICE_OUTCOME.REPLAY,

              state,

              request,
              intent:
                collection,

              normalized,

              correlationId,
              operationId,

              nextAction:
                'NONE',
            },
          ),

          replay:
            true,

          callbackCorrelation:
            sanitize(
              correlation,
            ),
        };
      }

      if (
        [
          COLLECTION_STATES.FAILED,
          COLLECTION_STATES.CANCELLED,
          COLLECTION_STATES.REJECTED,
          COLLECTION_STATES.EXPIRED,
          COLLECTION_STATES.REVERSED,
          COLLECTION_STATES.COMPENSATED,
          COLLECTION_STATES.REFUNDED,
        ].includes(
          state,
        )
      ) {
        return {
          ...sanitize(
            correlation,
          ),

          outcome:
            SERVICE_OUTCOME.REVIEW,

          state,

          nextAction:
            'MANUAL_REVIEW_OR_RECONCILIATION',

          reason:
            'Successful callback conflicts with a finalized non-success lifecycle.',
        };
      }

      if (
        state ===
        COLLECTION_STATES.EXECUTING
      ) {
        await this.transitionState(
          {
            intent:
              collection,

            tenantId,
            correlationId,
            operationId,

            toState:
              COLLECTION_STATES.PROVIDER_ACCEPTED,

            action:
              'MARK_PROVIDER_ACCEPTED',

            reason:
              'Airtel success callback correlated to an executing collection.',

            patch,
          },
        );
      } else if (
        [
          COLLECTION_STATES.PROVIDER_PENDING,
          COLLECTION_STATES.PROVIDER_ACCEPTED,
        ].includes(
          state,
        )
      ) {
        Object.assign(
          collection,
          patch,
        );
      } else {
        await this.transitionState(
          {
            intent:
              collection,

            tenantId,
            correlationId,
            operationId,

            toState:
              COLLECTION_STATES
                .RECONCILIATION_REQUIRED,

            action:
              'RECONCILE',

            reason:
              'Callback success arrived in a state that cannot safely advance automatically.',

            patch,
          },
        );

        await this.enqueueReconciliation(
          {
            intent:
              collection,

            request,
            normalized,

            tenantId,
            correlationId,
            operationId,
          },
        );

        return {
          ...sanitize(
            correlation,
          ),

          outcome:
            SERVICE_OUTCOME
              .RECONCILIATION_REQUIRED,

          state:
            COLLECTION_STATES
              .RECONCILIATION_REQUIRED,

          nextAction:
            'RECONCILE_BEFORE_SETTLEMENT',
        };
      }

      return {
        ...(
          await this.settleSuccessfulCollection(
            {
              intent:
                collection,

              request,
              normalized,
              tenantId,
              correlationId,
              operationId,
            },
          )
        ),

        callbackCorrelation:
          sanitize(
            correlation,
          ),
      };
    }

    if (
      [
        PROVIDER_OUTCOME.PENDING,
        PROVIDER_OUTCOME.ACCEPTED,
      ].includes(
        normalized.outcome,
      )
    ) {
      if (
        [
          COLLECTION_STATES.SUCCESS,
          COLLECTION_STATES.COMPENSATED,
          COLLECTION_STATES.REFUNDED,
          COLLECTION_STATES.REVERSED,
        ].includes(
          state,
        )
      ) {
        return {
          ...sanitize(
            correlation,
          ),

          outcome:
            SERVICE_OUTCOME.REVIEW,

          state,

          nextAction:
            'MANUAL_REVIEW_OR_RECONCILIATION',

          reason:
            'Late pending callback conflicts with a finalized lifecycle.',
        };
      }

      if (
        state !==
        COLLECTION_STATES.PROVIDER_PENDING
      ) {
        await this.transitionState(
          {
            intent:
              collection,

            tenantId,
            correlationId,
            operationId,

            toState:
              COLLECTION_STATES.PROVIDER_PENDING,

            action:
              'MARK_PROVIDER_PENDING',

            reason:
              'Airtel callback confirms processing is still pending.',

            patch,
          },
        );
      } else {
        Object.assign(
          collection,
          patch,
        );
      }

      return {
        outcome:
          SERVICE_OUTCOME.PROVIDER_PENDING,

        state:
          COLLECTION_STATES.PROVIDER_PENDING,

        provider:
          PROVIDER,

        operation:
          OPERATION,

        tenantId,

        collectionId:
          collectionId(
            collection,
          ),

        correlationId,
        operationId,

        nextAction:
          'WAIT_FOR_CALLBACK_OR_STATUS_CHECK',

        callbackCorrelation:
          sanitize(
            correlation,
          ),
      };
    }

    if (
      [
        PROVIDER_OUTCOME.FAILURE,
        PROVIDER_OUTCOME.REJECTED,
      ].includes(
        normalized.outcome,
      )
    ) {
      if (
        state ===
        COLLECTION_STATES.SUCCESS
      ) {
        return {
          ...sanitize(
            correlation,
          ),

          outcome:
            SERVICE_OUTCOME.REVIEW,

          state,

          nextAction:
            'MANUAL_REVIEW_OR_RECONCILIATION',

          reason:
            'Failure callback conflicts with an already successful collection.',
        };
      }

      if (
        [
          COLLECTION_STATES.REVERSED,
          COLLECTION_STATES.COMPENSATED,
          COLLECTION_STATES.REFUNDED,
          COLLECTION_STATES.CANCELLED,
          COLLECTION_STATES.REJECTED,
          COLLECTION_STATES.EXPIRED,
        ].includes(
          state,
        )
      ) {
        return {
          ...sanitize(
            correlation,
          ),

          outcome:
            SERVICE_OUTCOME.REVIEW,

          state,

          nextAction:
            'MANUAL_REVIEW',
        };
      }

      if (
        state !==
        COLLECTION_STATES.FAILED
      ) {
        await this.transitionState(
          {
            intent:
              collection,

            tenantId,
            correlationId,
            operationId,

            toState:
              COLLECTION_STATES.FAILED,

            action:
              'MARK_FAILED',

            reason:
              normalized.message ||
              'Airtel callback reports collection failure.',

            patch,
          },
        );
      } else {
        Object.assign(
          collection,
          patch,
        );
      }

      return {
        outcome:
          SERVICE_OUTCOME.FAILED,

        state:
          COLLECTION_STATES.FAILED,

        provider:
          PROVIDER,

        operation:
          OPERATION,

        tenantId,

        collectionId:
          collectionId(
            collection,
          ),

        correlationId,
        operationId,

        nextAction:
          'REVIEW_OR_RETRY_IF_PROVEN_SAFE',

        callbackCorrelation:
          sanitize(
            correlation,
          ),
      };
    }

    if (
      ![
        ...TERMINAL_COLLECTION_STATES,
      ].includes(
        state,
      )
    ) {
      if (
        state !==
        COLLECTION_STATES.AMBIGUOUS
      ) {
        await this.transitionState(
          {
            intent:
              collection,

            tenantId,
            correlationId,
            operationId,

            toState:
              COLLECTION_STATES.AMBIGUOUS,

            action:
              'MARK_AMBIGUOUS',

            reason:
              'Airtel callback outcome is not deterministic.',

            patch,
          },
        );
      }

      await this.enqueueReconciliation(
        {
          intent:
            collection,

          request,
          normalized,

          tenantId,
          correlationId,
          operationId,
        },
      );
    }

    return {
      outcome:
        SERVICE_OUTCOME.AMBIGUOUS,

      state:
        state ===
        COLLECTION_STATES.AMBIGUOUS
          ? state
          : COLLECTION_STATES.AMBIGUOUS,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      tenantId,

      collectionId:
        collectionId(
          collection,
        ),

      correlationId,
      operationId,

      nextAction:
        'STATUS_CHECK_OR_RECONCILE',

      callbackCorrelation:
        sanitize(
          correlation,
        ),
    };
  }

  async handleCallback(
    args = {},
  ) {
    return this.processCallback(
      args,
    );
  }

  async processProviderCallback(
    args = {},
  ) {
    return this.processCallback(
      args,
    );
  }

  normalizeCallbackOutcome(
    callback = {},
  ) {
    const status =
      upper(
        callback.status ||
        callback.transactionStatus ||
        callback.resultCode ||
        callback.code,
      );

    const providerReference =
      reference(
        callback.providerReference ||
        callback.transactionId ||
        callback.reference ||
        callback.airtelMoneyId,
      );

    let outcome =
      PROVIDER_OUTCOME.UNKNOWN;

    if (
      callback.success ===
        true ||
      [
        'SUCCESS',
        'SUCCEEDED',
        'COMPLETED',
        '0',
      ].includes(
        status,
      )
    ) {
      outcome =
        PROVIDER_OUTCOME.SUCCESS;
    } else if (
      [
        'PENDING',
        'PROCESSING',
        'QUEUED',
        'ACCEPTED',
      ].includes(
        status,
      )
    ) {
      outcome =
        [
          'QUEUED',
          'ACCEPTED',
        ].includes(
          status,
        )
          ? PROVIDER_OUTCOME.ACCEPTED
          : PROVIDER_OUTCOME.PENDING;
    } else if (
      callback.success ===
        false ||
      [
        'FAILED',
        'FAILURE',
        'REJECTED',
        'DECLINED',
        'ERROR',
      ].includes(
        status,
      )
    ) {
      outcome =
        [
          'REJECTED',
          'DECLINED',
        ].includes(
          status,
        )
          ? PROVIDER_OUTCOME.REJECTED
          : PROVIDER_OUTCOME.FAILURE;
    }

    const currency =
      upper(
        callback.currency,
      ) ||
      this.configuration
        .defaultCurrency;

    return {
      provider:
        PROVIDER,

      operation:
        OPERATION,

      outcome,

      status,

      providerReference,

      transactionId:
        callback.transactionId ||
        providerReference ||
        null,

      amount:
        callback.amount,

      amountMinor:
        parseMinor(
          callback.amountMinor ??
          callback.amount,
          currency,
          this.configuration,
        ),

      currency,

      message:
        bounded(
          callback.message ||
          callback.description,
          500,
        ),

      providerCode:
        bounded(
          callback.resultCode ||
          callback.code,
          160,
        ),
    };
  }

  collectionRecordToRequest(
    collection,
    tenantId,
    correlationId,
    operationId,
  ) {
    const currency =
      upper(
        collection.currency,
      ) ||
      this.configuration
        .defaultCurrency;

    const amount =
      collection.amount ??
      collection.amountMinor;

    return {
      tenantId,

      amount:
        String(
          amount,
        ),

      amountMinor:
        collection.amountMinor ??
        parseMinor(
          amount,
          currency,
          this.configuration,
        ),

      currency,

      phoneNumber:
        collection.phoneNumber ||
        collection.msisdn ||
        collection.customerPhone,

      externalReference:
        reference(
          collection.externalReference ||
          collection.reference,
        ),

      payer:
        sanitize(
          collection.payer ||
          {},
        ),

      metadata:
        sanitize(
          collection.metadata ||
          {},
        ),

      idempotencyKey:
        collection.idempotencyKey ||
        collection.originalIdempotencyKey,

      financialFingerprint:
        collection.financialFingerprint ||
        collection.fingerprint,

      correlationId,
      operationId,

      provider:
        PROVIDER,

      operation:
        OPERATION,
    };
  }

  async approveCollection({
    tenantId,
    reference:
      referenceValue,
    transactionId,
    actor,
    correlationId =
      crypto.randomUUID(),
    operationId =
      crypto.randomUUID(),
    context = {},
  } = {}) {
    const collection =
      await this.findExistingCollection(
        {
          tenantId,

          externalReference:
            reference(
              referenceValue,
            ),

          transactionId,
        },
      );

    if (!collection) {
      throw new AirtelCollectionServiceError(
        'Collection could not be located for approval.',
        {
          code:
            ERROR_CODES.CALLBACK_NOT_CORRELATED,

          statusCode:
            404,

          tenantId,
          correlationId,
          operationId,
        },
      );
    }

    const state =
      upper(
        collection.state ||
        collection.status,
      );

    if (
      state ===
      COLLECTION_STATES.SUCCESS
    ) {
      return this.buildResponse(
        {
          outcome:
            SERVICE_OUTCOME.REPLAY,

          state,

          request:
            this.collectionRecordToRequest(
              collection,
              tenantId,
              correlationId,
              operationId,
            ),

          intent:
            collection,

          correlationId,
          operationId,

          nextAction:
            'NONE',
        },
      );
    }

    if (
      state !==
      COLLECTION_STATES.PENDING_APPROVAL
    ) {
      return {
        provider:
          PROVIDER,

        operation:
          OPERATION,

        tenantId,

        collectionId:
          collectionId(
            collection,
          ),

        state,

        outcome:
          SERVICE_OUTCOME.REVIEW,

        nextAction:
          'MANUAL_REVIEW',

        reason:
          'Collection is not awaiting approval.',
      };
    }

    await this.transitionState(
      {
        intent:
          collection,

        tenantId,
        correlationId,
        operationId,

        toState:
          COLLECTION_STATES.APPROVED,

        action:
          'APPROVE',

        reason:
          'Maker-checker approval granted.',

        patch: {
          approvedAt:
            now(
              this.clock,
            ),

          approvedBy:
            sanitize(
              actor,
            ),

          approvalContext:
            sanitize(
              context,
            ),
        },
      },
    );

    return this.executeExistingCollection(
      {
        intent:
          collection,

        request:
          this.collectionRecordToRequest(
            collection,
            tenantId,
            correlationId,
            operationId,
          ),

        tenantId,
        correlationId,
        operationId,

        context: {
          ...context,

          approvedBy:
            actor,
        },
      },
    );
  }

  async executeApprovedCollection(
    args = {},
  ) {
    return this.approveCollection(
      args,
    );
  }

  async resumeAfterApproval(
    args = {},
  ) {
    return this.approveCollection(
      args,
    );
  }

  async query({
    tenantId,
    reference:
      referenceValue,
    transactionId,
    accessToken,
    correlationId =
      crypto.randomUUID(),
    operationId =
      crypto.randomUUID(),
  } = {}) {
    const ref =
      reference(
        referenceValue ||
        transactionId,
      );

    if (!ref) {
      throw new AirtelCollectionServiceError(
        'Collection reference is required.',
        {
          code:
            ERROR_CODES.REFERENCE_REQUIRED,

          statusCode:
            400,

          tenantId,
          correlationId,
          operationId,
        },
      );
    }

    const collection =
      await this.findExistingCollection(
        {
          tenantId,

          externalReference:
            ref,

          transactionId,
        },
      );

    if (!collection) {
      throw new AirtelCollectionServiceError(
        'Collection could not be located.',
        {
          code:
            ERROR_CODES.CALLBACK_NOT_CORRELATED,

          statusCode:
            404,

          tenantId,
          correlationId,
          operationId,
        },
      );
    }

    const token =
      accessToken ||
      await this.authenticate(
        {
          tenantId,
          correlationId,
          operationId,
        },
      );

    const provider =
      await this.getProviderStatus(
        {
          tenantId,

          transactionId:
            collection.transactionId ||
            transactionId ||
            ref,

          reference:
            ref,

          accessToken:
            token,

          correlationId,
          operationId,
        },
      );

    const request =
      this.collectionRecordToRequest(
        collection,
        tenantId,
        correlationId,
        operationId,
      );

    const normalized =
      this.normalizeProviderResponse(
        {
          providerResponse:
            provider,

          request,

          tenantId,
          correlationId,
          operationId,

          execution: {
            attempts:
              1,
          },
        },
      );

    return {
      ...this.buildResponse(
        {
          outcome:
            normalized.outcome ===
            PROVIDER_OUTCOME.SUCCESS
              ? SERVICE_OUTCOME.SUCCESS
              : normalized.outcome ===
                PROVIDER_OUTCOME.FAILURE
                ? SERVICE_OUTCOME.FAILED
                : normalized.outcome ===
                  PROVIDER_OUTCOME.PENDING ||
                  normalized.outcome ===
                    PROVIDER_OUTCOME.ACCEPTED
                  ? SERVICE_OUTCOME.PROVIDER_PENDING
                  : SERVICE_OUTCOME
                      .RECONCILIATION_REQUIRED,

          state:
            upper(
              collection.state ||
              collection.status,
            ),

          request,

          intent:
            collection,

          normalized,

          correlationId,
          operationId,

          nextAction:
            normalized.outcome ===
            PROVIDER_OUTCOME.SUCCESS
              ? 'NONE'
              : 'STATUS_CHECK_OR_RECONCILE',
        },
      ),

      statusCheck:
        true,
    };
  }

  async getStatus(
    args = {},
  ) {
    return this.query(
      args,
    );
  }

  async status(
    args = {},
  ) {
    return this.query(
      args,
    );
  }

  async getProviderStatus({
    tenantId,
    transactionId,
    reference:
      ref,
    accessToken,
    correlationId,
    operationId,
  }) {
    if (
      isFn(
        this.providerClient
          ?.getCollectionStatus,
      )
    ) {
      return this.providerClient
        .getCollectionStatus(
          {
            tenantId,
            transactionId,
            reference:
              ref,

            accessToken,
            correlationId,
            operationId,
          },
        );
    }

    if (
      isFn(
        this.providerClient?.status,
      )
    ) {
      return this.providerClient
        .status(
          {
            tenantId,
            transactionId,
            reference:
              ref,

            accessToken,
            correlationId,
            operationId,
          },
        );
    }

    if (
      isFn(
        this.providerClient?.request,
      )
    ) {
      return this.providerClient.request(
        {
          method:
            'GET',

          operation:
            'COLLECTION_STATUS',

          tenantId,
          correlationId,
          operationId,
          accessToken,

          params: {
            transactionId:
              transactionId ||
              ref,
          },
        },
      );
    }

    if (
      isFn(
        this.httpClient?.request,
      )
    ) {
      return this.httpClient.request(
        {
          method:
            'GET',

          operation:
            'COLLECTION_STATUS',

          tenantId,
          correlationId,
          operationId,
          accessToken,

          params: {
            transactionId:
              transactionId ||
              ref,
          },
        },
      );
    }

    throw new AirtelCollectionServiceError(
      'Airtel collection status operation is unavailable.',
      {
        code:
          ERROR_CODES.PROVIDER_UNAVAILABLE,

        statusCode:
          503,

        retryable:
          true,

        tenantId,
        correlationId,
        operationId,
      },
    );
  }

  async reconcile({
    tenantId,
    reference:
      referenceValue,
    transactionId,
    correlationId =
      crypto.randomUUID(),
    operationId =
      crypto.randomUUID(),
    context = {},
  } = {}) {
    const collection =
      await this.findExistingCollection(
        {
          tenantId,

          externalReference:
            reference(
              referenceValue ||
              transactionId,
            ),

          transactionId,
        },
      );

    if (!collection) {
      throw new AirtelCollectionServiceError(
        'Collection could not be located for reconciliation.',
        {
          code:
            ERROR_CODES.CALLBACK_NOT_CORRELATED,

          statusCode:
            404,

          tenantId,
          correlationId,
          operationId,
        },
      );
    }

    this.stats.reconciliationRequests +=
      1;

    const payload = {
      provider:
        PROVIDER,

      operation:
        OPERATION,

      tenantId,

      collectionId:
        collectionId(
          collection,
        ),

      transactionId:
        collection.transactionId ||
        transactionId ||
        referenceValue,

      externalReference:
        collection.externalReference,

      amount:
        collection.amount,

      amountMinor:
        collection.amountMinor,

      currency:
        collection.currency,

      correlationId,
      operationId,

      context:
        sanitize(
          context,
        ),
    };

    if (
      isFn(
        this.reconciliationService
          ?.reconcile,
      )
    ) {
      return this.reconciliationService
        .reconcile(
          payload,
        );
    }

    if (
      isFn(
        this.reconciliationService
          ?.enqueue,
      )
    ) {
      return this.reconciliationService
        .enqueue(
          payload,
        );
    }

    return this.query(
      {
        tenantId,

        reference:
          referenceValue ||
          transactionId,

        correlationId,
        operationId,
      },
    );
  }

  async retry({
    tenantId,
    reference:
      referenceValue,
    transactionId,
    correlationId =
      crypto.randomUUID(),
    operationId =
      crypto.randomUUID(),
    actor,
    context = {},
  } = {}) {
    const collection =
      await this.findExistingCollection(
        {
          tenantId,

          externalReference:
            reference(
              referenceValue ||
              transactionId,
            ),

          transactionId,
        },
      );

    if (!collection) {
      throw new AirtelCollectionServiceError(
        'Collection could not be located for retry.',
        {
          code:
            ERROR_CODES.CALLBACK_NOT_CORRELATED,

          statusCode:
            404,

          tenantId,
          correlationId,
          operationId,
        },
      );
    }

    const state =
      upper(
        collection.state ||
        collection.status,
      );

    if (
      terminal(state)
    ) {
      return {
        provider:
          PROVIDER,

        operation:
          OPERATION,

        tenantId,

        collectionId:
          collectionId(
            collection,
          ),

        state,

        outcome:
          SERVICE_OUTCOME.REVIEW,

        nextAction:
          'NONE',

        reason:
          'Terminal collection state cannot be retried.',
      };
    }

    if (
      uncertain(state)
    ) {
      this.stats.unsafeRetriesPrevented +=
        1;

      return {
        provider:
          PROVIDER,

        operation:
          OPERATION,

        tenantId,

        collectionId:
          collectionId(
            collection,
          ),

        state,

        outcome:
          SERVICE_OUTCOME
            .RECONCILIATION_REQUIRED,

        nextAction:
          'STATUS_CHECK_OR_RECONCILE',

        reason:
          'Ambiguous or pending financial outcome must be resolved before retry.',
      };
    }

    if (
      ![
        'FAILED',
        'VALIDATION_FAILED',
      ].includes(
        state,
      )
    ) {
      return {
        provider:
          PROVIDER,

        operation:
          OPERATION,

        tenantId,

        collectionId:
          collectionId(
            collection,
          ),

        state,

        outcome:
          SERVICE_OUTCOME.REVIEW,

        nextAction:
          'MANUAL_REVIEW',

        reason:
          'Current collection state is not explicitly retryable.',
      };
    }

    const request =
      this.collectionRecordToRequest(
        collection,
        tenantId,
        correlationId,
        operationId,
      );

    await this.transitionState(
      {
        intent:
          collection,

        tenantId,
        correlationId,
        operationId,

        toState:
          COLLECTION_STATES.APPROVED,

        action:
          'RETRY',

        reason:
          'Retrying a confirmed failed collection while preserving original financial identity.',

        patch: {
          retryAt:
            now(
              this.clock,
            ),

          retryActor:
            sanitize(
              actor,
            ),

          retryOf:
            collectionId(
              collection,
            ),
        },
      },
    );

    return this.executeExistingCollection(
      {
        intent:
          collection,

        request,

        tenantId,
        correlationId,
        operationId,

        context: {
          ...context,

          retryOf:
            collectionId(
              collection,
            ),

          preserveFinancialIdentity:
            true,
        },
      },
    );
  }

  async executeExistingCollection({
    intent,
    request,
    tenantId,
    correlationId,
    operationId,
    context = {},
  }) {
    let lock =
      null;

    try {
      lock =
        await this.acquireOperationLock(
          opKey(
            tenantId,
            request.externalReference,
          ),
          {
            tenantId,
            correlationId,
            operationId,
          },
        );

      const token =
        await this.authenticate(
          {
            tenantId,
            correlationId,
            operationId,
          },
        );

      if (
        upper(
          intent.state ||
          intent.status,
        ) !==
        COLLECTION_STATES.QUEUED
      ) {
        await this.transitionState(
          {
            intent,
            tenantId,
            correlationId,
            operationId,

            toState:
              COLLECTION_STATES.QUEUED,

            action:
              'QUEUE',

            reason:
              'Existing collection re-queued without changing financial identity.',

            patch: {
              executionContext:
                sanitize(
                  context,
                ),
            },
          },
        );
      }

      await this.transitionState(
        {
          intent,
          tenantId,
          correlationId,
          operationId,

          toState:
            COLLECTION_STATES.EXECUTING,

          action:
            'EXECUTE',

          reason:
            'Existing collection execution started.',
        },
      );

      const providerRequest =
        await this.buildProviderRequest(
          {
            request,
            accessToken:
              token,
            tenantId,
            correlationId,
            operationId,
          },
        );

      const execution =
        await this.executeProviderOperation(
          {
            request,
            providerRequest,
            accessToken:
              token,
            tenantId,
            correlationId,
            operationId,
          },
        );

      const normalized =
        this.normalizeProviderResponse(
          {
            providerResponse:
              execution.response,

            request,

            tenantId,
            correlationId,
            operationId,

            execution,
          },
        );

      return {
        ...(
          await this.applyProviderOutcome(
            {
              intent,
              request,
              normalized,
              tenantId,
              correlationId,
              operationId,
            },
          )
        ),

        retry:
          true,
      };
    } finally {
      await this.releaseOperationLock(
        lock,
      );
    }
  }

  async cancel({
    tenantId,
    reference:
      referenceValue,
    transactionId,
    correlationId =
      crypto.randomUUID(),
    operationId =
      crypto.randomUUID(),
    actor,
  } = {}) {
    const collection =
      await this.findExistingCollection(
        {
          tenantId,

          externalReference:
            reference(
              referenceValue ||
              transactionId,
            ),

          transactionId,
        },
      );

    if (!collection) {
      throw new AirtelCollectionServiceError(
        'Collection could not be located for cancellation.',
        {
          code:
            ERROR_CODES.CALLBACK_NOT_CORRELATED,

          statusCode:
            404,

          tenantId,
          correlationId,
          operationId,
        },
      );
    }

    const state =
      upper(
        collection.state ||
        collection.status,
      );

    if (
      [
        COLLECTION_STATES.SUCCESS,
        COLLECTION_STATES.REVERSED,
        COLLECTION_STATES.REFUNDED,
        COLLECTION_STATES.COMPENSATED,
      ].includes(
        state,
      )
    ) {
      return {
        provider:
          PROVIDER,

        operation:
          OPERATION,

        tenantId,

        collectionId:
          collectionId(
            collection,
          ),

        state,

        outcome:
          SERVICE_OUTCOME.REVIEW,

        nextAction:
          'COMPENSATION_OR_REVERSAL',

        reason:
          'Finalized collection cannot be cancelled as if it never executed.',
      };
    }

    if (
      uncertain(state)
    ) {
      return {
        provider:
          PROVIDER,

        operation:
          OPERATION,

        tenantId,

        collectionId:
          collectionId(
            collection,
          ),

        state,

        outcome:
          SERVICE_OUTCOME
            .RECONCILIATION_REQUIRED,

        nextAction:
          'RECONCILE_BEFORE_CANCEL',

        reason:
          'Uncertain collection outcome must be reconciled before cancellation.',
      };
    }

    if (
      isFn(
        this.providerClient
          ?.cancelCollection,
      )
    ) {
      const token =
        await this.authenticate(
          {
            tenantId,
            correlationId,
            operationId,
          },
        );

      await this.providerClient
        .cancelCollection(
          {
            tenantId,

            transactionId:
              collection.transactionId ||
              referenceValue ||
              transactionId,

            accessToken:
              token,

            correlationId,
            operationId,
          },
        );
    }

    await this.transitionState(
      {
        intent:
          collection,

        tenantId,
        correlationId,
        operationId,

        toState:
          COLLECTION_STATES.CANCELLED,

        action:
          'CANCEL',

        reason:
          'Collection cancelled before provider settlement.',

        patch: {
          cancelledAt:
            now(
              this.clock,
            ),

          cancelledBy:
            sanitize(
              actor,
            ),
        },
      },
    );

    return {
      provider:
        PROVIDER,

      operation:
        OPERATION,

      tenantId,

      collectionId:
        collectionId(
          collection,
        ),

      state:
        COLLECTION_STATES.CANCELLED,

      outcome:
        SERVICE_OUTCOME.CANCELLED,

      correlationId,
      operationId,

      nextAction:
        'NONE',
    };
  }

  async cancelPayment(
    args = {},
  ) {
    return this.cancel(
      args,
    );
  }

  async recoverOperation({
    tenantId,
    reference:
      referenceValue,
    transactionId,
    correlationId =
      crypto.randomUUID(),
    operationId =
      crypto.randomUUID(),
  } = {}) {
    return (
      this.recoveryService
        ?.recover?.(
          {
            provider:
              PROVIDER,

            operation:
              OPERATION,

            tenantId,

            reference:
              referenceValue ||
              transactionId,

            transactionId,

            correlationId,
            operationId,
          },
        ) ||
      null
    );
  }

  async registerCallbackExpectation({
    request,
    intent,
    normalized,
    tenantId,
    correlationId,
    operationId,
  }) {
    if (
      !this.configuration
        .enableCallbackRegistration ||
      !this.callbackRegistry
    ) {
      return null;
    }

    return invoke(
      this.callbackRegistry,
      [
        'register',
        'expect',
      ],
      {
        provider:
          PROVIDER,

        operation:
          OPERATION,

        tenantId,

        collectionId:
          collectionId(
            intent,
          ),

        transactionId:
          normalized.transactionId ||
          intent.transactionId,

        providerReference:
          normalized.providerReference,

        externalReference:
          request.externalReference,

        correlationId,
        operationId,

        expectedEvents: [
          'COLLECTION_COMPLETED',
          'COLLECTION_FAILED',
          'COLLECTION_STATUS_CHANGED',
        ],
      },
    );
  }

  async enqueueReconciliation({
    intent,
    request,
    normalized,
    tenantId,
    correlationId,
    operationId,
  }) {
    if (
      !this.configuration
        .enableReconciliation ||
      !this.reconciliationService
    ) {
      return null;
    }

    this.stats.reconciliationRequests +=
      1;

    return invoke(
      this.reconciliationService,
      [
        'enqueue',
        'reconcile',
      ],
      {
        provider:
          PROVIDER,

        operation:
          OPERATION,

        tenantId,

        collectionId:
          collectionId(
            intent,
          ),

        transactionId:
          normalized
            ?.transactionId ||
          intent?.transactionId ||
          null,

        providerReference:
          normalized
            ?.providerReference ||
          intent?.providerReference ||
          null,

        externalReference:
          request
            ?.externalReference ||
          intent?.externalReference ||
          null,

        amount:
          request?.amount ||
          intent?.amount,

        amountMinor:
          request?.amountMinor ??
          intent?.amountMinor,

        currency:
          request?.currency ||
          intent?.currency,

        correlationId,
        operationId,

        reason:
          normalized?.uncertain
            ? 'PROVIDER_OUTCOME_UNCERTAIN'
            : 'COLLECTION_RECONCILIATION_REQUESTED',
      },
    );
  }

  async callSettlementHook({
    intent,
    request,
    normalized,
    financialResult,
    tenantId,
    correlationId,
    operationId,
  }) {
    const payload = {
      provider:
        PROVIDER,

      operation:
        OPERATION,

      tenantId,

      collectionId:
        collectionId(
          intent,
        ),

      transactionId:
        normalized.transactionId ||
        intent.transactionId ||
        null,

      providerReference:
        normalized.providerReference,

      externalReference:
        request.externalReference,

      amount:
        request.amount,

      amountMinor:
        request.amountMinor,

      currency:
        request.currency,

      financialResult:
        sanitize(
          financialResult,
        ),

      correlationId,
      operationId,
    };

    const r =
      await invoke(
        this.settlementService,
        [
          'onCollectionSettled',
          'afterSettlement',
          'notifyCollectionSettled',
        ],
        payload,
      );

    return r.value;
  }

  async acquireOperationLock(
    key,
    context = {},
  ) {
    if (
      !this.distributedLock
    ) {
      return null;
    }

    try {
      const r =
        await invoke(
          this.distributedLock,
          [
            'acquire',
            'lock',
            'claim',
          ],
          {
            key,

            ttlMs:
              Math.max(
                1000,
                Number(
                  this.configuration
                    .requestTimeoutMs,
                ) +
                  5000,
              ),

            tenantId:
              context.tenantId,

            provider:
              PROVIDER,

            operation:
              OPERATION,

            correlationId:
              context.correlationId,

            operationId:
              context.operationId,
          },
        );

      if (
        !r.called
      ) {
        return null;
      }

      if (
        !r.value
      ) {
        this.stats.lockFailures +=
          1;

        throw new AirtelCollectionServiceError(
          'Collection operation lock could not be acquired.',
          {
            code:
              ERROR_CODES.STATE_CONFLICT,

            statusCode:
              409,

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

      this.stats.lockAcquisitions +=
        1;

      return {
        key,

        handle:
          r.value,

        context,
      };
    } catch (e) {
      this.stats.lockFailures +=
        1;

      throw this.normalizeError(
        e,
        context,
      );
    }
  }

  async releaseOperationLock(
    lock,
  ) {
    if (!lock) {
      return;
    }

    try {
      const target =
        this.distributedLock;

      if (
        isFn(
          target?.release,
        )
      ) {
        await target.release(
          {
            key:
              lock.key,

            lock:
              lock.handle,

            handle:
              lock.handle,

            ...lock.context,
          },
        );

        return;
      }

      if (
        isFn(
          target?.unlock,
        )
      ) {
        await target.unlock(
          {
            key:
              lock.key,

            lock:
              lock.handle,

            handle:
              lock.handle,

            ...lock.context,
          },
        );
      }
    } catch (e) {
      this.log(
        'warn',
        'Collection operation lock release failed.',
        {
          error:
            safeError(e),
        },
      );
    }
  }

  async handleExecutionFailure({
    intent,
    tenantId,
    correlationId,
    operationId,
    error,
  }) {
    if (!intent) {
      return;
    }

    const state =
      upper(
        intent.state ||
        intent.status,
      );

    if (
      [
        COLLECTION_STATES.SUCCESS,
        COLLECTION_STATES.COMPENSATED,
        COLLECTION_STATES.REFUNDED,
        COLLECTION_STATES.REVERSED,
      ].includes(
        state,
      )
    ) {
      return;
    }

    const targetState =
      error?.uncertain
        ? COLLECTION_STATES.AMBIGUOUS
        : COLLECTION_STATES.FAILED;

    try {
      await this.transitionState(
        {
          intent,

          tenantId,
          correlationId,
          operationId,

          toState:
            targetState,

          action:
            error?.uncertain
              ? 'MARK_AMBIGUOUS'
              : 'MARK_FAILED',

          reason:
            error?.message ||
            'Airtel collection execution failed.',

          patch: {
            errorCode:
              error?.code,

            errorStatus:
              error?.statusCode,

            financiallyAmbiguous:
              Boolean(
                error?.uncertain,
              ),

            failureAt:
              now(
                this.clock,
              ),
          },
        },
      );
    } catch (transitionError) {
      this.log(
        'error',
        'Collection failure state transition failed.',
        {
          error:
            safeError(
              transitionError,
            ),
        },
      );
    }

    if (
      error?.uncertain
    ) {
      this.stats.collectionsAmbiguous +=
        1;

      const request =
        this.collectionRecordToRequest(
          intent,
          tenantId,
          correlationId,
          operationId,
        );

      await this.enqueueReconciliation(
        {
          intent,
          request,

          normalized: {
            outcome:
              PROVIDER_OUTCOME.UNKNOWN,

            uncertain:
              true,
          },

          tenantId,
          correlationId,
          operationId,
        },
      );
    }
  }

  async publishFailureTelemetry({
    tenantId,
    correlationId,
    operationId,
    error,
  }) {
    await this.audit(
      'AIRTEL_COLLECTION_FAILED',
      {
        tenantId,

        correlationId,

        operationId,

        error: {
          code:
            error?.code,

          statusCode:
            error?.statusCode,

          retryable:
            error?.retryable,

          uncertain:
            error?.uncertain,

          message:
            error?.message,
        },
      },
    );

    await this.publishEvent(
      'AIRTEL_COLLECTION_FAILED',
      {
        tenantId,

        correlationId,

        operationId,

        error: {
          code:
            error?.code,

          statusCode:
            error?.statusCode,

          retryable:
            error?.retryable,

          uncertain:
            error?.uncertain,
        },
      },
    );

    if (
      this.deadLetterQueue &&
      isFn(
        this.deadLetterQueue.enqueue,
      )
    ) {
      try {
        await this.deadLetterQueue.enqueue(
          {
            provider:
              PROVIDER,

            operation:
              OPERATION,

            tenantId,

            correlationId,
            operationId,

            code:
              error?.code,

            retryable:
              error?.retryable,

            uncertain:
              error?.uncertain,
          },
        );

        this.stats.deadLetters +=
          1;
      } catch (e) {
        this.log(
          'warn',
          'Collection dead-letter publication failed.',
          {
            error:
              safeError(e),
          },
        );
      }
    }
  }

  buildResponse({
    outcome,
    state,
    request,
    intent,
    normalized,
    correlationId,
    operationId,
    nextAction,
    approval,
    financialResult,
  }) {
    return {
      provider:
        PROVIDER,

      operation:
        OPERATION,

      tenantId:
        request?.tenantId ||
        intent?.tenantId,

      collectionId:
        collectionId(
          intent,
        ),

      state:
        state ||
        upper(
          intent?.state ||
          intent?.status,
        ) ||
        COLLECTION_STATES.DRAFT,

      outcome,

      correlationId,

      operationId,

      providerReference:
        normalized
          ?.providerReference ||
        intent?.providerReference ||
        null,

      transactionId:
        normalized
          ?.transactionId ||
        intent?.transactionId ||
        null,

      externalReference:
        request?.externalReference ||
        intent?.externalReference ||
        null,

      amount:
        request?.amount ||
        intent?.amount ||
        null,

      amountMinor:
        request?.amountMinor ??
        intent?.amountMinor ??
        null,

      currency:
        request?.currency ||
        intent?.currency ||
        null,

      nextAction:
        nextAction ||
        'NONE',

      providerOutcome:
        normalized?.outcome ||
        null,

      providerStatus:
        normalized?.status ||
        null,

      message:
        normalized?.message ||
        null,

      callbackExpected:
        Boolean(
          normalized?.callbackExpected,
        ),

      uncertain:
        Boolean(
          normalized?.uncertain ||
          uncertain(
            state,
          ),
        ),

      approval:
        approval
          ? sanitize(
              approval,
            )
          : null,

      financialResult:
        financialResult
          ? sanitize(
              financialResult,
            )
          : null,

      metadata:
        sanitize(
          request?.metadata ||
          intent?.metadata ||
          {},
        ),

      timestamp:
        now(
          this.clock,
        ),
    };
  }

  financialSnapshot() {
    return {
      financialCoreConfigured:
        Boolean(
          this.financialCore,
        ),

      financialCoreRequired:
        this.configuration
          .requireFinancialCoreForSuccess,

      directLedgerMutation:
        false,

      directBalanceMutation:
        false,

      directWalletMutation:
        false,

      localSettlementFinality:
        false,

      settlementsConfirmed:
        this.stats
          .financialCoreSettlements,
    };
  }

  securitySnapshot() {
    return {
      policyEngine:
        Boolean(
          this.policyEngine,
        ),

      fraudGuard:
        Boolean(
          this.fraudGuard ||
          this.fraudService,
        ),

      amlService:
        Boolean(
          this.amlService,
        ),

      velocityService:
        Boolean(
          this.velocityService,
        ),

      approvalService:
        Boolean(
          this.approvalService,
        ),

      tenantIsolation:
        true,

      failClosedOnPolicyError:
        this.configuration
          .failClosedOnPolicyError,

      failClosedOnFraudError:
        this.configuration
          .failClosedOnFraudError,

      failClosedOnAmlError:
        this.configuration
          .failClosedOnAmlError,
    };
  }

  reliabilitySnapshot() {
    return {
      circuitBreakerConfigured:
        Boolean(
          this.circuitBreaker,
        ),

      circuitState:
        this.circuitBreaker
          ?.state ||
        this.circuitBreaker
          ?.status ||
        'UNKNOWN',

      distributedLockConfigured:
        Boolean(
          this.distributedLock,
        ),

      activeOperations:
        this.activeOperations.size,

      providerAttempts:
        this.stats.providerAttempts,

      providerFailures:
        this.stats.providerFailures,

      providerTimeouts:
        this.stats.providerTimeouts,

      unsafeRetriesPrevented:
        this.stats
          .unsafeRetriesPrevented,

      reconciliationRequests:
        this.stats
          .reconciliationRequests,
    };
  }

  statisticsSnapshot() {
    return Object.freeze({
      ...this.stats,
    });
  }

  metricsSnapshot() {
    return this.statisticsSnapshot();
  }

  slaStatus() {
    const done =
      this.stats
        .collectionsCompleted;

    const failed =
      this.stats
        .collectionsFailed;

    return {
      completed:
        done,

      failures:
        failed,

      successRate:
        done
          ? Math.max(
              0,
              (
                (
                  done -
                  failed
                ) /
                done
              ) *
                100,
            )
          : 100,

      target:
        99.9,

      measuredAt:
        now(
          this.clock,
        ),
    };
  }

  providerScore() {
    return this.stats.providerAttempts
      ? Math.max(
          0,
          Math.min(
            100,

            100 -
              (
                (
                  this.stats
                    .providerFailures /
                  this.stats
                    .providerAttempts
                ) *
                100
              ),
          ),
        )
      : 100;
  }

  async health() {
    this.lastHealthCheckAt =
      now(
        this.clock,
      );

    const provider =
      this.healthState.dependencies
        .provider ||
      {
        status:
          'UNKNOWN',
      };

    const auth =
      this.healthState.dependencies
        .authentication ||
      {
        status:
          'UNKNOWN',
      };

    const degraded =
      [
        provider,
        auth,
      ].some(
        (x) =>
          [
            'DOWN',
            'DEGRADED',
            'UNAVAILABLE',
            'ERROR',
          ].includes(
            upper(
              x?.status,
            ),
          ),
      );

    const status =
      this.state ===
      SERVICE_STATUS.STOPPED
        ? SERVICE_STATUS.STOPPED
        : this.state ===
          SERVICE_STATUS.SHUTTING_DOWN
          ? SERVICE_STATUS.SHUTTING_DOWN
          : degraded
            ? SERVICE_STATUS.DEGRADED
            : this.initialized
              ? SERVICE_STATUS.READY
              : this.state;

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

      readiness:
        this.initialized &&
        status ===
          SERVICE_STATUS.READY,

      liveness:
        true,

      initialized:
        this.initialized,

      activeOperations:
        this.activeOperations.size,

      startedAt:
        this.startedAt,

      lastActivityAt:
        this.lastActivityAt,

      lastSuccessAt:
        this.lastSuccessAt,

      lastFailureAt:
        this.lastFailureAt,

      lastHealthCheckAt:
        this.lastHealthCheckAt,

      dependencies: {
        authentication:
          auth,

        provider:
          provider,

        validator:
          Boolean(
            this.validator,
          ),

        idempotency:
          Boolean(
            this.idempotencyManager,
          ),

        stateMachine:
          Boolean(
            this.transactionStateMachine,
          ),

        callbackCorrelation:
          Boolean(
            this.callbackCorrelation,
          ),

        financialCore:
          Boolean(
            this.financialCore,
          ),

        reconciliation:
          Boolean(
            this.reconciliationService,
          ),

        settlement:
          Boolean(
            this.settlementService,
          ),

        audit:
          Boolean(
            this.auditService,
          ),

        eventBus:
          Boolean(
            this.eventBus,
          ),
      },

      statistics:
        this.statisticsSnapshot(),

      financial:
        this.financialSnapshot(),

      security:
        this.securitySnapshot(),

      reliability:
        this.reliabilitySnapshot(),

      sla:
        this.slaStatus(),

      providerScore:
        this.providerScore(),

      lastError:
        sanitize(
          this.healthState.lastError,
        ),
    };
  }

  async readiness() {
    const h =
      await this.health();

    return {
      ready:
        h.readiness,

      status:
        h.status,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      missing:
        this.readinessMissingDependencies(),

      timestamp:
        now(
          this.clock,
        ),
    };
  }

  readinessMissingDependencies() {
    const m = [];

    if (!this.authService) {
      m.push(
        'authService',
      );
    }

    if (
      !this.providerClient &&
      !this.httpClient
    ) {
      m.push(
        'providerClient',
      );
    }

    if (!this.validator) {
      m.push(
        'validator',
      );
    }

    if (
      !this.idempotencyManager
    ) {
      m.push(
        'idempotencyManager',
      );
    }

    if (
      !this.transactionStateMachine
    ) {
      m.push(
        'transactionStateMachine',
      );
    } else if (
      !this.isCompatibleCollectionStateMachine()
    ) {
      m.push(
        'collectionStateMachineCompatibility',
      );
    }

    if (
      this.configuration
        .requireDurableIntent &&
      !this.hasIntentRepository()
    ) {
      m.push(
        'durableIntent',
      );
    }

    if (
      this.configuration
        .requireFinancialCoreForSuccess &&
      !this.financialCore
    ) {
      m.push(
        'financialCore',
      );
    }

    if (
      (
        this.configuration
          .callbackCorrelationRequired ||
        this.configuration
          .requireCallbackCorrelation
      ) &&
      !this.callbackCorrelation
    ) {
      m.push(
        'callbackCorrelation',
      );
    }

    return m;
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
        now(
          this.clock,
        ),
    };
  }

  diagnostics() {
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

      schemaVersion:
        SCHEMA_VERSION,

      state:
        this.state,

      initialized:
        this.initialized,

      runtime: {
        activeOperations:
          this.activeOperations.size,

        startedAt:
          this.startedAt,

        lastActivityAt:
          this.lastActivityAt,

        lastSuccessAt:
          this.lastSuccessAt,

        lastFailureAt:
          this.lastFailureAt,
      },

      configuration:
        sanitize(
          this.configuration,
        ),

      statistics:
        this.statisticsSnapshot(),

      health:
        this.healthState,

      financial:
        this.financialSnapshot(),

      security:
        this.securitySnapshot(),

      reliability:
        this.reliabilitySnapshot(),

      boundaries: {
        providerHttpDirect:
          false,

        databaseDirect:
          false,

        ledgerDirect:
          false,

        balanceMutationDirect:
          false,

        walletMutationDirect:
          false,

        settlementFinalityLocal:
          false,

        callbackSignatureVerificationLocal:
          false,
      },
    };
  }

  snapshot() {
    return {
      timestamp:
        now(
          this.clock,
        ),

      state:
        this.state,

      initialized:
        this.initialized,

      activeOperations:
        this.activeOperations.size,

      statistics:
        this.statisticsSnapshot(),

      sla:
        this.slaStatus(),

      providerScore:
        this.providerScore(),
    };
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
          sanitize(
            attributes,
          ),
        );
      } else if (
        span?.setAttribute
      ) {
        for (
          const [
            k,
            v,
          ]
          of Object.entries(
            sanitize(
              attributes,
            ),
          )
        ) {
          span.setAttribute(
            k,
            v == null
              ? ''
              : String(v),
          );
        }
      }

      return span;
    } catch {
      return null;
    }
  }

  metric(
    name,
    value = 1,
  ) {
    try {
      if (
        isFn(
          this.metrics
            ?.counter,
        )
      ) {
        return this.metrics.counter(
          name,
          value,
        );
      }

      if (
        isFn(
          this.metrics
            ?.increment,
        )
      ) {
        return this.metrics.increment(
          name,
          value,
        );
      }

      if (
        isFn(
          this.metrics
            ?.inc,
        )
      ) {
        return this.metrics.inc(
          name,
          value,
        );
      }
    } catch {
      // Observability must not mutate payment state.
    }
  }

  timing(
    name,
    value,
  ) {
    try {
      if (
        isFn(
          this.metrics
            ?.histogram,
        )
      ) {
        return this.metrics.histogram(
          name,
          value,
        );
      }

      if (
        isFn(
          this.metrics
            ?.observe,
        )
      ) {
        return this.metrics.observe(
          name,
          value,
        );
      }
    } catch {
      // Observability must not mutate payment state.
    }
  }

  async audit(
    action,
    payload = {},
  ) {
    if (
      !this.configuration.enableAudit ||
      !this.auditService
    ) {
      return;
    }

    try {
      const r =
        await invoke(
          this.auditService,
          [
            'record',
            'append',
            'write',
            'createAuditLog',
          ],
          {
            action,

            provider:
              PROVIDER,

            operation:
              OPERATION,

            timestamp:
              now(
                this.clock,
              ),

            ...sanitize(
              payload,
            ),
          },
        );

      if (
        r.called
      ) {
        this.stats.auditEvents +=
          1;
      }
    } catch (e) {
      if (
        !this.configuration
          .failOpenOnAuditError
      ) {
        throw new AirtelCollectionServiceError(
          'Collection audit recording failed.',
          {
            code:
              ERROR_CODES.INTENT_PERSISTENCE_FAILED,

            statusCode:
              503,

            retryable:
              true,

            cause:
              e,
          },
        );
      }

      this.log(
        'warn',
        'Collection audit write failed.',
        {
          error:
            safeError(e),
        },
      );
    }
  }

  async publishEvent(
    type,
    payload = {},
  ) {
    if (
      !this.configuration.enableEvents
    ) {
      return;
    }

    const event = {
      type,

      provider:
        PROVIDER,

      operation:
        OPERATION,

      timestamp:
        now(
          this.clock,
        ),

      payload:
        sanitize(
          payload,
        ),
    };

    try {
      if (
        isFn(
          this.outboxService
            ?.enqueue,
        )
      ) {
        await this.outboxService.enqueue(
          event,
        );

        this.stats.outboxEvents +=
          1;

        return;
      }

      const r =
        await invoke(
          this.eventBus,
          [
            'publish',
            'enqueue',
            'emit',
          ],
          event,
        );

      if (
        r.called
      ) {
        this.stats.eventPublications +=
          1;
      }
    } catch (e) {
      if (
        !this.configuration
          .failOpenOnEventError
      ) {
        throw new AirtelCollectionServiceError(
          'Collection event publication failed.',
          {
            code:
              ERROR_CODES.INTENT_PERSISTENCE_FAILED,

            statusCode:
              503,

            retryable:
              true,

            cause:
              e,
          },
        );
      }

      this.log(
        'warn',
        'Collection event publication failed.',
        {
          error:
            safeError(e),
        },
      );
    }
  }

  log(
    level,
    message,
    payload = {},
  ) {
    try {
      this.logger?.[level]?.(
        {
          component:
            COMPONENT,

          provider:
            PROVIDER,

          operation:
            OPERATION,

          message,

          ...sanitize(
            payload,
          ),
        },
      );
    } catch {
      // Logging must never alter payment semantics.
    }
  }

  normalizeError(
    error,
    context = {},
  ) {
    if (
      error instanceof
      AirtelCollectionServiceError
    ) {
      return error;
    }

    return new AirtelCollectionServiceError(
      error?.message ||
        'Airtel collection operation failed.',
      {
        code:
          error?.code ||
          ERROR_CODES.REQUEST_INVALID,

        statusCode:
          error?.statusCode ||
          error?.status ||
          500,

        retryable:
          Boolean(
            error?.retryable,
          ),

        uncertain:
          Boolean(
            error?.uncertain ||
            error?.financiallyAmbiguous,
          ),

        tenantId:
          context.tenantId ||
          error?.tenantId,

        correlationId:
          context.correlationId ||
          error?.correlationId,

        operationId:
          context.operationId ||
          error?.operationId,

        cause:
          error,
      },
    );
  }

  sleep(ms) {
    return new Promise(
      (r) =>
        setTimeout(
          r,
          Math.max(
            0,
            Number(ms) || 0,
          ),
        ),
    );
  }

  resetStatistics() {
    for (
      const key
      of Object.keys(
        this.stats,
      )
    ) {
      this.stats[key] =
        0;
    }

    return this.statisticsSnapshot();
  }
}

export function createCollectionService(
  options = {},
) {
  return new CollectionService(
    options,
  );
}

export function isCollectionTerminal(
  state,
) {
  return terminal(
    state,
  );
}

export function isCollectionUncertain(
  state,
) {
  return uncertain(
    state,
  );
}

export function normalizeAirtelCollectionPhone(
  value,
  configuration =
    DEFAULT_CONFIGURATION,
) {
  return normalizePhone(
    value,
    {
      ...DEFAULT_CONFIGURATION,
      ...configuration,
    },
  );
}

export function createCollectionFingerprint({
  tenantId,
  amount,
  currency =
    DEFAULT_CONFIGURATION.defaultCurrency,
  phoneNumber,
  externalReference,
  payer = {},
} = {}, configuration = DEFAULT_CONFIGURATION) {
  const config = {
    ...DEFAULT_CONFIGURATION,
    ...configuration,

    currencyMinorUnits: {
      ...DEFAULT_CONFIGURATION.currencyMinorUnits,
      ...(configuration.currencyMinorUnits || {}),
    },
  };

  const n =
    normalizeAmount(
      amount,
      currency,
      config,
    );

  return sha256(
    JSON.stringify(
      stable(
        {
          tenantId,

          provider:
            PROVIDER,

          operation:
            OPERATION,

          amountMinor:
            n.amountMinor,

          currency:
            n.currency,

          phoneNumber:
            normalizePhone(
              phoneNumber,
              config,
            ),

          externalReference:
            reference(
              externalReference,
            ),

          payer:
            sanitize(
              payer,
            ),
        },
      ),
    ),
  );
}

export default CollectionService;