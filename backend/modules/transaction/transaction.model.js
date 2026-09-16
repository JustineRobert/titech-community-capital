/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Financial Transaction Model
 * ============================================================================
 *
 * File:
 *   backend/modules/transaction/transaction.model.js
 *
 * Purpose:
 *   Canonical persistent transaction record for the TITech financial engine.
 *
 * Responsibilities:
 *   - Persist financial transaction identity
 *   - Enforce tenant isolation
 *   - Preserve monetary precision using Decimal128
 *   - Enforce transaction lifecycle states
 *   - Support idempotency
 *   - Support distributed correlation
 *   - Support AML / Fraud / KYC / Compliance correlation
 *   - Support payment-provider correlation
 *   - Support ledger linkage
 *   - Support reconciliation
 *   - Support auditability
 *   - Support optimistic concurrency
 *
 * ============================================================================
 * FINANCIAL ARCHITECTURE
 * ============================================================================
 *
 * Transaction is a BUSINESS-FINANCIAL record.
 *
 * The immutable ledger/journal remains the accounting source of truth.
 *
 * Transaction is therefore NOT:
 *
 *   - a second ledger
 *   - a balance calculator
 *   - a wallet
 *   - a replacement for Ledger
 *
 * Canonical path:
 *
 *   User
 *      ↓
 *   Institution / Tenant
 *      ↓
 *   Group
 *      ↓
 *   Member
 *      ↓
 *   Contribution / Loan / Payment
 *      ↓
 *   Payment Request / Provider
 *      ↓
 *   Callback / Validation
 *      ↓
 *   Idempotency
 *      ↓
 *   Transaction
 *      ↓
 *   Ledger
 *      ↓
 *   Balance / Account Aggregate
 *      ↓
 *   Reconciliation
 *      ↓
 *   Receipt / Outbox / Audit
 *
 * Once financial posting has occurred, the following transaction identity/value
 * fields MUST NOT be changed:
 *
 *   tenantId
 *   transactionId
 *   amount
 *   currency
 *   type
 *   idempotencyKey
 *   reference
 *   userId
 *   customerId
 *   account references
 *   provider references
 *   correlation references
 *
 * A reversal MUST be represented by a NEW transaction.
 *
 * ============================================================================
 * ESM
 * ============================================================================
 *
 * The TITech repository uses package.json:
 *
 *   "type": "module"
 *
 * This file therefore intentionally uses native ESM.
 *
 * ============================================================================
 */

import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

export const MODEL_NAME = "Transaction";

export const COLLECTION_NAME = "transactions";

export const VALID_STATUSES = Object.freeze([
  "pending",
  "completed",
  "failed",
  "canceled",
]);

export const VALID_TYPES = Object.freeze([
  "deposit",
  "withdrawal",
  "transfer",
  "payment",
  "loan",
  "repayment",
]);

export const TERMINAL_STATUSES = Object.freeze([
  "completed",
  "failed",
  "canceled",
]);

export const INITIAL_STATUS = "pending";

export const ALLOWED_STATUS_TRANSITIONS =
  Object.freeze({
    pending: Object.freeze([
      "completed",
      "failed",
      "canceled",
    ]),

    completed: Object.freeze([]),
    failed: Object.freeze([]),
    canceled: Object.freeze([]),
  });

/**
 * ============================================================================
 * CONFIGURATION
 * ============================================================================
 */

const MAX_TRANSACTION_ID_LENGTH = 128;
const MAX_REFERENCE_LENGTH = 256;
const MAX_IDEMPOTENCY_KEY_LENGTH = 512;
const MAX_CORRELATION_ID_LENGTH = 256;
const MAX_REQUEST_ID_LENGTH = 256;

const MAX_PRINCIPAL_ID_LENGTH = 256;
const MAX_ACCOUNT_ID_LENGTH = 256;

const MAX_PROVIDER_LENGTH = 128;
const MAX_PROVIDER_TRANSACTION_ID_LENGTH = 256;
const MAX_OPERATION_LENGTH = 128;

const MAX_DESCRIPTION_LENGTH = 2000;

const MAX_SCREENING_ID_LENGTH = 128;

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

export function toDecimal128(value) {
  if (
    value instanceof
    mongoose.Types.Decimal128
  ) {
    return value;
  }

  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  const normalized =
    String(value).trim();

  /**
   * Financial inputs should use conventional decimal notation.
   *
   * This intentionally rejects:
   *   NaN
   *   Infinity
   *   scientific notation
   *   arbitrary non-decimal strings
   */
  if (
    !/^\d+(?:\.\d{1,18})?$/.test(
      normalized
    )
  ) {
    throw new Error(
      "Invalid monetary Decimal128 value."
    );
  }

  return mongoose.Types.Decimal128.fromString(
    normalized
  );
}

export function decimalToString(
  value
) {
  if (
    value === undefined ||
    value === null
  ) {
    return "0.00";
  }

  if (
    value instanceof
    mongoose.Types.Decimal128
  ) {
    return value.toString();
  }

  return String(value);
}

