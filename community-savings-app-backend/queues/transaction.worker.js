"use strict";

/**
 * =============================================================================
 * TITech Community Capital
 * Enterprise Transaction Queue Worker
 * =============================================================================
 *
 * File:
 *   backend/queues/transaction.worker.js
 *
 * Purpose:
 *   Production-grade worker responsible for consuming transaction jobs from
 *   the TITech transaction queue and delegating financial execution to the
 *   authoritative transaction service.
 *
 * =============================================================================
 * ARCHITECTURAL ROLE
 * =============================================================================
 *
 *   API / Controller
 *        │
 *        ▼
 *   Transaction Queue
 *        │
 *        ▼
 *   Transaction Worker
 *        │
 *        ├── validate job
 *        ├── validate tenant context
 *        ├── enforce idempotency
 *        ├── execute transaction service
 *        ├── classify failure
 *        └── acknowledge / retry / dead-letter
 *                 │
 *                 ▼
 *        Transaction Service
 *                 │
 *                 ▼
 *        Double-Entry Ledger
 *                 │
 *                 ▼
 *        Financial Transaction
 *
 * =============================================================================
 * FINANCIAL SAFETY MODEL
 * =============================================================================
 *
 * The worker MUST NOT:
 *
 *   - directly mutate account balances;
 *   - directly create ledger entries;
 *   - directly transfer money;
 *   - blindly retry an unknown financial outcome;
 *   - acknowledge a job before the authoritative service has completed;
 *   - process another tenant's transaction;
 *   - trust arbitrary queue payloads;
 *   - create a second financial transaction because a previous request timed
 *     out.
 *
 * The worker MUST:
 *
 *   1. Validate the queue payload.
 *   2. Establish immutable execution context.
 *   3. Use the transaction's immutable idempotency key/reference.
 *   4. Delegate financial execution to TransactionService.
 *   5. Treat duplicate/idempotency conflicts as already processed when safely
 *      proven.
 *   6. Retry only failures classified as retryable.
 *   7. Never convert an unknown financial outcome into a second payment.
 *   8. Preserve tenant isolation.
 *   9. Emit structured operational telemetry.
 *   10. Allow graceful shutdown.
 *
 * =============================================================================
 * IMPORTANT
 * =============================================================================
 *
 * This worker assumes:
 *
 *   1. A transaction queue implementation exists.
 *   2. TransactionService is the authoritative financial execution service.
 *   3. TransactionService.executeTransaction() is idempotent.
 *   4. The immutable transaction reference/idempotency key is enforced at the
 *      database/ledger layer.
 *   5. Financial state transitions are transactional where required.
 *
 * =============================================================================
 */

const crypto = require("crypto");

const {
  TRANSACTION_STATUS,
  TRANSACTION_TYPES,
  TRANSACTION_RETRY_POLICY,
} = require("../constants/transactionConstants");


/**
 * =============================================================================
 * OPTIONAL SERVICE IMPORT
 * =============================================================================
 *
 * Dependency injection remains supported so unit tests do not require the
 * complete application bootstrap.
 * =============================================================================
 */

let TransactionService;

try {
  TransactionService =
    require("../services/transactionService");
} catch (error) {
  TransactionService = null;
}


/**
 * =============================================================================
 * OPTIONAL MODEL IMPORT
 * =============================================================================
 *
 * The worker does not perform normal financial mutations itself.
 *
 * The model is used only for optional execution-state reconciliation where the
 * project exposes the model.
 * =============================================================================
 */

let Transaction;

try {
  Transaction =
    require("../models/Transaction");
} catch (error) {
  Transaction = null;
}


/**
 * =============================================================================
 * CONSTANTS
 * =============================================================================
 */

const JOB_NAME =
  "titech-transaction-worker";

const DEFAULT_CONCURRENCY = 5;

const MAX_CONCURRENCY = 100;

const DEFAULT_ATTEMPTS = 5;

const DEFAULT_TIMEOUT_MS =
  120000;

const DEFAULT_BACKOFF_MS =
  1000;

const MAX_BACKOFF_MS =
  5 * 60 * 1000;

const MAX_ERROR_MESSAGE_LENGTH =
  500;

const MAX_JOB_ID_LENGTH =
  200;

const MAX_TENANT_ID_LENGTH =
  200;

const MAX_IDEMPOTENCY_KEY_LENGTH =
  300;

const DEFAULT_LOCK_DURATION_MS =
  5 * 60 * 1000;

