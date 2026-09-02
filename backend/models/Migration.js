"use strict";

/**
 * =============================================================================
 * TITech Community Capital
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/models/Migration.js
 *
 * Purpose:
 *   Enterprise-grade database migration registry.
 *
 * Responsibilities:
 *   - Track migration identity and version.
 *   - Prevent duplicate migration execution.
 *   - Track execution lifecycle.
 *   - Track deployment batch.
 *   - Track environment and execution owner.
 *   - Detect migration checksum/code drift.
 *   - Support safe rollback auditing.
 *   - Support stale-run detection.
 *   - Provide operational migration locking metadata.
 *
 * IMPORTANT:
 *   This collection is infrastructure metadata.
 *
 *   Migration execution itself MUST remain in a dedicated migration runner /
 *   service. This model should not contain migration business logic.
 *
 * =============================================================================
 */

const mongoose = require("mongoose");

const { Schema } = mongoose;

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const MIGRATION_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "rolled_back",
];

const MIGRATION_ENVIRONMENTS = [
  "development",
  "test",
  "staging",
  "production",
];

const DEFAULT_ENVIRONMENT = MIGRATION_ENVIRONMENTS.includes(
  process.env.NODE_ENV
)
  ? process.env.NODE_ENV
  : "development";

const MAX_VERSION_LENGTH = 200;
const MAX_NAME_LENGTH = 256;
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_PATH_LENGTH = 1000;
const MAX_EXECUTED_BY_LENGTH = 256;
const MAX_HOSTNAME_LENGTH = 256;
const MAX_PROCESS_ID_LENGTH = 128;
const MAX_ERROR_LENGTH = 10000;
const MAX_CHECKSUM_LENGTH = 256;

/**
 * =============================================================================
 * Migration Schema
 * =============================================================================
 */

