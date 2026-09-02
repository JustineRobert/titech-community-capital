"use strict";

/**
 * =============================================================================
 * TITech Community Capital
 * Enterprise Financial Transaction Queue
 * =============================================================================
 *
 * File:
 *   backend/queues/transaction.queue.js
 *
 * Purpose:
 *   Enterprise-grade asynchronous queue boundary for financial transaction
 *   processing inside TITech Community Capital.
 *
 * =============================================================================
 * ARCHITECTURAL ROLE
 * =============================================================================
 *
 *   API / Controller
 *        │
 *        ▼
 *   Transaction Service
 *        │
 *        ├── validates request
 *        ├── creates idempotency reference
 *        ├── persists transaction intent
 *        │
 *        ▼
 *   Transaction Queue
 *        │
 *        ├── retry / backoff
 *        ├── durable delivery
 *        ├── worker isolation
 *        ├── dead-letter handling
 *        └── observability
 *        │
 *        ▼
 *   Transaction Worker
 *        │
 *        ▼
 *   Transaction Processing Service
 *        │
 *        ├── idempotency verification
 *        ├── ledger transaction
 *        ├── provider operation
 *        └── atomic finalization
 *        │
 *        ▼
 *   Double-Entry Ledger
 *
 * =============================================================================
 * FINANCIAL SAFETY MODEL
 * =============================================================================
 *
 * Queue delivery is NOT the financial idempotency mechanism.
 *
 * A message may be delivered:
 *
 *   - once
 *   - more than once
 *   - after a worker crash
 *   - after a timeout
 *   - after a Redis connection interruption
 *   - after acknowledgement loss
 *
 * Therefore:
 *
 *   Queue-level uniqueness
 *          +
 *   Transaction-level idempotency
 *          +
 *   Ledger-level uniqueness
 *          +
 *   Atomic state transitions
 *
 * are all required.
 *
 * =============================================================================
 * IMPORTANT
 * =============================================================================
 *
 * This module does NOT directly mutate balances or ledger entries.
 *
 * Financial mutations MUST remain inside the transaction processing service
 * and/or ledger service.
 *
 * =============================================================================
 * SUPPORTED QUEUE IMPLEMENTATION
 * =============================================================================
 *
 * Primary implementation:
 *
 *   BullMQ
 *
 * Redis is expected to be available through the TITech infrastructure.
 *
 * The module intentionally keeps the BullMQ dependency behind this boundary
 * so application code does not need to know queue implementation details.
 *
 * =============================================================================
 */

const crypto = require("crypto");


/**
 * =============================================================================
 * OPTIONAL CONFIGURATION
 * =============================================================================
 */

let appConfig = null;

try {
  appConfig = require("../config");
} catch (error) {
  /**
   * Configuration injection remains available for tests and isolated usage.
   */
  appConfig = null;
}


/**
 * =============================================================================
 * OPTIONAL BULLMQ IMPORT
 * =============================================================================
 *
 * The dependency is loaded lazily so unit tests can inject a fake queue.
 * =============================================================================
 */

let BullMQ = null;

try {
  BullMQ = require("bullmq");
} catch (error) {
  BullMQ = null;
}


/**
 * =============================================================================
 * CONSTANTS
 * =============================================================================
 */

const QUEUE_NAME =
  "titech-financial-transactions";

const DEAD_LETTER_QUEUE_NAME =
  "titech-financial-transactions-dlq";

const DEFAULT_JOB_NAME =
  "process-transaction";

const DEFAULT_ATTEMPTS = 5;

const DEFAULT_BACKOFF_DELAY_MS =
  5000;

const DEFAULT_MAX_BACKOFF_DELAY_MS =
  5 * 60 * 1000;

const DEFAULT_REMOVE_ON_COMPLETE =
  1000;

const DEFAULT_REMOVE_ON_FAIL =
  5000;

const DEFAULT_JOB_TIMEOUT_MS =
  120000;

const DEFAULT_CONCURRENCY =
  10;

const DEFAULT_LOCK_DURATION_MS =
  180000;

const DEFAULT_STALLED_INTERVAL_MS =
  30000;

const DEFAULT_MAX_STALLED_COUNT =
  1;

const DEFAULT_PRIORITY =
  0;

const DEFAULT_MAX_QUEUE_DEPTH =
  100000;

const DEFAULT_RATE_LIMIT_MAX =
  1000;

const DEFAULT_RATE_LIMIT_DURATION_MS =
  1000;

const DEFAULT_PREFIX =
  "titech";

const IDEMPOTENCY_VERSION =
  "v1";

const QUEUE_VERSION =
  "1";


/**
 * =============================================================================
 * TRANSACTION TYPES
 * =============================================================================
 *
 * These are intentionally generic.
 *
 * The transaction service remains responsible for validating the actual
 * transaction type.
 * =============================================================================
 */

const TRANSACTION_JOB_TYPES =
  Object.freeze({
    PROCESS:
      "process-transaction",

    RECOVER:
      "recover-transaction",

    RECONCILE:
      "reconcile-transaction",

    RETRY:
      "retry-transaction",
  });


/**
 * =============================================================================
 * TERMINAL / NON-RETRYABLE ERROR CODES
 * =============================================================================
 */

