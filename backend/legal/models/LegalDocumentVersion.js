/**
* ============================================================================
* TITech Community Capital Ltd
* Enterprise Legal Document Version Domain Model
* ============================================================================
*
* File:
* backend/legal/models/LegalDocumentVersion.js
*
* Version:
* 2.0.0
*
* Purpose:
* Canonical backend domain model representing an immutable version of a
* TITech Community Capital legal document.
*
* Responsibilities:
* ✓ Immutable legal-document version metadata
* ✓ Version lineage and parent-document relationships
* ✓ Content integrity metadata
* ✓ Publication/effective/expiry lifecycle
* ✓ Approval and review metadata
* ✓ Acceptance compatibility metadata
* ✓ Jurisdiction and tenant scope
* ✓ Content-addressable integrity support
* ✓ Version comparison
* ✓ Runtime validation
* ✓ Persistence-safe serialization
* ✓ Sanitized public serialization
* ✓ Legal-document audit compatibility
*
* Non-responsibilities:
* ✗ Database persistence
* ✗ MongoDB/Mongoose schema definitions
* ✗ User authentication
* ✗ Authorization
* ✗ Recording legal acceptance
* ✗ Writing audit events
* ✗ Cryptographic signing
* ✗ Legal interpretation
*
* Architectural rule:
*
* Once a LegalDocumentVersion is published, its substantive content and
* compliance-critical metadata MUST be treated as immutable.
*
* Corrections should create a NEW version rather than mutating an existing
* published version.
*
* Relationship:
*
* LegalDocument
* ```
     │
  ```
* ```
     ├── LegalDocumentVersion
  ```
* ```
     │       ├── LegalAcceptance
  ```
* ```
     │       └── LegalAuditEvent
  ```
* ```
     │
  ```
* ```
     └── Legal Registry
  ```
*
* IMPORTANT:
* This model does not establish that TITech Community Capital Ltd is
* licensed, regulated, authorized, or legally permitted to provide any
* particular financial service.
*
* BRAND:
* TITech Community Capital
*
* LEGACY TERMINOLOGY:
* ACFOS must not be used in this module.
*
* ============================================================================
  */

'use strict';

/* ============================================================================

* CONSTANTS
* ========================================================================== */

/**

* Domain model version.
  */
  const LEGAL_DOCUMENT_VERSION_MODEL_VERSION =
  '2.0.0';

/**

* Persistence schema version.
  */
  const LEGAL_DOCUMENT_VERSION_SCHEMA_VERSION =
  1;

/**

* Version lifecycle states.
  */
  const LEGAL_DOCUMENT_VERSION_STATUS =
  Object.freeze({
  DRAFT: 'draft',
  IN_REVIEW: 'in_review',
  APPROVED: 'approved',
  SCHEDULED: 'scheduled',
  PUBLISHED: 'published',
  EXPIRED: 'expired',
  SUPERSEDED: 'superseded',
  ARCHIVED: 'archived',
  RETIRED: 'retired',
  });

/**

* Approval states.
  */
  const LEGAL_DOCUMENT_VERSION_APPROVAL_STATUS =
  Object.freeze({
  NOT_REQUIRED: 'not_required',
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  });

/**

* Publication states.
  */
  const LEGAL_DOCUMENT_VERSION_PUBLICATION_STATUS =
  Object.freeze({
  UNPUBLISHED: 'unpublished',
  SCHEDULED: 'scheduled',
  PUBLISHED: 'published',
  EXPIRED: 'expired',
  });

/**

* Version change classifications.
  */
  const LEGAL_DOCUMENT_VERSION_CHANGE_TYPE =
  Object.freeze({
  INITIAL: 'initial',
  REVISION: 'revision',
  CORRECTION: 'correction',
  AMENDMENT: 'amendment',
  REGULATORY_UPDATE: 'regulatory_update',
  POLICY_UPDATE: 'policy_update',
  MIGRATION: 'migration',
  TRANSLATION: 'translation',
  RESTORATION: 'restoration',
  });

/**

* Supported legal content formats.
  */
  const LEGAL_DOCUMENT_VERSION_CONTENT_TYPE =
  Object.freeze({
  HTML: 'html',
  MARKDOWN: 'markdown',
  TEXT: 'text',
  PDF: 'pdf',
  RICH_TEXT: 'rich_text',
  });

/**

* Document source systems.
  */
  const LEGAL_DOCUMENT_VERSION_SOURCE =
  Object.freeze({
  PLATFORM: 'platform',
  ADMIN: 'admin',
  CMS: 'cms',
  API: 'api',
  IMPORT: 'import',
  SYSTEM: 'system',
  });

/**

* Visibility levels.
  */
  const LEGAL_DOCUMENT_VERSION_VISIBILITY =
  Object.freeze({
  PUBLIC: 'public',
  AUTHENTICATED: 'authenticated',
  TENANT: 'tenant',
  INTERNAL: 'internal',
  });

/**

* Intended audience.
  */
  const LEGAL_DOCUMENT_VERSION_AUDIENCE =
  Object.freeze({
  PUBLIC: 'public',
  MEMBER: 'member',
  CUSTOMER: 'customer',
  TENANT_ADMIN: 'tenant_admin',
  STAFF: 'staff',
  PARTNER: 'partner',
  REGULATOR: 'regulator',
  INTERNAL: 'internal',
  });

/**

* Maximum field lengths.
  */
  const FIELD_LIMITS =
  Object.freeze({
  id: 128,
  documentId: 128,
  slug: 256,

  title: 512,
  shortTitle: 256,
  description: 4096,

  version: 128,
  versionLabel: 256,

  language: 32,
  countryCode: 8,
  jurisdiction: 256,

  contentType: 64,
  source: 64,

  contentHash: 256,
  documentHash: 256,
  previousVersionHash: 256,

  tenantId: 128,
  organizationId: 128,

  parentVersionId: 128,
  previousVersionId: 128,
  nextVersionId: 128,

  authorId: 128,
  authorName: 256,

  reviewerId: 128,
  reviewerName: 256,

  approverId: 128,
  approverName: 256,

  changeSummary: 4096,
  rejectionReason: 4096,

  canonicalUrl: 2048,
  publicPath: 1024,

  legalContactEmail: 320,
  legalContactPhone: 64,
  });

