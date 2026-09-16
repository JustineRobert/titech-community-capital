/**
 * ============================================================================
 * backend/models/Account.js
 * TITech Community Capital LTD
 * Enterprise Financial Account Aggregate
 * ============================================================================
 *
 * Architectural role
 * ----------------------------------------------------------------------------
 * Account is the canonical operational financial-account persistence
 * aggregate for TITech Community Capital's multi-tenant SACCO and
 * community-finance platform.
 *
 * Supported account types:
 *
 *   - SAVINGS
 *   - SHARES
 *   - FIXED_DEPOSIT
 *   - LOAN
 *   - WALLET
 *   - SETTLEMENT
 *   - GL
 *
 * Account sits between financial transaction/ledger workflows and operational
 * account-state/reporting projections:
 *
 *   Transaction / Financial Service
 *                │
 *                ▼
 *           Ledger Entry
 *                │
 *                ▼
 *             Account
 *          ┌─────┴─────┐
 *          ▼           ▼
 *   Current State   Reporting
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * Account IS:
 *   - the operational source of persisted account state;
 *   - the operational source of current account balances;
 *   - the operational source of account lifecycle state;
 *   - the operational source of reconciliation/accounting-posting state;
 *   - a tenant-scoped financial persistence boundary.
 *
 * Account is NOT:
 *   - the authoritative double-entry ledger;
 *   - a transaction history store;
 *   - an authorization mechanism;
 *   - a loan approval engine;
 *   - an interest/fee calculation engine;
 *   - a payment-provider integration;
 *   - a KYC/AML decision engine;
 *   - a reconciliation engine;
 *   - a replacement for BalanceRepository;
 *   - a replacement for LedgerRepository;
 *   - a replacement for FinancialTransactionService.
 *
 * Financial design principles
 * ----------------------------------------------------------------------------
 *   - Monetary fields use MongoDB Decimal128.
 *   - Persisted monetary values are never JavaScript Number fields.
 *   - Financial calculations avoid JavaScript floating-point arithmetic.
 *   - Decimal128 values serialize as strings.
 *   - Tenant ownership is mandatory and immutable.
 *   - Account identity is immutable.
 *   - Account number is immutable.
 *   - Account type is immutable.
 *   - Currency is immutable.
 *   - Opening account state is preserved.
 *   - Current financial state is explicitly represented.
 *   - Available/blocked balances are bounded by document invariants.
 *   - Financial mutations are delegated to controlled repository/service paths.
 *   - Atomic balance operations are session-aware.
 *   - Balance mutation sequencing is tracked through revision/balanceRevision.
 *
 * Tenancy
 * ----------------------------------------------------------------------------
 * Every account belongs to exactly one TITech tenant.
 *
 * tenantId remains a String in this model to preserve compatibility with the
 * existing TITech tenancy subsystem used by the legacy account model.
 *
 * Cross-tenant authorization MUST still be enforced by services/repositories.
 *
 * Status
 * ----------------------------------------------------------------------------
 * PENDING:
 *   Account exists but is not yet operational.
 *
 * ACTIVE:
 *   Account may participate in permitted financial operations.
 *
 * DORMANT:
 *   Account remains open but has entered a non-active operational state.
 *
 * BLOCKED:
 *   Account activity has been blocked by an operational/compliance decision.
 *
 * CLOSED:
 *   Account has been permanently closed.
 *
 * Module format
 * ----------------------------------------------------------------------------
 * Native ESM.
 *
 * ============================================================================
 */

'use strict';

import mongoose from 'mongoose';

const { Schema } = mongoose;

/*
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

export const ACCOUNT_TYPES = Object.freeze([
  'SAVINGS',
  'SHARES',
  'FIXED_DEPOSIT',
  'LOAN',
  'WALLET',
  'SETTLEMENT',
  'GL',
]);

export const ACCOUNT_CATEGORIES = Object.freeze([
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'INCOME',
  'EXPENSE',
]);

export const ACCOUNT_STATUSES = Object.freeze([
  'PENDING',
  'ACTIVE',
  'DORMANT',
  'BLOCKED',
  'CLOSED',
]);

export const MOMO_PROVIDERS = Object.freeze([
  'MTN',
  'AIRTEL',
]);

export const INTEREST_RATE_TYPES = Object.freeze([
  'NONE',
  'FLAT',
  'REDUCING_BALANCE',
  'COMPOUND',
  'TIERED',
]);

export const INTEREST_ACCRUAL_FREQUENCIES =
  Object.freeze([
    'NONE',
    'DAILY',
    'WEEKLY',
    'MONTHLY',
    'QUARTERLY',
    'ANNUALLY',
  ]);

export const DECIMAL_ZERO = '0.00';

export const ACCOUNT_ID_MAX_LENGTH = 128;
export const TENANT_ID_MAX_LENGTH = 100;
export const ACCOUNT_NUMBER_MAX_LENGTH = 100;
export const OWNER_ID_MAX_LENGTH = 128;
export const TRANSACTION_ID_MAX_LENGTH = 128;
export const CURRENCY_MAX_LENGTH = 3;
export const MAX_RISK_FLAGS = 50;
export const MAX_METADATA_KEYS = 50;
export const MAX_METADATA_DEPTH = 8;
export const MAX_METADATA_STRING_LENGTH = 4096;

export const CURRENCY_REGEX = /^[A-Z]{3}$/;

export const IDENTIFIER_REGEX =
  /^[a-zA-Z0-9._:-]+$/;

/*
 * ============================================================================
 * DECIMAL128 HELPERS
 * ============================================================================
 */

/**
 * Return an exact Decimal128 zero.
 */
export function decimal128Zero() {
  return mongoose.Types.Decimal128.fromString(
    DECIMAL_ZERO,
  );
}

/**
 * Convert a value into Decimal128 without using JavaScript Number arithmetic.
 *
 * Monetary callers should normally supply strings or existing Decimal128
 * values.
 */
export function toDecimal(
  value,
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return decimal128Zero();
  }

  if (
    mongoose.isDecimal128(
      value,
    )
  ) {
    return value;
  }

  const normalized =
    String(value).trim();

  if (!normalized) {
    throw new TypeError(
      'Monetary value cannot be empty.',
    );
  }

  /*
   * Accept ordinary decimal/scientific notation but explicitly reject
   * non-finite values and negative values.
   */
  const parts =
    parseDecimal(
      normalized,
    );

  if (
    parts.sign < 0
  ) {
    throw new Error(
      `Negative monetary value is not permitted: ${normalized}`,
    );
  }

  return mongoose.Types.Decimal128.fromString(
    normalized,
  );
}

/**
 * Parse a finite decimal string exactly into:
 *
 *   coefficient / 10^scale
 *
 * This helper intentionally uses BigInt for validation/comparison only.
 */
export function parseDecimal(
  value,
) {
  const text =
    String(value)
      .trim()
      .toLowerCase();

  if (!text) {
    throw new Error(
      'Invalid decimal value.',
    );
  }

  if (
    [
      'nan',
      '+nan',
      '-nan',
      'infinity',
      '+infinity',
      '-infinity',
      'inf',
      '+inf',
      '-inf',
    ].includes(text)
  ) {
    throw new Error(
      'Non-finite decimal values are not valid monetary values.',
    );
  }

  const match =
    text.match(
      /^([+-]?)(?:(\d+)(?:\.(\d+))?|\.(\d+))(?:e([+-]?\d+))?$/,
    );

  if (!match) {
    throw new Error(
      `Invalid decimal value: ${text}`,
    );
  }

  const signChar =
    match[1] || '';

  const integerPart =
    match[2] ?? '';

  const fractionFromInteger =
    match[3] ?? '';

  const fractionOnly =
    match[4] ?? '';

  const exponent =
    Number(
      match[5] ?? '0',
    );

  if (
    !Number.isSafeInteger(
      exponent,
    )
  ) {
    throw new Error(
      'Invalid decimal exponent.',
    );
  }

  const fractionalPart =
    fractionFromInteger ||
    fractionOnly;

  const digits =
    (
      integerPart +
      fractionalPart
    ).replace(
      /^0+(?=\d)/,
      '',
    ) || '0';

  let coefficient =
    BigInt(digits);

  let scale =
    fractionalPart.length -
    exponent;

  if (
    scale < 0
  ) {
    coefficient *=
      10n **
      BigInt(-scale);

    scale = 0;
  }

  return {
    sign:
      signChar === '-'
        ? -1
        : 1,

    coefficient,

    scale,
  };
}