const DEFAULT_STALLED_INTERVAL_MS =
  60 * 1000;


/**
 * =============================================================================
 * TERMINAL TRANSACTION STATES
 * =============================================================================
 */

const TERMINAL_STATUSES =
  Object.freeze([
    TRANSACTION_STATUS.COMPLETED,
    TRANSACTION_STATUS.FAILED,
    TRANSACTION_STATUS.CANCELLED,
    TRANSACTION_STATUS.REVERSED,
  ].filter(Boolean));


/**
 * =============================================================================
 * SUCCESS STATUSES
 * =============================================================================
 */

const SUCCESS_STATUSES =
  Object.freeze([
    TRANSACTION_STATUS.COMPLETED,
    TRANSACTION_STATUS.SETTLED,
    TRANSACTION_STATUS.POSTED,
  ].filter(Boolean));


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
      String(
        error.message ||
        "Unknown error"
      ).slice(
        0,
        MAX_ERROR_MESSAGE_LENGTH
      ),

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
 * DUPLICATE / IDEMPOTENCY ERROR DETECTION
 * ============================================================================= */

function isDuplicateKeyError(error) {
  return Boolean(
    error &&
    (
      error.code === 11000 ||
      error.code === "DUPLICATE_KEY" ||
      error.code === "DUPLICATE_TRANSACTION" ||
      error.code === "TRANSACTION_ALREADY_EXISTS" ||
      error.code === "IDEMPOTENCY_CONFLICT" ||
      error.code === "IDEMPOTENCY_ALREADY_PROCESSED"
    )
  );
}


/**
 * =============================================================================
 * ALREADY PROCESSED ERROR DETECTION
 * ============================================================================= */

function isAlreadyProcessedError(error) {
  return Boolean(
    error &&
    (
      error.code ===
        "TRANSACTION_ALREADY_PROCESSED" ||

      error.code ===
        "ALREADY_PROCESSED" ||

      error.code ===
        "ALREADY_COMPLETED" ||

      error.code ===
        "IDEMPOTENCY_ALREADY_PROCESSED" ||

      error.alreadyProcessed === true ||

      error.alreadyCompleted === true
    )
  );
}


/**
 * =============================================================================
 * TRANSIENT ERROR CLASSIFICATION
 * ============================================================================= */

function isTransientError(error) {
  if (!error) {
    return false;
  }

  if (
    error.retryable === true
  ) {
    return true;
  }

  const transientCodes =
    new Set([
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "EAI_AGAIN",
      "ENETUNREACH",
      "EHOSTUNREACH",
      "NETWORK_ERROR",
      "SERVICE_UNAVAILABLE",
      "TIMEOUT",
      "TRANSACTION_TIMEOUT",
      "QUEUE_TIMEOUT",
      "MongoNetworkError",
      "MongoServerSelectionError",
      "MongoWriteConcernError",
      "MongoNotPrimaryError",
      "WriteConflict",
    ]);

  if (
    transientCodes.has(
      error.code
    )
  ) {
    return true;
  }

  const statusCode =
    Number(error.statusCode);

  return (
    statusCode === 408 ||
    statusCode === 425 ||
    statusCode === 429 ||
    statusCode >= 500
  );
}


/**
 * =============================================================================
 * PERMANENT FINANCIAL ERROR CLASSIFICATION
 * =============================================================================
 */

function isPermanentFinancialError(
  error
) {
  if (!error) {
    return false;
  }

  if (
    error.permanent === true
  ) {
    return true;
  }

  const permanentCodes =
    new Set([
      "INSUFFICIENT_FUNDS",
      "INVALID_TRANSACTION",
      "INVALID_ACCOUNT",
      "ACCOUNT_NOT_FOUND",
      "ACCOUNT_BLOCKED",
      "ACCOUNT_CLOSED",
      "TRANSACTION_NOT_ALLOWED",
      "INVALID_CURRENCY",
      "LIMIT_EXCEEDED",
      "KYC_REQUIRED",
      "AML_BLOCKED",
      "FRAUD_BLOCKED",
      "COMPLIANCE_BLOCKED",
      "TENANT_NOT_FOUND",
      "TENANT_SUSPENDED",
      "INVALID_TENANT",
      "INVALID_IDEMPOTENCY_KEY",
    ]);

  return permanentCodes.has(
    error.code
  );
}


/**
 * =============================================================================
 * RETRY DELAY
 * =============================================================================
 */

