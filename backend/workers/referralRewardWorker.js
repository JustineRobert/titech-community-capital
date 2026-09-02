"use strict";

/**
 * =============================================================================
 * TITech Community Capital
 * Enterprise Referral Reward Worker
 * =============================================================================
 *
 * File:
 *   backend/workers/referralRewardWorker.js
 *
 * Purpose:
 *   Background worker/orchestration boundary for referral reward jobs.
 *
 * Architecture
 * -----------------------------------------------------------------------------
 *
 *   Queue
 *      |
 *      v
 *   ReferralRewardWorker
 *      |
 *      +--> validate / normalize job
 *      |
 *      +--> derive deterministic idempotency key
 *      |
 *      +--> delegate business logic
 *      |
 *      v
 *   ReferralRewardService / Financial Service
 *      |
 *      +--> authorization / eligibility
 *      +--> reward policy
 *      +--> financial transaction
 *      +--> ledger posting
 *      +--> balance mutation
 *      +--> idempotency persistence
 *      +--> audit event
 *
 * IMPORTANT:
 * -----------------------------------------------------------------------------
 * This worker MUST NOT:
 *
 *   - directly mutate wallet balances
 *   - directly create ledger entries
 *   - directly approve referral rewards
 *   - contain financial policy
 *   - bypass the canonical financial transaction boundary
 *   - trust caller-supplied reward amounts without service validation
 *
 * The authoritative financial implementation belongs in the appropriate
 * financial/referral domain service.
 *
 * Enterprise Characteristics
 * -----------------------------------------------------------------------------
 * ✓ Tenant-aware
 * ✓ Deterministic job identity
 * ✓ Idempotency-aware
 * ✓ Duplicate-delivery tolerant
 * ✓ Retry-aware
 * ✓ Poison-job handling
 * ✓ Graceful shutdown
 * ✓ Structured logging
 * ✓ Correlation/request/job identifiers
 * ✓ Safe error classification
 * ✓ Runtime dependency injection
 * ✓ Queue-adapter agnostic
 * ✓ BullMQ-compatible processor shape
 * ✓ No secret/token logging
 * ✓ Financial-boundary isolation
 * ✓ Bounded concurrency
 * ✓ Job timeout support
 * ✓ Abort-aware execution
 * ✓ Dead-letter-compatible semantics
 * ✓ Backward-compatible CommonJS export
 *
 * =============================================================================
 */

/* =============================================================================
 * Dependencies
 * =============================================================================
 */

const crypto = require("node:crypto");

/**
 * Logger is the only mandatory project dependency.
 */
const logger = require("../utils/logger");

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const WORKER_NAME =
  "titech-referral-reward-worker";

const WORKER_VERSION = "1.0.0";

const DEFAULT_CONCURRENCY = 5;

const DEFAULT_JOB_TIMEOUT_MS =
  30 * 1000;

const DEFAULT_MAX_ATTEMPTS = 5;

const DEFAULT_BACKOFF_MS =
  1000;

const DEFAULT_MAX_BACKOFF_MS =
  60 * 1000;

const MAX_STRING_LENGTH = 512;

const MAX_METADATA_KEYS = 30;

const VALID_ACTOR_TYPES = Object.freeze([
  "SYSTEM",
  "USER",
  "ADMIN",
  "SERVICE",
]);

const REWARD_OPERATION =
  "REFERRAL_REWARD";

/**
 * =============================================================================
 * Error Types
 * =============================================================================
 */

class ReferralWorkerError extends Error {
  constructor(
    message,
    {
      code = "REFERRAL_WORKER_ERROR",
      retryable = true,
      cause = null,
      details = null,
    } = {}
  ) {
    super(message);

    this.name =
      "ReferralWorkerError";

    this.code = code;
    this.retryable = retryable;
    this.details = details;

    if (cause) {
      this.cause = cause;
    }

    Error.captureStackTrace?.(
      this,
      ReferralWorkerError
    );
  }
}

/**
 * Validation errors should not be retried forever.
 */
class ReferralJobValidationError extends ReferralWorkerError {
  constructor(
    message,
    details = null
  ) {
    super(message, {
      code:
        "REFERRAL_JOB_VALIDATION_ERROR",
      retryable: false,
      details,
    });

    this.name =
      "ReferralJobValidationError";
  }
}

/**
 * Permanent business failures.
 */
class ReferralRewardRejectedError extends ReferralWorkerError {
  constructor(
    message,
    details = null
  ) {
    super(message, {
      code:
        "REFERRAL_REWARD_REJECTED",
      retryable: false,
      details,
    });

    this.name =
      "ReferralRewardRejectedError";
  }
}

/**
 * Retryable infrastructure failures.
 */
class ReferralRewardRetryableError extends ReferralWorkerError {
  constructor(
    message,
    cause = null,
    details = null
  ) {
    super(message, {
      code:
        "REFERRAL_REWARD_RETRYABLE_ERROR",
      retryable: true,
      cause,
      details,
    });

    this.name =
      "ReferralRewardRetryableError";
  }
}

