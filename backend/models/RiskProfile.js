"use strict";

/**
 * =============================================================================
 * TITech Community Capital
 * Enterprise Risk Profile Model
 * =============================================================================
 *
 * File:
 *   backend/models/RiskProfile.js
 *
 * Purpose:
 *   Stores the current risk/credit profile of a TITech Community Capital user
 *   within a tenant.
 *
 * Architectural role:
 *
 *   User
 *      │
 *      ├── Financial History
 *      ├── Savings Behaviour
 *      ├── Loan Behaviour
 *      ├── Repayment History
 *      ├── Transaction Behaviour
 *      └── Risk Signals
 *              │
 *              ▼
 *        Risk Assessment Engine
 *              │
 *              ▼
 *          RiskProfile
 *              │
 *              ├── LOW
 *              ├── MEDIUM
 *              └── HIGH
 *
 * =============================================================================
 * IMPORTANT FINANCIAL SAFETY PRINCIPLES
 * =============================================================================
 *
 * This model:
 *
 *   - stores risk assessment results;
 *   - does NOT independently approve loans;
 *   - does NOT independently disburse funds;
 *   - does NOT perform financial ledger mutations;
 *   - does NOT trust client-provided risk levels;
 *   - derives riskLevel from the normalized creditScore;
 *   - preserves assessment provenance;
 *   - supports tenant isolation;
 *   - supports optimistic concurrency through version metadata.
 *
 * Loan underwriting/approval services remain responsible for final credit
 * decisions.
 *
 * =============================================================================
 */

const mongoose = require("mongoose");

const {
  Schema,
} = mongoose;


/**
 * =============================================================================
 * MODEL CONSTANTS
 * =============================================================================
 */

const MODEL_NAME = "RiskProfile";

const USER_MODEL_NAME = "User";

const TENANT_MODEL_NAME = "Tenant";

const MIN_CREDIT_SCORE = 0;

const MAX_CREDIT_SCORE = 1000;

const DEFAULT_CREDIT_SCORE = 0;

const DEFAULT_RISK_LEVEL = "MEDIUM";

const RISK_LEVELS = Object.freeze([
  "LOW",
  "MEDIUM",
  "HIGH",
]);

const RISK_LEVEL = Object.freeze({
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
});


/**
 * =============================================================================
 * SCORE THRESHOLDS
 * =============================================================================
 *
 * 0   - 399  => HIGH
 * 400 - 650  => MEDIUM
 * 651 - 1000 => LOW
 *
 * NOTE:
 *
 * These thresholds are deliberately centralized in one place so the same
 * classification logic can be reused by the model, services, tests, and
 * reporting layers.
 * =============================================================================
 */

const RISK_THRESHOLDS = Object.freeze({
  HIGH_MAX: 399,
  MEDIUM_MAX: 650,
});


/**
 * =============================================================================
 * ENUMS
 * =============================================================================
 */

const ASSESSMENT_STATUS = Object.freeze({
  PENDING: "PENDING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
  EXPIRED: "EXPIRED",
});


const ASSESSMENT_METHOD = Object.freeze({
  AUTOMATED: "AUTOMATED",
  MANUAL: "MANUAL",
  HYBRID: "HYBRID",
});


/**
 * =============================================================================
 * NORMALIZATION HELPERS
 * =============================================================================
 */

function normalizeScore(score) {
  const numericScore = Number(score);

  if (!Number.isFinite(numericScore)) {
    return DEFAULT_CREDIT_SCORE;
  }

  return Math.max(
    MIN_CREDIT_SCORE,
    Math.min(
      MAX_CREDIT_SCORE,
      Math.round(numericScore)
    )
  );
}


function normalizeRiskLevel(value) {
  if (!value) {
    return DEFAULT_RISK_LEVEL;
  }

  const normalized =
    String(value)
      .trim()
      .toUpperCase();

  return RISK_LEVELS.includes(
    normalized
  )
    ? normalized
    : DEFAULT_RISK_LEVEL;
}


/**
 * =============================================================================
 * RISK CLASSIFICATION
 * =============================================================================
 *
 * Pure deterministic function.
 *
 * Keeping this function independent from Mongoose makes it easy to test and
 * prevents circular model lookups from pre-save hooks.
 * =============================================================================
 */

