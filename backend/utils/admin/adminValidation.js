'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Admin Validation Utility
 * ============================================================================
 *
 * File:
 *   backend/utils/admin/adminValidation.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Canonical validation, normalization and sanitization utility for TITech
 * Community Capital administrative APIs.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Request payload validation
 * - Query parameter validation
 * - Route parameter validation
 * - ObjectId validation
 * - Tenant ID validation
 * - UUID validation
 * - Email validation
 * - Phone validation
 * - URL validation
 * - Date / date-range validation
 * - Pagination validation
 * - Cursor validation
 * - Numeric / financial amount validation
 * - Enum validation
 * - Search-input validation
 * - Sorting validation
 * - Safe object-key validation
 * - Unknown-field rejection
 * - Structured validation errors
 * - Express-compatible middleware
 *
 * Architectural boundary
 * ----------------------------------------------------------------------------
 * Validation IS:
 *   - "Is this input structurally valid?"
 *   - "Can this value safely enter the application?"
 *
 * Validation IS NOT:
 *   - Authentication
 *   - Authorization
 *   - RBAC
 *   - Tenant authorization
 *   - Loan approval
 *   - Fraud decisions
 *   - Financial calculations
 *   - Accounting/ledger posting
 *   - Audit persistence
 *
 * Tenant security
 * ----------------------------------------------------------------------------
 * The TITech multi-tenant architecture requires tenant enforcement on every
 * tenant-scoped query. This utility validates tenant identifiers, but does NOT
 * decide whether the caller is authorized to access that tenant.
 *
 * The trusted tenant must come from authenticated execution context.
 *
 * TITech terminology
 * ----------------------------------------------------------------------------
 * All ACFOS references are replaced by TITech Community Capital.
 *
 * Runtime
 * ----------------------------------------------------------------------------
 * - Node.js
 * - CommonJS
 * - No external validation package required
 * - Express-compatible middleware
 *
 * ============================================================================
 */

const crypto = require('node:crypto');

const mongoose = require('mongoose');

/**
 * ============================================================================
 * METADATA
 * ============================================================================
 */

const UTILITY_NAME =
  'AdminValidation';

const UTILITY_VERSION =
  '2026.1';

const APP_NAME =
  'TITech Community Capital';

/**
 * ============================================================================
 * LIMITS
 * ============================================================================
 */

const LIMITS = Object.freeze({
  MAX_STRING_LENGTH:
    1000,

  MAX_SHORT_STRING_LENGTH:
    255,

  MAX_NAME_LENGTH:
    160,

  MAX_EMAIL_LENGTH:
    320,

  MAX_PHONE_LENGTH:
    32,

  MAX_SEARCH_LENGTH:
    120,

  MAX_QUERY_STRING_LENGTH:
    500,

  MAX_ARRAY_LENGTH:
    100,

  MAX_OBJECT_KEYS:
    100,

  MAX_PAGE_SIZE:
    100,

  DEFAULT_PAGE_SIZE:
    25,

  MAX_EXPORT_LIMIT:
    10000,

  MAX_DATE_RANGE_DAYS:
    3660,

  MAX_AMOUNT:
    1_000_000_000_000_000,

  MAX_INTEGER:
    Number.MAX_SAFE_INTEGER,
});

/**
 * ============================================================================
 * ENUM CATALOGUES
 * ============================================================================
 *
 * These are validation defaults, not authorization decisions.
 * ============================================================================
 */

const ENUMS = Object.freeze({
  USER_ROLES:
    Object.freeze([
      'user',
      'admin',
      'group_admin',
    ]),

  USER_STATUSES:
    Object.freeze([
      'pending',
      'active',
      'disabled',
      'suspended',
      'locked',
    ]),

  LOAN_STATUSES:
    Object.freeze([
      'draft',
      'submitted',
      'under_review',
      'approved',
      'rejected',
      'disbursed',
      'active',
      'completed',
      'defaulted',
      'written_off',
      'recovered',
      'restructured',
      'cancelled',
    ]),

  RISK_LEVELS:
    Object.freeze([
      'low',
      'medium',
      'high',
      'critical',
    ]),

  RISK_BANDS:
    Object.freeze([
      'LOW',
      'MEDIUM',
      'HIGH',
    ]),

  AUDIT_ENTITY_TYPES:
    Object.freeze([
      'user',
      'member',
      'group',
      'loan',
      'transaction',
      'contribution',
      'savings',
      'payment',
      'subscription',
      'tenant',
      'compliance',
      'fraud',
      'system',
    ]),

  SORT_DIRECTIONS:
    Object.freeze([
      'asc',
      'desc',
    ]),

  GRANULARITIES:
    Object.freeze([
      'hour',
      'day',
      'week',
      'month',
    ]),

  CURRENCIES:
    Object.freeze([
      'UGX',
      'KES',
      'TZS',
      'RWF',
      'ZMW',
      'MWK',
      'USD',
      'EUR',
      'GBP',
    ]),

  CHANNELS:
    Object.freeze([
      'web',
      'mobile',
      'api',
      'admin',
      'background-job',
      'internal',
    ]),
});

/**
 * ============================================================================
 * REGEX
 * ============================================================================
 */

const REGEX = Object.freeze({
  email:
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/,

  phone:
    /^\+?[1-9]\d{7,14}$/,

  uuid:
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,

  isoDate:
    /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/,

  hexHash:
    /^[a-f0-9]{64}$/i,

  safeSlug:
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,

  alphaNumericReference:
    /^[A-Za-z0-9._:/-]+$/,

  safeSortField:
    /^[A-Za-z][A-Za-z0-9_.]*$/,

  amount:
    /^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/,

  integer:
    /^-?(?:0|[1-9]\d*)$/,
});

/**
 * ============================================================================
 * SENSITIVE FIELD CATALOGUE
 * ============================================================================
 *
 * These fields must never be allowed casually into arbitrary admin filters or
 * logs.
 * ============================================================================
 */

const SENSITIVE_FIELDS =
  Object.freeze([
    'password',
    'passwordHash',
    'passwordHistory',
    'resetPasswordToken',
    'verificationToken',
    'accessToken',
    'refreshToken',
    'token',
    'secret',
    'clientSecret',
    'privateKey',
    'apiKey',
    'mfaSecret',
    'backupCodes',
    'otp',
    'pin',
    'cvv',
    'cardNumber',
    'authorization',
    'cookie',
  ]);

/**
 * ============================================================================
 * ERROR CLASS
 * ============================================================================
 */

class AdminValidationError extends Error {
  constructor(
    message,
    {
      code =
        'ADMIN_VALIDATION_ERROR',

      statusCode =
        400,

      field =
        null,

      value =
        undefined,

      details =
        null,

      errors =
        [],
    } = {},
  ) {
    super(message);

    this.name =
      'AdminValidationError';

    this.code =
      code;

    this.statusCode =
      statusCode;

    this.field =
      field;

    this.value =
      value;

    this.details =
      details;

    this.errors =
      Array.isArray(errors)
        ? errors
        : [];

    this.isValidationError =
      true;
  }
}

/**
 * ============================================================================
 * VALIDATION RESULT
 * ============================================================================
 */

function success(
  value,
  metadata = {},
) {
  return {
    valid:
      true,

    value,

    errors:
      [],

    ...metadata,
  };
}

function failure(
  errors,
  metadata = {},
) {
  const normalizedErrors =
    Array.isArray(errors)
      ? errors
      : [errors];

  return {
    valid:
      false,

    value:
      null,

    errors:
      normalizedErrors,

    ...metadata,
  };
}

function createIssue(
  field,
  code,
  message,
  {
    value,
    expected,
    received,
    details,
  } = {},
) {
  return {
    field:
      field || null,

    code,

    message,

    ...(value !==
    undefined
      ? {
          value,
        }
      : {}),

    ...(expected !==
    undefined
      ? {
          expected,
        }
      : {}),

    ...(received !==
    undefined
      ? {
          received,
        }
      : {}),

    ...(details
      ? {
          details,
        }
      : {}),
  };
}

/**
 * ============================================================================
 * GENERIC NORMALIZATION
 * ============================================================================
 */

function normalizeString(
  value,
  {
    field =
      'value',

    required =
      false,

    trim =
      true,

    lowercase =
      false,

    uppercase =
      false,

    minLength =
      null,

    maxLength =
      LIMITS.MAX_STRING_LENGTH,

    defaultValue =
      null,
  } = {},
) {
  if (
    value ===
      undefined ||
    value ===
      null
  ) {
    if (
      required
    ) {
      throw new AdminValidationError(
        `${field} is required.`,
        {
          code:
            'REQUIRED_FIELD',

          field,
        },
      );
    }

    return defaultValue;
  }

  if (
    typeof value !==
    'string'
  ) {
    throw new AdminValidationError(
      `${field} must be a string.`,
      {
        code:
          'INVALID_STRING',

        field,

        value,
      },
    );
  }

  let result =
    trim
      ? value.trim()
      : value;

  if (
    lowercase
  ) {
    result =
      result.toLowerCase();
  }

  if (
    uppercase
  ) {
    result =
      result.toUpperCase();
  }

  if (
    minLength !==
      null &&
    result.length <
      minLength
  ) {
    throw new AdminValidationError(
      `${field} must contain at least ${minLength} characters.`,
      {
        code:
          'STRING_TOO_SHORT',

        field,
      },
    );
  }

  if (
    maxLength !==
      null &&
    result.length >
      maxLength
  ) {
    throw new AdminValidationError(
      `${field} exceeds the maximum allowed length.`,
      {
        code:
          'STRING_TOO_LONG',

        field,
      },
    );
  }

  return result;
}

