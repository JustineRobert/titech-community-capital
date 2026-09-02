/**
 * ============================================================================
 * TITech Community Capital
 * Enterprise Legal Document Type Contract
 * ============================================================================
 *
 * File:
 *   frontend/src/legal/legalTypes.js
 *
 * Purpose:
 *   Runtime validation, normalization and contract enforcement for TITech
 *   Community Capital legal-document metadata.
 *
 * Architectural responsibilities
 * ----------------------------------------------------------------------------
 * legalRegistry.js
 *   - Defines the application legal-document registry.
 *
 * legalTypes.js
 *   - Defines and validates the metadata contract.
 *   - Normalizes metadata.
 *   - Detects structural and semantic configuration errors.
 *   - Provides deterministic CI/CD and startup validation.
 *
 * legalUtils.js
 *   - Provides operational lookup, filtering, formatting and convenience
 *     functions.
 *
 * Backend legal service
 *   - Remains authoritative for legal content, publication, acceptance,
 *     audit history, tenant applicability and regulatory compliance.
 *
 * Design Principles
 * ----------------------------------------------------------------------------
 * - Fail fast on invalid legal metadata.
 * - Prefer deterministic validation over silent coercion.
 * - Keep presentation concerns outside the metadata contract.
 * - Support API/CMS/database/static legal content.
 * - Protect against duplicate identifiers, slugs and routes.
 * - Support explicit legal-document lifecycle states.
 * - Support versioned legal documents.
 * - Support acceptance-scope metadata.
 * - Support jurisdiction and regulatory review metadata.
 * - Support content integrity hashes.
 * - Remain framework-agnostic.
 * - Maintain TITech terminology consistently.
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * This module validates SOFTWARE METADATA only.
 *
 * It does NOT determine whether TITech Community Capital Ltd is:
 *   - licensed;
 *   - authorized;
 *   - regulated;
 *   - approved;
 *   - exempt;
 *   - permitted to provide any particular financial service.
 *
 * Substantive legal content and regulatory positioning must be reviewed by
 * appropriately qualified legal, compliance and regulatory professionals.
 *
 * ============================================================================
 */

'use strict';

/* ============================================================================
 * ENUMERATIONS
 * ========================================================================== */

/**
 * Supported legal-document publication states.
 */
export const LEGAL_STATUS_VALUES = Object.freeze([
  'draft',
  'review',
  'approved',
  'scheduled',
  'published',
  'superseded',
  'retired',
]);

/**
 * Supported legal-document categories.
 */
export const LEGAL_CATEGORY_VALUES = Object.freeze([
  'contract',
  'privacy',
  'policy',
  'financial',
  'payments',
  'data-protection',
  'dispute',
  'developer',
  'regulatory',
  'communications',
  'security',
  'governance',
  'risk',
]);

/**
 * Supported legal audiences.
 */
export const LEGAL_AUDIENCE_VALUES = Object.freeze([
  'public',
  'member',
  'tenant-admin',
  'sacco',
  'vsla',
  'cooperative',
  'lender',
  'borrower',
  'developer',
  'partner',
  'internal',
  'regulator',
  'employee',
]);

/**
 * Supported acceptance scopes.
 */
export const LEGAL_ACCEPTANCE_SCOPE_VALUES = Object.freeze([
  'user',
  'tenant',
  'organization',
  'transaction',
]);

/**
 * Supported legal-content sources.
 */
export const LEGAL_CONTENT_SOURCE_VALUES = Object.freeze([
  'api',
  'cms',
  'static',
  'database',
  'hybrid',
]);

/**
 * Supported document priorities.
 */
export const LEGAL_PRIORITY_VALUES = Object.freeze([
  'critical',
  'high',
  'medium',
  'low',
]);

/**
 * Supported legal jurisdictions.
 *
 * These are application metadata identifiers, not legal conclusions.
 */
export const LEGAL_JURISDICTION_VALUES = Object.freeze([
  'UG',
  'EAC',
  'AFRICA',
  'INTERNATIONAL',
]);

/* ============================================================================
 * REQUIRED CONTRACT
 * ========================================================================== */

/**
 * Minimum required fields for every legal-document registry entry.
 *
 * These fields form the stable metadata contract consumed by:
 *   - legal UI;
 *   - routing;
 *   - acceptance workflows;
 *   - document APIs;
 *   - CMS integrations;
 *   - automated validation.
 */
export const REQUIRED_LEGAL_DOCUMENT_FIELDS = Object.freeze([
  'id',
  'slug',
  'title',
  'shortTitle',
  'category',
  'audience',
  'public',
  'requiresAcceptance',
  'currentVersion',
  'status',
  'route',
  'apiPath',
  'contentSource',
]);

/**
 * Required textual fields.
 */
export const REQUIRED_LEGAL_DOCUMENT_STRING_FIELDS =
  Object.freeze([
    'id',
    'slug',
    'title',
    'shortTitle',
    'category',
    'currentVersion',
    'status',
    'route',
    'apiPath',
    'contentSource',
  ]);

/**
 * Required boolean fields.
 */
export const REQUIRED_LEGAL_DOCUMENT_BOOLEAN_FIELDS =
  Object.freeze([
    'public',
    'requiresAcceptance',
  ]);

/* ============================================================================
 * OPTIONAL CONTRACT
 * ========================================================================== */

