/**
* ============================================================================
* TITech Community Capital Ltd
* Enterprise Legal Controller
* ============================================================================
*
* File:
* backend/legal/controllers/legalController.js
*
* Version:
* 2.0.0
*
* Purpose:
* HTTP/application boundary for TITech Community Capital legal documents,
* legal-document versions, legal acceptance, and legal compliance status.
*
* Controller contract required by:
* backend/routes/legal.routes.js
*
* Required handlers:
* ✓ getTermsOfService
* ✓ getPrivacyPolicy
* ✓ getChangelog
* ✓ acceptTermsAndPrivacy
* ✓ getAcceptanceStatus
*
* Architectural principles:
* ✓ Controller does not contain substantive legal wording.
* ✓ Controller does not perform direct MongoDB queries.
* ✓ Published legal versions are treated as immutable.
* ✓ Acceptance references an exact legal version.
* ✓ Authenticated identity comes from trusted middleware context.
* ✓ Client-supplied userId/tenantId are never authoritative.
* ✓ Tenant isolation is preserved.
* ✓ Legal acceptance is idempotency-aware.
* ✓ Audit events are emitted through the audit dependency.
* ✓ Internal errors are not leaked to clients.
* ✓ Request/correlation identifiers are propagated.
* ✓ Public legal content is safely serialized.
* ✓ Version resolution is explicit.
* ✓ Designed for future CMS/API integration.
* ✓ Designed for automated compliance validation.
* ✓ TITech terminology is used consistently.
*
* IMPORTANT:
* This controller does not determine whether TITech Community Capital Ltd
* is licensed, regulated, authorized, or legally permitted to conduct any
* particular financial activity.
*
* Legacy terminology:
* ACFOS terminology must not be introduced into this module.
*
* ============================================================================
  */

'use strict';

const crypto = require('node:crypto');

/**

* ============================================================================
* METADATA
* ============================================================================
  */

const CONTROLLER_NAME =
'TITechLegalController';

const CONTROLLER_VERSION =
'2026.2';

const SERVICE_NAME =
'TITech Legal API';

const COMPANY_NAME =
'TITech Community Capital Ltd';

const DEFAULT_COUNTRY_CODE =
'UG';

const DEFAULT_LANGUAGE =
'en';

const DEFAULT_VERSION =
'1.0';

const MAX_PAGE_SIZE =
100;

/**

* ============================================================================
* DOCUMENT IDENTIFIERS
* ============================================================================
  */

const LEGAL_DOCUMENT_IDS =
Object.freeze({
TERMS_OF_SERVICE:
'terms-of-service',


PRIVACY_POLICY:
  'privacy-policy',


});

/**

* ============================================================================
* HTTP STATUS CODES
* ============================================================================
  */

const HTTP_STATUS =
Object.freeze({
OK: 200,
CREATED: 201,
NO_CONTENT: 204,


BAD_REQUEST: 400,
UNAUTHORIZED: 401,
FORBIDDEN: 403,
NOT_FOUND: 404,
CONFLICT: 409,
UNPROCESSABLE_ENTITY: 422,
TOO_MANY_REQUESTS: 429,

INTERNAL_SERVER_ERROR: 500,
SERVICE_UNAVAILABLE: 503,


});

/**

* ============================================================================
* ERROR CODES
* ============================================================================
  */

const ERROR_CODES =
Object.freeze({
LEGAL_DOCUMENT_NOT_FOUND:
'LEGAL_DOCUMENT_NOT_FOUND',


LEGAL_VERSION_NOT_FOUND:
  'LEGAL_VERSION_NOT_FOUND',

LEGAL_DOCUMENT_UNAVAILABLE:
  'LEGAL_DOCUMENT_UNAVAILABLE',

LEGAL_ACCEPTANCE_REQUIRED:
  'LEGAL_ACCEPTANCE_REQUIRED',

LEGAL_ACCEPTANCE_INVALID:
  'LEGAL_ACCEPTANCE_INVALID',

LEGAL_ACCEPTANCE_ALREADY_RECORDED:
  'LEGAL_ACCEPTANCE_ALREADY_RECORDED',

LEGAL_ACCEPTANCE_CONFLICT:
  'LEGAL_ACCEPTANCE_CONFLICT',

LEGAL_IDENTITY_UNAVAILABLE:
  'LEGAL_IDENTITY_UNAVAILABLE',

LEGAL_TENANT_CONTEXT_UNAVAILABLE:
  'LEGAL_TENANT_CONTEXT_UNAVAILABLE',

LEGAL_DEPENDENCY_UNAVAILABLE:
  'LEGAL_DEPENDENCY_UNAVAILABLE',

LEGAL_INTERNAL_ERROR:
  'LEGAL_INTERNAL_ERROR',

LEGAL_REQUEST_ERROR:
  'LEGAL_REQUEST_ERROR',


});

/**

* ============================================================================
* STATUS CONSTANTS
* ============================================================================
  */

const PUBLISHED_STATUSES =
Object.freeze([
'published',
'active',
]);

const APPROVED_STATUSES =
Object.freeze([
'approved',
'published',
'active',
]);

const ACCEPTANCE_ELIGIBLE_STATUSES =
Object.freeze([
'published',
'active',
]);

/**

* ============================================================================
* CONTROLLER ERROR
* ============================================================================
  */

class LegalControllerError extends Error {
constructor(
message,
{
statusCode =
HTTP_STATUS.INTERNAL_SERVER_ERROR,


  code =
    ERROR_CODES.LEGAL_INTERNAL_ERROR,

  details = null,

  cause = null,
} = {}


) {
super(message);


this.name =
  'LegalControllerError';

this.statusCode =
  statusCode;

this.code =
  code;

this.details =
  details;

if (cause) {
  this.cause =
    cause;
}

Error.captureStackTrace?.(
  this,
  LegalControllerError
);


}
}

/**

* ============================================================================
* GENERIC HELPERS
* ============================================================================
  */

function normalizeString(
value,
fallback = null
) {
if (
value === undefined ||
value === null
) {
return fallback;
}

const normalized =
String(value).trim();

return normalized ||
fallback;
}

function normalizeLowerString(
value,
fallback = null
) {
const normalized =
normalizeString(
value,
fallback
);

return normalized
? normalized.toLowerCase()
: fallback;
}

function normalizeBoolean(
value,
fallback = false
) {
return typeof value === 'boolean'
? value
: fallback;
}