/**
 * =============================================================================
 * Utility Functions
 * =============================================================================
 */

/**
 * Normalize string input.
 */
function normalizeString(
  value,
  field,
  {
    required = false,
    maxLength = MAX_STRING_LENGTH,
  } = {}
) {
  if (
    value === undefined ||
    value === null
  ) {
    if (required) {
      throw new ReferralJobValidationError(
        `${field} is required`
      );
    }

    return null;
  }

  const normalized =
    String(value).trim();

  if (!normalized) {
    if (required) {
      throw new ReferralJobValidationError(
        `${field} is required`
      );
    }

    return null;
  }

  if (normalized.length > maxLength) {
    throw new ReferralJobValidationError(
      `${field} exceeds maximum length`
    );
  }

  return normalized;
}

/**
 * Validate a positive monetary amount.
 *
 * The worker deliberately does not decide reward eligibility or maximum
 * business limits. It only rejects malformed numerical inputs.
 */
function normalizeAmount(
  value,
  field = "rewardAmount"
) {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    if (value <= 0) {
      throw new ReferralJobValidationError(
        `${field} must be greater than zero`
      );
    }

    return value;
  }

  if (
    typeof value === "string" &&
    value.trim()
  ) {
    const parsed =
      Number(value);

    if (
      Number.isFinite(parsed) &&
      parsed > 0
    ) {
      return parsed;
    }
  }

  throw new ReferralJobValidationError(
    `${field} must be a valid positive number`
  );
}

/**
 * Validate tenant identity.
 *
 * TITech supports ObjectId tenant IDs in the current backend. We accept either
 * a Mongo ObjectId string or a string identifier so the worker remains usable
 * with tenant repositories that normalize identity themselves.
 */
function normalizeTenantId(
  tenantId
) {
  const normalized =
    normalizeString(
      tenantId,
      "tenantId",
      {
        required: true,
        maxLength: 128,
      }
    );

  if (!normalized) {
    throw new ReferralJobValidationError(
      "tenantId is required"
    );
  }

  return normalized;
}

/**
 * Metadata should remain small and safe.
 */
function sanitizeMetadata(
  metadata
) {
  if (
    metadata === null ||
    metadata === undefined
  ) {
    return {};
  }

  if (
    typeof metadata !== "object" ||
    Array.isArray(metadata)
  ) {
    throw new ReferralJobValidationError(
      "metadata must be an object"
    );
  }

  const entries =
    Object.entries(metadata)
      .slice(
        0,
        MAX_METADATA_KEYS
      );

  const result = {};

  for (const [
    key,
    value,
  ] of entries) {
    const normalizedKey =
      normalizeString(
        key,
        "metadata key",
        {
          required: true,
          maxLength: 128,
        }
      );

    /**
     * Never allow obvious secrets to be forwarded.
     */
    if (
      /password|secret|token|authorization|cookie|private.?key|api.?key|otp|pin/i.test(
        normalizedKey
      )
    ) {
      continue;
    }

    if (
      value === undefined ||
      value === null
    ) {
      continue;
    }

    if (
      typeof value === "string" &&
      value.length <= 512
    ) {
      result[normalizedKey] =
        value;
      continue;
    }

    if (
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      result[normalizedKey] =
        value;
    }
  }

  return result;
}

/**
 * Stable deterministic serialization.
 *
 * Used only for idempotency fingerprints. It is NOT a security signature.
 */
