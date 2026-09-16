/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/models/Wallet.js
 *
 * Architectural Role:
 *   Canonical stored-value wallet state aggregate for the TITech Community
 *   Capital platform.
 *
 * Purpose:
 *   Persist the current monetary state and operational lifecycle of a wallet
 *   owned by a user within a tenant.
 *
 * Responsibilities:
 *   - Persist tenant-scoped wallet ownership and identity.
 *   - Persist authoritative wallet balance state.
 *   - Persist bounded operational financial aggregates.
 *   - Enforce wallet-level monetary invariants.
 *   - Provide guarded atomic credit/debit primitives for the financial service.
 *   - Provide controlled wallet lifecycle transitions.
 *   - Provide wallet lookup/query helpers.
 *   - Serialize Decimal128 monetary values safely.
 *
 * Non-Responsibilities:
 *   - This model is NOT the double-entry ledger.
 *   - This model does NOT create accounting journal entries.
 *   - This model does NOT decide authorization or tenant membership.
 *   - This model does NOT perform payment-provider orchestration.
 *   - This model does NOT establish financial transaction idempotency.
 *   - This model does NOT perform transfers between wallets.
 *   - This model does NOT independently prove or reconcile external funds.
 *   - This model does NOT replace FinancialTransactionService.
 *
 * Financial Architecture Boundary:
 *   Wallet.balance is current stored-value state.
 *
 *   Transaction / Payment / PaymentIntent:
 *     External or business transaction lifecycle.
 *
 *   Ledger:
 *     Double-entry accounting source of record.
 *
 *   Account / Balance:
 *     Platform accounting and financial-control aggregates where applicable.
 *
 *   FinancialTransactionService:
 *     Canonical orchestration boundary for money movement, idempotency,
 *     transaction boundaries, ledger posting, and balance synchronization.
 *
 * IMPORTANT:
 *   Do not perform ordinary JavaScript arithmetic against Decimal128 values.
 *
 *   Concurrent balance changes MUST use the guarded static atomic methods:
 *
 *     Wallet.atomicCredit(...)
 *     Wallet.atomicDebit(...)
 *
 *   The financial service should normally invoke these operations inside the
 *   same MongoDB transaction/session that coordinates the corresponding
 *   transaction and ledger workflow.
 *
 * Idempotency:
 *   Wallet-level lastMutationReference is operational metadata only.
 *
 *   It is NOT an idempotency ledger and MUST NOT be treated as proof that a
 *   mutation has or has not already occurred.
 *
 *   Authoritative idempotency belongs to the canonical transaction/payment
 *   workflow using a durable unique key.
 *
 * Security Principles:
 *   - Tenant isolation is mandatory.
 *   - Monetary fields use Decimal128.
 *   - Raw floating-point financial arithmetic is prohibited.
 *   - Generic document mutation APIs are blocked.
 *   - Hard deletion is blocked.
 *   - Financial fields cannot be changed through ordinary document saves.
 *   - Metadata is bounded and rejects MongoDB operator/path-like keys.
 *   - Lifecycle mutations are explicit and controlled.
 *   - Business authorization remains outside the model.
 *
 * Module Format:
 *   Native ECMAScript Modules (ESM).
 *
 * =============================================================================
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * =============================================================================
 * CONSTANTS
 * =============================================================================
 */

export const WALLET_STATUSES = Object.freeze([
  'active',
  'frozen',
  'suspended',
  'closed',
]);

export const DEFAULT_CURRENCY = 'UGX';

export const MAX_METADATA_KEYS = 100;
export const MAX_METADATA_STRING_LENGTH = 2048;
export const MAX_METADATA_DEPTH = 4;

const MONEY_PATTERN = /^\d+(?:\.\d{1,18})?$/;

const INTERNAL_MUTATION = Symbol('titech.wallet.internalMutation');

const INTERNAL_MUTATIONS = Object.freeze({
  ATOMIC_FINANCIAL: 'atomic-financial',
  LIFECYCLE: 'lifecycle',
  SYSTEM: 'system',
});

/**
 * =============================================================================
 * ERROR TYPES
 * =============================================================================
 */

export class WalletModelError extends Error {
  constructor(message, code = 'WALLET_MODEL_ERROR') {
    super(message);
    this.name = 'WalletModelError';
    this.code = code;
  }
}

export class WalletFinancialMutationError extends WalletModelError {
  constructor(message, code = 'WALLET_FINANCIAL_MUTATION_ERROR') {
    super(message, code);
    this.name = 'WalletFinancialMutationError';
  }
}

