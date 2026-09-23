/**
 * ============================================================================
 * backend/models/account.model.js
 * TITech Community Capital LTD
 * Enterprise Financial Account Aggregate
 * ============================================================================
 *
 * Architectural role
 * ----------------------------------------------------------------------------
 * Account is the canonical persistence aggregate representing a TITech
 * financial account.
 *
 * It provides the persistent account boundary for:
 *
 *   - wallet accounts
 *   - savings accounts
 *   - group wallets
 *   - loan accounts
 *   - share-capital accounts
 *   - treasury accounts
 *   - settlement accounts
 *   - escrow accounts
 *   - fee/clearing accounts
 *   - customer accounts
 *   - other explicitly supported financial account types
 *
 * Relationship
 * ----------------------------------------------------------------------------
 *
 *   FinancialTransactionService
 *             │
 *       ┌─────┴─────┐
 *       ▼           ▼
 * BalanceRepository  LedgerRepository
 *       │           │
 *       └─────┬─────┘
 *             ▼
 *        Account Model
 *             │
 *             ▼
 *          MongoDB
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * Account IS:
 *   - the persistent source of account identity;
 *   - the persistent source of account currency;
 *   - the persistent source of current persisted balance;
 *   - the persistent source of reserved balance;
 *   - the persistent source of account lifecycle status;
 *   - a tenant-owned financial persistence boundary.
 *
 * Account is NOT:
 *   - a financial ledger;
 *   - a transaction record;
 *   - an authorization mechanism;
 *   - a payment-provider integration;
 *   - a loan approval engine;
 *   - a savings calculation engine;
 *   - an interest calculator;
 *   - a fee calculator;
 *   - a KYC/AML decision engine;
 *   - a reconciliation engine;
 *   - a replacement for BalanceRepository;
 *   - a replacement for LedgerRepository;
 *   - a replacement for FinancialTransactionService.
 *
 * Financial design principles
 * ----------------------------------------------------------------------------
 *   - Monetary values use MongoDB Decimal128.
 *   - JavaScript floating-point arithmetic is never used for persisted money.
 *   - Tenant ownership is mandatory and immutable.
 *   - Account identity is immutable.
 *   - Account number is immutable.
 *   - Account currency is immutable.
 *   - Account type is immutable.
 *   - Opening balance is immutable.
 *   - Balance defaults to zero.
 *   - Reserved balance defaults to zero.
 *   - Monetary values must be finite and non-negative.
 *   - reservedBalance must not exceed balance.
 *   - Balance mutation is delegated to BalanceRepository.
 *   - Financial mutation metadata is persisted for traceability.
 *   - Explicit balanceRevision supports financial mutation sequencing.
 *   - Strict schema prevents accidental financial fields.
 *
 * Tenancy
 * ----------------------------------------------------------------------------
 * Every account belongs to exactly one TITech tenant.
 *
 * Cross-tenant access MUST be enforced by repositories/services.
 *
 * The model provides tenant-aware indexes and query helpers but does not
 * replace authorization middleware.
 *
 * Status
 * ----------------------------------------------------------------------------
 * PENDING:
 *   Account exists but is not yet operational.
 *
 * ACTIVE:
 *   Account may participate in permitted financial operations.
 *
 * SUSPENDED:
 *   Financial activity is temporarily blocked.
 *
 * FROZEN:
 *   Account is frozen for risk, compliance, fraud, or security reasons.
 *
 * CLOSED:
 *   Account is permanently closed and must not resume normal financial use.
 *
 * Module format
 * ----------------------------------------------------------------------------
 * Native ESM.
 *
 * ============================================================================
 */

'use strict';

import mongoose from 'mongoose';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const tenantConstantsModule =
  require('../tenancy/tenant.constants.js');

const { Schema } = mongoose;

/*
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

export const ACCOUNT_STATUSES = Object.freeze([
  'PENDING',
  'ACTIVE',
  'SUSPENDED',
  'FROZEN',
  'CLOSED',
]);

export const ACCOUNT_TYPES = Object.freeze([
  'WALLET',
  'SAVINGS',
  'GROUP_WALLET',
  'LOAN',
  'SHARE_CAPITAL',
  'TREASURY',
  'SETTLEMENT',
  'ESCROW',
  'FEE',
  'CLEARING',
  'CUSTOMER',
  'OTHER',
]);

export const OWNERSHIP_TYPES = Object.freeze([
  'INDIVIDUAL',
  'GROUP',
  'ORGANIZATION',
  'SYSTEM',
]);

export const RISK_LEVELS = Object.freeze([
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
  'UNASSESSED',
]);

export const ACCOUNT_ID_MAX_LENGTH = 128;
export const TENANT_ID_MAX_LENGTH = 64;
export const ACCOUNT_NUMBER_MAX_LENGTH = 64;
export const OWNER_ID_MAX_LENGTH = 128;
export const TRANSACTION_ID_MAX_LENGTH = 128;
export const CURRENCY_MAX_LENGTH = 16;
export const PROVIDER_MAX_LENGTH = 64;
export const EXTERNAL_REFERENCE_MAX_LENGTH = 256;
export const STATUS_REASON_MAX_LENGTH = 500;
export const MAX_RISK_FLAGS = 50;
export const MAX_TAGS = 50;
export const MAX_METADATA_KEYS = 50;
export const MAX_METADATA_DEPTH = 8;
export const MAX_METADATA_STRING_LENGTH = 4096;

/*
 * Currency identifiers remain alphabetic and uppercase.
 */
