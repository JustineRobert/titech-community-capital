"use strict";

/**
 * ============================================================================
 * TITech Community Capital
 * Enterprise Referral Reward Recovery Job
 * ============================================================================
 *
 * File:
 *   backend/jobs/referralRewardRecoveryJob.js
 *
 * Purpose:
 *   Safely recover referral rewards that are:
 *
 *     - pending
 *     - eligible
 *     - retrying
 *     - failed and retryable
 *     - abandoned in processing state
 *
 *   without ever bypassing ReferralRewardService or the financial
 *   idempotency boundary.
 *
 * ============================================================================
 * ARCHITECTURE
 * ============================================================================
 *
 *   Referral
 *       │
 *       ▼
 *   ReferralReward
 *       │
 *       ├── pending
 *       ├── eligible
 *       ├── processing
 *       ├── retrying
 *       ├── failed
 *       ├── fraud_review
 *       ├── issued
 *       ├── reversed
 *       └── cancelled
 *              │
 *              ▼
 *   ReferralRewardRecoveryJob
 *              │
 *              ├── discover
 *              ├── recover stale leases
 *              ├── atomically claim
 *              ├── re-read current state
 *              ├── idempotency verification
 *              ▼
 *       ReferralRewardService
 *              │
 *              ▼
 *       Financial Transaction / Ledger
 *
 * ============================================================================
 * FINANCIAL SAFETY
 * ============================================================================
 *
 * THIS JOB NEVER:
 *
 *   - credits a wallet directly
 *   - mutates a ledger directly
 *   - creates a financial transaction directly
 *   - calculates a reward amount
 *   - trusts a stale document as proof of eligibility
 *   - assumes a timeout means financial failure
 *   - retries a terminal reward
 *
 * The ReferralRewardService is the authoritative financial execution boundary.
 *
 * ============================================================================
 * IDEMPOTENCY MODEL
 * ============================================================================
 *
 * Every recovery attempt must carry a stable idempotency key.
 *
 * Preferred:
 *
 *   reward.idempotencyKey
 *
 * Then:
 *
 *   reward.rewardReference
 *
 * Finally:
 *
 *   reward._id
 *
 * The fallback _id is intentionally deterministic and stable, but the
 * ReferralReward model should preferably persist a dedicated immutable
 * reward idempotency key.
 *
 * ============================================================================
 * MULTI-TENANCY
 * ============================================================================
 *
 * Every database mutation includes tenantId.
 *
 * The job MUST NOT:
 *
 *   find reward by _id alone
 *   claim reward by _id alone
 *   finalize reward by _id alone
 *   change state without tenant isolation
 *
 * ============================================================================
 * IMPORTANT SERVICE CONTRACT
 * ============================================================================
 *
 * ReferralRewardService must expose:
 *
 *   issueReward(reward, options)
 *
 * Recommended:
 *
 *   isRewardAlreadyIssued(reward, options)
 *
 * The job does not require the optional method because issueReward() remains
 * the final idempotent authority.
 *
 * ============================================================================
 */

const mongoose = require("mongoose");

const {
  REFERRAL_REWARD_STATUS,
  REFERRAL_REWARD_STATUSES,
  REFERRAL_RETRY_POLICY,
} = require("../constants/referralConstants");


/* ============================================================================
 * OPTIONAL MODEL
 * ========================================================================== */

let ReferralReward = null;

try {
  ReferralReward = require("../models/ReferralReward");
} catch (error) {
  /*
   * Deliberately lazy.
   *
   * This permits dependency injection during unit testing.
   */
  ReferralReward = null;
}


/* ============================================================================
 * OPTIONAL SERVICE
 * ========================================================================== */

let ReferralRewardService = null;

try {
  ReferralRewardService =
    require("../services/referralRewardService");
} catch (error) {
  /*
   * Deliberately lazy.
   *
   * Dependency injection remains available for tests and alternate bootstrap
   * configurations.
   */
  ReferralRewardService = null;
}


/* ============================================================================
 * JOB METADATA
 * ========================================================================== */

const JOB_NAME =
  "titech-referral-reward-recovery";

const JOB_VERSION =
  "2026.1";

const SERVICE_NAME =
  "TITech Referral Reward Recovery";

const DEFAULT_BATCH_SIZE =
  50;

const MAX_BATCH_SIZE =
  500;

const DEFAULT_MAX_ATTEMPTS =
  5;

const DEFAULT_LEASE_MINUTES =
  15;

const DEFAULT_LOOKBACK_HOURS =
  24;

const DEFAULT_TIMEOUT_MS =
  120000;

const DEFAULT_MAX_RUNTIME_MS =
  10 * 60 * 1000;

const DEFAULT_BACKOFF_MS =
  1000;

const DEFAULT_MAX_BACKOFF_MS =
  5 * 60 * 1000;

const MAX_ERROR_MESSAGE_LENGTH =
  500;


/* ============================================================================
 * STATUS RESOLUTION
 * ========================================================================== */

/**
 * Defensive status lookup.
 *
 * This protects the job against a partially evolved referralConstants module.
 */
function statusValue(name, fallback) {
  return (
    REFERRAL_REWARD_STATUS &&
    REFERRAL_REWARD_STATUS[name]
  ) || fallback;
}


const STATUS = Object.freeze({
  PENDING:
    statusValue("PENDING", "pending"),

  ELIGIBLE:
    statusValue("ELIGIBLE", "eligible"),

  PROCESSING:
    statusValue("PROCESSING", "processing"),

  RETRYING:
    statusValue("RETRYING", "retrying"),

  FAILED:
    statusValue("FAILED", "failed"),

  FRAUD_REVIEW:
    statusValue(
      "FRAUD_REVIEW",
      "fraud_review"
    ),

  ISSUED:
    statusValue("ISSUED", "issued"),

  REVERSED:
    statusValue("REVERSED", "reversed"),

  CANCELLED:
    statusValue("CANCELLED", "cancelled"),
});


/**
 * Recoverable states.
 *
 * NOTE:
 *
 * PROCESSING is intentionally excluded from the normal query because it
 * requires lease-aware recovery.
 */
const RECOVERABLE_REWARD_STATUSES =
  Object.freeze([
    STATUS.PENDING,
    STATUS.ELIGIBLE,
    STATUS.RETRYING,
    STATUS.FAILED,
  ]);


/**
 * Terminal states.
 */