function computeRiskLevel(score) {
  const normalizedScore =
    normalizeScore(score);

  if (
    normalizedScore <=
    RISK_THRESHOLDS.HIGH_MAX
  ) {
    return RISK_LEVEL.HIGH;
  }

  if (
    normalizedScore <=
    RISK_THRESHOLDS.MEDIUM_MAX
  ) {
    return RISK_LEVEL.MEDIUM;
  }

  return RISK_LEVEL.LOW;
}


/**
 * =============================================================================
 * SCHEMA
 * =============================================================================
 */

const RiskProfileSchema =
  new Schema(
    {
      /**
       * -----------------------------------------------------------------------
       * USER
       * -----------------------------------------------------------------------
       *
       * A MongoDB ObjectId is preferable to an arbitrary String because this
       * establishes a proper relationship with the User collection and avoids
       * inconsistent identifier representations.
       * -----------------------------------------------------------------------
       */

      userId: {
        type: Schema.Types.ObjectId,

        ref: USER_MODEL_NAME,

        required: [
          true,
          "Risk profile userId is required.",
        ],

        index: true,
      },


      /**
       * -----------------------------------------------------------------------
       * TENANT
       * -----------------------------------------------------------------------
       *
       * Every risk profile belongs to exactly one tenant.
       *
       * This is a critical multi-tenant security boundary.
       * -----------------------------------------------------------------------
       */

      tenantId: {
        type: Schema.Types.ObjectId,

        ref: TENANT_MODEL_NAME,

        required: [
          true,
          "Risk profile tenantId is required.",
        ],

        index: true,
      },


      /**
       * -----------------------------------------------------------------------
       * CREDIT SCORE
       * -----------------------------------------------------------------------
       *
       * Canonical normalized score from 0 to 1000.
       * -----------------------------------------------------------------------
       */

      creditScore: {
        type: Number,

        min: [
          MIN_CREDIT_SCORE,
          "Credit score cannot be below 0.",
        ],

        max: [
          MAX_CREDIT_SCORE,
          "Credit score cannot exceed 1000.",
        ],

        default:
          DEFAULT_CREDIT_SCORE,

        required: true,

        index: true,
      },


      /**
       * -----------------------------------------------------------------------
       * RISK LEVEL
       * -----------------------------------------------------------------------
       *
       * This is derived from creditScore and should not be treated as
       * authoritative client input.
       * -----------------------------------------------------------------------
       */

      riskLevel: {
        type: String,

        enum: {
          values: RISK_LEVELS,

          message:
            "Invalid risk level.",
        },

        default:
          DEFAULT_RISK_LEVEL,

        required: true,

        index: true,
      },


      /**
       * -----------------------------------------------------------------------
       * ASSESSMENT STATUS
       * -----------------------------------------------------------------------
       */

      assessmentStatus: {
        type: String,

        enum: {
          values:
            Object.values(
              ASSESSMENT_STATUS
            ),

          message:
            "Invalid risk assessment status.",
        },

        default:
          ASSESSMENT_STATUS.COMPLETED,

        required: true,

        index: true,
      },


      /**
       * -----------------------------------------------------------------------
       * ASSESSMENT METHOD
       * -----------------------------------------------------------------------
       */

      assessmentMethod: {
        type: String,

        enum: {
          values:
            Object.values(
              ASSESSMENT_METHOD
            ),

          message:
            "Invalid risk assessment method.",
        },

        default:
          ASSESSMENT_METHOD.AUTOMATED,

        required: true,
      },


      /**
       * -----------------------------------------------------------------------
       * ASSESSMENT ENGINE
       * -----------------------------------------------------------------------
       *
       * Identifies the engine/version that produced the assessment.
       *
       * Example:
       *
       *   TITech-RiskEngine-v2
       * -----------------------------------------------------------------------
       */

      assessmentEngine: {
        type: String,

        trim: true,

        maxlength: 100,

        default:
          "TITech-RiskEngine",
      },


      /**
       * -----------------------------------------------------------------------
       * ASSESSMENT VERSION
       * -----------------------------------------------------------------------
       *
       * Critical for reproducibility.
       *
       * A risk score generated under one scoring model should remain
       * distinguishable from scores generated under a later model.
       * -----------------------------------------------------------------------
       */

      assessmentVersion: {
        type: String,

        trim: true,

        maxlength: 50,

        default: "1.0",
      },


      /**
       * -----------------------------------------------------------------------
       * SCORE CALCULATION DATE
       * -----------------------------------------------------------------------
       */

      assessedAt: {
        type: Date,

        default: Date.now,

        index: true,
      },


      /**
       * -----------------------------------------------------------------------
       * NEXT ASSESSMENT DATE
       * -----------------------------------------------------------------------
       */

      nextAssessmentAt: {
        type: Date,

        default: null,

        index: true,
      },


      /**
       * -----------------------------------------------------------------------
       * ASSESSMENT EXPIRATION
       * -----------------------------------------------------------------------
       */

      expiresAt: {
        type: Date,

        default: null,

        index: true,
      },


      /**
       * -----------------------------------------------------------------------
       * MANUAL REVIEW
       * -----------------------------------------------------------------------
       */

      reviewRequired: {
        type: Boolean,

        default: false,

        index: true,
      },


      reviewReason: {
        type: String,

        trim: true,

        maxlength: 500,

        default: null,
      },


      reviewedAt: {
        type: Date,

        default: null,
      },


      reviewedBy: {
        type: Schema.Types.ObjectId,

        ref: USER_MODEL_NAME,

        default: null,
      },


      /**
       * -----------------------------------------------------------------------
       * ASSESSMENT SOURCE
       * -----------------------------------------------------------------------
       *
       * Describes where the assessment originated.
       *
       * This should never contain secrets or raw sensitive financial payloads.
       * -----------------------------------------------------------------------
       */

      assessmentSource: {
        type: String,

        trim: true,

        maxlength: 100,

        default: "TITech",
      },


      /**
       * -----------------------------------------------------------------------
       * RISK FACTORS
       * -----------------------------------------------------------------------
       *
       * Structured non-secret signals used to explain an assessment.
       *
       * Example:
       *
       * {
       *   factor: "REPAYMENT_HISTORY",
       *   impact: "NEGATIVE",
       *   weight: 20
       * }
       *
       * Do not store raw KYC documents, passwords, tokens, or unnecessary
       * personally identifiable information here.
       * -----------------------------------------------------------------------
       */

      riskFactors: {
        type: [
          {
            factor: {
              type: String,

              trim: true,

              uppercase: true,

              maxlength: 100,

              required: true,
            },

            impact: {
              type: String,

              enum: [
                "POSITIVE",
                "NEUTRAL",
                "NEGATIVE",
              ],

              required: true,
            },

            weight: {
              type: Number,

              min: -1000,

              max: 1000,

              default: 0,
            },
          },
        ],

        default: [],
      },


      /**
       * -----------------------------------------------------------------------
       * RISK ENGINE TRACE
       * -----------------------------------------------------------------------
       *
       * A non-secret correlation identifier used to connect the profile to an
       * assessment execution/audit event.
       * -----------------------------------------------------------------------
       */

      assessmentReference: {
        type: String,

        trim: true,

        maxlength: 150,

        index: true,

        default: null,
      },


      /**
       * -----------------------------------------------------------------------
       * PREVIOUS SCORE
       * -----------------------------------------------------------------------
       */

      previousCreditScore: {
        type: Number,

        min: MIN_CREDIT_SCORE,

        max: MAX_CREDIT_SCORE,

        default: null,
      },


      /**
       * -----------------------------------------------------------------------
       * PREVIOUS RISK LEVEL
       * -----------------------------------------------------------------------
       */

      previousRiskLevel: {
        type: String,

        enum: [
          ...RISK_LEVELS,
          null,
        ],

        default: null,
      },


      /**
       * -----------------------------------------------------------------------
       * RISK LEVEL CHANGED
       * -----------------------------------------------------------------------
       */

      riskLevelChangedAt: {
        type: Date,

        default: null,
      },


      /**
       * -----------------------------------------------------------------------
       * VERSION
       * -----------------------------------------------------------------------
       *
       * Application-level version useful for optimistic concurrency.
       * -----------------------------------------------------------------------
       */

      profileVersion: {
        type: Number,

        min: 1,

        default: 1,
      },


      /**
       * -----------------------------------------------------------------------
       * CREATED BY
       * -----------------------------------------------------------------------
       */

      createdBy: {
        type: Schema.Types.ObjectId,

        ref: USER_MODEL_NAME,

        default: null,
      },


      /**
       * -----------------------------------------------------------------------
       * UPDATED BY
       * -----------------------------------------------------------------------
       */

      updatedBy: {
        type: Schema.Types.ObjectId,

        ref: USER_MODEL_NAME,

        default: null,
      },


      /**
       * -----------------------------------------------------------------------
       * SOFT DELETION
       * -----------------------------------------------------------------------
       *
       * Risk profiles should generally not be physically deleted because
       * historical assessments may be required for audit, compliance, or
       * underwriting reconstruction.
       * -----------------------------------------------------------------------
       */

      deletedAt: {
        type: Date,

        default: null,

        index: true,
      },


      deletedBy: {
        type: Schema.Types.ObjectId,

        ref: USER_MODEL_NAME,

        default: null,
      },
    },

    {
      timestamps: true,

      strict: true,

      strictQuery: true,

      minimize: true,

      collection: "risk_profiles",

      versionKey: "__v",

      optimisticConcurrency: false,
    }
  );