export class WalletStateError extends WalletModelError {
  constructor(message, code = 'WALLET_STATE_ERROR') {
    super(message, code);
    this.name = 'WalletStateError';
  }
}

/**
 * =============================================================================
 * MONEY HELPERS
 * =============================================================================
 */

/**
 * Normalize a monetary input into a Decimal128-safe canonical string.
 *
 * JavaScript Number is accepted only when it can be represented as a safe
 * integer or finite ordinary application number. High-precision monetary
 * values should be supplied as strings.
 *
 * @param {number|string|mongoose.Types.Decimal128} value
 * @returns {string}
 */
export function normalizeMoney(value) {
  if (value === null || value === undefined || value === '') {
    return '0';
  }

  if (value instanceof mongoose.Types.Decimal128) {
    return value.toString();
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Monetary amount must be finite');
    }

    if (
      !Number.isSafeInteger(value) &&
      Math.abs(value) >= Number.MAX_SAFE_INTEGER
    ) {
      throw new TypeError(
        'Monetary amount exceeds JavaScript safe integer precision; use a string',
      );
    }

    return String(value);
  }

  if (typeof value !== 'string') {
    throw new TypeError(
      'Monetary amount must be a string, number, or Decimal128',
    );
  }

  const normalized = value.trim();

  if (!MONEY_PATTERN.test(normalized)) {
    throw new TypeError(
      'Invalid monetary amount; expected a non-negative decimal string with up to 18 fractional digits',
    );
  }

  return normalized;
}

/**
 * Convert a monetary input into Decimal128.
 *
 * @param {number|string|mongoose.Types.Decimal128} value
 * @returns {mongoose.Types.Decimal128}
 */
export function toDecimal128(value) {
  return mongoose.Types.Decimal128.fromString(normalizeMoney(value));
}

/**
 * Assert a strictly positive monetary amount.
 *
 * @param {number|string|mongoose.Types.Decimal128} amount
 * @returns {mongoose.Types.Decimal128}
 */
export function assertPositiveAmount(amount) {
  const normalized = normalizeMoney(amount);

  if (normalized === '0') {
    throw new RangeError('Amount must be greater than zero');
  }

  return mongoose.Types.Decimal128.fromString(normalized);
}

/**
 * Convert Decimal128 to an API-safe string.
 *
 * @param {mongoose.Types.Decimal128|null|undefined} value
 * @returns {string}
 */
export function decimalToString(value) {
  if (value === null || value === undefined) {
    return '0';
  }

  return value.toString();
}

/**
 * Return whether Decimal128 represents zero without converting to Number.
 *
 * @param {mongoose.Types.Decimal128|null|undefined} value
 * @returns {boolean}
 */
function isZeroDecimal(value) {
  if (value === null || value === undefined) {
    return true;
  }

  const normalized = value.toString();

  return /^0(?:\.0*)?$/.test(normalized);
}

/**
 * Return whether a Decimal128 string is negative.
 *
 * @param {mongoose.Types.Decimal128|string} value
 * @returns {boolean}
 */
function isNegativeDecimal(value) {
  return String(value).startsWith('-');
}

/**
 * =============================================================================
 * METADATA VALIDATION
 * =============================================================================
 */

/**
 * Validate bounded operational metadata.
 *
 * Metadata is intentionally constrained because Schema.Types.Mixed otherwise
 * allows effectively unbounded arbitrary structures.
 *
 * @param {*} value
 * @param {number} depth
 */
function validateMetadataValue(value, depth = 0) {
  if (depth > MAX_METADATA_DEPTH) {
    throw new TypeError(
      `Wallet metadata cannot exceed depth ${MAX_METADATA_DEPTH}`,
    );
  }

  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return;
  }

  if (typeof value === 'string') {
    if (value.length > MAX_METADATA_STRING_LENGTH) {
      throw new TypeError(
        `Wallet metadata strings cannot exceed ${MAX_METADATA_STRING_LENGTH} characters`,
      );
    }

    return;
  }

  if (Array.isArray(value)) {
    if (value.length > MAX_METADATA_KEYS) {
      throw new TypeError(
        `Wallet metadata arrays cannot contain more than ${MAX_METADATA_KEYS} items`,
      );
    }

    for (const item of value) {
      validateMetadataValue(item, depth + 1);
    }

    return;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value);

    if (keys.length > MAX_METADATA_KEYS) {
      throw new TypeError(
        `Wallet metadata cannot contain more than ${MAX_METADATA_KEYS} keys`,
      );
    }

    for (const key of keys) {
      if (key.startsWith('$') || key.includes('.')) {
        throw new TypeError(
          `Wallet metadata contains unsafe key "${key}"`,
        );
      }

      validateMetadataValue(value[key], depth + 1);
    }

    return;
  }

  throw new TypeError(
    'Wallet metadata contains an unsupported value type',
  );
}