const TERMINAL_REWARD_STATUSES =
  Object.freeze([
    STATUS.ISSUED,
    STATUS.REVERSED,
    STATUS.CANCELLED,
]);


/* ============================================================================
 * RESULT FACTORY
 * ========================================================================== */

function createEmptyResult() {
  return {
    jobName:
      JOB_NAME,

    jobVersion:
      JOB_VERSION,

    startedAt:
      null,

    completedAt:
      null,

    durationMs:
      0,

    dryRun:
      false,

    stopped:
      false,

    scanned:
      0,

    claimed:
      0,

    processed:
      0,

    issued:
      0,

    skipped:
      0,

    failed:
      0,

    retried:
      0,

    permanentlyFailed:
      0,

    fraudReview:
      0,

    staleProcessing:
      0,

    alreadyIssued:
      0,

    concurrencyConflicts:
      0,

    claimConflicts:
      0,

    finalizationConflicts:
      0,

    errors:
      [],

    tenantIds:
      new Set(),
  };
}


/* ============================================================================
 * LOGGER
 * ========================================================================== */

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
    info:
      (...args) =>
        console.info(...args),

    warn:
      (...args) =>
        console.warn(...args),

    error:
      (...args) =>
        console.error(...args),

    debug:
      (...args) =>
        console.debug(...args),
  };
}


/* ============================================================================
 * ERROR SERIALIZATION
 * ========================================================================== */

function serializeError(error) {
  if (!error) {
    return {
      name:
        "Error",

      message:
        "Unknown error",

      code:
        null,

      statusCode:
        null,

      retryable:
        false,
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
      error.statusCode ||
      null,

    retryable:
      error.retryable === true,
  };
}


/* ============================================================================
 * ERROR CLASSIFICATION
 * ========================================================================== */

function isDuplicateKeyError(error) {
  return Boolean(
    error &&
    (
      error.code === 11000 ||
      error.code === "DUPLICATE_KEY" ||
      error.code === "E11000"
    )
  );
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

      "MongoNetworkError",
      "MongoServerSelectionError",
      "MongoWriteConcernError",
      "MongoNotPrimaryError",
      "MongoTopologyClosedError",
    ]);

  if (
    transientCodes.has(
      error.code
    )
  ) {
    return true;
  }

  const statusCode =
    Number(
      error.statusCode
    );

  return (
    statusCode === 408 ||
    statusCode === 425 ||
    statusCode === 429 ||
    statusCode >= 500
  );
}


function isFraudReviewError(error) {
  if (!error) {
    return false;
  }

  return [
    "REFERRAL_FRAUD_REVIEW",
    "REFERRAL_FRAUD_BLOCKED",
    "FRAUD_REVIEW_REQUIRED",
    "REFERRAL_RISK_REVIEW_REQUIRED",
  ].includes(
    error.code
  );
}


/* ============================================================================
 * RETRY BACKOFF
 * ========================================================================== */

function getRetryPolicyValue(
  key,
  fallback
) {
  const value =
    REFERRAL_RETRY_POLICY &&
    REFERRAL_RETRY_POLICY[key];

  return (
    Number.isFinite(
      Number(value)
    )
      ? Number(value)
      : fallback
  );
}


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
    Math.max(
      0,
      Number(
        options.initialDelayMs ??
        getRetryPolicyValue(
          "INITIAL_DELAY_MS",
          DEFAULT_BACKOFF_MS
        )
      )
    );

  const maxDelayMs =
    Math.max(
      initialDelayMs,
      Number(
        options.maxDelayMs ??
        getRetryPolicyValue(
          "MAX_BACKOFF_MS",
          DEFAULT_MAX_BACKOFF_MS
        )
      )
    );

  const multiplier =
    Math.max(
      1,
      Number(
        options.multiplier ??
        getRetryPolicyValue(
          "BACKOFF_MULTIPLIER",
          2
        )
      )
    );

  const useJitter =
    options.useJitter !== undefined
      ? options.useJitter !== false
      : getRetryPolicyValue(
          "USE_JITTER",
          1
        ) !== 0;

  const exponential =
    initialDelayMs *
    Math.pow(
      multiplier,
      normalizedAttempt - 1
    );

  const capped =
    Math.min(
      exponential,
      maxDelayMs
    );

  if (
    !useJitter ||
    capped <= 0
  ) {
    return Math.floor(
      capped
    );
  }

  const jitter =
    Math.floor(
      Math.random() *
      Math.max(
        1,
        capped * 0.25
      )
    );

  return Math.min(
    maxDelayMs,
    Math.floor(
      capped + jitter
    )
  );
}


/* ============================================================================
 * DATE HELPERS
 * ========================================================================== */

function toDate(
  value,
  fallback = null
) {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  const date =
    value instanceof Date
      ? new Date(
          value.getTime()
        )
      : new Date(value);

  return Number.isNaN(
    date.getTime()
  )
    ? fallback
    : date;
}


function dateBeforeMinutes(
  nowMs,
  minutes
) {
  return new Date(
    nowMs -
    (
      Math.max(
        0,
        Number(minutes) || 0
      ) *
      60 *
      1000
    )
  );
}


function dateBeforeHours(
  nowMs,
  hours
) {
  return new Date(
    nowMs -
    (
      Math.max(
        0,
        Number(hours) || 0
      ) *
      60 *
      60 *
      1000
    )
  );
}


/* ============================================================================
 * OBJECT ID
 * ========================================================================== */

function normalizeObjectId(value) {
  if (!value) {
    return null;
  }

  if (
    value instanceof
    mongoose.Types.ObjectId
  ) {
    return value;
  }

  if (
    typeof value === "string" &&
    mongoose.Types.ObjectId.isValid(
      value
    )
  ) {
    return new mongoose.Types.ObjectId(
      value
    );
  }

  return null;
}


/* ============================================================================
 * BOOLEAN
 * ========================================================================== */

function isTrue(value) {
  return (
    value === true ||
    value === "true" ||
    value === 1 ||
    value === "1"
  );
}


/* ============================================================================
 * JOB CLASS
 * ========================================================================== */

