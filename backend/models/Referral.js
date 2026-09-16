/**
 * backend/models/Referral.js
 * TITech Community Capital — Referral Aggregate
 *
 * Architectural role:
 * - Represents referral attribution, eligibility, anti-abuse assessment,
 *   reward qualification, reward issuance state, and referral lifecycle.
 * - Maintains the business relationship between referrer and referee.
 * - Provides an idempotent hand-off boundary to the financial transaction
 *   and double-entry ledger infrastructure for monetary rewards.
 *
 * Referral flow:
 *
 * Referrer
 *    ↓
 * Referral Code
 *    ↓
 * Referred User
 *    ↓
 * Verification / Eligibility
 *    ↓
 * Contribution / Qualification
 *    ↓
 * Fraud / Abuse Assessment
 *    ↓
 * Reward Qualification
 *    ↓
 * Reward Issuance Service
 *    ↓
 * Transaction / Double-Entry Ledger
 *
 * IMPORTANT FINANCIAL BOUNDARY:
 * - Referral is NOT an account.
 * - Referral is NOT a wallet.
 * - Referral is NOT the authoritative ledger.
 * - Referral MUST NOT directly mutate balances.
 * - Referral reward issuance must be performed through the canonical
 *   FinancialTransactionService / ledger infrastructure using the persisted
 *   rewardIdempotencyKey.
 *
 * Important boundaries:
 * - Fraud detection here is limited to persistence-friendly signal evaluation.
 * - Final fraud adjudication and risk policy belong to the fraud/risk service.
 * - Referral authorization belongs to the service/policy layer.
 * - Contribution verification belongs to the contribution/member domain service.
 * - Reward financial issuance belongs to the financial transaction service.
 * - Message/notification delivery belongs to notification services.
 * - Audit history belongs to MessageAudit/AuditLog or the referral audit layer.
 *
 * Security principles:
 * - Native ESM only.
 * - Tenant-aware persistence.
 * - Referral-code uniqueness is tenant-scoped.
 * - Monetary values use Decimal128.
 * - No JavaScript Number arithmetic for authoritative monetary validation.
 * - Reward idempotency is explicit and database-protected.
 * - Device/IP/email correlation data is stored only as application-generated
 *   hashes or privacy-safe fingerprints.
 * - Fraud evidence is bounded and sensitive values are excluded from normal
 *   serialization.
 * - Generic destructive/mutation operations are blocked.
 * - Optimistic concurrency is enabled.
 * - Issued rewards cannot be silently converted back to unissued state.
 *
 * Module format:
 * - Native ECMAScript Modules (ESM)
 *
 * Collection:
 * - referrals
 */

import crypto from 'node:crypto';
import mongoose from 'mongoose';

const { Schema } = mongoose;

/* ==========================================================================
 * Constants
 * ========================================================================== */

export const REFERRAL_STATUSES = Object.freeze([
  'PENDING',
  'ELIGIBLE',
  'COMPLETED',
  'EXPIRED',
  'FRAUD_REVIEW',
  'FRAUDULENT',
  'CANCELLED',
]);

export const REWARD_TYPES = Object.freeze([
  'BONUS_CREDIT',
  'CASH',
  'POINTS',
  'SAVINGS_BOOST',
]);

export const REWARD_STATUSES = Object.freeze([
  'NOT_ELIGIBLE',
  'ELIGIBLE',
  'PENDING',
  'PROCESSING',
  'ISSUED',
  'FAILED',
  'CANCELLED',
]);

export const FRAUD_SEVERITIES = Object.freeze([
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
]);

export const FRAUD_REVIEW_STATUSES =
  Object.freeze([
    'NOT_REVIEWED',
    'PENDING',
    'UNDER_REVIEW',
    'CLEARED',
    'CONFIRMED',
  ]);

export const REFERRAL_FRAUD_SIGNAL_TYPES =
  Object.freeze([
    'SAME_DEVICE',
    'SAME_IP',
    'SAME_EMAIL_DOMAIN',
    'SUSPICIOUS_TIMING',
    'MULTIPLE_ACCOUNTS',
    'REPEATED_REFERRAL_PATTERN',
    'OTHER',
  ]);

const MAX_CODE_LENGTH = 128;
const MAX_REASON_LENGTH = 2_000;
const MAX_SOURCE_LENGTH = 128;
const MAX_CAMPAIGN_ID_LENGTH = 256;
const MAX_SIGNAL_DETAILS_LENGTH = 2_000;
const MAX_FRAUD_SIGNALS = 50;
const MAX_FRAUD_SCORE = 100;
const MAX_METADATA_EXTRA_DEPTH = 4;
const MAX_METADATA_EXTRA_KEYS = 50;
const MAX_METADATA_EXTRA_ARRAY_LENGTH = 50;
const MAX_FINGERPRINT_LENGTH = 256;
const MAX_LANDING_PAGE_LENGTH = 2_048;
const MAX_USER_AGENT_LENGTH = 1_024;
const MAX_DEVICE_TYPE_LENGTH = 64;
const MAX_PLATFORM_LENGTH = 64;
const MAX_LOCALE_LENGTH = 32;
const MAX_REWARD_IDEMPOTENCY_KEY_LENGTH = 256;

const ZERO_DECIMAL =
  mongoose.Types.Decimal128.fromString(
    '0',
  );

const MINIMUM_INTENT_REWARD_AMOUNT =
  mongoose.Types.Decimal128.fromString(
    '0.00',
  );

const REFERRAL_STATUS_TRANSITIONS =
  Object.freeze({
    PENDING: new Set([
      'ELIGIBLE',
      'FRAUD_REVIEW',
      'EXPIRED',
      'CANCELLED',
      'COMPLETED',
    ]),

    ELIGIBLE: new Set([
      'COMPLETED',
      'FRAUD_REVIEW',
      'EXPIRED',
      'CANCELLED',
    ]),

    COMPLETED: new Set([
      'FRAUD_REVIEW',
    ]),

    FRAUD_REVIEW: new Set([
      'PENDING',
      'ELIGIBLE',
      'COMPLETED',
      'FRAUDULENT',
      'CANCELLED',
    ]),

    FRAUDULENT: new Set([]),

    EXPIRED: new Set([]),

    CANCELLED: new Set([]),
  });

const REWARD_STATUS_TRANSITIONS =
  Object.freeze({
    NOT_ELIGIBLE: new Set([
      'ELIGIBLE',
    ]),

    ELIGIBLE: new Set([
      'PENDING',
      'CANCELLED',
    ]),

    PENDING: new Set([
      'PROCESSING',
      'CANCELLED',
    ]),

    PROCESSING: new Set([
      'ISSUED',
      'FAILED',
      'CANCELLED',
    ]),

    FAILED: new Set([
      'PENDING',
      'CANCELLED',
    ]),

    ISSUED: new Set([]),

    CANCELLED: new Set([]),
  });

/* ==========================================================================
 * Decimal helpers
 * ========================================================================== */

/**
 * Decimal128 must remain a decimal-domain value.
 *
 * No Number conversion is used for authoritative reward comparisons.
 */
