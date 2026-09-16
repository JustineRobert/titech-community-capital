// backend/models/LoanEligibility.js
// ============================================================================
// TITech Community Capital LTD
// Enterprise Loan Eligibility Assessment Model
// ============================================================================
//
// Purpose
//   Immutable, tenant-aware snapshot of a user's loan eligibility assessment.
//
// Responsibilities
//   - Record eligibility decisions and scoring components.
//   - Preserve the exact data used for the assessment.
//   - Support historical recalculation/appeals.
//   - Record administrative overrides explicitly.
//   - Track assessment validity/expiry.
//   - Prevent historical assessments from being silently rewritten.
//
// Important architectural boundary
//   This model records an eligibility ASSESSMENT.
//   It does NOT:
//     - approve/disburse a loan;
//     - calculate the final loan balance;
//     - mutate contribution balances;
//     - mutate wallet/ledger state;
//     - replace Loan or Transaction as a source of truth.
//
// A subsequent eligibility calculation should create a NEW assessment rather
// than mutating an older historical assessment.
//
// Module format
//   ESM.
//
// ============================================================================

import mongoose from 'mongoose';

const { Schema } = mongoose;

// =============================================================================
// Constants
// =============================================================================

const ELIGIBILITY_STATUSES = Object.freeze([
  'eligible',
  'ineligible',
  'expired',
  'overridden',
]);

const REJECTION_REASONS = Object.freeze([
  'insufficient_contribution',
  'insufficient_participation',
  'poor_repayment_history',
  'excessive_outstanding_loans',
  'insufficient_group_membership',
  'recent_default',
  'account_not_verified',
  'account_suspended',
  'manual_review_required',
]);

const OVERRIDE_TYPES = Object.freeze([
  'approve',
  'reject',
  'adjust_limit',
]);

const OVERRIDE_REASONS = Object.freeze([
  'administrative_review',
  'verified_exception',
  'data_correction',
  'policy_exception',
  'appeal',
  'other',
]);

const MAX_NOTES_LENGTH = 1000;
const MAX_REASON_LENGTH = 500;
const MAX_POLICY_VERSION_LENGTH = 100;
const MAX_ASSESSMENT_VERSION_LENGTH = 100;
const MAX_ENGINE_VERSION_LENGTH = 100;

const DEFAULT_EXPIRY_DAYS = 30;

const SCORE_MAXIMUM = Object.freeze({
  contribution: 40,
  participation: 30,
  repayment: 20,
  risk: 10,
});

const EXPECTED_TOTAL_SCORE =
  SCORE_MAXIMUM.contribution +
  SCORE_MAXIMUM.participation +
  SCORE_MAXIMUM.repayment +
  SCORE_MAXIMUM.risk;

// =============================================================================
// Utility helpers
// =============================================================================

function normalizePositiveInteger(value, fieldName) {
  const number = Number(value);

  if (!Number.isInteger(number) || number < 0) {
    throw new TypeError(
      `${fieldName} must be a non-negative integer.`
    );
  }

  return number;
}

function normalizeMoneyDecimal(value, fieldName = 'amount') {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return mongoose.Types.Decimal128.fromString('0.00');
  }

  if (value instanceof mongoose.Types.Decimal128) {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new TypeError(
        `${fieldName} must be a Decimal128 or a safe integer amount.`
      );
    }

    return mongoose.Types.Decimal128.fromString(String(value));
  }

  if (typeof value === 'string') {
    const normalized = value.trim();

    if (!/^\d+(\.\d+)?$/.test(normalized)) {
      throw new TypeError(
        `${fieldName} must be a non-negative decimal string.`
      );
    }

    return mongoose.Types.Decimal128.fromString(normalized);
  }

  throw new TypeError(
    `${fieldName} must be Decimal128, a decimal string, or a safe integer.`
  );
}

function normalizeLimitDate(days) {
  const numericDays = Number(days);

  if (
    !Number.isFinite(numericDays) ||
    numericDays < 0 ||
    numericDays > 3650
  ) {
    throw new RangeError(
      'expiryDays must be between 0 and 3650.'
    );
  }

  return Math.floor(numericDays);
}

