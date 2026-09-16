/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Contribution Model
 * ============================================================================
 *
 * File:
 *   backend/models/Contribution.js
 *
 * Purpose:
 *   Tenant-scoped contribution record for SACCO / VSLA / ROSCA / cooperative
 *   community-finance operations.
 *
 * Architectural position:
 *
 *   Tenant
 *      │
 *      ├── Group
 *      │    │
 *      │    └── Contribution
 *      │
 *      └── Member / User
 *             │
 *             └── Contribution
 *
 * Financial processing:
 *
 *   Contribution
 *       │
 *       ├── Payment Request
 *       │       │
 *       │       └── Mobile Money / other channel
 *       │
 *       └── Transaction Service
 *                 │
 *                 └── Ledger
 *
 * IMPORTANT FINANCIAL BOUNDARY
 * ----------------------------------------------------------------------------
 * Contribution is a contribution/business-event record.
 *
 * It is NOT:
 *   - a general ledger
 *   - a wallet
 *   - an account balance engine
 *   - a replacement for Transaction
 *   - a replacement for Ledger
 *
 * A contribution must not independently move money.
 *
 * The canonical financial path remains:
 *
 *   Contribution / Payment Request
 *          ↓
 *   Payment Provider
 *          ↓
 *   Callback / Validation
 *          ↓
 *   Idempotency
 *          ↓
 *   Transaction Service
 *          ↓
 *   Ledger
 *          ↓
 *   Reconciliation
 *          ↓
 *   Receipt
 *
 * FINANCIAL PRECISION
 * ----------------------------------------------------------------------------
 * Monetary values use MongoDB Decimal128.
 *
 * The model deliberately avoids JavaScript Number conversion for persisted
 * monetary values and returns aggregate money values as strings where
 * appropriate for safe application/API transport.
 *
 * TENANCY
 * ----------------------------------------------------------------------------
 * tenantId is mandatory and is a MongoDB ObjectId referencing Tenant.
 *
 * Operational queries must be tenant-scoped.
 *
 * ESM
 * ----------------------------------------------------------------------------
 * This file uses native ESM because the TITech repository uses:
 *
 *   package.json -> "type": "module"
 *
 * ============================================================================
 */

import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * ============================================================================
 * ENUMS
 * ============================================================================
 */

export const CONTRIBUTION_STATUSES =
  Object.freeze([
    "PENDING",
    "PROCESSING",
    "COMPLETED",
    "FAILED",
    "REVERSED",
    "CANCELLED",
  ]);

export const CONTRIBUTION_SOURCES =
  Object.freeze([
    "CASH",
    "MTN_MOMO",
    "AIRTEL_MONEY",
    "BANK",
    "CARD",
    "TRANSFER",
    "AGENT",
    "OFFLINE",
    "OTHER",
  ]);

export const CONTRIBUTION_TYPES =
  Object.freeze([
    "SAVINGS",
    "SHARE",
    "WELFARE",
    "GROUP",
    "INVESTMENT",
    "OTHER",
  ]);

/**
 * ============================================================================
 * CONFIGURATION
 * ============================================================================
 */

const DEFAULT_CURRENCY = "UGX";

const MAX_REFERENCE_LENGTH = 200;
const MAX_EXTERNAL_REFERENCE_LENGTH = 200;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

const MAX_METADATA_KEYS = 100;

/**
 * ============================================================================
 * NORMALIZATION HELPERS
 * ============================================================================
 */