function normalizeOptionalString(
  value,
  options = {},
) {
  return normalizeString(
    value,
    {
      ...options,
      required:
        false,
      defaultValue:
        options.defaultValue ??
        null,
    },
  );
}

/**
 * ============================================================================
 * BOOLEAN
 * ============================================================================
 */

function validateBoolean(
  value,
  field =
    'value',
) {
  if (
    typeof value ===
    'boolean'
  ) {
    return value;
  }

  if (
    typeof value ===
    'string'
  ) {
    const normalized =
      value
        .trim()
        .toLowerCase();

    if (
      normalized ===
        'true' ||
      normalized ===
        '1'
    ) {
      return true;
    }

    if (
      normalized ===
        'false' ||
      normalized ===
        '0'
    ) {
      return false;
    }
  }

  if (
    value === 1
  ) {
    return true;
  }

  if (
    value === 0
  ) {
    return false;
  }

  throw new AdminValidationError(
    `${field} must be a boolean.`,
    {
      code:
        'INVALID_BOOLEAN',

      field,
    },
  );
}

/**
 * ============================================================================
 * INTEGER
 * ============================================================================
 */

function validateInteger(
  value,
  {
    field =
      'value',

    required =
      false,

    min =
      null,

    max =
      null,

    defaultValue =
      null,
  } = {},
) {
  if (
    value ===
      undefined ||
    value ===
      null ||
    value ===
      ''
  ) {
    if (
      required
    ) {
      throw new AdminValidationError(
        `${field} is required.`,
        {
          code:
            'REQUIRED_FIELD',

          field,
        },
      );
    }

    return defaultValue;
  }

  const number =
    typeof value ===
    'number'
      ? value
      : Number(
          String(value).trim(),
        );

  if (
    !Number.isInteger(
      number,
    ) ||
    !Number.isSafeInteger(
      number,
    )
  ) {
    throw new AdminValidationError(
      `${field} must be a safe integer.`,
      {
        code:
          'INVALID_INTEGER',

        field,
      },
    );
  }

  if (
    min !== null &&
    number < min
  ) {
    throw new AdminValidationError(
      `${field} must be at least ${min}.`,
      {
        code:
          'INTEGER_TOO_SMALL',

        field,
      },
    );
  }

  if (
    max !== null &&
    number > max
  ) {
    throw new AdminValidationError(
      `${field} must not exceed ${max}.`,
      {
        code:
          'INTEGER_TOO_LARGE',

        field,
      },
    );
  }

  return number;
}

/**
 * ============================================================================
 * NUMBER
 * ============================================================================
 */

function validateNumber(
  value,
  {
    field =
      'value',

    required =
      false,

    min =
      null,

    max =
      null,

    decimals =
      null,

    defaultValue =
      null,
  } = {},
) {
  if (
    value ===
      undefined ||
    value ===
      null ||
    value ===
      ''
  ) {
    if (
      required
    ) {
      throw new AdminValidationError(
        `${field} is required.`,
        {
          code:
            'REQUIRED_FIELD',

          field,
        },
      );
    }

    return defaultValue;
  }

  const number =
    typeof value ===
    'number'
      ? value
      : Number(
          String(value).trim(),
        );

  if (
    !Number.isFinite(
      number,
    )
  ) {
    throw new AdminValidationError(
      `${field} must be a finite number.`,
      {
        code:
          'INVALID_NUMBER',

        field,
      },
    );
  }

  if (
    min !== null &&
    number < min
  ) {
    throw new AdminValidationError(
      `${field} must be at least ${min}.`,
      {
        code:
          'NUMBER_TOO_SMALL',

        field,
      },
    );
  }

  if (
    max !== null &&
    number > max
  ) {
    throw new AdminValidationError(
      `${field} must not exceed ${max}.`,
      {
        code:
          'NUMBER_TOO_LARGE',

        field,
      },
    );
  }

  if (
    decimals !== null
  ) {
    const multiplier =
      10 ** decimals;

    const rounded =
      Math.round(
        number *
          multiplier,
      ) /
      multiplier;

    if (
      rounded !==
      number
    ) {
      throw new AdminValidationError(
        `${field} must not contain more than ${decimals} decimal places.`,
        {
          code:
            'TOO_MANY_DECIMALS',

          field,
        },
      );
    }
  }

  return number;
}

/**
 * ============================================================================
 * FINANCIAL AMOUNT
 * ============================================================================
 *
 * Admin request validation should reject Infinity, NaN, negative values where
 * prohibited and numbers exceeding supported operating boundaries.
 *
 * This function validates amount representation only. It does not perform
 * balance checks, exchange-rate conversion or accounting.
 * ============================================================================
 */

function validateAmount(
  value,
  {
    field =
      'amount',

    required =
      true,

    allowZero =
      false,

    allowNegative =
      false,

    max =
      LIMITS.MAX_AMOUNT,

    decimals =
      2,
  } = {},
) {
  const number =
    validateNumber(
      value,
      {
        field,
        required,
        min:
          allowNegative
            ? -max
            : allowZero
              ? 0
              : Number.EPSILON,
        max,
        decimals,
      },
    );

  if (
    number ===
      null ||
    number ===
      undefined
  ) {
    return number;
  }

  if (
    !allowZero &&
    number === 0
  ) {
    throw new AdminValidationError(
      `${field} must be greater than zero.`,
      {
        code:
          'AMOUNT_MUST_BE_POSITIVE',

        field,
      },
    );
  }

  if (
    !allowNegative &&
    number < 0
  ) {
    throw new AdminValidationError(
      `${field} cannot be negative.`,
      {
        code:
          'NEGATIVE_AMOUNT',

        field,
      },
    );
  }

  return number;
}

/**
 * ============================================================================
 * OBJECT ID
 * ============================================================================
 */

function validateObjectId(
  value,
  field =
    'id',
  {
    required =
      true,
  } = {},
) {
  if (
    value ===
      undefined ||
    value ===
      null ||
    value ===
      ''
  ) {
    if (
      required
    ) {
      throw new AdminValidationError(
        `${field} is required.`,
        {
          code:
            'REQUIRED_ID',

          field,
        },
      );
    }

    return null;
  }

  const normalized =
    normalizeString(
      value,
      {
        field,
        required: true,
        maxLength: 64,
      },
    );

  if (
    !mongoose.Types.ObjectId.isValid(
      normalized,
    )
  ) {
    throw new AdminValidationError(
      `${field} must be a valid MongoDB ObjectId.`,
      {
        code:
          'INVALID_OBJECT_ID',

        field,
      },
    );
  }

  return normalized;
}

function toObjectId(
  value,
  field =
    'id',
  options = {},
) {
  const validated =
    validateObjectId(
      value,
      field,
      options,
    );

  return validated
    ? new mongoose.Types.ObjectId(
        validated,
      )
    : null;
}

/**
 * ============================================================================
 * TENANT ID
 * ============================================================================
 */

function validateTenantId(
  value,
  {
    required =
      true,
  } = {},
) {
  return validateObjectId(
    value,
    'tenantId',
    {
      required,
    },
  );
}

/**
 * ============================================================================
 * UUID
 * ============================================================================
 */

function validateUUID(
  value,
  {
    field =
      'id',

    required =
      true,
  } = {},
) {
  if (
    value ===
      undefined ||
    value ===
      null ||
    value ===
      ''
  ) {
    if (
      required
    ) {
      throw new AdminValidationError(
        `${field} is required.`,
        {
          code:
            'REQUIRED_FIELD',

          field,
        },
      );
    }

    return null;
  }

  const normalized =
    normalizeString(
      value,
      {
        field,
        required: true,
        maxLength: 36,
      },
    );

  if (
    !REGEX.uuid.test(
      normalized,
    )
  ) {
    throw new AdminValidationError(
      `${field} must be a valid UUID.`,
      {
        code:
          'INVALID_UUID',

        field,
      },
    );
  }

  return normalized;
}

/**
 * ============================================================================
 * EMAIL
 * ============================================================================
 */

function validateEmail(
  value,
  {
    field =
      'email',

    required =
      true,
  } = {},
) {
  if (
    value ===
      undefined ||
    value ===
      null ||
    value ===
      ''
  ) {
    if (
      required
    ) {
      throw new AdminValidationError(
        `${field} is required.`,
        {
          code:
            'REQUIRED_EMAIL',

          field,
        },
      );
    }

    return null;
  }

  const normalized =
    normalizeString(
      value,
      {
        field,

        required: true,

        lowercase:
          true,

        maxLength:
          LIMITS.MAX_EMAIL_LENGTH,
      },
    );

  if (
    !REGEX.email.test(
      normalized,
    )
  ) {
    throw new AdminValidationError(
      `${field} must be a valid email address.`,
      {
        code:
          'INVALID_EMAIL',

        field,
      },
    );
  }

  return normalized;
}

/**
 * ============================================================================
 * PHONE
 * ============================================================================
 */