function calculateRetryDelay(
  attempt,
  options = {}
) {
  const normalizedAttempt =
    Math.max(
      1,
      Number.parseInt(
        attempt,
        10
      ) || 1
    );

  const initialDelayMs =
    Number.isFinite(
      Number(
        options.initialDelayMs
      )
    )
      ? Number(
          options.initialDelayMs
        )
      : (
          TRANSACTION_RETRY_POLICY &&
          Number(
            TRANSACTION_RETRY_POLICY.INITIAL_DELAY_MS
          )
        ) ||
        DEFAULT_BACKOFF_MS;

  const maxDelayMs =
    Number.isFinite(
      Number(
        options.maxDelayMs
      )
    )
      ? Number(
          options.maxDelayMs
        )
      : (
          TRANSACTION_RETRY_POLICY &&
          Number(
            TRANSACTION_RETRY_POLICY.MAX_BACKOFF_MS
          )
        ) ||
        MAX_BACKOFF_MS;

  const multiplier =
    (
      TRANSACTION_RETRY_POLICY &&
      Number(
        TRANSACTION_RETRY_POLICY.BACKOFF_MULTIPLIER
      )
    ) ||
    2;

  const exponentialDelay =
    initialDelayMs *
    Math.pow(
      multiplier,
      normalizedAttempt - 1
    );

  const cappedDelay =
    Math.min(
      exponentialDelay,
      maxDelayMs
    );

  const jitterEnabled =
    !(
      TRANSACTION_RETRY_POLICY &&
      TRANSACTION_RETRY_POLICY.USE_JITTER === false
    );

  if (!jitterEnabled) {
    return Math.floor(
      cappedDelay
    );
  }

  const jitter =
    Math.floor(
      Math.random() *
      Math.max(
        1,
        cappedDelay * 0.25
      )
    );

  return Math.min(
    maxDelayMs,
    Math.floor(
      cappedDelay + jitter
    )
  );
}


/**
 * =============================================================================
 * SAFE STRING
 * ============================================================================= */

function safeString(
  value,
  maxLength
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  return String(value)
    .trim()
    .slice(
      0,
      maxLength
    );
}


/**
 * =============================================================================
 * IDENTIFIER GENERATION
 * ============================================================================= */

function generateExecutionId() {
  return crypto
    .randomUUID();
}


/**
 * =============================================================================
 * TRANSACTION WORKER
 * =============================================================================
 */

class TransactionWorker {
  constructor(options = {}) {
    this.logger =
      createLogger(
        options.logger
      );

    this.service =
      options.transactionService ||
      TransactionService;

    this.model =
      options.model ||
      Transaction;

    this.queue =
      options.queue ||
      null;

    this.clock =
      options.clock ||
      (() => Date.now());

    this.jobName =
      options.jobName ||
      JOB_NAME;

    this.workerId =
      options.workerId ||
      process.env.TITECH_WORKER_ID ||
      `${this.jobName}:${process.pid}`;

    this.concurrency =
      Math.min(
        Math.max(
          Number.parseInt(
            options.concurrency ||
              DEFAULT_CONCURRENCY,
            10
          ),
          1
        ),
        MAX_CONCURRENCY
      );

    this.maxAttempts =
      Math.max(
        1,
        Number.parseInt(
          options.maxAttempts ||
            (
              TRANSACTION_RETRY_POLICY &&
              TRANSACTION_RETRY_POLICY.MAX_ATTEMPTS
            ) ||
            DEFAULT_ATTEMPTS,
          10
        )
      );

    this.timeoutMs =
      Math.max(
        1000,
        Number.parseInt(
          options.timeoutMs ||
            DEFAULT_TIMEOUT_MS,
          10
        )
      );

    this.lockDurationMs =
      Math.max(
        10000,
        Number.parseInt(
          options.lockDurationMs ||
            DEFAULT_LOCK_DURATION_MS,
          10
        )
      );

    this.stalledIntervalMs =
      Math.max(
        5000,
        Number.parseInt(
          options.stalledIntervalMs ||
            DEFAULT_STALLED_INTERVAL_MS,
          10
        )
      );

    this.running =
      false;

    this.stopping =
      false;

    this.activeJobs =
      new Map();

    this.stats = {
      started: 0,
      completed: 0,
      failed: 0,
      retried: 0,
      duplicateProtected: 0,
      alreadyProcessed: 0,
      permanentFailures: 0,
      timeoutFailures: 0,
      invalidJobs: 0,
      tenantViolations: 0,
    };
  }