function normalizeString(value) {
  if (typeof value !== "string") {
    return value;
  }

  return value
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeUppercase(value) {
  if (typeof value !== "string") {
    return value;
  }

  return value.trim().toUpperCase();
}

function normalizeReference(value) {
  if (typeof value !== "string") {
    return value;
  }

  return value.trim();
}

/**
 * ============================================================================
 * OBJECT ID HELPERS
 * ============================================================================
 */

export function toObjectId(value) {
  if (
    value instanceof mongoose.Types.ObjectId
  ) {
    return value;
  }

  if (
    !value ||
    !mongoose.Types.ObjectId.isValid(
      value
    )
  ) {
    return null;
  }

  return new mongoose.Types.ObjectId(
    value
  );
}

export function isValidObjectId(
  value
) {
  return Boolean(
    value &&
      mongoose.Types.ObjectId.isValid(
        value
      )
  );
}

/**
 * ============================================================================
 * DECIMAL128 HELPERS
 * ============================================================================
 */

export function decimal128FromValue(
  value
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return mongoose.Types.Decimal128.fromString(
      "0.00"
    );
  }

  if (
    value instanceof
    mongoose.Types.Decimal128
  ) {
    return value;
  }

  const normalized =
    String(value).trim();

  if (!normalized) {
    return mongoose.Types.Decimal128.fromString(
      "0.00"
    );
  }

  /**
   * Reject scientific notation and malformed monetary strings rather than
   * silently converting through JavaScript Number.
   *
   * Decimal128 itself accepts wider values; financial application inputs here
   * should remain conventional decimal representations.
   */
  if (
    !/^-?\d+(?:\.\d{1,18})?$/.test(
      normalized
    )
  ) {
    throw new Error(
      "Invalid decimal monetary value."
    );
  }

  return mongoose.Types.Decimal128.fromString(
    normalized
  );
}

export function decimalToString(
  value
) {
  return decimal128FromValue(
    value
  ).toString();
}

function compareDecimal(
  left,
  right
) {
  const leftValue =
    decimal128FromValue(
      left
    ).toString();

  const rightValue =
    decimal128FromValue(
      right
    ).toString();

  /**
   * Normalize both values into sign/integer/fraction components.
   *
   * This helper is used only for model invariants.
   */
  const parse = (value) => {
    const negative =
      value.startsWith("-");

    const unsigned =
      negative
        ? value.slice(1)
        : value;

    const [
      whole = "0",
      fraction = "",
    ] = unsigned.split(".");

    return {
      negative,
      whole:
        whole.replace(
          /^0+(?=\d)/,
          ""
        ) || "0",
      fraction:
        fraction.padEnd(
          18,
          "0"
        ),
    };
  };

  const a = parse(
    leftValue
  );

  const b = parse(
    rightValue
  );

  if (
    a.negative &&
    !b.negative
  ) {
    return -1;
  }

  if (
    !a.negative &&
    b.negative
  ) {
    return 1;
  }

  if (
    a.whole.length !==
    b.whole.length
  ) {
    const result =
      a.whole.length >
      b.whole.length
        ? 1
        : -1;

    return a.negative
      ? result * -1
      : result;
  }

  if (
    a.whole !==
    b.whole
  ) {
    const result =
      a.whole >
      b.whole
        ? 1
        : -1;

    return a.negative
      ? result * -1
      : result;
  }

  if (
    a.fraction !==
    b.fraction
  ) {
    const result =
      a.fraction >
      b.fraction
        ? 1
        : -1;

    return a.negative
      ? result * -1
      : result;
  }

  return 0;
}

/**
 * ============================================================================
 * CONTRIBUTION SCHEMA
 * ============================================================================
 */

