/**
 * ============================================================================
 * MTN MOMO SERVICE
 * ============================================================================
 *
 * TITech Community Capital LTD
 *
 * Production-grade MTN Mobile Money provider integration.
 *
 * Responsibilities:
 *
 *  - OAuth authentication
 *  - Collections
 *  - Withdrawals / Disbursements
 *  - Loan Repayments
 *  - Savings Contributions
 *  - Bulk Disbursements
 *  - Transaction Queries
 *  - Webhook Processing
 *  - Reconciliation
 *  - Settlement Handoff
 *  - Loan Accounting Handoff
 *  - Ledger Integration Hooks
 *  - Audit Logging
 *  - Retry Management
 *  - Dead-letter Hooks
 *  - Idempotency Protection
 *  - Provider Transaction State Management
 *  - Provider/Internal Reference Correlation
 *
 * Financial Integrity Rules:
 *
 *  1. Provider requests are idempotent.
 *  2. Provider references are immutable.
 *  3. PENDING provider requests do not post financial ledger entries.
 *  4. Ledger/accounting posting occurs only after successful provider state.
 *  5. Provider settlement is recorded separately from payment initiation.
 *  6. Duplicate callbacks are safely ignored.
 *  7. Reversals are represented as new financial events.
 *  8. No balance is directly mutated by this service.
 *  9. Financial posting flows through the existing Ledger Engine.
 * 10. In-memory caches are never authoritative financial storage.
 * 11. Ambiguous provider outcomes are never automatically treated as failure.
 * 12. Provider references are never overwritten once established.
 *
 * IMPORTANT:
 *
 *  - No architectural restructuring.
 *  - Existing public methods are preserved.
 *  - Existing settlement lifecycle remains recordSettlement().
 *  - Existing loan accounting remains recordRepayment().
 *  - Existing Ledger Engine remains authoritative.
 *
 * ============================================================================
 */

"use strict";

const axios = require("axios");
const crypto = require("crypto");
const PaymentProviderInterface = require("./paymentProviderInterface");

const {
  MTNCallbackRegistry,
  MTNCallbackNormalizer,
  MTNCallbackValidator,
  MTNCallbackProcessor,
  MTNCallbackIdempotency,
  MTNCallbackDeadLetter,
} = require('./payments/mtn/callbacks');

/**
 * ============================================================================
 * OPTIONAL DEPENDENCIES
 * ============================================================================
 */

let logger;
let auditService;
let reconciliationService;
let settlementService;
let loanAccountingService;
let ledgerService;
let Transaction;
let queueService;

try {
  logger = require("./logger");
} catch {
  logger = console;
}

try {
  auditService = require("./auditService");
} catch {
  auditService = null;
}

try {
  reconciliationService = require("./reconciliationService");
} catch {
  reconciliationService = null;
}

try {
  settlementService = require("./mobileMoneySettlementService");
} catch {
  settlementService = null;
}

try {
  loanAccountingService = require("./loanAccountingService");
} catch {
  loanAccountingService = null;
}

try {
  ledgerService = require("./finance/services/ledgerService");
} catch {
  ledgerService = null;
}

try {
  Transaction = require("../models/Transaction");
} catch {
  try {
    Transaction = require("./finance/models/Transaction");
  } catch {
    Transaction = null;
  }
}

try {
  queueService = require("./queueService");
} catch {
  queueService = null;
}

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const PROVIDER = "MTN_MOMO";

const TRANSACTION_STATUS = Object.freeze({
  CREATED: "CREATED",
  PENDING: "PENDING",
  SUCCESSFUL: "SUCCESSFUL",
  FAILED: "FAILED",
  REVERSED: "REVERSED",
  UNKNOWN: "UNKNOWN",
});

const OPERATION = Object.freeze({
  COLLECTION: "COLLECTION",
  DISBURSEMENT: "DISBURSEMENT",
});

const TRANSIENT_HTTP_STATUS_CODES = new Set([
  408,
  425,
  429,
  500,
  502,
  503,
  504,
]);

const SUCCESS_PROVIDER_STATUSES = new Set([
  "SUCCESSFUL",
  "SUCCESS",
  "COMPLETED",
  "COMPLETED_SUCCESSFULLY",
]);

const FAILED_PROVIDER_STATUSES = new Set([
  "FAILED",
  "FAILURE",
  "REJECTED",
  "CANCELLED",
  "CANCELED",
]);

const PENDING_PROVIDER_STATUSES = new Set([
  "PENDING",
  "PROCESSING",
  "IN_PROGRESS",
]);

const NON_RETRYABLE_PROVIDER_STATUSES = new Set([
  "REJECTED",
  "CANCELLED",
  "CANCELED",
  "FAILED",
]);

const POSTING_STATUS = Object.freeze({
  NOT_POSTED: "NOT_POSTED",
  PROCESSING: "PROCESSING",
  POSTED: "POSTED",
  FAILED: "FAILED",
});

const MAX_RETRY_DELAY_MS = 30000;

const DEFAULT_CURRENCY = "UGX";

/**
 * ============================================================================
 * ERROR CLASS
 * ============================================================================
 */

class MTNMomoError extends Error {
  constructor(message, options = {}) {
    super(message);

    this.name = "MTNMomoError";

    this.code =
      options.code ||
      "MTN_MOMO_ERROR";

    this.statusCode =
      options.statusCode ||
      null;

    this.provider =
      PROVIDER;

    this.operation =
      options.operation ||
      null;

    this.reference =
      options.reference ||
      null;

    this.providerReference =
      options.providerReference ||
      null;

    this.correlationId =
      options.correlationId ||
      null;

    this.retryable =
      Boolean(options.retryable);

    this.retryAfterMs =
      Number.isFinite(options.retryAfterMs)
        ? options.retryAfterMs
        : null;

    this.providerResponse =
      options.providerResponse ||
      null;

    this.cause =
      options.cause;

    Error.captureStackTrace?.(
      this,
      MTNMomoError
    );
  }

  /**
 * ==========================================================================
 * CALLBACK PIPELINE
 * ==========================================================================
 *
 * mtnMomoService remains the provider-facing edge.
 *
 * Durable callback processing is delegated to independently testable
 * callback components.
 * ==========================================================================
 */

this.callbackNormalizer =
  config.callbackNormalizer ||
  new MTNCallbackNormalizer({
    provider: PROVIDER,
  });

this.callbackValidator =
  config.callbackValidator ||
  new MTNCallbackValidator({
    provider: PROVIDER,

    /**
     * Some MTN callbacks may omit amount depending on the callback path.
     * Transaction persistence remains authoritative for amount resolution.
     */
    requireAmount:
      false,
  });

this.callbackIdempotency =
  config.callbackIdempotency ||
  new MTNCallbackIdempotency({
    model:
      config.callbackIdempotencyModel ||
      null,

    cache:
      this.idempotencyCache,

    ttlMs:
      this.idempotencyTtlSeconds *
      1000,
  });

this.callbackDeadLetter =
  config.callbackDeadLetter ||
  new MTNCallbackDeadLetter({
    queueService,

    queueName:
      config.callbackDlqName ||
      process.env.MTN_MOMO_CALLBACK_DLQ_NAME ||
      'mtn-momo-callback-dlq',
  });

this.callbackProcessor =
  config.callbackProcessor ||
  new MTNCallbackProcessor({
    logger,

    idempotency:
      this.callbackIdempotency,

    deadLetter:
      this.callbackDeadLetter,

    transactionResolver:
      async (
        callback
      ) =>
        this.findTransaction(
          callback.reference ||
          callback.providerReference
        ),

    stateHandler:
      async (
        callback
      ) => {
        const reference =
          callback.reference ||
          callback.providerReference;

        await this.transitionTransaction(
          reference,
          callback.status,
          {
            providerReference:
              callback.providerReference,

            providerStatus:
              callback.providerStatus,

            callbackId:
              callback.callbackId,

            webhookPayload:
              callback.rawPayload,
          }
        );
      },

    successHandler:
      async (
        callback,
        transaction
      ) =>
        this.handleSuccessfulTransaction(
          {
            reference:
              callback.reference ||
              callback.providerReference,

            providerReference:
              callback.providerReference,

            payload: {
              ...callback.rawPayload,

              amount:
                callback.amount,

              currency:
                callback.currency,

              tenantId:
                callback.tenantId,

              customerId:
                callback.customerId,

              loanId:
                callback.loanId,

              transactionType:
                callback.transactionType,

              callbackId:
                callback.callbackId,
            },

            transaction,
          }
        ),

    failureHandler:
      async (
        callback
      ) =>
        this.handleFailedTransaction(
          {
            reference:
              callback.reference ||
              callback.providerReference,

            providerReference:
              callback.providerReference,

            payload:
              callback.rawPayload,
          }
        ),

    audit:
      (
        action,
        payload
      ) =>
        this.recordAudit(
          action,
          payload
        ),
  });

this.callbackRegistry =
  config.callbackRegistry ||
  new MTNCallbackRegistry({
    logger,
    defaultProvider:
      PROVIDER,
  });

this.callbackRegistry.register(
  PROVIDER,
  {
    normalizer:
      (
        payload,
        context
      ) =>
        this.callbackNormalizer.normalize(
          payload,
          context
        ),

    validator:
      (
        callback,
        context
      ) =>
        this.callbackValidator.validate(
          callback,
          context
        ),

    processor:
      (
        callback,
        context
      ) =>
        this.callbackProcessor.process(
          callback,
          context
        ),

    idempotency:
      this.callbackIdempotency,

    deadLetter:
      this.callbackDeadLetter,
  }
);

}

/**
 * ============================================================================
 * SERVICE
 * ============================================================================
 */