/**
 * Enterprise metadata supported by the registry.
 *
 * These fields are optional at the contract level so existing documents can
 * migrate progressively.
 */
export const OPTIONAL_LEGAL_DOCUMENT_FIELDS = Object.freeze([
  'description',
  'summary',

  'effectiveDate',
  'publishedDate',
  'publishedAt',

  'scheduledAt',
  'retiredAt',

  'nextReviewDate',

  'supersedes',
  'supersededBy',
  'supersedesVersion',

  'approvedBy',
  'approvalDate',

  'owner',
  'legalOwner',
  'complianceOwner',

  'jurisdiction',
  'language',

  'contentHash',
  'lastModified',

  'displayOrder',
  'tags',
  'relatedDocuments',

  'acceptanceScope',
  'acceptanceRequiredBeforeUse',
  'acceptanceRequiredBeforeTransaction',
  'acceptanceVersionLock',

  'acceptanceLabel',

  'searchable',
  'printable',
  'downloadable',

  'legalReviewRequired',
  'regulatoryReviewRequired',
  'securityReviewRequired',
  'privacyReviewRequired',

  'priority',
]);

/**
 * All recognized metadata fields.
 */
export const RECOGNIZED_LEGAL_DOCUMENT_FIELDS =
  Object.freeze([
    ...REQUIRED_LEGAL_DOCUMENT_FIELDS,
    ...OPTIONAL_LEGAL_DOCUMENT_FIELDS,
  ]);

/* ============================================================================
 * REGEX CONTRACTS
 * ========================================================================== */

/**
 * Conservative semantic-version pattern.
 *
 * Supported:
 *   1.0
 *   1.1
 *   2.0
 *   1.0.0
 *   2.1.3
 *   1.0.0-beta
 *   1.0.0+build.1
 *   1.0.0-beta+build.1
 */
export const LEGAL_VERSION_PATTERN =
  /^\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Stable machine-readable document identifiers.
 *
 * Examples:
 *   terms-of-service
 *   privacy-policy
 *   loan-terms
 */
export const LEGAL_ID_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * URL-safe document slug.
 */
export const LEGAL_SLUG_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Application-relative frontend route.
 *
 * Examples:
 *   /legal/privacy-policy
 *   /legal/terms-of-service
 */
export const LEGAL_ROUTE_PATTERN =
  /^\/[A-Za-z0-9/_-]+(?:\?[A-Za-z0-9=&_.%~-]+)?$/;

/**
 * Application-relative API path.
 *
 * Supports path parameters such as:
 *   /api/legal/:id
 *   /api/legal/{documentId}
 */
export const LEGAL_API_PATH_PATTERN =
  /^\/[A-Za-z0-9/_{}:.-]+(?:\?[A-Za-z0-9=&_.%{}:+-]+)?$/;

/**
 * SHA-256 hexadecimal hash.
 */
export const LEGAL_SHA256_PATTERN =
  /^[a-fA-F0-9]{64}$/;

/**
 * BCP-47-style language identifier.
 *
 * Examples:
 *   en
 *   en-UG
 *   sw
 *   fr
 */
export const LEGAL_LANGUAGE_PATTERN =
  /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

/* ============================================================================
 * INTERNAL HELPERS
 * ========================================================================== */

/**
 * Determine whether a value is a non-empty string.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isNonEmptyString(value) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0
  );
}

/**
 * Determine whether a value is a plain object.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return false;
  }

  const prototype =
    Object.getPrototypeOf(value);

  return (
    prototype === Object.prototype ||
    prototype === null
  );
}

/**
 * Determine whether an object owns a property.
 *
 * @param {object} object
 * @param {string} property
 * @returns {boolean}
 */
function hasOwn(object, property) {
  return Object.prototype.hasOwnProperty.call(
    object,
    property
  );
}

/**
 * Build a consistent document prefix for validation errors.
 *
 * @param {*} document
 * @returns {string}
 */
function documentContext(document) {
  const identifier =
    document &&
    typeof document.id === 'string' &&
    document.id.trim()
      ? document.id.trim()
      : 'unknown';

  return `Legal document "${identifier}"`;
}

/**
 * Validate an ISO calendar date.
 *
 * Expected:
 *   YYYY-MM-DD
 *
 * @param {*} value
 * @returns {boolean}
 */
