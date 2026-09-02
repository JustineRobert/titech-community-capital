'use strict';

/**
 * ============================================================================
 * TITech Community Capital
 * SaaS Billing Reconciliation Model
 * ============================================================================
 *
 * File:
 * backend/models/saasBillingReconciliation.model.js
 *
 * Stage:
 * Commercial Consolidation — Stage 01d
 *
 * Purpose:
 * ----------------------------------------------------------------------------
 * Persistent reconciliation ledger for controlled comparison between:
 *
 *   AUTHORITATIVE:
 *     Legacy SaaS billing implementation
 *
 *   SHADOW:
 *     Commercial SaaS billing implementation
 *
 * During Stage 01d the legacy implementation remains authoritative.
 *
 * This model records:
 *
 * - exact matches
 * - tolerance matches
 * - monetary divergences
 * - line-item divergences
 * - missing components
 * - configuration divergences
 * - normalization mismatches
 * - execution failures
 * - structured field-level differences
 * - severity
 * - monetary deltas
 * - percentage / basis-point deltas
 * - cut-over eligibility
 * - reconciliation confidence
 * - implementation versions
 * - tenant and billing context
 *
 * IMPORTANT FINANCIAL SAFETY RULE:
 * ----------------------------------------------------------------------------
 * This model is observational.
 *
 * It MUST NOT itself authorize:
 *
 * - invoice posting
 * - payment capture
 * - ledger posting
 * - revenue recognition
 * - account balance mutation
 * - subscription mutation
 * - refund issuance
 * - credit issuance
 *
 * Stage 01d is a shadow stage.
 * The legacy billing path remains authoritative until explicit cut-over.
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

const { Schema } = mongoose;

const MODEL_NAME = 'SaasBillingReconciliation';

/**
 * ============================================================================
 * ENUMERATIONS
 * ============================================================================
 */

const RECONCILIATION_STATUS = Object.freeze({
  PENDING: 'pending',
  MATCHED: 'matched',
  MATCHED_WITHIN_TOLERANCE: 'matched_within_tolerance',
  DIVERGED: 'diverged',
  INCONCLUSIVE: 'inconclusive',
  FAILED: 'failed',
  SKIPPED: 'skipped',
});

const MATCH_CLASSIFICATION = Object.freeze({
  EXACT_MATCH: 'exact_match',
  TOLERANCE_MATCH: 'tolerance_match',
  MONETARY_DIVERGENCE: 'monetary_divergence',
  LINE_ITEM_DIVERGENCE: 'line_item_divergence',
  MISSING_COMPONENT: 'missing_component',
  CONFIGURATION_DIVERGENCE: 'configuration_divergence',
  NORMALIZATION_MISMATCH: 'normalization_mismatch',
  EXECUTION_FAILURE: 'execution_failure',
  INPUT_DIVERGENCE: 'input_divergence',
  UNKNOWN_DIVERGENCE: 'unknown_divergence',
});

const SEVERITY = Object.freeze({
  NONE: 'none',
  INFO: 'info',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
});

const CUTOVER_STATUS = Object.freeze({
  NOT_ELIGIBLE: 'not_eligible',
  ELIGIBLE: 'eligible',
  BLOCKED: 'blocked',
  REVIEW_REQUIRED: 'review_required',
  NOT_APPLICABLE: 'not_applicable',
});

const DIFFERENCE_TYPE = Object.freeze({
  VALUE: 'value',
  MISSING: 'missing',
  EXTRA: 'extra',
  TYPE: 'type',
  NORMALIZATION: 'normalization',
  CONFIGURATION: 'configuration',
  ORDER: 'order',
});