const ContributionSchema =
  new Schema(
    {
      /**
       * ========================================================================
       * TENANCY
       * ========================================================================
       */

      tenantId: {
        type: Schema.Types.ObjectId,
        ref: "Tenant",
        required: [
          true,
          "Tenant ID is required",
        ],
        index: true,
      },

      /**
       * ========================================================================
       * GROUP
       * ========================================================================
       */

      groupId: {
        type: Schema.Types.ObjectId,
        ref: "Group",
        required: [
          true,
          "Group ID is required",
        ],
        index: true,
      },

      /**
       * ========================================================================
       * MEMBER / USER
       * ========================================================================
       */

      userId: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: [
          true,
          "User ID is required",
        ],
        index: true,
      },

      memberId: {
        type: Schema.Types.ObjectId,
        ref: "Member",
        default: null,
        index: true,
      },

      /**
       * ========================================================================
       * CONTRIBUTION CLASSIFICATION
       * ========================================================================
       */

      contributionType: {
        type: String,
        enum: CONTRIBUTION_TYPES,
        default: "SAVINGS",
        uppercase: true,
        trim: true,
        index: true,
      },

      status: {
        type: String,
        enum: CONTRIBUTION_STATUSES,
        default: "COMPLETED",
        uppercase: true,
        trim: true,
        index: true,
      },

      source: {
        type: String,
        enum: CONTRIBUTION_SOURCES,
        default: "OTHER",
        uppercase: true,
        trim: true,
        index: true,
      },

      /**
       * ========================================================================
       * MONEY
       * ========================================================================
       */

      amount: {
        type: Schema.Types.Decimal128,
        required: [
          true,
          "Contribution amount is required",
        ],
        default: "0.00",
        validate: {
          validator(value) {
            try {
              return (
                compareDecimal(
                  value,
                  "0.00"
                ) >= 0
              );
            } catch {
              return false;
            }
          },
          message:
            "Contribution amount must be a valid non-negative monetary value",
        },
      },

      currency: {
        type: String,
        default: DEFAULT_CURRENCY,
        required: true,
        uppercase: true,
        trim: true,
        minlength: 3,
        maxlength: 3,
        match: /^[A-Z]{3}$/,
      },

      /**
       * ========================================================================
       * BUSINESS DATE
       * ========================================================================
       */

      date: {
        type: Date,
        default: Date.now,
        required: true,
        index: true,
      },

      /**
       * ========================================================================
       * REFERENCES
       * ========================================================================
       *
       * `reference` is the application/business reference.
       *
       * `externalReference` is the provider/external system reference.
       *
       * `idempotencyKey` identifies the originating financial operation and
       * should be coordinated with the canonical transaction idempotency layer.
       */

      reference: {
        type: String,
        trim: true,
        maxlength: MAX_REFERENCE_LENGTH,
        set: normalizeReference,
        index: true,
      },

      externalReference: {
        type: String,
        trim: true,
        maxlength:
          MAX_EXTERNAL_REFERENCE_LENGTH,
        set: normalizeReference,
        index: true,
      },

      idempotencyKey: {
        type: String,
        trim: true,
        maxlength:
          MAX_IDEMPOTENCY_KEY_LENGTH,
        set: normalizeReference,
        index: true,
      },

      /**
       * ========================================================================
       * CANONICAL FINANCIAL REFERENCES
       * ========================================================================
       *
       * These references connect this contribution to the authoritative
       * financial pipeline.
       */

      transactionId: {
        type: Schema.Types.ObjectId,
        ref: "Transaction",
        default: null,
        index: true,
      },

      paymentRequestId: {
        type: Schema.Types.ObjectId,
        ref: "PaymentRequest",
        default: null,
        index: true,
      },

      ledgerEntryId: {
        type: Schema.Types.ObjectId,
        ref: "LedgerEntry",
        default: null,
        index: true,
      },

      /**
       * Provider callback / reconciliation reference.
       */
      reconciliationReference: {
        type: String,
        trim: true,
        maxlength: MAX_REFERENCE_LENGTH,
        set: normalizeReference,
        index: true,
      },

      /**
       * ========================================================================
       * PAYMENT TIMESTAMPS
       * ========================================================================
       */

      processedAt: {
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

      reversedAt: {
        type: Date,
        default: null,
      },

      /**
       * ========================================================================
       * FAILURE / REVERSAL
       * ========================================================================
       */

      failureCode: {
        type: String,
        trim: true,
        maxlength: 100,
        default: null,
      },

      failureReason: {
        type: String,
        trim: true,
        maxlength: 500,
        default: null,
        set: normalizeString,
      },

      reversalReference: {
        type: String,
        trim: true,
        maxlength: MAX_REFERENCE_LENGTH,
        default: null,
        set: normalizeReference,
      },

      /**
       * ========================================================================
       * METADATA
       * ========================================================================
       *
       * Metadata is operational context, not a replacement for structured
       * domain fields.
       */

      metadata: {
        type: Schema.Types.Mixed,
        default: () => ({}),
      },

      /**
       * ========================================================================
       * SOFT DELETE
       * ========================================================================
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
        ref: "User",
        default: null,
      },

      /**
       * ========================================================================
       * AUDIT
       * ========================================================================
       */

      createdBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },

      updatedBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },

      /**
       * ========================================================================
       * WORKFLOW
       * ========================================================================
       */

      workflowVersion: {
        type: Number,
        default: 1,
        min: 1,
      },

      schemaVersion: {
        type: Number,
        default: 2,
        min: 1,
      },
    },
    {
      timestamps: true,

      versionKey: "__v",

      optimisticConcurrency: true,

      strict: true,

      minimize: false,

      toJSON: {
        getters: true,
        virtuals: true,

        transform(doc, ret) {
          if (ret._id) {
            ret.id =
              ret._id.toString();
          }

          delete ret._id;
          delete ret.__v;

          return ret;
        },
      },

      toObject: {
        getters: true,
        virtuals: true,

        transform(doc, ret) {
          if (ret._id) {
            ret.id =
              ret._id.toString();
          }

          delete ret._id;
          delete ret.__v;

          return ret;
        },
      },
    }
  );

