// backend/models/LoanAudit.js
// ============================================================================
// TITech Community Capital LTD
// Enterprise Loan Audit Model
// ============================================================================
//
// Purpose
//   Immutable, tenant-aware, append-only audit trail for loan workflows.
//
// Responsibilities
//   - Record immutable business/audit events.
//   - Preserve tenant isolation.
//   - Identify the affected user, loan, group, and actor.
//   - Preserve structured before/after snapshots.
//   - Record exact monetary values using Decimal128.
//   - Support idempotent audit creation.
//   - Support correlation/request tracing.
//   - Remain transaction/session aware.
//   - Reject all mutation/deletion attempts.
//
// Important architectural boundary
//   This model is an AUDIT RECORD.
//   It is NOT:
//     - the canonical financial Transaction;
//     - the accounting ledger;
//     - the loan balance source of truth;
//     - the payment settlement mechanism.
//
// Financial workflows must persist their canonical financial state through
// the appropriate financial service/repository and may create the audit event
// in the same MongoDB transaction/session.
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

const AUDIT_ACTIONS = Object.freeze([
  'eligibility_assessed',
  'eligibility_overridden',

  'loan_applied',
  'loan_approved',
  'loan_rejected',

  'loan_disbursed',

  'payment_recorded',

  'penalty_applied',

  'loan_defaulted',

  'loan_restructured',

  'loan_completed',

  'loan_status_changed',
]);

const ACTOR_ROLES = Object.freeze([
  'user',
  'admin',
  'group_admin',
  'system',
]);

const AUDIT_STATUSES = Object.freeze([
  'success',
  'failed',
  'pending',
]);

const RISK_LEVELS = Object.freeze([
  'low',
  'medium',
  'high',
]);

const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_REASON_LENGTH = 1000;
const MAX_IP_ADDRESS_LENGTH = 128;
const MAX_USER_AGENT_LENGTH = 1000;
const MAX_IDEMPOTENCY_KEY_LENGTH = 256;
const MAX_CORRELATION_ID_LENGTH = 128;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_EVENT_ID_LENGTH = 128;
const MAX_ERROR_CODE_LENGTH = 128;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const ZERO_DECIMAL = mongoose.Types.Decimal128.fromString('0');
const ZERO_MONEY_STRING = '0.00';

// =============================================================================
// Utility
// =============================================================================

function normalizeLimit(limit, defaultValue = DEFAULT_LIMIT) {
  const numericLimit = Number(limit);

  if (!Number.isFinite(numericLimit) || numericLimit <= 0) {
    return defaultValue;
  }

  return Math.min(Math.floor(numericLimit), MAX_LIMIT);
}

function normalizeRequiredString(value, fieldName, maxLength) {
  if (typeof value !== 'string') {
    throw new TypeError(`${fieldName} must be a string.`);
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }

  if (normalized.length > maxLength) {
    throw new RangeError(
      `${fieldName} exceeds the maximum length of ${maxLength}.`
    );
  }

  return normalized;
}

function normalizeOptionalString(value, fieldName, maxLength) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new TypeError(`${fieldName} must be a string.`);
  }

  const normalized = value.trim();

  if (!normalized) {
    return undefined;
  }

  if (normalized.length > maxLength) {
    throw new RangeError(
      `${fieldName} exceeds the maximum length of ${maxLength}.`
    );
  }

  return normalized;
}

function normalizeObjectId(value, fieldName) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return undefined;
  }

  if (!mongoose.isValidObjectId(value)) {
    throw new TypeError(`${fieldName} must be a valid ObjectId.`);
  }

  return value;
}

/**
 * Convert supported monetary input to Decimal128 without passing through
 * JavaScript floating-point arithmetic.
 *
 * Accepted examples:
 *   50000
 *   "50000"
 *   "50000.00"
 *   Decimal128
 */
