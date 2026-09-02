'use strict';

/**
 * ============================================================================
 * TITech Community Capital
 * SaaS Billing Shadow Execution Model
 * ============================================================================
 *
 * File:
 * backend/models/saasBillingShadowExecution.model.js
 *
 * Stage:
 * Commercial Consolidation — Stage 01d
 *
 * Purpose:
 * Persists the immutable/auditable execution envelope for controlled SaaS
 * billing shadow reads.
 *
 * IMPORTANT:
 * - The legacy billing path remains authoritative during Stage 01d.
 * - Shadow execution MUST NOT mutate authoritative billing state.
 * - This model records observations, execution metadata, normalized outputs,
 *   failures, timing, and reconciliation linkage.
 * - Monetary values are persisted as Decimal128 wherever appropriate.
 *
 * Design goals:
 * - Multi-tenant isolation
 * - Production traceability
 * - Deterministic replay support
 * - Idempotent shadow execution
 * - Safe error capture
 * - Divergence analysis
 * - Cut-over telemetry
 * - High-volume operational querying
 * ============================================================================
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

const { Schema } = mongoose;

const MODEL_NAME = 'SaasBillingShadowExecution';

const EXECUTION_STATUS = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  SKIPPED: 'skipped',
});

const AUTHORITATIVE_ENGINE = Object.freeze({
  LEGACY: 'legacy',
});

const SHADOW_ENGINE = Object.freeze({
  COMMERCIAL: 'commercial',
});

const BILLING_OPERATION = Object.freeze({
  INVOICE_CALCULATION: 'invoice_calculation',
  SUBSCRIPTION_CHARGE: 'subscription_charge',
  PLAN_PRICING: 'plan_pricing',
  ADDON_PRICING: 'addon_pricing',
  PRORATION: 'proration',
  DISCOUNT: 'discount',
  TAX: 'tax',
  CREDIT: 'credit',
  USAGE_CHARGE: 'usage_charge',
  BILLING_PREVIEW: 'billing_preview',
  OTHER: 'other',
});

const FAILURE_CLASSIFICATION = Object.freeze({
  NONE: 'none',
  INPUT_INVALID: 'input_invalid',
  CONFIGURATION_MISSING: 'configuration_missing',
  DEPENDENCY_FAILURE: 'dependency_failure',
  LEGACY_READ_FAILURE: 'legacy_read_failure',
  SHADOW_EXECUTION_FAILURE: 'shadow_execution_failure',
  TIMEOUT: 'timeout',
  SERIALIZATION_FAILURE: 'serialization_failure',
  INTERNAL_ERROR: 'internal_error',
  UNKNOWN: 'unknown',
});

const resultEnvelopeSchema = new Schema(
  {
    currency: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 8,
    },

    total: {
      type: Schema.Types.Decimal128,
    },

    subtotal: {
      type: Schema.Types.Decimal128,
    },

    taxTotal: {
      type: Schema.Types.Decimal128,
    },

    discountTotal: {
      type: Schema.Types.Decimal128,
    },

    creditTotal: {
      type: Schema.Types.Decimal128,
    },

    feeTotal: {
      type: Schema.Types.Decimal128,
    },

    normalizedHash: {
      type: String,
      trim: true,
      maxlength: 128,
    },

    normalized: {
      type: Schema.Types.Mixed,
      default: null,
    },

    raw: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  {
    _id: false,
    minimize: false,
  },
);

const errorSchema = new Schema(
  {
    classification: {
      type: String,
      enum: Object.values(FAILURE_CLASSIFICATION),
      default: FAILURE_CLASSIFICATION.NONE,
      index: true,
    },

    code: {
      type: String,
      trim: true,
      maxlength: 128,
    },

    name: {
      type: String,
      trim: true,
      maxlength: 128,
    },

    message: {
      type: String,
      trim: true,
      maxlength: 4096,
    },

    stack: {
      type: String,
      maxlength: 16384,
    },

    retryable: {
      type: Boolean,
      default: false,
    },

    metadata: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  {
    _id: false,
    minimize: false,
  },
);

const timingSchema = new Schema(
  {
    legacyDurationMs: {
      type: Number,
      min: 0,
    },

    shadowDurationMs: {
      type: Number,
      min: 0,
    },

    totalDurationMs: {
      type: Number,
      min: 0,
    },

    queuedAt: Date,
    startedAt: Date,
    completedAt: Date,
  },
  {
    _id: false,
  },
);

const sourceReferenceSchema = new Schema(
  {
    resourceType: {
      type: String,
      trim: true,
      maxlength: 128,
    },

    resourceId: {
      type: String,
      trim: true,
      maxlength: 256,
    },

    subscriptionId: {
      type: Schema.Types.ObjectId,
      ref: 'Subscription',
    },

    invoiceId: {
      type: Schema.Types.ObjectId,
      ref: 'Invoice',
    },

    billingPeriodStart: Date,
    billingPeriodEnd: Date,
  },
  {
    _id: false,
  },
);

const saasBillingShadowExecutionSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    executionKey: {
      type: String,
      required: true,
      trim: true,
      maxlength: 256,
    },

    correlationId: {
      type: String,
      trim: true,
      maxlength: 256,
      index: true,
    },

    traceId: {
      type: String,
      trim: true,
      maxlength: 256,
      index: true,
    },

    operation: {
      type: String,
      required: true,
      enum: Object.values(BILLING_OPERATION),
      index: true,
    },

    status: {
      type: String,
      required: true,
      enum: Object.values(EXECUTION_STATUS),
      default: EXECUTION_STATUS.PENDING,
      index: true,
    },

    authoritativeEngine: {
      type: String,
      enum: Object.values(AUTHORITATIVE_ENGINE),
      default: AUTHORITATIVE_ENGINE.LEGACY,
      immutable: true,
    },

    shadowEngine: {
      type: String,
      enum: Object.values(SHADOW_ENGINE),
      default: SHADOW_ENGINE.COMMERCIAL,
      immutable: true,
    },

    source: {
      type: sourceReferenceSchema,
      default: () => ({}),
    },

    inputHash: {
      type: String,
      trim: true,
      maxlength: 128,
      index: true,
    },

    inputSnapshot: {
      type: Schema.Types.Mixed,
      default: null,
    },

    legacyResult: {
      type: resultEnvelopeSchema,
      default: null,
    },

    shadowResult: {
      type: resultEnvelopeSchema,
      default: null,
    },

    error: {
      type: errorSchema,
      default: null,
    },

    timing: {
      type: timingSchema,
      default: () => ({}),
    },

    reconciliationId: {
      type: Schema.Types.ObjectId,
      ref: 'SaasBillingReconciliation',
      index: true,
    },

    shadowMode: {
      type: Boolean,
      default: true,
      immutable: true,
    },

    authoritativeWritePerformed: {
      type: Boolean,
      default: false,
      immutable: true,
    },

    implementationVersion: {
      legacy: {
        type: String,
        trim: true,
        maxlength: 128,
      },

      shadow: {
        type: String,
        trim: true,
        maxlength: 128,
      },

      reconciliation: {
        type: String,
        trim: true,
        maxlength: 128,
      },
    },

    context: {
      planId: {
        type: Schema.Types.ObjectId,
      },

      planCode: {
        type: String,
        trim: true,
        maxlength: 128,
        index: true,
      },

      currency: {
        type: String,
        trim: true,
        uppercase: true,
        maxlength: 8,
        index: true,
      },

      countryCode: {
        type: String,
        trim: true,
        uppercase: true,
        maxlength: 8,
      },

      billingCycle: {
        type: String,
        trim: true,
        maxlength: 64,
      },

      featureFlags: {
        type: Schema.Types.Mixed,
        default: null,
      },
    },

    metadata: {
      type: Schema.Types.Mixed,
      default: null,
    },

    expiresAt: {
      type: Date,
      index: true,
    },
  },
  {
    timestamps: true,
    minimize: false,
    strict: true,
    versionKey: false,
    collection: 'saas_billing_shadow_executions',
  },
);

/**
 * One logical shadow execution per tenant + execution key.
 *
 * executionKey should be deterministic and normally derive from something like:
 *
 *   tenantId
 *   + operation
 *   + invoice/subscription/resource
 *   + billing period
 *   + authoritative event/version
 */