const migrationSchema = new Schema(
  {
    /**
     * -------------------------------------------------------------------------
     * Migration Identity
     * -------------------------------------------------------------------------
     *
     * Example:
     *
     *   20240115_143022_create_user_indices
     *
     * Version MUST be immutable after creation.
     */

    version: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      trim: true,
      minlength: 3,
      maxlength: MAX_VERSION_LENGTH,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: MAX_NAME_LENGTH,
    },

    description: {
      type: String,
      trim: true,
      maxlength: MAX_DESCRIPTION_LENGTH,
      default: null,
    },

    /**
     * -------------------------------------------------------------------------
     * Migration Ordering
     * -------------------------------------------------------------------------
     *
     * sequence provides deterministic ordering even where lexical filenames
     * are not sufficient.
     */

    sequence: {
      type: Number,
      min: 0,
      default: null,
      index: true,
    },

    /**
     * -------------------------------------------------------------------------
     * Migration Lifecycle
     * -------------------------------------------------------------------------
     */

    status: {
      type: String,
      enum: MIGRATION_STATUSES,
      default: "pending",
      required: true,
      index: true,
    },

    /**
     * -------------------------------------------------------------------------
     * Execution Timing
     * -------------------------------------------------------------------------
     */

    startedAt: {
      type: Date,
      default: null,
      index: true,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    rolledBackAt: {
      type: Date,
      default: null,
    },

    failedAt: {
      type: Date,
      default: null,
    },

    /**
     * Execution duration in milliseconds.
     */
    durationMs: {
      type: Number,
      min: 0,
      default: null,
    },

    /**
     * -------------------------------------------------------------------------
     * Execution Ownership / Runtime Information
     * -------------------------------------------------------------------------
     */

    executedBy: {
      type: String,
      trim: true,
      maxlength: MAX_EXECUTED_BY_LENGTH,
      default: "system",
    },

    hostname: {
      type: String,
      trim: true,
      maxlength: MAX_HOSTNAME_LENGTH,
      default: null,
    },

    processId: {
      type: String,
      trim: true,
      maxlength: MAX_PROCESS_ID_LENGTH,
      default: null,
    },

    runnerId: {
      type: String,
      trim: true,
      maxlength: 256,
      default: null,
      index: true,
    },

    /**
     * -------------------------------------------------------------------------
     * Environment
     * -------------------------------------------------------------------------
     */

    environment: {
      type: String,
      enum: MIGRATION_ENVIRONMENTS,
      required: true,
      default: DEFAULT_ENVIRONMENT,
      immutable: true,
      index: true,
    },

    /**
     * -------------------------------------------------------------------------
     * Migration Batch
     * -------------------------------------------------------------------------
     *
     * Migrations executed during the same deployment are grouped together.
     */

    batch: {
      type: Number,
      min: 0,
      default: null,
      index: true,
    },

    /**
     * -------------------------------------------------------------------------
     * Migration Source
     * -------------------------------------------------------------------------
     */

    path: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_PATH_LENGTH,
      immutable: true,
      index: true,
    },

    /**
     * -------------------------------------------------------------------------
     * Migration Integrity
     * -------------------------------------------------------------------------
     *
     * checksum allows the runner to detect a migration file that has been
     * modified after it was executed.
     *
     * Recommended algorithm:
     *
     *   SHA-256
     */

    checksum: {
      type: String,
      trim: true,
      maxlength: MAX_CHECKSUM_LENGTH,
      default: null,
    },

    checksumAlgorithm: {
      type: String,
      enum: ["sha256", "sha384", "sha512"],
      default: "sha256",
    },

    /**
     * -------------------------------------------------------------------------
     * Rollback Information
     * -------------------------------------------------------------------------
     */

    rollbackStartedAt: {
      type: Date,
      default: null,
    },

    rollbackError: {
      type: String,
      trim: true,
      maxlength: MAX_ERROR_LENGTH,
      default: null,
    },

    rollbackExecutedBy: {
      type: String,
      trim: true,
      maxlength: MAX_EXECUTED_BY_LENGTH,
      default: null,
    },

    /**
     * -------------------------------------------------------------------------
     * Error Information
     * -------------------------------------------------------------------------
     */

    error: {
      type: String,
      trim: true,
      maxlength: MAX_ERROR_LENGTH,
      default: null,
    },

    errorCode: {
      type: String,
      trim: true,
      maxlength: 256,
      default: null,
    },

    /**
     * -------------------------------------------------------------------------
     * Retry / Recovery
     * -------------------------------------------------------------------------
     */

    attemptCount: {
      type: Number,
      min: 0,
      default: 0,
    },

    lastAttemptAt: {
      type: Date,
      default: null,
    },

    nextRetryAt: {
      type: Date,
      default: null,
      index: true,
    },

    /**
     * -------------------------------------------------------------------------
     * Lock / Lease Information
     * -------------------------------------------------------------------------
     *
     * A migration runner can use this to detect ownership and recover from
     * crashed migration processes.
     */

    lockOwner: {
      type: String,
      trim: true,
      maxlength: 256,
      default: null,
      index: true,
    },

    lockAcquiredAt: {
      type: Date,
      default: null,
    },

    lockExpiresAt: {
      type: Date,
      default: null,
      index: true,
    },

    /**
     * -------------------------------------------------------------------------
     * Operational Notes
     * -------------------------------------------------------------------------
     */

    notes: {
      type: String,
      trim: true,
      maxlength: 5000,
      default: null,
    },

    /**
     * -------------------------------------------------------------------------
     * Administrative Soft Delete
     * -------------------------------------------------------------------------
     *
     * Migration records should almost never be deleted. This exists only for
     * exceptional administrative data lifecycle operations.
     */

    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },

    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,

    versionKey: false,

    collection: "migrations",

    minimize: true,

    strict: true,
  }
);

/**
 * =============================================================================
 * Indexes
 * =============================================================================
 */

/**
 * Status by environment.
 */
migrationSchema.index({
  environment: 1,
  status: 1,
});

/**
 * Deterministic migration ordering.
 */
migrationSchema.index({
  environment: 1,
  sequence: 1,
});

/**
 * Batch inspection.
 */
migrationSchema.index({
  environment: 1,
  batch: 1,
  sequence: 1,
});

/**
 * Recent migration activity.
 */
migrationSchema.index({
  environment: 1,
  createdAt: -1,
});

/**
 * Running migrations.
 */
migrationSchema.index({
  environment: 1,
  status: 1,
  startedAt: 1,
});