function normalizeDecimal(value, fieldName = 'amount') {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (value instanceof mongoose.Types.Decimal128) {
    const raw = value.toString();

    if (!/^\d+(\.\d+)?$/.test(raw)) {
      throw new TypeError(`${fieldName} must be a non-negative decimal.`);
    }

    return value;
  }

  let decimalString;

  if (typeof value === 'string') {
    decimalString = value.trim();
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new TypeError(
        `${fieldName} must be a finite safe number or decimal string.`
      );
    }

    decimalString = String(value);
  } else {
    throw new TypeError(
      `${fieldName} must be Decimal128, a decimal string, or a safe integer.`
    );
  }

  if (!/^\d+(\.\d+)?$/.test(decimalString)) {
    throw new TypeError(
      `${fieldName} must be a non-negative decimal value.`
    );
  }

  return mongoose.Types.Decimal128.fromString(decimalString);
}

function decimalStringOrNull(value) {
  return value === null || value === undefined
    ? null
    : value.toString();
}

function isValidRiskScore(value) {
  return (
    value === undefined ||
    value === null ||
    (
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 100
    )
  );
}

// =============================================================================
// Embedded change snapshot
// =============================================================================

/**
 * Snapshots are intentionally structured instead of using an unrestricted
 * document with arbitrary behavior. The data is still schema-flexible because
 * different loan events naturally contain different fields.
 *
 * IMPORTANT:
 *   Do not place secrets, passwords, access tokens, refresh tokens, raw KYC
 *   documents, payment credentials, or other unnecessary sensitive material in
 *   these snapshots.
 */