function validatePhone(
  value,
  {
    field =
      'phone',

    required =
      true,
  } = {},
) {
  if (
    value ===
      undefined ||
    value ===
      null ||
    value ===
      ''
  ) {
    if (
      required
    ) {
      throw new AdminValidationError(
        `${field} is required.`,
        {
          code:
            'REQUIRED_PHONE',

          field,
        },
      );
    }

    return null;
  }

  const normalized =
    normalizeString(
      value,
      {
        field,

        required: true,

        maxLength:
          LIMITS.MAX_PHONE_LENGTH,
      },
    )
      .replace(
        /[\s()-]/g,
        '',
      );

  if (
    !REGEX.phone.test(
      normalized,
    )
  ) {
    throw new AdminValidationError(
      `${field} must be a valid international phone number.`,
      {
        code:
          'INVALID_PHONE',

        field,
      },
    );
  }

  return normalized;
}

/**
 * ============================================================================
 * URL
 * ============================================================================
 */

function validateUrl(
  value,
  {
    field =
      'url',

    required =
      false,
  } = {},
) {
  if (
    value ===
      undefined ||
    value ===
      null ||
    value ===
      ''
  ) {
    if (
      required
    ) {
      throw new AdminValidationError(
        `${field} is required.`,
        {
          code:
            'REQUIRED_FIELD',

          field,
        },
      );
    }

    return null;
  }

  const normalized =
    normalizeString(
      value,
      {
        field,
        required: true,
        maxLength:
          LIMITS.MAX_STRING_LENGTH,
      },
    );

  let parsed;

  try {
    parsed =
      new URL(
        normalized,
      );
  } catch {
    throw new AdminValidationError(
      `${field} must be a valid URL.`,
      {
        code:
          'INVALID_URL',

        field,
      },
    );
  }

  if (
    ![
      'https:',
      'http:',
    ].includes(
      parsed.protocol,
    )
  ) {
    throw new AdminValidationError(
      `${field} must use HTTP or HTTPS.`,
      {
        code:
          'UNSUPPORTED_URL_PROTOCOL',

        field,
      },
    );
  }

  return parsed.toString();
}

/**
 * ============================================================================
 * ENUM
 * ============================================================================
 */

function validateEnum(
  value,
  {
    field =
      'value',

    allowed = [],

    required =
      true,

    caseInsensitive =
      false,

    defaultValue =
      null,
  } = {},
) {
  if (
    value ===
      undefined ||
    value ===
      null ||
    value ===
      ''
  ) {
    if (
      required
    ) {
      throw new AdminValidationError(
        `${field} is required.`,
        {
          code:
            'REQUIRED_ENUM',

          field,
        },
      );
    }

    return defaultValue;
  }

  const normalized =
    normalizeString(
      value,
      {
        field,
        required: true,
      },
    );

  const candidate =
    caseInsensitive
      ? normalized.toLowerCase()
      : normalized;

  const match =
    allowed.find(
      (entry) =>
        caseInsensitive
          ? String(
              entry,
            ).toLowerCase() ===
            candidate
          : String(
              entry,
            ) === candidate,
    );

  if (
    match ===
    undefined
  ) {
    throw new AdminValidationError(
      `${field} contains an unsupported value.`,
      {
        code:
          'INVALID_ENUM',

        field,

        details: {
          allowed,
        },
      },
    );
  }

  return match;
}

function validateEnumArray(
  value,
  {
    field =
      'values',

    allowed = [],

    required =
      false,

    maxLength =
      LIMITS.MAX_ARRAY_LENGTH,
  } = {},
) {
  if (
    value ===
      undefined ||
    value ===
      null ||
    value ===
      ''
  ) {
    if (
      required
    ) {
      throw new AdminValidationError(
        `${field} is required.`,
        {
          code:
            'REQUIRED_ARRAY',

          field,
        },
      );
    }

    return [];
  }

  const values =
    Array.isArray(
      value,
    )
      ? value
      : String(value).split(',');

  if (
    values.length >
    maxLength
  ) {
    throw new AdminValidationError(
      `${field} contains too many values.`,
      {
        code:
          'ARRAY_TOO_LARGE',

        field,
      },
    );
  }

  return [
    ...new Set(
      values.map(
        (item) =>
          validateEnum(
            item,
            {
              field,
              allowed,
              required: true,
              caseInsensitive:
                false,
            },
          ),
      ),
    ),
  ];
}

/**
 * ============================================================================
 * ARRAY / STRING ARRAY
 * ============================================================================
 */

function validateStringArray(
  value,
  {
    field =
      'values',

    required =
      false,

    minLength =
      0,

    maxLength =
      LIMITS.MAX_ARRAY_LENGTH,

    itemMaxLength =
      LIMITS.MAX_SHORT_STRING_LENGTH,

    unique =
      true,
  } = {},
) {
  if (
    value ===
      undefined ||
    value ===
      null
  ) {
    if (
      required
    ) {
      throw new AdminValidationError(
        `${field} is required.`,
        {
          code:
            'REQUIRED_ARRAY',

          field,
        },
      );
    }

    return [];
  }

  const values =
    Array.isArray(
      value,
    )
      ? value
      : String(value).split(',');

  if (
    values.length <
    minLength
  ) {
    throw new AdminValidationError(
      `${field} must contain at least ${minLength} items.`,
      {
        code:
          'ARRAY_TOO_SHORT',

        field,
      },
    );
  }

  if (
    values.length >
    maxLength
  ) {
    throw new AdminValidationError(
      `${field} must not contain more than ${maxLength} items.`,
      {
        code:
          'ARRAY_TOO_LARGE',

        field,
      },
    );
  }

  const result =
    values.map(
      (
        value,
        index,
      ) =>
        normalizeString(
          value,
          {
            field:
              `${field}[${index}]`,

            required: true,

            maxLength:
              itemMaxLength,
          },
        ),
    );

  return unique
    ? [
        ...new Set(
          result,
        ),
      ]
    : result;
}

/**
 * ============================================================================
 * DATE
 * ============================================================================
 */

function validateDate(
  value,
  {
    field =
      'date',

    required =
      true,

    min =
      null,

    max =
      null,
  } = {},
) {
  if (
    value ===
      undefined ||
    value ===
      null ||
    value ===
      ''
  ) {
    if (
      required
    ) {
      throw new AdminValidationError(
        `${field} is required.`,
        {
          code:
            'REQUIRED_DATE',

          field,
        },
      );
    }

    return null;
  }

  const date =
    value instanceof Date
      ? new Date(
          value.getTime(),
        )
      : new Date(
          String(
            value,
          ).trim(),
        );

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    throw new AdminValidationError(
      `${field} must be a valid date.`,
      {
        code:
          'INVALID_DATE',

        field,
      },
    );
  }

  if (
    min
  ) {
    const minDate =
      min instanceof Date
        ? min
        : new Date(min);

    if (
      date <
      minDate
    ) {
      throw new AdminValidationError(
        `${field} is earlier than the permitted minimum.`,
        {
          code:
            'DATE_TOO_EARLY',

          field,
        },
      );
    }
  }

  if (
    max
  ) {
    const maxDate =
      max instanceof Date
        ? max
        : new Date(max);

    if (
      date >
      maxDate
    ) {
      throw new AdminValidationError(
        `${field} is later than the permitted maximum.`,
        {
          code:
            'DATE_TOO_LATE',

          field,
        },
      );
    }
  }

  return date;
}

/**
 * ============================================================================
 * DATE RANGE
 * ============================================================================
 */

function validateDateRange(
  {
    from =
      null,

    to =
      null,

    days =
      null,
  } = {},
  {
    fromField =
      'from',

    toField =
      'to',

    maxDays =
      LIMITS.MAX_DATE_RANGE_DAYS,

    allowFuture =
      true,
  } = {},
) {
  let normalizedFrom =
    validateDate(
      from,
      {
        field:
          fromField,

        required:
          false,
      },
    );

  let normalizedTo =
    validateDate(
      to,
      {
        field:
          toField,

        required:
          false,
      },
    );

  if (
    !normalizedFrom &&
    !normalizedTo &&
    days !==
      null &&
    days !==
      undefined
  ) {
    const parsedDays =
      validateInteger(
        days,
        {
          field:
            'days',

          required:
            true,

          min:
            1,

          max:
            maxDays,
        },
      );

    normalizedTo =
      new Date();

    normalizedFrom =
      new Date(
        normalizedTo.getTime() -
          parsedDays *
            24 *
            60 *
            60 *
            1000,
      );
  }

  if (
    normalizedFrom &&
    normalizedTo &&
    normalizedFrom >
      normalizedTo
  ) {
    throw new AdminValidationError(
      `${fromField} cannot be later than ${toField}.`,
      {
        code:
          'INVALID_DATE_RANGE',
      },
    );
  }

  if (
    normalizedFrom &&
    normalizedTo
  ) {
    const rangeDays =
      (
        normalizedTo.getTime() -
        normalizedFrom.getTime()
      ) /
      (
        24 *
        60 *
        60 *
        1000
      );

    if (
      rangeDays >
      maxDays
    ) {
      throw new AdminValidationError(
        `The requested date range exceeds ${maxDays} days.`,
        {
          code:
            'DATE_RANGE_TOO_LARGE',
        },
      );
    }
  }

  if (
    !allowFuture
  ) {
    const now =
      new Date();

    if (
      normalizedFrom &&
      normalizedFrom >
        now
    ) {
      throw new AdminValidationError(
        `${fromField} cannot be in the future.`,
        {
          code:
            'FUTURE_DATE_NOT_ALLOWED',

          field:
            fromField,
        },
      );
    }

    if (
      normalizedTo &&
      normalizedTo >
        now
    ) {
      throw new AdminValidationError(
        `${toField} cannot be in the future.`,
        {
          code:
            'FUTURE_DATE_NOT_ALLOWED',

          field:
            toField,
        },
      );
    }
  }

  return {
    from:
      normalizedFrom,

    to:
      normalizedTo,
  };
}