/**
 * =============================================================================
 * COMMON OPTIONS
 * =============================================================================
 */

function applySession(options, session) {
  if (session) {
    options.session = session;
  }

  return options;
}

function markInternalMutation(document, type) {
  document[INTERNAL_MUTATION] = type;
}

function isInternalMutation(document, type) {
  return document?.[INTERNAL_MUTATION] === type;
}

/**
 * =============================================================================
 * WALLET SCHEMA
 * =============================================================================
 */

const WalletSchema = new Schema(
  {
    /**
     * ===========================================================================
     * OWNERSHIP / MULTI-TENANCY
     * ===========================================================================
     */

    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
      index: true,
    },

    /**
     * Current TITech Community Capital tenancy convention uses a stable
     * application-level tenant identifier rather than coupling the financial
     * aggregate to a Tenant MongoDB ObjectId.
     */
    tenantId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      minlength: 1,
      maxlength: 128,
      index: true,
    },

    /**
     * ===========================================================================
     * WALLET IDENTIFICATION
     * ===========================================================================
     */

    walletNumber: {
      type: String,
      trim: true,
      uppercase: true,
      immutable: true,
      minlength: 3,
      maxlength: 64,
      default: null,
    },

    /**
     * ===========================================================================
     * FINANCIAL BALANCE
     * ===========================================================================
     */

    balance: {
      type: Schema.Types.Decimal128,
      required: true,
      default: () => mongoose.Types.Decimal128.fromString('0'),
      validate: {
        validator(value) {
          if (value === null || value === undefined) {
            return false;
          }

          return !isNegativeDecimal(value);
        },
        message: 'Wallet balance cannot be negative',
      },
    },

    currency: {
      type: String,
      required: true,
      immutable: true,
      default: DEFAULT_CURRENCY,
      uppercase: true,
      trim: true,
      minlength: 3,
      maxlength: 3,
      validate: {
        validator(value) {
          return /^[A-Z]{3}$/.test(value);
        },
        message: 'Currency must be a valid ISO 4217 three-letter code',
      },
    },

    /**
     * ===========================================================================
     * LIFECYCLE
     * ===========================================================================
     */

    status: {
      type: String,
      enum: WALLET_STATUSES,
      default: 'active',
      required: true,
      index: true,
    },

    /**
     * ===========================================================================
     * FINANCIAL ACTIVITY AGGREGATES
     * ===========================================================================
     *
     * These are denormalized operational counters.
     *
     * They are not substitutes for the transaction history or accounting
     * ledger.
     */

    lastTransactionAt: {
      type: Date,
      default: null,
      index: true,
    },

    lastCreditAt: {
      type: Date,
      default: null,
    },

    lastDebitAt: {
      type: Date,
      default: null,
    },

    totalCredits: {
      type: Schema.Types.Decimal128,
      required: true,
      default: () => mongoose.Types.Decimal128.fromString('0'),
      validate: {
        validator(value) {
          return value !== null && !isNegativeDecimal(value);
        },
        message: 'Wallet total credits cannot be negative',
      },
    },

    totalDebits: {
      type: Schema.Types.Decimal128,
      required: true,
      default: () => mongoose.Types.Decimal128.fromString('0'),
      validate: {
        validator(value) {
          return value !== null && !isNegativeDecimal(value);
        },
        message: 'Wallet total debits cannot be negative',
      },
    },

    transactionCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator(value) {
          return Number.isSafeInteger(value) && value >= 0;
        },
        message: 'Wallet transaction count must be a non-negative safe integer',
      },
    },

    /**
     * ===========================================================================
     * OPERATIONAL MUTATION METADATA
     * ===========================================================================
     *
     * This field is descriptive metadata only.
     *
     * It must NEVER be used as the authoritative idempotency mechanism.
     */

    lastMutationReference: {
      type: String,
      trim: true,
      maxlength: 200,
      default: null,
    },

    /**
     * ===========================================================================
     * OPERATIONAL METADATA
     * ===========================================================================
     *
     * Metadata must not contain secrets, credentials, access tokens, raw payment
     * payloads, or unrestricted request data.
     */

    metadata: {
      type: Schema.Types.Mixed,
      default: () => ({}),
    },

    /**
     * ===========================================================================
     * AUDIT ATTRIBUTION
     * ===========================================================================
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

    /**
     * ===========================================================================
     * SOFT DELETE / ARCHIVAL
     * ===========================================================================
     */

    isDeleted: {
      type: Boolean,
      required: true,
      default: false,
      index: true,
    },

    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },

    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,

    optimisticConcurrency: true,

    versionKey: '__v',

    minimize: false,

    strict: true,

    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        if (ret._id) {
          ret.id = ret._id.toString();
        }

        if (ret.balance !== undefined) {
          ret.balance = decimalToString(ret.balance);
        }

        if (ret.totalCredits !== undefined) {
          ret.totalCredits = decimalToString(ret.totalCredits);
        }

        if (ret.totalDebits !== undefined) {
          ret.totalDebits = decimalToString(ret.totalDebits);
        }

        delete ret._id;

        return ret;
      },
    },

    toObject: {
      virtuals: true,
      transform(_doc, ret) {
        if (ret._id) {
          ret.id = ret._id.toString();
        }

        if (ret.balance !== undefined) {
          ret.balance = decimalToString(ret.balance);
        }

        if (ret.totalCredits !== undefined) {
          ret.totalCredits = decimalToString(ret.totalCredits);
        }

        if (ret.totalDebits !== undefined) {
          ret.totalDebits = decimalToString(ret.totalDebits);
        }

        delete ret._id;

        return ret;
      },
    },
  },
);