/**
 * ============================================================================
 * VIRTUALS
 * ============================================================================
 */

ContributionSchema.virtual(
  "isCompleted"
).get(
  function isCompleted() {
    return (
      this.status ===
      "COMPLETED"
    );
  }
);

ContributionSchema.virtual(
  "isPending"
).get(
  function isPending() {
    return (
      this.status ===
        "PENDING" ||
      this.status ===
        "PROCESSING"
    );
  }
);

ContributionSchema.virtual(
  "isReversed"
).get(
  function isReversed() {
    return (
      this.status ===
      "REVERSED"
    );
  }
);

ContributionSchema.virtual(
  "isFinanciallyLinked"
).get(
  function isFinanciallyLinked() {
    return Boolean(
      this.transactionId ||
        this.ledgerEntryId
    );
  }
);

/**
 * ============================================================================
 * VALIDATION / NORMALIZATION
 * ============================================================================
 */

ContributionSchema.pre(
  "validate",
  function contributionValidation(
    next
  ) {
    /**
     * Tenant is mandatory and must be a real ObjectId.
     */
    const tenant =
      toObjectId(
        this.tenantId
      );

    if (!tenant) {
      return next(
        new Error(
          "A valid tenantId is required for Contribution."
        )
      );
    }

    this.tenantId =
      tenant;

    /**
     * Group.
     */
    const group =
      toObjectId(
        this.groupId
      );

    if (!group) {
      return next(
        new Error(
          "A valid groupId is required for Contribution."
        )
      );
    }

    this.groupId =
      group;

    /**
     * User.
     */
    const user =
      toObjectId(
        this.userId
      );

    if (!user) {
      return next(
        new Error(
          "A valid userId is required for Contribution."
        )
      );
    }

    this.userId =
      user;

    /**
     * Optional member reference.
     */
    if (this.memberId) {
      const member =
        toObjectId(
          this.memberId
        );

      if (!member) {
        return next(
          new Error(
            "memberId must be a valid ObjectId."
          )
        );
      }

      this.memberId =
        member;
    }

    /**
     * Monetary normalization.
     *
     * Never use Number(value).toFixed(...) for financial values.
     */
    try {
      this.amount =
        decimal128FromValue(
          this.amount
        );
    } catch (error) {
      return next(error);
    }

    if (
      compareDecimal(
        this.amount,
        "0.00"
      ) < 0
    ) {
      return next(
        new Error(
          "Contribution amount cannot be negative."
        )
      );
    }

    /**
     * Normalize currency.
     */
    this.currency =
      normalizeUppercase(
        this.currency ||
          DEFAULT_CURRENCY
      );

    /**
     * Ensure date remains valid.
     */
    if (
      !(this.date instanceof Date) ||
      Number.isNaN(
        this.date.getTime()
      )
    ) {
      return next(
        new Error(
          "Contribution date must be a valid date."
        )
      );
    }

    /**
     * Limit uncontrolled metadata growth.
     */
    if (
      this.metadata &&
      typeof this.metadata ===
        "object" &&
      !Array.isArray(
        this.metadata
      )
    ) {
      const keys =
        Object.keys(
          this.metadata
        );

      if (
        keys.length >
        MAX_METADATA_KEYS
      ) {
        return next(
          new Error(
            `Contribution metadata cannot contain more than ${MAX_METADATA_KEYS} keys.`
          )
        );
      }
    }

    /**
     * Lifecycle consistency.
     */
    if (
      this.status ===
        "COMPLETED" &&
      !this.completedAt
    ) {
      this.completedAt =
        new Date();
    }

    if (
      this.status ===
        "FAILED" &&
      !this.failedAt
    ) {
      this.failedAt =
        new Date();
    }

    if (
      this.status ===
        "REVERSED" &&
      !this.reversedAt
    ) {
      this.reversedAt =
        new Date();
    }

    return next();
  }
);