function normalizePositiveInteger(
value,
fallback = 1,
maximum = MAX_PAGE_SIZE
) {
const parsed =
Number(value);

if (
!Number.isInteger(parsed) ||
parsed < 1
) {
return fallback;
}

return Math.min(
parsed,
maximum
);
}

function now() {
return new Date();
}

function nowISOString() {
return now().toISOString();
}

function generateRequestId() {
return crypto.randomUUID();
}

function safeErrorMessage(
error
) {
return normalizeString(
error?.message
) ||
'Unexpected error.';
}

function isFunction(
value
) {
return typeof value === 'function';
}

function firstFunction(
object,
names = []
) {
for (
const name of names
) {
if (
object &&
isFunction(
object[name]
)
) {
return object[name].bind(
object
);
}
}

return null;
}

/**

* ============================================================================
* REQUEST CONTEXT
* ============================================================================
*
* Authentication middleware may expose identity under different names in the
* existing application. This resolver deliberately supports common patterns
* without trusting request-body identity fields.
* ============================================================================
  */

function getAuthenticatedUser(
req
) {
return (
req?.user ||
req?.auth?.user ||
req?.authenticatedUser ||
req?.auth?.principal ||
null
);
}

function getAuthenticatedUserId(
req
) {
const user =
getAuthenticatedUser(req);

return normalizeString(
user?.id ||
user?._id ||
user?.userId ||
req?.userId ||
req?.auth?.userId
);
}

function getAuthenticatedTenantId(
req
) {
const user =
getAuthenticatedUser(req);

return normalizeString(
req?.tenantId ||
req?.tenant?.id ||
req?.tenant?._id ||
req?.auth?.tenantId ||
user?.tenantId ||
user?.tenant?.id
);
}

function getActorRole(
req
) {
const user =
getAuthenticatedUser(req);

return normalizeString(
user?.role ||
user?.roles?.[0] ||
req?.auth?.role ||
req?.role
);
}

function getActorEmail(
req
) {
const user =
getAuthenticatedUser(req);

return normalizeString(
user?.email ||
req?.auth?.email
);
}

function getActorName(
req
) {
const user =
getAuthenticatedUser(req);

return normalizeString(
user?.name ||
user?.fullName ||
req?.auth?.name
);
}

function getRequestId(
req
) {
return (
normalizeString(
req?.requestId
) ||
normalizeString(
req?.id
) ||
normalizeString(
req?.headers?.[
'x-request-id'
]
) ||
generateRequestId()
);
}

function getCorrelationId(
req
) {
return (
normalizeString(
req?.correlationId
) ||
normalizeString(
req?.headers?.[
'x-correlation-id'
]
) ||
getRequestId(req)
);
}

function buildRequestContext(
req
) {
const requestId =
getRequestId(req);

const correlationId =
getCorrelationId(req);

return {
requestId,
correlationId,

userId:
  getAuthenticatedUserId(req),

tenantId:
  getAuthenticatedTenantId(req),

role:
  getActorRole(req),

actorEmail:
  getActorEmail(req),

actorName:
  getActorName(req),

ipAddress:
  normalizeString(
    req?.ip ||
    req?.headers?.[
      'x-forwarded-for'
    ]
  ),

userAgent:
  normalizeString(
    req?.headers?.[
      'user-agent'
    ]
  ),

method:
  req?.method,

path:
  req?.originalUrl ||
  req?.path,


};
}

/**

* ============================================================================
* RESPONSE HELPERS
* ============================================================================
  */

function sendSuccess(
res,
{
statusCode =
HTTP_STATUS.OK,


data = null,

message = null,

meta = null,

requestId = null,

correlationId = null,


} = {}
) {
const response = {
success:
true,


...(message
  ? {
      message,
    }
  : {}),

...(data !== null
  ? {
      data,
    }
  : {}),

...(meta
  ? {
      meta,
    }
  : {}),

requestId,

correlationId,

timestamp:
  nowISOString(),


};

return res
.status(statusCode)
.json(response);
}

function sendError(
res,
{
statusCode =
HTTP_STATUS.INTERNAL_SERVER_ERROR,


code =
  ERROR_CODES.LEGAL_INTERNAL_ERROR,

message =
  'The legal request could not be completed.',

details = null,

requestId = null,

correlationId = null,


} = {}
) {
const response = {
success:
false,


code,

message,

...(details
  ? {
      details,
    }
  : {}),

requestId,

correlationId,

timestamp:
  nowISOString(),


};

return res
.status(statusCode)
.json(response);
}

/**

* ============================================================================
* ERROR NORMALIZATION
* ============================================================================
  */

function normalizeControllerError(
error
) {
if (
error instanceof
LegalControllerError
) {
return error;
}

const statusCode =
Number(
error?.statusCode ||
error?.status
);

if (
statusCode >= 400 &&
statusCode < 600
) {
return new LegalControllerError(
safeErrorMessage(error),
{
statusCode,
code:
normalizeString(
error?.code
) ||
(
statusCode < 500
? ERROR_CODES.LEGAL_REQUEST_ERROR
: ERROR_CODES.LEGAL_INTERNAL_ERROR
),


    details:
      statusCode < 500
        ? error?.details ||
          null
        : null,

    cause:
      error,
  }
);


}

return new LegalControllerError(
'The legal request could not be completed.',
{
statusCode:
HTTP_STATUS.INTERNAL_SERVER_ERROR,


  code:
    ERROR_CODES.LEGAL_INTERNAL_ERROR,

  cause:
    error,
}


);
}

/**

* ============================================================================
* SAFE DOCUMENT SERIALIZATION
* ============================================================================
*
* The controller never blindly returns a Mongoose document or internal model
* object. It uses the strongest available public serializer.
* ============================================================================
  */

function toPlainObject(
value
) {
if (
value === undefined ||
value === null
) {
return null;
}

if (
isFunction(
value.toPublicObject
)
) {
return value.toPublicObject({
includeContent:
true,
});
}

if (
isFunction(
value.toPublicJSON
)
) {
return value.toPublicJSON();
}

if (
isFunction(
value.toJSON
)
) {
return value.toJSON();
}

if (
isFunction(
value.toObject
)
) {
return value.toObject();
}

if (
typeof value === 'object'
) {
return {
...value,
};
}

return value;
}