function isValidIsoDate(value) {
  if (!isNonEmptyString(value)) {
    return false;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(
    `${value}T00:00:00.000Z`
  );

  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

/**
 * Validate an ISO date-time string.
 *
 * Examples:
 *   2026-01-15T12:00:00.000Z
 *   2026-01-15T12:00:00Z
 *
 * @param {*} value
 * @returns {boolean}
 */
function isValidIsoDateTime(value) {
  if (!isNonEmptyString(value)) {
    return false;
  }

  const parsed = new Date(value);

  return (
    !Number.isNaN(parsed.getTime()) &&
    /T/.test(value)
  );
}

/**
 * Validate an optional integer.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isOptionalInteger(value) {
  return (
    value === undefined ||
    value === null ||
    (
      Number.isInteger(value) &&
      Number.isFinite(value)
    )
  );
}

/**
 * Validate an optional string array.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isOptionalStringArray(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return true;
  }

  return (
    Array.isArray(value) &&
    value.every(isNonEmptyString)
  );
}

/**
 * Validate a controlled enum value.
 *
 * @param {*} value
 * @param {ReadonlyArray<string>} allowed
 * @returns {boolean}
 */
function isAllowedValue(value, allowed) {
  return (
    isNonEmptyString(value) &&
    allowed.includes(value)
  );
}

/**
 * Validate an optional enum.
 *
 * @param {*} value
 * @param {ReadonlyArray<string>} allowed
 * @returns {boolean}
 */
function isOptionalAllowedValue(
  value,
  allowed
) {
  return (
    value === undefined ||
    value === null ||
    isAllowedValue(value, allowed)
  );
}

/**
 * Add an error to a validation result.
 *
 * @param {Array<string>} errors
 * @param {string} message
 */
function addError(errors, message) {
  errors.push(message);
}

/**
 * Add a warning to a validation result.
 *
 * @param {Array<string>} warnings
 * @param {string} message
 */
function addWarning(warnings, message) {
  warnings.push(message);
}

/* ============================================================================
 * BASIC TYPE VALIDATION
 * ========================================================================== */

/**
 * Determine whether a value satisfies the minimum legal-document structure.
 *
 * This intentionally performs only structural validation.
 *
 * @param {*} document
 * @returns {boolean}
 */
export function isValidLegalDocument(document) {
  if (!isPlainObject(document)) {
    return false;
  }

  return REQUIRED_LEGAL_DOCUMENT_FIELDS.every(
    (field) => hasOwn(document, field)
  );
}

/* ============================================================================
 * NORMALIZATION
 * ========================================================================== */

/**
 * Normalize a legal-document metadata object.
 *
 * Normalization:
 *   - trims textual values;
 *   - clones arrays;
 *   - preserves null values;
 *   - does not silently invent required values;
 *   - does not modify the original object.
 *
 * This function does NOT make invalid metadata valid.
 *
 * @param {*} document
 * @returns {object|null}
 */
export function normalizeLegalDocument(document) {
  if (!isPlainObject(document)) {
    return null;
  }

  const normalized = {
    ...document,
  };

  const stringFields = [
    ...REQUIRED_LEGAL_DOCUMENT_STRING_FIELDS,
    ...OPTIONAL_LEGAL_DOCUMENT_FIELDS.filter(
      (field) => ![
        'tags',
        'relatedDocuments',
        'displayOrder',
        'public',
        'requiresAcceptance',
        'acceptanceRequiredBeforeUse',
        'acceptanceRequiredBeforeTransaction',
        'acceptanceVersionLock',
        'searchable',
        'printable',
        'downloadable',
        'legalReviewRequired',
        'regulatoryReviewRequired',
        'securityReviewRequired',
        'privacyReviewRequired',
      ].includes(field)
    ),
  ];

  stringFields.forEach((field) => {
    if (
      typeof normalized[field] === 'string'
    ) {
      normalized[field] =
        normalized[field].trim();
    }
  });

  [
    'audience',
    'tags',
    'relatedDocuments',
  ].forEach((field) => {
    if (Array.isArray(normalized[field])) {
      normalized[field] =
        normalized[field].map((value) =>
          typeof value === 'string'
            ? value.trim()
            : value
        );
    }
  });

  if (
    typeof normalized.displayOrder === 'string' &&
    normalized.displayOrder.trim() !== ''
  ) {
    const numericValue =
      Number(normalized.displayOrder);

    if (
      Number.isInteger(numericValue)
    ) {
      normalized.displayOrder =
        numericValue;
    }
  }

  return Object.freeze(normalized);
}

/* ============================================================================
 * DETAILED DOCUMENT VALIDATION
 * ========================================================================== */

/**
 * Validate a legal document and return a structured result.
 *
 * This is the primary non-throwing validator.
 *
 * @param {*} document
 * @returns {{
 *   valid: boolean,
 *   errors: string[],
 *   warnings: string[],
 *   document: object|null
 * }}
 */
export function validateLegalDocument(
  document
) {
  const errors = [];
  const warnings = [];

  if (!isPlainObject(document)) {
    return Object.freeze({
      valid: false,
      errors: Object.freeze([
        'Legal document metadata must be a plain object.',
      ]),
      warnings: Object.freeze([]),
      document: null,
    });
  }

  const context =
    documentContext(document);

  /* --------------------------------------------------------------------------
   * Required fields
   * ------------------------------------------------------------------------ */

  REQUIRED_LEGAL_DOCUMENT_FIELDS.forEach(
    (field) => {
      if (!hasOwn(document, field)) {
        addError(
          errors,
          `${context} is missing required field "${field}".`
        );
      }
    }
  );

  if (errors.length > 0) {
    return Object.freeze({
      valid: false,
      errors: Object.freeze(errors),
      warnings: Object.freeze(warnings),
      document,
    });
  }

  /* --------------------------------------------------------------------------
   * Required string fields
   * ------------------------------------------------------------------------ */

  REQUIRED_LEGAL_DOCUMENT_STRING_FIELDS.forEach(
    (field) => {
      if (!isNonEmptyString(document[field])) {
        addError(
          errors,
          `${context} must define a non-empty "${field}" string.`
        );
      }
    }
  );

  /* --------------------------------------------------------------------------
   * Required booleans
   * ------------------------------------------------------------------------ */

  REQUIRED_LEGAL_DOCUMENT_BOOLEAN_FIELDS.forEach(
    (field) => {
      if (
        typeof document[field] !==
        'boolean'
      ) {
        addError(
          errors,
          `${context} field "${field}" must be a boolean.`
        );
      }
    }
  );

  /* --------------------------------------------------------------------------
   * Identifier
   * ------------------------------------------------------------------------ */

  if (
    isNonEmptyString(document.id) &&
    !LEGAL_ID_PATTERN.test(document.id)
  ) {
    addError(
      errors,
      `${context} id "${document.id}" is invalid. ` +
      'Use lowercase kebab-case.'
    );
  }

  /* --------------------------------------------------------------------------
   * Slug
   * ------------------------------------------------------------------------ */

  if (
    isNonEmptyString(document.slug) &&
    !LEGAL_SLUG_PATTERN.test(document.slug)
  ) {
    addError(
      errors,
      `${context} slug "${document.slug}" is invalid. ` +
      'Use lowercase URL-safe kebab-case.'
    );
  }

  /* --------------------------------------------------------------------------
   * Version
   * ------------------------------------------------------------------------ */

  if (
    isNonEmptyString(
      document.currentVersion
    ) &&
    !LEGAL_VERSION_PATTERN.test(
      document.currentVersion
    )
  ) {
    addError(
      errors,
      `${context} currentVersion "${document.currentVersion}" is invalid. ` +
      'Expected a version such as "1.0.0".'
    );
  }

  /* --------------------------------------------------------------------------
   * Category
   * ------------------------------------------------------------------------ */

  if (
    isNonEmptyString(document.category) &&
    !LEGAL_CATEGORY_VALUES.includes(
      document.category
    )
  ) {
    addError(
      errors,
      `${context} category "${document.category}" is unsupported.`
    );
  }

  /* --------------------------------------------------------------------------
   * Status
   * ------------------------------------------------------------------------ */

  if (
    isNonEmptyString(document.status) &&
    !LEGAL_STATUS_VALUES.includes(
      document.status
    )
  ) {
    addError(
      errors,
      `${context} status "${document.status}" is unsupported.`
    );
  }

  /* --------------------------------------------------------------------------
   * Audience
   * ------------------------------------------------------------------------ */

  if (!Array.isArray(document.audience)) {
    addError(
      errors,
      `${context} must define "audience" as an array.`
    );
  } else {
    if (document.audience.length === 0) {
      addError(
        errors,
        `${context} must define at least one audience.`
      );
    }

    document.audience.forEach(
      (audience) => {
        if (
          !isAllowedValue(
            audience,
            LEGAL_AUDIENCE_VALUES
          )
        ) {
          addError(
            errors,
            `${context} audience "${audience}" is unsupported.`
          );
        }
      }
    );

    if (
      new Set(document.audience).size !==
      document.audience.length
    ) {
      addError(
        errors,
        `${context} contains duplicate audience values.`
      );
    }
  }

  /* --------------------------------------------------------------------------
   * Route
   * ------------------------------------------------------------------------ */

  if (
    isNonEmptyString(document.route) &&
    !LEGAL_ROUTE_PATTERN.test(
      document.route
    )
  ) {
    addError(
      errors,
      `${context} route "${document.route}" is invalid. ` +
      'Routes must be application-relative paths.'
    );
  }

  /* --------------------------------------------------------------------------
   * API path
   * ------------------------------------------------------------------------ */

  if (
    isNonEmptyString(document.apiPath) &&
    !LEGAL_API_PATH_PATTERN.test(
      document.apiPath
    )
  ) {
    addError(
      errors,
      `${context} apiPath "${document.apiPath}" is invalid. ` +
      'API paths must be application-relative paths.'
    );
  }

  /* --------------------------------------------------------------------------
   * Content source
   * ------------------------------------------------------------------------ */

  if (
    !isAllowedValue(
      document.contentSource,
      LEGAL_CONTENT_SOURCE_VALUES
    )
  ) {
    addError(
      errors,
      `${context} contentSource "${document.contentSource}" is unsupported. ` +
      `Expected one of: ${LEGAL_CONTENT_SOURCE_VALUES.join(', ')}.`
    );
  }

  /* --------------------------------------------------------------------------
   * Optional enum fields
   * ------------------------------------------------------------------------ */

  if (
    !isOptionalAllowedValue(
      document.priority,
      LEGAL_PRIORITY_VALUES
    )
  ) {
    addError(
      errors,
      `${context} priority "${document.priority}" is unsupported.`
    );
  }

  if (
    !isOptionalAllowedValue(
      document.jurisdiction,
      LEGAL_JURISDICTION_VALUES
    )
  ) {
    addError(
      errors,
      `${context} jurisdiction "${document.jurisdiction}" is unsupported.`
    );
  }

  if (
    !isOptionalAllowedValue(
      document.acceptanceScope,
      LEGAL_ACCEPTANCE_SCOPE_VALUES
    )
  ) {
    addError(
      errors,
      `${context} acceptanceScope "${document.acceptanceScope}" is unsupported.`
    );
  }

  /* --------------------------------------------------------------------------
   * Language
   * ------------------------------------------------------------------------ */

  if (
    document.language !== undefined &&
    document.language !== null
  ) {
    if (
      !isNonEmptyString(document.language) ||
      !LEGAL_LANGUAGE_PATTERN.test(
        document.language
      )
    ) {
      addError(
        errors,
        `${context} language "${document.language}" is invalid.`
      );
    }
  }

  /* --------------------------------------------------------------------------
   * Optional textual metadata
   * ------------------------------------------------------------------------ */

  const optionalStringFields = [
    'description',
    'summary',
    'effectiveDate',
    'publishedDate',
    'publishedAt',
    'scheduledAt',
    'retiredAt',
    'nextReviewDate',
    'supersedes',
    'supersededBy',
    'supersedesVersion',
    'approvedBy',
    'approvalDate',
    'owner',
    'legalOwner',
    'complianceOwner',
    'jurisdiction',
    'language',
    'contentHash',
    'lastModified',
    'acceptanceLabel',
  ];

  optionalStringFields.forEach(
    (field) => {
      if (
        document[field] !== undefined &&
        document[field] !== null &&
        !isNonEmptyString(
          document[field]
        )
      ) {
        addError(
          errors,
          `${context} optional field "${field}" must be a non-empty string when provided.`
        );
      }
    }
  );

  /* --------------------------------------------------------------------------
   * Date-only fields
   * ------------------------------------------------------------------------ */

  [
    'effectiveDate',
    'publishedDate',
    'nextReviewDate',
    'approvalDate',
  ].forEach(
    (field) => {
      if (
        document[field] !== undefined &&
        document[field] !== null &&
        !isValidIsoDate(
          document[field]
        )
      ) {
        addError(
          errors,
          `${context} field "${field}" must use YYYY-MM-DD format.`
        );
      }
    }
  );

  /* --------------------------------------------------------------------------
   * Date-time fields
   * ------------------------------------------------------------------------ */

  [
    'publishedAt',
    'scheduledAt',
    'retiredAt',
    'lastModified',
  ].forEach(
    (field) => {
      if (
        document[field] !== undefined &&
        document[field] !== null &&
        !isValidIsoDateTime(
          document[field]
        )
      ) {
        addError(
          errors,
          `${context} field "${field}" must be a valid ISO date-time.`
        );
      }
    }
  );

  /* --------------------------------------------------------------------------
   * Supersession versions
   * ------------------------------------------------------------------------ */

  if (
    document.supersedesVersion !==
      undefined &&
    document.supersedesVersion !==
      null &&
    !LEGAL_VERSION_PATTERN.test(
      document.supersedesVersion
    )
  ) {
    addError(
      errors,
      `${context} supersedesVersion "${document.supersedesVersion}" is invalid.`
    );
  }

  /* --------------------------------------------------------------------------
   * Supersession identifiers
   * ------------------------------------------------------------------------ */

  [
    'supersedes',
    'supersededBy',
  ].forEach(
    (field) => {
      if (
        document[field] !== undefined &&
        document[field] !== null &&
        isNonEmptyString(document[field]) &&
        !LEGAL_ID_PATTERN.test(
          document[field]
        )
      ) {
        addError(
          errors,
          `${context} ${field} "${document[field]}" must use lowercase kebab-case.`
        );
      }
    }
  );

  /* --------------------------------------------------------------------------
   * Content hash
   * ------------------------------------------------------------------------ */

  if (
    document.contentHash !==
      undefined &&
    document.contentHash !== null
  ) {
    if (
      !LEGAL_SHA256_PATTERN.test(
        document.contentHash
      )
    ) {
      addError(
        errors,
        `${context} contentHash must be a 64-character SHA-256 hexadecimal hash.`
      );
    }
  }

  /* --------------------------------------------------------------------------
   * Tags
   * ------------------------------------------------------------------------ */

  if (
    !isOptionalStringArray(
      document.tags
    )
  ) {
    addError(
      errors,
      `${context} tags must be an array of non-empty strings.`
    );
  }

  if (
    Array.isArray(document.tags) &&
    new Set(document.tags).size !==
      document.tags.length
  ) {
    addError(
      errors,
      `${context} contains duplicate tags.`
    );
  }

  /* --------------------------------------------------------------------------
   * Related documents
   * ------------------------------------------------------------------------ */

  if (
    !isOptionalStringArray(
      document.relatedDocuments
    )
  ) {
    addError(
      errors,
      `${context} relatedDocuments must be an array of non-empty strings.`
    );
  }

  if (
    Array.isArray(
      document.relatedDocuments
    )
  ) {
    document.relatedDocuments.forEach(
      (relatedId) => {
        if (
          !LEGAL_ID_PATTERN.test(
            relatedId
          )
        ) {
          addError(
            errors,
            `${context} related document "${relatedId}" is not a valid document ID.`
          );
        }
      }
    );
  }

  /* --------------------------------------------------------------------------
   * Display order
   * ------------------------------------------------------------------------ */

  if (
    !isOptionalInteger(
      document.displayOrder
    )
  ) {
    addError(
      errors,
      `${context} displayOrder must be an integer when provided.`
    );
  }

  if (
    document.displayOrder !==
      undefined &&
    document.displayOrder !== null &&
    document.displayOrder < 0
  ) {
    addError(
      errors,
      `${context} displayOrder cannot be negative.`
    );
  }

  /* --------------------------------------------------------------------------
   * Optional booleans
   * ------------------------------------------------------------------------ */

  const optionalBooleanFields = [
    'acceptanceRequiredBeforeUse',
    'acceptanceRequiredBeforeTransaction',
    'acceptanceVersionLock',
    'searchable',
    'printable',
    'downloadable',
    'legalReviewRequired',
    'regulatoryReviewRequired',
    'securityReviewRequired',
    'privacyReviewRequired',
  ];

  optionalBooleanFields.forEach(
    (field) => {
      if (
        document[field] !== undefined &&
        typeof document[field] !== 'boolean'
      ) {
        addError(
          errors,
          `${context} field "${field}" must be a boolean when provided.`
        );
      }
    }
  );

  /* ==========================================================================
   * SEMANTIC VALIDATION
   * ======================================================================== */

  /* --------------------------------------------------------------------------
   * Acceptance scope
   * ------------------------------------------------------------------------ */

  if (
    document.requiresAcceptance === true &&
    !document.acceptanceScope
  ) {
    addError(
      errors,
      `${context} requires acceptance but does not define acceptanceScope.`
    );
  }

  if (
    document.requiresAcceptance !== true &&
    document.acceptanceScope
  ) {
    addWarning(
      warnings,
      `${context} defines acceptanceScope although requiresAcceptance is false.`
    );
  }

  /* --------------------------------------------------------------------------
   * Transaction acceptance
   * ------------------------------------------------------------------------ */

  if (
    document.acceptanceRequiredBeforeTransaction ===
      true
  ) {
    if (
      document.requiresAcceptance !== true
    ) {
      addError(
        errors,
        `${context} requires acceptance before transaction but requiresAcceptance is false.`
      );
    }

    if (
      document.acceptanceScope !==
        'transaction'
    ) {
      addError(
        errors,
        `${context} requires transaction acceptance but acceptanceScope is not "transaction".`
      );
    }
  }

  /* --------------------------------------------------------------------------
   * Acceptance before use
   * ------------------------------------------------------------------------ */

  if (
    document.acceptanceRequiredBeforeUse ===
      true &&
    document.requiresAcceptance !== true
  ) {
    addError(
      errors,
      `${context} requires acceptance before use but requiresAcceptance is false.`
    );
  }

  /* --------------------------------------------------------------------------
   * Published documents
   * ------------------------------------------------------------------------ */

  if (
    document.status === 'published'
  ) {
    if (
      !isNonEmptyString(
        document.effectiveDate
      )
    ) {
      addError(
        errors,
        `${context} is published but has no effectiveDate.`
      );
    }

    if (
      document.public !== true &&
      document.audience.includes('public')
    ) {
      addWarning(
        warnings,
        `${context} has public audience but public visibility is false.`
      );
    }
  }

  /* --------------------------------------------------------------------------
   * Scheduled documents
   * ------------------------------------------------------------------------ */

  if (
    document.status === 'scheduled'
  ) {
    if (
      !document.scheduledAt &&
      !document.effectiveDate
    ) {
      addError(
        errors,
        `${context} is scheduled but has neither scheduledAt nor effectiveDate.`
      );
    }
  }

  /* --------------------------------------------------------------------------
   * Retired documents
   * ------------------------------------------------------------------------ */

  if (
    document.status === 'retired' &&
    !document.retiredAt
  ) {
    addWarning(
      warnings,
      `${context} is retired but has no retiredAt timestamp.`
    );
  }

  /* --------------------------------------------------------------------------
   * Superseded documents
   * ------------------------------------------------------------------------ */

  if (
    document.status === 'superseded' &&
    !document.supersededBy
  ) {
    addWarning(
      warnings,
      `${context} is superseded but has no supersededBy reference.`
    );
  }

  /* --------------------------------------------------------------------------
   * Approval metadata
   * ------------------------------------------------------------------------ */

  if (
    document.status === 'approved' ||
    document.status === 'published'
  ) {
    if (
      !document.approvedBy
    ) {
      addWarning(
        warnings,
        `${context} is approved/published but has no approvedBy metadata.`
      );
    }

    if (
      !document.approvalDate
    ) {
      addWarning(
        warnings,
        `${context} is approved/published but has no approvalDate metadata.`
      );
    }
  }

  /* --------------------------------------------------------------------------
   * Regulatory documents
   * ------------------------------------------------------------------------ */

  if (
    document.category === 'regulatory' &&
    document.regulatoryReviewRequired !==
      true
  ) {
    addWarning(
      warnings,
      `${context} is categorized as regulatory but regulatoryReviewRequired is not true.`
    );
  }

  /* --------------------------------------------------------------------------
   * Privacy documents
   * ------------------------------------------------------------------------ */

  if (
    (
      document.category === 'privacy' ||
      document.category === 'data-protection'
    ) &&
    document.privacyReviewRequired !==
      true
  ) {
    addWarning(
      warnings,
      `${context} concerns privacy/data protection but privacyReviewRequired is not true.`
    );
  }

  /* --------------------------------------------------------------------------
   * Financial documents
   * ------------------------------------------------------------------------ */

  if (
    document.category === 'financial' &&
    document.regulatoryReviewRequired !==
      true
  ) {
    addWarning(
      warnings,
      `${context} is financial but regulatoryReviewRequired is not true.`
    );
  }

  /* --------------------------------------------------------------------------
   * Document self-reference
   * ------------------------------------------------------------------------ */

  if (
    document.supersedes ===
      document.id
  ) {
    addError(
      errors,
      `${context} cannot supersede itself.`
    );
  }

  if (
    document.supersededBy ===
      document.id
  ) {
    addError(
      errors,
      `${context} cannot supersede itself.`
    );
  }

  if (
    Array.isArray(
      document.relatedDocuments
    ) &&
    document.relatedDocuments.includes(
      document.id
    )
  ) {
    addError(
      errors,
      `${context} cannot list itself as a related document.`
    );
  }

  /* --------------------------------------------------------------------------
   * Final result
   * ------------------------------------------------------------------------ */

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    document,
  });
}