function calculateExpiryDate(fromDate, expiryDays) {
  const days = normalizeLimitDate(expiryDays);

  return new Date(
    fromDate.getTime() +
      days * 24 * 60 * 60 * 1000
  );
}

// =============================================================================
// Score components
// =============================================================================

const componentsSchema = new Schema(
  {
    contributionScore: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      max: SCORE_MAXIMUM.contribution,
    },

    participationScore: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      max: SCORE_MAXIMUM.participation,
    },

    repaymentScore: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      max: SCORE_MAXIMUM.repayment,
    },

    riskScore: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      max: SCORE_MAXIMUM.risk,
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
// Raw scoring inputs
// =============================================================================

const assessmentMetadataSchema = new Schema(
  {
    monthsActive: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isFinite,
        message: 'monthsActive must be finite.',
      },
    },

    /**
     * Financial values use Decimal128 because these values are part of the
     * evidence behind a financial eligibility decision.
     */
    totalContributed: {
      type: Schema.Types.Decimal128,
      required: true,
      default: '0.00',
    },

    contributionCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'contributionCount must be an integer.',
      },
    },

    averageContribution: {
      type: Schema.Types.Decimal128,
      required: true,
      default: '0.00',
    },

    completedLoans: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'completedLoans must be an integer.',
      },
    },

    defaultedLoans: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'defaultedLoans must be an integer.',
      },
    },

    onTimeRepaymentRate: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      max: 100,
    },

    activeLoans: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'activeLoans must be an integer.',
      },
    },

    totalOutstanding: {
      type: Schema.Types.Decimal128,
      required: true,
      default: '0.00',
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
// Override information
// =============================================================================

const overrideSchema = new Schema(
  {
    type: {
      type: String,
      required: true,
      enum: OVERRIDE_TYPES,
      lowercase: true,
      trim: true,
      immutable: true,
    },

    reason: {
      type: String,
      required: true,
      enum: OVERRIDE_REASONS,
      lowercase: true,
      trim: true,
      immutable: true,
    },

    notes: {
      type: String,
      trim: true,
      maxlength: MAX_NOTES_LENGTH,
      immutable: true,
    },

    previousEligibility: {
      type: Boolean,
      required: true,
      immutable: true,
    },

    previousMaxLoanAmount: {
      type: Schema.Types.Decimal128,
      required: true,
      immutable: true,
    },

    resultingMaxLoanAmount: {
      type: Schema.Types.Decimal128,
      required: true,
      immutable: true,
    },

    overriddenBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
    },

    overriddenAt: {
      type: Date,
      required: true,
      immutable: true,
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

const loanEligibilitySchema = new Schema(
  {
    // -------------------------------------------------------------------------
    // Tenant isolation
    // -------------------------------------------------------------------------

    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      immutable: true,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Assessment identity
    // -------------------------------------------------------------------------

    assessmentId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      index: true,
      trim: true,
      minlength: 1,
      maxlength: 128,
    },

    /**
     * Sequential assessment number is optional and useful for human-readable
     * support/review workflows.
     */
    assessmentNumber: {
      type: String,
      trim: true,
      maxlength: 100,
      immutable: true,
    },

    // -------------------------------------------------------------------------
    // Subject
    // -------------------------------------------------------------------------

    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required'],
      immutable: true,
      index: true,
    },

    group: {
      type: Schema.Types.ObjectId,
      ref: 'Group',
      required: [true, 'Group is required'],
      immutable: true,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Scoring engine provenance
    // -------------------------------------------------------------------------

    assessmentVersion: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      maxlength: MAX_ASSESSMENT_VERSION_LENGTH,
      default: '1.0.0',
    },

    scoringEngineVersion: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      maxlength: MAX_ENGINE_VERSION_LENGTH,
      default: '1.0.0',
    },

    policyVersion: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      maxlength: MAX_POLICY_VERSION_LENGTH,
      default: '1.0.0',
    },

    // -------------------------------------------------------------------------
    // Overall score
    // -------------------------------------------------------------------------

    overallScore: {
      type: Number,
      required: true,
      min: 0,
      max: EXPECTED_TOTAL_SCORE,
      immutable: true,
    },

    components: {
      type: componentsSchema,
      required: true,
      immutable: true,
    },

    // -------------------------------------------------------------------------
    // Assessment evidence
    // -------------------------------------------------------------------------

    metadata: {
      type: assessmentMetadataSchema,
      required: true,
      immutable: true,
    },

    // -------------------------------------------------------------------------
    // Decision
    // -------------------------------------------------------------------------

    isEligible: {
      type: Boolean,
      required: true,
      immutable: true,
    },

    status: {
      type: String,
      required: true,
      enum: ELIGIBILITY_STATUSES,
      default: 'eligible',
      lowercase: true,
      trim: true,
      index: true,
    },

    /**
     * Maximum principal amount permitted by this assessment.
     *
     * This is an assessment result, not a loan approval or disbursement amount.
     */
    maxLoanAmount: {
      type: Schema.Types.Decimal128,
      required: true,
      default: '0.00',
      immutable: true,
    },

    currency: {
      type: String,
      required: true,
      default: 'UGX',
      uppercase: true,
      trim: true,
      match: /^[A-Z]{3}$/,
      immutable: true,
    },

    rejectionReason: {
      type: String,
      enum: [
        ...REJECTION_REASONS,
        null,
      ],
      default: null,
      immutable: true,
    },

    decisionReason: {
      type: String,
      trim: true,
      maxlength: MAX_REASON_LENGTH,
      immutable: true,
    },

    // -------------------------------------------------------------------------
    // Assessment dates
    // -------------------------------------------------------------------------

    assessedAt: {
      type: Date,
      required: true,
      default: Date.now,
      immutable: true,
      index: true,
    },

    expiresAt: {
      type: Date,
      required: true,
      immutable: true,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Administrative override
    // -------------------------------------------------------------------------

    override: {
      type: overrideSchema,
      required: false,
      immutable: true,
    },

    // -------------------------------------------------------------------------
    // Free-form review notes
    // -------------------------------------------------------------------------

    notes: {
      type: String,
      trim: true,
      maxlength: MAX_NOTES_LENGTH,
      immutable: true,
    },

    // -------------------------------------------------------------------------
    // Assessment provenance
    // -------------------------------------------------------------------------

    /**
     * Optional correlation with the workflow/request that produced the
     * assessment.
     */
    correlationId: {
      type: String,
      trim: true,
      maxlength: 128,
      immutable: true,
      index: true,
    },

    requestId: {
      type: String,
      trim: true,
      maxlength: 128,
      immutable: true,
      index: true,
    },
  },
  {
    timestamps: true,

    /**
     * Assessment records are historical snapshots. Keeping __v is unnecessary
     * because mutation is explicitly prohibited.
     */
    versionKey: false,

    strict: true,
    minimize: false,

    toJSON: {
      transform(doc, ret) {
        ret.id = doc._id.toString();

        if (ret.maxLoanAmount) {
          ret.maxLoanAmount = ret.maxLoanAmount.toString();
        }

        if (ret.metadata?.totalContributed) {
          ret.metadata.totalContributed =
            ret.metadata.totalContributed.toString();
        }

        if (ret.metadata?.averageContribution) {
          ret.metadata.averageContribution =
            ret.metadata.averageContribution.toString();
        }

        if (ret.metadata?.totalOutstanding) {
          ret.metadata.totalOutstanding =
            ret.metadata.totalOutstanding.toString();
        }

        if (ret.override?.previousMaxLoanAmount) {
          ret.override.previousMaxLoanAmount =
            ret.override.previousMaxLoanAmount.toString();
        }

        if (ret.override?.resultingMaxLoanAmount) {
          ret.override.resultingMaxLoanAmount =
            ret.override.resultingMaxLoanAmount.toString();
        }

        delete ret._id;
      },
    },
  }
);