/**
 * Lock expiration recovery.
 */
migrationSchema.index({
  environment: 1,
  lockExpiresAt: 1,
});

/**
 * Retry queue.
 */
migrationSchema.index({
  environment: 1,
  nextRetryAt: 1,
});

/**
 * =============================================================================
 * Query Helpers
 * =============================================================================
 */

migrationSchema.query.active = function () {
  return this.where({
    isDeleted: false,
  });
};

migrationSchema.query.pending = function () {
  return this.where({
    status: "pending",
    isDeleted: false,
  });
};

migrationSchema.query.running = function () {
  return this.where({
    status: "running",
    isDeleted: false,
  });
};

migrationSchema.query.completed = function () {
  return this.where({
    status: "completed",
    isDeleted: false,
  });
};

migrationSchema.query.failed = function () {
  return this.where({
    status: "failed",
    isDeleted: false,
  });
};

/**
 * =============================================================================
 * Instance Methods
 * =============================================================================
 */

/**
 * Determine whether migration is complete.
 */
migrationSchema.methods.isCompleted = function () {
  return this.status === "completed";
};

/**
 * Determine whether migration can be executed.
 */
migrationSchema.methods.isRunnable = function () {
  return [
    "pending",
    "failed",
  ].includes(this.status);
};

/**
 * Determine whether the migration lock is expired.
 */
migrationSchema.methods.isLockExpired = function () {
  if (!this.lockExpiresAt) {
    return true;
  }

  return this.lockExpiresAt.getTime() <= Date.now();
};

/**
 * Acquire a local migration lease.
 *
 * The actual distributed lock should preferably be acquired atomically by the
 * migration runner.
 */
migrationSchema.methods.acquireLock = function ({
  lockOwner,
  leaseMs = 5 * 60 * 1000,
} = {}) {
  if (!lockOwner) {
    throw new Error("lockOwner is required");
  }

  const now = new Date();

  this.lockOwner = lockOwner;
  this.lockAcquiredAt = now;
  this.lockExpiresAt = new Date(
    now.getTime() + leaseMs
  );

  return this.save();
};

/**
 * Release migration lease.
 */
migrationSchema.methods.releaseLock = function () {
  this.lockOwner = null;
  this.lockAcquiredAt = null;
  this.lockExpiresAt = null;

  return this.save();
};

/**
 * Mark migration as running.
 */
migrationSchema.methods.markRunning = function ({
  executedBy = "system",
  runnerId = null,
  hostname = null,
  processId = null,
} = {}) {
  this.status = "running";
  this.startedAt = new Date();
  this.lastAttemptAt = this.startedAt;
  this.attemptCount += 1;

  this.executedBy = executedBy;
  this.runnerId = runnerId;
  this.hostname = hostname;
  this.processId = processId;

  this.error = null;
  this.errorCode = null;
  this.failedAt = null;

  return this.save();
};

/**
 * Mark migration as completed.
 */
migrationSchema.methods.markCompleted = function () {
  const completedAt = new Date();

  this.status = "completed";
  this.completedAt = completedAt;

  if (this.startedAt) {
    this.durationMs =
      completedAt.getTime() -
      this.startedAt.getTime();
  }

  this.error = null;
  this.errorCode = null;
  this.failedAt = null;

  return this.save();
};

/**
 * Mark migration as failed.
 */
migrationSchema.methods.markFailed = function ({
  error = null,
  errorCode = null,
} = {}) {
  const failedAt = new Date();

  this.status = "failed";
  this.failedAt = failedAt;

  this.error = error
    ? String(error).slice(0, MAX_ERROR_LENGTH)
    : null;

  this.errorCode = errorCode
    ? String(errorCode).slice(0, 256)
    : null;

  if (this.startedAt) {
    this.durationMs =
      failedAt.getTime() -
      this.startedAt.getTime();
  }

  return this.save();
};

/**
 * Mark migration as rolled back.
 */
migrationSchema.methods.markRolledBack = function ({
  executedBy = null,
} = {}) {
  const now = new Date();

  this.status = "rolled_back";
  this.rolledBackAt = now;
  this.rollbackExecutedBy = executedBy;

  return this.save();
};