/**

* Required fields.
  */
  const REQUIRED_FIELDS =
  Object.freeze([
  'id',
  'documentId',
  'slug',
  'title',
  'version',
  'status',
  ]);

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

* Normalize a string.
*
* @param {*} value
* @param {number} maxLength
* @returns {string|undefined}
  */
  function normalizeString(
  value,
  maxLength
  ) {
  if (
  !isNonEmptyString(value)
  ) {
  return undefined;
  }

const normalized =
value.trim();

return Number.isInteger(
maxLength
)
? normalized.slice(
0,
maxLength
)
: normalized;
}

/**

* Normalize an ISO timestamp.
*
* @param {*} value
* @returns {string|undefined}
  */
  function normalizeDate(value) {
  if (
  value === undefined ||
  value === null ||
  value === ''
  ) {
  return undefined;
  }

const date =
value instanceof Date
? value
: new Date(value);

if (
Number.isNaN(
date.getTime()
)
) {
return undefined;
}

return date.toISOString();
}

/**

* Normalize boolean.
*
* @param {*} value
* @param {boolean} fallback
* @returns {boolean}
  */
  function normalizeBoolean(
  value,
  fallback = false
  ) {
  return typeof value === 'boolean'
  ? value
  : fallback;
  }

/**

* Normalize integer.
*
* @param {*} value
* @param {number|undefined} fallback
* @returns {number|undefined}
  */
  function normalizeInteger(
  value,
  fallback
  ) {
  if (
  Number.isInteger(value)
  ) {
  return value;
  }

if (
typeof value === 'string' &&
value.trim() !== ''
) {
const parsed =
Number(value);


if (
  Number.isInteger(parsed)
) {
  return parsed;
}

}

return fallback;
}

/**

* Normalize string arrays.
*
* @param {*} value
* @param {number} maxLength
* @returns {string[]}
  */
  function normalizeStringArray(
  value,
  maxLength = 256
  ) {
  if (!Array.isArray(value)) {
  return [];
  }

return value
.filter(isNonEmptyString)
.map((item) =>
normalizeString(
item,
maxLength
)
)
.filter(Boolean);
}

/**

* Determine whether a value is a valid enum member.
*
* @param {*} value
* @param {Object} enumeration
* @returns {boolean}
  */
  function isEnumValue(
  value,
  enumeration
  ) {
  return Object.values(
  enumeration
  ).includes(value);
  }

/**

* Convert supported persistence objects to plain objects.
*
* @param {*} value
* @returns {Object}
  */
  function toPlainObject(value) {
  if (
  !value ||
  typeof value !== 'object'
  ) {
  return {};
  }

if (
typeof value.toObject ===
'function'
) {
return value.toObject();
}

if (
typeof value.toJSON ===
'function'
) {
return value.toJSON();
}

return {
...value,
};
}

/**

* Create a structured validation error.
*
* @param {string} message
* @param {string[]} errors
* @returns {Error}
  */
  function createValidationError(
  message,
  errors = []
  ) {
  const error =
  new Error(message);

error.name =
'LegalDocumentVersionValidationError';

error.code =
'LEGAL_DOCUMENT_VERSION_VALIDATION_ERROR';

error.errors =
Object.freeze([
...errors,
]);

return error;
}

/* ============================================================================

* LEGAL DOCUMENT VERSION
* ========================================================================== */