const NON_RETRYABLE_ERROR_CODES =
  Object.freeze(
    new Set([
      "VALIDATION_ERROR",
      "INVALID_TRANSACTION",
      "INVALID_TRANSACTION_TYPE",
      "INVALID_AMOUNT",
      "INVALID_CURRENCY",
      "INVALID_ACCOUNT",
      "ACCOUNT_NOT_FOUND",
      "USER_NOT_FOUND",
      "TENANT_NOT_FOUND",
      "TRANSACTION_NOT_FOUND",
      "TRANSACTION_CANCELLED",
      "TRANSACTION_REVERSED",
      "TRANSACTION_ALREADY_COMPLETED",
      "INSUFFICIENT_FUNDS",
      "ACCOUNT_FROZEN",
      "ACCOUNT_CLOSED",
      "COMPLIANCE_BLOCK",
      "AML_BLOCK",
      "FRAUD_BLOCK",
      "KYC_REQUIRED",
      "DUPLICATE_TRANSACTION",
      "IDEMPOTENCY_CONFLICT",
      "PERMISSION_DENIED",
    ])
  );


/**
 * =============================================================================
 * TRANSIENT ERROR CODES
 * =============================================================================
 */

const TRANSIENT_ERROR_CODES =
  Object.freeze(
    new Set([
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "EAI_AGAIN",
      "NETWORK_ERROR",
      "SERVICE_UNAVAILABLE",
      "UPSTREAM_TIMEOUT",
      "TIMEOUT",
      "REDIS_CONNECTION_ERROR",
      "MONGO_NETWORK_ERROR",
      "MongoNetworkError",
      "MongoServerSelectionError",
      "MongoWriteConcernError",
      "RATE_LIMITED",
      "TEMPORARY_FAILURE",
      "PROVIDER_UNAVAILABLE",
      "PROVIDER_TIMEOUT",
    ])
  );


/**
 * =============================================================================
 * LOGGER
 * =============================================================================
 */

function createLogger(logger) {
  if (
    logger &&
    typeof logger.info === "function" &&
    typeof logger.warn === "function" &&
    typeof logger.error === "function"
  ) {
    return logger;
  }

  return {
    info: (...args) =>
      console.info(...args),

    warn: (...args) =>
      console.warn(...args),

    error: (...args) =>
      console.error(...args),

    debug: (...args) =>
      console.debug(...args),
  };
}


/**
 * =============================================================================
 * SAFE ERROR SERIALIZATION
 * =============================================================================
 *
 * Never serialize:
 *
 *   - access tokens
 *   - refresh tokens
 *   - authorization headers
 *   - card data
 *   - PINs
 *   - provider credentials
 *   - full financial payloads
 * =============================================================================
 */

function serializeError(error) {
  if (!error) {
    return {
      name: "Error",
      message: "Unknown error",
      code: null,
      statusCode: null,
      retryable: false,
    };
  }

  return {
    name:
      error.name ||
      "Error",

    message:
      error.message ||
      "Unknown error",

    code:
      error.code ||
      null,

    statusCode:
      Number.isFinite(
        Number(error.statusCode)
      )
        ? Number(error.statusCode)
        : null,

    retryable:
      error.retryable === true,
  };
}


/**
 * =============================================================================
 * ERROR CLASSIFICATION
 * =============================================================================
 */

function isNonRetryableError(error) {
  if (!error) {
    return false;
  }

  if (
    error.nonRetryable === true
  ) {
    return true;
  }

  if (
    NON_RETRYABLE_ERROR_CODES.has(
      error.code
    )
  ) {
    return true;
  }

  const statusCode =
    Number(error.statusCode);

  if (
    statusCode >= 400 &&
    statusCode < 500 &&
    statusCode !== 408 &&
    statusCode !== 409 &&
    statusCode !== 429
  ) {
    return true;
  }

  return false;
}


function isTransientError(error) {
  if (!error) {
    return false;
  }

  if (
    error.retryable === true
  ) {
    return true;
  }

  if (
    TRANSIENT_ERROR_CODES.has(
      error.code
    )
  ) {
    return true;
  }

  const statusCode =
    Number(error.statusCode);

  return (
    statusCode === 408 ||
    statusCode === 409 ||
    statusCode === 429 ||
    statusCode >= 500
  );
}


/**
 * =============================================================================
 * SHA-256
 * =============================================================================
 */

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(String(value))
    .digest("hex");
}


/**
 * =============================================================================
 * OBJECT ID / VALUE NORMALIZATION
 * =============================================================================
 */

function normalizeString(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const normalized =
    String(value).trim();

  return normalized.length > 0
    ? normalized
    : null;
}


/**
 * =============================================================================
 * IDEMPOTENCY KEY GENERATION
 * =============================================================================
 *
 * Priority:
 *
 *   1. explicit transaction idempotency key
 *   2. transaction reference
 *   3. transaction ID
 *
 * The generated queue key is deterministic.
 *
 * This prevents queue retries from accidentally becoming independent jobs.
 * =============================================================================
 */