  /**
   * ===========================================================================
   * CONFIGURATION VALIDATION
   * ===========================================================================
   */

  validateConfiguration() {
    if (!this.service) {
      throw new Error(
        "TransactionWorker requires TransactionService."
      );
    }

    if (
      typeof this.service.executeTransaction !==
      "function"
    ) {
      throw new Error(
        "TransactionService.executeTransaction() is required."
      );
    }

    return true;
  }


  /**
   * ===========================================================================
   * NORMALIZE JOB
   * ===========================================================================
   */

  normalizeJob(job) {
    if (!job) {
      throw this.createPermanentError(
        "INVALID_TRANSACTION_JOB",
        "Transaction queue job is missing."
      );
    }

    const data =
      job.data ||
      job.payload ||
      job;

    if (
      !data ||
      typeof data !== "object"
    ) {
      throw this.createPermanentError(
        "INVALID_TRANSACTION_JOB",
        "Transaction queue payload must be an object."
      );
    }

    const transactionId =
      safeString(
        data.transactionId ||
        data.transaction_id ||
        data.id,
        MAX_JOB_ID_LENGTH
      );

    const tenantId =
      safeString(
        data.tenantId ||
        data.tenant_id,
        MAX_TENANT_ID_LENGTH
      );

    const idempotencyKey =
      safeString(
        data.idempotencyKey ||
        data.idempotency_key ||
        data.transactionReference ||
        data.transactionRef ||
        data.reference,
        MAX_IDEMPOTENCY_KEY_LENGTH
      );

    const type =
      safeString(
        data.type ||
        data.transactionType,
        100
      );

    if (!transactionId) {
      throw this.createPermanentError(
        "INVALID_TRANSACTION_JOB",
        "Transaction job requires transactionId."
      );
    }

    if (!tenantId) {
      throw this.createPermanentError(
        "INVALID_TRANSACTION_JOB",
        "Transaction job requires tenantId."
      );
    }

    if (!idempotencyKey) {
      throw this.createPermanentError(
        "INVALID_IDEMPOTENCY_KEY",
        "Financial transaction job requires an immutable idempotency key or transaction reference."
      );
    }

    return {
      transactionId,

      tenantId,

      idempotencyKey,

      type,

      attempt:
        Number.parseInt(
          data.attempt ||
          job.attemptsMade ||
          0,
          10
        ) || 0,

      correlationId:
        safeString(
          data.correlationId ||
          data.correlation_id,
          200
        ),

      traceId:
        safeString(
          data.traceId ||
          data.trace_id,
          200
        ),

      requestedBy:
        safeString(
          data.requestedBy ||
          data.actorId ||
          data.userId,
          200
        ),

      source:
        safeString(
          data.source ||
          "transaction_queue",
          100
        ),

      payload: data,
    };
  }


  /**
   * ===========================================================================
   * CREATE ERROR
   * ===========================================================================
   */

  createPermanentError(
    code,
    message
  ) {
    const error =
      new Error(message);

    error.code =
      code;

    error.permanent =
      true;

    error.retryable =
      false;

    return error;
  }


  /**
   * ===========================================================================
   * TENANT VALIDATION
   * ===========================================================================
   *
   * The queue payload must carry the same tenant boundary expected by the
   * authoritative transaction service.
   *
   * A worker MUST NOT infer tenant ownership from a user-controlled field.
   * The transaction service remains responsible for authoritative ownership
   * validation.
   * ===========================================================================
   */

  async validateTenantContext(
    context
  ) {
    if (
      !context ||
      !context.tenantId
    ) {
      throw this.createPermanentError(
        "INVALID_TENANT",
        "Transaction worker requires tenant context."
      );
    }

    /**
     * If the transaction service provides an explicit tenant validation
     * method, use it before financial execution.
     */
    if (
      typeof this.service.validateTenantTransaction ===
      "function"
    ) {
      const valid =
        await this.service.validateTenantTransaction(
          context.transactionId,
          context.tenantId,
          {
            source:
              this.jobName,

            workerId:
              this.workerId,
          }
        );

      if (valid === false) {
        this.stats.tenantViolations += 1;

        throw this.createPermanentError(
          "TENANT_TRANSACTION_MISMATCH",
          "Transaction does not belong to the supplied tenant."
        );
      }
    }

    return true;
  }