/**
 * ============================================================================
 * VALIDATION HELPERS
 * ============================================================================
 */

/**
 * A transaction amount must be strictly greater than zero.
 *
 * We intentionally do not convert to JavaScript Number.
 */
export function validatePositiveDecimal(
  value
) {
  if (
    value === undefined ||
    value === null
  ) {
    return false;
  }

  try {
    const decimal =
      toDecimal128(value);

    if (!decimal) {
      return false;
    }

    const normalized =
      decimal.toString();

    if (
      normalized === "NaN" ||
      normalized === "Infinity" ||
      normalized === "-Infinity"
    ) {
      return false;
    }

    /**
     * Decimal128 canonical zero may appear as 0, 0.0, 0.00, etc.
     */
    return (
      normalized !== "0" &&
      /^0+(?:\.0+)?$/.test(
        normalized
      ) === false &&
      !normalized.startsWith("-")
    );
  } catch {
    return false;
  }
}

/**
 * Currency must be an ISO-style three-letter uppercase code.
 */
export function isValidCurrency(
  value
) {
  return (
    typeof value === "string" &&
    /^[A-Z]{3}$/.test(
      value.trim().toUpperCase()
    )
  );
}

function isValidStringIdentifier(
  value,
  maxLength = 256
) {
  if (
    typeof value !== "string"
  ) {
    return false;
  }

  const normalized =
    value.trim();

  return (
    normalized.length > 0 &&
    normalized.length <= maxLength
  );
}

/**
 * ============================================================================
 * IMMUTABILITY POLICY
 * ============================================================================
 *
 * Fields representing the financial identity or original economic instruction
 * are immutable after transaction creation.
 *
 * Status is intentionally handled separately because lifecycle transitions are
 * valid only when they follow the explicit transition policy.
 */

export const IMMUTABLE_FINANCIAL_FIELDS =
  Object.freeze([
    "tenantId",
    "transactionId",
    "type",
    "amount",
    "currency",
    "idempotencyKey",
    "reference",
    "userId",
    "customerId",
    "debitAccountId",
    "creditAccountId",
    "provider",
    "operation",
    "providerTransactionId",
    "journalId",
    "ledgerTransactionId",
    "fraudScreeningId",
    "amlScreeningId",
    "complianceDecisionId",
    "riskDecision",
    "correlationId",
    "requestId",
  ]);

/**
 * These fields are validly writable as part of lifecycle processing.
 */
const MUTABLE_OPERATIONAL_FIELDS =
  new Set([
    "status",
    "completedAt",
    "failedAt",
    "canceledAt",
    "metadata",
    "description",
    "archived",
  ]);

/**
 * ============================================================================
 * TRANSACTION SCHEMA
 * ============================================================================
 */