class MTNMomoService extends PaymentProviderInterface {
  constructor(config = {}) {
    super({
      providerName: PROVIDER,
      ...config,
    });

    /**
     * ------------------------------------------------------------------------
     * Provider configuration
     * ------------------------------------------------------------------------
     */

    this.baseUrl =
      config.baseUrl ||
      process.env.MTN_MOMO_BASE_URL;

    this.subscriptionKey =
      config.subscriptionKey ||
      process.env.MTN_MOMO_SUBSCRIPTION_KEY;

    this.apiUser =
      config.apiUser ||
      process.env.MTN_MOMO_API_USER;

    this.apiKey =
      config.apiKey ||
      process.env.MTN_MOMO_API_KEY;

    this.callbackHost =
      config.callbackHost ||
      process.env.MTN_CALLBACK_HOST ||
      null;

    this.targetEnvironment =
      config.targetEnvironment ||
      process.env.MTN_MOMO_TARGET_ENVIRONMENT ||
      "mtnuganda";

    this.webhookSecret =
      config.webhookSecret ||
      process.env.MTN_MOMO_WEBHOOK_SECRET ||
      null;

    this.webhookVerifier =
      config.webhookVerifier ||
      null;

    this.reversalHandler =
      config.reversalHandler ||
      null;

    /**
     * ------------------------------------------------------------------------
     * HTTP configuration
     * ------------------------------------------------------------------------
     */

    this.requestTimeoutMs =
      Number(
        config.requestTimeoutMs ||
        process.env.MTN_MOMO_REQUEST_TIMEOUT_MS ||
        60000
      );

    this.authTimeoutMs =
      Number(
        config.authTimeoutMs ||
        process.env.MTN_MOMO_AUTH_TIMEOUT_MS ||
        30000
      );

    this.maxRetries =
      Math.max(
        0,
        Number(
          config.maxRetries ||
          process.env.MTN_MOMO_MAX_RETRIES ||
          3
        )
      );

    this.retryBaseDelayMs =
      Math.max(
        50,
        Number(
          config.retryBaseDelayMs ||
          process.env.MTN_MOMO_RETRY_BASE_DELAY_MS ||
          500
        )
      );

    /**
     * Refresh token before provider expiration.
     */
    this.tokenSafetyWindowMs =
      Math.max(
        5000,
        Number(
          config.tokenSafetyWindowMs ||
          process.env.MTN_MOMO_TOKEN_SAFETY_WINDOW_MS ||
          60000
        )
      );

    /**
     * ------------------------------------------------------------------------
     * Bulk processing
     * ------------------------------------------------------------------------
     */

    this.bulkConcurrency =
      Math.max(
        1,
        Number(
          config.bulkConcurrency ||
          process.env.MTN_MOMO_BULK_CONCURRENCY ||
          5
        )
      );

    /**
     * ------------------------------------------------------------------------
     * Financial behaviour
     * ------------------------------------------------------------------------
     */

    this.requireTransactionPersistence =
      config.requireTransactionPersistence !== undefined
        ? Boolean(
          config.requireTransactionPersistence
        )
        : false;

    this.enableLedgerPosting =
      config.enableLedgerPosting !== undefined
        ? Boolean(
          config.enableLedgerPosting
        )
        : true;

    this.enableSettlementPosting =
      config.enableSettlementPosting !== undefined
        ? Boolean(
          config.enableSettlementPosting
        )
        : true;

    this.enableLoanAccounting =
      config.enableLoanAccounting !== undefined
        ? Boolean(
          config.enableLoanAccounting
        )
        : true;

    this.enableQueueRetries =
      config.enableQueueRetries !== undefined
        ? Boolean(
          config.enableQueueRetries
        )
        : true;

    this.enableDeadLetterQueue =
      config.enableDeadLetterQueue !== undefined
        ? Boolean(
          config.enableDeadLetterQueue
        )
        : true;

    this.idempotencyTtlSeconds =
      Math.max(
        60,
        Number(
          config.idempotencyTtlSeconds ||
          process.env.MTN_MOMO_IDEMPOTENCY_TTL_SECONDS ||
          24 * 60 * 60
        )
      );

    /**
     * Require verified webhooks before financial side effects.
     *
     * Default remains false for backwards compatibility, but production
     * deployments should enable this when their callback security contract
     * supports cryptographic verification.
     */
    this.requireVerifiedWebhooks =
      config.requireVerifiedWebhooks !== undefined
        ? Boolean(
          config.requireVerifiedWebhooks
        )
        : false;

    /**
     * ------------------------------------------------------------------------
     * Runtime state
     * ------------------------------------------------------------------------
     */

    this.token = null;

    this.tokenExpiry = null;

    this.authenticationPromise = null;

    /**
     * Provider/internal correlation.
     *
     * These are fallbacks only.
     * Durable Transaction storage remains authoritative.
     */
    this.referenceCache = new Map();

    this.idempotencyCache = new Map();

    this.stateCache = new Map();

    /**
     * Used to prevent duplicate processing inside a single Node process.
     *
     * This is NOT a distributed lock.
     */
    this.processingLocks = new Map();

    /**
     * ------------------------------------------------------------------------
     * Metrics
     * ------------------------------------------------------------------------
     */

    this.metrics = this.createInitialMetrics();
  }

  /**
   * ==========================================================================
   * METRICS INITIALIZATION
   * ==========================================================================
   */

  createInitialMetrics() {
    return {
      authenticationSuccess: 0,
      authenticationFailures: 0,
      authenticationRefreshes: 0,

      requests: 0,
      requestFailures: 0,
      requestRetries: 0,

      collectionRequests: 0,
      collectionSuccesses: 0,
      collectionFailures: 0,

      disbursementRequests: 0,
      disbursementSuccesses: 0,
      disbursementFailures: 0,

      webhooksReceived: 0,
      webhooksProcessed: 0,
      duplicateWebhooks: 0,
      webhookFailures: 0,
      webhookVerificationFailures: 0,

      statusQueries: 0,
      statusFailures: 0,

      settlementsRecorded: 0,
      settlementFailures: 0,

      ledgerPosts: 0,
      ledgerFailures: 0,

      accountingPosts: 0,
      accountingFailures: 0,

      reconciliations: 0,
      reconciliationFailures: 0,

      retriesQueued: 0,
      retriesRejected: 0,

      deadLettersQueued: 0,
      deadLetterFailures: 0,

      reversals: 0,

      duplicateFinancialPostings: 0,
      financialPostingFailures: 0,

      failures: 0,

      startedAt:
        new Date().toISOString(),
    };
  }

  /**
   * ==========================================================================
   * CONFIGURATION
   * ==========================================================================
   */

  validateConfiguration() {
    const missing = [];

    if (!this.baseUrl) {
      missing.push(
        "MTN_MOMO_BASE_URL"
      );
    }

    if (!this.subscriptionKey) {
      missing.push(
        "MTN_MOMO_SUBSCRIPTION_KEY"
      );
    }

    if (!this.apiUser) {
      missing.push(
        "MTN_MOMO_API_USER"
      );
    }

    if (!this.apiKey) {
      missing.push(
        "MTN_MOMO_API_KEY"
      );
    }

    if (missing.length > 0) {
      throw new MTNMomoError(
        `MTN MoMo configuration incomplete: ${missing.join(
          ", "
        )}`,
        {
          code:
            "MTN_CONFIGURATION_ERROR",
        }
      );
    }

    return true;
  }

  /**
   * ==========================================================================
   * CORRELATION IDS
   * ==========================================================================
   */

  generateCorrelationId() {
    return crypto.randomUUID();
  }

  generateReference() {
    return crypto.randomUUID();
  }

  generateExternalId() {
    return crypto.randomUUID();
  }

  resolveCorrelationId(
    options = {}
  ) {
    return (
      options.correlationId ||
      options.requestId ||
      this.generateCorrelationId()
    );
  }

  /**
   * ==========================================================================
   * TOKEN MANAGEMENT
   * ==========================================================================
   */

  isTokenValid() {
    return Boolean(
      this.token &&
      this.tokenExpiry &&
      Date.now() <
      this.tokenExpiry
    );
  }

  invalidateToken() {
    this.token = null;
    this.tokenExpiry = null;
  }

  async authenticate(
    options = {}
  ) {
    if (
      this.isTokenValid()
    ) {
      return this.token;
    }

    if (
      this.authenticationPromise
    ) {
      return this.authenticationPromise;
    }

    const correlationId =
      this.resolveCorrelationId(
        options
      );

    this.authenticationPromise =
      this._authenticate({
        correlationId,
      });

    try {
      return await this.authenticationPromise;
    } finally {
      this.authenticationPromise =
        null;
    }
  }

  async _authenticate(
    options = {}
  ) {
    const correlationId =
      this.resolveCorrelationId(
        options
      );

    try {
      this.validateConfiguration();

      const credentials =
        Buffer.from(
          `${this.apiUser}:${this.apiKey}`
        ).toString("base64");

      const response =
        await axios.post(
          `${this.baseUrl}/collection/token/`,
          {},
          {
            headers: {
              Authorization:
                `Basic ${credentials}`,

              "Ocp-Apim-Subscription-Key":
                this.subscriptionKey,

              "X-Target-Environment":
                this.targetEnvironment,

              "X-Correlation-ID":
                correlationId,
            },

            timeout:
              this.authTimeoutMs,
          }
        );

      const accessToken =
        response?.data?.access_token;

      if (!accessToken) {
        throw new MTNMomoError(
          "MTN MoMo authentication response did not contain an access token.",
          {
            code:
              "MTN_AUTH_TOKEN_MISSING",
            correlationId,
          }
        );
      }

      const expiresInSeconds =
        Number(
          response?.data?.expires_in ||
          3600
        );

      const expiresInMs =
        Math.max(
          1000,
          expiresInSeconds * 1000
        );

      const safetyWindow =
        Math.min(
          this.tokenSafetyWindowMs,
          Math.max(
            5000,
            Math.floor(
              expiresInMs / 10
            )
          )
        );

      this.token =
        accessToken;

      this.tokenExpiry =
        Date.now() +
        Math.max(
          1000,
          expiresInMs -
          safetyWindow
        );

      this.metrics
        .authenticationSuccess++;

      this.metrics
        .authenticationRefreshes++;

      await this.recordAudit(
        "AUTHENTICATION_SUCCESS",
        {
          correlationId,
          expiresInSeconds,
          targetEnvironment:
            this.targetEnvironment,
        }
      );

      return this.token;
    } catch (error) {
      this.invalidateToken();

      this.metrics
        .authenticationFailures++;

      const normalized =
        this.normalizeError(
          error,
          "AUTHENTICATION",
          {
            correlationId,
          }
        );

      await this.recordAudit(
        "AUTHENTICATION_FAILED",
        {
          correlationId,
          error:
            normalized.message,
          code:
            normalized.code,
        }
      );

      throw normalized;
    }
  }

  /**
   * ==========================================================================
   * VALIDATION
   * ==========================================================================
   */

  validatePaymentPayload(
    payload = {},
    operation
  ) {
    const errors = [];

    if (
      payload.amount ===
      undefined ||
      payload.amount ===
      null ||
      payload.amount === ""
    ) {
      errors.push(
        "amount is required"
      );
    } else {
      const amount =
        Number(
          payload.amount
        );

      if (
        !Number.isFinite(
          amount
        ) ||
        amount <= 0
      ) {
        errors.push(
          "amount must be a positive number"
        );
      }
    }

    if (
      !payload.phoneNumber
    ) {
      errors.push(
        "phoneNumber is required"
      );
    }

    if (
      operation !==
      OPERATION.COLLECTION &&
      operation !==
      OPERATION.DISBURSEMENT
    ) {
      errors.push(
        "invalid operation"
      );
    }

    if (
      payload.currency &&
      String(
        payload.currency
      ).length !== 3
    ) {
      errors.push(
        "currency must be a valid 3-character ISO currency code"
      );
    }

    if (
      errors.length > 0
    ) {
      throw new MTNMomoError(
        errors.join("; "),
        {
          code:
            "MTN_INVALID_PAYMENT_PAYLOAD",
          operation,
        }
      );
    }

    return true;
  }