function stableSerialize(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "null";
  }

  if (
    typeof value !== "object"
  ) {
    return JSON.stringify(
      value
    );
  }

  if (Array.isArray(value)) {
    return `[${value
      .map(stableSerialize)
      .join(",")}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(
          key
        )}:${stableSerialize(
          value[key]
        )}`
    )
    .join(",")}}`;
}

/**
 * Derive a deterministic idempotency fingerprint.
 */
function createFingerprint(
  payload
) {
  return crypto
    .createHash("sha256")
    .update(
      stableSerialize(
        payload
      ),
      "utf8"
    )
    .digest("hex");
}

/**
 * Build an idempotency key when the producer did not supply one.
 *
 * IMPORTANT:
 *   This is deterministic from business identity, not from the transient
 *   queue job ID, so redelivery of the same business event maps to the same
 *   financial operation.
 */
function deriveIdempotencyKey(
  payload
) {
  if (
    payload.idempotencyKey
  ) {
    return normalizeString(
      payload.idempotencyKey,
      "idempotencyKey",
      {
        required: true,
        maxLength: 256,
      }
    );
  }

  const basis = {
    operation:
      REWARD_OPERATION,

    tenantId:
      payload.tenantId,

    referralId:
      payload.referralId || null,

    referrerUserId:
      payload.referrerUserId ||
      null,

    referredUserId:
      payload.referredUserId ||
      null,

    rewardCurrency:
      payload.currency || null,

    rewardAmount:
      payload.rewardAmount || null,

    sourceEventId:
      payload.sourceEventId ||
      null,

    rewardVersion:
      payload.rewardVersion ||
      1,
  };

  const digest =
    createFingerprint(
      basis
    );

  return `referral-reward:${digest}`;
}

/**
 * Determine whether the current error should be retried.
 */
function isRetryableError(
  error
) {
  if (!error) {
    return true;
  }

  if (
    typeof error.retryable ===
    "boolean"
  ) {
    return error.retryable;
  }

  /**
   * Common Mongo/network/transient conditions.
   */
  const transientCodes =
    new Set([
      "ETIMEDOUT",
      "ECONNRESET",
      "ECONNREFUSED",
      "ENETUNREACH",
      "MongoNetworkError",
      "MongoServerSelectionError",
      "WriteConflict",
      "TransientTransactionError",
      "UnknownTransactionCommitResult",
    ]);

  if (
    transientCodes.has(
      error.code
    )
  ) {
    return true;
  }

  if (
    error.name ===
      "MongoNetworkError" ||
    error.name ===
      "MongoServerSelectionError"
  ) {
    return true;
  }

  return false;
}

/**
 * Safe logger payload.
 *
 * Never include:
 *   raw request body
 *   financial secrets
 *   authentication tokens
 *   credentials
 */
function safeLogContext(
  context = {}
) {
  return {
    worker:
      WORKER_NAME,

    workerVersion:
      WORKER_VERSION,

    jobId:
      context.jobId || null,

    tenantId:
      context.tenantId || null,

    referralId:
      context.referralId || null,

    sourceEventId:
      context.sourceEventId ||
      null,

    idempotencyKey:
      context.idempotencyKey ||
      null,

    correlationId:
      context.correlationId ||
      null,

    requestId:
      context.requestId ||
      null,
  };
}

/**
 * =============================================================================
 * Dependency Resolution
 * =============================================================================
 */

/**
 * Optional dependency loader.
 *
 * The worker can be constructed with explicit dependencies:
 *
 *   new ReferralRewardWorker({
 *      referralRewardService,
 *   })
 *
 * It does not blindly require arbitrary modules during backend startup.
 */
function resolveReferralRewardService(
  suppliedService
) {
  if (suppliedService) {
    return suppliedService;
  }

  const candidatePaths =
    Object.freeze([
      "../services/referralReward.service",
      "../services/referralRewardService",
      "../services/referrals/referralReward.service",
      "../services/referrals/referralRewardService",
    ]);

  for (const modulePath of candidatePaths) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const loaded =
        require(modulePath);

      if (!loaded) {
        continue;
      }

      if (
        typeof loaded ===
        "function"
      ) {
        return new loaded();
      }

      if (
        loaded.default &&
        typeof loaded.default ===
          "function"
      ) {
        return new loaded.default();
      }

      if (
        loaded.referralRewardService
      ) {
        return loaded.referralRewardService;
      }

      if (
        typeof loaded.processReward ===
        "function"
      ) {
        return loaded;
      }
    } catch (error) {
      /**
       * Ignore only MODULE_NOT_FOUND for candidate discovery.
       * Any other error means the actual dependency exists but failed during
       * initialization and must surface.
       */
      if (
        error?.code !==
        "MODULE_NOT_FOUND"
      ) {
        throw error;
      }
    }
  }

  return null;
}

/**
 * =============================================================================
 * ReferralRewardWorker
 * =============================================================================
 */

class ReferralRewardWorker {
  constructor(config = {}) {
    this.name =
      config.name ||
      WORKER_NAME;

    this.version =
      config.version ||
      WORKER_VERSION;

    this.concurrency =
      Number.isInteger(
        config.concurrency
      ) &&
      config.concurrency > 0
        ? Math.min(
            config.concurrency,
            100
          )
        : DEFAULT_CONCURRENCY;

    this.jobTimeoutMs =
      Number.isFinite(
        config.jobTimeoutMs
      ) &&
      config.jobTimeoutMs > 0
        ? config.jobTimeoutMs
        : DEFAULT_JOB_TIMEOUT_MS;

    this.defaultMaxAttempts =
      Number.isInteger(
        config.maxAttempts
      ) &&
      config.maxAttempts > 0
        ? config.maxAttempts
        : DEFAULT_MAX_ATTEMPTS;

    this.defaultBackoffMs =
      Number.isFinite(
        config.backoffMs
      ) &&
      config.backoffMs >= 0
        ? config.backoffMs
        : DEFAULT_BACKOFF_MS;

    this.maxBackoffMs =
      Number.isFinite(
        config.maxBackoffMs
      ) &&
      config.maxBackoffMs > 0
        ? config.maxBackoffMs
        : DEFAULT_MAX_BACKOFF_MS;

    this.queue =
      config.queue || null;

    this.queueWorker =
      null;

    this.referralRewardService =
      resolveReferralRewardService(
        config.referralRewardService
      );

    this.financialOperationService =
      config.financialOperationService ||
      null;

    this.auditService =
      config.auditService ||
      null;

    this.metrics =
      config.metrics || null;

    this.running = false;

    this.stopping = false;

    this.activeJobs =
      new Set();

    this.processedJobs =
      0;

    this.failedJobs =
      0;

    this.retriedJobs =
      0;

    this.startedAt =
      null;

    this.shutdownPromise =
      null;
  }

  /**
   * ===========================================================================
   * Dependency Validation
   * ===========================================================================
   */

  validateDependencies() {
    if (
      !this.referralRewardService
    ) {
      throw new Error(
        `${this.name}: referralRewardService dependency is required`
      );
    }

    const service =
      this.referralRewardService;

    const supportedMethods = [
      "processReward",
      "issueReward",
      "grantReward",
      "processReferralReward",
    ];

    const supported =
      supportedMethods.some(
        (method) =>
          typeof service[
            method
          ] === "function"
      );

    if (!supported) {
      throw new Error(
        `${this.name}: referral reward service does not expose a supported reward-processing method`
      );
    }

    if (
      this.queue &&
      typeof this.queue.process !==
        "function" &&
      typeof this.queue.createWorker !==
        "function"
    ) {
      throw new Error(
        `${this.name}: queue adapter does not expose a supported worker interface`
      );
    }

    return true;
  }

  /**
   * ===========================================================================
   * Start
   * ===========================================================================
   *
   * Start is intentionally idempotent.
   */
  async start() {
    if (this.running) {
      return {
        started: false,
        idempotent: true,
        worker: this.name,
      };
    }

    if (this.stopping) {
      throw new Error(
        `${this.name}: cannot start while shutdown is in progress`
      );
    }

    this.validateDependencies();

    this.startedAt =
      new Date();

    this.running = true;

    logger.info(
      `[${this.name}] Worker started`,
      {
        worker:
          this.name,
        version:
          this.version,
        concurrency:
          this.concurrency,
        timeoutMs:
          this.jobTimeoutMs,
      }
    );

    /**
     * Queue adapter integration is deliberately explicit.
     *
     * Supported custom queue contract:
     *
     *   queue.process({
     *     concurrency,
     *     handler
     *   })
     *
     * OR:
     *
     *   queue.createWorker({
     *     name,
     *     concurrency,
     *     processor
     *   })
     */
    if (this.queue) {
      await this.attachQueue(
        this.queue
      );
    }

    return {
      started: true,
      worker: this.name,
      version: this.version,
      concurrency:
        this.concurrency,
    };
  }

  /**
   * ===========================================================================
   * Attach Queue
   * ===========================================================================
   */

  async attachQueue(
    queue
  ) {
    if (
      queue &&
      typeof queue.createWorker ===
        "function"
    ) {
      this.queueWorker =
        await queue.createWorker({
          name:
            this.name,

          concurrency:
            this.concurrency,

          processor:
            (job) =>
              this.processJob(
                job
              ),
        });

      return this.queueWorker;
    }

    if (
      queue &&
      typeof queue.process ===
        "function"
    ) {
      this.queueWorker =
        await queue.process({
          concurrency:
            this.concurrency,

          handler:
            (job) =>
              this.processJob(
                job
              ),
        });

      return this.queueWorker;
    }

    return null;
  }

  /**
   * ===========================================================================
   * Stop
   * ===========================================================================
   */

  async stop({
    reason = "shutdown",
    timeoutMs = 30 * 1000,
  } = {}) {
    if (
      this.shutdownPromise
    ) {
      return this.shutdownPromise;
    }

    this.shutdownPromise =
      (async () => {
        this.stopping = true;

        logger.info(
          `[${this.name}] Worker shutdown initiated`,
          {
            reason,
            activeJobs:
              this.activeJobs.size,
          }
        );

        try {
          if (
            this.queueWorker
          ) {
            if (
              typeof this
                .queueWorker.close ===
              "function"
            ) {
              await this.queueWorker.close();
            } else if (
              typeof this
                .queueWorker.stop ===
              "function"
            ) {
              await this.queueWorker.stop();
            }
          }

          const deadline =
            Date.now() +
            timeoutMs;

          while (
            this.activeJobs
              .size > 0 &&
            Date.now() <
              deadline
          ) {
            await new Promise(
              (resolve) =>
                setTimeout(
                  resolve,
                  100
                )
            );
          }

          if (
            this.activeJobs.size >
            0
          ) {
            logger.warn(
              `[${this.name}] Shutdown completed with active jobs still running`,
              {
                activeJobs:
                  this.activeJobs
                    .size,
                timeoutMs,
              }
            );
          }

          this.running = false;

          logger.info(
            `[${this.name}] Worker stopped`,
            {
              processedJobs:
                this.processedJobs,
              failedJobs:
                this.failedJobs,
              retriedJobs:
                this.retriedJobs,
            }
          );

          return {
            stopped: true,
            activeJobs:
              this.activeJobs.size,
            processedJobs:
              this.processedJobs,
            failedJobs:
              this.failedJobs,
            retriedJobs:
              this.retriedJobs,
          };
        } finally {
          this.running = false;
          this.stopping = false;
        }
      })();

    return this.shutdownPromise;
  }

  /**
   * ===========================================================================
   * Process Job
   * ===========================================================================
   *
   * This method is suitable as:
   *
   *   - BullMQ processor
   *   - custom queue handler
   *   - direct unit-test entry point
   *   - internal application worker adapter
   */
  async processJob(
    job
  ) {
    const executionId =
      crypto.randomUUID();

    const jobId =
      job?.id ||
      job?.jobId ||
      executionId;

    const rawPayload =
      job?.data !== undefined
        ? job.data
        : job?.payload !== undefined
          ? job.payload
          : job;

    const jobContext = {
      executionId,
      jobId,
      tenantId:
        rawPayload?.tenantId ||
        null,
      referralId:
        rawPayload?.referralId ||
        null,
      sourceEventId:
        rawPayload?.sourceEventId ||
        null,
      correlationId:
        rawPayload?.correlationId ||
        rawPayload?.correlationID ||
        null,
      requestId:
        rawPayload?.requestId ||
        null,
      idempotencyKey:
        rawPayload?.idempotencyKey ||
        null,
    };

    this.activeJobs.add(
      executionId
    );

    try {
      logger.info(
        `[${this.name}] Referral reward job received`,
        safeLogContext(
          jobContext
        )
      );

      const normalized =
        this.validateAndNormalizeJob(
          rawPayload
        );

      jobContext.tenantId =
        normalized.tenantId;

      jobContext.referralId =
        normalized.referralId;

      jobContext.sourceEventId =
        normalized.sourceEventId;

      jobContext.idempotencyKey =
        normalized.idempotencyKey;

      const result =
        await this.executeWithTimeout(
          normalized,
          jobContext
        );

      this.processedJobs += 1;

      logger.info(
        `[${this.name}] Referral reward job completed`,
        {
          ...safeLogContext(
            jobContext
          ),
          status:
            result?.status ||
            "completed",
          operationId:
            result?.operationId ||
            result?.transactionId ||
            null,
        }
      );

      await this.recordMetric(
        "success",
        normalized,
        result
      );

      return {
        success: true,
        ...result,
      };
    } catch (error) {
      this.failedJobs += 1;

      const normalizedError =
        this.normalizeProcessingError(
          error
        );

      const retryable =
        normalizedError.retryable;

      logger[
        retryable
          ? "warn"
          : "error"
      ](
        `[${this.name}] Referral reward job failed`,
        {
          ...safeLogContext(
            jobContext
          ),
          errorCode:
            normalizedError.code,
          retryable,
          error:
            normalizedError.message,
        }
      );

      await this.recordMetric(
        retryable
          ? "retryable_failure"
          : "permanent_failure",
        rawPayload,
        {
          errorCode:
            normalizedError.code,
        }
      );

      /**
       * Queue processors should throw for retryable failures.
       * The queue determines whether this becomes a retry/DLQ operation.
       */
      throw normalizedError;
    } finally {
      this.activeJobs.delete(
        executionId
      );
    }
  }

  /**
   * ===========================================================================
   * Validate + Normalize Job
   * ===========================================================================
   */

  validateAndNormalizeJob(
    payload
  ) {
    if (
      !payload ||
      typeof payload !==
        "object" ||
      Array.isArray(payload)
    ) {
      throw new ReferralJobValidationError(
        "Referral reward job payload is required"
      );
    }

    const tenantId =
      normalizeTenantId(
        payload.tenantId
      );

    const referralId =
      normalizeString(
        payload.referralId,
        "referralId",
        {
          required: false,
          maxLength: 128,
        }
      );

    const referrerUserId =
      normalizeString(
        payload.referrerUserId ||
          payload.referrerId,
        "referrerUserId",
        {
          required: false,
          maxLength: 128,
        }
      );

    const referredUserId =
      normalizeString(
        payload.referredUserId ||
          payload.referredId ||
          payload.userId,
        "referredUserId",
        {
          required: false,
          maxLength: 128,
        }
      );

    const sourceEventId =
      normalizeString(
        payload.sourceEventId ||
          payload.eventId,
        "sourceEventId",
        {
          required: false,
          maxLength: 256,
        }
      );

    const correlationId =
      normalizeString(
        payload.correlationId ||
          payload.correlationID,
        "correlationId",
        {
          required: false,
          maxLength: 256,
        }
      );

    const requestId =
      normalizeString(
        payload.requestId,
        "requestId",
        {
          required: false,
          maxLength: 256,
        }
      );

    const currency =
      normalizeString(
        payload.currency ||
          payload.rewardCurrency ||
          "UGX",
        "currency",
        {
          required: true,
          maxLength: 16,
        }
      )?.toUpperCase();

    const rewardAmount =
      normalizeAmount(
        payload.rewardAmount ??
          payload.amount,
        "rewardAmount"
      );

    const rewardVersion =
      Number.isInteger(
        payload.rewardVersion
      ) &&
      payload.rewardVersion > 0
        ? payload.rewardVersion
        : 1;

    const actorType =
      normalizeString(
        payload.actorType ||
          "SYSTEM",
        "actorType",
        {
          required: true,
          maxLength: 32,
        }
      )?.toUpperCase();

    if (
      !VALID_ACTOR_TYPES.includes(
        actorType
      )
    ) {
      throw new ReferralJobValidationError(
        "Invalid actorType"
      );
    }

    const metadata =
      sanitizeMetadata(
        payload.metadata
      );

    const normalized = {
      operation:
        REWARD_OPERATION,

      tenantId,

      referralId,

      referrerUserId,

      referredUserId,

      sourceEventId,

      correlationId,

      requestId,

      currency,

      rewardAmount,

      rewardVersion,

      actorType,

      metadata,

      /**
       * Optional policy/context fields.
       *
       * These are passed downstream but NOT interpreted here.
       */
      rewardReason:
        normalizeString(
          payload.rewardReason,
          "rewardReason",
          {
            required: false,
            maxLength: 256,
          }
        ),

      campaignId:
        normalizeString(
          payload.campaignId,
          "campaignId",
          {
            required: false,
            maxLength: 128,
          }
        ),

      referralCode:
        normalizeString(
          payload.referralCode,
          "referralCode",
          {
            required: false,
            maxLength: 128,
          }
        ),

      idempotencyKey:
        normalizeString(
          payload.idempotencyKey,
          "idempotencyKey",
          {
            required: false,
            maxLength: 256,
          }
        ),

      requestedAt:
        payload.requestedAt
          ? new Date(
              payload.requestedAt
            )
          : new Date(),
    };

    /**
     * Validate requestedAt without trusting it as an authoritative timestamp.
     */
    if (
      Number.isNaN(
        normalized.requestedAt.getTime()
      )
    ) {
      normalized.requestedAt =
        new Date();
    }

    normalized.idempotencyKey =
      deriveIdempotencyKey(
        normalized
      );

    /**
     * The worker requires at least one stable referral identity.
     */
    if (
      !normalized.referralId &&
      !normalized.referredUserId &&
      !normalized.sourceEventId
    ) {
      throw new ReferralJobValidationError(
        "Referral job requires referralId, referredUserId, or sourceEventId"
      );
    }

    /**
     * Prevent pathological self-referral jobs at the orchestration boundary.
     *
     * Business eligibility rules remain authoritative in the domain service.
     */
    if (
      normalized.referrerUserId &&
      normalized.referredUserId &&
      normalized.referrerUserId ===
        normalized.referredUserId
    ) {
      throw new ReferralRewardRejectedError(
        "Referrer and referred user cannot be identical"
      );
    }

    return Object.freeze(
      normalized
    );
  }

  /**
   * ===========================================================================
   * Execute Reward With Timeout
   * ===========================================================================
   */

  async executeWithTimeout(
    payload,
    jobContext
  ) {
    const timeoutMs =
      this.jobTimeoutMs;

    let timeoutHandle =
      null;

    let timedOut = false;

    const controller =
      new AbortController();

    const work =
      this.invokeRewardService(
        payload,
        {
          ...jobContext,
          signal:
            controller.signal,
        }
      );

    const timeout =
      new Promise(
        (_, reject) => {
          timeoutHandle =
            setTimeout(() => {
              timedOut = true;

              controller.abort();

              reject(
                new ReferralRewardRetryableError(
                  "Referral reward processing exceeded worker timeout"
                )
              );
            }, timeoutMs);
        }
      );

    try {
      return await Promise.race([
        work,
        timeout,
      ]);
    } catch (error) {
      if (
        timedOut &&
        !error.retryable
      ) {
        throw new ReferralRewardRetryableError(
          "Referral reward processing timed out",
          error
        );
      }

      throw error;
    } finally {
      if (timeoutHandle) {
        clearTimeout(
          timeoutHandle
        );
      }
    }
  }

  /**
   * ===========================================================================
   * Invoke Referral Reward Domain Service
   * ===========================================================================
   */

  async invokeRewardService(
    payload,
    context
  ) {
    const service =
      this.referralRewardService;

    if (!service) {
      throw new ReferralRewardRetryableError(
        "Referral reward service is unavailable"
      );
    }

    /**
     * Preferred canonical method.
     */
    if (
      typeof service.processReward ===
      "function"
    ) {
      return this.handleServiceResult(
        service.processReward(
          payload,
          context
        )
      );
    }

    /**
     * Compatibility methods.
     */
    if (
      typeof service.processReferralReward ===
      "function"
    ) {
      return this.handleServiceResult(
        service.processReferralReward(
          payload,
          context
        )
      );
    }

    if (
      typeof service.issueReward ===
      "function"
    ) {
      return this.handleServiceResult(
        service.issueReward(
          payload,
          context
        )
      );
    }

    if (
      typeof service.grantReward ===
      "function"
    ) {
      return this.handleServiceResult(
        service.grantReward(
          payload,
          context
        )
      );
    }

    throw new ReferralRewardRejectedError(
      "Referral reward service does not implement a supported processing method"
    );
  }

  /**
   * ===========================================================================
   * Normalize Domain-Service Result
   * ===========================================================================
   */

  async handleServiceResult(
    promiseOrResult
  ) {
    try {
      const result =
        await promiseOrResult;

      /**
       * The downstream service is authoritative.
       *
       * A result such as:
       *
       *   { status: "already_processed" }
       *
       * is considered successful because idempotent duplicate delivery is
       * expected in distributed queues.
       */
      if (
        result &&
        result.success === false
      ) {
        const retryable =
          result.retryable === true;

        if (retryable) {
          throw new ReferralRewardRetryableError(
            result.message ||
              "Referral reward processing failed",
            null,
            result
          );
        }

        throw new ReferralRewardRejectedError(
          result.message ||
            "Referral reward was rejected",
          result
        );
      }

      return (
        result || {
          status:
            "completed",
        }
      );
    } catch (error) {
      if (
        error instanceof
          ReferralWorkerError
      ) {
        throw error;
      }

      /**
       * Respect explicit retryability on domain errors.
       */
      if (
        typeof error?.retryable ===
        "boolean"
      ) {
        if (error.retryable) {
          throw new ReferralRewardRetryableError(
            error.message ||
              "Retryable referral reward failure",
            error
          );
        }

        throw new ReferralRewardRejectedError(
          error.message ||
            "Referral reward rejected",
          {
            originalCode:
              error.code ||
              null,
          }
        );
      }

      if (
        isRetryableError(
          error
        )
      ) {
        throw new ReferralRewardRetryableError(
          error.message ||
            "Transient referral reward processing failure",
          error
        );
      }

      throw error;
    }
  }

  /**
   * ===========================================================================
   * Retry Policy
   * ===========================================================================
   *
   * This method is useful to queue adapters that want the worker to provide
   * retry metadata rather than embedding queue-specific retry mechanics here.
   */
  getRetryPolicy(
    attempt = 1,
    maxAttempts =
      this.defaultMaxAttempts
  ) {
    const normalizedAttempt =
      Math.max(
        1,
        Number(attempt) || 1
      );

    const normalizedMaxAttempts =
      Math.max(
        1,
        Number(maxAttempts) ||
          this.defaultMaxAttempts
      );

    const delay =
      Math.min(
        this.defaultBackoffMs *
          2 **
            Math.max(
              0,
              normalizedAttempt -
                1
            ),
        this.maxBackoffMs
      );

    return {
      attempt:
        normalizedAttempt,

      maxAttempts:
        normalizedMaxAttempts,

      retryable:
        normalizedAttempt <
        normalizedMaxAttempts,

      delayMs:
        delay,
    };
  }

  /**
   * ===========================================================================
   * Queue Failure Classification
   * ===========================================================================
   */

  classifyFailure(
    error,
    {
      attempt = 1,
      maxAttempts =
        this.defaultMaxAttempts,
    } = {}
  ) {
    const normalized =
      this.normalizeProcessingError(
        error
      );

    const policy =
      this.getRetryPolicy(
        attempt,
        maxAttempts
      );

    return {
      code:
        normalized.code,

      message:
        normalized.message,

      retryable:
        normalized.retryable &&
        policy.retryable,

      exhausted:
        normalized.retryable &&
        !policy.retryable,

      delayMs:
        normalized.retryable
          ? policy.delayMs
          : 0,
    };
  }

  /**
   * ===========================================================================
   * Error Normalization
   * ===========================================================================
   */

  normalizeProcessingError(
    error
  ) {
    if (
      error instanceof
      ReferralWorkerError
    ) {
      return error;
    }

    if (
      isRetryableError(
        error
      )
    ) {
      return new ReferralRewardRetryableError(
        error?.message ||
          "Transient referral reward processing failure",
        error
      );
    }

    return new ReferralWorkerError(
      error?.message ||
        "Referral reward processing failed",
      {
        code:
          error?.code ||
          "REFERRAL_WORKER_PROCESSING_ERROR",

        retryable: false,

        cause: error,
      }
    );
  }

  /**
   * ===========================================================================
   * Metrics
   * ===========================================================================
   */

  async recordMetric(
    type,
    payload = {},
    result = null
  ) {
    if (!this.metrics) {
      return;
    }

    try {
      if (
        typeof this.metrics.increment ===
        "function"
      ) {
        await this.metrics.increment(
          "titech_referral_reward_worker_jobs_total",
          {
            worker:
              this.name,
            result:
              type,
          }
        );
      }

      if (
        typeof this.metrics.observe ===
        "function"
      ) {
        await this.metrics.observe(
          "titech_referral_reward_worker_reward_amount",
          Number(
            payload?.rewardAmount ||
              0
          ),
          {
            currency:
              payload?.currency ||
              "UGX",
          }
        );
      }

      void result;
    } catch (error) {
      /**
       * Observability failure must never cause a financial job to fail.
       */
      logger.warn(
        `[${this.name}] Metrics reporting failed`,
        {
          error:
            error.message,
        }
      );
    }
  }

  /**
   * ===========================================================================
   * Health
   * ===========================================================================
   */

  getHealth() {
    return {
      ok:
        this.running &&
        !this.stopping,

      worker:
        this.name,

      version:
        this.version,

      running:
        this.running,

      stopping:
        this.stopping,

      concurrency:
        this.concurrency,

      activeJobs:
        this.activeJobs.size,

      processedJobs:
        this.processedJobs,

      failedJobs:
        this.failedJobs,

      retriedJobs:
        this.retriedJobs,

      startedAt:
        this.startedAt,

      uptimeMs:
        this.startedAt
          ? Date.now() -
            this.startedAt.getTime()
          : 0,

      dependencyReady:
        Boolean(
          this.referralRewardService
        ),
    };
  }

  /**
   * ===========================================================================
   * Readiness
   * ===========================================================================
   */

  isReady() {
    return (
      this.running &&
      !this.stopping &&
      Boolean(
        this.referralRewardService
      )
    );
  }

  /**
   * ===========================================================================
   * Queue Configuration Helper
   * ===========================================================================
   *
   * Returns queue-independent configuration suitable for BullMQ-like systems.
   */
  getQueueOptions() {
    return {
      concurrency:
        this.concurrency,

      settings: {
        stalledInterval:
          30_000,

        maxStalledCount: 2,
      },

      autorun: false,
    };
  }
}

/**
 * =============================================================================
 * Factory
 * =============================================================================
 */

function createReferralRewardWorker(
  config = {}
) {
  return new ReferralRewardWorker(
    config
  );
}

/**
 * =============================================================================
 * Default Singleton
 * =============================================================================
 *
 * No queue is started automatically on module import.
 *
 * This is intentional:
 *
 *   require("./workers/referralRewardWorker")
 *
 * must remain side-effect safe and must not accidentally start a worker during
 * HTTP application bootstrap or test discovery.
 *
 * The canonical bootstrap/lifecycle layer should explicitly call:
 *
 *   worker.start()
 *
 * and:
 *
 *   worker.stop()
 */
const referralRewardWorker =
  createReferralRewardWorker();

/**
 * =============================================================================
 * Process-Signal Integration
 * =============================================================================
 *
 * Signal installation is intentionally opt-in.
 */
function installProcessHandlers(
  worker = referralRewardWorker
) {
  const shutdown =
    async (signal) => {
      try {
        await worker.stop({
          reason: signal,
        });
      } catch (error) {
        logger.error(
          `[${worker.name}] Worker shutdown failed`,
          {
            signal,
            error:
              error.message,
          }
        );
      }
    };

  const handlers = {
    SIGTERM:
      () => shutdown("SIGTERM"),

    SIGINT:
      () => shutdown("SIGINT"),
  };

  process.once(
    "SIGTERM",
    handlers.SIGTERM
  );

  process.once(
    "SIGINT",
    handlers.SIGINT
  );

  return () => {
    process.removeListener(
      "SIGTERM",
      handlers.SIGTERM
    );

    process.removeListener(
      "SIGINT",
      handlers.SIGINT
    );
  };
}

/**
 * =============================================================================
 * Exports
 * =============================================================================
 */

module.exports = referralRewardWorker;

module.exports.ReferralRewardWorker =
  ReferralRewardWorker;

module.exports.createReferralRewardWorker =
  createReferralRewardWorker;

module.exports.ReferralWorkerError =
  ReferralWorkerError;

module.exports.ReferralJobValidationError =
  ReferralJobValidationError;

module.exports.ReferralRewardRejectedError =
  ReferralRewardRejectedError;

module.exports.ReferralRewardRetryableError =
  ReferralRewardRetryableError;

module.exports.deriveIdempotencyKey =
  deriveIdempotencyKey;

module.exports.createFingerprint =
  createFingerprint;

module.exports.installProcessHandlers =
  installProcessHandlers;