function parseDecimal(value, fieldName) {
  if (
    value === undefined ||
    value === null
  ) {
    throw new TypeError(
      `${fieldName} is required.`,
    );
  }

  const raw =
    value instanceof mongoose.Types.Decimal128
      ? value.toString()
      : String(value).trim();

  if (
    !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(
      raw,
    )
  ) {
    throw new TypeError(
      `${fieldName} must be a non-negative decimal amount.`,
    );
  }

  const [integerPart, fractionPart = ''] =
    raw.split('.');

  return {
    coefficient: BigInt(
      `${integerPart}${fractionPart}`,
    ),
    scale: fractionPart.length,
  };
}

function compareDecimals(left, right) {
  const leftValue =
    parseDecimal(left, 'left');

  const rightValue =
    parseDecimal(right, 'right');

  const scale = Math.max(
    leftValue.scale,
    rightValue.scale,
  );

  const leftCoefficient =
    leftValue.coefficient *
    10n **
      BigInt(
        scale -
          leftValue.scale,
      );

  const rightCoefficient =
    rightValue.coefficient *
    10n **
      BigInt(
        scale -
          rightValue.scale,
      );

  if (
    leftCoefficient <
    rightCoefficient
  ) {
    return -1;
  }

  if (
    leftCoefficient >
    rightCoefficient
  ) {
    return 1;
  }

  return 0;
}

function isNonNegativeDecimal(
  value,
) {
  try {
    parseDecimal(
      value,
      'amount',
    );

    return true;
  } catch {
    return false;
  }
}

function isPositiveDecimal(
  value,
) {
  try {
    return (
      compareDecimals(
        value,
        ZERO_DECIMAL,
      ) > 0
    );
  } catch {
    return false;
  }
}

/* ==========================================================================
 * Normalization helpers
 * ========================================================================== */

function normalizeTenantId(value) {
  if (
    value === undefined ||
    value === null
  ) {
    throw new TypeError(
      'tenantId is required.',
    );
  }

  const normalized =
    String(value).trim();

  if (!normalized) {
    throw new TypeError(
      'tenantId is required.',
    );
  }

  return normalized;
}

function normalizeRequiredString(
  value,
  fieldName,
  maxLength,
) {
  if (
    value === undefined ||
    value === null
  ) {
    throw new TypeError(
      `${fieldName} is required.`,
    );
  }

  const normalized =
    String(value).trim();

  if (!normalized) {
    throw new TypeError(
      `${fieldName} is required.`,
    );
  }

  if (
    normalized.length >
    maxLength
  ) {
    throw new RangeError(
      `${fieldName} exceeds the maximum length of ${maxLength}.`,
    );
  }

  return normalized;
}

function normalizeNullableString(
  value,
  maxLength,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const normalized =
    String(value).trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(
    0,
    maxLength,
  );
}

function normalizeObjectId(
  value,
  fieldName,
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }

  if (
    !mongoose.isValidObjectId(
      value,
    )
  ) {
    throw new TypeError(
      `${fieldName} must be a valid ObjectId.`,
    );
  }

  return new mongoose.Types.ObjectId(
    value,
  );
}

function normalizeScore(value) {
  const numeric =
    Number(value ?? 0);

  if (!Number.isFinite(numeric)) {
    throw new TypeError(
      'Fraud score must be numeric.',
    );
  }

  return Math.min(
    MAX_FRAUD_SCORE,
    Math.max(
      0,
      Math.round(numeric),
    ),
  );
}

function normalizeDate(
  value,
  fieldName,
) {
  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    throw new TypeError(
      `${fieldName} must be a valid date.`,
    );
  }

  return date;
}

/* ==========================================================================
 * Metadata helpers
 * ========================================================================== */

const SENSITIVE_KEY_FRAGMENTS =
  Object.freeze([
    'password',
    'passwd',
    'passcode',
    'pin',
    'otp',
    'totp',
    'secret',
    'access_token',
    'accesstoken',
    'refresh_token',
    'refreshtoken',
    'authorization',
    'cookie',
    'set-cookie',
    'private_key',
    'privatekey',
    'api_key',
    'apikey',
    'cvv',
    'pan',
  ]);

function isSensitiveKey(key) {
  const normalized =
    String(key)
      .trim()
      .toLowerCase()
      .replace(/[\s-]/g, '');

  return SENSITIVE_KEY_FRAGMENTS.some(
    (fragment) =>
      normalized.includes(
        fragment.replace(
          /[_-]/g,
          '',
        ),
      ),
  );
}

function sanitizeMetadata(
  value,
  depth = 0,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return {};
  }

  if (
    depth > MAX_METADATA_EXTRA_DEPTH
  ) {
    return '[TRUNCATED]';
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (
    value instanceof Date
  ) {
    return value.toISOString();
  }

  if (
    typeof value === 'bigint'
  ) {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value
      .slice(
        0,
        MAX_METADATA_EXTRA_ARRAY_LENGTH,
      )
      .map((item) =>
        sanitizeMetadata(
          item,
          depth + 1,
        ),
      );
  }

  if (
    typeof value === 'object'
  ) {
    const output = {};

    const entries =
      Object.entries(value).slice(
        0,
        MAX_METADATA_EXTRA_KEYS,
      );

    for (
      const [key, childValue]
        of entries
    ) {
      output[key] =
        isSensitiveKey(key)
          ? '[REDACTED]'
          : sanitizeMetadata(
              childValue,
              depth + 1,
            );
    }

    return output;
  }

  return `[UNSERIALIZABLE:${typeof value}]`;
}

/* ==========================================================================
 * Money schema
 * ========================================================================== */

const MoneySchema =
  new Schema(
    {
      amount: {
        type: Schema.Types.Decimal128,
        required: true,
      },

      currency: {
        type: String,
        required: true,
        uppercase: true,
        trim: true,
        minlength: 3,
        maxlength: 10,
      },
    },
    {
      _id: false,
      id: false,
      strict: 'throw',
    },
  );

/* ==========================================================================
 * Fraud signal schema
 * ========================================================================== */

const FraudSignalSchema =
  new Schema(
    {
      type: {
        type: String,
        required: true,
        trim: true,
        uppercase: true,
        maxlength: 128,
      },

      severity: {
        type: String,
        enum: FRAUD_SEVERITIES,
        default: 'MEDIUM',
        uppercase: true,
      },

      score: {
        type: Number,
        min: 0,
        max: MAX_FRAUD_SCORE,
        default: 0,
      },

      detectedAt: {
        type: Date,
        default: Date.now,
      },

      details: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_SIGNAL_DETAILS_LENGTH,
      },
    },
    {
      _id: false,
      id: false,
      strict: 'throw',
    },
  );

/* ==========================================================================
 * Referral schema
 * ========================================================================== */