function sanitizeLegalDocument(
document
) {
const source =
toPlainObject(document);

if (
!source ||
typeof source !== 'object'
) {
return source;
}

/*

* Never expose internal persistence identifiers unless explicitly required
* by the legal API contract.
  */
  const sanitized = {
  id:
  source.id ||
  source.documentId ||
  source._id,


documentId:



  source.documentId ||
  source.id ||
  source._id,

slug:
  source.slug,

title:
  source.title,

shortTitle:
  source.shortTitle,

description:
  source.description,

version:
  source.version ||
  source.currentVersion ||
  DEFAULT_VERSION,

status:
  source.status,

publicationStatus:
  source.publicationStatus,

effectiveDate:
  source.effectiveDate,

publicationDate:
  source.publicationDate,

expiryDate:
  source.expiryDate,

jurisdiction:
  source.jurisdiction ||
  'Uganda',

countryCode:
  source.countryCode ||
  DEFAULT_COUNTRY_CODE,

language:
  source.language ||
  DEFAULT_LANGUAGE,

acceptanceRequired:
  normalizeBoolean(
    source.acceptanceRequired ??
    source.requiresAcceptance,
    false
  ),

requiresExplicitConsent:
  normalizeBoolean(
    source.requiresExplicitConsent,
    false
  ),

contentType:
  source.contentType,

content:
  typeof source.content ===
  'string'
    ? source.content
    : undefined,

contentHash:
  source.contentHash,

documentHash:
  source.documentHash,

canonicalUrl:
  source.canonicalUrl,

publicPath:
  source.publicPath,

legalContactEmail:
  source.legalContactEmail,

legalContactPhone:
  source.legalContactPhone,

updatedAt:
  source.updatedAt,


};

/*

* Remove undefined values while preserving false and null.
  */
  return Object.fromEntries(
  Object.entries(
  sanitized
  ).filter(
  ([, value]) =>
  value !== undefined
  )
  );
  }

function sanitizeLegalVersion(
version
) {
const source =
toPlainObject(version);

if (
!source ||
typeof source !== 'object'
) {
return source;
}

return {
id:
source.id ||
source._id,


documentId:
  source.documentId,

slug:
  source.slug,

title:
  source.title,

shortTitle:
  source.shortTitle,

version:
  source.version,

versionLabel:
  source.versionLabel,

status:
  source.status,

publicationStatus:
  source.publicationStatus,

effectiveDate:
  source.effectiveDate,

publicationDate:
  source.publicationDate,

expiryDate:
  source.expiryDate,

jurisdiction:
  source.jurisdiction ||
  'Uganda',

countryCode:
  source.countryCode ||
  DEFAULT_COUNTRY_CODE,

language:
  source.language ||
  DEFAULT_LANGUAGE,

acceptanceRequired:
  normalizeBoolean(
    source.acceptanceRequired ??
    source.requiresAcceptance,
    false
  ),

requiresExplicitConsent:
  normalizeBoolean(
    source.requiresExplicitConsent,
    false
  ),

contentType:
  source.contentType,

content:
  typeof source.content ===
  'string'
    ? source.content
    : undefined,

contentHash:
  source.contentHash,

documentHash:
  source.documentHash,

canonicalUrl:
  source.canonicalUrl,

publicPath:
  source.publicPath,

legalContactEmail:
  source.legalContactEmail,

legalContactPhone:
  source.legalContactPhone,

createdAt:
  source.createdAt,

updatedAt:
  source.updatedAt,


};
}

/**

* ============================================================================
* PUBLICATION HELPERS
* ============================================================================
  */

function isPublished(
document
) {
const source =
toPlainObject(document);

const status =
normalizeLowerString(
source?.status
);

const publicationStatus =
normalizeLowerString(
source?.publicationStatus
);

return (
PUBLISHED_STATUSES.includes(
status
) ||
PUBLISHED_STATUSES.includes(
publicationStatus
) ||
source?.published === true ||
source?.public === true &&
PUBLISHED_STATUSES.includes(
status
)
);
}

function isAcceptanceEligible(
version
) {
const source =
toPlainObject(version);

if (!source) {
return false;
}

const status =
normalizeLowerString(
source.status
);

const publicationStatus =
normalizeLowerString(
source.publicationStatus
);

const published =
PUBLISHED_STATUSES.includes(
status
) ||
PUBLISHED_STATUSES.includes(
publicationStatus
) ||
source.published === true;

if (!published) {
return false;
}

if (
source.expiryDate &&
new Date(
source.expiryDate
) <= now()
) {
return false;
}

return true;
}

/**

* ============================================================================
* DEPENDENCY ADAPTER
* ============================================================================
*
* Supports repositories/services exposing different method names while keeping
* the controller independent from persistence implementation details.
* ============================================================================
  */