/**
 * =============================================================================
 * INDEXES
 * =============================================================================
 */

/**
 * Financial invariant:
 * one wallet per user per tenant.
 */
WalletSchema.index(
  {
    tenantId: 1,
    userId: 1,
  },
  {
    unique: true,
    name: 'uniq_wallet_tenant_user',
  },
);

/**
 * Wallet number is unique within a tenant when present.
 */
WalletSchema.index(
  {
    tenantId: 1,
    walletNumber: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      walletNumber: {
        $type: 'string',
      },
    },
    name: 'uniq_wallet_tenant_wallet_number',
  },
);

/**
 * Operational lookup.
 */
WalletSchema.index(
  {
    tenantId: 1,
    status: 1,
    isDeleted: 1,
  },
  {
    name: 'idx_wallet_tenant_status_deleted',
  },
);

/**
 * Activity history / operational dashboards.
 *
 * _id provides a deterministic tie-breaker when timestamps collide.
 */
WalletSchema.index(
  {
    tenantId: 1,
    lastTransactionAt: -1,
    _id: -1,
  },
  {
    name: 'idx_wallet_tenant_last_transaction',
  },
);

/**
 * Currency-specific operational queries.
 */
WalletSchema.index(
  {
    tenantId: 1,
    currency: 1,
    isDeleted: 1,
  },
  {
    name: 'idx_wallet_tenant_currency_deleted',
  },
);

/**
 * Soft-deleted wallet maintenance.
 */
WalletSchema.index(
  {
    tenantId: 1,
    isDeleted: 1,
    deletedAt: -1,
  },
  {
    name: 'idx_wallet_tenant_deleted_at',
  },
);

/**
 * =============================================================================
 * VIRTUALS
 * =============================================================================
 */

WalletSchema.virtual('isActive').get(function isActive() {
  return this.status === 'active' && !this.isDeleted;
});

WalletSchema.virtual('isFrozen').get(function isFrozen() {
  return this.status === 'frozen' && !this.isDeleted;
});

WalletSchema.virtual('isSuspended').get(function isSuspended() {
  return this.status === 'suspended' && !this.isDeleted;
});

WalletSchema.virtual('isClosed').get(function isClosed() {
  return this.status === 'closed' || this.isDeleted;
});

/**
 * =============================================================================
 * INSTANCE METHODS — STATE ASSERTIONS
 * =============================================================================
 */

/**
 * Assert that the wallet can participate in a financial operation.
 *
 * @returns {true}
 */
WalletSchema.methods.assertOperational = function assertOperational() {
  if (this.isDeleted) {
    throw new WalletStateError(
      'Wallet is deleted',
      'WALLET_DELETED',
    );
  }

  if (this.status !== 'active') {
    throw new WalletStateError(
      `Wallet is not active: ${this.status}`,
      'WALLET_NOT_ACTIVE',
    );
  }

  return true;
};

/**
 * Assert that wallet balance is zero.
 *
 * @returns {true}
 */
