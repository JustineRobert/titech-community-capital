/**
* ============================================================================
* TITech Community Capital Ltd
* Enterprise Legal Acceptance Domain Model
* ============================================================================
*
* File:
* backend/legal/models/LegalAcceptance.js
*
* Version:
* 2.0.0
*
* Purpose:
* Canonical backend domain model for legal-document acceptance records.
*
* Responsibilities:
* ✓ Define the server-side legal acceptance contract
* ✓ Normalize incoming acceptance data
* ✓ Validate legal-document identity and version
* ✓ Validate acceptance lifecycle state
* ✓ Preserve audit metadata
* ✓ Support multi-tenant legal acceptance
* ✓ Support document-version-aware acceptance
* ✓ Provide safe persistence payloads
* ✓ Provide safe API serialization
* ✓ Support idempotency/correlation workflows
* ✓ Support future MongoDB/Mongoose persistence
* ✓ Provide deterministic comparison helpers
* ✓ Prevent accidental mutation of domain state
*
* Non-responsibilities:
* ✗ Authentication
* ✗ Authorization
* ✗ HTTP routing
* ✗ Database connection management
* ✗ Mongoose model registration
* ✗ Email/SMS notifications
* ✗ React/frontend behavior
* ✗ Determining whether TITech Community Capital Ltd is legally licensed
*
* Security principle:
* The backend is the authoritative source of legal acceptance.
*
* Client-provided timestamps, user IDs, tenant IDs, IP addresses and
* acceptance state MUST NOT automatically be trusted. Controllers/services
* should derive security-sensitive values from the authenticated request,
* server clock and trusted infrastructure wherever possible.
*
* Brand:
* TITech Community Capital
*
* Legacy terminology:
* ACFOS must not be used in this module.
*
* ============================================================================
  */

'use strict';

/* ============================================================================

* CONSTANTS
* ========================================================================== */

const LEGAL_ACCEPTANCE_MODEL_VERSION = '2.0.0';

const LEGAL_ACCEPTANCE_SCHEMA_VERSION = 1;

/**

* Legal acceptance actions.
  */
  const LEGAL_ACCEPTANCE_ACTIONS = Object.freeze({
  ACCEPT: 'accept',
  DECLINE: 'decline',
  WITHDRAW: 'withdraw',
  });

/**

* Legal acceptance lifecycle states.
  */
  const LEGAL_ACCEPTANCE_STATES = Object.freeze({
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  WITHDRAWN: 'withdrawn',
  PENDING: 'pending',
  });

/**

* Legal acceptance subject types.
  */
  const LEGAL_ACCEPTANCE_SUBJECT_TYPES = Object.freeze({
  USER: 'user',
  TENANT: 'tenant',
  ORGANIZATION: 'organization',
  ANONYMOUS: 'anonymous',
  });

/**

* Acceptance sources.
  */
  const LEGAL_ACCEPTANCE_SOURCES = Object.freeze({
  WEB: 'web',
  MOBILE_WEB: 'mobile_web',
  MOBILE_APP: 'mobile_app',
  API: 'api',
  ADMIN: 'admin',
  SYSTEM: 'system',
  });

/**

* Explicit acceptance methods.
  */
  const LEGAL_ACCEPTANCE_METHODS = Object.freeze({
  CHECKBOX: 'checkbox',
  BUTTON: 'button',
  DIGITAL_SIGNATURE: 'digital_signature',
  API: 'api',
  ADMIN: 'admin',
  SYSTEM: 'system',
  });

/**

* Required domain fields.
  */
  const REQUIRED_FIELDS = Object.freeze([
  'documentId',
  'documentSlug',
  'documentVersion',
  'action',
  'state',
  ]);