const ReferralSchema =
  new Schema(
    {
      /*
       * ----------------------------------------------------------------------
       * Tenant
       * ----------------------------------------------------------------------
       */

      tenantId: {
        type: String,
        required: true,
        immutable: true,
        trim: true,
        maxlength: 128,
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * Participants
       * ----------------------------------------------------------------------
       */

      referrer: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        immutable: true,
        index: true,
      },

      referee: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        immutable: true,
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * Referral code
       * ----------------------------------------------------------------------
       */

      referralCode: {
        type: String,
        required: true,
        immutable: true,
        trim: true,
        uppercase: true,
        minlength: 8,
        maxlength: MAX_CODE_LENGTH,
      },

      /*
       * ----------------------------------------------------------------------
       * Campaign attribution
       * ----------------------------------------------------------------------
       */

      campaignId: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_CAMPAIGN_ID_LENGTH,
        index: true,
      },

      referralSource: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_SOURCE_LENGTH,
      },

      attribution: {
        channel: {
          type: String,
          default: null,
          trim: true,
          maxlength: 128,
        },

        medium: {
          type: String,
          default: null,
          trim: true,
          maxlength: 128,
        },

        source: {
          type: String,
          default: null,
          trim: true,
          maxlength: 128,
        },

        campaign: {
          type: String,
          default: null,
          trim: true,
          maxlength:
            MAX_CAMPAIGN_ID_LENGTH,
        },
      },

      createdAtSource: {
        type: String,
        default: null,
        trim: true,
        maxlength: 128,
      },

      /*
       * ----------------------------------------------------------------------
       * Lifecycle
       * ----------------------------------------------------------------------
       */

      status: {
        type: String,
        enum: REFERRAL_STATUSES,
        required: true,
        default: 'PENDING',
        uppercase: true,
        trim: true,
        index: true,
      },

      completedAt: {
        type: Date,
        default: null,
      },

      expiredAt: {
        type: Date,
        default: null,
      },

      cancelledAt: {
        type: Date,
        default: null,
      },

      cancellationReason: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_REASON_LENGTH,
      },

      /*
       * ----------------------------------------------------------------------
       * Qualification
       * ----------------------------------------------------------------------
       */

      emailVerified: {
        type: Boolean,
        default: false,
        index: true,
      },

      firstContributionAt: {
        type: Date,
        default: null,
      },

      eligibility: {
        qualified: {
          type: Boolean,
          default: false,
          index: true,
        },

        qualifiedAt: {
          type: Date,
          default: null,
        },

        reason: {
          type: String,
          default: null,
          trim: true,
          maxlength:
            MAX_REASON_LENGTH,
        },

        contributionRequired: {
          type: Boolean,
          default: true,
        },

        minimumContribution: {
          type: MoneySchema,
          default: null,
        },
      },

      /*
       * ----------------------------------------------------------------------
       * Reward configuration
       * ----------------------------------------------------------------------
       */

      rewardAmount: {
        type: Schema.Types.Decimal128,
        default: () =>
          mongoose.Types.Decimal128.fromString(
            '0.00',
          ),
      },

      rewardCurrency: {
        type: String,
        required: true,
        default: 'UGX',
        uppercase: true,
        trim: true,
        minlength: 3,
        maxlength: 10,
      },

      rewardType: {
        type: String,
        enum: REWARD_TYPES,
        required: true,
        default: 'BONUS_CREDIT',
        uppercase: true,
        trim: true,
      },

      rewardStatus: {
        type: String,
        enum: REWARD_STATUSES,
        required: true,
        default: 'NOT_ELIGIBLE',
        uppercase: true,
        trim: true,
        index: true,
      },

      rewardIssued: {
        type: Boolean,
        required: true,
        default: false,
        index: true,
      },

      rewardIssuedAt: {
        type: Date,
        default: null,
      },

      rewardFailedAt: {
        type: Date,
        default: null,
      },

      rewardFailureReason: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_REASON_LENGTH,
      },

      rewardIdempotencyKey: {
        type: String,
        default: null,
        immutable: true,
        trim: true,
        maxlength:
          MAX_REWARD_IDEMPOTENCY_KEY_LENGTH,
        index: true,
        select: false,
      },

      rewardTransactionId: {
        type: Schema.Types.ObjectId,
        ref: 'Transaction',
        default: null,
      },

      rewardLedgerEntryId: {
        type: Schema.Types.ObjectId,
        ref: 'LedgerEntry',
        default: null,
      },

      /*
       * ----------------------------------------------------------------------
       * Fraud/risk state
       * ----------------------------------------------------------------------
       */

      fraud: {
        isFlagged: {
          type: Boolean,
          default: false,
          index: true,
        },

        score: {
          type: Number,
          min: 0,
          max: MAX_FRAUD_SCORE,
          default: 0,
          index: true,
        },

        severity: {
          type: String,
          enum: FRAUD_SEVERITIES,
          default: 'LOW',
          uppercase: true,
        },

        reviewStatus: {
          type: String,
          enum: FRAUD_REVIEW_STATUSES,
          default: 'NOT_REVIEWED',
          uppercase: true,
          index: true,
        },

        flagReason: {
          type: String,
          default: null,
          trim: true,
          maxlength:
            MAX_REASON_LENGTH,
        },

        flaggedAt: {
          type: Date,
          default: null,
        },

        flaggedBy: {
          type: Schema.Types.ObjectId,
          ref: 'User',
          default: null,
        },

        reviewedAt: {
          type: Date,
          default: null,
        },

        reviewedBy: {
          type: Schema.Types.ObjectId,
          ref: 'User',
          default: null,
        },

        reviewNote: {
          type: String,
          default: null,
          trim: true,
          maxlength:
            MAX_REASON_LENGTH,
        },

        signals: {
          type: [FraudSignalSchema],
          default: undefined,
          validate: {
            validator(value) {
              return (
                value.length <=
                MAX_FRAUD_SIGNALS
              );
            },
            message:
              `A referral cannot contain more than ${MAX_FRAUD_SIGNALS} fraud signals.`,
          },
        },

        /*
         * Privacy-safe correlation values.
         */
        referrerDeviceHash: {
          type: String,
          default: null,
          trim: true,
          maxlength:
            MAX_FINGERPRINT_LENGTH,
          select: false,
        },

        refereeDeviceHash: {
          type: String,
          default: null,
          trim: true,
          maxlength:
            MAX_FINGERPRINT_LENGTH,
          select: false,
        },

        sameDeviceDetected: {
          type: Boolean,
          default: false,
        },

        referrerIPHash: {
          type: String,
          default: null,
          trim: true,
          maxlength:
            MAX_FINGERPRINT_LENGTH,
          select: false,
        },

        refereeIPHash: {
          type: String,
          default: null,
          trim: true,
          maxlength:
            MAX_FINGERPRINT_LENGTH,
          select: false,
        },

        sameIPDetected: {
          type: Boolean,
          default: false,
        },

        /*
         * These should be hashes generated specifically for correlation.
         * Do not store raw email addresses here.
         */
        referrerEmailDomainHash: {
          type: String,
          default: null,
          trim: true,
          maxlength:
            MAX_FINGERPRINT_LENGTH,
          select: false,
        },

        refereeEmailDomainHash: {
          type: String,
          default: null,
          trim: true,
          maxlength:
            MAX_FINGERPRINT_LENGTH,
          select: false,
        },

        sameEmailDomainDetected: {
          type: Boolean,
          default: false,
        },

        timeBetweenSignupsMs: {
          type: Number,
          min: 0,
          default: null,
        },

        suspiciousTiming: {
          type: Boolean,
          default: false,
        },

        riskEvaluatedAt: {
          type: Date,
          default: null,
        },

        riskModelVersion: {
          type: String,
          default: null,
          trim: true,
          maxlength: 128,
        },
      },

      /*
       * ----------------------------------------------------------------------
       * Client / attribution metadata
       * ----------------------------------------------------------------------
       */

      metadata: {
        referrerUserAgentHash: {
          type: String,
          default: null,
          trim: true,
          maxlength:
            MAX_FINGERPRINT_LENGTH,
          select: false,
        },

        refereeUserAgentHash: {
          type: String,
          default: null,
          trim: true,
          maxlength:
            MAX_FINGERPRINT_LENGTH,
          select: false,
        },

        landingPage: {
          type: String,
          default: null,
          trim: true,
          maxlength:
            MAX_LANDING_PAGE_LENGTH,
        },

        deviceType: {
          type: String,
          default: null,
          trim: true,
          maxlength:
            MAX_DEVICE_TYPE_LENGTH,
        },

        platform: {
          type: String,
          default: null,
          trim: true,
          maxlength:
            MAX_PLATFORM_LENGTH,
        },

        locale: {
          type: String,
          default: null,
          trim: true,
          maxlength:
            MAX_LOCALE_LENGTH,
        },

        extra: {
          type: Schema.Types.Mixed,
          default: undefined,
          select: false,
        },
      },

      /*
       * ----------------------------------------------------------------------
       * Expiration
       * ----------------------------------------------------------------------
       *
       * Retained as business lifecycle data. Automated physical deletion
       * should be an explicit retention-policy decision.
       */

      expiresAt: {
        type: Date,
        required: true,
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * Provenance
       * ----------------------------------------------------------------------
       */

      createdBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null,
        immutable: true,
      },

      updatedBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null,
      },

      /*
       * ----------------------------------------------------------------------
       * Administrative state
       * ----------------------------------------------------------------------
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

      deletedBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null,
      },

      deleteReason: {
        type: String,
        default: null,
        trim: true,
        maxlength:
          MAX_REASON_LENGTH,
      },
    },
    {
      timestamps: true,

      optimisticConcurrency: true,

      versionKey: '__v',

      collection: 'referrals',

      strict: 'throw',

      minimize: true,

      toJSON: {
        virtuals: true,
        versionKey: false,

        transform(doc, ret) {
          ret.id =
            ret._id.toString();

          delete ret._id;
          delete ret.__v;

          delete ret.rewardIdempotencyKey;

          if (ret.fraud) {
            delete ret.fraud
              .referrerDeviceHash;

            delete ret.fraud
              .refereeDeviceHash;

            delete ret.fraud
              .referrerIPHash;

            delete ret.fraud
              .refereeIPHash;

            delete ret.fraud
              .referrerEmailDomainHash;

            delete ret.fraud
              .refereeEmailDomainHash;
          }

          if (ret.metadata) {
            delete ret.metadata
              .referrerUserAgentHash;

            delete ret.metadata
              .refereeUserAgentHash;

            delete ret.metadata.extra;
          }

          if (
            ret.rewardAmount
          ) {
            ret.rewardAmount =
              ret.rewardAmount.toString();
          }

          if (
            ret.eligibility
              ?.minimumContribution
              ?.amount
          ) {
            ret.eligibility
              .minimumContribution
              .amount =
              ret.eligibility
                .minimumContribution
                .amount
                .toString();
          }

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
 * Referral-code uniqueness is tenant-scoped.
 */
