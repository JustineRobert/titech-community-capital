'use strict';

/**
 * ==========================================================
 * TITech Community Capital LTD
 * Enterprise MTN MoMo Collections Gateway
 * ----------------------------------------------------------
 * File
 * ----
 * backend/modules/payment/mtn/collections.js
 *
 * Architectural Role
 * ------------------
 * Provider adapter/orchestration boundary for MTN MoMo
 * Request-to-Pay collections.
 *
 * Primary financial use cases
 * ---------------------------
 * - Savings contributions
 * - Loan repayments
 * - Member deposits
 * - Group collections
 * - Subscription payments
 *
 * Responsibilities
 * ----------------
 * - Validate collection requests.
 * - Enforce tenant context.
 * - Enforce idempotency.
 * - Execute configured fraud/risk pre-checks.
 * - Generate MTN Request-to-Pay payloads.
 * - Obtain OAuth tokens through authService.
 * - Submit requests to MTN.
 * - Normalize provider responses.
 * - Create/register the internal payment transaction through the
 *   canonical transaction boundary.
 * - Correlate provider references for callback processing.
 * - Register settlement tracking.
 * - Record audit evidence.
 * - Emit transactional/outbox-ready domain events.
 * - Expose safe operational health/diagnostics.
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * - OAuth implementation.
 * - Token storage.
 * - Callback processing.
 * - Callback signature verification.
 * - Ledger posting.
 * - Balance mutation.
 * - Final settlement.
 * - Reconciliation.
 * - Direct database accounting logic.
 *
 * Financial Safety Principle
 * --------------------------
 * A successful MTN HTTP response means only that the provider accepted the
 * Request-to-Pay initiation request according to the provider response.
 *
 * It does NOT mean:
 *
 *     payment received
 *     +
 *     payment settled
 *     +
 *     ledger posted
 *
 * The authoritative financial lifecycle remains:
 *
 *   Request-to-Pay
 *        ↓
 *   Provider processing
 *        ↓
 *   Callback / provider status evidence
 *        ↓
 *   Validation
 *        ↓
 *   Reconciliation
 *        ↓
 *   Financial transaction
 *        ↓
 *   Settlement
 *
 * Security Principles
 * -------------------
 * - Never log OAuth access tokens.
 * - Never log API keys or client secrets.
 * - Never trust caller-supplied tenant identifiers without upstream
 *   tenant authorization/resolution.
 * - Never reuse a caller reference blindly as an idempotency identity.
 * - Never mutate balances from this module.
 * - Never treat provider acceptance as final settlement.
 * - Never expose raw provider payloads in normal application logs.
 *
 * Module Format
 * -------------
 * CommonJS.
 *
 * ==========================================================
 */

const crypto = require('crypto');

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 250;
const DEFAULT_RETRY_MAX_MS = 5_000;

const DEFAULT_CURRENCY = 'UGX';

const COLLECTION_TYPES = Object.freeze({
  SAVINGS_CONTRIBUTION: 'SAVINGS_CONTRIBUTION',
  LOAN_REPAYMENT: 'LOAN_REPAYMENT',
  MEMBER_DEPOSIT: 'MEMBER_DEPOSIT',
  GROUP_COLLECTION: 'GROUP_COLLECTION',
  SUBSCRIPTION_PAYMENT: 'SUBSCRIPTION_PAYMENT'
});

const COLLECTION_STATUSES = Object.freeze({
  CREATED: 'CREATED',
  SUBMITTED: 'SUBMITTED',
  PENDING_PROVIDER: 'PENDING_PROVIDER',
  PROVIDER_ACCEPTED: 'PROVIDER_ACCEPTED',
  PENDING_CALLBACK: 'PENDING_CALLBACK',
  FAILED: 'FAILED',
  REQUIRES_RECONCILIATION: 'REQUIRES_RECONCILIATION'
});

const PROVIDER_OUTCOMES = Object.freeze({
  ACCEPTED: 'ACCEPTED',
  PENDING: 'PENDING',
  FAILED: 'FAILED',
  UNKNOWN: 'UNKNOWN'
});

const ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'MTN_COLLECTION_INVALID_INPUT',
  TENANT_REQUIRED: 'MTN_COLLECTION_TENANT_REQUIRED',
  PAYER_REQUIRED: 'MTN_COLLECTION_PAYER_REQUIRED',
  AMOUNT_REQUIRED: 'MTN_COLLECTION_AMOUNT_REQUIRED',
  INVALID_AMOUNT: 'MTN_COLLECTION_INVALID_AMOUNT',
  CURRENCY_REQUIRED: 'MTN_COLLECTION_CURRENCY_REQUIRED',
  INVALID_CURRENCY: 'MTN_COLLECTION_INVALID_CURRENCY',
  REFERENCE_REQUIRED: 'MTN_COLLECTION_REFERENCE_REQUIRED',
  DUPLICATE_REQUEST: 'MTN_COLLECTION_DUPLICATE_REQUEST',
  IDEMPOTENCY_CONFLICT: 'MTN_COLLECTION_IDEMPOTENCY_CONFLICT',
  FRAUD_REJECTED: 'MTN_COLLECTION_FRAUD_REJECTED',
  AUTHENTICATION_FAILED: 'MTN_COLLECTION_AUTHENTICATION_FAILED',
  PROVIDER_REQUEST_FAILED: 'MTN_COLLECTION_PROVIDER_REQUEST_FAILED',
  PROVIDER_TIMEOUT: 'MTN_COLLECTION_PROVIDER_TIMEOUT',
  PROVIDER_UNAVAILABLE: 'MTN_COLLECTION_PROVIDER_UNAVAILABLE',
  PROVIDER_RESPONSE_INVALID: 'MTN_COLLECTION_PROVIDER_RESPONSE_INVALID',
  TRANSACTION_CREATION_FAILED: 'MTN_COLLECTION_TRANSACTION_CREATION_FAILED',
  CALLBACK_CORRELATION_FAILED: 'MTN_COLLECTION_CALLBACK_CORRELATION_FAILED',
  SETTLEMENT_REGISTRATION_FAILED: 'MTN_COLLECTION_SETTLEMENT_REGISTRATION_FAILED',
  EVENT_PUBLICATION_FAILED: 'MTN_COLLECTION_EVENT_PUBLICATION_FAILED',
  CONFIGURATION_ERROR: 'MTN_COLLECTION_CONFIGURATION_ERROR',
  INTERNAL_ERROR: 'MTN_COLLECTION_INTERNAL_ERROR'
});

const TRANSIENT_HTTP_STATUSES = new Set([
  408,
  425,
  429,
  500,
  502,
  503,
  504
]);

/* -------------------------------------------------------------------------- */
/* Error                                                                      */
/* -------------------------------------------------------------------------- */

