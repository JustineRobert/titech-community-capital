"use strict";

/**
 * =============================================================================
 * TITech Community Capital
 * Enterprise Referral Reward Queue
 * =============================================================================
 *
 * File:
 *   backend/queues/referralRewardQueue.js
 *
 * Purpose:
 *   Durable asynchronous orchestration for referral reward processing.
 *
 * Architectural responsibility:
 *
 *   Referral
 *       │
 *       ▼
 *   ReferralReward
 *       │
 *       ▼
 *   ReferralRewardQueue
 *       │
 *       ├── deterministic job identity
 *       ├── tenant isolation
 *       ├── bounded retry policy
 *       ├── exponential backoff + jitter
 *       ├── worker lifecycle
 *       ├── concurrency control
 *       ├── stalled-job recovery
 *       ├── graceful shutdown
 *       └── operational health
 *       │
 *       ▼
 *   ReferralRewardService
 *       │
 *       ▼
 *   Financial Transaction / Ledger
 *
 * =============================================================================
 * FINANCIAL SAFETY MODEL
 * =============================================================================
 *
 * This queue is NOT the financial ledger.
 *
 * It MUST NOT:
 *
 *   - calculate or mutate balances directly
 *   - create ledger entries directly
 *   - transfer money directly
 *   - trust arbitrary client-supplied reward amounts
 *   - assume queue delivery is exactly-once
 *
 * The queue provides AT-LEAST-ONCE delivery.
 *
 * Therefore:
 *
 *   Queue delivery
 *       ↓
 *   deterministic reward identity
 *       ↓
 *   ReferralRewardService
 *       ↓
 *   financial idempotency key
 *       ↓
 *   transactional ledger operation
 *
 * The downstream service MUST remain idempotent.
 *
 * =============================================================================
 * DUPLICATE-PAYMENT PROTECTION
 * =============================================================================
 *
 * A queue can legally deliver the same logical reward more than once because:
 *
 *   - a worker may crash after issuing a reward
 *   - acknowledgement may be lost
 *   - a process may restart
 *   - a queue broker may redeliver
 *   - two recovery workers may race
 *
 * Consequently:
 *
 *   queue jobId !== financial idempotency
 *
 * The immutable reward identity is propagated to the service.
 *
 * Preferred idempotency identity:
 *
 *   reward.idempotencyKey
 *        OR
 *   reward.rewardReference
 *        OR
 *   reward._id
 *
 * The ReferralRewardService must enforce the final financial uniqueness.
 *
 * =============================================================================
 * SUPPORTED QUEUE IMPLEMENTATIONS
 * =============================================================================
 *
 * This module supports:
 *
 *   1. BullMQ-compatible queues
 *   2. Bull-compatible queues
 *   3. Dependency injection for tests/custom queue adapters
 *
 * The application should inject the actual configured queue where possible.
 *
 * =============================================================================
 */

const crypto = require("crypto");
const mongoose = require("mongoose");

const {
  REFERRAL_REWARD_STATUS,
  REFERRAL_RETRY_POLICY,
} = require("../constants/referralConstants");


/**
 * =============================================================================
 * OPTIONAL SERVICE IMPORT
 * =============================================================================
 */

let ReferralRewardService = null;

try {
  ReferralRewardService = require("../services/referralRewardService");
} catch (error) {
  ReferralRewardService = null;
}


/**
 * =============================================================================
 * OPTIONAL MODEL IMPORT
 * =============================================================================
 *
 * The queue does not require the model for enqueueing, but it is useful for
 * validating reward existence and tenant ownership before creating work.
 *
 * The validation remains optional so tests can inject a model or operate with
 * an existing queue-only architecture.
 * =============================================================================
 */

let ReferralReward = null;

try {
  ReferralReward = require("../models/ReferralReward");
} catch (error) {
  ReferralReward = null;
}


/**
 * =============================================================================
 * CONSTANTS
 * =============================================================================
 */

const JOB_NAME = "titech-referral-reward";

const QUEUE_NAME =
  process.env.TITECH_REFERRAL_REWARD_QUEUE_NAME ||
  "titech-referral-rewards";

const DEFAULT_CONCURRENCY = 5;

const MAX_CONCURRENCY = 100;

const DEFAULT_ATTEMPTS =
  Number.parseInt(
    process.env.TITECH_REFERRAL_REWARD_MAX_ATTEMPTS,
    10
  ) ||
  Number.parseInt(
    REFERRAL_RETRY_POLICY?.MAX_ATTEMPTS,
    10
  ) ||
  5;

const DEFAULT_BACKOFF_MS =
  Number.parseInt(
    process.env.TITECH_REFERRAL_REWARD_INITIAL_DELAY_MS,
    10
  ) ||
  Number.parseInt(
    REFERRAL_RETRY_POLICY?.INITIAL_DELAY_MS,
    10
  ) ||
  1000;

const DEFAULT_MAX_BACKOFF_MS =
  Number.parseInt(
    process.env.TITECH_REFERRAL_REWARD_MAX_BACKOFF_MS,
    10
  ) ||
  Number.parseInt(
    REFERRAL_RETRY_POLICY?.MAX_BACKOFF_MS,
    10
  ) ||
  5 * 60 * 1000;

const DEFAULT_BACKOFF_MULTIPLIER =
  Number(
    REFERRAL_RETRY_POLICY?.BACKOFF_MULTIPLIER
  ) || 2;

const DEFAULT_STALLED_INTERVAL_MS =
  Number.parseInt(
    process.env.TITECH_REFERRAL_REWARD_STALLED_INTERVAL_MS,
    10
  ) || 30_000;