function buildIdempotencyKey(data = {}) {
  const explicit =
    normalizeString(
      data.idempotencyKey
    );

  if (explicit) {
    return explicit;
  }

  const reference =
    normalizeString(
      data.transactionReference
    ) ||
    normalizeString(
      data.reference
    );

  if (reference) {
    return `${IDEMPOTENCY_VERSION}:transaction:${reference}`;
  }

  const transactionId =
    normalizeString(
      data.transactionId
    );

  if (transactionId) {
    return `${IDEMPOTENCY_VERSION}:transaction:${transactionId}`;
  }

  throw new Error(
    "A transactionId, transactionReference, or idempotencyKey is required."
  );
}


/**
 * =============================================================================
 * DETERMINISTIC JOB ID
 * =============================================================================
 */

function buildJobId(data = {}) {
  const idempotencyKey =
    buildIdempotencyKey(data);

  /**
   * BullMQ job IDs must not contain ":" in some versions/configurations.
   *
   * Hashing provides a safe deterministic identifier while retaining the
   * original idempotency key inside the job payload.
   */
  return `txn-${sha256(
    idempotencyKey
  ).slice(0, 40)}`;
}


/**
 * =============================================================================
 * TENANT VALIDATION
 * =============================================================================
 */

function requireTenantId(data = {}) {
  const tenantId =
    normalizeString(
      data.tenantId
    );

  if (!tenantId) {
    const error =
      new Error(
        "tenantId is required for transaction queue jobs."
      );

    error.code =
      "TENANT_REQUIRED";

    error.nonRetryable =
      true;

    throw error;
  }

  return tenantId;
}


/**
 * =============================================================================
 * TRANSACTION PAYLOAD SANITIZATION
 * =============================================================================
 *
 * Queue messages should contain identifiers and processing metadata rather than
 * unnecessarily large or sensitive request bodies.
 * =============================================================================
 */

function sanitizeTransactionPayload(
  data = {}
) {
  const tenantId =
    requireTenantId(data);

  const idempotencyKey =
    buildIdempotencyKey(data);

  const transactionId =
    normalizeString(
      data.transactionId
    );

  const transactionReference =
    normalizeString(
      data.transactionReference
    ) ||
    normalizeString(
      data.reference
    );

  if (
    !transactionId &&
    !transactionReference
  ) {
    const error =
      new Error(
        "transactionId or transactionReference is required."
      );

    error.code =
      "TRANSACTION_IDENTIFIER_REQUIRED";

    error.nonRetryable =
      true;

    throw error;
  }

  return {
    queueVersion:
      QUEUE_VERSION,

    tenantId,

    transactionId,

    transactionReference,

    idempotencyKey,

    jobType:
      normalizeString(
        data.jobType
      ) ||
      TRANSACTION_JOB_TYPES.PROCESS,

    source:
      normalizeString(
        data.source
      ) ||
      "unknown",

    correlationId:
      normalizeString(
        data.correlationId
      ) ||
      null,

    causationId:
      normalizeString(
        data.causationId
      ) ||
      null,

    requestedBy:
      normalizeString(
        data.requestedBy
      ) ||
      null,

    attempt:
      Number.isInteger(
        data.attempt
      )
        ? data.attempt
        : 0,

    enqueuedAt:
      new Date(),

    metadata:
      sanitizeMetadata(
        data.metadata
      ),
  };
}


/**
 * =============================================================================
 * SAFE METADATA
 * ============================================================================= */

function sanitizeMetadata(
  metadata
) {
  if (
    !metadata ||
    typeof metadata !== "object"
  ) {
    return {};
  }

  const allowedKeys =
    new Set([
      "channel",
      "provider",
      "operation",
      "transactionType",
      "currency",
      "country",
      "requestId",
      "traceId",
      "sourceSystem",
      "reason",
    ]);

  const result = {};

  for (
    const [key, value]
    of Object.entries(metadata)
  ) {
    if (
      !allowedKeys.has(key)
    ) {
      continue;
    }

    if (
      value === null ||
      value === undefined
    ) {
      continue;
    }

    const stringValue =
      String(value);

    result[key] =
      stringValue.length > 200
        ? stringValue.slice(0, 200)
        : stringValue;
  }

  return result;
}


/**
 * =============================================================================
 * DEFAULT REDIS CONNECTION RESOLUTION
 * =============================================================================
 */

function resolveRedisConnection(
  options = {}
) {
  if (
    options.connection
  ) {
    return options.connection;
  }

  if (
    options.redis
  ) {
    return options.redis;
  }

  const configuredUrl =
    process.env.REDIS_URL ||
    process.env.REDIS_URI ||
    process.env.REDIS_CONNECTION_URL ||
    appConfig?.redis?.url ||
    appConfig?.redis?.connectionString;

  if (
    configuredUrl
  ) {
    return {
      url: configuredUrl,
    };
  }

  /**
   * Development fallback.
   *
   * Production deployments should explicitly configure REDIS_URL.
   */
  return {
    host:
      process.env.REDIS_HOST ||
      "127.0.0.1",

    port:
      Number(
        process.env.REDIS_PORT ||
        6379
      ),

    username:
      process.env.REDIS_USERNAME ||
      undefined,

    password:
      process.env.REDIS_PASSWORD ||
      undefined,

    db:
      Number(
        process.env.REDIS_DB ||
        0
      ),
  };
}