/**
 * ============================================================================
 * FINANCIAL-LINK CONSISTENCY
 * ============================================================================
 */

ContributionSchema.pre(
  "validate",
  function financialLinkValidation(
    next
  ) {
    /**
     * A COMPLETED contribution representing a posted financial event should
     * normally be linked to the canonical transaction.
     *
     * We do not reject every legacy completed record without a transaction,
     * because historical/migration data may predate the current architecture.
     *
     * New payment services should enforce this relationship before completion.
     */
    if (
      this.status ===
        "COMPLETED" &&
      this.transactionId === null &&
      this.ledgerEntryId !== null
    ) {
      return next(
        new Error(
          "A contribution cannot reference a ledger entry without its canonical transaction."
        )
      );
    }

    return next();
  }
);

/**
 * ============================================================================
 * STATIC HELPERS
 * ============================================================================
 */

/**
 * Tenant-safe query builder.
 */
ContributionSchema.statics.buildTenantQuery =
  function buildTenantQuery({
    tenantId,
    ...criteria
  } = {}) {
    const tenantObjectId =
      toObjectId(
        tenantId
      );

    if (!tenantObjectId) {
      throw new Error(
        "A valid tenantId is required for Contribution queries."
      );
    }

    return {
      tenantId:
        tenantObjectId,
      isDeleted: false,
      ...criteria,
    };
  };

/**
 * Find one contribution by tenant + ID.
 */
ContributionSchema.statics.findTenantContribution =
  function findTenantContribution(
    tenantId,
    contributionId,
    {
      includeDeleted = false,
    } = {}
  ) {
    const tenantObjectId =
      toObjectId(
        tenantId
      );

    const contributionObjectId =
      toObjectId(
        contributionId
      );

    if (
      !tenantObjectId ||
      !contributionObjectId
    ) {
      return this.findOne({
        _id: null,
      });
    }

    const query = {
      _id:
        contributionObjectId,
      tenantId:
        tenantObjectId,
    };

    if (!includeDeleted) {
      query.isDeleted = false;
    }

    return this.findOne(
      query
    );
  };

/**
 * Add contribution.
 *
 * This creates the contribution record only.
 *
 * It does NOT:
 *   - call a payment provider
 *   - post a ledger transaction
 *   - mutate a savings balance
 *   - bypass idempotency
 */
ContributionSchema.statics.addContribution =
  async function addContribution(
    payload,
    {
      session = null,
    } = {}
  ) {
    if (
      !payload ||
      typeof payload !==
        "object"
    ) {
      throw new Error(
        "Contribution payload is required."
      );
    }

    const document =
      new this(payload);

    return document.save(
      session
        ? { session }
        : undefined
    );
  };

/**
 * Sum contributions for a group.
 *
 * Returns the monetary total as a string, never a JavaScript floating-point
 * Number.
 */