const TransactionSchema =
  new Schema(
    {
      /**
       * ========================================================================
       * TENANT ISOLATION
       * ========================================================================
       */

      tenantId: {
        type: Schema.Types.ObjectId,
        ref: "Tenant",
        required: [
          true,
          "tenantId is required",
        ],
        immutable: true,
        index: true,
      },

      /**
       * ========================================================================
       * BUSINESS TRANSACTION IDENTITY
       * ========================================================================
       *
       * MongoDB `_id` is the persistence identity.
       *
       * transactionId is TITech's public/business identity.
       */

      transactionId: {
        type: String,
        required: [
          true,
          "transactionId is required",
        ],
        trim: true,
        maxlength:
          MAX_TRANSACTION_ID_LENGTH,
        immutable: true,
        index: true,
        default: () =>
          new mongoose.Types.ObjectId()
            .toString(),
      },

      /**
       * ========================================================================
       * BUSINESS REFERENCE
       * ========================================================================
       */

      reference: {
        type: String,
        trim: true,
        maxlength:
          MAX_REFERENCE_LENGTH,
        immutable: true,
        sparse: true,
        index: true,
      },

      /**
       * ========================================================================
       * TRANSACTION TYPE
       * ========================================================================
       */

      type: {
        type: String,
        required: true,
        enum: VALID_TYPES,
        trim: true,
        lowercase: true,
        immutable: true,
        index: true,
      },

      /**
       * ========================================================================
       * MONETARY AMOUNT
       * ========================================================================
       */

      amount: {
        type: Schema.Types.Decimal128,
        required: true,
        immutable: true,

        validate: {
          validator:
            validatePositiveDecimal,

          message:
            "Amount must be a positive monetary value",
        },
      },

      /**
       * ========================================================================
       * CURRENCY
       * ========================================================================
       */

      currency: {
        type: String,
        required: true,
        default: "UGX",
        trim: true,
        uppercase: true,
        minlength: 3,
        maxlength: 3,
        immutable: true,

        validate: {
          validator:
            isValidCurrency,

          message:
            "Currency must be a valid 3-letter currency code",
        },
      },

      /**
       * ========================================================================
       * LIFECYCLE STATUS
       * ========================================================================
       */

      status: {
        type: String,
        enum: VALID_STATUSES,
        default: INITIAL_STATUS,
        required: true,
        lowercase: true,
        trim: true,
        index: true,
      },

      /**
       * ========================================================================
       * IDEMPOTENCY
       * ========================================================================
       *
       * Uniqueness is tenant-scoped.
       *
       * The dedicated TransactionIdempotencyManager remains the higher-level
       * orchestration authority. This index provides persistence-level
       * protection against duplicate transaction identities.
       */

      idempotencyKey: {
        type: String,
        trim: true,
        maxlength:
          MAX_IDEMPOTENCY_KEY_LENGTH,
        immutable: true,
        sparse: true,
      },

      /**
       * ========================================================================
       * DISTRIBUTED CORRELATION
       * ========================================================================
       */

      correlationId: {
        type: String,
        trim: true,
        maxlength:
          MAX_CORRELATION_ID_LENGTH,
        index: true,
        immutable: true,
        sparse: true,
      },

      requestId: {
        type: String,
        trim: true,
        maxlength:
          MAX_REQUEST_ID_LENGTH,
        immutable: true,
        sparse: true,
      },

      /**
       * ========================================================================
       * ACTOR / CUSTOMER
       * ========================================================================
       *
       * Kept as String for compatibility with the existing transaction
       * ecosystem. Where a canonical MongoDB User/Member ObjectId is available,
       * services may additionally persist that identity in metadata or a future
       * migration field.
       */

      userId: {
        type: String,
        trim: true,
        maxlength:
          MAX_PRINCIPAL_ID_LENGTH,
        immutable: true,
        index: true,
        sparse: true,
      },

      customerId: {
        type: String,
        trim: true,
        maxlength:
          MAX_PRINCIPAL_ID_LENGTH,
        immutable: true,
        index: true,
        sparse: true,
      },

      /**
       * ========================================================================
       * ACCOUNT LINKAGE
       * ========================================================================
       *
       * Business account identifiers are retained as strings because the
       * existing financial stack may use external/account-number identities.
       *
       * Ledger remains authoritative for accounting.
       */

      debitAccountId: {
        type: String,
        trim: true,
        maxlength:
          MAX_ACCOUNT_ID_LENGTH,
        immutable: true,
        sparse: true,
      },

      creditAccountId: {
        type: String,
        trim: true,
        maxlength:
          MAX_ACCOUNT_ID_LENGTH,
        immutable: true,
        sparse: true,
      },

      /**
       * ========================================================================
       * LEDGER LINKAGE
       * ========================================================================
       */

      journalId: {
        type: String,
        trim: true,
        maxlength:
          MAX_ACCOUNT_ID_LENGTH,
        immutable: true,
        index: true,
        sparse: true,
      },

      ledgerTransactionId: {
        type: String,
        trim: true,
        maxlength:
          MAX_ACCOUNT_ID_LENGTH,
        immutable: true,
        index: true,
        sparse: true,
      },

      /**
       * ========================================================================
       * PAYMENT PROVIDER
       * ========================================================================
       */

      provider: {
        type: String,
        trim: true,
        uppercase: true,
        maxlength:
          MAX_PROVIDER_LENGTH,
        immutable: true,
        index: true,
        sparse: true,
      },

      providerTransactionId: {
        type: String,
        trim: true,
        maxlength:
          MAX_PROVIDER_TRANSACTION_ID_LENGTH,
        immutable: true,
        index: true,
        sparse: true,
      },

      operation: {
        type: String,
        trim: true,
        uppercase: true,
        maxlength:
          MAX_OPERATION_LENGTH,
        immutable: true,
        sparse: true,
      },

      /**
       * ========================================================================
       * DESCRIPTION
       * ========================================================================
       */

      description: {
        type: String,
        trim: true,
        maxlength:
          MAX_DESCRIPTION_LENGTH,
        default: "",
      },

      /**
       * ========================================================================
       * RISK / COMPLIANCE
       * ========================================================================
       */

      fraudScreeningId: {
        type: String,
        trim: true,
        maxlength:
          MAX_SCREENING_ID_LENGTH,
        immutable: true,
        index: true,
        sparse: true,
      },

      amlScreeningId: {
        type: String,
        trim: true,
        maxlength:
          MAX_SCREENING_ID_LENGTH,
        immutable: true,
        index: true,
        sparse: true,
      },

      complianceDecisionId: {
        type: String,
        trim: true,
        maxlength:
          MAX_SCREENING_ID_LENGTH,
        immutable: true,
        index: true,
        sparse: true,
      },

      riskDecision: {
        type: String,
        enum: [
          "APPROVE",
          "REVIEW",
          "BLOCK",
        ],
        uppercase: true,
        trim: true,
        immutable: true,
        sparse: true,
      },

      /**
       * ========================================================================
       * METADATA
       * ========================================================================
       *
       * Metadata is contextual data only.
       *
       * It MUST NOT become the hidden financial source of truth.
       */

      metadata: {
        type: Schema.Types.Mixed,
        default: () => ({}),
      },

      /**
       * ========================================================================
       * ARCHIVAL
       * ========================================================================
       */

      archived: {
        type: Boolean,
        default: false,
        index: true,
      },

      /**
       * ========================================================================
       * LIFECYCLE TIMESTAMPS
       * ========================================================================
       */

      completedAt: {
        type: Date,
        default: null,
        immutable: true,
      },

      failedAt: {
        type: Date,
        default: null,
        immutable: true,
      },

      canceledAt: {
        type: Date,
        default: null,
        immutable: true,
      },
    },
    {
      collection:
        COLLECTION_NAME,

      strict: true,

      timestamps: true,

      versionKey: "version",

      optimisticConcurrency: true,

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
          delete ret.version;

          if (
            ret.amount !==
              undefined &&
            ret.amount !== null
          ) {
            ret.amount =
              ret.amount.toString();
          }

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
          delete ret.version;

          if (
            ret.amount !==
              undefined &&
            ret.amount !== null
          ) {
            ret.amount =
              ret.amount.toString();
          }

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

TransactionSchema.virtual(
  "isTerminal"
).get(
  function isTerminal() {
    return TERMINAL_STATUSES.includes(
      this.status
    );
  }
);

TransactionSchema.virtual(
  "isCompleted"
).get(
  function isCompleted() {
    return (
      this.status ===
      "completed"
    );
  }
);

TransactionSchema.virtual(
  "isFailed"
).get(
  function isFailed() {
    return (
      this.status ===
      "failed"
    );
  }
);

TransactionSchema.virtual(
  "isCanceled"
).get(
  function isCanceled() {
    return (
      this.status ===
      "canceled"
    );
  }
);

/**
 * ============================================================================
 * PRE-VALIDATION
 * ============================================================================
 */

TransactionSchema.pre(
  "validate",
  function normalizeTransaction(
    next
  ) {
    /**
     * Tenant must be a real ObjectId.
     */
    const tenant =
      toObjectId(
        this.tenantId
      );

    if (!tenant) {
      return next(
        new Error(
          "A valid tenantId is required for Transaction."
        )
      );
    }

    this.tenantId =
      tenant;

    /**
     * Normalize identifiers.
     */
    if (this.transactionId) {
      this.transactionId =
        String(
          this.transactionId
        ).trim();
    }

    if (this.reference) {
      this.reference =
        String(
          this.reference
        ).trim();
    }

    if (this.idempotencyKey) {
      this.idempotencyKey =
        String(
          this.idempotencyKey
        ).trim();
    }

    if (this.correlationId) {
      this.correlationId =
        String(
          this.correlationId
        ).trim();
    }

    if (this.requestId) {
      this.requestId =
        String(
          this.requestId
        ).trim();
    }

    /**
     * Normalize currency/type/status.
     */
    if (this.currency) {
      this.currency =
        String(
          this.currency
        )
          .trim()
          .toUpperCase();
    }

    if (this.type) {
      this.type =
        String(
          this.type
        )
          .trim()
          .toLowerCase();
    }

    if (this.status) {
      this.status =
        String(
          this.status
        )
          .trim()
          .toLowerCase();
    }

    /**
     * Metadata must remain an object.
     */
    if (
      this.metadata !== null &&
      (
        typeof this.metadata !==
          "object" ||
        Array.isArray(
          this.metadata
        )
      )
    ) {
      return next(
        new Error(
          "Transaction metadata must be an object."
        )
      );
    }

    /**
     * Amount remains Decimal128.
     */
    if (
      this.amount !==
        undefined &&
      this.amount !== null &&
      !(
        this.amount instanceof
        mongoose.Types.Decimal128
      )
    ) {
      try {
        this.amount =
          toDecimal128(
            this.amount
          );
      } catch (error) {
        return next(error);
      }
    }

    return next();
  }
);

/**
 * ============================================================================
 * PRE-VALIDATION STATUS RULE
 * ============================================================================
 *
 * New transactions MUST start pending.
 *
 * Services wanting an alternative initial lifecycle should create the record
 * pending and then perform an explicit transition.
 */

TransactionSchema.pre(
  "validate",
  function validateInitialStatus(
    next
  ) {
    if (
      this.isNew &&
      this.status !==
        INITIAL_STATUS
    ) {
      return next(
        new Error(
          "New transactions must start in pending status."
        )
      );
    }

    return next();
  }
);

/**
 * ============================================================================
 * DOCUMENT STATUS TRANSITION GUARD
 * ============================================================================
 *
 * IMPORTANT:
 *
 * The old implementation attempted to obtain an original status using
 * `get()`. That is not a reliable general-purpose mechanism for all document
 * update paths.
 *
 * For document saves, inspect the document's original value through the
 * internally tracked state where available. The preferred production mutation
 * path for status changes is the explicit lifecycle methods or the static
 * atomic transition helper below.
 */

TransactionSchema.pre(
  "save",
  function guardDocumentStatus(
    next
  ) {
    if (
      this.isNew ||
      !this.isModified("status")
    ) {
      return next();
    }

    /**
     * When a document was loaded from MongoDB, `$__original_save_options` is
     * not a portable original-value API. Therefore the safest rule is:
     *
     * - lifecycle methods explicitly validate from the current state;
     * - arbitrary save-based status mutation is rejected unless the transition
     *   is represented by the supported lifecycle method.
     *
     * The private marker is applied by those lifecycle methods.
     */
    const lifecycleTransition =
      this.$locals
        ?.titechLifecycleTransition;

    if (!lifecycleTransition) {
      return next(
        new Error(
          "Transaction status must be changed through an explicit lifecycle method."
        )
      );
    }

    return next();
  }
);

/**
 * ============================================================================
 * LIFECYCLE TIMESTAMP ENFORCEMENT
 * ============================================================================
 */

TransactionSchema.pre(
  "save",
  function enforceLifecycleTimestamps(
    next
  ) {
    if (
      !this.isModified(
        "status"
      )
    ) {
      return next();
    }

    switch (this.status) {
      case "completed":
        this.completedAt =
          this.completedAt ||
          new Date();
        break;

      case "failed":
        this.failedAt =
          this.failedAt ||
          new Date();
        break;

      case "canceled":
        this.canceledAt =
          this.canceledAt ||
          new Date();
        break;

      default:
        break;
    }

    return next();
  }
);

/**
 * ============================================================================
 * FINANCIAL FIELD IMMUTABILITY
 * ============================================================================
 */

TransactionSchema.pre(
  "save",
  function preventFinancialMutation(
    next
  ) {
    if (this.isNew) {
      return next();
    }

    const changedFields =
      this.modifiedPaths();

    const forbiddenChanges =
      changedFields.filter(
        (field) =>
          IMMUTABLE_FINANCIAL_FIELDS.includes(
            field
          )
      );

    if (
      forbiddenChanges.length >
      0
    ) {
      return next(
        new Error(
          `Immutable transaction fields cannot be modified: ${forbiddenChanges.join(", ")}`
        )
      );
    }

    return next();
  }
);

/**
 * ============================================================================
 * QUERY-LEVEL UPDATE PROTECTION
 * ============================================================================
 *
 * Direct query updates remain dangerous because they bypass normal document
 * lifecycle semantics.
 *
 * Immutable financial fields are categorically rejected.
 *
 * Status changes are also rejected unless a recognized lifecycle operation
 * explicitly opts into the controlled atomic transition helper.
 */

const QUERY_UPDATE_OPERATIONS =
  Object.freeze([
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "findByIdAndUpdate",
  ]);

function flattenUpdateFields(
  update
) {
  if (
    !update ||
    Array.isArray(update) ||
    typeof update !==
      "object"
  ) {
    return {};
  }

  const flattened = {};

  for (
    const [key, value]
      of Object.entries(
        update
      )
  ) {
    if (
      key.startsWith("$")
    ) {
      if (
        value &&
        typeof value ===
          "object" &&
        !Array.isArray(
          value
        )
      ) {
        for (
          const [
            nestedKey,
            nestedValue,
          ] of Object.entries(
            value
          )
        ) {
          flattened[
            nestedKey
          ] = nestedValue;
        }
      }

      continue;
    }

    flattened[key] =
      value;
  }

  return flattened;
}

function queryAllowsLifecycle(
  query
) {
  const options =
    query.getOptions?.() || {};

  return (
    options.__titechLifecycle ===
    true
  );
}

for (
  const operation of
    QUERY_UPDATE_OPERATIONS
) {
  TransactionSchema.pre(
    operation,
    function preventUnsafeUpdate(
      next
    ) {
      const update =
        this.getUpdate();

      /**
       * Pipeline updates cannot safely preserve this financial lifecycle
       * contract and are rejected.
       */
      if (
        Array.isArray(
          update
        )
      ) {
        return next(
          new Error(
            "Aggregation-pipeline updates are not permitted on Transaction."
          )
        );
      }

      const flattened =
        flattenUpdateFields(
          update
        );

      const attemptedImmutable =
        Object.keys(
          flattened
        ).filter(
          (field) =>
            IMMUTABLE_FINANCIAL_FIELDS.includes(
              field
            )
        );

      if (
        attemptedImmutable.length >
        0
      ) {
        return next(
          new Error(
            `Direct mutation of immutable transaction fields is prohibited: ${attemptedImmutable.join(", ")}`
          )
        );
      }

      /**
       * Prevent ordinary callers from bypassing lifecycle validation.
       */
      if (
        Object.prototype.hasOwnProperty.call(
          flattened,
          "status"
        ) &&
        !queryAllowsLifecycle(
          this
        )
      ) {
        return next(
          new Error(
            "Transaction status must be changed through an explicit lifecycle method."
          )
        );
      }

      return next();
    }
  );
}

/**
 * ============================================================================
 * DELETE PROTECTION
 * ============================================================================
 */

const DELETE_OPERATIONS =
  Object.freeze([
    "deleteOne",
    "deleteMany",
    "findOneAndDelete",
    "findByIdAndDelete",
  ]);

for (
  const operation of
    DELETE_OPERATIONS
) {
  TransactionSchema.pre(
    operation,
    function preventFinancialDeletion(
      next
    ) {
      return next(
        new Error(
          "Financial transaction records cannot be deleted through the application."
        )
      );
    }
  );
}

/**
 * ============================================================================
 * INDEXES
 * ============================================================================
 */

/**
 * Tenant transaction timeline.
 */
TransactionSchema.index(
  {
    tenantId: 1,
    createdAt: -1,
  },
  {
    name:
      "idx_transaction_tenant_created",
  }
);

/**
 * Tenant/type/status transaction queues.
 */
TransactionSchema.index(
  {
    tenantId: 1,
    type: 1,
    status: 1,
    createdAt: -1,
  },
  {
    name:
      "idx_transaction_tenant_type_status_created",
  }
);

/**
 * Tenant-scoped idempotency.
 */
TransactionSchema.index(
  {
    tenantId: 1,
    idempotencyKey: 1,
  },
  {
    unique: true,
    sparse: true,
    name:
      "uniq_transaction_tenant_idempotency",
  }
);

/**
 * Tenant/reference lookup.
 */
TransactionSchema.index(
  {
    tenantId: 1,
    reference: 1,
  },
  {
    sparse: true,
    name:
      "idx_transaction_tenant_reference",
  }
);

/**
 * Tenant/business transaction identity.
 */
TransactionSchema.index(
  {
    tenantId: 1,
    transactionId: 1,
  },
  {
    unique: true,
    name:
      "uniq_transaction_tenant_transaction_id",
  }
);

/**
 * Customer transaction history.
 */
TransactionSchema.index(
  {
    tenantId: 1,
    customerId: 1,
    createdAt: -1,
  },
  {
    sparse: true,
    name:
      "idx_transaction_tenant_customer_created",
  }
);

/**
 * User transaction history.
 */
TransactionSchema.index(
  {
    tenantId: 1,
    userId: 1,
    createdAt: -1,
  },
  {
    sparse: true,
    name:
      "idx_transaction_tenant_user_created",
  }
);

/**
 * Provider transaction lookup.
 */
TransactionSchema.index(
  {
    tenantId: 1,
    provider: 1,
    providerTransactionId: 1,
  },
  {
    sparse: true,
    name:
      "idx_transaction_provider_reference",
  }
);

/**
 * Correlation tracing.
 */
TransactionSchema.index(
  {
    tenantId: 1,
    correlationId: 1,
    createdAt: -1,
  },
  {
    sparse: true,
    name:
      "idx_transaction_correlation",
  }
);

/**
 * Ledger linkage.
 */
TransactionSchema.index(
  {
    tenantId: 1,
    ledgerTransactionId: 1,
  },
  {
    sparse: true,
    name:
      "idx_transaction_ledger_link",
  }
);

/**
 * Journal linkage.
 */
TransactionSchema.index(
  {
    tenantId: 1,
    journalId: 1,
  },
  {
    sparse: true,
    name:
      "idx_transaction_journal_link",
  }
);

/**
 * AML / Fraud / Compliance linkage.
 */
TransactionSchema.index(
  {
    tenantId: 1,
    fraudScreeningId: 1,
  },
  {
    sparse: true,
    name:
      "idx_transaction_fraud_screening",
  }
);

TransactionSchema.index(
  {
    tenantId: 1,
    amlScreeningId: 1,
  },
  {
    sparse: true,
    name:
      "idx_transaction_aml_screening",
  }
);

TransactionSchema.index(
  {
    tenantId: 1,
    complianceDecisionId: 1,
  },
  {
    sparse: true,
    name:
      "idx_transaction_compliance_decision",
  }
);

/**
 * Operational queue.
 */
TransactionSchema.index(
  {
    tenantId: 1,
    status: 1,
    archived: 1,
    createdAt: -1,
  },
  {
    name:
      "idx_transaction_operational_queue",
  }
);

/**
 * ============================================================================
 * STATIC QUERY HELPERS
 * ============================================================================
 */

/**
 * Find a transaction by its business transaction identity.
 */
TransactionSchema.statics.findByTransactionId =
  function findByTransactionId({
    tenantId,
    transactionId,
  } = {}) {
    const tenantObjectId =
      toObjectId(
        tenantId
      );

    if (
      !tenantObjectId ||
      !isValidStringIdentifier(
        transactionId,
        MAX_TRANSACTION_ID_LENGTH
      )
    ) {
      return this.findOne({
        _id: null,
      });
    }

    return this.findOne({
      tenantId:
        tenantObjectId,

      transactionId:
        String(
          transactionId
        ).trim(),
    });
  };

/**
 * Find by tenant-scoped idempotency key.
 */
TransactionSchema.statics.findByIdempotencyKey =
  function findByIdempotencyKey({
    tenantId,
    idempotencyKey,
  } = {}) {
    const tenantObjectId =
      toObjectId(
        tenantId
      );

    if (
      !tenantObjectId ||
      !isValidStringIdentifier(
        idempotencyKey,
        MAX_IDEMPOTENCY_KEY_LENGTH
      )
    ) {
      return this.findOne({
        _id: null,
      });
    }

    return this.findOne({
      tenantId:
        tenantObjectId,

      idempotencyKey:
        String(
          idempotencyKey
        ).trim(),
    });
  };

/**
 * Find latest customer transaction.
 */
TransactionSchema.statics.findLatestForCustomer =
  function findLatestForCustomer({
    tenantId,
    customerId,
  } = {}) {
    const tenantObjectId =
      toObjectId(
        tenantId
      );

    if (
      !tenantObjectId ||
      !isValidStringIdentifier(
        customerId
      )
    ) {
      return this.findOne({
        _id: null,
      });
    }

    return this.findOne({
      tenantId:
        tenantObjectId,

      customerId:
        String(
          customerId
        ).trim(),
    }).sort({
      createdAt: -1,
    });
  };

/**
 * Tenant-wide transaction summary.
 */
TransactionSchema.statics.summarizeTenant =
  async function summarizeTenant(
    tenantId,
    {
      from = null,
      to = null,
      status = null,
      type = null,
    } = {}
  ) {
    const tenantObjectId =
      toObjectId(
        tenantId
      );

    if (!tenantObjectId) {
      return {
        totalAmount: "0.00",
        transactionCount: 0,
      };
    }

    const match = {
      tenantId:
        tenantObjectId,
    };

    if (status) {
      match.status =
        status;
    }

    if (type) {
      match.type =
        type;
    }

    if (from || to) {
      match.createdAt = {};

      if (from) {
        match.createdAt.$gte =
          new Date(from);
      }

      if (to) {
        match.createdAt.$lte =
          new Date(to);
      }
    }

    const rows =
      await this.aggregate([
        {
          $match: match,
        },

        {
          $group: {
            _id: null,

            totalAmount: {
              $sum: "$amount",
            },

            transactionCount: {
              $sum: 1,
            },
          },
        },
      ]);

    if (
      !rows ||
      !rows[0]
    ) {
      return {
        totalAmount: "0.00",
        transactionCount: 0,
      };
    }

    return {
      totalAmount:
        decimalToString(
          rows[0]
            .totalAmount
        ),

      transactionCount:
        rows[0]
          .transactionCount,
    };
  };

/**
 * ============================================================================
 * ATOMIC STATUS TRANSITION
 * ============================================================================
 *
 * Preferred query-level lifecycle primitive for services that need atomic
 * transition semantics without loading and saving the document.
 *
 * Example:
 *
 *   await Transaction.transitionStatus({
 *     tenantId,
 *     transactionId,
 *     from: "pending",
 *     to: "completed",
 *     session
 *   });
 *
 * The transition is guarded by:
 *   - tenant
 *   - transaction identity
 *   - expected current status
 *
 * This prevents stale workers from completing a transaction that another
 * worker has already finalized.
 * ============================================================================
 */

TransactionSchema.statics.transitionStatus =
  async function transitionStatus({
    tenantId,
    transactionId,
    from,
    to,
    session = null,
  } = {}) {
    const tenantObjectId =
      toObjectId(
        tenantId
      );

    if (!tenantObjectId) {
      throw new Error(
        "A valid tenantId is required."
      );
    }

    if (
      !VALID_STATUSES.includes(
        from
      ) ||
      !VALID_STATUSES.includes(
        to
      )
    ) {
      throw new Error(
        "Invalid transaction status."
      );
    }

    const allowed =
      ALLOWED_STATUS_TRANSITIONS[
        from
      ] || [];

    if (
      !allowed.includes(to)
    ) {
      throw new Error(
        `Invalid transaction status transition: ${from} -> ${to}`
      );
    }

    const filter = {
      tenantId:
        tenantObjectId,

      transactionId:
        String(
          transactionId
        ).trim(),

      status:
        from,
    };

    const update = {
      $set: {
        status: to,
      },
    };

    if (to === "completed") {
      update.$set.completedAt =
        new Date();
    }

    if (to === "failed") {
      update.$set.failedAt =
        new Date();
    }

    if (to === "canceled") {
      update.$set.canceledAt =
        new Date();
    }

    const options = {
      new: true,
      runValidators: true,

      /**
       * Internal marker recognized only by the model's query protection
       * middleware.
       */
      __titechLifecycle:
        true,
    };

    if (session) {
      options.session =
        session;
    }

    const updated =
      await this.findOneAndUpdate(
        filter,
        update,
        options
      );

    if (!updated) {
      throw new Error(
        `Transaction transition failed. Expected status ${from} for transaction ${transactionId}.`
      );
    }

    return updated;
  };

/**
 * ============================================================================
 * LIFECYCLE INSTANCE METHODS
 * ============================================================================
 */

TransactionSchema.methods.complete =
  async function complete({
    session = null,
  } = {}) {
    if (
      this.status !==
      "pending"
    ) {
      throw new Error(
        `Transaction cannot be completed from status: ${this.status}`
      );
    }

    /**
     * Explicit lifecycle marker allows the document-save middleware to
     * distinguish authorized lifecycle transitions from arbitrary status
     * mutation.
     */
    this.$locals =
      this.$locals || {};

    this.$locals
      .titechLifecycleTransition =
      true;

    this.status =
      "completed";

    this.completedAt =
      new Date();

    return this.save(
      session
        ? { session }
        : undefined
    );
  };

TransactionSchema.methods.fail =
  async function fail({
    session = null,
  } = {}) {
    if (
      this.status !==
      "pending"
    ) {
      throw new Error(
        `Transaction cannot be failed from status: ${this.status}`
      );
    }

    this.$locals =
      this.$locals || {};

    this.$locals
      .titechLifecycleTransition =
      true;

    this.status =
      "failed";

    this.failedAt =
      new Date();

    return this.save(
      session
        ? { session }
        : undefined
    );
  };

TransactionSchema.methods.cancel =
  async function cancel({
    session = null,
  } = {}) {
    if (
      this.status !==
      "pending"
    ) {
      throw new Error(
        `Transaction cannot be canceled from status: ${this.status}`
      );
    }

    this.$locals =
      this.$locals || {};

    this.$locals
      .titechLifecycleTransition =
      true;

    this.status =
      "canceled";

    this.canceledAt =
      new Date();

    return this.save(
      session
        ? { session }
        : undefined
    );
  };

/**
 * ============================================================================
 * OPERATIONAL SUMMARY
 * ============================================================================
 */

TransactionSchema.methods.toOperationalSummary =
  function toOperationalSummary() {
    return {
      id:
        this._id,

      transactionId:
        this.transactionId,

      tenantId:
        this.tenantId,

      type:
        this.type,

      amount:
        decimalToString(
          this.amount
        ),

      currency:
        this.currency,

      status:
        this.status,

      reference:
        this.reference,

      provider:
        this.provider,

      providerTransactionId:
        this.providerTransactionId,

      correlationId:
        this.correlationId,

      requestId:
        this.requestId,

      userId:
        this.userId,

      customerId:
        this.customerId,

      journalId:
        this.journalId,

      ledgerTransactionId:
        this.ledgerTransactionId,

      fraudScreeningId:
        this.fraudScreeningId,

      amlScreeningId:
        this.amlScreeningId,

      complianceDecisionId:
        this.complianceDecisionId,

      createdAt:
        this.createdAt,

      updatedAt:
        this.updatedAt,

      completedAt:
        this.completedAt,

      failedAt:
        this.failedAt,

      canceledAt:
        this.canceledAt,
    };
  };

/**
 * ============================================================================
 * FINANCIAL SNAPSHOT
 * ============================================================================
 */

TransactionSchema.methods.getFinancialSnapshot =
  function getFinancialSnapshot() {
    return {
      transactionId:
        this.transactionId,

      tenantId:
        this.tenantId,

      type:
        this.type,

      amount:
        decimalToString(
          this.amount
        ),

      currency:
        this.currency,

      status:
        this.status,

      idempotencyKey:
        this.idempotencyKey,

      debitAccountId:
        this.debitAccountId,

      creditAccountId:
        this.creditAccountId,

      journalId:
        this.journalId,

      ledgerTransactionId:
        this.ledgerTransactionId,

      provider:
        this.provider,

      providerTransactionId:
        this.providerTransactionId,

      reconciliationRequired:
        !this.ledgerTransactionId,
    };
  };

/**
 * ============================================================================
 * MODEL METADATA
 * ============================================================================
 */

export const TRANSACTION_MODEL_METADATA =
  Object.freeze({
    modelName:
      MODEL_NAME,

    collection:
      COLLECTION_NAME,

    schemaVersion: 2,

    tenantField:
      "tenantId",

    tenantFieldType:
      "ObjectId",

    financialEntity:
      true,

    ledgerAuthority:
      false,

    transactionPostingAuthority:
      "TransactionService",

    accountingAuthority:
      "Ledger",

    monetaryType:
      "Decimal128",

    amountTransport:
      "string",

    idempotencyScope:
      "tenant",

    transactionIdentityScope:
      "tenant",

    reversalModel:
      "new transaction",

    deletionPolicy:
      "application-delete-prohibited",

    concurrency:
      "optimistic + atomic status predicate",
  });

/**
 * ============================================================================
 * MODEL REGISTRATION
 * ============================================================================
 */

export const Transaction =
  mongoose.models[
    MODEL_NAME
  ] ||
  mongoose.model(
    MODEL_NAME,
    TransactionSchema
  );

/**
 * ============================================================================
 * ESM EXPORTS
 * ============================================================================
 */

export {
  TransactionSchema,
};

export default Transaction;