/* ============================================================================
 * ASSERTION API
 * ========================================================================== */

/**
 * Assert that a legal document is valid.
 *
 * @param {*} document
 * @returns {object}
 * @throws {TypeError}
 */
export function assertLegalDocument(
  document
) {
  const result =
    validateLegalDocument(
      document
    );

  if (!result.valid) {
    throw new TypeError(
      [
        'Invalid TITech legal document metadata.',
        ...result.errors,
      ].join('\n')
    );
  }

  return document;
}

/* ============================================================================
 * REGISTRY VALIDATION
 * ========================================================================== */

/**
 * Validate an entire legal-document registry.
 *
 * Detects:
 *   - invalid documents
 *   - duplicate IDs
 *   - duplicate slugs
 *   - duplicate frontend routes
 *   - duplicate API paths
 *   - duplicate document references
 *   - broken supersession references
 *   - self references
 *
 * IMPORTANT:
 * This function does NOT throw for ordinary validation failures.
 * It returns a deterministic result suitable for:
 *   - CI/CD
 *   - startup checks
 *   - automated tests
 *   - administration tooling
 *
 * @param {*} documents
 * @returns {{
 *   valid: boolean,
 *   errors: string[],
 *   warnings: string[],
 *   documentCount: number
 * }}
 */
export function validateLegalRegistry(
  documents
) {
  if (!Array.isArray(documents)) {
    return Object.freeze({
      valid: false,
      errors: Object.freeze([
        'TITech legal registry must be an array.',
      ]),
      warnings: Object.freeze([]),
      documentCount: 0,
    });
  }

  const errors = [];
  const warnings = [];

  const ids = new Map();
  const slugs = new Map();
  const routes = new Map();
  const apiPaths = new Map();

  /* --------------------------------------------------------------------------
   * Validate individual documents
   * ------------------------------------------------------------------------ */

  documents.forEach(
    (document, index) => {
      const result =
        validateLegalDocument(
          document
        );

      if (!result.valid) {
        result.errors.forEach(
          (error) => {
            errors.push(
              `Registry entry ${index}: ${error}`
            );
          }
        );
      }

      result.warnings.forEach(
        (warning) => {
          warnings.push(
            `Registry entry ${index}: ${warning}`
          );
        }
      );

      if (
        !isPlainObject(document)
      ) {
        return;
      }

      /* ----------------------------------------------------------------------
       * Duplicate identifiers
       * -------------------------------------------------------------------- */

      const uniqueFields = [
        ['id', ids],
        ['slug', slugs],
        ['route', routes],
        ['apiPath', apiPaths],
      ];

      uniqueFields.forEach(
        ([field, collection]) => {
          const value =
            document[field];

          if (
            !isNonEmptyString(value)
          ) {
            return;
          }

          if (
            collection.has(value)
          ) {
            errors.push(
              `Duplicate TITech legal document ${field}: "${value}".`
            );
          } else {
            collection.set(
              value,
              index
            );
          }
        }
      );
    }
  );

  /* --------------------------------------------------------------------------
   * Cross-document references
   * ------------------------------------------------------------------------ */

  documents.forEach(
    (document) => {
      if (!isPlainObject(document)) {
        return;
      }

      const context =
        documentContext(document);

      [
        'supersedes',
        'supersededBy',
      ].forEach(
        (field) => {
          const reference =
            document[field];

          if (
            reference === undefined ||
            reference === null
          ) {
            return;
          }

          if (
            !ids.has(reference)
          ) {
            addError(
              errors,
              `${context} references unknown document "${reference}" in ${field}.`
            );
          }
        }
      );

      if (
        Array.isArray(
          document.relatedDocuments
        )
      ) {
        document.relatedDocuments.forEach(
          (reference) => {
            if (
              !ids.has(reference)
            ) {
              addError(
                errors,
                `${context} references unknown related document "${reference}".`
              );
            }
          }
        );
      }
    }
  );

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    documentCount: documents.length,
  });
}