/**
 * Mark rollback as started.
 */
migrationSchema.methods.markRollbackStarted = function () {
  this.rollbackStartedAt = new Date();

  return this.save();
};

/**
 * Record rollback failure.
 */
migrationSchema.methods.markRollbackFailed = function (
  error
) {
  this.rollbackError = error
    ? String(error).slice(0, MAX_ERROR_LENGTH)
    : null;

  return this.save();
};

/**
 * Soft delete.
 */
migrationSchema.methods.softDelete = function () {
  this.isDeleted = true;
  this.deletedAt = new Date();

  return this.save();
};

/**
 * =============================================================================
 * Static Methods
 * =============================================================================
 */

/**
 * Find migration by version.
 */
migrationSchema.statics.findByVersion = function (
  version,
  environment = DEFAULT_ENVIRONMENT
) {
  return this.findOne({
    version,
    environment,
    isDeleted: false,
  });
};

/**
 * Find latest completed migration.
 */
migrationSchema.statics.findLatestCompleted = function (
  environment = DEFAULT_ENVIRONMENT
) {
  return this.findOne({
    environment,
    status: "completed",
    isDeleted: false,
  }).sort({
    sequence: -1,
    version: -1,
  });
};

/**
 * Find currently running migrations.
 */
migrationSchema.statics.findRunning = function (
  environment = DEFAULT_ENVIRONMENT
) {
  return this.find({
    environment,
    status: "running",
    isDeleted: false,
  }).sort({
    startedAt: 1,
  });
};

/**
 * Find stale running migrations.
 */
migrationSchema.statics.findStaleRunning = function (
  environment = DEFAULT_ENVIRONMENT,
  staleBefore = new Date(Date.now() - 30 * 60 * 1000)
) {
  return this.find({
    environment,
    status: "running",
    startedAt: {
      $lt: staleBefore,
    },
    isDeleted: false,
  }).sort({
    startedAt: 1,
  });
};

/**
 * Find migrations whose locks have expired.
 */
migrationSchema.statics.findExpiredLocks = function (
  environment = DEFAULT_ENVIRONMENT
) {
  return this.find({
    environment,
    status: "running",
    lockExpiresAt: {
      $lte: new Date(),
    },
    isDeleted: false,
  });
};

/**
 * Find migrations that failed and can be retried.
 */
migrationSchema.statics.findRetryable = function (
  environment = DEFAULT_ENVIRONMENT
) {
  const now = new Date();

  return this.find({
    environment,
    status: "failed",
    isDeleted: false,
    $or: [
      {
        nextRetryAt: null,
      },
      {
        nextRetryAt: {
          $lte: now,
        },
      },
    ],
  }).sort({
    sequence: 1,
    version: 1,
  });
};

/**
 * Find completed migrations in a batch.
 */
migrationSchema.statics.findBatch = function (
  batch,
  environment = DEFAULT_ENVIRONMENT
) {
  return this.find({
    batch,
    environment,
    isDeleted: false,
  }).sort({
    sequence: 1,
    version: 1,
  });
};

/**
 * =============================================================================
 * Atomic Execution Helpers
 * =============================================================================
 */

/**
 * Atomically claim a migration.
 *
 * This prevents multiple application instances from simultaneously claiming
 * the same migration.
 */
migrationSchema.statics.claimMigration = function ({
  version,
  environment = DEFAULT_ENVIRONMENT,
  runnerId,
  leaseMs = 5 * 60 * 1000,
} = {}) {
  if (!version) {
    throw new Error("Migration version is required");
  }

  if (!runnerId) {
    throw new Error("runnerId is required");
  }

  const now = new Date();

  const lockExpiresAt = new Date(
    now.getTime() + leaseMs
  );

  return this.findOneAndUpdate(
    {
      version,
      environment,
      isDeleted: false,

      $or: [
        {
          status: "pending",
        },
        {
          status: "failed",
          $or: [
            {
              nextRetryAt: null,
            },
            {
              nextRetryAt: {
                $lte: now,
              },
            },
          ],
        },
        {
          status: "running",
          lockExpiresAt: {
            $lte: now,
          },
        },
      ],
    },
    {
      $set: {
        status: "running",
        startedAt: now,
        lastAttemptAt: now,
        lockOwner: runnerId,
        lockAcquiredAt: now,
        lockExpiresAt,
        error: null,
        errorCode: null,
        failedAt: null,
      },

      $inc: {
        attemptCount: 1,
      },
    },
    {
      new: true,
    }
  );
};