/**
 * =============================================================================
 * QUEUE OPTIONS
 * ============================================================================= */

function buildQueueOptions(
  options = {}
) {
  return {
    connection:
      resolveRedisConnection(
        options
      ),

    prefix:
      options.prefix ||
      process.env.REDIS_QUEUE_PREFIX ||
      appConfig?.queue?.prefix ||
      DEFAULT_PREFIX,

    defaultJobOptions: {
      attempts:
        options.attempts ||
        DEFAULT_ATTEMPTS,

      backoff: {
        type:
          "exponential",

        delay:
          options.backoffDelayMs ||
          DEFAULT_BACKOFF_DELAY_MS,
      },

      removeOnComplete:
        options.removeOnComplete ||
        DEFAULT_REMOVE_ON_COMPLETE,

      removeOnFail:
        options.removeOnFail ||
        DEFAULT_REMOVE_ON_FAIL,

      /**
       * Queue retry does not replace financial idempotency.
       */
      stackTraceLimit: 10,
    },
  };
}


/**
 * =============================================================================
 * BULLMQ AVAILABILITY
 * =============================================================================
 */

function requireBullMQ() {
  if (!BullMQ) {
    throw new Error(
      "BullMQ is required by transaction.queue.js. Install bullmq before using the production queue."
    );
  }

  if (
    typeof BullMQ.Queue !==
    "function"
  ) {
    throw new Error(
      "Installed BullMQ package does not expose Queue."
    );
  }
}


/**
 * =============================================================================
 * ENTERPRISE TRANSACTION QUEUE
 * =============================================================================
 */

class TransactionQueue {
  constructor(options = {}) {
    this.logger =
      createLogger(
        options.logger
      );

    this.queueName =
      options.queueName ||
      QUEUE_NAME;

    this.deadLetterQueueName =
      options.deadLetterQueueName ||
      DEAD_LETTER_QUEUE_NAME;

    this.jobName =
      options.jobName ||
      DEFAULT_JOB_NAME;

    this.queueOptions =
      buildQueueOptions(
        options
      );

    this.defaultAttempts =
      Math.max(
        1,
        Number(
          options.attempts ||
          DEFAULT_ATTEMPTS
        )
      );

    this.defaultBackoffDelayMs =
      Math.max(
        100,
        Number(
          options.backoffDelayMs ||
          DEFAULT_BACKOFF_DELAY_MS
        )
      );

    this.maxBackoffDelayMs =
      Math.max(
        this.defaultBackoffDelayMs,
        Number(
          options.maxBackoffDelayMs ||
          DEFAULT_MAX_BACKOFF_DELAY_MS
        )
      );

    this.jobTimeoutMs =
      Math.max(
        1000,
        Number(
          options.jobTimeoutMs ||
          DEFAULT_JOB_TIMEOUT_MS
        )
      );

    this.maxQueueDepth =
      Math.max(
        1,
        Number(
          options.maxQueueDepth ||
          DEFAULT_MAX_QUEUE_DEPTH
        )
      );

    this.rateLimitMax =
      Math.max(
        1,
        Number(
          options.rateLimitMax ||
          DEFAULT_RATE_LIMIT_MAX
        )
      );

    this.rateLimitDurationMs =
      Math.max(
        100,
        Number(
          options.rateLimitDurationMs ||
          DEFAULT_RATE_LIMIT_DURATION_MS
        )
      );

    this.queue =
      options.queue ||
      null;

    this.deadLetterQueue =
      options.deadLetterQueue ||
      null;

    this.worker =
      options.worker ||
      null;

    this.events =
      options.events ||
      null;

    this.initialized =
      Boolean(
        options.queue
      );

    this.closing =
      false;
  }


  /**
   * ===========================================================================
   * INITIALIZE
   * ===========================================================================
   */

  initialize() {
    if (
      this.initialized
    ) {
      return this;
    }

    requireBullMQ();

    this.queue =
      new BullMQ.Queue(
        this.queueName,
        this.queueOptions
      );

    this.deadLetterQueue =
      new BullMQ.Queue(
        this.deadLetterQueueName,
        {
          ...this.queueOptions,

          defaultJobOptions: {
            removeOnComplete:
              1000,

            removeOnFail:
              5000,
          },
        }
      );

    this.initialized =
      true;

    this.logger.info(
      {
        queue:
          this.queueName,

        deadLetterQueue:
          this.deadLetterQueueName,
      },
      "TITech financial transaction queue initialized."
    );

    return this;
  }


  /**
   * ===========================================================================
   * ENSURE READY
   * ===========================================================================
   */

  ensureReady() {
    if (
      !this.initialized
    ) {
      this.initialize();
    }

    if (
      !this.queue
    ) {
      throw new Error(
        "Transaction queue failed to initialize."
      );
    }

    return this.queue;
  }


  /**
   * ===========================================================================
   * QUEUE DEPTH
   * ===========================================================================
   */

  async getQueueDepth() {
    this.ensureReady();

    if (
      typeof this.queue.getJobCounts !==
      "function"
    ) {
      return null;
    }

    const counts =
      await this.queue.getJobCounts(
        "waiting",
        "active",
        "delayed",
        "failed",
        "completed"
      );

    return {
      ...counts,

      totalPending:
        Number(
          counts.waiting || 0
        ) +
        Number(
          counts.active || 0
        ) +
        Number(
          counts.delayed || 0
        ),
    };
  }