const ENGINE_NAME = Object.freeze({
  LEGACY: 'legacy',
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

const RECONCILIATION_VERSION = '1.0.0';

/**
 * ============================================================================
 * MONEY SCHEMA
 * ============================================================================
 *
 * Decimal128 is used instead of JavaScript Number for monetary values.
 *
 * Never use floating-point arithmetic for persisted financial deltas.
 * ============================================================================
 */

const moneySchema = new Schema(
  {
    currency: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 8,
    },

    amount: {
      type: Schema.Types.Decimal128,
      default: null,
    },
  },
  {
    _id: false,
  },
);

/**
 * ============================================================================
 * DIFFERENCE SCHEMA
 * ============================================================================
 *
 * Structured field-level difference.
 *
 * Example:
 *
 * {
 *   path: "lineItems[0].unitAmount",
 *   type: "value",
 *   legacyValue: "10000",
 *   shadowValue: "10500",
 *   delta: "500"
 * }
 *
 * Values are deliberately Mixed because billing calculations may contain:
 *
 * - strings
 * - Decimal128 values
 * - numbers from legacy systems
 * - booleans
 * - enums
 * - arrays
 * - objects
 *
 * The reconciliation service is responsible for deterministic normalization.
 * ============================================================================
 */

const differenceSchema = new Schema(
  {
    path: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1024,
    },

    type: {
      type: String,
      required: true,
      enum: Object.values(DIFFERENCE_TYPE),
    },

    legacyValue: {
      type: Schema.Types.Mixed,
      default: null,
    },

    shadowValue: {
      type: Schema.Types.Mixed,
      default: null,
    },

    normalizedLegacyValue: {
      type: Schema.Types.Mixed,
      default: null,
    },

    normalizedShadowValue: {
      type: Schema.Types.Mixed,
      default: null,
    },

    delta: {
      type: Schema.Types.Decimal128,
      default: null,
    },

    deltaPercent: {
      type: Number,
      default: null,
    },

    deltaBasisPoints: {
      type: Number,
      default: null,
    },

    material: {
      type: Boolean,
      default: false,
    },

    ignoredForCutover: {
      type: Boolean,
      default: false,
    },

    reason: {
      type: String,
      trim: true,
      maxlength: 2048,
    },
  },
  {
    _id: false,
    minimize: false,
  },
);

/**
 * ============================================================================
 * LINE ITEM SUMMARY
 * ============================================================================
 */

const lineItemSummarySchema = new Schema(
  {
    totalLegacy: {
      type: Number,
      min: 0,
      default: 0,
    },

    totalShadow: {
      type: Number,
      min: 0,
      default: 0,
    },

    matched: {
      type: Number,
      min: 0,
      default: 0,
    },

    diverged: {
      type: Number,
      min: 0,
      default: 0,
    },

    missingInLegacy: {
      type: Number,
      min: 0,
      default: 0,
    },

    missingInShadow: {
      type: Number,
      min: 0,
      default: 0,
    },

    orderingDifferences: {
      type: Number,
      min: 0,
      default: 0,
    },
  },
  {
    _id: false,
  },
);

/**
 * ============================================================================
 * TOLERANCE POLICY
 * ============================================================================
 *
 * Tolerance must be explicit and persisted with every reconciliation.
 *
 * This makes historical reconciliation results reproducible even if the
 * global configuration changes later.
 * ============================================================================
 */

const toleranceSchema = new Schema(
  {
    currency: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 8,
    },

    absoluteAmount: {
      type: Schema.Types.Decimal128,
      default: null,
    },

    percentage: {
      type: Number,
      min: 0,
      default: null,
    },

    basisPoints: {
      type: Number,
      min: 0,
      default: null,
    },

    mode: {
      type: String,
      enum: [
        'exact',
        'absolute',
        'percentage',
        'basis_points',
        'combined',
      ],
      default: 'exact',
    },

    policyVersion: {
      type: String,
      trim: true,
      maxlength: 128,
    },
  },
  {
    _id: false,
  },
);

/**
 * ============================================================================
 * CUT-OVER EVALUATION
 * ============================================================================
 */