ReferralSchema.index(
  {
    tenantId: 1,
    referralCode: 1,
  },
  {
    unique: true,
    name:
      'uniq_tenant_referral_code',
  },
);

/**
 * One active attribution for a referee inside a tenant.
 */
ReferralSchema.index(
  {
    tenantId: 1,
    referee: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      isDeleted: false,
    },
    name:
      'uniq_active_referral_referee',
  },
);

/**
 * Referrer referral history.
 */
ReferralSchema.index({
  tenantId: 1,
  referrer: 1,
  status: 1,
  createdAt: -1,
  _id: -1,
});

/**
 * Pending/qualification processing.
 */
ReferralSchema.index({
  tenantId: 1,
  status: 1,
  expiresAt: 1,
});

/**
 * Reward processing queue.
 */
ReferralSchema.index({
  tenantId: 1,
  rewardStatus: 1,
  createdAt: -1,
  _id: -1,
});

/**
 * Fraud review queue.
 */
ReferralSchema.index({
  tenantId: 1,
  'fraud.isFlagged': 1,
  'fraud.reviewStatus': 1,
  createdAt: -1,
});

/**
 * Campaign analytics.
 */
ReferralSchema.index({
  tenantId: 1,
  campaignId: 1,
  status: 1,
  createdAt: -1,
});

/**
 * Reward financial linkage.
 */
ReferralSchema.index({
  tenantId: 1,
  rewardTransactionId: 1,
});

ReferralSchema.index({
  tenantId: 1,
  rewardLedgerEntryId: 1,
});

/**
 * Reward idempotency must be tenant-scoped.
 */
ReferralSchema.index(
  {
    tenantId: 1,
    rewardIdempotencyKey: 1,
  },
  {
    unique: true,
    sparse: true,
    name:
      'uniq_tenant_reward_idempotency',
  },
);

/**
 * Risk investigation.
 */
ReferralSchema.index({
  tenantId: 1,
  'fraud.score': -1,
  createdAt: -1,
});

/**
 * Expiration processing.
 */
ReferralSchema.index({
  tenantId: 1,
  expiresAt: 1,
  status: 1,
});

/* ==========================================================================
 * Virtuals
 * ========================================================================== */

ReferralSchema.virtual(
  'hasFraudSignals',
).get(function getHasFraudSignals() {
  return (
    Array.isArray(
      this.fraud?.signals,
    ) &&
    this.fraud.signals.length > 0
  );
});

ReferralSchema.virtual(
  'isExpired',
).get(function getIsExpired() {
  return (
    this.status === 'EXPIRED' ||
    (
      this.expiresAt instanceof Date &&
      this.expiresAt.getTime() <=
        Date.now() &&
      ![
        'COMPLETED',
        'FRAUDULENT',
        'CANCELLED',
      ].includes(this.status)
    )
  );
});

ReferralSchema.virtual(
  'canReceiveReward',
).get(function getCanReceiveReward() {
  return (
    this.status === 'COMPLETED' &&
    this.eligibility
      ?.qualified === true &&
    this.fraud
      ?.isFlagged !== true &&
    this.rewardIssued !== true &&
    this.rewardStatus !==
      'ISSUED'
  );
});

ReferralSchema.virtual(
  'rewardPrepared',
).get(function getRewardPrepared() {
  return Boolean(
    this.rewardIdempotencyKey,
  );
});

/* ==========================================================================
 * Query helpers
 * ========================================================================== */

ReferralSchema.query.active =
  function active() {
    return this.where({
      isDeleted: false,
    });
  };

