'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Admin Pagination Utility
 * ============================================================================
 *
 * File:
 *   backend/utils/admin/adminPagination.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Canonical pagination, cursor, ordering and pagination-response utility for
 * TITech Community Capital administrative APIs.
 *
 * Supported strategies
 * ----------------------------------------------------------------------------
 * 1. Offset pagination
 *      page + limit
 *
 * 2. Cursor / keyset pagination
 *      opaque cursor + limit
 *
 * 3. Hybrid pagination
 *      supports legacy page-based endpoints while standardizing the response
 *      contract for newer cursor-based APIs.
 *
 * Enterprise responsibilities
 * ----------------------------------------------------------------------------
 * ✓ Parse and normalize page/limit
 * ✓ Enforce safe pagination limits
 * ✓ Prevent negative/NaN/Infinity values
 * ✓ Validate cursors
 * ✓ Create opaque cursors
 * ✓ Decode opaque cursors
 * ✓ Validate cursor age/version
 * ✓ Preserve sort direction
 * ✓ Create deterministic keyset clauses
 * ✓ Build MongoDB pagination metadata
 * ✓ Build standardized API pagination responses
 * ✓ Support Mongoose documents and plain objects
 * ✓ Support repository result shapes
 * ✓ Prevent accidental unbounded queries
 * ✓ Provide stable tie-breaker support
 * ✓ Provide Express-compatible query normalization
 *
 * Architecture
 * ----------------------------------------------------------------------------
 * This utility DOES NOT:
 *
 * ✗ perform database queries
 * ✗ authorize users
 * ✗ enforce RBAC
 * ✗ determine tenant access
 * ✗ decide which records a user may see
 * ✗ mutate financial data
 * ✗ calculate business metrics
 *
 * Tenant isolation remains the responsibility of:
 *
 *   adminContext
 *   authentication / RBAC
 *   services
 *   repositories
 *
 * The repository must still scope every query by tenantId. TITech's production
 * blueprint requires tenant enforcement on every query and full data
 * isolation. Pagination cannot be used to bypass that boundary.
 *
 * TITech terminology
 * ----------------------------------------------------------------------------
 * All ACFOS terminology has been replaced with TITech Community Capital.
 *
 * ============================================================================
 */

const crypto = require('node:crypto');

/**
 * ============================================================================
 * METADATA
 * ============================================================================
 */

const UTILITY_NAME =
  'AdminPagination';

const UTILITY_VERSION =
  '2026.1';

const APPLICATION_NAME =
  'TITech Community Capital LTD';

/**
 * ============================================================================
 * DEFAULTS / LIMITS
 * ============================================================================
 */

const DEFAULTS = Object.freeze({
  PAGE:
    1,

  LIMIT:
    25,

  MAX_LIMIT:
    100,

  MAX_EXPORT_LIMIT:
    10_000,

  MAX_PAGE:
    Number.MAX_SAFE_INTEGER,

  DEFAULT_SORT_FIELD:
    'createdAt',

  DEFAULT_SORT_DIRECTION:
    'desc',

  MAX_CURSOR_LENGTH:
    4096,

  CURSOR_VERSION:
    1,

  DEFAULT_CURSOR_TTL_DAYS:
    30,

  MAX_CURSOR_TTL_DAYS:
    365,

  MAX_OFFSET:
    Number.MAX_SAFE_INTEGER,
});

/**
 * ============================================================================
 * VALID SORT DIRECTIONS
 * ============================================================================
 */

const SORT_DIRECTIONS =
  Object.freeze([
    'asc',
    'desc',
  ]);

/**
 * ============================================================================
 * ERROR
 * ============================================================================
 */

class AdminPaginationError extends Error {
  constructor(
    message,
    {
      code =
        'ADMIN_PAGINATION_ERROR',

      statusCode =
        400,

      details =
        null,

      cause =
        null,
    } = {},
  ) {
    super(message);

    this.name =
      'AdminPaginationError';

    this.code =
      code;

    this.statusCode =
      statusCode;

    this.details =
      details;

    this.cause =
      cause;

    this.isPaginationError =
      true;
  }
}

/**
 * ============================================================================
 * NORMALIZATION HELPERS
 * ============================================================================
 */

function normalizeString(
  value,
  fallback = null,
) {
  if (
    value ===
      undefined ||
    value ===
      null
  ) {
    return fallback;
  }

  const normalized =
    String(
      value,
    ).trim();

  return normalized ||
    fallback;
}

function normalizeInteger(
  value,
  {
    field =
      'value',

    defaultValue =
      null,

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
    return defaultValue;
  }

  const parsed =
    typeof value ===
    'number'
      ? value
      : Number(
          String(
            value,
          ).trim(),
        );

  if (
    !Number.isInteger(
      parsed,
    ) ||
    !Number.isSafeInteger(
      parsed,
    )
  ) {
    throw new AdminPaginationError(
      `${field} must be a safe integer.`,
      {
        code:
          'INVALID_PAGINATION_INTEGER',

        details: {
          field,
        },
      },
    );
  }

  if (
    min !==
      null &&
    parsed <
      min
  ) {
    throw new AdminPaginationError(
      `${field} must be at least ${min}.`,
      {
        code:
          'PAGINATION_VALUE_TOO_SMALL',

        details: {
          field,
          min,
        },
      },
    );
  }

  if (
    max !==
      null &&
    parsed >
      max
  ) {
    throw new AdminPaginationError(
      `${field} must not exceed ${max}.`,
      {
        code:
          'PAGINATION_VALUE_TOO_LARGE',

        details: {
          field,
          max,
        },
      },
    );
  }

  return parsed;
}

function normalizeDirection(
  value,
  fallback =
    DEFAULTS.DEFAULT_SORT_DIRECTION,
) {
  const normalized =
    normalizeString(
      value,
      fallback,
    )?.toLowerCase();

  if (
    !SORT_DIRECTIONS.includes(
      normalized,
    )
  ) {
    throw new AdminPaginationError(
      `Invalid sort direction: ${value}.`,
      {
        code:
          'INVALID_SORT_DIRECTION',

        details: {
          allowed:
            SORT_DIRECTIONS,
        },
      },
    );
  }

  return normalized;
}