WalletSchema.methods.assertZeroBalance = function assertZeroBalance() {
  if (!isZeroDecimal(this.balance)) {
    throw new WalletStateError(
      'Wallet balance must be zero',
      'WALLET_NON_ZERO_BALANCE',
    );
  }

  return true;
};

/**
 * =============================================================================
 * INSTANCE METHODS — LIFECYCLE
 * =============================================================================
 */

/**
 * Freeze wallet.
 *
 * Business authorization and reason capture remain in the service/audit layer.
 *
 * @param {mongoose.Types.ObjectId|null} updatedBy
 * @returns {Promise<Wallet>}
 */
WalletSchema.methods.freeze = async function freeze(updatedBy = null) {
  if (this.isDeleted) {
    throw new WalletStateError(
      'Deleted wallet cannot be frozen',
      'WALLET_DELETED',
    );
  }

  if (this.status === 'closed') {
    throw new WalletStateError(
      'Closed wallet cannot be frozen',
      'WALLET_CLOSED',
    );
  }

  if (this.status === 'frozen') {
    return this;
  }

  this.status = 'frozen';

  if (updatedBy) {
    this.updatedBy = updatedBy;
  }

  markInternalMutation(this, INTERNAL_MUTATIONS.LIFECYCLE);

  return this.save();
};

/**
 * Suspend wallet.
 *
 * @param {mongoose.Types.ObjectId|null} updatedBy
 * @returns {Promise<Wallet>}
 */
WalletSchema.methods.suspend = async function suspend(updatedBy = null) {
  if (this.isDeleted) {
    throw new WalletStateError(
      'Deleted wallet cannot be suspended',
      'WALLET_DELETED',
    );
  }

  if (this.status === 'closed') {
    throw new WalletStateError(
      'Closed wallet cannot be suspended',
      'WALLET_CLOSED',
    );
  }

  if (this.status === 'suspended') {
    return this;
  }

  this.status = 'suspended';

  if (updatedBy) {
    this.updatedBy = updatedBy;
  }

  markInternalMutation(this, INTERNAL_MUTATIONS.LIFECYCLE);

  return this.save();
};

/**
 * Activate wallet.
 *
 * @param {mongoose.Types.ObjectId|null} updatedBy
 * @returns {Promise<Wallet>}
 */
WalletSchema.methods.activate = async function activate(updatedBy = null) {
  if (this.isDeleted) {
    throw new WalletStateError(
      'Deleted wallet cannot be activated',
      'WALLET_DELETED',
    );
  }

  if (this.status === 'closed') {
    throw new WalletStateError(
      'Closed wallet cannot be activated',
      'WALLET_CLOSED',
    );
  }

  if (this.status === 'active') {
    return this;
  }

  this.status = 'active';

  if (updatedBy) {
    this.updatedBy = updatedBy;
  }

  markInternalMutation(this, INTERNAL_MUTATIONS.LIFECYCLE);

  return this.save();
};

/**
 * Close wallet.
 *
 * A wallet with remaining stored value cannot normally be closed.
 *
 * @param {mongoose.Types.ObjectId|null} updatedBy
 * @returns {Promise<Wallet>}
 */
WalletSchema.methods.close = async function close(updatedBy = null) {
  if (this.isDeleted) {
    throw new WalletStateError(
      'Deleted wallet is already closed',
      'WALLET_DELETED',
    );
  }

  this.assertZeroBalance();

  if (this.status === 'closed') {
    return this;
  }

  this.status = 'closed';

  if (updatedBy) {
    this.updatedBy = updatedBy;
  }

  markInternalMutation(this, INTERNAL_MUTATIONS.LIFECYCLE);

  return this.save();
};

/**
 * Soft-delete / archive wallet.
 *
 * Financially funded wallets cannot be deleted merely as an administrative
 * convenience.
 *
 * @param {mongoose.Types.ObjectId|null} deletedBy
 * @returns {Promise<Wallet>}
 */
WalletSchema.methods.softDelete = async function softDelete(
  deletedBy = null,
) {
  if (this.isDeleted) {
    return this;
  }

  this.assertZeroBalance();

  this.isDeleted = true;
  this.deletedAt = new Date();
  this.status = 'closed';

  if (deletedBy) {
    this.deletedBy = deletedBy;
    this.updatedBy = deletedBy;
  }

  markInternalMutation(this, INTERNAL_MUTATIONS.LIFECYCLE);

  return this.save();
};

/**
 * =============================================================================
 * STATIC FINANCIAL MUTATIONS
 * =============================================================================
 */