/* ============================================================================
 * STRICT REGISTRY VALIDATION
 * ========================================================================== */

/**
 * Validate a registry and reject unknown metadata fields.
 *
 * Recommended for:
 *   - CI/CD
 *   - release builds
 *   - production configuration checks
 *
 * @param {*} documents
 * @returns {{
 *   valid: boolean,
 *   errors: string[],
 *   warnings: string[],
 *   documentCount: number
 * }}
 */
export function validateStrictLegalRegistry(
  documents
) {
  const baseResult =
    validateLegalRegistry(
      documents
    );

  const errors =
    [...baseResult.errors];

  const warnings =
    [...baseResult.warnings];

  if (!Array.isArray(documents)) {
    return baseResult;
  }

  const recognized =
    new Set(
      RECOGNIZED_LEGAL_DOCUMENT_FIELDS
    );

  documents.forEach(
    (document, index) => {
      if (!isPlainObject(document)) {
        return;
      }

      Object.keys(document).forEach(
        (field) => {
          if (!recognized.has(field)) {
            errors.push(
              `Registry entry ${index}: unsupported legal metadata field "${field}".`
            );
          }
        }
      );
    }
  );

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    documentCount:
      baseResult.documentCount,
  });
}

/* ============================================================================
 * CONTRACT HELPERS
 * ========================================================================== */