class LegalDocumentVersion {
/**

* Construct a legal-document version.
*
* @param {Object} input
  */
  constructor(input = {}) {
  if (
  !input ||
  typeof input !== 'object'
  ) {
  throw new TypeError(
  'LegalDocumentVersion requires an object.'
  );
  }


this.schemaVersion =



  normalizeInteger(
    input.schemaVersion,
    LEGAL_DOCUMENT_VERSION_SCHEMA_VERSION
  );

this.modelVersion =
  normalizeString(
    input.modelVersion,
    64
  ) ||
  LEGAL_DOCUMENT_VERSION_MODEL_VERSION;

/*
 * ------------------------------------------------------------------------
 * Identity
 * ------------------------------------------------------------------------
 */

this.id =
  normalizeString(
    input.id,
    FIELD_LIMITS.id
  );

this.documentId =
  normalizeString(
    input.documentId,
    FIELD_LIMITS.documentId
  );

this.slug =
  normalizeString(
    input.slug,
    FIELD_LIMITS.slug
  );

this.title =
  normalizeString(
    input.title,
    FIELD_LIMITS.title
  );

this.shortTitle =
  normalizeString(
    input.shortTitle,
    FIELD_LIMITS.shortTitle
  ) ||
  this.title;

this.description =
  normalizeString(
    input.description,
    FIELD_LIMITS.description
  );

/*
 * ------------------------------------------------------------------------
 * Version identity
 * ------------------------------------------------------------------------
 */

this.version =
  normalizeString(
    input.version,
    FIELD_LIMITS.version
  );

this.versionLabel =
  normalizeString(
    input.versionLabel,
    FIELD_LIMITS.versionLabel
  );

this.versionNumber =
  normalizeInteger(
    input.versionNumber,
    undefined
  );

this.majorVersion =
  normalizeInteger(
    input.majorVersion,
    undefined
  );

this.minorVersion =
  normalizeInteger(
    input.minorVersion,
    undefined
  );

this.patchVersion =
  normalizeInteger(
    input.patchVersion,
    undefined
  );

/*
 * ------------------------------------------------------------------------
 * Version lineage
 * ------------------------------------------------------------------------
 */

this.parentVersionId =
  normalizeString(
    input.parentVersionId,
    FIELD_LIMITS.parentVersionId
  );

this.previousVersionId =
  normalizeString(
    input.previousVersionId,
    FIELD_LIMITS.previousVersionId
  );

this.nextVersionId =
  normalizeString(
    input.nextVersionId,
    FIELD_LIMITS.nextVersionId
  );

this.rootVersionId =
  normalizeString(
    input.rootVersionId,
    FIELD_LIMITS.id
  ) ||
  this.id;

this.supersedesVersionId =
  normalizeString(
    input.supersedesVersionId,
    FIELD_LIMITS.id
  );

this.supersededByVersionId =
  normalizeString(
    input.supersededByVersionId,
    FIELD_LIMITS.id
  );

/*
 * ------------------------------------------------------------------------
 * Lifecycle
 * ------------------------------------------------------------------------
 */

this.status =
  normalizeString(
    input.status,
    64
  ) ||
  LEGAL_DOCUMENT_VERSION_STATUS.DRAFT;

this.approvalStatus =
  normalizeString(
    input.approvalStatus,
    64
  ) ||
  LEGAL_DOCUMENT_VERSION_APPROVAL_STATUS.NOT_REQUIRED;

this.publicationStatus =
  normalizeString(
    input.publicationStatus,
    64
  ) ||
  LEGAL_DOCUMENT_VERSION_PUBLICATION_STATUS.UNPUBLISHED;

this.changeType =
  normalizeString(
    input.changeType,
    64
  ) ||
  LEGAL_DOCUMENT_VERSION_CHANGE_TYPE.INITIAL;

/*
 * ------------------------------------------------------------------------
 * Classification
 * ------------------------------------------------------------------------
 */

this.audience =
  normalizeString(
    input.audience,
    64
  ) ||
  LEGAL_DOCUMENT_VERSION_AUDIENCE.PUBLIC;

this.visibility =
  normalizeString(
    input.visibility,
    64
  ) ||
  LEGAL_DOCUMENT_VERSION_VISIBILITY.PUBLIC;

this.contentType =
  normalizeString(
    input.contentType,
    FIELD_LIMITS.contentType
  ) ||
  LEGAL_DOCUMENT_VERSION_CONTENT_TYPE.HTML;

this.source =
  normalizeString(
    input.source,
    FIELD_LIMITS.source
  ) ||
  LEGAL_DOCUMENT_VERSION_SOURCE.PLATFORM;

/*
 * ------------------------------------------------------------------------
 * Acceptance / consent compatibility
 * ------------------------------------------------------------------------
 */

this.acceptanceRequired =
  normalizeBoolean(
    input.acceptanceRequired,
    false
  );

this.acceptanceRequiredForRegistration =
  normalizeBoolean(
    input.acceptanceRequiredForRegistration,
    false
  );

this.acceptanceRequiredForUse =
  normalizeBoolean(
    input.acceptanceRequiredForUse,
    false
  );

this.requiresExplicitConsent =
  normalizeBoolean(
    input.requiresExplicitConsent,
    false
  );

/*
 * ------------------------------------------------------------------------
 * Jurisdiction
 * ------------------------------------------------------------------------
 */

this.jurisdiction =
  normalizeString(
    input.jurisdiction,
    FIELD_LIMITS.jurisdiction
  ) ||
  'Uganda';

this.countryCode =
  normalizeString(
    input.countryCode,
    FIELD_LIMITS.countryCode
  ) ||
  'UG';

this.language =
  normalizeString(
    input.language,
    FIELD_LIMITS.language
  ) ||
  'en';

this.applicableCountries =
  normalizeStringArray(
    input.applicableCountries,
    8
  );

this.applicableRegions =
  normalizeStringArray(
    input.applicableRegions,
    256
  );

/*
 * ------------------------------------------------------------------------
 * Tenant scope
 * ------------------------------------------------------------------------
 */

this.tenantId =
  normalizeString(
    input.tenantId,
    FIELD_LIMITS.tenantId
  );

this.organizationId =
  normalizeString(
    input.organizationId,
    FIELD_LIMITS.organizationId
  );

this.isGlobal =
  normalizeBoolean(
    input.isGlobal,
    !this.tenantId
  );

/*
 * ------------------------------------------------------------------------
 * Content
 * ------------------------------------------------------------------------
 */

this.content =
  typeof input.content === 'string'
    ? input.content
    : undefined;

this.contentHash =
  normalizeString(
    input.contentHash,
    FIELD_LIMITS.contentHash
  );

this.documentHash =
  normalizeString(
    input.documentHash,
    FIELD_LIMITS.documentHash
  );

this.previousVersionHash =
  normalizeString(
    input.previousVersionHash,
    FIELD_LIMITS.previousVersionHash
  );

this.contentLength =
  normalizeInteger(
    input.contentLength,
    this.content
      ? this.content.length
      : undefined
  );

/*
 * ------------------------------------------------------------------------
 * Dates
 * ------------------------------------------------------------------------
 */

this.effectiveDate =
  normalizeDate(
    input.effectiveDate
  );

this.publicationDate =
  normalizeDate(
    input.publicationDate
  );

this.expiryDate =
  normalizeDate(
    input.expiryDate
  );

this.reviewDueDate =
  normalizeDate(
    input.reviewDueDate
  );

/*
 * ------------------------------------------------------------------------
 * Workflow actors
 * ------------------------------------------------------------------------
 */

this.authorId =
  normalizeString(
    input.authorId,
    FIELD_LIMITS.authorId
  );

this.authorName =
  normalizeString(
    input.authorName,
    FIELD_LIMITS.authorName
  );

this.reviewerId =
  normalizeString(
    input.reviewerId,
    FIELD_LIMITS.reviewerId
  );

this.reviewerName =
  normalizeString(
    input.reviewerName,
    FIELD_LIMITS.reviewerName
  );

this.approverId =
  normalizeString(
    input.approverId,
    FIELD_LIMITS.approverId
  );

this.approverName =
  normalizeString(
    input.approverName,
    FIELD_LIMITS.approverName
  );

/*
 * ------------------------------------------------------------------------
 * Publication links
 * ------------------------------------------------------------------------
 */

this.canonicalUrl =
  normalizeString(
    input.canonicalUrl,
    FIELD_LIMITS.canonicalUrl
  );

this.publicPath =
  normalizeString(
    input.publicPath,
    FIELD_LIMITS.publicPath
  );

/*
 * ------------------------------------------------------------------------
 * Legal contact
 * ------------------------------------------------------------------------
 */

this.legalContactEmail =
  normalizeString(
    input.legalContactEmail,
    FIELD_LIMITS.legalContactEmail
  );

this.legalContactPhone =
  normalizeString(
    input.legalContactPhone,
    FIELD_LIMITS.legalContactPhone
  );

/*
 * ------------------------------------------------------------------------
 * Change management
 * ------------------------------------------------------------------------
 */

this.changeSummary =
  normalizeString(
    input.changeSummary,
    FIELD_LIMITS.changeSummary
  );

this.rejectionReason =
  normalizeString(
    input.rejectionReason,
    FIELD_LIMITS.rejectionReason
  );

/*
 * ------------------------------------------------------------------------
 * Immutability / integrity
 * ------------------------------------------------------------------------
 */

this.isImmutable =
  normalizeBoolean(
    input.isImmutable,
    this.status ===
      LEGAL_DOCUMENT_VERSION_STATUS.PUBLISHED
  );

this.integrityVerified =
  normalizeBoolean(
    input.integrityVerified,
    false
  );

this.signatureVerified =
  normalizeBoolean(
    input.signatureVerified,
    false
  );

/*
 * ------------------------------------------------------------------------
 * Timestamps
 * ------------------------------------------------------------------------
 */

this.createdAt =
  normalizeDate(
    input.createdAt
  );

this.updatedAt =
  normalizeDate(
    input.updatedAt
  );

this.approvedAt =
  normalizeDate(
    input.approvedAt
  );

this.publishedAt =
  normalizeDate(
    input.publishedAt
  );

this.expiredAt =
  normalizeDate(
    input.expiredAt
  );

this.supersededAt =
  normalizeDate(
    input.supersededAt
  );

this.archivedAt =
  normalizeDate(
    input.archivedAt
  );

/*
 * ------------------------------------------------------------------------
 * Extensible metadata
 * ------------------------------------------------------------------------
 */

this.metadata =
  input.metadata &&
  typeof input.metadata === 'object'
    ? {
        ...input.metadata,
      }
    : {};


}

/* ==========================================================================

* FACTORIES
* ======================================================================== */

/**

* Create an initial version.
*
* @param {Object} input
* @returns {LegalDocumentVersion}
  */
  static createInitial(
  input = {}
  ) {
  return new LegalDocumentVersion({
  ...input,

  changeType:
  input.changeType ||
  LEGAL_DOCUMENT_VERSION_CHANGE_TYPE.INITIAL,

  status:
  input.status ||
  LEGAL_DOCUMENT_VERSION_STATUS.DRAFT,

  approvalStatus:
  input.approvalStatus ||
  LEGAL_DOCUMENT_VERSION_APPROVAL_STATUS.PENDING,

  publicationStatus:
  input.publicationStatus ||
  LEGAL_DOCUMENT_VERSION_PUBLICATION_STATUS.UNPUBLISHED,
  });
  }

/**

* Create a new revision from an existing version.
*
* The new version starts as a draft and does not inherit publication state.
*
* @param {LegalDocumentVersion|Object} source
* @param {Object} changes
* @returns {LegalDocumentVersion}
  */
  static createRevision(
  source,
  changes = {}
  ) {
  const previous =
  source instanceof LegalDocumentVersion
  ? source
  : new LegalDocumentVersion(
  source
  );


return new LegalDocumentVersion({



  ...previous.toPersistenceObject(),

  ...changes,

  id:
    changes.id,

  version:
    changes.version,

  versionNumber:
    changes.versionNumber,

  status:
    LEGAL_DOCUMENT_VERSION_STATUS.DRAFT,

  approvalStatus:
    LEGAL_DOCUMENT_VERSION_APPROVAL_STATUS.PENDING,

  publicationStatus:
    LEGAL_DOCUMENT_VERSION_PUBLICATION_STATUS.UNPUBLISHED,

  publicationDate:
    undefined,

  publishedAt:
    undefined,

  approvedAt:
    undefined,

  expiredAt:
    undefined,

  supersededAt:
    undefined,

  archivedAt:
    undefined,

  previousVersionId:
    changes.previousVersionId ||
    previous.id,

  parentVersionId:
    changes.parentVersionId ||
    previous.parentVersionId ||
    previous.id,

  rootVersionId:
    changes.rootVersionId ||
    previous.rootVersionId ||
    previous.id,

  previousVersionHash:
    previous.documentHash ||
    previous.contentHash,

  isImmutable:
    false,

  integrityVerified:
    false,

  signatureVerified:
    false,

  changeType:
    changes.changeType ||
    LEGAL_DOCUMENT_VERSION_CHANGE_TYPE.REVISION,
});


}

/**

* Hydrate a persisted version.
*
* @param {Object} input
* @returns {LegalDocumentVersion}
  */
  static fromJSON(input) {
  return new LegalDocumentVersion(
  toPlainObject(input)
  );
  }

/* ==========================================================================

* IMMUTABILITY
* ======================================================================== */

/**

* Determine whether the version is considered immutable.
*
* @returns {boolean}
  */
  isEffectivelyImmutable() {
  return (
  this.isImmutable ||
  this.status ===
  LEGAL_DOCUMENT_VERSION_STATUS.PUBLISHED ||
  this.status ===
  LEGAL_DOCUMENT_VERSION_STATUS.SUPERSEDED ||
  this.status ===
  LEGAL_DOCUMENT_VERSION_STATUS.EXPIRED ||
  this.status ===
  LEGAL_DOCUMENT_VERSION_STATUS.ARCHIVED ||
  this.status ===
  LEGAL_DOCUMENT_VERSION_STATUS.RETIRED
  );
  }

/**

* Determine whether this version may be edited.
*
* @returns {boolean}
  */
  canBeEdited() {
  return !this.isEffectivelyImmutable();
  }

/**

* Assert that the version is mutable.
*
* @returns {LegalDocumentVersion}
  */
  assertMutable() {
  if (
  this.isEffectivelyImmutable()
  ) {
  throw createValidationError(
  'Published or otherwise finalized legal-document versions are immutable.',
  [
  'Create a new LegalDocumentVersion instead of modifying this version.',
  ]
  );
  }


return this;


}

/* ==========================================================================

* PUBLICATION STATE
* ======================================================================== */

/**

* Determine whether this version is currently published.
*
* @param {Date|string} at
* @returns {boolean}
  */
  isPublished(
  at = new Date()
  ) {
  if (
  this.status !==
  LEGAL_DOCUMENT_VERSION_STATUS.PUBLISHED ||
  this.publicationStatus !==
  LEGAL_DOCUMENT_VERSION_PUBLICATION_STATUS.PUBLISHED
  ) {
  return false;
  }


const timestamp =



  new Date(at);

if (
  Number.isNaN(
    timestamp.getTime()
  )
) {
  return false;
}

if (this.effectiveDate) {
  const effective =
    new Date(
      this.effectiveDate
    );

  if (
    timestamp < effective
  ) {
    return false;
  }
}

if (this.expiryDate) {
  const expiry =
    new Date(
      this.expiryDate
    );

  if (
    timestamp >= expiry
  ) {
    return false;
  }
}

return true;


}

/**

* Determine whether the version is publicly accessible.
*
* @param {Date|string} at
* @returns {boolean}
  */
  isPubliclyAccessible(
  at = new Date()
  ) {
  return (
  this.isPublished(at) &&
  this.visibility ===
  LEGAL_DOCUMENT_VERSION_VISIBILITY.PUBLIC
  );
  }

/**

* Determine whether the version has expired.
*
* @param {Date|string} at
* @returns {boolean}
  */
  isExpired(
  at = new Date()
  ) {
  if (!this.expiryDate) {
  return false;
  }


const timestamp =



  new Date(at);

const expiry =
  new Date(
    this.expiryDate
  );

if (
  Number.isNaN(
    timestamp.getTime()
  ) ||
  Number.isNaN(
    expiry.getTime()
  )
) {
  return false;
}

return timestamp >= expiry;


}

/**

* Determine whether this version requires acceptance.
*
* @returns {boolean}
  */
  requiresAcceptance() {
  return Boolean(
  this.acceptanceRequired ||
  this.acceptanceRequiredForRegistration ||
  this.acceptanceRequiredForUse ||
  this.requiresExplicitConsent
  );
  }

/**

* Determine whether this version may receive a new acceptance.
*
* @param {Date|string} at
* @returns {boolean}
  */
  canReceiveAcceptance(
  at = new Date()
  ) {
  return (
  this.requiresAcceptance() &&
  this.isPublished(at) &&
  !this.isExpired(at) &&
  !this.isSuperseded()
  );
  }

/**

* Determine whether this version has been superseded.
*
* @returns {boolean}
  */
  isSuperseded() {
  return (
  this.status ===
  LEGAL_DOCUMENT_VERSION_STATUS.SUPERSEDED ||
  Boolean(
  this.supersededByVersionId
  )
  );
  }

/* ==========================================================================

* TENANCY / JURISDICTION
* ======================================================================== */

/**

* Determine whether the version applies to a country.
*
* @param {string} countryCode
* @returns {boolean}
  */
  appliesToCountry(
  countryCode
  ) {
  if (
  !isNonEmptyString(
  countryCode
  )
  ) {
  return false;
  }


const normalized =



  countryCode
    .trim()
    .toUpperCase();

if (
  this.applicableCountries.length ===
  0
) {
  return (
    this.countryCode.toUpperCase() ===
    normalized
  );
}

return this.applicableCountries
  .map((country) =>
    country.toUpperCase()
  )
  .includes(normalized);


}

/**

* Determine whether the version applies to a tenant.
*
* @param {string} tenantId
* @returns {boolean}
  */
  belongsToTenant(
  tenantId
  ) {
  if (
  !isNonEmptyString(
  tenantId
  )
  ) {
  return false;
  }


if (this.isGlobal) {



  return true;
}

return (
  this.tenantId ===
  tenantId.trim()
);


}

/* ==========================================================================

* VERSION COMPARISON
* ======================================================================== */

/**

* Parse a semantic-style version.
*
* @param {string} value
* @returns {number[]|null}
  */
  static parseVersion(
  value
  ) {
  if (
  !isNonEmptyString(
  value
  )
  ) {
  return null;
  }


const match =



  value
    .trim()
    .replace(/^v/i, '')
    .match(
      /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/
    );

if (!match) {
  return null;
}

return [
  Number(match[1]),
  Number(match[2] || 0),
  Number(match[3] || 0),
];


}

/**

* Determine whether this version is newer than another.
*
* @param {LegalDocumentVersion|Object} other
* @returns {boolean}
  */
  isNewerThan(other) {
  if (!other) {
  return false;
  }


const current =



  LegalDocumentVersion.parseVersion(
    this.version
  );

const previous =
  LegalDocumentVersion.parseVersion(
    other.version
  );

if (
  current &&
  previous
) {
  for (
    let index = 0;
    index < 3;
    index += 1
  ) {
    if (
      current[index] >
      previous[index]
    ) {
      return true;
    }

    if (
      current[index] <
      previous[index]
    ) {
      return false;
    }
  }

  return false;
}

return (
  String(this.version) >
  String(other.version)
);


}

/**

* Determine whether this is the same version.
*
* @param {LegalDocumentVersion|Object} other
* @returns {boolean}
  */
  isSameVersion(other) {
  if (!other) {
  return false;
  }


return (



  this.documentId ===
    other.documentId &&
  this.version ===
    other.version
);


}

/**

* Determine whether this version belongs to the same document.
*
* @param {LegalDocumentVersion|Object} other
* @returns {boolean}
  */
  belongsToSameDocument(other) {
  return Boolean(
  other &&
  this.documentId ===
  other.documentId
  );
  }

/* ==========================================================================

* INTEGRITY
* ======================================================================== */

/**

* Determine whether an integrity hash is present.
*
* @returns {boolean}
  */
  hasIntegrityHash() {
  return Boolean(
  this.documentHash ||
  this.contentHash
  );
  }

/**

* Determine whether the version has a previous integrity reference.
*
* @returns {boolean}
  */
  hasPreviousIntegrityReference() {
  return Boolean(
  this.previousVersionHash
  );
  }

/**

* Determine whether the version's recorded integrity state is verified.
*
* @returns {boolean}
  */
  isIntegrityVerified() {
  return Boolean(
  this.integrityVerified
  );
  }

/* ==========================================================================

* VALIDATION
* ======================================================================== */

/**

* Validate this version.
*
* @param {Object} options
* @returns {{valid:boolean,errors:string,warnings:string}}
  */
  validate(options = {}) {
  const {
  requireContent = false,
  requireHash = false,
  requireTenant = false,
  requirePublicationMetadata = false,
  enforcePublishedImmutability = true,
  } = options;


const errors = [];



const warnings = [];

/*
 * Required fields.
 */
for (
  const field of REQUIRED_FIELDS
) {
  if (
    !isNonEmptyString(
      this[field]
    )
  ) {
    errors.push(
      `${field} is required.`
    );
  }
}

/*
 * Enum validation.
 */
if (
  !isEnumValue(
    this.status,
    LEGAL_DOCUMENT_VERSION_STATUS
  )
) {
  errors.push(
    `Unsupported version status: ${this.status}.`
  );
}

if (
  !isEnumValue(
    this.approvalStatus,
    LEGAL_DOCUMENT_VERSION_APPROVAL_STATUS
  )
) {
  errors.push(
    `Unsupported approval status: ${this.approvalStatus}.`
  );
}

if (
  !isEnumValue(
    this.publicationStatus,
    LEGAL_DOCUMENT_VERSION_PUBLICATION_STATUS
  )
) {
  errors.push(
    `Unsupported publication status: ${this.publicationStatus}.`
  );
}

if (
  !isEnumValue(
    this.changeType,
    LEGAL_DOCUMENT_VERSION_CHANGE_TYPE
  )
) {
  errors.push(
    `Unsupported change type: ${this.changeType}.`
  );
}

if (
  !isEnumValue(
    this.contentType,
    LEGAL_DOCUMENT_VERSION_CONTENT_TYPE
  )
) {
  errors.push(
    `Unsupported content type: ${this.contentType}.`
  );
}

if (
  !isEnumValue(
    this.source,
    LEGAL_DOCUMENT_VERSION_SOURCE
  )
) {
  errors.push(
    `Unsupported source: ${this.source}.`
  );
}

if (
  !isEnumValue(
    this.visibility,
    LEGAL_DOCUMENT_VERSION_VISIBILITY
  )
) {
  errors.push(
    `Unsupported visibility: ${this.visibility}.`
  );
}

if (
  !isEnumValue(
    this.audience,
    LEGAL_DOCUMENT_VERSION_AUDIENCE
  )
) {
  errors.push(
    `Unsupported audience: ${this.audience}.`
  );
}

/*
 * Content.
 */
if (
  requireContent &&
  !isNonEmptyString(
    this.content
  )
) {
  errors.push(
    'content is required.'
  );
}

/*
 * Hash.
 */
if (
  requireHash &&
  !this.documentHash &&
  !this.contentHash
) {
  errors.push(
    'documentHash or contentHash is required.'
  );
}

/*
 * Tenant.
 */
if (
  requireTenant &&
  !this.isGlobal &&
  !this.tenantId
) {
  errors.push(
    'tenantId is required for a tenant-scoped version.'
  );
}

/*
 * Published-state consistency.
 */
if (
  this.status ===
  LEGAL_DOCUMENT_VERSION_STATUS.PUBLISHED
) {
  if (
    this.approvalStatus !==
      LEGAL_DOCUMENT_VERSION_APPROVAL_STATUS.APPROVED &&
    this.approvalStatus !==
      LEGAL_DOCUMENT_VERSION_APPROVAL_STATUS.NOT_REQUIRED
  ) {
    errors.push(
      'A published version must be approved or explicitly marked as not requiring approval.'
    );
  }

  if (
    this.publicationStatus !==
    LEGAL_DOCUMENT_VERSION_PUBLICATION_STATUS.PUBLISHED
  ) {
    errors.push(
      'A published version must have publicationStatus="published".'
    );
  }

  if (
    !this.publicationDate &&
    !this.publishedAt
  ) {
    if (
      requirePublicationMetadata
    ) {
      errors.push(
        'Published version requires publication metadata.'
      );
    } else {
      warnings.push(
        'Published version has no publication timestamp.'
      );
    }
  }

  if (
    enforcePublishedImmutability &&
    !this.isImmutable
  ) {
    errors.push(
      'Published version must be immutable.'
    );
  }
}

/*
 * Scheduled-state consistency.
 */
if (
  this.status ===
  LEGAL_DOCUMENT_VERSION_STATUS.SCHEDULED
) {
  if (
    !this.effectiveDate
  ) {
    warnings.push(
      'Scheduled version has no effectiveDate.'
    );
  }

  if (
    this.publicationStatus !==
    LEGAL_DOCUMENT_VERSION_PUBLICATION_STATUS.SCHEDULED
  ) {
    errors.push(
      'Scheduled version must have publicationStatus="scheduled".'
    );
  }
}

/*
 * Date consistency.
 */
if (
  this.effectiveDate &&
  this.expiryDate
) {
  const effective =
    new Date(
      this.effectiveDate
    );

  const expiry =
    new Date(
      this.expiryDate
    );

  if (
    effective >= expiry
  ) {
    errors.push(
      'effectiveDate must be earlier than expiryDate.'
    );
  }
}

/*
 * Lineage self-reference.
 */
const lineageFields = [
  'parentVersionId',
  'previousVersionId',
  'nextVersionId',
  'supersedesVersionId',
  'supersededByVersionId',
];

for (
  const field of lineageFields
) {
  if (
    this[field] &&
    this[field] === this.id
  ) {
    errors.push(
      `${field} cannot reference the current version itself.`
    );
  }
}

/*
 * Tenant/global consistency.
 */
if (
  this.isGlobal &&
  this.tenantId
) {
  warnings.push(
    'Global version contains tenantId; verify intended scope.'
  );
}

/*
 * Version number sanity.
 */
const numericVersions = [
  'versionNumber',
  'majorVersion',
  'minorVersion',
  'patchVersion',
];

for (
  const field of numericVersions
) {
  if (
    this[field] !== undefined &&
    this[field] < 0
  ) {
    errors.push(
      `${field} cannot be negative.`
    );
  }
}

return {
  valid:
    errors.length === 0,

  errors,

  warnings,
};


}

/**

* Assert validity.
*
* @param {Object} options
* @returns {LegalDocumentVersion}
  */
  assertValid(options = {}) {
  const result =
  this.validate(options);


if (!result.valid) {



  throw createValidationError(
    'Invalid legal-document version.',
    result.errors
  );
}

return this;


}

/* ==========================================================================

* SERIALIZATION
* ======================================================================== */

/**

* Full persistence representation.
*
* @returns {Object}
  */
  toPersistenceObject() {
  return {
  schemaVersion:
  this.schemaVersion,

  modelVersion:
  this.modelVersion,

  id:
  this.id,

  documentId:
  this.documentId,

  slug:
  this.slug,

  title:
  this.title,

  shortTitle:
  this.shortTitle,

  description:
  this.description,

  version:
  this.version,

  versionLabel:
  this.versionLabel,

  versionNumber:
  this.versionNumber,

  majorVersion:
  this.majorVersion,

  minorVersion:
  this.minorVersion,

  patchVersion:
  this.patchVersion,

  parentVersionId:
  this.parentVersionId,

  previousVersionId:
  this.previousVersionId,

  nextVersionId:
  this.nextVersionId,

  rootVersionId:
  this.rootVersionId,

  supersedesVersionId:
  this.supersedesVersionId,

  supersededByVersionId:
  this.supersededByVersionId,

  status:
  this.status,

  approvalStatus:
  this.approvalStatus,

  publicationStatus:
  this.publicationStatus,

  changeType:
  this.changeType,

  audience:
  this.audience,

  visibility:
  this.visibility,

  contentType:
  this.contentType,

  source:
  this.source,

  acceptanceRequired:
  this.acceptanceRequired,

  acceptanceRequiredForRegistration:
  this.acceptanceRequiredForRegistration,

  acceptanceRequiredForUse:
  this.acceptanceRequiredForUse,

  requiresExplicitConsent:
  this.requiresExplicitConsent,

  jurisdiction:
  this.jurisdiction,

  countryCode:
  this.countryCode,

  language:
  this.language,

  applicableCountries:
  [
  ...this.applicableCountries,
  ],

  applicableRegions:
  [
  ...this.applicableRegions,
  ],

  tenantId:
  this.tenantId,

  organizationId:
  this.organizationId,

  isGlobal:
  this.isGlobal,

  content:
  this.content,

  contentHash:
  this.contentHash,

  documentHash:
  this.documentHash,

  previousVersionHash:
  this.previousVersionHash,

  contentLength:
  this.contentLength,

  effectiveDate:
  this.effectiveDate,

  publicationDate:
  this.publicationDate,

  expiryDate:
  this.expiryDate,

  reviewDueDate:
  this.reviewDueDate,

  authorId:
  this.authorId,

  authorName:
  this.authorName,

  reviewerId:
  this.reviewerId,

  reviewerName:
  this.reviewerName,

  approverId:
  this.approverId,

  approverName:
  this.approverName,

  canonicalUrl:
  this.canonicalUrl,

  publicPath:
  this.publicPath,

  legalContactEmail:
  this.legalContactEmail,

  legalContactPhone:
  this.legalContactPhone,

  changeSummary:
  this.changeSummary,

  rejectionReason:
  this.rejectionReason,

  isImmutable:
  this.isImmutable,

  integrityVerified:
  this.integrityVerified,

  signatureVerified:
  this.signatureVerified,

  createdAt:
  this.createdAt,

  updatedAt:
  this.updatedAt,

  approvedAt:
  this.approvedAt,

  publishedAt:
  this.publishedAt,

  expiredAt:
  this.expiredAt,

  supersededAt:
  this.supersededAt,

  archivedAt:
  this.archivedAt,

  metadata:
  {
  ...this.metadata,
  },
  };
  }

/**

* Sanitized public representation.
*
* Internal workflow actors, tenant IDs and arbitrary metadata are excluded.
*
* @param {Object} options
* @returns {Object}
  */
  toPublicObject(options = {}) {
  const {
  includeContent = false,
  } = options;

const result = {



  id:
    this.id,

  documentId:
    this.documentId,

  slug:
    this.slug,

  title:
    this.title,

  shortTitle:
    this.shortTitle,

  description:
    this.description,

  version:
    this.version,

  versionLabel:
    this.versionLabel,

  status:
    this.status,

  publicationStatus:
    this.publicationStatus,

  audience:
    this.audience,

  visibility:
    this.visibility,

  contentType:
    this.contentType,

  acceptanceRequired:
    this.acceptanceRequired,

  acceptanceRequiredForRegistration:
    this.acceptanceRequiredForRegistration,

  acceptanceRequiredForUse:
    this.acceptanceRequiredForUse,

  requiresExplicitConsent:
    this.requiresExplicitConsent,

  jurisdiction:
    this.jurisdiction,

  countryCode:
    this.countryCode,

  language:
    this.language,

  applicableCountries:
    [
      ...this.applicableCountries,
    ],

  effectiveDate:
    this.effectiveDate,

  publicationDate:
    this.publicationDate,

  expiryDate:
    this.expiryDate,

  canonicalUrl:
    this.canonicalUrl,

  publicPath:
    this.publicPath,

  legalContactEmail:
    this.legalContactEmail,

  legalContactPhone:
    this.legalContactPhone,

  documentHash:
    this.documentHash,

  createdAt:
    this.createdAt,

  updatedAt:
    this.updatedAt,
};

if (
  includeContent &&
  this.isPubliclyAccessible()
) {
  result.content =
    this.content;
}

return result;


}

/**

* JSON serialization.
*
* @returns {Object}
  */
  toJSON() {
  return this.toPersistenceObject();
  }

/**

* Clone this version.
*
* @returns {LegalDocumentVersion}
  */
  clone() {
  return new LegalDocumentVersion(
  this.toPersistenceObject()
  );
  }
  }