class ReferralRewardRecoveryJob {
  constructor(options = {}) {
    this.logger =
      createLogger(
        options.logger
      );

    this.model =
      options.model ||
      ReferralReward;

    this.rewardService =
      options.rewardService ||
      ReferralRewardService;

    this.clock =
      typeof options.clock === "function"
        ? options.clock
        : () => Date.now();

    this.jobName =
      options.jobName ||
      JOB_NAME;

    this.jobVersion =
      options.jobVersion ||
      JOB_VERSION;

    this.batchSize =
      this.normalizePositiveInteger(
        options.batchSize,
        DEFAULT_BATCH_SIZE,
        1,
        MAX_BATCH_SIZE
      );

    this.maxAttempts =
      this.normalizePositiveInteger(
        options.maxAttempts,
        getRetryPolicyValue(
          "MAX_ATTEMPTS",
          DEFAULT_MAX_ATTEMPTS
        ),
        1,
        100
      );

    this.leaseMinutes =
      this.normalizePositiveInteger(
        options.leaseMinutes,
        DEFAULT_LEASE_MINUTES,
        1,
        1440
      );

    this.lookbackHours =
      this.normalizePositiveInteger(
        options.lookbackHours,
        DEFAULT_LOOKBACK_HOURS,
        0,
        8760
      );

    this.timeoutMs =
      this.normalizePositiveInteger(
        options.timeoutMs,
        DEFAULT_TIMEOUT_MS,
        1000,
        30 * 60 * 1000
      );

    this.maxRuntimeMs =
      this.normalizePositiveInteger(
        options.maxRuntimeMs,
        DEFAULT_MAX_RUNTIME_MS,
        1000,
        24 * 60 * 60 * 1000
      );

    this.running =
      false;

    this.stopping =
      false;

    this.currentPromise =
      null;

    this.currentStartedAt =
      null;
  }


  /* ==========================================================================
   * NORMALIZATION
   * ======================================================================== */

  normalizePositiveInteger(
    value,
    fallback,
    minimum,
    maximum
  ) {
    const parsed =
      Number.parseInt(
        value,
        10
      );

    const effective =
      Number.isInteger(parsed)
        ? parsed
        : fallback;

    return Math.min(
      maximum,
      Math.max(
        minimum,
        effective
      )
    );
  }


  /* ==========================================================================
   * CONFIGURATION VALIDATION
   * ======================================================================== */

  validateConfiguration() {
    if (!this.model) {
      throw new Error(
        `[${this.jobName}] ReferralReward model is required.`
      );
    }

    if (!this.rewardService) {
      throw new Error(
        `[${this.jobName}] ReferralRewardService is required.`
      );
    }

    if (
      typeof this.rewardService.issueReward !==
      "function"
    ) {
      throw new Error(
        `[${this.jobName}] ReferralRewardService.issueReward() is required.`
      );
    }

    return true;
  }


  /* ==========================================================================
   * WORKER ID
   * ======================================================================== */

  getWorkerId() {
    return (
      process.env.TITECH_WORKER_ID ||
      `${this.jobName}:${process.pid}`
    );
  }


  /* ==========================================================================
   * CORRELATION ID
   * ======================================================================== */

  getCorrelationId(
    reward,
    options = {}
  ) {
    return (
      options.correlationId ||
      reward?.correlationId ||
      reward?.requestId ||
      `${this.jobName}:${String(
        reward?._id || "unknown"
      )}`
    );
  }


  /* ==========================================================================
   * IDEMPOTENCY KEY
   * ======================================================================== */

  getIdempotencyKey(
    reward
  ) {
    if (!reward) {
      return null;
    }

    const key =
      reward.idempotencyKey ||
      reward.rewardReference ||
      reward.reference ||
      reward._id;

    if (!key) {
      return null;
    }

    return String(
      key
    ).trim();
  }


  /* ==========================================================================
   * TENANT VALIDATION
   * ======================================================================== */

  normalizeTenantId(
    tenantId
  ) {
    if (!tenantId) {
      return null;
    }

    const normalized =
      normalizeObjectId(
        tenantId
      );

    return (
      normalized ||
      String(
        tenantId
      ).trim()
    );
  }


  assertTenantId(
    tenantId
  ) {
    const normalized =
      this.normalizeTenantId(
        tenantId
      );

    if (!normalized) {
      throw new Error(
        `[${this.jobName}] Referral reward tenantId is required.`
      );
    }

    return normalized;
  }


  /* ==========================================================================
   * RECOVERY QUERY
   * ======================================================================== */

  buildRecoveryQuery(
    options = {}
  ) {
    const now =
      this.clock();

    const query = {
      status: {
        $in:
          RECOVERABLE_REWARD_STATUSES,
      },

      $or: [
        {
          nextAttemptAt: {
            $exists: false,
          },
        },
        {
          nextAttemptAt: {
            $lte:
              new Date(now),
          },
        },
      ],
    };

    if (
      options.tenantId !==
      undefined &&
      options.tenantId !==
      null
    ) {
      query.tenantId =
        this.assertTenantId(
          options.tenantId
        );
    }

    if (
      options.rewardId
    ) {
      const rewardId =
        normalizeObjectId(
          options.rewardId
        );

      if (!rewardId) {
        throw new Error(
          `[${this.jobName}] Invalid rewardId.`
        );
      }

      query._id =
        rewardId;
    }

    /**
     * Lookback is deliberately applied to failed/retrying records.
     *
     * A pending/eligible reward should not become permanently invisible
     * merely because it is newer than the operational lookback window.
     */
    if (
      options.lookbackHours !==
        undefined &&
      Number(options.lookbackHours) === 0
    ) {
      return query;
    }

    const lookbackHours =
      Number.isFinite(
        Number(
          options.lookbackHours
        )
      )
        ? Number(
            options.lookbackHours
          )
        : this.lookbackHours;

    if (
      lookbackHours > 0
    ) {
      query.$and = [
        {
          $or: [
            {
              status: {
                $in: [
                  STATUS.RETRYING,
                  STATUS.FAILED,
                ],
              },
            },
            {
              status: {
                $in: [
                  STATUS.PENDING,
                  STATUS.ELIGIBLE,
                ],
              },
            },
          ],
        },

        {
          $or: [
            {
              nextAttemptAt: {
                $exists: false,
              },
            },
            {
              nextAttemptAt: {
                $lte:
                  new Date(now),
              },
            },
          ],
        },
      ];
    }

    return query;
  }


  /* ==========================================================================
   * STALE PROCESSING QUERY
   * ======================================================================== */