/**
 * Compare two finite non-negative decimal strings exactly.
 *
 * Returns:
 *   -1 left < right
 *    0 left === right
 *    1 left > right
 */
export function compareDecimals(
  left,
  right,
) {
  const a =
    parseDecimal(left);

  const b =
    parseDecimal(right);

  if (
    a.sign < 0 ||
    b.sign < 0
  ) {
    throw new Error(
      'compareDecimals only accepts non-negative decimal values.',
    );
  }

  const scale =
    Math.max(
      a.scale,
      b.scale,
    );

  const leftCoefficient =
    a.coefficient *
    10n **
      BigInt(
        scale - a.scale,
      );

  const rightCoefficient =
    b.coefficient *
    10n **
      BigInt(
        scale - b.scale,
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

/**
 * Exact subtraction for non-negative Decimal128 values.
 *
 * Requires left >= right.
 */
export function subtractDecimals(
  left,
  right,
) {
  const a =
    parseDecimal(
      left.toString(),
    );

  const b =
    parseDecimal(
      right.toString(),
    );

  if (
    a.sign < 0 ||
    b.sign < 0
  ) {
    throw new Error(
      'subtractDecimals only accepts non-negative values.',
    );
  }

  const scale =
    Math.max(
      a.scale,
      b.scale,
    );

  const leftCoefficient =
    a.coefficient *
    10n **
      BigInt(
        scale - a.scale,
      );

  const rightCoefficient =
    b.coefficient *
    10n **
      BigInt(
        scale - b.scale,
      );

  if (
    leftCoefficient <
    rightCoefficient
  ) {
    throw new Error(
      'Decimal subtraction would produce a negative value.',
    );
  }

  const difference =
    leftCoefficient -
    rightCoefficient;

  let digits =
    difference.toString();

  if (
    scale === 0
  ) {
    return mongoose.Types.Decimal128.fromString(
      digits,
    );
  }

  digits =
    digits.padStart(
      scale + 1,
      '0',
    );

  const splitIndex =
    digits.length - scale;

  const integerPart =
    digits.slice(
      0,
      splitIndex,
    );

  const fractionalPart =
    digits
      .slice(
        splitIndex,
      )
      .replace(
        /0+$/,
        '',
      );

  const result =
    fractionalPart
      ? `${integerPart}.${fractionalPart}`
      : integerPart;

  return mongoose.Types.Decimal128.fromString(
    result,
  );
}

function validateNonNegativeDecimal128(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return true;
  }

  if (
    !mongoose.isDecimal128(
      value,
    )
  ) {
    return false;
  }

  try {
    const parsed =
      parseDecimal(
        value.toString(),
      );

    return (
      parsed.sign >= 0
    );
  } catch {
    return false;
  }
}

/*
 * ============================================================================
 * IDENTIFIER / METADATA HELPERS
 * ============================================================================
 */

export function validateIdentifier(
  value,
) {
  if (
    typeof value !== 'string'
  ) {
    return false;
  }

  const normalized =
    value.trim();

  return (
    normalized.length >= 1 &&
    normalized.length <=
      ACCOUNT_ID_MAX_LENGTH &&
    IDENTIFIER_REGEX.test(
      normalized,
    )
  );
}

export function validateTenantId(
  value,
) {
  if (
    typeof value !== 'string'
  ) {
    return false;
  }

  const normalized =
    value.trim().toLowerCase();

  return (
    normalized.length >= 1 &&
    normalized.length <=
      TENANT_ID_MAX_LENGTH &&
    /^[a-zA-Z0-9._:-]+$/.test(
      normalized,
    )
  );
}

function validateOptionalIdentifier(
  value,
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return true;
  }

  return validateIdentifier(
    value,
  );
}

function validateMetadata(
  value,
  depth = 0,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return;
  }

  if (
    depth > MAX_METADATA_DEPTH
  ) {
    throw new RangeError(
      `Metadata nesting exceeds ${MAX_METADATA_DEPTH} levels.`,
    );
  }

  if (
    typeof value === 'string'
  ) {
    if (
      value.length >
      MAX_METADATA_STRING_LENGTH
    ) {
      throw new RangeError(
        `Metadata string exceeds ${MAX_METADATA_STRING_LENGTH} characters.`,
      );
    }

    return;
  }

  if (
    Array.isArray(value)
  ) {
    if (
      value.length >
      MAX_METADATA_KEYS
    ) {
      throw new RangeError(
        `Metadata arrays cannot contain more than ${MAX_METADATA_KEYS} items.`,
      );
    }

    value.forEach(
      (item) =>
        validateMetadata(
          item,
          depth + 1,
        ),
    );

    return;
  }

  if (
    typeof value ===
      'object'
  ) {
    const keys =
      Object.keys(value);

    if (
      keys.length >
      MAX_METADATA_KEYS
    ) {
      throw new RangeError(
        `Metadata cannot contain more than ${MAX_METADATA_KEYS} keys.`,
      );
    }

    Object.values(value).forEach(
      (child) =>
        validateMetadata(
          child,
          depth + 1,
        ),
    );
  }
}

function decimalToString(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    mongoose.isDecimal128(
      value,
    )
  ) {
    return value.toString();
  }

  return String(value);
}

/*
 * ============================================================================
 * SCHEMA
 * ============================================================================
 */