  /**
   * ===========================================================================
   * IDEMPOTENCY PRE-CHECK
   * ===========================================================================
   *
   * This is an optimization and safety check.
   *
   * It does NOT replace the atomic idempotency guarantee inside the transaction
   * service/database.
   * ===========================================================================
   */

  async checkAlreadyProcessed(
    context
  ) {
    if (
      typeof this.service.isTransactionAlreadyProcessed !==
      "function"
    ) {
      return null;
    }

    const result =
      await this.service.isTransactionAlreadyProcessed(
        {
          transactionId:
            context.transactionId,

          tenantId:
            context.tenantId,

          idempotencyKey:
            context.idempotencyKey,
        },
        {
          source:
            this.jobName,

          workerId:
            this.workerId,
        }
      );

    if (
      !result
    ) {
      return null;
    }

    return (
      result === true
        ? {
            alreadyProcessed: true,
          }
        : result
    );
  }


  /**
   * ===========================================================================
   * EXECUTE TRANSACTION
   * ===========================================================================
   */

  async executeTransaction(
    context
  ) {
    const executionId =
      generateExecutionId();

    const startedAt =
      this.clock();

    this.stats.started += 1;

    this.activeJobs.set(
      context.transactionId,
      {
        executionId,
        startedAt,
        tenantId:
          context.tenantId,
      }
    );

    try {
      await this.validateTenantContext(
        context
      );

      /**
       * =======================================================================
       * PRE-CHECK
       * =======================================================================
       */

      const existing =
        await this.checkAlreadyProcessed(
          context
        );

      if (
        existing &&
        (
          existing.alreadyProcessed ||
          existing.completed ||
          existing.status ===
            TRANSACTION_STATUS.COMPLETED
        )
      ) {
        this.stats.alreadyProcessed += 1;
        this.stats.duplicateProtected += 1;

        return {
          success: true,

          alreadyProcessed: true,

          duplicateProtected: true,

          executionId,

          transactionId:
            context.transactionId,

          tenantId:
            context.tenantId,
        };
      }

      /**
       * =======================================================================
       * AUTHORITATIVE FINANCIAL EXECUTION
       * =======================================================================
       *
       * The service MUST own:
       *
       *   - balance mutation
       *   - ledger posting
       *   - transaction state
       *   - idempotency
       *   - concurrency control
       *   - database transaction/session handling
       */
      const serviceResult =
        await this.withTimeout(
          this.service.executeTransaction(
            context.payload,
            {
              transactionId:
                context.transactionId,

              tenantId:
                context.tenantId,

              idempotencyKey:
                context.idempotencyKey,

              executionId,

              workerId:
                this.workerId,

              source:
                context.source,

              jobName:
                this.jobName,

              correlationId:
                context.correlationId,

              traceId:
                context.traceId,

              requestedBy:
                context.requestedBy,

              attempt:
                context.attempt,

              /**
               * Explicitly identify this as asynchronous queue execution.
               */
              asynchronous:
                true,

              /**
               * Tells the service that duplicate protection is mandatory.
               */
              enforceIdempotency:
                true,
            }
          ),
          this.timeoutMs
        );

      /**
       * =======================================================================
       * RESULT NORMALIZATION
       * =======================================================================
       */

      if (
        serviceResult &&
        (
          serviceResult.alreadyProcessed ||
          serviceResult.alreadyCompleted ||
          serviceResult.duplicateProtected ||
          serviceResult.status ===
            TRANSACTION_STATUS.COMPLETED
        )
      ) {
        if (
          serviceResult.alreadyProcessed ||
          serviceResult.alreadyCompleted ||
          serviceResult.duplicateProtected
        ) {
          this.stats.duplicateProtected += 1;
        }

        this.stats.completed += 1;

        return {
          success: true,

          ...serviceResult,

          executionId,

          transactionId:
            context.transactionId,

          tenantId:
            context.tenantId,
        };
      }

      /**
       * A service result without an explicit failure is considered successful.
       *
       * The service is responsible for guaranteeing that the financial
       * operation has reached a safe durable state before returning success.
       */
      this.stats.completed += 1;

      return {
        success: true,

        ...(serviceResult || {}),

        executionId,

        transactionId:
          context.transactionId,

        tenantId:
          context.tenantId,
      };
    } finally {
      this.activeJobs.delete(
        context.transactionId
      );
    }
  }


  /**
   * ===========================================================================
   * PROCESS ONE QUEUE JOB
   * ===========================================================================
   */