ReferralSchema.query.pending =
  function pending() {
    return this.where({
      status: {
        $in: [
          'PENDING',
          'ELIGIBLE',
        ],
      },
      isDeleted: false,
      expiresAt: {
        $gt: new Date(),
      },
    });
  };

ReferralSchema.query.withFraudFlags =
  function withFraudFlags() {
    return this.where({
      'fraud.isFlagged': true,
      isDeleted: false,
    });
  };

ReferralSchema.query.needingReward =
  function needingReward() {
    return this.where({
      status: 'COMPLETED',
      eligibility: {
        $exists: true,
      },
      rewardStatus: {
        $in: [
          'ELIGIBLE',
          'PENDING',
          'PROCESSING',
          'FAILED',
        ],
      },
      rewardIssued: false,
      isDeleted: false,
    });
  };

ReferralSchema.query.forTenant =
  function forTenant(
    tenantId,
  ) {
    return this.where({
      tenantId:
        normalizeTenantId(
          tenantId,
        ),
      isDeleted: false,
    });
  };

/* ==========================================================================
 * Static utility methods
 * ========================================================================== */

/**
 * Generate a cryptographically random referral code.
 *
 * Uniqueness is still enforced by MongoDB's unique tenant+code index.
 */
ReferralSchema.statics.generateReferralCode =
  function generateReferralCode() {
    const randomPart =
      crypto
        .randomBytes(10)
        .toString('hex')
        .toUpperCase();

    return `REF-${randomPart}`;
  };

/**
 * Generate the stable reward idempotency key.
 *
 * This key is intended for the financial service, not for directly mutating
 * balances.
 */
ReferralSchema.statics.generateRewardIdempotencyKey =
  function generateRewardIdempotencyKey(
    referralId,
  ) {
    if (
      !referralId
    ) {
      throw new TypeError(
        'referralId is required.',
      );
    }

    return `referral-reward:${referralId.toString()}`;
  };

/* ==========================================================================
 * Static lookups
 * ========================================================================== */

ReferralSchema.statics.findByCode =
  function findByCode(
    tenantId,
    referralCode,
  ) {
    if (
      !tenantId ||
      !referralCode
    ) {
      return null;
    }

    return this.findOne({
      tenantId:
        normalizeTenantId(
          tenantId,
        ),

      referralCode:
        String(
          referralCode,
        )
          .trim()
          .toUpperCase(),

      isDeleted: false,
    });
  };

ReferralSchema.statics.findActiveForReferee =
  function findActiveForReferee(
    tenantId,
    referee,
  ) {
    return this.findOne({
      tenantId:
        normalizeTenantId(
          tenantId,
        ),

      referee:

        normalizeObjectId(
          referee,
          'referee',
        ),

      isDeleted: false,
    });
  };

ReferralSchema.statics.findByRewardIdempotencyKey =
  function findByRewardIdempotencyKey(
    tenantId,
    rewardIdempotencyKey,
  ) {
    if (
      !tenantId ||
      !rewardIdempotencyKey
    ) {
      return null;
    }

    return this.findOne({
      tenantId:
        normalizeTenantId(
          tenantId,
        ),

      rewardIdempotencyKey:
        String(
          rewardIdempotencyKey,
        ).trim(),

      isDeleted: false,
    }).select(
      '+rewardIdempotencyKey',
    );
  };

ReferralSchema.statics.getPendingForUser =
  function getPendingForUser(
    tenantId,
    referrerId,
  ) {
    return this.find({
      tenantId:
        normalizeTenantId(
          tenantId,
        ),

      referrer:
        normalizeObjectId(
          referrerId,
          'referrerId',
        ),

      status: {
        $in: [
          'PENDING',
          'ELIGIBLE',
        ],
      },

      expiresAt: {
        $gt: new Date(),
      },

      isDeleted: false,
    })
      .populate(
        'referee',
        'name email isVerified',
      )
      .sort({
        createdAt: -1,
        _id: -1,
      });
  };

ReferralSchema.statics.getCompletedForUser =
  function getCompletedForUser(
    tenantId,
    referrerId,
  ) {
    return this.find({
      tenantId:
        normalizeTenantId(
          tenantId,
        ),

      referrer:
        normalizeObjectId(
          referrerId,
          'referrerId',
        ),

      status: 'COMPLETED',

      rewardStatus: 'ISSUED',

      rewardIssued: true,

      isDeleted: false,
    })
      .populate(
        'referee',
        'name email',
      )
      .sort({
        rewardIssuedAt: -1,
        _id: -1,
      });
  };

/**
 * Aggregate issued reward totals without converting Decimal128 to Number.
 */
ReferralSchema.statics.calculateUserRewards =
  async function calculateUserRewards(
    tenantId,
    referrerId,
  ) {
    const result =
      await this.aggregate([
        {
          $match: {
            tenantId:
              normalizeTenantId(
                tenantId,
              ),

            referrer:
              normalizeObjectId(
                referrerId,
                'referrerId',
              ),

            status:
              'COMPLETED',

            rewardStatus:
              'ISSUED',

            rewardIssued:
              true,

            isDeleted:
              false,
          },
        },

        {
          $group: {
            _id: null,

            totalRewards: {
              $sum:
                '$rewardAmount',
            },

            completedCount: {
              $sum: 1,
            },
          },
        },
      ]);

    return (
      result[0] ?? {
        totalRewards:
          mongoose.Types.Decimal128.fromString(
            '0.00',
          ),
        completedCount: 0,
      }
    );
  };

/* ==========================================================================
 * Fraud signal evaluation
 * ========================================================================== */

/**
 * Evaluate available anti-abuse signals.
 *
 * IMPORTANT:
 * - This produces signals and a model score.
 * - It does not establish criminal/fraud intent.
 * - Same IP/device alone is not conclusive.
 * - Final disposition belongs to the fraud/risk service and review process.
 */