class LegalDependencyAdapter {
constructor(
dependencies = {}
) {
this.legalService =
dependencies.legalService ||
dependencies.service ||
null;


this.documentRepository =
  dependencies.documentRepository ||
  dependencies.legalDocumentRepository ||
  null;

this.versionRepository =
  dependencies.versionRepository ||
  dependencies.legalDocumentVersionRepository ||
  null;

this.acceptanceService =
  dependencies.acceptanceService ||
  null;

this.acceptanceRepository =
  dependencies.acceptanceRepository ||
  dependencies.legalAcceptanceRepository ||
  null;

this.auditService =
  dependencies.auditService ||
  dependencies.legalAuditService ||
  null;

this.auditRepository =
  dependencies.auditRepository ||
  dependencies.legalAuditRepository ||
  null;


}

/**

* Resolve a public legal document.
  */
  async findDocument(
  {
  documentId,
  slug,
  tenantId,
  language,
  countryCode,
  includeContent = true,
  } = {}
  ) {
  const serviceMethod =
  firstFunction(
  this.legalService,
  [
  'getPublishedDocument',
  'getPublicDocument',
  'findPublishedDocument',
  'findPublicDocument',
  'getDocument',
  ]
  );


if (serviceMethod) {



  return serviceMethod({
    documentId,
    slug,
    tenantId,
    language,
    countryCode,
    includeContent,
  });
}

const repositoryMethod =
  firstFunction(
    this.documentRepository,
    [
      'findPublished',
      'findPublic',
      'findBySlug',
      'findById',
      'findOne',
    ]
  );

if (!repositoryMethod) {
  throw new LegalControllerError(
    'Legal document dependency is unavailable.',
    {
      statusCode:
        HTTP_STATUS.SERVICE_UNAVAILABLE,

      code:
        ERROR_CODES.LEGAL_DEPENDENCY_UNAVAILABLE,
    }
  );
}

if (
  slug &&
  (
    repositoryMethod.name ===
    'bound findBySlug'
  )
) {
  return repositoryMethod(
    slug
  );
}

return repositoryMethod({
  documentId,
  slug,
  tenantId,
  language,
  countryCode,
  includeContent,
  status: {
    $in:
      PUBLISHED_STATUSES,
  },
});


}

/**

* Resolve the effective published version.
  */
  async findEffectiveVersion(
  {
  documentId,
  slug,
  version,
  tenantId,
  language,
  countryCode,
  at = now(),
  } = {}
  ) {
  const serviceMethod =
  firstFunction(
  this.legalService,
  [
  'getEffectiveVersion',
  'getCurrentPublishedVersion',
  'findEffectiveVersion',
  'findCurrentPublishedVersion',
  ]
  );


if (serviceMethod) {



  return serviceMethod({
    documentId,
    slug,
    version,
    tenantId,
    language,
    countryCode,
    at,
  });
}

const repositoryMethod =
  firstFunction(
    this.versionRepository,
    [
      'findEffective',
      'findCurrentPublished',
      'findPublishedVersion',
      'findByVersion',
      'findOne',
    ]
  );

if (!repositoryMethod) {
  return null;
}

return repositoryMethod({
  documentId,
  slug,
  version,
  tenantId,
  language,
  countryCode,

  status: {
    $in:
      ACCEPTANCE_ELIGIBLE_STATUSES,
  },

  effectiveDate: {
    $lte:
      at,
  },

  $or: [
    {
      expiryDate: null,
    },
    {
      expiryDate: {
        $gt:
          at,
      },
    },
  ],
});


}

/**

* Find legal-document versions for changelog.
  */
  async findVersions(
  {
  documentId,
  tenantId,
  page = 1,
  limit = 50,
  } = {}
  ) {
  const serviceMethod =
  firstFunction(
  this.legalService,
  [
  'getVersionHistory',
  'getChangelog',
  'listVersions',
  'findVersions',
  ]
  );


if (serviceMethod) {



  return serviceMethod({
    documentId,
    tenantId,
    page,
    limit,
  });
}

const repositoryMethod =
  firstFunction(
    this.versionRepository,
    [
      'findHistory',
      'findByDocumentId',
      'find',
      'list',
    ]
  );

if (!repositoryMethod) {
  return [];
}

return repositoryMethod(
  {
    documentId,
    tenantId,
  },
  {
    page,
    limit,
    sort: {
      publicationDate:
        -1,
      versionNumber:
        -1,
      createdAt:
        -1,
    },
  }
);


}

/**

* Find acceptance status.
  */
  async findAcceptanceStatus(
  {
  userId,
  tenantId,
  documentIds,
  } = {}
  ) {
  const serviceMethod =
  firstFunction(
  this.acceptanceService,
  [
  'getAcceptanceStatus',
  'getUserAcceptanceStatus',
  'findStatus',
  ]
  ) ||
  firstFunction(
  this.legalService,
  [
  'getAcceptanceStatus',
  'getUserAcceptanceStatus',
  ]
  );


if (serviceMethod) {



  return serviceMethod({
    userId,
    tenantId,
    documentIds,
  });
}

const repositoryMethod =
  firstFunction(
    this.acceptanceRepository,
    [
      'getAcceptanceStatus',
      'findStatus',
      'findLatestByUser',
      'findByUser',
      'find',
    ]
  );

if (!repositoryMethod) {
  throw new LegalControllerError(
    'Legal acceptance dependency is unavailable.',
    {
      statusCode:
        HTTP_STATUS.SERVICE_UNAVAILABLE,

      code:
        ERROR_CODES.LEGAL_DEPENDENCY_UNAVAILABLE,
    }
  );
}

return repositoryMethod({
  userId,
  tenantId,
  documentIds,
});


}

/**

* Record legal acceptance.
  */
  async recordAcceptance(
  payload,
  options = {}
  ) {
  const serviceMethod =
  firstFunction(
  this.acceptanceService,
  [
  'recordAcceptance',
  'createAcceptance',
  'accept',
  'record',
  ]
  ) ||
  firstFunction(
  this.legalService,
  [
  'recordAcceptance',
  'createAcceptance',
  'acceptLegalDocuments',
  ]
  );


if (serviceMethod) {



  return serviceMethod(
    payload,
    options
  );
}

const repositoryMethod =
  firstFunction(
    this.acceptanceRepository,
    [
      'createIfAbsent',
      'recordAcceptance',
      'create',
    ]
  );

if (!repositoryMethod) {
  throw new LegalControllerError(
    'Legal acceptance dependency is unavailable.',
    {
      statusCode:
        HTTP_STATUS.SERVICE_UNAVAILABLE,

      code:
        ERROR_CODES.LEGAL_DEPENDENCY_UNAVAILABLE,
    }
  );
}

return repositoryMethod(
  payload,
  options
);


}

/**

* Record an audit event.
  */
  async recordAuditEvent(
  payload
  ) {
  const method =
  firstFunction(
  this.auditService,
  [
  'recordLegalEvent',
  'recordEvent',
  'createEvent',
  'append',
  'record',
  ]
  ) ||
  firstFunction(
  this.auditRepository,
  [
  'create',
  'record',
  'append',
  'createEvent',
  ]
  );


if (!method) {



  /*
   * Audit persistence is deliberately fail-closed for acceptance events,
   * but public document reads do not need to fail because an audit adapter
   * is unavailable.
   */
  return null;
}

return method(
  payload
);


}
}

/**

* ============================================================================
* CONTROLLER
* ============================================================================
  */