ContributionSchema.statics.sumForGroup =
  async function sumForGroup(
    tenantId,
    groupId,
    {
      from = null,
      to = null,
      status = "COMPLETED",
      contributionType = null,
    } = {}
  ) {
    const tenantObjectId =
      toObjectId(
        tenantId
      );

    const groupObjectId =
      toObjectId(
        groupId
      );

    if (
      !tenantObjectId ||
      !groupObjectId
    ) {
      return {
        total: "0.00",
        count: 0,
      };
    }

    const match = {
      tenantId:
        tenantObjectId,

      groupId:
        groupObjectId,

      isDeleted: false,
    };

    if (status) {
      match.status =
        status;
    }

    if (contributionType) {
      match.contributionType =
        contributionType;
    }

    if (from || to) {
      match.date = {};

      if (from) {
        match.date.$gte =
          new Date(from);
      }

      if (to) {
        match.date.$lte =
          new Date(to);
      }
    }

    const result =
      await this.aggregate([
        {
          $match: match,
        },

        {
          $group: {
            _id: null,

            total: {
              $sum: "$amount",
            },

            count: {
              $sum: 1,
            },
          },
        },
      ]);

    if (
      !result ||
      !result[0]
    ) {
      return {
        total: "0.00",
        count: 0,
      };
    }

    return {
      total:
        decimalToString(
          result[0].total
        ),

      count:
        result[0].count,
    };
  };

/**
 * User/member contribution summary in a group.
 */
ContributionSchema.statics.userSummary =
  async function userSummary(
    tenantId,
    groupId,
    userId,
    {
      status = "COMPLETED",
    } = {}
  ) {
    const tenantObjectId =
      toObjectId(
        tenantId
      );

    const groupObjectId =
      toObjectId(
        groupId
      );

    const userObjectId =
      toObjectId(
        userId
      );

    if (
      !tenantObjectId ||
      !groupObjectId ||
      !userObjectId
    ) {
      return {
        total: "0.00",
        count: 0,
        lastContribution:
          null,
      };
    }

    const match = {
      tenantId:
        tenantObjectId,

      groupId:
        groupObjectId,

      userId:
        userObjectId,

      isDeleted: false,
    };

    if (status) {
      match.status =
        status;
    }

    const result =
      await this.aggregate([
        {
          $match: match,
        },

        {
          $group: {
            _id: "$userId",

            total: {
              $sum: "$amount",
            },

            count: {
              $sum: 1,
            },

            lastContribution: {
              $max: "$date",
            },
          },
        },
      ]);

    if (
      !result ||
      !result[0]
    ) {
      return {
        total: "0.00",
        count: 0,
        lastContribution:
          null,
      };
    }

    return {
      total:
        decimalToString(
          result[0].total
        ),

      count:
        result[0].count,

      lastContribution:
        result[0]
          .lastContribution,
    };
  };

/**
 * Tenant-wide summary.
 */
ContributionSchema.statics.tenantSummary =
  async function tenantSummary(
    tenantId,
    {
      from = null,
      to = null,
      status = "COMPLETED",
    } = {}
  ) {
    const tenantObjectId =
      toObjectId(
        tenantId
      );

    if (!tenantObjectId) {
      return {
        total: "0.00",
        count: 0,
        contributors: 0,
      };
    }

    const match = {
      tenantId:
        tenantObjectId,

      isDeleted: false,
    };

    if (status) {
      match.status =
        status;
    }

    if (from || to) {
      match.date = {};

      if (from) {
        match.date.$gte =
          new Date(from);
      }

      if (to) {
        match.date.$lte =
          new Date(to);
      }
    }

    const result =
      await this.aggregate([
        {
          $match: match,
        },

        {
          $group: {
            _id: null,

            total: {
              $sum: "$amount",
            },

            count: {
              $sum: 1,
            },

            contributors: {
              $addToSet:
                "$userId",
            },
          },
        },

        {
          $project: {
            _id: 0,
            total: 1,
            count: 1,
            contributors: {
              $size:
                "$contributors",
            },
          },
        },
      ]);

    if (
      !result ||
      !result[0]
    ) {
      return {
        total: "0.00",
        count: 0,
        contributors: 0,
      };
    }

    return {
      total:
        decimalToString(
          result[0].total
        ),

      count:
        result[0].count,

      contributors:
        result[0]
          .contributors,
    };
  };