  async processJob(
    job,
    options = {}
  ) {
    const startedAt =
      this.clock();

    let context = null;

    const jobId =
      safeString(
        job?.id ||
        job?.jobId,
        MAX_JOB_ID_LENGTH
      );

    try {
      context =
        this.normalizeJob(
          job
        );

      this.logger.info(
        {
          job:
            this.jobName,

          jobId,

          transactionId:
            context.transactionId,

          tenantId:
            context.tenantId,

          attempt:
            context.attempt,

          workerId:
            this.workerId,
        },
        "TITech transaction worker processing transaction job."
      );

      const result =
        await this.executeTransaction(
          context
        );

      this.logger.info(
        {
          job:
            this.jobName,

          jobId,

          transactionId:
            context.transactionId,

          tenantId:
            context.tenantId,

          durationMs:
            this.clock() -
            startedAt,

          duplicateProtected:
            result.duplicateProtected ||
            result.alreadyProcessed ||
            false,
        },
        "TITech transaction worker completed transaction job."
      );

      return {
        success: true,

        result,

        acknowledge: true,

        retry: false,

        deadLetter: false,
      };
    } catch (error) {
      const errorInfo =
        serializeError(
          error
        );

      const attempt =
        context
          ? context.attempt
          : (
              Number.parseInt(
                job?.attemptsMade ||
                0,
                10
              ) || 0
            );

      /**
       * =======================================================================
       * DUPLICATE / ALREADY PROCESSED
       * =======================================================================
       *
       * A duplicate idempotency record is NOT a reason to execute again.
       */
      if (
        isDuplicateKeyError(error) ||
        isAlreadyProcessedError(error)
      ) {
        this.stats.duplicateProtected += 1;
        this.stats.alreadyProcessed += 1;

        this.logger.warn(
          {
            job:
              this.jobName,

            jobId,

            transactionId:
              context?.transactionId ||
              null,

            tenantId:
              context?.tenantId ||
              null,

            error:
              errorInfo,
          },
          "TITech transaction worker detected an existing transaction/idempotency record; acknowledging without issuing another financial transaction."
        );

        return {
          success: true,

          duplicateProtected: true,

          alreadyProcessed: true,

          acknowledge: true,

          retry: false,

          deadLetter: false,
        };
      }

      /**
       * =======================================================================
       * PERMANENT FINANCIAL FAILURE
       * =======================================================================
       */

      if (
        isPermanentFinancialError(
          error
        )
      ) {
        this.stats.failed += 1;
        this.stats.permanentFailures += 1;

        this.logger.error(
          {
            job:
              this.jobName,

            jobId,

            transactionId:
              context?.transactionId ||
              null,

            tenantId:
              context?.tenantId ||
              null,

            error:
              errorInfo,
          },
          "TITech transaction worker encountered a permanent financial failure."
        );

        return {
          success: false,

          permanentFailure: true,

          acknowledge: false,

          retry: false,

          deadLetter: true,

          error:
            errorInfo,
        };
      }

      /**
       * =======================================================================
       * TRANSIENT / RETRYABLE FAILURE
       * =======================================================================
       */

      const retryable =
        isTransientError(
          error
        );

      if (
        retryable &&
        attempt < this.maxAttempts
      ) {
        this.stats.failed += 1;
        this.stats.retried += 1;

        if (
          error.code ===
            "REFERRAL_REWARD_TIMEOUT" ||
          error.code ===
            "TRANSACTION_TIMEOUT"
        ) {
          this.stats.timeoutFailures += 1;
        }

        const delayMs =
          calculateRetryDelay(
            attempt + 1
          );

        this.logger.warn(
          {
            job:
              this.jobName,

            jobId,

            transactionId:
              context?.transactionId ||
              null,

            tenantId:
              context?.tenantId ||
              null,

            attempt:

              attempt + 1,

            maxAttempts:
              this.maxAttempts,

            retryDelayMs:
              delayMs,

            error:
              errorInfo,
          },
          "TITech transaction worker encountered a retryable transaction failure."
        );

        return {
          success: false,

          retryable: true,

          acknowledge: false,

          retry: true,

          deadLetter: false,

          delayMs,

          error:
            errorInfo,
        };
      }

      /**
       * =======================================================================
       * UNKNOWN / MAX RETRIES
       * =======================================================================
       *
       * IMPORTANT:
       *
       * An unknown outcome must NOT automatically cause a second financial
       * transaction.
       *
       * The transaction service's idempotency mechanism remains the authority.
       */
      this.stats.failed += 1;
      this.stats.permanentFailures += 1;

      this.logger.error(
        {
          job:
            this.jobName,

          jobId,

          transactionId:
            context?.transactionId ||
            null,

          tenantId:
            context?.tenantId ||
            null,

          attempt,

          maxAttempts:
            this.maxAttempts,

          error:
            errorInfo,
        },
        "TITech transaction worker exhausted transaction retries or encountered an unclassified failure."
      );

      return {
        success: false,

        permanentFailure: true,

        acknowledge: false,

        retry: false,

        deadLetter: true,

        error:
          errorInfo,
      };
    }
  }