class LegalController {
constructor(
dependencies = {}
) {
this.dependencies =
new LegalDependencyAdapter(
dependencies
);


this.logger =
  dependencies.logger ||
  console;

this.metrics =
  dependencies.metrics ||
  null;


}

/**

* ---
* LOGGING
* ---

*/

log(
level,
message,
metadata = {}
) {
const loggerMethod =
this.logger?.[level];


if (
  isFunction(
    loggerMethod
  )
) {
  loggerMethod.call(
    this.logger,
    message,
    metadata
  );
}


}

incrementMetric(
name,
value = 1
) {
if (
!this.metrics
) {
return;
}


try {
  if (
    isFunction(
      this.metrics.increment
    )
  ) {
    this.metrics.increment(
      name,
      value
    );
    return;
  }

  if (
    isFunction(
      this.metrics.inc
    )
  ) {
    this.metrics.inc(
      name,
      value
    );
  }
} catch {
  /*
   * Metrics must never break a legal request.
   */
}


}

/**

* ---
* REQUEST GUARDS
* ---

*/

requireAuthenticatedContext(
context
) {
if (
!context.userId
) {
throw new LegalControllerError(
'Authenticated user context is unavailable.',
{
statusCode:
HTTP_STATUS.UNAUTHORIZED,


      code:
        ERROR_CODES.LEGAL_IDENTITY_UNAVAILABLE,
    }
  );
}


}

/**

* ---
* PUBLIC DOCUMENT RESOLUTION
* ---

*/

async resolvePublicDocument(
documentId,
req,
{
requestedVersion = null,
includeContent = true,
} = {}
) {
const context =
buildRequestContext(req);


const language =
  normalizeLowerString(
    req?.query?.language,
    DEFAULT_LANGUAGE
  );

const countryCode =
  normalizeString(
    req?.query?.countryCode ||
    req?.query?.country,
    DEFAULT_COUNTRY_CODE
  )?.toUpperCase();

/*
 * A public client may request a specific version for historical viewing,
 * but only published versions may be exposed.
 */
if (
  requestedVersion
) {
  const version =
    await this.dependencies.findEffectiveVersion(
      {
        documentId,
        version:
          requestedVersion,
        tenantId:
          context.tenantId,
        language,
        countryCode,
        at:
          now(),
      }
    );

  if (
    version &&
    isAcceptanceEligible(
      version
    )
  ) {
    return version;
  }

  throw new LegalControllerError(
    'The requested legal-document version is unavailable.',
    {
      statusCode:
        HTTP_STATUS.NOT_FOUND,

      code:
        ERROR_CODES.LEGAL_VERSION_NOT_FOUND,
    }
  );
}

const version =
  await this.dependencies.findEffectiveVersion(
    {
      documentId,
      tenantId:
        context.tenantId,
      language,
      countryCode,
      at:
        now(),
    }
  );

if (
  version
) {
  return version;
}

const document =
  await this.dependencies.findDocument(
    {
      documentId,
      tenantId:
        context.tenantId,
      language,
      countryCode,
      includeContent,
    }
  );

if (
  !document
) {
  throw new LegalControllerError(
    'The requested legal document was not found.',
    {
      statusCode:
        HTTP_STATUS.NOT_FOUND,

      code:
        ERROR_CODES.LEGAL_DOCUMENT_NOT_FOUND,
    }
  );
}

if (
  !isPublished(document)
) {
  throw new LegalControllerError(
    'The requested legal document is not currently published.',
    {
      statusCode:
        HTTP_STATUS.NOT_FOUND,

      code:
        ERROR_CODES.LEGAL_DOCUMENT_UNAVAILABLE,
    }
  );
}

return document;


}

/**

* ---
* GET TERMS OF SERVICE
* ---
*
* GET /api/legal/terms-of-service
  */
  async getTermsOfService(
  req,
  res
  ) {
  const context =
  buildRequestContext(req);


try {



  const document =
    await this.resolvePublicDocument(
      LEGAL_DOCUMENT_IDS.TERMS_OF_SERVICE,
      req,
      {
        requestedVersion:
          normalizeString(
            req?.query?.version
          ),
      }
    );

  this.incrementMetric(
    'titech.legal.document.read_total'
  );

  return sendSuccess(
    res,
    {
      statusCode:
        HTTP_STATUS.OK,

      data:
        sanitizeLegalVersion(
          document
        ),

      requestId:
        context.requestId,

      correlationId:
        context.correlationId,
    }
  );
} catch (error) {
  return this.handleError(
    error,
    req,
    res,
    'getTermsOfService'
  );
}


}

/**

* ---
* GET PRIVACY POLICY
* ---
*
* GET /api/legal/privacy-policy
  */
  async getPrivacyPolicy(
  req,
  res
  ) {
  const context =
  buildRequestContext(req);


try {



  const document =
    await this.resolvePublicDocument(
      LEGAL_DOCUMENT_IDS.PRIVACY_POLICY,
      req,
      {
        requestedVersion:
          normalizeString(
            req?.query?.version
          ),
      }
    );

  this.incrementMetric(
    'titech.legal.document.read_total'
  );

  return sendSuccess(
    res,
    {
      statusCode:
        HTTP_STATUS.OK,

      data:
        sanitizeLegalVersion(
          document
        ),

      requestId:
        context.requestId,

      correlationId:
        context.correlationId,
    }
  );
} catch (error) {
  return this.handleError(
    error,
    req,
    res,
    'getPrivacyPolicy'
  );
}


}

/**

* ---
* GET LEGAL CHANGELOG
* ---
*
* GET /api/legal/changelog
  */
  async getChangelog(
  req,
  res
  ) {
  const context =
  buildRequestContext(req);


try {



  const documentId =
    normalizeString(
      req?.query?.documentId
    );

  const page =
    normalizePositiveInteger(
      req?.query?.page,
      1
    );

  const limit =
    normalizePositiveInteger(
      req?.query?.limit,
      50,
      MAX_PAGE_SIZE
    );

  const documentIds =
    documentId
      ? [
          documentId,
        ]
      : [
          LEGAL_DOCUMENT_IDS.TERMS_OF_SERVICE,
          LEGAL_DOCUMENT_IDS.PRIVACY_POLICY,
        ];

  const allVersions = [];

  for (
    const id of
      documentIds
  ) {
    const versions =
      await this.dependencies.findVersions(
        {
          documentId:
            id,

          tenantId:
            context.tenantId,

          page,

          limit,
        }
      );

    if (
      Array.isArray(
        versions
      )
    ) {
      allVersions.push(
        ...versions
      );
    } else if (
      versions
    ) {
      allVersions.push(
        ...(Array.isArray(
          versions.items
        )
          ? versions.items
          : [])
      );
    }
  }

  const publishedVersions =
    allVersions
      .filter(
        isAcceptanceEligible
      )
      .map(
        sanitizeLegalVersion
      );

  this.incrementMetric(
    'titech.legal.changelog.read_total'
  );

  return sendSuccess(
    res,
    {
      statusCode:
        HTTP_STATUS.OK,

      data:
        publishedVersions,

      meta: {
        page,

        limit,

        count:
          publishedVersions.length,

        documentIds,
      },

      requestId:
        context.requestId,

      correlationId:
        context.correlationId,
    }
  );
} catch (error) {
  return this.handleError(
    error,
    req,
    res,
    'getChangelog'
  );
}


}

/**

* ---
* ACCEPT TERMS AND PRIVACY
* ---
*
* POST /api/legal/accept-terms
*
* IMPORTANT:
* Client-provided userId and tenantId are intentionally ignored.
*
* The trusted authenticated context is authoritative.
  */
  async acceptTermsAndPrivacy(
  req,
  res
  ) {
  const context =
  buildRequestContext(req);


try {



  this.requireAuthenticatedContext(
    context
  );

  const body =
    req?.body &&
    typeof req.body ===
    'object'
      ? req.body
      : {};

  /*
   * Never trust client-supplied identity.
   */
  const forbiddenIdentityFields = [
    'userId',
    'tenantId',
    'actorId',
    'memberId',
  ];

  const suppliedIdentityFields =
    forbiddenIdentityFields.filter(
      (field) =>
        Object.prototype.hasOwnProperty.call(
          body,
          field
        )
    );

  if (
    suppliedIdentityFields.length
  ) {
    throw new LegalControllerError(
      'Authenticated identity must not be supplied by the client.',
      {
        statusCode:
          HTTP_STATUS.BAD_REQUEST,

        code:
          ERROR_CODES.LEGAL_ACCEPTANCE_INVALID,

        details: {
          fields:
            suppliedIdentityFields,
        },
      }
    );
  }

  const termsVersion =
    normalizeString(
      body.termsVersion ||
      body.terms?.version
    );

  const privacyVersion =
    normalizeString(
      body.privacyVersion ||
      body.privacy?.version
    );

  const idempotencyKey =
    normalizeString(
      req?.headers?.[
        'idempotency-key'
      ]
    ) ||
    normalizeString(
      body.idempotencyKey
    );

  const acceptedAt =
    now();

  /*
   * The client can request a version, but the backend must resolve it
   * against the authoritative published version store.
   */
  const terms =
    await this.dependencies.findEffectiveVersion(
      {
        documentId:
          LEGAL_DOCUMENT_IDS.TERMS_OF_SERVICE,

        version:
          termsVersion,

        tenantId:
          context.tenantId,

        language:
          DEFAULT_LANGUAGE,

        countryCode:
          DEFAULT_COUNTRY_CODE,

        at:
          acceptedAt,
      }
    );

  const privacy =
    await this.dependencies.findEffectiveVersion(
      {
        documentId:
          LEGAL_DOCUMENT_IDS.PRIVACY_POLICY,

        version:
          privacyVersion,

        tenantId:
          context.tenantId,

        language:
          DEFAULT_LANGUAGE,

        countryCode:
          DEFAULT_COUNTRY_CODE,

        at:
          acceptedAt,
      }
    );

  if (
    !terms ||
    !isAcceptanceEligible(
      terms
    )
  ) {
    throw new LegalControllerError(
      'The current Terms of Service version is unavailable for acceptance.',
      {
        statusCode:
          HTTP_STATUS.CONFLICT,

        code:
          ERROR_CODES.LEGAL_VERSION_NOT_FOUND,
      }
    );
  }

  if (
    !privacy ||
    !isAcceptanceEligible(
      privacy
    )
  ) {
    throw new LegalControllerError(
      'The current Privacy Policy version is unavailable for acceptance.',
      {
        statusCode:
          HTTP_STATUS.CONFLICT,

        code:
          ERROR_CODES.LEGAL_VERSION_NOT_FOUND,
      }
    );
  }

  const clientAcceptedAt =
    normalizeString(
      body.acceptedAt
    );

  /*
   * The server timestamp is authoritative.
   *
   * Client timestamps may be retained as metadata if needed, but must not
   * determine the legal acceptance timestamp.
   */
  const acceptancePayload = {
    userId:
      context.userId,

    tenantId:
      context.tenantId,

    actorId:
      context.userId,

    documentId:
      LEGAL_DOCUMENT_IDS.TERMS_OF_SERVICE,

    legalDocumentId:
      LEGAL_DOCUMENT_IDS.TERMS_OF_SERVICE,

    documentVersionId:
      terms.id ||
      terms._id,

    legalDocumentVersionId:
      terms.id ||
      terms._id,

    version:
      terms.version,

    accepted:
      true,

    acceptedAt,

    acceptanceTimestamp:
      acceptedAt,

    acceptanceMethod:
      'authenticated_web',

    acceptanceType:
      'explicit',

    idempotencyKey,

    requestId:
      context.requestId,

    correlationId:
      context.correlationId,

    ipAddress:
      context.ipAddress,

    userAgent:
      context.userAgent,

    actorRole:
      context.role,

    actorEmail:
      context.actorEmail,

    metadata: {
      company:
        COMPANY_NAME,

      clientAcceptedAt,

      pairedPrivacyVersion:
        privacy.version,

      source:
        'TITech Legal API',
    },
  };

  /*
   * The acceptance service/repository is responsible for transactionality,
   * uniqueness, and persistence.
   */
  const termsAcceptance =
    await this.dependencies.recordAcceptance(
      acceptancePayload,
      {
        idempotencyKey,
      }
    );

  const privacyAcceptancePayload = {
    ...acceptancePayload,

    documentId:
      LEGAL_DOCUMENT_IDS.PRIVACY_POLICY,

    legalDocumentId:
      LEGAL_DOCUMENT_IDS.PRIVACY_POLICY,

    documentVersionId:
      privacy.id ||
      privacy._id,

    legalDocumentVersionId:
      privacy.id ||
      privacy._id,

    version:
      privacy.version,

    metadata: {
      ...acceptancePayload.metadata,

      pairedTermsVersion:
        terms.version,
    },
  };

  const privacyAcceptance =
    await this.dependencies.recordAcceptance(
      privacyAcceptancePayload,
      {
        idempotencyKey:
          idempotencyKey
            ? `${idempotencyKey}:privacy`
            : undefined,
      }
    );

  /*
   * Audit acceptance only after persistence has succeeded.
   */
  await this.dependencies.recordAuditEvent(
    {
      eventType:
        'LEGAL_ACCEPTANCE_RECORDED',

      action:
        'accept',

      entity:
        'LegalAcceptance',

      entityType:
        'LegalAcceptance',

      entityId:
        context.userId,

      userId:
        context.userId,

      tenantId:
        context.tenantId,

      requestId:
        context.requestId,

      correlationId:
        context.correlationId,

      actorId:
        context.userId,

      actorRole:
        context.role,

      ipAddress:
        context.ipAddress,

      userAgent:
        context.userAgent,

      documents: [
        {
          documentId:
            LEGAL_DOCUMENT_IDS.TERMS_OF_SERVICE,

          version:
            terms.version,

          versionId:
            terms.id ||
            terms._id,

          acceptanceId:
            termsAcceptance?.id ||
            termsAcceptance?._id,
        },

        {
          documentId:
            LEGAL_DOCUMENT_IDS.PRIVACY_POLICY,

          version:
            privacy.version,

          versionId:
            privacy.id ||
            privacy._id,

          acceptanceId:
            privacyAcceptance?.id ||
            privacyAcceptance?._id,
        },
      ],

      timestamp:
        acceptedAt,

      metadata: {
        source:
          'TITech Legal API',

        acceptanceMethod:
          'authenticated_web',
      },
    }
  );

  this.incrementMetric(
    'titech.legal.acceptance.recorded_total'
  );

  return sendSuccess(
    res,
    {
      statusCode:
        HTTP_STATUS.CREATED,

      message:
        'Legal acceptance recorded successfully.',

      data: {
        accepted:
          true,

        acceptedAt:
          acceptedAt.toISOString(),

        terms: {
          documentId:
            LEGAL_DOCUMENT_IDS.TERMS_OF_SERVICE,

          version:
            terms.version,

          versionId:
            terms.id ||
            terms._id,
        },

        privacy: {
          documentId:
            LEGAL_DOCUMENT_IDS.PRIVACY_POLICY,

          version:
            privacy.version,

          versionId:
            privacy.id ||
            privacy._id,
        },

        acceptanceId:
          termsAcceptance?.id ||
          termsAcceptance?._id ||
          null,
      },

      requestId:
        context.requestId,

      correlationId:
        context.correlationId,
    }
  );
} catch (error) {
  /*
   * A uniqueness conflict normally means the same acceptance was already
   * recorded. Preserve an idempotent API contract where the persistence
   * layer exposes the relevant signal.
   */
  if (
    this.isDuplicateAcceptanceError(
      error
    )
  ) {
    return sendSuccess(
      res,
      {
        statusCode:
          HTTP_STATUS.OK,

        message:
          'Legal acceptance has already been recorded.',

        data: {
          accepted:
            true,

          alreadyRecorded:
            true,
        },

        requestId:
          context.requestId,

        correlationId:
          context.correlationId,
      }
    );
  }

  return this.handleError(
    error,
    req,
    res,
    'acceptTermsAndPrivacy'
  );
}


}

/**

* ---
* GET ACCEPTANCE STATUS
* ---
*
* GET /api/legal/acceptance-status
  */
  async getAcceptanceStatus(
  req,
  res
  ) {
  const context =
  buildRequestContext(req);


try {



  this.requireAuthenticatedContext(
    context
  );

  const requestedDocumentIds =
    Array.isArray(
      req?.query?.documentIds
    )
      ? req.query.documentIds
      : normalizeString(
          req?.query?.documentIds
        )
          ?.split(',')
          .map(
            (value) =>
              value.trim()
          )
          .filter(Boolean);

  const documentIds =
    requestedDocumentIds?.length
      ? requestedDocumentIds
      : [
          LEGAL_DOCUMENT_IDS.TERMS_OF_SERVICE,
          LEGAL_DOCUMENT_IDS.PRIVACY_POLICY,
        ];

  const rawStatus =
    await this.dependencies.findAcceptanceStatus(
      {
        userId:
          context.userId,

        tenantId:
          context.tenantId,

        documentIds,
      }
    );

  const normalizedStatus =
    this.normalizeAcceptanceStatus(
      rawStatus
    );

  this.incrementMetric(
    'titech.legal.acceptance.status_read_total'
  );

  return sendSuccess(
    res,
    {
      statusCode:
        HTTP_STATUS.OK,

      data:
        normalizedStatus,

      requestId:
        context.requestId,

      correlationId:
        context.correlationId,
    }
  );
} catch (error) {
  return this.handleError(
    error,
    req,
    res,
    'getAcceptanceStatus'
  );
}


}

/**

* ---
* NORMALIZE ACCEPTANCE STATUS
* ---

*/

normalizeAcceptanceStatus(
value
) {
if (
!value
) {
return {
accepted:
false,


    documents: {},
  };
}

if (
  Array.isArray(value)
) {
  const documents = {};

  for (
    const item of
      value
  ) {
    const documentId =
      normalizeString(
        item?.documentId ||
        item?.legalDocumentId ||
        item?.document
      );

    if (
      !documentId
    ) {
      continue;
    }

    documents[
      documentId
    ] = {
      accepted:
        Boolean(
          item?.accepted ??
          item?.status ===
            'accepted'
        ),

      version:
        item?.version ||
        null,

      versionId:
        item?.versionId ||
        item?.legalDocumentVersionId ||
        null,

      acceptedAt:
        item?.acceptedAt ||
        item?.acceptanceTimestamp ||
        null,
    };
  }

  return {
    accepted:
      Object.values(
        documents
      ).every(
        (item) =>
          item.accepted
      ),

    documents,
  };
}

const source =
  toPlainObject(value);

if (
  source.documents
) {
  return {
    accepted:
      Boolean(
        source.accepted
      ),

    documents:
      source.documents,

    updatedAt:
      source.updatedAt ||
      null,
  };
}

return {
  accepted:
    Boolean(
      source.accepted
    ),

  documents:
    source.documentStatuses ||
    source.statuses ||
    {},

  updatedAt:
    source.updatedAt ||
    null,
};


}

/**

* ---
* DUPLICATE DETECTION
* ---

*/

isDuplicateAcceptanceError(
error
) {
if (!error) {
return false;
}


const code =
  normalizeLowerString(
    error.code
  );

const message =
  normalizeLowerString(
    error.message
  );

return (
  code ===
    'e11000' ||
  code ===
    'duplicate_key' ||
  code ===
    'legal_acceptance_already_exists' ||
  Boolean(
    message &&
    (
      message.includes(
        'duplicate key'
      ) ||
      message.includes(
        'already exists'
      ) ||
      message.includes(
        'already accepted'
      )
    )
  )
);


}

/**

* 
* CENTRALIZED ERROR HANDLING
* 

*/

handleError(
error,
req,
res,
operation
) {
const context =
buildRequestContext(req);


const normalized =
  normalizeControllerError(
    error
  );

const isClientError =
  normalized.statusCode >=
    HTTP_STATUS.BAD_REQUEST &&
  normalized.statusCode <
    HTTP_STATUS.INTERNAL_SERVER_ERROR;

/*
 * Never expose stack traces, database details, SQL/Mongo errors, or internal
 * provider information in production responses.
 */
const message =
  isClientError
    ? normalized.message
    : 'The legal request could not be completed.';

const details =
  isClientError
    ? normalized.details
    : null;

this.log(
  isClientError
    ? 'warn'
    : 'error',
  `${CONTROLLER_NAME}.${operation} failed`,
  {
    code:
      normalized.code,

    statusCode:
      normalized.statusCode,

    requestId:
      context.requestId,

    correlationId:
      context.correlationId,

    userId:
      context.userId,

    tenantId:
      context.tenantId,

    error:
      isClientError
        ? normalized.message
        : safeErrorMessage(error),

    stack:
      isClientError
        ? undefined
        : error?.stack,
  }
);

this.incrementMetric(
  `titech.legal.controller.error.${normalized.code}`
);

return sendError(
  res,
  {
    statusCode:
      normalized.statusCode,

    code:
      normalized.code,

    message,

    details,

    requestId:
      context.requestId,

    correlationId:
      context.correlationId,
  }
);


}
}