function normalizeSortField(
  value,
  {
    fallback =
      DEFAULTS.DEFAULT_SORT_FIELD,

    allowedFields =
      [],

    field =
      'sortBy',
  } = {},
) {
  const sortField =
    normalizeString(
      value,
      fallback,
    );

  if (!sortField) {
    throw new AdminPaginationError(
      `${field} is required.`,
      {
        code:
          'SORT_FIELD_REQUIRED',
      },
    );
  }

  /**
   * MongoDB field-name safety:
   *
   * - no "$" operators
   * - no null/control characters
   * - no spaces
   * - no arbitrary expression syntax
   */
  if (
    !/^[A-Za-z][A-Za-z0-9_.]*$/.test(
      sortField,
    )
  ) {
    throw new AdminPaginationError(
      `${field} contains an unsafe field name.`,
      {
        code:
          'UNSAFE_SORT_FIELD',

        details: {
          field:
            sortField,
        },
      },
    );
  }

  if (
    allowedFields.length >
      0 &&
    !allowedFields.includes(
      sortField,
    )
  ) {
    throw new AdminPaginationError(
      `${field} is not permitted for this endpoint.`,
      {
        code:
          'SORT_FIELD_NOT_ALLOWED',

        details: {
          field:
            sortField,

          allowedFields,
        },
      },
    );
  }

  return sortField;
}

/**
 * ============================================================================
 * SORT SPECIFICATION
 * ============================================================================
 */

function normalizeSort(
  {
    sortBy =
      DEFAULTS.DEFAULT_SORT_FIELD,

    sortDirection =
      DEFAULTS.DEFAULT_SORT_DIRECTION,

    allowedFields =
      [],
  } = {},
) {
  const field =
    normalizeSortField(
      sortBy,
      {
        fallback:
          DEFAULTS.DEFAULT_SORT_FIELD,

        allowedFields,
      },
    );

  const direction =
    normalizeDirection(
      sortDirection,
      DEFAULTS.DEFAULT_SORT_DIRECTION,
    );

  return {
    field,

    direction,

    mongo: {
      [field]:
        direction ===
        'asc'
          ? 1
          : -1,
    },
  };
}

/**
 * ============================================================================
 * PAGINATION INPUT
 * ============================================================================
 */

function normalizePagination(
  input = {},
  {
    defaultLimit =
      DEFAULTS.LIMIT,

    maxLimit =
      DEFAULTS.MAX_LIMIT,

    maxPage =
      DEFAULTS.MAX_PAGE,

    maxOffset =
      DEFAULTS.MAX_OFFSET,

    defaultMode =
      'offset',

    allowedSortFields =
      [],

    requireCursor =
      false,
  } = {},
) {
  if (
    !input ||
    typeof input !==
      'object' ||
    Array.isArray(input)
  ) {
    throw new AdminPaginationError(
      'Pagination input must be an object.',
      {
        code:
          'INVALID_PAGINATION_INPUT',
      },
    );
  }

  const mode =
    normalizeMode(
      input.mode ||
        input.paginationMode ||
        defaultMode,
    );

  const page =
    normalizeInteger(
      input.page,
      {
        field:
          'page',

        defaultValue:
          DEFAULTS.PAGE,

        min:
          1,

        max:
          maxPage,
      },
    );

  const limit =
    normalizeInteger(
      input.limit,
      {
        field:
          'limit',

        defaultValue:
          defaultLimit,

        min:
          1,

        max:
          maxLimit,
      },
    );

  const cursor =
    input.cursor !==
      undefined &&
    input.cursor !==
      null &&
    String(
      input.cursor,
    ).trim() !==
      ''
      ? decodeCursor(
          input.cursor,
        )
      : null;

  if (
    requireCursor &&
    !cursor
  ) {
    throw new AdminPaginationError(
      'A pagination cursor is required.',
      {
        code:
          'CURSOR_REQUIRED',
      },
    );
  }

  const sort =
    normalizeSort({
      sortBy:
        input.sortBy,

      sortDirection:
        input.sortDirection ||
        input.order,

      allowedFields:
        allowedSortFields,
    });

  const offset =
    calculateOffset(
      page,
      limit,
      maxOffset,
    );

  return {
    mode,

    page,

    limit,

    offset,

    skip:
      offset,

    cursor,

    sort,

    hasCursor:
      Boolean(
        cursor,
      ),

    isFirstPage:
      page ===
        1 &&
      !cursor,

    requestedAt:
      new Date(),
  };
}

function normalizeMode(
  value,
) {
  const mode =
    normalizeString(
      value,
      'offset',
    )?.toLowerCase();

  if (
    ![
      'offset',
      'cursor',
      'hybrid',
    ].includes(
      mode,
    )
  ) {
    throw new AdminPaginationError(
      `Unsupported pagination mode: ${mode}.`,
      {
        code:
          'INVALID_PAGINATION_MODE',

        details: {
          allowed: [
            'offset',
            'cursor',
            'hybrid',
          ],
        },
      },
    );
  }

  return mode;
}

/**
 * ============================================================================
 * OFFSET
 * ============================================================================
 */

function calculateOffset(
  page,
  limit,
  maxOffset =
    DEFAULTS.MAX_OFFSET,
) {
  const normalizedPage =
    normalizeInteger(
      page,
      {
        field:
          'page',

        defaultValue:
          DEFAULTS.PAGE,

        min:
          1,

        max:
          DEFAULTS.MAX_PAGE,
      },
    );

  const normalizedLimit =
    normalizeInteger(
      limit,
      {
        field:
          'limit',

        defaultValue:
          DEFAULTS.LIMIT,

        min:
          1,

        max:
          DEFAULTS.MAX_LIMIT,
      },
    );

  const offset =
    (
      normalizedPage -
      1
    ) *
    normalizedLimit;

  if (
    offset >
    maxOffset
  ) {
    throw new AdminPaginationError(
      'Pagination offset exceeds the supported maximum.',
      {
        code:
          'PAGINATION_OFFSET_TOO_LARGE',

        details: {
          page:
            normalizedPage,

          limit:
            normalizedLimit,

          maxOffset,
        },
      },
    );
  }

  return offset;
}

/**
 * ============================================================================
 * CURSOR ENCODING
 * ============================================================================
 *
 * Cursor format:
 *
 * {
 *   v,
 *   iat,
 *   exp,
 *   sort,
 *   direction,
 *   values
 * }
 *
 * `values` contains the last record's keyset values.
 *
 * The utility does not dictate the repository's domain fields. For the common
 * admin repositories, values normally contain:
 *
 *   {
 *     createdAt,
 *     id
 *   }
 *
 * This creates a deterministic continuation point.
 * ============================================================================
 */