ReferralSchema.methods.evaluateFraudSignals =
  async function evaluateFraudSignals({
    persist = true,
    modelVersion = 'referral-default-v1',
  } = {}) {
    const fraud = this.fraud ?? {};
    const signals = [];

    if (
      fraud.referrerDeviceHash &&
      fraud.refereeDeviceHash &&
      fraud.referrerDeviceHash ===
        fraud.refereeDeviceHash
    ) {
      fraud.sameDeviceDetected = true;

      signals.push({
        type: 'SAME_DEVICE',
        severity: 'HIGH',
        score: 45,
        detectedAt:
          new Date(),
        details:
          'Referrer and referee device fingerprints match.',
      });
    }

    if (
      fraud.referrerIPHash &&
      fraud.refereeIPHash &&
      fraud.referrerIPHash ===
        fraud.refereeIPHash
    ) {
      fraud.sameIPDetected = true;

      signals.push({
        type: 'SAME_IP',
        severity: 'MEDIUM',
        score: 20,
        detectedAt:
          new Date(),
        details:
          'Referrer and referee network fingerprints match.',
      });
    }

    if (
      fraud.referrerEmailDomainHash &&
      fraud.refereeEmailDomainHash &&
      fraud.referrerEmailDomainHash ===
        fraud.refereeEmailDomainHash
    ) {
      fraud.sameEmailDomainDetected =
        true;

      signals.push({
        type: 'SAME_EMAIL_DOMAIN',
        severity: 'LOW',
        score: 10,
        detectedAt:
          new Date(),
        details:
          'Referrer and referee email-domain fingerprints match.',
      });
    }

    if (
      typeof fraud.timeBetweenSignupsMs ===
        'number' &&
      fraud.timeBetweenSignupsMs <
        5 * 60 * 1000
    ) {
      fraud.suspiciousTiming =
        true;

      signals.push({
        type: 'SUSPICIOUS_TIMING',
        severity: 'MEDIUM',
        score: 20,
        detectedAt:
          new Date(),
        details:
          'Referral participants were created unusually close together.',
      });
    }

    const score =
      normalizeScore(
        signals.reduce(
          (
            total,
            signal,
          ) =>
            total +
            signal.score,
          0,
        ),
      );

    let severity = 'LOW';

    if (score >= 80) {
      severity = 'CRITICAL';
    } else if (score >= 60) {
      severity = 'HIGH';
    } else if (score >= 30) {
      severity = 'MEDIUM';
    }

    fraud.score = score;
    fraud.severity =
      severity;
    fraud.signals =
      signals.slice(
        0,
        MAX_FRAUD_SIGNALS,
      );
    fraud.riskEvaluatedAt =
      new Date();
    fraud.riskModelVersion =
      modelVersion;

    /**
     * Flag for review rather than permanently declaring fraud merely from
     * correlated signals.
     */
    if (
      score >= 40
    ) {
      fraud.isFlagged = true;
      fraud.reviewStatus =
        'PENDING';
      fraud.flaggedAt ??=
        new Date();

      if (
        this.status !==
          'FRAUDULENT' &&
        this.status !==
          'CANCELLED'
      ) {
        this.status =
          'FRAUD_REVIEW';
      }
    }

    this.fraud =
      fraud;

    if (persist) {
      await this.save();
    }

    return {
      score,
      severity,
      signals:
        fraud.signals,
      flagged:
        fraud.isFlagged,
      reviewStatus:
        fraud.reviewStatus,
      status:
        this.status,
    };
  };

/* ==========================================================================
 * Lifecycle
 * ========================================================================== */

ReferralSchema.methods.canTransitionTo =
  function canTransitionTo(
    targetStatus,
  ) {
    const normalized =
      String(
        targetStatus,
      )
        .trim()
        .toUpperCase();

    return (
      REFERRAL_STATUS_TRANSITIONS[
        this.status
      ]?.has(
        normalized,
      ) ?? false
    );
  };

ReferralSchema.methods.markEligible =
  async function markEligible({
    reason = null,
  } = {}) {
    if (
      this.status ===
      'FRAUDULENT'
    ) {
      throw new Error(
        'Fraudulent referrals cannot become eligible.',
      );
    }

    if (
      this.isExpired
    ) {
      throw new Error(
        'Expired referral cannot become eligible.',
      );
    }

    if (
      !this.canTransitionTo(
        'ELIGIBLE',
      )
    ) {
      throw new Error(
        `Referral cannot transition from ${this.status} to ELIGIBLE.`,
      );
    }

    const now =
      new Date();

    this.status =
      'ELIGIBLE';

    this.eligibility =
      this.eligibility ?? {};

    this.eligibility.qualified =
      true;

    this.eligibility.qualifiedAt =
      this.eligibility
        .qualifiedAt ??
      now;

    this.eligibility.reason =
      normalizeNullableString(
        reason,
        MAX_REASON_LENGTH,
      );

    this.rewardStatus =
      'ELIGIBLE';

    await this.save();

    return this;
  };

ReferralSchema.methods.markCompleted =
  async function markCompleted() {
    if (
      this.status ===
      'FRAUDULENT'
    ) {
      throw new Error(
        'Fraudulent referrals cannot be completed.',
      );
    }

    if (
      this.isExpired
    ) {
      throw new Error(
        'Expired referrals cannot be completed.',
      );
    }

    if (
      !this.canTransitionTo(
        'COMPLETED',
      )
    ) {
      throw new Error(
        `Referral cannot transition from ${this.status} to COMPLETED.`,
      );
    }

    const now =
      new Date();

    this.status =
      'COMPLETED';

    this.completedAt ??=
      now;

    this.eligibility =
      this.eligibility ?? {};

    this.eligibility.qualified =
      true;

    this.eligibility.qualifiedAt ??=
      now;

    if (
      this.rewardStatus !==
      'ISSUED'
    ) {
      this.rewardStatus =
        'ELIGIBLE';
    }

    await this.save();

    return this;
  };

ReferralSchema.methods.markExpired =
  async function markExpired() {
    if (
      [
        'COMPLETED',
        'FRAUDULENT',
        'CANCELLED',
        'EXPIRED',
      ].includes(
        this.status,
      )
    ) {
      return this;
    }

    this.status =
      'EXPIRED';

    this.expiredAt ??=
      new Date();

    if (
      this.rewardStatus !==
      'ISSUED'
    ) {
      this.rewardStatus =
        'NOT_ELIGIBLE';
    }

    await this.save();

    return this;
  };

ReferralSchema.methods.cancel =
  async function cancel({
    reason = null,
  } = {}) {
    if (
      [
        'COMPLETED',
        'FRAUDULENT',
        'CANCELLED',
        'EXPIRED',
      ].includes(
        this.status,
      )
    ) {
      throw new Error(
        `Referral cannot be cancelled from ${this.status}.`,
      );
    }

    this.status =
      'CANCELLED';

    this.cancelledAt =
      new Date();

    this.cancellationReason =
      normalizeNullableString(
        reason,
        MAX_REASON_LENGTH,
      );

    if (
      this.rewardStatus !==
      'ISSUED'
    ) {
      this.rewardStatus =
        'CANCELLED';
    }

    await this.save();

    return this;
  };

/* ==========================================================================
 * Reward lifecycle
 * ========================================================================== */

/**
 * Prepare reward issuance.
 *
 * This only establishes the durable idempotency hand-off.
 * No financial balance is changed here.
 */
ReferralSchema.methods.prepareReward =
  async function prepareReward() {
    if (
      !this.canReceiveReward
    ) {
      throw new Error(
        'Referral is not eligible for reward issuance.',
      );
    }

    if (
      !isNonNegativeDecimal(
        this.rewardAmount,
      )
    ) {
      throw new Error(
        'Invalid referral reward amount.',
      );
    }

    if (
      compareDecimals(
        this.rewardAmount,
        ZERO_DECIMAL,
      ) < 0
    ) {
      throw new Error(
        'Referral reward amount cannot be negative.',
      );
    }

    if (
      !this.rewardIdempotencyKey
    ) {
      this.rewardIdempotencyKey =
        ReferralSchema.statics
          .generateRewardIdempotencyKey(
            this._id,
          );
    }

    if (
      this.rewardStatus !==
      'PENDING'
    ) {
      this.rewardStatus =
        'PENDING';
    }

    await this.save();

    return {
      referralId:
        this._id,

      tenantId:
        this.tenantId,

      referrer:
        this.referrer,

      rewardAmount:
        this.rewardAmount,

      rewardCurrency:
        this.rewardCurrency,

      rewardType:
        this.rewardType,

      idempotencyKey:
        this.rewardIdempotencyKey,
    };
  };