/**

* ============================================================================
* DEFAULT DEPENDENCY LOADING
* ============================================================================
*
* The controller supports explicit dependency injection for tests and modular
* deployments. When no dependencies are supplied, it attempts to load the
* project's conventional legal services/repositories.
*
* Failure to load an optional dependency does not crash module import. The
* controller will return a controlled 503 when the missing capability is used.
* ============================================================================
  */

function optionalRequire(
modulePath
) {
try {
return require(
modulePath
);
} catch {
return null;
}
}

function unwrapDefaultExport(
module
) {
if (
module &&
module.default
) {
return module.default;
}

return module;
}

function loadDefaultDependencies() {
const legalService =
unwrapDefaultExport(
optionalRequire(
'../services/legalService'
)
) ||
unwrapDefaultExport(
optionalRequire(
'../../services/legalService'
)
);

const documentRepository =
unwrapDefaultExport(
optionalRequire(
'../repositories/legalDocumentRepository'
)
) ||
unwrapDefaultExport(
optionalRequire(
'../../repositories/legalDocumentRepository'
)
);

const versionRepository =
unwrapDefaultExport(
optionalRequire(
'../repositories/legalDocumentVersionRepository'
)
) ||
unwrapDefaultExport(
optionalRequire(
'../../repositories/legalDocumentVersionRepository'
)
);

const acceptanceService =
unwrapDefaultExport(
optionalRequire(
'../services/legalAcceptanceService'
)
) ||
unwrapDefaultExport(
optionalRequire(
'../../services/legalAcceptanceService'
)
);

const acceptanceRepository =
unwrapDefaultExport(
optionalRequire(
'../repositories/legalAcceptanceRepository'
)
) ||
unwrapDefaultExport(
optionalRequire(
'../../repositories/legalAcceptanceRepository'
)
);

const auditService =
unwrapDefaultExport(
optionalRequire(
'../services/legalAuditService'
)
) ||
unwrapDefaultExport(
optionalRequire(
'../../services/legalAuditService'
)
);

const auditRepository =
unwrapDefaultExport(
optionalRequire(
'../repositories/legalAuditRepository'
)
) ||
unwrapDefaultExport(
optionalRequire(
'../../repositories/legalAuditRepository'
)
);

const logger =
unwrapDefaultExport(
optionalRequire(
'../../infrastructure/logging/logger'
)
) ||
unwrapDefaultExport(
optionalRequire(
'../../utils/logger'
)
);

return {
legalService,


documentRepository,

versionRepository,

acceptanceService,

acceptanceRepository,

auditService,

auditRepository,

logger,


};
}