function encodeCursor(
  payload = {},
  {
    ttlDays =
      DEFAULTS.DEFAULT_CURSOR_TTL_DAYS,

    secret =
      null,
  } = {},
) {
  const normalizedTtlDays =
    normalizeInteger(
      ttlDays,
      {
        field:
          'ttlDays',

        defaultValue:
          DEFAULTS.DEFAULT_CURSOR_TTL_DAYS,

        min:
          1,

        max:
          DEFAULTS.MAX_CURSOR_TTL_DAYS,
      },
    );

  const issuedAt =
    Date.now();

  const expiresAt =
    issuedAt +
    (
      normalizedTtlDays *
      24 *
      60 *
      60 *
      1000
    );

  const body = {
    v:
      DEFAULTS.CURSOR_VERSION,

    iat:
      issuedAt,

    exp:
      expiresAt,

    sort:
      normalizeString(
        payload.sort ||
          DEFAULTS.DEFAULT_SORT_FIELD,
      ),

    direction:
      normalizeDirection(
        payload.direction ||
          DEFAULTS.DEFAULT_SORT_DIRECTION,
      ),

    values:
      sanitizeCursorValues(
        payload.values ||
          {},
      ),
  };

  const encodedBody =
    Buffer
      .from(
        JSON.stringify(
          body,
        ),
        'utf8',
      )
      .toString(
        'base64url',
      );

  /**
   * Optional HMAC signing.
   *
   * Recommended in production when cursors may contain sensitive identifiers
   * or must be tamper-resistant across trust boundaries.
   */
  if (
    secret
  ) {
    const signature =
      createCursorSignature(
        encodedBody,
        secret,
      );

    return `${encodedBody}.${signature}`;
  }

  return encodedBody;
}

/**
 * ============================================================================
 * CURSOR DECODING
 * ============================================================================
 */

function decodeCursor(
  cursor,
  {
    secret =
      null,

    now =
      Date.now(),

    allowExpired =
      false,

    expectedSort =
      null,

    expectedDirection =
      null,
  } = {},
) {
  const normalized =
    normalizeString(
      cursor,
    );

  if (!normalized) {
    throw new AdminPaginationError(
      'Pagination cursor is required.',
      {
        code:
          'CURSOR_REQUIRED',
      },
    );
  }

  if (
    normalized.length >
    DEFAULTS.MAX_CURSOR_LENGTH
  ) {
    throw new AdminPaginationError(
      'Pagination cursor exceeds the maximum supported length.',
      {
        code:
          'CURSOR_TOO_LONG',
      },
    );
  }

  const [
    encodedBody,
    signature,
    ...unexpectedParts
  ] =
    normalized.split(
      '.',
    );

  if (
    unexpectedParts.length >
    0
  ) {
    throw new AdminPaginationError(
      'Pagination cursor has an invalid format.',
      {
        code:
          'INVALID_CURSOR_FORMAT',
      },
    );
  }

  if (
    secret
  ) {
    if (
      !signature
    ) {
      throw new AdminPaginationError(
        'Signed pagination cursor is missing its signature.',
        {
          code:
            'CURSOR_SIGNATURE_REQUIRED',
        },
      );
    }

    const expectedSignature =
      createCursorSignature(
        encodedBody,
        secret,
      );

    if (
      !timingSafeEqual(
        signature,
        expectedSignature,
      )
    ) {
      throw new AdminPaginationError(
        'Pagination cursor signature is invalid.',
        {
          code:
            'INVALID_CURSOR_SIGNATURE',
        },
      );
    }
  } else if (
    signature
  ) {
    throw new AdminPaginationError(
      'Pagination cursor is signed but no cursor secret is configured.',
      {
        code:
          'CURSOR_SECRET_REQUIRED',
      },
    );
  }

  let payload;

  try {
    payload =
      JSON.parse(
        Buffer
          .from(
            encodedBody,
            'base64url',
          )
          .toString(
            'utf8',
          ),
      );
  } catch {
    throw new AdminPaginationError(
      'Pagination cursor cannot be decoded.',
      {
        code:
          'INVALID_CURSOR_PAYLOAD',
      },
    );
  }

  validateCursorPayload(
    payload,
    {
      now,

      allowExpired,

      expectedSort,

      expectedDirection,
    },
  );

  return payload;
}

/**
 * ============================================================================
 * CURSOR PAYLOAD VALIDATION
 * ============================================================================
 */

function validateCursorPayload(
  payload,
  {
    now =
      Date.now(),

    allowExpired =
      false,

    expectedSort =
      null,

    expectedDirection =
      null,
  } = {},
) {
  if (
    !payload ||
    typeof payload !==
      'object' ||
    Array.isArray(payload)
  ) {
    throw new AdminPaginationError(
      'Pagination cursor payload must be an object.',
      {
        code:
          'INVALID_CURSOR_PAYLOAD',
      },
    );
  }

  if (
    payload.v !==
    DEFAULTS.CURSOR_VERSION
  ) {
    throw new AdminPaginationError(
      'Pagination cursor version is unsupported.',
      {
        code:
          'UNSUPPORTED_CURSOR_VERSION',

        details: {
          received:
            payload.v,

          expected:
            DEFAULTS.CURSOR_VERSION,
        },
      },
    );
  }

  if (
    !Number.isSafeInteger(
      payload.iat,
    ) ||
    !Number.isSafeInteger(
      payload.exp,
    )
  ) {
    throw new AdminPaginationError(
      'Pagination cursor timestamps are invalid.',
      {
        code:
          'INVALID_CURSOR_TIMESTAMPS',
      },
    );
  }

  if (
    payload.exp <=
      payload.iat
  ) {
    throw new AdminPaginationError(
      'Pagination cursor expiry is invalid.',
      {
        code:
          'INVALID_CURSOR_EXPIRY',
      },
    );
  }

  if (
    !allowExpired &&
    payload.exp <=
      now
  ) {
    throw new AdminPaginationError(
      'Pagination cursor has expired.',
      {
        code:
          'CURSOR_EXPIRED',
      },
    );
  }

  if (
    expectedSort &&
    payload.sort !==
      expectedSort
  ) {
    throw new AdminPaginationError(
      'Pagination cursor sort field does not match the current query.',
      {
        code:
          'CURSOR_SORT_MISMATCH',

        details: {
          cursorSort:
            payload.sort,

          requestedSort:
            expectedSort,
        },
      },
    );
  }

  if (
    expectedDirection &&
    payload.direction !==
      expectedDirection
  ) {
    throw new AdminPaginationError(
      'Pagination cursor sort direction does not match the current query.',
      {
        code:
          'CURSOR_DIRECTION_MISMATCH',

        details: {
          cursorDirection:
            payload.direction,

          requestedDirection:
            expectedDirection,
        },
      },
    );
  }

  if (
    !payload.values ||
    typeof payload.values !==
      'object' ||
    Array.isArray(
      payload.values,
    )
  ) {
    throw new AdminPaginationError(
      'Pagination cursor values are invalid.',
      {
        code:
          'INVALID_CURSOR_VALUES',
      },
    );
  }

  return true;
}