/**
 * Return the required field contract.
 *
 * @returns {ReadonlyArray<string>}
 */
export function getRequiredLegalDocumentFields() {
  return REQUIRED_LEGAL_DOCUMENT_FIELDS;
}

/**
 * Return all recognized fields.
 *
 * @returns {ReadonlyArray<string>}
 */
export function getRecognizedLegalDocumentFields() {
  return RECOGNIZED_LEGAL_DOCUMENT_FIELDS;
}

/**
 * Determine whether a document contains only recognized metadata.
 *
 * @param {*} document
 * @returns {boolean}
 */
export function hasRecognizedLegalMetadata(
  document
) {
  if (!isPlainObject(document)) {
    return false;
  }

  const recognized =
    new Set(
      RECOGNIZED_LEGAL_DOCUMENT_FIELDS
    );

  return Object.keys(document).every(
    (field) =>
      recognized.has(field)
  );
}

/**
 * Assert recognized metadata.
 *
 * @param {*} document
 * @returns {object}
 * @throws {TypeError}
 */
export function assertRecognizedLegalMetadata(
  document
) {
  assertLegalDocument(
    document
  );

  const recognized =
    new Set(
      RECOGNIZED_LEGAL_DOCUMENT_FIELDS
    );

  const unknownFields =
    Object.keys(document).filter(
      (field) =>
        !recognized.has(field)
    );

  if (
    unknownFields.length > 0
  ) {
    throw new TypeError(
      `${documentContext(document)} contains unsupported metadata fields: ` +
      unknownFields.join(', ')
    );
  }

  return document;
}