// =============================================================================
// Indexes
// =============================================================================

loanEligibilitySchema.index(
  {
    tenantId: 1,
    user: 1,
    group: 1,
    assessedAt: -1,
  },
  {
    name: 'idx_eligibility_tenant_user_group_assessed',
  }
);

loanEligibilitySchema.index(
  {
    tenantId: 1,
    user: 1,
    group: 1,
    expiresAt: 1,
  },
  {
    name: 'idx_eligibility_tenant_active_lookup',
  }
);

loanEligibilitySchema.index(
  {
    tenantId: 1,
    status: 1,
    expiresAt: 1,
  },
  {
    name: 'idx_eligibility_tenant_status_expiry',
  }
);

loanEligibilitySchema.index(
  {
    tenantId: 1,
    group: 1,
    assessedAt: -1,
  },
  {
    name: 'idx_eligibility_tenant_group_history',
  }
);

loanEligibilitySchema.index(
  {
    tenantId: 1,
    correlationId: 1,
  },
  {
    name: 'idx_eligibility_tenant_correlation',
    sparse: true,
  }
);

// =============================================================================
// Validation
// =============================================================================

loanEligibilitySchema.pre(
  'validate',
  function validateEligibility(next) {
    try {
      // -----------------------------------------------------------------------
      // Score component integrity
      // -----------------------------------------------------------------------

      const componentTotal =
        this.components.contributionScore +
        this.components.participationScore +
        this.components.repaymentScore +
        this.components.riskScore;

      /**
       * Keep the score reproducible. The overall score must match the
       * component total instead of allowing two contradictory values.
       */
      if (Math.abs(componentTotal - this.overallScore) > 0.000001) {
        throw new Error(
          'overallScore must equal the sum of eligibility components.'
        );
      }

      // -----------------------------------------------------------------------
      // Decision integrity
      // -----------------------------------------------------------------------

      if (
        this.isEligible &&
        this.rejectionReason !== null &&
        this.rejectionReason !== undefined
      ) {
        throw new Error(
          'Eligible assessments cannot have a rejectionReason.'
        );
      }

      if (
        !this.isEligible &&
        !this.rejectionReason
      ) {
        throw new Error(
          'Ineligible assessments must specify a rejectionReason.'
        );
      }

      // -----------------------------------------------------------------------
      // Loan limit integrity
      // -----------------------------------------------------------------------

      const maxLoanAmount =
        this.maxLoanAmount?.toString() || '0';

      if (
        !/^\d+(\.\d+)?$/.test(maxLoanAmount)
      ) {
        throw new Error(
          'maxLoanAmount must be a non-negative decimal.'
        );
      }

      if (
        !this.isEligible &&
        maxLoanAmount !== '0.00' &&
        maxLoanAmount !== '0'
      ) {
        throw new Error(
          'Ineligible assessments must have maxLoanAmount equal to zero.'
        );
      }

      // -----------------------------------------------------------------------
      // Date integrity
      // -----------------------------------------------------------------------

      if (
        this.expiresAt <= this.assessedAt
      ) {
        throw new Error(
          'expiresAt must be later than assessedAt.'
        );
      }

      // -----------------------------------------------------------------------
      // Override integrity
      // -----------------------------------------------------------------------

      if (this.override) {
        if (this.status !== 'overridden') {
          throw new Error(
            'An assessment with override data must have status "overridden".'
          );
        }

        if (
          !this.override.overriddenBy ||
          !this.override.overriddenAt
        ) {
          throw new Error(
            'Override must identify who performed it and when.'
          );
        }
      }

      return next();
    } catch (error) {
      return next(error);
    }
  }
);