/**
 * =============================================================================
 * INDEXES
 * =============================================================================
 *
 * One current risk profile per user per tenant.
 * =============================================================================
 */

RiskProfileSchema.index(
  {
    tenantId: 1,
    userId: 1,
  },
  {
    unique: true,

    partialFilterExpression: {
      deletedAt: null,
    },

    name:
      "uniq_active_risk_profile_per_tenant_user",
  }
);


/**
 * Tenant risk reporting.
 */

RiskProfileSchema.index(
  {
    tenantId: 1,
    riskLevel: 1,
    assessmentStatus: 1,
  },
  {
    name:
      "idx_tenant_risk_level_status",
  }
);


/**
 * Assessment scheduling.
 */

RiskProfileSchema.index(
  {
    tenantId: 1,
    nextAssessmentAt: 1,
    assessmentStatus: 1,
  },
  {
    name:
      "idx_risk_assessment_schedule",
  }
);


/**
 * Review queue.
 */

RiskProfileSchema.index(
  {
    tenantId: 1,
    reviewRequired: 1,
    assessedAt: 1,
  },
  {
    name:
      "idx_risk_review_queue",
  }
);


/**
 * Assessment references.
 */

RiskProfileSchema.index(
  {
    tenantId: 1,
    assessmentReference: 1,
  },
  {
    sparse: true,

    name:
      "idx_risk_assessment_reference",
  }
);