  /**
   * ==========================================================================
   * IDEMPOTENCY
   * ==========================================================================
   */

  async ensureIdempotency(
    reference,
    options = {}
  ) {
    if (!reference) {
      throw new MTNMomoError(
        "A transaction reference is required for idempotent processing.",
        {
          code:
            "MTN_REFERENCE_REQUIRED",
        }
      );
    }

    /**
     * Durable transaction lookup.
     */
    if (Transaction) {
      try {
        const existing =
          await this.findTransaction(
            reference
          );

        if (existing) {
          return {
            duplicate: true,
            existing,
          };
        }
      } catch (error) {
        this.loggerWarn(
          "Transaction idempotency lookup failed",
          error
        );

        if (
          this.requireTransactionPersistence
        ) {
          throw new MTNMomoError(
            "Unable to verify transaction idempotency.",
            {
              code:
                "MTN_IDEMPOTENCY_LOOKUP_FAILED",
              reference,
              cause: error,
            }
          );
        }
      }
    }

    /**
     * In-process fallback.
     */
    const cached =
      this.idempotencyCache.get(
        reference
      );

    if (cached) {
      return {
        duplicate: true,
        existing: cached,
      };
    }

    if (
      options.reserve !== false
    ) {
      this.idempotencyCache.set(
        reference,
        {
          reference,
          status:
            TRANSACTION_STATUS.CREATED,
          createdAt:
            new Date().toISOString(),
        }
      );

      this.scheduleIdempotencyCleanup(
        reference
      );
    }

    return {
      duplicate: false,
    };
  }

  scheduleIdempotencyCleanup(
    reference
  ) {
    const ttl =
      this.idempotencyTtlSeconds *
      1000;

    const timer =
      setTimeout(() => {
        this.idempotencyCache.delete(
          reference
        );
      }, ttl);

    timer.unref?.();
  }

  /**
   * ==========================================================================
   * REFERENCE CORRELATION
   * ==========================================================================
   */

  cacheReferenceCorrelation(
    {
      reference,
      providerReference,
      operation,
      tenantId,
      customerId,
      loanId,
    } = {}
  ) {
    if (!reference) {
      return;
    }

    const existing =
      this.referenceCache.get(
        reference
      );

    /**
     * Provider references are immutable.
     */
    if (
      existing?.providerReference &&
      providerReference &&
      existing.providerReference !==
      providerReference
    ) {
      throw new MTNMomoError(
        "Provider reference mutation detected.",
        {
          code:
            "MTN_PROVIDER_REFERENCE_IMMUTATION_VIOLATION",
          reference,
          providerReference,
        }
      );
    }

    this.referenceCache.set(
      reference,
      {
        ...existing,
        reference,
        providerReference:
          providerReference ||
          existing?.providerReference ||
          null,
        operation:
          operation ||
          existing?.operation ||
          null,
        tenantId:
          tenantId ??
          existing?.tenantId ??
          null,
        customerId:
          customerId ??
          existing?.customerId ??
          null,
        loanId:
          loanId ??
          existing?.loanId ??
          null,
        updatedAt:
          new Date().toISOString(),
      }
    );
  }

  async findByProviderReference(
    providerReference
  ) {
    if (
      !providerReference
    ) {
      return null;
    }

    if (
      Transaction
    ) {
      try {
        return await Transaction.findOne(
          {
            provider:
              PROVIDER,
            providerReference,
          }
        );
      } catch (error) {
        this.loggerWarn(
          "Provider reference lookup failed",
          error
        );
      }
    }

    for (
      const state of this.referenceCache.values()
    ) {
      if (
        state.providerReference ===
        providerReference
      ) {
        return (
          this.findTransaction(
            state.reference
          )
        );
      }
    }

    return null;
  }

  /**
   * ==========================================================================
   * TRANSACTION STATE
   * ==========================================================================
   */

  normalizeProviderStatus(
    status
  ) {
    const normalized =
      String(
        status ||
        ""
      )
        .trim()
        .toUpperCase();

    if (
      SUCCESS_PROVIDER_STATUSES.has(
        normalized
      )
    ) {
      return TRANSACTION_STATUS.SUCCESSFUL;
    }

    if (
      FAILED_PROVIDER_STATUSES.has(
        normalized
      )
    ) {
      return TRANSACTION_STATUS.FAILED;
    }

    if (
      PENDING_PROVIDER_STATUSES.has(
        normalized
      )
    ) {
      return TRANSACTION_STATUS.PENDING;
    }

    return TRANSACTION_STATUS.UNKNOWN;
  }

  isValidStateTransition(
    current,
    next
  ) {
    if (!current) {
      return true;
    }

    if (
      current === next
    ) {
      return true;
    }

    const transitions = {
      [TRANSACTION_STATUS.CREATED]:
        new Set([
          TRANSACTION_STATUS.PENDING,
          TRANSACTION_STATUS.FAILED,
          TRANSACTION_STATUS.UNKNOWN,
        ]),

      [TRANSACTION_STATUS.PENDING]:
        new Set([
          TRANSACTION_STATUS.SUCCESSFUL,
          TRANSACTION_STATUS.FAILED,
          TRANSACTION_STATUS.UNKNOWN,
        ]),

      [TRANSACTION_STATUS.SUCCESSFUL]:
        new Set([
          TRANSACTION_STATUS.REVERSED,
        ]),

      [TRANSACTION_STATUS.FAILED]:
        new Set([
          TRANSACTION_STATUS.PENDING,
        ]),

      [TRANSACTION_STATUS.UNKNOWN]:
        new Set([
          TRANSACTION_STATUS.PENDING,
          TRANSACTION_STATUS.SUCCESSFUL,
          TRANSACTION_STATUS.FAILED,
        ]),

      [TRANSACTION_STATUS.REVERSED]:
        new Set([]),
    };

    return Boolean(
      transitions[current]?.has(
        next
      )
    );
  }

  async transitionTransaction(
    reference,
    nextStatus,
    metadata = {}
  ) {
    if (!reference) {
      throw new MTNMomoError(
        "Transaction reference is required.",
        {
          code:
            "MTN_REFERENCE_REQUIRED",
        }
      );
    }

    const current =
      this.stateCache.get(
        reference
      );

    if (
      current &&
      !this.isValidStateTransition(
        current.status,
        nextStatus
      )
    ) {
      /**
       * Late duplicate callbacks are ignored rather than turning an
       * otherwise valid webhook into a processing failure.
       */
      if (
        nextStatus ===
        TRANSACTION_STATUS.PENDING &&
        (
          current.status ===
          TRANSACTION_STATUS.SUCCESSFUL ||
          current.status ===
          TRANSACTION_STATUS.REVERSED
        )
      ) {
        return current;
      }

      throw new MTNMomoError(
        `Invalid transaction state transition: ${current.status} -> ${nextStatus}`,
        {
          code:
            "MTN_INVALID_STATE_TRANSITION",
          reference,
          providerReference:
            metadata.providerReference ||
            current.providerReference,
        }
      );
    }

    const state = {
      ...current,
      reference,
      status:
        nextStatus,
      updatedAt:
        new Date().toISOString(),
      ...metadata,
    };

    this.stateCache.set(
      reference,
      state
    );

    this.cacheReferenceCorrelation({
      reference,
      providerReference:
        metadata.providerReference,
      operation:
        metadata.operation,
      tenantId:
        metadata.tenantId,
      customerId:
        metadata.customerId,
      loanId:
        metadata.loanId,
    });

    if (Transaction) {
      try {
        await Transaction.updateOne(
          {
            $or: [
              {
                reference,
              },
              {
                externalId:
                  reference,
              },
            ],
          },
          {
            $set: {
              status:
                nextStatus,

              provider:
                PROVIDER,

              providerStatus:
                metadata.providerStatus ||
                nextStatus,

              ...(metadata.providerReference
                ? {
                  providerReference:
                    metadata.providerReference,
                }
                : {}),

              updatedAt:
                new Date(),
            },
          },
          {
            upsert: false,
          }
        );
      } catch (error) {
        this.loggerWarn(
          "Transaction state persistence failed",
          error
        );
      }
    }

    return state;
  }

  /**
   * ==========================================================================
   * HTTP HEADERS
   * ==========================================================================
   */

  async createHeaders(
    options = {}
  ) {
    const correlationId =
      this.resolveCorrelationId(
        options
      );

    const token =
      await this.authenticate({
        correlationId,
      });

    const reference =
      options.reference ||
      this.generateReference();

    return {
      Authorization:
        `Bearer ${token}`,

      "Content-Type":
        "application/json",

      Accept:
        "application/json",

      "X-Reference-Id":
        reference,

      "Ocp-Apim-Subscription-Key":
        this.subscriptionKey,

      "X-Target-Environment":
        this.targetEnvironment,

      "X-Correlation-ID":
        correlationId,

      ...(this.callbackHost
        ? {
          "X-Callback-Host":
            this.callbackHost,
        }
        : {}),
    };
  }

  /**
   * ==========================================================================
   * HTTP REQUEST / RETRY ENGINE
   * ==========================================================================
   */

  async request(
    method,
    url,
    options = {}
  ) {
    const correlationId =
      this.resolveCorrelationId(
        options
      );

    const normalizedMethod =
      String(
        method ||
        "GET"
      ).toUpperCase();

    let attempt = 0;

    while (
      attempt <=
      this.maxRetries
    ) {
      try {
        this.metrics.requests++;

        const headers = {
          ...(options.headers || {}),
          "X-Correlation-ID":
            correlationId,
        };

        return await axios.request({
          ...options,

          method:
            normalizedMethod,

          url,

          headers,

          timeout:
            options.timeout ||
            this.requestTimeoutMs,
        });
      } catch (error) {
        /**
         * If an OAuth token was rejected, invalidate it so the next
         * authenticated request obtains a fresh token.
         */
        if (
          error?.response?.status ===
          401
        ) {
          this.invalidateToken();
        }

        const normalized =
          this.normalizeError(
            error,
            options.operation,
            {
              correlationId,
            }
          );

        const shouldRetry =
          normalized.retryable &&
          attempt <
          this.maxRetries;

        if (!shouldRetry) {
          this.metrics
            .requestFailures++;

          throw normalized;
        }

        /**
         * Provider POST operations are safe to retry only when an immutable
         * provider reference/external id is present.
         */
        const isWrite =
          ![
            "GET",
            "HEAD",
            "OPTIONS",
          ].includes(
            normalizedMethod
          );

        const hasIdempotencyReference =
          Boolean(
            options.reference ||
            options.headers?.[
            "X-Reference-Id"
            ] ||
            options.data?.externalId
          );

        if (
          isWrite &&
          !hasIdempotencyReference
        ) {
          this.metrics
            .requestFailures++;

          throw new MTNMomoError(
            "Unsafe retry prevented because the provider write operation has no idempotency reference.",
            {
              code:
                "MTN_UNSAFE_RETRY_BLOCKED",
              operation:
                options.operation,
              correlationId,
              cause: normalized,
            }
          );
        }

        const delay =
          this.calculateRetryDelay(
            attempt,
            normalized
          );

        this.metrics
          .requestRetries++;

        await this.recordAudit(
          "PROVIDER_REQUEST_RETRY",
          {
            correlationId,
            operation:
              options.operation,
            attempt:
              attempt + 1,
            delayMs:
              delay,
            reference:
              options.reference ||
              options.headers?.[
              "X-Reference-Id"
              ] ||
              options.data?.externalId ||
              null,
          }
        );

        await this.sleep(
          delay
        );

        attempt++;
      }
    }

    throw new MTNMomoError(
      "MTN MoMo request exhausted retry attempts.",
      {
        code:
          "MTN_RETRY_EXHAUSTED",
        operation:
          options.operation,
        correlationId,
        retryable: false,
      }
    );
  }