/**
 * ============================================================================
 * PAGINATION
 * ============================================================================
 */

function validatePagination(
  input = {},
) {
  const page =
    validateInteger(
      input.page,
      {
        field:
          'page',

        required:
          false,

        min:
          1,

        max:
          Number.MAX_SAFE_INTEGER,

        defaultValue:
          1,
      },
    );

  const limit =
    validateInteger(
      input.limit,
      {
        field:
          'limit',

        required:
          false,

        min:
          1,

        max:
          LIMITS.MAX_PAGE_SIZE,

        defaultValue:
          LIMITS.DEFAULT_PAGE_SIZE,
      },
    );

  const cursor =
    input.cursor !==
      undefined &&
    input.cursor !==
      null
      ? validateCursor(
          input.cursor,
        )
      : null;

  return {
    page,

    limit,

    cursor,

    offset:
      (
        page -
        1
      ) *
      limit,
  };
}

/**
 * ============================================================================
 * CURSOR
 * ============================================================================
 *
 * TITech repositories generated in this architecture use opaque base64url
 * cursors. This utility validates structure but does not make authorization
 * decisions based on cursor content.
 * ============================================================================
 */

function validateCursor(
  value,
  {
    field =
      'cursor',

    maxLength =
      2048,
  } = {},
) {
  const cursor =
    normalizeString(
      value,
      {
        field,
        required: true,
        maxLength,
      },
    );

  let decoded;

  try {
    decoded =
      JSON.parse(
        Buffer
          .from(
            cursor,
            'base64url',
          )
          .toString(
            'utf8',
          ),
      );
  } catch {
    throw new AdminValidationError(
      `${field} is not a valid pagination cursor.`,
      {
        code:
          'INVALID_CURSOR',

        field,
      },
    );
  }

  if (
    !decoded ||
    typeof decoded !==
      'object'
  ) {
    throw new AdminValidationError(
      `${field} contains an invalid cursor payload.`,
      {
        code:
          'INVALID_CURSOR_PAYLOAD',

        field,
      },
    );
  }

  return cursor;
}

/**
 * ============================================================================
 * SORTING
 * ============================================================================
 */

function validateSort(
  input = {},
  {
    allowedFields =
      [],
    defaultField =
      'createdAt',
    defaultDirection =
      'desc',
  } = {},
) {
  const field =
    normalizeString(
      input.sortBy ||
        input.sort ||
        defaultField,
      {
        field:
          'sortBy',

        required:
          true,

        maxLength:
          100,
      },
    );

  if (
    !REGEX.safeSortField.test(
      field,
    )
  ) {
    throw new AdminValidationError(
      'sortBy contains an invalid field name.',
      {
        code:
          'INVALID_SORT_FIELD',

        field:
          'sortBy',
      },
    );
  }

  if (
    allowedFields.length &&
    !allowedFields.includes(
      field,
    )
  ) {
    throw new AdminValidationError(
      'sortBy is not allowed for this resource.',
      {
        code:
          'SORT_FIELD_NOT_ALLOWED',

        field:
          'sortBy',

        details: {
          allowedFields,
        },
      },
    );
  }

  const direction =
    validateEnum(
      input.sortDirection ||
        input.order ||
        defaultDirection,
      {
        field:
          'sortDirection',

        allowed:
          ENUMS.SORT_DIRECTIONS,

        required:
          true,

        caseInsensitive:
          true,
      },
    );

  return {
    field,

    direction:
      direction.toLowerCase(),

    mongo:
      {
        [field]:
          direction.toLowerCase() ===
          'asc'
            ? 1
            : -1,
      },
  };
}

/**
 * ============================================================================
 * SEARCH
 * ============================================================================
 */

function validateSearch(
  value,
  {
    field =
      'search',

    required =
      false,

    minLength =
      1,

    maxLength =
      LIMITS.MAX_SEARCH_LENGTH,
  } = {},
) {
  if (
    value ===
      undefined ||
    value ===
      null ||
    value ===
      ''
  ) {
    if (
      required
    ) {
      throw new AdminValidationError(
        `${field} is required.`,
        {
          code:
            'REQUIRED_SEARCH',

          field,
        },
      );
    }

    return null;
  }

  const search =
    normalizeString(
      value,
      {
        field,

        required:
          true,

        minLength,

        maxLength,
      },
    );

  /**
   * Reject NUL/control characters and embedded line controls. These are almost
   * never meaningful for an admin search query and can cause downstream logging
   * and parser issues.
   */
  if (
    /[\u0000-\u001F\u007F]/.test(
      search,
    )
  ) {
    throw new AdminValidationError(
      `${field} contains unsupported control characters.`,
      {
        code:
          'UNSAFE_SEARCH_INPUT',

        field,
      },
    );
  }

  return search;
}

/**
 * ============================================================================
 * REGEX SEARCH ESCAPING
 * ============================================================================
 */

function escapeRegex(
  value,
) {
  return String(
    value,
  ).replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&',
  );
}

/**
 * ============================================================================
 * SAFE FIELD NAME
 * ============================================================================
 */

function validateFieldName(
  value,
  {
    field =
      'field',

    required =
      true,

    allowed =
      [],
  } = {},
) {
  const normalized =
    normalizeString(
      value,
      {
        field,
        required,
        maxLength:
          120,
      },
    );

  if (
    normalized ===
    null
  ) {
    return null;
  }

  if (
    !REGEX.safeSortField.test(
      normalized,
    )
  ) {
    throw new AdminValidationError(
      `${field} contains an invalid field name.`,
      {
        code:
          'INVALID_FIELD_NAME',

        field,
      },
    );
  }

  if (
    allowed.length &&
    !allowed.includes(
      normalized,
    )
  ) {
    throw new AdminValidationError(
      `${field} is not permitted.`,
      {
        code:
          'FIELD_NOT_ALLOWED',

        field,
      },
    );
  }

  return normalized;
}

/**
 * ============================================================================
 * SAFE OBJECT KEYS
 * ============================================================================
 */

function assertAllowedKeys(
  object,
  {
    allowedKeys =
      [],

    field =
      'payload',

    rejectUnknown =
      true,
  } = {},
) {
  if (
    !object ||
    typeof object !==
      'object' ||
    Array.isArray(object)
  ) {
    throw new AdminValidationError(
      `${field} must be an object.`,
      {
        code:
          'INVALID_OBJECT',

        field,
      },
    );
  }

  const keys =
    Object.keys(
      object,
    );

  if (
    keys.length >
    LIMITS.MAX_OBJECT_KEYS
  ) {
    throw new AdminValidationError(
      `${field} contains too many properties.`,
      {
        code:
          'OBJECT_TOO_LARGE',

        field,
      },
    );
  }

  if (
    !rejectUnknown ||
    allowedKeys.length ===
      0
  ) {
    return true;
  }

  const unknown =
    keys.filter(
      (key) =>
        !allowedKeys.includes(
          key,
        ),
    );

  if (
    unknown.length
  ) {
    throw new AdminValidationError(
      `${field} contains unsupported fields.`,
      {
        code:
          'UNKNOWN_FIELDS',

        field,

        details: {
          unknown,
        },
      },
    );
  }

  return true;
}

/**
 * ============================================================================
 * SENSITIVE FIELD GUARD
 * ============================================================================
 */

function assertNoSensitiveFields(
  object,
  {
    field =
      'payload',

    recursive =
      true,
  } = {},
) {
  if (
    object ===
      null ||
    object ===
      undefined
  ) {
    return true;
  }

  if (
    Array.isArray(object)
  ) {
    if (
      recursive
    ) {
      object.forEach(
        (item) =>
          assertNoSensitiveFields(
            item,
            {
              field,
              recursive,
            },
          ),
      );
    }

    return true;
  }

  if (
    typeof object !==
    'object'
  ) {
    return true;
  }

  for (
    const [
      key,
      value,
    ] of Object.entries(
      object,
    )
  ) {
    if (
      SENSITIVE_FIELDS.includes(
        key,
      )
    ) {
      throw new AdminValidationError(
        `${field}.${key} is not permitted in this administrative validation payload.`,
        {
          code:
            'SENSITIVE_FIELD_NOT_ALLOWED',

          field:
            `${field}.${key}`,
        },
      );
    }

    if (
      recursive &&
      value &&
      typeof value ===
        'object'
    ) {
      assertNoSensitiveFields(
        value,
        {
          field:
            `${field}.${key}`,

          recursive,
        },
      );
    }
  }

  return true;
}

/**
 * ============================================================================
 * OBJECTID MAP
 * ============================================================================
 */

function validateObjectIdMap(
  input,
  fields,
) {
  const output =
    {};

  for (
    const field of
    fields
  ) {
    if (
      input[field] !==
      undefined
    ) {
      output[field] =
        validateObjectId(
          input[field],
          field,
        );
    }
  }

  return output;
}

/**
 * ============================================================================
 * ADMIN USER INPUT
 * ============================================================================
 */