/* ============================================================================

* FUNCTIONAL API
* ========================================================================== */

/**

* Create a legal-document version.
*
* @param {Object} input
* @returns {LegalDocumentVersion}
  */
  function createLegalDocumentVersion(
  input = {}
  ) {
  return new LegalDocumentVersion(
  input
  );
  }

/**

* Normalize a legal-document version.
*
* @param {Object} input
* @returns {LegalDocumentVersion}
  */
  function normalizeLegalDocumentVersion(
  input = {}
  ) {
  return new LegalDocumentVersion(
  input
  );
  }

/**

* Validate a legal-document version.
*
* @param {Object} input
* @param {Object} options
* @returns {{valid:boolean,errors:string,warnings:string}}
  */
  function validateLegalDocumentVersion(
  input = {},
  options = {}
  ) {
  try {
  return new LegalDocumentVersion(
  input
  ).validate(options);
  } catch (error) {
  return {
  valid: false,

  errors: [
  error.message ||
  'Unable to validate legal-document version.',
  ],

  warnings: [],
  };
  }
  }

/**

* Assert legal-document version validity.
*
* @param {Object} input
* @param {Object} options
* @returns {LegalDocumentVersion}
  */
  function assertLegalDocumentVersion(
  input = {},
  options = {}
  ) {
  return new LegalDocumentVersion(
  input
  ).assertValid(options);
  }