/**
 * =============================================================================
 * PRE-VALIDATE
 * =============================================================================
 *
 * Normalize and deterministically derive the risk level before validation.
 * =============================================================================
 */

RiskProfileSchema.pre(
  "validate",
  function normalizeRiskProfile(next) {
    try {
      /**
       * Normalize score.
       */
      this.creditScore =
        normalizeScore(
          this.creditScore
        );

      /**
       * Always derive risk level from the score.
       *
       * Client-provided riskLevel is therefore never authoritative.
       */
      this.riskLevel =
        computeRiskLevel(
          this.creditScore
        );

      /**
       * Normalize review state.
       */
      if (this.reviewRequired) {
        this.assessmentStatus =
          ASSESSMENT_STATUS.REVIEW_REQUIRED;
      }

      /**
       * Deleted profiles cannot remain active.
       */
      if (this.deletedAt) {
        this.assessmentStatus =
          ASSESSMENT_STATUS.EXPIRED;
      }

      next();
    } catch (error) {
      next(error);
    }
  }
);


/**
 * =============================================================================
 * PRE-SAVE LIFECYCLE
 * =============================================================================
 */

RiskProfileSchema.pre(
  "save",
  function riskProfileSaveLifecycle(next) {
    try {
      /**
       * New profile.
       */
      if (this.isNew) {
        this.profileVersion = 1;

        this.riskLevel =
          computeRiskLevel(
            this.creditScore
          );

        if (!this.assessedAt) {
          this.assessedAt =
            new Date();
        }

        return next();
      }

      /**
       * Preserve previous assessment state when the score changes.
       */
      if (
        this.isModified(
          "creditScore"
        )
      ) {
        this.previousCreditScore =
          this.get(
            "creditScore"
          ) === this.creditScore
            ? this.previousCreditScore
            : this.previousCreditScore;

        /**
         * If the document was loaded from MongoDB, this.get("riskLevel") is the
         * current in-memory value. The previous persisted value is not directly
         * available after assignment, so callers performing major assessments
         * should explicitly populate previousCreditScore/previousRiskLevel.
         */
        this.assessedAt =
          new Date();

        this.profileVersion =
          Math.max(
            1,
            Number(
              this.profileVersion ||
              1
            )
          ) + 1;
      }

      /**
       * Track permission-independent risk-level changes.
       */
      if (
        this.isModified(
          "riskLevel"
        )
      ) {
        this.riskLevelChangedAt =
          new Date();
      }

      /**
       * Ensure riskLevel can never diverge from creditScore.
       */
      this.riskLevel =
        computeRiskLevel(
          this.creditScore
        );

      next();
    } catch (error) {
      next(error);
    }
  }
);