ReferralSchema.methods.markRewardProcessing =
  async function markRewardProcessing() {
    if (
      this.rewardStatus ===
      'ISSUED'
    ) {
      return this;
    }

    if (
      !REWARD_STATUS_TRANSITIONS[
        this.rewardStatus
      ]?.has(
        'PROCESSING',
      )
    ) {
      throw new Error(
        `Reward cannot transition from ${this.rewardStatus} to PROCESSING.`,
      );
    }

    this.rewardStatus =
      'PROCESSING';

    this.rewardFailedAt =
      null;

    this.rewardFailureReason =
      null;

    await this.save();

    return this;
  };

/**
 * Record successful reward issuance.
 *
 * The caller is expected to have already completed the authoritative
 * financial operation through the financial transaction service.
 */
ReferralSchema.methods.markRewardIssued =
  async function markRewardIssued({
    transactionId = null,
    ledgerEntryId = null,
  } = {}) {
    if (
      this.rewardStatus ===
      'ISSUED'
    ) {
      return this;
    }

    if (
      this.status !==
      'COMPLETED'
    ) {
      throw new Error(
        'Referral must be COMPLETED before reward issuance.',
      );
    }

    if (
      ![
        'PENDING',
        'PROCESSING',
      ].includes(
        this.rewardStatus,
      )
    ) {
      throw new Error(
        `Reward cannot be issued from ${this.rewardStatus}.`,
      );
    }

    if (
      !this.rewardIdempotencyKey
    ) {
      throw new Error(
        'Reward idempotency key must exist before reward issuance.',
      );
    }

    const normalizedTransactionId =
      normalizeObjectId(
        transactionId,
        'transactionId',
      );

    const normalizedLedgerEntryId =
      normalizeObjectId(
        ledgerEntryId,
        'ledgerEntryId',
      );

    if (
      !normalizedTransactionId &&
      !normalizedLedgerEntryId
    ) {
      throw new Error(
        'A reward issuance must be linked to a transaction or ledger entry.',
      );
    }

    const now =
      new Date();

    this.rewardStatus =
      'ISSUED';

    this.rewardIssued =
      true;

    this.rewardIssuedAt =
      now;

    this.rewardTransactionId =
      normalizedTransactionId;

    this.rewardLedgerEntryId =
      normalizedLedgerEntryId;

    this.rewardFailedAt =
      null;

    this.rewardFailureReason =
      null;

    await this.save();

    return this;
  };

ReferralSchema.methods.markRewardFailed =
  async function markRewardFailed(
    reason = 'Reward issuance failed.',
  ) {
    if (
      this.rewardStatus ===
      'ISSUED'
    ) {
      throw new Error(
        'An issued reward cannot be marked failed.',
      );
    }

    if (
      ![
        'PENDING',
        'PROCESSING',
      ].includes(
        this.rewardStatus,
      )
    ) {
      throw new Error(
        `Reward cannot be marked failed from ${this.rewardStatus}.`,
      );
    }

    this.rewardStatus =
      'FAILED';

    this.rewardFailedAt =
      new Date();

    this.rewardFailureReason =
      normalizeNullableString(
        reason,
        MAX_REASON_LENGTH,
      );

    await this.save();

    return this;
  };

ReferralSchema.methods.cancelReward =
  async function cancelReward(
    reason = 'Reward cancelled.',
  ) {
    if (
      this.rewardIssued
    ) {
      throw new Error(
        'An issued reward cannot be cancelled through Referral.',
      );
    }

    if (
      this.rewardStatus ===
      'CANCELLED'
    ) {
      return this;
    }

    if (
      ![
        'ELIGIBLE',
        'PENDING',
        'PROCESSING',
        'FAILED',
      ].includes(
        this.rewardStatus,
      )
    ) {
      throw new Error(
        `Reward cannot be cancelled from ${this.rewardStatus}.`,
      );
    }

    this.rewardStatus =
      'CANCELLED';

    this.rewardFailureReason =
      normalizeNullableString(
        reason,
        MAX_REASON_LENGTH,
      );

    await this.save();

    return this;
  };

/* ==========================================================================
 * Fraud review lifecycle
 * ========================================================================== */

ReferralSchema.methods.clearFraudFlag =
  async function clearFraudFlag({
    reviewedBy,
    note = null,
  } = {}) {
    const normalizedReviewer =
      normalizeObjectId(
        reviewedBy,
        'reviewedBy',
      );

    if (
      !normalizedReviewer
    ) {
      throw new TypeError(
        'reviewedBy is required.',
      );
    }

    if (
      this.status ===
      'FRAUDULENT'
    ) {
      throw new Error(
        'Confirmed fraudulent referrals require a formal reversal/review process.',
      );
    }

    this.fraud =
      this.fraud ?? {};

    this.fraud.isFlagged =
      false;

    this.fraud.reviewStatus =
      'CLEARED';

    this.fraud.reviewedAt =
      new Date();

    this.fraud.reviewedBy =
      normalizedReviewer;

    this.fraud.reviewNote =
      normalizeNullableString(
        note,
        MAX_REASON_LENGTH,
      );

    if (
      this.status ===
      'FRAUD_REVIEW'
    ) {
      if (
        this.completedAt
      ) {
        this.status =
          'COMPLETED';
      } else if (
        this.eligibility
          ?.qualified
      ) {
        this.status =
          'ELIGIBLE';
      } else {
        this.status =
          'PENDING';
      }
    }

    if (
      this.rewardStatus ===
      'CANCELLED' &&
      this.status ===
      'COMPLETED'
    ) {
      this.rewardStatus =
        'ELIGIBLE';
    }

    await this.save();

    return this;
  };

ReferralSchema.methods.confirmFraud =
  async function confirmFraud({
    reviewedBy,
    reason = null,
  } = {}) {
    const normalizedReviewer =
      normalizeObjectId(
        reviewedBy,
        'reviewedBy',
      );

    if (
      !normalizedReviewer
    ) {
      throw new TypeError(
        'reviewedBy is required.',
      );
    }

    if (
      this.rewardIssued
    ) {
      throw new Error(
        'A referral with an already issued reward requires a separate financial reversal process.',
      );
    }

    this.fraud =
      this.fraud ?? {};

    this.fraud.isFlagged =
      true;

    this.fraud.reviewStatus =
      'CONFIRMED';

    this.fraud.severity =
      this.fraud.severity ===
      'LOW'
        ? 'HIGH'
        : this.fraud.severity;

    this.fraud.reviewedAt =
      new Date();

    this.fraud.reviewedBy =
      normalizedReviewer;

    this.fraud.reviewNote =
      normalizeNullableString(
        reason,
        MAX_REASON_LENGTH,
      );

    this.status =
      'FRAUDULENT';

    this.rewardStatus =
      'CANCELLED';

    await this.save();

    return this;
  };