/**
 * ============================================================================
 * CURSOR VALUE SANITIZATION
 * ============================================================================
 */

function sanitizeCursorValues(
  values,
) {
  if (
    !values ||
    typeof values !==
      'object' ||
    Array.isArray(values)
  ) {
    throw new AdminPaginationError(
      'Cursor values must be an object.',
      {
        code:
          'INVALID_CURSOR_VALUES',
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
      values,
    )
  ) {
    if (
      !/^[A-Za-z][A-Za-z0-9_.]*$/.test(
        key,
      )
    ) {
      throw new AdminPaginationError(
        `Cursor value key "${key}" is invalid.`,
        {
          code:
            'INVALID_CURSOR_VALUE_KEY',
        },
      );
    }

    if (
      value instanceof
      Date
    ) {
      output[key] =
        value.toISOString();

      continue;
    }

    if (
      value ===
        null ||
      typeof value ===
        'string' ||
      typeof value ===
        'number' ||
      typeof value ===
        'boolean'
    ) {
      output[key] =
        value;

      continue;
    }

    /**
     * Support MongoDB/Mongoose ObjectId-like values without importing Mongoose.
     */
    if (
      value &&
      typeof value.toString ===
        'function' &&
      value._bsontype ===
        'ObjectId'
    ) {
      output[key] =
        value.toString();

      continue;
    }

    throw new AdminPaginationError(
      `Cursor value "${key}" has an unsupported type.`,
      {
        code:
          'UNSUPPORTED_CURSOR_VALUE',
      },
    );
  }

  return output;
}

/**
 * ============================================================================
 * CURSOR SIGNATURE
 * ============================================================================
 */

function createCursorSignature(
  encodedBody,
  secret,
) {
  const normalizedSecret =
    normalizeString(
      secret,
    );

  if (
    !normalizedSecret
  ) {
    throw new AdminPaginationError(
      'Cursor signing secret is required.',
      {
        code:
          'CURSOR_SECRET_REQUIRED',
      },
    );
  }

  return crypto
    .createHmac(
      'sha256',
      normalizedSecret,
    )
    .update(
      encodedBody,
      'utf8',
    )
    .digest(
      'base64url',
    );
}

function timingSafeEqual(
  firstValue,
  secondValue,
) {
  const firstBuffer =
    Buffer.from(
      String(
        firstValue,
      ),
      'utf8',
    );

  const secondBuffer =
    Buffer.from(
      String(
        secondValue,
      ),
      'utf8',
    );

  if (
    firstBuffer.length !==
    secondBuffer.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    firstBuffer,
    secondBuffer,
  );
}

/**
 * ============================================================================
 * KEYSET CURSOR
 * ============================================================================
 *
 * Common admin repository pattern:
 *
 *   sortBy = createdAt
 *   direction = desc
 *   values = {
 *     createdAt,
 *     id
 *   }
 *
 * The tie-breaker ensures deterministic ordering where several documents have
 * identical timestamps.
 * ============================================================================
 */

function createKeysetCursor(
  record,
  {
    sortField =
      DEFAULTS.DEFAULT_SORT_FIELD,

    direction =
      DEFAULTS.DEFAULT_SORT_DIRECTION,

    idField =
      '_id',

    ttlDays =
      DEFAULTS.DEFAULT_CURSOR_TTL_DAYS,

    secret =
      null,
  } = {},
) {
  if (
    !record ||
    typeof record !==
      'object'
  ) {
    throw new AdminPaginationError(
      'A record is required to create a pagination cursor.',
      {
        code:
          'CURSOR_RECORD_REQUIRED',
      },
    );
  }

  if (
    record[
      sortField
    ] ===
      undefined ||
    record[
      sortField
    ] ===
      null
  ) {
    throw new AdminPaginationError(
      `Record does not contain the requested sort field "${sortField}".`,
      {
        code:
          'CURSOR_SORT_VALUE_MISSING',
      },
    );
  }

  if (
    record[
      idField
    ] ===
      undefined ||
    record[
      idField
    ] ===
      null
  ) {
    throw new AdminPaginationError(
      `Record does not contain the required tie-breaker field "${idField}".`,
      {
        code:
          'CURSOR_TIE_BREAKER_MISSING',
      },
    );
  }

  return encodeCursor(
    {
      sort:
        sortField,

      direction:
        normalizeDirection(
          direction,
        ),

      values: {
        [sortField]:
          normalizeCursorRecordValue(
            record[
              sortField
            ],
          ),

        [idField]:
          normalizeCursorRecordValue(
            record[
              idField
            ],
          ),
      },
    },
    {
      ttlDays,

      secret,
    },
  );
}

function normalizeCursorRecordValue(
  value,
) {
  if (
    value instanceof
    Date
  ) {
    return value.toISOString();
  }

  if (
    value &&
    typeof value.toISOString ===
      'function'
  ) {
    return value.toISOString();
  }

  if (
    value &&
    value._bsontype ===
      'ObjectId'
  ) {
    return value.toString();
  }

  if (
    value &&
    typeof value.toString ===
      'function' &&
    value.constructor &&
    value.constructor.name ===
      'ObjectId'
  ) {
    return value.toString();
  }

  if (
    typeof value ===
      'string' ||
    typeof value ===
      'number' ||
    typeof value ===
      'boolean' ||
    value ===
      null
  ) {
    return value;
  }

  throw new AdminPaginationError(
    'Record contains an unsupported cursor value type.',
    {
      code:
        'UNSUPPORTED_CURSOR_RECORD_VALUE',
    },
  );
}

/**
 * ============================================================================
 * MONGODB KEYSET FILTER
 * ============================================================================
 *
 * This produces a lexicographic continuation predicate.
 *
 * Descending:
 *
 *   sort < cursorSort
 *   OR sort == cursorSort AND id < cursorId
 *
 * Ascending:
 *
 *   sort > cursorSort
 *   OR sort == cursorSort AND id > cursorId
 *
 * The repository is responsible for converting values to its exact database
 * types (for example ObjectId or Date) before passing them here.
 * ============================================================================
 */

function buildKeysetFilter(
  cursor,
  {
    sortField =
      DEFAULTS.DEFAULT_SORT_FIELD,

    direction =
      DEFAULTS.DEFAULT_SORT_DIRECTION,

    idField =
      '_id',
  } = {},
) {
  if (
    !cursor
  ) {
    return {};
  }

  const payload =
    typeof cursor ===
      'string'
      ? decodeCursor(
          cursor,
        )
      : cursor;

  validateCursorPayload(
    payload,
    {
      expectedSort:
        sortField,

      expectedDirection:
        normalizeDirection(
          direction,
        ),
    },
  );

  const values =
    payload.values;

  const sortValue =
    values[
      sortField
    ];

  const idValue =
    values[
      idField
    ];

  if (
    sortValue ===
      undefined ||
    idValue ===
      undefined
  ) {
    throw new AdminPaginationError(
      'Cursor does not contain the required keyset values.',
      {
        code:
          'INCOMPLETE_CURSOR',
      },
    );
  }

  const comparison =
    normalizeDirection(
      direction,
    ) ===
    'asc'
      ? '$gt'
      : '$lt';

  return {
    $or: [
      {
        [sortField]: {
          [comparison]:
            sortValue,
        },
      },

      {
        [sortField]:
          sortValue,

        [idField]: {
          [comparison]:
            idValue,
        },
      },
    ],
  };
}

/**
 * ============================================================================
 * MERGE KEYSET FILTER
 * ============================================================================
 *
 * Safely combines the cursor continuation predicate with an existing query
 * without overwriting an existing $or.
 * ============================================================================
 */

function mergeKeysetFilter(
  baseFilter = {},
  keysetFilter = {},
) {
  if (
    !keysetFilter ||
    Object.keys(
      keysetFilter,
    ).length ===
      0
  ) {
    return {
      ...baseFilter,
    };
  }

  const base =
    {
      ...baseFilter,
    };

  const baseOr =
    Array.isArray(
      base.$or,
    )
      ? base.$or
      : null;

  const keysetOr =
    Array.isArray(
      keysetFilter.$or,
    )
      ? keysetFilter.$or
      : [];

  delete base.$or;

  if (
    baseOr
  ) {
    return {
      ...base,

      $and: [
        {
          $or:
            baseOr,
        },

        {
          $or:
            keysetOr,
        },
      ],
    };
  }

  return {
    ...base,

    $or:
      keysetOr,
  };
}

/**
 * ============================================================================
 * NEXT CURSOR
 * ============================================================================
 */

function createNextCursor(
  items,
  {
    sortField =
      DEFAULTS.DEFAULT_SORT_FIELD,

    direction =
      DEFAULTS.DEFAULT_SORT_DIRECTION,

    idField =
      '_id',

    ttlDays =
      DEFAULTS.DEFAULT_CURSOR_TTL_DAYS,

    secret =
      null,
  } = {},
) {
  if (
    !Array.isArray(
      items,
    ) ||
    items.length ===
      0
  ) {
    return null;
  }

  const lastItem =
    items[
      items.length - 1
    ];

  return createKeysetCursor(
    lastItem,
    {
      sortField,

      direction,

      idField,

      ttlDays,

      secret,
    },
  );
}

/**
 * ============================================================================
 * PAGE EXTRACTION
 * ============================================================================
 *
 * Repository pattern:
 *
 * query.limit(limit + 1)
 *
 * This function accepts that result and produces exactly `limit` records plus
 * hasNextPage.
 * ============================================================================
 */

function extractPage(
  items,
  {
    limit,
  } = {},
) {
  if (
    !Array.isArray(
      items,
    )
  ) {
    throw new AdminPaginationError(
      'Pagination items must be an array.',
      {
        code:
          'INVALID_PAGINATION_ITEMS',
      },
    );
  }

  const normalizedLimit =
    normalizeInteger(
      limit,
      {
        field:
          'limit',

        defaultValue:
          DEFAULTS.LIMIT,

        min:
          1,

        max:
          DEFAULTS.MAX_LIMIT,
      },
    );

  const hasNextPage =
    items.length >
    normalizedLimit;

  return {
    items:
      hasNextPage
        ? items.slice(
            0,
            normalizedLimit,
          )
        : items,

    hasNextPage,
  };
}

/**
 * ============================================================================
 * PAGINATION META
 * ============================================================================
 */

function buildPaginationMeta(
  {
    items = [],

    limit =
      DEFAULTS.LIMIT,

    page =
      1,

    total =
      null,

    mode =
      'offset',

    cursor =
      null,

    nextCursor =
      null,

    hasNextPage =
      null,

    hasPreviousPage =
      null,

    sort =
      null,

    includeTotal =
      true,
  } = {},
) {
  const normalizedLimit =
    normalizeInteger(
      limit,
      {
        field:
          'limit',

        defaultValue:
          DEFAULTS.LIMIT,

        min:
          1,

        max:
          DEFAULTS.MAX_LIMIT,
      },
    );

  const normalizedPage =
    normalizeInteger(
      page,
      {
        field:
          'page',

        defaultValue:
          1,

        min:
          1,

        max:
          DEFAULTS.MAX_PAGE,
      },
    );

  const itemCount =
    Array.isArray(
      items,
    )
      ? items.length
      : 0;

  const totalAvailable =
    total !==
      null &&
    total !==
      undefined;

  let resolvedHasNext =
    hasNextPage;

  let resolvedHasPrevious =
    hasPreviousPage;

  if (
    resolvedHasNext ===
      null ||
    resolvedHasNext ===
      undefined
  ) {
    if (
      totalAvailable
    ) {
      resolvedHasNext =
        normalizedPage *
          normalizedLimit <
        Number(total);
    } else {
      resolvedHasNext =
        itemCount >=
        normalizedLimit;
    }
  }

  if (
    resolvedHasPrevious ===
      null ||
    resolvedHasPrevious ===
      undefined
  ) {
    resolvedHasPrevious =
      mode ===
        'cursor'
        ? Boolean(
            cursor,
          )
        : normalizedPage >
          1;
  }

  const meta = {
    mode:

      mode ===
      'cursor'
        ? 'cursor'
        : 'offset',

    page:
      normalizedPage,

    limit:
      normalizedLimit,

    itemCount,

    hasNextPage:
      Boolean(
        resolvedHasNext,
      ),

    hasPreviousPage:
      Boolean(
        resolvedHasPrevious,
      ),

    nextCursor:
      nextCursor ||
      null,

    previousCursor:
      null,

    sort:
      sort ||
      null,
  };

  if (
    includeTotal &&
    totalAvailable
  ) {
    const normalizedTotal =
      Math.max(
        0,
        Number(total),
      );

    meta.totalItems =
      normalizedTotal;

    meta.totalPages =
      normalizedLimit >
      0
        ? Math.ceil(
            normalizedTotal /
              normalizedLimit,
          )
        : 0;

    meta.hasNextPage =
      normalizedPage <
      meta.totalPages;

    meta.hasPreviousPage =
      normalizedPage >
      1;
  }

  if (
    mode !==
    'cursor'
  ) {
    meta.offset =
      (
        normalizedPage -
        1
      ) *
      normalizedLimit;
  }

  return meta;
}

/**
 * ============================================================================
 * STANDARD RESPONSE
 * ============================================================================
 */

function buildPaginationResponse(
  {
    items = [],

    total = null,

    pagination = {},

    nextCursor = null,

    hasNextPage =
      null,

    hasPreviousPage =
      null,

    includeTotal =
      true,

    dataKey =
      'items',

    metaKey =
      'pagination',
  } = {},
) {
  const meta =
    buildPaginationMeta({
      ...pagination,

      items,

      total,

      nextCursor,

      hasNextPage,

      hasPreviousPage,

      includeTotal,
    });

  return {
    [dataKey]:
      Array.isArray(
        items,
      )
        ? items
        : [],

    [metaKey]:
      meta,
  };
}

/**
 * ============================================================================
 * REPOSITORY RESULT NORMALIZATION
 * ============================================================================
 *
 * Supports:
 *
 *   []
 *   { items, hasNextPage, nextCursor }
 *   { data, pagination }
 * ============================================================================
 */

function normalizeRepositoryResult(
  result,
  {
    pagination = {},
  } = {},
) {
  if (
    Array.isArray(
      result,
    )
  ) {
    const extracted =
      extractPage(
        result,
        {
          limit:
            pagination.limit,
        },
      );

    const nextCursor =
      extracted.hasNextPage
        ? createNextCursor(
            extracted.items,
            {
              sortField:
                pagination.sort
                  ?.field ||
                DEFAULTS.DEFAULT_SORT_FIELD,

              direction:
                pagination.sort
                  ?.direction ||
                DEFAULTS.DEFAULT_SORT_DIRECTION,

              idField:
                pagination.idField ||
                '_id',
            },
          )
        : null;

    return {
      items:
        extracted.items,

      hasNextPage:
        extracted.hasNextPage,

      nextCursor,
    };
  }

  if (
    result &&
    typeof result ===
      'object'
  ) {
    const items =
      Array.isArray(
        result.items,
      )
        ? result.items
        : Array.isArray(
            result.data,
          )
          ? result.data
          : [];

    return {
      items,

      hasNextPage:
        result.hasNextPage ??
        result.pagination
          ?.hasNextPage ??
        null,

      hasPreviousPage:
        result.hasPreviousPage ??
        result.pagination
          ?.hasPreviousPage ??
        null,

      nextCursor:
        result.nextCursor ??
        result.pagination
          ?.nextCursor ??
        null,

      total:
        result.total ??
        result.pagination
          ?.totalItems ??
        null,

      raw:
        result,
    };
  }

  throw new AdminPaginationError(
    'Repository returned an unsupported pagination result.',
    {
      code:
        'UNSUPPORTED_REPOSITORY_RESULT',
    },
  );
}

/**
 * ============================================================================
 * EXPRESS QUERY HELPER
 * ============================================================================
 */

function fromRequestQuery(
  query = {},
  options = {},
) {
  return normalizePagination(
    query,
    options,
  );
}

/**
 * ============================================================================
 * APPLY OFFSET TO MONGOOSE QUERY
 * ============================================================================
 *
 * Accepts a Mongoose query-like object.
 * ============================================================================
 */

function applyOffsetToQuery(
  query,
  pagination,
) {
  assertQueryMethod(
    query,
    'skip',
  );

  assertQueryMethod(
    query,
    'limit',
  );

  if (
    pagination.offset >
    0
  ) {
    query =
      query.skip(
        pagination.offset,
      );
  }

  query =
    query.limit(
      pagination.limit,
    );

  if (
    pagination.sort
  ) {
    assertQueryMethod(
      query,
      'sort',
    );

    query =
      query.sort(
        pagination.sort.mongo,
      );
  }

  return query;
}

/**
 * ============================================================================
 * APPLY CURSOR TO QUERY
 * ============================================================================
 */

function applyCursorToQuery(
  query,
  pagination,
  {
    filter = {},

    idField =
      '_id',

    cursorSecret =
      null,
  } = {},
) {
  assertQueryMethod(
    query,
    'limit',
  );

  const cursorFilter =
    pagination.cursor
      ? buildKeysetFilter(
          pagination.cursor,
          {
            sortField:
              pagination.sort
                .field,

            direction:
              pagination.sort
                .direction,

            idField,
          },
        )
      : {};

  const combinedFilter =
    mergeKeysetFilter(
      filter,
      cursorFilter,
    );

  /**
   * Query-like adapters sometimes expose `getFilter()` but don't support
   * changing the filter after creation. The repository should normally use
   * the returned filter rather than calling this method. Returning both keeps
   * the utility safe for Mongoose and custom repositories.
   */
  const limit =
    pagination.limit + 1;

  if (
    pagination.sort
  ) {
    assertQueryMethod(
      query,
      'sort',
    );

    query =
      query.sort(
        buildDeterministicSort(
          pagination.sort,
          idField,
        ),
      );
  }

  query =
    query.limit(
      limit,
    );

  return {
    query,

    filter:
      combinedFilter,

    limit,
  };
}

/**
 * ============================================================================
 * DETERMINISTIC SORT
 * ============================================================================
 *
 * Every cursor query needs a stable tie-breaker.
 *
 * createdAt DESC, _id DESC
 *
 * prevents duplicate/missing records where timestamps are identical.
 * ============================================================================
 */

function buildDeterministicSort(
  sort,
  idField =
    '_id',
) {
  if (
    !sort ||
    !sort.field
  ) {
    throw new AdminPaginationError(
      'A sort definition is required.',
      {
        code:
          'SORT_REQUIRED',
      },
    );
  }

  const direction =
    sort.direction ===
    'asc'
      ? 1
      : -1;

  return {
    [sort.field]:
      direction,

    [idField]:
      direction,
  };
}

/**
 * ============================================================================
 * COUNT / OFFSET RESPONSE
 * ============================================================================
 */

function buildOffsetResponse(
  {
    items = [],

    total = null,

    page =
      DEFAULTS.PAGE,

    limit =
      DEFAULTS.LIMIT,

    sort =
      null,

    includeTotal =
      true,
  } = {},
) {
  return buildPaginationResponse({
    items,

    total,

    pagination: {
      mode:
        'offset',

      page,

      limit,

      sort,
    },

    includeTotal,
  });
}

/**
 * ============================================================================
 * CURSOR RESPONSE
 * ============================================================================
 */

function buildCursorResponse(
  {
    items = [],

    limit =
      DEFAULTS.LIMIT,

    sort =
      null,

    hasNextPage =
      false,

    nextCursor =
      null,

    hasPreviousPage =
      false,

    currentCursor =
      null,
  } = {},
) {
  return buildPaginationResponse({
    items,

    pagination: {
      mode:
        'cursor',

      page:
        1,

      limit,

      sort,

      cursor:
        currentCursor,
    },

    nextCursor,

    hasNextPage,

    hasPreviousPage,

    includeTotal:
      false,
  });
}

/**
 * ============================================================================
 * PAGE NUMBER HELPERS
 * ============================================================================
 */

function getFirstPage() {
  return 1;
}

function getNextPage(
  page,
  hasNextPage,
) {
  const current =
    normalizeInteger(
      page,
      {
        field:
          'page',

        defaultValue:
          1,

        min:
          1,

        max:
          DEFAULTS.MAX_PAGE,
      },
    );

  return hasNextPage
    ? current + 1
    : null;
}

function getPreviousPage(
  page,
) {
  const current =
    normalizeInteger(
      page,
      {
        field:
          'page',

        defaultValue:
          1,

        min:
          1,

        max:
          DEFAULTS.MAX_PAGE,
      },
    );

  return current > 1
    ? current - 1
    : null;
}

/**
 * ============================================================================
 * VALIDATE PAGINATION RESPONSE
 * ============================================================================
 *
 * Useful in tests and service contracts.
 * ============================================================================
 */

function validatePaginationResponse(
  response,
) {
  if (
    !response ||
    typeof response !==
      'object'
  ) {
    throw new AdminPaginationError(
      'Pagination response must be an object.',
      {
        code:
          'INVALID_PAGINATION_RESPONSE',
      },
    );
  }

  const pagination =
    response.pagination;

  if (
    !pagination ||
    typeof pagination !==
      'object'
  ) {
    throw new AdminPaginationError(
      'Pagination metadata is missing.',
      {
        code:
          'PAGINATION_METADATA_MISSING',
      },
    );
  }

  if (
    ![
      'offset',
      'cursor',
    ].includes(
      pagination.mode,
    )
  ) {
    throw new AdminPaginationError(
      'Pagination mode is invalid.',
      {
        code:
          'INVALID_PAGINATION_RESPONSE_MODE',
      },
    );
  }

  if (
    !Number.isInteger(
      pagination.limit,
    ) ||
    pagination.limit <
      1
  ) {
    throw new AdminPaginationError(
      'Pagination limit is invalid.',
      {
        code:
          'INVALID_PAGINATION_RESPONSE_LIMIT',
      },
    );
  }

  if (
    !Array.isArray(
      response.items,
    ) &&
    !Array.isArray(
      response.data,
    )
  ) {
    throw new AdminPaginationError(
      'Pagination response data must be an array.',
      {
        code:
          'INVALID_PAGINATION_RESPONSE_DATA',
      },
    );
  }

  return true;
}

/**
 * ============================================================================
 * ITERATOR
 * ============================================================================
 *
 * Generic helper for processing page-by-page without materializing an entire
 * dataset.
 *
 * `fetchPage` must return:
 *
 * {
 *   items,
 *   hasNextPage,
 *   nextCursor
 * }
 *
 * ============================================================================
 */

async function paginate(
  {
    fetchPage,

    mode =
      'cursor',

    maxPages =
      1000,

    signal =
      null,
  } = {},
) {
  if (
    typeof fetchPage !==
    'function'
  ) {
    throw new AdminPaginationError(
      'fetchPage must be a function.',
      {
        code:
          'FETCH_PAGE_REQUIRED',
      },
    );
  }

  const safeMaxPages =
    normalizeInteger(
      maxPages,
      {
        field:
          'maxPages',

        defaultValue:
          1000,

        min:
          1,

        max:
          100000,
      },
    );

  const results =
    [];

  let page =
    1;

  let cursor =
    null;

  while (
    page <=
    safeMaxPages
  ) {
    if (
      signal?.aborted
    ) {
      throw new AdminPaginationError(
        'Pagination operation was aborted.',
        {
          code:
            'PAGINATION_ABORTED',
        },
      );
    }

    const response =
      await fetchPage({
        page,

        cursor,

        mode,
      });

    if (
      !response ||
      typeof response !==
        'object'
    ) {
      throw new AdminPaginationError(
        'fetchPage returned an invalid response.',
        {
          code:
            'INVALID_FETCH_PAGE_RESPONSE',
        },
      );
    }

    const items =
      Array.isArray(
        response.items,
      )
        ? response.items
        : [];

    results.push(
      ...items,
    );

    if (
      !response.hasNextPage
    ) {
      return {
        items:
          results,

        pagesFetched:
          page,

        hasNextPage:
          false,

        nextCursor:
          null,
      };
    }

    const nextCursor =
      response.nextCursor;

    if (
      mode ===
        'cursor' &&
      !nextCursor
    ) {
      throw new AdminPaginationError(
        'Repository reported hasNextPage=true without providing nextCursor.',
        {
          code:
            'NEXT_CURSOR_MISSING',
        },
      );
    }

    cursor =
      nextCursor;

    page += 1;
  }

  throw new AdminPaginationError(
    'Pagination exceeded the maximum number of pages.',
    {
      code:
        'MAX_PAGES_EXCEEDED',

      details: {
        maxPages:
          safeMaxPages,
      },
    },
  );
}

/**
 * ============================================================================
 * QUERY METHOD ASSERTION
 * ============================================================================
 */

function assertQueryMethod(
  query,
  method,
) {
  if (
    !query ||
    typeof query[method] !==
      'function'
  ) {
    throw new AdminPaginationError(
      `Query does not support .${method}().`,
      {
        code:
          'QUERY_METHOD_UNSUPPORTED',

        details: {
          method,
        },
      },
    );
  }
}

/**
 * ============================================================================
 * CURSOR EXPIRATION HELPER
 * ============================================================================
 */

function isCursorExpired(
  cursor,
  options = {},
) {
  try {
    const payload =
      typeof cursor ===
        'string'
        ? decodeCursor(
            cursor,
            {
              ...options,

              allowExpired:
                true,
            },
          )
        : cursor;

    return Date.now() >=
      payload.exp;
  } catch {
    return true;
  }
}

/**
 * ============================================================================
 * CURSOR AGE
 * ============================================================================
 */

function getCursorAgeMs(
  cursor,
  options = {},
) {
  const payload =
    typeof cursor ===
      'string'
      ? decodeCursor(
          cursor,
          {
            ...options,

            allowExpired:
              true,
          },
        )
      : cursor;

  return Math.max(
    0,
    Date.now() -
      payload.iat,
  );
}

/**
 * ============================================================================
 * TOTAL-PAGE HELPERS
 * ============================================================================
 */

function getTotalPages(
  total,
  limit,
) {
  const normalizedTotal =
    Math.max(
      0,
      Number(total) ||
        0,
    );

  const normalizedLimit =
    normalizeInteger(
      limit,
      {
        field:
          'limit',

        defaultValue:
          DEFAULTS.LIMIT,

        min:
          1,

        max:
          DEFAULTS.MAX_LIMIT,
      },
    );

  return Math.ceil(
    normalizedTotal /
      normalizedLimit,
  );
}

function getPageStart(
  page,
  limit,
) {
  const normalizedPage =
    normalizeInteger(
      page,
      {
        field:
          'page',

        defaultValue:
          1,

        min:
          1,

        max:
          DEFAULTS.MAX_PAGE,
      },
    );

  const normalizedLimit =
    normalizeInteger(
      limit,
      {
        field:
          'limit',

        defaultValue:
          DEFAULTS.LIMIT,

        min:
          1,

        max:
          DEFAULTS.MAX_LIMIT,
      },
    );

  return (
    (
      normalizedPage -
      1
    ) *
    normalizedLimit
  ) + 1;
}

function getPageEnd(
  page,
  limit,
  total,
) {
  const start =
    getPageStart(
      page,
      limit,
    );

  if (
    !total ||
    start >
      total
  ) {
    return 0;
  }

  return Math.min(
    start +
      Number(
        limit,
      ) -
      1,
    Number(total),
  );
}

/**
 * ============================================================================
 * CAPABILITIES
 * ============================================================================
 */

function getCapabilities() {
  return {
    utility:
      UTILITY_NAME,

    version:
      UTILITY_VERSION,

    application:
      APPLICATION_NAME,

    strategies: {
      offset:
        true,

      cursor:
        true,

      hybrid:
        true,
    },

    features: {
      opaqueCursors:
        true,

      signedCursors:
        true,

      cursorExpiry:
        true,

      deterministicKeyset:
        true,

      stableTieBreaker:
        true,

      safeLimits:
        true,

      standardizedResponse:
        true,

      repositoryNormalization:
        true,

      asyncIteration:
        true,
    },

    defaults: {
      page:
        DEFAULTS.PAGE,

      limit:
        DEFAULTS.LIMIT,

      maxLimit:
        DEFAULTS.MAX_LIMIT,

      sortField:
        DEFAULTS.DEFAULT_SORT_FIELD,

      sortDirection:
        DEFAULTS.DEFAULT_SORT_DIRECTION,

      cursorVersion:
        DEFAULTS.CURSOR_VERSION,
    },

    timestamp:
      new Date(),
  };
}

/**
 * ============================================================================
 * PUBLIC API
 * ============================================================================
 */

const AdminPagination =
  Object.freeze({
    name:
      UTILITY_NAME,

    version:
      UTILITY_VERSION,

    defaults:
      DEFAULTS,

    sortDirections:
      SORT_DIRECTIONS,

    /**
     * Input
     */
    normalizePagination,

    fromRequestQuery,

    normalizeSort,

    normalizeSortField,

    normalizeDirection,

    calculateOffset,

    /**
     * Cursor
     */
    encodeCursor,

    decodeCursor,

    validateCursorPayload,

    sanitizeCursorValues,

    createKeysetCursor,

    createNextCursor,

    buildKeysetFilter,

    mergeKeysetFilter,

    createCursorSignature,

    isCursorExpired,

    getCursorAgeMs,

    /**
     * Query
     */
    applyOffsetToQuery,

    applyCursorToQuery,

    buildDeterministicSort,

    /**
     * Results
     */
    extractPage,

    buildPaginationMeta,

    buildPaginationResponse,

    buildOffsetResponse,

    buildCursorResponse,

    normalizeRepositoryResult,

    validatePaginationResponse,

    /**
     * Navigation
     */
    getFirstPage,

    getNextPage,

    getPreviousPage,

    getTotalPages,

    getPageStart,

    getPageEnd,

    /**
     * Iteration
     */
    paginate,

    /**
     * Diagnostics
     */
    getCapabilities,
  });

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 */

module.exports =
  AdminPagination;

module.exports.AdminPagination =
  AdminPagination;

module.exports.AdminPaginationError =
  AdminPaginationError;

Object.assign(
  module.exports,
  AdminPagination,
);