// =============================================================================
// Immutability protection
// =============================================================================
//
// An eligibility assessment is a historical decision snapshot.
// Never use update/delete operations to "refresh" it.
// Create a new assessment instead.
//
// =============================================================================

const immutableAssessmentError = () => {
  const error = new Error(
    'Loan eligibility assessments are immutable and cannot be modified or deleted.'
  );

  error.code = 'LOAN_ELIGIBILITY_IMMUTABLE';
  error.statusCode = 409;

  return error;
};

loanEligibilitySchema.pre(
  'updateOne',
  function rejectUpdate() {
    throw immutableAssessmentError();
  }
);

loanEligibilitySchema.pre(
  'updateMany',
  function rejectUpdate() {
    throw immutableAssessmentError();
  }
);

loanEligibilitySchema.pre(
  'findOneAndUpdate',
  function rejectUpdate() {
    throw immutableAssessmentError();
  }
);

loanEligibilitySchema.pre(
  'replaceOne',
  function rejectUpdate() {
    throw immutableAssessmentError();
  }
);

loanEligibilitySchema.pre(
  'findOneAndReplace',
  function rejectUpdate() {
    throw immutableAssessmentError();
  }
);

loanEligibilitySchema.pre(
  'deleteOne',
  function rejectDelete() {
    throw immutableAssessmentError();
  }
);