  /**
   * ===========================================================================
   * QUEUE-SPECIFIC PROCESSOR
   * ===========================================================================
   *
   * This method is compatible with queue libraries whose processor receives a
   * job object and expects the method to either resolve or throw.
   *
   * Returning successfully means the queue may acknowledge the job.
   *
   * Throwing means the queue may apply its configured retry strategy.
   * ===========================================================================
   */

  async processor(
    job
  ) {
    const result =
      await this.processJob(
        job
      );

    if (
      result.retry
    ) {
      const error =
        new Error(
          result.error?.message ||
          "Retryable transaction failure."
        );

      error.code =
        result.error?.code ||
        "TRANSACTION_RETRYABLE";

      error.retryable =
        true;

      error.retryDelayMs =
        result.delayMs;

      throw error;
    }

    if (
      result.deadLetter
    ) {
      const error =
        new Error(
          result.error?.message ||
          "Permanent transaction failure."
        );

      error.code =
        result.error?.code ||
        "TRANSACTION_PERMANENT_FAILURE";

      error.permanent =
        true;

      /**
       * Queue adapters can inspect this flag and route the job to a DLQ.
       */
      error.deadLetter =
        true;

      throw error;
    }

    /**
     * Duplicate/idempotent outcomes intentionally resolve successfully so the
     * queue does not execute the same financial operation again.
     */
    return result;
  }


  /**
   * ===========================================================================
   * START
   * ===========================================================================
   */

  async start() {
    if (
      this.running
    ) {
      return this;
    }

    this.validateConfiguration();

    this.stopping =
      false;

    this.running =
      true;

    /**
     * -------------------------------------------------------------------------
     * QUEUE ADAPTER
     * -------------------------------------------------------------------------
     *
     * Support common queue interfaces without forcing a particular queue
     * library into the worker.
     *
     * The preferred queue contract is:
     *
     *   queue.process(concurrency, processor)
     *
     * -------------------------------------------------------------------------
     */

    if (
      this.queue &&
      typeof this.queue.process ===
        "function"
    ) {
      this.queue.process(
        this.concurrency,
        this.processor.bind(this)
      );
    } else if (
      this.queue &&
      typeof this.queue.consume ===
        "function"
    ) {
      await this.queue.consume(
        this.processor.bind(this),
        {
          concurrency:
            this.concurrency,
        }
      );
    } else if (
      this.queue
    ) {
      this.logger.warn(
        {
          job:
            this.jobName,
        },
        "TITech transaction worker started without a recognized queue processor adapter."
      );
    }

    this.logger.info(
      {
        job:
          this.jobName,

        workerId:
          this.workerId,

        concurrency:
          this.concurrency,

        maxAttempts:
          this.maxAttempts,

        timeoutMs:
          this.timeoutMs,
      },
      "TITech transaction worker started."
    );

    return this;
  }


  /**
   * ===========================================================================
   * STOP
   * ===========================================================================
   */

