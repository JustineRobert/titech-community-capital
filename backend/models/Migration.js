/**
 * backend/models/Migration.js
 * TITech Community Capital — Migration Registry Model
 *
 * Architectural role:
 * - Persists database-migration registry and execution metadata.
 * - Tracks migration identity, ordering, status, deployment batch,
 *   checksum/integrity information, execution ownership, retry state,
 *   and distributed lease information.
 * - Provides controlled atomic state-transition helpers for the
 *   migration runner.
 *
 * Important boundaries:
 * - This model is infrastructure metadata only.
 * - Migration code execution belongs to the migration runner/service.
 * - Database lock/lease acquisition is exposed only through controlled
 *   atomic model operations.
 * - Business-domain authorization is not implemented here.
 * - Migration definitions should remain filesystem/source-control artifacts;
 *   this collection is their execution registry, not their source of truth.
 * - Migration records should normally be retained permanently for deployment
 *   and forensic history.
 * - Rollback execution itself belongs to the migration runner.
 *
 * Security principles:
 * - Native ESM only.
 * - Immutable migration identity.
 * - Environment + version uniqueness.
 * - Controlled state transitions.
 * - Atomic runner ownership/lease checks.
 * - Optimistic concurrency enabled.
 * - Generic update/delete operations blocked.
 * - Checksum drift detection supported.
 * - Error information bounded.
 * - Lease expiration supports crashed-runner recovery.
 * - Administrative deletion is intentionally disabled at model level.
 *
 * Module format:
 * - Native ECMAScript Modules (ESM)
 *
 * Canonical collection:
 * - migrations
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

/* ==========================================================================
 * Constants
 * ========================================================================== */

export const MIGRATION_STATUSES = Object.freeze([
  'pending',
  'running',
  'completed',
  'failed',
  'rolled_back',
]);

export const MIGRATION_ENVIRONMENTS = Object.freeze([
  'development',
  'test',
  'staging',
  'production',
]);

export const CHECKSUM_ALGORITHMS = Object.freeze([
  'sha256',
  'sha384',
  'sha512',
]);

const DEFAULT_ENVIRONMENT =
  MIGRATION_ENVIRONMENTS.includes(process.env.NODE_ENV)
    ? process.env.NODE_ENV
    : 'development';

export const DEFAULT_MIGRATION_LEASE_MS =
  5 * 60 * 1000;

export const DEFAULT_STALE_AFTER_MS =
  30 * 60 * 1000;

const MAX_VERSION_LENGTH = 200;
const MAX_NAME_LENGTH = 256;
const MAX_DESCRIPTION_LENGTH = 1_000;
const MAX_PATH_LENGTH = 1_000;
const MAX_EXECUTED_BY_LENGTH = 256;
const MAX_HOSTNAME_LENGTH = 256;
const MAX_PROCESS_ID_LENGTH = 128;
const MAX_RUNNER_ID_LENGTH = 256;
const MAX_ERROR_LENGTH = 10_000;
const MAX_ERROR_CODE_LENGTH = 256;
const MAX_CHECKSUM_LENGTH = 256;
const MAX_NOTES_LENGTH = 5_000;

const MIN_LEASE_MS = 10_000;
const MAX_LEASE_MS = 24 * 60 * 60 * 1000;

/* ==========================================================================
 * Helpers
 * ========================================================================== */

function normalizeRequiredString(
  value,
  fieldName,
  maxLength,
) {
  if (value === undefined || value === null) {
    throw new TypeError(
      `${fieldName} is required.`,
    );
  }

  const normalized = String(value).trim();

  if (!normalized) {
    throw new TypeError(
      `${fieldName} is required.`,
    );
  }

  if (normalized.length > maxLength) {
    throw new RangeError(
      `${fieldName} exceeds the maximum length of ${maxLength}.`,
    );
  }

  return normalized;
}

function normalizeOptionalString(
  value,
  maxLength,
) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, maxLength);
}

function normalizeLeaseMs(value) {
  const leaseMs =
    Number.isFinite(Number(value))
      ? Number(value)
      : DEFAULT_MIGRATION_LEASE_MS;

  if (
    leaseMs < MIN_LEASE_MS ||
    leaseMs > MAX_LEASE_MS
  ) {
    throw new RangeError(
      `leaseMs must be between ${MIN_LEASE_MS} and ${MAX_LEASE_MS} milliseconds.`,
    );
  }

  return Math.floor(leaseMs);
}

function normalizeEnvironment(environment) {
  const value =
    environment ?? DEFAULT_ENVIRONMENT;

  if (!MIGRATION_ENVIRONMENTS.includes(value)) {
    throw new TypeError(
      `Unsupported migration environment: ${value}.`,
    );
  }

  return value;
}