  /**
   * ===========================================================================
   * CAPACITY PROTECTION
   * ===========================================================================
   *
   * A saturated financial queue should fail fast rather than allowing
   * unbounded memory / Redis growth.
   * ===========================================================================
   */

  async assertQueueCapacity() {
    const depth =
      await this.getQueueDepth();

    if (
      !depth
    ) {
      return true;
    }

    if (
      depth.totalPending >=
      this.maxQueueDepth
    ) {
      const error =
        new Error(
          "Financial transaction queue capacity has been reached."
        );

      error.code =
        "TRANSACTION_QUEUE_CAPACITY_EXCEEDED";

      error.retryable =
        true;

      throw error;
    }

    return true;
  }


  /**
   * ===========================================================================
   * ENQUEUE TRANSACTION
   * ===========================================================================
   */

  async enqueue(
    transaction,
    options = {}
  ) {
    if (
      this.closing
    ) {
      throw new Error(
        "Transaction queue is shutting down."
      );
    }

    const queue =
      this.ensureReady();

    const payload =
      sanitizeTransactionPayload(
        transaction
      );

    await this.assertQueueCapacity();

    const jobId =
      options.jobId ||
      buildJobId(
        payload
      );

    const attempts =
      Math.max(
        1,
        Number(
          options.attempts ||
          this.defaultAttempts
        )
      );

    const priority =
      Number.isInteger(
        options.priority
      )
        ? options.priority
        : DEFAULT_PRIORITY;

    const jobOptions = {
      jobId,

      attempts,

      priority,

      timeout:
        options.timeout ||
        this.jobTimeoutMs,

      backoff: {
        type:
          "exponential",

        delay:
          options.backoffDelayMs ||
          this.defaultBackoffDelayMs,
      },

      removeOnComplete:
        options.removeOnComplete ??
        DEFAULT_REMOVE_ON_COMPLETE,

      removeOnFail:
        options.removeOnFail ??
        DEFAULT_REMOVE_ON_FAIL,

      /**
       * Prevent BullMQ from automatically creating multiple independent
       * jobs for the same transaction idempotency key.
       */
      deduplication:
        options.deduplication === false
          ? undefined
          : {
              id:
                sha256(
                  payload.idempotencyKey
                ),
            },
    };

    const job =
      await queue.add(
        payload.jobType ||
          this.jobName,
        payload,
        jobOptions
      );

    this.logger.info(
      {
        queue:
          this.queueName,

        jobId:
          job.id,

        tenantId:
          payload.tenantId,

        transactionId:
          payload.transactionId,

        transactionReference:
          payload.transactionReference,

        source:
          payload.source,
      },
      "TITech financial transaction queued."
    );

    return {
      jobId:
        job.id,

      queue:
        this.queueName,

      idempotencyKey:
        payload.idempotencyKey,

      transactionId:
        payload.transactionId,

      transactionReference:
        payload.transactionReference,

      tenantId:
        payload.tenantId,
    };
  }


  /**
   * ===========================================================================
   * ENQUEUE PROCESSING JOB
   * ===========================================================================
   */

  async enqueueTransaction(
    transaction,
    options = {}
  ) {
    return this.enqueue(
      {
        ...transaction,

        jobType:
          TRANSACTION_JOB_TYPES.PROCESS,
      },
      options
    );
  }


  /**
   * ===========================================================================
   * ENQUEUE RECOVERY JOB
   * ===========================================================================
   */

  async enqueueRecovery(
    transaction,
    options = {}
  ) {
    return this.enqueue(
      {
        ...transaction,

        jobType:
          TRANSACTION_JOB_TYPES.RECOVER,

        source:
          transaction.source ||
          "transaction_recovery",
      },
      {
        ...options,

        priority:
          options.priority ??
          1,
      }
    );
  }


  /**
   * ===========================================================================
   * ENQUEUE RECONCILIATION JOB
   * ===========================================================================
   */

  async enqueueReconciliation(
    transaction,
    options = {}
  ) {
    return this.enqueue(
      {
        ...transaction,

        jobType:
          TRANSACTION_JOB_TYPES.RECONCILE,

        source:
          transaction.source ||
          "transaction_reconciliation",
      },
      {
        ...options,

        priority:
          options.priority ??
          1,
      }
    );
  }


  /**
   * ===========================================================================
   * GET JOB
   * ===========================================================================
   */

  async getJob(
    jobId
  ) {
    this.ensureReady();

    if (
      !jobId
    ) {
      return null;
    }

    return this.queue.getJob(
      String(jobId)
    );
  }


  /**
   * ===========================================================================
   * REMOVE JOB
   * ===========================================================================
   *
   * This should be used sparingly.
   *
   * Financial transaction jobs should generally be allowed to complete,
   * retry, or enter the DLQ rather than being deleted.
   * ===========================================================================
   */