  async stop(
    options = {}
  ) {
    this.stopping =
      true;

    this.logger.info(
      {
        job:
          this.jobName,

        workerId:
          this.workerId,

        activeJobs:
          this.activeJobs.size,
      },
      "Stopping TITech transaction worker gracefully."
    );

    /**
     * Stop accepting new work where supported.
     */
    if (
      this.queue
    ) {
      if (
        typeof this.queue.pause ===
          "function"
      ) {
        await this.queue.pause(
          true
        );
      }

      if (
        typeof this.queue.stop ===
          "function"
      ) {
        await this.queue.stop();
      }

      if (
        typeof this.queue.close ===
          "function"
      ) {
        await this.queue.close();
      }
    }

    /**
     * Wait for active jobs unless explicitly disabled.
     */
    if (
      options.waitForActive !== false &&
      this.activeJobs.size > 0
    ) {
      const deadline =
        this.clock() +
        (
          Number.isFinite(
            Number(
              options.timeoutMs
            )
          )
            ? Number(
                options.timeoutMs
              )
            : this.timeoutMs
        );

      while (
        this.activeJobs.size > 0 &&
        this.clock() < deadline
      ) {
        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              100
            )
        );
      }
    }

    this.running =
      false;

    this.logger.info(
      {
        job:
          this.jobName,

        workerId:
          this.workerId,

        activeJobs:
          this.activeJobs.size,
      },
      "TITech transaction worker stopped."
    );

    return true;
  }


  /**
   * ===========================================================================
   * TIMEOUT WRAPPER
   * ===========================================================================
   *
   * IMPORTANT:
   *
   * Timing out the worker does NOT cancel the underlying financial operation.
   *
   * Therefore a timeout MUST be treated as an unknown outcome and the next
   * attempt MUST rely on transaction idempotency before performing any mutation.
   * ===========================================================================
   */

  async withTimeout(
    promise,
    timeoutMs
  ) {
    let timeoutHandle;

    const timeoutPromise =
      new Promise(
        (_, reject) => {
          timeoutHandle =
            setTimeout(
              () => {
                const error =
                  new Error(
                    `Transaction execution timed out after ${timeoutMs}ms.`
                  );

                error.code =
                  "TRANSACTION_TIMEOUT";

                error.retryable =
                  true;

                /**
                 * Explicitly mark the outcome as unknown.
                 */
                error.outcomeUnknown =
                  true;

                reject(error);
              },
              timeoutMs
            );
        }
      );

    try {
      return await Promise.race([
        promise,
        timeoutPromise,
      ]);
    } finally {
      clearTimeout(
        timeoutHandle
      );
    }
  }


  /**
   * ===========================================================================
   * HEALTH
   * ===========================================================================
   */

  getHealth() {
    return {
      name:
        this.jobName,

      workerId:
        this.workerId,

      running:
        this.running,

      stopping:
        this.stopping,

      concurrency:
        this.concurrency,

      maxAttempts:
        this.maxAttempts,

      timeoutMs:
        this.timeoutMs,

      activeJobs:
        this.activeJobs.size,

      stats: {
        ...this.stats,
      },
    };
  }


  /**
   * ===========================================================================
   * METRICS
   * ===========================================================================
   */

  getMetrics() {
    return {
      ...this.stats,

      activeJobs:
        this.activeJobs.size,

      workerId:
        this.workerId,

      jobName:
        this.jobName,
    };
  }
}


/**
 * =============================================================================
 * FACTORY
 * =============================================================================
 */

function createTransactionWorker(
  options = {}
) {
  return new TransactionWorker(
    options
  );
}


/**
 * =============================================================================
 * DEFAULT SINGLETON
 * =============================================================================
 *
 * The singleton is intentionally created without a queue instance.
 *
 * Queue bootstrap code should inject the actual queue implementation:
 *
 *   const worker =
 *     createTransactionWorker({
 *       queue: transactionQueue,
 *     });
 *
 * This avoids importing and initializing queue infrastructure merely by
 * importing this module.
 * =============================================================================
 */

const transactionWorker =
  createTransactionWorker();


/**
 * =============================================================================
 * CONVENIENCE PROCESSOR
 * =============================================================================
 */

async function processTransactionJob(
  job,
  options = {}
) {
  const worker =
    options.worker ||
    transactionWorker;

  return worker.processJob(
    job,
    options
  );
}


/**
 * =============================================================================
 * CONVENIENCE STARTER
 * =============================================================================
 */

async function startTransactionWorker(
  options = {}
) {
  const worker =
    options.worker ||
    createTransactionWorker(
      options
    );

  return worker.start();
}


/**
 * =============================================================================
 * CONVENIENCE STOPPER
 * =============================================================================
 */

async function stopTransactionWorker(
  options = {}
) {
  return transactionWorker.stop(
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
    JOB_NAME,

    TERMINAL_STATUSES,

    SUCCESS_STATUSES,

    TransactionWorker,

    createTransactionWorker,

    transactionWorker,

    processTransactionJob,

    startTransactionWorker,

    stopTransactionWorker,

    calculateRetryDelay,

    isTransientError,

    isDuplicateKeyError,

    isAlreadyProcessedError,

    serializeError,
  });