const changeSnapshotSchema = new Schema(
  {
    data: {
      type: Schema.Types.Mixed,
      required: false,
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
// Metadata schema
// =============================================================================

const auditMetadataSchema = new Schema(
  {
    ipAddress: {
      type: String,
      trim: true,
      maxlength: MAX_IP_ADDRESS_LENGTH,
      immutable: true,
    },

    userAgent: {
      type: String,
      trim: true,
      maxlength: MAX_USER_AGENT_LENGTH,
      immutable: true,
    },

    reason: {
      type: String,
      trim: true,
      maxlength: MAX_REASON_LENGTH,
      immutable: true,
    },

    /**
     * Risk/eligibility score.
     *
     * Normalized to 0..100 when supplied.
     */
    score: {
      type: Number,
      min: 0,
      max: 100,
      immutable: true,
      validate: {
        validator: isValidRiskScore,
        message: 'metadata.score must be between 0 and 100.',
      },
    },

    riskLevel: {
      type: String,
      enum: RISK_LEVELS,
      immutable: true,
    },

    /**
     * Optional workflow/provider reference.
     *
     * This is an audit reference only, not the canonical transaction state.
     */
    externalReference: {
      type: String,
      trim: true,
      maxlength: 256,
      immutable: true,
    },

    /**
     * Optional canonical financial transaction ID.
     */
    transactionId: {
      type: Schema.Types.ObjectId,
      ref: 'Transaction',
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

const loanAuditSchema = new Schema(
  {
    // -------------------------------------------------------------------------
    // Tenant
    // -------------------------------------------------------------------------

    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      immutable: true,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Audit Event Identity
    // -------------------------------------------------------------------------

    eventId: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      index: true,
      trim: true,
      minlength: 1,
      maxlength: MAX_EVENT_ID_LENGTH,
    },

    /**
     * Optional request/workflow idempotency key.
     *
     * Uniqueness is tenant-scoped and sparse. This permits events that do not
     * participate in an idempotency workflow while preventing two audit events
     * from claiming the same key inside the same tenant.
     */
    idempotencyKey: {
      type: String,
      required: false,
      immutable: true,
      trim: true,
      maxlength: MAX_IDEMPOTENCY_KEY_LENGTH,
      minlength: 1,
    },

    correlationId: {
      type: String,
      required: false,
      immutable: true,
      index: true,
      trim: true,
      maxlength: MAX_CORRELATION_ID_LENGTH,
      minlength: 1,
    },

    requestId: {
      type: String,
      required: false,
      immutable: true,
      index: true,
      trim: true,
      maxlength: MAX_REQUEST_ID_LENGTH,
      minlength: 1,
    },

    // -------------------------------------------------------------------------
    // Action
    // -------------------------------------------------------------------------

    action: {
      type: String,
      enum: AUDIT_ACTIONS,
      required: true,
      immutable: true,
      index: true,
      lowercase: true,
      trim: true,
    },

    // -------------------------------------------------------------------------
    // Loan
    // -------------------------------------------------------------------------

    loan: {
      type: Schema.Types.ObjectId,
      ref: 'Loan',
      required: false,
      immutable: true,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Affected User
    // -------------------------------------------------------------------------

    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Group
    // -------------------------------------------------------------------------

    group: {
      type: Schema.Types.ObjectId,
      ref: 'Group',
      required: false,
      immutable: true,
      index: true,
    },

    // -------------------------------------------------------------------------
    // Actor
    // -------------------------------------------------------------------------

    actor: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
      index: true,
    },

    actorRole: {
      type: String,
      enum: ACTOR_ROLES,
      required: true,
      immutable: true,
      lowercase: true,
      trim: true,
    },

    // -------------------------------------------------------------------------
    // Before/After snapshots
    // -------------------------------------------------------------------------

    changes: {
      before: {
        type: changeSnapshotSchema,
        required: false,
        immutable: true,
      },

      after: {
        type: changeSnapshotSchema,
        required: false,
        immutable: true,
      },
    },

    // -------------------------------------------------------------------------
    // Description
    // -------------------------------------------------------------------------

    description: {
      type: String,
      trim: true,
      maxlength: MAX_DESCRIPTION_LENGTH,
      immutable: true,
    },

    // -------------------------------------------------------------------------
    // Financial amount
    // -------------------------------------------------------------------------

    /**
     * Exact monetary audit value.
     *
     * The currency code identifies how the amount is denominated. The model
     * intentionally does not perform currency conversion or accounting.
     */
    amount: {
      type: Schema.Types.Decimal128,
      default: null,
      immutable: true,
      validate: {
        validator(value) {
          if (value === null || value === undefined) {
            return true;
          }

          const stringValue = value.toString();

          return /^\d+(\.\d+)?$/.test(stringValue);
        },
        message: 'amount must be a non-negative decimal value.',
      },
    },

    currency: {
      type: String,
      trim: true,
      uppercase: true,
      match: /^[A-Z]{3}$/,
      default: 'UGX',
      immutable: true,
    },

    // -------------------------------------------------------------------------
    // Metadata
    // -------------------------------------------------------------------------

    metadata: {
      type: auditMetadataSchema,
      default: undefined,
      immutable: true,
    },

    // -------------------------------------------------------------------------
    // Operation status
    // -------------------------------------------------------------------------

    status: {
      type: String,
      enum: AUDIT_STATUSES,
      default: 'success',
      required: true,
      immutable: true,
      index: true,
      lowercase: true,
      trim: true,
    },

    // -------------------------------------------------------------------------
    // Error
    // -------------------------------------------------------------------------

    error: {
      message: {
        type: String,
        trim: true,
        maxlength: MAX_DESCRIPTION_LENGTH,
        immutable: true,
      },

      code: {
        type: String,
        trim: true,
        maxlength: MAX_ERROR_CODE_LENGTH,
        immutable: true,
      },
    },
  },
  {
    timestamps: true,

    /**
     * Keep no Mongoose version counter because the record must never be
     * updated after creation.
     */
    versionKey: false,

    strict: true,
    minimize: false,

    /**
     * Prevent fields being silently included through unknown top-level paths.
     */
    strictQuery: true,
  }
);

// =============================================================================
// Compound indexes
// =============================================================================

loanAuditSchema.index(
  {
    tenantId: 1,
    user: 1,
    createdAt: -1,
  },
  {
    name: 'idx_loan_audit_tenant_user_created',
  }
);

loanAuditSchema.index(
  {
    tenantId: 1,
    loan: 1,
    createdAt: -1,
  },
  {
    name: 'idx_loan_audit_tenant_loan_created',
  }
);

loanAuditSchema.index(
  {
    tenantId: 1,
    action: 1,
    createdAt: -1,
  },
  {
    name: 'idx_loan_audit_tenant_action_created',
  }
);

loanAuditSchema.index(
  {
    tenantId: 1,
    actor: 1,
    createdAt: -1,
  },
  {
    name: 'idx_loan_audit_tenant_actor_created',
  }
);

loanAuditSchema.index(
  {
    tenantId: 1,
    status: 1,
    createdAt: -1,
  },
  {
    name: 'idx_loan_audit_tenant_status_created',
  }
);

loanAuditSchema.index(
  {
    tenantId: 1,
    idempotencyKey: 1,
  },
  {
    unique: true,
    sparse: true,
    name: 'uniq_loan_audit_tenant_idempotency'
  }
);

loanAuditSchema.index(
  {
    tenantId: 1,
    correlationId: 1,
    createdAt: -1,
  },
  {
    name: 'idx_loan_audit_tenant_correlation_created',
  }
);

loanAuditSchema.index(
  {
    tenantId: 1,
    requestId: 1,
    createdAt: -1,
  },
  {
    name: 'idx_loan_audit_tenant_request_created',
  }
);

// =============================================================================
// Immutability protection
// =============================================================================

const immutableOperationError = () => {
  const error = new Error(
    'Loan audit records are immutable and cannot be modified or deleted.'
  );

  error.code = 'LOAN_AUDIT_IMMUTABLE';
  error.statusCode = 409;

  return error;
};

loanAuditSchema.pre(
  'updateOne',
  function rejectUpdate() {
    throw immutableOperationError();
  }
);

loanAuditSchema.pre(
  'updateMany',
  function rejectUpdate() {
    throw immutableOperationError();
  }
);

loanAuditSchema.pre(
  'findOneAndUpdate',
  function rejectUpdate() {
    throw immutableOperationError();
  }
);

loanAuditSchema.pre(
  'replaceOne',
  function rejectUpdate() {
    throw immutableOperationError();
  }
);

loanAuditSchema.pre(
  'findOneAndReplace',
  function rejectUpdate() {
    throw immutableOperationError();
  }
);

loanAuditSchema.pre(
  'deleteOne',
  function rejectDelete() {
    throw immutableOperationError();
  }
);

loanAuditSchema.pre(
  'deleteMany',
  function rejectDelete() {
    throw immutableOperationError();
  }
);

loanAuditSchema.pre(
  'findOneAndDelete',
  function rejectDelete() {
    throw immutableOperationError();
  }
);

loanAuditSchema.pre(
  'findOneAndRemove',
  function rejectDelete() {
    throw immutableOperationError();
  }
);

loanAuditSchema.pre(
  'remove',
  function rejectDelete() {
    throw immutableOperationError();
  }
);

// =============================================================================
// Document validation
// =============================================================================

loanAuditSchema.pre('validate', function validateAuditDocument(next) {
  try {
    normalizeRequiredString(
      this.tenantId?.toString(),
      'tenantId',
      128
    );

    normalizeRequiredString(
      this.eventId,
      'eventId',
      MAX_EVENT_ID_LENGTH
    );

    if (this.idempotencyKey) {
      normalizeRequiredString(
        this.idempotencyKey,
        'idempotencyKey',
        MAX_IDEMPOTENCY_KEY_LENGTH
      );
    }

    if (this.description) {
      if (this.description.length > MAX_DESCRIPTION_LENGTH) {
        throw new RangeError(
          `description exceeds ${MAX_DESCRIPTION_LENGTH} characters.`
        );
      }
    }

    if (this.amount !== null && this.amount !== undefined) {
      normalizeDecimal(this.amount, 'amount');
    }

    if (
      this.status === 'failed' &&
      !this.error?.message
    ) {
      throw new Error(
        'Failed audit records must contain an error.message.'
      );
    }

    if (
      this.status !== 'failed' &&
      this.error?.message
    ) {
      throw new Error(
        'error.message should only be supplied for failed audit records.'
      );
    }

    return next();
  } catch (error) {
    return next(error);
  }
});

// =============================================================================
// Static helpers
// =============================================================================

/**
 * Create an immutable audit event.
 *
 * The duplicate-idempotency behavior is intentionally NOT implemented by
 * first reading and then inserting. The database unique index remains the
 * final concurrency boundary.
 */
loanAuditSchema.statics.logAction = async function ({
  tenantId,
  eventId,
  idempotencyKey,

  correlationId,
  requestId,

  action,

  loan,
  user,
  group,

  actor,
  actorRole,

  changes,
  description,

  amount,
  currency = 'UGX',

  metadata,

  status = 'success',
  error = null,

  session = null,
} = {}) {
  const normalizedTenantId = normalizeObjectId(
    tenantId,
    'tenantId'
  );

  const normalizedLoan = normalizeObjectId(
    loan,
    'loan'
  );

  const normalizedUser = normalizeObjectId(
    user,
    'user'
  );

  const normalizedGroup = normalizeObjectId(
    group,
    'group'
  );

  const normalizedActor = normalizeObjectId(
    actor,
    'actor'
  );

  const normalizedEventId = normalizeRequiredString(
    eventId,
    'eventId',
    MAX_EVENT_ID_LENGTH
  );

  const normalizedAction = normalizeRequiredString(
    action,
    'action',
    100
  );

  if (!AUDIT_ACTIONS.includes(normalizedAction)) {
    throw new Error(
      `Unsupported loan audit action: ${normalizedAction}`
    );
  }

  if (!ACTOR_ROLES.includes(actorRole)) {
    throw new Error(
      `Unsupported audit actorRole: ${actorRole}`
    );
  }

  if (!AUDIT_STATUSES.includes(status)) {
    throw new Error(
      `Unsupported audit status: ${status}`
    );
  }

  if (!user) {
    throw new Error('user is required to create a loan audit entry.');
  }

  if (!actor) {
    throw new Error('actor is required to create a loan audit entry.');
  }

  const payload = {
    tenantId: normalizedTenantId,

    eventId: normalizedEventId,

    idempotencyKey: normalizeOptionalString(
      idempotencyKey,
      'idempotencyKey',
      MAX_IDEMPOTENCY_KEY_LENGTH
    ),

    correlationId: normalizeOptionalString(
      correlationId,
      'correlationId',
      MAX_CORRELATION_ID_LENGTH
    ),

    requestId: normalizeOptionalString(
      requestId,
      'requestId',
      MAX_REQUEST_ID_LENGTH
    ),

    action: normalizedAction,

    loan: normalizedLoan,
    user: normalizedUser,
    group: normalizedGroup,

    actor: normalizedActor,
    actorRole,

    changes,

    description: normalizeOptionalString(
      description,
      'description',
      MAX_DESCRIPTION_LENGTH
    ),

    amount: normalizeDecimal(amount, 'amount'),

    currency,

    metadata,

    status,

    error: error
      ? {
          message: normalizeRequiredString(
            error.message,
            'error.message',
            MAX_DESCRIPTION_LENGTH
          ),
          code: normalizeOptionalString(
            error.code,
            'error.code',
            MAX_ERROR_CODE_LENGTH
          ),
        }
      : undefined,
  };

  const audit = new this(payload);

  try {
    await audit.save(
      session ? { session } : undefined
    );

    return audit;
  } catch (saveError) {
    /**
     * Unique idempotency collisions are not silently swallowed.
     *
     * The caller can resolve an existing event explicitly by idempotency key.
     */
    if (saveError?.code === 11000) {
      saveError.code = 'LOAN_AUDIT_DUPLICATE';
      saveError.statusCode = 409;
    }

    throw saveError;
  }
};

/**
 * Find a previously persisted idempotent audit event.
 */
loanAuditSchema.statics.findByIdempotencyKey =
  async function (
    tenantId,
    idempotencyKey,
    { session = null } = {}
  ) {
    const normalizedTenantId = normalizeObjectId(
      tenantId,
      'tenantId'
    );

    const normalizedKey = normalizeRequiredString(
      idempotencyKey,
      'idempotencyKey',
      MAX_IDEMPOTENCY_KEY_LENGTH
    );

    const query = this.findOne({
      tenantId: normalizedTenantId,
      idempotencyKey: normalizedKey,
    });

    if (session) {
      query.session(session);
    }

    return query.exec();
  };

/**
 * Get immutable audit history for a loan.
 *
 * The default ordering is chronological so the result reads like an event
 * history.
 */
loanAuditSchema.statics.getLoanTrail =
  async function (
    tenantId,
    loanId,
    {
      limit = DEFAULT_LIMIT,
      session = null,
      startDate = null,
      endDate = null,
      actions = null,
    } = {}
  ) {
    const normalizedTenantId = normalizeObjectId(
      tenantId,
      'tenantId'
    );

    const normalizedLoanId = normalizeObjectId(
      loanId,
      'loanId'
    );

    if (!normalizedLoanId) {
      throw new Error('loanId is required.');
    }

    const queryFilter = {
      tenantId: normalizedTenantId,
      loan: normalizedLoanId,
    };

    if (startDate || endDate) {
      queryFilter.createdAt = {};

      if (startDate) {
        queryFilter.createdAt.$gte = new Date(startDate);
      }

      if (endDate) {
        queryFilter.createdAt.$lte = new Date(endDate);
      }
    }

    if (Array.isArray(actions) && actions.length > 0) {
      const invalidActions = actions.filter(
        (item) => !AUDIT_ACTIONS.includes(item)
      );

      if (invalidActions.length > 0) {
        throw new Error(
          `Unsupported audit actions: ${invalidActions.join(', ')}`
        );
      }

      queryFilter.action = {
        $in: actions,
      };
    }

    const query = this.find(queryFilter)
      .populate(
        'actor',
        'name email role'
      )
      .populate(
        'user',
        'name email'
      )
      .populate(
        'group',
        'name'
      )
      .sort({
        createdAt: 1,
        _id: 1,
      })
      .limit(normalizeLimit(limit))
      .lean();

    if (session) {
      query.session(session);
    }

    return query.exec();
  };

/**
 * Get a user's loan activity.
 */
loanAuditSchema.statics.getUserActivity =
  async function (
    tenantId,
    userId,
    {
      limit = DEFAULT_LIMIT,
      session = null,
    } = {}
  ) {
    const normalizedTenantId = normalizeObjectId(
      tenantId,
      'tenantId'
    );

    const normalizedUserId = normalizeObjectId(
      userId,
      'userId'
    );

    if (!normalizedUserId) {
      throw new Error('userId is required.');
    }

    const query = this.find({
      tenantId: normalizedTenantId,
      user: normalizedUserId,
    })
      .populate(
        'actor',
        'name email role'
      )
      .populate(
        'loan',
        'amount status'
      )
      .sort({
        createdAt: -1,
        _id: -1,
      })
      .limit(normalizeLimit(limit))
      .lean();

    if (session) {
      query.session(session);
    }

    return query.exec();
  };

/**
 * Get events by correlation ID.
 *
 * Useful for tracing one workflow spanning HTTP, domain services and
 * financial operations.
 */
loanAuditSchema.statics.getByCorrelationId =
  async function (
    tenantId,
    correlationId,
    {
      limit = DEFAULT_LIMIT,
      session = null,
    } = {}
  ) {
    const normalizedTenantId = normalizeObjectId(
      tenantId,
      'tenantId'
    );

    const normalizedCorrelationId = normalizeRequiredString(
      correlationId,
      'correlationId',
      MAX_CORRELATION_ID_LENGTH
    );

    const query = this.find({
      tenantId: normalizedTenantId,
      correlationId: normalizedCorrelationId,
    })
      .sort({
        createdAt: 1,
        _id: 1,
      })
      .limit(normalizeLimit(limit))
      .lean();

    if (session) {
      query.session(session);
    }

    return query.exec();
  };

/**
 * Get events linked to a canonical financial transaction.
 */
loanAuditSchema.statics.getByTransactionId =
  async function (
    tenantId,
    transactionId,
    {
      limit = DEFAULT_LIMIT,
      session = null,
    } = {}
  ) {
    const normalizedTenantId = normalizeObjectId(
      tenantId,
      'tenantId'
    );

    const normalizedTransactionId = normalizeObjectId(
      transactionId,
      'transactionId'
    );

    if (!normalizedTransactionId) {
      throw new Error('transactionId is required.');
    }

    const query = this.find({
      tenantId: normalizedTenantId,
      'metadata.transactionId': normalizedTransactionId,
    })
      .sort({
        createdAt: 1,
        _id: 1,
      })
      .limit(normalizeLimit(limit))
      .lean();

    if (session) {
      query.session(session);
    }

    return query.exec();
  };

// =============================================================================
// Model
// =============================================================================

const LoanAudit =
  mongoose.models.LoanAudit ||
  mongoose.model(
    'LoanAudit',
    loanAuditSchema
  );

export default LoanAudit;

export {
  AUDIT_ACTIONS,
  ACTOR_ROLES,
  AUDIT_STATUSES,
  RISK_LEVELS,
  ZERO_DECIMAL,
  ZERO_MONEY_STRING,
};