/**

* Filter currently published versions.
*
* @param {Array} versions
* @param {Date|string} at
* @returns {LegalDocumentVersion[]}
  */
  function getPublishedLegalDocumentVersions(
  versions = [],
  at = new Date()
  ) {
  if (!Array.isArray(versions)) {
  return [];
  }

return versions
.map((version) =>
version instanceof LegalDocumentVersion
? version
: new LegalDocumentVersion(
version
)
)
.filter((version) =>
version.isPublished(at)
);
}

/**

* Filter versions currently eligible for acceptance.
*
* @param {Array} versions
* @param {Date|string} at
* @returns {LegalDocumentVersion[]}
  */
  function getAcceptanceEligibleLegalDocumentVersions(
  versions = [],
  at = new Date()
  ) {
  if (!Array.isArray(versions)) {
  return [];
  }

return versions
.map((version) =>
version instanceof LegalDocumentVersion
? version
: new LegalDocumentVersion(
version
)
)
.filter((version) =>
version.canReceiveAcceptance(at)
);
}

/**

* Find the current published version for a document.
*
* @param {Array} versions
* @param {string} documentId
* @param {Date|string} at
* @returns {LegalDocumentVersion|undefined}
  */
  function findCurrentPublishedVersion(
  versions = [],
  documentId,
  at = new Date()
  ) {
  if (
  !Array.isArray(versions) ||
  !isNonEmptyString(documentId)
  ) {
  return undefined;
  }

const candidates =
getPublishedLegalDocumentVersions(
versions,
at
)
.filter(
(version) =>
version.documentId ===
documentId
);

if (
candidates.length === 0
) {
return undefined;
}

return candidates.reduce(
(current, candidate) => {
if (!current) {
return candidate;
}


  return candidate.isNewerThan(
    current
  )
    ? candidate
    : current;
},
undefined


);
}