const AccountSchema =
  new Schema(
    {
      /*
       * ----------------------------------------------------------------------
       * MULTI-TENANCY
       * ----------------------------------------------------------------------
       */
      tenantId: {
        type: String,

        required: [
          true,
          'Tenant ID is required',
        ],

        trim: true,

        lowercase: true,

        minlength: 1,

        maxlength:
          TENANT_ID_MAX_LENGTH,

        immutable: true,

        index: true,

        validate: {
          validator:
            validateTenantId,

          message:
            'Invalid TITech tenant identifier.',
        },
      },

      /*
       * ----------------------------------------------------------------------
       * OWNERSHIP / RELATIONSHIPS
       * ----------------------------------------------------------------------
       */
      member: {
        type: Schema.Types.ObjectId,
        ref: 'Member',
        default: null,
        immutable: true,
        index: true,
      },

      user: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null,
        immutable: true,
        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * ACCOUNT IDENTIFICATION
       * ----------------------------------------------------------------------
       */
      accountNumber: {
        type: String,

        required: [
          true,
          'Account number is required',
        ],

        trim: true,

        uppercase: true,

        minlength: 3,

        maxlength:
          ACCOUNT_NUMBER_MAX_LENGTH,

        immutable: true,

        validate: {
          validator:
            validateIdentifier,

          message:
            'Invalid account number.',
        },
      },

      accountName: {
        type: String,

        required: [
          true,
          'Account name is required',
        ],

        trim: true,

        minlength: 2,

        maxlength: 200,
      },

      externalReference: {
        type: String,

        trim: true,

        maxlength: 200,

        default: null,
      },

      /*
       * ----------------------------------------------------------------------
       * CLASSIFICATION
       * ----------------------------------------------------------------------
       */
      accountType: {
        type: String,

        enum: ACCOUNT_TYPES,

        required: [
          true,
          'Account type is required',
        ],

        uppercase: true,

        immutable: true,

        index: true,
      },

      accountCategory: {
        type: String,

        enum: ACCOUNT_CATEGORIES,

        required: [
          true,
          'Account category is required',
        ],

        uppercase: true,

        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * CURRENCY
       * ----------------------------------------------------------------------
       */
      currency: {
        type: String,

        default: 'UGX',

        uppercase: true,

        trim: true,

        minlength:
          CURRENCY_MAX_LENGTH,

        maxlength:
          CURRENCY_MAX_LENGTH,

        immutable: true,

        validate: {
          validator(value) {
            return CURRENCY_REGEX.test(
              String(value),
            );
          },

          message:
            'Currency must be a valid ISO 4217 three-letter code.',
        },

        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * BALANCES
       * ----------------------------------------------------------------------
       *
       * Decimal128 is mandatory for persisted monetary values.
       */
      balance: {
        type:
          Schema.Types.Decimal128,

        required: true,

        default:
          decimal128Zero,

        validate: {
          validator:
            validateNonNegativeDecimal128,

          message:
            'Balance must be a finite, non-negative Decimal128 value.',
        },
      },

      availableBalance: {
        type:
          Schema.Types.Decimal128,

        required: true,

        default:
          decimal128Zero,

        validate: {
          validator:
            validateNonNegativeDecimal128,

          message:
            'Available balance must be a finite, non-negative Decimal128 value.',
        },
      },

      blockedBalance: {
        type:
          Schema.Types.Decimal128,

        required: true,

        default:
          decimal128Zero,

        validate: {
          validator:
            validateNonNegativeDecimal128,

          message:
            'Blocked balance must be a finite, non-negative Decimal128 value.',
        },
      },

      accruedInterest: {
        type:
          Schema.Types.Decimal128,

        required: true,

        default:
          decimal128Zero,

        validate: {
          validator:
            validateNonNegativeDecimal128,

          message:
            'Accrued interest must be a finite, non-negative Decimal128 value.',
        },
      },

      totalCredits: {
        type:
          Schema.Types.Decimal128,

        required: true,

        default:
          decimal128Zero,

        validate: {
          validator:
            validateNonNegativeDecimal128,

          message:
            'Total credits must be a finite, non-negative Decimal128 value.',
        },
      },

      totalDebits: {
        type:
          Schema.Types.Decimal128,

        required: true,

        default:
          decimal128Zero,

        validate: {
          validator:
            validateNonNegativeDecimal128,

          message:
            'Total debits must be a finite, non-negative Decimal128 value.',
        },
      },

      transactionCount: {
        type: Number,

        required: true,

        default: 0,

        min: 0,

        validate: {
          validator(value) {
            return (
              Number.isSafeInteger(
                value,
              ) &&
              value >= 0
            );
          },

          message:
            'transactionCount must be a non-negative safe integer.',
        },
      },

      /*
       * ----------------------------------------------------------------------
       * LOAN ACCOUNT STATE
       * ----------------------------------------------------------------------
       */
      outstandingPrincipal: {
        type:
          Schema.Types.Decimal128,

        required: true,

        default:
          decimal128Zero,

        validate: {
          validator:
            validateNonNegativeDecimal128,

          message:
            'Outstanding principal must be a valid non-negative Decimal128 value.',
        },
      },

      outstandingInterest: {
        type:
          Schema.Types.Decimal128,

        required: true,

        default:
          decimal128Zero,

        validate: {
          validator:
            validateNonNegativeDecimal128,

          message:
            'Outstanding interest must be a valid non-negative Decimal128 value.',
        },
      },

      penaltyBalance: {
        type:
          Schema.Types.Decimal128,

        required: true,

        default:
          decimal128Zero,

        validate: {
          validator:
            validateNonNegativeDecimal128,

          message:
            'Penalty balance must be a valid non-negative Decimal128 value.',
        },
      },

      /*
       * ----------------------------------------------------------------------
       * INTEREST
       * ----------------------------------------------------------------------
       */
      interestRate: {
        type: Number,

        default: 0,

        min: 0,

        max: 100,

        validate: {
          validator(value) {
            return Number.isFinite(
              value,
            );
          },

          message:
            'Interest rate must be finite.',
        },
      },

      interestRateType: {
        type: String,

        enum:
          INTEREST_RATE_TYPES,

        default: 'NONE',

        uppercase: true,
      },

      interestAccrualFrequency: {
        type: String,

        enum:
          INTEREST_ACCRUAL_FREQUENCIES,

        default: 'NONE',

        uppercase: true,
      },

      interestLastCalculatedAt: {
        type: Date,

        default: null,
      },

      /*
       * ----------------------------------------------------------------------
       * FIXED DEPOSIT
       * ----------------------------------------------------------------------
       */
      maturityDate: {
        type: Date,

        default: null,

        index: true,
      },

      openedAt: {
        type: Date,

        required: true,

        default: Date.now,

        immutable: true,
      },

      /*
       * ----------------------------------------------------------------------
       * MOBILE MONEY
       * ----------------------------------------------------------------------
       */
      momoEnabled: {
        type: Boolean,

        default: false,
      },

      momoProvider: {
        type: String,

        enum:
          MOMO_PROVIDERS,

        default: null,

        uppercase: true,
      },

      momoAccountNumber: {
        type: String,

        trim: true,

        maxlength: 30,

        default: null,
      },

      momoVerified: {
        type: Boolean,

        default: false,
      },

      /*
       * ----------------------------------------------------------------------
       * RECONCILIATION
       * ----------------------------------------------------------------------
       */
      reconciled: {
        type: Boolean,

        default: false,

        index: true,
      },

      reconciledAt: {
        type: Date,

        default: null,
      },

      reconciliationReference: {
        type: String,

        trim: true,

        maxlength: 200,

        default: null,
      },

      /*
       * ----------------------------------------------------------------------
       * ACCOUNTING POSTING
       * ----------------------------------------------------------------------
       */
      accountingPosted: {
        type: Boolean,

        default: false,

        index: true,
      },

      accountingPostedAt: {
        type: Date,

        default: null,
      },

      ledgerAccountCode: {
        type: String,

        trim: true,

        uppercase: true,

        maxlength: 100,

        default: null,
      },

      ledgerReference: {
        type: String,

        trim: true,

        maxlength: 200,

        default: null,
      },

      /*
       * ----------------------------------------------------------------------
       * COMPLIANCE
       * ----------------------------------------------------------------------
       */
      kycVerified: {
        type: Boolean,

        default: false,

        index: true,
      },

      amlChecked: {
        type: Boolean,

        default: false,

        index: true,
      },

      sanctionsScreened: {
        type: Boolean,

        default: false,

        index: true,
      },

      complianceReviewedAt: {
        type: Date,

        default: null,
      },

      complianceReference: {
        type: String,

        trim: true,

        maxlength: 200,

        default: null,
      },

      /*
       * ----------------------------------------------------------------------
       * RISK
       * ----------------------------------------------------------------------
       */
      riskScore: {
        type: Number,

        default: 0,

        min: 0,

        max: 100,

        validate: {
          validator(value) {
            return Number.isFinite(
              value,
            );
          },

          message:
            'Risk score must be finite.',
        },
      },

      riskFlagged: {
        type: Boolean,

        default: false,

        index: true,
      },

      riskReason: {
        type: String,

        trim: true,

        maxlength: 500,

        default: null,
      },

      /*
       * ----------------------------------------------------------------------
       * STATUS / LIFECYCLE
       * ----------------------------------------------------------------------
       */
      status: {
        type: String,

        enum:
          ACCOUNT_STATUSES,

        default: 'PENDING',

        required: true,

        uppercase: true,

        index: true,
      },

      statusReason: {
        type: String,

        trim: true,

        maxlength: 500,

        default: null,
      },

      statusChangedAt: {
        type: Date,

        default: null,
      },

      blockedAt: {
        type: Date,

        default: null,
      },

      blockedBy: {
        type: Schema.Types.ObjectId,

        ref: 'User',

        default: null,
      },

      closedAt: {
        type: Date,

        default: null,
      },

      closedBy: {
        type: Schema.Types.ObjectId,

        ref: 'User',

        default: null,
      },

      /*
       * ----------------------------------------------------------------------
       * TRANSACTION ACTIVITY
       * ----------------------------------------------------------------------
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

      lastTransactionId: {
        type: String,

        trim: true,

        maxlength:
          TRANSACTION_ID_MAX_LENGTH,

        default: null,

        validate: {
          validator:
            validateOptionalIdentifier,

          message:
            'Invalid last transaction identifier.',
        },
      },

      lastBalanceMutationAt: {
        type: Date,

        default: null,
      },

      /*
       * ----------------------------------------------------------------------
       * AUDIT ATTRIBUTION
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

      auditReference: {
        type: String,

        trim: true,

        maxlength: 200,

        default: null,
      },

      /*
       * ----------------------------------------------------------------------
       * WORKFLOW / CONCURRENCY
       * ----------------------------------------------------------------------
       */
      workflowVersion: {
        type: Number,

        default: 1,

        min: 1,

        validate: {
          validator(value) {
            return (
              Number.isSafeInteger(
                value,
              ) &&
              value >= 1
            );
          },

          message:
            'workflowVersion must be a positive safe integer.',
        },
      },

      revision: {
        type: Number,

        default: 0,

        min: 0,

        validate: {
          validator(value) {
            return (
              Number.isSafeInteger(
                value,
              ) &&
              value >= 0
            );
          },

          message:
            'revision must be a non-negative safe integer.',
        },
      },

      /*
       * Explicit financial mutation sequence.
       */
      balanceRevision: {
        type: Number,

        default: 0,

        min: 0,

        validate: {
          validator(value) {
            return (
              Number.isSafeInteger(
                value,
              ) &&
              value >= 0
            );
          },

          message:
            'balanceRevision must be a non-negative safe integer.',
        },
      },

      /*
       * ----------------------------------------------------------------------
       * SOFT DELETE / ARCHIVAL
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

      /*
       * ----------------------------------------------------------------------
       * NON-FINANCIAL METADATA
       * ----------------------------------------------------------------------
       */
      metadata: {
        type: Schema.Types.Mixed,

        default: undefined,

        validate: {
          validator(value) {
            try {
              validateMetadata(
                value,
              );

              return true;
            } catch {
              return false;
            }
          },

          message:
            'Invalid account metadata.',
        },
      },
    },

    {
      timestamps: true,

      strict: true,

      strictQuery: true,

      /*
       * Retain __v because optimisticConcurrency is enabled.
       *
       * revision and balanceRevision remain explicit application-level
       * sequencing values.
       */
      versionKey: '__v',

      optimisticConcurrency: true,

      collection: 'accounts',

      minimize: false,

      toJSON: {
        virtuals: true,

        getters: false,

        transform(
          _doc,
          ret,
        ) {
          if (
            ret._id !==
            undefined
          ) {
            ret.id =
              String(
                ret._id,
              );

            delete ret._id;
          }

          delete ret.__v;

          const monetaryFields = [
            'balance',
            'availableBalance',
            'blockedBalance',
            'accruedInterest',
            'totalCredits',
            'totalDebits',
            'outstandingPrincipal',
            'outstandingInterest',
            'penaltyBalance',
            'calculatedAvailableBalance',
            'totalExposure',
          ];

          for (
            const field of monetaryFields
          ) {
            if (
              ret[field] !==
              undefined
            ) {
              ret[field] =
                decimalToString(
                  ret[field],
                );
            }
          }

          return ret;
        },
      },

      toObject: {
        virtuals: true,

        getters: false,

        transform(
          _doc,
          ret,
        ) {
          if (
            ret._id !==
            undefined
          ) {
            ret.id =
              String(
                ret._id,
              );

            delete ret._id;
          }

          delete ret.__v;

          return ret;
        },
      },
    },
  );

/*
 * ============================================================================
 * FINANCIAL INVARIANTS
 * ============================================================================
 */

AccountSchema.pre(
  'validate',
  function validateAccountInvariants(
    next,
  ) {
    try {
      /*
       * Customer financial accounts should normally identify their member
       * or user. GL/settlement accounts may legitimately have neither.
       */
      const customerAccountTypes =
        [
          'SAVINGS',
          'SHARES',
          'FIXED_DEPOSIT',
          'LOAN',
          'WALLET',
        ];

      if (
        customerAccountTypes.includes(
          this.accountType,
        ) &&
        !this.member &&
        !this.user
      ) {
        this.invalidate(
          'member',
          'Customer financial accounts must belong to a member or user.',
        );
      }

      /*
       * MoMo configuration must be internally coherent.
       */
      if (
        this.momoEnabled &&
        !this.momoProvider
      ) {
        this.invalidate(
          'momoProvider',
          'MoMo provider is required when mobile money is enabled.',
        );
      }

      if (
        !this.momoEnabled &&
        this.momoVerified
      ) {
        this.invalidate(
          'momoVerified',
          'A disabled MoMo account cannot remain verified.',
        );
      }

      /*
       * Fixed deposits should carry maturity information.
       */
      if (
        this.accountType ===
          'FIXED_DEPOSIT' &&
        !this.maturityDate
      ) {
        this.invalidate(
          'maturityDate',
          'Fixed-deposit accounts require maturityDate.',
        );
      }

      /*
       * Loan account classification requires the loan exposure fields to
       * remain valid even when they are zero.
       */
      if (
        this.accountType !==
          'LOAN'
      ) {
        /*
         * No automatic clearing is performed because historical data may use
         * these values for reporting compatibility.
         */
      }

      /*
       * Lifecycle coherence.
       */
      if (
        this.status ===
        'CLOSED'
      ) {
        this.isDeleted = false;

        if (
          !this.closedAt
        ) {
          this.closedAt =
            new Date();
        }
      }

      if (
        this.status ===
        'BLOCKED'
      ) {
        if (
          !this.blockedAt
        ) {
          this.blockedAt =
            new Date();
        }
      }

      /*
       * Non-deleted accounts cannot carry deletion timestamps.
       */
      if (
        !this.isDeleted &&
        this.deletedAt
      ) {
        this.invalidate(
          'deletedAt',
          'deletedAt must be null for non-deleted accounts.',
        );
      }

      /*
       * Deleted accounts are operationally closed.
       */
      if (
        this.isDeleted &&
        this.status !==
          'CLOSED'
      ) {
        this.status =
          'CLOSED';

        if (
          !this.closedAt
        ) {
          this.closedAt =
            new Date();
        }
      }

      /*
       * Monetary invariants.
       */
      const monetaryFields = [
        'balance',
        'availableBalance',
        'blockedBalance',
        'accruedInterest',
        'totalCredits',
        'totalDebits',
        'outstandingPrincipal',
        'outstandingInterest',
        'penaltyBalance',
      ];

      for (
        const field of monetaryFields
      ) {
        const value =
          this[field];

        if (
          value !== null &&
          value !== undefined &&
          !validateNonNegativeDecimal128(
            value,
          )
        ) {
          this.invalidate(
            field,
            `${field} must be a finite, non-negative Decimal128 value.`,
          );
        }
      }

      /*
       * blockedBalance <= balance
       */
      if (
        this.balance &&
        this.blockedBalance
      ) {
        if (
          compareDecimals(
            this.blockedBalance.toString(),
            this.balance.toString(),
          ) > 0
        ) {
          this.invalidate(
            'blockedBalance',
            'Blocked balance cannot exceed account balance.',
          );
        }
      }

      /*
       * availableBalance <= balance
       */
      if (
        this.balance &&
        this.availableBalance
      ) {
        if (
          compareDecimals(
            this.availableBalance.toString(),
            this.balance.toString(),
          ) > 0
        ) {
          this.invalidate(
            'availableBalance',
            'Available balance cannot exceed account balance.',
          );
        }
      }

      /*
       * availableBalance should equal balance - blockedBalance.
       *
       * This catches stale materialized balance state during normal document
       * validation. Atomic repository mutations remain responsible for
       * preserving the same invariant under concurrency.
       */
      if (
        this.balance &&
        this.blockedBalance &&
        this.availableBalance
      ) {
        const expected =
          subtractDecimals(
            this.balance,
            this.blockedBalance,
          );

        if (
          expected.toString() !==
          this.availableBalance.toString()
        ) {
          this.invalidate(
            'availableBalance',
            'Available balance must equal balance minus blockedBalance.',
          );
        }
      }

      if (
        this.interestRateType ===
          'NONE' &&
        this.interestRate !==
          0
      ) {
        this.invalidate(
          'interestRate',
          'Interest rate must be zero when interestRateType is NONE.',
        );
      }

      if (
        this.statusChangedAt ===
          null &&
        this.isModified(
          'status',
        )
      ) {
        this.statusChangedAt =
          new Date();
      }

      next();
    } catch (
      error
    ) {
      next(error);
    }
  },
);

/*
 * ============================================================================
 * QUERY MUTATION BOUNDARY
 * ============================================================================
 *
 * Account financial mutations must pass through a controlled repository or
 * financial service.
 *
 * Internal financial repository operations can explicitly set:
 *
 *   allowFinancialMutation: true
 *
 * This does not perform authorization.
 * ============================================================================
 */

const FINANCIAL_MUTATION_FIELDS =
  Object.freeze([
    'balance',
    'availableBalance',
    'blockedBalance',
    'accruedInterest',
    'totalCredits',
    'totalDebits',
    'transactionCount',
    'outstandingPrincipal',
    'outstandingInterest',
    'penaltyBalance',
    'balanceRevision',
    'lastTransactionAt',
    'lastCreditAt',
    'lastDebitAt',
    'lastTransactionId',
    'lastBalanceMutationAt',
  ]);

const IDENTITY_FIELDS =
  Object.freeze([
    '_id',
    'tenantId',
    'accountNumber',
    'accountType',
    'currency',
    'openedAt',
  ]);

function updateTouchesField(
  update,
  field,
) {
  if (
    !update ||
    typeof update !==
      'object' ||
    Array.isArray(update)
  ) {
    return false;
  }

  if (
    Object.prototype.hasOwnProperty.call(
      update,
      field,
    )
  ) {
    return true;
  }

  for (
    const operator of [
      '$set',
      '$setOnInsert',
      '$inc',
      '$mul',
      '$unset',
      '$min',
      '$max',
      '$currentDate',
      '$rename',
    ]
  ) {
    const payload =
      update[
        operator
      ];

    if (
      !payload ||
      typeof payload !==
        'object' ||
      Array.isArray(payload)
    ) {
      continue;
    }

    for (
      const key of Object.keys(
        payload,
      )
    ) {
      if (
        key === field ||
        key.startsWith(
          `${field}.`,
        ) ||
        (operator ===
          '$rename' &&
          payload[key] ===
            field)
      ) {
        return true;
      }
    }
  }

  return false;
}

function updateTouchesAnyField(
  update,
  fields,
) {
  return fields.some(
    (field) =>
      updateTouchesField(
        update,
        field,
      ),
  );
}

function rejectAccountMutation(
  next,
) {
  const options =
    typeof this.getOptions ===
    'function'
      ? this.getOptions() ||
        {}
      : this.options || {};

  if (
    options.allowFinancialMutation ===
    true
  ) {
    return next();
  }

  const update =
    typeof this.getUpdate ===
    'function'
      ? this.getUpdate()
      : {};

  if (
    Array.isArray(
      update,
    )
  ) {
    return next(
      new Error(
        'Account update pipelines are disabled.',
      ),
    );
  }

  if (
    updateTouchesAnyField(
      update,
      FINANCIAL_MUTATION_FIELDS,
    )
  ) {
    return next(
      new Error(
        'Direct financial account mutation is prohibited. Use BalanceRepository/FinancialTransactionService.',
      ),
    );
  }

  if (
    updateTouchesAnyField(
      update,
      IDENTITY_FIELDS,
    )
  ) {
    return next(
      new Error(
        'Account identity and core financial classification fields are immutable.',
      ),
    );
  }

  /*
   * All ordinary query mutation paths remain blocked so lifecycle,
   * compliance, accounting, reconciliation and audit invariants cannot be
   * bypassed accidentally.
   */
  return next(
    new Error(
      `Direct ${this.op} mutation on Account is disabled; use a controlled Account/financial-service operation.`,
    ),
  );
}

for (
  const operation of [
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
  ]
) {
  AccountSchema.pre(
    operation,
    rejectAccountMutation,
  );
}

for (
  const operation of [
    'replaceOne',
    'findOneAndReplace',
  ]
) {
  AccountSchema.pre(
    operation,
    function rejectReplacement(
      next,
    ) {
      next(
        new Error(
          'Account replacement is disabled. Use controlled repository operations.',
        ),
      );
    },
  );
}

AccountSchema.pre(
  'bulkWrite',
  function rejectBulkWrite(
    next,
  ) {
    next(
      new Error(
        'Account.bulkWrite() is disabled. Use controlled financial/repository operations.',
      ),
    );
  },
);

/*
 * ============================================================================
 * HARD DELETE PROTECTION
 * ============================================================================
 */

for (
  const operation of [
    'deleteOne',
    'deleteMany',
    'findOneAndDelete',
    'findOneAndRemove',
  ]
) {
  AccountSchema.pre(
    operation,
    function rejectDelete(
      next,
    ) {
      next(
        new Error(
          'Financial accounts cannot be hard-deleted through normal application workflows. Close/archive the account instead.',
        ),
      );
    },
  );
}

AccountSchema.pre(
  'deleteOne',
  {
    document: true,
    query: false,
  },
  function rejectDocumentDelete(
    next,
  ) {
    next(
      new Error(
        'Financial accounts cannot be hard-deleted through normal application workflows.',
      ),
    );
  },
);

/*
 * ============================================================================
 * VIRTUALS
 * ============================================================================
 */

/**
 * Exact available balance:
 *
 *   balance - blockedBalance
 *
 * Returned as Decimal128.
 */
AccountSchema.virtual(
  'calculatedAvailableBalance',
).get(
  function calculatedAvailableBalance() {
    try {
      if (
        !this.balance ||
        !this.blockedBalance
      ) {
        return decimal128Zero();
      }

      if (
        compareDecimals(
          this.blockedBalance.toString(),
          this.balance.toString(),
        ) > 0
      ) {
        return null;
      }

      return subtractDecimals(
        this.balance,
        this.blockedBalance,
      );
    } catch {
      return null;
    }
  },
);

/**
 * Total loan exposure:
 *
 * principal + interest + penalties
 */
AccountSchema.virtual(
  'totalExposure',
).get(
  function totalExposure() {
    try {
      const principal =
        this.outstandingPrincipal ??
        decimal128Zero();

      const interest =
        this.outstandingInterest ??
        decimal128Zero();

      const penalties =
        this.penaltyBalance ??
        decimal128Zero();

      const principalPlusInterest =
        addDecimals(
          principal,
          interest,
        );

      return addDecimals(
        principalPlusInterest,
        penalties,
      );
    } catch {
      return null;
    }
  },
);

/*
 * ============================================================================
 * EXACT DECIMAL ADDITION HELPER
 * ============================================================================
 */

function addDecimals(
  left,
  right,
) {
  const a =
    parseDecimal(
      left.toString(),
    );

  const b =
    parseDecimal(
      right.toString(),
    );

  if (
    a.sign < 0 ||
    b.sign < 0
  ) {
    throw new Error(
      'addDecimals only accepts non-negative values.',
    );
  }

  const scale =
    Math.max(
      a.scale,
      b.scale,
    );

  const leftCoefficient =
    a.coefficient *
    10n **
      BigInt(
        scale - a.scale,
      );

  const rightCoefficient =
    b.coefficient *
    10n **
      BigInt(
        scale - b.scale,
      );

  const total =
    leftCoefficient +
    rightCoefficient;

  let digits =
    total.toString();

  if (
    scale === 0
  ) {
    return mongoose.Types.Decimal128.fromString(
      digits,
    );
  }

  digits =
    digits.padStart(
      scale + 1,
      '0',
    );

  const splitIndex =
    digits.length - scale;

  const integerPart =
    digits.slice(
      0,
      splitIndex,
    );

  const fractionalPart =
    digits
      .slice(
        splitIndex,
      )
      .replace(
        /0+$/,
        '',
      );

  return mongoose.Types.Decimal128.fromString(
    fractionalPart
      ? `${integerPart}.${fractionalPart}`
      : integerPart,
  );
}

/*
 * ============================================================================
 * INSTANCE METHODS — STATE
 * ============================================================================
 */

AccountSchema.methods.isActive =
  function isActive() {
    return (
      this.status ===
        'ACTIVE' &&
      !this.isDeleted
    );
  };

AccountSchema.methods.isDormant =
  function isDormant() {
    return (
      this.status ===
      'DORMANT'
    );
  };

AccountSchema.methods.isBlocked =
  function isBlocked() {
    return (
      this.status ===
      'BLOCKED'
    );
  };

AccountSchema.methods.isClosed =
  function isClosed() {
    return (
      this.status ===
      'CLOSED'
    );
  };

AccountSchema.methods.isOperational =
  function isOperational() {
    return (
      this.status ===
        'ACTIVE' &&
      !this.isDeleted
    );
  };

AccountSchema.methods.canDeposit =
  function canDeposit() {
    return (
      this.isOperational()
    );
  };

AccountSchema.methods.canWithdraw =
  function canWithdraw() {
    return (
      this.isOperational() &&
      this.calculatedAvailableBalance !==
        null
    );
  };

/*
 * ============================================================================
 * INSTANCE METHODS — LIFECYCLE
 * ============================================================================
 */

AccountSchema.methods.activate =
  async function activate(
    updatedBy = null,
    options = {},
  ) {
    if (
      this.isDeleted
    ) {
      throw new Error(
        'Deleted accounts cannot be activated.',
      );
    }

    if (
      this.status ===
      'CLOSED'
    ) {
      throw new Error(
        'Closed accounts cannot be activated.',
      );
    }

    this.status =
      'ACTIVE';

    this.statusReason =
      null;

    this.statusChangedAt =
      new Date();

    this.updatedBy =
      updatedBy;

    this.revision += 1;

    return this.save({
      session:
        options.session,
    });
  };

AccountSchema.methods.markDormant =
  async function markDormant(
    reason =
      'Account marked dormant',
    updatedBy = null,
    options = {},
  ) {
    if (
      this.status ===
      'CLOSED'
    ) {
      throw new Error(
        'Closed accounts cannot be marked dormant.',
      );
    }

    this.status =
      'DORMANT';

    this.statusReason =
      String(
        reason,
      )
        .trim()
        .slice(
          0,
          500,
        );

    this.statusChangedAt =
      new Date();

    this.updatedBy =
      updatedBy;

    this.revision += 1;

    return this.save({
      session:
        options.session,
    });
  };

AccountSchema.methods.block =
  async function block(
    reason =
      'Account blocked',
    updatedBy = null,
    options = {},
  ) {
    if (
      this.status ===
      'CLOSED'
    ) {
      throw new Error(
        'Closed accounts cannot be blocked.',
      );
    }

    this.status =
      'BLOCKED';

    this.statusReason =
      String(
        reason,
      )
        .trim()
        .slice(
          0,
          500,
        );

    this.blockedAt =
      new Date();

    this.blockedBy =
      updatedBy;

    this.statusChangedAt =
      new Date();

    this.updatedBy =
      updatedBy;

    this.revision += 1;

    return this.save({
      session:
        options.session,
    });
  };

AccountSchema.methods.close =
  async function close(
    reason =
      'Account closed',
    updatedBy = null,
    options = {},
  ) {
    const balance =
      this.balance ??
      decimal128Zero();

    const blocked =
      this.blockedBalance ??
      decimal128Zero();

    if (
      compareDecimals(
        balance.toString(),
        '0',
      ) !== 0
    ) {
      throw new Error(
        'Account cannot be closed while balance is not zero.',
      );
    }

    if (
      compareDecimals(
        blocked.toString(),
        '0',
      ) !== 0
    ) {
      throw new Error(
        'Account cannot be closed while funds are blocked.',
      );
    }

    this.status =
      'CLOSED';

    this.statusReason =
      String(
        reason,
      )
        .trim()
        .slice(
          0,
          500,
        );

    this.closedAt =
      new Date();

    this.closedBy =
      updatedBy;

    this.statusChangedAt =
      new Date();

    this.updatedBy =
      updatedBy;

    this.revision += 1;

    return this.save({
      session:
        options.session,
    });
  };

/**
 * Soft archive/delete.
 *
 * The account remains physically present for historical financial reference.
 */
AccountSchema.methods.softDelete =
  async function softDelete(
    deletedBy = null,
    reason =
      'Account archived',
    options = {},
  ) {
    if (
      this.status ===
      'CLOSED'
    ) {
      return this;
    }

    this.isDeleted =
      true;

    this.deletedAt =
      new Date();

    this.deletedBy =
      deletedBy;

    this.status =
      'CLOSED';

    this.statusReason =
      String(
        reason,
      )
        .trim()
        .slice(
          0,
          500,
        );

    this.closedAt =
      this.closedAt ||
      new Date();

    this.closedBy =
      this.closedBy ||
      deletedBy;

    this.statusChangedAt =
      new Date();

    this.updatedBy =
      deletedBy;

    this.revision += 1;

    return this.save({
      session:
        options.session,
    });
  };

/*
 * ============================================================================
 * INSTANCE METHODS — RECONCILIATION / ACCOUNTING
 * ============================================================================
 */

AccountSchema.methods.markReconciled =
  async function markReconciled(
    reference = null,
    updatedBy = null,
    options = {},
  ) {
    this.reconciled =
      true;

    this.reconciledAt =
      new Date();

    this.reconciliationReference =
      reference;

    this.updatedBy =
      updatedBy;

    this.revision += 1;

    return this.save({
      session:
        options.session,
    });
  };

AccountSchema.methods.markAccountingPosted =
  async function markAccountingPosted(
    ledgerReference = null,
    updatedBy = null,
    options = {},
  ) {
    this.accountingPosted =
      true;

    this.accountingPostedAt =
      new Date();

    this.ledgerReference =
      ledgerReference;

    this.updatedBy =
      updatedBy;

    this.revision += 1;

    return this.save({
      session:
        options.session,
    });
  };

/*
 * ============================================================================
 * STATIC QUERY HELPERS
 * ============================================================================
 */

AccountSchema.statics.findByAccountNumber =
  function findByAccountNumber(
    tenantId,
    accountNumber,
    options = {},
  ) {
    if (
      !validateTenantId(
        tenantId,
      )
    ) {
      throw new TypeError(
        'Invalid tenantId.',
      );
    }

    const normalizedNumber =
      String(
        accountNumber ??
          '',
      )
        .trim()
        .toUpperCase();

    if (
      !validateIdentifier(
        normalizedNumber,
      )
    ) {
      throw new TypeError(
        'Invalid accountNumber.',
      );
    }

    const query =
      this.findOne({
        tenantId:
          String(
            tenantId,
          )
            .trim()
            .toLowerCase(),

        accountNumber:
          normalizedNumber,

        isDeleted:
          false,
      });

    if (
      options.session
    ) {
      query.session(
        options.session,
      );
    }

    return query;
  };

AccountSchema.statics.findCustomerAccounts =
  function findCustomerAccounts(
    tenantId,
    ownerId,
    options = {},
  ) {
    if (
      !validateTenantId(
        tenantId,
      )
    ) {
      throw new TypeError(
        'Invalid tenantId.',
      );
    }

    if (
      !mongoose.isObjectIdOrHexString(
        ownerId,
      )
    ) {
      throw new mongoose.Error.CastError(
        'ObjectId',
        ownerId,
        'ownerId',
      );
    }

    const query =
      this.find({
        tenantId:
          String(
            tenantId,
          )
            .trim()
            .toLowerCase(),

        $or: [
          {
            member:
              ownerId,
          },
          {
            user:
              ownerId,
          },
        ],

        isDeleted:
          false,
      }).sort({
        createdAt: -1,
        _id: -1,
      });

    if (
      options.session
    ) {
      query.session(
        options.session,
      );
    }

    return query;
  };

AccountSchema.statics.findActive =
  function findActive(
    tenantId,
    options = {},
  ) {
    if (
      !validateTenantId(
        tenantId,
      )
    ) {
      throw new TypeError(
        'Invalid tenantId.',
      );
    }

    const query =
      this.find({
        tenantId:
          String(
            tenantId,
          )
            .trim()
            .toLowerCase(),

        status:
          'ACTIVE',

        isDeleted:
          false,
      }).sort({
        createdAt: -1,
        _id: -1,
      });

    if (
      options.session
    ) {
      query.session(
        options.session,
      );
    }

    return query;
  };

AccountSchema.statics.findUnreconciled =
  function findUnreconciled(
    tenantId,
    options = {},
  ) {
    if (
      !validateTenantId(
        tenantId,
      )
    ) {
      throw new TypeError(
        'Invalid tenantId.',
      );
    }

    const query =
      this.find({
        tenantId:
          String(
            tenantId,
          )
            .trim()
            .toLowerCase(),

        reconciled:
          false,

        isDeleted:
          false,
      }).sort({
        createdAt: 1,
        _id: 1,
      });

    if (
      options.session
    ) {
      query.session(
        options.session,
      );
    }

    return query;
  };

AccountSchema.statics.findUnposted =
  function findUnposted(
    tenantId,
    options = {},
  ) {
    if (
      !validateTenantId(
        tenantId,
      )
    ) {
      throw new TypeError(
        'Invalid tenantId.',
      );
    }

    const query =
      this.find({
        tenantId:
          String(
            tenantId,
          )
            .trim()
            .toLowerCase(),

        accountingPosted:
          false,

        isDeleted:
          false,
      }).sort({
        createdAt: 1,
        _id: 1,
      });

    if (
      options.session
    ) {
      query.session(
        options.session,
      );
    }

    return query;
  };

/*
 * ============================================================================
 * ATOMIC FINANCIAL OPERATIONS
 * ============================================================================
 *
 * These methods are retained as controlled primitives for the repository
 * layer. Financial services should normally coordinate the corresponding
 * ledger entry in the same MongoDB transaction.
 * ============================================================================
 */

/**
 * Atomically credit an ACTIVE account.
 *
 * amount MUST be a positive exact decimal string/Decimal128 value.
 */
AccountSchema.statics.atomicCredit =
  async function atomicCredit(
    {
      accountId,
      tenantId,
      amount,
      transactionId = null,
      updatedBy = null,
      session = null,
    } = {},
  ) {
    if (
      accountId ===
        undefined ||
      accountId === null
    ) {
      throw new TypeError(
        'accountId is required.',
      );
    }

    if (
      !validateTenantId(
        tenantId,
      )
    ) {
      throw new TypeError(
        'Invalid tenantId.',
      );
    }

    const credit =
      toDecimal(
        amount,
      );

    if (
      compareDecimals(
        credit.toString(),
        '0',
      ) <= 0
    ) {
      throw new Error(
        'Credit amount must be greater than zero.',
      );
    }

    const now =
      new Date();

    const result =
      await this.findOneAndUpdate(
        {
          _id:
            String(accountId),

          tenantId:
            String(
              tenantId,
            )
              .trim()
              .toLowerCase(),

          status:
            'ACTIVE',

          isDeleted:
            false,
        },
        {
          $inc: {
            balance:
              credit,

            availableBalance:
              credit,

            totalCredits:
              credit,

            transactionCount:
              1,
          },

          $set: {
            lastTransactionAt:
              now,

            lastCreditAt:
              now,

            lastTransactionId:
              transactionId,

            lastBalanceMutationAt:
              now,

            updatedBy,
          },

          $inc: {
            balanceRevision:
              1,

            revision:
              1,

            balance:
              credit,

            availableBalance:
              credit,

            totalCredits:
              credit,

            transactionCount:
              1,
          },
        },
        {
          new: true,

          runValidators:
            true,

          allowFinancialMutation:
            true,

          session,
        },
      );

    if (
      !result
    ) {
      throw new Error(
        'Active account not found or unavailable.',
      );
    }

    return result;
  };

/**
 * Atomically debit an ACTIVE account only when enough unblocked funds exist.
 */
AccountSchema.statics.atomicDebit =
  async function atomicDebit(
    {
      accountId,
      tenantId,
      amount,
      transactionId = null,
      updatedBy = null,
      session = null,
    } = {},
  ) {
    if (
      accountId ===
        undefined ||
      accountId === null
    ) {
      throw new TypeError(
        'accountId is required.',
      );
    }

    if (
      !validateTenantId(
        tenantId,
      )
    ) {
      throw new TypeError(
        'Invalid tenantId.',
      );
    }

    const debit =
      toDecimal(
        amount,
      );

    if (
      compareDecimals(
        debit.toString(),
        '0',
      ) <= 0
    ) {
      throw new Error(
        'Debit amount must be greater than zero.',
      );
    }

    const now =
      new Date();

    /*
     * The filter itself enforces:
     *
     *   balance - blockedBalance >= debit
     *
     * using MongoDB Decimal128 arithmetic.
     */
    const result =
      await this.findOneAndUpdate(
        {
          _id:
            String(accountId),

          tenantId:
            String(
              tenantId,
            )
              .trim()
              .toLowerCase(),

          status:
            'ACTIVE',

          isDeleted:
            false,

          $expr: {
            $gte: [
              {
                $subtract: [
                  '$balance',
                  '$blockedBalance',
                ],
              },

              debit,
            ],
          },
        },
        {
          $inc: {
            balance:
              mongoose.Types.Decimal128.fromString(
                `-${debit.toString()}`,
              ),

            availableBalance:
              mongoose.Types.Decimal128.fromString(
                `-${debit.toString()}`,
              ),

            totalDebits:
              debit,

            transactionCount:
              1,

            balanceRevision:
              1,

            revision:
              1,
          },

          $set: {
            lastTransactionAt:
              now,

            lastDebitAt:
              now,

            lastTransactionId:
              transactionId,

            lastBalanceMutationAt:
              now,

            updatedBy,
          },
        },
        {
          new: true,

          runValidators:
            true,

          allowFinancialMutation:
            true,

          session,
        },
      );

    if (
      !result
    ) {
      throw new Error(
        'Insufficient available funds or account unavailable.',
      );
    }

    return result;
  };

/*
 * ============================================================================
 * BALANCE RESERVATION OPERATIONS
 * ============================================================================
 */

/**
 * Atomically reserve funds.
 */
AccountSchema.statics.reserveFunds =
  async function reserveFunds(
    {
      accountId,
      tenantId,
      amount,
      transactionId = null,
      updatedBy = null,
      session = null,
    } = {},
  ) {
    if (
      !validateTenantId(
        tenantId,
      )
    ) {
      throw new TypeError(
        'Invalid tenantId.',
      );
    }

    const reserve =
      toDecimal(
        amount,
      );

    if (
      compareDecimals(
        reserve.toString(),
        '0',
      ) <= 0
    ) {
      throw new Error(
        'Reservation amount must be greater than zero.',
      );
    }

    const negativeReserve =
      mongoose.Types.Decimal128.fromString(
        `-${reserve.toString()}`,
      );

    const result =
      await this.findOneAndUpdate(
        {
          _id:
            String(accountId),

          tenantId:
            String(
              tenantId,
            )
              .trim()
              .toLowerCase(),

          status:
            'ACTIVE',

          isDeleted:
            false,

          $expr: {
            $gte: [
              {
                $subtract: [
                  '$balance',
                  '$blockedBalance',
                ],
              },

              reserve,
            ],
          },
        },
        {
          $inc: {
            blockedBalance:
              reserve,

            availableBalance:
              negativeReserve,

            balanceRevision:
              1,

            revision:
              1,
          },

          $set: {
            lastTransactionId:
              transactionId,

            lastBalanceMutationAt:
              new Date(),

            updatedBy,
          },
        },
        {
          new: true,

          runValidators:
            true,

          allowFinancialMutation:
            true,

          session,
        },
      );

    if (
      !result
    ) {
      throw new Error(
        'Insufficient available funds or account unavailable.',
      );
    }

    return result;
  };

/**
 * Release previously reserved funds.
 */
AccountSchema.statics.releaseFunds =
  async function releaseFunds(
    {
      accountId,
      tenantId,
      amount,
      transactionId = null,
      updatedBy = null,
      session = null,
    } = {},
  ) {
    if (
      !validateTenantId(
        tenantId,
      )
    ) {
      throw new TypeError(
        'Invalid tenantId.',
      );
    }

    const release =
      toDecimal(
        amount,
      );

    if (
      compareDecimals(
        release.toString(),
        '0',
      ) <= 0
    ) {
      throw new Error(
        'Release amount must be greater than zero.',
      );
    }

    const result =
      await this.findOneAndUpdate(
        {
          _id:
            String(accountId),

          tenantId:
            String(
              tenantId,
            )
              .trim()
              .toLowerCase(),

          status:
            'ACTIVE',

          isDeleted:
            false,

          $expr: {
            $gte: [
              '$blockedBalance',
              release,
            ],
          },
        },
        {
          $inc: {
            blockedBalance:
              mongoose.Types.Decimal128.fromString(
                `-${release.toString()}`,
              ),

            availableBalance:
              release,

            balanceRevision:
              1,

            revision:
              1,
          },

          $set: {
            lastTransactionId:
              transactionId,

            lastBalanceMutationAt:
              new Date(),

            updatedBy,
          },
        },
        {
          new: true,

          runValidators:
            true,

          allowFinancialMutation:
            true,

          session,
        },
      );

    if (
      !result
    ) {
      throw new Error(
        'Reserved balance is insufficient or account unavailable.',
      );
    }

    return result;
  };

/*
 * ============================================================================
 * INDEXES
 * ============================================================================
 */

/*
 * Tenant + account number uniqueness.
 */
AccountSchema.index(
  {
    tenantId: 1,
    accountNumber: 1,
  },
  {
    unique: true,

    name:
      'uq_account_tenant_account_number',
  },
);

/*
 * Tenant + external reference.
 */
AccountSchema.index(
  {
    tenantId: 1,
    externalReference: 1,
  },
  {
    unique: true,

    sparse: true,

    name:
      'uq_account_tenant_external_reference',
  },
);

/*
 * Member account lookup.
 */
AccountSchema.index({
  tenantId: 1,
  member: 1,
  status: 1,
  accountType: 1,
});

/*
 * User account lookup.
 */
AccountSchema.index({
  tenantId: 1,
  user: 1,
  status: 1,
  accountType: 1,
});

/*
 * Account classification.
 */
AccountSchema.index({
  tenantId: 1,
  accountType: 1,
  status: 1,
  currency: 1,
});

/*
 * Accounting category.
 */
AccountSchema.index({
  tenantId: 1,
  accountCategory: 1,
  status: 1,
});

/*
 * General operational status.
 */
AccountSchema.index({
  tenantId: 1,
  status: 1,
  createdAt: -1,
  _id: -1,
});

/*
 * Transaction activity.
 */
AccountSchema.index({
  tenantId: 1,
  lastTransactionAt: -1,
  _id: -1,
});

/*
 * Reconciliation workflow.
 */
AccountSchema.index({
  tenantId: 1,
  reconciled: 1,
  updatedAt: -1,
});

/*
 * Accounting posting workflow.
 */
AccountSchema.index({
  tenantId: 1,
  accountingPosted: 1,
  updatedAt: -1,
});

/*
 * Risk investigation.
 */
AccountSchema.index({
  tenantId: 1,
  riskFlagged: 1,
  riskScore: -1,
});

/*
 * Fixed-deposit maturity.
 */
AccountSchema.index({
  tenantId: 1,
  maturityDate: 1,
});

/*
 * Soft-deleted/closed administration.
 */
AccountSchema.index({
  tenantId: 1,
  isDeleted: 1,
  status: 1,
});

/*
 * Mobile-money provider reference.
 */
AccountSchema.index({
  tenantId: 1,
  momoProvider: 1,
  momoAccountNumber: 1,
});

/*
 * Ledger account lookup.
 */
AccountSchema.index({
  tenantId: 1,
  ledgerAccountCode: 1,
});

/*
 * Balance mutation sequencing.
 */
AccountSchema.index({
  tenantId: 1,
  balanceRevision: -1,
});

/*
 * ============================================================================
 * MODEL
 * ============================================================================
 */

const Account =
  mongoose.models.Account ||
  mongoose.model(
    'Account',
    AccountSchema,
  );

/*
 * ============================================================================
 * EXPORTS
 * ============================================================================
 */

export {
  AccountSchema,
};

export default Account;

/*
 * ============================================================================
 * END OF TITech COMMUNITY CAPITAL LTD ENTERPRISE FINANCIAL ACCOUNT MODEL
 * ============================================================================
 */