/**

* ============================================================================
* FACTORY
* ============================================================================
  */

function createLegalController(
dependencies = {}
) {
return new LegalController(
{
...loadDefaultDependencies(),
...dependencies,
}
);
}

/**

* ============================================================================
* DEFAULT CONTROLLER INSTANCE
* ============================================================================
  */

const defaultController =
createLegalController();

/**

* ============================================================================
* EXPRESS HANDLER BINDING
* ============================================================================
*
* Explicit binding prevents `this` from being lost when the functions are
* passed directly to Express.
* ============================================================================
  */

const getTermsOfService =
defaultController
.getTermsOfService
.bind(
defaultController
);

const getPrivacyPolicy =
defaultController
.getPrivacyPolicy
.bind(
defaultController
);

const getChangelog =
defaultController
.getChangelog
.bind(
defaultController
);

const acceptTermsAndPrivacy =
defaultController
.acceptTermsAndPrivacy
.bind(
defaultController
);

const getAcceptanceStatus =
defaultController
.getAcceptanceStatus
.bind(
defaultController
);

/**

* ============================================================================
* MODULE METADATA
* ============================================================================
  */

const controllerMetadata =
Object.freeze({
name:
CONTROLLER_NAME,


version:
  CONTROLLER_VERSION,

service:
  SERVICE_NAME,

company:
  COMPANY_NAME,

countryCode:
  DEFAULT_COUNTRY_CODE,

language:
  DEFAULT_LANGUAGE,

documentIds:
  LEGAL_DOCUMENT_IDS,


});

/**

* ============================================================================
* EXPORTS
* ============================================================================
*
* Backward compatibility:
*
* const legalController =
* ```
  require('../controllers/legalController');
  ```
*
* New/testable usage:
*
* const {
* ```
  createLegalController,
  ```
* ```
  LegalController,
  ```
* } =
* ```
  require('../controllers/legalController');
  ```
*
* ============================================================================
  */

module.exports =
Object.assign(
{
getTermsOfService,


  getPrivacyPolicy,

  getChangelog,

  acceptTermsAndPrivacy,

  getAcceptanceStatus,

  createLegalController,

  LegalController,

  LegalControllerError,

  LEGAL_DOCUMENT_IDS,

  HTTP_STATUS,

  ERROR_CODES,

  PUBLISHED_STATUSES,

  APPROVED_STATUSES,

  ACCEPTANCE_ELIGIBLE_STATUSES,

  metadata:
    controllerMetadata,
},
controllerMetadata


);

/**

* ============================================================================
* END OF FILE
* ============================================================================
  */