saasBillingShadowExecutionSchema.index(
  {
    tenantId: 1,
    executionKey: 1,
  },
  {
    unique: true,
    name: 'uq_shadow_execution_tenant_execution_key',
  },
);

saasBillingShadowExecutionSchema.index(
  {
    tenantId: 1,
    createdAt: -1,
  },
  {
    name: 'ix_shadow_execution_tenant_created',
  },
);

saasBillingShadowExecutionSchema.index(
  {
    tenantId: 1,
    status: 1,
    createdAt: -1,
  },
  {
    name: 'ix_shadow_execution_tenant_status_created',
  },
);

saasBillingShadowExecutionSchema.index(
  {
    tenantId: 1,
    operation: 1,
    createdAt: -1,
  },
  {
    name: 'ix_shadow_execution_tenant_operation_created',
  },
);

saasBillingShadowExecutionSchema.index(
  {
    tenantId: 1,
    'context.planCode': 1,
    createdAt: -1,
  },
  {
    name: 'ix_shadow_execution_tenant_plan_created',
  },
);

saasBillingShadowExecutionSchema.index(
  {
    tenantId: 1,
    reconciliationId: 1,
  },
  {
    sparse: true,
    name: 'ix_shadow_execution_reconciliation',
  },
);

/**
 * TTL cleanup.
 *
 * Documents without expiresAt are retained indefinitely.
 * Retention policy can therefore be controlled by the service layer.
 */