/**
 * =============================================================================
 * QUERY HELPERS
 * =============================================================================
 */

RiskProfileSchema.query.active =
  function active() {
    return this.where({
      deletedAt: null,
    });
  };


RiskProfileSchema.query.forTenant =
  function forTenant(
    tenantId
  ) {
    return this.where({
      tenantId,
    });
  };


RiskProfileSchema.query.highRisk =
  function highRisk() {
    return this.where({
      riskLevel:
        RISK_LEVEL.HIGH,

      deletedAt: null,
    });
  };


RiskProfileSchema.query.mediumRisk =
  function mediumRisk() {
    return this.where({
      riskLevel:
        RISK_LEVEL.MEDIUM,

      deletedAt: null,
    });
  };


RiskProfileSchema.query.lowRisk =
  function lowRisk() {
    return this.where({
      riskLevel:
        RISK_LEVEL.LOW,

      deletedAt: null,
    });
  };


RiskProfileSchema.query.reviewRequired =
  function reviewRequired() {
    return this.where({
      reviewRequired: true,

      deletedAt: null,
    });
  };


RiskProfileSchema.query.current =
  function current() {
    return this.where({
      deletedAt: null,

      assessmentStatus: {
        $nin: [
          ASSESSMENT_STATUS.EXPIRED,
          ASSESSMENT_STATUS.FAILED,
        ],
      },
    });
  };


/**
 * =============================================================================
 * INSTANCE METHODS
 * =============================================================================
 */

/**
 * Recalculate risk level from the current score.
 */
RiskProfileSchema.methods.recalculateRiskLevel =
  function recalculateRiskLevel() {
    this.riskLevel =
      computeRiskLevel(
        this.creditScore
      );

    return this.riskLevel;
  };


/**
 * Determine whether the assessment has expired.
 */
RiskProfileSchema.methods.isExpired =
  function isExpired(
    now = new Date()
  ) {
    if (
      this.expiresAt &&
      this.expiresAt <= now
    ) {
      return true;
    }

    return (
      this.assessmentStatus ===
      ASSESSMENT_STATUS.EXPIRED
    );
  };


/**
 * Determine whether the profile requires reassessment.
 */
RiskProfileSchema.methods.requiresReassessment =
  function requiresReassessment(
    now = new Date()
  ) {
    if (
      this.isExpired(now)
    ) {
      return true;
    }

    if (
      this.nextAssessmentAt &&
      this.nextAssessmentAt <= now
    ) {
      return true;
    }

    return false;
  };


/**
 * Determine whether the profile is high risk.
 */
RiskProfileSchema.methods.isHighRisk =
  function isHighRisk() {
    return (
      this.riskLevel ===
      RISK_LEVEL.HIGH
    );
  };


/**
 * Determine whether manual review is required.
 */
RiskProfileSchema.methods.requiresManualReview =
  function requiresManualReview() {
    return (
      this.reviewRequired === true ||
      this.assessmentStatus ===
        ASSESSMENT_STATUS.REVIEW_REQUIRED
    );
  };


/**
 * Soft-delete profile.
 */
RiskProfileSchema.methods.softDelete =
  function softDelete(
    actorId = null
  ) {
    this.deletedAt =
      new Date();

    this.deletedBy =
      actorId || null;

    this.assessmentStatus =
      ASSESSMENT_STATUS.EXPIRED;

    this.reviewRequired =
      false;

    return this;
  };


/**
 * =============================================================================
 * STATIC METHODS
 * =============================================================================
 */

/**
 * Compute risk level without requiring a model instance.
 */
RiskProfileSchema.statics.computeRiskLevel =
  function computeRiskLevelStatic(
    score
  ) {
    return computeRiskLevel(
      score
    );
  };