  buildStaleProcessingQuery(
    options = {}
  ) {
    const now =
      this.clock();

    const staleBefore =
      dateBeforeMinutes(
        now,
        this.leaseMinutes
      );

    const query = {
      status:
        STATUS.PROCESSING,

      $or: [
        {
          leaseExpiresAt: {
            $lte:
              new Date(now),
          },
        },

        {
          processingStartedAt: {
            $lte:
              staleBefore,
          },
        },
      ],
    };

    if (
      options.tenantId !==
      undefined &&
      options.tenantId !==
      null
    ) {
      query.tenantId =
        this.assertTenantId(
          options.tenantId
        );
    }

    if (
      options.rewardId
    ) {
      const rewardId =
        normalizeObjectId(
          options.rewardId
        );

      if (!rewardId) {
        throw new Error(
          `[${this.jobName}] Invalid rewardId.`
        );
      }

      query._id =
        rewardId;
    }

    return query;
  }


  /* ==========================================================================
   * FIND STALE PROCESSING REWARDS
   * ======================================================================== */

  async findStaleProcessingRewards(
    options = {}
  ) {
    const query =
      this.buildStaleProcessingQuery(
        options
      );

    return this.model
      .find(
        query
      )
      .sort({
        processingStartedAt:
          1,

        _id:
          1,
      })
      .limit(
        this.batchSize
      )
      .lean();
  }


  /* ==========================================================================
   * RECOVER STALE PROCESSING REWARD
   * ======================================================================== */

  async recoverStaleProcessingReward(
    reward,
    options = {}
  ) {
    if (
      !reward?._id
    ) {
      return {
        success:
          false,

        skipped:
          true,

        reason:
          "missing_reward_id",
      };
    }

    const tenantId =
      this.assertTenantId(
        reward.tenantId
      );

    const now =
      new Date(
        this.clock()
      );

    const staleBefore =
      dateBeforeMinutes(
        this.clock(),
        this.leaseMinutes
      );

    /**
     * Critical:
     *
     * PROCESSING -> RETRYING is conditional.
     *
     * If another worker already completed the reward, this update does not
     * match and therefore cannot overwrite the newer state.
     */
    const updated =
      await this.model.findOneAndUpdate(
        {
          _id:
            reward._id,

          tenantId,

          status:
            STATUS.PROCESSING,

          $or: [
            {
              leaseExpiresAt: {
                $lte:
                  now,
              },
            },

            {
              processingStartedAt: {
                $lte:
                  staleBefore,
              },
            },
          ],
        },

        {
          $set: {
            status:
              STATUS.RETRYING,

            nextAttemptAt:
              now,

            leaseExpiresAt:
              null,

            processingStartedAt:
              null,

            recoveryRequired:
              true,

            recoveryReason:
              "stale_processing_lease",

            recoveryWorkerId:
              this.getWorkerId(),

            recoveryAt:
              now,

            updatedAt:
              now,
          },

          $inc: {
            recoveryCount:
              1,
          },
        },

        {
          new:
            true,

          runValidators:
            true,
        }
      );

    if (!updated) {
      return {
        success:
          false,

        skipped:
          true,

        concurrencyConflict:
          true,

        reason:
          "processing_state_changed",
      };
    }

    return {
      success:
        true,

      reward:
        updated,
    };
  }


  /* ==========================================================================
   * CLAIM REWARD
   * ======================================================================== */

  async claimReward(
    reward
  ) {
    if (
      !reward?._id
    ) {
      return null;
    }

    const tenantId =
      this.assertTenantId(
        reward.tenantId
      );

    const currentStatus =
      reward.status;

    if (
      !RECOVERABLE_REWARD_STATUSES.includes(
        currentStatus
      )
    ) {
      return null;
    }

    const now =
      new Date(
        this.clock()
      );

    const leaseExpiresAt =
      new Date(
        this.clock() +
        (
          this.leaseMinutes *
          60 *
          1000
        )
      );

    /**
     * The claim is conditional on:
     *
     *   - reward id
     *   - tenant id
     *   - exact observed status
     *   - retry schedule
     *
     * Therefore two workers cannot both successfully claim the same state.
     */
    const claimed =
      await this.model.findOneAndUpdate(
        {
          _id:
            reward._id,

          tenantId,

          status:
            currentStatus,

          $or: [
            {
              nextAttemptAt: {
                $exists:
                  false,
              },
            },

            {
              nextAttemptAt: {
                $lte:
                  now,
              },
            },
          ],
        },

        {
          $set: {
            status:
              STATUS.PROCESSING,

            processingStartedAt:
              now,

            leaseExpiresAt,

            workerId:
              this.getWorkerId(),

            correlationId:
              this.getCorrelationId(
                reward
              ),

            updatedAt:
              now,
          },

          $inc: {
            processingAttempts:
              1,
          },
        },

        {
          new:
            true,

          runValidators:
            true,
        }
      );

    return (
      claimed ||
      null
    );
  }


  /* ==========================================================================
   * RE-READ CURRENT REWARD
   * ======================================================================== */

  async reloadClaimedReward(
    reward
  ) {
    if (
      !reward?._id
    ) {
      return null;
    }

    const tenantId =
      this.assertTenantId(
        reward.tenantId
      );

    return this.model
      .findOne({
        _id:
          reward._id,

        tenantId,

        status:
          STATUS.PROCESSING,

        workerId:
          this.getWorkerId(),
      })
      .lean();
  }


  /* ==========================================================================
   * IDEMPOTENCY CHECK
   * ======================================================================== */

  async verifyAlreadyIssued(
    reward,
    options = {}
  ) {
    if (
      !this.rewardService
    ) {
      return false;
    }

    if (
      typeof this.rewardService
        .isRewardAlreadyIssued !==
      "function"
    ) {
      /**
       * This method is optional.
       *
       * issueReward() remains the authoritative idempotent operation.
       */
      return false;
    }

    return Boolean(
      await this.rewardService
        .isRewardAlreadyIssued(
          reward,
          {
            source:
              "recovery_job",

            jobName:
              this.jobName,

            jobVersion:
              this.jobVersion,

            workerId:
              this.getWorkerId(),

            correlationId:
              this.getCorrelationId(
                reward,
                options
              ),

            idempotencyKey:
              this.getIdempotencyKey(
                reward
              ),

            recovery:
              true,
          }
        )
    );
  }


