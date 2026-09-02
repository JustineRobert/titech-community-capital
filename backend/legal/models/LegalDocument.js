/**

* ============================================================================
* TITech Community Capital Ltd
* Enterprise Legal Document Domain Model
* ============================================================================
*
* File:
* backend/legal/models/LegalDocument.js
*
* Version:
* 2.0.0
*
* Purpose:
* Canonical backend domain model for legal documents managed by the
* TITech Community Capital legal/compliance subsystem.
*
* Responsibilities:
* ✓ Define the canonical legal-document domain contract
* ✓ Normalize legal-document metadata
* ✓ Validate legal-document lifecycle state
* ✓ Support version-aware legal documents
* ✓ Support publication and effective-date management
* ✓ Support acceptance-required documents
* ✓ Support jurisdiction and audience metadata
* ✓ Support tenant-aware legal documents
* ✓ Support document integrity hashes
* ✓ Support supersession and replacement relationships
* ✓ Support audit and compliance workflows
* ✓ Provide persistence-safe serialization
* ✓ Provide sanitized public serialization
* ✓ Remain persistence-layer agnostic
*
* Non-responsibilities:
* ✗ Database persistence
* ✗ MongoDB/Mongoose schema definitions
* ✗ HTTP/API handling
* ✗ Authentication
* ✗ Authorization
* ✗ Legal interpretation
* ✗ Rendering legal content
* ✗ Acceptance recording
* ✗ Audit-event persistence
*
* Architecture:
*
* LegalDocument
* ```
     │
  ```
* ```
     ├── LegalAcceptance
  ```
* ```
     │
  ```
* ```
     ├── LegalAuditEvent
  ```
* ```
     │
  ```
* ```
     ├── Legal Registry
  ```
* ```
     │
  ```
* ```
     └── Legal Repository / Persistence Adapter
  ```
*
* IMPORTANT:
* This model describes application-level legal-document metadata.
* It does not establish that TITech Community Capital Ltd is licensed,
* regulated, authorized, or legally permitted to provide any particular
* financial service.
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

* MODEL CONSTANTS
* ========================================================================== */

/**

* Domain-model version.
  */
  const LEGAL_DOCUMENT_MODEL_VERSION = '2.0.0';

/**

* Persistence schema version.
*
* Increment when the persisted structure changes incompatibly.
  */
  const LEGAL_DOCUMENT_SCHEMA_VERSION = 1;

/**

* Document lifecycle statuses.
  */
  const LEGAL_DOCUMENT_STATUS = Object.freeze({
  DRAFT: 'draft',
  IN_REVIEW: 'in_review',
  APPROVED: 'approved',
  PUBLISHED: 'published',
  UNPUBLISHED: 'unpublished',
  ARCHIVED: 'archived',
  SUPERSEDED: 'superseded',
  RETIRED: 'retired',
  });

/**

* Legal document categories.
  */
  const LEGAL_DOCUMENT_CATEGORY = Object.freeze({
  TERMS: 'terms',
  PRIVACY: 'privacy',
  DISCLAIMER: 'disclaimer',
  FINANCIAL_DISCLAIMER: 'financial_disclaimer',
  GENERAL_DISCLAIMER: 'general_disclaimer',
  COOKIE_POLICY: 'cookie_policy',
  ACCEPTABLE_USE: 'acceptable_use',
  DATA_PROCESSING: 'data_processing',
  CONSENT: 'consent',
  RISK_DISCLOSURE: 'risk_disclosure',
  COMMUNITY_RULES: 'community_rules',
  PLATFORM_POLICY: 'platform_policy',
  OTHER: 'other',
  });