/**
 * Atomic credit.
 *
 * This is a low-level wallet state primitive.
 *
 * It is intentionally NOT an idempotency mechanism and should normally be
 * invoked by FinancialTransactionService inside an appropriate MongoDB session.
 *
 * @param {Object} options
 * @param {mongoose.Types.ObjectId|string} options.walletId
 * @param {string} options.tenantId
 * @param {number|string|mongoose.Types.Decimal128} options.amount
 * @param {string|null} [options.reference]
 * @param {mongoose.Types.ObjectId|null} [options.updatedBy]
 * @param {mongoose.ClientSession|null} [options.session]
 * @param {number|null} [options.expectedVersion]
 * @returns {Promise<Wallet>}
 */
WalletSchema.statics.atomicCredit = async function atomicCredit({
  walletId,
  tenantId,
  amount,
  reference = null,
  updatedBy = null,
  session = null,
  expectedVersion = null,
} = {}) {
  if (!walletId) {
    throw new WalletFinancialMutationError(
      'walletId is required',
      'WALLET_ID_REQUIRED',
    );
  }

  if (!tenantId) {
    throw new WalletFinancialMutationError(
      'tenantId is required',
      'TENANT_ID_REQUIRED',
    );
  }

  const creditAmount = assertPositiveAmount(amount);
  const now = new Date();

  const filter = {
    _id: walletId,
    tenantId: String(tenantId),
    status: 'active',
    isDeleted: false,
  };

  if (expectedVersion !== null && expectedVersion !== undefined) {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      throw new WalletFinancialMutationError(
        'expectedVersion must be a non-negative safe integer',
        'INVALID_EXPECTED_VERSION',
      );
    }

    filter.__v = expectedVersion;
  }

  const update = {
    $inc: {
      balance: creditAmount,
      totalCredits: creditAmount,
      transactionCount: 1,
      __v: 1,
    },
    $set: {
      lastTransactionAt: now,
      lastCreditAt: now,
      ...(reference !== null
        ? {
            lastMutationReference: reference,
          }
        : {}),
      ...(updatedBy
        ? {
            updatedBy,
          }
        : {}),
    },
  };

  const options = applySession(
    {
      new: true,
      runValidators: true,
      context: 'query',
      _allowWalletMutation: INTERNAL_MUTATIONS.ATOMIC_FINANCIAL,
    },
    session,
  );

  const wallet = await this.findOneAndUpdate(
    filter,
    update,
    options,
  );

  if (!wallet) {
    throw new WalletFinancialMutationError(
      'Active wallet not found or optimistic-concurrency check failed during atomic credit',
      'WALLET_CREDIT_FAILED',
    );
  }

  return wallet;
};

/**
 * Atomic debit.
 *
 * The MongoDB predicate balance >= amount ensures competing debit operations
 * cannot both consume the same insufficient funds.
 *
 * @param {Object} options
 * @param {mongoose.Types.ObjectId|string} options.walletId
 * @param {string} options.tenantId
 * @param {number|string|mongoose.Types.Decimal128} options.amount
 * @param {string|null} [options.reference]
 * @param {mongoose.Types.ObjectId|null} [options.updatedBy]
 * @param {mongoose.ClientSession|null} [options.session]
 * @param {number|null} [options.expectedVersion]
 * @returns {Promise<Wallet>}
 */
WalletSchema.statics.atomicDebit = async function atomicDebit({
  walletId,
  tenantId,
  amount,
  reference = null,
  updatedBy = null,
  session = null,
  expectedVersion = null,
} = {}) {
  if (!walletId) {
    throw new WalletFinancialMutationError(
      'walletId is required',
      'WALLET_ID_REQUIRED',
    );
  }

  if (!tenantId) {
    throw new WalletFinancialMutationError(
      'tenantId is required',
      'TENANT_ID_REQUIRED',
    );
  }

  const debitAmount = assertPositiveAmount(amount);
  const negativeDebit = mongoose.Types.Decimal128.fromString(
    `-${debitAmount.toString()}`,
  );

  const now = new Date();

  const filter = {
    _id: walletId,
    tenantId: String(tenantId),
    status: 'active',
    isDeleted: false,
    balance: {
      $gte: debitAmount,
    },
  };

  if (expectedVersion !== null && expectedVersion !== undefined) {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      throw new WalletFinancialMutationError(
        'expectedVersion must be a non-negative safe integer',
        'INVALID_EXPECTED_VERSION',
      );
    }

    filter.__v = expectedVersion;
  }

  const update = {
    $inc: {
      balance: negativeDebit,
      totalDebits: debitAmount,
      transactionCount: 1,
      __v: 1,
    },
    $set: {
      lastTransactionAt: now,
      lastDebitAt: now,
      ...(reference !== null
        ? {
            lastMutationReference: reference,
          }
        : {}),
      ...(updatedBy
        ? {
            updatedBy,
          }
        : {}),
    },
  };

  const options = applySession(
    {
      new: true,
      runValidators: true,
      context: 'query',
      _allowWalletMutation: INTERNAL_MUTATIONS.ATOMIC_FINANCIAL,
    },
    session,
  );

  const wallet = await this.findOneAndUpdate(
    filter,
    update,
    options,
  );

  if (!wallet) {
    throw new WalletFinancialMutationError(
      'Insufficient funds, inactive wallet, deleted wallet, missing wallet, or optimistic-concurrency conflict',
      'WALLET_DEBIT_FAILED',
    );
  }

  return wallet;
};