/* ==========================================================================
 * Administrative lifecycle
 * ========================================================================== */

ReferralSchema.methods.softDelete =
  async function softDelete({
    deletedBy = null,
    reason = null,
  } = {}) {
    if (
      this.rewardIssued
    ) {
      throw new Error(
        'A referral with an issued financial reward cannot be soft-deleted through the normal lifecycle.',
      );
    }

    this.isDeleted =
      true;

    this.deletedAt =
      new Date();

    this.deletedBy =
      normalizeObjectId(
        deletedBy,
        'deletedBy',
      );

    this.deleteReason =
      normalizeNullableString(
        reason,
        MAX_REASON_LENGTH,
      );

    await this.save();

    return this;
  };

/* ==========================================================================
 * Validation
 * ========================================================================== */

ReferralSchema.pre(
  'validate',
  function validateReferral(
    next,
  ) {
    try {
      /*
       * Self-referral protection.
       */
      if (
        this.referrer &&
        this.referee &&
        this.referrer.equals(
          this.referee,
        )
      ) {
        this.invalidate(
          'referee',
          'A user cannot refer themselves.',
        );
      }

      /*
       * Normalize authorization/business identifiers.
       */
      if (
        this.tenantId
      ) {
        this.tenantId =
          normalizeTenantId(
            this.tenantId,
          );
      }

      if (
        this.referralCode
      ) {
        this.referralCode =
          String(
            this.referralCode,
          )
            .trim()
            .toUpperCase();
      }

      if (
        this.rewardCurrency
      ) {
        this.rewardCurrency =
          String(
            this.rewardCurrency,
          )
            .trim()
            .toUpperCase();
      }

      if (
        this.rewardType
      ) {
        this.rewardType =
          String(
            this.rewardType,
          )
            .trim()
            .toUpperCase();
      }

      /*
       * Referral expiration for newly created referrals.
       */
      if (
        this.isNew &&
        this.expiresAt &&
        this.expiresAt.getTime() <=
          Date.now()
      ) {
        this.invalidate(
          'expiresAt',
          'Referral expiry must be in the future.',
        );
      }

      /*
       * Decimal reward validation.
       */
      if (
        !isNonNegativeDecimal(
          this.rewardAmount,
        )
      ) {
        this.invalidate(
          'rewardAmount',
          'rewardAmount must be a valid non-negative decimal.',
        );
      }

      /*
       * Minimum contribution validation.
       */
      if (
        this.eligibility
          ?.minimumContribution
          ?.amount != null &&
        !isNonNegativeDecimal(
          this.eligibility
            .minimumContribution
            .amount,
        )
      ) {
        this.invalidate(
          'eligibility.minimumContribution.amount',
          'Minimum contribution must be a non-negative decimal.',
        );
      }

      /*
       * Reward state invariants.
       */
      if (
        this.rewardIssued &&
        this.rewardStatus !==
          'ISSUED'
      ) {
        this.invalidate(
          'rewardStatus',
          'rewardIssued=true requires rewardStatus=ISSUED.',
        );
      }

      if (
        this.rewardStatus ===
          'ISSUED' &&
        !this.rewardIssuedAt
      ) {
        this.rewardIssuedAt =
          new Date();
      }

      if (
        this.rewardStatus ===
          'ISSUED' &&
        !this.rewardIssued
      ) {
        this.rewardIssued =
          true;
      }

      if (
        this.status ===
          'FRAUDULENT' &&
        this.rewardStatus ===
          'ISSUED'
      ) {
        this.invalidate(
          'rewardStatus',
          'Fraudulent referrals cannot have an active issued reward state.',
        );
      }

      /*
       * Reward financial linkage.
       */
      if (
        this.rewardStatus ===
          'ISSUED' &&
        !this.rewardTransactionId &&
        !this.rewardLedgerEntryId
      ) {
        this.invalidate(
          'rewardTransactionId',
          'Issued rewards require a transaction or ledger reference.',
        );
      }

      /*
       * Fraud score consistency.
       */
      if (
        this.fraud
      ) {
        this.fraud.score =
          normalizeScore(
            this.fraud.score,
          );

        if (
          Array.isArray(
            this.fraud.signals,
          ) &&
          this.fraud.signals.length >
            MAX_FRAUD_SIGNALS
        ) {
          this.invalidate(
            'fraud.signals',
            `Fraud signals cannot exceed ${MAX_FRAUD_SIGNALS}.`,
          );
        }

        if (
          this.fraud.isFlagged &&
          this.fraud.reviewStatus ===
            'NOT_REVIEWED'
        ) {
          this.fraud.reviewStatus =
            'PENDING';
        }
      }

      /*
       * Deleted referrals must have deletion metadata.
       */
      if (
        this.isDeleted &&
        !this.deletedAt
      ) {
        this.deletedAt =
          new Date();
      }

      /*
       * Once a reward is financially issued, do not allow a later normal
       * document save to clear its financial identity.
       */
      if (
        !this.isNew &&
        this.rewardIssued &&
        this.isModified(
          'rewardTransactionId',
        ) &&
        this.rewardTransactionId ===
          null
      ) {
        this.invalidate(
          'rewardTransactionId',
          'Issued reward financial identity cannot be cleared.',
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  },
);

/* ==========================================================================
 * Mutation protection
 * ========================================================================== */

ReferralSchema.pre(
  [
    'deleteOne',
    'deleteMany',
    'findOneAndDelete',
    'findByIdAndDelete',
  ],
  function preventHardDelete(
    next,
  ) {
    next(
      new mongoose.Error.MongooseError(
        'Referral hard deletion is disabled.',
      ),
    );
  },
);

ReferralSchema.pre(
  [
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
    'findByIdAndUpdate',
    'replaceOne',
  ],
  function preventGenericMutation(
    next,
  ) {
    const options =
      this.getOptions();

    if (
      options.allowReferralMutation ===
      true
    ) {
      return next();
    }

    next(
      new mongoose.Error.MongooseError(
        'Generic Referral updates are disabled. Use controlled referral lifecycle methods.',
      ),
    );
  },
);

ReferralSchema.pre(
  'bulkWrite',
  function preventBulkWrite(
    next,
  ) {
    next(
      new mongoose.Error.MongooseError(
        'bulkWrite is disabled for Referral.',
      ),
    );
  },
);

/* ==========================================================================
 * Soft-delete query protection
 * ========================================================================== */

ReferralSchema.pre(
  /^find/,
  function hideDeleted(
    next,
  ) {
    const options =
      this.getOptions();

    if (
      !options.includeDeleted
    ) {
      this.where({
        isDeleted: false,
      });
    }

    next();
  },
);

/* ==========================================================================
 * Model export
 * ========================================================================== */

const Referral =
  mongoose.models.Referral ||
  mongoose.model(
    'Referral',
    ReferralSchema,
  );

export default Referral;

export {
  ReferralSchema,
  MoneySchema,
  FraudSignalSchema,
  compareDecimals,
  sanitizeMetadata,
  isPositiveDecimal,
};