function validateAdminUserSearch(
  input = {},
) {
  assertAllowedKeys(
    input,
    {
      field:
        'adminUserSearch',

      allowedKeys: [
        'tenantId',
        'userId',
        'search',
        'role',
        'roles',
        'status',
        'statuses',
        'isActive',
        'isVerified',
        'kycStatus',
        'kycStatuses',
        'amlRiskRating',
        'amlRiskRatings',
        'mfaEnabled',
        'mobileMoneyVerified',
        'lockedOnly',
        'highRiskOnly',
        'unverifiedOnly',
        'createdFrom',
        'createdTo',
        'lastLoginFrom',
        'lastLoginTo',
        'page',
        'limit',
        'cursor',
        'sortBy',
        'sortDirection',
      ],
    },
  );

  const result =
    {};

  if (
    input.tenantId !==
    undefined
  ) {
    result.tenantId =
      validateTenantId(
        input.tenantId,
      );
  }

  if (
    input.userId !==
    undefined
  ) {
    result.userId =
      validateObjectId(
        input.userId,
        'userId',
      );
  }

  if (
    input.search !==
    undefined
  ) {
    result.search =
      validateSearch(
        input.search,
      );
  }

  if (
    input.roles !==
      undefined ||
    input.role !==
      undefined
  ) {
    result.roles =
      validateEnumArray(
        input.roles ||
          input.role,
        {
          field:
            'roles',

          allowed:
            ENUMS.USER_ROLES,
        },
      );
  }

  if (
    input.statuses !==
      undefined ||
    input.status !==
      undefined
  ) {
    result.statuses =
      validateEnumArray(
        input.statuses ||
          input.status,
        {
          field:
            'statuses',

          allowed:
            ENUMS.USER_STATUSES,
        },
      );
  }

  if (
    input.isActive !==
      undefined
  ) {
    result.isActive =
      validateBoolean(
        input.isActive,
        'isActive',
      );
  }

  if (
    input.isVerified !==
      undefined
  ) {
    result.isVerified =
      validateBoolean(
        input.isVerified,
        'isVerified',
      );
  }

  if (
    input.kycStatuses !==
      undefined ||
    input.kycStatus !==
      undefined
  ) {
    result.kycStatuses =
      validateStringArray(
        input.kycStatuses ||
          input.kycStatus,
        {
          field:
            'kycStatuses',

          maxLength:
            10,
        },
      );
  }

  if (
    input.amlRiskRatings !==
      undefined ||
    input.amlRiskRating !==
      undefined
  ) {
    result.amlRiskRatings =
      validateEnumArray(
        input.amlRiskRatings ||
          input.amlRiskRating,
        {
          field:
            'amlRiskRatings',

          allowed:
            ENUMS.RISK_LEVELS,
        },
      );
  }

  if (
    input.mfaEnabled !==
      undefined
  ) {
    result.mfaEnabled =
      validateBoolean(
        input.mfaEnabled,
        'mfaEnabled',
      );
  }

  if (
    input.mobileMoneyVerified !==
      undefined
  ) {
    result.mobileMoneyVerified =
      validateBoolean(
        input.mobileMoneyVerified,
        'mobileMoneyVerified',
      );
  }

  if (
    input.lockedOnly !==
      undefined
  ) {
    result.lockedOnly =
      validateBoolean(
        input.lockedOnly,
        'lockedOnly',
      );
  }

  if (
    input.highRiskOnly !==
      undefined
  ) {
    result.highRiskOnly =
      validateBoolean(
        input.highRiskOnly,
        'highRiskOnly',
      );
  }

  if (
    input.unverifiedOnly !==
      undefined
  ) {
    result.unverifiedOnly =
      validateBoolean(
        input.unverifiedOnly,
        'unverifiedOnly',
      );
  }

  const dateRange =
    validateDateRange(
      {
        from:
          input.createdFrom,

        to:
          input.createdTo,
      },
      {
        fromField:
          'createdFrom',

        toField:
          'createdTo',

        allowFuture:
          true,
      },
    );

  result.createdFrom =
    dateRange.from;

  result.createdTo =
    dateRange.to;

  const loginRange =
    validateDateRange(
      {
        from:
          input.lastLoginFrom,

        to:
          input.lastLoginTo,
      },
      {
        fromField:
          'lastLoginFrom',

        toField:
          'lastLoginTo',

        allowFuture:
          true,
      },
    );

  result.lastLoginFrom =
    loginRange.from;

  result.lastLoginTo =
    loginRange.to;

  Object.assign(
    result,
    validatePagination(
      input,
    ),
  );

  return result;
}

/**
 * ============================================================================
 * ADMIN LOAN SEARCH
 * ============================================================================
 */

function validateAdminLoanSearch(
  input = {},
) {
  assertAllowedKeys(
    input,
    {
      field:
        'adminLoanSearch',

      allowedKeys: [
        'tenantId',
        'loanId',
        'userId',
        'memberId',
        'groupId',
        'search',
        'status',
        'statuses',
        'purpose',
        'currency',
        'minRiskScore',
        'maxRiskScore',
        'minCreditScore',
        'maxCreditScore',
        'minDaysPastDue',
        'maxDaysPastDue',
        'createdFrom',
        'createdTo',
        'approvedFrom',
        'approvedTo',
        'disbursedFrom',
        'disbursedTo',
        'maturityFrom',
        'maturityTo',
        'activeOnly',
        'overdueOnly',
        'highRiskOnly',
        'defaultedOnly',
        'page',
        'limit',
        'cursor',
        'sortBy',
        'sortDirection',
      ],
    },
  );

  const result =
    {};

  if (
    input.tenantId !==
    undefined
  ) {
    result.tenantId =
      validateTenantId(
        input.tenantId,
      );
  }

  for (
    const field of [
      'loanId',
      'userId',
      'memberId',
      'groupId',
    ]
  ) {
    if (
      input[field] !==
      undefined
    ) {
      result[field] =
        validateObjectId(
          input[field],
          field,
        );
    }
  }

  if (
    input.search !==
    undefined
  ) {
    result.search =
      validateSearch(
        input.search,
      );
  }

  if (
    input.statuses !==
      undefined ||
    input.status !==
      undefined
  ) {
    result.statuses =
      validateEnumArray(
        input.statuses ||
          input.status,
        {
          field:
            'statuses',

          allowed:
            ENUMS.LOAN_STATUSES,
        },
      );
  }

  if (
    input.purpose !==
    undefined
  ) {
    result.purpose =
      normalizeString(
        input.purpose,
        {
          field:
            'purpose',

          maxLength:
            255,
        },
      );
  }

  if (
    input.currency !==
    undefined
  ) {
    result.currency =
      validateEnum(
        input.currency,
        {
          field:
            'currency',

          allowed:
            ENUMS.CURRENCIES,

          caseInsensitive:
            true,
        },
      );
  }

  if (
    input.minRiskScore !==
      undefined ||
    input.maxRiskScore !==
      undefined
  ) {
    result.minRiskScore =
      validateNumber(
        input.minRiskScore,
        {
          field:
            'minRiskScore',

          required:
            false,

          min:
            0,

          max:
            1000,
        },
      );

    result.maxRiskScore =
      validateNumber(
        input.maxRiskScore,
        {
          field:
            'maxRiskScore',

          required:
            false,

          min:
            0,

          max:
            1000,
        },
      );

    assertMinMax(
      result.minRiskScore,
      result.maxRiskScore,
      'risk score',
    );
  }

  if (
    input.minCreditScore !==
      undefined ||
    input.maxCreditScore !==
      undefined
  ) {
    result.minCreditScore =
      validateNumber(
        input.minCreditScore,
        {
          field:
            'minCreditScore',

          required:
            false,

          min:
            0,

          max:
            1000,
        },
      );

    result.maxCreditScore =
      validateNumber(
        input.maxCreditScore,
        {
          field:
            'maxCreditScore',

          required:
            false,

          min:
            0,

          max:
            1000,
        },
      );

    assertMinMax(
      result.minCreditScore,
      result.maxCreditScore,
      'credit score',
    );
  }

  if (
    input.minDaysPastDue !==
      undefined ||
    input.maxDaysPastDue !==
      undefined
  ) {
    result.minDaysPastDue =
      validateInteger(
        input.minDaysPastDue,
        {
          field:
            'minDaysPastDue',

          required:
            false,

          min:
            0,

          max:
            100000,
        },
      );

    result.maxDaysPastDue =
      validateInteger(
        input.maxDaysPastDue,
        {
          field:
            'maxDaysPastDue',

          required:
            false,

          min:
            0,

          max:
            100000,
        },
      );

    assertMinMax(
      result.minDaysPastDue,
      result.maxDaysPastDue,
      'days past due',
    );
  }

  Object.assign(
    result,
    validateNamedDateRanges(
      input,
      [
        [
          'createdFrom',
          'createdTo',
        ],
        [
          'approvedFrom',
          'approvedTo',
        ],
        [
          'disbursedFrom',
          'disbursedTo',
        ],
        [
          'maturityFrom',
          'maturityTo',
        ],
      ],
    ),
  );

  for (
    const field of [
      'activeOnly',
      'overdueOnly',
      'highRiskOnly',
      'defaultedOnly',
    ]
  ) {
    if (
      input[field] !==
      undefined
    ) {
      result[field] =
        validateBoolean(
          input[field],
          field,
        );
    }
  }

  Object.assign(
    result,
    validatePagination(
      input,
    ),
  );

  return result;
}