const DEFAULT_LOCK_DURATION_MS =
  Number.parseInt(
    process.env.TITECH_REFERRAL_REWARD_LOCK_DURATION_MS,
    10
  ) || 60_000;

const DEFAULT_REMOVE_ON_COMPLETE =
  process.env.TITECH_REFERRAL_REWARD_REMOVE_ON_COMPLETE !==
    "false";

const DEFAULT_REMOVE_ON_FAIL =
  process.env.TITECH_REFERRAL_REWARD_REMOVE_ON_FAIL ===
    "true";

const MAX_JOB_ID_LENGTH = 200;

const MAX_ERROR_LENGTH = 1000;


/**
 * =============================================================================
 * STATUS HELPERS
 * =============================================================================
 */

const TERMINAL_REWARD_STATUSES = Object.freeze([
  REFERRAL_REWARD_STATUS.ISSUED,
  REFERRAL_REWARD_STATUS.REVERSED,
  REFERRAL_REWARD_STATUS.CANCELLED,
]);

const PROCESSABLE_REWARD_STATUSES = Object.freeze([
  REFERRAL_REWARD_STATUS.PENDING,
  REFERRAL_REWARD_STATUS.ELIGIBLE,
  REFERRAL_REWARD_STATUS.RETRYING,
  REFERRAL_REWARD_STATUS.FAILED,
]);


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
    info: (...args) => console.info(...args),
    warn: (...args) => console.warn(...args),
    error: (...args) => console.error(...args),
    debug: (...args) => console.debug(...args),
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
    };
  }

  return {
    name: String(error.name || "Error"),
    message: String(
      error.message || "Unknown error"
    ).slice(0, MAX_ERROR_LENGTH),
    code:
      error.code !== undefined &&
      error.code !== null
        ? String(error.code)
        : null,
  };
}


/**
 * =============================================================================
 * OBJECT ID NORMALIZATION
 * =============================================================================
 */

function normalizeObjectId(value) {
  if (!value) {
    return null;
  }

  if (
    value instanceof mongoose.Types.ObjectId
  ) {
    return value;
  }

  if (
    typeof value === "string" &&
    mongoose.Types.ObjectId.isValid(value)
  ) {
    return new mongoose.Types.ObjectId(value);
  }

  return null;
}


/**
 * =============================================================================
 * DETERMINISTIC REWARD IDENTITY
 * =============================================================================
 *
 * IMPORTANT:
 *
 * Never use Date.now(), Math.random(), or UUID-only identity for the logical
 * reward job because every enqueue attempt would become a different job.
 *
 * The logical reward identity must remain stable.
 * =============================================================================
 */

function getRewardIdentity(reward) {
  if (!reward) {
    return null;
  }

  return (
    reward.idempotencyKey ||
    reward.rewardReference ||
    reward.rewardIdempotencyKey ||
    reward._id ||
    null
  );
}


/**
 * =============================================================================
 * DETERMINISTIC JOB ID
 * =============================================================================
 */

function buildJobId(rewardOrId) {
  const identity =
    typeof rewardOrId === "object"
      ? getRewardIdentity(rewardOrId)
      : rewardOrId;

  if (!identity) {
    throw new Error(
      "Referral reward queue requires a stable reward identity."
    );
  }

  const normalized =
    String(identity)
      .trim()
      .replace(/[^a-zA-Z0-9:_-]/g, "-");

  if (!normalized) {
    throw new Error(
      "Referral reward identity cannot be empty."
    );
  }

  /**
   * Keep the queue job ID bounded.
   *
   * The hash ensures that truncation does not create collisions.
   */
  if (
    normalized.length <=
    MAX_JOB_ID_LENGTH
  ) {
    return `${JOB_NAME}:${normalized}`;
  }

  const digest =
    crypto
      .createHash("sha256")
      .update(normalized)
      .digest("hex");

  return `${JOB_NAME}:${digest}`;
}


/**
 * =============================================================================
 * RETRY DELAY
 * =============================================================================
 */

function calculateBackoff(
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

  const initialDelay =
    Math.max(
      1,
      Number(
        options.initialDelayMs ||
          DEFAULT_BACKOFF_MS
      )
    );

  const multiplier =
    Number(
      options.multiplier ||
        DEFAULT_BACKOFF_MULTIPLIER
    );

  const maxDelay =
    Math.max(
      initialDelay,
      Number(
        options.maxDelayMs ||
          DEFAULT_MAX_BACKOFF_MS
      )
    );

  const exponential =
    initialDelay *
    Math.pow(
      multiplier,
      normalizedAttempt - 1
    );

  const capped =
    Math.min(
      exponential,
      maxDelay
    );

  const jitter =
    options.jitter === false
      ? 0
      : Math.floor(
          Math.random() *
          Math.max(
            1,
            capped * 0.25
          )
        );

  return Math.min(
    maxDelay,
    Math.floor(
      capped + jitter
    )
  );
}


/**
 * =============================================================================
 * RETRYABLE ERROR CLASSIFICATION
 * =============================================================================
 */

