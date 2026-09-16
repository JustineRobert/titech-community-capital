// ============================================================================
// backend/models/FraudLog.js
// TITech Community Capital LTD
// Enterprise Fraud Evaluation Log
// ============================================================================
//
// Purpose
//   Durable, tenant-aware record of fraud-risk evaluations performed against
//   financial transactions.
//
// Architectural boundary
//   FraudLog records fraud evaluation evidence.
//   It does NOT:
//     - mutate the canonical Transaction;
//     - mutate wallet balances;
//     - create ledger entries;
//     - approve/settle financial transactions;
//     - replace compliance case-management systems.
//
// Security principles
//   - Tenant isolation.
//   - Decision evidence is immutable.
//   - Encryption failures fail CLOSED.
//   - Sensitive snapshot fields are not returned by default.
//   - Review state is separate from the original fraud decision.
//   - Model/rule version is preserved for reproducibility.
//   - Query operations are tenant-scoped.
//   - No direct update/delete path should alter historical evaluation evidence.
//
// Module format
//   ESM.
//
// ============================================================================

import mongoose from 'mongoose';

const { Schema } = mongoose;

// =============================================================================
// Optional utilities
// =============================================================================

let encryptUtil = null;
let logger = console;

try {
  const encryptionModule =
    await import('../utils/encryption.js');

  encryptUtil =
    encryptionModule.default ??
    encryptionModule;
} catch (error) {
  logger?.warn?.(
    'FraudLog: encryption utility unavailable.'
  );
}

try {
  const loggerModule =
    await import('../utils/logger.js');

  logger =
    loggerModule.default ??
    loggerModule;
} catch {
  logger = console;
}

// =============================================================================
// Constants
// =============================================================================

const DECISIONS = Object.freeze([
  'ALLOW',
  'STEP_UP',
  'BLOCK',
]);

const TRANSACTION_TYPES = Object.freeze([
  'deposit',
  'withdrawal',
  'transfer',
  'payment',
  'loan',
  'repayment',
]);

const ENGINE_TYPES = Object.freeze([
  'rules',
  'ml',
  'hybrid',
]);

const REVIEW_STATUSES = Object.freeze([
  'NOT_REVIEWED',
  'UNDER_REVIEW',
  'REVIEWED',
]);

const REVIEW_OUTCOMES = Object.freeze([
  'CONFIRMED',
  'FALSE_POSITIVE',
  'ESCALATED',
  'NO_ACTION',
]);

const MAX_ENGINE_LENGTH = 50;
const MAX_MODEL_VERSION_LENGTH = 100;
const MAX_RULESET_VERSION_LENGTH = 100;
const MAX_IP_LENGTH = 128;
const MAX_DEVICE_ID_LENGTH = 256;
const MAX_USER_AGENT_LENGTH = 1000;
const MAX_COUNTRY_LENGTH = 3;
const MAX_REGION_LENGTH = 150;
const MAX_CITY_LENGTH = 150;
const MAX_REVIEW_NOTES_LENGTH = 2000;
const MAX_STR_REPORT_ID_LENGTH = 256;
const MAX_TRANSACTION_SNAPSHOT_BYTES = 256 * 1024;
const MAX_EXPLAIN_BYTES = 64 * 1024;
const MAX_EXPLAIN_KEYS = 50;

// =============================================================================
// Helpers
// =============================================================================