  async removeJob(
    jobId,
    options = {}
  ) {
    const job =
      await this.getJob(
        jobId
      );

    if (
      !job
    ) {
      return false;
    }

    if (
      !options.force &&
      job.data &&
      job.data.transactionId
    ) {
      const error =
        new Error(
          "Financial transaction jobs require force=true before removal."
        );

      error.code =
        "TRANSACTION_JOB_REMOVE_REQUIRES_FORCE";

      throw error;
    }

    await job.remove();

    this.logger.warn(
      {
        queue:
          this.queueName,

        jobId:
          String(jobId),
      },
      "Financial transaction queue job removed."
    );

    return true;
  }


  /**
   * ===========================================================================
   * MOVE FAILED JOB TO DLQ
   * ===========================================================================
   */

  async moveToDeadLetter(
    job,
    error,
    options = {}
  ) {
    if (
      !job
    ) {
      return null;
    }

    if (
      !this.deadLetterQueue
    ) {
      this.initialize();
    }

    const serializedError =
      serializeError(
        error
      );

    const sourceData =
      job.data || {};

    const dlqPayload = {
      queueVersion:
        QUEUE_VERSION,

      originalQueue:
        this.queueName,

      originalJobId:
        String(
          job.id
        ),

      originalJobName:
        job.name ||
        null,

      tenantId:
        sourceData.tenantId ||
        null,

      transactionId:
        sourceData.transactionId ||
        null,

      transactionReference:
        sourceData.transactionReference ||
        null,

      idempotencyKey:
        sourceData.idempotencyKey ||
        null,

      jobType:
        sourceData.jobType ||
        null,

      source:
        sourceData.source ||
        null,

      correlationId:
        sourceData.correlationId ||
        null,

      failedAt:
        new Date(),

      failedAttempts:
        job.attemptsMade ||
        0,

      error:
        serializedError,

      metadata:
        sanitizeMetadata(
          sourceData.metadata
        ),
    };

    const dlqJobId =
      `dlq-${sha256(
        `${this.queueName}:${job.id}`
      ).slice(0, 40)}`;

    const dlqJob =
      await this.deadLetterQueue.add(
        "dead-letter-transaction",
        dlqPayload,
        {
          jobId:
            dlqJobId,

          removeOnComplete:
            options.removeOnComplete ||
            1000,

          removeOnFail:
            options.removeOnFail ||
            5000,
        }
      );

    this.logger.error(
      {
        queue:
          this.queueName,

        dlq:
          this.deadLetterQueueName,

        jobId:
          String(job.id),

        dlqJobId:
          String(dlqJob.id),

        tenantId:
          sourceData.tenantId,

        transactionId:
          sourceData.transactionId,

        error:
          serializedError,
      },
      "Financial transaction moved to dead-letter queue."
    );

    return dlqJob;
  }


  /**
   * ===========================================================================
   * CREATE WORKER
   * ===========================================================================
   *
   * The actual financial operation is injected.
   *
   * processor(job) MUST:
   *
   *   1. verify tenant ownership
   *   2. load the transaction from the database
   *   3. verify idempotency
   *   4. verify transaction state
   *   5. execute the atomic financial operation
   *   6. persist final transaction state
   *
   * It MUST NOT trust arbitrary queue payload values for monetary amounts.
   * ===========================================================================
   */