/**

* Intended document audiences.
  */
  const LEGAL_DOCUMENT_AUDIENCE = Object.freeze({
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

* Publication visibility.
  */
  const LEGAL_DOCUMENT_VISIBILITY = Object.freeze({
  PUBLIC: 'public',
  AUTHENTICATED: 'authenticated',
  TENANT: 'tenant',
  INTERNAL: 'internal',
  });

/**

* Content formats supported by the domain.
  */
  const LEGAL_DOCUMENT_FORMAT = Object.freeze({
  HTML: 'html',
  MARKDOWN: 'markdown',
  TEXT: 'text',
  PDF: 'pdf',
  RICH_TEXT: 'rich_text',
  });

/**

* Approval states.
  */
  const LEGAL_DOCUMENT_APPROVAL_STATUS = Object.freeze({
  NOT_REQUIRED: 'not_required',
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  });

/**

* Publication states.
  */
  const LEGAL_DOCUMENT_PUBLICATION_STATUS = Object.freeze({
  UNPUBLISHED: 'unpublished',
  SCHEDULED: 'scheduled',
  PUBLISHED: 'published',
  EXPIRED: 'expired',
  });

/**

* Legal-document sources.
  */
  const LEGAL_DOCUMENT_SOURCE = Object.freeze({
  PLATFORM: 'platform',
  ADMIN: 'admin',
  API: 'api',
  CMS: 'cms',
  IMPORT: 'import',
  SYSTEM: 'system',
  });

/**

* Change types.
  */
  const LEGAL_DOCUMENT_CHANGE_TYPE = Object.freeze({
  CREATED: 'created',
  UPDATED: 'updated',
  CORRECTED: 'corrected',
  REVISED: 'revised',
  REPLACED: 'replaced',
  MIGRATED: 'migrated',
  });

/**

* Required canonical fields.
  */
  const REQUIRED_FIELDS = Object.freeze([
  'id',
  'slug',
  'title',
  'shortTitle',
  'category',
  'version',
  'status',
  ]);

/**

* Field-size constraints.
  */
  const FIELD_LIMITS = Object.freeze({
  id: 128,
  slug: 256,
  title: 512,
  shortTitle: 256,
  description: 4096,

version: 128,
versionLabel: 256,

jurisdiction: 256,
countryCode: 8,
language: 32,

contentType: 64,
source: 64,

documentHash: 256,
previousVersionHash: 256,

authorId: 128,
authorName: 256,

reviewerId: 128,
reviewerName: 256,

approverId: 128,
approverName: 256,

parentDocumentId: 128,
supersedesDocumentId: 128,
supersededByDocumentId: 128,

tenantId: 128,
organizationId: 128,

canonicalUrl: 2048,
publicPath: 1024,

effectiveDate: 64,
publicationDate: 64,
expiryDate: 64,

changeSummary: 4096,
rejectionReason: 4096,

legalContactEmail: 320,
legalContactPhone: 64,

retentionPeriodDays: 16,
});

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

* Normalize a string while enforcing a maximum length.
*
* @param {*} value
* @param {number} maxLength
* @returns {string|undefined}
  */
  function normalizeString(value, maxLength) {
  if (!isNonEmptyString(value)) {
  return undefined;
  }

const normalized =
value.trim();

if (
Number.isInteger(maxLength) &&
normalized.length > maxLength
) {
return normalized.slice(
0,
maxLength
);
}

return normalized;
}

/**

* Normalize a date into UTC ISO-8601.
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

* Determine whether a value exists as an enum member.
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

* Normalize a boolean.
*
* @param {*} value
* @param {boolean} fallback
* @returns {boolean}
  */
  function normalizeBoolean(
  value,
  fallback = false
  ) {
  if (typeof value === 'boolean') {
  return value;
  }

return fallback;
}

/**

* Normalize an integer.
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

```
if (
  Number.isInteger(parsed)
) {
  return parsed;
}
```

}

return fallback;
}

/**

* Normalize an array of strings.
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

* Convert ORM/document instances into plain objects.
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
typeof value.toObject === 'function'
) {
return value.toObject();
}

if (
typeof value.toJSON === 'function'
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
'LegalDocumentValidationError';

error.code =
'LEGAL_DOCUMENT_VALIDATION_ERROR';

error.errors =
Object.freeze([
...errors,
]);

return error;
}

/* ============================================================================

* LEGAL DOCUMENT DOMAIN MODEL
* ========================================================================== */

class LegalDocument {
/**

* Construct a legal document.
*
* @param {Object} input
* @param {Object} options
  */
  constructor(
  input = {},
  options = {}
  ) {
  if (
  !input ||
  typeof input !== 'object'
  ) {
  throw new TypeError(
  'LegalDocument requires an object.'
  );
  }


this.schemaVersion =



  normalizeInteger(
    input.schemaVersion,
    LEGAL_DOCUMENT_SCHEMA_VERSION
  );

this.modelVersion =
  normalizeString(
    input.modelVersion,
    64
  ) ||
  LEGAL_DOCUMENT_MODEL_VERSION;

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
 * Classification
 * ------------------------------------------------------------------------
 */

this.category =
  normalizeString(
    input.category,
    64
  ) ||
  LEGAL_DOCUMENT_CATEGORY.OTHER;

this.audience =
  normalizeString(
    input.audience,
    64
  ) ||
  LEGAL_DOCUMENT_AUDIENCE.PUBLIC;

this.visibility =
  normalizeString(
    input.visibility,
    64
  ) ||
  LEGAL_DOCUMENT_VISIBILITY.PUBLIC;

this.contentType =
  normalizeString(
    input.contentType,
    FIELD_LIMITS.contentType
  ) ||
  LEGAL_DOCUMENT_FORMAT.HTML;

this.source =
  normalizeString(
    input.source,
    FIELD_LIMITS.source
  ) ||
  LEGAL_DOCUMENT_SOURCE.PLATFORM;

/*
 * ------------------------------------------------------------------------
 * Versioning
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

this.parentDocumentId =
  normalizeString(
    input.parentDocumentId,
    FIELD_LIMITS.parentDocumentId
  );

this.supersedesDocumentId =
  normalizeString(
    input.supersedesDocumentId,
    FIELD_LIMITS.supersedesDocumentId
  );

this.supersededByDocumentId =
  normalizeString(
    input.supersededByDocumentId,
    FIELD_LIMITS.supersededByDocumentId
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
  LEGAL_DOCUMENT_STATUS.DRAFT;

this.approvalStatus =
  normalizeString(
    input.approvalStatus,
    64
  ) ||
  LEGAL_DOCUMENT_APPROVAL_STATUS.NOT_REQUIRED;

this.publicationStatus =
  normalizeString(
    input.publicationStatus,
    64
  ) ||
  LEGAL_DOCUMENT_PUBLICATION_STATUS.UNPUBLISHED;

this.changeType =
  normalizeString(
    input.changeType,
    64
  ) ||
  LEGAL_DOCUMENT_CHANGE_TYPE.CREATED;

/*
 * ------------------------------------------------------------------------
 * Acceptance / consent
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

this.allowAnonymousAccess =
  normalizeBoolean(
    input.allowAnonymousAccess,
    true
  );

/*
 * ------------------------------------------------------------------------
 * Geographic / legal applicability
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
 * Tenant / organization scope
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
 * Content metadata
 * ------------------------------------------------------------------------
 */

this.content =
  typeof input.content === 'string'
    ? input.content
    : undefined;

this.contentHash =
  normalizeString(
    input.contentHash,
    FIELD_LIMITS.documentHash
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
 * Publication / effective dates
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
 * Ownership / workflow
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
 * URLs / navigation
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
 * Contact information
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
 * Retention
 * ------------------------------------------------------------------------
 */

this.retentionPeriodDays =
  normalizeInteger(
    input.retentionPeriodDays,
    undefined
  );

this.retentionRequired =
  normalizeBoolean(
    input.retentionRequired,
    false
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

this.archivedAt =
  normalizeDate(
    input.archivedAt
  );

this.supersededAt =
  normalizeDate(
    input.supersededAt
  );

/*
 * ------------------------------------------------------------------------
 * Extensible metadata
 * ------------------------------------------------------------------------
 *
 * Metadata must never contain:
 *   - passwords
 *   - authentication tokens
 *   - refresh tokens
 *   - private cryptographic keys
 *   - payment credentials
 *   - unnecessary sensitive personal data
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

* STATIC FACTORIES
* ======================================================================== */

/**

* Create a new draft legal document.
*
* @param {Object} input
* @returns {LegalDocument}
  */
  static createDraft(input = {}) {
  return new LegalDocument({
  ...input,

  status:
  input.status ||
  LEGAL_DOCUMENT_STATUS.DRAFT,

  approvalStatus:
  input.approvalStatus ||
  LEGAL_DOCUMENT_APPROVAL_STATUS.PENDING,

  publicationStatus:
  input.publicationStatus ||
  LEGAL_DOCUMENT_PUBLICATION_STATUS.UNPUBLISHED,
  });
  }

/**

* Hydrate a persisted legal document.
*
* @param {Object} input
* @returns {LegalDocument}
  */
  static fromJSON(input) {
  return new LegalDocument(
  toPlainObject(input)
  );
  }

/**

* Create a version derived from an existing legal document.
*
* The resulting document is intentionally not automatically published.
*
* @param {LegalDocument|Object} source
* @param {Object} changes
* @returns {LegalDocument}
  */
  static createVersion(
  source,
  changes = {}
  ) {
  const original =
  source instanceof LegalDocument
  ? source
  : new LegalDocument(source);


return new LegalDocument({



  ...original.toPersistenceObject(),

  ...changes,

  id:
    changes.id,

  version:
    changes.version,

  status:
    LEGAL_DOCUMENT_STATUS.DRAFT,

  approvalStatus:
    LEGAL_DOCUMENT_APPROVAL_STATUS.PENDING,

  publicationStatus:
    LEGAL_DOCUMENT_PUBLICATION_STATUS.UNPUBLISHED,

  supersedesDocumentId:
    original.id,

  supersededByDocumentId:
    undefined,

  previousVersionHash:
    original.documentHash ||
    original.contentHash,

  publicationDate:
    undefined,

  publishedAt:
    undefined,

  approvedAt:
    undefined,

  archivedAt:
    undefined,

  supersededAt:
    undefined,

  changeType:
    changes.changeType ||
    LEGAL_DOCUMENT_CHANGE_TYPE.REVISED,

  parentDocumentId:
    changes.parentDocumentId ||
    original.parentDocumentId ||
    original.id,
});


}

/* ==========================================================================

* LIFECYCLE METHODS
* ======================================================================== */

/**

* Determine whether the document is currently published.
*
* @param {Date|string} at
* @returns {boolean}
  */
  isPublished(
  at = new Date()
  ) {
  if (
  this.status !==
  LEGAL_DOCUMENT_STATUS.PUBLISHED
  ) {
  return false;
  }


if (



  this.publicationStatus !==
  LEGAL_DOCUMENT_PUBLICATION_STATUS.PUBLISHED
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

* Determine whether the document is publicly accessible.
*
* @param {Date|string} at
* @returns {boolean}
  */
  isPubliclyAccessible(
  at = new Date()
  ) {
  if (
  !this.isPublished(at)
  ) {
  return false;
  }


return (



  this.visibility ===
    LEGAL_DOCUMENT_VISIBILITY.PUBLIC &&
  (
    this.audience ===
      LEGAL_DOCUMENT_AUDIENCE.PUBLIC ||
    this.allowAnonymousAccess
  )
);


}

/**

* Determine whether the document requires acceptance.
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

* Determine whether the document is expired.
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


const expiry =



  new Date(
    this.expiryDate
  );

const timestamp =
  new Date(at);

if (
  Number.isNaN(
    expiry.getTime()
  ) ||
  Number.isNaN(
    timestamp.getTime()
  )
) {
  return false;
}

return (
  timestamp >= expiry
);


}

/**

* Determine whether the document is archived.
*
* @returns {boolean}
  */
  isArchived() {
  return (
  this.status ===
  LEGAL_DOCUMENT_STATUS.ARCHIVED
  );
  }

/**

* Determine whether the document has been superseded.
*
* @returns {boolean}
  */
  isSuperseded() {
  return (
  this.status ===
  LEGAL_DOCUMENT_STATUS.SUPERSEDED ||
  Boolean(
  this.supersededByDocumentId
  )
  );
  }

/**

* Determine whether this document can accept new legal acceptances.
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
  !this.isSuperseded() &&
  !this.isArchived()
  );
  }

/* ==========================================================================

* JURISDICTION / TENANCY
* ======================================================================== */

/**

* Determine whether the document applies to a country.
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
    !this.countryCode ||
    this.countryCode.toUpperCase() ===
      normalized
  );
}

return this.applicableCountries
  .map((item) =>
    item.toUpperCase()
  )
  .includes(normalized);


}

/**

* Determine whether this document belongs to a tenant.
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

* VERSION HELPERS
* ======================================================================== */

/**

* Determine whether this document is a newer version than another version.
*
* This intentionally performs conservative semantic-version comparison.
* Non-semver versions are compared using natural string ordering.
*
* @param {LegalDocument|Object} other
* @returns {boolean}
  */
  isNewerThan(other) {
  if (!other) {
  return false;
  }


const otherVersion =



  other.version;

if (
  !isNonEmptyString(
    this.version
  ) ||
  !isNonEmptyString(
    otherVersion
  )
) {
  return false;
}

const parseVersion =
  (value) => {
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
  };

const current =
  parseVersion(
    this.version
  );

const previous =
  parseVersion(
    otherVersion
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
  this.version >
  otherVersion
);


}

/* ==========================================================================

* VALIDATION
* ======================================================================== */

/**

* Validate the legal document.
*
* @param {Object} options
* @returns {{valid:boolean,errors:string,warnings:string}}
  */
  validate(options = {}) {
  const {
  requireContent = false,
  requireTenant = false,
  requireHash = false,
  requirePublicationMetadata = false,
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
 * Enumerations.
 */
if (
  !isEnumValue(
    this.status,
    LEGAL_DOCUMENT_STATUS
  )
) {
  errors.push(
    `Unsupported legal document status: ${this.status}.`
  );
}

if (
  !isEnumValue(
    this.category,
    LEGAL_DOCUMENT_CATEGORY
  )
) {
  errors.push(
    `Unsupported legal document category: ${this.category}.`
  );
}

if (
  !isEnumValue(
    this.audience,
    LEGAL_DOCUMENT_AUDIENCE
  )
) {
  errors.push(
    `Unsupported legal document audience: ${this.audience}.`
  );
}

if (
  !isEnumValue(
    this.visibility,
    LEGAL_DOCUMENT_VISIBILITY
  )
) {
  errors.push(
    `Unsupported legal document visibility: ${this.visibility}.`
  );
}

if (
  !isEnumValue(
    this.contentType,
    LEGAL_DOCUMENT_FORMAT
  )
) {
  errors.push(
    `Unsupported legal document format: ${this.contentType}.`
  );
}

if (
  !isEnumValue(
    this.source,
    LEGAL_DOCUMENT_SOURCE
  )
) {
  errors.push(
    `Unsupported legal document source: ${this.source}.`
  );
}

if (
  !isEnumValue(
    this.approvalStatus,
    LEGAL_DOCUMENT_APPROVAL_STATUS
  )
) {
  errors.push(
    `Unsupported approval status: ${this.approvalStatus}.`
  );
}

if (
  !isEnumValue(
    this.publicationStatus,
    LEGAL_DOCUMENT_PUBLICATION_STATUS
  )
) {
  errors.push(
    `Unsupported publication status: ${this.publicationStatus}.`
  );
}

if (
  !isEnumValue(
    this.changeType,
    LEGAL_DOCUMENT_CHANGE_TYPE
  )
) {
  errors.push(
    `Unsupported document change type: ${this.changeType}.`
  );
}

/*
 * Version sanity.
 */
if (
  !isNonEmptyString(
    this.version
  )
) {
  errors.push(
    'version is required.'
  );
}

/*
 * Content requirements.
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
 * Tenant requirements.
 */
if (
  requireTenant &&
  !this.tenantId &&
  !this.isGlobal
) {
  errors.push(
    'tenantId is required for a tenant-scoped legal document.'
  );
}

/*
 * Integrity requirements.
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
 * Publication consistency.
 */
if (
  this.status ===
  LEGAL_DOCUMENT_STATUS.PUBLISHED
) {
  if (
    !this.publicationDate &&
    !this.publishedAt
  ) {
    if (
      requirePublicationMetadata
    ) {
      errors.push(
        'Published documents require publicationDate or publishedAt.'
      );
    } else {
      warnings.push(
        'Published document has no publication timestamp.'
      );
    }
  }

  if (
    this.approvalStatus !==
      LEGAL_DOCUMENT_APPROVAL_STATUS.APPROVED &&
    this.approvalStatus !==
      LEGAL_DOCUMENT_APPROVAL_STATUS.NOT_REQUIRED
  ) {
    errors.push(
      'A published document must be approved or explicitly marked as not requiring approval.'
    );
  }
}

/*
 * Effective-date consistency.
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
 * Supersession consistency.
 */
if (
  this.supersedesDocumentId ===
  this.id
) {
  errors.push(
    'A document cannot supersede itself.'
  );
}

if (
  this.supersededByDocumentId ===
  this.id
) {
  errors.push(
    'A document cannot be superseded by itself.'
  );
}

/*
 * Tenant/global consistency.
 */
if (
  this.isGlobal &&
  this.tenantId
) {
  warnings.push(
    'Global document also contains tenantId; verify intended scope.'
  );
}

/*
 * Acceptance consistency.
 */
if (
  this.acceptanceRequired &&
  !this.requiresAcceptance()
) {
  errors.push(
    'Acceptance-required configuration is inconsistent.'
  );
}

return {
  valid:
    errors.length === 0,

  errors,

  warnings,
};


}

/**

* Assert document validity.
*
* @param {Object} options
* @returns {LegalDocument}
  */
  assertValid(options = {}) {
  const result =
  this.validate(options);


if (!result.valid) {



  throw createValidationError(
    'Invalid legal document.',
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
* This representation may contain legal content and internal metadata.
* Do not expose directly to untrusted clients.
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

  slug:
  this.slug,

  title:
  this.title,

  shortTitle:
  this.shortTitle,

  description:
  this.description,

  category:
  this.category,

  audience:
  this.audience,

  visibility:
  this.visibility,

  contentType:
  this.contentType,

  source:
  this.source,

  version:
  this.version,

  versionLabel:
  this.versionLabel,

  parentDocumentId:
  this.parentDocumentId,

  supersedesDocumentId:
  this.supersedesDocumentId,

  supersededByDocumentId:
  this.supersededByDocumentId,

  status:
  this.status,

  approvalStatus:
  this.approvalStatus,

  publicationStatus:
  this.publicationStatus,

  changeType:
  this.changeType,

  acceptanceRequired:
  this.acceptanceRequired,

  acceptanceRequiredForRegistration:
  this.acceptanceRequiredForRegistration,

  acceptanceRequiredForUse:
  this.acceptanceRequiredForUse,

  requiresExplicitConsent:
  this.requiresExplicitConsent,

  allowAnonymousAccess:
  this.allowAnonymousAccess,

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

  retentionPeriodDays:
  this.retentionPeriodDays,

  retentionRequired:
  this.retentionRequired,

  changeSummary:
  this.changeSummary,

  rejectionReason:
  this.rejectionReason,

  createdAt:
  this.createdAt,

  updatedAt:
  this.updatedAt,

  approvedAt:
  this.approvedAt,

  publishedAt:
  this.publishedAt,

  archivedAt:
  this.archivedAt,

  supersededAt:
  this.supersededAt,

  metadata:
  {
  ...this.metadata,
  },
  };
  }

/**

* Sanitized public representation.
*
* Deliberately excludes internal workflow actors, tenant identifiers,
* integrity-chain metadata and arbitrary metadata.
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

  slug:
    this.slug,

  title:
    this.title,

  shortTitle:
    this.shortTitle,

  description:
    this.description,

  category:
    this.category,

  audience:
    this.audience,

  visibility:
    this.visibility,

  contentType:
    this.contentType,

  version:
    this.version,

  versionLabel:
    this.versionLabel,

  status:
    this.status,

  publicationStatus:
    this.publicationStatus,

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

  contentHash:
    this.contentHash,

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

* Clone the document.
*
* @returns {LegalDocument}
  */
  clone() {
  return new LegalDocument(
  this.toPersistenceObject()
  );
  }
  }

/* ============================================================================

* FUNCTIONAL API
* ========================================================================== */

/**

* Create a legal document.
*
* @param {Object} input
* @returns {LegalDocument}
  */
  function createLegalDocument(
  input = {}
  ) {
  return new LegalDocument(
  input
  );
  }

/**

* Normalize a legal document.
*
* @param {Object} input
* @returns {LegalDocument}
  */
  function normalizeLegalDocument(
  input = {}
  ) {
  return new LegalDocument(
  input
  );
  }

/**

* Validate a legal document without throwing.
*
* @param {Object} input
* @param {Object} options
* @returns {{valid:boolean,errors:string,warnings:string}}
  */
  function validateLegalDocument(
  input = {},
  options = {}
  ) {
  try {
  return new LegalDocument(
  input
  ).validate(options);
  } catch (error) {
  return {
  valid: false,

  errors: [
  error.message ||
  'Unable to validate legal document.',
  ],

  warnings: [],
  };
  }
  }

/**

* Assert legal document validity.
*
* @param {Object} input
* @param {Object} options
* @returns {LegalDocument}
  */
  function assertLegalDocument(
  input = {},
  options = {}
  ) {
  return new LegalDocument(
  input
  ).assertValid(options);
  }

/* ============================================================================

* COMPARISON / LOOKUP HELPERS
* ========================================================================== */

/**

* Determine whether two documents represent the same logical document.
*
* @param {LegalDocument|Object} left
* @param {LegalDocument|Object} right
* @returns {boolean}
  */
  function isSameLegalDocument(
  left,
  right
  ) {
  if (
  !left ||
  !right
  ) {
  return false;
  }

return (
left.id === right.id &&
left.slug === right.slug
);
}

/**

* Determine whether two documents represent the exact same version.
*
* @param {LegalDocument|Object} left
* @param {LegalDocument|Object} right
* @returns {boolean}
  */
  function isSameLegalDocumentVersion(
  left,
  right
  ) {
  if (
  !left ||
  !right
  ) {
  return false;
  }

return (
isSameLegalDocument(
left,
right
) &&
left.version ===
right.version
);
}

/**

* Determine whether a document is eligible for public legal navigation.
*
* @param {LegalDocument|Object} document
* @param {Date|string} at
* @returns {boolean}
  */
  function isPublicLegalDocument(
  document,
  at = new Date()
  ) {
  const model =
  document instanceof LegalDocument
  ? document
  : new LegalDocument(
  document
  );

return model.isPubliclyAccessible(
at
);
}

/**

* Filter a collection to currently published legal documents.
*
* @param {Array} documents
* @param {Date|string} at
* @returns {LegalDocument[]}
  */
  function getPublishedLegalDocuments(
  documents = [],
  at = new Date()
  ) {
  if (!Array.isArray(documents)) {
  return [];
  }

return documents
.map((document) =>
document instanceof LegalDocument
? document
: new LegalDocument(
document
)
)
.filter((document) =>
document.isPublished(at)
);
}

/**

* Filter a collection to public legal documents.
*
* @param {Array} documents
* @param {Date|string} at
* @returns {LegalDocument[]}
  */
  function getPublicLegalDocuments(
  documents = [],
  at = new Date()
  ) {
  if (!Array.isArray(documents)) {
  return [];
  }

return documents
.map((document) =>
document instanceof LegalDocument
? document
: new LegalDocument(
document
)
)
.filter((document) =>
document.isPubliclyAccessible(
at
)
);
}

/**

* Get documents requiring acceptance.
*
* @param {Array} documents
* @param {Date|string} at
* @returns {LegalDocument[]}
  */
  function getAcceptanceRequiredDocuments(
  documents = [],
  at = new Date()
  ) {
  if (!Array.isArray(documents)) {
  return [];
  }

return documents
.map((document) =>
document instanceof LegalDocument
? document
: new LegalDocument(
document
)
)
.filter(
(document) =>
document.requiresAcceptance() &&
document.isPublished(at)
);
}

/* ============================================================================

* EXPORTS
* ========================================================================== */

module.exports = {
LegalDocument,

LEGAL_DOCUMENT_MODEL_VERSION,

LEGAL_DOCUMENT_SCHEMA_VERSION,

LEGAL_DOCUMENT_STATUS,

LEGAL_DOCUMENT_CATEGORY,

LEGAL_DOCUMENT_AUDIENCE,

LEGAL_DOCUMENT_VISIBILITY,

LEGAL_DOCUMENT_FORMAT,

LEGAL_DOCUMENT_APPROVAL_STATUS,

LEGAL_DOCUMENT_PUBLICATION_STATUS,

LEGAL_DOCUMENT_SOURCE,

LEGAL_DOCUMENT_CHANGE_TYPE,

REQUIRED_FIELDS,

FIELD_LIMITS,

createLegalDocument,

normalizeLegalDocument,

validateLegalDocument,

assertLegalDocument,

isSameLegalDocument,

isSameLegalDocumentVersion,

isPublicLegalDocument,

getPublishedLegalDocuments,

getPublicLegalDocuments,

getAcceptanceRequiredDocuments,
};

/**

* ============================================================================
* END OF FILE
* ============================================================================
  */