/**
 * ============================================================================
 * ADMIN GROUP SEARCH
 * ============================================================================
 */

function validateAdminGroupSearch(
  input = {},
) {
  assertAllowedKeys(
    input,
    {
      field:
        'adminGroupSearch',

      allowedKeys: [
        'tenantId',
        'groupId',
        'memberId',
        'createdBy',
        'administrator',
        'search',
        'status',
        'statuses',
        'type',
        'groupType',
        'types',
        'createdFrom',
        'createdTo',
        'updatedFrom',
        'updatedTo',
        'page',
        'limit',
        'cursor',
        'sortBy',
        'sortDirection',
      ],
    },
  );

  const result =
    {};

  if (
    input.tenantId !==
    undefined
  ) {
    result.tenantId =
      validateTenantId(
        input.tenantId,
      );
  }

  for (
    const field of [
      'groupId',
      'memberId',
      'createdBy',
      'administrator',
    ]
  ) {
    if (
      input[field] !==
      undefined
    ) {
      result[field] =
        validateObjectId(
          input[field],
          field,
        );
    }
  }

  if (
    input.search !==
    undefined
  ) {
    result.search =
      validateSearch(
        input.search,
      );
  }

  if (
    input.statuses !==
      undefined ||
    input.status !==
      undefined
  ) {
    result.statuses =
      validateStringArray(
        input.statuses ||
          input.status,
        {
          field:
            'statuses',

          maxLength:
            20,
        },
      );
  }

  if (
    input.types !==
      undefined ||
    input.type !==
      undefined ||
    input.groupType !==
      undefined
  ) {
    result.types =
      validateStringArray(
        input.types ||
          input.type ||
          input.groupType,
        {
          field:
            'types',

          maxLength:
            20,
        },
      );
  }

  Object.assign(
    result,
    validateNamedDateRanges(
      input,
      [
        [
          'createdFrom',
          'createdTo',
        ],
        [
          'updatedFrom',
          'updatedTo',
        ],
      ],
    ),
  );

  Object.assign(
    result,
    validatePagination(
      input,
    ),
  );

  return result;
}

/**
 * ============================================================================
 * ADMIN AUDIT SEARCH
 * ============================================================================
 */

function validateAdminAuditSearch(
  input = {},
) {
  assertAllowedKeys(
    input,
    {
      field:
        'adminAuditSearch',

      allowedKeys: [
        'tenantId',
        'auditId',
        'userId',
        'entityId',
        'action',
        'actions',
        'entityType',
        'entityTypes',
        'from',
        'to',
        'minCreatedAt',
        'maxCreatedAt',
        'page',
        'limit',
        'cursor',
        'sortBy',
        'sortDirection',
      ],
    },
  );

  const result =
    {};

  if (
    input.tenantId !==
    undefined
  ) {
    result.tenantId =
      validateTenantId(
        input.tenantId,
      );
  }

  for (
    const field of [
      'auditId',
      'userId',
      'entityId',
    ]
  ) {
    if (
      input[field] !==
      undefined
    ) {
      result[field] =
        validateObjectId(
          input[field],
          field,
        );
    }
  }

  if (
    input.action !==
      undefined ||
    input.actions !==
      undefined
  ) {
    result.actions =
      validateStringArray(
        input.actions ||
          input.action,
        {
          field:
            'actions',

          maxLength:
            100,
        },
      );
  }

  if (
    input.entityType !==
      undefined ||
    input.entityTypes !==
      undefined
  ) {
    result.entityTypes =
      validateEnumArray(
        input.entityTypes ||
          input.entityType,
        {
          field:
            'entityTypes',

          allowed:
            ENUMS.AUDIT_ENTITY_TYPES,

          maxLength:
            50,
        },
      );
  }

  const range =
    validateDateRange(
      {
        from:
          input.from ||
          input.minCreatedAt,

        to:
          input.to ||
          input.maxCreatedAt,
      },
      {
        fromField:
          'from',

        toField:
          'to',
      },
    );

  result.from =
    range.from;

  result.to =
    range.to;

  Object.assign(
    result,
    validatePagination(
      input,
    ),
  );

  return result;
}

/**
 * ============================================================================
 * ADMIN DASHBOARD QUERY
 * ============================================================================
 */

function validateDashboardQuery(
  input = {},
) {
  assertAllowedKeys(
    input,
    {
      field:
        'dashboardQuery',

      allowedKeys: [
        'tenantId',
        'from',
        'to',
        'days',
        'granularity',
        'limit',
      ],
    },
  );

  const result =
    {};

  if (
    input.tenantId !==
    undefined
  ) {
    result.tenantId =
      validateTenantId(
        input.tenantId,
      );
  }

  const range =
    validateDateRange(
      {
        from:
          input.from,

        to:
          input.to,

        days:
          input.days,
      },
      {
        fromField:
          'from',

        toField:
          'to',

        maxDays:
          LIMITS.MAX_DATE_RANGE_DAYS,
      },
    );

  result.from =
    range.from;

  result.to =
    range.to;

  if (
    input.days !==
    undefined &&
    input.days !==
    null
  ) {
    result.days =
      validateInteger(
        input.days,
        {
          field:
            'days',

          min:
            1,

          max:
            LIMITS.MAX_DATE_RANGE_DAYS,
        },
      );
  }

  if (
    input.granularity !==
    undefined
  ) {
    result.granularity =
      validateEnum(
        input.granularity,
        {
          field:
            'granularity',

          allowed:
            ENUMS.GRANULARITIES,
        },
      );
  }

  if (
    input.limit !==
    undefined
  ) {
    result.limit =
      validateInteger(
        input.limit,
        {
          field:
            'limit',

          min:
            1,

          max:
            LIMITS.MAX_PAGE_SIZE,
        },
      );
  }

  return result;
}

/**
 * ============================================================================
 * ADMIN REPORT QUERY
 * ============================================================================
 */

function validateReportQuery(
  input = {},
) {
  assertAllowedKeys(
    input,
    {
      field:
        'reportQuery',

      allowedKeys: [
        'tenantId',
        'reportType',
        'format',
        'from',
        'to',
        'days',
        'limit',
        'includeDetails',
        'currency',
      ],
    },
  );

  const result =
    {};

  if (
    input.tenantId !==
    undefined
  ) {
    result.tenantId =
      validateTenantId(
        input.tenantId,
      );
  }

  if (
    input.reportType !==
    undefined
  ) {
    result.reportType =
      normalizeString(
        input.reportType,
        {
          field:
            'reportType',

          required:
            true,

          maxLength:
            100,
        },
      );
  }

  if (
    input.format !==
    undefined
  ) {
    result.format =
      validateEnum(
        input.format,
        {
          field:
            'format',

          allowed: [
            'json',
            'csv',
            'xlsx',
            'pdf',
          ],

          caseInsensitive:
            true,
        },
      ).toLowerCase();
  }

  const range =
    validateDateRange(
      {
        from:
          input.from,

        to:
          input.to,

        days:
          input.days,
      },
      {
        maxDays:
          LIMITS.MAX_DATE_RANGE_DAYS,
      },
    );

  result.from =
    range.from;

  result.to =
    range.to;

  if (
    input.days !==
      undefined &&
    input.days !==
      null
  ) {
    result.days =
      validateInteger(
        input.days,
        {
          field:
            'days',

          min:
            1,

          max:
            LIMITS.MAX_DATE_RANGE_DAYS,
        },
      );
  }

  if (
    input.limit !==
    undefined
  ) {
    result.limit =
      validateInteger(
        input.limit,
        {
          field:
            'limit',

          min:
            1,

          max:
            LIMITS.MAX_EXPORT_LIMIT,
        },
      );
  }

  if (
    input.includeDetails !==
    undefined
  ) {
    result.includeDetails =
      validateBoolean(
        input.includeDetails,
        'includeDetails',
      );
  }

  if (
    input.currency !==
    undefined
  ) {
    result.currency =
      validateEnum(
        input.currency,
        {
          field:
            'currency',

          allowed:
            ENUMS.CURRENCIES,

          caseInsensitive:
            true,
        },
      );
  }

  return result;
}

/**
 * ============================================================================
 * ADMIN IDENTITY INPUT
 * ============================================================================
 */

function validateAdminIdentity(
  input = {},
) {
  assertAllowedKeys(
    input,
    {
      field:
        'adminIdentity',

      allowedKeys: [
        'userId',
        'tenantId',
        'email',
        'phone',
        'role',
        'roles',
      ],
    },
  );

  const result =
    {};

  if (
    input.userId !==
    undefined
  ) {
    result.userId =
      validateObjectId(
        input.userId,
        'userId',
      );
  }

  if (
    input.tenantId !==
    undefined
  ) {
    result.tenantId =
      validateTenantId(
        input.tenantId,
      );
  }

  if (
    input.email !==
    undefined
  ) {
    result.email =
      validateEmail(
        input.email,
      );
  }

  if (
    input.phone !==
    undefined
  ) {
    result.phone =
      validatePhone(
        input.phone,
      );
  }

  if (
    input.roles !==
      undefined ||
    input.role !==
      undefined
  ) {
    result.roles =
      validateEnumArray(
        input.roles ||
          input.role,
        {
          field:
            'roles',

          allowed:
            ENUMS.USER_ROLES,
        },
      );
  }

  return result;
}