saasBillingShadowExecutionSchema.index(
  {
    expiresAt: 1,
  },
  {
    expireAfterSeconds: 0,
    name: 'ttl_shadow_execution_expiry',
  },
);

/**
 * Ensure a shadow execution can never claim that it performed an
 * authoritative write.
 */
saasBillingShadowExecutionSchema.pre('validate', function validateShadowSafety(next) {
  if (this.shadowMode !== true) {
    return next(
      new Error(
        'SaaS billing Stage 01d execution must always operate in shadowMode.',
      ),
    );
  }

  if (this.authoritativeWritePerformed === true) {
    return next(
      new Error(
        'Shadow execution cannot perform or record an authoritative billing write.',
      ),
    );
  }

  return next();
});

/**
 * Compute a deterministic SHA-256 digest of a serializable value.
 *
 * This intentionally lives on the model as a helper rather than being
 * automatically invoked against Mixed fields, because production callers
 * should normalize objects before hashing them.
 */
saasBillingShadowExecutionSchema.statics.hashPayload = function hashPayload(
  payload,
) {
  const serialized =
    typeof payload === 'string' ? payload : JSON.stringify(payload ?? null);

  return crypto.createHash('sha256').update(serialized).digest('hex');
};

saasBillingShadowExecutionSchema.statics.EXECUTION_STATUS = EXECUTION_STATUS;
saasBillingShadowExecutionSchema.statics.BILLING_OPERATION = BILLING_OPERATION;
saasBillingShadowExecutionSchema.statics.FAILURE_CLASSIFICATION =
  FAILURE_CLASSIFICATION;
saasBillingShadowExecutionSchema.statics.AUTHORITATIVE_ENGINE =
  AUTHORITATIVE_ENGINE;
saasBillingShadowExecutionSchema.statics.SHADOW_ENGINE = SHADOW_ENGINE;

saasBillingShadowExecutionSchema.methods.markRunning = function markRunning() {
  this.status = EXECUTION_STATUS.RUNNING;

  if (!this.timing) {
    this.timing = {};
  }

  this.timing.startedAt = this.timing.startedAt || new Date();

  return this;
};

saasBillingShadowExecutionSchema.methods.markSucceeded =
  function markSucceeded() {
    const now = new Date();

    this.status = EXECUTION_STATUS.SUCCEEDED;
    this.error = null;

    if (!this.timing) {
      this.timing = {};
    }

    this.timing.completedAt = now;

    if (this.timing.startedAt) {
      this.timing.totalDurationMs = Math.max(
        0,
        now.getTime() - new Date(this.timing.startedAt).getTime(),
      );
    }

    return this;
  };

saasBillingShadowExecutionSchema.methods.markFailed = function markFailed({
  classification = FAILURE_CLASSIFICATION.UNKNOWN,
  code,
  name,
  message,
  stack,
  retryable = false,
  metadata,
} = {}) {
  const now = new Date();

  this.status = EXECUTION_STATUS.FAILED;

  this.error = {
    classification,
    code,
    name,
    message,
    stack,
    retryable,
    metadata,
  };

  if (!this.timing) {
    this.timing = {};
  }

  this.timing.completedAt = now;

  if (this.timing.startedAt) {
    this.timing.totalDurationMs = Math.max(
      0,
      now.getTime() - new Date(this.timing.startedAt).getTime(),
    );
  }

  return this;
};

saasBillingShadowExecutionSchema.methods.attachReconciliation =
  function attachReconciliation(reconciliationId) {
    this.reconciliationId = reconciliationId;
    return this;
  };

const SaasBillingShadowExecution =
  mongoose.models[MODEL_NAME] ||
  mongoose.model(MODEL_NAME, saasBillingShadowExecutionSchema);

module.exports = SaasBillingShadowExecution;

module.exports.MODEL_NAME = MODEL_NAME;
module.exports.EXECUTION_STATUS = EXECUTION_STATUS;
module.exports.BILLING_OPERATION = BILLING_OPERATION;
module.exports.FAILURE_CLASSIFICATION = FAILURE_CLASSIFICATION;
module.exports.AUTHORITATIVE_ENGINE = AUTHORITATIVE_ENGINE;
module.exports.SHADOW_ENGINE = SHADOW_ENGINE;