/* ============================================================================
 * VERSION HELPERS
 * ========================================================================== */

/**
 * Determine whether a legal version is valid.
 *
 * @param {*} version
 * @returns {boolean}
 */
export function isValidLegalVersion(
  version
) {
  return (
    isNonEmptyString(version) &&
    LEGAL_VERSION_PATTERN.test(
      version.trim()
    )
  );
}

/**
 * Normalize a legal version.
 *
 * @param {*} version
 * @returns {string|null}
 */
export function normalizeLegalVersion(
  version
) {
  if (
    version === undefined ||
    version === null
  ) {
    return null;
  }

  const normalized =
    String(version).trim();

  return normalized || null;
}

/* ============================================================================
 * DATE HELPERS
 * ========================================================================== */

/**
 * Determine whether a value is a valid legal date.
 *
 * @param {*} date
 * @returns {boolean}
 */
export function isValidLegalDate(
  date
) {
  return isValidIsoDate(date);
}

/**
 * Determine whether a value is a valid legal timestamp.
 *
 * @param {*} dateTime
 * @returns {boolean}
 */
export function isValidLegalDateTime(
  dateTime
) {
  return isValidIsoDateTime(
    dateTime
  );
}

/* ============================================================================
 * DEFAULT EXPORT
 * ========================================================================== */