/**
 * ============================================================================
 * ADMIN TENANT CONTEXT
 * ============================================================================
 *
 * This validates the representation of tenant context only.
 * Authorization that the authenticated administrator may access the tenant
 * belongs to auth/RBAC middleware and adminContext.
 * ============================================================================
 */

function validateAdminTenantContext(
  input = {},
) {
  assertAllowedKeys(
    input,
    {
      field:
        'tenantContext',

      allowedKeys: [
        'tenantId',
      ],
    },
  );

  return {
    tenantId:
      validateTenantId(
        input.tenantId,
      ),
  };
}

/**
 * ============================================================================
 * GENERIC NAMED DATE RANGES
 * ============================================================================
 */

function validateNamedDateRanges(
  input,
  pairs,
) {
  const result =
    {};

  for (
    const [
      fromField,
      toField,
    ] of pairs
  ) {
    const range =
      validateDateRange(
        {
          from:
            input[fromField],

          to:
            input[toField],
        },
        {
          fromField,

          toField,
        },
      );

    result[fromField] =
      range.from;

    result[toField] =
      range.to;
  }

  return result;
}

/**
 * ============================================================================
 * MIN/MAX
 * ============================================================================
 */

function assertMinMax(
  min,
  max,
  label,
) {
  if (
    min !==
      null &&
    min !==
      undefined &&
    max !==
      null &&
    max !==
      undefined &&
    min >
      max
  ) {
    throw new AdminValidationError(
      `Minimum ${label} cannot be greater than maximum ${label}.`,
      {
        code:
          'INVALID_RANGE',
      },
    );
  }

  return true;
}

/**
 * ============================================================================
 * MUTATION PAYLOAD SANITIZATION
 * ============================================================================
 */

function sanitizeStringFields(
  input,
  {
    lowercaseFields =
      [],

    uppercaseFields =
      [],

    maxLength =
      LIMITS.MAX_STRING_LENGTH,
  } = {},
) {
  if (
    !input ||
    typeof input !==
      'object' ||
    Array.isArray(input)
  ) {
    throw new AdminValidationError(
      'Payload must be an object.',
      {
        code:
          'INVALID_OBJECT',
      },
    );
  }

  const output =
    {};

  for (
    const [
      key,
      value,
    ] of Object.entries(
      input,
    )
  ) {
    if (
      typeof value ===
      'string'
    ) {
      let normalized =
        value.trim();

      if (
        lowercaseFields.includes(
          key,
        )
      ) {
        normalized =
          normalized.toLowerCase();
      }

      if (
        uppercaseFields.includes(
          key,
        )
      ) {
        normalized =
          normalized.toUpperCase();
      }

      if (
        normalized.length >
        maxLength
      ) {
        throw new AdminValidationError(
          `${key} exceeds the maximum allowed length.`,
          {
            code:
              'STRING_TOO_LONG',

            field:
              key,
          },
        );
      }

      output[key] =
        normalized;
    } else {
      output[key] =
        value;
    }
  }

  return output;
}

/**
 * ============================================================================
 * ADMIN USER MUTATION
 * ============================================================================
 */

function validateAdminUserMutation(
  input = {},
  {
    partial =
      true,
  } = {},
) {
  assertNoSensitiveFields(
    input,
  );

  assertAllowedKeys(
    input,
    {
      field:
        'adminUserMutation',

      allowedKeys: [
        'name',
        'email',
        'phone',
        'role',
        'status',
        'isActive',
        'isVerified',
      ],
    },
  );

  const result =
    {};

  if (
    input.name !==
      undefined ||
    !partial
  ) {
    result.name =
      normalizeString(
        input.name,
        {
          field:
            'name',

          required:
            !partial,

          minLength:
            2,

          maxLength:
            LIMITS.MAX_NAME_LENGTH,
        },
      );
  }

  if (
    input.email !==
      undefined ||
    !partial
  ) {
    result.email =
      validateEmail(
        input.email,
        {
          required:
            !partial,
        },
      );
  }

  if (
    input.phone !==
      undefined
  ) {
    result.phone =
      validatePhone(
        input.phone,
        {
          required:
            false,
        },
      );
  }

  if (
    input.role !==
      undefined
  ) {
    result.role =
      validateEnum(
        input.role,
        {
          field:
            'role',

          allowed:
            ENUMS.USER_ROLES,
        },
      );
  }

  if (
    input.status !==
      undefined
  ) {
    result.status =
      validateEnum(
        input.status,
        {
          field:
            'status',

          allowed:
            ENUMS.USER_STATUSES,
        },
      );
  }

  if (
    input.isActive !==
      undefined
  ) {
    result.isActive =
      validateBoolean(
        input.isActive,
        'isActive',
      );
  }

  if (
    input.isVerified !==
      undefined
  ) {
    result.isVerified =
      validateBoolean(
        input.isVerified,
        'isVerified',
      );
  }

  return result;
}

/**
 * ============================================================================
 * ADMIN LOAN MUTATION
 * ============================================================================
 */

function validateAdminLoanMutation(
  input = {},
  {
    partial =
      true,
  } = {},
) {
  /**
   * Direct financial mutation must never permit arbitrary status/balance fields
   * through a generic validation utility.
   *
   * Loan transitions belong in the loan service and authorization layer.
   */
  assertNoSensitiveFields(
    input,
  );

  assertAllowedKeys(
    input,
    {
      field:
        'adminLoanMutation',

      allowedKeys: [
        'purpose',
        'interestRate',
        'term',
        'repaymentFrequency',
        'currency',
        'collectionStage',
        'notes',
      ],
    },
  );

  const result =
    {};

  if (
    input.purpose !==
      undefined ||
    !partial
  ) {
    result.purpose =
      normalizeString(
        input.purpose,
        {
          field:
            'purpose',

          required:
            !partial,

          minLength:
            2,

          maxLength:
            255,
        },
      );
  }

  if (
    input.interestRate !==
      undefined
  ) {
    result.interestRate =
      validateNumber(
        input.interestRate,
        {
          field:
            'interestRate',

          required:
            false,

          min:
            0,

          max:
            1000,

          decimals:
            4,
        },
      );
  }

  if (
    input.term !==
      undefined
  ) {
    result.term =
      validateInteger(
        input.term,
        {
          field:
            'term',

          min:
            1,

          max:
            1200,
        },
      );
  }

  if (
    input.repaymentFrequency !==
      undefined
  ) {
    result.repaymentFrequency =
      normalizeString(
        input.repaymentFrequency,
        {
          field:
            'repaymentFrequency',

          maxLength:
            50,
        },
      );
  }

  if (
    input.currency !==
    undefined
  ) {
    result.currency =
      validateEnum(
        input.currency,
        {
          field:
            'currency',

          allowed:
            ENUMS.CURRENCIES,
        },
      );
  }

  if (
    input.collectionStage !==
      undefined
  ) {
    result.collectionStage =
      normalizeString(
        input.collectionStage,
        {
          field:
            'collectionStage',

          maxLength:
            100,
        },
      );
  }

  if (
    input.notes !==
      undefined
  ) {
    result.notes =
      normalizeString(
        input.notes,
        {
          field:
            'notes',

          maxLength:
            LIMITS.MAX_STRING_LENGTH,
        },
      );
  }

  return result;
}

/**
 * ============================================================================
 * ADMIN REPORT EXPORT
 * ============================================================================
 */

function validateExportOptions(
  input = {},
) {
  assertAllowedKeys(
    input,
    {
      field:
        'exportOptions',

      allowedKeys: [
        'format',
        'fileName',
        'limit',
        'includeDetails',
      ],
    },
  );

  const result =
    {};

  result.format =
    validateEnum(
      input.format ||
        'csv',
      {
        field:
          'format',

        allowed: [
          'csv',
          'xlsx',
          'pdf',
          'json',
        ],
      },
    );

  if (
    input.fileName !==
    undefined
  ) {
    const fileName =
      normalizeString(
        input.fileName,
        {
          field:
            'fileName',

          maxLength:
            180,
        },
      );

    /**
     * Prevent path traversal through export filenames.
     */
    if (
      /[/\\]|\.\./.test(
        fileName,
      )
    ) {
      throw new AdminValidationError(
        'fileName contains unsafe path characters.',
        {
          code:
            'UNSAFE_FILENAME',

          field:
            'fileName',
        },
      );
    }

    result.fileName =
      fileName;
  }

  result.limit =
    validateInteger(
      input.limit,
      {
        field:
          'limit',

        min:
          1,

        max:
          LIMITS.MAX_EXPORT_LIMIT,

        defaultValue:
          1000,
      },
    );

  result.includeDetails =
    input.includeDetails !==
      undefined
      ? validateBoolean(
          input.includeDetails,
          'includeDetails',
        )
      : false;

  return result;
}

/**
 * ============================================================================
 * BULK IDS
 * ============================================================================
 */

function validateBulkObjectIds(
  value,
  {
    field =
      'ids',

    maxLength =
      LIMITS.MAX_ARRAY_LENGTH,
  } = {},
) {
  const values =
    Array.isArray(value)
      ? value
      : String(
          value ||
            '',
        ).split(',');

  if (
    values.length >
    maxLength
  ) {
    throw new AdminValidationError(
      `${field} contains too many IDs.`,
      {
        code:
          'TOO_MANY_IDS',

        field,
      },
    );
  }

  const ids =
    values
      .filter(
        (item) =>
          item !==
            undefined &&
          item !==
            null &&
          String(
            item,
          ).trim() !==
            '',
      )
      .map(
        (item, index) =>
          validateObjectId(
            item,
            `${field}[${index}]`,
          ),
      );

  return [
    ...new Set(
      ids,
    ),
  ];
}