const cutoverEvaluationSchema = new Schema(
  {
    status: {
      type: String,
      required: true,
      enum: Object.values(CUTOVER_STATUS),
      default: CUTOVER_STATUS.NOT_ELIGIBLE,
    },

    eligible: {
      type: Boolean,
      default: false,
    },

    blocked: {
      type: Boolean,
      default: false,
    },

    reasonCodes: {
      type: [
        {
          type: String,
          trim: true,
          maxlength: 128,
        },
      ],
      default: [],
    },

    requiredReview: {
      type: Boolean,
      default: false,
    },

    evaluatedAt: {
      type: Date,
      default: null,
    },

    policyVersion: {
      type: String,
      trim: true,
      maxlength: 128,
    },

    minimumConfidence: {
      type: Number,
      min: 0,
      max: 1,
      default: null,
    },

    achievedConfidence: {
      type: Number,
      min: 0,
      max: 1,
      default: null,
    },

    divergenceRate: {
      type: Number,
      min: 0,
      max: 1,
      default: null,
    },

    maximumAllowedDivergenceRate: {
      type: Number,
      min: 0,
      max: 1,
      default: null,
    },

    observationWindowId: {
      type: String,
      trim: true,
      maxlength: 256,
    },
  },
  {
    _id: false,
  },
);

/**
 * ============================================================================
 * FAILURE INFORMATION
 * ============================================================================
 */