export const CURRENCY_REGEX = /^[A-Z]{3,16}$/;

/*
 * Application/business identifiers.
 */
export const IDENTIFIER_REGEX =
  /^[a-zA-Z0-9._:-]+$/;

/*
 * The tenant constants module may itself expose a default object or named
 * exports depending on the migration state of the tenancy subsystem.
 *
 * This compatibility normalization allows the model to participate in the
 * ESM migration without silently depending on one particular export shape.
 */
const tenantConstants =
  tenantConstantsModule?.default ??
  tenantConstantsModule;

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
    '0',
  );
}

/**
 * Convert a value into Decimal128.
 *
 * Monetary callers should normally provide strings.
 */
export function decimal128FromString(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    throw new TypeError(
      'Decimal128 value is required.',
    );
  }

  const normalized =
    String(value).trim();

  if (!normalized) {
    throw new TypeError(
      'Decimal128 value cannot be empty.',
    );
  }

  return mongoose.Types.Decimal128.fromString(
    normalized,
  );
}

/**
 * Parse a non-negative finite decimal into:
 *
 *   coefficient / 10^scale
 *
 * JavaScript Number arithmetic is deliberately avoided.
 */
export function parseDecimalToInteger(
  value,
) {
  const text = String(value)
    .trim()
    .toLowerCase();

  if (!text) {
    throw new Error(
      'Invalid decimal value.',
    );
  }

  /*
   * Decimal128 special values are not valid monetary amounts.
   */
  if (
    text === 'nan' ||
    text === '+nan' ||
    text === '-nan' ||
    text === 'infinity' ||
    text === '+infinity' ||
    text === '-infinity' ||
    text === 'inf' ||
    text === '+inf' ||
    text === '-inf'
  ) {
    throw new Error(
      'Non-finite decimal values are not valid monetary values.',
    );
  }

  /*
   * Correct decimal/scientific-notation grammar.
   *
   * Examples:
   *   100
   *   100.25
   *   .25
   *   1E+3
   *   1.25E-4
   */
  const match = text.match(
    /^([+-]?)(?:(\d+)(?:\.(\d+))?|\.(\d+))(?:e([+-]?\d+))?$/,
  );

  if (!match) {
    throw new Error(
      'Invalid decimal value.',
    );
  }

  const sign = match[1];
  const integerPart =
    match[2] ?? '';
  const fractionFromInteger =
    match[3] ?? '';
  const fractionOnly =
    match[4] ?? '';
  const exponent =
    Number(match[5] ?? '0');

  if (
    !Number.isSafeInteger(
      exponent,
    )
  ) {
    throw new Error(
      'Invalid decimal exponent.',
    );
  }

  if (sign === '-') {
    throw new Error(
      'Negative decimal values are not permitted.',
    );
  }

  const fractionalPart =
    fractionFromInteger ||
    fractionOnly;

  const digits = (
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

  if (scale < 0) {
    coefficient *=
      10n **
      BigInt(-scale);

    scale = 0;
  }

  return {
    coefficient,
    scale,
  };
}

/**
 * Compare two finite non-negative decimal strings exactly.
 */
export function compareNonNegativeDecimals(
  left,
  right,
) {
  const a =
    parseDecimalToInteger(
      left,
    );

  const b =
    parseDecimalToInteger(
      right,
    );

  const scale = Math.max(
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
 * Exact subtraction for two non-negative Decimal128 values where:
 *
 *   left >= right
 *
 * Returns Decimal128.
 */
export function subtractNonNegativeDecimals(
  left,
  right,
) {
  const leftParts =
    parseDecimalToInteger(
      left.toString(),
    );

  const rightParts =
    parseDecimalToInteger(
      right.toString(),
    );

  const scale = Math.max(
    leftParts.scale,
    rightParts.scale,
  );

  const leftInteger =
    leftParts.coefficient *
    10n **
      BigInt(
        scale -
          leftParts.scale,
      );

  const rightInteger =
    rightParts.coefficient *
    10n **
      BigInt(
        scale -
          rightParts.scale,
      );

  if (
    leftInteger <
    rightInteger
  ) {
    throw new Error(
      'Decimal subtraction would produce a negative value.',
    );
  }

  let digits = String(
    leftInteger -
      rightInteger,
  );

  if (scale === 0) {
    return mongoose.Types.Decimal128.fromString(
      digits,
    );
  }

  const padded =
    digits.padStart(
      scale + 1,
      '0',
    );

  const splitIndex =
    padded.length - scale;

  const integerPart =
    padded.slice(
      0,
      splitIndex,
    );

  const fractionalPart =
    padded.slice(
      splitIndex,
    );

  /*
   * Trim trailing zeroes but preserve at least one fractional digit only
   * when required by the resulting value.
   */
  const normalizedFraction =
    fractionalPart.replace(
      /0+$/,
      '',
    );

  const result =
    normalizedFraction
      ? `${integerPart}.${normalizedFraction}`
      : integerPart;

  return mongoose.Types.Decimal128.fromString(
    result,
  );
}

/**
 * Validate a finite, non-negative Decimal128.
 */
export function validateNonNegativeDecimal128(
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
    parseDecimalToInteger(
      value.toString(),
    );

    return true;
  } catch {
    return false;
  }
}

/*
 * ============================================================================
 * IDENTIFIER HELPERS
 * ============================================================================
 */

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

  if (!normalized) {
    return false;
  }

  if (
    typeof tenantConstants?.isValidTenantId ===
    'function'
  ) {
    return Boolean(
      tenantConstants.isValidTenantId(
        normalized,
      ),
    );
  }

  return (
    normalized.length >= 3 &&
    normalized.length <=
      TENANT_ID_MAX_LENGTH &&
    /^[a-z0-9-]+$/.test(
      normalized,
    )
  );
}

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

  if (!normalized) {
    return false;
  }

  return (
    normalized.length <=
      ACCOUNT_ID_MAX_LENGTH &&
    IDENTIFIER_REGEX.test(
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

/*
 * ============================================================================
 * METADATA VALIDATION
 * ============================================================================
 */

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
      `Account metadata nesting exceeds ${MAX_METADATA_DEPTH} levels.`,
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
        `Account metadata strings cannot exceed ${MAX_METADATA_STRING_LENGTH} characters.`,
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
        `Account metadata arrays cannot contain more than ${MAX_METADATA_KEYS} items.`,
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
        `Account metadata cannot contain more than ${MAX_METADATA_KEYS} keys.`,
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
       * ACCOUNT IDENTITY
       * ----------------------------------------------------------------------
       *
       * String _id is deliberate because TITech supports stable business/
       * application identifiers.
       */
      _id: {
        type: String,

        required: [
          true,
          'accountId is required.',
        ],

        trim: true,

        minlength: 3,

        maxlength:
          ACCOUNT_ID_MAX_LENGTH,

        immutable: true,

        validate: {
          validator:
            validateIdentifier,

          message:
            'Invalid account identifier.',
        },
      },

      /*
       * ----------------------------------------------------------------------
       * BUSINESS ACCOUNT NUMBER
       * ----------------------------------------------------------------------
       */
      accountNumber: {
        type: String,

        required: [
          true,
          'accountNumber is required.',
        ],

        trim: true,

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

      name: {
        type: String,

        trim: true,

        maxlength: 255,

        default: null,
      },

      /*
       * ----------------------------------------------------------------------
       * TENANCY
       * ----------------------------------------------------------------------
       */
      tenantId: {
        type: String,

        required: [
          true,
          'tenantId is required.',
        ],

        trim: true,

        lowercase: true,

        minlength: 3,

        maxlength:
          TENANT_ID_MAX_LENGTH,

        immutable: true,

        validate: {
          validator:
            validateTenantId,

          message:
            'Invalid TITech tenant identifier.',
        },

        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * OWNERSHIP
       * ----------------------------------------------------------------------
       */
      ownershipType: {
        type: String,

        enum: {
          values:
            OWNERSHIP_TYPES,

          message:
            'Invalid account ownership type.',
        },

        required: true,

        default: 'INDIVIDUAL',

        uppercase: true,
      },

      ownerId: {
        type: String,

        trim: true,

        maxlength:
          OWNER_ID_MAX_LENGTH,

        default: null,

        validate: {
          validator:
            validateOptionalIdentifier,

          message:
            'Invalid account owner identifier.',
        },
      },

      memberId: {
        type: String,

        trim: true,

        maxlength:
          OWNER_ID_MAX_LENGTH,

        default: null,

        validate: {
          validator:
            validateOptionalIdentifier,

          message:
            'Invalid member identifier.',
        },
      },

      groupId: {
        type: String,

        trim: true,

        maxlength:
          OWNER_ID_MAX_LENGTH,

        default: null,

        validate: {
          validator:
            validateOptionalIdentifier,

          message:
            'Invalid group identifier.',
        },
      },

      /*
       * ----------------------------------------------------------------------
       * ACCOUNT CLASSIFICATION
       * ----------------------------------------------------------------------
       */
      accountType: {
        type: String,

        enum: {
          values:
            ACCOUNT_TYPES,

          message:
            'Invalid account type.',
        },

        required: true,

        default: 'WALLET',

        immutable: true,

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

        required: [
          true,
          'currency is required.',
        ],

        trim: true,

        uppercase: true,

        minlength: 3,

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
            'Invalid account currency.',
        },

        index: true,
      },

      /*
       * ----------------------------------------------------------------------
       * FINANCIAL BALANCES
       * ----------------------------------------------------------------------
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
            'Account balance must be a finite, non-negative Decimal128 value.',
        },
      },

      openingBalance: {
        type:
          Schema.Types.Decimal128,

        required: true,

        default:
          decimal128Zero,

        immutable: true,

        validate: {
          validator:
            validateNonNegativeDecimal128,

          message:
            'Opening balance must be a finite, non-negative Decimal128 value.',
        },
      },

      reservedBalance: {
        type:
          Schema.Types.Decimal128,

        required: true,

        default:
          decimal128Zero,

        validate: {
          validator:
            validateNonNegativeDecimal128,

          message:
            'Reserved balance must be a finite, non-negative Decimal128 value.',
        },
      },

      /*
       * Explicit financial mutation sequence.
       */
      balanceRevision: {
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
            'Balance revision must be a non-negative safe integer.',
        },
      },

      /*
       * ----------------------------------------------------------------------
       * ACCOUNT STATUS
       * ----------------------------------------------------------------------
       */
      status: {
        type: String,

        enum: {
          values:
            ACCOUNT_STATUSES,

          message:
            'Invalid financial account status.',
        },

        required: true,

        default: 'PENDING',

        uppercase: true,

        index: true,
      },

      statusReason: {
        type: String,

        trim: true,

        maxlength:
          STATUS_REASON_MAX_LENGTH,

        default: null,
      },

      statusChangedAt: {
        type: Date,

        default: null,
      },

      /*
       * ----------------------------------------------------------------------
       * FINANCIAL MUTATION TRACEABILITY
       * ----------------------------------------------------------------------
       */
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
       * EXTERNAL REFERENCES
       * ----------------------------------------------------------------------
       */

      externalReference: {
        type: String,

        trim: true,

        maxlength:
          EXTERNAL_REFERENCE_MAX_LENGTH,

        default: null,
      },

      provider: {
        type: String,

        trim: true,

        uppercase: true,

        maxlength:
          PROVIDER_MAX_LENGTH,

        default: null,
      },

      providerAccountReference: {
        type: String,

        trim: true,

        maxlength: 256,

        default: null,
      },

      /*
       * ----------------------------------------------------------------------
       * OPERATIONAL CONTROLS
       * ----------------------------------------------------------------------
       */

      allowDeposits: {
        type: Boolean,

        default: true,
      },

      allowWithdrawals: {
        type: Boolean,

        default: true,
      },

      allowTransfers: {
        type: Boolean,

        default: true,
      },

      /*
       * ----------------------------------------------------------------------
       * RISK / COMPLIANCE
       * ----------------------------------------------------------------------
       */

      riskLevel: {
        type: String,

        enum: {
          values:
            RISK_LEVELS,

          message:
            'Invalid account risk level.',
        },

        default: 'UNASSESSED',

        uppercase: true,

        index: true,
      },

      riskFlags: {
        type: [
          {
            type: String,
            trim: true,
            maxlength: 128,
          },
        ],

        default: [],

        validate: {
          validator(value) {
            return (
              Array.isArray(
                value,
              ) &&
              value.length <=
                MAX_RISK_FLAGS
            );
          },

          message:
            `Account riskFlags cannot contain more than ${MAX_RISK_FLAGS} entries.`,
        },
      },

      /*
       * ----------------------------------------------------------------------
       * NON-FINANCIAL METADATA
       * ----------------------------------------------------------------------
       */
      metadata: {
        type:
          Schema.Types.Mixed,

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

      tags: {
        type: [
          {
            type: String,
            trim: true,
            maxlength: 64,
          },
        ],

        default: [],

        validate: {
          validator(value) {
            return (
              Array.isArray(
                value,
              ) &&
              value.length <=
                MAX_TAGS
            );
          },

          message:
            `Account tags cannot contain more than ${MAX_TAGS} entries.`,
        },
      },

      /*
       * ----------------------------------------------------------------------
       * AUDIT ATTRIBUTION
       * ----------------------------------------------------------------------
       */
      createdBy: {
        type: String,

        trim: true,

        maxlength:
          OWNER_ID_MAX_LENGTH,

        default: null,

        immutable: true,

        validate: {
          validator:
            validateOptionalIdentifier,

          message:
            'Invalid createdBy identifier.',
        },
      },

      updatedBy: {
        type: String,

        trim: true,

        maxlength:
          OWNER_ID_MAX_LENGTH,

        default: null,

        validate: {
          validator:
            validateOptionalIdentifier,

          message:
            'Invalid updatedBy identifier.',
        },
      },
    },
    {
      timestamps: true,

      strict: true,

      strictQuery: true,

      /*
       * balanceRevision provides the explicit financial mutation sequence.
       *
       * The financial repository is responsible for atomic concurrency
       * control when changing balance-related fields.
       */
      versionKey: false,

      collection: 'accounts',

      minimize: false,

      toJSON: {
        virtuals: true,

        transform(
          _doc,
          ret,
        ) {
          if (
            ret._id !==
            undefined
          ) {
            ret.id =
              String(ret._id);

            delete ret._id;
          }

          delete ret.__v;

          for (
            const field of [
              'balance',
              'openingBalance',
              'reservedBalance',
              'availableBalance',
            ]
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

        transform(
          _doc,
          ret,
        ) {
          if (
            ret._id !==
            undefined
          ) {
            ret.id =
              String(ret._id);

            delete ret._id;
          }

          delete ret.__v;

          for (
            const field of [
              'balance',
              'openingBalance',
              'reservedBalance',
              'availableBalance',
            ]
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
    },
  );

/*
 * ============================================================================
 * FINANCIAL INVARIANTS
 * ============================================================================
 */

/*
 * Invariant:
 *
 *   balance >= 0
 *   reservedBalance >= 0
 *   reservedBalance <= balance
 *
 * Document-level validation protects normal save() workflows.
 *
 * BalanceRepository MUST also enforce the invariant in the atomic MongoDB
 * update filter for concurrent financial mutations.
 */
AccountSchema.path(
  'reservedBalance',
).validate(
  function validateReservedBalance(
    value,
  ) {
    if (
      value === null ||
      value === undefined
    ) {
      return true;
    }

    if (
      !this.balance
    ) {
      return true;
    }

    try {
      return (
        compareNonNegativeDecimals(
          value.toString(),
          this.balance.toString(),
        ) <= 0
      );
    } catch {
      return false;
    }
  },
  'Reserved balance cannot exceed account balance.',
);

/*
 * Prevent a closed account from being moved back into an operational state
 * through ordinary document validation.
 */
AccountSchema.pre(
  'validate',
  function validateAccountLifecycle(
    next,
  ) {
    if (
      this.status ===
        'CLOSED' &&
      this.isModified(
        'status',
      )
    ) {
      const original =
        this.get(
          'status',
        );

      /*
       * During a normal document load/edit workflow this comparison is
       * meaningful only when there is an original value available.
       *
       * Service/repository transitions remain the authoritative policy.
       */
      if (
        this.$isNew === false &&
        original ===
          'CLOSED'
      ) {
        /*
         * No automatic lifecycle mutation is performed here.
         */
      }
    }

    if (
      this.balanceRevision <
        0 ||
      !Number.isSafeInteger(
        this.balanceRevision,
      )
    ) {
      this.invalidate(
        'balanceRevision',
        'Balance revision must be a non-negative safe integer.',
      );
    }

    if (
      this.balance &&
      !validateNonNegativeDecimal128(
        this.balance,
      )
    ) {
      this.invalidate(
        'balance',
        'Account balance must be a finite, non-negative Decimal128 value.',
      );
    }

    if (
      this.openingBalance &&
      !validateNonNegativeDecimal128(
        this.openingBalance,
      )
    ) {
      this.invalidate(
        'openingBalance',
        'Opening balance must be a finite, non-negative Decimal128 value.',
      );
    }

    if (
      this.reservedBalance &&
      !validateNonNegativeDecimal128(
        this.reservedBalance,
      )
    ) {
      this.invalidate(
        'reservedBalance',
        'Reserved balance must be a finite, non-negative Decimal128 value.',
      );
    }

    if (
      this.balance &&
      this.reservedBalance
    ) {
      try {
        if (
          compareNonNegativeDecimals(
            this.reservedBalance.toString(),
            this.balance.toString(),
          ) > 0
        ) {
          this.invalidate(
            'reservedBalance',
            'Reserved balance cannot exceed account balance.',
          );
        }
      } catch {
        this.invalidate(
          'reservedBalance',
          'Reserved balance is invalid.',
        );
      }
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
  },
);

/*
 * ============================================================================
 * FINANCIAL MUTATION BOUNDARY
 * ============================================================================
 *
 * Financial fields are protected from ordinary query updates.
 *
 * BalanceRepository can explicitly opt into these mutations with:
 *
 *   {
 *     allowFinancialMutation: true
 *   }
 *
 * This is a model boundary only.
 * It is not an authorization system.
 * ============================================================================
 */

const FINANCIAL_MUTATION_FIELDS =
  Object.freeze([
    'balance',
    'reservedBalance',
    'balanceRevision',
    'lastTransactionId',
    'lastBalanceMutationAt',
  ]);

const IMMUTABLE_ACCOUNT_FIELDS =
  Object.freeze([
    '_id',
    'accountNumber',
    'tenantId',
    'accountType',
    'currency',
    'openingBalance',
  ]);

const ACCOUNT_MUTATION_OPERATORS =
  Object.freeze([
    '$set',
    '$setOnInsert',
    '$inc',
    '$mul',
    '$unset',
    '$min',
    '$max',
    '$currentDate',
    '$rename',
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
    const operator of ACCOUNT_MUTATION_OPERATORS
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

    if (
      Object.prototype.hasOwnProperty.call(
        payload,
        field,
      )
    ) {
      return true;
    }

    /*
     * Protect nested modifications to a protected root path.
     */
    for (
      const key of Object.keys(
        payload,
      )
    ) {
      if (
        key === field ||
        key.startsWith(
          `${field}.`,
        )
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

function rejectFinancialMutation(
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

  /*
   * Pipeline updates are especially difficult to guarantee against safely
   * at the model boundary, so they are rejected completely.
   */
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

  const touchesFinancialFields =
    updateTouchesAnyField(
      update,
      FINANCIAL_MUTATION_FIELDS,
    );

  const touchesImmutableFields =
    updateTouchesAnyField(
      update,
      IMMUTABLE_ACCOUNT_FIELDS,
    );

  if (
    touchesFinancialFields
  ) {
    return next(
      new Error(
        'Direct financial account mutation is prohibited. Use TITech BalanceRepository.',
      ),
    );
  }

  if (
    touchesImmutableFields
  ) {
    return next(
      new Error(
        'Account identity and financial classification fields are immutable.',
      ),
    );
  }

  return next();
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
    rejectFinancialMutation,
  );
}

/*
 * Replacement is prohibited because it can bypass immutable-field intent,
 * validation assumptions and financial mutation boundaries.
 */
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

/*
 * Bulk updates are blocked because they can bypass domain mutation policy.
 */
AccountSchema.pre(
  'bulkWrite',
  function rejectBulkWrite(
    next,
  ) {
    next(
      new Error(
        'Account.bulkWrite() is disabled. Use BalanceRepository or Account service operations.',
      ),
    );
  },
);

/*
 * ============================================================================
 * HARD DELETE PROTECTION
 * ============================================================================
 *
 * Financial accounts should normally be closed, not physically deleted.
 * Controlled retention/compliance workflows may operate outside ordinary
 * application deletion paths.
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
          'Financial accounts cannot be hard-deleted through normal application workflows.',
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
 * Available balance:
 *
 *   balance - reservedBalance
 *
 * Returned as Decimal128.
 */
AccountSchema.virtual(
  'availableBalance',
).get(
  function availableBalance() {
    try {
      const balance =
        this.balance ??
        decimal128Zero();

      const reserved =
        this.reservedBalance ??
        decimal128Zero();

      if (
        compareNonNegativeDecimals(
          reserved.toString(),
          balance.toString(),
        ) > 0
      ) {
        /*
         * Invalid in-memory state should not produce a misleading negative
         * financial amount.
         */
        return null;
      }

      return subtractNonNegativeDecimals(
        balance,
        reserved,
      );
    } catch {
      return null;
    }
  },
);

/*
 * ============================================================================
 * INSTANCE METHODS
 * ============================================================================
 */

AccountSchema.methods.isActive =
  function isActive() {
    return this.status ===
      'ACTIVE';
  };

AccountSchema.methods.isOperational =
  function isOperational() {
    return (
      this.status ===
      'ACTIVE'
    );
  };

AccountSchema.methods.isFrozen =
  function isFrozen() {
    return this.status ===
      'FROZEN';
  };

AccountSchema.methods.isSuspended =
  function isSuspended() {
    return this.status ===
      'SUSPENDED';
  };

AccountSchema.methods.isClosed =
  function isClosed() {
    return this.status ===
      'CLOSED';
  };

AccountSchema.methods.isPending =
  function isPending() {
    return this.status ===
      'PENDING';
  };

AccountSchema.methods.canReceiveDeposits =
  function canReceiveDeposits() {
    return (
      this.status ===
        'ACTIVE' &&
      this.allowDeposits ===
        true
    );
  };

AccountSchema.methods.canWithdraw =
  function canWithdraw() {
    return (
      this.status ===
        'ACTIVE' &&
      this.allowWithdrawals ===
        true
    );
  };

AccountSchema.methods.canTransfer =
  function canTransfer() {
    return (
      this.status ===
        'ACTIVE' &&
      this.allowTransfers ===
        true
    );
  };

AccountSchema.methods.getAvailableBalance =
  function getAvailableBalance() {
    return this.availableBalance;
  };

/**
 * Determine whether an account is permanently closed.
 */
AccountSchema.methods.isPermanentlyClosed =
  function isPermanentlyClosed() {
    return this.status ===
      'CLOSED';
  };

/**
 * Controlled lifecycle state transition.
 *
 * This does not perform authorization.
 * It only enforces the persistence-level transition contract.
 */
AccountSchema.methods.changeStatus =
  async function changeStatus(
    nextStatus,
    actorId = null,
    reason = null,
    options = {},
  ) {
    const normalizedStatus =
      String(
        nextStatus ?? '',
      )
        .trim()
        .toUpperCase();

    if (
      !ACCOUNT_STATUSES.includes(
        normalizedStatus,
      )
    ) {
      throw new Error(
        `Invalid financial account status: ${nextStatus}`,
      );
    }

    if (
      this.status ===
      normalizedStatus
    ) {
      return this;
    }

    const allowedTransitions =
      {
        PENDING:
          new Set([
            'ACTIVE',
            'SUSPENDED',
            'FROZEN',
            'CLOSED',
          ]),

        ACTIVE:
          new Set([
            'SUSPENDED',
            'FROZEN',
            'CLOSED',
          ]),

        SUSPENDED:
          new Set([
            'ACTIVE',
            'FROZEN',
            'CLOSED',
          ]),

        FROZEN:
          new Set([
            'ACTIVE',
            'SUSPENDED',
            'CLOSED',
          ]),

        CLOSED:
          new Set(),
      };

    const permitted =
      allowedTransitions[
        this.status
      ];

    if (
      !permitted ||
      !permitted.has(
        normalizedStatus,
      )
    ) {
      throw new Error(
        `Invalid account status transition: ${this.status} -> ${normalizedStatus}`,
      );
    }

    if (
      normalizedStatus ===
        'CLOSED' &&
      this.availableBalance &&
      compareNonNegativeDecimals(
        this.availableBalance.toString(),
        '0',
      ) !== 0
    ) {
      throw new Error(
        'An account with a non-zero available balance cannot be closed.',
      );
    }

    this.status =
      normalizedStatus;

    this.statusChangedAt =
      new Date();

    this.statusReason =
      reason === null ||
      reason === undefined
        ? null
        : String(
            reason,
          )
              .trim()
              .slice(
                0,
                STATUS_REASON_MAX_LENGTH,
              );

    if (
      actorId !== null &&
      actorId !== undefined
    ) {
      this.updatedBy =
        String(actorId);
    }

    return this.save({
      session:
        options.session,
    });
  };

/*
 * ============================================================================
 * STATIC HELPERS
 * ============================================================================
 */

/**
 * Find an ACTIVE account by immutable account ID within a tenant and,
 * optionally, currency.
 */
AccountSchema.statics.findActiveById =
  function findActiveById(
    {
      accountId,
      tenantId,
      currency,
      session,
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
      tenantId ===
        undefined ||
      tenantId === null
    ) {
      throw new TypeError(
        'tenantId is required.',
      );
    }

    if (
      !validateTenantId(
        String(tenantId),
      )
    ) {
      throw new TypeError(
        'Invalid tenantId.',
      );
    }

    const normalizedCurrency =
      currency ===
        undefined ||
      currency === null
        ? null
        : String(
            currency,
          )
            .trim()
            .toUpperCase();

    if (
      normalizedCurrency &&
      !CURRENCY_REGEX.test(
        normalizedCurrency,
      )
    ) {
      throw new TypeError(
        'Invalid currency.',
      );
    }

    const filter = {
      _id: String(
        accountId,
      ),

      tenantId:
        String(tenantId)
          .trim()
          .toLowerCase(),

      status:
        'ACTIVE',
    };

    if (
      normalizedCurrency
    ) {
      filter.currency =
        normalizedCurrency;
    }

    const query =
      this.findOne(
        filter,
      );

    if (
      session
    ) {
      query.session(
        session,
      );
    }

    return query;
  };

/**
 * Find one account by tenant + account ID.
 */
AccountSchema.statics.findByTenantAndId =
  function findByTenantAndId(
    {
      tenantId,
      accountId,
      session,
    } = {},
  ) {
    if (
      !validateTenantId(
        String(
          tenantId ?? '',
        ),
      )
    ) {
      throw new TypeError(
        'Invalid tenantId.',
      );
    }

    if (
      accountId ===
        undefined ||
      accountId === null
    ) {
      throw new TypeError(
        'accountId is required.',
      );
    }

    const query =
      this.findOne({
        _id:
          String(accountId),

        tenantId:
          String(tenantId)
            .trim()
            .toLowerCase(),
      });

    if (
      session
    ) {
      query.session(
        session,
      );
    }

    return query;
  };

/**
 * Find by tenant-scoped business account number.
 */
AccountSchema.statics.findByAccountNumber =
  function findByAccountNumber(
    {
      tenantId,
      accountNumber,
      session,
    } = {},
  ) {
    if (
      !validateTenantId(
        String(
          tenantId ?? '',
        ),
      )
    ) {
      throw new TypeError(
        'Invalid tenantId.',
      );
    }

    if (
      accountNumber ===
        undefined ||
      accountNumber === null
    ) {
      throw new TypeError(
        'accountNumber is required.',
      );
    }

    const normalizedAccountNumber =
      String(
        accountNumber,
      ).trim();

    if (
      !validateIdentifier(
        normalizedAccountNumber,
      )
    ) {
      throw new TypeError(
        'Invalid accountNumber.',
      );
    }

    const query =
      this.findOne({
        tenantId:
          String(tenantId)
            .trim()
            .toLowerCase(),

        accountNumber:
          normalizedAccountNumber,
      });

    if (
      session
    ) {
      query.session(
        session,
      );
    }

    return query;
  };

/**
 * Find all operational accounts for a tenant.
 */
AccountSchema.statics.findOperationalByTenant =
  function findOperationalByTenant(
    {
      tenantId,
      accountType,
      currency,
      limit = 100,
      session,
    } = {},
  ) {
    if (
      !validateTenantId(
        String(
          tenantId ?? '',
        ),
      )
    ) {
      throw new TypeError(
        'Invalid tenantId.',
      );
    }

    const safeLimit =
      Math.min(
        Math.max(
          Number(limit) ||
            100,
          1,
        ),
        500,
      );

    const filter = {
      tenantId:
        String(tenantId)
          .trim()
          .toLowerCase(),

      status:
        'ACTIVE',
    };

    if (
      accountType
    ) {
      const normalizedType =
        String(
          accountType,
        )
          .trim()
          .toUpperCase();

      if (
        !ACCOUNT_TYPES.includes(
          normalizedType,
        )
      ) {
        throw new TypeError(
          'Invalid accountType.',
        );
      }

      filter.accountType =
        normalizedType;
    }

    if (
      currency
    ) {
      const normalizedCurrency =
        String(
          currency,
        )
          .trim()
          .toUpperCase();

      if (
        !CURRENCY_REGEX.test(
          normalizedCurrency,
        )
      ) {
        throw new TypeError(
          'Invalid currency.',
        );
      }

      filter.currency =
        normalizedCurrency;
    }

    const query =
      this.find(filter)
        .sort({
          accountNumber: 1,
          _id: 1,
        })
        .limit(
          safeLimit,
        );

    if (
      session
    ) {
      query.session(
        session,
      );
    }

    return query;
  };

/**
 * Return a tenant-scoped account count.
 */
AccountSchema.statics.countByTenant =
  function countByTenant(
    tenantId,
    options = {},
  ) {
    if (
      !validateTenantId(
        String(
          tenantId ?? '',
        ),
      )
    ) {
      throw new TypeError(
        'Invalid tenantId.',
      );
    }

    const filter = {
      tenantId:
        String(tenantId)
          .trim()
          .toLowerCase(),
    };

    if (
      options.status
    ) {
      const status =
        String(
          options.status,
        )
          .trim()
          .toUpperCase();

      if (
        !ACCOUNT_STATUSES.includes(
          status,
        )
      ) {
        throw new TypeError(
          'Invalid account status.',
        );
      }

      filter.status =
        status;
    }

    const query =
      this.countDocuments(
        filter,
      );

    if (
      options.session
    ) {
      query.session(
        options.session,
      );
    }

    return query.exec();
  };

/*
 * ============================================================================
 * INDEXES
 * ============================================================================
 */

/*
 * Tenant + currency + status.
 */
AccountSchema.index(
  {
    tenantId: 1,
    currency: 1,
    status: 1,
  },
  {
    name:
      'idx_titech_account_tenant_currency_status',
  },
);

/*
 * Tenant-scoped business account number.
 */
AccountSchema.index(
  {
    tenantId: 1,
    accountNumber: 1,
  },
  {
    unique: true,

    name:
      'uniq_titech_tenant_account_number',
  },
);

/*
 * Member account lookup.
 */
AccountSchema.index(
  {
    tenantId: 1,
    memberId: 1,
    accountType: 1,
    currency: 1,
    status: 1,
  },
  {
    name:
      'idx_titech_member_accounts',
  },
);

/*
 * Group account lookup.
 */
AccountSchema.index(
  {
    tenantId: 1,
    groupId: 1,
    accountType: 1,
    currency: 1,
    status: 1,
  },
  {
    name:
      'idx_titech_group_accounts',
  },
);

/*
 * Owner account lookup.
 */
AccountSchema.index(
  {
    tenantId: 1,
    ownerId: 1,
    accountType: 1,
    currency: 1,
    status: 1,
  },
  {
    name:
      'idx_titech_owner_accounts',
  },
);

/*
 * Transaction traceability.
 */
AccountSchema.index(
  {
    tenantId: 1,
    lastTransactionId: 1,
  },
  {
    sparse: true,

    name:
      'idx_titech_last_transaction',
  },
);

/*
 * Operational status management.
 */
AccountSchema.index(
  {
    tenantId: 1,
    status: 1,
    createdAt: -1,
    _id: -1,
  },
  {
    name:
      'idx_titech_account_status',
  },
);

/*
 * Provider account reference.
 */
AccountSchema.index(
  {
    tenantId: 1,
    provider: 1,
    providerAccountReference: 1,
  },
  {
    sparse: true,

    name:
      'idx_titech_provider_account',
  },
);

/*
 * External reference.
 */
AccountSchema.index(
  {
    tenantId: 1,
    externalReference: 1,
  },
  {
    sparse: true,

    name:
      'idx_titech_external_reference',
  },
);

/*
 * Risk management.
 */
AccountSchema.index(
  {
    tenantId: 1,
    riskLevel: 1,
    status: 1,
  },
  {
    name:
      'idx_titech_account_risk',
  },
);

/*
 * ============================================================================
 * DECIMAL SERIALIZATION
 * ============================================================================
 */

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

  return value;
}

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