  createWorker(
    processor,
    options = {}
  ) {
    if (
      typeof processor !==
      "function"
    ) {
      throw new TypeError(
        "Transaction queue worker processor must be a function."
      );
    }

    requireBullMQ();

    const connection =
      resolveRedisConnection(
        options
      );

    const concurrency =
      Math.max(
        1,
        Number(
          options.concurrency ||
          DEFAULT_CONCURRENCY
        )
      );

    const workerOptions = {
      connection,

      prefix:
        options.prefix ||
        this.queueOptions.prefix,

      concurrency,

      lockDuration:
        options.lockDurationMs ||
        DEFAULT_LOCK_DURATION_MS,

      stalledInterval:
        options.stalledIntervalMs ||
        DEFAULT_STALLED_INTERVAL_MS,

      maxStalledCount:
        options.maxStalledCount ??
        DEFAULT_MAX_STALLED_COUNT,

      limiter: {
        max:
          options.rateLimitMax ||
          this.rateLimitMax,

        duration:
          options.rateLimitDurationMs ||
          this.rateLimitDurationMs,
      },
    };

    const worker =
      new BullMQ.Worker(
        this.queueName,

        async job => {
          const startedAt =
            Date.now();

          const data =
            job.data || {};

          /**
           * ===================================================================
           * PAYLOAD GUARDS
           * ===================================================================
           */

          if (
            !data.tenantId
          ) {
            const error =
              new Error(
                "Transaction queue job is missing tenantId."
              );

            error.code =
              "TENANT_REQUIRED";

            error.nonRetryable =
              true;

            throw error;
          }

          if (
            !data.idempotencyKey
          ) {
            const error =
              new Error(
                "Transaction queue job is missing idempotencyKey."
              );

            error.code =
              "IDEMPOTENCY_KEY_REQUIRED";

            error.nonRetryable =
              true;

            throw error;
          }

          this.logger.info(
            {
              queue:
                this.queueName,

              jobId:
                String(job.id),

              jobName:
                job.name,

              tenantId:
                data.tenantId,

              transactionId:
                data.transactionId,

              transactionReference:
                data.transactionReference,

              attempt:
                job.attemptsMade + 1,
            },
            "TITech financial transaction worker started."
          );

          try {
            /**
             * ===============================================================
             * FINANCIAL PROCESSOR
             * ===============================================================
             *
             * The processor owns the real financial operation.
             */
            const result =
              await processor(
                job,
                {
                  tenantId:
                    data.tenantId,

                  transactionId:
                    data.transactionId,

                  transactionReference:
                    data.transactionReference,

                  idempotencyKey:
                    data.idempotencyKey,

                  jobType:
                    data.jobType,

                  source:
                    data.source,

                  correlationId:
                    data.correlationId,

                  causationId:
                    data.causationId,

                  metadata:
                    data.metadata,

                  attempt:
                    job.attemptsMade + 1,

                  jobId:
                    String(job.id),
                }
              );

            this.logger.info(
              {
                queue:
                  this.queueName,

                jobId:
                  String(job.id),

                tenantId:
                  data.tenantId,

                transactionId:
                  data.transactionId,

                durationMs:
                  Date.now() -
                  startedAt,
              },
              "TITech financial transaction worker completed."
            );

            return result;
          } catch (error) {
            const serialized =
              serializeError(
                error
              );

            this.logger.error(
              {
                queue:
                  this.queueName,

                jobId:
                  String(job.id),

                tenantId:
                  data.tenantId,

                transactionId:
                  data.transactionId,

                attempt:
                  job.attemptsMade + 1,

                error:
                  serialized,
              },
              "TITech financial transaction worker failed."
            );

            /**
             * Non-retryable financial errors should not be retried by the
             * queue.
             */
            if (
              isNonRetryableError(
                error
              )
            ) {
              error.retryable =
                false;

              throw error;
            }

            /**
             * Explicit transient errors are retried by BullMQ.
             */
            if (
              isTransientError(
                error
              )
            ) {
              error.retryable =
                true;

              throw error;
            }

            /**
             * Unknown errors default to retryable because a worker crash,
             * database outage, or provider interruption must not silently
             * lose a financial transaction.
             */
            error.retryable =
              true;

            throw error;
          }
        },

        workerOptions
      );

    this.worker =
      worker;

    this.attachWorkerEvents(
      worker
    );

    this.logger.info(
      {
        queue:
          this.queueName,

        concurrency,
      },
      "TITech financial transaction worker initialized."
    );

    return worker;
  }


  /**
   * ===========================================================================
   * WORKER EVENT HANDLERS
   * ===========================================================================
   */

  attachWorkerEvents(
    worker
  ) {
    if (
      !worker ||
      typeof worker.on !==
      "function"
    ) {
      return;
    }

    worker.on(
      "completed",
      job => {
        this.logger.info(
          {
            queue:
              this.queueName,

            jobId:
              String(job.id),

            tenantId:
              job.data?.tenantId,

            transactionId:
              job.data?.transactionId,
          },
          "Financial transaction queue job completed."
        );
      }
    );

    worker.on(
      "failed",
      async (job, error) => {
        if (
          !job
        ) {
          return;
        }

        this.logger.error(
          {
            queue:
              this.queueName,

            jobId:
              String(job.id),

            tenantId:
              job.data?.tenantId,

            transactionId:
              job.data?.transactionId,

            attemptsMade:
              job.attemptsMade,

            maxAttempts:
              job.opts?.attempts,

            error:
              serializeError(error),
          },
          "Financial transaction queue job entered failed state."
        );

        /**
         * BullMQ performs retries until attempts are exhausted.
         *
         * Only after the final attempt should the job be moved to the DLQ.
         */
        const maxAttempts =
          Number(
            job.opts?.attempts ||
            this.defaultAttempts
          );

        const exhausted =
          job.attemptsMade >=
          maxAttempts;

        if (
          exhausted
        ) {
          try {
            await this.moveToDeadLetter(
              job,
              error
            );
          } catch (dlqError) {
            /**
             * Never hide the original transaction failure.
             */
            this.logger.error(
              {
                queue:
                  this.queueName,

                jobId:
                  String(job.id),

                error:
                  serializeError(
                    dlqError
                  ),
              },
              "Failed to move transaction job to dead-letter queue."
            );
          }
        }
      }
    );

    worker.on(
      "stalled",
      jobId => {
        this.logger.warn(
          {
            queue:
              this.queueName,

            jobId:
              String(jobId),
          },
          "Financial transaction queue job stalled and may be redelivered."
        );
      }
    );

    worker.on(
      "error",
      error => {
        this.logger.error(
          {
            queue:
              this.queueName,

            error:
              serializeError(error),
          },
          "Financial transaction worker emitted an error."
        );
      }
    );
  }


  /**
   * ===========================================================================
   * PAUSE QUEUE
   * ===========================================================================
   */

  async pause() {
    this.ensureReady();

    if (
      typeof this.queue.pause !==
      "function"
    ) {
      return false;
    }

    await this.queue.pause();

    this.logger.warn(
      {
        queue:
          this.queueName,
      },
      "TITech financial transaction queue paused."
    );

    return true;
  }


  /**
   * ===========================================================================
   * RESUME QUEUE
   * ===========================================================================
   */