export default Object.freeze({
  LEGAL_STATUS_VALUES,
  LEGAL_CATEGORY_VALUES,
  LEGAL_AUDIENCE_VALUES,
  LEGAL_ACCEPTANCE_SCOPE_VALUES,
  LEGAL_CONTENT_SOURCE_VALUES,
  LEGAL_PRIORITY_VALUES,
  LEGAL_JURISDICTION_VALUES,

  REQUIRED_LEGAL_DOCUMENT_FIELDS,
  REQUIRED_LEGAL_DOCUMENT_STRING_FIELDS,
  REQUIRED_LEGAL_DOCUMENT_BOOLEAN_FIELDS,

  OPTIONAL_LEGAL_DOCUMENT_FIELDS,
  RECOGNIZED_LEGAL_DOCUMENT_FIELDS,

  LEGAL_VERSION_PATTERN,
  LEGAL_ID_PATTERN,
  LEGAL_SLUG_PATTERN,
  LEGAL_ROUTE_PATTERN,
  LEGAL_API_PATH_PATTERN,
  LEGAL_SHA256_PATTERN,
  LEGAL_LANGUAGE_PATTERN,

  isValidLegalDocument,
  validateLegalDocument,
  assertLegalDocument,

  validateLegalRegistry,
  validateStrictLegalRegistry,

  normalizeLegalDocument,
  normalizeLegalVersion,

  isValidLegalVersion,
  isValidLegalDate,
  isValidLegalDateTime,

  getRequiredLegalDocumentFields,
  getRecognizedLegalDocumentFields,

  hasRecognizedLegalMetadata,
  assertRecognizedLegalMetadata,
});