function normalizeVersion(version) {
  return normalizeRequiredString(
    version,
    'version',
    MAX_VERSION_LENGTH,
  );
}

function normalizeError(error) {
  if (error === undefined || error === null) {
    return null;
  }

  if (error instanceof Error) {
    return error.stack
      ? error.stack.slice(0, MAX_ERROR_LENGTH)
      : error.message.slice(0, MAX_ERROR_LENGTH);
  }

  return String(error).slice(
    0,
    MAX_ERROR_LENGTH,
  );
}

function normalizeErrorCode(errorCode) {
  return normalizeOptionalString(
    errorCode,
    MAX_ERROR_CODE_LENGTH,
  );
}

function calculateDurationMs(startedAt, endedAt) {
  if (!startedAt || !endedAt) {
    return null;
  }

  const duration =
    new Date(endedAt).getTime() -
    new Date(startedAt).getTime();

  return duration >= 0 ? duration : null;
}

/* ==========================================================================
 * Schema
 * ========================================================================== */

const MigrationSchema = new Schema(
  {
    /*
     * ------------------------------------------------------------------------
     * Migration identity
     * ------------------------------------------------------------------------
     */

    version: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      minlength: 3,
      maxlength: MAX_VERSION_LENGTH,
    },

    name: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      minlength: 1,
      maxlength: MAX_NAME_LENGTH,
    },

    description: {
      type: String,
      default: null,
      trim: true,
      maxlength: MAX_DESCRIPTION_LENGTH,
      immutable: true,
    },

    /*
     * ------------------------------------------------------------------------
     * Ordering
     * ------------------------------------------------------------------------
     */

    sequence: {
      type: Number,
      min: 0,
      default: null,
      immutable: true,
    },

    /*
     * ------------------------------------------------------------------------
     * Lifecycle
     * ------------------------------------------------------------------------
     */

    status: {
      type: String,
      enum: MIGRATION_STATUSES,
      required: true,
      default: 'pending',
      index: true,
    },

    /*
     * ------------------------------------------------------------------------
     * Execution timestamps
     * ------------------------------------------------------------------------
     */

    startedAt: {
      type: Date,
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    failedAt: {
      type: Date,
      default: null,
    },

    rolledBackAt: {
      type: Date,
      default: null,
    },

    rollbackStartedAt: {
      type: Date,
      default: null,
    },

    /*
     * Duration
     * ------------------------------------------------------------------------
     */

    durationMs: {
      type: Number,
      min: 0,
      default: null,
    },

    /*
     * ------------------------------------------------------------------------
     * Execution ownership
     * ------------------------------------------------------------------------
     */

    executedBy: {
      type: String,
      trim: true,
      maxlength: MAX_EXECUTED_BY_LENGTH,
      default: 'system',
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
      maxlength: MAX_RUNNER_ID_LENGTH,
      default: null,
      index: true,
    },

    /*
     * ------------------------------------------------------------------------
     * Environment
     * ------------------------------------------------------------------------
     */

    environment: {
      type: String,
      enum: MIGRATION_ENVIRONMENTS,
      required: true,
      immutable: true,
      default: DEFAULT_ENVIRONMENT,
    },

    /*
     * ------------------------------------------------------------------------
     * Deployment batch
     * ------------------------------------------------------------------------
     */

    batch: {
      type: Number,
      min: 0,
      default: null,
    },

    /*
     * ------------------------------------------------------------------------
     * Migration source
     * ------------------------------------------------------------------------
     */

    path: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      maxlength: MAX_PATH_LENGTH,
    },

    /*
     * ------------------------------------------------------------------------
     * Integrity
     * ------------------------------------------------------------------------
     *
     * The checksum represents the migration source at execution time.
     * Once a migration is completed, the checksum must not change.
     */

    checksum: {
      type: String,
      trim: true,
      maxlength: MAX_CHECKSUM_LENGTH,
      default: null,
    },

    checksumAlgorithm: {
      type: String,
      enum: CHECKSUM_ALGORITHMS,
      default: 'sha256',
      immutable: true,
    },

    /*
     * ------------------------------------------------------------------------
     * Rollback information
     * ------------------------------------------------------------------------
     */

    rollbackError: {
      type: String,
      default: null,
      trim: true,
      maxlength: MAX_ERROR_LENGTH,
    },

    rollbackExecutedBy: {
      type: String,
      default: null,
      trim: true,
      maxlength: MAX_EXECUTED_BY_LENGTH,
    },

    /*
     * ------------------------------------------------------------------------
     * Failure information
     * ------------------------------------------------------------------------
     */

    error: {
      type: String,
      default: null,
      trim: true,
      maxlength: MAX_ERROR_LENGTH,
    },

    errorCode: {
      type: String,
      default: null,
      trim: true,
      maxlength: MAX_ERROR_CODE_LENGTH,
    },

    /*
     * ------------------------------------------------------------------------
     * Retry / recovery
     * ------------------------------------------------------------------------
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

    /*
     * ------------------------------------------------------------------------
     * Distributed lease
     * ------------------------------------------------------------------------
     */

    lockOwner: {
      type: String,
      default: null,
      trim: true,
      maxlength: MAX_RUNNER_ID_LENGTH,
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

    /*
     * ------------------------------------------------------------------------
     * Operational notes
     * ------------------------------------------------------------------------
     */

    notes: {
      type: String,
      default: null,
      trim: true,
      maxlength: MAX_NOTES_LENGTH,
    },

    /*
     * ------------------------------------------------------------------------
     * Administrative lifecycle flag
     * ------------------------------------------------------------------------
     *
     * Retained for compatibility/administrative visibility.
     * Normal application code must not use it to hide migration history.
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

    optimisticConcurrency: true,

    versionKey: '__v',

    collection: 'migrations',

    minimize: true,

    strict: 'throw',

    toJSON: {
      virtuals: true,
      versionKey: false,

      transform(doc, ret) {
        ret.id = ret._id.toString();

        delete ret._id;
        delete ret.__v;

        return ret;
      },
    },

    toObject: {
      virtuals: true,
      versionKey: false,
    },
  },
);

/* ==========================================================================
 * Indexes
 * ========================================================================== */

/**
 * One migration definition per environment.
 *
 * This replaces the old globally unique "version" constraint.
 */
MigrationSchema.index(
  {
    environment: 1,
    version: 1,
  },
  {
    unique: true,
    name: 'migration_environment_version_unique',
  },
);

MigrationSchema.index({
  environment: 1,
  sequence: 1,
  version: 1,
});

MigrationSchema.index({
  environment: 1,
  batch: 1,
  sequence: 1,
  version: 1,
});

MigrationSchema.index({
  environment: 1,
  status: 1,
  startedAt: 1,
});

MigrationSchema.index({
  environment: 1,
  status: 1,
  completedAt: -1,
});

MigrationSchema.index({
  environment: 1,
  lockOwner: 1,
  lockExpiresAt: 1,
});

MigrationSchema.index({
  environment: 1,
  lockExpiresAt: 1,
});

MigrationSchema.index({
  environment: 1,
  nextRetryAt: 1,
});

MigrationSchema.index({
  environment: 1,
  createdAt: -1,
});

/* ==========================================================================
 * Query helpers
 * ========================================================================== */

MigrationSchema.query.active =
  function active() {
    return this.where({
      isDeleted: false,
    });
  };

MigrationSchema.query.pending =
  function pending() {
    return this.where({
      status: 'pending',
      isDeleted: false,
    });
  };

MigrationSchema.query.running =
  function running() {
    return this.where({
      status: 'running',
      isDeleted: false,
    });
  };

MigrationSchema.query.completed =
  function completed() {
    return this.where({
      status: 'completed',
      isDeleted: false,
    });
  };

MigrationSchema.query.failed =
  function failed() {
    return this.where({
      status: 'failed',
      isDeleted: false,
    });
  };

MigrationSchema.query.rolledBack =
  function rolledBack() {
    return this.where({
      status: 'rolled_back',
      isDeleted: false,
    });
  };

/* ==========================================================================
 * Instance state inspection
 * ========================================================================== */

MigrationSchema.methods.isCompleted =
  function isCompleted() {
    return this.status === 'completed';
  };

MigrationSchema.methods.isRunnable =
  function isRunnable() {
    return (
      !this.isDeleted &&
      ['pending', 'failed'].includes(
        this.status,
      )
    );
  };

MigrationSchema.methods.isRunning =
  function isRunning() {
    return (
      !this.isDeleted &&
      this.status === 'running'
    );
  };

MigrationSchema.methods.isLockExpired =
  function isLockExpired() {
    if (!this.lockExpiresAt) {
      return true;
    }

    return (
      this.lockExpiresAt.getTime() <= Date.now()
    );
  };

MigrationSchema.methods.isStale =
  function isStale(
    staleAfterMs = DEFAULT_STALE_AFTER_MS,
  ) {
    if (
      this.status !== 'running' ||
      !this.startedAt
    ) {
      return false;
    }

    return (
      Date.now() -
        this.startedAt.getTime() >=
      staleAfterMs
    );
  };

/* ==========================================================================
 * Controlled state methods
 * ========================================================================== */

/**
 * Instance-level lease acquisition.
 *
 * This method is useful when the caller already holds the appropriate
 * application-level serialization. For distributed ownership, prefer
 * Migration.claimMigration().
 */
MigrationSchema.methods.acquireLock =
  async function acquireLock({
    lockOwner,
    leaseMs = DEFAULT_MIGRATION_LEASE_MS,
  } = {}) {
    const normalizedOwner =
      normalizeRequiredString(
        lockOwner,
        'lockOwner',
        MAX_RUNNER_ID_LENGTH,
      );

    const normalizedLeaseMs =
      normalizeLeaseMs(leaseMs);

    const now = new Date();

    if (
      this.lockOwner &&
      this.lockOwner !== normalizedOwner &&
      !this.isLockExpired()
    ) {
      throw new Error(
        'Migration lock is already owned by another runner.',
      );
    }

    this.lockOwner = normalizedOwner;
    this.lockAcquiredAt = now;
    this.lockExpiresAt = new Date(
      now.getTime() + normalizedLeaseMs,
    );

    await this.save();

    return this;
  };

/**
 * Renew an existing lease.
 */
MigrationSchema.methods.renewLock =
  async function renewLock({
    lockOwner,
    leaseMs = DEFAULT_MIGRATION_LEASE_MS,
  } = {}) {
    const normalizedOwner =
      normalizeRequiredString(
        lockOwner,
        'lockOwner',
        MAX_RUNNER_ID_LENGTH,
      );

    const normalizedLeaseMs =
      normalizeLeaseMs(leaseMs);

    if (
      this.status !== 'running' ||
      this.lockOwner !== normalizedOwner
    ) {
      throw new Error(
        'Migration lease cannot be renewed because this runner does not own the migration.',
      );
    }

    const now = new Date();

    if (this.isLockExpired()) {
      throw new Error(
        'Migration lease has already expired.',
      );
    }

    this.lockExpiresAt = new Date(
      now.getTime() + normalizedLeaseMs,
    );

    await this.save();

    return this;
  };

MigrationSchema.methods.releaseLock =
  async function releaseLock({
    lockOwner,
  } = {}) {
    const normalizedOwner =
      normalizeRequiredString(
        lockOwner,
        'lockOwner',
        MAX_RUNNER_ID_LENGTH,
      );

    if (
      this.lockOwner &&
      this.lockOwner !== normalizedOwner
    ) {
      throw new Error(
        'Migration lock cannot be released by another runner.',
      );
    }

    this.lockOwner = null;
    this.lockAcquiredAt = null;
    this.lockExpiresAt = null;

    await this.save();

    return this;
  };

MigrationSchema.methods.markRunning =
  async function markRunning({
    executedBy = 'system',
    runnerId = null,
    hostname = null,
    processId = null,
    leaseMs = DEFAULT_MIGRATION_LEASE_MS,
  } = {}) {
    if (!this.isRunnable()) {
      throw new Error(
        `Migration cannot enter running state from "${this.status}".`,
      );
    }

    const now = new Date();
    const normalizedLeaseMs =
      normalizeLeaseMs(leaseMs);

    this.status = 'running';

    this.startedAt = now;
    this.lastAttemptAt = now;

    this.attemptCount += 1;

    this.executedBy =
      normalizeOptionalString(
        executedBy,
        MAX_EXECUTED_BY_LENGTH,
      ) ?? 'system';

    this.runnerId =
      normalizeOptionalString(
        runnerId,
        MAX_RUNNER_ID_LENGTH,
      );

    this.hostname =
      normalizeOptionalString(
        hostname,
        MAX_HOSTNAME_LENGTH,
      );

    this.processId =
      normalizeOptionalString(
        processId,
        MAX_PROCESS_ID_LENGTH,
      );

    this.lockOwner = this.runnerId;
    this.lockAcquiredAt = now;
    this.lockExpiresAt = new Date(
      now.getTime() + normalizedLeaseMs,
    );

    this.completedAt = null;
    this.failedAt = null;
    this.rolledBackAt = null;
    this.rollbackStartedAt = null;

    this.error = null;
    this.errorCode = null;
    this.rollbackError = null;

    this.nextRetryAt = null;

    this.durationMs = null;

    await this.save();

    return this;
  };

MigrationSchema.methods.markCompleted =
  async function markCompleted({
    runnerId = null,
    checksum = undefined,
  } = {}) {
    if (this.status !== 'running') {
      throw new Error(
        `Migration cannot be completed from "${this.status}".`,
      );
    }

    if (
      runnerId &&
      this.lockOwner !== runnerId
    ) {
      throw new Error(
        'Only the owning runner can complete this migration.',
      );
    }

    if (
      this.lockExpiresAt &&
      this.isLockExpired()
    ) {
      throw new Error(
        'Migration lease has expired; completion is rejected.',
      );
    }

    const completedAt = new Date();

    if (
      checksum !== undefined &&
      checksum !== null
    ) {
      this.checksum =
        normalizeRequiredString(
          checksum,
          'checksum',
          MAX_CHECKSUM_LENGTH,
        );
    }

    this.status = 'completed';
    this.completedAt = completedAt;

    this.durationMs =
      calculateDurationMs(
        this.startedAt,
        completedAt,
      );

    this.failedAt = null;
    this.error = null;
    this.errorCode = null;

    this.nextRetryAt = null;

    this.lockOwner = null;
    this.lockAcquiredAt = null;
    this.lockExpiresAt = null;

    await this.save();

    return this;
  };

MigrationSchema.methods.markFailed =
  async function markFailed({
    runnerId = null,
    error = null,
    errorCode = null,
    nextRetryAt = null,
  } = {}) {
    if (this.status !== 'running') {
      throw new Error(
        `Migration cannot be failed from "${this.status}".`,
      );
    }

    if (
      runnerId &&
      this.lockOwner !== runnerId
    ) {
      throw new Error(
        'Only the owning runner can fail this migration.',
      );
    }

    const failedAt = new Date();

    this.status = 'failed';
    this.failedAt = failedAt;

    this.durationMs =
      calculateDurationMs(
        this.startedAt,
        failedAt,
      );

    this.error = normalizeError(error);
    this.errorCode =
      normalizeErrorCode(errorCode);

    this.nextRetryAt =
      nextRetryAt
        ? new Date(nextRetryAt)
        : null;

    this.lockOwner = null;
    this.lockAcquiredAt = null;
    this.lockExpiresAt = null;

    await this.save();

    return this;
  };

MigrationSchema.methods.markRollbackStarted =
  async function markRollbackStarted({
    runnerId = null,
  } = {}) {
    if (
      runnerId &&
      this.runnerId &&
      this.runnerId !== runnerId
    ) {
      throw new Error(
        'Rollback cannot be started by another runner.',
      );
    }

    this.rollbackStartedAt =
      new Date();

    await this.save();

    return this;
  };

MigrationSchema.methods.markRollbackFailed =
  async function markRollbackFailed(
    error,
  ) {
    this.rollbackError =
      normalizeError(error);

    await this.save();

    return this;
  };

MigrationSchema.methods.markRolledBack =
  async function markRolledBack({
    executedBy = null,
  } = {}) {
    if (
      ![
        'completed',
        'failed',
        'running',
      ].includes(this.status)
    ) {
      throw new Error(
        `Migration cannot be rolled back from "${this.status}".`,
      );
    }

    const now = new Date();

    this.status = 'rolled_back';
    this.rolledBackAt = now;

    this.rollbackExecutedBy =
      normalizeOptionalString(
        executedBy,
        MAX_EXECUTED_BY_LENGTH,
      );

    this.lockOwner = null;
    this.lockAcquiredAt = null;
    this.lockExpiresAt = null;

    await this.save();

    return this;
  };

/* ==========================================================================
 * Static lookup methods
 * ========================================================================== */

MigrationSchema.statics.findByVersion =
  function findByVersion(
    version,
    environment = DEFAULT_ENVIRONMENT,
  ) {
    return this.findOne({
      version: normalizeVersion(version),
      environment:
        normalizeEnvironment(environment),
      isDeleted: false,
    });
  };

MigrationSchema.statics.findLatestCompleted =
  function findLatestCompleted(
    environment = DEFAULT_ENVIRONMENT,
  ) {
    return this.findOne({
      environment:
        normalizeEnvironment(environment),
      status: 'completed',
      isDeleted: false,
    }).sort({
      sequence: -1,
      version: -1,
    });
  };

MigrationSchema.statics.findRunning =
  function findRunning(
    environment = DEFAULT_ENVIRONMENT,
  ) {
    return this.find({
      environment:
        normalizeEnvironment(environment),
      status: 'running',
      isDeleted: false,
    }).sort({
      startedAt: 1,
      sequence: 1,
      version: 1,
    });
  };

MigrationSchema.statics.findStaleRunning =
  function findStaleRunning(
    environment = DEFAULT_ENVIRONMENT,
    staleBefore = new Date(
      Date.now() -
        DEFAULT_STALE_AFTER_MS,
    ),
  ) {
    return this.find({
      environment:
        normalizeEnvironment(environment),
      status: 'running',
      startedAt: {
        $lt: staleBefore,
      },
      isDeleted: false,
    }).sort({
      startedAt: 1,
      sequence: 1,
      version: 1,
    });
  };

MigrationSchema.statics.findExpiredLocks =
  function findExpiredLocks(
    environment = DEFAULT_ENVIRONMENT,
  ) {
    return this.find({
      environment:
        normalizeEnvironment(environment),
      status: 'running',
      lockExpiresAt: {
        $lte: new Date(),
      },
      isDeleted: false,
    }).sort({
      lockExpiresAt: 1,
      sequence: 1,
      version: 1,
    });
  };

MigrationSchema.statics.findRetryable =
  function findRetryable(
    environment = DEFAULT_ENVIRONMENT,
  ) {
    const now = new Date();

    return this.find({
      environment:
        normalizeEnvironment(environment),
      status: 'failed',
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

MigrationSchema.statics.findBatch =
  function findBatch(
    batch,
    environment = DEFAULT_ENVIRONMENT,
  ) {
    if (
      batch === undefined ||
      batch === null
    ) {
      throw new TypeError(
        'batch is required.',
      );
    }

    return this.find({
      environment:
        normalizeEnvironment(environment),
      batch,
      isDeleted: false,
    }).sort({
      sequence: 1,
      version: 1,
    });
  };

/* ==========================================================================
 * Atomic migration runner operations
 * ========================================================================== */

/**
 * Atomically claim a migration.
 *
 * A claim succeeds only when:
 * - pending, or
 * - failed and retryable, or
 * - running with an expired lease.
 *
 * The previous runner's ownership is replaced only when its lease has expired.
 */
MigrationSchema.statics.claimMigration =
  async function claimMigration({
    version,
    environment = DEFAULT_ENVIRONMENT,
    runnerId,
    executedBy = 'system',
    hostname = null,
    processId = null,
    leaseMs = DEFAULT_MIGRATION_LEASE_MS,
  } = {}) {
    const normalizedVersion =
      normalizeVersion(version);

    const normalizedEnvironment =
      normalizeEnvironment(environment);

    const normalizedRunnerId =
      normalizeRequiredString(
        runnerId,
        'runnerId',
        MAX_RUNNER_ID_LENGTH,
      );

    const normalizedLeaseMs =
      normalizeLeaseMs(leaseMs);

    const now = new Date();

    const lockExpiresAt = new Date(
      now.getTime() +
        normalizedLeaseMs,
    );

    const filter = {
      version: normalizedVersion,
      environment:
        normalizedEnvironment,
      isDeleted: false,

      $or: [
        {
          status: 'pending',
        },
        {
          status: 'failed',
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
          status: 'running',
          lockExpiresAt: {
            $lte: now,
          },
        },
      ],
    };

    const update = {
      $set: {
        status: 'running',

        startedAt: now,
        lastAttemptAt: now,

        executedBy:
          normalizeOptionalString(
            executedBy,
            MAX_EXECUTED_BY_LENGTH,
          ) ?? 'system',

        runnerId: normalizedRunnerId,

        hostname:
          normalizeOptionalString(
            hostname,
            MAX_HOSTNAME_LENGTH,
          ),

        processId:
          normalizeOptionalString(
            processId,
            MAX_PROCESS_ID_LENGTH,
          ),

        lockOwner: normalizedRunnerId,
        lockAcquiredAt: now,
        lockExpiresAt,

        completedAt: null,
        failedAt: null,
        rolledBackAt: null,
        rollbackStartedAt: null,

        error: null,
        errorCode: null,
        rollbackError: null,
        nextRetryAt: null,
        durationMs: null,
      },

      $inc: {
        attemptCount: 1,
      },
    };

    const migration =
      await this.findOneAndUpdate(
        filter,
        update,
        {
          new: true,
          runValidators: true,
          returnDocument: 'after',
        },
      ).exec();

    return migration;
  };

/**
 * Renew a distributed migration lease atomically.
 */
MigrationSchema.statics.renewMigrationLease =
  async function renewMigrationLease({
    version,
    environment = DEFAULT_ENVIRONMENT,
    runnerId,
    leaseMs = DEFAULT_MIGRATION_LEASE_MS,
  } = {}) {
    const normalizedVersion =
      normalizeVersion(version);

    const normalizedEnvironment =
      normalizeEnvironment(environment);

    const normalizedRunnerId =
      normalizeRequiredString(
        runnerId,
        'runnerId',
        MAX_RUNNER_ID_LENGTH,
      );

    const normalizedLeaseMs =
      normalizeLeaseMs(leaseMs);

    const now = new Date();

    const lockExpiresAt = new Date(
      now.getTime() +
        normalizedLeaseMs,
    );

    return this.findOneAndUpdate(
      {
        version: normalizedVersion,
        environment:
          normalizedEnvironment,
        status: 'running',
        lockOwner: normalizedRunnerId,
        lockExpiresAt: {
          $gt: now,
        },
        isDeleted: false,
      },
      {
        $set: {
          lockExpiresAt,
        },
      },
      {
        new: true,
        runValidators: true,
      },
    ).exec();
  };

/**
 * Atomically complete a migration.
 */
MigrationSchema.statics.completeMigration =
  async function completeMigration({
    version,
    environment = DEFAULT_ENVIRONMENT,
    runnerId,
    checksum = undefined,
  } = {}) {
    const normalizedVersion =
      normalizeVersion(version);

    const normalizedEnvironment =
      normalizeEnvironment(environment);

    const normalizedRunnerId =
      normalizeRequiredString(
        runnerId,
        'runnerId',
        MAX_RUNNER_ID_LENGTH,
      );

    const now = new Date();

    const update = {
      $set: {
        status: 'completed',
        completedAt: now,

        failedAt: null,
        error: null,
        errorCode: null,
        nextRetryAt: null,

        lockOwner: null,
        lockAcquiredAt: null,
        lockExpiresAt: null,
      },
    };

    if (checksum !== undefined) {
      update.$set.checksum =
        normalizeRequiredString(
          checksum,
          'checksum',
          MAX_CHECKSUM_LENGTH,
        );
    }

    /**
     * Duration is calculated using the stored startedAt value through a
     * pipeline-free two-step pattern in the runner. The model therefore
     * retains startedAt and the completion timestamp; a subsequent read
     * can derive duration precisely if needed.
     */
    const migration =
      await this.findOneAndUpdate(
        {
          version: normalizedVersion,
          environment:
            normalizedEnvironment,
          status: 'running',
          lockOwner: normalizedRunnerId,
          lockExpiresAt: {
            $gt: now,
          },
          isDeleted: false,
        },
        update,
        {
          new: true,
          runValidators: true,
        },
      ).exec();

    if (migration?.startedAt) {
      migration.durationMs =
        calculateDurationMs(
          migration.startedAt,
          migration.completedAt,
        );

      await migration.save();
    }

    return migration;
  };

/**
 * Atomically fail a migration and release its lease.
 */
MigrationSchema.statics.failMigration =
  async function failMigration({
    version,
    environment = DEFAULT_ENVIRONMENT,
    runnerId,
    error = null,
    errorCode = null,
    nextRetryAt = null,
  } = {}) {
    const normalizedVersion =
      normalizeVersion(version);

    const normalizedEnvironment =
      normalizeEnvironment(environment);

    const normalizedRunnerId =
      normalizeRequiredString(
        runnerId,
        'runnerId',
        MAX_RUNNER_ID_LENGTH,
      );

    const failedAt = new Date();

    const migration =
      await this.findOneAndUpdate(
        {
          version: normalizedVersion,
          environment:
            normalizedEnvironment,
          status: 'running',
          lockOwner: normalizedRunnerId,
          isDeleted: false,
        },
        {
          $set: {
            status: 'failed',
            failedAt,

            error: normalizeError(error),
            errorCode:
              normalizeErrorCode(errorCode),

            nextRetryAt: nextRetryAt
              ? new Date(nextRetryAt)
              : null,

            lockOwner: null,
            lockAcquiredAt: null,
            lockExpiresAt: null,
          },
        },
        {
          new: true,
          runValidators: true,
        },
      ).exec();

    if (migration?.startedAt) {
      migration.durationMs =
        calculateDurationMs(
          migration.startedAt,
          failedAt,
        );

      await migration.save();
    }

    return migration;
  };

/**
 * Atomically mark a migration as rolled back.
 */
MigrationSchema.statics.rollbackMigration =
  async function rollbackMigration({
    version,
    environment = DEFAULT_ENVIRONMENT,
    runnerId,
    executedBy = null,
  } = {}) {
    const normalizedVersion =
      normalizeVersion(version);

    const normalizedEnvironment =
      normalizeEnvironment(environment);

    const normalizedRunnerId =
      normalizeRequiredString(
        runnerId,
        'runnerId',
        MAX_RUNNER_ID_LENGTH,
      );

    return this.findOneAndUpdate(
      {
        version: normalizedVersion,
        environment:
          normalizedEnvironment,
        lockOwner: normalizedRunnerId,
        isDeleted: false,
        status: {
          $in: [
            'running',
            'completed',
            'failed',
          ],
        },
      },
      {
        $set: {
          status: 'rolled_back',
          rolledBackAt: new Date(),

          rollbackExecutedBy:
            normalizeOptionalString(
              executedBy,
              MAX_EXECUTED_BY_LENGTH,
            ),

          lockOwner: null,
          lockAcquiredAt: null,
          lockExpiresAt: null,
        },
      },
      {
        new: true,
        runValidators: true,
      },
    ).exec();
  };

/* ==========================================================================
 * Source/integrity helpers
 * ========================================================================== */

/**
 * Compare the stored checksum against a newly calculated migration checksum.
 *
 * This is intentionally a pure comparison; checksum calculation itself
 * belongs to the migration runner.
 */
MigrationSchema.methods.hasChecksumDrift =
  function hasChecksumDrift(
    currentChecksum,
  ) {
    if (!currentChecksum) {
      throw new TypeError(
        'currentChecksum is required.',
      );
    }

    if (!this.checksum) {
      return true;
    }

    return (
      this.checksum !==
      String(currentChecksum).trim()
    );
  };

/**
 * Soft-delete is intentionally not exposed as a normal destructive API.
 *
 * Migration history should remain authoritative. This method exists only for
 * tightly controlled administrative maintenance invoked by an approved
 * infrastructure service.
 */
MigrationSchema.statics.adminSoftDelete =
  async function adminSoftDelete({
    version,
    environment = DEFAULT_ENVIRONMENT,
  } = {}) {
    const normalizedVersion =
      normalizeVersion(version);

    const normalizedEnvironment =
      normalizeEnvironment(environment);

    return this.findOneAndUpdate(
      {
        version: normalizedVersion,
        environment:
          normalizedEnvironment,
      },
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
        },
      },
      {
        new: true,
      },
    ).exec();
  };

/* ==========================================================================
 * Validation
 * ========================================================================== */

MigrationSchema.pre(
  'validate',
  function validateMigration(next) {
    try {
      if (
        this.status === 'running' &&
        !this.startedAt
      ) {
        this.startedAt = new Date();
      }

      if (
        this.status === 'completed' &&
        !this.completedAt
      ) {
        this.completedAt = new Date();
      }

      if (
        this.status === 'failed' &&
        !this.failedAt
      ) {
        this.failedAt = new Date();
      }

      if (
        this.status === 'rolled_back' &&
        !this.rolledBackAt
      ) {
        this.rolledBackAt = new Date();
      }

      if (
        this.durationMs !== null &&
        this.durationMs !== undefined &&
        this.durationMs < 0
      ) {
        this.invalidate(
          'durationMs',
          'Migration duration cannot be negative.',
        );
      }

      if (
        this.lockAcquiredAt &&
        this.lockExpiresAt &&
        this.lockExpiresAt <
          this.lockAcquiredAt
      ) {
        this.invalidate(
          'lockExpiresAt',
          'lockExpiresAt cannot precede lockAcquiredAt.',
        );
      }

      if (
        this.status === 'running' &&
        !this.lockOwner
      ) {
        this.invalidate(
          'lockOwner',
          'Running migrations must have a lock owner.',
        );
      }

      if (
        this.status !== 'running' &&
        (
          this.lockOwner ||
          this.lockAcquiredAt ||
          this.lockExpiresAt
        )
      ) {
        /**
         * Clear stale ownership when a terminal/non-running state is saved.
         */
        this.lockOwner = null;
        this.lockAcquiredAt = null;
        this.lockExpiresAt = null;
      }

      /**
       * Once completed, the source checksum becomes an integrity record.
       * Changing it later would defeat drift detection.
       */
      if (
        !this.isNew &&
        this.status === 'completed' &&
        this.isModified('checksum')
      ) {
        this.invalidate(
          'checksum',
          'Completed migration checksum is immutable.',
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  });

/* ==========================================================================
 * Query mutation protection
 * ========================================================================== */

MigrationSchema.pre(
  [
    'deleteOne',
    'deleteMany',
    'findOneAndDelete',
    'findByIdAndDelete',
  ],
  function preventDelete(next) {
    next(
      new mongoose.Error.MongooseError(
        'Migration records are operational history and cannot be hard-deleted.',
      ),
    );
  },
);

MigrationSchema.pre(
  [
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
    'findByIdAndUpdate',
    'replaceOne',
  ],
  function preventGenericMutation(next) {
    const options = this.getOptions();

    if (
      options.allowMigrationMutation === true
    ) {
      return next();
    }

    next(
      new mongoose.Error.MongooseError(
        'Generic Migration updates are disabled. Use controlled migration lifecycle methods.',
      ),
    );
  },
);

MigrationSchema.pre(
  'bulkWrite',
  function preventBulkWrite(next) {
    next(
      new mongoose.Error.MongooseError(
        'bulkWrite is disabled for Migration.',
      ),
    );
  },
);

/* ==========================================================================
 * Model export
 * ========================================================================== */

const Migration =
  mongoose.models.Migration ||
  mongoose.model(
    'Migration',
    MigrationSchema,
  );

export default Migration;

export {
  MigrationSchema,
  DEFAULT_ENVIRONMENT,
};