/**
 * =============================================================================
 * STATIC LOOKUPS
 * =============================================================================
 */

/**
 * Find the current wallet for a user in a tenant.
 *
 * @param {string} tenantId
 * @param {mongoose.Types.ObjectId|string} userId
 * @returns {mongoose.Query}
 */
WalletSchema.statics.findByUser = function findByUser(
  tenantId,
  userId,
) {
  return this.findOne({
    tenantId: String(tenantId),
    userId,
    isDeleted: false,
  });
};

/**
 * Find wallet by tenant-scoped wallet number.
 *
 * @param {string} tenantId
 * @param {string} walletNumber
 * @returns {mongoose.Query}
 */
WalletSchema.statics.findByWalletNumber =
  function findByWalletNumber(tenantId, walletNumber) {
    const normalizedWalletNumber = String(walletNumber)
      .trim()
      .toUpperCase();

    return this.findOne({
      tenantId: String(tenantId),
      walletNumber: normalizedWalletNumber,
      isDeleted: false,
    });
  };

/**
 * Find active wallet by user.
 *
 * @param {string} tenantId
 * @param {mongoose.Types.ObjectId|string} userId
 * @returns {mongoose.Query}
 */
WalletSchema.statics.findActive = function findActive(
  tenantId,
  userId,
) {
  return this.findOne({
    tenantId: String(tenantId),
    userId,
    status: 'active',
    isDeleted: false,
  });
};

/**
 * =============================================================================
 * PRE-SAVE FINANCIAL PROTECTION
 * =============================================================================
 *
 * Ordinary document saves cannot modify authoritative financial fields.
 *
 * Financial changes are permitted only through the guarded atomic methods.
 */

WalletSchema.pre('save', function walletPreSave(next) {
  try {
    const isNew = this.isNew;
    const internalMutation = this[INTERNAL_MUTATION];

    /**
     * Normalize immutable textual values.
     */
    if (this.currency) {
      this.currency = this.currency.trim().toUpperCase();
    }

    if (this.tenantId) {
      this.tenantId = String(this.tenantId).trim();
    }

    if (this.walletNumber) {
      this.walletNumber = this.walletNumber.trim().toUpperCase();
    }

    /**
     * Normalize Decimal128-backed fields.
     */
    if (this.balance !== undefined) {
      this.balance = toDecimal128(this.balance);
    }

    if (this.totalCredits !== undefined) {
      this.totalCredits = toDecimal128(this.totalCredits);
    }

    if (this.totalDebits !== undefined) {
      this.totalDebits = toDecimal128(this.totalDebits);
    }

    /**
     * Financial invariants.
     */
    if (this.balance === null || this.balance === undefined) {
      throw new WalletFinancialMutationError(
        'Wallet balance is required',
        'BALANCE_REQUIRED',
      );
    }

    if (isNegativeDecimal(this.balance)) {
      throw new WalletFinancialMutationError(
        'Wallet balance cannot be negative',
        'NEGATIVE_BALANCE',
      );
    }

    if (isNegativeDecimal(this.totalCredits)) {
      throw new WalletFinancialMutationError(
        'Wallet total credits cannot be negative',
        'NEGATIVE_TOTAL_CREDITS',
      );
    }

    if (isNegativeDecimal(this.totalDebits)) {
      throw new WalletFinancialMutationError(
        'Wallet total debits cannot be negative',
        'NEGATIVE_TOTAL_DEBITS',
      );
    }

    if (
      !Number.isSafeInteger(this.transactionCount) ||
      this.transactionCount < 0
    ) {
      throw new WalletFinancialMutationError(
        'Wallet transaction count must be a non-negative safe integer',
        'INVALID_TRANSACTION_COUNT',
      );
    }

    /**
     * New wallet creation is permitted.
     *
     * Existing wallet financial fields may not be altered through ordinary
     * save()/document mutation.
     */
    if (!isNew && internalMutation !== INTERNAL_MUTATIONS.ATOMIC_FINANCIAL) {
      const protectedFinancialFields = [
        'balance',
        'totalCredits',
        'totalDebits',
        'transactionCount',
        'lastTransactionAt',
        'lastCreditAt',
        'lastDebitAt',
        'lastMutationReference',
      ];

      const illegallyModified = protectedFinancialFields.filter((field) =>
        this.isModified(field),
      );

      if (illegallyModified.length > 0) {
        throw new WalletFinancialMutationError(
          `Direct wallet financial mutation is prohibited: ${illegallyModified.join(', ')}`,
          'DIRECT_FINANCIAL_MUTATION_BLOCKED',
        );
      }
    }

    /**
     * Metadata protection.
     */
    if (this.metadata !== null && this.metadata !== undefined) {
      validateMetadataValue(this.metadata);
    }

    /**
     * Lifecycle protections.
     */
    if (this.isDeleted) {
      if (!this.deletedAt) {
        this.deletedAt = new Date();
      }

      if (this.status !== 'closed') {
        throw new WalletStateError(
          'Deleted wallets must have closed status',
          'INVALID_DELETED_WALLET_STATE',
        );
      }
    }

    next();
  } catch (error) {
    next(error);
  }
});