/**
 * Atomically complete a migration.
 */
migrationSchema.statics.completeMigration = function ({
  version,
  environment = DEFAULT_ENVIRONMENT,
  runnerId,
} = {}) {
  const completedAt = new Date();

  return this.findOneAndUpdate(
    {
      version,
      environment,
      status: "running",
      lockOwner: runnerId,
      isDeleted: false,
    },
    {
      $set: {
        status: "completed",
        completedAt,
        lockOwner: null,
        lockAcquiredAt: null,
        lockExpiresAt: null,
        error: null,
        errorCode: null,
        failedAt: null,
      },
    },
    {
      new: true,
    }
  );
};

/**
 * Atomically fail a migration.
 */
migrationSchema.statics.failMigration = function ({
  version,
  environment = DEFAULT_ENVIRONMENT,
  runnerId,
  error = null,
  errorCode = null,
  nextRetryAt = null,
} = {}) {
  const failedAt = new Date();

  return this.findOneAndUpdate(
    {
      version,
      environment,
      status: "running",
      lockOwner: runnerId,
      isDeleted: false,
    },
    {
      $set: {
        status: "failed",
        failedAt,

        error: error
          ? String(error).slice(0, MAX_ERROR_LENGTH)
          : null,

        errorCode: errorCode
          ? String(errorCode).slice(0, 256)
          : null,

        nextRetryAt,

        lockOwner: null,
        lockAcquiredAt: null,
        lockExpiresAt: null,
      },
    },
    {
      new: true,
    }
  );
};

/**
 * =============================================================================
 * Lifecycle Validation
 * =============================================================================
 */

migrationSchema.pre("validate", function (next) {
  /**
   * Completed migrations require completedAt.
   */
  if (
    this.status === "completed" &&
    !this.completedAt
  ) {
    this.completedAt = new Date();
  }

  /**
   * Failed migrations require failedAt.
   */
  if (
    this.status === "failed" &&
    !this.failedAt
  ) {
    this.failedAt = new Date();
  }

  /**
   * Rolled-back migrations require rolledBackAt.
   */
  if (
    this.status === "rolled_back" &&
    !this.rolledBackAt
  ) {
    this.rolledBackAt = new Date();
  }

  /**
   * Running migrations should have startedAt.
   */
  if (
    this.status === "running" &&
    !this.startedAt
  ) {
    this.startedAt = new Date();
  }

  /**
   * Duration cannot be negative.
   */
  if (
    this.durationMs != null &&
    this.durationMs < 0
  ) {
    this.invalidate(
      "durationMs",
      "Migration duration cannot be negative"
    );
  }

  /**
   * Lock expiration cannot precede acquisition.
   */
  if (
    this.lockAcquiredAt &&
    this.lockExpiresAt &&
    this.lockExpiresAt < this.lockAcquiredAt
  ) {
    this.invalidate(
      "lockExpiresAt",
      "lockExpiresAt cannot precede lockAcquiredAt"
    );
  }

  next();
});

/**
 * =============================================================================
 * Query Protection
 * ============================================================================= */

migrationSchema.pre(/^find/, function (next) {
  const options = this.getOptions();

  if (!options.includeDeleted) {
    this.where({
      isDeleted: false,
    });
  }

  next();
});

/**
 * =============================================================================
 * JSON Serialization
 * ============================================================================= */

migrationSchema.methods.toJSON = function () {
  const obj = this.toObject();

  /**
   * Migration error information can contain implementation details.
   *
   * Do not automatically expose it through generic API serialization.
   */
  delete obj.error;
  delete obj.rollbackError;

  return obj;
};

/**
 * =============================================================================
 * Model Export
 * =============================================================================
 */

module.exports =
  mongoose.models.Migration ||
  mongoose.model("Migration", migrationSchema);