loanEligibilitySchema.pre(
  'deleteMany',
  function rejectDelete() {
    throw immutableAssessmentError();
  }
);

loanEligibilitySchema.pre(
  'findOneAndDelete',
  function rejectDelete() {
    throw immutableAssessmentError();
  }
);

loanEligibilitySchema.pre(
  'findOneAndRemove',
  function rejectDelete() {
    throw immutableAssessmentError();
  }
);

loanEligibilitySchema.pre(
  'remove',
  function rejectDelete() {
    throw immutableAssessmentError();
  }
);

// =============================================================================
// Static methods
// =============================================================================

/**
 * Find the current valid assessment for a user/group combination.
 *
 * Tenant ID is mandatory.
 */
loanEligibilitySchema.statics.findActiveAssessment =
  async function (
    tenantId,
    userId,
    groupId,
    {
      session = null,
      now = new Date(),
    } = {}
  ) {
    if (!tenantId) {
      throw new Error('tenantId is required.');
    }

    if (!userId) {
      throw new Error('userId is required.');
    }

    if (!groupId) {
      throw new Error('groupId is required.');
    }

    const query = this.findOne({
      tenantId,
      user: userId,
      group: groupId,
      expiresAt: {
        $gt: now,
      },
    }).sort({
      assessedAt: -1,
      createdAt: -1,
    });

    if (session) {
      query.session(session);
    }

    return query.exec();
  };

/**
 * Create a new assessment with a calculated expiry.
 *
 * This method does not infer scoring values; the eligibility engine supplies
 * the actual assessment evidence and score.
 */
loanEligibilitySchema.statics.createAssessment =
  async function ({
    tenantId,
    assessmentId,

    assessmentNumber,

    user,
    group,

    assessmentVersion = '1.0.0',
    scoringEngineVersion = '1.0.0',
    policyVersion = '1.0.0',

    overallScore,
    components,
    metadata,

    isEligible,
    maxLoanAmount = '0.00',

    currency = 'UGX',

    rejectionReason = null,
    decisionReason,

    assessedAt = new Date(),
    expiresAt,

    expiryDays = DEFAULT_EXPIRY_DAYS,

    notes,

    correlationId,
    requestId,

    session = null,
  } = {}) {
    if (!tenantId) {
      throw new Error('tenantId is required.');
    }

    if (!user) {
      throw new Error('user is required.');
    }

    if (!group) {
      throw new Error('group is required.');
    }

    if (!assessmentId) {
      throw new Error('assessmentId is required.');
    }

    if (
      !(assessedAt instanceof Date) ||
      Number.isNaN(assessedAt.valueOf())
    ) {
      throw new TypeError('assessedAt must be a valid Date.');
    }

    let resolvedExpiresAt = expiresAt;

    if (resolvedExpiresAt === undefined || resolvedExpiresAt === null) {
      resolvedExpiresAt = calculateExpiryDate(
        assessedAt,
        expiryDays
      );
    }

    if (
      !(resolvedExpiresAt instanceof Date) ||
      Number.isNaN(resolvedExpiresAt.valueOf())
    ) {
      throw new TypeError(
        'expiresAt must be a valid Date.'
      );
    }

    if (resolvedExpiresAt <= assessedAt) {
      throw new RangeError(
        'expiresAt must be later than assessedAt.'
      );
    }

    const document = new this({
      tenantId,

      assessmentId,

      assessmentNumber,

      user,
      group,

      assessmentVersion,
      scoringEngineVersion,
      policyVersion,

      overallScore,
      components,
      metadata,

      isEligible,
      maxLoanAmount:
        normalizeMoneyDecimal(
          maxLoanAmount,
          'maxLoanAmount'
        ),

      currency,

      rejectionReason,
      decisionReason,

      assessedAt,
      expiresAt: resolvedExpiresAt,

      notes,

      correlationId,
      requestId,
    });

    await document.save(
      session
        ? { session }
        : undefined
    );

    return document;
  };