  async resume() {
    this.ensureReady();

    if (
      typeof this.queue.resume !==
      "function"
    ) {
      return false;
    }

    await this.queue.resume();

    this.logger.info(
      {
        queue:
          this.queueName,
      },
      "TITech financial transaction queue resumed."
    );

    return true;
  }


  /**
   * ===========================================================================
   * CLEANUP
   * ===========================================================================
   */

  async clean(
    graceMs,
    limit,
    type
  ) {
    this.ensureReady();

    return this.queue.clean(
      graceMs,
      limit,
      type
    );
  }


  /**
   * ===========================================================================
   * HEALTH
   * ===========================================================================
   */

  async health() {
    const health = {
      queueName:
        this.queueName,

      deadLetterQueueName:
        this.deadLetterQueueName,

      initialized:
        this.initialized,

      closing:
        this.closing,

      workerActive:
        Boolean(
          this.worker
        ),

      queueDepth:
        null,

      redis:
        "unknown",
    };

    try {
      health.queueDepth =
        await this.getQueueDepth();

      health.redis =
        "reachable";
    } catch (error) {
      health.redis =
        "unavailable";

      health.error =
        serializeError(
          error
        );
    }

    return health;
  }


  /**
   * ===========================================================================
   * GRACEFUL SHUTDOWN
   * ===========================================================================
   */

  async close(
    options = {}
  ) {
    if (
      this.closing
    ) {
      return;
    }

    this.closing =
      true;

    this.logger.info(
      {
        queue:
          this.queueName,
      },
      "Stopping TITech financial transaction queue."
    );

    const errors = [];

    if (
      this.worker &&
      typeof this.worker.close ===
      "function"
    ) {
      try {
        await this.worker.close();
      } catch (error) {
        errors.push(error);

        this.logger.error(
          {
            queue:
              this.queueName,

            error:
              serializeError(error),
          },
          "Failed to close financial transaction worker cleanly."
        );
      }
    }

    if (
      options.closeEvents !== false &&
      this.events &&
      typeof this.events.close ===
      "function"
    ) {
      try {
        await this.events.close();
      } catch (error) {
        errors.push(error);
      }
    }

    if (
      this.queue &&
      typeof this.queue.close ===
      "function"
    ) {
      try {
        await this.queue.close();
      } catch (error) {
        errors.push(error);
      }
    }

    if (
      this.deadLetterQueue &&
      typeof this.deadLetterQueue.close ===
      "function"
    ) {
      try {
        await this.deadLetterQueue.close();
      } catch (error) {
        errors.push(error);
      }
    }

    this.logger.info(
      {
        queue:
          this.queueName,

        errors:
          errors.length,
      },
      "TITech financial transaction queue stopped."
    );

    if (
      errors.length > 0 &&
      options.throwOnError
    ) {
      throw errors[0];
    }
  }
}


/**
 * =============================================================================
 * SINGLETON
 * =============================================================================
 */

const transactionQueue =
  new TransactionQueue();


/**
 * =============================================================================
 * FACTORY
 * =============================================================================
 */

function createTransactionQueue(
  options = {}
) {
  return new TransactionQueue(
    options
  );
}


/**
 * =============================================================================
 * CONVENIENCE ENQUEUE FUNCTION
 * =============================================================================
 */

async function enqueueTransaction(
  transaction,
  options = {}
) {
  return transactionQueue.enqueueTransaction(
    transaction,
    options
  );
}


/**
 * =============================================================================
 * CONVENIENCE RECOVERY FUNCTION
 * =============================================================================
 */

async function enqueueTransactionRecovery(
  transaction,
  options = {}
) {
  return transactionQueue.enqueueRecovery(
    transaction,
    options
  );
}


/**
 * =============================================================================
 * CONVENIENCE RECONCILIATION FUNCTION
 * =============================================================================
 */

async function enqueueTransactionReconciliation(
  transaction,
  options = {}
) {
  return transactionQueue.enqueueReconciliation(
    transaction,
    options
  );
}


/**
 * =============================================================================
 * EXPORTS
 * =============================================================================
 */

module.exports =
  Object.freeze({
    QUEUE_NAME,

    DEAD_LETTER_QUEUE_NAME,

    DEFAULT_JOB_NAME,

    DEFAULT_ATTEMPTS,

    DEFAULT_BACKOFF_DELAY_MS,

    DEFAULT_MAX_BACKOFF_DELAY_MS,

    DEFAULT_JOB_TIMEOUT_MS,

    DEFAULT_CONCURRENCY,

    DEFAULT_LOCK_DURATION_MS,

    DEFAULT_STALLED_INTERVAL_MS,

    DEFAULT_MAX_STALLED_COUNT,

    TRANSACTION_JOB_TYPES,

    NON_RETRYABLE_ERROR_CODES,

    TRANSIENT_ERROR_CODES,

    buildIdempotencyKey,

    buildJobId,

    sanitizeTransactionPayload,

    sanitizeMetadata,

    isNonRetryableError,

    isTransientError,

    serializeError,

    TransactionQueue,

    createTransactionQueue,

    transactionQueue,

    enqueueTransaction,

    enqueueTransactionRecovery,

    enqueueTransactionReconciliation,
  });