  calculateRetryDelay(
    attempt,
    error
  ) {
    const retryAfter =
      error?.retryAfterMs;

    if (
      Number.isFinite(
        retryAfter
      ) &&
      retryAfter > 0
    ) {
      return Math.min(
        retryAfter,
        MAX_RETRY_DELAY_MS
      );
    }

    const exponential =
      this.retryBaseDelayMs *
      Math.pow(
        2,
        attempt
      );

    const jitter =
      Math.floor(
        Math.random() *
        Math.max(
          100,
          this.retryBaseDelayMs
        )
      );

    return Math.min(
      exponential +
      jitter,
      MAX_RETRY_DELAY_MS
    );
  }

  sleep(ms) {
    return new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          ms
        )
    );
  }

  /**
   * ==========================================================================
   * COLLECTIONS
   * ==========================================================================
   */

  async deposit(
    payload = {}
  ) {
    const {
      amount,
      phoneNumber,
      currency =
      DEFAULT_CURRENCY,
      reference =
      this.generateExternalId(),
      description,
      tenantId = null,
      customerId = null,
      loanId = null,
      savingsAccountId = null,
      metadata = {},
      correlationId =
      this.generateCorrelationId(),
    } = payload;

    this.validatePaymentPayload(
      {
        amount,
        phoneNumber,
        currency,
      },
      OPERATION.COLLECTION
    );

    this.metrics
      .collectionRequests++;

    const idempotency =
      await this.ensureIdempotency(
        reference
      );

    if (
      idempotency.duplicate
    ) {
      return this.buildDuplicateResponse(
        idempotency.existing,
        reference
      );
    }

    const providerReference =
      this.generateReference();

    this.cacheReferenceCorrelation({
      reference,
      providerReference,
      operation:
        OPERATION.COLLECTION,
      tenantId,
      customerId,
      loanId,
    });

    await this.transitionTransaction(
      reference,
      TRANSACTION_STATUS.CREATED,
      {
        providerReference,
        operation:
          OPERATION.COLLECTION,
        tenantId,
        customerId,
        loanId,
        correlationId,
      }
    );

    try {
      const headers =
        await this.createHeaders({
          reference:
            providerReference,
          correlationId,
        });

      const body = {
        amount:
          String(amount),

        currency,

        externalId:
          reference,

        payer: {
          partyIdType:
            "MSISDN",
          partyId:
            phoneNumber,
        },

        payerMessage:
          description ||
          "Savings Deposit",

        payeeNote:
          description ||
          "Savings Deposit",
      };

      const response =
        await this.request(
          "POST",
          `${this.baseUrl}/collection/v1_0/requesttopay`,
          {
            headers,
            data: body,
            operation:
              OPERATION.COLLECTION,
            reference:
              providerReference,
            correlationId,
            timeout:
              this.requestTimeoutMs,
          }
        );

      await this.transitionTransaction(
        reference,
        TRANSACTION_STATUS.PENDING,
        {
          providerReference,
          providerStatus:
            "PENDING",
          amount:
            Number(amount),
          currency,
          tenantId,
          customerId,
          loanId,
          correlationId,
        }
      );

      await this.persistTransactionRequest({
        reference,
        providerReference,
        operation:
          OPERATION.COLLECTION,
        amount:
          Number(amount),
        currency,
        phoneNumber,
        tenantId,
        customerId,
        loanId,
        savingsAccountId,
        description,
        metadata,
        status:
          TRANSACTION_STATUS.PENDING,
        providerResponse:
          response.data,
        correlationId,
      });

      await this.recordAudit(
        "COLLECTION_REQUEST",
        {
          reference,
          providerReference,
          correlationId,
          amount:
            Number(amount),
          currency,
          tenantId,
          customerId,
          loanId,
          savingsAccountId,
        }
      );

      this.metrics
        .collectionSuccesses++;

      return {
        success: true,
        provider:
          PROVIDER,
        reference,
        providerReference,
        externalId:
          reference,
        status:
          TRANSACTION_STATUS.PENDING,
        correlationId,
        response:
          response.data,
      };
    } catch (error) {
      this.metrics
        .collectionFailures++;

      this.metrics.failures++;

      await this.safeTransitionToFailure(
        reference,
        error,
        {
          providerReference,
          correlationId,
        }
      );

      await this.recordAudit(
        "COLLECTION_REQUEST_FAILED",
        {
          reference,
          providerReference,
          correlationId,
          error:
            error.message,
          code:
            error.code,
        }
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * SAVINGS CONTRIBUTION
   * ==========================================================================
   */

  async contributeSavings(
    payload = {}
  ) {
    return this.deposit({
      ...payload,

      description:
        payload.description ||
        "Savings Contribution",

      savingsAccountId:
        payload.savingsAccountId ||
        payload.accountId ||
        null,
    });
  }

  /**
   * ==========================================================================
   * LOAN REPAYMENT
   * ==========================================================================
   */

  async repayLoan(
    payload = {}
  ) {
    if (!payload.loanId) {
      throw new MTNMomoError(
        "loanId is required for loan repayment.",
        {
          code:
            "MTN_LOAN_ID_REQUIRED",
        }
      );
    }

    return this.deposit({
      ...payload,

      description:
        payload.description ||
        "Loan Repayment",
    });
  }

  /**
   * ==========================================================================
   * WITHDRAWALS / DISBURSEMENTS
   * ==========================================================================
   */

  async withdraw(
    payload = {}
  ) {
    return this.disburse(
      payload
    );
  }

  async disburse(
    payload = {}
  ) {
    const {
      amount,
      phoneNumber,
      currency =
      DEFAULT_CURRENCY,
      reference =
      this.generateExternalId(),
      description,
      tenantId = null,
      customerId = null,
      loanId = null,
      metadata = {},
      correlationId =
      this.generateCorrelationId(),
    } = payload;

    this.validatePaymentPayload(
      {
        amount,
        phoneNumber,
        currency,
      },
      OPERATION.DISBURSEMENT
    );

    this.metrics
      .disbursementRequests++;

    const idempotency =
      await this.ensureIdempotency(
        reference
      );

    if (
      idempotency.duplicate
    ) {
      return this.buildDuplicateResponse(
        idempotency.existing,
        reference
      );
    }

    const providerReference =
      this.generateReference();

    this.cacheReferenceCorrelation({
      reference,
      providerReference,
      operation:
        OPERATION.DISBURSEMENT,
      tenantId,
      customerId,
      loanId,
    });

    await this.transitionTransaction(
      reference,
      TRANSACTION_STATUS.CREATED,
      {
        providerReference,
        operation:
          OPERATION.DISBURSEMENT,
        tenantId,
        customerId,
        loanId,
        correlationId,
      }
    );

    try {
      const headers =
        await this.createHeaders({
          reference:
            providerReference,
          correlationId,
        });

      const body = {
        amount:
          String(amount),

        currency,

        externalId:
          reference,

        payee: {
          partyIdType:
            "MSISDN",
          partyId:
            phoneNumber,
        },

        payerMessage:
          description ||
          "Disbursement",

        payeeNote:
          description ||
          "Disbursement",
      };

      const response =
        await this.request(
          "POST",
          `${this.baseUrl}/disbursement/v1_0/transfer`,
          {
            headers,
            data: body,
            operation:
              OPERATION.DISBURSEMENT,
            reference:
              providerReference,
            correlationId,
            timeout:
              this.requestTimeoutMs,
          }
        );

      await this.transitionTransaction(
        reference,
        TRANSACTION_STATUS.PENDING,
        {
          providerReference,
          providerStatus:
            "PENDING",
          amount:
            Number(amount),
          currency,
          tenantId,
          customerId,
          loanId,
          correlationId,
        }
      );

      await this.persistTransactionRequest({
        reference,
        providerReference,
        operation:
          OPERATION.DISBURSEMENT,
        amount:
          Number(amount),
        currency,
        phoneNumber,
        tenantId,
        customerId,
        loanId,
        description,
        metadata,
        status:
          TRANSACTION_STATUS.PENDING,
        providerResponse:
          response.data,
        correlationId,
      });

      await this.recordAudit(
        "DISBURSEMENT_REQUEST",
        {
          reference,
          providerReference,
          correlationId,
          amount:
            Number(amount),
          currency,
          tenantId,
          customerId,
          loanId,
        }
      );

      this.metrics
        .disbursementSuccesses++;

      return {
        success: true,
        provider:
          PROVIDER,
        reference,
        providerReference,
        externalId:
          reference,
        status:
          TRANSACTION_STATUS.PENDING,
        correlationId,
        response:
          response.data,
      };
    } catch (error) {
      this.metrics
        .disbursementFailures++;

      this.metrics.failures++;

      await this.safeTransitionToFailure(
        reference,
        error,
        {
          providerReference,
          correlationId,
        }
      );

      await this.recordAudit(
        "DISBURSEMENT_REQUEST_FAILED",
        {
          reference,
          providerReference,
          correlationId,
          error:
            error.message,
          code:
            error.code,
        }
      );

      /**
       * Important:
       *
       * An ambiguous network failure must not automatically mean that MTN
       * failed the transaction. The transaction may already exist at MTN.
       *
       * The durable state should therefore remain UNKNOWN when the request
       * outcome is ambiguous.
       */
      if (
        error.retryable
      ) {
        await this.transitionTransaction(
          reference,
          TRANSACTION_STATUS.UNKNOWN,
          {
            providerReference,
            providerStatus:
              "UNKNOWN",
            correlationId,
            error:
              error.message,
          }
        );
      }

      throw error;
    }
  }

  /**
   * ==========================================================================
   * BULK DISBURSEMENT
   * ==========================================================================
   */

  async bulkDisburse(
    transactions = []
  ) {
    if (
      !Array.isArray(
        transactions
      )
    ) {
      throw new MTNMomoError(
        "transactions must be an array.",
        {
          code:
            "MTN_INVALID_BULK_PAYLOAD",
        }
      );
    }

    if (
      transactions.length === 0
    ) {
      return {
        processed: 0,
        successful: 0,
        failed: 0,
        results: [],
      };
    }

    const results =
      new Array(
        transactions.length
      );

    let cursor = 0;

    const worker =
      async () => {
        while (true) {
          const index =
            cursor++;

          if (
            index >=
            transactions.length
          ) {
            return;
          }

          const tx =
            transactions[index];

          try {
            const result =
              await this.disburse(
                tx
              );

            results[index] = {
              success: true,
              transaction:
                tx,
              result,
            };
          } catch (error) {
            results[index] = {
              success: false,
              transaction:
                tx,
              error:
                error.message,
              code:
                error.code ||
                "MTN_DISBURSEMENT_FAILED",
            };
          }
        }
      };

    const workers =
      Array.from(
        {
          length: Math.min(
            this.bulkConcurrency,
            transactions.length
          ),
        },
        () => worker()
      );

    await Promise.all(
      workers
    );

    const successful =
      results.filter(
        (item) =>
          item?.success
      ).length;

    return {
      processed:
        results.length,

      successful,

      failed:
        results.length -
        successful,

      results,
    };
  }

  /**
   * ==========================================================================
   * TRANSACTION STATUS
   * ==========================================================================
   */

  async getStatus(
    reference,
    options = {}
  ) {
    if (!reference) {
      throw new MTNMomoError(
        "reference is required.",
        {
          code:
            "MTN_REFERENCE_REQUIRED",
        }
      );
    }

    this.metrics
      .statusQueries++;

    const correlationId =
      this.resolveCorrelationId(
        options
      );

    let transaction =
      await this.findTransaction(
        reference
      );

    /**
     * If reference is the provider reference, resolve the internal reference.
     */
    if (
      !transaction &&
      options.providerReference
    ) {
      transaction =
        await this.findByProviderReference(
          options.providerReference
        );
    }

    const providerReference =
      options.providerReference ||
      transaction?.providerReference ||
      this.referenceCache.get(
        reference
      )?.providerReference ||
      reference;

    try {
      const headers =
        await this.createHeaders({
          reference:
            providerReference,
          correlationId,
        });

      const operation =
        options.operation ||
        transaction?.transactionType ||
        OPERATION.COLLECTION;

      const basePath =
        operation ===
          OPERATION.DISBURSEMENT
          ? "/disbursement/v1_0/transfer"
          : "/collection/v1_0/requesttopay";

      const response =
        await this.request(
          "GET",
          `${this.baseUrl}${basePath}/${providerReference}`,
          {
            headers,
            operation:
              "STATUS_QUERY",
            reference:
              providerReference,
            correlationId,
            timeout:
              this.requestTimeoutMs,
          }
        );

      const providerStatus =
        response?.data?.status;

      const normalized =
        this.normalizeProviderStatus(
          providerStatus
        );

      const internalReference =
        transaction?.reference ||
        reference;

      await this.transitionTransaction(
        internalReference,
        normalized,
        {
          providerReference,
          providerStatus,
          providerResponse:
            response.data,
          correlationId,
        }
      );

      return {
        ...response.data,

        reference:
          internalReference,

        providerReference,

        normalizedStatus:
          normalized,

        correlationId,
      };
    } catch (error) {
      this.metrics
        .statusFailures++;

      throw error;
    }
  }

  /**
   * ==========================================================================
   * WEBHOOK VERIFICATION
   * ==========================================================================
   */

  async verifyWebhook(
    payload,
    context = {}
  ) {
    if (
      typeof this.webhookVerifier ===
      "function"
    ) {
      const result =
        await this.webhookVerifier(
          payload,
          context
        );

      if (!result) {
        this.metrics
          .webhookVerificationFailures++;

        throw new MTNMomoError(
          "MTN MoMo webhook verification failed.",
          {
            code:
              "MTN_WEBHOOK_VERIFICATION_FAILED",
          }
        );
      }

      return true;
    }

    if (
      this.webhookSecret
    ) {
      const signature =
        context.signature ||
        context.headers?.[
        "x-mtn-signature"
        ] ||
        context.headers?.[
        "x-signature"
        ] ||
        context.headers?.[
        "x-mtn-signature"
          .toLowerCase()
        ];

      if (!signature) {
        this.metrics
          .webhookVerificationFailures++;

        throw new MTNMomoError(
          "Webhook signature missing.",
          {
            code:
              "MTN_WEBHOOK_SIGNATURE_MISSING",
          }
        );
      }

      const rawBody =
        context.rawBody !==
          undefined
          ? context.rawBody
          : JSON.stringify(
            payload || {}
          );

      const expectedHex =
        crypto
          .createHmac(
            "sha256",
            this.webhookSecret
          )
          .update(
            rawBody
          )
          .digest("hex");

      const expectedBase64 =
        crypto
          .createHmac(
            "sha256",
            this.webhookSecret
          )
          .update(
            rawBody
          )
          .digest("base64");

      const supplied =
        String(
          signature
        )
          .replace(
            /^sha256=/i,
            ""
          )
          .trim();

      const candidates = [
        expectedHex,
        expectedBase64,
      ];

      const verified =
        candidates.some(
          (candidate) => {
            const a =
              Buffer.from(
                candidate,
                "utf8"
              );

            const b =
              Buffer.from(
                supplied,
                "utf8"
              );

            return (
              a.length ===
              b.length &&
              crypto.timingSafeEqual(
                a,
                b
              )
            );
          }
        );

      if (!verified) {
        this.metrics
          .webhookVerificationFailures++;

        throw new MTNMomoError(
          "Webhook signature verification failed.",
          {
            code:
              "MTN_WEBHOOK_SIGNATURE_INVALID",
          }
        );
      }

      return true;
    }

    /**
     * No verifier configured.
     *
     * This explicitly returns false. The caller may choose whether an
     * unverified callback is allowed to proceed.
     */
    return false;
  }

  /**
  * ==========================================================================
  * WEBHOOK PROCESSING
  * ==========================================================================
  *
  * Provider-facing callback edge.
  *
  * The service is intentionally thin:
  *
  *   verify
  *      ↓
  *   registry
  *      ↓
  *   normalize
  *      ↓
  *   validate
  *      ↓
  *   process
  *
  * Durable callback lifecycle lives in the callback subsystem.
  * ==========================================================================
  */

  async processWebhook(
    payload = {},
    context = {}
  ) {
    this.metrics
      .webhooksReceived++;

    let callback = null;

    try {
      /**
       * --------------------------------------------------------------
       * Provider signature verification
       * --------------------------------------------------------------
       */

      const verified =
        await this.verifyWebhook(
          payload,
          context
        );

      await this.recordAudit(
        'WEBHOOK_RECEIVED',
        {
          verified,

          callbackHeaders:
            this.sanitizeAuditPayload(
              context.headers ||
              {}
            ),
        }
      );

      /**
       * --------------------------------------------------------------
       * Resolve provider callback handler
       * --------------------------------------------------------------
       */

      const handler =
        this.callbackRegistry.resolve(
          PROVIDER
        );

      /**
       * --------------------------------------------------------------
       * Normalize provider payload
       * --------------------------------------------------------------
       */

      callback =
        await handler.normalizer(
          payload,
          context
        );

      /**
       * --------------------------------------------------------------
       * Validate canonical callback
       * --------------------------------------------------------------
       */

      await handler.validator(
        callback,
        context
      );

      /**
       * --------------------------------------------------------------
       * Process durable callback lifecycle
       * --------------------------------------------------------------
       */

      const result =
        await handler.processor(
          callback,
          {
            ...context,

            verified,

            provider:
              PROVIDER,
          }
        );

      this.metrics
        .webhooksProcessed++;

      this.emit?.(
        'transaction.status.changed',
        {
          provider:
            PROVIDER,

          reference:
            callback.reference,

          providerReference:
            callback.providerReference,

          status:
            callback.status,

          callbackId:
            callback.callbackId,
        }
      );

      return {
        success: true,

        processed:
          result.processed,

        duplicate:
          result.duplicate,

        verified,

        callbackId:
          callback.callbackId,

        reference:
          callback.reference,

        providerReference:
          callback.providerReference,

        status:
          callback.status,
      };
    } catch (error) {
      this.metrics
        .webhookFailures++;

      await this.recordAudit(
        'WEBHOOK_FAILED',
        {
          callbackId:
            callback?.callbackId ||
            null,

          reference:
            callback?.reference ||
            null,

          providerReference:
            callback?.providerReference ||
            null,

          error: {
            code:
              error?.code ||
              'MTN_WEBHOOK_FAILED',

            message:
              error?.message ||
              String(error),

            retryable:
              Boolean(
                error?.retryable
              ),
          },
        }
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * SUCCESSFUL TRANSACTION PROCESSING
   * ==========================================================================
   */

  async handleSuccessfulTransaction(
    {
      reference,
      providerReference,
      payload,
      transaction: suppliedTransaction = null,
    }
  ) {
    const transaction =
      suppliedTransaction ||
      await this.findTransaction(
        reference
      );


    /**
     * Provider reference may have arrived before our local reference.
     */
    if (
      !transaction &&
      providerReference
    ) {
      transaction =
        await this.findByProviderReference(
          providerReference
        );
    }

    /**
     * Durable duplicate posting guard.
     */
    if (
      transaction?.financialPostingStatus ===
      POSTING_STATUS.POSTED
    ) {
      this.metrics
        .duplicateFinancialPostings++;

      return {
        success: true,
        alreadyPosted: true,
      };
    }

    /**
     * Claim financial posting when the Transaction model supports it.
     *
     * This reduces duplicate financial execution across callbacks/status
     * polling. The exact schema remains backwards-compatible because no
     * required new model is introduced here.
     */
    const claim =
      await this.claimFinancialPosting(
        reference,
        providerReference
      );

    if (
      claim.alreadyPosted
    ) {
      this.metrics
        .duplicateFinancialPostings++;

      return {
        success: true,
        alreadyPosted: true,
      };
    }

    if (
      claim.claimed === false
    ) {
      return {
        success: true,
        alreadyProcessing: true,
      };
    }

    transaction =
      transaction ||
      await this.findTransaction(
        reference
      );

    const amount =
      Number(
        payload.amount ||
        transaction?.amount ||
        0
      );

    const currency =
      payload.currency ||
      transaction?.currency ||
      DEFAULT_CURRENCY;

    const tenantId =
      payload.tenantId ||
      transaction?.tenantId ||
      null;

    const customerId =
      payload.customerId ||
      transaction?.customerId ||
      null;

    const loanId =
      payload.loanId ||
      transaction?.loanId ||
      null;

    const transactionType =
      transaction?.transactionType ||
      payload.transactionType ||
      null;

    try {
      /**
       * ----------------------------------------------------------------------
       * Loan repayment accounting
       * ----------------------------------------------------------------------
       */

      if (
        loanId &&
        this.enableLoanAccounting &&
        loanAccountingService?.recordRepayment
      ) {
        try {
          await loanAccountingService.recordRepayment(
            {
              tenantId,
              loanId,

              memberId:
                transaction?.memberId ||
                customerId,

              accountId:
                transaction?.accountId ||
                null,

              repaymentId:
                transaction?.repaymentId ||
                reference,

              reference,

              provider:
                PROVIDER,

              amount,

              principalAmount:
                Number(
                  payload.principalAmount ||
                  transaction?.principalAmount ||
                  0
                ),

              interestAmount:
                Number(
                  payload.interestAmount ||
                  transaction?.interestAmount ||
                  0
                ),

              penaltyAmount:
                Number(
                  payload.penaltyAmount ||
                  transaction?.penaltyAmount ||
                  0
                ),

              currency,

              repaymentDate:
                new Date(),

              metadata: {
                providerReference,
                provider:
                  PROVIDER,
                transactionType,
                correlationId,
              },
            }
          );

          this.metrics
            .accountingPosts++;
        } catch (error) {
          this.metrics
            .accountingFailures++;

          await this.markFinancialPostingFailed(
            reference,
            {
              providerReference,
              stage:
                "LOAN_ACCOUNTING",
              error:
                error.message,
            }
          );

          await this.recordAudit(
            "LOAN_ACCOUNTING_FAILED",
            {
              reference,
              providerReference,
              loanId,
              correlationId,
              error:
                error.message,
            }
          );

          throw error;
        }
      }

      /**
       * ----------------------------------------------------------------------
       * Settlement
       * ----------------------------------------------------------------------
       */

      if (
        this.enableSettlementPosting &&
        settlementService?.recordSettlement
      ) {
        try {
          await settlementService.recordSettlement(
            {
              settlementId:
                providerReference ||
                reference,

              reference,

              provider:
                PROVIDER,

              transactionId:
                reference,

              transactionType:
                transactionType ||
                "MOBILE_MONEY",

              amount,

              currency,

              settlementDate:
                new Date(),

              status:
                "SETTLED",

              tenantId,
              customerId,

              metadata: {
                providerReference,
                providerPayload:
                  payload,
                correlationId,
              },
            }
          );

          this.metrics
            .settlementsRecorded++;
        } catch (error) {
          this.metrics
            .settlementFailures++;

          await this.markFinancialPostingFailed(
            reference,
            {
              providerReference,
              stage:
                "SETTLEMENT",
              error:
                error.message,
            }
          );

          await this.recordAudit(
            "SETTLEMENT_RECORDING_FAILED",
            {
              reference,
              providerReference,
              correlationId,
              error:
                error.message,
            }
          );

          throw error;
        }
      }

      /**
       * ----------------------------------------------------------------------
       * Ledger Engine
       * ----------------------------------------------------------------------
       */

      if (
        this.enableLedgerPosting &&
        ledgerService
      ) {
        try {
          await this.postToLedger({
            reference,
            providerReference,
            transaction,
            payload,
            amount,
            currency,
            tenantId,
            customerId,
            loanId,
            correlationId,
          });

          this.metrics
            .ledgerPosts++;
        } catch (error) {
          this.metrics
            .ledgerFailures++;

          await this.markFinancialPostingFailed(
            reference,
            {
              providerReference,
              stage:
                "LEDGER",
              error:
                error.message,
            }
          );

          await this.recordAudit(
            "LEDGER_POSTING_FAILED",
            {
              reference,
              providerReference,
              correlationId,
              error:
                error.message,
            }
          );

          throw error;
        }
      }

      /**
       * ----------------------------------------------------------------------
       * Mark complete only after all enabled financial consumers succeeded.
       * ----------------------------------------------------------------------
       */

      await this.markFinancialPostingComplete(
        reference,
        {
          providerReference,
          status:
            TRANSACTION_STATUS.SUCCESSFUL,
          financialPostingStatus:
            POSTING_STATUS.POSTED,
          financialPostedAt:
            new Date(),
          correlationId,
        }
      );

      await this.recordAudit(
        "FINANCIAL_TRANSACTION_POSTED",
        {
          reference,
          providerReference,
          amount,
          currency,
          tenantId,
          customerId,
          loanId,
          correlationId,
        }
      );

      return {
        success: true,
        reference,
        providerReference,
        amount,
        currency,
      };
    } catch (error) {
      this.metrics
        .financialPostingFailures++;

      await this.enqueueFinancialFailure({
        reference,
        providerReference,
        payload,
        correlationId,
        error,
      });

      throw error;
    }
  }

  /**
   * ==========================================================================
   * FINANCIAL POSTING CLAIM
   * ==========================================================================
   */

  async claimFinancialPosting(
    reference,
    providerReference
  ) {
    const local =
      this.stateCache.get(
        reference
      );

    if (
      local?.financialPostingStatus ===
      POSTING_STATUS.POSTED
    ) {
      return {
        claimed: false,
        alreadyPosted: true,
      };
    }

    if (
      local?.financialPostingStatus ===
      POSTING_STATUS.PROCESSING
    ) {
      return {
        claimed: false,
        alreadyProcessing: true,
      };
    }

    this.stateCache.set(
      reference,
      {
        ...local,
        reference,
        providerReference,
        financialPostingStatus:
          POSTING_STATUS.PROCESSING,
        financialPostingStartedAt:
          new Date().toISOString(),
      }
    );

    /**
     * Best-effort durable claim.
     *
     * We intentionally do not introduce a new model/schema here.
     */
    if (
      Transaction
    ) {
      try {
        const result =
          await Transaction.updateOne(
            {
              $or: [
                {
                  reference,
                },
                {
                  externalId:
                    reference,
                },
              ],

              financialPostingStatus: {
                $nin: [
                  POSTING_STATUS.POSTED,
                  POSTING_STATUS.PROCESSING,
                ],
              },
            },
            {
              $set: {
                financialPostingStatus:
                  POSTING_STATUS.PROCESSING,

                financialPostingStartedAt:
                  new Date(),

                providerReference,
              },
            }
          );

        if (
          result?.modifiedCount === 0
        ) {
          const existing =
            await this.findTransaction(
              reference
            );

          if (
            existing?.financialPostingStatus ===
            POSTING_STATUS.POSTED
          ) {
            return {
              claimed: false,
              alreadyPosted: true,
            };
          }

          /**
           * Existing schemas may not have financialPostingStatus.
           * Continue using the local guard.
           */
        }
      } catch (error) {
        this.loggerWarn(
          "Financial posting claim persistence failed",
          error
        );
      }
    }

    return {
      claimed: true,
      alreadyPosted: false,
    };
  }

  /**
   * ==========================================================================
   * LEDGER INTEGRATION
   * ==========================================================================
   */

  async postToLedger(
    {
      reference,
      providerReference,
      transaction,
      payload,
      amount,
      currency,
      tenantId,
      customerId,
      loanId,
      correlationId,
    }
  ) {
    if (!ledgerService) {
      throw new MTNMomoError(
        "Ledger service is unavailable while ledger posting is enabled.",
        {
          code:
            "MTN_LEDGER_SERVICE_UNAVAILABLE",
          reference,
          providerReference,
          correlationId,
        }
      );
    }

    const entry = {
      idempotencyKey:
        `MTN_MOMO:${reference}`,

      transactionId:
        reference,

      provider:
        PROVIDER,

      providerReference,

      tenantId,
      customerId,
      loanId,

      amount,
      currency,

      transactionType:
        transaction?.transactionType ||
        payload.transactionType ||
        "MOBILE_MONEY",

      status:
        TRANSACTION_STATUS.SUCCESSFUL,

      metadata: {
        providerPayload:
          payload,
        correlationId,
      },

      createdAt:
        new Date(),
    };

    if (
      typeof ledgerService.postProviderTransaction ===
      "function"
    ) {
      return ledgerService.postProviderTransaction(
        entry
      );
    }

    if (
      typeof ledgerService.postTransaction ===
      "function"
    ) {
      return ledgerService.postTransaction(
        entry
      );
    }

    if (
      typeof ledgerService.post ===
      "function"
    ) {
      return ledgerService.post(
        entry
      );
    }

    throw new MTNMomoError(
      "Ledger service is loaded but exposes no supported transaction posting method.",
      {
        code:
          "MTN_LEDGER_METHOD_UNAVAILABLE",
        reference,
        providerReference,
        correlationId,
      }
    );
  }

  /**
   * ==========================================================================
   * FAILED TRANSACTION
   * ==========================================================================
   */

  async handleFailedTransaction(
    {
      reference,
      providerReference,
      payload,
      correlationId,
    }
  ) {
    await this.recordAudit(
      "PROVIDER_TRANSACTION_FAILED",
      {
        reference,
        providerReference,
        providerStatus:
          payload.status,
        reason:
          payload.reason ||
          payload.financialTransactionStatus ||
          null,
        correlationId,
      }
    );

    return {
      success: true,
      status:
        TRANSACTION_STATUS.FAILED,
    };
  }

  /**
   * ==========================================================================
   * PERSIST TRANSACTION
   * ==========================================================================
   */

  async persistTransactionRequest(
    data
  ) {
    if (!Transaction) {
      if (
        this.requireTransactionPersistence
      ) {
        throw new MTNMomoError(
          "Transaction persistence is required but the Transaction model is unavailable.",
          {
            code:
              "MTN_TRANSACTION_MODEL_UNAVAILABLE",
            reference:
              data.reference,
          }
        );
      }

      return null;
    }

    try {
      const existing =
        await this.findTransaction(
          data.reference
        );

      if (existing) {
        /**
         * Provider reference is immutable.
         */
        if (
          existing.providerReference &&
          data.providerReference &&
          existing.providerReference !==
          data.providerReference
        ) {
          throw new MTNMomoError(
            "Existing transaction has a different provider reference.",
            {
              code:
                "MTN_PROVIDER_REFERENCE_CONFLICT",
              reference:
                data.reference,
              providerReference:
                data.providerReference,
            }
          );
        }

        return existing;
      }

      const record =
        new Transaction({
          reference:
            data.reference,

          externalId:
            data.reference,

          provider:
            PROVIDER,

          providerReference:
            data.providerReference,

          transactionType:
            data.operation,

          amount:
            data.amount,

          currency:
            data.currency,

          phoneNumber:
            data.phoneNumber,

          tenantId:
            data.tenantId,

          customerId:
            data.customerId,

          loanId:
            data.loanId,

          savingsAccountId:
            data.savingsAccountId,

          description:
            data.description,

          status:
            data.status,

          providerStatus:
            data.status,

          metadata:
            data.metadata,

          providerResponse:
            data.providerResponse,

          correlationId:
            data.correlationId,

          financialPostingStatus:
            POSTING_STATUS.NOT_POSTED,

          createdAt:
            new Date(),

          updatedAt:
            new Date(),
        });

      await record.save();

      this.cacheReferenceCorrelation({
        reference:
          data.reference,
        providerReference:
          data.providerReference,
        operation:
          data.operation,
        tenantId:
          data.tenantId,
        customerId:
          data.customerId,
        loanId:
          data.loanId,
      });

      return record;
    } catch (error) {
      this.loggerWarn(
        "Transaction persistence failed",
        error
      );

      if (
        this.requireTransactionPersistence
      ) {
        throw new MTNMomoError(
          "Unable to persist MTN MoMo transaction.",
          {
            code:
              "MTN_TRANSACTION_PERSISTENCE_FAILED",
            reference:
              data.reference,
            cause: error,
          }
        );
      }

      return null;
    }
  }

  /**
   * ==========================================================================
   * FIND TRANSACTION
   * ==========================================================================
   */

  async findTransaction(
    reference
  ) {
    if (!reference) {
      return null;
    }

    if (!Transaction) {
      return (
        this.idempotencyCache.get(
          reference
        ) ||
        this.stateCache.get(
          reference
        ) ||
        null
      );
    }

    try {
      return await Transaction.findOne({
        $or: [
          {
            reference,
          },
          {
            externalId:
              reference,
          },
        ],
      }).lean();
    } catch {
      return null;
    }
  }

  /**
   * ==========================================================================
   * WEBHOOK PERSISTENCE
   * ==========================================================================
   */

  async persistWebhook(
    {
      reference,
      providerReference,
      status,
      payload,
      correlationId,
    }
  ) {
    if (!Transaction) {
      return;
    }

    try {
      const filter = {
        $or: [
          {
            reference,
          },
          {
            externalId:
              reference,
          },
        ],
      };

      if (
        providerReference
      ) {
        filter.$or.push({
          providerReference,
        });
      }

      await Transaction.updateOne(
        filter,
        {
          $set: {
            status,

            providerStatus:
              payload.status ||
              status,

            ...(providerReference
              ? {
                providerReference,
              }
              : {}),

            providerResponse:
              payload,

            correlationId,

            updatedAt:
              new Date(),
          },
        }
      );
    } catch (error) {
      this.loggerWarn(
        "Webhook transaction persistence failed",
        error
      );
    }
  }

  /**
   * ==========================================================================
   * MARK FINANCIAL POSTING COMPLETE
   * ==========================================================================
   */

  async markFinancialPostingComplete(
    reference,
    data
  ) {
    this.stateCache.set(
      reference,
      {
        ...this.stateCache.get(
          reference
        ),
        ...data,
        reference,
      }
    );

    if (!Transaction) {
      return;
    }

    try {
      await Transaction.updateOne(
        {
          $or: [
            {
              reference,
            },
            {
              externalId:
                reference,
            },
          ],
        },
        {
          $set: {
            ...data,
            updatedAt:
              new Date(),
          },
        }
      );
    } catch (error) {
      this.loggerWarn(
        "Financial posting status persistence failed",
        error
      );
    }
  }

  /**
   * ==========================================================================
   * MARK FINANCIAL POSTING FAILED
   * ==========================================================================
   */

  async markFinancialPostingFailed(
    reference,
    data = {}
  ) {
    this.stateCache.set(
      reference,
      {
        ...this.stateCache.get(
          reference
        ),
        reference,
        financialPostingStatus:
          POSTING_STATUS.FAILED,
        financialPostingFailedAt:
          new Date().toISOString(),
        financialPostingError:
          data.error ||
          null,
        ...data,
      }
    );

    if (!Transaction) {
      return;
    }

    try {
      await Transaction.updateOne(
        {
          $or: [
            {
              reference,
            },
            {
              externalId:
                reference,
            },
          ],
        },
        {
          $set: {
            financialPostingStatus:
              POSTING_STATUS.FAILED,

            financialPostingFailedAt:
              new Date(),

            financialPostingError:
              data.error ||
              null,

            ...data,

            updatedAt:
              new Date(),
          },
        }
      );
    } catch (error) {
      this.loggerWarn(
        "Financial posting failure persistence failed",
        error
      );
    }
  }

  /**
   * ==========================================================================
   * DUPLICATE RESPONSE
   * ==========================================================================
   */

  buildDuplicateResponse(
    existing,
    reference
  ) {
    return {
      success: true,

      duplicate: true,

      provider:
        PROVIDER,

      reference,

      providerReference:
        existing?.providerReference ||
        this.referenceCache.get(
          reference
        )?.providerReference ||
        null,

      status:
        existing?.status ||
        TRANSACTION_STATUS.PENDING,

      transaction:
        existing || null,
    };
  }

  /**
   * ==========================================================================
   * RECONCILIATION
   * ==========================================================================
   */

  async reconcile(
    date = new Date()
  ) {
    this.metrics
      .reconciliations++;

    if (
      !reconciliationService ||
      typeof reconciliationService.reconcileProvider !==
      "function"
    ) {
      this.metrics
        .reconciliationFailures++;

      const error =
        new MTNMomoError(
          "Reconciliation service is unavailable.",
          {
            code:
              "MTN_RECONCILIATION_SERVICE_UNAVAILABLE",
          }
        );

      await this.recordAudit(
        "RECONCILIATION_FAILED",
        {
          error:
            error.message,
          date,
        }
      );

      throw error;
    }

    try {
      const result =
        await reconciliationService.reconcileProvider(
          PROVIDER,
          date
        );

      await this.recordAudit(
        "RECONCILIATION_COMPLETED",
        {
          date,
          result,
        }
      );

      return result;
    } catch (error) {
      this.metrics
        .reconciliationFailures++;

      await this.recordAudit(
        "RECONCILIATION_FAILED",
        {
          error:
            error.message,
          date,
        }
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * SETTLEMENT
   * ==========================================================================
   */

  async postSettlement(
    payload = {}
  ) {
    if (
      !settlementService
    ) {
      this.metrics
        .settlementFailures++;

      return {
        success: false,
        message:
          "Settlement service unavailable",
      };
    }

    if (
      typeof settlementService.recordSettlement !==
      "function"
    ) {
      this.metrics
        .settlementFailures++;

      throw new MTNMomoError(
        "Settlement service does not expose recordSettlement().",
        {
          code:
            "MTN_SETTLEMENT_METHOD_UNAVAILABLE",
        }
      );
    }

    try {
      const settlement =
        await settlementService.recordSettlement(
          {
            provider:
              PROVIDER,

            ...payload,

            status:
              payload.status ||
              "SETTLED",
          }
        );

      this.metrics
        .settlementsRecorded++;

      await this.recordAudit(
        "SETTLEMENT_POSTED",
        settlement
      );

      return settlement;
    } catch (error) {
      this.metrics
        .settlementFailures++;

      await this.recordAudit(
        "SETTLEMENT_POST_FAILED",
        {
          error:
            error.message,
          payload,
        }
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * REVERSAL
   * ==========================================================================
   */

  async reverseTransaction(
    reference,
    options = {}
  ) {
    const transaction =
      await this.findTransaction(
        reference
      );

    if (!transaction) {
      throw new MTNMomoError(
        "Transaction not found.",
        {
          code:
            "MTN_TRANSACTION_NOT_FOUND",
          reference,
        }
      );
    }

    if (
      transaction.status !==
      TRANSACTION_STATUS.SUCCESSFUL
    ) {
      throw new MTNMomoError(
        "Only successful transactions can be reversed.",
        {
          code:
            "MTN_INVALID_REVERSAL_STATE",
          reference,
        }
      );
    }

    if (
      typeof this.reversalHandler ===
      "function"
    ) {
      const result =
        await this.reversalHandler({
          reference,
          transaction,
          reason:
            options.reason ||
            "Transaction reversal",
        });

      this.metrics
        .reversals++;

      await this.recordAudit(
        "REVERSAL_REQUESTED",
        {
          reference,
          reason:
            options.reason ||
            "Transaction reversal",
        }
      );

      return result;
    }

    throw new MTNMomoError(
      "MTN MoMo reversal is not configured for this deployment.",
      {
        code:
          "MTN_REVERSAL_NOT_CONFIGURED",
        reference,
      }
    );
  }

  /**
   * ==========================================================================
   * RETRY MANAGEMENT
   * ==========================================================================
   */

  async retryTransaction(
    reference
  ) {
    if (!reference) {
      throw new MTNMomoError(
        "reference is required.",
        {
          code:
            "MTN_REFERENCE_REQUIRED",
        }
      );
    }

    const transaction =
      await this.findTransaction(
        reference
      );

    let status =
      transaction?.status;

    if (!status) {
      status =
        this.stateCache.get(
          reference
        )?.status;
    }

    if (
      status ===
      TRANSACTION_STATUS.SUCCESSFUL
    ) {
      this.metrics
        .retriesRejected++;

      return {
        success: false,
        action:
          "RETRY_NOT_REQUIRED",
        reference,
        reason:
          "Transaction already successful.",
      };
    }

    if (
      status ===
      TRANSACTION_STATUS.REVERSED
    ) {
      this.metrics
        .retriesRejected++;

      return {
        success: false,
        action:
          "RETRY_NOT_ALLOWED",
        reference,
        reason:
          "Transaction has been reversed.",
      };
    }

    if (
      status !==
      TRANSACTION_STATUS.FAILED &&
      status !==
      TRANSACTION_STATUS.UNKNOWN
    ) {
      this.metrics
        .retriesRejected++;

      return {
        success: false,
        action:
          "RETRY_NOT_REQUIRED",
        reference,
        reason:
          `Current transaction state is ${status || "UNKNOWN"
          }.`,
      };
    }

    const retryPayload = {
      provider:
        PROVIDER,

      reference,

      providerReference:
        transaction?.providerReference ||
        this.referenceCache.get(
          reference
        )?.providerReference ||
        null,

      transactionId:
        transaction?.id ||
        transaction?._id ||
        null,

      requestedAt:
        new Date().toISOString(),
    };

    if (
      this.enableQueueRetries &&
      queueService?.enqueue
    ) {
      await queueService.enqueue(
        "mtn-momo-retry",
        retryPayload
      );

      this.metrics
        .retriesQueued++;

      await this.recordAudit(
        "RETRY_QUEUED",
        retryPayload
      );

      return {
        success: true,
        action:
          "RETRY_QUEUED",
        reference,
      };
    }

    this.metrics
      .retriesRejected++;

    return {
      success: false,
      action:
        "RETRY_UNAVAILABLE",
      reference,
      reason:
        "Queue service unavailable.",
    };
  }

  /**
   * ==========================================================================
   * DEAD LETTER QUEUE
   * ==========================================================================
   */

  async enqueueDeadLetter(
    payload = {}
  ) {
    if (
      !this.enableDeadLetterQueue
    ) {
      return {
        queued: false,
        reason:
          "Dead-letter processing disabled.",
      };
    }

    if (
      !queueService
    ) {
      this.metrics
        .deadLetterFailures++;

      return {
        queued: false,
        reason:
          "Queue service unavailable.",
      };
    }

    try {
      if (
        typeof queueService.enqueueDeadLetter ===
        "function"
      ) {
        await queueService.enqueueDeadLetter(
          "mtn-momo",
          payload
        );
      } else if (
        typeof queueService.enqueue ===
        "function"
      ) {
        await queueService.enqueue(
          "mtn-momo-dlq",
          payload
        );
      } else {
        this.metrics
          .deadLetterFailures++;

        return {
          queued: false,
          reason:
            "No supported dead-letter queue method.",
        };
      }

      this.metrics
        .deadLettersQueued++;

      await this.recordAudit(
        "DEAD_LETTER_QUEUED",
        {
          reference:
            payload.reference ||
            null,
          type:
            payload.type ||
            null,
        }
      );

      return {
        queued: true,
      };
    } catch (error) {
      this.metrics
        .deadLetterFailures++;

      await this.recordAudit(
        "DEAD_LETTER_QUEUE_FAILED",
        {
          error:
            error.message,
          payload,
        }
      );

      return {
        queued: false,
        error:
          error.message,
      };
    }
  }

  async enqueueFinancialFailure(
    {
      reference,
      providerReference,
      payload,
      correlationId,
      error,
    }
  ) {
    if (
      !error?.retryable &&
      ![
        "MTN_LEDGER_METHOD_UNAVAILABLE",
        "MTN_LEDGER_SERVICE_UNAVAILABLE",
      ].includes(
        error?.code
      )
    ) {
      return null;
    }

    return this.enqueueDeadLetter({
      type:
        "MTN_FINANCIAL_POSTING",
      reference,
      providerReference,
      payload,
      correlationId,
      error: {
        code:
          error?.code,
        message:
          error?.message,
      },
    });
  }

  /**
   * ==========================================================================
   * PROCESSING LOCK
   * ==========================================================================
   */

  async withProcessingLock(
    reference,
    handler
  ) {
    const existing =
      this.processingLocks.get(
        reference
      );

    if (existing) {
      return existing;
    }

    const promise =
      Promise.resolve()
        .then(handler)
        .finally(() => {
          this.processingLocks.delete(
            reference
          );
        });

    this.processingLocks.set(
      reference,
      promise
    );

    return promise;
  }

  /**
   * ==========================================================================
   * SAFE FAILURE TRANSITION
   * ==========================================================================
   */

  async safeTransitionToFailure(
    reference,
    error,
    metadata = {}
  ) {
    try {
      /**
       * Network ambiguity is represented as UNKNOWN rather than FAILED.
       */
      const status =
        error?.retryable
          ? TRANSACTION_STATUS.UNKNOWN
          : TRANSACTION_STATUS.FAILED;

      await this.transitionTransaction(
        reference,
        status,
        {
          ...metadata,

          providerStatus:
            status,

          error:
            error?.message ||
            null,
        }
      );
    } catch (transitionError) {
      this.loggerWarn(
        "Unable to persist failure transaction state",
        transitionError
      );
    }
  }

  /**
   * ==========================================================================
   * AUDIT
   * ==========================================================================
   */

  async recordAudit(
    action,
    payload = {}
  ) {
    try {
      const sanitized =
        this.sanitizeAuditPayload(
          payload
        );

      const entry = {
        provider:
          PROVIDER,

        action,

        payload:
          sanitized,

        timestamp:
          new Date().toISOString(),
      };

      if (
        auditService
      ) {
        if (
          typeof auditService.record ===
          "function"
        ) {
          await auditService.record(
            entry
          );
        } else if (
          typeof auditService.log ===
          "function"
        ) {
          await auditService.log(
            entry
          );
        }
      }

      logger.info?.(
        `[${PROVIDER}] ${action}`,
        entry
      );

      return entry;
    } catch (error) {
      logger.error?.(
        `[${PROVIDER}] audit logging failed`,
        {
          error:
            error?.message ||
            error,
        }
      );

      /**
       * Audit failure must never hide the underlying provider or financial
       * event.
       */
      return null;
    }
  }

  /**
   * ==========================================================================
   * AUDIT DATA SANITIZATION
   * ==========================================================================
   */

  sanitizeAuditPayload(
    payload
  ) {
    if (
      payload === null ||
      payload === undefined
    ) {
      return payload;
    }

    if (
      typeof payload !==
      "object"
    ) {
      return payload;
    }

    const sensitiveKeys =
      new Set([
        "access_token",
        "refresh_token",
        "token",
        "apiKey",
        "api_key",
        "subscriptionKey",
        "subscription_key",
        "authorization",
        "Authorization",
        "password",
        "secret",
        "client_secret",
        "clientSecret",
        "webhookSecret",
        "signature",
        "x-signature",
        "x-mtn-signature",
      ]);

    const sanitize =
      (value) => {
        if (
          Array.isArray(
            value
          )
        ) {
          return value.map(
            sanitize
          );
        }

        if (
          value &&
          typeof value ===
          "object"
        ) {
          const result =
            {};

          for (
            const [
              key,
              child,
            ] of Object.entries(
              value
            )
          ) {
            if (
              sensitiveKeys.has(
                key
              )
            ) {
              result[key] =
                "[REDACTED]";
            } else {
              result[key] =
                sanitize(
                  child
                );
            }
          }

          return result;
        }

        return value;
      };

    return sanitize(
      payload
    );
  }

  /**
   * ==========================================================================
   * ERROR NORMALIZATION
   * ==========================================================================
   */

  normalizeError(
    error,
    operation,
    options = {}
  ) {
    if (
      error instanceof
      MTNMomoError
    ) {
      return error;
    }

    const statusCode =
      error?.response?.status;

    const providerData =
      error?.response?.data;

    const retryAfterHeader =
      error?.response?.headers?.[
      "retry-after"
      ];

    let retryAfterMs =
      null;

    if (
      retryAfterHeader
    ) {
      const seconds =
        Number(
          retryAfterHeader
        );

      if (
        Number.isFinite(
          seconds
        )
      ) {
        retryAfterMs =
          seconds * 1000;
      }
    }

    const networkError =
      !error?.response &&
      Boolean(
        error?.code
      );

    const retryable =
      TRANSIENT_HTTP_STATUS_CODES.has(
        statusCode
      ) ||
      error?.code ===
      "ECONNRESET" ||
      error?.code ===
      "ETIMEDOUT" ||
      error?.code ===
      "ECONNABORTED" ||
      error?.code ===
      "ENOTFOUND" ||
      networkError;

    const providerMessage =
      providerData?.message ||
      providerData?.reason ||
      providerData?.error ||
      providerData?.code ||
      null;

    const message =
      providerMessage ||
      error?.message ||
      "MTN MoMo request failed.";

    const normalized =
      new MTNMomoError(
        message,
        {
          code:
            error?.code ||
            "MTN_PROVIDER_ERROR",

          statusCode,

          operation,

          retryable,

          retryAfterMs,

          correlationId:
            options.correlationId ||
            null,

          cause:
            error,
        }
      );

    normalized.providerResponse =
      providerData;

    return normalized;
  }

  /**
   * ==========================================================================
   * LOGGING HELPERS
   * ==========================================================================
   */

  loggerWarn(
    message,
    error
  ) {
    logger.warn?.(
      `[${PROVIDER}] ${message}`,
      {
        error:
          error?.message ||
          error,
      }
    );
  }

  /**
   * ==========================================================================
   * HEALTH
   * ==========================================================================
   */

  async healthCheck() {
    const configurationValid =
      Boolean(
        this.baseUrl &&
        this.subscriptionKey &&
        this.apiUser &&
        this.apiKey
      );

    const dependencies = {
      transactionPersistence:
        Boolean(
          Transaction
        ),

      reconciliation:
        Boolean(
          reconciliationService?.reconcileProvider
        ),

      settlement:
        Boolean(
          settlementService?.recordSettlement
        ),

      loanAccounting:
        Boolean(
          loanAccountingService?.recordRepayment
        ),

      ledger:
        Boolean(
          ledgerService
        ),

      queue:
        Boolean(
          queueService
        ),

      webhookVerification:
        Boolean(
          this.webhookSecret ||
          this.webhookVerifier
        ),
    };

    return {
      healthy:
        configurationValid,

      degraded:
        !dependencies.transactionPersistence ||
        !dependencies.ledger,

      service:
        "mtnMomoService",

      provider:
        PROVIDER,

      configurationValid,

      dependencies,

      tokenCached:
        this.isTokenValid(),

      targetEnvironment:
        this.targetEnvironment,

      timestamp:
        new Date().toISOString(),
    };
  }

  /**
   * ==========================================================================
   * METRICS
   * ==========================================================================
   */

  getMetrics() {
    return {
      provider:
        PROVIDER,

      ...this.metrics,

      stateCacheSize:
        this.stateCache.size,

      referenceCacheSize:
        this.referenceCache.size,

      idempotencyCacheSize:
        this.idempotencyCache.size,

      processingLocks:
        this.processingLocks.size,

      tokenCached:
        this.isTokenValid(),

      timestamp:
        new Date().toISOString(),
    };
  }

  /**
   * ==========================================================================
   * RESET METRICS
   * ==========================================================================
   */

  resetMetrics() {
    const startedAt =
      this.metrics.startedAt;

    this.metrics =
      this.createInitialMetrics();

    this.metrics.startedAt =
      startedAt;
  }

  /**
   * ==========================================================================
   * INTERFACE MAPPINGS
   * ==========================================================================
   */

  async collect(
    payload
  ) {
    return this.deposit(
      payload
    );
  }

  async handleWebhook(
    payload,
    context = {}
  ) {
    return this.processWebhook(
      payload,
      context
    );
  }

  async getTransactionStatus(
    reference,
    options = {}
  ) {
    return this.getStatus(
      reference,
      options
    );
  }

  /**
   * ==========================================================================
   * CAPABILITIES
   * ==========================================================================
   */

  getCapabilities() {
    return {
      collections:
        true,

      disbursements:
        true,

      reversals:
        typeof this.reversalHandler ===
        "function",

      reconciliation:
        Boolean(
          reconciliationService?.reconcileProvider
        ),

      settlements:
        Boolean(
          settlementService?.recordSettlement
        ),

      balanceInquiry:
        true,

      webhookVerification:
        Boolean(
          this.webhookSecret ||
          this.webhookVerifier
        ),

      transactionLookup:
        true,

      transactionRetry:
        Boolean(
          queueService?.enqueue
        ),

      deadLetterQueue:
        Boolean(
          queueService
        ),

      cancellation:
        false,

      idempotency:
        true,

      stateMachine:
        true,

      referenceCorrelation:
        true,

      ledgerIntegration:
        Boolean(
          ledgerService
        ),

      loanAccounting:
        Boolean(
          loanAccountingService?.recordRepayment
        ),
    };
  }
}

/**
 * ============================================================================
 * SINGLETON
 * ============================================================================
 *
 * Existing architecture exports a singleton.
 * Preserve that API.
 * ============================================================================
 */

module.exports =
  new MTNMomoService();