  /* ==========================================================================
   * PROCESS REWARD THROUGH SERVICE
   * ======================================================================== */

  async processReward(
    reward,
    options = {}
  ) {
    const startedAt =
      this.clock();

    const result = {
      rewardId:
        reward?._id
          ? String(
              reward._id
            )
          : null,

      tenantId:
        reward?.tenantId
          ? String(
              reward.tenantId
            )
          : null,

      success:
        false,

      issued:
        false,

      alreadyIssued:
        false,

      fraudReview:
        false,

      retry:
        false,

      permanentFailure:
        false,

      error:
        null,

      serviceResult:
        null,

      durationMs:
        0,
    };

    try {
      if (
        !reward?._id
      ) {
        result.error = {
          code:
            "MISSING_REWARD_ID",

          message:
            "Referral reward identifier is missing.",
        };

        return result;
      }

      if (
        TERMINAL_REWARD_STATUSES.includes(
          reward.status
        )
      ) {
        result.success =
          reward.status ===
          STATUS.ISSUED;

        result.issued =
          reward.status ===
          STATUS.ISSUED;

        result.alreadyIssued =
          reward.status ===
          STATUS.ISSUED;

        return result;
      }

      if (
        reward.status !==
        STATUS.PROCESSING
      ) {
        result.error = {
          code:
            "INVALID_RECOVERY_STATE",

          message:
            `Reward is not in processing state: ${reward.status}`,
        };

        result.permanentFailure =
          true;

        return result;
      }

      if (
        options.dryRun
      ) {
        result.success =
          true;

        return result;
      }

      const idempotencyKey =
        this.getIdempotencyKey(
          reward
        );

      if (!idempotencyKey) {
        const error =
          new Error(
            "Referral reward has no stable idempotency key."
          );

        error.code =
          "REWARD_IDEMPOTENCY_KEY_MISSING";

        error.retryable =
          false;

        result.error =
          serializeError(
            error
          );

        result.permanentFailure =
          true;

        return result;
      }

      /**
       * First explicit idempotency check.
       */
      const alreadyIssued =
        await this.verifyAlreadyIssued(
          reward,
          options
        );

      if (
        alreadyIssued
      ) {
        result.success =
          true;

        result.issued =
          true;

        result.alreadyIssued =
          true;

        return result;
      }

      /**
       * ================================================================
       * AUTHORITATIVE FINANCIAL OPERATION
       * ================================================================
       *
       * The recovery job does NOT issue money itself.
       *
       * Everything financial goes through ReferralRewardService.
       */
      const serviceResult =
        await this.withTimeout(
          this.rewardService.issueReward(
            reward,
            {
              source:
                "recovery_job",

              jobName:
                this.jobName,

              jobVersion:
                this.jobVersion,

              recovery:
                true,

              workerId:
                this.getWorkerId(),

              correlationId:
                this.getCorrelationId(
                  reward,
                  options
                ),

              idempotencyKey,

              /**
               * Strongly recommended for service implementations that support
               * operation-specific transaction metadata.
               */
              metadata: {
                recovery:
                  true,

                recoveryJob:
                  this.jobName,

                recoveryJobVersion:
                  this.jobVersion,

                workerId:
                  this.getWorkerId(),
              },
            }
          ),
          this.timeoutMs
        );

      result.serviceResult =
        serviceResult || null;

      /**
       * Service explicitly reports that the financial operation already
       * existed.
       */
      if (
        serviceResult?.alreadyIssued ===
        true ||
        serviceResult?.idempotent ===
        true
      ) {
        result.success =
          true;

        result.issued =
          true;

        result.alreadyIssued =
          true;

        return result;
      }

      /**
       * Service explicitly requests fraud review.
       */
      if (
        serviceResult?.fraudReview ===
        true ||
        serviceResult?.requiresFraudReview ===
        true
      ) {
        result.fraudReview =
          true;

        return result;
      }

      /**
       * Successful service completion.
       */
      if (
        serviceResult?.success === false
      ) {
        const error =
          new Error(
            serviceResult.message ||
            "Referral reward service reported unsuccessful processing."
          );

        error.code =
          serviceResult.code ||
          "REFERRAL_REWARD_SERVICE_FAILED";

        error.retryable =
          serviceResult.retryable ===
          true;

        throw error;
      }

      result.success =
        true;

      result.issued =
        true;

      return result;
    } catch (error) {
      result.error =
        serializeError(
          error
        );

      /**
       * Duplicate idempotency/financial record:
       *
       * Treat as already processed rather than issuing again.
       */
      if (
        isDuplicateKeyError(
          error
        )
      ) {
        result.success =
          true;

        result.issued =
          true;

        result.alreadyIssued =
          true;

        return result;
      }

      if (
        isFraudReviewError(
          error
        )
      ) {
        result.fraudReview =
          true;

        return result;
      }

      if (
        isTransientError(
          error
        )
      ) {
        result.retry =
          true;

        return result;
      }

      result.permanentFailure =
        true;

      return result;
    } finally {
      result.durationMs =
        this.clock() -
        startedAt;
    }
  }


  /* ==========================================================================
   * FINALIZE ISSUED
   * ======================================================================== */

  async finalizeIssued(
    reward,
    options = {}
  ) {
    const tenantId =
      this.assertTenantId(
        reward.tenantId
      );

    const now =
      new Date(
        this.clock()
      );

    const updated =
      await this.model.findOneAndUpdate(
        {
          _id:
            reward._id,

          tenantId,

          status:
            STATUS.PROCESSING,

          workerId:
            this.getWorkerId(),
        },

        {
          $set: {
            status:
              STATUS.ISSUED,

            issuedAt:
              now,

            leaseExpiresAt:
              null,

            processingStartedAt:
              null,

            nextAttemptAt:
              null,

            recoveryRequired:
              false,

            recoveryCompletedAt:
              now,

            recoveryWorkerId:
              this.getWorkerId(),

            updatedAt:
              now,
          },

          $inc: {
            recoverySuccessCount:
              1,
          },
        },

        {
          new:
            true,

          runValidators:
            true,
        }
      );

    return updated;
  }


  /* ==========================================================================
   * MARK RETRY
   * ======================================================================== */