/**
 * ============================================================================
 * PASSWORD POLICY VALIDATION
 * ============================================================================
 *
 * This utility does not hash passwords. It only validates a password against
 * an administrative minimum policy when a password-changing flow explicitly
 * calls it.
 * ============================================================================
 */

function validatePassword(
  value,
  {
    field =
      'password',

    required =
      true,

    minLength =
      12,

    maxLength =
      128,

    requireUppercase =
      true,

    requireLowercase =
      true,

    requireNumber =
      true,

    requireSpecial =
      true,
  } = {},
) {
  const password =
    normalizeString(
      value,
      {
        field,

        required,

        trim:
          false,

        maxLength,
      },
    );

  if (
    password ===
    null
  ) {
    return null;
  }

  if (
    password.length <
    minLength
  ) {
    throw new AdminValidationError(
      `${field} must contain at least ${minLength} characters.`,
      {
        code:
          'PASSWORD_TOO_SHORT',

        field,
      },
    );
  }

  if (
    requireUppercase &&
    !/[A-Z]/.test(
      password,
    )
  ) {
    throw new AdminValidationError(
      `${field} must contain at least one uppercase letter.`,
      {
        code:
          'PASSWORD_UPPERCASE_REQUIRED',

        field,
      },
    );
  }

  if (
    requireLowercase &&
    !/[a-z]/.test(
      password,
    )
  ) {
    throw new AdminValidationError(
      `${field} must contain at least one lowercase letter.`,
      {
        code:
          'PASSWORD_LOWERCASE_REQUIRED',

        field,
      },
    );
  }

  if (
    requireNumber &&
    !/\d/.test(
      password,
    )
  ) {
    throw new AdminValidationError(
      `${field} must contain at least one number.`,
      {
        code:
          'PASSWORD_NUMBER_REQUIRED',

        field,
      },
    );
  }

  if (
    requireSpecial &&
    !/[^\w\s]/.test(
      password,
    )
  ) {
    throw new AdminValidationError(
      `${field} must contain at least one special character.`,
      {
        code:
          'PASSWORD_SPECIAL_REQUIRED',

        field,
      },
    );
  }

  return password;
}

/**
 * ============================================================================
 * PASSWORD CHANGE PAYLOAD
 * ============================================================================
 */

function validatePasswordChange(
  input = {},
) {
  assertAllowedKeys(
    input,
    {
      field:
        'passwordChange',

      allowedKeys: [
        'currentPassword',
        'newPassword',
        'confirmPassword',
      ],
    },
  );

  assertRequired(
    input.currentPassword,
    'currentPassword',
  );

  const newPassword =
    validatePassword(
      input.newPassword,
      {
        field:
          'newPassword',
      },
    );

  if (
    input.confirmPassword !==
    newPassword
  ) {
    throw new AdminValidationError(
      'confirmPassword does not match newPassword.',
      {
        code:
          'PASSWORD_CONFIRMATION_MISMATCH',

        field:
          'confirmPassword',
      },
    );
  }

  return {
    currentPassword:
      String(
        input.currentPassword,
      ),

    newPassword,
  };
}

/**
 * ============================================================================
 * REQUIRED VALUE
 * ============================================================================
 */

function assertRequired(
  value,
  field,
) {
  if (
    value ===
      undefined ||
    value ===
      null ||
    (
      typeof value ===
        'string' &&
      value.trim() ===
        ''
    )
  ) {
    throw new AdminValidationError(
      `${field} is required.`,
      {
        code:
          'REQUIRED_FIELD',

        field,
      },
    );
  }

  return true;
}

/**
 * ============================================================================
 * VALIDATION EXECUTION
 * ============================================================================
 */

function validate(
  validator,
  input,
) {
  if (
    typeof validator !==
    'function'
  ) {
    throw new AdminValidationError(
      'A validation function is required.',
      {
        code:
          'VALIDATOR_REQUIRED',
      },
    );
  }

  try {
    const value =
      validator(
        input,
      );

    return success(
      value,
    );
  } catch (
    error
  ) {
    if (
      error instanceof
      AdminValidationError
    ) {
      return failure(
        [
          ...(
            error.errors.length
              ? error.errors
              : [
                  createIssue(
                    error.field,
                    error.code,
                    error.message,
                  ),
                ]
          ),
        ],
      );
    }

    return failure(
      [
        createIssue(
          null,
          'VALIDATION_FAILED',
          error?.message ||
            'Validation failed.',
        ),
      ],
    );
  }
}

/**
 * ============================================================================
 * ASSERT VALID
 * ============================================================================
 */

function assertValid(
  validator,
  input,
) {
  const result =
    validate(
      validator,
      input,
    );

  if (
    !result.valid
  ) {
    throw new AdminValidationError(
      'Administrative request validation failed.',
      {
        code:
          'VALIDATION_FAILED',

        statusCode:
          400,

        errors:
          result.errors,
      },
    );
  }

  return result.value;
}

/**
 * ============================================================================
 * EXPRESS MIDDLEWARE
 * ============================================================================
 */

function middleware(
  validator,
  {
    source =
      'body',

    target =
      'validated',

    overwrite =
      false,
  } = {},
) {
  if (
    typeof validator !==
    'function'
  ) {
    throw new AdminValidationError(
      'Validation middleware requires a validator function.',
      {
        code:
          'VALIDATOR_REQUIRED',
      },
    );
  }

  if (
    ![
      'body',
      'query',
      'params',
      'headers',
    ].includes(
      source,
    )
  ) {
    throw new AdminValidationError(
      'Unsupported validation source.',
      {
        code:
          'INVALID_VALIDATION_SOURCE',
      },
    );
  }

  return function adminValidationMiddleware(
    req,
    res,
    next,
  ) {
    try {
      const sourceValue =
        req[source] ||
        {};

      const validated =
        assertValid(
          validator,
          sourceValue,
        );

      if (
        overwrite
      ) {
        req[source] =
          validated;
      }

      req[target] =
        validated;

      next();
    } catch (error) {
      next(
        error,
      );
    }
  };
}

/**
 * ============================================================================
 * ERROR SERIALIZATION
 * ============================================================================
 */

function serializeError(
  error,
) {
  if (
    error instanceof
    AdminValidationError
  ) {
    return {
      name:
        error.name,

      code:
        error.code,

      message:
        error.message,

      statusCode:
        error.statusCode,

      field:
        error.field,

      errors:
        error.errors,
    };
  }

  return {
    name:
      error?.name ||
      'Error',

    code:
      error?.code ||
      'VALIDATION_FAILED',

    message:
      error?.message ||
      'Validation failed.',

    statusCode:
      400,

    errors: [],
  };
}

/**
 * ============================================================================
 * SAFE VALIDATION SUMMARY
 * ============================================================================
 */

function getCapabilities() {
  return {
    utility:
      UTILITY_NAME,

    version:
      UTILITY_VERSION,

    application:
      APP_NAME,

    capabilities: {
      objectId:
        true,

      tenantId:
        true,

      uuid:
        true,

      email:
        true,

      phone:
        true,

      url:
        true,

      dates:
        true,

      dateRanges:
        true,

      pagination:
        true,

      cursor:
        true,

      sorting:
        true,

      search:
        true,

      amounts:
        true,

      enums:
        true,

      passwordPolicy:
        true,

      sensitiveFieldProtection:
        true,

      expressMiddleware:
        true,

      structuredErrors:
        true,
    },

    timestamp:
      new Date(),
  };
}

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 */

const AdminValidation =
  Object.freeze({
    name:
      UTILITY_NAME,

    version:
      UTILITY_VERSION,

    limits:
      LIMITS,

    enums:
      ENUMS,

    regex:
      REGEX,

    /**
     * Generic primitives
     */
    normalizeString,

    normalizeOptionalString,

    validateBoolean,

    validateInteger,

    validateNumber,

    validateAmount,

    validateObjectId,

    toObjectId,

    validateTenantId,

    validateUUID,

    validateEmail,

    validatePhone,

    validateUrl,

    validateEnum,

    validateEnumArray,

    validateStringArray,

    validateDate,

    validateDateRange,

    validatePagination,

    validateCursor,

    validateSort,

    validateSearch,

    escapeRegex,

    validateFieldName,

    assertAllowedKeys,

    assertNoSensitiveFields,

    validateBulkObjectIds,

    validatePassword,

    validatePasswordChange,

    assertRequired,

    assertMinMax,

    /**
     * Admin resource validators
     */
    validateAdminUserSearch,

    validateAdminLoanSearch,

    validateAdminGroupSearch,

    validateAdminAuditSearch,

    validateDashboardQuery,

    validateReportQuery,

    validateAdminIdentity,

    validateAdminTenantContext,

    validateAdminUserMutation,

    validateAdminLoanMutation,

    validateExportOptions,

    /**
     * Execution
     */
    validate,

    assertValid,

    middleware,

    /**
     * Diagnostics
     */
    serializeError,

    getCapabilities,
  });

module.exports =
  AdminValidation;

module.exports.AdminValidation =
  AdminValidation;

module.exports.AdminValidationError =
  AdminValidationError;

/**
 * Explicit named exports for backward/forward compatibility.
 */

Object.assign(
  module.exports,
  AdminValidation,
);