const failureSchema = new Schema(
  {
    code: {
      type: String,
      trim: true,
      maxlength: 128,
    },

    classification: {
      type: String,
      trim: true,
      maxlength: 128,
    },

    message: {
      type: String,
      trim: true,
      maxlength: 4096,
    },

    retryable: {
      type: Boolean,
      default: false,
    },

    engine: {
      type: String,
      enum: Object.values(ENGINE_NAME),
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

/**
 * ============================================================================
 * MAIN SCHEMA
 * ============================================================================
 */

const saasBillingReconciliationSchema = new Schema(
  {
    /**
     * ------------------------------------------------------------------------
     * TENANT
     * ------------------------------------------------------------------------
     */

    tenantId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    /**
     * ------------------------------------------------------------------------
     * DETERMINISTIC RECONCILIATION KEY
     * ------------------------------------------------------------------------
     *
     * One logical billing observation should produce one reconciliation
     * record.
     *
     * The service layer is responsible for constructing this deterministically.
     */

    reconciliationKey: {
      type: String,
      required: true,
      trim: true,
      maxlength: 512,
    },

    executionId: {
      type: Schema.Types.ObjectId,
      ref: 'SaasBillingShadowExecution',
      index: true,
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

    /**
     * ------------------------------------------------------------------------
     * BILLING CONTEXT
     * ------------------------------------------------------------------------
     */

    operation: {
      type: String,
      required: true,
      enum: Object.values(BILLING_OPERATION),
      index: true,
    },

    sourceReference: {
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

    /**
     * ------------------------------------------------------------------------
     * ENGINE INFORMATION
     * ------------------------------------------------------------------------
     */

    authoritativeEngine: {
      type: String,
      required: true,
      enum: Object.values(ENGINE_NAME),
      default: ENGINE_NAME.LEGACY,
      immutable: true,
    },

    shadowEngine: {
      type: String,
      required: true,
      enum: Object.values(ENGINE_NAME),
      default: ENGINE_NAME.COMMERCIAL,
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
        default: RECONCILIATION_VERSION,
      },
    },

    /**
     * ------------------------------------------------------------------------
     * RECONCILIATION STATE
     * ------------------------------------------------------------------------
     */

    status: {
      type: String,
      required: true,
      enum: Object.values(RECONCILIATION_STATUS),
      default: RECONCILIATION_STATUS.PENDING,
      index: true,
    },

    classification: {
      type: String,
      required: true,
      enum: Object.values(MATCH_CLASSIFICATION),
      default: MATCH_CLASSIFICATION.UNKNOWN_DIVERGENCE,
      index: true,
    },

    severity: {
      type: String,
      required: true,
      enum: Object.values(SEVERITY),
      default: SEVERITY.NONE,
      index: true,
    },

    /**
     * ------------------------------------------------------------------------
     * RESULT HASHES
     * ------------------------------------------------------------------------
     *
     * Hashes make it possible to establish deterministic equality without
     * repeatedly comparing large raw result documents.
     */

    legacyResultHash: {
      type: String,
      trim: true,
      maxlength: 128,
      index: true,
    },

    shadowResultHash: {
      type: String,
      trim: true,
      maxlength: 128,
      index: true,
    },

    normalizedLegacyResultHash: {
      type: String,
      trim: true,
      maxlength: 128,
    },

    normalizedShadowResultHash: {
      type: String,
      trim: true,
      maxlength: 128,
    },

    /**
     * ------------------------------------------------------------------------
     * TOTALS
     * ------------------------------------------------------------------------
     */

    legacyTotal: {
      type: moneySchema,
      default: null,
    },

    shadowTotal: {
      type: moneySchema,
      default: null,
    },

    absoluteDelta: {
      type: moneySchema,
      default: null,
    },

    percentageDelta: {
      type: Number,
      default: null,
    },

    basisPointDelta: {
      type: Number,
      default: null,
    },

    /**
     * ------------------------------------------------------------------------
     * COMPONENT TOTALS
     * ------------------------------------------------------------------------
     */

    components: {
      subtotal: {
        legacy: {
          type: Schema.Types.Decimal128,
          default: null,
        },

        shadow: {
          type: Schema.Types.Decimal128,
          default: null,
        },

        delta: {
          type: Schema.Types.Decimal128,
          default: null,
        },
      },

      tax: {
        legacy: {
          type: Schema.Types.Decimal128,
          default: null,
        },

        shadow: {
          type: Schema.Types.Decimal128,
          default: null,
        },

        delta: {
          type: Schema.Types.Decimal128,
          default: null,
        },
      },

      discount: {
        legacy: {
          type: Schema.Types.Decimal128,
          default: null,
        },

        shadow: {
          type: Schema.Types.Decimal128,
          default: null,
        },

        delta: {
          type: Schema.Types.Decimal128,
          default: null,
        },
      },

      credit: {
        legacy: {
          type: Schema.Types.Decimal128,
          default: null,
        },

        shadow: {
          type: Schema.Types.Decimal128,
          default: null,
        },

        delta: {
          type: Schema.Types.Decimal128,
          default: null,
        },
      },

      fee: {
        legacy: {
          type: Schema.Types.Decimal128,
          default: null,
        },

        shadow: {
          type: Schema.Types.Decimal128,
          default: null,
        },

        delta: {
          type: Schema.Types.Decimal128,
          default: null,
        },
      },
    },

    /**
     * ------------------------------------------------------------------------
     * LINE ITEM RECONCILIATION
     * ------------------------------------------------------------------------
     */

    lineItems: {
      type: lineItemSummarySchema,
      default: () => ({}),
    },

    /**
     * ------------------------------------------------------------------------
     * TOLERANCE
     * ------------------------------------------------------------------------
     *
     * Snapshot the actual policy used for this reconciliation.
     */

    tolerance: {
      type: toleranceSchema,
      default: () => ({}),
    },

    withinTolerance: {
      type: Boolean,
      default: false,
      index: true,
    },

    exactMatch: {
      type: Boolean,
      default: false,
      index: true,
    },

    /**
     * ------------------------------------------------------------------------
     * STRUCTURED DIFFERENCES
     * ------------------------------------------------------------------------
     */

    differences: {
      type: [differenceSchema],
      default: [],
    },

    differenceCount: {
      type: Number,
      min: 0,
      default: 0,
    },

    materialDifferenceCount: {
      type: Number,
      min: 0,
      default: 0,
    },

    /**
     * ------------------------------------------------------------------------
     * FAILURE
     * ------------------------------------------------------------------------
     */

    failure: {
      type: failureSchema,
      default: null,
    },

    /**
     * ------------------------------------------------------------------------
     * CUT-OVER DECISION
     * ------------------------------------------------------------------------
     */

    cutover: {
      type: cutoverEvaluationSchema,
      default: () => ({}),
    },

    /**
     * ------------------------------------------------------------------------
     * EXECUTION SAFETY
     * ------------------------------------------------------------------------
     *
     * Reconciliation itself must never become an authority switch.
     */

    shadowMode: {
      type: Boolean,
      required: true,
      default: true,
      immutable: true,
    },

    authoritativeWritePerformed: {
      type: Boolean,
      required: true,
      default: false,
      immutable: true,
    },

    /**
     * ------------------------------------------------------------------------
     * INPUT / OUTPUT SNAPSHOT REFERENCES
     * ------------------------------------------------------------------------
     *
     * Raw billing inputs/results may be large or sensitive. The reconciliation
     * record therefore permits references and normalized snapshots while
     * allowing deployment-specific retention controls.
     */

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

    legacySnapshot: {
      type: Schema.Types.Mixed,
      default: null,
    },

    shadowSnapshot: {
      type: Schema.Types.Mixed,
      default: null,
    },

    /**
     * ------------------------------------------------------------------------
     * AUDIT / METADATA
     * ------------------------------------------------------------------------
     */

    metadata: {
      type: Schema.Types.Mixed,
      default: null,
    },

    createdBy: {
      type: String,
      trim: true,
      maxlength: 256,
    },

    /**
     * ------------------------------------------------------------------------
     * RETENTION
     * ------------------------------------------------------------------------
     */

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
    collection: 'saas_billing_reconciliations',
  },
);

/**
 * ============================================================================
 * INDEXES
 * ============================================================================
 */

/**
 * One reconciliation per tenant + logical billing observation.
 */
saasBillingReconciliationSchema.index(
  {
    tenantId: 1,
    reconciliationKey: 1,
  },
  {
    unique: true,
    name: 'uq_saas_reconciliation_tenant_key',
  },
);

/**
 * Operational tenant timeline.
 */
saasBillingReconciliationSchema.index(
  {
    tenantId: 1,
    createdAt: -1,
  },
  {
    name: 'ix_saas_reconciliation_tenant_created',
  },
);

/**
 * Divergence investigation.
 */
saasBillingReconciliationSchema.index(
  {
    tenantId: 1,
    status: 1,
    severity: 1,
    createdAt: -1,
  },
  {
    name: 'ix_saas_reconciliation_divergence',
  },
);

/**
 * Classification analysis.
 */
saasBillingReconciliationSchema.index(
  {
    tenantId: 1,
    classification: 1,
    createdAt: -1,
  },
  {
    name: 'ix_saas_reconciliation_classification',
  },
);

/**
 * Operation-specific parity monitoring.
 */
saasBillingReconciliationSchema.index(
  {
    tenantId: 1,
    operation: 1,
    status: 1,
    createdAt: -1,
  },
  {
    name: 'ix_saas_reconciliation_operation_status',
  },
);

/**
 * Plan-level divergence analysis.
 */
saasBillingReconciliationSchema.index(
  {
    tenantId: 1,
    'context.planCode': 1,
    status: 1,
    createdAt: -1,
  },
  {
    name: 'ix_saas_reconciliation_plan_status',
  },
);

/**
 * Cut-over analysis.
 */
saasBillingReconciliationSchema.index(
  {
    tenantId: 1,
    'cutover.status': 1,
    createdAt: -1,
  },
  {
    name: 'ix_saas_reconciliation_cutover',
  },
);

/**
 * Execution linkage.
 */
saasBillingReconciliationSchema.index(
  {
    executionId: 1,
  },
  {
    sparse: true,
    name: 'ix_saas_reconciliation_execution',
  },
);

/**
 * TTL retention.
 */
saasBillingReconciliationSchema.index(
  {
    expiresAt: 1,
  },
  {
    expireAfterSeconds: 0,
    name: 'ttl_saas_reconciliation_expiry',
  },
);

/**
 * ============================================================================
 * VALIDATION GUARDS
 * ============================================================================
 *
 * These guards prevent a reconciliation record from accidentally becoming
 * evidence that the shadow engine was authoritative.
 * ============================================================================
 */

saasBillingReconciliationSchema.pre(
  'validate',
  function validateShadowReconciliation(next) {
    if (this.shadowMode !== true) {
      return next(
        new Error(
          'Stage 01d SaaS billing reconciliation must operate in shadowMode.',
        ),
      );
    }

    if (this.authoritativeWritePerformed === true) {
      return next(
        new Error(
          'Stage 01d reconciliation cannot record an authoritative billing write.',
        ),
      );
    }

    if (
      this.exactMatch === true &&
      this.withinTolerance === false &&
      this.status !== RECONCILIATION_STATUS.MATCHED
    ) {
      return next(
        new Error(
          'An exact reconciliation match must be marked within tolerance and matched.',
        ),
      );
    }

    if (
      this.status === RECONCILIATION_STATUS.MATCHED &&
      this.classification !== MATCH_CLASSIFICATION.EXACT_MATCH
    ) {
      return next(
        new Error(
          'Matched reconciliation records must use exact_match classification.',
        ),
      );
    }

    if (
      this.status === RECONCILIATION_STATUS.MATCHED_WITHIN_TOLERANCE &&
      this.classification !== MATCH_CLASSIFICATION.TOLERANCE_MATCH
    ) {
      return next(
        new Error(
          'Tolerance matches must use tolerance_match classification.',
        ),
      );
    }

    if (this.differenceCount !== this.differences.length) {
      this.differenceCount = this.differences.length;
    }

    this.materialDifferenceCount = this.differences.filter(
      (difference) =>
        difference &&
        difference.material === true &&
        difference.ignoredForCutover !== true,
    ).length;

    return next();
  },
);

/**
 * ============================================================================
 * INSTANCE HELPERS
 * ============================================================================
 */

saasBillingReconciliationSchema.methods.markExactMatch =
  function markExactMatch() {
    this.status = RECONCILIATION_STATUS.MATCHED;
    this.classification = MATCH_CLASSIFICATION.EXACT_MATCH;
    this.severity = SEVERITY.NONE;
    this.exactMatch = true;
    this.withinTolerance = true;

    this.cutover = {
      ...(this.cutover?.toObject?.() || this.cutover || {}),
      status: CUTOVER_STATUS.ELIGIBLE,
      eligible: true,
      blocked: false,
      requiredReview: false,
      evaluatedAt: new Date(),
    };

    return this;
  };

saasBillingReconciliationSchema.methods.markToleranceMatch =
  function markToleranceMatch() {
    this.status = RECONCILIATION_STATUS.MATCHED_WITHIN_TOLERANCE;
    this.classification = MATCH_CLASSIFICATION.TOLERANCE_MATCH;
    this.severity = SEVERITY.LOW;
    this.exactMatch = false;
    this.withinTolerance = true;

    return this;
  };

saasBillingReconciliationSchema.methods.markDivergence =
  function markDivergence({
    classification = MATCH_CLASSIFICATION.UNKNOWN_DIVERGENCE,
    severity = SEVERITY.MEDIUM,
  } = {}) {
    this.status = RECONCILIATION_STATUS.DIVERGED;
    this.classification = classification;
    this.severity = severity;
    this.exactMatch = false;

    if (!this.withinTolerance) {
      this.cutover = {
        ...(this.cutover?.toObject?.() || this.cutover || {}),
        status: CUTOVER_STATUS.BLOCKED,
        eligible: false,
        blocked: true,
        requiredReview: severity === SEVERITY.HIGH ||
          severity === SEVERITY.CRITICAL,
        evaluatedAt: new Date(),
      };
    }

    return this;
  };

saasBillingReconciliationSchema.methods.markInconclusive =
  function markInconclusive(reason = {}) {
    this.status = RECONCILIATION_STATUS.INCONCLUSIVE;
    this.classification = MATCH_CLASSIFICATION.UNKNOWN_DIVERGENCE;
    this.severity = SEVERITY.MEDIUM;
    this.exactMatch = false;
    this.withinTolerance = false;

    this.failure = reason;

    this.cutover = {
      ...(this.cutover?.toObject?.() || this.cutover || {}),
      status: CUTOVER_STATUS.REVIEW_REQUIRED,
      eligible: false,
      blocked: true,
      requiredReview: true,
      evaluatedAt: new Date(),
    };

    return this;
  };

saasBillingReconciliationSchema.methods.addDifference =
  function addDifference(difference) {
    if (!difference || !difference.path || !difference.type) {
      throw new TypeError(
        'A reconciliation difference requires path and type.',
      );
    }

    this.differences.push(difference);

    this.differenceCount = this.differences.length;

    if (
      difference.material === true &&
      difference.ignoredForCutover !== true
    ) {
      this.materialDifferenceCount += 1;
    }

    return this;
  };

/**
 * ============================================================================
 * STATIC HELPERS
 * ============================================================================
 */

saasBillingReconciliationSchema.statics.isTerminalStatus =
  function isTerminalStatus(status) {
    return [
      RECONCILIATION_STATUS.MATCHED,
      RECONCILIATION_STATUS.MATCHED_WITHIN_TOLERANCE,
      RECONCILIATION_STATUS.DIVERGED,
      RECONCILIATION_STATUS.INCONCLUSIVE,
      RECONCILIATION_STATUS.FAILED,
      RECONCILIATION_STATUS.SKIPPED,
    ].includes(status);
  };

saasBillingReconciliationSchema.statics.isCutoverEligible =
  function isCutoverEligible(document) {
    if (!document) {
      return false;
    }

    return (
      document.shadowMode === true &&
      document.authoritativeWritePerformed === false &&
      document.status !== RECONCILIATION_STATUS.DIVERGED &&
      document.status !== RECONCILIATION_STATUS.FAILED &&
      document.status !== RECONCILIATION_STATUS.INCONCLUSIVE &&
      document.cutover?.eligible === true
    );
  };

/**
 * ============================================================================
 * ENUM EXPORTS
 * ============================================================================
 */

saasBillingReconciliationSchema.statics.RECONCILIATION_STATUS =
  RECONCILIATION_STATUS;

saasBillingReconciliationSchema.statics.MATCH_CLASSIFICATION =
  MATCH_CLASSIFICATION;

saasBillingReconciliationSchema.statics.SEVERITY = SEVERITY;

saasBillingReconciliationSchema.statics.CUTOVER_STATUS = CUTOVER_STATUS;

saasBillingReconciliationSchema.statics.DIFFERENCE_TYPE = DIFFERENCE_TYPE;

saasBillingReconciliationSchema.statics.ENGINE_NAME = ENGINE_NAME;

saasBillingReconciliationSchema.statics.BILLING_OPERATION =
  BILLING_OPERATION;

saasBillingReconciliationSchema.statics.RECONCILIATION_VERSION =
  RECONCILIATION_VERSION;

/**
 * ============================================================================
 * MODEL
 * ============================================================================
 */

const SaasBillingReconciliation =
  mongoose.models[MODEL_NAME] ||
  mongoose.model(
    MODEL_NAME,
    saasBillingReconciliationSchema,
  );

module.exports = SaasBillingReconciliation;

module.exports.MODEL_NAME = MODEL_NAME;
module.exports.RECONCILIATION_STATUS = RECONCILIATION_STATUS;
module.exports.MATCH_CLASSIFICATION = MATCH_CLASSIFICATION;
module.exports.SEVERITY = SEVERITY;
module.exports.CUTOVER_STATUS = CUTOVER_STATUS;
module.exports.DIFFERENCE_TYPE = DIFFERENCE_TYPE;
module.exports.ENGINE_NAME = ENGINE_NAME;
module.exports.BILLING_OPERATION = BILLING_OPERATION;
module.exports.RECONCILIATION_VERSION = RECONCILIATION_VERSION;