/**
 * Get historical assessments.
 */
loanEligibilitySchema.statics.getHistory =
  async function (
    tenantId,
    userId,
    groupId,
    {
      limit = 50,
      session = null,
    } = {}
  ) {
    const numericLimit = Math.min(
      Math.max(Number(limit) || 50, 1),
      200
    );

    const query = this.find({
      tenantId,
      user: userId,
      group: groupId,
    })
      .sort({
        assessedAt: -1,
        createdAt: -1,
      })
      .limit(numericLimit)
      .lean();

    if (session) {
      query.session(session);
    }

    return query.exec();
  };

/**
 * Find the latest assessment, regardless of expiry.
 *
 * Useful for audit/review screens where historical decisions matter.
 */
loanEligibilitySchema.statics.findLatestAssessment =
  async function (
    tenantId,
    userId,
    groupId,
    {
      session = null,
    } = {}
  ) {
    const query = this.findOne({
      tenantId,
      user: userId,
      group: groupId,
    }).sort({
      assessedAt: -1,
      createdAt: -1,
    });

    if (session) {
      query.session(session);
    }

    return query.exec();
  };

// =============================================================================
// Instance methods
// =============================================================================

/**
 * Determine whether the assessment has expired.
 */
loanEligibilitySchema.methods.needsRefresh =
  function (referenceDate = new Date()) {
    if (
      !(referenceDate instanceof Date) ||
      Number.isNaN(referenceDate.valueOf())
    ) {
      throw new TypeError(
        'referenceDate must be a valid Date.'
      );
    }

    return referenceDate >= this.expiresAt;
  };

/**
 * Check whether the assessment is currently usable for a new loan decision.
 */
loanEligibilitySchema.methods.isCurrentlyValid =
  function (referenceDate = new Date()) {
    return (
      !this.needsRefresh(referenceDate) &&
      (
        this.status === 'eligible' ||
        this.status === 'overridden'
      ) &&
      this.isEligible === true
    );
  };

/**
 * Return a normalized decision summary.
 */
loanEligibilitySchema.methods.getDecisionSummary =
  function () {
    return {
      assessmentId: this.assessmentId,

      user: this.user,
      group: this.group,

      overallScore: this.overallScore,
      components: {
        contributionScore:
          this.components.contributionScore,
        participationScore:
          this.components.participationScore,
        repaymentScore:
          this.components.repaymentScore,
        riskScore:
          this.components.riskScore,
      },

      isEligible: this.isEligible,

      status: this.status,

      maxLoanAmount:
        this.maxLoanAmount?.toString() || '0.00',

      currency: this.currency,

      rejectionReason:
        this.rejectionReason,

      assessedAt: this.assessedAt,
      expiresAt: this.expiresAt,

      assessmentVersion:
        this.assessmentVersion,

      scoringEngineVersion:
        this.scoringEngineVersion,

      policyVersion:
        this.policyVersion,

      overridden:
        Boolean(this.override),
    };
  };

// =============================================================================
// Model
// =============================================================================

const LoanEligibility =
  mongoose.models.LoanEligibility ||
  mongoose.model(
    'LoanEligibility',
    loanEligibilitySchema
  );

export default LoanEligibility;

export {
  ELIGIBILITY_STATUSES,
  REJECTION_REASONS,
  OVERRIDE_TYPES,
  OVERRIDE_REASONS,
  SCORE_MAXIMUM,
  EXPECTED_TOTAL_SCORE,
};