/**

* Maximum lengths protect the backend from unexpectedly large string input.
  */
  const FIELD_LIMITS = Object.freeze({
  id: 128,
  documentId: 128,
  documentSlug: 256,
  documentTitle: 512,
  documentVersion: 128,
  userId: 128,
  tenantId: 128,
  organizationId: 128,
  sessionId: 256,
  requestId: 256,
  correlationId: 256,
  source: 64,
  subjectType: 64,
  acceptanceMethod: 64,
  locale: 32,
  timezone: 128,
  ipAddress: 128,
  userAgent: 2048,
  documentHash: 256,
  contentHash: 256,
  });

/* ============================================================================

* INTERNAL HELPERS
* ========================================================================== */

/**

* Check whether a value is a non-empty string.
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
  function normalizeString(value, maxLength) {
  if (!isNonEmptyString(value)) {
  return undefined;
  }

const normalized = value.trim();

if (
Number.isInteger(maxLength) &&
normalized.length > maxLength
) {
return normalized.slice(0, maxLength);
}

return normalized;
}

/**

* Parse a date into a canonical ISO string.
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

if (Number.isNaN(date.getTime())) {
return undefined;
}

return date.toISOString();
}

/**

* Return the current server timestamp.
*
* Kept as a function to make testing deterministic.
*
* @returns {string}
  */
  function now() {
  return new Date().toISOString();
  }

/**

* Generate a backend-local correlation identifier.
*
* If your infrastructure already provides a canonical request/correlation
* identifier, pass that value into the constructor instead.
*
* @returns {string}
  */
  function generateCorrelationId() {
  const timestamp =
  Date.now().toString(36);

if (
typeof globalThis !== 'undefined' &&
globalThis.crypto &&
typeof globalThis.crypto.randomUUID === 'function'
) {
return `legal-${timestamp}-${globalThis.crypto.randomUUID()}`;
}

return (
`legal-${timestamp}-` +
Math.random()
.toString(36)
.slice(2, 18)
);
}

/**

* Determine whether a value belongs to a supported enum.
*
* @param {*} value
* @param {Object} enumeration
* @returns {boolean}
  */
  function isEnumValue(value, enumeration) {
  return Object.values(enumeration)
  .includes(value);
  }

/**

* Create a structured domain validation error.
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
'LegalAcceptanceValidationError';

error.code =
'LEGAL_ACCEPTANCE_VALIDATION_ERROR';

error.errors =
Object.freeze([...errors]);

return error;
}

/**

* Convert an object to a plain serializable object.
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

return {
...value,
};
}

/* ============================================================================

* LEGAL ACCEPTANCE DOMAIN MODEL
* ========================================================================== */