/**

* Compare two versions.
*
* @param {LegalDocumentVersion|Object} left
* @param {LegalDocumentVersion|Object} right
* @returns {number}
  */
  function compareLegalDocumentVersions(
  left,
  right
  ) {
  if (!left || !right) {
  return 0;
  }

const leftModel =
left instanceof LegalDocumentVersion
? left
: new LegalDocumentVersion(
left
);

const rightModel =
right instanceof LegalDocumentVersion
? right
: new LegalDocumentVersion(
right
);

if (
leftModel.isNewerThan(
rightModel
)
) {
return 1;
}

if (
rightModel.isNewerThan(
leftModel
)
) {
return -1;
}

return 0;
}

/* ============================================================================

* EXPORTS
* ========================================================================== */

module.exports = {
LegalDocumentVersion,

LEGAL_DOCUMENT_VERSION_MODEL_VERSION,

LEGAL_DOCUMENT_VERSION_SCHEMA_VERSION,

LEGAL_DOCUMENT_VERSION_STATUS,

LEGAL_DOCUMENT_VERSION_APPROVAL_STATUS,

LEGAL_DOCUMENT_VERSION_PUBLICATION_STATUS,

LEGAL_DOCUMENT_VERSION_CHANGE_TYPE,

LEGAL_DOCUMENT_VERSION_CONTENT_TYPE,

LEGAL_DOCUMENT_VERSION_SOURCE,

LEGAL_DOCUMENT_VERSION_VISIBILITY,

LEGAL_DOCUMENT_VERSION_AUDIENCE,

REQUIRED_FIELDS,

FIELD_LIMITS,

createLegalDocumentVersion,

normalizeLegalDocumentVersion,

validateLegalDocumentVersion,

assertLegalDocumentVersion,

getPublishedLegalDocumentVersions,

getAcceptanceEligibleLegalDocumentVersions,

findCurrentPublishedVersion,

compareLegalDocumentVersions,
};

/**

* ============================================================================
* END OF FILE
* ============================================================================
  */