function isRetryableError(error) {
  if (!error) {
    return false;
  }

  if (
    error.retryable === true
  ) {
    return true;
  }

  if (
    error.permanent === true
  ) {
    return false;
  }

  const transientCodes =
    new Set([
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "EAI_AGAIN",
      "TIMEOUT",
      "NETWORK_ERROR",
      "SERVICE_UNAVAILABLE",
      "RATE_LIMITED",
      "MongoNetworkError",
      "MongoServerSelectionError",
      "MongoWriteConcernError",
      "WriteConflict",
      "TransientTransactionError",
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
    statusCode === 429 ||
    statusCode >= 500
  );
}


/**
 * =============================================================================
 * FRAUD / MANUAL REVIEW CLASSIFICATION
 * =============================================================================
 */

function requiresFraudReview(error) {
  if (!error) {
    return false;
  }

  return [
    "REFERRAL_FRAUD_REVIEW",
    "REFERRAL_FRAUD_BLOCKED",
    "FRAUD_REVIEW_REQUIRED",
    "REFERRAL_RISK_REVIEW",
  ].includes(
    String(error.code)
  );
}


/**
 * =============================================================================
 * DUPLICATE / ALREADY ISSUED CLASSIFICATION
 * =============================================================================
 */

function isDuplicateOrAlreadyProcessed(
  error
) {
  if (!error) {
    return false;
  }

  if (
    error.alreadyIssued === true ||
    error.alreadyProcessed === true
  ) {
    return true;
  }

  if (
    error.code === 11000 ||
    error.code ===
      "DUPLICATE_KEY" ||
    error.code ===
      "REWARD_ALREADY_ISSUED" ||
    error.code ===
      "REFERRAL_REWARD_ALREADY_ISSUED" ||
    error.code ===
      "IDEMPOTENCY_CONFLICT"
  ) {
    return true;
  }

  return false;
}


/**
 * =============================================================================
 * QUEUE ADAPTER DETECTION
 * =============================================================================
 */

function isBullMqQueue(queue) {
  return Boolean(
    queue &&
    typeof queue.add === "function"
  );
}


/**
 * =============================================================================
 * JOB CLASS
 * =============================================================================
 */

class ReferralRewardQueue {
  constructor(options = {}) {
    this.logger =
      createLogger(
        options.logger
      );

    this.queue =
      options.queue ||
      null;

    this.model =
      options.model ||
      ReferralReward;

    this.rewardService =
      options.rewardService ||
      ReferralRewardService;

    this.queueName =
      options.queueName ||
      QUEUE_NAME;

    this.jobName =
      options.jobName ||
      JOB_NAME;

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

    this.attempts =
      Math.max(
        1,
        Number.parseInt(
          options.attempts ||
            DEFAULT_ATTEMPTS,
          10
        )
      );

    this.backoffInitialMs =
      Math.max(
        1,
        Number(
          options.backoffInitialMs ||
            DEFAULT_BACKOFF_MS
        )
      );

    this.backoffMaxMs =
      Math.max(
        this.backoffInitialMs,
        Number(
          options.backoffMaxMs ||
            DEFAULT_MAX_BACKOFF_MS
        )
      );

    this.backoffMultiplier =
      Number(
        options.backoffMultiplier ||
          DEFAULT_BACKOFF_MULTIPLIER
      );

    this.stalledIntervalMs =
      Math.max(
        5_000,
        Number(
          options.stalledIntervalMs ||
            DEFAULT_STALLED_INTERVAL_MS
        )
      );

    this.lockDurationMs =
      Math.max(
        5_000,
        Number(
          options.lockDurationMs ||
            DEFAULT_LOCK_DURATION_MS
        )
      );

    this.removeOnComplete =
      options.removeOnComplete !==
      undefined
        ? options.removeOnComplete
        : DEFAULT_REMOVE_ON_COMPLETE;

    this.removeOnFail =
      options.removeOnFail !==
      undefined
        ? options.removeOnFail
        : DEFAULT_REMOVE_ON_FAIL;

    this.running = false;

    this.stopping = false;

    this.worker = null;

    this.startedAt = null;

    this.metrics = {
      enqueued: 0,
      duplicates: 0,
      processed: 0,
      issued: 0,
      alreadyIssued: 0,
      skipped: 0,
      failed: 0,
      retryableFailures: 0,
      permanentFailures: 0,
      fraudReviews: 0,
    };
  }


  /**
   * ===========================================================================
   * CONFIGURATION VALIDATION
   * ===========================================================================
   */

  validateConfiguration() {
    if (!this.queue) {
      throw new Error(
        "ReferralRewardQueue requires a queue adapter."
      );
    }

    if (
      typeof this.queue.add !==
      "function"
    ) {
      throw new Error(
        "ReferralRewardQueue queue adapter must expose add()."
      );
    }

    if (
      !this.rewardService ||
      typeof this.rewardService.issueReward !==
        "function"
    ) {
      throw new Error(
        "ReferralRewardQueue requires ReferralRewardService.issueReward()."
      );
    }

    return true;
  }


  /**
   * ===========================================================================
   * BUILD JOB DATA
   * ===========================================================================
   */

  buildJobData(
    reward,
    options = {}
  ) {
    if (!reward) {
      throw new Error(
        "Referral reward is required."
      );
    }

    const rewardId =
      normalizeObjectId(
        reward._id ||
          reward.rewardId
      );

    if (!rewardId) {
      throw new Error(
        "Referral reward queue requires a valid reward ID."
      );
    }

    const tenantId =
      normalizeObjectId(
        reward.tenantId ||
          options.tenantId
      );

    if (!tenantId) {
      throw new Error(
        "Referral reward queue requires a valid tenant ID."
      );
    }

    const identity =
      getRewardIdentity(
        reward
      );

    if (!identity) {
      throw new Error(
        "Referral reward queue requires an immutable reward idempotency identity."
      );
    }

    return {
      schemaVersion: 1,

      jobType:
        this.jobName,

      rewardId:
        String(rewardId),

      tenantId:
        String(tenantId),

      idempotencyKey:
        String(identity),

      rewardReference:
        reward.rewardReference
          ? String(
              reward.rewardReference
            )
          : null,

      source:
        options.source ||
        "referral_reward",

      reason:
        options.reason ||
        "reward_eligible",

      recovery:
        options.recovery === true,

      requestedAt:
        new Date().toISOString(),

      requestedBy:
        options.requestedBy
          ? String(
              options.requestedBy
            )
          : null,
    };
  }


  /**
   * ===========================================================================
   * OPTIONAL DATABASE VALIDATION
   * ===========================================================================
   *
   * This method prevents enqueueing clearly invalid/non-existent rewards.
   *
   * It intentionally does NOT trust or use client-supplied monetary values.
   * ===========================================================================
   */

  async validateRewardForEnqueue(
    reward,
    options = {}
  ) {
    if (!reward) {
      throw new Error(
        "Referral reward is required."
      );
    }

    const rewardId =
      normalizeObjectId(
        reward._id ||
          reward.rewardId
      );

    if (!rewardId) {
      throw new Error(
        "Invalid referral reward ID."
      );
    }

    const tenantId =
      normalizeObjectId(
        reward.tenantId ||
          options.tenantId
      );

    if (!tenantId) {
      throw new Error(
        "Invalid referral reward tenant ID."
      );
    }

    /**
     * If the caller has supplied a full trusted reward document, validate the
     * status directly.
     */
    if (
      reward.status &&
      TERMINAL_REWARD_STATUSES.includes(
        reward.status
      )
    ) {
      return {
        valid: false,
        terminal: true,
        reason:
          "reward_already_terminal",
      };
    }

    /**
     * If no model is available, the queue adapter can still operate.
     */
    if (
      !this.model ||
      typeof this.model.findOne !==
        "function"
    ) {
      return {
        valid: true,
        validated: false,
      };
    }

    const query = {
      _id: rewardId,
      tenantId,
    };

    const persisted =
      await this.model
        .findOne(query)
        .lean();

    if (!persisted) {
      const error =
        new Error(
          "Referral reward does not exist or does not belong to the supplied tenant."
        );

      error.code =
        "REFERRAL_REWARD_NOT_FOUND";

      error.permanent =
        true;

      throw error;
    }

    if (
      TERMINAL_REWARD_STATUSES.includes(
        persisted.status
      )
    ) {
      return {
        valid: false,
        terminal: true,
        reward: persisted,
        reason:
          "reward_already_terminal",
      };
    }

    if (
      !PROCESSABLE_REWARD_STATUSES.includes(
        persisted.status
      ) &&
      persisted.status !==
        REFERRAL_REWARD_STATUS.PROCESSING
    ) {
      return {
        valid: false,
        skipped: true,
        reward: persisted,
        reason:
          "reward_not_processable",
      };
    }

    return {
      valid: true,
      validated: true,
      reward: persisted,
    };
  }


  /**
   * ===========================================================================
   * ENQUEUE REWARD
   * ===========================================================================
   *
   * Deterministic jobId is the first duplicate-enqueue barrier.
   *
   * IMPORTANT:
   *
   * This does NOT replace financial idempotency.
   * ===========================================================================
   */

  async enqueueReward(
    reward,
    options = {}
  ) {
    this.validateConfiguration();

    const validation =
      await this.validateRewardForEnqueue(
        reward,
        options
      );

    if (
      validation &&
      validation.terminal
    ) {
      this.metrics.skipped += 1;

      return {
        enqueued: false,
        skipped: true,
        terminal: true,
        reason:
          validation.reason,
      };
    }

    if (
      validation &&
      validation.skipped
    ) {
      this.metrics.skipped += 1;

      return {
        enqueued: false,
        skipped: true,
        reason:
          validation.reason,
      };
    }

    const sourceReward =
      validation.reward ||
      reward;

    const data =
      this.buildJobData(
        sourceReward,
        options
      );

    const jobId =
      buildJobId(
        sourceReward
      );

    const delay =
      Math.max(
        0,
        Number(
          options.delayMs || 0
        )
      );

    const jobOptions = {
      jobId,

      attempts:
        Math.max(
          1,
          Number(
            options.attempts ||
              this.attempts
          )
        ),

      backoff: {
        type: "exponential",

        delay:
          this.backoffInitialMs,
      },

      removeOnComplete:
        this.removeOnComplete,

      removeOnFail:
        this.removeOnFail,

      delay,

      /**
       * Prevent Bull/BullMQ from retaining arbitrary payloads beyond the
       * necessary orchestration metadata.
       */
      stackTraceLimit: 10,
    };

    /**
     * Allow explicitly supplied priority while keeping the default safe.
     */
    if (
      options.priority !==
      undefined
    ) {
      jobOptions.priority =
        Math.max(
          1,
          Number(
            options.priority
          )
        );
    }

    try {
      const job =
        await this.queue.add(
          this.jobName,
          data,
          jobOptions
        );

      this.metrics.enqueued += 1;

      this.logger.info(
        {
          job: this.jobName,

          queue:
            this.queueName,

          jobId,

          rewardId:
            data.rewardId,

          tenantId:
            data.tenantId,

          recovery:
            data.recovery,
        },
        "TITech referral reward job enqueued."
      );

      return {
        enqueued: true,

        duplicate: false,

        job,

        jobId,

        rewardId:
          data.rewardId,

        tenantId:
          data.tenantId,

        idempotencyKey:
          data.idempotencyKey,
      };
    } catch (error) {
      /**
       * BullMQ may throw when an equivalent job is already present depending
       * on the adapter/version/configuration.
       *
       * A duplicate job is safe to acknowledge because the existing logical
       * job is still responsible for processing the reward.
       */
      if (
        this.isDuplicateJobError(
          error
        )
      ) {
        this.metrics.duplicates += 1;

        this.logger.debug(
          {
            job: this.jobName,
            jobId,
            rewardId:
              data.rewardId,
          },
          "TITech referral reward job already exists; duplicate enqueue suppressed."
        );

        return {
          enqueued: false,

          duplicate: true,

          jobId,

          rewardId:
            data.rewardId,

          tenantId:
            data.tenantId,

          idempotencyKey:
            data.idempotencyKey,
        };
      }

      this.logger.error(
        {
          job: this.jobName,
          jobId,
          rewardId:
            data.rewardId,
          tenantId:
            data.tenantId,
          error:
            serializeError(
              error
            ),
        },
        "Failed to enqueue TITech referral reward job."
      );

      throw error;
    }
  }


  /**
   * ===========================================================================
   * BULK ENQUEUE
   * ===========================================================================
   *
   * Uses deterministic job IDs for every reward.
   *
   * A failure for one reward does not silently create a second logical reward
   * identity.
   * ===========================================================================
   */

  async enqueueMany(
    rewards,
    options = {}
  ) {
    if (
      !Array.isArray(rewards)
    ) {
      throw new TypeError(
        "Referral reward queue enqueueMany() requires an array."
      );
    }

    const results = [];

    for (
      const reward of rewards
    ) {
      try {
        const result =
          await this.enqueueReward(
            reward,
            options
          );

        results.push(result);
      } catch (error) {
        results.push({
          enqueued: false,
          failed: true,
          rewardId:
            reward?._id
              ? String(
                  reward._id
                )
              : null,
          error:
            serializeError(
              error
            ),
        });
      }
    }

    return {
      total:
        rewards.length,

      enqueued:
        results.filter(
          (item) =>
            item.enqueued
        ).length,

      duplicates:
        results.filter(
          (item) =>
            item.duplicate
        ).length,

      skipped:
        results.filter(
          (item) =>
            item.skipped
        ).length,

      failed:
        results.filter(
          (item) =>
            item.failed
        ).length,

      results,
    };
  }


  /**
   * ===========================================================================
   * DUPLICATE QUEUE ERROR DETECTION
   * ===========================================================================
   */

  isDuplicateJobError(
    error
  ) {
    if (!error) {
      return false;
    }

    if (
      error.code === 11000 ||
      error.code ===
        "DUPLICATE_JOB" ||
      error.code ===
        "JOB_EXISTS"
    ) {
      return true;
    }

    const message =
      String(
        error.message || ""
      ).toLowerCase();

    return (
      message.includes(
        "jobid"
      ) &&
      (
        message.includes(
          "already exists"
        ) ||
        message.includes(
          "duplicate"
        )
      )
    );
  }


  /**
   * ===========================================================================
   * PROCESS ONE JOB
   * ===========================================================================
   *
   * This method is the central bridge between queue delivery and the financial
   * service.
   * ===========================================================================
   */

  async processJob(
    job
  ) {
    if (!job) {
      throw new Error(
        "Referral reward queue worker received an empty job."
      );
    }

    const data =
      job.data || {};

    const rewardId =
      normalizeObjectId(
        data.rewardId
      );

    const tenantId =
      normalizeObjectId(
        data.tenantId
      );

    if (!rewardId) {
      const error =
        new Error(
          "Referral reward queue job is missing a valid rewardId."
        );

      error.permanent =
        true;

      throw error;
    }

    if (!tenantId) {
      const error =
        new Error(
          "Referral reward queue job is missing a valid tenantId."
        );

      error.permanent =
        true;

      throw error;
    }

    if (
      !data.idempotencyKey
    ) {
      const error =
        new Error(
          "Referral reward queue job is missing its idempotencyKey."
        );

      error.permanent =
        true;

      throw error;
    }

    this.logger.info(
      {
        job: this.jobName,

        queueJobId:
          job.id
            ? String(job.id)
            : null,

        rewardId:
          String(rewardId),

        tenantId:
          String(tenantId),

        recovery:
          data.recovery === true,
      },
      "Processing TITech referral reward queue job."
    );

    /**
     * =======================================================================
     * LOAD AUTHORITATIVE REWARD
     * =======================================================================
     *
     * Never use queue payload as the authoritative financial record.
     * =======================================================================
     */

    let reward =
      null;

    if (
      this.model &&
      typeof this.model.findOne ===
        "function"
    ) {
      reward =
        await this.model
          .findOne({
            _id: rewardId,
            tenantId,
          })
          .lean();

      if (!reward) {
        const error =
          new Error(
            "Referral reward not found for queue job."
          );

        error.code =
          "REFERRAL_REWARD_NOT_FOUND";

        error.permanent =
          true;

        throw error;
      }
    } else {
      /**
       * Queue-only deployments may allow the service itself to resolve the
       * authoritative reward.
       */
      reward = {
        _id: rewardId,
        tenantId,
        idempotencyKey:
          data.idempotencyKey,
        rewardReference:
          data.rewardReference,
      };
    }

    /**
     * =======================================================================
     * TENANT ISOLATION
     * =======================================================================
     */

    const persistedTenantId =
      normalizeObjectId(
        reward.tenantId
      );

    if (
      !persistedTenantId ||
      String(
        persistedTenantId
      ) !==
        String(tenantId)
    ) {
      const error =
        new Error(
          "Referral reward tenant isolation check failed."
        );

      error.code =
        "REFERRAL_REWARD_TENANT_MISMATCH";

      error.permanent =
        true;

      throw error;
    }

    /**
     * =======================================================================
     * TERMINAL STATE CHECK
     * =======================================================================
     *
     * A stale queue message may arrive after the reward has already been
     * issued. Never issue again.
     * =======================================================================
     */

    if (
      TERMINAL_REWARD_STATUSES.includes(
        reward.status
      )
    ) {
      this.metrics.skipped += 1;

      if (
        reward.status ===
        REFERRAL_REWARD_STATUS.ISSUED
      ) {
        this.metrics.alreadyIssued += 1;
      }

      return {
        success: true,

        skipped: true,

        alreadyIssued:
          reward.status ===
          REFERRAL_REWARD_STATUS.ISSUED,

        reason:
          "reward_already_terminal",
      };
    }

    /**
     * =======================================================================
     * FINANCIAL IDEMPOTENCY CHECK
     * =======================================================================
     *
     * If available, check before attempting issuance.
     *
     * The service MUST still perform the final idempotency check atomically.
     * =======================================================================
     */

    if (
      typeof this.rewardService
        .isRewardAlreadyIssued ===
      "function"
    ) {
      const alreadyIssued =
        await this.rewardService
          .isRewardAlreadyIssued(
            reward,
            {
              source:
                "referral_reward_queue",

              queue:
                this.queueName,

              queueJobId:
                job.id
                  ? String(
                      job.id
                    )
                  : null,

              idempotencyKey:
                data.idempotencyKey,
            }
          );

      if (
        alreadyIssued
      ) {
        this.metrics.alreadyIssued += 1;

        this.logger.info(
          {
            job: this.jobName,
            rewardId:
              String(
                rewardId
              ),
            tenantId:
              String(
                tenantId
              ),
          },
          "TITech referral reward already has a financial issuance; acknowledging queue job without duplicate payment."
        );

        return {
          success: true,

          alreadyIssued: true,

          skipped: true,
        };
      }
    }

    /**
     * =======================================================================
     * ISSUE REWARD
     * =======================================================================
     */

    try {
      const serviceResult =
        await this.rewardService
          .issueReward(
            reward,
            {
              source:
                "referral_reward_queue",

              queue:
                this.queueName,

              queueJobId:
                job.id
                  ? String(
                      job.id
                    )
                  : null,

              workerId:
                this.getWorkerId(),

              tenantId:
                String(
                  tenantId
                ),

              rewardId:
                String(
                  rewardId
                ),

              recovery:
                data.recovery === true,

              idempotencyKey:
                data.idempotencyKey,
            }
          );

      this.metrics.processed += 1;

      if (
        serviceResult?.alreadyIssued
      ) {
        this.metrics.alreadyIssued += 1;

        return {
          success: true,

          alreadyIssued: true,

          serviceResult,
        };
      }

      if (
        serviceResult?.fraudReview
      ) {
        this.metrics.fraudReviews += 1;

        return {
          success: true,

          fraudReview: true,

          serviceResult,
        };
      }

      this.metrics.issued += 1;

      this.logger.info(
        {
          job: this.jobName,
          rewardId:
            String(
              rewardId
            ),
          tenantId:
            String(
              tenantId
            ),
          queueJobId:
            job.id
              ? String(
                  job.id
                )
              : null,
        },
        "TITech referral reward queue job completed successfully."
      );

      return {
        success: true,

        issued: true,

        serviceResult,
      };
    } catch (error) {
      /**
       * =======================================================================
       * DUPLICATE FINANCIAL OPERATION
       * =======================================================================
       *
       * Treat a confirmed duplicate/idempotency conflict as success.
       *
       * This is critical for at-least-once delivery.
       * =======================================================================
       */

      if (
        isDuplicateOrAlreadyProcessed(
          error
        )
      ) {
        this.metrics.alreadyIssued += 1;

        this.logger.warn(
          {
            job: this.jobName,

            rewardId:
              String(
                rewardId
              ),

            tenantId:
              String(
                tenantId
              ),

            error:
              serializeError(
                error
              ),
          },
          "TITech referral reward queue encountered an existing financial/idempotency record; treating reward as already processed."
        );

        return {
          success: true,

          alreadyIssued: true,

          duplicate: true,
        };
      }

      if (
        requiresFraudReview(
          error
        )
      ) {
        this.metrics.fraudReviews += 1;

        this.logger.warn(
          {
            job: this.jobName,

            rewardId:
              String(
                rewardId
              ),

            tenantId:
              String(
                tenantId
              ),

            error:
              serializeError(
                error
              ),
          },
          "TITech referral reward requires fraud/risk review."
        );

        return {
          success: true,

          fraudReview: true,
        };
      }

      if (
        isRetryableError(
          error
        )
      ) {
        this.metrics.retryableFailures += 1;

        this.logger.warn(
          {
            job: this.jobName,

            rewardId:
              String(
                rewardId
              ),

            tenantId:
              String(
                tenantId
              ),

            error:
              serializeError(
                error
              ),
          },
          "TITech referral reward queue encountered a retryable failure."
        );

        throw error;
      }

      this.metrics.permanentFailures += 1;

      this.logger.error(
        {
          job: this.jobName,

          rewardId:
            String(
              rewardId
            ),

          tenantId:
            String(
              tenantId
            ),

          error:
            serializeError(
              error
            ),
        },
        "TITech referral reward queue encountered a permanent failure."
      );

      throw error;
    }
  }


  /**
   * ===========================================================================
   * WORKER ID
   * ===========================================================================
   */

  getWorkerId() {
    return (
      process.env.TITECH_WORKER_ID ||
      `${this.jobName}:${process.pid}`
    );
  }


  /**
   * ===========================================================================
   * START WORKER
   * ===========================================================================
   *
   * For BullMQ:
   *
   *   new Worker(queueName, processor, options)
   *
   * The application may inject a pre-created worker instead.
   *
   * For Bull:
   *
   *   queue.process(concurrency, processor)
   *
   * The adapter below supports both forms.
   * ===========================================================================
   */

  async start(options = {}) {
    if (this.running) {
      return {
        started: false,
        reason: "already_running",
      };
    }

    this.validateConfiguration();

    this.stopping = false;

    this.startedAt =
      new Date();

    /**
     * If an externally constructed worker was supplied, simply mark the queue
     * as active.
     */
    if (options.worker) {
      this.worker =
        options.worker;

      this.running = true;

      return {
        started: true,

        queue:
          this.queueName,

        workerId:
          this.getWorkerId(),

        concurrency:
          this.concurrency,
      };
    }

    /**
     * =======================================================================
     * BULLMQ WORKER
     * =======================================================================
     *
     * BullMQ Worker is deliberately required lazily so importing this module
     * does not force BullMQ on environments that use another adapter.
     * =======================================================================
     */

    if (
      typeof options.Worker ===
      "function"
    ) {
      this.worker =
        new options.Worker(
          this.queueName,

          async (job) =>
            this.processJob(
              job
            ),

          {
            concurrency:
              this.concurrency,

            stalledInterval:
              this.stalledIntervalMs,

            lockDuration:
              this.lockDurationMs,

            autorun:
              options.autorun !==
              false,

            ...(options.workerOptions ||
              {}),
          }
        );

      this.registerWorkerEvents();

      this.running = true;

      this.logger.info(
        {
          job:
            this.jobName,

          queue:
            this.queueName,

          workerId:
            this.getWorkerId(),

          concurrency:
            this.concurrency,
        },
        "TITech referral reward worker started."
      );

      return {
        started: true,

        queue:
          this.queueName,

        workerId:
          this.getWorkerId(),

        concurrency:
          this.concurrency,
      };
    }

    /**
     * =======================================================================
     * BULL COMPATIBILITY
     * =======================================================================
     */

    if (
      typeof this.queue.process ===
      "function"
    ) {
      this.queue.process(
        this.concurrency,

        async (job) =>
          this.processJob(
            job
          )
      );

      this.running = true;

      this.logger.info(
        {
          job:
            this.jobName,

          queue:
            this.queueName,

          workerId:
            this.getWorkerId(),

          concurrency:
            this.concurrency,
        },
        "TITech referral reward worker started using Bull-compatible queue processing."
      );

      return {
        started: true,

        queue:
          this.queueName,

        workerId:
          this.getWorkerId(),

        concurrency:
          this.concurrency,
      };
    }

    throw new Error(
      "ReferralRewardQueue cannot start worker: no compatible worker/process adapter was supplied."
    );
  }


  /**
   * ===========================================================================
   * REGISTER WORKER EVENTS
   * ===========================================================================
   */

  registerWorkerEvents() {
    if (
      !this.worker ||
      typeof this.worker.on !==
        "function"
    ) {
      return;
    }

    this.worker.on(
      "completed",
      (job) => {
        this.logger.info(
          {
            job:
              this.jobName,

            queueJobId:
              job?.id
                ? String(
                    job.id
                  )
                : null,
          },
          "TITech referral reward worker completed job."
        );
      }
    );

    this.worker.on(
      "failed",
      (job, error) => {
        this.metrics.failed += 1;

        this.logger.error(
          {
            job:
              this.jobName,

            queueJobId:
              job?.id
                ? String(
                    job.id
                  )
                : null,

            rewardId:
              job?.data?.rewardId ||
              null,

            tenantId:
              job?.data?.tenantId ||
              null,

            error:
              serializeError(
                error
              ),
          },
          "TITech referral reward worker failed job."
        );
      }
    );

    this.worker.on(
      "stalled",
      (jobId) => {
        this.logger.warn(
          {
            job:
              this.jobName,

            queueJobId:
              jobId
                ? String(
                    jobId
                  )
                : null,
          },
          "TITech referral reward queue detected a stalled job."
        );
      }
    );

    this.worker.on(
      "error",
      (error) => {
        this.logger.error(
          {
            job:
              this.jobName,

            error:
              serializeError(
                error
              ),
          },
          "TITech referral reward worker emitted an error."
        );
      }
    );
  }


  /**
   * ===========================================================================
   * GET JOB
   * ===========================================================================
   */

  async getJob(
    rewardOrId
  ) {
    if (
      !this.queue ||
      typeof this.queue.getJob !==
        "function"
    ) {
      return null;
    }

    const jobId =
      buildJobId(
        rewardOrId
      );

    return this.queue.getJob(
      jobId
    );
  }


  /**
   * ===========================================================================
   * CHECK QUEUED STATE
   * ===========================================================================
   */

  async isQueued(
    rewardOrId
  ) {
    const job =
      await this.getJob(
        rewardOrId
      );

    if (!job) {
      return false;
    }

    /**
     * If the adapter exposes state(), use it.
     */
    if (
      typeof job.getState ===
      "function"
    ) {
      const state =
        await job.getState();

      return [
        "waiting",
        "active",
        "delayed",
        "prioritized",
        "waiting-children",
      ].includes(
        state
      );
    }

    /**
     * Otherwise the deterministic job ID itself is the best available
     * duplicate-enqueue signal.
     */
    return true;
  }


  /**
   * ===========================================================================
   * REMOVE QUEUED JOB
   * ===========================================================================
   *
   * Operational use only.
   *
   * Never remove a financial reward simply to bypass duplicate-payment
   * protection.
   * ===========================================================================
   */

  async removeJob(
    rewardOrId,
    options = {}
  ) {
    const job =
      await this.getJob(
        rewardOrId
      );

    if (!job) {
      return {
        removed: false,
        reason: "not_found",
      };
    }

    if (
      options.force !== true
    ) {
      const state =
        typeof job.getState ===
        "function"
          ? await job.getState()
          : null;

      if (
        state === "active"
      ) {
        throw new Error(
          "Refusing to remove an active referral reward job without force=true."
        );
      }
    }

    if (
      typeof job.remove !==
      "function"
    ) {
      throw new Error(
        "Queue adapter does not support job removal."
      );
    }

    await job.remove();

    this.logger.warn(
      {
        job:
          this.jobName,

        rewardIdentity:
          typeof rewardOrId ===
          "object"
            ? String(
                getRewardIdentity(
                  rewardOrId
                )
              )
            : String(
                rewardOrId
              ),
      },
      "TITech referral reward queue job removed operationally."
    );

    return {
      removed: true,
    };
  }


  /**
   * ===========================================================================
   * PAUSE
   * ===========================================================================
   */

  async pause() {
    if (
      !this.queue ||
      typeof this.queue.pause !==
        "function"
    ) {
      throw new Error(
        "Queue adapter does not support pause()."
      );
    }

    await this.queue.pause();

    this.logger.warn(
      {
        queue:
          this.queueName,
      },
      "TITech referral reward queue paused."
    );

    return {
      paused: true,
    };
  }


  /**
   * ===========================================================================
   * RESUME
   * ===========================================================================
   */

  async resume() {
    if (
      !this.queue ||
      typeof this.queue.resume !==
        "function"
    ) {
      throw new Error(
        "Queue adapter does not support resume()."
      );
    }

    await this.queue.resume();

    this.logger.info(
      {
        queue:
          this.queueName,
      },
      "TITech referral reward queue resumed."
    );

    return {
      resumed: true,
    };
  }


  /**
   * ===========================================================================
   * DRAIN
   * ===========================================================================
   */

  async drain(
    options = {}
  ) {
    if (
      !this.queue
    ) {
      return {
        drained: false,
        reason: "queue_unavailable",
      };
    }

    if (
      typeof this.queue.drain ===
      "function"
    ) {
      await this.queue.drain(
        options.delayed === true
      );

      return {
        drained: true,
      };
    }

    return {
      drained: false,
      reason:
        "queue_adapter_does_not_support_drain",
    };
  }


  /**
   * ===========================================================================
   * GRACEFUL SHUTDOWN
   * ===========================================================================
   */

  async stop(
    options = {}
  ) {
    if (
      this.stopping &&
      !this.running
    ) {
      return {
        stopped: true,
        alreadyStopped: true,
      };
    }

    this.stopping = true;

    this.logger.info(
      {
        job:
          this.jobName,

        queue:
          this.queueName,

        workerId:
          this.getWorkerId(),
      },
      "Stopping TITech referral reward worker gracefully."
    );

    /**
     * Stop accepting new work first.
     */
    if (
      this.worker &&
      typeof this.worker.close ===
        "function"
    ) {
      try {
        await this.worker.close(
          options.force === true
        );
      } catch (error) {
        this.logger.error(
          {
            job:
              this.jobName,

            error:
              serializeError(
                error
              ),
          },
          "TITech referral reward worker encountered an error while closing."
        );

        if (
          options.throwOnError ===
          true
        ) {
          throw error;
        }
      }
    }

    this.worker = null;

    this.running = false;

    this.stopping = false;

    this.logger.info(
      {
        job:
          this.jobName,

        queue:
          this.queueName,
      },
      "TITech referral reward worker stopped."
    );

    return {
      stopped: true,
    };
  }


  /**
   * ===========================================================================
   * HEALTH
   * ===========================================================================
   */

  async getHealth() {
    let queueConnected =
      null;

    if (
      this.queue &&
      typeof this.queue.isReady ===
        "function"
    ) {
      try {
        queueConnected =
          await this.queue.isReady();
      } catch (error) {
        queueConnected = false;
      }
    }

    return {
      name:
        this.jobName,

      queue:
        this.queueName,

      running:
        this.running,

      stopping:
        this.stopping,

      workerId:
        this.getWorkerId(),

      concurrency:
        this.concurrency,

      attempts:
        this.attempts,

      queueConnected,

      startedAt:
        this.startedAt,

      metrics: {
        ...this.metrics,
      },
    };
  }
}


/**
 * =============================================================================
 * FACTORY
 * =============================================================================
 */

function createReferralRewardQueue(
  options = {}
) {
  return new ReferralRewardQueue(
    options
  );
}


/**
 * =============================================================================
 * DEFAULT SINGLETON
 * =============================================================================
 *
 * The singleton intentionally does NOT create a broker connection by itself.
 *
 * The application bootstrap should inject the configured queue adapter.
 * =============================================================================
 */

const referralRewardQueue =
  createReferralRewardQueue();


/**
 * =============================================================================
 * CONVENIENCE ENQUEUE FUNCTION
 * =============================================================================
 */

async function enqueueReferralReward(
  reward,
  options = {}
) {
  return referralRewardQueue.enqueueReward(
    reward,
    options
  );
}


/**
 * =============================================================================
 * CONVENIENCE BULK ENQUEUE FUNCTION
 * =============================================================================
 */

async function enqueueReferralRewards(
  rewards,
  options = {}
) {
  return referralRewardQueue.enqueueMany(
    rewards,
    options
  );
}


/**
 * =============================================================================
 * EXPORTS
 * =============================================================================
 */

module.exports = Object.freeze({
  JOB_NAME,

  QUEUE_NAME,

  TERMINAL_REWARD_STATUSES,

  PROCESSABLE_REWARD_STATUSES,

  ReferralRewardQueue,

  createReferralRewardQueue,

  referralRewardQueue,

  enqueueReferralReward,

  enqueueReferralRewards,

  buildJobId,

  getRewardIdentity,

  calculateBackoff,

  isRetryableError,

  isDuplicateOrAlreadyProcessed,
});