class MTNCollectionError extends Error {
  constructor(
    message,
    code = ERROR_CODES.INTERNAL_ERROR,
    details = undefined,
    options = {}
  ) {
    super(message);

    this.name = 'MTNCollectionError';
    this.code = code;

    this.retryable = Boolean(
      options.retryable
    );

    this.httpStatus =
      Number.isFinite(options.httpStatus)
        ? options.httpStatus
        : undefined;

    this.providerStatus =
      options.providerStatus;

    this.providerCode =
      options.providerCode;

    this.conflict =
      Boolean(options.conflict);

    this.rejected =
      Boolean(options.rejected);

    if (details !== undefined) {
      this.details = details;
    }

    if (Error.captureStackTrace) {
      Error.captureStackTrace(
        this,
        MTNCollectionError
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Generic helpers                                                            */
/* -------------------------------------------------------------------------- */

function normalizeString(
  value,
  maxLength = 512
) {
  if (
    value === undefined ||
    value === null
  ) {
    return undefined;
  }

  const normalized =
    String(value).trim();

  if (!normalized) {
    return undefined;
  }

  return normalized.length > maxLength
    ? normalized.slice(0, maxLength)
    : normalized;
}

function normalizeId(value) {
  return normalizeString(
    value,
    256
  );
}

function createCorrelationId() {
  return `mtn-collection-${crypto.randomUUID()}`;
}

function createOperationId() {
  return `collection-${crypto.randomUUID()}`;
}

function createIdempotencyKey(
  input
) {
  if (
    input.idempotencyKey
  ) {
    return normalizeString(
      input.idempotencyKey,
      256
    );
  }

  return `mtn-collection:${crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        tenantId:
          normalizeId(
            input.tenantId
          ),

        reference:
          normalizeString(
            input.reference,
            256
          ),

        payer:
          normalizeString(
            input.payer,
            256
          ),

        amount:
          String(
            input.amount
          ),

        currency:
          normalizeString(
            input.currency,
            16
          ),

        type:
          normalizeString(
            input.type,
            128
          )
      })
    )
    .digest('hex')}`;
}

function createRequestFingerprint(
  input
) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        tenantId:
          normalizeId(
            input.tenantId
          ),

        payer:
          normalizeString(
            input.payer,
            256
          ),

        amount:
          String(
            input.amount
          ),

        currency:
          normalizeString(
            input.currency,
            16
          ),

        reference:
          normalizeString(
            input.reference,
            256
          ),

        type:
          normalizeString(
            input.type,
            128
          )
      })
    )
    .digest('hex');
}

function sleep(
  milliseconds
) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        milliseconds
      )
  );
}

function calculateRetryDelay(
  attempt,
  baseMs,
  maxMs
) {
  const exponential =
    baseMs *
    2 **
      Math.max(
        attempt - 1,
        0
      );

  const bounded =
    Math.min(
      exponential,
      maxMs
    );

  const jitter =
    Math.floor(
      Math.random() *
        Math.max(
          1,
          bounded * 0.25
        )
    );

  return Math.min(
    maxMs,
    bounded + jitter
  );
}

function isTransientStatus(
  status
) {
  return TRANSIENT_HTTP_STATUSES.has(
    Number(status)
  );
}

/* -------------------------------------------------------------------------- */
/* Logging / sanitization                                                     */
/* -------------------------------------------------------------------------- */

const SECRET_KEY_PATTERN =
  /(authorization|password|passwd|secret|token|api[-_]?key|private[-_]?key|client[-_]?secret|cookie|credential)/i;

function sanitize(
  value,
  depth = 0
) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    depth > 6
  ) {
    return '[TRUNCATED]';
  }

  if (
    typeof value ===
      'string' ||
    typeof value ===
      'number' ||
    typeof value ===
      'boolean'
  ) {
    return typeof value ===
      'string' &&
      value.length > 512
      ? `${value.slice(
          0,
          512
        )}...[TRUNCATED]`
      : value;
  }

  if (
    Array.isArray(
      value
    )
  ) {
    return value.map(
      (item) =>
        sanitize(
          item,
          depth + 1
        )
    );
  }

  if (
    typeof value ===
    'object'
  ) {
    const result = {};

    for (
      const [
        key,
        child
      ] of Object.entries(
        value
      )
    ) {
      result[key] =
        SECRET_KEY_PATTERN.test(
          key
        )
          ? '[REDACTED]'
          : sanitize(
              child,
              depth + 1
            );
    }

    return result;
  }

  return '[REDACTED]';
}

function serializeError(
  error
) {
  return sanitize({
    name:
      error?.name,

    code:
      error?.code,

    message:
      error?.message,

    retryable:
      error?.retryable,

    providerStatus:
      error?.providerStatus,

    providerCode:
      error?.providerCode
  });
}