/**
 * =============================================================================
 * QUERY MUTATION PROTECTION
 * =============================================================================
 *
 * Generic update/delete operations bypass document-level lifecycle semantics
 * and are therefore disabled.
 *
 * Controlled internals can opt in explicitly.
 */

function assertAllowedWalletQueryMutation(query) {
  const options = query.getOptions?.() ?? {};

  if (
    options._allowWalletMutation === INTERNAL_MUTATIONS.ATOMIC_FINANCIAL
  ) {
    return;
  }

  if (
    options._allowWalletMutation === INTERNAL_MUTATIONS.LIFECYCLE
  ) {
    return;
  }

  if (
    options._allowWalletMutation === INTERNAL_MUTATIONS.SYSTEM
  ) {
    return;
  }

  throw new WalletModelError(
    'Generic wallet query mutation is prohibited; use a controlled wallet method or financial service',
    'GENERIC_WALLET_MUTATION_BLOCKED',
  );
}

for (const middlewareName of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
]) {
  WalletSchema.pre(
    middlewareName,
    function walletMutationGuard(next) {
      try {
        assertAllowedWalletQueryMutation(this);
        next();
      } catch (error) {
        next(error);
      }
    },
  );
}

/**
 * =============================================================================
 * DELETE PROTECTION
 * =============================================================================
 */

for (const middlewareName of [
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'findOneAndRemove',
  'findByIdAndDelete',
  'findByIdAndRemove',
]) {
  WalletSchema.pre(
    middlewareName,
    function walletDeleteGuard(next) {
      next(
        new WalletModelError(
          'Hard deletion of wallets is prohibited',
          'WALLET_HARD_DELETE_BLOCKED',
        ),
      );
    },
  );
}

WalletSchema.pre(
  'bulkWrite',
  function walletBulkWriteGuard(next) {
    next(
      new WalletModelError(
        'bulkWrite on Wallet is prohibited; use controlled domain operations',
        'WALLET_BULK_WRITE_BLOCKED',
      ),
    );
  },
);

/**
 * =============================================================================
 * QUERY HELPERS
 * =============================================================================
 */

WalletSchema.query.active = function active() {
  return this.where({
    status: 'active',
    isDeleted: false,
  });
};

WalletSchema.query.notDeleted = function notDeleted() {
  return this.where({
    isDeleted: false,
  });
};

WalletSchema.query.forTenant = function forTenant(tenantId) {
  if (!tenantId) {
    throw new WalletModelError(
      'tenantId is required for tenant-scoped wallet queries',
      'TENANT_ID_REQUIRED',
    );
  }

  return this.where({
    tenantId: String(tenantId),
  });
};

WalletSchema.query.forUser = function forUser(userId) {
  return this.where({
    userId,
  });
};

/**
 * =============================================================================
 * MODEL REGISTRATION
 * =============================================================================
 */

const Wallet =
  mongoose.models.Wallet ||
  mongoose.model('Wallet', WalletSchema);

/**
 * Named exports preserve test/service reuse while keeping the model itself as
 * the default export contract.
 */

export default Wallet;