/**
 * Find contribution by idempotency key.
 *
 * Always tenant-scoped.
 */
ContributionSchema.statics.findByIdempotencyKey =
  function findByIdempotencyKey(
    tenantId,
    idempotencyKey
  ) {
    const tenantObjectId =
      toObjectId(
        tenantId
      );

    if (
      !tenantObjectId ||
      typeof idempotencyKey !==
        "string" ||
      !idempotencyKey.trim()
    ) {
      return this.findOne({
        _id: null,
      });
    }

    return this.findOne({
      tenantId:
        tenantObjectId,

      idempotencyKey:
        idempotencyKey.trim(),

      isDeleted: false,
    });
  };

/**
 * Find group contributions.
 */
ContributionSchema.statics.findGroupContributions =
  function findGroupContributions(
    tenantId,
    groupId,
    {
      skip = 0,
      limit = 100,
      status = null,
    } = {}
  ) {
    const tenantObjectId =
      toObjectId(
        tenantId
      );

    const groupObjectId =
      toObjectId(
        groupId
      );

    if (
      !tenantObjectId ||
      !groupObjectId
    ) {
      return this.findOne({
        _id: null,
      });
    }

    const query = {
      tenantId:
        tenantObjectId,

      groupId:
        groupObjectId,

      isDeleted: false,
    };

    if (status) {
      query.status =
        status;
    }

    return this.find(query)
      .sort({
        date: -1,
        createdAt: -1,
      })
      .skip(
        Math.max(
          0,
          Number.parseInt(
            skip,
            10
          ) || 0
        )
      )
      .limit(
        Math.min(
          100,
          Math.max(
            1,
            Number.parseInt(
              limit,
              10
            ) || 100
          )
        )
      );
  };

/**
 * ============================================================================
 * INSTANCE METHODS
 * ============================================================================
 */

/**
 * Tenant ownership check.
 */
ContributionSchema.methods.belongsToTenant =
  function belongsToTenant(
    tenantId
  ) {
    return Boolean(
      this.tenantId &&
        tenantId &&
        String(
          this.tenantId
        ) ===
          String(
            tenantId
          )
    );
  };

/**
 * Check whether the contribution is still financially pending.
 */
ContributionSchema.methods.isProcessing =
  function isProcessing() {
    return (
      this.status ===
        "PENDING" ||
      this.status ===
        "PROCESSING"
    );
  };

/**
 * A contribution is safe to regard as posted only when it has completed and
 * is linked to the canonical transaction.
 */
ContributionSchema.methods.isPosted =
  function isPosted() {
    return (
      this.status ===
        "COMPLETED" &&
      Boolean(
        this.transactionId
      )
    );
  };

/**
 * Return safe financial summary.
 */
ContributionSchema.methods.getFinancialSnapshot =
  function getFinancialSnapshot() {
    return {
      contributionId:
        this._id,

      tenantId:
        this.tenantId,

      groupId:
        this.groupId,

      memberId:
        this.memberId,

      userId:
        this.userId,

      amount:
        decimalToString(
          this.amount
        ),

      currency:
        this.currency,

      status:
        this.status,

      contributionType:
        this.contributionType,

      transactionId:
        this.transactionId,

      paymentRequestId:
        this.paymentRequestId,

      ledgerEntryId:
        this.ledgerEntryId,

      idempotencyKey:
        this.idempotencyKey,

      reconciliationReference:
        this.reconciliationReference,
    };
  };

/**
 * Soft delete.
 *
 * This does not reverse a financial transaction.
 *
 * Financial reversal must go through the transaction/reversal service.
 */