  async markForRetry(
    reward,
    error,
    attempt
  ) {
    const tenantId =
      this.assertTenantId(
        reward.tenantId
      );

    const nextAttempt =
      Math.max(
        1,
        Number.parseInt(
          attempt,
          10
        ) || 1
      );

    const retryDelay =
      calculateRetryDelay(
        nextAttempt
      );

    const now =
      new Date(
        this.clock()
      );

    const nextAttemptAt =
      new Date(
        this.clock() +
        retryDelay
      );

    return this.model.findOneAndUpdate(
      {
        _id:
          reward._id,

        tenantId,

        status:
          STATUS.PROCESSING,

        workerId:
          this.getWorkerId(),
      },

      {
        $set: {
          status:
            STATUS.RETRYING,

          nextAttemptAt,

          leaseExpiresAt:
            null,

          processingStartedAt:
            null,

          lastErrorCode:
            error?.code ||
            "RETRYABLE_REWARD_FAILURE",

          lastErrorMessage:
            String(
              error?.message ||
              "Retryable referral reward processing failure."
            ).slice(
              0,
              MAX_ERROR_MESSAGE_LENGTH
            ),

          lastFailedAt:
            now,

          recoveryLastAttemptAt:
            now,

          updatedAt:
            now,
        },

        $inc: {
          retryCount:
            1,

          recoveryRetryCount:
            1,
        },
      },

      {
        new:
          true,

        runValidators:
          true,
      }
    );
  }


  /* ==========================================================================
   * MARK PERMANENT FAILURE
   * ======================================================================== */

  async markPermanentFailure(
    reward,
    error
  ) {
    const tenantId =
      this.assertTenantId(
        reward.tenantId
      );

    const now =
      new Date(
        this.clock()
      );

    return this.model.findOneAndUpdate(
      {
        _id:
          reward._id,

        tenantId,

        status:
          STATUS.PROCESSING,

        workerId:
          this.getWorkerId(),
      },

      {
        $set: {
          status:
            STATUS.FAILED,

          nextAttemptAt:
            null,

          leaseExpiresAt:
            null,

          processingStartedAt:
            null,

          permanentlyFailed:
            true,

          lastErrorCode:
            error?.code ||
            "MAX_REWARD_RECOVERY_ATTEMPTS",

          lastErrorMessage:
            String(
              error?.message ||
              "Maximum referral reward recovery attempts exceeded."
            ).slice(
              0,
              MAX_ERROR_MESSAGE_LENGTH
            ),

          lastFailedAt:
            now,

          recoveryLastAttemptAt:
            now,

          updatedAt:
            now,
        },

        $inc: {
          permanentFailureCount:
            1,
        },
      },

      {
        new:
          true,

        runValidators:
          true,
      }
    );
  }


  /* ==========================================================================
   * FRAUD REVIEW
   * ======================================================================== */

  async moveToFraudReview(
    reward,
    reason =
      "fraud_review_required"
  ) {
    const tenantId =
      this.assertTenantId(
        reward.tenantId
      );

    const now =
      new Date(
        this.clock()
      );

    return this.model.findOneAndUpdate(
      {
        _id:
          reward._id,

        tenantId,

        status:
          STATUS.PROCESSING,

        workerId:
          this.getWorkerId(),
      },

      {
        $set: {
          status:
            STATUS.FRAUD_REVIEW,

          fraudReviewRequired:
            true,

          fraudReviewReason:
            String(
              reason
            ).slice(
              0,
              MAX_ERROR_MESSAGE_LENGTH
            ),

          fraudReviewAt:
            now,

          leaseExpiresAt:
            null,

          processingStartedAt:
            null,

          nextAttemptAt:
            null,

          recoveryLastAttemptAt:
            now,

          updatedAt:
            now,
        },

        $inc: {
          fraudReviewCount:
            1,
        },
      },

      {
        new:
          true,

        runValidators:
          true,
      }
    );
  }


  /* ==========================================================================
   * PROCESS CLAIMED REWARD
   * ======================================================================== */

  async processClaimedReward(
    reward,
    result,
    options = {}
  ) {
    const processed =
      await this.processReward(
        reward,
        options
      );

    /**
     * ================================================================
     * ALREADY ISSUED
     * ================================================================
     */
    if (
      processed.alreadyIssued
    ) {
      result.alreadyIssued +=
        1;

      if (
        !options.dryRun
      ) {
        const finalized =
          await this.finalizeIssued(
            reward,
            options
          );

        if (
          !finalized
        ) {
          result.finalizationConflicts +=
            1;

          this.logger.warn(
            {
              job:
                this.jobName,

              rewardId:
                String(
                  reward._id
                ),

              tenantId:
                String(
                  reward.tenantId
                ),
            },
            "Reward was already financially issued, but recovery finalization did not match the current processing state."
          );
        }
      }

      result.processed +=
        1;

      return processed;
    }

    /**
     * ================================================================
     * FRAUD REVIEW
     * ================================================================
     */
    if (
      processed.fraudReview
    ) {
      if (
        !options.dryRun
      ) {
        await this.moveToFraudReview(
          reward,
          processed.error?.message ||
            "fraud_review_required"
        );
      }

      result.fraudReview +=
        1;

      result.processed +=
        1;

      return processed;
    }

    /**
     * ================================================================
     * SUCCESS
     * ================================================================
     */
    if (
      processed.success &&
      processed.issued
    ) {
      if (
        !options.dryRun
      ) {
        const finalized =
          await this.finalizeIssued(
            reward,
            options
          );

        if (
          !finalized
        ) {
          /**
           * CRITICAL:
           *
           * Never call issueReward() again merely because this state update
           * failed.
           *
           * The financial service has already completed the operation.
           * Future recovery must reconcile through the same idempotency key.
           */
          result.finalizationConflicts +=
            1;

          this.logger.error(
            {
              job:
                this.jobName,

              rewardId:
                String(
                  reward._id
                ),

              tenantId:
                String(
                  reward.tenantId
                ),

              idempotencyKey:
                this.getIdempotencyKey(
                  reward
                ),
            },
            "Referral reward financial issuance succeeded but reward-state finalization did not match the expected processing lease."
          );
        }
      }

      result.issued +=
        1;

      result.processed +=
        1;

      return processed;
    }

    /**
     * ================================================================
     * RETRY
     * ================================================================
     */
    const attempt =
      Number(
        reward.processingAttempts ||
        reward.attempts ||
        0
      );

    if (
      processed.retry &&
      attempt <
        this.maxAttempts
    ) {
      if (
        !options.dryRun
      ) {
        await this.markForRetry(
          reward,
          processed.error ||
            {
              code:
                "RETRYABLE_REWARD_FAILURE",

              message:
                "Retryable referral reward processing failure.",
            },
          attempt
        );
      }

      result.retried +=
        1;

      result.failed +=
        1;

      result.processed +=
        1;

      return processed;
    }

    /**
     * ================================================================
     * PERMANENT FAILURE
     * ================================================================
     */
    if (
      !options.dryRun
    ) {
      await this.markPermanentFailure(
        reward,
        processed.error ||
          {
            code:
              "MAX_REWARD_RECOVERY_ATTEMPTS",

            message:
              "Maximum referral reward recovery attempts exceeded.",
          }
      );
    }

    result.permanentlyFailed +=
      1;

    result.failed +=
      1;

    result.processed +=
      1;

    return processed;
  }