/**
 * Normalize score.
 */
RiskProfileSchema.statics.normalizeScore =
  function normalizeScoreStatic(
    score
  ) {
    return normalizeScore(
      score
    );
  };


/**
 * Find the current profile for a tenant/user pair.
 */
RiskProfileSchema.statics.findCurrentForUser =
  function findCurrentForUser(
    tenantId,
    userId
  ) {
    return this.findOne({
      tenantId,

      userId,

      deletedAt: null,
    });
  };


/**
 * Find high-risk profiles within a tenant.
 */
RiskProfileSchema.statics.findHighRiskForTenant =
  function findHighRiskForTenant(
    tenantId,
    options = {}
  ) {
    const limit =
      Math.min(
        Math.max(
          Number.parseInt(
            options.limit || 100,
            10
          ),
          1
        ),
        1000
      );

    return this.find({
      tenantId,

      riskLevel:
        RISK_LEVEL.HIGH,

      deletedAt: null,
    })
      .sort({
        assessedAt: 1,
        _id: 1,
      })
      .limit(limit);
  };


/**
 * Find profiles requiring reassessment.
 */
RiskProfileSchema.statics.findDueForAssessment =
  function findDueForAssessment(
    tenantId,
    now = new Date(),
    limit = 100
  ) {
    const normalizedLimit =
      Math.min(
        Math.max(
          Number.parseInt(
            limit,
            10
          ) || 100,
          1
        ),
        1000
      );

    return this.find({
      tenantId,

      deletedAt: null,

      $or: [
        {
          nextAssessmentAt: {
            $lte: now,
          },
        },
        {
          expiresAt: {
            $lte: now,
          },
        },
      ],

      assessmentStatus: {
        $nin: [
          ASSESSMENT_STATUS.FAILED,
        ],
      },
    })
      .sort({
        nextAssessmentAt: 1,
        _id: 1,
      })
      .limit(
        normalizedLimit
      );
  };


/**
 * =============================================================================
 * JSON SERIALIZATION
 * =============================================================================
 *
 * Avoid exposing internal MongoDB metadata.
 * =============================================================================
 */

RiskProfileSchema.set(
  "toJSON",
  {
    virtuals: true,

    versionKey: false,

    transform(
      _doc,
      ret
    ) {
      if (ret._id) {
        ret.id =
          String(ret._id);
      }

      delete ret._id;

      /**
       * Internal persistence/audit metadata should normally be exposed through
       * authorized administrative endpoints rather than ordinary API payloads.
       */
      delete ret.__v;

      delete ret.deletedAt;

      delete ret.deletedBy;

      return ret;
    },
  }
);


RiskProfileSchema.set(
  "toObject",
  {
    virtuals: true,

    versionKey: false,
  }
);


/**
 * =============================================================================
 * PUBLIC MODEL CONSTANTS
 * =============================================================================
 */

RiskProfileSchema.statics.RISK_LEVEL =
  RISK_LEVEL;

RiskProfileSchema.statics.RISK_LEVELS =
  RISK_LEVELS;

RiskProfileSchema.statics.RISK_THRESHOLDS =
  RISK_THRESHOLDS;

RiskProfileSchema.statics.ASSESSMENT_STATUS =
  ASSESSMENT_STATUS;

RiskProfileSchema.statics.ASSESSMENT_METHOD =
  ASSESSMENT_METHOD;

RiskProfileSchema.statics.MIN_CREDIT_SCORE =
  MIN_CREDIT_SCORE;

RiskProfileSchema.statics.MAX_CREDIT_SCORE =
  MAX_CREDIT_SCORE;


/**
 * =============================================================================
 * MODEL REGISTRATION
 * =============================================================================
 *
 * Reuse an already registered model during nodemon/test reloads.
 * =============================================================================
 */

const RiskProfile =
  mongoose.models[MODEL_NAME] ||
  mongoose.model(
    MODEL_NAME,
    RiskProfileSchema
  );


/**
 * =============================================================================
 * PUBLIC HELPERS
 * =============================================================================
 */

RiskProfile.computeRiskLevel =
  computeRiskLevel;

RiskProfile.normalizeScore =
  normalizeScore;

RiskProfile.normalizeRiskLevel =
  normalizeRiskLevel;


/**
 * =============================================================================
 * EXPORT
 * =============================================================================
 */

module.exports = RiskProfile;