function normalizeRequiredString(
  value,
  fieldName,
  maxLength
) {
  if (typeof value !== 'string') {
    throw new TypeError(
      `${fieldName} must be a string.`
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new Error(
      `${fieldName} is required.`
    );
  }

  if (normalized.length > maxLength) {
    throw new RangeError(
      `${fieldName} exceeds the maximum length of ${maxLength}.`
    );
  }

  return normalized;
}

function normalizeOptionalString(
  value,
  fieldName,
  maxLength
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  return normalizeRequiredString(
    value,
    fieldName,
    maxLength
  );
}

function estimateBytes(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return 0;
  }

  try {
    return Buffer.byteLength(
      JSON.stringify(value),
      'utf8'
    );
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function isFiniteFraudScore(value) {
  return (
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function isSafeExplainObject(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return true;
  }

  if (
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return false;
  }

  if (
    Object.keys(value).length >
    MAX_EXPLAIN_KEYS
  ) {
    return false;
  }

  return (
    estimateBytes(value) <=
    MAX_EXPLAIN_BYTES
  );
}

// =============================================================================
// Transaction snapshot
// =============================================================================
//
// The exact shape of a Transaction can evolve, so this remains Mixed.
// The service creating the FraudLog is responsible for REDACTING sensitive
// values before persistence.
//
// Do not store:
//   - authentication secrets
//   - PINs
//   - passwords
//   - access/refresh tokens
//   - full payment credentials
//   - unnecessary KYC document contents
//
// Encryption is required when the configured encryption utility is expected
// to protect this field.
//
// =============================================================================

const transactionSnapshotSchema = new Schema(
  {
    transactionId: {
      type: Schema.Types.ObjectId,
      ref: 'Transaction',
      required: false,
    },

    transactionType: {
      type: String,
      enum: TRANSACTION_TYPES,
      required: false,
      lowercase: true,
      trim: true,
    },

    /**
     * Sanitized evaluation snapshot.
     */
    data: {
      type: Schema.Types.Mixed,
      required: true,
    },

    encrypted: {
      type: Boolean,
      required: true,
      default: false,
    },
  },
  {
    _id: false,
    id: false,
    strict: true,
    minimize: false,
  }
);

// =============================================================================
// Device metadata
// =============================================================================

const deviceSchema = new Schema(
  {
    ip: {
      type: String,
      trim: true,
      maxlength: MAX_IP_LENGTH,
    },

    deviceId: {
      type: String,
      trim: true,
      maxlength: MAX_DEVICE_ID_LENGTH,
    },

    userAgent: {
      type: String,
      trim: true,
      maxlength: MAX_USER_AGENT_LENGTH,
    },
  },
  {
    _id: false,
    id: false,
    strict: true,
    minimize: false,
  }
);

// =============================================================================
// Geo metadata
// =============================================================================

const geoSchema = new Schema(
  {
    country: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: MAX_COUNTRY_LENGTH,
      match: /^[A-Z]{2,3}$/,
    },

    region: {
      type: String,
      trim: true,
      maxlength: MAX_REGION_LENGTH,
    },

    city: {
      type: String,
      trim: true,
      maxlength: MAX_CITY_LENGTH,
    },

    /**
     * Do not expose precise geo coordinates through generic API serialization.
     */
    lat: {
      type: Number,
      min: -90,
      max: 90,
      select: false,
    },

    lon: {
      type: Number,
      min: -180,
      max: 180,
      select: false,
    },
  },
  {
    _id: false,
    id: false,
    strict: true,
    minimize: false,
  }
);

// =============================================================================
// Review metadata
// =============================================================================

const reviewSchema = new Schema(
  {
    status: {
      type: String,
      enum: REVIEW_STATUSES,
      required: true,
      default: 'NOT_REVIEWED',
      uppercase: true,
      trim: true,
    },

    outcome: {
      type: String,
      enum: [
        ...REVIEW_OUTCOMES,
        null,
      ],
      default: null,
      uppercase: true,
      trim: true,
    },

    reviewerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    reviewedAt: {
      type: Date,
      default: null,
    },

    notes: {
      type: String,
      default: null,
      trim: true,
      maxlength: MAX_REVIEW_NOTES_LENGTH,
    },
  },
  {
    _id: false,
    id: false,
    strict: true,
    minimize: false,
  }
);

// =============================================================================
// Schema
// =============================================================================

const fraudLogSchema = new Schema(
  {
    // -------------------------------------------------------------------------
    // Tenant
    // -------------------------------------------------------------------------

    tenantId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
      immutable: true,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Subject
    // -------------------------------------------------------------------------

    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
      index: true,
    },

    transactionId: {
      type: Schema.Types.ObjectId,
      ref: 'Transaction',
      required: true,
      immutable: true,
      index: true,
    },

    transactionType: {
      type: String,
      enum: TRANSACTION_TYPES,
      required: true,
      lowercase: true,
      trim: true,
      immutable: true,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Immutable fraud evaluation evidence
    // -------------------------------------------------------------------------

    transactionSnapshot: {
      type: transactionSnapshotSchema,
      required: true,
      immutable: true,
    },

    /**
     * Normalized fraud score:
     *     0.0 = lowest risk
     *     1.0 = highest risk
     */
    fraudScore: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      immutable: true,
      validate: {
        validator: isFiniteFraudScore,
        message:
          'fraudScore must be a finite number between 0 and 1.',
      },
    },

    decision: {
      type: String,
      enum: DECISIONS,
      required: true,
      uppercase: true,
      trim: true,
      immutable: true,
      index: true,
    },

    engine: {
      type: String,
      enum: ENGINE_TYPES,
      required: true,
      default: 'hybrid',
      lowercase: true,
      trim: true,
      immutable: true,
    },

    /**
     * Version of the scoring/model implementation.
     */
    modelVersion: {
      type: String,
      trim: true,
      maxlength: MAX_MODEL_VERSION_LENGTH,
      default: null,
      immutable: true,
    },

    /**
     * Version of rule/policy configuration, useful when rules are involved.
     */
    rulesetVersion: {
      type: String,
      trim: true,
      maxlength: MAX_RULESET_VERSION_LENGTH,
      default: null,
      immutable: true,
    },

    /**
     * Small explainability record.
     *
     * Example:
     *   {
     *     velocityScore: 0.31,
     *     newDevice: true,
     *     geoMismatch: true
     *   }
     */
    explain: {
      type: Schema.Types.Mixed,
      default: null,
      immutable: true,
      validate: {
        validator: isSafeExplainObject,
        message:
          'explain must be a bounded JSON object.',
      },
    },

    // -------------------------------------------------------------------------
    // Device / geo
    // -------------------------------------------------------------------------

    device: {
      type: deviceSchema,
      default: undefined,
      immutable: true,
    },

    geo: {
      type: geoSchema,
      default: undefined,
      immutable: true,
    },

    // -------------------------------------------------------------------------
    // Review workflow
    // -------------------------------------------------------------------------

    review: {
      type: reviewSchema,
      required: true,
      default: () => ({
        status: 'NOT_REVIEWED',
      }),
    },

    // -------------------------------------------------------------------------
    // Compliance linkage
    // -------------------------------------------------------------------------

    strReportId: {
      type: String,
      default: null,
      trim: true,
      maxlength: MAX_STR_REPORT_ID_LENGTH,
      immutable: true,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Archival
    // -------------------------------------------------------------------------

    archived: {
      type: Boolean,
      required: true,
      default: false,
      index: true,
    },

    archivedAt: {
      type: Date,
      default: null,
    },

    // -------------------------------------------------------------------------
    // Correlation / request tracing
    // -------------------------------------------------------------------------

    correlationId: {
      type: String,
      trim: true,
      maxlength: 128,
      default: null,
      immutable: true,
      index: true,
    },

    requestId: {
      type: String,
      trim: true,
      maxlength: 128,
      default: null,
      immutable: true,
      index: true,
    },
  },
  {
    timestamps: true,

    /**
     * Retain versioning because review/archive fields may legitimately change.
     */
    versionKey: '__v',

    strict: true,
    strictQuery: true,
    minimize: false,

    collection: 'fraud_logs',

    toJSON: {
      transform(doc, ret) {
        ret.id = ret._id?.toString();

        delete ret._id;
        delete ret.__v;

        /**
         * Sensitive evaluation evidence is not exposed through generic JSON.
         */
        delete ret.transactionSnapshot;

        /**
         * Precise geo coordinates remain protected.
         */
        if (ret.geo) {
          delete ret.geo.lat;
          delete ret.geo.lon;
        }

        return ret;
      },
    },
  }
);

// =============================================================================
// Indexes
// =============================================================================

fraudLogSchema.index(
  {
    tenantId: 1,
    userId: 1,
    decision: 1,
    createdAt: -1,
  },
  {
    name: 'idx_fraud_tenant_user_decision_created',
  }
);

fraudLogSchema.index(
  {
    tenantId: 1,
    transactionId: 1,
    createdAt: -1,
  },
  {
    name: 'idx_fraud_tenant_transaction_created',
  }
);

fraudLogSchema.index(
  {
    tenantId: 1,
    decision: 1,
    fraudScore: -1,
    createdAt: -1,
  },
  {
    name: 'idx_fraud_tenant_decision_score_created',
  }
);

fraudLogSchema.index(
  {
    tenantId: 1,
    'review.status': 1,
    createdAt: -1,
  },
  {
    name: 'idx_fraud_tenant_review_status_created',
  }
);

fraudLogSchema.index(
  {
    tenantId: 1,
    'review.reviewerId': 1,
    createdAt: -1,
  },
  {
    sparse: true,
    name: 'idx_fraud_tenant_reviewer_created',
  }
);

fraudLogSchema.index(
  {
    tenantId: 1,
    strReportId: 1,
  },
  {
    sparse: true,
    name: 'idx_fraud_tenant_str_report',
  }
);

fraudLogSchema.index(
  {
    tenantId: 1,
    archived: 1,
    createdAt: -1,
  },
  {
    name: 'idx_fraud_tenant_archived_created',
  }
);

fraudLogSchema.index(
  {
    tenantId: 1,
    correlationId: 1,
    createdAt: -1,
  },
  {
    sparse: true,
    name: 'idx_fraud_tenant_correlation_created',
  }
);

// =============================================================================
// Validation
// =============================================================================

fraudLogSchema.pre(
  'validate',
  function validateFraudLog(next) {
    try {
      if (!this.tenantId?.trim()) {
        throw new Error(
          'tenantId is required.'
        );
      }

      if (!this.userId) {
        throw new Error(
          'userId is required.'
        );
      }

      if (!this.transactionId) {
        throw new Error(
          'transactionId is required.'
        );
      }

      if (
        !TRANSACTION_TYPES.includes(
          this.transactionType
        )
      ) {
        throw new Error(
          `Unsupported transactionType: ${this.transactionType}`
        );
      }

      if (
        !isFiniteFraudScore(
          this.fraudScore
        )
      ) {
        throw new Error(
          'fraudScore must be between 0 and 1.'
        );
      }

      if (
        !DECISIONS.includes(
          this.decision
        )
      ) {
        throw new Error(
          `Unsupported fraud decision: ${this.decision}`
        );
      }

      if (
        !ENGINE_TYPES.includes(
          this.engine
        )
      ) {
        throw new Error(
          `Unsupported fraud engine: ${this.engine}`
        );
      }

      if (
        !isSafeExplainObject(
          this.explain
        )
      ) {
        throw new Error(
          'Fraud explainability data is invalid or exceeds configured limits.'
        );
      }

      // -----------------------------------------------------------------------
      // Review consistency
      // -----------------------------------------------------------------------

      if (
        this.review.status ===
          'NOT_REVIEWED'
      ) {
        if (
          this.review.reviewerId ||
          this.review.reviewedAt ||
          this.review.outcome
        ) {
          throw new Error(
            'NOT_REVIEWED records cannot contain reviewer/outcome data.'
          );
        }
      }

      if (
        this.review.status ===
        'UNDER_REVIEW'
      ) {
        if (
          !this.review.reviewerId
        ) {
          throw new Error(
            'UNDER_REVIEW records require reviewerId.'
          );
        }

        if (
          this.review.reviewedAt ||
          this.review.outcome
        ) {
          throw new Error(
            'UNDER_REVIEW records cannot have a completed review outcome.'
          );
        }
      }

      if (
        this.review.status ===
        'REVIEWED'
      ) {
        if (
          !this.review.reviewerId ||
          !this.review.reviewedAt
        ) {
          throw new Error(
            'REVIEWED records require reviewerId and reviewedAt.'
          );
        }

        if (
          !this.review.outcome
        ) {
          throw new Error(
            'REVIEWED records require an outcome.'
          );
        }
      }

      // -----------------------------------------------------------------------
      // Archive consistency
      // -----------------------------------------------------------------------

      if (
        this.archived &&
        !this.archivedAt
      ) {
        this.archivedAt =
          new Date();
      }

      if (
        !this.archived &&
        this.archivedAt
      ) {
        throw new Error(
          'archivedAt cannot exist while archived=false.'
        );
      }

      return next();
    } catch (error) {
      return next(error);
    }
  }
);

// =============================================================================
// Encryption / snapshot protection
// =============================================================================

fraudLogSchema.pre(
  'save',
  async function protectSnapshot() {
    if (
      !this.isModified(
        'transactionSnapshot'
      )
    ) {
      return;
    }

    const snapshot =
      this.transactionSnapshot;

    if (!snapshot) {
      throw new Error(
        'transactionSnapshot is required.'
      );
    }

    if (
      estimateBytes(snapshot.data) >
      MAX_TRANSACTION_SNAPSHOT_BYTES
    ) {
      throw new RangeError(
        'transactionSnapshot exceeds the maximum permitted size.'
      );
    }

    /**
     * SECURITY REQUIREMENT:
     *
     * If encryption is configured/required but fails, do NOT save plaintext.
     */
    if (
      !encryptUtil ||
      typeof encryptUtil.encryptSensitive !==
        'function'
    ) {
      throw new Error(
        'FraudLog transaction snapshot encryption is unavailable; refusing to persist sensitive data.'
      );
    }

    const encrypted =
      await encryptUtil.encryptSensitive(
        snapshot.data
      );

    if (
      encrypted === null ||
      encrypted === undefined
    ) {
      throw new Error(
        'FraudLog snapshot encryption returned no data.'
      );
    }

    this.transactionSnapshot.data =
      encrypted;

    this.transactionSnapshot.encrypted =
      true;
  }
);

// =============================================================================
// Append-only protection for original decision evidence
// =============================================================================
//
// Review/archive fields may change through controlled services.
// The original fraud decision, score, engine, versions, transaction reference,
// snapshot, and contextual evidence should never be edited after creation.
//
// =============================================================================

const immutableFraudEvidenceError =
  () => {
    const error =
      new Error(
        'Fraud evaluation evidence is immutable.'
      );

    error.code =
      'FRAUD_LOG_EVIDENCE_IMMUTABLE';

    error.statusCode =
      409;

    return error;
  };

const IMMUTABLE_EVIDENCE_PATHS =
  new Set([
    'tenantId',
    'userId',
    'transactionId',
    'transactionType',
    'transactionSnapshot',
    'fraudScore',
    'decision',
    'engine',
    'modelVersion',
    'rulesetVersion',
    'explain',
    'device',
    'geo',
    'strReportId',
    'correlationId',
    'requestId',
    'createdAt',
  ]);

function inspectUpdateForImmutableEvidence(
  update
) {
  if (!update) {
    throw immutableFraudEvidenceError();
  }

  const operatorDocuments = Object.entries(
    update
  ).filter(([key]) =>
    key.startsWith('$')
  );

  for (
    const [, operatorDocument]
    of operatorDocuments
  ) {
    if (
      !operatorDocument ||
      typeof operatorDocument !==
        'object'
    ) {
      continue;
    }

    for (
      const path of Object.keys(
        operatorDocument
      )
    ) {
      const rootPath =
        path.split('.')[0];

      if (
        IMMUTABLE_EVIDENCE_PATHS.has(
          rootPath
        )
      ) {
        throw immutableFraudEvidenceError();
      }
    }
  }

  for (
    const key of Object.keys(update)
  ) {
    if (key.startsWith('$')) {
      continue;
    }

    const rootPath =
      key.split('.')[0];

    if (
      IMMUTABLE_EVIDENCE_PATHS.has(
        rootPath
      )
    ) {
      throw immutableFraudEvidenceError();
    }
  }
}

fraudLogSchema.pre(
  'updateOne',
  function rejectUnsafeUpdate() {
    inspectUpdateForImmutableEvidence(
      this.getUpdate()
    );
  }
);

fraudLogSchema.pre(
  'updateMany',
  function rejectUnsafeUpdate() {
    inspectUpdateForImmutableEvidence(
      this.getUpdate()
    );
  }
);

fraudLogSchema.pre(
  'findOneAndUpdate',
  function rejectUnsafeUpdate() {
    inspectUpdateForImmutableEvidence(
      this.getUpdate()
    );
  }
);

fraudLogSchema.pre(
  'replaceOne',
  function rejectReplacement() {
    throw immutableFraudEvidenceError();
  }
);

fraudLogSchema.pre(
  'findOneAndReplace',
  function rejectReplacement() {
    throw immutableFraudEvidenceError();
  }
);

fraudLogSchema.pre(
  'deleteOne',
  function rejectDelete() {
    throw immutableFraudEvidenceError();
  }
);

fraudLogSchema.pre(
  'deleteMany',
  function rejectDelete() {
    throw immutableFraudEvidenceError();
  }
);

fraudLogSchema.pre(
  'findOneAndDelete',
  function rejectDelete() {
    throw immutableFraudEvidenceError();
  }
);

fraudLogSchema.pre(
  'findOneAndRemove',
  function rejectRemove() {
    throw immutableFraudEvidenceError();
  }
);

// =============================================================================
// Static creation helper
// =============================================================================

fraudLogSchema.statics.createLog =
  async function (
    {
      tenantId,
      userId,
      transactionId,
      transactionType,

      transactionSnapshot,

      fraudScore,
      decision,

      engine = 'hybrid',
      modelVersion = null,
      rulesetVersion = null,

      explain = null,

      device = null,
      geo = null,

      strReportId = null,

      correlationId = null,
      requestId = null,

      session = null,
    } = {}
  ) {
    if (
      !tenantId ||
      !userId ||
      !transactionId ||
      !transactionType ||
      !transactionSnapshot ||
      fraudScore === undefined ||
      fraudScore === null ||
      !decision
    ) {
      throw new Error(
        'tenantId, userId, transactionId, transactionType, transactionSnapshot, fraudScore and decision are required.'
      );
    }

    if (
      !TRANSACTION_TYPES.includes(
        transactionType
      )
    ) {
      throw new Error(
        `Unsupported transactionType: ${transactionType}`
      );
    }

    if (
      !DECISIONS.includes(
        decision
      )
    ) {
      throw new Error(
        `Unsupported decision: ${decision}`
      );
    }

    if (
      !ENGINE_TYPES.includes(
        engine
      )
    ) {
      throw new Error(
        `Unsupported fraud engine: ${engine}`
      );
    }

    if (
      !isFiniteFraudScore(
        fraudScore
      )
    ) {
      throw new Error(
        'fraudScore must be between 0 and 1.'
      );
    }

    const document =
      new this({
        tenantId:
          normalizeRequiredString(
            tenantId,
            'tenantId',
            128
          ),

        userId,
        transactionId,

        transactionType:
          transactionType.toLowerCase(),

        transactionSnapshot: {
          transactionId,
          transactionType:
            transactionType.toLowerCase(),
          data:
            transactionSnapshot,
          encrypted: false,
        },

        fraudScore,

        decision:
          decision.toUpperCase(),

        engine:
          engine.toLowerCase(),

        modelVersion:
          normalizeOptionalString(
            modelVersion,
            'modelVersion',
            MAX_MODEL_VERSION_LENGTH
          ),

        rulesetVersion:
          normalizeOptionalString(
            rulesetVersion,
            'rulesetVersion',
            MAX_RULESET_VERSION_LENGTH
          ),

        explain,

        device,
        geo,

        strReportId:
          normalizeOptionalString(
            strReportId,
            'strReportId',
            MAX_STR_REPORT_ID_LENGTH
          ),

        correlationId:
          normalizeOptionalString(
            correlationId,
            'correlationId',
            128
          ),

        requestId:
          normalizeOptionalString(
            requestId,
            'requestId',
            128
          ),
      });

    await document.save(
      session
        ? { session }
        : undefined
    );

    return document;
  };

// =============================================================================
// Review workflow
// =============================================================================

fraudLogSchema.methods.beginReview =
  async function (
    reviewerId
  ) {
    if (!reviewerId) {
      throw new Error(
        'reviewerId is required.'
      );
    }

    if (
      this.review.status ===
      'REVIEWED'
    ) {
      throw new Error(
        'A completed fraud review cannot be restarted.'
      );
    }

    this.review.status =
      'UNDER_REVIEW';

    this.review.reviewerId =
      reviewerId;

    this.review.reviewedAt =
      null;

    this.review.outcome =
      null;

    return this.save();
  };

fraudLogSchema.methods.markReviewed =
  async function (
    {
      reviewerId,
      outcome,
      notes = null,
    } = {}
  ) {
    if (!reviewerId) {
      throw new Error(
        'reviewerId is required.'
      );
    }

    if (
      !REVIEW_OUTCOMES.includes(
        outcome
      )
    ) {
      throw new Error(
        `Unsupported review outcome: ${outcome}`
      );
    }

    this.review.status =
      'REVIEWED';

    this.review.reviewerId =
      reviewerId;

    this.review.reviewedAt =
      new Date();

    this.review.outcome =
      outcome;

    this.review.notes =
      notes
        ? String(notes).trim()
        : null;

    return this.save();
  };

// =============================================================================
// Read helpers
// =============================================================================

fraudLogSchema.methods.isHighRisk =
  function () {
    return (
      this.fraudScore >=
      0.8
    );
  };

fraudLogSchema.methods.requiresHumanReview =
  function () {
    return (
      this.decision === 'BLOCK' ||
      this.decision === 'STEP_UP' ||
      this.fraudScore >= 0.8
    );
  };

fraudLogSchema.methods.getDecisionSummary =
  function () {
    return {
      id:
        this._id.toString(),

      tenantId:
        this.tenantId,

      userId:
        this.userId,

      transactionId:
        this.transactionId,

      transactionType:
        this.transactionType,

      fraudScore:
        this.fraudScore,

      decision:
        this.decision,

      engine:
        this.engine,

      modelVersion:
        this.modelVersion,

      rulesetVersion:
        this.rulesetVersion,

      reviewStatus:
        this.review.status,

      archived:
        this.archived,

      createdAt:
        this.createdAt,
    };
  };

// =============================================================================
// Model
// =============================================================================

const FraudLog =
  mongoose.models.FraudLog ||
  mongoose.model(
    'FraudLog',
    fraudLogSchema
  );

export default FraudLog;

export {
  DECISIONS,
  TRANSACTION_TYPES,
  ENGINE_TYPES,
  REVIEW_STATUSES,
  REVIEW_OUTCOMES,
};