  /* ==========================================================================
   * FETCH NORMAL RECOVERY BATCH
   * ======================================================================== */

  async fetchBatch(
    options = {}
  ) {
    const query =
      this.buildRecoveryQuery(
        options
      );

    return this.model
      .find(
        query
      )
      .sort({
        createdAt:
          1,

        _id:
          1,
      })
      .limit(
        this.batchSize
      )
      .lean();
  }


  /* ==========================================================================
   * RECOVER STALE PROCESSING
   * ======================================================================== */

  async recoverStaleProcessing(
    result,
    options = {}
  ) {
    const staleRewards =
      await this.findStaleProcessingRewards(
        options
      );

    for (
      const reward of staleRewards
    ) {
      if (
        this.shouldStop(
          options
        )
      ) {
        result.stopped =
          true;

        break;
      }

      result.scanned +=
        1;

      if (
        reward.tenantId
      ) {
        result.tenantIds.add(
          String(
            reward.tenantId
          )
        );
      }

      if (
        options.dryRun
      ) {
        result.skipped +=
          1;

        continue;
      }

      const recovery =
        await this.recoverStaleProcessingReward(
          reward,
          options
        );

      if (
        recovery.concurrencyConflict
      ) {
        result.concurrencyConflicts +=
          1;

        result.skipped +=
          1;

        continue;
      }

      if (
        recovery.success
      ) {
        result.staleProcessing +=
          1;

        /**
         * Do not assume that recovery itself means issuance.
         *
         * The reward has merely been returned to a safe retryable state.
         *
         * It is deliberately processed in a later phase of this same run
         * using a fresh query.
         */
        result.retried +=
          1;
      } else {
        result.skipped +=
          1;
      }
    }

    return result;
  }


  /* ==========================================================================
   * STOP CONDITION
   * ======================================================================== */

  shouldStop(
    options = {}
  ) {
    if (
      this.stopping
    ) {
      return true;
    }

    if (
      options.signal &&
      options.signal.aborted
    ) {
      return true;
    }

    const startedAt =
      options.startedAt ||
      this.currentStartedAt ||
      this.clock();

    return (
      this.clock() -
      startedAt >=
      this.maxRuntimeMs
    );
  }


  /* ==========================================================================
   * EXECUTE ONE REWARD
   * ======================================================================== */

  async executeReward(
    reward,
    result,
    options = {}
  ) {
    if (
      !reward
    ) {
      result.skipped +=
        1;

      return;
    }

    if (
      options.dryRun
    ) {
      result.skipped +=
        1;

      return;
    }

    /**
     * Claim against the exact state observed by the discovery query.
     */
    const claimed =
      await this.claimReward(
        reward
      );

    if (
      !claimed
    ) {
      result.claimConflicts +=
        1;

      result.concurrencyConflicts +=
        1;

      result.skipped +=
        1;

      return;
    }

    result.claimed +=
      1;

    /**
     * CRITICAL:
     *
     * Re-read after claim.
     *
     * Never issue a reward using the stale document returned by discovery.
     */
    const current =
      await this.reloadClaimedReward(
        claimed
      );

    if (
      !current
    ) {
      result.concurrencyConflicts +=
        1;

      result.skipped +=
        1;

      return;
    }

    await this.processClaimedReward(
      current,
      result,
      options
    );
  }


  /* ==========================================================================
   * MAIN RUN
   * ======================================================================== */

  async run(
    options = {}
  ) {
    if (
      this.running
    ) {
      this.logger.warn(
        {
          job:
            this.jobName,

          workerId:
            this.getWorkerId(),
        },
        "TITech referral reward recovery job is already running."
      );

      return {
        skipped:
          true,

        reason:
          "already_running",

        jobName:
          this.jobName,
      };
    }

    this.validateConfiguration();

    this.running =
      true;

    this.stopping =
      false;

    this.currentStartedAt =
      this.clock();

    const result =
      createEmptyResult();

    result.startedAt =
      new Date(
        this.currentStartedAt
      );

    result.dryRun =
      options.dryRun === true;

    this.currentPromise =
      this.execute(
        options,
        result
      );

    try {
      return await this.currentPromise;
    } finally {
      this.running =
        false;

      this.currentPromise =
        null;

      this.currentStartedAt =
        null;
    }
  }


  /* ==========================================================================
   * EXECUTE
   * ======================================================================== */