function resolveLogger(
  injected
) {
  if (injected) {
    return injected;
  }

  const candidates = [
    '../../../utils/logger',
    '../../../utils/log',
    '../../../config/logger'
  ];

  for (
    const modulePath of
      candidates
  ) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const loaded =
        require(
          modulePath
        );

      const logger =
        loaded?.default ||
        loaded;

      if (logger) {
        return logger;
      }
    } catch (
      _error
    ) {
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
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

function normalizeCollectionType(
  type
) {
  const normalized =
    normalizeString(
      type,
      128
    ) ||
    COLLECTION_TYPES.SAVINGS_CONTRIBUTION;

  if (
    !Object.values(
      COLLECTION_TYPES
    ).includes(
      normalized
    )
  ) {
    throw new MTNCollectionError(
      `Unsupported collection type: ${normalized}.`,
      ERROR_CODES.INVALID_INPUT,
      {
        type:
          normalized
      },
      {
        httpStatus:
          400,
        rejected:
          true
      }
    );
  }

  return normalized;
}

function normalizeAmount(
  amount
) {
  if (
    amount ===
      undefined ||
    amount ===
      null ||
    amount === ''
  ) {
    throw new MTNCollectionError(
      'Collection amount is required.',
      ERROR_CODES.AMOUNT_REQUIRED,
      undefined,
      {
        httpStatus:
          400,
        rejected:
          true
      }
    );
  }

  const stringAmount =
    String(
      amount
    ).trim();

  /*
   * Monetary values are kept as decimal strings at this boundary. This avoids
   * introducing JavaScript floating-point arithmetic into payment amounts.
   */
  if (
    !/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(
      stringAmount
    )
  ) {
    throw new MTNCollectionError(
      'Collection amount is not a valid monetary value.',
      ERROR_CODES.INVALID_AMOUNT,
      undefined,
      {
        httpStatus:
          400,
        rejected:
          true
      }
    );
  }

  if (
    /^0+(?:\.0+)?$/.test(
      stringAmount
    )
  ) {
    throw new MTNCollectionError(
      'Collection amount must be greater than zero.',
      ERROR_CODES.INVALID_AMOUNT,
      undefined,
      {
        httpStatus:
          400,
        rejected:
          true
      }
    );
  }

  return stringAmount;
}

function normalizeCurrency(
  currency
) {
  const normalized =
    normalizeString(
      currency,
      16
    )?.toUpperCase();

  if (
    !normalized
  ) {
    throw new MTNCollectionError(
      'Collection currency is required.',
      ERROR_CODES.CURRENCY_REQUIRED,
      undefined,
      {
        httpStatus:
          400,
        rejected:
          true
      }
    );
  }

  if (
    !/^[A-Z]{3}$/.test(
      normalized
    )
  ) {
    throw new MTNCollectionError(
      'Collection currency must be a valid ISO-style three-letter code.',
      ERROR_CODES.INVALID_CURRENCY,
      undefined,
      {
        httpStatus:
          400,
        rejected:
          true
      }
    );
  }

  return normalized;
}

function normalizePayer(
  payer
) {
  if (
    !payer
  ) {
    throw new MTNCollectionError(
      'Payer is required.',
      ERROR_CODES.PAYER_REQUIRED,
      undefined,
      {
        httpStatus:
          400,
        rejected:
          true
      }
    );
  }

  if (
    typeof payer ===
    'string'
  ) {
    const normalized =
      normalizeString(
        payer,
        128
      );

    if (!normalized) {
      throw new MTNCollectionError(
        'Payer is required.',
        ERROR_CODES.PAYER_REQUIRED,
        undefined,
        {
          httpStatus:
            400,
          rejected:
            true
        }
      );
    }

    return normalized;
  }

  if (
    typeof payer ===
    'object'
  ) {
    return sanitize(
      payer
    );
  }

  throw new MTNCollectionError(
    'Invalid payer format.',
    ERROR_CODES.PAYER_REQUIRED,
    undefined,
    {
      httpStatus:
        400,
      rejected:
        true
    }
  );
}

function normalizeReference(
  reference
) {
  const normalized =
    normalizeString(
      reference,
      256
    );

  if (
    !normalized
  ) {
    throw new MTNCollectionError(
      'Collection reference is required.',
      ERROR_CODES.REFERENCE_REQUIRED,
      undefined,
      {
        httpStatus:
          400,
        rejected:
          true
      }
    );
  }

  return normalized;
}

function normalizeInput(
  input
) {
  if (
    !input ||
    typeof input !==
      'object'
  ) {
    throw new MTNCollectionError(
      'Collection request is required.',
      ERROR_CODES.INVALID_INPUT,
      undefined,
      {
        httpStatus:
          400,
        rejected:
          true
      }
    );
  }

  const tenantId =
    normalizeId(
      input.tenantId
    );

  if (
    !tenantId
  ) {
    throw new MTNCollectionError(
      'tenantId is required.',
      ERROR_CODES.TENANT_REQUIRED,
      undefined,
      {
        httpStatus:
          400,
        rejected:
          true
      }
    );
  }

  const amount =
    normalizeAmount(
      input.amount
    );

  const currency =
    normalizeCurrency(
      input.currency ||
        DEFAULT_CURRENCY
    );

  const reference =
    normalizeReference(
      input.reference
    );

  const payer =
    normalizePayer(
      input.payer
    );

  const type =
    normalizeCollectionType(
      input.type
    );

  const correlationId =
    normalizeId(
      input.correlationId
    ) ||
    createCorrelationId();

  const operationId =
    normalizeId(
      input.operationId
    ) ||
    createOperationId();

  const idempotencyKey =
    createIdempotencyKey(
      {
        ...input,
        tenantId,
        amount,
        currency,
        reference,
        type
      }
    );

  const requestFingerprint =
    createRequestFingerprint(
      {
        tenantId,
        payer,
        amount,
        currency,
        reference,
        type
      }
    );

  return {
    tenantId,
    payer,
    amount,
    currency,
    reference,
    type,
    requestedBy:
      normalizeId(
        input.requestedBy
      ),
    metadata:
      sanitize(
        input.metadata ||
          {}
      ),
    callbackUrl:
      normalizeString(
        input.callbackUrl,
        1024
      ),
    idempotencyKey,
    requestFingerprint,
    correlationId,
    operationId
  };
}

/* -------------------------------------------------------------------------- */
/* Provider response normalization                                            */
/* -------------------------------------------------------------------------- */

function classifyProviderResponse(
  response
) {
  if (
    !response
  ) {
    return PROVIDER_OUTCOMES.UNKNOWN;
  }

  if (
    response.ok === false &&
    response.status
  ) {
    if (
      Number(response.status) >=
        200 &&
      Number(response.status) <
        300
    ) {
      return PROVIDER_OUTCOMES.ACCEPTED;
    }

    return isTransientStatus(
      response.status
    )
      ? PROVIDER_OUTCOMES.PENDING
      : PROVIDER_OUTCOMES.FAILED;
  }

  const status =
    normalizeString(
      response.data?.status ||
        response.data?.state ||
        response.statusText,
      128
    )?.toUpperCase();

  if (
    [
      'SUCCESS',
      'ACCEPTED',
      'PENDING',
      'PROCESSING',
      'QUEUED'
    ].includes(
      status
    )
  ) {
    return status ===
        'SUCCESS' ||
      status ===
        'ACCEPTED'
      ? PROVIDER_OUTCOMES.ACCEPTED
      : PROVIDER_OUTCOMES.PENDING;
  }

  if (
    response.ok
  ) {
    return PROVIDER_OUTCOMES.ACCEPTED;
  }

  return PROVIDER_OUTCOMES.UNKNOWN;
}

function normalizeProviderResponse(
  response
) {
  if (
    !response ||
    typeof response !==
      'object'
  ) {
    throw new MTNCollectionError(
      'MTN returned an invalid response.',
      ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      undefined,
      {
        retryable:
          true
      }
    );
  }

  const outcome =
    classifyProviderResponse(
      response
    );

  const data =
    response.data ||
    {};

  const providerReference =
    normalizeId(
      data.referenceId ||
        data.referenceID ||
        data.transactionId ||
        data.externalId ||
        response.referenceId
    );

  const providerStatus =
    normalizeString(
      data.status ||
        data.state ||
        data.message ||
        response.statusText,
      128
    );

  return {
    outcome,

    accepted:
      outcome ===
      PROVIDER_OUTCOMES.ACCEPTED,

    pending:
      outcome ===
      PROVIDER_OUTCOMES.PENDING,

    providerReference,

    providerStatus,

    httpStatus:
      Number.isFinite(
        Number(
          response.status
        )
      )
        ? Number(
            response.status
          )
        : undefined,

    rawMeta: {
      status:
        Number.isFinite(
          Number(
            response.status
          )
        )
          ? Number(
              response.status
            )
          : undefined,

      providerReference,

      providerStatus
    }
  };
}

/* -------------------------------------------------------------------------- */
/* Main class                                                                 */
/* -------------------------------------------------------------------------- */

class MTNCollections {
  constructor({
    authService,

    httpClient,

    configuration,

    transactionBuilder,

    transactionService,

    idempotencyManager,

    fraudGuard,

    stateMachine,

    settlementTracker,

    callbackCorrelation,

    auditService,

    eventPublisher,

    outboxService,

    authorizationService,

    tenantResolver,

    logger,

    metrics,

    tracer,

    config = {}
  } = {}) {
    this.authService =
      authService;

    this.httpClient =
      httpClient;

    this.configuration =
      configuration;

    this.transactionBuilder =
      transactionBuilder;

    this.transactionService =
      transactionService;

    this.idempotencyManager =
      idempotencyManager;

    this.fraudGuard =
      fraudGuard;

    this.stateMachine =
      stateMachine;

    this.settlementTracker =
      settlementTracker;

    this.callbackCorrelation =
      callbackCorrelation;

    this.auditService =
      auditService;

    this.eventPublisher =
      eventPublisher;

    this.outboxService =
      outboxService;

    this.authorizationService =
      authorizationService;

    this.tenantResolver =
      tenantResolver;

    this.logger =
      resolveLogger(
        logger
      );

    this.metrics =
      metrics;

    this.tracer =
      tracer;

    this.config = {
      timeoutMs:
        Number.isFinite(
          config.timeoutMs
        ) &&
        config.timeoutMs > 0
          ? config.timeoutMs
          : DEFAULT_TIMEOUT_MS,

      maxRetries:
        Number.isFinite(
          config.maxRetries
        ) &&
        config.maxRetries >= 0
          ? config.maxRetries
          : DEFAULT_MAX_RETRIES,

      retryBaseMs:
        Number.isFinite(
          config.retryBaseMs
        ) &&
        config.retryBaseMs > 0
          ? config.retryBaseMs
          : DEFAULT_RETRY_BASE_MS,

      retryMaxMs:
        Number.isFinite(
          config.retryMaxMs
        ) &&
        config.retryMaxMs > 0
          ? config.retryMaxMs
          : DEFAULT_RETRY_MAX_MS,

      requireTenant:
        config.requireTenant !==
        undefined
          ? Boolean(
              config.requireTenant
            )
          : true,

      useOutbox:
        config.useOutbox !==
        undefined
          ? Boolean(
              config.useOutbox
            )
          : true
    };

    this.statistics = {
      initiated: 0,
      accepted: 0,
      pending: 0,
      failed: 0,
      rejected: 0,
      duplicates: 0,
      retries: 0,
      providerTimeouts: 0
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Authorization                                                            */
  /* ------------------------------------------------------------------------ */

  async assertAuthorized(
    input
  ) {
    if (
      !this.authorizationService
    ) {
      return true;
    }

    const payload = {
      tenantId:
        input.tenantId,

      actorId:
        input.requestedBy,

      action:
        'payment.collection.initiate',

      resource:
        'mtn_collection',

      resourceId:
        input.reference
    };

    if (
      typeof this
        .authorizationService
        .assert ===
      'function'
    ) {
      await this.authorizationService.assert(
        payload
      );

      return true;
    }

    if (
      typeof this
        .authorizationService
        .can ===
      'function'
    ) {
      const permitted =
        await this.authorizationService.can(
          payload
        );

      if (
        !permitted
      ) {
        throw new MTNCollectionError(
          'Collection initiation is not authorized.',
          ERROR_CODES.INVALID_INPUT,
          undefined,
          {
            httpStatus:
              403,
            rejected:
              true
          }
        );
      }
    }

    return true;
  }

  /* ------------------------------------------------------------------------ */
  /* Tenant resolution                                                        */
  /* ------------------------------------------------------------------------ */

  async resolveTenant(
    input
  ) {
    if (
      input.tenantId
    ) {
      return input.tenantId;
    }

    if (
      !this.config.requireTenant
    ) {
      return undefined;
    }

    if (
      !this.tenantResolver
    ) {
      throw new MTNCollectionError(
        'Tenant could not be resolved.',
        ERROR_CODES.TENANT_REQUIRED,
        undefined,
        {
          httpStatus:
            400,
          rejected:
            true
        }
      );
    }

    if (
      typeof this
        .tenantResolver
        .resolveMTN ===
      'function'
    ) {
      const result =
        await this.tenantResolver.resolveMTN(
          input
        );

      const tenantId =
        normalizeId(
          result?.tenantId ||
            result?.id ||
            result
        );

      if (
        !tenantId
      ) {
        throw new MTNCollectionError(
          'Tenant resolution returned no tenant.',
          ERROR_CODES.TENANT_REQUIRED,
          undefined,
          {
            httpStatus:
              400,
            rejected:
              true
          }
        );
      }

      return tenantId;
    }

    if (
      typeof this
        .tenantResolver
        .resolve ===
      'function'
    ) {
      const result =
        await this.tenantResolver.resolve(
          {
            provider:
              'MTN',

            tenantId:
              input.tenantId,

            reference:
              input.reference
          }
        );

      const tenantId =
        normalizeId(
          result?.tenantId ||
            result?.id ||
            result
        );

      if (
        !tenantId
      ) {
        throw new MTNCollectionError(
          'Tenant resolution returned no tenant.',
          ERROR_CODES.TENANT_REQUIRED,
          undefined,
          {
            httpStatus:
              400,
            rejected:
              true
          }
        );
      }

      return tenantId;
    }

    throw new MTNCollectionError(
      'Tenant resolver contract is unsupported.',
      ERROR_CODES.CONFIGURATION_ERROR
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Idempotency                                                              */
  /* ------------------------------------------------------------------------ */

  async checkIdempotency(
    input
  ) {
    if (
      !this.idempotencyManager
    ) {
      return null;
    }

    const payload = {
      tenantId:
        input.tenantId,

      idempotencyKey:
        input.idempotencyKey,

      externalId:
        input.reference,

      requestFingerprint:
        input.requestFingerprint
    };

    let result;

    if (
      typeof this
        .idempotencyManager
        .check ===
      'function'
    ) {
      result =
        await this.idempotencyManager.check(
          payload
        );
    } else if (
      typeof this
        .idempotencyManager
        .get ===
      'function'
    ) {
      result =
        await this.idempotencyManager.get(
          payload
        );
    }

    if (
      !result
    ) {
      return null;
    }

    const storedFingerprint =
      result.requestFingerprint ||
      result.fingerprint;

    if (
      storedFingerprint &&
      storedFingerprint !==
        input.requestFingerprint
    ) {
      throw new MTNCollectionError(
        'Idempotency key has been reused for a different collection request.',
        ERROR_CODES.IDEMPOTENCY_CONFLICT,
        undefined,
        {
          httpStatus:
            409,
          conflict:
            true
        }
      );
    }

    return result;
  }

  async registerIdempotency(
    input,
    result
  ) {
    if (
      !this.idempotencyManager
    ) {
      return;
    }

    const payload = {
      tenantId:
        input.tenantId,

      idempotencyKey:
        input.idempotencyKey,

      externalId:
        input.reference,

      requestFingerprint:
        input.requestFingerprint,

      result
    };

    if (
      typeof this
        .idempotencyManager
        .register ===
      'function'
    ) {
      await this.idempotencyManager.register(
        payload
      );

      return;
    }

    if (
      typeof this
        .idempotencyManager
        .store ===
      'function'
    ) {
      await this.idempotencyManager.store(
        payload
      );
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Fraud / risk                                                             */
  /* ------------------------------------------------------------------------ */

  async inspectFraud(
    input
  ) {
    if (
      !this.fraudGuard
    ) {
      return {
        allowed:
          true
      };
    }

    let result;

    if (
      typeof this
        .fraudGuard
        .inspect ===
      'function'
    ) {
      result =
        await this.fraudGuard.inspect(
          {
            tenantId:
              input.tenantId,

            payer:
              input.payer,

            amount:
              input.amount,

            currency:
              input.currency,

            type:
              input.type,

            reference:
              input.reference,

            metadata:
              input.metadata,

            correlationId:
              input.correlationId
          }
        );
    }

    if (
      result ===
        false ||
      result?.allowed ===
        false ||
      result?.decision ===
        'BLOCK'
    ) {
      throw new MTNCollectionError(
        'Collection was rejected by the configured fraud/risk control.',
        ERROR_CODES.FRAUD_REJECTED,
        {
          reason:
            sanitize(
              result?.reason
            )
        },
        {
          httpStatus:
            403,
          rejected:
            true
        }
      );
    }

    return (
      result || {
        allowed:
          true
      }
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Transaction creation                                                     */
  /* ------------------------------------------------------------------------ */

  async createInternalTransaction(
    input
  ) {
    /*
     * Preferred architecture:
     * transactionService is the canonical financial transaction boundary.
     *
     * A legacy state-machine adapter may still be supported, but only when
     * explicitly configured.
     */
    if (
      this.transactionService
    ) {
      if (
        typeof this
          .transactionService
          .createPendingCollection ===
        'function'
      ) {
        return this.transactionService.createPendingCollection(
          {
            tenantId:
              input.tenantId,

            reference:
              input.reference,

            externalId:
              input.reference,

            type:
              input.type,

            amount:
              input.amount,

            currency:
              input.currency,

            payer:
              input.payer,

            requestedBy:
              input.requestedBy,

            idempotencyKey:
              input.idempotencyKey,

            correlationId:
              input.correlationId,

            metadata:
              input.metadata
          }
        );
      }

      if (
        typeof this
          .transactionService
          .create ===
        'function'
      ) {
        return this.transactionService.create(
          {
            tenantId:
              input.tenantId,

            reference:
              input.reference,

            externalId:
              input.reference,

            type:
              input.type,

            amount:
              input.amount,

            currency:
              input.currency,

            payer:
              input.payer,

            requestedBy:
              input.requestedBy,

            idempotencyKey:
              input.idempotencyKey,

            correlationId:
              input.correlationId,

            metadata:
              input.metadata
          }
        );
      }
    }

    /*
     * Backward-compatible adapter path for repositories where stateMachine
     * owns creation. This should not be the long-term financial architecture.
     */
    if (
      this.stateMachine &&
      typeof this
        .stateMachine
        .create ===
        'function'
    ) {
      return this.stateMachine.create(
        {
          tenantId:
            input.tenantId,

          reference:
            input.reference,

          externalId:
            input.reference,

          type:
            input.type,

          amount:
            input.amount,

          currency:
            input.currency,

          requestedBy:
            input.requestedBy,

          metadata:
            input.metadata
        }
      );
    }

    throw new MTNCollectionError(
      'No supported internal transaction creation service is configured.',
      ERROR_CODES.TRANSACTION_CREATION_FAILED
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Callback correlation                                                     */
  /* ------------------------------------------------------------------------ */

  async buildCallbackUrl(
    input
  ) {
    if (
      input.callbackUrl
    ) {
      return input.callbackUrl;
    }

    if (
      !this.callbackCorrelation
    ) {
      throw new MTNCollectionError(
        'Callback correlation service is not configured.',
        ERROR_CODES.CALLBACK_CORRELATION_FAILED
      );
    }

    if (
      typeof this
        .callbackCorrelation
        .callbackUrl ===
      'function'
    ) {
      const callbackUrl =
        await this.callbackCorrelation.callbackUrl(
          {
            tenantId:
              input.tenantId,

            reference:
              input.reference,

            correlationId:
              input.correlationId
          }
        );

      const normalized =
        normalizeString(
          callbackUrl,
          1024
        );

      if (
        !normalized
      ) {
        throw new MTNCollectionError(
          'Callback correlation service returned no callback URL.',
          ERROR_CODES.CALLBACK_CORRELATION_FAILED
        );
      }

      return normalized;
    }

    throw new MTNCollectionError(
      'Callback correlation service does not support callbackUrl().',
      ERROR_CODES.CALLBACK_CORRELATION_FAILED
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Provider payload                                                         */
  /* ------------------------------------------------------------------------ */

  async buildProviderPayload(
    input
  ) {
    requireDependency(
      this.transactionBuilder,
      'transactionBuilder'
    );

    const callbackUrl =
      await this.buildCallbackUrl(
        input
      );

    if (
      typeof this
        .transactionBuilder
        .build !==
      'function'
    ) {
      throw new MTNCollectionError(
        'MTN transaction builder does not expose build().',
        ERROR_CODES.CONFIGURATION_ERROR
      );
    }

    return this.transactionBuilder.build(
      {
        externalId:
          input.reference,

        payer:
          input.payer,

        amount:
          input.amount,

        currency:
          input.currency,

        callbackUrl,

        metadata:
          input.metadata
      }
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Provider HTTP request                                                    */
  /* ------------------------------------------------------------------------ */

  async submitProviderRequest(
    input,
    providerPayload,
    token
  ) {
    requireDependency(
      this.httpClient,
      'httpClient'
    );

    const endpoint =
      this.collectionEndpoint();

    let attempt =
      0;

    let lastError;

    while (
      attempt <=
      this.config.maxRetries
    ) {
      attempt +=
        1;

      try {
        this.statistics.retries +=
          attempt > 1
            ? 1
            : 0;

        const response =
          await this.httpClient.request(
            {
              method:
                'POST',

              url:
                endpoint,

              headers: {
                Authorization:
                  `Bearer ${token}`,

                'X-Reference-Id':
                  input.reference,

                'X-Target-Environment':
                  this.targetEnvironment(),

                Accept:
                  'application/json',

                'Content-Type':
                  'application/json',

                ...(this.subscriptionKey()
                  ? {
                      'Ocp-Apim-Subscription-Key':
                        this.subscriptionKey()
                    }
                  : {})
              },

              body:
                providerPayload,

              correlationId:
                input.correlationId,

              timeoutMs:
                this.config.timeoutMs
            }
          );

        const normalized =
          normalizeProviderResponse(
            response
          );

        /*
         * Retry only transport/transient failures. A permanent provider
         * rejection is not safe to blindly resend.
         */
        if (
          normalized.outcome ===
            PROVIDER_OUTCOMES.FAILED &&
          isTransientStatus(
            normalized.httpStatus
          ) &&
          attempt <=
            this.config.maxRetries
        ) {
          const delay =
            calculateRetryDelay(
              attempt,
              this.config.retryBaseMs,
              this.config.retryMaxMs
            );

          await sleep(
            delay
          );

          continue;
        }

        return {
          response,
          normalized
        };
      } catch (
        error
      ) {
        lastError =
          error;

        const retryable =
          Boolean(
            error?.retryable
          ) ||
          /timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|temporar|unavailable/i.test(
            String(
              error?.message ||
                ''
            )
          );

        if (
          !retryable ||
          attempt >
            this.config.maxRetries
        ) {
          break;
        }

        const delay =
          calculateRetryDelay(
            attempt,
            this.config.retryBaseMs,
            this.config.retryMaxMs
          );

        await sleep(
          delay
        );
      }
    }

    if (
      lastError?.code ===
        'ETIMEDOUT' ||
      /timeout/i.test(
        String(
          lastError?.message ||
            ''
        )
      )
    ) {
      this.statistics.providerTimeouts +=
        1;

      throw new MTNCollectionError(
        'MTN collection request timed out.',
        ERROR_CODES.PROVIDER_TIMEOUT,
        undefined,
        {
          retryable:
            true,
          httpStatus:
            504
        }
      );
    }

    throw (
      lastError instanceof
      MTNCollectionError
        ? lastError
        : new MTNCollectionError(
            'MTN collection provider request failed.',
            ERROR_CODES.PROVIDER_REQUEST_FAILED,
            undefined,
            {
              retryable:
                true
            }
          )
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Status management                                                        */
  /* ------------------------------------------------------------------------ */

  async transitionTransaction(
    transaction,
    nextStatus,
    input,
    metadata = {}
  ) {
    const transactionId =
      normalizeId(
        transaction?.id ||
          transaction?._id ||
          transaction?.transactionId
      );

    if (
      !transactionId
    ) {
      throw new MTNCollectionError(
        'Internal transaction identifier is unavailable.',
        ERROR_CODES.TRANSACTION_CREATION_FAILED
      );
    }

    const currentStatus =
      normalizeString(
        transaction.status ||
          transaction.state,
        128
      )?.toUpperCase();

    /*
     * Preferred transaction-service transition contract.
     */
    if (
      this.transactionService
    ) {
      if (
        typeof this
          .transactionService
          .transitionStatus ===
        'function'
      ) {
        return this.transactionService.transitionStatus(
          {
            tenantId:
              input.tenantId,

            transactionId,

            expectedStatus:
              currentStatus,

            nextStatus,

            metadata,

            correlationId:
              input.correlationId,

            idempotencyKey:
              `${input.idempotencyKey}:${nextStatus}`
          }
        );
      }

      if (
        typeof this
          .transactionService
          .transition ===
        'function'
      ) {
        return this.transactionService.transition(
          {
            tenantId:
              input.tenantId,

            transactionId,

            expectedStatus:
              currentStatus,

            nextStatus,

            metadata,

            correlationId:
              input.correlationId
          }
        );
      }
    }

    /*
     * Legacy state-machine compatibility path.
     */
    if (
      this.stateMachine &&
      typeof this
        .stateMachine
        .transition ===
        'function'
    ) {
      return this.stateMachine.transition(
        transaction,
        nextStatus,
        {
          actorId:
            input.requestedBy,

          actorType:
            'SERVICE',

          correlationId:
            input.correlationId,

          operationId:
            input.operationId,

          reason:
            metadata.reason,

          source:
            'MTNCollections'
        }
      );
    }

    /*
     * Do not silently mutate the transaction if no controlled transition
     * boundary exists.
     */
    throw new MTNCollectionError(
      'No supported transaction state-transition boundary is configured.',
      ERROR_CODES.TRANSACTION_CREATION_FAILED
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Settlement registration                                                  */
  /* ------------------------------------------------------------------------ */

  async registerSettlement(
    input,
    provider
  ) {
    if (
      !this.settlementTracker
    ) {
      throw new MTNCollectionError(
        'Settlement tracker is not configured.',
        ERROR_CODES.SETTLEMENT_REGISTRATION_FAILED
      );
    }

    const registration = {
      tenantId:
        input.tenantId,

      reference:
        input.reference,

      paymentReference:
        input.reference,

      provider:
        'MTN',

      providerTransactionId:
        provider.providerReference,

      amount:
        input.amount,

      currency:
        input.currency,

      correlationId:
        input.correlationId,

      metadata: {
        collectionType:
          input.type,

        providerStatus:
          provider.providerStatus,

        providerHttpStatus:
          provider.httpStatus
      }
    };

    if (
      typeof this
        .settlementTracker
        .register ===
      'function'
    ) {
      return this.settlementTracker.register(
        registration
      );
    }

    if (
      typeof this
        .settlementTracker
        .create ===
      'function'
    ) {
      return this.settlementTracker.create(
        registration
      );
    }

    throw new MTNCollectionError(
      'Settlement tracker does not expose a supported registration method.',
      ERROR_CODES.SETTLEMENT_REGISTRATION_FAILED
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Audit                                                                    */
  /* ------------------------------------------------------------------------ */

  async audit(
    eventType,
    input,
    metadata = {}
  ) {
    if (
      !this.auditService
    ) {
      return;
    }

    const payload = {
      eventType,

      action:
        eventType,

      provider:
        'MTN',

      tenantId:
        input.tenantId,

      reference:
        input.reference,

      correlationId:
        input.correlationId,

      actorId:
        input.requestedBy,

      transactionId:
        input.transactionId,

      metadata:
        sanitize(
          metadata
        )
    };

    try {
      if (
        typeof this
          .auditService
          .recordEvent ===
        'function'
      ) {
        await this.auditService.recordEvent(
          eventType,
          payload
        );

        return;
      }

      if (
        typeof this
          .auditService
          .record ===
        'function'
      ) {
        await this.auditService.record(
          payload
        );
      }
    } catch (
      error
    ) {
      this.logger.error?.(
        {
          provider:
            'MTN',

          tenantId:
            input.tenantId,

          reference:
            input.reference,

          correlationId:
            input.correlationId,

          error:
            serializeError(
              error
            )
        },
        'Failed to record MTN collection audit event'
      );
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Event / outbox                                                           */
  /* ------------------------------------------------------------------------ */

  async publishCollectionEvent(
    input,
    transaction,
    provider
  ) {
    const event = {
      type:
        'MTN_COLLECTION_INITIATED',

      provider:
        'MTN',

      tenantId:
        input.tenantId,

      occurredAt:
        new Date(),

      aggregateType:
        'Transaction',

      aggregateId:
        normalizeId(
          transaction?.id ||
            transaction?._id ||
            transaction?.transactionId
        ),

      idempotencyKey:
        `${input.idempotencyKey}:event`,

      correlationId:
        input.correlationId,

      payload: {
        reference:
          input.reference,

        transactionId:
          normalizeId(
            transaction?.id ||
              transaction?._id ||
              transaction?.transactionId
          ),

        type:
          input.type,

        amount:
          input.amount,

        currency:
          input.currency,

        provider:
          'MTN',

        providerReference:
          provider.providerReference,

        status:
          provider.accepted
            ? COLLECTION_STATUSES.PENDING_CALLBACK
            : COLLECTION_STATUSES.PENDING_PROVIDER
      }
    };

    /*
     * Prefer transactional outbox. A direct publisher remains supported for
     * installations that do not yet have an outbox implementation.
     */
    if (
      this.config.useOutbox &&
      this.outboxService
    ) {
      if (
        typeof this
          .outboxService
          .enqueue ===
        'function'
      ) {
        return this.outboxService.enqueue(
          event
        );
      }

      if (
        typeof this
          .outboxService
          .publishTransactional ===
        'function'
      ) {
        return this.outboxService.publishTransactional(
          event
        );
      }
    }

    if (
      this.eventPublisher &&
      typeof this
        .eventPublisher
        .publish ===
        'function'
    ) {
      return this.eventPublisher.publish(
        event
      );
    }

    return {
      published:
        false,

      skipped:
        true
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Collection initiation                                                    */
  /* ------------------------------------------------------------------------ */

  async collect(
    input = {}
  ) {
    const span =
      this.tracer?.startSpan?.(
        'payment.mtn.collection'
      );

    let normalized;

    try {
      normalized =
        normalizeInput(
          input
        );

      this.statistics.initiated +=
        1;

      /*
       * Resolve/verify the tenant before any provider side effect.
       */
      const resolvedTenantId =
        await this.resolveTenant(
          normalized
        );

      normalized.tenantId =
        resolvedTenantId;

      await this.assertAuthorized(
        normalized
      );

      /*
       * Check idempotency before fraud/provider/financial side effects.
       */
      const existing =
        await this.checkIdempotency(
          normalized
        );

      if (
        existing
      ) {
        this.statistics.duplicates +=
          1;

        this.metrics?.counter?.(
          'payment_mtn_collection_duplicate_total',
          {
            tenantId:
              normalized.tenantId
          }
        );

        return {
          success:
            true,

          idempotent:
            true,

          duplicate:
            true,

          correlationId:
            normalized.correlationId,

          reference:
            normalized.reference,

          transactionId:
            existing.transactionId ||
            existing.result?.transactionId,

          status:
            existing.status ||
            existing.result?.status ||
            COLLECTION_STATUSES.PENDING_CALLBACK
        };
      }

      /*
       * Fraud/risk control.
       */
      await this.inspectFraud(
        normalized
      );

      /*
       * Create the internal transaction BEFORE the provider side effect.
       *
       * This gives the platform an authoritative internal record against
       * which the provider callback can later correlate.
       */
      const transaction =
        await this.createInternalTransaction(
          normalized
        );

      normalized.transactionId =
        normalizeId(
          transaction?.id ||
            transaction?._id ||
            transaction?.transactionId
        );

      if (
        !normalized.transactionId
      ) {
        throw new MTNCollectionError(
          'Internal transaction creation returned no transaction identifier.',
          ERROR_CODES.TRANSACTION_CREATION_FAILED
        );
      }

      /*
       * Build provider payload.
       */
      const providerPayload =
        await this.buildProviderPayload(
          normalized
        );

      /*
       * Obtain OAuth token only through authService.
       */
      requireDependency(
        this.authService,
        'authService'
      );

      const token =
        await this.authService.getAccessToken(
          {
            tenantId:
              normalized.tenantId,

            correlationId:
              normalized.correlationId
          }
        );

      if (
        !token
      ) {
        throw new MTNCollectionError(
          'MTN access token is unavailable.',
          ERROR_CODES.AUTHENTICATION_FAILED
        );
      }

      await this.audit(
        'MTN_COLLECTION_SUBMISSION_STARTED',
        normalized,
        {
          transactionId:
            normalized.transactionId,

          type:
            normalized.type,

          amount:
            normalized.amount,

          currency:
            normalized.currency
        }
      );

      /*
       * Provider submission.
       */
      const {
        response,
        normalized:
          provider
      } =
        await this.submitProviderRequest(
          normalized,
          providerPayload,
          token
        );

      /*
       * Provider response classification.
       */
      if (
        provider.outcome ===
        PROVIDER_OUTCOMES.UNKNOWN
      ) {
        /*
         * An unknown response must never be translated into SETTLED or
         * SUCCESS. Reconciliation/recovery owns convergence.
         */
        const transitioned =
          await this.transitionTransaction(
            transaction,
            COLLECTION_STATUSES.REQUIRES_RECONCILIATION,
            normalized,
            {
              reason:
                'MTN provider response could not be conclusively classified.',

              providerReference:
                provider.providerReference,

              providerStatus:
                provider.providerStatus
            }
          );

        this.statistics.pending +=
          1;

        await this.audit(
          'MTN_COLLECTION_REQUIRES_RECONCILIATION',
          normalized,
          {
            transactionId:
              normalized.transactionId,

            providerReference:
              provider.providerReference,

            providerStatus:
              provider.providerStatus,

            providerHttpStatus:
              provider.httpStatus
          }
        );

        return {
          success:
            false,

          pending:
            false,

          requiresReconciliation:
            true,

          reference:
            normalized.reference,

          transactionId:
            normalized.transactionId,

          status:
            transitioned?.status ||
            COLLECTION_STATUSES.REQUIRES_RECONCILIATION,

          providerReference:
            provider.providerReference,

          correlationId:
            normalized.correlationId
        };
      }

      /*
       * Permanent provider failure.
       */
      if (
        provider.outcome ===
        PROVIDER_OUTCOMES.FAILED
      ) {
        const transitioned =
          await this.transitionTransaction(
            transaction,
            COLLECTION_STATUSES.FAILED,
            normalized,
            {
              reason:
                'MTN rejected collection request.',

              providerReference:
                provider.providerReference,

              providerStatus:
                provider.providerStatus
            }
          );

        this.statistics.failed +=
          1;

        await this.audit(
          'MTN_COLLECTION_FAILED',
          normalized,
          {
            transactionId:
              normalized.transactionId,

            providerReference:
              provider.providerReference,

            providerStatus:
              provider.providerStatus,

            providerHttpStatus:
              provider.httpStatus
          }
        );

        return {
          success:
            false,

          reference:
            normalized.reference,

          transactionId:
            normalized.transactionId,

          status:
            transitioned?.status ||
            COLLECTION_STATUSES.FAILED,

          providerReference:
            provider.providerReference,

          correlationId:
            normalized.correlationId
        };
      }

      /*
       * Provider accepted or is pending.
       */
      const targetStatus =
        provider.accepted
          ? COLLECTION_STATUSES.PROVIDER_ACCEPTED
          : COLLECTION_STATUSES.PENDING_PROVIDER;

      const transitioned =
        await this.transitionTransaction(
          transaction,
          targetStatus,
          normalized,
          {
            reason:
              provider.accepted
                ? 'MTN accepted Request-to-Pay initiation.'
                : 'MTN collection remains pending.',

            providerReference:
              provider.providerReference,

            providerStatus:
              provider.providerStatus
          }
        );

      /*
       * Register callback/settlement correlation after provider acceptance.
       */
      await this.registerSettlement(
        normalized,
        provider
      );

      /*
       * If provider accepted the initiation, the transaction is still not
       * financially settled. The callback/reconciliation path must establish
       * final state.
       */
      const finalStatus =
        provider.accepted
          ? COLLECTION_STATUSES.PENDING_CALLBACK
          : COLLECTION_STATUSES.PENDING_PROVIDER;

      /*
       * Some transaction services expose canonical callback-pending status.
       * Use it only if their state machine permits it; otherwise retain the
       * provider-accepted state as the internal result.
       */
      let resultingStatus =
        transitioned?.status ||
        targetStatus;

      if (
        provider.accepted
      ) {
        try {
          const callbackPending =
            await this.transitionTransaction(
              {
                ...transaction,

                status:
                  resultingStatus
              },
              finalStatus,
              normalized,
              {
                reason:
                  'Awaiting authoritative MTN callback.'
              }
            );

          resultingStatus =
            callbackPending?.status ||
            finalStatus;
        } catch (
          transitionError
        ) {
          /*
           * The provider request has already been accepted. Do not fabricate
           * a failed financial result because a local presentation/status
           * transition is unavailable. The settlement/recovery layer can
           * reconcile from provider reference.
           */
          this.logger.warn?.(
            {
              provider:
                'MTN',

              tenantId:
                normalized.tenantId,

              reference:
                normalized.reference,

              transactionId:
                normalized.transactionId,

              error:
                serializeError(
                  transitionError
                )
            },
            'Unable to transition MTN collection to callback-pending state'
          );
        }
      }

      const result = {
        success:
          true,

        accepted:
          provider.accepted,

        pending:
          true,

        reference:
          normalized.reference,

        transactionId:
          normalized.transactionId,

        providerReference:
          provider.providerReference,

        providerStatus:
          provider.providerStatus,

        status:
          resultingStatus,

        correlationId:
          normalized.correlationId,

        idempotencyKey:
          normalized.idempotencyKey
      };

      await this.registerIdempotency(
        normalized,
        result
      );

      await this.audit(
        'MTN_COLLECTION_INITIATED',
        normalized,
        {
          transactionId:
            normalized.transactionId,

          providerReference:
            provider.providerReference,

          providerStatus:
            provider.providerStatus,

          status:
            resultingStatus,

          amount:
            normalized.amount,

          currency:
            normalized.currency
        }
      );

      try {
        await this.publishCollectionEvent(
          normalized,
          {
            ...transaction,

            id:
              normalized.transactionId,

            status:
              resultingStatus
          },
          provider
        );
      } catch (
        eventError
      ) {
        /*
         * A direct event publication failure must not be mistaken for
         * financial failure. In a fully transactional deployment this should
         * be handled by the outbox service.
         */
        this.logger.error?.(
          {
            provider:
              'MTN',

            tenantId:
              normalized.tenantId,

            reference:
              normalized.reference,

            transactionId:
              normalized.transactionId,

            error:
              serializeError(
                eventError
              )
          },
          'MTN collection event publication failed'
        );

        this.metrics?.counter?.(
          'payment_mtn_collection_event_failure_total',
          {
            tenantId:
              normalized.tenantId
          }
        );
      }

      this.statistics.accepted +=
        1;

      this.metrics?.counter?.(
        'payment_mtn_collection_success_total',
        {
          tenantId:
            normalized.tenantId
        }
      );

      return result;
    } catch (
      error
    ) {
      const normalizedError =
        normalizeCollectionError(
          error
        );

      if (
        normalizedError.rejected
      ) {
        this.statistics.rejected +=
          1;

        this.metrics?.counter?.(
          'payment_mtn_collection_rejected_total',
          {
            tenantId:
              normalized?.tenantId
          }
        );
      } else {
        this.statistics.failed +=
          1;

        this.metrics?.counter?.(
          'payment_mtn_collection_failure_total',
          {
            tenantId:
              normalized?.tenantId
          }
        );
      }

      /*
       * If an internal transaction was already created, attempt to preserve
       * its failure state. This is intentionally best-effort and must never
       * create a second financial mutation.
       */
      if (
        normalized?.transactionId &&
        normalized?.tenantId
      ) {
        try {
          await this.transitionTransaction(
            {
              id:
                normalized.transactionId,

              status:
                COLLECTION_STATUSES.CREATED
            },
            COLLECTION_STATUSES.FAILED,
            normalized,
            {
              reason:
                normalizedError.message,

              errorCode:
                normalizedError.code
            }
          );
        } catch (
          transitionError
        ) {
          this.logger.error?.(
            {
              provider:
                'MTN',

              tenantId:
                normalized.tenantId,

              reference:
                normalized.reference,

              transactionId:
                normalized.transactionId,

              error:
                serializeError(
                  transitionError
                )
            },
            'Failed to preserve MTN collection failure state'
          );
        }
      }

      if (
        normalized
      ) {
        await this.audit(
          'MTN_COLLECTION_FAILED',
          normalized,
          {
            transactionId:
              normalized.transactionId,

            errorCode:
              normalizedError.code,

            retryable:
              normalizedError.retryable
          }
        );
      }

      this.logger.error?.(
        {
          provider:
            'MTN',

          tenantId:
            normalized?.tenantId,

          reference:
            normalized?.reference,

          transactionId:
            normalized?.transactionId,

          correlationId:
            normalized?.correlationId,

          error:
            serializeError(
              normalizedError
            )
        },
        'MTN collection failed'
      );

      throw normalizedError;
    } finally {
      span?.setAttribute?.(
        'payment.provider',
        'MTN'
      );

      span?.setAttribute?.(
        'payment.operation',
        'collection'
      );

      span?.end?.();
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Query                                                                    */
  /* ------------------------------------------------------------------------ */

  async query(
    reference,
    optionsArg = {}
  ) {
    const normalizedReference =
      normalizeReference(
        reference
      );

    const tenantId =
      normalizeId(
        optionsArg.tenantId
      );

    if (
      !tenantId
    ) {
      throw new MTNCollectionError(
        'tenantId is required when querying a collection.',
        ERROR_CODES.TENANT_REQUIRED,
        undefined,
        {
          httpStatus:
            400
        }
      );
    }

    if (
      !this.callbackCorrelation
    ) {
      throw new MTNCollectionError(
        'Callback correlation service is not configured.',
        ERROR_CODES.CALLBACK_CORRELATION_FAILED
      );
    }

    if (
      typeof this
        .callbackCorrelation
        .correlate !==
      'function'
    ) {
      throw new MTNCollectionError(
        'Callback correlation service does not support correlate().',
        ERROR_CODES.CALLBACK_CORRELATION_FAILED
      );
    }

    const result =
      await this.callbackCorrelation.correlate(
        {
          tenantId,

          externalId:
            normalizedReference
        }
      );

    /*
     * Preserve provider/internally authoritative status. Do not rewrite
     * "pending" into "successful" merely because a record exists.
     */
    return {
      tenantId,

      reference:
        normalizedReference,

      result
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Health                                                                   */
  /* ------------------------------------------------------------------------ */

  health() {
    const dependencies = {
      authService:
        Boolean(
          this.authService
        ),

      httpClient:
        Boolean(
          this.httpClient
        ),

      configuration:
        Boolean(
          this.configuration
        ),

      transactionBuilder:
        Boolean(
          this.transactionBuilder
        ),

      transactionService:
        Boolean(
          this.transactionService
        ),

      idempotencyManager:
        Boolean(
          this.idempotencyManager
        ),

      fraudGuard:
        Boolean(
          this.fraudGuard
        ),

      stateMachine:
        Boolean(
          this.stateMachine
        ),

      settlementTracker:
        Boolean(
          this.settlementTracker
        ),

      callbackCorrelation:
        Boolean(
          this.callbackCorrelation
        ),

      auditService:
        Boolean(
          this.auditService
        ),

      outboxService:
        Boolean(
          this.outboxService
        ),

      eventPublisher:
        Boolean(
          this.eventPublisher
        )
    };

    const required =
      dependencies.authService &&
      dependencies.httpClient &&
      dependencies.configuration &&
      dependencies.transactionBuilder &&
      (
        dependencies.transactionService ||
        dependencies.stateMachine
      );

    return {
      provider:
        'MTN',

      module:
        'collections',

      status:
        required
          ? 'UP'
          : 'DOWN',

      requiredDependenciesReady:
        required,

      dependencies,

      statistics: {
        ...this.statistics
      },

      configuration: {
        timeoutMs:
          this.config.timeoutMs,

        maxRetries:
          this.config.maxRetries,

        requireTenant:
          this.config.requireTenant,

        useOutbox:
          this.config.useOutbox
      }
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Diagnostics                                                              */
  /* ------------------------------------------------------------------------ */

  diagnostics() {
    return sanitize({
      provider:
        'MTN',

      module:
        'collections',

      statistics:
        this.statistics,

      configuration: {
        timeoutMs:
          this.config.timeoutMs,

        maxRetries:
          this.config.maxRetries,

        requireTenant:
          this.config.requireTenant,

        useOutbox:
          this.config.useOutbox
      }
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Configuration                                                            */
  /* ------------------------------------------------------------------------ */

  targetEnvironment() {
    if (
      typeof this
        .configuration
        ?.get ===
      'function'
    ) {
      const config =
        this.configuration.get() ||
        {};

      return (
        normalizeString(
          config.environment,
          128
        ) ||
        normalizeString(
          config.targetEnvironment,
          128
        )
      );
    }

    if (
      typeof this
        .configuration
        ?.getEnvironment ===
      'function'
    ) {
      return normalizeString(
        this.configuration.getEnvironment(),
        128
      );
    }

    return undefined;
  }

  subscriptionKey() {
    if (
      typeof this
        .configuration
        ?.get ===
      'function'
    ) {
      const config =
        this.configuration.get() ||
        {};

      return normalizeString(
        config.subscriptionKey ||
          config.mtnSubscriptionKey,
        512
      );
    }

    return undefined;
  }

  collectionEndpoint() {
    let endpoints;

    if (
      typeof this
        .configuration
        ?.getEndpoints ===
      'function'
    ) {
      endpoints =
        this.configuration.getEndpoints() ||
        {};
    }

    const collection =
      normalizeString(
        endpoints?.collection,
        1024
      );

    if (
      !collection
    ) {
      throw new MTNCollectionError(
        'MTN collection endpoint is not configured.',
        ERROR_CODES.CONFIGURATION_ERROR
      );
    }

    /*
     * Allow either:
     *   https://host/v1_0/requesttopay
     * or:
     *   https://host/v1_0
     *
     * without blindly appending /requesttopay twice.
     */
    return /\/requesttopay\/?$/.test(
      collection
    )
      ? collection
      : `${collection.replace(
          /\/+$/,
          ''
        )}/requesttopay`;
  }
}

/* -------------------------------------------------------------------------- */
/* Dependency / error helpers                                                 */
/* -------------------------------------------------------------------------- */

function requireDependency(
  dependency,
  name
) {
  if (
    !dependency
  ) {
    throw new MTNCollectionError(
      `${name} dependency is not configured.`,
      ERROR_CODES.CONFIGURATION_ERROR,
      {
        dependency:
          name
      }
    );
  }
}

function normalizeCollectionError(
  error
) {
  if (
    error instanceof
    MTNCollectionError
  ) {
    return error;
  }

  const message =
    normalizeString(
      error?.message,
      1000
    ) ||
    'MTN collection failed.';

  const providerStatus =
    error?.response?.status ||
    error?.providerStatus;

  const retryable =
    Boolean(
      error?.retryable
    ) ||
    isTransientStatus(
      providerStatus
    ) ||
    /timeout|temporar|unavailable|ECONNRESET|ECONNREFUSED/i.test(
      message
    );

  return new MTNCollectionError(
    message,
    error?.code ||
      ERROR_CODES.PROVIDER_REQUEST_FAILED,
    undefined,
    {
      retryable,
      httpStatus:
        Number.isFinite(
          error?.httpStatus
        )
          ? error.httpStatus
          : undefined,

      providerStatus,
      providerCode:
        error?.providerCode
    }
  );
}

/* -------------------------------------------------------------------------- */
/* Export                                                                     */
/* -------------------------------------------------------------------------- */

module.exports =
  MTNCollections;

module.exports.MTNCollections =
  MTNCollections;

module.exports.MTNCollectionError =
  MTNCollectionError;

module.exports.COLLECTION_TYPES =
  COLLECTION_TYPES;

module.exports.COLLECTION_STATUSES =
  COLLECTION_STATUSES;

module.exports.PROVIDER_OUTCOMES =
  PROVIDER_OUTCOMES;

module.exports.ERROR_CODES =
  ERROR_CODES;