class LegalAcceptance {
/**

* Construct a legal acceptance domain object.
*
* @param {Object} input
* @param {Object} options
  */
  constructor(input = {}, options = {}) {
  if (
  !input ||
  typeof input !== 'object'
  ) {
  throw new TypeError(
  'LegalAcceptance requires an object.'
  );
  }


const serverTimestamp =



  normalizeDate(
    options.serverTimestamp
  ) || now();

const action =
  normalizeString(
    input.action,
    FIELD_LIMITS.acceptanceMethod
  ) ||
  LEGAL_ACCEPTANCE_ACTIONS.ACCEPT;

const state =
  normalizeString(
    input.state,
    FIELD_LIMITS.acceptanceMethod
  ) ||
  LegalAcceptance.stateFromAction(action);

this.schemaVersion =
  Number.isInteger(input.schemaVersion)
    ? input.schemaVersion
    : LEGAL_ACCEPTANCE_SCHEMA_VERSION;

this.modelVersion =
  normalizeString(
    input.modelVersion,
    FIELD_LIMITS.documentVersion
  ) ||
  LEGAL_ACCEPTANCE_MODEL_VERSION;

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

this.documentSlug =
  normalizeString(
    input.documentSlug,
    FIELD_LIMITS.documentSlug
  );

this.documentTitle =
  normalizeString(
    input.documentTitle,
    FIELD_LIMITS.documentTitle
  );

this.documentVersion =
  normalizeString(
    input.documentVersion,
    FIELD_LIMITS.documentVersion
  );

this.action =
  action;

this.state =
  state;

/*
 * For ACCEPTED records, the authoritative acceptance timestamp should
 * normally be generated by the backend service.
 *
 * Controllers/services should preferably omit acceptedAt on client input
 * and let this model receive the trusted server timestamp.
 */
this.acceptedAt =
  normalizeDate(
    input.acceptedAt
  );

this.effectiveAt =
  normalizeDate(
    input.effectiveAt
  );

this.expiresAt =
  normalizeDate(
    input.expiresAt
  );

this.withdrawnAt =
  normalizeDate(
    input.withdrawnAt
  );

/*
 * Identity / tenancy.
 *
 * These should normally be populated by trusted authentication and
 * authorization middleware rather than blindly accepting client values.
 */
this.userId =
  normalizeString(
    input.userId,
    FIELD_LIMITS.userId
  );

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

this.subjectType =
  normalizeString(
    input.subjectType,
    FIELD_LIMITS.subjectType
  ) ||
  LEGAL_ACCEPTANCE_SUBJECT_TYPES.USER;

/*
 * Request/audit correlation.
 */
this.sessionId =
  normalizeString(
    input.sessionId,
    FIELD_LIMITS.sessionId
  );

this.requestId =
  normalizeString(
    input.requestId,
    FIELD_LIMITS.requestId
  );

this.correlationId =
  normalizeString(
    input.correlationId,
    FIELD_LIMITS.correlationId
  ) ||
  generateCorrelationId();

this.source =
  normalizeString(
    input.source,
    FIELD_LIMITS.source
  ) ||
  LEGAL_ACCEPTANCE_SOURCES.WEB;

this.acceptanceMethod =
  normalizeString(
    input.acceptanceMethod,
    FIELD_LIMITS.acceptanceMethod
  ) ||
  LEGAL_ACCEPTANCE_METHODS.CHECKBOX;

this.locale =
  normalizeString(
    input.locale,
    FIELD_LIMITS.locale
  );

this.timezone =
  normalizeString(
    input.timezone,
    FIELD_LIMITS.timezone
  );

/*
 * Network/device audit metadata.
 *
 * These fields should only be populated from trusted server-side request
 * metadata. Do not expose them unnecessarily through public API responses.
 */
this.ipAddress =
  normalizeString(
    input.ipAddress,
    FIELD_LIMITS.ipAddress
  );

this.userAgent =
  normalizeString(
    input.userAgent,
    FIELD_LIMITS.userAgent
  );

/*
 * Document integrity metadata.
 */
this.documentHash =
  normalizeString(
    input.documentHash,
    FIELD_LIMITS.documentHash
  );

this.contentHash =
  normalizeString(
    input.contentHash,
    FIELD_LIMITS.contentHash
  );

/*
 * Explicit user interaction evidence.
 */
this.checkboxConfirmed =
  input.checkboxConfirmed === true;

/*
 * Idempotency support.
 */
this.idempotencyKey =
  normalizeString(
    input.idempotencyKey,
    FIELD_LIMITS.requestId
  );

/*
 * Extensible metadata.
 *
 * Keep this intentionally generic but never use it as a replacement for
 * first-class security/audit fields.
 */
this.metadata =
  input.metadata &&
  typeof input.metadata === 'object'
    ? {
        ...input.metadata,
      }
    : {};

this.createdAt =
  normalizeDate(
    input.createdAt
  ) ||
  serverTimestamp;

this.updatedAt =
  normalizeDate(
    input.updatedAt
  ) ||
  serverTimestamp;


}

/* ==========================================================================

* STATIC FACTORIES
* ======================================================================== */

/**

* Build an acceptance record for a legal document.
*
* @param {Object} document
* @param {Object} options
* @returns {LegalAcceptance}
  */
  static accept(document, options = {}) {
  if (
  !document ||
  typeof document !== 'object'
  ) {
  throw new TypeError(
  'LegalAcceptance.accept requires a legal document.'
  );
  }

const serverTimestamp =



  normalizeDate(
    options.serverTimestamp
  ) || now();

return new LegalAcceptance(
  {
    ...options,

    documentId:
      options.documentId ||
      document.id,

    documentSlug:
      options.documentSlug ||
      document.slug,

    documentTitle:
      options.documentTitle ||
      document.title,

    documentVersion:
      options.documentVersion ||
      document.version,

    documentHash:
      options.documentHash ||
      document.contentHash,

    action:
      LEGAL_ACCEPTANCE_ACTIONS.ACCEPT,

    state:
      LEGAL_ACCEPTANCE_STATES.ACCEPTED,

    /*
     * Prefer server-generated timestamp.
     */
    acceptedAt:
      serverTimestamp,

    effectiveAt:
      options.effectiveAt ||
      serverTimestamp,
  },
  {
    serverTimestamp,
  }
);


}

/**

* Build a decline record.
*
* @param {Object} document
* @param {Object} options
* @returns {LegalAcceptance}
  */
  static decline(document, options = {}) {
  if (
  !document ||
  typeof document !== 'object'
  ) {
  throw new TypeError(
  'LegalAcceptance.decline requires a legal document.'
  );
  }


const serverTimestamp =



  normalizeDate(
    options.serverTimestamp
  ) || now();

return new LegalAcceptance(
  {
    ...options,

    documentId:
      options.documentId ||
      document.id,

    documentSlug:
      options.documentSlug ||
      document.slug,

    documentTitle:
      options.documentTitle ||
      document.title,

    documentVersion:
      options.documentVersion ||
      document.version,

    action:
      LEGAL_ACCEPTANCE_ACTIONS.DECLINE,

    state:
      LEGAL_ACCEPTANCE_STATES.DECLINED,

    acceptedAt:
      undefined,
  },
  {
    serverTimestamp,
  }
);


}

/**

* Build a withdrawal record.
*
* @param {Object} document
* @param {Object} options
* @returns {LegalAcceptance}
  */
  static withdraw(document, options = {}) {
  if (
  !document ||
  typeof document !== 'object'
  ) {
  throw new TypeError(
  'LegalAcceptance.withdraw requires a legal document.'
  );
  }


const serverTimestamp =



  normalizeDate(
    options.serverTimestamp
  ) || now();

return new LegalAcceptance(
  {
    ...options,

    documentId:
      options.documentId ||
      document.id,

    documentSlug:
      options.documentSlug ||
      document.slug,

    documentTitle:
      options.documentTitle ||
      document.title,

    documentVersion:
      options.documentVersion ||
      document.version,

    action:
      LEGAL_ACCEPTANCE_ACTIONS.WITHDRAW,

    state:
      LEGAL_ACCEPTANCE_STATES.WITHDRAWN,

    withdrawnAt:
      serverTimestamp,
  },
  {
    serverTimestamp,
  }
);

}

/**

* Hydrate a stored record.
*
* @param {Object} input
* @returns {LegalAcceptance}
  */
  static fromJSON(input) {
  return new LegalAcceptance(
  toPlainObject(input)
  );
  }

/**

* Derive lifecycle state from action.
*
* @param {string} action
* @returns {string}
  */
  static stateFromAction(action) {
  switch (action) {
  case LEGAL_ACCEPTANCE_ACTIONS.ACCEPT:
  return LEGAL_ACCEPTANCE_STATES.ACCEPTED;

  case LEGAL_ACCEPTANCE_ACTIONS.DECLINE:
  return LEGAL_ACCEPTANCE_STATES.DECLINED;

  case LEGAL_ACCEPTANCE_ACTIONS.WITHDRAW:
  return LEGAL_ACCEPTANCE_STATES.WITHDRAWN;

  default:
  return LEGAL_ACCEPTANCE_STATES.PENDING;
  }
  }

/* ==========================================================================

* VALIDATION
* ======================================================================== */

/**

* Validate the domain object.
*
* @param {Object} options
* @returns {{valid:boolean, errors:string, warnings:string}}
  */
  validate(options = {}) {
  const {
  requireSubject = true,
  requireTenant = false,
  requireAuditContext = true,
  requireExplicitConfirmation = false,
  } = options;


const errors = [];


const warnings = [];

for (const field of REQUIRED_FIELDS) {
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

if (
  this.id &&
  this.id.length > FIELD_LIMITS.id
) {
  errors.push(
    'id exceeds the maximum allowed length.'
  );
}

if (
  !isEnumValue(
    this.action,
    LEGAL_ACCEPTANCE_ACTIONS
  )
) {
  errors.push(
    `Unsupported acceptance action: ${this.action}.`
  );
}

if (
  !isEnumValue(
    this.state,
    LEGAL_ACCEPTANCE_STATES
  )
) {
  errors.push(
    `Unsupported acceptance state: ${this.state}.`
  );
}

if (
  !isEnumValue(
    this.subjectType,
    LEGAL_ACCEPTANCE_SUBJECT_TYPES
  )
) {
  errors.push(
    `Unsupported subject type: ${this.subjectType}.`
  );
}

if (
  !isEnumValue(
    this.source,
    LEGAL_ACCEPTANCE_SOURCES
  )
) {
  errors.push(
    `Unsupported acceptance source: ${this.source}.`
  );
}

if (
  !isEnumValue(
    this.acceptanceMethod,
    LEGAL_ACCEPTANCE_METHODS
  )
) {
  errors.push(
    `Unsupported acceptance method: ${this.acceptanceMethod}.`
  );
}

if (
  this.state ===
    LEGAL_ACCEPTANCE_STATES.ACCEPTED &&
  !this.acceptedAt
) {
  errors.push(
    'acceptedAt is required for an accepted record.'
  );
}

if (
  this.state ===
    LEGAL_ACCEPTANCE_STATES.WITHDRAWN &&
  !this.withdrawnAt
) {
  errors.push(
    'withdrawnAt is required for a withdrawn record.'
  );
}

if (
  this.state ===
    LEGAL_ACCEPTANCE_STATES.ACCEPTED &&
  this.action !==
    LEGAL_ACCEPTANCE_ACTIONS.ACCEPT
) {
  errors.push(
    'Accepted state requires the accept action.'
  );
}

if (
  this.state ===
    LEGAL_ACCEPTANCE_STATES.DECLINED &&
  this.action !==
    LEGAL_ACCEPTANCE_ACTIONS.DECLINE
) {
  errors.push(
    'Declined state requires the decline action.'
  );
}

if (
  this.state ===
    LEGAL_ACCEPTANCE_STATES.WITHDRAWN &&
  this.action !==
    LEGAL_ACCEPTANCE_ACTIONS.WITHDRAW
) {
  errors.push(
    'Withdrawn state requires the withdraw action.'
  );
}

if (requireSubject) {
  const hasSubject =
    Boolean(
      this.userId ||
      this.tenantId ||
      this.organizationId
    );

  if (!hasSubject) {
    errors.push(
      'A legal acceptance must identify a subject.'
    );
  }
}

if (
  requireTenant &&
  !this.tenantId
) {
  errors.push(
    'tenantId is required for this acceptance workflow.'
  );
}

if (
  requireAuditContext &&
  !this.correlationId
) {
  errors.push(
    'correlationId is required for audit traceability.'
  );
}

if (
  requireExplicitConfirmation &&
  this.state ===
    LEGAL_ACCEPTANCE_STATES.ACCEPTED &&
  !this.checkboxConfirmed
) {
  errors.push(
    'Explicit acceptance confirmation is required.'
  );
}

if (
  this.acceptedAt &&
  this.effectiveAt &&
  new Date(this.effectiveAt) <
    new Date(this.acceptedAt)
) {
  errors.push(
    'effectiveAt cannot precede acceptedAt.'
  );
}

if (
  this.expiresAt &&
  this.acceptedAt &&
  new Date(this.expiresAt) <=
    new Date(this.acceptedAt)
) {
  errors.push(
    'expiresAt must occur after acceptedAt.'
  );
}

if (
  this.withdrawnAt &&
  this.acceptedAt &&
  new Date(this.withdrawnAt) <
    new Date(this.acceptedAt)
) {
  errors.push(
    'withdrawnAt cannot precede acceptedAt.'
  );
}

if (
  this.state ===
    LEGAL_ACCEPTANCE_STATES.ACCEPTED &&
  !this.documentHash &&
  !this.contentHash
) {
  warnings.push(
    'No document/content integrity hash is recorded.'
  );
}

if (
  this.state ===
    LEGAL_ACCEPTANCE_STATES.ACCEPTED &&
  !this.requestId
) {
  warnings.push(
    'requestId is not recorded.'
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

* Assert validity.
*
* @param {Object} options
* @returns {LegalAcceptance}
  */
  assertValid(options = {}) {
  const result =
  this.validate(options);


if (!result.valid) {



  throw createValidationError(
    'Invalid legal acceptance record.',
    result.errors
  );
}

return this;


}

/* ==========================================================================

* STATE HELPERS
* ======================================================================== */

/**

* Whether the record represents acceptance.
*
* @returns {boolean}
  */
  isAccepted() {
  return (
  this.state ===
  LEGAL_ACCEPTANCE_STATES.ACCEPTED
  );
  }

/**

* Whether the record represents a decline.
*
* @returns {boolean}
  */
  isDeclined() {
  return (
  this.state ===
  LEGAL_ACCEPTANCE_STATES.DECLINED
  );
  }

/**

* Whether the record has been withdrawn.
*
* @returns {boolean}
  */
  isWithdrawn() {
  return (
  this.state ===
  LEGAL_ACCEPTANCE_STATES.WITHDRAWN
  );
  }

/**

* Determine whether an accepted record is currently effective.
*
* @param {Date|string} currentTime
* @returns {boolean}
  */
  isActive(currentTime = new Date()) {
  if (!this.isAccepted()) {
  return false;
  }


const current =



  currentTime instanceof Date
    ? currentTime
    : new Date(currentTime);

if (Number.isNaN(current.getTime())) {
  return false;
}

if (this.effectiveAt) {
  if (
    current <
    new Date(this.effectiveAt)
  ) {
    return false;
  }
}

if (this.expiresAt) {
  if (
    current >=
    new Date(this.expiresAt)
  ) {
    return false;
  }
}

if (this.withdrawnAt) {
  if (
    current >=
    new Date(this.withdrawnAt)
  ) {
    return false;
  }
}

return true;


}

/**

* Check whether the acceptance belongs to a document/version.
*
* @param {Object} document
* @returns {boolean}
  */
  matchesDocument(document) {
  if (
  !document ||
  typeof document !== 'object'
  ) {
  return false;
  }


return (



  this.documentId === document.id &&
  this.documentSlug === document.slug &&
  this.documentVersion === document.version
);


}

/**

* Determine whether the acceptance is obsolete for the supplied document.
*
* @param {Object} document
* @returns {boolean}
  */
  isOutdatedFor(document) {
  if (
  !document ||
  typeof document !== 'object'
  ) {
  return false;
  }


return (



  this.documentId === document.id &&
  this.documentSlug === document.slug &&
  this.documentVersion !== document.version
);


}

/* ==========================================================================

* SERIALIZATION
* ======================================================================== */

/**

* Convert into a persistence-safe plain object.
*
* This contains audit information and therefore should NOT be sent directly
* to an untrusted client.
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

  documentSlug:
  this.documentSlug,

  documentTitle:
  this.documentTitle,

  documentVersion:
  this.documentVersion,

  action:
  this.action,

  state:
  this.state,

  acceptedAt:
  this.acceptedAt,

  effectiveAt:
  this.effectiveAt,

  expiresAt:
  this.expiresAt,

  withdrawnAt:
  this.withdrawnAt,

  userId:
  this.userId,

  tenantId:
  this.tenantId,

  organizationId:
  this.organizationId,

  subjectType:
  this.subjectType,

  sessionId:
  this.sessionId,

  requestId:
  this.requestId,

  correlationId:
  this.correlationId,

  source:
  this.source,

  acceptanceMethod:
  this.acceptanceMethod,

  locale:
  this.locale,

  timezone:
  this.timezone,

  ipAddress:
  this.ipAddress,

  userAgent:
  this.userAgent,

  documentHash:
  this.documentHash,

  contentHash:
  this.contentHash,

  checkboxConfirmed:
  this.checkboxConfirmed,

  idempotencyKey:
  this.idempotencyKey,

  metadata:
  {
  ...this.metadata,
  },

  createdAt:
  this.createdAt,

  updatedAt:
  this.updatedAt,
  };
  }

/**

* Return a sanitized representation suitable for API responses.
*
* Sensitive network/device audit fields are intentionally omitted.
*
* @returns {Object}
  */
  toPublicObject() {
  return {
  id:
  this.id,

  documentId:
  this.documentId,

  documentSlug:
  this.documentSlug,

  documentTitle:
  this.documentTitle,

  documentVersion:
  this.documentVersion,

  action:
  this.action,

  state:
  this.state,

  acceptedAt:
  this.acceptedAt,

  effectiveAt:
  this.effectiveAt,

  expiresAt:
  this.expiresAt,

  withdrawnAt:
  this.withdrawnAt,

  source:
  this.source,

  acceptanceMethod:
  this.acceptanceMethod,

  createdAt:
  this.createdAt,

  updatedAt:
  this.updatedAt,
  };
  }

/**

* Return a minimal acceptance payload for internal service operations.
*
* @returns {Object}
  */
  toAcceptancePayload() {
  return {
  documentId:
  this.documentId,

  documentSlug:
  this.documentSlug,

  documentVersion:
  this.documentVersion,

  action:
  this.action,

  state:
  this.state,

  acceptedAt:
  this.acceptedAt,

  effectiveAt:
  this.effectiveAt,

  source:
  this.source,

  acceptanceMethod:
  this.acceptanceMethod,

  checkboxConfirmed:
  this.checkboxConfirmed,

  requestId:
  this.requestId,

  correlationId:
  this.correlationId,

  idempotencyKey:
  this.idempotencyKey,
  };
  }

/**

* JSON serialization.
*
* Defaults to the persistence representation for internal server use.
*
* @returns {Object}
  */
  toJSON() {
  return this.toPersistenceObject();
  }

/**

* Clone the domain object.
*
* @returns {LegalAcceptance}
  */
  clone() {
  return new LegalAcceptance(
  this.toPersistenceObject()
  );
  }
  }

/* ============================================================================

* FUNCTIONAL API
* ========================================================================== */

/**

* Create a legal acceptance.
*
* @param {Object} input
* @param {Object} options
* @returns {LegalAcceptance}
  */
  function createLegalAcceptance(
  input = {},
  options = {}
  ) {
  return new LegalAcceptance(
  input,
  options
  );
  }

/**

* Normalize an acceptance record.
*
* @param {Object} input
* @param {Object} options
* @returns {LegalAcceptance}
  */
  function normalizeLegalAcceptance(
  input = {},
  options = {}
  ) {
  return new LegalAcceptance(
  input,
  options
  );
  }

/**

* Validate an acceptance payload without throwing.
*
* @param {Object} input
* @param {Object} options
* @returns {{valid:boolean,errors:string,warnings:string}}
  */
  function validateLegalAcceptance(
  input = {},
  options = {}
  ) {
  try {
  return new LegalAcceptance(
  input,
  options
  ).validate(options);
  } catch (error) {
  return {
  valid: false,

  errors: [
  error.message ||
  'Unable to validate legal acceptance.',
  ],

  warnings: [],
  };
  }
  }

/**

* Assert an acceptance payload.
*
* @param {Object} input
* @param {Object} options
* @returns {LegalAcceptance}
  */
  function assertLegalAcceptance(
  input = {},
  options = {}
  ) {
  return new LegalAcceptance(
  input,
  options
  ).assertValid(options);
  }

/* ============================================================================

* COMPARISON HELPERS
* ========================================================================== */

/**

* Determine whether two records reference the exact same legal document
* version.
*
* @param {LegalAcceptance|Object} left
* @param {LegalAcceptance|Object} right
* @returns {boolean}
  */
  function isSameLegalDocumentVersion(
  left,
  right
  ) {
  if (!left || !right) {
  return false;
  }

return (
left.documentId === right.documentId &&
left.documentSlug === right.documentSlug &&
left.documentVersion === right.documentVersion
);
}

/**

* Determine whether a legal acceptance satisfies the current document.
*
* @param {LegalAcceptance|Object} acceptance
* @param {Object} document
* @param {Object} options
* @returns {boolean}
  */
  function isCurrentLegalAcceptance(
  acceptance,
  document,
  options = {}
  ) {
  if (
  !acceptance ||
  !document
  ) {
  return false;
  }

const model =
acceptance instanceof LegalAcceptance
? acceptance
: new LegalAcceptance(acceptance);

return (
model.matchesDocument(document) &&
model.isActive(
options.now || new Date()
)
);
}

/* ============================================================================

* SECURITY / SANITIZATION
* ========================================================================== */

/**

* Remove sensitive audit fields before logging or public exposure.
*
* @param {LegalAcceptance|Object} acceptance
* @returns {Object}
  */
  function sanitizeLegalAcceptance(
  acceptance
  ) {
  const model =
  acceptance instanceof LegalAcceptance
  ? acceptance
  : new LegalAcceptance(acceptance);

return model.toPublicObject();
}

/**

* Extract a safe audit summary.
*
* This is intentionally smaller than the persistence object and avoids
* exposing document metadata unnecessarily.
*
* @param {LegalAcceptance|Object} acceptance
* @returns {Object}
  */
  function getLegalAcceptanceAuditSummary(
  acceptance
  ) {
  const model =
  acceptance instanceof LegalAcceptance
  ? acceptance
  : new LegalAcceptance(acceptance);

return {
acceptanceId:
model.id,


documentId:
  model.documentId,

documentSlug:
  model.documentSlug,

documentVersion:
  model.documentVersion,

state:
  model.state,

action:
  model.action,

userId:
  model.userId,

tenantId:
  model.tenantId,

organizationId:
  model.organizationId,

subjectType:
  model.subjectType,

requestId:
  model.requestId,

correlationId:
  model.correlationId,

source:
  model.source,

acceptedAt:
  model.acceptedAt,

effectiveAt:
  model.effectiveAt,

withdrawnAt:
  model.withdrawnAt,


};
}

/* ============================================================================

* MODULE EXPORTS
* ========================================================================== */

module.exports = {
LegalAcceptance,

LEGAL_ACCEPTANCE_MODEL_VERSION,

LEGAL_ACCEPTANCE_SCHEMA_VERSION,

LEGAL_ACCEPTANCE_ACTIONS,

LEGAL_ACCEPTANCE_STATES,

LEGAL_ACCEPTANCE_SUBJECT_TYPES,

LEGAL_ACCEPTANCE_SOURCES,

LEGAL_ACCEPTANCE_METHODS,

REQUIRED_FIELDS,

FIELD_LIMITS,

createLegalAcceptance,

normalizeLegalAcceptance,

validateLegalAcceptance,

assertLegalAcceptance,

isSameLegalDocumentVersion,

isCurrentLegalAcceptance,

sanitizeLegalAcceptance,

getLegalAcceptanceAuditSummary,
};

/**

* ============================================================================
* END OF FILE
* ============================================================================
  */