  async execute(
    options,
    result
  ) {
    this.logger.info(
      {
        service:
          SERVICE_NAME,

        job:
          this.jobName,

        version:
          this.jobVersion,

        workerId:
          this.getWorkerId(),

        batchSize:
          this.batchSize,

        maxAttempts:
          this.maxAttempts,

        leaseMinutes:
          this.leaseMinutes,

        dryRun:
          result.dryRun,
      },
      "Starting TITech referral reward recovery job."
    );

    try {
      /**
       * ================================================================
       * PHASE 1
       * Recover abandoned processing leases.
       * ================================================================
       */
      await this.recoverStaleProcessing(
        result,
        {
          ...options,

          startedAt:
            this.currentStartedAt,
        }
      );

      /**
       * ================================================================
       * PHASE 2
       * Normal recovery.
       *
       * We intentionally fetch again after stale recovery so rewards moved
       * from PROCESSING -> RETRYING are eligible for a fresh claim.
       * ================================================================
       */
      while (
        !this.shouldStop({
          ...options,

          startedAt:
            this.currentStartedAt,
        })
      ) {
        const batch =
          await this.fetchBatch(
            options
          );

        if (
          !batch ||
          batch.length === 0
        ) {
          break;
        }

        result.scanned +=
          batch.length;

        let processedFromBatch =
          0;

        for (
          const reward of batch
        ) {
          if (
            this.shouldStop({
              ...options,

              startedAt:
                this.currentStartedAt,
            })
          ) {
            result.stopped =
              true;

            break;
          }

          if (
            reward.tenantId
          ) {
            result.tenantIds.add(
              String(
                reward.tenantId
              )
            );
          }

          await this.executeReward(
            reward,
            result,
            options
          );

          processedFromBatch +=
            1;
        }

        /**
         * Defensive escape.
         *
         * If every discovered reward loses its claim race, repeatedly
         * querying the exact same batch can otherwise create a hot loop.
         */
        if (
          processedFromBatch ===
          0
        ) {
          break;
        }

        /**
         * In dry-run mode nothing changes, therefore another fetch would
         * return the same records forever.
         */
        if (
          options.dryRun
        ) {
          break;
        }
      }

      result.completedAt =
        new Date(
          this.clock()
        );

      result.durationMs =
        this.clock() -
        this.currentStartedAt;

      result.tenantCount =
        result.tenantIds.size;

      delete result.tenantIds;

      this.logger.info(
        {
          job:
            this.jobName,

          version:
            this.jobVersion,

          durationMs:
            result.durationMs,

          stopped:
            result.stopped,

          scanned:
            result.scanned,

          claimed:
            result.claimed,

          processed:
            result.processed,

          issued:
            result.issued,

          retried:
            result.retried,

          failed:
            result.failed,

          permanentlyFailed:
            result.permanentlyFailed,

          fraudReview:
            result.fraudReview,

          alreadyIssued:
            result.alreadyIssued,

          staleProcessing:
            result.staleProcessing,

          concurrencyConflicts:
            result.concurrencyConflicts,

          finalizationConflicts:
            result.finalizationConflicts,

          tenantCount:
            result.tenantCount,
        },
        "TITech referral reward recovery job completed."
      );

      return result;
    } catch (error) {
      result.completedAt =
        new Date(
          this.clock()
        );

      result.durationMs =
        this.clock() -
        this.currentStartedAt;

      result.errors.push(
        serializeError(
          error
        )
      );

      this.logger.error(
        {
          job:
            this.jobName,

          version:
            this.jobVersion,

          durationMs:
            result.durationMs,

          error:
            serializeError(
              error
            ),
        },
        "TITech referral reward recovery job failed."
      );

      throw error;
    }
  }


  /* ==========================================================================
   * TIMEOUT
   * ======================================================================== */

  async withTimeout(
    promise,
    timeoutMs
  ) {
    let timeoutHandle =
      null;

    const timeoutPromise =
      new Promise(
        (_, reject) => {
          timeoutHandle =
            setTimeout(
              () => {
                const error =
                  new Error(
                    `Referral reward service operation timed out after ${timeoutMs}ms.`
                  );

                error.code =
                  "REFERRAL_REWARD_TIMEOUT";

                /**
                 * IMPORTANT:
                 *
                 * A timeout is retryable operationally, but it is NOT proof
                 * that the financial operation failed.
                 *
                 * ReferralRewardService must therefore remain idempotent.
                 */
                error.retryable =
                  true;

                reject(
                  error
                );
              },
              timeoutMs
            );

          if (
            timeoutHandle &&
            typeof timeoutHandle.unref ===
              "function"
          ) {
            timeoutHandle.unref();
          }
        }
      );

    try {
      return await Promise.race([
        Promise.resolve(
          promise
        ),
        timeoutPromise,
      ]);
    } finally {
      if (
        timeoutHandle
      ) {
        clearTimeout(
          timeoutHandle
        );
      }
    }
  }


  /* ==========================================================================
   * GRACEFUL STOP
   * ======================================================================== */

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
          this.getWorkerId(),
      },
      "Stopping TITech referral reward recovery job gracefully."
    );

    if (
      options.waitForCurrentRun !==
        false &&
      this.currentPromise
    ) {
      try {
        await this.currentPromise;
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
          "Current TITech referral reward recovery run failed during shutdown."
        );
      }
    }

    this.running =
      false;

    this.currentPromise =
      null;

    this.logger.info(
      {
        job:
          this.jobName,
      },
      "TITech referral reward recovery job stopped."
    );
  }


  /* ==========================================================================
   * HEALTH
   * ======================================================================== */

  getHealth() {
    return {
      name:
        this.jobName,

      version:
        this.jobVersion,

      service:
        SERVICE_NAME,

      running:
        this.running,

      stopping:
        this.stopping,

      workerId:
        this.getWorkerId(),

      batchSize:
        this.batchSize,

      maxAttempts:
        this.maxAttempts,

      leaseMinutes:
        this.leaseMinutes,

      lookbackHours:
        this.lookbackHours,

      timeoutMs:
        this.timeoutMs,

      maxRuntimeMs:
        this.maxRuntimeMs,

      recoverableStatuses:
        [
          ...RECOVERABLE_REWARD_STATUSES,
        ],

      terminalStatuses:
        [
          ...TERMINAL_REWARD_STATUSES,
        ],
    };
  }
}


/* ============================================================================
 * FACTORY
 * ========================================================================== */

function createReferralRewardRecoveryJob(
  options = {}
) {
  return new ReferralRewardRecoveryJob(
    options
  );
}


/* ============================================================================
 * DEFAULT SINGLETON
 * ========================================================================== */

const referralRewardRecoveryJob =
  createReferralRewardRecoveryJob();


/* ============================================================================
 * CONVENIENCE RUNNER
 * ========================================================================== */

async function runReferralRewardRecoveryJob(
  options = {}
) {
  return referralRewardRecoveryJob.run(
    options
  );
}


/* ============================================================================
 * EXPORTS
 * ========================================================================== */

module.exports = Object.freeze({
  JOB_NAME,

  JOB_VERSION,

  SERVICE_NAME,

  STATUS,

  RECOVERABLE_REWARD_STATUSES,

  TERMINAL_REWARD_STATUSES,

  calculateRetryDelay,

  serializeError,

  isTransientError,

  isDuplicateKeyError,

  ReferralRewardRecoveryJob,

  createReferralRewardRecoveryJob,

  referralRewardRecoveryJob,

  runReferralRewardRecoveryJob,
});