ContributionSchema.methods.softDelete =
  async function softDelete(
    deletedBy = null
  ) {
    this.isDeleted = true;
    this.deletedAt =
      new Date();

    this.deletedBy =
      toObjectId(
        deletedBy
      );

    return this.save();
  };

/**
 * ============================================================================
 * INDEXES
 * ============================================================================
 */

/**
 * Primary tenant/group/member query.
 */
ContributionSchema.index({
  tenantId: 1,
  groupId: 1,
  userId: 1,
  createdAt: -1,
});

/**
 * Member contribution history.
 */
ContributionSchema.index({
  tenantId: 1,
  memberId: 1,
  date: -1,
});

/**
 * Group contribution reporting.
 */
ContributionSchema.index({
  tenantId: 1,
  groupId: 1,
  status: 1,
  date: -1,
});

/**
 * Tenant reporting.
 */
ContributionSchema.index({
  tenantId: 1,
  status: 1,
  date: -1,
});

/**
 * Contribution classification.
 */
ContributionSchema.index({
  tenantId: 1,
  contributionType: 1,
  status: 1,
});

/**
 * Source reporting.
 */
ContributionSchema.index({
  tenantId: 1,
  source: 1,
  status: 1,
});

/**
 * External provider reference.
 */
ContributionSchema.index({
  tenantId: 1,
  externalReference: 1,
});

/**
 * Transaction lookup.
 */
ContributionSchema.index({
  tenantId: 1,
  transactionId: 1,
});

/**
 * Payment request lookup.
 */
ContributionSchema.index({
  tenantId: 1,
  paymentRequestId: 1,
});

/**
 * Ledger lookup.
 */
ContributionSchema.index({
  tenantId: 1,
  ledgerEntryId: 1,
});

/**
 * Reconciliation operations.
 */
ContributionSchema.index({
  tenantId: 1,
  reconciliationReference: 1,
});

/**
 * Idempotency uniqueness.
 *
 * A financial operation must not create multiple contribution records from
 * the same idempotency key inside one tenant.
 */
ContributionSchema.index(
  {
    tenantId: 1,
    idempotencyKey: 1,
  },
  {
    unique: true,
    sparse: true,
    name:
      "uq_contribution_tenant_idempotency",
  }
);

/**
 * Business reference uniqueness inside a group.
 *
 * This preserves the original model's group/reference semantics while
 * preventing one tenant's references from affecting another tenant.
 */
ContributionSchema.index(
  {
    tenantId: 1,
    groupId: 1,
    reference: 1,
  },
  {
    unique: true,
    sparse: true,
    name:
      "uq_contribution_tenant_group_reference",
  }
);

/**
 * Soft-delete filtering.
 */
ContributionSchema.index({
  tenantId: 1,
  isDeleted: 1,
});

/**
 * Recent contributions.
 */
ContributionSchema.index({
  tenantId: 1,
  createdAt: -1,
});

/**
 * ============================================================================
 * MODEL METADATA
 * ============================================================================
 */

export const CONTRIBUTION_MODEL_METADATA =
  Object.freeze({
    modelName:
      "Contribution",

    schemaVersion:
      2,

    tenantField:
      "tenantId",

    tenantFieldType:
      "ObjectId",

    financialEntity:
      true,

    ledgerAuthority:
      false,

    transactionAuthority:
      false,

    postingAuthority:
      "TransactionService",

    monetaryType:
      "Decimal128",

    amountTransport:
      "string",

    idempotencyRequired:
      true,

    transactionLinkField:
      "transactionId",

    ledgerLinkField:
      "ledgerEntryId",

    paymentRequestLinkField:
      "paymentRequestId",

    financialHistoryAuthority:
      "Transaction/Ledger",
  });

/**
 * ============================================================================
 * MODEL EXPORT
 * ============================================================================
 */

export const Contribution =
  mongoose.models.Contribution ||
  mongoose.model(
    "Contribution",
    ContributionSchema
  );

export default Contribution;

/**
 * Export schema for migrations/tests/introspection.
 */
export {
  ContributionSchema,
};